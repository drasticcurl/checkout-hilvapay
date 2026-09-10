/**
 * GET /api/cron/salidas — drena la cola `salidas` (D13 del plan).
 *
 * Por cada fila pendiente: si tiene `cobro_id`, postea el evento de compra al
 * `/api/ingest` del dashboard-admin y manda el email de entrega; si no tiene
 * `cobro_id` (reembolso, disputa — ver `lib/cobros.ts`), no hay venta que
 * reportar ni comprador al que mandarle nada: se marca enviada directamente,
 * porque esos eventos hoy solo existen para que quede rastro en `whop_eventos`
 * y no tienen un destino de salida propio todavía.
 *
 * Lo llama el crontab de la VPS cada minuto (ver `deploy/cron.hilvapay`),
 * contra 127.0.0.1 sin pasar por Caddy, autenticado con `CRON_SECRET`.
 */
import { NextResponse } from 'next/server';
import { mandarEmailDeEntrega } from '@/lib/email';
import {
  armarPayloadIngest,
  buscarDatosParaSalida,
  marcarEnviada,
  marcarFallida,
  tomarPendientes,
  type FilaCobroParaSalida,
} from '@/lib/salidas';
import type { Salida } from '@/lib/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeout duro para el POST al panel: un panel colgado no puede comerse el presupuesto del cron. */
const TIMEOUT_PANEL_MS = 5_000;

type Resultado = { tomadas: number; enviadas: number; fallidas: number; omitidas: number };

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');

  // Sin CRON_SECRET configurado, 401 y no "pasa igual": un cron que nadie
  // puede autenticar todavía es mejor que uno que cualquiera puede disparar.
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const resultado: Resultado = { tomadas: 0, enviadas: 0, fallidas: 0, omitidas: 0 };

  const filas = await tomarPendientes(20);
  resultado.tomadas = filas.length;

  for (const fila of filas) {
    // Un error en una fila no aborta las otras: es la diferencia entre una
    // venta que tarda un ciclo más en reportarse y diez ventas que se atascan
    // porque una tenía un dato raro.
    try {
      await procesarFila(fila, resultado);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      console.error(`[cron/salidas] error inesperado en la fila ${fila.id}:`, motivo);
      await marcarFallida(fila.id, motivo);
      resultado.fallidas++;
    }
  }

  return NextResponse.json(resultado);
}

async function procesarFila(fila: Salida, resultado: Resultado): Promise<void> {
  if (!fila.cobro_id) {
    // Reembolso o disputa: no hay venta que reportar al panel ni comprador al
    // que mandarle el email de entrega. Se marca enviada para que la cola no
    // la reintente para siempre por algo que nunca va a tener destino.
    await marcarEnviada(fila.id, 'sin_cobro_asociado: nada que reportar');
    resultado.enviadas++;
    return;
  }

  const datos = await buscarDatosParaSalida(fila.cobro_id);
  if (!datos) {
    // El cobro desapareció (no debería pasar: `on delete cascade` de
    // `ordenes` podría arrastrarlo, pero cobros no se borra nunca en la
    // operativa normal). Se marca para no reintentar contra un id que no
    // existe.
    await marcarEnviada(fila.id, 'omitida: el cobro ya no existe');
    resultado.omitidas++;
    return;
  }

  const reportado = await reportarAlPanel(datos);
  const email = await mandarEmailSiCorresponde(datos);

  if (!reportado.ok && reportado.reintentar) {
    // El panel falló de forma transitoria: no se marca enviada, se reintenta
    // en el próximo ciclo con backoff. El email ya mandado (si se mandó) no se
    // repite: `email_enviado_at` corta un segundo envío en el próximo intento.
    await marcarFallida(fila.id, reportado.motivo ?? 'panel: fallo sin motivo detallado');
    resultado.fallidas++;
    return;
  }

  const motivo = [reportado.motivo, email.motivo].filter(Boolean).join(' | ') || undefined;
  await marcarEnviada(fila.id, motivo);
  if (motivo) resultado.omitidas++;
  else resultado.enviadas++;
}

type ResultadoPanel = { ok: boolean; reintentar: boolean; motivo?: string };

async function reportarAlPanel(datos: FilaCobroParaSalida): Promise<ResultadoPanel> {
  const armado = armarPayloadIngest(datos);
  if (!armado.ok) {
    // Regla 1 de la sección 3 del task: sin session_id/visitor_id no se
    // inventa nada, se omite con el motivo anotado.
    return { ok: true, reintentar: false, motivo: armado.motivo };
  }

  const url = process.env.PANEL_INGEST_URL;
  const key = process.env.PANEL_INGEST_KEY;
  if (!url || !key) {
    // P-04 del plan, sin resolver: mientras no haya URL/key, no hay panel al
    // que reportarle. No es un error transitorio — no tiene sentido reintentar
    // esto con backoff, así que se marca enviada con el motivo.
    return { ok: true, reintentar: false, motivo: 'omitida: PANEL_INGEST_URL/KEY sin configurar (P-04)' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_PANEL_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(armado.payload),
      signal: controller.signal,
    });

    // El panel puede responder 200 con {ok:false} para sus propios errores
    // internos (regla 3 de la sección 3 del task): mirar solo el status HTTP
    // deja pasar por "enviado" algo que el panel rechazó de verdad.
    let body: { ok?: boolean; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      // Respuesta sin JSON parseable: se trata como fallo, más abajo.
    }

    if (res.status === 401) {
      // Key mal configurada, no un problema transitorio (regla 4 de la
      // sección 3): no tiene sentido reintentar esto 50 veces con backoff.
      return { ok: true, reintentar: false, motivo: `omitida: panel devolvió 401 (${body.error ?? 'unauthorized'})` };
    }

    if (res.ok && body.ok === true) {
      return { ok: true, reintentar: false };
    }

    return {
      ok: false,
      reintentar: true,
      motivo: `panel respondió ${res.status} ok=${body.ok ?? 'sin_body'} error=${body.error ?? ''}`,
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    return { ok: false, reintentar: true, motivo: `fetch al panel falló: ${motivo}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function mandarEmailSiCorresponde(datos: FilaCobroParaSalida): Promise<{ motivo?: string }> {
  // El email de entrega solo tiene sentido para el cobro del front (el que le
  // da acceso al producto principal). Un upsell no dispara un email nuevo: la
  // persona ya recibió el de la compra del front, y este servicio no maneja
  // niveles de acceso (§0 del plan) — no hay nada distinto que "entregar".
  if (datos.cobro.origen !== 'front') {
    return {};
  }

  if (!datos.orden.email) {
    return { motivo: 'sin_email: la orden no tiene email' };
  }

  const resultado = await mandarEmailDeEntrega({
    cobroId: datos.cobro.id,
    email: datos.orden.email,
    nombre: datos.orden.nombre,
    productoNombre: datos.producto.nombre,
  });

  if (resultado.enviado) return {};
  // 'apagado', 'sin_api_key', 'ya_enviado' no son errores que bloqueen el
  // reporte al panel: la venta se reporta igual, y el motivo queda anotado
  // para que se entienda por qué no salió (o no tuvo que salir de nuevo) un
  // email.
  return { motivo: `email:${resultado.motivo}` };
}

// Se re-exporta para que un test de integración pueda tipar el resultado sin
// duplicar la forma.
export type { Resultado as ResultadoCronSalidas };
