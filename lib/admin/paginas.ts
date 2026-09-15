/**
 * Queries de `paginas`: los links de pago. Incluye la normalización de slug,
 * que es lo único no trivial de este archivo — un slug con una mayúscula o un
 * espacio genera un link que da 404 y nadie entiende por qué.
 *
 * Desde la migración 010, `paginas` tiene también `producto_plan_id` (qué
 * VARIANTE de precio cobra esa página) además de `producto_id` (que sigue
 * existiendo, not null, §3.2 del plan). `listarPaginasConProductoPlan` es la
 * query nueva que resuelve por esa columna — es la que consumen T02/T04/T05.
 * `listarPaginasConProducto` (la vieja, vía `producto_id` → `productos`) se
 * mantiene con su forma de siempre porque hoy la consume
 * `app/api/admin/paginas/route.ts`, que T01 tiene prohibido tocar (esa
 * pantalla entera es ownership de T03, que la borra — hasta que eso pase,
 * tiene que seguir compilando).
 */
import { q, q1 } from '../db';
import type { ConfigPagina, Pagina, PaginaConProducto, PaginaConProductoPlan } from '../tipos';
import { normalizarSlug } from './slug';

/** Lo que llega del formulario de alta/edición de un link de pago (forma vieja, vía producto_id). */
export type EntradaPagina = {
  slug: string;
  producto_id: string;
  tipo: 'front' | 'upsell';
  url_exito?: string | null;
  url_rechazo?: string | null;
  config?: ConfigPagina;
};

/**
 * Normaliza un slug a minúsculas, `a-z0-9-`, sin espacios.
 *
 * Reglas, documentadas porque el task las deja explícitamente a definir:
 *  - se recorta espacio al borde, y los espacios/guiones bajos internos se
 *    vuelven un solo guion medio;
 *  - todo a minúsculas;
 *  - los acentos se les quita el diacrítico (NFD + strip de combining marks)
 *    ANTES de filtrar: así 'áéí' se convierte en 'aei' en vez de desaparecer.
 *    Perder la vocal entera dejaría un slug irreconocible ('áéí' → '');
 *  - cualquier carácter que no sea `a-z0-9-` se descarta;
 *  - guiones repetidos o al borde se colapsan/recortan.
 *
 * `'Agua De Arroz 1'` → `'agua-de-arroz-1'`
 * `'  UPSELL_2  '`    → `'upsell-2'`
 * `'áéí'`             → `'aei'`
 *
 * La implementación real vive en `lib/admin/slug.ts` (puro, sin `pg`) — se
 * re-exporta acá para no romper ningún import existente (importado arriba,
 * junto al resto de los imports del archivo, para que las funciones de este
 * módulo también puedan usarla). Ver el comentario de cabecera de
 * `lib/admin/slug.ts` para el motivo del movimiento.
 */
export { normalizarSlug } from './slug';

const COLS = `id, slug, producto_id, tipo, url_exito, url_rechazo, config, activo,
       created_at, updated_at`;

export async function listarPaginas(): Promise<Pagina[]> {
  return q<Pagina>(`select ${COLS} from paginas order by created_at desc`);
}

export async function buscarPagina(id: string): Promise<Pagina | null> {
  return q1<Pagina>(`select ${COLS} from paginas where id = $1`, [id]);
}

/**
 * Igual que `PaginaConProducto` de `lib/tipos.ts`: la página con su producto
 * resuelto, para mostrar precio y nombre reales en la lista del panel sin un
 * segundo round-trip por fila.
 */
export async function listarPaginasConProducto(): Promise<PaginaConProducto[]> {
  const filas = await q<{
    id: string;
    slug: string;
    tipo: 'front' | 'upsell';
    url_exito: string | null;
    url_rechazo: string | null;
    config: ConfigPagina;
    activo: boolean;
    created_at: Date;
    updated_at: Date;
    producto: unknown;
  }>(
    `select pg.id, pg.slug, pg.tipo, pg.url_exito, pg.url_rechazo, pg.config, pg.activo,
            pg.created_at, pg.updated_at,
            json_build_object(
              'id', pr.id, 'nombre', pr.nombre, 'whop_plan_id', pr.whop_plan_id,
              'whop_product_id', pr.whop_product_id, 'whop_nombre_soft', pr.whop_nombre_soft,
              'precio', pr.precio, 'moneda', pr.moneda, 'precio_anclaje', pr.precio_anclaje,
              'imagen_url', pr.imagen_url, 'descripcion', pr.descripcion, 'activo', pr.activo,
              'created_at', pr.created_at, 'updated_at', pr.updated_at
            ) as producto
       from paginas pg
       join productos pr on pr.id = pg.producto_id
      order by pg.created_at desc`,
  );
  // `numeric` dentro de un json_build_object vuelve como number, no string
  // (postgres serializa numeric a JSON como literal numérico). Se corrige acá
  // para no romper la regla de lib/tipos.ts de que `precio` es siempre string.
  return filas.map((f) => ({
    ...f,
    producto: {
      ...(f.producto as Record<string, unknown>),
      precio: String((f.producto as Record<string, unknown>).precio),
      precio_anclaje:
        (f.producto as Record<string, unknown>).precio_anclaje == null
          ? null
          : String((f.producto as Record<string, unknown>).precio_anclaje),
    },
  })) as unknown as PaginaConProducto[];
}

/**
 * La página con su `producto_plan` resuelto (a través de `producto_plan_id`,
 * no de `producto_id`) — el tipo `PaginaConProductoPlan` de §4. Es lo que
 * consumen T02/T04/T05: reemplaza a `listarPaginasConProducto` en todo código
 * NUEVO. La resolución en dos pasos (`paginas.producto_plan_id →
 * producto_planes → productos`) es la misma que describe §3.4 del plan — nunca
 * se resuelve por `producto_id` directo, porque una página puede cobrar una
 * variante que no es la del producto "ganador" de su grupo tras la migración.
 *
 * Una página sin `producto_plan_id` (todavía no debería existir tras la
 * migración 010 — la fase B la resuelve para todas las filas existentes, y
 * toda página nueva la exige desde el editor) queda afuera del resultado: un
 * INNER JOIN y no LEFT, porque una página sin variante resuelta no es cobrable
 * y mostrarla sin precio es peor que no mostrarla.
 */
export async function listarPaginasConProductoPlan(): Promise<PaginaConProductoPlan[]> {
  const filas = await q<{
    id: string;
    slug: string;
    tipo: 'front' | 'upsell';
    url_exito: string | null;
    url_rechazo: string | null;
    config: ConfigPagina;
    activo: boolean;
    created_at: Date;
    updated_at: Date;
    producto_plan: unknown;
  }>(
    `select pg.id, pg.slug, pg.tipo, pg.url_exito, pg.url_rechazo, pg.config, pg.activo,
            pg.created_at, pg.updated_at,
            json_build_object(
              'id', pp.id, 'producto_id', pp.producto_id, 'whop_plan_id', pp.whop_plan_id,
              'whop_nombre_soft', pp.whop_nombre_soft, 'etiqueta', pp.etiqueta,
              'precio', pp.precio, 'moneda', pp.moneda, 'precio_anclaje', pp.precio_anclaje,
              'es_default', pp.es_default, 'activo', pp.activo,
              'created_at', pp.created_at, 'updated_at', pp.updated_at,
              'producto', json_build_object(
                'id', pr.id, 'nombre', pr.nombre, 'whop_product_id', pr.whop_product_id,
                'imagen_url', pr.imagen_url, 'descripcion', pr.descripcion, 'activo', pr.activo,
                'created_at', pr.created_at, 'updated_at', pr.updated_at
              )
            ) as producto_plan
       from paginas pg
       join producto_planes pp on pp.id = pg.producto_plan_id
       join productos pr on pr.id = pp.producto_id
      order by pg.created_at desc`,
  );
  // Mismo motivo que en listarPaginasConProducto: numeric dentro de un
  // json_build_object serializa como number, no string. Se corrige acá para
  // no romper la regla de lib/tipos.ts de que precio/precio_anclaje son
  // siempre string.
  return filas.map((f) => {
    const pp = f.producto_plan as Record<string, unknown>;
    return {
      ...f,
      producto_plan: {
        ...pp,
        precio: String(pp.precio),
        precio_anclaje: pp.precio_anclaje == null ? null : String(pp.precio_anclaje),
      },
    };
  }) as unknown as PaginaConProductoPlan[];
}

/** Alta de link de pago. Nace inactivo (D14): el slug se normaliza antes de guardar. */
export async function crearPagina(datos: EntradaPagina): Promise<Pagina> {
  const slug = normalizarSlug(datos.slug);
  const fila = await q1<Pagina>(
    `insert into paginas (slug, producto_id, tipo, url_exito, url_rechazo, config, activo)
     values ($1, $2, $3, $4, $5, $6::jsonb, false)
     returning ${COLS}`,
    [
      slug,
      datos.producto_id,
      datos.tipo,
      datos.url_exito ?? null,
      datos.url_rechazo ?? null,
      JSON.stringify(datos.config ?? {}),
    ],
  );
  return fila!;
}

/** Edición. No toca `activo`: ver `setActivoPagina`. */
export async function actualizarPagina(id: string, datos: EntradaPagina): Promise<Pagina | null> {
  const slug = normalizarSlug(datos.slug);
  return q1<Pagina>(
    `update paginas
        set slug = $1, producto_id = $2, tipo = $3, url_exito = $4, url_rechazo = $5,
            config = $6::jsonb, updated_at = now()
      where id = $7
      returning ${COLS}`,
    [
      slug,
      datos.producto_id,
      datos.tipo,
      datos.url_exito ?? null,
      datos.url_rechazo ?? null,
      JSON.stringify(datos.config ?? {}),
      id,
    ],
  );
}

/**
 * El switch de activo. Apagar es siempre seguro y no pide nada extra; la
 * confirmación al ENCENDER la hace la UI (D14 / regla 2 del §4 del task), no
 * esta función — acá solo se escribe lo que ya se decidió.
 */
export async function setActivoPagina(id: string, activo: boolean): Promise<void> {
  await q('update paginas set activo = $1, updated_at = now() where id = $2', [activo, id]);
}

export type ResultadoBorradoPagina =
  | { ok: true }
  | { ok: false; error: 'no_encontrada' | 'tiene_ordenes' | 'tiene_cobros' };

/**
 * Borra una página (un link de pago) de verdad — irreversible, a diferencia
 * del switch de arriba.
 *
 * Encontrada la falta de esto en el bug reportado el 2026-09-15: `borrarProducto`
 * (`lib/admin/productos.ts`) rechaza con `tiene_links` en cuanto CUALQUIER
 * página apunta al producto, y su propio mensaje de error dice la salida
 * ("borrá primero sus links") — pero no existía ningún botón para borrar una
 * página sola. Es un callejón sin salida real: sacar un paso de un funnel o
 * borrar el funnel entero (`borrarFunnel`, `lib/admin/funnels.ts`) NO borra la
 * página — la deja huérfana y viva, a propósito, para no perder el historial
 * de cobros de un paso que se sacó del flujo. El resultado práctico es que casi
 * todo producto que alguna vez tuvo un paso en un funnel queda imposible de
 * borrar, aunque ese funnel ya no exista.
 *
 * El chequeo es el mismo espíritu que `borrarProducto`: `ordenes.pagina_id` y
 * `cobros.pagina_id` son `references ... not null` SIN cascada (§ ver
 * `db/migrations/001_init.sql`), así que la base ya lo impediría con un 500 de
 * constraint violada — esto chequea antes para devolver un error que la
 * pantalla pueda explicar.
 *
 * Las tres columnas de flechas del grafo (`paso_aceptado_id`,
 * `paso_rechazado_id`, `downsell_por_fondos_id`) son `on delete set null`
 * (migraciones 003 y 014): un paso que apuntaba a esta página como destino
 * queda con esa flecha en null, no roto — el operador lo ve en el editor como
 * "sin destino" y lo puede reconfigurar, en vez de que el borrado falle por
 * eso.
 */
export async function borrarPagina(id: string): Promise<ResultadoBorradoPagina> {
  const existe = await q1<{ id: string }>('select id from paginas where id = $1', [id]);
  if (!existe) return { ok: false, error: 'no_encontrada' };

  const tieneOrdenes = await q1<{ id: string }>('select id from ordenes where pagina_id = $1 limit 1', [id]);
  if (tieneOrdenes) return { ok: false, error: 'tiene_ordenes' };

  const tieneCobros = await q1<{ id: string }>('select id from cobros where pagina_id = $1 limit 1', [id]);
  if (tieneCobros) return { ok: false, error: 'tiene_cobros' };

  await q('delete from paginas where id = $1', [id]);
  return { ok: true };
}
