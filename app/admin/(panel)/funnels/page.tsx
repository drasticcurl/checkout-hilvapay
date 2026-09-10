/**
 * `/admin/funnels` — la lista de funnels: cuál producto dispara la cadena de
 * upsells, si está encendido, y accesos a editar/borrar.
 *
 * El producto que se muestra es el del paso `front` — es la oferta que ve el
 * comprador al entrar, y las siguientes filas del funnel dependen de esa.
 */
import Link from 'next/link';
import { Plus, TreeStructure } from '@phosphor-icons/react/ssr';
import { listarFunnelsConPasos } from '../../../../lib/admin/funnels';
import {
  EncabezadoPantalla,
  EstadoVacio,
  EstadoVivo,
  Insignia,
  TablaEnvoltorio,
  Td,
  Th,
  Tr,
  clasesBoton,
} from '../../../../components/panel/ui';
import { SwitchActivo } from '../SwitchActivo';
import { BorrarFunnelButton } from './BorrarFunnelButton';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatearPrecio(precio: string, moneda: string): string {
  return `${moneda.toUpperCase() === 'USD' ? 'US$' : moneda.toUpperCase()} ${Number(precio).toFixed(2).replace('.', ',')}`;
}

export default async function FunnelsPage(): Promise<JSX.Element> {
  const funnels = await listarFunnelsConPasos();
  const activos = funnels.filter((f) => f.activo).length;

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Funnels"
        descripcion={
          funnels.length === 0
            ? 'Un funnel encadena el producto principal con sus upsells y define a dónde va el comprador según acepte o rechace cada oferta.'
            : `${funnels.length} ${funnels.length === 1 ? 'funnel' : 'funnels'}, ${activos} ${
                activos === 1 ? 'encendido' : 'encendidos'
              }. Apagar el funnel corta toda su cadena de una.`
        }
        acciones={
          funnels.length === 0 ? undefined : (
            <Link href="/admin/funnels/nuevo" className={clasesBoton('primario', 'md')}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Nuevo funnel
            </Link>
          )
        }
      />

      {funnels.length === 0 ? (
        <EstadoVacio
          icono={<TreeStructure size={20} aria-hidden="true" />}
          titulo="Ningún funnel armado"
          descripcion="Necesitás al menos un producto vinculado. El funnel se arma como una pila: producto principal arriba, upsells debajo, y una flecha por cada resultado posible."
          accion={
            <Link href="/admin/funnels/nuevo" className={clasesBoton('primario', 'md')}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Armar el primero
            </Link>
          }
        />
      ) : (
        <TablaEnvoltorio>
          <thead>
            <tr>
              <Th>Funnel</Th>
              <Th>Producto principal</Th>
              <Th numerica>Pasos</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {funnels.map((f) => {
              const front = f.pasos.find((p) => p.tipo === 'front');
              return (
                <Tr key={f.id}>
                  <Td className="max-w-[16rem] truncate font-medium">{f.nombre}</Td>
                  <Td>
                    {front ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="max-w-[18rem] truncate">{front.producto.nombre}</span>
                        <span className="font-mono text-[12px] tabular-nums text-tinta-3">
                          {formatearPrecio(front.producto.precio, front.producto.moneda)}
                        </span>
                      </div>
                    ) : (
                      // Un funnel sin paso front todavía no se puede encender (el
                      // guardado lo exige), pero puede existir de forma transitoria
                      // mientras se está armando.
                      <Insignia tono="alerta">sin producto principal</Insignia>
                    )}
                  </Td>
                  <Td numerica className="text-tinta-2">
                    {f.pasos.length}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <SwitchActivo
                        id={f.id}
                        activo={f.activo}
                        endpoint="/api/admin/funnels"
                        etiqueta={`"${f.nombre}"`}
                        mensajeConfirmacion={`A partir de ahora la cadena completa de "${f.nombre}" empieza a cobrar tarjetas reales.`}
                      />
                      <EstadoVivo activo={f.activo} />
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/funnels/${f.id}`} className={clasesBoton('secundario', 'sm')}>
                        Abrir
                      </Link>
                      <BorrarFunnelButton id={f.id} nombre={f.nombre} />
                    </div>
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
