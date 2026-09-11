import { Warning } from '@phosphor-icons/react/ssr';
import { Aviso, Codigo } from '@/components/panel/ui';

/**
 * Qué falta configurar, en el orden en que hace falta hacerlo, con el comando
 * exacto para el paso que lo tiene. Reemplaza al aviso genérico de "falta el
 * bot": antes decía QUE algo faltaba, no QUÉ variable ni de dónde sale.
 *
 * Es un server component leyendo `process.env` directo — mismo criterio que
 * `AlertasPage`: el valor nunca cruza al browser, solo si está presente.
 */
export function ConfiguracionFaltante({
  hayToken,
  hayAdmin,
  hayCodigo,
  hayWebhookSecret,
  hayDestinatarios,
}: {
  hayToken: boolean;
  hayAdmin: boolean;
  hayCodigo: boolean;
  hayWebhookSecret: boolean;
  /** Si hay algún destinatario activo en la tabla, además del env var del admin. */
  hayDestinatarios: boolean;
}): JSX.Element | null {
  const pasos: { variable: string; explicacion: React.ReactNode; comando?: string }[] = [];

  if (!hayToken) {
    pasos.push({
      variable: 'TELEGRAM_BOT_TOKEN',
      explicacion: (
        <>
          Hablale a <Codigo>@BotFather</Codigo> en Telegram, mandale <Codigo>/newbot</Codigo> y seguí las
          preguntas. Al final te da un token con el formato <Codigo>123456:ABC-...</Codigo>. Sin esta
          variable el vigilante detecta los problemas y no puede avisar ninguno.
        </>
      ),
    });
  }

  // El resto depende de tener el token: sin bot no hay a quién pegarle el
  // webhook ni quién entienda el /alta. Se listan igual, en orden, para que la
  // persona sepa qué sigue después de crear el bot.
  if (!hayAdmin) {
    pasos.push({
      variable: 'TELEGRAM_CHAT_ID_ADMIN',
      explicacion: (
        <>
          Con el bot creado, hablale y mandale <Codigo>/id</Codigo> (o pedile a otra persona que lo
          instale y te pase el número). Es el chat que recibe SIEMPRE, incluso con la tabla de
          destinatarios vacía.
        </>
      ),
    });
  }

  if (!hayWebhookSecret) {
    pasos.push({
      variable: 'TELEGRAM_WEBHOOK_SECRET',
      explicacion: (
        <>
          Elegís vos cualquier string largo y random. Autentica los updates que manda Telegram: sin esto
          configurado, <Codigo>/api/telegram/webhook</Codigo> responde 404 y nadie se puede dar de alta
          hablándole al bot.
        </>
      ),
    });
  }

  if (!hayCodigo) {
    pasos.push({
      variable: 'TELEGRAM_CODIGO_REGISTRO',
      explicacion: (
        <>
          También lo elegís vos. Es el código que le pasás a cada persona del equipo para que se dé de
          alta con <Codigo>/alta &lt;código&gt;</Codigo>. Sin esto, el alta por el bot queda deshabilitada
          y hay que cargar cada chat a mano en el formulario de abajo.
        </>
      ),
    });
  }

  // El comando de setWebhook necesita el token Y el secret, así que solo tiene
  // sentido mostrarlo cuando los dos ya están. Si faltara alguno, el comando
  // saldría con un placeholder que invita a copiarlo mal.
  const puedeRegistrarWebhook = hayToken && hayWebhookSecret;
  const urlBase = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || 'https://pay.hilvanapp.com';

  if (pasos.length === 0 && !hayDestinatarios && !hayAdmin) {
    // Caso residual: todo el env está puesto pero nadie se dio de alta todavía.
    // No es una variable que falte, así que no entra en `pasos`, pero sigue
    // siendo un estado sin nadie recibiendo y hay que decirlo.
    return (
      <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />} titulo="Nadie está recibiendo todavía">
        La configuración está completa pero no hay ningún destinatario activo. Hablale al bot,
        mandale <Codigo>/start</Codigo> y después <Codigo>/alta &lt;código&gt;</Codigo> con el valor de{' '}
        <Codigo>TELEGRAM_CODIGO_REGISTRO</Codigo>.
      </Aviso>
    );
  }

  if (pasos.length === 0) return null;

  return (
    <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />} titulo="Falta configurar el bot">
      <div className="space-y-3">
        <p>
          El cron de vigilancia detecta los problemas cada 5 minutos pero no tiene canal por dónde avisar
          (en el log queda como <Codigo>sinCanal</Codigo>). Faltan estas variables en el entorno del
          proceso, en el orden en que conviene resolverlas:
        </p>
        <ol className="list-inside list-decimal space-y-2">
          {pasos.map((p) => (
            <li key={p.variable}>
              <Codigo>{p.variable}</Codigo>
              <span className="ml-1">{p.explicacion}</span>
            </li>
          ))}
        </ol>
        {puedeRegistrarWebhook ? (
          <div className="space-y-1.5">
            <p className="text-[12px] text-tinta-3">
              Token y secret ya están. Falta un paso más, fuera de este panel: registrar la URL contra la
              API de Telegram. Reemplazá <Codigo>&lt;TOKEN&gt;</Codigo> y{' '}
              <Codigo>&lt;SECRET&gt;</Codigo> por los valores reales y corré esto una sola vez:
            </p>
            <pre className="overflow-x-auto rounded-ctrl bg-panel-sup3 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-tinta">
{`curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \\
  -d "url=${urlBase}/api/telegram/webhook" \\
  -d "secret_token=<SECRET>"`}
            </pre>
          </div>
        ) : (
          <p className="text-[12px] text-tinta-3">
            Con el token y el <Codigo>TELEGRAM_WEBHOOK_SECRET</Codigo> puestos, falta un último paso
            (fuera de acá): registrar la URL del webhook contra la API de Telegram. Después de cargar las
            variables hay que recargar PM2 para que el proceso las lea, y esta pantalla lo va a reflejar
            en la sección &ldquo;Salud del bot&rdquo; de más arriba.
          </p>
        )}
      </div>
    </Aviso>
  );
}
