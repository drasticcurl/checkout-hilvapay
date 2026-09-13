/**
 * El catálogo de Whop, agrupado para la pantalla de vinculación.
 *
 * La idea: en vez de pedirte que copies un `plan_id` de un dashboard ajeno y lo
 * pegues acá, el panel te muestra tus productos de Whop con sus planes y sus
 * precios reales, y vinculás con un click. El `plan_id` nunca se tipea, así que
 * no se puede tipear mal — que es el error que hace que un link cobre el producto
 * equivocado sin ningún síntoma visible.
 */
import { q, q1, tx } from '../db';
import { listarPlanes, listarProductosWhop, type PlanWhop, type ProductoWhop } from '../whop';
import { normalizarSlug } from './paginas';

/** Un plan de Whop con el estado de su vínculo local. */
export type PlanDelCatalogo = {
  plan_id: string;
  precio: string;
  moneda: string;
  plan_type: string;
  visibility: string | null;
  /** true cuando el plan NO está atado a un producto de Whop. Ver la nota de abajo. */
  huerfano: boolean;
  /** El producto local que ya lo usa, si existe. */
  vinculado: { producto_id: string; nombre: string; paginas: { slug: string; activo: boolean }[] } | null;
};

export type ProductoDelCatalogo = {
  whop_product_id: string;
  titulo: string;
  route: string | null;
  planes: PlanDelCatalogo[];
};

export type Catalogo = {
  productos: ProductoDelCatalogo[];
  /**
   * Planes que no pertenecen a ningún producto. Se muestran aparte y con una
   * advertencia: un plan huérfano no admite códigos de descuento (la doc de
   * `POST /payments` lo dice: "the plan must be attached to a product"), así que
   * vincular uno es casi siempre un error.
   */
  huerfanos: PlanDelCatalogo[];
  /** Poblado cuando Whop no respondió. La pantalla cae al alta manual. */
  error: string | null;
};

type FilaVinculo = {
  producto_id: string;
  whop_plan_id: string;
  nombre: string;
  slug: string | null;
  activo: boolean | null;
};

/**
 * Trae productos y planes de Whop y los cruza con lo que ya está vinculado acá.
 *
 * Nunca tira: si Whop falla devuelve el catálogo vacío con el error, y la
 * pantalla ofrece el alta manual. Un panel que se queda en blanco porque una API
 * ajena está caída no te deja trabajar.
 */
export async function catalogoWhop(): Promise<Catalogo> {
  let productos: ProductoWhop[] = [];
  let planes: PlanWhop[] = [];

  try {
    // En paralelo: son dos lecturas independientes y la pantalla espera las dos.
    [productos, planes] = await Promise.all([listarProductosWhop(), listarPlanes()]);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error('[admin/catalogo] Whop no respondió:', mensaje);
    return { productos: [], huerfanos: [], error: mensaje };
  }

  // Lo que ya está vinculado, con sus links. Un LEFT JOIN y no un INNER: un
  // producto vinculado sin ningún link de pago todavía es un estado normal
  // (acabás de vincularlo) y tiene que aparecer como vinculado igual. Desde la
  // migración 010, `whop_plan_id` vive en `producto_planes`, no en `productos`
  // — el join intermedio es lo que reemplaza al acceso directo de antes.
  const filas = await q<FilaVinculo>(
    `select pr.id as producto_id, pp.whop_plan_id, pr.nombre, pg.slug, pg.activo
       from productos pr
       join producto_planes pp on pp.producto_id = pr.id
       left join paginas pg on pg.producto_plan_id = pp.id
      order by pr.created_at desc, pg.slug`,
  );

  const porPlan = new Map<string, PlanDelCatalogo['vinculado']>();
  for (const f of filas) {
    const previo = porPlan.get(f.whop_plan_id);
    if (previo) {
      if (f.slug) previo.paginas.push({ slug: f.slug, activo: Boolean(f.activo) });
      continue;
    }
    porPlan.set(f.whop_plan_id, {
      producto_id: f.producto_id,
      nombre: f.nombre,
      paginas: f.slug ? [{ slug: f.slug, activo: Boolean(f.activo) }] : [],
    });
  }

  const aPlan = (p: PlanWhop, huerfano: boolean): PlanDelCatalogo => ({
    plan_id: p.id,
    // El precio llega como number de JSON (9.9). Se normaliza a dos decimales
    // acá y no en la vista, para que el valor que se guarda si vinculás sea
    // exactamente el que viste en pantalla.
    precio: Number(p.initial_price ?? 0).toFixed(2),
    moneda: (p.currency ?? 'usd').toLowerCase(),
    plan_type: p.plan_type ?? 'desconocido',
    visibility: p.visibility ?? null,
    huerfano,
    vinculado: porPlan.get(p.id) ?? null,
  });

  const porProducto = new Map<string, PlanWhop[]>();
  const huerfanos: PlanDelCatalogo[] = [];

  for (const plan of planes) {
    const prodId = plan.product?.id;
    if (!prodId) {
      huerfanos.push(aPlan(plan, true));
      continue;
    }
    const lista = porProducto.get(prodId) ?? [];
    lista.push(plan);
    porProducto.set(prodId, lista);
  }

  return {
    productos: productos.map((prod) => ({
      whop_product_id: prod.id,
      titulo: prod.title,
      route: prod.route ?? null,
      planes: (porProducto.get(prod.id) ?? []).map((p) => aPlan(p, false)),
    })),
    huerfanos,
    error: null,
  };
}

export type EntradaVinculo = {
  whop_plan_id: string;
  whop_product_id: string | null;
  /** El título del producto en Whop. Se guarda para poder mostrar los dos nombres. */
  whop_nombre_soft: string | null;
  /** El nombre REAL, el que ve el comprador. Lo escribe el usuario. */
  nombre: string;
  /** El precio que se muestra. Viene prellenado con el real del plan. */
  precio: string;
  moneda: string;
  slug: string;
  tipo: 'front' | 'upsell';
};

export type ResultadoVinculo =
  | { ok: true; producto_id: string; producto_plan_id: string; pagina_id: string; slug: string; fusionado: boolean }
  | { ok: false; error: 'slug_ocupado' | 'plan_ya_vinculado' | 'datos_invalidos'; detalle?: string };

/**
 * Vincula un plan de Whop a un link de pago nuevo.
 *
 * Desde la migración 010 (D1 del plan), esto ya no es siempre "crear un
 * producto nuevo": si el `whop_product_id` del plan YA está vinculado a un
 * producto local (mismo access_pass, otro plan), la variante nueva se agrega a
 * ESE producto vía `agregarPlanAProducto` (`fusionado: true`) en vez de crear
 * un producto hermano sin relación — que es exactamente el bug que reportó el
 * usuario. Si no hay ningún producto local con ese `whop_product_id`, se
 * comporta como siempre: producto nuevo + su primera variante
 * (`fusionado: false`).
 *
 * Todo en una sola transacción: si el segundo insert (la página) fallara,
 * quedaría un producto o una variante sin link, invisible en la pantalla y
 * ocupando el índice único de `whop_plan_id` — con lo cual el segundo intento
 * de vincular ese mismo plan fallaría con "ya vinculado" señalando algo que el
 * usuario no ve. Basura difícil de diagnosticar por un error de red.
 *
 * Nace **inactivo** (D14 del plan): vincular no es encender.
 */
export async function vincularPlan(entrada: EntradaVinculo): Promise<ResultadoVinculo> {
  const nombre = entrada.nombre.trim();
  const slug = normalizarSlug(entrada.slug);
  const precio = Number(entrada.precio);

  if (!entrada.whop_plan_id.trim()) return { ok: false, error: 'datos_invalidos', detalle: 'falta el plan' };
  if (nombre.length < 2) return { ok: false, error: 'datos_invalidos', detalle: 'el nombre es muy corto' };
  if (!slug) return { ok: false, error: 'datos_invalidos', detalle: 'el slug queda vacío' };
  if (!Number.isFinite(precio) || precio < 0) {
    return { ok: false, error: 'datos_invalidos', detalle: 'el precio no es un número' };
  }

  const ocupado = await q1<{ id: string }>('select id from paginas where slug = $1', [slug]);
  if (ocupado) return { ok: false, error: 'slug_ocupado' };

  const yaVinculado = await q1<{ id: string }>(
    'select id from producto_planes where whop_plan_id = $1',
    [entrada.whop_plan_id],
  );
  if (yaVinculado) return { ok: false, error: 'plan_ya_vinculado' };

  // Grupo existente por access_pass: si hay uno, la variante nueva se fusiona
  // ahí (D1). `whop_product_id` puede venir null (vínculo a mano, sin
  // catálogo) — en ese caso no hay nada que buscar, es su propio grupo.
  const productoDelGrupo = entrada.whop_product_id
    ? await q1<{ id: string }>('select id from productos where whop_product_id = $1', [
        entrada.whop_product_id,
      ])
    : null;

  try {
    return await tx(async (c) => {
      let productoId: string;
      let productoPlanId: string;
      const fusionado = Boolean(productoDelGrupo);

      if (productoDelGrupo) {
        productoId = productoDelGrupo.id;
        const plan = await c.query<{ id: string }>(
          `insert into producto_planes (producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio,
                                        moneda, precio_anclaje, es_default, activo)
           values ($1, $2, $3, 'Variante', $4, $5, null, false, false)
           returning id`,
          [
            productoId,
            entrada.whop_plan_id,
            entrada.whop_nombre_soft,
            precio.toFixed(2),
            entrada.moneda.toLowerCase(),
          ],
        );
        productoPlanId = plan.rows[0].id;
      } else {
        const prod = await c.query<{ id: string }>(
          `insert into productos (nombre, whop_product_id, activo)
           values ($1, $2, false)
           returning id`,
          [nombre, entrada.whop_product_id],
        );
        productoId = prod.rows[0].id;

        const plan = await c.query<{ id: string }>(
          `insert into producto_planes (producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio,
                                        moneda, precio_anclaje, es_default, activo)
           values ($1, $2, $3, 'Precio completo', $4, $5, null, true, false)
           returning id`,
          [productoId, entrada.whop_plan_id, entrada.whop_nombre_soft, precio.toFixed(2), entrada.moneda.toLowerCase()],
        );
        productoPlanId = plan.rows[0].id;
      }

      const pag = await c.query<{ id: string }>(
        `insert into paginas (slug, producto_id, producto_plan_id, tipo, config, activo)
         values ($1, $2, $3, $4, '{}'::jsonb, false)
         returning id`,
        [slug, productoId, productoPlanId, entrada.tipo],
      );

      return {
        ok: true as const,
        producto_id: productoId,
        producto_plan_id: productoPlanId,
        pagina_id: pag.rows[0].id,
        slug,
        fusionado,
      };
    });
  } catch (err) {
    // Carrera con otra pestaña: los chequeos de arriba pasaron y el índice único
    // ganó igual. Se traduce al mismo error que habría dado el chequeo, para que
    // la pantalla diga lo mismo en los dos casos.
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/paginas_slug_idx/.test(mensaje)) return { ok: false, error: 'slug_ocupado' };
    if (/producto_planes_whop_plan_idx/.test(mensaje)) return { ok: false, error: 'plan_ya_vinculado' };
    throw err;
  }
}
