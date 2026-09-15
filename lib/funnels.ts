/**
 * El grafo del funnel: a dónde va el comprador después de cada paso.
 *
 * **Este módulo decide qué pasa inmediatamente después de cobrar.** Un bug acá no
 * cobra dos veces —de eso se encarga el índice único de `cobros`— pero manda al
 * comprador a la página equivocada con la plata ya sacada de su tarjeta, que es
 * la clase de error que termina en un reclamo y no en un log.
 *
 * Por eso la decisión está separada en una función pura (`resolverDestino`) que se
 * puede probar con una tabla de casos, y la lectura de la base en otra. Los cuatro
 * lugares que antes leían `url_exito` a mano ahora llaman acá.
 */
import { q, q1 } from './db';
import type { EstadoCobro } from './estado-pago';

/** Lo que el resolutor necesita saber del paso que se acaba de resolver. */
export type PasoParaResolver = {
  id: string;
  funnel_id: string | null;
  permite_rechazo: boolean;
  paso_aceptado_id: string | null;
  paso_rechazado_id: string | null;
  /**
   * A dónde mandar cuando el decline es por fondos insuficientes
   * (`insufficient_funds` y el resto del grupo `sin_fondos` de
   * `lib/estado-pago.ts`). Independiente de `permite_rechazo` y de
   * `paso_rechazado_id` a propósito (migración 014): ese toggle es "mostrar el
   * botón de rechazo", un click explícito del comprador — fondos insuficientes
   * no es un click, es un fallo técnico del pago, y exigir el toggle obligaría
   * a prender un botón que el operador no quiere mostrar solo para habilitar
   * este otro camino.
   */
  downsell_por_fondos_id: string | null;
  /** Las URLs viejas, para las páginas que no pertenecen a un funnel. */
  url_exito: string | null;
  url_rechazo: string | null;
};

/** Lo que se sabe del funnel al que pertenece el paso. */
export type FunnelParaResolver = {
  id: string;
  activo: boolean;
  url_gracias: string | null;
};

/** El destino de cada paso alcanzable, indexado por id. */
export type UrlsDePasos = Record<string, string | null>;

/**
 * Qué pasó con el paso, desde el punto de vista del flujo. No es lo mismo que
 * `EstadoCobro`: un cobro `procesando` todavía no decide nada, y un rechazo no
 * es un cobro en absoluto.
 */
export type Resultado = 'aceptado' | 'rechazado';

export type Destino =
  | { tipo: 'paso'; pasoId: string; url: string }
  | { tipo: 'gracias'; url: string }
  | { tipo: 'url_directa'; url: string }
  /** No hay a dónde ir: el panel no configuró nada. El loader se queda quieto. */
  | { tipo: 'sin_destino'; motivo: string };

/**
 * Decide el destino. **Pura**: no toca base ni red, así que se prueba con una
 * tabla de casos en vez de con una compra real.
 *
 * @param paso      el paso que se acaba de resolver
 * @param resultado si el comprador aceptó (pagó) o rechazó
 * @param funnel    el funnel del paso, o null si la página es suelta
 * @param urls      `url_externa` de cada paso alcanzable, por id
 */
export function resolverDestino(
  paso: PasoParaResolver,
  resultado: Resultado,
  funnel: FunnelParaResolver | null,
  urls: UrlsDePasos,
): Destino {
  // ── Página suelta, sin funnel ────────────────────────────────────────────
  // Es el modo anterior a la migración 003 y sigue soportado: no se rompe un
  // link que ya está publicado en un anuncio por haber agregado funnels.
  if (!paso.funnel_id || !funnel) {
    const url = resultado === 'aceptado' ? paso.url_exito : paso.url_rechazo;
    if (url) return { tipo: 'url_directa', url };
    return { tipo: 'sin_destino', motivo: 'la página no está en un funnel y no tiene URL configurada' };
  }

  // ── Rechazo con el botón apagado ─────────────────────────────────────────
  // No se cae a la página de gracias: si el paso no ofrece salida sin comprar,
  // que igual exista una URL de rechazo sería una puerta que el panel dijo que
  // no quería. El loader no muestra el botón, y si alguien llama al endpoint a
  // mano, no pasa nada.
  if (resultado === 'rechazado' && !paso.permite_rechazo) {
    return { tipo: 'sin_destino', motivo: 'este paso no tiene el botón de rechazo activado' };
  }

  const siguienteId = resultado === 'aceptado' ? paso.paso_aceptado_id : paso.paso_rechazado_id;

  if (siguienteId) {
    const url = urls[siguienteId];
    if (url) return { tipo: 'paso', pasoId: siguienteId, url };
    // El paso destino existe pero no tiene `url_externa`. Es un error de
    // configuración, y caer a la página de gracias es lo correcto: el comprador
    // ya pagó y no puede quedarse en el aire por un campo vacío del panel.
    if (funnel.url_gracias) {
      console.error(
        `[funnels] el paso ${siguienteId} no tiene url_externa; se manda a la página de gracias`,
      );
      return { tipo: 'gracias', url: funnel.url_gracias };
    }
    return { tipo: 'sin_destino', motivo: `el paso ${siguienteId} no tiene url_externa configurada` };
  }

  // Sin siguiente: el funnel se terminó acá.
  if (funnel.url_gracias) return { tipo: 'gracias', url: funnel.url_gracias };
  return { tipo: 'sin_destino', motivo: 'el funnel no tiene página de gracias configurada' };
}

/**
 * Decide el destino cuando el decline es por fondos insuficientes. **Pura**,
 * igual que `resolverDestino` — misma razón, se prueba con una tabla de casos.
 *
 * A propósito NO es una rama de `resolverDestino`: ese resolutor corta con
 * `sin_destino` cuando `!paso.permite_rechazo`, y ese toggle significa "mostrar
 * el botón de rechazo visible al comprador" — un click explícito. Sin fondos no
 * hay click: es Whop devolviendo un decline. Pisar `permite_rechazo` para este
 * caso obligaría a prender un botón que el operador no quiere mostrar, solo para
 * habilitar este otro camino (migración 014).
 *
 * Sin funnel (página suelta): no hay downsell posible — el concepto de downsell
 * por fondos es de funnel, igual que `paso_rechazado_id` lo es. Se devuelve
 * `sin_destino` y el llamador se queda con el comportamiento de antes (el cobro
 * queda `fallido`, sin redirección).
 *
 * `downsell_por_fondos_id` en null (el caso más común: nadie configuró nada
 * todavía) también es `sin_destino`, nunca cae a la página de gracias — a
 * diferencia de `resolverDestino`, mandar a la página de gracias a alguien que
 * NO compró sería mentirle. El silencio (quedarse donde está) es correcto acá.
 */
export function resolverDestinoPorFondos(
  paso: Pick<PasoParaResolver, 'id' | 'funnel_id' | 'downsell_por_fondos_id'>,
  funnel: FunnelParaResolver | null,
  urls: UrlsDePasos,
): Destino {
  if (!paso.funnel_id || !funnel) {
    return { tipo: 'sin_destino', motivo: 'la página no está en un funnel: no hay downsell por fondos posible' };
  }

  const destinoId = paso.downsell_por_fondos_id;
  if (!destinoId) {
    return { tipo: 'sin_destino', motivo: 'este paso no tiene configurado un downsell por fondos insuficientes' };
  }

  const url = urls[destinoId];
  if (url) return { tipo: 'paso', pasoId: destinoId, url };

  // El paso destino existe pero no tiene `url_externa`: es un error de
  // configuración. A diferencia de `resolverDestino`, NO se cae a la página de
  // gracias — el comprador no compró este downsell, así que "gracias" sería
  // falso. Se prefiere el silencio (sin_destino) al mensaje incorrecto.
  console.error(
    `[funnels] el downsell por fondos ${destinoId} no tiene url_externa configurada`,
  );
  return { tipo: 'sin_destino', motivo: `el downsell ${destinoId} no tiene url_externa configurada` };
}

/**
 * Traduce un estado de cobro a un resultado de flujo, o `null` cuando todavía no
 * hay nada que decidir.
 *
 * `requiere_tarjeta` NO es un rechazo: el comprador quiso pagar y el banco pidió
 * autenticación. Tratarlo como rechazo lo sacaría del funnel en el momento en que
 * más cerca estuvo de comprar.
 */
export function resultadoDeEstado(estado: EstadoCobro): Resultado | null {
  if (estado === 'pagado') return 'aceptado';
  // `fallido` manda por el camino del rechazo, que es a dónde el panel decidió
  // mandar a quien no compra. `procesando`, `creando` y `requiere_tarjeta` no
  // deciden nada todavía.
  if (estado === 'fallido') return 'rechazado';
  return null;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

type FilaPaso = PasoParaResolver & { funnel_activo: boolean | null; funnel_gracias: string | null };

/**
 * Trae la fila del paso con su funnel, y las `url_externa` de todos los pasos
 * del mismo funnel. Compartido entre `resolverSiguiente` y
 * `resolverSiguientePorFondos`: los dos necesitan exactamente los mismos datos,
 * solo cambia qué función pura decide el destino con ellos.
 *
 * Se traen TODAS las urls del funnel y no solo las que podrían hacer falta: son
 * pocas filas, y una sola query es más simple de razonar que condicionales
 * anidados que a veces piden una y a veces dos.
 */
async function leerPasoConFunnel(
  pasoId: string,
): Promise<{ fila: FilaPaso; funnel: FunnelParaResolver | null; urls: UrlsDePasos } | null> {
  const fila = await q1<FilaPaso>(
    `select pg.id, pg.funnel_id, pg.permite_rechazo, pg.paso_aceptado_id, pg.paso_rechazado_id,
            pg.downsell_por_fondos_id,
            pg.url_exito, pg.url_rechazo,
            f.activo as funnel_activo, f.url_gracias as funnel_gracias
       from paginas pg
       left join funnels f on f.id = pg.funnel_id
      where pg.id = $1`,
    [pasoId],
  );

  if (!fila) return null;

  const funnel: FunnelParaResolver | null = fila.funnel_id
    ? { id: fila.funnel_id, activo: Boolean(fila.funnel_activo), url_gracias: fila.funnel_gracias }
    : null;

  let urls: UrlsDePasos = {};
  if (fila.funnel_id) {
    const filas = await q<{ id: string; url_externa: string | null }>(
      'select id, url_externa from paginas where funnel_id = $1',
      [fila.funnel_id],
    );
    urls = Object.fromEntries(filas.map((f) => [f.id, f.url_externa]));
  }

  return { fila, funnel, urls };
}

export async function resolverSiguiente(pasoId: string, resultado: Resultado): Promise<Destino> {
  const leido = await leerPasoConFunnel(pasoId);
  if (!leido) return { tipo: 'sin_destino', motivo: `no existe el paso ${pasoId}` };
  return resolverDestino(leido.fila, resultado, leido.funnel, leido.urls);
}

/**
 * Igual que `resolverSiguiente`, pero para el camino de fondos insuficientes:
 * usa `resolverDestinoPorFondos` en vez de `resolverDestino`, así que no
 * depende de `permite_rechazo` (ver el comentario de esa función).
 */
export async function resolverSiguientePorFondos(pasoId: string): Promise<Destino> {
  const leido = await leerPasoConFunnel(pasoId);
  if (!leido) return { tipo: 'sin_destino', motivo: `no existe el paso ${pasoId}` };
  return resolverDestinoPorFondos(leido.fila, leido.funnel, leido.urls);
}

/**
 * El punto de entrada que usan los endpoints: resuelve el destino y le pega el
 * token de la orden.
 *
 * **El token se agrega SIEMPRE**, aunque el `loader.js` también lo guarde en
 * `sessionStorage`. Depender solo del sessionStorage funciona mientras toda la
 * cadena viva en el mismo origen, y se rompe en silencio el día que un upsell se
 * publica en otro dominio o el comprador vuelve del checkout de recuperación:
 * el botón deja de cobrar y no hay ningún error visible que lo explique.
 *
 * Devuelve `null` cuando no hay a dónde ir. Los callers tratan el null como
 * "quedate donde estás", nunca como error: el comprador ya pagó y una URL mal
 * configurada en el panel no puede terminar en una pantalla de error.
 */
export async function resolverSiguienteUrl(
  pasoId: string,
  resultado: Resultado,
  token: string,
): Promise<string | null> {
  const destino = await resolverSiguiente(pasoId, resultado);
  return urlDelDestino(pasoId, destino, token);
}

/**
 * Igual que `resolverSiguienteUrl`, pero para el camino de fondos
 * insuficientes: no recibe `resultado` porque no hay "aceptado/rechazado" que
 * elegir, solo el destino fijo de `downsell_por_fondos_id` (ver
 * `resolverDestinoPorFondos`).
 */
export async function resolverSiguienteUrlPorFondos(pasoId: string, token: string): Promise<string | null> {
  const destino = await resolverSiguientePorFondos(pasoId);
  return urlDelDestino(pasoId, destino, token);
}

/** Le pega el token de la orden a la URL del destino, o `null` si no hay destino. */
function urlDelDestino(pasoId: string, destino: Destino, token: string): string | null {
  if (destino.tipo === 'sin_destino') {
    console.log(`[funnels] paso ${pasoId}: sin destino — ${destino.motivo}`);
    return null;
  }

  try {
    const url = new URL(destino.url);
    url.searchParams.set('ot', token);
    return url.toString();
  } catch {
    // URL mal escrita en el panel. Se loguea con el paso para poder arreglarla,
    // y el comprador se queda donde está en vez de ver un error.
    console.error(`[funnels] URL inválida en el destino del paso ${pasoId}: "${destino.url}"`);
    return null;
  }
}

// ── Validación del grafo ─────────────────────────────────────────────────────

/**
 * Busca ciclos siguiendo los punteros desde cada paso.
 *
 * Un ciclo no cobra dos veces —el índice único de `cobros` lo impide— pero manda
 * al comprador a dar vueltas entre dos ofertas que ya compró, sin llegar nunca a
 * la página de gracias. Se detecta al guardar y no al resolver: es una decisión
 * del panel, y avisarle al que la configura es mejor que descubrirlo con un
 * comprador adentro.
 *
 * Devuelve la lista de ids que forman el ciclo, o `null` si no hay.
 */
export function detectarCiclo(
  pasos: { id: string; paso_aceptado_id: string | null; paso_rechazado_id: string | null }[],
): string[] | null {
  const porId = new Map(pasos.map((p) => [p.id, p]));
  const estado = new Map<string, 'visitando' | 'listo'>();

  function recorrer(id: string, camino: string[]): string[] | null {
    if (estado.get(id) === 'listo') return null;
    if (estado.get(id) === 'visitando') return [...camino, id];

    estado.set(id, 'visitando');
    const p = porId.get(id);
    for (const sig of [p?.paso_aceptado_id, p?.paso_rechazado_id]) {
      if (!sig || !porId.has(sig)) continue;
      const ciclo = recorrer(sig, [...camino, id]);
      if (ciclo) return ciclo;
    }
    estado.set(id, 'listo');
    return null;
  }

  for (const p of pasos) {
    const ciclo = recorrer(p.id, []);
    if (ciclo) return ciclo;
  }
  return null;
}
