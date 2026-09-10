import { NextResponse } from 'next/server';
import { crearOrigen, listarOrigenes, type EntradaOrigen } from '../../../../lib/admin/origenes';

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
  const origenes = await listarOrigenes();
  return NextResponse.json({ origenes });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaOrigen>;
  if (typeof d.origen !== 'string' || !d.origen.trim()) {
    return NextResponse.json({ error: 'falta_origen' }, { status: 400 });
  }

  try {
    const origen = await crearOrigen({ origen: d.origen, nombre: d.nombre ?? null });
    return NextResponse.json({ origen }, { status: 201 });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.includes('origenes_origen_idx')) {
      return NextResponse.json({ error: 'origen_ya_existe' }, { status: 409 });
    }
    console.error('[api/admin/origenes] error al crear:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
