'use client';

/**
 * Formulario de alta/edición de producto. El selector de plan de Whop tiene
 * fallback manual (P-09: el path de `GET /plans` puede no responder), y el
 * aviso de precio (D10) se recalcula cada vez que cambia el plan o el precio
 * mostrado, visible en pantalla y no en un tooltip. No bloquea el guardado.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageSquare, Warning, X } from '@phosphor-icons/react/ssr';
import type { PlanWhop } from '../../../../lib/whop';
import type { Producto } from '../../../../lib/tipos';
import { Boton, Campo, Tarjeta, clasesControl, unir } from '@/components/panel/ui';

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
  const [subiendo, setSubiendo] = useState(false);
  const [errorImagen, setErrorImagen] = useState<string | null>(null);

  const [planes, setPlanes] = useState<PlanWhop[]>([]);
  const [errorPlanes, setErrorPlanes] = useState<string | null>(null);
  const [modoManual, setModoManual] = useState(false);

  const [verificacion, setVerificacion] = useState<VerificacionPrecio>(null);
  const [verificando, setVerificando] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El `abort` en el cleanup no es ceremonia: si alguien entra a esta pantalla y
  // navega antes de que Whop conteste, el `.then` corría sobre un componente ya
  // desmontado. Con la señal cortada, el fetch rechaza con AbortError y el catch
  // lo ignora en silencio, que es lo correcto: no es un error del usuario.
  useEffect(() => {
    const control = new AbortController();
    fetch('/api/admin/productos/planes', { signal: control.signal })
      .then((r) => r.json())
      .then((data: { planes: PlanWhop[]; error: string | null }) => {
        setPlanes(data.planes);
        setErrorPlanes(data.error);
        // Si Whop no responde, el fallback manual es el único camino: no hay
        // otra forma de asociar un producto sin el selector.
        if (data.error || data.planes.length === 0) setModoManual(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setErrorPlanes(err instanceof Error ? err.message : String(err));
        setModoManual(true);
      });
    return () => control.abort();
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

  /**
   * Sube la imagen y deja su URL en el estado. NO guarda el producto: eso lo hace
   * el botón de abajo. Así, si la subida anda pero el guardado falla, no queda un
   * producto a medias — solo un archivo huérfano en disco, que no molesta a nadie.
   */
  async function subirImagen(archivo: File): Promise<void> {
    setSubiendo(true);
    setErrorImagen(null);
    try {
      const fd = new FormData();
      fd.append('imagen', archivo);
      const res = await fetch('/api/admin/productos/imagen', { method: 'POST', body: fd });
      const data = (await res.json()) as { ok: boolean; url?: string; mensaje?: string };
      if (!res.ok || !data.ok || !data.url) {
        setErrorImagen(data.mensaje ?? 'No se pudo subir la imagen.');
        return;
      }
      setImagenUrl(data.url);
    } catch {
      setErrorImagen('No se pudo contactar al servidor.');
    } finally {
      setSubiendo(false);
    }
  }

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
    <form onSubmit={onSubmit} className="max-w-xl space-y-6">
      <Tarjeta className="space-y-5 p-5">
        <Campo
          etiqueta="Nombre real"
          htmlFor="producto-nombre"
          ayuda="El que ve el comprador. En Whop el plan puede llamarse distinto (nombre soft)."
        >
          <input
            id="producto-nombre"
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={clasesControl()}
          />
        </Campo>

        <div className="space-y-1.5">
          <label htmlFor="producto-plan" className="block text-[13px] font-medium text-tinta">
            Plan de Whop
          </label>

          {!modoManual ? (
            <>
              <select
                id="producto-plan"
                required
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className={clasesControl()}
              >
                <option value="">Elegí un plan…</option>
                {planes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.initial_price} {p.currency}{' '}
                    {p.product ? `(${p.product.title})` : '(sin producto)'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setModoManual(true)}
                className="text-[12px] font-medium text-acento transition-colors hover:text-acento-oscuro hover:underline"
              >
                Prefiero pegar el plan_id a mano
              </button>
            </>
          ) : (
            <>
              <input
                id="producto-plan"
                type="text"
                required
                placeholder="plan_xxxxxxxxxxxx"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className={clasesControl('font-mono')}
              />
              {errorPlanes ? (
                <p className="text-[12px] leading-relaxed text-peligro">
                  No se pudo cargar el selector de planes ({errorPlanes}). Pegá el plan_id a mano.
                </p>
              ) : null}
              {planes.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setModoManual(false)}
                  className="text-[12px] font-medium text-acento transition-colors hover:text-acento-oscuro hover:underline"
                >
                  Usar el selector
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Precio de display" htmlFor="producto-precio">
            <input
              id="producto-precio"
              type="text"
              inputMode="decimal"
              required
              placeholder="9.90"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              className={clasesControl('font-mono tabular-nums')}
            />
          </Campo>

          <Campo etiqueta="Precio de anclaje" htmlFor="producto-anclaje" opcional ayuda="Se muestra tachado.">
            <input
              id="producto-anclaje"
              type="text"
              inputMode="decimal"
              value={precioAnclaje ?? ''}
              onChange={(e) => setPrecioAnclaje(e.target.value)}
              className={clasesControl('font-mono tabular-nums')}
            />
          </Campo>
        </div>

        {/*
          El aviso de D10: visible en pantalla, no en un tooltip, y no bloquea el
          guardado — puede haber un caso legítimo (un promo code) y un panel que
          no deja guardar es un panel que se esquiva editando la base a mano.
        */}
        {verificando ? (
          <p className="text-[12px] text-tinta-3">Verificando el precio contra Whop…</p>
        ) : verificacion && !verificacion.coincide ? (
          <div
            role="alert"
            className="flex gap-2.5 rounded-ctrl border border-alerta-borde bg-alerta-suave px-3.5 py-3"
          >
            <Warning size={16} className="mt-px shrink-0 text-alerta" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-alerta">
              El precio de display ({Number(precio).toFixed(2)}) no coincide con el precio real del plan
              en Whop ({verificacion.precioReal} {verificacion.moneda.toUpperCase()}). Se puede guardar
              igual, pero el checkout va a cobrar el precio de Whop, no este.
            </p>
          </div>
        ) : verificacion && verificacion.coincide ? (
          <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-vivo-oscuro">
            <Check size={13} weight="bold" aria-hidden="true" />
            Coincide con el precio real del plan en Whop.
          </p>
        ) : planId.trim() && precio.trim() ? (
          <p className="text-[12px] text-tinta-3">No se pudo verificar el precio contra Whop todavía.</p>
        ) : null}
      </Tarjeta>

      {/* La imagen se SUBE. Antes se pedía una URL, que obligaba a tener la
          imagen hosteada en otro lado — y una URL ajena se puede caer o cambiar
          sin aviso, dejando la ficha del checkout con un hueco. El campo de URL
          queda abajo, plegado, para el caso de que la imagen ya esté hosteada. */}
      <Tarjeta className="space-y-4 p-5">
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-tinta">Imagen del producto</span>
          <p className="text-[12px] leading-relaxed text-tinta-3">
            JPG, PNG o WebP, hasta 2 MB. Se muestra a 56 px en el checkout.
          </p>
        </div>

        <div className="flex items-start gap-4">
          {imagenUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen subida al panel, sin dominio fijo para next/image
            <img
              src={imagenUrl}
              alt="Vista previa de la imagen del producto"
              className="h-16 w-16 shrink-0 rounded-ctrl border border-panel-borde object-cover"
            />
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-ctrl border border-dashed border-panel-bordeFuerte bg-panel-sup2 text-tinta-4"
              aria-hidden="true"
            >
              <ImageSquare size={20} />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <input
              id="imagen-archivo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={subiendo}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subirImagen(f);
                // Se limpia el input para que elegir el MISMO archivo otra vez
                // vuelva a disparar el onChange (si no, el navegador lo ignora).
                e.target.value = '';
              }}
              className={unir(
                'block w-full cursor-pointer text-[13px] text-tinta-2',
                'file:mr-3 file:cursor-pointer file:rounded-ctrl file:border-0 file:bg-tinta',
                'file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-white',
                'hover:file:bg-black disabled:opacity-50',
              )}
            />
            {subiendo ? <p className="text-[12px] text-tinta-3">Subiendo…</p> : null}
            {errorImagen ? (
              <p role="alert" className="text-[12px] font-medium text-peligro">
                {errorImagen}
              </p>
            ) : null}
            {imagenUrl ? (
              <button
                type="button"
                onClick={() => setImagenUrl('')}
                className="inline-flex items-center gap-1 rounded-micro text-[12px] font-medium text-tinta-3 transition-colors hover:text-peligro"
              >
                <X size={11} weight="bold" aria-hidden="true" />
                Quitar la imagen
              </button>
            ) : null}
          </div>
        </div>

        <details className="group">
          <summary className="cursor-pointer rounded-micro text-[12px] text-tinta-3 transition-colors hover:text-tinta-2">
            o usar una URL que ya tengo hosteada
          </summary>
          <input
            type="text"
            value={imagenUrl ?? ''}
            onChange={(e) => setImagenUrl(e.target.value)}
            placeholder="https://…"
            aria-label="URL de la imagen"
            className={clasesControl('mt-2 font-mono')}
          />
        </details>
      </Tarjeta>

      <Tarjeta className="p-5">
        <Campo etiqueta="Descripción" htmlFor="producto-descripcion" opcional>
          <textarea
            id="producto-descripcion"
            value={descripcion ?? ''}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            className={clasesControl('leading-relaxed', 'auto')}
          />
        </Campo>
      </Tarjeta>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-peligro">
          No se pudo guardar ({error}).
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Boton type="submit" variante="primario" tamano="lg" disabled={enviando}>
          {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear producto'}
        </Boton>
      </div>
    </form>
  );
}
