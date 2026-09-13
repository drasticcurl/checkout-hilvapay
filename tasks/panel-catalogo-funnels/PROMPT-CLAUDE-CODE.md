# Prompts para Claude Code — panel-catalogo-funnels

## Antes de arrancar

```
tasks/panel-catalogo-funnels/
├── 00-README-LEER-PRIMERO.md              LEER ANTES QUE NADA — por qué no seguir tasks/checkout-whop/
├── 00-PLAN-PANEL-CATALOGO-FUNNELS.md      el documento maestro
├── PROMPT-CLAUDE-CODE.md                  este archivo
├── _schema-010-producto-planes.sql        el DDL, YA CORRIDO dos veces contra datos reales
├── _verificacion-producto-planes.sql      las afirmaciones, YA EN VERDE
├── T01-esquema-tipos-slug-catalogo.md     fundacional, va sola
├── T02-ficha-producto-con-variantes.md
├── T03-nav-y-home-sin-links.md
├── T04-funnel-guiado.md
├── T05-slug-oculto-snippet-unico.md
└── T06-rediseno-editor-funnels.md         visual, va última y sola
```

**Ya está verificado, y por qué eso ahorra trabajo:** el esquema de `producto_planes` corrió dos veces
contra una base scratch con las 9 migraciones previas del proyecto y con los 4 productos/páginas
reales de la base local de desarrollo volcados encima, más un caso sintético idéntico al que reportó
el usuario (dos planes del mismo `access_pass` de Whop, a 27 y 17 USD). Los archivos `_schema-*.sql` y
`_verificacion-*.sql` no son documentación — son ejecutables, y ya se corrieron. T01 los copia, no los
reescribe.

### 5 cosas que hay que saber antes de largar el primer agente

**1. T01 va sola y primero.** Declara `lib/tipos.ts` (los 4 tipos nuevos) y
`generarSlugConSufijo` en `lib/admin/integracion.ts` — las cuatro tasks de la ola 2 importan esas
formas exactas. Si T01 falla o cambia algo de esas firmas a mitad de camino, la ola 2 entera queda
escribiendo contra un contrato que se movió.

**2. Si la migración de datos de T01 produce algo distinto de lo que dice §3 del plan sobre datos
reales (no la scratch), es bloqueante para el proyecto entero.** Significa que hay un caso real que
la verificación previa no cubrió, y seguir sobre un esquema de agrupación que no se entiende sería
multiplicar el error por las cinco tasks siguientes.

**3. El proyecto tiene datos reales en desarrollo y (potencialmente) en producción.** La migración es
aditiva — no hay ningún `DROP` ni cambio de tipo — pero eso no la vuelve inofensiva: agrupa productos
existentes automáticamente. Cualquier task que note un resultado de agrupación que no tiene sentido
sobre datos reales para, no "arregla" con un UPDATE manual.

**4. La línea de base es 471 tests en 26 archivos, medida el 2026-09-13 antes de este módulo.**
Cualquier task que la rompa sin poder explicar por qué el comportamiento viejo tenía que cambiar, para
y avisa — no se "arreglan" tests bajándoles la exigencia.

**5. El plan es el contrato.** §4 (tipos) y §5 (slug) están congelados: nadie los mejora a mitad de
camino. Las decisiones D1-D8 de §1 tienen el bug que evitan escrito al lado — leerlas evita reabrir
una discusión que ya se cerró con evidencia.

## El orden

```
Paso 1   T01                       1 agente, SOLO
Paso 2   T02 · T03 · T04 · T05     4 en paralelo
Paso 3   T06                       1 agente, solo, y solo después de que T03+T04+T05 verifiquen
```

**Una task bloqueante no está terminada hasta que su verificación pasa.** T01 no se considera cerrada
hasta que su bloque de verificación (§8 de su task) da los resultados que dice esperar — no hasta que
"compila". La ola 2 no arranca antes de eso. T06 no arranca hasta que T03, T04 y T05 (las tres, no
alguna) verificaron — es la única task cuyo trabajo es sobre la superficie visual que las otras tres
modificaron funcionalmente.

**Si preferís ir de a uno:** T01 → T02 → T03 → T04 → T05 → T06, en ese orden o cualquier orden entre
T02-T05 que prefieras, dejando T06 (lo visual) siempre para el final.

---

## Preámbulo (va al inicio de cada prompt)

> Este es el repo `checkout-kashhhpay`: un checkout propio sobre Whop, en producción
> (`pay.hilvanapp.com` / `hilvapay.hilvanapp.com`), reemplazando a KashPay. El módulo que vas a tocar
> es sobre el panel de administración (`/admin`), no sobre el checkout público que cobra tarjetas —
> pero la base de datos es la misma, y algunas tablas (`productos`, `paginas`) las lee también el
> checkout público. Revisá `ESTADO.md` en la raíz del repo si necesitás contexto de qué está en
> producción hoy.
>
> Leé estos archivos completos antes de escribir código, **en este orden exacto**:
> 1. `tasks/panel-catalogo-funnels/00-README-LEER-PRIMERO.md` — antes que nada. Aclara que la carpeta
>    hermana `tasks/checkout-whop/` es solo referencia histórica y no hay que seguirla.
> 2. `tasks/panel-catalogo-funnels/00-PLAN-PANEL-CATALOGO-FUNNELS.md`
> 3. `tasks/panel-catalogo-funnels/<TU-TASK>.md`
>
> El esquema nuevo (`_schema-010-producto-planes.sql`) y su verificación
> (`_verificacion-producto-planes.sql`) ya corrieron contra datos reales — no los re-verifiques desde
> cero, leélos para entender qué garantizan.
>
> Reglas que no se negocian:
> - **Solo escribís los archivos de tu fila en §7 del plan.** Otros agentes trabajan en paralelo. Si
>   creés que necesitás tocar uno ajeno, anotalo en §10 del plan en vez de tocarlo.
> - **Hay una lista de archivos que NADIE toca** (§7 del plan): `lib/estado-pago.ts`,
>   `lib/whop-webhook.ts`, `lib/whop.ts`, `lib/funnels.ts` (sin `admin/`), `lib/reconciliacion.ts`,
>   `lib/cobros.ts`, las migraciones 001-009, y las rutas del checkout público. Son caminos que hoy
>   cobran tarjetas reales.
> - **No instalás dependencias ni editás `package.json`.** Si algo falta, va a §10.
> - **No cambiás el esquema de `producto_planes` ni los tipos de `lib/tipos.ts` una vez que T01 los
>   declaró.** Están congelados porque las otras tres tasks de la ola 2 se escriben contra ellos al
>   mismo tiempo que vos.
> - **Si aparece una decisión que el plan no resuelve, no la decidís en el código:** va a §10. Si
>   bloquea, parás y avisás.
> - **El idioma es castellano**, con voseo, igual que el resto del proyecto. Los comentarios de código
>   también van en castellano — mirá cualquier archivo existente del repo para el tono exacto (directo,
>   explica el bug que evita cada decisión, sin relleno).
> - **Numeric de Postgres llega como string del driver `pg`.** Si tratás un precio como number en
>   algún punto nuevo, `9.90` se puede mostrar como `9.9` — formateá explícito, como ya hace el resto
>   del código (`Number(precio).toFixed(2)`).
> - **Al terminar, corré tu sección de Verificación COMPLETA y pegame la salida.** Si algo falla,
>   arreglalo antes de decir que terminaste. "Compila" no es verificación — la línea de base son 471
>   tests, y tu tarea termina cuando esos más los tuyos están en verde.

## Paso 1

### T01 — esquema, tipos, slug, catálogo agrupado
> [preámbulo, con `<TU-TASK>` = `T01-esquema-tipos-slug-catalogo.md`]
>
> Ejecutá T01 completa: copiá la migración verificada, extendé `lib/tipos.ts` con los 4 tipos nuevos
> de §4 del plan, agregá `generarSlugConSufijo` a `lib/admin/integracion.ts`, y reescribí
> `lib/admin/productos.ts`, `lib/admin/catalogo.ts`, `lib/admin/paginas.ts` y `lib/admin/funnels.ts`
> para leer y escribir a través de `producto_planes`.
>
> Cuatro cosas con atención especial:
> 1. **La migración de datos agrupa por `whop_product_id` compartido, y el "ganador" de cada grupo es
>    el más viejo por `created_at`.** No cambies ese criterio: es la parte que hace que el caso real
>    del usuario (dos planes del mismo access_pass) termine bajo un solo producto.
> 2. **`snippetRechazo`, `snippetBotonHtml`, `snippetBotonJsx`, `snippetWalletHtml`, `snippetWalletJsx`
>    y sus 8+ tests en `lib/admin/integracion.test.ts` no cambian ni una línea.** Solo agregás
>    `generarSlugConSufijo` al final del archivo.
> 3. **`Producto` en `lib/tipos.ts` pierde `precio`/`moneda`/`precio_anclaje`/`whop_plan_id` como
>    campos propios.** Cualquier código (tuyo, en los cuatro archivos que reescribís) que hoy lee
>    `producto.precio` tiene que migrar a leer `productoPlan.precio`.
> 4. **La línea de base son 471 tests. Al final, `npx vitest --run` completo tiene que dar >= 471 en
>    verde**, no solo los archivos que tocaste.

## Paso 2 (los cuatro en paralelo, solo después de que T01 verifique)

### T02 — ficha de producto con variantes
> [preámbulo, con `<TU-TASK>` = `T02-ficha-producto-con-variantes.md`]
>
> Ejecutá T02 completa: la ficha de `/admin/productos/[id]` pasa a mostrar todas las variantes de
> precio de un producto, cada una con su slug/link editable ahí mismo — es lo que reemplaza a la
> sección "Links" que T03 está eliminando del nav en paralelo.
>
> Atención especial: el `PATCH` de edición de slug que hoy vive en
> `app/api/admin/paginas/[id]/route.ts` lo seguís llamando desde tu pantalla nueva — no reimplementes
> esa lógica. Es la única dependencia de timing real con T03 (que puede o no borrar ese archivo antes
> de que termines): si notás la colisión, avisá en vez de resolverla escribiendo en un archivo que no
> es tuyo.

### T03 — nav sin "Links", Home nuevo
> [preámbulo, con `<TU-TASK>` = `T03-nav-y-home-sin-links.md`]
>
> Ejecutá T03 completa: sacá el ítem "Links" del nav, reemplazá el Home del panel por un resumen
> mínimo (sin tabla de links, sin dashboard de ventas — eso es otro módulo, confirmado por el
> usuario), y borrá las pantallas de `/admin/paginas`.
>
> Atención especial: preferí la opción (a) de §3 de tu task para las rutas de API — dejar viva
> `app/api/admin/paginas/[id]/route.ts` (el `PATCH`) porque T02 la sigue llamando, y borrar solo el
> resto.

### T04 — funnel guiado: producto + gracias obligatorios
> [preámbulo, con `<TU-TASK>` = `T04-funnel-guiado.md`]
>
> Ejecutá T04 completa: al crear un funnel nuevo, no se puede agregar el segundo paso sin haber
> elegido el producto principal y escrito la página de gracias primero.
>
> Atención especial: implementalo como wizard dentro de `app/admin/(panel)/funnels/nuevo/page.tsx`
> (Opción A de §3 de tu task), sin tocar `EditorFunnel.tsx` — ese archivo es de T05 y T06 en esta
> misma ola/siguiente, y editarlo genera una colisión real, no aparente.

### T05 — slug oculto, snippet único, sin placeholder
> [preámbulo, con `<TU-TASK>` = `T05-slug-oculto-snippet-unico.md`]
>
> Ejecutá T05 completa: el slug de un upsell nuevo se genera solo (con `generarSlugConSufijo` de T01)
> y no aparece en el formulario; el editor deja de ofrecer el selector "Apple Pay/tarjeta" vs "Tarjeta
> guardada" y genera un solo snippet; y ningún snippet copiable cae al placeholder `/downsell` cuando
> el destino de rechazo todavía no está resuelto.
>
> Atención especial: antes de elegir cuál de los dos snippets es el único que sobrevive, releé el
> comentario vivo de `SnippetDelPaso` en `EditorFunnel.tsx` Y `ESTADO.md` §3.0 AL MOMENTO EN QUE
> EJECUTÁS ESTO — pueden haber cambiado desde que se escribió el plan. Documentá tu elección con fecha
> y fuente en el propio comentario del código, y completá P-02 de §10 del plan.

## Paso 3 (sola, después de que T03+T04+T05 verifiquen)

### T06 — rediseño visual del editor de funnels
> [preámbulo, con `<TU-TASK>` = `T06-rediseno-editor-funnels.md`]
>
> Ejecutá T06 completa: rediseñá visualmente `EditorFunnel.tsx` para que se vea a la altura del resto
> del panel y para que el problema de D7 (las dos ramas de rechazo leyéndose como simultáneas) quede
> resuelto visualmente. Hacé tu propio audit primero (§2 de tu task) y elegí entre `minimalist-ui` y
> `design-taste-frontend` según lo que encuentres — no antes de mirar la pantalla real con T03+T04+T05
> ya aplicadas.
>
> Atención especial: cero cambios de comportamiento. Si en el audit encontrás que algo de la lógica
> (no solo el estilo) mejoraría la claridad de D7, anotalo en §10 del plan como propuesta — no lo
> implementes en este mismo commit.

---

## Qué revisar cuando terminan

```bash
# 1 — compila, buildea, tests
npx tsc --noEmit && npx next build && npx vitest --run
# esperado: exit 0 los tres, >= 471 tests en verde

# 2 — la migración corrió y es idempotente
npm run db:migrate && npm run db:migrate
# esperado: la segunda vez, "Nada nuevo que aplicar", exit 0

# 3 — los productos existentes siguen siendo cobrables
psql "$DATABASE_URL" -c "
  select pg.slug, pp.precio, pp.whop_plan_id
  from paginas pg join producto_planes pp on pp.id = pg.producto_plan_id
  order by pg.slug;"
# esperado: los mismos slugs/precios/plan_id que tenían ANTES de la migración
# (compará contra lo que guardaste antes de correr T01)

# 4 — el caso real del usuario está resuelto
#     (si tenés en tu base local dos planes del mismo whop_product_id, o armá
#     el caso sintético del plan): entrá a /admin/productos y confirmá que
#     aparecen como UN producto con sus variantes, no como dos productos

# 5 — el nav no tiene "Links", y /admin/paginas da 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3020/admin/paginas
# esperado: 404 (o redirect al login si no hay sesión — no 200 con una tabla)

# 6 — un funnel nuevo exige producto + gracias antes de agregar el segundo paso
#     (a mano en el browser: /admin/funnels/nuevo)

# 7 — ningún snippet cae al placeholder sin resolver
#     (a mano en el browser: activar rechazo en un paso sin asignarle destino,
#     confirmar que el snippet no se ofrece como copiable)

# 8 — endpoints nuevos rechazan sin credencial
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3020/api/admin/productos/x/planes
# esperado: 401 sin cookie de sesión

# 9 — leé §10 del plan: quedaron preguntas abiertas (P-01, P-02, P-03) que no
#     bloquean pero conviene que el usuario las vea antes de dar el módulo por
#     cerrado del todo
```

Si el punto 3 no da los mismos precios/slugs que antes de migrar, **no sigas**: es el criterio que
decide si la migración de datos reales fue segura. Todo lo demás es reversible con más trabajo; una
migración de datos que corrió mal sobre producción no lo es igual de barato.
