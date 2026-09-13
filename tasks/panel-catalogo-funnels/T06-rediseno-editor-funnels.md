# T06 — rediseño visual del editor de funnels

> **Antes de leer una línea más:** leé `00-README-LEER-PRIMERO.md` de esta misma carpeta. La carpeta
> hermana `tasks/checkout-whop/` es solo referencia histórica — no la sigas.

- **Depende de:** T03, T04, T05 (las tres deben estar verificadas — este task es visual sobre la
  MISMA lógica que ellas dejaron)
- **Bloquea:** nada, es la última
- **Se puede correr en paralelo con:** nada. **Corre sola, y solo después de que T03+T04+T05 pasen su
  propia verificación.**
- **Repo:** `checkout-kashhhpay`
- **Archivos que este task puede tocar:** `app/admin/(panel)/funnels/EditorFunnel.tsx` (estructura y
  estilos, no lógica de datos), `components/panel/ui.tsx` si necesitás un primitivo visual nuevo y
  reusable. Nada más.

Leé `00-PLAN-PANEL-CATALOGO-FUNNELS.md` completo, y particularmente D7 (§1) sobre qué problema visual
estás resolviendo. Este es un task de diseño de interfaz, no de lógica de producto — usá la skill de
diseño que corresponda (`minimalist-ui` para un ajuste editorial dentro del sistema visual que ya
tiene el panel, o `design-taste-frontend` si al hacer tu propio audit encontrás que la pantalla entera
necesita un replanteo más de fondo). Decidí cuál corresponde DESPUÉS de mirar el estado real de la
pantalla con T03+T04+T05 ya aplicadas, no antes.

---

## 1. Objetivo

Cuando termines:

- La pantalla del editor de funnels (`/admin/funnels/[id]` y `/admin/funnels/nuevo`) se ve a la altura
  del resto del panel (que ya tiene un sistema visual propio en `components/panel/ui.tsx` — no
  introduzcas un lenguaje visual nuevo, extendé el que existe).
- **El problema de D7 está resuelto**: cuando un paso tiene "Rechazó el upsell → página de gracias" y
  el botón "+ downsell" al lado, la interfaz ya no se lee como si fueran dos destinos simultáneos. Un
  posible enfoque (no obligatorio, es tu criterio de diseño): que "+ downsell" se lea más claramente
  como "crear el paso al que quiero que esta rama apunte" en vez de un tercer camino — por ejemplo,
  integrándolo dentro del mismo control que abre `SelectorDestino`, en vez de como un botón
  hermano separado.
- El flujo guiado de creación que agregó T04 (producto principal + página de gracias obligatorios) se
  ve como parte natural de la misma pantalla, no como un formulario pegado encima con otro estilo.

**Este task no cambia ningún comportamiento que T03, T04 o T05 ya definieron.** Si al rediseñar notás
que algo del comportamiento (no solo el estilo) tendría más sentido distinto, anotalo en §10 — no lo
cambies en el mismo commit que el rediseño visual, porque hace imposible distinguir después si un bug
nuevo es de la lógica o del estilo.

## 2. Antes de tocar nada: audit

**`EditorFunnel.tsx` es una excepción documentada de ownership (§7 del plan): reemplazás a T05 como
dueño de este archivo.** Buscá el comentario que T05 dejó marcando su fragmento (algo como
`// [T05, cierra la lógica — T06 rediseña visualmente después]`) — es la confirmación de que la lógica
de esa task ya está asentada y podés trabajar sobre ella con confianza.

Mirá la pantalla real (`npm run dev`, con al menos un funnel de varios pasos ya armado — usá los datos
de seed que dejaron las tasks anteriores o armá uno de prueba) y respondé, para vos, antes de escribir
CSS:

1. ¿Qué es lo primero que se lee mal? (probablemente D7: las dos ramas del rechazo)
2. ¿Qué patrón visual ya existe en el resto del panel que esta pantalla no está usando? (mirá
   `/admin/productos`, `/admin/catalogo`, `/admin/alertas` para el lenguaje de tarjetas, badges,
   espaciados)
3. ¿El "lienzo punteado" (el fondo con textura que ya tiene `EditorFunnel.tsx`, mencionado en su
   comentario de cabecera) sigue teniendo sentido con el flujo guiado nuevo de T04 encima, o compite
   con él?

## 3. Qué no se toca

- Ningún string de `lib/admin/integracion.ts` ni `lib/admin/funnels.ts` — cero lógica.
- La estructura de datos que arma `SnippetDelPaso` — podés cambiar CÓMO se presenta (colores,
  espaciado, jerarquía tipográfica del bloque de código), no qué contiene.
- El comportamiento del wizard de T04 — podés cambiar su presentación visual, no su flujo (qué paso
  viene después de cuál).

## 4. Verificación

```bash
# 1 — build
npx tsc --noEmit && npx next build
# esperado: exit 0

# 2 — nada de comportamiento roto
npx vitest --run
# esperado: línea de base (471 tests + los agregados por T01/T05) sigue en verde
# — un cambio puramente visual no debería tocar NINGÚN test; si algo rompe,
# revisá si te desviaste de "solo estilo"

# 3 — en el browser, comparando antes/después
#   a. capturá cómo se ve HOY (antes de tu cambio) la sección de ramas de un
#      paso con rechazo activado
#   b. después de tu cambio, confirmá que "Rechazó el upsell → X" y el botón
#      de crear un downsell nuevo ya no se leen como dos rutas simultáneas
#   c. el resto de las interacciones (abrir SelectorDestino, copiar un
#      snippet, agregar un paso) sigue funcionando exactamente igual, solo
#      que con otro aspecto
```

## 5. Cuándo parar

**Bloqueante, pará y avisá:**
- Ninguno esperado — es un task de estilo puro.

**Anotalo en §10 del plan y seguí:**
- Cualquier cambio de comportamiento (no de estilo) que te parezca que mejoraría la claridad de D7 más
  allá de lo visual — descontinuación de "+ downsell" como control separado y su fusión con
  `SelectorDestino`, por ejemplo. Anotalo como propuesta, no lo implementes en este task.
