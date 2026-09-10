/**
 * La sesión del panel. Un solo usuario, un solo password.
 *
 * Mismo formato de token que `dashboard-admin/middleware.ts`: `id.ts.hmac_hex`,
 * con HMAC-SHA256 sobre `id.ts`. Se copió a propósito para que los dos paneles se
 * lean igual, pero **la cookie tiene otro nombre**: son dominios distintos y
 * sesiones distintas, y compartir el nombre haría que entrar a uno pise la del
 * otro cuando alguna vez vivan bajo el mismo dominio.
 *
 * ── Por qué crypto.subtle y no node:crypto ──────────────────────────────────
 * Este módulo lo importa `middleware.ts`, que corre en el runtime **edge**, donde
 * `node:crypto` no existe. Con `createHmac` el panel queda inaccesible con un
 * error de runtime que no menciona crypto y cuesta media hora entender. Web
 * Crypto está en los dos runtimes, así que este archivo sirve para los dos.
 */

/** Nombre de la cookie. Distinto al del dashboard-admin, a propósito. */
export const COOKIE_SESION = 'checkout_panel';

/**
 * Días que vive una sesión.
 *
 * El `dashboard-admin` usa 12 horas. Acá son 7 días: este panel se usa a ratos
 * (se configura un link y no se vuelve por días), y un login cada vez sería
 * fricción sin ganancia. No son 30 porque la cookie de este panel puede prender
 * un link de pago: cuanto menos vive, menos vale robada.
 *
 * T02 lo usa para el `Max-Age` de la cookie. Bajarlo es cambiar este número.
 */
export const DIAS_SESION = 7;

const TTL_MS = DIAS_SESION * 24 * 60 * 60 * 1000;

/**
 * Tolerancia hacia el futuro. Un reloj adelantado en el server que firma no
 * puede invalidar la cookie que acaba de emitir.
 */
const DERIVA_MS = 60_000;

/** El id del único usuario. Numérico para que el formato sea idéntico al del panel. */
const ID_ADMIN = '1';

function secreto(): string | null {
  // PANEL_SESSION_SECRET con default al password: así funciona sin configurar
  // dos variables, pero con la consecuencia de que cambiar el password invalida
  // las sesiones. Es el mismo criterio que el dashboard-admin.
  return process.env.PANEL_SESSION_SECRET || process.env.PANEL_PASSWORD || null;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compara en tiempo constante. Web Crypto no expone `timingSafeEqual`, así que
 * esto es lo mejor disponible en edge: el XOR acumulado no corta en el primer
 * byte distinto, que es lo que filtraría cuántos caracteres se acertaron.
 */
function igualConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Firma un token de sesión: `1.<unix_ms>.<hmac_hex>`.
 *
 * El timestamp va DENTRO de lo firmado. Si estuviera afuera como campo aparte de
 * la cookie, cualquiera podría estirarle el vencimiento a un token viejo sin
 * invalidar la firma.
 */
export async function firmarSesion(ahora: Date = new Date()): Promise<string> {
  const s = secreto();
  if (!s) throw new Error('PANEL_SESSION_SECRET / PANEL_PASSWORD no están configuradas');
  const ts = String(ahora.getTime());
  return `${ID_ADMIN}.${ts}.${await hmacHex(s, `${ID_ADMIN}.${ts}`)}`;
}

/**
 * Verifica un token. Devuelve `false` ante cualquier duda y **nunca tira**: la
 * llama el middleware en cada request, y una excepción ahí es un 500 en toda
 * ruta protegida.
 */
export async function verificarSesion(
  token: string | undefined | null,
  ahora: Date = new Date(),
): Promise<boolean> {
  if (!token) return false;
  const s = secreto();
  if (!s) return false;

  // Exactamente tres campos. Con un `split` laxo, un token de dos campos haría
  // que el timestamp se lea como id y la firma como timestamp.
  const partes = token.split('.');
  if (partes.length !== 3) return false;
  const [id, ts, sig] = partes;

  // `/^\d+$/` y no `Number()`: `Number('7e2')` es 700 y `Number(' 7')` es 7, así
  // que dos strings distintos darían el mismo valor con firmas distintas.
  if (!/^\d+$/.test(id) || !/^\d+$/.test(ts)) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  if (id !== ID_ADMIN) return false;

  const t = Number(ts);
  const now = ahora.getTime();
  if (now - t > TTL_MS) return false;
  if (t - now > DERIVA_MS) return false;

  return igualConstante(sig, await hmacHex(s, `${id}.${ts}`));
}

/**
 * Compara el password del login con `PANEL_PASSWORD`, en tiempo constante sobre
 * el HMAC de los dos.
 *
 * Se comparan los HMAC y no los strings porque así el largo del password real no
 * se filtra por el largo de la comparación: los dos digest miden siempre 64
 * caracteres.
 *
 * **Sin `PANEL_PASSWORD` configurada devuelve `false` siempre.** Nunca `true`: un
 * panel que puede cobrar tarjetas y deja entrar a cualquiera porque falta una
 * variable de entorno es peor que un panel al que nadie puede entrar.
 */
export async function passwordCorrecta(intento: string): Promise<boolean> {
  const real = process.env.PANEL_PASSWORD;
  if (!real) {
    console.error('[auth] PANEL_PASSWORD no está configurada: no se deja entrar a nadie');
    return false;
  }
  if (typeof intento !== 'string' || intento.length === 0) return false;

  // Se usa el propio password como clave del HMAC de comparación: alcanza para
  // que los dos digest tengan el mismo largo, que es lo único que se necesita.
  const [a, b] = await Promise.all([hmacHex(real, intento), hmacHex(real, real)]);
  return igualConstante(a, b);
}
