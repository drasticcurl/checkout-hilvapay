#!/usr/bin/env bash
#
# configurar-telegram.sh — deja el bot de avisos andando en un solo comando.
#
# Existe porque el bot era el pendiente más tonto del proyecto: cinco variables
# que hay que averiguar en tres lugares distintos, más un `curl` de `setWebhook`
# que se escribe mal la primera vez, más editar a mano el `.env.production` de la
# VPS. Nada de eso es difícil; es exactamente el tipo de tarea que se posterga
# para siempre. Y sin bot, una disputa se descubre cuando llega el contracargo en
# vez de en quince minutos.
#
# QUÉ HACE, en orden:
#   1. Pide el token del bot y lo VERIFICA contra `getMe` de Telegram.
#   2. Genera los dos secretos que nadie tiene ganas de inventar
#      (`TELEGRAM_WEBHOOK_SECRET` y `TELEGRAM_CODIGO_REGISTRO`).
#   3. Espera a que le mandes un mensaje al bot y saca tu `chat_id` de
#      `getUpdates`, así no hay que mandar `/id` ni leer un número a mano.
#   4. Registra el webhook con `setWebhook` y confirma con `getWebhookInfo`.
#   5. Escribe las cinco variables donde vayan: `.env.local` en local, o el
#      `shared/.env.production` de la VPS con `--produccion`.
#
# LO ÚNICO QUE NO PUEDE HACER es crear el bot: eso es una conversación con
# @BotFather dentro de Telegram y no tiene API. El script te dice qué escribirle.
#
# Uso:
#   ./scripts/configurar-telegram.sh                # escribe .env.local
#   ./scripts/configurar-telegram.sh --produccion   # escribe en la VPS por ssh
#   ./scripts/configurar-telegram.sh --verificar     # no toca nada, solo diagnostica

set -euo pipefail

# El token del bot pasa por variables y por archivos temporales: nacen sin
# permisos para nadie más.
umask 077

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_LOCAL="$RAIZ/.env.local"

# El host de la VPS y la ruta del env compartido. Coinciden con COMO-DEPLOYAR.md.
SSH_VPS="${SSH_VPS:-funnel-vps}"
ENV_PROD_REMOTO="/srv/hilvapay/shared/.env.production"
PM2_APP="hilvapay-3020"

MODO="local"
case "${1:-}" in
  --produccion) MODO="produccion" ;;
  --verificar)  MODO="verificar" ;;
  "")           MODO="local" ;;
  *) echo "Uso: $0 [--produccion|--verificar]" >&2; exit 2 ;;
esac

if [[ -t 1 ]]; then
  B=$'\033[1m'; V=$'\033[32m'; R=$'\033[31m'; A=$'\033[33m'; X=$'\033[0m'
else
  B=''; V=''; R=''; A=''; X=''
fi
ok()    { printf '  %sok%s    %s\n'  "$V" "$X" "$1"; }
mal()   { printf '  %sMAL%s   %s\n'  "$R" "$X" "$1"; }
aviso() { printf '  %saviso%s %s\n'  "$A" "$X" "$1"; }
titulo(){ printf '\n%s%s%s\n' "$B" "$1" "$X"; }

for cmd in curl python3; do
  command -v "$cmd" >/dev/null || { mal "hace falta $cmd"; exit 1; }
done

# `python3` y no `jq`: jq no está garantizado en una Mac limpia ni en la VPS, y
# python3 sí está en las dos. Solo se usa para leer JSON, nunca para escribirlo.
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null || true; }

# ── Leer lo que ya haya, sin `source` ────────────────────────────────────────
# `source` ejecutaría un valor con backticks o `;` como comando.
leer_env() {
  local archivo="$1" clave="$2"
  [[ -f "$archivo" ]] || return 0
  local linea v
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue
    [[ "$linea" =~ ^"$clave"=(.*)$ ]] || continue
    v="${BASH_REMATCH[1]}"; v="${v%\"}"; v="${v#\"}"
    printf '%s' "$v"
    return 0
  done < "$archivo"
}

leer_env_remoto() {
  ssh "$SSH_VPS" "grep -m1 '^$1=' '$ENV_PROD_REMOTO' 2>/dev/null | cut -d= -f2- | tr -d '\"'" 2>/dev/null || true
}

# ── La URL pública del webhook ──────────────────────────────────────────────
# Sale de NEXT_PUBLIC_BASE_URL y no se hardcodea: el día que cambie el dominio,
# este script lo sigue sin que nadie lo edite.
if [[ "$MODO" == "produccion" || "$MODO" == "verificar" ]]; then
  BASE_URL="$(leer_env_remoto NEXT_PUBLIC_BASE_URL)"
  [[ -n "$BASE_URL" ]] || BASE_URL="$(leer_env "$ENV_LOCAL" NEXT_PUBLIC_BASE_URL)"
else
  BASE_URL="$(leer_env "$ENV_LOCAL" NEXT_PUBLIC_BASE_URL)"
fi
BASE_URL="${BASE_URL%/}"
URL_WEBHOOK="$BASE_URL/api/telegram/webhook"

# ─────────────────────────── Modo verificar ─────────────────────────────────
if [[ "$MODO" == "verificar" ]]; then
  titulo "Diagnóstico del bot"
  TOKEN="$(leer_env_remoto TELEGRAM_BOT_TOKEN)"
  [[ -n "$TOKEN" ]] || TOKEN="$(leer_env "$ENV_LOCAL" TELEGRAM_BOT_TOKEN)"

  if [[ -z "$TOKEN" ]]; then
    mal "no hay TELEGRAM_BOT_TOKEN ni en la VPS ni en .env.local"
    echo ""
    echo "  Corré el script sin --verificar para configurarlo."
    exit 1
  fi

  RESP="$(curl -sS --max-time 15 "https://api.telegram.org/bot$TOKEN/getMe" || true)"
  if [[ "$(printf '%s' "$RESP" | json 'd.get("ok")')" == "True" ]]; then
    ok "token válido — el bot es @$(printf '%s' "$RESP" | json 'd["result"]["username"]')"
  else
    mal "Telegram rechazó el token: $(printf '%s' "$RESP" | json 'd.get("description","sin detalle")')"
    exit 1
  fi

  RESP="$(curl -sS --max-time 15 "https://api.telegram.org/bot$TOKEN/getWebhookInfo" || true)"
  URL_REG="$(printf '%s' "$RESP" | json 'd["result"].get("url","")')"
  if [[ -z "$URL_REG" ]]; then
    mal "el webhook NO está registrado"
  elif [[ "$URL_REG" == "$URL_WEBHOOK" ]]; then
    ok "webhook registrado y apunta acá: $URL_REG"
  else
    aviso "webhook registrado en OTRA url: $URL_REG (esperada: $URL_WEBHOOK)"
  fi
  PEND="$(printf '%s' "$RESP" | json 'd["result"].get("pending_update_count",0)')"
  [[ "$PEND" == "0" ]] || aviso "$PEND updates pendientes (Telegram no los pudo entregar)"
  ULT="$(printf '%s' "$RESP" | json 'd["result"].get("last_error_message","")')"
  [[ -z "$ULT" ]] || aviso "último error de Telegram: $ULT"
  exit 0
fi

# ─────────────────────────── 1. El token ────────────────────────────────────
titulo "1. El bot"
cat <<'AYUDA'
  Si todavía no lo creaste, abrí Telegram y hablale a @BotFather:

      /newbot
      → nombre:    Hilvapay Avisos
      → username:  algo que termine en "bot", ej. hilvapay_avisos_bot

  BotFather te devuelve un token con la forma 123456789:AAE...
AYUDA
echo ""
printf '  Token del bot: '
read -rs TOKEN
echo ""
[[ -n "$TOKEN" ]] || { mal "sin token no hay nada que configurar"; exit 1; }

RESP="$(curl -sS --max-time 15 "https://api.telegram.org/bot$TOKEN/getMe" || true)"
if [[ "$(printf '%s' "$RESP" | json 'd.get("ok")')" != "True" ]]; then
  mal "Telegram rechazó el token: $(printf '%s' "$RESP" | json 'd.get("description","sin detalle")')"
  echo "     Revisá que lo hayas copiado completo, incluido lo de antes de los dos puntos."
  exit 1
fi
BOT_USER="$(printf '%s' "$RESP" | json 'd["result"]["username"]')"
ok "token válido — el bot es @$BOT_USER"

# ─────────────────────────── 2. Los secretos ────────────────────────────────
titulo "2. Los dos secretos"
# Se conservan si ya existían: regenerarlos invalidaría el webhook registrado y
# el código de alta que alguien del equipo ya tenga anotado.
if [[ "$MODO" == "produccion" ]]; then
  WEBHOOK_SECRET="$(leer_env_remoto TELEGRAM_WEBHOOK_SECRET)"
  CODIGO="$(leer_env_remoto TELEGRAM_CODIGO_REGISTRO)"
else
  WEBHOOK_SECRET="$(leer_env "$ENV_LOCAL" TELEGRAM_WEBHOOK_SECRET)"
  CODIGO="$(leer_env "$ENV_LOCAL" TELEGRAM_CODIGO_REGISTRO)"
fi

if [[ -n "$WEBHOOK_SECRET" ]]; then
  ok "TELEGRAM_WEBHOOK_SECRET ya existía, se conserva"
else
  # `openssl rand` y no $RANDOM: $RANDOM tiene 15 bits y es predecible.
  WEBHOOK_SECRET="$(openssl rand -hex 24)"
  ok "TELEGRAM_WEBHOOK_SECRET generado"
fi
if [[ -n "$CODIGO" ]]; then
  ok "TELEGRAM_CODIGO_REGISTRO ya existía, se conserva"
else
  # Más corto: alguien lo va a tipear en Telegram para darse de alta.
  CODIGO="$(openssl rand -hex 6)"
  ok "TELEGRAM_CODIGO_REGISTRO generado: $CODIGO"
fi

# ─────────────────────────── 3. El chat id ──────────────────────────────────
titulo "3. Tu chat id"
echo "  Abrí Telegram, buscá @$BOT_USER y mandale cualquier mensaje (o /start)."
echo "  Telegram NO deja que un bot escriba primero, así que este paso es"
echo "  obligatorio: sin tu mensaje, el bot no puede avisarte nada."
echo ""
printf '  Cuando lo hayas mandado, apretá Enter...'
read -r _

# `getUpdates` solo devuelve algo si el webhook NO está registrado todavía: con
# webhook activo Telegram entrega por ahí y la cola de polling queda vacía. Por
# eso este paso va ANTES del setWebhook, y no después.
CHAT_ID=""
for intento in 1 2 3; do
  RESP="$(curl -sS --max-time 15 "https://api.telegram.org/bot$TOKEN/getUpdates" || true)"
  CHAT_ID="$(printf '%s' "$RESP" | json '
    next((str(u["message"]["chat"]["id"]) for u in reversed(d.get("result",[]))
          if "message" in u and "chat" in u["message"]), "")')"
  [[ -n "$CHAT_ID" ]] && break
  [[ $intento -lt 3 ]] && { aviso "todavía no llegó nada, reintentando en 3 s..."; sleep 3; }
done

if [[ -z "$CHAT_ID" ]]; then
  aviso "no se pudo leer el chat id automáticamente"
  echo "     Puede pasar si el webhook ya estaba registrado: entonces Telegram"
  echo "     entrega los mensajes ahí y getUpdates viene vacío."
  echo ""
  printf '  Poné tu chat id a mano (te lo dice /id en el bot): '
  read -r CHAT_ID
  [[ -n "$CHAT_ID" ]] || { mal "sin chat id el bot no puede avisarte"; exit 1; }
else
  ok "chat id detectado: $CHAT_ID"
fi

# ─────────────────────────── 4. El webhook ──────────────────────────────────
titulo "4. Registrar el webhook"
if [[ -z "$BASE_URL" ]]; then
  mal "no se pudo resolver NEXT_PUBLIC_BASE_URL, así que no sé qué URL registrar"
  exit 1
fi
echo "  URL: $URL_WEBHOOK"
RESP="$(curl -sS --max-time 20 -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
  --data-urlencode "url=$URL_WEBHOOK" \
  --data-urlencode "secret_token=$WEBHOOK_SECRET" || true)"
if [[ "$(printf '%s' "$RESP" | json 'd.get("ok")')" == "True" ]]; then
  ok "webhook registrado"
else
  mal "setWebhook falló: $(printf '%s' "$RESP" | json 'd.get("description","sin detalle")')"
  echo "     Si dice 'HTTPS url must be provided', el dominio todavía no tiene TLS."
  exit 1
fi

RESP="$(curl -sS --max-time 15 "https://api.telegram.org/bot$TOKEN/getWebhookInfo" || true)"
URL_REG="$(printf '%s' "$RESP" | json 'd["result"].get("url","")')"
[[ "$URL_REG" == "$URL_WEBHOOK" ]] && ok "confirmado con getWebhookInfo" \
  || aviso "getWebhookInfo devolvió: $URL_REG"

# ─────────────────────────── 5. Escribir las variables ──────────────────────
titulo "5. Guardar las variables"

# Se arma el bloque una sola vez y se usa para los dos destinos: así local y
# producción no pueden divergir en el nombre de una variable.
bloque_env() {
  cat <<EOF
TELEGRAM_BOT_TOKEN="$TOKEN"
TELEGRAM_WEBHOOK_SECRET="$WEBHOOK_SECRET"
TELEGRAM_CHAT_ID_ADMIN="$CHAT_ID"
TELEGRAM_CODIGO_REGISTRO="$CODIGO"
TELEGRAM_AVISAR_VENTAS="1"
EOF
}

if [[ "$MODO" == "local" ]]; then
  TMP="$(mktemp "${TMPDIR:-/tmp}/tg.XXXXXX")"
  trap 'rm -f "$TMP"' EXIT INT TERM
  # Se sacan las cinco líneas viejas y se agregan las nuevas al final: así no
  # quedan duplicadas, que en un .env gana la última y confunde al que lo lee.
  if [[ -f "$ENV_LOCAL" ]]; then
    grep -vE '^TELEGRAM_(BOT_TOKEN|WEBHOOK_SECRET|CHAT_ID_ADMIN|CODIGO_REGISTRO|AVISAR_VENTAS)=' \
      "$ENV_LOCAL" > "$TMP" || true
  fi
  { echo ""; echo "# Bot de avisos. Escrito por scripts/configurar-telegram.sh."; bloque_env; } >> "$TMP"
  mv "$TMP" "$ENV_LOCAL"
  chmod 600 "$ENV_LOCAL"
  trap - EXIT INT TERM
  ok "escritas en .env.local (chmod 600)"
  echo ""
  echo "  Reiniciá el dev server para que las tome."
else
  # En la VPS se hace igual pero por ssh, con backup y sin que el token toque el
  # disco local. `bash -s` recibe el script por stdin para no dejar el token en
  # la línea de comandos, donde lo vería cualquier `ps`.
  bloque_env | ssh "$SSH_VPS" "
    set -e
    F='$ENV_PROD_REMOTO'
    cp -p \"\$F\" \"\$F.bak-telegram-\$(date +%Y%m%d%H%M%S)\"
    NUEVO=\$(cat)
    grep -vE '^TELEGRAM_(BOT_TOKEN|WEBHOOK_SECRET|CHAT_ID_ADMIN|CODIGO_REGISTRO|AVISAR_VENTAS)=' \"\$F\" > \"\$F.tmp\" || true
    { echo ''; echo '# Bot de avisos. Escrito por scripts/configurar-telegram.sh.'; printf '%s\n' \"\$NUEVO\"; } >> \"\$F.tmp\"
    mv \"\$F.tmp\" \"\$F\"
    chmod 600 \"\$F\"
    echo '  ok    escritas en '\$F' (chmod 600, con backup)'
    pm2 reload $PM2_APP --update-env >/dev/null 2>&1 && echo '  ok    pm2 recargado' || echo '  aviso pm2 no se pudo recargar, hacelo a mano'
  "
fi

titulo "Listo"
echo "  Probalo: /admin/alertas → \"Mandar una prueba\"."
echo "  Para sumar a alguien más: que le mande  /alta $CODIGO  al bot."
echo "  Para volver a diagnosticar: $0 --verificar"
