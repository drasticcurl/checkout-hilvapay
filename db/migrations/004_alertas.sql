-- ─────────────────────────────────────────────────────────────────────────────
-- 004 — Alertas por Telegram y reconciliación
--
-- Tres piezas, todas para el mismo problema: hasta ahora el módulo escribía
-- correctamente todo lo que salía mal (`whop_eventos.error`,
-- `salidas.ultimo_error`, `cobros.status`, `disputa_at`) y NADIE lo leía nunca.
-- El modo de falla del sistema era "te enterás cuando el comprador reclama".
--
--   1. `destinatarios_alerta` — a qué chats de Telegram se avisa.
--   2. `alertas` — qué se avisó y cuándo, para no mandar la misma alerta cada
--      15 minutos hasta que alguien silencie el bot.
--   3. `cobros.revisado_at` — la marca del barrido de reconciliación, para que
--      recorra los cobros en round-robin y no relea siempre los mismos.
--
-- ADITIVA. No borra ni cambia el tipo de ninguna columna de 001/002/003.
-- Idempotente: `if not exists` en todo, y correrla dos veces no duplica nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. A quién se le avisa ───────────────────────────────────────────────────

-- Los chats de Telegram que reciben las alertas. Una fila por persona.
--
-- Por qué en la base y no en un env var con una lista de ids: agregar a alguien
-- al equipo no puede requerir un redeploy, y el auto-registro por el bot
-- (`POST /api/telegram/webhook`) necesita poder escribir la fila solo.
--
-- OJO: el chat del dueño NO vive acá, va en `TELEGRAM_CHAT_ID_ADMIN`. Es a
-- propósito: si el único destinatario fuera una fila de esta tabla, un DELETE
-- desde el panel (o una tabla vacía en un deploy nuevo) dejaría el sistema sin
-- nadie a quien avisarle, justo el día que hace falta. El env var es el piso que
-- siempre recibe.
create table if not exists destinatarios_alerta (
  id          uuid primary key default gen_random_uuid(),

  -- Para saber a quién se le está mandando cuando la lista crezca. No lo
  -- provee Telegram: lo escribe quien da el alta, o el propio bot con el
  -- nombre de la cuenta que mandó /alta.
  nombre      text,

  -- El chat_id de Telegram. `text` y no `bigint` aunque Telegram lo mande como
  -- número: los ids de grupo son negativos y los de canal tienen 13 dígitos con
  -- prefijo -100, y en JSON pasan por `Number` sin garantía de precisión. Como
  -- acá solo se interpola en una URL, el string es la forma correcta y no hay
  -- ninguna operación aritmética que lo necesite como número.
  chat_id     text not null,

  -- Arranca ACTIVO, al contrario del resto del módulo (D14: todo nace apagado).
  -- La razón: un destinatario apagado no cobra nada ni le muestra nada a nadie,
  -- solo deja de recibir avisos — y quien se acaba de registrar en el bot espera
  -- que funcione. El riesgo del default se invierte: acá el estado peligroso es
  -- el silencio.
  activo      boolean not null default true,

  -- Cuándo se pudo mandar algo por última vez a este chat, y el último error.
  -- Sirve para el caso más silencioso de todos: alguien bloquea el bot y las
  -- alertas dejan de llegar sin que nada más lo indique.
  ultimo_ok_at    timestamptz,
  ultimo_error    text,

  created_at  timestamptz not null default now()
);

-- Un chat, una fila. El auto-registro por el bot manda /alta cada vez que
-- alguien lo reintenta, y sin este índice cada reintento agregaría un
-- destinatario más: la misma persona recibiría cinco copias de cada alerta.
create unique index if not exists destinatarios_alerta_chat_idx
  on destinatarios_alerta (chat_id);

-- ── 2. Qué se avisó ya ───────────────────────────────────────────────────────

-- El registro de alertas mandadas, para deduplicar.
--
-- Sin esto, el vigilante corriendo cada 15 minutos manda la MISMA alerta 96
-- veces por día mientras el problema siga abierto, y a la tercera la persona
-- silencia el bot — con lo cual el sistema queda peor que sin alertas, porque
-- ahora hay un canal en el que nadie confía.
--
-- La `clave` es semántica, no un uuid: la arma el código
-- (`lib/alertas.ts`) como `cola_quemada`, `webhook_mudo`,
-- `disputa:<cobro_id>`, `venta:<cobro_id>`. Que sea la PK es lo que hace que el
-- upsert de abajo sea la operación natural.
create table if not exists alertas (
  clave           text primary key,

  -- La primera vez que se detectó. No se toca en los reenvíos: es el dato con
  -- el que se contesta "¿desde cuándo está pasando esto?".
  primer_envio_at timestamptz not null default now(),

  ultimo_envio_at timestamptz not null default now(),

  -- Cuántas veces se mandó. Un contador alto en `cola_quemada` dice que el
  -- problema lleva días abierto, no que el vigilante esté ruidoso.
  veces           int not null default 1,

  -- El texto de la última vez. Se guarda para poder ver desde `psql` qué decía
  -- una alerta sin tener que abrir Telegram.
  ultimo_detalle  text
);

create index if not exists alertas_ultimo_envio_idx on alertas (ultimo_envio_at desc);

-- ── 3. La marca del barrido de reconciliación ────────────────────────────────

alter table cobros
  -- Cuándo el cron de reconciliación le preguntó por última vez a Whop por este
  -- cobro.
  --
  -- Existe para que el barrido sea round-robin y acotado: sin esta columna, un
  -- cron que toma "los 20 cobros pagados más viejos sin reembolso" le pregunta
  -- por los MISMOS 20 para siempre y nunca llega al 21. Con `order by
  -- revisado_at nulls first` cada corrida avanza sobre los que hace más tiempo
  -- que no se miran.
  --
  -- No es `updated_at`: mirar un cobro y no encontrar ningún cambio no es una
  -- actualización del cobro, y usar `updated_at` para esto haría que cada
  -- barrido pareciera haber modificado todo.
  add column if not exists revisado_at timestamptz;

-- Parcial y solo sobre lo que el barrido busca: los cobros que pueden cambiar de
-- estado del lado de Whop. Un cobro `fallido` de hace tres meses no se vuelve a
-- consultar nunca, así que no tiene por qué ocupar lugar en el índice.
create index if not exists cobros_revisado_idx
  on cobros (revisado_at nulls first)
  where status in ('creando', 'procesando') or (status = 'pagado' and reembolsado_at is null);
