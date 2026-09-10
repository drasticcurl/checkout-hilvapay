'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Borra un funnel. Pide confirmación siempre (a diferencia del switch, esto no
 * se puede deshacer con otro click): los pasos no se pierden —quedan sueltos,
 * sin funnel—, pero el agrupamiento y las flechas configuradas sí.
 */
export function BorrarFunnelButton({ id, nombre }: { id: string; nombre: string }): JSX.Element {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);

  async function borrar(): Promise<void> {
    if (!window.confirm(`¿Borrar el funnel "${nombre}"? Los pasos quedan sueltos, sin funnel.`)) return;
    setBorrando(true);
    try {
      const res = await fetch(`/api/admin/funnels/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBorrando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={borrar}
      disabled={borrando}
      className="text-sm font-medium text-urgencia hover:underline disabled:opacity-50"
    >
      {borrando ? 'Borrando…' : 'Borrar'}
    </button>
  );
}
