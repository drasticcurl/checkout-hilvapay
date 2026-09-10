/**
 * GET /api/cron/reconciliar — cierra los cobros que quedaron a medias.
 *
 * Lo llama el crontab cada 10 minutos (ver `deploy/cron.hilvapay`), contra
 * 127.0.0.1 sin pasar por Caddy, autenticado con `CRON_SECRET`.
 *
 * Es la red que hace que el módulo no dependa del webhook de Whop para saber si
 * entró la plata. La lógica entera vive en `lib/reconciliacion.ts`: acá solo está
 * la autenticación y la traducción a JSON, igual que en `/api/cron/salidas`.
 *
 * ── Por qué 10 minutos y no cada minuto ─────────────────────────────────────
 * Cada cobro revisado son una o dos llamadas a la API de Whop. El camino normal
 * (el browser puleando, el webhook llegando) resuelve un cobro en segundos, así
 * que lo que llega hasta acá es la excepción: correrlo cada minuto gastaría cuota
 * para encontrar, casi siempre, cero filas. Con 10 minutos, el peor caso para un
 * comprador que cerró la pestaña es que su email de entrega salga 10 minutos
 * tarde.
 */
import { NextResponse } from 'next/server';
import { cronAutorizado } from '@/lib/cron';
import { reconciliar } from '@/lib/reconciliacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const resultado = await reconciliar();
    return NextResponse.json(resultado);
  } catch (err) {
    // Un error acá no puede tumbar el cron en silencio: se devuelve 500 con el
    // motivo para que quede en el log del crontab, que es donde alguien lo va a
    // buscar.
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[cron/reconciliar] error inesperado:', motivo);
    return NextResponse.json({ error: 'error_interno', motivo }, { status: 500 });
  }
}
