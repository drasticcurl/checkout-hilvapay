import { describe, expect, it } from 'vitest';
import {
  clasificarDecline,
  esFinal,
  mapearEstado,
  mensajeParaComprador,
  type AccionDecline,
} from './estado-pago';

describe('mapearEstado', () => {
  it('succeeded es pagado', () => {
    expect(mapearEstado({ substatus: 'succeeded' })).toBe('pagado');
  });

  it.each(['pending', 'incomplete', 'drafted', 'requires_capture'])('%s sigue procesando', (sub) => {
    expect(mapearEstado({ substatus: sub })).toBe('procesando');
  });

  it('requires_capture NO es pagado: la plata todavía no entró', () => {
    // Un autorizado sin capturar expira a los cinco días. Darlo por pagado
    // entregaría el producto por un cobro que puede no completarse nunca.
    expect(mapearEstado({ substatus: 'requires_capture' })).not.toBe('pagado');
  });

  it.each(['past_due', 'canceled', 'uncollectible', 'price_too_low'])(
    '%s sin decline_code recuperable es fallido',
    (sub) => {
      expect(mapearEstado({ substatus: sub, decline_code: 'suspected_fraud' })).toBe('fallido');
    },
  );

  // El caso que el mapeo por substatus del spec original perdía.
  it('failed + authentication_required pide la tarjeta, no es fallido', () => {
    expect(mapearEstado({ substatus: 'failed', decline_code: 'authentication_required' })).toBe(
      'requiere_tarjeta',
    );
  });

  it.each([
    'three_d_secure_failed',
    'three_d_secure_card_not_enrolled',
    'three_d_secure_rejected_by_bank',
    'expired_card',
    'invalid_cvc',
  ])('failed + %s pide la tarjeta', (code) => {
    expect(mapearEstado({ substatus: 'failed', decline_code: code })).toBe('requiere_tarjeta');
  });

  it('failed + fraude es fallido y no se le ofrece reintentar', () => {
    expect(mapearEstado({ substatus: 'failed', decline_code: 'stolen_card' })).toBe('fallido');
    expect(mapearEstado({ substatus: 'failed', decline_code: 'three_d_secure_fraud' })).toBe('fallido');
  });

  it('failed + insufficient_funds es fallido, no requiere_tarjeta', () => {
    // Poner la misma tarjeta de nuevo no crea fondos. Acá va el downsell.
    expect(mapearEstado({ substatus: 'failed', decline_code: 'insufficient_funds' })).toBe('fallido');
  });

  it('un reembolso deja el cobro en pagado', () => {
    // La plata entró y después salió: son dos hechos. El reembolso se anota en
    // reembolsado_at, no pisando el estado del cobro.
    expect(mapearEstado({ substatus: 'refunded' })).toBe('pagado');
    expect(mapearEstado({ substatus: 'partially_refunded' })).toBe('pagado');
  });

  it('una disputa deja el cobro en pagado', () => {
    expect(mapearEstado({ substatus: 'dispute_needs_response' })).toBe('pagado');
    expect(mapearEstado({ substatus: 'open_dispute' })).toBe('pagado');
  });

  it('un substatus desconocido queda procesando, nunca fallido', () => {
    // Si Whop agrega un estado y lo diéramos por fallido, le negaríamos el
    // producto a alguien que pagó. Procesando deja que el webhook lo resuelva.
    expect(mapearEstado({ substatus: 'estado_que_no_existe_todavia' })).toBe('procesando');
    expect(mapearEstado({ substatus: null })).toBe('procesando');
    expect(mapearEstado({})).toBe('procesando');
  });

  it('no le importan mayúsculas ni espacios', () => {
    expect(mapearEstado({ substatus: ' SUCCEEDED ' })).toBe('pagado');
    expect(mapearEstado({ substatus: 'failed', decline_code: ' Expired_Card ' })).toBe('requiere_tarjeta');
  });
});

describe('clasificarDecline', () => {
  const casos: Array<[string, AccionDecline]> = [
    ['authentication_required', 'pedir_tarjeta'],
    ['three_d_secure_timeout', 'reintentar'],
    ['three_d_secure_fraud', 'no_insistir'],
    ['three_d_secure_reported_lost_or_stolen', 'no_insistir'],
    ['expired_card', 'pedir_tarjeta'],
    ['invalid_card_number', 'pedir_tarjeta'],
    ['insufficient_funds', 'sin_fondos'],
    ['card_velocity_exceeded', 'sin_fondos'],
    ['lost_card', 'no_insistir'],
    ['merchant_blacklist', 'no_insistir'],
    ['blocked_by_cardholder', 'no_insistir'],
    ['duplicate_transaction', 'no_insistir'],
    ['generic_decline', 'reintentar'],
    ['try_again_later', 'reintentar'],
    ['issuer_unavailable', 'reintentar'],
    ['currency_not_supported', 'incompatible'],
    ['card_type_not_supported', 'incompatible'],
  ];

  it.each(casos)('%s → %s', (code, esperado) => {
    expect(clasificarDecline(code)).toBe(esperado);
  });

  it('un código desconocido pide la tarjeta, que es la salida que no cobra dos veces', () => {
    expect(clasificarDecline('codigo_nuevo_de_whop')).toBe('pedir_tarjeta');
    expect(clasificarDecline(null)).toBe('pedir_tarjeta');
    expect(clasificarDecline(undefined)).toBe('pedir_tarjeta');
  });

  it('ningún decline de fraude cae en reintentar', () => {
    // Es la regla que evita juntar contracargos: si un solo código de fraude se
    // clasificara como transitorio, el funnel le insistiría a una tarjeta
    // marcada.
    for (const code of ['lost_card', 'stolen_card', 'suspected_fraud', 'high_risk', 'merchant_blacklist']) {
      expect(clasificarDecline(code)).toBe('no_insistir');
    }
  });
});

describe('esFinal', () => {
  it('procesando y creando no son finales', () => {
    expect(esFinal('creando')).toBe(false);
    expect(esFinal('procesando')).toBe(false);
  });

  it('pagado, fallido y requiere_tarjeta son finales', () => {
    expect(esFinal('pagado')).toBe(true);
    expect(esFinal('fallido')).toBe(true);
    expect(esFinal('requiere_tarjeta')).toBe(true);
  });
});

describe('mensajeParaComprador', () => {
  const acciones: AccionDecline[] = [
    'pedir_tarjeta',
    'reintentar',
    'sin_fondos',
    'incompatible',
    'no_insistir',
  ];

  it('todas las acciones tienen un mensaje y ninguno filtra el código técnico', () => {
    for (const accion of acciones) {
      const msg = mensajeParaComprador(accion);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/decline|_code|three_d_secure|error/i);
    }
  });
});
