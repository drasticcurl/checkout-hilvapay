'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function FormularioOrigen(): JSX.Element {
  const router = useRouter();
  const [origen, setOrigen] = useState('');
  const [nombre, setNombre] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/origenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origen, nombre: nombre.trim() ? nombre : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'error_desconocido');
        return;
      }
      setOrigen('');
      setNombre('');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="block text-sm font-medium text-texto">Dominio</span>
        <input
          type="text"
          required
          placeholder="https://elfunnel.com"
          value={origen}
          onChange={(e) => setOrigen(e.target.value)}
          className="mt-1.5 w-64 rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-texto">Nombre (opcional)</span>
        <input
          type="text"
          placeholder="testfunnel"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="mt-1.5 w-48 rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>
      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-comprar px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro disabled:opacity-50"
      >
        {enviando ? 'Agregando…' : 'Agregar'}
      </button>
      {error && <p role="alert" className="text-sm text-urgencia">No se pudo agregar ({error}).</p>}
    </form>
  );
}
