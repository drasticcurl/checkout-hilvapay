/**
 * Tests de `lib/admin/productos.ts` — la capa nueva de `producto_planes`
 * (§4/§7 de T01). `agregarPlanAProducto` y `crearProductoConPlan` tocan la
 * base, así que `../db` se mockea con un estado en memoria: es la única forma
 * de probar "un producto con dos variantes" sin una Postgres real.
 *
 * El punto central que fija este archivo: agregar una SEGUNDA variante a un
 * producto no la marca `es_default` — esa es la regla que hace cumplir el
 * índice `producto_planes_un_default_idx` en la base real, y acá se prueba
 * contra el código, no contra el índice.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

type FilaProductoFake = {
  id: string;
  nombre: string;
  whop_product_id: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
};

type FilaPlanFake = {
  id: string;
  producto_id: string;
  whop_plan_id: string;
  whop_nombre_soft: string | null;
  etiqueta: string;
  precio: string;
  moneda: string;
  precio_anclaje: string | null;
  es_default: boolean;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
};

let productos: Map<string, FilaProductoFake>;
let planes: Map<string, FilaPlanFake>;
let paginasFake: Map<string, { id: string; producto_id: string }>;
let cobrosFake: Map<string, { id: string; producto_id: string }>;
let siguienteId: number;

function nuevoId(prefijo: string): string {
  return `${prefijo}-${siguienteId++}`;
}

/** Cliente falso que entiende el subconjunto de SQL que este módulo ejecuta dentro de una tx. */
function crearClienteFake() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) {
        return { rows: [], rowCount: 0 };
      }

      if (s.startsWith('insert into productos')) {
        const [nombre, whop_product_id, imagen_url, descripcion] = params as [
          string,
          string | null,
          string | null,
          string | null,
        ];
        const id = nuevoId('prod');
        const fila: FilaProductoFake = {
          id,
          nombre,
          whop_product_id,
          imagen_url,
          descripcion,
          activo: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        productos.set(id, fila);
        return { rows: [fila], rowCount: 1 };
      }

      if (s.startsWith('insert into producto_planes')) {
        // Firma común a crearProductoConPlan: (producto_id, whop_plan_id,
        // whop_nombre_soft, etiqueta, precio, moneda, precio_anclaje).
        const [producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio, moneda, precio_anclaje] =
          params as [string, string, string | null, string, string, string, string | null];
        if (Array.from(planes.values()).some((p) => p.whop_plan_id === whop_plan_id)) {
          throw new Error(
            'duplicate key value violates unique constraint "producto_planes_whop_plan_idx"',
          );
        }
        const esDefault = s.includes('true, false)');
        const id = nuevoId('plan');
        const fila: FilaPlanFake = {
          id,
          producto_id,
          whop_plan_id,
          whop_nombre_soft,
          etiqueta,
          precio,
          moneda,
          precio_anclaje,
          es_default: esDefault,
          activo: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        planes.set(id, fila);
        return { rows: [fila], rowCount: 1 };
      }

      throw new Error(`query no reconocida en el mock: ${s}`);
    }),
  };
}

const qMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.replace(/\s+/g, ' ').trim();

  if (s.startsWith('select') && s.includes('from producto_planes where producto_id = any')) {
    const [ids] = params as [string[]];
    return Array.from(planes.values()).filter((p) => ids.includes(p.producto_id));
  }
  if (s.startsWith('select') && s.includes('from producto_planes where producto_id = $1')) {
    const [productoId] = params as [string];
    return Array.from(planes.values()).filter((p) => p.producto_id === productoId);
  }
  // insert into producto_planes vía agregarPlanAProducto — fuera de una tx,
  // pasa por q1 directo (no por el cliente fake de arriba).
  if (s.startsWith('insert into producto_planes')) {
    const [producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio, moneda, precio_anclaje] =
      params as [string, string, string | null, string, string, string, string | null];
    if (Array.from(planes.values()).some((p) => p.whop_plan_id === whop_plan_id)) {
      throw new Error('duplicate key value violates unique constraint "producto_planes_whop_plan_idx"');
    }
    const id = nuevoId('plan');
    const fila: FilaPlanFake = {
      id,
      producto_id,
      whop_plan_id,
      whop_nombre_soft,
      etiqueta,
      precio,
      moneda,
      precio_anclaje,
      es_default: false,
      activo: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    planes.set(id, fila);
    return [fila];
  }
  if (s.startsWith('select') && s.includes('from productos where id = $1')) {
    const [id] = params as [string];
    const fila = productos.get(id);
    return fila ? [fila] : [];
  }
  if (s.startsWith('select id from paginas where producto_id = $1')) {
    const [productoId] = params as [string];
    const filas = Array.from(paginasFake.values()).filter((p) => p.producto_id === productoId);
    return filas.map((p) => ({ id: p.id }));
  }
  if (s.startsWith('select id from cobros where producto_id = $1')) {
    const [productoId] = params as [string];
    const filas = Array.from(cobrosFake.values()).filter((c) => c.producto_id === productoId);
    return filas.map((c) => ({ id: c.id }));
  }
  if (s.startsWith('delete from productos where id = $1')) {
    const [id] = params as [string];
    productos.delete(id);
    return [];
  }
  throw new Error(`qMock: query no reconocida: ${s}`);
});

const q1Mock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const rows = await qMock(sql, params);
  return rows[0] ?? null;
});

vi.mock('../db', () => ({
  q: (...args: unknown[]) => qMock(...(args as [string, unknown[]?])),
  q1: (...args: unknown[]) => q1Mock(...(args as [string, unknown[]?])),
  tx: async (fn: (c: ReturnType<typeof crearClienteFake>) => Promise<unknown>) => {
    const cliente = crearClienteFake();
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw err;
    }
  },
}));

vi.mock('../whop', () => ({
  listarPlanes: vi.fn(),
  obtenerPlan: vi.fn(),
}));

import { agregarPlanAProducto, borrarProducto, buscarProductoConPlanes, crearProductoConPlan } from './productos';

beforeEach(() => {
  productos = new Map();
  planes = new Map();
  paginasFake = new Map();
  cobrosFake = new Map();
  siguienteId = 1;
  qMock.mockClear();
  q1Mock.mockClear();
});

describe('crearProductoConPlan + agregarPlanAProducto', () => {
  it('un producto con dos variantes tiene planes.length === 2, y la segunda no es default', async () => {
    const producto = await crearProductoConPlan({
      nombre: 'zz-producto-test',
      plan: { whop_plan_id: 'zz-plan-1', precio: '27.00', etiqueta: 'Precio completo' },
    });
    expect(producto.planes).toHaveLength(1);
    expect(producto.planes[0].es_default).toBe(true);

    await agregarPlanAProducto(producto.id, {
      whop_plan_id: 'zz-plan-2',
      etiqueta: 'Downsell',
      precio: '17.00',
    });

    const conPlanes = await buscarProductoConPlanes(producto.id);
    expect(conPlanes).not.toBeNull();
    expect(conPlanes!.planes).toHaveLength(2);

    const segunda = conPlanes!.planes.find((p) => p.whop_plan_id === 'zz-plan-2');
    expect(segunda).toBeDefined();
    expect(segunda!.es_default).toBe(false);

    const primera = conPlanes!.planes.find((p) => p.whop_plan_id === 'zz-plan-1');
    expect(primera!.es_default).toBe(true);
  });

  it('agregarPlanAProducto con un whop_plan_id ya usado da un error legible, no el UNIQUE VIOLATION crudo', async () => {
    const producto = await crearProductoConPlan({
      nombre: 'zz-producto-test-2',
      plan: { whop_plan_id: 'zz-plan-dup', precio: '9.90' },
    });

    await expect(
      agregarPlanAProducto(producto.id, { whop_plan_id: 'zz-plan-dup', etiqueta: 'Otra', precio: '5.00' }),
    ).rejects.toThrow('plan_ya_vinculado');
  });
});

describe('borrarProducto', () => {
  it('borra un producto sin links ni cobros', async () => {
    const producto = await crearProductoConPlan({
      nombre: 'zz-producto-sin-uso',
      plan: { whop_plan_id: 'zz-plan-sin-uso', precio: '10.00' },
    });

    const r = await borrarProducto(producto.id);
    expect(r).toMatchObject({ ok: true });
    expect(productos.has(producto.id)).toBe(false);
  });

  it('no borra un producto con un link de pago apuntándole', async () => {
    const producto = await crearProductoConPlan({
      nombre: 'zz-producto-con-link',
      plan: { whop_plan_id: 'zz-plan-con-link', precio: '10.00' },
    });
    paginasFake.set('pagina-1', { id: 'pagina-1', producto_id: producto.id });

    const r = await borrarProducto(producto.id);
    expect(r).toMatchObject({ ok: false, error: 'tiene_links' });
    expect(productos.has(producto.id)).toBe(true);
  });

  it('no borra un producto con un cobro histórico', async () => {
    const producto = await crearProductoConPlan({
      nombre: 'zz-producto-con-cobro',
      plan: { whop_plan_id: 'zz-plan-con-cobro', precio: '10.00' },
    });
    cobrosFake.set('cobro-1', { id: 'cobro-1', producto_id: producto.id });

    const r = await borrarProducto(producto.id);
    expect(r).toMatchObject({ ok: false, error: 'tiene_cobros' });
    expect(productos.has(producto.id)).toBe(true);
  });

  it('devuelve no_encontrado si el producto no existe', async () => {
    const r = await borrarProducto('zz-id-inexistente');
    expect(r).toMatchObject({ ok: false, error: 'no_encontrado' });
  });
});
