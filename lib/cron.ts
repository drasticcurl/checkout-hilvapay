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
 */
export function cronAutorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET no está configurada: se rechaza todo');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
