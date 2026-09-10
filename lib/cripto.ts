/**
 * Cifrado en reposo de los secretos que viven en la base.
 *
 * Hoy lo usa uno solo: la API key de Whop, que desde el panel se puede rotar sin
 * entrar por SSH. Cifrarla no es ceremonia — cambia quién puede leerla:
 *
 *   · Sin cifrar, la key queda en texto plano en Postgres. Eso la pone en cada
 *     `pg_dump`, en cada backup, y a la vista de cualquier cosa que tenga
 *     `select` sobre la base.
 *   · Cifrada, para leerla hace falta la base **y** `CONFIG_ENCRYPTION_KEY`, que
 *     vive únicamente en el `.env.production` con permisos 600. Un backup
 *     filtrado, solo, no alcanza.
 *
 * Lo que esto NO protege: alguien que ya entró al panel puede reemplazar la key,
 * porque el panel tiene que poder escribirla. Contra eso lo que hay es que el
 * valor nunca se muestre de vuelta y que el cambio quede fechado.
 *
 * ── Por qué Web Crypto y no node:crypto ─────────────────────────────────────
 * El mismo criterio que `lib/auth.ts`: `crypto.subtle` existe en el runtime edge
 * y en Node, `node:crypto` solo en Node. Hoy este archivo no lo importa el
 * middleware, pero el día que algo de esta cadena termine importado desde ahí, el
 * error sería un 500 en el arranque que no menciona crypto y cuesta media hora
 * encontrar. Con Web Crypto ese día no llega.
 */

/** AES-256-GCM: cifra y autentica en el mismo paso. */
const ALGORITMO = 'AES-GCM';
const BYTES_CLAVE = 32;
/** 96 bits es el IV recomendado para GCM: es el tamaño que el modo usa sin re-derivar. */
const BYTES_IV = 12;

/**
 * El prefijo de versión viaja DENTRO del valor guardado. Sin él, cambiar de
 * algoritmo obligaría a adivinar con qué se cifró cada fila, y la única salida
 * sería invalidar todos los secretos guardados a la vez.
 */
const VERSION = 'v1';

/**
 * Falta `CONFIG_ENCRYPTION_KEY`. Es su propio tipo de error porque el panel lo
 * trata distinto que a un fallo de cifrado: no es "algo salió mal", es "esto no
 * está configurado todavía" y tiene una instrucción concreta para resolverlo.
 */
export class SinClaveDeCifrado extends Error {
  constructor() {
    super('CONFIG_ENCRYPTION_KEY no está configurada');
    this.name = 'SinClaveDeCifrado';
  }
}

/** El valor guardado no se puede descifrar con la clave actual. */
export class CifradoInvalido extends Error {
  constructor(motivo: string) {
    super(`No se pudo descifrar el valor guardado: ${motivo}`);
    this.name = 'CifradoInvalido';
  }
}

/**
 * Copia a un `Uint8Array` respaldado por un `ArrayBuffer` propio.
 *
 * Existe por una restricción de tipos que es real y no burocracia: desde TS 5.7
 * `Uint8Array` es genérico sobre su buffer, y `TextEncoder.encode()` y
 * `Uint8Array.from()` devuelven `Uint8Array<ArrayBufferLike>` — que podría estar
 * respaldado por un `SharedArrayBuffer`. Web Crypto no acepta eso: pide
 * `BufferSource` sobre un `ArrayBuffer` común. Copiar es la salida honesta; el
 * `as` que silencia el error dejaría pasar un buffer compartido de verdad.
 *
 * Ninguna de estas funciones declara su tipo de retorno a propósito. Anotarlas
 * `: Uint8Array` es justamente lo que reintroduce el problema, porque sin
 * argumento de tipo eso significa `Uint8Array<ArrayBufferLike>`. Dejando inferir,
 * el tipo queda atado al `new Uint8Array(n)` de adentro, que sí es `ArrayBuffer`.
 *
 * El costo es irrelevante acá: lo más grande que pasa por esta función es una API
 * key de unas decenas de bytes.
 */
function aBytes(origen: ArrayLike<number>) {
  const out = new Uint8Array(origen.length);
  out.set(origen);
  return out;
}

function bytesDeTexto(s: string) {
  return aBytes(new TextEncoder().encode(s));
}

function aBase64Url(bytes: Uint8Array): string {
  let bin = '';
  // Índice y no `for..of`: iterar un `Uint8Array` exige `downlevelIteration` con
  // el target de este proyecto.
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // `atob` exige el padding que base64url saca.
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Hex de 64 caracteres o base64. Separado de la validación para no anotar un `let`. */
function parsearClave(crudo: string) {
  if (/^[0-9a-fA-F]{64}$/.test(crudo)) {
    return aBytes(crudo.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  }
  try {
    return deBase64Url(crudo);
  } catch {
    throw new Error('CONFIG_ENCRYPTION_KEY no es hex ni base64. Generá una con: openssl rand -hex 32');
  }
}

/**
 * Lee la clave del entorno. Acepta hex de 64 caracteres o base64; en los dos
 * casos tiene que dar exactamente 32 bytes.
 *
 * Se exige el largo justo en vez de derivar la clave con un hash de lo que
 * venga: derivar acepta "1234" como clave y no lo dice, y el resultado es un
 * secreto cifrado con algo que se adivina en un segundo.
 */
function bytesDeLaClave() {
  const crudo = process.env.CONFIG_ENCRYPTION_KEY?.trim();
  if (!crudo) throw new SinClaveDeCifrado();

  const bytes = parsearClave(crudo);
  if (bytes.length !== BYTES_CLAVE) {
    throw new Error(
      `CONFIG_ENCRYPTION_KEY tiene ${bytes.length} bytes y necesita ${BYTES_CLAVE}. Generá una con: openssl rand -hex 32`,
    );
  }
  return bytes;
}

async function claveImportada(usos: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytesDeLaClave(), { name: ALGORITMO }, false, usos);
}

/** true si se puede cifrar. Lo usa el panel para avisar antes de aceptar un secreto. */
export function hayClaveDeCifrado(): boolean {
  try {
    bytesDeLaClave();
    return true;
  } catch {
    return false;
  }
}

/**
 * Cifra y devuelve `v1.<iv>.<ciphertext+tag>`, todo en base64url.
 *
 * El IV es aleatorio en cada llamada y va en claro, que es como corresponde: no
 * es secreto, pero **no puede repetirse** con la misma clave. Reusarlo en GCM no
 * es una debilidad teórica, filtra el plaintext.
 */
export async function cifrar(texto: string): Promise<string> {
  const clave = await claveImportada(['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(BYTES_IV));
  const cifrado = await crypto.subtle.encrypt(
    { name: ALGORITMO, iv },
    clave,
    bytesDeTexto(texto),
  );
  return `${VERSION}.${aBase64Url(iv)}.${aBase64Url(new Uint8Array(cifrado))}`;
}

/**
 * Descifra lo que devolvió `cifrar`. Tira `CifradoInvalido` si el valor está
 * cortado, si es de otra versión, o si la clave no es la que se usó para
 * cifrarlo — GCM verifica el tag, así que un valor manipulado no se descifra
 * "casi bien", falla.
 */
export async function descifrar(sobre: string): Promise<string> {
  const partes = sobre.split('.');
  if (partes.length !== 3) throw new CifradoInvalido('no tiene la forma v1.iv.datos');
  const [version, ivB64, datosB64] = partes;
  if (version !== VERSION) throw new CifradoInvalido(`versión desconocida "${version}"`);

  let iv, datos;
  try {
    iv = deBase64Url(ivB64);
    datos = deBase64Url(datosB64);
  } catch {
    throw new CifradoInvalido('el base64 está mal formado');
  }
  if (iv.length !== BYTES_IV) throw new CifradoInvalido('el IV no mide 12 bytes');

  const clave = await claveImportada(['decrypt']);
  try {
    const plano = await crypto.subtle.decrypt({ name: ALGORITMO, iv }, clave, datos);
    return new TextDecoder().decode(plano);
  } catch {
    // No se distingue "clave equivocada" de "datos manipulados" a propósito: son
    // el mismo fallo del tag de GCM y separarlos sería adivinar.
    throw new CifradoInvalido('la clave no corresponde o el dato fue modificado');
  }
}

/**
 * Huella de un secreto, para poder comparar dos valores sin mostrar ninguno.
 * Sirve para responder "¿la key que está guardada es la misma que tengo yo acá?"
 * sin que la respuesta imprima la key.
 *
 * Va con la clave de cifrado como sal: así la huella no se puede cruzar contra
 * una tabla precalculada de API keys conocidas.
 */
export async function huella(secreto: string): Promise<string> {
  const sal = hayClaveDeCifrado() ? aBase64Url(bytesDeLaClave()) : '';
  const datos = bytesDeTexto(`${sal}:${secreto}`);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return aBase64Url(new Uint8Array(hash)).slice(0, 12);
}

/**
 * Muestra los últimos 4 caracteres y nada más: alcanza para reconocer cuál de
 * dos keys está puesta, y no alcanza para usarla.
 */
export function enmascarar(secreto: string): string {
  const s = secreto.trim();
  if (s.length <= 4) return '····';
  return `····${s.slice(-4)}`;
}
