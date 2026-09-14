/**
 * Aplana las UTMs de una orden para meterlas en `metadata` de Whop (T05,
 * plan panel-y-capi §1 D10).
 *
 * Whop acepta `Record<string, unknown>` sin schema fijo para `metadata`
 * (confirmado en la doc oficial de Checkout Configurations, research previo
 * del plan) — no hace falta stringify ni anidar, un objeto plano de strings
 * alcanza.
 *
 * A diferencia de `extraerUtmsLimpias` (lib/salidas.ts, T03), que excluye
 * `fbclid` porque ese campo no es una UTM para el contrato de `/api/ingest`,
 * ACÁ sí tiene sentido que `fbclid` viaje: es redundancia informativa para
 * quien mire el objeto Payment de Whop directamente (soporte, debugging), y
 * no hay ningún contrato de destino que lo excluya.
 *
 * Trunca cada valor a 500 caracteres como precaución (no hay documentación
 * pública de límites de tamaño de `metadata` en Whop — 500 es el límite que
 * usa Stripe para un campo análogo, por analogía, no un valor confirmado por
 * Whop). Constante fácil de ajustar si en algún momento Whop documenta su
 * propio límite (P-06 nueva, ver 00-PLAN-PANEL-Y-CAPI.md §10).
 */

/** Límite de largo por valor, precaución sin confirmar contra Whop (ver comentario arriba). */
const LARGO_MAXIMO_VALOR = 500;

export function utmsParaMetadataWhop(
  utms: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!utms) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(utms)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    out[key] = value.length > LARGO_MAXIMO_VALOR ? value.slice(0, LARGO_MAXIMO_VALOR) : value;
  }
  return out;
}
