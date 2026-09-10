'use client';

import { useState } from 'react';

/**
 * Botón de copiar la URL completa del link de pago. Existe porque el usuario
 * va a pegar esto en el funnel: si tiene que armar la URL a mano a partir del
 * slug, en algún momento la va a escribir mal.
 */
export function CopiarUrlButton({ url }: { url: string }): JSX.Element {
  const [copiado, setCopiado] = useState(false);

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
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
      className="rounded-md border border-borde px-2 py-1 text-xs font-medium text-texto-suave transition-colors hover:bg-gray-100"
    >
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}
