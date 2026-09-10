'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ConfigPagina, Pagina, Producto } from '../../../../lib/tipos';
import {
  Boton,
  Campo,
  Interruptor,
  OpcionRadio,
  Tarjeta,
  clasesControl,
  unir,
} from '@/components/panel/ui';

type Props = { pagina?: Pagina; productos: Producto[] };

export function FormularioPagina({ pagina, productos }: Props): JSX.Element {
  const router = useRouter();
  const editando = Boolean(pagina);

  const [slug, setSlug] = useState(pagina?.slug ?? '');
  const [productoId, setProductoId] = useState(pagina?.producto_id ?? productos[0]?.id ?? '');
  const [tipo, setTipo] = useState<'front' | 'upsell'>(pagina?.tipo ?? 'front');
  const [urlExito, setUrlExito] = useState(pagina?.url_exito ?? '');
  const [urlRechazo, setUrlRechazo] = useState(pagina?.url_rechazo ?? '');

  const config: ConfigPagina = pagina?.config ?? {};
  const [timerMinutos, setTimerMinutos] = useState(config.timerMinutos?.toString() ?? '');
  const [textoBoton, setTextoBoton] = useState(config.textoBoton ?? '');
  const [badgeSeguro, setBadgeSeguro] = useState(config.badgeSeguro ?? true);
  const [subtitulo, setSubtitulo] = useState(config.subtitulo ?? '');

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const configPagina: ConfigPagina = {
        ...(timerMinutos.trim() ? { timerMinutos: Number(timerMinutos) } : {}),
        ...(textoBoton.trim() ? { textoBoton } : {}),
        badgeSeguro,
        ...(subtitulo.trim() ? { subtitulo } : {}),
      };
      const body = {
        slug,
        producto_id: productoId,
        tipo,
        url_exito: urlExito.trim() ? urlExito : null,
        url_rechazo: urlRechazo.trim() ? urlRechazo : null,
        config: configPagina,
      };
      const res = await fetch(editando ? `/api/admin/paginas/${pagina!.id}` : '/api/admin/paginas', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'error_desconocido');
        return;
      }
      router.push('/admin');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-6">
      <Tarjeta className="space-y-5 p-5">
        <Campo
          etiqueta="Slug"
          htmlFor="pagina-slug"
          ayuda="Se normaliza solo: minúsculas, sin espacios ni acentos. El link queda en /pagos/<slug>."
        >
          <input
            id="pagina-slug"
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="agua-de-arroz"
            className={clasesControl('font-mono')}
          />
        </Campo>

        <Campo etiqueta="Producto" htmlFor="pagina-producto">
          <select
            id="pagina-producto"
            required
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className={clasesControl()}
          >
            <option value="">Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {Number(p.precio).toFixed(2)} {p.moneda.toUpperCase()}
              </option>
            ))}
          </select>
        </Campo>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-tinta">Tipo</legend>
          <div className="flex gap-2">
            <OpcionRadio
              name="tipo"
              value="front"
              checked={tipo === 'front'}
              onChange={() => setTipo('front')}
              titulo="Front"
              descripcion="Checkout completo"
            />
            <OpcionRadio
              name="tipo"
              value="upsell"
              checked={tipo === 'upsell'}
              onChange={() => setTipo('upsell')}
              titulo="Upsell"
              descripcion="Cobro one-click"
            />
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="URL de éxito" htmlFor="pagina-exito" opcional>
            <input
              id="pagina-exito"
              type="text"
              value={urlExito}
              onChange={(e) => setUrlExito(e.target.value)}
              placeholder="https://elfunnel.com/upsell1"
              className={clasesControl()}
            />
          </Campo>

          <Campo etiqueta="URL de rechazo" htmlFor="pagina-rechazo" opcional>
            <input
              id="pagina-rechazo"
              type="text"
              value={urlRechazo}
              onChange={(e) => setUrlRechazo(e.target.value)}
              placeholder="https://elfunnel.com/rechazado"
              className={clasesControl()}
            />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta className="p-5">
        <h2 className="text-[13px] font-semibold text-tinta">Lo que ve el comprador</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-tinta-3">
          Estos cuatro campos son lo único configurable de la página de checkout.
        </p>

        <div className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Minutos del timer"
              htmlFor="pagina-timer"
              ayuda="Vacío = sin barra de urgencia."
            >
              <input
                id="pagina-timer"
                type="number"
                min={0}
                value={timerMinutos}
                onChange={(e) => setTimerMinutos(e.target.value)}
                className={clasesControl('font-mono tabular-nums')}
              />
            </Campo>

            <Campo
              etiqueta="Texto del botón"
              htmlFor="pagina-boton"
              ayuda="Vacío = COMPRAR AHORA."
            >
              <input
                id="pagina-boton"
                type="text"
                value={textoBoton}
                onChange={(e) => setTextoBoton(e.target.value)}
                placeholder="COMPRAR AHORA"
                className={clasesControl()}
              />
            </Campo>
          </div>

          <Campo etiqueta="Subtítulo" htmlFor="pagina-subtitulo" opcional>
            <input
              id="pagina-subtitulo"
              type="text"
              value={subtitulo}
              onChange={(e) => setSubtitulo(e.target.value)}
              className={clasesControl()}
            />
          </Campo>

          <div className="flex items-start justify-between gap-4 rounded-ctrl border border-panel-borde bg-panel-sup2/50 px-3.5 py-3">
            <div className="min-w-0">
              <label htmlFor="pagina-badge" className="text-[13px] font-medium text-tinta">
                Barra &quot;100% SEGURO&quot;
              </label>
              <p className="mt-0.5 text-[12px] leading-relaxed text-tinta-3">
                Va arriba de la ficha del producto, debajo del timer.
              </p>
            </div>
            <Interruptor
              id="pagina-badge"
              activo={badgeSeguro}
              onCambiar={setBadgeSeguro}
              etiquetaAccesible="Mostrar la barra 100% SEGURO"
            />
          </div>
        </div>
      </Tarjeta>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-peligro">
          No se pudo guardar ({error}).
        </p>
      ) : null}

      <div className={unir('flex items-center gap-2')}>
        <Boton type="submit" variante="primario" tamano="lg" disabled={enviando}>
          {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear link de pago'}
        </Boton>
      </div>
    </form>
  );
}
