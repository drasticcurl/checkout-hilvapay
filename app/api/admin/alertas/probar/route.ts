/**
 * POST /api/admin/alertas/probar — manda un mensaje de prueba a todos.
 *
 * Existe porque un canal de alertas que no se probó no es un canal de alertas.
 * Los tres modos de falla son silenciosos y ninguno se nota hasta el incidente:
 * el token mal pegado, el `chat_id` de otra persona, y el más común de todos —
 * nadie le habló al bot primero, y Telegram no deja que un bot inicie una
 * conversación.
 *
 * Devuelve el detalle por destinatario, no un "ok" global: con tres chats
 * cargados, saber que "falló" no sirve; hay que saber cuál.
 */
import { NextResponse } from 'next/server';
import { mandarAlerta } from '../../../../../lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const resultado = await mandarAlerta(
    '✅ <b>Prueba desde el panel</b>\n\n' +
      'Si estás leyendo esto, las alertas de hilvapay te van a llegar acá.',
  );

  return NextResponse.json(resultado, {
    // 200 aunque no haya llegado a nadie: la prueba se ejecutó y el resultado es
    // el cuerpo. Un 500 acá haría que el panel muestre "error de red" en lugar
    // del motivo real, que es lo único que sirve para arreglarlo.
    status: 200,
  });
}
