'use client';

import { useState } from 'react';
import { Interruptor } from '@/components/panel/ui';

/**
 * Pausa o reactiva a un destinatario de alertas.
 *
 * NO reusa `SwitchActivo` a propósito, aunque el PATCH sea idéntico: ese
 * componente pide confirmación al encender y muestra el estado como
 * "Cobrando / Apagado", porque gobierna links que cobran tarjetas. Acá encender
 * significa "que le suene el teléfono": no hay nada que confirmar, y llamarlo
 * "Cobrando" sería mentir en la única pantalla que existe para saber quién está
 * recibiendo los avisos.
 */
export function SwitchDestinatario({
  id,
  activo,
  nombre,
}: {
  id: string;
  activo: boolean;
  nombre: string;
}): JSX.Element {
  const [valor, setValor] = useState(activo);
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
        body: JSON.stringify({ activo: nuevo }),
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
        etiquetaAccesible={valor ? `Pausar los avisos a ${nombre}` : `Reactivar los avisos a ${nombre}`}
      />
      <span className={valor ? 'text-[12px] font-medium text-vivo-oscuro' : 'text-[12px] font-medium text-tinta-3'}>
        {valor ? 'Recibe' : 'En pausa'}
      </span>
      {error ? (
        <span role="alert" className="text-[11px] font-medium text-peligro">
          No se pudo cambiar
        </span>
      ) : null}
    </div>
  );
}
