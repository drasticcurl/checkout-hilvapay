/**
 * `/admin` — la lista de links de pago. Es la pantalla de inicio porque es lo
 * que se mira todos los días: slug, producto, precio, estado, y el switch para
 * encender o apagar el cobro sin redeploy.
 */
import Link from 'next/link';
import { LinkSimple, Plus } from '@phosphor-icons/react/ssr';
import { listarPaginasConProducto } from '../../../lib/admin/paginas';
import {
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  EstadoVivo,
  Insignia,
  TablaEnvoltorio,
  Td,
  Th,
  Tr,
  clasesBoton,
} from '../../../components/panel/ui';
import { CopiarUrlButton } from './CopiarUrlButton';
import { SwitchActivo } from './SwitchActivo';

export const dynamic = 'force-dynamic';

function formatearPrecio(precio: string, moneda: string): string {
  return `${Number(precio).toFixed(2)} ${moneda.toUpperCase()}`;
}

/**
 * El único número que importa de un vistazo en un panel de cobros es cuántos
 * links están cobrando ahora mismo: es el radio de acción si algo sale mal. Va
 * como frase y no como tarjeta de métrica — la tabla de abajo ya tiene el detalle.
 */
function resumen(total: number, activos: number): string {
  if (total === 0) return 'Todavía no hay links de pago creados.';
  if (activos === 0) {
    return `${total} ${total === 1 ? 'link' : 'links'}, ninguno cobrando. Todo nace apagado a propósito.`;
  }
  return `${activos} de ${total} ${total === 1 ? 'link' : 'links'} ${
    activos === 1 ? 'está cobrando' : 'están cobrando'
  } tarjetas ahora mismo.`;
}

export default async function AdminHomePage(): Promise<JSX.Element> {
  const paginas = await listarPaginasConProducto();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const activos = paginas.filter((p) => p.activo).length;

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Links de pago"
        descripcion={resumen(paginas.length, activos)}
        // Con la lista vacía el botón vive en el estado vacío y no acá: dos
        // botones que hacen lo mismo en la misma pantalla obligan a leer los dos
        // para descubrir que da igual cuál se aprieta.
        acciones={
          paginas.length === 0 ? undefined : (
            <Link href="/admin/paginas/nuevo" className={clasesBoton('primario', 'md')}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Nuevo link
            </Link>
          )
        }
      />

      {paginas.length === 0 ? (
        <EstadoVacio
          icono={<LinkSimple size={20} aria-hidden="true" />}
          titulo="Ningún link de pago todavía"
          descripcion="Un link asocia un producto de Whop a una URL propia como /pagos/agua-de-arroz. Es lo que se pega en el funnel."
          accion={
            <Link href="/admin/paginas/nuevo" className={clasesBoton('primario', 'md')}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Crear el primero
            </Link>
          }
        />
      ) : (
        <TablaEnvoltorio>
          <thead>
            <tr>
              <Th>Link</Th>
              <Th>Producto</Th>
              <Th>Tipo</Th>
              <Th numerica>Precio</Th>
              <Th>Estado</Th>
              <Th className="text-right">Editar</Th>
            </tr>
          </thead>
          <tbody>
            {paginas.map((p) => {
              const url = base ? `${base}/pagos/${p.slug}` : `/pagos/${p.slug}`;
              return (
                <Tr key={p.id}>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Codigo className="max-w-[22rem] truncate">{url}</Codigo>
                      <CopiarUrlButton url={url} />
                    </div>
                  </Td>
                  <Td className="max-w-[18rem] truncate font-medium">{p.producto.nombre}</Td>
                  <Td>
                    <Insignia tono={p.tipo === 'front' ? 'acento' : 'neutro'}>{p.tipo}</Insignia>
                  </Td>
                  <Td numerica className="whitespace-nowrap text-tinta-2">
                    {formatearPrecio(p.producto.precio, p.producto.moneda)}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <SwitchActivo
                        id={p.id}
                        activo={p.activo}
                        endpoint="/api/admin/paginas"
                        etiqueta={`/pagos/${p.slug}`}
                        mensajeConfirmacion={`A partir de ahora /pagos/${p.slug} empieza a cobrar tarjetas reales.`}
                      />
                      <EstadoVivo activo={p.activo} />
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Link href={`/admin/paginas/${p.id}`} className={clasesBoton('secundario', 'sm')}>
                      Editar
                    </Link>
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
