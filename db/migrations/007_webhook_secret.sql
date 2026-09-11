-- ─────────────────────────────────────────────────────────────────────────────
-- 007 — El signing secret del webhook en la base, para poder cargarlo del panel
--
-- Continúa la 006. Esa migración movió la API key a la base para poder rotarla
-- sin SSH, pero dejó afuera el signing secret del webhook — y el secret es
-- justamente el que hay que cambiar cuando se cambia de cuenta de Whop, porque
-- **cada webhook de Whop tiene el suyo**. Rotar la cuenta desde
-- `/admin/conexion` y tener que entrar por SSH para el secret dejaba la mitad
-- del cambio fuera del panel.
--
-- ── Por qué esto importa más de lo que parece ────────────────────────────────
-- Sin el secret correcto, `POST /api/webhooks/whop` rechaza TODO con 400 (ver
-- `lib/whop-webhook.ts`). Whop reintenta un rato y después apaga el endpoint. El
-- cobro entra igual —la plata se mueve del lado de Whop— pero la orden nunca se
-- marca pagada y **nadie recibe lo que compró**. Es la peor forma de fallar que
-- tiene este servicio: silenciosa y del lado del cliente.
--
-- Medido el 2026-09-11: la cuenta que cobra (`biz_LHktpJ17c83CFt`, "Atlas & Co.")
-- no tenía NINGÚN webhook registrado, porque el que existía era de la cuenta
-- anterior. Los `whop_member_id` y `whop_payment_method_id` que sí quedaron
-- guardados llegaron por el claim sincrónico de `/api/checkout/reclamar`, no por
-- el webhook. O sea: la redundancia salvó el dato, pero no la entrega.
--
-- ── Cifrado, como la key ────────────────────────────────────────────────────
-- El secret ES un secreto: con él se puede firmar un `payment.succeeded` falso y
-- hacer que el servicio entregue producto sin que nadie haya pagado. Va cifrado
-- con el mismo sobre de `lib/cripto.ts` (AES-256-GCM), así que para usarlo hacen
-- falta la base Y `CONFIG_ENCRYPTION_KEY`.
--
-- ── NULL significa "usá el env" ─────────────────────────────────────────────
-- Igual que la 006: NULL no es "sin configurar", es "esta fila no opina, el
-- secret sale de WHOP_WEBHOOK_SECRET". Por eso la migración se puede aplicar en
-- producción sin cambiar el comportamiento de nada.
--
-- `WHOP_WEBHOOK_SECRET` sigue NO estando en los REQUIRED de `deploy.sh` ni en
-- `/api/health`, y eso no cambia acá. La razón está escrita en los dos archivos:
-- exigirla haría que un deploy entre en rollback por algo que no impide cobrar.
--
-- Aditiva e idempotente sobre la fila única que la 002 garantiza.
-- ─────────────────────────────────────────────────────────────────────────────

alter table config
  -- El sobre de lib/cripto.ts (`v1.iv.datos`), NO el secret. NULL ⇒ se usa
  -- WHOP_WEBHOOK_SECRET del entorno.
  add column if not exists whop_webhook_secret_cifrado text,

  -- Huella salada (lib/cripto.ts, `huella`). Sirve para contestar "¿el que está
  -- cargado es el mismo que tengo yo en la mano?" sin descifrar ni imprimir
  -- nada. Es la única forma de diagnosticar un secret equivocado sin exponerlo.
  add column if not exists whop_webhook_secret_huella text,

  -- Cuándo se guardó. No hay verificación previa posible contra Whop (no existe
  -- un endpoint que valide un signing secret), así que a diferencia de la key
  -- esta fecha es "cuándo se cargó", no "cuándo se verificó". Lo que verifica de
  -- verdad es el botón **Send event** del dashboard de Whop, y eso se ve en
  -- `whop_eventos`.
  add column if not exists whop_webhook_secret_at timestamptz;
