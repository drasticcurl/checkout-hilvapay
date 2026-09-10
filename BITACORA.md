# Bitácora

Registro de las sesiones de trabajo: qué se decidió, qué se **midió** y qué quedó pendiente.

No repite el estado del proyecto — eso está en [`ESTADO.md`](ESTADO.md), que siempre describe el
presente. Esto es el rastro de cómo se llegó ahí, y sobre todo de las cosas que costó averiguar y que
sería caro volver a descubrir.

---

## 2026-09-10 — Reconciliación, alertas por Telegram y el bug del payload

Commits: `f4b3ba6`, `96373bf`, `e7dfec8`. Release en producción: `20260910231740`.

### De dónde salió

Un pedido abierto: analizar el proyecto y proponer qué agregarle. El módulo estaba sólido en el camino
del dinero (idempotencia, monotonía de estados, el `ON CONFLICT` sin árbitro), así que lo que faltaba no
eran features del checkout: eran **caminos de recuperación que no dependan del webhook de Whop** y
**un lugar donde mirar qué pasó**.

Se propusieron 13 items. El dueño eligió 5 y descartó 8. Lo que se descartó también queda acá: sin esto,
en tres meses alguien vuelve a proponer lo mismo.

| # | Propuesta | Decisión |
|---|---|---|
| 1 | Cron de reconciliación de cobros colgados | **hecho** |
| 2 | Bot de Telegram con alertas | **hecho** |
| 3 | `/api/health` de verdad | **hecho** |
| 4 | Recuperar los `requiere_tarjeta` por email | postergado (no se entendió el planteo; se retoma) |
| 5 | Recuperación de carritos abandonados | postergado |
| 6 | Códigos de descuento | no por ahora |
| 7 | Pantalla de números | **hecho** |
| 8 | Reembolsos y disputas visibles en el panel | **hecho** |
| 9 | Buscador de cobros por email | descartado: para eso se entra a Whop |
| 10 | Pantalla de cola y eventos | descartado |
| 11 | Freno de fuerza bruta en el login | postergado: es un MVP de un solo usuario |
| 12 | Backups de la base | todavía no |
| 13 | Fake de Whop para probar sin tarjeta | descartado: se prueba con una compra real |

### Lo que se midió contra la API real

Todo con `Api-Version-Date: 2026-08-21-1`, el pin del proyecto.

**`GET /payments` existe y sirve.** Con `account_id`, `first`, `order`, `direction`, `created_after`.
Responde 200. Es lo que permite reconciliar un cobro que quedó sin `whop_payment_id`.

**La fila del listado no tiene `plan_id`.** La doc lo muestra plano; la API lo devuelve anidado como
`plan: {id}`. Tampoco tiene `settlement_amount`. Sí tiene `checkout_configuration_id`, que resultó ser un
vínculo más fuerte que el plan para emparejar el cobro del front (la columna de `ordenes` es única).

**La forma del objeto Payment depende del `api_version_date`.** El hallazgo que más importa:

| Campo | `GET /payments/{id}` con `2026-08-21-1` | `payment.succeeded` de la doc (`2026-09-09`) |
|---|---|---|
| member | `member: {id}` | `member_id` plano |
| tarjeta guardada | `payment_method: {id}` | `payment_method_id` plano |
| email | dentro de `user` | `customer_email` en la raíz |
| plan | `plan: {id}` | `plan_id` plano |
| importe | `settlement_amount: 12.18` | **no existe** — solo `total: {amount}` |

El handler del webhook leía únicamente la forma anidada. Con la plana guardaba
`whop_payment_method_id` en NULL —**cero upsells one-click**—, el email en NULL y el `monto` en NULL; y
un monto NULL hace que `armarPayloadIngest` descarte la venta ("no tiene monto"), así que no llega al
dashboard ni aparece en los números.

**Y la versión no se puede elegir.** Crear el webhook por API pide `developer:manage_webhook`, que en
esta key está en `false`. Se crea desde el dashboard y la versión la pone Whop. Por eso
`normalizarPago` lee las dos formas: no es defensa teórica, es la única manera de que el webhook
registre bien una venta sin saber qué versión le tocó.

**Los permisos de la key, uno por uno.** `GET /permissions?resource_id=biz_...` devuelve 259 acciones con
su `granted`. Los 11 que exige `payment.succeeded` están **todos concedidos**, más
`webhook_receive:refunds` y `webhook_receive:disputes`. En `false`: `developer:manage_webhook`,
`company:balance:read`, `stats:read`, `developer:basic:read` — de esos, el único que se extraña es el
primero.

**Hay un pago viejo de KashPay en la cuenta.** Uno solo, con `metadata.kashpay_checkout_id` y el plan
huérfano `plan_sARwY0XsFUbAg`. La reconciliación lo ignora correctamente porque su metadata no tiene
`orden_id`; hay un test que lo fija para que nadie afloje el emparejamiento y se lo pegue a un cobro
nuestro.

**La tabla de migraciones se llama `_migraciones`**, con guion bajo. El health check lo daba por
`migraciones` y habría reportado 503 siempre.

### Dos trampas que aparecieron al hacerlo

**El crontab de `deploy` es compartido.** Tenía 33 líneas: 9 de `/srv/panel/` y 5 de
`/srv/panel-infinix/`. `deploy/cron.hilvapay` decía "instalar con `crontab -u deploy -`", y eso
**reemplaza el crontab entero**: habría borrado los 14 crons de los otros dos proyectos, y no se
notaría hasta que alguien pregunte por qué el panel dejó de actualizar cotizaciones. Se agregaron solo
las líneas nuevas, con respaldo en `~deploy/backups/`, y el procedimiento correcto quedó escrito en la
cabecera del archivo.

**El health check y el guard del deploy no pueden discrepar.** La primera versión del health check
exigía `WHOP_WEBHOOK_SECRET`, que `deploy.sh` excluye de sus `REQUIRED` a propósito (sin ella el webhook
falla seguro y Whop reintenta). El deploy habría pasado su propio guard, arrancado, y después el health
check lo habría revertido: rollback en loop por una diferencia de criterio entre dos archivos. Las dos
listas ahora son la misma y cada archivo dice que la otra existe.

### Qué se construyó

**Reconciliación** (`/api/cron/reconciliar`, cada 10 min). Dos barridos round-robin por
`cobros.revisado_at`, 20 cobros por corrida. El primero cierra los cobros en `creando`/`procesando`; el
segundo relee los pagados para detectar reembolsos y disputas sin depender del webhook. El
emparejamiento de un huérfano (`emparejar`) es deliberadamente conservador y **devuelve null ante
cualquier ambigüedad**: adivinar sería marcar como pagado un upsell que nadie compró.

**Bot de Telegram y vigilante** (`/api/cron/vigilar`, cada 5 min). Las ventas van al equipo; lo técnico
solo al admin. Alta por el propio bot (`/alta <código>`, `/baja`, `/id`, `/estado`) o a mano desde el
panel. Tres reglas que hacen que el canal sirva:

1. un sistema nuevo y sin tráfico **no alerta nada** (un bot que arranca gritando no se vuelve a mirar);
2. cada alerta tiene ventana de silencio, con la del webhook insistiendo cada 10 minutos a pedido;
3. **si no se pudo avisar, la alerta no se marca como enviada** — se reintenta cuando haya canal.

**Health check real.** `deploy.sh` pegaba a `/`, que es una página estática: devolvía 200 con Postgres
caído, con las migraciones sin correr y con la API key vacía. El rollback automático estaba verificando
que Node hubiera arrancado. No le pega a la API de Whop a propósito: un health check que depende de un
tercero convierte una caída de Whop en un rollback nuestro que no arregla nada.

**Pantalla de números** y **reembolsos/disputas visibles** en el panel. Lo segundo se escribía
correctamente desde el webhook y ninguna pantalla lo seleccionaba: entraba un contracargo y no se veía
en ningún lado.

### Cómo se verificó

Cada afirmación de arriba tiene una comprobación detrás, no una lectura de código.

| Qué | Cómo |
|---|---|
| El normalizador arregla el bug | `payment.succeeded` **firmado** con forma plana contra el endpoint local → `whop_payment_method_id=payt_PLANO`, `metodo_guardado=true`, `monto=9.90` (de `total.amount`, no los 9.20 de `amount_after_fees`) |
| La reconciliación encuentra huérfanos | cobro sintético sin `whop_payment_id` → listó los pagos de Whop, no emparejó el de KashPay, reportó `sinPagoEnWhop: 1`, `errores: 0` |
| El vigilante no es ruidoso | sistema vacío → `detectadas: 0`. Con dos problemas y sin token → `detectadas: 2, mandadas: 0, sinCanal: 2` y la tabla `alertas` **vacía** |
| El dedupe respeta cada ventana | dos alertas ya enviadas → `silenciadas: 2`; envejeciendo solo una más allá de su ventana → `silenciadas: 1, sinCanal: 1` |
| El filtro de audiencia | 3 destinatarios (uno en pausa, uno con técnicas) → `equipo` devuelve 2, `admin` devuelve 1 |
| El bot | `/start`, `/id`, `/alta` con código correcto e incorrecto, `/alta` repetido (no duplica), `/estado` desde un chat no registrado (lo niega), `/baja` |
| El health | 200 público sin detalle, detalle solo con el bearer, y `PANEL_HOST`/`PAGOS_HOST` exigidas solo en producción para que `npm run dev` no dé 503 |
| El webhook desde internet | sin firma → 400; **firmado con el secreto de producción → 200**, evento registrado y procesado; 0 redirects; Cloudflare no lo desafía |
| Los crons en producción | disparando solos, sin intervención: `vigilar` a las 23:25:01, 23:30:02 y 23:35:01 (cada 5 min, como está configurado) y `reconciliar` a las 23:30:02 |
| Lo de siempre | 248 tests (eran 173), `tsc` exit 0, `next build` compila, migraciones idempotentes, las 12 afirmaciones de esquema en verde |

Los datos de prueba se limpiaron: la base local y la de producción quedaron sin filas propias.

### Lo que quedó pendiente y es de otro

1. **Crear el webhook** en Developer → Webhooks con los seis eventos (`payment.created`,
   `payment.succeeded`, `payment.failed`, `payment.pending`, `refund.created`, `dispute.created`),
   versión **v1**. Al crearlo el signing secret cambia: va a `WHOP_WEBHOOK_SECRET` en
   `/srv/hilvapay/shared/.env.production` + `pm2 reload hilvapay-3020 --update-env`.
2. **El bot**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID_ADMIN`, `TELEGRAM_WEBHOOK_SECRET`,
   `TELEGRAM_CODIGO_REGISTRO`, y registrar el webhook de Telegram una vez.
3. Lo de la lista de arriba que quedó postergado, más `logrotate` y backups de la base.

El detalle de cada uno está en `ESTADO.md` §3.
