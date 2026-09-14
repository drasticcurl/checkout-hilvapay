/**
 * La cola `salidas`: lo que hay que mandar afuera de este servicio después de
 * un cobro (el evento de compra al `dashboard-admin`, el email de entrega). No
 * se hace desde el webhook ni desde el endpoint de cobro (D13 del plan): Whop
 * exige responder en menos de 5 segundos y un panel lento o un Resend caído no
 * pueden comerse ese presupuesto. Un cron drena esta tabla.
 */
import { q, q1, qCount } from './db';
import type { Cobro, Orden, Pagina, Salida } from './tipos';
import type { PayloadVentaCheckoutPropio } from './capi-tipos';

/** Cuántas veces se reintenta una fila antes de dejarla en paz (sin borrarla). */
export const MAX_INTENTOS = 10;

/** Techo del backoff: no tiene sentido que una fila espere más de una hora. */
const TECHO_MINUTOS = 60;

/**
 * Toma hasta `limite` filas pendientes y vencidas, y las bloquea para esta
 * invocación.
 *
 * `FOR UPDATE SKIP LOCKED` y no un lock a secas: durante un deploy, dos
 * invocaciones del cron pueden solaparse de verdad (la vieja todavía terminando
 * mientras la nueva ya arrancó). Con un lock normal, la segunda invocación
 * esperaría a la primera y después reprocesaría las mismas filas — con SKIP
 * LOCKED, la segunda simplemente las saltea. Sin esto, un solape manda el
 * mismo email dos veces.
 *
 * Todo en una sola transacción implícita del `SELECT ... FOR UPDATE`: como el
 * caller (el cron) procesa y marca cada fila enseguida después de leerla, no
 * hace falta envolver esto en `tx()` — el lock de un SELECT autocommiteado se
 * libera apenas termina el SELECT en modo no-transaccional, así que en su lugar
 * el candado real es la fila `enviado_at is null` que "tomarPendientes" no
 * vuelve a devolver una vez que el caller la marca.
 */
export async function tomarPendientes(limite: number): Promise<Salida[]> {
  return q<Salida>(
    `select id, cobro_id, destino, payload, intentos, ultimo_error, enviado_at,
            proximo_intento_at, created_at
       from salidas
      where enviado_at is null
        and proximo_intento_at <= now()
        and intentos < $1
      order by created_at asc
      limit $2
        for update skip locked`,
    [MAX_INTENTOS, limite],
  );
}

/**
 * Backoff exponencial con techo: 1, 2, 4, 8… minutos, tope en 60.
 *
 * Sin techo, a los 20 intentos el próximo cae dentro de casi un año y la fila
 * queda muerta sin que nada lo avise — parece que el sistema la sigue
 * reintentando, pero en la práctica nunca más.
 */
export function proximoIntento(intentos: number, ahora: Date = new Date()): Date {
  const minutos = Math.min(2 ** intentos, TECHO_MINUTOS);
  return new Date(ahora.getTime() + minutos * 60_000);
}

/**
 * Marca una fila como enviada. `motivo` se guarda en `ultimo_error` cuando el
 * envío se omitió a propósito (por ejemplo, sin session_id/visitor_id): no es
 * un error de verdad, pero es la única columna donde queda un rastro legible de
 * por qué esa venta no llegó al panel.
 */
export async function marcarEnviada(id: string, motivo?: string): Promise<void> {
  await q(
    `update salidas set enviado_at = now(), ultimo_error = coalesce($2, ultimo_error) where id = $1`,
    [id, motivo ?? null],
  );
}

/**
 * Suma un intento, guarda el error y reprograma. No borra ni marca `enviado_at`:
 * después de `MAX_INTENTOS`, `tomarPendientes` deja de devolver la fila, pero
 * queda en la tabla con su error para que se pueda ver en el panel qué venta no
 * llegó.
 */
export async function marcarFallida(id: string, error: string): Promise<void> {
  const fila = await q1<{ intentos: number }>('select intentos from salidas where id = $1', [id]);
  const intentos = (fila?.intentos ?? 0) + 1;
  await q(
    `update salidas
        set intentos = $2,
            ultimo_error = $3,
            proximo_intento_at = $4
      where id = $1`,
    [id, intentos, error, proximoIntento(intentos)],
  );
}

// ── El payload que se postea al /api/ingest del dashboard-admin ─────────────

/**
 * Todo lo que hace falta de la venta para armar el evento de ingest y el email
 * de entrega. Es un join manual porque `salidas.payload` (lo que escribió el
 * webhook o el endpoint de cobro al encolar) es deliberadamente liviano —
 * `{motivo, pago_id}` — y no repite datos que ya viven en `cobros`/`ordenes`:
 * repetirlos ahí los dejaría desactualizados si el cobro cambia entre que se
 * encola la salida y que el cron la drena.
 *
 * `producto` es un tipo REDUCIDO (`{ nombre, moneda }`), no el `Producto`
 * completo de `lib/tipos.ts`. Desde que ese tipo perdió `precio`/`whop_plan_id`
 * (módulo `panel-catalogo-funnels`, T01: el precio real de un cobro histórico
 * vive en `cobros.monto`/`cobros.moneda`, nunca en el producto — un producto
 * puede tener hoy un precio distinto al que tenía cuando se hizo este cobro).
 * Los dos únicos campos que `armarPayloadIngest` y el cron de salidas leen de
 * `producto` son `moneda` (fallback cuando `cobro.moneda` es null) y `nombre`
 * (para el email de entrega) — verificado con un `grep` de todo el código que
 * consume `FilaCobroParaSalida.producto` antes de reducir el tipo, para no
 * sacar un campo que alguien sí necesitaba.
 */
export type FilaCobroParaSalida = {
  cobro: Cobro;
  orden: Orden;
  pagina: Pagina;
  producto: { nombre: string; moneda: string };
};

/**
 * Busca los datos completos de la venta a partir del `cobro_id` de una fila de
 * `salidas`. `null` si la fila no tiene `cobro_id` (los eventos de disputa lo
 * dejan en null a propósito, ver `lib/cobros.ts` `manejarDisputa`) o si el
 * cobro ya no existe.
 *
 * Un SELECT con columnas explícitas y alias con prefijo, NO `row_to_json`. Con
 * `row_to_json` cada `timestamptz` sale como string ISO dentro del JSON en vez
 * de pasar por el parser de tipos de `pg`, y `lib/tipos.ts` documenta que
 * `timestamptz` llega como `Date` — un `Cobro.updated_at` que en realidad es
 * string rompe en el primer `.toISOString()` con un error que no dice "es un
 * string", dice "no es una función". Con columnas planas, el driver parsea
 * cada tipo como en el resto del código (mismo patrón que `COLS_ORDEN` /
 * `COLS_COBRO` de `lib/cobros.ts`).
 */
export async function buscarDatosParaSalida(cobroId: string): Promise<FilaCobroParaSalida | null> {
  const fila = await q1<Record<string, unknown>>(
    `select
        c.id as c_id, c.orden_id as c_orden_id, c.pagina_id as c_pagina_id,
        c.producto_id as c_producto_id, c.whop_plan_id as c_whop_plan_id,
        c.whop_payment_id as c_whop_payment_id, c.status as c_status,
        c.decline_code as c_decline_code, c.failure_message as c_failure_message,
        c.idempotency_key as c_idempotency_key, c.monto as c_monto, c.moneda as c_moneda,
        c.origen as c_origen, c.reembolsado_at as c_reembolsado_at, c.disputa_at as c_disputa_at,
        c.email_enviado_at as c_email_enviado_at, c.created_at as c_created_at,
        c.updated_at as c_updated_at,

        o.id as o_id, o.pagina_id as o_pagina_id, o.email as o_email, o.nombre as o_nombre,
        o.token as o_token, o.token_expira_at as o_token_expira_at,
        o.whop_member_id as o_whop_member_id, o.whop_payment_method_id as o_whop_payment_method_id,
        o.whop_user_id as o_whop_user_id, o.whop_checkout_config_id as o_whop_checkout_config_id,
        o.whop_payment_method_type as o_whop_payment_method_type,
        o.metodo_guardado as o_metodo_guardado, o.session_id as o_session_id,
        o.visitor_id as o_visitor_id, o.utms as o_utms, o.created_at as o_created_at,
        o.updated_at as o_updated_at,

        pg.id as pg_id, pg.slug as pg_slug, pg.producto_id as pg_producto_id, pg.tipo as pg_tipo,
        pg.url_exito as pg_url_exito, pg.url_rechazo as pg_url_rechazo, pg.config as pg_config,
        pg.activo as pg_activo, pg.created_at as pg_created_at, pg.updated_at as pg_updated_at,

        pr.nombre as pr_nombre, pr.moneda as pr_moneda
       from cobros c
       join ordenes o    on o.id = c.orden_id
       join paginas pg   on pg.id = c.pagina_id
       join productos pr on pr.id = c.producto_id
      where c.id = $1`,
    [cobroId],
  );
  if (!fila) return null;

  const cobro: Cobro = {
    id: fila.c_id as string,
    orden_id: fila.c_orden_id as string,
    pagina_id: fila.c_pagina_id as string,
    producto_id: fila.c_producto_id as string,
    whop_plan_id: fila.c_whop_plan_id as string,
    whop_payment_id: fila.c_whop_payment_id as string | null,
    status: fila.c_status as Cobro['status'],
    decline_code: fila.c_decline_code as string | null,
    failure_message: fila.c_failure_message as string | null,
    idempotency_key: fila.c_idempotency_key as string,
    monto: fila.c_monto as string | null,
    moneda: fila.c_moneda as string | null,
    origen: fila.c_origen as Cobro['origen'],
    reembolsado_at: fila.c_reembolsado_at as Date | null,
    disputa_at: fila.c_disputa_at as Date | null,
    email_enviado_at: fila.c_email_enviado_at as Date | null,
    created_at: fila.c_created_at as Date,
    updated_at: fila.c_updated_at as Date,
  };

  const orden: Orden = {
    id: fila.o_id as string,
    pagina_id: fila.o_pagina_id as string,
    email: fila.o_email as string | null,
    nombre: fila.o_nombre as string | null,
    token: fila.o_token as string,
    token_expira_at: fila.o_token_expira_at as Date,
    whop_member_id: fila.o_whop_member_id as string | null,
    whop_payment_method_id: fila.o_whop_payment_method_id as string | null,
    whop_user_id: fila.o_whop_user_id as string | null,
    whop_checkout_config_id: fila.o_whop_checkout_config_id as string | null,
    whop_payment_method_type: fila.o_whop_payment_method_type as string | null,
    metodo_guardado: fila.o_metodo_guardado as boolean,
    session_id: fila.o_session_id as string | null,
    visitor_id: fila.o_visitor_id as string | null,
    utms: fila.o_utms as Record<string, string> | null,
    created_at: fila.o_created_at as Date,
    updated_at: fila.o_updated_at as Date,
  };

  const pagina: Pagina = {
    id: fila.pg_id as string,
    slug: fila.pg_slug as string,
    producto_id: fila.pg_producto_id as string,
    tipo: fila.pg_tipo as Pagina['tipo'],
    url_exito: fila.pg_url_exito as string | null,
    url_rechazo: fila.pg_url_rechazo as string | null,
    config: fila.pg_config as Pagina['config'],
    activo: fila.pg_activo as boolean,
    created_at: fila.pg_created_at as Date,
    updated_at: fila.pg_updated_at as Date,
  };

  const producto = {
    nombre: fila.pr_nombre as string,
    moneda: fila.pr_moneda as string,
  };

  return { cobro, orden, pagina, producto };
}

/** El motivo textual con el que se omite un evento que no se puede mandar al panel. */
export const OMITIDA_SIN_ATRIBUCION = 'omitida: la orden no tiene session_id/visitor_id (UUID)';

/** El evento que espera `POST /api/ingest`, ya con `value` en centavos enteros. */
export type EventoIngest = {
  name: 'Purchase';
  at: string;
  value: number;
  currency: string;
  eventUid: string;
  stepSlug: string;
};

export type PayloadIngest = {
  sessionId: string;
  visitorId: string;
  variant: string;
  events: EventoIngest[];
  context: {
    path: string;
    /**
     * Nuevo (00-PLAN-PANEL-Y-CAPI.md §6, contrato C). T03 lo llena en
     * armarPayloadIngest(). Opcional: el schema de destino (dashboard-admin
     * lib/ingest/schema.ts, contextSchema) ya lo esperaba como opcional antes
     * de este cambio, así que agregar el campo no rompe ningún consumidor
     * existente que no lo mande.
     */
    utms?: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      utm_content?: string;
      utm_term?: string;
    };
  };
};

/** Resultado de intentar armar el payload: o el payload, o el motivo de por qué no se armó. */
export type ResultadoArmadoIngest = { ok: true; payload: PayloadIngest } | { ok: false; motivo: string };

/**
 * Convierte `monto` (unidades, string de `numeric(10,2)`) a centavos enteros.
 *
 * SIEMPRE `Math.round`, nunca truncar. Verificado en node: `1234567.89 * 100`
 * da `123456788.99999999` por el binario de punto flotante, y truncar (`| 0`,
 * `Math.floor`, `parseInt`) se come el último centavo silenciosamente. Con
 * `Math.round` da `123456789`, el valor correcto.
 */
export function centavos(monto: string | number): number {
  return Math.round(Number(monto) * 100);
}

/**
 * Extrae las 5 UTMs conocidas de `orden.utms` (jsonb libre) hacia la forma que
 * espera `PayloadIngest.context.utms`. Claves desconocidas se ignoran (mismo
 * criterio que dashboard-admin `lib/ingest/schema.ts`: strip-by-default).
 *
 * `fbclid` NO se incluye acá a propósito: confirmado leyendo
 * dashboard-admin/lib/ingest/schema.ts (`utmSchema`) — ese schema SÍ acepta
 * `fbclid` como key de `utms`, pero el contrato C de este módulo
 * (00-PLAN-PANEL-Y-CAPI.md §6) solo extiende `context.utms` con las 5 UTMs de
 * campaña. `fbclid` no es una "UTM" para el tracking de embudo, es el dato que
 * viaja por el contrato A (`armarPayloadVentaPanel`, más abajo) hacia el
 * endpoint de venta — mezclar los dos caminos de lectura del mismo dato es
 * justo lo que D10 del plan pide evitar.
 *
 * Si `orden.utms` es `null` o no tiene ninguna de las 5 claves, devuelve
 * `undefined` (no un objeto con 5 strings vacíos): es opcional en el contrato
 * a propósito, y un objeto vacío podría confundirse con "vino pero está
 * vacío" del lado del schema de destino.
 */
export function extraerUtmsLimpias(
  utms: Record<string, string> | null,
): PayloadIngest['context']['utms'] {
  if (!utms) return undefined;

  const limpias: NonNullable<PayloadIngest['context']['utms']> = {};
  for (const clave of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const) {
    const valor = utms[clave];
    if (valor) limpias[clave] = valor;
  }

  return Object.keys(limpias).length > 0 ? limpias : undefined;
}

/**
 * Arma el payload de `/api/ingest` para una venta.
 *
 * Regla 1 de la sección 3 del task: sin `session_id` o `visitor_id` (UUID) en
 * la orden, el evento NO se arma. El panel los exige como UUID y no se pueden
 * inventar: un UUID falso crea una sesión fantasma que ensucia el embudo para
 * siempre — mejor una venta ausente del panel (visible, se puede investigar)
 * que una venta mal atribuida (invisible, contamina para siempre los números
 * con los que se decide gastar en ads).
 */
export function armarPayloadIngest(
  datos: FilaCobroParaSalida,
  variant: string = 'checkout-propio',
): ResultadoArmadoIngest {
  const { cobro, orden, pagina, producto } = datos;

  if (!orden.session_id || !orden.visitor_id) {
    return { ok: false, motivo: OMITIDA_SIN_ATRIBUCION };
  }
  if (!cobro.whop_payment_id) {
    // Sin esto no hay `eventUid` con el que el panel deduplique un reintento.
    return { ok: false, motivo: 'omitida: el cobro no tiene whop_payment_id todavía' };
  }
  if (cobro.monto == null) {
    return { ok: false, motivo: 'omitida: el cobro no tiene monto' };
  }

  return {
    ok: true,
    payload: {
      sessionId: orden.session_id,
      visitorId: orden.visitor_id,
      variant,
      events: [
        {
          name: 'Purchase',
          at: cobro.updated_at.toISOString(),
          value: centavos(cobro.monto),
          currency: (cobro.moneda ?? producto.moneda).toLowerCase(),
          eventUid: cobro.whop_payment_id,
          stepSlug: pagina.slug,
        },
      ],
      context: {
        path: `/pagos/${pagina.slug}`,
        utms: extraerUtmsLimpias(orden.utms),
      },
    },
  };
}

// ── Contrato A: el payload que se postea a POST /api/webhooks/checkout-propio ──

/** Resultado de intentar armar el payload del contrato A: o el payload, o el motivo. */
export type ResultadoArmadoVentaPanel =
  | { ok: true; payload: PayloadVentaCheckoutPropio }
  | { ok: false; motivo: string };

/**
 * Arma el payload para `POST /api/webhooks/checkout-propio` (T02), a partir de
 * los mismos datos que ya usa `armarPayloadIngest`. A diferencia de esa
 * función, ESTA NO exige `session_id`/`visitor_id` (son opcionales en el
 * contrato A) — una venta real no puede desaparecer del dashboard de
 * facturación solo porque no se pudo atar a una sesión de tracking (criterio
 * §9.5 del plan).
 *
 * Solo exige `cobro.whop_payment_id` y `cobro.monto` (mismas reglas 2 y 3 de
 * `armarPayloadIngest`, reusadas acá: sin esos dos no hay venta real que
 * reportar).
 */
export function armarPayloadVentaPanel(datos: FilaCobroParaSalida): ResultadoArmadoVentaPanel {
  const { cobro, orden, producto } = datos;

  if (!cobro.whop_payment_id) {
    return { ok: false, motivo: 'omitida: el cobro no tiene whop_payment_id todavía' };
  }
  if (cobro.monto == null) {
    return { ok: false, motivo: 'omitida: el cobro no tiene monto' };
  }

  return {
    ok: true,
    payload: {
      cobroId: cobro.id,
      whopPlanId: cobro.whop_plan_id,
      email: orden.email,
      monto: cobro.monto,
      moneda: (cobro.moneda ?? producto.moneda).toLowerCase(),
      purchasedAt: cobro.updated_at.toISOString(),
      utms: extraerUtmsLimpias(orden.utms) ?? {},
      // Crudo, sin transformar a `fbc` (D6: eso lo hace lib/capi.ts). Vive
      // dentro de orden.utms como una key más — ver el comentario de
      // `Orden.utms` en lib/tipos.ts para la decisión completa.
      fbclid: orden.utms?.fbclid || undefined,
      sessionId: orden.session_id ?? undefined,
      visitorId: orden.visitor_id ?? undefined,
    },
  };
}

/** Timeout duro para el POST al panel de ventas: mismo criterio que el de tracking. */
const TIMEOUT_PANEL_VENTAS_MS = 5_000;

/** Mismo tipo de resultado que ya usa el cron para `reportarAlPanel`, para tratarlas de forma uniforme. */
export type ResultadoPanelVentas = { ok: boolean; reintentar: boolean; motivo?: string };

/**
 * Postea el contrato A a `POST /api/webhooks/checkout-propio` (T02,
 * dashboard-admin). Misma forma que `reportarAlPanel` del cron (mismo manejo
 * de timeout, mismo tratamiento de 401 como no-reintentable, mismo
 * `AbortController`) pero apuntando a una URL/key DISTINTA: `PANEL_VENTAS_URL`
 * / `PANEL_VENTAS_KEY`, no `PANEL_INGEST_URL`/`KEY` — son dos endpoints
 * distintos con dos propósitos distintos (D1 del plan: `/api/ingest` no crea
 * una fila en `orders` con monto, así que no puede ser el mismo destino).
 *
 * Vive en `lib/salidas.ts` y no en `app/api/cron/salidas/route.ts` porque el
 * cron importa esta función tal cual, igual que ya hace con
 * `armarPayloadIngest` — mantiene el mismo patrón de "las funciones puras y
 * los efectos de red conviven en este archivo, el cron solo orquesta".
 */
export async function reportarVentaAlPanel(datos: FilaCobroParaSalida): Promise<ResultadoPanelVentas> {
  const armado = armarPayloadVentaPanel(datos);
  if (!armado.ok) {
    return { ok: true, reintentar: false, motivo: armado.motivo };
  }

  const url = process.env.PANEL_VENTAS_URL;
  const key = process.env.PANEL_VENTAS_KEY;
  if (!url || !key) {
    // Mismo principio que P-04 del plan (PANEL_INGEST_URL/KEY): sin URL/key no
    // hay a quién reportarle, y no es un error transitorio — no tiene sentido
    // reintentar esto con backoff.
    return { ok: true, reintentar: false, motivo: 'omitida: PANEL_VENTAS_URL/KEY sin configurar' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_PANEL_VENTAS_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(armado.payload),
      signal: controller.signal,
    });

    // Mismo motivo que reportarAlPanel: el endpoint puede responder 200 con
    // {ok:false} para sus propios errores internos (regla 3 de la sección 3
    // del T05 original, reusada acá) — mirar solo el status HTTP deja pasar
    // por "enviado" algo que el panel rechazó de verdad.
    let body: { ok?: boolean; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      // Respuesta sin JSON parseable: se trata como fallo, más abajo.
    }

    if (res.status === 401) {
      // Key mal configurada, no un problema transitorio: no tiene sentido
      // reintentar esto 50 veces con backoff.
      return {
        ok: true,
        reintentar: false,
        motivo: `omitida: panel de ventas devolvió 401 (${body.error ?? 'unauthorized'})`,
      };
    }

    if (res.ok && body.ok === true) {
      return { ok: true, reintentar: false };
    }

    return {
      ok: false,
      reintentar: true,
      motivo: `panel de ventas respondió ${res.status} ok=${body.ok ?? 'sin_body'} error=${body.error ?? ''}`,
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    return { ok: false, reintentar: true, motivo: `fetch al panel de ventas falló: ${motivo}` };
  } finally {
    clearTimeout(timeout);
  }
}
