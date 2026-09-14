/**
 * POST /api/telegram/webhook — el bot habla, para que cada persona se registre
 * sola.
 *
 * ── Por qué existe, si el panel ya tiene la pantalla ────────────────────────
 * Porque el `chat_id` de Telegram no está a la vista en ningún lado. Pedirle a
 * alguien "andá a un bot de terceros, conseguí tu id numérico y pegámelo" es la
 * clase de paso que no se completa. Acá la persona le escribe `/alta <código>` al
 * bot y ya está: el `chat_id` lo trae el propio update.
 *
 * ── Cómo se conecta ─────────────────────────────────────────────────────────
 *   1. Crear el bot con @BotFather y guardar el token en `TELEGRAM_BOT_TOKEN`.
 *   2. Elegir dos secretos y ponerlos en el env: `TELEGRAM_WEBHOOK_SECRET`
 *      (autentica a Telegram contra nosotros) y `TELEGRAM_CODIGO_REGISTRO` (lo
 *      que le pasás a la persona que querés que reciba alertas).
 *   3. Registrar el webhook una sola vez:
 *
 *        curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *          -d "url=https://pay.hilvanapp.com/api/telegram/webhook" \
 *          -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *
 * ── Las dos decisiones de seguridad ─────────────────────────────────────────
 *  · El header `X-Telegram-Bot-Api-Secret-Token` es lo único que autentica el
 *    request. Sin `TELEGRAM_WEBHOOK_SECRET` configurada este endpoint devuelve
 *    404 y no hace nada: nace inerte, no abierto.
 *  · El alta exige `TELEGRAM_CODIGO_REGISTRO`. Sin eso, cualquiera que encuentre
 *    el bot se suscribe a los avisos de venta del negocio — que incluyen montos y
 *    emails de compradores.
 *
 * Responde SIEMPRE 200. Telegram reintenta ante cualquier otra cosa, y un
 * reintento de `/alta` no rompe nada (el upsert es idempotente) pero llena el log.
 * La respuesta usa el formato de "método en el body", así que contestarle a la
 * persona no cuesta un segundo request.
 */
import { NextResponse } from 'next/server';
import { q, q1 } from '@/lib/db';
import { escaparHtml } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Un update de Telegram, recortado a lo que se usa. */
type Update = {
  message?: {
    chat?: { id?: number | string; type?: string };
    from?: { first_name?: string; username?: string };
    text?: string;
  };
};

/**
 * Responder con el método adentro del body: Telegram lo ejecuta como si
 * hubiéramos llamado a `sendMessage`. Un request menos y, sobre todo, una forma
 * menos de que la respuesta se pierda si la API de Telegram está lenta.
 */
function responder(chatId: string, texto: string): NextResponse {
  return NextResponse.json({
    method: 'sendMessage',
    chat_id: chatId,
    text: texto,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

const AYUDA =
  'Soy el bot de avisos de <b>hilvapay</b>.\n\n' +
  '<b>/alta &lt;código&gt;</b> — empezar a recibir los avisos\n' +
  '<b>/baja</b> — dejar de recibirlos\n' +
  '<b>/id</b> — ver el id de este chat\n' +
  '<b>/estado</b> — cómo viene todo ahora\n\n' +
  'El código lo da el dueño del negocio.';

/**
 * El saludo de `/start` muestra el chat_id ya resuelto, para que quien lo
 * necesite (por ejemplo, para pegarlo en `TELEGRAM_CHAT_ID_ADMIN`) no tenga que
 * mandar un segundo comando. `/help` y `/ayuda` se quedan con el texto genérico
 * de comandos, sin repetir el id en cada llamada.
 */
function bienvenida(chat: string): string {
  return (
    'Hola! Soy el bot de avisos de <b>hilvapay</b>.\n\n' +
    `Tu chat id para poner es: <code>${escaparHtml(chat)}</code>\n\n` +
    '<b>/alta &lt;código&gt;</b> — empezar a recibir los avisos\n' +
    '<b>/baja</b> — dejar de recibirlos\n' +
    '<b>/estado</b> — cómo viene todo ahora\n\n' +
    'El código lo da el dueño del negocio.'
  );
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  // Sin secreto configurado el endpoint no existe. 404 y no 500: no le confirma
  // a nadie que la ruta está ahí esperando que la configuren.
  if (!secret) return new NextResponse('Not found', { status: 404 });

  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    console.warn('[telegram] update rechazado: secret token incorrecto');
    return new NextResponse('Not found', { status: 404 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const mensaje = update.message;
  const chatId = mensaje?.chat?.id;
  const texto = mensaje?.text?.trim();

  // Updates que no son mensajes de texto (una foto, alguien que entra a un
  // grupo): 200 y nada más. No es un error.
  if (chatId === undefined || chatId === null || !texto) {
    return NextResponse.json({ ok: true });
  }

  const chat = String(chatId);
  const quien =
    mensaje?.from?.username ? `@${mensaje.from.username}` : (mensaje?.from?.first_name ?? null);

  // El comando es la primera palabra, sin el `@bot` que Telegram le pega en los
  // grupos (`/alta@mibot`).
  const [crudo, ...resto] = texto.split(/\s+/);
  const comando = crudo.toLowerCase().split('@')[0];
  const argumento = resto.join(' ').trim();

  switch (comando) {
    case '/start':
      return responder(chat, bienvenida(chat));

    case '/help':
    case '/ayuda':
      return responder(chat, AYUDA);

    case '/id':
      return responder(chat, `El id de este chat es <code>${escaparHtml(chat)}</code>.`);

    case '/alta': {
      const codigo = process.env.TELEGRAM_CODIGO_REGISTRO?.trim();
      if (!codigo) {
        return responder(chat, 'El alta por el bot no está habilitada. Pedile al dueño que te agregue desde el panel.');
      }
      if (argumento !== codigo) {
        // Mismo mensaje para "sin código" y "código equivocado": no se le dice a
        // quien está probando si le faltó el argumento o si erró el valor.
        console.warn(`[telegram] alta rechazada para el chat ${chat} (${quien ?? 'sin nombre'})`);
        return responder(chat, 'Código incorrecto. Pedíselo al dueño del negocio.');
      }

      // Upsert: si la persona ya estaba pero se había dado de baja, el alta la
      // reactiva y limpia el último error. Sin el `do update`, un `/alta`
      // repetido chocaría contra el índice único y no haría nada, dejándola
      // convencida de que se registró.
      await q(
        `insert into destinatarios_alerta (chat_id, nombre, activo)
         values ($1, $2, true)
         on conflict (chat_id) do update
            set activo = true,
                nombre = coalesce(destinatarios_alerta.nombre, excluded.nombre),
                ultimo_error = null`,
        [chat, quien],
      );
      console.log(`[telegram] alta: chat ${chat} (${quien ?? 'sin nombre'})`);
      return responder(
        chat,
        'Listo. Te voy a avisar acá cuando entre una venta y cuando algo falle.\n\n' +
          'Para dejar de recibirlos: <b>/baja</b>',
      );
    }

    case '/baja': {
      await q('update destinatarios_alerta set activo = false where chat_id = $1', [chat]);
      return responder(chat, 'Hecho, no te aviso más. Con <b>/alta &lt;código&gt;</b> volvés a activarlo.');
    }

    case '/estado': {
      // Solo para quien ya está dado de alta o para el dueño. Este comando
      // devuelve el pulso del negocio (cobros trabados, cola, ventas): no es
      // información para cualquiera que encuentre el bot.
      const esAdmin = process.env.TELEGRAM_CHAT_ID_ADMIN?.trim() === chat;
      const alta = await q1<{ id: string }>(
        'select id from destinatarios_alerta where chat_id = $1 and activo',
        [chat],
      );
      if (!esAdmin && !alta) {
        return responder(chat, 'Primero date de alta con <b>/alta &lt;código&gt;</b>.');
      }

      // Import dinámico: `lib/alertas.ts` arrastra `lib/salidas.ts` y las
      // consultas de medición, y este endpoint se llama en cada mensaje que
      // reciba el bot. Que /start no pague ese costo.
      const { medir, UMBRALES } = await import('@/lib/alertas');
      const s = await medir();

      const lineas = [
        `<b>Estado de hilvapay</b>`,
        ``,
        `Ventas (${UMBRALES.novedadesHoras} h): <b>${s.ventas.length}</b>`,
        `Cobros sin resolver: <b>${s.cobrosTrabados}</b>`,
        `Cola atrasada: <b>${s.colaAtrasada}</b> · quemada: <b>${s.colaQuemada}</b>`,
        `Eventos de Whop con error: <b>${s.eventosConError}</b>`,
        `Reembolsos (${UMBRALES.novedadesHoras} h): <b>${s.reembolsos.length}</b> · disputas: <b>${s.disputas.length}</b>`,
        ``,
        s.ultimoEventoAt
          ? `Último webhook: ${escaparHtml(new Date(s.ultimoEventoAt).toISOString().replace('T', ' ').slice(0, 16))} UTC`
          : 'Todavía no llegó ningún webhook de Whop.',
      ];

      return responder(chat, lineas.join('\n'));
    }

    default:
      return responder(chat, AYUDA);
  }
}
