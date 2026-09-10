#!/usr/bin/env bash
#
# configurar-env.sh — pide las credenciales, escribe .env.local y las VERIFICA
# contra la API de Whop.
#
# Lo que lo hace útil: NO tenés que saber de antemano si tu key es de sandbox o
# de producción, ni qué Api-Version-Date usar, ni tu company id. El script prueba
# las combinaciones contra `GET /accounts/me` —el endpoint que la doc de Whop
# recomienda para "confirmar que tu key y tus permisos funcionan"— y de la
# respuesta saca el `biz_...` solo.
#
# Todas las llamadas son GET. No escribe nada en tu cuenta de Whop, no crea
# planes, no cobra. Verificar con una key de producción es seguro.
#
# Uso:  ./scripts/configurar-env.sh
#       ./scripts/configurar-env.sh --solo-verificar    (no pide nada, solo prueba)

set -euo pipefail

# Los temporales nacen sin permisos para nadie más: en el medio del script el
# archivo tiene la API key adentro.
umask 077

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$RAIZ/.env.local"
TMP="$(mktemp "${TMPDIR:-/tmp}/envlocal.XXXXXX")"
trap 'rm -f "$TMP" "$TMP".2' EXIT INT TERM

BASE_SANDBOX="https://sandbox-api.whop.com/api/v1"
BASE_PROD="https://api.whop.com/api/v1"

# Los formatos de Api-Version-Date que aparecen en la doc, que no es consistente:
# `2026-08-21-1` en los snippets del SDK, `2026-09-09` en la referencia de
# headers, `2026-07-01` en el quickstart. Se prueban todos y gana el que responda.
VERSIONES=(2026-08-21-1 2026-09-09 2026-09-06 2026-08-21 2026-08-14 2026-07-01 "")

SOLO_VERIFICAR=0
[[ "${1:-}" == "--solo-verificar" ]] && SOLO_VERIFICAR=1

if [[ -t 1 ]]; then
  B=$'\033[1m'; V=$'\033[32m'; R=$'\033[31m'; A=$'\033[33m'; X=$'\033[0m'
else
  B=''; V=''; R=''; A=''; X=''
fi
ok()    { printf '  %sok%s    %s\n'  "$V" "$X" "$1"; }
mal()   { printf '  %sMAL%s   %s\n'  "$R" "$X" "$1"; }
aviso() { printf '  %saviso%s %s\n'  "$A" "$X" "$1"; }
titulo(){ printf '\n%s%s%s\n' "$B" "$1" "$X"; }

# ── Leer lo que ya haya ──────────────────────────────────────────────────────
# No se usa `source`: un valor con un `;` o un backtick se ejecutaría como
# comando.
declare -A ACTUAL=()
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue
    [[ "$linea" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    v="${BASH_REMATCH[2]}"; v="${v%\"}"; v="${v#\"}"
    ACTUAL["${BASH_REMATCH[1]}"]="$v"
  done < "$ENV_FILE"
fi

limpiar() {
  local v="$1"
  v="${v//$'\r'/}"; v="${v//$'\n'/}"
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

# preguntar NOMBRE "texto" [oculto] [prefijo_esperado]
preguntar() {
  local nombre="$1" texto="$2" oculto="${3:-no}" prefijo="${4:-}"
  local previo="${ACTUAL[$nombre]:-}" pista="" entrada
  if [[ -n "$previo" ]]; then
    [[ "$oculto" == "si" ]] && pista=" [ya cargado, ...${previo: -4}]" || pista=" [$previo]"
  fi
  while true; do
    printf '%s%s%s\n' "$B" "$texto" "$X"
    printf '  %s%s: ' "$nombre" "$pista"
    # Si `read` falla es fin de entrada (el script corriendo con un pipe, o un
    # Ctrl-D). Sin esta guarda, el loop de validación de prefijo gira para
    # siempre imprimiendo el prompt, o peor: deja escrito un valor a medias.
    if [[ "$oculto" == "si" ]]; then
      read -rs entrada || { printf '\n'; ACTUAL[$nombre]="$previo"; return; }
      printf '\n'
    else
      read -r entrada || { printf '\n'; ACTUAL[$nombre]="$previo"; return; }
    fi
    entrada="$(limpiar "$entrada")"
    [[ -z "$entrada" && -n "$previo" ]] && { ACTUAL[$nombre]="$previo"; return; }
    [[ -z "$entrada" ]] && { aviso "queda vacío, lo completás cuando corras el script de nuevo"; ACTUAL[$nombre]=""; return; }
    if [[ -n "$prefijo" && "$entrada" != "$prefijo"* ]]; then
      mal "tendría que empezar con '$prefijo'. Probá de nuevo, o Enter para dejarlo como está."
      continue
    fi
    ACTUAL[$nombre]="$entrada"; return
  done
}

# Genera un secreto solo si falta. Nunca lo pisa: rotar la firma de sesión
# desloguea el panel, y rotar el password sin querer te deja afuera.
generar_si_falta() {
  local nombre="$1" bytes="${2:-32}"
  if [[ -z "${ACTUAL[$nombre]:-}" ]]; then
    ACTUAL[$nombre]="$(openssl rand -base64 "$bytes" | tr -d '/+=\n' | cut -c1-40)"
    ok "$nombre generado (no hace falta verlo: ya quedó en el archivo)"
  else
    ok "$nombre ya estaba, no se toca"
  fi
}

# probar BASE VERSION ENDPOINT → imprime "HTTP|cuerpo" (cuerpo en una línea)
probar() {
  local base="$1" version="$2" endpoint="$3" args=()
  args=(-sS --max-time 20 -H "Authorization: Bearer $KEY")
  [[ -n "$version" ]] && args+=(-H "Api-Version-Date: $version")
  local cuerpo code
  cuerpo="$(curl "${args[@]}" -w $'\n%{http_code}' "$base$endpoint" 2>/dev/null || printf '\n000')"
  code="${cuerpo##*$'\n'}"
  cuerpo="${cuerpo%$'\n'*}"
  printf '%s|%s' "$code" "$(printf '%s' "$cuerpo" | tr -d '\n')"
}

# ═════════════════════════════════════════════════════════════════════════════
if [[ "$SOLO_VERIFICAR" -eq 0 ]]; then

titulo "1. La API key de Whop"
cat <<'TXT'
  Dashboard → Developer → Account API keys → Create. Con el rol Admin, o
  marcando las 22 permisos que están en el README: POST /payments por sí solo
  exige 13 y recortar da 403 que no dicen qué falta.

  NO hace falta que sepas si es de sandbox o de producción: el script lo detecta
  probando contra las dos APIs. Las keys se ven idénticas, así que no se puede
  saber mirándolas.

  Sandbox: https://sandbox.whop.com/dashboard   (plata que nunca se mueve)
  Producción: https://whop.com/dashboard

TXT
preguntar WHOP_API_KEY "API key (no se muestra mientras la tipeás)" si

cat <<'TXT'

  Ahora el ID de la company que recibe las ventas. Hay que pedirlo y no se puede
  detectar: `GET /accounts/me` necesita el scope company:balance:read, que NO
  está entre las 22 permisos, y `GET /companies/me` devuelve OTRA company (la
  personal del usuario, no la del negocio). Verificado el 2026-09-10.

  Dónde está: en la URL del dashboard, o en Settings. Empieza con biz_.

TXT
preguntar WHOP_COMPANY_ID "ID de la company (biz_...)" no "biz_"

titulo "2. El signing secret del webhook (opcional ahora)"
cat <<'TXT'
  Developer → Webhooks → Create, versión v1, con los eventos payment.succeeded,
  payment.failed, refund.created y dispute.created. Copiá el secret COMPLETO,
  con el prefijo ws_ y sin recodificarlo en base64.
  Si todavía no lo creaste: Enter.

TXT
preguntar WHOP_WEBHOOK_SECRET "Signing secret del webhook" si "ws_"

titulo "3. Los cuatro plan_id (opcional ahora)"
cat <<'TXT'
  Se pide el ID del plan, NO el precio. Es un texto que empieza con `plan_`,
  algo así como plan_a1B2c3D4e5F6g.

  Dónde sacarlo: Dashboard → Checkout links → los tres puntitos (⋮) de la
  opción de precio → Details → clic en el ID para copiarlo.

  El precio no se carga acá: lo define el plan en Whop, y este script te lo va a
  mostrar para que confirmes que es el que esperabas.

  Solo se usan para el seed y para la verificación: la app lee los plan_id de la
  tabla productos. Si no los tenés a mano: Enter en los cuatro.

TXT
preguntar PLAN_FRONT    "plan_id del producto principal" no "plan_"
preguntar PLAN_UPSELL_1 "plan_id del upsell 1"           no "plan_"
preguntar PLAN_UPSELL_2 "plan_id del upsell 2"           no "plan_"
preguntar PLAN_UPSELL_3 "plan_id del upsell 3"           no "plan_"

titulo "4. Base de datos"
[[ -z "${ACTUAL[DATABASE_URL]:-}" ]] && ACTUAL[DATABASE_URL]="postgresql://localhost:5432/checkout"
cat <<'TXT'
  En la VPS es el Postgres nativo en 127.0.0.1:5432, con la base propia de este
  servicio. En local, tu Postgres de desarrollo. No hace falta pooler ni SSL: la
  app es UN proceso largo de PM2 que reusa las conexiones del pool.

TXT
preguntar DATABASE_URL "Connection string de Postgres"

titulo "5. Secretos que se generan solos"
generar_si_falta PANEL_PASSWORD 24
generar_si_falta PANEL_SESSION_SECRET 32
generar_si_falta CRON_SECRET 32

titulo "6. dashboard-admin (opcional ahora)"
preguntar PANEL_INGEST_URL "URL del /api/ingest del panel"
preguntar PANEL_INGEST_KEY "Ingest key del funnel en el panel" si

fi

KEY="${ACTUAL[WHOP_API_KEY]:-}"
BIZ_PEDIDO="${ACTUAL[WHOP_COMPANY_ID]:-}"

# ═════════════════════════════════════════════════════════════════════════════
# Detección de entorno y versión. Es la compuerta del proyecto (P-01 del plan).
# ═════════════════════════════════════════════════════════════════════════════
titulo "Verificación contra Whop — solo lecturas, no cambia nada en tu cuenta"

BASE_OK=""; VERSION_OK=""; BIZ=""; ENTORNO=""
ENTORNO_PROBABLE=""; BASE_PROBABLE=""
declare -A CODE_ENV=()

# Qué endpoints se usan para sondear, y por qué NO los obvios. Todo verificado
# contra la API real el 2026-09-10:
#
#   /accounts/me      403 — pide el scope company:balance:read, que NO está entre
#                     las 22 permisos de la integración. Sirve para el quickstart
#                     de la doc, no para una key con permisos de pago.
#   /companies/me     200 pero DEVUELVE OTRA COMPANY: la personal del usuario, no
#                     la del negocio. Usarla para autodetectar el account_id hace
#                     que todo lo demás consulte la company equivocada.
#   /plans            400 "account_id is required" sin el query param.
#   /products         200 SIN account_id, pero devuelve el CATÁLOGO PÚBLICO de
#                     Whop (20 productos de otros negocios). Trampa peligrosa:
#                     parece que anduvo y no son tus productos.
#
# Entonces: se sondea /companies/<el biz_ que el usuario dio>, que confirma de una
# la key, la versión, el entorno y que la company existe y es legible.
if [[ -n "$BIZ_PEDIDO" ]]; then
  ENDPOINTS=("/companies/$BIZ_PEDIDO" "/plans?account_id=$BIZ_PEDIDO&limit=1")
else
  ENDPOINTS=(/accounts/me)
fi

if [[ -z "$KEY" ]]; then
  aviso "sin WHOP_API_KEY no hay nada que verificar"
elif [[ -z "$BIZ_PEDIDO" ]]; then
  aviso "sin WHOP_COMPANY_ID el sondeo es poco confiable (/accounts/me suele dar 403)"
fi

if [[ -n "$KEY" ]]; then
  printf '\n  Probando contra las dos APIs...\n'
  for par in "sandbox:$BASE_SANDBOX" "produccion:$BASE_PROD"; do
    nombre="${par%%:*}"; base="${par#*:}"
    for endpoint in "${ENDPOINTS[@]}"; do
      for version in "${VERSIONES[@]}"; do
        res="$(probar "$base" "$version" "$endpoint")"
        code="${res%%|*}"; cuerpo="${res#*|}"
        case "$code" in
          200)
            BASE_OK="$base"; VERSION_OK="$version"; ENTORNO="$nombre"
            # El `id` solo se lee cuando el endpoint que respondió es el de la
            # company que el usuario indicó. Nunca de /companies/me: devuelve otra.
            if [[ "$endpoint" == "/companies/$BIZ_PEDIDO" ]]; then
              BIZ="$(printf '%s' "$cuerpo" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")' 2>/dev/null || echo "")"
              titulo_company="$(printf '%s' "$cuerpo" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print("%s | emails de Whop: %s" % (d.get("title",""), d.get("send_customer_emails")))
except Exception: print("")' 2>/dev/null || echo "")"
              [[ -n "$titulo_company" ]] && ok "company: $titulo_company"
            fi
            ok "$nombre + Api-Version-Date ${version:-<sin header>} + $endpoint → 200"
            break 3 ;;
          400)
            # Solo el 400 depende de la versión: se prueba la siguiente.
            continue ;;
          401)
            # 401 es autenticación y no depende ni de la versión ni del endpoint:
            # la key no pertenece a este entorno. No tiene sentido seguir acá.
            CODE_ENV[$nombre]=401; break 2 ;;
          403)
            # 403 es autorización: la key SÍ existe en este entorno. Eso ya es
            # una detección, y hay que conservarla en vez de descartarla.
            CODE_ENV[$nombre]=403
            ENTORNO_PROBABLE="$nombre"; BASE_PROBABLE="$base"
            break ;;
          *)
            CODE_ENV[$nombre]="$code"; break 2 ;;
        esac
      done
    done
    case "${CODE_ENV[$nombre]:-}" in
      401) mal "$nombre → 401: la key no es de este entorno" ;;
      403) mal "$nombre → 403: la key SÍ es de acá, pero le faltan permisos" ;;
      000) mal "$nombre → sin respuesta (red o timeout)" ;;
      "")  ;;
      *)   mal "$nombre → ${CODE_ENV[$nombre]}" ;;
    esac
  done
fi

if [[ -n "$KEY" && -z "$BASE_OK" ]]; then
  if [[ -n "$ENTORNO_PROBABLE" ]]; then
    printf '\n  %sLA KEY ES VÁLIDA Y ES DE %s.%s Le faltan permisos, nada más.\n' \
      "$A" "$(printf '%s' "$ENTORNO_PROBABLE" | tr '[:lower:]' '[:upper:]')" "$X"
    cat <<'TXT'

    403 = autenticado pero sin autorización. Si la key estuviera mal copiada o
    revocada, daría 401 (que es lo que dio el otro entorno).

    Cómo se arregla, en el dashboard de Whop:
      Developer → Account API keys → tu key → Editar permisos
      · lo más rápido: darle el rol Admin
      · o marcar las 22 permisos del README

    Ojo con una trampa de la doc: el nombre cambió. Lo que la guía de KashPay
    llama "Company API keys" hoy figura como "Account API keys".

    Cuando la arregles, volvé a correr:  ./scripts/configurar-env.sh
    Enter en todo lo que ya esté cargado; solo pegá la key de nuevo.
TXT
    # Se guarda el entorno detectado igual: la próxima corrida arranca sabiéndolo.
    ACTUAL[WHOP_API_BASE]="$BASE_PROBABLE"
    [[ "$ENTORNO_PROBABLE" == "sandbox" ]] && ACTUAL[NEXT_PUBLIC_WHOP_ENV]="sandbox" \
                                           || ACTUAL[NEXT_PUBLIC_WHOP_ENV]="production"
    ENTORNO="$ENTORNO_PROBABLE"
  else
    printf '\n  %sCOMPUERTA CERRADA.%s 401 en los dos entornos.\n' "$R" "$X"
    echo   "  La key está mal copiada, tiene un espacio de más, o fue revocada."
    echo   "  Copiala de nuevo del dashboard, completa."
  fi
  echo
  echo "  Con esto NO arranca la ola 2 del plan (§7)."
fi

# El entorno detectado manda sobre lo que hubiera en el archivo: es un hecho
# medido, no una preferencia.
if [[ -n "$BASE_OK" ]]; then
  ACTUAL[WHOP_API_BASE]="$BASE_OK"
  ACTUAL[WHOP_API_VERSION_DATE]="$VERSION_OK"
  [[ "$ENTORNO" == "sandbox" ]] && ACTUAL[NEXT_PUBLIC_WHOP_ENV]="sandbox" \
                                || ACTUAL[NEXT_PUBLIC_WHOP_ENV]="production"
  if [[ -n "$BIZ" ]]; then
    ACTUAL[WHOP_COMPANY_ID]="$BIZ"
    ok "company id detectado solo: $BIZ  (no hace falta que lo tipees)"
  else
    aviso "la respuesta no trajo el id de la company: cargá WHOP_COMPANY_ID a mano"
  fi
fi

: "${ACTUAL[WHOP_API_BASE]:=$BASE_SANDBOX}"
: "${ACTUAL[WHOP_API_VERSION_DATE]:=2026-08-21-1}"
: "${ACTUAL[NEXT_PUBLIC_WHOP_ENV]:=sandbox}"
: "${ACTUAL[NEXT_PUBLIC_BASE_URL]:=http://localhost:3010}"
: "${ACTUAL[WHOP_COMPANY_ID]:=}"

# ── El aviso que importa ─────────────────────────────────────────────────────
if [[ "$ENTORNO" == "produccion" ]]; then
  printf '\n  %s┌─ ESTA KEY ES DE PRODUCCIÓN ────────────────────────────────────┐%s\n' "$R" "$X"
  cat <<'TXT'
    Verificar con ella fue seguro: todo lo de arriba fue GET.

    Lo que NO es seguro es dejar el proyecto apuntado acá para desarrollar:
      · una compra de prueba cobra plata de verdad
      · las tarjetas de prueba de Whop NO funcionan en producción
      · no podés provocar un decline de 3DS ni un "insufficient_funds" sin una
        tarjeta real que efectivamente rebote, y T04 necesita probar los dos
      · un cobro de upsell mal hecho es un contracargo real, no un log

    Creá una key de sandbox en https://sandbox.whop.com/dashboard y volvé a
    correr este script. Los planes de sandbox son OTROS: hay que crearlos ahí.

    Si igual vas a desarrollar contra producción, hacelo con un plan de 1 USD y
    reembolsá cada prueba. Y sabé que el circuito de declines queda sin probar.
TXT
  printf '  %s└────────────────────────────────────────────────────────────────┘%s\n' "$R" "$X"
fi

# ── Escribir ─────────────────────────────────────────────────────────────────
if [[ "$SOLO_VERIFICAR" -eq 0 ]]; then
  esc() { printf '%s' "${ACTUAL[$1]:-}"; }
  {
    echo "# Generado por scripts/configurar-env.sh el $(date '+%Y-%m-%d %H:%M')."
    echo "# Corrélo de nuevo para cambiar algo: lo que dejás en blanco se conserva."
    if [[ -n "$BASE_OK" ]]; then
      echo "# Entorno DETECTADO contra la API: $ENTORNO (GET /accounts/me → 200)."
    fi
    echo
    echo "# ── Whop ──────────────────────────────────────────────────────────────"
    echo "WHOP_API_KEY=$(esc WHOP_API_KEY)"
    echo "WHOP_WEBHOOK_SECRET=$(esc WHOP_WEBHOOK_SECRET)"
    echo "WHOP_COMPANY_ID=$(esc WHOP_COMPANY_ID)"
    echo "WHOP_API_BASE=$(esc WHOP_API_BASE)"
    echo "WHOP_API_VERSION_DATE=$(esc WHOP_API_VERSION_DATE)"
    echo "NEXT_PUBLIC_WHOP_ENV=$(esc NEXT_PUBLIC_WHOP_ENV)"
    echo
    echo "# ── App ───────────────────────────────────────────────────────────────"
    echo "DATABASE_URL=$(esc DATABASE_URL)"
    echo "NEXT_PUBLIC_BASE_URL=$(esc NEXT_PUBLIC_BASE_URL)"
    echo
    echo "# ── Panel de este checkout ────────────────────────────────────────────"
    echo "PANEL_PASSWORD=$(esc PANEL_PASSWORD)"
    echo "PANEL_SESSION_SECRET=$(esc PANEL_SESSION_SECRET)"
    echo
    echo "# ── Salida hacia el dashboard-admin ───────────────────────────────────"
    echo "PANEL_INGEST_URL=$(esc PANEL_INGEST_URL)"
    echo "PANEL_INGEST_KEY=$(esc PANEL_INGEST_KEY)"
    echo
    echo "# ── Cron ──────────────────────────────────────────────────────────────"
    echo "CRON_SECRET=$(esc CRON_SECRET)"
    echo
    echo "# ── Planes: SOLO para el seed y la verificación ────────────────────────"
    echo "# La app lee los plan_id de la tabla productos, no de acá."
    echo "PLAN_FRONT=$(esc PLAN_FRONT)"
    echo "PLAN_UPSELL_1=$(esc PLAN_UPSELL_1)"
    echo "PLAN_UPSELL_2=$(esc PLAN_UPSELL_2)"
    echo "PLAN_UPSELL_3=$(esc PLAN_UPSELL_3)"
  } > "$TMP"

  # Se conservan las variables que alguien agregó a mano: perderlas en silencio
  # sería peor que un archivo desordenado.
  if [[ -f "$ENV_FILE" ]]; then
    extras=0
    while IFS= read -r linea || [[ -n "$linea" ]]; do
      [[ "$linea" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]] || continue
      grep -q "^${BASH_REMATCH[1]}=" "$TMP" && continue
      [[ $extras -eq 0 ]] && { echo >> "$TMP"; echo "# ── Agregadas a mano, conservadas ──────" >> "$TMP"; extras=1; }
      printf '%s\n' "$linea" >> "$TMP"
    done < "$ENV_FILE"
  fi

  # mv y no cp: el reemplazo es atómico. Nunca queda un .env.local a medio
  # escribir si se corta el script o se llena el disco.
  mv "$TMP" "$ENV_FILE"; chmod 600 "$ENV_FILE"

  titulo "Escrito"
  ok "$ENV_FILE (permisos $(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE"))"
  if (cd "$RAIZ" && git check-ignore .env.local >/dev/null 2>&1); then
    ok "git lo ignora"
  else
    mal "GIT NO LO IGNORA. Revisá el .gitignore antes de commitear."
  fi
  printf '  con valor: %s de %s variables\n' \
    "$(grep -cE '^[A-Z0-9_]+=.+' "$ENV_FILE")" "$(grep -cE '^[A-Z0-9_]+=' "$ENV_FILE")"
fi

[[ -z "$BASE_OK" ]] && exit 1

# ═════════════════════════════════════════════════════════════════════════════
# El path de los planes (P-09) y el plan_type de cada uno.
# ═════════════════════════════════════════════════════════════════════════════
printf '\n  %sEl path para listar planes%s (P-09 del plan)\n' "$B" "$X"
args=(-sS -o /dev/null --max-time 20 -H "Authorization: Bearer $KEY")
[[ -n "$VERSION_OK" ]] && args+=(-H "Api-Version-Date: $VERSION_OK")
# CON account_id: sin el query param, /plans devuelve 400 "account_id is
# required". Verificado el 2026-09-10.
code="$(curl "${args[@]}" -w '%{http_code}' "$BASE_OK/plans?account_id=${BIZ_PEDIDO}&limit=1" 2>/dev/null || echo 000)"
case "$code" in
  200) ok "GET /plans?account_id=... → 200. P-09 resuelta: el path existe y EXIGE account_id" ;;
  400) mal "GET /plans → 400: falta un parámetro. Mirá el mensaje: curl -H ... '$BASE_OK/plans?account_id=$BIZ_PEDIDO'" ;;
  404) mal "GET /plans → 404: el path es otro. Anotalo en P-09; el panel tiene el camino manual" ;;
  403) aviso "GET /plans → 403: falta plan:basic:read" ;;
  *)   aviso "GET /plans → $code" ;;
esac

PLANES=()
for n in PLAN_FRONT PLAN_UPSELL_1 PLAN_UPSELL_2 PLAN_UPSELL_3; do
  [[ -n "${ACTUAL[$n]:-}" ]] && PLANES+=("$n=${ACTUAL[$n]}")
done

if [[ ${#PLANES[@]} -eq 0 ]]; then
  printf '\n'; aviso "no cargaste plan_id: no puedo verificar precios ni one_time/renewal (P-02)"
else
  printf '\n  %sLos planes%s — precio real y, sobre todo, one_time vs renewal\n' "$B" "$X"
  HAY_RENEWAL=0
  for par in "${PLANES[@]}"; do
    nombre="${par%%=*}"; pid="${par#*=}"
    args=(-sS --max-time 20 -H "Authorization: Bearer $KEY")
    [[ -n "$VERSION_OK" ]] && args+=(-H "Api-Version-Date: $VERSION_OK")
    linea="$(curl "${args[@]}" "$BASE_OK/plans/$pid" 2>/dev/null | python3 -c '
import json,sys
try: d = json.load(sys.stdin)
except Exception: print("ILEGIBLE"); raise SystemExit
if isinstance(d, dict) and d.get("error"):
    print("ERROR " + str(d["error"].get("message","?"))); raise SystemExit
print("%s|%s|%s" % (d.get("plan_type","?"), d.get("initial_price","?"), d.get("currency","?")))
' 2>/dev/null || echo ILEGIBLE)"
    case "$linea" in
      ILEGIBLE|ERROR*) mal "$nombre ($pid): ${linea#ERROR }" ;;
      *)
        tipo="${linea%%|*}"; resto="${linea#*|}"; precio="${resto%%|*}"; moneda="${resto#*|}"
        if [[ "$tipo" == "one_time" ]]; then ok "$nombre: $precio $moneda, one_time"
        else mal "$nombre: $precio $moneda, plan_type=$tipo ← NO es one_time"; HAY_RENEWAL=1; fi ;;
    esac
  done
  if [[ $HAY_RENEWAL -eq 1 ]]; then
    printf '\n  %sPARÁ ACÁ.%s Al menos un plan no es one_time.\n' "$R" "$X"
    echo   "  Un plan 'renewal' le vuelve a cobrar al comprador el período siguiente,"
    echo   "  solo, sin que este checkout intervenga. Es configuración de Whop, no"
    echo   "  código: arreglalo en el dashboard antes de cobrarle a alguien."
  fi
fi

titulo "Resumen"
printf '  entorno detectado:                  %s\n' "$ENTORNO"
printf '  P-01 (Api-Version-Date + permisos): resuelto → %s\n' "${VERSION_OK:-<sin header>}"
printf '  P-09 (path de planes):              %s\n' "$([[ "$code" == 200 ]] && echo 'resuelto, /plans anda' || echo "pendiente, dio $code")"
if [[ ${#PLANES[@]} -gt 0 ]]; then
  printf '  P-02 (plan_id):                     %s planes verificados\n' "${#PLANES[@]}"
else
  printf '  P-02 (plan_id):                     PENDIENTE\n'
fi
echo
echo "  Pasá estos valores a la Resolución de P-01 y P-09 en"
echo "  tasks/checkout-whop/00-PLAN-CHECKOUT-WHOP.md, y se puede largar la ola 2."
