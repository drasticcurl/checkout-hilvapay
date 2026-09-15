/**
 * Shell de las pantallas protegidas del panel. Vive en el route group `(panel)`
 * para no envolver `/admin/login`, que es hermano de esta carpeta y no hijo.
 *
 * El header es sticky y translúcido: en `/admin/cobros` hay 100 filas, y perder
 * la navegación al tercer scroll obliga a volver arriba para cambiar de sección.
 * Mide 60px en desktop, dentro del techo de 80px.
 *
 * El indicador de entorno no es adorno. Dice si los interruptores de esta
 * pantalla mueven plata de verdad o no, y es lo primero que hay que saber antes
 * de tocar cualquiera de ellos.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Gear } from '@phosphor-icons/react/ssr';
import { CerrarSesionButton } from './CerrarSesionButton';
import { NavPanel } from '../../../components/panel/NavPanel';
import { Insignia } from '../../../components/panel/ui';

export default function PanelLayout({ children }: { children: ReactNode }): JSX.Element {
  const enProduccion = process.env.NEXT_PUBLIC_WHOP_ENV === 'production';

  return (
    <div className="min-h-[100dvh] bg-panel-fondo">
      <header className="sticky top-0 z-nav border-b border-panel-borde bg-panel-sup/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-panel items-center gap-5 px-4 lg:h-[60px] lg:px-6">
          <Link
            href="/admin"
            className="flex shrink-0 items-center gap-2.5 rounded-ctrl"
            aria-label="Inicio del panel"
          >
            {/* Marca: cuadrado con la inicial en Geist. Un monograma tipográfico,
                no un SVG decorativo dibujado a mano. `panel-solida` (casi blanco,
                invertido) reemplaza el `bg-tinta` de la era clara: en dark,
                `tinta` es la escala de TEXTO y ya no sirve como fondo sólido. */}
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-ctrl bg-panel-solida text-[15px] font-semibold leading-none text-panel-fondo"
            >
              h
            </span>
            <span className="hidden text-[13px] font-medium text-tinta sm:block">
              hilvana
              <span className="text-tinta-3"> / pagos</span>
            </span>
          </Link>

          <NavPanel variante="escritorio" />

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            {/* El indicador de entorno es también el acceso a la pantalla de
                conexión: lo que te dice a qué Whop estás apuntando es lo que te
                lleva a donde se cambia. Va como link y no como noveno ítem del
                nav porque la barra ya está al límite de su ancho con ocho. */}
            <Link
              href="/admin/conexion"
              aria-label="Conexión con Whop"
              className="inline-flex items-center gap-1.5 rounded-ctrl px-1.5 py-1 transition-colors hover:bg-panel-sup2"
            >
              <Insignia tono={enProduccion ? 'alerta' : 'neutro'}>
                {enProduccion ? 'producción' : 'sandbox'}
              </Insignia>
              <Gear size={15} className="text-tinta-3" aria-hidden="true" />
            </Link>
            <CerrarSesionButton />
          </div>
        </div>

        <NavPanel variante="mobile" />
      </header>

      <main className="mx-auto max-w-panel px-4 py-8 lg:px-6 lg:py-10">{children}</main>
    </div>
  );
}
