/**
 * `/admin/funnels/[id]` — el editor de un funnel existente, y debajo el código
 * para conectarlo al funnel real.
 *
 * Las dos cosas en la misma pantalla y en ese orden a propósito: los slugs que
 * hay que pegar en el funnel son los que se acaban de editar arriba. Tenerlos en
 * otra pantalla obliga a memorizarlos o a volver, que es donde se cuela el slug
 * del paso equivocado — el que cobra el producto equivocado sin ningún error.
 */
import { notFound } from 'next/navigation';
import { buscarFunnelConPasos, productosParaSelector } from '../../../../../lib/admin/funnels';
import { listarOrigenes } from '../../../../../lib/admin/origenes';
import { integracionDesdeFunnel } from '../../../../../lib/admin/integracion';
import { EncabezadoPantalla } from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { ComoIntegrar } from '../../../../../components/panel/ComoIntegrar';
import { EditorFunnel } from '../EditorFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function EditarFunnelPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const [funnel, productos, origenes] = await Promise.all([
    buscarFunnelConPasos(params.id),
    productosParaSelector(),
    listarOrigenes(),
  ]);
  if (!funnel) notFound();

  // Solo los ACTIVOS cuentan como autorizados: una fila apagada da 403 igual que
  // una que no existe (`headersCors` filtra por `activo`). Mostrarla como
  // autorizada sería la peor clase de error en esta pantalla — decirle que está
  // listo cuando el botón no va a cobrar.
  const origenesAutorizados = origenes.filter((o) => o.activo).map((o) => o.origen);

  const integracion = integracionDesdeFunnel(
    process.env.NEXT_PUBLIC_BASE_URL ?? '',
    funnel.pasos.map((p) => ({
      id: p.id,
      slug: p.slug,
      tipo: p.tipo,
      nombre: p.nombre,
      url_externa: p.url_externa,
      permite_rechazo: p.permite_rechazo,
      paso_rechazado_id: p.paso_rechazado_id,
      producto: p.producto,
    })),
  );

  return (
    <div className="space-y-6">
      <Volver href="/admin/funnels">Funnels</Volver>
      <EncabezadoPantalla
        titulo={funnel.nombre}
        descripcion="El orden de la pila es el orden del funnel. Cada rama decide a dónde sigue el comprador."
      />
      <EditorFunnel funnel={funnel} productos={productos} />
      <ComoIntegrar integracion={integracion} origenesAutorizados={origenesAutorizados} />
    </div>
  );
}
