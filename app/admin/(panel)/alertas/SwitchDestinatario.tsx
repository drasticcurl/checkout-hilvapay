'use client';

import { useState } from 'react';
import { Interruptor } from '@/components/panel/ui';

/**
 * Los dos switches de un destinatario de alertas: si recibe algo, y si además
 * recibe lo técnico.
 *
 * NO reusa `SwitchActivo` a propósito, aunque el PATCH sea parecido: ese
 * componente pide confirmación al encender y muestra el estado como
 * "Cobrando / Apagado", porque gobierna links que cobran tarjetas. Acá encender
 * significa "que le suene el teléfono": no hay nada que confirmar, y llamarlo
 * "Cobrando" sería mentir en la única pantalla que existe para saber quién está
 * recibiendo los avisos.
 */
export function SwitchDestinatario({
  id,
  campo,
  valorInicial,
  nombre,
  etiquetas,
}: {
  id: string;
  /** Qué campo mueve: `activo` (recibe algo) o `recibeTecnicas`. */
  campo: 'activo' | 'recibeTecnicas';
  valorInicial: boolean;
  nombre: string;
  /** Cómo se lee el estado. `[prendido, apagado]`. */
  etiquetas: [string, string];
}): JSX.Element {
  const [valor, setValor] = useState(valorInicial);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  async function cambiar(nuevo: boolean): Promise<void> {
    if (cargando) return;
    setCargando(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/alertas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Un campo por request: así un PATCH no puede pisar el otro switch.
        body: JSON.stringify({ [campo]: nuevo }),
      });
      if (res.ok) setValor(nuevo);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2.5">
      <Interruptor
        activo={valor}
        onCambiar={(v) => void cambiar(v)}
        etiquetaAccesible={`${valor ? 'Desactivar' : 'Activar'} ${etiquetas[0].toLowerCase()} para ${nombre}`}
      />
      <span
        className={
          valor ? 'text-[12px] font-medium text-vivo-oscuro' : 'text-[12px] font-medium text-tinta-3'
        }
      >
        {valor ? etiquetas[0] : etiquetas[1]}
      </span>
      {error ? (
        <span role="alert" className="text-[11px] font-medium text-peligro">
          No se pudo cambiar
        </span>
      ) : null}
    </div>
  );
}
