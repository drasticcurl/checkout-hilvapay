/**
 * `/admin` — la lista de links de pago. Es la pantalla de inicio porque es lo
 * que se mira todos los días: slug, producto, precio, estado, y el switch para
 * encender o apagar el cobro sin redeploy.
 */
import Link from 'next/link';
import { listarPaginasConProducto } from '../../../lib/admin/paginas';
import { CopiarUrlButton } from './CopiarUrlButton';
import { SwitchActivo } from './SwitchActivo';

export const dynamic = 'force-dynamic';

function formatearPrecio(precio: string, moneda: string): string {
  return `${Number(precio).toFixed(2)} ${moneda.toUpperCase()}`;
}

export default async function AdminHomePage(): Promise<JSX.Element> {
  const paginas = await listarPaginasConProducto();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-texto">Links de pago</h1>
        <Link
          href="/admin/paginas/nuevo"
          className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro"
        >
          Nuevo link
        </Link>
      </div>

      {paginas.length === 0 ? (
        <p className="text-sm text-texto-suave">Todavía no hay links de pago creados.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-borde bg-gray-50 text-texto-suave">
              <tr>
                <th className="px-4 py-2 font-medium">Slug / URL</th>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Precio</th>
                <th className="px-4 py-2 font-medium">Activo</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {paginas.map((p) => {
                const url = `${base}/pagos/${p.slug}`;
                return (
                  <tr key={p.id} className="border-b border-borde last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-texto">{url || `/pagos/${p.slug}`}</code>
                        <CopiarUrlButton url={url || `/pagos/${p.slug}`} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-texto">{p.producto.nombre}</td>
                    <td className="px-4 py-3 text-texto-suave">{p.tipo}</td>
                    <td className="px-4 py-3 text-texto">
                      {formatearPrecio(p.producto.precio, p.producto.moneda)}
                    </td>
                    <td className="px-4 py-3">
                      <SwitchActivo
                        id={p.id}
                        activo={p.activo}
                        endpoint="/api/admin/paginas"
                        mensajeConfirmacion={`¿Activar "/pagos/${p.slug}"? A partir de ahora este link empieza a cobrar tarjetas reales.`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/paginas/${p.id}`}
                        className="text-sm font-medium text-precio hover:underline"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
