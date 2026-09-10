import { notFound } from 'next/navigation';
import { buscarPagina } from '../../../../../lib/admin/paginas';
import { listarProductos } from '../../../../../lib/admin/productos';
import { EncabezadoPantalla } from '../../../../../components/panel/ui';
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

export default async function EditarPaginaPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const [pagina, productos] = await Promise.all([buscarPagina(params.id), listarProductos()]);
  if (!pagina) notFound();

  return (
    <div className="space-y-6">
      <Volver href="/admin">Links de pago</Volver>
      <EncabezadoPantalla
        titulo={`/pagos/${pagina.slug}`}
        descripcion="Cambiar el slug cambia la URL: si ya está pegada en el funnel, el link viejo deja de existir."
      />
      <FormularioPagina pagina={pagina} productos={productos} />
    </div>
  );
}
