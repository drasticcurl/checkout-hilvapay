-- ─────────────────────────────────────────────────────────────────────────────
-- 010 — producto_planes: un producto, N precios/planes de Whop
--
-- YA VERIFICADO el 2026-09-13 contra una base scratch con las 9 migraciones
-- previas aplicadas, dos veces (idempotencia) y con los 4 productos/páginas
-- reales de la base local `checkout` volcados encima (ver 00-PLAN §3). También
-- verificado con un caso sintético de dos planes que comparten `whop_product_id`
-- (el caso real del usuario: "Acelerador 7X" a 27 USD y su downsell a 17 USD,
-- mismo `access_pass` de Whop): los dos terminan agrupados bajo UN producto
-- padre, con dos filas en `producto_planes`, y las `paginas` que ya apuntaban a
-- cada uno conservan su precio y su slug intactos.
--
-- Antes: `productos.whop_plan_id` es único (un producto = un plan). Eso hace que
-- un mismo producto de Whop con dos precios (precio completo / downsell) tenga
-- que vivir como DOS filas de `productos`, sin relación entre sí más que un
-- nombre tipeado a mano igual las dos veces — que es exactamente el problema que
-- reportó el usuario: "no tener tantos links para el mismo producto".
--
-- Después: el nombre/foto/descripción viven en `productos` UNA sola vez. Cada
-- precio cobrable es una fila de `producto_planes`, con su propio
-- `whop_plan_id` (que sigue siendo el que de verdad determina cuánto se cobra).
-- `paginas` pasa a apuntar a `producto_plan_id`, no a `producto_id` directo.
--
-- ADITIVA y en dos fases dentro del mismo archivo: fase A crea la tabla y la
-- columna sin tocar nada que ya funcione; fase B migra los datos existentes.
-- `productos.whop_plan_id` NO se borra en esta migración — ver D2 del plan
-- sobre por qué queda como columna muerta hasta que T02 la retire.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fase A: esquema ──────────────────────────────────────────────────────────

create table if not exists producto_planes (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid not null references productos(id) on delete cascade,

  -- El plan real de Whop. Sigue siendo lo único que determina el importe —
  -- la unicidad se mueve acá desde `productos.whop_plan_id` (D1 del plan).
  whop_plan_id      text not null,
  whop_nombre_soft  text,

  -- Cómo se llama esta variante en el panel: "Precio completo", "Downsell",
  -- "Oferta de lanzamiento". Texto libre, no un enum — un enum cerrado se queda
  -- corto en la segunda campaña con un nombre de variante que no se previó.
  etiqueta          text not null default 'Precio completo',

  precio            numeric(10,2) not null,
  moneda            text not null default 'usd',
  precio_anclaje    numeric(10,2),

  -- La variante que se preselecciona en el editor al elegir este producto por
  -- primera vez. Un producto recién migrado o recién creado tiene exactamente
  -- una con `es_default = true` (ver el índice de abajo); agregar una segunda
  -- variante después no cambia cuál es la default.
  es_default        boolean not null default false,

  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Mismo criterio que tenía `productos.whop_plan_id`: un plan de Whop es UN
-- precio cobrable, nunca compartido entre dos variantes ni dos productos.
create unique index if not exists producto_planes_whop_plan_idx on producto_planes (whop_plan_id);
create index if not exists producto_planes_producto_idx on producto_planes (producto_id);

-- Un producto no puede tener dos variantes default a la vez: el editor no
-- tendría con cuál preseleccionar. El índice parcial lo vuelve imposible de
-- violar por un bug en vez de confiar en que el código nunca lo intente.
create unique index if not exists producto_planes_un_default_idx
  on producto_planes (producto_id) where es_default;

alter table paginas
  add column if not exists producto_plan_id uuid references producto_planes(id) on delete restrict;

-- ── Fase B: migración de datos existentes ───────────────────────────────────
--
-- Agrupa por `whop_product_id` (el `access_pass` de Whop) cuando existe. Dos
-- productos viejos con el mismo `whop_product_id` son, por definición, el mismo
-- producto de Whop con dos planes — se funden en uno. Un producto sin
-- `whop_product_id` (vinculado a mano, sin catálogo) es su propio grupo: no hay
-- evidencia de que comparta access_pass con ningún otro, así que agruparlo por
-- nombre sería adivinar.
--
-- El "ganador" de cada grupo (el que se queda como fila de `productos`, y a
-- cuyas páginas de OTROS productos del grupo no hay que tocar porque las
-- páginas migran por `producto_plan_id`, no por `producto_id`) es el más viejo
-- por `created_at`: es el que probablemente se vinculó primero.
with grupos as (
  select
    id,
    coalesce(whop_product_id, 'sin-agrupar-' || id::text) as clave_grupo,
    row_number() over (
      partition by coalesce(whop_product_id, 'sin-agrupar-' || id::text)
      order by created_at asc
    ) as posicion
  from productos
),
ganadores as (
  select clave_grupo, id as producto_ganador_id
  from grupos
  where posicion = 1
)
insert into producto_planes (producto_id, whop_plan_id, whop_nombre_soft, etiqueta, precio, moneda, precio_anclaje, es_default, activo)
select
  gan.producto_ganador_id,
  pr.whop_plan_id,
  pr.whop_nombre_soft,
  case when g.posicion = 1 then 'Precio completo' else 'Variante ' || g.posicion end,
  pr.precio,
  pr.moneda,
  pr.precio_anclaje,
  g.posicion = 1,
  pr.activo
from productos pr
join grupos g on g.id = pr.id
join ganadores gan on gan.clave_grupo = g.clave_grupo
on conflict (whop_plan_id) do nothing;

-- Las páginas migran resolviendo por el `whop_plan_id` de SU producto
-- original — no por `producto_id`, porque el producto original puede no ser
-- el ganador del grupo (fundido en otro). El join intermedio por
-- `whop_plan_id` es lo que hace que esto sea correcto sin importar cuál
-- productos ganó.
update paginas pg
   set producto_plan_id = pp.id
  from productos pr_original
  join producto_planes pp on pp.whop_plan_id = pr_original.whop_plan_id
 where pr_original.id = pg.producto_id
   and pg.producto_plan_id is null;
