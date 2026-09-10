/**
 * `/admin/funnels/nuevo` — arranca el editor sin funnel todavía. El primer
 * guardado crea la fila; hasta entonces todo vive en el estado del cliente.
 */
import Link from 'next/link';
import { Package } from '@phosphor-icons/react/ssr';
import { productosParaSelector } from '../../../../../lib/admin/funnels';
import {
  EncabezadoPantalla,
  EstadoVacio,
  clasesBoton,
} from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { EditorFunnel } from '../EditorFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NuevoFunnelPage(): Promise<JSX.Element> {
  const productos = await productosParaSelector();

  return (
    <div className="space-y-6">
      <Volver href="/admin/funnels">Funnels</Volver>
      <EncabezadoPantalla
        titulo="Nuevo funnel"
        descripcion="Empezá por el producto principal y agregá los upsells debajo. Nada cobra hasta que lo enciendas."
      />
      {productos.length === 0 ? (
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
        <EditorFunnel funnel={null} productos={productos} />
      )}
    </div>
  );
}
