'use client';

/**
 * `/admin/login` — un input de password. Nada más, ni logo ni links (§4 del
 * task). Es cliente porque necesita manejar el submit y redirigir sin recargar
 * a mano, pero no lee nada del server: si ya hay sesión, el middleware deja
 * pasar el request y el layout de `(panel)` simplemente resuelve normal.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(false);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      router.push('/admin');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-texto">Contraseña</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
          />
        </label>

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro disabled:opacity-50"
        >
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>

        {error && (
          <p role="alert" className="text-sm text-urgencia">
            Contraseña incorrecta.
          </p>
        )}
      </form>
    </main>
  );
}
