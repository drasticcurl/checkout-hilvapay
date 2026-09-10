import { FormularioProducto } from '../FormularioProducto';

export default function NuevoProductoPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-texto">Nuevo producto</h1>
      <FormularioProducto />
    </div>
  );
}
