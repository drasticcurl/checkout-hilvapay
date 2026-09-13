/**
 * `POST /api/admin/productos/[id]/planes` — agrega una variante de precio a un
 * producto YA EXISTENTE. Es lo que usa el botón "Agregar variante" de la ficha
 * (T02 §3 punto 3): el operador elige un plan del catálogo de Whop que
 * comparta `whop_product_id` con este producto, y acá se guarda.
 *
 * `es_default` nunca llega en el body: la única forma de cambiar cuál variante
 * es la default es `POST .../planes/[planId]/default`, a propósito (ver el
 * comentario de `agregarPlanAProducto` en lib/admin/productos.ts).
 */
import { NextResponse } from 'next/server';
import { agregarPlanAProducto } from '../../../../../../lib/admin/productos';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre. Ver el mismo comentario en las otras rutas de este módulo.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EntradaPlan = {
  whop_plan_id?: unknown;
  whop_nombre_soft?: unknown;
  etiqueta?: unknown;
  precio?: unknown;
  moneda?: unknown;
  precio_anclaje?: unknown;
};

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as EntradaPlan;
  if (typeof d.whop_plan_id !== 'string' || !d.whop_plan_id.trim()) {
    return NextResponse.json({ error: 'falta_whop_plan_id' }, { status: 400 });
  }
  if (typeof d.etiqueta !== 'string' || !d.etiqueta.trim()) {
    return NextResponse.json({ error: 'falta_etiqueta' }, { status: 400 });
  }
  if (typeof d.precio !== 'string' || Number.isNaN(Number(d.precio))) {
    return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });
  }

  try {
    const plan = await agregarPlanAProducto(params.id, {
      whop_plan_id: d.whop_plan_id.trim(),
      whop_nombre_soft: typeof d.whop_nombre_soft === 'string' ? d.whop_nombre_soft : null,
      etiqueta: d.etiqueta.trim(),
      precio: d.precio,
      moneda: typeof d.moneda === 'string' ? d.moneda : 'usd',
      precio_anclaje: typeof d.precio_anclaje === 'string' ? d.precio_anclaje : null,
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje === 'plan_ya_vinculado') {
      return NextResponse.json({ error: 'plan_ya_vinculado' }, { status: 409 });
    }
    // Un producto_id inexistente cae en la FK de producto_planes.producto_id.
    if (/violat.*foreign key/i.test(mensaje)) {
      return NextResponse.json({ error: 'producto_no_encontrado' }, { status: 404 });
    }
    console.error('[api/admin/productos/:id/planes] error al agregar variante:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
