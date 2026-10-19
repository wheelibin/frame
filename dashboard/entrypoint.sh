#!/usr/bin/env bash
# Container entrypoint: keep calendar.ics/weather.json/fact.json fresh in the background
# (see README's "Why every external data source gets fetched server-side" for why these
# can't just be fetched client-side from the frame), then run the server in the foreground
# as the container's main process.
set -euo pipefail
cd "$(dirname "$0")"

# Node's Intl/Date machinery resolves the local zone from TZ, not from /etc/localtime --
# see docker-compose.yml's comment on the /etc/timezone bind mount. Exporting TZ from its
# contents is what actually makes Node pick up the host's real zone.
[ -f /etc/timezone ] && export TZ="$(cat /etc/timezone)"

(
  while true; do
    ./server/fetch-calendar.sh || true
    ./server/fetch-weather.sh || true
    ./server/fetch-fact.sh || true
    sleep 900
  done
) &

exec node server/server.js
