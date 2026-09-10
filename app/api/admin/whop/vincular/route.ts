/**
 * `POST /api/admin/whop/vincular` — crea el producto y su link de pago en una
 * sola transacción, a partir de un plan de Whop elegido en el catálogo.
 *
 * Es la acción de "vincular gráficamente": el `plan_id` viene de la lista que
 * trajo la API, no de algo que el usuario tipeó, así que no puede estar mal
 * escrito. El único error posible es elegir el plan equivocado, y para eso la
 * pantalla muestra el precio real al lado de cada uno.
 */
import { NextResponse } from 'next/server';
import { vincularPlan, type EntradaVinculo } from '../../../../../lib/admin/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Los errores traducidos a mensajes que se muestran tal cual en la pantalla. */
const MENSAJES: Record<string, string> = {
  slug_ocupado: 'Ya existe un link de pago con ese slug. Elegí otro.',
  plan_ya_vinculado: 'Ese plan de Whop ya está vinculado a un producto. Buscalo en la lista de productos.',
  datos_invalidos: 'Faltan datos o alguno no es válido.',
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'datos_invalidos' }, { status: 400 });
  }

  const b = body as Partial<EntradaVinculo> | null;
  if (
    !b ||
    typeof b.whop_plan_id !== 'string' ||
    typeof b.nombre !== 'string' ||
    typeof b.precio !== 'string' ||
    typeof b.slug !== 'string' ||
    (b.tipo !== 'front' && b.tipo !== 'upsell')
  ) {
    return NextResponse.json(
      { ok: false, error: 'datos_invalidos', mensaje: MENSAJES.datos_invalidos },
      { status: 400 },
    );
  }

  const res = await vincularPlan({
    whop_plan_id: b.whop_plan_id,
    whop_product_id: typeof b.whop_product_id === 'string' ? b.whop_product_id : null,
    whop_nombre_soft: typeof b.whop_nombre_soft === 'string' ? b.whop_nombre_soft : null,
    nombre: b.nombre,
    precio: b.precio,
    moneda: typeof b.moneda === 'string' && b.moneda ? b.moneda : 'usd',
    slug: b.slug,
    tipo: b.tipo,
  });

  if (!res.ok) {
    // 409 y no 400 para los conflictos: el request estaba bien formado, lo que
    // pasa es que el estado del sistema no lo admite. La pantalla los distingue.
    const status = res.error === 'datos_invalidos' ? 400 : 409;
    return NextResponse.json({ ...res, mensaje: MENSAJES[res.error] ?? res.detalle }, { status });
  }

  return NextResponse.json(res);
}
