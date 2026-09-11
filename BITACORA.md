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

---

## 2026-09-10 (tarde) — El panel con sistema de diseño, y las credenciales de Whop rotables

Commits: `f4b3ba6` (panel + checkout), `b8e4c7c` (credenciales). Release de la primera:
`20260910225629`.

### De dónde salió

Dos pedidos seguidos. El primero, "hacé linda la UI del panel y que el checkout quede como esta
captura". El segundo, "necesito que la API key de Whop se setee manual, y que verifique y rote el biz
id".

### Lo que se midió antes de escribir

**`WHOP_API_KEY` no estaba cacheada.** Se lee dentro de `config()`, que `whopFetch` llama en cada
llamada. Lo que la fija es el arranque del proceso, no el build.

**El `.env.production` es una COPIA dentro de cada release, no un symlink a `shared/`.** Verificado:
`/srv/hilvapay/current/.env.production` es un archivo propio, `600 deploy:deploy`. Es el hallazgo que
más cuesta redescubrir y el que motivó todo lo demás: **editar solo el de `shared/` no cambia nada
hasta el próximo deploy**. Rotar una credencial a mano exige editar los dos y recargar PM2, y si
editás uno solo parece que el cambio no tomó.

**`config()` y `companyId()` solo se llaman desde adentro de `lib/whop.ts`**, y sus cinco call sites ya
eran funciones `async`. Por eso pasarlas a `async` fue un refactor de un archivo y el contrato
exportado del módulo no se movió. Si algún día se exportan, este cambio deja de ser contenido.

**La base tenía 0 cobros** al momento de deployar el panel: 1 página activa, 0 funnels activos. Por eso
la migración 004 se aplicó en producción sin ventana ni aviso. Vale registrarlo porque la próxima vez
el número no va a ser 0, y entonces la decisión no es la misma.

### La decisión de fondo: la base es un override, no un reemplazo

Bajar la API key a la base es un downgrade de cómo se guarda un secreto, y se aceptó con los ojos
abiertos:

| | Antes | Ahora |
|---|---|---|
| Para robarla | shell en la VPS | la base **y** `CONFIG_ENCRYPTION_KEY` |
| Para reemplazarla | shell en la VPS | la contraseña del panel |

Lo segundo es lo que importa: **quien tenga `PANEL_PASSWORD` puede mandar los cobros siguientes a otra
cuenta de Whop.** Contra eso hay tres cosas, y ninguna lo elimina: guardar y volver al entorno piden la
contraseña de nuevo (no alcanza la cookie), la key nunca se devuelve al browser, y el cambio queda
fechado en `whop_verificado_at`.

Lo que **no** se hizo, a propósito: sacar `WHOP_API_KEY` de `ENV_CRITICAS_SIEMPRE` ni del `REQUIRED` de
`deploy.sh`. Las dos listas se declaran iguales entre sí y los dos archivos documentan que aflojar una
sola produce un rollback en loop. Dejándolas, el env garantiza que el servicio pueda cobrar con la
tabla `config` vacía o con la clave de cifrado perdida — que es el camino de vuelta si esta pantalla
guarda algo que no funciona.

Por eso las columnas de la 006 nacen NULL, y NULL no es "sin configurar" sino "esta fila no opina".

### Verificar contra Whop: el endpoint y el chequeo que no es obvio

Se usa `GET /companies/{biz_id}`, lo que el README ya tenía medido. Pero verificar que responda 200 no
alcanza: **`verificarCredenciales` compara el `id` que devolvió Whop contra el que se pidió.** Sin ese
chequeo, un endpoint que ignora el path y contesta con otra company —que es exactamente lo que hace
`/companies/me`— pasaría como válido, y se guardaría un biz id que cobra en la cuenta de otro.

No pasa por `whopFetch`: ese resuelve las credenciales guardadas, y acá hay que probar unas que todavía
no lo están. Hacerlo por ahí obligaría a agregarle un modo "usá estas otras" al cliente que ejecuta los
cobros.

Medido con la key de producción: `{ok:true, companyNombre:"Sinvanapp"}`. Un `biz_` inexistente da 404 y
el mensaje culpa al biz id, no a la key.

### Dos cosas que costaron y conviene no volver a pelear

**`Uint8Array` es genérico desde TS 5.7.** `TextEncoder.encode()` y `Uint8Array.from()` devuelven
`Uint8Array<ArrayBufferLike>`, y Web Crypto pide `BufferSource` sobre un `ArrayBuffer` común. Lo que lo
arregla no es un `as` —eso dejaría pasar un `SharedArrayBuffer` de verdad— sino **no anotar los
retornos**: `: Uint8Array` sin argumento de tipo es justo lo que ensancha. Dejando inferir desde
`new Uint8Array(n)`, el tipo queda bien. Los `let iv: Uint8Array` también hay que dejarlos sin anotar.

**Dos utilidades de Tailwind del mismo eje en un elemento son un bug, no un override.** `clasesControl('h-10')`
generaba `h-9 px-3 h-10`: misma especificidad, así que gana la que Tailwind puso más abajo en la hoja,
no la última del atributo `class`. El alto pasó a ser un parámetro (`'md' | 'lg' | 'auto'`) para que no
se pueda expresar el conflicto.

### Sobre el panel

La regla de color es lo único que hay que respetar al agregar pantallas: acción primaria en casi-negro,
cobalto para lo interactivo, **verde solo para "está cobrando"** y rojo solo para destructivo. Antes el
verde era botón, estado y éxito a la vez, y por eso no se podía usar para significar algo.

La barra pasó de seis secciones a ocho y la fila de una línea tuvo que moverse de `lg` a `xl`: ocho
ítems piden ~750px y a 1024px les quedaban ~646px. `/admin/conexion` **no** es un noveno ítem por eso —
se llega por el engranaje del header, que es donde corresponde una pantalla de configuración que se
toca dos veces por año.

El CTA del checkout quedó en `#15803D` y no en el `#16A34A` de la paleta: con el verde claro, texto
blanco de 16px da 3.3:1 y no llega a AA. Con el oscuro, 5.0:1. Y es más parecido al verde de la captura
de referencia.

### Lo que quedó pendiente

1. **`CONFIG_ENCRYPTION_KEY` no está en la VPS.** Sin ella `/admin/conexion` se ve y lo avisa, pero el
   guardado se rechaza con 409 y el servicio sigue con el entorno. `openssl rand -hex 32`, y va en
   `/srv/hilvapay/shared/.env.production` **y** en la copia de la release viva (ver el hallazgo de
   arriba), o directamente en el próximo deploy.
2. **`b8e4c7c` no está deployado.** Trae la migración 006, que es aditiva (`add column if not exists`).
3. Sigue faltando el bot de Telegram y `RESEND_API_KEY`: el health los reporta como opcionales y el
   vigilante detecta igual, pero no puede avisar.

---

## 2026-09-11 — El cobro off-session da 400, la cuenta de Whop se rotó, y un bug que desconectaba todo funnel

### De dónde salió

El objetivo de la sesión era confirmar que el upsell one-click funciona de punta a punta contra una
cuenta real. No se llegó: el cobro off-session choca con un 400 de Whop sin explicación, y buena parte
de la sesión fue descartar causas hasta quedarse solo con una hipótesis y un ticket abierto con
soporte. En el camino se encontraron dos cosas más: la cuenta que cobra ya no es la del `.env`, y el
editor de funnels tenía un bug que dejaba cualquier funnel nuevo desconectado después del pago.

### El cobro off-session: descartado todo lo descartable, queda un 400 sin explicar

`POST /payments` con `account_id` + `plan_id` + `member_id` + `payment_method_id` —el cobro contra una
tarjeta ya guardada, sin que el comprador esté presente— devuelve siempre:

```json
{"error":{"type":"bad_request","message":"We could not process this payment request right now. Please try again later."}}
```

400, sin `decline_code`, sin crear ningún objeto de pago. Cero información para actuar. El orden en que
se descartaron las hipótesis, cada una con su prueba:

1. **¿Un id inválido?** No: con los cuatro ids inventados, Whop da 404 específicos por tipo ("This
   Plan/Member/PaymentToken was not found"). Con los cuatro reales, ninguno de esos 404. El endpoint
   sí los está resolviendo.
2. **¿El plan del upsell en particular?** No: el mismo cobro con el plan del **front** —que ya cobró
   bien con esa misma tarjeta, on-session, minutos antes— también da 400.
3. **¿Falta un scope?** No: se probaron 12 scopes contra `GET /permissions`. 11 dan `granted: true`.
   El único en `false` es `developer:manage_webhook` (el mismo de siempre, ver ESTADO §3.4), y cuando
   se lo prueba a propósito da **403 nombrando el scope que falta** — no un 400 genérico. El error de
   los cobros no tiene esa forma.
4. **¿El payload está mal armado?** No: coincide campo por campo con la doc. Y el endpoint sí lee el
   body — omitir `payment_method_id` da el mensaje puntual "payment_method_id is required unless
   confirmation_token is provided", no el 400 genérico.
5. **¿Es el plan?** No: se probó un plan inline con `renewal`, y ese **llegó a crearse** (existe en
   Whop) y recién ahí el cobro sobre él falló con el mismo 400. El bloqueo está después de resolver el
   plan, en el cobro mismo.

Seis variantes en total, las cinco de arriba más `capture: true` y mandar `email`. Las seis, el mismo
400.

**Se abrió un ticket con soporte de Whop.** Confirmaron dos cosas por la negativa: ni el gating por
company con `verified: false` ni un mandato MIT (Merchant-Initiated Transaction) están documentados
en su doc pública, y que van a necesitar mirar los logs del lado de ellos para decir algo más
concreto. Sigue sin respuesta.

**Hipótesis principal, sin confirmar:** el pago del front (on-session) trae `three_ds_verified: true`
y `risk_score: 70` en su respuesta. Si el emisor de la tarjeta exige 3DS en cada transacción —no solo
la primera—, un cobro off-session no tiene forma de resolver ese desafío: no hay comprador presente
para aprobarlo con el banco. Encaja con lo que ya estaba documentado en ESTADO §4.2.3 (un pago
off-session que pidió 3DS no se puede continuar, `client_secret` es `null`).

**Lo que sí sirvió, para la próxima vez que haya que diagnosticar un cobro:**

- `GET /payment_methods?member_id=<mber_...>` **lista** los métodos guardados de un member y sirve
  para confirmar que la tarjeta está ahí.
- `GET /payment_methods/<payt_...>` en cambio da **404** aunque el método exista — es un falso
  negativo, no hay que leerlo como "no se guardó".
- Los 404 específicos por id inválido de `POST /payments` (punto 1) son la forma más rápida de
  descartar "¿el id está mal?" antes de sospechar del cobro en sí.

Esto va a ESTADO §3.0 como el bloqueo actual más importante: sin resolverlo, el upsell one-click no
puede lanzarse aunque todo lo demás del módulo esté listo.

### La cuenta de Whop cambió, y diagnosticar por el `.env` dio un diagnóstico falso

Al empezar a probar el cobro, se leyó `.env.production` para confirmar contra qué cuenta se estaba
probando: `biz_Me8Lbiv174brtM` ("Sinvanapp"). Los resultados no cerraban con lo que se veía en el
dashboard de Whop, hasta confirmar que la credencial que cobra de verdad **no sale del `.env` desde que
existe `/admin/conexion`** (agregado el 2026-09-10, tarde — ver esa entrada). `resolverCredenciales`
mira la tabla `config` primero, y ahí hay una key guardada de otra cuenta:

```bash
psql "$DATABASE_URL" -c "select whop_company_id, whop_verificado_at from config;"
#  biz_LHktpJ17c83CFt | 2026-09-11 00:21:12
```

`biz_LHktpJ17c83CFt` — "Atlas & Co.", `verified: false` en Whop. Los planes en uso son
`plan_LHZoqVmWkYbuO` (front, 1.00 usd) y `plan_7ToMQEt8zlUmK` (upsell, 2.00 usd), los dos de Atlas. La
key de Sinvanapp sigue en el `.env.production` — no es un resabio que haya que borrar, es el piso de
respaldo que sigue si se vacía `config` o se pierde `CONFIG_ENCRYPTION_KEY`.

**La lección, para no repetirla:** con dos fuentes de credenciales, leer una sola para diagnosticar
puede dar una respuesta coherente y falsa. Hay que leer `config` primero, siempre. Va al README como
sección nueva ("Hay dos fuentes de credenciales, y la de la base gana").

### El editor de funnels dejaba todo funnel nuevo desconectado

Armando un funnel de prueba de punta a punta para testear el cobro, el comprador quedaba en la
pantalla del checkout después de pagar en vez de pasar al primer upsell. La causa: `SelectorDestino`
—el control para elegir a dónde va cada rama— solo se ofrecía en los pasos de tipo upsell. El paso
`front` no lo tenía, así que su `paginas.paso_aceptado_id` quedaba en `NULL` siempre, sin que el panel
lo mostrara como un error.

Arreglado en la misma sesión: el selector ahora es genérico para toda rama, incluida la del front.
Queda anotado porque cualquier funnel armado antes de este arreglo tiene que revisarse a mano — el
bug no deja rastro visible en el panel, solo en el comportamiento después de pagar.

### Lo nuevo que se sumó de paso

No era el objetivo de la sesión, pero se hizo mientras se armaba el funnel de prueba:

- `/admin/tutorial`: 9 pasos con estado real (lee la base y Whop, no una checklist fija).
- Botón de copiar el snippet en cada paso del funnel.
- `/admin/alertas` ahora corre `getMe` + `getWebhookInfo` de Telegram y dice qué variable falta.
- `lib/rate-limit.ts`: se auditó y `POST /api/upsell/cobrar` no tenía ningún límite (a diferencia de
  `/api/checkout/sesion`, que tiene 20/min). Ahora tiene 10/min por IP, limitador propio.
- El token de orden quedó acotado al funnel de origen: una orden de un funnel no puede usarse para
  cobrar el upsell de otro.
- Botón de wallet (Apple Pay/Google Pay) en la pantalla de recuperación — relevante para el bloqueo
  de arriba, porque con el wallet el desafío 3DS lo resuelve el dispositivo, no un flujo off-session.

### Estado de los pendientes de siempre, reverificado

Nada de esto es nuevo, pero se volvió a medir para no arrastrar un dato viejo:

- **Webhook:** sigue sin registrarse en el dashboard de Whop. `select count(*) from whop_eventos` da
  **0**. Sigue sin poder crearse por API (`developer:manage_webhook` en `false`). El endpoint en sí
  está verificado end-to-end: firma válida con id nuevo da 200 y escribe la fila, el mismo id repetido
  da 200 `OK (duplicado)` sin escribir de nuevo, firma inválida da 400, y un `webhook-timestamp` de 10
  minutos atrás da 400 por la ventana anti-replay. Lo único que falta es el click en el dashboard.

### El arreglo del 400, medido con tráfico real

No hizo falta simularlo: la noche del cambio hubo dos compras reales del front y las dos
dispararon el upsell, una antes del deploy y una después.

| Hora | Release | Qué pasó |
|---|---|---|
| 01:27:38 | la vieja | `400 de Whop → fallido`. Venta perdida, sin salida para el comprador |
| 01:54:56 | — | deploy de `b288111` |
| 01:56:29 | la nueva | el cobro queda en **`requiere_tarjeta`** con el `failure_message` de Whop guardado |

El comprador de las 01:56 termina en el checkout del upsell, donde el 3DS sí se puede completar,
en vez de quedarse mirando un botón que no hizo nada.

**Un cobro que quedó `fallido` ANTES del arreglo no se recupera reintentando.** El log de las
01:30:24 lo muestra: `cobro 804adfad... ya existía (status=fallido), no se llama a Whop`. Es la
guarda de `esFinal()` que impide el doble cobro, y no se toca — el riesgo de cobrarle dos veces a
alguien supera el de perder un cobro de prueba. Si alguna vez hay que rescatar uno, el camino es
borrar la fila de `cobros` a mano (el índice único `(orden_id, pagina_id)` es lo que bloquea) y
solo si `whop_payment_id` está en NULL, que es la prueba de que Whop nunca creó el pago.

### Ineficiencia conocida y no arreglada

`/api/upsell/cobrar` crea un `checkout_configuration` para la recuperación y lo devuelve en
`sessionIdRecuperacion`, pero el loader redirige a `/pagos/<slug>?ot=…&r=1` sin pasarlo, y
`CheckoutContainer` crea otro al montar. O sea **dos sesiones de Whop por recuperación**; la
primera queda huérfana.

No se arregló a propósito. Son ~300 ms en el peor momento del funnel, no un fallo, y el camino de
recuperación es justo el que cambió esta noche (se le agregó el botón de wallet). Meter dos cambios
a la vez en el camino que ahora sostiene las ventas es cómo se rompe algo sin que nadie lo note.
Queda para una sesión que pueda probarlo con un comprador de verdad.
- **Telegram:** 0 de las 5 variables `TELEGRAM_*` están en `/srv/hilvapay/shared/.env.production`.
  Falta crear el bot con @BotFather. Los tres crons corren igual; el vigilante detecta y no tiene
  canal.
- **Apple Pay:** el archivo `.well-known` ya da 200 en producción. Falta registrar el dominio en el
  dashboard de Whop. Google Pay no necesita este paso.

### Tres cosas que aparecieron auditando y no estaban en la lista

**Dos de los cuatro productos apuntaban a planes de la cuenta vieja.** Rotar la cuenta desde
`/admin/conexion` no mueve los `whop_plan_id` de `productos`. Después de pasar a Atlas, "Chau
Hinchazón" y "Acelerador 7X" seguían apuntando a planes de `biz_Me8Lbiv174brtM`. Y era invisible:
`GET /plans/{id}` devuelve **200** para un plan de otra company, así que la pantalla los mostraba
idénticos a los buenos; lo único que cambiaba era que cobrar con ellos falla con el mismo 400
genérico que costó una hora diagnosticar esa noche.

Ahora `/admin/productos` tiene **Revisar los planes contra Whop**, que compara el `account.id` del
plan contra la company activa — el status HTTP no sirve para esto. Medido en producción: detecta los
dos malos, marca los dos buenos. Va detrás de un botón porque es una llamada por producto para un
dato que cambia cuando se rota la cuenta, o sea casi nunca. `indeterminado` (401/403/5xx/timeout) NO
cuenta como problema: un 401 significa "no pudimos preguntar", y tratarlo como error mandaría a
cambiar un `whop_plan_id` que está bien.

**Un test flaky abortaba uno de cada tres deploys.** `cripto.test.ts > un dato manipulado falla por
el tag de GCM` cambiaba el ÚLTIMO CARÁCTER del base64 del ciphertext. Los 23 bytes de 'secreto'
ocupan 31 caracteres base64url = 186 bits, así que **los últimos dos bits son padding**: cuando el
cambio de `A` a `B` caía ahí, los bytes decodificados quedaban iguales, GCM validaba bien —
correctamente — y el test fallaba. Intermitente porque el IV es aleatorio.

El código estaba bien y el test estaba mal, que es el peor reparto: manda a buscar el problema donde
no está. Ahora se invierte un byte con XOR sobre los datos decodificados, y se agregó el test que
recorre las 23 posiciones — la propiedad real de AES-GCM es que *cualquier* alteración invalida el
tag, y probarla en una sola dejaba 22 sin cubrir. 20 corridas seguidas, 0 fallos.

**El bot de Telegram se configura con un comando.** `scripts/configurar-telegram.sh` verifica el
token contra `getMe`, genera los secretos, lee el `chat_id` de `getUpdates`, registra el webhook y
escribe las variables (con `--produccion`, en la VPS con backup y recargando PM2). El `chat_id` se
pide ANTES del `setWebhook` y no es un orden arbitrario: con el webhook activo, Telegram entrega ahí
y `getUpdates` viene vacío para siempre.

### Qué queda pendiente y es de otro

1. **La respuesta de soporte de Whop sobre el 400 del cobro off-session.** Es lo que bloquea el
   lanzamiento del upsell one-click, no un bug de este código.

   > Todo el diagnóstico está en
   > [`tasks/checkout-whop/DIAGNOSTICO-ONE-CLICK.md`](tasks/checkout-whop/DIAGNOSTICO-ONE-CLICK.md):
   > las **siete hipótesis descartadas** con su medición, el análisis del script de KashPay
   > (que tiene la misma limitación con Whop y por eso lleva Stripe de respaldo), los ids
   > concretos para reproducirlo, y los cuatro caminos que quedan. Está escrito para que
   > alguien sin contexto del repo lo pueda retomar.

2. Registrar el webhook desde el dashboard (sección 3.4 de ESTADO) y crear el bot de Telegram (3.7,
   ahora con el script que hace todo salvo hablar con @BotFather).
3. Registrar el dominio para Apple Pay en el dashboard de Whop (3.11).
4. **Los dos productos que apuntan a planes de Sinvanapp.** O se recrean los planes en Atlas, o se
   vuelven a vincular desde `/admin/catalogo`, que solo ofrece planes de la cuenta activa. Mientras
   sigan así, cualquier funnel que los use no va a poder cobrar.
