/**
 * Verificación de la firma de los webhooks de Whop.
 *
 * ── Por qué está escrito a mano ─────────────────────────────────────────────
 * Las dos opciones "de librería" no sirven:
 *
 * 1. `unwrapWebhook` de `@whop/sdk/helpers` es lo que muestra la doc, pero la
 *    doc aclara en la misma página: "The helpers shown here land in the next
 *    release". Todavía no existe. (Y el `webhooks.unwrap` de los ejemplos viejos
 *    fue removido del SDK.)
 *
 * 2. `standardwebhooks` parece la opción obvia porque Whop sigue esa spec, pero
 *    su constructor hace `base64.decode(secret)` después de sacarle un prefijo
 *    `whsec_`. El secret de Whop es un `ws_...`: decodificarlo como base64 da
 *    una clave incorrecta y la firma NO VALIDA NUNCA. Se puede sortear con
 *    `new Webhook(secret, { format: 'raw' })`, que usa los bytes literales del
 *    string — pero entonces la librería aporta 40 líneas de HMAC y una
 *    dependencia cuyo comportamiento por defecto es el equivocado para este
 *    proveedor.
 *
 * Lo que dice la doc de Whop en "Verify without an SDK", que es la fuente que se
 * implementa acá:
 *
 *   - Se firma el string `{webhook-id}.{webhook-timestamp}.{body crudo}`
 *   - HMAC-SHA256, y LA CLAVE ES EL SECRET `ws_...` TAL CUAL (sin sacar el
 *     prefijo, sin decodificar de base64)
 *   - El header `webhook-signature` trae el resultado en base64: `v1,<firma>`
 *   - Se rechaza si `webhook-timestamp` está a más de 5 minutos de ahora
 *
 * ── El body tiene que ser el CRUDO ──────────────────────────────────────────
 * `await req.text()`, nunca `req.json()` antes de verificar. Parsear y volver a
 * serializar cambia los bytes (orden de claves, espacios, escapes) y la firma
 * deja de coincidir. Es la causa #1 de "el webhook no valida y no entiendo por
 * qué".
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Tolerancia de reloj. Más de esto y el request se rechaza como replay. */
const TOLERANCIA_SEGUNDOS = 5 * 60;

export class FirmaInvalida extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmaInvalida';
  }
}

/** El sobre de un evento de Whop, formato `api_version: v1`. */
export type EventoWhop = {
  id: string;
  type: string;
  api_version?: string;
  api_version_date?: string;
  timestamp?: string;
  /**
   * Los webhooks pineados desde 2026-08-14 traen `account_id`; los anteriores y
   * los sin pin traen `company_id`. Se aceptan los dos para que el handler no
   * dependa de cuándo se creó el webhook.
   */
  account_id?: string;
  company_id?: string;
  data: Record<string, unknown>;
};

function comparaConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual tira si los largos difieren, así que el largo se compara
  // antes. Eso filtra información sobre el largo de la firma, que no es secreto.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** HMAC-SHA256 en base64 sobre `{id}.{timestamp}.{body}`. */
function firmar(secret: string, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64');
}

/**
 * Verifica y parsea. Tira `FirmaInvalida` si algo no cierra; el handler nunca
 * ve un payload sin verificar.
 *
 * @param body    El texto crudo del request, sin parsear.
 * @param headers Los headers, en cualquier capitalización.
 * @param secret  `WHOP_WEBHOOK_SECRET`, el `ws_...` tal cual.
 * @param ahora   Inyectable para poder testear la tolerancia de tiempo.
 */
export function verificarWebhook(
  body: string,
  headers: Record<string, string | undefined>,
  secret: string,
  ahora: Date = new Date(),
): EventoWhop {
  if (!secret) throw new FirmaInvalida('WHOP_WEBHOOK_SECRET no está configurada');

  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') h[k.toLowerCase()] = v;
  }

  const id = h['webhook-id'];
  const timestamp = h['webhook-timestamp'];
  const firma = h['webhook-signature'];

  if (!id || !timestamp || !firma) {
    throw new FirmaInvalida('faltan los headers webhook-id / webhook-timestamp / webhook-signature');
  }

  // Ventana de tiempo. Sin esto, alguien que capturó un request válido lo puede
  // reenviar para siempre y nosotros lo procesaríamos como nuevo.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new FirmaInvalida('webhook-timestamp no es un número');
  const deriva = Math.abs(Math.floor(ahora.getTime() / 1000) - ts);
  if (deriva > TOLERANCIA_SEGUNDOS) {
    throw new FirmaInvalida(`webhook-timestamp fuera de la ventana de 5 minutos (${deriva}s de diferencia)`);
  }

  const esperada = firmar(secret, id, timestamp, body);

  // El header puede traer varias firmas separadas por espacio (rotación de
  // secret). Alcanza con que una `v1` coincida.
  let valida = false;
  for (const parte of firma.split(' ')) {
    const idx = parte.indexOf(',');
    if (idx === -1) continue;
    const version = parte.slice(0, idx);
    const valor = parte.slice(idx + 1);
    if (version !== 'v1') continue; // v2/v5 no usan firmas Standard Webhooks
    if (comparaConstante(valor, esperada)) {
      valida = true;
      break;
    }
  }

  if (!valida) throw new FirmaInvalida('la firma no coincide');

  let evento: unknown;
  try {
    evento = JSON.parse(body);
  } catch {
    throw new FirmaInvalida('el body verificó pero no es JSON válido');
  }

  const ev = evento as Partial<EventoWhop>;
  if (!ev || typeof ev.type !== 'string' || typeof ev.data !== 'object' || ev.data === null) {
    throw new FirmaInvalida('el evento no tiene type y data');
  }

  // El `id` del sobre es el mismo `msg_...` del header. Se prefiere el del
  // header para deduplicar: es el que Whop garantiza en todas las versiones
  // ("four headers are contractually frozen").
  return { ...(ev as EventoWhop), id: id };
}

/** Solo para los tests: firma un payload como lo haría Whop. */
export function firmarParaTest(
  secret: string,
  id: string,
  timestampSegundos: number,
  body: string,
): Record<string, string> {
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestampSegundos),
    'webhook-signature': `v1,${firmar(secret, id, String(timestampSegundos), body)}`,
  };
}
