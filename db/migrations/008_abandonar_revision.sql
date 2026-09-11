-- ─────────────────────────────────────────────────────────────────────────────
-- 008 — Abandonar la revisión de un cobro que ya no se puede leer en Whop
--
-- ── El bug ──────────────────────────────────────────────────────────────────
-- `reconciliarReembolsos` recorre los cobros `pagado` de los últimos 120 días y
-- le pregunta a Whop por cada uno, para detectar un reembolso o una disputa sin
-- depender del webhook. Si la llamada falla, loguea y sigue — y después
-- `marcarRevisado` le pone la fecha, así que el cobro rota al final de la cola y
-- vuelve en algún momento.
--
-- Eso está bien para un error transitorio. Pero cuando se **cambia la cuenta de
-- Whop**, los cobros de la cuenta anterior quedan con un `whop_payment_id` que la
-- credencial nueva no puede leer: Whop devuelve `403 You are not authorized` para
-- siempre. Y como el barrido tiene un límite por corrida y ordena por
-- `revisado_at nulls first`, esos cobros vuelven cada 10 minutos, ocupan lugar en
-- el presupuesto de los cobros que sí importan, y llenan el log:
--
--   [reconciliar] cobro 2692c29a…: no se pudo revisar el reembolso
--                 (403 You are not authorized)
--
-- Medido el 2026-09-11 tras rotar de `biz_LHktpJ17c83CFt` a `biz_Me8Lbiv174brtM`:
-- cuatro cobros (`pay_8oOknbXiNnH7nP`, `pay_I7ngtVsSKrvX2a`, `pay_MMymbvsNZ1JeGP`,
-- `pay_sqFnkoDROFpz0d`) girando indefinidamente. Lo detectaron por separado la
-- lectura de los logs de PM2 y el soporte de Whop mirando sus propios api_logs.
--
-- ── Por qué una columna y no un filtro ──────────────────────────────────────
-- No hay de dónde deducirlo: `cobros` no guarda a qué company pertenece el pago,
-- y agregarla obligaría a rellenarla para todo el histórico. Lo que sí se puede
-- registrar es el hecho observado — "Whop dijo que este pago no es mío" — y dejar
-- de preguntar.
--
-- ── NO es un estado del cobro ───────────────────────────────────────────────
-- Un cobro abandonado sigue `pagado`, sigue contando como venta y sigue en el
-- panel. Lo único que cambia es que la reconciliación deja de mirarlo. Por eso va
-- en columnas propias y no en `status`: confundirlo con un estado del dinero sería
-- mucho peor que el bug que arregla.
--
-- ── Cómo se revierte ────────────────────────────────────────────────────────
-- Si se vuelve a la cuenta anterior, estos cobros vuelven a ser legibles. Para que
-- la reconciliación los retome:
--
--   update cobros set revision_abandonada_at = null,
--                     revision_abandonada_motivo = null;
--
-- Aditiva e idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

alter table cobros
  -- Cuándo se dejó de revisar. NULL = se sigue revisando normalmente, que es el
  -- estado de todas las filas existentes: la migración no cambia nada sola.
  add column if not exists revision_abandonada_at timestamptz,

  -- El status y el mensaje que devolvió Whop, para poder distinguir "es de otra
  -- cuenta" de "el pago se borró" sin volver a llamar. Es el dato que explica la
  -- columna de al lado, y sin él un cobro abandonado es un misterio.
  add column if not exists revision_abandonada_motivo text;

-- El barrido de reembolsos filtra por esta columna, así que conviene que el
-- índice parcial existente no se le escape. Solo las filas que se siguen
-- revisando entran al índice: las abandonadas no se consultan nunca más.
create index if not exists cobros_revision_pendiente_idx
  on cobros (revisado_at nulls first, created_at desc)
  where revision_abandonada_at is null;
