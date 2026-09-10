/**
 * Subida de imágenes de producto.
 *
 * ── Dónde se guardan y por qué no en `public/` ──────────────────────────────
 * En `/srv/hilvapay/shared/uploads/`, FUERA de la release. El deploy arma cada
 * release nueva desde git y hace un swap atómico de `current`: cualquier cosa
 * escrita dentro de una release desaparece en el próximo deploy. Una imagen que
 * se borra sola cuando deployás es un bug que aparece días después del cambio
 * que lo causó.
 *
 * En desarrollo va a `./uploads`, que está en el `.gitignore`.
 *
 * ── Qué se valida, y por qué no alcanza la extensión ────────────────────────
 * Esto escribe archivos en disco a partir de algo que subió una persona. Aunque
 * el endpoint esté detrás del login del panel, las tres validaciones van igual:
 *
 *  1. **El nombre lo generamos nosotros**, nunca se usa el del cliente. Un
 *     `../../etc/algo` en el nombre original escribiría donde no debe.
 *  2. **Se miran los bytes, no la extensión.** Un `.png` puede ser cualquier
 *     cosa; los magic bytes dicen qué es de verdad.
 *  3. **SVG está prohibido**, y no es una omisión: un SVG puede traer
 *     `<script>` adentro, y servirlo desde el mismo dominio del panel es un XSS
 *     con la cookie de sesión al alcance.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 2 MB. Es la imagen de un producto en una ficha de 56×56 px, no un banner. */
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Los tipos aceptados, con sus magic bytes.
 *
 * WebP se acepta porque pesa menos que un PNG con la misma calidad; GIF no, para
 * no tener animaciones dando vueltas en una ficha de producto.
 */
const FIRMAS: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function directorioUploads(): string {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export type ResultadoSubida =
  | { ok: true; url: string; nombre: string; bytes: number; tipo: string }
  | {
      ok: false;
      error: 'sin_archivo' | 'muy_grande' | 'tipo_no_permitido' | 'no_se_pudo_escribir';
      detalle?: string;
    };

/**
 * Valida y guarda. Devuelve la URL pública con la que se sirve
 * (`/media/<nombre>`, resuelta por `app/media/[archivo]/route.ts`).
 *
 * El nombre sale de un hash del contenido más 6 bytes aleatorios: el hash hace
 * que subir dos veces la misma imagen no llene el disco de copias, y los bytes
 * aleatorios evitan que alguien pueda adivinar la URL de una imagen calculando
 * el hash de un archivo que sospecha que subiste.
 */
export async function guardarImagen(archivo: File): Promise<ResultadoSubida> {
  if (!archivo || archivo.size === 0) return { ok: false, error: 'sin_archivo' };

  if (archivo.size > MAX_BYTES) {
    return {
      ok: false,
      error: 'muy_grande',
      detalle: `pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 2 MB`,
    };
  }

  const bytes = Buffer.from(await archivo.arrayBuffer());

  // Se relee el tamaño de los bytes reales: `archivo.size` lo dice el cliente y
  // un cliente puede mentir.
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: 'muy_grande' };

  const firma = FIRMAS.find((f) => f.test(bytes));
  if (!firma) {
    return {
      ok: false,
      error: 'tipo_no_permitido',
      detalle: 'solo JPG, PNG o WebP. Un SVG no se acepta: puede traer scripts adentro',
    };
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const nombre = `${hash}${randomBytes(6).toString('hex')}.${firma.ext}`;

  const dir = directorioUploads();
  try {
    await mkdir(dir, { recursive: true });
    // `join(dir, nombre)` con un nombre que generamos nosotros: no hay forma de
    // que salga del directorio.
    await writeFile(join(dir, nombre), bytes, { mode: 0o644 });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error('[uploads] no se pudo escribir la imagen:', detalle);
    return { ok: false, error: 'no_se_pudo_escribir', detalle };
  }

  return { ok: true, url: `/media/${nombre}`, nombre, bytes: bytes.byteLength, tipo: firma.mime };
}

/**
 * Valida que un nombre de archivo sea uno de los nuestros antes de leerlo del
 * disco.
 *
 * Es la única defensa del endpoint que sirve las imágenes: sin esto, un
 * `/media/..%2f..%2fetc%2fpasswd` sería una lectura arbitraria de archivos. El
 * formato es exacto —32 hex y una extensión de la lista— así que ni un punto ni
 * una barra pasan.
 */
export function nombreValido(nombre: string): boolean {
  return /^[0-9a-f]{28}\.(jpg|png|webp)$/.test(nombre);
}

/** El MIME que corresponde a la extensión de un nombre ya validado. */
export function mimeDe(nombre: string): string {
  const ext = nombre.split('.').pop();
  return FIRMAS.find((f) => f.ext === ext)?.mime ?? 'application/octet-stream';
}
