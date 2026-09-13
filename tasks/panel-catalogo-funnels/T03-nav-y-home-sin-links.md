# T03 — el nav sin "Links", y un Home nuevo para el panel

> **Antes de leer una línea más:** leé `00-README-LEER-PRIMERO.md` de esta misma carpeta. La carpeta
> hermana `tasks/checkout-whop/` es solo referencia histórica — no la sigas.

- **Depende de:** T01 (solo indirectamente — este task no importa nada nuevo de `lib/tipos.ts` para
  el resumen del Home, pero necesita que la tabla `producto_planes` ya exista para contar productos
  activos correctamente si decide contarlos a nivel de variante)
- **Bloquea:** nada
- **Se puede correr en paralelo con:** T02, T04, T05
- **Repo:** `checkout-kashhhpay`
- **Archivos que este task puede tocar:** `components/panel/NavPanel.tsx`,
  `app/admin/(panel)/page.tsx`, y el **borrado** de `app/admin/(panel)/paginas/**` +
  `app/api/admin/paginas/**`. Nada más.

Leé `00-PLAN-PANEL-CATALOGO-FUNNELS.md` completo. Tu sección es §0 punto 3 y P-01 de §10.

---

## 1. Objetivo

Cuando termines:

- El nav (`NavPanel.tsx`) no tiene el ítem `{ href: '/admin', label: 'Links', ... }`.
- `/admin` (el Home) ya no lista páginas de pago — pasa a ser un resumen mínimo (ver §2).
- `app/admin/(panel)/paginas/` (la carpeta completa: `page.tsx` si existiera, `[id]/page.tsx`,
  `nuevo/page.tsx`, `FormularioPagina.tsx`) y `app/api/admin/paginas/` (`route.ts`, `[id]/route.ts`)
  **se borran**.

**Este task no reimplementa la edición de slug/link que hacía `FormularioPagina.tsx` — esa función se
muda a la ficha de producto de T02. Si T02 todavía no la tiene lista cuando vos borrás estos archivos,
es una carrera de timing esperada entre tasks de la misma ola: avisalo en el progreso, no dejes de
borrar por eso — T02 tiene la instrucción de reusar el mismo endpoint de API, así que el `route.ts`
de la API en teoría podría no borrarse todavía. Leé la nota del punto 3 antes de decidir.**

## 2. El nuevo Home — resumen mínimo, no el dashboard de ventas

P-01 del plan (§10) deja esto como no bloqueante con un default: implementá un resumen simple, sin
tabla de links, con:

- Conteo de productos activos / total (via `listarProductosConPlanes()` de T01 si ya está, o
  `listarProductos()` si preferís no esperar — pero fijate que si T01 ya migró el esquema,
  `listarProductos()` puede haber cambiado de forma; usá lo que exista en `lib/admin/productos.ts` al
  momento en que corras esto).
- Conteo de funnels activos / total (`listarFunnelsConPasos()` ya existe, no lo tocás).
- Accesos rápidos: links a `/admin/productos`, `/admin/funnels`, `/admin/catalogo` — como tarjetas
  clicables, no como texto plano.

**No construyas nada de métricas de ventas, gráficos, ni conteos de cobros.** El usuario confirmó
explícitamente que eso es "el dashboard" y va en otro módulo, más adelante.

## 3. Borrar `app/admin/(panel)/paginas/**` y `app/api/admin/paginas/**`

Antes de borrar, leé qué importa esos archivos con un `grep` (o el equivalente de tu herramienta) por
`admin/paginas` y `from.*paginas/FormularioPagina` en todo el repo — el plan ya hizo ese grep al
escribirse y encontró que `components/panel/NavPanel.tsx` referencia `/admin/paginas` en su lógica de
`estaActivo` (la función que decide qué ítem del nav se marca como activo). Vas a tocar ese archivo
igual (es tuyo), así que esa referencia se va con el cambio del punto 1.

Sobre `app/api/admin/paginas/[id]/route.ts` puntualmente: **T02 lo sigue llamando** desde la ficha de
producto (ver su task, §4). Dos opciones, elegí la que te resulte más simple de verificar:

- (a) Dejás viva solo esa ruta de API (`app/api/admin/paginas/[id]/route.ts`, el `PATCH`) y borrás
  todo el resto (`app/api/admin/paginas/route.ts` el listado, y toda la carpeta de pantallas de
  `app/admin/(panel)/paginas/`). Es la opción más simple: un endpoint de API no es "una sección del
  panel", así que dejarlo vivo no contradice "Links desaparece del nav".
- (b) Movés ese `PATCH` a una ruta nueva bajo `/api/admin/productos/[id]/planes/[planId]/link` y
  borrás toda la carpeta `app/api/admin/paginas/` entera — más prolijo, pero te obliga a coordinar el
  nombre exacto con lo que T02 espera.

**Preferí (a).** Es reversible, no depende de que adivines bien el contrato de T02, y cumple el
criterio de aceptación 5 del plan ("el nav no tiene el ítem Links, `/admin/paginas` [las pantallas] ya
no existen") sin ambigüedad.

## 4. Verificación

```bash
# 1 — build
npx tsc --noEmit && npx next build
# esperado: exit 0. Si next build falla porque algo todavía importa un archivo
# que borraste, es una señal de que faltó un grep — no comentes el import,
# encontrá quién lo usa y decidí si ese archivo también es tuyo o es de otra
# task (en cuyo caso, avisá en vez de tocarlo)

# 2 — nada roto
npx vitest --run
# esperado: la línea de base (471 tests) sigue en verde. Si `lib/admin/paginas.test.ts`
# (que SÍ es de T01, no tuyo) falla, no es tu bug — pero revisá que no sea
# consecuencia de que borraste algo que ese test necesitaba indirectamente

# 3 — en el browser
#   a. el nav no muestra "Links" en ninguna resolución (desktop y la fila con
#      scroll de mobile)
#   b. /admin muestra el resumen nuevo, no una tabla de links
#   c. /admin/paginas y /admin/paginas/nuevo dan 404
#   d. GET /api/admin/paginas (el listado viejo) da 404, PATCH /api/admin/paginas/[id]
#      sigue respondiendo (si elegiste la opción (a) del punto 3)
```

## 5. Cuándo parar

**Bloqueante, pará y avisá:**
- Ninguno esperado — este task es principalmente borrado y una pantalla nueva chica.

**Anotalo en §10 del plan y seguí:**
- Si encontrás que algo más del panel (que no esté en tu lista de archivos) importa
  `FormularioPagina.tsx` o alguna función de `app/admin/(panel)/paginas/` — no lo edites, anotalo con
  el archivo exacto que lo referencia.
