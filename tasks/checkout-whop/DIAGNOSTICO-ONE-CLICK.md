# El cobro one-click de un upsell contra Whop: todo lo que se probó

**Estado: cerrado del lado nuestro. El bloqueo es de Whop.** Última medición
2026-09-11, después de agotar diez hipótesis.

**La conclusión, arriba porque es lo único que hay que leer si no vas a leer el
resto:** `POST /payments` con una tarjeta guardada devuelve `400` genérico en
**dos cuentas de Whop independientes**, en tres versiones de API, con los permisos
confirmados como concedidos por la propia API de Whop, y sin un solo
`payments#create` exitoso en la historia de ninguna de las dos cuentas. No es el
payload, ni la versión, ni los permisos, ni el plan, ni la tarjeta, ni el webhook,
ni la cuenta. **No hay nada más que ajustar de este lado.**

Lo que sí funciona hoy, y está en producción: el botón de wallet
(`data-hilvana-wallet`), que cobra on-session en un toque con Apple Pay, Google
Pay o tarjeta. Ver §11.

Este documento es autosuficiente a propósito: se escribió para que alguien sin
contexto del repo —otra persona, otro modelo— pueda leerlo y proponer algo que no
se haya intentado. Cada afirmación viene con el comando que la respalda o con la
respuesta cruda de la API.

---

## 1. Qué se quiere lograr

Un funnel de ventas con un producto de entrada ("front", US$ 1) y upsells
posteriores (US$ 2). El comprador paga el front en una página de checkout propia
que embebe el checkout de Whop. Después, en la página del upsell —que vive en
**otro dominio**, el del funnel— tiene que poder apretar **un botón y que se le
cobre**, sin reingresar la tarjeta, sin una pantalla intermedia y sin ninguna
confirmación adicional.

Eso es lo que la industria llama one-click upsell, y es la razón de ser del
módulo: es donde está el margen del funnel.

**El requisito es un solo click en un solo botón.** Un segundo botón (Apple Pay,
por ejemplo) no cumple: parte la atención justo en el momento de decisión.

---

## 2. La arquitectura actual

```
pay.hilvanapp.com          → el checkout propio (Next.js 14, Postgres, PM2)
ritual.hilvanapp.org       → el funnel (otro repo, otro deploy)
```

1. El comprador entra a `pay.hilvanapp.com/pagos/front`.
2. Paga con el embed de Whop (`WhopCheckoutEmbed`), que va con
   `setupFutureUsage="off_session"` para que Whop guarde la tarjeta.
3. El server registra la orden y genera un token de 256 bits.
4. Redirige al funnel: `ritual.hilvanapp.org/upsell-latam?ot=<token>`.
5. En el funnel hay un `loader.js` servido por nuestro dominio. Lee el `?ot=` y lo
   guarda en `sessionStorage`.
6. El botón del upsell lleva `data-hilvana-upsell="<slug>"`. Al hacer click, el
   loader postea a `pay.hilvanapp.com/api/upsell/cobrar` con `{token, slug}`.
7. Ese endpoint resuelve la orden por token, lee de la base qué plan corresponde a
   ese slug, y llama a `POST /payments` de Whop con la tarjeta guardada.

**El paso 7 es el que falla.**

---

## 3. El error, exacto

```
POST https://api.whop.com/api/v1/payments
Authorization: Bearer <account api key>
Api-Version-Date: 2026-08-21-1
Idempotency-Key: <orden_id>:<pagina_id>

{
  "account_id":        "biz_LHktpJ17c83CFt",
  "plan_id":           "plan_7ToMQEt8zlUmK",
  "member_id":         "mber_YNRAcZdvq6KEd",
  "payment_method_id": "payt_zhLRLKvNIrwVB"
}
```

Respuesta:

```
400 Bad Request
{"error":{"type":"bad_request",
          "message":"We could not process this payment request right now. Please try again later."}}
```

Sin `decline_code`. Sin `code`. Sin `param`. **Y sin crear ningún objeto Payment**
— verificado con `GET /payments?account_id=...`: el último pago sigue siendo el del
front.

Es reproducible: falló en todos los intentos, a lo largo de dos días, con tres
compradores distintos y cuatro tarjetas distintas.

---

## 4. Las siete hipótesis descartadas, con su medición

### 4.1 El payload está mal formado — DESCARTADA

Coincide campo por campo con la doc oficial
(`docs.whop.com/developer/guides/save-payment-methods`, sección "Charge a saved
payment method"). El soporte de Whop lo confirmó por escrito.

Prueba adicional: omitir `payment_method_id` devuelve un error **específico**, o
sea que el endpoint entiende el request:

```
{"error":{"type":"invalid_request_error","code":"parameter_missing",
          "message":"payment_method_id is required unless confirmation_token is provided"}}
```

### 4.2 Alguno de los cuatro IDs es inválido — DESCARTADA

Con IDs inventados el endpoint devuelve **404 específicos**, nombrando cuál falla:

| payload | respuesta |
|---|---|
| `plan_id` falso | `404 {"type":"not_found","message":"This Plan was not found"}` |
| `member_id` falso | `404 {"type":"not_found","message":"This Member was not found"}` |
| `payment_method_id` falso | `404 {"type":"not_found","message":"This PaymentToken was not found"}` |
| sin `account_id` | `400 {"code":"parameter_missing","param":"company_id"}` |

Con los IDs reales **no devuelve ninguno de esos**. Los cuatro existen y son de la
company correcta.

### 4.3 Falta un permiso (scope) en la API key — DESCARTADA

La doc de `POST /payments` lista 13 permisos requeridos. Se probaron 12 scopes
contra sus endpoints de lectura: **11 dan 200.** El único que falta
(`developer:manage_webhook`) devuelve un **403 nombrando el scope**:

```
403 {"type":"forbidden",
     "message":"Company API key is not authorized for the developer:manage_webhook scope"}
```

O sea: cuando falta un permiso, Whop lo dice explícitamente y con 403. Nuestro
error es 400 y genérico. No es un permiso.

### 4.4 La company del plan no es la de la API key — DESCARTADA

Un error real en el camino: dos de los cuatro productos del panel apuntaban a
planes de una company vieja. **Pero no es el caso de los planes en uso.**

```
API key       → biz_LHktpJ17c83CFt  (v5/company)
plan del front→ biz_LHktpJ17c83CFt  (account.id del plan)
plan del upsell→ biz_LHktpJ17c83CFt
member        → biz_LHktpJ17c83CFt  (account_id del member)
```

Nota útil: `GET /plans/{id}` devuelve **200 para un plan de otra company**, así que
el status HTTP no sirve para detectar este problema. Hay que comparar `account.id`.

### 4.5 Es el plan del upsell — DESCARTADA

El mismo cobro off-session con el plan del **front** —el que acababa de cobrar
exitosamente con esa misma tarjeta, interactivamente— **también devuelve 400.**

También se probó con `plan` inline en vez de `plan_id`. Ese camino avanza más y
falla distinto, lo que prueba que el endpoint procesa el request:

```
plan inline sin currency  → 400 "Missing required parameter: plan.currency"
plan inline one_time      → 400 "Failed to create dynamic plan: The billing period
                                 cannot be zero if the plan is a renewal"
plan inline renewal 30d   → 400 "We could not process this payment request..."  ← el genérico
```

La última llegó a **crear el plan** y falló igual. El bloqueo no está en el plan:
está en el cobro.

### 4.6 Es el tipo de tarjeta / token de wallet — DESCARTADA

Se probó con los dos tipos y fallan igual.

Token de Apple Pay (DPAN atado al dispositivo — sin `fingerprint` ni expiración):

```
payt_6LXxXQSekTbrs
  card: { brand: mastercard, last4: 3324,
          fingerprint: null, exp_month: null, exp_year: null,
          three_ds_verified: false }
```

Tarjeta tipeada (con `fingerprint` y expiración):

```
payt_7726P8Pel8cYz
  card: { brand: visa, last4: 0170,
          fingerprint: "ce51f7cc-799b-4db1-a2f8-0ad0859bb4d6",
          exp_month: 9, exp_year: 2027 }
```

Los dos → 400.

(Dato aparte que igual conviene saber: un token de wallet **estructuralmente** no
sirve para MIT, porque el DPAN requiere autenticación biométrica en cada
transacción. Así que aunque el off-session se destrabe, el front conviene cobrarlo
con tarjeta.)

### 4.7 Falta el mandato 3DS / MIT — DESCARTADA

Esta parecía la respuesta y no lo era.

`three_ds_level` acepta `frictionless`, `mandate_challenge` y `null`
(documentado en el endpoint de checkout configurations). Se mandaba `frictionless`
en el front, que le pide a Whop **evitar** el desafío. La hipótesis era que sin
desafío no se creaba el mandato.

Se puso `mandate_challenge` en el plan del front (`PATCH /plans/{id}`, verificado
releyendo el plan) y se hizo una compra real:

```
pay_MMymbvsNZ1JeGP  (2026-09-11 10:36)
  three_ds_verified: true        ← el desafío SÍ ocurrió (frictionless, invisible)
  risk_score: 85
  payment_method: payt_zhLRLKvNIrwVB
    card: { last4: 8797, exp_month: 9, exp_year: 2027, three_ds_verified: true }
```

Cobro off-session contra **esa** tarjeta, autenticada y con mandato → **400, el
mismo.**

Dos cosas que sí quedaron aprendidas:

- El `three_ds_level` de la **checkout configuration** NO se persiste: Whop lo
  acepta con 200 y devuelve `null`, tanto en el POST como al releerla con GET. En
  el **plan** sí se guarda.
- Y como `null` en la configuration significa "usar el default de la cuenta", **la
  configuration pisa al plan**. O sea que el `mandate_challenge` del plan no llega
  a aplicarse cuando el checkout se monta desde una configuration.
- No se encontró forma de setear el nivel a nivel cuenta:
  `PATCH /companies/{id}` con `three_ds_level` devuelve
  `400 parameter_invalid` con cualquier valor, incluido `null`.

---

## 5. Lo que quedaba vivo — LAS DOS DESCARTADAS EL 2026-09-11

> **Las dos hipótesis de esta sección están muertas.** Se probaron cambiando de
> cuenta entera: ver §10.3. Se deja el texto porque el dato del `risk_score` sigue
> siendo cierto y útil para entender el comportamiento del motor de riesgo.

### 5.1 `risk_score: 85`

Whop lo documenta como *"Whop's in-house fraud risk score for this payment, from 0
(lowest risk) to 100 (highest risk)"*. Los pagos del front midieron **70, 70 y
85**. Es alto.

Es plausible que su motor de riesgo bloquee cobros sin el titular presente por
encima de un umbral. **No está documentado en ninguna parte** y no hay forma de
consultarlo ni de pedir una excepción por API.

### 5.2 La company no está verificada

```
GET /companies/biz_LHktpJ17c83CFt
{ "id": "biz_LHktpJ17c83CFt", "title": "Atlas & Co.", "verified": false, ... }
```

Tampoco está documentado que la verificación sea requisito para cobros
off-session. Es la hipótesis más barata de probar: verificar la company en el
dashboard no cuesta nada.

---

## 6. Qué dice el soporte de Whop

Se les preguntó explícitamente por el mandato MIT y por el gating por company
verificada. Respuesta textual:

> The docs don't spell out an internal "MIT mandate" mechanic or
> company-verification requirement for off-session charges — that level of detail
> (why this specific 400 fires with no decline_code) isn't in the documentation I
> have access to.
>
> Your payload matches the documented flow exactly (Charge a saved payment
> method): account_id, plan_id, member_id, payment_method_id on POST /payments.
>
> confirmation_token is documented as the alternative path for charging a method
> not yet on file (buyer just supplied it) — it's used instead of
> member_id/payment_method_id, not required when you already have a saved
> payment_method_id. So that's not your fix here.
>
> Since the docs don't expose the internal reasoning behind this specific generic
> 400 (no error.code, no decline_code), this is something only Whop
> support/engineering can diagnose from their logs.

O sea: descartan `confirmation_token`, confirman que el payload es correcto, y
derivan a que miren sus logs internos.

---

## 7. Cómo lo hace KashPay (el proveedor que se está reemplazando)

Esto importa porque KashPay **sí** hacía el one-click sobre la misma cuenta de Whop,
así que su implementación es la mejor pista disponible. Su script del lado del
cliente es público y se analizó completo:

```
https://pay.hilvanapp.online/scripts/upsell-processor.js   (53 978 bytes, sin minificar)
```

### 7.1 Su arquitectura

El browser no cobra: llama a funciones de Supabase Edge que hacen el trabajo
server-side.

```js
// dos proveedores, dos funciones distintas
provider: functionName === 'create-whop-upsell-charge' ? 'whop' : 'stripe'
```

- `create-whop-upsell-charge` → el camino de Whop
- `upsell-process` → el camino de Stripe

### 7.2 Intenta Whop primero, y cae a Stripe

```js
const whopResult = await callUpsellEndpoint(supabaseUrl, 'create-whop-upsell-charge', ...);

if (whopResult.response.status === 409 && whopResult.data.provider === 'stripe') {
  postUpsellEvent(supabaseUrl, 'upsell_browser_provider_fallback_to_stripe', {...});
  return callUpsellEndpoint(supabaseUrl, 'upsell-process', ...);   // ← Stripe
}
```

### 7.3 El 3DS lo resuelve SOLO con Stripe

```js
if (result.data.requiresAction) {
  if (result.data.provider !== 'stripe' ||
      !result.data.clientSecret ||
      !result.data.publishableKey ||
      !result.data.paymentIntentId) {
    throw new Error('A autenticação...');     // ← con Whop, muere acá
  }
  const stripe = Stripe(result.data.publishableKey);
  const confirmation = await stripe.confirmCardPayment(result.data.clientSecret);
}
```

**Con `provider: 'whop'` y `requiresAction`, KashPay tira una excepción.** No puede
resolverlo. Solo con Stripe hace `confirmCardPayment`.

### 7.4 Con Whop, cuando queda pendiente, se rinde

```js
async function resolveWhopPendingPayment(...) {
  const maxPolls = 6;
  for (let attempt = 0; attempt <= maxPolls; attempt += 1) {
    if (!result.data.pending) return result;          // se resolvió
    if (attempt >= maxPolls) {
      showDeclined(content, lang, ..., {
        canRetry: false, pending: true,
        message: lang.whopPendingMessage              // ← se rinde
      });
      return null;
    }
    await waitForWhopPendingRetry(1000);
    result = await callUpsellEndpoint(..., 'create-whop-upsell-charge', ..., {
      method: 'POST',
      body: { phase: 'resolve_redirect', transaction_id: boundTransactionId }
    });
  }
}
```

Seis polls de 1 segundo. Si a los 6 sigue pendiente, muestra este mensaje y deja
continuar sin cobrar:

> `whopPendingMessage: 'Este cobro todavia esta siendo procesado. Tu pedido
> principal sigue confirmado; puedes continuar al siguiente paso.'`

Un comentario de su propio código sobre esa fase:

```js
// Reuse the exact bound transaction in the read-only redirect phase.
// The server may reconcile an existing pending payment, but it can never
// claim a failed row or issue a new provider POST from this poll.
```

### 7.5 Y siempre termina en un redirect

```js
if (data.redirectUrl) {
  showSuccess(content, lang, data.redirectUrl);
} else {
  throw new Error('URL de redirecionamento não encontrada');
}
```

También maneja un flag `checkout_redirect`, o sea que su backend también tiene el
camino de "no pude cobrar, andá al checkout".

### 7.6 Qué se puede concluir, y qué no

**Se puede concluir** que KashPay tiene la misma limitación con Whop: no puede
resolver una autenticación, y cuando el cobro queda pendiente se rinde con un
mensaje. Lo que tiene y nosotros no es **Stripe como segundo procesador**.

**No se puede concluir** cuál es el payload exacto que su backend manda a Whop:
esa parte es server-side en Supabase y no es pública. **Si alguien puede
averiguarlo, ahí puede estar la respuesta.** Es lo único de esta lista que sigue
siendo una incógnita real y no una hipótesis descartada.

---

## 8. Datos concretos para reproducir

```
company             biz_LHktpJ17c83CFt   ("Atlas & Co.", verified: false)
plan del front      plan_LHZoqVmWkYbuO   ($1,  one_time, three_ds_level: mandate_challenge)
plan del upsell     plan_7ToMQEt8zlUmK   ($2,  one_time, three_ds_level: null)
api version         2026-08-21-1
base                https://api.whop.com/api/v1

la última compra del front, exitosa:
  pay_MMymbvsNZ1JeGP   $1   paid/succeeded   three_ds_verified: true   risk_score: 85
  member               mber_YNRAcZdvq6KEd
  payment_method       payt_zhLRLKvNIrwVB   (visa 8797, exp 9/2027, three_ds_verified: true)

el cobro que falla:
  POST /payments {account_id, plan_id: plan_7ToMQEt8zlUmK,
                  member_id: mber_YNRAcZdvq6KEd,
                  payment_method_id: payt_zhLRLKvNIrwVB}
  → 400 {"type":"bad_request","message":"We could not process this payment request right now."}
```

Endpoints útiles que se descubrieron en el camino:

| endpoint | qué sirve |
|---|---|
| `GET /payment_methods?member_id=<mber>` | lista los métodos guardados. **El que funciona** |
| `GET /payment_methods/<payt_>` | **404 siempre.** Falso negativo, no usar |
| `GET /api/v5/company` | la company de la API key. `v1/companies/me` devuelve la equivocada |
| `PATCH /plans/{id}` | sí acepta y guarda `three_ds_level` |
| `POST /payments` con IDs falsos | devuelve 404 específicos: sirve para aislar cuál está mal |

---

## 9. Lo que se implementó mientras esto no se resuelve

Ninguna de estas cosas cumple el requisito de un solo click. Están para no perder
la venta:

1. **El 400 pasa a `requiere_tarjeta` en vez de `fallido`**, con una sesión de
   recuperación. El comprador va al checkout del upsell y completa la
   autenticación ahí. Verificado con tráfico real: 01:27 con la versión vieja el
   cobro quedó `fallido`; 01:56 con la nueva quedó `requiere_tarjeta`.
2. **Botón de Apple Pay / Google Pay / Whop Pay** (`WhopExpressCheckoutButton`).
   Cobra en un toque, sin pasar por el off-session, y el wallet resuelve la
   autenticación del banco solo.

   **La primera versión se rechazó por requisito de producto**, y con razón: estaba
   *al lado* del botón verde, y dos botones parten la atención en el momento de
   decisión.

   **Eso cambió el 2026-09-11.** Ahora es **el** botón, no un segundo botón: un
   solo elemento que renderiza Apple Pay, Google Pay o Whop Pay según el browser,
   así que también cubre el caso de la tarjeta tipeada (ver §11). Con el
   off-session descartado en diez hipótesis, es la única forma de tener one-click,
   y está en producción con el panel entregándolo por default.

---

## 10. Las tres hipótesis que se descartaron el 2026-09-11 por la tarde

Con esto llegan a diez. Las tres se midieron contra la API real.

### 10.1 La versión de API: el proxy legacy vs. Payments nativo — DESCARTADA

Era la hipótesis principal y era **falsa**, pero dejó datos que sirven.

El changelog de Whop dice que `POST /payments` pasó a ser servido por la API
nativa en una versión posterior a `2026-08-21-1`, que es el pin global de este
repo. Dos pruebas que ya estaban en este documento sin ser interpretadas lo
confirmaban:

- Sin `account_id`, el endpoint respondía `{"code":"parameter_missing","param":"company_id"}`.
  Nombra el parámetro **legacy**; el nativo toma `account_id`.
- Un plan inline con `one_time` daba *"billing period cannot be zero if the plan is
  a renewal"*. El body legacy **no tiene** campo `plan_type`; el nativo sí. El
  valor se ignoraba en silencio.

**El límite exacto, medido:**

| Versión | `POST /payments` sin `account_id` responde | Superficie |
|---|---|---|
| `2026-08-21-1` (el pin del repo) | `Missing required parameter: company_id` | proxy legacy |
| `2026-09-02` | `Missing required parameter: company_id` | proxy legacy |
| `2026-09-02-1` | `account_id is required` | **nativo** |
| `2026-09-11` | `account_id is required` | **nativo** |

Y la lista completa de versiones válidas se saca mandando una inventada:

```
GET /payments?account_id=... con Api-Version-Date: 1999-01-01
→ 400 "Unknown Api-Version-Date. Supported versions: 2025-01-01, 2026-06-08,
   2026-06-09, 2026-06-20, 2026-07-01, 2026-07-08, 2026-07-08-1, 2026-07-18,
   2026-07-20, 2026-07-22, 2026-07-23, 2026-07-25, 2026-07-26, 2026-07-27,
   2026-07-29, 2026-07-29-1, 2026-07-31, 2026-08-03, 2026-08-05, 2026-08-05-1,
   2026-08-10, 2026-08-12, 2026-08-13, 2026-08-14, 2026-08-21, 2026-08-21-1,
   2026-08-25, 2026-08-25-1, 2026-08-25-2, 2026-08-31, 2026-09-02, 2026-09-02-1,
   2026-09-02-2, 2026-09-04, 2026-09-06, 2026-09-09, 2026-09-09-1, 2026-09-11."
```

Ojo: ese 400 sale en `/payments`, que **sí** es sensible a la versión. En
`GET /companies/{id}` una fecha inventada devuelve **200**, porque ese endpoint no
tiene variante versionada y el header se ignora. No sirve para descubrir versiones.

**Pero el cobro falla igual en las tres superficies.** Medido con los cuatro IDs
reales de §8:

| Intento | Resultado |
|---|---|
| `2026-08-21-1` (proxy) | `400` genérico |
| `2026-09-02-1` (nativo) | `400` genérico |
| `2026-09-11` (nativo, la última) | `400` genérico |
| nativo + `capture: false` | `400` genérico |

### 10.2 Un permiso faltante — DESCARTADA POR SEGUNDA VEZ, ahora sin inferir

§4.3 lo descartaba probando scopes contra endpoints de lectura. Whop tiene un
endpoint que lo contesta directo:

```
GET /permissions?resource_id=biz_...
→ 261 acciones, entre ellas:
     payment:charge                  true
     member:payment_methods:use      true
     member:payment_methods:read     true
     payment:setup_intent:read       true
```

**`payment:charge` está concedido.** Ya no es una inferencia a partir de la forma
del error: es la respuesta de Whop. Los permisos quedan descartados de raíz.

### 10.3 El webhook y la cuenta — DESCARTADAS LAS DOS, y eran las últimas

Las dos hipótesis vivas de §5 (company sin verificar) y la del webhook faltante se
probaron cambiando de cuenta entera.

**Lo que se hizo:** se cambió la cuenta que cobra a `biz_Me8Lbiv174brtM`
("Sinvanapp"), se creó su webhook con los seis eventos, se cargó su signing secret,
se crearon **planes nuevos en esa cuenta** (`plan_DnlPA9GLNvuF9` para el front,
`plan_tzGuzhZAV8R0x` para el upsell, los dos `one_time` de US$ 1) y se hizo una
compra real del front.

**Lo que se verificó antes de probar:** el webhook funcionando (dos
`payment.succeeded` recibidos, cero sin procesar), los dos planes pertenecientes a
la cuenta activa, y el front y el upsell en el mismo funnel.

**El resultado:**

```
2026-09-11T13:52:34  [upsell/cobrar] orden 1233be69… slug=sdasdad
2026-09-11T13:52:34  [upsell/cobrar] cobro 877870c8…: 400 de Whop sin código
                     (We could not process this payment request right now.)
                     → requiere_tarjeta
```

**El mismo 400, en una cuenta independiente, con webhook funcionando y planes
propios.** Ni la verificación de la company ni el webhook eran la causa.

### 10.4 Dos datos que cierran el caso

**El rechazo tarda 66–85 ms.** Medido en `api_logs`. No hay ida y vuelta al
procesador: es una política interna de Whop. Por eso nunca hubo `decline_code` —
la transacción no llegó a existir.

**Nunca hubo un `payments#create` exitoso en ninguna de las dos cuentas.** Whop
expone el log de las llamadas hechas con las API keys de la cuenta:

```
GET /api_logs?account_id=...&operation_name=api/v1/payments%23create&status=success
→ 0 filas
```

Y esto responde la que era **la última incógnita real** de este documento (la
vieja §10.3, "averiguar qué manda el backend de KashPay"): en `api_logs` aparece
la key de KashPay, identificable por su user agent.

```
api_key_id: apik_qGpCBhkCguzDq
user_agent: Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.76.0; ref=jzrwfrdwgjuarybyegao)
```

Filtrando sus POST:

```
GET /api_logs?api_key_id=apik_qGpCBhkCguzDq&http_method=POST
→ 1 fila: create_checkout_configuration, POST 200
```

**Un solo POST en toda su historia, y fue un checkout.** KashPay nunca cobró
off-session en esta cuenta tampoco. No hay un payload secreto que se nos escape:
su camino de Whop manda al comprador a un checkout, que es exactamente lo que su
código del lado del cliente deja ver en §7.3 y §7.4.

---

## 11. Lo que funciona hoy, y está en producción

El botón de wallet: `<div data-hilvana-wallet="<slug>"></div>`.

No pasa por el off-session. Le pide una sesión al server y monta
`<whop-express-checkout-button>`, que cobra **on-session** en un toque:

| Browser | Qué renderiza |
|---|---|
| Safari con tarjeta en el Wallet | Apple Pay, se aprueba con Face ID |
| Chrome / Android con Google Pay | Google Pay, sin diálogo |
| Todo lo demás | **Whop Pay**, un diálogo que acepta tarjeta tipeada |

Es **un** elemento y cubre los tres casos, así que no hace falta dejar el botón
viejo al lado "para los que no tienen wallet": Whop Pay ES el caso de la tarjeta.
El loader no manda el atributo `methods`, así que los tres quedan habilitados.

Y resuelve la autenticación del banco, que es lo que el off-session no puede: el
3DS lo hace el dispositivo. El `client_secret` de un pago creado desde un método
guardado viene **`null`**, así que por ese camino no hay forma de continuar un
desafío — la misma limitación que tiene KashPay.

El panel lo entrega por default en el editor de funnels, con el botón off-session
como segunda opción y un aviso de que no lo use.

### 11.1 Por qué Apple Pay NO arregla el off-session

Es la pregunta que aparece sola y la respuesta es al revés de lo que parece.

| Apple Pay usado como… | Sirve? |
|---|---|
| Método **guardado**, para cobrar después sin el comprador | **No.** Imposible por diseño de la red |
| Método **en el momento del click**, con Face ID | **Sí.** Es el botón de wallet |

Un token de Apple Pay es un **DPAN atado al dispositivo** y exige autenticación
biométrica en cada transacción. Medido en §4.6: `payt_6LXxXQSekTbrs` vino sin
`fingerprint` y sin expiración, y el off-session contra él dio el mismo 400. Pagar
el front con Apple Pay deja el one-click **peor**, no mejor.

Apple Pay resuelve el click, no la tarjeta guardada.

---

## 12. Lo que queda, y ya no es técnico de este lado

1. **Escalar a Whop.** Es lo único que puede destrabar el off-session. El caso ya
   no se puede contestar con documentación: dos cuentas independientes,
   `payment:charge` concedido según su propia API, rechazo en 66 ms sin
   `decline_code`, cero `payments#create` exitosos en la historia de ambas cuentas,
   e IDs concretos en §8. Pediles el log interno de esos cobros y qué política los
   rechaza.

2. **Pre-autorizar con `capture: false`.** El create-payment nativo acepta un hold
   de autorización, capturable dentro de 5 días con `POST /payments/{id}/capture`.
   Autorizar el monto del upsell **durante el checkout del front**, con el
   comprador presente y el 3DS resolvible, y capturar al click. Cero interacción en
   el momento del click, garantizado. Costo: retiene fondos de todo el que vea el
   upsell, un hold por monto, y la captura es del total. **Nota:** el hold usa el
   mismo `POST /payments`, así que hay que medir si el 400 también lo alcanza.

3. **Stripe como segundo procesador**, que es lo que hace KashPay para el 3DS. Con
   Stripe el off-session funciona: soporta MIT con exención de SCA y devuelve
   `client_secret` para resolver la autenticación en el navegador. Es el único
   camino que ya sabemos que funciona para un cobro sin ninguna interacción. Costo:
   otro procesador, otras credenciales, otro webhook, y la decisión de a dónde va
   el dinero.

**Lo que ya NO hay que volver a probar** (y esto es la mitad del valor de este
documento): la versión de API, los permisos, el webhook, cambiar de cuenta,
verificar la company, el tipo de tarjeta, el plan, el payload, `capture:false`, ni
buscar qué hace KashPay diferente. Las diez están medidas y descartadas.
