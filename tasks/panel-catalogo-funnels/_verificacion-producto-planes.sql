-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación de `producto_planes` y la migración 010.
--
-- Ejecutable de punta a punta contra una base con las 9 migraciones previas ya
-- aplicadas (NUNCA contra producción: crear una scratch antes, ver comando al
-- final de este comentario). Corre dentro de una transacción que se descarta:
-- no deja datos, así que se puede correr contra la base local de desarrollo sin
-- ensuciarla.
--
-- Ya corrido una vez el 2026-09-13 contra `checkout_scratch3`: los resultados
-- reales fueron los que este archivo escribe como esperados abajo.
--
--   dropdb --if-exists checkout_scratch_verif && createdb checkout_scratch_verif
--   for f in db/migrations/*.sql; do psql -d checkout_scratch_verif -f "$f"; done
--   psql -d checkout_scratch_verif -f tasks/panel-catalogo-funnels/_schema-010-producto-planes.sql
--   psql -d checkout_scratch_verif -f tasks/panel-catalogo-funnels/_verificacion-producto-planes.sql
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
BEGIN;

\echo '═══ 1. La tabla y sus índices existen con la forma esperada ═══'
\echo '(asume que _schema-010-producto-planes.sql ya corrió sobre esta base)'
\echo 'esperado exactamente, en algún orden:'
\echo '  producto_planes_pkey'
\echo '  producto_planes_producto_idx'
\echo '  producto_planes_un_default_idx'
\echo '  producto_planes_whop_plan_idx'
select indexname from pg_indexes where tablename = 'producto_planes' order by indexname;

\echo ''
\echo '═══ 2. Dos planes con el mismo whop_product_id se agrupan bajo UN producto padre ═══'
\echo 'por qué importa: es el bug que reportó el usuario — sin esto, "Acelerador 7X" a'
\echo '27 USD y su downsell a 17 USD viven como dos productos sin relación entre sí'

insert into productos (id, nombre, whop_plan_id, whop_product_id, precio, moneda, activo, created_at)
values
  ('c0000000-0000-0000-0000-000000000001', 'Acelerador 7X', 'plan_verif_completo', 'prod_verif_mismo', 27.00, 'usd', true, now() - interval '1 hour'),
  ('c0000000-0000-0000-0000-000000000002', 'Acelerador 7X (downsell)', 'plan_verif_downsell', 'prod_verif_mismo', 17.00, 'usd', true, now());

-- La misma lógica de agrupación de _schema-010, aislada para poder verificarla
-- sin repetir el CREATE TABLE (que ya corrió antes de este archivo).
with grupos as (
  select id, coalesce(whop_product_id, 'sin-agrupar-' || id::text) as clave_grupo,
         row_number() over (partition by coalesce(whop_product_id, 'sin-agrupar-' || id::text) order by created_at asc) as posicion
  from productos where whop_product_id = 'prod_verif_mismo'
),
ganadores as (select clave_grupo, id as producto_ganador_id from grupos where posicion = 1)
insert into producto_planes (producto_id, whop_plan_id, etiqueta, precio, moneda, es_default, activo)
select gan.producto_ganador_id, pr.whop_plan_id,
       case when g.posicion = 1 then 'Precio completo' else 'Variante ' || g.posicion end,
       pr.precio, pr.moneda, g.posicion = 1, pr.activo
from productos pr join grupos g on g.id = pr.id join ganadores gan on gan.clave_grupo = g.clave_grupo;

\echo 'esperado exactamente: 1 (las dos variantes comparten producto_id)'
select count(distinct producto_id) from producto_planes
 where whop_plan_id in ('plan_verif_completo', 'plan_verif_downsell');

\echo 'esperado exactamente: 27.00 | Precio completo | t  y  17.00 | Variante 2 | f'
select precio, etiqueta, es_default from producto_planes
 where whop_plan_id in ('plan_verif_completo', 'plan_verif_downsell')
 order by es_default desc;

\echo ''
\echo '═══ 3. Un producto no puede tener dos variantes es_default a la vez ═══'
insert into productos (id, nombre, whop_plan_id, precio, moneda, activo)
values ('c0000000-0000-0000-0000-000000000003', 'Producto de prueba', 'plan_verif_x', 9.90, 'usd', true);

insert into producto_planes (producto_id, whop_plan_id, precio, es_default)
values ('c0000000-0000-0000-0000-000000000003', 'plan_verif_x1', 9.90, true);

\echo 'el siguiente INSERT tiene que fallar. esperado: ERROR duplicate key value violates unique constraint "producto_planes_un_default_idx"'
insert into producto_planes (producto_id, whop_plan_id, precio, es_default)
values ('c0000000-0000-0000-0000-000000000003', 'plan_verif_x2', 5.00, true);

ROLLBACK;
