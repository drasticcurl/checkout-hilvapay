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
| `cron.hilvapay` | los **tres** crons (salidas, reconciliar, vigilar) | se instala con `crontab -u deploy -` |
| `drenar-salidas.sh` | el curl del cron de la cola `salidas` | lo llama el crontab cada minuto |
| `pegar-cron.sh` | el curl genérico de los otros dos crons | lo llama el crontab cada 10 y 15 min |

## Por qué está armado así

- **Dos dominios, un solo puerto (3020).** `hilvapay.hilvanapp.com` (panel) y
  `pay.hilvanapp.com` (links de pago) proxean al mismo backend. La separación
  la hace `middleware.ts` mirando `x-forwarded-host`, así que **los dos
  bloques del Caddyfile tienen que mandar `header_up X-Forwarded-Host`** con
  el dominio correspondiente — sin esto el middleware no puede distinguirlos
  y todo cae al mismo lado, devolviendo 404 en el otro dominio.

- **Sin worker aparte.** A diferencia de `dashboard-admin` (que tiene
  `panel-reglas` corriendo con tsx en un segundo proceso PM2), este servicio
  no tiene motor de background. Lo periódico son tres crons que le pegan por
  HTTP al propio proceso de Next — no un segundo proceso PM2.

- **El cron usa `curl`, no `tsx`.** No existe un script de tsx que drene la
  cola directamente contra `lib/salidas.ts`: la única puerta de entrada es la
  ruta `app/api/cron/salidas`. Escribir un script nuevo duplicaría esa lógica
  fuera de la app. El detalle completo, incluida la forma de no dejar
  `CRON_SECRET` en texto plano en el crontab, está comentado en
  `cron.hilvapay`.

- **Dos scripts de curl y no uno.** `drenar-salidas.sh` ya estaba instalado y
  funcionando cuando aparecieron los otros dos crons, así que no se tocó;
  `pegar-cron.sh` es la versión genérica que toma la ruta como argumento (con
  allowlist) y sirve para los tres. Unificar es cambiar una línea del crontab
  y borrar el viejo, cuando se quiera.

- **El health check pega a `/api/health`, no a `/`.** Antes iba a `/`, que
  sirve una página estática: devolvía 200 con Postgres caído, con las
  migraciones sin correr y con la `WHOP_API_KEY` vacía. O sea, el rollback
  automático verificaba que Node hubiera arrancado y nada más. Ahora se chequea
  `select 1`, la lista de migraciones esperadas y las env vars críticas, y el
  deploy loguea el diagnóstico completo antes de revertir.

  Lo que ese endpoint **no** hace es llamar a la API de Whop: un health check
  que depende de un tercero convierte una caída de Whop en un rollback nuestro
  que no arregla nada.

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
