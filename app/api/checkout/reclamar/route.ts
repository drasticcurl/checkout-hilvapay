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
import { obtenerPago, WhopError } from '@/lib/whop';
import type { Orden, PaginaConProducto } from '@/lib/tipos';
import { armarUrlConToken } from '@/components/checkout/utils';

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
  const ordenIdDelPago = pago.metadata?.orden_id;
  const pertenece =
    (typeof ordenIdDelPago === 'string' && ordenIdDelPago === orden.id) ||
    (orden.whop_checkout_config_id !== null && pago.checkout_configuration_id === orden.whop_checkout_config_id);

  if (!pertenece) {
    console.warn(
      `[checkout/reclamar] receiptId ajeno: orden=${orden.id} receiptId=${receiptId} ` +
        `metadata.orden_id=${String(ordenIdDelPago)} checkout_configuration_id=${pago.checkout_configuration_id}`,
    );
    return NextResponse.json({ error: 'pagina_inexistente' }, { status: 403 });
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

  // 6. Resolver url_exito con ?ot=<token> agregado respetando el querystring
  //    existente (new URL, nunca concatenación con "?"). En modo recuperación
  //    es la url_exito de la página del upsell (paginaIdEfectiva), no la del
  //    front (T03 §7 regla 5).
  const paginaConUrl = await q1<Pick<PaginaConProducto, 'url_exito'>>(
    'select url_exito from paginas where id = $1',
    [paginaIdEfectiva],
  );

  let siguienteUrl: string | null = null;
  if (paginaConUrl?.url_exito) {
    try {
      siguienteUrl = armarUrlConToken(paginaConUrl.url_exito, orden.token);
    } catch {
      // url_exito mal configurada en el panel: no es un error del comprador,
      // que ya pagó. Se le devuelve null y que se quede donde está.
      console.error(`[checkout/reclamar] url_exito inválida en pagina ${orden.pagina_id}: "${paginaConUrl.url_exito}"`);
      siguienteUrl = null;
    }
  }

  return NextResponse.json({ ok: true, siguienteUrl }, { status: 200 });
}
