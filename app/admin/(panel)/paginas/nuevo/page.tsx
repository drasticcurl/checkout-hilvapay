import { listarProductos } from '../../../../../lib/admin/productos';
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

export default async function NuevaPaginaPage(): Promise<JSX.Element> {
  const productos = await listarProductos();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Nuevo link de pago</h1>
      {productos.length === 0 ? (
        <p className="text-sm text-texto-suave">
          Todavía no hay productos. Creá uno primero en{' '}
          <a href="/admin/productos/nuevo" className="text-precio hover:underline">
            /admin/productos/nuevo
          </a>
          .
        </p>
      ) : (
        <FormularioPagina productos={productos} />
      )}
    </div>
  );
}
