# T06 — Reemplazar los botones de KashPay por los del checkout propio en `testfunnel`

- **Depende de:** T02, T03 y T04, **verificadas en sandbox**. No arranca antes.
- **Bloquea:** nada.
- **Se puede correr en paralelo con:** nada. **Corre sola.**
- **Repo:** `~/Desktop/funnel/testfunnel` — **OTRO REPO.**
- **Archivos que este task puede tocar:** `components/upsell/HilvanaUpsellButton.tsx`,
  `lib/hilvana.ts`, `lib/hilvana.test.ts`, el `<script>` en `app/layout.tsx`, y el botón en
  `app/upsell-latam/page.tsx`, `app/upsell2-latam/page.tsx`, `app/upsell3-latam/page.tsx` (o en el
  componente que lo renderice). Nada más.

Leé `00-PLAN-CHECKOUT-WHOP.md` completo, y en especial el **§6** (el contrato del `loader.js`) y el
**§8** (qué de este repo es intocable y por qué).

**No hay tráfico corriendo en este funnel**, así que el reemplazo es directo: no hay interruptor de
pasarela y no hay convivencia. La vuelta atrás es un `git revert` de tu commit, y el criterio 8 del
plan exige que esté probada. **El freno de emergencia real no vive acá:** está en el panel del
checkout, apagando `paginas.activo`, que corta el cobro al instante sin redeploy.

Lo que sí sigue siendo intocable es **el copy**: es texto final aprobado, con voseo en el upsell 3 y
tuteo en los otros dos a propósito, y los precios salen de `lib/quiz-v2/config-latam.ts`.

---

## 1. Objetivo

Cuando termines:

- Existe `<HilvanaUpsellButton>`, que cobra contra `pay.hilvanapp.com` con un click.
- El `loader.js` del checkout se carga desde el `<head>` de `app/layout.tsx`.
- Las tres páginas de upsell usan el botón nuevo.
- `KashPayUpsell3Button.tsx` queda en el repo **sin importarse** (no se borra: es la referencia de cómo
  funcionaba el cobro anterior).
- El copy, los precios y el tracking de las tres páginas quedan **idénticos**.
- `git revert` de tu commit deja el repo como estaba y el build sigue pasando.

**Este task no cambia ningún copy, ningún precio, ningún evento de tracking, ni el layout de las
páginas. Solo el botón.**

## 2. Antes de escribir: leé estos tres archivos completos

1. **`components/upsell/KashPayUpsell3Button.tsx`** — es el modelo, y su comentario de cabecera dice
   explícitamente lo que hay que respetar: el comportamiento **no es del funnel**, el `onClick` solo
   llama a una global del script, y el botón no lleva tracking ni redirect propio. **Tu componente
   respeta el mismo contrato.** Fijate también en el aviso de que las tres URLs son distintas y que
   copiar una sobre otra cobra el producto equivocado sin ningún error visible: el mismo riesgo existe
   con los slugs.
2. **`app/upsell3-latam/page.tsx`** — para ver cómo se usa el botón y de dónde salen los precios
   (`PRICING_LATAM`). Ese archivo dice, en su comentario, que el paso siguiente lo decide KashPay:
   ahora lo decide el panel (`paginas.url_exito`). **Actualizá ese comentario** — es la única
   modificación de prosa permitida, porque dejarlo diciendo algo falso es peor que cambiarlo.
3. **`app/layout.tsx`** — donde vive el script de KashPay.

Lo que **no** copiar de `KashPayUpsell3Button`: la URL de KashPay y el atributo `data-upsell-url`. Ese
atributo existe porque el script de KashPay escanea el DOM buscando su propio patrón; el nuestro usa
`data-hilvana-upsell` con el slug.

## 3. `lib/hilvana.ts` — los slugs y la base

```ts
/** El origen del checkout. De env, para poder apuntar a localhost:3010 en desarrollo. */
export const CHECKOUT_URL: string;

/**
 * El slug del link de pago de cada upsell. Tienen que coincidir EXACTAMENTE con
 * `paginas.slug` del panel del checkout.
 *
 * Son constantes en código y no props, por la misma razón que las tres URLs de
 * KashPay están hardcodeadas en tres componentes distintos: si cada página
 * pasara el suyo, un copy/paste entre páginas cobra el producto equivocado y no
 * hay ningún error visible que lo delate. El precio del upsell 2 saldría del
 * plan del upsell 1 y la venta se registraría bien, con el importe mal.
 */
export const SLUGS_UPSELL: Record<1 | 2 | 3, string>;
```

Reglas:

1. **`CHECKOUT_URL` con `NEXT_PUBLIC_`**, porque lo lee un componente cliente. Eso significa que queda
   en el bundle y es público: no le pongas nada sensible. Default `https://pay.hilvanapp.com` si el env
   no está.
2. **Los tres slugs son distintos y el test lo verifica.** Un test de tres líneas que exige
   `new Set(Object.values(SLUGS_UPSELL)).size === 3` atrapa el copy/paste, que es el error que este
   archivo existe para prevenir.

## 4. `components/upsell/HilvanaUpsellButton.tsx`

```tsx
/**
 * Botón de compra de un upsell contra el checkout propio.
 *
 * Mismo contrato que el KashPayUpsell3Button que reemplaza: el comportamiento NO
 * es del funnel. El onClick llama a la global del loader y nada más — sin
 * tracking, sin redirect propio, sin decidir el paso siguiente. Eso lo decide el
 * panel del checkout (`paginas.url_exito`).
 */
export function HilvanaUpsellButton({ slug, label }: { slug: string; label: string }): JSX.Element;
```

Reglas:

1. **Mismo verde y mismas clases que el botón de KashPay.** El copy de las páginas dice "hacé clic en
   el botón verde de abajo". Si cambia el color, el copy miente. Copiá el `style` del degradado y las
   clases de Tailwind tal cual, incluida la animación `animate-bounce-cta`.
2. **`data-hilvana-upsell={slug}` en el elemento, además del `onClick`.** El atributo es el camino que
   el loader engancha solo; el `onClick` es para que funcione igual si el script cargó después del
   render de React. Los dos caminos están protegidos contra el doble disparo por el propio loader, así
   que no agregues un flag tuyo: dos flags se desincronizan.
3. **Si `window.hilvana` no existe (el script no cargó), el botón no puede tirar.** Usá el mismo `?.`
   que ya usa el botón de KashPay.
4. **Mantené el `focus-visible:ring`** del botón original. Es lo que hace que se pueda comprar con
   teclado.

## 5. El script en `app/layout.tsx`

Agregá:

```tsx
<script async defer src={`${CHECKOUT_URL}/loader.js`} />
```

El de KashPay **se puede sacar** en el mismo commit, ya que ningún botón lo usa más. Si lo sacás,
verificá que ninguna otra página del repo dependa de sus globales:

```bash
grep -rn 'acceptUpsell\|declineUpsell\|data-upsell-url' --include='*.tsx' --include='*.ts' .
# esperado después de tu cambio: solo KashPayUpsell3Button.tsx, que queda sin importarse
```

Si aparece en algún otro lugar, **dejá el script de KashPay** y anotalo en §10.

## 6. El reemplazo en las páginas

En cada una de las tres, cambiar el componente del botón y nada más:

```tsx
<HilvanaUpsellButton slug={SLUGS_UPSELL[3]} label={LABEL} />
```

Si la página renderiza el botón desde `VslOfferBlockLatam` o `Upsell2VslOfferBlockLatam`, el cambio va
ahí adentro con el mismo alcance: **solo el botón**. Esos componentes tienen copy y tracking que no se
toca.

## 7. Verificación

```bash
cd ~/Desktop/funnel/testfunnel

# 1 — LA MEDICIÓN DE ANTES. Corré esto PRIMERO y guardá la salida.
git rev-parse HEAD > /tmp/antes-t06.txt
npm test 2>&1 | tail -5 >> /tmp/antes-t06.txt
cat /tmp/antes-t06.txt

npx tsc --noEmit && npm run build && npm test
# esperado: exit 0, build ok, todos los tests passed

# 2 — los tres slugs son distintos
npx vitest --run lib/hilvana.test.ts
# esperado: pasa el caso de los tres slugs únicos

# 3 — EL COPY NO CAMBIÓ. Es el criterio que decide si este task pasó.
git diff lib/quiz-v2/config-latam.ts
# esperado exactamente: sin salida
git diff --stat components/upsell/VslOfferBlockLatam.tsx components/upsell/Upsell2VslOfferBlockLatam.tsx
# esperado: sin salida, O solo la línea del botón si el botón se renderiza ahí
git diff app/upsell-latam/page.tsx app/upsell2-latam/page.tsx app/upsell3-latam/page.tsx
# esperado: SOLO la línea del botón y el comentario de KashPay actualizado.
# Cualquier línea de copy cambiada: revertila.
npx vitest --run lib/quiz-v2/garantia-latam.test.ts
# esperado: passed — es el test que verifica el copy de la garantía

# 4 — no quedaron referencias colgadas a las globales de KashPay
grep -rn 'acceptUpsell\|declineUpsell' --include='*.tsx' --include='*.ts' .
# esperado: solo KashPayUpsell3Button.tsx (que ya no se importa)
grep -rn 'KashPayUpsell3Button' --include='*.tsx' app/
# esperado exactamente: sin salida   ← ninguna página lo importa más

# 5 — LA VUELTA ATRÁS ESTÁ PROBADA (criterio 8 del plan)
git add -A && git commit -m "T06: checkout propio en los upsells"
git revert --no-edit HEAD
npx tsc --noEmit && npm run build && npm test
# esperado: exit 0, build ok, tests passed  ← el revert deja el repo sano
git revert --no-edit HEAD     # deshacer el revert y volver a tu cambio
npx tsc --noEmit && npm run build
# esperado: exit 0

# 6 — EN EL BROWSER, con el checkout en SANDBOX. Esto no lo cubre ningún comando:
#  - el circuito completo: comprar el front en /pagos/aguadearroz1, caer en
#    /upsell-latam?ot=..., tocar el botón, que cobre SIN pedir datos, y que
#    redirija al upsell 2, y así hasta el 3
#  - cinco clicks rápidos en el botón: UN solo cobro en el dashboard de Whop
#  - volver atrás con el botón del navegador y tocar de nuevo: no vuelve a cobrar
#  - recargar la página del upsell después de comprarlo: no vuelve a cobrar
#  - entrar a /upsell-latam SIN ?ot= : el botón no tira error en consola
#  - comprar el upsell con el teclado solamente (Tab hasta el botón, Enter)
#  - el botón es del mismo verde que antes (comparalo con una captura)

# 7 — el freno de emergencia
#  - con el checkout activo, apagá la página desde el panel (activo = false)
#  - tocá el botón del upsell: responde 404 y NO cobra, sin ningún redeploy
```

## 8. Cuándo parar

**Bloqueante, pará y avisá:**

- **El copy de una página de upsell cambió**, aunque sea un espacio. Es texto final aprobado.
- **`git diff lib/quiz-v2/config-latam.ts` muestra algo.** Ahí viven los precios.
- **`garantia-latam.test.ts` falla.** Rompiste el copy de la garantía.
- **El `git revert` deja el repo sin buildear.** La vuelta atrás es la única red que tiene este task
  ahora que no hay interruptor: si no funciona, no lo dejes así.
- **Cinco clicks produjeron más de un cobro.** Es un bug de T04, no tuyo: avisá y **no lo parchees
  desde el funnel**. Un parche del lado del cliente da la sensación de estar arreglado y falla igual
  con la red lenta.

**Anotalo en §10 del plan y seguí:**

- Si alguna otra página del repo usa las globales de KashPay (entonces el script se queda).
- Si el botón de una página se renderiza desde un componente que no está en tu lista: anotá cuál antes
  de tocarlo.
- Los `decline_code` reales que devolvió sandbox y qué hizo el fallback con cada uno.
- **Necesitás modificar un archivo ajeno** → nunca. Anotalo.
