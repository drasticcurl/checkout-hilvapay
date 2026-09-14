# T02 — Endpoint `/api/webhooks/checkout-propio` en dashboard-admin

- **Depende de:** T01 (contrato A, `checkout-propio-tipos.ts`)
- **Bloquea:** nada de este módulo (T03/T04 no dependen de que este endpoint esté LEVANTADO, solo del
  contrato — pero para probar el circuito end-to-end de verdad, este endpoint tiene que existir)
- **Se puede correr en paralelo con:** T03, T04
- **Repo:** dashboard-admin
- **Archivos que este task puede tocar:**
  - `app/api/webhooks/checkout-propio/route.ts` (nuevo)
  - `lib/orders/checkout-propio.ts` (nuevo)
  - `lib/permisos.ts` (una línea agregada al mapa)
  - Un script de datos (no de schema) para insertar filas en `product_map` — podés crear
    `scripts/seed-product-map-checkout-propio.ts` si preferís dejarlo repetible, o documentar el
    INSERT a mano en tu verificación. Vos decidís cuál, documentalo.

Leé `00-PLAN-PANEL-Y-CAPI.md` completo, en particular **§1 D1-D5, §4 (contrato A, ya declarado por T01
en `lib/orders/checkout-propio-tipos.ts` — IMPORTALO, no lo redeclares), §8 (tu fila de ownership) y
§10 P-01/P-02 (las dos preguntas abiertas que te tocan)**.

**Antes de escribir, leé `app/api/webhooks/shopify/route.ts`, `lib/orders/upsert.ts`,
`lib/orders/verify.ts` y `lib/orders/attribution.ts` completos.** Es el mismo patrón que vas a
replicar: qué copiar — la estructura de `logWebhookEvent`, el manejo de body crudo, el `ON CONFLICT DO
NOTHING`, el centinela `'(directo)'` para las UTMs vacías, la resolución de `funnel_id` vía
`resolveFunnel()`. Qué NO copiar — la verificación HMAC sobre bytes crudos (D4 dice que este endpoint
usa Bearer token, no HMAC; no hay body-crudo-vs-parseado que cuidar acá), ni la lógica de
`line_items`/`order_items` (esta venta no tiene ítems múltiples, es un solo cobro).

## 1. Objetivo

Cuando termines:
- Un `POST /api/webhooks/checkout-propio` con un body que cumple `PayloadVentaCheckoutPropio` y un
  header `Authorization: Bearer <key válida>` inserta una fila en `orders` con `source =
  'checkout_propio'`.
- Un segundo POST con el mismo `cobroId` no duplica la fila (devuelve `{ok: true, orderId: null,
  isNew: false}`).
- Sin el header, o con una key inválida, responde 401.
- La venta queda atribuida a un `funnel_id` si su `whopPlanId` está en `product_map` con
  `shop_domain = 'checkout_propio'`; si no, se guarda con `funnel_id = NULL` (nunca se rechaza por
  esto).

**Este task no toca `lib/orders/upsert.ts` ni ningún archivo del flujo de Shopify. No inventa un
segundo mecanismo de autenticación distinto al de `/api/ingest`. No decide todavía cuál funnel/key usar
en producción (P-02) — deja el mecanismo genérico y anota la decisión pendiente.**

## 2. Autenticación (D4)

Leé `app/api/ingest/route.ts` líneas 49-78: el patrón es Bearer token, verificado primero por igualdad
directa contra la DB y después con SHA-256 + `timingSafeEqual` contra `funnels.ingest_key_hash`.
Replicá el MISMO mecanismo (podés extraer un helper compartido si ya existe uno reusable en
`lib/ingest/` — leé antes de decidir si conviene un helper nuevo o llamar al existente) para este
endpoint. La diferencia con `/api/ingest`: ese endpoint resuelve el `funnel_id` a partir de la propia
key; este endpoint puede usar el mismo mecanismo pero **el `funnel_id` de la fila de `funnels` usada
para autenticar NO es necesariamente el `funnel_id` que termina en la columna `orders.funnel_id`** —
ese lo decide `resolveFunnel()` vía `product_map` (D2), son dos cosas distintas. No los confundas: la
key autentica "quién me está hablando" (checkout-kashhhpay), el `product_map` decide "a qué funnel de
reporte pertenece esta venta específica".

## 3. El handler

Firma esperada (implementación tuya, esto es la forma):

```ts
// app/api/webhooks/checkout-propio/route.ts
export async function POST(req: NextRequest): Promise<NextResponse<RespuestaVentaCheckoutPropio>>;

// GET opcional, mismo patrón que shopify/route.ts: healthcheck sin exponer secrets.
export async function GET(): Promise<NextResponse<{ ok: boolean }>>;
```

Reglas:
1. **Body JSON directo (no HMAC sobre bytes crudos)** — a diferencia de Shopify, no hay firma que
   verificar sobre el body, así que podés parsear con `req.json()` normal. La autenticación es el
   header Bearer, no el body.
2. **Validá el payload contra el contrato A con zod**, mismo estilo que `lib/ingest/schema.ts` usa
   (`z.object(...)`). Un payload que no cumple el contrato → 400, se loguea en `webhook_events` con
   `status: 'error'`, `error: 'payload_invalido'`.
3. **Igual que Shopify: 200 siempre que la auth sea válida**, incluso si algo interno falla — el
   error se registra en `webhook_events` con `status: 'error'` y el motivo, para no forzar reintentos
   infinitos desde el cron de checkout-kashhhpay que ya tiene su propio backoff.

## 4. `lib/orders/checkout-propio.ts` — el equivalente de `upsertOrder` para esta fuente

```ts
export type UpsertResultCheckoutPropio = {
  orderId: number | null;
  isNew: boolean;
  funnelId: number | null;
};

/**
 * Inserta la venta de checkout-kashhhpay en `orders`.
 *
 * A diferencia de upsertOrder() (Shopify), esta venta NUNCA tiene line_items:
 * es un solo cobro por un solo producto. No se toca order_items.
 */
export async function upsertOrderCheckoutPropio(
  payload: PayloadVentaCheckoutPropio,
): Promise<UpsertResultCheckoutPropio>;
```

Reglas de implementación (todas ya establecidas en el plan, no las reinventes):
1. `external_id = 'checkout_propio_' + payload.cobroId`, `source = 'checkout_propio'`,
   `shop_domain = '*'` (NO `'checkout_propio'` — ojo, esa es la columna de `orders`, que sí usa el
   centinela genérico `'*'` como todo lo demás; el `shop_domain = 'checkout_propio'` es específico de
   la fila de **`product_map`** que usás para resolver el funnel, son dos columnas de dos tablas
   distintas con el mismo nombre de columna — no las confundas).
2. Las 5 UTMs se normalizan al centinela `'(directo)'` si vienen vacías o ausentes — copiá la función
   de limpieza de `lib/ingest/schema.ts` (`cleanUtmValue`/cómo se usa en `parseIngestPayload`) en vez
   de reinventarla, para no divergir en el algoritmo de limpieza (trim, decode, colapsar espacios).
3. `fbclid` vacío → `NULL`, no `''`.
4. `funnel_id` sale de `resolveFunnel({ shopDomain: 'checkout_propio', productIds: [payload.whopPlanId] })`
   — importado de `lib/orders/resolve.ts` tal cual, sin modificarlo.
5. `day` se calcula igual que en `upsert.ts` de Shopify: query SQL con `AT TIME ZONE`, usando la
   timezone del funnel resuelto (o `DASHBOARD_TZ`/default si `funnelId` es NULL) — copiá el patrón
   exacto de `upsert.ts` líneas ~115-122, no reimplementes la aritmética de zona horaria en JS (el
   comentario de ese archivo ya explica por qué).
6. `amount_eur`/`fx_rate`/`fx_day` se congelan con `toReportCurrency()`, igual que Shopify.
7. `tier`: como esta venta no tiene `order_items` con múltiples tiers, usá `resolveTier()` con el mismo
   `whopPlanId` como si fuera un product_id — la función ya tolera cualquier string, no exige que sea
   un ID de Shopify.
8. `email`: `payload.email` directo (ya viene resuelto por checkout-kashhhpay, no hay múltiples
   fuentes que arbitrar como en Shopify).
9. NO hay `order_items` que insertar. NO hay comisiones/costos por ítem — pero SÍ aplicá
   `applyCommissions`/`applyCosts` sobre el monto total, igual que Shopify hace, si el funnel resuelto
   tiene reglas configuradas (mismo criterio que Shopify: la comisión se congela en la fila).

## 5. `product_map` — filas de datos (no schema)

Al final de tu verificación, insertá al menos una fila real de prueba:

```sql
INSERT INTO product_map (shop_domain, product_id, funnel_id, tier, label)
VALUES ('checkout_propio', '<un whop_plan_id real de checkout-kashhhpay>',
        <un funnels.id real que ya exista>, 'front', 'Checkout propio — producto de prueba')
ON CONFLICT (shop_domain, product_id) DO NOTHING;
```

Anotá en tu propio archivo (o en un comentario del script) cuál `funnels.id` usaste y por qué —
ver P-02 del plan, todavía abierta. Mientras no se resuelva, usá cualquier funnel LATAM existente para
la prueba y dejalo explícito como "valor de prueba, no definitivo" en tu verificación.

## 6. `lib/permisos.ts`

Agregá una línea en el mapa de rutas públicas (busca el bloque `'/api/webhooks/hotmart': 'publica'` en
`lib/permisos.ts` línea ~325 y agregá la tuya justo al lado, mismo estilo):

```ts
'/api/webhooks/checkout-propio': 'publica',
```

## 7. Tests

Escribí `lib/orders/checkout-propio.test.ts` con al menos estos casos:
1. Un payload válido con las 5 UTMs en formato `nombre|id` → la fila insertada tiene esos IDs
   extraíbles (podés verificar contra el mismo regex que ya está en `lib/queries/ads.ts`, sin
   necesidad de correr esa query completa — solo confirmar que el string guardado en `utm_campaign`
   es exactamente el que llegó, sin modificar).
2. Un payload sin ninguna UTM → las 5 columnas quedan en `'(directo)'`, nunca NULL.
3. Un payload con `fbclid: ''` → columna `fbclid` queda `NULL`.
4. Dos llamadas con el mismo `cobroId` → la segunda devuelve `isNew: false, orderId: null`.
5. Un `whopPlanId` que no está en `product_map` → `funnelId: null`, la fila se inserta igual (no se
   tira excepción).

## 8. Verificación

```bash
# 1 — build y tests
cd dashboard-admin && npm run build && npm test -- checkout-propio
# esperado: build ok, los 5 casos del paso 7 en verde

# 2 — el endpoint rechaza sin credencial
curl -s -X POST http://localhost:3000/api/webhooks/checkout-propio \
  -H "content-type: application/json" -d '{}'
# esperado: {"ok":false,"error":"unauthorized"} con status 401

# 3 — con credencial válida y payload válido, inserta
curl -s -X POST http://localhost:3000/api/webhooks/checkout-propio \
  -H "content-type: application/json" -H "authorization: Bearer <key de prueba>" \
  -d '{"cobroId":"11111111-1111-1111-1111-111111111111","whopPlanId":"plan_test123","email":"test@example.com","monto":"29.90","moneda":"usd","purchasedAt":"2026-09-13T12:00:00Z","utms":{"utm_campaign":"Black Friday|120211112223330"},"fbclid":"IwARtest"}'
# esperado: {"ok":true,"orderId":<numero>,"isNew":true,"funnelId":<numero o null>}

# 4 — el mismo payload de nuevo: no duplica
# (repetir el curl anterior)
# esperado: {"ok":true,"orderId":null,"isNew":false}

# 5 — confirmar en DB que las UTMs quedaron con el centinela correcto
psql -c "SELECT source, external_id, utm_campaign, fbclid, funnel_id FROM orders WHERE source='checkout_propio' ORDER BY id DESC LIMIT 1;"
# esperado: utm_campaign = 'Black Friday|120211112223330', fbclid = 'IwARtest', una sola fila (no dos)

# 6 — nada de Shopify cambió
git diff --stat -- lib/orders/upsert.ts lib/orders/attribution.ts lib/orders/resolve.ts
# esperado: sin salida (0 archivos modificados)
```

## 9. Cuándo parar

**Bloqueante, pará y avisá:**
- Si `funnels.ingest_key_hash` no existe como columna o el mecanismo de `/api/ingest` es distinto a lo
  que este task asume — leé el archivo real antes de asumir, y si diverge, parate y anotalo en P-02.
- Si `resolveFunnel()` o `resolveTier()` no aceptan un `shopDomain`/`productId` arbitrario (por
  ejemplo, si tienen una validación oculta de formato que no se detectó en el análisis) — es una
  decisión de arquitectura, no algo para resolver con un workaround silencioso.

**Anotalo en §10 del plan y seguí:**
- P-02 sigue sin resolver: qué funnel/key usar en producción — dejalo con el mecanismo genérico y el
  valor de prueba explícito.
- Cualquier ajuste de nombre de columna que descubras al leer el schema real.
