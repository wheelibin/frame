#!/usr/bin/env bash
# Fetches the iCloud public calendar feed into calendar.ics, next to this script.
# Run on a schedule (cron) wherever the dashboard is actually hosted.
set -euo pipefail
cd "$(dirname "$0")"
# Extracted, not `source`d -- a share URL can contain `&`/`?` which `source` would parse
# as shell syntax (`&` backgrounds a command) rather than literal characters. grep+cut
# treats the whole line as plain text, so nothing in the value gets interpreted.
url=$(grep '^CALENDAR_URL=' dashboard.env | cut -d= -f2-)
curl -sf "$url" -o calendar.ics.tmp
mv calendar.ics.tmp calendar.ics
