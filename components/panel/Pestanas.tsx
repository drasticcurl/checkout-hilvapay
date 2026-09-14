'use client';

/**
 * Pestañas simples, controladas por estado local (no por querystring/ruta):
 * cambiar de pestaña no navega ni pierde el estado de los formularios de la
 * otra — las dos siguen montadas, solo una se oculta con `hidden` (no un
 * `if` que desmonte: perder el estado de un input a medio llenar al mirar la
 * otra pestaña y volver sería peor que no tener pestañas).
 *
 * Con `role="tablist"`/`"tab"`/`"tabpanel"` y flechas de teclado (patrón WAI-ARIA
 * estándar) porque es el único componente de este tipo en el panel — vale la
 * pena que sea accesible de una vez en vez de cada pantalla reinventando su
 * propio switch de tabs sin semántica.
 */
import { useId, useState } from 'react';
import { unir } from './ui';

export type Pestana = {
  id: string;
  etiqueta: string;
  contenido: React.ReactNode;
};

export function Pestanas({
  pestanas,
  inicial,
}: {
  pestanas: Pestana[];
  /** El id de la pestaña que arranca activa. Default: la primera. */
  inicial?: string;
}): JSX.Element {
  const [activa, setActiva] = useState(inicial ?? pestanas[0]?.id);
  const baseId = useId();

  function moverFoco(indiceActual: number, delta: 1 | -1): void {
    const siguiente = (indiceActual + delta + pestanas.length) % pestanas.length;
    const id = pestanas[siguiente].id;
    setActiva(id);
    document.getElementById(`${baseId}-tab-${id}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-panel-borde">
        {pestanas.map((p, i) => {
          const esActiva = p.id === activa;
          return (
            <button
              key={p.id}
              id={`${baseId}-tab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={esActiva}
              aria-controls={`${baseId}-panel-${p.id}`}
              tabIndex={esActiva ? 0 : -1}
              onClick={() => setActiva(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') moverFoco(i, 1);
                if (e.key === 'ArrowLeft') moverFoco(i, -1);
              }}
              className={unir(
                'relative -mb-px px-3.5 py-2.5 text-[13px] font-medium transition-colors duration-150',
                esActiva
                  ? 'border-b-2 border-tinta text-tinta'
                  : 'border-b-2 border-transparent text-tinta-3 hover:text-tinta-2',
              )}
            >
              {p.etiqueta}
            </button>
          );
        })}
      </div>

      {pestanas.map((p) => (
        <div
          key={p.id}
          id={`${baseId}-panel-${p.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${p.id}`}
          hidden={p.id !== activa}
          className="pt-5"
        >
          {p.id === activa ? p.contenido : null}
        </div>
      ))}
    </div>
  );
}
