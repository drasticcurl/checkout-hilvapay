'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react/ssr';
import { unir } from './ui';

const FOCUSABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * El diálogo del panel. Reemplaza a los `fixed inset-0` sueltos que había en
 * cada pantalla, que se veían bien pero no se podían cerrar con teclado.
 *
 * Lo que hace y que no hacía ninguno de los anteriores:
 *   · Escape cierra.
 *   · Tab cicla adentro del diálogo y no se escapa al fondo.
 *   · Al abrir, el foco entra; al cerrar, vuelve al elemento que lo abrió.
 *   · El body no scrollea por detrás.
 *
 * La animación de entrada está justificada: aparece una capa nueva encima de la
 * pantalla y el desplazamiento de 8px dice de dónde salió. Colapsa a instantánea
 * con `prefers-reduced-motion` (globals.css).
 */
export function Dialogo({
  titulo,
  descripcion,
  onCerrar,
  children,
  pie,
  ancho = 'md',
}: {
  titulo: string;
  descripcion?: ReactNode;
  onCerrar: () => void;
  children?: ReactNode;
  pie?: ReactNode;
  ancho?: 'sm' | 'md' | 'lg';
}): JSX.Element {
  const contenedorRef = useRef<HTMLDivElement>(null);
  // El handler vive en una ref para que el efecto no se re-suscriba cada vez que
  // el padre re-renderiza con una closure nueva.
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  useEffect(() => {
    const nodo = contenedorRef.current;
    const activoPrevio = document.activeElement as HTMLElement | null;

    // Si un hijo trae `autoFocus`, React ya lo enfocó y no se le roba el foco.
    // Si no, el foco va al contenedor: entrar apuntando a un botón destructivo
    // convierte un Enter distraído en una acción.
    if (nodo && !nodo.contains(document.activeElement)) nodo.focus();

    function alPresionar(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrarRef.current();
        return;
      }
      if (e.key !== 'Tab' || !nodo) return;
      const items = Array.from(nodo.querySelectorAll<HTMLElement>(FOCUSABLES)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const primero = items[0];
      const ultimo = items[items.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }

    document.addEventListener('keydown', alPresionar);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', alPresionar);
      document.body.style.overflow = overflowPrevio;
      activoPrevio?.focus?.();
    };
  }, []);

  const anchos = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' };

  return (
    <div className="fixed inset-0 z-overlay flex items-center justify-center p-4">
      {/* Velo. Es un div y no un button: el rol de "cerrar" ya lo cubren Escape y
          la X, que sí son alcanzables con teclado. */}
      <div
        aria-hidden="true"
        onClick={onCerrar}
        className="absolute inset-0 animate-aparecer-velo bg-tinta/40 backdrop-blur-[2px]"
      />
      <div
        ref={contenedorRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className={unir(
          'relative z-dialog max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-card',
          'border border-panel-borde bg-panel-sup shadow-panel-lg animate-aparecer-dialogo focus:outline-none',
          anchos[ancho],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0 space-y-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-tinta">{titulo}</h2>
            {descripcion ? (
              <p className="text-[13px] leading-relaxed text-tinta-2">{descripcion}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-ctrl text-tinta-3 transition-colors hover:bg-panel-sup2 hover:text-tinta"
          >
            <X size={16} />
          </button>
        </div>

        {children ? <div className="space-y-4 px-5 pb-5">{children}</div> : null}

        {pie ? (
          <div className="flex items-center justify-end gap-2 border-t border-panel-borde bg-panel-sup2/60 px-5 py-3.5">
            {pie}
          </div>
        ) : null}
      </div>
    </div>
  );
}
