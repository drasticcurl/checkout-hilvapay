# T01 — esquema `producto_planes`, tipos congelados, slug con sufijo y catálogo agrupado

> **Antes de leer una línea más:** leé `00-README-LEER-PRIMERO.md` de esta misma carpeta. La carpeta
> hermana `tasks/checkout-whop/` es solo referencia histórica — no la sigas.

- **Depende de:** nada
- **Bloquea:** T02, T03, T04, T05 (las cuatro importan `lib/tipos.ts` con las formas nuevas)
- **Se puede correr en paralelo con:** nada. **Corre sola.**
- **Repo:** `checkout-kashhhpay`
- **Archivos que este task puede tocar:** `db/migrations/010_producto_planes.sql`, `lib/tipos.ts`,
  `lib/admin/integracion.ts` (solo agrega `generarSlugConSufijo` al final del archivo, no reordena ni
  toca ninguna función existente), `lib/admin/productos.ts`, `lib/admin/catalogo.ts`,
  `lib/admin/paginas.ts`, `lib/admin/funnels.ts`, y los `*.test.ts` de todos esos. Nada más.

Leé `00-PLAN-PANEL-CATALOGO-FUNNELS.md` completo antes de escribir una línea. Tu contrato es §4 (los
tipos) y §5 (`generarSlugConSufijo`): los copiás **tal cual** están escritos ahí, no los mejorás ni
les cambiás la forma — cuatro tasks se van a escribir contra exactamente esas firmas al mismo tiempo
que vos hacés esto.

---

## 1. Objetivo

Cuando termines:

- Existe `db/migrations/010_producto_planes.sql`, copia exacta de
  `_schema-010-producto-planes.sql` de esta carpeta (ya verificado dos veces contra datos reales —
  no le cambies una coma sin volver a correr la verificación).
- `lib/tipos.ts` tiene `Producto` (sin precio propio), `ProductoPlan`, `ProductoConPlanes` y
  `PaginaConProductoPlan` exactamente como en §4 del plan.
- `lib/admin/integracion.ts` tiene `generarSlugConSufijo` exactamente como en §5 del plan, y **todo lo
  que ya existía en ese archivo sigue exactamente igual** — sus 8 tests de `snippetRechazo` y el resto
  de la suite de `integracion.test.ts` pasan sin ningún cambio.
- `lib/admin/productos.ts`, `lib/admin/catalogo.ts`, `lib/admin/paginas.ts` y `lib/admin/funnels.ts`
  quedan reescritos para leer y escribir a través de `producto_planes`, no de `productos.whop_plan_id`
  directo.

**Este task no toca ninguna pantalla de `app/`, no borra `productos.whop_plan_id` de la base (D2: la
columna queda muerta, no se dropea), y no decide cuál de los dos snippets de botón es el default
(eso es T05, P-02 del plan).**

## 2. La migración: copiala, no la reescribas

`_schema-010-producto-planes.sql` en esta carpeta **ya corrió dos veces** contra una base scratch con
datos reales (ver §3 del plan). Copiala byte a byte a `db/migrations/010_producto_planes.sql` —
cambiale solo el comentario de cabecera si hace falta ajustar la numeración de migración, nada del
DDL ni de la lógica de agrupación.

Si algo en tu entorno hace que la migración se comporte distinto de lo que dice §3 del plan (por
ejemplo, si tu base local tiene productos con datos que rompen algún supuesto), **es bloqueante** — no
la edites para que "funcione en tu caso": parate y anotalo en §10, porque significa que la
verificación previa no cubrió algo real.

## 3. `lib/tipos.ts` — copiá §4 del plan tal cual

Los cuatro tipos nuevos (`Producto` editado, `ProductoPlan`, `ProductoConPlanes`,
`PaginaConProductoPlan`) van exactamente como están escritos en §4. `Pagina` (la fila cruda de
`paginas`) no cambia — sigue teniendo `producto_id`, porque la columna sigue existiendo en la base
(§3 punto 2 del plan): lo que cambia es que nadie nuevo la usa para resolver qué se cobra.

`PaginaConProducto` (el tipo viejo, que hoy usan T03 del plan de checkout original y varias
pantallas) **se mantiene sin tocar** en este archivo — no lo borres. Las pantallas que dependan de él
hoy siguen compilando; las tasks de este módulo migran a `PaginaConProductoPlan` en los archivos que
les toca, no en este.

## 4. `lib/admin/productos.ts` — reescritura completa

Antes de escribir, leé el archivo actual completo: `crearProducto`, `actualizarProducto`,
`listarProductos`, `buscarProducto`, `planesDisponibles`, `verificarPrecio`, `setActivoProducto`. El
patrón a copiar es el manejo de nulos y el `q1`/`q` de `lib/db.ts`; lo que NO copiar es que cada
función asuma "un producto = un plan" — eso es justo lo que se retira.

Funciones nuevas o reescritas (firmas, no implementación — resolvelas vos):

```ts
/** Lista los productos con TODAS sus variantes de precio ya resueltas. */
export async function listarProductosConPlanes(): Promise<ProductoConPlanes[]>;

/** Un producto con sus planes, o null. Para la ficha de edición (T02). */
export async function buscarProductoConPlanes(id: string): Promise<ProductoConPlanes | null>;

/**
 * Alta de un producto NUEVO con su primera variante (es_default = true).
 * Reemplaza a crearProducto: ya no tiene sentido crear un producto sin al
 * menos una variante de precio, porque un producto sin plan no es cobrable.
 */
export async function crearProductoConPlan(datos: {
  nombre: string; imagen_url?: string | null; descripcion?: string | null;
  whop_product_id?: string | null;
  plan: { whop_plan_id: string; whop_nombre_soft?: string | null; etiqueta?: string; precio: string; moneda?: string; precio_anclaje?: string | null };
}): Promise<ProductoConPlanes>;

/**
 * Agrega una variante de precio a un producto YA EXISTENTE. Es lo que usa la
 * ficha de edición (T02) cuando el operador quiere sumar un downsell al mismo
 * access_pass. `es_default` nunca se manda true acá — la regla D del índice
 * `producto_planes_un_default_idx` (§3.3 del plan) es que solo la primera
 * variante de un producto nace default; agregar una segunda no cambia cuál lo
 * es. Si el caller quiere cambiar la default, es una función separada
 * (`setPlanDefault`, ver abajo) para que el cambio sea explícito.
 */
export async function agregarPlanAProducto(productoId: string, plan: {
  whop_plan_id: string; whop_nombre_soft?: string | null; etiqueta: string;
  precio: string; moneda?: string; precio_anclaje?: string | null;
}): Promise<ProductoPlan>;

/** Cambia cuál variante es la default. Solo una a la vez (índice parcial). */
export async function setPlanDefault(productoPlanId: string): Promise<void>;

/** Edita nombre/imagen/descripción del producto (NO sus variantes). */
export async function actualizarProducto(id: string, datos: {
  nombre: string; imagen_url?: string | null; descripcion?: string | null;
}): Promise<Producto | null>;

/** Edita una variante puntual (precio, etiqueta, precio_anclaje). NO su whop_plan_id: cambiarlo es borrar y crear otra, no editar. */
export async function actualizarPlan(productoPlanId: string, datos: {
  etiqueta?: string; precio?: string; precio_anclaje?: string | null;
}): Promise<ProductoPlan | null>;
```

Reglas:

1. **`agregarPlanAProducto` valida que el `whop_plan_id` no esté ya usado** (el índice único de
   `producto_planes_whop_plan_idx` lo garantiza en la base, pero devolvé un error legible en vez de
   dejar que el `UNIQUE VIOLATION` crudo suba hasta la pantalla — mismo patrón que ya usa
   `vincularPlan` en `lib/admin/catalogo.ts` con `plan_ya_vinculado`).
2. **`setActivoProducto` sigue existiendo, sin cambios de firma** — sigue siendo el switch de
   `productos.activo`, que es del producto entero, no de una variante. Si además hace falta un
   switch por variante, no está en el alcance de este plan: no lo agregues sin que esté en §10.
3. **`planesDisponibles()` y `verificarPrecio()` no cambian de firma** — siguen hablando con la API de
   Whop directo (`lib/whop.ts`), que este plan no toca.

## 5. `lib/admin/catalogo.ts` — agrupar por `access_pass` al construir `Catalogo`

Leé el archivo completo primero. Hoy `catalogoWhop()` ya agrupa los **planes de Whop** por
`whop_product_id` para mostrarlos bajo un `ProductoDelCatalogo` — la agrupación visual **ya existe**.
Lo que cambia es `vincularPlan`: hoy crea un `producto` nuevo por cada plan que se vincula (una fila
en `productos` por vínculo). Ahora tiene que:

1. Si el `whop_product_id` del plan **ya está vinculado** a un producto local existente (buscalo por
   `productos.whop_product_id`), llamar a `agregarPlanAProducto` sobre ESE producto en vez de crear
   uno nuevo — y la página nueva referencia esa variante nueva.
2. Si no hay ningún producto local con ese `whop_product_id`, comportarse como hoy: crear el producto
   nuevo (ahora vía `crearProductoConPlan`) y su primera variante.

```ts
export type ResultadoVinculo =
  | { ok: true; producto_id: string; producto_plan_id: string; pagina_id: string; slug: string; fusionado: boolean }
  | { ok: false; error: 'slug_ocupado' | 'plan_ya_vinculado' | 'datos_invalidos'; detalle?: string };
```

`fusionado: true` es lo que la pantalla de T02 usa para mostrar "se agregó como variante de X" en vez
de "se creó un producto nuevo" — es información, no lógica: no bloquees el flujo por esto, solo
reportalo.

## 6. `lib/admin/paginas.ts` y `lib/admin/funnels.ts` — migrar las queries

Los dos archivos hoy hacen `join productos pr on pr.id = pg.producto_id` para resolver el precio de
una página. Cambia a un join en dos pasos: `paginas.producto_plan_id → producto_planes → productos`.

- `lib/admin/paginas.ts`: `listarPaginasConProducto()` pasa a devolver `PaginaConProductoPlan[]`
  (renombrala si preferís, pero el tipo de retorno es ese). El `EntradaPagina` que arma el alta/edición
  de una página ahora recibe `producto_plan_id` en vez de `producto_id`.
- `lib/admin/funnels.ts`: `PasoDeFunnel.producto` (hoy `{ id, nombre, precio, moneda, imagen_url }`)
  pasa a resolverse a través del join nuevo. **`filaAPaso` y `SELECT_PASOS` son las dos funciones que
  tocás** — el resto de `guardarFunnel` (la transacción, la detección de ciclos) no cambia de lógica,
  solo el nombre de la columna que inserta/actualiza (`producto_plan_id` en vez de `producto_id`).

**No toques `lib/funnels.ts` (sin `admin/`, el resolutor de 22 tests) — es un archivo distinto, del
plan anterior, que no necesita saber nada de `producto_planes` porque no lee precios, solo sigue
punteros de página a página.**

## 7. Tests

1. `lib/admin/productos.test.ts` (nuevo, o reescritura si ya existía): un producto con dos variantes
   (`agregarPlanAProducto` dos veces) devuelve `ProductoConPlanes.planes.length === 2`, y la segunda
   variante agregada no tiene `es_default`.
2. `lib/admin/catalogo.test.ts`: vincular un segundo plan del mismo `whop_product_id` que uno ya
   vinculado da `fusionado: true` y **no crea una fila nueva en `productos`** — verificalo contando
   filas antes y después con el cliente de test fake que ya usa `funnels.test.ts` como referencia de
   patrón (leé ese archivo para el patrón de mock de `q`/`tx`).
3. `lib/admin/integracion.test.ts` (agregás casos, no tocás los existentes): `generarSlugConSufijo`
   con la misma base da sufijos distintos en llamadas sucesivas (comparar 20 llamadas, todas
   distintas).
4. **Los 8 tests existentes de `snippetRechazo` en `integracion.test.ts` no cambian ni una línea** —
   corrida esa suite sola tiene que dar el mismo resultado antes y después de tu trabajo.

## 8. Verificación

```bash
# 1 — la migración corre limpia contra la base local de desarrollo
#     (asumiendo que checkout ya tiene las 9 migraciones previas)
npm run db:migrate
# esperado: aplica 010_producto_planes.sql, sale 0

npm run db:migrate
# esperado exactamente: "Nada nuevo que aplicar", exit 0

# 2 — los 4+ productos que ya existían siguen resolviendo el mismo precio
psql "$DATABASE_URL" -c "
  select pg.slug, pp.precio, pp.whop_plan_id
  from paginas pg join producto_planes pp on pp.id = pg.producto_plan_id
  order by pg.slug;"
# esperado: los mismos 4 slugs de antes, con los mismos precios y whop_plan_id
# que tenían via productos.precio/whop_plan_id (compará contra
# `select slug, producto_id from paginas` + `select id, precio, whop_plan_id
# from productos` de ANTES de migrar, que tenés que haber guardado antes de
# correr el paso 1)

# 3 — tipos y build
npx tsc --noEmit
# esperado: exit 0

npx vitest --run lib/admin/productos.test.ts lib/admin/catalogo.test.ts lib/admin/integracion.test.ts lib/admin/paginas.test.ts lib/admin/funnels.test.ts
# esperado: todo en verde, incluidos los tests viejos que no tocaste

npx vitest --run
# esperado: >= 471 tests en verde (la línea de base + los que agregaste).
# Si algo de la línea de base rompió, es tuyo: identificalo y arreglalo antes
# de decir que termins te.
```

## 9. Cuándo parar

**Bloqueante, pará y avisá:**
- La migración de datos produce un resultado distinto al documentado en §3 del plan sobre tu base
  local real (no la scratch de verificación) — significa que hay un caso que la verificación previa
  no cubrió.
- Cualquier test de la línea de base (471 tests, 26 archivos) queda roto y no podés arreglarlo sin
  cambiar el comportamiento que ese test fija a propósito.

**Anotalo en §10 del plan y seguí:**
- Si `catalogoWhop()` necesita un campo de la API de Whop que hoy `ProductoWhop`/`PlanWhop` no
  expone (por ejemplo, para mostrar mejor la fusión) — no agregues un campo a esos tipos sin
  verificarlo contra la API real primero; anotalo.
