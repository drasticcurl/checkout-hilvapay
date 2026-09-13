/**
 * Tests de `lib/admin/catalogo.ts` — `vincularPlan` (§7.2 de T01).
 *
 * El caso central: vincular un segundo plan que comparte `whop_product_id`
 * con un producto YA vinculado tiene que fusionarse (`fusionado: true`) y NO
 * crear una fila nueva en `productos` — es el bug exacto que reportó el
 * usuario (D1 del plan: dos planes del mismo access_pass viviendo como dos
 * productos sin relación). Se verifica contando filas antes/después, con el
 * mismo patrón de mock de `../db` que usa `funnels.test.ts`.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

type FilaProductoFake = { id: string; nombre: string; whop_product_id: string | null; activo: boolean };
type FilaPlanFake = { id: string; producto_id: string; whop_plan_id: string; es_default: boolean };
type FilaPaginaFake = { id: string; slug: string; producto_id: string; producto_plan_id: string };

let productos: Map<string, FilaProductoFake>;
let planes: Map<string, FilaPlanFake>;
let paginasFake: Map<string, FilaPaginaFake>;
let siguienteId: number;

function nuevoId(prefijo: string): string {
  return `${prefijo}-${siguienteId++}`;
}

function crearClienteFake() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) {
        return { rows: [], rowCount: 0 };
      }

      if (s.startsWith('insert into producto_planes') && s.includes("'Variante'")) {
        const [producto_id, whop_plan_id] = params as [string, string];
        const id = nuevoId('plan');
        planes.set(id, { id, producto_id, whop_plan_id, es_default: false });
        return { rows: [{ id }], rowCount: 1 };
      }

      if (s.startsWith('insert into productos')) {
        const [nombre, whop_product_id] = params as [string, string | null];
        const id = nuevoId('prod');
        productos.set(id, { id, nombre, whop_product_id, activo: false });
        return { rows: [{ id }], rowCount: 1 };
      }

      if (s.startsWith('insert into producto_planes')) {
        const [producto_id, whop_plan_id] = params as [string, string];
        const id = nuevoId('plan');
        planes.set(id, { id, producto_id, whop_plan_id, es_default: true });
        return { rows: [{ id }], rowCount: 1 };
      }

      if (s.startsWith('insert into paginas')) {
        const [slug, producto_id, producto_plan_id] = params as [string, string, string];
        if (Array.from(paginasFake.values()).some((p) => p.slug === slug)) {
          throw new Error('duplicate key value violates unique constraint "paginas_slug_idx"');
        }
        const id = nuevoId('pag');
        paginasFake.set(id, { id, slug, producto_id, producto_plan_id });
        return { rows: [{ id }], rowCount: 1 };
      }

      throw new Error(`query no reconocida en el mock: ${s}`);
    }),
  };
}

const qMock = vi.fn(async (sql: string) => {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.includes('from productos pr') && s.includes('join producto_planes')) {
    // catalogoWhop: no lo ejercitan estos tests.
    return [];
  }
  throw new Error(`qMock: query no reconocida: ${s}`);
});

const q1Mock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.replace(/\s+/g, ' ').trim();

  if (s.startsWith('select id from paginas where slug')) {
    const [slug] = params as [string];
    const fila = Array.from(paginasFake.values()).find((p) => p.slug === slug);
    return fila ? { id: fila.id } : null;
  }
  if (s.startsWith('select id from producto_planes where whop_plan_id')) {
    const [whopPlanId] = params as [string];
    const fila = Array.from(planes.values()).find((p) => p.whop_plan_id === whopPlanId);
    return fila ? { id: fila.id } : null;
  }
  if (s.startsWith('select id from productos where whop_product_id')) {
    const [whopProductId] = params as [string];
    const fila = Array.from(productos.values()).find((p) => p.whop_product_id === whopProductId);
    return fila ? { id: fila.id } : null;
  }
  throw new Error(`q1Mock: query no reconocida: ${s}`);
});

vi.mock('../db', () => ({
  q: (...args: unknown[]) => qMock(...(args as [string])),
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
  listarProductosWhop: vi.fn(),
}));

import { vincularPlan, type EntradaVinculo } from './catalogo';

function entrada(over: Partial<EntradaVinculo> = {}): EntradaVinculo {
  return {
    whop_plan_id: 'zz-plan-completo',
    whop_product_id: 'zz-access-pass-1',
    whop_nombre_soft: 'Acelerador 7X',
    nombre: 'Acelerador 7X',
    precio: '27.00',
    moneda: 'usd',
    slug: 'zz-acelerador',
    tipo: 'front',
    ...over,
  };
}

beforeEach(() => {
  productos = new Map();
  planes = new Map();
  paginasFake = new Map();
  siguienteId = 1;
});

describe('vincularPlan — fusión bajo el mismo whop_product_id', () => {
  it('el primer plan de un access_pass crea un producto nuevo (fusionado: false)', async () => {
    const r = await vincularPlan(entrada());
    expect(r).toMatchObject({ ok: true, fusionado: false });
    expect(productos.size).toBe(1);
    expect(planes.size).toBe(1);
  });

  it('un segundo plan del MISMO whop_product_id se fusiona: no crea una fila nueva en productos', async () => {
    const primero = await vincularPlan(entrada());
    expect(primero.ok).toBe(true);
    const productosAntes = productos.size;

    const segundo = await vincularPlan(
      entrada({
        whop_plan_id: 'zz-plan-downsell',
        nombre: 'Acelerador 7X (downsell)',
        precio: '17.00',
        slug: 'zz-acelerador-downsell',
        tipo: 'upsell',
      }),
    );

    expect(segundo).toMatchObject({ ok: true, fusionado: true });
    // El punto central del test: contar productos antes y después.
    expect(productos.size).toBe(productosAntes);
    expect(planes.size).toBe(2);

    if (segundo.ok) {
      // Las dos variantes cuelgan del MISMO producto_id.
      const primerProductoId = Array.from(planes.values())[0].producto_id;
      expect(segundo.producto_id).toBe(primerProductoId);
    }
  });

  it('un whop_product_id distinto no se fusiona: crea su propio producto', async () => {
    await vincularPlan(entrada());
    const r = await vincularPlan(
      entrada({
        whop_plan_id: 'zz-otro-plan',
        whop_product_id: 'zz-access-pass-2',
        nombre: 'Otro producto',
        slug: 'zz-otro',
      }),
    );
    expect(r).toMatchObject({ ok: true, fusionado: false });
    expect(productos.size).toBe(2);
  });

  it('un plan ya vinculado da error plan_ya_vinculado', async () => {
    await vincularPlan(entrada());
    const r = await vincularPlan(entrada({ slug: 'zz-otro-slug' }));
    expect(r).toMatchObject({ ok: false, error: 'plan_ya_vinculado' });
  });

  it('un slug ocupado da error slug_ocupado', async () => {
    await vincularPlan(entrada());
    const r = await vincularPlan(entrada({ whop_plan_id: 'zz-plan-otro' }));
    expect(r).toMatchObject({ ok: false, error: 'slug_ocupado' });
  });
});
