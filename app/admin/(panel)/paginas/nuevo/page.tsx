import Link from 'next/link';
import { Package } from '@phosphor-icons/react/ssr';
import { listarProductos } from '../../../../../lib/admin/productos';
import {
  EncabezadoPantalla,
  EstadoVacio,
  clasesBoton,
} from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { FormularioPagina } from '../FormularioPagina';

/**
 * `force-dynamic` no es decorativo: esta página consulta la base para llenar sus
 * selects, y sin esto Next la PRERENDERIZA durante el build.
 *
 * En una máquina de desarrollo no se nota, porque la base local ya tiene las
 * tablas. En un deploy limpio la migración corre DESPUÉS del build, así que el
 * build consulta una base vacía y aborta con
 * `relation "productos" does not exist`. Pasó de verdad el 2026-09-10: la
 * release se descartó sin activarse.
 *
 * Y cuando la base sí tiene datos es peor que un error: la respuesta queda
 * congelada en `.next/` con lo que hubiera en ese momento adentro.
 */
export const dynamic = 'force-dynamic';

export default async function NuevaPaginaPage(): Promise<JSX.Element> {
  const productos = await listarProductos();

  return (
    <div className="space-y-6">
      <Volver href="/admin">Links de pago</Volver>
      <EncabezadoPantalla
        titulo="Nuevo link de pago"
        descripcion="Nace apagado. Se enciende desde el switch de la lista, cuando ya lo probaste."
      />
      {productos.length === 0 ? (
        <EstadoVacio
          icono={<Package size={20} aria-hidden="true" />}
          titulo="Falta un producto"
          descripcion="Un link de pago cobra un producto, y el producto es el que sabe qué plan de Whop tocar. Creá uno primero."
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
        <FormularioPagina productos={productos} />
      )}
    </div>
  );
}
