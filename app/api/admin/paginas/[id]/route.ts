import { NextResponse } from 'next/server';
import {
  actualizarPagina,
  borrarPagina,
  buscarPagina,
  setActivoPagina,
  type EntradaPagina,
} from '../../../../../lib/admin/paginas';

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
  const pagina = await buscarPagina(params.id);
  if (!pagina) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  return NextResponse.json({ pagina });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaPagina> & { activo?: boolean };

  // Body con SOLO `activo`: es el switch. Pide confirmación al ENCENDER (D14),
  // pero esa confirmación la hace la UI antes de mandar el request — acá se
  // aplica lo que ya se decidió, sin distinguir encender de apagar.
  if (typeof d.activo === 'boolean' && Object.keys(d).length === 1) {
    await setActivoPagina(params.id, d.activo);
    const pagina = await buscarPagina(params.id);
    return NextResponse.json({ pagina });
  }

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
    const pagina = await actualizarPagina(params.id, {
      slug: d.slug,
      producto_id: d.producto_id,
      tipo: d.tipo,
      url_exito: d.url_exito ?? null,
      url_rechazo: d.url_rechazo ?? null,
      config: d.config ?? {},
    });
    if (!pagina) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ pagina });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.includes('paginas_slug_idx')) {
      return NextResponse.json({ error: 'slug_ya_existe' }, { status: 409 });
    }
    console.error('[api/admin/paginas/:id] error al editar:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}

/**
 * Borra la página de verdad. Irreversible, a diferencia del switch de `PATCH
 * {activo}`. Solo funciona si la página no tiene ninguna orden ni ningún cobro
 * (`borrarPagina`, `lib/admin/paginas.ts`): si tiene alguno, 409 con el motivo,
 * para que la pantalla lo explique en vez de un 500 de constraint violada.
 *
 * Es el botón que le faltaba a `ListaVariantes.tsx` para destrabar el mensaje
 * de `borrarProducto` ("tiene_links... borrá primero sus links") — antes de
 * esto no existía ninguna forma de borrar una página huérfana (sin funnel,
 * sin cobros) desde el panel.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const resultado = await borrarPagina(params.id);
  if (!resultado.ok) {
    const status = resultado.error === 'no_encontrada' ? 404 : 409;
    return NextResponse.json({ error: resultado.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
