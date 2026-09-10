import { afterEach, describe, expect, it } from 'vitest';
import {
  debeEnviar,
  evaluar,
  formatearMensaje,
  silencioDe,
  UMBRALES,
  type Novedad,
  type Sintomas,
} from './alertas';
import { escaparHtml } from './telegram';

/** Un sistema sano y recién instalado: todo en cero. */
function sanos(cambios: Partial<Sintomas> = {}): Sintomas {
  return {
    ultimoEventoAt: null,
    eventosTotales: 0,
    cobrosEnLaVentana: 0,
    cobrosTrabados: 0,
    cobroTrabadoMasViejoAt: null,
    colaQuemada: 0,
    colaAtrasada: 0,
    eventosConError: 0,
    disputas: [],
    reembolsos: [],
    ventas: [],
    ...cambios,
  };
}

function novedad(cambios: Partial<Novedad> = {}): Novedad {
  return {
    cobroId: 'c1',
    monto: '37.00',
    moneda: 'usd',
    email: 'alguien@example.com',
    producto: 'Acceso Vip',
    slug: 'upsell-1',
    ...cambios,
  };
}

const AHORA = new Date('2026-09-10T20:00:00Z');
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000);
const claves = (s: Sintomas) => evaluar(s, AHORA).map((a) => a.clave);

describe('evaluar', () => {
  it('un sistema nuevo y sin tráfico no genera ninguna alerta', () => {
    // El test más importante del archivo. Un deploy limpio tiene 0 eventos, 0
    // cobros y el webhook todavía sin configurar: si eso alertara, el bot
    // arrancaría gritando y nadie volvería a mirarlo.
    expect(evaluar(sanos(), AHORA)).toEqual([]);
  });

  it('avisa cuando el webhook funcionó y se calló', () => {
    const alertas = evaluar(
      sanos({ eventosTotales: 12, ultimoEventoAt: hace(UMBRALES.webhookMudoHoras + 1) }),
      AHORA,
    );
    expect(alertas).toHaveLength(1);
    expect(alertas[0].clave).toBe('webhook_mudo');
    expect(alertas[0].gravedad).toBe('grave');
    expect(alertas[0].detalle).toContain('72 h');
  });

  it('no avisa si el último webhook está dentro de la ventana', () => {
    expect(claves(sanos({ eventosTotales: 12, ultimoEventoAt: hace(1) }))).toEqual([]);
  });

  it('justo en el umbral ya avisa', () => {
    // El límite es `>=`: a las 6 h exactas se avisa. Si fuera `>`, un cron que
    // corre cada 15 min dejaría pasar la ventana sin avisar cuando el evento
    // cae justo en el borde.
    expect(claves(sanos({ eventosTotales: 1, ultimoEventoAt: hace(UMBRALES.webhookMudoHoras) }))).toEqual([
      'webhook_mudo',
    ]);
  });

  it('avisa si hubo cobros y nunca llegó ningún webhook', () => {
    const alertas = evaluar(sanos({ eventosTotales: 0, cobrosEnLaVentana: 3 }), AHORA);
    expect(alertas.map((a) => a.clave)).toEqual(['webhook_mudo']);
    expect(alertas[0].detalle).toContain('todavía no apunta acá');
  });

  it('sin eventos y sin cobros no dice nada, aunque nunca haya llegado un webhook', () => {
    expect(claves(sanos({ eventosTotales: 0, cobrosEnLaVentana: 0 }))).toEqual([]);
  });

  it('avisa los cobros trabados e incluye la antigüedad del más viejo', () => {
    const alertas = evaluar(
      sanos({ cobrosTrabados: 2, cobroTrabadoMasViejoAt: hace(5) }),
      AHORA,
    );
    expect(alertas[0].clave).toBe('cobros_trabados');
    expect(alertas[0].titulo).toContain('2 cobro(s)');
    expect(alertas[0].detalle).toContain('5 h');
  });

  it('la cola quemada y la cola atrasada son dos alertas distintas', () => {
    // No se mezclan a propósito: "agotó los reintentos" y "el cron no corre"
    // tienen causas y arreglos distintos, y una sola alerta obligaría a leer el
    // número para saber cuál de las dos cosas pasó.
    expect(claves(sanos({ colaQuemada: 1, colaAtrasada: 4 }))).toEqual(['cola_quemada', 'cola_atascada']);
  });

  it('los eventos con error son aviso, no grave', () => {
    const alertas = evaluar(sanos({ eventosConError: 2 }), AHORA);
    expect(alertas[0].gravedad).toBe('aviso');
  });

  it('cada disputa lleva su propia clave con el id del cobro', () => {
    const alertas = evaluar(
      sanos({ disputas: [novedad({ cobroId: 'aaa' }), novedad({ cobroId: 'bbb' })] }),
      AHORA,
    );
    expect(alertas.map((a) => a.clave)).toEqual(['disputa:aaa', 'disputa:bbb']);
    expect(alertas.every((a) => a.gravedad === 'grave')).toBe(true);
  });

  it('un reembolso es aviso y una venta es info', () => {
    const alertas = evaluar(
      sanos({ reembolsos: [novedad({ cobroId: 'r1' })], ventas: [novedad({ cobroId: 'v1' })] }),
      AHORA,
    );
    const porClave = new Map(alertas.map((a) => [a.clave, a.gravedad]));
    expect(porClave.get('reembolso:r1')).toBe('aviso');
    expect(porClave.get('venta:v1')).toBe('info');
  });

  it('escapa el HTML del nombre del producto y del email', () => {
    // Un `<` sin escapar deja el mensaje mal formado y Telegram lo rechaza con
    // 400: la alerta se pierde justo cuando el dato traía algo raro.
    const alertas = evaluar(
      sanos({ ventas: [novedad({ producto: 'Pack <b>VIP</b>', email: 'a<b@x.com' })] }),
      AHORA,
    );
    expect(alertas[0].detalle).toContain('Pack &lt;b&gt;VIP&lt;/b&gt;');
    expect(alertas[0].detalle).not.toContain('<b>VIP');
    expect(alertas[0].detalle).toContain('a&lt;b@x.com');
  });

  it('un monto nulo no se muestra como 0', () => {
    const alertas = evaluar(sanos({ ventas: [novedad({ monto: null })] }), AHORA);
    expect(alertas[0].detalle).toContain('sin monto');
    expect(alertas[0].detalle).not.toContain('0.00');
  });

  describe('TELEGRAM_AVISAR_VENTAS', () => {
    afterEach(() => {
      delete process.env.TELEGRAM_AVISAR_VENTAS;
    });

    it('con "0" no manda los avisos de venta pero sí los de falla', () => {
      process.env.TELEGRAM_AVISAR_VENTAS = '0';
      const s = sanos({ ventas: [novedad({ cobroId: 'v1' })], colaQuemada: 1 });
      expect(claves(s)).toEqual(['cola_quemada']);
    });

    it('sin la variable, las ventas se avisan', () => {
      expect(claves(sanos({ ventas: [novedad({ cobroId: 'v1' })] }))).toEqual(['venta:v1']);
    });
  });
});

describe('silencioDe', () => {
  it('la cola atascada tiene la ventana más corta de todas', () => {
    // Es la única falla que se agrava sola: la cola sigue creciendo.
    expect(silencioDe('cola_atascada')).toBe(60);
    expect(silencioDe('cola_atascada')).toBeLessThan(silencioDe('webhook_mudo'));
  });

  it('las claves con id usan la ventana de su prefijo', () => {
    expect(silencioDe('disputa:cualquier-uuid')).toBe(30 * 24 * 60);
    expect(silencioDe('venta:otro-uuid')).toBe(30 * 24 * 60);
  });

  it('una clave desconocida cae en el default y no en cero', () => {
    // Cero silencio sería mandar la misma alerta cada 15 minutos.
    expect(silencioDe('algo_que_no_existe')).toBeGreaterThan(0);
  });
});

describe('debeEnviar', () => {
  it('una alerta que nunca se mandó se manda', () => {
    expect(debeEnviar(null, 'cola_quemada', AHORA)).toBe(true);
  });

  it('dentro de la ventana de silencio no se repite', () => {
    const previa = { clave: 'cola_quemada', ultimo_envio_at: hace(2), veces: 1 };
    expect(debeEnviar(previa, 'cola_quemada', AHORA)).toBe(false);
  });

  it('pasada la ventana se vuelve a mandar', () => {
    const previa = { clave: 'cola_quemada', ultimo_envio_at: hace(13), veces: 1 };
    expect(debeEnviar(previa, 'cola_quemada', AHORA)).toBe(true);
  });

  it('cada clave usa SU ventana, no una global', () => {
    const previa = (clave: string) => ({ clave, ultimo_envio_at: hace(2), veces: 1 });
    // 2 h pasaron: alcanza para la cola atascada (1 h) y no para el webhook (12 h).
    expect(debeEnviar(previa('cola_atascada'), 'cola_atascada', AHORA)).toBe(true);
    expect(debeEnviar(previa('webhook_mudo'), 'webhook_mudo', AHORA)).toBe(false);
  });

  it('una disputa ya avisada no se repite un mes después de detectarse', () => {
    const previa = { clave: 'disputa:x', ultimo_envio_at: hace(24 * 20), veces: 1 };
    expect(debeEnviar(previa, 'disputa:x', AHORA)).toBe(false);
  });
});

describe('formatearMensaje', () => {
  const alerta = {
    clave: 'cola_quemada',
    gravedad: 'grave' as const,
    titulo: '2 ventas que nunca salieron',
    detalle: 'detalle cualquiera',
  };

  it('la primera vez no dice que se repite', () => {
    expect(formatearMensaje(alerta, 1)).not.toContain('se repite');
  });

  it('a partir de la segunda muestra el contador', () => {
    expect(formatearMensaje(alerta, 3)).toContain('3ª vez');
  });

  it('el emoji distingue la gravedad de un vistazo', () => {
    expect(formatearMensaje({ ...alerta, gravedad: 'grave' }, 1).startsWith('🔴')).toBe(true);
    expect(formatearMensaje({ ...alerta, gravedad: 'aviso' }, 1).startsWith('🟡')).toBe(true);
    expect(formatearMensaje({ ...alerta, gravedad: 'info' }, 1).startsWith('💰')).toBe(true);
  });

  it('escapa el título', () => {
    const conHtml = { ...alerta, titulo: 'a <b> b' };
    expect(formatearMensaje(conHtml, 1)).toContain('a &lt;b&gt; b');
  });
});

describe('escaparHtml', () => {
  it('escapa los tres caracteres que pide Telegram', () => {
    expect(escaparHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('escapa el & primero, así no re-escapa lo que acaba de crear', () => {
    // Si el orden fuera al revés, `<` daría `&amp;lt;` y el mensaje mostraría
    // literalmente "&lt;".
    expect(escaparHtml('<')).toBe('&lt;');
    expect(escaparHtml('&lt;')).toBe('&amp;lt;');
  });

  it('un texto sin caracteres especiales queda igual', () => {
    expect(escaparHtml('37.00 USD — Acceso Vip')).toBe('37.00 USD — Acceso Vip');
  });
});
