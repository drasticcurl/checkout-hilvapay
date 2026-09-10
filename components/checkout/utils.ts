/**
 * Funciones puras de la página de checkout: nada de base ni de red, para que
 * se puedan probar sin cobrarle a nadie (T03 §8). Viven acá y no en `lib/`
 * porque son propias de esta task; `lib/` es de T01 salvo lo explícitamente
 * asignado.
 */

/** UUID v4/v5 genérico — no valida versión, solo la forma. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza el email que se le prefill al embed y que se usa para la entrega:
 * sin espacios en los bordes y en minúsculas. No se "arregla" nada más (no se
 * valida el dominio, no se corrigen typos): eso es trabajo de zod en el
 * endpoint, esto es solo la forma canónica del string.
 */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * `sessionId`/`visitorId` llegan del funnel por querystring, sin control
 * nuestro. Si no son un UUID válido se descartan a `null` en vez de rechazar
 * el request (perder una venta por un dato de tracking no vale la pena) o de
 * inventar uno (crearía una sesión fantasma en el dashboard-admin).
 */
export function comoUuidONull(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return UUID_RE.test(valor) ? valor : null;
}

/**
 * true cuando nombre y email alcanzan para habilitar el botón de comprar.
 * Un nombre de una sola letra no es "vacío" pero tampoco es un nombre: exigir
 * 2+ caracteres filtra el caso de alguien que apoya el dedo en el teclado sin
 * bloquear nombres cortos reales. El email se valida con el mismo patrón
 * simple que usa el endpoint (la validación fuerte es zod, del lado server).
 */
export function datosCompletos(nombre: string, email: string): boolean {
  const nombreOk = nombre.trim().length >= 2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return nombreOk && emailOk;
}

/**
 * Agrega `?ot=<token>` (y opcionalmente `&r=1`) a la URL de éxito RESPETANDO
 * el querystring que ya tenga. `new URL` + `searchParams.set`, nunca
 * concatenación con `?`: si `urlExito` ya trae `?utm_source=fb`, concatenar a
 * mano la rompe (quedaría `?utm_source=fb?ot=...`, un solo query param
 * ilegible para el servidor de destino).
 */
export function armarUrlConToken(urlExito: string, token: string, recuperacion = false): string {
  const url = new URL(urlExito);
  url.searchParams.set('ot', token);
  if (recuperacion) url.searchParams.set('r', '1');
  return url.toString();
}

/**
 * `productos.precio` es `numeric(10,2)` y el driver `pg` lo devuelve como
 * string ('9.90', NO 9.9). Formatearlo a mano evita el bug de mostrar '$9.9'
 * cuando el precio real es '$9.90' — que rompe la promesa de precio de la
 * landing.
 */
export function formatearPrecio(precio: string, moneda: string): string {
  const n = Number(precio);
  const monto = Number.isFinite(n) ? n.toFixed(2) : precio;
  const simbolo = moneda.toLowerCase() === 'usd' ? '$' : `${moneda.toUpperCase()} `;
  return `${simbolo}${monto}`;
}
