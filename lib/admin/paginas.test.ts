import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * El mock de `../db` vive a nivel de módulo (no dentro de un `describe`):
 * `vi.mock` se hoistea al tope del archivo, así que las variables que
 * referencia tienen que existir antes de que Vitest lo evalúe — declararlo
 * adentro de un bloque más profundo da `ReferenceError` porque el hoisting
 * mueve la llamada pero no las declaraciones que dependen de ella.
 *
 * `normalizarSlug` (los primeros tests de este archivo) es una función pura
 * que no toca `db` en absoluto, así que el mock no le afecta.
 */
let paginas: Map<string, { id: string }>;
let ordenes: Map<string, { id: string; pagina_id: string }>;
let cobros: Map<string, { id: string; pagina_id: string }>;

const qMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('select id from paginas where id = $1')) {
    const [id] = params as [string];
    const fila = paginas.get(id);
    return fila ? [fila] : [];
  }
  if (s.startsWith('select id from ordenes where pagina_id = $1')) {
    const [paginaId] = params as [string];
    return Array.from(ordenes.values())
      .filter((o) => o.pagina_id === paginaId)
      .map((o) => ({ id: o.id }));
  }
  if (s.startsWith('select id from cobros where pagina_id = $1')) {
    const [paginaId] = params as [string];
    return Array.from(cobros.values())
      .filter((c) => c.pagina_id === paginaId)
      .map((c) => ({ id: c.id }));
  }
  if (s.startsWith('delete from paginas where id = $1')) {
    const [id] = params as [string];
    paginas.delete(id);
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
}));

import { borrarPagina, normalizarSlug } from './paginas';

describe('normalizarSlug', () => {
  it('pasa a minúsculas y cambia espacios por guiones', () => {
    expect(normalizarSlug('Agua De Arroz 1')).toBe('agua-de-arroz-1');
  });

  it('recorta espacios al borde y cambia guion bajo por guion medio', () => {
    expect(normalizarSlug('  UPSELL_2  ')).toBe('upsell-2');
  });

  it('quita los diacríticos y conserva la letra base', () => {
    // Documentado: se le sacan los acentos en vez de descartar la letra, para
    // no dejar un slug irreconocible.
    expect(normalizarSlug('áéí')).toBe('aei');
  });

  it('descarta símbolos que no son a-z0-9-', () => {
    expect(normalizarSlug('¡Oferta!! 50% off')).toBe('oferta-50-off');
  });

  it('colapsa guiones repetidos', () => {
    expect(normalizarSlug('a---b')).toBe('a-b');
  });

  it('recorta guiones que quedan al borde', () => {
    expect(normalizarSlug('-hola-')).toBe('hola');
  });

  it('ya normalizado queda igual', () => {
    expect(normalizarSlug('aguadearroz1')).toBe('aguadearroz1');
  });

  it('un slug vacío o solo símbolos da string vacío', () => {
    expect(normalizarSlug('   ')).toBe('');
    expect(normalizarSlug('¡¡¡')).toBe('');
  });

  it('números se conservan tal cual', () => {
    expect(normalizarSlug('Upsell 3 - $17')).toBe('upsell-3-17');
  });
});

/**
 * `borrarPagina` — el bug reportado el 2026-09-15: `borrarProducto`
 * (`lib/admin/productos.ts`) rechaza con `tiene_links` en cuanto cualquier
 * página apunta al producto, y no existía ningún botón para borrar esa
 * página huérfana (sin funnel, sin cobros) y destrabar el mensaje. Estos
 * tests fijan el chequeo de seguridad de la función nueva.
 */
describe('borrarPagina', () => {
  beforeEach(() => {
    paginas = new Map([['pagina-1', { id: 'pagina-1' }]]);
    ordenes = new Map();
    cobros = new Map();
    qMock.mockClear();
    q1Mock.mockClear();
  });

  it('borra una página sin ninguna orden ni cobro', async () => {
    const r = await borrarPagina('pagina-1');
    expect(r).toMatchObject({ ok: true });
    expect(paginas.has('pagina-1')).toBe(false);
  });

  it('no borra una página con al menos una orden', async () => {
    ordenes.set('orden-1', { id: 'orden-1', pagina_id: 'pagina-1' });
    const r = await borrarPagina('pagina-1');
    expect(r).toMatchObject({ ok: false, error: 'tiene_ordenes' });
    expect(paginas.has('pagina-1')).toBe(true);
  });

  it('no borra una página con al menos un cobro, aunque no tenga ninguna orden registrada', async () => {
    cobros.set('cobro-1', { id: 'cobro-1', pagina_id: 'pagina-1' });
    const r = await borrarPagina('pagina-1');
    expect(r).toMatchObject({ ok: false, error: 'tiene_cobros' });
    expect(paginas.has('pagina-1')).toBe(true);
  });

  it('devuelve no_encontrada si la página no existe', async () => {
    const r = await borrarPagina('pagina-inexistente');
    expect(r).toMatchObject({ ok: false, error: 'no_encontrada' });
  });

  it('el chequeo de ordenes va ANTES que el de cobros: con las dos presentes, informa tiene_ordenes', async () => {
    // Mismo orden que la función real (ordenes primero, cobros después) —
    // fijado para que un reordenamiento futuro no cambie el mensaje sin que
    // un test lo marque.
    ordenes.set('orden-1', { id: 'orden-1', pagina_id: 'pagina-1' });
    cobros.set('cobro-1', { id: 'cobro-1', pagina_id: 'pagina-1' });
    const r = await borrarPagina('pagina-1');
    expect(r).toMatchObject({ ok: false, error: 'tiene_ordenes' });
  });
});
