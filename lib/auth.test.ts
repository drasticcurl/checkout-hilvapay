import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COOKIE_SESION, DIAS_SESION, firmarSesion, passwordCorrecta, verificarSesion } from './auth';

const PASS = 'un-password-largo-y-random-de-prueba';
const SECRET = 'otro-secreto-de-firma-distinto-al-password';

const envOriginal = { ...process.env };

beforeEach(() => {
  process.env.PANEL_PASSWORD = PASS;
  process.env.PANEL_SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...envOriginal };
});

describe('firmarSesion / verificarSesion', () => {
  it('un token recién firmado verifica', async () => {
    expect(await verificarSesion(await firmarSesion())).toBe(true);
  });

  it('el formato es id.ts.hmac con el hmac en hex de 64', async () => {
    // El formato es el mismo que el de dashboard-admin/middleware.ts a propósito.
    const partes = (await firmarSesion()).split('.');
    expect(partes).toHaveLength(3);
    expect(partes[0]).toBe('1');
    expect(partes[1]).toMatch(/^\d+$/);
    expect(partes[2]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un byte cambiado en la firma lo invalida', async () => {
    const t = await firmarSesion();
    const [id, ts, sig] = t.split('.');
    const cambiado = sig[0] === 'a' ? `b${sig.slice(1)}` : `a${sig.slice(1)}`;
    expect(await verificarSesion(`${id}.${ts}.${cambiado}`)).toBe(false);
  });

  it('un timestamp cambiado lo invalida, aunque la firma sea válida para el original', async () => {
    // Es lo que prueba que el ts está DENTRO de lo firmado: si estuviera afuera,
    // estirarle el vencimiento a un token viejo no rompería la firma.
    const t = await firmarSesion();
    const [id, ts, sig] = t.split('.');
    expect(await verificarSesion(`${id}.${Number(ts) + 1}.${sig}`)).toBe(false);
  });

  it('vence pasados los días de sesión', async () => {
    const hace8dias = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(await verificarSesion(await firmarSesion(hace8dias))).toBe(false);
  });

  it('sigue válido justo antes de vencer', async () => {
    const casi = new Date(Date.now() - (DIAS_SESION * 24 * 60 * 60 * 1000 - 60_000));
    expect(await verificarSesion(await firmarSesion(casi))).toBe(true);
  });

  it('rechaza un token del futuro más allá de la tolerancia de reloj', async () => {
    const futuro = new Date(Date.now() + 5 * 60_000);
    expect(await verificarSesion(await firmarSesion(futuro))).toBe(false);
  });

  it('rechaza basura sin tirar excepción', async () => {
    // El middleware llama a esto en cada request: una excepción acá es un 500 en
    // toda ruta protegida del panel.
    const basura = [
      undefined,
      null,
      '',
      'basura',
      '1.2',
      '1.2.3.4',
      'a.b.c',
      '1.abc.' + 'f'.repeat(64),
      '1.' + Date.now() + '.corta',
      '1.' + Date.now() + '.' + 'Z'.repeat(64), // hex inválido
      ' 1.' + Date.now() + '.' + 'a'.repeat(64), // espacio adelante
      '1e2.' + Date.now() + '.' + 'a'.repeat(64), // Number('1e2') === 100
    ];
    for (const t of basura) {
      await expect(verificarSesion(t as string | undefined)).resolves.toBe(false);
    }
  });

  it('un token de otro id no entra', async () => {
    const t = await firmarSesion();
    const [, ts, sig] = t.split('.');
    expect(await verificarSesion(`2.${ts}.${sig}`)).toBe(false);
  });

  it('con otro secreto de firma no verifica', async () => {
    const t = await firmarSesion();
    process.env.PANEL_SESSION_SECRET = 'un-secreto-completamente-distinto';
    expect(await verificarSesion(t)).toBe(false);
  });

  it('sin secreto ni password, no verifica nada', async () => {
    const t = await firmarSesion();
    delete process.env.PANEL_SESSION_SECRET;
    delete process.env.PANEL_PASSWORD;
    expect(await verificarSesion(t)).toBe(false);
  });

  it('cae al password cuando no hay secreto de firma', async () => {
    delete process.env.PANEL_SESSION_SECRET;
    expect(await verificarSesion(await firmarSesion())).toBe(true);
  });
});

describe('passwordCorrecta', () => {
  it('acepta el password exacto', async () => {
    expect(await passwordCorrecta(PASS)).toBe(true);
  });

  it('rechaza el equivocado, el vacío y el prefijo correcto', async () => {
    for (const mal of ['', 'mal', PASS.slice(0, -1), PASS + 'x', PASS.toUpperCase(), ` ${PASS}`]) {
      expect(await passwordCorrecta(mal)).toBe(false);
    }
  });

  it('SIN PANEL_PASSWORD no deja entrar a nadie', async () => {
    // La regla que importa: un panel que puede cobrar tarjetas no puede quedar
    // abierto porque falta una variable de entorno.
    delete process.env.PANEL_PASSWORD;
    expect(await passwordCorrecta('')).toBe(false);
    expect(await passwordCorrecta('cualquiera')).toBe(false);
    expect(await passwordCorrecta(PASS)).toBe(false);
  });
});

describe('constantes del contrato', () => {
  it('la cookie no se llama igual que la del dashboard-admin', () => {
    expect(COOKIE_SESION).toBe('checkout_panel');
    expect(COOKIE_SESION).not.toBe('panel_token');
  });

  it('DIAS_SESION es un entero positivo y razonable', () => {
    expect(Number.isInteger(DIAS_SESION)).toBe(true);
    expect(DIAS_SESION).toBeGreaterThan(0);
    // Más de 30 días en un panel que puede prender un link de pago no se justifica.
    expect(DIAS_SESION).toBeLessThanOrEqual(30);
  });
});
