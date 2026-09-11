import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockeamos lib/db ANTES de importar lib/telegram, igual que email.test.ts: el
// módulo bajo test no debe tocar una conexión real de Postgres, y `destinos` y
// `mandarAlerta` sí hacen queries.
const qMock = vi.fn();
vi.mock('./db', () => ({
  q: (...args: unknown[]) => qMock(...args),
}));

import {
  coincideWebhook,
  consultarBot,
  consultarWebhook,
  destinos,
  diagnosticarBot,
  escaparHtml,
  mandarA,
  mandarAlerta,
} from './telegram';

/** Un Response de `fetch` armado a mano, sin depender de la clase real. */
function respuesta(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('escaparHtml', () => {
  it('escapa los tres caracteres que pide Telegram, en el orden correcto', () => {
    expect(escaparHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('un texto sin caracteres especiales queda igual', () => {
    expect(escaparHtml('sin nada raro')).toBe('sin nada raro');
  });
});

describe('destinos', () => {
  beforeEach(() => {
    qMock.mockReset();
    delete process.env.TELEGRAM_CHAT_ID_ADMIN;
  });

  afterEach(() => {
    delete process.env.TELEGRAM_CHAT_ID_ADMIN;
  });

  it('sin env var y sin filas, la lista queda vacía', async () => {
    qMock.mockResolvedValueOnce([]);
    await expect(destinos()).resolves.toEqual([]);
  });

  it('el admin del env var va primero', async () => {
    process.env.TELEGRAM_CHAT_ID_ADMIN = '999';
    qMock.mockResolvedValueOnce([{ id: 'a', chat_id: '111', nombre: 'Equipo' }]);

    const lista = await destinos('equipo');
    expect(lista.map((d) => d.chatId)).toEqual(['999', '111']);
    expect(lista[0].id).toBeNull(); // el admin no tiene fila
  });

  it('deduplica: si el chat del admin también está en la tabla, se manda una sola vez', async () => {
    process.env.TELEGRAM_CHAT_ID_ADMIN = '999';
    qMock.mockResolvedValueOnce([{ id: 'a', chat_id: '999', nombre: 'Dueño' }]);

    const lista = await destinos('equipo');
    expect(lista).toHaveLength(1);
    expect(lista[0].chatId).toBe('999');
    expect(lista[0].id).toBeNull(); // gana la entrada del env var, no la de la tabla
  });
});

describe('mandarA', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-de-prueba';
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    vi.unstubAllGlobals();
  });

  it('sin token no intenta la request de red', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await mandarA('123', 'hola');
    expect(r).toEqual({ chatId: '123', ok: false, error: 'sin_token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('200 de Telegram es un envío exitoso', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, { ok: true })));
    const r = await mandarA('123', 'hola');
    expect(r).toEqual({ chatId: '123', ok: true });
  });

  it('403 marca el chat para desactivar (bot bloqueado)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(403, { description: 'Forbidden' })));
    const r = await mandarA('123', 'hola');
    expect(r.ok).toBe(false);
    expect(r.desactivado).toBe(true);
  });

  it('un error de red que no sea 403 no marca para desactivar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(500, {})));
    const r = await mandarA('123', 'hola');
    expect(r.ok).toBe(false);
    // `desactivar` siempre es `res.status === 403`: para un 500 da `false`, no
    // `undefined`. Lo que importa es que NO sea `true` — eso es lo que dispara
    // el UPDATE que apaga la fila en `mandarAlerta`.
    expect(r.desactivado).toBe(false);
  });

  it('una excepción de fetch (timeout, red caída) se atrapa y no propaga', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const r = await mandarA('123', 'hola');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('network down');
  });
});

describe('mandarAlerta', () => {
  beforeEach(() => {
    qMock.mockReset();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID_ADMIN;
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID_ADMIN;
    vi.unstubAllGlobals();
  });

  it('sin token, devuelve motivo "sin_token" y no toca la base ni la red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await mandarAlerta('hola');
    expect(r).toEqual({ intentados: 0, enviados: 0, fallidos: 0, motivo: 'sin_token', detalle: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    // Ni siquiera se llegó a consultar `destinos`: el freno es antes.
    expect(qMock).not.toHaveBeenCalled();
  });

  it('con token pero sin ningún destinatario, devuelve "sin_destinatarios"', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    qMock.mockResolvedValueOnce([]); // destinos() -> tabla vacía

    const r = await mandarAlerta('hola');
    expect(r).toEqual({
      intentados: 0,
      enviados: 0,
      fallidos: 0,
      motivo: 'sin_destinatarios',
      detalle: [],
    });
  });

  it('con destinatarios, manda y no deja motivo (el envío se intentó)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.TELEGRAM_CHAT_ID_ADMIN = '999';
    qMock.mockResolvedValueOnce([]); // destinos() -> sin filas en la tabla, solo el admin
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, { ok: true })));

    const r = await mandarAlerta('hola');
    expect(r.intentados).toBe(1);
    expect(r.enviados).toBe(1);
    expect(r.motivo).toBeUndefined();
  });
});

describe('coincideWebhook', () => {
  it('sin URL esperada configurada, devuelve null (no se puede saber)', () => {
    expect(coincideWebhook('https://pay.hilvanapp.com/api/telegram/webhook', null)).toBeNull();
  });

  it('la misma URL coincide', () => {
    const url = 'https://pay.hilvanapp.com/api/telegram/webhook';
    expect(coincideWebhook(url, url)).toBe(true);
  });

  it('ignora mayúsculas y la barra final', () => {
    expect(
      coincideWebhook(
        'HTTPS://pay.hilvanapp.com/api/telegram/webhook/',
        'https://pay.hilvanapp.com/api/telegram/webhook',
      ),
    ).toBe(true);
  });

  it('un dominio distinto no coincide', () => {
    expect(
      coincideWebhook(
        'https://pay.hilvanapp.online/api/telegram/webhook',
        'https://pay.hilvanapp.com/api/telegram/webhook',
      ),
    ).toBe(false);
  });
});

describe('consultarBot', () => {
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    vi.unstubAllGlobals();
  });

  it('sin token, dice que no está configurado y no llama a la red', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(consultarBot()).resolves.toEqual({ configurado: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token válido: devuelve el username y el nombre del bot', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-valido';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta(200, { ok: true, result: { id: 42, username: 'hilvapay_bot', first_name: 'Hilvapay' } }),
      ),
    );

    const r = await consultarBot();
    expect(r).toEqual({
      configurado: true,
      tokenValido: true,
      bot: { id: 42, username: 'hilvapay_bot', nombre: 'Hilvapay' },
    });
  });

  it('token revocado: Telegram responde 401 con description', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-revocado';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(401, { ok: false, description: 'Unauthorized' })),
    );

    const r = await consultarBot();
    expect(r).toEqual({ configurado: true, tokenValido: false, error: 'Unauthorized' });
  });

  it('una excepción de red no propaga: vuelve como tokenValido:false', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const r = await consultarBot();
    expect(r.configurado).toBe(true);
    if (r.configurado) {
      expect(r.tokenValido).toBe(false);
    }
  });
});

describe('consultarWebhook', () => {
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.unstubAllGlobals();
  });

  it('sin token, dice que no se consultó y no llama a la red', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(consultarWebhook()).resolves.toEqual({ consultado: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('webhook registrado y coincide con NEXT_PUBLIC_BASE_URL', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://pay.hilvanapp.com';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta(200, {
          ok: true,
          result: { url: 'https://pay.hilvanapp.com/api/telegram/webhook', pending_update_count: 0 },
        }),
      ),
    );

    const r = await consultarWebhook();
    expect(r).toMatchObject({ consultado: true, ok: true, coincideConEsperada: true, pendientes: 0 });
  });

  it('webhook registrado pero apuntando a otro dominio: no coincide', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://pay.hilvanapp.com';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta(200, {
          ok: true,
          result: { url: 'https://pay.hilvanapp.online/api/telegram/webhook', pending_update_count: 0 },
        }),
      ),
    );

    const r = await consultarWebhook();
    expect(r).toMatchObject({ consultado: true, ok: true, coincideConEsperada: false });
  });

  it('sin ningún webhook registrado, la url viene vacía y no se afirma nada sobre coincidencia', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(200, { ok: true, result: { url: '', pending_update_count: 0 } })),
    );

    const r = await consultarWebhook();
    expect(r).toMatchObject({ consultado: true, ok: true, url: '', coincideConEsperada: null });
  });

  it('reporta updates pendientes y el último error de entrega', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    const fecha = 1_757_000_000; // epoch en segundos, como lo manda Telegram
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta(200, {
          ok: true,
          result: {
            url: 'https://pay.hilvanapp.com/api/telegram/webhook',
            pending_update_count: 3,
            last_error_message: 'Wrong response from the webhook: 404 Not Found',
            last_error_date: fecha,
          },
        }),
      ),
    );

    const r = await consultarWebhook();
    expect(r).toMatchObject({
      pendientes: 3,
      ultimoError: 'Wrong response from the webhook: 404 Not Found',
    });
    if (r.consultado && r.ok) {
      expect(r.ultimoErrorFecha).toBe(new Date(fecha * 1000).toISOString());
    }
  });

  it('un error de la API de Telegram no propaga', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(401, { ok: false, description: 'Unauthorized' })));

    const r = await consultarWebhook();
    expect(r).toEqual({ consultado: true, ok: false, error: 'Unauthorized' });
  });
});

describe('diagnosticarBot', () => {
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    vi.unstubAllGlobals();
  });

  it('sin token, los dos chequeos vuelven "no configurado/no consultado" sin pegarle a la red', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await diagnosticarBot();
    expect(r).toEqual({ bot: { configurado: false }, webhook: { consultado: false } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con token válido, hace las dos consultas en paralelo', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/getMe')) {
        return Promise.resolve(
          respuesta(200, { ok: true, result: { id: 1, username: 'bot', first_name: 'Bot' } }),
        );
      }
      return Promise.resolve(respuesta(200, { ok: true, result: { url: '', pending_update_count: 0 } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await diagnosticarBot();
    expect(r.bot).toMatchObject({ configurado: true, tokenValido: true });
    expect(r.webhook).toMatchObject({ consultado: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
