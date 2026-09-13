/**
 * `PATCH /api/admin/productos/[id]/planes/[planId]` — edita una variante
 * puntual (etiqueta, precio, precio de anclaje). NO su `whop_plan_id`:
 * cambiarlo es borrar la variante y crear otra, no editar — ver la nota de
 * `actualizarPlan` en lib/admin/productos.ts.
 */
import { NextResponse } from 'next/server';
import { actualizarPlan } from '../../../../../../../lib/admin/productos';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre. Ver el mismo comentario en las otras rutas de este módulo.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EntradaEdicionPlan = {
  etiqueta?: unknown;
  precio?: unknown;
  precio_anclaje?: unknown;
};

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; planId: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as EntradaEdicionPlan;

  if (d.etiqueta !== undefined && (typeof d.etiqueta !== 'string' || !d.etiqueta.trim())) {
    return NextResponse.json({ error: 'etiqueta_invalida' }, { status: 400 });
  }
  if (d.precio !== undefined && (typeof d.precio !== 'string' || Number.isNaN(Number(d.precio)))) {
    return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });
  }
  if (d.precio_anclaje !== undefined && d.precio_anclaje !== null && typeof d.precio_anclaje !== 'string') {
    return NextResponse.json({ error: 'precio_anclaje_invalido' }, { status: 400 });
  }

  const plan = await actualizarPlan(params.planId, {
    etiqueta: typeof d.etiqueta === 'string' ? d.etiqueta.trim() : undefined,
    precio: typeof d.precio === 'string' ? d.precio : undefined,
    precio_anclaje: d.precio_anclaje === null ? null : typeof d.precio_anclaje === 'string' ? d.precio_anclaje : undefined,
  });
  if (!plan) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  return NextResponse.json({ plan });
}
