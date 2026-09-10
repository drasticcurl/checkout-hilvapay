#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# deploy.sh — build + activación de una release nueva de hilvapay.
#
#   /srv/hilvapay/repo/deploy/deploy.sh
#
# Mismo patrón que dashboard-admin/deploy/deploy.sh (task T12 §B), adaptado a
# este servicio: dos dominios sobre un solo puerto, un solo proceso PM2 (sin
# worker aparte) y un cron que pega por HTTP en vez de correr con tsx.
#
# El código sale de git: /srv/hilvapay/repo es un clon de
# github.com/<org>/checkout-kashhhpay y el paso 1 lo lleva a
# origin/$DEPLOY_BRANCH antes de armar la release. Así el server sabe por
# commit qué está sirviendo y un rollback se puede reproducir.
#
#   DEPLOY_SOURCE=local sudo -u deploy bash /srv/hilvapay/repo/deploy/deploy.sh
#
# es el modo de bring-up (o si GitHub está caído): usa lo que haya en el
# directorio, sin rsync desde git. NO es el modo de régimen.
#
# Layout que asume:
#   /srv/hilvapay/repo                     ← clon de git (o rsync con DEPLOY_SOURCE=local)
#   /srv/hilvapay/shared/.env.production   ← secretos de la app (chmod 600)
#   /srv/hilvapay/releases/<timestamp>/    ← releases
#   /srv/hilvapay/current                  ← symlink → <release>/.next/standalone
#
# Garantías (las mismas que dashboard-admin):
#   - Un solo deploy a la vez (flock).
#   - Si el build, los tests o la migración fallan, `current` no se toca y la
#     release a medio hacer se borra.
#   - Si el servicio no contesta 200 después del reload, vuelve solo a la
#     release anterior.
#
# Este servicio cobra tarjetas (Whop de por medio). Los guards de abajo no son
# genéricos: cada uno documenta el incidente puntual que evita en dashboard-admin
# y que acá tendría el mismo costo o peor, porque hay plata moviéndose.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ┌───────────────────────────────────────────────────────────────────────────┐
# │ ESTE SCRIPT SE CORRE COMO EL USUARIO `deploy`, NUNCA COMO root.            │
# └───────────────────────────────────────────────────────────────────────────┘
#   sudo -u deploy bash /srv/hilvapay/repo/deploy/deploy.sh
#
# Correrlo como root parece funcionar y rompe producción de tres formas a la vez,
# todas silenciosas (pasó en dashboard-admin el 2026-08-13 y costó una caída):
#
#   1. `pm2` es POR USUARIO. root tiene su propio daemon, así que el
#      `pm2 startOrReload`/`pm2 reload` de más abajo crea un hilvapay-3020
#      nuevo en el pm2 de root en lugar de recargar el que está sirviendo (el
#      de `deploy`). Resultado: el proceso viejo sigue con el CÓDIGO VIEJO y
#      con el puerto 3020 tomado, y el nuevo entra en ciclo de reinicios sin
#      poder bindear. El health check pasa igual, porque el que contesta es el
#      viejo, así que el deploy dice OK y no desplegó nada — con cobros reales
#      corriendo contra código viejo mientras alguien cree que ya está el fix.
#   2. `install -m 600 .env.production` queda root:root. La app lo lee para
#      DATABASE_URL/WHOP_API_KEY/etc: como `deploy` no puede leerlo, el proceso
#      se queda sin credenciales y cicla.
#   3. El árbol de la release queda con el uid del rsync (root, o el uid de la
#      máquina de desarrollo).
#
# El guard es una línea y evita las tres.
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "ERROR: no corras deploy.sh como root." >&2
  echo "       pm2 es por usuario y .env.production queda ilegible para deploy." >&2
  echo "       Usá:  sudo -u deploy bash $0" >&2
  exit 1
fi

if [[ "$(id -un)" != "deploy" ]]; then
  echo "ADVERTENCIA: deploy.sh corriendo como '$(id -un)' y no como 'deploy'." >&2
  echo "             pm2 es por usuario: los procesos van a quedar en el daemon" >&2
  echo "             de '$(id -un)' y el servicio que sirve hoy no se va a recargar." >&2
  echo "             Cancelá con Ctrl-C en los próximos 10 s si no era a propósito." >&2
  sleep 10
fi

BASE="/srv/hilvapay"
REPO="$BASE/repo"
SHARED="$BASE/shared"
RELEASES="$BASE/releases"
ECOSYSTEM="$REPO/deploy/ecosystem.config.js"
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE="$RELEASES/$STAMP"
LOG="$BASE/deploy.log"
KEEP=5

ACTIVATED=0

# `|| true`: si deploy.log no es escribible, el deploy NO se cae por no poder
# loguear (con pipefail, un tee que falla aborta el script entero).
log() { printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG" || true; }
fail() { log "ERROR: $*"; exit 1; }

# Una release a medio construir (npm ci / build / test caídos) rompería un
# futuro rollback, que elegiría ese directorio como "release anterior".
on_exit() {
  local rc=$?
  if ((ACTIVATED == 0)) && [[ -d "$RELEASE" ]]; then
    rm -rf "$RELEASE"
    log "release $STAMP descartada (no llegó a activarse)"
  fi
  exit "$rc"
}
trap on_exit EXIT

[[ -d "$BASE" ]] || { echo "no existe $BASE — ¿ya se hizo el bring-up de la VPS?" >&2; exit 1; }
[[ -f "$REPO/package.json" ]] || fail "no hay package.json en $REPO — ¿el clon de git existe?"
[[ -f "$SHARED/.env.production" ]] || fail "falta $SHARED/.env.production"

# ─── Un build a la vez: el server también está sirviendo el checkout ───────
exec 9>"$BASE/.deploy.lock"
flock -n 9 || fail "ya hay un deploy corriendo para hilvapay"

# ─── 0. Traer el código ─────────────────────────────────────────────────────
# Mismo switch que dashboard-admin, para operar los proyectos igual:
#
#   git   (default) — fetch + reset --hard a origin/$DEPLOY_BRANCH.
#   local           — usa tal cual lo que haya en $REPO (rsync). Bring-up.
#
# El fetch va DESPUÉS del flock: dos deploys simultáneos escribiendo el mismo
# working tree dejarían la release a medio camino entre dos commits.
#
# `reset --hard` descarta cualquier cambio hecho a mano en $REPO. Es a
# propósito: el repo del server no es un workspace. Si hace falta un parche de
# urgencia, va por commit.
SOURCE="${DEPLOY_SOURCE:-git}"
case "$SOURCE" in
  git)
    [[ -d "$REPO/.git" ]] || fail "$REPO no es un clon de git (¿querías DEPLOY_SOURCE=local?)"
    BRANCH="${DEPLOY_BRANCH:-main}"
    git -C "$REPO" fetch --all --prune
    git -C "$REPO" rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1 \
      || fail "no existe origin/$BRANCH en $REPO"
    git -C "$REPO" reset --hard "origin/$BRANCH"
    COMMIT="$(git -C "$REPO" rev-parse --short HEAD)"
    log "release $STAMP ← $BRANCH @ $COMMIT"
    ;;
  local)
    COMMIT="rsync"
    log "release $STAMP ← $REPO (rsync, sin git)"
    ;;
  *)
    fail "DEPLOY_SOURCE inválido: '$SOURCE' (esperado: git | local)"
    ;;
esac

mkdir -p "$RELEASE"

# ─── 1. Código: copia local (repo → release) ──────────────────────────────
# Excludes:
#   node_modules / .next → npm ci y el build los regeneran (y un node_modules
#     de otra arquitectura rompe los binarios nativos).
#   .git / tasks/        → documentos de desarrollo; no van a producción.
#   .env, .env.*         → los secretos de dev NO van al server: el único env
#                          de producción es shared/.env.production (paso 2).
#   ._* / .DS_Store      → AppleDouble y basura de Finder de los rsync hechos
#                          desde una Mac.
rsync -a --delete \
  --exclude='node_modules' --exclude='.next' --exclude='.git' \
  --exclude='tasks' \
  --exclude='.env' --exclude='.env.*' \
  --exclude='._*' --exclude='.DS_Store' \
  "$REPO/" "$RELEASE/"
cd "$RELEASE"

# ─── 2. Secretos ────────────────────────────────────────────────────────────
install -m 600 "$SHARED/.env.production" "$RELEASE/.env.production"

# ─── 3. Guard de env vars requeridas ────────────────────────────────────────
# Sin estas, el checkout compila pero sale roto en producción: cobros que
# fallan contra Whop, panel abierto sin contraseña, o los dos dominios sin
# separar (ver middleware.ts, que responde 404 por host cuando PANEL_HOST/
# PAGOS_HOST no coinciden — pero si están VACÍAS el guard del middleware
# "no bloquea nada" y el panel queda accesible en pay.hilvanapp.com).
#
# WHOP_WEBHOOK_SECRET NO está acá a propósito: sin ella el webhook rechaza
# todo con 400, que es el fallo seguro (Whop reintenta, no se pierde nada) y
# no una razón para frenar el deploy — y desde que existe /api/cron/reconciliar,
# los cobros se cierran igual sin webhook, 10 minutos más tarde.
# PANEL_INGEST_URL/KEY, RESEND_API_KEY y PANEL_SESSION_SECRET tampoco: el
# servicio anda sin ellas (omite el reporte al panel, no manda el email de
# entrega, o cae a PANEL_PASSWORD respectivamente).
#
# ESTA LISTA TIENE QUE COINCIDIR con `ENV_CRITICAS` de app/api/health/route.ts.
# Si el health check fuera más estricto, el deploy pasaría este guard, arrancaría,
# y después el paso 8 lo revertiría por una variable que acá se decidió no exigir:
# un rollback en loop por una diferencia de criterio entre dos archivos.
REQUIRED=(
  DATABASE_URL
  WHOP_API_KEY
  WHOP_COMPANY_ID
  WHOP_API_BASE
  WHOP_API_VERSION_DATE
  PANEL_PASSWORD
  PANEL_HOST
  PAGOS_HOST
  NEXT_PUBLIC_BASE_URL
  CRON_SECRET
)
MISSING=()
for var in "${REQUIRED[@]}"; do
  # Exige al menos un caracter que no sea comilla ni espacio después del `=`,
  # así `VAR=`, `VAR=""` y `VAR='  '` también cuentan como faltantes.
  grep -Eq "^${var}=[[:space:]]*[\"']?[^\"'[:space:]]" "$RELEASE/.env.production" \
    || MISSING+=("$var")
done
if ((${#MISSING[@]})); then
  log "env vars faltantes o vacías: ${MISSING[*]}"
  fail "abortado antes del build (${#MISSING[@]} vars)"
fi
log "env vars requeridas: OK (${#REQUIRED[@]} presentes)"

# Se extrae una sola vez y temprano: la usan los tests (paso 4) y la migración
# (paso 6). No se exporta al environment general para no dejar la credencial
# colgada durante `npm ci` y el build, que corren código de terceros.
DB_URL="$(grep -E '^DATABASE_URL=' "$SHARED/.env.production" | head -n1 | cut -d= -f2- | tr -d '"'\''[:space:]')"
[[ -n "$DB_URL" ]] || fail "no pude leer DATABASE_URL de $SHARED/.env.production"

# ─── 4. Build + tests ───────────────────────────────────────────────────────
# `npm ci` SIN --omit=dev: los scripts de db:migrate/db:seed corren con tsx,
# que es una devDependency, y el standalone linkea el node_modules completo
# de la release (paso 5) para que tsx exista ahí.
export NODE_OPTIONS="--max-old-space-size=2048"
npm ci --no-audit --no-fund
npm run build
# Los 140 tests son unitarios y no tocan la base (a diferencia de los del
# panel, que insertan sesiones y ventas reales): no hay riesgo de contaminar
# producción con datos de prueba. Lo que SÍ hay que probar es la migración,
# porque una migración rota recién se nota cuando algo intenta leer una
# columna que no llegó a existir — y eso hay que saberlo ANTES de tocar la
# base real. Se migra `hilvapay_test` en este mismo paso, igual que el panel
# migra `panel_test`: si la migración rompe, el deploy se cae acá.
TEST_DB_URL="${DB_URL%/*}/hilvapay_test"
# NO se usa `npm run db:migrate` acá, y es un bug que ya costó un deploy roto:
# ese script es `tsx --env-file=.env.local scripts/migrate.ts`, y el rsync del
# paso 2 excluye `.env.*` — así que en la release NO existe `.env.local`. Node no
# lo ignora: falla con `node: .env.local: not found` y el deploy se cae acá, en
# cada intento, antes de tocar nada. Se invoca tsx directo con el --env-file que
# sí existe en la VPS.
#
# `DATABASE_URL=` adelante y no dentro del archivo: verificado que una variable
# ya presente en el entorno LE GANA a la del `--env-file` (Node 24). Por eso esto
# migra `hilvapay_test` y no la base de producción, aunque el .env.production
# tenga su propia DATABASE_URL.
DATABASE_URL="$TEST_DB_URL" node --env-file=.env.production ./node_modules/.bin/tsx scripts/migrate.ts
npm test

# ─── 5. Completar el standalone ─────────────────────────────────────────────
# Next NO copia public/ ni .next/static/ dentro de .next/standalone/.
# Sin estos dos cp el sitio sale sin CSS y sin imágenes.
STANDALONE="$RELEASE/.next/standalone"
[[ -f "$STANDALONE/server.js" ]] || fail "no se generó .next/standalone (¿falta output:'standalone'?)"
mkdir -p "$STANDALONE/public" "$STANDALONE/.next/static"
# El `if` no es cosmético: este proyecto no tiene public/ hoy (sin assets
# estáticos propios — el logo/embed los sirve Whop) y un `cp` de un directorio
# inexistente aborta el deploy con set -e después de haber corrido build y
# tests. Si en algún momento aparece un public/, este bloque ya lo cubre sin
# tocar el script.
if [ -d "$RELEASE/public" ]; then
  cp -a "$RELEASE/public/." "$STANDALONE/public/"
fi
cp -a "$RELEASE/.next/static/." "$STANDALONE/.next/static/"
install -m 600 "$SHARED/.env.production" "$STANDALONE/.env.production"

# `npm run db:migrate` (invocado a mano más abajo con tsx) lee db/migrations/
# con process.cwd() + 'db/migrations' (scripts/migrate.ts): si alguna vez se
# quisiera migrar desde `current` en lugar de desde la release, hace falta
# db/ ahí. No se copia hoy porque el paso 6 migra desde $RELEASE (antes del
# swap) y no desde el standalone — se deja este comentario para que quien
# mueva la migración a otro momento del ciclo sepa que tiene que agregar
# `cp -a "$RELEASE/db" "$STANDALONE/db"` si migra desde `current`.
#
# scripts/ y lib/ sí van: seed.ts (`npm run db:seed`, operación manual) importa
# de lib/db, y el node_modules que trae el standalone es solo prod (Next lo
# poda) y no tiene tsx — se linkea el de la release completa en su lugar.
cp -a "$RELEASE/scripts" "$STANDALONE/scripts"
cp -a "$RELEASE/lib" "$STANDALONE/lib"
rm -rf "$STANDALONE/node_modules"
ln -s ../../node_modules "$STANDALONE/node_modules"
log "standalone completo (public + .next/static + scripts + lib + .env.production)"

# ─── 6. Migración — ANTES de activar ────────────────────────────────────────
# Si la migración falla, `current` sigue apuntando a la release anterior y el
# checkout sigue sirviendo con el schema que ya conoce: una migración rota
# nunca deja el cobro caído ni a medio schema.
#
# No hay worker que parar acá (a diferencia de panel-reglas en dashboard-admin):
# este servicio es un solo proceso PM2, sin motor de background.
#
# `npm run db:migrate` corre con tsx --env-file=.env.local en dev (ver
# package.json), pero .env.local no existe en la VPS: el archivo vivo es
# .env.production. Se invoca tsx directo con el --env-file correcto en lugar
# del script de npm, que tiene el flag pegado al nombre del archivo de dev.
DATABASE_URL="$DB_URL" node --env-file=.env.production ./node_modules/.bin/tsx scripts/migrate.ts

# ─── 7. Activar ─────────────────────────────────────────────────────────────
# `readlink -e` (no -f): -f imprime el path y sale 0 aunque el último componente
# no exista, así que en el primer deploy PREVIOUS quedaría igual a
# "$BASE/current" y un rollback armaría un symlink apuntándose a sí mismo.
PREVIOUS="$(readlink -e "$BASE/current" 2>/dev/null || true)"

# El swap tiene que ser atómico: `ln -sfn` sobre un symlink existente hace
# unlink + symlink, y en esa ventana `current` no existe. `mv -T` es un solo
# rename(2), no hay ventana.
ln -sfn "$STANDALONE" "$BASE/current.tmp"
mv -Tf "$BASE/current.tmp" "$BASE/current"
ACTIVATED=1
log "current → $STANDALONE"

rollback_to_previous() {
  if [[ -n "$PREVIOUS" && -f "$PREVIOUS/server.js" ]]; then
    ln -sfn "$PREVIOUS" "$BASE/current.tmp"
    mv -Tf "$BASE/current.tmp" "$BASE/current"
    pm2 reload hilvapay-3020 --update-env || true
    log "revertido a $PREVIOUS"
  else
    log "sin release anterior válida para revertir (¿primer deploy?)"
  fi
}

# ─── 8. Reload + health check ───────────────────────────────────────────────
# En el primer deploy la app todavía no existe en PM2: `reload` fallaría.
if pm2 describe hilvapay-3020 >/dev/null 2>&1; then
  pm2 reload hilvapay-3020 --update-env || {
    rollback_to_previous
    fail "pm2 reload falló"
  }
else
  log "hilvapay-3020 no existe en PM2 — primer arranque"
  pm2 start "$ECOSYSTEM" || {
    rollback_to_previous
    fail "pm2 start falló"
  }
fi

ok=0
for _ in $(seq 1 20); do
  sleep 2
  # `/api/health` y NO `/`.
  #
  # `GET /` devuelve 200 con "Nada por acá" (app/page.tsx): es una página
  # estática, así que responde 200 **con Postgres caído, con las migraciones sin
  # correr y con la WHOP_API_KEY vacía**. O sea: el rollback automático de acá
  # abajo estaba verificando que Node hubiera arrancado, y nada más.
  #
  # `/api/health` chequea `select 1`, que las migraciones esperadas estén
  # aplicadas y que las env vars críticas existan, y devuelve 503 si algo falta.
  # No le pega a la API de Whop a propósito: un health check que depende de un
  # tercero convierte una caída de Whop en un rollback nuestro que no arregla nada.
  #
  # Las otras rutas siguen sin servir para esto: `/admin` da 307 (redirect a
  # login, y encima está detrás de PANEL_HOST) y `/pagos/...` da 404 si el link
  # está apagado, que es el estado normal en producción.
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3020/api/health || true)"
  [[ "$code" == "200" ]] && { ok=1; break; }
done
if ((!ok)); then
  log "hilvapay no respondió 200 en /api/health (último código: ${code:-sin respuesta})"
  # El cuerpo dice QUÉ falta (con el bearer del CRON_SECRET trae el detalle), y
  # sale al log del deploy antes del rollback: sin esto hay que adivinar si fue
  # la base, una migración o una variable.
  SECRET_HEALTH="$(sed -n 's/^CRON_SECRET=//p' "$SHARED/.env.production" 2>/dev/null | head -n1 | tr -d '"'"'"'[:space:]')"
  log "diagnóstico: $(curl -s -m 5 -H "Authorization: Bearer ${SECRET_HEALTH:-}" http://127.0.0.1:3020/api/health || echo 'sin respuesta')"
  rollback_to_previous
  fail "deploy revertido"
fi

pm2 save --force >/dev/null
log "hilvapay arriba (${code} en /api/health)"

# ─── 9. Poda: deja las 5 releases más nuevas ────────────────────────────────
# Nunca borrar la release que está sirviendo: después de un rollback a una
# release vieja, esa release es de las más antiguas por mtime y entraría en
# la lista de borrado.
LIVE_RELEASE=""
live="$(readlink -e "$BASE/current" 2>/dev/null || true)"
[[ -n "$live" ]] && LIVE_RELEASE="${live%/.next/standalone}"

while read -r dir; do
  dir="${dir%/}"
  [[ -z "$dir" || "$dir" == "$LIVE_RELEASE" ]] && continue
  rm -rf "$dir"
  log "release podada: $(basename "$dir")"
done < <(ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) || true)

log "deploy OK — release $STAMP"
