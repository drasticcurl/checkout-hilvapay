# PANEL-CATALOGO-FUNNELS — productos con variantes de precio, funnel guiado, y snippets sin placeholders

**Documento maestro del módulo. Todo agente lee este archivo completo antes de abrir su task.**

Cuatro problemas reales encontrados usando el panel en producción, sobre el checkout ya construido y
en funcionamiento (cobra tarjetas reales). **Ninguna task de este módulo lee, cita ni modifica nada
de `tasks/checkout-whop/`** — esa carpeta es la bitácora histórica de cómo se construyó el checkout
base y sigue siendo válida como documentación, pero este módulo es autocontenido: todo lo que hace
falta saber del checkout ya construido está resumido en este mismo documento (§0 "No se construye" y
las decisiones D1-D8) y en `ESTADO.md`/`README.md` de la raíz del repo, que son los documentos vivos.
Si alguna task siente que necesita releer una decisión del plan viejo, es señal de que este documento
no la resumió bien — anotalo en §10 en vez de ir a buscarla ahí.

1. **Un mismo producto de Whop con dos precios (precio completo / downsell) vive como dos productos
   locales sin relación entre sí.** El modelo de datos de hoy (`productos.whop_plan_id` único) obliga
   a esto, y produce exactamente lo que reportó el usuario: demasiados links para lo que es
   conceptualmente un solo producto, con nombre y foto tipeados dos veces a mano.
2. **La sección "Links" del nav (hoy el Home del panel, `/admin`) desaparece.** Los slugs/links de
   cada variante de precio se ven y se editan desde dentro de la ficha de "Productos", no en una
   pantalla aparte.
3. **Crear un funnel no guía al operador.** El primer paso debería exigir elegir el producto
   principal y definir la página de gracias antes de poder seguir agregando pasos — hoy los dos son
   opcionales hasta el guardado final del funnel completo.
4. **El slug de un upsell se tipea a mano y el snippet copiable puede caer en un placeholder
   hardcodeado (`/downsell`) en vez del link real.** Además el editor ofrece un toggle manual entre
   dos modos de cobro ("Apple Pay/tarjeta" vs "Tarjeta guardada") que ya no debería existir: el
   checkout real decide esto solo en runtime desde el 2026-09-13 (ver `ESTADO.md` §3.0), y el panel
   sigue mostrando la elección manual vieja.

**Este módulo toca el modelo de datos de `productos` y `paginas`, que ya tienen filas reales en la
base local de desarrollo y (potencialmente) en producción.** La migración de datos existentes no es
opcional ni reversible con un DROP simple una vez que otras tablas empiecen a referenciar
`producto_plan_id`. Todo lo que sigue está diseñado alrededor de esa frase: la migración es aditiva,
se verificó dos veces contra datos reales antes de escribir este plan (ver §3), y ninguna task borra
`productos.whop_plan_id` — queda como columna muerta hasta que se confirme que nada la lee.

## 0. Qué se construye y qué no

**Se construye**

1. **`producto_planes`**: la tabla nueva que separa "el producto" (nombre, foto, descripción — una
   sola vez) de "las variantes de precio cobrables" (cada una con su propio `whop_plan_id`). La
   migración de los datos existentes agrupa automáticamente los productos que comparten
   `whop_product_id` (el `access_pass` de Whop) bajo un solo producto padre.
2. **La ficha de "Productos" (`/admin/productos/[id]`) rediseñada**: muestra nombre/foto/descripción
   una sola vez, la lista de variantes de precio con su etiqueta y su `whop_plan_id`, un botón para
   agregar una variante nueva (eligiendo un plan del mismo `access_pass` desde el catálogo de Whop), y
   — **esto es lo que reemplaza a la sección "Links" que se elimina** — el slug/link de pago de cada
   variante, visible y editable ahí mismo.
3. **El nav sin el ítem "Links"**, y el Home del panel (`/admin`) deja de ser el listado de páginas de
   pago. Pasa a ser un resumen que en este módulo NO se construye a fondo — el usuario confirmó que el
   dashboard de ventas se resuelve en otro módulo más adelante — pero necesita *algo* coherente en su
   lugar: un resumen mínimo con el estado general (cuántos productos activos, cuántos funnels activos,
   accesos rápidos), sin ninguna tabla de links.
4. **El asistente de creación de funnel exige producto principal + página de gracias como primer
   paso.** No se puede empezar a agregar upsells hasta tener las dos cosas.
5. **El slug de un upsell se genera automático, con un sufijo aleatorio anticolisión, y no se muestra
   ni se edita en el formulario.** El usuario lo pidió explícitamente: "que tenga algún código random
   así no se pueden generar nunca 2 iguales" — dos operadores escribiendo "upsell" a la vez no chocan.
6. **El snippet de cada paso nunca cae a un placeholder hardcodeado.** Si el destino de rechazo no
   está resuelto, el panel no ofrece el snippet como copiable — igual que ya hace hoy con un paso sin
   guardar (ver el comentario de `SnippetDelPaso` en `EditorFunnel.tsx`, que es el patrón a copiar).
7. **Un solo snippet de botón por paso, sin el toggle manual "Apple Pay/tarjeta" vs "Tarjeta
   guardada".** El panel deja de ofrecer la elección; genera un único snippet.
8. **El editor de funnels (`EditorFunnel.tsx` y sus subcomponentes) rediseñado visualmente**, sin
   cambiar la lógica que las tasks anteriores ya definieron — aplicado con una skill de diseño
   (`minimalist-ui` o `design-taste-frontend`, a elección de quien ejecute esa task según el resultado
   de su propio audit).

**No se construye** (explícito, para que ningún agente lo invente)

- **El dashboard de ventas.** El usuario lo confirmó para otro módulo. El Home nuevo del panel (punto 3
  de arriba) es un resumen mínimo, no el dashboard de ventas.
- **Downsells como concepto de datos distinto de un upsell.** Ya no existe como tipo en el esquema —
  un "downsell" es un `paso` de tipo `upsell` más, al que apunta `paso_rechazado_id` de otro paso. Este
  plan no le agrega un tipo `'downsell'` al `CHECK` de `paginas.tipo`: seguiría siendo `'upsell'`. Ver
  D7.
- **Borrar `productos.whop_plan_id` ni `productos.precio`/`precio_anclaje`/`moneda`/`imagen_url`.**
  Quedan como columnas muertas de compatibilidad hasta una migración futura que confirme que nada las
  lee. Ver D2.
- **Editar el rediseño de la página pública de checkout (`/pagos/<slug>`) ni la de recuperación.** El
  punto 8 de arriba es el editor de ADMIN (`EditorFunnel.tsx`), no la página que ve el comprador.
- **Cambiar la lógica de `resolverDestino` en `lib/funnels.ts`.** Se verificó (ver conversación previa
  a este plan) que el modelo de una sola rama de rechazo (downsell XOR gracias) ya es correcto ahí. El
  problema reportado era de claridad visual en el editor, no de datos.

## 1. Decisiones cerradas

No hay nada que decidir. Si aparece algo que este documento no resuelve, se anota en §10 y **no se
decide en el código**.

**D1 — La agrupación de productos existentes es automática, por `whop_product_id` compartido, y el
"ganador" de cada grupo es el más viejo por `created_at`.** El usuario confirmó explícitamente que
prefiere la agrupación automática a revisar caso por caso. Dos productos con el mismo
`whop_product_id` son, por definición de la API de Whop, el mismo `access_pass` con dos planes — no
hay ambigüedad que adivinar ahí. Un producto sin `whop_product_id` (vinculado a mano con el plan_id
pegado directamente, sin pasar por el catálogo) es su propio grupo: agruparlo por nombre sería
adivinar, y el usuario no lo pidió. Verificado contra un caso sintético idéntico al de la captura del
usuario (ver §3): dos planes del mismo `access_pass` terminan bajo un único producto padre, con sus
dos precios y sus dos páginas intactos.

**D2 — Las columnas viejas de `productos` (`whop_plan_id`, `precio`, `moneda`, `precio_anclaje`) NO se
borran en este módulo.** Borrarlas en la misma migración que las vuelve obsoletas es la forma más
rápida de perder el dato si algo en la migración de datos salió mal y nadie lo notó antes del deploy.
Quedan como columnas muertas — sin índice único activo sobre `whop_plan_id` desde que
`producto_planes_whop_plan_idx` toma su lugar — hasta una migración futura, fuera de este plan, que
confirme con un `grep` que ningún código las lee más.

**D3 — El slug automático de un upsell es `<base-normalizada>-<sufijo-random>`, con el sufijo de 5
bytes aleatorios codificados en base64url (7 caracteres).** Verificado (ver §3): 0 colisiones en
100.000 muestras generadas, y un largo total razonable para un atributo HTML
(`upsell-1-mjfjbig`, no un UUID de 36 caracteres). La base normalizada sigue las mismas reglas que
`previsualizarSlug`/`normalizarSlug` ya existentes — se reusan, no se reimplementan — así que el
prefijo sigue siendo legible para quien mire la base a mano, y el sufijo es lo que garantiza que dos
operadores escribiendo "Upsell 1" al mismo tiempo no choquen contra `paginas_slug_idx`.

**D4 — El campo de slug desaparece del formulario de un paso `upsell`, igual que ya no se muestra en
un paso `front` (que deriva su slug del nombre del producto).** El usuario fue explícito: "no lo tiene
que poder modificar el usuario y eso no importa porque no se ve el slug". El slug se sigue guardando y
usando igual que hoy (`data-hilvana-upsell="<slug>"`); lo único que cambia es que nadie lo escribe ni
lo lee en el formulario.

**D5 — Un solo snippet de botón, sin selector de modo.** El toggle `modo: 'wallet' | 'guardada'` de
`SnippetDelPaso` se elimina. El panel entrega un único snippet por paso — el mismo mecanismo que ya
eligió el checkout real en runtime desde el 2026-09-13 (`ESTADO.md` §3.0: "el botón elige la rama sola
según con qué se pagó el front"), así que el panel deja de ofrecer una decisión que ya no le
corresponde a un humano tomar de antemano. Cuál de los dos snippets (`data-hilvana-wallet` o
`data-hilvana-upsell`) se genera por default es una decisión de T05 (ver la task), no de este
documento — la reevalúa contra el comentario vivo de `SnippetDelPaso` al momento de implementar,
porque ese comentario es el que documenta cuál camino está confirmado con tráfico real *a la fecha en
que se ejecute la task*, y puede haber cambiado entre que se escribe este plan y que se implementa.

**D6 — El snippet de rechazo nunca genera el placeholder `/downsell`. Si el destino no está resuelto,
no se ofrece el bloque de código como copiable.** Es el mismo patrón que ya existe para un paso sin
guardar (`SnippetDelPaso` muestra un aviso en vez de un `<pre>` cuando `!paso.id || !guardado`): se
extiende esa misma guarda para cuando `paso.permite_rechazo && paso.paso_rechazado_indice == null`. La
función pura `snippetRechazo` de `lib/admin/integracion.ts` conserva su firma y su fallback interno
—**no se toca esa función, que tiene 8 tests que fijan ese comportamiento exacto**—; lo que cambia es
que el componente de React deja de invocarla en el caso sin resolver, y en su lugar muestra el mismo
tipo de aviso que ya usa para "guardá el funnel primero".

**D7 — Un "downsell" sigue sin ser un tipo de dato propio.** Confirmado leyendo `lib/funnels.ts`
(`resolverDestino`) y `db/migrations/003_funnels.sql`: el modelo ya es una sola rama de rechazo
(`paso_rechazado_id` **o** `funnel.url_gracias`, nunca los dos a la vez — no hay combinación posible).
Lo que el usuario reportó en la captura ("Rechazó el upsell → página de gracias" + botón "+ downsell"
mostrados juntos) es un problema de legibilidad del editor, no de datos: el botón "+ downsell" crea un
paso nuevo al que *después* se apunta esa rama, reemplazando "página de gracias" — no las combina. La
task de rediseño visual (§0 punto 8) tiene que resolver esa ambigüedad de lectura, sin tocar
`lib/funnels.ts` ni sus 22 tests.

**D8 — El primer paso de un funnel nuevo exige producto principal + página de gracias antes de poder
agregar el segundo paso.** Cambia el flujo del asistente (`EditorFunnel.tsx`): hoy se puede guardar un
funnel con un solo paso `front` y sin `url_gracias`, y `guardarFunnel` lo acepta. Este plan no cambia
esa validación de guardado (sigue aceptando un funnel de un solo paso, que es válido: un producto sin
upsells todavía) — cambia el *flujo de creación en pantalla*, no la regla de negocio del backend.

## 2. Arquitectura

```
                          ANTES                                          DESPUÉS
  productos ──1:1──── whop_plan_id (único)          productos ──1:N──── producto_planes
      │                                                  │                    │
      │ producto_id                                      │                    │ whop_plan_id (único)
      ▼                                                   │                    │ etiqueta, precio, es_default
  paginas                                                  │                    ▼
                                                            └─────────────► paginas.producto_plan_id
                                                                             (paginas.producto_id queda
                                                                              como columna muerta, D2)

  Flujo de agrupación de datos existentes (migración 010, ya verificada §3):

  productos (6 filas viejas)
    │  agrupadas por whop_product_id compartido (o su propio id si es NULL)
    ▼
  grupos → 1 "ganador" por grupo (el más viejo por created_at)
    │
    ▼
  producto_planes (una fila por cada producto viejo, TODAS apuntando al
                    producto_id del ganador de su grupo)
    │
    ▼
  paginas.producto_plan_id ← resuelto por el whop_plan_id ORIGINAL de cada
                              página, no por su producto_id viejo
```

La decisión estructural que mantiene esto testeable: la generación de slug (D3) y los snippets
(D5/D6) siguen viviendo en funciones puras de `lib/admin/integracion.ts` — nada de lo que este plan
agrega debería requerir tocar la base o la red para probarse. La única pieza con efectos nueva es la
migración de datos en sí, y esa ya está verificada (§3) antes de que ninguna task la ejecute en su
entorno.

## 3. Esquema — fuente de verdad, YA VERIFICADO

`_schema-010-producto-planes.sql` en esta carpeta es el DDL canónico. **Ya se ejecutó dos veces**
contra una base scratch (`checkout_scratch3`) con las 9 migraciones previas aplicadas y los 4
productos/páginas reales de la base local `checkout` volcados encima, más un caso sintético de dos
planes con el mismo `whop_product_id` (el "Acelerador 7X" de la captura del usuario). Las dos corridas
dieron: primera vez 6 `INSERT`/6 `UPDATE`, segunda vez 0/0 (idempotente). El caso del Acelerador 7X
quedó con **un** producto padre y sus dos variantes con el precio y la etiqueta correctos. El detalle
completo con la salida real está en `_verificacion-producto-planes.sql`, que también ya se corrió y
dio exactamente lo que dice esperar — incluido el error del bloque 3 (que es el resultado *correcto*:
prueba que el índice `producto_planes_un_default_idx` rechaza una segunda default).

| Tabla | Para qué |
|---|---|
| `producto_planes` | Cada precio/plan cobrable de un producto. `whop_plan_id` es único acá (se mueve desde `productos`). |
| `paginas.producto_plan_id` | Columna nueva. Reemplaza a `producto_id` como lo que un paso/página cobra de verdad. |

Cuatro detalles del esquema que hay que entender antes de escribir contra él:

1. **`producto_planes.precio` es `numeric(10,2)`, string desde el driver `pg` — igual que
   `productos.precio` hoy.** Ver la advertencia ya escrita en `lib/tipos.ts` sobre este mismo punto:
   no cambia con esta migración, se repite acá porque `Producto` va a dejar de tener `precio` propio
   (ver el contrato de §4).
2. **`paginas.producto_id` sigue existiendo y sigue siendo `not null`.** No se migra a nullable en esta
   task: es una FK con `on delete restrict` que ya tienen filas reales apuntándole, y volverla nullable
   sin necesidad agrega superficie de bug por ningún beneficio — el código nuevo simplemente deja de
   *leerla* para decidir qué se cobra, usa `producto_plan_id` en su lugar.
3. **`producto_planes_un_default_idx` es un índice único parcial** (`where es_default`), no un
   `boolean` con default y sin restricción. Es lo que hace imposible que dos variantes del mismo
   producto queden marcadas como default a la vez — verificado en el bloque 3 de
   `_verificacion-producto-planes.sql`.
4. **La migración de agrupación (fase B del schema) resuelve `paginas.producto_plan_id` por el
   `whop_plan_id` de la página ORIGINAL, nunca por su `producto_id` viejo.** Es la parte más fácil de
   romper si alguien "simplifica" esto después: el `producto_id` de una página puede ya no ser el
   ganador de su grupo (se fundió en otro), así que resolver por `producto_id` directo apuntaría al
   producto equivocado la mitad de las veces que hubo agrupación real.

## 4. Contrato congelado — los tipos de `lib/tipos.ts`

**Lo declara T01. Lo consumen todas las tasks de la ola 2.** `lib/tipos.ts` ya existe en el repo como
el archivo de tipos compartidos del checkout — sigue siendo de una sola task a la vez, y esta vez es
T01 quien lo extiende con los tipos nuevos de este módulo, sin tocar los que ya usa el checkout en
producción (`Pagina`, `Orden`, `Cobro`, `RespuestaCobro`, etc. — esos quedan exactamente igual).

```ts
/** Fila de `productos`. YA NO tiene precio propio: precio vive en ProductoPlan. */
export type Producto = {
  id: string;
  nombre: string;
  imagen_url: string | null;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
  // whop_plan_id, precio, moneda, precio_anclaje, whop_nombre_soft: retirados de
  // este tipo (siguen en la tabla, D2, pero nadie los lee vía este tipo).
  // whop_product_id se mantiene: identifica el access_pass del PRODUCTO, no de
  // un plan puntual, y sirve para "agregar otra variante del mismo access_pass"
  // en la ficha de edición.
  whop_product_id: string | null;
};

/** Fila de `producto_planes`. Cada precio cobrable de un producto. */
export type ProductoPlan = {
  id: string;
  producto_id: string;
  whop_plan_id: string;
  whop_nombre_soft: string | null;
  etiqueta: string;
  /** numeric(10,2) del driver pg → string, igual que Producto.precio antes. */
  precio: string;
  moneda: string;
  precio_anclaje: string | null;
  es_default: boolean;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Un producto con TODAS sus variantes de precio ya resueltas. */
export type ProductoConPlanes = Producto & { planes: ProductoPlan[] };

/**
 * Lo que la página de checkout y el editor de funnels necesitan: el producto
 * resuelto a través de SU variante específica, aplanado para no obligar a cada
 * consumidor a navegar `producto.planes.find(...)`.
 *
 * Reemplaza al uso de `PaginaConProducto` de `lib/tipos.ts` (plan anterior) en
 * todo lugar donde antes se leía `producto.precio` — ahora se lee
 * `productoPlan.precio` a través de este tipo aplanado.
 */
export type PaginaConProductoPlan = Omit<import('./tipos').Pagina, 'producto_id'> & {
  producto_plan: ProductoPlan & { producto: Producto };
};
```

Reglas de implementación que no son negociables:

1. **`Producto` pierde `precio`, `moneda`, `precio_anclaje`, `whop_plan_id`, `whop_nombre_soft` como
   campos propios.** Cualquier código que hoy lee `producto.precio` tiene que migrar a leer el precio
   de la variante (`ProductoPlan.precio`) — no hay un "precio del producto" ambiguo una vez que un
   producto puede tener dos precios.
2. **`PaginaConProducto` (el tipo viejo) se retira y se reemplaza por `PaginaConProductoPlan`** en todo
   el código nuevo. No coexisten dos formas de resolver "qué cobra esta página" — es exactamente el
   tipo de ambigüedad que produce el bug original que este módulo corrige.
3. **`Producto.whop_product_id` es la clave para "agregar otra variante".** La ficha de edición de un
   producto, al ofrecer agregar una variante nueva, filtra el catálogo de Whop (`catalogoWhop()`) por
   planes cuyo `product?.id` matchee este campo — así la variante nueva queda garantizada del mismo
   `access_pass`, sin que el operador pueda vincular por error el plan de otro producto.
4. **Nada de `any` en este archivo.** Mismo criterio que el plan anterior: es un archivo que varias
   tasks importan a la vez.

## 5. Contrato congelado — generación de slug con sufijo anticolisión

**Lo declara e implementa T01, en `lib/admin/integracion.ts` (mismo archivo que ya tiene
`normalizarSlug`/`previsualizarSlug`). Lo consume el editor de funnels (T05) y el guardado
de funnel (`lib/admin/funnels.ts`).**

```ts
/**
 * Genera un slug único para un paso nuevo: `<base>-<sufijo>`.
 *
 * El sufijo son 5 bytes aleatorios en base64url (7 caracteres: `[A-Za-z0-9_-]`),
 * no un UUID completo — un slug es un atributo HTML y una URL pública, y un
 * sufijo de 7 caracteres ya da 0 colisiones en 100.000 muestras (verificado,
 * §3 de este plan) sin que el link se vea como un hash ilegible.
 *
 * NO se valida contra la base acá — es una función pura. El caller (el
 * guardado del funnel) es quien reintenta con un sufijo nuevo si
 * `paginas_slug_idx` rechaza, igual que hoy reacciona a `slug_ocupado`.
 */
export function generarSlugConSufijo(base: string): string {
  // implementación: normalizarSlug(base) + '-' + 5 bytes random en base64url
}
```

Reglas de implementación que no son negociables:

1. **El sufijo usa `crypto.randomBytes`, no `Math.random()`.** `Math.random()` no es criptográfico y
   su período es corto; para una garantía de "nunca dos operadores chocan" hace falta la entropía real
   del sistema operativo. Verificado con `crypto.randomBytes(5).toString('base64url')`: 0 colisiones en
   100.000 muestras (§3).
2. **`base64url`, no `base64` simple.** `base64` estándar incluye `+` y `/`, que no son válidos en un
   slug de URL sin escapar. `base64url` (RFC 4648 §5) usa `-` y `_` en su lugar, que sí lo son.
3. **La colisión final la sigue resolviendo el índice único de la base
   (`paginas_slug_idx`), no esta función.** Es el mismo patrón que D1 del plan anterior para el
   anti-doble-cobro: la garantía real es el constraint de Postgres, la función solo hace la
   probabilidad de necesitarlo casi nula.

## 6. Dependencias y olas de paralelismo

```
  ola 1        T01  esquema + tipos + slug + catálogo agrupado         1 agente, SOLA
                │
                ├───────────────┬───────────────┬───────────────┐
  ola 2       T02             T03             T04             T05      4 en paralelo
             ficha de       nav + home       funnel          snippets
             producto       nuevo            guiado          sin placeholder
                │               │               │               │
                └───────────────┴───────┬───────┴───────────────┘
                                        │
  ola 3                                T06  rediseño visual del editor   1 agente, y solo
                                            de funnels                   después de T03+T04+T05
```

| Task | Depende de | Se puede correr junto con |
|---|---|---|
| T01 | — | **nada, va sola** |
| T02 | T01 (`lib/tipos.ts`, `ProductoConPlanes`) | T03, T04, T05 |
| T03 | T01 (`lib/tipos.ts`) | T02, T04, T05 |
| T04 | T01 (`lib/tipos.ts`, `generarSlugConSufijo`) | T02, T03, T05 |
| T05 | T01 (`lib/tipos.ts`) | T02, T03, T04 |
| T06 | T03 + T04 + T05 (todas verificadas) | nada |

Lo que no es obvio:

- **T02, T03, T04 y T05 tocan archivos disjuntos**, aunque tres de ellas (T03, T04, T05) rocen
  `app/admin/(panel)/funnels/`: T03 toca el nav (`components/panel/NavPanel.tsx`) y el Home
  (`app/admin/(panel)/page.tsx`); T04 toca el flujo de creación (`app/admin/(panel)/funnels/nuevo/`,
  `FormularioPaso.tsx` en la parte de tipo de paso, no en la de slug); T05 toca los snippets
  (`SnippetDelPaso` dentro de `EditorFunnel.tsx`, y `FormularioPaso.tsx` en la parte del campo de
  slug que elimina). Cada una tiene su fila exacta en §7 — leerla antes de asumir que "todas tocan
  EditorFunnel.tsx" es lo mismo que "chocan".
- **T06 va sola y al final porque su trabajo es visual sobre los MISMOS componentes que T04 y T05
  cambiaron funcionalmente.** Rediseñar antes de que la lógica esté asentada significa rediseñar dos
  veces, o pisar los cambios funcionales con un refactor visual que no sabe que están ahí. Es una
  **excepción documentada** de ownership sobre `EditorFunnel.tsx` — ver la nota al pie de la tabla de
  §7 — porque T05 y T06 escriben ese mismo archivo, pero nunca al mismo tiempo: T06 no arranca hasta
  que T05 verificó y cerró.
- **El límite son las dependencias, no la cantidad de agentes.** Un quinto agente en la ola 2 no tiene
  nada independiente que hacer: las cuatro piezas de esa ola son las únicas piezas paralelas del
  módulo.

**Si preferís ir de a uno:** T01 → T02 → T03 → T04 → T05 → T06. Dejá T06 (lo visual) para el final en
cualquier orden que elijas, por la razón de arriba.

## 7. Ownership de archivos — regla anti-colisión

**Cada task solo escribe los archivos de su fila.** Si necesita algo de un archivo ajeno, lo lee pero
no lo escribe; si cree que necesita escribirlo, va a §10.

| Task | Archivos que puede crear o modificar |
|---|---|
| T01 | `db/migrations/010_producto_planes.sql` (copia exacta de `_schema-010-producto-planes.sql`), `db/migrations/011_producto_plan_id_nullable.sql` (**agregado durante la ejecución real**, ver §10 P-06), `lib/tipos.ts`, `lib/admin/slug.ts` (**agregado durante la ejecución real**, ver §10 P-05: `normalizarSlug` movida acá, pura, sin `pg`), `lib/admin/integracion.ts` (solo agrega `generarSlugConSufijo`, no toca lo demás), `lib/admin/productos.ts` (reescribe para `producto_planes`), `lib/admin/catalogo.ts` (agrupa por `whop_product_id` al construir `Catalogo`), `lib/admin/paginas.ts` (cambia `producto_id` → `producto_plan_id` en las queries que arman `PaginaConProductoPlan`), `lib/admin/funnels.ts` (cambia las queries de `PasoDeFunnel` para leer a través de `producto_plan_id`), `lib/salidas.ts` y `lib/salidas.test.ts` (**agregado durante la ejecución real de T01**: este archivo construye un `Producto` completo para un cobro histórico, pero solo lee `nombre`/`moneda` — se reduce `FilaCobroParaSalida.producto` a ese tipo mínimo en vez de al `Producto` completo, ver §10 P-04), y sus `*.test.ts` |
| T02 | `app/admin/(panel)/productos/**`, `app/api/admin/productos/**` |
| T03 | `components/panel/NavPanel.tsx`, `app/admin/(panel)/page.tsx` (nuevo Home resumen), y el borrado de `app/admin/(panel)/paginas/**` + `app/api/admin/paginas/**` (mover su función de edición de slug a T02, no reimplementarla) |
| T04 | `app/admin/(panel)/funnels/nuevo/page.tsx`, `app/admin/(panel)/funnels/FormularioPaso.tsx` (solo la parte de flujo guiado / tipo de paso — **excepción documentada**, ver nota debajo) |
| T05 | `app/admin/(panel)/funnels/EditorFunnel.tsx` (solo `SnippetDelPaso` y su uso — **excepción documentada**, ver nota debajo), `app/admin/(panel)/funnels/FormularioPaso.tsx` (solo el bloque del campo de slug que se elimina, D4 — **excepción documentada**, ver nota debajo) |
| T06 | `app/admin/(panel)/funnels/EditorFunnel.tsx` (estilos y estructura visual, sin tocar lógica ya escrita por T04/T05 — **excepción documentada**: T06 reemplaza a T05 como dueño de este archivo, y solo puede empezar a escribirlo después de que la verificación de T05 haya pasado), `components/panel/ui.tsx` si necesita un primitivo visual nuevo reusable |

**Excepción documentada — `FormularioPaso.tsx` tiene dos dueños EN LA MISMA OLA (T04 y T05), en
fragmentos disjuntos del mismo componente, no en secuencia como el caso de `EditorFunnel.tsx` de
abajo.** D4 es el bloque del campo `slug-paso` (dueño: T05); el selector de tipo de paso / flujo
guiado es otro bloque del mismo archivo (dueño: T04). Cada una de las dos tasks tiene que dejar, en la
primera línea de su bloque de código (no del archivo entero, que sigue teniendo un solo encabezado),
un comentario que diga qué fragmento le pertenece — ej. `// [T05] desde acá: el slug se genera solo,
no hay campo editable` — para que si las dos corren en paralelo de verdad y sus diffs se tienen que
integrar a mano, quede claro qué línea es de quién. Si al implementar se nota que los fragmentos no
son tan disjuntos como parecen desde acá, es una señal para avisar en §10 antes de tocar una línea que
la otra task ya escribió, no de resolverlo compitiendo por el commit.

**Excepción documentada — `EditorFunnel.tsx` tiene dos dueños en el tiempo, nunca a la vez: T05
primero (retira el toggle de modo y el campo de slug de `SnippetDelPaso`), T06 después (rediseña
visualmente el mismo archivo ya con la lógica de T05 asentada).** No es una colisión de paralelismo
real porque T06 está en la ola 3 y su dependencia declarada (§6) es exactamente "T03+T04+T05
verificadas" — T06 no toca una línea de este archivo hasta que el trabajo de T05 sobre él ya pasó su
propia verificación y quedó cerrado. Es el mismo patrón que un `placeholder` que otra task reemplaza,
aplicado a "quién es el dueño actual de este archivo" en vez de a una función stub.

**Nota sobre D4 (el slug que desaparece del formulario) y T04 vs T05:** D4 y D5/D6 tocan el mismo
archivo (`FormularioPaso.tsx` para D4, `EditorFunnel.tsx` para D5/D6), pero son cambios en fragmentos
disjuntos del mismo componente — D4 es el bloque del campo `slug-paso` dentro de `FormularioPaso`, y
D5/D6 son el bloque `SnippetDelPaso` dentro de `EditorFunnel`. Se asignan las dos a **T05** en la tabla
de arriba (no a T04) precisamente para que sea un solo dueño de `FormularioPaso.tsx` en la parte de
slug — T04 solo toca la parte de "tipo de paso"/flujo guiado de ESE MISMO archivo. Si al implementar
se nota que los fragmentos no son tan disjuntos como parecen desde acá, es una señal para T05 de
avisar en §10 antes de tocar una línea que T04 ya escribió, no de resolverlo compitiendo por el commit.

**Archivos que NADIE toca:**

```
lib/estado-pago.ts           44 tests dependen de su comportamiento exacto
lib/whop-webhook.ts          15 tests
lib/whop.ts                  múltiples tasks lo llaman
lib/funnels.ts               22 tests — D7: el modelo de una rama ya es correcto
lib/reconciliacion.ts        15 tests en `emparejar`
lib/cobros.ts                lo escribe T01 del plan anterior; acá nadie lo toca
db/migrations/00{1..9}.sql   YA CORRIERON
app/api/webhooks/whop/route.ts
app/api/upsell/cobrar/route.ts
app/api/checkout/**          la página pública de checkout no se toca en este módulo
```

Lo que parece colisión y no lo es: T02 (`app/admin/(panel)/productos/**`) y T03 (borra
`app/admin/(panel)/paginas/**`) tocan directorios hermanos bajo `app/admin/(panel)/`, pero son
subárboles disjuntos — Next no tiene un archivo de rutas central que los una.

## 8. Criterios de aceptación globales

1. `npx tsc --noEmit` exit 0, `npx next build` compila, `npx vitest --run` todo en verde. La línea de
   base medida el 2026-09-13, antes de este módulo: **471 tests en 26 archivos, todos en verde.**
   Ningún test de esa línea de base puede quedar roto sin que la task que lo rompió lo actualice a
   propósito y lo diga.
2. `npm run db:migrate` corrido dos veces sobre una base con las 9 migraciones previas: la segunda
   dice "Nada nuevo que aplicar" y sale 0.
3. **Los 4 (o más) productos que ya existen en la base local de desarrollo siguen siendo cobrables
   después de la migración**: cada `pagina` que antes resolvía un precio via `producto_id` resuelve el
   mismo precio via `producto_plan_id` — comparar antes/después con la query de
   `_verificacion-producto-planes.sql`.
4. El caso del usuario está resuelto de punta a punta: dos planes del mismo `access_pass` en Whop,
   vinculados por separado como en el catálogo de hoy, terminan bajo un solo producto en
   `/admin/productos` con las dos variantes visibles y editables.
5. El nav no tiene el ítem "Links". `/admin/paginas` y sus rutas de API ya no existen.
6. Crear un funnel nuevo no deja avanzar al segundo paso sin haber elegido el producto principal y
   definido la página de gracias.
7. Un slug de upsell nuevo no aparece en ningún campo de texto editable del formulario, y dos pasos
   creados con el mismo nombre en el mismo funnel no chocan contra `paginas_slug_idx`.
8. Ningún snippet copiable contiene el string literal `/downsell` salvo que sea, de hecho, la URL real
   configurada para ese paso.
9. El editor de funnels ya no ofrece el selector "Apple Pay / tarjeta" vs "Tarjeta guardada": genera
   un solo snippet por paso.

## 9. Riesgo y modo seguro

Este módulo migra datos de producción potencial (D14 del plan anterior sigue vigente: todo nace
apagado, pero eso no protege datos ya cargados, solo protege que no cobren). La migración es aditiva
(§3): no hay ningún `DROP` ni cambio de tipo sobre columnas existentes, así que revertir es posible
con una migración de reversa que borre `producto_planes` y la columna `producto_plan_id` — pero esa
migración de reversa **no está incluida en este plan** porque ninguna task de este módulo debería
llegar a necesitarla si sigue D1-D8 al pie de la letra. Si alguna task encuentra que la migración de
datos produjo un resultado inesperado sobre datos reales (no sobre la scratch), es bloqueante — para y
avisa, no sigas "arreglando" con un UPDATE manual sin entender la causa.

## 10. Preguntas abiertas

Si aparece una decisión que este documento no resuelve, **se anota acá en lugar de decidirla en el
código**. Si bloquea, la task se detiene y no sigue con suposiciones.

### P-01 — Qué contenido exacto tiene el nuevo Home del panel (`/admin`)
- **Task:** T03
- **Sección del plan:** §0 punto 3
- **Qué falta:** El usuario dijo "el dashboard debe ser la parte de las ventas, pero eso lo vemos más
  adelante" — confirma que el Home NO es el dashboard de ventas en este módulo, pero no especificó qué
  sí muestra. Este plan propone un resumen mínimo (conteos de productos/funnels activos + accesos
  rápidos) como default razonable.
- **Bloquea:** no.
- **Mientras tanto:** T03 implementa el resumen mínimo descrito en §0 punto 3. Si el usuario quiere
  algo distinto, se ajusta después sin bloquear el resto del módulo — nada más depende de qué muestra
  exactamente el Home.
- **Resolución:**

### P-02 — Cuál de los dos snippets (`data-hilvana-wallet` o `data-hilvana-upsell`) es el único que se
  genera, una vez sacado el toggle
- **Task:** T05
- **Sección del plan:** D5
- **Qué falta:** Al momento de escribir este plan (2026-09-13), el comentario de `SnippetDelPaso`
  dice que `wallet` sigue siendo el default porque el cobro silencioso "todavía no se verificó con una
  compra real de punta a punta". Ese estado puede cambiar antes de que T05 se ejecute.
- **Bloquea:** no.
- **Mientras tanto:** T05 lee el comentario vivo de `SnippetDelPaso` y de `ESTADO.md` §3.0 al momento
  de implementar, y genera el snippet que esté confirmado con tráfico real a esa fecha. Si ninguno lo
  está todavía, genera `data-hilvana-wallet` (el más conservador, ya confirmado con Apple Pay real) y
  lo anota en esta sección con la fecha.
- **Resolución:** cerrada. T05 (2026-09-13) releyó `ESTADO.md` §3.0/§3.0.1 al momento de implementar:
  §3.0 registra cobros off-session reales y exitosos, pero ese trabajo vive en la rama
  `feature/checkout-sin-configuration`, sin mergear a `main`; §3.0.1 dice explícitamente "cambiar ese
  default a Tarjeta guardada es una decisión de producto pendiente, no un bloqueo técnico" — sin
  ninguna frase que confirme el flujo de punta a punta usando el snippet del propio panel. La
  condición para pasar al cobro silencioso no se cumplía, así que se mantuvo `data-hilvana-wallet`
  (`snippetWalletHtml`/`snippetWalletJsx`) como el único snippet. Documentado con fecha y fuente en el
  comentario de cabecera de `SnippetDelPaso` (`app/admin/(panel)/funnels/EditorFunnel.tsx`). Cuando el
  merge a `main` se confirme, ese mismo bloque cambia a `snippetBotonHtml`/`snippetBotonJsx` — no
  requiere ninguna otra pregunta abierta, es un cambio de una línea con la fuente ya identificada.

### P-03 — Si `productos.whop_plan_id` y las columnas de precio viejas se retiran en una migración
  futura, quién es dueño de esa migración
- **Task:** ninguna de este módulo (explícitamente fuera de alcance, D2)
- **Qué falta:** nada bloqueante — es una nota para no perder el hilo. Cuando se confirme (con un
  `grep` real) que ningún código lee esas columnas, alguien tiene que abrir una migración 011 que las
  retire. No es parte de este plan.
- **Bloquea:** no.
- **Resolución:** no aplica a este módulo.

### P-04 — `lib/salidas.ts` no tenía ownership asignado y su `tsc` se rompía con el contrato de §4
- **Task:** T01 (retroactivo — se descubrió ejecutando T01, no en la fase de verificación previa a
  escribir este plan)
- **Sección del plan:** §4 (el contrato de `Producto` sin precio propio)
- **Qué faltó:** la verificación de fase 3, antes de escribir este plan, no incluyó un `grep` de
  "qué otro código del repo construye un objeto `Producto` completo fuera de los archivos que las
  tasks ya tenían identificados". `lib/salidas.ts` (`buscarDatosParaSalida`, consumido por
  `app/api/cron/salidas/route.ts`, que corre en producción cada minuto) construye un `Producto`
  completo a partir de un cobro histórico — un patrón correcto y deliberado (un cobro pasado cobró lo
  que cobró, no el precio que el producto tiene hoy), pero incompatible con que `Producto` pierda
  `precio`/`whop_plan_id` según el contrato §4 tal como estaba escrito.
- **Cómo se resolvió:** se verificó con `grep` que los únicos consumidores reales de
  `FilaCobroParaSalida.producto` leen exclusivamente `nombre` (el cron, para el email de entrega) y
  `moneda` (`armarPayloadIngest`, como fallback cuando `cobro.moneda` es `null` — `Cobro.moneda` es
  nullable). Se redujo el tipo de ese campo a `{ nombre: string; moneda: string }` en vez de al
  `Producto` completo, con la query SQL de `buscarDatosParaSalida` ajustada para pedir solo esas dos
  columnas. `lib/salidas.test.ts` se ajustó al mismo tipo reducido. Verificado: `npx tsc --noEmit`
  sin errores en `lib/salidas.ts` ni su test, `npx vitest --run lib/salidas.test.ts` 14/14 en verde,
  suite completa 482/482 en verde.
- **Bloquea:** no, ya está resuelto.
- **Resolución:** cerrada. `lib/salidas.ts` se agregó a la fila de T01 en §7.

### P-05 — `lib/admin/integracion.ts` no puede tener ningún import server-only: rompía `next build`
- **Task:** T01 (retroactivo — se descubrió ejecutando la ola 2, de forma independiente por los
  4 agentes de T02/T03/T04/T05)
- **Sección del plan:** §5 (`generarSlugConSufijo`)
- **Qué faltó:** la implementación real de T01 usó `import { randomBytes } from 'node:crypto'` y
  `import { normalizarSlug } from './paginas'`. `paginas.ts` importa `../db`, que importa `pg`
  (server-only: `fs`/`net`/`tls`/`dns`). `integracion.ts` lo importa `EditorFunnel.tsx`
  (`'use client'`) para los snippets, y T05 además llamó a `generarSlugConSufijo` directamente desde
  `FormularioPaso.tsx` (también `'use client'`) — así que la función necesitaba poder ejecutar de
  verdad en el browser, no solo evitar romper el bundle.
- **Cómo se resolvió:**
  1. Se creó `lib/admin/slug.ts`, puro, sin ningún import de Node, con `normalizarSlug` movida ahí.
     `lib/admin/paginas.ts` la re-exporta (`export { normalizarSlug } from './slug'`) más un import
     local para las funciones internas de ese archivo que la usan — ningún import existente de
     `normalizarSlug` desde `./paginas` se rompió.
  2. `generarSlugConSufijo` se reescribió para usar `crypto.getRandomValues` (Web Crypto API
     estándar, disponible en Node 18+ y en el browser) en vez de `randomBytes` de `node:crypto`, con
     la codificación a base64url armada a mano (`btoa` + reemplazo de caracteres) porque
     `Buffer.toString('base64url')` tampoco existe en el browser.
- **Verificado:** `npx tsc --noEmit` exit 0, `npx vitest --run` 482/482 en verde (incluidos los 4
  tests de `generarSlugConSufijo` que fijan el formato del sufijo, sin cambios en su comportamiento
  observable), `npx next build` compila completo (confirmado con la lista de rutas generadas,
  incluidas las nuevas de T02).
- **Bloquea:** no, ya está resuelto.
- **Resolución:** cerrada.

### P-06 — `productos.whop_plan_id` y `productos.precio` seguían `NOT NULL`: el alta de un producto
  nuevo (sin plan propio) daba 500
- **Task:** T01 (retroactivo — se descubrió ejecutando T02)
- **Sección del plan:** D2 (§1) y §3 (el esquema)
- **Qué faltó:** D2 dice "las columnas viejas no se borran", pero no dice que además hacía falta
  **relajarlas** — la migración 010 nunca tocó su nullability, y `crearProductoConPlan` (T01, §4)
  inserta un producto "padre" sin darles ningún valor (el plan y el precio reales viven en la fila
  hija de `producto_planes`). Confirmado reproduciendo el alta real: `POST /api/admin/productos` con
  un producto nuevo daba 500 con "null value in column whop_plan_id", y una vez corregida esa, el
  mismo error sobre `precio`.
- **Cómo se resolvió:** migración aditiva `db/migrations/011_producto_plan_id_nullable.sql`
  (`alter column ... drop not null` sobre las dos columnas). Verificado contra una base scratch con
  las 10 migraciones previas: el insert real de `crearProductoConPlan` funciona, y dos productos
  "padre" con `whop_plan_id is null` coexisten sin violar `productos_whop_plan_idx` (un índice único
  de Postgres no cuenta los `NULL` como duplicados entre sí). Aplicada a la base local de desarrollo
  vía `npm run db:migrate` (idempotente: la segunda vez, "Nada nuevo que aplicar"), y verificado de
  punta a punta con un `POST /api/admin/productos` real contra el servidor corriendo: **201
  Created**, con el producto padre sin `whop_plan_id`/`precio` propios y su primera variante en
  `producto_planes` con ambos campos y `es_default: true`. Dato de prueba limpiado después.
- **Bloquea:** no, ya está resuelto.
- **Resolución:** cerrada. `db/migrations/011_producto_plan_id_nullable.sql` se agrega a la fila de
  T01 en §7.

### P-07 — `EditorFunnel` no distingue "paso con id real" de "paso sintético sin persistir", y
  `guardarFunnel` no chequea `rowCount` en su UPDATE
- **Task:** ninguna de este módulo todavía (reportado por T04, no resuelto — no bloquea su propio
  trabajo porque T04 evitó la ruta que lo dispara, ver abajo)
- **Sección del plan:** T04 §3 (el wizard de creación guiada)
- **Qué encontró T04:** `PasoDeFunnel.id` es `string` no-nullable, y `pasosAEditor` (dentro de
  `EditorFunnel.tsx`) copia `id: p.id` literal sin nunca nulificarlo. `guardarFunnel` (`lib/admin/
  funnels.ts`) decide INSERT vs UPDATE con `if (p.id) { UPDATE ... WHERE id = $10 }`, **sin chequear
  `rowCount`** después. Si algún caller le pasara a `EditorFunnel` un paso con un `id` inventado (por
  ejemplo, para precargar un paso "front" sintético antes de que el funnel exista en la base), el
  `UPDATE` afectaría 0 filas en silencio: el funnel se guardaría **sin ese paso insertado**, sin
  ningún error visible — en un servicio que cobra tarjetas reales hoy.
- **Por qué no es bloqueante ahora:** T04 no tomó esa ruta. En vez de pasarle a `EditorFunnel` un
  paso `front` pre-armado, el wizard deja `nombre`/`url_gracias` pre-poblados (que son solo estado
  inicial de dos `useState`, no pasan por `pasosAEditor` ni por el guardado de pasos) y el operador
  agrega el paso front con un click más, ya con el producto elegido visible en pantalla — el editor
  funciona exactamente igual que siempre a partir de ahí, sin ningún riesgo de dato corrupto.
- **Qué falta si se quiere cerrar del todo:** (a) que `PasoDeFunnel.id`/`EntradaPaso.id` acepten
  `string | null` de forma consistente en todo el flujo de precarga, y (b) que `guardarFunnel` chequee
  `rowCount` del UPDATE y trate 0 filas afectadas como un error, no como éxito silencioso. Es un
  cambio en `lib/admin/funnels.ts` (T01) y posiblemente en `EditorFunnel.tsx` — ninguna task de este
  módulo tiene ese trabajo asignado.
- **Bloquea:** no el módulo actual (T04 lo evitó). Si se quiere ofrecer en el futuro la posibilidad
  de precargar un paso completo (no solo nombre/gracias) antes de que el funnel exista en la base,
  sí bloquea esa feature específica.
- **Resolución:** abierta. Anotado para una task futura fuera de este plan.
