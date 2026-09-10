'use client';

import { useState } from 'react';

/**
 * Switch de activo, para páginas, productos y orígenes.
 *
 * Pide confirmación SOLO al encender (D14): apagar siempre es seguro — es el
 * freno de emergencia que corta el cobro al instante — y una confirmación ahí
 * sería fricción sin ganancia. Encender es lo que empieza a cobrar tarjetas de
 * verdad, así que antes de mandar el PATCH se pide un `window.confirm` con el
 * mensaje que indique cada pantalla.
 */
export function SwitchActivo({
  id,
  activo,
  endpoint,
  mensajeConfirmacion,
}: {
  id: string;
  activo: boolean;
  /** Base del endpoint PATCH, sin el id: `/api/admin/paginas`. */
  endpoint: string;
  mensajeConfirmacion: string;
}): JSX.Element {
  const [valor, setValor] = useState(activo);
  const [cargando, setCargando] = useState(false);

  async function alternar(): Promise<void> {
    const nuevoValor = !valor;
    if (nuevoValor && !window.confirm(mensajeConfirmacion)) {
      return;
    }
    setCargando(true);
    try {
      const res = await fetch(`${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: nuevoValor }),
      });
      if (res.ok) setValor(nuevoValor);
    } finally {
      setCargando(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={valor}
      onClick={alternar}
      disabled={cargando}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        valor ? 'bg-comprar' : 'bg-gray-300'
      }`}
    >
      <span className="sr-only">{valor ? 'Activo' : 'Inactivo'}</span>
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          valor ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
