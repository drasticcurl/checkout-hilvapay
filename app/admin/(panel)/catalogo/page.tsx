/**
 * `/admin/catalogo` — tus productos de Whop, traídos por API, con sus planes y
 * sus precios reales, para vincularlos a un link de pago con un click.
 *
 * Es la alternativa a copiar un `plan_id` de un dashboard ajeno y pegarlo acá: el
 * id nunca se tipea, así que no se puede tipear mal.
 */
import Link from 'next/link';
import { catalogoWhop } from '../../../../lib/admin/catalogo';
import { FilaPlan } from './FilaPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CatalogoPage(): Promise<JSX.Element> {
  const { productos, huerfanos, error } = await catalogoWhop();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-texto">Catálogo de Whop</h1>
        <p className="mt-1 text-sm text-texto-suave">
          Lo que hay en tu cuenta de Whop, leído por API. Vinculá un plan para crear el link de pago:
          el precio sale del plan y el nombre lo escribís vos.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-urgencia/30 bg-urgencia/5 p-4">
          <p className="text-sm font-medium text-urgencia">No se pudo leer el catálogo de Whop.</p>
          <p className="mt-1 text-xs text-texto-suave">{error}</p>
          <p className="mt-2 text-sm text-texto">
            Podés cargar el producto a mano pegando el <code>plan_id</code> desde{' '}
            <Link href="/admin/productos/nuevo" className="font-medium text-precio hover:underline">
              Nuevo producto
            </Link>
            . Esta pantalla es una comodidad, no el único camino.
          </p>
        </div>
      ) : null}

      {!error && productos.length === 0 ? (
        <p className="text-sm text-texto-suave">
          Tu cuenta de Whop no tiene productos todavía. Creá uno en el dashboard de Whop y volvé.
        </p>
      ) : null}

      {productos.map((prod) => (
        <section key={prod.whop_product_id} className="rounded-lg border border-borde">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-borde bg-gray-50 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-texto">{prod.titulo}</h2>
              <code className="text-xs text-texto-suave">{prod.whop_product_id}</code>
            </div>
            {prod.route ? (
              <a
                href={`https://whop.com/${prod.route}/`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs font-medium text-precio hover:underline"
              >
                Ver en Whop ↗
              </a>
            ) : null}
          </header>

          {prod.planes.length === 0 ? (
            <p className="px-4 py-3 text-sm text-texto-suave">
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
        <section className="rounded-lg border border-borde">
          <header className="border-b border-borde bg-gray-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-texto">Planes sin producto</h2>
            <p className="mt-0.5 text-xs text-texto-suave">
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
