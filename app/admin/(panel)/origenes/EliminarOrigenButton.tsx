'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function EliminarOrigenButton({ id, origen }: { id: string; origen: string }): JSX.Element {
  const router = useRouter();
  const [eliminando, setEliminando] = useState(false);

  async function eliminar(): Promise<void> {
    if (!window.confirm(`¿Eliminar "${origen}" de la lista de orígenes autorizados?`)) return;
    setEliminando(true);
    try {
      await fetch(`/api/admin/origenes/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setEliminando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={eliminar}
      disabled={eliminando}
      className="text-sm font-medium text-urgencia hover:underline disabled:opacity-50"
    >
      Eliminar
    </button>
  );
}
