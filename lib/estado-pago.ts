/**
 * Traduce lo que devuelve Whop a los cinco estados con los que trabaja el
 * checkout, y decide qué hacer con un cobro rechazado.
 *
 * Es un módulo puro (no toca base ni red) porque es la lógica que no se puede
 * probar en producción sin cobrarle a alguien de verdad.
 *
 * ── La corrección importante ────────────────────────────────────────────────
 * NO existe un substatus "requires_action" en Whop. El enum real es:
 *   succeeded | requires_capture | pending | failed | past_due | canceled |
 *   price_too_low | uncollectible | refunded | auto_refunded |
 *   partially_refunded | dispute_* | resolution_* | drafted | incomplete |
 *   unresolved | open_dispute | open_resolution
 *
 * Cuando el banco pide autenticación en un cobro off-session, el pago llega como
 * `failed` con `decline_code: authentication_required` (o `three_d_secure_*`).
 * O sea: el caso "hay que pedirle la tarjeta otra vez" se deduce del
 * decline_code, no del substatus. Mapear solo por substatus manda todos los 3DS
 * al mismo cajón que "tarjeta robada" y hace perder ventas recuperables.
 *
 * ── La otra corrección ──────────────────────────────────────────────────────
 * Un pago off-session que pidió 3DS no se puede "continuar": la doc de Whop dice
 * que `client_secret` es null para los pagos creados desde un método guardado.
 * El único camino es cobrar de nuevo, on-session, con el embed. Eso significa un
 * pago NUEVO, así que hay que vigilar que Whop no reintente el fallido por su
 * cuenta (`retryable` / `next_payment_attempt`) o se cobra dos veces.
 */

export type EstadoCobro = 'creando' | 'procesando' | 'pagado' | 'fallido' | 'requiere_tarjeta';

/** Qué hacer con un cobro que rebotó. */
export type AccionDecline =
  /** Mostrar el embed para que ponga los datos una vez. Recuperable. */
  | 'pedir_tarjeta'
  /** Transitorio del lado del emisor. Un reintento con clave NUEVA, y nada más. */
  | 'reintentar'
  /** No hay plata. Reintentar no cambia nada; si hay downsell, es acá. */
  | 'sin_fondos'
  /** Fraude o bloqueo explícito. NO ofrecer retry ni insistir: seguir en silencio. */
  | 'no_insistir'
  /** El método no sirve para este cobro. Embed con otro método. */
  | 'incompatible';

// ── Substatus ────────────────────────────────────────────────────────────────

/** Entró la plata. */
const SUBSTATUS_PAGADO = new Set([
  'succeeded',
  // Los reembolsos y disputas se anotan aparte (`reembolsado_at`, `disputa_at`).
  // Para el flujo del funnel el cobro fue exitoso: la plata entró y después
  // salió, y son dos hechos distintos. Meterlos en `status` haría que un
  // reembolso se vea igual que un cobro que nunca salió.
  'refunded',
  'auto_refunded',
  'partially_refunded',
  'dispute_warning',
  'dispute_needs_response',
  'dispute_warning_needs_response',
  'dispute_under_review',
  'dispute_warning_under_review',
  'dispute_won',
  'dispute_warning_closed',
  'dispute_lost',
  'dispute_closed',
  'open_dispute',
  'resolution_needs_response',
  'resolution_under_review',
  'resolution_won',
  'resolution_lost',
  'open_resolution',
]);

/** Todavía se está resolviendo. Hay que seguir preguntando. */
const SUBSTATUS_PROCESANDO = new Set([
  'pending',
  'incomplete',
  'drafted',
  // Autorizado sin capturar. No debería pasar (no pasamos `capture: false`),
  // pero si pasa la plata NO entró todavía: tratarlo como pagado daría acceso
  // por un cobro que puede expirar sin capturarse.
  'requires_capture',
]);

/** Rebotó. */
const SUBSTATUS_FALLIDO = new Set([
  'failed',
  'past_due',
  'canceled',
  'uncollectible',
  'price_too_low',
  'unresolved',
]);

// ── Decline codes ────────────────────────────────────────────────────────────
//
// Los códigos salen del enum documentado de `decline_code` del objeto Payment.
// El orden de evaluación importa: `three_d_secure_fraud` empieza con
// `three_d_secure_` pero es fraude, no un desafío pendiente.

/** Fraude o bloqueo. Insistir acá es cómo se juntan contracargos. */
const NO_INSISTIR = new Set([
  'lost_card',
  'stolen_card',
  'suspected_fraud',
  'high_risk',
  'merchant_blacklist',
  'blocked_by_cardholder',
  'regulatory_blocked',
  'transaction_stopped',
  'transaction_cancelled',
  'three_d_secure_fraud',
  'three_d_secure_reported_lost_or_stolen',
  // Whop dice que este cobro ya se hizo. Si aparece, la idempotencia falló:
  // reintentar sería cobrar dos veces.
  'duplicate_transaction',
  'bank_authorization_revoked',
  'bank_payment_stopped',
  'bank_not_authorized',
  'bank_account_frozen',
  'bank_account_holder_deceased',
  'bank_regulatory_blocked',
  'sepa_disputed',
  'sepa_refused_by_customer',
]);

/** No hay fondos o se pasó de límite. */
const SIN_FONDOS = new Set([
  'insufficient_funds',
  'bank_insufficient_funds',
  'card_velocity_exceeded',
  'withdrawal_count_limit_exceeded',
  'invalid_amount',
]);

/** El método no sirve para este cobro. */
const INCOMPATIBLE = new Set(['currency_not_supported', 'card_not_supported', 'card_type_not_supported']);

/** Problema del emisor que puede no repetirse. */
const REINTENTAR = new Set([
  'generic_decline',
  'processing_error',
  'try_again_later',
  'issuer_unavailable',
  'issuer_error',
  'issuer_not_found',
  'cannot_authorize',
  'reenter_transaction',
  'invalid_transaction',
  'provider_declined',
  'bank_declined',
  'bank_processing_error',
  'bank_generic_decline',
  'bank_amount_error',
  'bank_duplicate',
  'sepa_generic_decline',
  'three_d_secure_timeout',
  'three_d_secure_generic_error',
  'test_mode_decline',
]);

/**
 * Hace falta que la persona intervenga: autenticar, o poner otra tarjeta.
 * Es el grupo que más plata recupera, y el que el mapeo por substatus perdía.
 */
const PEDIR_TARJETA = new Set([
  'authentication_required',
  'three_d_secure_success',
  'three_d_secure_canceled',
  'three_d_secure_invalid_card_number',
  'three_d_secure_failed',
  'three_d_secure_card_not_enrolled',
  'three_d_secure_too_many_attempts',
  'three_d_secure_rejected_by_bank',
  'expired_card',
  'invalid_card_number',
  'invalid_cvc',
  'invalid_cvc_or_expiration',
  'invalid_expiry',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'invalid_card_holder_name',
  'invalid_zip',
  'invalid_country',
  'incorrect_pin',
  'invalid_pin',
  'pin_required',
  'pin_required_as',
  'pin_try_exceeded',
  'restricted_card',
  'invalid_account',
  'closed_account',
  'no_accounts',
  'contact_issuer',
  'transaction_not_permitted',
  'transaction_not_allowed',
  'test_mode_test_card',
  'bank_account_not_found',
  'bank_account_closed',
  'bank_details_invalid',
  'bank_invalid_routing_number',
  'bank_non_transaction_account',
  'sepa_invalid_iban',
  'sepa_no_mandate',
  'sepa_mandate_data_invalid',
]);

/**
 * Qué hacer con un decline.
 *
 * El default para un código desconocido es `pedir_tarjeta` y no `reintentar` a
 * propósito: mostrar el embed nunca cobra dos veces y siempre le deja una
 * salida al comprador, mientras que un reintento a ciegas sobre un código que no
 * conocemos puede terminar en un segundo cargo.
 */
export function clasificarDecline(code: string | null | undefined): AccionDecline {
  if (!code) return 'pedir_tarjeta';
  const c = code.trim().toLowerCase();

  if (NO_INSISTIR.has(c)) return 'no_insistir';
  if (SIN_FONDOS.has(c)) return 'sin_fondos';
  if (INCOMPATIBLE.has(c)) return 'incompatible';
  if (PEDIR_TARJETA.has(c)) return 'pedir_tarjeta';
  if (REINTENTAR.has(c)) return 'reintentar';

  console.warn(`[estado-pago] decline_code no clasificado: "${code}" → se pide la tarjeta`);
  return 'pedir_tarjeta';
}

/**
 * Traduce un pago de Whop al estado interno del cobro.
 *
 * Solo necesita los dos campos que deciden, así que acepta cualquier objeto que
 * los tenga: eso permite usarla igual con la respuesta de la API y con el
 * payload de un webhook, que no tienen exactamente la misma forma.
 */
export function mapearEstado(pago: { substatus?: string | null; decline_code?: string | null }): EstadoCobro {
  const sub = (pago.substatus ?? '').trim().toLowerCase();

  if (SUBSTATUS_PAGADO.has(sub)) return 'pagado';
  if (SUBSTATUS_PROCESANDO.has(sub)) return 'procesando';

  if (SUBSTATUS_FALLIDO.has(sub)) {
    // Acá está la corrección: un `failed` no es necesariamente el final. Si el
    // motivo es autenticación o datos de tarjeta, la venta se recupera con el
    // embed.
    return clasificarDecline(pago.decline_code) === 'pedir_tarjeta' ? 'requiere_tarjeta' : 'fallido';
  }

  // Un substatus que no conocemos NO se trata como fallido: puede ser un estado
  // nuevo de la API, y marcar fallido un cobro que en realidad entró le negaría
  // el producto a alguien que pagó. `procesando` deja que el webhook o el
  // siguiente poll lo resuelvan.
  if (sub) console.warn(`[estado-pago] substatus no clasificado: "${sub}" → procesando`);
  return 'procesando';
}

/** Estados en los que ya no hay que seguir preguntando. */
export function esFinal(estado: EstadoCobro): boolean {
  return estado === 'pagado' || estado === 'fallido' || estado === 'requiere_tarjeta';
}

/**
 * Mensaje para el comprador. Nunca se le muestra el `decline_code` crudo: no le
 * dice nada y, en los casos de fraude, contarle qué detectó el banco es
 * regalarle información a quien está probando tarjetas.
 */
export function mensajeParaComprador(accion: AccionDecline): string {
  switch (accion) {
    case 'pedir_tarjeta':
      return 'Tu banco necesita que confirmes esta compra. Ingresá los datos de tu tarjeta una vez más para completarla.';
    case 'sin_fondos':
      return 'La tarjeta no tenía fondos disponibles para esta compra. Podés intentar con otra tarjeta.';
    case 'incompatible':
      return 'Ese medio de pago no se puede usar para esta compra. Probá con una tarjeta.';
    case 'reintentar':
      return 'Hubo un problema momentáneo al procesar el pago. Probá de nuevo en un minuto.';
    case 'no_insistir':
      return 'No pudimos procesar el pago con esa tarjeta.';
  }
}
