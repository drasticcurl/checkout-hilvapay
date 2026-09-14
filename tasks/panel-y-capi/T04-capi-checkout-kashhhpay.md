# T04 — checkout-kashhhpay: módulo Meta Conversions API (`lib/capi.ts`)

- **Depende de:** T01 (contrato B, `capi-tipos.ts`)
- **Bloquea:** nada
- **Se puede correr en paralelo con:** T02, T03
- **Repo:** checkout-kashhhpay
- **Archivos que este task puede tocar:**
  - `lib/capi.ts` (nuevo)
  - `lib/capi.test.ts` (nuevo)
  - `app/api/cron/salidas/route.ts` (agregar la llamada dentro de `procesarFila`, sin tocar el resto
    de la función)
  - `.env.example` (agregar `META_PIXEL_ID`/`META_CAPI_TOKEN`/`CHECKOUT_BASE_URL` si no existen)

Leé `00-PLAN-PANEL-Y-CAPI.md` completo, en particular **§1 D6-D9, §5 (contrato B, ya declarado por T01
en `lib/capi-tipos.ts` — IMPORTALO, no lo redeclares), §10 P-03 y P-05**.

**Antes de escribir, leé `testfunnel/lib/tracking.ts` completo** (está en un repo hermano,
`/Users/lucho/Desktop/funnel/testfunnel/lib/tracking.ts` — leelo desde ahí, no hace falta copiarlo al
repo de checkout-kashhhpay). Es el archivo que vas a calcar. Qué copiar literal: la función
`sendCapiEvent` completa (multi-pixel, manejo de errores, logging de `events_received`/`fbtrace_id`), el
patrón `getCapiTargets()` de leer env vars separadas por coma y emparejarlas por posición, y
`hashEmail()`. Qué NO copiar: el `META_CUSTOM_DATA_ALLOWLIST` — ese allowlist existe en testfunnel por
un incidente específico con datos de salud de un quiz; checkout-kashhhpay no tiene ese problema (no
maneja datos de salud), así que **no repliques el allowlist**, mandá `custom_data: {value, currency}`
directo, son los únicos dos campos que este módulo necesita.

## 1. Objetivo

Cuando termines:
- `lib/capi.ts` exporta `armarEventoCapi(datos: FilaCobroParaSalida): ResultadoArmadoCapi` (pura) y
  `sendCapiEvent(evento: EventoCapiPurchase): Promise<{ok, reason?, error?}>` (efecto).
- El cron de salidas llama a las dos, en el mismo ciclo que ya reporta al panel, para cada cobro con
  `whop_payment_id` y `monto`.
- Sin `META_PIXEL_ID`/`META_CAPI_TOKEN` configurados: no-op silencioso, el cron sigue funcionando
  normal para el resto de los pasos (panel, email).
- Un fallo de red hacia Meta no hace fallar el reporte al panel ni viceversa (D9).

**Este task no toca `lib/salidas.ts` (ese es T03 — vos solo LEÉS `FilaCobroParaSalida` desde ahí, es un
tipo que ya existe, no lo modificás). No implementa deduplicación con un pixel de browser (no existe
ese pixel en este checkout — D9 del §0 "no se construye").**

## 2. `armarEventoCapi` — pura

```ts
export function armarEventoCapi(datos: FilaCobroParaSalida): ResultadoArmadoCapi {
  const { cobro, orden, pagina } = datos;

  if (!cobro.whop_payment_id) {
    return { ok: false, motivo: 'omitida: el cobro no tiene whop_payment_id todavía' };
  }
  if (cobro.monto == null) {
    return { ok: false, motivo: 'omitida: el cobro no tiene monto' };
  }

  // ... construir el evento, ver reglas abajo ...
}
```

Reglas de implementación (todas del contrato B, §5 del plan, no las cambies):
1. `event_time`: `Math.floor(cobro.updated_at.getTime() / 1000)` — unix seconds, no milisegundos (la
   doc de Meta pide segundos; confundirlo con milisegundos manda un timestamp ~53 años en el futuro y
   Meta rechaza el evento entero).
2. `event_id: cobro.whop_payment_id`.
3. `event_source_url`: `` `${process.env.CHECKOUT_BASE_URL ?? 'https://pay.hilvanapp.com'}/pagos/${pagina.slug}` ``
   — el default es el dominio que aparece en `HANDOFF-DNS.md`/`README.md` de este repo (confirmalo
   leyendo esos archivos; si el dominio real es otro, usá ese y anotalo en P-03, no lo dejes
   hardcodeado sin más).
4. `custom_data.value`: **el monto DECIMAL, no centavos.** `Number(cobro.monto)` directo — NO uses la
   función `centavos()` de `lib/salidas.ts` acá, es la trampa que el plan marca en la regla 3 del
   contrato B. Si tenés duda, mirá el ejemplo oficial de Meta citado en el plan: `"value": "142.52"`.
5. `custom_data.currency`: `(cobro.moneda ?? datos.producto.moneda).toLowerCase()`.
6. `user_data.em`: si `orden.email` existe, `[hashEmail(orden.email)]` (mismo `hashEmail` que copiaste
   de testfunnel). Si no hay email, la clave `em` se omite del objeto (no se manda `undefined`).
7. `user_data.fbc`: si `orden.utms?.fbclid` existe (asumiendo que T03 eligió la Opción A — si eligió
   la Opción B, ajustá la lectura acá y anotalo), se formatea:
   `` `fb.1.${cobro.updated_at.getTime()}.${orden.utms.fbclid}` `` — `subdomainIndex = 1` fijo (D6),
   `creationTime` en MILISEGUNDOS (a diferencia de `event_time`, que es en segundos — la doc de Meta
   para `fbc` específicamente pide milisegundos, no lo iguales a `event_time`). Si no hay `fbclid`, la
   clave `fbc` se omite.
8. **Si NO hay `em` NI `fbc`**: el evento se arma igual (regla 2 del contrato B) — no es motivo de
   `{ok: false}`. Logueá un `console.warn` desde `sendCapiEvent` o desde el caller (tu elección) para
   que quede rastro de que ese evento tuvo matching pobre, pero no lo bloquees.

## 3. `sendCapiEvent` — efecto, calcado de testfunnel

Mismo cuerpo que `testfunnel/lib/tracking.ts`, adaptado al tipo `EventoCapiPurchase` de este repo (que
es más chico: no tiene `content_ids`/`content_name`/etc., solo `value`/`currency`). Mantené:
- El multi-pixel por posición (`getCapiTargets()`).
- El log de `events_received`/`messages`/`fbtrace_id` — es lo que permite diagnosticar en producción
  si Meta aceptó pero no contó el evento.
- `Promise.all` sobre los targets, `ok` si al menos uno aceptó.

## 4. Integración en el cron

En `app/api/cron/salidas/route.ts`, dentro de `procesarFila` (después de `reportarAlPanel`, antes o
después de `mandarEmailSiCorresponde` — el orden entre estos tres no importa porque son independientes,
D9):

```ts
const capi = await reportarACapi(datos); // función nueva en lib/capi.ts o en el propio route.ts, tu elección
```

`reportarACapi` envuelve `armarEventoCapi` + `sendCapiEvent`, devolviendo la misma forma
`{ok: boolean; reintentar: boolean; motivo?: string}` que ya usa `reportarAlPanel`, para que
`procesarFila` pueda tratarlas de forma uniforme. **Un fallo de CAPI marca `reintentar: false`** (a
diferencia de un fallo del panel, que sí reintenta): la doc de Meta no da garantías de idempotencia por
`event_id` duplicado del lado del servidor (Meta puede aceptar el mismo `event_id` dos veces sin
deduplicar del lado de ingestión — la deduplicación es contra el Pixel de browser, no contra reenvíos
del propio servidor) — reintentar un envío a CAPI indefinidamente arriesga mandar el mismo evento
varias veces a Meta sin el mecanismo de dedup que sí protege al par Pixel+CAPI. Preferible loguear el
fallo y seguir, que el usuario pueda ver en logs si CAPI falla sistemáticamente.

## 5. Tests

En `lib/capi.test.ts`:
1. `armarEventoCapi` sin `whop_payment_id` → `{ok: false, motivo: ...}`.
2. `armarEventoCapi` con datos completos (email + fbclid) → `evento.user_data` tiene `em` (array de 1
   string de 64 hex chars) y `fbc` con el formato `fb.1.<numero>.<fbclid>`.
3. `armarEventoCapi` con `custom_data.value`: confirmá que para `cobro.monto = '1234567.89'` el valor
   es el número `1234567.89`, NO `123456789` (es el caso que distingue este archivo de
   `lib/salidas.ts` — la regla 3 del contrato B).
4. `armarEventoCapi` sin email ni fbclid → `{ok: true, evento}` con `user_data` sin las claves `em`/
   `fbc` (objeto vacío o sin esas keys, no `undefined` en el valor).
5. `sendCapiEvent` sin `META_PIXEL_ID` configurado → `{ok: false, reason: 'env_missing'}`, sin hacer
   ningún `fetch` (mockeá `fetch` global y confirmá 0 llamadas).

## 6. Verificación

```bash
# 1 — tests
npm test -- capi
# esperado: los 5 casos del paso 5 en verde

# 2 — build
npm run build
# esperado: exit code 0, sin líneas "Failed to compile"

# 3 — sin env vars, el cron no rompe
unset META_PIXEL_ID META_CAPI_TOKEN
npm test -- cron
# esperado: los tests del cron existentes siguen pasando (CAPI es no-op)

# 4 — confirmar el valor decimal, no centavos (el caso que más se presta a error)
node -e "console.log(Number('1234567.89'))"
# esperado exactamente: 1234567.89 (no 123456789)
```

## 7. Cuándo parar

**Bloqueante, pará y avisá:**
- Si `FilaCobroParaSalida` (el tipo que importás de `lib/salidas.ts`, escrito por T01) no existe
  todavía o tiene una forma distinta a la que este task asume — coordiná con T01/T03 antes de seguir.

**Anotalo en §10 del plan y seguí:**
- P-03 (dominio real de `event_source_url`): usá el default documentado y anotá cuál usaste.
- P-05 (mismo Pixel ID que testfunnel o uno nuevo): dejá el mecanismo genérico, el usuario decide el
  valor al configurar el `.env` real.
