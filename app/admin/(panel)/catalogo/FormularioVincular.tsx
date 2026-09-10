'use client';

/**
 * El formulario de vinculación de un plan de Whop.
 *
 * Se abre debajo del plan que elegiste, ya con el precio real que devolvió la
 * API. Vos solo escribís el nombre que ve el comprador y el slug del link.
 *
 * Por qué el `plan_id` no es un campo editable: es el dato que decide QUÉ se
 * cobra, y tipearlo a mano es cómo un link termina cobrando el producto de otro
 * paso del funnel sin ningún síntoma visible. Viene de la lista que trajo la API
 * y viaja en el body sin pasar por un input.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Warning } from '@phosphor-icons/react/ssr';
import type { PlanDelCatalogo } from '../../../../lib/admin/catalogo';
import { Boton, Campo, clasesControl } from '@/components/panel/ui';

type Props = {
  plan: PlanDelCatalogo;
  whopProductId: string | null;
  /** El título del producto en Whop: el nombre "soft". */
  nombreSoft: string | null;
  onCancelar: () => void;
};

export function FormularioVincular({ plan, whopProductId, nombreSoft, onCancelar }: Props): JSX.Element {
  const router = useRouter();
  // El nombre arranca con el de Whop como punto de partida, no vacío: en muchos
  // casos alcanza con retocarlo, y un campo vacío invita a dejarlo en blanco.
  const [nombre, setNombre] = useState(nombreSoft ?? '');
  const [slug, setSlug] = useState('');
  const [tipo, setTipo] = useState<'front' | 'upsell'>('front');
  // El precio se puede editar (puede haber un promo code), pero arranca en el
  // real: es la defensa contra publicar un link que dice un número y cobra otro.
  const [precio, setPrecio] = useState(plan.precio);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const precioDifiere = Number(precio).toFixed(2) !== Number(plan.precio).toFixed(2);

  async function enviar(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/whop/vincular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whop_plan_id: plan.plan_id,
          whop_product_id: whopProductId,
          whop_nombre_soft: nombreSoft,
          nombre,
          precio,
          moneda: plan.moneda,
          slug,
          tipo,
        }),
      });
      const data = (await res.json()) as { ok: boolean; mensaje?: string; slug?: string };
      if (!res.ok || !data.ok) {
        setError(data.mensaje ?? 'No se pudo vincular.');
        return;
      }
      // `refresh` y no `push`: la lista de arriba se recalcula en el server y el
      // plan pasa a mostrarse como vinculado, sin sacarte de la pantalla.
      router.refresh();
      onCancelar();
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="mt-4 animate-aparecer-abajo space-y-4 rounded-card border border-panel-borde bg-panel-sup2/50 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="Nombre que ve el comprador"
          htmlFor="vincular-nombre"
          ayuda={
            nombreSoft && nombre !== nombreSoft
              ? `En Whop se llama "${nombreSoft}". Está bien que difieran.`
              : undefined
          }
        >
          <input
            id="vincular-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            minLength={2}
            className={clasesControl()}
          />
        </Campo>

        <Campo
          etiqueta="Slug del link"
          htmlFor="vincular-slug"
          ayuda={
            <>
              El link va a ser{' '}
              <span className="font-mono text-tinta-2">
                /pagos/{slug ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : '…'}
              </span>
            </>
          }
        >
          <input
            id="vincular-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="agua-de-arroz"
            className={clasesControl('font-mono')}
          />
        </Campo>

        <Campo
          etiqueta="Precio que se muestra"
          htmlFor="vincular-precio"
          ayuda={precioDifiere ? undefined : 'Coincide con lo que cobra el plan en Whop.'}
        >
          <div className="flex items-center gap-2">
            <input
              id="vincular-precio"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              required
              inputMode="decimal"
              className={clasesControl('font-mono tabular-nums')}
            />
            <span className="shrink-0 text-[13px] text-tinta-3">{plan.moneda.toUpperCase()}</span>
          </div>
        </Campo>

        <Campo etiqueta="Tipo" htmlFor="vincular-tipo">
          <select
            id="vincular-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as 'front' | 'upsell')}
            className={clasesControl()}
          >
            <option value="front">Front, se abre en el browser</option>
            <option value="upsell">Upsell, lo cobra el botón del funnel</option>
          </select>
        </Campo>
      </div>

      {/* Fuera de la grilla: es una advertencia sobre plata y ocupa el ancho
          completo, no la columna de un campo. */}
      {precioDifiere ? (
        <div className="flex gap-2.5 rounded-ctrl border border-alerta-borde bg-alerta-suave px-3.5 py-3">
          <Warning size={16} className="mt-px shrink-0 text-alerta" aria-hidden="true" />
          <p className="text-[13px] leading-relaxed text-alerta">
            El plan de Whop cobra{' '}
            <span className="font-mono font-semibold">
              {plan.precio} {plan.moneda.toUpperCase()}
            </span>
            . Se va a mostrar <span className="font-mono font-semibold">{precio}</span> y cobrar{' '}
            <span className="font-mono font-semibold">{plan.precio}</span>.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-peligro">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Boton type="submit" variante="primario" disabled={enviando}>
          {enviando ? 'Vinculando…' : 'Vincular y crear el link'}
        </Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Boton>
        <span className="text-[12px] text-tinta-3">Nace apagado. Lo prendés desde Links de pago.</span>
      </div>
    </form>
  );
}
