/**
 * Queries de `origenes`: la allowlist de dominios de funnels autorizados a
 * disparar cobros one-click. Sin una fila activa acá, `POST /api/upsell/cobrar`
 * responde 403 (T04 lo lee para el CORS).
 */
import { q, q1 } from '../db';
import type { Origen } from '../tipos';

/** Lo que llega del formulario de alta de un dominio autorizado. */
export type EntradaOrigen = {
  origen: string;
  nombre?: string | null;
};

const COLS = `id, origen, nombre, activo, created_at`;

export async function listarOrigenes(): Promise<Origen[]> {
  return q<Origen>(`select ${COLS} from origenes order by created_at desc`);
}

/**
 * Quita la barra final. `origenes.origen` se compara byte a byte contra el
 * header `Origin` de un fetch cross-origin, que un browser nunca manda con
 * barra al final — si acá quedara una, el 403 sería permanente y no diría por
 * qué.
 */
function normalizarOrigen(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

/** Alta de un dominio autorizado. Nace inactivo (D14). */
export async function crearOrigen(datos: EntradaOrigen): Promise<Origen> {
  const fila = await q1<Origen>(
    `insert into origenes (origen, nombre, activo)
     values ($1, $2, false)
     returning ${COLS}`,
    [normalizarOrigen(datos.origen), datos.nombre ?? null],
  );
  return fila!;
}

/** El switch de activo. Encender esto es lo que habilita cobros reales desde ese dominio. */
export async function setActivoOrigen(id: string, activo: boolean): Promise<void> {
  await q('update origenes set activo = $1 where id = $2', [activo, id]);
}

export async function eliminarOrigen(id: string): Promise<void> {
  await q('delete from origenes where id = $1', [id]);
}
