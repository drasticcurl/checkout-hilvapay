/**
 * POST /api/webhooks/whop — el endpoint que se pega en Whop
 * (Developer → Webhooks), versión **v1**.
 *
 * Eventos a suscribir:
 *   payment.succeeded, payment.failed, refund.created, dispute.created
 *
 * `setup_intent.succeeded` NO hace falta: pertenece al flujo de "guardar tarjeta
 * sin cobrar". Acá se cobra y se guarda en el mismo movimiento con
 * `setupFutureUsage="off_session"`, así que el método llega en el
 * `payment.succeeded` — y antes todavía, sincrónicamente, en el claim.
 *
 * ── Reglas que impone Whop y por qué el handler está armado así ──────────────
 *
 * 1. "Respond in less than 5 seconds, or Whop retries." Por eso el trabajo
 *    pesado (avisarle al dashboard-admin, mandar el email) no se hace acá: se
 *    encola en `salidas` y lo drena un cron.
 *
 * 2. "Whop disables endpoints that continue to fail": 72 h de fallas y 10
 *    entregas fallidas y el webhook se apaga solo, y los eventos de ese período
 *    NO se reenvían. Por eso este handler devuelve 200 ante cualquier error
 *    interno: el evento queda anotado en `whop_eventos` con el error para poder
 *    reprocesarlo desde acá, en vez de arriesgar que Whop nos apague el endpoint.
 *    La única cosa que devuelve 4xx es una firma inválida, que es lo que hay que
 *    rechazar de verdad.
 *
 * 3. "A newer event can arrive before an older event." Todas las escrituras de
 *    estado pasan por `aplicarEstadoDePago`, que es monótona.
 */
import { NextResponse } from 'next/server';
import {
  aplicarEstadoDePago,
  buscarCobroPorPagoWhop,
  encolarSalida,
  guardarMetodoDePago,
  registrarCobroDelFront,
  resolverOrdenDePago,
} from '@/lib/cobros';
import { q, q1, qCount } from '@/lib/db';
import { normalizarPago } from '@/lib/whop';
import { FirmaInvalida, verificarWebhook, type EventoWhop } from '@/lib/whop-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  // EL BODY CRUDO. Si acá se hiciera req.json(), la firma no validaría nunca:
  // parsear y re-serializar cambia los bytes.
  const crudo = await req.text();
  const headers = Object.fromEntries(req.headers);

  let evento: EventoWhop;
  try {
    evento = verificarWebhook(crudo, headers, process.env.WHOP_WEBHOOK_SECRET ?? '');
  } catch (err) {
    if (err instanceof FirmaInvalida) {
      console.warn('[webhook] firma rechazada:', err.message);
      return new NextResponse('firma inválida', { status: 400 });
    }
    throw err;
  }

  // ── Deduplicación ─────────────────────────────────────────────────────────
  // La PK es el webhook-id. Si el INSERT no afecta filas, el evento ya llegó.
  //
  // Pero "ya llegó" no siempre es "ya se procesó": si el procesamiento falló, la
  // fila quedó con procesado_at NULL. En ese caso se reprocesa, porque el evento
  // sigue pendiente. Así el botón "Send event" del dashboard sirve para
  // reintentar un evento que falló, y a la vez un reenvío de un evento ya
  // resuelto no duplica nada.
  const nuevo = await qCount(
    `insert into whop_eventos (webhook_id, tipo, payload)
     values ($1, $2, $3::jsonb)
     on conflict (webhook_id) do nothing`,
    [evento.id, evento.type, crudo],
  );

  if (nuevo === 0) {
    const previo = await q1<{ procesado_at: Date | null }>(
      'select procesado_at from whop_eventos where webhook_id = $1',
      [evento.id],
    );
    if (previo?.procesado_at) {
      console.log(`[webhook] duplicado ignorado: ${evento.type} ${evento.id}`);
      return new NextResponse('OK (duplicado)', { status: 200 });
    }
    console.log(`[webhook] reintento de un evento que había fallado: ${evento.type} ${evento.id}`);
  }

  try {
    await procesar(evento);
    await q('update whop_eventos set procesado_at = now(), error = null where webhook_id = $1', [evento.id]);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] error procesando ${evento.type} ${evento.id}:`, motivo);
    await q('update whop_eventos set error = $2 where webhook_id = $1', [evento.id, motivo]).catch(() => {});
    // 200 a propósito: ver el punto 2 del comentario de arriba.
    return new NextResponse('OK (con error, queda para reprocesar)', { status: 200 });
  }

  return new NextResponse('OK', { status: 200 });
}

async function procesar(evento: EventoWhop): Promise<void> {
  switch (evento.type) {
    // `payment.created` es el que cierra la ventana del cobro huérfano: llega en
    // cuanto Whop crea el pago, así que vincula el `whop_payment_id` al cobro
    // ANTES de que se sepa si entró la plata. Sin él, un cobro cuyo POST se cortó
    // a mitad de camino se queda sin id hasta que la reconciliación lo busque en
    // el listado, 10 minutos después.
    //
    // `payment.authorized` y `payment.canceled` entran por el mismo camino:
    // `mapearEstado` los resuelve por `substatus` y, si no reconoce el valor,
    // devuelve 'procesando' — nunca 'fallido' por no saber.
    case 'payment.created':
    case 'payment.pending':
    case 'payment.authorized':
    case 'payment.succeeded':
    case 'payment.failed':
    case 'payment.canceled':
      await manejarPago(evento);
      break;

    case 'refund.created':
    case 'refund.updated':
      await manejarReembolso(evento);
      break;

    case 'dispute.created':
    case 'dispute.updated':
    // `dispute_alert.created` es el aviso PREVIO de la red de tarjetas: llega
    // antes de que la disputa exista y da margen para reembolsar y evitar el
    // contracargo. Se anota en la misma columna porque para el panel es lo mismo
    // que hay que mirar: hay plata en riesgo en este cobro.
    case 'dispute_alert.created':
      await manejarDisputa(evento);
      break;

    default:
      // No es un error: el webhook puede tener más eventos suscritos de los que
      // se usan. Se anota y se sigue.
      console.log(`[webhook] evento sin handler: ${evento.type}`);
  }
}

/**
 * El pago que llega en el evento, ya normalizado por `normalizarPago`.
 *
 * ── El bug que esto arregla ─────────────────────────────────────────────────
 * Antes se leía `evento.data` directo, asumiendo la forma anidada
 * (`member: {id}`, `payment_method: {id}`, `user: {email}`, `settlement_amount`).
 * Esa es la forma que devuelve `GET /payments/{id}` con `Api-Version-Date:
 * 2026-08-21-1` — verificado el 2026-09-10 contra la API real.
 *
 * Pero **la forma del payload del webhook la decide el `api_version_date` con el
 * que se creó el webhook**, y el ejemplo de `payment.succeeded` de la doc
 * (pinneado a `2026-09-09`) es PLANO: `member_id`, `payment_method_id`,
 * `customer_email`, `plan_id`, y sin `settlement_amount` — el importe solo viene
 * como `total: {amount: "50.00"}`.
 *
 * Con esa forma, el handler viejo guardaba:
 *   · `whop_member_id` → NULL
 *   · `whop_payment_method_id` → NULL  ← **cero upsells one-click**
 *   · `email` → NULL
 *   · `monto` → NULL, y entonces `armarPayloadIngest` omite la venta por "no
 *     tiene monto": no llega al dashboard ni aparece en los números
 *
 * Y la versión no se puede elegir: crear el webhook por API pide el scope
 * `developer:manage_webhook`, que en esta key está en **false** (verificado), así
 * que se crea desde el dashboard y la versión la pone Whop.
 */
async function manejarPago(evento: EventoWhop): Promise<void> {
  const pago = normalizarPago(evento.data);
  if (!pago.id) throw new Error('el pago del evento no tiene id');

  // 1. Si ya existe un cobro para este pago, es un upsell que disparamos
  //    nosotros (o un reintento del webhook del front).
  const existente = await buscarCobroPorPagoWhop(pago.id);
  if (existente) {
    const { status, cambio } = await aplicarEstadoDePago(existente, pago);
    if (cambio && status === 'pagado') {
      await encolarSalida(existente.id, { motivo: 'pago_confirmado', pago_id: pago.id });
    }
    return;
  }

  // 2. Si no, hay que ver a qué orden pertenece. El caso normal es la compra del
  //    front cuando el comprador cerró la pestaña antes de que corriera el claim:
  //    esta es la red de seguridad que igual le da el producto.
  const orden = await resolverOrdenDePago(pago);
  if (!orden) {
    // Un pago de Whop que no salió de este checkout (una venta desde la página
    // de Whop, por ejemplo). No es un error.
    console.log(`[webhook] pago sin orden asociada, se ignora: ${pago.id}`);
    return;
  }

  await guardarMetodoDePago(orden.id, {
    memberId: pago.member?.id,
    paymentMethodId: pago.payment_method?.id,
    userId: pago.user?.id,
    email: pago.user?.email,
  });

  const cobro = await registrarCobroDelFront(orden, pago);
  if (!cobro) {
    throw new Error(`no se pudo registrar el cobro del front de la orden ${orden.id}`);
  }

  const { status, cambio } = await aplicarEstadoDePago(cobro, pago);
  if (cambio && status === 'pagado') {
    await encolarSalida(cobro.id, { motivo: 'pago_confirmado', pago_id: pago.id });
  }
}

async function manejarReembolso(evento: EventoWhop): Promise<void> {
  // El objeto Refund referencia el pago. Se prueban las dos formas en las que
  // puede venir para no depender de una sola.
  const data = evento.data as { payment?: { id?: string }; payment_id?: string };
  const pagoId = data.payment?.id ?? data.payment_id;
  if (!pagoId) {
    console.log('[webhook] reembolso sin id de pago, se ignora');
    return;
  }

  // El cobro NO pasa a 'fallido': la plata entró y después salió. Son dos
  // hechos distintos y hay que poder distinguirlos en el panel.
  const filas = await qCount(
    'update cobros set reembolsado_at = coalesce(reembolsado_at, now()), updated_at = now() where whop_payment_id = $1',
    [pagoId],
  );

  if (filas > 0) {
    await encolarSalida(null, { motivo: 'reembolso', pago_id: pagoId });
  }
}

async function manejarDisputa(evento: EventoWhop): Promise<void> {
  const data = evento.data as { payment?: { id?: string }; payment_id?: string; id?: string };
  const pagoId = data.payment?.id ?? data.payment_id;

  if (pagoId) {
    await q(
      'update cobros set disputa_at = coalesce(disputa_at, now()), updated_at = now() where whop_payment_id = $1',
      [pagoId],
    );
  }

  // Una disputa no se automatiza: se avisa y la resuelve una persona.
  await encolarSalida(null, { motivo: 'disputa', pago_id: pagoId ?? null, disputa_id: data.id ?? null });
}
