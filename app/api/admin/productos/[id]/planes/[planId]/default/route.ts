/**
 * `POST /api/admin/productos/[id]/planes/[planId]/default` — hace que esta
 * variante sea la default del producto. Ver `setPlanDefault` en
 * lib/admin/productos.ts: apaga la default vieja antes de prender la nueva,
 * nunca al revés, por el índice único parcial `producto_planes_un_default_idx`.
 */
import { NextResponse } from 'next/server';
import { setPlanDefault } from '../../../../../../../../lib/admin/productos';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre. Ver el mismo comentario en las otras rutas de este módulo.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: { id: string; planId: string } },
): Promise<NextResponse> {
  try {
    await setPlanDefault(params.planId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje === 'no existe ese plan') {
      return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    }
    console.error('[api/admin/productos/:id/planes/:planId/default] error:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
