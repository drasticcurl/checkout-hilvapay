'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react/ssr';
import { unir } from '@/components/panel/ui';

/**
 * Botón de copiar la URL completa del link de pago. Existe porque el usuario
 * va a pegar esto en el funnel: si tiene que armar la URL a mano a partir del
 * slug, en algún momento la va a escribir mal.
 *
 * El ícono cambia a un tilde por 1.5s. Es feedback de una acción que no deja
 * ninguna otra huella en pantalla: sin esto no hay forma de saber si funcionó.
 */
export function CopiarUrlButton({ url }: { url: string }): JSX.Element {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sin esto, copiar y navegar antes de los 1.5s deja un setState apuntando a un
  // componente desmontado.
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin permiso de clipboard (http sin TLS, por ejemplo) no hay fallback
      // razonable: el usuario ve el texto de la URL igual y lo puede
      // seleccionar a mano.
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={copiado ? 'URL copiada' : 'Copiar la URL'}
      className={unir(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-micro',
        'transition-[background-color,color] duration-150',
        copiado ? 'text-vivo' : 'text-tinta-3 hover:bg-panel-sup2 hover:text-tinta',
      )}
    >
      {copiado ? <Check size={13} weight="bold" /> : <Copy size={13} />}
    </button>
  );
}
