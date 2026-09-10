'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash } from '@phosphor-icons/react/ssr';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, unir } from '@/components/panel/ui';

/**
 * Quita un dominio de la allowlist. Confirma siempre: el efecto no se ve acá
 * sino en el funnel, donde el botón de upsell empieza a devolver 403 sin más
 * síntoma que una venta que no entra.
 */
export function EliminarOrigenButton({ id, origen }: { id: string; origen: string }): JSX.Element {
  const router = useRouter();
  const [eliminando, setEliminando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function eliminar(): Promise<void> {
    setEliminando(true);
    try {
      await fetch(`/api/admin/origenes/${id}`, { method: 'DELETE' });
      setConfirmando(false);
      router.refresh();
    } finally {
      setEliminando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        aria-label={`Quitar ${origen} de la lista`}
        className={unir(
          'inline-flex h-8 w-8 items-center justify-center rounded-ctrl',
          'text-tinta-3 transition-colors duration-150 hover:bg-peligro-suave hover:text-peligro',
        )}
      >
        <Trash size={15} aria-hidden="true" />
      </button>

      {confirmando ? (
        <Dialogo
          titulo="Quitar el origen"
          descripcion="Se saca de la allowlist de CORS del cobro one-click."
          onCerrar={() => {
            if (!eliminando) setConfirmando(false);
          }}
          ancho="sm"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setConfirmando(false)} disabled={eliminando}>
                Cancelar
              </Boton>
              <Boton variante="peligro" onClick={() => void eliminar()} disabled={eliminando}>
                {eliminando ? 'Quitando…' : 'Quitar'}
              </Boton>
            </>
          }
        >
          <p className="text-[13px] leading-relaxed text-tinta-2">
            El botón de upsell alojado en{' '}
            <span className="font-mono text-tinta">{origen}</span> va a recibir{' '}
            <span className="font-mono font-semibold text-tinta">403</span> en cuanto intente cobrar.
            Podés volver a agregarlo cuando quieras.
          </p>
        </Dialogo>
      ) : null}
    </>
  );
}
