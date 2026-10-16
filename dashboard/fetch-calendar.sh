#!/usr/bin/env bash
# Fetches the iCloud public calendar feed into calendar.ics, next to this script.
# Run on a schedule (cron) wherever the dashboard is actually hosted.
set -euo pipefail
cd "$(dirname "$0")"
url=$(cat calendar-url.txt)
curl -sf "$url" -o calendar.ics.tmp
mv calendar.ics.tmp calendar.ics
