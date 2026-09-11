/**
 * El bot de Telegram. Es el único canal de salida de las alertas.
 *
 * Por qué Telegram y no email: una alerta que llega a un inbox junto a las
 * facturas se lee cuando se lee. La única alerta útil es la que suena en el
 * teléfono, y para eso el bot de Telegram cuesta un token y cero infraestructura
 * — no hay dominio que verificar, ni reputación de remitente, ni un Resend que
 * se cae.
 *
 * ── Nada de acá tira nunca ──────────────────────────────────────────────────
 * Todas las funciones devuelven un resultado y ninguna lanza. Las llama el cron
 * del vigilante, y una excepción mandando el aviso de que la cola está atascada
 * dejaría al cron muerto: el problema original seguiría abierto Y encima nadie se
 * enteraría. Es el mismo criterio que `lib/email.ts`.
 *
 * ── Los dos destinos, y por qué son dos ─────────────────────────────────────
 *   1. `TELEGRAM_CHAT_ID_ADMIN` — el dueño. Env var, no fila de tabla: es el
 *      piso que recibe siempre, incluso con la tabla vacía o recién migrada. Un
 *      DELETE en el panel no puede dejar al sistema sin nadie a quien avisarle.
 *   2. `destinatarios_alerta` activos — el resto del equipo, que se da de alta
 *      desde el panel o hablándole al bot.
 *
 * Si un chat_id aparece en los dos lados, se manda UNA vez (se deduplica por
 * chat_id antes de enviar).
 *
 * ── Las dos audiencias ──────────────────────────────────────────────────────
 *   `equipo` → las ventas. Las ve todo el mundo.
 *   `admin`  → lo técnico. Solo el chat del env var y los destinatarios con
 *              `recibe_tecnicas`.
 *
 * La razón no es privacidad, es que el canal siga sirviendo: un vendedor que
 * recibe "la cola de salidas tiene 3 filas quemadas" aprende a ignorar al bot, y
 * entonces tampoco lee el mensaje de la venta.
 */
import { q } from './db';

const TIMEOUT_MS = 10_000;

/** Quién tiene que recibir un mensaje. */
export type Audiencia = 'equipo' | 'admin';

/** Un destinatario ya resuelto, listo para recibir. */
export type Destino = {
  chatId: string;
  /** El id de la fila en `destinatarios_alerta`, o null si vino del env var. */
  id: string | null;
  nombre: string | null;
};

export type ResultadoEnvio = {
  chatId: string;
  ok: boolean;
  /** El motivo cuando `ok` es false. Ya recortado, listo para loguear. */
  error?: string;
  /** true si el chat quedó desactivado por este envío (bot bloqueado). */
  desactivado?: boolean;
};

export type ResultadoMensaje = {
  intentados: number;
  enviados: number;
  fallidos: number;
  /** El motivo por el que no se intentó nada. Presente solo si `intentados` es 0. */
  motivo?: string;
  detalle: ResultadoEnvio[];
};

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/**
 * Escapa el texto para `parse_mode: 'HTML'`.
 *
 * Hace falta de verdad, no es higiene teórica: los mensajes de alerta interpolan
 * `failure_message` y `ultimo_error`, que vienen de Whop y del panel. Un error
 * que contenga un `<` deja el mensaje mal formado y Telegram responde 400
 * `can't parse entities` — o sea, la alerta se pierde justo cuando el texto
 * traía el detalle más raro, que es cuando más se necesita.
 *
 * Son los tres caracteres que pide la doc de Telegram para HTML, en ese orden
 * (el `&` primero, si no se re-escaparían los `&lt;` recién creados).
 */
export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Los chats a los que hay que mandar, según la audiencia. El admin del env var
 * primero, y sin repetir un chat_id que además esté en la tabla.
 *
 * Para `admin` se filtra por `recibe_tecnicas` en el SQL y no en JS: así una fila
 * que no corresponde no llega ni a salir de la base.
 */
export async function destinos(audiencia: Audiencia = 'equipo'): Promise<Destino[]> {
  const lista: Destino[] = [];
  const vistos = new Set<string>();

  const admin = process.env.TELEGRAM_CHAT_ID_ADMIN?.trim();
  if (admin) {
    lista.push({ chatId: admin, id: null, nombre: 'admin (env var)' });
    vistos.add(admin);
  }

  const filas = await q<{ id: string; chat_id: string; nombre: string | null }>(
    `select id, chat_id, nombre
       from destinatarios_alerta
      where activo
        and ($1 = 'equipo' or recibe_tecnicas)
      order by created_at asc`,
    [audiencia],
  );

  for (const f of filas) {
    if (vistos.has(f.chat_id)) continue;
    vistos.add(f.chat_id);
    lista.push({ chatId: f.chat_id, id: f.id, nombre: f.nombre });
  }

  return lista;
}

/**
 * Manda un mensaje a un solo chat. `parse_mode: 'HTML'` — el texto ya tiene que
 * venir escapado con `escaparHtml` en las partes variables.
 *
 * `disable_web_page_preview`: un mensaje con una URL genera una tarjeta de
 * previsualización que ocupa media pantalla del teléfono. En una alerta, el
 * espacio es el texto.
 */
export async function mandarA(chatId: string, texto: string): Promise<ResultadoEnvio> {
  const t = token();
  if (!t) return { chatId, ok: false, error: 'sin_token' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });

    if (res.ok) return { chatId, ok: true };

    const cuerpo = await res.text().catch(() => '');
    const error = `${res.status} ${cuerpo.slice(0, 200)}`;

    // 403 = "bot was blocked by the user" o "chat not found". No es transitorio:
    // reintentarlo cada 15 minutos para siempre llena el log de ruido y, peor,
    // hace que cada corrida del vigilante se reporte como fallida aunque los
    // demás destinatarios sí hayan recibido. Se desactiva la fila y se sigue.
    //
    // El chat del env var no se puede desactivar (no tiene fila): ese caso se
    // loguea y listo, porque desactivar al dueño automáticamente sería
    // exactamente el silencio que este módulo existe para evitar.
    const desactivar = res.status === 403;
    return { chatId, ok: false, error, desactivado: desactivar };
  } catch (err) {
    // Timeout o red caída. Telegram no es crítico para cobrar: se anota y sigue.
    const motivo = err instanceof Error ? err.message : String(err);
    return { chatId, ok: false, error: `red: ${motivo}` };
  }
}

/**
 * Manda el mensaje a todos los destinos de esa audiencia.
 *
 * `Promise.all` y no un `for` secuencial: son dos o tres chats y el vigilante
 * corre dentro del presupuesto de un cron. Con cinco destinatarios y un timeout
 * de 10 s cada uno, en serie serían 50 s de peor caso.
 */
export async function mandarAlerta(
  texto: string,
  audiencia: Audiencia = 'equipo',
): Promise<ResultadoMensaje> {
  if (!token()) {
    // Sin token no hay nada que hacer, y no es un error: el módulo tiene que
    // poder deployarse antes de que exista el bot.
    return { intentados: 0, enviados: 0, fallidos: 0, motivo: 'sin_token', detalle: [] };
  }

  const lista = await destinos(audiencia);
  if (lista.length === 0) {
    return { intentados: 0, enviados: 0, fallidos: 0, motivo: 'sin_destinatarios', detalle: [] };
  }

  const detalle = await Promise.all(lista.map((d) => mandarA(d.chatId, texto)));

  // El estado de cada destinatario se anota DESPUÉS de mandar, no antes: así
  // `ultimo_error` refleja lo que pasó de verdad y el panel puede mostrar
  // "bloqueó el bot" en vez de dejar a alguien pensando que le llegan avisos.
  await Promise.all(
    detalle.map(async (r, i) => {
      const destino = lista[i];
      if (!destino.id) return; // el admin del env var no tiene fila que actualizar
      if (r.ok) {
        await q(
          'update destinatarios_alerta set ultimo_ok_at = now(), ultimo_error = null where id = $1',
          [destino.id],
        ).catch(() => {});
        return;
      }
      await q(
        `update destinatarios_alerta
            set ultimo_error = $2,
                activo = case when $3 then false else activo end
          where id = $1`,
        [destino.id, r.error ?? 'error desconocido', r.desactivado === true],
      ).catch(() => {});
    }),
  );

  const enviados = detalle.filter((r) => r.ok).length;
  return {
    intentados: detalle.length,
    enviados,
    fallidos: detalle.length - enviados,
    detalle,
  };
}

// ── Diagnóstico del bot ──────────────────────────────────────────────────────
//
// Esto no lo llama el vigilante ni ningún cron: es para que una persona mirando
// /admin/alertas pueda contestar "¿el token es válido? ¿el webhook está
// registrado y apunta adonde tiene que apuntar?" sin salir del panel ni pegarle
// a `api.telegram.org` a mano desde una terminal.

export type EstadoBot =
  | { configurado: false }
  | {
      configurado: true;
      tokenValido: true;
      bot: { id: number; username: string | null; nombre: string };
    }
  | {
      configurado: true;
      tokenValido: false;
      error: string;
    };

/** Lo que importa de `getWebhookInfo`, recortado a lo que el panel necesita mostrar. */
export type EstadoWebhook =
  | { consultado: false }
  | {
      consultado: true;
      ok: true;
      url: string;
      /** Si hay una URL registrada pero no es la esperada (dominio viejo, http en vez de https). */
      coincideConEsperada: boolean | null;
      pendientes: number;
      ultimoError: string | null;
      ultimoErrorFecha: string | null;
    }
  | {
      consultado: true;
      ok: false;
      error: string;
    };

export type DiagnosticoBot = {
  bot: EstadoBot;
  webhook: EstadoWebhook;
};

/**
 * `getMe`: si el token es válido y, de yapa, con qué username. Es el primer
 * chequeo porque si esto falla no tiene sentido preguntar por el webhook — un
 * token inválido no tiene ningún webhook "suyo" que consultar.
 *
 * Nunca tira: devuelve el motivo en el propio tipo, para que la ruta que llama
 * a esto no necesite un try/catch alrededor.
 */
export async function consultarBot(): Promise<EstadoBot> {
  const t = token();
  if (!t) return { configurado: false };

  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getMe`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { id: number; username?: string; first_name?: string };
    } | null;

    if (!res.ok || !data?.ok || !data.result) {
      // Telegram devuelve 401 con un `description` legible ("Unauthorized") para
      // un token inválido o revocado. Se recorta igual que en `mandarA`.
      const motivo = data?.description ?? `${res.status}`;
      return { configurado: true, tokenValido: false, error: motivo.slice(0, 200) };
    }

    return {
      configurado: true,
      tokenValido: true,
      bot: {
        id: data.result.id,
        username: data.result.username ?? null,
        nombre: data.result.first_name ?? 'sin nombre',
      },
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    return { configurado: true, tokenValido: false, error: `red: ${motivo}` };
  }
}

/**
 * Compara la URL que Telegram tiene registrada contra la que este servicio
 * espera. `null` cuando no hay ninguna esperada configurada (no se puede saber
 * si "coincide" con nada) — así el llamador no confunde "no coincide" con "no se
 * pudo verificar".
 *
 * Pura, para poder probarla sin red: la exporta el módulo pero no depende de
 * nada que no sean sus dos strings.
 */
export function coincideWebhook(urlRegistrada: string, urlEsperada: string | null): boolean | null {
  if (!urlEsperada) return null;
  // Sin barra final y sin mayúsculas/minúsculas: Telegram devuelve la URL tal
  // cual se registró, y una barra de más no es una configuración distinta.
  const normalizar = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
  return normalizar(urlRegistrada) === normalizar(urlEsperada);
}

/**
 * `getWebhookInfo`: si Telegram tiene un webhook registrado, a qué URL, y si
 * viene fallando. `pending_update_count > 0` con `last_error_message` presente
 * es la firma de "el endpoint está devolviendo error y Telegram sigue
 * reintentando" — la misma clase de problema que resuelve `payment.created`
 * para Whop, pero del lado de Telegram.
 *
 * La URL esperada es `NEXT_PUBLIC_BASE_URL` + `/api/telegram/webhook`, la misma
 * que documenta el README. No hace falta un env var nuevo para esto.
 */
export async function consultarWebhook(): Promise<EstadoWebhook> {
  const t = token();
  if (!t) return { consultado: false };

  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getWebhookInfo`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: {
        url?: string;
        pending_update_count?: number;
        last_error_message?: string;
        last_error_date?: number;
      };
    } | null;

    if (!res.ok || !data?.ok || !data.result) {
      const motivo = data?.description ?? `${res.status}`;
      return { consultado: true, ok: false, error: motivo.slice(0, 200) };
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL?.trim() || null;
    const esperada = base ? `${base.replace(/\/+$/, '')}/api/telegram/webhook` : null;
    const url = data.result.url ?? '';

    return {
      consultado: true,
      ok: true,
      url,
      coincideConEsperada: url ? coincideWebhook(url, esperada) : null,
      pendientes: data.result.pending_update_count ?? 0,
      ultimoError: data.result.last_error_message ?? null,
      ultimoErrorFecha: data.result.last_error_date
        ? new Date(data.result.last_error_date * 1000).toISOString()
        : null,
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    return { consultado: true, ok: false, error: `red: ${motivo}` };
  }
}

/**
 * Los dos chequeos juntos, en paralelo. Es lo único que llama la ruta del panel:
 * así esa ruta no decide el orden ni tiene que acordarse de pedir los dos.
 */
export async function diagnosticarBot(): Promise<DiagnosticoBot> {
  const [bot, webhook] = await Promise.all([consultarBot(), consultarWebhook()]);
  return { bot, webhook };
}
