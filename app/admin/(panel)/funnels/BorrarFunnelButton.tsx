'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash, Warning } from '@phosphor-icons/react/ssr';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, unir } from '@/components/panel/ui';

/**
 * Borra un funnel. Pide confirmación siempre (a diferencia del switch, esto no
 * se puede deshacer con otro click): los pasos no se pierden —quedan sueltos,
 * sin funnel—, pero el agrupamiento y las flechas configuradas sí.
 */
export function BorrarFunnelButton({ id, nombre }: { id: string; nombre: string }): JSX.Element {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(false);

  async function borrar(): Promise<void> {
    setBorrando(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/funnels/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmando(false);
        router.refresh();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBorrando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        aria-label={`Borrar el funnel ${nombre}`}
        className={unir(
          'inline-flex h-8 w-8 items-center justify-center rounded-ctrl',
          'text-tinta-3 transition-colors duration-150 hover:bg-peligro-suave hover:text-peligro',
        )}
      >
        <Trash size={15} aria-hidden="true" />
      </button>

      {confirmando ? (
        <Dialogo
          titulo={`Borrar "${nombre}"`}
          onCerrar={() => {
            if (!borrando) setConfirmando(false);
          }}
          ancho="sm"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setConfirmando(false)} disabled={borrando}>
                Cancelar
              </Boton>
              <Boton variante="peligro" onClick={() => void borrar()} disabled={borrando}>
                {borrando ? 'Borrando…' : 'Borrar el funnel'}
              </Boton>
            </>
          }
        >
          <div className="flex gap-3 rounded-ctrl border border-peligro-borde bg-peligro-suave px-3.5 py-3">
            <Warning size={17} className="mt-px shrink-0 text-peligro" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-peligro">
              Se pierden el agrupamiento y las flechas configuradas. No se puede deshacer.
            </p>
          </div>
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Los pasos no se borran: quedan sueltos, sin funnel, y siguen gobernados por su propio
            switch.
          </p>
          {error ? (
            <p role="alert" className="text-[13px] font-medium text-peligro">
              No se pudo borrar. Probá de nuevo.
            </p>
          ) : null}
        </Dialogo>
      ) : null}
    </>
  );
}
