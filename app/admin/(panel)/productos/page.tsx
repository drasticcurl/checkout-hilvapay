/**
 * `/admin/productos` — el catálogo local. Cada fila es UN producto, nunca una
 * variante: desde la migración 010 (`producto_planes`) un producto puede tener
 * más de un precio, y mostrar cada variante como si fuera un producto aparte es
 * exactamente el bug que este módulo corrige (ver
 * `tasks/panel-catalogo-funnels/00-PLAN-PANEL-CATALOGO-FUNNELS.md` §0).
 */
import Link from 'next/link';
import { Package, Plus } from '@phosphor-icons/react/ssr';
import { listarProductosConPlanes } from '../../../../lib/admin/productos';
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
import { RevisarPlanes } from './RevisarPlanes';

export const dynamic = 'force-dynamic';

export default async function ProductosPage(): Promise<JSX.Element> {
  const productos = await listarProductosConPlanes();

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Productos"
        descripcion="Nombre, foto y descripción una sola vez. Cada precio es una variante: el link de pago vive dentro de la ficha del producto."
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
        <>
          {/* Antes de la tabla, no después: si hay un producto apuntando a un plan
              de otra cuenta, eso es lo primero que hay que saber — la tabla no lo
              puede mostrar, porque los productos rotos se ven idénticos a los
              buenos. Ver RevisarPlanes.tsx. */}
          <RevisarPlanes />

          <TablaEnvoltorio>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th numerica>Precio</Th>
              <Th>Estado</Th>
              <Th className="text-right">Editar</Th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => {
              // Una sola variante: se muestra el precio directo, como antes de
              // este módulo. Dos o más: un badge que resume, y el detalle vive en
              // la ficha — el mismo patrón de "badge que resume, ficha que
              // detalla" que ya usa el resto del panel.
              const [unica] = p.planes;
              return (
                <Tr key={p.id}>
                  <Td className="max-w-[20rem] truncate font-medium">{p.nombre}</Td>
                  <Td numerica className="whitespace-nowrap text-tinta-2">
                    {p.planes.length === 0 ? (
                      <Insignia tono="alerta">sin variantes</Insignia>
                    ) : p.planes.length === 1 && unica ? (
                      `${Number(unica.precio).toFixed(2)} ${unica.moneda.toUpperCase()}`
                    ) : (
                      <Insignia tono="acento">{p.planes.length} variantes</Insignia>
                    )}
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
                      {p.planes.length > 1 ? 'Ver variantes' : 'Editar'}
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TablaEnvoltorio>
        </>
      )}
    </div>
  );
}
