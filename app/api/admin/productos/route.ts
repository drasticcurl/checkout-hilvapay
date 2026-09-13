/**
 * `GET /api/admin/productos` — listado con TODAS las variantes de precio ya
 * resueltas (`ProductoConPlanes[]`). Reemplaza a la forma vieja (un producto,
 * un precio aplanado): desde la migración 010 un producto puede tener más de
 * una variante, y esta es la forma que consume `/admin/productos` (T02).
 *
 * `POST /api/admin/productos` — alta de un producto CON su primera variante
 * (`crearProductoConPlan`). Nace inactivo (D14), lo pone esa función. Si el
 * body trae `slug`, también crea el link de pago de esa primera variante
 * (`crearPagina`) — sin esto, un producto recién creado no tiene ningún link
 * hasta que alguien pase por el editor de funnels, y el alta manual (sin
 * catálogo) es precisamente el camino de quien todavía no tiene un funnel.
 *
 * Protegido por el middleware (`/api/admin/**`): llegar hasta acá ya implica
 * cookie válida.
 */
import { NextResponse } from 'next/server';
import { crearProductoConPlan, listarProductosConPlanes } from '../../../../lib/admin/productos';
import { normalizarSlug } from '../../../../lib/admin/paginas';
import { q1 } from '../../../../lib/db';

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

export async function GET(): Promise<NextResponse> {
  const productos = await listarProductosConPlanes();
  return NextResponse.json({ productos });
}

type EntradaAlta = {
  nombre?: unknown;
  whop_product_id?: unknown;
  imagen_url?: unknown;
  descripcion?: unknown;
  whop_plan_id?: unknown;
  whop_nombre_soft?: unknown;
  etiqueta?: unknown;
  precio?: unknown;
  moneda?: unknown;
  precio_anclaje?: unknown;
  /** El slug de la primera variante. Opcional: sin él, el producto nace sin link todavía. */
  slug?: unknown;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as EntradaAlta;
  if (typeof d.nombre !== 'string' || !d.nombre.trim()) {
    return NextResponse.json({ error: 'falta_nombre' }, { status: 400 });
  }
  if (typeof d.whop_plan_id !== 'string' || !d.whop_plan_id.trim()) {
    return NextResponse.json({ error: 'falta_whop_plan_id' }, { status: 400 });
  }
  if (typeof d.precio !== 'string' || Number.isNaN(Number(d.precio))) {
    return NextResponse.json({ error: 'precio_invalido' }, { status: 400 });
  }
  if (d.slug !== undefined && (typeof d.slug !== 'string' || !d.slug.trim())) {
    return NextResponse.json({ error: 'slug_invalido' }, { status: 400 });
  }

  try {
    const producto = await crearProductoConPlan({
      nombre: d.nombre.trim(),
      imagen_url: typeof d.imagen_url === 'string' ? d.imagen_url : null,
      descripcion: typeof d.descripcion === 'string' ? d.descripcion : null,
      whop_product_id: typeof d.whop_product_id === 'string' ? d.whop_product_id : null,
      plan: {
        whop_plan_id: d.whop_plan_id.trim(),
        whop_nombre_soft: typeof d.whop_nombre_soft === 'string' ? d.whop_nombre_soft : null,
        etiqueta: typeof d.etiqueta === 'string' && d.etiqueta.trim() ? d.etiqueta.trim() : undefined,
        precio: d.precio,
        moneda: typeof d.moneda === 'string' ? d.moneda : 'usd',
        precio_anclaje: typeof d.precio_anclaje === 'string' ? d.precio_anclaje : null,
      },
    });

    // El link de la primera variante, si se pidió uno. Si esto falla (slug
    // ocupado), el producto y su variante YA quedaron creados — se informa el
    // error puntual del slug, sin deshacer el alta: el operador puede resolver
    // el slug después desde la ficha, y no perdió el resto del formulario.
    //
    // Inserta con `q1` directo, no con `crearPagina` de lib/admin/paginas.ts:
    // esa función solo llena `producto_id` (la forma vieja, D2), y una página
    // sin `producto_plan_id` queda afuera del INNER JOIN de
    // `listarPaginasConProductoPlan` — invisible para todo el código nuevo.
    if (typeof d.slug === 'string' && d.slug.trim()) {
      const slug = normalizarSlug(d.slug);
      try {
        await q1(
          `insert into paginas (slug, producto_id, producto_plan_id, tipo, config, activo)
           values ($1, $2, $3, 'front', '{}'::jsonb, false)`,
          [slug, producto.id, producto.planes[0]!.id],
        );
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err);
        const errorSlug = mensaje.includes('paginas_slug_idx') ? 'slug_ya_existe' : 'error_al_crear_link';
        return NextResponse.json({ producto, errorSlug }, { status: 201 });
      }
    }

    return NextResponse.json({ producto }, { status: 201 });
  } catch (err) {
    // El único conflicto esperado es el índice único de `whop_plan_id`: un plan
    // solo puede estar asociado a una variante.
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje === 'plan_ya_vinculado') {
      return NextResponse.json({ error: 'plan_ya_asociado' }, { status: 409 });
    }
    console.error('[api/admin/productos] error al crear:', mensaje);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
