'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FunnelConPasos } from '../../../../lib/admin/funnels';
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
 * El editor visual: una pila vertical de tarjetas, de arriba hacia abajo. Cada
 * paso conoce su índice en el array `pasos`, y las flechas (`paso_*_indice`) son
 * índices dentro de ese mismo array — no ids, porque un paso nuevo todavía no
 * tiene id hasta que se guarda. El backend resuelve los índices a ids reales
 * dentro de la transacción (ver `guardarFunnel`).
 *
 * No hay drag & drop ni SVG: KashPay tampoco lo tiene, y una pila con ramas
 * etiquetadas alcanza para leer el flujo de un vistazo.
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
      <div className="flex items-center justify-between gap-3">
        <label className="block flex-1">
          <span className="sr-only">Nombre del funnel</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-md border border-borde px-3 py-2 text-lg font-semibold text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
          />
        </label>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={descartar}
            className="rounded-md px-3 py-2 text-sm font-medium text-texto-suave hover:bg-gray-100"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-urgencia/30 bg-urgencia/5 p-3 text-sm text-urgencia">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {pasos.map((paso, indice) => (
          <div key={indice}>
            {indice === 0 ? (
              <TarjetaProductoPrincipal paso={paso} onEditar={() => setEditandoIndice(indice)} />
            ) : (
              <TarjetaUpsell
                paso={paso}
                indice={indice}
                onEditar={() => setEditandoIndice(indice)}
              />
            )}

            {indice === 0 ? (
              <div className="my-3 flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-texto">
                  <span className="h-2 w-2 rounded-full bg-comprar" aria-hidden />
                  Compra completada por el cliente
                </span>
              </div>
            ) : (
              <RamasDelPaso
                paso={paso}
                pasos={pasos}
                onAbrirRama={(rama) => setRamaAbierta({ indice, rama })}
                onAgregarDownsell={() => setEditandoIndice('nuevo')}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-borde pt-6">
        <button
          type="button"
          onClick={() => setEditandoIndice('nuevo')}
          aria-label="Agregar paso"
          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-borde text-xl text-texto-suave transition-colors hover:border-comprar hover:text-comprar"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setEditandoGracias(true)}
          className="rounded-md border border-borde px-3 py-2 text-sm font-medium text-texto hover:bg-gray-100"
        >
          Página de gracias{urlGracias ? ': ' + urlGracias : ''}
        </button>
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

function TarjetaProductoPrincipal({
  paso,
  onEditar,
}: {
  paso: PasoEditor;
  onEditar: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onEditar}
      className="w-full rounded-lg border border-borde p-4 text-left transition-colors hover:border-precio"
    >
      <div className="flex items-center gap-3">
        {paso.producto.imagen_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- viene de una URL externa arbitraria, no del build
          <img
            src={paso.producto.imagen_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded-md border border-borde object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="font-semibold text-texto">{paso.producto.nombre || '—'}</p>
          <p className="text-xs font-medium text-texto-suave">Producto principal</p>
        </div>
      </div>
      <div className="my-3 border-t border-borde" />
      <div className="flex items-center justify-between text-sm">
        <span className="text-texto-suave">Oferta que dispara:</span>
        <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-texto">
          {paso.producto.precio ? formatearPrecio(paso.producto.precio, paso.producto.moneda) : '—'}
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
    <button
      type="button"
      onClick={onEditar}
      className="w-full rounded-lg border border-borde p-4 text-left transition-colors hover:border-precio"
    >
      <span className="inline-block rounded bg-comprar/10 px-2 py-0.5 text-xs font-semibold text-comprar">
        {paso.nombre || `Upsell ${indice}`}
      </span>
      <p className="mt-2 font-bold text-texto">{paso.producto.nombre || '—'}</p>
      <p className="text-sm text-texto-suave">
        {paso.producto.precio ? formatearPrecio(paso.producto.precio, paso.producto.moneda) : '—'}
      </p>
    </button>
  );
}

function RamasDelPaso({
  paso,
  pasos,
  onAbrirRama,
  onAgregarDownsell,
}: {
  paso: PasoEditor;
  pasos: PasoEditor[];
  onAbrirRama: (rama: 'aceptado' | 'rechazado') => void;
  onAgregarDownsell: () => void;
}): JSX.Element {
  function etiquetaDestino(indice: number | null): string {
    if (indice == null) return 'Termina en gracias';
    const destino = pasos[indice];
    return destino ? `→ ${destino.nombre || destino.producto.nombre}` : 'Termina en gracias';
  }

  return (
    <div className="my-3 flex flex-wrap items-center justify-center gap-2 border-l-2 border-borde pl-3">
      {/* El chip de rechazo solo existe si el paso tiene el toggle activado: un
          paso que no ofrece salida sin comprar no tiene rama de rechazo. */}
      {paso.permite_rechazo ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAbrirRama('rechazado')}
            className="rounded-full bg-urgencia/10 px-3 py-1 text-xs font-medium text-urgencia hover:bg-urgencia/20"
          >
            Rechazó el upsell · {etiquetaDestino(paso.paso_rechazado_indice)}
          </button>
          <button
            type="button"
            onClick={onAgregarDownsell}
            className="rounded-full border border-dashed border-borde px-2 py-1 text-xs font-medium text-texto-suave hover:border-comprar hover:text-comprar"
          >
            + Agregar
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onAbrirRama('aceptado')}
        className="rounded-full bg-comprar/10 px-3 py-1 text-xs font-medium text-comprar hover:bg-comprar/20"
      >
        Aceptó la oferta · {etiquetaDestino(paso.paso_aceptado_indice)}
      </button>
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Página de gracias"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-texto">Página de gracias</h2>
        <p className="mt-1 text-sm text-texto-suave">
          A dónde va el comprador cuando el funnel se termina y no hay más pasos configurados.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-texto">URL de la página de gracias</span>
          <input
            id="url-gracias"
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="https://elfunnel.com/gracias"
            className="w-full rounded-md border border-borde px-3 py-2 text-sm focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-3 py-2 text-sm font-medium text-texto-suave hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onGuardar(v)}
            className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white hover:bg-comprar-oscuro"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
