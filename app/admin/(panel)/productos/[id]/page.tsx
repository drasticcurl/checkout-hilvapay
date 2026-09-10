import { notFound } from 'next/navigation';
import { buscarProducto } from '../../../../../lib/admin/productos';
import { FormularioProducto } from '../FormularioProducto';

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
