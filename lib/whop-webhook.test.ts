import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FirmaInvalida, firmarParaTest, verificarWebhook } from './whop-webhook';

// Un `ws_` como los que da Whop. Lo importante del caso de prueba es la FORMA:
// si el verificador tratara este string como base64 (lo que hace
// `standardwebhooks` por defecto), la clave saldría distinta y nada validaría.
const SECRET = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ID = 'msg_bQPHmO2eBnHYtWWuxAN9K3Xd';

const BODY = JSON.stringify({
  id: ID,
  type: 'payment.succeeded',
  api_version: 'v1',
  account_id: 'biz_XXXXXXXX',
  data: { id: 'pay_XXXXXXXX', substatus: 'succeeded' },
});

function ahoraSeg(d = new Date()): number {
  return Math.floor(d.getTime() / 1000);
}

describe('verificarWebhook', () => {
  it('acepta una firma válida y devuelve el evento parseado', () => {
    const ts = ahoraSeg();
    const headers = firmarParaTest(SECRET, ID, ts, BODY);

    const ev = verificarWebhook(BODY, headers, SECRET);

    expect(ev.type).toBe('payment.succeeded');
    expect(ev.id).toBe(ID);
    expect((ev.data as { id: string }).id).toBe('pay_XXXXXXXX');
  });

  it('usa el secret ws_ como clave literal, no como base64', () => {
    // Este test es el que documenta la corrección: la firma esperada se calcula
    // con el string tal cual. Si alguien "arregla" el verificador haciendo
    // base64.decode del secret, este test falla.
    const ts = ahoraSeg();
    const esperada = createHmac('sha256', SECRET).update(`${ID}.${ts}.${BODY}`).digest('base64');

    const ev = verificarWebhook(
      BODY,
      { 'webhook-id': ID, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${esperada}` },
      SECRET,
    );

    expect(ev.type).toBe('payment.succeeded');
  });

  it('rechaza una firma calculada con otro secret', () => {
    const ts = ahoraSeg();
    const headers = firmarParaTest('ws_otro_secret_completamente_distinto', ID, ts, BODY);

    expect(() => verificarWebhook(BODY, headers, SECRET)).toThrow(FirmaInvalida);
  });

  it('rechaza si el body cambió aunque sea un byte', () => {
    const ts = ahoraSeg();
    const headers = firmarParaTest(SECRET, ID, ts, BODY);

    // Es lo que pasa si se hace req.json() y después se re-serializa: mismo
    // contenido semántico, bytes distintos, firma inválida.
    const reSerializado = JSON.stringify(JSON.parse(BODY.replace('"api_version":"v1",', '')));

    expect(() => verificarWebhook(reSerializado, headers, SECRET)).toThrow(FirmaInvalida);
  });

  it('rechaza si el webhook-id no es el que se firmó', () => {
    const ts = ahoraSeg();
    const headers = firmarParaTest(SECRET, ID, ts, BODY);
    headers['webhook-id'] = 'msg_otro';

    expect(() => verificarWebhook(BODY, headers, SECRET)).toThrow(FirmaInvalida);
  });

  it('rechaza un timestamp de hace más de 5 minutos (replay)', () => {
    const viejo = ahoraSeg() - 6 * 60;
    const headers = firmarParaTest(SECRET, ID, viejo, BODY);

    expect(() => verificarWebhook(BODY, headers, SECRET)).toThrow(/ventana de 5 minutos/);
  });

  it('rechaza un timestamp del futuro lejano', () => {
    const futuro = ahoraSeg() + 6 * 60;
    const headers = firmarParaTest(SECRET, ID, futuro, BODY);

    expect(() => verificarWebhook(BODY, headers, SECRET)).toThrow(/ventana de 5 minutos/);
  });

  it('acepta un timestamp justo dentro de la ventana', () => {
    const casi = ahoraSeg() - (5 * 60 - 5);
    const headers = firmarParaTest(SECRET, ID, casi, BODY);

    expect(() => verificarWebhook(BODY, headers, SECRET)).not.toThrow();
  });

  it('acepta varias firmas en el header si una v1 coincide', () => {
    // Es lo que pasa durante una rotación de secret.
    const ts = ahoraSeg();
    const buena = firmarParaTest(SECRET, ID, ts, BODY)['webhook-signature'];

    const ev = verificarWebhook(
      BODY,
      {
        'webhook-id': ID,
        'webhook-timestamp': String(ts),
        'webhook-signature': `v1,firmaVieja= ${buena}`,
      },
      SECRET,
    );

    expect(ev.type).toBe('payment.succeeded');
  });

  it('ignora firmas que no son v1', () => {
    // v2 y v5 no usan Standard Webhooks: si solo viene una de esas, se rechaza.
    const ts = ahoraSeg();
    const firma = firmarParaTest(SECRET, ID, ts, BODY)['webhook-signature'].replace('v1,', 'v2,');

    expect(() =>
      verificarWebhook(
        BODY,
        { 'webhook-id': ID, 'webhook-timestamp': String(ts), 'webhook-signature': firma },
        SECRET,
      ),
    ).toThrow(FirmaInvalida);
  });

  it('rechaza si faltan headers', () => {
    const ts = ahoraSeg();
    const completos = firmarParaTest(SECRET, ID, ts, BODY);

    for (const faltante of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const headers = { ...completos };
      delete headers[faltante];
      expect(() => verificarWebhook(BODY, headers, SECRET)).toThrow(/faltan los headers/);
    }
  });

  it('no le importa la capitalización de los headers', () => {
    const ts = ahoraSeg();
    const h = firmarParaTest(SECRET, ID, ts, BODY);

    const ev = verificarWebhook(
      BODY,
      {
        'Webhook-Id': h['webhook-id'],
        'Webhook-Timestamp': h['webhook-timestamp'],
        'Webhook-Signature': h['webhook-signature'],
      },
      SECRET,
    );

    expect(ev.type).toBe('payment.succeeded');
  });

  it('rechaza si falta el secret', () => {
    const ts = ahoraSeg();
    const headers = firmarParaTest(SECRET, ID, ts, BODY);

    expect(() => verificarWebhook(BODY, headers, '')).toThrow(/no está configurada/);
  });

  it('rechaza un evento verificado que no tiene type ni data', () => {
    const body = JSON.stringify({ hola: 'mundo' });
    const ts = ahoraSeg();
    const headers = firmarParaTest(SECRET, ID, ts, body);

    expect(() => verificarWebhook(body, headers, SECRET)).toThrow(/type y data/);
  });

  it('acepta company_id además de account_id', () => {
    // Los webhooks pineados antes de 2026-08-14 mandan company_id.
    const body = JSON.stringify({
      id: ID,
      type: 'payment.succeeded',
      company_id: 'biz_viejo',
      data: { id: 'pay_1' },
    });
    const ts = ahoraSeg();
    const headers = firmarParaTest(SECRET, ID, ts, body);

    const ev = verificarWebhook(body, headers, SECRET);
    expect(ev.company_id).toBe('biz_viejo');
  });
});
