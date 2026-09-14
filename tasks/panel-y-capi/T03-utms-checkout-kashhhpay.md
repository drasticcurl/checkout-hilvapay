# T03 — checkout-kashhhpay: capturar fbclid, reenviar UTMs al panel y a la venta

- **Depende de:** T01 (contratos A y C)
- **Bloquea:** T05 (reusa la captura de UTMs que esta task deja lista en el endpoint de sesión)
- **Se puede correr en paralelo con:** T02, T04
- **Repo:** checkout-kashhhpay
- **Archivos que este task puede tocar:**
  - `app/api/checkout/sesion/route.ts` (**solo el bloque de modo normal** — no el bloque de modo
    recuperación, que es de T05, ver §8 del plan sobre la falsa colisión)
  - `lib/salidas.ts` (extender `armarPayloadIngest`, agregar la función nueva del contrato A)
  - `lib/tipos.ts` (si hace falta, agregar `fbclid` como campo propio de `Orden` — decidilo en el
    paso 2 de abajo)

Leé `00-PLAN-PANEL-Y-CAPI.md` completo, en particular **§1 D5, D6, §4 (contrato A), §6 (contrato C, ya
declarado por T01 en `lib/salidas.ts` — el campo `context.utms` de `PayloadIngest` ya existe cuando
empezás, no lo redeclares)**.

**Antes de escribir, leé `lib/salidas.ts` completo** (ya lo hiciste si leíste el plan, pero
releélo ahora con la lupa de implementación) y `app/api/checkout/sesion/route.ts` completo. Qué copiar
del primero: el estilo de las funciones puras que devuelven `{ok: true, ...} | {ok: false, motivo}` en
vez de tirar excepciones — es el patrón de todo el archivo, no lo rompas con un `throw` nuevo. Qué NO
tocar: la función `armarPayloadIngest` existente NO cambia su firma ni su comportamiento para los
campos que ya arma — solo le agregás el campo nuevo dentro de `context`.

## 1. Objetivo

Cuando termines:
- `POST /api/checkout/sesion` acepta `fbclid?: string` en el body (además del `utms` que ya acepta).
- Ese `fbclid` se guarda en `ordenes` — dentro del jsonb `utms` (como una key más, `utms.fbclid`) o en
  una columna propia: **vos decidís cuál de las dos, en el paso 2, y lo documentás.** El plan (D6) no
  fuerza una de las dos, solo dice que se guarda crudo, sin transformar.
- `armarPayloadIngest()` (el payload hacia `/api/ingest`, tracking) incluye `context.utms` con las 5
  UTMs de la orden, cuando existen.
- Una función nueva (nombrala vos, ej. `armarPayloadVentaPanel`) arma el contrato A
  (`PayloadVentaCheckoutPropio`) a partir de `FilaCobroParaSalida`, análoga a `armarPayloadIngest` pero
  para el endpoint nuevo de T02.
- El cron de salidas (`app/api/cron/salidas/route.ts`) llama a esta función nueva y hace un segundo
  `POST` al endpoint de T02, ADEMÁS del `POST` que ya hace a `/api/ingest`. Los dos son independientes
  (D9): si uno falla, el otro se reporta igual.

**Este task no toca `lib/cobros.ts`, `lib/whop.ts` ni `lib/whop-webhook.ts`. No cambia la forma en que
se decide si una venta se omite del reporte a `/api/ingest` (regla 1 de `armarPayloadIngest`, sin
`session_id`/`visitor_id` sigue omitiéndose de ESE endpoint) — pero SÍ tiene que enviarse al endpoint
nuevo de T02 igual, sin ese requisito (criterio de aceptación §9.5 del plan).**

## 2. Decisión de implementación: dónde vive `fbclid`

Tenés dos opciones válidas, elegí una y documentala en un comentario en `lib/tipos.ts`:

**Opción A (recomendada, menor cambio):** `fbclid` vive DENTRO del jsonb `utms` como una key más
(`{utm_source: '...', fbclid: '...'}`). No hace falta tocar el schema de `ordenes` ni el tipo `Orden`
(`utms: Record<string, string> | null` ya lo admite tal cual). El `BodySchema` de
`app/api/checkout/sesion/route.ts` acepta esto sin cambios porque `utms: z.record(z.string()).optional()`
ya permite cualquier key string.

**Opción B:** agregar `fbclid?: string` como parámetro separado en el body y una columna nueva
`ordenes.fbclid`. Esto SÍ requeriría una migración de schema — evitalo salvo que encuentres una razón
concreta durante la implementación (si la encontrás, es bloqueante: parate y anotalo en §10, no migres
el schema sin pasar por la fase de verificación del plan).

Si elegís A (el default esperado), el único cambio en `BodySchema` es de **documentación**, no de
código: el schema ya acepta `fbclid` como una key de `utms`. Confirmalo con un test antes de asumir que
"no hay que tocar nada".

## 3. `armarPayloadIngest` extendido

```ts
export function armarPayloadIngest(
  datos: FilaCobroParaSalida,
  variant: string = 'checkout-propio',
): ResultadoArmadoIngest {
  // ... lo que ya existe, SIN CAMBIOS hasta el return ...

  return {
    ok: true,
    payload: {
      sessionId: orden.session_id,
      visitorId: orden.visitor_id,
      variant,
      events: [/* sin cambios */],
      context: {
        path: `/pagos/${pagina.slug}`,
        utms: extraerUtmsLimpias(orden.utms), // función nueva, ver abajo
      },
    },
  };
}
```

Función nueva, pura, con su propio test:

```ts
/**
 * Extrae las 5 UTMs conocidas de orden.utms (jsonb libre) hacia la forma que
 * espera PayloadIngest.context.utms. Claves desconocidas se ignoran (mismo
 * criterio que dashboard-admin/lib/ingest/schema.ts: strip-by-default).
 * fbclid NO se incluye acá — ese campo no es una "UTM" en el contrato de
 * /api/ingest (ver lib/ingest/schema.ts contextSchema.utms, que no tiene
 * fbclid en su lista — confirmá esto leyendo ese archivo antes de escribir,
 * está referenciado en el análisis previo pero volvé a confirmarlo).
 */
export function extraerUtmsLimpias(
  utms: Record<string, string> | null,
): PayloadIngest['context']['utms'];
```

**Regla no negociable:** si `orden.utms` es `null` o no tiene ninguna de las 5 claves, `context.utms`
queda `undefined` (no un objeto con 5 strings vacíos) — es opcional en el contrato C a propósito, y
mandar un objeto vacío en vez de omitir el campo puede confundirse con "vino pero está vacío" del lado
del schema de destino.

## 4. La función nueva para el contrato A

```ts
/**
 * Arma el payload para POST /api/webhooks/checkout-propio (T02), a partir de
 * los mismos datos que ya usa armarPayloadIngest. A diferencia de esa función,
 * ESTA NO exige session_id/visitor_id (son opcionales en el contrato A) — una
 * venta real no puede desaparecer del dashboard de facturación solo porque no
 * se pudo atar a una sesión de tracking (criterio §9.5 del plan).
 */
export function armarPayloadVentaPanel(
  datos: FilaCobroParaSalida,
): { ok: true; payload: PayloadVentaCheckoutPropio } | { ok: false; motivo: string };
```

Reglas:
1. **Solo exige `cobro.whop_payment_id` y `cobro.monto`** (sin esos dos no hay venta real que
   reportar — mismas reglas 2 y 3 de `armarPayloadIngest`, reusalas). `session_id`/`visitor_id` van
   igual si existen, pero su ausencia NO hace fallar el armado.
2. `moneda` en minúsculas, igual que ya hace `armarPayloadIngest`.
3. `utms` sale de `extraerUtmsLimpias(orden.utms)` — reusá la misma función del paso 3, no dupliques la
   lógica de extracción.
4. `fbclid` sale de `orden.utms?.fbclid` (si elegiste la Opción A del paso 2) tal cual, sin transformar
   (D6: eso lo hace `lib/capi.ts`, no este archivo).
5. `whopPlanId` sale de `cobro.whop_plan_id` (ya existe en el tipo `Cobro`).

## 5. El cron — segundo POST independiente

En `app/api/cron/salidas/route.ts`, dentro de `procesarFila`, agregá una llamada nueva al lado de
`reportarAlPanel` (no la reemplaces):

```ts
const reportado = await reportarAlPanel(datos);      // ya existe: POST a /api/ingest
const reportadoVenta = await reportarVentaAlPanel(datos); // NUEVO: POST a /api/webhooks/checkout-propio
const email = await mandarEmailSiCorresponde(datos);
```

`reportarVentaAlPanel` es una función nueva en `lib/salidas.ts`, con la MISMA forma que
`reportarAlPanel` (mismo manejo de timeout, mismo tratamiento de 401 como no-reintentable, mismo
`AbortController`) pero apuntando a una URL/key distinta — necesitás dos env vars nuevas:
`PANEL_VENTAS_URL` y `PANEL_VENTAS_KEY` (no reuses `PANEL_INGEST_URL`/`KEY`: son dos endpoints
distintos con dos propósitos distintos — D1 del plan ya estableció por qué no pueden ser el mismo).

**Regla D9 del plan:** el resultado de `reportarVentaAlPanel` se trata igual que `reportado` en la
lógica de `marcarFallida`/`marcarEnviada` — si CUALQUIERA de los dos POSTs (panel de tracking, panel de
venta) falla de forma reintentable, la fila completa se reintenta (los dos POSTs se repiten juntos en
el próximo ciclo — no hay forma de reintentar solo uno sin cambiar el modelo de `salidas`, y el plan no
pide separarlos en dos colas). Si uno es exitoso y el otro no, documentá en el `motivo` cuál de los dos
falló, igual que ya se hace con `email`.

## 6. Tests

En `lib/salidas.test.ts` (ya existe, agregale casos — no reescribas los que ya están):
1. `extraerUtmsLimpias` con `orden.utms = {utm_campaign: 'X|123456', fbclid: 'abc'}` → devuelve
   `{utm_campaign: 'X|123456'}` (fbclid excluido).
2. `extraerUtmsLimpias(null)` → `undefined`.
3. `armarPayloadVentaPanel` con un cobro sin `whop_payment_id` → `{ok: false, motivo: ...}`.
4. `armarPayloadVentaPanel` con un cobro completo y `session_id: null` → `{ok: true, ...}` (a
   diferencia de `armarPayloadIngest`, que con esos mismos datos daría `{ok: false}`).
5. `armarPayloadIngest` con `orden.utms` conteniendo las 5 UTMs → `context.utms` las tiene todas.

## 7. Verificación

```bash
# 1 — tests
npm test -- salidas
# esperado: todos los casos del paso 6 en verde, más los que ya existían sin romperse

# 2 — build
npm run build
# esperado: exit code 0, sin líneas "Failed to compile"

# 3 — el schema de /api/checkout/sesion acepta fbclid dentro de utms sin cambios de código
#     (si elegiste Opción A del paso 2). Probalo con un POST real contra el dev server:
curl -s -X POST http://localhost:3000/api/checkout/sesion \
  -H "content-type: application/json" \
  -d '{"slug":"<un slug real de páginas activas>","nombre":"Test","email":"test@example.com","utms":{"utm_campaign":"X|123456","fbclid":"IwARtest"}}'
# esperado: 200, { ordenId, sessionId: null, planId, token }

# 4 — confirmar que se guardó
psql -c "SELECT utms FROM ordenes ORDER BY created_at DESC LIMIT 1;"
# esperado: {"utm_campaign": "X|123456", "fbclid": "IwARtest"}

# 5 — nada de lo que ya funcionaba cambió
git diff --stat -- lib/cobros.ts lib/whop.ts lib/whop-webhook.ts lib/funnels.ts
# esperado: sin salida
```

## 8. Cuándo parar

**Bloqueante, pará y avisá:**
- Si durante la implementación de la Opción A del paso 2 encontrás que `BodySchema` en
  `app/api/checkout/sesion/route.ts` SÍ necesita un cambio de código (por ejemplo, si `utms` tiene un
  `.strict()` que no se detectó) — es información nueva sobre el schema real, anotala y ajustá el plan
  en consecuencia, no lo fuerces.

**Anotalo en §10 del plan y seguí:**
- Si terminás eligiendo la Opción B (columna propia `fbclid`) por algún motivo concreto que aparezca
  al implementar: es un cambio de schema que la fase de verificación del plan no cubrió — anotalo con
  el motivo exacto para que se pueda evaluar antes de aplicarlo.
