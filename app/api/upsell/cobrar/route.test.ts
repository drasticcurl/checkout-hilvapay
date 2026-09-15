/**
 * Tests de integración de `POST /api/upsell/cobrar`.
 *
 * Nacieron en la auditoría de seguridad del 2026-09-11 documentando dos
 * hallazgos, y ahora fijan los arreglos. Se deja escrito qué era cada problema,
 * porque un test que solo dice "responde 429" no explica por qué eso importa:
 *
 *  1. NO HABÍA RATE LIMITING en este endpoint, a diferencia de
 *     `/api/checkout/sesion`, que sí tenía el suyo. El índice único
 *     `(orden_id, pagina_id)` ya evitaba el doble cobro, pero no evitaba miles
 *     de requests contra la base y contra la API de Whop. Arreglado con
 *     `lib/rate-limit.ts`, 10 por minuto por IP.
 *
 *  2. EL TOKEN NO ESTABA ACOTADO AL FUNNEL DE ORIGEN. `resolverToken` solo valida
 *     que el token exista y no haya vencido, y el endpoint aceptaba cualquier
 *     `slug` de tipo `upsell` activo — incluido el de otro funnel y otro
 *     producto. El comentario de `ordenes.token` en `db/migrations/001_init.sql`
 *     decía "limitado a las páginas del funnel" y eso no se aplicaba en ninguna
 *     parte. Arreglado comparando el `funnel_id` del paso contra el de la página
 *     del front que originó la orden.
 *
 * Todo mockeado: `lib/db`, `lib/whop`, `lib/cors`, `lib/token`, `lib/funnels`.
 * No toca Postgres ni la red.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const qMock = vi.fn();
const q1Mock = vi.fn();
const headersCorsMock = vi.fn();
const resolverTokenMock = vi.fn();
const crearPagoOffSessionMock = vi.fn();
const resolverSiguienteUrlMock = vi.fn().mockResolvedValue(null);
const resolverSiguienteUrlPorFondosMock = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/db', () => ({
  q: (...args: unknown[]) => qMock(...args),
  q1: (...args: unknown[]) => q1Mock(...args),
}));

vi.mock('@/lib/cors', () => ({
  headersCors: (...args: unknown[]) => headersCorsMock(...args),
}));

vi.mock('@/lib/token', () => ({
  resolverToken: (...args: unknown[]) => resolverTokenMock(...args),
}));

vi.mock('@/lib/whop', () => ({
  crearPagoOffSession: (...args: unknown[]) => crearPagoOffSessionMock(...args),
  crearCheckoutConfiguration: vi.fn(),
  WhopError: class WhopError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/funnels', () => ({
  resolverSiguienteUrl: (...args: unknown[]) => resolverSiguienteUrlMock(...args),
  resolverSiguienteUrlPorFondos: (...args: unknown[]) => resolverSiguienteUrlPorFondosMock(...args),
  resultadoDeEstado: () => null,
}));

vi.mock('@/lib/cobros', () => ({
  aplicarEstadoDePago: vi.fn().mockResolvedValue({ status: 'pagado', cambio: true }),
  buscarCobro: vi.fn(),
}));

const ORIGEN_AUTORIZADO = 'https://mifunnel.com';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ORIGEN_AUTORIZADO,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
};

const FUNNEL = 'funnel-1';

const ORDEN_BASE = {
  id: 'orden-1',
  pagina_id: 'pagina-front-1',
  email: 'comprador@example.com',
  nombre: 'Comprador',
  token: 'el-token-de-la-orden',
  token_expira_at: new Date(Date.now() + 60 * 60 * 1000),
  whop_member_id: 'mem_123',
  whop_payment_method_id: 'payt_123',
  whop_user_id: 'user_123',
  whop_checkout_config_id: 'cfg_123',
  metodo_guardado: true,
  session_id: null,
  visitor_id: null,
  utms: null,
  created_at: new Date(),
  updated_at: new Date(),
};

/**
 * El rate limit vive en el módulo (una constante de nivel superior), así que el
 * contador sobrevive entre tests del mismo archivo. Cada test que necesita
 * arrancar con el contador limpio usa una IP distinta — es más honesto que
 * exportar un `reset()` solo para los tests, porque prueba el comportamiento real
 * de "el límite es por IP".
 */
let n = 0;
function ipNueva(): string {
  n += 1;
  return `10.0.0.${n}`;
}

function requestCobrar(body: unknown, origin = ORIGEN_AUTORIZADO, ip = ipNueva()): Request {
  return new Request('https://pay.hilvanapp.com/api/upsell/cobrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  headersCorsMock.mockResolvedValue(CORS_HEADERS);
  resolverSiguienteUrlMock.mockResolvedValue(null);
  resolverSiguienteUrlPorFondosMock.mockResolvedValue(null);
  const cobrosLib = await import('@/lib/cobros');
  (cobrosLib.aplicarEstadoDePago as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 'pagado',
    cambio: true,
  });
});

describe('POST /api/upsell/cobrar — rate limiting', () => {
  it('corta con 429 cuando una misma IP pasa de 10 intentos por minuto', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: false, motivo: 'invalido' });

    const ip = ipNueva();
    const respuestas: number[] = [];
    for (let i = 0; i < 15; i++) {
      const r = await POST(requestCobrar({ token: 'token-adivinado', slug: 'upsell-1' }, ORIGEN_AUTORIZADO, ip));
      respuestas.push(r.status);
    }

    // Las primeras 10 llegan a validar el token (401). De la 11 en adelante se
    // cortan antes: 429 y sin tocar la base.
    expect(respuestas.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(respuestas.slice(10)).toEqual(Array(5).fill(429));
    expect(resolverTokenMock).toHaveBeenCalledTimes(10);
  });

  it('el 429 LLEVA los headers de CORS, para que el loader pueda leerlo', async () => {
    // Sin los headers el navegador le esconde el status al script y su `catch`
    // no distingue "te frené" de "se cayó la red" — el botón quedaría
    // deshabilitado sin explicación.
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: false, motivo: 'invalido' });

    const ip = ipNueva();
    let ultima: Response | null = null;
    for (let i = 0; i < 12; i++) {
      ultima = await POST(requestCobrar({ token: 'x', slug: 'upsell-1' }, ORIGEN_AUTORIZADO, ip));
    }
    expect(ultima!.status).toBe(429);
    expect(ultima!.headers.get('access-control-allow-origin')).toBe(ORIGEN_AUTORIZADO);
    expect(await ultima!.json()).toEqual({ error: 'demasiados_intentos' });
  });

  it('el límite es por IP: una IP agotada no bloquea a otra', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: false, motivo: 'invalido' });

    const agotada = ipNueva();
    for (let i = 0; i < 12; i++) {
      await POST(requestCobrar({ token: 'x', slug: 'upsell-1' }, ORIGEN_AUTORIZADO, agotada));
    }
    const bloqueada = await POST(requestCobrar({ token: 'x', slug: 'upsell-1' }, ORIGEN_AUTORIZADO, agotada));
    expect(bloqueada.status).toBe(429);

    // Otro visitante entra normalmente. Si el límite fuera global, esto sería un
    // corte de ventas para todos por la actividad de uno.
    const otra = await POST(requestCobrar({ token: 'x', slug: 'upsell-1' }, ORIGEN_AUTORIZADO, ipNueva()));
    expect(otra.status).toBe(401);
  });

  it('el rate limit va DESPUÉS del CORS: un origen no autorizado no gasta cuota', async () => {
    // Si fuera al revés, cualquiera podría llenar el Map desde afuera de la
    // allowlist y provocar 429 a los compradores legítimos de esa IP.
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    headersCorsMock.mockResolvedValue(null);
    resolverTokenMock.mockResolvedValue({ ok: false, motivo: 'invalido' });

    const ip = ipNueva();
    for (let i = 0; i < 20; i++) {
      const r = await POST(requestCobrar({ token: 'x', slug: 'u' }, 'https://evil.example.com', ip));
      expect(r.status).toBe(403); // siempre 403, nunca 429
    }

    // La misma IP, ahora con un origen autorizado: no gastó nada.
    headersCorsMock.mockResolvedValue(CORS_HEADERS);
    const r = await POST(requestCobrar({ token: 'x', slug: 'upsell-1' }, ORIGEN_AUTORIZADO, ip));
    expect(r.status).toBe(401);
  });
});

describe('POST /api/upsell/cobrar — CORS', () => {
  it('sin headers CORS (origen no autorizado) responde 403 y no llega a resolver el token', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    headersCorsMock.mockResolvedValue(null);

    const r = await POST(requestCobrar({ token: 'x', slug: 'upsell-1' }, 'https://evil.example.com'));
    expect(r.status).toBe(403);
    expect(resolverTokenMock).not.toHaveBeenCalled();
    const body = await r.json();
    expect(body).toEqual({ error: 'origen_no_autorizado' });
    // Sin Access-Control-Allow-Origin en la respuesta: el browser no deja leer
    // el cuerpo desde un origen no autorizado.
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /api/upsell/cobrar — scope del token entre funnels', () => {
  /** La fila que devuelve el SQL del paso 3, con los dos funnel_id que se comparan. */
  function filaPagina(over: Record<string, unknown> = {}) {
    return {
      id: 'pagina-upsell-1',
      tipo: 'upsell',
      url_exito: null,
      url_rechazo: null,
      producto_id: 'prod-1',
      whop_plan_id: 'plan_1',
      activo: true,
      funnel_id: FUNNEL,
      funnel_de_la_orden: FUNNEL,
      ...over,
    };
  }

  async function mockearCobroCreado(paginaId: string) {
    qMock.mockResolvedValueOnce(undefined);
    const cobrosLib = await import('@/lib/cobros');
    (cobrosLib.buscarCobro as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cobro-1',
      orden_id: ORDEN_BASE.id,
      pagina_id: paginaId,
      producto_id: 'prod-1',
      whop_plan_id: 'plan_1',
      whop_payment_id: null,
      status: 'creando',
      decline_code: null,
      failure_message: null,
      idempotency_key: `${ORDEN_BASE.id}:${paginaId}`,
      monto: null,
      moneda: null,
      origen: 'upsell',
      reembolsado_at: null,
      disputa_at: null,
      email_enviado_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  it('un paso de OTRO funnel da 404 y NUNCA llega a Whop', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina({ funnel_id: 'funnel-ajeno' }));

    const r = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'slug-de-otro-funnel' }));

    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'pagina_inexistente' });
    // Lo que importa: no se cobró nada. Antes del arreglo, esto llegaba a
    // crearPagoOffSession y le cobraba a alguien un producto que nunca vio.
    expect(crearPagoOffSessionMock).not.toHaveBeenCalled();
  });

  it('404 y no 403: un 403 confirmaría que ese slug existe y está activo', async () => {
    // Con un 403 alguien que prueba slugs sabría cuáles son reales y de qué
    // funnel. El 404 se ve igual que un slug inventado.
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina({ funnel_id: 'funnel-ajeno' }));

    const ajeno = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'existe-pero-es-de-otro' }));

    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(null); // slug que no existe
    const inventado = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'no-existe' }));

    expect(ajeno.status).toBe(inventado.status);
    expect(await ajeno.json()).toEqual(await inventado.json());
  });

  it('el paso del MISMO funnel cobra normalmente', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina());
    await mockearCobroCreado('pagina-upsell-1');
    crearPagoOffSessionMock.mockResolvedValue({ id: 'pay_1', settlement_amount: 2, currency: 'usd' });

    const r = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'upsell-1' }));

    expect(crearPagoOffSessionMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(200);
  });

  it('dos páginas SUELTAS (sin funnel) siguen funcionando: las de antes de la migración 003', async () => {
    // El README las documenta como soportadas. Los dos NULL son iguales, así que
    // el chequeo las deja pasar sin necesitar un caso especial.
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina({ funnel_id: null, funnel_de_la_orden: null }));
    await mockearCobroCreado('pagina-upsell-1');
    crearPagoOffSessionMock.mockResolvedValue({ id: 'pay_1', settlement_amount: 2, currency: 'usd' });

    const r = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'suelta-1' }));

    expect(crearPagoOffSessionMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(200);
  });

  it('el CRUCE suelta/funnel no pasa, en las dos direcciones', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');

    // Paso suelto, orden de un funnel.
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina({ funnel_id: null, funnel_de_la_orden: FUNNEL }));
    const a = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'suelta' }));
    expect(a.status).toBe(404);

    // Paso de un funnel, orden suelta.
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina({ funnel_id: FUNNEL, funnel_de_la_orden: null }));
    const b = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'del-funnel' }));
    expect(b.status).toBe(404);

    expect(crearPagoOffSessionMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/upsell/cobrar — decline sin_fondos redirige al downsell (migración 014)', () => {
  /** Igual que `filaPagina` de arriba, en este describe: la fila del paso 3. */
  function filaPagina(over: Record<string, unknown> = {}) {
    return {
      id: 'pagina-upsell-1',
      tipo: 'upsell',
      url_exito: null,
      url_rechazo: null,
      producto_id: 'prod-1',
      whop_plan_id: 'plan_1',
      activo: true,
      funnel_id: FUNNEL,
      funnel_de_la_orden: FUNNEL,
      ...over,
    };
  }

  async function mockearCobroFallidoPorFondos(paginaId: string) {
    qMock.mockResolvedValueOnce(undefined);
    const cobrosLib = await import('@/lib/cobros');
    const cobroFallido = {
      id: 'cobro-1',
      orden_id: ORDEN_BASE.id,
      pagina_id: paginaId,
      producto_id: 'prod-1',
      whop_plan_id: 'plan_1',
      whop_payment_id: 'pay_1',
      status: 'fallido' as const,
      decline_code: 'insufficient_funds',
      failure_message: 'Your card has insufficient funds to complete this purchase.',
      idempotency_key: `${ORDEN_BASE.id}:${paginaId}`,
      monto: null,
      moneda: null,
      origen: 'upsell' as const,
      reembolsado_at: null,
      disputa_at: null,
      email_enviado_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    // El cobro que trae buscarCobro ANTES de llamar a Whop (paso 5): recién
    // creado, sin whop_payment_id. Después de aplicarEstadoDePago, buscarCobro
    // se vuelve a llamar y ahí sí devuelve el fallido con el decline_code — es
    // el mismo patrón de dos llamadas que usa el resto del archivo.
    (cobrosLib.buscarCobro as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...cobroFallido, whop_payment_id: null, status: 'creando', decline_code: null })
      .mockResolvedValue(cobroFallido);
    (cobrosLib.aplicarEstadoDePago as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'fallido',
      cambio: true,
    });
  }

  it('con downsell_por_fondos_id configurado, la respuesta trae esa URL como siguienteUrl', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina());
    await mockearCobroFallidoPorFondos('pagina-upsell-1');
    crearPagoOffSessionMock.mockResolvedValue({
      id: 'pay_1',
      substatus: 'failed',
      decline_code: 'insufficient_funds',
      settlement_amount: null,
      currency: null,
    });
    // El destino real lo resuelve lib/funnels.ts (mockeado acá): se verifica
    // que EL ENDPOINT lo pida por el camino de fondos, no el genérico.
    resolverSiguienteUrlPorFondosMock.mockResolvedValue('https://elfunnel.com/downsell-17?ot=el-token-de-la-orden');

    const r = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'upsell-1' }));
    const body = await r.json();

    expect(r.status).toBe(200);
    expect(body.estado).toBe('fallido');
    expect(body.siguienteUrl).toBe('https://elfunnel.com/downsell-17?ot=el-token-de-la-orden');
    // El camino genérico (resultadoDeEstado/resolverSiguienteUrl) NO se usa
    // para este decline: se llama el de fondos, con el pagina_id del cobro.
    expect(resolverSiguienteUrlPorFondosMock).toHaveBeenCalledWith('pagina-upsell-1', ORDEN_BASE.token);
    expect(resolverSiguienteUrlMock).not.toHaveBeenCalled();
  });

  it('sin downsell_por_fondos_id configurado, siguienteUrl es null (el mock ya lo devuelve así) — comportamiento sin romper nada para quien no lo configuró', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina());
    await mockearCobroFallidoPorFondos('pagina-upsell-1');
    crearPagoOffSessionMock.mockResolvedValue({
      id: 'pay_1',
      substatus: 'failed',
      decline_code: 'insufficient_funds',
      settlement_amount: null,
      currency: null,
    });
    // resolverSiguienteUrlPorFondosMock ya resuelve `null` por default (beforeEach).

    const r = await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'upsell-1' }));
    const body = await r.json();

    expect(r.status).toBe(200);
    expect(body.estado).toBe('fallido');
    expect(body.siguienteUrl).toBeNull();
    expect(resolverSiguienteUrlPorFondosMock).toHaveBeenCalledTimes(1);
  });

  it('un decline que NO es sin_fondos (ej. lost_card) sigue el camino genérico, no el de fondos', async () => {
    const { POST } = await import('@/app/api/upsell/cobrar/route');
    resolverTokenMock.mockResolvedValue({ ok: true, orden: ORDEN_BASE });
    q1Mock.mockResolvedValueOnce(filaPagina());

    qMock.mockResolvedValueOnce(undefined);
    const cobrosLib = await import('@/lib/cobros');
    const cobroFallido = {
      id: 'cobro-2',
      orden_id: ORDEN_BASE.id,
      pagina_id: 'pagina-upsell-1',
      producto_id: 'prod-1',
      whop_plan_id: 'plan_1',
      whop_payment_id: 'pay_2',
      status: 'fallido' as const,
      decline_code: 'lost_card',
      failure_message: null,
      idempotency_key: `${ORDEN_BASE.id}:pagina-upsell-1`,
      monto: null,
      moneda: null,
      origen: 'upsell' as const,
      reembolsado_at: null,
      disputa_at: null,
      email_enviado_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    (cobrosLib.buscarCobro as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...cobroFallido, whop_payment_id: null, status: 'creando', decline_code: null })
      .mockResolvedValue(cobroFallido);
    (cobrosLib.aplicarEstadoDePago as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'fallido',
      cambio: true,
    });
    crearPagoOffSessionMock.mockResolvedValue({
      id: 'pay_2',
      substatus: 'failed',
      decline_code: 'lost_card',
      settlement_amount: null,
      currency: null,
    });

    await POST(requestCobrar({ token: ORDEN_BASE.token, slug: 'upsell-1' }));

    expect(resolverSiguienteUrlPorFondosMock).not.toHaveBeenCalled();
  });
});
