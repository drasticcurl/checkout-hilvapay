# T01 — Cimientos: verificar lo construido, congelar los contratos, probar que la API de Whop responde

- **Depende de:** nada.
- **Bloquea:** T02, T03, T04 y T05. Las cuatro importan `lib/tipos.ts`.
- **Se puede correr en paralelo con:** nada. **Corre sola.**
- **Repo:** `~/Desktop/funnel/checkout/checkout-kashhhpay`
- **Archivos que este task puede tocar:** `lib/tipos.ts`, `lib/auth.ts`, `lib/cobros.ts`,
  `package.json`, `vercel.json`, `.env.example`, `README.md`. Nada más.

Leé `00-PLAN-CHECKOUT-WHOP.md` completo antes de arrancar. Tu contrato es el §4 (`lib/tipos.ts`): lo
copiás **tal cual**, no lo "mejorás" — las cuatro tasks de la ola 2 se escriben contra esa forma
exacta al mismo tiempo que vos.

**Este task es la compuerta del proyecto.** Si la sección 6 (la verificación contra la API de Whop)
no pasa, **pará y avisá**: no arranca ninguna task de la ola 2.

---

## 1. Objetivo

Cuando termines:

- `lib/tipos.ts` existe con exactamente los tipos del §4 del plan, y `lib/cobros.ts` los importa en
  vez de declararlos.
- `lib/auth.ts` existe con la sesión del panel implementada (§3 de este task).
- `vercel.json` declara el cron de `salidas` (aunque la ruta la escriba T05: que un cron apunte a una
  ruta que todavía no existe no rompe el build, y que dos agentes editen `vercel.json` sí).
- `package.json` tiene **todas** las dependencias del módulo, incluidas las que usan tasks que
  todavía no se escribieron.
- `.env.example` tiene todas las variables, con el valor de `WHOP_API_VERSION_DATE` ya **verificado
  contra la API real**.
- `README.md` explica cómo levantar el proyecto y cómo configurar Whop.
- `npx tsc --noEmit`, `npx next build` y `npx vitest --run` pasan.

**Este task no escribe ninguna ruta de API, ninguna pantalla y ningún componente.** No toques
`app/**` salvo lo que ya existe. No agregues funciones a `lib/cobros.ts` más allá de cambiar de dónde
vienen los tipos.

## 2. `lib/tipos.ts` — el contrato congelado

Copiá los cinco tipos del §4 del plan literalmente, con sus comentarios. Después:

1. **Sacá los tipos `Orden` y `Cobro` de `lib/cobros.ts` y movelos a `lib/tipos.ts`**, agregando los
   campos que hoy no están porque `lib/cobros.ts` solo selecciona lo que usa. Leé
   `db/migrations/001_init.sql` para los nombres y tipos exactos — **no los recuerdes**. Recordá que
   `numeric` sale del driver `pg` como **string** y `timestamptz` como `Date`.
2. En `lib/cobros.ts`, reemplazá las declaraciones locales por `import type { Orden, Cobro } from
   './tipos'`. **Nada más de ese archivo cambia**: las tres tasks de la ola 2 llaman a sus funciones y
   cualquier cambio de firma las rompe a las tres.
3. `EstadoCobro` **se re-exporta** desde `lib/tipos.ts` (`export type { EstadoCobro } from
   './estado-pago'`), no se redeclara. Está atado al `CHECK` de la base; dos definiciones se
   desincronizan en el primer estado nuevo.

## 3. `lib/auth.ts` — la sesión del panel

**Antes de escribir, leé `~/Desktop/funnel/dashboard-admin/middleware.ts` completo.** Qué copiar: el
formato de token `${id}.${ts}.${sig}` con HMAC-SHA256, el nombre de cookie propio, el secreto con
default (`PANEL_SESSION_SECRET || PANEL_PASSWORD`), y sobre todo **que la verificación use
`crypto.subtle` y no `node:crypto`**: el middleware corre en el runtime edge, donde `node:crypto` no
existe. Qué **no** copiar: ese archivo tiene toda la lógica de rutas exentas de un panel con muchas
secciones; acá el panel tiene una sola sección y la lista de exentas es corta.

La firma, que T02 consume:

```ts
/** Nombre de la cookie. Distinto al del dashboard-admin: son dominios distintos y sesiones distintas. */
export const COOKIE_SESION = 'checkout_panel';

/**
 * Firma un token de sesión. Formato `admin.<unix_ms>.<hmac_hex>`, donde el HMAC
 * cubre `admin.<unix_ms>`.
 *
 * El timestamp va DENTRO de lo firmado y no como campo aparte de la cookie: si
 * estuviera afuera, cualquiera podría estirarle el vencimiento a una cookie
 * vieja sin invalidar la firma.
 */
export function firmarSesion(ahora?: Date): Promise<string>;

/**
 * Verifica un token. Devuelve false ante cualquier duda: firma mala, formato
 * raro, o más viejo que `DIAS_SESION`.
 *
 * Usa `crypto.subtle`, NO `node:crypto`: la llama el middleware, que corre en
 * edge. Si usás node:crypto, el middleware tira en runtime y el panel queda
 * inaccesible con un error que no menciona crypto.
 */
export function verificarSesion(token: string | undefined, ahora?: Date): Promise<boolean>;

/**
 * Compara la contraseña del login con `PANEL_PASSWORD`, en tiempo constante.
 *
 * Con `===` el tiempo de respuesta filtra cuántos caracteres iniciales
 * acertaste, y con un password de panel expuesto a internet eso es un ataque
 * práctico.
 */
export function passwordCorrecta(intento: string): Promise<boolean>;
```

Reglas:

1. **Si `PANEL_PASSWORD` no está configurada, `passwordCorrecta` devuelve `false` siempre.** Nunca
   `true`: un panel sin password configurada que deja entrar a cualquiera es peor que uno que no deja
   entrar a nadie.
2. `DIAS_SESION = 30`, exportado. T02 lo usa para el `Max-Age` de la cookie.
3. Escribí `lib/auth.test.ts`. Los casos que importan: token válido pasa; token con la firma cambiada
   en un byte falla; token de hace 31 días falla; token con formato inesperado (`'basura'`, `''`,
   `undefined`) falla sin tirar excepción; sin `PANEL_PASSWORD` en el env, `passwordCorrecta('')` y
   `passwordCorrecta('cualquiera')` dan las dos `false`.

## 4. `package.json` — todas las dependencias, de una vez

Agregá **todo** lo que el módulo va a necesitar, incluido lo de tasks que no existen todavía. Ningún
otro agente edita este archivo.

| Paquete | Para qué | Versión |
|---|---|---|
| `resend` | T05, el email de entrega | La misma que resolvieron los otros funnels. Leela de `~/Desktop/funnel/testfunnel/package-lock.json` y **fijala exacta**, sin `^` |

`@whop/checkout` (0.6.0) ya está. **Fijate que sea ≥ 0.0.43**: la doc de Whop avisa que con
`hideSubmitButton` en React hacen falta esa versión o superior para que Apple Pay siga apareciendo en
el embed. 0.6.0 cumple.

Agregá también el script `"db:seed": "tsx scripts/seed.ts"` — T02 lo va a usar. Que apunte a un
archivo que todavía no existe no rompe nada.

## 5. `vercel.json` — el cron

```json
{ "crons": [{ "path": "/api/cron/salidas", "schedule": "* * * * *" }] }
```

Cada minuto. La cola casi siempre está vacía y el handler sale en una query; el costo es
despreciable frente a que una venta tarde diez minutos en aparecer en el panel.

**Ojo:** los crons de Vercel solo corren en el plan Pro. Si el proyecto está en Hobby, el cron no se
ejecuta y las `salidas` se acumulan sin que nada avise. Verificalo y, si es Hobby, **anotalo en §10**
del plan — no inventes una alternativa (un `setInterval` en una función serverless no sobrevive a la
invocación).

## 6. La API de Whop — YA VERIFICADA. Solo la re-confirmás.

Esto era P-01 y **ya está resuelto**: se verificó contra la API real el 2026-09-10 y los valores están
en `.env.local`. Tu trabajo acá es re-confirmar que sigue andando, no descubrirlo de nuevo.

Lo verificado, que **no** se vuelve a poner en duda:

| | |
|---|---|
| `WHOP_API_VERSION_DATE` | `2026-08-21-1` → 200 |
| `WHOP_API_BASE` | `https://api.whop.com/api/v1` — la key es de **producción**, en sandbox da 401 (P-11) |
| `WHOP_COMPANY_ID` | `biz_Me8Lbiv174brtM`, company "Sinvanapp" |
| Permisos | alcanzan con el rol Admin |
| `PLAN_FRONT` | `plan_hgNXAvG16M9ix` — 9.90 usd, `one_time`, atado a `prod_pRD7ZnRinvzU1` |

**TRES ENDPOINTS QUE NO SIRVEN PARA VERIFICAR NADA.** Si los usás vas a leer un falso negativo y
concluir que la compuerta está cerrada cuando no lo está:

| Endpoint | Qué devuelve de verdad |
|---|---|
| `GET /accounts/me` | **403.** Pide el scope `company:balance:read`, que **no está entre las 22 permisos**. Es el endpoint del quickstart de la doc, no sirve para una key de pagos. |
| `GET /companies/me` | **200, pero de OTRA company** (la personal del usuario). Autodetectar el `account_id` con esto hace que todo consulte la company equivocada. |
| `GET /plans` sin `account_id` | **400** `"account_id is required"`. |
| `GET /products` sin `account_id` | **200 con el catálogo público de Whop.** La trampa más fea: parece que funcionó y no son tus productos. |

La re-confirmación, con los endpoints que **sí** andan:

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay
./scripts/configurar-env.sh --solo-verificar
# esperado, textual:
#   ok    company: Sinvanapp | emails de Whop: False
#   ok    produccion + Api-Version-Date 2026-08-21-1 + /companies/biz_Me8Lbiv174brtM → 200
#   ok    GET /plans?account_id=... → 200. P-09 resuelta
#   ok    PLAN_FRONT: 9.9 usd, one_time
#   exit 0
```

Si eso da 200, la compuerta está abierta y la ola 2 puede arrancar. **No hace falta ningún curl a
mano.** Si diera 401 en los dos entornos, la key fue revocada: ahí sí, pará y avisá.

Lo único que queda abierto de los planes es **P-02**: los tres `plan_id` de los upsells no existen
todavía. No te bloquea: no sos quien los crea y ninguna task de la ola 2 los necesita para verificarse.

## 7. `README.md`

Corto y operativo. Lo que tiene que haber: cómo levantar (`npm i`, `.env.local`, `npm run
db:migrate`, `npm run dev` en el puerto 3010), la lista de los 22 permisos de la API key para
copiar y pegar, los 4 eventos a suscribir en el webhook (`payment.succeeded`, `payment.failed`,
`refund.created`, `dispute.created`) con la aclaración de que la versión es **v1** y no v2 ni v5, y
el aviso de que **`pay.hilvanapp.online` es de KashPay y no se toca**.

No repitas el plan. Un puntero a `tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md` alcanza.

## 8. Verificación

Nada de esto es opcional. "Compila" no es verificación.

```bash
cd ~/Desktop/funnel/checkout/checkout-kashhhpay

# 1 — tipos y build
npx tsc --noEmit                  # esperado: sin salida, exit 0
npx next build                    # esperado: "✓ Compiled successfully"

# 2 — los tests, incluidos los tuyos nuevos de auth
npx vitest --run
# esperado: 3 archivos, y el total >= 62 tests, todos passed
# (59 de antes: 44 de estado-pago + 15 de la firma del webhook; los de auth se suman)

# 3 — la migración es idempotente
npm run db:migrate                # esperado: "1 migración(es) aplicada(s)."
npm run db:migrate                # esperado: "Nada nuevo que aplicar."

# 4 — el esquema real quedó como dice el plan
psql "$DATABASE_URL" -tAc "select tablename from pg_tables where schemaname='public' order by 1;"
# esperado exactamente, 8 líneas:
#   _migraciones
#   cobros
#   ordenes
#   origenes
#   paginas
#   productos
#   salidas
#   whop_eventos

# 5 — las 11 afirmaciones del esquema siguen en verde
psql "$DATABASE_URL" -f tasks/checkout-whop/_verificacion-checkout.sql 2>&1 | grep -cE '\([0-9]+ rows?\)'
# esperado exactamente: 12
# (11 afirmaciones, pero la #6 devuelve dos resultados y la #11 devuelve 6 filas
#  en un solo resultado: 12 bloques de resultado en total. Ojo con grep 'row)' a
#  secas: no matchea "(6 rows)" y da 11.)
# Y LEÉ la salida completa: cada bloque tiene su valor esperado escrito arriba.

# 6 — el contrato quedó importable y sin any
grep -c ': any' lib/tipos.ts      # esperado exactamente: 0
npx tsc --noEmit                  # ya corrió arriba; si tipos.ts está mal, falla acá

# 7 — NO rompiste lo que ya estaba
git diff --stat lib/estado-pago.ts lib/whop-webhook.ts lib/whop.ts lib/db.ts \
                app/api/webhooks/whop/route.ts db/migrations/001_init.sql
# esperado exactamente: sin salida. Son los archivos que nadie toca (§8 del plan).

# 8 — la compuerta: la API de Whop responde (sección 6 de este task)
# esperado: un 200 con un Api-Version-Date concreto, y plan_type = "one_time"
```

## 9. Cuándo parar

**Bloqueante, pará y avisá:**

- **`./scripts/configurar-env.sh --solo-verificar` da 401 en los dos entornos.** La key fue revocada.
  No arranca la ola 2. (Un 403 o un 400 en un curl a mano NO es esto: leé la sección 6, hay tres
  endpoints que devuelven falsos negativos.)
- **`npm run db:migrate` falla contra la base del usuario.** Puede ser una connection string sin
  pooler, un Postgres viejo sin `gen_random_uuid()`, o que la base no exista todavía.
- **Vercel está en plan Hobby y los crons no corren.** No bloquea el código pero sí el diseño de T05:
  hay que decidir otra forma de drenar la cola.

**Anotalo en §10 del plan y seguí:**

- El path de `GET /plans` no es el que asume `lib/whop.ts` (P-09). T02 tiene el camino manual.
- Cualquier campo del objeto Payment que la doc describa distinto de como lo declara `PagoWhop`.
- **Necesitás modificar un archivo ajeno** → nunca. Anotalo.
