/**
 * `POST /api/admin/productos/imagen` — sube la imagen de un producto.
 *
 * Está bajo `/api/admin`, así que el middleware ya exige la cookie de sesión: sin
 * login devuelve 401 antes de llegar acá. Las validaciones de `lib/admin/uploads`
 * van igual — el que puede entrar al panel no tiene por qué poder escribir un
 * archivo arbitrario en el disco del servidor.
 */
import { NextResponse } from 'next/server';
import { guardarImagen, MAX_BYTES } from '../../../../../lib/admin/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MENSAJES: Record<string, string> = {
  sin_archivo: 'No llegó ningún archivo.',
  muy_grande: `La imagen pesa más de ${MAX_BYTES / 1024 / 1024} MB.`,
  tipo_no_permitido: 'Solo JPG, PNG o WebP.',
  no_se_pudo_escribir: 'No se pudo guardar la imagen en el servidor.',
};

export async function POST(req: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'sin_archivo', mensaje: MENSAJES.sin_archivo }, { status: 400 });
  }

  const archivo = form.get('imagen');
  if (!(archivo instanceof File)) {
    return NextResponse.json({ ok: false, error: 'sin_archivo', mensaje: MENSAJES.sin_archivo }, { status: 400 });
  }

  const res = await guardarImagen(archivo);

  if (!res.ok) {
    // 413 para el tamaño y 415 para el tipo: son los códigos que describen el
    // problema, y el front puede distinguirlos sin leer el cuerpo.
    const status = res.error === 'muy_grande' ? 413 : res.error === 'tipo_no_permitido' ? 415 : 400;
    return NextResponse.json(
      // El `detalle` de uploads.ts ya es una frase completa: se usa ESE cuando
      // existe, en vez de concatenarlo al genérico. Concatenar dejaba mensajes
      // como "Solo JPG, PNG o WebP. solo JPG, PNG o WebP. Un SVG no se acepta…".
      { ...res, mensaje: res.detalle ?? MENSAJES[res.error] },
      { status: res.error === 'no_se_pudo_escribir' ? 500 : status },
    );
  }

  return NextResponse.json(res);
}
