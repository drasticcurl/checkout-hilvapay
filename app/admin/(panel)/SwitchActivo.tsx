'use client';

import { useState } from 'react';
import { Warning } from '@phosphor-icons/react/ssr';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, unir } from '@/components/panel/ui';

/**
 * Switch de activo, para páginas, productos, funnels y orígenes.
 *
 * Pide confirmación SOLO al encender (D14): apagar siempre es seguro — es el
 * freno de emergencia que corta el cobro al instante — y una confirmación ahí
 * sería fricción en el único momento en que la fricción cuesta plata. Encender
 * es lo que empieza a cobrar tarjetas de verdad.
 *
 * Antes esa confirmación era un `window.confirm`. El diálogo propio conserva la
 * misma regla y la misma puerta: `aplicar(true)` se llama únicamente desde el
 * botón de confirmar. El click sobre el switch, cuando va a encender, no manda
 * ningún PATCH — solo abre el diálogo.
 */
export function SwitchActivo({
  id,
  activo,
  endpoint,
  mensajeConfirmacion,
  etiqueta,
}: {
  id: string;
  activo: boolean;
  /** Base del endpoint PATCH, sin el id: `/api/admin/paginas`. */
  endpoint: string;
  mensajeConfirmacion: string;
  /** Qué se está encendiendo, para el título del diálogo. */
  etiqueta?: string;
}): JSX.Element {
  const [valor, setValor] = useState(activo);
  const [cargando, setCargando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(false);

  async function aplicar(nuevoValor: boolean): Promise<void> {
    setCargando(true);
    setError(false);
    try {
      const res = await fetch(`${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: nuevoValor }),
      });
      if (res.ok) {
        setValor(nuevoValor);
        setConfirmando(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }

  function alAlternar(): void {
    if (cargando) return;
    if (!valor) {
      // Va a encender: abre el diálogo y no manda nada todavía.
      setConfirmando(true);
      return;
    }
    void aplicar(false);
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={valor}
        onClick={alAlternar}
        disabled={cargando}
        className={unir(
          'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full',
          'transition-[background-color,box-shadow] duration-200 disabled:opacity-50',
          valor ? 'bg-vivo shadow-panel' : 'bg-panel-sup3 hover:bg-tinta-4',
        )}
      >
        <span className="sr-only">{valor ? 'Cobrando, apagar' : 'Apagado, encender'}</span>
        <span
          className={unir(
            'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-panel transition-transform duration-200',
            valor ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>

      {error ? (
        <span role="alert" className="text-[11px] font-medium text-peligro">
          No se pudo cambiar
        </span>
      ) : null}

      {confirmando ? (
        <Dialogo
          titulo={etiqueta ? `Encender ${etiqueta}` : 'Encender el cobro'}
          onCerrar={() => {
            if (!cargando) setConfirmando(false);
          }}
          ancho="sm"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setConfirmando(false)} disabled={cargando}>
                Cancelar
              </Boton>
              <Boton variante="vivo" onClick={() => void aplicar(true)} disabled={cargando}>
                {cargando ? 'Encendiendo…' : 'Encender'}
              </Boton>
            </>
          }
        >
          <div className="flex gap-3 rounded-ctrl border border-alerta-borde bg-alerta-suave px-3.5 py-3">
            <Warning size={17} className="mt-px shrink-0 text-alerta" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-alerta">{mensajeConfirmacion}</p>
          </div>
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Se puede apagar de nuevo desde este mismo switch, al instante y sin deploy.
          </p>
        </Dialogo>
      ) : null}
    </div>
  );
}
