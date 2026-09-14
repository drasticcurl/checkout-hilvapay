# Prompts para Claude Code — panel-y-capi

## Antes de arrancar

```
checkout-kashhhpay/tasks/panel-y-capi/
├── 00-PLAN-PANEL-Y-CAPI.md              el documento maestro — TODOS lo leen completo
├── PROMPT-CLAUDE-CODE.md                este archivo
├── _schema-checkout-propio.sql          por qué no hace falta ninguna migración (ya verificado)
├── _verificacion-checkout-propio.sql    las afirmaciones de fase 3, YA CORRIDAS (ver salida abajo)
├── T01-fundacion.md                     contratos en código real — va sola y primero
├── T02-endpoint-dashboard-admin.md      repo: dashboard-admin
├── T03-utms-checkout-kashhhpay.md       repo: checkout-kashhhpay
├── T04-capi-checkout-kashhhpay.md       repo: checkout-kashhhpay
└── T05-metadata-upsells.md              repo: checkout-kashhhpay, depende de T03
```

**Lo que ya está verificado y por qué eso ahorra trabajo:** `_verificacion-checkout-propio.sql` se
corrió de verdad contra un Postgres 16 local (base scratch, creada y destruida en la misma sesión, no
contra ninguna base de producción). Los 10 casos del regex de extracción de ID de Meta dieron
`ok=t`, el formateo de `fbc` dio el valor esperado exacto, y la conversión a centavos confirmó el caso
de punto flotante. **Nadie tiene que re-verificar esas tres cosas** — si algo falla en esa zona durante
la implementación, es un bug de la implementación, no de la lógica que el plan asume.

### 5 cosas que hay que saber antes de largar el primer agente

**1. T01 va sola y primero.** Declara los tres contratos (payload de venta, evento CAPI,
`PayloadIngest` extendido) como archivos TypeScript reales en los dos repos. T02, T03 y T04 importan
esos tipos — si arrancan antes de que T01 termine, van a importar de un archivo que no existe.

**2. Este módulo toca DOS repos independientes** (`checkout-kashhhpay` y `dashboard-admin`), sin
paquete compartido entre ellos. El contrato A se declara dos veces (una por repo) a propósito — no es
un bug de este plan, está explicado en T01 §2.

**3. Ambos repos están en producción con ventas reales entrando por Shopify y por Hotmart (vía
testfunnel) hoy mismo.** Nada de este módulo toca esos flujos — la lista de "archivos que nadie toca"
del plan (§8) es la garantía de eso. Si algún agente se encuentra necesitando tocar
`lib/orders/upsert.ts`, `lib/orders/attribution.ts` o `lib/whop.ts`/`lib/whop-webhook.ts`, tiene que
parar y avisar, no seguir.

**4. Dos env vars nuevas quedan sin configurar en producción hasta un paso manual posterior**
(`PANEL_VENTAS_URL`/`KEY` en checkout-kashhhpay, y `META_PIXEL_ID`/`META_CAPI_TOKEN` si no existen
todavía). El código funciona en modo no-op sin ellas (mismo patrón que ya usa `PANEL_INGEST_URL`
hoy) — así que las tasks no fallan por esto, pero el módulo no está "encendido" en producción hasta que
alguien las configure. Ver el paso 8 de "Qué revisar cuando terminan".

**5. El plan es el contrato.** Las secciones §4, §5 y §6 (los tres bloques de tipos TypeScript) están
congeladas: ningún agente les cambia un nombre de campo o un tipo sin pasar por §10 (preguntas
abiertas) primero.

## El orden

```
Paso 1   T01                       1 agente, SOLO
Paso 2   T02 · T03 · T04           3 en paralelo
Paso 3   T05                       1 agente, depende de T03
```

**T01 no está terminada hasta que su verificación (tsc --noEmit en ambos repos) pasa.** La ola 2 no
arranca antes. T02/T03/T04 pueden arrancar los tres juntos apenas T01 cierra, porque cada uno se
escribe contra los **tipos** que T01 declaró, no contra la implementación de las otras dos — ver
00-PLAN §7 para el razonamiento completo de por qué no hace falta que T02 espere a que T03 exista de
verdad.

**Si preferís ir de a uno:** T01 → T02 → T03 → T04 → T05. Ir T02 antes que T03 permite probar el
endpoint nuevo con curl antes de que el cron de checkout-kashhhpay le mande tráfico real.

---

## Preámbulo (va al inicio de cada prompt)

> Este módulo conecta `checkout-kashhhpay` (checkout propio sobre Whop) con `dashboard-admin` (el
> panel de ventas) y con Meta Conversions API, para reemplazar el flujo de Hotmart sin perder
> atribución de ventas ni tracking de Facebook Ads. Ambos repos están en producción con datos reales.
>
> Leé estos archivos completos antes de escribir código, en este orden:
> 1. `checkout-kashhhpay/tasks/panel-y-capi/00-PLAN-PANEL-Y-CAPI.md`
> 2. `checkout-kashhhpay/tasks/panel-y-capi/<TU-TASK>.md`
>
> El plan ya tiene fase de verificación corrida (`_verificacion-checkout-propio.sql`) — no
> re-verifiques el regex de extracción de IDs de Meta ni el formato de `fbc`, ya están probados.
>
> Reglas que no se negocian:
> - **Solo escribís los archivos de tu fila en §8 del plan.** Otros agentes trabajan en paralelo. Si
>   creés que necesitás tocar uno ajeno, anotalo en §10 del plan y seguí con lo que sí podés.
> - **Hay una lista de archivos que NADIE toca** (§8 del plan): `lib/whop.ts`, `lib/whop-webhook.ts`,
>   `lib/cobros.ts` (excepto lectura), `lib/reconciliacion.ts`, `lib/funnels.ts` en checkout-kashhhpay;
>   `lib/orders/upsert.ts`, `lib/orders/attribution.ts`, `lib/orders/resolve.ts` en dashboard-admin.
>   Son caminos que hoy funcionan en producción.
> - **No instalás dependencias ni editás ningún `package.json`.** Este módulo no necesita ninguna
>   dependencia nueva (Meta CAPI se llama con `fetch` nativo, igual que ya hace testfunnel).
> - **No cambiás el esquema ni los contratos.** Los tipos de §4/§5/§6 del plan están congelados porque
>   otras tasks se escriben contra ellos al mismo tiempo.
> - **Si aparece una decisión que el plan no resuelve, no la decidís en el código:** va a §10 del plan.
>   Si bloquea tu propia task, parás y avisás; si no bloquea, la anotás y seguís.
> - **El idioma de comentarios y nombres es castellano**, con el mismo tono directo que ya usa el
>   código existente ("no se puede", "hace falta", explicando el bug que cada regla evita) — leé
>   cualquier archivo de `lib/` de cualquiera de los dos repos para el tono exacto antes de escribir.
> - **Al terminar, corré tu sección de Verificación COMPLETA y pegá la salida real.** Si algo falla,
>   arreglalo antes de decir que terminaste. "Compila" no es verificación.

## Paso 1

### T01 — Fundación: contratos en código real
> [preámbulo, con `<TU-TASK>` = `T01-fundacion.md`]
>
> Declará los tres contratos (payload de venta, evento CAPI, `PayloadIngest` extendido) como tipos
> TypeScript reales, en los dos repos. No implementás ninguna función con lógica real — solo formas.
>
> Atención especial:
> - Los dos repos NO comparten paquetes: el contrato A se declara en ambos lados, con un comentario de
>   "espejo" en cada uno apuntando al otro. Si en algún momento encontrás que SÍ hay un mecanismo de
>   tipos compartido entre los repos (un workspace, un paquete privado), pará: es información que
>   invalida esta parte del diseño y hay que avisar antes de seguir.
> - `lib/salidas.ts` ya existe con contenido real — tu único cambio ahí es agregar el campo `utms`
>   opcional al tipo `PayloadIngest`, sin tocar ninguna función.

## Paso 2 (los tres en paralelo, apenas T01 cierra)

### T02 — Endpoint `/api/webhooks/checkout-propio` en dashboard-admin
> [preámbulo, con `<TU-TASK>` = `T02-endpoint-dashboard-admin.md`]
>
> Repo: **dashboard-admin**. Creá el endpoint que recibe la venta de checkout-kashhhpay y la inserta en
> `orders` con `source='checkout_propio'`, reusando el patrón de `/api/webhooks/shopify` (idempotencia,
> logging en `webhook_events`) y de `/api/ingest` (autenticación Bearer).
>
> Atención especial:
> - `resolveFunnel()`/`resolveTier()` de `lib/orders/resolve.ts` se USAN, no se modifican — el
>   mecanismo de atribución por `product_map` ya soporta un `shop_domain` custom sin cambios.
> - Las 5 columnas UTM de `orders` son `NOT NULL DEFAULT '(directo)'`: nunca insertes NULL ahí.
> - `fbclid` sí es nullable: vacío se guarda NULL, no `''`.
> - Hay una pregunta abierta (P-02, §10 del plan) sobre qué funnel/key usar en producción — no la
>   resuelvas por tu cuenta, dejá el mecanismo genérico y usá un valor de prueba explícito.

### T03 — Captura de UTMs/fbclid y reenvío al panel (checkout-kashhhpay)
> [preámbulo, con `<TU-TASK>` = `T03-utms-checkout-kashhhpay.md`]
>
> Repo: **checkout-kashhhpay**. Extendé `POST /api/checkout/sesion` para aceptar `fbclid`, extendé
> `armarPayloadIngest` para incluir las UTMs, y agregá una función nueva que arma el payload del
> contrato A para mandarlo al endpoint de T02 desde el cron de salidas.
>
> Atención especial:
> - Tocás SOLO el bloque de modo normal de `checkout/sesion/route.ts` — el bloque de modo recuperación
>   es de T05, que corre después.
> - `armarPayloadIngest` NO deja de omitir ventas sin `session_id`/`visitor_id` para el reporte de
>   TRACKING (`/api/ingest`) — esa regla no cambia. Pero la función nueva para el contrato A (la venta
>   con monto) NO tiene ese requisito: una venta real no puede desaparecer del dashboard de facturación
>   solo porque no se pudo atar a una sesión.
> - Necesitás dos env vars nuevas (`PANEL_VENTAS_URL`/`KEY`), distintas de `PANEL_INGEST_URL`/`KEY` que
>   ya existen — son dos endpoints con dos propósitos distintos, no lo mezcles.

### T04 — Módulo Meta Conversions API (checkout-kashhhpay)
> [preámbulo, con `<TU-TASK>` = `T04-capi-checkout-kashhhpay.md`]
>
> Repo: **checkout-kashhhpay**. Creá `lib/capi.ts`, calco de `testfunnel/lib/tracking.ts`
> (`sendCapiEvent`), sin el allowlist de datos de salud (no aplica a este checkout). Integralo en el
> cron de salidas como un tercer paso independiente del reporte al panel.
>
> Atención especial — **la trampa más probable de esta task:**
> - `custom_data.value` va en **monto DECIMAL** (ej. `29.90`), NO en centavos. `lib/salidas.ts` usa
>   centavos para su propio payload — si copiás esa convención acá, Meta va a recibir un `value` 100
>   veces más grande del real y el ROAS reportado va a estar completamente mal, sin ningún error que lo
>   avise.
> - `event_time` es en SEGUNDOS unix; el `creationTime` dentro del string `fbc` es en MILISEGUNDOS. Son
>   dos unidades distintas en el mismo evento — confirmalo con el test del paso 5.3/5.2 de tu task antes
>   de dar por terminado.
> - Un fallo de red a Meta no debe hacer fallar el reporte al panel (son dos efectos independientes del
>   mismo cron).

## Paso 3 (depende de T03)

### T05 — Metadata de UTMs en los upsells de Whop
> [preámbulo, con `<TU-TASK>` = `T05-metadata-upsells.md`]
>
> Repo: **checkout-kashhhpay**. Agregá las UTMs de la orden al objeto `metadata` que ya se manda a
> Whop en los tres call sites de upsell/recuperación (que sí soportan metadata, a diferencia del pago
> del front).
>
> Atención especial:
> - Es puramente aditivo: NO cambiás qué lee `armarPayloadIngest`/`armarEventoCapi` — esos siguen
>   leyendo de la base propia, nunca de lo que Whop devuelva. Esto es solo para que la metadata sea
>   visible si alguien mira el objeto Payment de Whop directamente.
> - Tocás SOLO el bloque de modo recuperación de `checkout/sesion/route.ts` — el de modo normal es de
>   T03, que ya corrió antes.

---

## Qué revisar cuando terminan

```bash
# 1 — compila, buildea, tests — en AMBOS repos
cd checkout-kashhhpay && npm run build && npm test
cd ../dashboard-admin && npm run build && npm test

# 2 — la verificación bloqueante del módulo: el endpoint nuevo existe y rechaza sin credencial
curl -s -X POST http://localhost:3000/api/webhooks/checkout-propio -d '{}' -H "content-type: application/json"
# esperado: 401

# 3 — las afirmaciones lógicas siguen en verde (regex de Meta, formato fbc, centavos)
psql -f checkout-kashhhpay/tasks/panel-y-capi/_verificacion-checkout-propio.sql
# esperado: los mismos resultados que ya quedaron documentados en el archivo (todos ok=t)

# 4 — NADA DE LO QUE YA FUNCIONABA CAMBIÓ
git -C dashboard-admin diff --stat -- lib/orders/upsert.ts lib/orders/attribution.ts lib/orders/resolve.ts
git -C checkout-kashhhpay diff --stat -- lib/whop.ts lib/whop-webhook.ts lib/cobros.ts lib/funnels.ts
# esperado: sin salida en los dos comandos (0 archivos)

# 5 — los endpoints nuevos rechazan sin credencial (ya cubierto en el paso 2, repetido acá por si
#     se corre este bloque aislado)

# 6 — el punto que decide si el módulo se puede encender en producción
grep -E "PANEL_VENTAS_URL|PANEL_VENTAS_KEY|META_PIXEL_ID|META_CAPI_TOKEN" checkout-kashhhpay/.env.example
# esperado: las 4 variables documentadas (aunque vacías)

# 7 — el circuito completo, a mano: crear una orden real de prueba en checkout-kashhhpay, pagarla en
#     modo sandbox de Whop si existe, y confirmar que aparece en dashboard-admin.orders con
#     source='checkout_propio' Y que Meta Events Manager (Test Events) recibe el Purchase.

# 8 — el estado final es el seguro: sin PANEL_VENTAS_URL/KEY ni META_PIXEL_ID/TOKEN configurados en
#     el .env real, el cron sigue corriendo sin romperse (modo no-op) — confirmarlo corriendo el cron
#     manualmente en un entorno sin esas 4 vars seteadas.

# 9 — leé las preguntas abiertas que quedaron (00-PLAN §10): P-01 (verificación de schema contra la
#     base real, no solo scratch local), P-02 (qué funnel/key usar en prod), P-03 (dominio real de
#     event_source_url), P-04 (encender PANEL_INGEST_URL/KEY, ya documentado en el propio repo antes
#     de este módulo), P-05 (mismo Pixel ID que testfunnel o uno nuevo).
```

Si el punto 2 o el punto 4 no dan lo esperado, el módulo no está listo para producción aunque el resto
compile: el punto 2 es la garantía de que el endpoint no queda abierto sin autenticación, y el punto 4
es la garantía de que este trabajo no rompió el revenue de Shopify que hoy sostiene el negocio.
