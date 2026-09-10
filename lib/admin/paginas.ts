/**
 * Queries de `paginas`: los links de pago. Incluye la normalización de slug,
 * que es lo único no trivial de este archivo — un slug con una mayúscula o un
 * espacio genera un link que da 404 y nadie entiende por qué.
 */
import { q, q1 } from '../db';
import type { ConfigPagina, Pagina, PaginaConProducto } from '../tipos';

/** Lo que llega del formulario de alta/edición de un link de pago. */
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
 */
export function normalizarSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita los diacríticos, deja la letra base
    .replace(/[\s_]+/g, '-') // espacios y guion bajo → guion medio
    .replace(/[^a-z0-9-]/g, '') // descarta todo lo que no sea a-z0-9-
    .replace(/-+/g, '-') // colapsa guiones repetidos
    .replace(/^-+|-+$/g, ''); // recorta guiones al borde
}

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
