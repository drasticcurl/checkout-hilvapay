# ESTADO — checkout propio sobre Whop (hilvapay)

Última actualización: **2026-09-10** (reconciliación de cobros, alertas por Telegram, health check real
y pantalla de números).

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
| Crons | `* * * * *` drena `salidas` · `*/10` reconcilia cobros · `*/5` vigila y avisa. Logs en `/var/log/hilvapay/` |
| Health | `GET /api/health` — base, migraciones y env vars. Es lo que dispara el rollback del deploy |
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

### Un pago que ya existe en la cuenta

Verificado el 2026-09-10 con `GET /payments`: la cuenta tiene **un** pago, hecho por **KashPay**
(`metadata.kashpay_checkout_id`) sobre el plan huérfano `plan_sARwY0XsFUbAg`. No salió de este
checkout. La reconciliación lo ignora correctamente porque su metadata no tiene `orden_id` — está
cubierto por test para que nadie lo "arregle" aflojando el emparejamiento.

Y dos diferencias entre la doc de Whop y la API real, medidas ese mismo día sobre
`Api-Version-Date: 2026-08-21-1`:

| La doc dice | La API devuelve |
|---|---|
| `plan_id` plano en la fila del listado | `plan: {id, ...}` anidado. **`plan_id` no existe** |
| montos como objetos `{amount, currency}` | `settlement_amount` no aparece en el listado |

Por eso el listado se usa **solo para identificar** un pago, y el estado se lee siempre con
`GET /payments/{id}`, cuya forma sí está verificada. Está comentado en `PagoListado` (`lib/whop.ts`).

---

## 2.bis Reconciliación y alertas (nuevo, 2026-09-10)

Tres agujeros que estaban abiertos y ya no:

### El cobro colgado

`GET /api/cron/reconciliar`, cada 10 minutos. Le pregunta a Whop por los cobros que quedaron en
`creando` o `procesando` y los cierra.

**Por qué hacía falta:** un cobro se resolvía solo por el polling del browser o por el webhook, y las
dos vías fallan juntas en el mismo caso. El polling necesita la pestaña abierta y además **sale
temprano cuando el cobro no tiene `whop_payment_id`** ("no hay nada que consultar") — que es justo el
caso del 409 indeterminado y del timeout, donde es más probable que le hayamos cobrado a alguien y
perdido la respuesta. Quedaba el webhook como única red, y Whop deshabilita un endpoint que falla 72 h
sin reenviar lo de ese período. Alcanzaba una caída del webhook para que un cobro pagado se quedara en
`procesando` para siempre: sin email de entrega, sin evento al panel, sin nada que lo dijera.

Dos barridos, los dos round-robin por `cobros.revisado_at` y acotados a 20 cobros por corrida:

| Barrido | Qué hace |
|---|---|
| Sin resolver | Con `whop_payment_id`: `GET /payments/{id}` y `aplicarEstadoDePago`. Sin él: lista los pagos recientes y busca el que tenga nuestro `metadata.orden_id` |
| Pagados | Relee los cobros pagados sin reembolso para detectar reembolsos y disputas **sin depender del webhook** |

El emparejamiento de un huérfano (`emparejar`, 15 tests) es deliberadamente conservador: matchea por
`checkout_configuration_id` de la orden, o por `metadata.orden_id` + `pagina_id`, o por orden + plan.
**Si dos pagos matchean, no toca nada** y lo deja para una persona: adivinar sería marcar como pagado
un upsell que nadie compró.

Verificado contra la API real: con un cobro huérfano sintético, el barrido listó los pagos, no
emparejó el de KashPay y lo reportó como `sinPagoEnWhop: 1`, sin errores.

### Nadie leía los errores

`GET /api/cron/vigilar`, cada 5 minutos, avisa por **Telegram**. El módulo ya escribía
`whop_eventos.error`, `salidas.ultimo_error`, `salidas.intentos` y `cobros.disputa_at`
correctamente — y nadie los leía nunca.

Qué se avisa, con los umbrales en `lib/alertas.ts`:

| Alerta | Cuándo | A quién |
|---|---|---|
| `venta:<id>` | cada cobro que queda pagado | **equipo** |
| `webhook_mudo` | 2 h sin webhooks habiendo funcionado antes, o cobros sin ni un webhook nunca | admin |
| `ventas_fallando` | 3 o más intentos en la última hora y **ninguno** entró | admin |
| `cobros_trabados` | cobros sin resolver de más de 45 min | admin |
| `cola_quemada` | filas de `salidas` que agotaron los 10 reintentos | admin |
| `cola_atascada` | cola vencida hace más de 15 min (el cron del minuto no corre) | admin |
| `eventos_con_error` | eventos de Whop sin procesar | admin |
| `disputa:<id>` / `reembolso:<id>` | una vez por cobro | admin |

**Las ventas son lo único que ve el equipo.** Todo lo demás va solo a `TELEGRAM_CHAT_ID_ADMIN` y a
quien tenga `recibe_tecnicas` prendido en el panel. La razón no es privacidad: alguien que recibe "la
cola tiene 3 filas quemadas" no puede hacer nada con eso y aprende a ignorar al bot — y después
tampoco lee el aviso de la venta siguiente.

**Las tres reglas que hacen que el canal sirva:**

1. **Un sistema nuevo y sin tráfico no alerta nada.** Un bot que arranca gritando es un bot que nadie
   vuelve a mirar. Está cubierto por test.
2. **Cada alerta tiene ventana de silencio** (`alertas.clave` es la PK). Sin eso, un problema abierto
   manda 288 mensajes por día y a la tercera alguien silencia el bot — peor que no tener alertas,
   porque ahora hay un canal en el que nadie confía.
3. **La del webhook insiste cada 10 minutos**, que es la excepción a la regla anterior y es a pedido:
   mientras el webhook no llegue, las ventas se registran solo por reconciliación. El cron corre cada 5
   minutos para que esa cadencia sea posible.

Y la regla de seguridad: **si no se pudo avisar, la alerta no se marca como enviada.** Se reintenta en
la corrida siguiente. Verificado: con el token sin configurar, `detectadas: 2, mandadas: 0,
sinCanal: 2` y la tabla `alertas` vacía.

El alta es por el propio bot (`/alta <código>`, `/baja`, `/id`, `/estado`) o a mano desde
`/admin/alertas`. `TELEGRAM_CHAT_ID_ADMIN` recibe siempre y no se puede borrar desde el panel: es el
piso que evita que un DELETE deje al sistema sin nadie a quien avisarle.

### El health check no chequeaba nada

`deploy.sh` pegaba a `http://127.0.0.1:3020/`, que sirve `app/page.tsx`: **una página estática que
devuelve 200 con Postgres caído, con las migraciones sin correr y con la `WHOP_API_KEY` vacía.** El
rollback automático estaba verificando que Node hubiera arrancado.

Ahora `GET /api/health` chequea `select 1`, que las migraciones esperadas estén aplicadas y que las env
vars críticas existan, y devuelve **503** si algo falta. Con `Authorization: Bearer $CRON_SECRET`
agrega el detalle de qué falta; sin el bearer no lo expone. Nunca imprime el valor de una variable.

No le pega a la API de Whop a propósito: un health check que depende de un tercero convierte una caída
de Whop en un rollback nuestro que no arregla nada.

### Las pantallas nuevas del panel

| Pantalla | Qué contesta |
|---|---|
| `/admin/numeros` | bruto, neto, aprobación, conversión del checkout y take-rate por paso del funnel, en 24 h / 7 d / 30 d. Todo sale de `cobros`, no de Whop |
| `/admin/alertas` | quién recibe los avisos y si de verdad le están llegando (no es lo mismo: se puede tener el switch prendido y haber bloqueado el bot) |
| `/admin/cobros` | ahora muestra **reembolsos y disputas**, que se escribían y no se leían en ninguna pantalla |

El nav pasó de 6 a 8 ítems, así que la barra de una línea ahora arranca en `xl` (1280px) y no en `lg`:
a 1024px los ocho no entran. Abajo de eso se usa la fila con scroll horizontal que ya existía.

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

**Hay que crearlo desde el dashboard, no por API.** La key tiene
`developer:manage_webhook` en **false** (verificado el 2026-09-10 con
`GET /permissions?resource_id=biz_...`), así que `POST /api/v1/webhooks` devuelve 403.

Dashboard de Whop → **Developer → Webhooks → Create**:

| | |
|---|---|
| URL | `https://pay.hilvanapp.com/api/webhooks/whop` |
| Versión | **v1**. No v2 ni v5: esas no usan firmas Standard Webhooks |
| Eventos hijos | desactivados |

Los seis eventos que este servicio maneja:

```
payment.created      ← vincula el payment_id al cobro antes de saber si entró la plata
payment.succeeded    ← la venta
payment.failed       ← el rechazo, con decline_code y recovery_url
payment.pending
refund.created
dispute.created
```

`payment.authorized`, `payment.canceled`, `refund.updated`, `dispute.updated` y
`dispute_alert.created` también tienen handler: si se suscriben, funcionan. Cualquier otro evento se
anota en el log y se ignora — no rompe nada.

`setup_intent.succeeded` **no hace falta**: pertenece al flujo de "guardar tarjeta sin cobrar". Acá se
cobra y se guarda en el mismo movimiento con `setupFutureUsage="off_session"`. `membership.*` tampoco:
este servicio no maneja niveles de acceso.

Copiá el signing secret completo, con el prefijo `ws_`, **sin recodificarlo en base64**, y ponelo en
`WHOP_WEBHOOK_SECRET`. Probalo con **Send event**: tiene que dar 200.

#### Los 11 permisos que exige `payment.succeeded` están todos concedidos

Verificado uno por uno el 2026-09-10: `payment:basic:read`, `plan:basic:read`,
`access_pass:basic:read`, `member:basic:read`, `member:email:read`, `member:phone:read`,
`promo_code:basic:read`, `shipment:basic:read`, `payment:dispute:read`,
`payment:resolution_center_case:read`, `webhook_receive:payments` → **granted: true** los 11. También
`webhook_receive:refunds` y `webhook_receive:disputes`.

Lo único que falta en la key es `developer:manage_webhook` (y `company:balance:read`, `stats:read`,
`developer:basic:read`, que no se usan).

**Si Cloudflare tiene Bot Fight Mode o WAF en la zona, hay que exceptuar ese path.** Un webhook que
Cloudflare desafía falla en silencio, y Whop **deshabilita un endpoint que falla 72 horas seguidas con
10 o más entregas fallidas, sin reenviar los eventos de ese período** (a las 24 h manda un mail de
aviso). Reintenta 12 veces en ~71 horas: 30 s, 2 min, 8 min, 30 min, 1 h, 3 h, 6 h y después cada 12 h.

Mientras no esté conectado, las ventas se registran igual por reconciliación, con hasta 10 minutos de
atraso, y el vigilante avisa cada 10 minutos que el webhook no llega.

### 3.5 T06: el botón en los funnels

La última task del plan, sin hacer. Reemplaza los botones de KashPay de `testfunnel` por el del
checkout propio. Está escrita en `tasks/checkout-whop/T06-boton-en-testfunnel.md`.

No corre riesgo de romper ventas (no hay tráfico), pero **el copy de las páginas de upsell es texto
final aprobado y no se toca**: solo el botón.

### 3.6 La base de producción está vacía

Los productos y páginas que existen están en la base **local**. En producción hay que cargarlos desde
**Catálogo de Whop** en el panel, que los trae por API y los vincula en dos clicks.

---

### 3.7 El bot de Telegram no está creado

El código está y funciona; falta el token. Cuatro variables, todas documentadas en `.env.example`:

| Variable | Para qué | Sin ella |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/newbot` | el vigilante detecta y **no puede avisar** (queda en el log) |
| `TELEGRAM_CHAT_ID_ADMIN` | el chat que recibe siempre | nadie recibe hasta que alguien se dé de alta |
| `TELEGRAM_WEBHOOK_SECRET` | autentica a Telegram contra nosotros | `POST /api/telegram/webhook` responde **404** y el bot no contesta |
| `TELEGRAM_CODIGO_REGISTRO` | el código de `/alta` | el alta por el bot queda deshabilitada; hay que cargar los chats a mano |

Después del deploy, registrar el webhook una sola vez:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://pay.hilvanapp.com/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Y probarlo con el botón **Mandar una prueba** de `/admin/alertas`. Ojo con el modo de falla más común:
**Telegram no permite que un bot escriba primero.** Quien no le haya mandado `/start` al bot recibe un
403 y su fila se pone en pausa sola (el panel lo muestra y explica qué hacer).

### 3.8 Los crons nuevos — **instalados y verificados el 2026-09-10**

Los tres corren en la VPS. Se agregaron al crontab de `deploy` **sin tocar** los 14 crons de
`/srv/panel/` y `/srv/panel-infinix/` que comparten ese crontab (ver §4.4). Verificado corriendo los dos
scripts a mano contra el proceso real:

```
/api/cron/reconciliar → {"revisados":0,...,"errores":0}
/api/cron/vigilar     → {"detectadas":0,"mandadas":0,"sinCanal":0}
```

Falta un `/etc/logrotate.d/hilvapay`: `salidas.log` son ~525k líneas por año.

### 3.9 El login del panel no tiene freno de fuerza bruta

`/api/checkout/sesion` tiene rate limit por IP (20/min) y `/api/admin/login` **no tiene ninguno**. Un
password único, cookie de 7 días, y ese panel puede prender un link que cobra tarjetas reales.
Postergado a propósito mientras sea un MVP de un solo usuario.

### 3.10 No hay backups de la base

Ningún `pg_dump` en ningún cron. En `ordenes` están los emails de los compradores y los ids de Whop.

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
lib/reconciliacion.ts     `emparejar` tiene 15 tests. Aflojar una regla de matcheo
                          marca como pagado un upsell que nadie compró
lib/whop.ts               `normalizarPago` tiene 21 tests y lee DOS formas del
                          payload a propósito (ver §5). Simplificarlo a una deja
                          las ventas sin monto y sin tarjeta guardada
db/migrations/001_init.sql   YA CORRIÓ. Una columna nueva va en una migración nueva
db/migrations/00{2,3,4,5}.sql ídem: ya corrieron
```

En la VPS: **`/etc/caddy/Caddyfile` tiene bloques que no viven en ningún repo**
(`ritual.hilvanapp.org`, `generador.hilvanapp.online`, `gatos.infinixapp.com`,
`panel.infinixapp.com`). Un `provision.sh` de otro repo los borraría. Backups en
`/etc/caddy/Caddyfile.bak-*`.

**Y el crontab de `deploy` es COMPARTIDO.** Verificado el 2026-09-10: 35 líneas, de las cuales 9 son de
`/srv/panel/` y 5 de `/srv/panel-infinix/`. `crontab <archivo>` reemplaza el crontab **entero**, así que
instalar `deploy/cron.hilvapay` de una borraría los 14 crons de los otros dos proyectos — y no se
notaría hasta que alguien pregunte por qué el panel dejó de actualizar cotizaciones. Las líneas se
**agregan** una por una; el procedimiento con respaldo está en la cabecera de `deploy/cron.hilvapay`.
Backups en `~deploy/backups/crontab-*.bak`.

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
| **El health check del deploy no chequeaba nada.** Pegaba a `/`, que es una página estática: 200 con Postgres caído, con las migraciones sin correr y con la API key vacía. El rollback automático verificaba que Node hubiera arrancado | leyendo qué ruta usaba |
| **El polling no puede rescatar el peor caso.** `GET /api/cobros/[id]` sale temprano si el cobro no tiene `whop_payment_id` — que es exactamente el estado que deja un 409 indeterminado o un timeout, o sea el caso donde es más probable que le hayamos cobrado a alguien y perdido la respuesta | siguiendo los caminos de resolución de un cobro colgado |
| **`plan_id` no existe en el listado de pagos de Whop.** La doc lo muestra plano; la API con `Api-Version-Date: 2026-08-21-1` lo devuelve anidado como `plan: {id}`. Un emparejamiento que leyera `plan_id` habría fallado siempre, en silencio y solo para el cobro del front | pidiéndole `GET /payments` a la API real y mirando las claves |
| **Reembolsos y disputas se escribían y no se leían.** El webhook llenaba `reembolsado_at` y `disputa_at` correctamente, y ninguna pantalla del panel los seleccionaba: entraba un contracargo y no se veía en ningún lado | buscando dónde se mostraba `disputa_at` |
| **El handler del webhook leía una sola forma del payload, y no es la única.** La forma del objeto Payment depende del `api_version_date`: con el pin de este proyecto (`2026-08-21-1`) viene anidada (`member: {id}`, `payment_method: {id}`, `user: {email}`, `settlement_amount`), y el ejemplo de `payment.succeeded` de la doc (pin `2026-09-09`) viene **plana** (`member_id`, `payment_method_id`, `customer_email`, `plan_id`) y **sin `settlement_amount`** — el importe solo está en `total: {amount}`. Con la forma plana el handler guardaba `whop_payment_method_id` NULL (**cero upsells one-click**), email NULL y `monto` NULL, y un monto NULL hace que `armarPayloadIngest` omita la venta: no llega al dashboard ni aparece en los números. Y la versión NO se puede elegir, porque el webhook se crea desde el dashboard | leyendo el ejemplo de payload de la doc y comparándolo campo por campo con lo que devuelve la API real |

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
248 tests en 14 archivos · tsc exit 0 · next build compila
5 migraciones, idempotentes · 12 afirmaciones de esquema en verde
49 rutas · 2 dominios sobre 1 proceso · 3 crons
0 cobros reales · 0 webhooks de Whop recibidos · 0 alertas mandadas (falta el bot)
```
