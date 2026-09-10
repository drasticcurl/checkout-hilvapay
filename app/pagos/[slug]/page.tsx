import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { resolverToken } from '@/lib/token';
import type { ConfigPagina } from '@/lib/tipos';
import { CheckoutContainer } from '@/components/checkout/CheckoutContainer';

// El estado activo/inactivo de una página tiene que tomar efecto al instante:
// un link cacheado que sigue cobrando después de apagarlo es exactamente lo
// que D14 del plan intenta evitar con el freno de emergencia del panel.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type FilaPagina = {
  id: string;
  slug: string;
  tipo: 'front' | 'upsell';
  url_exito: string | null;
  config: ConfigPagina;
  activo: boolean;
  producto_nombre: string;
  whop_plan_id: string;
  precio: string;
  moneda: string;
  precio_anclaje: string | null;
  imagen_url: string | null;
};

async function buscarPaginaActivaPorSlug(slug: string): Promise<FilaPagina | null> {
  const filas = await q<FilaPagina>(
    `select pg.id, pg.slug, pg.tipo, pg.url_exito, pg.config, pg.activo,
            pr.nombre as producto_nombre, pr.whop_plan_id, pr.precio, pr.moneda,
            pr.precio_anclaje, pr.imagen_url
       from paginas pg
       join productos pr on pr.id = pg.producto_id
      where pg.slug = $1 and pg.activo = true
      limit 1`,
    [slug],
  );
  return filas[0] ?? null;
}

export default async function PaginaCheckout({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { ot?: string; r?: string };
}) {
  // Mismo 404 exista o no el slug, esté activo o no: distinguirlos le dice a
  // un curioso qué links existen apagados.
  const pagina = await buscarPaginaActivaPorSlug(params.slug);
  if (!pagina) notFound();

  const environment = (process.env.NEXT_PUBLIC_WHOP_ENV === 'production' ? 'production' : 'sandbox') as
    | 'production'
    | 'sandbox';

  // Modo recuperación (T03 §7): un token inválido o vencido NO es un error,
  // cae al modo normal — alguien pudo llegar con un link viejo, y pedirle los
  // datos de nuevo es una venta posible; un error es una venta perdida.
  let recuperacion: { ordenId: string; email: string } | null = null;
  if (searchParams.r === '1' && searchParams.ot) {
    const resuelto = await resolverToken(searchParams.ot);
    if (resuelto.ok) {
      recuperacion = { ordenId: resuelto.orden.id, email: resuelto.orden.email ?? '' };
    }
  }

  // Solo lo que el cliente necesita. No el objeto de la base completo: el
  // browser no tiene que saber el whop_product_id, los timestamps, etc.
  return (
    <CheckoutContainer
      slug={pagina.slug}
      producto={{
        nombre: pagina.producto_nombre,
        precio: pagina.precio,
        precioAnclaje: pagina.precio_anclaje,
        moneda: pagina.moneda,
        imagenUrl: pagina.imagen_url,
        whopPlanId: pagina.whop_plan_id,
      }}
      config={pagina.config ?? {}}
      environment={environment}
      recuperacion={recuperacion}
    />
  );
}
