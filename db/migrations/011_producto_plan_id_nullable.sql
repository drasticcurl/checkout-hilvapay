-- ─────────────────────────────────────────────────────────────────────────────
-- 011 — `productos.whop_plan_id` y `productos.precio` pasan a ser nullable
--
-- Encontrado ejecutando T02 de `panel-catalogo-funnels`: `crearProductoConPlan`
-- (T01, §4 del plan) inserta un producto "padre" sin ningún `whop_plan_id` ni
-- `precio` propios — el plan y el precio reales viven en `producto_planes`, una
-- fila hija. Pero la 001 deja las dos como `not null`, así que ese INSERT
-- fallaba siempre: primero con "null value in column whop_plan_id", y una vez
-- corregida esa, con el mismo error sobre `precio` — confirmado reproduciendo
-- el alta real contra una base scratch con las 10 migraciones previas
-- aplicadas.
--
-- D2 del plan ya decía que estas columnas NO se borran (quedan muertas hasta
-- una migración futura que confirme que nada las lee) — lo que faltó decir ahí
-- es que "columna muerta" incluye "ya no puede exigir un valor", porque el
-- flujo de alta nuevo no tiene ningún valor legítimo que darles.
--
-- ADITIVA: no se pierde ningún dato. Los productos existentes conservan su
-- `whop_plan_id`/`precio` de siempre (migración 010 no los tocó). Solo se
-- relaja la restricción para que un producto NUEVO (creado después de este
-- módulo) pueda no tenerlos.
--
-- El índice único `productos_whop_plan_idx` se mantiene sin cambios: un índice
-- único de Postgres no cuenta los NULL como duplicados entre sí (dos filas con
-- `whop_plan_id is null` no violan la unicidad), así que múltiples productos
-- "padre" sin plan propio pueden coexistir sin chocar contra ese índice.
-- Verificado: dos INSERT con `whop_plan_id = null` en la misma corrida, cero
-- error de unicidad.
-- ─────────────────────────────────────────────────────────────────────────────

alter table productos
  alter column whop_plan_id drop not null,
  alter column precio drop not null;
