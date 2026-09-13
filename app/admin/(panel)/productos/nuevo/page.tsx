import { EncabezadoPantalla } from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { FormularioProducto } from '../FormularioProducto';

export default function NuevoProductoPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <Volver href="/admin/productos">Productos</Volver>
      <EncabezadoPantalla
        titulo="Nuevo producto"
        descripcion="Si el plan ya existe en Whop, vincularlo desde el catálogo es más seguro: el plan_id no se tipea. Se pide el slug de la primera variante en el siguiente paso, dentro de la ficha."
      />
      <FormularioProducto />
    </div>
  );
}
