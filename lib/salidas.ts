/**
 * La cola `salidas`: lo que hay que mandar afuera de este servicio después de
 * un cobro (el evento de compra al `dashboard-admin`, el email de entrega). No
 * se hace desde el webhook ni desde el endpoint de cobro (D13 del plan): Whop
 * exige responder en menos de 5 segundos y un panel lento o un Resend caído no
 * pueden comerse ese presupuesto. Un cron drena esta tabla.
 */
import { q, q1, qCount } from './db';
import type { Cobro, Orden, Pagina, Producto, Salida } from './tipos';

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
 */
export type FilaCobroParaSalida = {
  cobro: Cobro;
  orden: Orden;
  pagina: Pagina;
  producto: Producto;
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

        pr.id as pr_id, pr.nombre as pr_nombre, pr.whop_plan_id as pr_whop_plan_id,
        pr.whop_product_id as pr_whop_product_id, pr.whop_nombre_soft as pr_whop_nombre_soft,
        pr.precio as pr_precio, pr.moneda as pr_moneda, pr.precio_anclaje as pr_precio_anclaje,
        pr.imagen_url as pr_imagen_url, pr.descripcion as pr_descripcion, pr.activo as pr_activo,
        pr.created_at as pr_created_at, pr.updated_at as pr_updated_at
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

  const producto: Producto = {
    id: fila.pr_id as string,
    nombre: fila.pr_nombre as string,
    whop_plan_id: fila.pr_whop_plan_id as string,
    whop_product_id: fila.pr_whop_product_id as string | null,
    whop_nombre_soft: fila.pr_whop_nombre_soft as string | null,
    precio: fila.pr_precio as string,
    moneda: fila.pr_moneda as string,
    precio_anclaje: fila.pr_precio_anclaje as string | null,
    imagen_url: fila.pr_imagen_url as string | null,
    descripcion: fila.pr_descripcion as string | null,
    activo: fila.pr_activo as boolean,
    created_at: fila.pr_created_at as Date,
    updated_at: fila.pr_updated_at as Date,
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
  context: { path: string };
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
      context: { path: `/pagos/${pagina.slug}` },
    },
  };
}
