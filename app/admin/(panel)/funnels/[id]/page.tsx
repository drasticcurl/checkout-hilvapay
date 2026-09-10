/**
 * `/admin/funnels/[id]` — el editor de un funnel existente.
 */
import { notFound } from 'next/navigation';
import { buscarFunnelConPasos, productosParaSelector } from '../../../../../lib/admin/funnels';
import { EncabezadoPantalla } from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { EditorFunnel } from '../EditorFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function EditarFunnelPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const [funnel, productos] = await Promise.all([
    buscarFunnelConPasos(params.id),
    productosParaSelector(),
  ]);
  if (!funnel) notFound();

  return (
    <div className="space-y-6">
      <Volver href="/admin/funnels">Funnels</Volver>
      <EncabezadoPantalla
        titulo={funnel.nombre}
        descripcion="El orden de la pila es el orden del funnel. Cada rama decide a dónde sigue el comprador."
      />
      <EditorFunnel funnel={funnel} productos={productos} />
    </div>
  );
}
