/**
 * `GET /api/admin/productos` — listado, para el selector de otras pantallas.
 * `POST /api/admin/productos` — alta. Nace inactivo (D14), lo pone `crearProducto`.
 *
 * Protegido por el middleware (`/api/admin/**`): llegar hasta acá ya implica
 * cookie válida.
 */
import { NextResponse } from 'next/server';
import { crearProducto, listarProductos, type EntradaProducto } from '../../../../lib/admin/productos';

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
  const productos = await listarProductos();
  return NextResponse.json({ productos });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaProducto>;
  if (!d || typeof d.nombre !== 'string' || !d.nombre.trim()) {
    return NextResponse.json({ error: 'falta_nombre' }, { status: 400 });
  }
  if (typeof d.whop_plan_id !== 'string' || !d.whop_plan_id.trim()) {
    return NextResponse.json({ error: 'falta_whop_plan_id' }, { status: 400 });
  }
  if (typeof d.precio !== 'string' || Number.isNaN(Number(d.precio))) {
    return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });
  }

  try {
    const producto = await crearProducto({
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
    return NextResponse.json({ producto }, { status: 201 });
  } catch (err) {
    // El único conflicto esperado es el índice único de `whop_plan_id`: un plan
    // solo puede estar asociado a un producto.
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.includes('productos_whop_plan_idx')) {
      return NextResponse.json({ error: 'plan_ya_asociado' }, { status: 409 });
    }
    console.error('[api/admin/productos] error al crear:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
