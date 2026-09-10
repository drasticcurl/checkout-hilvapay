# Checkout propio sobre Whop

Reemplaza a KashPay como capa de checkout. Whop sigue siendo el procesador; lo que se reemplaza es la
capa de arriba, que cobraba 5% extra y se caía.

Un panel donde asociás un producto de Whop a un link de pago (`/pagos/aguadearroz1`), la página de
checkout con HTML propio y el embed de Whop adentro, y el cobro one-click de los upsells contra la
tarjeta que se guardó en la compra del front.

**Qué está hecho, qué falta y qué no hay que romper: [`ESTADO.md`](ESTADO.md).**
El plan, las decisiones y las tasks:
[`tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md`](tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md).
Cómo deployar: [`COMO-DEPLOYAR.md`](COMO-DEPLOYAR.md).

Este archivo es solo cómo levantarlo.

---

## Levantarlo

```bash
npm install
./scripts/configurar-env.sh          # pide las credenciales y las VERIFICA contra Whop
npm run db:migrate
npm run dev                          # http://localhost:3020
```

`configurar-env.sh` escribe `.env.local` con permisos 600 y confirma contra la API que la key, la
versión y los planes están bien. Volvé a correrlo cuando quieras cambiar algo: lo que dejás en blanco
con Enter se conserva. Para solo re-verificar sin tocar nada: `npm run whop:verificar`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | puerto 3020 |
| `npm run db:migrate` | aplica `db/migrations/*.sql`. Idempotente |
| `npm run db:seed` | carga los productos y links de prueba |
| `npm test` | vitest |
| `npm run whop:verificar` | re-confirma la conexión con Whop, sin escribir nada |

Los scripts de `tsx` van con `--env-file=.env.local`: Next carga ese archivo solo, `tsx` no.

## Está sano?

```bash
curl -s localhost:3020/api/health
# {"ok":true,"servicio":"hilvapay","base":"ok","migraciones":"ok","config":"ok"}
```

Devuelve **503** si la base no contesta, si falta una migración o si falta una variable crítica. Es lo
que dispara el rollback automático del deploy. Con el bearer del `CRON_SECRET` dice *qué* falta:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:3020/api/health
```

Sin el bearer no expone ese detalle, y en ningún caso imprime el valor de una variable.

## Los tres crons

```bash
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3020/api/cron/salidas
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3020/api/cron/reconciliar
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3020/api/cron/vigilar
```

| Endpoint | Cada | Qué hace |
|---|---|---|
| `salidas` | 1 min | drena la cola: reporta las ventas al panel y manda los emails de entrega |
| `reconciliar` | 10 min | le pregunta a Whop por los cobros colgados y los cierra. Detecta reembolsos y disputas **sin depender del webhook** |
| `vigilar` | 5 min | avisa por Telegram: ventas al equipo, lo técnico solo al admin |

En producción los llama el crontab con `deploy/pegar-cron.sh` (ver `deploy/cron.hilvapay`).

## El bot de avisos

Sin bot no se pierde ninguna venta: el vigilante detecta igual y lo escribe en
`/var/log/hilvapay/vigilar.log`. Pero es la diferencia entre enterarse de una disputa en 15 minutos y
enterarse cuando llega el contracargo.

1. @BotFather → `/newbot` → el token va en `TELEGRAM_BOT_TOKEN`.
2. Elegí dos secretos cualesquiera: `TELEGRAM_WEBHOOK_SECRET` y `TELEGRAM_CODIGO_REGISTRO`.
3. Hablale al bot, mandale `/id` y poné ese número en `TELEGRAM_CHAT_ID_ADMIN`.
4. Registrá el webhook, una sola vez:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://pay.hilvanapp.com/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

5. Probalo con **Mandar una prueba** en `/admin/alertas`.

Para sumar a alguien más: que le mande `/alta <código>` al bot. Comandos: `/alta`, `/baja`, `/id`,
`/estado`.

> **Telegram no deja que un bot escriba primero.** Quien no le haya mandado `/start` al bot da 403 y su
> fila se pone en pausa sola. El panel lo muestra y dice qué hacer.

Los avisos de venta se apagan con `TELEGRAM_AVISAR_VENTAS=0`; las fallas no se pueden apagar.

## Estado verificado de la conexión con Whop

Medido el **2026-09-10** contra la API real:

| | |
|---|---|
| Entorno | **producción** (`https://api.whop.com/api/v1`). En sandbox la key da 401 |
| `Api-Version-Date` | `2026-08-21-1` |
| Company | `biz_Me8Lbiv174brtM` — "Sinvanapp" |
| Plan del front | `plan_hgNXAvG16M9ix` — 9.90 usd, `one_time`, producto `prod_pRD7ZnRinvzU1` |
| Emails de Whop | **apagados** (`send_customer_emails: false`) |

Los planes de los tres upsells **todavía no existen**.

### Cuatro endpoints que NO sirven para verificar

Verificado: los cuatro devuelven falsos positivos o falsos negativos.

| Endpoint | Qué pasa de verdad |
|---|---|
| `GET /accounts/me` | **403.** Pide el scope `company:balance:read`, que no está entre las 22 permisos |
| `GET /companies/me` | **200 pero de otra company** (la personal del usuario, no la del negocio) |
| `GET /plans` sin `account_id` | **400** `account_id is required` |
| `GET /products` sin `account_id` | **200 con el catálogo público de Whop.** La peor: parece que funcionó |

El que sirve para sondear es `GET /companies/{biz_id}`.

## Configuración en Whop

### La API key

Dashboard → **Developer → Account API keys** → Create. Dejá la lista de IPs vacía.

> La guía de KashPay dice "**Company** API keys". Whop hoy lo llama "**Account** API keys". Es el mismo
> lugar.

Lo más rápido es darle el **rol Admin**. Si preferís recortar, van estas 22 y no menos —
`POST /payments` por sí solo exige 13 y `POST /checkout_configurations` otros 5, y recortar produce
403 que no dicen qué falta:

```
company:basic:read
developer:manage_webhook
checkout_configuration:create
checkout_configuration:basic:read
plan:create
plan:basic:read
access_pass:create
access_pass:update
access_pass:basic:read
payment:basic:read
webhook_receive:payments
payment:charge
payment:manage
payment:setup_intent:read
payment:dispute:read
payment:dispute_alert:read
payment:resolution_center_case:read
shipment:basic:read
member:basic:read
member:email:read
member:phone:read
promo_code:basic:read
```

> `access_pass` en la API es lo que el dashboard llama "product". Son lo mismo.

### El webhook

Dashboard → **Developer → Webhooks** → Create.

- URL: `https://pay.hilvanapp.com/api/webhooks/whop`
- Versión: **v1**. No v2 ni v5 — esas no usan firmas Standard Webhooks
- Eventos hijos: desactivados
- Eventos:

```
payment.created
payment.succeeded
payment.failed
payment.pending
refund.created
dispute.created
```

`payment.created` no es de relleno: llega en cuanto Whop crea el pago y vincula el `payment_id` al
cobro antes de que se sepa si entró la plata. Sin él, un cobro cuyo POST se cortó a mitad de camino se
queda sin id hasta que la reconciliación lo busque en el listado, 10 minutos después.

Copiá el signing secret completo, con el prefijo `ws_`, **sin recodificarlo en base64**.

> `setup_intent.succeeded` no hace falta: pertenece al flujo de "guardar tarjeta sin cobrar". Acá se
> cobra y se guarda en el mismo movimiento con `setupFutureUsage="off_session"`.

Para probarlo: **Send event** desde el dashboard. Tiene que devolver 200.

### Los planes

Uno por precio, tipo `one_time`, **atado a un producto**. Un plan huérfano (sin producto) no admite
códigos de descuento.

Un plan `renewal` le cobra de nuevo al comprador el período siguiente, solo, sin que este checkout
intervenga. `configurar-env.sh` avisa si detecta uno.

## Base de datos

Postgres 16, el paquete nativo de Ubuntu en la VPS (`127.0.0.1:5432`), con base propia. No hace falta
pooler ni SSL: la app corre como **un** proceso de PM2 y reusa las conexiones del pool.

Local:

```bash
pg_ctl -D /opt/homebrew/var/postgresql@16 start
createdb checkout
npm run db:migrate
```

Las 12 afirmaciones del esquema, contra una base con las migraciones aplicadas:

```bash
psql "$DATABASE_URL" -f tasks/checkout-whop/_verificacion-checkout.sql
```

Corren dentro de una transacción que se descarta: no dejan datos.

## Antes de encender

Todo nace apagado a propósito. Encenderlo es explícito:

```sql
select count(*) from funnels  where activo;   -- 0 hasta que lo prendas en el panel
select count(*) from paginas  where activo;   -- 0
select count(*) from origenes where activo;   -- 0: sin esto el botón del funnel da 403
```

### El freno de emergencia

Un paso cobra solo si **su** switch está prendido **y**, cuando pertenece a un funnel, el del funnel
también. Es un AND, así que hay dos frenos y el grande es el del funnel:

| Qué apagás | Qué corta |
|---|---|
| `funnels.activo` desde el panel | **toda la cadena de una**, al instante y sin redeploy |
| `paginas.activo` de un paso | solo ese paso |

Verificado: con el funnel apagado, `POST /api/upsell/cobrar` devuelve 404 y no crea ninguna fila en
`cobros`, aunque el paso siga encendido.

Una página que no pertenece a ningún funnel (las de antes de la migración 003) sigue gobernada solo
por su propio switch.

## Los dominios

- **`pay.hilvanapp.com`** — este servicio.
- **`pay.hilvanapp.online`** — es de KashPay. Se puede liberar cuando quieras: no hay tráfico
  corriendo. No lo reuses para este servicio mientras el DNS viejo siga propagándose.
