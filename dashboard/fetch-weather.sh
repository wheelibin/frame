#!/usr/bin/env bash
# Fetches current weather + today's forecast into weather.json, next to this script.
# Run on a schedule (cron) wherever the dashboard is actually hosted.
#
# Needed because this frame's WebView has no ISRG Root X1 (Let's Encrypt's root CA) in
# its trust store, so it can't talk to api.open-meteo.com (or any other Let's Encrypt
# site) directly -- same fix pattern as the iCloud calendar: fetch where TLS trust isn't
# an issue, serve the result same-origin.
set -euo pipefail
cd "$(dirname "$0")"

# Same location source as the page itself: config.local.js (gitignored, real location)
# if present, else config.js (committed placeholder). Keeps one source of truth instead
# of hardcoding coordinates separately here too.
conf=config.js
[ -f config.local.js ] && conf=config.local.js
lat=$(grep -oE 'WEATHER_LAT *= *[0-9.-]+' "$conf" | grep -oE '[0-9.-]+$')
lon=$(grep -oE 'WEATHER_LON *= *[0-9.-]+' "$conf" | grep -oE '[0-9.-]+$')
base="https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&timezone=auto"

# minutely_15: 15-minute-resolution precipitation for a "rain expected in X min" style
# readout, next 4 hours (16 slots). Only actually available for some regions/models; falls
# back the same as daily if the combined request errors.
full="$base&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&minutely_15=precipitation,precipitation_probability&forecast_minutely_15=16"

if ! curl -sf "$full" -o weather.json.tmp; then
  echo "fetch failed" >&2
  exit 1
fi
if grep -q '"error":true' weather.json.tmp; then
  echo "daily/minutely forecast unavailable upstream, falling back to current-only" >&2
  curl -sf "$base&current=temperature_2m,weather_code" -o weather.json.tmp
fi
mv weather.json.tmp weather.json
