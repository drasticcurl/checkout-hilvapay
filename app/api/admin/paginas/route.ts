import { NextResponse } from 'next/server';
import { crearPagina, listarPaginasConProducto, type EntradaPagina } from '../../../../lib/admin/paginas';

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
  const paginas = await listarPaginasConProducto();
  return NextResponse.json({ paginas });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaPagina>;
  if (typeof d.slug !== 'string' || !d.slug.trim()) {
    return NextResponse.json({ error: 'falta_slug' }, { status: 400 });
  }
  if (typeof d.producto_id !== 'string' || !d.producto_id.trim()) {
    return NextResponse.json({ error: 'falta_producto' }, { status: 400 });
  }
  if (d.tipo !== 'front' && d.tipo !== 'upsell') {
    return NextResponse.json({ error: 'tipo_invalido' }, { status: 400 });
  }

  try {
    const pagina = await crearPagina({
      slug: d.slug,
      producto_id: d.producto_id,
      tipo: d.tipo,
      url_exito: d.url_exito ?? null,
      url_rechazo: d.url_rechazo ?? null,
      config: d.config ?? {},
    });
    return NextResponse.json({ pagina }, { status: 201 });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.includes('paginas_slug_idx')) {
      return NextResponse.json({ error: 'slug_ya_existe' }, { status: 409 });
    }
    console.error('[api/admin/paginas] error al crear:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
