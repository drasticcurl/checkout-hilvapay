# T02 — El panel: login, productos asociados a Whop, links de pago y orígenes autorizados

- **Depende de:** T01 (`lib/tipos.ts` y `lib/auth.ts`).
- **Bloquea:** T06 (sin panel no hay link de pago que probar). No bloquea a T03/T04/T05.
- **Se puede correr en paralelo con:** T03, T04, T05.
- **Repo:** `~/Desktop/funnel/checkout/checkout-kashhhpay`
- **Archivos que este task puede tocar:** `middleware.ts`, `app/admin/**`, `app/api/admin/**`,
  `lib/admin/*.ts` y sus `.test.ts`, `scripts/seed.ts`. Nada más.

Leé `00-PLAN-CHECKOUT-WHOP.md` completo. Tus contratos son el §4 (`lib/tipos.ts`) y la sección 3 de
`T01-cimientos.md` (`lib/auth.ts`). **No los modifiques**: T03, T04 y T05 se están escribiendo contra
lo mismo al mismo tiempo.

---

## 1. Objetivo

Cuando termines, con el server corriendo en `localhost:3010`:

- `/admin` pide contraseña y no muestra nada sin ella.
- Se puede dar de alta un producto eligiendo un plan de Whop, con el nombre real y el precio de
  display propios, y el panel **avisa si el precio no coincide con el `initial_price` del plan**.
- Se puede crear un link de pago (`/pagos/<slug>`) apuntando a un producto, con su timer, su texto de
  botón, su `url_exito` y su `url_rechazo`.
- Se puede autorizar el dominio de un funnel para que pueda disparar cobros.
- Hay una lista de solo lectura de los últimos cobros, con su estado y su `whop_payment_id`, para
  poder diagnosticar una venta puntual.
- Todo lo que se crea nace **inactivo**.

**Este task no escribe la página de checkout, ni el cobro, ni el loader, ni el cron.** No toques
`app/pagos/**`, `app/api/checkout/**`, `app/api/upsell/**`, `app/api/cobros/**`, `app/api/cron/**`.

## 2. `middleware.ts`

**Leé `~/Desktop/funnel/dashboard-admin/middleware.ts`.** Copiá la estructura de matcher y la
verificación con `crypto.subtle`. Lo que **no** copiar: su larga lista de rutas y su lógica de
usuarios — acá hay un solo usuario.

Qué protege y qué no:

| Ruta | Protegida |
|---|---|
| `/admin/**` | sí, salvo `/admin/login` |
| `/api/admin/**` | sí, salvo `/api/admin/login` |
| `/pagos/**`, `/api/checkout/**`, `/api/upsell/**`, `/api/cobros/**` | **NO.** Son públicas por diseño: las usan compradores anónimos |
| `/api/webhooks/whop` | **NO.** Se autentica con la firma HMAC, no con la cookie |
| `/api/cron/**` | **NO.** Se autentica con `CRON_SECRET` |

**Esto es lo más fácil de romper de todo el task:** si el matcher agarra `/api/webhooks/whop`, Whop
recibe 307 en vez de 200, reintenta, y a las 72 horas deshabilita el webhook. Escribí el matcher
como una lista explícita de lo que SÍ se protege, nunca como "todo menos".

`/api/admin/**` devuelve **401 con JSON**, no un redirect: es un `fetch` de una pantalla, y un 307 a
un HTML de login hace que el `.json()` del cliente falle con un error que no menciona la sesión.

## 3. `lib/admin/` — las queries

Un archivo por entidad (`productos.ts`, `paginas.ts`, `origenes.ts`, `cobros.ts`). Usá `q`/`q1` de
`lib/db.ts` con parámetros `$1` — **nunca interpolación de strings**.

Las firmas que importan:

```ts
/**
 * Trae los planes de Whop para el selector. Devuelve `[]` y loguea si la API
 * falla: el panel tiene que dejar pegar el plan_id a mano igual.
 *
 * Un selector que no carga no puede ser el único camino para asociar un
 * producto — el path de `GET /plans` está marcado como no verificado en
 * `lib/whop.ts` (P-01/P-09 del plan).
 */
export async function planesDisponibles(): Promise<{ planes: PlanWhop[]; error: string | null }>;

/**
 * Compara el precio de display con el precio real del plan de Whop.
 *
 * Devuelve `null` si no se pudo consultar el plan (NO `{ coincide: true }`: un
 * "todo bien" falso acá es cómo se publica un link que dice $9.90 y cobra $17).
 */
export async function verificarPrecio(
  planId: string,
  precioMostrado: string,
): Promise<{ coincide: boolean; precioReal: string; moneda: string } | null>;

/** Alta de producto. `activo` se ignora si viene: siempre nace en false (D14). */
export async function crearProducto(datos: EntradaProducto): Promise<Producto>;

/** Últimos N cobros con la orden, la página y el producto resueltos. Solo lectura. */
export async function ultimosCobros(limite: number): Promise<FilaCobroPanel[]>;
```

Reglas:

1. **`verificarPrecio` compara con tolerancia cero, sobre strings normalizados**, no con `==` de
   floats. `9.90` y `9.9` son el mismo precio y `9.90` y `9.09` no. Comparar
   `Number(a).toFixed(2) === Number(b).toFixed(2)` alcanza y es explícito.
2. **La comparación no bloquea el guardado.** Es un aviso visible, no un `throw`: puede haber un caso
   legítimo (un promo code) y un panel que no te deja guardar es un panel que se esquiva editando la
   base a mano.
3. **`slug` se normaliza al guardar**: minúsculas, solo `a-z0-9-`, sin espacios. Un slug con una
   mayúscula o un espacio genera un link que falla con 404 y nadie entiende por qué.
4. Escribí `lib/admin/paginas.test.ts` con los casos de normalización de slug: `'Agua De Arroz 1'` →
   `'agua-de-arroz-1'`, `'  UPSELL_2  '` → `'upsell-2'`, `'áéí'` → decidí y documentá qué hace (no lo
   dejes al azar del navegador).
5. **`EntradaProducto` y `FilaCobroPanel` los declarás vos, dentro de `lib/admin/`.** No los agregues a
   `lib/tipos.ts`: ese archivo es de T01 y lo importan otras tres tasks al mismo tiempo. Solo va ahí lo
   que cruza fronteras entre tasks, y estos dos no cruzan ninguna.

## 4. Las pantallas — `app/admin/**`

Server components que leen la base, con islas cliente solo para los formularios. Es el patrón de
`dashboard-admin`; leé una de sus pantallas de `app/(panel)/` antes de arrancar para copiar el estilo
de layout y de tabla.

| Ruta | Qué muestra |
|---|---|
| `/admin/login` | Un input de password. Nada más, ni logo ni links. |
| `/admin` | Los links de pago, con su slug, producto, precio, estado y un switch de activo. Es la pantalla de inicio porque es lo que se mira todos los días. |
| `/admin/productos` | Alta y edición. El selector de plan de Whop con el fallback manual, y **el aviso de precio de D10 bien visible, no en un tooltip**. |
| `/admin/paginas/[id]` | Edición del link: producto, tipo, `url_exito`, `url_rechazo`, y los campos de `ConfigPagina`. |
| `/admin/origenes` | La allowlist de dominios. Con una nota en pantalla explicando que sin esto el botón del funnel da 403. |
| `/admin/cobros` | Solo lectura, los últimos 100. Estado, monto, `decline_code`, `whop_payment_id`. |

Reglas de UI:

1. **Cada link de pago se muestra con su URL completa y un botón de copiar.** Es lo que el usuario va
   a pegar en el funnel: si tiene que armarla a mano, la va a escribir mal alguna vez.
2. **El switch de activo pide confirmación al ENCENDER, no al apagar.** Apagar siempre es seguro;
   encender es lo que empieza a cobrar.
3. **Un valor que no se puede calcular se muestra con un guion, no con un cero.** Un cobro sin monto
   todavía no es un cobro de $0.
4. **Los formularios funcionan con teclado y los inputs tienen `<label>` asociado.** No uses
   `placeholder` como única etiqueta: un lector de pantalla no lo anuncia como nombre del campo.

## 5. `scripts/seed.ts`

Un seed idempotente (`ON CONFLICT DO NOTHING` por slug) con los cuatro productos y sus cuatro links,
para no tener que cargarlos a mano en cada base nueva. Precios: el front es **$9.90** y el upsell 3
es **$17** (P-06 del plan; los otros dos están abiertos, dejalos en `0.00` con un comentario que
diga que hay que cargarlos desde el panel). `plan_id` de sandbox: si no los tenés, usá
`'plan_PENDIENTE_<nivel>'` — el panel los va a mostrar como no verificables y está bien.

Todo nace **inactivo**.

## 6. Verificación

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay
npm run dev &     # puerto 3010

# 1 — tipos, build, tests
npx tsc --noEmit && npx next build && npx vitest --run
# esperado: exit 0, "✓ Compiled successfully", todos los tests passed

# 2 — el panel no se abre sin cookie
curl -s -o /dev/null -w '%{http_code}\n' localhost:3010/admin
# esperado exactamente: 307   (redirect al login)
curl -s -w '\n%{http_code}\n' localhost:3010/api/admin/productos
# esperado exactamente: {"error":"unauthorized"} y 401  (JSON, NO un 307)

# 3 — LO MÁS IMPORTANTE: el webhook y las rutas públicas NO quedaron protegidos
curl -s -o /dev/null -w 'webhook: %{http_code}\n' -X POST localhost:3010/api/webhooks/whop -d '{}'
# esperado exactamente: 400   (firma inválida, que es el rechazo correcto)
# Si da 307 el matcher del middleware está mal y Whop va a deshabilitar el webhook.

# 4 — el login funciona y deja la cookie
curl -s -c /tmp/ck.txt -X POST localhost:3010/api/admin/login \
     -H 'Content-Type: application/json' -d "{\"password\":\"$PANEL_PASSWORD\"}" -w '\n%{http_code}\n'
# esperado: 200
grep -c checkout_panel /tmp/ck.txt      # esperado exactamente: 1
curl -s -b /tmp/ck.txt -o /dev/null -w '%{http_code}\n' localhost:3010/admin
# esperado exactamente: 200

# 5 — el password equivocado no entra
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3010/api/admin/login \
     -H 'Content-Type: application/json' -d '{"password":"mal"}'
# esperado exactamente: 401

# 6 — el seed y el estado apagado
npm run db:seed
npm run db:seed                          # dos veces: la segunda no duplica
psql "$DATABASE_URL" -tAc "select count(*) from paginas;"
# esperado exactamente: 4
psql "$DATABASE_URL" -tAc "select count(*) from paginas where activo;"
# esperado exactamente: 0     ← D14: nace apagado
psql "$DATABASE_URL" -tAc "select slug from paginas order by slug;"
# esperado: 4 slugs, todos en minúsculas y sin espacios

# 7 — el aviso de precio funciona de verdad
# Cargá un producto con un plan_id real de sandbox y un precio deliberadamente
# equivocado (por ejemplo 1.00 cuando el plan cobra 9.90).
# esperado en pantalla: el aviso visible de que no coinciden, y que el guardado
# se completa igual.

# 8 — NO rompiste lo que ya estaba
git diff --stat lib/estado-pago.ts lib/whop-webhook.ts lib/whop.ts lib/db.ts lib/cobros.ts \
                lib/tipos.ts app/api/webhooks/whop/route.ts db/migrations/001_init.sql
# esperado exactamente: sin salida

# 9 — en el browser, a mano
#  - crear un producto, crear un link, copiar la URL con el botón
#  - el switch de activo pide confirmación al encender y no al apagar
#  - navegar los formularios SOLO con teclado (Tab, Enter): se puede completar y guardar
```

## 7. Cuándo parar

**Bloqueante, pará y avisá:**

- El middleware protege `/api/webhooks/whop` o `/pagos/**` y no encontrás cómo excluirlos. Es
  preferible un panel sin terminar a un webhook que Whop va a deshabilitar.
- `lib/auth.ts` de T01 no existe o no exporta lo que dice su firma.
- No hay forma de traer los planes de Whop **ni** de pegar el `plan_id` a mano (o sea: el camino de
  fallback tampoco funciona).

**Anotalo en §10 del plan y seguí:**

- `GET /plans` no responde: implementá solo el camino manual y anotalo (es P-09).
- Los precios de los upsells 1 y 2 (P-06): dejalos en `0.00` y anotá que faltan.
- **Necesitás modificar un archivo ajeno** → nunca. Anotalo.
