#!/usr/bin/env bash
#
# drenar-salidas.sh — pega en /api/cron/salidas para que la cola `salidas` se
# vacíe: reporta las ventas al dashboard-admin y manda los emails de entrega.
#
# Lo llama el crontab cada minuto (ver cron.hilvapay). Existe como script y NO
# como una línea de crontab por DOS razones, las dos aprendidas a golpes:
#
#   1. EN UN CRONTAB, `%` ES UN CARACTER ESPECIAL: cron lo traduce a un salto de
#      línea y todo lo que sigue se le pasa al comando por stdin. Un
#      `curl -w '%{http_code}'` escrito directo en el crontab se corta en el `%`
#      y el resto del comando desaparece. Habría que escaparlo como `\%`, que es
#      exactamente el tipo de detalle que alguien "limpia" en seis meses.
#
#   2. `source` del .env.production entero metía TODOS los secretos —incluida la
#      WHOP_API_KEY— en el entorno del proceso de curl, legibles en
#      /proc/<pid>/environ. Y una sola línea mal formada en ese archivo rompía el
#      cron sin decir por qué. Acá se lee UNA variable con sed.
#
# Salida: una línea por corrida al log, con la respuesta JSON del endpoint
# ({tomadas, enviadas, fallidas, omitidas}) y el código HTTP.

set -uo pipefail

ENV_FILE="${ENV_FILE:-/srv/hilvapay/shared/.env.production}"
PUERTO="${PUERTO:-3020}"
URL="http://127.0.0.1:${PUERTO}/api/cron/salidas"

# `+%Y-...` y no `date -Is`: el `-I` es de GNU date y en macOS (BSD) falla con
# "invalid argument", dejando el log con la marca de tiempo vacía. La VPS es
# Ubuntu, pero este script también se corre a mano en local para probarlo.
marca() { printf '[%s] ' "$(date '+%Y-%m-%dT%H:%M:%S%z')"; }

if [[ ! -r "$ENV_FILE" ]]; then
  marca; echo "ERROR: no puedo leer $ENV_FILE (¿corriendo con el usuario equivocado?)"
  exit 1
fi

# Solo CRON_SECRET, no el archivo entero. `sed -n s///p` toma la primera
# ocurrencia y `tr -d` limpia comillas y el \r de un archivo editado en Windows,
# que es invisible y hace que el Bearer no matchee nunca.
SECRET="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | head -n1 | tr -d '"'"'"'[:space:]')"

if [[ -z "$SECRET" ]]; then
  marca; echo "ERROR: CRON_SECRET vacío o ausente en $ENV_FILE — la cola no se drena"
  exit 1
fi

# `-m 20`: el handler tiene su propio timeout de 5 s por fila y toma hasta 20
# filas. Sin límite acá, un cuelgue deja procesos de curl acumulándose un por
# minuto hasta llenar la tabla de procesos.
RESPUESTA="$(curl -sS -m 20 -w '\n%{http_code}' \
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
