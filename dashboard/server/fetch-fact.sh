#!/usr/bin/env bash
# Fetches a random fact into ../ui/fact.json -- served to the browser from ui/, same split
# as config.local.js/calendar.ics/weather.json. The /random endpoint returns a different
# fact on every call, so staying "one fact per day" is entirely on the caller -- see
# entrypoint.sh's dedicated midnight-only loop for this script, not the shared 15-minute one.
set -euo pipefail
cd "$(dirname "$0")"

# --retry-all-errors: this only runs once a day (see entrypoint.sh's midnight loop), so a
# single transient failure here would otherwise leave fact.json stale for a full extra
# day with no second chance. curl's own backoff (1s/2s/4s) covers that, not a hand-rolled
# retry loop.
if ! curl -sf --retry 3 --retry-all-errors "https://uselessfacts.jsph.pl/api/v2/facts/random" -o ../ui/fact.json.tmp; then
  echo "fetch failed" >&2
  exit 1
fi
mv ../ui/fact.json.tmp ../ui/fact.json
