/**
 * Cliente HTTP de Whop. TODAS las llamadas a Whop pasan por acá.
 *
 * Es un fetch a mano y no `@whop/sdk` a propósito: lo único que necesitamos son
 * cuatro endpoints, y el SDK agrega una capa que ya nos mintió una vez (su doc
 * muestra `webhooks.unwrap`, que no existe en el paquete publicado). Con fetch
 * directo, lo que se ve en el código es exactamente lo que sale por la red.
 */

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

function config() {
  const apiKey = process.env.WHOP_API_KEY;
  const base = process.env.WHOP_API_BASE;
  const versionDate = process.env.WHOP_API_VERSION_DATE;

  if (!apiKey) throw new Error('WHOP_API_KEY no está configurada');
  if (!base) throw new Error('WHOP_API_BASE no está configurada');
  // Sin el pin de versión, un cambio de la API rompe producción sin aviso. Y
  // como el valor forma parte de la clave de idempotencia del lado de Whop, que
  // esté vacío también rompería el replay de los reintentos.
  if (!versionDate) throw new Error('WHOP_API_VERSION_DATE no está configurada');

  return { apiKey, base: base.replace(/\/$/, ''), versionDate };
}

/** El company id (`biz_...`) que va como `account_id` en los POST. */
export function companyId(): string {
  const id = process.env.WHOP_COMPANY_ID;
  if (!id) throw new Error('WHOP_COMPANY_ID no está configurada');
  return id;
}

export async function whopFetch<T>(path: string, init: RequestInit = {}, opts: Opciones = {}): Promise<T> {
  const { apiKey, base, versionDate } = config();

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
    const err = (body as { error?: { message?: string; code?: string; param?: string } } | null)?.error;
    throw new WhopError(
      res.status,
      err?.message ?? `Whop respondió ${res.status}`,
      err?.code,
      err?.param,
      replayed,
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
};

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
      account_id: companyId(),
      plan_id: params.planId,
      mode: 'payment',
      ...(params.metadata ? { metadata: params.metadata } : {}),
      ...(params.redirectUrl ? { redirect_url: params.redirectUrl } : {}),
      ...(params.frictionless === false ? {} : { three_ds_level: 'frictionless' }),
    }),
  });
}

/** Trae un pago por id. Es la fuente de verdad del estado, junto con el webhook. */
export async function obtenerPago(pagoId: string): Promise<PagoWhop> {
  return whopFetch<PagoWhop>(`/payments/${encodeURIComponent(pagoId)}`);
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
  return whopFetch<PagoWhop>(
    '/payments',
    {
      method: 'POST',
      body: JSON.stringify({
        account_id: companyId(),
        plan_id: params.planId,
        member_id: params.memberId,
        payment_method_id: params.paymentMethodId,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      }),
    },
    { idempotencyKey: params.idempotencyKey },
  );
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
    `/plans?account_id=${encodeURIComponent(companyId())}&limit=100`,
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
    `/products?account_id=${encodeURIComponent(companyId())}&limit=100`,
  );
  return Array.isArray(res) ? res : (res.data ?? []);
}
