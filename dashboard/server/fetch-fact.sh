#!/usr/bin/env bash
# Fetches today's random fact into ../ui/fact.json -- served to the browser from ui/, same
# split as config.local.js/calendar.ics/weather.json. "today" means the same fact all day
# (the API itself rotates it once every 24h), matching one fetch per cron run instead of
# needing any date logic here.
# Run on a schedule (cron) wherever the dashboard is actually hosted.
set -euo pipefail
cd "$(dirname "$0")"

curl -sf "https://uselessfacts.jsph.pl/api/v2/facts/today" -o ../ui/fact.json.tmp
mv ../ui/fact.json.tmp ../ui/fact.json
