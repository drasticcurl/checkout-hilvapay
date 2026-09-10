# ESTADO — checkout propio sobre Whop (hilvapay)

Última actualización: **2026-09-10**.

Este archivo es la foto del proyecto: qué es, qué está hecho, qué falta y qué hay que saber para no
romperlo. Si algo de acá no coincide con la realidad, la realidad tiene razón: corregí el archivo.

- **El plan y las decisiones** están en `tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md`.
- **Cómo levantarlo y configurar Whop**, en `README.md`.
- **Cómo deployar**, en `COMO-DEPLOYAR.md`.

---

## 1. Qué es

Reemplaza a KashPay como capa de checkout. **Whop sigue siendo el procesador**: lo que se reemplaza
es la capa de arriba, que cobraba 5% extra y se caía.

Tres piezas:

1. **Un panel** donde asociás un producto de Whop a un link de pago y armás el funnel visualmente.
2. **La página de checkout** (`/pagos/<slug>`): HTML propio con el embed de Whop adentro y botón
   propio. Guarda la tarjeta con `setupFutureUsage="off_session"`.
3. **El cobro one-click** de los upsells contra esa tarjeta, más un `loader.js` que los funnels
   embeben para que el botón sea dos líneas de HTML.

Las páginas de venta y los VSL **siguen viviendo en los funnels** (`ritual.hilvanapp.org` y compañía).
Este servicio cobra y redirige; no sirve contenido de marketing.

---

## 2. Está en producción

| | |
|---|---|
| Panel | **https://hilvapay.hilvanapp.com** → `/admin` → login |
| Links de pago | **https://pay.hilvanapp.com/pagos/&lt;slug&gt;** |
| VPS | `207.244.244.208`, alias ssh `funnel-vps` (usuario `deploy`) y `funnel-vps-root` |
| Path | `/srv/hilvapay/` con `repo/`, `releases/`, `current`, `shared/` |
| Proceso | PM2 `hilvapay-3020`, escucha **solo** en `127.0.0.1:3020` |
| Base | `hilvapay` (+ `hilvapay_test` para el deploy), rol `hilvapay`, Postgres 16 nativo |
| Credencial de la base | `/root/.hilvapay-db-url` (chmod 600) |
| Repo | `github.com/drasticcurl/checkout-hilvapay` (privado, deploy key de solo lectura) |
| Cron | `* * * * *` drena la cola `salidas`; log en `/var/log/hilvapay/salidas.log` |
| Deploy | `sudo -u deploy bash /srv/hilvapay/repo/deploy/deploy.sh` |

**Los dos dominios apuntan al mismo proceso** y se separan en `middleware.ts` por
`x-forwarded-host`. `pay.hilvanapp.com/admin` devuelve **404** a propósito: ese dominio va en anuncios
y no expone ni la pantalla de login.

### Estado de la conexión con Whop, verificado contra la API real

| | |
|---|---|
| Entorno | **producción** (en sandbox la key da 401) |
| `Api-Version-Date` | `2026-08-21-1` |
| Company | `biz_Me8Lbiv174brtM` — "Sinvanapp" |
| Producto | `prod_pRD7ZnRinvzU1` — "app agua de arroz" |
| Plan del front | `plan_hgNXAvG16M9ix` — 9.90 usd, `one_time` |
| Plan del upsell | `plan_r0bQAmFITt6aU` — 37.00 usd, `one_time`, "Acceso Vip 30 Días" |
| Planes huérfanos | `plan_sARwY0XsFUbAg`, `plan_5t3JLH0wp9o7c` — sin producto, **no usar** |
| Emails de Whop | **apagados** (`send_customer_emails: false`) |

---

## 3. Lo que falta

Ordenado por lo que bloquea a lo que no.

### 3.1 Nunca cobró nada. Falta la primera compra real.

**Es lo único que puede confirmar que el módulo funciona.** No hay sandbox configurado, así que la
única forma de verificar que Whop guarda la tarjeta es comprar con una tarjeta real y reembolsar.

```bash
# después de comprar el front, esto tiene que devolver un payt_...
psql -d hilvapay -c "select email, whop_member_id, whop_payment_method_id, metodo_guardado
                       from ordenes order by created_at desc limit 1;"
```

Si `whop_payment_method_id` queda en `null`, **no hay upsell one-click** y hay algo que ajustar en el
embed. Todo lo demás del módulo depende de eso.

### 3.2 Nadie recibe nada cuando compra

`send_customer_emails` está en **false** en Whop y `RESEND_API_KEY` está vacía. Hoy alguien paga y no
le llega ni la confirmación ni el acceso. Lo más rápido es **prender los emails de Whop** mientras se
arma la plantilla propia, para que no haya un solo día sin entrega.

El envío propio ya está implementado, detrás de un interruptor en la base que arranca apagado:

```sql
select emails_activos from config;   -- false
```

### 3.3 Las ventas no llegan al dashboard-admin

`PANEL_INGEST_URL` y `PANEL_INGEST_KEY` están vacías a propósito (P-04 del plan, sin resolver). La
cola de salidas se drena marcando las filas como omitidas y no postea a ningún lado — es el estado
seguro mientras no se decida con qué funnel se reporta.

### 3.4 El webhook de Whop no está apuntado acá

Dashboard de Whop → Developer → Webhooks → Create:

- URL: `https://pay.hilvanapp.com/api/webhooks/whop`
- Versión **v1** (no v2 ni v5: esas no usan firmas Standard Webhooks)
- Eventos: `payment.succeeded`, `payment.failed`, `refund.created`, `dispute.created`
- Probarlo con **Send event**: tiene que dar 200

Ya hay un `WHOP_WEBHOOK_SECRET` cargado; si se crea un webhook nuevo hay que actualizarlo.

**Si Cloudflare tiene Bot Fight Mode o WAF en la zona, hay que exceptuar ese path.** Un webhook que
Cloudflare desafía falla en silencio, y Whop **deshabilita un endpoint que falla 72 horas seguidas sin
reenviar los eventos de ese período**.

### 3.5 T06: el botón en los funnels

La última task del plan, sin hacer. Reemplaza los botones de KashPay de `testfunnel` por el del
checkout propio. Está escrita en `tasks/checkout-whop/T06-boton-en-testfunnel.md`.

No corre riesgo de romper ventas (no hay tráfico), pero **el copy de las páginas de upsell es texto
final aprobado y no se toca**: solo el botón.

### 3.6 La base de producción está vacía

Los productos y páginas que existen están en la base **local**. En producción hay que cargarlos desde
**Catálogo de Whop** en el panel, que los trae por API y los vincula en dos clicks.

---

## 4. Lo que hay que saber para no romperlo

### 4.1 Cuatro endpoints de Whop que NO sirven para verificar

Verificado el 2026-09-10 contra la API real. Los cuatro devuelven falsos positivos o negativos:

| Endpoint | Qué pasa de verdad |
|---|---|
| `GET /accounts/me` | **403.** Pide el scope `company:balance:read`, que no está entre las 22 permisos |
| `GET /companies/me` | **200 pero de OTRA company** (la personal del usuario) |
| `GET /plans` sin `account_id` | **400** `account_id is required` |
| `GET /products` sin `account_id` | **200 con el catálogo público de Whop.** La peor: parece que funcionó |

El que sirve para sondear es `GET /companies/{biz_id}`. Está automatizado en
`./scripts/configurar-env.sh --solo-verificar` (`npm run whop:verificar`).

### 4.2 Tres cosas de la doc de Whop que son falsas o incompletas

1. **`standardwebhooks` no sirve** con su comportamiento por defecto: hace `base64.decode()` de un
   secret que es un string `ws_` literal, así que la firma **no valida nunca**. Y el helper oficial
   (`unwrapWebhook` de `@whop/sdk/helpers`) **todavía no existe** — la propia doc dice "lands in the
   next release". Por eso la verificación está escrita a mano en `lib/whop-webhook.ts`.
2. **No existe el substatus `requires_action`.** El 3DS llega como `failed` con
   `decline_code: authentication_required` o `three_d_secure_*`. Un mapeo por substatus manda todos
   los 3DS al mismo cajón que "tarjeta robada" y pierde ventas recuperables.
3. **Un pago off-session que pidió 3DS no se puede continuar**: `client_secret` es `null` para los
   pagos hechos desde un método guardado. El único camino es cobrar de nuevo on-session con el embed.

### 4.3 El freno de emergencia

Un paso cobra solo si **su** switch está prendido **y**, cuando pertenece a un funnel, el del funnel
también:

| Qué apagás | Qué corta |
|---|---|
| `funnels.activo` desde el panel | **toda la cadena de una**, al instante y sin redeploy |
| `paginas.activo` de un paso | solo ese paso |

Verificado con un cobro real: con el funnel apagado, `POST /api/upsell/cobrar` devuelve 404 y **no
crea ninguna fila en `cobros`**, aunque el paso siga encendido.

### 4.4 Archivos que no se tocan

```
lib/estado-pago.ts        44 tests dependen de su comportamiento exacto
lib/whop-webhook.ts       15 tests, y la clave del HMAC es literal (ver 4.2)
lib/funnels.ts            22 tests; decide a dónde va el comprador DESPUÉS de cobrar
db/migrations/001_init.sql   YA CORRIÓ. Una columna nueva va en una migración nueva
```

En la VPS: **`/etc/caddy/Caddyfile` tiene bloques que no viven en ningún repo**
(`ritual.hilvanapp.org`, `generador.hilvanapp.online`, `gatos.infinixapp.com`,
`panel.infinixapp.com`). Un `provision.sh` de otro repo los borraría. Backups en
`/etc/caddy/Caddyfile.bak-*`.

### 4.5 La zona de Cloudflare no puede pasar a Full (strict)

`infinixapp.com` en esa misma máquina usa certs self-signed y se cae entera. Está documentado en
`/srv/PROYECTOS.md` de la VPS.

---

## 5. Bugs que se encontraron midiendo, no leyendo

Están acá porque son el tipo de cosa que alguien "simplifica" en seis meses sin saber por qué estaba
así. Todos con su test o su verificación.

| Qué pasaba | Cómo se encontró |
|---|---|
| **El `ON CONFLICT` con árbitro declarado moría bajo concurrencia.** `cobros` tiene dos índices únicos que la misma fila viola; Postgres solo suprime el que le declarás. 5 POST simultáneos: 3 daban 200 y **2 morían con 500**. El anti-doble-cobro funcionaba, pero el comprador que hacía doble click veía un error habiendo pagado bien | disparando 5 cobros concurrentes |
| **11 rutas de `/api/admin` quedaban prerenderizadas en el build**, con un cobro y el email del comprador **horneados dentro de `.next/`** | leyendo `find .next -name '*.body'` |
| **El interruptor del funnel no cortaba nada.** Los tres puntos de entrada miraban `paginas.activo` y ninguno `funnels.activo`: apagar un funnel no detenía ni un cobro. Un switch que miente es peor que no tenerlo | probando el freno con un cobro real |
| **Los redirects del panel salían a `https://localhost:3020`**, así que el login era inusable desde internet. Detrás de Caddy, `req.nextUrl` trae la dirección donde escucha el proceso, no el host del browser | mirando el `Location` desde afuera |
| **El build consultaba la base**, y en un deploy limpio la migración corre después: abortó con `relation "productos" does not exist`. En local no falla porque la base ya está migrada | el primer deploy a la VPS |
| **El cron apuntaba a `current/deploy/`**, que no existe: `current` es un symlink al standalone de Next. El cron nunca habría corrido y la cola se habría acumulado en silencio | buscando el archivo en la VPS |
| **El crontab tenía `%{http_code}`** y en un crontab el `%` se traduce a salto de línea: el comando se cortaba ahí | revisando el archivo antes de instalarlo |
| **El panel espera CENTAVOS enteros** (`value_cents`, `bigint`) y los importes están en unidades. `1234567.89 * 100` da `123456788.99999999`: truncar pierde un centavo | probándolo en node |
| **El embed salía negro** sobre la página blanca: el default es `theme: 'system'` y seguía el modo del sistema del visitante | usándolo |

---

## 6. Preguntas abiertas

Están en `tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md` §10, con su formato completo. Resumen:

| | Qué falta | Bloquea |
|---|---|---|
| P-01 | `Api-Version-Date` y permisos | **resuelta** |
| P-02 | los `plan_id` | front y upsell 1 resueltos; faltan los otros dos si van a ser tres |
| P-03 | quién manda los emails | no el código, **sí el lanzamiento** |
| P-04 | con qué identidad se reporta al panel | no |
| P-05 | si los funnels pasan `sessionId`/`visitorId` | no (sin eso la venta no se atribuye) |
| P-06 | precios de los upsells 2 y 3 | no |
| P-07 | dominio | **resuelta** |
| P-08 | cuánto cuesta `off_session` en conversión del front | no |
| P-09 | path de `/plans` | **resuelta** (exige `account_id`) |
| P-10 | si se activa el precio en moneda local | no |
| P-11 | desarrollar contra producción, sin sandbox | no el código, sí la confianza |
| P-12…P-16 | detalles que anotaron los agentes al implementar | no |

---

## 7. Números

```
173 tests en 11 archivos · tsc exit 0 · next build compila
3 migraciones, idempotentes · 12 afirmaciones de esquema en verde
38 rutas · 2 dominios sobre 1 proceso
0 cobros reales · 0 webhooks recibidos
```
