/**
 * `GET /api/admin/productos/planes` — los planes de Whop para el selector del
 * formulario de alta/edición de producto. Nunca tira: si Whop falla, devuelve
 * `planes: []` y el error, y el formulario cae al campo manual de `plan_id`.
 */
import { NextResponse } from 'next/server';
import { planesDisponibles } from '../../../../../lib/admin/productos';

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

export async function GET(): Promise<NextResponse> {
  const { planes, error } = await planesDisponibles();
  return NextResponse.json({ planes, error });
}
