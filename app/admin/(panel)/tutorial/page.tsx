/**
 * `/admin/tutorial` — la guía de primera implementación. Para alguien que
 * acaba de deployar esto y no sabe por dónde empezar: nueve pasos, en el orden
 * real del flujo, cada uno leyendo si YA está hecho contra la base y la config.
 *
 * No es una checklist de texto que alguien tilda a mano — sería mentira en
 * cuanto la realidad cambie sin que alguien vuelva a esta pantalla a actualizarla.
 * `tutorialSnapshot()` (lib/admin/tutorial-snapshot.ts) mide el estado real cada
 * vez que se abre la pantalla, y `pasosConEstado()` (lib/admin/tutorial.ts, con
 * sus tests) decide cuál es el próximo paso. Esta página solo dibuja lo que esos
 * dos módulos ya calcularon.
 */
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle,
  Circle,
  Compass,
  MapPinLine,
} from '@phosphor-icons/react/ssr';
import { tutorialSnapshot } from '../../../../lib/admin/tutorial-snapshot';
import { pasosConEstado, progreso, type PasoConEstado } from '../../../../lib/admin/tutorial';
import {
  Aviso,
  EncabezadoPantalla,
  Insignia,
  Tarjeta,
  clasesBoton,
  unir,
} from '../../../../components/panel/ui';

export const dynamic = 'force-dynamic';

/**
 * Icono del paso según su estado. Hecho = check en verde (vivo); siguiente =
 * pin de mapa en acento, para que salte a la vista sobre la fila destacada;
 * pendiente = círculo vacío en gris. Se reusan los tonos de `Insignia` y no
 * colores nuevos.
 */
function IconoPaso({ estado }: { estado: PasoConEstado['estado'] }): JSX.Element {
  if (estado === 'hecho') {
    return <CheckCircle size={22} weight="fill" className="text-vivo" aria-hidden="true" />;
  }
  if (estado === 'siguiente') {
    return <MapPinLine size={22} weight="fill" className="text-acento" aria-hidden="true" />;
  }
  return <Circle size={22} className="text-tinta-4" aria-hidden="true" />;
}

function FilaPaso({ paso }: { paso: PasoConEstado }): JSX.Element {
  const destacado = paso.estado === 'siguiente';

  return (
    <li
      className={unir(
        'flex gap-3.5 rounded-ctrl border px-4 py-3.5 transition-colors',
        destacado
          ? 'border-acento-borde bg-acento-suave'
          : paso.estado === 'hecho'
            ? 'border-panel-borde bg-panel-sup'
            : 'border-panel-borde bg-panel-sup opacity-70',
      )}
    >
      <div className="shrink-0 pt-0.5">
        <IconoPaso estado={paso.estado} />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-tinta-3">
            Paso {paso.numero}
          </span>
          {destacado ? <Insignia tono="acento">Seguí por acá</Insignia> : null}
          <h3
            className={unir(
              'text-sm font-semibold',
              paso.estado === 'hecho' ? 'text-tinta-2' : 'text-tinta',
            )}
          >
            {paso.titulo}
          </h3>
        </div>

        <p className="max-w-[62ch] text-[13px] leading-relaxed text-tinta-2">{paso.descripcion}</p>

        <p
          className={unir(
            'text-[12px] font-medium',
            paso.hecho ? 'text-vivo' : destacado ? 'text-acento' : 'text-tinta-3',
          )}
        >
          {paso.detalle}
        </p>

        <div className="pt-1">
          <Link
            href={paso.href}
            className={clasesBoton(destacado ? 'primario' : 'secundario', 'sm')}
          >
            {paso.textoLink}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </li>
  );
}

export default async function TutorialPage(): Promise<JSX.Element> {
  const snapshot = await tutorialSnapshot();
  const pasos = pasosConEstado(snapshot);
  const { hechos, total } = progreso(snapshot);
  const completo = hechos === total;

  return (
    <div className="max-w-3xl space-y-6">
      <EncabezadoPantalla
        titulo="Primera implementación"
        descripcion="Nueve pasos para pasar de un deploy recién hecho a un funnel cobrando de verdad. Cada uno se marca solo en cuanto la base confirma que se hizo."
      />

      <Tarjeta className="px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Compass size={18} className="text-tinta-3" aria-hidden="true" />
            <span className="text-sm font-medium text-tinta">
              {hechos} de {total} pasos hechos
            </span>
          </div>
          <Insignia tono={completo ? 'vivo' : 'neutro'}>
            {completo ? 'Listo para cobrar' : `Faltan ${total - hechos}`}
          </Insignia>
        </div>
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-panel-sup2"
          role="progressbar"
          aria-valuenow={hechos}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Progreso del tutorial"
        >
          <div
            className="h-full rounded-full bg-vivo transition-[width] duration-300"
            style={{ width: `${(hechos / total) * 100}%` }}
          />
        </div>
      </Tarjeta>

      {completo ? (
        <Aviso tono="vivo" icono={<CheckCircle size={17} aria-hidden="true" />} titulo="Los nueve pasos están hechos">
          Hay credenciales verificadas, productos con plan, un funnel con front y upsell, orígenes
          autorizados, todo encendido, y al menos un cobro pagado. El freno de emergencia sigue siendo
          apagar el funnel desde /admin/funnels si algo sale mal.
        </Aviso>
      ) : null}

      <ol className="space-y-2.5">
        {pasos.map((paso) => (
          <FilaPaso key={paso.numero} paso={paso} />
        ))}
      </ol>
    </div>
  );
}
