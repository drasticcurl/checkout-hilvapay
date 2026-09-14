/**
 * `GET /api/admin/productos/[id]` — el producto con TODAS sus variantes
 * (`ProductoConPlanes`), para la ficha de edición. Junto con cada variante
 * viaja la página (el link de pago) que la cobra, si existe — es lo que la
 * ficha necesita para mostrar/editar el slug de cada variante sin un
 * round-trip por fila.
 * `PATCH /api/admin/productos/[id]` — edita nombre/foto/descripción, o el
 * switch de activo. Son dos operaciones distintas dentro del mismo verbo
 * porque el switch pide confirmación en la UI (D14) y la edición de datos no.
 *
 * Desde la migración 010, el precio YA NO se edita acá: cada variante tiene el
 * suyo, y se edita con `PATCH /api/admin/productos/[id]/planes/[planId]`.
 */
import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { borrarProducto, buscarProductoConPlanes, setActivoProducto } from '../../../../../lib/admin/productos';
import type { Producto, ProductoPlan } from '../../../../../lib/tipos';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre, y si la query devolvía filas, esos datos quedan escritos en el
// artefacto del build. Verificado el 2026-09-10: `/api/admin/cobros` horneó un
// cobro con el email del comprador adentro, y `/api/admin/productos/planes`
// llamó a la API de Whop en tiempo de build y congeló la lista de planes.
//
// `runtime = 'nodejs'` porque estas rutas usan `pg`, que no corre en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La página (link de pago) que cobra una variante, o null si ninguna le
 * apunta todavía. Trae los campos que el PATCH de
 * `app/api/admin/paginas/[id]/route.ts` exige junto al slug nuevo (`tipo`,
 * `producto_id`, `url_exito`, `url_rechazo`, `config`) — ese endpoint no
 * acepta un PATCH parcial de "solo el slug", así que el cliente necesita
 * estos valores para poder reenviarlos sin cambiarlos.
 */
type PaginaDeVariante = {
  id: string;
  slug: string;
  activo: boolean;
  producto_id: string;
  tipo: 'front' | 'upsell';
  url_exito: string | null;
  url_rechazo: string | null;
  config: Record<string, unknown>;
};

async function paginasPorVariante(productoPlanIds: string[]): Promise<Map<string, PaginaDeVariante>> {
  if (productoPlanIds.length === 0) return new Map();
  // Una variante puede tener, en teoría, más de una página apuntándole (nada en
  // el esquema lo prohíbe), pero en la práctica de este panel cada variante
  // nueva se crea junto con SU página — se toma la más reciente si hubiera más
  // de una, para no mostrar un link viejo huérfano como si fuera el vigente.
  const filas = await q<PaginaDeVariante & { producto_plan_id: string }>(
    `select id, slug, activo, producto_id, tipo, url_exito, url_rechazo, config, producto_plan_id
       from paginas
      where producto_plan_id = any($1::uuid[])
      order by created_at desc`,
    [productoPlanIds],
  );
  const mapa = new Map<string, PaginaDeVariante>();
  for (const f of filas) {
    if (!mapa.has(f.producto_plan_id)) {
      const { producto_plan_id, ...resto } = f;
      mapa.set(producto_plan_id, resto);
    }
  }
  return mapa;
}

/** Una variante de precio con la página (link) que la cobra, si existe. */
type PlanConPagina = ProductoPlan & { pagina: PaginaDeVariante | null };

/** El producto con sus variantes, cada una con su página resuelta. `null` si no existe. */
async function productoConPaginas(
  id: string,
): Promise<(Producto & { planes: PlanConPagina[] }) | null> {
  const producto = await buscarProductoConPlanes(id);
  if (!producto) return null;
  const paginasPorPlan = await paginasPorVariante(producto.planes.map((p) => p.id));
  const planes = producto.planes.map((plan) => ({ ...plan, pagina: paginasPorPlan.get(plan.id) ?? null }));
  return { ...producto, planes };
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const producto = await productoConPaginas(params.id);
  if (!producto) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  return NextResponse.json({ producto });
}

type EntradaEdicion = {
  nombre?: unknown;
  whop_product_id?: unknown;
  imagen_url?: unknown;
  descripcion?: unknown;
};

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as EntradaEdicion & { activo?: boolean };

  // Body con SOLO `activo`: es el switch, no pide los demás campos.
  if (typeof d.activo === 'boolean' && Object.keys(d).length === 1) {
    await setActivoProducto(params.id, d.activo);
    const producto = await productoConPaginas(params.id);
    return NextResponse.json({ producto });
  }

  if (typeof d.nombre !== 'string' || !d.nombre.trim()) {
    return NextResponse.json({ error: 'falta_nombre' }, { status: 400 });
  }

  const fila = await q<{ id: string }>(
    `update productos
        set nombre = $1, whop_product_id = $2, imagen_url = $3, descripcion = $4, updated_at = now()
      where id = $5
      returning id`,
    [
      d.nombre.trim(),
      typeof d.whop_product_id === 'string' ? d.whop_product_id : null,
      typeof d.imagen_url === 'string' ? d.imagen_url : null,
      typeof d.descripcion === 'string' ? d.descripcion : null,
      params.id,
    ],
  );
  if (fila.length === 0) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });

  const producto = await productoConPaginas(params.id);
  return NextResponse.json({ producto });
}

/**
 * Borra el producto de verdad. Solo funciona si NO tiene ningún link de pago
 * ni ningún cobro histórico (ver `borrarProducto` en `lib/admin/productos.ts`)
 * — si tiene alguno de los dos, devuelve 409 con el motivo, para que la
 * pantalla pueda ofrecer desactivarlo en su lugar en vez de un error crudo.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const resultado = await borrarProducto(params.id);
  if (!resultado.ok) {
    const status = resultado.error === 'no_encontrado' ? 404 : 409;
    return NextResponse.json({ error: resultado.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
