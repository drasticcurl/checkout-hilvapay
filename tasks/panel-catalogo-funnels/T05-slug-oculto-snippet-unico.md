# T05 — slug automático oculto, un solo snippet por paso, sin placeholder `/downsell`

> **Antes de leer una línea más:** leé `00-README-LEER-PRIMERO.md` de esta misma carpeta. La carpeta
> hermana `tasks/checkout-whop/` es solo referencia histórica — no la sigas.

- **Depende de:** T01 (`generarSlugConSufijo` de `lib/admin/integracion.ts`)
- **Bloquea:** T06 (el rediseño visual no puede empezar hasta que la lógica de esta task esté
  asentada)
- **Se puede correr en paralelo con:** T02, T03, T04
- **Repo:** `checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/admin/(panel)/funnels/EditorFunnel.tsx` (**solo** el
  componente `SnippetDelPaso` y su uso), `app/admin/(panel)/funnels/FormularioPaso.tsx` (**solo** el
  bloque del campo `slug-paso` y su lógica asociada — no el selector de tipo de paso, que es T04).
  Nada más.
  **No tocás `lib/admin/integracion.ts`** — es de T01 (que le agrega `generarSlugConSufijo`) y sus
  funciones puras (`snippetBotonHtml`, `snippetBotonJsx`, `snippetWalletHtml`, `snippetWalletJsx`,
  `snippetRechazo`) no cambian de firma ni de comportamiento por D6: el toggle de modo que retirás
  vive enteramente en el componente `SnippetDelPaso` de `EditorFunnel.tsx` (es el que decide CUÁL de
  esas funciones llamar, no una función nueva en `integracion.ts`), así que no necesitás ese archivo
  para nada de esta task.

Leé `00-PLAN-PANEL-CATALOGO-FUNNELS.md` completo. Tus decisiones son D4, D5 y D6 de §1.

---

## 1. Objetivo

Cuando termines:

- El formulario de un paso `upsell` (`FormularioPaso.tsx`) no tiene ningún campo de texto donde se
  vea o se edite el slug. El slug se genera solo, con `generarSlugConSufijo`, a partir del nombre del
  paso.
- `SnippetDelPaso` (dentro de `EditorFunnel.tsx`) ya no tiene el selector `['wallet', 'guardada']` —
  genera un único snippet.
- Si un paso tiene `permite_rechazo` activado pero su destino de rechazo (`paso_rechazado_indice`)
  todavía no está resuelto, **el bloque de código no se ofrece como copiable** — se muestra un aviso,
  igual que ya pasa hoy cuando el paso no está guardado.

**Este task no toca `lib/funnels.ts` (el resolutor, 22 tests) ni la lógica de qué significa
"permite_rechazo" — D7 del plan ya estableció que el modelo de datos está bien. Tampoco decide el
selector de tipo de paso (`front`/`upsell`) del wizard guiado — eso es T04.**

## 2. El slug: generarlo al guardar, no al tipear

**`FormularioPaso.tsx` es una excepción documentada de ownership (§7 del plan): T04 también lo toca,
en el selector de tipo de paso.** Marcá el bloque que retirás (el campo `slug-paso` y su lógica) con
un comentario `// [T05] ...` en la primera línea de tu fragmento, para que sea visible cuál código es
de cuál task.

Leé `FormularioPaso.tsx` completo primero. Hoy `slug` es un `useState` con un `<input>` controlado, y
`previsualizarSlug` normaliza en vivo para mostrar la URL resultante mientras se tipea. Para un paso
`front` ya no hay este campo — se deriva del nombre del producto. **Para un paso `upsell`, replicá el
mismo patrón que el front, pero derivando del nombre del PASO en vez del producto**, y agregando el
sufijo con `generarSlugConSufijo` de `lib/admin/integracion.ts`:

```ts
// Reemplaza al estado `slug` + su <input>. Se calcula en el momento de
// guardar, no antes — así el sufijo aleatorio no se regenera en cada
// re-render mientras el operador sigue tipeando el nombre.
```

El texto de ayuda que hoy explica el slug (`ayuda={<>Es lo que el botón del funnel pone en
data-hilvana-upsell...`) se retira del formulario — el usuario fue explícito: "no importa porque no
se ve el slug". Si querés dejar CUALQUIER indicio del slug visible en el formulario mismo, es una
desviación del pedido: no lo hagas sin anotarlo en §10 primero.

**Un paso que se está EDITANDO (ya tiene `id` y `slug` reales) no regenera su slug** — solo un paso
NUEVO lo genera al guardarse por primera vez. Guardá el `slug` existente en el estado del paso
igual que hoy (sigue viajando en el objeto `PasoEditor`), solo que ya no hay ningún control de UI que
lo muestre o lo edite.

## 3. `SnippetDelPaso` — un solo snippet, sin el toggle

**`EditorFunnel.tsx` es una excepción documentada de ownership (§7 del plan): T06 lo reemplaza como
dueño después de que termines, para el rediseño visual.** Dejá un comentario en la primera línea del
componente `SnippetDelPaso` (o del bloque que edites) que diga algo como
`// [T05, cierra la lógica — T06 rediseña visualmente después]`, para que quien abra T06 sepa que este
archivo no es "de nadie" sino que tiene un dueño anterior ya cerrado.

Leé el componente completo primero, especialmente el comentario largo que explica por qué el toggle
de modo existe hoy (data histórica: "todavía no se verificó con una compra real de punta a punta").
**Antes de decidir cuál de los dos generar, releé ese mismo comentario tal como está en el archivo AL
MOMENTO EN QUE EJECUTÁS ESTA TASK** (puede haber cambiado desde que se escribió este plan) y también
`ESTADO.md` §3.0 del repo — es la fuente de verdad más actualizada sobre si el cobro silencioso
(`data-hilvana-upsell`) ya está confirmado con tráfico real.

- Si a la fecha en que ejecutás esto el cobro silencioso YA está confirmado con una compra real
  (`ESTADO.md` lo va a decir explícitamente, sin condicionales del tipo "todavía no se confirmó") →
  generá `snippetBotonHtml`/`snippetBotonJsx` como el único snippet.
- Si NO está confirmado todavía → generá `snippetWalletHtml`/`snippetWalletJsx` como el único
  snippet (el default conservador, ya probado con Apple Pay real).
- Cualquiera sea tu elección, **documentala en el comentario de cabecera de `SnippetDelPaso`** con la
  fecha y la fuente que leíste (P-02 de §10 del plan) — la próxima persona que lea este código
  necesita saber por qué se eligió ese y no el otro sin tener que reconstruir el razonamiento.

El selector `<div className="inline-flex ...">` con los dos botones `['wallet', 'Apple Pay /
tarjeta']`/`['guardada', 'Tarjeta guardada']` se elimina completo, junto con el `useState<'wallet' |
'guardada'>('wallet')` que lo respaldaba. El párrafo explicativo que cambia según el modo (`{modo ===
'wallet' ? <p>...</p> : <p>...</p>}`) se reemplaza por un solo párrafo fijo, describiendo el snippet
único que quedó.

El selector de lenguaje (`['jsx', 'React']`/`['html', 'HTML']`) **no se toca** — sigue siendo una
elección legítima entre dos formatos del mismo snippet, no una elección de comportamiento de cobro.

## 4. El destino de rechazo sin resolver: no ofrecer el snippet

Hoy, cuando `!paso.id || !guardado`, el componente devuelve el aviso "Guardá el funnel para obtener el
botón..." en vez del bloque de código. Agregá una segunda condición al mismo patrón:

```ts
const rechazoSinResolver =
  paso.permite_rechazo && paso.paso_rechazado_indice == null;
```

Cuando `rechazoSinResolver` es true, mostrá un aviso distinto (no el mismo texto de "guardá el
funnel" — sería confuso si el funnel SÍ está guardado pero falta apuntar esta rama en particular):
algo como "Este paso tiene el botón de rechazo activado pero todavía no le asignaste a dónde va. Elegí
un destino en la rama 'Rechazó el upsell' antes de copiar el botón." — el objetivo es que sea
imposible copiar un snippet con el placeholder `/downsell` sin saber por qué está incompleto.

**No toques `snippetRechazo` en `lib/admin/integracion.ts` para lograr esto.** Esa función sigue
teniendo su fallback a `/downsell` cuando recibe `null` — eso está bien y tiene 8 tests que lo fijan a
propósito (para el caso legítimo de un `<a href>` en un contexto donde SÍ hace falta un placeholder
documentado, ej. la guía general de `ComoIntegrar.tsx`, que no es parte de este task). El cambio es
exclusivamente en `SnippetDelPaso`: deja de LLAMAR a `snippetRechazo` cuando el destino no está
resuelto, en vez de cambiar qué devuelve esa función.

## 5. Tests

`SnippetDelPaso` es un componente de React sin lógica pura extraíble más allá de lo que ya vive en
`lib/admin/integracion.ts` (que no tocás). No hay `.test.ts` nuevo esperado de este task más allá de
lo que ya cubre T01. La verificación es en browser (§6).

## 6. Verificación

```bash
# 1 — build
npx tsc --noEmit && npx next build
# esperado: exit 0

# 2 — nada roto: especialmente los 8 tests de snippetRechazo, que NO tocaste
npx vitest --run lib/admin/integracion.test.ts
# esperado: mismo resultado que antes de tu cambio, ni un test menos

npx vitest --run
# esperado: línea de base (471 tests) sigue en verde

# 3 — en el browser
#   a. crear un paso upsell nuevo: no hay ningún campo de slug visible en el
#      formulario, en ningún punto del flujo
#   b. guardar el funnel: el paso tiene un slug real en la base (confirmalo
#      con `select slug from paginas where id = '<el id>'`), con pinta
#      `<nombre-normalizado>-<7 caracteres>`
#   c. crear DOS pasos con el mismo nombre en el mismo funnel (a propósito):
#      los dos guardan con slugs DISTINTOS, sin error de slug_ocupado
#   d. abrir el snippet de un paso: no hay ningún selector "Apple Pay/tarjeta"
#      vs "Tarjeta guardada" — un solo bloque de código
#   e. activar "permite_rechazo" en un paso sin haberle asignado destino
#      todavía: el snippet de ESE paso muestra el aviso de "falta destino", no
#      un bloque con /downsell
#   f. asignarle un destino real a esa rama: el snippet ahora sí aparece, con
#      el href real de la página destino (no /downsell)
```

## 7. Cuándo parar

**Bloqueante, pará y avisá:**
- Ninguno esperado.

**Anotalo en §10 del plan y seguí:**
- Cuál snippet elegiste como el único (wallet o silencioso) y con qué evidencia — completá P-02 de
  §10 del plan con tu respuesta, no la dejes en blanco.
