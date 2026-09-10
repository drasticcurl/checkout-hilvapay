# CHECKOUT-WHOP — checkout propio con links de pago y upsells one-click, reemplazando a KashPay

**Documento maestro del módulo. Todo agente lee este archivo completo antes de abrir su task.**

Un servicio nuevo y aparte, en `pay.hilvanapp.com`, que hace lo que hoy hace KashPay: un panel donde
se asocia un producto de Whop a un link de pago (`/pagos/aguadearroz1`), la página de checkout con
HTML propio y el embed de Whop adentro, y el cobro one-click de los upsells contra la tarjeta que se
guardó en la compra del front. Whop sigue siendo el procesador: lo que se reemplaza es la capa de
checkout, que hoy cuesta 5% arriba de las comisiones de Whop y se cae seguido.

No vive dentro de ningún funnel. Los funnels (`testfunnel`, `gelatina-fit`, `animales-funnel-nuevo`)
mantienen sus páginas de venta y de upsell tal como están — con su copy aprobado y sus VSL — y lo
único que se les agrega es un botón que le habla a este servicio. Igual que hoy con KashPay: la
página del upsell es del funnel, el cobro es de la pasarela.

**Este módulo cobra tarjetas de crédito reales, sin que la persona vuelva a intervenir.** Un bug acá
no devuelve un 500: cobra dos veces, o cobra el producto equivocado, o le regala el producto a quien
no pagó. Todo lo que sigue está diseñado alrededor de esa frase: el anti-doble-cobro lo garantiza un
índice único de la base y no un `if`, los estados de un cobro son un `CHECK` y no una convención, y
todo lo que no se pudo verificar contra la API real está anotado en §10 como bloqueante en lugar de
asumido.

## 0. Qué se construye y qué no

**Se construye**

1. **El panel** (`/admin`): alta de productos asociando un plan de Whop existente, alta de links de
   pago con su copy y su precio de display, la lista de dominios de funnels autorizados a disparar
   cobros, y una **vista de solo lectura de los últimos cobros** para poder diagnosticar una venta
   puntual. Un solo password, igual que el `dashboard-admin`.
1.b **El catálogo de Whop** (`/admin/catalogo`), agregado el 2026-09-10 sobre lo que hizo T02: trae
   por API los productos de la cuenta con sus planes y sus precios reales, marca cuáles ya están
   vinculados y a qué link, y vincula con un click creando el `producto` y su `pagina` **en una sola
   transacción**. El `plan_id` nunca se tipea, que es lo que hacía posible el peor error silencioso de
   este diseño: un link de pago que cobra el producto de otro paso del funnel sin ningún síntoma
   visible. Los planes sin producto se listan aparte y con advertencia. Si Whop no responde, la
   pantalla cae al alta manual: es una comodidad, no el único camino.
2. **La página de checkout** (`/pagos/<slug>`): timer, badge, card del producto y campos de nombre y
   email en HTML propio; el embed de Whop montado adentro con el botón de submit oculto; el botón
   verde propio dispara el submit del iframe. Es la réplica de lo que hace KashPay hoy.
3. **El cobro one-click** (`POST /api/upsell/cobrar`): recibe el token de la orden y el slug del
   link, cobra la tarjeta guardada, y devuelve el estado y a dónde mandar a la persona.
4. **El `loader.js`** que los funnels embeben en el `<head>`, con una función global
   `aceptarUpsell(slug)`. Es la pieza que hace que agregar el checkout propio a un funnel nuevo sea
   pegar un script y un botón, sin tocar la lógica del funnel.
5. **El webhook de Whop** (`/api/webhooks/whop`) con firma verificada y deduplicación. **Ya está
   construido** (ver §"Lo que ya está hecho").
6. **La salida al `dashboard-admin`**: una cola en la base que un cron drena hacia el `/api/ingest`
   que el panel ya tiene, con el evento de compra y su `value`, arrastrando `sessionId`/`visitorId`
   para que la atribución no se parta.
7. **El email de entrega** que se manda desde acá cuando un cobro queda pagado.

**No se construye** (explícito, para que ningún agente lo invente)

- **Niveles de acceso.** La entrega es siempre la misma para todos: quien compra el front recibe el
  acceso completo. No hay columna `nivel` en ninguna tabla y no hay que desbloquear nada
  progresivamente. (Decisión del usuario: "se entrega siempre igual, todos desbloquean todos".)
- **Creación de productos o planes en Whop desde el panel.** El panel **asocia** un plan que ya
  existe. En Whop los planes tienen un nombre "soft" a propósito y el nombre real vive de este lado.
  Crear planes por API es una task futura, no de este módulo.
- **Whop Elements** (los campos de tarjeta sueltos, con CSS propio). El embed es un iframe y no
  acepta CSS de adentro: solo tema, color de acento, color de fondo, border radius y padding. Es
  exactamente la misma limitación que tiene KashPay hoy — mirá sus capturas: tampoco tocaron los
  campos de tarjeta. Elements está en beta y triplica el trabajo.
- **Reintento automático de un cobro rechazado.** Un decline transitorio se le muestra a la persona;
  nadie reintenta solo. Un reintento automático sobre una tarjeta marcada es cómo se juntan
  contracargos.
- **Downsells.** El decline con `sin_fondos` manda a la `url_rechazo` que se configure. Armar una
  cadena alternativa de ofertas es otro módulo.
- **Multi-usuario o roles en el panel.** Un password, como el `dashboard-admin`.
- **Un interruptor de pasarela en el funnel.** Se evaluó y se descartó: **no hay tráfico corriendo**
  (el usuario no está pagando anuncios), así que no hay nada que convivir. T06 reemplaza los botones
  de KashPay directamente y la vuelta atrás es un `git revert`. Un interruptor con una variable de
  entorno habría agregado un archivo, un env var y un condicional en tres páginas para proteger un
  camino que hoy no tiene visitas. **El freno de emergencia real sigue existiendo y está del lado del
  panel:** apagar `paginas.activo` corta el cobro al instante y sin redeploy.

## Lo que ya está hecho, y por qué está hecho

**Antes de que existiera este plan se construyeron y verificaron los cimientos.** No es código a
ciegas: es el resultado de la fase 3, y borrarlo para "hacerlo bien desde cero" tiraría la
verificación con él. T01 es dueña de esos archivos y su trabajo es cerrarlos, no reescribirlos.

| Archivo | Estado |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `vitest.config.ts` | scaffold completo, `next build` compila |
| `app/layout.tsx`, `app/globals.css`, `app/page.tsx` | shell mínimo |
| `db/migrations/001_init.sql` | corrido 2 veces contra Postgres 16.14, idempotente |
| `scripts/migrate.ts` | runner con hash por archivo |
| `lib/db.ts` | `q` / `q1` / `qCount` / `tx`, mismos helpers que `dashboard-admin/lib/db.ts` |
| `lib/whop.ts` | cliente HTTP con `Api-Version-Date`, `Idempotency-Key`, `WhopError` |
| `lib/estado-pago.ts` + `.test.ts` | **44 tests en verde** |
| `lib/whop-webhook.ts` + `.test.ts` | **15 tests en verde** |
| `lib/cobros.ts` | operaciones de dominio compartidas |
| `app/api/webhooks/whop/route.ts` | handler completo |

Verificado el 2026-09-10: `npx tsc --noEmit` exit 0, `npx next build` compila, `npx vitest --run`
59/59.

## 1. Decisiones cerradas

No hay nada que decidir. Si aparece algo que este documento no resuelve, se anota en §10 y **no se
decide en el código**.

**D1 — El anti-doble-cobro es un índice único de la base, no una comprobación en el código.**
`create unique index cobros_orden_pagina_idx on cobros (orden_id, pagina_id)`. Un solo cobro por
orden y por link de pago. Cuando el segundo click intenta insertar, el `ON CONFLICT DO NOTHING`
devuelve cero filas y el endpoint responde con el cobro que ya existía. La alternativa obvia —
confiar en la `Idempotency-Key` de Whop — no alcanza: si el segundo request nunca llega a Whop porque
se cortó la red del lado nuestro, no hay nada que Whop pueda replayar. Verificado:
`_verificacion-checkout.sql` #1 (dos inserts, `insertados = 1`).

**D1.b — El `ON CONFLICT DO NOTHING` va SIN declarar el árbitro.** Es una corrección hecha el
2026-09-10 después de medirlo con tráfico concurrente real, y es el tipo de bug que no aparece en un
test secuencial. `cobros` tiene **dos** índices únicos que una misma fila duplicada viola:
`(orden_id, pagina_id)` y `idempotency_key` (que se deriva de esos dos). Con
`on conflict (orden_id, pagina_id)` Postgres suprime **solo ese** conflicto: si la inserción
concurrente choca primero con el índice de idempotencia, levanta
`duplicate key value violates unique constraint` y el request muere con 500. Medido con 5 POST
simultáneos: **3 dieron 200 y 2 dieron 500**. La protección contra el doble cobro funcionaba igual
—quedó una sola fila— pero el comprador que hacía doble click veía un error habiendo pagado bien. Sin
árbitro, se suprime el conflicto de cualquier índice único. Re-medido con 8 POST simultáneos después
del arreglo: ocho 200, una fila, cero errores en el log.

**D2 — El estado "hay que pedirle la tarjeta otra vez" se deduce del `decline_code`, NO del
`substatus`.** No existe un substatus `requires_action` en Whop; el enum real es
`succeeded | requires_capture | pending | failed | past_due | canceled | price_too_low | uncollectible
| refunded | auto_refunded | partially_refunded | dispute_* | resolution_* | drafted | incomplete |
unresolved`. Cuando el banco pide autenticación en un cobro off-session, el pago llega como `failed`
con `decline_code: authentication_required` o `three_d_secure_*`. Un mapeo que mire solo el substatus
manda todos los 3DS al mismo cajón que "tarjeta robada" y pierde ventas que se recuperan mostrando el
embed. Verificado: `lib/estado-pago.test.ts`, 44 casos.

**D3 — Un pago off-session que pidió 3DS no se puede continuar: se cobra de nuevo, on-session.** La
doc de Whop dice que `client_secret` es `null` para los pagos creados desde un método guardado, así
que no hay nada que confirmar en el browser. El camino es montar el embed con ese mismo plan y que la
persona pase la tarjeta una vez. **Consecuencia que hay que manejar:** eso crea un pago NUEVO, y el
fallido original puede quedar con `retryable: true` y un `next_payment_attempt`. Si Whop lo reintenta
solo y entra, se cobró dos veces. Por eso el cobro de recuperación reusa la misma fila de `cobros`
(mismo `(orden_id, pagina_id)`) y el panel muestra los dos `whop_payment_id` para poder reembolsar a
mano si pasa.

**D4 — La clave del HMAC del webhook es el string `ws_...` literal, sin decodificar de base64.** La
doc de Whop lo dice en "Verify without an SDK". Las dos opciones de librería no sirven:
`unwrapWebhook` de `@whop/sdk/helpers` **todavía no existe** (la propia doc: "The helpers shown here
land in the next release"), y `standardwebhooks@1.1.1` hace `base64.decode(secret)` en el
constructor, con lo cual con un secret `ws_` la firma **no valida nunca**. Por eso la verificación
está escrita a mano en `lib/whop-webhook.ts` y no hay dependencia de webhooks en el
`package.json`. Verificado: `lib/whop-webhook.test.ts`, 15 casos, incluido el que fija que la clave
es literal.

**D5 — El webhook devuelve 200 ante cualquier error interno, y solo 400 ante firma inválida.** Whop
deshabilita un endpoint que falla 72 horas con 10 entregas fallidas, **y los eventos de ese período no
se reenvían nunca**. Un 500 nuestro por un bug de una tarde puede terminar en un webhook apagado y
ventas invisibles. Entonces: el evento se guarda en `whop_eventos` con su error, se responde 200, y
se reprocesa desde acá. La distinción entre "llegó" y "se procesó" es la columna `procesado_at`:
NULL significa que hay que reintentar, y por eso un reenvío del mismo `webhook-id` sí se reprocesa si
la vez anterior falló. Verificado: `_verificacion-checkout.sql` #8 y #9.

**D6 — Las escrituras de estado de un cobro son monótonas: de `pagado` no se sale.** La doc de Whop
avisa que "a newer event can arrive before an older event". Un `payment.failed` viejo que llega
después de un `payment.succeeded` no puede volver a poner el cobro en fallido, porque eso le quitaría
el producto a alguien que pagó. Un reembolso y una disputa se anotan en `reembolsado_at` y
`disputa_at`, que son hechos distintos de "el cobro falló". El `UPDATE` lleva el estado anterior en el
`WHERE`, así que dos escrituras concurrentes no se pisan.

**D7 — El vínculo pago↔orden es el `metadata.orden_id`, con `checkout_configuration_id` de respaldo.
Nunca el email.** La doc de crear checkout configuration dice que el `metadata` se copia a los pagos y
las memberships que salgan de esa sesión, y el objeto Payment además trae
`checkout_configuration_id` como campo propio. El email no sirve como clave: la gente lo escribe
distinto, usa alias, y dos personas pueden compartirlo.

**D8 — El claim del front es sincrónico y no depende del webhook.** Cuando el embed dispara
`onComplete(planId, receiptId)`, el browser postea a `/api/checkout/reclamar`, el server hace
`GET /payments/{receiptId}` y guarda `member_id` + `payment_method_id`. Eso elimina la carrera entre
"la persona ya está en la página del upsell" y "todavía no llegó el webhook". El webhook queda como
red de seguridad para quien cierra la pestaña. Las dos vías escriben con `coalesce`, así que el que
llegue segundo no borra nada.

**D9 — El token de la orden viaja en la URL, como el `?ks=` de KashPay.** El checkout está en
`pay.hilvanapp.com` y las páginas de upsell en el dominio del funnel: la cookie no se comparte. La
redirección al upsell lleva `?ot=<token>`, el `loader.js` lo lee y lo guarda en `sessionStorage`, y
el cobro va por `POST` cross-origin contra un `Access-Control-Allow-Origin` que sale de la tabla
`origenes`. El token habilita cobrar una tarjeta guardada, así que: aleatorio, con vencimiento, y —
esto es lo que de verdad lo contiene — **aunque alguien lo robe, el índice único de D1 impide cobrar
dos veces el mismo link**.

**D10 — El precio que se cobra lo define el plan de Whop; el que se muestra vive en `productos`. El
panel compara los dos.** Es la consecuencia de que en Whop el nombre y el precio sean "soft". Si el
panel no avisara cuando `productos.precio` difiere del `initial_price` del plan, se podría publicar
un link que dice $9.90 y cobra $17. Es el error más caro que este diseño habilita, así que la
comparación es obligatoria y visible en la pantalla de edición.

**D11 — `three_ds_level: 'frictionless'` en la checkout configuration del front.** Cada desafío 3DS
en la compra del front es una tarjeta que puede terminar sin guardarse, y sin tarjeta guardada no hay
upsell one-click. No es garantía: si el banco lo exige, el desafío aparece igual.

**D12 — Los importes son `numeric(10,2)` en unidades, NO centavos enteros.** Whop devuelve
`settlement_amount: 9.9`, no `990`. Un agente que asuma centavos guarda 990 dólares donde van 9.90.
Verificado: `_verificacion-checkout.sql` #10 y #11 (los tipos leídos de la base).

**D13 — El trabajo que sale hacia afuera pasa por la cola `salidas`, nunca desde el handler del
webhook.** Whop exige responder en menos de 5 segundos. Avisarle al `dashboard-admin` y mandar un
email no entran en ese presupuesto de tiempo de forma confiable. El handler encola y un cron drena.
Si el panel está caído, la venta no se pierde.

**D14 — El módulo nace apagado.** `paginas.activo` y `origenes.activo` arrancan en `false` para todo
lo que se cree, y `WHOP_API_BASE` apunta al sandbox en el `.env.example`. El interruptor está en la
base, no en una variable de entorno, precisamente para poder apagar un link de pago sin redeployar
justo cuando algo está cobrando mal.

## 2. Arquitectura

```
  DOMINIO DEL FUNNEL (testfunnel, gelatina-fit…)     pay.hilvanapp.com (este repo)
  ─────────────────────────────────────────────      ──────────────────────────────────────

  landing / VSL
      │  botón "COMPRAR"
      └──── link ────────────────────────────────►  app/pagos/[slug]/page.tsx      (T03)
                                                     │ lee paginas + productos
                                                     ▼
                                                    components/checkout/*.tsx      (T03)
                                                     │ nombre + email propios
                                                     │ POST /api/checkout/sesion   (T03)
                                                     │   └─ crearCheckoutConfiguration()
                                                     │      lib/whop.ts            [hecho]
                                                     ▼
                                                    <WhopCheckoutEmbed sessionId>
                                                     │ setupFutureUsage=off_session
                                                     │ hideSubmitButton
                                                     │ onComplete(planId, receiptId)
                                                     ▼
                                                    POST /api/checkout/reclamar    (T03)
                                                     │   └─ obtenerPago() → member + payment_method
                                                     │      lib/cobros.ts          [hecho]
                                                     ▼
  /upsell-latam  ◄──── redirect ?ot=<token> ────────┘
      │
      │ <script src="pay.hilvanapp.com/loader.js">   (T04)
      │ botón → aceptarUpsell('aguadearroz2')
      └──── POST cross-origin ───────────────────►  app/api/upsell/cobrar/route.ts (T04)
                                                     │ CORS ← tabla origenes
                                                     │ INSERT cobros ON CONFLICT   ← D1
                                                     │ crearPagoOffSession()       [hecho]
                                                     ▼
      polling ◄──────────────────────────────────  GET /api/cobros/[id]            (T04)
      │                                              │ mapearEstado()              [hecho]
      │ pagado → next  │ requiere_tarjeta → embed    ▼
      └──────────────────────────────────────────► INSERT salidas                  [hecho]

                        Whop ──── webhook ────────►  app/api/webhooks/whop/route.ts [hecho]
                                                     │ firma + dedupe
                                                     ▼
                                                    INSERT salidas
                                                     │
                          cron cada minuto  ───────► app/api/cron/salidas/route.ts  (T05)
                                                     ├─► dashboard-admin /api/ingest
                                                     └─► Resend: email de entrega

                                                    app/admin/**                   (T02)
                                                     productos · paginas · origenes
```

La decisión estructural que hace testeable el módulo: **toda la lógica que decide algo es pura y vive
en `lib/estado-pago.ts`** (qué significa un substatus, qué hacer con un decline, qué mensaje ve el
comprador). Los módulos que tienen efectos —`lib/whop.ts`, `lib/cobros.ts`, las rutas— no deciden:
traducen. Por eso las 44 afirmaciones sobre el comportamiento frente a cada decline se prueban sin
tocar la red ni la base, que es la única forma de probarlas sin cobrarle a alguien de verdad.

## 3. Esquema — fuente de verdad

`_schema-checkout.sql` en esta carpeta es el DDL canónico. **Ya se ejecutó**, dos veces, contra una
base scratch en PostgreSQL 16.14 (Homebrew), exit 0 las dos veces. Vive en el repo como
`db/migrations/001_init.sql`. Nadie lo reescribe: cualquier cambio de una coma en un `CHECK` invalida
las 11 afirmaciones de `_verificacion-checkout.sql`.

| Tabla | Para qué |
|---|---|
| `productos` | Lo que se vende. Nombre real, precio de display, y el `whop_plan_id` que se cobra. |
| `paginas` | Los links de pago. `slug`, tipo (`front`/`upsell`), a dónde va después, y el `config` jsonb con timer y textos. |
| `origenes` | Dominios de funnels autorizados a disparar cobros one-click (la allowlist de CORS). |
| `ordenes` | Un comprador que arrancó un checkout. Guarda `whop_member_id`, `whop_payment_method_id` y el `token` público. |
| `cobros` | Un intento de cobro. El índice `(orden_id, pagina_id)` es la guarda de D1. |
| `whop_eventos` | Los webhooks recibidos, para deduplicar. PK = `webhook-id`. |
| `salidas` | Cola de lo que hay que mandar afuera (panel, email). |

Tres detalles del esquema que hay que entender antes de escribir contra él:

1. **`cobros.monto` es `numeric(10,2)`, en unidades.** El driver `pg` devuelve `numeric` como
   **string**, no como number. Convertilo explícitamente donde lo muestres; no lo sumes en JS si lo
   podés sumar en SQL.
2. **`ordenes.session_id` y `visitor_id` son `uuid`.** Vienen del funnel por querystring y el
   `/api/ingest` del `dashboard-admin` los exige como UUID. Si llegan mal formados, van a `null`: no
   se inventa un UUID, porque eso crearía una sesión fantasma en el panel.
3. **`paginas.config`, `ordenes.utms` y `salidas.payload` son `jsonb`.** Hay que pasarlos como
   `$1::jsonb` con `JSON.stringify`; un string sin el cast falla con un error que no dice eso.

## 4. Contrato congelado — `lib/tipos.ts`

**Lo declara T01. Lo consumen T02, T03, T04 y T05. Nadie más lo modifica.** Es lo que permite que
las cuatro tasks de la ola 2 se escriban al mismo tiempo.

Hoy los tipos de fila viven dentro de `lib/cobros.ts`. T01 los mueve a `lib/tipos.ts` y agrega los
que faltan, dejando `lib/cobros.ts` importándolos. La forma exacta:

```ts
/** Fila de `productos`. `precio` y `precio_anclaje` llegan como string: son numeric de PG. */
export type Producto = {
  id: string; nombre: string;
  whop_plan_id: string; whop_product_id: string | null; whop_nombre_soft: string | null;
  precio: string; moneda: string; precio_anclaje: string | null;
  imagen_url: string | null; descripcion: string | null; activo: boolean;
};

/** Fila de `paginas` con su producto ya resuelto. Es lo que la página de checkout necesita. */
export type PaginaConProducto = {
  id: string; slug: string; tipo: 'front' | 'upsell';
  url_exito: string | null; url_rechazo: string | null;
  config: ConfigPagina; activo: boolean;
  producto: Producto;
};

/**
 * El jsonb de `paginas.config`. TODOS los campos son opcionales y la UI tiene que
 * funcionar sin ninguno: una página creada por el panel antes de que exista un
 * campo nuevo no puede romper el checkout.
 */
export type ConfigPagina = {
  /** Minutos del contador de "la oferta expira en". Ausente = sin timer. */
  timerMinutos?: number;
  /** Texto del botón verde. Default: 'COMPRAR AHORA'. */
  textoBoton?: string;
  /** Muestra la barra "100% SEGURO". Default: true. */
  badgeSeguro?: boolean;
  /** Bajada arriba de la card del producto. */
  subtitulo?: string;
};

/** Respuesta de POST /api/checkout/sesion. */
export type RespuestaSesion = { ordenId: string; sessionId: string; token: string };

/**
 * Respuesta de POST /api/upsell/cobrar y de GET /api/cobros/[id]. Es el contrato
 * que consume el loader.js, así que agregarle un campo es seguro y sacarle uno
 * rompe funnels ya publicados.
 */
export type RespuestaCobro = {
  cobroId: string;
  estado: EstadoCobro;
  /** A dónde mandar a la persona. null = quedate donde estás y seguí puleando. */
  siguienteUrl: string | null;
  /** Mensaje ya listo para mostrar. Nunca trae el decline_code crudo. */
  mensaje: string | null;
  /** true cuando hay que montar el embed inline para que pase la tarjeta. */
  pedirTarjeta: boolean;
  /** El sessionId para ese embed. Solo viene cuando pedirTarjeta es true. */
  sessionIdRecuperacion: string | null;
};
```

Reglas de implementación que no son negociables:

1. **`EstadoCobro` se importa de `lib/estado-pago.ts`, no se redeclara.** Está atado al `CHECK` de la
   base; dos definiciones se desincronizan en el primer estado nuevo.
2. **`precio` es string.** Si una task lo trata como number, `9.90` se convierte en `9.9` al mostrar y
   el precio del checkout deja de coincidir con el de la landing. Formatealo explícitamente.
3. **`siguienteUrl` puede ser `null` y el loader tiene que tolerarlo** sin dejar a la persona en una
   página muerta: si es null, se queda y muestra `mensaje`.
4. **Nada de `any` en este archivo.** Es el único archivo que cuatro tasks importan a la vez: un
   `any` acá apaga el chequeo de tipos en las cuatro.

**El otro contrato que declara T01 es `lib/auth.ts`**, y su firma está escrita en la **sección 3 de
`T01-cimientos.md`** (`COOKIE_SESION`, `firmarSesion`, `verificarSesion`, `passwordCorrecta`,
`DIAS_SESION`). Vive ahí y no acá porque solo T02 lo consume; igual está congelado, y T02 no lo
modifica.

## 5. Contrato congelado — la API pública del cobro one-click

**La implementa T04. La consume el `loader.js` (T04) y, desde afuera del repo, los funnels (T06).**
Una vez publicada en un funnel, esta forma no se puede cambiar sin redeployar el funnel.

```
POST https://pay.hilvanapp.com/api/upsell/cobrar
Content-Type: application/json
Origin: https://<dominio del funnel>        ← tiene que estar activo en `origenes`

{ "token": "<ordenes.token>", "slug": "aguadearroz2" }

200  RespuestaCobro
400  { error: 'payload_invalido' }
401  { error: 'token_invalido' | 'token_vencido' }
403  { error: 'origen_no_autorizado' }
404  { error: 'pagina_inexistente' | 'pagina_inactiva' }
409  { error: 'sin_metodo_guardado' }   ← pagó con algo no guardable: mostrale el embed
```

Reglas que no son negociables:

1. **El `slug` decide qué se cobra, nunca el cliente.** El body no acepta ni precio ni `plan_id`: los
   dos se leen de la base a partir del slug. Si el importe viniera del cliente, cualquiera con el
   token podría cobrarse un dólar y llevarse el producto.
2. **Antes de llamar a Whop se inserta la fila de `cobros` con `ON CONFLICT DO NOTHING`.** Si no
   insertó, se devuelve el cobro existente y **no se llama a Whop**. Ese orden es D1; invertirlo
   (llamar primero, insertar después) reabre el doble cobro.
3. **La `Idempotency-Key` es `<orden_id>:<pagina_id>` y el body del POST a Whop es
   determinístico.** Whop responde 400 si llega la misma clave con un body distinto, así que no se le
   agregan timestamps ni contadores de intento.
4. **Un 409 de Whop no se reintenta con clave nueva.** Significa que el resultado quedó
   indeterminado: hay que consultar el estado. `WhopError.indeterminado` ya lo expone.
5. **El endpoint responde rápido y el cobro se resuelve por polling.** `POST /payments` devuelve el
   pago al instante pero lo procesa asíncrono: el estado inicial casi siempre es `procesando` y no es
   el resultado final.

## 6. Contrato congelado — el `loader.js` que embeben los funnels

**Lo implementa T04. Lo usa T06 y todo funnel futuro.** Es la superficie que hace que sumar el
checkout propio a un funnel nuevo sea pegar dos líneas.

```html
<script async defer src="https://pay.hilvanapp.com/loader.js"></script>

<button data-hilvana-upsell="aguadearroz2">SÍ, LO QUIERO</button>
```

```ts
/**
 * Lo que el script publica en `window`. Los funnels llaman a esto y nada más.
 *
 * `aceptarUpsell` es idempotente del lado del cliente: mientras hay un cobro en
 * curso, las llamadas siguientes se ignoran. Es la primera defensa contra el
 * doble click; la segunda y la real es el índice único de D1.
 */
type HilvanaGlobal = {
  aceptarUpsell(slug: string): Promise<void>;
  rechazarUpsell(slug: string): void;
  /** El token de la orden en curso, o null. Para que el funnel pueda decidir qué mostrar. */
  token(): string | null;
};
```

Reglas que no son negociables:

1. **El token se lee de `?ot=` y se guarda en `sessionStorage`, no en `localStorage`.** Con
   `localStorage` el token sobrevive al cierre del browser y queda disponible para la próxima
   persona que use esa computadora — en un cyber, eso es un cobro a la tarjeta de un desconocido.
2. **El script engancha por `data-hilvana-upsell` y también expone la global.** El atributo alcanza
   para el caso normal; la global es para los botones que React renderiza con su propio `onClick`,
   que es exactamente cómo están hechos los botones de `testfunnel` hoy.
3. **Si no hay token, el botón no se rompe: navega a `url_rechazo` o no hace nada, y lo loguea.** Una
   persona que llegó al upsell por un link directo, sin haber comprado, no puede ver un error de JS.
4. **El script no manda tracking ni pixel.** Eso es del funnel. Este archivo cobra y redirige.

**La URL de recuperación, que también es contrato:**

```
https://pay.hilvanapp.com/pagos/<slug>?ot=<token>&r=1
```

La arma T04 (el loader, cuando el estado es `requiere_tarjeta`) y la sirve **T03** (sección 7 de su
task): misma página de checkout, sin pedir nombre ni email, con el email de la orden precargado en el
embed. Es un pago **nuevo** sobre la **misma** fila de `cobros` — por D3 no hay nada que reanudar, y
por D1 no puede haber una fila nueva.

## 7. Dependencias y olas de paralelismo

```
  ola 1        T01  cimientos + contratos                  1 agente, SOLA
                │
                ├──────────┬──────────┬──────────┐
  ola 2       T02        T03        T04        T05          4 en paralelo
             panel     checkout   one-click   salida
                │          │          │          │
                └──────────┴────┬─────┴──────────┘
                                │
  ola 3                        T06  botón en testfunnel     1 agente, y solo
                                    (OTRO REPO)             después de probar en sandbox
```

| Task | Depende de | Se puede correr junto con |
|---|---|---|
| T01 | — | **nada, va sola** |
| T02 | T01 (`lib/tipos.ts`, `lib/auth.ts`) | T03, T04, T05 |
| T03 | T01 (`lib/tipos.ts`) | T02, T04, T05 |
| T04 | T01 (`lib/tipos.ts`) | T02, T03, T05 |
| T05 | T01 (`lib/tipos.ts`) | T02, T03, T04 |
| T06 | T02+T03+T04 **verificadas en sandbox** | nada |

Lo que no es obvio:

- **T03 y T04 comparten el flujo pero no comparten archivos.** T03 crea la orden y emite el token;
  T04 lo consume. Se pueden escribir al mismo tiempo porque las dos consumen el **tipo**
  (`RespuestaSesion`, `RespuestaCobro` de §4) y no la implementación de la otra. El token es un string
  opaco para T04: le da igual cómo se generó.
- **T04 no necesita que T03 exista para verificarse.** Su task trae el SQL de seed que inserta una
  orden con token, member y payment method de sandbox. Con eso prueba el circuito completo del cobro
  sin que la página de checkout esté escrita.
- **T05 tampoco depende de que haya ventas reales.** Inserta una fila en `salidas` a mano y verifica
  que el cron la drene y la marque enviada.
- **T06 va sola y al final porque toca OTRO repo.** No es por riesgo de facturación —no hay tráfico
  corriendo—, es porque no tiene nada que probar hasta que exista un link de pago que funcione en
  sandbox. Arrancarla antes deja el funnel apuntando a un checkout que todavía no cobra.
- **El límite son las dependencias, no la cantidad de agentes.** Meter un quinto agente en la ola 2
  no acelera nada: no hay una quinta pieza independiente.

**Si preferís ir de a uno:** T01 → T03 → T04 → T02 → T05 → T06. Ese orden te deja cobrando en
sandbox lo antes posible (T03+T04), y deja para el final lo que escribe en sistemas externos (T05
postea al panel y manda emails; T06 toca el funnel que factura).

## 8. Ownership de archivos — regla anti-colisión

**Cada task solo escribe los archivos de su fila.** Si necesita algo de un archivo ajeno, lo lee pero
no lo escribe; si cree que necesita escribirlo, va a §10.

| Task | Archivos que puede crear o modificar |
|---|---|
| T01 | `lib/tipos.ts`, `lib/auth.ts`, `lib/auth.test.ts`, `lib/cobros.ts`, `package.json`, `vercel.json`, `.env.example`, `README.md` |
| T02 | `middleware.ts`, `app/admin/**`, `app/api/admin/**`, `lib/admin/**`, `scripts/seed.ts` |
| T03 | `app/pagos/**`, `app/api/checkout/**`, `components/checkout/**` |
| T04 | `app/api/upsell/**`, `app/api/cobros/**`, `app/loader.js/route.ts`, `lib/cors.ts`, `lib/cors.test.ts`, `lib/token.ts`, `lib/token.test.ts` |
| T05 | `app/api/cron/**`, `lib/salidas.ts`, `lib/salidas.test.ts`, `lib/email.ts`, `lib/email.test.ts`, `emails/**`, `db/migrations/002_config_email.sql` |
| T06 | **repo `testfunnel`:** `components/upsell/HilvanaUpsellButton.tsx`, `lib/hilvana.ts`, `lib/hilvana.test.ts`, el `<script>` en `app/layout.tsx`, y el reemplazo del botón en las tres páginas de upsell (o en el componente que lo renderice) |

**Un `*.test.ts` pertenece al dueño del archivo que prueba.** Los `**` de la tabla ya los incluyen; los
que están fuera de un `**` están listados uno por uno para que no haya que deducirlo.

Excepción documentada, la única: **`lib/cobros.ts` lo escribe T01** (para que importe de
`lib/tipos.ts` en vez de declarar los tipos). T03, T04 y T05 lo **leen y lo llaman**, no lo editan. Si
alguna necesita una función nueva ahí, va a §10 — no la agrega.

**Archivos que NADIE toca:**

```
lib/estado-pago.ts           44 tests dependen de su comportamiento exacto
lib/estado-pago.test.ts      es la verificación de la fase 3, no un test más
lib/whop-webhook.ts          15 tests, y la clave del HMAC es D4
lib/whop-webhook.test.ts     idem
lib/whop.ts                  cuatro tasks llaman a estas funciones
lib/db.ts                    idem
db/migrations/001_init.sql   YA CORRIÓ. Un cambio invalida _verificacion-checkout.sql
app/api/webhooks/whop/route.ts   funciona y está verificado

en el repo testfunnel — no factura hoy, pero su copy es texto final aprobado:
lib/quiz-v2/config-latam.ts                     los precios y el copy aprobado
components/upsell/VslOfferBlockLatam.tsx        el copy y el tracking. Ver la nota de abajo
components/upsell/Upsell2VslOfferBlockLatam.tsx idem
```

De las páginas de upsell (`app/upsell-latam/page.tsx`, `app/upsell2-latam/page.tsx`,
`app/upsell3-latam/page.tsx`) T06 **sí** cambia el botón, y `KashPayUpsell3Button.tsx` queda sin uso.
Lo que sigue intocable es todo lo demás de esas páginas: **el copy es texto final aprobado y los
precios salen de `config-latam.ts`**. Si el botón de una de ellas se renderiza desde
`VslOfferBlockLatam` o `Upsell2VslOfferBlockLatam`, el reemplazo va ahí adentro con el mismo alcance:
solo el botón, nada del copy ni del tracking.

**`KashPayUpsell3Button.tsx` no se borra.** Queda en el repo sin importarse: es la referencia de cómo
funcionaba el cobro anterior, y borrarlo no gana nada mientras el reemplazo no tenga una venta real
encima.

Un cambio de esquema en `001_init.sql` **no** es una excepción negociable: si una task necesita una
columna nueva, crea `db/migrations/002_<lo-que-sea>.sql`, que es aditiva. La 001 ya corrió.

Lo que parece colisión y no lo es: T02 y T03 escriben los dos bajo `app/`, pero en subárboles
disjuntos (`app/admin/**` vs `app/pagos/**`). Next no tiene un archivo de rutas central, así que no
hay nada compartido que editar.

## 9. Criterios de aceptación globales

1. `npx tsc --noEmit` exit 0, `npx next build` compila, `npx vitest --run` todo en verde.
2. `npm run db:migrate` corrido dos veces: la segunda dice "Nada nuevo que aplicar" y sale 0.
3. Todo endpoint nuevo rechaza sin credencial: `/api/admin/*` sin cookie da 401, `/api/cron/*` sin
   `CRON_SECRET` da 401, `/api/upsell/cobrar` desde un origen que no está en `origenes` da 403.
4. **El doble click no cobra dos veces.** Dos POST simultáneos a `/api/upsell/cobrar` con el mismo
   token y slug → un solo `whop_payment_id` en la base y un solo pago en el dashboard de Whop.
5. **Nada de lo que ya funcionaba cambió.** En `testfunnel`, el copy y los precios de las tres páginas
   de upsell quedan idénticos: `git diff` de esas páginas muestra **solo** el cambio de botón, y
   `git diff lib/quiz-v2/config-latam.ts` no muestra nada. Los tests de `testfunnel` siguen pasando
   (`garantia-latam.test.ts` incluido, que verifica el copy de la garantía).
6. **El módulo queda apagado.** Al terminar todo: `select count(*) from paginas where activo` = 0 y
   `select count(*) from origenes where activo` = 0, y `WHOP_API_BASE` apunta al sandbox. Encenderlo
   es una acción explícita del usuario en el panel.
7. El circuito completo probado en sandbox: comprar el front, que el claim guarde
   `whop_payment_method_id`, cobrar los upsells con un click, y que los cuatro cobros aparezcan en el
   `dashboard-admin`.
8. **La vuelta atrás está probada.** `git revert` del commit de T06 en `testfunnel` deja las páginas
   como estaban y el build sigue pasando. Es el reemplazo del interruptor que se descartó en §0: no hay
   un switch, hay un commit chico y aislado.

## 10. Preguntas abiertas

Si aparece una decisión que este documento no resuelve, **se anota acá en lugar de decidirla en el
código**. Si bloquea, la task se detiene y no sigue con suposiciones.

### P-01 — El valor real de `Api-Version-Date`, y que la API key tenga los 22 permisos
- **Task:** T01
- **Sección del plan:** §"Lo que ya está hecho" / `lib/whop.ts`
- **Archivo:** `.env.example`, `lib/whop.ts`
- **Qué falta:** No hay API key disponible, así que **ninguna llamada a la API de Whop se pudo
  probar**. Dos cosas concretas sin verificar: (a) el valor de `Api-Version-Date` — la doc muestra
  `2026-08-21-1` en los snippets del SDK y `2026-09-09` en la referencia de headers, y un valor
  inexistente hace fallar todas las llamadas a la vez; (b) que el path `GET /plans` exista (se dedujo
  del resto de la API, está marcado como no verificado en `lib/whop.ts`).
- **Bloquea:** **SÍ.** Si la API key no tiene los permisos o la versión no existe, no cobra nada y el
  diseño de `lib/whop.ts` puede tener que cambiar. T01 lo prueba con dos `curl` de lectura antes de
  que arranque la ola 2.
- **RESUELTA el 2026-09-10**, contra la API real:
  - `WHOP_API_VERSION_DATE=2026-08-21-1` responde 200. Confirmado.
  - `WHOP_API_BASE=https://api.whop.com/api/v1` — la key es de **producción**, no de sandbox (dio 401
    contra `sandbox-api.whop.com`). Ver P-11.
  - `WHOP_COMPANY_ID=biz_Me8Lbiv174brtM`, company "Sinvanapp".
  - Los permisos alcanzan con el rol Admin.
  - **Tres correcciones al sondeo, que costaron un rato y quedan documentadas en
    `scripts/configurar-env.sh`:**
    1. `GET /accounts/me` da **403**: pide el scope `company:balance:read`, que **no está entre las 22
       permisos**. Sirve para el quickstart de la doc, no para una key de pagos. No usarlo para
       verificar nada.
    2. `GET /companies/me` da 200 pero **devuelve otra company** (la personal del usuario, no la del
       negocio). Autodetectar el `account_id` con eso hace que todo lo demás consulte la company
       equivocada. El `biz_` **se pide**, no se detecta.
    3. `GET /products` **sin** `account_id` da 200 y devuelve el **catálogo público de Whop** — 20
       productos de otros negocios. Es la trampa más fea de las tres porque parece que funcionó.
       Cualquier listado de este módulo va scopeado por company, siempre.

### P-02 — Los `plan_id` de los tres upsells
- **Task:** T02 (para el seed), T03 y T04 (para el circuito completo)
- **Sección del plan:** §9 criterio 7
- **Estado el 2026-09-10, leído de la API real:** la company tiene **un solo producto y tres planes**:

  | plan_id | tipo | precio | visibilidad | producto |
  |---|---|---|---|---|
  | `plan_hgNXAvG16M9ix` | one_time | 9.90 usd | visible | `prod_pRD7ZnRinvzU1` "app agua de arroz" |
  | `plan_sARwY0XsFUbAg` | one_time | 9.90 usd | hidden | **ninguno** |
  | `plan_5t3JLH0wp9o7c` | one_time | 9.90 usd | hidden | **ninguno** |

  El del front es **`plan_hgNXAvG16M9ix`**: es el único atado a un producto. Los dos huérfanos no se
  usan — un plan sin producto no admite códigos de descuento (lo dice la doc de `POST /payments`:
  "the plan must be attached to a product"). Los tres son `one_time`, así que **no hay trampa de
  suscripción**.
- **Qué falta:** los planes de los upsells 1, 2 y 3 **no existen todavía**. Hay que crearlos en el
  dashboard, atados a un producto, con su precio.
- **Bloquea:** no para escribir código, **sí** para el criterio 7 (el circuito de los tres upsells).
- **Mientras tanto:** las tasks verifican con el plan del front y con `plan_id` falsos para los casos
  que no llaman a Whop.
- **Resolución:** front resuelto. Faltan tres.

### P-03 — Quién manda los emails de entrega
- **Task:** T05
- **Sección del plan:** §0 punto 7
- **DATO NUEVO del 2026-09-10, leído de la API:** la company tiene
  **`send_customer_emails: false`**. O sea que **Whop hoy no le manda NINGÚN email a los
  compradores**: ni la confirmación de compra ni la entrega del acceso.
- **Lo que eso cambia:** el email propio ya no es un "más adelante con branding". Es **el único
  camino de entrega que va a existir**, y sin él alguien paga y no recibe nada. Sube de prioridad: T05
  deja de ser la última y su email pasa a ser bloqueante para cobrarle al primer cliente.
- **Qué falta decidir:** o se prende `send_customer_emails` en Whop (entrega gratis desde el día uno,
  con la marca de Whop), o se manda desde acá con Resend (hace falta `RESEND_API_KEY` y un dominio
  verificado). Lo más seguro es **prender el de Whop ahora** y reemplazarlo después, para que no haya
  ni un día sin entrega.
- **Bloquea:** no el código, **sí** el lanzamiento.
- **Mientras tanto:** T05 implementa el envío propio detrás del interruptor de base que arranca
  apagado. El resto de los funnels ya usa `resend@^6.12.3` (ver `reset-app/emails/`).
- **Resolución:**

### P-04 — Con qué identidad se reporta al `dashboard-admin`
- **Task:** T05
- **Sección del plan:** §0 punto 6
- **Qué falta:** El `/api/ingest` del panel autentica con un Bearer por funnel
  (`funnels.ingest_key_hash`). ¿El checkout reporta como el funnel que ya existe para `testfunnel`, o
  se crea un funnel nuevo? Reportar como el existente mantiene todo en un embudo; crear uno nuevo
  separa las ventas de KashPay de las propias, que durante la convivencia es más fácil de comparar.
- **Bloquea:** no.
- **Mientras tanto:** T05 lee la key de `PANEL_INGEST_KEY` sin asumir de qué funnel es.
- **Resolución:**

### P-05 — Si los funnels van a pasar `sessionId` y `visitorId` al link de pago
- **Task:** T03 (los recibe), T06 (los manda)
- **Sección del plan:** §3 detalle 2
- **Qué falta:** Sin eso, la venta llega al panel sin sesión y la atribución a campaña se parte. El
  funnel los tiene (`testfunnel/lib/utm.ts` y su tracker), pero pasarlos implica modificar el link de
  la landing.
- **Bloquea:** no.
- **Mientras tanto:** el checkout los acepta como opcionales y los guarda en `null` si no vienen.
- **Resolución:**

### P-06 — Los precios de los tres upsells
- **Task:** T02 (para el seed del panel)
- **Qué falta:** De la captura de KashPay se lee que el front es **$9.90 USD** ("Chau Hinchazón - 7
  días - Programa con agua de arroz"). De `testfunnel/lib/quiz-v2/config-latam.ts` sale que el upsell
  3 es $17. Faltan los de los upsells 1 y 2.
- **Bloquea:** no.
- **Resolución:**

### P-07 — El dominio `pay.hilvanapp.com`
- **Task:** ninguna (paso manual del usuario)
- **Qué falta:** Apuntarlo al proyecto de Vercel. Y, si se quiere Apple Pay en el embed, verificar el
  dominio en Whop — sin eso el embed muestra solo tarjeta.
- **Bloquea:** no para desarrollar (`localhost:3010` sirve), **sí** para probar el circuito
  cross-origin real.
- **Sobre `pay.hilvanapp.online`:** es el dominio que usa KashPay. Se puede liberar cuando el usuario
  quiera, porque no hay tráfico corriendo. Lo único a tener en cuenta es no reusar ese mismo host para
  el checkout nuevo mientras el DNS viejo siga propagándose: usá `pay.hilvanapp.com`, que es el que se
  decidió.
- **Resolución:**

### P-08 — Cuánto cuesta `setupFutureUsage="off_session"` en conversión del front
- **Task:** ninguna (decisión de negocio)
- **Qué falta:** Esa prop **filtra del checkout los métodos de pago que no se pueden guardar**. En
  LATAM eso puede sacar Pix, Mercado Pago, OXXO, PSE o Yape del checkout del front. Es un trueque:
  se resigna conversión en el producto principal para habilitar los upsells one-click. El dato que
  falta es qué porcentaje de las ventas actuales entra con tarjeta.
- **Bloquea:** no.
- **Mientras tanto:** se implementa con `off_session` (sin eso no hay one-click, que es el objetivo
  del módulo). Cuando esté el dato, se puede evaluar un checkout sin `off_session` para los funnels
  donde el método local pese más que el upsell.
- **Resolución:**

### P-09 — El path real para listar los planes de Whop
- **Task:** T02 lo consume
- **Sección del plan:** §4 / `lib/whop.ts`
- **RESUELTA el 2026-09-10, con corrección:** el path es `GET /plans` y **exige `account_id` como
  query param**. Sin él devuelve `400 {"error":{"message":"account_id is required"}}`. Ya está
  corregido en `listarPlanes()` de `lib/whop.ts`, que ahora arma
  `/plans?account_id=<companyId()>&limit=100`. Verificado: responde 200 y devuelve los 3 planes.
- **Bloquea:** no, y ya no hace falta el camino de fallback manual del panel — aunque T02 lo
  implementa igual, porque un selector que no carga no puede ser el único camino.
- **Resolución:** cerrada.

### P-10 — ¿Se activa el precio en moneda local (`adaptivePricing`)?
- **Task:** T03
- **Sección del plan:** §D6 / las props del embed
- **Dato del 2026-09-10:** el plan del front tiene **`adaptive_pricing_enabled: true`**, o sea que del
  lado de Whop ya está habilitado. Pero el **embed lo trae apagado por defecto** y hay que pedirlo con
  la prop `adaptivePricing`. Mientras no se pida, se cobra en la moneda base del plan (usd).
- **Qué falta:** decidir si se activa. Para LATAM, ver el precio en moneda local sube conversión; el
  contra es que el importe que llega a la base y al panel puede venir en otra moneda y hay que
  normalizar para comparar. `cobros.moneda` ya existe para eso.
- **Bloquea:** no.
- **Mientras tanto:** T03 **no** lo activa (queda en el default de Whop, usd). Es un cambio de una
  línea cuando se decida, y así el primer circuito se prueba con una sola moneda.
- **Resolución:**

### P-11 — Desarrollar contra producción, sin sandbox
- **Task:** T03 y T04
- **Dato del 2026-09-10:** la key es de **producción**. En sandbox da 401, así que no hay entorno de
  prueba configurado.
- **Lo que implica, concreto:** las tarjetas de prueba de Whop **no funcionan en producción**. T04
  tiene que verificar que un `insufficient_funds` caiga en el fallback correcto y que un
  `authentication_required` lleve al modo recuperación de T03 §7 — y sin sandbox eso requiere una
  tarjeta real que efectivamente rebote. **Ese circuito, que es el que decide si se recupera o se
  pierde la venta del upsell, queda sin probar.**
- **Bloquea:** no el código. Sí la confianza en el criterio 7.
- **Mientras tanto:** se desarrolla contra producción con un plan de 1 USD y reembolsando cada prueba.
  Los tests unitarios de `lib/estado-pago.ts` (44 casos) cubren la **lógica** de cada decline; lo que
  no se puede probar es que Whop devuelva los códigos que esperamos.
- **Recomendación:** crear la key de sandbox en `sandbox.whop.com/dashboard` (son dos minutos, y la
  doc dice "money never moves there"). Los planes de sandbox son otros y hay que crearlos ahí.
- **Resolución:**

### P-12 — El import real de `WhopCheckoutEmbed` y la forma exacta de `onComplete` (T03)
- **Task:** T03
- **Sección del plan:** §6 (contrato del embed)
- **Qué se verificó contra el paquete instalado (`@whop/checkout@0.6.0`, leído su `.d.ts` real):**
  1. El componente se importa de **`@whop/checkout/react`**, no de `@whop/react/checkout` (ese es
     otro paquete que no está instalado). Los tipos auxiliares (`WhopCheckoutState`,
     `WhopCheckoutPaymentError`, etc.) están en `@whop/checkout/util`.
  2. `WhopCheckoutEmbed` acepta **o** `planId` **o** `sessionId`, nunca los dos juntos: son una unión
     de tipos exclusiva (`{planId: string} | {sessionId: string}`), no ambos simultáneos como sugiere
     la tabla de §6 de esta task ("planId es requerido igual aunque pases sessionId"). Se usa
     `sessionId` solo (la checkout configuration ya tiene el plan atado del lado de Whop).
  3. No existe una prop `redirectUrl` usable: está tipada `never` y marcada `@deprecated`. Se usa
     `returnUrl` si hace falta redirigir tras un flujo de autorización — acá no se usa ninguna, porque
     `skipRedirect` + `onComplete` + redirect manual del server alcanza.
  4. `onComplete` es una unión de dos firmas según el modo de la checkout configuration:
     `mode: 'setup'` → `(session_id, setup_intent_id, result)`; `mode: 'payment'` → `(plan_id,
     receipt_id, result)`. Como `crearCheckoutConfiguration` de `lib/whop.ts` siempre crea `mode:
     'payment'`, el callback en runtime SIEMPRE llega con la segunda firma. Se castea explícitamente
     (`as never` en el tipo del prop) en vez de manejar en runtime un caso que nunca ocurre.
- **Bloquea:** no, ya está resuelto y verificado con una llamada real a `crearCheckoutConfiguration`
  contra producción (ver P-11): la sesión se creó (`ch_...`) y el componente compila con `tsc
  --noEmit` limpio.
- **Resolución:** cerrada.

### P-13 — `url_exito`/cobro en modo recuperación cuando la orden es de otra página (T03 §7)
- **Task:** T03
- **Sección del plan:** §6 (la URL de recuperación es contrato) / T03 §7
- **Qué faltaba resolver:** la task dice "en este modo, `url_exito` es la de la página del upsell que
  se está recuperando, no la del front", pero `orden.pagina_id` (columna fija de la fila) apunta
  siempre a la página donde se CREÓ la orden (normalmente el front). No hay en el esquema una forma de
  saber "qué página se está recuperando ahora" a partir solo de `ordenId` — ese dato solo lo tiene la
  URL actual (el slug de `/pagos/<slug>?ot=&r=1`).
- **Cómo se resolvió:** `POST /api/checkout/reclamar` acepta un campo opcional
  `slugPaginaActual` (solo se manda en modo recuperación). Si viene y resuelve a una página activa,
  el cobro se registra contra ESA página (no `orden.pagina_id`) y `url_exito` se lee de ahí. Un
  slug inválido cae al comportamiento normal (usa `orden.pagina_id`) en vez de romper un claim que
  por lo demás es válido. `POST /api/checkout/sesion` recibe un `ordenIdRecuperacion` análogo: en
  vez de crear una orden nueva, reusa la existente y solo crea una checkout configuration nueva
  atada al plan de la página **actual** (`body.slug`), tal como exige D3.
- **Por qué no se tocó `lib/cobros.ts`:** `registrarCobroDelFront(orden, pago)` usa
  `orden.pagina_id` internamente y es de T01 (no se edita). Se le pasa un objeto `Orden` con
  `pagina_id` sobrescrito al valor efectivo (`{ ...orden, pagina_id: paginaIdEfectiva }`) en vez de
  pedir una función nueva — cumple el contrato exacto de la función sin cambiar su firma.
- **Verificado:** con el plan real del front (`plan_hgNXAvG16M9ix`, ver más abajo por qué no con un
  plan de upsell), `POST /api/checkout/sesion` con `ordenIdRecuperacion` devuelve el mismo `ordenId`
  y el mismo `token`, con un `sessionId` (checkout configuration) nuevo, y el conteo de filas de
  `ordenes` no cambia.
- **Bloquea:** no.
- **Resolución:** cerrada para el circuito; sin probar contra un plan de upsell real por P-02
  (no existen todavía).

### P-14 — Distinguir "receiptId inexistente en Whop" de "pago aún no confirmado" en el claim (T03)
- **Task:** T03
- **Sección del plan:** T03 §4 regla 2 / T03 §9 punto 6
- **Qué pasó:** la regla 2 de §4 pide que `{ ok: false }` viaje con 200 (no 4xx) para no asustar a un
  comprador que pagó bien pero cuyo pago todavía no está confirmado. Pero el punto 6 de la
  verificación (§9) pide que un `receiptId` ajeno o inexistente NUNCA devuelva 200. Un primer intento
  trataba cualquier error de `obtenerPago()` (incluido un 404 "este receipt no existe") como
  `{ok:false}` 200, lo cual fallaba la verificación 6.
- **Cómo se resolvió:** se distingue por el `status` del `WhopError`: un 404 real de Whop (el
  `receiptId` no existe en absoluto) nunca puede pertenecer a la orden, así que se responde 404
  propio. Solo los errores transitorios (timeout, 5xx, red) caen en el `{ok:false}` 200 silencioso,
  porque ahí el pago puede ser real y la falla es nuestra, no del request.
- **Verificado:** `curl` con un `receiptId` que no existe en Whop → 404. Un `receiptId` real pero de
  otra orden (metadata/checkout_configuration_id no matchean) → 403.
- **Bloquea:** no, ya está resuelto.
- **Resolución:** cerrada.

### P-15 — Dos `next dev` sobre el mismo repo corrompen `.next/` (nota operativa, no de código)
- **Task:** ninguna (nota para quien coordine el trabajo en paralelo)
- **Qué se observó:** durante la verificación de T03 se detectó un `next dev -p 3011` de otro agente
  corriendo SOBRE EL MISMO REPO (`checkout-kashhhpay`, no una copia aparte) al mismo tiempo que el
  `next dev -p 3012` de T03. Los dos procesos comparten y pisan el mismo directorio `.next/`: una
  petición en 3012 devolvió `Cannot find module '.next/server/app/pagos/[slug]/page.js'` (500) justo
  después de que el otro proceso recompilara. No fue un bug de este task — la misma query SQL
  ejecutada a mano devolvía la fila correcta — sino una colisión de builds de dev concurrentes.
  Matar y reiniciar el proceso propio (sin tocar el ajeno) lo resolvió.
- **Lo que esto implica para el resto de las tasks (T02, T04, T05) todavía corriendo en paralelo:**
  la instrucción de "no correr `next build`" no alcanza si dos agentes corren `next dev` sobre el
  MISMO checkout del repo: ambos comparten `.next/` igual. Si un agente ve errores `MODULE_NOT_FOUND`
  o 500 sin excepción propia en su código, vale la pena verificar con `ps aux | grep next` si hay
  otro `next dev` corriendo sobre el mismo path antes de asumir que el bug es del código.
- **Bloquea:** no bloqueó esta task (se pudo aislar y verificar). Se anota para que no se pierda
  tiempo repitiendo el diagnóstico.
- **Resolución:** no aplica una resolución de código; es una nota operativa.
- **Actualización T04 (2026-09-10):** confirmado en la práctica. La verificación 7 (los cinco POST
  concurrentes) se corrió con `whop_member_id='mber_FALSO'` y `whop_payment_method_id='payt_FALSO'`
  a propósito — Whop rechaza el cobro con un 4xx determinado (dato inválido, no un decline real), así
  que cae en la rama "cualquier otro 4xx → fallido" de `manejarErrorWhop` y no llega a generar un
  `whop_payment_id`. Lo que se verificó con esto: que el INSERT con `ON CONFLICT` corre antes que la
  llamada a Whop y que solo hay una fila en `cobros` para los 5 requests concurrentes. Lo que **no**
  se pudo verificar, por falta de sandbox: que un `insufficient_funds` real caiga en `sin_fondos`, que
  un `authentication_required` real lleve a `requiere_tarjeta`, y que un 409/5xx real de Whop dispare
  el camino de `procesando` sin que el cobro se duplique en el dashboard de Whop (los tests unitarios
  sí prueban esa lógica con un `WhopError` simulado — ver `T04`, sección de tests que quedaron
  pendientes de escribir contra la tabla de la sección 4 del task).

### P-16 — La forma exacta del body 409 `sin_metodo_guardado`
<!-- T04 la anotó como P-12, que T03 ya había usado en paralelo. Renumerada
     por el orquestador: dos agentes de la misma ola no pueden coordinar el
     próximo número libre. -->
- **Task:** T04
- **Sección del plan:** §5 (contrato de la API) dice literalmente
  `409 { error: 'sin_metodo_guardado' }`. La sección 4 del propio `T04-cobro-one-click.md` pide que
  ese 409 venga "con `pedirTarjeta: true` y un `sessionIdRecuperacion` recién creado" — dos campos que
  §5 no menciona.
- **Qué se decidió:** el body del 409 lleva `error: 'sin_metodo_guardado'` **más** los campos de
  `RespuestaCobro` (`cobroId: null`, `estado: 'requiere_tarjeta'`, `siguienteUrl: null`, `mensaje`,
  `pedirTarjeta: true`, `sessionIdRecuperacion`). Es aditivo sobre la forma congelada de §5: agregar
  campos es seguro según la regla de `RespuestaCobro` ("agregarle un campo es seguro y sacarle uno
  rompe funnels ya publicados"), así que un funnel que solo mira `error === 'sin_metodo_guardado'`
  sigue funcionando igual, y el `loader.js` puede usar `sessionIdRecuperacion` sin que haga falta un
  segundo request.
- **Bloquea:** no.
- **Resolución:** cerrada, implementada así en `app/api/upsell/cobrar/route.ts`.
