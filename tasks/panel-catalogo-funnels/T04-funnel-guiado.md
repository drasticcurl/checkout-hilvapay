# T04 — crear un funnel exige producto principal + página de gracias antes de seguir

> **Antes de leer una línea más:** leé `00-README-LEER-PRIMERO.md` de esta misma carpeta. La carpeta
> hermana `tasks/checkout-whop/` es solo referencia histórica — no la sigas.

- **Depende de:** T01 (`lib/tipos.ts` con las formas nuevas, para el selector de producto del
  asistente)
- **Bloquea:** nada
- **Se puede correr en paralelo con:** T02, T03, T05
- **Repo:** `checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/admin/(panel)/funnels/nuevo/page.tsx`,
  `app/admin/(panel)/funnels/FormularioPaso.tsx` (**solo** la parte de selector de tipo de paso /
  flujo — no el campo de slug, que es de T05). Nada más.

Leé `00-PLAN-PANEL-CATALOGO-FUNNELS.md` completo. Tu decisión es D8 de §1.

---

## 1. Objetivo

Cuando termines:

- Al crear un funnel nuevo (`/admin/funnels/nuevo`), la primera pantalla exige elegir el producto
  principal (front) **y** escribir la URL de la página de gracias antes de que aparezca cualquier
  forma de agregar un segundo paso.
- Una vez que las dos cosas están, el flujo continúa igual que hoy: se entra al editor
  (`EditorFunnel.tsx`) con el paso `front` ya creado y `url_gracias` ya seteada, listo para agregar
  upsells.

**Este task NO cambia `guardarFunnel` en `lib/admin/funnels.ts` (eso es de T01, y de todos modos la
validación de guardado no cambia — D8 es explícito: sigue siendo válido guardar un funnel de un solo
paso `front` sin upsells, lo que cambia es el flujo de LA PANTALLA de creación, no la regla de
negocio del backend). No toca `SnippetDelPaso` ni el campo de slug de un paso `upsell` — eso es T05.**

## 2. Leé el flujo actual antes de tocarlo

`app/admin/(panel)/funnels/nuevo/page.tsx` hoy monta `<EditorFunnel funnel={null} productos={...} />`
directo — el editor completo, vacío, sin ningún paso guiado previo. `EditorFunnel.tsx` en su estado
vacío (`pasos.length === 0`) solo muestra un texto ("El funnel está vacío. Empezá por el producto
principal...") y dos botones para "Agregar paso", que abren `FormularioPaso` sin restricción de
orden.

Lo que hay que agregar es un paso **previo** a eso: una pantalla (o un estado dentro de la misma
pantalla, a tu criterio de implementación — el plan no exige un route nuevo) que:

1. Pide el nombre del funnel (ya existe este campo, es el único dato de `EditorFunnel` que se pide
   arriba de todo).
2. Pide elegir el producto principal — el mismo selector de producto que ya usa `FormularioPaso`
   cuando el tipo es `front`, pero acá es el ÚNICO campo relevante (no tipo de paso, porque en este
   momento solo puede ser `front`).
3. Pide la URL de la página de gracias (`url_gracias`) — hoy es un diálogo separado
   (`PanelGracias` en `EditorFunnel.tsx`) que se abre con el botón "Definir página de gracias" al
   pie de la lista de pasos. En este flujo nuevo, se pide en el mismo paso 1-2, no después.
4. Solo cuando 2 y 3 están completos, se entra al editor completo (`EditorFunnel`) con el paso
   `front` y `url_gracias` ya poblados, y desde ahí se pueden agregar los upsells con el flujo que ya
   existe hoy sin cambios.

## 3. Cómo estructurarlo — dos formas válidas, elegí una

**`FormularioPaso.tsx` es una excepción documentada de ownership (§7 del plan): T05 también lo toca,
en el bloque del campo de slug.** Si en esta task tocás ese archivo (por ejemplo, en el selector de
tipo de paso), marcá tu fragmento con un comentario `// [T04] ...` en la primera línea de tu bloque,
para que sea visible cuál código es de cuál task si los diffs se integran a mano.

**Opción A (más simple):** un wizard de un solo paso adicional antes de renderizar `EditorFunnel`:
`NuevoFunnelPage` mantiene un estado local `{ nombre, producto, urlGracias } | null` y solo renderiza
`EditorFunnel` cuando las tres cosas están completas, pasándole un `funnel` sintético (no guardado
todavía) con un paso `front` ya armado y `urlGracias` ya seteada.

**Opción B (más fiel a "no tocar EditorFunnel más de lo necesario"):** `EditorFunnel` sigue
renderizándose siempre, pero en su estado vacío (`pasos.length === 0`), en vez de mostrar los botones
genéricos de "Agregar paso", muestra un formulario inline que solo pide producto + gracias, y al
completarlo llama a `guardarPaso` con un paso `front` sintético y a la función que ya existe para
`urlGracias` (el `setUrlGracias` que ya está en el componente).

**Preferí la Opción B** si `EditorFunnel.tsx` no está en tu lista de archivos permitidos — y no lo
está: es de T05 (para `SnippetDelPaso`) y T06 (para el rediseño visual). Si necesitás tocar el bloque
de `pasos.length === 0` de `EditorFunnel.tsx`, es una colisión con T05/T06 que tenés que anotar en
§10, no resolver escribiendo ahí.

**Dado ese conflicto, la implementación correcta es la Opción A**: todo el flujo guiado vive en
`app/admin/(panel)/funnels/nuevo/page.tsx`, que es 100% tuyo, y `EditorFunnel` recibe como prop un
`funnel` ya con su primer paso armado — no necesitás tocar `EditorFunnel.tsx` en absoluto. Si al
implementar encontrás que `EditorFunnel` no acepta bien un `funnel` con pasos pre-armados sin haber
sido guardado en la base (por ejemplo, si algo asume que `funnel.id` existe), es una señal para
anotar en §10 qué prop faltante necesitarías de un archivo que no es tuyo — no lo edites.

## 4. El selector de producto en el wizard

Reusá la misma query de productos que ya usa `productosParaSelector()` en `lib/admin/funnels.ts` — es
de T01, y para cuando arranques esta task en la ola 2, T01 ya terminó (es la fundacional). Si
`productosParaSelector()` cambió de forma para devolver `ProductoConPlanes[]` en vez de la forma plana
vieja, tu selector tiene que elegir **la variante default** de cada producto para mostrar el precio en
la lista — no todas las variantes: en este primer paso del wizard estás eligiendo el PRODUCTO
principal, no una variante puntual (eso lo decide el operador después, dentro del editor, si el
producto tiene más de una).

## 5. Tests

Este task es principalmente flujo de UI. No hay lógica pura nueva que valga un `.test.ts` — la
verificación es manual en browser (ver §6).

## 6. Verificación

```bash
# 1 — build
npx tsc --noEmit && npx next build
# esperado: exit 0

# 2 — nada roto
npx vitest --run
# esperado: línea de base (471 tests) sigue en verde

# 3 — en el browser
#   a. entrar a /admin/funnels/nuevo: no se ve ningún botón de "agregar paso"
#      hasta elegir producto + escribir la página de gracias
#   b. completar los dos campos: aparece el editor completo con el paso front
#      ya en la lista y el botón de "Definir página de gracias" ya mostrando
#      la URL que se escribió (no vacío)
#   c. desde ahí, agregar un upsell funciona exactamente igual que en un
#      funnel existente — no cambiaste nada de ese flujo
#   d. guardar el funnel: se persiste con el front y la url_gracias correctos
#      (confirmalo leyendo la fila de `funnels` después de guardar)
```

## 7. Cuándo parar

**Bloqueante, pará y avisá:**
- Ninguno esperado si seguís la Opción A del punto 3.

**Anotalo en §10 del plan y seguí:**
- Si encontrás que `EditorFunnel` necesita un cambio de prop para aceptar un funnel pre-armado sin
  guardar — describí exactamente qué prop falta, para que T05/T06 lo tengan en cuenta si lo agregan
  ellos.
