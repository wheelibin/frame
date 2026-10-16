#!/usr/bin/env bash
# Container entrypoint: keep calendar.ics/weather.json fresh in the background (see
# README's "Why every external data source gets fetched server-side" for why these can't
# just be fetched client-side from the frame), then run the server in the foreground as
# the container's main process.
set -euo pipefail
cd "$(dirname "$0")"

(
  while true; do
    ./fetch-calendar.sh || true
    ./fetch-weather.sh || true
    sleep 900
  done
) &

exec python3 dev-server.py
