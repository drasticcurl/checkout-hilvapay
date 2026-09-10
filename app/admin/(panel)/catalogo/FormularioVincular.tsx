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
 * y viaja en un hidden.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlanDelCatalogo } from '../../../../lib/admin/catalogo';

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
    <form onSubmit={enviar} className="mt-3 space-y-3 rounded-md border border-borde bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-texto">Nombre que ve el comprador</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            minLength={2}
            className="w-full rounded-md border border-borde px-3 py-2 text-sm"
          />
          {nombreSoft && nombre !== nombreSoft ? (
            <span className="mt-1 block text-xs text-texto-suave">
              En Whop se llama “{nombreSoft}”. Está bien que difieran.
            </span>
          ) : null}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-texto">Slug del link</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="agua-de-arroz"
            className="w-full rounded-md border border-borde px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-texto-suave">
            El link va a ser /pagos/{slug ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : '…'}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-texto">Precio que se muestra</span>
          <div className="flex items-center gap-2">
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              required
              inputMode="decimal"
              className="w-full rounded-md border border-borde px-3 py-2 text-sm"
            />
            <span className="text-sm text-texto-suave">{plan.moneda.toUpperCase()}</span>
          </div>
          {precioDifiere ? (
            <span className="mt-1 block text-xs font-medium text-urgencia">
              El plan de Whop cobra {plan.precio} {plan.moneda.toUpperCase()}. Se va a mostrar {precio} y
              cobrar {plan.precio}.
            </span>
          ) : (
            <span className="mt-1 block text-xs text-texto-suave">
              Coincide con lo que cobra el plan en Whop.
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-texto">Tipo</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as 'front' | 'upsell')}
            className="w-full rounded-md border border-borde px-3 py-2 text-sm"
          >
            <option value="front">Front — se abre en el browser</option>
            <option value="upsell">Upsell — lo cobra el botón del funnel</option>
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-urgencia">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro disabled:opacity-50"
        >
          {enviando ? 'Vinculando…' : 'Vincular y crear el link'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md px-3 py-2 text-sm font-medium text-texto-suave hover:bg-gray-100"
        >
          Cancelar
        </button>
        <span className="text-xs text-texto-suave">Nace apagado. Lo prendés desde Links de pago.</span>
      </div>
    </form>
  );
}
