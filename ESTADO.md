# ESTADO — checkout propio sobre Whop (hilvapay)

Última actualización: **2026-09-11** (cuenta de Whop rotada por el panel, el cobro off-session
bloqueado por Whop, tutorial guiado, alertas del bot y rate limit en el cobro).

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

**La cuenta cambió el 2026-09-10 y ya no es la del `.env`.** Desde que existe `/admin/conexion`, la
credencial que cobra sale de la tabla `config` (ver README, "Hay dos fuentes de credenciales"), y
diagnosticar leyendo `.env.production` da un diagnóstico falso — pasó en la sesión del 2026-09-11.

| | |
|---|---|
| Entorno | **producción** (en sandbox la key da 401) |
| Fuente de la credencial | tabla `config`, override del panel. `.env.production` es solo el respaldo |
| Company activa | `biz_LHktpJ17c83CFt` — "Atlas & Co.", `verified: false` |
| Plan del front | `plan_LHZoqVmWkYbuO` — 1.00 usd |
| Plan del upsell | `plan_7ToMQEt8zlUmK` — 2.00 usd |
| Emails de Whop | **apagados** (`send_customer_emails: false`) |

Verificado el 2026-09-11 contra la base de producción:

```bash
psql "$DATABASE_URL" -c "select whop_company_id, whop_verificado_at from config;"
# biz_LHktpJ17c83CFt | 2026-09-11 00:21:12
```

La cuenta anterior (`biz_Me8Lbiv174brtM` — "Sinvanapp", con `plan_hgNXAvG16M9ix` de 9.90 usd) sigue
viva en el `.env.production` como piso de respaldo, pero no es la que cobra desde que se guardó la key
de Atlas en el panel. No hay que confundir "la key del entorno todavía existe" con "la key del entorno
cobra": son cosas distintas desde la 006.

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

## 2.ter Cuenta rotada, tutorial guiado, rate limit en el cobro (2026-09-11)

**La cuenta de Whop se rotó desde el panel.** `/admin/conexion` ahora tiene guardada la key de
`biz_LHktpJ17c83CFt` ("Atlas & Co."), y esa es la que cobra — ver §2, "Estado de la conexión con
Whop". No se tocó código para esto: es el mecanismo de `resolverCredenciales` haciendo lo que tiene
que hacer.

Nuevo en esta sesión:

| Qué | Qué resuelve |
|---|---|
| `/admin/tutorial` | 9 pasos con estado **real** (lee la base y Whop, no una checklist estática) |
| Botón de copiar snippet | en cada paso del funnel, para no ir a buscar el `<script>` al código |
| `/admin/alertas` con salud del bot | corre `getMe` + `getWebhookInfo` de Telegram y dice **qué variable falta**, no solo "no configurado" |
| `lib/rate-limit.ts` | ver más abajo |
| Token de orden acotado al funnel de origen | una orden de un funnel no puede usarse para cobrar un upsell de otro |
| Botón de wallet (Apple Pay/Google Pay) | en la pantalla de **recuperación** (`components/checkout/BotonExpress.tsx`). Con el wallet el desafío 3DS lo resuelve el dispositivo (Face ID / PIN), no el emisor contra un flujo off-session — relevante por el bloqueo de §3.0 |

**`lib/rate-limit.ts`** nace de una auditoría que encontró que `POST /api/upsell/cobrar` —el
endpoint que cobra— no tenía ningún límite, mientras que `/api/checkout/sesion` sí (20/min). Ahora
tiene **10/min por IP**, en memoria, con su propio `Limitador` independiente del otro endpoint. No es
defensa contra un atacante con muchas IPs (para eso está Cloudflare, delante) ni un rate limiter
distribuido (el estado vive en el proceso y un `pm2 reload` lo reinicia): frena el bucle — doble
submit, script mal cortado, `useEffect` sin deps —, que es la mayoría de lo que pasa de verdad. Lo que
protege el cobro contra un doble cobro de verdad sigue siendo el índice único de `cobros`, no esto.

### El editor de funnels tenía un bug que dejaba todo funnel desconectado — arreglado

El paso `front` no tenía selector para su rama "si acepta": el comprador se quedaba en el checkout
después de pagar en vez de seguir al primer upsell. Ya arreglado; el detalle y la advertencia para
funnels viejos están en §5.

---

## 3. Lo que falta

Ordenado por lo que bloquea a lo que no.

### 3.0 El cobro off-session está bloqueado por Whop. Es lo que bloquea todo lo demás.

Medido el **2026-09-11**: `POST /payments` con `account_id` + `plan_id` + `member_id` +
`payment_method_id` —el cobro one-click del upsell, contra una tarjeta ya guardada— devuelve
**siempre**:

```json
{"error":{"type":"bad_request","message":"We could not process this payment request right now. Please try again later."}}
```

400, sin `decline_code`, y **sin crear ningún objeto de pago** en Whop. No es un caso puntual: se
probaron seis variantes y las seis dan el mismo error.

**Lo que se descartó, con evidencia:**

| Sospecha | Por qué no es eso |
|---|---|
| Un id inválido | Con ids inventados el endpoint da 404 **específicos** ("This Plan/Member/PaymentToken was not found"); con los cuatro reales, ninguno |
| El plan del upsell en particular | El mismo cobro con el plan del **front** —que ya cobró bien con esa misma tarjeta on-session— también da 400 |
| Un scope faltante | Se probaron 12 scopes: 11 dan 200. El único que falta (`developer:manage_webhook`) da 403 **nombrando el scope**, no un 400 genérico |
| El payload | Coincide campo por campo con la doc; omitir `payment_method_id` da el mensaje esperado ("...unless confirmation_token is provided"), así que el endpoint sí está leyendo el body |
| El plan en sí | Un plan inline con `renewal` llegó a **crearse** y recién ahí falló con el mismo 400 — el bloqueo está en el cobro, no en el plan |

Variantes probadas sin éxito: `plan_id` normal, plan del front, `capture: true`, con `email`,
`company_id` en vez de `account_id`, plan inline.

**Hipótesis principal:** el pago del front trae `three_ds_verified: true` y `risk_score: 70`. El
emisor probablemente exige 3DS en cada transacción, y off-session no hay nadie que pueda responder el
desafío — consistente con lo que ya dice §4.2.3: un pago off-session que pidió 3DS no se puede
continuar, `client_secret` es `null`.

El soporte de Whop confirmó que **ni el gating por company `verified: false` ni un mandato MIT están
documentados**, y que hace falta que ellos miren sus logs para decir qué está pasando. Sigue abierto.

**Dos endpoints que sí sirven, encontrados en el camino:**

- `GET /payment_methods?member_id=<mber_...>` **lista** los métodos guardados de un member.
  `GET /payment_methods/<payt_...>` en cambio da **404** — es un falso negativo, no significa que el
  método no exista.
- `POST /payments` con un id inválido devuelve el 404 específico de arriba, lo que lo hace útil para
  descartar "¿el id está mal?" antes de sospechar del cobro en sí.

### 3.1 Nunca cobró nada. Falta la primera compra real.

**Es lo único que puede confirmar que el módulo funciona.** No hay sandbox configurado, así que la
única forma de verificar que Whop guarda la tarjeta es comprar con una tarjeta real y reembolsar.

Y ojo: aunque el front cobre bien, **el upsell one-click sigue bloqueado por §3.0** hasta que Whop
resuelva el 400.

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
`GET /permissions?resource_id=biz_...`, y de nuevo el 2026-09-11 sobre la cuenta de Atlas: sigue en
`false`), así que `POST /api/v1/webhooks` devuelve 403.

**Sigue sin registrarse.** Verificado el 2026-09-11: `select count(*) from whop_eventos` da **0**. El
endpoint en sí está probado end-to-end y anda; lo que falta es exclusivamente que el dashboard de Whop
lo apunte acá. Las tres respuestas, medidas contra producción:

| Request | Respuesta | Por qué |
|---|---|---|
| firma válida, `webhook-id` nuevo | **200** `OK`, y una fila en `whop_eventos` | el camino normal |
| firma válida, **mismo `webhook-id`** | **200** `OK (duplicado)`, y **ninguna** fila nueva | se deduplica por id. Tiene que ser 2xx: con un 4xx Whop reintentaría y a las 72 h deshabilitaría el webhook sin reenviar lo de ese período |
| `webhook-timestamp` de 10 min atrás | **400** | la ventana anti-replay de 5 minutos de `lib/whop-webhook.ts` |

Los dos últimos son casos distintos y conviene no confundirlos: el reenvío del mismo evento se
absorbe sin procesarlo dos veces, y lo que se rechaza con 400 es un sobre viejo — el que usaría
alguien que capturó un request y lo repite más tarde.

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

El código está y funciona; falta el token. Verificado el 2026-09-11: **0 de las variables
`TELEGRAM_*` están en `/srv/hilvapay/shared/.env.production`.** Los tres crons sí corren en la VPS —
el vigilante detecta los problemas igual, solo que no tiene canal para avisarlos. Cuatro variables
obligatorias, todas documentadas en `.env.example`:

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

### 3.11 Apple Pay: falta un click en el dashboard de Whop, no código

El archivo `.well-known` ya se sirve. Verificado el 2026-09-11:
`https://pay.hilvanapp.com/.well-known/apple-developer-merchantid-domain-association` da **200**.
Falta registrar el dominio en el dashboard de Whop (Developer → Apple Pay o donde Whop lo pida) para
que Apple lo verifique. Google Pay no tiene este paso: no lo necesita.

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
| **El editor de funnels dejaba todo funnel desconectado.** `SelectorDestino` solo se ofrecía en los pasos de upsell; el paso `front` no tenía forma de elegir su rama "si acepta", así que `paginas.paso_aceptado_id` quedaba en `NULL` siempre y el comprador se quedaba en el checkout después de pagar. Arreglado el 2026-09-11: el selector es ahora genérico para toda rama. Los funnels armados antes hay que revisarlos a mano | armando un funnel de punta a punta y viendo dónde quedaba el comprador después de pagar |

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

Remedido el 2026-09-11:

```
423 tests en 22 archivos · tsc exit 0 · next build compila
6 migraciones, idempotentes
53 rutas · 2 dominios sobre 1 proceso · 3 crons
0 cobros reales · 0 webhooks de Whop recibidos · 0 alertas mandadas (falta el bot)
```

El cobro sigue en cero no solo por falta de la primera compra (§3.1): el upsell one-click, aunque el
front cobre, choca con el bloqueo de §3.0.
