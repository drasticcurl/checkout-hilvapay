/**
 * CORS del endpoint de cobro one-click. Lo llama JS que corre en el dominio de
 * un funnel (`testfunnel`, etc.), así que es cross-origin de verdad, y el
 * token que viaja en el body habilita cobrar una tarjeta guardada: por eso
 * `Access-Control-Allow-Origin` NUNCA es `*`.
 *
 * Con `*` cualquier página del mundo que logre leer el token de una orden
 * (link compartido, historial de navegación, un XSS en cualquier sitio)
 * podría postearlo desde su propio origen y el navegador se lo dejaría leer.
 * Devolviendo el origen exacto y solo si está en la allowlist, un origen no
 * autorizado ni siquiera puede LEER la respuesta del error 403.
 */
import { q } from './db';
import type { Origen } from './tipos';

const CACHE_MS = 60_000;

let cache: { origenes: Set<string>; expiraEn: number } | null = null;

/**
 * Trae los orígenes activos, cacheados 60 segundos en memoria del proceso.
 *
 * Cada cobro hace un preflight (OPTIONS) más el POST: son dos consultas por
 * click contra una tabla que hoy tiene un puñado de filas. El cache evita
 * pegarle a Postgres dos veces por cada intento de compra sin ganar nada a
 * cambio, a costa de hasta 60s de demora en propagar un alta o baja de origen
 * — aceptable para una allowlist que no cambia todo el tiempo.
 */
async function origenesActivos(): Promise<Set<string>> {
  const ahora = Date.now();
  if (cache && cache.expiraEn > ahora) return cache.origenes;

  const filas = await q<Pick<Origen, 'origen'>>('select origen from origenes where activo', []);
  const origenes = new Set(filas.map((f) => f.origen));
  cache = { origenes, expiraEn: ahora + CACHE_MS };
  return origenes;
}

/**
 * Resuelve los headers de CORS para un origen dado.
 *
 * Devuelve `null` si el origen es nulo, vacío, o no está activo en `origenes`:
 * el caller responde 403 SIN estos headers, con lo cual el navegador tampoco
 * le deja al script leer el cuerpo de ese error — la doble barrera importa
 * porque un origen no autorizado que además pudiera leer el mensaje de error
 * tendría más información para reintentar de otra forma.
 *
 * La comparación es EXACTA (`Set.has`, no `startsWith` ni una regex de
 * subdominio). `https://mifunnel.com` y `https://mifunnel.com.evil.io`
 * comparten el prefijo pero son orígenes distintos; un `startsWith` los
 * confundiría y abriría el cobro a cualquiera que registre un dominio con el
 * nombre del funnel adelante.
 */
export async function headersCors(origen: string | null): Promise<Record<string, string> | null> {
  if (!origen) return null;

  const activos = await origenesActivos();
  if (!activos.has(origen)) return null;

  return {
    // El origen EXACTO que vino, nunca una lista ni `*`. Un header con varios
    // valores separados por coma no es válido para Access-Control-Allow-Origin
    // y los navegadores lo rechazan entero.
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Sin credentials: el token viaja en el body, no en una cookie. No hace
    // falta Access-Control-Allow-Credentials y agregarlo sin necesidad
    // ensancha la superficie para nada.
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
