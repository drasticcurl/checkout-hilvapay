/**
 * `/admin/funnels` — la lista de funnels: cuál producto dispara la cadena de
 * upsells, si está encendido, y accesos a editar/borrar.
 *
 * El producto que se muestra es el del paso `front` — es la oferta que ve el
 * comprador al entrar, y las siguientes filas del funnel dependen de esa.
 */
import Link from 'next/link';
import { listarFunnelsConPasos } from '../../../../lib/admin/funnels';
import { SwitchActivo } from '../SwitchActivo';
import { BorrarFunnelButton } from './BorrarFunnelButton';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatearPrecio(precio: string, moneda: string): string {
  return `${moneda.toUpperCase() === 'USD' ? 'US$' : moneda.toUpperCase()} ${Number(precio).toFixed(2).replace('.', ',')}`;
}

export default async function FunnelsPage(): Promise<JSX.Element> {
  const funnels = await listarFunnelsConPasos();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-texto">Funnels</h1>
        <Link
          href="/admin/funnels/nuevo"
          className="rounded-md bg-comprar px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-comprar-oscuro"
        >
          + Crear nuevo funnel
        </Link>
      </div>

      {funnels.length === 0 ? (
        <p className="text-sm text-texto-suave">Todavía no hay funnels creados.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-borde bg-gray-50 text-texto-suave">
              <tr>
                <th className="px-4 py-2 font-medium">Funnel</th>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {funnels.map((f) => {
                const front = f.pasos.find((p) => p.tipo === 'front');
                return (
                  <tr key={f.id} className="border-b border-borde last:border-0">
                    <td className="px-4 py-3 text-texto">{f.nombre}</td>
                    <td className="px-4 py-3">
                      {front ? (
                        <div>
                          <p className="text-texto">{front.producto.nombre}</p>
                          <p className="text-xs text-texto-suave">
                            {formatearPrecio(front.producto.precio, front.producto.moneda)}
                          </p>
                        </div>
                      ) : (
                        // Un funnel sin paso front todavía no se puede encender (el
                        // guardado lo exige), pero puede existir de forma transitoria
                        // mientras se está armando. Un guion, no un texto inventado.
                        <span className="text-texto-suave">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SwitchActivo
                        id={f.id}
                        activo={f.activo}
                        endpoint="/api/admin/funnels"
                        mensajeConfirmacion={`¿Activar "${f.nombre}"? A partir de ahora esta cadena completa empieza a cobrar tarjetas reales.`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/admin/funnels/${f.id}`}
                          className="text-sm font-medium text-precio hover:underline"
                        >
                          Ver / editar
                        </Link>
                        <BorrarFunnelButton id={f.id} nombre={f.nombre} />
                      </div>
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
