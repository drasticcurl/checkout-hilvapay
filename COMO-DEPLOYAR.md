# Cómo deployar hilvapay

Documento **autocontenido**: entrar a la VPS, entender Cloudflare, deployar,
verificar y volver atrás sin abrir ningún otro repo. Verificado contra la
máquina el **2026-09-13** (ver §12 para qué se chequeó exactamente).

| | |
|---|---|
| **Repo** | `github.com/drasticcurl/checkout-hilvapay` (privado) |
| **Carpeta local** | `checkout/checkout-kashhhpay` — el nombre no coincide con el del repo |
| **Rama de producción** | `main` |
| **En la VPS** | `/srv/hilvapay/` |
| **Dominios** | `hilvapay.hilvanapp.com` (panel) y `pay.hilvanapp.com` (links de pago), los dos a `127.0.0.1:3020` |
| **Zona de Cloudflare** | `hilvanapp.com` |
| **PM2** | `hilvapay-3020` (un solo proceso, sin worker aparte) |
| **Base** | PostgreSQL 16.15 en `127.0.0.1:5432`, base `hilvapay` (+ `hilvapay_test`) |
| **Crons** | **tres** (§8) |

> ⚠️ **Esto cobra tarjetas.** Un deploy que sale "OK" pero deja el proceso
> viejo sirviendo es plata real corriendo contra código viejo. Los guards de
> `deploy.sh` (root, health check con rollback, `HOSTNAME: '127.0.0.1'`) están
> copiados textuales del panel, cada uno por un incidente que ya pasó allá.
> No se simplifican.

**Dos dominios, un solo proceso.** La separación la hace `middleware.ts` mirando
`x-forwarded-host`, así que **los dos bloques de Caddy tienen que mandar
`header_up Host` y `header_up X-Forwarded-Host`** con el dominio
correspondiente. Sin eso, `hostDe()` no puede distinguirlos y todo cae al mismo
lado, devolviendo 404 en el otro dominio.

Verificación de que la separación funciona:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://pay.hilvanapp.com/admin   # 404, NO 307
```

Ese **404** es la comprobación que importa: significa que el dominio que va en
anuncios no expone ni la pantalla de login del panel.

---

## 1 · Entrar a la VPS

Un solo servidor Ubuntu 24.04.4 (4 cores, 8 GB RAM, 96 GB de disco) con dos
usuarios y **sin login por password**: solo clave SSH.

```bash
ssh funnel-vps        # usuario deploy → deploys, PM2, logs de la app, crons
ssh funnel-vps-root   # usuario root   → Caddy, ufw, certificados, psql
```

| Usuario | Para qué | Puede |
|---|---|---|
| `deploy` | correr los deploys, el proceso y los crons | dueño de `/srv/*` y del daemon de PM2. **No tiene sudo** |
| `root` | infraestructura | Caddy, ufw, certs, `sudo -u postgres psql`, leer `/var/log/caddy/` |

### Si los alias no existen (máquina nueva)

```bash
cat >> ~/.ssh/config <<'EOF'

Host funnel-vps
	HostName <IP-DEL-ORIGEN>
	User deploy
	IdentityFile ~/.ssh/id_ed25519
	IdentitiesOnly yes
	ServerAliveInterval 30

Host funnel-vps-root
	HostName <IP-DEL-ORIGEN>
	User root
	IdentityFile ~/.ssh/id_ed25519
	IdentitiesOnly yes
	ServerAliveInterval 30
EOF
```

Tres formas de obtener la IP del origen: el `~/.ssh/config` de una máquina que
ya entra; Cloudflare → zona `hilvanapp.com` → DNS → el registro A de `hilvapay`
(columna *Content*); o desde la VPS,
`grep ORIGIN_IP /srv/hilvapay/shared/deploy.env`.

**Es la IP detrás de Cloudflare**, así que publicarla permite saltear la
protección de DDoS pegándole directo al origen. `HANDOFF-DNS.md` de este repo la
tiene escrita en texto plano — conviene borrarla de ahí.

Y hay que **cargar tu clave pública** en `~/.ssh/authorized_keys` del usuario
(desde una sesión que ya tenga acceso). Sin clave no entrás.

### Lo primero al entrar

```bash
bash /srv/estado.sh      # mapa EN VIVO de los stacks, con release y HTTP local
cat /srv/PROYECTOS.md    # el porqué de los dos stacks y sus trampas
```

Ninguno de los dos incluye a hilvapay todavía: `estado.sh` lista los stacks
hilvanapp e infinix, y `PROYECTOS.md` es del 2026-08-30 (anterior a este
servicio) y dice que el próximo puerto libre es el 3010 — hoy están tomados
hasta el 3013, más el 3020 de este servicio y el 3050 del POC. Cuando un
documento y la máquina no coinciden, **la máquina tiene razón**:

```bash
pm2 status
ss -tlnp | grep -E '30[0-9][0-9]'
```

### Qué más vive en esta máquina

Verificado el 2026-09-13 con `pm2 status` y `/etc/caddy/Caddyfile`:

| Servicio | Dominio(s) | Puertos | PM2 | `/srv/` |
|---|---|---|---|---|
| Funnel Chau Hinchazón | `chauhinchazon.hilvanapp.com`, `ritual.hilvanapp.org` | 3001/3002 | `chauhinchazon-3001/3002` | `chauhinchazon` |
| Funnel Protocolo Reset+ | `reset.hilvanapp2.org` (+ `preview-reset`) | 3003/3004 | `reset-3003/3004` | `reset` |
| Panel de tracking | `panel.hilvanapp.com` | 3005 | `panel-3005` + `panel-reglas` | `panel` |
| Generador de videos | `generador.hilvanapp.online` | 3006 | `generador-3006` | `generador` |
| Panel de infinix | `panel.infinixapp.com` | 3007 | `panel-infinix-3007` | `panel-infinix` |
| Funnel gatos | `gatos.infinixapp.com` | 3008/3009 | `gatos-3008/3009` | `gatos` |
| Funnel Gelatina Fit | `gelatina.hilvanapp.online` | 3010/3011 | `gelatina-3010/3011` | `gelatina` |
| Landing arroz | `landing.hilvanapp2.org` | 3012/3013 | `landing-3012/3013` | `landing` |
| **hilvapay (este repo)** | **`hilvapay.hilvanapp.com`, `pay.hilvanapp.com`** | **3020** | **`hilvapay-3020`** | **`hilvapay`** |
| POC one-click Whop | `paytest.hilvanapp.com` | 3050 | `whop-oneclick-poc-3050` | `whop-oneclick-poc` |

El **3020 se eligió con un hueco de por medio** (3014–3019 libres) para que los
funnels puedan seguir creciendo de a pares sin acercarse. El POC de one-click
está en el 3050 por lo mismo.

### Topología de un request

```
visitante
   ↓
Cloudflare       proxy naranja: TLS público, WAF, cache, geo-block
   ↓             ufw solo deja pasar 80/443 desde los rangos de Cloudflare
Caddy :443       DOS bloques de sitio, mismo backend. Inyecta X-Forwarded-Host
   ↓
Node 127.0.0.1:3020      un solo proceso, PM2 fork, Next standalone
   ↓
PostgreSQL 127.0.0.1:5432, base `hilvapay`        +   API de Whop (salida HTTPS)
```

Postgres escucha en `localhost` únicamente, y ufw abre el 22 a todos y el
80/443 solo a los 15 rangos IPv4 y 4 IPv6 de Cloudflare. Nada escucha en una
interfaz pública salvo Caddy.

**No hay Docker en la VPS.** Postgres es el paquete de Ubuntu.

---

## 2 · Cloudflare

Las cinco zonas de la cuenta y su modo SSL:

| Zona | SSL | Hosts que apuntan a esta VPS |
|---|---|---|
| **`hilvanapp.com`** | **Full (strict)** | **`hilvapay`, `pay`**, `panel`, `chauhinchazon`, `paytest` |
| `hilvanapp.online` | Full | `gelatina`, `generador` |
| `hilvanapp.org` | Full | `ritual`, `landing`, `reset` (301) |
| `hilvanapp2.org` | Full | `reset`, `preview-reset`, `landing` |
| `infinixapp.com` | Full | `gatos`, `panel.infinixapp.com` |

Este servicio está en la única zona en **Full (strict)**, y puede estarlo porque
su certificado de origen sí corresponde: `/etc/caddy/certs/hilvapay.pem` y
`.key` son **symlinks a `panel.pem`/`panel.key`**, que es un Origin CA de
Cloudflare con SAN `*.hilvanapp.com` + `hilvanapp.com`. No hubo que emitir nada
nuevo para estos dos hosts.

> Si algún doc viejo dice que la zona **no** puede pasar a Full (strict): eso
> aplica a `infinixapp.com` (certs self-signed) y, por otro motivo, a
> `hilvanapp.online`, `hilvanapp.org` y `hilvanapp2.org` — **todos** los certs de
> la máquina son ese mismo `*.hilvanapp.com`, así que los hosts de esas zonas
> andan solo porque están en Full (no strict), donde Cloudflare cifra pero no
> valida el nombre. `hilvanapp.com` es la excepción y hoy está en strict, sin
> problemas.

### Las reglas de la zona, y las dos que te afectan de verdad

Son **por zona y matchean por path, no por hostname**: las mismas reglas se
aplican a este servicio y a los funnels de `hilvanapp.com`.

**WAF (Custom rules)**, transcriptas de la API:

```
1. Eximir /api/ de chequeos de seguridad (webhooks firmados por HMAC/hottok)
   when: starts_with(path,"/api/")
   do:   Skip → bic, hot, securityLevel, uaBlock, zoneLockdown, rateLimit, waf

2. Bloquear Brasil excepto /api/
   when: ip.geoip.country eq "BR" and not starts_with(path,"/api/")
   do:   Block
```

**La regla 1 ya cubre el webhook de Whop.** `HANDOFF-DNS.md` pedía crear una
excepción para `pay.hilvanapp.com/api/webhooks/whop`: **no hace falta**, esa
regla existía desde antes y aplica a toda la zona. Verificado en vivo: `POST` al
webhook con body vacío devuelve **400** (firma inválida, o sea que llegó a la
app), no 403 ni un HTML de desafío.

Que eso quede así no es un detalle: **Whop deshabilita un endpoint que falla 72
horas seguidas, y los eventos de ese período no se reenvían nunca.** Si alguien
borra la regla 1, el webhook empieza a comerse 403 del Browser Integrity Check y
se pierden pagos en silencio. El endpoint se autentica con firma HMAC de
Standard Webhooks: no necesita la protección del edge para ser seguro.

**⚠️ La regla 2 bloquea las páginas de pago en Brasil.** `/pagos/<slug>` es HTML,
no `/api/`, así que un comprador con IP de Brasil recibe un block de Cloudflare
en lugar del checkout. Si alguna vez se vende a Brasil desde este checkout, hay
que sumarle una excepción a esa regla (por ejemplo
`and not http.host eq "pay.hilvanapp.com"`).

**Cache Rules**: la regla 1 hace bypass en `/api/*`, `/admin*` y `/pwa/*`. La
regla 3 cachea paths del embudo (`/quiz`, `/oferta`, …) que acá no existen. El
resto queda con los ajustes de zona: `cache_level=aggressive` y
`browser_cache_ttl=14400`.

### ⚠️ `loader.js` se cachea 4 horas y el deploy NO purga

`next.config.mjs` le pone `Cache-Control: public, max-age=300` a `/loader.js`,
pero **el `browser_cache_ttl` de la zona lo sobreescribe a 14400** (4 h), y el
edge lo cachea por extensión. Verificado en vivo:

```
$ curl -sI https://pay.hilvanapp.com/loader.js
cache-control: public, max-age=14400
cf-cache-status: EXPIRED
```

Y **`deploy.sh` de este servicio no llama a la API de Cloudflare** (los funnels
sí lo hacen; acá no hay ninguna purga, aunque `deploy.env` tenga `CF_ZONE_ID` y
`CF_API_TOKEN` cargados).

`loader.js` es el script que embeben **todos** los funnels en cada página de
upsell: es la integración del botón de cobro. Si lo cambiás, el cambio puede
tardar hasta 4 h en llegar. **Después de un deploy que toque `loader.js`,
purgá a mano:**

```bash
ssh funnel-vps
source /srv/hilvapay/shared/deploy.env
curl -sX POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H 'content-type: application/json' \
  --data '{"files":["https://pay.hilvanapp.com/loader.js"]}'
```

Eso vacía el edge. Los browsers que ya lo bajaron siguen con su copia hasta que
expire el `max-age`, así que para un cambio incompatible conviene versionar la
URL (`/loader.js?v=2`) en vez de confiar en la purga.

`/pagos/*` y el panel **no** se cachean nunca: los cubren el `no-store` de Caddy
y el de `next.config.mjs`. `/media/*` sí se cachea a propósito (los nombres
incluyen el hash del contenido, así que son inmutables), y por eso el bloque de
`pay.hilvanapp.com` tiene **dos** `header`: un `no-store` global le sacaría el
cache a lo único que conviene cachear.

### DNS

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `hilvapay` | la IP del origen | Proxied (naranja) |
| A | `pay` | la IP del origen | Proxied (naranja) |

Sin el naranja no hay WAF, no llega `cf-connecting-ip` **y ufw rechaza el
tráfico**, porque solo deja entrar a los rangos de Cloudflare. Un registro en
gris = checkout caído.

---

## 3 · El ciclo completo

### 3.1 Local

```bash
npm install
./scripts/configurar-env.sh          # escribe .env.local y lo verifica contra Whop
npm run db:migrate                   # idempotente
npm run dev                          # http://localhost:3020
```

`npm run whop:verificar` corre solo la verificación de credenciales, sin
reescribir el env.

### 3.2 Antes de commitear

```bash
npm test                  # vitest --run
npm run build             # que compile de verdad, no solo que pasen los tests
```

Correr el build en local no es opcional. `deploy.sh` lo corre en la VPS y si
falla ahí, perdiste el viaje y dejaste una entrada de error en `deploy.log`.

### 3.3 Commit y push

```bash
git add <archivos>        # por nombre, no `git add .`
git commit -m "…"
git push origin main
```

La VPS deploya `main`. Si estás trabajando en una rama (hoy el repo local está
en `feature/checkout-sin-configuration`), mergeala antes o usá `DEPLOY_BRANCH`.

### 3.4 Deploy

```bash
ssh funnel-vps
/srv/hilvapay/repo/deploy/deploy.sh
```

Si entraste como otro usuario con sudo:
`sudo -u deploy bash /srv/hilvapay/repo/deploy/deploy.sh`.

**Nunca como root.** PM2 es por usuario: como root, `pm2 reload`/`pm2 start`
crea un `hilvapay-3020` nuevo en el daemon de root en lugar de recargar el que
está sirviendo. El proceso viejo sigue con el código viejo y con el puerto
tomado, el nuevo cicla sin poder bindear, y el health check pasa porque contesta
el viejo. El deploy dice OK y no desplegó nada — con cobros reales corriendo
contra el código viejo. El script tiene un guard que aborta en ese caso.

Para probar una rama sin mergear:

```bash
DEPLOY_BRANCH=mi-rama /srv/hilvapay/repo/deploy/deploy.sh
```

Cuando termines, volvé a `main` con un deploy normal. Mientras esa rama esté
desplegada, un deploy sin `DEPLOY_BRANCH` la reemplaza por `main`.

---

## 4 · Verificar

```bash
tail -40 /srv/hilvapay/deploy.log
git -C /srv/hilvapay/repo log --oneline -1     # el commit que quedó sirviendo
readlink -f /srv/hilvapay/current              # la release activa
pm2 status                                     # hilvapay-3020 online
```

Desde cualquier máquina — estos son los códigos verificados el 2026-09-13:

```bash
c() { printf '%-52s %s\n' "$1" "$(curl -s -o /dev/null -w '%{http_code}' "$1")"; }

# el panel
c https://hilvapay.hilvanapp.com/               # 307 → /admin
c https://hilvapay.hilvanapp.com/admin          # 307 → /admin/login (sin sesión)
c https://hilvapay.hilvanapp.com/admin/login    # 200
c https://hilvapay.hilvanapp.com/api/health     # 200

# los links de pago
c https://pay.hilvanapp.com/loader.js           # 200
c https://pay.hilvanapp.com/pagos/no-existe     # 404
c https://pay.hilvanapp.com/api/health          # 200

# LA SEPARACIÓN DE DOMINIOS: el panel NO se sirve en el dominio de pago
c https://pay.hilvanapp.com/admin               # 404, NO 307

# el webhook acepta POST (405 en GET es lo correcto)
c https://pay.hilvanapp.com/api/webhooks/whop   # 405
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
  -d '{}' https://pay.hilvanapp.com/api/webhooks/whop     # 400 (firma inválida)
```

**`https://hilvapay.hilvanapp.com/` da 307, no 200.** Si un doc viejo dice 200,
está desactualizado: la raíz del panel redirige a `/admin`. El health check del
deploy no usa `/` sino `/api/health` (§5), justamente para no depender de eso.

Si el `POST` al webhook devuelve **403** o un HTML de desafío en lugar de 400, es
Cloudflare interceptándolo: revisá la regla 1 del WAF (§2).

```bash
# los tres crons drenando
tail -3 /var/log/hilvapay/salidas.log
tail -3 /var/log/hilvapay/reconciliar.log
tail -3 /var/log/hilvapay/vigilar.log
```

### Logs

```bash
# app (como deploy)
tail -f /var/log/pm2/hilvapay-3020.out.log
tail -f /var/log/pm2/hilvapay-3020.err.log

# accesos (como root: el log es del usuario caddy). Uno por hostname
ssh funnel-vps-root 'tail -f /var/log/caddy/hilvapay.log'
ssh funnel-vps-root 'tail -f /var/log/caddy/pay.log'
```

---

## 5 · Qué hace `deploy.sh`, en orden

El orden es lo que da las garantías.

1. **Guards**: que no sea root, que exista `/srv/hilvapay`, que exista
   `shared/.env.production`.
2. **`flock`**: un solo deploy a la vez.
3. **Código desde git**: `fetch --all --prune` + `reset --hard origin/main`. El
   fetch va *después* del flock a propósito: dos deploys simultáneos sobre el
   mismo working tree dejarían la release entre dos commits.
4. **Copia a `releases/<timestamp>/`** con rsync, excluyendo `node_modules`,
   `.next`, `.git`, `tasks`, `.env*` y basura de Finder.
5. **Secretos**: instala `shared/.env.production` en la release con `chmod 600`.
6. **Guard de env vars.** Aborta antes del build si falta o está vacía cualquiera
   de estas **diez**:

   ```
   DATABASE_URL   WHOP_API_KEY   WHOP_COMPANY_ID   WHOP_API_BASE
   WHOP_API_VERSION_DATE   PANEL_PASSWORD   PANEL_HOST   PAGOS_HOST
   NEXT_PUBLIC_BASE_URL   CRON_SECRET
   ```

   **Esta lista tiene que coincidir con `ENV_CRITICAS` de
   `app/api/health/route.ts`.** Si el health check fuera más estricto, el deploy
   pasaría este guard, arrancaría, y el paso 11 lo revertiría por una variable
   que acá se decidió no exigir: un rollback en loop por una diferencia de
   criterio entre dos archivos.

   `WHOP_WEBHOOK_SECRET`, `PANEL_INGEST_URL`, `PANEL_INGEST_KEY`,
   `RESEND_API_KEY` y `PANEL_SESSION_SECRET` **no** están en la lista a
   propósito: el servicio anda sin ellas (el webhook rechaza con 400 en vez de
   procesar sin firma, no se reporta al panel externo, no se manda el email de
   entrega, o cae a `PANEL_PASSWORD` respectivamente).
7. **`npm ci` + `npm run build`**, y `npm test`. `npm ci` va **sin
   `--omit=dev`**: los scripts de `db:migrate`/`db:seed` corren con `tsx`. Migra
   `hilvapay_test` y corre los tests ahí: son unitarios y no tocan la base, pero
   **la migración sí se prueba** — si rompe, el deploy se cae antes de tocar
   producción.
8. **Completa el standalone**: `next build` no copia `.next/static/` dentro de
   `.next/standalone/`. Además copia `scripts/` y `lib/`, y linkea el
   `node_modules` completo de la release, porque `npm run db:seed` corre con
   `tsx` desde `current`.
9. **Migra la base.** No usa `npm run db:migrate` y eso es a propósito: ese
   script es `tsx --env-file=.env.local scripts/migrate.ts`, y `.env.local` no
   existe en la VPS. Se invoca
   `node --env-file=.env.production ./node_modules/.bin/tsx scripts/migrate.ts`.
   Si la migración falla, `current` sigue en la release anterior y el checkout
   sigue sirviendo con el schema que conoce.
10. **Swap atómico** de `current` con `mv -Tf`.
11. **`pm2 reload hilvapay-3020`** + health check en **`/api/health`** (hasta 20
    intentos cada 2 s esperando 200). Si no responde, loguea el diagnóstico
    completo del endpoint y vuelve solo a la release anterior.

    Antes el health check pegaba a `/`, que sirve una página estática: devolvía
    200 con Postgres caído, con las migraciones sin correr y con la
    `WHOP_API_KEY` vacía. O sea, el rollback automático verificaba que Node
    hubiera arrancado y nada más. `/api/health` chequea `select 1`, la lista de
    migraciones esperadas y las env vars críticas. Lo que **no** hace es llamar a
    la API de Whop: un health check que depende de un tercero convierte una caída
    de Whop en un rollback nuestro que no arregla nada.
12. **Poda**: deja las 5 releases más nuevas, salteando la que está sirviendo.

**No purga cache de Cloudflare** (ver §2, `loader.js`).

### Estructura en la VPS

```
/srv/hilvapay/
├── repo/                      clone de git (main). De acá sale cada build
├── releases/20260913162128/   una release = copia del repo + node_modules + build
├── current -> releases/<X>/.next/standalone      ← lo que apunta PM2
├── shared/
│   ├── .env.production        env vars (600). LA fuente de verdad
│   ├── deploy.env             config del deploy (600)
│   └── uploads/               imágenes de producto subidas desde el panel
├── deploy.log
└── .deploy.lock
```

`uploads/` vive en `shared/` (y no dentro de la release) para que los deploys y
los rollbacks no se lleven las imágenes que se subieron desde el panel;
`UPLOADS_DIR` del env apunta ahí.

**⚠️ `/srv/hilvapay/shared` es `755`, y en todos los demás servicios es `700`.**
Los archivos de adentro sí son `600`, así que el `.env.production` no es
legible por otros usuarios — pero el directorio se puede listar, y es la única
excepción de la máquina. Corregirlo es una línea, con el servicio andando:

```bash
ssh funnel-vps
chmod 700 /srv/hilvapay/shared
ls -ld /srv/hilvapay/shared        # drwx------
```

`deploy.env` de este servicio:

| Clave | Valor |
|---|---|
| `PUBLIC_HOST` | `hilvapay.hilvanapp.com` |
| `PORTS` | `"3020"` |
| `DEPLOY_SOURCE` | `git` |
| `DEPLOY_BRANCH` | `main` |
| `CF_ZONE_ID`, `CF_API_TOKEN` | de la zona `hilvanapp.com`. **Hoy `deploy.sh` no los usa** |
| `ORIGIN_IP` | la IP del server. Acá y no en git |

El `.env.production` tiene 18 variables; tres están vacías **a propósito**
(`PANEL_INGEST_URL`, `PANEL_INGEST_KEY`, `RESEND_API_KEY`): son decisiones
pendientes, no un olvido. Sin las dos primeras no se reporta al panel externo;
sin la tercera no se manda el email de entrega.

### Los bloques de Caddy

Están en `deploy/Caddyfile.hilvapay` y se pegan a mano en `/etc/caddy/Caddyfile`.
Son **dos bloques con el mismo backend** (ver el recuadro del principio), y las
tres cosas que no se pueden
tocar son:

- **`header_up Host` + `header_up X-Forwarded-Host`** en los dos, o el middleware
  no distingue los dominios.
- **El `defer` de los `header`**: sin él Caddy setea el header antes de correr el
  proxy y la respuesta sale con **dos** `Cache-Control`.
- **Los dos `header` separados en `pay.hilvanapp.com`**, con
  `@sin_cache not path /loader.js /media/*`: un `no-store` global le sacaría el
  cache a lo único que conviene cachear.

Validar y recargar siempre en ese orden:

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

**`/etc/caddy/Caddyfile` es la fuente de verdad** y tiene bloques que no están en
ningún repo (`ritual`, `generador`, `gatos`, `panel.infinixapp.com`, `paytest`).
El `provision.sh` de los repos de funnel copia su propia versión ENCIMA: **eso
borraría estos dos bloques.** Antes de correr uno, respaldar. Hay backups con
timestamp en `/etc/caddy/Caddyfile.bak-*`.

---

## 6 · Migraciones

Viven en `db/migrations/` (hoy nueve, la última `009_metodo_pago_tipo.sql`) y las
corre `scripts/migrate.ts`, que es idempotente.

El deploy migra **antes** de activar la release nueva, así que durante unos
segundos el código viejo corre contra el schema nuevo. **Escribí migraciones
compatibles hacia atrás**: agregar columnas nullable o con default, sí; borrar o
renombrar una columna que el código viejo todavía lee, no. Si necesitás borrar
algo, hacelo en dos deploys: primero el código que deja de usarla, después la
migración que la elimina.

Esto también es lo que hace que un rollback sea parcial: volver el código atrás
no deshace la migración.

Para mirar la base:

```bash
ssh funnel-vps-root
sudo -u postgres psql -d hilvapay
sudo -u postgres psql -l | grep hilvapay    # hilvapay, hilvapay_test
```

La credencial de la app está en `/root/.hilvapay-db-url` (chmod 600), mismo
patrón que infinix.

**No hay backup automático de esta base.** El único `pg_dump` programado en la
máquina es el de `panel` (crontab de `root`, 04:30, retención 14 días). Si el
catálogo y el historial de cobros de acá pasan a importar, hace falta una línea
equivalente:

```
40 4 * * * sudo -u postgres pg_dump hilvapay | gzip > /srv/hilvapay/backups/hilvapay-$(date +\%F).sql.gz
```

---

## 7 · Rollback

Este servicio no tiene `rollback.sh`. Tiene el rollback automático de
`deploy.sh` (si el health check de `/api/health` falla), pero para "el deploy
salió bien y la release está mal" es a mano:

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
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/api/health
```

No corras `pm2 save` hasta confirmar que quedó sano: si guardás un estado roto,
vuelve igual en el próximo reboot.

Y de nuevo: **esto no deshace las migraciones.**

### El freno de emergencia no es un rollback

Si lo que hay que hacer es **dejar de cobrar ya**, no toques el deploy: apagá
`paginas.activo` desde el panel. Corta el cobro al instante, sin redeploy y sin
reiniciar nada.

```sql
select count(*) from paginas  where activo;   -- 0 = nada cobrando
select count(*) from origenes where activo;   -- 0 = el botón del funnel da 403
```

Todo nace apagado a propósito: una página de pago nueva no cobra hasta que
alguien la prende, y un funnel no puede disparar un cobro hasta que su origen
está en la tabla `origenes`.

### Reboot

PM2 resucita el proceso desde `/home/deploy/.pm2/dump.pm2` vía el unit
`pm2-deploy`; Caddy, Postgres, ufw y fail2ban arrancan con el sistema.
`Automatic-Reboot` de unattended-upgrades está **desactivado**: el server no se
reinicia solo. Lo único que rompe la resurrección es olvidarse de `pm2 save`
después de cambiar el proceso.

---

## 8 · Los crons — son TRES, no uno

Verificado en el crontab de `deploy` el 2026-09-13:

| Cada | Comando | Log |
|---|---|---|
| 1 min | `/srv/hilvapay/repo/deploy/drenar-salidas.sh` | `/var/log/hilvapay/salidas.log` |
| 10 min | `/srv/hilvapay/repo/deploy/pegar-cron.sh /api/cron/reconciliar` | `/var/log/hilvapay/reconciliar.log` |
| 5 min | `/srv/hilvapay/repo/deploy/pegar-cron.sh /api/cron/vigilar` | `/var/log/hilvapay/vigilar.log` |

Si un doc dice "uno solo, cada minuto", está viejo: eso era antes de
`reconciliar` y `vigilar`.

Las tres líneas están en `deploy/cron.hilvapay`. Para instalarlas o
reinstalarlas, **cuidado: el crontab de `deploy` es uno solo para toda la
máquina** y hoy tiene 17 líneas (9 del panel de hilvanapp, 5 del de infinix y
estas 3). Un `crontab -u deploy -` pegando solo este archivo **borra las otras
14**.

```bash
ssh funnel-vps
crontab -l > /tmp/cron.actual              # respaldá SIEMPRE primero
crontab -e                                 # editá, agregando solo lo que falte
crontab -l | grep hilvapay                 # confirmá que quedaron las tres
```

**Por qué los crons usan `curl` y no `tsx`:** no existe un script de tsx que
drene la cola directamente contra `lib/salidas.ts` — la única puerta de entrada
es la ruta `app/api/cron/salidas`, y escribir un script nuevo duplicaría esa
lógica fuera de la app. Cómo evitan dejar `CRON_SECRET` en texto plano en el
crontab está comentado en `deploy/cron.hilvapay`.

**Por qué hay dos scripts de curl y no uno:** `drenar-salidas.sh` ya estaba
instalado y funcionando cuando aparecieron los otros dos crons, así que no se
tocó; `pegar-cron.sh` es la versión genérica que toma la ruta como argumento
(con allowlist) y sirve para los tres. Unificar es cambiar una línea del crontab
y borrar el viejo, cuando se quiera.

El log de salidas guarda la **respuesta JSON completa** de cada corrida
(`{tomadas, enviadas, fallidas, omitidas}`), no solo el código HTTP, para poder
ver de un vistazo si la cola se está acumulando en `fallidas`.

---

## 9 · Lo que nunca va al repo

- **`.env` / `.env.local` / `.env.production`** — los secretos viven solo en
  `/srv/hilvapay/shared/.env.production` con `chmod 600`. Ahí están la
  `WHOP_API_KEY`, el secret del webhook, el `CRON_SECRET`, el
  `CONFIG_ENCRYPTION_KEY` y el `DATABASE_URL`.
- **La IP del origen** — vive en `ORIGIN_IP` de `shared/deploy.env`. Está
  filtrada en `HANDOFF-DNS.md` de este repo; conviene borrarla de ahí.
- **`uploads/`** — las imágenes que se suben desde el panel viven en
  `/srv/hilvapay/shared/uploads/`, fuera del árbol de releases.

El único archivo de entorno que sí va es `.env.example`, con placeholders.

---

## 10 · Lo que queda del lado de Whop

No es trabajo de infraestructura, va acá para que no se pierda:

1. **El webhook.** Whop → Developer → Webhooks, URL
   `https://pay.hilvanapp.com/api/webhooks/whop`, versión **v1**, eventos
   `payment.succeeded`, `payment.failed`, `refund.created`, `dispute.created`.
   Probarlo con **Send event**: tiene que dar 200. El signing secret ya está
   cargado en el env, así que **si se crea un webhook nuevo hay que actualizar
   `WHOP_WEBHOOK_SECRET`** — el viejo secret hace que todo llegue como 400.
2. **Los planes de los upsells**, tipo `one_time` y atados a un producto.
3. **La primera compra de prueba**, con tarjeta real y reembolso: no hay sandbox
   configurado, así que es la única forma de verificar que Whop guarda el método
   de pago. Sin eso no hay upsell one-click.

---

## 11 · Cosas que ya pasaron en `dashboard-admin` y no hay que repetir acá

- **Correr `deploy.sh` como root.** Costó una caída del panel el 2026-08-13. El
  guard de este `deploy.sh` es el mismo, textual.
- **Deployar por rsync sin git.** En el server no habría forma de saber qué
  versión está corriendo. El modo `DEPLOY_SOURCE=local` existe solo para un
  bring-up o si GitHub está caído — no es el modo de régimen.
- **Documentar la base como un contenedor Docker.** En esta VPS no hay Docker:
  Postgres es el paquete de Ubuntu. Cualquier `docker exec … psql` falla con
  `command not found`.

---

## 12 · Qué se verificó el 2026-09-13

Para que se sepa qué es dato duro y qué es historia:

- `pm2 status` (`hilvapay-3020` online),
  `readlink -f /srv/hilvapay/current` (release `20260913162128`),
  `git -C /srv/hilvapay/repo remote get-url origin`
  (`git@github-hilvapay:drasticcurl/checkout-hilvapay.git`, rama `main`).
- `crontab -l` de `deploy`: **17 líneas**, tres de este servicio (salidas cada
  minuto, reconciliar cada 10, vigilar cada 5). `crontab -l` de `root`: 2 líneas,
  las dos del backup de la base `panel` — ninguna de `hilvapay`.
- `stat -c %a` de todos los `/srv/*/shared`: `/srv/hilvapay/shared` es el único
  en **755**; el resto en 700. Los archivos de adentro, 600.
- Postgres: `select version()` (16.15), `show listen_addresses` (localhost), y
  las bases `hilvapay` y `hilvapay_test`.
- `/etc/caddy/Caddyfile`: los bloques de `hilvapay.hilvanapp.com` y
  `pay.hilvanapp.com`, y los otros 13. `ls -la /etc/caddy/certs/` confirma que
  `hilvapay.pem`/`.key` son **symlinks a `panel.pem`/`panel.key`**, y
  `openssl x509 -ext subjectAltName` que ese cert es
  `*.hilvanapp.com` + `hilvanapp.com`.
- `ufw status`, `sshd` sin password auth, versiones (Node 20.20.2, npm 10.8.2,
  PM2 7.0.3, Caddy 2.11.4).
- API de Cloudflare: las 5 zonas, su `settings/ssl` (`hilvanapp.com` en
  **strict**), sus `dns_records` (`hilvapay` y `pay` proxeados) y sus `rulesets`
  de cache y firewall, transcriptos en §2. `browser_cache_ttl` de la zona:
  **14400**.
- HTTP en vivo: los diez códigos de §4, incluidos el **307** de
  `hilvapay.hilvanapp.com/` (el doc anterior decía 200), el **404** de
  `pay.hilvanapp.com/admin`, el **400** del POST al webhook y el
  `cache-control: public, max-age=14400` de `loader.js`.
- `grep` de `deploy/deploy.sh`: no hay ninguna llamada a la API de Cloudflare, y
  el health check pega a `/api/health` (el doc anterior decía `/`).
- Los nombres (no los valores) de las 18 variables de
  `/srv/hilvapay/shared/.env.production`, y cuáles están vacías.

Lo que **no** se verificó: si hay cobros reales pasando, el estado de los planes
en Whop, ni si el webhook está recibiendo eventos. Eso se mira en el panel de
hilvapay y en el dashboard de Whop.

Además de lo ya dicho, se corrigió de la versión anterior de este documento: el
número de crons (decía uno, son tres), el endpoint del health check, el código
de `https://hilvapay.hilvanapp.com/`, y la afirmación de que había que crear una
excepción de WAF para el webhook (ya existe, y es de zona).
