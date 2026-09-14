'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash, Warning } from '@phosphor-icons/react/ssr';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, unir } from '@/components/panel/ui';

type Props = {
  id: string;
  nombre: string;
  /** true si el producto tiene alguna variante — cambia el texto de la advertencia. */
  tieneVariantes: boolean;
};

const MENSAJE_POR_ERROR: Record<string, string> = {
  tiene_links: 'Este producto tiene al menos un link de pago apuntándole. Desactivalo en su lugar, o borrá primero sus links.',
  tiene_cobros: 'Este producto tiene cobros históricos. No se puede borrar sin perder ese historial — desactivalo en su lugar.',
  no_encontrado: 'Ya no existe. Recargá la pantalla.',
};

/**
 * Borra un producto de verdad — a diferencia del switch de activo, esto no se
 * puede deshacer. Solo funciona si el producto no tiene ningún link de pago
 * ni ningún cobro histórico (`borrarProducto`, `lib/admin/productos.ts`): si
 * tiene alguno, el servidor devuelve 409 con el motivo y este componente lo
 * muestra en vez de un error genérico, señalando que desactivar es la
 * alternativa segura.
 */
export function BorrarProductoButton({ id, nombre, tieneVariantes }: Props): JSX.Element {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function borrar(): Promise<void> {
    setBorrando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/productos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmando(false);
        router.push('/admin/productos');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(MENSAJE_POR_ERROR[data.error as string] ?? 'No se pudo borrar. Probá de nuevo.');
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setBorrando(false);
    }
  }

  return (
    <>
      <Boton
        variante="fantasma"
        tamano="sm"
        icono={<Trash size={13} aria-hidden="true" />}
        onClick={() => setConfirmando(true)}
      >
        Borrar producto
      </Boton>

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
                {borrando ? 'Borrando…' : 'Borrar el producto'}
              </Boton>
            </>
          }
        >
          <div className="flex gap-3 rounded-ctrl border border-peligro-borde bg-peligro-suave px-3.5 py-3">
            <Warning size={17} className="mt-px shrink-0 text-peligro" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-peligro-oscuro">
              No se puede deshacer. {tieneVariantes ? 'Se borran también todas sus variantes de precio.' : ''}
            </p>
          </div>
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Solo funciona si el producto no tiene ningún link de pago ni ningún cobro histórico. Si
            los tiene, desactivalo desde el switch en vez de borrarlo — así no se pierde nada.
          </p>
          {error ? (
            <p role="alert" className="text-[13px] font-medium text-peligro">
              {error}
            </p>
          ) : null}
        </Dialogo>
      ) : null}
    </>
  );
}
