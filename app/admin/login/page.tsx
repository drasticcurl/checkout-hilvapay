'use client';

/**
 * `/admin/login` — una contraseña y nada más. Sin links ni recuperación: no hay
 * cuentas, hay una clave. Es cliente porque maneja el submit y redirige sin
 * recargar a mano, pero no lee nada del server: si ya hay sesión, el middleware
 * deja pasar el request y el layout de `(panel)` resuelve normal.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Warning } from '@phosphor-icons/react/ssr';
import { Boton, Campo, clasesControl } from '@/components/panel/ui';

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
    <main className="flex min-h-[100dvh] items-center justify-center bg-panel-fondo px-4 py-12">
      <div className="w-full max-w-[22rem] animate-aparecer-abajo">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-ctrl bg-tinta text-lg font-semibold leading-none text-white shadow-panel-md"
          >
            h
          </span>
          <div className="space-y-1">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-tinta">
              hilvana <span className="font-normal text-tinta-3">/ pagos</span>
            </h1>
            <p className="text-[13px] text-tinta-2">Entrá para ver y encender los links de cobro.</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-6 space-y-4 rounded-card border border-panel-borde bg-panel-sup p-5 shadow-panel-md"
        >
          <Campo etiqueta="Contraseña" htmlFor="password">
            <input
              id="password"
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={clasesControl(undefined, 'lg')}
            />
          </Campo>

          <Boton type="submit" variante="primario" tamano="lg" disabled={enviando} className="w-full">
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </Boton>

          {error ? (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-ctrl border border-peligro-borde bg-peligro-suave px-3 py-2 text-[13px] font-medium text-peligro-oscuro"
            >
              <Warning size={15} className="shrink-0" aria-hidden="true" />
              Contraseña incorrecta.
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
