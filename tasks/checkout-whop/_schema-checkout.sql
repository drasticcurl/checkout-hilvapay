-- ESQUEMA CANÓNICO — YA EJECUTADO.
--
-- Corrido dos veces contra PostgreSQL 16.14 en una base scratch
-- (checkout_scratch), exit 0 las dos veces: es idempotente.
-- Las 11 afirmaciones de _verificacion-checkout.sql dieron el resultado
-- esperado contra este esquema.
--
-- Vive en el repo como db/migrations/001_init.sql. Esta copia es la
-- referencia de la carpeta de tasks: si los dos difieren, el del repo es
-- el que corre y esta copia hay que actualizarla.

-- ─────────────────────────────────────────────────────────────────────────────
-- 001 — Esquema inicial del checkout propio
--
-- Modelo mental: el panel define PRODUCTOS (lo que se vende de verdad) y
-- PÁGINAS (los links de pago, /pagos/<slug>). Un comprador que entra a un link
-- genera una ORDEN, y cada intento de cobrarle algo es un COBRO.
--
-- El nombre y el precio que ve el comprador viven acá, no en Whop: en Whop el
-- plan puede llamarse distinto (nombre "soft"). Lo único que Whop define es
-- cuánto se cobra realmente, y por eso el panel compara los dos números.
-- ─────────────────────────────────────────────────────────────────────────────

-- gen_random_uuid() es nativa desde Postgres 13, pero pgcrypto la provee en
-- versiones anteriores y la extensión es idempotente: más barato pedirla que
-- descubrir en el deploy que la base es vieja.
create extension if not exists pgcrypto;

-- ── Catálogo ─────────────────────────────────────────────────────────────────

create table if not exists productos (
  id                uuid primary key default gen_random_uuid(),

  -- Nombre real, el que ve el comprador en el checkout y en el email.
  nombre            text not null,

  -- El plan de Whop que se cobra. Es lo único que determina el importe real.
  whop_plan_id      text not null,

  -- El "product" del dashboard de Whop (en la API se llama `access_pass`).
  -- Se guarda para poder linkear al dashboard desde el panel.
  whop_product_id   text,

  -- Cómo se llama el plan del lado de Whop. Se cachea para que el panel pueda
  -- mostrar los dos nombres juntos y quede claro que la diferencia es a
  -- propósito y no un producto mal asociado.
  whop_nombre_soft  text,

  -- Precio que se MUESTRA. Tiene que coincidir con el `initial_price` del plan;
  -- el panel avisa cuando no coincide. No se usa para cobrar.
  precio            numeric(10,2) not null,
  moneda            text not null default 'usd',

  -- Precio tachado ("valor de referencia $250"). Solo display.
  precio_anclaje    numeric(10,2),

  imagen_url        text,
  descripcion       text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Un plan de Whop se asocia a un solo producto. Si dos productos apuntaran al
-- mismo plan, el panel mostraría dos precios distintos para un único importe
-- real y no habría forma de saber cuál es el correcto.
create unique index if not exists productos_whop_plan_idx on productos (whop_plan_id);

create table if not exists paginas (
  id            uuid primary key default gen_random_uuid(),

  -- El último segmento del link: /pagos/aguadearroz1
  slug          text not null,

  producto_id   uuid not null references productos(id) on delete restrict,

  -- 'front'  → el link se abre en el browser y muestra el checkout completo.
  -- 'upsell' → normalmente no se visita: el botón del funnel dispara el cobro
  --            one-click contra la API. La página existe igual, para el caso en
  --            que el cobro falle y haya que pedir la tarjeta de nuevo.
  tipo          text not null check (tipo in ('front', 'upsell')),

  -- A dónde se manda al comprador cuando el cobro sale bien. Para el front es
  -- la página del primer upsell del funnel (en el dominio del funnel, no acá).
  url_exito     text,

  -- A dónde se lo manda cuando el cobro falla y no tiene sentido insistir.
  url_rechazo   text,

  -- Textos, timer, badges. Todo lo visual y editable sin deploy.
  config        jsonb not null default '{}'::jsonb,

  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists paginas_slug_idx on paginas (slug);
create index if not exists paginas_producto_idx on paginas (producto_id);

-- Dominios de funnels autorizados a disparar cobros one-click. El endpoint de
-- cobro vive en pay.hilvanapp.com y lo llama JS corriendo en el dominio del
-- funnel, así que es cross-origin: sin esta lista habría que abrir CORS a `*`,
-- y cualquier página del mundo podría intentar cobrarle a una orden ajena si le
-- roba el token.
create table if not exists origenes (
  id          uuid primary key default gen_random_uuid(),
  origen      text not null,          -- 'https://funnel.com', sin barra final
  nombre      text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists origenes_origen_idx on origenes (origen);

-- ── Compradores ──────────────────────────────────────────────────────────────

create table if not exists ordenes (
  id                      uuid primary key default gen_random_uuid(),

  -- Página por la que entró. Sirve para saber de qué funnel viene.
  pagina_id               uuid not null references paginas(id),

  email                   text,
  nombre                  text,

  -- Token público que viaja en la URL hacia las páginas de upsell del funnel,
  -- igual que el `?ks=` de KashPay. Es lo que le permite al botón del funnel
  -- cobrar sin cookies (los dominios son distintos, la cookie no se comparte).
  --
  -- Habilita cobrar contra la tarjeta guardada, así que: aleatorio, con
  -- vencimiento corto, y limitado a las páginas del funnel. La guarda real
  -- contra el abuso no es el token sino el índice único de `cobros`: aunque
  -- alguien lo robe, no puede cobrar dos veces la misma página.
  token                   text not null,
  token_expira_at         timestamptz not null,

  -- Lo que devuelve Whop cuando se paga el front. Sin estos dos no hay
  -- one-click posible.
  whop_member_id          text,
  whop_payment_method_id  text,
  whop_user_id            text,

  -- La checkout configuration que se creó para esta orden. Es el vínculo
  -- confiable pago↔orden: el objeto Payment de Whop trae
  -- `checkout_configuration_id` como campo propio.
  whop_checkout_config_id text,

  -- false cuando el comprador pagó con un método que no se puede guardar. Esa
  -- persona no ve el botón one-click: se le muestra un checkout normal.
  metodo_guardado         boolean not null default false,

  -- Atribución. Llega por querystring desde el funnel para que la venta se
  -- pueda pegar a la sesión correcta en el dashboard-admin, cuyo /api/ingest
  -- exige sessionId y visitorId como UUID.
  session_id              uuid,
  visitor_id              uuid,
  utms                    jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists ordenes_token_idx on ordenes (token);
create unique index if not exists ordenes_checkout_config_idx
  on ordenes (whop_checkout_config_id)
  where whop_checkout_config_id is not null;
create index if not exists ordenes_email_idx on ordenes (email);
create index if not exists ordenes_created_idx on ordenes (created_at desc);

-- ── Cobros ───────────────────────────────────────────────────────────────────

create table if not exists cobros (
  id               uuid primary key default gen_random_uuid(),
  orden_id         uuid not null references ordenes(id) on delete cascade,
  pagina_id        uuid not null references paginas(id),
  producto_id      uuid not null references productos(id),

  -- Se copia del producto al momento del cobro. Si mañana se reasocia el
  -- producto a otro plan, el histórico tiene que seguir diciendo qué se cobró.
  whop_plan_id     text not null,

  whop_payment_id  text,

  -- creando          → fila creada, todavía no se llamó a Whop
  -- procesando       → Whop aceptó el pago y lo está procesando (es asíncrono)
  -- pagado           → entró la plata
  -- fallido          → rebotó y no tiene sentido insistir
  -- requiere_tarjeta → rebotó pidiendo autenticación o con la tarjeta
  --                    inválida: hay que mostrarle el embed para que ponga los
  --                    datos una vez. NO existe un substatus de Whop para
  --                    esto; se deduce del decline_code (ver lib/estado-pago).
  status           text not null default 'creando'
    check (status in ('creando', 'procesando', 'pagado', 'fallido', 'requiere_tarjeta')),

  decline_code     text,
  failure_message  text,

  -- La clave que se le manda a Whop en el header Idempotency-Key. Determinística
  -- por diseño: `<orden_id>:<pagina_id>`. Whop guarda la respuesta 24 h y
  -- replaya la original en vez de volver a cobrar.
  idempotency_key  text not null,

  monto            numeric(10,2),
  moneda           text,

  -- 'front'  → salió del embed, lo pagó la persona a mano
  -- 'upsell' → lo disparó el botón contra la tarjeta guardada
  origen           text not null default 'upsell' check (origen in ('front', 'upsell')),

  -- Se llenan por webhook, después del cobro. Un cobro reembolsado sigue en
  -- 'pagado': la plata entró y después salió, y son dos hechos distintos.
  -- Mezclarlos en `status` haría que un reembolso parezca un cobro que falló.
  reembolsado_at   timestamptz,
  disputa_at       timestamptz,

  -- Entrega. Cuándo se le mandó el email de acceso por este cobro.
  email_enviado_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- LA GUARDA MAESTRA CONTRA EL DOBLE COBRO. Un solo cobro por orden y por link
-- de pago. Si el comprador hace doble click, el segundo INSERT choca contra
-- este índice y el endpoint devuelve el cobro que ya existía en vez de crear
-- otro. Es más confiable que la idempotencia de Whop porque no depende de la
-- red: si el segundo request nunca llega a Whop, no hay nada que replayar.
create unique index if not exists cobros_orden_pagina_idx on cobros (orden_id, pagina_id);

create unique index if not exists cobros_idempotency_idx on cobros (idempotency_key);
create unique index if not exists cobros_whop_payment_idx
  on cobros (whop_payment_id)
  where whop_payment_id is not null;
create index if not exists cobros_status_idx on cobros (status);
create index if not exists cobros_orden_idx on cobros (orden_id);
create index if not exists cobros_created_idx on cobros (created_at desc);

-- ── Webhooks entrantes ───────────────────────────────────────────────────────

-- Whop reenvía el mismo evento si el handler tarda o responde mal, y el
-- dashboard tiene un botón "Send event" que dispara repetidos a mano. La PK es
-- el `webhook-id` del header: si el INSERT choca, el evento ya se procesó.
create table if not exists whop_eventos (
  webhook_id   text primary key,
  tipo         text not null,
  payload      jsonb not null,
  procesado_at timestamptz,
  error        text,
  recibido_at  timestamptz not null default now()
);

create index if not exists whop_eventos_recibido_idx on whop_eventos (recibido_at desc);

-- ── Salida hacia el dashboard-admin ──────────────────────────────────────────

-- Cola de eventos a mandar al panel. No se postea desde el handler del webhook
-- porque Whop reintenta si tardamos: el handler solo escribe acá y responde
-- 200, y un cron drena la cola. Si el panel está caído, la venta no se pierde.
create table if not exists salidas (
  id                  uuid primary key default gen_random_uuid(),
  cobro_id            uuid references cobros(id) on delete cascade,
  destino             text not null default 'panel',
  payload             jsonb not null,
  intentos            int not null default 0,
  ultimo_error        text,
  enviado_at          timestamptz,
  proximo_intento_at  timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists salidas_pendientes_idx
  on salidas (proximo_intento_at)
  where enviado_at is null;
