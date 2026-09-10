/**
 * La reconciliación: le pregunta a Whop por los cobros que quedaron a medias y
 * los cierra.
 *
 * ── El agujero que tapa ─────────────────────────────────────────────────────
 * Un cobro se resuelve por dos vías: el polling del browser
 * (`GET /api/cobros/[id]`) y el webhook. Las dos se caen en el mismo caso:
 *
 *   · El polling necesita que el browser siga abierto. Si la persona cierra la
 *     pestaña, nadie más pregunta.
 *   · Y además el polling SALE TEMPRANO cuando el cobro no tiene
 *     `whop_payment_id`: "no hay nada que consultar". Justo el caso del 409
 *     indeterminado y del timeout — o sea, el caso donde es MÁS probable que le
 *     hayamos cobrado a alguien y perdido la respuesta.
 *   · El webhook queda como única red. Y Whop deshabilita un endpoint que falla
 *     72 h seguidas SIN reenviar los eventos de ese período.
 *
 * O sea: hoy alcanza una caída del webhook para que un cobro pagado se quede en
 * `procesando` para siempre. Sin email de entrega, sin evento al dashboard, sin
 * que nada lo diga.
 *
 * ── Los dos barridos ────────────────────────────────────────────────────────
 *   1. Cobros sin resolver (`creando`/`procesando`) de más de N minutos.
 *   2. Cobros `pagado` sin reembolso anotado — para que un reembolso o una
 *      disputa aparezcan en el panel aunque el webhook esté caído. Es lo único
 *      que hace visible un contracargo sin depender de Whop avisándonos.
 *
 * Los dos son round-robin por `cobros.revisado_at` y acotados por `limite`: un
 * barrido que se pasa de largo consume la cuota de la API y el minuto del cron.
 *
 * ── La regla de oro ─────────────────────────────────────────────────────────
 * El listado de pagos (`GET /payments`) se usa SOLO para averiguar qué pago le
 * corresponde a un cobro huérfano. El estado se lee siempre con
 * `obtenerPago(id)`, que devuelve la forma verificada del objeto Payment. Un
 * campo del listado no decide nunca si un cobro está pagado — ver el comentario
 * de `PagoListado` en `lib/whop.ts`.
 */
import { q, q1, qCount } from './db';
import { aplicarEstadoDePago, encolarSalida } from './cobros';
import { esFinal } from './estado-pago';
import { listarPagos, obtenerPago, WhopError, type PagoListado, type PagoWhop } from './whop';
import type { Cobro } from './tipos';

/** Cuánto espera un cobro antes de que valga la pena preguntarle a Whop. */
export const MINUTOS_DE_GRACIA = 5;

/** Cuántos cobros toca cada barrido. Dos llamadas a Whop por cobro, peor caso. */
export const LIMITE_POR_CORRIDA = 20;

/** Hasta cuándo se sigue revisando un cobro pagado por si le entró un reembolso. */
export const DIAS_VIGILANCIA_REEMBOLSO = 120;

const COLS = `c.id, c.orden_id, c.pagina_id, c.producto_id, c.whop_plan_id, c.whop_payment_id, c.status,
       c.decline_code, c.failure_message, c.idempotency_key, c.monto, c.moneda, c.origen,
       c.reembolsado_at, c.disputa_at, c.email_enviado_at, c.created_at, c.updated_at,
       o.whop_checkout_config_id`;

/**
 * El cobro con el único dato de la orden que hace falta acá. Se trae en el mismo
 * SELECT y no con una consulta por cobro: son hasta 20 filas por corrida y un
 * `join` cuesta lo mismo que no hacerlo.
 */
type CobroConOrden = Cobro & { whop_checkout_config_id: string | null };

export type ResultadoReconciliacion = {
  /** Cobros a los que se les preguntó algo. */
  revisados: number;
  /** Cobros que cambiaron de estado. */
  resueltos: number;
  /** Cobros que quedaron en `pagado` gracias a este barrido. */
  rescatados: number;
  /** Huérfanos cuyo pago se encontró en el listado. */
  emparejados: number;
  /** Huérfanos que no aparecieron en el listado: probablemente el cobro nunca salió. */
  sinPagoEnWhop: number;
  reembolsos: number;
  disputas: number;
  errores: number;
};

function vacio(): ResultadoReconciliacion {
  return {
    revisados: 0,
    resueltos: 0,
    rescatados: 0,
    emparejados: 0,
    sinPagoEnWhop: 0,
    reembolsos: 0,
    disputas: 0,
    errores: 0,
  };
}

// ── Emparejar un huérfano con su pago ────────────────────────────────────────

/** Lo mínimo de un cobro que hace falta para emparejarlo. Facilita los tests. */
export type CobroParaEmparejar = {
  orden_id: string;
  pagina_id: string;
  whop_plan_id: string;
  /**
   * `ordenes.whop_checkout_config_id`: la checkout configuration con la que se
   * pagó el FRONT de esta orden. `null` para las órdenes que no llegaron a
   * crearla.
   *
   * Es el vínculo más fuerte que existe para el cobro del front, más que el
   * plan: tiene índice único en `ordenes` y es un campo propio del objeto
   * Payment. Es el mismo criterio que usa `resolverOrdenDePago` en
   * `lib/cobros.ts` como respaldo de `metadata`.
   */
  whop_checkout_config_id: string | null;
};

/**
 * Busca, entre los pagos recientes de Whop, el que le corresponde a un cobro que
 * quedó sin `whop_payment_id`.
 *
 * Pura y conservadora. Las reglas, en orden:
 *
 *   1. Si el pago trae la MISMA checkout configuration que la orden, es el pago
 *      del front de esta orden. Alcanza solo, sin mirar el metadata: esa columna
 *      es única y la escribimos nosotros.
 *   2. Si no, `metadata.orden_id` tiene que coincidir, y entonces:
 *      · con `metadata.pagina_id` (lo manda `crearPagoOffSession`), tiene que
 *        coincidir el paso. Es lo que distingue el upsell 1 del upsell 2 de la
 *        MISMA orden.
 *      · sin él, se exige que coincida el plan.
 *
 * **Si más de un pago matchea, devuelve null.** Adivinar acá sería pegarle el
 * pago de un paso a otro paso: el comprador quedaría con un upsell marcado como
 * pagado que nunca pagó, o al revés. Ante ambigüedad, que lo resuelva el webhook
 * o una persona.
 */
export function emparejar(
  cobro: CobroParaEmparejar,
  pagos: PagoListado[],
): { pago: PagoListado } | { pago: null; motivo: 'ninguno' | 'ambiguo' } {
  const candidatos = pagos.filter((p) => {
    // Regla 1. El `&&` con la columna no nula importa: dos `null` son iguales en
    // JS, y sin ese chequeo TODA orden sin checkout config matchearía con TODO
    // pago que tampoco la tenga.
    if (
      cobro.whop_checkout_config_id &&
      p.checkout_configuration_id === cobro.whop_checkout_config_id
    ) {
      return true;
    }

    const meta = p.metadata ?? {};
    if (meta.orden_id !== cobro.orden_id) return false;

    if (typeof meta.pagina_id === 'string') {
      return meta.pagina_id === cobro.pagina_id;
    }

    return p.planId === cobro.whop_plan_id;
  });

  if (candidatos.length === 1) return { pago: candidatos[0] };
  if (candidatos.length === 0) return { pago: null, motivo: 'ninguno' };
  return { pago: null, motivo: 'ambiguo' };
}

// ── Reembolsos y disputas leídos del pago ────────────────────────────────────

/**
 * Anota reembolso y disputa en sus propias columnas.
 *
 * `coalesce(columna, $2)`: la fecha que ya estaba no se pisa. El webhook y este
 * barrido escriben lo mismo, y el que llegue segundo no tiene que mover la fecha
 * — cuándo empezó una disputa es el dato con el que se cuenta el plazo.
 *
 * El `status` del cobro NO se toca: un cobro reembolsado sigue en `pagado`. La
 * plata entró y después salió, y son dos hechos distintos.
 */
async function anotarReembolsoYDisputa(
  cobro: Cobro,
  pago: PagoWhop,
): Promise<{ reembolso: boolean; disputa: boolean }> {
  const sub = (pago.substatus ?? '').trim().toLowerCase();

  // Dos fuentes para lo mismo, y se usan las dos: el campo explícito cuando
  // viene, y el substatus como respaldo. `partially_refunded` cuenta: un
  // reembolso parcial es plata que volvió y hay que verlo en el panel.
  const reembolsadoAt =
    pago.refunded_at ??
    (sub === 'refunded' || sub === 'auto_refunded' || sub === 'partially_refunded'
      ? new Date().toISOString()
      : null);

  const disputaAt =
    pago.dispute_alerted_at ?? (sub.startsWith('dispute') || sub === 'open_dispute' ? new Date().toISOString() : null);

  let reembolso = false;
  let disputa = false;

  if (reembolsadoAt && !cobro.reembolsado_at) {
    const filas = await qCount(
      `update cobros set reembolsado_at = coalesce(reembolsado_at, $2), updated_at = now()
        where id = $1 and reembolsado_at is null`,
      [cobro.id, reembolsadoAt],
    );
    if (filas > 0) {
      reembolso = true;
      // Misma salida que escribe el webhook en `manejarReembolso`, con
      // `cobro_id` en null: no hay una venta nueva que reportar, y el cron de
      // salidas la marca enviada sin destino. Sirve de rastro.
      await encolarSalida(null, { motivo: 'reembolso', pago_id: pago.id, via: 'reconciliacion' });
    }
  }

  if (disputaAt && !cobro.disputa_at) {
    const filas = await qCount(
      `update cobros set disputa_at = coalesce(disputa_at, $2), updated_at = now()
        where id = $1 and disputa_at is null`,
      [cobro.id, disputaAt],
    );
    if (filas > 0) {
      disputa = true;
      await encolarSalida(null, { motivo: 'disputa', pago_id: pago.id, via: 'reconciliacion' });
    }
  }

  return { reembolso, disputa };
}

/** Marca que este cobro se miró. Es lo que hace avanzar el round-robin. */
async function marcarRevisado(cobroId: string): Promise<void> {
  await q('update cobros set revisado_at = now() where id = $1', [cobroId]);
}

/**
 * Aplica el pago traído de Whop sobre el cobro y encola la entrega si
 * corresponde. Es el mismo camino que usan el webhook y el polling: misma
 * función monótona, mismo `encolarSalida` solo ante un cambio real.
 */
async function aplicar(cobro: Cobro, pago: PagoWhop, r: ResultadoReconciliacion): Promise<void> {
  const { status, cambio } = await aplicarEstadoDePago(cobro, pago);

  if (cambio) {
    r.resueltos++;
    if (status === 'pagado') {
      r.rescatados++;
      await encolarSalida(cobro.id, { motivo: 'pago_confirmado', pago_id: pago.id, via: 'reconciliacion' });
      console.log(`[reconciliar] cobro ${cobro.id} rescatado: quedó pagado y se encoló la entrega`);
    } else {
      console.log(`[reconciliar] cobro ${cobro.id}: ${cobro.status} → ${status}`);
    }
  }

  const anotado = await anotarReembolsoYDisputa({ ...cobro, status }, pago);
  if (anotado.reembolso) r.reembolsos++;
  if (anotado.disputa) r.disputas++;
}

// ── Barrido 1: los que no se resolvieron ─────────────────────────────────────

async function barrerSinResolver(limite: number, r: ResultadoReconciliacion): Promise<void> {
  const cobros = await q<CobroConOrden>(
    `select ${COLS}
       from cobros c
       join ordenes o on o.id = c.orden_id
      where c.status in ('creando', 'procesando')
        and c.created_at < now() - ($1 || ' minutes')::interval
      order by c.revisado_at nulls first, c.created_at asc
      limit $2`,
    [String(MINUTOS_DE_GRACIA), limite],
  );

  if (cobros.length === 0) return;

  // Los que tienen payment id se resuelven de a uno. Los huérfanos necesitan el
  // listado, que se pide UNA vez para todos: son hasta 20 cobros y el listado
  // trae 100 pagos, así que una sola llamada alcanza y no se multiplica la cuota.
  const conId = cobros.filter((c) => c.whop_payment_id);
  const huerfanos = cobros.filter((c) => !c.whop_payment_id);

  for (const cobro of conId) {
    r.revisados++;
    try {
      const pago = await obtenerPago(cobro.whop_payment_id!);
      await aplicar(cobro, pago, r);
    } catch (err) {
      r.errores++;
      const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
      // Nunca se marca fallido por no haber podido preguntar: el mismo criterio
      // que el polling. Un cobro que Whop no contesta hoy se vuelve a mirar
      // mañana; un cobro marcado fallido por error le niega el producto a
      // alguien que pagó y nadie lo detecta.
      console.warn(`[reconciliar] cobro ${cobro.id}: no se pudo consultar el pago (${motivo})`);
    }
    await marcarRevisado(cobro.id);
  }

  if (huerfanos.length > 0) {
    await resolverHuerfanos(huerfanos, r);
  }
}

/**
 * Los cobros que quedaron sin `whop_payment_id`: el caso peligroso.
 *
 * La ventana del listado arranca 10 minutos antes del huérfano más viejo. No es
 * arbitrario: el pago en Whop se crea cuando se hace el POST, que es siempre
 * ANTES de que la fila del cobro se marque, pero los relojes de las dos máquinas
 * no son el mismo. Sin ese margen, un desfase de segundos deja el pago fuera de
 * la ventana y el huérfano parece no tener pago — que es la conclusión más
 * peligrosa posible, porque significa "no le cobramos" cuando sí.
 */
async function resolverHuerfanos(huerfanos: CobroConOrden[], r: ResultadoReconciliacion): Promise<void> {
  const masViejo = huerfanos.reduce(
    (min, c) => (new Date(c.created_at) < min ? new Date(c.created_at) : min),
    new Date(huerfanos[0].created_at),
  );
  const desde = new Date(masViejo.getTime() - 10 * 60_000);

  let pagos: PagoListado[];
  try {
    pagos = await listarPagos({ creadosDespuesDe: desde, limite: 100 });
  } catch (err) {
    r.errores += huerfanos.length;
    const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
    console.warn(
      `[reconciliar] no se pudo listar los pagos de Whop (${motivo}): ${huerfanos.length} cobro(s) sin payment id quedan para la próxima`,
    );
    return;
  }

  // Un pago que ya está pegado a OTRO cobro no puede emparejarse de nuevo:
  // `cobros_whop_payment_idx` es único, así que el UPDATE moriría con un error
  // de clave duplicada. Filtrarlo antes es más limpio que atrapar la excepción.
  const ids = pagos.map((p) => p.id);
  const tomados = ids.length
    ? new Set(
        (
          await q<{ whop_payment_id: string }>(
            'select whop_payment_id from cobros where whop_payment_id = any($1::text[])',
            [ids],
          )
        ).map((f) => f.whop_payment_id),
      )
    : new Set<string>();

  const disponibles = pagos.filter((p) => !tomados.has(p.id));

  for (const cobro of huerfanos) {
    r.revisados++;
    const match = emparejar(cobro, disponibles);

    if (!match.pago) {
      if (match.motivo === 'ambiguo') {
        r.errores++;
        console.error(
          `[reconciliar] cobro ${cobro.id}: MÁS DE UN pago de Whop matchea la orden. No se toca: hay que resolverlo a mano.`,
        );
      } else {
        r.sinPagoEnWhop++;
        console.log(
          `[reconciliar] cobro ${cobro.id}: ningún pago en Whop con este orden_id. El cobro probablemente nunca salió.`,
        );
      }
      await marcarRevisado(cobro.id);
      continue;
    }

    // El id se escribe ANTES de aplicar el estado, y con su propio UPDATE.
    //
    // No es redundante con el `coalesce(whop_payment_id, $6)` de
    // `aplicarEstadoDePago`: esa función no escribe NADA cuando el estado no
    // cambia (`puedeCambiar` corta antes). Un pago que sigue en `pending` deja
    // el cobro igual, y sin este UPDATE el vínculo se perdería y habría que
    // listar de nuevo en cada corrida, para siempre.
    await q(
      `update cobros set whop_payment_id = $2, updated_at = now()
        where id = $1 and whop_payment_id is null`,
      [cobro.id, match.pago.id],
    );
    r.emparejados++;
    console.log(`[reconciliar] cobro ${cobro.id} emparejado con el pago ${match.pago.id}`);

    try {
      const pago = await obtenerPago(match.pago.id);
      await aplicar({ ...cobro, whop_payment_id: match.pago.id }, pago, r);
    } catch (err) {
      r.errores++;
      const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
      console.warn(`[reconciliar] cobro ${cobro.id}: emparejado pero no se pudo leer el pago (${motivo})`);
    }
    await marcarRevisado(cobro.id);
  }
}

// ── Barrido 2: reembolsos y disputas sobre lo ya pagado ──────────────────────

async function barrerPagados(limite: number, r: ResultadoReconciliacion): Promise<void> {
  const cobros = await q<CobroConOrden>(
    `select ${COLS}
       from cobros c
       join ordenes o on o.id = c.orden_id
      where c.status = 'pagado'
        and c.reembolsado_at is null
        and c.whop_payment_id is not null
        and c.created_at > now() - ($1 || ' days')::interval
      order by c.revisado_at nulls first, c.created_at desc
      limit $2`,
    [String(DIAS_VIGILANCIA_REEMBOLSO), limite],
  );

  for (const cobro of cobros) {
    r.revisados++;
    try {
      const pago = await obtenerPago(cobro.whop_payment_id!);
      const anotado = await anotarReembolsoYDisputa(cobro, pago);
      if (anotado.reembolso) {
        r.reembolsos++;
        console.log(`[reconciliar] cobro ${cobro.id}: reembolso detectado sin webhook`);
      }
      if (anotado.disputa) {
        r.disputas++;
        console.log(`[reconciliar] cobro ${cobro.id}: disputa detectada sin webhook`);
      }
    } catch (err) {
      r.errores++;
      const motivo = err instanceof WhopError ? `${err.status} ${err.message}` : String(err);
      console.warn(`[reconciliar] cobro ${cobro.id}: no se pudo revisar el reembolso (${motivo})`);
    }
    await marcarRevisado(cobro.id);
  }
}

/**
 * Corre los dos barridos. Es lo único que llama el cron.
 *
 * El presupuesto se reparte: dos tercios para los cobros sin resolver (donde hay
 * alguien esperando su producto) y un tercio para revisar reembolsos (que no
 * tiene apuro, pero tiene que avanzar).
 */
export async function reconciliar(opciones: { limite?: number } = {}): Promise<ResultadoReconciliacion> {
  const limite = opciones.limite ?? LIMITE_POR_CORRIDA;
  const r = vacio();

  await barrerSinResolver(Math.max(1, Math.ceil((limite * 2) / 3)), r);
  await barrerPagados(Math.max(1, Math.floor(limite / 3)), r);

  return r;
}

/**
 * Cuántos cobros hay esperando reconciliación. Lo usa `/api/health` para poder
 * decir algo más útil que "la base responde".
 */
export async function pendientesDeReconciliar(): Promise<number> {
  const fila = await q1<{ total: string }>(
    `select count(*)::text as total
       from cobros
      where status in ('creando', 'procesando')
        and created_at < now() - ($1 || ' minutes')::interval`,
    [String(MINUTOS_DE_GRACIA)],
  );
  return Number(fila?.total ?? 0);
}

/** Re-exportado para los tests: `esFinal` decide cuándo dejar de preguntar. */
export { esFinal };
