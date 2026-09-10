'use client';

import { useState } from 'react';

type ProductoSelector = { id: string; nombre: string; precio: string; moneda: string };

/**
 * El paso tal como vive en el estado del editor: igual que `PasoDeFunnel` de
 * `lib/admin/funnels.ts` pero con las flechas como ÍNDICE dentro del array de
 * pasos, no como id — un paso nuevo no tiene id hasta que el funnel se guarda.
 */
export type PasoEditor = {
  /** `null` si el paso todavía no se guardó nunca. */
  id: string | null;
  slug: string;
  producto_id: string;
  tipo: 'front' | 'upsell';
  nombre: string | null;
  url_externa: string | null;
  permite_rechazo: boolean;
  producto: { id: string; nombre: string; precio: string; moneda: string; imagen_url: string | null };
  paso_aceptado_indice: number | null;
  paso_rechazado_indice: number | null;
};

type Props = {
  /** `null` = paso nuevo. */
  paso: PasoEditor | null;
  productos: ProductoSelector[];
  /** false cuando ya existe otro paso `front` en el funnel: no se puede elegir ese tipo. */
  permitirFront: boolean;
  onGuardar: (paso: PasoEditor) => void;
  onCancelar: () => void;
};

function formatearPrecio(precio: string, moneda: string): string {
  return `${moneda.toUpperCase() === 'USD' ? 'US$' : moneda.toUpperCase()} ${Number(precio).toFixed(2).replace('.', ',')}`;
}

/**
 * El slug se normaliza al vuelo con las mismas reglas que `normalizarSlug` de
 * `lib/admin/paginas.ts` (minúsculas, sin espacios ni acentos), para que el
 * preview de la URL coincida con lo que el backend termina guardando. No se
 * reimplementa la función: es una copia visual de la MISMA regla, y el valor
 * real que se persiste lo normaliza el servidor.
 */
function previsualizarSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * El formulario de un paso: modal con los campos exactos de la captura de
 * KashPay, más el slug (que KashPay no necesita mostrar porque su editor no
 * expone `data-hilvana-upsell`, pero este checkout sí lo necesita).
 */
export function FormularioPaso({ paso, productos, permitirFront, onGuardar, onCancelar }: Props): JSX.Element {
  const [tipo, setTipo] = useState<'front' | 'upsell'>(paso?.tipo ?? (permitirFront ? 'front' : 'upsell'));
  const [permiteRechazo, setPermiteRechazo] = useState(paso?.permite_rechazo ?? false);
  const [nombre, setNombre] = useState(paso?.nombre ?? '');
  const [productoId, setProductoId] = useState(paso?.producto_id ?? productos[0]?.id ?? '');
  const [urlExterna, setUrlExterna] = useState(paso?.url_externa ?? '');
  const [slug, setSlug] = useState(paso?.slug ?? '');
  const [error, setError] = useState<string | null>(null);

  const producto = productos.find((p) => p.id === productoId) ?? null;
  const slugNormalizado = previsualizarSlug(slug);
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  function guardar(): void {
    if (nombre.trim().length < 2) {
      setError('El nombre de identificación es muy corto.');
      return;
    }
    if (!productoId) {
      setError('Elegí un producto.');
      return;
    }
    if (!slugNormalizado) {
      setError('El slug queda vacío. Probá con letras y números.');
      return;
    }

    onGuardar({
      id: paso?.id ?? null,
      slug: slugNormalizado,
      producto_id: productoId,
      tipo,
      nombre: nombre.trim(),
      url_externa: tipo === 'upsell' && urlExterna.trim() ? urlExterna.trim() : null,
      permite_rechazo: permiteRechazo,
      producto: producto
        ? { id: producto.id, nombre: producto.nombre, precio: producto.precio, moneda: producto.moneda, imagen_url: null }
        : paso?.producto ?? { id: '', nombre: '', precio: '', moneda: 'usd', imagen_url: null },
      paso_aceptado_indice: paso?.paso_aceptado_indice ?? null,
      paso_rechazado_indice: paso?.paso_rechazado_indice ?? null,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={paso ? 'Editar paso' : 'Nuevo paso'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-texto">{paso ? 'Editar paso' : 'Nuevo paso'}</h2>

        {permitirFront ? (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-texto">Tipo de paso</legend>
            <div className="mt-1.5 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-texto">
                <input
                  type="radio"
                  name="tipo-paso"
                  checked={tipo === 'front'}
                  onChange={() => setTipo('front')}
                />
                Producto principal
              </label>
              <label className="flex items-center gap-2 text-sm text-texto">
                <input
                  type="radio"
                  name="tipo-paso"
                  checked={tipo === 'upsell'}
                  onChange={() => setTipo('upsell')}
                />
                Upsell
              </label>
            </div>
          </fieldset>
        ) : null}

        {/* Toggle "Activar botón de rechazo". Operable con teclado: es un
            <button role="switch">, no un div con onClick. */}
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <label htmlFor="toggle-rechazo" className="text-sm font-medium text-texto">
              Activar botón de rechazo
            </label>
            <p className="text-xs text-texto-suave">
              Permite redirigir sin cobrar y habilita caminos de downsell.
            </p>
          </div>
          <button
            id="toggle-rechazo"
            type="button"
            role="switch"
            aria-checked={permiteRechazo}
            onClick={() => setPermiteRechazo((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              permiteRechazo ? 'bg-comprar' : 'bg-gray-300'
            }`}
          >
            <span className="sr-only">Activar botón de rechazo</span>
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                permiteRechazo ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <label className="mt-4 block" htmlFor="nombre-paso">
          <span className="mb-1 block text-sm font-medium text-texto">Nombre de identificación</span>
          <input
            id="nombre-paso"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Upsell 1"
            className="w-full rounded-md border border-borde px-3 py-2 text-sm focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
          />
        </label>

        <label className="mt-4 block" htmlFor="producto-paso">
          <span className="mb-1 block text-sm font-medium text-texto">Producto</span>
          <select
            id="producto-paso"
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className="w-full rounded-md border border-borde px-3 py-2 text-sm focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
          >
            <option value="">Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium text-texto">Oferta</span>
          {/* Solo lectura: el precio sale de productos.precio, no se edita acá
              (regla explícita del task). Un <output> y no un <input disabled>:
              no es un valor de formulario, es información derivada. */}
          <output className="block rounded-md border border-borde bg-gray-50 px-3 py-2 text-sm text-texto">
            {producto ? formatearPrecio(producto.precio, producto.moneda) : '—'}
          </output>
        </div>

        {tipo === 'upsell' ? (
          <label className="mt-4 block" htmlFor="url-externa-paso">
            <span className="mb-1 block text-sm font-medium text-texto">URL de la página externa</span>
            <input
              id="url-externa-paso"
              value={urlExterna}
              onChange={(e) => setUrlExterna(e.target.value)}
              placeholder="https://elfunnel.com/upsell1"
              className="w-full rounded-md border border-borde px-3 py-2 text-sm focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
            />
            <span className="mt-1 block text-xs text-texto-suave">Página donde el cliente verá la oferta.</span>
          </label>
        ) : null}

        <label className="mt-4 block" htmlFor="slug-paso">
          <span className="mb-1 block text-sm font-medium text-texto">Slug</span>
          <input
            id="slug-paso"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="upsell-1"
            className="w-full rounded-md border border-borde px-3 py-2 font-mono text-sm focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
          />
          <span className="mt-1 block text-xs text-texto-suave">
            Es lo que el botón del funnel pone en <code>data-hilvana-upsell</code>:{' '}
            <code>{base}/pagos/{slugNormalizado || '…'}</code>
          </span>
        </label>

        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-urgencia">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-3 py-2 text-sm font-medium text-texto-suave hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white hover:bg-comprar-oscuro"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
