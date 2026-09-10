/**
 * `/admin/funnels/nuevo` — arranca el editor sin funnel todavía. El primer
 * guardado crea la fila; hasta entonces todo vive en el estado del cliente.
 */
import { productosParaSelector } from '../../../../../lib/admin/funnels';
import { EditorFunnel } from '../EditorFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NuevoFunnelPage(): Promise<JSX.Element> {
  const productos = await productosParaSelector();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Nuevo funnel</h1>
      {productos.length === 0 ? (
        <p className="text-sm text-texto-suave">
          Todavía no hay productos vinculados. Vinculá uno primero en{' '}
          <a href="/admin/catalogo" className="text-precio hover:underline">
            /admin/catalogo
          </a>
          .
        </p>
      ) : (
        <EditorFunnel funnel={null} productos={productos} />
      )}
    </div>
  );
}
