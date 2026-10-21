function tick() {
  const now = new Date();
  // hour12 explicit, not left to the locale default -- the frame's Android locale is
  // en-US (12h by CLDR convention), which Chromium's Intl follows regardless of Android's
  // own "24-hour format" system setting (confirmed directly: the device has that setting
  // on, and the WebView still rendered 12h -- that toggle only wires into native Android
  // apps via DateFormat.is24HourFormat(), not into web content's Intl/toLocaleTimeString).
  document.getElementById("clock").textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  document.getElementById("date").textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
tick();
setInterval(tick, 1000 * 30);

// --- Bin collection: BIN_SCHEDULE (config.js placeholder / config.local.js real data)
// gives each bin's most recently known collection date plus how often it repeats --
// projected forward here so the list doesn't need re-typing every few weeks.
function parseLocalDate(s) {
  const [, y, m, d] = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return new Date(+y, +m - 1, +d);
}

function nextBinDate(anchor, intervalWeeks) {
  const date = parseLocalDate(anchor);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // setDate, not elapsed-ms addition -- operates in local calendar-day space, so it
  // can't drift an hour off across a DST transition the way adding intervalWeeks*7*24h
  // of milliseconds could.
  while (date < today) {
    date.setDate(date.getDate() + intervalWeeks * 7);
  }
  return date;
}

function renderBinPill() {
  const pill = document.getElementById("bin-pill");
  if (!BIN_SCHEDULE.length) return;

  const next = BIN_SCHEDULE.map((bin) => ({
    bin,
    date: nextBinDate(bin.anchor, bin.intervalWeeks),
  }));
  const soonest = next.reduce((a, b) => (b.date < a.date ? b : a));
  const due = next.filter((n) => n.date.getTime() === soonest.date.getTime());

  pill.innerHTML = due
    .map(
      (n) =>
        `<img class="bin-icon" src="bin-icons/bin_${n.bin.name.toLowerCase()}.svg" alt="${n.bin.name} bin">`,
    )
    .join("");
  pill.className = "status-pill bin-pill-visible";
}

renderBinPill();
setInterval(renderBinPill, 1000 * 60 * 60);

// --- Calendar: parses calendar.ics (fetched locally by fetch-calendar.sh, same-origin
// to avoid iCloud's lack of CORS headers). Handles plain VEVENTs only, no RRULE expansion
// (recurring events won't show) -- add that if it turns out to matter.

function parseICSDate(value) {
  if (/^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6);
    const d = +value.slice(6, 8);
    return { date: new Date(y, m - 1, d), allDay: true };
  }
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
  );
  if (!match) return null;
  const [, yearS, monthS, dayS, hourS, minuteS, secondS, utcFlag] = match;
  const [year, month, day, hour, minute, second] = [
    yearS,
    monthS,
    dayS,
    hourS,
    minuteS,
    secondS,
  ].map(Number);
  const date = utcFlag
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : new Date(year, month - 1, day, hour, minute, second);
  return { date, allDay: false };
}

function parseICS(text) {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const events = [];
  let cur = null;
  for (const line of unfolded.split("\n")) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0];
    const value = line.slice(colon + 1);
    if (name === "SUMMARY") cur.summary = value;
    if (name === "DTSTART") cur.start = parseICSDate(value);
    if (name === "DTEND") cur.end = parseICSDate(value);
  }
  return events;
}

// --- "Today" widget: all-day events tagged "[name:category] text", grouped by person.
// Lets you see at a glance who needs to do what today. Untagged events, and tagged events
// on other days, still show in the regular Upcoming list below -- only today's tagged
// all-day items move into this widget, to avoid showing the same thing twice.

const CATEGORY_COLORS = {
  music: "#c77dff",
  sport: "#4caf7d",
  school: "#4a90d9",
  chores: "#e8a33d",
  appointment: "#e85d5d",
  club: "#2dd4bf",
};
const DEFAULT_CATEGORY_COLOR = "#9aa1b4";

// Only some categories get an icon; everything else keeps the plain colored dot --
// add more here as they turn out to be worth the visual distinction.
const CATEGORY_ICONS = {
  music: "🎵",
  club: "★", // the ticket emoji (🎟️) didn't render right on this device's font; the club
  // suit symbol (♣) wasn't liked either -- plain pre-emoji Unicode star,
  // renders as a simple glyph rather than a color emoji
};

function categoryColor(category) {
  return CATEGORY_COLORS[category.toLowerCase()] ?? DEFAULT_CATEGORY_COLOR;
}

function categoryIcon(category) {
  return CATEGORY_ICONS[category.toLowerCase()] ?? null;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Stable per-person color with no name list to maintain: hash the name itself into a
// fixed palette. Deliberately not "sort today's names alphabetically, assign by rank" --
// that would shift a person's color whenever someone alphabetically earlier joins the
// roster that day. Hashing the name keeps it tied to the person, not their position
// among whoever else showed up. Small chance two names land on the same color; fine for
// a handful of people, not worth a collision-avoidance scheme for this.
//
// Order matters for anyone listed in KNOWN_PEOPLE (config.js/config.local.js) -- their
// color is their position in that list, indexed straight into this array. Pink is first
// so the first KNOWN_PEOPLE entry gets it. For anyone NOT in KNOWN_PEOPLE, order is
// irrelevant (the hash-based fallback picks an index essentially at random).
const PERSON_COLORS = [
  "#f472b6",
  "#4ade80",
  "#60a5fa",
  "#ff5470",
  "#d946ef",
  "#22d3ee",
  "#ffc857",
];

function personColor(name) {
  // KNOWN_PEOPLE (config.js / config.local.js): deterministic, order-controlled color --
  // checked first. Anyone not in that list (a one-off guest tagged in the calendar) falls
  // through to the old hash-based assignment instead of breaking.
  const knownIndex = KNOWN_PEOPLE.findIndex(
    (p) => p.toLowerCase() === name.toLowerCase(),
  );
  if (knownIndex !== -1)
    return PERSON_COLORS[knownIndex % PERSON_COLORS.length];

  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// Translucent tinted background + a thin same-color border + the vivid color itself as
// text -- same recipe as the rain-alert pill, rather than a solid fill with a separately
// computed contrasting text color. No glow (dropped per feedback -- stood out too much
// against the rest of the page). Fill opacity and border bumped up from the first version
// per feedback ("brighter and more distinctive") -- the original 0.28/0.1 read as a bit
// too faint/washed-out to tell apart at a glance.
function personPillStyle(name) {
  const hex = personColor(name);
  const { r, g, b } = hexToRgb(hex);
  return (
    `background:linear-gradient(135deg, rgba(${r},${g},${b},0.4), rgba(${r},${g},${b},0.18));` +
    `border:1px solid rgba(${r},${g},${b},0.6);color:${hex};`
  );
}

// Matches "[name:category] rest of text". Returns null if the summary doesn't start
// with that exact bracket form.
function parseTaggedSummary(summary) {
  const match = (summary ?? "").match(/^\[([^:\]]+):([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const [, name, category, text] = match;
  return { name, category, text };
}

function isToday(date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isTomorrow(date) {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function groupByPerson(items) {
  const byPerson = {};
  for (const item of items) {
    // Lowercased so this lines up with KNOWN_PEOPLE's case-insensitive matching below.
    const key = item.name.toLowerCase();
    (byPerson[key] ??= []).push(item);
  }
  return byPerson;
}

function renderItemList(items) {
  return items
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((item) => {
      const icon = categoryIcon(item.category);
      const marker = icon
        ? `<span class="category-icon">${icon}</span>`
        : `<span class="category-dot" style="background:${categoryColor(item.category)}"></span>`;
      // Text wrapped in its own inline-block, centered by the <li>'s text-align:center
      // based purely on the text's own width -- the marker is then positioned outside
      // that box (not inside it), so it doesn't pull the centering off to one side.
      return `<li><span class="item-text"><span class="category-marker">${marker}</span>${item.text || "(untitled)"}</span></li>`;
    })
    .join("");
}

function renderTodayPeople(todayItems, tomorrowItems) {
  const container = document.getElementById("today-people");
  const byToday = groupByPerson(todayItems);
  const byTomorrow = groupByPerson(tomorrowItems);
  // Everyone in KNOWN_PEOPLE (config.js/config.local.js) always gets a card, even with
  // nothing tagged today or tomorrow -- otherwise the "Today" widget's line-up silently
  // shrinks to whoever happens to have an event, which reads as "forgot someone" rather
  // than "nothing for them today".
  const names = new Set([
    ...KNOWN_PEOPLE.map((n) => n.toLowerCase()),
    ...Object.keys(byToday),
    ...Object.keys(byTomorrow),
  ]);
  if (names.size === 0) {
    container.innerHTML =
      '<p class="empty">Nothing tagged for today or tomorrow</p>';
    return;
  }
  // Alphabetical, not calendar order -- consistent regardless of the order events
  // happen to appear in the ICS feed.
  const order = [...names].sort();

  container.innerHTML = order
    .map((name) => {
      // Always rendered, even with no today items for this person -- it still needs to
      // take part in the max-height equalization below, so every card's Tomorrow section
      // lines up on the same row regardless of how many today items came before it in
      // each card.
      const todaySection = `<ul class="today-list">${
        byToday[name]
          ? renderItemList(byToday[name])
          : '<li class="no-items">Nothing today</li>'
      }</ul>`;
      const tomorrowSection = `<div class="tomorrow-section"><div class="tomorrow-label">Tomorrow</div><ul>${
        byTomorrow[name]
          ? renderItemList(byTomorrow[name])
          : '<li class="no-items">Nothing tomorrow</li>'
      }</ul></div>`;
      return `<div class="widget person-column"><div class="person-name" style="${personPillStyle(name)}">${capitalize(name)}</div>${todaySection}${tomorrowSection}</div>`;
    })
    .join("");

  // Cards are independent flex columns -- nothing ties one person's today-list height to
  // another's, so with different item counts the Tomorrow divider would start at a
  // different row in each card. CSS Grid subgrid would solve this declaratively, but
  // still needs Chrome 117+ (confirmed not available on this frame's current WebView 106).
  // Measuring and pinning the tallest .today-list as a min-height on all of them instead.
  const todayLists = container.querySelectorAll(".today-list");
  const maxTodayHeight = Math.max(
    ...[...todayLists].map((el) => el.offsetHeight),
  );
  todayLists.forEach((el) => {
    el.style.minHeight = `${maxTodayHeight}px`;
  });
}

// Upcoming (non-today, untagged) events no longer have a widget of their own -- replaced
// by the shopping list -- so this only extracts today's and tomorrow's tagged items for
// renderTodayPeople now. Still needs the full calendar.ics fetch/parse either way, since
// that's the only source for the Today widget too.
async function loadCalendar() {
  const today = document.getElementById("today-people");
  try {
    const res = await fetch("calendar.ics", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = parseICS(await res.text());
    const taggedToday = [];
    const taggedTomorrow = [];
    for (const e of events) {
      if (!e.start?.allDay) continue;
      const tagged = parseTaggedSummary(e.summary);
      if (!tagged) continue;
      if (isToday(e.start.date)) taggedToday.push(tagged);
      else if (isTomorrow(e.start.date)) taggedTomorrow.push(tagged);
    }
    renderTodayPeople(taggedToday, taggedTomorrow);
  } catch (err) {
    today.innerHTML = `<p class="empty">Calendar unavailable (${err.message})</p>`;
  }
}

loadCalendar();
setInterval(loadCalendar, 1000 * 60 * 15);

// --- Weather: reads weather.json (fetched locally by fetch-weather.sh). Open-Meteo uses
// a Let's Encrypt cert, and this frame's WebView has no ISRG Root X1 (Let's Encrypt's
// root CA) in its trust store -- same fetch-then-serve-locally workaround as the iCloud
// calendar, same-origin so it's a plain fetch() like calendar.ics, no XHR needed.
// WMO weather codes: https://open-meteo.com/en/docs -- only the common buckets are
// mapped, not all 100, that's enough for a home dashboard.

const WEATHER_CODES = {
  0: ["☀️", "Clear"],
  1: ["🌤️", "Mostly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌦️", "Heavy drizzle"],
  61: ["🌧️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  71: ["❄️", "Light snow"],
  73: ["❄️", "Snow"],
  75: ["❄️", "Heavy snow"],
  80: ["🌦️", "Showers"],
  81: ["🌦️", "Showers"],
  82: ["🌦️", "Heavy showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunderstorm"],
  99: ["⛈️", "Thunderstorm"],
};

function weatherInfo(code) {
  return WEATHER_CODES[code] ?? ["☁️", "Unknown"];
}

function parseISOMinute(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi);
}

// First slot with actual forecast rainfall (not just elevated probability) within the
// fetched window -- "will it rain", not "what's the percentage chance". Returns
// {text, urgent} so the caller can style an actual rain warning differently from a calm
// "no rain" readout, or null if there's no minutely data to work with.
// Threshold for "likely enough rain to mention" when the forecast amount alone says
// 0.0mm. Light/intermittent rain often rounds down to 0.0 in Open-Meteo's precipitation
// field (below its reporting resolution) while probability still correctly reflects it --
// confirmed directly: real on-and-off rain happening with precipitation flat 0.0mm for
// every near-term slot, but probability already >50% and climbing. Triggering on amount
// alone missed it entirely.
const RAIN_PROBABILITY_THRESHOLD = 60;

// Below this today's low (°C), or if today's rain probability clears
// RAIN_PROBABILITY_THRESHOLD, the coat pill lights up -- kids-leaving-for-school framing,
// not a precise comfort model.
const COAT_TEMP_THRESHOLD = 12;

function coatAlertText(daily) {
  if (!daily) return null;
  const cold = daily.temperature_2m_min[0] < COAT_TEMP_THRESHOLD;
  const wet =
    daily.precipitation_probability_max?.[0] >= RAIN_PROBABILITY_THRESHOLD;
  if (!cold && !wet)
    return { text: "No coat needed", icon: "&#9989;", needed: false };
  // Umbrella takes priority over snowflake when both apply -- rain is the more
  // immediately obvious reason to grab a coat.
  const icon = wet ? "&#9748;" : "&#10052;";
  return { text: "Take a coat today", icon, needed: true };
}

function rainForecastText(minutely) {
  if (!minutely?.time) return null;
  const now = new Date();
  for (let i = 0; i < minutely.time.length; i++) {
    const hasAmount = minutely.precipitation[i] > 0;
    const hasProbability =
      minutely.precipitation_probability?.[i] >= RAIN_PROBABILITY_THRESHOLD;
    if (!hasAmount && !hasProbability) continue;
    const slot = parseISOMinute(minutely.time[i]);
    if (!slot) continue;
    const mins = Math.round((slot - now) / 60000);
    let text;
    if (mins <= 10) text = "Rain expected soon";
    else if (mins < 60) text = `Rain in ${mins} min`;
    else text = `Rain in ~${Math.round(mins / 60)}h`; // minute-level precision this far
    // out would be false accuracy the forecast doesn't have
    return { text, urgent: true };
  }
  const windowH = Math.round((minutely.time.length * 15) / 60);
  return { text: `No rain expected for ${windowH}h`, urgent: false };
}

function renderWeather(current, daily, minutely) {
  const [icon, label] = weatherInfo(current.weather_code);
  document.getElementById("weather-icon").innerHTML = icon;

  const range = daily
    ? `<br>H: ${Math.round(daily.temperature_2m_max[0])}&deg; L: ${Math.round(daily.temperature_2m_min[0])}&deg;`
    : "";
  document.getElementById("weather").innerHTML =
    `<span class="weather-icon-big">${icon}</span>` +
    `<span class="temp">${Math.round(current.temperature_2m)}&deg;</span>` +
    `<span class="details">${label}${range}</span>`;

  const rain = rainForecastText(minutely);
  const rainEl = document.getElementById("rain-alert");
  if (!rain) {
    rainEl.innerHTML = "";
  } else {
    rainEl.className = rain.urgent
      ? "alert-pill rain-urgent"
      : "alert-pill rain-calm";
    rainEl.innerHTML = `${rain.urgent ? "&#127783;&#65039; " : "&#9989; "}${rain.text}`;
  }

  const coat = coatAlertText(daily);
  const coatEl = document.getElementById("coat-alert");
  if (!coat) {
    coatEl.innerHTML = "";
  } else {
    coatEl.className = coat.needed
      ? "alert-pill coat-needed"
      : "alert-pill coat-ok";
    coatEl.innerHTML = `${coat.icon} ${coat.text}`;
  }
}

async function loadWeather() {
  try {
    const res = await fetch("weather.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.reason ?? "unknown error");
    renderWeather(data.current, data.daily ?? null, data.minutely_15 ?? null);
  } catch (err) {
    document.getElementById("weather").innerHTML =
      `<p class="empty">Weather unavailable (${err.message})</p>`;
    document.getElementById("rain-alert").innerHTML = "";
    document.getElementById("coat-alert").innerHTML = "";
  }
}

loadWeather();
setInterval(loadWeather, 1000 * 60 * 15);

// --- Fact of the day: fact.json is a daily snapshot (server/fetch-fact.sh), same
// fetched-server-side-then-same-origin pattern as calendar/weather. Polled on the same
// 15-minute cadence as weather purely for consistency with the rest of this file -- the
// content itself only actually changes once a day, at midnight, via fetch-fact.sh's own
// dedicated loop in entrypoint.sh (the /random endpoint it hits returns a different fact
// on every call, so that loop -- not the API -- is what pins this to once a day).
async function loadFact() {
  try {
    const res = await fetch("fact.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById("fact-text").textContent = data.text ?? "";
  } catch {
    document.getElementById("fact-text").textContent = "";
  }
}

loadFact();
setInterval(loadFact, 1000 * 60 * 15);

// --- Route: drive time (+ optional incidents) for ROUTE_ORIGIN -> ROUTE_DESTINATION,
// fetched server-side by server/fetch-route.sh (TomTom) into route.json, same
// fetched-then-same-origin pattern as calendar/weather/fact. Polled on the same 15-minute
// cadence as weather for consistency with the rest of this file.
//
// Below this many seconds of traffic delay, the "delay" pill reads as "No delay" rather
// than flagging a real slowdown -- there's always some noise in a live traffic estimate,
// and a 1-2 minute wobble isn't worth a visual alert.
const ROUTE_DELAY_THRESHOLD_SECONDS = 300;

// TomTom's own simpleCategory values -- JAM/ROAD_WORK/ROAD_CLOSURE are self-explanatory,
// OTHER is an explicit catch-all (accident, broken-down vehicle, weather, anything not in
// the other three) with no further detail available: the per-incident "tec" cause codes
// reference an external ISO 13585/TPEG2-TEC table TomTom's own docs don't reproduce, so
// "Delay" here is deliberately generic rather than guessing a specific cause. Order here
// is display order (most to least severe), not API order.
const ROUTE_INCIDENT_CATEGORY_ORDER = [
  "ROAD_CLOSURE",
  "JAM",
  "ROAD_WORK",
  "OTHER",
];
const ROUTE_INCIDENT_LABELS = {
  ROAD_CLOSURE: "Closure",
  JAM: "Jam",
  ROAD_WORK: "Roadworks",
  OTHER: "Delay",
};

// ROAD_WORK/ROAD_CLOSURE are worth flagging regardless of current delay -- the road
// itself is being worked on or blocked, independent of how much that's slowing traffic
// right now. JAM/OTHER are purely about current throughput, so a few seconds of "delay"
// there (TomTom reports these down to single-digit seconds) is just noise, not a real jam.
const ROUTE_INCIDENT_ALWAYS_SHOW = { ROAD_WORK: true, ROAD_CLOSURE: true };
const ROUTE_INCIDENT_MIN_DELAY_SECONDS = 60;

// One entry per category present (not per incident -- two JAM sections still read as one
// "Jam"), in severity order, each only included if it clears the relevance bar above.
function relevantIncidentCategories(trafficSections) {
  const present = new Set();
  for (const s of trafficSections) {
    const worthShowing =
      ROUTE_INCIDENT_ALWAYS_SHOW[s.simpleCategory] ||
      (s.delayInSeconds ?? 0) >= ROUTE_INCIDENT_MIN_DELAY_SECONDS;
    if (worthShowing) present.add(s.simpleCategory);
  }
  return ROUTE_INCIDENT_CATEGORY_ORDER.filter((c) => present.has(c)).map(
    (c) => ROUTE_INCIDENT_LABELS[c],
  );
}

function renderRoute(data) {
  document.getElementById("route-label").textContent = data.label ?? "";

  const statusEl = document.getElementById("route-status-alert");
  const summary = data.route?.routes?.[0]?.summary;

  if (!summary) {
    document.getElementById("route").innerHTML =
      '<p class="empty">Route unavailable</p>';
    statusEl.innerHTML = "";
    return;
  }

  const minutes = Math.round(summary.travelTimeInSeconds / 60);
  // historicTrafficTravelTimeInSeconds, not noTrafficTravelTimeInSeconds -- the latter is
  // TomTom's zero-traffic best case (an empty road), not what "usually" means. The
  // historic figure is based on actual traffic patterns for this route/time, which is
  // what a "usually" comparison should be against.
  const usualMinutes = Math.round(
    summary.historicTrafficTravelTimeInSeconds / 60,
  );
  document.getElementById("route").innerHTML =
    `<span class="route-minutes">${minutes}</span><span class="route-unit">min</span>` +
    `<span class="route-detail">Usually ${usualMinutes} min</span>`;

  // "sections" is only present on the route when ROUTE_INCLUDE_INCIDENTS=true triggered
  // server/fetch-route.sh's &sectionType=traffic -- without that request TomTom never
  // includes the key at all. Each entry is already scoped to this specific route by
  // TomTom itself (not a bounding-box guess) -- see fetch-route.sh for why that
  // distinction mattered.
  const trafficSections = (data.route.routes[0].sections ?? []).filter(
    (s) => s.sectionType === "TRAFFIC",
  );
  const categories = relevantIncidentCategories(trafficSections);

  const delaySeconds = summary.trafficDelayInSeconds ?? 0;
  const isSignificant = delaySeconds >= ROUTE_DELAY_THRESHOLD_SECONDS;

  if (!isSignificant && categories.length === 0) {
    statusEl.className = "alert-pill no-delay";
    statusEl.innerHTML = "&#9989; No significant delay";
  } else {
    // Leads with the overall route-level delay only once it's actually significant --
    // otherwise this is just "here's what's on the route" with no number attached, since
    // the aggregate delay isn't the point of the message in that case.
    let text = isSignificant
      ? `+${Math.round(delaySeconds / 60)} min traffic`
      : "";
    if (categories.length) {
      text += text ? ` (${categories.join(", ")})` : categories.join(", ");
    }
    statusEl.className = "alert-pill delayed";
    statusEl.innerHTML = `&#9888; ${text}`;
  }
}

// Self-rescheduling rather than a fixed setInterval, same pattern as loadDogFed below --
// fetch-route.sh embeds fastWindow (mirroring its own ROUTE_FAST_WINDOW check) so this can
// poll at roughly the same cadence the server is actually refreshing at (every 90s during
// the configured rush-hour window) instead of a flat 15 minutes that lags live traffic
// conditions exactly when they're changing fastest.
const ROUTE_FAST_POLL_MS = 1000 * 90;
const ROUTE_SLOW_POLL_MS = 1000 * 60 * 15;

async function loadRoute() {
  let fastWindow = false;
  try {
    const res = await fetch("route.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fastWindow = data.fastWindow ?? false;
    renderRoute(data);
  } catch (err) {
    document.getElementById("route").innerHTML =
      `<p class="empty">Route unavailable (${err.message})</p>`;
    document.getElementById("route-status-alert").innerHTML = "";
  }
  setTimeout(loadRoute, fastWindow ? ROUTE_FAST_POLL_MS : ROUTE_SLOW_POLL_MS);
}

loadRoute();

// --- Shopping list: live reads/writes through server.js's /api/shopping-list relay
// to Home Assistant's todo integration -- not a cron-fetched snapshot like calendar/
// weather, since adding an item needs to actually reach HA, and whatever's added via HA
// itself (phone, voice assistant) should show up here too. Whatever ends up hosting this
// for real needs an equivalent live relay running continuously; see server.js's own
// comment for why a plain static-file host can't do this one.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderShoppingList(items) {
  const list = document.getElementById("shopping-items");
  if (items.length === 0) {
    list.innerHTML = '<li class="empty">Nothing on the list</li>';
    return;
  }
  list.innerHTML = items
    .map(
      (item) =>
        `<li><span class="shopping-item-text">${escapeHtml(item.summary)}</span>` +
        `<button class="shopping-remove-btn" data-uid="${escapeHtml(item.uid)}">&times;</button></li>`,
    )
    .join("");
}

async function removeShoppingItem(uid) {
  try {
    const res = await fetch(
      `/api/shopping-list?uid=${encodeURIComponent(uid)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    loadShoppingList();
  } catch (err) {
    alert(`Could not remove item: ${err.message}`);
  }
}

async function loadShoppingList() {
  const list = document.getElementById("shopping-items");
  try {
    const res = await fetch("/api/shopping-list", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderShoppingList(data.items);
  } catch (err) {
    list.innerHTML = `<li class="empty">List unavailable (${err.message})</li>`;
  }
}

async function addShoppingItem() {
  const input = document.getElementById("shopping-input");
  const value = input.value.trim();
  if (!value) return;
  input.disabled = true;
  try {
    const res = await fetch("/api/shopping-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: value }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    input.value = "";
    await loadShoppingList();
  } catch (err) {
    // Rare on a home LAN; a visible alert is simpler than a dedicated error-state UI for
    // something that should basically never happen in practice.
    alert(`Could not add item: ${err.message}`);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

document
  .getElementById("shopping-add-btn")
  .addEventListener("click", addShoppingItem);
document.getElementById("shopping-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addShoppingItem();
});
document.getElementById("shopping-items").addEventListener("click", (e) => {
  if (e.target.className === "shopping-remove-btn") {
    removeShoppingItem(e.target.getAttribute("data-uid"));
  }
});

function daysAgoText(days) {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// input_datetime-backed "last done X days ago, tap to reset" pills -- mirrors
// server.js's TRACKERS dict (name -> GET /api/<name>, POST /api/<name>/<data-action>).
function setupTracker(name, valueId, btnId) {
  const value = document.getElementById(valueId);
  const btn = document.getElementById(btnId);

  async function load() {
    try {
      const res = await fetch(`/api/${name}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      value.textContent = daysAgoText(data.days_ago);
    } catch {
      value.textContent = "?";
    }
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await fetch(
        `/api/${name}/${btn.getAttribute("data-action")}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await load();
    } catch (err) {
      alert(`Could not log ${name}: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  load();
  setInterval(load, 1000 * 60 * 5);
}

// Status comes from server.js's /api/dog-fed, which derives it from the food container
// sensor's open/close history against the configured morning/afternoon windows -- not from
// the sensor's current state, which only ever says "open" or "closed right now".
// Plain monochrome check/cross (U+2713/U+2717), not the color emoji (checkmark/cross
// emoji render in fixed platform green/red, clashing with the muted glass theme) -- same
// "plain Unicode glyph over color emoji" swap as the club icon elsewhere in this file.
// These inherit .status-fed/.status-missed's text color instead of fighting it.
const DOG_FED_ICONS = {
  pending: "&ndash;",
  fed: "&#10003;",
  missed: "&#10007;",
};

function renderDogFedSlot(id, label, status) {
  const slot = document.getElementById(id);
  slot.className = `dog-fed-slot status-${status}`;
  slot.innerHTML = `${label} ${DOG_FED_ICONS[status] ?? "?"}`;
}

// Self-rescheduling rather than a fixed setInterval, so the poll rate can change: fast
// while a feed is due right now (server says in_window), slow otherwise -- nothing can
// change outside a window, so there's no reason to hit HA's history API every 20s all day.
const DOG_FED_FAST_POLL_MS = 1000 * 20;
const DOG_FED_SLOW_POLL_MS = 1000 * 60 * 15;

// Hides the pill until dashboard.env has HA_DOG_FED_ENTITY_ID configured, so this is a
// no-op until then.
async function loadDogFed() {
  const pill = document.getElementById("dog-fed-pill");
  try {
    const res = await fetch("/api/dog-fed", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.configured) {
      pill.className = "status-pill";
      setTimeout(loadDogFed, DOG_FED_SLOW_POLL_MS);
      return;
    }
    pill.className = "status-pill dog-fed-pill-visible";
    renderDogFedSlot("dog-fed-morning", "AM", data.morning);
    renderDogFedSlot("dog-fed-afternoon", "PM", data.afternoon);
    setTimeout(
      loadDogFed,
      data.in_window ? DOG_FED_FAST_POLL_MS : DOG_FED_SLOW_POLL_MS,
    );
  } catch {
    pill.className = "status-pill";
    setTimeout(loadDogFed, DOG_FED_SLOW_POLL_MS);
  }
}

setupTracker("litter", "litter-value", "litter-scoop-btn");
setupTracker("fish", "fish-value", "fish-fed-btn");

loadDogFed();

// Kitchen/Sunroom light -- dragging the slider turns off Adaptive Lighting's switch
// first (it otherwise keeps overriding manual brightness) then sets brightness; "Auto"
// hands control back to Adaptive Lighting. The slider only posts to HA on release
// ('change', not 'input') so dragging doesn't spam a service call per pixel moved.
const kitchenSlider = document.getElementById("kitchen-brightness");
const kitchenAutoBtn = document.getElementById("kitchen-auto-btn");

async function loadKitchenLight() {
  try {
    const res = await fetch("/api/kitchen-light", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    kitchenSlider.value = data.brightness_pct;
    kitchenAutoBtn.textContent = data.auto ? "Auto: ON" : "Auto: OFF";
  } catch {
    kitchenAutoBtn.textContent = "Auto: ?";
  }
}

kitchenSlider.addEventListener("change", async () => {
  try {
    const res = await fetch("/api/kitchen-light/brightness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brightness_pct: parseInt(kitchenSlider.value, 10),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    // No re-fetch here -- the slider already shows exactly what we just told the light
    // to do. Re-reading immediately races the group light's own state update (it
    // aggregates ~24 individual Hue lights, confirmed to lag the command by up to ~1s),
    // which was snapping the slider back to the stale pre-change brightness.
    kitchenAutoBtn.textContent = "Auto: OFF";
  } catch (err) {
    alert(`Could not set brightness: ${err.message}`);
  }
});

kitchenAutoBtn.addEventListener("click", async () => {
  kitchenAutoBtn.disabled = true;
  try {
    const res = await fetch("/api/kitchen-light/auto", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    kitchenAutoBtn.textContent = "Auto: ON";
    // Adaptive Lighting doesn't apply its own brightness the instant the switch turns
    // back on -- confirmed empirically, it takes a couple of seconds to actually push a
    // value to the light. Fetching immediately just re-reads the old manual brightness.
    setTimeout(loadKitchenLight, 2500);
  } catch (err) {
    alert(`Could not re-enable auto: ${err.message}`);
  } finally {
    kitchenAutoBtn.disabled = false;
  }
});

loadKitchenLight();
setInterval(loadKitchenLight, 1000 * 60 * 2);

loadShoppingList();
setInterval(loadShoppingList, 1000 * 60 * 2);
