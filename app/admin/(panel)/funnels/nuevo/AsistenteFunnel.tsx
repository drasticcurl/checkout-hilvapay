'use client';

// [T04] Wizard previo al editor: exige producto principal + página de gracias
// (D8 del plan) antes de dejar ver cualquier forma de agregar un segundo paso.
//
// Vive en un archivo aparte de `page.tsx` porque ese es un server component
// (hace `await productosParaSelector()`) y este necesita estado de cliente —
// Next no permite mezclar las dos cosas en el mismo módulo. No es una task
// nueva ni una colisión: nadie más de esta ola toca `funnels/nuevo/`.
//
// Por qué NO le pasa a `EditorFunnel` un `funnel` sintético con el paso front
// ya adentro de `pasos`: `EditorFunnel.guardar()` manda `paso.id` tal cual al
// backend, y `guardarFunnel` (`lib/admin/funnels.ts`) decide INSERT vs UPDATE
// mirando si ese `id` es truthy — un id inventado para el paso sintético haría
// que intente un UPDATE sobre un id que no existe (0 filas afectadas, sin
// error) y el funnel se guardaría SIN el paso front. Es cobro real en
// producción: no vale la pena ese atajo visual. En su lugar, este wizard deja
// el producto y la página de gracias ya resueltos (eso sí es seguro: son
// estado inicial simple de `EditorFunnel`, `useState(funnel?.nombre ?? ...)`)
// y el operador confirma el paso front con un click más dentro del editor, ya
// con el producto correcto preseleccionado. Ver el resumen de la task T04
// para la prop que le faltaría a `EditorFunnel` para cerrar esto del todo.
import { useState } from 'react';
import { Package } from '@phosphor-icons/react/ssr';
import type { FunnelConPasos } from '../../../../../lib/admin/funnels';
import { Boton, Campo, EncabezadoPantalla, OpcionRadio, clasesControl } from '../../../../../components/panel/ui';
import { EditorFunnel } from '../EditorFunnel';

type ProductoSelector = { id: string; nombre: string; precio: string; moneda: string };

type Props = {
  productos: ProductoSelector[];
};

function formatearPrecio(precio: string, moneda: string): string {
  return `${moneda.toUpperCase() === 'USD' ? 'US$' : moneda.toUpperCase()} ${Number(precio).toFixed(2).replace('.', ',')}`;
}

/**
 * Estado del wizard antes de entrar al editor. Las tres cosas tienen que estar
 * completas — D8 es explícito: producto principal Y página de gracias, las dos
 * antes de dejar agregar el segundo paso.
 */
type EstadoWizard = {
  nombre: string;
  productoId: string;
  urlGracias: string;
};

function wizardCompleto(w: EstadoWizard): boolean {
  return w.nombre.trim().length >= 2 && w.productoId !== '' && w.urlGracias.trim() !== '';
}

export function AsistenteFunnel({ productos }: Props): JSX.Element {
  const [wizard, setWizard] = useState<EstadoWizard>({
    nombre: 'Nuevo funnel',
    productoId: '',
    urlGracias: '',
  });
  const [confirmado, setConfirmado] = useState(false);

  // Una vez confirmado, se entra al editor con el nombre y la página de
  // gracias ya resueltos. El editor sigue siendo el mismo de siempre — no se
  // le cambia lógica ni prop — así que agregar el paso front ahí es un solo
  // click más ("Agregar paso" → tipo "Producto principal"), ya con este mismo
  // producto elegido por default en el selector.
  if (confirmado) {
    const funnelInicial: FunnelConPasos = {
      id: '',
      nombre: wizard.nombre.trim(),
      url_gracias: wizard.urlGracias.trim(),
      activo: false,
      created_at: new Date(),
      updated_at: new Date(),
      pasos: [],
    };
    return <EditorFunnel funnel={funnelInicial} productos={productos} />;
  }

  const productoElegido = productos.find((p) => p.id === wizard.productoId) ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-5 rounded-card border border-panel-borde bg-panel-sup p-5 shadow-panel">
        <EncabezadoPantalla
          titulo="Antes de armar los pasos"
          descripcion="El producto principal y la página de gracias definen el funnel. Una vez elegidos, se agregan los upsells."
        />

        <Campo etiqueta="Nombre del funnel" htmlFor="wizard-nombre">
          <input
            id="wizard-nombre"
            value={wizard.nombre}
            onChange={(e) => setWizard((w) => ({ ...w, nombre: e.target.value }))}
            className={clasesControl()}
          />
        </Campo>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-tinta">Producto principal</legend>
          {productos.length === 0 ? (
            <p className="text-[13px] text-tinta-3">No hay productos vinculados todavía.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {productos.map((p) => (
                <OpcionRadio
                  key={p.id}
                  name="wizard-producto"
                  value={p.id}
                  checked={wizard.productoId === p.id}
                  onChange={() => setWizard((w) => ({ ...w, productoId: p.id }))}
                  titulo={p.nombre}
                  descripcion={formatearPrecio(p.precio, p.moneda)}
                />
              ))}
            </div>
          )}
        </fieldset>

        <Campo
          etiqueta="URL de la página de gracias"
          htmlFor="wizard-gracias"
          ayuda="A dónde va el comprador cuando el funnel termina y no hay más pasos configurados."
        >
          <input
            id="wizard-gracias"
            value={wizard.urlGracias}
            onChange={(e) => setWizard((w) => ({ ...w, urlGracias: e.target.value }))}
            placeholder="https://elfunnel.com/gracias"
            className={clasesControl()}
          />
        </Campo>

        <div className="flex items-center justify-between gap-4 border-t border-panel-borde pt-4">
          <p className="min-w-0 truncate text-[12px] text-tinta-3">
            {productoElegido ? (
              <>
                <Package size={13} aria-hidden="true" className="mr-1 inline-block align-[-2px]" />
                {productoElegido.nombre}
              </>
            ) : (
              'Elegí un producto para continuar.'
            )}
          </p>
          <Boton
            variante="primario"
            tamano="lg"
            disabled={!wizardCompleto(wizard)}
            onClick={() => setConfirmado(true)}
          >
            Continuar
          </Boton>
        </div>
      </div>
    </div>
  );
}
