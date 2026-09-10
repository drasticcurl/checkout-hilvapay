import { listarOrigenes } from '../../../../lib/admin/origenes';
import { EliminarOrigenButton } from './EliminarOrigenButton';
import { FormularioOrigen } from './FormularioOrigen';
import { SwitchActivo } from '../SwitchActivo';

export const dynamic = 'force-dynamic';

export default async function OrigenesPage(): Promise<JSX.Element> {
  const origenes = await listarOrigenes();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Orígenes autorizados</h1>
      <p className="max-w-2xl text-sm text-texto-suave">
        La allowlist de CORS del cobro one-click. Sin el dominio del funnel activo acá, el botón de
        upsell del funnel va a recibir <strong>403</strong> al intentar cobrar.
      </p>

      <FormularioOrigen />

      {origenes.length === 0 ? (
        <p className="text-sm text-texto-suave">Todavía no hay orígenes autorizados.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-borde bg-gray-50 text-texto-suave">
              <tr>
                <th className="px-4 py-2 font-medium">Dominio</th>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Activo</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {origenes.map((o) => (
                <tr key={o.id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-3">
                    <code className="text-xs text-texto">{o.origen}</code>
                  </td>
                  <td className="px-4 py-3 text-texto-suave">{o.nombre ?? '—'}</td>
                  <td className="px-4 py-3">
                    <SwitchActivo
                      id={o.id}
                      activo={o.activo}
                      endpoint="/api/admin/origenes"
                      mensajeConfirmacion={`¿Autorizar "${o.origen}" a disparar cobros one-click?`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EliminarOrigenButton id={o.id} origen={o.origen} />
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
