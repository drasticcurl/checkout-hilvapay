/**
 * Operaciones sobre cobros y órdenes que usan tanto el webhook como los
 * endpoints de cobro. Está separado de las rutas porque las dos vías pueden
 * resolver el mismo cobro y tienen que hacerlo igual: si el polling y el webhook
 * escribieran distinto, el estado del cobro dependería de quién llegó primero.
 */
import { q, q1, qCount } from './db';
import { esFinal, mapearEstado, type EstadoCobro } from './estado-pago';
import type { Cobro, Orden } from './tipos';
import type { PagoWhop } from './whop';

// Los tipos de fila viven en `lib/tipos.ts`, que es el contrato congelado del §4
// del plan. Se re-exportan acá porque tres tasks ya importan `Orden` y `Cobro`
// desde este módulo, y romper eso no aporta nada.
export type { Cobro, Orden };

/** Las columnas de `ordenes` que este módulo devuelve. Una sola definición: si */
/** cada query listara las suyas, agregar una columna obligaría a tocar cuatro. */
const COLS_ORDEN = `id, pagina_id, email, nombre, token, token_expira_at, whop_member_id,
       whop_payment_method_id, whop_user_id, whop_checkout_config_id, whop_payment_method_type,
       metodo_guardado, session_id, visitor_id, utms, created_at, updated_at`;

const COLS_COBRO = `id, orden_id, pagina_id, producto_id, whop_plan_id, whop_payment_id, status,
       decline_code, failure_message, idempotency_key, monto, moneda, origen,
       reembolsado_at, disputa_at, email_enviado_at, created_at, updated_at`;

/**
 * Estados de los que un cobro NO sale nunca. Los webhooks pueden llegar
 * desordenados ("a newer event can arrive before an older event", dice la doc de
 * Whop), así que un `payment.failed` viejo no puede pisar un cobro que ya está
 * pagado: eso le quitaría el producto a alguien que pagó.
 */
function puedeCambiar(actual: EstadoCobro, nuevo: EstadoCobro): boolean {
  if (actual === nuevo) return false;
  // De pagado no se vuelve. Un reembolso o una disputa se anotan en sus propias
  // columnas, no en `status`.
  if (actual === 'pagado') return false;
  // De un estado final solo se sale hacia pagado (el cobro se recuperó).
  if (esFinal(actual) && nuevo !== 'pagado') return false;
  return true;
}

export async function buscarOrdenPorToken(token: string): Promise<Orden | null> {
  return q1<Orden>(
    `select ${COLS_ORDEN} from ordenes where token = $1`,
    [token],
  );
}

export async function buscarCobroPorPagoWhop(pagoId: string): Promise<Cobro | null> {
  return q1<Cobro>(
    `select ${COLS_COBRO} from cobros where whop_payment_id = $1`,
    [pagoId],
  );
}

export async function buscarCobro(ordenId: string, paginaId: string): Promise<Cobro | null> {
  return q1<Cobro>(
    `select ${COLS_COBRO} from cobros where orden_id = $1 and pagina_id = $2`,
    [ordenId, paginaId],
  );
}

/**
 * Aplica el estado que dice Whop sobre un cobro que ya existe en la base.
 *
 * Idempotente y monótona: se puede llamar cuantas veces se quiera, desde el
 * polling y desde el webhook, en cualquier orden. Devuelve el estado final y si
 * hubo cambio, para que el caller sepa si tiene que encolar la entrega.
 */
export async function aplicarEstadoDePago(
  cobro: Cobro,
  pago: { substatus?: string | null; decline_code?: string | null; failure_message?: string | null;
          settlement_amount?: number | null; currency?: string | null; id?: string },
): Promise<{ status: EstadoCobro; cambio: boolean }> {
  const nuevo = mapearEstado(pago);

  if (!puedeCambiar(cobro.status, nuevo)) {
    return { status: cobro.status, cambio: false };
  }

  // El UPDATE lleva el estado anterior en el WHERE: si entre el SELECT y el
  // UPDATE el webhook ya lo movió, esta escritura no hace nada en vez de
  // sobreescribir una decisión más nueva.
  const filas = await qCount(
    `update cobros
        set status = $1,
            decline_code = $2,
            failure_message = $3,
            monto = coalesce($4, monto),
            moneda = coalesce($5, moneda),
            whop_payment_id = coalesce(whop_payment_id, $6),
            updated_at = now()
      where id = $7 and status = $8`,
    [
      nuevo,
      pago.decline_code ?? null,
      pago.failure_message ?? null,
      pago.settlement_amount ?? null,
      pago.currency ?? null,
      pago.id ?? null,
      cobro.id,
      cobro.status,
    ],
  );

  if (filas === 0) {
    const actual = await q1<{ status: EstadoCobro }>('select status from cobros where id = $1', [cobro.id]);
    return { status: actual?.status ?? cobro.status, cambio: false };
  }

  return { status: nuevo, cambio: true };
}

/**
 * Guarda el member y el método de pago de la compra del front.
 *
 * `coalesce` en las dos columnas: el claim sincrónico (desde `onComplete`) y el
 * webhook escriben lo mismo, y el que llegue segundo no tiene que borrar nada.
 * `metodo_guardado` solo puede pasar de false a true por la misma razón.
 *
 * El id del método viene con prefijo `payt_` en el objeto Payment, aunque el
 * ejemplo del request de POST /payments lo muestre como `pmt_`. Se guarda tal
 * cual: validar el prefijo rompería en cuanto Whop unifique la doc.
 */
export async function guardarMetodoDePago(
  ordenId: string,
  datos: {
    memberId?: string | null;
    paymentMethodId?: string | null;
    userId?: string | null;
    email?: string | null;
    /**
     * El `payment_method_type` de Whop (`card`, `apple_pay`, `google_pay`,
     * ...). Decide qué botón muestra el upsell: `data-hilvana-upsell` (cobro
     * silencioso) para tarjeta, el wallet nativo para Apple Pay/Google Pay —
     * ver `app/loader.js/route.ts` y la migración 009. `null`/desconocido cae
     * al camino de tarjeta, que es el más restrictivo.
     */
    paymentMethodType?: string | null;
  },
): Promise<void> {
  await q(
    `update ordenes
        set whop_member_id = coalesce(whop_member_id, $1),
            whop_payment_method_id = coalesce(whop_payment_method_id, $2),
            whop_user_id = coalesce(whop_user_id, $3),
            email = coalesce(email, $4),
            whop_payment_method_type = coalesce(whop_payment_method_type, $5),
            metodo_guardado = metodo_guardado or ($2 is not null),
            updated_at = now()
      where id = $6`,
    [
      datos.memberId ?? null,
      datos.paymentMethodId ?? null,
      datos.userId ?? null,
      datos.email ?? null,
      datos.paymentMethodType ?? null,
      ordenId,
    ],
  );
}

/**
 * Encola un evento para el dashboard-admin. No se postea acá: Whop reintenta el
 * webhook si tardamos más de 5 segundos, y un panel lento provocaría eventos
 * duplicados. Un cron drena la cola.
 *
 * `ON CONFLICT` no aplica porque no hay clave natural, así que la protección
 * contra duplicados es que solo se encola cuando `aplicarEstadoDePago` devolvió
 * `cambio: true`.
 */
export async function encolarSalida(cobroId: string | null, payload: unknown): Promise<void> {
  await q('insert into salidas (cobro_id, payload) values ($1, $2::jsonb)', [
    cobroId,
    JSON.stringify(payload),
  ]);
}

/**
 * Resuelve a qué orden pertenece un pago de Whop.
 *
 * Dos caminos, en orden de confiabilidad:
 *   1. `metadata.orden_id` — lo pusimos nosotros al crear la sesión o el cobro,
 *      y la doc dice que el metadata de la checkout configuration se copia a los
 *      pagos.
 *   2. `checkout_configuration_id` — campo propio del objeto Payment, contra la
 *      columna única de la orden. Es el respaldo si el metadata no viajó.
 *
 * El email NO se usa como vínculo: la gente lo escribe distinto, usa alias, y
 * dos compradores pueden compartirlo.
 */
export async function resolverOrdenDePago(pago: {
  metadata?: Record<string, unknown> | null;
  checkout_configuration_id?: string | null;
}): Promise<Orden | null> {
  const porMetadata = pago.metadata?.orden_id;
  if (typeof porMetadata === 'string' && /^[0-9a-f-]{36}$/i.test(porMetadata)) {
    const orden = await q1<Orden>(
      `select ${COLS_ORDEN} from ordenes where id = $1`,
      [porMetadata],
    );
    if (orden) return orden;
  }

  if (pago.checkout_configuration_id) {
    return q1<Orden>(
      `select ${COLS_ORDEN} from ordenes where whop_checkout_config_id = $1`,
      [pago.checkout_configuration_id],
    );
  }

  return null;
}

/**
 * Crea la fila del cobro del front si no existe.
 *
 * El front no pasa por `/api/upsell/cobrar`, así que su cobro no se crea antes
 * de llamar a Whop: se registra cuando llega el pago (por claim o por webhook).
 * El `ON CONFLICT DO NOTHING` sobre el índice (orden_id, pagina_id) hace que
 * claim y webhook puedan correr a la vez sin duplicar.
 */
export async function registrarCobroDelFront(
  orden: Orden,
  pago: PagoWhop | (Record<string, unknown> & { id: string }),
): Promise<Cobro | null> {
  const p = pago as Partial<PagoWhop> & { id: string };

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
    `insert into cobros (orden_id, pagina_id, producto_id, whop_plan_id, whop_payment_id,
                         status, idempotency_key, monto, moneda, origen)
     select $1, pg.id, pg.producto_id, pr.whop_plan_id, $2, 'creando', $3, $4, $5, 'front'
       from paginas pg
       join productos pr on pr.id = pg.producto_id
      where pg.id = $6
     on conflict do nothing`,
    [
      orden.id,
      p.id,
      `front:${orden.id}`,
      p.settlement_amount ?? null,
      p.currency ?? null,
      orden.pagina_id,
    ],
  );

  return buscarCobro(orden.id, orden.pagina_id);
}
