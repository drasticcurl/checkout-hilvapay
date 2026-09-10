'use client';

import type { PasoEditor } from './FormularioPaso';

type Props = {
  pasos: PasoEditor[];
  /** El paso desde el que sale la rama: no puede elegirse a sí mismo (constraint de la 003). */
  indiceOrigen: number;
  valorActual: number | null;
  onElegir: (destino: number | null) => void;
  onCancelar: () => void;
};

/**
 * El selector de destino de una rama: a qué paso va, o "Terminar en la página
 * de gracias" (`null`). Se abre al tocar el chip rojo o el chip verde de una
 * tarjeta de upsell.
 */
export function SelectorDestino({ pasos, indiceOrigen, valorActual, onElegir, onCancelar }: Props): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Elegir destino"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-texto">¿A dónde va?</h2>
        <ul className="mt-3 space-y-1">
          <li>
            <button
              type="button"
              onClick={() => onElegir(null)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                valorActual == null ? 'border-precio bg-precio/5 font-medium text-precio' : 'border-borde text-texto hover:bg-gray-50'
              }`}
            >
              Terminar en la página de gracias
            </button>
          </li>
          {pasos.map((p, i) =>
            i === indiceOrigen ? null : (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onElegir(i)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    valorActual === i ? 'border-precio bg-precio/5 font-medium text-precio' : 'border-borde text-texto hover:bg-gray-50'
                  }`}
                >
                  {p.nombre || p.producto.nombre || `Paso ${i}`}
                </button>
              </li>
            ),
          )}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-3 py-2 text-sm font-medium text-texto-suave hover:bg-gray-100"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
