'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BellRinging,
  ChartLineUp,
  Fingerprint,
  LinkSimple,
  Package,
  Receipt,
  Storefront,
  TreeStructure,
} from '@phosphor-icons/react/ssr';
import { unir } from './ui';

/**
 * Etiquetas cortas a propósito: "Catálogo de Whop" y "Orígenes autorizados" son
 * los títulos de las pantallas, pero en la barra tienen que caber TODOS los
 * ítems en UNA línea. Un nav de dos líneas en desktop es un nav roto.
 *
 * **El umbral de la barra en una línea es `xl` (1280px) y antes era `lg`.** Con
 * seis ítems entraban a 1024px; con ocho no. Medido sobre el header real: la fila
 * tiene la marca (~130px) y el bloque de entorno + cerrar sesión (~200px), así
 * que a 1024px le quedan ~646px al nav y los ocho ítems piden ~750px. A 1280px el
 * contenedor llega a su techo (`max-w-panel`, 76rem) y sobra lugar.
 *
 * La alternativa era esconder las etiquetas y dejar solo iconos entre 1024 y
 * 1280. Ocho iconos abstractos sin palabras se adivinan peor que la fila con
 * scroll horizontal que ya existía para mobile, así que abajo de `xl` se usa esa.
 *
 * `TreeStructure` y no un embudo para Funnels: estos funnels se ramifican (aceptó
 * / rechazó), y el embudo dibuja justamente lo contrario, un camino que se cierra.
 */
const SECCIONES = [
  { href: '/admin', label: 'Links', Icono: LinkSimple },
  { href: '/admin/funnels', label: 'Funnels', Icono: TreeStructure },
  { href: '/admin/catalogo', label: 'Catálogo', Icono: Storefront },
  { href: '/admin/productos', label: 'Productos', Icono: Package },
  { href: '/admin/origenes', label: 'Orígenes', Icono: Fingerprint },
  { href: '/admin/cobros', label: 'Cobros', Icono: Receipt },
  { href: '/admin/numeros', label: 'Números', Icono: ChartLineUp },
  { href: '/admin/alertas', label: 'Alertas', Icono: BellRinging },
] as const;

/**
 * `/admin` matchea solo exacto. Con `startsWith` quedaría marcado como activo en
 * todas las subrutas del panel a la vez, que es peor que no marcar nada: dos
 * ítems iluminados no dicen dónde estás.
 */
function estaActivo(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin' || pathname.startsWith('/admin/paginas');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Enlaces({ pathname }: { pathname: string }): JSX.Element {
  return (
    <>
      {SECCIONES.map(({ href, label, Icono }) => {
        const activo = estaActivo(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activo ? 'page' : undefined}
            className={unir(
              'inline-flex shrink-0 items-center gap-1.5 rounded-ctrl px-2.5 py-1.5 text-[13px] font-medium',
              'transition-[background-color,color] duration-150',
              activo
                ? 'bg-acento-suave text-acento-oscuro'
                : 'text-tinta-2 hover:bg-panel-sup2 hover:text-tinta',
            )}
          >
            <Icono size={16} weight="regular" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function NavPanel({ variante }: { variante: 'escritorio' | 'mobile' }): JSX.Element {
  const pathname = usePathname();

  // Desktop: en la misma fila que la marca, una sola línea. `xl` y no `lg` — ver
  // el comentario de SECCIONES: con ocho ítems, a 1024px no entran.
  if (variante === 'escritorio') {
    return (
      <nav aria-label="Secciones del panel" className="hidden items-center gap-0.5 xl:flex">
        <Enlaces pathname={pathname} />
      </nav>
    );
  }

  // Abajo de `xl`: fila propia debajo del header, con scroll horizontal. Ocho
  // ítems no justifican un hamburguesa — esconder la navegación de un panel que se
  // usa todos los días agrega un click a cada movimiento, y con scroll horizontal
  // las palabras siguen estando.
  return (
    <nav
      aria-label="Secciones del panel"
      className="flex items-center gap-0.5 overflow-x-auto border-t border-panel-borde px-4 py-2 [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden"
    >
      <Enlaces pathname={pathname} />
    </nav>
  );
}
