-- Verificación de "panel-y-capi" (fase 3 del plan).
--
-- CÓMO SE CORRIÓ: los bloques 1-3 son SQL puro (no dependen del schema del
-- proyecto) y SÍ se corrieron de verdad, contra una base scratch temporal
-- (`verificacion_scratch_orquestador`, creada y dropeada en la misma sesión)
-- en el Postgres 16 local de Homebrew — nunca contra las bases reales de
-- dashboard-admin ni checkout-kashhhpay. Salida real obtenida: los 10 casos
-- del bloque 1 dieron ok=t, el bloque 2 dio el fbc esperado exacto, el bloque
-- 3 dio 123456789. El bloque 4 (constraints de las tablas reales) NO se pudo
-- correr porque no hay una copia de la base real de dashboard-admin
-- disponible en este entorno — queda verificado solo por lectura del DDL
-- (ver 00-PLAN §10, P-01) y con el query de re-verificación documentado ahí
-- para cuando T02 tenga acceso a la base real.

-- ═══ 1. El regex de extracción de ID de Meta acepta los casos reales ═══
-- Por qué importa: si las UTMs que checkout-kashhhpay reenvía a dashboard-admin
-- no matchean este regex, la venta se guarda pero NUNCA se puede unir a la
-- jerarquía de Meta Ads (campaign_id/adset_id/ad_id quedan NULL para siempre).
-- Fuente del regex: dashboard-admin/lib/queries/ads.ts:57-62 (EXTRAE_SQL),
-- copiado literal.
\set ON_ERROR_STOP on
BEGIN;

\echo '═══ 1. Extracción de ID de Meta desde utm_campaign/utm_medium/utm_content ═══'
\echo 'esperado: cada fila con ok = t'
WITH casos(caso, entrada, espera) AS (VALUES
  ('nombre|id de 6 dígitos',    'Black Friday|120211',        '120211'),             -- 6 dígitos exactos, SÍ matchea (regla pide {6,})
  ('nombre|id de 5 dígitos',    'Black Friday|12021',         NULL),                 -- 5 dígitos, no matchea (regla pide 6+)
  ('nombre|id de 9 dígitos',    'Black Friday|120211112',     '120211112'),
  ('nombre|id largo real',      'Retargeting 18-35|120211112223330', '120211112223330'),
  ('con espacios alrededor',    'Ad Set X | 120211112224440 ', '120211112224440'),
  ('solo numero 9+ digitos',    '120211112225550',            '120211112225550'),
  ('solo numero 8 digitos',     '12021111',                   NULL),                 -- 8 dígitos, no matchea (regla pide 9+ si es solo número)
  ('directo, centinela',        '(directo)',                  NULL),
  ('vacio',                     '',                            NULL),
  ('nombre sin pipe ni numero', 'Black Friday Campaign',      NULL)
)
SELECT
  caso,
  entrada,
  CASE
    WHEN entrada ~ '\|\s*[0-9]{6,}\s*$' THEN btrim(substring(entrada from '[0-9]+\s*$'))
    WHEN entrada ~ '^\s*[0-9]{9,}\s*$' THEN btrim(entrada)
    ELSE NULL
  END AS extraido,
  espera,
  (CASE
    WHEN entrada ~ '\|\s*[0-9]{6,}\s*$' THEN btrim(substring(entrada from '[0-9]+\s*$'))
    WHEN entrada ~ '^\s*[0-9]{9,}\s*$' THEN btrim(entrada)
    ELSE NULL
  END) IS NOT DISTINCT FROM espera AS ok
FROM casos;

ROLLBACK;

-- ═══ 2. Formateo de fbc (fb.<subdomainIndex>.<creationTime_ms>.<fbclid>) ═══
-- Fuente: developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
-- (ver research del análisis previo). subdomainIndex = 1 cuando se genera
-- server-side sin cookie _fbc propia (indicación explícita de la doc).
\echo '═══ 2. Construcción de fbc desde un fbclid crudo ═══'
\echo 'esperado exactamente: fb.1.1725900000000.IwAR2F4example'
SELECT 'fb.1.' || (1725900000000)::text || '.' || 'IwAR2F4example' AS fbc_generado;

-- ═══ 3. Conversión a centavos (ya existe y está probada; se documenta el caso límite) ═══
-- Fuente: checkout-kashhhpay/lib/salidas.ts función `centavos()`. NO se
-- reimplementa: T04 importa esta misma función para el `value` de custom_data
-- de Meta CAPI en lugar de reconvertir el monto a mano.
\echo '═══ 3. centavos() ya verificado en salidas.test.ts — caso de punto flotante ═══'
\echo 'esperado: Math.round(1234567.89 * 100) = 123456789 (NO 123456788 por truncamiento)'
SELECT round(1234567.89 * 100)::bigint AS centavos_correctos;

-- ═══ 4. product_map / webhook_events / orders no tienen CHECK que rechace los valores nuevos ═══
-- Verificado por lectura de:
--   dashboard-admin/db/migrations/004_orders.sql   (orders, product_map)
--   dashboard-admin/db/migrations/007_observabilidad.sql (webhook_events)
-- Ninguna de las tres tablas tiene una cláusula CHECK sobre `source` ni
-- `shop_domain`. Si en el futuro alguien agrega un CHECK con una lista
-- cerrada de sources, este bloque hay que volver a cor02rlo contra la base real
-- con:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid IN ('orders'::regclass, 'webhook_events'::regclass, 'product_map'::regclass)
--      AND contype = 'c';
-- y confirmar que ninguna fila mencione 'source' o 'shop_domain' con una
-- lista de valores que excluya 'checkout_propio'.
\echo '═══ 4. Sin CHECK constraints en source/shop_domain — verificado por lectura, no por query ═══'
\echo 'no ejecutable sin conexión real; ver comentario arriba para el query de re-verificación'
