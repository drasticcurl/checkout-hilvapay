# T03 — La página de checkout: HTML propio con el embed de Whop adentro y el botón verde propio

- **Depende de:** T01 (`lib/tipos.ts`).
- **Bloquea:** T06.
- **Se puede correr en paralelo con:** T02, T04, T05.
- **Repo:** `~/Desktop/funnel/checkout/checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/pagos/**`, `app/api/checkout/**`,
  `components/checkout/**` y sus `.test.ts`. Nada más.

Leé `00-PLAN-CHECKOUT-WHOP.md` completo. Tu contrato es el §4 (`RespuestaSesion`, `PaginaConProducto`,
`ConfigPagina`). **No lo modifiques.**

Mirá las tres capturas de KashPay que el usuario aportó (están descritas abajo): esta página es la
réplica de eso. No es un rediseño.

---

## 1. Objetivo

Cuando termines:

- `/pagos/<slug>` de un link activo muestra: barra roja con el timer, badge "100% SEGURO", card del
  producto con imagen, nombre real y precio, campos de nombre y email propios, la caja con el embed de
  Whop, y el botón verde propio abajo.
- El embed **no se monta** hasta que nombre y email están completos: hasta entonces se ve el esqueleto
  con el spinner. Es literalmente la captura 1 → captura 3 del usuario.
- El botón verde dispara el submit del iframe, no un submit propio.
- Al completarse el pago, el server guarda `member_id` + `payment_method_id` de forma **sincrónica** y
  redirige a `url_exito` con `?ot=<token>`.
- Un slug inexistente o inactivo da 404, sin filtrar si existe pero está apagado.

**Este task no escribe el cobro de upsells, ni el loader, ni el panel, ni el cron.**

## 2. Lo que hace KashPay hoy, que es lo que hay que replicar

De las capturas del usuario:

| Elemento | De dónde sale |
|---|---|
| Barra roja "La oferta expira en 11:24" | HTML propio. `config.timerMinutos` |
| "🛡 100% SEGURO" | HTML propio. `config.badgeSeguro` |
| Card: imagen + "Chau Hinchazón - 7 días…" + **$9.90** en azul | HTML propio, de `productos` |
| "Nome completo" y "E-mail*" | HTML propio |
| Caja con borde azul, título "Cartão de Crédito", y adentro los campos de tarjeta | **La caja y el título son propios. Los campos de tarjeta son el iframe de Whop, sin tocar** |
| Botón verde "Comprar agora" | HTML propio, dispara el submit del iframe |
| El spinner dentro de la caja mientras carga | La prop `fallback` del embed |

Fijate en la captura 2: el combo Cartão / Apple Pay / Bank Wire / ACH es el payment element de fábrica.
**No se puede estilar por dentro** y KashPay tampoco lo hizo: lo metieron en una caja con borde y un
título propio. Hacé lo mismo.

## 3. `POST /api/checkout/sesion`

```ts
/**
 * Crea la orden y la sesión de checkout de Whop.
 *
 * body:  { slug: string, nombre: string, email: string,
 *          sessionId?: string, visitorId?: string, utms?: Record<string,string> }
 * 200:   RespuestaSesion  (§4 del plan)
 * 400:   { error: 'payload_invalido' }
 * 404:   { error: 'pagina_inexistente' }
 */
```

Los pasos, en este orden y no en otro:

1. Buscar la página activa por slug con su producto. Si no está o está inactiva → 404.
2. Validar el body con zod. **El email se valida y se normaliza a minúsculas y sin espacios**: es lo
   que se le prefill al embed y lo que va al email de entrega.
3. Generar el token: **32 bytes de `crypto.randomBytes` en base64url**. No `Math.random`, no un uuid:
   ese token habilita cobrar una tarjeta guardada. `token_expira_at` = ahora + 2 horas.
4. `INSERT` en `ordenes`.
5. Llamar a `crearCheckoutConfiguration({ planId, metadata: { orden_id }, redirectUrl, frictionless })`
   de `lib/whop.ts`. **El `metadata.orden_id` es lo que ata el pago a la orden (D7).**
6. Guardar `cfg.id` en `ordenes.whop_checkout_config_id`.
7. Devolver `{ ordenId, sessionId: cfg.id, token }`.

Reglas:

1. **La orden se inserta ANTES de llamar a Whop.** Si Whop falla, queda una orden huérfana sin
   sesión, que es basura inofensiva. Al revés — sesión creada y orden no insertada — quedaría un pago
   posible que no se puede atribuir a nadie.
2. **`sessionId` y `visitorId` se validan como UUID y, si no lo son, van a `null`.** No inventes uno
   (crearía una sesión fantasma en el `dashboard-admin`) y no rechaces el request por eso (perderías
   la venta por un dato de tracking).
3. **Nunca devuelvas el `whop_plan_id` en la respuesta.** El browser no lo necesita: el embed recibe
   el `planId` desde el server component. Cuanto menos sepa el cliente, menos hay que validar.
4. **Rate limit por IP**, simple, en memoria: este endpoint crea filas y llama a la API de Whop sin
   autenticación. 20 por minuto por IP alcanza. Que se reinicie con la función serverless está bien:
   frena el bucle accidental, que es el caso real.

## 4. `POST /api/checkout/reclamar` — el claim sincrónico (D8)

```ts
/**
 * body: { ordenId: string, receiptId: string }
 * 200:  { ok: true, siguienteUrl: string | null }
 * 200:  { ok: false, motivo: 'no_pagado' }   ← 200 a propósito, ver regla 2
 */
```

1. `obtenerPago(receiptId)` de `lib/whop.ts`.
2. **Verificar que el pago sea de esta orden**: `pago.metadata.orden_id === ordenId` o
   `pago.checkout_configuration_id === orden.whop_checkout_config_id`. Si no, 403 y logueá fuerte:
   alguien está mandando un `receiptId` ajeno para conseguir un token válido.
3. **Verificar que esté pago de verdad** con `mapearEstado(pago)` de `lib/estado-pago.ts`. Si no da
   `'pagado'`, devolver `{ ok: false }` **sin guardar el método**: dar el acceso por un pago
   `pending` regala el producto si después rebota.
4. `guardarMetodoDePago()` y `registrarCobroDelFront()` de `lib/cobros.ts`. **Las dos ya existen y son
   idempotentes**: no las reimplementes ni les cambies la firma.
5. Encolar la salida con `encolarSalida()` solo si el cobro cambió de estado.
6. Devolver `url_exito` de la página, con `?ot=<token>` **agregado respetando el querystring que ya
   tenga** (usá `new URL`, no concatenación con `?`: si la URL ya tiene `?utm_source=...`, concatenar
   con `?` la rompe).

Reglas:

1. **Este endpoint es la razón de que el upsell funcione al toque.** Si dependiera del webhook, la
   persona llegaría al upsell antes de que exista su `payment_method_id` y el one-click fallaría con
   `sin_metodo_guardado` de forma intermitente e imposible de reproducir.
2. **`{ ok: false }` va con 200 y no con 4xx.** El cliente lo llama desde `onComplete`, y un 4xx en la
   consola del comprador durante un pago exitoso es la clase de cosa que genera un reclamo. El estado
   real lo resuelve el webhook.
3. **`payment_method` puede venir `null`** (pagó con un método no guardable). Eso NO es un error:
   `metodo_guardado` queda en false y esa persona verá el embed en los upsells en vez del botón
   one-click. Ver P-08 del plan.

## 5. `app/pagos/[slug]/page.tsx` — server component

Lee la página con su producto, y si no existe o está inactiva llama a `notFound()`. **El mismo 404
para los dos casos**: distinguirlos le dice a un curioso qué slugs existen.

Pasa al componente cliente solo lo que necesita: nombre, precio formateado, imagen, `config`,
`planId` (para la prop del embed), `slug` y el `environment`. **No le pases el objeto de la base
completo.**

`export const dynamic = 'force-dynamic'` y `revalidate = 0`: el estado activo/inactivo tiene que
tomar efecto al instante. Un link cacheado que sigue cobrando después de apagarlo es exactamente lo
que D14 intenta evitar.

## 6. `components/checkout/` — el cliente

Un componente por pieza: `Timer`, `CardProducto`, `CamposComprador`, `CajaTarjeta`, `BotonComprar`.
El contenedor es el que tiene el estado.

Las props del embed que importan, y por qué. **Están todas verificadas contra la doc de Whop:**

| Prop | Valor | Por qué |
|---|---|---|
| `sessionId` | de `RespuestaSesion` | ata el pago a la orden vía metadata |
| `planId` | del producto | **es requerido igual aunque pases `sessionId`** |
| `setupFutureUsage` | `"off_session"` | **sin esto no hay one-click.** Es lo que hace que Whop guarde el método |
| `hideSubmitButton` | `true` | para usar el botón verde propio. Necesita `@whop/checkout` ≥ 0.0.43 |
| `hideEmail` + `prefill.email` | | el email se captura arriba, en HTML propio |
| `hidePrice` | `true` | el precio se muestra en la card |
| `hideTermsAndConditions` | **`false`** | ver la regla 1 de abajo |
| `locale` | `"es"` | |
| `themeOptions` | `{ backgroundColor, borderRadius, accentColor }` | lo único que se puede estilar |
| `styles` | `{ container: { paddingX: 0, paddingY: 0 } }` | el default es 32px y descuadra la caja |
| `onStateChange` | | deja el botón deshabilitado hasta que el iframe esté `ready` |
| `fallback` | `<Spinner/>` | es el spinner de la captura 2 del usuario |
| `onPaymentError` | | `error.message` + `error.code` |
| `onComplete` | `(planId, receiptId) => …` | postea a `/api/checkout/reclamar` |
| `environment` | de `NEXT_PUBLIC_WHOP_ENV` | |

Reglas que no son negociables:

1. **`hideTermsAndConditions` va en `false`.** Es tentador ocultarlo por diseño, pero ahí vive el
   consentimiento para guardar el método de pago y hacer cobros posteriores. Un cobro one-click sin
   consentimiento visible es un contracargo indefendible: la regla de las redes de tarjetas exige el
   mandato del titular. Si el usuario quiere sacarlo, es una decisión suya y va a §10, no una
   decisión de este task.
2. **`hideAddressForm` NO se usa.** Si se oculta el form hay que pasar la dirección con `setAddress()`,
   y sin eso algunos métodos de pago fallan. Para infoproducto lo simple y correcto es dejarlo
   visible. Hay un callback `onAddressValidationError` si algún día se oculta.
3. **`onComplete` fuerza `skipRedirect: true`.** No pongas `returnUrl` esperando que funcionen los
   dos: el redirect lo hacés vos después del claim.
4. **El botón arranca deshabilitado** y se habilita solo cuando `onStateChange` dice `'ready'` **y**
   los datos del comprador son válidos. Un submit sobre un iframe que no cargó no hace nada y la
   persona cree que el botón está roto.
5. **Doble click en el botón verde: bloquealo con un flag antes del `submit()`.** No alcanza con
   deshabilitar en el render.
6. **El timer no bloquea la compra cuando llega a cero.** Es un elemento de urgencia; que expire y
   deje de cobrar es perder una venta por una animación. Cuando llega a cero, se queda en `00:00`.

## 7. El modo recuperación — `?ot=<token>&r=1`

**Esto lo consume T04 y sin esto su fallback no tiene a dónde ir.** Cuando un cobro one-click rebota
con un decline de los que se recuperan (`requiere_tarjeta`: 3DS, tarjeta vencida, CVC inválido), el
`loader.js` redirige a esta misma página con `?ot=<token>&r=1`. La página tiene que darse cuenta y
comportarse distinto:

| | Modo normal | Modo recuperación (`r=1` + `ot`) |
|---|---|---|
| Campos de nombre y email | visibles y vacíos | **ocultos**, ya se conocen de la orden |
| Sesión de checkout | se crea al completar los datos | se crea al cargar, con el email de la orden |
| `prefill.email` | lo que tipeó | el `email` de la orden |
| Encabezado | el copy normal | un mensaje breve: "Tu banco necesita que confirmes esta compra" |
| Al completarse | claim → `url_exito` | claim → `url_exito` de **esa** página |

Cómo se implementa:

1. Resolver el token con la misma función que usa T04 (`resolverToken` de `lib/token.ts`) — **si T04
   todavía no la escribió, resolvelo con una query directa en tu propio archivo y anotá en §10 que hay
   que unificarlo**. No la escribas en `lib/token.ts`: ese archivo es de T04.
2. Token inválido o vencido → renderizar el modo normal, no un error. Alguien pudo llegar con un link
   viejo, y pedirle los datos de nuevo es una venta posible; un error es una venta perdida.
3. **Es un pago NUEVO, no la continuación del anterior** (D3 del plan): `client_secret` es null para
   los pagos hechos desde un método guardado, así que no hay nada que reanudar. Se crea una checkout
   configuration nueva para el plan de esa página.
4. **La sesión de recuperación reusa la misma orden**, así que el claim va a chocar con el cobro que ya
   existe para `(orden_id, pagina_id)`. Eso es correcto y esperado: `registrarCobroDelFront` usa
   `ON CONFLICT DO NOTHING` y `aplicarEstadoDePago` es monótona, así que el cobro pasa de
   `requiere_tarjeta` a `pagado` sin crear una fila nueva. **No intentes crear un cobro nuevo:** el
   índice único te lo va a impedir y con razón.
5. En este modo, `url_exito` es la de la página del **upsell** que se está recuperando, no la del
   front.

Verificación de este modo, en el browser:

```
/pagos/aguadearroz2?ot=<token de una orden con un cobro en requiere_tarjeta>&r=1
```
- no pide nombre ni email
- el embed monta solo, con el email precargado
- después de pagar: `select count(*) from cobros where orden_id = <la orden>` sigue dando lo mismo que
  antes (no se creó una fila nueva) y el estado de ese cobro pasó a `pagado`

## 8. Tests

En `components/checkout/*.test.ts` y/o `app/api/checkout/*.test.ts`, lógica pura, sin jsdom:

1. **Armado de la URL de éxito**: `url_exito` sin query + token → `...?ot=X`; **con** query
   (`?utm_source=fb`) → `...?utm_source=fb&ot=X`. Es el bug de la concatenación con `?`.
2. **Normalización de email**: `'  Juan@Mail.COM '` → `'juan@mail.com'`.
3. **Validación de UUID de tracking**: `'no-es-uuid'` → `null`, un UUID válido → el mismo valor.
4. **`datosCompletos`**: nombre de 1 letra → false; email sin `@` → false; los dos bien → true.
5. **Formateo de precio**: el string `'9.90'` de la base se muestra como `$9.90` y **no** como `$9.9`.

## 9. Verificación

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay
npx tsc --noEmit && npx next build && npx vitest --run
# esperado: exit 0, "✓ Compiled successfully", todos passed

# 2 — necesitás un link activo para probar. Insertalo a mano (T02 puede no estar lista):
psql "$DATABASE_URL" <<'SQL'
insert into productos (id, nombre, whop_plan_id, precio, moneda, activo) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Chau Hinchazón - 7 días','plan_SANDBOX_FRONT',9.90,'usd',true)
  on conflict (whop_plan_id) do nothing;
insert into paginas (id, slug, producto_id, tipo, url_exito, config, activo) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aguadearroz1','aaaaaaaa-0000-0000-0000-000000000001',
   'front','https://example.com/upsell-latam','{"timerMinutos":12,"textoBoton":"COMPRAR AHORA"}'::jsonb,true)
  on conflict (slug) do nothing;
SQL

npm run dev &

# 3 — la página carga y el slug inactivo da 404
curl -s -o /dev/null -w '%{http_code}\n' localhost:3010/pagos/aguadearroz1
# esperado exactamente: 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3010/pagos/no-existe
# esperado exactamente: 404
psql "$DATABASE_URL" -c "update paginas set activo=false where slug='aguadearroz1';"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3010/pagos/aguadearroz1
# esperado exactamente: 404   ← apagar el link lo apaga YA, sin caché
psql "$DATABASE_URL" -c "update paginas set activo=true where slug='aguadearroz1';"

# 4 — crear sesión (necesita WHOP_API_KEY de sandbox y un plan_id real)
curl -s -X POST localhost:3010/api/checkout/sesion -H 'Content-Type: application/json' \
  -d '{"slug":"aguadearroz1","nombre":"Juan Perez","email":"Juan@Mail.COM"}' | python3 -m json.tool
# esperado: { "ordenId": "<uuid>", "sessionId": "ch_...", "token": "<43 chars base64url>" }

psql "$DATABASE_URL" -tAc "select email, length(token), whop_checkout_config_id is not null from ordenes order by created_at desc limit 1;"
# esperado exactamente: juan@mail.com|43|t    ← email normalizado y sesión guardada

# 5 — el payload inválido se rechaza
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3010/api/checkout/sesion \
  -H 'Content-Type: application/json' -d '{"slug":"aguadearroz1","nombre":"a","email":"no-es-email"}'
# esperado exactamente: 400

# 6 — un receiptId ajeno no consigue un token
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3010/api/checkout/reclamar \
  -H 'Content-Type: application/json' -d '{"ordenId":"<la orden de arriba>","receiptId":"pay_de_otro"}'
# esperado: 403 o 404 — nunca 200

# 7 — NO rompiste lo que ya estaba
git diff --stat lib/ db/ app/api/webhooks/
# esperado exactamente: sin salida

# 8 — EN EL BROWSER, con una tarjeta de prueba de sandbox. Esto no lo cubre curl:
#  - con los campos vacíos: se ve el esqueleto y el spinner, el botón está gris
#  - al completar nombre y email: el embed monta y el botón se pone verde
#  - el botón verde cobra (no hay botón de Whop visible)
#  - doble click rápido en el botón: UN solo pago en el dashboard de Whop
#  - después de pagar: redirige a url_exito con ?ot=
#  - en la base: ordenes.whop_payment_method_id NO es null   ← si es null, no hay one-click
#  - el texto de términos y condiciones ESTÁ visible (regla 1)
#  - navegación solo con teclado: se puede completar y comprar
```

## 10. Cuándo parar

**Bloqueante, pará y avisá:**

- **`whop_payment_method_id` queda `null` después de una compra exitosa con tarjeta.** Sin eso el
  módulo entero no tiene sentido: no hay upsell one-click. Revisá que `setupFutureUsage` esté
  llegando al embed antes de dar por perdido nada.
- El embed no monta y la consola muestra un error de `planId`: revisá que se esté pasando **además**
  del `sessionId`.
- `hideSubmitButton` no oculta el botón de Whop: chequeá la versión de `@whop/checkout`.
- Un doble click produce dos pagos en el dashboard de Whop.

**Anotalo en §10 del plan y seguí:**

- Métodos de pago que desaparecen del embed al activar `off_session` (es P-08, y es esperado). Anotá
  **cuáles** desaparecieron: es el dato que le falta al usuario para decidir.
- Apple Pay no aparece: falta verificar el dominio en Whop (P-07).
- **Necesitás modificar un archivo ajeno** → nunca. Anotalo.
