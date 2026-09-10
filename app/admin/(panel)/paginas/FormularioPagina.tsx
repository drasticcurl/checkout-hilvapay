'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ConfigPagina, Pagina, Producto } from '../../../../lib/tipos';

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
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <label className="block">
        <span className="block text-sm font-medium text-texto">Slug</span>
        <input
          type="text"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="aguadearroz1"
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 font-mono text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
        <span className="mt-1 block text-xs text-texto-suave">
          Se normaliza solo: minúsculas, sin espacios ni acentos. El link queda en /pagos/&lt;slug&gt;.
        </span>
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-texto">Producto</span>
        <select
          required
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        >
          <option value="">Elegí un producto…</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} — {Number(p.precio).toFixed(2)} {p.moneda.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="block">
        <legend className="text-sm font-medium text-texto">Tipo</legend>
        <div className="mt-1.5 flex gap-4">
          <label className="flex items-center gap-2 text-sm text-texto">
            <input type="radio" name="tipo" checked={tipo === 'front'} onChange={() => setTipo('front')} />
            Front (checkout completo)
          </label>
          <label className="flex items-center gap-2 text-sm text-texto">
            <input type="radio" name="tipo" checked={tipo === 'upsell'} onChange={() => setTipo('upsell')} />
            Upsell (cobro one-click)
          </label>
        </div>
      </fieldset>

      <label className="block">
        <span className="block text-sm font-medium text-texto">URL de éxito (opcional)</span>
        <input
          type="text"
          value={urlExito}
          onChange={(e) => setUrlExito(e.target.value)}
          placeholder="https://elfunnel.com/upsell1"
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-texto">URL de rechazo (opcional)</span>
        <input
          type="text"
          value={urlRechazo}
          onChange={(e) => setUrlRechazo(e.target.value)}
          placeholder="https://elfunnel.com/rechazado"
          className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
        />
      </label>

      <div className="rounded-lg border border-borde p-4">
        <h2 className="text-sm font-semibold text-texto">Configuración visual</h2>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-texto">
              Minutos del timer (vacío = sin timer)
            </span>
            <input
              type="number"
              min={0}
              value={timerMinutos}
              onChange={(e) => setTimerMinutos(e.target.value)}
              className="mt-1.5 w-32 rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-texto">Texto del botón</span>
            <input
              type="text"
              value={textoBoton}
              onChange={(e) => setTextoBoton(e.target.value)}
              placeholder="COMPRAR AHORA"
              className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-texto">
            <input
              type="checkbox"
              checked={badgeSeguro}
              onChange={(e) => setBadgeSeguro(e.target.checked)}
            />
            Mostrar la barra &quot;100% SEGURO&quot;
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-texto">Subtítulo (opcional)</span>
            <input
              type="text"
              value={subtitulo}
              onChange={(e) => setSubtitulo(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-borde px-3 py-2 text-sm text-texto focus:border-precio focus:outline-none focus:ring-1 focus:ring-precio"
            />
          </label>
        </div>
      </div>

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
        {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear link de pago'}
      </button>
    </form>
  );
}
