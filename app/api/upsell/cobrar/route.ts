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
import { crearLimitador, ipDelRequest } from '@/lib/rate-limit';
import { resolverSiguienteUrl, resolverSiguienteUrlPorFondos, resultadoDeEstado } from '@/lib/funnels';
import { aplicarEstadoDePago, buscarCobro } from '@/lib/cobros';
import { esFinal, mensajeParaComprador, clasificarDecline } from '@/lib/estado-pago';
import { crearPagoOffSession, crearCheckoutConfiguration, WhopError } from '@/lib/whop';
import { utmsParaMetadataWhop } from '@/lib/metadata-whop';
import type { Cobro, RespuestaCobro } from '@/lib/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rate limit por IP. Detectado como faltante en la auditoría del 2026-09-11: el
 * endpoint que COBRA era el único endpoint público sin ninguno, mientras
 * `/api/checkout/sesion` ya tenía el suyo.
 *
 * 10 por minuto y no 20 como el checkout: acá cada llamada que pasa las cuatro
 * guardas sale a la API de Whop. Un comprador legítimo aprieta el botón una vez,
 * dos si duda; diez ya es un bucle.
 *
 * Lo que esto frena es el bucle y el sondeo, no el doble cobro — de eso se ocupa
 * el índice único `(orden_id, pagina_id)` del paso 5, que es la única garantía
 * real y sigue estando. Ver `lib/rate-limit.ts` para qué NO cubre.
 */
const limitador = crearLimitador(10);

/** La página de pago con su producto ya resuelto, lo mínimo que necesita este endpoint. */
type PaginaCobro = {
  id: string;
  tipo: 'front' | 'upsell';
  activo: boolean;
  url_exito: string | null;
  url_rechazo: string | null;
  producto_id: string;
  whop_plan_id: string;
  /** El funnel de este paso. NULL en las páginas sueltas de antes de la migración 003. */
  funnel_id: string | null;
  /** El funnel de la orden, resuelto por la página del front que la originó. */
  funnel_de_la_orden: string | null;
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

  // ── 1b. Rate limit ──────────────────────────────────────────────────────
  // Después del CORS y ANTES de tocar la base o Whop. El orden importa: un
  // request de un origen no autorizado ya se fue en 403 sin gastar una entrada
  // del contador, así que nadie puede llenar el Map desde afuera de la
  // allowlist. Y ningún request limitado llega a hacer un SELECT.
  //
  // 429 con los headers de CORS puestos: el loader tiene que poder LEER esta
  // respuesta para no dejar el botón deshabilitado para siempre. Sin los
  // headers, el navegador le esconde el status y el `catch` del script no
  // distingue "te frené" de "se cayó la red".
  if (limitador.excede(ipDelRequest(req))) {
    console.warn(`[upsell/cobrar] rate limit excedido para ${ipDelRequest(req)}`);
    return json({ error: 'demasiados_intentos' }, 429);
  }

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
    `select pg.id, pg.tipo, pg.url_exito, pg.url_rechazo,
            pg.producto_id, pr.whop_plan_id,
            pg.funnel_id,
            -- El funnel al que pertenece la orden, resuelto por la página del
            -- front que la originó. Va como subselect y no como una segunda
            -- query para no agregar un round-trip al camino del cobro.
            (select funnel_id from paginas where id = $2) as funnel_de_la_orden,
            -- activo efectivo, no el de la fila: incluye el switch del funnel.
            (pg.activo and (pg.funnel_id is null or f.activo)) as activo
       from paginas pg
       join productos pr on pr.id = pg.producto_id
       left join funnels f on f.id = pg.funnel_id
      -- El paso está habilitado si SU switch está prendido Y, cuando pertenece a
      -- un funnel, el switch del funnel también. Es un AND y no un OR: apagar el
      -- funnel apaga sus pasos de una, que es la única razón por la que ese
      -- interruptor existe. Sin esta condición el switch del funnel no cortaría
      -- nada y daría falsa confianza justo en un incidente, que es peor que no
      -- tenerlo.
      --
      -- El left join y no un join interno: una página suelta (sin funnel_id) tiene que
      -- seguir funcionando, y con un join interno desaparecería.
      where pg.slug = $1`,
    [slug, orden.pagina_id],
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

  // ── 3b. El paso tiene que ser DE ESTE funnel ────────────────────────────
  // El comentario de `ordenes.token` en 001_init.sql dice que el token queda
  // "limitado a las páginas del funnel". La auditoría del 2026-09-11 encontró
  // que eso no se aplicaba en ninguna parte: con un token válido se podía cobrar
  // CUALQUIER paso upsell activo del sistema, incluido el de otro funnel y otro
  // producto. El daño estaba acotado por el índice único `(orden_id, pagina_id)`
  // —un cobro por paso ajeno, no infinitos— pero es más superficie de la que el
  // esquema promete, y le cobraría a alguien un producto que nunca vio.
  //
  // Se compara el funnel de la página del upsell contra el de la página del
  // front que originó la orden. Los dos NULL se acepta a propósito: son las
  // páginas sueltas de antes de la migración 003, que el README documenta como
  // todavía soportadas. Lo que no se acepta es el cruce — una suelta contra una
  // de funnel, o dos funnels distintos.
  if (pagina.funnel_id !== pagina.funnel_de_la_orden) {
    console.warn(
      `[upsell/cobrar] orden ${orden.id}: el paso ${slug} es del funnel ` +
        `${pagina.funnel_id ?? 'null'} y la orden es del ${pagina.funnel_de_la_orden ?? 'null'} → 404`,
    );
    // 404 y no 403: un 403 le confirmaría a quien prueba tokens que ese slug
    // existe y está activo, y lo mandaría a buscar de qué funnel es. Un 404 se
    // ve igual que un slug inventado.
    return json({ error: 'pagina_inexistente' }, 404);
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
        // T05 (plan panel-y-capi, D10): redundancia informativa, la fuente
        // de verdad sigue siendo orden.utms en la base propia.
        metadata: { orden_id: orden.id, pagina_id: pagina.id, ...utmsParaMetadataWhop(orden.utms) },
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
    return json(await respuestaDesdeCobro(cobro, orden.token), 200);
  }

  // ── 6. Llamar a Whop ─────────────────────────────────────────────────────
  let pago;
  try {
    pago = await crearPagoOffSession({
      planId: pagina.whop_plan_id,
      memberId: orden.whop_member_id,
      paymentMethodId: orden.whop_payment_method_id,
      // T05 (plan panel-y-capi, D10): redundancia informativa, la fuente de
      // verdad sigue siendo orden.utms en la base propia.
      metadata: { orden_id: orden.id, pagina_id: pagina.id, ...utmsParaMetadataWhop(orden.utms) },
      idempotencyKey,
    });
  } catch (err) {
    return json(
      await manejarErrorWhop(
        err,
        cobro,
        pagina,
        orden.whop_member_id,
        orden.whop_payment_method_id,
        orden.token,
        orden.utms,
      ),
      200,
    );
  }

  // ── 7. Guardar el estado ─────────────────────────────────────────────────
  const { status } = await aplicarEstadoDePago(cobro, pago);
  cobro = (await buscarCobro(orden.id, pagina.id)) ?? { ...cobro, status };

  // ── 8. RespuestaCobro ────────────────────────────────────────────────────
  return json(await respuestaDesdeCobro(cobro, orden.token), 200);
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
  // El token de la orden: hace falta para que las respuestas de acá puedan
  // resolver el destino del funnel, igual que las del camino feliz.
  token: string,
  // T05 (plan panel-y-capi, D10): las UTMs de la orden, para que los reintentos
  // y la sesión de recuperación de acá también las incluyan en metadata. Único
  // parámetro nuevo — el resto de la firma no cambia.
  utms: Record<string, string> | null,
): Promise<RespuestaCobro> {
  if (!(err instanceof WhopError)) {
    // Un error que no vino de Whop (un bug nuestro, por ejemplo). No sabemos
    // si el request salió: procesando, y que el polling lo resuelva.
    console.error(`[upsell/cobrar] cobro ${cobro.id}: error no-WhopError llamando a Whop:`, err);
    await marcarProcesando(cobro.id);
    return respuestaProcesando(cobro, token);
  }

  if (err.indeterminado) {
    // 409: el resultado del request original quedó indeterminado. NO se
    // reintenta con clave nueva — el cobro pudo haber salido igual. Se deja en
    // procesando y el polling (que consulta a Whop) lo resuelve.
    console.warn(`[upsell/cobrar] cobro ${cobro.id}: 409 de Whop, indeterminado → procesando`);
    await marcarProcesando(cobro.id);
    return respuestaProcesando(cobro, token);
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
        // T05 (plan panel-y-capi, D10): redundancia informativa.
        metadata: { orden_id: cobro.orden_id, pagina_id: cobro.pagina_id, ...utmsParaMetadataWhop(utms) },
        idempotencyKey: cobro.idempotency_key,
      });
      const { status } = await aplicarEstadoDePago(cobro, pago);
      const actualizado = await buscarCobro(cobro.orden_id, cobro.pagina_id);
      return await respuestaDesdeCobro(actualizado ?? { ...cobro, status }, token);
    } catch {
      // El reintento también falló: procesando, nunca fallido, por la misma
      // razón que el 409.
      console.warn(`[upsell/cobrar] cobro ${cobro.id}: el reintento también falló → procesando`);
      await marcarProcesando(cobro.id);
      return respuestaProcesando(cobro, token);
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
    return respuestaProcesando(cobro, token);
  }

  if (err.noSePudoProcesar) {
    // Whop aceptó el request y no pudo cobrar, sin decir por qué (ver
    // `WhopError.noSePudoProcesar`). El caso conocido es una tarjeta cuyo emisor
    // exige 3DS en cada transacción: off-session no hay nadie que pueda
    // responder el desafío, así que el cobro no llega ni a intentarse.
    //
    // Esto NO es `fallido`: en el checkout el comprador SÍ está presente y puede
    // autenticarse. Se pide la tarjeta, que es el único camino por el que esta
    // venta todavía puede entrar. Marcarlo fallido la descarta sin intentar.
    //
    // Se le crea la sesión de checkout acá y no en el cliente por lo mismo que
    // en el caso `sin_metodo_guardado`: el precio y el plan salen de la base, no
    // del browser.
    console.warn(
      `[upsell/cobrar] cobro ${cobro.id}: 400 de Whop sin código (${err.message}) → requiere_tarjeta`,
    );

    let sessionIdRecuperacion: string | null = null;
    try {
      const config = await crearCheckoutConfiguration({
        planId: pagina.whop_plan_id,
        // T05 (plan panel-y-capi, D10): redundancia informativa.
        metadata: { orden_id: cobro.orden_id, pagina_id: cobro.pagina_id, ...utmsParaMetadataWhop(utms) },
      });
      sessionIdRecuperacion = config.id;
    } catch (e) {
      // Sin sesión igual se responde `requiere_tarjeta`: el loader redirige a
      // `/pagos/<slug>?ot=…&r=1`, y esa página sabe crear su propia sesión. Es
      // peor perder el camino de recuperación que arrancar sin el id listo.
      console.error(`[upsell/cobrar] cobro ${cobro.id}: no se pudo crear la sesión de recuperación:`, e);
    }

    // `failure_message` se guarda igual aunque el estado no sea fallido: es lo
    // único que queda del motivo real, y sin eso `/admin/cobros` muestra un
    // "requiere_tarjeta" sin explicación.
    await q(
      `update cobros set status = 'requiere_tarjeta', failure_message = $2, updated_at = now()
        where id = $1 and status not in ('pagado')`,
      [cobro.id, err.message.slice(0, 500)],
    );

    const actualizado = await buscarCobro(cobro.orden_id, cobro.pagina_id);
    const base = await respuestaDesdeCobro(actualizado ?? { ...cobro, status: 'requiere_tarjeta' }, token);
    return { ...base, sessionIdRecuperacion };
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
  return await respuestaDesdeCobro(actualizado ?? cobro, token);
}

async function marcarProcesando(cobroId: string): Promise<void> {
  // Solo se mueve a 'procesando' desde 'creando': si ya está en otro estado
  // (por ejemplo el polling ya lo resolvió), no hay que pisarlo.
  await q(`update cobros set status = 'procesando', updated_at = now() where id = $1 and status = 'creando'`, [
    cobroId,
  ]);
}

/**
 * Un cobro que quedó en `procesando` no tiene destino todavía: el loader sigue
 * puleando `/api/cobros/[id]` hasta que se resuelva. Por eso no necesita el
 * token, y se recibe igual para que la firma sea idéntica a las otras dos y
 * nadie tenga que recordar cuál lo lleva.
 */
function respuestaProcesando(cobro: Cobro, _token: string): RespuestaCobro {
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
 *
 * `requiere_tarjeta` sin `decline_code` es distinto y SÍ usa ese mensaje: es el
 * caso de `WhopError.noSePudoProcesar`, donde Whop no pudo cobrar off-session y
 * el motivo conocido es que el emisor exige 3DS. "Tu banco necesita que
 * confirmes esta compra" es literalmente lo que pasó, y la acción que pide
 * —volver a ingresar la tarjeta— es la que resuelve.
 */
async function respuestaDesdeCobro(cobro: Cobro, token: string): Promise<RespuestaCobro> {
  const pedirTarjeta = cobro.status === 'requiere_tarjeta';
  const declineAccion = cobro.status === 'fallido' && cobro.decline_code ? clasificarDecline(cobro.decline_code) : null;
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

  // El destino lo decide `lib/funnels.ts`: sabe si la página está en un funnel
  // (y manda a la `url_externa` del paso destino o a la página de gracias) o si
  // es una página suelta (y usa `url_exito`/`url_rechazo`). Antes esto leía las
  // URLs de la página acá mismo, y además NO le pegaba el token — lo cual
  // funcionaba solo mientras toda la cadena viviera en el mismo origen.
  //
  // Fondos insuficientes (migración 014) es un camino aparte: NO pasa por
  // `resultadoDeEstado('fallido') → 'rechazado' → paso_rechazado_id`, que exige
  // `permite_rechazo` (el botón de rechazo visible). Sin fondos no hay click del
  // comprador que active ese botón, así que usa `downsell_por_fondos_id` — el
  // destino propio de este motivo, resuelto por `resolverSiguienteUrlPorFondos`,
  // que devuelve `null` si el operador no lo configuró (mismo comportamiento de
  // hoy, no se rompe nada para quien no lo use).
  const siguienteUrl =
    declineAccion === 'sin_fondos'
      ? await resolverSiguienteUrlPorFondos(cobro.pagina_id, token)
      : await (async () => {
          const resultado = resultadoDeEstado(cobro.status);
          return resultado ? resolverSiguienteUrl(cobro.pagina_id, resultado, token) : null;
        })();

  return {
    cobroId: cobro.id,
    estado: cobro.status,
    siguienteUrl,
    mensaje,
    pedirTarjeta,
    // El sessionIdRecuperacion de un cobro que ya requiere_tarjeta se resuelve
    // en el GET /api/cobros/[id] cuando haga falta el embed: acá no se crea
    // una sesión nueva en cada respuesta para no gastar una checkout
    // configuration por cada poll.
    sessionIdRecuperacion: null,
  };
}
