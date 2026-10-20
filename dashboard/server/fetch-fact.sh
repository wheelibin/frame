#!/usr/bin/env bash
# Fetches a random fact into ../ui/fact.json -- served to the browser from ui/, same split
# as config.local.js/calendar.ics/weather.json. The /random endpoint returns a different
# fact on every call, so staying "one fact per day" is entirely on the caller -- see
# entrypoint.sh's dedicated midnight-only loop for this script, not the shared 15-minute one.
set -euo pipefail
cd "$(dirname "$0")"

curl -sf "https://uselessfacts.jsph.pl/api/v2/facts/random" -o ../ui/fact.json.tmp
mv ../ui/fact.json.tmp ../ui/fact.json
