# T05 — checkout-kashhhpay: UTMs en `metadata` de Whop para upsells

- **Depende de:** T03 (reusa cómo T03 dejó guardado `fbclid`/`utms` en la orden — leé qué decidió T03
  en el paso 2 de su archivo antes de empezar esta)
- **Bloquea:** nada
- **Se puede correr en paralelo con:** nada de la ola 2. **Corre después, sola o junto a cualquier otra
  task de una ola 3 si el módulo tuviera más (no las tiene).**
- **Repo:** checkout-kashhhpay
- **Archivos que este task puede tocar:**
  - `app/api/checkout/sesion/route.ts` (**solo el bloque de modo recuperación** — líneas ~140-180
    aprox., la llamada a `crearCheckoutConfiguration`. NO el bloque de modo normal, que es de T03)
  - `app/api/upsell/sesion/route.ts`
  - `app/api/upsell/cobrar/route.ts`

Leé `00-PLAN-PANEL-Y-CAPI.md` completo, en particular **§1 D10 y §0 ("no se construye": por qué el
front NO lleva metadata, solo los upsells)**.

**Antes de escribir, leé los tres archivos que vas a tocar, completos**, y en particular las llamadas
existentes a `crearCheckoutConfiguration`/`crearPagoOffSession` con su `metadata: { orden_id,
pagina_id }` actual. Qué copiar: la forma exacta en que esos dos campos ya se pasan hoy — vas a agregar
keys al mismo objeto, no a crear una segunda llamada. Qué NO tocar: el mecanismo de `idempotencyKey`, el
`threeDsLevel`, ni ningún otro parámetro de esas llamadas — tu cambio es aditivo, una sola línea por
call site (agregar las keys de `metadata`).

## 1. Objetivo

Cuando termines, las tres llamadas a Whop que hoy mandan `metadata: { orden_id, pagina_id }` mandan
`metadata: { orden_id, pagina_id, ...utmsDeLaOrden }`, donde `utmsDeLaOrden` son las UTMs (y `fbclid`,
si T03 lo guardó dentro del mismo objeto `utms`) de la orden asociada a ese cobro.

**Este task no cambia qué hace el dato en el resto del sistema.** El plan (D10) es explícito: esto es
redundancia informativa para cuando alguien mire el objeto Payment de Whop directamente (soporte,
debugging), no una fuente de verdad nueva — `armarPayloadIngest`/`armarPayloadVentaPanel`/
`armarEventoCapi` (T03/T04) siguen leyendo de `orden.utms` en la base propia, nunca de lo que Whop
devuelva en su metadata. **No tocás ninguno de esos tres archivos.**

## 2. Función helper (opcional, recomendada)

Si los tres call sites necesitan la misma lógica de "tomar las UTMs de la orden y aplanarlas para
meterlas en metadata", extraé un helper chiquito en `lib/tipos.ts` o en un archivo nuevo
`lib/metadata-whop.ts` — tu elección, documentala:

```ts
/**
 * Aplana las UTMs de una orden para meterlas en metadata de Whop. Whop acepta
 * Record<string, unknown> sin schema fijo (confirmado en la doc oficial,
 * research previo del análisis) — no hace falta stringify ni anidar.
 *
 * Trunca valores a un largo razonable (ver nota abajo) porque no hay
 * documentación pública de límites de tamaño de metadata en Whop.
 */
export function utmsParaMetadataWhop(
  utms: Record<string, string> | null,
): Record<string, string>;
```

**Nota de la fase de research (no verificado por Whop directamente, es una precaución por analogía):**
la investigación previa a este plan no encontró una página pública de límites de tamaño para
`metadata` de Whop. Truncá cada valor a, por ejemplo, 500 caracteres (el límite que Stripe usa para un
campo análogo) como precaución razonable, no como un valor confirmado — dejalo como una constante fácil
de ajustar si en algún momento Whop documenta su propio límite.

## 3. Los tres call sites

En cada uno de los tres archivos, el cambio es de una línea dentro del objeto `metadata` ya existente:

```ts
// Antes:
metadata: { orden_id: orden.id, pagina_id: pagina.id }

// Después:
metadata: { orden_id: orden.id, pagina_id: pagina.id, ...utmsParaMetadataWhop(orden.utms) }
```

Confirmá en cada archivo que la variable `orden` (o como se llame en ese scope) esté disponible en el
punto donde se construye `metadata` — en algunos call sites puede hacer falta traerla con una query
adicional si no está ya cargada en ese momento del handler (leé el código real antes de asumir que ya
está disponible).

## 4. Tests

En un test nuevo o extendiendo uno existente de cada archivo (si ya tienen `.test.ts` — confirmalo
antes de crear uno nuevo):
1. `utmsParaMetadataWhop({utm_campaign: 'X|123', fbclid: 'abc'})` → `{utm_campaign: 'X|123', fbclid:
   'abc'}` (todo pasa, sin filtrar nada — a diferencia de `extraerUtmsLimpias` de T03, este helper no
   necesita excluir `fbclid`, porque acá SÍ tiene sentido que viaje en la metadata de Whop).
2. `utmsParaMetadataWhop(null)` → `{}` (objeto vacío, no `null` — Whop espera un objeto, spread de
   `{}` no rompe el objeto `metadata` resultante).
3. Un valor de más de 500 caracteres → se trunca a 500.

## 5. Verificación

```bash
# 1 — tests
npm test -- metadata-whop
# esperado: los 3 casos del paso 4 en verde

# 2 — build
npm run build
# esperado: exit code 0, sin líneas "Failed to compile"

# 3 — nada de lo que ya funcionaba cambió: los tests existentes de estos 3 archivos siguen pasando
npm test -- checkout/sesion upsell/sesion upsell/cobrar
# esperado: mismos resultados que antes de este cambio (comparar cantidad de tests en verde antes/después)

# 4 — confirmar en un curl real que orden_id/pagina_id siguen viajando (no se rompieron por el spread)
# (requiere un flujo de upsell real levantado; documentar el resultado manual si no hay entorno de prueba)
```

## 6. Cuándo parar

**Bloqueante, pará y avisá:**
- Si algún call site NO tiene la orden cargada en el scope donde se construye `metadata`, y traerla
  requeriría una query nueva que toque un archivo fuera de tu ownership (por ejemplo, si hay que
  modificar una función de `lib/cobros.ts` para que devuelva la orden completa) — es una decisión de
  diseño que va a §10, no un ajuste que decidís solo.

**Anotalo en §10 del plan y seguí:**
- El límite de 500 caracteres para truncar valores de metadata es una precaución, no un valor
  confirmado por Whop — si en algún momento aparece la documentación real del límite, hay que ajustar
  esta constante.
