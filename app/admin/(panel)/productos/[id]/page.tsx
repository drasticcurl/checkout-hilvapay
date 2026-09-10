import { notFound } from 'next/navigation';
import { buscarProducto } from '../../../../../lib/admin/productos';
import { FormularioProducto } from '../FormularioProducto';

export default async function EditarProductoPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const producto = await buscarProducto(params.id);
  if (!producto) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Editar producto</h1>
      <FormularioProducto producto={producto} />
    </div>
  );
}
