/**
 * `/admin` — el Home del panel. Deja de ser el listado de links de pago (esa
 * sección se elimina, ver `tasks/panel-catalogo-funnels/T03-nav-y-home-sin-links.md`):
 * el slug/link de cada variante de precio ahora se ve y se edita desde la ficha
 * de "Productos" (T02).
 *
 * Esto es un resumen mínimo, NO el dashboard de ventas — el usuario confirmó
 * que eso es otro módulo, más adelante (ver `00-PLAN-PANEL-CATALOGO-FUNNELS.md`
 * §0 punto 3 y P-01 de §10). Dos conteos y tres accesos rápidos, nada de
 * métricas de cobros ni gráficos.
 */
import Link from 'next/link';
import {
  ArrowRight,
  Package,
  Storefront,
  TreeStructure,
} from '@phosphor-icons/react/ssr';
import { listarProductosConPlanes } from '../../../lib/admin/productos';
import { listarFunnelsConPasos } from '../../../lib/admin/funnels';
import { EncabezadoPantalla, Insignia, Tarjeta, unir } from '../../../components/panel/ui';

export const dynamic = 'force-dynamic';

type Acceso = {
  href: string;
  titulo: string;
  descripcion: string;
  Icono: typeof Package;
};

const ACCESOS: Acceso[] = [
  {
    href: '/admin/productos',
    titulo: 'Productos',
    descripcion: 'Nombre, foto y variantes de precio de cada producto, con su link de pago.',
    Icono: Package,
  },
  {
    href: '/admin/funnels',
    titulo: 'Funnels',
    descripcion: 'El front y los upsells encadenados que se ofrecen después de cada compra.',
    Icono: TreeStructure,
  },
  {
    href: '/admin/catalogo',
    titulo: 'Catálogo',
    descripcion: 'Los productos y planes que ya existen en Whop, para vincular uno nuevo.',
    Icono: Storefront,
  },
];

/**
 * Tarjeta de conteo simple: total y cuántos de esos están activos. Es a
 * propósito solo un número — el detalle de cada fila vive en su propia
 * pantalla, no acá.
 */
function TarjetaConteo({
  titulo,
  activos,
  total,
  singular,
  plural,
}: {
  titulo: string;
  activos: number;
  total: number;
  singular: string;
  plural: string;
}): JSX.Element {
  return (
    <Tarjeta className="px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-tinta-3">{titulo}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-[-0.01em] text-tinta">{activos}</span>
        <span className="text-sm text-tinta-3">
          de {total} {total === 1 ? singular : plural}
        </span>
      </div>
      <div className="mt-2">
        <Insignia tono={activos === 0 ? 'neutro' : 'vivo'}>
          {activos === 0 ? 'Ninguno activo' : activos === total ? 'Todos activos' : 'Activos ahora'}
        </Insignia>
      </div>
    </Tarjeta>
  );
}

function TarjetaAcceso({ href, titulo, descripcion, Icono }: Acceso): JSX.Element {
  return (
    <Link
      href={href}
      className={unir(
        'group flex items-start gap-3.5 rounded-card border border-panel-borde bg-panel-sup px-5 py-4',
        'shadow-panel transition-colors hover:border-panel-bordeFuerte hover:bg-panel-sup2',
      )}
    >
      <div className="mt-0.5 shrink-0 rounded-ctrl bg-acento-suave p-2 text-acento-oscuro">
        <Icono size={18} weight="regular" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
          <ArrowRight
            size={13}
            className="text-tinta-3 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
        <p className="text-[13px] leading-relaxed text-tinta-2">{descripcion}</p>
      </div>
    </Link>
  );
}

export default async function AdminHomePage(): Promise<JSX.Element> {
  const [productos, funnels] = await Promise.all([listarProductosConPlanes(), listarFunnelsConPasos()]);
  const productosActivos = productos.filter((p) => p.activo).length;
  const funnelsActivos = funnels.filter((f) => f.activo).length;

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Panel"
        descripcion="Resumen general. El detalle de cada cosa vive en su propia sección."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TarjetaConteo
          titulo="Productos"
          activos={productosActivos}
          total={productos.length}
          singular="producto"
          plural="productos"
        />
        <TarjetaConteo
          titulo="Funnels"
          activos={funnelsActivos}
          total={funnels.length}
          singular="funnel"
          plural="funnels"
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-tinta">Accesos rápidos</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {ACCESOS.map((acceso) => (
            <TarjetaAcceso key={acceso.href} {...acceso} />
          ))}
        </div>
      </div>
    </div>
  );
}
