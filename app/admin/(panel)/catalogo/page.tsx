/**
 * `/admin/catalogo` — tus productos de Whop, traídos por API, con sus planes y
 * sus precios reales, para vincularlos a un link de pago con un click.
 *
 * Es la alternativa a copiar un `plan_id` de un dashboard ajeno y pegarlo acá: el
 * id nunca se tipea, así que no se puede tipear mal.
 */
import Link from 'next/link';
import { ArrowSquareOut, Storefront, WarningCircle } from '@phosphor-icons/react/ssr';
import { catalogoWhop } from '../../../../lib/admin/catalogo';
import {
  Aviso,
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  clasesBoton,
} from '../../../../components/panel/ui';
import { FilaPlan } from './FilaPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CatalogoPage(): Promise<JSX.Element> {
  const { productos, huerfanos, error } = await catalogoWhop();

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Catálogo de Whop"
        descripcion="Lo que hay en tu cuenta de Whop, leído por API. Vinculá un plan para crear el link de pago: el precio sale del plan y el nombre lo escribís vos."
      />

      {error ? (
        <Aviso
          tono="peligro"
          rol="alert"
          icono={<WarningCircle size={17} aria-hidden="true" />}
          titulo="No se pudo leer el catálogo de Whop"
        >
          <p className="font-mono text-[12px] opacity-80">{error}</p>
          <p className="mt-2 text-tinta-2">
            Podés cargar el producto a mano pegando el <span className="font-mono">plan_id</span> desde{' '}
            <Link href="/admin/productos/nuevo" className="font-medium text-acento hover:underline">
              Nuevo producto
            </Link>
            . Esta pantalla es una comodidad, no el único camino.
          </p>
        </Aviso>
      ) : null}

      {!error && productos.length === 0 ? (
        <EstadoVacio
          icono={<Storefront size={20} aria-hidden="true" />}
          titulo="Tu cuenta de Whop no tiene productos"
          descripcion="Creá el producto y su plan en el dashboard de Whop, y volvé acá para vincularlo a un link de pago."
          accion={
            <a
              href="https://whop.com/dashboard"
              target="_blank"
              rel="noreferrer noopener"
              className={clasesBoton('secundario', 'md')}
            >
              Abrir el dashboard de Whop
              <ArrowSquareOut size={13} aria-hidden="true" />
            </a>
          }
        />
      ) : null}

      {productos.map((prod) => (
        <section
          key={prod.whop_product_id}
          className="overflow-hidden rounded-card border border-panel-borde bg-panel-sup shadow-panel"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-borde bg-panel-sup2/60 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <h2 className="truncate text-sm font-semibold text-tinta">{prod.titulo}</h2>
              <Codigo>{prod.whop_product_id}</Codigo>
            </div>
            {prod.route ? (
              <a
                href={`https://whop.com/${prod.route}/`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-micro text-[12px] font-medium text-acento transition-colors hover:text-acento-oscuro hover:underline"
              >
                Ver en Whop
                <ArrowSquareOut size={12} aria-hidden="true" />
              </a>
            ) : null}
          </header>

          {prod.planes.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-tinta-2">
              Este producto no tiene planes. Creá uno en Whop para poder cobrarlo.
            </p>
          ) : (
            <ul>
              {prod.planes.map((plan) => (
                <FilaPlan
                  key={plan.plan_id}
                  plan={plan}
                  whopProductId={prod.whop_product_id}
                  nombreSoft={prod.titulo}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {huerfanos.length > 0 ? (
        <section className="overflow-hidden rounded-card border border-alerta-borde bg-panel-sup shadow-panel">
          <header className="space-y-1 border-b border-alerta-borde bg-alerta-suave px-4 py-3">
            <h2 className="text-sm font-semibold text-alerta">Planes sin producto</h2>
            <p className="max-w-[70ch] text-[12px] leading-relaxed text-alerta">
              No están atados a ningún producto de Whop. Suelen ser restos de pruebas. Un plan así no
              admite códigos de descuento, así que vincularlo casi siempre es un error.
            </p>
          </header>
          <ul>
            {huerfanos.map((plan) => (
              <FilaPlan key={plan.plan_id} plan={plan} whopProductId={null} nombreSoft={null} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
