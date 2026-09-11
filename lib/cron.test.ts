/**
 * Tests de `lib/cron.ts`.
 *
 * Cubre el comportamiento documentado (sin CRON_SECRET no autoriza nada, el
 * bearer tiene que matchear exacto) y deja constancia de un hallazgo de la
 * auditoría de seguridad: `cronAutorizado` compara el header con `===`, que
 * NO es tiempo constante. `lib/auth.ts` (sesión del panel) y
 * `lib/whop-webhook.ts` (firma del webhook) sí usan una comparación en tiempo
 * constante para sus secretos; este archivo es la única de las tres
 * comparaciones de secretos del repo que no la tiene.
 *
 * El impacto práctico es bajo — hace falta medir con precisión de
 * microsegundos sobre una red real, y CRON_SECRET no es un password que un
 * usuario final pueda rotar por las malas — pero es una inconsistencia con el
 * propio criterio de seguridad que el resto del repo aplica, y endurecerla no
 * cuesta nada.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cronAutorizado } from './cron';

const envOriginal = { ...process.env };

afterEach(() => {
  process.env = { ...envOriginal };
});

function reqCon(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://127.0.0.1:3020/api/cron/salidas', { headers });
}

describe('cronAutorizado', () => {
  it('con el bearer correcto, autoriza', () => {
    process.env.CRON_SECRET = 'un-secreto-de-cron-bien-largo';
    expect(cronAutorizado(reqCon('Bearer un-secreto-de-cron-bien-largo'))).toBe(true);
  });

  it('sin CRON_SECRET configurado, NUNCA autoriza — ni siquiera con un bearer vacío', () => {
    delete process.env.CRON_SECRET;
    expect(cronAutorizado(reqCon('Bearer '))).toBe(false);
    expect(cronAutorizado(reqCon(''))).toBe(false);
    expect(cronAutorizado(reqCon())).toBe(false);
  });

  it('sin header Authorization, rechaza', () => {
    process.env.CRON_SECRET = 'un-secreto-de-cron-bien-largo';
    expect(cronAutorizado(reqCon())).toBe(false);
  });

  it('bearer incorrecto, rechaza', () => {
    process.env.CRON_SECRET = 'un-secreto-de-cron-bien-largo';
    expect(cronAutorizado(reqCon('Bearer otra-cosa'))).toBe(false);
  });

  it('sin el prefijo "Bearer ", rechaza aunque el secreto sea correcto', () => {
    process.env.CRON_SECRET = 'un-secreto-de-cron-bien-largo';
    expect(cronAutorizado(reqCon('un-secreto-de-cron-bien-largo'))).toBe(false);
  });

  it('es case-sensitive: un secreto con otro casing no autoriza', () => {
    process.env.CRON_SECRET = 'Secreto-Con-Mayusculas';
    expect(cronAutorizado(reqCon('Bearer secreto-con-mayusculas'))).toBe(false);
  });

  it('un prefijo correcto pero con basura al final no autoriza', () => {
    process.env.CRON_SECRET = 'secreto123';
    expect(cronAutorizado(reqCon('Bearer secreto123extra'))).toBe(false);
  });

  it('HALLAZGO: la comparación no es constante en el tiempo (usa === sobre strings)', () => {
    // Este test no mide timing (no es confiable en CI); documenta la forma del
    // código como regresión: si algún día se reemplaza `===` por una
    // comparación constante, este test sigue pasando igual. Sirve como ancla
    // para el hallazgo del informe, no como detector automático del timing.
    process.env.CRON_SECRET = 'x'.repeat(40);
    const correcto = `Bearer ${'x'.repeat(40)}`;
    const difiereEnElPrimerByte = `Bearer ${'y'}${'x'.repeat(39)}`;
    const difiereEnElUltimoByte = `Bearer ${'x'.repeat(39)}y`;
    // Funcionalmente los dos casos rechazan igual — eso es lo correcto. Lo que
    // el informe señala es CÓMO se llega ahí (comparación corta-circuito),
    // no que el resultado esté mal.
    expect(cronAutorizado(reqCon(correcto))).toBe(true);
    expect(cronAutorizado(reqCon(difiereEnElPrimerByte))).toBe(false);
    expect(cronAutorizado(reqCon(difiereEnElUltimoByte))).toBe(false);
  });
});
