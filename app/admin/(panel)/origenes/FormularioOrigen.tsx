'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Plus } from '@phosphor-icons/react/ssr';
import { Boton, Campo, Tarjeta, clasesControl } from '@/components/panel/ui';

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
    <Tarjeta className="p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Campo
          etiqueta="Dominio"
          htmlFor="origen-dominio"
          className="min-w-0 flex-1"
          ayuda="Con esquema y sin barra final, como lo manda el navegador en el header Origin."
          error={error ? `No se pudo agregar (${error}).` : null}
        >
          <input
            id="origen-dominio"
            type="text"
            required
            placeholder="https://elfunnel.com"
            value={origen}
            onChange={(e) => setOrigen(e.target.value)}
            className={clasesControl('font-mono')}
          />
        </Campo>

        <Campo etiqueta="Nombre" htmlFor="origen-nombre" opcional className="min-w-0 sm:w-52">
          <input
            id="origen-nombre"
            type="text"
            placeholder="testfunnel"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={clasesControl()}
          />
        </Campo>

        {/* `mt-[1.6rem]` alinea el botón con la línea base de los inputs, no con
            el tope del bloque: las etiquetas de arriba ocupan alto. */}
        <Boton
          type="submit"
          variante="primario"
          disabled={enviando}
          className="sm:mt-[1.6rem]"
          icono={<Plus size={14} weight="bold" aria-hidden="true" />}
        >
          {enviando ? 'Agregando…' : 'Agregar'}
        </Boton>
      </form>
    </Tarjeta>
  );
}
