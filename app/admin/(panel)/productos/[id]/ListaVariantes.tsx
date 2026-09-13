'use client';

/**
 * Una variante de precio dentro de la ficha del producto: etiqueta editable,
 * `whop_plan_id` de solo lectura, precio y precio de anclaje editables, y el
 * slug/link de pago — esto es lo que reemplaza a la sección "Links" que T03
 * elimina del nav.
 *
 * El `whop_plan_id` no se edita nunca: cambiar qué plan cobra una variante no
 * es "editar", es borrar y crear otra (ver la nota de `actualizarPlan` en
 * lib/admin/productos.ts) — por eso viaja como `<Codigo>` de solo lectura, no
 * como input.
 *
 * El slug se guarda con el MISMO PATCH que ya usa `/admin/paginas` (ahora
 * retirada, T03): `app/api/admin/paginas/[id]/route.ts`. Ese endpoint no
 * acepta un PATCH parcial de "solo el slug" — exige `producto_id`/`tipo`
 * también — así que se reenvían los valores actuales de la página sin
 * tocarlos, solo cambia el slug.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowSquareOut, Star, Warning } from '@phosphor-icons/react/ssr';
import type { ProductoPlan } from '../../../../../lib/tipos';
import { Aviso, Boton, Campo, Codigo, EstadoVivo, Insignia, Tarjeta, clasesControl } from '@/components/panel/ui';
import { SwitchActivo } from '../../SwitchActivo';

/** La forma que devuelve la API: la variante más su página resuelta. */
type PaginaDeVariante = {
  id: string;
  slug: string;
  activo: boolean;
  producto_id: string;
  tipo: 'front' | 'upsell';
  url_exito: string | null;
  url_rechazo: string | null;
  config: Record<string, unknown>;
};

export type PlanConPagina = ProductoPlan & { pagina: PaginaDeVariante | null };

/** Normaliza igual que `previsualizarSlug` del panel: minúsculas y guiones, solo para la vista previa del link mientras se escribe. */
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

function VarianteCard({ plan }: { plan: PlanConPagina }): JSX.Element {
  const router = useRouter();

  const [etiqueta, setEtiqueta] = useState(plan.etiqueta);
  const [precio, setPrecio] = useState(plan.precio);
  const [precioAnclaje, setPrecioAnclaje] = useState(plan.precio_anclaje ?? '');
  const [slug, setSlug] = useState(plan.pagina?.slug ?? '');

  const [enviandoDatos, setEnviandoDatos] = useState(false);
  const [errorDatos, setErrorDatos] = useState<string | null>(null);
  const [guardadoDatos, setGuardadoDatos] = useState(false);

  const [enviandoSlug, setEnviandoSlug] = useState(false);
  const [errorSlug, setErrorSlug] = useState<string | null>(null);
  const [guardadoSlug, setGuardadoSlug] = useState(false);

  const [haciendoDefault, setHaciendoDefault] = useState(false);

  async function guardarDatos(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviandoDatos(true);
    setErrorDatos(null);
    setGuardadoDatos(false);
    try {
      const res = await fetch(`/api/admin/productos/${plan.producto_id}/planes/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          etiqueta,
          precio,
          precio_anclaje: precioAnclaje.trim() ? precioAnclaje : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorDatos(data.error ?? 'error_desconocido');
        return;
      }
      setGuardadoDatos(true);
      router.refresh();
    } finally {
      setEnviandoDatos(false);
    }
  }

  async function guardarSlug(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!plan.pagina) return;
    setEnviandoSlug(true);
    setErrorSlug(null);
    setGuardadoSlug(false);
    try {
      // Reenvía TODOS los campos que el PATCH exige, no solo el slug: ese
      // endpoint (de la pantalla "Links" que se está retirando) no distingue
      // una edición parcial de una completa salvo que el body sea
      // exclusivamente `{ activo }`.
      const res = await fetch(`/api/admin/paginas/${plan.pagina.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          producto_id: plan.pagina.producto_id,
          tipo: plan.pagina.tipo,
          url_exito: plan.pagina.url_exito,
          url_rechazo: plan.pagina.url_rechazo,
          config: plan.pagina.config,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorSlug(data.error ?? 'error_desconocido');
        return;
      }
      setGuardadoSlug(true);
      router.refresh();
    } finally {
      setEnviandoSlug(false);
    }
  }

  async function hacerDefault(): Promise<void> {
    setHaciendoDefault(true);
    try {
      await fetch(`/api/admin/productos/${plan.producto_id}/planes/${plan.id}/default`, { method: 'POST' });
      router.refresh();
    } finally {
      setHaciendoDefault(false);
    }
  }

  return (
    <Tarjeta className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {plan.es_default ? (
            <Insignia tono="acento" icono={<Star size={11} weight="fill" aria-hidden="true" />}>
              default
            </Insignia>
          ) : null}
          <Codigo>{plan.whop_plan_id}</Codigo>
        </div>
        {!plan.es_default ? (
          <Boton variante="fantasma" tamano="sm" onClick={hacerDefault} disabled={haciendoDefault}>
            {haciendoDefault ? 'Guardando…' : 'Hacer default'}
          </Boton>
        ) : null}
      </div>

      <form onSubmit={guardarDatos} className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Etiqueta" htmlFor={`plan-etiqueta-${plan.id}`}>
          <input
            id={`plan-etiqueta-${plan.id}`}
            type="text"
            required
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            className={clasesControl()}
          />
        </Campo>
        <Campo etiqueta="Precio" htmlFor={`plan-precio-${plan.id}`}>
          <input
            id={`plan-precio-${plan.id}`}
            type="text"
            inputMode="decimal"
            required
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className={clasesControl('font-mono tabular-nums')}
          />
        </Campo>
        <Campo etiqueta="Precio de anclaje" htmlFor={`plan-anclaje-${plan.id}`} opcional>
          <input
            id={`plan-anclaje-${plan.id}`}
            type="text"
            inputMode="decimal"
            value={precioAnclaje}
            onChange={(e) => setPrecioAnclaje(e.target.value)}
            className={clasesControl('font-mono tabular-nums')}
          />
        </Campo>

        <div className="col-span-full flex items-center gap-3">
          <Boton type="submit" variante="secundario" tamano="sm" disabled={enviandoDatos}>
            {enviandoDatos ? 'Guardando…' : 'Guardar precio'}
          </Boton>
          {guardadoDatos && !enviandoDatos ? (
            <span className="text-[12px] font-medium text-vivo-oscuro">Guardado.</span>
          ) : null}
          {errorDatos ? (
            <span role="alert" className="text-[12px] font-medium text-peligro">
              No se pudo guardar ({errorDatos}).
            </span>
          ) : null}
        </div>
      </form>

      <div className="border-t border-panel-borde pt-4">
        {plan.pagina ? (
          <form onSubmit={guardarSlug} className="space-y-2.5">
            <div className="flex flex-wrap items-end gap-3">
              <Campo
                etiqueta="Slug del link"
                htmlFor={`plan-slug-${plan.id}`}
                className="min-w-[14rem] flex-1"
                ayuda={
                  <>
                    /pagos/<span className="font-mono text-tinta-2">{previsualizarSlug(slug) || '…'}</span>
                  </>
                }
              >
                <input
                  id={`plan-slug-${plan.id}`}
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className={clasesControl('font-mono')}
                />
              </Campo>
              <div className="flex items-center gap-2 pb-1.5">
                <SwitchActivo
                  id={plan.pagina.id}
                  activo={plan.pagina.activo}
                  endpoint="/api/admin/paginas"
                  etiqueta={`el link de "${plan.etiqueta}"`}
                  mensajeConfirmacion={`/pagos/${plan.pagina.slug} va a poder empezar a cobrar.`}
                />
                <EstadoVivo activo={plan.pagina.activo} />
              </div>
              <a
                href={`/pagos/${plan.pagina.slug}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 pb-1.5 text-[12px] font-medium text-acento hover:text-acento-oscuro hover:underline"
              >
                Ver <ArrowSquareOut size={11} aria-hidden="true" />
              </a>
            </div>

            <div className="flex items-center gap-3">
              <Boton type="submit" variante="secundario" tamano="sm" disabled={enviandoSlug}>
                {enviandoSlug ? 'Guardando…' : 'Guardar slug'}
              </Boton>
              {guardadoSlug && !enviandoSlug ? (
                <span className="text-[12px] font-medium text-vivo-oscuro">Guardado.</span>
              ) : null}
              {errorSlug ? (
                <span role="alert" className="text-[12px] font-medium text-peligro">
                  No se pudo guardar (
                  {errorSlug === 'slug_ya_existe' ? 'ese slug ya está en uso' : errorSlug}).
                </span>
              ) : null}
            </div>
          </form>
        ) : (
          <Aviso tono="alerta" icono={<Warning size={15} aria-hidden="true" />}>
            Esta variante todavía no tiene ningún link de pago apuntándole. Se crea desde el editor de
            funnels, no desde esta ficha.
          </Aviso>
        )}
      </div>
    </Tarjeta>
  );
}

export function ListaVariantes({ planes }: { planes: PlanConPagina[] }): JSX.Element {
  return (
    <div className="space-y-3">
      {planes.map((plan) => (
        <VarianteCard key={plan.id} plan={plan} />
      ))}
    </div>
  );
}
