import { NextResponse } from 'next/server';
import {
  eliminarDestinatario,
  setActivoDestinatario,
  setTecnicasDestinatario,
} from '../../../../../lib/admin/alertas';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build y la respuesta queda congelada en `.next/`.
// `runtime = 'nodejs'` porque usa `pg`, que no corre en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as { activo?: unknown; recibeTecnicas?: unknown };

  // Un campo por request. Se aplica el que vino y no se toca el otro: un PATCH
  // que mande solo `activo` no puede apagar las técnicas de rebote.
  if (typeof d.activo === 'boolean') {
    await setActivoDestinatario(params.id, d.activo);
    return NextResponse.json({ ok: true });
  }

  if (typeof d.recibeTecnicas === 'boolean') {
    await setTecnicasDestinatario(params.id, d.recibeTecnicas);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  await eliminarDestinatario(params.id);
  return NextResponse.json({ ok: true });
}
