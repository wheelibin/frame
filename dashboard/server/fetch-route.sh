#!/usr/bin/env bash
# Fetches drive time (traffic-aware) and, optionally, traffic incidents along the route
# for ROUTE_ORIGIN -> ROUTE_DESTINATION into ../ui/route.json -- served to the browser
# from ui/, same split as calendar.ics/weather.json/fact.json.
# Run on a schedule (cron) wherever the dashboard is actually hosted.
set -euo pipefail
cd "$(dirname "$0")"

# Same grep+cut extraction as fetch-calendar.sh -- these are plain lat,lon pairs with no
# shell-special characters, but staying consistent beats mixing extraction styles.
origin=$(grep '^ROUTE_ORIGIN=' dashboard.env | cut -d= -f2-)
destination=$(grep '^ROUTE_DESTINATION=' dashboard.env | cut -d= -f2-)
label=$(grep '^ROUTE_LABEL=' dashboard.env | cut -d= -f2-)
api_key=$(grep '^TOMTOM_API_KEY=' dashboard.env | cut -d= -f2-)
include_incidents=$(grep '^ROUTE_INCLUDE_INCIDENTS=' dashboard.env | cut -d= -f2-)

if [ -z "$origin" ] || [ -z "$destination" ] || [ -z "$api_key" ]; then
  echo "ROUTE_ORIGIN/ROUTE_DESTINATION/TOMTOM_API_KEY not set in dashboard.env -- skipping" >&2
  exit 0
fi

# routeRepresentation=summaryOnly: without it the response includes every lat/lon point
# along the route geometry (confirmed directly -- ~300KB for an 18km route) when all
# app.js actually reads is the summary (and, if enabled, the traffic sections below). No
# reason to fetch, store, and serve that to the kiosk every 15 minutes.
#
# sectionType=traffic (only when incidents are wanted) embeds traffic incidents directly
# in the route response, each with simpleCategory/delayInSeconds/magnitudeOfDelay --
# genuinely on this route, not a guess. First version of this script queried TomTom's
# separate Traffic Incidents API against a bounding box padded around both endpoints
# instead; confirmed directly against this project's real commute that it returned 300+
# incidents (basically every incident in the metro area the bbox happened to cover, not
# "on this route") even with the padding shrunk to near zero -- the bbox approach can't
# distinguish "near the straight line between home and work" from "actually on the road
# you'll drive". sectionType=traffic doesn't have that problem since TomTom itself is
# doing the route-aware filtering.
sections=""
[ "$include_incidents" = "true" ] && sections="&sectionType=traffic"
route=$(curl -sf "https://api.tomtom.com/routing/1/calculateRoute/${origin}:${destination}/json?key=${api_key}&traffic=true&computeTravelTimeFor=all&routeRepresentation=summaryOnly${sections}")

# JSON-encoded via node, not hand-quoted -- ROUTE_LABEL is free text (an apostrophe like
# "Mum's" would break naive "$label" interpolation into the JSON string below). node, not
# python3/jq: this image is node:20-slim with neither of those installed, and node's
# already a hard requirement here regardless.
label_json=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$label")

printf '{"label":%s,"route":%s}' "$label_json" "$route" > ../ui/route.json.tmp
mv ../ui/route.json.tmp ../ui/route.json
