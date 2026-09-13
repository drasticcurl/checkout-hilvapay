import { notFound } from 'next/navigation';
import { buscarProductoConPlanes } from '../../../../../lib/admin/productos';
import { q } from '../../../../../lib/db';
import type { ProductoPlan } from '../../../../../lib/tipos';
import { EncabezadoPantalla } from '../../../../../components/panel/ui';
import { Volver } from '../../../../../components/panel/Volver';
import { DatosProducto } from './DatosProducto';
import { ListaVariantes, type PlanConPagina } from './ListaVariantes';
import { AgregarVariante } from './AgregarVariante';

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

type FilaPagina = {
  id: string;
  slug: string;
  activo: boolean;
  producto_id: string;
  tipo: 'front' | 'upsell';
  url_exito: string | null;
  url_rechazo: string | null;
  config: Record<string, unknown>;
  producto_plan_id: string;
};

/** La página (link) que cobra cada variante, resuelta en un solo round-trip. */
async function paginasPorVariante(productoPlanIds: string[]): Promise<Map<string, FilaPagina>> {
  if (productoPlanIds.length === 0) return new Map();
  const filas = await q<FilaPagina>(
    `select id, slug, activo, producto_id, tipo, url_exito, url_rechazo, config, producto_plan_id
       from paginas
      where producto_plan_id = any($1::uuid[])
      order by created_at desc`,
    [productoPlanIds],
  );
  const mapa = new Map<string, FilaPagina>();
  for (const f of filas) {
    if (!mapa.has(f.producto_plan_id)) mapa.set(f.producto_plan_id, f);
  }
  return mapa;
}

function aPlanConPagina(plan: ProductoPlan, pagina: FilaPagina | undefined): PlanConPagina {
  if (!pagina) return { ...plan, pagina: null };
  const { producto_plan_id, ...resto } = pagina;
  return { ...plan, pagina: resto };
}

export default async function EditarProductoPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const producto = await buscarProductoConPlanes(params.id);
  if (!producto) notFound();

  const paginasPorPlan = await paginasPorVariante(producto.planes.map((p) => p.id));
  const planes: PlanConPagina[] = producto.planes.map((plan) =>
    aPlanConPagina(plan, paginasPorPlan.get(plan.id)),
  );

  return (
    <div className="space-y-8">
      <Volver href="/admin/productos">Productos</Volver>
      <EncabezadoPantalla
        titulo={producto.nombre}
        descripcion="Nombre, foto y descripción son del producto. Cada variante de abajo tiene su propio precio y su propio link de pago."
      />

      <DatosProducto producto={producto} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-tinta">
            Variantes de precio <span className="text-tinta-3">({planes.length})</span>
          </h2>
          <AgregarVariante productoId={producto.id} whopProductId={producto.whop_product_id} />
        </div>

        {planes.length === 0 ? (
          <p className="text-[13px] text-tinta-3">
            Este producto no tiene ninguna variante de precio todavía. Agregá una con el botón de arriba.
          </p>
        ) : (
          <ListaVariantes planes={planes} />
        )}
      </div>
    </div>
  );
}
