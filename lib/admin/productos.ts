/**
 * Queries de `productos` para el panel: alta, listado, el selector de planes de
 * Whop y la comparación de precio de D10.
 *
 * `EntradaProducto` vive acá y no en `lib/tipos.ts` a propósito (§8 del plan):
 * es una forma que solo usa este panel, y ese archivo lo importan otras tres
 * tasks al mismo tiempo.
 */
import { q, q1 } from '../db';
import { listarPlanes, obtenerPlan, type PlanWhop } from '../whop';
import type { Producto } from '../tipos';

/** Lo que llega del formulario de alta/edición de producto. */
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

const COLS = `id, nombre, whop_plan_id, whop_product_id, whop_nombre_soft, precio, moneda,
       precio_anclaje, imagen_url, descripcion, activo, created_at, updated_at`;

export async function listarProductos(): Promise<Producto[]> {
  return q<Producto>(`select ${COLS} from productos order by created_at desc`);
}

export async function buscarProducto(id: string): Promise<Producto | null> {
  return q1<Producto>(`select ${COLS} from productos where id = $1`, [id]);
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
 * Alta de producto. `activo` no es parte de `EntradaProducto`: todo nace
 * inactivo (D14), y el switch para encenderlo vive en la pantalla de edición,
 * nunca en el alta.
 */
export async function crearProducto(datos: EntradaProducto): Promise<Producto> {
  const fila = await q1<Producto>(
    `insert into productos (nombre, whop_plan_id, whop_product_id, whop_nombre_soft, precio,
                            moneda, precio_anclaje, imagen_url, descripcion, activo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
     returning ${COLS}`,
    [
      datos.nombre,
      datos.whop_plan_id,
      datos.whop_product_id ?? null,
      datos.whop_nombre_soft ?? null,
      datos.precio,
      datos.moneda ?? 'usd',
      datos.precio_anclaje ?? null,
      datos.imagen_url ?? null,
      datos.descripcion ?? null,
    ],
  );
  // El insert siempre devuelve una fila (no hay ON CONFLICT que la pueda
  // suprimir); el `!` documenta esa garantía en vez de forzar un chequeo que
  // nunca puede fallar en el caller.
  return fila!;
}

/** Edición. No toca `activo`: el switch de encendido tiene su propia acción. */
export async function actualizarProducto(id: string, datos: EntradaProducto): Promise<Producto | null> {
  return q1<Producto>(
    `update productos
        set nombre = $1, whop_plan_id = $2, whop_product_id = $3, whop_nombre_soft = $4,
            precio = $5, moneda = $6, precio_anclaje = $7, imagen_url = $8, descripcion = $9,
            updated_at = now()
      where id = $10
      returning ${COLS}`,
    [
      datos.nombre,
      datos.whop_plan_id,
      datos.whop_product_id ?? null,
      datos.whop_nombre_soft ?? null,
      datos.precio,
      datos.moneda ?? 'usd',
      datos.precio_anclaje ?? null,
      datos.imagen_url ?? null,
      datos.descripcion ?? null,
      id,
    ],
  );
}

/**
 * El switch de activo. Separado de `actualizarProducto` porque encender un
 * producto es la acción que la UI pide confirmar (D14) y editar el nombre no.
 */
export async function setActivoProducto(id: string, activo: boolean): Promise<void> {
  await q('update productos set activo = $1, updated_at = now() where id = $2', [activo, id]);
}
