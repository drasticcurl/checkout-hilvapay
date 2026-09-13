/**
 * `/admin/origenes` — la allowlist de CORS del cobro one-click. Sin el dominio
 * del funnel activo acá, el botón de upsell recibe 403 al intentar cobrar.
 */
import { Fingerprint, Warning } from '@phosphor-icons/react/ssr';
import { listarOrigenes } from '../../../../lib/admin/origenes';
import { listarFunnelsConPasos } from '../../../../lib/admin/funnels';
import { integracionDesdeFunnel } from '../../../../lib/admin/integracion';
import {
  Aviso,
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  EstadoVivo,
  SinDato,
  TablaEnvoltorio,
  Td,
  Th,
  Tr,
} from '../../../../components/panel/ui';
import { ComoIntegrar } from '../../../../components/panel/ComoIntegrar';
import { SwitchActivo } from '../SwitchActivo';
import { EliminarOrigenButton } from './EliminarOrigenButton';
import { FormularioOrigen } from './FormularioOrigen';

export const dynamic = 'force-dynamic';

export default async function OrigenesPage(): Promise<JSX.Element> {
  const [origenes, funnels] = await Promise.all([listarOrigenes(), listarFunnelsConPasos()]);
  const activos = origenes.filter((o) => o.activo).length;

  // Los pasos de TODOS los funnels, para poder decir qué dominios hacen falta
  // autorizar sin que el usuario tenga que abrir cada funnel a mirar. Los slugs
  // y los botones no se muestran acá (`soloLoader`): pertenecen a la pantalla del
  // funnel, donde están al lado del paso que cobran. Se calculan igual porque de
  // ellos sale `origenesNecesarios`, y después se vacían antes de cruzar a
  // cliente — el HTML de todos los botones de todos los funnels en el payload de
  // una pantalla que no los dibuja es peso muerto.
  const integracion = integracionDesdeFunnel(
    process.env.NEXT_PUBLIC_BASE_URL ?? '',
    funnels.flatMap((f) =>
      f.pasos.map((p) => ({
        id: p.id,
        slug: p.slug,
        tipo: p.tipo,
        nombre: p.nombre,
        url_externa: p.url_externa,
        permite_rechazo: p.permite_rechazo,
        paso_rechazado_id: p.paso_rechazado_id,
        producto: p.producto,
        delay_segundos: p.delay_segundos,
      })),
    ),
  );
  const origenesAutorizados = origenes.filter((o) => o.activo).map((o) => o.origen);

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Orígenes autorizados"
        descripcion="Los dominios que pueden disparar un cobro one-click. Es una allowlist: lo que no está acá, no cobra."
      />

      {origenes.length > 0 && activos === 0 ? (
        <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />}>
          Ningún origen está activo. El botón de upsell de cualquier funnel va a recibir{' '}
          <span className="font-mono font-semibold">403</span> al intentar cobrar.
        </Aviso>
      ) : null}

      <FormularioOrigen />

      {origenes.length === 0 ? (
        <EstadoVacio
          icono={<Fingerprint size={20} aria-hidden="true" />}
          titulo="Ningún dominio autorizado"
          descripcion="Agregá el dominio del funnel con el formulario de arriba. Hasta entonces el cobro one-click responde 403 a todos."
        />
      ) : (
        <TablaEnvoltorio>
          <thead>
            <tr>
              <Th>Dominio</Th>
              <Th>Nombre</Th>
              <Th>Estado</Th>
              <Th className="text-right">Quitar</Th>
            </tr>
          </thead>
          <tbody>
            {origenes.map((o) => (
              <Tr key={o.id}>
                <Td>
                  <Codigo className="max-w-[24rem] truncate">{o.origen}</Codigo>
                </Td>
                <Td className="text-tinta-2">{o.nombre ?? <SinDato />}</Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <SwitchActivo
                      id={o.id}
                      activo={o.activo}
                      endpoint="/api/admin/origenes"
                      etiqueta={o.origen}
                      mensajeConfirmacion={`${o.origen} va a poder disparar cobros one-click contra tarjetas ya guardadas.`}
                    />
                    <EstadoVivo activo={o.activo} />
                  </div>
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end">
                    <EliminarOrigenButton id={o.id} origen={o.origen} />
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TablaEnvoltorio>
      )}

      <ComoIntegrar
        integracion={{ ...integracion, pasos: [] }}
        origenesAutorizados={origenesAutorizados}
        soloLoader
      />
    </div>
  );
}
