/**
 * `/admin/funnels/nuevo` — antes de dejar ver el editor completo, pide el
 * producto principal y la página de gracias (D8 del plan
 * panel-catalogo-funnels: no se puede agregar el segundo paso sin las dos
 * cosas). El wizard vive en `AsistenteFunnel` (client component, estado local)
 * porque esta pantalla sigue siendo server component para el fetch de
 * productos — Next no mezcla las dos cosas en el mismo archivo.
 */
import Link from 'next/link';
import { Package } from '@phosphor-icons/react/ssr';
import { productosParaSelector } from '../../../../../lib/admin/funnels';
import { EncabezadoPantalla, EstadoVacio, clasesBoton } from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { AsistenteFunnel } from './AsistenteFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NuevoFunnelPage(): Promise<JSX.Element> {
  const variantes = await productosParaSelector();

  return (
    <div className="space-y-6">
      <Volver href="/admin/funnels">Funnels</Volver>
      <EncabezadoPantalla
        titulo="Nuevo funnel"
        descripcion="Empezá por el producto principal y agregá los upsells debajo. Nada cobra hasta que lo enciendas."
      />
      {variantes.length === 0 ? (
        <EstadoVacio
          icono={<Package size={20} aria-hidden="true" />}
          titulo="Falta vincular un producto"
          descripcion="Un paso del funnel necesita un producto con su plan de Whop detrás. Vinculá uno desde el catálogo y volvé."
          accion={
            <Link href="/admin/catalogo" className={clasesBoton('primario', 'md')}>
              Ir al catálogo de Whop
            </Link>
          }
        />
      ) : (
        <AsistenteFunnel variantes={variantes} />
      )}
    </div>
  );
}
