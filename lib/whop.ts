/**
 * Cliente HTTP de Whop. TODAS las llamadas a Whop pasan por acá.
 *
 * Es un fetch a mano y no `@whop/sdk` a propósito: lo único que necesitamos son
 * cuatro endpoints, y el SDK agrega una capa que ya nos mintió una vez (su doc
 * muestra `webhooks.unwrap`, que no existe en el paquete publicado). Con fetch
 * directo, lo que se ve en el código es exactamente lo que sale por la red.
 */

import { resolverCredenciales } from './whop-credenciales';

const TIMEOUT_MS = 15_000;

/** Error de la API de Whop, con lo necesario para decidir qué hacer. */
export class WhopError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly param?: string,
    /**
     * `Idempotent-Replayed: true` en la respuesta. Significa que Whop devolvió
     * la respuesta guardada de un request anterior con la misma clave en vez de
     * ejecutar de nuevo. Se loguea: es la señal de que un reintento nuestro
     * evitó un doble cobro.
     */
    readonly replayed = false,
    /**
     * El `error.type` de Whop: `bad_request`, `invalid_request_error`,
     * `not_found`. Se guarda porque es lo único que separa un 400 "tus datos
     * están mal" de un 400 "no pude procesar el cobro", y de esa distinción
     * depende si al comprador se le pide la tarjeta o se le tira la venta a la
     * basura. Ver `noSePudoProcesar`.
     */
    readonly type?: string,
  ) {
    super(message);
    this.name = 'WhopError';
  }

  /**
   * 409 en un request idempotente significa que el resultado del original quedó
   * INDETERMINADO (se cortó a mitad de camino). No se reintenta con clave nueva:
   * hay que consultar el estado antes de hacer cualquier cosa, porque el cobro
   * puede haber salido.
   */
  get indeterminado(): boolean {
    return this.status === 409;
  }

  /** 5xx y 429: vale reintentar con la MISMA clave de idempotencia. */
  get reintentable(): boolean {
    return this.status >= 500 || this.status === 429;
  }

  /**
   * Whop aceptó el request como bien formado y **no pudo cobrar** — distinto de
   * "los datos que mandaste están mal".
   *
   * Se reconoce por `type: 'bad_request'` SIN `code`. Medido contra la API real
   * el 2026-09-11, con un cobro off-session cuyos cuatro ids eran válidos:
   *
   *   400 {"error":{"type":"bad_request","message":"We could not process this
   *        payment request right now. Please try again later."}}
   *
   * y ninguna otra pista: sin `decline_code`, sin `code`, sin objeto de pago
   * creado. Los errores de DATOS son distintos y sí se pueden distinguir — se
   * verificaron los cuatro casos contra la API:
   *
   *   · plan/member/payment_method inexistente → 404 `not_found`, con el
   *     mensaje diciendo cuál ("This Member was not found")
   *   · falta un campo obligatorio → 400 `invalid_request_error` con
   *     `code: 'parameter_missing'` y `param`
   *
   * Por qué importa: un cobro off-session no puede completar un desafío 3DS,
   * porque no hay nadie del otro lado para responderlo. Cuando el emisor lo
   * exige, este es el error que llega. La venta NO está perdida — en el
   * checkout el comprador SÍ está presente y puede autenticarse — pero solo si
   * se lo manda ahí en vez de marcarle el cobro como fallido.
   *
   * Se excluye el 404 explícitamente: `type` no viene en todas las respuestas y
   * un `not_found` sin type no puede caer acá. Pedirle la tarjeta a alguien
   * porque el `member_id` no existe no arregla nada y encima le cobra el paso
   * siguiente a una configuración rota.
   */
  get noSePudoProcesar(): boolean {
    return this.status === 400 && this.type === 'bad_request' && !this.code;
  }
}

type Opciones = {
  /**
   * Se manda como header `Idempotency-Key`. Whop guarda la respuesta 24 h y
   * replaya la original ante un reintento.
   *
   * "Mismo request" para Whop incluye método, path, query, body Y
   * `Api-Version-Date`. Si cambia cualquier cosa del body con la misma clave,
   * devuelve 400. Por eso el body de un cobro tiene que ser determinístico.
   */
  idempotencyKey?: string;
  /** Devuelve también los headers, para poder leer `Idempotent-Replayed`. */
  conHeaders?: boolean;
};

/**
 * Las credenciales con las que sale este request.
 *
 * Antes leía `process.env` directo. Ahora delega en `lib/whop-credenciales.ts`,
 * que mira primero la fila de `config` (para poder rotar la key desde el panel
 * sin redeployar) y cae a las variables de entorno. El env sigue siendo el piso
 * obligatorio, así que el comportamiento con la tabla vacía es el de antes,
 * incluidos los mensajes de error.
 *
 * Es `async` porque leer de la base lo es. Se pudo hacer sin tocar a ningún
 * consumidor de este módulo: `config()` y `companyId()` solo se llaman desde acá
 * adentro, y los siete lugares que las usan ya eran funciones `async`. El
 * contrato exportado de `lib/whop.ts` no cambió.
 *
 * El costo por llamada es cero en el caso normal: `resolverCredenciales` cachea
 * en memoria por 30 segundos y el guardado invalida el caché, así que un cobro no
 * agrega un round-trip a Postgres.
 */
async function config() {
  const { credenciales } = await resolverCredenciales();
  return {
    apiKey: credenciales.apiKey,
    base: credenciales.base,
    versionDate: credenciales.versionDate,
  };
}

/** El company id (`biz_...`) que va como `account_id` en los POST. */
export async function companyId(): Promise<string> {
  const { credenciales } = await resolverCredenciales();
  return credenciales.companyId;
}

export async function whopFetch<T>(path: string, init: RequestInit = {}, opts: Opciones = {}): Promise<T> {
  const { apiKey, base, versionDate } = await config();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Api-Version-Date': versionDate,
    ...(init.headers as Record<string, string> | undefined),
  };

  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  // Un fetch sin timeout puede quedar colgado indefinidamente en el proceso,
  // y el comprador se queda mirando un spinner sin saber si le cobraron.
  const señal = AbortSignal.timeout(TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers, signal: señal, cache: 'no-store' });
  } catch (err) {
    // Timeout o red caída. Se marca como reintentable (503) porque el request
    // PUEDE haber llegado: quien lo reintente tiene que usar la misma clave de
    // idempotencia, nunca una nueva.
    const motivo = err instanceof Error ? err.message : String(err);
    throw new WhopError(503, `no se pudo contactar a Whop (${motivo})`, 'network_error');
  }

  const replayed = res.headers.get('Idempotent-Replayed') === 'true';
  if (replayed) {
    console.log(`[whop] respuesta replayada por idempotencia: ${init.method ?? 'GET'} ${path}`);
  }

  const texto = await res.text();
  let body: unknown = null;
  if (texto) {
    try {
      body = JSON.parse(texto);
    } catch {
      // Un 502 de un proxy devuelve HTML. Se conserva el texto para el log.
      body = { error: { message: texto.slice(0, 300) } };
    }
  }

  if (!res.ok) {
    const err = (
      body as { error?: { message?: string; code?: string; param?: string; type?: string } } | null
    )?.error;
    throw new WhopError(
      res.status,
      err?.message ?? `Whop respondió ${res.status}`,
      err?.code,
      err?.param,
      replayed,
      err?.type,
    );
  }

  return body as T;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * El objeto Payment, recortado a lo que se usa. No se declaran los ~60 campos
 * restantes: cada uno sería una promesa de forma que no controlamos.
 */
export type PagoWhop = {
  id: string;
  /** Ciclo de vida: draft | open | authorized | paid | pending | uncollectible | unresolved | void */
  status: string | null;
  /**
   * El estado "amigable". Es el campo que hay que mirar para saber si entró la
   * plata: succeeded | pending | failed | past_due | canceled | refunded | ...
   */
  substatus: string;
  decline_code: string | null;
  failure_message: string | null;
  currency: string;
  /** Lo que se le cobró al comprador, con impuestos y después de descuentos. */
  settlement_amount: number;
  total: number | null;
  metadata: Record<string, unknown> | null;
  checkout_configuration_id: string | null;
  member: { id: string } | null;
  user: { id: string; email: string | null; name: string | null } | null;
  /**
   * El método tokenizado. `null` cuando el comprador pagó con algo que no se
   * puede guardar: esa persona no tiene one-click.
   *
   * OJO: el id acá viene con prefijo `payt_`, pero el ejemplo del request de
   * POST /payments lo muestra como `pmt_`. La doc de Whop es inconsistente. Se
   * usa el valor TAL CUAL viene; nunca validar el prefijo.
   */
  payment_method: { id: string; payment_method_type: string | null } | null;
  plan: { id: string } | null;
  paid_at: string | null;
  /** true cuando Whop puede reintentar el cobro solo. Importa para no cobrar dos veces. */
  retryable: boolean;
  next_payment_attempt: string | null;
  /**
   * Cuándo se reembolsó y cuándo se alertó una disputa. Los dos son OPCIONALES
   * en el tipo (`?`) y no `| null` a secas: no estaban en la lista de campos que
   * se verificó contra la API el 2026-09-10, así que el código que los lee tiene
   * que tolerar que no vengan.
   *
   * Importan porque son la única forma de ver un reembolso SIN webhook. El
   * webhook es hoy el único que escribe `cobros.reembolsado_at`, y Whop
   * deshabilita un endpoint que falla 72 h sin reenviar lo de ese período: sin
   * estos dos campos, un reembolso ocurrido durante una caída del webhook no
   * aparece nunca en el panel.
   */
  refunded_at?: string | null;
  dispute_alerted_at?: string | null;
  /**
   * Link para que el comprador complete el 3DS de un pago que falló pidiendo
   * autenticación. Viene en `payment.failed` y en `GET /payments/{id}`; los
   * listados NO lo traen.
   *
   * Es `null` cuando la recuperación no está disponible. Todavía no se usa: es
   * la pieza que le falta al flujo de `requiere_tarjeta` para poder mandarle a la
   * persona un link en vez de pedirle la tarjeta de nuevo.
   */
  recovery_url?: string | null;
};

// ── Normalización del objeto Payment ────────────────────────────────────────

/**
 * Convierte un importe de Whop a número, venga como venga.
 *
 * Whop devuelve los importes de tres formas distintas según el endpoint y la
 * versión: número suelto (`12.18`), objeto (`{amount: "50.00", currency: "usd"}`)
 * o string. Verificado el 2026-09-10: `GET /payments/{id}` con
 * `Api-Version-Date: 2026-08-21-1` devuelve `total: 12.18` (número), y el ejemplo
 * de `payment.succeeded` de la doc —pinneado a `2026-09-09`— devuelve
 * `total: {amount: "50.00", ...}` (objeto).
 */
function montoDe(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  if (valor && typeof valor === 'object' && 'amount' in valor) {
    return montoDe((valor as { amount: unknown }).amount);
  }
  return null;
}

function idDe(plano: unknown, anidado: unknown): string | null {
  if (typeof plano === 'string' && plano) return plano;
  if (anidado && typeof anidado === 'object' && 'id' in anidado) {
    const id = (anidado as { id: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

/**
 * Lleva CUALQUIER payload de pago de Whop a la forma que usa el resto del código.
 *
 * ── Por qué existe: el bug que evita ────────────────────────────────────────
 * La forma del objeto Payment **depende del `api_version_date`** con el que se
 * consulta o con el que se creó el webhook. Medido el 2026-09-10:
 *
 * | Campo | `GET /payments/{id}` con `2026-08-21-1` | `payment.succeeded` de la doc (`2026-09-09`) |
 * |---|---|---|
 * | member | `member: {id}` | `member_id` plano |
 * | método de pago | `payment_method: {id}` | `payment_method_id` plano |
 * | email | `user: {email}` | `customer_email` en la raíz |
 * | plan | `plan: {id}` | `plan_id` plano |
 * | importe | `settlement_amount: 12.18` | **no existe**; solo `total: {amount}` |
 *
 * El handler del webhook leía únicamente la forma anidada. Con un webhook que
 * entregue la forma plana, eso significa: `whop_member_id` NULL,
 * `whop_payment_method_id` NULL —o sea **cero upsells one-click**— y `monto`
 * NULL, que además hace que la venta no se reporte al panel (`armarPayloadIngest`
 * la omite por "no tiene monto") y que no aparezca en los números.
 *
 * Y no se puede elegir la versión del webhook: crearlo por API requiere el scope
 * `developer:manage_webhook`, que en esta key está en **false** (verificado), así
 * que se crea desde el dashboard y la versión la pone Whop.
 *
 * Por eso esto no es defensa teórica: es la única forma de que el webhook
 * registre bien una venta sin depender de qué versión le tocó.
 */
export function normalizarPago(crudo: unknown): PagoWhop {
  const p = (crudo ?? {}) as Record<string, unknown>;

  const memberId = idDe(p.member_id, p.member);
  const paymentMethodId = idDe(p.payment_method_id, p.payment_method);
  const userAnidado = (p.user ?? null) as Record<string, unknown> | null;
  const userId = idDe(p.user_id, p.user);
  const email = texto(p.customer_email) ?? texto(userAnidado?.email);
  const planId = idDe(p.plan_id, p.plan);

  // Orden de preferencia del importe, y el motivo de cada exclusión:
  //   · `settlement_amount` — lo que se le cobró de verdad. El mejor.
  //   · `total` — mismo número en la versión medida (12.18 en los dos).
  //   · `presentment_total` — lo que vio el comprador en su moneda.
  //   · `subtotal` — sin impuestos, último recurso.
  // NO se usa `amount_after_fees` (es neto de la comisión de Whop: mostraría de
  // menos lo que pagó la persona) ni `usd_total` (convertido, no es lo cobrado).
  const monto =
    montoDe(p.settlement_amount) ??
    montoDe(p.total) ??
    montoDe(p.presentment_total) ??
    montoDe(p.subtotal);

  const moneda =
    texto(p.currency) ??
    texto((p.total as { currency?: unknown } | null)?.currency) ??
    texto((p.settlement_currency as { code?: unknown } | null)?.code as string);

  return {
    id: typeof p.id === 'string' ? p.id : '',
    status: texto(p.status),
    // `substatus` es el campo que decide si entró la plata. Si no viene, se deja
    // el string vacío: `mapearEstado` lo trata como desconocido y devuelve
    // 'procesando', que es el default seguro (nunca 'fallido' por no saber).
    substatus: typeof p.substatus === 'string' ? p.substatus : '',
    decline_code: texto(p.decline_code),
    failure_message: texto(p.failure_message),
    currency: moneda ?? 'usd',
    settlement_amount: monto as number,
    total: montoDe(p.total),
    metadata: (p.metadata as Record<string, unknown> | null) ?? null,
    checkout_configuration_id: texto(p.checkout_configuration_id),
    member: memberId ? { id: memberId } : null,
    user: userId ? { id: userId, email, name: texto(userAnidado?.name) } : null,
    payment_method: paymentMethodId
      ? {
          id: paymentMethodId,
          payment_method_type:
            texto((p.payment_method as { payment_method_type?: unknown } | null)?.payment_method_type) ??
            texto(p.payment_method_type),
        }
      : null,
    plan: planId ? { id: planId } : null,
    paid_at: texto(p.paid_at),
    retryable: p.retryable === true,
    next_payment_attempt: texto(p.next_payment_attempt) ?? texto(p.next_payment_attempt_at),
    refunded_at: texto(p.refunded_at),
    dispute_alerted_at: texto(p.dispute_alerted_at),
    recovery_url: texto(p.recovery_url),
  };
}

export type CheckoutConfigWhop = {
  id: string;
  mode: 'payment' | 'setup';
  purchase_url: string | null;
  redirect_url: string | null;
  metadata: Record<string, unknown> | null;
  plan: {
    id: string;
    initial_price: number;
    currency: string;
    plan_type: string;
    adaptive_pricing_enabled: boolean;
  } | null;
};

export type PlanWhop = {
  id: string;
  initial_price: number;
  currency: string;
  plan_type: string;
  visibility?: string;
  internal_notes?: string | null;
  product?: { id: string; title?: string } | null;
};

/** Un "product" del dashboard de Whop. En la API el recurso se llama `access_pass`. */
export type ProductoWhop = {
  id: string;
  title: string;
  route?: string | null;
  visibility?: string;
  headline?: string | null;
  description?: string | null;
  /** La imagen del producto, si tiene. La forma varía según la versión de la API. */
  image_url?: string | null;
};

// ── Operaciones ──────────────────────────────────────────────────────────────

/**
 * Crea la sesión de checkout que se le pasa al embed como `sessionId`.
 *
 * El `metadata` es lo que ata el pago a la orden: la doc dice que se copia a los
 * pagos y a las memberships que salgan de esta sesión. Igual se guarda el `id`
 * devuelto en la orden, porque el objeto Payment trae
 * `checkout_configuration_id` como campo propio y es el vínculo más directo.
 *
 * `three_ds_level: 'frictionless'` pide a Whop que evite el desafío 3DS cuando
 * la red lo permite. Importa más de lo que parece: cada 3DS en la compra del
 * front es una tarjeta que puede terminar sin guardarse, y sin tarjeta guardada
 * no hay upsell one-click. No es una garantía — si el banco lo exige, el
 * desafío aparece igual.
 */
export async function crearCheckoutConfiguration(params: {
  planId: string;
  metadata?: Record<string, unknown>;
  redirectUrl?: string;
  frictionless?: boolean;
}): Promise<CheckoutConfigWhop> {
  return whopFetch<CheckoutConfigWhop>('/checkout_configurations', {
    method: 'POST',
    body: JSON.stringify({
      account_id: await companyId(),
      plan_id: params.planId,
      mode: 'payment',
      ...(params.metadata ? { metadata: params.metadata } : {}),
      ...(params.redirectUrl ? { redirect_url: params.redirectUrl } : {}),
      ...(params.frictionless === false ? {} : { three_ds_level: 'frictionless' }),
    }),
  });
}

/**
 * Trae un pago por id. Es la fuente de verdad del estado, junto con el webhook.
 *
 * Pasa por `normalizarPago` para que el resto del código vea una sola forma, sin
 * importar a qué versión esté pinneada la API. Verificado el 2026-09-10: con
 * `2026-08-21-1` este endpoint devuelve la forma anidada (`member: {id}`) y
 * `settlement_amount`, mientras que la doc del webhook muestra la plana
 * (`member_id`) sin `settlement_amount`.
 */
export async function obtenerPago(pagoId: string): Promise<PagoWhop> {
  const crudo = await whopFetch<unknown>(`/payments/${encodeURIComponent(pagoId)}`);
  return normalizarPago(crudo);
}

/**
 * Cobra la tarjeta guardada, sin interacción del comprador. El corazón del
 * one-click.
 *
 * Devuelve el pago INMEDIATAMENTE, pero el cobro se procesa de forma asíncrona:
 * el status que viene acá no es el resultado final. De ahí el polling.
 *
 * El body tiene que ser byte a byte igual entre reintentos con la misma
 * `idempotencyKey`, o Whop responde 400. Por eso no se le agregan campos
 * variables (timestamps, contadores de intento).
 */
export async function crearPagoOffSession(params: {
  planId: string;
  memberId: string;
  paymentMethodId: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<PagoWhop> {
  const crudo = await whopFetch<unknown>(
    '/payments',
    {
      method: 'POST',
      body: JSON.stringify({
        account_id: await companyId(),
        plan_id: params.planId,
        member_id: params.memberId,
        payment_method_id: params.paymentMethodId,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      }),
    },
    { idempotencyKey: params.idempotencyKey },
  );
  return normalizarPago(crudo);
}

/** Un plan por id. Se usa en el panel para mostrar el precio real y el nombre soft. */
export async function obtenerPlan(planId: string): Promise<PlanWhop> {
  return whopFetch<PlanWhop>(`/plans/${encodeURIComponent(planId)}`);
}

/**
 * Lista los planes de la company, para el selector del panel.
 *
 * `account_id` es OBLIGATORIO: sin el query param la API devuelve
 * 400 "account_id is required". Verificado contra la API real el 2026-09-10.
 *
 * Y ojo con el endpoint vecino: `GET /products` SIN `account_id` responde 200
 * pero devuelve el CATÁLOGO PÚBLICO de Whop, no los productos propios. Es una
 * trampa fea porque parece que funcionó. Cualquier listado de este módulo va
 * scopeado por company, siempre.
 */
export async function listarPlanes(): Promise<PlanWhop[]> {
  const res = await whopFetch<{ data?: PlanWhop[] } | PlanWhop[]>(
    `/plans?account_id=${encodeURIComponent(await companyId())}&limit=100`,
  );
  return Array.isArray(res) ? res : (res.data ?? []);
}

/**
 * Lista los productos de la company.
 *
 * **`account_id` es obligatorio y omitirlo es peligroso, no solo incorrecto.**
 * Sin el query param este endpoint responde 200 y devuelve el **catálogo público
 * de Whop**: 20 productos de otros negocios. Verificado contra la API real el
 * 2026-09-10. Es la peor de las trampas de esta API porque parece que funcionó, y
 * un panel que muestre eso te ofrece vincular el link de pago al producto de un
 * desconocido.
 */
export async function listarProductosWhop(): Promise<ProductoWhop[]> {
  const res = await whopFetch<{ data?: ProductoWhop[] } | ProductoWhop[]>(
    `/products?account_id=${encodeURIComponent(await companyId())}&limit=100`,
  );
  return Array.isArray(res) ? res : (res.data ?? []);
}

/**
 * Una fila del listado de pagos, recortada a los campos con los que se
 * IDENTIFICA un pago. Deliberadamente no trae estado.
 *
 * ── La doc y la API no dicen lo mismo, otra vez ─────────────────────────────
 * Verificado el 2026-09-10 contra `GET /payments` con `Api-Version-Date:
 * 2026-08-21-1`. La fila del listado trae estas 46 claves:
 *
 *   amount_after_fees, application_fee, auto_refunded, billing_address,
 *   billing_reason, card_brand, card_last4, checkout_configuration_id, company,
 *   created_at, currency, customer_phone, decline_code, dispute_alerted_at,
 *   failure_message, id, last_payment_attempt, member, membership, metadata,
 *   needs_tracking, next_payment_attempt, paid_at, payment_instrument,
 *   payment_method, payment_method_type, payments_failed, plan, product,
 *   promo_code, refundable, refunded_amount, refunded_at, retryable,
 *   settlement_currency, shipment, shipping_address, status, substatus,
 *   subtotal, tax_amount, tax_behavior, total, updated_at, usd_total, user,
 *   voidable
 *
 * Dos diferencias con la doc pública, que muestra la versión beta:
 *   · **`plan_id` NO existe.** El plan viene anidado: `plan: {id, ...}`. La doc
 *     lo muestra plano. Por eso el normalizador de abajo lee las dos formas.
 *   · **`settlement_amount` tampoco está**, y los importes son objetos
 *     (`total: {amount, currency}`) en la doc pero acá vienen como los devuelve
 *     esta versión. `PagoWhop` está verificado contra `GET /payments/{id}`, no
 *     contra este endpoint.
 *
 * Por eso este tipo tiene solo lo mínimo: el listado se usa para averiguar QUÉ
 * pago le corresponde a un cobro huérfano, y el estado se lee después con
 * `obtenerPago(id)`, que sí devuelve la forma conocida. Un campo de este listado
 * nunca decide si un cobro está pagado.
 */
export type PagoListado = {
  id: string;
  metadata: Record<string, unknown> | null;
  /**
   * El vínculo más fuerte para el cobro del front: se compara contra
   * `ordenes.whop_checkout_config_id`, que tiene índice único.
   */
  checkout_configuration_id: string | null;
  planId: string | null;
  created_at: string | null;
};

/**
 * Lista los pagos de la company, más nuevos primero.
 *
 * `account_id` es obligatorio igual que en `/plans` y `/products` — sin él la
 * API responde 400 `account_id is required`.
 *
 * Se usa en la reconciliación para el caso peor del módulo: un cobro que quedó
 * en `procesando` SIN `whop_payment_id`, que es lo que pasa cuando `POST
 * /payments` se cortó a mitad de camino (409 indeterminado, timeout, red caída).
 * Ese cobro puede haber salido de verdad, y como no tenemos el id no hay nada
 * que consultar: la única forma de encontrarlo es listar los pagos recientes y
 * buscar el que tenga nuestro `metadata.orden_id`.
 *
 * `created_after` acota la ventana para no paginar el histórico entero.
 *
 * Los nombres de los parámetros de query son los de la doc (`first`, no
 * `limit`; `created_after`, no `desde`). Ojo con eso: `/plans` y `/products` de
 * arriba usan `limit`, y mezclarlos hace que la API ignore el parámetro en
 * silencio y devuelva su default.
 */
export async function listarPagos(params: {
  creadosDespuesDe?: Date;
  limite?: number;
} = {}): Promise<PagoListado[]> {
  const query = new URLSearchParams({
    account_id: await companyId(),
    first: String(params.limite ?? 50),
    order: 'created_at',
    direction: 'desc',
  });
  if (params.creadosDespuesDe) {
    query.set('created_after', params.creadosDespuesDe.toISOString());
  }

  const res = await whopFetch<{ data?: unknown[] } | unknown[]>(`/payments?${query.toString()}`);
  const filas = Array.isArray(res) ? res : (res.data ?? []);

  return filas
    .map((cruda) => {
      const p = cruda as Record<string, unknown>;
      const id = typeof p.id === 'string' ? p.id : null;
      if (!id) return null;
      // `plan: {id}` en esta versión (verificado), `plan_id` plano en la doc de
      // la beta. Se leen las dos formas: la doc de Whop ya fue inconsistente
      // antes con `payt_`/`pmt_`, y una lectura que soporta ambas no se rompe
      // cuando la unifiquen en cualquier dirección.
      const plan = p.plan as { id?: unknown } | null | undefined;
      return {
        id,
        metadata: (p.metadata as Record<string, unknown> | null) ?? null,
        checkout_configuration_id:
          typeof p.checkout_configuration_id === 'string' ? p.checkout_configuration_id : null,
        planId:
          typeof plan?.id === 'string'
            ? plan.id
            : typeof p.plan_id === 'string'
              ? p.plan_id
              : null,
        created_at: typeof p.created_at === 'string' ? p.created_at : null,
      } satisfies PagoListado;
    })
    .filter((p): p is PagoListado => p !== null);
}
