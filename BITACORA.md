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
