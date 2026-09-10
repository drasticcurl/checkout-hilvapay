/**
 * `GET /media/<archivo>` — sirve las imágenes de producto subidas al panel.
 *
 * Existe como route handler y no como archivos en `public/` porque los uploads
 * viven FUERA de la release (`/srv/hilvapay/shared/uploads/`): el deploy arma
 * cada release desde git y hace un swap de `current`, así que lo que esté dentro
 * desaparece en el próximo deploy.
 *
 * **Es público a propósito.** La imagen del producto se muestra en la página de
 * checkout, que la ve cualquier comprador anónimo. No lleva la cookie del panel y
 * no está en el matcher del middleware.
 *
 * La única defensa que necesita es no dejar leer nada que no sea un upload
 * nuestro, y eso lo hace `nombreValido()`: exige 28 caracteres hex y una
 * extensión de la lista. Sin eso, un `/media/..%2f..%2fetc%2fpasswd` sería una
 * lectura arbitraria de archivos del servidor.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { directorioUploads, mimeDe, nombreValido } from '@/lib/admin/uploads';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: { archivo: string } },
): Promise<NextResponse> {
  const { archivo } = params;

  if (!nombreValido(archivo)) {
    // 404 y no 400: para quien pruebe rutas, un archivo con nombre inválido y uno
    // que no existe tienen que verse igual.
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const bytes = await readFile(join(directorioUploads(), archivo));
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': mimeDe(archivo),
        // El nombre incluye un hash del contenido, así que un archivo con este
        // nombre nunca cambia: se puede cachear para siempre. Cambiar la imagen
        // de un producto genera un nombre nuevo.
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Aunque solo se sirven JPG/PNG/WebP validados por magic bytes, esto
        // impide que un navegador decida por su cuenta que el contenido es otra
        // cosa y lo ejecute.
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
