/**
 * `PATCH /api/admin/productos/[id]` — edición de datos, o el switch de activo.
 * Son dos operaciones distintas dentro del mismo verbo porque el switch pide
 * confirmación en la UI (D14) y la edición de nombre/precio no.
 */
import { NextResponse } from 'next/server';
import {
  actualizarProducto,
  buscarProducto,
  setActivoProducto,
  type EntradaProducto,
} from '../../../../../lib/admin/productos';

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

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const producto = await buscarProducto(params.id);
  if (!producto) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  return NextResponse.json({ producto });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaProducto> & { activo?: boolean };

  // Body con SOLO `activo`: es el switch, no pide los demás campos.
  if (typeof d.activo === 'boolean' && Object.keys(d).length === 1) {
    await setActivoProducto(params.id, d.activo);
    const producto = await buscarProducto(params.id);
    return NextResponse.json({ producto });
  }

  if (typeof d.nombre !== 'string' || !d.nombre.trim()) {
    return NextResponse.json({ error: 'falta_nombre' }, { status: 400 });
  }
  if (typeof d.whop_plan_id !== 'string' || !d.whop_plan_id.trim()) {
    return NextResponse.json({ error: 'falta_whop_plan_id' }, { status: 400 });
  }
  if (typeof d.precio !== 'string' || Number.isNaN(Number(d.precio))) {
    return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });
  }

  try {
    const producto = await actualizarProducto(params.id, {
      nombre: d.nombre.trim(),
      whop_plan_id: d.whop_plan_id.trim(),
      whop_product_id: d.whop_product_id ?? null,
      whop_nombre_soft: d.whop_nombre_soft ?? null,
      precio: d.precio,
      moneda: d.moneda ?? 'usd',
      precio_anclaje: d.precio_anclaje ?? null,
      imagen_url: d.imagen_url ?? null,
      descripcion: d.descripcion ?? null,
    });
    if (!producto) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ producto });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.includes('productos_whop_plan_idx')) {
      return NextResponse.json({ error: 'plan_ya_asociado' }, { status: 409 });
    }
    console.error('[api/admin/productos/:id] error al editar:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
