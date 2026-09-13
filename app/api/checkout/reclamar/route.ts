/**
 * POST /api/checkout/reclamar — el claim sincrónico (D8 del plan).
 *
 * body: { ordenId, receiptId }
 * 200:  { ok: true, siguienteUrl: string | null }
 * 200:  { ok: false, motivo: 'no_pagado' }
 *
 * Por qué es sincrónico y no espera al webhook: si dependiera de él, la
 * persona llegaría a la página de upsell antes de que exista su
 * `payment_method_id`, y el one-click fallaría con `sin_metodo_guardado` de
 * forma intermitente e irreproducible. El webhook sigue existiendo como red
 * de seguridad para quien cierra la pestaña antes de que esto corra.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aplicarEstadoDePago, encolarSalida, guardarMetodoDePago, registrarCobroDelFront } from '@/lib/cobros';
import { q1 } from '@/lib/db';
import { normalizarEmail } from '@/components/checkout/utils';
import { resolverSiguienteUrl } from '@/lib/funnels';
import { obtenerPago, WhopError } from '@/lib/whop';
import type { Orden } from '@/lib/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  ordenId: z.string().uuid(),
  receiptId: z.string().min(1).max(200),
  /**
   * Solo en modo recuperación (T03 §7): el slug de la página de UPSELL que se
   * está recuperando, que no es la página donde se creó la orden. Sin esto,
   * `registrarCobroDelFront` y la `url_exito` de abajo apuntarían siempre al
   * front, y D3 exige que el cobro de recuperación quede contra la página del
   * upsell — es el mismo (orden_id, pagina_id) que ya existe en `cobros` con
   * status `requiere_tarjeta`, y el índice único de D1 lo exige así.
   */
  slugPaginaActual: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request): Promise<Response> {
  let bodyCrudo: unknown;
  try {
    bodyCrudo = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(bodyCrudo);
  if (!parsed.success) {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }
  const { ordenId, receiptId, slugPaginaActual } = parsed.data;

  const orden = await q1<Orden>(
    `select id, pagina_id, email, nombre, token, token_expira_at, whop_member_id,
            whop_payment_method_id, whop_user_id, whop_checkout_config_id, metodo_guardado,
            session_id, visitor_id, utms, created_at, updated_at
       from ordenes where id = $1`,
    [ordenId],
  );
  if (!orden) {
    return NextResponse.json({ error: 'pagina_inexistente' }, { status: 404 });
  }

  // Si vino `slugPaginaActual` (modo recuperación), el cobro y la url_exito se
  // resuelven contra ESA página, no contra `orden.pagina_id` (la del front
  // original). Un slug inexistente cae al comportamiento normal: se ignora y
  // se sigue con la página de la orden, en vez de romper un claim que por lo
  // demás es válido.
  let paginaIdEfectiva = orden.pagina_id;
  if (slugPaginaActual) {
    const paginaActual = await q1<{ id: string }>(
      'select id from paginas where slug = $1 and activo = true',
      [slugPaginaActual],
    );
    if (paginaActual) paginaIdEfectiva = paginaActual.id;
  }
  const ordenParaCobro: Orden = { ...orden, pagina_id: paginaIdEfectiva };

  // 1. Traer el pago real desde Whop. Nunca se confía en lo que el cliente
  //    dice que pasó: el receiptId solo sirve para saber A QUÉ pago mirar.
  //
  //    Un 404 de Whop (el receiptId no existe) NUNCA puede pertenecer a esta
  //    orden: se rechaza con 404 propio, igual que un receiptId ajeno se
  //    rechaza con 403 más abajo. Ninguno de los dos es "no pagado todavía" —
  //    eso solo aplica cuando el pago SÍ existe pero su estado no es pagado.
  //    Un error transitorio (timeout, 5xx de Whop) sí cae en el 200 silencioso,
  //    porque ahí el pago puede ser real y la falla es nuestra, no del
  //    request: no tiene sentido mostrarle un error de red al comprador que
  //    ya pagó bien.
  let pago;
  try {
    pago = await obtenerPago(receiptId);
  } catch (err) {
    if (err instanceof WhopError && err.status === 404) {
      console.warn(`[checkout/reclamar] receiptId inexistente en Whop: orden=${orden.id} receiptId=${receiptId}`);
      return NextResponse.json({ error: 'pagina_inexistente' }, { status: 404 });
    }
    const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
    console.error(`[checkout/reclamar] no se pudo obtener el pago ${receiptId} de la orden ${ordenId}:`, motivo);
    return NextResponse.json({ ok: false, motivo: 'no_pagado' }, { status: 200 });
  }

  // 2. Verificar que el pago sea DE ESTA orden. Alguien mandando un receiptId
  //    ajeno para conseguir un token válido es exactamente el ataque que esto
  //    frena: sin este chequeo, cualquiera con un receiptId propio (de una
  //    compra de un dólar en Whop, por ejemplo) podría intentar "reclamar"
  //    contra la orden de otra persona.
  //
  // ── Tres caminos, en orden de fuerza ──────────────────────────────────────
  // Los primeros dos son un vínculo EXACTO por id: solo pueden dar falso
  // negativo (no encontrar el vínculo aunque exista), nunca falso positivo.
  // Siguen existiendo para el modo recuperación, que crea la checkout
  // configuration y sí tiene `metadata.orden_id` disponible.
  //
  // El tercero es nuevo (BITACORA.md 2026-09-13): el checkout normal ya no
  // pasa por una checkout configuration (ver `checkout/sesion/route.ts`), así
  // que el pago no lleva ningún id que lo ate a esta orden en particular. Sin
  // eso, la única señal disponible es que el EMAIL coincida y que el pago se
  // haya creado DESPUÉS de que esta orden se creó, dentro de la ventana de
  // validez del token (2 horas, ver `HORAS_VALIDEZ_TOKEN` en sesion/route.ts).
  //
  // Es deliberadamente más débil que un id exacto: dos personas con el MISMO
  // email comprando el MISMO producto en la MISMA ventana de un par de
  // minutos podrían, en teoría, cruzarse. Se acepta ese riesgo residual
  // porque: (a) el `receiptId` en sí ya prueba que ALGUIEN pagó ese monto
  // exacto — no es un ataque de "inventar un pago", es a lo sumo "reclamar el
  // pago de otro con el mismo email y casi el mismo instante", que además
  // requiere conocer el `ordenId` (UUID de 128 bits, no viaja en la URL
  // pública) y no gana nada: el "atacante" solo consigue que SU PROPIO pago
  // active el token de ALGUIEN MÁS, no al revés. Y (b) es el trade-off
  // explícito por el que se sacó la checkout configuration del camino
  // normal — la alternativa (mantenerla) es la causa sospechada de que el
  // upsell one-click nunca haya podido cobrar (diez hipótesis descartadas,
  // ver BITACORA.md 2026-09-11).
  const ordenIdDelPago = pago.metadata?.orden_id;
  const porIdExacto =
    (typeof ordenIdDelPago === 'string' && ordenIdDelPago === orden.id) ||
    (orden.whop_checkout_config_id !== null && pago.checkout_configuration_id === orden.whop_checkout_config_id);

  const emailDelPago = pago.user?.email ? normalizarEmail(pago.user.email) : null;
  const pagoEsPosteriorALaOrden = pago.paid_at
    ? new Date(pago.paid_at).getTime() >= orden.created_at.getTime()
    : false;
  const porEmailYVentana =
    !porIdExacto &&
    orden.whop_checkout_config_id === null && // solo aplica al checkout normal, nunca a recuperación
    emailDelPago !== null &&
    orden.email !== null &&
    emailDelPago === normalizarEmail(orden.email) &&
    pagoEsPosteriorALaOrden &&
    new Date() <= orden.token_expira_at;

  const pertenece = porIdExacto || porEmailYVentana;

  if (!pertenece) {
    console.warn(
      `[checkout/reclamar] receiptId ajeno: orden=${orden.id} receiptId=${receiptId} ` +
        `metadata.orden_id=${String(ordenIdDelPago)} checkout_configuration_id=${pago.checkout_configuration_id} ` +
        `email_pago=${emailDelPago} email_orden=${orden.email}`,
    );
    return NextResponse.json({ error: 'pagina_inexistente' }, { status: 403 });
  }

  if (porEmailYVentana) {
    console.log(`[checkout/reclamar] orden ${orden.id}: pertenencia resuelta por email+ventana (sin configuration)`);
  }

  // 3. Verificar que esté pago de verdad. Dar acceso por un pago `pending`
  //    regala el producto si después rebota.
  const { mapearEstado } = await import('@/lib/estado-pago');
  const estado = mapearEstado(pago);
  if (estado !== 'pagado') {
    return NextResponse.json({ ok: false, motivo: 'no_pagado' }, { status: 200 });
  }

  // 4. Guardar el método de pago y registrar el cobro del front. Las dos son
  //    idempotentes: si el webhook ya corrió, esto no duplica nada.
  await guardarMetodoDePago(orden.id, {
    memberId: pago.member?.id,
    paymentMethodId: pago.payment_method?.id,
    userId: pago.user?.id,
    email: pago.user?.email,
  });

  const cobro = await registrarCobroDelFront(ordenParaCobro, pago);
  if (cobro) {
    const { cambio, status } = await aplicarEstadoDePago(cobro, pago);
    // 5. Encolar la salida solo si el cobro cambió de estado: si el webhook ya
    //    lo había marcado pagado, no hay nada nuevo que avisar.
    if (cambio && status === 'pagado') {
      await encolarSalida(cobro.id, { motivo: 'pago_confirmado', pago_id: pago.id });
    }
  }

  // 6. Resolver a dónde va el comprador, con el grafo del funnel.
  //
  //    Antes esto leía `url_exito` de la página directo. Ahora lo decide
  //    `lib/funnels.ts`, que sabe si la página pertenece a un funnel (y entonces
  //    manda a la `url_externa` del paso destino, o a la página de gracias) o si
  //    es una página suelta de las de antes (y entonces usa `url_exito`, igual
  //    que siempre). Los cuatro endpoints que resolvían esto por su cuenta usan
  //    la misma función: si cada uno decidiera distinto, el comprador terminaría
  //    en una página diferente según qué endpoint lo resolvió primero.
  //
  //    En modo recuperación se resuelve sobre la página del upsell
  //    (`paginaIdEfectiva`), no la del front (T03 §7 regla 5).
  const siguienteUrl = await resolverSiguienteUrl(paginaIdEfectiva, 'aceptado', orden.token);

  return NextResponse.json({ ok: true, siguienteUrl }, { status: 200 });
}
