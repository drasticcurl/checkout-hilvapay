/**
 * `POST /api/admin/productos/verificar-precio` — la comparación de D10. Se
 * llama al vivo desde el formulario, cada vez que cambia el plan o el precio
 * mostrado, para que el aviso esté siempre visible en pantalla y no en un
 * tooltip.
 */
import { NextResponse } from 'next/server';
import { verificarPrecio } from '../../../../../lib/admin/productos';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre, y si la query devolvía filas, esos datos quedan escritos en el
// artefacto del build. Verificado el 2026-09-10: `/api/admin/cobros` horneó un
// cobro con el email del comprador adentro, y `/api/admin/productos/planes`
// llamó a la API de Whop en tiempo de build y congeló la lista de planes.
//
// `runtime = 'nodejs'` porque estas rutas usan `pg`, que no corre en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as { planId?: unknown; precio?: unknown };
  if (typeof d.planId !== 'string' || !d.planId.trim() || typeof d.precio !== 'string') {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const resultado = await verificarPrecio(d.planId, d.precio);
  // `resultado: null` es una respuesta válida (no se pudo consultar el plan);
  // el formulario lo distingue de `{ coincide: false }` para no mostrar "no
  // coincide" cuando en realidad no se pudo saber.
  return NextResponse.json({ resultado });
}
