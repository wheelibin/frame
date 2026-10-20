#!/usr/bin/env bash
# Container entrypoint: keep calendar.ics/weather.json/fact.json/route.json fresh in the
# background (see README's "Why every external data source gets fetched server-side" for
# why these can't just be fetched client-side from the frame), then run the server in the
# foreground as the container's main process.
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
    sleep 900
  done
) &

# fact.json gets its own loop, not lumped into the one above -- fetch-fact.sh now hits
# /api/v2/facts/random, which returns a different fact on every call, so this has to run
# once a day (at midnight) rather than every 15 minutes or the displayed fact would change
# throughout the day.
(
  while true; do
    ./server/fetch-fact.sh || true
    sleep "$(($(date -d "tomorrow 00:00:00" +%s) - $(date +%s)))"
  done
) &

# route.json gets its own loop, not lumped into the one above -- traffic conditions can
# shift quickly during a commute, so while ROUTE_FAST_WINDOW is active it polls much more
# often than the other three. Both ROUTE_FAST_WINDOW (same "HH:MM-HH:MM" format as
# HA_DOG_FED_MORNING_WINDOW) and ROUTE_FAST_INTERVAL_SECONDS live in server/dashboard.env;
# outside the window, or if either is unset, this just falls back to the same 900s
# cadence as everything else.
(
  while true; do
    ./server/fetch-route.sh || true
    interval=900
    window=$(grep '^ROUTE_FAST_WINDOW=' server/dashboard.env | cut -d= -f2-)
    fast_interval=$(grep '^ROUTE_FAST_INTERVAL_SECONDS=' server/dashboard.env | cut -d= -f2-)
    if [ -n "$window" ] && [ -n "$fast_interval" ]; then
      start="${window%-*}"
      end="${window#*-}"
      now=$(date +%H:%M)
      if [[ "$now" > "$start" && "$now" < "$end" ]]; then
        interval="$fast_interval"
      fi
    fi
    sleep "$interval"
  done
) &

exec node server/server.js
