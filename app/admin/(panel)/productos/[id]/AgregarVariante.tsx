'use client';

/**
 * "Agregar variante": ofrece los planes del catálogo de Whop que comparten
 * `whop_product_id` con este producto y todavía no están vinculados a nadie —
 * mismo patrón visual que `FormularioVincular.tsx` de `/admin/catalogo`, pero
 * acotado a un único `access_pass` en vez de mostrar todo el catálogo.
 *
 * Si el producto no tiene `whop_product_id` (se vinculó a mano, sin pasar por
 * el catálogo), no hay ningún access_pass del que traer más variantes — el
 * botón ofrece directamente el campo manual de `plan_id`.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Warning } from '@phosphor-icons/react/ssr';
import type { Catalogo, PlanDelCatalogo } from '../../../../../lib/admin/catalogo';
import { Aviso, Boton, Campo, Codigo, Tarjeta, clasesControl } from '@/components/panel/ui';

type Props = { productoId: string; whopProductId: string | null };

export function AgregarVariante({ productoId, whopProductId }: Props): JSX.Element {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <div>
      {!abierto ? (
        <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)} icono={<Plus size={14} aria-hidden="true" />}>
          Agregar variante
        </Boton>
      ) : (
        <FormularioAgregar
          productoId={productoId}
          whopProductId={whopProductId}
          onListo={() => {
            setAbierto(false);
            router.refresh();
          }}
          onCancelar={() => setAbierto(false)}
        />
      )}
    </div>
  );
}

function FormularioAgregar({
  productoId,
  whopProductId,
  onListo,
  onCancelar,
}: {
  productoId: string;
  whopProductId: string | null;
  onListo: () => void;
  onCancelar: () => void;
}): JSX.Element {
  const [planesLibres, setPlanesLibres] = useState<PlanDelCatalogo[] | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [modoManual, setModoManual] = useState(!whopProductId);

  const [planId, setPlanId] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [precio, setPrecio] = useState('');
  const [precioAnclaje, setPrecioAnclaje] = useState('');
  const [moneda, setMoneda] = useState('usd');
  const [whopNombreSoft, setWhopNombreSoft] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin `whop_product_id` no hay ningún access_pass del que filtrar — se pasa
  // directo al campo manual sin pedirle nada a la API del catálogo.
  useEffect(() => {
    if (!whopProductId) {
      setCargando(false);
      return;
    }
    const control = new AbortController();
    fetch('/api/admin/whop/catalogo', { signal: control.signal })
      .then((r) => r.json())
      .then((data: Catalogo) => {
        const producto = data.productos.find((p) => p.whop_product_id === whopProductId);
        const libres = (producto?.planes ?? []).filter((p) => !p.vinculado);
        setPlanesLibres(libres);
        setWhopNombreSoft(producto?.titulo ?? null);
        if (libres.length === 0) setModoManual(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setErrorCatalogo(err instanceof Error ? err.message : String(err));
        setModoManual(true);
      })
      .finally(() => setCargando(false));
    return () => control.abort();
  }, [whopProductId]);

  function alElegirPlanLibre(id: string): void {
    setPlanId(id);
    const plan = planesLibres?.find((p) => p.plan_id === id);
    if (plan) {
      setPrecio(plan.precio);
      setMoneda(plan.moneda);
    }
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/productos/${productoId}/planes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whop_plan_id: planId,
          whop_nombre_soft: whopNombreSoft,
          etiqueta: etiqueta.trim() || 'Variante',
          precio,
          moneda,
          precio_anclaje: precioAnclaje.trim() ? precioAnclaje : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'error_desconocido');
        return;
      }
      onListo();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tarjeta className="max-w-xl space-y-4 p-4">
      {cargando ? (
        <p className="text-[13px] text-tinta-3">Consultando el catálogo de Whop…</p>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          {!modoManual ? (
            <>
              <Campo etiqueta="Plan del mismo producto en Whop" htmlFor="agregar-plan">
                <select
                  id="agregar-plan"
                  required
                  value={planId}
                  onChange={(e) => alElegirPlanLibre(e.target.value)}
                  className={clasesControl()}
                >
                  <option value="">Elegí un plan…</option>
                  {planesLibres?.map((p) => (
                    <option key={p.plan_id} value={p.plan_id}>
                      {p.plan_id} · {p.precio} {p.moneda.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Campo>
              {planesLibres?.length === 0 ? (
                <Aviso tono="alerta" icono={<Warning size={15} aria-hidden="true" />}>
                  Este access_pass no tiene otro plan libre en Whop. Creá uno nuevo en el dashboard de Whop,
                  o pegá el plan_id a mano.
                </Aviso>
              ) : null}
              <button
                type="button"
                onClick={() => setModoManual(true)}
                className="text-[12px] font-medium text-acento transition-colors hover:underline"
              >
                Prefiero pegar el plan_id a mano
              </button>
            </>
          ) : (
            <>
              <Campo etiqueta="Plan de Whop" htmlFor="agregar-plan-manual">
                <input
                  id="agregar-plan-manual"
                  type="text"
                  required
                  placeholder="plan_xxxxxxxxxxxx"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className={clasesControl('font-mono')}
                />
              </Campo>
              {errorCatalogo ? (
                <p className="text-[12px] leading-relaxed text-peligro">
                  No se pudo leer el catálogo ({errorCatalogo}). Pegá el plan_id a mano.
                </p>
              ) : null}
              {whopProductId && planesLibres && planesLibres.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setModoManual(false)}
                  className="text-[12px] font-medium text-acento transition-colors hover:underline"
                >
                  Usar el selector
                </button>
              ) : null}
            </>
          )}

          {whopProductId ? (
            <p className="text-[12px] text-tinta-3">
              Acotado al mismo access_pass: <Codigo>{whopProductId}</Codigo>
            </p>
          ) : (
            <Aviso tono="alerta" icono={<Warning size={15} aria-hidden="true" />}>
              Este producto no tiene un access_pass de Whop asociado (se vinculó a mano). No hay catálogo
              del que filtrar — el plan_id que pegues abajo se guarda tal cual.
            </Aviso>
          )}

          <Campo etiqueta="Etiqueta" htmlFor="agregar-etiqueta" ayuda="Ej. 'Oferta', 'Downsell'.">
            <input
              id="agregar-etiqueta"
              type="text"
              required
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
              className={clasesControl()}
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Precio" htmlFor="agregar-precio">
              <input
                id="agregar-precio"
                type="text"
                inputMode="decimal"
                required
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                className={clasesControl('font-mono tabular-nums')}
              />
            </Campo>
            <Campo etiqueta="Precio de anclaje" htmlFor="agregar-anclaje" opcional>
              <input
                id="agregar-anclaje"
                type="text"
                inputMode="decimal"
                value={precioAnclaje}
                onChange={(e) => setPrecioAnclaje(e.target.value)}
                className={clasesControl('font-mono tabular-nums')}
              />
            </Campo>
          </div>

          {error ? (
            <p role="alert" className="text-[13px] font-medium text-peligro">
              No se pudo agregar (
              {error === 'plan_ya_vinculado' ? 'ese plan ya está vinculado a otro producto' : error}).
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Boton type="submit" variante="primario" tamano="sm" disabled={enviando}>
              {enviando ? 'Agregando…' : 'Agregar variante'}
            </Boton>
            <Boton variante="fantasma" tamano="sm" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </Boton>
          </div>
        </form>
      )}
    </Tarjeta>
  );
}
