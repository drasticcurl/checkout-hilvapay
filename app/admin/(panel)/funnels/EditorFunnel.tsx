'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowElbowDownRight,
  CaretRight,
  Copy,
  Check,
  FlagCheckered,
  PencilSimple,
  Plus,
  Warning,
} from '@phosphor-icons/react/ssr';
import type { FunnelConPasos } from '../../../../lib/admin/funnels';
import { snippetBotonHtml, snippetBotonJsx, snippetRechazo, snippetWalletHtml, snippetWalletJsx } from '../../../../lib/admin/integracion';
import { Dialogo } from '@/components/panel/Dialogo';
import {
  Aviso,
  Boton,
  Campo,
  Insignia,
  SinDato,
  clasesControl,
  unir,
} from '@/components/panel/ui';
import { FormularioPaso, type PasoEditor } from './FormularioPaso';
import { SelectorDestino } from './SelectorDestino';

type ProductoSelector = { id: string; nombre: string; precio: string; moneda: string };

type Props = {
  funnel: FunnelConPasos | null;
  productos: ProductoSelector[];
};

function formatearPrecio(precio: string, moneda: string): string {
  return `${moneda.toUpperCase() === 'USD' ? 'US$' : moneda.toUpperCase()} ${Number(precio).toFixed(2).replace('.', ',')}`;
}

/** Convierte los pasos de la base (con id e ids de flecha) al formato del editor (por índice). */
function pasosAEditor(funnel: FunnelConPasos | null): PasoEditor[] {
  if (!funnel) return [];
  const indicePorId = new Map(funnel.pasos.map((p, i) => [p.id, i]));
  return funnel.pasos.map((p) => ({
    id: p.id,
    slug: p.slug,
    producto_id: p.producto_id,
    tipo: p.tipo,
    nombre: p.nombre,
    url_externa: p.url_externa,
    permite_rechazo: p.permite_rechazo,
    producto: p.producto,
    paso_aceptado_indice: p.paso_aceptado_id != null ? indicePorId.get(p.paso_aceptado_id) ?? null : null,
    paso_rechazado_indice: p.paso_rechazado_id != null ? indicePorId.get(p.paso_rechazado_id) ?? null : null,
  }));
}

/**
 * El editor visual: una pila vertical de pasos sobre un riel, de arriba hacia
 * abajo. Cada paso conoce su índice en el array `pasos`, y las flechas
 * (`paso_*_indice`) son índices dentro de ese mismo array — no ids, porque un
 * paso nuevo todavía no tiene id hasta que se guarda. El backend resuelve los
 * índices a ids reales dentro de la transacción (ver `guardarFunnel`).
 *
 * No hay drag & drop ni SVG de nodos arrastrables: una pila con un riel y ramas
 * etiquetadas alcanza para leer el flujo de un vistazo, y el orden es la posición
 * en el array, que es lo único que `orden` significa en la migración 003.
 *
 * Qué determina el dibujo de cada paso: su `tipo`, no su posición. El paso
 * `front` muestra "compra completada" debajo; los `upsell` muestran sus dos
 * ramas. Antes eso se decidía por `indice === 0`, y un funnel a medio armar con
 * el front en el medio dejaba las ramas de un upsell fuera de alcance.
 */
export function EditorFunnel({ funnel, productos }: Props): JSX.Element {
  const router = useRouter();
  const [nombre, setNombre] = useState(funnel?.nombre ?? 'Nuevo funnel');
  const [urlGracias, setUrlGracias] = useState(funnel?.url_gracias ?? '');
  const [pasos, setPasos] = useState<PasoEditor[]>(pasosAEditor(funnel));
  const [editandoIndice, setEditandoIndice] = useState<number | 'nuevo' | null>(null);
  const [editandoGracias, setEditandoGracias] = useState(false);
  const [ramaAbierta, setRamaAbierta] = useState<{ indice: number; rama: 'aceptado' | 'rechazado' } | null>(
    null,
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const indiceFront = pasos.findIndex((p) => p.tipo === 'front');

  function guardarPaso(paso: PasoEditor, indice: number | 'nuevo'): void {
    if (indice === 'nuevo') {
      setPasos((prev) => [...prev, paso]);
    } else {
      setPasos((prev) => prev.map((p, i) => (i === indice ? paso : p)));
    }
    setEditandoIndice(null);
  }

  function elegirDestino(indice: number, rama: 'aceptado' | 'rechazado', destino: number | null): void {
    setPasos((prev) =>
      prev.map((p, i) =>
        i === indice
          ? {
              ...p,
              ...(rama === 'aceptado' ? { paso_aceptado_indice: destino } : { paso_rechazado_indice: destino }),
            }
          : p,
      ),
    );
    setRamaAbierta(null);
  }

  async function guardar(): Promise<void> {
    setGuardando(true);
    setError(null);
    try {
      const body = {
        nombre,
        url_gracias: urlGracias.trim() ? urlGracias.trim() : null,
        pasos: pasos.map((p) => ({
          id: p.id,
          slug: p.slug,
          producto_id: p.producto_id,
          tipo: p.tipo,
          // El orden visual es la posición en el array: es lo único que define
          // "orden" en la migración 003, nunca el flujo.
          orden: pasos.indexOf(p),
          nombre: p.nombre,
          url_externa: p.url_externa,
          permite_rechazo: p.permite_rechazo,
          paso_aceptado_indice: p.paso_aceptado_indice,
          paso_rechazado_indice: p.paso_rechazado_indice,
        })),
      };
      const res = await fetch(funnel ? `/api/admin/funnels/${funnel.id}` : '/api/admin/funnels', {
        method: funnel ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detalle ?? traducirError(data.error));
        return;
      }
      router.push('/admin/funnels');
      router.refresh();
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setGuardando(false);
    }
  }

  function descartar(): void {
    router.push('/admin/funnels');
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-col gap-4 rounded-card border border-panel-borde bg-panel-sup p-4 shadow-panel sm:flex-row sm:items-end">
        <Campo etiqueta="Nombre del funnel" htmlFor="nombre-funnel" className="min-w-0 flex-1">
          <input
            id="nombre-funnel"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={clasesControl('font-medium', 'lg')}
          />
        </Campo>
        <div className="flex shrink-0 gap-2">
          <Boton variante="fantasma" tamano="lg" onClick={descartar} disabled={guardando}>
            Descartar
          </Boton>
          <Boton variante="primario" tamano="lg" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar funnel'}
          </Boton>
        </div>
      </div>

      {error ? (
        <Aviso tono="peligro" rol="alert" icono={<Warning size={16} aria-hidden="true" />}>
          {error}
        </Aviso>
      ) : null}

      {/* El lienzo punteado marca dónde termina el formulario y empieza el flujo.
          Es la única textura del panel y sirve para eso, no para decorar. */}
      <div className="lienzo-flujo rounded-card border border-panel-borde bg-panel-sup p-5 shadow-panel">
        {pasos.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-tinta-2">
            El funnel está vacío. Empezá por el producto principal: es la oferta que abre la cadena.
          </p>
        ) : (
          <ol className="space-y-0">
            {pasos.map((paso, indice) => {
              const esFront = paso.tipo === 'front';
              return (
                <li key={indice} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
                  {/* Riel: el nodo y la línea que baja al siguiente paso. La línea
                      es `flex-1` para que mida exactamente lo que mide la fila. */}
                  <div className="flex flex-col items-center">
                    <span
                      className={unir(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        'font-mono text-[12px] font-medium tabular-nums',
                        esFront
                          ? 'bg-tinta text-white'
                          : 'border border-panel-bordeFuerte bg-panel-sup text-tinta-2',
                      )}
                      aria-hidden="true"
                    >
                      {indice + 1}
                    </span>
                    <span className="mt-1 w-px flex-1 bg-panel-bordeFuerte" />
                  </div>

                  <div className="min-w-0 pb-5">
                    {esFront ? (
                      <TarjetaProductoPrincipal paso={paso} onEditar={() => setEditandoIndice(indice)} />
                    ) : (
                      <TarjetaUpsell
                        paso={paso}
                        indice={indice}
                        onEditar={() => setEditandoIndice(indice)}
                      />
                    )}

                    {/*
                      BUG que arregla este bloque: antes el `front` no
                      renderizaba ningún `SelectorDestino` — solo el texto fijo
                      "Compra completada por el cliente" — así que
                      `paso_aceptado_indice` del front nunca se tocaba desde el
                      editor y `guardarFunnel` lo escribía en NULL siempre. El
                      funnel nacía desconectado: el comprador pagaba el producto
                      principal y quedaba varado en el checkout sin ir al primer
                      upsell. Se detectó en producción y se corrigió a mano con
                      SQL.
                      El front SÍ tiene rama de "aceptado" (paga → sigue el
                      funnel), pero nunca rama de "rechazado": no hay nada que
                      rechazar en la compra principal, por eso `RamasDelPaso`
                      sigue ocultando esa segunda rama cuando `esFront` es true.
                    */}
                    <RamasDelPaso
                      paso={paso}
                      pasos={pasos}
                      esFront={esFront}
                      onAbrirRama={(rama) => setRamaAbierta({ indice, rama })}
                      onAgregarDownsell={() => setEditandoIndice('nuevo')}
                    />

                    {/* El botón de copiar vive por paso y no solo en el panel de
                        "Cómo integrar" del final: ver comentario largo en
                        `SnippetDelPaso` más abajo sobre por qué un paso sin
                        guardar no puede ofrecer un snippet copiable. */}
                    {!esFront ? (
                      <SnippetDelPaso paso={paso} pasos={pasos} guardado={funnel != null} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Cierre del riel: el mismo carril, con el botón de agregar y el destino
            final del funnel. */}
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setEditandoIndice('nuevo')}
              aria-label="Agregar paso"
              className={unir(
                'flex h-7 w-7 items-center justify-center rounded-full border border-dashed',
                'border-panel-bordeFuerte bg-panel-sup text-tinta-3 transition-colors duration-150',
                'hover:border-acento hover:bg-acento-suave hover:text-acento',
              )}
            >
              <Plus size={13} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => setEditandoIndice('nuevo')}
              icono={<Plus size={13} weight="bold" aria-hidden="true" />}
            >
              Agregar paso
            </Boton>
            <button
              type="button"
              onClick={() => setEditandoGracias(true)}
              className={unir(
                'inline-flex items-center gap-1.5 rounded-ctrl border border-panel-bordeFuerte bg-panel-sup',
                'px-2.5 py-1.5 text-[13px] text-tinta-2 shadow-panel transition-colors duration-150',
                'hover:border-tinta-4 hover:bg-panel-sup2 hover:text-tinta',
              )}
            >
              <FlagCheckered size={13} aria-hidden="true" />
              {urlGracias ? (
                <span className="max-w-[16rem] truncate font-mono text-[12px]">{urlGracias}</span>
              ) : (
                'Definir página de gracias'
              )}
            </button>
          </div>
        </div>
      </div>

      {editandoIndice !== null ? (
        <FormularioPaso
          paso={editandoIndice === 'nuevo' ? null : pasos[editandoIndice]}
          productos={productos}
          // Un segundo `front` viola el índice único de la migración 003; se lo
          // saca del selector de tipo en vez de dejar que el guardado lo
          // rechace después de haber pedido todos los otros datos.
          permitirFront={editandoIndice === 'nuevo' ? indiceFront === -1 : pasos[editandoIndice]?.tipo === 'front'}
          onGuardar={(p) => guardarPaso(p, editandoIndice)}
          onCancelar={() => setEditandoIndice(null)}
        />
      ) : null}

      {editandoGracias ? (
        <PanelGracias
          valor={urlGracias}
          onGuardar={(v) => {
            setUrlGracias(v);
            setEditandoGracias(false);
          }}
          onCancelar={() => setEditandoGracias(false)}
        />
      ) : null}

      {ramaAbierta ? (
        <SelectorDestino
          pasos={pasos}
          indiceOrigen={ramaAbierta.indice}
          valorActual={
            ramaAbierta.rama === 'aceptado'
              ? pasos[ramaAbierta.indice].paso_aceptado_indice
              : pasos[ramaAbierta.indice].paso_rechazado_indice
          }
          onElegir={(destino) => elegirDestino(ramaAbierta.indice, ramaAbierta.rama, destino)}
          onCancelar={() => setRamaAbierta(null)}
        />
      ) : null}
    </div>
  );
}

function traducirError(codigo: string | undefined): string {
  switch (codigo) {
    case 'sin_pasos':
      return 'El funnel necesita al menos un paso.';
    case 'sin_front':
      return 'El funnel necesita un paso "Producto principal".';
    case 'dos_front':
      return 'Solo puede haber un paso "Producto principal" por funnel.';
    case 'slug_ocupado':
      return 'Uno de los slugs ya está usado por otro link. Elegí otro.';
    case 'ciclo':
      return 'Hay un ciclo en las flechas configuradas.';
    default:
      return 'No se pudo guardar el funnel.';
  }
}

/** Clases compartidas por las dos tarjetas de paso, para que hover y foco sean iguales. */
const TARJETA_PASO =
  'group relative block w-full rounded-card border border-panel-borde bg-panel-sup p-3.5 text-left ' +
  'shadow-panel transition-[border-color,box-shadow] duration-150 hover:border-acento hover:shadow-panel-md';

/** El lápiz aparece en hover: dice que la tarjeta entera abre el formulario. */
function Lapiz(): JSX.Element {
  return (
    <PencilSimple
      size={14}
      aria-hidden="true"
      className="absolute right-3.5 top-3.5 text-tinta-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
    />
  );
}

function TarjetaProductoPrincipal({
  paso,
  onEditar,
}: {
  paso: PasoEditor;
  onEditar: () => void;
}): JSX.Element {
  return (
    <button type="button" onClick={onEditar} className={TARJETA_PASO}>
      <Lapiz />
      <div className="flex items-center gap-3">
        {paso.producto.imagen_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- viene de una URL externa arbitraria, no del build
          <img
            src={paso.producto.imagen_url}
            alt=""
            className="h-10 w-10 shrink-0 rounded-ctrl border border-panel-borde object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <Insignia tono="acento">Producto principal</Insignia>
          <p className="mt-1.5 truncate text-sm font-semibold text-tinta">
            {paso.producto.nombre || 'Sin producto elegido'}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[13px] tabular-nums text-tinta-2">
          {paso.producto.precio ? formatearPrecio(paso.producto.precio, paso.producto.moneda) : <SinDato />}
        </span>
      </div>
    </button>
  );
}

function TarjetaUpsell({
  paso,
  indice,
  onEditar,
}: {
  paso: PasoEditor;
  indice: number;
  onEditar: () => void;
}): JSX.Element {
  return (
    <button type="button" onClick={onEditar} className={TARJETA_PASO}>
      <Lapiz />
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {/* `max-w-full truncate`: un nombre de paso largo ("Upsell para
              compradores que llegan desde la campaña de reactivación de
              carrito") desbordaba la tarjeta en vez de cortarse — `Insignia`
              es `inline-flex` sin tope de ancho por diseño (la usan celdas de
              tabla angostas donde el texto siempre es corto), así que el tope
              se pone acá, en el único lugar donde el texto lo puede rebasar. */}
          <Insignia tono="neutro" className="max-w-full truncate">
            {paso.nombre || `Upsell ${indice}`}
          </Insignia>
          <p className="mt-1.5 truncate text-sm font-semibold text-tinta">
            {paso.producto.nombre || 'Sin producto elegido'}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[13px] tabular-nums text-tinta-2">
          {paso.producto.precio ? formatearPrecio(paso.producto.precio, paso.producto.moneda) : <SinDato />}
        </span>
      </div>
    </button>
  );
}

/** Una rama: qué pasó, y a dónde va. El destino se cambia tocándola. */
function Rama({
  tono,
  que,
  destino,
  onClick,
}: {
  tono: 'vivo' | 'peligro';
  que: string;
  destino: string;
  onClick: () => void;
}): JSX.Element {
  const tonos = {
    vivo: 'text-vivo-oscuro hover:bg-vivo-suave',
    peligro: 'text-peligro-oscuro hover:bg-peligro-suave',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={unir(
        'inline-flex max-w-full items-center gap-1.5 rounded-ctrl px-1.5 py-1 text-[12px]',
        'transition-colors duration-150',
        tonos[tono],
      )}
    >
      <ArrowElbowDownRight size={13} aria-hidden="true" className="shrink-0" />
      <span className="font-medium">{que}</span>
      <CaretRight size={10} aria-hidden="true" className="shrink-0 opacity-50" />
      <span className="min-w-0 truncate text-tinta-2">{destino}</span>
    </button>
  );
}

function RamasDelPaso({
  paso,
  pasos,
  esFront,
  onAbrirRama,
  onAgregarDownsell,
}: {
  paso: PasoEditor;
  pasos: PasoEditor[];
  /** El front no tiene rama de rechazo: o paga o no hay compra que registrar. */
  esFront: boolean;
  onAbrirRama: (rama: 'aceptado' | 'rechazado') => void;
  onAgregarDownsell: () => void;
}): JSX.Element {
  function etiquetaDestino(indice: number | null): string {
    if (indice == null) return 'página de gracias';
    const destino = pasos[indice];
    return destino ? destino.nombre || destino.producto.nombre : 'página de gracias';
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-0.5">
      <Rama
        tono="vivo"
        // El texto distingue "pagó" de "aceptó la oferta": son eventos
        // distintos y el front no tiene "oferta" que aceptar, tiene una compra
        // que se completa.
        que={esFront ? 'Compra completada' : 'Aceptó la oferta'}
        destino={etiquetaDestino(paso.paso_aceptado_indice)}
        onClick={() => onAbrirRama('aceptado')}
      />
      {/* El chip de rechazo solo existe en un upsell con el toggle activado: el
          front nunca lo tiene (no hay nada que "rechazar" en la compra
          principal) y un upsell sin el toggle tampoco ofrece salida sin
          comprar. */}
      {!esFront && paso.permite_rechazo ? (
        <div className="flex flex-wrap items-center gap-1">
          <Rama
            tono="peligro"
            que="Rechazó el upsell"
            destino={etiquetaDestino(paso.paso_rechazado_indice)}
            onClick={() => onAbrirRama('rechazado')}
          />
          <button
            type="button"
            onClick={onAgregarDownsell}
            className="rounded-ctrl px-1.5 py-1 text-[12px] font-medium text-tinta-3 transition-colors duration-150 hover:bg-panel-sup2 hover:text-tinta"
          >
            + downsell
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * El botón de copiar el snippet, DENTRO de la tarjeta del paso.
 *
 * Por qué existe: antes el único lugar para copiar el botón de un upsell era
 * `ComoIntegrar`, renderizado una sola vez al final de la pantalla con los
 * snippets de TODOS los pasos juntos. Con un funnel de varios upsells hay que
 * scrollear hasta el final y buscar cuál bloque es el del paso que se está
 * mirando arriba — es exactamente la clase de fricción que hace que alguien
 * copie el bloque de al lado por error y pegue el slug equivocado en el
 * upsell equivocado (el error que ya pasó con KashPay, documentado en
 * `lib/admin/integracion.ts`). Así que cada paso lleva su propio botón, al
 * lado de sus propias ramas.
 *
 * Reusa `snippetBotonHtml` / `snippetBotonJsx` / `snippetRechazo` de
 * `lib/admin/integracion.ts` tal cual — no hay generación de HTML/JSX acá,
 * solo el pegado del bloque y la lógica de copiar. `integracionDesdeFunnel`
 * NO sirve para este caso porque exige `id` y `paso_rechazado_id` como
 * strings reales de la base; en el editor las flechas son ÍNDICES dentro del
 * array `pasos` (ver el comentario de `EditorFunnel`), así que el destino de
 * rechazo se resuelve a mano acá con el mismo criterio que `destinosDeRechazo`:
 * el href sale del paso DESTINO, no del paso actual.
 */
function SnippetDelPaso({
  paso,
  pasos,
  guardado,
}: {
  paso: PasoEditor;
  pasos: PasoEditor[];
  /** false mientras el FUNNEL nunca se guardó (alta todavía no confirmada). */
  guardado: boolean;
}): JSX.Element | null {
  const [lenguaje, setLenguaje] = useState<'html' | 'jsx'>('jsx');
  // `wallet` sigue siendo el default: es el único camino confirmado con
  // tráfico real hasta ahora. El cobro off-session (`data-hilvana-upsell`)
  // dejó de pasar por una checkout configuration en el front (BITACORA.md
  // 2026-09-13, causa probable del 400 histórico), pero todavía no se
  // verificó con una compra real de punta a punta — no se cambia el default
  // hasta confirmarlo.
  const [modo, setModo] = useState<'wallet' | 'guardada'>('wallet');
  const [copiado, setCopiado] = useState(false);

  // Un paso NUEVO (sin `id`) no tiene slug confirmado en la base todavía: el
  // que se ve en el formulario es el que el usuario tipeó, pero recién se
  // normaliza y se persiste en `guardarFunnel` cuando se aprieta "Guardar
  // funnel". Ofrecer un botón "Copiar" ahí sería mostrar como definitivo un
  // slug que puede cambiar (dos pasos nuevos con el mismo slug normalizado
  // chocan contra `paginas_slug_idx` recién en el guardado) o no llegar a
  // existir si se cancela el paso o el funnel entero. Se muestra un aviso en
  // vez del bloque de código, para no dar a copiar algo que todavía puede no
  // ser verdad.
  if (!paso.id || !guardado) {
    return (
      <p className="mt-2 rounded-ctrl border border-dashed border-panel-bordeFuerte bg-panel-sup2/50 px-3 py-2 text-[12px] leading-relaxed text-tinta-3">
        Guardá el funnel para obtener el botón para copiar de este paso.
      </p>
    );
  }

  const precio = formatearPrecio(paso.producto.precio, paso.producto.moneda);
  const pasoParaSnippet = {
    slug: paso.slug,
    tipo: paso.tipo,
    nombre: paso.nombre,
    url_externa: paso.url_externa,
    permite_rechazo: paso.permite_rechazo,
    producto: paso.producto,
  };

  // El destino del "no gracias" sale del paso al que apunta `paso_rechazado_indice`,
  // no del paso actual — mismo criterio que `destinosDeRechazo` en
  // `lib/admin/integracion.ts`, resuelto a mano porque acá el destino es un
  // índice del array y no un id de la base.
  const destino =
    paso.paso_rechazado_indice != null ? pasos[paso.paso_rechazado_indice]?.url_externa ?? null : null;

  const codigo = [
    modo === 'wallet'
      ? lenguaje === 'html'
        ? snippetWalletHtml(pasoParaSnippet)
        : snippetWalletJsx(pasoParaSnippet)
      : lenguaje === 'html'
        ? snippetBotonHtml(pasoParaSnippet, precio)
        : snippetBotonJsx(pasoParaSnippet, precio),
    '',
    paso.permite_rechazo ? snippetRechazo(destino) : null,
  ]
    .filter((l) => l !== null)
    .join('\n')
    .trimEnd();

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin permiso de clipboard el código sigue visible en el <pre> y se
      // puede seleccionar a mano — igual que en ComoIntegrar.
    }
  }

  return (
    <div className="mt-2.5 space-y-1.5">
      {/* El selector de CÓMO cobra va arriba del de lenguaje porque cambia qué
          hace el botón, no cómo se escribe. */}
      <div className="inline-flex rounded-ctrl border border-panel-bordeFuerte bg-panel-sup2 p-0.5">
        {(
          [
            ['wallet', 'Apple Pay / tarjeta'],
            ['guardada', 'Tarjeta guardada'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setModo(valor)}
            aria-pressed={modo === valor}
            className={unir(
              'rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors duration-150',
              modo === valor ? 'bg-panel-sup text-tinta shadow-panel' : 'text-tinta-3 hover:text-tinta',
            )}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {modo === 'wallet' ? (
        <p className="text-[11px] leading-relaxed text-tinta-3">
          Un botón que cobra en un toque. Apple Pay en Safari, Google Pay en Chrome y Android, y en el
          resto un diálogo de Whop que acepta <strong className="font-medium text-tinta-2">tarjeta</strong>.
          El wallet resuelve la autenticación del banco solo.
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-tinta-3">
          Cobra contra la tarjeta que se guardó en el front, sin ninguna interacción. Hasta ahora Whop
          rechazaba este cobro con un error genérico — el checkout del front dejó de pasar por una
          checkout configuration (ver BITACORA.md 2026-09-13), que es lo que se identificó como la
          causa probable. <strong className="font-medium text-tinta-2">Todavía no se confirmó con una
          compra real de punta a punta</strong>: probalo primero en un funnel de prueba antes de
          confiar en él para ventas reales.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-ctrl border border-panel-bordeFuerte bg-panel-sup2 p-0.5">
          {(
            [
              ['jsx', 'React'],
              ['html', 'HTML'],
            ] as const
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setLenguaje(valor)}
              aria-pressed={lenguaje === valor}
              className={unir(
                'rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors duration-150',
                lenguaje === valor ? 'bg-panel-sup text-tinta shadow-panel' : 'text-tinta-3 hover:text-tinta',
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void copiar()}
          aria-label={copiado ? `Botón de ${paso.nombre || paso.slug} copiado` : `Copiar botón de ${paso.nombre || paso.slug}`}
          className={unir(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-micro border px-2 text-[11px] font-medium',
            'transition-[background-color,border-color,color] duration-150',
            copiado
              ? 'border-vivo-borde bg-vivo-suave text-vivo-oscuro'
              : 'border-panel-bordeFuerte bg-panel-sup text-tinta-2 hover:border-tinta-4 hover:text-tinta',
          )}
        >
          {copiado ? <Check size={11} weight="bold" aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {/* `overflow-x-auto` y no wrap: un slug largo o una clase larga partida en
          dos líneas hace dudar de si el salto es parte del código copiado. */}
      <pre className="overflow-x-auto rounded-ctrl border border-panel-borde bg-panel-sup2 px-3 py-2 font-mono text-[11px] leading-relaxed text-tinta">
        <code>{codigo}</code>
      </pre>
    </div>
  );
}

function PanelGracias({
  valor,
  onGuardar,
  onCancelar,
}: {
  valor: string;
  onGuardar: (v: string) => void;
  onCancelar: () => void;
}): JSX.Element {
  const [v, setV] = useState(valor);
  return (
    <Dialogo
      titulo="Página de gracias"
      descripcion="A dónde va el comprador cuando el funnel se termina y no hay más pasos configurados."
      onCerrar={onCancelar}
      pie={
        <>
          <Boton variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={() => onGuardar(v)}>
            Guardar
          </Boton>
        </>
      }
    >
      <Campo etiqueta="URL de la página de gracias" htmlFor="url-gracias">
        <input
          id="url-gracias"
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="https://elfunnel.com/gracias"
          className={clasesControl()}
        />
      </Campo>
    </Dialogo>
  );
}
