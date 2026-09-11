/**
 * El estado del webhook de Whop leído de la base, para que el panel pueda decir
 * si funciona.
 *
 * Los tipos, la lista de eventos y la URL viven en `webhook-contrato.ts`, que no
 * importa nada: este archivo toca Postgres y por eso no lo puede importar un
 * componente cliente (webpack arrastraría `pg` al bundle del browser).
 *
 * ── Por qué esta pantalla existe ─────────────────────────────────────────────
 * El webhook es el único camino que le dice a este servicio que un cobro entró.
 * Si el signing secret está mal, `POST /api/webhooks/whop` rechaza todo con 400,
 * Whop reintenta un rato y después apaga el endpoint. La plata igual se mueve —
 * del lado de Whop el cobro fue exitoso — pero la orden nunca se marca pagada y
 * **el comprador no recibe nada**.
 *
 * O sea: el modo de falla no tiene ningún síntoma visible del lado del panel. Se
 * ve como "nadie compró". Por eso hace falta una pantalla que conteste, sin
 * ambigüedad, "¿llegó alguna vez un evento firmado?".
 *
 * Pasó de verdad: el 2026-09-11 la cuenta que cobra (`biz_LHktpJ17c83CFt`) no
 * tenía NINGÚN webhook registrado, porque el que existía era de la cuenta
 * anterior. Los cobros entraron y nadie recibió nada.
 *
 * ── Lo que verifica de verdad ────────────────────────────────────────────────
 * No hay endpoint en Whop que valide un signing secret. Lo único que lo prueba es
 * mandar un evento real: **Dashboard → Developer → Webhooks → Send event**, con
 * `payment.succeeded`. Si la firma es correcta aparece una fila en
 * `whop_eventos`; si no, el endpoint devuelve 400 y no aparece nada. Esta función
 * lee esa tabla, así que la ausencia de eventos ES el diagnóstico.
 *
 * Solo lectura y sin red: es una consulta a la base y nada más.
 */
import { q1 } from '../db';
import { urlDelWebhook, type EstadoWebhook } from './webhook-contrato';

export { EVENTOS_DEL_WEBHOOK, urlDelWebhook } from './webhook-contrato';
export type { EstadoWebhook, EventoRecibido } from './webhook-contrato';

type FilaConteo = {
  total: string;
  ultimas24h: string;
  sin_procesar: string;
};

type FilaUltimo = {
  webhook_id: string;
  tipo: string;
  recibido_at: Date;
  procesado_at: Date | null;
  error: string | null;
};

export async function estadoWebhook(base: string): Promise<EstadoWebhook> {
  const url = urlDelWebhook(base);

  // Un solo round-trip para los tres conteos: la pantalla los muestra juntos y
  // separarlos en tres queries solo agregaría latencia.
  //
  // `count(*) filter (where ...)` en vez de sumar booleanos: es la forma estándar
  // en Postgres y no depende de que `true` valga 1.
  let conteo: FilaConteo | null = null;
  let ultimo: FilaUltimo | null = null;

  try {
    conteo = await q1<FilaConteo>(
      `select count(*)                                                          as total,
              count(*) filter (where recibido_at > now() - interval '24 hours') as ultimas24h,
              count(*) filter (where procesado_at is null)                      as sin_procesar
         from whop_eventos`,
    );
    ultimo = await q1<FilaUltimo>(
      `select webhook_id, tipo, recibido_at, procesado_at, error
         from whop_eventos
        order by recibido_at desc
        limit 1`,
    );
  } catch (err) {
    // La tabla existe desde la 001, así que esto solo pasa con la base caída. La
    // pantalla se dibuja igual, en cero: es preferible a un panel que no carga
    // justo cuando se está diagnosticando un problema de entregas.
    console.error('[webhook-estado] no se pudo leer whop_eventos:', err);
  }

  return {
    // `count(*)` de Postgres llega como string por el bigint: `Number` y no
    // `parseInt` porque el valor ya es un entero completo, sin sufijos.
    total: Number(conteo?.total ?? 0),
    ultimas24h: Number(conteo?.ultimas24h ?? 0),
    sinProcesar: Number(conteo?.sin_procesar ?? 0),
    ultimo: ultimo
      ? {
          webhookId: ultimo.webhook_id,
          tipo: ultimo.tipo,
          recibidoAt: ultimo.recibido_at.toISOString(),
          procesadoAt: ultimo.procesado_at?.toISOString() ?? null,
          error: ultimo.error,
        }
      : null,
    url,
  };
}
