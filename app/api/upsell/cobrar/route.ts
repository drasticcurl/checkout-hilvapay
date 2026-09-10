/**
 * POST /api/upsell/cobrar — el cobro one-click de un upsell.
 *
 * Contrato congelado: §5 del plan. Lo consume el `loader.js` (este mismo
 * task) y, desde afuera del repo, los funnels (T06). Una vez publicado en un
 * funnel, esta forma no cambia sin redeployar el funnel.
 *
 * ESTE ES EL ENDPOINT QUE COBRA PLATA. El orden de los pasos no es
 * negociable — está numerado igual que en §4 de T04-cobro-one-click.md:
 *
 *   1. CORS
 *   2. Token
 *   3. Página (por slug, activa, tipo 'upsell')
 *   4. Método guardado
 *   5. INSERT del cobro con ON CONFLICT DO NOTHING — ANTES de llamar a Whop (D1)
 *   6. crearPagoOffSession con Idempotency-Key determinística
 *   7. Guardar whop_payment_id y el estado
 *   8. Devolver RespuestaCobro
 *
 * Invertir el orden de 5 y 6 reabre el doble cobro: si el segundo request
 * nunca llega a Whop (se cortó la red del lado nuestro), no hay nada que la
 * idempotencia de Whop pueda replayar. La única guarda real es el índice
 * único de la base, y por eso el INSERT tiene que pasar primero.
 */
import { NextResponse } from 'next/server';
import { headersCors } from '@/lib/cors';
import { resolverToken } from '@/lib/token';
import { q, q1 } from '@/lib/db';
import { aplicarEstadoDePago, buscarCobro } from '@/lib/cobros';
import { esFinal, mensajeParaComprador, clasificarDecline } from '@/lib/estado-pago';
import { crearPagoOffSession, crearCheckoutConfiguration, WhopError } from '@/lib/whop';
import type { Cobro, RespuestaCobro } from '@/lib/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La página de pago con su producto ya resuelto, lo mínimo que necesita este endpoint. */
type PaginaCobro = {
  id: string;
  tipo: 'front' | 'upsell';
  activo: boolean;
  url_exito: string | null;
  url_rechazo: string | null;
  producto_id: string;
  whop_plan_id: string;
};

export async function OPTIONS(req: Request): Promise<Response> {
  const origen = req.headers.get('origin');
  const cors = await headersCors(origen);
  // Sin headers de CORS si el origen no está autorizado: el navegador no va a
  // dejar pasar el preflight y el POST real ni se manda. Igual respondemos 204
  // — no hace falta filtrar el status del preflight, el filtro real es la
  // ausencia de los headers Allow-*.
  return new NextResponse(null, { status: 204, headers: cors ?? {} });
}

export async function POST(req: Request): Promise<Response> {
  const origen = req.headers.get('origin');

  // ── 1. CORS ─────────────────────────────────────────────────────────────
  const cors = await headersCors(origen);
  if (!cors) {
    // 403 SIN headers de CORS: el navegador no le deja al script leer ni
    // siquiera este cuerpo. Es la doble barrera — el status y la ausencia de
    // Access-Control-Allow-Origin.
    return NextResponse.json({ error: 'origen_no_autorizado' }, { status: 403 });
  }

  // A partir de acá toda respuesta lleva los headers de CORS resueltos, así
  // que definimos un helper local para no repetirlos en cada return.
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: cors });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'payload_invalido' }, 400);
  }

  if (typeof payload !== 'object' || payload === null) {
    return json({ error: 'payload_invalido' }, 400);
  }
  const { token, slug } = payload as { token?: unknown; slug?: unknown };
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 200) {
    return json({ error: 'payload_invalido' }, 400);
  }

  // ── 2. Token ────────────────────────────────────────────────────────────
  const resuelto = await resolverToken(token);
  if (!resuelto.ok) {
    return json({ error: resuelto.motivo === 'vencido' ? 'token_vencido' : 'token_invalido' }, 401);
  }
  const orden = resuelto.orden;

  console.log(`[upsell/cobrar] orden ${orden.id} slug=${slug}`);

  // ── 3. Página ───────────────────────────────────────────────────────────
  // El slug decide qué se cobra, nunca el cliente: precio y plan_id se leen
  // acá, de la base. Si vinieran del body, cualquiera con el token podría
  // cobrarse un dólar y llevarse el producto.
  const pagina = await q1<PaginaCobro>(
    `select pg.id, pg.tipo, pg.activo, pg.url_exito, pg.url_rechazo,
            pg.producto_id, pr.whop_plan_id
       from paginas pg
       join productos pr on pr.id = pg.producto_id
      where pg.slug = $1`,
    [slug],
  );

  if (!pagina) {
    return json({ error: 'pagina_inexistente' }, 404);
  }
  // Cobrar el front por esta vía saltearía el consentimiento del titular: el
  // front es el cobro on-session donde se acepta guardar la tarjeta.
  if (pagina.tipo !== 'upsell') {
    console.log(`[upsell/cobrar] orden ${orden.id}: slug=${slug} es tipo '${pagina.tipo}', no 'upsell' → 404`);
    return json({ error: 'pagina_inexistente' }, 404);
  }
  if (!pagina.activo) {
    return json({ error: 'pagina_inactiva' }, 404);
  }

  // ── 4. Método guardado ──────────────────────────────────────────────────
  if (!orden.metodo_guardado || !orden.whop_member_id || !orden.whop_payment_method_id) {
    console.log(`[upsell/cobrar] orden ${orden.id}: sin método guardado, se pide la tarjeta`);
    // Esa persona pagó el front con algo que no se puede guardar (no es un
    // error). Se le crea una sesión de checkout nueva para que pase la
    // tarjeta una vez, igual que en la recuperación de D3.
    let sessionIdRecuperacion: string | null = null;
    try {
      const config = await crearCheckoutConfiguration({
        planId: pagina.whop_plan_id,
        metadata: { orden_id: orden.id, pagina_id: pagina.id },
      });
      sessionIdRecuperacion = config.id;
    } catch (err) {
      console.error(`[upsell/cobrar] orden ${orden.id}: no se pudo crear la sesión de recuperación:`, err);
    }
    return json(
      {
        error: 'sin_metodo_guardado',
        cobroId: null,
        estado: 'requiere_tarjeta',
        siguienteUrl: null,
        mensaje: 'Ingresá los datos de tu tarjeta para completar esta compra.',
        pedirTarjeta: true,
        sessionIdRecuperacion,
      },
      409,
    );
  }

  // ── 5. INSERT con ON CONFLICT DO NOTHING — ANTES de llamar a Whop (D1) ──
  // Esto es lo único que garantiza el anti-doble-cobro. Si el INSERT no
  // insertó, alguien más (el mismo click duplicado, u otra pestaña) ya
  // insertó primero: se lee ESE cobro y no se llama a Whop de nuevo.
  const idempotencyKey = `${orden.id}:${pagina.id}`;
// `on conflict do nothing` SIN declarar el árbitro, a propósito.
//
// `cobros` tiene DOS índices únicos que una misma fila duplicada viola:
// `(orden_id, pagina_id)` y `idempotency_key` (que se deriva de los dos).
// Con `on conflict (orden_id, pagina_id)` Postgres solo suprime ESE
// conflicto: si la inserción concurrente choca primero con el índice de
// idempotencia, levanta `duplicate key value violates unique constraint` y
// el request muere con 500.
//
// Medido el 2026-09-10 con 5 POST simultáneos: 3 devolvieron 200 y 2 dieron
// 500. La protección contra el doble cobro funcionaba igual (quedó una sola
// fila), pero el comprador que hacía doble click veía un error habiendo
// pagado bien. Sin árbitro se suprime el conflicto de cualquier índice único.
  await q(
    `insert into cobros (orden_id, pagina_id, producto_id, whop_plan_id, status, idempotency_key, origen)
     values ($1, $2, $3, $4, 'creando', $5, 'upsell')
     on conflict do nothing`,
    [orden.id, pagina.id, pagina.producto_id, pagina.whop_plan_id, idempotencyKey],
  );

  let cobro = await buscarCobro(orden.id, pagina.id);
  if (!cobro) {
    // No debería poder pasar: el INSERT de arriba con ON CONFLICT garantiza
    // que la fila existe después de ejecutarse, sea porque la creó él o porque
    // ya estaba. Si esto se dispara, es un bug en otro lado (el índice no
    // existe, la migración no corrió) y hay que fallar fuerte en vez de
    // improvisar un segundo cobro.
    console.error(`[upsell/cobrar] orden ${orden.id}: el cobro no está ni se pudo crear`);
    return json({ error: 'payload_invalido' }, 500);
  }

  // Si el cobro YA tiene un whop_payment_id o ya está en un estado final, es
  // un click repetido (doble click, reintento del navegador, cinco requests
  // concurrentes) sobre un cobro que otro request ya procesó o está
  // procesando. Se devuelve el estado actual y NO SE LLAMA A WHOP: es la regla
  // que impide el doble cobro real.
  if (cobro.whop_payment_id || esFinal(cobro.status)) {
    console.log(`[upsell/cobrar] orden ${orden.id}: cobro ${cobro.id} ya existía (status=${cobro.status}), no se llama a Whop`);
    return json(respuestaDesdeCobro(cobro, pagina), 200);
  }

  // ── 6. Llamar a Whop ─────────────────────────────────────────────────────
  let pago;
  try {
    pago = await crearPagoOffSession({
      planId: pagina.whop_plan_id,
      memberId: orden.whop_member_id,
      paymentMethodId: orden.whop_payment_method_id,
      metadata: { orden_id: orden.id, pagina_id: pagina.id },
      idempotencyKey,
    });
  } catch (err) {
    return json(
      await manejarErrorWhop(err, cobro, pagina, orden.whop_member_id, orden.whop_payment_method_id),
      200,
    );
  }

  // ── 7. Guardar el estado ─────────────────────────────────────────────────
  const { status } = await aplicarEstadoDePago(cobro, pago);
  cobro = (await buscarCobro(orden.id, pagina.id)) ?? { ...cobro, status };

  // ── 8. RespuestaCobro ────────────────────────────────────────────────────
  return json(respuestaDesdeCobro(cobro, pagina), 200);
}

/**
 * Traduce el error que tiró `crearPagoOffSession` al cobro que hay que dejar
 * escrito. Tabla de la sección 4 del task, y la regla que la resume: ante la
 * duda, `procesando`, nunca `fallido`. Un cobro marcado fallido que en
 * realidad entró le niega el producto a alguien que pagó, y no hay forma de
 * detectarlo salvo que la persona reclame.
 */
async function manejarErrorWhop(
  err: unknown,
  cobro: Cobro,
  pagina: PaginaCobro,
  memberId: string,
  paymentMethodId: string,
): Promise<RespuestaCobro> {
  if (!(err instanceof WhopError)) {
    // Un error que no vino de Whop (un bug nuestro, por ejemplo). No sabemos
    // si el request salió: procesando, y que el polling lo resuelva.
    console.error(`[upsell/cobrar] cobro ${cobro.id}: error no-WhopError llamando a Whop:`, err);
    await marcarProcesando(cobro.id);
    return respuestaProcesando(cobro, pagina);
  }

  if (err.indeterminado) {
    // 409: el resultado del request original quedó indeterminado. NO se
    // reintenta con clave nueva — el cobro pudo haber salido igual. Se deja en
    // procesando y el polling (que consulta a Whop) lo resuelve.
    console.warn(`[upsell/cobrar] cobro ${cobro.id}: 409 de Whop, indeterminado → procesando`);
    await marcarProcesando(cobro.id);
    return respuestaProcesando(cobro, pagina);
  }

  if (err.reintentable) {
    // 5xx o 429. Se reintenta UNA vez con la MISMA clave de idempotencia — si
    // el primer request sí llegó a procesarse en Whop, el reintento con la
    // misma clave devuelve la respuesta guardada (Idempotent-Replayed) en vez
    // de cobrar de nuevo.
    console.warn(`[upsell/cobrar] cobro ${cobro.id}: ${err.status} de Whop, reintentable, un reintento`);
    try {
      const pago = await crearPagoOffSession({
        planId: pagina.whop_plan_id,
        memberId,
        paymentMethodId,
        metadata: { orden_id: cobro.orden_id, pagina_id: cobro.pagina_id },
        idempotencyKey: cobro.idempotency_key,
      });
      const { status } = await aplicarEstadoDePago(cobro, pago);
      const actualizado = await buscarCobro(cobro.orden_id, cobro.pagina_id);
      return respuestaDesdeCobro(actualizado ?? { ...cobro, status }, pagina);
    } catch {
      // El reintento también falló: procesando, nunca fallido, por la misma
      // razón que el 409.
      console.warn(`[upsell/cobrar] cobro ${cobro.id}: el reintento también falló → procesando`);
      await marcarProcesando(cobro.id);
      return respuestaProcesando(cobro, pagina);
    }
  }

  if (err.status >= 500 || err.status === 503) {
    // network_error sintético de lib/whop.ts (timeout o red caída). El request
    // PUDO haber llegado a Whop aunque nosotros no viéramos la respuesta.
    //
    // Nota: en la práctica esta rama es inalcanzable — `WhopError.reintentable`
    // ya cubre `status >= 500` (incluido el 503 sintético de timeout/red) y
    // `status === 429`, y ese caso se maneja arriba con el reintento. Se deja
    // como red de seguridad explícita: si algún día `reintentable` cambia de
    // definición, este caso NO puede caer en el "fallido" genérico de abajo.
    console.warn(`[upsell/cobrar] cobro ${cobro.id}: timeout/red hablando con Whop → procesando`);
    await marcarProcesando(cobro.id);
    return respuestaProcesando(cobro, pagina);
  }

  // Cualquier otro 4xx: acá sí es un rechazo real y determinado (datos
  // inválidos, permiso faltante, decline claro devuelto como error de
  // request). Se marca fallido con el mensaje.
  console.log(`[upsell/cobrar] cobro ${cobro.id}: ${err.status} de Whop → fallido (${err.message})`);
  await q(
    `update cobros set status = 'fallido', failure_message = $2, updated_at = now()
      where id = $1 and status not in ('pagado')`,
    [cobro.id, err.message.slice(0, 500)],
  );
  const actualizado = await buscarCobro(cobro.orden_id, cobro.pagina_id);
  return respuestaDesdeCobro(actualizado ?? cobro, pagina);
}

async function marcarProcesando(cobroId: string): Promise<void> {
  // Solo se mueve a 'procesando' desde 'creando': si ya está en otro estado
  // (por ejemplo el polling ya lo resolvió), no hay que pisarlo.
  await q(`update cobros set status = 'procesando', updated_at = now() where id = $1 and status = 'creando'`, [
    cobroId,
  ]);
}

function respuestaProcesando(cobro: Cobro, _pagina: PaginaCobro): RespuestaCobro {
  return {
    cobroId: cobro.id,
    estado: 'procesando',
    siguienteUrl: null,
    mensaje: 'Estamos confirmando tu pago.',
    pedirTarjeta: false,
    sessionIdRecuperacion: null,
  };
}

/**
 * Construye `RespuestaCobro` a partir de la fila de `cobros`. Nunca expone el
 * `decline_code` crudo — se traduce siempre con `mensajeParaComprador`.
 *
 * Un cobro `fallido` SIN `decline_code` no vino de un decline de Whop: vino de
 * un 4xx de request (dato inválido, credenciales, `member` inexistente — el
 * caso real es la verificación con datos falsos). `clasificarDecline(null)`
 * devuelve `'pedir_tarjeta'` como default seguro para el caso en que SÍ hubo un
 * pago pero no se reconoce el código, y ese mensaje ("tu banco necesita que
 * confirmes") no describe lo que pasó acá. Por eso ese caso usa un mensaje
 * genérico en vez de reusar la clasificación de declines.
 */
function respuestaDesdeCobro(cobro: Cobro, pagina: PaginaCobro): RespuestaCobro {
  const pedirTarjeta = cobro.status === 'requiere_tarjeta';
  const mensaje =
    cobro.status === 'requiere_tarjeta'
      ? mensajeParaComprador(clasificarDecline(cobro.decline_code))
      : cobro.status === 'fallido'
        ? cobro.decline_code
          ? mensajeParaComprador(clasificarDecline(cobro.decline_code))
          : 'No pudimos procesar el pago.'
        : cobro.status === 'procesando'
          ? 'Estamos confirmando tu pago.'
          : null;

  return {
    cobroId: cobro.id,
    estado: cobro.status,
    siguienteUrl: cobro.status === 'pagado' ? pagina.url_exito : cobro.status === 'fallido' ? pagina.url_rechazo : null,
    mensaje,
    pedirTarjeta,
    // El sessionIdRecuperacion de un cobro que ya requiere_tarjeta se resuelve
    // en el GET /api/cobros/[id] cuando haga falta el embed: acá no se crea
    // una sesión nueva en cada respuesta para no gastar una checkout
    // configuration por cada poll.
    sessionIdRecuperacion: null,
  };
}
