import { listarProductos } from '../../../../../lib/admin/productos';
import { FormularioPagina } from '../FormularioPagina';

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
