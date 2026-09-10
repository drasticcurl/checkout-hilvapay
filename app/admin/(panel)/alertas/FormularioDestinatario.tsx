'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Plus } from '@phosphor-icons/react/ssr';
import { Boton, Campo, Tarjeta, clasesControl } from '@/components/panel/ui';

const ERRORES: Record<string, string> = {
  chat_id_invalido: 'Eso no es un id de chat. Es un número (los de grupo empiezan con "-"), no un @usuario.',
  error_interno: 'No se pudo guardar. Mirá los logs del proceso.',
};

/**
 * Alta manual de un destinatario. La vía cómoda es que la persona le escriba
 * `/alta <código>` al bot; esta existe para el caso en que ya tengas el id (un
 * grupo, o alguien que ya usó `/id`).
 */
export function FormularioDestinatario(): JSX.Element {
  const router = useRouter();
  const [chatId, setChatId] = useState('');
  const [nombre, setNombre] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/alertas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, nombre: nombre.trim() ? nombre : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(ERRORES[data.error as string] ?? `No se pudo agregar (${data.error ?? 'error desconocido'}).`);
        return;
      }
      setChatId('');
      setNombre('');
      router.refresh();
    } catch {
      setError('No se pudo agregar: falló la conexión con el panel.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tarjeta className="p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Campo
          etiqueta="Chat de Telegram"
          htmlFor="destinatario-chat"
          className="min-w-0 flex-1"
          ayuda='El número que devuelve /id en el bot. Los grupos empiezan con "-".'
          error={error}
        >
          <input
            id="destinatario-chat"
            type="text"
            required
            inputMode="numeric"
            placeholder="123456789"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className={clasesControl('font-mono')}
          />
        </Campo>

        <Campo etiqueta="Nombre" htmlFor="destinatario-nombre" opcional className="min-w-0 sm:w-52">
          <input
            id="destinatario-nombre"
            type="text"
            placeholder="Lucho"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={clasesControl()}
          />
        </Campo>

        {/* `mt-[1.6rem]` alinea el botón con los inputs, no con el tope del
            bloque: las etiquetas de arriba ocupan alto. */}
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
