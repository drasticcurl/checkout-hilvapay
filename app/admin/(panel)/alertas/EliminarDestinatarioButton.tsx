'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash } from '@phosphor-icons/react/ssr';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, unir } from '@/components/panel/ui';

/**
 * Saca un destinatario de la lista.
 *
 * Confirma, aunque no sea destructivo para los datos: el efecto es que a alguien
 * dejan de sonarle las alertas y no hay ningún síntoma visible de eso hasta el
 * próximo incidente. Para dejar de recibir sin perder la fila está el switch de
 * pausa.
 */
export function EliminarDestinatarioButton({
  id,
  nombre,
}: {
  id: string;
  nombre: string;
}): JSX.Element {
  const router = useRouter();
  const [eliminando, setEliminando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function eliminar(): Promise<void> {
    setEliminando(true);
    try {
      await fetch(`/api/admin/alertas/${id}`, { method: 'DELETE' });
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
        aria-label={`Quitar ${nombre} de los destinatarios`}
        className={unir(
          'inline-flex h-8 w-8 items-center justify-center rounded-ctrl',
          'text-tinta-3 transition-colors duration-150 hover:bg-peligro-suave hover:text-peligro',
        )}
      >
        <Trash size={15} aria-hidden="true" />
      </button>

      {confirmando ? (
        <Dialogo
          titulo="Quitar el destinatario"
          descripcion="Deja de recibir los avisos de ventas y de fallas."
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
            A <span className="font-medium text-tinta">{nombre}</span> no le va a llegar más ningún aviso.
            Puede volver a darse de alta hablándole al bot.
          </p>
        </Dialogo>
      ) : null}
    </>
  );
}
