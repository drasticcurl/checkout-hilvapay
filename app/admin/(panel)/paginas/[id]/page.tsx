import { notFound } from 'next/navigation';
import { buscarPagina } from '../../../../../lib/admin/paginas';
import { listarProductos } from '../../../../../lib/admin/productos';
import { FormularioPagina } from '../FormularioPagina';

export default async function EditarPaginaPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const [pagina, productos] = await Promise.all([buscarPagina(params.id), listarProductos()]);
  if (!pagina) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Editar link de pago</h1>
      <FormularioPagina pagina={pagina} productos={productos} />
    </div>
  );
}
