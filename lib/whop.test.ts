import { describe, expect, it } from 'vitest';
import { normalizarPago, WhopError } from './whop';

/**
 * `normalizarPago` es lo único que separa "la venta se registró bien" de "la
 * venta se registró sin monto y sin tarjeta guardada".
 *
 * La forma del objeto Payment depende del `api_version_date`, y el del webhook
 * NO se puede elegir: crearlo por API pide el scope `developer:manage_webhook`,
 * que en esta key está en false. Así que hay que soportar las dos formas.
 *
 * Los dos fixtures de abajo no son inventados:
 *   · ANIDADO — medido el 2026-09-10 con `GET /payments/{id}` y
 *     `Api-Version-Date: 2026-08-21-1` (el pin de este proyecto).
 *   · PLANO — el ejemplo de `payment.succeeded` de la doc de Whop, pinneado a
 *     `2026-09-09`.
 */

/** Lo que devuelve `GET /payments/{id}` con el pin de este proyecto. */
const ANIDADO = {
  id: 'pay_Ckb4HovBaYEFkk',
  status: 'paid',
  substatus: 'succeeded',
  settlement_amount: 12.18,
  total: 12.18,
  currency: 'usd',
  member: { id: 'mber_S4vZtnNLnb0zp', phone: null },
  payment_method: {
    id: 'payt_zfMXFOEJxN96P',
    payment_method_type: 'card',
    card: { brand: 'mastercard', last4: '9773' },
  },
  user: { id: 'user_rvxfiRk49SBGt', name: null, username: 'stidd1d', email: 'stidd664@gmail.com' },
  plan: { id: 'plan_sARwY0XsFUbAg', internal_notes: null, metadata: {} },
  metadata: { orden_id: 'una-orden' },
  checkout_configuration_id: 'ch_UuNFE3DqFSvPnJr',
  decline_code: null,
  failure_message: null,
  refunded_at: null,
  dispute_alerted_at: null,
  recovery_url: null,
  paid_at: '2026-09-10T11:26:57.323Z',
  retryable: false,
};

/** Lo que muestra la doc de `payment.succeeded` (pin 2026-09-09). */
const PLANO = {
  id: 'pay_xxxxxxxxxxxxxx',
  status: 'paid',
  substatus: 'succeeded',
  // NO hay settlement_amount: los importes son objetos.
  total: { amount: '50.00', currency: 'usd', decimals: 2, display_decimals: 2 },
  subtotal: { amount: '50.00', currency: 'usd', decimals: 2 },
  presentment_total: { amount: '50.00', currency: 'usd', decimals: 2 },
  amount_after_fees: { amount: '46.50', currency: 'usd', decimals: 2 },
  usd_total: { amount: '50.00', currency: 'usd', decimals: 2 },
  currency: 'usd',
  member_id: 'mber_xxxxxxxxxxxxxx',
  membership_id: 'mem_xxxxxxxxxxxxxx',
  payment_method_id: 'payt_flat',
  payment_method_type: 'card',
  plan_id: 'plan_xxxxxxxxxxxxxx',
  product_id: 'prod_xxxxxxxxxxxxxx',
  customer_email: 'marcus@shinetime.example',
  user: { id: 'user_xxxxxxxxxxxxxx', name: 'Marcus Webb', username: 'marcuswebb' },
  metadata: { orden_id: 'una-orden' },
  checkout_configuration_id: null,
  decline_code: null,
  failure_message: null,
  refunded_at: null,
  dispute_alerted_at: null,
  recovery_url: null,
  paid_at: '2026-01-01T12:00:00.000Z',
  retryable: false,
  next_payment_attempt_at: null,
};

describe('normalizarPago — forma anidada (GET /payments/{id}, pin 2026-08-21-1)', () => {
  const p = normalizarPago(ANIDADO);

  it('lee el member, el método de pago y el email', () => {
    expect(p.member?.id).toBe('mber_S4vZtnNLnb0zp');
    expect(p.payment_method?.id).toBe('payt_zfMXFOEJxN96P');
    expect(p.user?.email).toBe('stidd664@gmail.com');
  });

  it('usa settlement_amount cuando está', () => {
    expect(p.settlement_amount).toBe(12.18);
  });

  it('conserva el metadata y la checkout configuration, que son el vínculo con la orden', () => {
    expect(p.metadata).toEqual({ orden_id: 'una-orden' });
    expect(p.checkout_configuration_id).toBe('ch_UuNFE3DqFSvPnJr');
  });
});

describe('normalizarPago — forma plana (payload del webhook, pin 2026-09-09)', () => {
  const p = normalizarPago(PLANO);

  it('LEE EL MÉTODO DE PAGO de payment_method_id plano', () => {
    // Es el campo del que depende TODO el one-click. Con el handler viejo
    // quedaba en NULL y no había un solo upsell posible.
    expect(p.payment_method?.id).toBe('payt_flat');
  });

  it('lee el member de member_id plano', () => {
    expect(p.member?.id).toBe('mber_xxxxxxxxxxxxxx');
  });

  it('lee el email de customer_email, que no está dentro de user', () => {
    expect(p.user?.email).toBe('marcus@shinetime.example');
  });

  it('SACA EL IMPORTE de total.amount cuando no hay settlement_amount', () => {
    // Sin esto el cobro queda con monto NULL, y entonces la venta no se reporta
    // al panel ("omitida: el cobro no tiene monto") ni aparece en los números.
    expect(p.settlement_amount).toBe(50);
  });

  it('NO usa amount_after_fees como importe', () => {
    // Es el neto de la comisión de Whop: mostraría de menos lo que pagó la
    // persona, y ese número termina en el email y en el panel.
    expect(p.settlement_amount).not.toBe(46.5);
  });

  it('lee el plan de plan_id plano', () => {
    expect(p.plan?.id).toBe('plan_xxxxxxxxxxxxxx');
  });
});

describe('normalizarPago — las dos formas dan el mismo resultado útil', () => {
  it('los campos que deciden el estado se leen igual', () => {
    for (const crudo of [ANIDADO, PLANO]) {
      const p = normalizarPago(crudo);
      expect(p.substatus).toBe('succeeded');
      expect(p.currency).toBe('usd');
      expect(p.metadata?.orden_id).toBe('una-orden');
      expect(p.member?.id).toBeTruthy();
      expect(p.payment_method?.id).toBeTruthy();
      expect(p.user?.email).toBeTruthy();
      expect(p.settlement_amount).toBeGreaterThan(0);
    }
  });
});

describe('normalizarPago — casos degenerados', () => {
  it('un payload vacío no tira', () => {
    const p = normalizarPago({});
    expect(p.id).toBe('');
    expect(p.member).toBeNull();
    expect(p.payment_method).toBeNull();
  });

  it('null y undefined no tiran', () => {
    expect(() => normalizarPago(null)).not.toThrow();
    expect(() => normalizarPago(undefined)).not.toThrow();
  });

  it('sin substatus devuelve string vacío, no undefined', () => {
    // `mapearEstado` lo trata como desconocido y devuelve 'procesando', que es el
    // default seguro. Con `undefined` haría `(undefined ?? '')` igual, pero el
    // tipo prometería un string y mentiría.
    expect(normalizarPago({ id: 'pay_1' }).substatus).toBe('');
  });

  it('un método de pago sin id no inventa un objeto vacío', () => {
    // `metodo_guardado` se pone en true cuando el id NO es null. Un `{id: null}`
    // convertido en objeto haría creer que hay tarjeta guardada cuando no hay.
    expect(normalizarPago({ id: 'p', payment_method: { card: {} } }).payment_method).toBeNull();
    expect(normalizarPago({ id: 'p', payment_method_id: null }).payment_method).toBeNull();
  });

  it('un importe que no se puede leer queda null y no en cero', () => {
    // Un cobro sin monto no es un cobro de $0: `armarPayloadIngest` lo omite
    // explícitamente, y en cero se reportaría una venta de cero pesos.
    expect(normalizarPago({ id: 'p' }).settlement_amount).toBeNull();
    expect(normalizarPago({ id: 'p', total: {} }).settlement_amount).toBeNull();
    expect(normalizarPago({ id: 'p', total: { amount: 'no-es-un-numero' } }).settlement_amount).toBeNull();
  });

  it('un importe string se convierte a número', () => {
    expect(normalizarPago({ id: 'p', settlement_amount: '9.90' }).settlement_amount).toBe(9.9);
  });

  it('el string vacío no cuenta como valor presente', () => {
    expect(normalizarPago({ id: 'p', member_id: '' }).member).toBeNull();
    expect(normalizarPago({ id: 'p', customer_email: '' }).user).toBeNull();
  });

  it('la moneda cae a usd si no viene, para no escribir null en la columna', () => {
    expect(normalizarPago({ id: 'p' }).currency).toBe('usd');
  });

  it('lee la moneda del objeto de importe cuando no está en la raíz', () => {
    expect(normalizarPago({ id: 'p', total: { amount: '5.00', currency: 'eur' } }).currency).toBe('eur');
  });

  it('recovery_url se conserva: es lo que recupera un 3DS fallido', () => {
    const p = normalizarPago({ id: 'p', recovery_url: 'https://whop.com/recover/abc' });
    expect(p.recovery_url).toBe('https://whop.com/recover/abc');
  });

  it('next_payment_attempt se lee de las dos variantes del nombre', () => {
    expect(normalizarPago({ id: 'p', next_payment_attempt: '2026-01-01' }).next_payment_attempt).toBe(
      '2026-01-01',
    );
    expect(normalizarPago({ id: 'p', next_payment_attempt_at: '2026-02-02' }).next_payment_attempt).toBe(
      '2026-02-02',
    );
  });
});

/**
 * `noSePudoProcesar` es la que decide si una venta se recupera o se descarta, así
 * que los casos vienen de respuestas REALES de la API, medidas el 2026-09-11
 * contra `POST /payments` con un cobro off-session. Cada `it` cita la respuesta
 * que reproduce.
 */
describe('WhopError.noSePudoProcesar', () => {
  it('es true con el 400 bad_request sin código: Whop no pudo cobrar', () => {
    // Medido: los cuatro ids eran válidos (plan, member y payment_method
    // existían y eran de la company de la key) y Whop devolvió:
    //   {"error":{"type":"bad_request","message":"We could not process this
    //    payment request right now. Please try again later."}}
    const err = new WhopError(
      400,
      'We could not process this payment request right now. Please try again later.',
      undefined,
      undefined,
      false,
      'bad_request',
    );
    expect(err.noSePudoProcesar).toBe(true);
  });

  it('es false con parameter_missing: eso es un bug nuestro, no un cobro recuperable', () => {
    // Medido, omitiendo account_id:
    //   {"error":{"type":"invalid_request_error","code":"parameter_missing",
    //    "message":"Missing required parameter: company_id.","param":"company_id"}}
    // Pedirle la tarjeta al comprador no arregla un campo que no mandamos.
    const err = new WhopError(
      400,
      'Missing required parameter: company_id.',
      'parameter_missing',
      'company_id',
      false,
      'invalid_request_error',
    );
    expect(err.noSePudoProcesar).toBe(false);
  });

  it('es false con un 404 not_found: el dato no existe y la tarjeta no lo crea', () => {
    // Medido con ids inventados: 404 "This Member was not found" / "This Plan
    // was not found" / "This PaymentToken was not found". Mandar al checkout
    // ahí le cobraría el paso siguiente a una configuración rota.
    const err = new WhopError(404, 'This Member was not found', undefined, undefined, false, 'not_found');
    expect(err.noSePudoProcesar).toBe(false);
  });

  it('es false en 5xx, que ya tienen su propio camino con reintento', () => {
    const err = new WhopError(500, 'boom', undefined, undefined, false, 'bad_request');
    expect(err.noSePudoProcesar).toBe(false);
    expect(err.reintentable).toBe(true);
  });

  it('es false en el 409 indeterminado: el cobro pudo haber salido', () => {
    // Pedir la tarjeta acá arriesga cobrar dos veces.
    const err = new WhopError(409, 'conflict', undefined, undefined, false, 'bad_request');
    expect(err.noSePudoProcesar).toBe(false);
    expect(err.indeterminado).toBe(true);
  });

  it('es false en un 400 sin type: sin la señal explícita no se asume recuperable', () => {
    // Un 502 de proxy con HTML, por ejemplo, llega sin `type`. Ante la duda no
    // se manda a nadie a poner la tarjeta de nuevo.
    const err = new WhopError(400, 'algo salió mal');
    expect(err.noSePudoProcesar).toBe(false);
  });

  it('el network_error sintético no cae acá', () => {
    // lib/whop.ts tira 503 con code 'network_error' en timeout o red caída: el
    // request PUDO haber llegado, así que va por procesando.
    const err = new WhopError(503, 'no se pudo contactar a Whop (timeout)', 'network_error');
    expect(err.noSePudoProcesar).toBe(false);
    expect(err.reintentable).toBe(true);
  });
});
