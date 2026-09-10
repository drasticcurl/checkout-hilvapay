'use client';

import { useState } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react/ssr';
import { Aviso, Boton } from '@/components/panel/ui';

type Detalle = { chatId: string; ok: boolean; error?: string };
type Resultado = {
  intentados: number;
  enviados: number;
  fallidos: number;
  motivo?: string;
  detalle: Detalle[];
};

const MOTIVOS: Record<string, string> = {
  sin_token: 'Falta TELEGRAM_BOT_TOKEN en el entorno del proceso. Cargala y recargá PM2.',
  sin_destinatarios: 'No hay ningún chat activo, ni TELEGRAM_CHAT_ID_ADMIN configurado.',
};

/**
 * Manda un mensaje real a todos los destinatarios activos.
 *
 * Muestra el resultado POR CHAT y no un "ok" global: el modo de falla típico es
 * que llegue a uno y no a otro (alguien que nunca le habló al bot, un id mal
 * pegado), y un resumen global esconde justamente eso.
 */
export function BotonProbar(): JSX.Element {
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function probar(): Promise<void> {
    setCargando(true);
    setResultado(null);
    try {
      const res = await fetch('/api/admin/alertas/probar', { method: 'POST' });
      setResultado((await res.json()) as Resultado);
    } catch {
      setResultado({
        intentados: 0,
        enviados: 0,
        fallidos: 0,
        motivo: 'sin_respuesta_del_panel',
        detalle: [],
      });
    } finally {
      setCargando(false);
    }
  }

  const fallidos = resultado?.detalle.filter((d) => !d.ok) ?? [];

  return (
    <div className="space-y-3">
      <Boton
        variante="secundario"
        onClick={() => void probar()}
        disabled={cargando}
        icono={<PaperPlaneTilt size={15} aria-hidden="true" />}
      >
        {cargando ? 'Mandando…' : 'Mandar una prueba'}
      </Boton>

      {resultado ? (
        <Aviso
          rol="status"
          tono={resultado.enviados > 0 && resultado.fallidos === 0 ? 'vivo' : 'alerta'}
          titulo={
            resultado.intentados === 0
              ? 'No se mandó nada'
              : `Llegó a ${resultado.enviados} de ${resultado.intentados}`
          }
        >
          {resultado.motivo ? <p>{MOTIVOS[resultado.motivo] ?? resultado.motivo}</p> : null}

          {fallidos.length > 0 ? (
            <ul className="space-y-1">
              {fallidos.map((d) => (
                <li key={d.chatId}>
                  <span className="font-mono">{d.chatId}</span>: {d.error ?? 'error desconocido'}
                  {d.error?.startsWith('403') ? (
                    <>
                      {' '}
                      — Telegram no deja que un bot escriba primero. Esa persona tiene que mandarle{' '}
                      <span className="font-mono">/start</span> al bot una vez.
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Aviso>
      ) : null}
    </div>
  );
}
