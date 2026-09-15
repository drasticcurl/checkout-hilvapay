/**
 * `/admin/cobros` — solo lectura, los últimos 100 cobros. Sirve para
 * diagnosticar una venta puntual: estado, monto, decline_code, whop_payment_id.
 *
 * Nueve columnas en un panel es mucho, y acá está bien: esta pantalla existe
 * para cruzar datos cuando alguien escribe "pagué y no me llegó". Sacar una
 * columna es sacar justo la que hacía falta ese día.
 */
import { Receipt, Warning } from '@phosphor-icons/react/ssr';
import { ultimosCobros } from '../../../../lib/admin/cobros';
import {
  Aviso,
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  Insignia,
  SinDato,
  TablaEnvoltorio,
  Td,
  Th,
  Tr,
} from '../../../../components/panel/ui';

export const dynamic = 'force-dynamic';

const ESTADOS: Record<
  string,
  { label: string; tono: 'neutro' | 'acento' | 'vivo' | 'peligro' | 'alerta' }
> = {
  creando: { label: 'Creando', tono: 'neutro' },
  procesando: { label: 'Procesando', tono: 'acento' },
  pagado: { label: 'Pagado', tono: 'vivo' },
  fallido: { label: 'Fallido', tono: 'peligro' },
  requiere_tarjeta: { label: 'Requiere tarjeta', tono: 'alerta' },
};

/** Fecha corta y con hora: el año completo no aporta para diagnosticar hoy. */
function fechaCorta(valor: string | Date): string {
  return new Date(valor).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function CobrosPage(): Promise<JSX.Element> {
  const cobros = await ultimosCobros(100);
  const fallidos = cobros.filter((c) => c.status === 'fallido' || c.status === 'requiere_tarjeta').length;
  const reembolsados = cobros.filter((c) => c.reembolsado_at).length;
  const disputados = cobros.filter((c) => c.disputa_at).length;

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Cobros"
        descripcion={
          cobros.length === 0
            ? 'Solo lectura. Acá aparece cada intento de cobro con su estado y su código de rechazo.'
            : `Los últimos ${cobros.length} intentos de cobro, solo lectura.${
                fallidos > 0 ? ` ${fallidos} no llegaron a cobrarse.` : ''
              }${reembolsados > 0 ? ` ${reembolsados} reembolsado(s).` : ''}`
        }
      />

      {/* Una disputa tiene plazo de respuesta y la resuelve una persona en el
          dashboard de Whop: es lo único de esta pantalla que pide acción hoy, así
          que va arriba y no escondido en una celda. */}
      {disputados > 0 ? (
        <Aviso tono="peligro" icono={<Warning size={16} aria-hidden="true" />} titulo="Hay disputas abiertas">
          {disputados} cobro(s) con disputa. Tienen plazo de respuesta y se resuelven en el dashboard de
          Whop, no acá.
        </Aviso>
      ) : null}

      {cobros.length === 0 ? (
        <EstadoVacio
          icono={<Receipt size={20} aria-hidden="true" />}
          titulo="Ningún cobro registrado"
          descripcion="Cuando un link de pago o un upsell intente cobrar, la fila aparece acá con su estado, el monto y el motivo si el banco la rechaza."
        />
      ) : (
        <TablaEnvoltorio conAltura>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Link</Th>
              <Th>Producto</Th>
              <Th>Email</Th>
              <Th>Origen</Th>
              <Th>Estado</Th>
              <Th numerica>Monto</Th>
              <Th>Rechazo</Th>
              <Th>Payment ID</Th>
            </tr>
          </thead>
          <tbody>
            {cobros.map((c) => {
              const estado = ESTADOS[c.status] ?? { label: c.status, tono: 'neutro' as const };
              return (
                <Tr key={c.id}>
                  <Td className="whitespace-nowrap font-mono text-[12px] tabular-nums text-tinta-2">
                    {fechaCorta(c.created_at)}
                  </Td>
                  <Td>
                    <Codigo>{c.pagina_slug}</Codigo>
                  </Td>
                  <Td className="max-w-[14rem] truncate font-medium">{c.producto_nombre}</Td>
                  <Td className="max-w-[14rem] truncate text-tinta-2">
                    {c.orden_email ?? <SinDato />}
                  </Td>
                  <Td className="text-tinta-2">{c.origen}</Td>
                  <Td>
                    {/* Las tres insignias van en la MISMA celda y no en columnas
                        nuevas: un cobro reembolsado sigue estando 'pagado', así
                        que el reembolso es una capa sobre el estado y no otro
                        estado. Separarlos en columnas invitaría a leer la fila
                        como si fueran dos cosas independientes. */}
                    <div className="flex flex-wrap items-center gap-1">
                      <Insignia tono={estado.tono}>{estado.label}</Insignia>
                      {c.reembolsado_at ? (
                        <Insignia tono="alerta" className="whitespace-nowrap">
                          Reembolsado {fechaCorta(c.reembolsado_at)}
                        </Insignia>
                      ) : null}
                      {c.disputa_at ? (
                        <Insignia tono="peligro" className="whitespace-nowrap">
                          Disputa {fechaCorta(c.disputa_at)}
                        </Insignia>
                      ) : null}
                    </div>
                  </Td>
                  <Td numerica className="whitespace-nowrap">
                    {c.monto == null ? (
                      <SinDato />
                    ) : (
                      `${Number(c.monto).toFixed(2)} ${(c.moneda ?? '').toUpperCase()}`
                    )}
                  </Td>
                  <Td>
                    {c.decline_code ? (
                      <span className="font-mono text-[12px] text-peligro">{c.decline_code}</span>
                    ) : (
                      <SinDato />
                    )}
                  </Td>
                  <Td>
                    {c.whop_payment_id ? (
                      <Codigo className="max-w-[12rem] truncate">{c.whop_payment_id}</Codigo>
                    ) : (
                      <SinDato />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TablaEnvoltorio>
      )}
    </div>
  );
}
