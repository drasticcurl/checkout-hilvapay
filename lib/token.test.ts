/**
 * Tests de `lib/token.ts`. `resolverToken` toca la base, así que `lib/db` se
 * mockea: lo que se prueba acá es la lógica de vencimiento y de validación de
 * forma, no que Postgres funcione.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const q1Mock = vi.fn();

vi.mock('./db', () => ({
  q1: (...args: unknown[]) => q1Mock(...args),
}));

import { generarToken, resolverToken } from './token';

describe('generarToken', () => {
  it('produce 43 caracteres', () => {
    expect(generarToken()).toHaveLength(43);
  });

  it('usa solo el alfabeto base64url: [A-Za-z0-9_-]', () => {
    for (let i = 0; i < 50; i++) {
      expect(generarToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('1000 llamadas dan 1000 valores distintos', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) vistos.add(generarToken());
    expect(vistos.size).toBe(1000);
  });
});

describe('resolverToken', () => {
  beforeEach(() => {
    q1Mock.mockReset();
  });

  it('token que no existe en la base → invalido', async () => {
    q1Mock.mockResolvedValueOnce(null);
    const r = await resolverToken('TOKEN_QUE_NO_EXISTE_1234567890123');
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('token con token_expira_at en el pasado → vencido', async () => {
    q1Mock.mockResolvedValueOnce({
      id: 'o1',
      token: 'abc',
      token_expira_at: new Date(Date.now() - 60_000),
    });
    const r = await resolverToken('abc');
    expect(r).toEqual({ ok: false, motivo: 'vencido' });
  });

  it('token válido y sin vencer → ok con la orden', async () => {
    const orden = {
      id: 'o1',
      token: 'abc',
      token_expira_at: new Date(Date.now() + 60_000),
    };
    q1Mock.mockResolvedValueOnce(orden);
    const r = await resolverToken('abc');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.orden).toEqual(orden);
  });

  it('null → invalido, sin tirar y sin tocar la base', async () => {
    const r = await resolverToken(null);
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
    expect(q1Mock).not.toHaveBeenCalled();
  });

  it('123 (number) → invalido, sin tocar la base', async () => {
    const r = await resolverToken(123);
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
    expect(q1Mock).not.toHaveBeenCalled();
  });

  it('{} (objeto) → invalido, sin tocar la base', async () => {
    const r = await resolverToken({});
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
    expect(q1Mock).not.toHaveBeenCalled();
  });

  it('un string de 10 000 caracteres → invalido, sin tocar la base', async () => {
    const r = await resolverToken('a'.repeat(10_000));
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
    expect(q1Mock).not.toHaveBeenCalled();
  });

  it('string vacío → invalido, sin tocar la base', async () => {
    const r = await resolverToken('');
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
    expect(q1Mock).not.toHaveBeenCalled();
  });
});
