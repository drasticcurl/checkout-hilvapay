/**
 * Tests de las dos piezas puras del webhook: la validación de forma del signing
 * secret y la URL que el panel le dicta al usuario.
 *
 * Las dos existen para atajar errores que NO fallan al guardarse — fallan en la
 * primera venta real, sin síntoma visible del lado del panel. Así que el valor de
 * estos tests es que el mensaje de error aparezca ANTES, no después.
 */
import { describe, expect, it } from 'vitest';
import { formaDeSecretValida } from './whop-credenciales';
import { EVENTOS_DEL_WEBHOOK, urlDelWebhook } from './admin/webhook-contrato';

describe('formaDeSecretValida', () => {
  it('acepta un signing secret con la forma que entrega Whop', () => {
    expect(formaDeSecretValida('ws_1a2b3c4d5e6f7g8h9i0j')).toBe(true);
  });

  it('acepta los caracteres de base64url y de base64 que Whop puede devolver', () => {
    expect(formaDeSecretValida('ws_abc-DEF_ghi+JKL/mno=')).toBe(true);
  });

  it('tolera espacios alrededor: pegar del dashboard suele arrastrarlos', () => {
    expect(formaDeSecretValida('  ws_1a2b3c4d5e6f7g8h9i0j  ')).toBe(true);
  });

  // El error real número uno de la guía: recodificar el secret en base64 antes de
  // pegarlo. Pierde el prefijo y la firma no valida nunca.
  it('rechaza un secret sin el prefijo ws_', () => {
    expect(formaDeSecretValida('1a2b3c4d5e6f7g8h9i0j')).toBe(false);
    expect(formaDeSecretValida('d3NfMWEyYjNjNGQ1ZTZmN2c4aDlpMGo=')).toBe(false);
  });

  // El error real número dos: pegar la API key en el campo del secret. Las dos son
  // cadenas opacas y largas, y confundirlas no da ningún error al guardar.
  it('rechaza una API key de Whop', () => {
    expect(formaDeSecretValida('rMzQ8Xk2pLvN4tYbHsWq7aFgJ1cD5eR9')).toBe(false);
  });

  it('rechaza el vacío y un ws_ pelado', () => {
    expect(formaDeSecretValida('')).toBe(false);
    expect(formaDeSecretValida('ws_')).toBe(false);
    // Corto de más: 15 caracteres después del prefijo, el mínimo es 16.
    expect(formaDeSecretValida('ws_123456789012345')).toBe(false);
  });
});

describe('urlDelWebhook', () => {
  it('arma la ruta sobre la base pública', () => {
    expect(urlDelWebhook('https://pay.hilvanapp.com')).toBe(
      'https://pay.hilvanapp.com/api/webhooks/whop',
    );
  });

  // La base llega de un `.env` escrito a mano, así que la barra final aparece la
  // mitad de las veces. Sin normalizar, el usuario copia una URL con `//` y la
  // pega en Whop tal cual.
  it('normaliza la barra final', () => {
    expect(urlDelWebhook('https://pay.hilvanapp.com/')).toBe(
      'https://pay.hilvanapp.com/api/webhooks/whop',
    );
    expect(urlDelWebhook('https://pay.hilvanapp.com///')).toBe(
      'https://pay.hilvanapp.com/api/webhooks/whop',
    );
  });

  it('tolera espacios', () => {
    expect(urlDelWebhook('  https://pay.hilvanapp.com  ')).toBe(
      'https://pay.hilvanapp.com/api/webhooks/whop',
    );
  });
});

describe('EVENTOS_DEL_WEBHOOK', () => {
  // La lista que muestra el panel tiene que ser exactamente la que el handler
  // procesa. Si alguien agrega un caso al handler y no lo agrega acá, el usuario
  // no lo tilda en Whop y ese evento no llega nunca — sin ningún error visible.
  it('son los seis que el handler procesa, en el orden de la documentación', () => {
    expect([...EVENTOS_DEL_WEBHOOK]).toEqual([
      'payment.created',
      'payment.succeeded',
      'payment.failed',
      'payment.pending',
      'refund.created',
      'dispute.created',
    ]);
  });

  it('payment.succeeded está: es el que dispara la entrega', () => {
    expect(EVENTOS_DEL_WEBHOOK).toContain('payment.succeeded');
  });
});
