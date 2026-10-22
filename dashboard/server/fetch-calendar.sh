#!/usr/bin/env bash
# Fetches the iCloud public calendar feed into ../ui/calendar.ics -- the server reads its
# own config from here (server/), but calendar.ics itself is served to the browser from
# ui/, same split as config.local.js/weather.json.
# Run on a schedule (cron) wherever the dashboard is actually hosted.
set -euo pipefail
cd "$(dirname "$0")"
# Extracted, not `source`d -- a share URL can contain `&`/`?` which `source` would parse
# as shell syntax (`&` backgrounds a command) rather than literal characters. grep+cut
# treats the whole line as plain text, so nothing in the value gets interpreted.
url=$(grep '^CALENDAR_URL=' dashboard.env | cut -d= -f2-)
if ! curl -sf --retry 3 --retry-all-errors "$url" -o ../ui/calendar.ics.tmp; then
  echo "fetch failed" >&2
  exit 1
fi
mv ../ui/calendar.ics.tmp ../ui/calendar.ics
