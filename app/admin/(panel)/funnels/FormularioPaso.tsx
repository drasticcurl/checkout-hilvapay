'use client';

import { useState } from 'react';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, Campo, Interruptor, OpcionRadio, SinDato, clasesControl, unir } from '@/components/panel/ui';

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
  /** Ver `PasoDeFunnel.delay_segundos` en `lib/admin/funnels.ts`. `null` = sin demora. */
  delay_segundos: number | null;
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

export function FormularioPaso({ paso, productos, permitirFront, onGuardar, onCancelar }: Props): JSX.Element {
  const [tipo, setTipo] = useState<'front' | 'upsell'>(paso?.tipo ?? (permitirFront ? 'front' : 'upsell'));
  const [permiteRechazo, setPermiteRechazo] = useState(paso?.permite_rechazo ?? false);
  const [nombre, setNombre] = useState(paso?.nombre ?? '');
  const [productoId, setProductoId] = useState(paso?.producto_id ?? productos[0]?.id ?? '');
  const [urlExterna, setUrlExterna] = useState(paso?.url_externa ?? '');
  const [slug, setSlug] = useState(paso?.slug ?? '');
  const [delaySegundos, setDelaySegundos] = useState(
    paso?.delay_segundos != null ? String(paso.delay_segundos) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const producto = productos.find((p) => p.id === productoId) ?? null;
  const slugNormalizado = previsualizarSlug(slug);
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  // El paso `front` no pregunta nada más que el producto. Todo lo demás no
  // aplica o se deriva:
  //   · nombre  → "Producto principal": es el único front del funnel, no hay
  //               nada de qué distinguirlo.
  //   · slug    → se deriva del nombre del producto. Es la URL del link de pago,
  //               y hacerla tipear es una oportunidad de escribirla mal sin
  //               ganar nada: nadie elige a mano el slug de su producto único.
  //   · url_externa → el front se sirve de este lado, en /pagos/<slug>. Pedir
  //               una URL externa para él es pedir un dato que no existe.
  //   · permite_rechazo → en el front no hay nada que rechazar: o compra o no.
  const esFront = tipo === 'front';

  function guardar(): void {
    if (!productoId) {
      setError('Elegí un producto.');
      return;
    }
    if (!esFront && nombre.trim().length < 2) {
      setError('El nombre de identificación es muy corto.');
      return;
    }
    // En el front el slug sale del nombre del producto; en un upsell se escribe.
    const slugFinal = esFront ? previsualizarSlug(producto?.nombre ?? '') : slugNormalizado;
    if (!slugFinal) {
      setError(
        esFront
          ? 'No se pudo derivar el slug del nombre del producto. Cambiale el nombre en Productos.'
          : 'El slug queda vacío. Probá con letras y números.',
      );
      return;
    }

    // El delay solo aplica al upsell: el front se abre directo en el browser,
    // no hay ningún botón que "aparezca" ahí. Vacío o inválido = sin demora,
    // no un error — es el estado normal de la mayoría de los pasos.
    const delayParseado = tipo === 'upsell' && delaySegundos.trim() !== '' ? Number(delaySegundos) : null;
    if (delayParseado != null && (!Number.isFinite(delayParseado) || delayParseado < 0 || delayParseado > 600)) {
      setError('La demora tiene que ser un número entre 0 y 600 segundos.');
      return;
    }

    onGuardar({
      id: paso?.id ?? null,
      slug: slugFinal,
      producto_id: productoId,
      tipo,
      nombre: esFront ? 'Producto principal' : nombre.trim(),
      url_externa: tipo === 'upsell' && urlExterna.trim() ? urlExterna.trim() : null,
      // En el front no hay rechazo posible: se fuerza en false sin importar el
      // estado del toggle, que además no se muestra.
      permite_rechazo: esFront ? false : permiteRechazo,
      producto: producto
        ? { id: producto.id, nombre: producto.nombre, precio: producto.precio, moneda: producto.moneda, imagen_url: null }
        : paso?.producto ?? { id: '', nombre: '', precio: '', moneda: 'usd', imagen_url: null },
      paso_aceptado_indice: paso?.paso_aceptado_indice ?? null,
      paso_rechazado_indice: paso?.paso_rechazado_indice ?? null,
      delay_segundos: delayParseado != null && delayParseado > 0 ? delayParseado : null,
    });
  }

  return (
    <Dialogo
      titulo={paso ? 'Editar paso' : 'Nuevo paso'}
      onCerrar={onCancelar}
      pie={
        <>
          <Boton variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={guardar}>
            Guardar paso
          </Boton>
        </>
      }
    >
      {permitirFront ? (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-tinta">Tipo de paso</legend>
          <div className="flex gap-2">
            <OpcionRadio
              name="tipo-paso"
              value="front"
              checked={tipo === 'front'}
              onChange={() => setTipo('front')}
              titulo="Producto principal"
              descripcion="Se abre en el browser"
            />
            <OpcionRadio
              name="tipo-paso"
              value="upsell"
              checked={tipo === 'upsell'}
              onChange={() => setTipo('upsell')}
              titulo="Upsell"
              descripcion="Lo cobra el botón del funnel"
            />
          </div>
        </fieldset>
      ) : null}

      {/* El toggle de rechazo no se muestra en el front: ahí no hay nada que
          rechazar — o compra o no compra. Mostrarlo invitaría a configurar un
          camino que el resolutor ignora (ver lib/funnels.ts, `permite_rechazo`). */}
      {esFront ? null : (
        <div className="flex items-start justify-between gap-4 rounded-ctrl border border-panel-borde bg-panel-sup2/50 px-3.5 py-3">
          <div className="min-w-0">
            <label htmlFor="toggle-rechazo" className="text-[13px] font-medium text-tinta">
              Activar botón de rechazo
            </label>
            <p className="mt-0.5 text-[12px] leading-relaxed text-tinta-3">
              Permite redirigir sin cobrar y habilita caminos de downsell.
            </p>
          </div>
          <Interruptor
            id="toggle-rechazo"
            activo={permiteRechazo}
            onCambiar={setPermiteRechazo}
            etiquetaAccesible="Activar botón de rechazo"
          />
        </div>
      )}

      {esFront ? null : (
        <Campo etiqueta="Nombre de identificación" htmlFor="nombre-paso">
          <input
            id="nombre-paso"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Upsell 1"
            className={clasesControl()}
          />
        </Campo>
      )}

      <Campo etiqueta="Producto" htmlFor="producto-paso">
        <select
          id="producto-paso"
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          className={clasesControl()}
        >
          <option value="">Elegí un producto…</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </Campo>

      {/* Solo lectura: el precio sale de productos.precio, no se edita acá. Un
          <output> y no un <input disabled>: no es un valor de formulario, es
          información derivada. */}
      <div className="space-y-1.5">
        <span className="block text-[13px] font-medium text-tinta">Oferta</span>
        <output
          className={unir(
            'block rounded-ctrl border border-panel-borde bg-panel-sup2 px-3 py-2',
            'font-mono text-sm tabular-nums text-tinta',
          )}
        >
          {producto ? formatearPrecio(producto.precio, producto.moneda) : <SinDato />}
        </output>
      </div>

      {tipo === 'upsell' ? (
        <Campo
          etiqueta="URL de la página externa"
          htmlFor="url-externa-paso"
          ayuda="Página donde el cliente verá la oferta."
        >
          <input
            id="url-externa-paso"
            value={urlExterna}
            onChange={(e) => setUrlExterna(e.target.value)}
            placeholder="https://elfunnel.com/upsell1"
            className={clasesControl()}
          />
        </Campo>
      ) : null}

      {tipo === 'upsell' ? (
        <Campo
          etiqueta="Demora del botón"
          htmlFor="delay-paso"
          ayuda="En segundos. El botón queda oculto hasta que pase este tiempo — pensado para que aparezca debajo del VSL en un punto fijo. Vacío o 0 = sin demora."
        >
          <input
            id="delay-paso"
            type="number"
            inputMode="numeric"
            min={0}
            max={600}
            step={1}
            value={delaySegundos}
            onChange={(e) => setDelaySegundos(e.target.value)}
            placeholder="0"
            className={clasesControl('font-mono')}
          />
        </Campo>
      ) : null}

      {esFront ? (
        <p className="rounded-ctrl border border-panel-borde bg-panel-sup2/50 px-3.5 py-3 text-[12px] leading-relaxed text-tinta-2">
          El link de pago se va a llamar{' '}
          <span className="font-mono text-tinta">
            {base}/pagos/{producto ? previsualizarSlug(producto.nombre) : '…'}
          </span>
          , derivado del nombre del producto. Si querés otro, cambiale el nombre en Productos.
        </p>
      ) : (
        <Campo
          etiqueta="Slug"
          htmlFor="slug-paso"
          ayuda={
            <>
              Es lo que el botón del funnel pone en{' '}
              <span className="font-mono text-tinta-2">data-hilvana-upsell</span>:{' '}
              <span className="font-mono text-tinta-2">
                {base}/pagos/{slugNormalizado || '…'}
              </span>
            </>
          }
        >
          <input
            id="slug-paso"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="upsell-1"
            className={clasesControl('font-mono')}
          />
        </Campo>
      )}

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-peligro">
          {error}
        </p>
      ) : null}
    </Dialogo>
  );
}
