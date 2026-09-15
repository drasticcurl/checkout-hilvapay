'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, CircleNotch, WarningCircle, XCircle } from '@phosphor-icons/react/ssr';
import { Aviso, Codigo, Tarjeta } from '@/components/panel/ui';

type EstadoBot =
  | { configurado: false }
  | { configurado: true; tokenValido: true; bot: { id: number; username: string | null; nombre: string } }
  | { configurado: true; tokenValido: false; error: string };

type EstadoWebhook =
  | { consultado: false }
  | {
      consultado: true;
      ok: true;
      url: string;
      coincideConEsperada: boolean | null;
      pendientes: number;
      ultimoError: string | null;
      ultimoErrorFecha: string | null;
    }
  | { consultado: true; ok: false; error: string };

type Diagnostico = { bot: EstadoBot; webhook: EstadoWebhook };

/**
 * Chequeo de salud del bot: `getMe` y `getWebhookInfo` de la API de Telegram,
 * en vivo. Existe porque el token se puede revocar desde @BotFather sin que
 * nada de este lado se entere hasta que un envío real falla — y para entonces
 * ya se perdió el aviso que importaba.
 *
 * Se consulta al montar y con un botón, no en cada render del panel: son dos
 * llamadas de red a un tercero por cada visita a la pantalla, y esta pantalla
 * la puede abrir cualquiera del equipo solo para ver quién recibe.
 */
export function DiagnosticoBot(): JSX.Element {
  const [estado, setEstado] = useState<Diagnostico | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorRed, setErrorRed] = useState(false);

  async function consultar(): Promise<void> {
    setCargando(true);
    setErrorRed(false);
    try {
      const res = await fetch('/api/admin/alertas/bot', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      setEstado((await res.json()) as Diagnostico);
    } catch {
      setErrorRed(true);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void consultar();
  }, []);

  return (
    <Tarjeta className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-tinta">Salud del bot</h2>
        <button
          type="button"
          onClick={() => void consultar()}
          disabled={cargando}
          className="text-[12px] font-medium text-acento hover:underline disabled:opacity-50"
        >
          {cargando ? 'Consultando…' : 'Volver a chequear'}
        </button>
      </div>

      {cargando && !estado ? (
        <p className="flex items-center gap-2 text-[13px] text-tinta-2">
          <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
          Consultando a Telegram…
        </p>
      ) : errorRed ? (
        <Aviso tono="alerta" icono={<WarningCircle size={16} aria-hidden="true" />}>
          No se pudo consultar: falló la conexión con el panel. Probá de nuevo.
        </Aviso>
      ) : estado ? (
        <div className="space-y-2.5">
          <FilaBot bot={estado.bot} />
          <FilaWebhook webhook={estado.webhook} />
        </div>
      ) : null}
    </Tarjeta>
  );
}

function FilaBot({ bot }: { bot: EstadoBot }): JSX.Element {
  if (!bot.configurado) {
    return (
      <Linea
        icono={<XCircle size={16} className="text-tinta-3" aria-hidden="true" />}
        texto="Sin TELEGRAM_BOT_TOKEN configurado. No hay nada que consultar todavía."
      />
    );
  }
  if (!bot.tokenValido) {
    return (
      <Linea
        icono={<XCircle size={16} className="text-peligro" aria-hidden="true" />}
        texto={
          <>
            El token no es válido: <span className="text-peligro">{bot.error}</span>. Puede que se
            haya revocado desde @BotFather, o que se pegó mal en el entorno.
          </>
        }
      />
    );
  }
  return (
    <Linea
      icono={<CheckCircle size={16} className="text-vivo" aria-hidden="true" />}
      texto={
        <>
          Token válido: <span className="font-medium text-tinta">{bot.bot.nombre}</span>
          {bot.bot.username ? (
            <>
              {' '}
              (<Codigo>@{bot.bot.username}</Codigo>)
            </>
          ) : null}
        </>
      }
    />
  );
}

function FilaWebhook({ webhook }: { webhook: EstadoWebhook }): JSX.Element {
  if (!webhook.consultado) {
    return (
      <Linea
        icono={<XCircle size={16} className="text-tinta-3" aria-hidden="true" />}
        texto="No se puede consultar el webhook sin un token válido."
      />
    );
  }
  if (!webhook.ok) {
    return (
      <Linea
        icono={<XCircle size={16} className="text-peligro" aria-hidden="true" />}
        texto={<>No se pudo consultar getWebhookInfo: {webhook.error}</>}
      />
    );
  }
  if (!webhook.url) {
    return (
      <Linea
        icono={<WarningCircle size={16} className="text-alerta" aria-hidden="true" />}
        texto='Telegram no tiene ningún webhook registrado. Falta correr el "setWebhook" del README.'
      />
    );
  }

  const noCoincide = webhook.coincideConEsperada === false;

  return (
    <div className="space-y-1.5">
      <Linea
        icono={
          noCoincide ? (
            <WarningCircle size={16} className="text-alerta" aria-hidden="true" />
          ) : (
            <CheckCircle size={16} className="text-vivo" aria-hidden="true" />
          )
        }
        texto={
          <>
            Webhook registrado en <Codigo>{webhook.url}</Codigo>
            {noCoincide ? (
              <span className="text-alerta"> — no coincide con NEXT_PUBLIC_BASE_URL. Registralo de nuevo.</span>
            ) : null}
          </>
        }
      />
      {webhook.pendientes > 0 ? (
        <Linea
          icono={<WarningCircle size={16} className="text-alerta" aria-hidden="true" />}
          texto={
            <>
              {webhook.pendientes} update(s) pendientes de entregar
              {webhook.ultimoError ? (
                <>
                  . Último error: <span className="text-peligro">{webhook.ultimoError}</span>
                </>
              ) : null}
            </>
          }
        />
      ) : null}
    </div>
  );
}

function Linea({ icono, texto }: { icono: React.ReactNode; texto: React.ReactNode }): JSX.Element {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-tinta-2">
      <span className="mt-px shrink-0">{icono}</span>
      <span>{texto}</span>
    </p>
  );
}
