-- ─────────────────────────────────────────────────────────────────────────────
-- 002 — Interruptor de emails, en la base
--
-- Por qué una tabla y no un env var: cambiar un env var obliga a redeployar, y
-- eso es exactamente lo que NO querés hacer cuando necesitás frenar un envío
-- que está saliendo mal a mitad del día. El interruptor tiene que apagarse sin
-- tocar Vercel. Es D14 del plan: todo lo que se pueda apagar sin redeploy, va
-- en la base.
--
-- Aditiva: no toca ninguna tabla de 001_init.sql. `create table if not exists`
-- y el insert de la fila única son idempotentes, así correr esta migración dos
-- veces no falla ni duplica nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tabla de una sola fila. No hace falta más: hoy el único interruptor es el de
-- emails, y si aparece otro (por ejemplo, apagar el drenado al panel sin tocar
-- el cron) se agrega como columna nueva de esta misma fila, no como tabla
-- nueva — un solo lugar para ver "qué está prendido" en todo el módulo.
create table if not exists config (
  id             int primary key default 1,

  -- Arranca en false a propósito (D14 del plan, y la regla del task T05): el
  -- módulo nace apagado y encenderlo es una acción explícita desde el panel,
  -- no un efecto secundario de correr una migración.
  emails_activos boolean not null default false,

  updated_at     timestamptz not null default now(),

  -- Fuerza que haya como máximo una fila. Si algún día hace falta más de una
  -- config (por ejemplo, por ambiente), esto se revisita; hoy simplifica todo
  -- el código que lee el interruptor: no hay que decidir CUÁL fila leer.
  constraint config_singleton check (id = 1)
);

-- La fila tiene que existir siempre para que un `select emails_activos from
-- config` nunca vuelva vacío y el caller tenga que decidir un default en el
-- código (que es exactamente el tipo de decisión que este archivo existe para
-- evitar). `on conflict do nothing` la deja intacta si ya estaba insertada.
insert into config (id, emails_activos) values (1, false)
  on conflict (id) do nothing;
