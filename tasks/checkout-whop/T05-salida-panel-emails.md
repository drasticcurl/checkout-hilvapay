# T05 — La cola de salida: reportar la venta al `dashboard-admin` y mandar el email de entrega

- **Depende de:** T01 (`lib/tipos.ts`).
- **Bloquea:** nada.
- **Se puede correr en paralelo con:** T02, T03, T04.
- **Repo:** `~/Desktop/funnel/checkout/checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/api/cron/**`, `lib/salidas.ts`, `lib/email.ts`,
  `emails/**` y sus `.test.ts`. Nada más. **`vercel.json` lo escribió T01**: el cron ya está
  declarado, vos solo escribís la ruta a la que apunta.

Leé `00-PLAN-CHECKOUT-WHOP.md` completo, y en especial **D13** (por qué esto es una cola y no una
llamada dentro del webhook).

**Este task manda emails a compradores reales y postea a un panel que ya está en producción.** Los dos
efectos nacen apagados y hay una verificación que lo prueba.

---

## 1. Objetivo

Cuando termines:

- `GET /api/cron/salidas` drena la cola: por cada fila pendiente, postea el evento de compra al
  `/api/ingest` del `dashboard-admin` y manda el email de entrega.
- Sin `CRON_SECRET` correcto, devuelve 401.
- Una fila que falla no se pierde: queda con `intentos + 1`, el error, y un `proximo_intento_at` con
  backoff.
- El envío de emails arranca **apagado** desde la base, y hay una verificación que prueba que apagado
  no manda nada.

**Este task no escribe rutas de checkout, ni el panel, ni el loader.**

## 2. EL DATO VERIFICADO QUE NO PODÉS IGNORAR: el panel espera CENTAVOS

`dashboard-admin/lib/ingest/schema.ts` declara `value: z.number().int()` y
`dashboard-admin/lib/ingest/apply.ts` lo inserta en una columna llamada **`value_cents`**, tipo
`bigint`. O sea: **el `value` del evento va en centavos enteros**, y `cobros.monto` está en unidades
con dos decimales (`numeric(10,2)`, verificado en `_verificacion-checkout.sql` #11).

La conversión es `Math.round(Number(monto) * 100)`. **Con `Math.round`, no truncando.** Verificado en
node el 2026-09-10:

```
monto        monto * 100            Math.round     truncado (| 0)
9.90         990                    990            990
9.909        990.9000000000001      991            990        ← truncar pierde el redondeo
1234567.89   123456788.99999999     123456789      123456788  ← truncar PIERDE UN CENTAVO
```

Si usás `| 0`, `Math.floor`, `parseInt` o `~~`, los importes grandes entran al panel con un centavo
menos y las sumas del panel no van a cerrar contra Whop. Escribí un test con el caso `1234567.89`.

## 3. El contrato del `/api/ingest` del panel

**Leé `~/Desktop/funnel/dashboard-admin/lib/ingest/schema.ts` completo antes de escribir el payload.**
Es la fuente de verdad y está en otro repo: no lo modifiques ni asumas nada de él.

```
POST <PANEL_INGEST_URL>
Authorization: Bearer <PANEL_INGEST_KEY>
Content-Type: application/json

{
  "sessionId": "<uuid>",          // OBLIGATORIO y tiene que ser UUID
  "visitorId": "<uuid>",          // OBLIGATORIO y tiene que ser UUID
  "variant": "checkout-propio",
  "events": [{
    "name": "Purchase",
    "at": "<ISO 8601>",
    "value": 990,                 // CENTAVOS, entero
    "currency": "usd",
    "eventUid": "<whop_payment_id>",   // para que el panel deduplique
    "stepSlug": "<paginas.slug>"
  }],
  "context": { "path": "/pagos/<slug>" }
}

200 { ok: true, accepted: N, warnings: [] }
401 { ok: false, error: 'unauthorized' }      ← la ingest key está mal
400 { ok: false, error: 'invalid_payload' }   ← el payload no pasa su zod
413 { ok: false, error: 'too_large' }         ← más de 50 eventos o 64 KB
```

Reglas:

1. **Si la orden no tiene `session_id` o `visitor_id`, la fila de `salidas` NO se postea al panel: se
   marca como enviada con un motivo anotado.** El panel los exige como UUID y no se pueden inventar:
   un UUID falso crea una sesión fantasma que ensucia el embudo para siempre. Que la venta no aparezca
   en el panel es un problema; que aparezca atribuida a una sesión que no existió es peor, porque
   contamina los números con los que se decide gastar en ads. Esto es P-05 del plan.
2. **El `eventUid` es el `whop_payment_id`.** Es lo que hace que un reintento de la cola no duplique
   la venta del lado del panel.
3. **El panel responde 200 con `{ok:false}` para errores internos suyos.** No alcanza con mirar el
   status HTTP: hay que mirar `body.ok`. Si sos ingenuo con el status, una fila que el panel rechazó
   queda marcada como enviada.
4. **Un 401 del panel no se reintenta 50 veces.** Es una key mal configurada, no un problema
   transitorio: marcá la fila con el error y no la reintentes más de 3 veces.

## 4. `lib/salidas.ts`

```ts
/**
 * Toma hasta `limite` filas pendientes y vencidas, con `FOR UPDATE SKIP LOCKED`.
 *
 * SKIP LOCKED y no un lock normal: si dos invocaciones del cron se solapan —lo
 * que pasa de verdad durante un deploy—, la segunda saltea lo que la primera ya
 * tomó en vez de esperarla. Sin eso, dos crons mandan el mismo email dos veces.
 */
export async function tomarPendientes(limite: number): Promise<FilaSalida[]>;

/** Backoff exponencial con techo: 1, 2, 4, 8… minutos, máximo 1 hora. */
export function proximoIntento(intentos: number): Date;

/** Marca enviada. `motivo` queda en `ultimo_error` cuando se omitió a propósito. */
export async function marcarEnviada(id: string, motivo?: string): Promise<void>;

/** Suma un intento, guarda el error y programa el próximo. */
export async function marcarFallida(id: string, error: string): Promise<void>;
```

Reglas:

1. **`FOR UPDATE SKIP LOCKED` es obligatorio**, por lo del comentario. Es la exclusión mutua de la
   regla de tareas programadas: dos instancias en el mismo tick duplican cada acción.
2. **`proximoIntento` tiene techo.** Sin techo, a los 20 intentos el próximo cae dentro de un año y la
   fila queda muerta sin que nada lo diga.
3. **Después de 10 intentos, la fila se deja de reintentar** pero **no se borra**: queda con su error
   para que se pueda ver en el panel qué venta no llegó.

## 5. `lib/email.ts` y `emails/`

**Leé `~/Desktop/funnel/reset-app/emails/` y su uso de `resend` antes de escribir.** Copiá el patrón
de cliente y de plantilla; lo que **no** copiar es el contenido, que es de otro producto.

```ts
/**
 * Manda el email de entrega. Devuelve `{ enviado: false, motivo: 'apagado' }`
 * cuando el interruptor de la base está en false: NO tira, porque el cron tiene
 * que poder drenar la cola igual y marcar la fila.
 */
export async function mandarEmailDeEntrega(cobro: FilaCobroParaEmail):
  Promise<{ enviado: boolean; motivo?: string }>;
```

Reglas:

1. **El interruptor vive en la base, no en el env** (regla de defaults seguros del plan, D14). Creá la
   migración `db/migrations/002_config_email.sql` con una tabla `config` de una fila
   (`emails_activos boolean not null default false`) — es aditiva y no toca la 001. **Nunca un env
   var:** cambiarlo obliga a redeployar justo cuando querés frenar un envío que sale mal.
2. **Sin `RESEND_API_KEY`, `mandarEmailDeEntrega` devuelve `{enviado:false, motivo:'sin_api_key'}`.**
   No tira y no rompe el drenado.
3. **Idempotencia del email: `cobros.email_enviado_at`.** La columna ya existe en la 001. Si no es
   null, no se manda de nuevo. Es lo que evita que un reintento de la cola le mande cuatro emails a la
   misma persona.
4. **El email lleva el nombre real del producto** (`productos.nombre`), no el nombre soft de Whop. Es
   toda la razón de que el nombre viva en esta base (D10).
5. Plantilla en HTML con su versión en texto plano. Sin imágenes remotas obligatorias: si la imagen no
   carga, el email tiene que seguir siendo legible.

## 6. `GET /api/cron/salidas`

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

1. Autenticar: `Authorization: Bearer <CRON_SECRET>`, comparado en tiempo constante. Sin secret
   configurado → 401 (no "pasa igual").
2. `tomarPendientes(20)`.
3. Por cada fila: postear al panel, mandar el email, marcar. **Un error en una fila no aborta las
   otras**: `try/catch` por fila.
4. Devolver `{ tomadas, enviadas, fallidas, omitidas }`. Es lo que se mira para saber si la cola está
   sana.
5. **Timeout duro en el fetch al panel** (5 s). Sin timeout, un panel colgado hace que el cron consuma
   su presupuesto de tiempo con una sola fila y la cola nunca avance.

## 7. Tests

1. **`Math.round(Number('1234567.89') * 100) === 123456789`.** El test que fija la sección 2. Si
   alguien lo cambia por truncamiento, este test falla.
2. `proximoIntento`: 0 → +1 min; 3 → +8 min; 20 → +60 min (el techo), nunca más.
3. El armado del payload de ingest: con `session_id`/`visitor_id` presentes → payload completo; con
   alguno en `null` → **no se arma** y la función devuelve el motivo de omisión.
4. `mandarEmailDeEntrega` con el interruptor apagado → `{enviado:false, motivo:'apagado'}` y **cero
   llamadas al cliente de Resend** (mockealo y contá las llamadas).
5. Un cobro con `email_enviado_at` no null → no se manda.

## 8. Verificación

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay
npm run db:migrate && npx tsc --noEmit && npx next build && npx vitest --run
# esperado: exit 0, "✓ Compiled successfully", todos passed

# 2 — el cron rechaza sin secret
curl -s -o /dev/null -w '%{http_code}\n' localhost:3010/api/cron/salidas
# esperado exactamente: 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer mal" localhost:3010/api/cron/salidas
# esperado exactamente: 401

# 3 — EL ESTADO SEGURO: los emails nacen apagados
psql "$DATABASE_URL" -tAc "select emails_activos from config;"
# esperado exactamente: f

# 4 — PRUEBA DE QUE APAGADO NO MANDA NADA.
#     Encolá una salida a mano y drená la cola con los emails apagados.
psql "$DATABASE_URL" -c "insert into salidas (payload) values ('{\"motivo\":\"prueba\"}'::jsonb);"
curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:3010/api/cron/salidas | python3 -m json.tool
# esperado: tomadas = 1, y enviadas o omitidas = 1
# AHORA MIRÁ EL DASHBOARD DE RESEND: cero emails enviados en el período.
# Ese "cero" es la verificación: el interruptor apagado no manda nada.

# 5 — la cola es idempotente y no se pierde nada
psql "$DATABASE_URL" -tAc "select count(*) from salidas where enviado_at is null;"
# esperado exactamente: 0    (la fila de arriba quedó resuelta)
curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:3010/api/cron/salidas
# esperado: tomadas = 0   ← una segunda corrida no reprocesa lo enviado

# 6 — el backoff funciona: apuntá PANEL_INGEST_URL a algo que falle
PANEL_INGEST_URL=http://localhost:9999/nada npm run dev &
psql "$DATABASE_URL" -c "insert into salidas (payload) values ('{\"motivo\":\"falla\"}'::jsonb);"
curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:3010/api/cron/salidas
psql "$DATABASE_URL" -tAc "select intentos, ultimo_error is not null, proximo_intento_at > now() from salidas order by created_at desc limit 1;"
# esperado exactamente: 1|t|t    ← contó el intento, guardó el error, programó el próximo

# 7 — la conversión a centavos, sobre datos reales
psql "$DATABASE_URL" -tAc "select monto from cobros where monto is not null limit 1;"
# tomá ese valor y confirmá en el log del cron que el value enviado es monto*100 redondeado

# 8 — NO ROMPISTE EL PANEL. Antes y después de correr el cron contra el panel real:
psql "$PANEL_DATABASE_URL" -tAc "select count(*) from events;"
# esperado: la diferencia es EXACTAMENTE la cantidad de eventos que dijiste enviar,
# ni uno más. Si hay más, estás mandando eventos duplicados.

# 9 — NO rompiste lo que ya estaba
git diff --stat lib/estado-pago.ts lib/whop-webhook.ts lib/whop.ts lib/db.ts lib/cobros.ts \
                lib/tipos.ts app/api/webhooks/whop/route.ts db/migrations/001_init.sql
# esperado exactamente: sin salida  (la 002 es nueva, no cuenta)
```

## 9. Cuándo parar

**Bloqueante, pará y avisá:**

- **El panel devolvió 401.** La `PANEL_INGEST_KEY` no corresponde a ningún funnel. No la adivines y no
  toques el repo del panel: es P-04.
- **Con los emails apagados salió aunque sea un email.** Pará: el interruptor no funciona y este task
  puede mandarle correo a compradores reales.
- **El conteo de `events` del panel subió más de lo que enviaste.** Estás duplicando eventos en un
  sistema en producción.
- **Vercel está en plan Hobby y el cron no corre** (lo tendría que haber detectado T01). La cola se
  acumula en silencio: hace falta otra forma de drenarla.

**Anotalo en §10 del plan y seguí:**

- Si se decide apagar los emails transaccionales de Whop o dejar los dos (P-03).
- Con qué funnel se reporta al panel (P-04).
- Cuántas ventas se omitieron por no tener `session_id` (regla 1 de la sección 3): es el número que
  dice cuánto cuesta no resolver P-05.
- **Necesitás modificar un archivo ajeno** → nunca. Anotalo. En particular: **no toques nada de
  `dashboard-admin`.**
