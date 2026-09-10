import { describe, expect, it } from 'vitest';
import { armarPayloadIngest, centavos, OMITIDA_SIN_ATRIBUCION, proximoIntento } from './salidas';
import type { Cobro, Orden, Pagina, Producto } from './tipos';

// ── centavos() ────────────────────────────────────────────────────────────────

describe('centavos', () => {
  it('el caso exacto del task: 1234567.89 * 100 con Math.round da 123456789, no 123456788', () => {
    // Verificado en node el 2026-09-10 (T05-salida-panel-emails.md §2):
    // 1234567.89 * 100 === 123456788.99999999 por el binario de punto
    // flotante. Truncar (|0, Math.floor, parseInt) se come el último centavo.
    expect(1234567.89 * 100).toBeCloseTo(123456788.99999999, 5);
    expect(centavos('1234567.89')).toBe(123456789);
    expect(centavos(1234567.89)).toBe(123456789);
  });

  it('el caso simple del task: 9.90 -> 990', () => {
    expect(centavos('9.90')).toBe(990);
  });

  it('el caso que distingue redondeo de truncamiento: 9.909 -> 991, no 990', () => {
    expect(centavos('9.909')).toBe(991);
  });

  it('nunca trunca: nunca usa | 0, Math.floor ni parseInt', () => {
    // Mismo caso que el primero, pero afirmando explícitamente que el
    // truncamiento (lo que NO hay que hacer) da un valor distinto.
    const truncado = Math.trunc(Number('1234567.89') * 100);
    expect(truncado).toBe(123456788);
    expect(centavos('1234567.89')).not.toBe(truncado);
  });
});

// ── proximoIntento() ──────────────────────────────────────────────────────────

describe('proximoIntento', () => {
  const ahora = new Date('2026-01-01T00:00:00.000Z');

  it('intento 0 -> +1 minuto', () => {
    const t = proximoIntento(0, ahora);
    expect(t.getTime() - ahora.getTime()).toBe(1 * 60_000);
  });

  it('intento 3 -> +8 minutos', () => {
    const t = proximoIntento(3, ahora);
    expect(t.getTime() - ahora.getTime()).toBe(8 * 60_000);
  });

  it('intento 20 -> +60 minutos (el techo), nunca más', () => {
    const t = proximoIntento(20, ahora);
    expect(t.getTime() - ahora.getTime()).toBe(60 * 60_000);
  });

  it('el techo no se supera ni con intentos absurdamente altos', () => {
    const t = proximoIntento(500, ahora);
    expect(t.getTime() - ahora.getTime()).toBe(60 * 60_000);
  });

  it('es monótono creciente hasta el techo', () => {
    const valores = [0, 1, 2, 3, 4, 5, 6].map((i) => proximoIntento(i, ahora).getTime());
    for (let i = 1; i < valores.length; i++) {
      expect(valores[i]).toBeGreaterThanOrEqual(valores[i - 1]);
    }
  });
});

// ── armarPayloadIngest() ──────────────────────────────────────────────────────

const UUID_SESSION = '11111111-1111-1111-1111-111111111111';
const UUID_VISITOR = '22222222-2222-2222-2222-222222222222';

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
    metodo_guardado: true,
    session_id: UUID_SESSION,
    visitor_id: UUID_VISITOR,
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

function baseProducto(overrides: Partial<Producto> = {}): Producto {
  return {
    id: 'producto-1',
    nombre: 'App agua de arroz',
    whop_plan_id: 'plan_1',
    whop_product_id: 'prod_1',
    whop_nombre_soft: null,
    precio: '9.90',
    moneda: 'usd',
    precio_anclaje: null,
    imagen_url: null,
    descripcion: null,
    activo: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('armarPayloadIngest', () => {
  it('con session_id y visitor_id presentes arma el payload completo', () => {
    const r = armarPayloadIngest({
      cobro: baseCobro(),
      orden: baseOrden(),
      pagina: basePagina(),
      producto: baseProducto(),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');
    expect(r.payload.sessionId).toBe(UUID_SESSION);
    expect(r.payload.visitorId).toBe(UUID_VISITOR);
    expect(r.payload.events).toHaveLength(1);
    expect(r.payload.events[0]).toMatchObject({
      name: 'Purchase',
      value: 990,
      currency: 'usd',
      eventUid: 'pay_1',
      stepSlug: 'aguadearroz1',
    });
    expect(r.payload.context.path).toBe('/pagos/aguadearroz1');
  });

  it('sin session_id no arma el payload: se omite con motivo, nunca se inventa un UUID', () => {
    const r = armarPayloadIngest({
      cobro: baseCobro(),
      orden: baseOrden({ session_id: null }),
      pagina: basePagina(),
      producto: baseProducto(),
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('esperaba ok:false');
    expect(r.motivo).toBe(OMITIDA_SIN_ATRIBUCION);
  });

  it('sin visitor_id tampoco arma el payload', () => {
    const r = armarPayloadIngest({
      cobro: baseCobro(),
      orden: baseOrden({ visitor_id: null }),
      pagina: basePagina(),
      producto: baseProducto(),
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('esperaba ok:false');
    expect(r.motivo).toBe(OMITIDA_SIN_ATRIBUCION);
  });

  it('sin whop_payment_id no arma el payload (no hay eventUid para deduplicar)', () => {
    const r = armarPayloadIngest({
      cobro: baseCobro({ whop_payment_id: null }),
      orden: baseOrden(),
      pagina: basePagina(),
      producto: baseProducto(),
    });

    expect(r.ok).toBe(false);
  });

  it('usa el monto exacto del task convertido a centavos con Math.round', () => {
    const r = armarPayloadIngest({
      cobro: baseCobro({ monto: '1234567.89' }),
      orden: baseOrden(),
      pagina: basePagina(),
      producto: baseProducto(),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok:true');
    expect(r.payload.events[0].value).toBe(123456789);
  });
});
