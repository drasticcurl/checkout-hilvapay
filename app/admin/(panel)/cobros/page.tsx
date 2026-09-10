/**
 * `/admin/cobros` — solo lectura, los últimos 100 cobros. Sirve para
 * diagnosticar una venta puntual: estado, monto, decline_code, whop_payment_id.
 */
import { ultimosCobros } from '../../../../lib/admin/cobros';

export const dynamic = 'force-dynamic';

const ESTADO_LABEL: Record<string, string> = {
  creando: 'Creando',
  procesando: 'Procesando',
  pagado: 'Pagado',
  fallido: 'Fallido',
  requiere_tarjeta: 'Requiere tarjeta',
};

const ESTADO_COLOR: Record<string, string> = {
  creando: 'text-texto-suave',
  procesando: 'text-precio',
  pagado: 'text-comprar-oscuro',
  fallido: 'text-urgencia',
  requiere_tarjeta: 'text-urgencia',
};

export default async function CobrosPage(): Promise<JSX.Element> {
  const cobros = await ultimosCobros(100);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Últimos cobros</h1>
      <p className="text-sm text-texto-suave">Solo lectura. Los últimos {cobros.length} cobros.</p>

      {cobros.length === 0 ? (
        <p className="text-sm text-texto-suave">Todavía no hay cobros.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-borde bg-gray-50 text-texto-suave">
              <tr>
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Link</th>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Origen</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Monto</th>
                <th className="px-4 py-2 font-medium">Decline</th>
                <th className="px-4 py-2 font-medium">Payment ID</th>
              </tr>
            </thead>
            <tbody>
              {cobros.map((c) => (
                <tr key={c.id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-texto-suave">
                    {new Date(c.created_at).toLocaleString('es-AR')}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-texto">{c.pagina_slug}</code>
                  </td>
                  <td className="px-4 py-3 text-texto">{c.producto_nombre}</td>
                  <td className="px-4 py-3 text-texto-suave">{c.orden_email ?? '—'}</td>
                  <td className="px-4 py-3 text-texto-suave">{c.origen}</td>
                  <td className={`px-4 py-3 font-medium ${ESTADO_COLOR[c.status] ?? 'text-texto'}`}>
                    {ESTADO_LABEL[c.status] ?? c.status}
                  </td>
                  {/*
                    Un valor que no se puede calcular se muestra con un guion,
                    no con un cero: un cobro sin monto todavía no es un cobro de
                    $0 (regla 3 del §4 del task).
                  */}
                  <td className="px-4 py-3 text-texto">
                    {c.monto == null ? '—' : `${Number(c.monto).toFixed(2)} ${(c.moneda ?? '').toUpperCase()}`}
                  </td>
                  <td className="px-4 py-3 text-texto-suave">{c.decline_code ?? '—'}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-texto-suave">{c.whop_payment_id ?? '—'}</code>
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
