-- ─────────────────────────────────────────────────────────────────────────────
-- 014 — Downsell automático cuando el upsell rebota por fondos insuficientes
--
-- Hasta ahora, un decline `insufficient_funds` (clasificado como `sin_fondos`
-- en lib/estado-pago.ts) deja el cobro en `fallido`, y el ÚNICO camino que le
-- queda es `paso_rechazado_id` — pero esa columna solo se sigue cuando
-- `permite_rechazo` está en true (ver `resolverDestino` en lib/funnels.ts). Ese
-- toggle es "mostrar el botón 'No, gracias'": un click explícito del
-- comprador. Fondos insuficientes no es un click, es un fallo técnico del
-- pago — pisar `permite_rechazo` para esto obligaría a prender un botón que
-- el operador no quiere mostrar, solo para habilitar el downsell por este
-- motivo puntual.
--
-- Esta columna es el destino, propio y explícito para ese caso, sin ninguna
-- relación con `permite_rechazo` ni con el botón de rechazo visible. El
-- paso destino es un upsell común — cobra one-click porque ya lo es, sin
-- nada especial que configurar ahí. A dónde va DESPUÉS de ese downsell ya es
-- 100% configurable con `paso_aceptado_id`/`paso_rechazado_id` de ese mismo
-- paso, la misma UI del editor que cualquier otro.
--
-- NULL (el default) es "no hay downsell para este motivo": el cobro queda en
-- `fallido` sin destino, igual que el comportamiento de hoy. Nada cambia para
-- quien no configure esto.
--
-- ADITIVA. No toca `paso_rechazado_id` ni `permite_rechazo`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table paginas
  add column if not exists downsell_por_fondos_id uuid references paginas(id) on delete set null;

-- Mismo motivo que `paginas_no_autoreferencia` en la migración 003: un paso no
-- puede ser su propio downsell. Se recrea la constraint completa (drop + add)
-- porque Postgres no tiene `alter constraint ... add condition`.
alter table paginas
  drop constraint if exists paginas_no_autoreferencia;
alter table paginas
  add constraint paginas_no_autoreferencia check (
    (paso_aceptado_id is null or paso_aceptado_id <> id) and
    (paso_rechazado_id is null or paso_rechazado_id <> id) and
    (downsell_por_fondos_id is null or downsell_por_fondos_id <> id)
  );
