/**
 * GET /api/cron/vigilar — mira si algo está roto y avisa por Telegram.
 *
 * Lo llama el crontab cada 15 minutos (ver `deploy/cron.hilvapay`), contra
 * 127.0.0.1 sin pasar por Caddy, autenticado con `CRON_SECRET`.
 *
 * Los umbrales, el dedupe y el texto de cada alerta viven en `lib/alertas.ts`.
 *
 * ── Este endpoint no falla nunca con 500 por culpa de Telegram ──────────────
 * Si el bot no está configurado, si el token es inválido o si Telegram está
 * caído, `vigilar()` devuelve el conteo en `sinCanal` y sigue. Un vigilante que
 * se cae porque no pudo avisar deja de vigilar, que es la peor combinación
 * posible: el problema original abierto y el vigilante también.
 */
import { NextResponse } from 'next/server';
import { vigilar } from '@/lib/alertas';
import { cronAutorizado } from '@/lib/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const resultado = await vigilar();
    return NextResponse.json(resultado);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[cron/vigilar] error inesperado:', motivo);
    return NextResponse.json({ error: 'error_interno', motivo }, { status: 500 });
  }
}
