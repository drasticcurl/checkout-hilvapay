/**
 * `GET /api/admin/funnels/[id]` — un funnel con sus pasos, para el editor.
 * `PATCH /api/admin/funnels/[id]` — el switch de `activo`, o la edición completa.
 * `DELETE /api/admin/funnels/[id]` — borra el funnel (los pasos quedan sueltos).
 */
import { NextResponse } from 'next/server';
import {
  borrarFunnel,
  buscarFunnelConPasos,
  guardarFunnel,
  setActivoFunnel,
  type EntradaFunnel,
} from '../../../../../lib/admin/funnels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const funnel = await buscarFunnelConPasos(params.id);
  if (!funnel) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  return NextResponse.json({ funnel });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaFunnel> & { activo?: boolean };

  // Body con SOLO `activo`: es el switch de la lista. La confirmación al
  // ENCENDER (regla 1 del task) la hace la UI antes de mandar el request; acá
  // se aplica lo que ya se decidió.
  if (typeof d.activo === 'boolean' && Object.keys(d).length === 1) {
    await setActivoFunnel(params.id, d.activo);
    const funnel = await buscarFunnelConPasos(params.id);
    if (!funnel) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json({ funnel });
  }

  // Si no es el switch, es el guardado completo del editor.
  if (typeof d.nombre !== 'string' || !d.nombre.trim()) {
    return NextResponse.json({ error: 'falta_nombre' }, { status: 400 });
  }
  if (!Array.isArray(d.pasos)) {
    return NextResponse.json({ error: 'faltan_pasos' }, { status: 400 });
  }

  const resultado = await guardarFunnel(params.id, {
    nombre: d.nombre,
    url_gracias: d.url_gracias ?? null,
    pasos: d.pasos,
  });

  if (!resultado.ok) {
    const status = resultado.error === 'datos_invalidos' ? 400 : 409;
    return NextResponse.json({ error: resultado.error, detalle: resultado.detalle }, { status });
  }

  const funnel = await buscarFunnelConPasos(resultado.id);
  return NextResponse.json({ funnel });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  await borrarFunnel(params.id);
  return NextResponse.json({ ok: true });
}
