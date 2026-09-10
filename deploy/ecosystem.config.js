/**
 * PM2 — un proceso Node, UNA sola instancia.
 *
 * Instalar/actualizar:
 *   pm2 start /srv/hilvapay/repo/deploy/ecosystem.config.js
 *   pm2 save                 # persiste la lista para el reboot
 *   pm2 startup              # (una vez) genera el unit de systemd
 *
 * Una sola instancia y no dos: no hay ningún estado in-memory que se rompa con
 * más de una (a diferencia del panel, donde el rate limit del login vive en
 * memoria), pero tampoco hace falta balanceo — el volumen de este checkout no
 * lo justifica y dos instancias competirían por el mismo puerto en cluster sin
 * ninguna ganancia real.
 *
 * Por qué `exec_mode: 'fork'` y no cluster: en cluster las instancias
 * comparten el MISMO puerto, y acá hay un solo proceso a propósito.
 *
 * Sin proceso de worker aparte (a diferencia de panel-reglas en
 * dashboard-admin): este servicio no tiene motor de background. Lo único
 * periódico es drenar la cola `salidas`, y eso lo hace el cron pegándole por
 * HTTP a este mismo proceso (ver deploy/cron.hilvapay) — no un segundo proceso
 * PM2 con tsx.
 *
 * `HOSTNAME: '127.0.0.1'` es obligatorio: el server.js del build standalone
 * bindea 0.0.0.0 por default. Sin esto el checkout queda escuchando en todas
 * las interfaces y accesible salteando a Caddy — y este servicio cobra
 * tarjetas: que eso pase sería exponer el cobro sin el `X-Forwarded-Host` que
 * el middleware necesita para separar el panel de los links de pago, y sin
 * las cabeceras de seguridad que pone Caddy.
 */

module.exports = {
  apps: [
    {
      name: 'hilvapay-3020',
      script: 'server.js',
      cwd: '/srv/hilvapay/current',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '3020',
        HOSTNAME: '127.0.0.1',
      },
      max_memory_restart: '600M',
      autorestart: true,
      // Las env vars de la app NO van acá: las lee Next desde el .env.production
      // que deploy.sh copia dentro de .next/standalone/.
      out_file: '/var/log/pm2/hilvapay-3020.out.log',
      error_file: '/var/log/pm2/hilvapay-3020.err.log',
      time: true,
    },
  ],
};
