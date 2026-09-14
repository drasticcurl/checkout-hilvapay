import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockeamos lib/db y lib/telegram ANTES de importar lib/alertas, mismo
// criterio que email.test.ts: `vigilar()` toca la base (medir, el historial de
// `alertas`) y la red (mandarAlerta), y el test tiene que poder correr sin
// Postgres ni Telegram de verdad.
const qMock = vi.fn();
const q1Mock = vi.fn();
vi.mock('./db', () => ({
  q: (...args: unknown[]) => qMock(...args),
  q1: (...args: unknown[]) => q1Mock(...args),
}));

const mandarAlertaMock = vi.fn();
vi.mock('./telegram', async () => {
  const real = await vi.importActual<typeof import('./telegram')>('./telegram');
  return { ...real, mandarAlerta: (...args: unknown[]) => mandarAlertaMock(...args) };
});

import {
  debeEnviar,
  evaluar,
  formatearMensaje,
  silencioDe,
  UMBRALES,
  vigilar,
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
    intentosUltimaHora: 0,
    pagadosUltimaHora: 0,
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

  it('avisa cuando el webhook funcionó y se calló, con tráfico nuevo sin evento', () => {
    // El caso real: hubo ventas antes (eventosTotales > 0) y también hay
    // cobros NUEVOS en la ventana que el webhook no acompañó. Sin
    // `cobrosEnLaVentana`, esto no es una caída — es que no hay tráfico.
    const alertas = evaluar(
      sanos({
        eventosTotales: 12,
        ultimoEventoAt: hace(UMBRALES.webhookMudoHoras + 1),
        cobrosEnLaVentana: 2,
      }),
      AHORA,
    );
    expect(alertas).toHaveLength(1);
    expect(alertas[0].clave).toBe('webhook_mudo');
    expect(alertas[0].gravedad).toBe('grave');
    expect(alertas[0].detalle).toContain('72 h');
  });

  it('NO avisa si el webhook está callado pero no hay tráfico nuevo — no vender no es una falla', () => {
    // Regresión del bug medido en producción el 2026-09-14: un negocio sin
    // ventas en un par de horas (lo normal fuera de campaña) recibía "el
    // webhook no está llegando" cada 10 minutos. El webhook funcionó alguna
    // vez (eventosTotales > 0) pero no hay ningún cobro nuevo que debiera
    // haber traído un evento — no hay nada que esté fallando en silencio.
    expect(
      claves(sanos({ eventosTotales: 12, ultimoEventoAt: hace(UMBRALES.webhookMudoHoras + 2), cobrosEnLaVentana: 0 })),
    ).toEqual([]);
  });

  it('no avisa si el último webhook está dentro de la ventana', () => {
    expect(claves(sanos({ eventosTotales: 12, ultimoEventoAt: hace(1), cobrosEnLaVentana: 2 }))).toEqual([]);
  });

  it('justo en el umbral ya avisa, con tráfico nuevo', () => {
    // El límite es `>=`: a las 2 h exactas se avisa. Si fuera `>`, un cron que
    // corre cada 15 min dejaría pasar la ventana sin avisar cuando el evento
    // cae justo en el borde.
    expect(
      claves(sanos({ eventosTotales: 1, ultimoEventoAt: hace(UMBRALES.webhookMudoHoras), cobrosEnLaVentana: 1 })),
    ).toEqual(['webhook_mudo']);
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
  it('el webhook mudo insiste cada 10 minutos', () => {
    // Es la única alerta que el dueño pidió que repita: mientras el webhook no
    // llegue, las ventas se registran solo por reconciliación. Con el cron cada
    // 5 min, 10 minutos de silencio dan un mensaje cada 10.
    expect(silencioDe('webhook_mudo')).toBe(10);
  });

  it('las ventas caídas insisten cada media hora', () => {
    expect(silencioDe('ventas_fallando')).toBe(30);
  });

  it('las claves con id usan la ventana de su prefijo', () => {
    expect(silencioDe('disputa:cualquier-uuid')).toBe(30 * 24 * 60);
    expect(silencioDe('venta:otro-uuid')).toBe(30 * 24 * 60);
  });

  it('una clave desconocida cae en el default y no en cero', () => {
    // Cero silencio sería mandar la misma alerta cada 5 minutos.
    expect(silencioDe('algo_que_no_existe')).toBeGreaterThan(0);
  });
});

describe('audiencia', () => {
  const audienciaDe = (s: Sintomas, clave: string) =>
    evaluar(s, AHORA).find((a) => a.clave === clave)?.audiencia;

  it('la venta es lo ÚNICO que ve el equipo', () => {
    const s = sanos({
      ventas: [novedad({ cobroId: 'v1' })],
      colaQuemada: 1,
      colaAtrasada: 1,
      cobrosTrabados: 1,
      eventosConError: 1,
      eventosTotales: 5,
      ultimoEventoAt: hace(9),
      cobrosEnLaVentana: 2,
      disputas: [novedad({ cobroId: 'd1' })],
      reembolsos: [novedad({ cobroId: 'r1' })],
    });
    const paraEquipo = evaluar(s, AHORA).filter((a) => a.audiencia === 'equipo');
    expect(paraEquipo.map((a) => a.clave)).toEqual(['venta:v1']);
  });

  it('lo técnico va solo al admin', () => {
    expect(audienciaDe(sanos({ colaQuemada: 1 }), 'cola_quemada')).toBe('admin');
    expect(audienciaDe(sanos({ colaAtrasada: 1 }), 'cola_atascada')).toBe('admin');
    expect(audienciaDe(sanos({ cobrosTrabados: 1 }), 'cobros_trabados')).toBe('admin');
    expect(audienciaDe(sanos({ eventosConError: 1 }), 'eventos_con_error')).toBe('admin');
    expect(audienciaDe(sanos({ eventosTotales: 3, ultimoEventoAt: hace(9), cobrosEnLaVentana: 1 }), 'webhook_mudo')).toBe('admin');
  });

  it('los reembolsos y disputas también son del admin: se resuelven en Whop', () => {
    expect(audienciaDe(sanos({ disputas: [novedad({ cobroId: 'd1' })] }), 'disputa:d1')).toBe('admin');
    expect(audienciaDe(sanos({ reembolsos: [novedad({ cobroId: 'r1' })] }), 'reembolso:r1')).toBe('admin');
  });
});

describe('ventas_fallando', () => {
  it('avisa con 3 intentos y ninguno pagado', () => {
    const alertas = evaluar(sanos({ intentosUltimaHora: 3, pagadosUltimaHora: 0 }), AHORA);
    const a = alertas.find((x) => x.clave === 'ventas_fallando');
    expect(a?.gravedad).toBe('grave');
    expect(a?.audiencia).toBe('admin');
    expect(a?.detalle).toContain('3 intentos');
  });

  it('con 2 intentos no avisa: un decline aislado es normal', () => {
    expect(claves(sanos({ intentosUltimaHora: 2, pagadosUltimaHora: 0 }))).not.toContain('ventas_fallando');
  });

  it('si entró aunque sea una venta, no avisa', () => {
    // 9 rechazos y 1 venta es una tasa de aprobación mala, no un sistema roto.
    // Eso se mira en /admin/numeros, no se grita por Telegram.
    expect(claves(sanos({ intentosUltimaHora: 10, pagadosUltimaHora: 1 }))).not.toContain('ventas_fallando');
  });

  it('sin intentos no avisa: no hay tráfico, no hay problema', () => {
    expect(claves(sanos({ intentosUltimaHora: 0, pagadosUltimaHora: 0 }))).toEqual([]);
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
    // Pasaron 2 h: de sobra para el webhook mudo (10 min, insiste) y muy poco
    // para la cola quemada (12 h, no hace falta repetirla).
    expect(debeEnviar(previa('webhook_mudo'), 'webhook_mudo', AHORA)).toBe(true);
    expect(debeEnviar(previa('cola_quemada'), 'cola_quemada', AHORA)).toBe(false);
  });

  it('el webhook mudo NO se repite antes de sus 10 minutos', () => {
    // El cron corre cada 5 minutos: sin esta guarda, la alerta saldría en cada
    // corrida y serían 12 mensajes por hora.
    const hace5min = new Date(AHORA.getTime() - 5 * 60_000);
    const previa = { clave: 'webhook_mudo', ultimo_envio_at: hace5min, veces: 3 };
    expect(debeEnviar(previa, 'webhook_mudo', AHORA)).toBe(false);
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
    audiencia: 'admin' as const,
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

describe('vigilar', () => {
  // `medir()` hace, en este orden exacto, 6 llamadas a `q1` (eventos,
  // cobrosVentana, trabados, cola, eventosError, ultimaHora) y 3 a `q`
  // (disputas, reembolsos, ventas). Este helper carga las 6 primeras con un
  // sistema sano y deja las 3 de `q` para quien llame, así cada test solo
  // arma el síntoma que le importa sin repetir las nueve líneas.
  function medirSano(): void {
    q1Mock
      .mockResolvedValueOnce({ ultimo: null, total: '0' }) // eventos
      .mockResolvedValueOnce({ total: '0' }) // cobrosVentana
      .mockResolvedValueOnce({ total: '0', mas_viejo: null }) // trabados
      .mockResolvedValueOnce({ quemada: '0', atrasada: '0' }) // cola
      .mockResolvedValueOnce({ total: '0' }) // eventosError
      .mockResolvedValueOnce({ intentos: '0', pagados: '0' }); // ultimaHora
  }

  beforeEach(() => {
    qMock.mockReset();
    q1Mock.mockReset();
    mandarAlertaMock.mockReset();
  });

  it('un sistema sano no llama a mandarAlerta ni escribe en la tabla alertas', async () => {
    medirSano();
    qMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]); // disputas, reembolsos, ventas

    const r = await vigilar(new Date('2026-09-10T20:00:00Z'));

    expect(r).toEqual({ detectadas: 0, mandadas: 0, silenciadas: 0, sinCanal: 0, claves: [] });
    expect(mandarAlertaMock).not.toHaveBeenCalled();
  });

  it('SIN CANAL: una alerta detectada que no se pudo mandar queda en sinCanal y NO se registra', async () => {
    // Este es el caso que reporta el cron real: "detectadas":3,"mandadas":0,
    // "sinCanal":3. Lo que hay que verificar es que la falta de canal no
    // pierda la alerta — se vuelve a intentar en la corrida siguiente porque
    // nunca se escribe en `alertas`.
    medirSano();
    qMock
      .mockResolvedValueOnce([]) // disputas
      .mockResolvedValueOnce([]) // reembolsos
      .mockResolvedValueOnce([]) // ventas
      .mockResolvedValueOnce([]); // select previas de `alertas` (colaQuemada:1 dispara una alerta)

    // Forzamos una sola alerta simple: cola quemada. Se pisa el mock de arriba
    // con uno que sí tiene colaQuemada > 0.
    q1Mock.mockReset();
    q1Mock
      .mockResolvedValueOnce({ ultimo: null, total: '0' })
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce({ total: '0', mas_viejo: null })
      .mockResolvedValueOnce({ quemada: '1', atrasada: '0' })
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce({ intentos: '0', pagados: '0' });

    mandarAlertaMock.mockResolvedValueOnce({
      intentados: 0,
      enviados: 0,
      fallidos: 0,
      motivo: 'sin_token',
      detalle: [],
    });

    const r = await vigilar(new Date('2026-09-10T20:00:00Z'));

    expect(r.detectadas).toBe(1);
    expect(r.sinCanal).toBe(1);
    expect(r.mandadas).toBe(0);
    expect(r.claves).toEqual([]); // no se registró ninguna clave como mandada

    // El INSERT/UPDATE de la tabla `alertas` (el que fija `ultimo_envio_at`)
    // nunca se llamó: solo se llamó `q` para disputas, reembolsos, ventas y el
    // select de previas — CERO escrituras.
    const llamadasDeEscritura = qMock.mock.calls.filter(([sql]) =>
      String(sql).trim().toLowerCase().startsWith('insert'),
    );
    expect(llamadasDeEscritura).toHaveLength(0);
  });

  it('se vuelve a intentar en la corrida siguiente: sin registro previo, debeEnviar sigue dando true', async () => {
    // Consecuencia directa del test anterior: como `sinCanal` no escribe en
    // `alertas`, la siguiente corrida ve `previa = undefined` para esa clave y
    // `debeEnviar` da `true` de nuevo. Es la prueba de que la alerta no se
    // pierde: se re-emite hasta que haya canal.
    expect(debeEnviar(undefined, 'cola_quemada')).toBe(true);
  });

  it('con canal disponible, la alerta se manda y se registra en la tabla alertas', async () => {
    medirSano();
    q1Mock.mockReset();
    q1Mock
      .mockResolvedValueOnce({ ultimo: null, total: '0' })
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce({ total: '0', mas_viejo: null })
      .mockResolvedValueOnce({ quemada: '1', atrasada: '0' })
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce({ intentos: '0', pagados: '0' });

    qMock
      .mockResolvedValueOnce([]) // disputas
      .mockResolvedValueOnce([]) // reembolsos
      .mockResolvedValueOnce([]) // ventas
      .mockResolvedValueOnce([]) // select previas de `alertas`
      .mockResolvedValueOnce([]); // el insert/upsert en `alertas`

    mandarAlertaMock.mockResolvedValueOnce({
      intentados: 1,
      enviados: 1,
      fallidos: 0,
      detalle: [{ chatId: '999', ok: true }],
    });

    const r = await vigilar(new Date('2026-09-10T20:00:00Z'));

    expect(r.mandadas).toBe(1);
    expect(r.sinCanal).toBe(0);
    expect(r.claves).toEqual(['cola_quemada']);

    const insert = qMock.mock.calls.find(([sql]) => String(sql).trim().toLowerCase().startsWith('insert'));
    expect(insert).toBeDefined();
  });

  it('una alerta silenciada (dentro de su ventana) no llama a mandarAlerta', async () => {
    medirSano();
    q1Mock.mockReset();
    q1Mock
      .mockResolvedValueOnce({ ultimo: null, total: '0' })
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce({ total: '0', mas_viejo: null })
      .mockResolvedValueOnce({ quemada: '1', atrasada: '0' })
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce({ intentos: '0', pagados: '0' });

    const ahora = new Date('2026-09-10T20:00:00Z');
    const haceUnaHora = new Date(ahora.getTime() - 60 * 60_000);

    qMock
      .mockResolvedValueOnce([]) // disputas
      .mockResolvedValueOnce([]) // reembolsos
      .mockResolvedValueOnce([]) // ventas
      // previa: cola_quemada ya se mandó hace 1h, y su ventana es 12h -> silenciada
      .mockResolvedValueOnce([{ clave: 'cola_quemada', ultimo_envio_at: haceUnaHora, veces: 1 }]);

    const r = await vigilar(ahora);

    expect(r.detectadas).toBe(1);
    expect(r.silenciadas).toBe(1);
    expect(r.mandadas).toBe(0);
    expect(mandarAlertaMock).not.toHaveBeenCalled();
  });
});
