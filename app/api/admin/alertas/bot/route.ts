/**
 * GET /api/admin/alertas/bot — el chequeo de salud del bot que usa /admin/alertas.
 *
 * Llama a `getMe` y a `getWebhookInfo` de la API de Telegram. Es la pregunta
 * que hoy no se puede contestar mirando solo el env: "¿el token TODAVÍA es
 * válido?" y "¿el webhook está registrado y apunta a la URL correcta, o quedó
 * apuntando a un deploy viejo?" — un token se puede revocar desde @BotFather
 * sin que nada de este lado se entere hasta que falla un envío real.
 *
 * Nunca devuelve 500 por culpa de Telegram: si no hay token, `diagnosticarBot`
 * lo dice en el cuerpo (`configurado: false`) y el panel lo muestra sin romper
 * nada. Mismo criterio que el resto de este módulo (`lib/telegram.ts`,
 * `lib/alertas.ts`): un fallo de un tercero nunca se propaga como excepción.
 */
import { NextResponse } from 'next/server';
import { diagnosticarBot } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const diagnostico = await diagnosticarBot();
  return NextResponse.json(diagnostico, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
