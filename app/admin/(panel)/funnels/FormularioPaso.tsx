'use client';

import { useState } from 'react';
import { Dialogo } from '@/components/panel/Dialogo';
import { Boton, Campo, Interruptor, OpcionRadio, SinDato, clasesControl, unir } from '@/components/panel/ui';
// [T05] el slug de un upsell ya no se tipea: se deriva del nombre del paso y
// se le agrega un sufijo anticolisión al guardar (D4/D3 del plan). Import de
// la función pura que declaró T01 — no se toca `integracion.ts`.
import { generarSlugConSufijo } from '../../../../lib/admin/integracion';

/**
 * Una VARIANTE de precio (`producto_planes`), no un producto — desde la
 * sesión "1 link de pago por variante", el editor ya no elige "qué producto"
 * sino "qué precio cobrar": un producto con precio completo y downsell
 * aparece como dos entradas separadas acá, cada una con su propio
 * `producto_plan_id` (el `id` de este tipo).
 */
type VarianteSelector = { id: string; nombre: string; etiqueta: string; precio: string; moneda: string };

/**
 * El paso tal como vive en el estado del editor: igual que `PasoDeFunnel` de
 * `lib/admin/funnels.ts` pero con las flechas como ÍNDICE dentro del array de
 * pasos, no como id — un paso nuevo no tiene id hasta que el funnel se guarda.
 */
export type PasoEditor = {
  /** `null` si el paso todavía no se guardó nunca. */
  id: string | null;
  slug: string;
  /** El id de la VARIANTE (`producto_planes.id`) elegida, no el del producto. */
  producto_plan_id: string;
  tipo: 'front' | 'upsell';
  nombre: string | null;
  url_externa: string | null;
  permite_rechazo: boolean;
  producto: { id: string; nombre: string; etiqueta: string; precio: string; moneda: string; imagen_url: string | null };
  paso_aceptado_indice: number | null;
  paso_rechazado_indice: number | null;
  /**
   * A dónde mandar si este upsell rebota por fondos insuficientes (migración
   * 014). Mismo criterio de índice que las dos anteriores, pero es un destino
   * aparte: no depende de `permite_rechazo`. Solo aplica a un paso `upsell`.
   */
  downsell_por_fondos_indice: number | null;
  /** Ver `PasoDeFunnel.delay_segundos` en `lib/admin/funnels.ts`. `null` = sin demora. */
  delay_segundos: number | null;
};

type Props = {
  /** `null` = paso nuevo. */
  paso: PasoEditor | null;
  variantes: VarianteSelector[];
  /** false cuando ya existe otro paso `front` en el funnel: no se puede elegir ese tipo. */
  permitirFront: boolean;
  onGuardar: (paso: PasoEditor) => void;
  onCancelar: () => void;
};

function formatearPrecio(precio: string, moneda: string): string {
  const simbolo = moneda.toUpperCase() === 'USD' ? '$' : `${moneda.toUpperCase()} `;
  return `${simbolo}${Number(precio).toFixed(2).replace(/\.00$/, '')}`;
}

/** "$37 - Shot Metabólico", o "$17 - Shot Metabólico (Downsell)" si la variante tiene una etiqueta que no es la genérica. */
function etiquetaVariante(v: VarianteSelector): string {
  const precio = formatearPrecio(v.precio, v.moneda);
  const esGenerica = v.etiqueta.trim().toLowerCase() === 'precio completo' || v.etiqueta.trim() === '';
  return esGenerica ? `${precio} - ${v.nombre}` : `${precio} - ${v.nombre} (${v.etiqueta})`;
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

export function FormularioPaso({ paso, variantes, permitirFront, onGuardar, onCancelar }: Props): JSX.Element {
  const [tipo, setTipo] = useState<'front' | 'upsell'>(paso?.tipo ?? (permitirFront ? 'front' : 'upsell'));
  const [permiteRechazo, setPermiteRechazo] = useState(paso?.permite_rechazo ?? false);
  const [nombre, setNombre] = useState(paso?.nombre ?? '');
  const [variantePlanId, setVariantePlanId] = useState(paso?.producto_plan_id ?? variantes[0]?.id ?? '');
  const [urlExterna, setUrlExterna] = useState(paso?.url_externa ?? '');
  const [delaySegundos, setDelaySegundos] = useState(
    paso?.delay_segundos != null ? String(paso.delay_segundos) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const variante = variantes.find((v) => v.id === variantePlanId) ?? null;
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  // El paso `front` no pregunta nada más que la variante. Todo lo demás no
  // aplica o se deriva:
  //   · nombre  → "Producto principal": es el único front del funnel, no hay
  //               nada de qué distinguirlo.
  //   · slug    → SIEMPRE generado, nunca lo tipea el usuario (D8 de la
  //               sesión "1 link por variante"): en el front sale del nombre
  //               del producto (estable, no cambia entre guardados); en un
  //               upsell sale del nombre del paso + sufijo anticolisión.
  //   · url_externa → el front se sirve de este lado, en /pagos/<slug>. Pedir
  //               una URL externa para él es pedir un dato que no existe.
  //   · permite_rechazo → en el front no hay nada que rechazar: o compra o no.
  const esFront = tipo === 'front';

  function guardar(): void {
    if (!variantePlanId) {
      setError('Elegí una variante de precio.');
      return;
    }
    if (!esFront && nombre.trim().length < 2) {
      setError('El nombre de identificación es muy corto.');
      return;
    }
    // El slug NUNCA lo tipea el usuario (D8): si el paso ya existía, se
    // conserva el que tiene — un paso en edición no regenera su slug ni
    // cuando cambia de variante, porque `guardarFunnel` es quien decide (del
    // lado del servidor) si esa variante ya tiene una página con OTRO slug
    // publicado y la reusa tal cual. Si el paso es nuevo, se genera acá nomás
    // como valor de entrada — el servidor lo descarta igual si la variante
    // elegida ya tenía página.
    const slugFinal = esFront
      ? previsualizarSlug(variante?.nombre ?? '')
      : paso?.slug ?? generarSlugConSufijo(nombre.trim());
    if (!slugFinal) {
      setError(
        esFront
          ? 'No se pudo derivar el slug del nombre del producto. Cambiale el nombre en Productos.'
          : 'No se pudo derivar el slug del nombre del paso. Probá con letras y números.',
      );
      return;
    }

    // El delay solo aplica al upsell: el front se abre directo en el browser,
    // no hay ningún botón que "aparezca" ahí. Vacío o inválido = sin demora,
    // no un error — es el estado normal de la mayoría de los pasos.
    const delayParseado = tipo === 'upsell' && delaySegundos.trim() !== '' ? Number(delaySegundos) : null;
    if (delayParseado != null && (!Number.isFinite(delayParseado) || delayParseado < 0 || delayParseado > 900)) {
      setError('La demora tiene que ser un número entre 0 y 900 segundos.');
      return;
    }

    onGuardar({
      id: paso?.id ?? null,
      slug: slugFinal,
      producto_plan_id: variantePlanId,
      tipo,
      nombre: esFront ? 'Producto principal' : nombre.trim(),
      url_externa: tipo === 'upsell' && urlExterna.trim() ? urlExterna.trim() : null,
      // En el front no hay rechazo posible: se fuerza en false sin importar el
      // estado del toggle, que además no se muestra.
      permite_rechazo: esFront ? false : permiteRechazo,
      producto: variante
        ? { id: variante.id, nombre: variante.nombre, etiqueta: variante.etiqueta, precio: variante.precio, moneda: variante.moneda, imagen_url: null }
        : paso?.producto ?? { id: '', nombre: '', etiqueta: '', precio: '', moneda: 'usd', imagen_url: null },
      paso_aceptado_indice: paso?.paso_aceptado_indice ?? null,
      paso_rechazado_indice: paso?.paso_rechazado_indice ?? null,
      downsell_por_fondos_indice: paso?.downsell_por_fondos_indice ?? null,
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

      {/* El selector muestra "$precio - nombre", ordenado por precio (ya
          viene ordenado así de `productosParaSelector`): con varios productos
          y varias variantes mezcladas, leer por precio evita confundir "Shot
          Metabólico $17 (Downsell)" con "Shot Metabólico $27" — antes el
          selector solo mostraba el nombre del producto y las dos variantes
          eran indistinguibles entre sí. */}
      <Campo etiqueta="Variante de precio" htmlFor="variante-paso">
        <select
          id="variante-paso"
          value={variantePlanId}
          onChange={(e) => setVariantePlanId(e.target.value)}
          className={clasesControl()}
        >
          <option value="">Elegí una variante…</option>
          {variantes.map((v) => (
            <option key={v.id} value={v.id}>
              {etiquetaVariante(v)}
            </option>
          ))}
        </select>
      </Campo>

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
            max={900}
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
            {base}/pagos/{variante ? previsualizarSlug(variante.nombre) : '…'}
          </span>
          , derivado del nombre del producto. Si querés otro, cambiale el nombre en Productos.
        </p>
      ) : (
        <p className="rounded-ctrl border border-panel-borde bg-panel-sup2/50 px-3.5 py-3 text-[12px] leading-relaxed text-tinta-2">
          El link de pago de este paso se genera solo, sin que lo tipees — si la variante ya tiene un
          link de otro lado, se reusa ese mismo en vez de crear uno nuevo.
        </p>
      )}

      {/* Solo lectura: el precio sale de la variante elegida, no se edita
          acá. Un <output> y no un <input disabled>: no es un valor de
          formulario, es información derivada. */}
      <div className="space-y-1.5">
        <span className="block text-[13px] font-medium text-tinta">Oferta</span>
        <output
          className={unir(
            'block rounded-ctrl border border-panel-borde bg-panel-sup2 px-3 py-2',
            'font-mono text-sm tabular-nums text-tinta',
          )}
        >
          {variante ? formatearPrecio(variante.precio, variante.moneda) : <SinDato />}
        </output>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-peligro">
          {error}
        </p>
      ) : null}
    </Dialogo>
  );
}
