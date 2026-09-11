/**
 * POST /api/checkout/sesion — crea la orden y la sesión de checkout de Whop.
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
 * ── Modo recuperación (T03 §7, D3 del plan) ──────────────────────────────────
 * Cuando viene `ordenIdRecuperacion`, NO se crea una orden nueva: se reusa la
 * que ya existe (misma persona, mismo token) y solo se crea una checkout
 * configuration nueva, atada al PLAN de la página actual (el upsell que
 * rebotó), no al del front. `client_secret` es null para los pagos creados
 * desde un método guardado, así que no hay nada que "continuar": es un pago
 * nuevo, y por D1 tiene que caer sobre el mismo (orden_id, pagina_id) que ya
 * existe en `cobros` con `requiere_tarjeta`.
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
    const respuesta: RespuestaSesion = { ordenId: orden.id, sessionId: cfg.id, token: orden.token };
    return NextResponse.json(respuesta, { status: 200 });
  }

  // ── Modo normal: nombre y email ya validados arriba ────────────────────────
  const nombre = body.nombre as string;
  const emailCrudo = body.email as string;

  // 2. Normalizar el email a la forma canónica: es lo que se le prefill al
  //    embed y lo que va al email de entrega.
  const email = normalizarEmail(emailCrudo);
  const sessionId = comoUuidONull(body.sessionId ?? null);
  const visitorId = comoUuidONull(body.visitorId ?? null);

  // 3. Token de 32 bytes en base64url. No Math.random, no un uuid: habilita
  //    cobrar una tarjeta guardada.
  const token = randomBytes(32).toString('base64url');
  const tokenExpiraAt = new Date(Date.now() + HORAS_VALIDEZ_TOKEN * 60 * 60 * 1000);

  // 4. INSERT en `ordenes` ANTES de llamar a Whop. Si Whop falla después,
  //    queda una orden huérfana sin sesión (basura inofensiva). Al revés
  //    -sesión creada y orden no insertada- quedaría un pago posible sin
  //    nadie a quien atribuirlo.
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

  // 5. Crear la checkout configuration. El metadata.orden_id es lo que ata el
  //    pago a la orden (D7 del plan).
  let cfg;
  try {
    cfg = await crearCheckoutConfiguration({
      planId: fila.whop_plan_id as string,
      metadata: { orden_id: orden.id },
      // LA COMPRA DEL FRONT ES DONDE SE CREA EL MANDATO. `mandate_challenge`
      // hace el desafío 3DS acá, una vez, con el comprador presente — y eso es
      // lo que autoriza los cobros one-click de todos los upsells que sigan.
      //
      // Antes iba `frictionless`, que le pide a Whop EVITAR el desafío. Se
      // ahorraba una pantalla y se perdía el módulo entero de upsells: sin
      // mandato, `POST /payments` off-session devuelve un 400 genérico que no
      // menciona nada de esto (ver `crearCheckoutConfiguration`).
      threeDsLevel: 'mandate_challenge',
    });
  } catch (err) {
    const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
    console.error(`[checkout/sesion] no se pudo crear la checkout configuration de la orden ${orden.id}:`, motivo);
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  // 6. Guardar cfg.id en ordenes.whop_checkout_config_id.
  await q('update ordenes set whop_checkout_config_id = $1, updated_at = now() where id = $2', [cfg.id, orden.id]);

  // 7. Devolver { ordenId, sessionId, token }. NUNCA el whop_plan_id: el
  //    browser no lo necesita.
  const respuesta: RespuestaSesion = { ordenId: orden.id, sessionId: cfg.id, token };
  return NextResponse.json(respuesta, { status: 200 });
}
