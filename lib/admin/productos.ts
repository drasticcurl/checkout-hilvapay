/**
 * Queries de `productos` para el panel: alta, listado, el selector de planes de
 * Whop y la comparación de precio de D10.
 *
 * Desde la migración 010 (`producto_planes`), un producto puede tener MÁS de un
 * precio cobrable — ver `00-PLAN-PANEL-CATALOGO-FUNNELS.md` §0-§4. Este archivo
 * tiene dos capas:
 *
 *  1. Las funciones NUEVAS (`listarProductosConPlanes`, `buscarProductoConPlanes`,
 *     `crearProductoConPlan`, `agregarPlanAProducto`, `setPlanDefault`,
 *     `actualizarPlan`) — el contrato de §4 de T01, que consumen T02-T05.
 *  2. Las funciones VIEJAS (`listarProductos`, `buscarProducto`, `crearProducto`,
 *     `actualizarProducto`) — se MANTIENEN con su forma de salida de siempre
 *     (`Producto` con `.precio`/`.whop_plan_id` resueltos desde la variante
 *     DEFAULT del producto) porque hoy las consumen pantallas de `app/` que son
 *     ownership de otras tasks de este módulo (T02, T03) y que T01 tiene
 *     prohibido tocar. Migrar esas pantallas a `ProductoConPlanes` es trabajo de
 *     esas tasks, no de esta — hasta que eso pase, romper la forma de estas
 *     funciones rompe `tsc` en archivos que T01 no puede escribir.
 *
 * `EntradaProducto` vive acá y no en `lib/tipos.ts` a propósito (§8 del plan):
 * es una forma que solo usa este panel, y ese archivo lo importan otras tres
 * tasks al mismo tiempo.
 */
import { q, q1, tx } from '../db';
import { listarPlanes, obtenerPlan, type PlanWhop } from '../whop';
import type { Producto, ProductoConPlanes, ProductoPlan } from '../tipos';

/** Lo que llega del formulario de alta/edición de producto (forma vieja, un plan). */
export type EntradaProducto = {
  nombre: string;
  whop_plan_id: string;
  whop_product_id?: string | null;
  whop_nombre_soft?: string | null;
  precio: string;
  moneda?: string;
  precio_anclaje?: string | null;
  imagen_url?: string | null;
  descripcion?: string | null;
};

/** Columnas de `productos` según el tipo `Producto` nuevo (sin precio propio). */
const COLS_PRODUCTO = `id, nombre, whop_product_id, imagen_url, descripcion, activo, created_at, updated_at`;

const COLS_PLAN = `id, producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio, moneda,
       precio_anclaje, es_default, activo, created_at, updated_at`;

/**
 * Fila combinada `productos` + su variante DEFAULT, tal como la necesitan las
 * funciones "viejas" de este archivo — que hoy asumen "un producto, un
 * precio". Un producto migrado desde la 010 siempre tiene exactamente una
 * default (el índice `producto_planes_un_default_idx` lo garantiza), así que
 * este join nunca duplica ni pierde filas.
 */
type FilaProductoConDefault = {
  id: string;
  nombre: string;
  whop_product_id: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
  whop_plan_id: string;
  whop_nombre_soft: string | null;
  precio: string;
  moneda: string;
  precio_anclaje: string | null;
};

const SELECT_PRODUCTO_CON_DEFAULT = `
  select pr.id, pr.nombre, pr.whop_product_id, pr.imagen_url, pr.descripcion, pr.activo,
         pr.created_at, pr.updated_at,
         pp.whop_plan_id, pp.whop_nombre_soft, pp.precio, pp.moneda, pp.precio_anclaje
    from productos pr
    join producto_planes pp on pp.producto_id = pr.id and pp.es_default
`;

/** Forma que devuelven las funciones viejas: `Producto` con el precio de su variante default aplanado. */
type ProductoConPrecioLegacy = Producto & {
  whop_plan_id: string;
  whop_nombre_soft: string | null;
  precio: string;
  moneda: string;
  precio_anclaje: string | null;
};

function filaAProductoLegacy(f: FilaProductoConDefault): ProductoConPrecioLegacy {
  return {
    id: f.id,
    nombre: f.nombre,
    whop_product_id: f.whop_product_id,
    imagen_url: f.imagen_url,
    descripcion: f.descripcion,
    activo: f.activo,
    created_at: f.created_at,
    updated_at: f.updated_at,
    whop_plan_id: f.whop_plan_id,
    whop_nombre_soft: f.whop_nombre_soft,
    precio: f.precio,
    moneda: f.moneda,
    precio_anclaje: f.precio_anclaje,
  };
}

// ── Funciones viejas — forma de salida SIN CAMBIOS, resueltas vía producto_planes ──

/**
 * Lista los productos con el precio de su variante default aplanado.
 *
 * Nota de migración: las pantallas nuevas (T02) tienen que migrar a
 * `listarProductosConPlanes`; `app/admin/(panel)/productos/page.tsx` sigue
 * leyendo esta forma hasta que esa task la actualice, así que esta función no
 * cambia de forma en T01.
 */
export async function listarProductos(): Promise<ProductoConPrecioLegacy[]> {
  const filas = await q<FilaProductoConDefault>(`${SELECT_PRODUCTO_CON_DEFAULT} order by pr.created_at desc`);
  return filas.map(filaAProductoLegacy);
}

/** Un producto por id, con el precio de su variante default aplanado. */
export async function buscarProducto(id: string): Promise<ProductoConPrecioLegacy | null> {
  const fila = await q1<FilaProductoConDefault>(`${SELECT_PRODUCTO_CON_DEFAULT} where pr.id = $1`, [id]);
  return fila ? filaAProductoLegacy(fila) : null;
}

/**
 * Trae los planes de Whop para el selector.
 *
 * Devuelve `[]` y loguea si la API falla — nunca tira. El panel tiene que dejar
 * pegar el `plan_id` a mano igual: un selector que no carga no puede ser el
 * único camino para asociar un producto (P-01/P-09 del plan: el path de
 * `GET /plans` no estaba verificado cuando se escribió `lib/whop.ts`).
 */
export async function planesDisponibles(): Promise<{ planes: PlanWhop[]; error: string | null }> {
  try {
    const planes = await listarPlanes();
    return { planes, error: null };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error('[admin/productos] no se pudieron listar los planes de Whop:', mensaje);
    return { planes: [], error: mensaje };
  }
}

/**
 * Compara el precio de display con el precio real del plan de Whop (D10).
 *
 * Devuelve `null` cuando no se pudo consultar el plan — NUNCA `{ coincide: true
 * }` en ese caso: un "todo bien" falso es exactamente cómo se publica un link
 * que dice $9.90 y cobra $17.
 *
 * La comparación es sobre strings normalizados con `toFixed(2)`, no `===` de
 * floats: `9.90` y `9.9` tienen que dar igual, y `9.90` y `9.09` no.
 */
export async function verificarPrecio(
  planId: string,
  precioMostrado: string,
): Promise<{ coincide: boolean; precioReal: string; moneda: string } | null> {
  if (!planId) return null;
  try {
    const plan = await obtenerPlan(planId);
    const real = Number(plan.initial_price).toFixed(2);
    const mostrado = Number(precioMostrado).toFixed(2);
    return { coincide: real === mostrado, precioReal: real, moneda: plan.currency };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error(`[admin/productos] no se pudo verificar el plan ${planId}:`, mensaje);
    return null;
  }
}

/**
 * Alta de producto CON su primera variante, en una transacción — reemplaza al
 * viejo insert directo en `productos.whop_plan_id`. `activo` no es parte de
 * `EntradaProducto`: todo nace inactivo (D14), y el switch para encenderlo vive
 * en la pantalla de edición, nunca en el alta.
 */
export async function crearProducto(datos: EntradaProducto): Promise<ProductoConPrecioLegacy> {
  return tx(async (c) => {
    const prod = await c.query<{
      id: string;
      nombre: string;
      whop_product_id: string | null;
      imagen_url: string | null;
      descripcion: string | null;
      activo: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `insert into productos (nombre, whop_product_id, imagen_url, descripcion, activo)
       values ($1, $2, $3, $4, false)
       returning id, nombre, whop_product_id, imagen_url, descripcion, activo, created_at, updated_at`,
      [datos.nombre, datos.whop_product_id ?? null, datos.imagen_url ?? null, datos.descripcion ?? null],
    );
    const p = prod.rows[0];

    const plan = await c.query<{
      whop_plan_id: string;
      whop_nombre_soft: string | null;
      precio: string;
      moneda: string;
      precio_anclaje: string | null;
    }>(
      `insert into producto_planes (producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio,
                                    moneda, precio_anclaje, es_default, activo)
       values ($1, $2, $3, 'Precio completo', $4, $5, $6, true, false)
       returning whop_plan_id, whop_nombre_soft, precio, moneda, precio_anclaje`,
      [
        p.id,
        datos.whop_plan_id,
        datos.whop_nombre_soft ?? null,
        datos.precio,
        datos.moneda ?? 'usd',
        datos.precio_anclaje ?? null,
      ],
    );
    const pl = plan.rows[0];

    return filaAProductoLegacy({ ...p, ...pl });
  });
}

/**
 * Edición de producto + su variante default, en una transacción. No toca
 * `activo`: el switch de encendido tiene su propia acción.
 */
export async function actualizarProducto(
  id: string,
  datos: EntradaProducto,
): Promise<ProductoConPrecioLegacy | null> {
  return tx(async (c) => {
    const prod = await c.query<{
      id: string;
      nombre: string;
      whop_product_id: string | null;
      imagen_url: string | null;
      descripcion: string | null;
      activo: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `update productos
          set nombre = $1, whop_product_id = $2, imagen_url = $3, descripcion = $4, updated_at = now()
        where id = $5
        returning id, nombre, whop_product_id, imagen_url, descripcion, activo, created_at, updated_at`,
      [datos.nombre, datos.whop_product_id ?? null, datos.imagen_url ?? null, datos.descripcion ?? null, id],
    );
    if (prod.rows.length === 0) return null;
    const p = prod.rows[0];

    const plan = await c.query<{
      whop_plan_id: string;
      whop_nombre_soft: string | null;
      precio: string;
      moneda: string;
      precio_anclaje: string | null;
    }>(
      `update producto_planes
          set whop_plan_id = $1, whop_nombre_soft = $2, precio = $3, moneda = $4, precio_anclaje = $5,
              updated_at = now()
        where producto_id = $6 and es_default
        returning whop_plan_id, whop_nombre_soft, precio, moneda, precio_anclaje`,
      [
        datos.whop_plan_id,
        datos.whop_nombre_soft ?? null,
        datos.precio,
        datos.moneda ?? 'usd',
        datos.precio_anclaje ?? null,
        id,
      ],
    );
    if (plan.rows.length === 0) return null;
    const pl = plan.rows[0];

    return filaAProductoLegacy({ ...p, ...pl });
  });
}

/**
 * El switch de activo. Sigue siendo el switch de `productos.activo`, que es
 * del producto entero, no de una variante puntual.
 */
export async function setActivoProducto(id: string, activo: boolean): Promise<void> {
  await q('update productos set activo = $1, updated_at = now() where id = $2', [activo, id]);
}

// ── Funciones nuevas — el contrato de §4 de T01 ─────────────────────────────

/** Agrupa filas planas `producto + plan` en `ProductoConPlanes[]`, conservando el orden de aparición. */
function agruparEnProductoConPlanes(
  filasProducto: Producto[],
  filasPlan: ProductoPlan[],
): ProductoConPlanes[] {
  const planesPorProducto = new Map<string, ProductoPlan[]>();
  for (const pl of filasPlan) {
    const lista = planesPorProducto.get(pl.producto_id) ?? [];
    lista.push(pl);
    planesPorProducto.set(pl.producto_id, lista);
  }
  return filasProducto.map((pr) => ({ ...pr, planes: planesPorProducto.get(pr.id) ?? [] }));
}

/** Lista los productos con TODAS sus variantes de precio ya resueltas. */
export async function listarProductosConPlanes(): Promise<ProductoConPlanes[]> {
  const productos = await q<Producto>(`select ${COLS_PRODUCTO} from productos order by created_at desc`);
  if (productos.length === 0) return [];
  const planes = await q<ProductoPlan>(
    `select ${COLS_PLAN} from producto_planes where producto_id = any($1::uuid[]) order by es_default desc, created_at asc`,
    [productos.map((p) => p.id)],
  );
  return agruparEnProductoConPlanes(productos, planes);
}

/** Un producto con sus planes, o null. Para la ficha de edición (T02). */
export async function buscarProductoConPlanes(id: string): Promise<ProductoConPlanes | null> {
  const producto = await q1<Producto>(`select ${COLS_PRODUCTO} from productos where id = $1`, [id]);
  if (!producto) return null;
  const planes = await q<ProductoPlan>(
    `select ${COLS_PLAN} from producto_planes where producto_id = $1 order by es_default desc, created_at asc`,
    [id],
  );
  return { ...producto, planes };
}

/**
 * Alta de un producto NUEVO con su primera variante (es_default = true).
 * Reemplaza a crearProducto: ya no tiene sentido crear un producto sin al
 * menos una variante de precio, porque un producto sin plan no es cobrable.
 *
 * Nace inactivo (D14): ni el producto ni su plan encienden nada por sí solos.
 */
export async function crearProductoConPlan(datos: {
  nombre: string;
  imagen_url?: string | null;
  descripcion?: string | null;
  whop_product_id?: string | null;
  plan: {
    whop_plan_id: string;
    whop_nombre_soft?: string | null;
    etiqueta?: string;
    precio: string;
    moneda?: string;
    precio_anclaje?: string | null;
  };
}): Promise<ProductoConPlanes> {
  return tx(async (c) => {
    const prod = await c.query<Producto>(
      `insert into productos (nombre, whop_product_id, imagen_url, descripcion, activo)
       values ($1, $2, $3, $4, false)
       returning ${COLS_PRODUCTO}`,
      [datos.nombre, datos.whop_product_id ?? null, datos.imagen_url ?? null, datos.descripcion ?? null],
    );
    const producto = prod.rows[0];

    try {
      const plan = await c.query<ProductoPlan>(
        `insert into producto_planes (producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio,
                                      moneda, precio_anclaje, es_default, activo)
         values ($1, $2, $3, $4, $5, $6, $7, true, false)
         returning ${COLS_PLAN}`,
        [
          producto.id,
          datos.plan.whop_plan_id,
          datos.plan.whop_nombre_soft ?? null,
          datos.plan.etiqueta ?? 'Precio completo',
          datos.plan.precio,
          datos.plan.moneda ?? 'usd',
          datos.plan.precio_anclaje ?? null,
        ],
      );
      return { ...producto, planes: [plan.rows[0]] };
    } catch (err) {
      // El mismo patrón de mensaje legible que ya usa vincularPlan en
      // lib/admin/catalogo.ts: el UNIQUE VIOLATION crudo de postgres no le
      // dice nada útil a la pantalla.
      const mensaje = err instanceof Error ? err.message : String(err);
      if (/producto_planes_whop_plan_idx/.test(mensaje)) {
        throw new Error('plan_ya_vinculado');
      }
      throw err;
    }
  });
}

/**
 * Agrega una variante de precio a un producto YA EXISTENTE. Es lo que usa la
 * ficha de edición (T02) cuando el operador quiere sumar un downsell al mismo
 * access_pass. `es_default` nunca se manda true acá — la regla del índice
 * `producto_planes_un_default_idx` (§3.3 del plan) es que solo la primera
 * variante de un producto nace default; agregar una segunda no cambia cuál lo
 * es. Si el caller quiere cambiar la default, usa `setPlanDefault`, para que el
 * cambio sea explícito.
 */
export async function agregarPlanAProducto(
  productoId: string,
  plan: {
    whop_plan_id: string;
    whop_nombre_soft?: string | null;
    etiqueta: string;
    precio: string;
    moneda?: string;
    precio_anclaje?: string | null;
  },
): Promise<ProductoPlan> {
  try {
    const fila = await q1<ProductoPlan>(
      `insert into producto_planes (producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio,
                                    moneda, precio_anclaje, es_default, activo)
       values ($1, $2, $3, $4, $5, $6, $7, false, false)
       returning ${COLS_PLAN}`,
      [
        productoId,
        plan.whop_plan_id,
        plan.whop_nombre_soft ?? null,
        plan.etiqueta,
        plan.precio,
        plan.moneda ?? 'usd',
        plan.precio_anclaje ?? null,
      ],
    );
    // El insert siempre devuelve una fila salvo que el índice único rechace
    // (y ahí tira, no vuelve null) — el `!` documenta esa garantía.
    return fila!;
  } catch (err) {
    // El índice único de producto_planes_whop_plan_idx lo garantiza en la
    // base, pero un UNIQUE VIOLATION crudo no le dice a la pantalla qué pasó:
    // se traduce al mismo error legible que usa vincularPlan.
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/producto_planes_whop_plan_idx/.test(mensaje)) {
      throw new Error('plan_ya_vinculado');
    }
    throw err;
  }
}

/**
 * Cambia cuál variante es la default. Solo una a la vez (índice parcial):
 * primero se apaga la default vieja y recién después se prende la nueva —
 * invertir el orden pisaría el índice único `producto_planes_un_default_idx`
 * a mitad de camino (dos default a la vez, aunque sea por una sola query).
 */
export async function setPlanDefault(productoPlanId: string): Promise<void> {
  await tx(async (c) => {
    const fila = await c.query<{ producto_id: string }>(
      'select producto_id from producto_planes where id = $1',
      [productoPlanId],
    );
    if (fila.rows.length === 0) throw new Error('no existe ese plan');
    const productoId = fila.rows[0].producto_id;

    await c.query(
      'update producto_planes set es_default = false, updated_at = now() where producto_id = $1 and es_default',
      [productoId],
    );
    await c.query('update producto_planes set es_default = true, updated_at = now() where id = $1', [
      productoPlanId,
    ]);
  });
}

/** Edita una variante puntual (precio, etiqueta, precio_anclaje). NO su whop_plan_id: cambiarlo es borrar y crear otra, no editar. */
export async function actualizarPlan(
  productoPlanId: string,
  datos: { etiqueta?: string; precio?: string; precio_anclaje?: string | null },
): Promise<ProductoPlan | null> {
  const actual = await q1<ProductoPlan>(`select ${COLS_PLAN} from producto_planes where id = $1`, [
    productoPlanId,
  ]);
  if (!actual) return null;

  return q1<ProductoPlan>(
    `update producto_planes
        set etiqueta = $1, precio = $2, precio_anclaje = $3, updated_at = now()
      where id = $4
      returning ${COLS_PLAN}`,
    [
      datos.etiqueta ?? actual.etiqueta,
      datos.precio ?? actual.precio,
      datos.precio_anclaje !== undefined ? datos.precio_anclaje : actual.precio_anclaje,
      productoPlanId,
    ],
  );
}
