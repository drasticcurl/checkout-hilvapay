-- ─────────────────────────────────────────────────────────────────────────────
-- 013 — Fusión manual de "Shot Metabolico" + "Tu Shot Metabolico"
--
-- Caso puntual, confirmado por el usuario en la sesión (2026-09-14): son el
-- mismo producto real con dos precios (uno es el downsell del otro), pero
-- viven como DOS filas de `productos` porque ninguna tiene `whop_product_id`
-- — sin ese dato, `vincularPlan` (migración 010/D1) no tiene ninguna señal
-- para agruparlos solo. La fusión automática por `whop_product_id` sigue
-- intacta para cualquier producto que sí lo tenga; esto es exclusivamente
-- para el caso sin esa columna, y solo para estos dos productos puntuales —
-- no es una heurística por nombre parecido corriendo sobre toda la tabla,
-- porque dos productos que casualmente se llaman similar y NO son el mismo
-- se fusionarían mal.
--
-- El usuario fue explícito: no toca "Acelerador 7X" ni "Chau Hinchazón" (los
-- que sí usa en producción) — esta migración no los menciona en absoluto.
--
-- Ganador: 'Shot Metabolico' (el de precio completo, $27). Conserva su fila
-- de `productos` (nombre, foto, descripción, id). 'Tu Shot Metabolico' ($17,
-- el downsell) se funde como una SEGUNDA variante del ganador, con su
-- etiqueta puesta en 'Downsell' para distinguirla en el selector — antes
-- tenía 'Precio completo', que ahora sería confuso al convivir con la otra.
--
-- Mismo patrón de seguridad que la migración 012: nada se borra. El producto
-- perdedor pasa a `activo = false` (ya no es una fila que el panel deba
-- listar como producto propio) pero la fila queda — por si algo históricamente
-- le apunta por `producto_id` directo (páginas legacy sin `producto_plan_id`,
-- o el propio historial de `productos` para auditoría).
--
-- Es DATA-ONLY: no toca ningún índice ni constraint. Segura de reintentar
-- (todo el bloque está guardado con un chequeo de "¿ya se fusionó?" al
-- principio) por si el runner la corre dos veces.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  ganador_id uuid;
  perdedor_id uuid;
  ya_fusionado boolean;
begin
  select id into ganador_id from productos where nombre = 'Shot Metabolico';
  select id into perdedor_id from productos where nombre = 'Tu Shot Metabolico';

  -- Si cualquiera de los dos no existe (base distinta a la que se auditó, o
  -- la migración ya corrió y el perdedor ya no tiene ninguna variante propia
  -- que mover), no hace nada — no es un error, es "no aplica en esta base".
  if ganador_id is null or perdedor_id is null then
    raise notice '013: "Shot Metabolico" y/o "Tu Shot Metabolico" no existen en esta base — nada que fusionar.';
    return;
  end if;

  -- Idempotencia real: si el perdedor ya no tiene ninguna variante propia
  -- (porque una corrida anterior ya las movió todas al ganador), no hay
  -- nada más que hacer más que, como mucho, confirmar que sigue inactivo.
  select not exists(select 1 from producto_planes where producto_id = perdedor_id) into ya_fusionado;
  if ya_fusionado then
    raise notice '013: ya fusionado en una corrida anterior — nada que hacer.';
    return;
  end if;

  -- Mueve TODAS las variantes del perdedor al ganador. Un producto puede
  -- tener más de una variante ya (no es el caso hoy, pero la migración no
  -- asume "exactamente una"); todas pasan a ser variantes NO default del
  -- ganador — el ganador ya tiene su propia default y el índice
  -- `producto_planes_un_default_idx` no permite una segunda.
  update producto_planes
     set producto_id = ganador_id,
         es_default = false,
         -- La que traía 'Precio completo' del producto perdedor pasa a
         -- 'Downsell': es el precio más bajo de los dos y el nombre viejo
         -- sería confuso conviviendo con la variante 'Precio completo' que
         -- ya tiene el ganador.
         etiqueta = case when etiqueta = 'Precio completo' then 'Downsell' else etiqueta end,
         updated_at = now()
   where producto_id = perdedor_id;

  -- Las páginas legacy que todavía apuntaran a `producto_id` del perdedor
  -- directo (no vía `producto_plan_id`, que ya viaja con la variante movida
  -- arriba) se reapuntan también, por las dudas — no debería haber ninguna
  -- después de la migración 010, pero es la misma cautela que usó esa
  -- migración con "el ganador del grupo".
  update paginas
     set producto_id = ganador_id,
         updated_at = now()
   where producto_id = perdedor_id;

  -- El perdedor se apaga y deja de listarse como producto propio en el
  -- panel — no se borra: por si algo audita `productos` directamente.
  update productos
     set activo = false,
         updated_at = now()
   where id = perdedor_id;

  raise notice '013: fusionado "Tu Shot Metabolico" (%) dentro de "Shot Metabolico" (%).', perdedor_id, ganador_id;
end $$;
