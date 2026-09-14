import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armarEventoCapi, sendCapiEvent } from './capi';
import type { Cobro, Orden, Pagina } from './tipos';
import type { FilaCobroParaSalida } from './salidas';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseOrden(overrides: Partial<Orden> = {}): Orden {
  return {
    id: 'orden-1',
    pagina_id: 'pagina-1',
    email: 'compradora@example.com',
    nombre: 'Compradora',
    token: 'tok',
    token_expira_at: new Date(),
    whop_member_id: 'mem_1',
    whop_payment_method_id: 'payt_1',
    whop_user_id: 'user_1',
    whop_checkout_config_id: 'ch_1',
    whop_payment_method_type: null,
    metodo_guardado: true,
    session_id: '11111111-1111-1111-1111-111111111111',
    visitor_id: '22222222-2222-2222-2222-222222222222',
    utms: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function baseCobro(overrides: Partial<Cobro> = {}): Cobro {
  return {
    id: 'cobro-1',
    orden_id: 'orden-1',
    pagina_id: 'pagina-1',
    producto_id: 'producto-1',
    whop_plan_id: 'plan_1',
    whop_payment_id: 'pay_1',
    status: 'pagado',
    decline_code: null,
    failure_message: null,
    idempotency_key: 'orden-1:pagina-1',
    monto: '9.90',
    moneda: 'usd',
    origen: 'front',
    reembolsado_at: null,
    disputa_at: null,
    email_enviado_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:05:00.000Z'),
    ...overrides,
  };
}

function basePagina(overrides: Partial<Pagina> = {}): Pagina {
  return {
    id: 'pagina-1',
    slug: 'aguadearroz1',
    producto_id: 'producto-1',
    tipo: 'front',
    url_exito: null,
    url_rechazo: null,
    config: {},
    activo: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function baseProducto(overrides: Partial<{ nombre: string; moneda: string }> = {}): {
  nombre: string;
  moneda: string;
} {
  return {
    nombre: 'App agua de arroz',
    moneda: 'usd',
    ...overrides,
  };
}

function baseDatos(overrides: Partial<FilaCobroParaSalida> = {}): FilaCobroParaSalida {
  return {
    cobro: baseCobro(),
    orden: baseOrden(),
    pagina: basePagina(),
    producto: baseProducto(),
    ...overrides,
  };
}

// ── armarEventoCapi ───────────────────────────────────────────────────────────

describe('armarEventoCapi', () => {
  it('sin whop_payment_id no arma el evento', () => {
    const r = armarEventoCapi(baseDatos({ cobro: baseCobro({ whop_payment_id: null }) }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('esperaba ok:false');
    expect(r.motivo).toBe('omitida: el cobro no tiene whop_payment_id todavía');
  });

  it('sin monto no arma el evento', () => {
    const r = armarEventoCapi(baseDatos({ cobro: baseCobro({ monto: null }) }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('esperaba ok:false');
    expect(r.motivo).toBe('omitida: el cobro no tiene monto');
  });

  it('con email y fbclid: user_data trae em (64 hex chars) y fbc con formato fb.1.<ms>.<fbclid>', () => {
    const cobro = baseCobro({ updated_at: new Date('2026-01-01T00:05:00.000Z') });
    const r = armarEventoCapi(
      baseDatos({
        cobro,
        orden: baseOrden({ email: 'Compradora@Example.com', utms: { fbclid: 'abc123' } }),
      }),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');

    expect(r.evento.user_data.em).toHaveLength(1);
    expect(r.evento.user_data.em?.[0]).toMatch(/^[0-9a-f]{64}$/);

    const msEsperado = cobro.updated_at.getTime();
    expect(r.evento.user_data.fbc).toBe(`fb.1.${msEsperado}.abc123`);
  });

  it('event_time es en SEGUNDOS unix, no milisegundos', () => {
    const cobro = baseCobro({ updated_at: new Date('2026-01-01T00:05:00.000Z') });
    const r = armarEventoCapi(baseDatos({ cobro }));

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');

    expect(r.evento.event_time).toBe(Math.floor(cobro.updated_at.getTime() / 1000));
    // No es el timestamp en ms (que sería ~1000x más grande).
    expect(r.evento.event_time).not.toBe(cobro.updated_at.getTime());
  });

  it('fbc usa creationTime en MILISEGUNDOS, una unidad distinta de event_time (segundos)', () => {
    const cobro = baseCobro({ updated_at: new Date('2026-01-01T00:05:00.000Z') });
    const r = armarEventoCapi(
      baseDatos({ cobro, orden: baseOrden({ utms: { fbclid: 'xyz789' } }) }),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');

    const msEsperado = cobro.updated_at.getTime();
    const segundosEsperado = Math.floor(msEsperado / 1000);

    expect(r.evento.user_data.fbc).toBe(`fb.1.${msEsperado}.xyz789`);
    expect(r.evento.event_time).toBe(segundosEsperado);
    // Las dos unidades tienen que ser distintas para el mismo evento.
    expect(msEsperado).not.toBe(segundosEsperado);
  });

  it('el caso del task: custom_data.value para monto "1234567.89" es el número 1234567.89, NO 123456789', () => {
    const r = armarEventoCapi(baseDatos({ cobro: baseCobro({ monto: '1234567.89' }) }));

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');

    expect(r.evento.custom_data.value).toBe(1234567.89);
    expect(r.evento.custom_data.value).not.toBe(123456789);
  });

  it('custom_data.value nunca pasa por centavos(): 9.90 se mantiene en 9.9, no 990', () => {
    const r = armarEventoCapi(baseDatos({ cobro: baseCobro({ monto: '9.90' }) }));

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');

    expect(r.evento.custom_data.value).toBe(9.9);
    expect(r.evento.custom_data.value).not.toBe(990);
  });

  it('sin email ni fbclid: se arma igual (ok:true), sin las claves em/fbc en user_data', () => {
    const r = armarEventoCapi(baseDatos({ orden: baseOrden({ email: null, utms: null }) }));

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');

    expect(r.evento.user_data.em).toBeUndefined();
    expect(r.evento.user_data.fbc).toBeUndefined();
    expect('em' in r.evento.user_data).toBe(false);
    expect('fbc' in r.evento.user_data).toBe(false);
  });

  it('event_id es cobro.whop_payment_id', () => {
    const r = armarEventoCapi(baseDatos({ cobro: baseCobro({ whop_payment_id: 'pay_xyz' }) }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');
    expect(r.evento.event_id).toBe('pay_xyz');
    expect(r.evento.event_name).toBe('Purchase');
    expect(r.evento.action_source).toBe('website');
  });

  it('event_source_url usa CHECKOUT_BASE_URL si está seteada, con /pagos/<slug>', () => {
    const previo = process.env.CHECKOUT_BASE_URL;
    process.env.CHECKOUT_BASE_URL = 'https://pay.ejemplo.com';
    try {
      const r = armarEventoCapi(baseDatos({ pagina: basePagina({ slug: 'oferta-x' }) }));
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('esperaba ok:true');
      expect(r.evento.event_source_url).toBe('https://pay.ejemplo.com/pagos/oferta-x');
    } finally {
      if (previo === undefined) delete process.env.CHECKOUT_BASE_URL;
      else process.env.CHECKOUT_BASE_URL = previo;
    }
  });

  it('event_source_url cae al default https://pay.hilvanapp.com sin CHECKOUT_BASE_URL', () => {
    const previo = process.env.CHECKOUT_BASE_URL;
    delete process.env.CHECKOUT_BASE_URL;
    try {
      const r = armarEventoCapi(baseDatos({ pagina: basePagina({ slug: 'aguadearroz1' }) }));
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('esperaba ok:true');
      expect(r.evento.event_source_url).toBe('https://pay.hilvanapp.com/pagos/aguadearroz1');
    } finally {
      if (previo !== undefined) process.env.CHECKOUT_BASE_URL = previo;
    }
  });

  it('currency usa cobro.moneda en minúsculas; si falta, cae a producto.moneda', () => {
    const r1 = armarEventoCapi(baseDatos({ cobro: baseCobro({ moneda: 'USD' }) }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('esperaba ok:true');
    expect(r1.evento.custom_data.currency).toBe('usd');

    const r2 = armarEventoCapi(
      baseDatos({ cobro: baseCobro({ moneda: null }), producto: baseProducto({ moneda: 'EUR' }) }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('esperaba ok:true');
    expect(r2.evento.custom_data.currency).toBe('eur');
  });
});

// ── sendCapiEvent ─────────────────────────────────────────────────────────────

describe('sendCapiEvent', () => {
  const envPrevio = { ...process.env };

  beforeEach(() => {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
  });

  afterEach(() => {
    process.env = { ...envPrevio };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sin META_PIXEL_ID configurado: no-op, sin hacer ningún fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = armarEventoCapi(baseDatos());
    if (!r.ok) throw new Error('esperaba ok:true');

    const resultado = await sendCapiEvent(r.evento);

    expect(resultado).toEqual({ ok: false, reason: 'env_missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin META_CAPI_TOKEN configurado (solo pixel): también no-op sin fetch', async () => {
    process.env.META_PIXEL_ID = '123456';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = armarEventoCapi(baseDatos());
    if (!r.ok) throw new Error('esperaba ok:true');

    const resultado = await sendCapiEvent(r.evento);

    expect(resultado).toEqual({ ok: false, reason: 'env_missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con pixel y token configurados: llama a Graph API y devuelve ok:true si Meta acepta', async () => {
    process.env.META_PIXEL_ID = '123456';
    process.env.META_CAPI_TOKEN = 'token-abc';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ events_received: 1, fbtrace_id: 'trace-1' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = armarEventoCapi(baseDatos());
    if (!r.ok) throw new Error('esperaba ok:true');

    const resultado = await sendCapiEvent(r.evento);

    expect(resultado).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('123456');
    expect(url).toContain('access_token=token-abc');
    expect(opts.method).toBe('POST');
  });

  it('un fetch fallido a Graph API no tira: devuelve ok:false con error de red', async () => {
    process.env.META_PIXEL_ID = '123456';
    process.env.META_CAPI_TOKEN = 'token-abc';

    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const r = armarEventoCapi(baseDatos());
    if (!r.ok) throw new Error('esperaba ok:true');

    const resultado = await sendCapiEvent(r.evento);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toBe('network');
  });

  it('multi-pixel: manda el mismo evento a ambos pixeles emparejados por posición', async () => {
    process.env.META_PIXEL_ID = '111,222';
    process.env.META_CAPI_TOKEN = 'tokenA,tokenB';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ events_received: 1 })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = armarEventoCapi(baseDatos());
    if (!r.ok) throw new Error('esperaba ok:true');

    const resultado = await sendCapiEvent(r.evento);

    expect(resultado).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ok:true si al menos un pixel acepta, aunque el otro falle', async () => {
    process.env.META_PIXEL_ID = '111,222';
    process.env.META_CAPI_TOKEN = 'tokenA,tokenB';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('bad request') })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ events_received: 1 })),
      });
    vi.stubGlobal('fetch', fetchMock);

    const r = armarEventoCapi(baseDatos());
    if (!r.ok) throw new Error('esperaba ok:true');

    const resultado = await sendCapiEvent(r.evento);

    expect(resultado).toEqual({ ok: true });
  });
});
