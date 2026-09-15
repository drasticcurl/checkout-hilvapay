'use client';

import { Check, FlagCheckered } from '@phosphor-icons/react/ssr';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, unir } from '@/components/panel/ui';
import type { PasoEditor } from './FormularioPaso';

type Props = {
  pasos: PasoEditor[];
  /** El paso desde el que sale la rama: no puede elegirse a sí mismo (constraint de la 003). */
  indiceOrigen: number;
  valorActual: number | null;
  onElegir: (destino: number | null) => void;
  onCancelar: () => void;
  /**
   * El texto de la opción "sin destino" (`null`). Default: la página de
   * gracias, que es lo que significa `null` para las ramas aceptado/rechazado.
   * El camino de fondos insuficientes (migración 014) nunca cae a gracias —
   * `null` ahí es "no configurado, no pasa nada" — así que ese caller manda un
   * texto distinto para no sugerir un comportamiento que no existe.
   */
  etiquetaSinDestino?: string;
};

/**
 * El selector de destino de una rama: a qué paso va, o "Terminar en la página
 * de gracias" (`null`). Se abre al tocar una de las dos ramas de un upsell.
 *
 * La opción elegida se marca con un tilde y borde de acento — no solo con color
 * de texto, que a 12px es una diferencia que se puede pasar por alto.
 */
function Opcion({
  elegida,
  onClick,
  icono,
  children,
}: {
  elegida: boolean;
  onClick: () => void;
  icono?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={elegida ? 'true' : undefined}
      className={unir(
        'flex w-full items-center gap-2 rounded-ctrl border px-3 py-2 text-left text-[13px]',
        'transition-[border-color,background-color] duration-150',
        elegida
          ? 'border-acento bg-acento-suave font-medium text-acento'
          : 'border-panel-bordeFuerte bg-panel-sup text-tinta hover:border-tinta-4 hover:bg-panel-sup2',
      )}
    >
      {icono ? <span className="shrink-0 text-tinta-3">{icono}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {elegida ? <Check size={14} weight="bold" className="shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}

export function SelectorDestino({
  pasos,
  indiceOrigen,
  valorActual,
  onElegir,
  onCancelar,
  etiquetaSinDestino = 'Terminar en la página de gracias',
}: Props): JSX.Element {
  return (
    <Dialogo
      titulo="¿A dónde va?"
      descripcion="El paso al que se manda al comprador después de esta rama."
      onCerrar={onCancelar}
      ancho="sm"
      pie={
        <Boton variante="fantasma" onClick={onCancelar}>
          Cerrar
        </Boton>
      }
    >
      <div className="space-y-1.5">
        <Opcion
          elegida={valorActual == null}
          onClick={() => onElegir(null)}
          icono={<FlagCheckered size={14} aria-hidden="true" />}
        >
          {etiquetaSinDestino}
        </Opcion>
        {pasos.map((p, i) =>
          i === indiceOrigen ? null : (
            <Opcion key={i} elegida={valorActual === i} onClick={() => onElegir(i)}>
              <span className="font-mono text-[12px] text-tinta-3">{i + 1}</span>{' '}
              {p.nombre || p.producto.nombre || `Paso ${i}`}
            </Opcion>
          ),
        )}
      </div>
    </Dialogo>
  );
}
