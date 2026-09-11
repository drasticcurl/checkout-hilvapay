# El cobro one-click de un upsell contra Whop: todo lo que se probó

**Estado: sin resolver.** Última medición 2026-09-11.

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

## 5. Lo que queda vivo

Dos cosas, y las dos son del lado de Whop:

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
2. **Botón de Apple Pay / Google Pay** (`WhopExpressCheckoutButton`), primero en la
   pantalla de recuperación y después también en el funnel. Cobra en un toque con
   confirmación biométrica, sin pasar por el off-session. **Rechazado por
   requisito de producto:** un segundo botón parte la atención.

---

## 10. Los caminos que quedan

1. **Verificar la company en el dashboard de Whop.** Gratis, y es una de las dos
   hipótesis vivas.
2. **Escalar a soporte de Whop** con los IDs de la sección 8, pidiendo que miren el
   log de ese cobro puntual. Con siete hipótesis descartadas no pueden responder
   con documentación genérica.
3. **Averiguar qué manda el backend de KashPay a Whop.** Es la única incógnita real
   que queda. Si ellos logran el cobro con Whop, hay un payload o un endpoint que
   no encontramos.
4. **Agregar Stripe como segundo procesador**, que es lo que hace KashPay. Con
   Stripe el off-session funciona: soporta MIT con exención de SCA y devuelve
   `client_secret` para resolver la autenticación en el navegador cuando hace
   falta. Es el único camino que ya sabemos que funciona para un cobro sin ninguna
   interacción. Costo: otro procesador, otras credenciales, otro webhook, y la
   decisión de a dónde va el dinero.
