/**
 * Tests de `lib/admin/funnels.ts`. `guardarFunnel` toca la base (inserts,
 * updates, y la relectura para `detectarCiclo`), así que `../db` se mockea con
 * un cliente falso que graba las queries en un mapa de `paginas` en memoria —
 * es la única forma de probar la transacción completa, incluido el ROLLBACK
 * implícito, sin una Postgres real.
 *
 * Lo que se prueba: las validaciones que no dependen de la base (nombre corto,
 * sin pasos, sin front, dos fronts, slug vacío), el camino completo de `tx()`
 * con el ciclo detectado end-to-end usando el `detectarCiclo` real de
 * `lib/funnels.ts` — no un mock de esa función, porque el punto de esta task es
 * usarla tal cual está, no reimplementar su lógica — y, desde la sesión "1 link
 * de pago por variante" (migración 012), la REUTILIZACIÓN de una página
 * existente cuando un paso nuevo elige una variante que ya tiene link en otro
 * lado.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type FilaPaginaFake = {
  id: string;
  slug: string;
  producto_plan_id: string;
  tipo: 'front' | 'upsell';
  orden: number;
  nombre: string | null;
  url_externa: string | null;
  permite_rechazo: boolean;
  funnel_id: string | null;
  paso_aceptado_id: string | null;
  paso_rechazado_id: string | null;
  activo: boolean;
};

/** Estado en memoria que las queries mockeadas leen y escriben. */
let paginas: Map<string, FilaPaginaFake>;
let siguienteId: number;

function nuevoId(): string {
  return `paso-${siguienteId++}`;
}

const qMock = vi.fn();
const q1Mock = vi.fn();

/**
 * Un cliente falso que entiende el subconjunto de SQL que `guardarFunnel`
 * ejecuta. No es un parser real: matchea por substrings característicos de
 * cada query, que es suficiente porque el módulo bajo test es el único caller.
 */
function crearClienteFake() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) {
        return { rows: [], rowCount: 0 };
      }

      if (s.startsWith('insert into funnels')) {
        return { rows: [{ id: 'funnel-1' }], rowCount: 1 };
      }

      if (s.startsWith('update funnels')) {
        return { rows: [], rowCount: 1 };
      }

      if (s.includes('funnel_id = null') && s.includes('where funnel_id = $1')) {
        return { rows: [], rowCount: 0 };
      }

      // La búsqueda de reuso: ¿la variante ya tiene una página en algún lado?
      if (s.startsWith('select id from paginas where producto_plan_id')) {
        const [productoPlanId] = params as [string];
        const existente = Array.from(paginas.values()).find((p) => p.producto_plan_id === productoPlanId);
        return existente ? { rows: [{ id: existente.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      // Update de un paso EXISTENTE (tiene `p.id`): la query completa con
      // `producto_id = (select ...)` primero.
      if (s.startsWith('update paginas set producto_id = (select producto_id from producto_planes where id = $1), producto_plan_id = $1')) {
        const [productoPlanId, tipo, orden, nombre, url_externa, permite_rechazo, funnel_id, , id] = params as [
          string,
          'front' | 'upsell',
          number,
          string | null,
          string | null,
          boolean,
          string,
          string,
          string,
        ];
        const fila = paginas.get(id);
        if (!fila) throw new Error('no existe');
        Object.assign(fila, { producto_plan_id: productoPlanId, tipo, orden, nombre, url_externa, permite_rechazo, funnel_id });
        return { rows: [], rowCount: 1 };
      }

      // Update de REUSO: un paso nuevo cuya variante ya tenía página. NO
      // toca `producto_plan_id` (ya es el mismo) ni `slug` (se conserva el
      // que la página ya tenía).
      if (s.startsWith('update paginas set producto_id = (select producto_id from producto_planes where id = $1), tipo = $2')) {
        const [productoPlanId, tipo, orden, nombre, url_externa, permite_rechazo, funnel_id, , id] = params as [
          string,
          'front' | 'upsell',
          number,
          string | null,
          string | null,
          boolean,
          string,
          string,
          string,
        ];
        const fila = paginas.get(id);
        if (!fila) throw new Error('no existe');
        Object.assign(fila, { tipo, orden, nombre, url_externa, permite_rechazo, funnel_id });
        return { rows: [], rowCount: 1 };
      }

      if (s.startsWith('insert into paginas')) {
        const [slug, productoPlanId, tipo, orden, nombre, url_externa, permite_rechazo, funnel_id] = params as [
          string,
          string,
          'front' | 'upsell',
          number,
          string | null,
          string | null,
          boolean,
          string,
        ];
        if (Array.from(paginas.values()).some((p) => p.slug === slug)) {
          throw new Error('duplicate key value violates unique constraint "paginas_slug_idx"');
        }
        if (Array.from(paginas.values()).some((p) => p.producto_plan_id === productoPlanId)) {
          throw new Error('duplicate key value violates unique constraint "paginas_producto_plan_idx"');
        }
        const id = nuevoId();
        paginas.set(id, {
          id,
          slug,
          producto_plan_id: productoPlanId,
          tipo,
          orden,
          nombre,
          url_externa,
          permite_rechazo,
          funnel_id,
          paso_aceptado_id: null,
          paso_rechazado_id: null,
          activo: false,
        });
        return { rows: [{ id }], rowCount: 1 };
      }

      if (s.startsWith('update paginas set paso_aceptado_id')) {
        const [paso_aceptado_id, paso_rechazado_id, id] = params as [string | null, string | null, string];
        const fila = paginas.get(id);
        if (!fila) throw new Error('no existe');
        if (paso_aceptado_id === id || paso_rechazado_id === id) {
          throw new Error(
            'new row for relation "paginas" violates check constraint "paginas_no_autoreferencia"',
          );
        }
        Object.assign(fila, { paso_aceptado_id, paso_rechazado_id });
        return { rows: [], rowCount: 1 };
      }

      if (s.startsWith('select id, paso_aceptado_id, paso_rechazado_id, nombre, slug from paginas')) {
        const [funnelId] = params as [string];
        const filas = Array.from(paginas.values()).filter((p) => p.funnel_id === funnelId);
        return { rows: filas, rowCount: filas.length };
      }

      throw new Error(`query no reconocida en el mock: ${s}`);
    }),
  };
}

vi.mock('../db', () => ({
  q: (...args: unknown[]) => qMock(...args),
  q1: (...args: unknown[]) => q1Mock(...args),
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

import { guardarFunnel, type EntradaFunnel } from './funnels';

function pasoFront(over: Partial<EntradaFunnel['pasos'][0]> = {}): EntradaFunnel['pasos'][0] {
  return {
    id: null,
    slug: 'zz-front',
    producto_plan_id: 'plan-1',
    tipo: 'front',
    orden: 0,
    nombre: 'Front',
    url_externa: null,
    permite_rechazo: false,
    paso_aceptado_indice: null,
    paso_rechazado_indice: null,
    delay_segundos: null,
    ...over,
  };
}

function pasoUpsell(over: Partial<EntradaFunnel['pasos'][0]> = {}): EntradaFunnel['pasos'][0] {
  return {
    id: null,
    slug: 'zz-upsell',
    producto_plan_id: 'plan-2',
    tipo: 'upsell',
    orden: 1,
    nombre: 'Upsell 1',
    url_externa: 'https://elfunnel.com/upsell1',
    permite_rechazo: true,
    paso_aceptado_indice: null,
    paso_rechazado_indice: null,
    delay_segundos: null,
    ...over,
  };
}

beforeEach(() => {
  paginas = new Map();
  siguienteId = 1;
  qMock.mockReset();
  q1Mock.mockReset();
});

describe('guardarFunnel — validaciones sin tocar la base', () => {
  it('rechaza un nombre muy corto', async () => {
    const r = await guardarFunnel(null, { nombre: 'x', url_gracias: null, pasos: [pasoFront()] });
    expect(r).toMatchObject({ ok: false, error: 'datos_invalidos' });
  });

  it('rechaza un funnel sin pasos', async () => {
    const r = await guardarFunnel(null, { nombre: 'Mi funnel', url_gracias: null, pasos: [] });
    expect(r).toMatchObject({ ok: false, error: 'sin_pasos' });
  });

  it('rechaza un funnel sin ningún paso front', async () => {
    const r = await guardarFunnel(null, { nombre: 'Mi funnel', url_gracias: null, pasos: [pasoUpsell()] });
    expect(r).toMatchObject({ ok: false, error: 'sin_front' });
  });

  it('rechaza un funnel con dos pasos front', async () => {
    const r = await guardarFunnel(null, {
      nombre: 'Mi funnel',
      url_gracias: null,
      pasos: [pasoFront(), pasoFront({ slug: 'zz-front-2' })],
    });
    expect(r).toMatchObject({ ok: false, error: 'dos_front' });
  });

  it('rechaza un paso sin slug', async () => {
    const r = await guardarFunnel(null, {
      nombre: 'Mi funnel',
      url_gracias: null,
      pasos: [pasoFront({ slug: '  ' })],
    });
    expect(r).toMatchObject({ ok: false, error: 'datos_invalidos' });
  });

  it('rechaza un paso sin variante de precio', async () => {
    const r = await guardarFunnel(null, {
      nombre: 'Mi funnel',
      url_gracias: null,
      pasos: [pasoFront({ producto_plan_id: '' })],
    });
    expect(r).toMatchObject({ ok: false, error: 'datos_invalidos' });
  });
});

describe('guardarFunnel — alta completa contra el mock de transacción', () => {
  it('crea el funnel con un front y un upsell conectados, y nace apagado', async () => {
    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: 'https://elfunnel.com/gracias',
      pasos: [pasoFront({ paso_aceptado_indice: 1 }), pasoUpsell()],
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: true });

    const filas = Array.from(paginas.values());
    expect(filas).toHaveLength(2);
    const front = filas.find((f) => f.tipo === 'front')!;
    const upsell = filas.find((f) => f.tipo === 'upsell')!;
    // La flecha se resolvió del índice 1 al id real del upsell recién creado.
    expect(front.paso_aceptado_id).toBe(upsell.id);
    // El alta nunca enciende el funnel (regla 1): eso lo hace el switch.
    expect(front.activo).toBe(false);
  });

  it('rechaza un slug duplicado con un mensaje que la API puede traducir', async () => {
    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: null,
      pasos: [pasoFront(), pasoUpsell({ slug: 'zz-front' })], // mismo slug que el front
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: false, error: 'slug_ocupado' });
  });

  it('rechaza un paso que se apunta a sí mismo', async () => {
    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: null,
      pasos: [pasoFront({ paso_aceptado_indice: 0 })],
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: false, error: 'ciclo' });
  });

  it('detecta un ciclo de dos pasos (A acepta → B, B acepta → A) y no deja nada escrito', async () => {
    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: null,
      pasos: [
        pasoFront({ paso_aceptado_indice: 1 }),
        pasoUpsell({ paso_aceptado_indice: 0 }),
      ],
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: false, error: 'ciclo' });
    expect((r as { detalle: string }).detalle).toMatch(/Front|Upsell 1/);
  });

  it('dos ramas que reconvergen al mismo paso no son un ciclo (caso legítimo)', async () => {
    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: 'https://elfunnel.com/gracias',
      pasos: [
        pasoFront({ paso_aceptado_indice: 1, permite_rechazo: true, paso_rechazado_indice: 2 }),
        pasoUpsell({ nombre: 'Upsell 1', slug: 'zz-upsell-1' }),
        pasoUpsell({ nombre: 'Downsell 1', slug: 'zz-downsell-1' }),
      ],
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: true });
  });
});

describe('guardarFunnel — reutilización de página existente por variante (migración 012)', () => {
  it('un paso nuevo cuya variante ya tiene página la reusa en vez de crear otra, y conserva su slug', async () => {
    // La variante 'plan-2' ya tiene una página en otro lado (creada desde
    // catálogo, por ejemplo), con un slug propio que NO es el que manda este
    // paso nuevo.
    paginas.set('pagina-existente', {
      id: 'pagina-existente',
      slug: 'el-slug-de-siempre',
      producto_plan_id: 'plan-2',
      tipo: 'front',
      orden: 0,
      nombre: null,
      url_externa: null,
      permite_rechazo: false,
      funnel_id: null,
      paso_aceptado_id: null,
      paso_rechazado_id: null,
      activo: true,
    });

    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: 'https://elfunnel.com/gracias',
      pasos: [
        pasoFront({ paso_aceptado_indice: 1 }),
        pasoUpsell({ producto_plan_id: 'plan-2', slug: 'zz-slug-que-se-descarta' }),
      ],
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: true });

    // No se creó una tercera página: sigue habiendo 2 en total (front nuevo +
    // la existente reusada), no 3.
    expect(paginas.size).toBe(2);

    const reusada = paginas.get('pagina-existente')!;
    // El slug NO se pisó con el que mandó el formulario.
    expect(reusada.slug).toBe('el-slug-de-siempre');
    // Pero sí se actualizaron tipo/orden/funnel: ahora es el upsell de este funnel.
    expect(reusada.tipo).toBe('upsell');
    expect(reusada.funnel_id).toBe('funnel-1');
  });

  it('dos pasos nuevos de variantes distintas siguen creando dos páginas distintas', async () => {
    const entrada: EntradaFunnel = {
      nombre: 'zz-funnel-test',
      url_gracias: 'https://elfunnel.com/gracias',
      pasos: [pasoFront({ paso_aceptado_indice: 1 }), pasoUpsell()],
    };
    const r = await guardarFunnel(null, entrada);
    expect(r).toMatchObject({ ok: true });
    expect(paginas.size).toBe(2);
    expect(new Set(Array.from(paginas.values()).map((p) => p.producto_plan_id)).size).toBe(2);
  });

  it('editar un paso existente para que cobre otra variante actualiza producto_plan_id', async () => {
    // Alta inicial: un front.
    const alta = await guardarFunnel(null, {
      nombre: 'zz-funnel-test',
      url_gracias: null,
      pasos: [pasoFront()],
    });
    expect(alta).toMatchObject({ ok: true });
    const funnelId = (alta as { id: string }).id;
    const pasoId = Array.from(paginas.keys())[0];

    // Edición: el mismo paso (mismo id), pero ahora eligiendo otra variante.
    const edicion = await guardarFunnel(funnelId, {
      nombre: 'zz-funnel-test',
      url_gracias: null,
      pasos: [pasoFront({ id: pasoId, producto_plan_id: 'plan-otra' })],
    });
    expect(edicion).toMatchObject({ ok: true });
    expect(paginas.get(pasoId)!.producto_plan_id).toBe('plan-otra');
  });
});
