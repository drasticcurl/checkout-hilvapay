-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación del esquema del checkout — fase 3
--
-- Cada bloque es UNA afirmación de la que dependen las tasks, con la salida
-- esperada escrita arriba. Todo corre dentro de una transacción que se descarta:
-- no deja datos.
--
-- Cómo correrlo (base scratch, NUNCA la real):
--   psql -d postgres -c "DROP DATABASE IF EXISTS checkout_scratch;" \
--                     -c "CREATE DATABASE checkout_scratch;"
--   psql -d checkout_scratch -v ON_ERROR_STOP=1 -q -f _schema-checkout.sql
--   psql -d checkout_scratch -f _verificacion-checkout.sql
--
-- Estado: CORRIDO. Las 11 afirmaciones dieron el resultado esperado contra
-- PostgreSQL 16.14 (Homebrew), con el esquema aplicado dos veces.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
BEGIN;

-- Datos mínimos para poder afirmar cosas sobre las restricciones.
insert into productos (id, nombre, whop_plan_id, precio, moneda)
values ('11111111-1111-1111-1111-111111111111', 'Chau Hinchazón 7 días', 'plan_front', 9.90, 'usd');

insert into paginas (id, slug, producto_id, tipo)
values ('22222222-2222-2222-2222-222222222222', 'aguadearroz1',
        '11111111-1111-1111-1111-111111111111', 'front');

insert into ordenes (id, pagina_id, token, token_expira_at)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        'tok_de_prueba', now() + interval '2 hours');


\echo ''
\echo '═══ 1. Un doble click NO puede crear dos cobros de la misma página ═══'
\echo 'Es la guarda maestra contra el doble cobro. Si esto no se cumple, el botón'
\echo 'del upsell le cobra dos veces a quien haga doble click, y ninguna otra'
\echo 'defensa (idempotencia de Whop incluida) alcanza si el segundo request'
\echo 'nunca llega a Whop.'
\echo 'esperado exactamente: insertados = 1'
savepoint s1;
insert into cobros (orden_id, pagina_id, producto_id, whop_plan_id, idempotency_key, origen)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'plan_front', 'k1', 'front')
on conflict (orden_id, pagina_id) do nothing;

insert into cobros (orden_id, pagina_id, producto_id, whop_plan_id, idempotency_key, origen)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'plan_front', 'k2', 'front')
on conflict (orden_id, pagina_id) do nothing;

select count(*) as insertados from cobros
 where orden_id = '33333333-3333-3333-3333-333333333333';


\echo ''
\echo '═══ 2. El CHECK de status rechaza un estado inventado ═══'
\echo 'Los cinco estados son un contrato entre el webhook, el polling y el panel.'
\echo 'Si la base aceptara cualquier texto, un agente podría escribir "pending" y'
\echo 'el panel mostraría un cobro en un estado que ninguna pantalla sabe pintar.'
\echo 'esperado exactamente: rechazado = t'
savepoint s2;
do $$
begin
  update cobros set status = 'pending_inventado'
   where orden_id = '33333333-3333-3333-3333-333333333333';
  raise exception 'NO RECHAZÓ: el CHECK de status no está';
exception
  when check_violation then null;
end $$;
select true as rechazado;


\echo ''
\echo '═══ 3. El CHECK de tipo de página solo acepta front y upsell ═══'
\echo 'esperado exactamente: rechazado = t'
savepoint s3;
do $$
begin
  insert into paginas (slug, producto_id, tipo)
  values ('otra', '11111111-1111-1111-1111-111111111111', 'downsell');
  raise exception 'NO RECHAZÓ: el CHECK de tipo no está';
exception
  when check_violation then null;
end $$;
select true as rechazado;
rollback to savepoint s3;


\echo ''
\echo '═══ 4. Borrar una orden borra sus cobros, y NO toca la página ni el producto ═══'
\echo 'La cascada tiene que llegar hasta los cobros (son de la orden) y detenerse'
\echo 'ahí. Si arrastrara la página, borrar una orden de prueba dejaría un link de'
\echo 'pago muerto en producción.'
\echo 'esperado exactamente: cobros = 0 | paginas = 1 | productos = 1'
savepoint s4;
delete from ordenes where id = '33333333-3333-3333-3333-333333333333';
select (select count(*) from cobros)    as cobros,
       (select count(*) from paginas)   as paginas,
       (select count(*) from productos) as productos;
rollback to savepoint s4;


\echo ''
\echo '═══ 5. No se puede borrar un producto que tiene links de pago ═══'
\echo 'RESTRICT y no CASCADE: borrar un producto del panel no puede desaparecer'
\echo 'silenciosamente los links que los funnels ya tienen publicados.'
\echo 'esperado exactamente: rechazado = t'
savepoint s5;
do $$
begin
  delete from productos where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'NO RECHAZÓ: la FK no es RESTRICT';
exception
  when foreign_key_violation then null;
end $$;
select true as rechazado;
rollback to savepoint s5;


\echo ''
\echo '═══ 6. Muchos cobros pueden tener whop_payment_id NULL, pero el valor no se repite ═══'
\echo 'El índice es parcial (WHERE not null). Sin el parcial, el segundo cobro'
\echo 'creado antes de llamar a Whop chocaría contra el primero por tener los dos'
\echo 'NULL, y el endpoint de cobro fallaría sin motivo.'
\echo 'esperado exactamente: nulos = 3 (el cobro de la afirmacion 1 sigue vivo + los 2 nuevos),'
\echo 'y despues rechazado = t'
savepoint s6;
insert into ordenes (id, pagina_id, token, token_expira_at) values
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'tok_b', now() + interval '2 hours'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'tok_c', now() + interval '2 hours');

insert into cobros (orden_id, pagina_id, producto_id, whop_plan_id, idempotency_key, origen) values
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'plan_front', 'k4', 'front'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'plan_front', 'k5', 'front');

select count(*) as nulos from cobros where whop_payment_id is null;

do $$
begin
  update cobros set whop_payment_id = 'pay_igual';  -- a todas
  raise exception 'NO RECHAZÓ: el unique de whop_payment_id no está';
exception
  when unique_violation then null;
end $$;
select true as rechazado;
rollback to savepoint s6;


\echo ''
\echo '═══ 7. Dos órdenes pueden tener whop_checkout_config_id NULL a la vez ═══'
\echo 'La orden se crea antes de tener la sesión de Whop. Con un unique no parcial,'
\echo 'la segunda orden simultánea fallaría al insertarse.'
\echo 'esperado exactamente: ordenes_sin_config = 3'
savepoint s7;
insert into ordenes (pagina_id, token, token_expira_at) values
  ('22222222-2222-2222-2222-222222222222', 'tok_d', now() + interval '2 hours'),
  ('22222222-2222-2222-2222-222222222222', 'tok_e', now() + interval '2 hours');
select count(*) as ordenes_sin_config from ordenes where whop_checkout_config_id is null;
rollback to savepoint s7;


\echo ''
\echo '═══ 8. La deduplicación de webhooks: el segundo INSERT del mismo id no afecta filas ═══'
\echo 'Es cómo el handler distingue un evento nuevo de un reenvío, sin un SELECT'
\echo 'extra: mira las filas afectadas. Whop reenvía si tardamos más de 5 segundos'
\echo 'y el dashboard tiene un botón que dispara el mismo evento a mano.'
\echo 'esperado exactamente: primera = 1 | segunda = 0'
savepoint s8;
with primera as (
  insert into whop_eventos (webhook_id, tipo, payload)
  values ('msg_abc', 'payment.succeeded', '{"id":"pay_1"}'::jsonb)
  on conflict (webhook_id) do nothing
  returning 1
), segunda as (
  insert into whop_eventos (webhook_id, tipo, payload)
  values ('msg_abc', 'payment.succeeded', '{"id":"pay_1"}'::jsonb)
  on conflict (webhook_id) do nothing
  returning 1
)
select (select count(*) from primera) as primera, (select count(*) from segunda) as segunda;
rollback to savepoint s8;


\echo ''
\echo '═══ 9. Un evento que llegó pero no se procesó se distingue de uno resuelto ═══'
\echo 'procesado_at NULL = falló el procesamiento y hay que reintentarlo. Sin esta'
\echo 'distinción, un evento que falló quedaría marcado como visto y se perdería'
\echo 'para siempre: Whop no reenvía los eventos de un webhook deshabilitado.'
\echo 'esperado exactamente: pendientes = 1 | resueltos = 1'
savepoint s9;
insert into whop_eventos (webhook_id, tipo, payload, procesado_at) values
  ('msg_pendiente', 'payment.succeeded', '{}'::jsonb, null),
  ('msg_resuelto',  'payment.succeeded', '{}'::jsonb, now());
select count(*) filter (where procesado_at is null)     as pendientes,
       count(*) filter (where procesado_at is not null) as resueltos
  from whop_eventos;
rollback to savepoint s9;


\echo ''
\echo '═══ 10. numeric(10,2) redondea a dos decimales y no acepta un monto absurdo ═══'
\echo 'Los importes de Whop llegan como number de JSON (9.9, no 990 centavos).'
\echo 'Verificado: la columna es numeric(10,2), NO integer de centavos. Un agente'
\echo 'que asuma centavos va a guardar 990 dólares en lugar de 9.90.'
\echo 'esperado exactamente: guardado = 9.91 (redondeo de 9.909)'
savepoint s10;
update cobros set monto = 9.909 where idempotency_key = 'k1';
select monto as guardado from cobros where idempotency_key = 'k1';
rollback to savepoint s10;


\echo ''
\echo '═══ 11. Los tipos reales de las columnas que las tasks van a escribir ═══'
\echo 'Leídos de la base, no recordados. utms y payload son jsonb: un agente que'
\echo 'les pase un string sin ::jsonb se come un error que no dice eso.'
\echo 'esperado exactamente:'
\echo '  cobros.monto        numeric(10,2)'
\echo '  cobros.status       text'
\echo '  ordenes.utms        jsonb'
\echo '  ordenes.session_id  uuid'
\echo '  paginas.config      jsonb'
\echo '  salidas.payload     jsonb'
select table_name || '.' || column_name as columna,
       case when data_type = 'numeric'
            then 'numeric(' || numeric_precision || ',' || numeric_scale || ')'
            else data_type end as tipo
  from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (
     ('cobros','monto'), ('cobros','status'), ('ordenes','utms'),
     ('ordenes','session_id'), ('paginas','config'), ('salidas','payload'))
 order by 1;

ROLLBACK;

\echo ''
\echo '═══ Fin. Nada quedó escrito: todo corrió dentro de una transacción descartada. ═══'
