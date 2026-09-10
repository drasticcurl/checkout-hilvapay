#!/usr/bin/env bash
#
# pegar-cron.sh <ruta> — le pega a un endpoint de /api/cron/* con el CRON_SECRET.
#
# Uso:
#   pegar-cron.sh /api/cron/reconciliar
#   pegar-cron.sh /api/cron/vigilar
#
# ── Por qué existe, si ya hay drenar-salidas.sh ──────────────────────────────
# Porque son tres crons y la lógica es la misma: leer el secreto, pegarle a
# 127.0.0.1 y loguear la respuesta. `drenar-salidas.sh` ya está instalado en el
# crontab de producción y funciona, así que no se toca — pero los dos crons
# nuevos entran por acá y no por una copia más de ese archivo.
#
# Si algún día se quiere unificar, la línea del crontab de salidas pasa a ser
# `pegar-cron.sh /api/cron/salidas` y `drenar-salidas.sh` se puede borrar. Es un
# cambio de una línea, y hasta que se haga las dos vías conviven sin problema.
#
# ── Las dos razones por las que esto es un script y no una línea de crontab ──
#
#   1. EN UN CRONTAB, `%` ES UN CARACTER ESPECIAL: cron lo traduce a un salto de
#      línea y todo lo que sigue se le pasa al comando por stdin. Un
#      `curl -w '%{http_code}'` escrito directo en el crontab se corta en el `%`
#      y el resto del comando desaparece. Habría que escaparlo como `\%`, que es
#      exactamente el tipo de detalle que alguien "limpia" en seis meses.
#
#   2. `source` del .env.production entero metería TODOS los secretos —incluida
#      la WHOP_API_KEY— en el entorno del proceso de curl, legibles en
#      /proc/<pid>/environ. Acá se lee UNA variable con sed.
#
# Salida: una línea por corrida, con la respuesta JSON del endpoint y el código
# HTTP. La respuesta completa y no solo el código: es lo que permite ver de un
# vistazo si la reconciliación está rescatando cobros o si el vigilante detecta
# cosas que no puede avisar (`sinCanal` > 0).

set -uo pipefail

RUTA="${1:-}"
if [[ -z "$RUTA" ]]; then
  echo "uso: $(basename "$0") /api/cron/<endpoint>" >&2
  exit 2
fi

# Allowlist explícita. Este script corre desde el crontab con el secreto de los
# crons a mano: que solo pueda apuntar a las rutas previstas evita que un
# argumento equivocado (o un pegado a medias) le mande el Bearer a otro endpoint.
case "$RUTA" in
  /api/cron/salidas | /api/cron/reconciliar | /api/cron/vigilar) ;;
  *)
    echo "ruta no permitida: $RUTA" >&2
    exit 2
    ;;
esac

ENV_FILE="${ENV_FILE:-/srv/hilvapay/shared/.env.production}"
PUERTO="${PUERTO:-3020}"
URL="http://127.0.0.1:${PUERTO}${RUTA}"

# `+%Y-...` y no `date -Is`: el `-I` es de GNU date y en macOS (BSD) falla con
# "invalid argument", dejando el log con la marca de tiempo vacía. La VPS es
# Ubuntu, pero este script también se corre a mano en local para probarlo.
marca() { printf '[%s] %s ' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$RUTA"; }

if [[ ! -r "$ENV_FILE" ]]; then
  marca; echo "ERROR: no puedo leer $ENV_FILE (¿corriendo con el usuario equivocado?)"
  exit 1
fi

# Solo CRON_SECRET, no el archivo entero. `sed -n s///p` toma la primera
# ocurrencia y `tr -d` limpia comillas y el \r de un archivo editado en Windows,
# que es invisible y hace que el Bearer no matchee nunca.
SECRET="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | head -n1 | tr -d '"'"'"'[:space:]')"

if [[ -z "$SECRET" ]]; then
  marca; echo "ERROR: CRON_SECRET vacío o ausente en $ENV_FILE"
  exit 1
fi

# `-m 60`: la reconciliación hace hasta dos llamadas a la API de Whop por cobro,
# con 20 cobros por corrida y 15 s de timeout cada una. El techo es generoso a
# propósito, pero existe: sin límite, un cuelgue deja procesos de curl
# acumulándose uno por corrida hasta llenar la tabla de procesos.
RESPUESTA="$(curl -sS -m 60 -w '\n%{http_code}' \
  -H "Authorization: Bearer ${SECRET}" \
  "$URL" 2>&1)"

CODIGO="${RESPUESTA##*$'\n'}"
CUERPO="${RESPUESTA%$'\n'*}"

marca
if [[ "$CODIGO" == "200" ]]; then
  echo "ok  $CUERPO"
  exit 0
fi

# 401 acá significa que el CRON_SECRET del archivo no coincide con el que tiene
# la app corriendo: pasa después de rotar el secreto sin recargar PM2.
echo "FALLO http=$CODIGO  $CUERPO"
exit 1
