# T02 — la ficha de "Productos" muestra y edita las variantes de precio y sus links

> **Antes de leer una línea más:** leé `00-README-LEER-PRIMERO.md` de esta misma carpeta. La carpeta
> hermana `tasks/checkout-whop/` es solo referencia histórica — no la sigas.

- **Depende de:** T01 (`lib/tipos.ts`: `ProductoConPlanes`, `ProductoPlan`; `lib/admin/productos.ts`:
  `buscarProductoConPlanes`, `agregarPlanAProducto`, `actualizarPlan`, `setPlanDefault`)
- **Bloquea:** nada
- **Se puede correr en paralelo con:** T03, T04, T05
- **Repo:** `checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/admin/(panel)/productos/**`,
  `app/api/admin/productos/**`. Nada más.

Leé `00-PLAN-PANEL-CATALOGO-FUNNELS.md` completo. Tu contrato es §4 (`ProductoConPlanes`,
`ProductoPlan`) — no lo redefinas, importalo de `lib/tipos.ts`.

---

## 1. Objetivo

Cuando termines:

- `/admin/productos` lista productos (no variantes): un producto con dos precios aparece **una sola
  vez**, con sus variantes visibles en su fila o al expandir.
- `/admin/productos/[id]` muestra nombre/foto/descripción una sola vez, la lista de sus variantes de
  precio (etiqueta, `whop_plan_id`, precio, cuál es default), y **el slug/link de pago de cada
  variante, editable ahí mismo** — esto es lo que reemplaza a la sección "Links" que T03 elimina del
  nav.
- Hay un botón para agregar una variante nueva a un producto existente, que ofrece los planes del
  mismo `access_pass` (`whop_product_id`) desde el catálogo de Whop.
- `/admin/productos/nuevo` sigue existiendo para el alta manual (con fallback sin catálogo, como hoy),
  ahora pidiendo también el slug de la primera variante en el mismo formulario.

**Este task no toca el nav (`components/panel/NavPanel.tsx`) ni el Home (`app/admin/(panel)/page.tsx`)
— eso es T03. No toca el editor de funnels ni sus snippets — eso es T04/T05.**

## 2. `/admin/productos/page.tsx` — leé el archivo actual primero

Hoy lista `Producto[]` plano con `p.whop_plan_id` y `p.precio` en la tabla. Cambia a
`ProductoConPlanes[]` (via `listarProductosConPlanes()` de T01). Cada fila muestra el nombre y, en la
columna de precio, o el precio de la variante default si tiene una sola, o un badge "N variantes" que
lleva a la ficha si tiene más de una — el patrón de "badge que resume y la ficha que detalla" ya
existe en el panel (ver `Insignia` en `components/panel/ui.tsx`).

`RevisarPlanes.tsx` (el aviso de que "el precio de display no coincide con el precio real del plan",
ya implementado en el checkout base y sin cambios de este módulo) sigue existiendo pero ahora tiene
que iterar las **variantes**, no los productos — un producto con dos variantes puede tener una
desincronizada y la otra no. Leé `lib/admin/planes.ts` (`revisarPlanesDeProductos`) antes de decidir
si lo tocás: si su firma asume `Producto.whop_plan_id` directo, es un archivo que **no está en tu
lista de ownership** — anotalo en §10 en vez de editarlo, porque puede pisar a T01 si todavía no
terminó.

## 3. `/admin/productos/[id]/page.tsx` y su formulario — la pieza central de este task

Estructura de la pantalla, de arriba a abajo:

1. **Datos del producto**: nombre, imagen (reusar `subirImagen` del patrón actual de
   `FormularioProducto.tsx`), descripción. Un solo `<form>` de estos tres campos, sin las variantes
   mezcladas.
2. **Lista de variantes**, cada una como una tarjeta con:
   - etiqueta (editable, texto libre)
   - `whop_plan_id` (solo lectura — igual que hoy, cambiar el plan de una variante existente no es
     "editar", es borrar y crear otra — ver la nota de `actualizarPlan` en la sección 4 de T01, que
     no acepta `whop_plan_id` como campo editable a propósito)
   - precio, precio de anclaje (editables)
   - el slug/link de pago (`/pagos/<slug>`) de la página que usa esta variante, **editable** con el
     mismo patrón de `normalizarSlug` que ya usa `FormularioPagina.tsx` hoy (leé ese archivo: es lo
     que se está retirando de su pantalla propia, no reinventes la validación)
   - el switch de activo de esa página (mismo componente `SwitchActivo` que ya existe, apuntando al
     endpoint de página, no al de producto)
   - un botón "Hacer default" si no lo es ya (llama a `setPlanDefault`)
3. **Botón "Agregar variante"**: abre un selector de los planes del catálogo de Whop que compartan
   `whop_product_id` con este producto y todavía no estén vinculados a nadie — mismo patrón visual que
   `FormularioVincular.tsx` de `/admin/catalogo`, pero acotado a ese único `access_pass` en vez de
   mostrar todo el catálogo.

**Si un producto no tiene ninguna página todavía apuntando a alguna de sus variantes** (caso: se creó
el producto pero nunca se guardó dentro de un funnel), el slot de "link de pago" de esa variante
muestra un estado vacío con un aviso — no crea una página automáticamente. Crear páginas es
responsabilidad del editor de funnels (T04), no de esta ficha.

## 4. Rutas de API — leé las actuales antes de tocarlas

`app/api/admin/productos/route.ts` (`POST`/`GET`) y `app/api/admin/productos/[id]/route.ts`
(`PATCH`/`GET`) cambian de forma: el `POST` ahora recibe el producto **y** su primera variante juntos
(`crearProductoConPlan`), y necesitás nuevas rutas para las variantes:

```
POST   /api/admin/productos/[id]/planes           agregarPlanAProducto
PATCH  /api/admin/productos/[id]/planes/[planId]   actualizarPlan
POST   /api/admin/productos/[id]/planes/[planId]/default   setPlanDefault
```

Todas detrás del mismo middleware de auth que ya protege `/api/admin/**` — no agregues autenticación
nueva, heredala del layout existente (revisalo en `middleware.ts` si tenés duda de cómo se aplica).

Para el slug/link editable dentro de la ficha (punto 2 de arriba), reusá el `PATCH` que hoy vive en
`app/api/admin/paginas/[id]/route.ts` **llamándolo desde el cliente** (fetch normal), no reimplementes
esa lógica acá — es el mismo endpoint, solo que ahora el formulario que lo llama vive en otra pantalla.
Si T03 lo borra antes de que termines, coordinen en la práctica: es la única dependencia cruzada
real entre T02 y T03, y no está en la tabla de ownership porque ninguna de las dos "escribe" el
archivo de la otra — **avisalo en el chat de progreso si notás la colisión de timing**, no lo
resuelvas escribiendo en `app/admin/(panel)/paginas/**`.

## 5. Tests

Este task es mayormente UI de servidor (React Server Components + client components) — no tiene la
misma superficie de lógica pura que T01. Los tests que sí valen:

1. Si escribís alguna función de validación pura (ej. el cálculo de "cuántas variantes le faltan
   link"), un `.test.ts` chico para ella.
2. Verificación manual en browser (ver §6) reemplaza a los tests automatizados de UI que este
   proyecto no tiene.

## 6. Verificación

```bash
# 1 — build y tipos
npx tsc --noEmit && npx next build
# esperado: exit 0 los dos

# 2 — en el browser, con el server corriendo (npm run dev)
#   a. /admin/productos lista los productos SIN duplicar el "Acelerador 7X" del
#      caso de prueba de T01 (si T01 ya migró tu base local, vas a ver un
#      producto con 2 variantes, no dos productos)
#   b. entrar a la ficha de ese producto: se ven las dos variantes, cada una
#      con su precio y su link editable
#   c. cambiar el slug de una variante y guardar: la URL /pagos/<slug-nuevo>
#      responde 200 (o el estado que corresponda si la página está inactiva)
#   d. agregar una variante nueva desde el catálogo: aparece en la lista sin
#      recargar manualmente otra pantalla
```

## 7. Cuándo parar

**Bloqueante, pará y avisá:**
- Si `buscarProductoConPlanes` (de T01) no existe todavía cuando arrancás — significa que T01 no
  terminó y estás en la ola equivocada.

**Anotalo en §10 del plan y seguí:**
- Cualquier decisión de qué mostrar exactamente si un producto tiene 3+ variantes (el plan no
  especifica un límite ni un layout para ese caso) — elegí lo que te parezca razonable (una lista que
  scrollea, por ejemplo) y anotalo como decisión tomada, no como pregunta abierta si no bloquea a
  nadie más.
