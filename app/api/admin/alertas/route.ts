import { NextResponse } from 'next/server';
import {
  chatIdValido,
  crearDestinatario,
  listarDestinatarios,
} from '../../../../lib/admin/alertas';

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
  const destinatarios = await listarDestinatarios();
  return NextResponse.json({ destinatarios });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as { chatId?: unknown; nombre?: unknown };
  if (typeof d.chatId !== 'string' || !chatIdValido(d.chatId)) {
    // El mensaje distingue este caso del genérico: pegar el @usuario en vez del
    // id numérico es el error que va a cometer todo el mundo la primera vez.
    return NextResponse.json({ error: 'chat_id_invalido' }, { status: 400 });
  }

  try {
    const destinatario = await crearDestinatario({
      chatId: d.chatId,
      nombre: typeof d.nombre === 'string' ? d.nombre : null,
    });
    return NextResponse.json({ destinatario }, { status: 201 });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error('[api/admin/alertas] error al crear:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
