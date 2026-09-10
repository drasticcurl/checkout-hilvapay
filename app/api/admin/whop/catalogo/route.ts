/**
 * `GET /api/admin/whop/catalogo` — los productos de Whop con sus planes, cruzados
 * con lo que ya está vinculado acá.
 *
 * Nunca tira: si Whop no responde devuelve el catálogo vacío con el error, y la
 * pantalla ofrece el alta manual.
 */
import { NextResponse } from 'next/server';
import { catalogoWhop } from '../../../../../lib/admin/catalogo';

// Sin estas dos, Next prerenderiza el handler en el build: la respuesta queda
// congelada en `.next/` y encima el build hace la llamada a Whop. Verificado el
// 2026-09-10 con `/api/admin/productos/planes`, que quedó horneado.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const catalogo = await catalogoWhop();
  return NextResponse.json(catalogo);
}
