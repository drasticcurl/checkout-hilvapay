/**
 * Módulo de Meta Conversions API para checkout-kashhhpay (T04 del plan
 * PANEL-Y-CAPI). Calco de `testfunnel/lib/tracking.ts` (`sendCapiEvent`,
 * `hashEmail`, `getCapiTargets`), adaptado a los tipos de este repo.
 *
 * Contrato B (00-PLAN-PANEL-Y-CAPI.md §5), declarado por T01 en
 * `lib/capi-tipos.ts` — los tipos NO se redeclaran acá, se importan.
 *
 * Diferencia deliberada con testfunnel: este archivo NO tiene
 * `META_CUSTOM_DATA_ALLOWLIST`. Ese allowlist existe en testfunnel por un
 * incidente puntual con datos de salud de un quiz; este checkout no maneja
 * ese tipo de dato, así que `custom_data` se manda directo con sus únicos dos
 * campos (`value`, `currency`).
 *
 * REGLA QUE NO SE NEGOCIA (contrato B, regla 3): `custom_data.value` va en
 * MONTO DECIMAL (ej. 29.90), NUNCA en centavos. `lib/salidas.ts` usa centavos
 * para el payload del panel (función `centavos()`) — esa función y esa
 * convención NO se reusan acá. `Number(cobro.monto)` directo.
 */
import crypto from 'crypto';
import type {
  CapiTarget,
  EventoCapiPurchase,
  ResultadoArmadoCapi,
} from './capi-tipos';
import type { FilaCobroParaSalida } from './salidas';

const CAPI_VERSION = 'v18.0';

// ─── armarEventoCapi — pura ──────────────────────────────────────────────────

/**
 * Arma el evento Purchase para una venta. Pura: no toca red ni DB.
 *
 * Reglas del contrato B (00-PLAN-PANEL-Y-CAPI.md §5, y §2 de T04):
 * 1. Sin `whop_payment_id` no hay `event_id` útil para Meta: se omite.
 * 2. Sin `monto` no hay `custom_data.value`: se omite.
 * 3. `event_time` en SEGUNDOS unix (Math.floor(ms/1000)) — NO milisegundos.
 * 4. `custom_data.value` en decimal (Number(cobro.monto)), NUNCA centavos.
 * 5. `fbc`, si hay `fbclid`, usa `creationTime` en MILISEGUNDOS — una unidad
 *    distinta de `event_time`, que va en segundos. No son intercambiables.
 * 6. Si no hay `em` NI `fbc`, el evento se arma igual (matching pobre no es
 *    motivo de omisión) — solo se pierde value/currency si no se arma nada.
 */
export function armarEventoCapi(datos: FilaCobroParaSalida): ResultadoArmadoCapi {
  const { cobro, orden, pagina, producto } = datos;

  if (!cobro.whop_payment_id) {
    return { ok: false, motivo: 'omitida: el cobro no tiene whop_payment_id todavía' };
  }
  if (cobro.monto == null) {
    return { ok: false, motivo: 'omitida: el cobro no tiene monto' };
  }

  const baseUrl = process.env.CHECKOUT_BASE_URL ?? 'https://pay.hilvanapp.com';

  const userData: EventoCapiPurchase['user_data'] = {};

  const hashed = hashEmail(orden.email);
  if (hashed) userData.em = [hashed];

  const fbclid = orden.utms?.fbclid;
  if (fbclid) {
    // subdomainIndex=1 fijo (D6 del plan): generación server-side sin cookie
    // _fbc propia, el checkout corre en el dominio de Whop. creationTime en
    // MILISEGUNDOS — distinto de event_time, que va en segundos unix.
    userData.fbc = `fb.1.${cobro.updated_at.getTime()}.${fbclid}`;
  }

  const evento: EventoCapiPurchase = {
    event_name: 'Purchase',
    // unix seconds, NO milisegundos (confundirlo manda un timestamp ~53 años
    // en el futuro y Meta rechaza el evento entero).
    event_time: Math.floor(cobro.updated_at.getTime() / 1000),
    event_id: cobro.whop_payment_id,
    action_source: 'website',
    event_source_url: `${baseUrl}/pagos/${pagina.slug}`,
    user_data: userData,
    custom_data: {
      // Monto DECIMAL, no centavos: Number(cobro.monto) directo. NO usar
      // centavos() de lib/salidas.ts acá (esa convención es solo del panel).
      value: Number(cobro.monto),
      currency: (cobro.moneda ?? producto.moneda).toLowerCase(),
    },
  };

  return { ok: true, evento };
}

// ─── hashEmail ───────────────────────────────────────────────────────────────

/**
 * Hashea un email para Meta CAPI: trim, lowercase, SHA256 hex.
 * Si el input es vacío o invalido, devuelve undefined.
 *
 * Calco de `testfunnel/lib/tracking.ts` `hashEmail`.
 */
export function hashEmail(email: string | undefined | null): string | undefined {
  if (!email) return undefined;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ─── getCapiTargets ──────────────────────────────────────────────────────────

/** Últimos 4 dígitos, para poder identificar el pixel en los logs sin volcarlo. */
function pixelTag(pixelId: string): string {
  return `...${pixelId.slice(-4)}`;
}

/**
 * Destinos de CAPI, leídos de las env vars.
 *
 * MULTI-PIXEL: `META_PIXEL_ID` y `META_CAPI_TOKEN` aceptan varios valores
 * separados por coma, emparejados por posición. Ver el comentario largo en
 * `testfunnel/lib/tracking.ts` (`getCapiTargets`) para el motivo completo
 * (migrar de pixel sin apostar todo a uno solo, diagnosticar por dataset).
 * Con un solo valor el comportamiento es el de siempre.
 */
function getCapiTargets(): CapiTarget[] {
  const split = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const pixelIds = split(process.env.META_PIXEL_ID);
  const tokens = split(process.env.META_CAPI_TOKEN);

  if (pixelIds.length !== tokens.length) {
    console.warn(
      `[capi] CAPI config: ${pixelIds.length} pixel(es) y ${tokens.length} token(s). ` +
        'Se emparejan por posición, así que los sobrantes se ignoran.',
    );
  }

  const n = Math.min(pixelIds.length, tokens.length);
  const targets: CapiTarget[] = [];
  for (let i = 0; i < n; i += 1) {
    targets.push({ pixelId: pixelIds[i], accessToken: tokens[i] });
  }
  return targets;
}

// ─── sendCapiEvent — efecto ──────────────────────────────────────────────────

/**
 * Envía un evento Purchase a Meta Conversions API.
 *
 * Calco de `testfunnel/lib/tracking.ts` `sendCapiEvent`: multi-pixel por
 * posición, log de `events_received`/`messages`/`fbtrace_id`, `Promise.all`
 * sobre los targets, `ok` si al menos uno aceptó.
 *
 * Sin `META_PIXEL_ID`/`META_CAPI_TOKEN` configurados: no-op silencioso,
 * `{ ok: false, reason: 'env_missing' }` — el cron sigue funcionando normal
 * para el resto de los pasos (panel, email).
 *
 * A diferencia de testfunnel, NO pasa `custom_data` por ningún allowlist:
 * este checkout no maneja datos de salud, así que `value`/`currency` van
 * directo al payload de Meta.
 */
export async function sendCapiEvent(
  evento: EventoCapiPurchase,
): Promise<{ ok: boolean; reason?: string; error?: string }> {
  const targets = getCapiTargets();

  if (targets.length === 0) {
    console.warn('[capi] CAPI skip: META_PIXEL_ID o META_CAPI_TOKEN no configurados');
    return { ok: false, reason: 'env_missing' };
  }

  const payload = {
    data: [
      {
        event_name: evento.event_name,
        event_time: evento.event_time,
        action_source: evento.action_source,
        event_source_url: evento.event_source_url,
        event_id: evento.event_id,
        user_data: evento.user_data,
        custom_data: evento.custom_data,
      },
    ],
  };

  const body = JSON.stringify(payload);

  /** Manda el evento a UN pixel. Nunca tira: devuelve el resultado. */
  const sendTo = async (target: CapiTarget): Promise<{ ok: boolean; error?: string }> => {
    const tag = pixelTag(target.pixelId);
    const url = `https://graph.facebook.com/${CAPI_VERSION}/${target.pixelId}/events?access_token=${encodeURIComponent(
      target.accessToken,
    )}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      // Siempre leemos el body: un 200 de Meta no garantiza que el evento haya
      // sido aceptado con buena calidad de matching. El body trae
      // `events_received`, `messages` (warnings de calidad) y `fbtrace_id`
      // (útil para buscar el evento en Events Manager / soporte de Meta).
      const text = await res.text().catch(() => '');

      if (!res.ok) {
        console.error(
          `[capi] CAPI error ${res.status} para ${evento.event_name} en pixel ${tag}: ${text}`,
        );
        return { ok: false, error: `${res.status}` };
      }

      let parsed: { events_received?: number; messages?: unknown[]; fbtrace_id?: string } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* body no-JSON, no debería pasar en un 2xx pero no rompemos por esto */
      }

      console.log(
        `[capi] CAPI ok para ${evento.event_name} en pixel ${tag} ` +
          `(event_id=${evento.event_id}): ` +
          `events_received=${parsed.events_received ?? 'n/a'} fbtrace_id=${parsed.fbtrace_id ?? 'n/a'}` +
          (parsed.messages?.length ? ` messages=${JSON.stringify(parsed.messages)}` : ''),
      );

      if ((parsed.events_received ?? 1) === 0) {
        // Meta aceptó el request (2xx) pero no contó el evento. Esto es lo
        // que se ve como "no me capturó la compra" sin que nada rompa en los
        // logs.
        console.warn(
          `[capi] CAPI devolvió events_received=0 para ${evento.event_name} en pixel ${tag}` +
            ' — revisar calidad de matching (em/fbc)',
        );
      }

      if (!evento.user_data.em && !evento.user_data.fbc) {
        // Regla 2 del contrato B: el evento se manda igual, pero sin ningún
        // identificador de user_data el matching es pobre. Se loguea acá
        // (efecto) para que quede rastro sin bloquear el armado (pura).
        console.warn(
          `[capi] evento ${evento.event_id} sin em ni fbc — matching pobre, revisar atribución`,
        );
      }

      return { ok: true };
    } catch (err) {
      console.error(`[capi] CAPI fetch failed para ${evento.event_name} en pixel ${tag}:`, err);
      return { ok: false, error: 'network' };
    }
  };

  // En paralelo: un pixel lento o caído no debe retrasar al otro.
  const results = await Promise.all(targets.map(sendTo));

  // `ok` si AL MENOS UNO aceptó: con dos pixeles configurados, que uno falle
  // no debe reportarse como si la venta no se hubiera trackeado en ninguno.
  const ok = results.some((r) => r.ok);
  if (ok) return { ok: true };
  return { ok: false, error: results[0]?.error ?? 'unknown' };
}
