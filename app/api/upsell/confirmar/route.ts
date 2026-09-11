/**
 * `POST /api/upsell/confirmar` — registra un upsell que el comprador pagó con el
 * botón de wallet EN EL FUNNEL, y devuelve a dónde sigue.
 *
 * Es la contraparte de `/api/upsell/sesion`. El flujo completo del toque único:
 *
 *   1. el funnel pide una sesión         → POST /api/upsell/sesion
 *   2. el comprador toca Apple Pay       → el wallet cobra, en su browser
 *   3. el funnel confirma con el recibo  → POST /api/upsell/confirmar  (acá)
 *   4. el funnel redirige a `siguienteUrl`
 *
 * ── Por qué no se reusa `/api/checkout/reclamar` ────────────────────────────
 * Hace casi lo mismo, pero es same-origin: lo llama la página de checkout de
 * este servicio, no un funnel en otro dominio. Agregarle CORS ampliaría la
 * superficie de un endpoint que hoy no la necesita, y encima recibe `ordenId`
 * mientras que del lado del funnel lo único que hay es el token de la URL.
 *
 * Este endpoint usa el token, igual que sus dos hermanos de `/api/upsell/*`, y
 * comparte con ellos las cuatro guardas en el mismo orden.
 *
 * ── El cobro se crea DESPUÉS del pago, y acá está bien ──────────────────────
 * `/api/upsell/cobrar` inserta la fila ANTES de llamar a Whop, porque ahí lo
 * único que impide el doble cobro es el índice único de la base (D1 del plan).
 *
 * Acá es al revés y no es una inconsistencia: el cobro ya ocurrió del lado de
 * Whop antes de que este endpoint exista en la conversación, y lo que se está
 * registrando es un hecho consumado. Lo que impide duplicar la FILA es el mismo
 * índice único `(orden_id, pagina_id)`, con `on conflict do nothing`: si el
 * comprador vino por el botón verde primero (dejando un `requiere_tarjeta`) y
 * después pagó con el wallet, se actualiza esa fila en vez de crear otra.
 */
import { NextResponse } from 'next/server';
import { headersCors } from '@/lib/cors';
import { resolverToken } from '@/lib/token';
import { q, q1 } from '@/lib/db';
import { crearLimitador, ipDelRequest } from '@/lib/rate-limit';
import { aplicarEstadoDePago, buscarCobro, encolarSalida, guardarMetodoDePago } from '@/lib/cobros';
import { resolverSiguienteUrl } from '@/lib/funnels';
import { mapearEstado } from '@/lib/estado-pago';
import { obtenerPago, WhopError } from '@/lib/whop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limitador = crearLimitador(20);

type PaginaConfirmar = {
  id: string;
  tipo: 'front' | 'upsell';
  activo: boolean;
  producto_id: string;
  whop_plan_id: string;
  funnel_id: string | null;
  funnel_de_la_orden: string | null;
};

export async function OPTIONS(req: Request): Promise<Response> {
  const cors = await headersCors(req.headers.get('origin'));
  return new NextResponse(null, { status: 204, headers: cors ?? {} });
}

export async function POST(req: Request): Promise<Response> {
  const cors = await headersCors(req.headers.get('origin'));
  if (!cors) return NextResponse.json({ error: 'origen_no_autorizado' }, { status: 403 });
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: cors });

  if (limitador.excede(ipDelRequest(req))) return json({ error: 'demasiados_intentos' }, 429);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'payload_invalido' }, 400);
  }
  if (typeof payload !== 'object' || payload === null) return json({ error: 'payload_invalido' }, 400);

  const { token, slug, receiptId } = payload as {
    token?: unknown;
    slug?: unknown;
    receiptId?: unknown;
  };
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 200) {
    return json({ error: 'payload_invalido' }, 400);
  }
  if (typeof receiptId !== 'string' || receiptId.length === 0 || receiptId.length > 200) {
    return json({ error: 'payload_invalido' }, 400);
  }

  const resuelto = await resolverToken(token);
  if (!resuelto.ok) {
    return json({ error: resuelto.motivo === 'vencido' ? 'token_vencido' : 'token_invalido' }, 401);
  }
  const orden = resuelto.orden;

  const pagina = await q1<PaginaConfirmar>(
    `select pg.id, pg.tipo, pg.producto_id, pr.whop_plan_id, pg.funnel_id,
            (select funnel_id from paginas where id = $2) as funnel_de_la_orden,
            (pg.activo and (pg.funnel_id is null or f.activo)) as activo
       from paginas pg
       join productos pr on pr.id = pg.producto_id
       left join funnels f on f.id = pg.funnel_id
      where pg.slug = $1`,
    [slug, orden.pagina_id],
  );

  if (!pagina || pagina.tipo !== 'upsell' || !pagina.activo) {
    return json({ error: 'pagina_inexistente' }, 404);
  }
  if (pagina.funnel_id !== pagina.funnel_de_la_orden) {
    return json({ error: 'pagina_inexistente' }, 404);
  }

  // ── El pago, traído de Whop ─────────────────────────────────────────────
  // NO se le cree al cliente que el pago existe ni cuánto fue: se pregunta a
  // Whop. Un `receiptId` inventado no pasa de acá.
  let pago;
  try {
    pago = await obtenerPago(receiptId);
  } catch (err) {
    const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
    console.error(`[upsell/confirmar] orden ${orden.id}: no se pudo traer el pago ${receiptId}:`, motivo);
    return json({ ok: false, motivo: 'no_pagado' }, 200);
  }

  // ── Que el pago sea DE ESTA ORDEN y DE ESTE PASO ────────────────────────
  // Sin esto, alguien con un `receiptId` propio —una compra de un dólar en
  // cualquier parte de Whop— podría "confirmar" el upsell de otra persona y
  // llevarse el producto. La metadata la puso `/api/upsell/sesion`, del lado del
  // server, así que el cliente no la puede falsificar.
  const meta = (pago.metadata ?? {}) as Record<string, unknown>;
  if (meta.orden_id !== orden.id || meta.pagina_id !== pagina.id) {
    console.warn(
      `[upsell/confirmar] recibo ajeno: orden=${orden.id} pagina=${pagina.id} recibo=${receiptId} ` +
        `metadata.orden_id=${String(meta.orden_id)} metadata.pagina_id=${String(meta.pagina_id)}`,
    );
    return json({ error: 'pagina_inexistente' }, 403);
  }

  // ── Que esté pago de verdad ─────────────────────────────────────────────
  // Un `pending` que después rebota regalaría el producto.
  if (mapearEstado(pago) !== 'pagado') {
    console.log(`[upsell/confirmar] orden ${orden.id}: el pago ${receiptId} todavía no está pagado`);
    return json({ ok: false, motivo: 'no_pagado' }, 200);
  }

  // ── Registrar el cobro ──────────────────────────────────────────────────
  // `on conflict do nothing` sin árbitro, por el mismo motivo que documenta
  // `registrarCobroDelFront`: `cobros` tiene dos índices únicos que una fila
  // duplicada viola, y nombrar solo uno deja que el otro tire un 500 en una
  // carrera. Si el comprador ya había intentado el botón verde, la fila existe
  // en `requiere_tarjeta` y esto no la duplica.
  await q(
    `insert into cobros (orden_id, pagina_id, producto_id, whop_plan_id, whop_payment_id,
                         status, idempotency_key, monto, moneda, origen)
     values ($1, $2, $3, $4, $5, 'creando', $6, $7, $8, 'upsell')
     on conflict do nothing`,
    [
      orden.id,
      pagina.id,
      pagina.producto_id,
      pagina.whop_plan_id,
      pago.id,
      `${orden.id}:${pagina.id}`,
      pago.settlement_amount ?? null,
      pago.currency ?? null,
    ],
  );

  const cobro = await buscarCobro(orden.id, pagina.id);
  if (!cobro) {
    // No debería pasar: o se insertó, o ya existía. Si igual pasa, el pago está
    // hecho y no se puede perder — el cron de reconciliación lo va a encontrar.
    console.error(`[upsell/confirmar] orden ${orden.id}: el cobro de ${slug} no aparece tras el insert`);
    return json({ ok: false, motivo: 'no_pagado' }, 200);
  }

  const { cambio, status } = await aplicarEstadoDePago(cobro, pago);

  // El wallet también guarda el método (`setupFutureUsage`), así que se aprovecha
  // para dejar la orden lista: si el off-session se destraba algún día, el paso
  // siguiente ya puede cobrarse sin ninguna interacción.
  await guardarMetodoDePago(orden.id, {
    memberId: pago.member?.id,
    paymentMethodId: pago.payment_method?.id,
    userId: pago.user?.id,
    email: pago.user?.email,
  });

  if (cambio && status === 'pagado') {
    await encolarSalida(cobro.id, { motivo: 'pago_confirmado', pago_id: pago.id });
  }

  const siguienteUrl = await resolverSiguienteUrl(pagina.id, 'aceptado', orden.token);
  console.log(`[upsell/confirmar] orden ${orden.id} slug=${slug} pago=${pago.id} → ${status}`);

  return json({ ok: true, estado: status, siguienteUrl }, 200);
}
