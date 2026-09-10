-- ─────────────────────────────────────────────────────────────────────────────
-- 003 — Funnels: los pasos dejan de apuntar a URLs sueltas y apuntan a OTRO PASO
--
-- Antes, cada `pagina` tenía `url_exito` y `url_rechazo`: dos URLs escritas a
-- mano. Funcionaba, pero el funnel no existía en ningún lado — vivía repartido
-- en las URLs de cuatro filas, y reordenarlo era editarlas una por una sin
-- ninguna pantalla que mostrara el resultado. Es exactamente donde se esconde el
-- error de cobrar el producto de otro paso.
--
-- Ahora un `funnel` agrupa sus pasos y cada paso apunta al SIGUIENTE por id. La
-- URL a la que se redirige sale de `url_externa` del paso destino, no del paso
-- actual.
--
-- ADITIVA. No borra ni cambia el tipo de ninguna columna: `url_exito` y
-- `url_rechazo` siguen existiendo y siguen funcionando para las páginas que no
-- pertenecen a un funnel. El resolutor (lib/funnels.ts) usa el grafo cuando hay
-- `funnel_id` y cae a las URLs viejas cuando no.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists funnels (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,

  -- A dónde va el comprador cuando el funnel se termina: aceptó el último
  -- upsell, o rechazó uno y no hay downsell configurado. Es el botón "Página de
  -- Gracias" del editor.
  url_gracias  text,

  -- Un solo interruptor para toda la cadena. Es la razón principal de que esta
  -- tabla exista: hoy apagar un funnel es apagar cuatro links uno por uno, y
  -- olvidarse de uno deja un paso cobrando solo.
  activo       boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table paginas
  add column if not exists funnel_id uuid references funnels(id) on delete set null,

  -- Solo para ordenar el editor. NO define el flujo: el flujo son los punteros
  -- de abajo. Si el orden mandara, mover un paso cambiaría a quién le cobra el
  -- anterior, que es el bug que este diseño evita.
  add column if not exists orden int not null default 0,

  -- El nombre interno del paso ("Upsell 1"). Distinto del nombre del producto,
  -- que es lo que ve el comprador.
  add column if not exists nombre text,

  -- Dónde ve el comprador la oferta: una página del funnel, con su VSL y su
  -- copy, en OTRO dominio. Este servicio no la sirve, solo redirige ahí y cobra
  -- cuando el botón dispara.
  --
  -- Para un paso `front` queda NULL: su página es /pagos/<slug>, de este lado.
  add column if not exists url_externa text,

  -- El toggle "Activar botón de rechazo". Cuando está en false, el paso no
  -- ofrece salida sin comprar y `paso_rechazado_id` se ignora.
  add column if not exists permite_rechazo boolean not null default false,

  -- Las dos flechas. NULL significa "acá se termina el funnel": se usa
  -- `funnels.url_gracias`.
  --
  -- `on delete set null` y no cascade: borrar un paso del medio no puede borrar
  -- los que venían después. Deja el funnel cortado, que se ve en el editor y se
  -- arregla, en vez de desaparecer pasos en silencio.
  add column if not exists paso_aceptado_id uuid references paginas(id) on delete set null,
  add column if not exists paso_rechazado_id uuid references paginas(id) on delete set null;

create index if not exists paginas_funnel_idx on paginas (funnel_id, orden);

-- Un paso no puede apuntarse a sí mismo. Es el ciclo más corto posible y el más
-- fácil de crear con un click en el editor. Los ciclos más largos los detecta
-- lib/funnels.ts al guardar, porque un CHECK no puede recorrer el grafo.
alter table paginas
  drop constraint if exists paginas_no_autoreferencia;
alter table paginas
  add constraint paginas_no_autoreferencia check (
    (paso_aceptado_id is null or paso_aceptado_id <> id) and
    (paso_rechazado_id is null or paso_rechazado_id <> id)
  );

-- Un funnel tiene UN paso `front`. Es la decisión de no soportar lo que KashPay
-- llama varias "ofertas" del mismo producto principal: si hacen falta dos
-- precios, son dos funnels. El índice lo vuelve imposible de violar por error.
create unique index if not exists paginas_un_front_por_funnel
  on paginas (funnel_id)
  where tipo = 'front' and funnel_id is not null;
