# T04 — El cobro one-click de los upsells, el polling, y el `loader.js` que embeben los funnels

- **Depende de:** T01 (`lib/tipos.ts`).
- **Bloquea:** T06 (el funnel llama a este endpoint y embebe este script).
- **Se puede correr en paralelo con:** T02, T03, T05.
- **Repo:** `~/Desktop/funnel/checkout/checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/api/upsell/**`, `app/api/cobros/**`,
  `app/loader.js/route.ts`, `lib/cors.ts`, `lib/token.ts` y sus `.test.ts`. Nada más.

Leé `00-PLAN-CHECKOUT-WHOP.md` completo. Tus contratos son el **§5** (la API del cobro) y el **§6**
(el `loader.js`). **Los dos están congelados y son públicos**: una vez que un funnel embebe este
script, cambiar la forma obliga a redeployar el funnel.

**Este es el task que cobra plata.** Todo lo demás del módulo puede fallar y no cuesta nada; acá un
error cobra dos veces o le cobra a la persona equivocada.

---

## 1. Objetivo

Cuando termines:

- `POST /api/upsell/cobrar` cobra la tarjeta guardada de una orden y devuelve `RespuestaCobro`.
- Dos POST simultáneos con el mismo token y slug producen **un solo** `whop_payment_id`.
- `GET /api/cobros/[id]` devuelve el estado, consultando a Whop si todavía no está resuelto.
- `GET /loader.js` sirve el script que los funnels embeben, con `window.hilvana` funcionando.
- Un origen que no está en `origenes` recibe 403 y el navegador ni le deja leer la respuesta.

**Este task no escribe la página de checkout, ni el panel, ni el cron, ni toca `testfunnel`.**

## 2. `lib/token.ts`

```ts
/** 32 bytes de crypto.randomBytes en base64url. NO uuid, NO Math.random. */
export function generarToken(): string;

/**
 * Busca la orden por token y valida el vencimiento.
 *
 * Devuelve un motivo discriminado y no `null`: el endpoint necesita distinguir
 * "token que nunca existió" de "token vencido" para dar 401 con un mensaje que
 * le sirva al comprador ("volvé a empezar la compra") en vez de un genérico.
 */
export async function resolverToken(
  token: unknown,
): Promise<{ ok: true; orden: Orden } | { ok: false; motivo: 'invalido' | 'vencido' }>;
```

**El token se compara por igualdad en SQL**, que es lo que hace el índice único. No hace falta
comparación en tiempo constante: no se está validando un secreto contra otro secreto, se está buscando
una fila por una clave de 256 bits de entropía.

## 3. `lib/cors.ts`

```ts
/**
 * Resuelve los headers de CORS para un origen. Devuelve `null` si el origen no
 * está activo en `origenes`: el caller responde 403 SIN headers de CORS, con lo
 * cual el navegador tampoco le deja leer el cuerpo del error.
 *
 * NUNCA devolvés `*`. Con `*` cualquier página del mundo puede postear el token
 * de una orden si logra leerlo, y el token habilita cobrar una tarjeta.
 */
export async function headersCors(origen: string | null): Promise<Record<string, string> | null>;
```

Reglas:

1. **`Access-Control-Allow-Origin` devuelve el origen exacto que vino**, no una lista. Un header con
   varios valores no es válido y los navegadores lo rechazan entero.
2. **Hace falta el handler `OPTIONS`** en las dos rutas, con `Access-Control-Max-Age`. Sin el
   preflight, el POST con `Content-Type: application/json` nunca sale del navegador y el botón del
   funnel no hace absolutamente nada, sin ningún error visible en la pestaña del checkout.
3. **La comparación de orígenes es exacta**, sin `startsWith` ni subdominios implícitos.
   `https://mifunnel.com` y `https://mifunnel.com.evil.io` no son lo mismo, y `startsWith` los
   confunde.
4. Cacheá la consulta a `origenes` en memoria por 60 segundos. Cada cobro hace un preflight más un
   POST: son dos consultas por click a una tabla de cinco filas.

## 4. `POST /api/upsell/cobrar` — el corazón

La forma está en el §5 del plan y es un contrato. El orden de los pasos **no es negociable**:

1. **CORS**: resolver el origen. Si no está autorizado → 403 sin headers de CORS.
2. **Token**: `resolverToken`. Inválido → 401 `token_invalido`; vencido → 401 `token_vencido`.
3. **Página**: buscar por slug, activa, con su producto. No existe o inactiva → 404.
4. **Método guardado**: si `!orden.metodo_guardado` → 409 `sin_metodo_guardado` con
   `pedirTarjeta: true` y un `sessionIdRecuperacion` recién creado. Esa persona pagó con algo que no
   se puede guardar y no es un error.
5. **INSERT del cobro con `ON CONFLICT (orden_id, pagina_id) DO NOTHING`.** Si no insertó, leer el
   cobro existente y **devolverlo sin llamar a Whop**. Esto es D1 y este orden es lo único que evita
   el doble cobro real.
6. **Llamar a `crearPagoOffSession`** con `idempotencyKey = \`${orden.id}:${pagina.id}\``.
7. Guardar `whop_payment_id` y el estado que devuelva `mapearEstado`.
8. Devolver `RespuestaCobro`.

El manejo de errores de Whop, por caso:

| Qué pasó | Qué se hace |
|---|---|
| `WhopError.indeterminado` (409) | **NO reintentar con clave nueva.** El cobro pudo salir. Dejar el cobro en `procesando` y que el polling lo resuelva. |
| `WhopError.reintentable` (5xx, 429) | Un reintento con **la misma** clave, y si vuelve a fallar, `procesando`. |
| Cualquier otro 4xx | Cobro a `fallido` con el `message` en `failure_message`. |
| Timeout / red (503 sintético) | Cobro en `procesando`. **Nunca `fallido`**: el request pudo llegar y el cobro pudo salir. |

**La regla que resume todo eso:** ante la duda, `procesando`, nunca `fallido`. Un cobro marcado
fallido que en realidad entró le niega el producto a alguien que pagó, y no hay forma de detectarlo
salvo que la persona reclame.

Reglas adicionales:

1. **El body no acepta ni precio ni `plan_id`.** Los dos salen de la base por el slug. Si el importe
   viniera del cliente, cualquiera con el token se cobraría un dólar.
2. **Verificá que la página del slug no sea `tipo: 'front'`.** Cobrar el front por esta vía saltearía
   el consentimiento del titular: el front es el cobro on-session donde se acepta guardar la tarjeta.
   → 404.
3. **Logueá el `orden_id` en cada línea.** Es lo que permite rastrear una venta puntual entre miles.

## 5. `GET /api/cobros/[id]`

1. Si el cobro ya está en un estado final (`esFinal()` de `lib/estado-pago.ts`), devolverlo sin
   llamar a Whop.
2. Si no, y tiene `whop_payment_id`: `obtenerPago()` y `aplicarEstadoDePago()` de `lib/cobros.ts`
   —**que ya existe y es monótona e idempotente, no la reimplementes**.
3. Si cambió a `pagado`, encolar la salida con `encolarSalida()`.

**Este endpoint es público y recibe un uuid.** No expone nada sensible (estado, monto, mensaje), pero
**no devuelvas `decline_code` crudo**: usá `mensajeParaComprador()` de `lib/estado-pago.ts`. Contarle
a quien prueba tarjetas que el banco detectó fraude es regalarle información.

## 6. `app/loader.js/route.ts`

Un route handler que devuelve JavaScript, no un archivo en `public/`: así el script sabe cuál es su
propio origen desde el server y no hay que hardcodear el dominio en dos lugares.

```
Content-Type: application/javascript; charset=utf-8
Cache-Control: public, max-age=300
Access-Control-Allow-Origin: *      ← solo para el GET del script. El POST del cobro NO es *.
```

La superficie está en el §6 del plan. El comportamiento:

1. Al cargar: leer `?ot=` de la URL, y si está, guardarlo en `sessionStorage` bajo una clave propia.
   Si no está, usar el que ya haya en `sessionStorage`.
2. Enganchar los click de todo elemento con `[data-hilvana-upsell]`, y exponer `window.hilvana`.
3. En `aceptarUpsell(slug)`: si ya hay un cobro en curso, salir. Deshabilitar visualmente el botón,
   postear, hacer polling cada 1000 ms hasta 15 intentos, y actuar según el estado.
4. **A los 15 intentos sin resolverse: avanzar igual a `siguienteUrl`** y mostrar "estamos confirmando
   tu pago". El webhook lo va a resolver. Dejar a alguien mirando un spinner infinito después de que
   le cobraste es peor que avanzar.
5. Con `pedirTarjeta: true`: redirigir a `/pagos/<slug>?ot=<token>&r=1` en el dominio del checkout.
   Esa página la sirve T03 y muestra el embed con el email precargado. **Es un pago nuevo, no la
   continuación del anterior (D3).**

Reglas:

1. **`sessionStorage`, nunca `localStorage`** (§6 regla 1 del plan: el token no puede sobrevivir al
   cierre del browser en una computadora compartida).
2. **El script no puede tirar una excepción no capturada, nunca.** Corre en la página de un funnel que
   factura: un error de JS puede romper el resto del JS de esa página, incluido el pixel. Envolvé todo
   en try/catch y en el peor caso navegá a `url_rechazo` o no hagas nada.
3. **Sin token: no rompas.** Logueá y navegá a la `url_rechazo` que devuelva el server, o quedate.
   Alguien pudo llegar por un link directo sin haber comprado.
4. **El script no manda tracking.** Eso es del funnel.
5. **Vanilla JS, sin dependencias, sin transpilar.** Se escribe como string en el route handler o
   como un archivo aparte que se lee y se sirve. Es la única pieza de este repo que corre en un
   dominio ajeno: menos código, menos superficie.

## 7. Tests

`lib/token.test.ts` y `lib/cors.test.ts`, lógica pura:

1. **`generarToken`**: 43 caracteres, solo `[A-Za-z0-9_-]`, y 1000 llamadas dan 1000 valores
   distintos.
2. **`resolverToken`** con: token que no existe → `invalido`; token con `token_expira_at` en el pasado
   → `vencido`; token válido → `ok`. Y con `null`, `123`, `{}` y un string de 10 000 caracteres →
   `invalido` sin tirar.
3. **`headersCors`**: origen activo → devuelve el origen exacto; origen inactivo → `null`; origen que
   no está → `null`; `https://mifunnel.com.evil.io` cuando está autorizado `https://mifunnel.com` →
   `null` (el caso de `startsWith`); `null` de origen → `null`.
4. **El mapeo de error de Whop a estado**: una tabla de casos con `WhopError` de 409, 500, 429, 400 y
   503 → el estado esperado de la tabla de la sección 4. **Ninguno de los cinco puede dar `fallido`
   salvo el 400.**

## 8. Verificación

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay
npx tsc --noEmit && npx next build && npx vitest --run
# esperado: exit 0, "✓ Compiled successfully", todos passed

# 2 — SEED: una orden con método guardado, sin depender de T03
psql "$DATABASE_URL" <<'SQL'
insert into productos (id, nombre, whop_plan_id, precio, moneda, activo) values
  ('aaaaaaaa-0000-0000-0000-000000000002','Acelerador 7X','plan_SANDBOX_UP1',27.00,'usd',true)
  on conflict (whop_plan_id) do nothing;
insert into paginas (id, slug, producto_id, tipo, url_exito, url_rechazo, activo) values
  ('bbbbbbbb-0000-0000-0000-000000000002','aguadearroz2','aaaaaaaa-0000-0000-0000-000000000002',
   'upsell','https://example.com/upsell2-latam','https://example.com/upsell2-latam',true)
  on conflict (slug) do nothing;
insert into origenes (origen, nombre, activo) values ('http://localhost:3000','test local',true)
  on conflict (origen) do nothing;
-- La orden: member y payment method REALES de sandbox, salidos de una compra de prueba.
insert into ordenes (id, pagina_id, email, token, token_expira_at,
                     whop_member_id, whop_payment_method_id, metodo_guardado) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','test@test.com',
   'TOKEN_DE_PRUEBA_1234567890', now() + interval '2 hours',
   'mber_SANDBOX', 'payt_SANDBOX', true)
  on conflict (token) do nothing;
SQL

npm run dev &

# 3 — un origen no autorizado no cobra
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3010/api/upsell/cobrar \
  -H 'Content-Type: application/json' -H 'Origin: https://sitio-cualquiera.com' \
  -d '{"token":"TOKEN_DE_PRUEBA_1234567890","slug":"aguadearroz2"}'
# esperado exactamente: 403

# 4 — el preflight responde
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS localhost:3010/api/upsell/cobrar \
  -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST'
# esperado: 204 o 200, y con el header Access-Control-Allow-Origin: http://localhost:3000
curl -s -D- -o /dev/null -X OPTIONS localhost:3010/api/upsell/cobrar \
  -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST' | grep -i allow-origin
# esperado exactamente: access-control-allow-origin: http://localhost:3000   (NO '*')

# 5 — token inválido y vencido
curl -s -X POST localhost:3010/api/upsell/cobrar -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' -d '{"token":"no-existe","slug":"aguadearroz2"}' -w '\n%{http_code}\n'
# esperado: {"error":"token_invalido"} y 401

# 6 — cobrar el front por esta vía se rechaza
curl -s -X POST localhost:3010/api/upsell/cobrar -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -d '{"token":"TOKEN_DE_PRUEBA_1234567890","slug":"aguadearroz1"}' -w '\n%{http_code}\n'
# esperado: 404   ← es tipo 'front'

# 7 — EL DOBLE COBRO. Es la verificación más importante de todo el módulo.
for i in 1 2 3 4 5; do
  curl -s -X POST localhost:3010/api/upsell/cobrar -H 'Content-Type: application/json' \
    -H 'Origin: http://localhost:3000' \
    -d '{"token":"TOKEN_DE_PRUEBA_1234567890","slug":"aguadearroz2"}' &
done; wait

psql "$DATABASE_URL" -tAc "select count(*) from cobros where orden_id='cccccccc-0000-0000-0000-000000000001';"
# esperado exactamente: 1
psql "$DATABASE_URL" -tAc "select count(distinct whop_payment_id) from cobros where orden_id='cccccccc-0000-0000-0000-000000000001' and whop_payment_id is not null;"
# esperado exactamente: 1   (o 0 si los plan_id son falsos y Whop rechazó)
# Y EN EL DASHBOARD DE WHOP (sandbox): UN solo pago. Miralo con los ojos.

# 8 — el polling
curl -s localhost:3010/api/cobros/<el-id-del-cobro> | python3 -m json.tool
# esperado: los campos de RespuestaCobro, y NINGUNA aparición de "decline_code"
curl -s localhost:3010/api/cobros/<id> | grep -c decline_code
# esperado exactamente: 0

# 9 — el loader se sirve y es JS válido
curl -s -D- -o /tmp/loader.js localhost:3010/loader.js | grep -iE 'content-type|allow-origin'
# esperado: content-type: application/javascript...  y  access-control-allow-origin: *
node --check /tmp/loader.js && echo "JS VALIDO"
# esperado exactamente: JS VALIDO
grep -c localStorage /tmp/loader.js
# esperado exactamente: 0   ← §6 regla 1: sessionStorage, nunca localStorage

# 10 — NO rompiste lo que ya estaba
git diff --stat lib/estado-pago.ts lib/whop-webhook.ts lib/whop.ts lib/db.ts lib/cobros.ts \
                lib/tipos.ts app/api/webhooks/whop/route.ts db/migrations/
# esperado exactamente: sin salida

# 11 — EN EL BROWSER. Armá un HTML mínimo en localhost:3000 con el script y un botón:
#   <script src="http://localhost:3010/loader.js"></script>
#   <button data-hilvana-upsell="aguadearroz2">SÍ, LO QUIERO</button>
#   y entrá con ?ot=TOKEN_DE_PRUEBA_1234567890
#  - un click cobra y redirige
#  - CINCO clicks rápidos: un solo cobro
#  - sin ?ot= en la URL: el botón no tira error en consola
#  - con el token vencido: mensaje claro, no un error crudo
```

## 9. Cuándo parar

**Bloqueante, pará y avisá:**

- **Los 5 POST concurrentes produjeron más de un `whop_payment_id`.** No sigas: es el bug que este
  módulo existe para no tener. Revisá que el INSERT con `ON CONFLICT` esté **antes** de la llamada a
  Whop.
- **Un `Access-Control-Allow-Origin: *` quedó en el endpoint de cobro.** Es el otro bug que cuesta
  plata.
- Whop devuelve 403 al cobrar: faltan permisos en la API key (son 22).
- Whop devuelve 400 diciendo que la `Idempotency-Key` ya se usó con otro body: el body no es
  determinístico. Sacale lo que varía.

**Anotalo en §10 del plan y seguí:**

- El `decline_code` que devuelva sandbox para cada tarjeta de prueba, y si `clasificarDecline` lo
  clasificó como esperabas. Es información valiosa que hoy no tenemos de la API real.
- **Necesitás modificar un archivo ajeno** → nunca. Anotalo.
