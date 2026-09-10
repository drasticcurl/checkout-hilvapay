import Link from 'next/link';
import { MagnifyingGlass } from '@phosphor-icons/react/ssr';
import { EstadoVacio, clasesBoton } from '../../../components/panel/ui';

/**
 * El 404 de las pantallas del panel: lo dispara `notFound()` cuando se abre un
 * `/admin/productos/<id>` que ya no existe — normalmente un link viejo o algo
 * borrado desde otra pestaña. Sale con el shell puesto, así que la navegación
 * sigue ahí y no hace falta el botón de atrás del navegador.
 */
export default function NoEncontrado(): JSX.Element {
  return (
    <EstadoVacio
      icono={<MagnifyingGlass size={20} aria-hidden="true" />}
      titulo="Esto ya no está"
      descripcion="El registro que buscabas no existe. Puede haberse borrado, o el link puede estar viejo."
      accion={
        <Link href="/admin" className={clasesBoton('primario', 'md')}>
          Volver a los links de pago
        </Link>
      }
    />
  );
}
