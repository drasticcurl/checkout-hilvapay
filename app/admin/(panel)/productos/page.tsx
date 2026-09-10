/**
 * `/admin/productos` — los productos locales, cada uno atado a un plan de Whop.
 * El nombre es el que ve el comprador; en Whop el plan puede llamarse distinto.
 */
import Link from 'next/link';
import { Package, Plus } from '@phosphor-icons/react/ssr';
import { listarProductos } from '../../../../lib/admin/productos';
import {
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  EstadoVivo,
  TablaEnvoltorio,
  Td,
  Th,
  Tr,
  clasesBoton,
} from '../../../../components/panel/ui';
import { SwitchActivo } from '../SwitchActivo';

export const dynamic = 'force-dynamic';

export default async function ProductosPage(): Promise<JSX.Element> {
  const productos = await listarProductos();

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Productos"
        descripcion="Cada producto apunta a un plan de Whop, que es lo que decide cuánto se cobra de verdad."
        acciones={
          productos.length === 0 ? undefined : (
            <Link href="/admin/productos/nuevo" className={clasesBoton('primario', 'md')}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Nuevo producto
            </Link>
          )
        }
      />

      {productos.length === 0 ? (
        <EstadoVacio
          icono={<Package size={20} aria-hidden="true" />}
          titulo="Ningún producto cargado"
          descripcion="Lo más rápido es vincularlo desde el catálogo de Whop: así el plan_id nunca se tipea a mano, y por lo tanto no se puede tipear mal."
          accion={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/admin/catalogo" className={clasesBoton('primario', 'md')}>
                Vincular desde el catálogo
              </Link>
              <Link href="/admin/productos/nuevo" className={clasesBoton('secundario', 'md')}>
                Cargarlo a mano
              </Link>
            </div>
          }
        />
      ) : (
        <TablaEnvoltorio>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Plan de Whop</Th>
              <Th numerica>Precio</Th>
              <Th>Estado</Th>
              <Th className="text-right">Editar</Th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <Tr key={p.id}>
                <Td className="max-w-[20rem] truncate font-medium">{p.nombre}</Td>
                <Td>
                  <Codigo className="max-w-[16rem] truncate">{p.whop_plan_id}</Codigo>
                </Td>
                <Td numerica className="whitespace-nowrap text-tinta-2">
                  {Number(p.precio).toFixed(2)} {p.moneda.toUpperCase()}
                </Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <SwitchActivo
                      id={p.id}
                      activo={p.activo}
                      endpoint="/api/admin/productos"
                      etiqueta={`"${p.nombre}"`}
                      mensajeConfirmacion={`Los links de pago que usen "${p.nombre}" van a poder empezar a cobrarlo.`}
                    />
                    <EstadoVivo activo={p.activo} />
                  </div>
                </Td>
                <Td className="text-right">
                  <Link href={`/admin/productos/${p.id}`} className={clasesBoton('secundario', 'sm')}>
                    Editar
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TablaEnvoltorio>
      )}
    </div>
  );
}
