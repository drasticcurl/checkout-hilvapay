/**
 * `/admin/funnels/[id]` — el editor de un funnel existente.
 */
import { notFound } from 'next/navigation';
import { buscarFunnelConPasos, productosParaSelector } from '../../../../../lib/admin/funnels';
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
      <h1 className="text-xl font-semibold text-texto">Editar funnel</h1>
      <EditorFunnel funnel={funnel} productos={productos} />
    </div>
  );
}
