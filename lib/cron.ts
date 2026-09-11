/**
 * El guard de los endpoints de cron.
 *
 * Los tres (`/api/cron/salidas`, `/api/cron/reconciliar`, `/api/cron/vigilar`)
 * son rutas HTTP sin sesión: las llama el crontab de la VPS contra
 * `127.0.0.1:3020`, sin pasar por Caddy. `middleware.ts` las deja pasar a
 * propósito (`CUALQUIER_HOST`), así que la única autenticación que tienen es
 * esta.
 *
 * Vive en su propio archivo para que la regla se escriba UNA vez: tres copias del
 * mismo `if` es cómo una termina, seis meses después, con un `|| true` que alguien
 * puso para probar algo en local.
 */

/**
 * `true` si el request trae el `CRON_SECRET` correcto.
 *
 * **Sin `CRON_SECRET` configurado devuelve `false`, nunca `true`.** Un cron que
 * nadie puede disparar todavía es mucho mejor que uno que cualquiera puede
 * disparar: estos endpoints cobran, mandan emails y escriben en Telegram.
 *
 * La comparación es en tiempo constante y no con `===`. Acá el riesgo práctico es
 * bajo —los crons pegan a `127.0.0.1`, así que medir microsegundos exige ya estar
 * dentro de la máquina— pero era la única de las tres comparaciones de secretos
 * del repo que no lo hacía (`lib/auth.ts` usa `igualConstante`,
 * `lib/whop-webhook.ts` usa `timingSafeEqual`), y esa inconsistencia es la que
 * hace que la próxima copia se escriba mal. Detectado en la auditoría del
 * 2026-09-11.
 */
export function cronAutorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET no está configurada: se rechaza todo');
    return false;
  }
  return igualConstante(req.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/**
 * Comparación de strings en tiempo constante.
 *
 * Es la misma implementación que `lib/auth.ts` y está duplicada a propósito: ese
 * módulo lo importa `middleware.ts`, que corre en el runtime **edge**, y este
 * corre en Node. Importar `lib/auth.ts` desde acá arrastraría todo su árbol
 * (incluida la lectura de cookies de Next) a tres route handlers que no lo
 * necesitan. Son doce líneas sin dependencias; el acoplamiento cuesta más.
 *
 * Compara SIEMPRE los dos strings completos y acumula las diferencias con XOR, en
 * vez de cortar en el primer byte distinto. El largo sí se filtra por timing —eso
 * es inevitable sin hashear primero— y no importa: el largo del prefijo `Bearer `
 * más un secreto es público.
 */
function igualConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
