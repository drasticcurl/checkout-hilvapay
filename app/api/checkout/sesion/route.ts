/**
 * POST /api/checkout/sesion — crea la orden y, para el checkout normal,
 * devuelve directo el `planId` en vez de una `sessionId` de checkout
 * configuration.
 *
 * body normal:        { slug, nombre, email, sessionId?, visitorId?, utms? }
 * body recuperación:  { slug, ordenIdRecuperacion }  (T03 §7)
 * 200:   RespuestaSesion (§4 del plan)
 * 400:   { error: 'payload_invalido' }
 * 404:   { error: 'pagina_inexistente' }
 *
 * Sin autenticación (lo llama cualquiera que abra /pagos/<slug>) y crea filas
 * + llama a Whop: el rate limit de abajo es la única defensa contra un bucle
 * que castigue la base y la cuota de la API.
 *
 * ── Por qué el checkout normal ya NO crea una checkout configuration ────────
 * Bloqueo histórico (ver BITACORA.md 2026-09-11 y 2026-09-13): diez hipótesis
 * descartadas para el 400 genérico del cobro off-session del upsell, todas
 * con el front pasando por una checkout configuration (`sessionId`). Un POC
 * aislado, en la misma cuenta (`biz_Me8Lbiv174brtM`), con el mismo plan
 * (`plan_BYnb2AYn36mO3`), pasando `planId` DIRECTO al embed —sin
 * configuration— logró tres cobros off-session exitosos consecutivos,
 * verificados contra la API real. La única diferencia estructural aislada
 * entre "funciona" y "diez veces 400" es la checkout configuration del pago
 * original.
 *
 * El costo de este cambio: `metadata.orden_id` ya no viaja en el pago del
 * front (solo `POST /payments` acepta metadata; el embed con `planId` directo
 * no tiene ninguna prop de metadata — verificado contra los tipos reales de
 * `@whop/checkout`). El claim (`/api/checkout/reclamar`) compensa esto
 * verificando `email` + ventana de tiempo en vez de un UUID exacto — más débil
 * que antes, documentado ahí mismo con el trade-off explícito.
 *
 * El modo recuperación SIGUE usando checkout configuration con
 * `mandate_challenge`: ahí el comprador ya tiene `whop_member_id` guardado de
 * antes (viene de una compra que sí funcionó), así que ese camino no es el
 * que se sospecha, y necesita la configuration para atar el pago nuevo a la
 * MISMA orden que ya existe con `requiere_tarjeta` — un caso donde SÍ hace
 * falta el vínculo exacto por `orden_id`, no solo por email.
 */
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { q, q1 } from '@/lib/db';
import { crearCheckoutConfiguration, WhopError } from '@/lib/whop';
import type { Orden, PaginaConProducto, RespuestaSesion } from '@/lib/tipos';
import { comoUuidONull, normalizarEmail } from '@/components/checkout/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HORAS_VALIDEZ_TOKEN = 2;
const LIMITE_POR_MINUTO = 20;

/**
 * Rate limit en memoria, por IP. Se reinicia con la función serverless — eso
 * está bien: el objetivo es frenar el bucle accidental (un doble submit, un
 * script de prueba mal cortado), no construir un rate limiter distribuido para
 * un endpoint que además está protegido por el índice único de `cobros` más
 * adelante en el flujo.
 */
const golpesPorIp = new Map<string, { cuenta: number; desde: number }>();
const VENTANA_MS = 60_000;

function excedeLimite(ip: string): boolean {
  const ahora = Date.now();
  const entrada = golpesPorIp.get(ip);
  if (!entrada || ahora - entrada.desde > VENTANA_MS) {
    golpesPorIp.set(ip, { cuenta: 1, desde: ahora });
    return false;
  }
  entrada.cuenta += 1;
  return entrada.cuenta > LIMITE_POR_MINUTO;
}

function ipDelRequest(req: Request): string {
  // Caddy pone la IP real en x-forwarded-for (el primer valor de la lista) y
  // además en x-real-ip, que setea el bloque de deploy/Caddyfile.hilvapay.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'sin-ip';
}

const BodySchema = z.object({
  slug: z.string().min(1).max(200),
  nombre: z.string().trim().min(2).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  sessionId: z.string().optional(),
  visitorId: z.string().optional(),
  utms: z.record(z.string()).optional(),
  /** Modo recuperación: la orden existente cuyo token ya se validó en el server component. */
  ordenIdRecuperacion: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const ip = ipDelRequest(req);
  if (excedeLimite(ip)) {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

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
  const body = parsed.data;

  // Modo normal exige nombre + email; modo recuperación no (ya se conocen).
  if (!body.ordenIdRecuperacion && (!body.nombre || !body.email)) {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  // 1. Buscar la página activa por slug con su producto. Mismo 404 para
  //    "no existe" y "existe pero está inactiva": no le decimos a un curioso
  //    qué slugs existen apagados.
  const pagina = await q<PaginaConProducto & { [k: string]: unknown }>(
    `select pg.id, pg.slug, pg.tipo, pg.url_exito, pg.url_rechazo, pg.config, pg.activo,
            pg.created_at, pg.updated_at,
            pr.id as producto_id, pr.nombre as producto_nombre, pr.whop_plan_id,
            pr.whop_product_id, pr.whop_nombre_soft, pr.precio, pr.moneda,
            pr.precio_anclaje, pr.imagen_url, pr.descripcion, pr.activo as producto_activo,
            pr.created_at as producto_created_at, pr.updated_at as producto_updated_at
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
      where pg.slug = $1 and pg.activo = true
        and (pg.funnel_id is null or f.activo = true)
      limit 1`,
    [body.slug],
  );

  if (pagina.length === 0) {
    return NextResponse.json({ error: 'pagina_inexistente' }, { status: 404 });
  }
  const fila = pagina[0];

  // ── Modo recuperación: reusar la orden, no crear una nueva ────────────────
  if (body.ordenIdRecuperacion) {
    const orden = await q1<Orden>(
      `select id, pagina_id, email, nombre, token, token_expira_at, whop_member_id,
              whop_payment_method_id, whop_user_id, whop_checkout_config_id, metodo_guardado,
              session_id, visitor_id, utms, created_at, updated_at
         from ordenes where id = $1`,
      [body.ordenIdRecuperacion],
    );
    if (!orden) {
      return NextResponse.json({ error: 'pagina_inexistente' }, { status: 404 });
    }

    let cfg;
    try {
      cfg = await crearCheckoutConfiguration({
        planId: fila.whop_plan_id as string,
        metadata: { orden_id: orden.id },
        // Recuperación: el comprador está acá porque el cobro off-session falló,
        // y va a autenticarse igual. `mandate_challenge` aprovecha ese desafío
        // para dejar el mandato establecido, así el paso SIGUIENTE del funnel sí
        // puede cobrarse en un click. Sin esto, cada upsell repetiría el desvío.
        threeDsLevel: 'mandate_challenge',
      });
    } catch (err) {
      const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
      console.error(`[checkout/sesion] recuperación: no se pudo crear la checkout configuration de la orden ${orden.id}:`, motivo);
      return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
    }

    // OJO: no se pisa `whop_checkout_config_id` de la orden con el de esta
    // sesión de recuperación. Esa columna es el vínculo pago↔orden de la
    // COMPRA DEL FRONT (D7); si se sobreescribiera acá, un webhook tardío del
    // pago original del front dejaría de poder resolver la orden por esa vía.
    // El claim de recuperación de todos modos verifica por `metadata.orden_id`
    // primero, así que no necesita esta columna actualizada.
    const respuesta: RespuestaSesion = {
      ordenId: orden.id,
      sessionId: cfg.id,
      planId: null,
      token: orden.token,
    };
    return NextResponse.json(respuesta, { status: 200 });
  }

  // ── Modo normal: nombre y email ya validados arriba ────────────────────────
  const nombre = body.nombre as string;
  const emailCrudo = body.email as string;

  // 2. Normalizar el email a la forma canónica: es lo que se le prefill al
  //    embed y lo que va al email de entrega. También es lo que el claim usa
  //    para verificar pertenencia ahora que no hay metadata en el pago.
  const email = normalizarEmail(emailCrudo);
  const sessionId = comoUuidONull(body.sessionId ?? null);
  const visitorId = comoUuidONull(body.visitorId ?? null);

  // 3. Token de 32 bytes en base64url. No Math.random, no un uuid: habilita
  //    cobrar una tarjeta guardada.
  const token = randomBytes(32).toString('base64url');
  const tokenExpiraAt = new Date(Date.now() + HORAS_VALIDEZ_TOKEN * 60 * 60 * 1000);

  // 4. INSERT en `ordenes`. Ya no hay llamada a Whop en este paso: sin
  //    checkout configuration no hay nada que crear del lado de Whop antes de
  //    mostrar el embed. El `planId` sale directo de la página, no de una
  //    respuesta de Whop.
  const [orden] = await q<{ id: string }>(
    `insert into ordenes (pagina_id, email, nombre, token, token_expira_at, session_id, visitor_id, utms)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     returning id`,
    [
      fila.id,
      email,
      nombre.trim(),
      token,
      tokenExpiraAt.toISOString(),
      sessionId,
      visitorId,
      body.utms ? JSON.stringify(body.utms) : null,
    ],
  );

  // 5. Devolver { ordenId, sessionId: null, planId, token }. `whop_plan_id`
  //    SÍ se manda al browser en este modo: es lo único que el embed necesita
  //    para montarse con `planId` directo, y no es secreto (es el mismo id que
  //    aparece en la URL de un checkout link público de Whop).
  const respuesta: RespuestaSesion = {
    ordenId: orden.id,
    sessionId: null,
    planId: fila.whop_plan_id as string,
    token,
  };
  return NextResponse.json(respuesta, { status: 200 });
}
