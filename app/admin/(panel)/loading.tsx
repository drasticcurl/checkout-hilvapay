import { Esqueleto } from '../../../components/panel/ui';

/**
 * Esqueleto de carga de todas las pantallas del panel. Todas son
 * `force-dynamic` y consultan Postgres, así que hay un momento real de espera en
 * cada navegación.
 *
 * Tiene la forma de lo que va a llegar —encabezado, y una tabla con su
 * cabecera— y no un spinner circular: cuando aparece el contenido real, el ojo
 * ya está mirando donde tiene que mirar y nada salta de lugar.
 */
export default function CargandoPanel(): JSX.Element {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2.5">
          <Esqueleto className="h-6 w-44" />
          <Esqueleto className="h-4 w-72" />
        </div>
        <Esqueleto className="h-9 w-28 rounded-ctrl" />
      </div>

      <div className="overflow-hidden rounded-card border border-panel-borde bg-panel-sup shadow-sombra">
        <div className="flex gap-4 border-b border-panel-borde bg-panel-sup2/60 px-4 py-3">
          <Esqueleto className="h-3 w-28" />
          <Esqueleto className="h-3 w-20" />
          <Esqueleto className="ml-auto h-3 w-16" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-panel-borde px-4 py-3.5 last:border-0">
            <Esqueleto className="h-4 w-56" />
            <Esqueleto className="h-4 w-32" />
            <Esqueleto className="ml-auto h-5 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
