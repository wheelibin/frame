# Dashboard

Plain HTML/CSS/JS, no build step — deliberately, since the frame's stock WebView doesn't
need anything a bundler would buy us, and this is meant to hand off to a home server as-is.

Two folders:

- `ui/` — everything the kiosk's browser loads: `index.html`, `app.js`, `style.css`,
  `config.js`/`config.local.js`, fonts, icons, and the cron-refreshed `calendar.ics`/
  `weather.json` data files. Subject to the WebView 44 constraints below.
- `server/` — `server.js` (Express) plus the `fetch-calendar.sh`/`fetch-weather.sh` scripts
  that write into `../ui`, and `dashboard.env` (gitignored). Runs under a normal
  current Node, not the WebView, so none of the WebView 44 constraints apply here.

Everything else (`Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, `deploy.sh`,
`dev-deploy.sh`) stays at the `dashboard/` root, since Docker/deploy need both folders
together, not just one.

## The WebView 44 trap (historical — fixed via WebView upgrade)

This frame originally shipped WebView **44** (from ~2015/16). Modern JS syntax that feels
completely safe to use today caused a **silent syntax error that killed the entire
script** — not just the feature that used it. First version of `app.js` used
`async`/`await` (needs Chrome 55+) and array destructuring (needs Chrome 49+); the result
was that even the clock, in the same file but with no connection to the calendar code,
stopped updating. No console visible on-device to see the actual error — the only symptom
was "nothing happens." Later in the same build, a Prettier-added trailing comma in a
multi-line call (valid ES2017+, invalid on this engine) reproduced the exact same failure
— confirming this wasn't a one-off, it's a real recurring hazard class on this engine.

**The system WebView has since been upgraded to 106** (sideloaded via the upstream repo's
`allwinner-a33-pf1007l.md` §6 procedure — see
[`docs/pf1007l-webview-106.md`](../docs/pf1007l-webview-106.md) for exactly what was done
on this unit, verified hashes, and the rollback path). All of the constraints below are
now historical, not live:

**Was known-safe**: `var`, plain `function`, `.then()`/`.catch()` promise chains,
`fetch()`, regular string concatenation, `for` loops, array `.filter()`/`.sort()`/`.map()`.
**Was known-unsafe**: `async`/`await`, destructuring (`const [a, b] = x`), arrow functions,
template literals, trailing commas in multi-line calls.

`ui/app.js` has since been rewritten in modern syntax throughout (`const`/`let`, arrow
functions, template literals, destructuring, optional chaining, `async`/`await` in place
of `.then()` chains) now that the engine supports it. `check-js-syntax.sh` (renamed from
`check-es5.sh`, used by `deploy.sh`/`dev-deploy.sh`) was loosened from `--ecma5` to
`--ecma2022` — this frame's WebView 106 actual syntax ceiling, not a blanket "latest".
Newer syntax than ES2022 (there isn't much of it — ES2023+ added mostly new built-in
_methods_, not new _syntax_, which this parse-only check can't catch regardless of
`ecmaVersion`) should still be avoided by hand; check what Chrome 106 actually shipped
before reaching for something newer than ES2022.

## The missing-viewport-meta trap

A faint vertical band of lighter color appeared on-screen, full height, independent of any
background color or gradient we set. Took a while to pin down because every content-based
theory was wrong: not the gradient (persisted with a flat color), not `box-shadow`/
`border-radius` on the widget cards (persisted with those removed), and critically — a
screenshot (`adb exec-out screencap`) showed **perfectly flat color, no band at all**, while
the physical screen still showed it. That split (framebuffer clean, physical screen not)
at first looked like a hardware backlight issue... except a truly minimal, fully-inline
test page (no external CSS, no JS, just a flat `background` in a `<style>` block) showed
**no band at all**, physically confirmed. So it was real, software-caused, but invisible to
a plain screenshot tool.

Actual cause: **no `<meta name="viewport">` tag**. Without one, this WebView falls back to
a legacy default desktop-style layout viewport (commonly 980px) and scales the result up to
fill the real 1280px screen — and that scaling is exactly the kind of thing that produces a
soft rendering seam on weak/old GPU hardware, especially right where tile-rendering
boundaries fall. A flat, featureless background scales to another flat background with
nothing to reveal the seam; real layout content does. `screencap` reads the rendered
framebuffer _before_ this particular scaling pass, which is presumably why it looked clean
there specifically.

Fix: force a 1:1 pixel mapping so there's no scaling to introduce a seam at all.

```html
<meta name="viewport" content="width=1280" />
```

Already in `index.html`. If this page's fixed dimensions ever change from 1280×800, update
the `width` value here and in `style.css`'s `body` rule together.

## Why every external data source gets fetched server-side, not from the browser

Two unrelated problems, same symptom (the widget can't load its data), same fix. Worth
understanding both before adding a third data source, since which one you hit changes how
you'd debug it:

1. **No CORS headers.** iCloud's calendar feed doesn't send
   `Access-Control-Allow-Origin`, so any browser — not just this one — refuses a
   cross-origin `fetch()` to it. Confirmed via `curl -I`.
2. **Missing root CA.** This frame's WebView has no **ISRG Root X1** (Let's Encrypt's
   root CA) in its trust store — a known gap on this hardware/Android-6 vintage. Any
   Let's Encrypt-signed site fails from the WebView specifically, even with perfect CORS
   headers (Open-Meteo sends `Access-Control-Allow-Origin: *` and still failed, logged as
   `HTTP 0` — confirmed the real cause via the cert chain: `openssl s_client` showed
   `issuer=.../O=Let's Encrypt/CN=YR1`). `fetch()` on this WebView also silently refuses
   _all_ cross-origin requests regardless of CORS (logcat: `"Fetch API cannot load ..."`
   with no further detail) — a second, independent reason the direct approach doesn't work.

The fix for all of it: fetch server-side (`curl`, which has a normal up-to-date trust
store and doesn't care about CORS at all) and have `app.js` read the cached local file —
same-origin, so neither problem applies. Same-origin `fetch()` is also unaffected by the
WebView's broken cross-origin `fetch()`.

Before reaching for this pattern on a new data source: check `curl -I` for CORS headers,
and `openssl s_client -connect <host>:443 | openssl x509 -noout -issuer` for the CA. If a
source has real CORS support _and_ a non-Let's-Encrypt cert, direct client-side `fetch()`
might actually work — but fetch-then-serve-locally is the safe default given this WebView's
track record, and it's what both current widgets do.

## Calendar (iCloud)

```sh
./server/fetch-calendar.sh  # curls CALENDAR_URL (server/dashboard.env) -> ui/calendar.ics
```

`app.js` fetches `calendar.ics` and parses `VEVENT` blocks itself — no library, since the
subset needed (`SUMMARY`/`DTSTART`/`DTEND`, no recurring events) is small enough that one
wasn't worth adding. `dashboard.env` and `calendar.ics` are both gitignored — the share
link and your actual schedule are both things to keep out of version control, even in a
private repo.

**"Today" widget**: an all-day event titled `[name:category] text` (e.g.
`[alex:music] Piano practice`) is pulled out of the regular Upcoming list and shown in a
dedicated widget instead, grouped by person, with a colored dot per category — a day-at-a-
glance view of who's doing what. Only applies to _today's_ tagged all-day events; tagged
events on other days, and anything not matching that exact bracket form, still show
normally in Upcoming. Category colors are a small lookup in `app.js`
(`CATEGORY_COLORS`) with a default fallback color for anything not listed — add new
categories there as they come up.

**Not handled yet**: recurring events (`RRULE`) — they simply won't appear, since expanding
them correctly (with exceptions, timezone edge cases) is real complexity that hasn't been
needed yet. Add it if a recurring event you care about goes missing.

## Weather (Open-Meteo)

```sh
./server/fetch-weather.sh  # curls current + today's high/low -> ui/weather.json
```

No API key needed. Location is a fixed lat/long (the frame doesn't move), resolved once
via Open-Meteo's geocoding API, not hand-typed — split across two files so the mechanism
can be committed without publishing where this actually lives:

- `config.js` (committed): a placeholder location (Death Valley, deliberately — if this is
  what's showing, the override below isn't working, obvious at a glance rather than
  something you'd have to dig through devtools to notice).
- `config.local.js` (gitignored, create it yourself): the real `WEATHER_LAT`/`WEATHER_LON`,
  loaded after `config.js` in `index.html` so it overrides when present. Both
  `fetch-weather.sh` and the page itself read from whichever one exists — one source of
  truth, not two places to keep in sync.

Open-Meteo's `daily` parameter has been flaky upstream (intermittent
`"service is overloaded"` errors independent of the query); `fetch-weather.sh` falls back
to current-conditions-only if so, rather than leaving stale/no data.

**"Rain in Xh" / "No rain expected" readout**: uses `minutely_15` (15-minute-resolution
precipitation + probability, next ~4 hours). Triggers on probability crossing
`RAIN_PROBABILITY_THRESHOLD` (60%, in `app.js`) as well as actual forecast amount, not
amount alone — confirmed necessary against real weather: during genuine light/intermittent
rain, `precipitation` read a flat `0.0mm` for every near-term slot (below Open-Meteo's
reporting resolution) while `precipitation_probability` correctly read >50% and climbing.
Amount-only triggering missed real rain entirely until this was caught by it not matching
what was actually happening outside.

On a real deployment, put all of `server/fetch-*.sh` on a cron wherever this ends up
hosted, so the `.json`/`.ics` files stay current without the frame needing to reach any of
these services directly.

## Fact of the day (uselessfacts.jsph.pl)

```sh
./server/fetch-fact.sh     # curls a random fact -> ui/fact.json
```

Sits in the header's middle gap (`justify-content: space-between` between the clock and
the status pills left it empty). No API key, no params -- but unlike calendar/weather/route,
don't just add this to the same cron/loop as everything else: the `/facts/random` endpoint
returns a _different_ fact on every call, so it needs its own once-a-day (midnight) schedule
to stay a stable "fact of the day" rather than changing every poll. `entrypoint.sh` already
does this with a dedicated loop that sleeps until the next midnight between fetches;
`app.js` just renders whatever's currently in `fact.json`, same same-origin-fetch pattern
as calendar/weather.

## Route / drive time (TomTom)

```sh
./server/fetch-route.sh    # curls drive time (+ optional incidents) -> ui/route.json
```

Sits in the middle of row1, between Weather and Shopping List -- all three widgets
compressed from two 576px columns to three 373px ones to fit (`.widget`'s width, plus
smaller fonts/padding throughout Weather and Shopping List's internals).

Configured via `server/dashboard.env`:

```sh
TOMTOM_API_KEY=...                            # developer.tomtom.com, free tier
ROUTE_ORIGIN=53.64789,-2.31683                # "lat,lon"
ROUTE_DESTINATION=53.47952,-2.24411           # "lat,lon"
ROUTE_LABEL=Work                              # shown as "Route to <label>"
ROUTE_INCLUDE_INCIDENTS=true                  # optional -- omit/false to leave incidents out of the status pill entirely
ROUTE_FAST_WINDOW=06:30-08:00                 # optional -- "HH:MM-HH:MM", same format as HA_DOG_FED_MORNING_WINDOW
ROUTE_FAST_INTERVAL_SECONDS=120               # required if ROUTE_FAST_WINDOW is set
ROUTE_PAD_PERCENT=10                          # optional -- scales the displayed live minutes by (1 + this/100)
```

`ROUTE_PAD_PERCENT` only scales the headline live-minutes number, not "Usually N min" or the
delay pill -- those are TomTom's own internally-consistent live-vs-historic/live-vs-free-flow
comparisons, and padding them too would just double-count the same correction. Added after
noticing TomTom's live ETA reading consistently lower than Google Maps for this specific
commute (no general TomTom-vs-Google bias is documented anywhere; this is a per-route fudge
factor, tune it against your own observations, not a universal constant).

TomTom over Google Maps Platform: Google's Routes API gives a traffic-aware ETA fine, but
has no structured "incidents on this route" data for developers (the consumer Maps app
shows incident icons; the API doesn't expose them) -- would've needed a second provider
just for that. TomTom's Routing API alone covers both asks (see below), with a self-serve
API key (no Google Cloud billing account needed) and a free tier (2,500 requests/day) this
single-route poll never comes close to.

Incidents come from the Calculate Route call itself (`&sectionType=traffic`), not a
separate Traffic Incidents API query -- that was the first version of this script, against
a bounding box padded around both endpoints as a stand-in for "near the route". Confirmed
directly against this project's real commute that it doesn't work: even with the padding
shrunk to near zero, the box between two points 18km apart in a built-up area still
covered 300+ incidents, i.e. most of the city's incident feed, not "on this route".
`sectionType=traffic` doesn't have that problem -- TomTom does the route-aware filtering
itself, returning only the handful of incidents actually on the calculated path (3 for
that same real commute, each with its own delay/category), as part of one API call
instead of two, for a fraction of the response size.

One combined pill, not separate delay/incidents pills -- two pills meant two numbers that
could disagree ("No delay" next to "2 incidents" reads as contradictory even when both are
accurate, since individual incidents can each carry a small delay that doesn't add up to a
meaningful route-level total). `trafficDelayInSeconds` under 5 minutes doesn't lead the
pill with a number at all; below that bar, there's always some noise in a live traffic
estimate, so it isn't worth a headline figure.

Which incidents make it into that pill is category-aware, not a flat "every incident
TomTom reports" or a flat delay cutoff: `ROAD_WORK`/`ROAD_CLOSURE` always show (the road
itself is being worked on or blocked, independent of how much that's slowing traffic right
now), while `JAM`/`OTHER` only show once their own `delayInSeconds` clears 60s (TomTom
reports these down to single-digit seconds, which is just noise, not a real jam). Multiple
incidents in the same category collapse into one mention (two `JAM` sections still just
read "Jam"), shown in severity order, not API order.

Examples, same shape the code was tested against:

- Nothing worth reporting -- `"No significant delay"`
- Only noise-filtered categories survive -- `"Roadworks"` (a 12s jam and a 55s "other"
  both got filtered; the roadworks shows regardless)
- Real delay, but under the 5-minute bar -- `"Jam, Roadworks"` (no number, since the
  aggregate delay isn't the point of the message at that level)
- Significant delay -- `"+7 min traffic (Jam, Roadworks)"`

The "Usually N min" comparison is `historicTrafficTravelTimeInSeconds`, not
`noTrafficTravelTimeInSeconds` -- the latter is TomTom's zero-traffic best case (an empty
road), not a typical/average time, so it's the wrong field for what "usually" means.

`entrypoint.sh` gives `fetch-route.sh` its own background loop, separate from
calendar/weather/fact's shared one, polling every `ROUTE_FAST_INTERVAL_SECONDS` instead of
the usual 900 while inside `ROUTE_FAST_WINDOW` -- traffic conditions can shift quickly
during an actual commute, unlike weather or a calendar. Comfortably within the free tier
even polled aggressively: a 90-minute window at 2-minute intervals is ~45 extra calls/day
on top of the ~84/day baseline, nowhere near the 2,500/day limit.

## Home Assistant integration

The shopping list, litter/fish trackers, and kitchen light widgets all go through
`server/server.js`'s live relay (Express) — see its own header comment for why these need
a live process rather than a cron-fetched file like calendar/weather. Configured via
`server/dashboard.env` (gitignored, create it yourself, `KEY=value` per line, no quoting
needed):

```sh
CALENDAR_URL=...                              # iCloud calendar share link
HA_URL=http://your-ha-host:8123
HA_TOKEN=...                                  # long-lived access token, Profile -> Security in HA
HA_ENTITY_ID=todo.your_list                   # shopping list
HA_LITTER_ENTITY_ID=input_datetime.litter_scooped
HA_FISH_ENTITY_ID=input_datetime.fish_fed
HA_DOG_FED_ENTITY_ID=                         # optional -- pill stays hidden until set
HA_KITCHEN_LIGHT_ENTITY_ID=light.your_light
HA_KITCHEN_ADAPTIVE_SWITCH_ENTITY_ID=switch.your_adaptive_lighting_switch
```

One file instead of separate `ha.local.json`/`calendar-url.txt` since both were "real
runtime secrets the app needs to function" for the same reason — no point splitting them
by format when they're the same kind of thing. `config.local.js` stays separate from this
(and lives in `ui/`, not `server/`): it's loaded directly by the browser via `<script>`,
not read by `server.js` at all, so it can't become an env var without `server.js`
templating JS at request time instead of serving a static file.

## Dev loop

```sh
./dev-deploy.sh
```

Edit, save, re-run. Safe to re-run repeatedly: installs `server/node_modules` the first
time only, starts `server.js` only if it isn't already running, re-tunnels over USB (a
no-op if already set up), and reloads the kiosk. Under the hood it's just:

```sh
node server/server.js &                            # serve ui/, no caching (see below)
adb -d reverse tcp:8765 tcp:8765                   # tunnel it over USB (redo after every reboot)
adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url http://localhost:8765/
```

**Use `server.js`, not plain `npx serve`/`python3 -m http.server`.** The WebView caches
every linked resource (`style.css`, `app.js`, ...) independently **by its own URL**, not
tied to the page's URL at all — cache-busting the page's URL on reload does nothing for
them. Hit this for real: made several CSS-only edits in a row, reloaded each time, and was
looking at a stale cached stylesheet the entire time with zero indication anything was
wrong (the page URL changing on reload masked it completely). `server.js` is a small
Express app serving `ui/` as static files, plus it sends `Cache-Control: no-store` on
every response, which fixes this at the source instead of needing to cache-bust every
resource by hand. Separately: pointing the kiosk at `http://localhost:8765/` across two
totally different local servers in one session (this dashboard, then an unrelated
experiment) produced a white screen from a _different_ stale-cache angle — the WebView
served the other server's cached `index.html`. A `?t=$(date +%s)` query string on the page
URL itself still handles that specific case if it ever recurs; `server.js` handles the rest.

## Deploying for real

This can't just be static files on something like Cloudflare Pages anymore. The shopping
list, litter, and fish widgets go through `server.js`'s live relay to Home Assistant
(reads **and** writes, with the auth token kept server-side) — that needs a process running
continuously, not a one-time file copy. Calendar/weather are still just cron-fetched files,
but they're cheap to run alongside the relay rather than set up separately.

Packaged as a Docker Compose app (`Dockerfile`, `entrypoint.sh`, `docker-compose.yml`,
all in this directory) to match a `~/apps/<name>/docker-compose.yml` per app layout:

Before shipping anything, `deploy.sh` parses `ui/app.js`/`config.js`/`config.local.js` as
strict ES5 (`npx acorn --ecma5`) and aborts if any of them fail. The frame's WebView is
Chrome ~44, where a single parse error anywhere kills the _entire_ script silently, no
visible error on-device (confirmed directly: an editor auto-formatter's trailing comma in
a multi-line call — valid ES2017+, invalid here — took out the whole dashboard, including
the clock, which doesn't even depend on a fetch). A real parser, not a hand-rolled regex:
only one reliably catches every shape of "too new for this WebView" syntax (trailing
commas, arrow functions, destructuring, template literals, `async`/`await`, ...) instead
of chasing each symptom as it recurs.

One-time setup, from your machine:

```sh
# Points deploy.sh at your server -- gitignored, same reasoning as config.local.js/
# dashboard.env below (real host/username, not something to commit):
echo 'HOST=user@your-server' > dashboard/.deploy.env

./dashboard/deploy.sh   # first run also creates ~/apps/dashboard and builds the image
```

`dashboard.env` and `config.local.js` are both gitignored (real HA token, real lat/long,
real bin schedule — not something to commit) but still deployed by `deploy.sh`: there's
nothing secret-looking about shipping them to the one server that runs this, so create them
locally once (see their sections above for what goes in each) and let every deploy carry
them over, rather than maintaining a separate copy by hand on the server.

`server/node_modules` (Express) follows the exact same "create once, every deploy carries
it over" pattern — gitignored, not baked into the Docker image. Run `npm install` in
`server/` once, locally or directly on the server, before the first deploy (`dev-deploy.sh`
already does this for local dev automatically). Safe because Express has no native/compiled
dependencies, so the same `node_modules` works whether it was installed on your Mac or the
Linux server — not something to assume for an arbitrary npm package.

Then restart once so the container picks them up: `docker compose up -d --build` (or just
re-run `./dashboard/deploy.sh` from your machine).

The container's `entrypoint.sh` runs `fetch-calendar.sh`/`fetch-weather.sh` once on
startup and then every 15 minutes in the background, and runs `server.js` in the
foreground as the main process — no separate cron needed. `docker-compose.yml` bind-mounts
this directory into the container rather than baking it into the image, so shipping a
change after the one-time setup above is just:

```sh
./deploy.sh
```

tar over ssh, not rsync — the server doesn't have rsync installed. Excludes `.git` and
`.deploy.env` (that one's local-machine-only, pointing deploy.sh at the server — the server
itself never needs it) and re-runs `docker compose up -d --build` so a `Dockerfile` change
picks up too, not just the code.

Then point the kiosk at the real URL:

```sh
adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url http://your-server:8765/
```

That `am start` command (or `scripts/set-kiosk-url.sh` from the upstream repo) is the
entire "push the frame to a new URL" story — see
[adb-commands.md](../docs/adb-commands.md#kiosk--dashboard-control-home-hq-comwesboshomehq).
You only need to re-run it if the URL itself changes; code updates just need the
rsync+restart above, since the frame re-fetches the page each time it reloads.
