# Prompts para Claude Code — checkout propio sobre Whop

## Antes de arrancar

```
tasks/checkout-whop/
├── 00-PLAN-CHECKOUT-WHOP.md      el documento maestro. TODOS lo leen completo
├── PROMPT-CLAUDE-CODE.md         este archivo
├── _schema-checkout.sql          el DDL, YA CORRIDO dos veces contra Postgres 16.14
├── _verificacion-checkout.sql    11 afirmaciones del esquema, YA EN VERDE
├── T01-cimientos.md              va sola y primero. Es la compuerta
├── T02-panel-admin.md            ola 2
├── T03-checkout-front.md         ola 2
├── T04-cobro-one-click.md        ola 2 — el task que cobra plata
├── T05-salida-panel-emails.md    ola 2
└── T06-boton-en-testfunnel.md    ola 3, OTRO REPO (testfunnel)
```

**Lo que ya está verificado, y por qué eso ahorra días.** Los dos archivos `_*` no son documentación:
son ejecutables que ya dieron el resultado que dicen.

- **El esquema corrió**, dos veces, exit 0 las dos. Es idempotente. Nadie lo retipea.
- **Las 11 afirmaciones del esquema están en verde**, incluida la que prueba que un doble click no
  puede crear dos cobros del mismo link.
- **59 tests de lógica pasan** (`lib/estado-pago.test.ts` 44, `lib/whop-webhook.test.ts` 15). Ahí
  vive el mapeo de los 90 `decline_code` de Whop y la verificación de la firma del webhook.
- **`npx tsc --noEmit` exit 0 y `npx next build` compila** con los cimientos ya escritos.

Y tres cosas que se verificaron contra la doc de Whop y **contradicen** lo que parecía obvio. Están en
el plan como D2, D3 y D4, y si un agente las "corrige" rompe el módulo:

1. **No existe el substatus `requires_action`.** El 3DS llega como `failed` + `decline_code`.
2. **`standardwebhooks` NO sirve** para verificar la firma de Whop con su comportamiento por defecto:
   hace `base64.decode()` de un secret que es un string literal `ws_`. Y el helper oficial del SDK
   **todavía no existe** ("lands in the next release", dice la propia doc).
3. **El `/api/ingest` del `dashboard-admin` espera el importe en CENTAVOS enteros** (`value_cents`,
   `bigint`), y `cobros.monto` está en unidades. La conversión va con `Math.round`, y se verificó que
   truncar pierde un centavo en importes grandes.

### 6 cosas que hay que saber antes de largar el primer agente

**1. T01 va sola y primero.** Declara `lib/tipos.ts`, que las otras cuatro importan. Si arrancan en
paralelo, cuatro agentes escriben cuatro versiones del mismo tipo y ninguna compila con las otras.

**2. T01 es una COMPUERTA que puede detener el proyecto.** Ninguna llamada a la API de Whop se pudo
probar cuando se escribió el plan, porque no había API key. La sección 6 de T01 son dos `curl` de
lectura que confirman el `Api-Version-Date` y los permisos. **Si eso no da 200, no arranca la ola 2**:
`lib/whop.ts` podría tener que cambiar y las cuatro tasks se escribirían contra una base falsa.

**3. Este módulo cobra tarjetas de crédito reales sin que la persona vuelva a intervenir.** Un bug no
devuelve un 500: cobra dos veces, o le cobra a la persona equivocada. Las defensas son estructurales y
no negociables: un índice único de la base contra el doble cobro, un `CHECK` para los estados, y la
regla de que ante la duda un cobro queda en `procesando` y nunca en `fallido`.

**4. Nada de esto se enciende solo.** Todo lo que se crea nace inactivo, la API apunta al sandbox, y
los emails arrancan apagados con el interruptor **en la base y no en un env var** — precisamente para
poder frenar un cobro que sale mal sin esperar un redeploy. Hay verificaciones que prueban el estado
apagado, no que lo asumen.

**5. No hay tráfico corriendo en los funnels**, así que no hay convivencia con KashPay y no hay
interruptor de pasarela: T06 reemplaza los botones directo y la vuelta atrás es un `git revert`
probado. Lo que **sí** es intocable en `testfunnel` es el **copy**: es texto final aprobado y los
precios salen de `lib/quiz-v2/config-latam.ts`. El freno de emergencia real está del lado del panel,
apagando `paginas.activo`, que corta el cobro sin redeploy.

**6. El plan es el contrato.** Las secciones §4, §5 y §6 están congeladas: son las fronteras entre
tasks y entre este repo y los funnels. Si aparece una decisión que el plan no resuelve, **va a §10, no
al código**. Un agente que decide solo produce una pieza que no encaja con la que decidió distinto al
lado.

## El orden

```
Paso 1   T01                              1 agente, SOLO      ← compuerta
Paso 2   T02 · T03 · T04 · T05            4 en paralelo
Paso 3   T06                              1 agente, otro repo ← solo con el paso 2 probado en sandbox
```

**Una task bloqueante no está terminada hasta que su verificación pasa.** La ola 2 no arranca antes de
que T01 corra su sección 8 completa, incluida la compuerta de la API de Whop.

Por qué las cuatro de la ola 2 pueden ir juntas aunque T04 consuma lo que produce T03: **consumen el
tipo, no la implementación**. Para T04 el token de la orden es un string opaco; le da igual cómo lo
generó T03. Y las verificaciones de T04 y T05 traen su propio SQL de seed, así que ninguna necesita que
la otra exista para probarse.

Por qué no hay un quinto agente en la ola 2: **no hay una quinta pieza independiente.** El límite son
las dependencias, no los slots.

**Si preferís ir de a uno:** T01 → T03 → T04 → T02 → T05 → T06. Ese orden te deja cobrando en sandbox
lo antes posible, y deja para el final lo que escribe en sistemas externos (T05 postea al panel y manda
emails; T06 toca el funnel que factura).

---

## Preámbulo (va al inicio de cada prompt)

> Trabajás en `~/Desktop/funnel/checkout/checkout-kashhhpay`, un servicio nuevo que reemplaza a
> KashPay como capa de checkout sobre Whop. **Todavía no está desplegado y los funnels no tienen
> tráfico corriendo** (el usuario no está pagando anuncios), así que no hay ventas en riesgo. Lo que
> **sí** está en producción con datos reales es el `dashboard-admin` al que este servicio le reporta.
>
> Leé estos archivos completos antes de escribir código, en este orden:
> 1. `tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md`
> 2. `tasks/checkout-whop/<TU-TASK>.md`
>
> Los cimientos ya están escritos y verificados: `lib/db.ts`, `lib/whop.ts`, `lib/estado-pago.ts`,
> `lib/whop-webhook.ts`, `lib/cobros.ts`, `app/api/webhooks/whop/route.ts`,
> `db/migrations/001_init.sql` y el scaffold de Next. **No los reescribas**: 59 tests y 11
> afirmaciones de SQL dependen de su comportamiento exacto. Leelos y llamalos.
>
> Reglas que no se negocian:
> - **Solo escribís los archivos de tu fila en §8 del plan.** Otros agentes trabajan en paralelo. Si
>   creés que necesitás tocar uno ajeno, anotalo en §10 y seguí.
> - **Hay una lista de archivos que NADIE toca** (§8). Son caminos verificados o que hoy facturan.
> - **No instalás dependencias ni editás `package.json`.** T01 declaró todo, incluido lo de tasks que
>   todavía no existen. Si falta algo, va a §10.
> - **No cambiás el esquema ni los contratos.** `db/migrations/001_init.sql` YA CORRIÓ. Si hace falta
>   una columna, es una migración nueva y aditiva (`002_*.sql`), nunca un cambio de la 001.
> - **Si aparece una decisión que el plan no resuelve, no la decidís en el código:** va a §10 con el
>   formato que está ahí. Si bloquea, parás y avisás.
> - Convenciones del proyecto: **SQL siempre con parámetros `$1`, nunca interpolación**; comentarios y
>   UI **en castellano con voseo**; los comentarios explican **por qué**, no qué; tests con `vitest`.
> - **Al terminar, corré tu sección de Verificación COMPLETA y pegame la salida.** Si algo falla,
>   arreglalo antes de decir que terminaste. "Compila" no es verificación.

## Paso 1

### T01 — Cimientos, contratos y la compuerta de la API de Whop

> [preámbulo, con `<TU-TASK>` = `T01-cimientos.md`]
>
> Cerrá los cimientos: sacá los tipos de fila de `lib/cobros.ts` a un `lib/tipos.ts` nuevo con la
> forma exacta del §4 del plan, escribí `lib/auth.ts`, completá `package.json` y `vercel.json`, y
> re-confirmá que la API de Whop responde.
>
> Cuatro cosas con atención especial:
>
> **La API de Whop YA ESTÁ VERIFICADA** (2026-09-10) y los valores están en `.env.local`. La
> re-confirmación es un solo comando: `./scripts/configurar-env.sh --solo-verificar`. **No la
> verifiques con curl a mano**: hay tres endpoints que devuelven falsos negativos y te van a hacer
> creer que la compuerta está cerrada — `/accounts/me` da 403 por un scope que no está entre las 22,
> `/companies/me` devuelve otra company, y `/plans` sin `account_id` da 400. La sección 6 de tu task
> los enumera.
>
> **`lib/tipos.ts` lo importan cuatro tasks a la vez.** Un `any` ahí apaga el chequeo de tipos en las
> cuatro. Y `EstadoCobro` se re-exporta de `lib/estado-pago.ts`, no se redeclara: está atado al
> `CHECK` de la base.
>
> **`lib/auth.ts` tiene que usar `crypto.subtle` y no `node:crypto`.** Lo llama el middleware, que
> corre en el runtime edge, donde `node:crypto` no existe. Si te equivocás, el panel queda inaccesible
> con un error en runtime que no menciona crypto.
>
> **Si `npm run db:migrate` falla porque no hay base**, pará y avisá antes de seguir: sin base no se
> puede verificar nada de lo que viene después.

## Paso 2

### T02 — El panel

> [preámbulo, con `<TU-TASK>` = `T02-panel-admin.md`]
>
> Construí el panel: login, alta de productos asociando un plan de Whop, alta de links de pago,
> allowlist de orígenes, y una vista de solo lectura de los últimos cobros.
>
> Tres cosas con atención especial:
>
> **El matcher del middleware es lo más fácil de romper de todo el task.** Si agarra
> `/api/webhooks/whop`, Whop recibe 307 en vez de 200, reintenta, y a las 72 horas **deshabilita el
> webhook y no reenvía los eventos de ese período**. Escribilo como lista explícita de lo que SÍ se
> protege, nunca como "todo menos". La verificación tiene un paso dedicado a esto.
>
> **El aviso de precio de D10 es la única defensa contra publicar un link que dice $9.90 y cobra
> $17.** Va visible en la pantalla, no en un tooltip. Y no bloquea el guardado: un panel que no te deja
> guardar es un panel que se esquiva editando la base a mano.
>
> **Todo nace inactivo** y el switch pide confirmación al ENCENDER, no al apagar. Apagar siempre es
> seguro.

### T03 — La página de checkout

> [preámbulo, con `<TU-TASK>` = `T03-checkout-front.md`]
>
> Construí `/pagos/[slug]`: HTML propio con timer, card y campos, el embed de Whop adentro con el
> submit oculto, y el botón verde propio. Más los dos endpoints: crear sesión y reclamar el pago.
>
> Cuatro cosas con atención especial:
>
> **`setupFutureUsage="off_session"` es la prop de la que depende el módulo entero.** Sin eso Whop no
> guarda el método de pago y no hay upsell one-click. Si después de una compra exitosa con tarjeta
> `ordenes.whop_payment_method_id` queda en null, pará y avisá.
>
> **`hideTermsAndConditions` va en `false`.** Es tentador ocultarlo por diseño, pero ahí vive el
> consentimiento para guardar la tarjeta y cobrar después. Un one-click sin consentimiento visible es
> un contracargo indefendible.
>
> **El claim es sincrónico y no depende del webhook** (D8). Es lo que evita que la persona llegue al
> upsell antes de que exista su `payment_method_id`, que produce un fallo intermitente imposible de
> reproducir.
>
> **Armá la URL de éxito con `new URL`, no concatenando `?`.** Si la `url_exito` configurada ya tiene
> querystring, concatenar la rompe. Hay un test dedicado.

### T04 — El cobro one-click y el loader

> [preámbulo, con `<TU-TASK>` = `T04-cobro-one-click.md`]
>
> Construí `POST /api/upsell/cobrar`, `GET /api/cobros/[id]` y el `loader.js` que embeben los funnels.
>
> **Este es el task que cobra plata.** Cuatro cosas:
>
> **El INSERT del cobro con `ON CONFLICT DO NOTHING` va ANTES de llamar a Whop.** Si no insertó, se
> devuelve el cobro existente y **no se llama a Whop**. Invertir ese orden reabre el doble cobro, y la
> idempotencia de Whop no te cubre: si el segundo request nunca llega a Whop, no hay nada que
> replayar. La verificación 7 dispara cinco POST concurrentes y exige un solo `whop_payment_id`.
>
> **Ante la duda, `procesando`, nunca `fallido`.** Un timeout, un 5xx o un 409 de Whop NO significan
> que el cobro no salió. Un cobro marcado fallido que en realidad entró le niega el producto a alguien
> que pagó, y no te enterás salvo que reclame.
>
> **`Access-Control-Allow-Origin` nunca es `*` en el endpoint de cobro.** Devolvé el origen exacto que
> vino, validado contra la tabla `origenes` con comparación exacta (no `startsWith`:
> `https://mifunnel.com.evil.io` pasaría). Y hace falta el handler `OPTIONS`, o el POST nunca sale del
> navegador y el botón del funnel no hace nada sin ningún error visible.
>
> **El `loader.js` usa `sessionStorage`, nunca `localStorage`.** Con `localStorage` el token que
> habilita cobrar una tarjeta sobrevive al cierre del browser: en una computadora compartida, eso es un
> cobro a la tarjeta de un desconocido.

### T05 — La cola de salida y los emails

> [preámbulo, con `<TU-TASK>` = `T05-salida-panel-emails.md`]
>
> Construí el drenado de la cola `salidas`: reportar la venta al `/api/ingest` del `dashboard-admin` y
> mandar el email de entrega.
>
> Tres cosas con atención especial:
>
> **El panel espera CENTAVOS ENTEROS** (`value_cents`, `bigint`) y `cobros.monto` está en unidades.
> `Math.round(Number(monto) * 100)`, nunca truncando: está verificado que `1234567.89 * 100` da
> `123456788.99999999` y truncar pierde un centavo. Hay un test que fija ese caso.
>
> **Si la orden no tiene `session_id`/`visitor_id`, la venta NO se postea al panel.** El panel los
> exige como UUID y no se pueden inventar: un UUID falso crea una sesión fantasma que contamina para
> siempre los números con los que se decide gastar en ads. Se marca omitida con el motivo anotado.
>
> **El interruptor de emails vive en la base, no en un env var**, y arranca apagado. La verificación 4
> exige mirar el dashboard de Resend y confirmar CERO emails: ese cero es la prueba de que apagado no
> manda nada. Estás escribiendo en un sistema que le manda correo a compradores reales.

## Paso 3

### T06 — El botón en `testfunnel`

> [preámbulo, con `<TU-TASK>` = `T06-boton-en-testfunnel.md`]
>
> **OJO: este task trabaja en `~/Desktop/funnel/testfunnel`, no en el repo del checkout.**
>
> Reemplazá los botones de KashPay de las tres páginas de upsell por el botón del checkout propio.
>
> Tres cosas con atención especial:
>
> **No arranques si T02, T03 y T04 no están verificadas en sandbox.** Sin un link de pago que funcione
> no hay nada que probar y vas a dejar el funnel apuntando a un checkout que no cobra.
>
> **El copy es texto final aprobado y no se toca.** Los precios salen de `lib/quiz-v2/config-latam.ts`
> y ese archivo no se modifica. El paso 3 de la verificación exige que `git diff` de las páginas muestre
> **solo** la línea del botón. Si cambió una coma del copy, revertila.
>
> **La vuelta atrás es la única red de este task**, porque no hay interruptor de pasarela: no hay
> tráfico corriendo, así que el reemplazo es directo. El paso 5 de la verificación hace el `git revert`
> y exige que el build siga pasando. Si el revert deja el repo roto, no lo dejes así.

---

## Qué revisar cuando terminan

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay

# 1 — compila, buildea, tests
npx tsc --noEmit && npx next build && npx vitest --run
# esperado: exit 0, "✓ Compiled successfully", y >= 59 tests (los de los cimientos) + los nuevos

# 2 — la migración es idempotente
npm run db:migrate && npm run db:migrate
# esperado: la segunda vez "Nada nuevo que aplicar."

# 3 — las 11 afirmaciones del esquema siguen en verde
psql "$DATABASE_URL" -f tasks/checkout-whop/_verificacion-checkout.sql
# esperado: cada bloque da el valor que dice su encabezado

# 4 — EL DOBLE COBRO. Es lo que decide si el módulo se puede encender.
#     (verificación 7 de T04: cinco POST concurrentes)
psql "$DATABASE_URL" -tAc "select orden_id, pagina_id, count(*) from cobros group by 1,2 having count(*) > 1;"
# esperado exactamente: sin filas
psql "$DATABASE_URL" -tAc "select whop_payment_id, count(*) from cobros where whop_payment_id is not null group by 1 having count(*) > 1;"
# esperado exactamente: sin filas
# Y en el dashboard de Whop (sandbox): un pago por cobro, contados con los ojos.

# 5 — todo endpoint nuevo rechaza sin credencial
curl -s -o /dev/null -w 'admin:  %{http_code}\n' localhost:3010/api/admin/productos          # 401
curl -s -o /dev/null -w 'cron:   %{http_code}\n' localhost:3010/api/cron/salidas             # 401
curl -s -o /dev/null -w 'cobrar: %{http_code}\n' -X POST localhost:3010/api/upsell/cobrar \
     -H 'Origin: https://cualquiera.com' -d '{}'                                              # 403
curl -s -o /dev/null -w 'hook:   %{http_code}\n' -X POST localhost:3010/api/webhooks/whop -d '{}'
# esperado: 400 (firma inválida). Si da 307, el middleware se comió el webhook.

# 6 — el estado final es el SEGURO
psql "$DATABASE_URL" -tAc "select count(*) from paginas where activo;"    # esperado: 0
psql "$DATABASE_URL" -tAc "select count(*) from origenes where activo;"   # esperado: 0
psql "$DATABASE_URL" -tAc "select emails_activos from config;"            # esperado: f
grep WHOP_API_BASE .env.local                                            # esperado: sandbox-api

# 7 — NADA DE LO QUE YA FUNCIONABA CAMBIÓ
git diff --stat lib/estado-pago.ts lib/whop-webhook.ts lib/whop.ts lib/db.ts \
                app/api/webhooks/whop/route.ts db/migrations/001_init.sql
# esperado exactamente: sin salida
cd ~/Desktop/funnel/testfunnel
git diff lib/quiz-v2/config-latam.ts
# esperado exactamente: sin salida  ← ahí viven los precios
git diff app/upsell-latam/page.tsx app/upsell2-latam/page.tsx app/upsell3-latam/page.tsx
# esperado: SOLO la línea del botón y el comentario actualizado. Ni una coma de copy.
npx vitest --run lib/quiz-v2/garantia-latam.test.ts
# esperado: passed  ← es el test que verifica el copy de la garantía

# 8 — el circuito completo, a mano, en sandbox
#  comprar el front → caer en el upsell con ?ot= → un click cobra sin pedir datos →
#  los tres upsells → los cuatro cobros aparecen en el dashboard-admin con el
#  importe correcto → llega el email de entrega (si se encendió el interruptor)

# 9 — leé las preguntas abiertas que quedaron
grep -n '^### P-' tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md
grep -A2 'Resolución:$' tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md | grep -c 'Resolución:$'
# las que sigan sin resolver son decisiones que nadie tomó todavía
```

**Si el punto 4 no da, el módulo no se enciende.** Un checkout que cobra dos veces es peor que
KashPay cayéndose: KashPay que se cae pierde una venta, un doble cobro genera un reclamo, un
contracargo, y una reputación de procesador que después se paga en aprobaciones rechazadas.
