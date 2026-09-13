/**
 * Queries de `funnels` y de los pasos (`paginas`) que le pertenecen, para el
 * editor visual del panel.
 *
 * El editor manda el funnel ENTERO en cada guardado — nombre, página de
 * gracias, y la lista completa de pasos con sus dos flechas — y este módulo lo
 * escribe todo en una transacción (regla 3 del task): si el paso 3 fallara
 * después de haber escrito el 1 y el 2, el funnel quedaría con flechas
 * apuntando a un paso que no llegó a existir, y eso corre en producción
 * cobrando.
 *
 * La detección de ciclos usa `detectarCiclo` de `lib/funnels.ts` — el
 * resolutor ya probado con 22 tests — y no una copia local.
 */
import { q, q1, tx } from '../db';
import { detectarCiclo } from '../funnels';
import { normalizarSlug } from './paginas';

/** Fila de `funnels`, tal como la devuelve `pg`. */
export type Funnel = {
  id: string;
  nombre: string;
  url_gracias: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Un paso del funnel, con el producto ya resuelto para no pedirlo aparte. */
export type PasoDeFunnel = {
  id: string;
  funnel_id: string;
  slug: string;
  producto_id: string;
  tipo: 'front' | 'upsell';
  orden: number;
  nombre: string | null;
  url_externa: string | null;
  permite_rechazo: boolean;
  paso_aceptado_id: string | null;
  paso_rechazado_id: string | null;
  activo: boolean;
  producto: { id: string; nombre: string; precio: string; moneda: string; imagen_url: string | null };
  /**
   * Segundos que el snippet le dice al `loader.js` que espere antes de mostrar
   * el botón — pensado para que el botón aparezca debajo de un VSL a un punto
   * fijo del video, sin que el operador tenga que tocar JS. `null` = sin
   * demora, el default de siempre. Vive en `paginas.config` (jsonb), mismo
   * lugar que `timerMinutos`/`textoBoton` de la página de checkout.
   */
  delay_segundos: number | null;
};

/** El funnel con sus pasos, para la pantalla de lista y la del editor. */
export type FunnelConPasos = Funnel & { pasos: PasoDeFunnel[] };

const COLS_FUNNEL = 'id, nombre, url_gracias, activo, created_at, updated_at';

/**
 * Fila cruda de `paginas` + `producto_planes` + `productos`, tal como llega de
 * una query con join. Se ordena por `orden` y no por `created_at`: el orden
 * del editor es un dato explícito (columna `orden`), no el orden de creación,
 * porque un paso se puede reordenar sin que eso cambie el flujo (la migración
 * 003 lo aclara: el orden es solo visual).
 *
 * Desde la migración 010, el precio de un paso se resuelve
 * `paginas.producto_plan_id → producto_planes → productos` — nunca por
 * `paginas.producto_id` directo (§3.4 del plan: el `producto_id` de una página
 * puede no ser el ganador de su grupo tras la agrupación). El resultado
 * aplanado (`PasoDeFunnel.producto`) NO cambia de forma: sigue siendo
 * `{id, nombre, precio, moneda, imagen_url}` porque `EditorFunnel.tsx` y
 * `FormularioPaso.tsx` (ownership de T05/T06, no de T01) siguen leyendo esa
 * forma exacta.
 */
type FilaPaso = {
  id: string;
  funnel_id: string;
  slug: string;
  producto_id: string;
  producto_plan_id: string | null;
  tipo: 'front' | 'upsell';
  orden: number;
  nombre: string | null;
  url_externa: string | null;
  permite_rechazo: boolean;
  paso_aceptado_id: string | null;
  paso_rechazado_id: string | null;
  activo: boolean;
  config: { delaySegundos?: number } | null;
  prod_id: string;
  prod_nombre: string;
  prod_precio: string;
  prod_moneda: string;
  prod_imagen_url: string | null;
};

/**
 * `left join producto_planes/productos_plan` y no `inner`: una página vieja
 * que todavía no tuviera `producto_plan_id` resuelto no puede desaparecer del
 * editor (se vería como un funnel roto sin ningún paso), así que cuando el
 * join por plan no resuelve nada, cae al join directo por `producto_id` de
 * siempre — la migración 010 ya puebla `producto_plan_id` para toda página
 * existente, pero esta doble resolución es la red de seguridad para lo que no
 * cubrió esa migración de datos.
 */
const SELECT_PASOS = `
  select pg.id, pg.funnel_id, pg.slug, pg.producto_id, pg.producto_plan_id, pg.tipo, pg.orden, pg.nombre,
         pg.url_externa, pg.permite_rechazo, pg.paso_aceptado_id, pg.paso_rechazado_id, pg.activo,
         pg.config,
         coalesce(pp.producto_id, pr_directo.id) as prod_id,
         coalesce(pr_via_plan.nombre, pr_directo.nombre) as prod_nombre,
         coalesce(pp.precio, pr_directo_legacy.precio) as prod_precio,
         coalesce(pp.moneda, pr_directo_legacy.moneda) as prod_moneda,
         coalesce(pr_via_plan.imagen_url, pr_directo.imagen_url) as prod_imagen_url
    from paginas pg
    left join producto_planes pp on pp.id = pg.producto_plan_id
    left join productos pr_via_plan on pr_via_plan.id = pp.producto_id
    left join productos pr_directo on pr_directo.id = pg.producto_id
    left join producto_planes pr_directo_legacy on pr_directo_legacy.producto_id = pr_directo.id and pr_directo_legacy.es_default
`;

function filaAPaso(f: FilaPaso): PasoDeFunnel {
  return {
    id: f.id,
    funnel_id: f.funnel_id,
    slug: f.slug,
    producto_id: f.producto_id,
    tipo: f.tipo,
    orden: f.orden,
    nombre: f.nombre,
    url_externa: f.url_externa,
    permite_rechazo: f.permite_rechazo,
    paso_aceptado_id: f.paso_aceptado_id,
    paso_rechazado_id: f.paso_rechazado_id,
    activo: f.activo,
    // El jsonb puede venir null (páginas creadas antes de tener esta
    // columna) o sin la clave (config: {} de siempre). Los dos casos caen en
    // null — no en 0, que sería "demora de cero segundos" y es un valor
    // distinto y válido.
    delay_segundos:
      typeof f.config?.delaySegundos === 'number' && f.config.delaySegundos > 0
        ? f.config.delaySegundos
        : null,
    producto: {
      id: f.prod_id,
      nombre: f.prod_nombre,
      // numeric vuelve como string del driver, pero por si el caller lo pasa
      // por json_build_object en otro lado, se normaliza igual (misma cautela
      // que lib/admin/paginas.ts).
      precio: String(f.prod_precio),
      moneda: f.prod_moneda,
      imagen_url: f.prod_imagen_url,
    },
  };
}

/** Lista de funnels con sus pasos, para `/admin/funnels`. */
export async function listarFunnelsConPasos(): Promise<FunnelConPasos[]> {
  const funnels = await q<Funnel>(`select ${COLS_FUNNEL} from funnels order by created_at desc`);
  if (funnels.length === 0) return [];

  const filas = await q<FilaPaso>(`${SELECT_PASOS} where pg.funnel_id is not null order by pg.orden`);
  const pasosPorFunnel = new Map<string, PasoDeFunnel[]>();
  for (const f of filas) {
    const lista = pasosPorFunnel.get(f.funnel_id) ?? [];
    lista.push(filaAPaso(f));
    pasosPorFunnel.set(f.funnel_id, lista);
  }

  return funnels.map((fn) => ({ ...fn, pasos: pasosPorFunnel.get(fn.id) ?? [] }));
}

/** Un funnel con sus pasos, para `/admin/funnels/[id]`. `null` si no existe. */
export async function buscarFunnelConPasos(id: string): Promise<FunnelConPasos | null> {
  const funnel = await q1<Funnel>(`select ${COLS_FUNNEL} from funnels where id = $1`, [id]);
  if (!funnel) return null;

  const filas = await q<FilaPaso>(`${SELECT_PASOS} where pg.funnel_id = $1 order by pg.orden`, [id]);
  return { ...funnel, pasos: filas.map(filaAPaso) };
}

/**
 * Lo que necesita el editor para el selector de "Producto": todos los
 * productos vinculados, sin filtrar por activo — un producto apagado igual se
 * puede planear en un funnel que todavía no se enciende.
 */
export async function productosParaSelector(): Promise<
  { id: string; nombre: string; precio: string; moneda: string }[]
> {
  return q(`select id, nombre, precio, moneda from productos order by nombre`);
}

// ── Guardado ─────────────────────────────────────────────────────────────────

/** Un paso tal como lo manda el formulario del editor, antes de tener id si es nuevo. */
export type EntradaPaso = {
  /** `null` para un paso nuevo. Si viene, tiene que pertenecer a este funnel. */
  id: string | null;
  slug: string;
  producto_id: string;
  tipo: 'front' | 'upsell';
  orden: number;
  nombre: string | null;
  url_externa: string | null;
  permite_rechazo: boolean;
  /**
   * Las flechas se mandan por índice dentro de la MISMA lista `pasos`, no por
   * id: un paso nuevo todavía no tiene id cuando el browser arma el payload. -1
   * (o ausente) significa "sin siguiente" → cae a la página de gracias.
   */
  paso_aceptado_indice: number | null;
  paso_rechazado_indice: number | null;
  /** Ver `PasoDeFunnel.delay_segundos`. `null` = sin demora. */
  delay_segundos: number | null;
};

export type EntradaFunnel = {
  nombre: string;
  url_gracias: string | null;
  pasos: EntradaPaso[];
};

export type ResultadoGuardado =
  | { ok: true; id: string }
  | { ok: false; error: 'sin_pasos' | 'sin_front' | 'dos_front' | 'ciclo' | 'slug_ocupado' | 'datos_invalidos'; detalle?: string };

/**
 * Valida y guarda el funnel entero: alta si `id` es `null`, edición si no.
 *
 * Todo en una transacción (regla 3): primero se resuelven los slugs e ids —
 * insertando los pasos nuevos sin flechas todavía—, después se resuelven los
 * índices a ids reales y se actualizan las flechas, y recién ahí se corre
 * `detectarCiclo` sobre el grafo final. Si el ciclo aparece, se hace ROLLBACK:
 * ninguna fila intermedia queda escrita.
 */
export async function guardarFunnel(id: string | null, datos: EntradaFunnel): Promise<ResultadoGuardado> {
  const nombre = datos.nombre.trim();
  if (nombre.length < 2) return { ok: false, error: 'datos_invalidos', detalle: 'el nombre es muy corto' };
  if (datos.pasos.length === 0) return { ok: false, error: 'sin_pasos' };

  const fronts = datos.pasos.filter((p) => p.tipo === 'front');
  if (fronts.length === 0) return { ok: false, error: 'sin_front' };
  if (fronts.length > 1) return { ok: false, error: 'dos_front' };

  for (const p of datos.pasos) {
    if (!p.producto_id) return { ok: false, error: 'datos_invalidos', detalle: 'falta el producto de un paso' };
    // El slug es obligatorio en TODOS los pasos, no solo en el front: en un
    // upsell es lo que el botón del funnel pone en `data-hilvana-upsell`, así
    // que sin slug el paso es imposible de cablear del lado del funnel.
    if ((p.slug ?? '').trim() === '') {
      return { ok: false, error: 'datos_invalidos', detalle: `al paso "${p.nombre ?? '(sin nombre)'}" le falta el slug` };
    }
    // Un delay negativo no tiene sentido y uno absurdamente largo (más de 15
    // minutos) casi seguro es un error de tipeo — 900 y no un número más
    // "redondo" porque un VSL real puede legítimamente durar varios minutos
    // antes de mostrar la oferta.
    if (p.delay_segundos != null && (p.delay_segundos < 0 || p.delay_segundos > 900)) {
      return {
        ok: false,
        error: 'datos_invalidos',
        detalle: `la demora del paso "${p.nombre ?? p.slug}" tiene que estar entre 0 y 900 segundos`,
      };
    }
  }

  try {
    return await tx(async (c) => {
      let funnelId = id;
      if (funnelId) {
        await c.query('update funnels set nombre = $1, url_gracias = $2, updated_at = now() where id = $3', [
          nombre,
          datos.url_gracias,
          funnelId,
        ]);
        // Los pasos que ya no vienen en el payload se soltaron del funnel: se
        // desvinculan (no se borran, para no perder el producto ni el historial
        // de cobros que le apunta por pagina_id) antes de reescribir el resto.
        const idsQueQuedan = datos.pasos.map((p) => p.id).filter((x): x is string => Boolean(x));
        if (idsQueQuedan.length > 0) {
          await c.query(
            'update paginas set funnel_id = null, paso_aceptado_id = null, paso_rechazado_id = null where funnel_id = $1 and id <> all($2::uuid[])',
            [funnelId, idsQueQuedan],
          );
        } else {
          await c.query(
            'update paginas set funnel_id = null, paso_aceptado_id = null, paso_rechazado_id = null where funnel_id = $1',
            [funnelId],
          );
        }
      } else {
        // Nace apagado (regla 1): ni el alta ni la edición tocan `activo` en
        // true. El switch de la lista es el único camino para encenderlo.
        const fila = await c.query<{ id: string }>(
          'insert into funnels (nombre, url_gracias, activo) values ($1, $2, false) returning id',
          [nombre, datos.url_gracias],
        );
        funnelId = fila.rows[0].id;
      }

      // Primera pasada: alta o update de cada paso, SIN las flechas todavía —
      // un paso nuevo no tiene id hasta este insert, y las flechas pueden
      // apuntar a otro paso nuevo de la misma lista.
      //
      // `producto_plan_id` se resuelve por subquery a la variante DEFAULT del
      // producto que llegó en `p.producto_id` — el formulario del editor
      // (`FormularioPaso.tsx`, T04/T05) sigue mandando `producto_id`, no
      // `producto_plan_id` directo, así que acá es donde se traduce uno al
      // otro. Si el producto no tiene ninguna variante default (no debería
      // pasar: el índice `producto_planes_un_default_idx` más la migración 010
      // garantizan una por producto), la subquery da NULL y el paso queda sin
      // `producto_plan_id` — visible en la base, no un cobro silenciosamente
      // mal resuelto.
      const idsPorIndice: string[] = [];
      for (let i = 0; i < datos.pasos.length; i++) {
        const p = datos.pasos[i];
        const slug = normalizarSlug(p.slug);

        if (p.id) {
          await c.query(
            `update paginas
                set slug = $1, producto_id = $2, tipo = $3, orden = $4, nombre = $5,
                    url_externa = $6, permite_rechazo = $7, funnel_id = $8,
                    config = jsonb_set(coalesce(config, '{}'::jsonb), '{delaySegundos}',
                      $9::jsonb, true),
                    producto_plan_id = (select id from producto_planes where producto_id = $2 and es_default),
                    updated_at = now()
              where id = $10`,
            [
              slug,
              p.producto_id,
              p.tipo,
              p.orden,
              p.nombre,
              p.url_externa,
              p.permite_rechazo,
              funnelId,
              JSON.stringify(p.delay_segundos ?? null),
              p.id,
            ],
          );
          idsPorIndice.push(p.id);
        } else {
          const fila = await c.query<{ id: string }>(
            `insert into paginas (slug, producto_id, tipo, orden, nombre, url_externa,
                                  permite_rechazo, funnel_id, config, activo, producto_plan_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, false,
                     (select id from producto_planes where producto_id = $2 and es_default))
             returning id`,
            [
              slug,
              p.producto_id,
              p.tipo,
              p.orden,
              p.nombre,
              p.url_externa,
              p.permite_rechazo,
              funnelId,
              JSON.stringify(p.delay_segundos ? { delaySegundos: p.delay_segundos } : {}),
            ],
          );
          idsPorIndice.push(fila.rows[0].id);
        }
      }

      // Segunda pasada: ahora que todos los pasos tienen id, se resuelven los
      // índices de las flechas a ids reales y se escriben.
      const pasosParaCiclo: { id: string; paso_aceptado_id: string | null; paso_rechazado_id: string | null }[] = [];
      for (let i = 0; i < datos.pasos.length; i++) {
        const p = datos.pasos[i];
        const id_ = idsPorIndice[i];
        const aceptadoId =
          p.paso_aceptado_indice != null && p.paso_aceptado_indice >= 0
            ? idsPorIndice[p.paso_aceptado_indice] ?? null
            : null;
        const rechazadoId =
          p.paso_rechazado_indice != null && p.paso_rechazado_indice >= 0
            ? idsPorIndice[p.paso_rechazado_indice] ?? null
            : null;

        // Un paso no puede apuntarse a sí mismo (constraint de la migración
        // 003): se detecta acá, antes del UPDATE, para dar un mensaje que
        // nombra el paso en vez de dejar que el CHECK de postgres tire un error
        // críptico con el nombre de la constraint.
        if (aceptadoId === id_ || rechazadoId === id_) {
          return { ok: false, error: 'ciclo', detalle: `el paso "${p.nombre ?? p.slug}" se apunta a sí mismo` };
        }

        await c.query('update paginas set paso_aceptado_id = $1, paso_rechazado_id = $2 where id = $3', [
          aceptadoId,
          rechazadoId,
          id_,
        ]);
        pasosParaCiclo.push({ id: id_, paso_aceptado_id: aceptadoId, paso_rechazado_id: rechazadoId });
      }

      // La validación real de ciclos (rutas de largo > 1) usa el resolutor ya
      // probado. Se corre sobre el grafo COMPLETO del funnel, no solo sobre los
      // pasos que llegaron en este guardado: un ciclo se puede formar entre un
      // paso que se edita ahora y uno que no se tocó.
      const todosLosPasos = await c.query<{
        id: string;
        paso_aceptado_id: string | null;
        paso_rechazado_id: string | null;
        nombre: string | null;
        slug: string;
      }>('select id, paso_aceptado_id, paso_rechazado_id, nombre, slug from paginas where funnel_id = $1', [
        funnelId,
      ]);

      const ciclo = detectarCiclo(todosLosPasos.rows);
      if (ciclo) {
        const porId = new Map(todosLosPasos.rows.map((p) => [p.id, p.nombre ?? p.slug]));
        const nombres = ciclo.map((cid) => porId.get(cid) ?? cid).join(' → ');
        // Tirar acá hace que `tx()` haga ROLLBACK: ninguna de las filas de
        // arriba queda escrita (regla 2 y 3 combinadas).
        throw new ErrorCiclo(nombres);
      }

      return { ok: true, id: funnelId! };
    });
  } catch (err) {
    if (err instanceof ErrorCiclo) {
      return { ok: false, error: 'ciclo', detalle: `este camino no llega nunca a gracias: ${err.mensaje}` };
    }
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.includes('paginas_slug_idx')) return { ok: false, error: 'slug_ocupado' };
    if (mensaje.includes('paginas_un_front_por_funnel')) return { ok: false, error: 'dos_front' };
    if (mensaje.includes('paginas_no_autoreferencia')) {
      return { ok: false, error: 'ciclo', detalle: 'un paso no puede apuntarse a sí mismo' };
    }
    throw err;
  }
}

/** Señal interna para que `tx()` haga rollback al detectar un ciclo. No se exporta. */
class ErrorCiclo extends Error {
  constructor(public readonly mensaje: string) {
    super(mensaje);
  }
}

/**
 * El switch de `funnels.activo`. Igual que en páginas y productos: apagar es
 * siempre seguro, la confirmación al encender vive en la UI (regla 1).
 */
export async function setActivoFunnel(id: string, activo: boolean): Promise<void> {
  await q('update funnels set activo = $1, updated_at = now() where id = $2', [activo, id]);
}

/**
 * Borra el funnel. Los pasos NO se borran en cascada (`on delete set null` en
 * la FK): quedan como páginas sueltas, sin funnel, con sus flechas también en
 * null por la misma razón — es preferible un paso "colgado" y visible en
 * `/admin/paginas` que perder productos y cobros históricos que le apuntan.
 */
export async function borrarFunnel(id: string): Promise<void> {
  await q('delete from funnels where id = $1', [id]);
}
