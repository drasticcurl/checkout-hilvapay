'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react/ssr';
import { unir } from '@/components/panel/ui';

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
      className={unir(
        'inline-flex items-center gap-1.5 rounded-ctrl px-2 py-1.5 text-[13px] font-medium',
        'text-tinta-2 transition-colors duration-150 hover:bg-panel-sup2 hover:text-tinta',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <SignOut size={15} aria-hidden="true" />
      <span className="hidden sm:inline">{saliendo ? 'Saliendo…' : 'Salir'}</span>
    </button>
  );
}
