'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Botón de salir: pega al logout y navega a `/admin/login`. Sin confirmación — salir nunca la pide. */
export function CerrarSesionButton(): JSX.Element {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir(): Promise<void> {
    setSaliendo(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={saliendo}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-texto-suave transition-colors hover:bg-gray-100 hover:text-texto disabled:opacity-50"
    >
      {saliendo ? 'Saliendo…' : 'Salir'}
    </button>
  );
}
