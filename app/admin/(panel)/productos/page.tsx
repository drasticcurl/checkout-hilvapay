import Link from 'next/link';
import { listarProductos } from '../../../../lib/admin/productos';
import { SwitchActivo } from '../SwitchActivo';

export const dynamic = 'force-dynamic';

export default async function ProductosPage(): Promise<JSX.Element> {
  const productos = await listarProductos();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-texto">Productos</h1>
        <Link
          href="/admin/productos/nuevo"
          className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro"
        >
          Nuevo producto
        </Link>
      </div>

      {productos.length === 0 ? (
        <p className="text-sm text-texto-suave">Todavía no hay productos.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-borde bg-gray-50 text-texto-suave">
              <tr>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Plan de Whop</th>
                <th className="px-4 py-2 font-medium">Precio</th>
                <th className="px-4 py-2 font-medium">Activo</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-3 text-texto">{p.nombre}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-texto-suave">{p.whop_plan_id}</code>
                  </td>
                  <td className="px-4 py-3 text-texto">
                    {Number(p.precio).toFixed(2)} {p.moneda.toUpperCase()}
                  </td>
                  <td className="px-4 py-3">
                    <SwitchActivo
                      id={p.id}
                      activo={p.activo}
                      endpoint="/api/admin/productos"
                      mensajeConfirmacion={`¿Activar "${p.nombre}"? Los links de pago que lo usen van a poder empezar a cobrarlo.`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/productos/${p.id}`}
                      className="text-sm font-medium text-precio hover:underline"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
