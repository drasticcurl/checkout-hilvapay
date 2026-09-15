'use client';

/**
 * Datos del producto: nombre, imagen, descripción. Un solo `<form>` de estos
 * tres campos, sin las variantes de precio mezcladas — cada variante tiene su
 * propio precio y su propio link, y viven en `ListaVariantes.tsx`.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageSquare, X } from '@phosphor-icons/react/ssr';
import type { Producto } from '../../../../../lib/tipos';
import { Boton, Campo, Tarjeta, clasesControl, unir } from '@/components/panel/ui';

type Props = { producto: Producto };

export function DatosProducto({ producto }: Props): JSX.Element {
  const router = useRouter();

  const [nombre, setNombre] = useState(producto.nombre);
  const [descripcion, setDescripcion] = useState(producto.descripcion ?? '');
  const [imagenUrl, setImagenUrl] = useState(producto.imagen_url ?? '');
  const [subiendo, setSubiendo] = useState(false);
  const [errorImagen, setErrorImagen] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

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
    setGuardado(false);
    try {
      const res = await fetch(`/api/admin/productos/${producto.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          whop_product_id: producto.whop_product_id,
          descripcion: descripcion.trim() ? descripcion : null,
          imagen_url: imagenUrl.trim() ? imagenUrl : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'error_desconocido');
        return;
      }
      setGuardado(true);
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Tarjeta className="space-y-5 p-5">
        <Campo etiqueta="Nombre real" htmlFor="producto-nombre" ayuda="El que ve el comprador.">
          <input
            id="producto-nombre"
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={clasesControl()}
          />
        </Campo>

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
                e.target.value = '';
              }}
              className={unir(
                'block w-full cursor-pointer text-[13px] text-tinta-2',
                // `panel-solida` (casi blanco) en vez de `bg-tinta`: en dark,
                // `tinta` es la escala de texto y ya no sirve como fondo sólido.
                'file:mr-3 file:cursor-pointer file:rounded-ctrl file:border-0 file:bg-panel-solida',
                'file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-panel-fondo',
                'hover:file:bg-tinta-2 disabled:opacity-50',
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

        <Campo etiqueta="Descripción" htmlFor="producto-descripcion" opcional>
          <textarea
            id="producto-descripcion"
            value={descripcion}
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

      <div className="flex items-center gap-3">
        <Boton type="submit" variante="primario" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar cambios'}
        </Boton>
        {guardado && !enviando ? (
          <span className="text-[12px] font-medium text-vivo">Guardado.</span>
        ) : null}
      </div>
    </form>
  );
}
