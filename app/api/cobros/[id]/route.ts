/**
 * GET /api/cobros/[id] — el polling que usa el `loader.js` para saber en qué
 * quedó un cobro que se disparó con `POST /api/upsell/cobrar`.
 *
 * Contrato: mismo `RespuestaCobro` de §5/§4 del plan. Es público (no hay
 * sesión ni CORS restringido — lo llama el propio browser del comprador
 * mientras hace polling, no un origen de terceros) y recibe un uuid al azar,
 * así que NO expone nada que un uuid adivinado no debiera ver: nunca el
 * `decline_code` crudo (contarle a quien está probando tarjetas que el banco
 * detectó fraude es regalarle información), nunca datos de otra orden más
 * allá de estado/monto/mensaje.
 */
import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';
import { resolverSiguienteUrl, resultadoDeEstado } from '@/lib/funnels';
import { aplicarEstadoDePago, encolarSalida } from '@/lib/cobros';
import { esFinal, mensajeParaComprador, clasificarDecline } from '@/lib/estado-pago';
import { obtenerPago, WhopError } from '@/lib/whop';
import type { Cobro, RespuestaCobro } from '@/lib/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const { id } = params;

  // Un id que no tiene forma de uuid no puede ser un cobro real. Cortarlo acá
  // evita mandarle basura a Postgres, que igual lo rechazaría con un error de
  // tipo — pero ese error no dice "no existe", dice "invalid input syntax", y
  // filtra detalles internos que no le sirven a nadie de afuera.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  let cobro = await q1<Cobro>(
    `select id, orden_id, pagina_id, producto_id, whop_plan_id, whop_payment_id, status,
            decline_code, failure_message, idempotency_key, monto, moneda, origen,
            reembolsado_at, disputa_at, email_enviado_at, created_at, updated_at
       from cobros
      where id = $1`,
    [id],
  );

  if (!cobro) {
    return NextResponse.json({ error: 'pagina_inexistente' }, { status: 404 });
  }

  // El token de la orden, para pegárselo a la URL del paso siguiente. Va en la
  // respuesta de un endpoint público, pero es el token de ESTA orden y el que
  // pregunta ya tiene el id del cobro: no se filtra nada que no tuviera.
  const orden = await q1<{ token: string }>('select token from ordenes where id = $1', [cobro.orden_id]);
  if (!orden) {
    // Un cobro sin orden no debería existir (la FK es `on delete cascade`), pero
    // si pasa, es mejor un 404 que resolver un destino sin token.
    return NextResponse.json({ error: 'pagina_inexistente' }, { status: 404 });
  }

  // 1. Si ya está en un estado final, no hay que preguntarle nada a Whop: se
  // devuelve tal cual está. Es lo que hace que el polling pare de pegarle a la
  // API externa en cuanto el cobro se resolvió.
  if (esFinal(cobro.status)) {
    return NextResponse.json(await respuesta(cobro, orden.token));
  }

  // 2. Todavía no está resuelto. Si no hay whop_payment_id, no hay nada que
  // consultar (el cobro está en 'creando', el POST original puede seguir en
  // vuelo) — se devuelve el estado actual sin llamar a Whop.
  if (!cobro.whop_payment_id) {
    return NextResponse.json(await respuesta(cobro, orden.token));
  }

  // 3. Consultar a Whop y aplicar el estado con la misma función que usa el
  // webhook — es monótona e idempotente, así que no importa si el webhook y
  // este poll llegan casi al mismo tiempo: el que escriba segundo no pisa una
  // decisión más nueva (aplicarEstadoDePago lleva el estado anterior en el
  // WHERE).
  try {
    const pago = await obtenerPago(cobro.whop_payment_id);
    const { status, cambio } = await aplicarEstadoDePago(cobro, pago);

    if (cambio) {
      cobro = { ...cobro, status, decline_code: pago.decline_code ?? cobro.decline_code };
      if (status === 'pagado') {
        await encolarSalida(cobro.id, { motivo: 'pago_confirmado', pago_id: cobro.whop_payment_id });
      }
    }
  } catch (err) {
    // Si Whop no responde (timeout, 5xx), no hay que inventar un estado: se
    // devuelve el que ya está en la base y que el próximo poll o el webhook lo
    // resuelvan. Nunca se marca fallido por no haber podido preguntar.
    const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
    console.warn(`[cobros/${id}] no se pudo consultar a Whop, se devuelve el estado actual: ${motivo}`);
  }

  return NextResponse.json(await respuesta(cobro, orden.token));
}

/**
 * Igual criterio que `respuestaDesdeCobro` de `app/api/upsell/cobrar/route.ts`:
 * un `fallido` sin `decline_code` no vino de un decline de tarjeta (vino de un
 * 4xx de request), así que no se reusa `clasificarDecline(null)` — ese default
 * es 'pedir_tarjeta' y el mensaje de 3DS no describe lo que pasó.
 */
async function respuesta(cobro: Cobro, token: string): Promise<RespuestaCobro> {
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

  // El destino lo decide `lib/funnels.ts`, no este endpoint. Antes leía
  // `url_exito`/`url_rechazo` de la página directo, con dos consecuencias: no
  // sabía nada de funnels, y no le pegaba el token a la URL —lo cual funcionaba
  // solo mientras toda la cadena viviera en el mismo origen que guardó el
  // sessionStorage.
  //
  // `resultadoDeEstado` devuelve null para `procesando`, `creando` y
  // `requiere_tarjeta`: en esos casos todavía no hay destino y el loader sigue
  // puleando. Ojo con `requiere_tarjeta`, que NO es un rechazo: el comprador
  // quiso pagar y el banco pidió autenticación.
  const resultado = resultadoDeEstado(cobro.status);
  const siguienteUrl = resultado ? await resolverSiguienteUrl(cobro.pagina_id, resultado, token) : null;

  return {
    cobroId: cobro.id,
    estado: cobro.status,
    siguienteUrl,
    mensaje,
    pedirTarjeta: cobro.status === 'requiere_tarjeta',
    // La sesión de recuperación no se crea acá en cada poll — evita gastar una
    // checkout configuration nueva por cada uno de los hasta 15 intentos del
    // loader. El loader, al ver pedirTarjeta:true, redirige a la página de
    // checkout (T03) con ?r=1, que es quien crea la sesión de recuperación.
    sessionIdRecuperacion: null,
  };
}
