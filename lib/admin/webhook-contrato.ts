/**
 * El contrato del webhook de Whop: los tipos, la lista de eventos y la URL.
 *
 * ── Por qué está separado de `webhook-estado.ts` ─────────────────────────────
 * `webhook-estado.ts` consulta Postgres, así que importa `lib/db` y con eso `pg`.
 * El formulario del panel es un componente cliente y necesita la lista de eventos
 * y la URL — si las importara de ahí, webpack arrastra `pg` al bundle del browser
 * y el build se cae con "Can't resolve 'net'". Pasó de verdad al escribir esta
 * feature.
 *
 * Así que todo lo que el cliente necesita vive acá: cero imports, funciones puras,
 * y nada que toque la red ni la base. Es el mismo criterio que
 * `lib/admin/integracion.ts`.
 */

export type EventoRecibido = {
  webhookId: string;
  tipo: string;
  recibidoAt: string;
  /** null mientras no se procesó. Un evento recibido pero no procesado es un bug nuestro, no de Whop. */
  procesadoAt: string | null;
  error: string | null;
};

export type EstadoWebhook = {
  /** Cuántos eventos firmados llegaron alguna vez. 0 ⇒ el webhook nunca funcionó. */
  total: number;
  /** Cuántos llegaron en las últimas 24 h. Distingue "funcionó una vez" de "funciona". */
  ultimas24h: number;
  /** Cuántos llegaron pero quedaron sin procesar. Si crece, el problema es de este lado. */
  sinProcesar: number;
  /** El más reciente, para mostrar fecha y tipo. NULL si nunca llegó ninguno. */
  ultimo: EventoRecibido | null;
  /**
   * La URL que hay que pegar en el dashboard de Whop. Se deriva de la base
   * pública y no se hardcodea: si el servicio se mueve de dominio, la pantalla
   * sigue diciendo la verdad.
   */
  url: string;
};

/**
 * Los seis eventos que el handler procesa de verdad, en el orden de la doc.
 *
 * Tiene que coincidir con los `case` de `app/api/webhooks/whop/route.ts`. Si el
 * handler gana un caso y esta lista no, el usuario no lo tilda en Whop y ese
 * evento no llega nunca — sin ningún error visible. Hay un test que fija la lista
 * justamente para que ese desajuste no pase inadvertido.
 *
 * Tildar de MÁS en Whop no rompe nada: el handler ignora lo que no conoce y solo
 * devuelve 4xx con firma inválida.
 */
export const EVENTOS_DEL_WEBHOOK = [
  'payment.created',
  'payment.succeeded',
  'payment.failed',
  'payment.pending',
  'refund.created',
  'dispute.created',
] as const;

/**
 * La ruta del endpoint sobre la base pública.
 *
 * Normaliza la barra final porque la base la escribe una persona en un `.env` y
 * llega con barra la mitad de las veces. Sin esto el panel muestra
 * `https://host//api/webhooks/whop` y el usuario lo pega en Whop tal cual.
 */
export function urlDelWebhook(base: string): string {
  return `${base.trim().replace(/\/+$/, '')}/api/webhooks/whop`;
}
