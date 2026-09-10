# Checkout propio sobre Whop

Reemplaza a KashPay como capa de checkout. Whop sigue siendo el procesador; lo que se reemplaza es la
capa de arriba, que cobraba 5% extra y se caía.

Un panel donde asociás un producto de Whop a un link de pago (`/pagos/aguadearroz1`), la página de
checkout con HTML propio y el embed de Whop adentro, y el cobro one-click de los upsells contra la
tarjeta que se guardó en la compra del front.

**El plan completo, las decisiones y las tasks están en
[`tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md`](tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md).** Este
archivo es solo cómo levantarlo.

---

## Levantarlo

```bash
npm install
./scripts/configurar-env.sh          # pide las credenciales y las VERIFICA contra Whop
npm run db:migrate
npm run dev                          # http://localhost:3010
```

`configurar-env.sh` escribe `.env.local` con permisos 600 y confirma contra la API que la key, la
versión y los planes están bien. Volvé a correrlo cuando quieras cambiar algo: lo que dejás en blanco
con Enter se conserva. Para solo re-verificar sin tocar nada: `npm run whop:verificar`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | puerto 3010 |
| `npm run db:migrate` | aplica `db/migrations/*.sql`. Idempotente |
| `npm run db:seed` | carga los productos y links de prueba |
| `npm test` | vitest |
| `npm run whop:verificar` | re-confirma la conexión con Whop, sin escribir nada |

Los scripts de `tsx` van con `--env-file=.env.local`: Next carga ese archivo solo, `tsx` no.

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
payment.succeeded
payment.failed
refund.created
dispute.created
```

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

Postgres. En Vercel usá la connection string **con pooler** (Neon con `-pooler`, o el puerto 6543 de
Supabase): las funciones serverless abren y cierran conexiones todo el tiempo y sin pooler se agota el
límite.

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
select count(*) from paginas  where activo;   -- 0 hasta que lo prendas en el panel
select count(*) from origenes where activo;   -- 0: sin esto el botón del funnel da 403
```

El freno de emergencia es apagar `paginas.activo` desde el panel: corta el cobro al instante, sin
redeploy.

## Los dominios

- **`pay.hilvanapp.com`** — este servicio.
- **`pay.hilvanapp.online`** — es de KashPay. Se puede liberar cuando quieras: no hay tráfico
  corriendo. No lo reuses para este servicio mientras el DNS viejo siga propagándose.
