/**
 * Los números. Es la pantalla que contesta "¿cuánto vendí?", que hasta ahora no
 * se podía contestar en ningún lado del panel: había links, productos, funnels y
 * la lista cruda de cobros, y ni un solo importe sumado.
 *
 * ── Todo sale de `cobros`, no de Whop ───────────────────────────────────────
 * No hay ninguna llamada a la API acá, y es a propósito: cada intento de cobro ya
 * queda escrito en nuestra base con su monto y su estado. Pedirle los números a
 * Whop haría que la pantalla dependa de que su API responda, y encima daría otro
 * total (Whop ve también lo que se cobre desde fuera de este checkout).
 *
 * La contracara es que estos números valen lo que valga el estado de los cobros,
 * y el estado depende de que el webhook o la reconciliación lo cierren. Si el
 * cron de reconciliación no corre, acá van a aparecer cobros "sin resolver" — que
 * es exactamente lo que hay que ver.
 *
 * ── Dos decisiones sobre cómo se cuenta ─────────────────────────────────────
 *  1. La aprobación se calcula sobre los cobros RESUELTOS, no sobre todos. Un
 *     cobro en `procesando` todavía no rechazó nada: contarlo como no-aprobado
 *     hunde el número apenas se dispara un cobro y lo hace ver como un problema
 *     de tarjetas cuando es un cobro en vuelo.
 *  2. El bruto se agrupa POR MONEDA y nunca se suman dos monedas en un total. Un
 *     `sum(monto)` que mezcle usd y ars da un número que no significa nada y que
 *     igual alguien va a leer como si fueran dólares.
 */
import { q, q1 } from '../db';

/** Bruto de una moneda. `total` viene como string: es un `numeric`. */
export type BrutoMoneda = { moneda: string; total: string };

export type Resumen = {
  /** Cobros creados en la ventana, sin importar cómo terminaron. */
  intentos: number;
  pagados: number;
  /** `fallido` + `requiere_tarjeta`: los que llegaron a un final y no entraron. */
  rechazados: number;
  /** `creando` + `procesando`: todavía en vuelo. */
  sinResolver: number;
  /** pagados / (pagados + rechazados). `null` cuando no hay ninguno resuelto. */
  aprobacion: number | null;
  brutoPorMoneda: BrutoMoneda[];
  /** Bruto ya descontando lo reembolsado, por moneda. */
  netoPorMoneda: BrutoMoneda[];
  reembolsos: number;
  disputas: number;
  /** Órdenes creadas: gente que puso nombre y email en el checkout. */
  ordenesIniciadas: number;
  /** Cobros del front que quedaron pagados. */
  frontPagados: number;
  /** frontPagados / ordenesIniciadas. La conversión real de la página de pago. */
  conversionCheckout: number | null;
};

/** Un paso del funnel con sus números. Es la tabla de take-rate. */
export type FilaPaso = {
  pagina_id: string;
  slug: string;
  nombre: string | null;
  tipo: 'front' | 'upsell';
  funnel_nombre: string | null;
  orden: number;
  producto_nombre: string;
  intentos: number;
  pagados: number;
  moneda: string | null;
  bruto: string;
};

/**
 * `$1 || ' hours'` y no `interval '$1 hours'`: un intervalo no acepta parámetro
 * en la posición del literal, y la alternativa es interpolar el número en el SQL
 * — que en este archivo sería inofensivo porque el valor sale de un `const`, pero
 * es el patrón que después alguien copia en una query donde el valor viene del
 * request.
 */
export async function resumen(horas: number): Promise<Resumen> {
  const h = String(horas);

  const [conteos, bruto, neto, ordenes] = await Promise.all([
    q1<{
      intentos: string;
      pagados: string;
      rechazados: string;
      sin_resolver: string;
      reembolsos: string;
      disputas: string;
      front_pagados: string;
    }>(
      `select
          count(*)::text as intentos,
          count(*) filter (where status = 'pagado')::text as pagados,
          count(*) filter (where status in ('fallido', 'requiere_tarjeta'))::text as rechazados,
          count(*) filter (where status in ('creando', 'procesando'))::text as sin_resolver,
          count(*) filter (where reembolsado_at is not null)::text as reembolsos,
          count(*) filter (where disputa_at is not null)::text as disputas,
          count(*) filter (where status = 'pagado' and origen = 'front')::text as front_pagados
         from cobros
        where created_at > now() - ($1 || ' hours')::interval`,
      [h],
    ),

    q<BrutoMoneda>(
      `select coalesce(moneda, 'usd') as moneda, coalesce(sum(monto), 0)::text as total
         from cobros
        where status = 'pagado'
          and created_at > now() - ($1 || ' hours')::interval
        group by coalesce(moneda, 'usd')
        order by 1`,
      [h],
    ),

    q<BrutoMoneda>(
      `select coalesce(moneda, 'usd') as moneda, coalesce(sum(monto), 0)::text as total
         from cobros
        where status = 'pagado'
          and reembolsado_at is null
          and created_at > now() - ($1 || ' hours')::interval
        group by coalesce(moneda, 'usd')
        order by 1`,
      [h],
    ),

    q1<{ total: string }>(
      `select count(*)::text as total
         from ordenes
        where created_at > now() - ($1 || ' hours')::interval`,
      [h],
    ),
  ]);

  const pagados = Number(conteos?.pagados ?? 0);
  const rechazados = Number(conteos?.rechazados ?? 0);
  const resueltos = pagados + rechazados;
  const ordenesIniciadas = Number(ordenes?.total ?? 0);
  const frontPagados = Number(conteos?.front_pagados ?? 0);

  return {
    intentos: Number(conteos?.intentos ?? 0),
    pagados,
    rechazados,
    sinResolver: Number(conteos?.sin_resolver ?? 0),
    aprobacion: resueltos > 0 ? pagados / resueltos : null,
    brutoPorMoneda: bruto,
    netoPorMoneda: neto,
    reembolsos: Number(conteos?.reembolsos ?? 0),
    disputas: Number(conteos?.disputas ?? 0),
    ordenesIniciadas,
    frontPagados,
    conversionCheckout: ordenesIniciadas > 0 ? frontPagados / ordenesIniciadas : null,
  };
}

/**
 * Los pasos con sus números, ordenados como el funnel.
 *
 * `left join` desde `paginas` y no `from cobros`: un paso que nunca cobró tiene
 * que aparecer con 0. Si arrancara de `cobros`, el upsell que no vendió nada
 * desaparecería de la tabla — justo el que hay que mirar.
 */
export async function porPaso(horas: number): Promise<FilaPaso[]> {
  return q<FilaPaso>(
    `select pg.id as pagina_id, pg.slug, pg.nombre, pg.tipo, pg.orden,
            f.nombre as funnel_nombre,
            pr.nombre as producto_nombre,
            count(c.id)::int as intentos,
            count(c.id) filter (where c.status = 'pagado')::int as pagados,
            max(coalesce(c.moneda, pr.moneda)) as moneda,
            coalesce(sum(c.monto) filter (where c.status = 'pagado'), 0)::text as bruto
       from paginas pg
       join productos pr on pr.id = pg.producto_id
       left join funnels f on f.id = pg.funnel_id
       left join cobros c
              on c.pagina_id = pg.id
             and c.created_at > now() - ($1 || ' hours')::interval
      group by pg.id, pg.slug, pg.nombre, pg.tipo, pg.orden, f.nombre, pr.nombre
      order by f.nombre nulls last, pg.orden asc, pg.slug asc`,
    [String(horas)],
  );
}

/**
 * Los declines más frecuentes. Es lo que dice si el problema son las tarjetas
 * (3DS, fondos) o la configuración (un plan mal asociado devuelve siempre el
 * mismo código).
 */
export type FilaDecline = { decline_code: string; veces: number };

export async function declinesFrecuentes(horas: number, limite = 8): Promise<FilaDecline[]> {
  return q<FilaDecline>(
    `select decline_code, count(*)::int as veces
       from cobros
      where decline_code is not null
        and created_at > now() - ($1 || ' hours')::interval
      group by decline_code
      order by veces desc
      limit $2`,
    [String(horas), limite],
  );
}
