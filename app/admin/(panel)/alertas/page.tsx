/**
 * `/admin/alertas` — a quién le suena el teléfono cuando algo se rompe, y qué se
 * avisó hasta ahora.
 *
 * Las dos preguntas que contesta y que antes no se podían contestar en ningún
 * lado: quién está recibiendo, y si de verdad le está llegando. No son la misma:
 * alguien puede tener el switch prendido y haber bloqueado el bot.
 */
import { BellRinging, Warning } from '@phosphor-icons/react/ssr';
import { listarDestinatarios, ultimasAlertas } from '../../../../lib/admin/alertas';
import { UMBRALES } from '../../../../lib/alertas';
import {
  Aviso,
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  Insignia,
  SinDato,
  TablaEnvoltorio,
  Tarjeta,
  Td,
  Th,
  Tr,
} from '../../../../components/panel/ui';
import { BotonProbar } from './BotonProbar';
import { ConfiguracionFaltante } from './ConfiguracionFaltante';
import { DiagnosticoBot } from './DiagnosticoBot';
import { EliminarDestinatarioButton } from './EliminarDestinatarioButton';
import { FormularioDestinatario } from './FormularioDestinatario';
import { SwitchDestinatario } from './SwitchDestinatario';

export const dynamic = 'force-dynamic';

function fechaCorta(valor: Date | string | null): string | null {
  if (!valor) return null;
  return new Date(valor).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** El nombre de la clave, en castellano. Las de una sola vez llevan `:<id>`. */
function nombreDeAlerta(clave: string): string {
  const base = clave.split(':')[0];
  const nombres: Record<string, string> = {
    webhook_mudo: 'El webhook de Whop no llega',
    cobros_trabados: 'Cobros sin resolver',
    cola_quemada: 'Ventas que nunca salieron',
    cola_atascada: 'La cola no se drena',
    eventos_con_error: 'Eventos de Whop con error',
    disputa: 'Disputa',
    reembolso: 'Reembolso',
    venta: 'Venta',
  };
  return nombres[base] ?? clave;
}

export default async function AlertasPage(): Promise<JSX.Element> {
  const [destinatarios, alertas] = await Promise.all([listarDestinatarios(), ultimasAlertas(30)]);

  // Se lee en el server component: el token nunca cruza al browser, solo el
  // booleano de si está o no.
  const hayToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const hayAdmin = Boolean(process.env.TELEGRAM_CHAT_ID_ADMIN?.trim());
  const hayCodigo = Boolean(process.env.TELEGRAM_CODIGO_REGISTRO?.trim());
  const hayWebhookSecret = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());
  const activos = destinatarios.filter((d) => d.activo).length;
  const bloqueados = destinatarios.filter((d) => !d.activo && d.ultimo_error?.startsWith('403')).length;

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Alertas"
        descripcion={
          hayToken
            ? `El vigilante revisa cada 15 minutos y avisa por Telegram. ${activos + (hayAdmin ? 1 : 0)} chat(s) reciben.`
            : 'El vigilante revisa cada 15 minutos, pero todavía no hay bot de Telegram configurado.'
        }
        acciones={<BotonProbar />}
      />

      <ConfiguracionFaltante
        hayToken={hayToken}
        hayAdmin={hayAdmin}
        hayCodigo={hayCodigo}
        hayWebhookSecret={hayWebhookSecret}
        hayDestinatarios={activos > 0}
      />

      {hayToken ? <DiagnosticoBot /> : null}

      {bloqueados > 0 ? (
        <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />}>
          {bloqueados} destinatario(s) quedaron en pausa solos porque Telegram devolvió 403: o bloquearon
          el bot, o nunca le hablaron. Telegram no permite que un bot escriba primero — esa persona tiene
          que mandarle <span className="font-mono">/start</span> una vez.
        </Aviso>
      ) : null}

      <Tarjeta className="space-y-3 p-4">
        <h2 className="text-[13px] font-semibold text-tinta">Cómo se conecta alguien</h2>
        <ol className="list-inside list-decimal space-y-1.5 text-[13px] leading-relaxed text-tinta-2">
          <li>Le habla al bot y le manda <Codigo>/start</Codigo>. Sin este paso Telegram no deja que el bot le escriba.</li>
          <li>
            Le manda <Codigo>/alta {hayCodigo ? '<código>' : '<código>'}</Codigo> con el código de registro.
            {!hayCodigo ? (
              <span className="text-alerta">
                {' '}
                Falta <span className="font-mono">TELEGRAM_CODIGO_REGISTRO</span>: hoy el alta por el bot
                está deshabilitada y hay que cargar el chat a mano acá abajo.
              </span>
            ) : null}
          </li>
          <li>Aparece en esta lista. Con <Codigo>/baja</Codigo> se saca solo, y con <Codigo>/estado</Codigo> pregunta cómo viene todo.</li>
        </ol>
        <p className="text-[12px] leading-relaxed text-tinta-3">
          <strong className="font-semibold text-tinta-2">Las ventas las ve todo el mundo.</strong> Lo
          técnico —el webhook caído, la cola atascada, cobros trabados, reembolsos y disputas— va solo a{' '}
          <span className="font-mono">TELEGRAM_CHAT_ID_ADMIN</span> y a quien tenga la columna
          &ldquo;Técnicas&rdquo; prendida. No es privacidad: es que alguien que recibe &ldquo;la cola tiene
          3 filas quemadas&rdquo; aprende a ignorar al bot, y después tampoco lee el aviso de la venta.
        </p>
        <p className="text-[12px] leading-relaxed text-tinta-3">
          Cada alerta se repite como máximo una vez por ventana de silencio, así que un problema abierto
          no manda 96 mensajes por día. La excepción es el webhook caído, que insiste cada 10 minutos
          hasta que se arregle: mientras no llegue, las ventas se registran solo por reconciliación.
          Cobros trabados de más de {UMBRALES.cobroTrabadoMinutos} min y webhook en silencio por más de{' '}
          {UMBRALES.webhookMudoHoras} h.
        </p>
      </Tarjeta>

      <FormularioDestinatario />

      {destinatarios.length === 0 ? (
        <EstadoVacio
          icono={<BellRinging size={20} aria-hidden="true" />}
          titulo="Ningún destinatario todavía"
          descripcion={
            hayAdmin
              ? 'TELEGRAM_CHAT_ID_ADMIN va a recibir igual: es el piso que no se puede borrar desde acá. Esta lista es para el resto del equipo.'
              : 'Ni esta lista ni TELEGRAM_CHAT_ID_ADMIN tienen a nadie. Nadie va a recibir las alertas.'
          }
        />
      ) : (
        <TablaEnvoltorio>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Chat</Th>
              <Th>Ventas</Th>
              <Th>Técnicas</Th>
              <Th>Último aviso entregado</Th>
              <Th>Último error</Th>
              <Th className="text-right">Quitar</Th>
            </tr>
          </thead>
          <tbody>
            {destinatarios.map((d) => (
              <Tr key={d.id}>
                <Td className="font-medium">{d.nombre ?? <SinDato />}</Td>
                <Td>
                  <Codigo>{d.chat_id}</Codigo>
                </Td>
                <Td>
                  <SwitchDestinatario
                    id={d.id}
                    campo="activo"
                    valorInicial={d.activo}
                    nombre={d.nombre ?? d.chat_id}
                    etiquetas={['Recibe', 'En pausa']}
                  />
                </Td>
                <Td>
                  <SwitchDestinatario
                    id={d.id}
                    campo="recibeTecnicas"
                    valorInicial={d.recibe_tecnicas}
                    nombre={d.nombre ?? d.chat_id}
                    etiquetas={['También', 'No']}
                  />
                </Td>
                <Td className="whitespace-nowrap text-tinta-2">{fechaCorta(d.ultimo_ok_at) ?? <SinDato />}</Td>
                <Td className="max-w-[18rem] truncate text-[12px] text-peligro">
                  {d.ultimo_error ?? <SinDato />}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end">
                    <EliminarDestinatarioButton id={d.id} nombre={d.nombre ?? d.chat_id} />
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TablaEnvoltorio>
      )}

      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-tinta">Lo último que se avisó</h2>
        {alertas.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Nada todavía. Esta lista se llena sola: es el historial de qué se rompió, cuándo se detectó
            por primera vez y cuántas veces se repitió.
          </p>
        ) : (
          <TablaEnvoltorio conAltura>
            <thead>
              <tr>
                <Th>Qué</Th>
                <Th>Primera vez</Th>
                <Th>Última</Th>
                <Th numerica>Veces</Th>
                <Th>Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((a) => (
                <Tr key={a.clave}>
                  <Td className="font-medium">{nombreDeAlerta(a.clave)}</Td>
                  <Td className="whitespace-nowrap text-tinta-2">{fechaCorta(a.primer_envio_at)}</Td>
                  <Td className="whitespace-nowrap text-tinta-2">{fechaCorta(a.ultimo_envio_at)}</Td>
                  <Td numerica>
                    {a.veces > 1 ? <Insignia tono="alerta">{a.veces}</Insignia> : a.veces}
                  </Td>
                  <Td className="max-w-[28rem] truncate text-[12px] text-tinta-2">
                    {a.ultimo_detalle ?? <SinDato />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TablaEnvoltorio>
        )}
      </div>
    </div>
  );
}
