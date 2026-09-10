'use client';

/**
 * Formulario de alta/edición de producto. El selector de plan de Whop tiene
 * fallback manual (P-09: el path de `GET /plans` puede no responder), y el
 * aviso de precio (D10) se recalcula cada vez que cambia el plan o el precio
 * mostrado, visible en pantalla y no en un tooltip. No bloquea el guardado.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlanWhop } from '../../../../lib/whop';
import type { Producto } from '../../../../lib/tipos';

type Props = { producto?: Producto };

type VerificacionPrecio = { coincide: boolean; precioReal: string; moneda: string } | null;

export function FormularioProducto({ producto }: Props): JSX.Element {
  const router = useRouter();
  const editando = Boolean(producto);

  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [planId, setPlanId] = useState(producto?.whop_plan_id ?? '');
  const [precio, setPrecio] = useState(producto?.precio ?? '');
  const [precioAnclaje, setPrecioAnclaje] = useState(producto?.precio_anclaje ?? '');
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '');
  const [imagenUrl, setImagenUrl] = useState(producto?.imagen_url ?? '');

  const [planes, setPlanes] = useState<PlanWhop[]>([]);
  const [errorPlanes, setErrorPlanes] = useState<string | null>(null);
  const [modoManual, setModoManual] = useState(false);

  const [verificacion, setVerificacion] = useState<VerificacionPrecio>(null);
  const [verificando, setVerificando] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/productos/planes')
      .then((r) => r.json())
      .then((data: { planes: PlanWhop[]; error: string | null }) => {
        setPlanes(data.planes);
        setErrorPlanes(data.error);
        // Si Whop no responde, el fallback manual es el único camino: no hay
        // otra forma de asociar un producto sin el selector.
        if (data.error || data.planes.length === 0) setModoManual(true);
      })
      .catch((err) => {
        setErrorPlanes(err instanceof Error ? err.message : String(err));
        setModoManual(true);
      });
  }, []);

  // La comparación de D10 se recalcula cada vez que cambia el plan o el precio
  // mostrado, con un debounce corto para no pegarle a la API en cada tecla.
  useEffect(() => {
    if (!planId.trim() || !precio.trim() || Number.isNaN(Number(precio))) {
      setVerificacion(null);
      return;
    }
    const timeout = setTimeout(async () => {
      setVerificando(true);
      try {
        const res = await fetch('/api/admin/productos/verificar-precio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId, precio }),
        });
        const data: { resultado: VerificacionPrecio } = await res.json();
        setVerificacion(data.resultado);
      } finally {
        setVerificando(false);
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [planId, precio]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const body = {
        nombre,
        whop_plan_id: planId,
        precio,
        precio_anclaje: precioAnclaje.trim() ? precioAnclaje : null,
        descripcion: descripcion.trim() ? descripcion : null,
        imagen_url: imagenUrl.trim() ? imagenUrl : null,
      };
      const res = await fetch(
        editando ? `/api/admin/productos/${producto!.id}` : '/api/admin/productos',
        {
          method: editando ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'error_desconocido');
        return;
      }
      router.push('/admin/productos');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <label className="block">
        <span className="block text-sm font-medium text-texto">Nombre real</span>
        <input
          type="text"
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
        <span className="mt-1 block text-xs text-texto-suave">
          El que ve el comprador. En Whop el plan puede llamarse distinto (nombre soft).
        </span>
      </label>

      <div className="block">
        <span className="block text-sm font-medium text-texto">Plan de Whop</span>

        {!modoManual ? (
          <>
            <select
              required
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
            >
              <option value="">Elegí un plan…</option>
              {planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.initial_price} {p.currency} {p.product ? `(${p.product.title})` : '(sin producto)'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setModoManual(true)}
              className="mt-1.5 text-xs font-medium text-precio hover:underline"
            >
              Prefiero pegar el plan_id a mano
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              required
              placeholder="plan_xxxxxxxxxxxx"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 font-mono text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
            />
            {errorPlanes && (
              <span className="mt-1 block text-xs text-urgencia">
                No se pudo cargar el selector de planes ({errorPlanes}). Pegá el plan_id a mano.
              </span>
            )}
            {planes.length > 0 && (
              <button
                type="button"
                onClick={() => setModoManual(false)}
                className="mt-1.5 text-xs font-medium text-precio hover:underline"
              >
                Usar el selector
              </button>
            )}
          </>
        )}
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-texto">Precio de display</span>
        <input
          type="text"
          inputMode="decimal"
          required
          placeholder="9.90"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>

      {/*
        El aviso de D10: visible en pantalla, no en un tooltip, y no bloquea el
        guardado — puede haber un caso legítimo (un promo code) y un panel que
        no deja guardar es un panel que se esquiva editando la base a mano.
      */}
      {verificando && <p className="text-sm text-texto-suave">Verificando el precio contra Whop…</p>}
      {!verificando && verificacion && !verificacion.coincide && (
        <p role="alert" className="rounded-md border border-urgencia bg-red-50 px-3 py-2 text-sm text-urgencia">
          ⚠ El precio de display ({Number(precio).toFixed(2)}) NO coincide con el precio real del plan
          en Whop ({verificacion.precioReal} {verificacion.moneda.toUpperCase()}). Se puede guardar
          igual, pero el checkout va a cobrar el precio de Whop, no este.
        </p>
      )}
      {!verificando && verificacion && verificacion.coincide && (
        <p className="text-sm text-comprar-oscuro">✓ Coincide con el precio real del plan en Whop.</p>
      )}
      {!verificando && planId.trim() && precio.trim() && verificacion === null && (
        <p className="text-sm text-texto-suave">No se pudo verificar el precio contra Whop todavía.</p>
      )}

      <label className="block">
        <span className="block text-sm font-medium text-texto">Precio de anclaje (tachado, opcional)</span>
        <input
          type="text"
          inputMode="decimal"
          value={precioAnclaje ?? ''}
          onChange={(e) => setPrecioAnclaje(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-texto">Imagen (URL, opcional)</span>
        <input
          type="text"
          value={imagenUrl ?? ''}
          onChange={(e) => setImagenUrl(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-texto">Descripción (opcional)</span>
        <textarea
          value={descripcion ?? ''}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-urgencia">
          No se pudo guardar ({error}).
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-comprar px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro disabled:opacity-50"
      >
        {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear producto'}
      </button>
    </form>
  );
}
