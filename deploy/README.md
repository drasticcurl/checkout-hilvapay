# deploy/

Los archivos de esta carpeta viajan con el repo pero solo se usan en la VPS.
El ciclo completo (desarrollo → commit → deploy → verificación) está en
[`../COMO-DEPLOYAR.md`](../COMO-DEPLOYAR.md). Esto es la referencia rápida de
qué es cada archivo.

| Archivo | Qué es | Dónde vive en la VPS |
|---|---|---|
| `deploy.sh` | build + activación de una release nueva | `/srv/hilvapay/repo/deploy/deploy.sh` (se corre desde ahí) |
| `Caddyfile.hilvapay` | los dos bloques de sitio (panel + pagos) | se pegan a mano en `/etc/caddy/Caddyfile` |
| `ecosystem.config.js` | definición del proceso PM2 | `pm2 start` lo apunta a `/srv/hilvapay/repo/deploy/ecosystem.config.js` |
| `cron.hilvapay` | la línea de cron que drena la cola `salidas` | se instala con `crontab -u deploy -` |

## Por qué está armado así

- **Dos dominios, un solo puerto (3020).** `hilvapay.hilvanapp.com` (panel) y
  `pay.hilvanapp.com` (links de pago) proxean al mismo backend. La separación
  la hace `middleware.ts` mirando `x-forwarded-host`, así que **los dos
  bloques del Caddyfile tienen que mandar `header_up X-Forwarded-Host`** con
  el dominio correspondiente — sin esto el middleware no puede distinguirlos
  y todo cae al mismo lado, devolviendo 404 en el otro dominio.

- **Sin worker aparte.** A diferencia de `dashboard-admin` (que tiene
  `panel-reglas` corriendo con tsx en un segundo proceso PM2), este servicio
  no tiene motor de background. Lo único periódico es drenar la cola
  `salidas`, y eso lo hace el cron pegándole por HTTP al propio proceso de
  Next — no un segundo proceso PM2.

- **El cron usa `curl`, no `tsx`.** No existe un script de tsx que drene la
  cola directamente contra `lib/salidas.ts`: la única puerta de entrada es la
  ruta `app/api/cron/salidas`. Escribir un script nuevo duplicaría esa lógica
  fuera de la app. El detalle completo, incluida la forma de no dejar
  `CRON_SECRET` en texto plano en el crontab, está comentado en
  `cron.hilvapay`.

- **El guard de root, `HOSTNAME: '127.0.0.1'` y el health check con rollback**
  son el mismo patrón que `dashboard-admin/deploy/deploy.sh`, con el motivo de
  cada uno explicado en el propio script. No se simplificaron: cada uno evita
  un incidente que ya pasó en el panel y que en este servicio —que cobra
  tarjetas— saldría igual de caro o peor.

## Qué NO hay acá

- **`rollback.sh` manual.** Como el panel, este servicio no tiene uno propio:
  el rollback automático de `deploy.sh` (si el health check falla) cubre el
  caso común. Para "el deploy salió bien pero la release está mal", el
  procedimiento manual está en `COMO-DEPLOYAR.md`.
- **Seed de usuarios/admin.** El panel de `dashboard-admin` tiene un módulo de
  usuarios con seed en cada deploy. Este servicio no lo tiene: el panel usa
  una sola contraseña compartida (`PANEL_PASSWORD`), no hay tabla de usuarios
  que sembrar.
