/**
 * `POST /api/upsell/sesion` — la sesión de checkout para que el botón de wallet
 * cobre un upsell EN EL FUNNEL, en un solo toque.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * El cobro one-click "real" (`POST /api/upsell/cobrar`, que usa la tarjeta
 * guardada sin ninguna interacción) está bloqueado del lado de Whop: devuelve
 * 400 `bad_request` sin `decline_code`. Seis hipótesis descartadas con medición
 * —payload, permisos, company, plan, tipo de tarjeta y mandato 3DS— y sigue.
 *
 * Este endpoint es el otro camino, y no depende de eso en absoluto: en vez de
 * cobrar nosotros contra la tarjeta guardada, se le da al funnel una sesión para
 * que monte el botón de Apple Pay / Google Pay de Whop. El comprador toca UNA vez,
 * aprueba con Face ID, y el wallet resuelve el pago y la autenticación del banco
 * por su cuenta.
 *
 * Desde la vista del comprador es un solo toque, que es lo que el producto
 * necesita. Lo que cambia respecto del one-click clásico es que hay una
 * confirmación biométrica en el medio — y eso, en un funnel, es fricción
 * despreciable comparado con reingresar una tarjeta.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 * No cobra. Solo crea la `checkout_configuration` con la metadata de la orden y
 * devuelve su id. El cobro lo hace el wallet en el browser del comprador, y
 * después el funnel avisa con el `receiptId` a `/api/checkout/reclamar`, que es
 * el mismo camino que ya usa el checkout del front.
 *
 * ── Seguridad ───────────────────────────────────────────────────────────────
 * Mismas cuatro guardas que el endpoint que cobra, en el mismo orden y por las
 * mismas razones: CORS contra la allowlist de `origenes`, rate limit, token de la
 * orden, y que el paso sea un upsell activo DE ESTE funnel. La única diferencia
 * es que acá no hace falta que la orden tenga método guardado — justamente el
 * punto es no usarlo.
 */
import { NextResponse } from 'next/server';
import { headersCors } from '@/lib/cors';
import { resolverToken } from '@/lib/token';
import { q1 } from '@/lib/db';
import { crearLimitador, ipDelRequest } from '@/lib/rate-limit';
import { crearCheckoutConfiguration, WhopError } from '@/lib/whop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Más holgado que el del cobro (10/min) porque esto NO cobra: crear una sesión es
 * idempotente en la práctica y el funnel puede pedirla al cargar la página, antes
 * de cualquier click. Sigue habiendo límite para que no se pueda usar como
 * generador infinito de sesiones en la cuenta de Whop.
 */
const limitador = crearLimitador(20);

type PaginaSesion = {
  id: string;
  tipo: 'front' | 'upsell';
  activo: boolean;
  whop_plan_id: string;
  funnel_id: string | null;
  funnel_de_la_orden: string | null;
};

export async function OPTIONS(req: Request): Promise<Response> {
  const cors = await headersCors(req.headers.get('origin'));
  return new NextResponse(null, { status: 204, headers: cors ?? {} });
}

export async function POST(req: Request): Promise<Response> {
  // ── 1. CORS ─────────────────────────────────────────────────────────────
  const cors = await headersCors(req.headers.get('origin'));
  if (!cors) {
    return NextResponse.json({ error: 'origen_no_autorizado' }, { status: 403 });
  }
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: cors });

  // ── 2. Rate limit ───────────────────────────────────────────────────────
  // Después del CORS, igual que en el cobro: así un origen fuera de la allowlist
  // no puede gastarle la cuota a los compradores legítimos de esa IP.
  if (limitador.excede(ipDelRequest(req))) {
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

  // ── 3. Token ────────────────────────────────────────────────────────────
  const resuelto = await resolverToken(token);
  if (!resuelto.ok) {
    return json({ error: resuelto.motivo === 'vencido' ? 'token_vencido' : 'token_invalido' }, 401);
  }
  const orden = resuelto.orden;

  // ── 4. Página: upsell, activa, y de ESTE funnel ─────────────────────────
  // El slug decide qué se cobra, nunca el cliente: el plan sale de la base. Y el
  // chequeo de funnel es el mismo que en el cobro — sin él, un token válido
  // podría abrir una sesión de pago de cualquier paso del sistema.
  const pagina = await q1<PaginaSesion>(
    `select pg.id, pg.tipo, pr.whop_plan_id, pg.funnel_id,
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
    console.warn(
      `[upsell/sesion] orden ${orden.id}: el paso ${slug} es de otro funnel → 404`,
    );
    return json({ error: 'pagina_inexistente' }, 404);
  }

  // ── 5. La sesión ────────────────────────────────────────────────────────
  // `metadata.orden_id` y `pagina_id` son lo que después permite a
  // `/api/checkout/reclamar` verificar que el pago es de esta orden y registrar
  // el cobro del paso correcto. Sin eso el pago llegaría huérfano.
  let cfg;
  try {
    cfg = await crearCheckoutConfiguration({
      planId: pagina.whop_plan_id,
      metadata: { orden_id: orden.id, pagina_id: pagina.id },
      // `null` para dejar que decida el default de la cuenta. Acá el comprador
      // ESTÁ presente y el wallet resuelve la autenticación solo, así que no hay
      // motivo para forzar ni pedir un desafío extra.
      threeDsLevel: null,
    });
  } catch (err) {
    const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
    console.error(`[upsell/sesion] orden ${orden.id}: no se pudo crear la sesión de ${slug}:`, motivo);
    return json({ error: 'sesion_no_disponible' }, 200);
  }

  console.log(`[upsell/sesion] orden ${orden.id} slug=${slug} → ${cfg.id}`);

  return json(
    {
      ok: true,
      sessionId: cfg.id,
      ordenId: orden.id,
      // El email de la compra del front, para prellenarlo en el diálogo de Whop
      // Pay. Es el único campo que el comprador tendría que volver a tipear en el
      // camino que NO es Apple Pay ni Google Pay — los wallets lo traen del
      // dispositivo, Whop Pay no.
      //
      // No es una filtración: para llegar acá hay que presentar el token de la
      // orden, y ese token ya identifica al comprador. Quien lo tiene es él.
      email: orden.email ?? null,
    },
    200,
  );
}
