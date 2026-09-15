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
import type { ConfigPagina, ProductoPlan } from '../../../../../lib/tipos';
import { Aviso, Boton, Campo, Codigo, EstadoVivo, Insignia, Interruptor, Tarjeta, clasesControl } from '@/components/panel/ui';
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
  config: ConfigPagina;
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

  // La barra roja "La oferta expira en …" del checkout (components/checkout/Timer.tsx).
  // Vacío = sin timer, que es lo que ya interpreta CheckoutContainer cuando
  // `config.timerMinutos` no está presente. Va como string en el input y se
  // parsea recién al guardar, igual que el patrón de `delaySegundos` en
  // FormularioPaso.
  const timerMinutosInicial = plan.pagina?.config?.timerMinutos;
  const [timerMinutos, setTimerMinutos] = useState(
    typeof timerMinutosInicial === 'number' ? String(timerMinutosInicial) : '',
  );
  // El resto de ConfigPagina (lib/tipos.ts): lo que CheckoutContainer lee para
  // dibujar la página, además del timer. Los cuatro campos se guardan juntos
  // con un solo submit — separarlos en cuatro forms como el timer no aporta
  // nada acá porque siempre se editan como "cómo se ve este checkout", no uno
  // por vez.
  const [textoBoton, setTextoBoton] = useState(plan.pagina?.config?.textoBoton ?? '');
  const [subtitulo, setSubtitulo] = useState(plan.pagina?.config?.subtitulo ?? '');
  const [badgeSeguro, setBadgeSeguro] = useState(plan.pagina?.config?.badgeSeguro !== false);
  const [enviandoChk, setEnviandoChk] = useState(false);
  const [errorChk, setErrorChk] = useState<string | null>(null);
  const [guardadoChk, setGuardadoChk] = useState(false);

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

  async function guardarCheckout(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!plan.pagina) return;
    const minutos = timerMinutos.trim();
    if (minutos !== '' && (!Number.isFinite(Number(minutos)) || Number(minutos) <= 0)) {
      setErrorChk('El timer tiene que ser un número de minutos mayor que 0, o vacío para apagarlo.');
      return;
    }
    setEnviandoChk(true);
    setErrorChk(null);
    setGuardadoChk(false);
    try {
      // Se parte de la config actual (por si tiene alguna clave que esta
      // pantalla no edita) y se pisan solo los cuatro campos de este form.
      // Vacío en timer/texto/subtítulo = se borra la clave, para que
      // CheckoutContainer tome el mismo default que una página que nunca
      // configuró nada (`config.timerMinutos ? … : null`, `?? 'COMPRAR AHORA'`).
      const configNueva: ConfigPagina = { ...plan.pagina.config };
      if (minutos === '') delete configNueva.timerMinutos;
      else configNueva.timerMinutos = Number(minutos);

      if (textoBoton.trim() === '') delete configNueva.textoBoton;
      else configNueva.textoBoton = textoBoton.trim();

      if (subtitulo.trim() === '') delete configNueva.subtitulo;
      else configNueva.subtitulo = subtitulo.trim();

      // badgeSeguro: default true, así que solo se escribe la clave cuando se
      // apaga. Guardar siempre `true` explícito no está mal, pero omitirlo
      // mantiene el jsonb más chico y es coherente con cómo quedaron las
      // páginas de antes de que este campo existiera (sin la clave).
      if (badgeSeguro) delete configNueva.badgeSeguro;
      else configNueva.badgeSeguro = false;

      // Mismo PATCH "reenviar todo" que guardarSlug: el endpoint no acepta
      // una edición parcial de config sola.
      const res = await fetch(`/api/admin/paginas/${plan.pagina.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: plan.pagina.slug,
          producto_id: plan.pagina.producto_id,
          tipo: plan.pagina.tipo,
          url_exito: plan.pagina.url_exito,
          url_rechazo: plan.pagina.url_rechazo,
          config: configNueva,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorChk(data.error ?? 'error_desconocido');
        return;
      }
      setGuardadoChk(true);
      router.refresh();
    } finally {
      setEnviandoChk(false);
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
            <span className="text-[12px] font-medium text-vivo">Guardado.</span>
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
                className="inline-flex items-center gap-1 pb-1.5 text-[12px] font-medium text-acento hover:underline"
              >
                Ver <ArrowSquareOut size={11} aria-hidden="true" />
              </a>
            </div>

            <div className="flex items-center gap-3">
              <Boton type="submit" variante="secundario" tamano="sm" disabled={enviandoSlug}>
                {enviandoSlug ? 'Guardando…' : 'Guardar slug'}
              </Boton>
              {guardadoSlug && !enviandoSlug ? (
                <span className="text-[12px] font-medium text-vivo">Guardado.</span>
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

      {plan.pagina ? (
        <div className="border-t border-panel-borde pt-4">
          <p className="mb-3 text-[13px] font-medium text-tinta">Modificar checkout</p>
          <form onSubmit={guardarCheckout} className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Barra de urgencia"
                htmlFor={`plan-timer-${plan.id}`}
                opcional
                ayuda={
                  timerMinutos.trim()
                    ? `"La oferta expira en ${timerMinutos} min". No bloquea la compra al llegar a cero.`
                    : 'Vacío = sin barra roja arriba del checkout.'
                }
              >
                <input
                  id={`plan-timer-${plan.id}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={timerMinutos}
                  onChange={(e) => setTimerMinutos(e.target.value)}
                  placeholder="Minutos, ej. 15"
                  className={clasesControl('font-mono tabular-nums')}
                />
              </Campo>
              <Campo
                etiqueta="Texto del botón"
                htmlFor={`plan-boton-${plan.id}`}
                opcional
                ayuda="Vacío = &quot;COMPRAR AHORA&quot;."
              >
                <input
                  id={`plan-boton-${plan.id}`}
                  type="text"
                  value={textoBoton}
                  onChange={(e) => setTextoBoton(e.target.value)}
                  placeholder="COMPRAR AHORA"
                  className={clasesControl()}
                />
              </Campo>
            </div>

            <Campo
              etiqueta="Bajada arriba del producto"
              htmlFor={`plan-subtitulo-${plan.id}`}
              opcional
              ayuda="Una línea corta que se muestra arriba del nombre del producto, en la card del checkout."
            >
              <input
                id={`plan-subtitulo-${plan.id}`}
                type="text"
                value={subtitulo}
                onChange={(e) => setSubtitulo(e.target.value)}
                placeholder="Sin bajada"
                className={clasesControl()}
              />
            </Campo>

            <div className="flex items-center justify-between gap-4 rounded-ctrl border border-panel-borde bg-panel-sup2/50 px-3.5 py-3">
              <div className="min-w-0">
                <label htmlFor={`plan-badge-${plan.id}`} className="text-[13px] font-medium text-tinta">
                  Badge &quot;100% SEGURO&quot;
                </label>
                <p className="mt-0.5 text-[12px] leading-relaxed text-tinta-3">
                  La barra verde debajo del timer, arriba de la card del producto.
                </p>
              </div>
              <Interruptor
                id={`plan-badge-${plan.id}`}
                activo={badgeSeguro}
                onCambiar={setBadgeSeguro}
                etiquetaAccesible="Mostrar el badge 100% seguro en este checkout"
              />
            </div>

            <div className="flex items-center gap-3">
              <Boton type="submit" variante="secundario" tamano="sm" disabled={enviandoChk}>
                {enviandoChk ? 'Guardando…' : 'Guardar checkout'}
              </Boton>
              {guardadoChk && !enviandoChk ? (
                <span className="text-[12px] font-medium text-vivo">Guardado.</span>
              ) : null}
              {errorChk ? (
                <span role="alert" className="text-[12px] font-medium text-peligro">
                  No se pudo guardar ({errorChk}).
                </span>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
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
