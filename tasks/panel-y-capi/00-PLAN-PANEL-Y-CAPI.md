# PANEL-Y-CAPI — venta de checkout-kashhhpay al dashboard-admin + Facebook CAPI

**Documento maestro del módulo. Todo agente lee este archivo completo antes de abrir su task.**

Hoy el funnel LATAM cobra con Hotmart y ese webhook ya alimenta al dashboard-admin y a Facebook vía
`testfunnel` (`lib/panel-orders.ts` + `lib/tracking.ts`). Este módulo agrega el mismo par de destinos
para las ventas que entran por el checkout propio (`checkout-kashhhpay`, sobre Whop): que cada venta
quede registrada en `orders` de dashboard-admin (para reportes, comisiones, costos — todo lo que ya
existe para Shopify) **y** dispare un evento `Purchase` a Meta Conversions API con los datos de
atribución correctos, para no perder el ROAS de las campañas cuando Hotmart se apague.

**No se construye un endpoint que Whop llame directo.** Whop solo puede mandar su webhook a UNA URL
por cuenta, y esa URL ya es `checkout-kashhhpay/app/api/webhooks/whop/route.ts` (valida la firma HMAC,
reconcilia el pago con la orden interna, actualiza `cobros.status`). Dashboard-admin y Facebook CAPI
nunca reciben nada de Whop directamente: los llama `checkout-kashhhpay`, desde la cola `salidas` que
ya existe, después de procesar el webhook de Whop.

Este módulo escribe ventas nuevas en la tabla `orders` de dashboard-admin y manda eventos de compra a
la API de Meta con datos de contacto (email hasheado). **Un bug en la atribución no pierde plata
directamente, pero puede mandar gasto de ads a la campaña equivocada durante días antes de notarse, o
hacer que Meta reciba un `value`/`currency` mal calculado y optimice mal.** Todo lo que sigue está
diseñado para que una venta que no se puede atribuir se guarde igual (visible, con warning) en vez de
inventarse un dato — el mismo principio que ya usa el webhook de Shopify (D10 del plan de `orders`).

## 0. Qué se construye y qué no

**Se construye:**
1. `POST /api/webhooks/checkout-propio` en dashboard-admin: recibe la venta, la inserta en `orders`
   con `source='checkout_propio'`, resuelve `funnel_id` vía `product_map` (fila nueva, no schema
   nuevo), y registra el intento en `webhook_events`.
2. En checkout-kashhhpay: captura de `fbclid` además de `utms` en `POST /api/checkout/sesion`,
   persistidos en `ordenes.utms` (ya existe, jsonb, sin cambios de schema).
3. `armarPayloadIngest()` (`lib/salidas.ts`) extendido para incluir las UTMs y `fbclid` de la orden en
   el payload que se manda al endpoint nuevo.
4. `lib/capi.ts` en checkout-kashhhpay: módulo de Meta Conversions API, calcado de
   `testfunnel/lib/tracking.ts` (`sendCapiEvent`), adaptado a los tipos de este repo.
5. El cron de salidas (`app/api/cron/salidas/route.ts`) llama a `lib/capi.ts` además de al panel, por
   cada cobro `origen='front'` o `'upsell'` que se procese.
6. En los upsells (`crearCheckoutConfiguration`/`crearPagoOffSession`, que SÍ soportan `metadata` de
   Whop), agregar las UTMs al objeto `metadata` ya existente — solo ahí, no en el front.

**No se construye** (y por qué):
- **Un webhook de Whop hacia dashboard-admin o Facebook directo.** Whop no lo permite (una sola URL
  configurada por cuenta) y aunque lo permitiera, sería redundante con el webhook que ya existe en
  checkout-kashhhpay.
- **Metadata de UTMs en el pago del FRONT vía Whop.** El front dejó de usar `checkout_configuration`
  por un bug real y documentado (10 hipótesis descartadas, ver `app/api/checkout/sesion/route.ts`
  líneas 12-33 y `BITACORA.md` 2026-09-11/13): el embed con `planId` directo no acepta ninguna prop de
  metadata. Las UTMs de la compra principal viajan por la base propia (`ordenes.utms`), no por Whop —
  no hace falta que Whop las devuelva porque ya están en la fila de la orden desde el paso 2.
- **Reemplazar `note_attributes`/Shopify.** Este módulo agrega `source='checkout_propio'` como una
  fuente más de `orders`, sin tocar el flujo de Shopify existente.
- **Un endpoint genérico "venta con monto" reusable para cualquier futuro procesador.** Se nombra
  explícitamente `checkout-propio` porque hoy solo hay un checkout propio. Generalizarlo es trabajo
  para cuando exista un segundo caso, no antes (YAGNI): un endpoint genérico sin un segundo consumidor
  real adivina una forma de contrato que puede no servir para el próximo caso.
- **Deduplicación Pixel↔CAPI en checkout-kashhhpay.** El checkout de Whop no corre el dominio propio
  del usuario, así que no hay Pixel de browser disparando `Purchase` en ese dominio. El evento CAPI es
  la única fuente — no hace falta `event_id` compartido con un pixel que no existe ahí. (Si el usuario
  agrega una página de gracias propia con Pixel más adelante, es una extensión futura, no este módulo.)

## 1. Decisiones cerradas

**D1 — El endpoint nuevo se llama `/api/webhooks/checkout-propio`, no `/api/ingest`.**
`/api/ingest` (dashboard-admin) es tracking de embudo puro: un evento `purchase` ahí solo marca
`sessions.purchased_at`, **no crea una fila en `orders` con monto** (verificado en
`lib/ingest/apply.ts:20-27`, `MILESTONE_BY_EVENT`). Si checkout-kashhhpay sigue apuntando
`PANEL_INGEST_URL` a `/api/ingest` como hoy, la venta nunca aparece en reportes de facturación,
comisiones ni costos — solo en el embudo. El bug que esto evita: alguien mira el dashboard de ventas
un mes después de migrar de Hotmart y el revenue del checkout propio simplemente no está, sin ningún
error visible que lo explique.

**D2 — La venta se atribuye a un funnel vía `product_map`, con `shop_domain='checkout_propio'`, no vía
un `attrFunnel` explícito.** `resolveFunnel()` (`lib/orders/resolve.ts`) ya prueba, en orden: (1) cart
attribute `funnel` si viene, (2) `product_map` por `(shop_domain, product_id)`, (3) `shop_map`. Usar el
paso 2 con un `shop_domain` propio deja el archivo sin tocar — cero riesgo de romper la resolución de
Shopify — y solo requiere insertar filas de datos en `product_map` (ver `_schema-checkout-propio.sql`).
El `product_id` que se manda es el `whop_plan_id` del producto en checkout-kashhhpay (es el
identificador estable que no cambia si se edita el nombre del producto).

**D3 — El endpoint nuevo sigue el mismo patrón de idempotencia que Shopify: `UNIQUE(source,
external_id)` con `ON CONFLICT DO NOTHING`.** `external_id = 'checkout_propio_' + cobro.id` (el UUID
del cobro en checkout-kashhhpay). El bug que evita: el cron de `salidas` reintenta con backoff
exponencial hasta `MAX_INTENTOS`; sin idempotencia, un reintento después de un timeout de red (donde el
INSERT del lado de dashboard-admin sí se completó pero la respuesta se perdió) duplicaría la venta.

**D4 — Autenticación del endpoint nuevo: el MISMO mecanismo que ya usa `/api/ingest` (Bearer token
contra una key hasheada), no un secret nuevo tipo HMAC de Shopify.** Razón: checkout-kashhhpay ya tiene
`PANEL_INGEST_KEY` en su `.env.example` apuntando a este flujo — reusar la key existente evita
inventar un segundo secreto que hay que rotar y documentar aparte. El endpoint verifica contra
`funnels.ingest_key_hash` igual que `/api/ingest` (`app/api/ingest/route.ts:49-78`), usando un
`funnel_id` fijo reservado para checkout-kashhhpay (T02 lo define, ver §10 P-02: qué funnel exacto
usar para la key, si uno nuevo o uno LATAM ya existente).

**D5 — Las UTMs viajan desde checkout-kashhhpay a dashboard-admin en formato `nombre|id_meta`, tal
cual las manda el anuncio de Meta.** No se transforma nada en el medio: `lib/queries/ads.ts` extrae el
ID con el regex ya verificado (fase 3, `_verificacion-checkout-propio.sql` bloque 1) directamente sobre
el string que llega. Si el testfunnel/anuncio no manda ese formato, la venta se guarda igual pero sin
`campaign_id`/`adset_id`/`ad_id` resuelto — igual que pasa hoy con Shopify si un `note_attribute` viene
mal formado. No es un caso a rechazar, es el mismo comportamiento tolerante que ya existe.

**D6 — `fbclid` NO se transforma a `fbc` en checkout-kashhhpay antes de guardarlo; se guarda crudo en
`ordenes.utms.fbclid` y se formatea a `fbc` recién en `lib/capi.ts`, al momento de armar el evento
CAPI.** Guardar el crudo y formatear tarde es más seguro que formatear temprano: si el formato de `fbc`
cambia (Meta lo definió con `subdomainIndex` y `creationTime`, dos parámetros que dependen del momento
exacto de uso), reformatear un dato ya transformado es más difícil que transformar el dato crudo de
nuevo. Se usa `subdomainIndex=1` (indicación explícita de la doc de Meta para generación server-side
sin cookie `_fbc` propia — el checkout corre en el dominio de Whop, no en uno del usuario).

**D7 — El evento CAPI usa `cobro.whop_payment_id` como `event_id`, y `cobro.updated_at` (timestamp de
cuando pasó a `pagado`) como `event_time`.** Es el mismo patrón que ya usa `armarPayloadIngest()` para
`eventUid` (línea de `lib/salidas.ts`): reusar el mismo identificador evita mantener dos nociones
distintas de "qué identifica esta venta de forma única" en el mismo módulo.

**D8 — El envío a CAPI se hace desde el cron de `salidas`, en el mismo ciclo que reporta al panel, no
desde el webhook de Whop directamente.** Mismo motivo por el que el reporte al panel ya está ahí y no
en el webhook (D13 del plan de `checkout-whop`, ya cerrado): Whop exige responder en <5s, y una llamada
a Graph API de Meta que tarde no puede comerse ese presupuesto. Si el envío a CAPI falla, se reintenta
con el mismo backoff que ya tiene la fila de `salidas` — no se crea una segunda cola.

**D9 — Un fallo de CAPI no bloquea el reporte al panel, y viceversa.** Son dos efectos independientes
del mismo evento; si Meta está caída, la venta tiene que registrarse en el dashboard igual (y
viceversa). `procesarFila()` en el cron ya trata al panel y al email como pasos independientes
(`reportarAlPanel` + `mandarEmailSiCorresponde`); CAPI se agrega como un tercer paso con la misma
independencia.

**D10 — Los upsells (que sí usan `checkout_configuration`/`crearPagoOffSession`, con `metadata`
funcional) agregan las UTMs a `metadata` como bonus, pero el dato de verdad sigue siendo
`ordenes.utms`, no lo que Whop devuelva.** Esto es aditivo y de bajo riesgo (esos call sites ya mandan
`metadata: {orden_id, pagina_id}`, se le agregan más keys), y le da redundancia al dato — pero
`armarPayloadIngest`/`lib/capi.ts` siguen leyendo de `orden.utms`, nunca de `cobro` o de metadata de
Whop, para no tener dos caminos de lectura del mismo dato.

## 2. Arquitectura

```
testfunnel                                    checkout-kashhhpay                        dashboard-admin
───────────                                    ──────────────────                        ───────────────

usuario entra con
?utm_source=...&fbclid=...
        │
        │ (ya funciona hoy, sin cambios:
        │  cookie cross-dominio 90 días)
        ▼
redirige a checkout-kashhhpay
con los mismos query params
        │
        ▼
                                    POST /api/checkout/sesion
                                    { slug, nombre, email, utms: {...},
                                      fbclid }              ← T03 agrega fbclid
                                            │
                                            ▼
                                    INSERT ordenes (utms jsonb)  ← ya existe, sin cambio de schema
                                            │
                                    usuario paga en el embed de Whop
                                            │
                                            ▼
                                    Whop → webhook payment.succeeded
                                    (ya existe, sin cambios)
                                            │
                                            ▼
                                    lib/cobros.ts → encolarSalida()
                                    (ya existe, sin cambios)
                                            │
                                            ▼
                                    cron /api/cron/salidas (cada minuto)
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                            ▼
                    armarPayloadIngest()          lib/capi.ts → sendCapiEvent()
                    (T03: + utms/fbclid)          (T04: nuevo, calco de
                              │                    testfunnel/lib/tracking.ts)
                              ▼                            │
                    POST /api/webhooks/                    ▼
                    checkout-propio          ─────►   Meta Graph API
                    (T02, dashboard-admin)             /events
                              │
                              ▼
                    INSERT orders (source=
                    'checkout_propio')
                    resolveFunnel() vía
                    product_map (fila nueva,
                    D2 — sin tocar el archivo)
```

**Decisión estructural que hace esto testeable:** `armarPayloadIngest()` y la función equivalente de
`lib/capi.ts` (T04 la nombra `armarEventoCapi()`) son **puras** — reciben `FilaCobroParaSalida` y
devuelven un payload u un motivo de por qué no se armó, sin tocar red ni DB. Los efectos (el `fetch` al
panel, el `fetch` a Meta) están en el cron, que ya es donde vive el único efecto de este tipo en el
proyecto. Esto permite testear la lógica de armado con una tabla de casos, igual que ya hace
`salidas.test.ts` con `armarPayloadIngest`.

## 3. Esquema / datos — fuente de verdad

Ver `_schema-checkout-propio.sql`, ya verificado por lectura de las migraciones aplicadas (fase 3,
§10 P-01: sin acceso a la base real, no se pudo correr contra un motor con el schema del proyecto
cargado). **Resumen: no hay ALTER TABLE ni CREATE TABLE en este módulo.** Todo lo que hace falta:

| Qué | Dónde | Tipo de cambio |
|---|---|---|
| Filas nuevas en `product_map` | dashboard-admin, tabla existente | INSERT de datos, uno por producto/plan de checkout-kashhhpay que necesite atribución (T02 lo ejecuta) |
| Ninguna columna nueva | `orders`, `webhook_events` | ya tienen todo lo necesario (`source`, `shop_domain` sin CHECK) |
| Ninguna columna nueva | `ordenes`, `cobros` (checkout-kashhhpay) | `ordenes.utms` (jsonb) y `cobros.whop_payment_id` ya existen |

Los tres detalles del esquema que hay que entender antes de escribir código:
1. `orders.utm_source/medium/campaign/content/term` son `NOT NULL DEFAULT '(directo)'` — nunca NULL.
   El endpoint nuevo tiene que aplicar el mismo centinela que ya usa el `upsert.ts` de Shopify, no
   dejar pasar NULL crudo.
2. `orders.fbclid` SÍ es nullable (a diferencia de las UTMs) — es un token, no una dimensión de reporte.
3. `product_map` tiene `UNIQUE(shop_domain, product_id)` — el INSERT de T02 necesita `ON CONFLICT DO
   NOTHING` para poder re-ejecutarse sin duplicar filas si se corre dos veces.

## 4. Contrato A — Payload `checkout-kashhhpay → dashboard-admin` (CONGELADO)

**Lo declara T01. Lo implementa T02 (recibe) y T03 (arma y envía). Nadie más lo modifica.**

```ts
/** POST /api/webhooks/checkout-propio — body. */
type PayloadVentaCheckoutPropio = {
  /** UUID del cobro en checkout-kashhhpay. Es external_id sin el prefijo. */
  cobroId: string;
  /** whop_plan_id del producto cobrado — es lo que matchea product_map.product_id. */
  whopPlanId: string;
  email: string | null;
  /** numeric(10,2) como string, igual que llega de la DB. Ej: "29.90". */
  monto: string;
  /** ISO 4217, ej: "usd". Se guarda en minúsculas, igual que armarPayloadIngest ya hace. */
  moneda: string;
  /** ISO 8601. Momento en que el cobro pasó a 'pagado' (cobro.updated_at). */
  purchasedAt: string;
  utms: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
  /** Token crudo de Meta, sin transformar a fbc. Puede faltar. */
  fbclid?: string;
  sessionId?: string;
  visitorId?: string;
};

/** 200 siempre que la auth sea válida (mismo principio que Shopify: no reintentar para siempre). */
type RespuestaVentaCheckoutPropio =
  | { ok: true; orderId: number; isNew: boolean; funnelId: number | null }
  | { ok: true; orderId: null; isNew: false } // duplicate
  | { ok: false; error: string };
```

Reglas de implementación no negociables:
1. **Las 5 UTMs se normalizan al centinela `'(directo)'` si faltan o vienen vacías, igual que
   `attribution.ts` de Shopify hace.** Sin esto, un `NULL` en esas columnas rompe cualquier `GROUP BY
   utm_source` que asuma el centinela (y varias queries de `lib/queries/` lo asumen).
2. **`fbclid` vacío se guarda como `NULL`, no como `''`.** Es la misma regla que ya aplica
   `lib/ingest/schema.ts` (`cleanedFbclid === '' ? undefined : cleanedFbclid`) — un string vacío no es
   lo mismo que "no vino" para cualquier query que haga `WHERE fbclid IS NOT NULL`.
3. **`external_id = 'checkout_propio_' + cobroId`, `source = 'checkout_propio'`.** El prefijo por
   fuente es el mismo patrón que usa Shopify (`'shopify_' + order.id`) — sin el prefijo, un
   `cobro.id` (UUID) y un futuro `external_id` de otra fuente que casualmente coincida en formato
   podrían chocar en el índice único (improbable con UUIDs, pero el patrón ya establecido no se
   rompe sin motivo).
4. **`funnel_id` se resuelve con `resolveFunnel({ shopDomain: 'checkout_propio', productIds:
   [whopPlanId] })`, sin `attrFunnel`.** Ver D2. Si no matchea ninguna fila de `product_map`, la venta
   se guarda con `funnel_id = NULL` (D10 del plan de `orders`, ya establecido) — nunca se rechaza el
   webhook por esto.

## 5. Contrato B — Evento Meta CAPI (CONGELADO)

**Lo declara T01. Lo implementa T04. Nadie más lo modifica.**

```ts
// checkout-kashhhpay/lib/capi.ts

/** Los mismos tres targets que testfunnel soporta (multi-pixel, emparejados por posición). */
type CapiTarget = { pixelId: string; accessToken: string };

/** Arma el evento Purchase para una venta. Pura: no toca red. */
function armarEventoCapi(datos: FilaCobroParaSalida): ResultadoArmadoCapi;

type ResultadoArmadoCapi =
  | { ok: true; evento: EventoCapiPurchase }
  | { ok: false; motivo: string };

type EventoCapiPurchase = {
  event_name: 'Purchase';
  event_time: number; // unix seconds, de cobro.updated_at
  event_id: string;   // cobro.whop_payment_id
  action_source: 'website';
  event_source_url: string; // URL del checkout, ej. https://pay.<dominio>/pagos/<slug>
  user_data: {
    em?: string[];  // [sha256(email)], mismo hash que testfunnel/lib/tracking.ts hashEmail()
    fbc?: string;   // formateado desde orden.utms.fbclid, subdomainIndex=1
  };
  custom_data: {
    value: number;   // centavos() / 100, o el monto decimal — ver regla 3
    currency: string;
  };
};

/** Efecto: llama a Graph API. Reusa exactamente la firma de sendCapiEvent de testfunnel. */
async function sendCapiEvent(evento: EventoCapiPurchase): Promise<{ ok: boolean; reason?: string; error?: string }>;
```

Reglas de implementación no negociables:
1. **Sin `cobro.whop_payment_id`, el evento NO se arma** (mismo criterio que regla 1 de
   `armarPayloadIngest`: sin `event_id` no hay forma de que Meta identifique el evento en logs/soporte
   de forma útil, y es la misma columna que ya usa el panel — no inventar un segundo identificador).
2. **Sin `orden.utms.fbclid` Y sin email, el evento se arma igual pero se loguea un warning** (a
   diferencia del panel, que omite la venta entera sin `session_id`): un `Purchase` sin ningún
   identificador de `user_data` todavía es válido para Meta (cuenta la conversión, aunque con matching
   pobre) — no tiene sentido perder el dato de valor/currency solo porque falta la atribución fina.
3. **`custom_data.value` va en la unidad decimal (ej. `29.90`), NO en centavos.** A diferencia de
   `armarPayloadIngest` (que sí usa centavos para el panel, por convención propia de ese payload), la
   doc de Meta CAPI usa montos decimales en `custom_data.value` (ver el ejemplo oficial:
   `"value": "142.52"`) — mezclar las dos convenciones en el mismo archivo (`lib/salidas.ts` usa
   centavos, `lib/capi.ts` usa decimal) es el bug más probable de este módulo si alguien copia y pega
   entre los dos sin leer esta regla.
4. **`fbc` se formatea `fb.1.<orden.updated_at_en_ms_o_now>.<fbclid>`**, usando `subdomainIndex=1` fijo
   (D6). Si no hay `fbclid` guardado, `user_data.fbc` se omite (no se manda `undefined` ni string
   vacío al payload de Meta).
5. **`META_PIXEL_ID`/`META_CAPI_TOKEN` sin configurar → no-op silencioso**, exactamente como
   `sendCapiEvent` de testfunnel ya hace (`{ ok: false, reason: 'env_missing' }`), para que el cron no
   falle en un entorno donde CAPI todavía no está configurado — mismo principio que D9 de este plan.

## 6. Contrato C — `armarPayloadIngest` extendido (CONGELADO)

**Lo implementa T03, sobre un archivo que hoy existe (`lib/salidas.ts`) — no es un archivo nuevo, así
que la regla de ownership de §8 aplica solo a las líneas que T03 agrega, no al archivo entero (T04 solo
LEE `FilaCobroParaSalida`, no lo modifica).**

```ts
// El tipo PayloadIngest pasa a incluir utms (nuevo campo, aditivo):
type PayloadIngest = {
  sessionId: string;
  visitorId: string;
  variant: string;
  events: EventoIngest[];
  context: {
    path: string;
    utms?: { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string };
  };
};
```

Regla no negociable: **el campo `context.utms` es NUEVO y opcional — no se cambia la forma de
`context.path` ni de `events[]`.** El endpoint `/api/ingest` de dashboard-admin (`lib/ingest/schema.ts`)
ya tiene un `contextSchema` con `utms` opcional (verificado, fase 3): agregar este campo no rompe nada
existente porque el schema de destino ya lo esperaba antes de que este módulo lo llenara.

**Nota importante para quien implemente T03:** este payload extendido sigue yendo a `/api/ingest`
(tracking), NO al endpoint nuevo de T02. Son dos POSTs distintos desde el mismo cron: uno mantiene el
tracking de embudo como está hoy (con `utms` ahora incluidas, mejor que antes), y el otro (T02) es el
que efectivamente registra la venta con monto en `orders`. No confundir ni fusionar los dos.

## 7. Dependencias y olas de paralelismo

```
Ola 1 (sola, bloqueante)     T01 — declara los 3 contratos de arriba
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
Ola 2 (3 en paralelo)      T02                          T03                          T04
                    (dashboard-admin,           (checkout-kashhhpay,          (checkout-kashhhpay,
                     endpoint nuevo)              captura utm/fbclid +         lib/capi.ts nuevo)
                                                   armarPayloadIngest)
                                                          │
                                                          ▼
Ola 3 (sola, depende de T03)              T05 — metadata en upsells (usa el mismo
                                                  patrón de captura que T03 dejó listo)
```

| Task | Depende de | Se puede correr junto con |
|---|---|---|
| T01 | — | **nada, va sola** |
| T02 | T01 (contrato A) | T03, T04 |
| T03 | T01 (contratos A y C) | T02, T04 |
| T04 | T01 (contrato B) | T02, T03 |
| T05 | T03 (reusa la captura de UTMs que T03 deja en el endpoint de sesión) | nada de la ola 2, corre después |

Por qué T02/T03/T04 pueden correr en paralelo aunque T03 "alimente" a T02: cada una se escribe contra
el **contrato** (los tipos congelados en §4-6), no contra la implementación de la otra. T02 puede
escribir y testear el endpoint con un payload de ejemplo que cumple el contrato A sin que T03 exista
todavía; T03 puede armar y enviar ese payload sin que el endpoint real esté levantado (su test unitario
prueba la forma del payload, no la respuesta HTTP real — eso es lo que T09/verificación e2e cubre
después). T04 no depende de ninguna de las dos: solo necesita `FilaCobroParaSalida`, que ya existe hoy.

**Orden alternativo si se quiere ir de a uno:** T01 → T02 → T03 → T04 → T05. T02 antes que T03 permite
probar el endpoint real con curl antes de que el cron le mande tráfico de verdad.

## 8. Ownership de archivos — regla anti-colisión

**Nota sobre archivos citados que no aparecen en esta tabla:** cada task, además de crear/modificar su
fila, LEE varios archivos existentes para copiar un patrón (`lib/orders/upsert.ts`,
`lib/orders/attribution.ts`, `lib/orders/resolve.ts`, `lib/orders/verify.ts`, `lib/queries/ads.ts`,
`lib/ingest/schema.ts` en dashboard-admin; `testfunnel/lib/tracking.ts` en el repo hermano). Esos NO
son ownership — son lectura de referencia, explícitamente marcada como tal en cada task ("leé X antes
de escribir, para copiar Y"). Solo los archivos de esta tabla se crean o modifican.

| Task | Archivos que puede crear o modificar |
|---|---|
| T01 | `checkout-kashhhpay/lib/capi-tipos.ts` (nuevo), `dashboard-admin/lib/orders/checkout-propio-tipos.ts` (nuevo), `checkout-kashhhpay/lib/salidas.ts` (solo el tipo `PayloadIngest`, una extensión de campo — no las funciones) |
| T02 | dashboard-admin: `app/api/webhooks/checkout-propio/route.ts` (nuevo), `lib/orders/checkout-propio.ts` (nuevo, el equivalente de `upsert.ts` para esta fuente), `lib/orders/checkout-propio.test.ts` (nuevo), `lib/permisos.ts` (una línea: agregar `'/api/webhooks/checkout-propio': 'publica'`), `scripts/seed-product-map-checkout-propio.ts` (nuevo, opcional — o el INSERT documentado a mano si T02 prefiere no crear el script), filas nuevas en `product_map` (INSERT de datos, no DDL) |
| T03 | checkout-kashhhpay: `app/api/checkout/sesion/route.ts` (agregar `fbclid` al `BodySchema` y al INSERT — **solo el bloque de modo normal**, ver la excepción documentada más abajo), `lib/salidas.ts` (extender `armarPayloadIngest`, agregar función nueva `armarPayloadVentaPanel` o similar para el contrato A — T03 decide el nombre exacto y lo documenta en su propio archivo), `lib/salidas.test.ts` (casos nuevos), `lib/tipos.ts` (agregar `fbclid` a `Orden` si hace falta un campo propio, o confirmar que vive dentro de `utms` — T03 lo resuelve y lo anota), `app/api/cron/salidas/route.ts` (agregar la llamada a `reportarVentaAlPanel`) |
| T04 | checkout-kashhhpay: `lib/capi.ts` (nuevo), `lib/capi.test.ts` (nuevo), `app/api/cron/salidas/route.ts` (agregar la llamada a CAPI dentro de `procesarFila` — mismo archivo que T03 toca, ver nota de concurrencia abajo), `.env.example` (agregar `META_PIXEL_ID`/`META_CAPI_TOKEN`/`CHECKOUT_BASE_URL` si no están) |
| T05 | checkout-kashhhpay: `app/api/checkout/sesion/route.ts` (**solo el bloque de modo recuperación**, `crearCheckoutConfiguration` — ver la excepción documentada más abajo), `app/api/upsell/sesion/route.ts`, `app/api/upsell/cobrar/route.ts` (agregar utms al objeto `metadata` existente), `lib/metadata-whop.ts` (nuevo, opcional) y su test |

**Segunda excepción documentada — `app/api/cron/salidas/route.ts` (T03 y T04):** ambas tasks agregan
una llamada nueva dentro de `procesarFila`, en la misma función pero en líneas distintas (T03 agrega
`reportarVentaAlPanel`, T04 agrega la llamada a CAPI). A diferencia de la excepción de
`checkout/sesion/route.ts`, **esta sí corren en la misma ola (ola 2, en paralelo)** — es la única
colisión real de archivo simultáneo del módulo. Se resuelve así: T04 termina su cambio primero si
ambas terminan a la vez (T04 es la task más chica y autocontenida), o si T03 termina primero, T04 agrega
su línea al lado de la de T03 sin tocarla. **Quien termine segundo hace el merge manual de las dos
líneas nuevas dentro de `procesarFila`** — es una función de pocas líneas (ver §4 del plan, D9), el
conflicto de git es trivial de resolver a mano y no amerita serializar toda la ola por esto.

**Archivos que NADIE toca en este módulo** (caminos que hoy funcionan, romperlos rompe producción):
```
checkout-kashhhpay/lib/whop.ts
checkout-kashhhpay/lib/whop-webhook.ts
checkout-kashhhpay/lib/cobros.ts (excepto por lectura)
checkout-kashhhpay/lib/reconciliacion.ts
checkout-kashhhpay/lib/funnels.ts
dashboard-admin/lib/orders/upsert.ts (el de Shopify — se COPIA el patrón, no se modifica)
dashboard-admin/lib/orders/attribution.ts (se lee para copiar el patrón de centinela, no se modifica)
dashboard-admin/lib/orders/resolve.ts (D2: se usa tal cual, no se toca)
```

**Caso que parece colisión y no lo es — EXCEPCIÓN documentada:** `app/api/checkout/sesion/route.ts`
aparece en la fila de T03 y en la fila de T05, pero no es una colisión real. T03 toca únicamente el
bloque de **modo normal** (el `BodySchema` y el INSERT de `ordenes`, líneas ~82-91 y ~218-229). T05
toca únicamente el bloque de **modo recuperación** (la llamada a `crearCheckoutConfiguration`, líneas
~164-172). Son dos bloques disjuntos del mismo archivo, y T05 corre en la ola 3, después de que T03
(ola 2) ya haya terminado y su verificación haya pasado — nunca hay edición simultánea. Esta es la
excepción a la regla de "un archivo, un dueño" que reemplaza T03: **T05 es quien la reemplaza**, editando
después y en una porción distinta del archivo.

## 9. Criterios de aceptación globales

1. `npm run build` y `npm test` pasan en ambos repos (dashboard-admin y checkout-kashhhpay) después de
   cada task.
2. El INSERT en `product_map` es idempotente: correrlo dos veces no duplica filas
   (`ON CONFLICT (shop_domain, product_id) DO NOTHING`).
3. `POST /api/webhooks/checkout-propio` rechaza sin credencial válida con 401, igual que
   `/api/webhooks/shopify` y `/api/ingest` ya hacen.
4. **Nada de lo que ya funcionaba cambió**: el flujo de Shopify (`upsertOrder`, `attribution.ts`,
   `resolve.ts`) sigue sin modificarse — verificar con `git diff` que esos archivos no aparecen
   tocados por ninguna task de este módulo.
5. Un cobro sin `session_id`/`visitor_id` sigue omitiéndose del reporte al panel de tracking (`/api/
   ingest`), como hoy — pero SÍ debe llegar al endpoint nuevo de venta (`/api/webhooks/checkout-propio`,
   T02), porque ese contrato no exige `sessionId`/`visitorId` (son opcionales en el contrato A, a
   diferencia del contrato de `/api/ingest`) — una venta real no puede desaparecer del dashboard de
   facturación solo porque el tracking de embudo no la pudo atar a una sesión.
6. El envío a CAPI (T04) no bloquea ni hace fallar el reporte al panel (T02/T03) si Meta está caída —
   verificado con un test que simula un fetch fallido a Graph API y confirma que `procesarFila` sigue
   marcando el resto del flujo según corresponda.

## 10. Preguntas abiertas

### P-01 — Verificación de esquema sin acceso a la base real
- **Sección del plan:** §3, `_schema-checkout-propio.sql`, `_verificacion-checkout-propio.sql`
- **Qué falta:** confirmar contra la base real de dashboard-admin (no una scratch local) que
  `orders`/`webhook_events`/`product_map` no tienen ningún `CHECK` agregado después de las migraciones
  leídas en este análisis (por ejemplo, si alguien agregó una migración 032+ con un enum de `source`).
- **Bloquea:** no. Mientras tanto, T02 corre el query de re-verificación documentado en el bloque 4 de
  `_verificacion-checkout-propio.sql` contra la base real como primer paso de su propia verificación,
  antes de escribir el endpoint.
- **Resolución:** _pendiente, la completa quien tenga acceso a producción._

### P-02 — Qué `funnel_id`/key usar para autenticar el endpoint nuevo (D4)
- **Task:** T02
- **Sección del plan:** §1 D4
- **Qué falta:** decidir si checkout-kashhhpay usa la key de un funnel LATAM ya existente en
  dashboard-admin, o si se crea un funnel nuevo dedicado a "checkout propio" solo para tener su propia
  `ingest_key_hash`. Usar un funnel existente es más simple pero mezcla la key de autenticación con un
  funnel que semánticamente es otra cosa (un funnel de landing, no de checkout).
- **Bloquea:** sí, para T02 — no se puede generar/asignar la key sin esta decisión.
- **Resolución:** _pendiente del usuario._ Mientras no se resuelva, T02 puede escribir el endpoint
  completo dejando la verificación de la key como el mismo mecanismo genérico de `/api/ingest`
  (parametrizado, no hardcodeado a un funnel_id) — la decisión solo afecta qué fila se usa al probarlo,
  no la forma del código.

### P-03 — Nombre exacto del `event_source_url` para el evento CAPI
- **Task:** T04
- **Sección del plan:** §5, contrato B
- **Qué falta:** confirmar el dominio real donde el comprador ve el checkout (`pay.hilvanapp.com` según
  `HANDOFF-DNS.md`, a confirmar que sigue siendo ese dominio) para que `event_source_url` coincida con
  un dominio verificado en Meta Business Manager — si no coincide, Meta puede rechazar o descontar
  calidad de matching al evento.
- **Bloquea:** no. T04 puede dejarlo como una constante fácil de cambiar (`CHECKOUT_BASE_URL` en env),
  y anotar el valor default que usó.
- **Resolución:** _pendiente de confirmación del dominio en Meta Business Manager._

### P-04 — `PANEL_INGEST_URL`/`PANEL_INGEST_KEY` siguen sin configurar en producción
- **Ya documentado en el propio repo** (`ESTADO.md` §3.3, `lib/salidas.ts` comentario de
  `reportarAlPanel`): sin esas dos env vars, el cron omite el reporte al panel con el motivo
  `'omitida: PANEL_INGEST_URL/KEY sin configurar (P-04)'`. Este módulo no lo resuelve por sí mismo —
  **T02 y T03 dejan todo el código funcional, pero alguien tiene que efectivamente configurar esas dos
  env vars en el VPS para que el flujo se encienda.** Es un paso manual explícito, no una task.
- **Bloquea:** el ENCENDIDO del módulo en producción, no el desarrollo/tests de las tasks.
- **Resolución:** paso manual post-deploy, documentado en `PROMPT-CLAUDE-CODE.md`.

### P-05 — `META_PIXEL_ID`/`META_CAPI_TOKEN` de checkout-kashhhpay: ¿mismo pixel que testfunnel o uno nuevo?
- **Task:** T04
- **Qué falta:** decidir si las ventas de checkout-kashhhpay reportan al MISMO Pixel ID que ya usa
  testfunnel (recomendado por la doc de Meta: un solo pixel por dominio de negocio simplifica
  atribución) o a uno separado.
- **Bloquea:** no. T04 usa el mismo nombre de env var (`META_PIXEL_ID`/`META_CAPI_TOKEN`) que
  testfunnel por convención, y el usuario decide qué valor poner al configurar el `.env` real.
- **Resolución:** _pendiente del usuario — recomendación: mismo Pixel ID que testfunnel._
