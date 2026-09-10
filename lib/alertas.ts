/**
 * El vigilante: qué se considera "algo salió mal" y cuándo se avisa.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * El módulo ya escribía correctamente todo lo que fallaba: `whop_eventos.error`,
 * `salidas.ultimo_error`, `salidas.intentos`, `cobros.status`,
 * `cobros.disputa_at`. Lo que no había era nadie que lo leyera. El modo de falla
 * era "te enterás cuando el comprador reclama", y hay fallas que ningún
 * comprador reclama: una venta que no llegó al dashboard, una disputa con plazo
 * de respuesta, un cron muerto.
 *
 * ── La forma del archivo ────────────────────────────────────────────────────
 * `medir()` toca la base y `evaluar()` no toca nada. Están separadas a propósito:
 * los umbrales y la decisión de qué es grave son la parte que hay que poder
 * probar sin una base con datos sintéticos, y son también la parte que se va a
 * tocar cuando una alerta resulte ruidosa.
 *
 * ── La regla del ruido ──────────────────────────────────────────────────────
 * El vigilante corre cada 15 minutos. Sin dedupe, un problema que dura un día
 * manda 96 mensajes iguales, y a la tercera la persona silencia el bot: el
 * sistema queda PEOR que sin alertas, porque ahora hay un canal en el que nadie
 * confía. Por eso cada alerta tiene una ventana de silencio y el registro vive en
 * la tabla `alertas`.
 */
import { q, q1 } from './db';
import { MAX_INTENTOS } from './salidas';
import { escaparHtml, mandarAlerta } from './telegram';

/**
 * `grave`  → hay plata o un plazo en juego ahora mismo.
 * `aviso`  → algo está degradado; si sigue así mañana es grave.
 * `info`   → no es un problema (una venta). Va por el mismo canal porque un bot
 *            que solo trae malas noticias es un bot que se silencia.
 */
export type Gravedad = 'grave' | 'aviso' | 'info';

export type Alerta = {
  /** Clave semántica y estable. Es la PK de `alertas` y lo que deduplica. */
  clave: string;
  gravedad: Gravedad;
  titulo: string;
  /** Una o dos líneas con el número y qué hacer. Ya escapado para HTML. */
  detalle: string;
};

/** Los umbrales, todos juntos y en un solo lugar para poder discutirlos. */
export const UMBRALES = {
  /** Horas sin recibir un webhook antes de sospechar. Whop apaga a las 72 h. */
  webhookMudoHoras: 6,
  /** Minutos que un cobro puede quedarse sin resolver antes de ser un problema. */
  cobroTrabadoMinutos: 45,
  /** Minutos de atraso de la cola antes de asumir que el cron está muerto. */
  colaAtascadaMinutos: 15,
  /** Ventana en la que se buscan disputas, reembolsos y ventas nuevas. */
  novedadesHoras: 24,
  /** Tope de avisos individuales por corrida. El resto entra en la siguiente. */
  maxNovedadesPorCorrida: 10,
} as const;

/**
 * Cuánto silencio después de mandar una alerta, por clave.
 *
 * `cola_atascada` tiene la ventana más corta (1 h) porque significa que el cron
 * no corre: es la única falla que se agrava sola con el tiempo, porque la cola
 * sigue creciendo. Las de una sola vez (disputa, reembolso, venta) tienen 30
 * días, que en la práctica es "nunca se repite": la ventana de detección es de
 * 24 h, así que el evento sale de la ventana mucho antes de que el silencio
 * expire.
 */
export const SILENCIO_MINUTOS: Record<string, number> = {
  webhook_mudo: 12 * 60,
  cobros_trabados: 6 * 60,
  cola_quemada: 12 * 60,
  cola_atascada: 60,
  eventos_con_error: 12 * 60,
};

/** El silencio de las claves con sufijo (`disputa:<id>`), y el default. */
const SILENCIO_POR_PREFIJO: Record<string, number> = {
  disputa: 30 * 24 * 60,
  reembolso: 30 * 24 * 60,
  venta: 30 * 24 * 60,
};

const SILENCIO_DEFAULT_MINUTOS = 6 * 60;

export function silencioDe(clave: string): number {
  const exacta = SILENCIO_MINUTOS[clave];
  if (exacta !== undefined) return exacta;
  const prefijo = clave.split(':')[0];
  return SILENCIO_POR_PREFIJO[prefijo] ?? SILENCIO_DEFAULT_MINUTOS;
}

// ── Lo que se mide ───────────────────────────────────────────────────────────

/** Una novedad puntual (una venta, un reembolso, una disputa). */
export type Novedad = {
  cobroId: string;
  monto: string | null;
  moneda: string | null;
  email: string | null;
  producto: string;
  slug: string;
};

/**
 * La foto del sistema en un momento. Es la entrada de `evaluar`, y todo lo que
 * `evaluar` necesita: no hay ninguna consulta escondida del otro lado.
 */
export type Sintomas = {
  /** El webhook más reciente que llegó, de cualquier tipo. */
  ultimoEventoAt: Date | null;
  /** Cuántos webhooks se recibieron en toda la vida del sistema. */
  eventosTotales: number;
  /** Cobros creados dentro de la ventana de `webhookMudoHoras`. Es la señal de que HAY tráfico. */
  cobrosEnLaVentana: number;
  /** Cobros sin resolver de más de `cobroTrabadoMinutos`. */
  cobrosTrabados: number;
  cobroTrabadoMasViejoAt: Date | null;
  /** Filas de `salidas` que agotaron los reintentos y nunca se mandaron. */
  colaQuemada: number;
  /** Filas de `salidas` vencidas hace más de `colaAtascadaMinutos`. */
  colaAtrasada: number;
  /** Eventos de Whop que quedaron con error y sin procesar. */
  eventosConError: number;
  disputas: Novedad[];
  reembolsos: Novedad[];
  ventas: Novedad[];
};

const COLS_NOVEDAD = `c.id as "cobroId", c.monto, c.moneda, o.email,
       pr.nombre as producto, pg.slug`;

const JOIN_NOVEDAD = `from cobros c
       join ordenes o on o.id = c.orden_id
       join paginas pg on pg.id = c.pagina_id
       join productos pr on pr.id = c.producto_id`;

/** Toma la foto. Una consulta por síntoma, todas en paralelo. */
export async function medir(): Promise<Sintomas> {
  const horas = UMBRALES.webhookMudoHoras;
  const novedades = UMBRALES.novedadesHoras;
  const tope = UMBRALES.maxNovedadesPorCorrida;

  const [eventos, cobrosVentana, trabados, cola, eventosError, disputas, reembolsos, ventas] =
    await Promise.all([
      q1<{ ultimo: Date | null; total: string }>(
        'select max(recibido_at) as ultimo, count(*)::text as total from whop_eventos',
      ),
      q1<{ total: string }>(
        `select count(*)::text as total from cobros where created_at > now() - ($1 || ' hours')::interval`,
        [String(horas)],
      ),
      q1<{ total: string; mas_viejo: Date | null }>(
        `select count(*)::text as total, min(created_at) as mas_viejo
           from cobros
          where status in ('creando', 'procesando')
            and created_at < now() - ($1 || ' minutes')::interval`,
        [String(UMBRALES.cobroTrabadoMinutos)],
      ),
      q1<{ quemada: string; atrasada: string }>(
        `select
            count(*) filter (where intentos >= $1)::text as quemada,
            count(*) filter (
              where intentos < $1 and proximo_intento_at < now() - ($2 || ' minutes')::interval
            )::text as atrasada
           from salidas
          where enviado_at is null`,
        [MAX_INTENTOS, String(UMBRALES.colaAtascadaMinutos)],
      ),
      q1<{ total: string }>(
        'select count(*)::text as total from whop_eventos where error is not null and procesado_at is null',
      ),
      q<Novedad>(
        `select ${COLS_NOVEDAD} ${JOIN_NOVEDAD}
          where c.disputa_at > now() - ($1 || ' hours')::interval
          order by c.disputa_at desc limit $2`,
        [String(novedades), tope],
      ),
      q<Novedad>(
        `select ${COLS_NOVEDAD} ${JOIN_NOVEDAD}
          where c.reembolsado_at > now() - ($1 || ' hours')::interval
          order by c.reembolsado_at desc limit $2`,
        [String(novedades), tope],
      ),
      q<Novedad>(
        `select ${COLS_NOVEDAD} ${JOIN_NOVEDAD}
          where c.status = 'pagado'
            and c.reembolsado_at is null
            and c.updated_at > now() - ($1 || ' hours')::interval
          order by c.updated_at desc limit $2`,
        [String(novedades), tope],
      ),
    ]);

  return {
    ultimoEventoAt: eventos?.ultimo ?? null,
    eventosTotales: Number(eventos?.total ?? 0),
    cobrosEnLaVentana: Number(cobrosVentana?.total ?? 0),
    cobrosTrabados: Number(trabados?.total ?? 0),
    cobroTrabadoMasViejoAt: trabados?.mas_viejo ?? null,
    colaQuemada: Number(cola?.quemada ?? 0),
    colaAtrasada: Number(cola?.atrasada ?? 0),
    eventosConError: Number(eventosError?.total ?? 0),
    disputas,
    reembolsos,
    ventas,
  };
}

// ── La decisión ──────────────────────────────────────────────────────────────

function horasDesde(fecha: Date, ahora: Date): number {
  return (ahora.getTime() - new Date(fecha).getTime()) / 3_600_000;
}

function plata(n: Novedad): string {
  if (n.monto == null) return 'sin monto';
  return `${Number(n.monto).toFixed(2)} ${(n.moneda ?? '').toUpperCase()}`.trim();
}

/**
 * Traduce la foto a alertas. Pura: no toca base, ni red, ni `Date.now()`.
 *
 * El `ahora` entra por parámetro porque si no, los tests de "hace 7 horas que no
 * llega un webhook" tendrían que jugar con el reloj del sistema.
 */
export function evaluar(s: Sintomas, ahora: Date = new Date()): Alerta[] {
  const alertas: Alerta[] = [];

  // ── El webhook dejó de llegar ──────────────────────────────────────────────
  //
  // Las dos condiciones importan. Sin la segunda, un deploy nuevo (0 eventos, 0
  // cobros, webhook todavía sin configurar) alertaría cada 12 horas para siempre
  // por algo que no es una falla: es un sistema que todavía no arrancó. Y sin la
  // primera, una tarde sin ventas parecería una caída.
  //
  // Traducido: se alerta si el webhook FUNCIONÓ alguna vez y se calló, o si hubo
  // cobros en la ventana y ningún webhook los acompañó.
  const horasSinEvento = s.ultimoEventoAt ? horasDesde(s.ultimoEventoAt, ahora) : null;
  const funcionóYSeCalló =
    s.eventosTotales > 0 && horasSinEvento !== null && horasSinEvento >= UMBRALES.webhookMudoHoras;
  const huboCobrosSinWebhook = s.eventosTotales === 0 && s.cobrosEnLaVentana > 0;

  if (funcionóYSeCalló || huboCobrosSinWebhook) {
    alertas.push({
      clave: 'webhook_mudo',
      gravedad: 'grave',
      titulo: 'El webhook de Whop no está llegando',
      detalle: funcionóYSeCalló
        ? `Último evento recibido hace ${Math.floor(horasSinEvento!)} h. ` +
          'Whop deshabilita un endpoint que falla 72 h seguidas y NO reenvía los eventos de ese período. ' +
          'Revisá Developer → Webhooks en el dashboard y que Cloudflare no esté desafiando el path.'
        : `${s.cobrosEnLaVentana} cobro(s) en las últimas ${UMBRALES.webhookMudoHoras} h y ningún webhook recibido nunca. ` +
          'Probablemente el webhook todavía no apunta acá.',
    });
  }

  // ── Cobros que no se resuelven ─────────────────────────────────────────────
  if (s.cobrosTrabados > 0) {
    const antiguedad = s.cobroTrabadoMasViejoAt
      ? ` El más viejo lleva ${Math.floor(horasDesde(s.cobroTrabadoMasViejoAt, ahora))} h.`
      : '';
    alertas.push({
      clave: 'cobros_trabados',
      gravedad: 'grave',
      titulo: `${s.cobrosTrabados} cobro(s) sin resolver`,
      detalle:
        `Llevan más de ${UMBRALES.cobroTrabadoMinutos} min en 'creando' o 'procesando'.${antiguedad} ` +
        'La reconciliación debería haberlos cerrado: si siguen así, o el cron no corre o Whop no responde. ' +
        'Puede haber alguien que pagó y no recibió nada.',
    });
  }

  // ── La cola ────────────────────────────────────────────────────────────────
  if (s.colaQuemada > 0) {
    alertas.push({
      clave: 'cola_quemada',
      gravedad: 'grave',
      titulo: `${s.colaQuemada} venta(s) que nunca salieron`,
      detalle:
        `Agotaron los ${MAX_INTENTOS} reintentos de la cola 'salidas' y no se van a reintentar más. ` +
        'Es una venta cobrada que no llegó al dashboard o un email de entrega que no se mandó.',
    });
  }

  if (s.colaAtrasada > 0) {
    alertas.push({
      clave: 'cola_atascada',
      gravedad: 'grave',
      titulo: 'La cola no se está drenando',
      detalle:
        `${s.colaAtrasada} fila(s) vencidas hace más de ${UMBRALES.colaAtascadaMinutos} min. ` +
        'El cron del minuto no está corriendo. Mirá /var/log/hilvapay/salidas.log.',
    });
  }

  if (s.eventosConError > 0) {
    alertas.push({
      clave: 'eventos_con_error',
      gravedad: 'aviso',
      titulo: `${s.eventosConError} evento(s) de Whop con error`,
      detalle:
        'Quedaron sin procesar. Se pueden reintentar con "Send event" desde el dashboard de Whop. ' +
        'El detalle está en whop_eventos.error.',
    });
  }

  // ── Novedades, una alerta por cada una ─────────────────────────────────────
  //
  // La clave lleva el id del cobro: así cada disputa avisa UNA vez y no se
  // mezcla con la siguiente. Una alerta agregada ("hay 3 disputas") avisaría de
  // la segunda y la tercera solo si el contador cambia justo cuando se mira.
  for (const d of s.disputas) {
    alertas.push({
      clave: `disputa:${d.cobroId}`,
      gravedad: 'grave',
      titulo: 'Disputa nueva',
      detalle:
        `${plata(d)} — ${escaparHtml(d.producto)} (${escaparHtml(d.slug)})\n` +
        `Comprador: ${escaparHtml(d.email ?? 'sin email')}\n` +
        'Una disputa tiene plazo de respuesta y la resuelve una persona: entrá al dashboard de Whop.',
    });
  }

  for (const r of s.reembolsos) {
    alertas.push({
      clave: `reembolso:${r.cobroId}`,
      gravedad: 'aviso',
      titulo: 'Reembolso',
      detalle: `${plata(r)} — ${escaparHtml(r.producto)} (${escaparHtml(r.slug)})\nComprador: ${escaparHtml(r.email ?? 'sin email')}`,
    });
  }

  if (avisarVentas()) {
    for (const v of s.ventas) {
      alertas.push({
        clave: `venta:${v.cobroId}`,
        gravedad: 'info',
        titulo: 'Venta',
        detalle: `${plata(v)} — ${escaparHtml(v.producto)} (${escaparHtml(v.slug)})\n${escaparHtml(v.email ?? 'sin email')}`,
      });
    }
  }

  return alertas;
}

/**
 * El aviso de venta se puede apagar con `TELEGRAM_AVISAR_VENTAS=0`.
 *
 * Viene encendido por default y es la única cosa de este archivo que no es una
 * falla: un canal que solo trae malas noticias se silencia, y un canal
 * silenciado no sirve para las que sí importan. Con volumen alto se apaga.
 */
function avisarVentas(): boolean {
  const v = process.env.TELEGRAM_AVISAR_VENTAS?.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

// ── El dedupe ────────────────────────────────────────────────────────────────

export type AlertaPrevia = { clave: string; ultimo_envio_at: Date; veces: number };

/**
 * Si esta alerta se puede mandar de nuevo. Pura.
 *
 * Nunca mandada → sí. Mandada hace más que su ventana de silencio → sí.
 */
export function debeEnviar(
  previa: AlertaPrevia | undefined | null,
  clave: string,
  ahora: Date = new Date(),
): boolean {
  if (!previa) return true;
  const minutos = (ahora.getTime() - new Date(previa.ultimo_envio_at).getTime()) / 60_000;
  return minutos >= silencioDe(clave);
}

const EMOJI: Record<Gravedad, string> = { grave: '🔴', aviso: '🟡', info: '💰' };

/**
 * El texto que se manda. HTML de Telegram, que solo soporta un subconjunto
 * chico de tags — `<b>` y `<code>` alcanzan y son los que no se rompen.
 *
 * Las partes variables ya vienen escapadas de `evaluar`; el título es literal
 * del código salvo los números.
 */
export function formatearMensaje(alerta: Alerta, veces: number): string {
  const repetida = veces > 1 ? `\n<code>se repite: ${veces}ª vez</code>` : '';
  return `${EMOJI[alerta.gravedad]} <b>${escaparHtml(alerta.titulo)}</b>\n\n${alerta.detalle}${repetida}`;
}

// ── La corrida ───────────────────────────────────────────────────────────────

export type ResultadoVigilancia = {
  detectadas: number;
  mandadas: number;
  silenciadas: number;
  sinCanal: number;
  claves: string[];
};

/**
 * Mide, evalúa, deduplica y manda. Es lo único que llama el cron.
 *
 * El registro en `alertas` se escribe DESPUÉS de mandar y solo si algún
 * destinatario recibió: si Telegram está caído, la alerta no queda marcada como
 * enviada y se vuelve a intentar en la próxima corrida. Al revés, una alerta
 * marcada sin haber llegado es un problema que se pierde por 12 horas.
 */
export async function vigilar(ahora: Date = new Date()): Promise<ResultadoVigilancia> {
  const sintomas = await medir();
  const alertas = evaluar(sintomas, ahora);

  const resultado: ResultadoVigilancia = {
    detectadas: alertas.length,
    mandadas: 0,
    silenciadas: 0,
    sinCanal: 0,
    claves: [],
  };

  if (alertas.length === 0) return resultado;

  const previas = await q<AlertaPrevia>(
    `select clave, ultimo_envio_at, veces from alertas where clave = any($1::text[])`,
    [alertas.map((a) => a.clave)],
  );
  const porClave = new Map(previas.map((p) => [p.clave, p]));

  for (const alerta of alertas) {
    const previa = porClave.get(alerta.clave);
    if (!debeEnviar(previa, alerta.clave, ahora)) {
      resultado.silenciadas++;
      continue;
    }

    const veces = (previa?.veces ?? 0) + 1;
    const envio = await mandarAlerta(formatearMensaje(alerta, veces));

    if (envio.enviados === 0) {
      // Sin canal (falta el token, no hay destinatarios, Telegram caído): NO se
      // registra, así se reintenta en la próxima corrida. Se loguea para que
      // quede en el log del cron aunque no haya llegado a ningún teléfono.
      resultado.sinCanal++;
      console.warn(
        `[alertas] ${alerta.clave}: no se pudo avisar (${envio.motivo ?? `${envio.fallidos} fallidos`}) — ${alerta.titulo}`,
      );
      continue;
    }

    await q(
      `insert into alertas (clave, ultimo_detalle)
       values ($1, $2)
       on conflict (clave) do update
          set ultimo_envio_at = now(),
              veces = alertas.veces + 1,
              ultimo_detalle = excluded.ultimo_detalle`,
      [alerta.clave, `${alerta.titulo} — ${alerta.detalle}`.slice(0, 1000)],
    );

    resultado.mandadas++;
    resultado.claves.push(alerta.clave);
  }

  return resultado;
}
