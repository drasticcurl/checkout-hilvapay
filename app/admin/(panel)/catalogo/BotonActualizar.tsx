'use client';

/**
 * Botón para volver a leer el catálogo de Whop.
 *
 * ── Por qué hace falta si la página ya es dinámica ───────────────────────────
 * `/admin/catalogo` es `force-dynamic` y `whopFetch` va con `cache: 'no-store'`,
 * así que cada carga pega a Whop de verdad. El problema no es el caché: es que
 * para recargar hay que apretar F5, y F5 en el panel es indistinguible de "se me
 * colgó". Cuando alguien acaba de crear un producto en otra pestaña, lo que
 * quiere es un botón que diga que va a traer lo nuevo.
 *
 * `router.refresh()` vuelve a ejecutar el server component sin perder el estado
 * del cliente ni hacer un full reload — o sea, sin el parpadeo blanco. Es la
 * diferencia entre "actualizar la lista" y "recargar la página".
 *
 * ── El reloj se calcula DESPUÉS de montar ────────────────────────────────────
 * `leidoAt` llega del server como ISO. Formatearlo durante el render daría un
 * texto distinto en el server y en el cliente —zona horaria y el segundo que
 * pasó— y React tira un error de hidratación. Así que arranca vacío y se llena
 * en el `useEffect`. También es lo que le permite ir contando solo.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise } from '@phosphor-icons/react/ssr';
import { Boton } from '@/components/panel/ui';

/** "hace 4 s", "hace 3 min", "hace 2 h". Sin librería: son tres rangos. */
function haceCuanto(desde: number, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - desde) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

export function BotonActualizar({ leidoAt }: { leidoAt: string }): JSX.Element {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [etiqueta, setEtiqueta] = useState<string | null>(null);

  useEffect(() => {
    const desde = new Date(leidoAt).getTime();
    // Si la fecha no parsea, no se muestra nada en vez de un "hace NaN s".
    if (Number.isNaN(desde)) return;

    const actualizar = (): void => setEtiqueta(haceCuanto(desde, Date.now()));
    actualizar();
    const id = setInterval(actualizar, 15_000);
    return () => clearInterval(id);
  }, [leidoAt]);

  return (
    <div className="flex items-center gap-2.5">
      {etiqueta ? (
        // `aria-live="off"`: el texto cambia solo cada 15 s y no es información
        // que valga interrumpir a un lector de pantalla. El estado que sí importa
        // lo anuncia el botón.
        <span aria-live="off" className="hidden text-[12px] tabular-nums text-tinta-3 sm:inline">
          leído {etiqueta}
        </span>
      ) : null}
      <Boton
        variante="secundario"
        tamano="md"
        onClick={() => iniciar(() => router.refresh())}
        disabled={pendiente}
        aria-label={pendiente ? 'Actualizando el catálogo de Whop' : 'Volver a leer el catálogo de Whop'}
        icono={
          <ArrowsClockwise
            size={14}
            aria-hidden="true"
            className={pendiente ? 'animate-spin' : undefined}
          />
        }
      >
        {pendiente ? 'Actualizando…' : 'Actualizar'}
      </Boton>
    </div>
  );
}
