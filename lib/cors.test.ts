/**
 * Tests de `lib/cors.ts`. `headersCors` toca la base para leer `origenes`, así
 * que `lib/db` se mockea. Lo que se prueba es la lógica de allowlist: igualdad
 * exacta, nunca `*`, y el caso `startsWith` que es el que de verdad importa.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const qMock = vi.fn();

vi.mock('./db', () => ({
  q: (...args: unknown[]) => qMock(...args),
}));

import { headersCors } from './cors';

describe('headersCors', () => {
  beforeEach(() => {
    qMock.mockReset();
    // Cada test resuelve el mock antes de importar el módulo otra vez no es
    // posible con ESM sin resetModules; en cambio, cada test setea el mock
    // ANTES de llamar a headersCors y la primera llamada dentro de los 60s de
    // cache reusa el resultado. Por eso los tests que dependen de distintos
    // contenidos de `origenes` corren con `vi.resetModules` + reimport.
  });

  it('origen activo → devuelve el origen exacto en Allow-Origin', async () => {
    qMock.mockResolvedValueOnce([{ origen: 'https://mifunnel.com' }]);
    const headers = await headersCors('https://mifunnel.com');
    expect(headers).not.toBeNull();
    expect(headers?.['Access-Control-Allow-Origin']).toBe('https://mifunnel.com');
    // Nunca '*'.
    expect(headers?.['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('origen inactivo (no viene en la lista de activos) → null', async () => {
    vi.resetModules();
    const { headersCors: headersCors2 } = await reimportarConOrigenes([]);
    const headers = await headersCors2('https://funnel-desactivado.com');
    expect(headers).toBeNull();
  });

  it('origen que no está registrado → null', async () => {
    vi.resetModules();
    const { headersCors: headersCors2 } = await reimportarConOrigenes([{ origen: 'https://otro.com' }]);
    const headers = await headersCors2('https://no-registrado.com');
    expect(headers).toBeNull();
  });

  it('un subdominio-trampa (mifunnel.com.evil.io) cuando está autorizado mifunnel.com → null', async () => {
    vi.resetModules();
    const { headersCors: headersCors2 } = await reimportarConOrigenes([{ origen: 'https://mifunnel.com' }]);
    const headers = await headersCors2('https://mifunnel.com.evil.io');
    expect(headers).toBeNull();
  });

  it('origen null → null, sin tocar la base', async () => {
    vi.resetModules();
    const { headersCors: headersCors2 } = await reimportarConOrigenes([{ origen: 'https://mifunnel.com' }]);
    const headers = await headersCors2(null);
    expect(headers).toBeNull();
  });
});

/**
 * Reimporta `lib/cors.ts` con un `lib/db` mockeado para devolver una lista de
 * orígenes específica. Hace falta `vi.resetModules` porque el cache en memoria
 * del módulo persistiría entre tests si no se reimporta desde cero.
 */
async function reimportarConOrigenes(filas: { origen: string }[]) {
  vi.doMock('./db', () => ({
    q: vi.fn().mockResolvedValue(filas),
  }));
  return import('./cors');
}
