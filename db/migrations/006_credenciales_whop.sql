-- ─────────────────────────────────────────────────────────────────────────────
-- 006 — Credenciales de Whop en la base, para poder rotarlas sin SSH
--
-- Mismo criterio que la 002: lo que hay que poder cambiar sin redeployar, va en
-- la base. Acá el caso es más agudo que el interruptor de emails — rotar la API
-- key de Whop hoy exige entrar por SSH, editar un archivo 600 EN DOS LUGARES (el
-- de `shared/` y la copia dentro de la release viva) y recargar PM2. Eso es
-- demasiada ceremonia para algo que se hace justo cuando hay un incidente.
--
-- ── La key va CIFRADA, el resto en claro ────────────────────────────────────
-- `whop_api_key_cifrada` guarda el sobre de `lib/cripto.ts` (`v1.iv.datos`,
-- AES-256-GCM), no la key. Para leerla hacen falta la base Y
-- `CONFIG_ENCRYPTION_KEY`, que vive solo en el `.env.production`: un `pg_dump`
-- filtrado, por sí solo, no alcanza.
--
-- Las otras tres no son secretos y van en claro a propósito. El company id
-- (`biz_...`) aparece en las URLs del dashboard de Whop, y la base y la fecha de
-- versión están en la documentación pública. Cifrarlas daría la sensación de
-- proteger algo sin proteger nada, y complicaría leerlas cuando algo falla.
--
-- ── NULL significa "usá el env" ─────────────────────────────────────────────
-- Todas las columnas nacen NULL, y NULL no es "sin configurar": es "esta fila no
-- opina, la credencial sale de la variable de entorno". Así la migración se
-- puede aplicar en producción sin cambiar el comportamiento de nada, que es la
-- única forma de que una migración sobre el camino del dinero sea segura.
--
-- Por eso mismo el env SIGUE siendo obligatorio en `deploy.sh` y en
-- `/api/health`: la base es un override, no un reemplazo. Si algún día se
-- invierte, hay que tocar esas dos listas a la vez o el deploy entra en un
-- rollback en loop (está documentado en los dos archivos).
--
-- Aditiva e idempotente: `add column if not exists` sobre la fila única que la
-- 002 ya garantiza que existe. Correrla dos veces no falla ni duplica nada.
-- ─────────────────────────────────────────────────────────────────────────────

alter table config
  -- El sobre de lib/cripto.ts, NO la key. Si esta columna es NULL, la key sale
  -- de WHOP_API_KEY.
  add column if not exists whop_api_key_cifrada text,

  -- `biz_...`. No es secreto: sale en las URLs del dashboard de Whop.
  add column if not exists whop_company_id text,

  -- Se guardan para poder mover el servicio entre producción y sandbox, y para
  -- mover el pin de versión, desde el panel. La fecha de versión no es cosmética:
  -- forma parte de la clave de idempotencia del lado de Whop, así que cambiarla
  -- a mano en caliente tiene consecuencias y conviene que quede fechado.
  add column if not exists whop_api_base text,
  add column if not exists whop_api_version_date text,

  -- ── El rastro de la verificación ──────────────────────────────────────────
  -- Cuándo estas credenciales contestaron OK contra `GET /companies/{biz_id}`.
  -- No se guarda nada que no haya sido verificado, así que esto es también la
  -- fecha del último cambio efectivo.
  add column if not exists whop_verificado_at timestamptz,

  -- El nombre que devolvió Whop para esa company ("Sinvanapp"). Se guarda para
  -- que el panel pueda mostrar CONTRA QUÉ cuenta está apuntando el servicio, en
  -- palabras y no como un `biz_` que nadie reconoce de memoria.
  add column if not exists whop_company_nombre text,

  -- Huella salada de la key guardada (lib/cripto.ts, `huella`). Permite
  -- responder "¿la que está puesta es la misma que tengo yo acá?" sin descifrar
  -- nada y sin imprimir la key en ninguna respuesta.
  add column if not exists whop_api_key_huella text;
