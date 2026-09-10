# Cómo hacer un cambio en hilvapay y llevarlo a producción

Este documento es el paso a paso del día a día. Cómo levantarlo en local y la
configuración de Whop están en [`README.md`](README.md); el plan completo y las
decisiones de diseño en
[`tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md`](tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md).

- **Repo:** `checkout-kashhhpay` (privado)
- **En la VPS:** `/srv/hilvapay/`
- **Dominios:** `hilvapay.hilvanapp.com` (panel) y `pay.hilvanapp.com` (links de
  pago) → los dos a `127.0.0.1:3020`
- **PM2:** `hilvapay-3020` (un solo proceso, sin worker aparte)
- **Rama de producción:** `main`
- **Base:** PostgreSQL 16 en `127.0.0.1:5432`, base `hilvapay`

---

## El ciclo completo

### 1. Desarrollo local

```bash
npm install
./scripts/configurar-env.sh          # escribe .env.local y lo verifica contra Whop
npm run db:migrate                   # idempotente
npm run dev                          # http://localhost:3020
```

### 2. Antes de commitear

```bash
npm test                  # vitest --run
npm run build             # que compile de verdad, no solo que pasen los tests
```

Correr el build en local no es opcional. `deploy.sh` lo corre en la VPS y si
falla ahí, perdiste el viaje y dejaste una entrada de error en `deploy.log`.

### 3. Commit y push

```bash
git add <archivos>        # preferí archivos por nombre, no `git add .`
git commit -m "…"
git push origin main
```

### 4. Deploy

```bash
ssh funnel-vps
sudo -u deploy bash /srv/hilvapay/repo/deploy/deploy.sh
```

Si ya entraste como `deploy`, alcanza:

```bash
/srv/hilvapay/repo/deploy/deploy.sh
```

**Nunca como root.** PM2 es por usuario: como root, `pm2 reload`/`pm2 start`
crea un `hilvapay-3020` nuevo en el daemon de root en lugar de recargar el que
está sirviendo. El proceso viejo sigue con el código viejo y con el puerto
tomado, el nuevo cicla sin poder bindear, y el health check pasa porque
contesta el viejo. El deploy dice OK y no desplegó nada — con cobros reales
corriendo contra el código viejo. El script tiene un guard que aborta en ese
caso.

### 5. Verificar

```bash
tail -40 /srv/hilvapay/deploy.log
git -C /srv/hilvapay/repo log --oneline -1              # el commit que quedó sirviendo
curl -s -o /dev/null -w '%{http_code}\n' https://pay.hilvanapp.com/       # 200
curl -s -o /dev/null -w '%{http_code}\n' https://hilvapay.hilvanapp.com/  # 200 (mismo backend, otro host)
pm2 status                                              # hilvapay-3020 online
tail -5 /var/log/hilvapay/salidas.log                   # el cron drenando la cola
```

---

## Probar una rama antes de mergear

```bash
sudo -u deploy DEPLOY_BRANCH=mi-rama bash /srv/hilvapay/repo/deploy/deploy.sh
```

Cuando termines, volvé a `main` con un deploy normal. Ojo: mientras esa rama
esté desplegada, un deploy sin `DEPLOY_BRANCH` la reemplaza por `main`.

---

## Qué hace `deploy.sh`, en orden

Vale conocerlo porque el orden es lo que da las garantías:

1. **Guards**: que no sea root, que exista `/srv/hilvapay`, que exista
   `shared/.env.production`.
2. **`flock`**: un solo deploy a la vez.
3. **Código desde git**: `fetch --all --prune` + `reset --hard origin/main`.
   El fetch va *después* del flock a propósito: dos deploys simultáneos sobre
   el mismo working tree dejarían la release entre dos commits.
4. **Copia a `releases/<timestamp>/`** con rsync, excluyendo `node_modules`,
   `.next`, `.git`, `tasks`, `.env*` y basura de Finder.
5. **Secretos**: instala `shared/.env.production` en la release con `chmod 600`.
6. **Guard de env vars.** Aborta antes del build si falta o está vacía
   cualquiera de estas diez:

   ```
   DATABASE_URL   WHOP_API_KEY   WHOP_COMPANY_ID   WHOP_API_BASE
   WHOP_API_VERSION_DATE   PANEL_PASSWORD   PANEL_HOST   PAGOS_HOST
   NEXT_PUBLIC_BASE_URL   CRON_SECRET
   ```

   `WHOP_WEBHOOK_SECRET`, `PANEL_INGEST_URL`, `PANEL_INGEST_KEY`,
   `RESEND_API_KEY` y `PANEL_SESSION_SECRET` **no** están en la lista a
   propósito: el servicio anda sin ellas (el webhook rechaza con 400 en vez de
   procesar sin firma, no se reporta al panel externo, no se manda el email de
   entrega, o cae a `PANEL_PASSWORD` respectivamente).
7. **`npm ci` + `npm run build`.** Migra `hilvapay_test` y corre `npm test`:
   los 140 tests son unitarios y no tocan la base, pero la migración sí se
   prueba ahí — si rompe, el deploy se cae **antes** de tocar producción.
8. **Completa el standalone**: `next build` no copia `.next/static/` dentro de
   `.next/standalone/`. Además copia `scripts/` y `lib/`, y linkea el
   `node_modules` completo de la release, porque `npm run db:seed` (operación
   manual) corre con `tsx` desde `current`.
9. **Migra la base** (`db:migrate`, invocado con `tsx --env-file=.env.production`
   porque el script de npm trae `--env-file=.env.local` pegado, que no existe
   en la VPS). Si la migración falla, `current` sigue en la release anterior y
   el checkout sigue sirviendo con el schema que conoce.
10. **Swap atómico** de `current` con `mv -Tf`.
11. **`pm2 reload hilvapay-3020`** + health check en `/` (espera 200 —no 307
    ni 404, ver la nota en `deploy.sh`— hasta 20 intentos cada 2 s). Si no
    responde, vuelve solo a la release anterior.
12. **Poda**: deja las 5 releases más nuevas, salteando la que está sirviendo.

---

## Cambios que necesitan una migración

Las migraciones viven en `db/migrations/` y las corre `npm run db:migrate`
(idempotente: corrida dos veces no toca nada).

El deploy migra **antes** de activar la release nueva, así que durante unos
segundos el código viejo corre contra el schema nuevo. **Escribí migraciones
compatibles hacia atrás**: agregar columnas nullable o con default, sí; borrar
o renombrar una columna que el código viejo todavía lee, no. Si necesitás
borrar algo, hacelo en dos deploys: primero el código que deja de usarla,
después la migración que la elimina.

Esto también es lo que hace que un rollback sea parcial: volver el código atrás
no deshace la migración.

---

## Rollback

Este servicio no tiene `rollback.sh`. Tiene el rollback automático de
`deploy.sh` (si el health check falla), pero para "el deploy salió bien y la
release está mal" es a mano:

```bash
ssh funnel-vps

# 1. Ver qué releases hay y cuál está activa
ls -1t /srv/hilvapay/releases/
readlink -f /srv/hilvapay/current

# 2. Elegir una que tenga el build hecho
ls /srv/hilvapay/releases/<stamp>/.next/standalone/server.js

# 3. Swap atómico (mv -T, no ln -sfn sobre current: eso deja una ventana sin symlink)
ln -sfn /srv/hilvapay/releases/<stamp>/.next/standalone /srv/hilvapay/current.tmp
mv -Tf /srv/hilvapay/current.tmp /srv/hilvapay/current

# 4. Recargar
pm2 reload hilvapay-3020 --update-env

# 5. Verificar
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/
```

No corras `pm2 save` hasta confirmar que quedó sano: si guardás un estado roto,
vuelve igual en el próximo reboot.

Y de nuevo: **esto no deshace las migraciones.**

---

## El cron

Uno solo, cada minuto: drena la cola `salidas` (`GET /api/cron/salidas`, ver
`app/api/cron/salidas/route.ts`). La línea está en `deploy/cron.hilvapay` y se
instala así:

```bash
ssh funnel-vps
sudo -u deploy crontab -u deploy -
# pegar el contenido de deploy/cron.hilvapay, Ctrl-D para terminar
sudo -u deploy crontab -u deploy -l   # confirmar que quedó
```

El log queda en `/var/log/hilvapay/salidas.log` con la respuesta JSON completa
(`{tomadas, enviadas, fallidas, omitidas}`) de cada corrida — no solo el código
HTTP, para poder ver de un vistazo si la cola se está acumulando en
`fallidas`. Por qué el cron usa `curl` en vez de `tsx`, y cómo evita dejar
`CRON_SECRET` en texto plano en el crontab, está comentado en el propio
`deploy/cron.hilvapay`.

---

## Antes de encender un link de pago

Todo nace apagado a propósito (ver `README.md`):

```sql
select count(*) from paginas  where activo;   -- 0 hasta que lo prendas en el panel
select count(*) from origenes where activo;   -- 0: sin esto el botón del funnel da 403
```

El freno de emergencia es apagar `paginas.activo` desde el panel: corta el
cobro al instante, sin redeploy.

---

## Lo que nunca va al repo

- **`.env` / `.env.local` / `.env.production`** — los secretos viven solo en
  `/srv/hilvapay/shared/.env.production` con `chmod 600`.

El único archivo de entorno que sí va es `.env.example`, con placeholders.

---

## Cosas que ya pasaron en `dashboard-admin` y no hay que repetir acá

- **Correr `deploy.sh` como root.** Costó una caída del panel el 2026-08-13.
  El guard de este `deploy.sh` es el mismo, textual.
- **Deployar por rsync sin git.** En el server no habría forma de saber qué
  versión está corriendo. El modo `DEPLOY_SOURCE=local` existe solo para un
  bring-up o si GitHub está caído — no es el modo de régimen.
