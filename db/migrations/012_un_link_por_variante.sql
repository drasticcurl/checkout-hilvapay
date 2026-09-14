-- ─────────────────────────────────────────────────────────────────────────────
-- 012 — Un solo link de pago por variante (producto_plan_id)
--
-- Reportado por el usuario con una captura real de `/admin/catalogo`: un
-- mismo `plan_id` de Whop (una variante, `producto_planes.id`) terminaba con
-- DOS páginas (`/pagos/shotmetabolico` y `/pagos/upsell-2-shotmetabolico`),
-- porque nada lo impedía. Las dos vías que generan una página nueva —
-- `vincularPlan` (catálogo) y `guardarFunnel` (editor de funnels, un paso
-- nuevo insertaba siempre, nunca reusaba) — no se consultaban entre sí antes
-- de este módulo.
--
-- Esta migración:
--   Fase A — fusiona los duplicados que ya existan: por cada
--            `producto_plan_id` con más de una página, conserva UNA y
--            reapunta a esa conservada todo lo que dependía de las demás
--            (funnel_id, flechas de otros pasos que las señalaban como
--            destino, y los COBROS históricos vía `pagina_id` — no se puede
--            borrar la fila perdedora sin romper esa referencia).
--   Fase B — índice único parcial que impide que vuelva a pasar.
--
-- Ninguna fila de `paginas` se borra: una página "perdedora" queda con
-- `producto_plan_id = null` (huérfana de variante, ya no cobra nada) en vez
-- de desaparecer, precisamente porque `cobros.pagina_id` puede apuntarle y
-- borrar la fila rompería ese historial. `paginas.producto_id` sigue not
-- null (no se toca esa columna), así que la fila perdedora sigue siendo una
-- fila válida — solo que sin variante de precio asociada, y por lo tanto sin
-- forma de volver a cobrar por ella.
--
-- Criterio de cuál página se conserva, en este orden:
--   1. la que esté `activo = true` (si hay más de una activa a la vez, ya es
--      un bug aparte y se cae al criterio 2 entre esas);
--   2. la más nueva por `created_at` (probablemente la que se sigue usando).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fase A: fusión de duplicados existentes ─────────────────────────────────

do $$
declare
  fila record;
  ganador_id uuid;
begin
  for fila in
    select producto_plan_id
      from paginas
     where producto_plan_id is not null
     group by producto_plan_id
    having count(*) > 1
  loop
    select id into ganador_id
      from paginas
     where producto_plan_id = fila.producto_plan_id
     order by activo desc, created_at desc
     limit 1;

    -- Los cobros de las páginas perdedoras pasan a apuntar al ganador: es
    -- historial real de plata cobrada y no puede quedar señalando una página
    -- que se está por desconectar de su variante.
    update cobros
       set pagina_id = ganador_id
     where pagina_id in (
       select id from paginas
        where producto_plan_id = fila.producto_plan_id
          and id <> ganador_id
     );

    -- Cualquier paso de funnel que tuviera a una perdedora como destino de su
    -- flecha (aceptado/rechazado) pasa a apuntar al ganador — sin esto, el
    -- guardado siguiente del funnel podría pisar la flecha con NULL al no
    -- encontrar el id de destino.
    update paginas
       set paso_aceptado_id = ganador_id
     where paso_aceptado_id in (
       select id from paginas
        where producto_plan_id = fila.producto_plan_id
          and id <> ganador_id
     );

    update paginas
       set paso_rechazado_id = ganador_id
     where paso_rechazado_id in (
       select id from paginas
        where producto_plan_id = fila.producto_plan_id
          and id <> ganador_id
     );

    -- Las perdedoras se desconectan de la variante (dejan de ser cobrables) y
    -- del funnel al que pertenecieran, pero la fila queda — con su slug, su
    -- historia y sin romper la referencia de `cobros` de arriba.
    update paginas
       set producto_plan_id = null,
           funnel_id = null,
           activo = false,
           updated_at = now()
     where producto_plan_id = fila.producto_plan_id
       and id <> ganador_id;
  end loop;
end $$;

-- ── Fase B: el índice que lo impide de nuevo ────────────────────────────────
-- Parcial (`where producto_plan_id is not null`): una página sin variante
-- resuelta (legacy, o una perdedora de la fase A) no cuenta para la unicidad.
create unique index if not exists paginas_producto_plan_idx
  on paginas (producto_plan_id)
  where producto_plan_id is not null;
