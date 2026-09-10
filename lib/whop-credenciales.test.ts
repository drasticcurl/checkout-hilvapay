import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identificarCompany, verificarCredenciales } from './whop-credenciales';

/**
 * Solo se prueba `verificarCredenciales`: es la única parte de este módulo con
 * lógica propia y sin base de datos. El resolver y el guardado hablan con
 * Postgres, así que se prueban con la base de verdad (ver
 * `tasks/checkout-whop/_verificacion-checkout.sql`), no con un mock que
 * inventaría un contrato distinto al real.
 */
const CREDS = {
  apiKey: 'whopsk_de_prueba',
  companyId: 'biz_Me8Lbiv174brtM',
  base: 'https://api.whop.com/api/v1',
  versionDate: '2026-08-21-1',
};

function respuesta(status: number, cuerpo: unknown, esJson = true): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!esJson) throw new Error('no es json');
      return cuerpo;
    },
    text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
  } as Response;
}

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

describe('verificarCredenciales', () => {
  it('pega a GET /companies/{biz_id}, que es el único endpoint que sirve para sondear', async () => {
    const espia = vi.fn(async () => respuesta(200, { id: CREDS.companyId, title: 'Sinvanapp' }));
    globalThis.fetch = espia as unknown as typeof fetch;

    await verificarCredenciales(CREDS);

    const [url, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${CREDS.base}/companies/${CREDS.companyId}`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CREDS.apiKey}`);
    // El pin de versión tiene que viajar: la forma de la respuesta depende de él.
    expect(headers['Api-Version-Date']).toBe(CREDS.versionDate);
  });

  it('con 200 devuelve el nombre de la company', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, { id: CREDS.companyId, title: 'Sinvanapp' }),
    ) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r).toEqual({ ok: true, companyNombre: 'Sinvanapp' });
  });

  it('acepta `name` además de `title`: la forma cambió entre versiones de la API', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, { id: CREDS.companyId, name: 'Otro Nombre' }),
    ) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r).toEqual({ ok: true, companyNombre: 'Otro Nombre' });
  });

  it('sin nombre en la respuesta cae al id, no a undefined', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, { id: CREDS.companyId }),
    ) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r).toEqual({ ok: true, companyNombre: CREDS.companyId });
  });

  /**
   * El falso positivo que el README documenta: `/companies/me` responde 200 pero
   * con la company PERSONAL del usuario, no la del negocio. Si se aceptara
   * cualquier 200, se guardaría un biz id que cobra en la cuenta equivocada.
   */
  it('rechaza un 200 que devuelve OTRA company', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, { id: 'biz_otraCompletamente', title: 'La personal' }),
    ) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('biz_otraCompletamente');
      expect(r.motivo).toContain(CREDS.companyId);
    }
  });

  it('401 dice que la key fue rechazada y menciona el caso sandbox', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(401, 'unauthorized')) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.motivo).toMatch(/sandbox/i);
    }
  });

  it('403 se trata igual que 401: la key no alcanza', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(403, 'forbidden')) as unknown as typeof fetch;
    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('404 culpa al biz id y no a la key', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(404, 'not found')) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.motivo).toContain('biz id');
    }
  });

  it('un 500 se reporta con el status y no se confunde con credenciales malas', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(500, 'boom')) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.motivo).toContain('500');
    }
  });

  it('un 200 que no es JSON no pasa como válido', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, 'no soy json', false),
    ) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/JSON/);
  });

  it('si no se puede conectar, el mensaje apunta a la URL y no a la key', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const r = await verificarCredenciales({ ...CREDS, base: 'https://api.whop.invalido' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('api.whop.invalido');
  });

  it('un timeout lo dice, en vez de culpar a las credenciales', async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error('timed out');
      e.name = 'TimeoutError';
      throw e;
    }) as unknown as typeof fetch;

    const r = await verificarCredenciales(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/no contestó/);
  });

  it('la barra final de la base no duplica la del path', async () => {
    const espia = vi.fn(async () => respuesta(200, { id: CREDS.companyId, title: 'X' }));
    globalThis.fetch = espia as unknown as typeof fetch;

    await verificarCredenciales({ ...CREDS, base: 'https://api.whop.com/api/v1/' });

    const [url] = espia.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://api.whop.com/api/v1/companies/${CREDS.companyId}`);
  });

  it('el biz id se escapa en la URL', async () => {
    const espia = vi.fn(async () => respuesta(200, {}));
    globalThis.fetch = espia as unknown as typeof fetch;

    await verificarCredenciales({ ...CREDS, companyId: 'biz con espacio/..' });

    const [url] = espia.mock.calls[0] as unknown as [string];
    expect(url).toContain('biz%20con%20espacio%2F..');
  });
});

describe('identificarCompany', () => {
  it('pega a /api/v5/company sobre el ORIGEN de la base configurada', async () => {
    const espia = vi.fn(async () => respuesta(200, { id: CREDS.companyId, title: 'Sinvanapp', route: CREDS.companyId }));
    globalThis.fetch = espia as unknown as typeof fetch;

    await identificarCompany(CREDS.apiKey, CREDS.base);

    const [url, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
    // El origen y no la base entera: la base configurada termina en /api/v1.
    expect(url).toBe('https://api.whop.com/api/v5/company');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CREDS.apiKey}`);
  });

  /**
   * v2 y v5 se versionan por path y el header lo ignoran (probado contra la API
   * real con un `1999-01-01` inventado). Mandarlo sugeriría que el pin del
   * proyecto gobierna esta llamada, y no lo hace.
   */
  it('NO manda Api-Version-Date', async () => {
    const espia = vi.fn(async () => respuesta(200, { id: CREDS.companyId, title: 'X', route: CREDS.companyId }));
    globalThis.fetch = espia as unknown as typeof fetch;

    await identificarCompany(CREDS.apiKey, CREDS.base);

    const [, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Api-Version-Date']).toBeUndefined();
  });

  it('devuelve el id y el nombre de la company', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, { id: CREDS.companyId, title: 'Sinvanapp', route: CREDS.companyId }),
    ) as unknown as typeof fetch;

    expect(await identificarCompany(CREDS.apiKey, CREDS.base)).toEqual({
      ok: true,
      companyId: CREDS.companyId,
      companyNombre: 'Sinvanapp',
    });
  });

  /**
   * El error que hace que el README diga que esto no se puede: en v1,
   * `/companies/me` devuelve la company PERSONAL, cuyo `route` es "me". Si alguna
   * vez el endpoint de v5 empezara a comportarse así, hay que detectarlo y no
   * completar el campo con un biz id que cobra en la cuenta equivocada.
   */
  it('rechaza la cuenta personal, que llega con route "me"', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(200, { id: 'biz_mq2nWbR4AjIBlZ', title: 'Me', route: 'me' }),
    ) as unknown as typeof fetch;

    const r = await identificarCompany(CREDS.apiKey, CREDS.base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/personal/i);
  });

  it('con una key inválida devuelve error, nunca una company', async () => {
    globalThis.fetch = vi.fn(async () =>
      respuesta(403, { message: 'Your API Key is invalid.' }),
    ) as unknown as typeof fetch;

    const r = await identificarCompany('whopsk_mala', CREDS.base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.motivo).toMatch(/no reconoce/i);
    }
  });

  it('un 200 sin id no pasa como válido', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(200, { title: 'Sin id' })) as unknown as typeof fetch;

    const r = await identificarCompany(CREDS.apiKey, CREDS.base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/sin id/i);
  });

  it('una base que no es URL falla sin salir a la red', async () => {
    const espia = vi.fn();
    globalThis.fetch = espia as unknown as typeof fetch;

    const r = await identificarCompany(CREDS.apiKey, 'no-es-una-url');
    expect(r.ok).toBe(false);
    expect(espia).not.toHaveBeenCalled();
  });

  it('un 500 sugiere poner el biz id a mano en vez de dejar al usuario trabado', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(500, 'boom')) as unknown as typeof fetch;

    const r = await identificarCompany(CREDS.apiKey, CREDS.base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/a mano/);
  });
});
