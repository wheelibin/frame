function tick() {
  var now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  document.getElementById("date").textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
tick();
setInterval(tick, 1000 * 30);

// --- Calendar: parses calendar.ics (fetched locally by fetch-calendar.sh, same-origin
// to avoid iCloud's lack of CORS headers). Handles plain VEVENTs only, no RRULE expansion
// (recurring events won't show) -- add that if it turns out to matter.
//
// Written in ES5-only syntax on purpose: this frame's stock WebView is version 44, which
// has no async/await (Chrome 55+) and no destructuring (Chrome 49+). A single syntax error
// anywhere in this file silently kills the whole script, including the clock above.

function parseICSDate(value) {
  if (/^\d{8}$/.test(value)) {
    var y = +value.slice(0, 4),
      m = +value.slice(4, 6),
      d = +value.slice(6, 8);
    return { date: new Date(y, m - 1, d), allDay: true };
  }
  var match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  var year = +match[1],
    month = +match[2],
    day = +match[3],
    hour = +match[4],
    minute = +match[5],
    second = +match[6],
    isUtc = !!match[7];
  var date = isUtc
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : new Date(year, month - 1, day, hour, minute, second);
  return { date: date, allDay: false };
}

function parseICS(text) {
  var unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  var lines = unfolded.split("\n");
  var events = [];
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
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
    var colon = line.indexOf(":");
    if (colon < 0) continue;
    var name = line.slice(0, colon).split(";")[0];
    var value = line.slice(colon + 1);
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

var CATEGORY_COLORS = {
  music: "#c77dff",
  sport: "#4caf7d",
  school: "#4a90d9",
  chores: "#e8a33d",
  appointment: "#e85d5d",
  club: "#2dd4bf",
};
var DEFAULT_CATEGORY_COLOR = "#9aa1b4";

// Only some categories get an icon; everything else keeps the plain colored dot --
// add more here as they turn out to be worth the visual distinction.
var CATEGORY_ICONS = {
  music: "🎵",
  club: "★", // the ticket emoji (🎟️) didn't render right on this device's font; the club
  // suit symbol (♣) wasn't liked either -- plain pre-emoji Unicode star,
  // renders as a simple glyph rather than a color emoji
};

function categoryColor(category) {
  return CATEGORY_COLORS[category.toLowerCase()] || DEFAULT_CATEGORY_COLOR;
}

function categoryIcon(category) {
  return CATEGORY_ICONS[category.toLowerCase()] || null;
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
var PERSON_COLORS = [
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
  for (var i = 0; i < KNOWN_PEOPLE.length; i++) {
    if (KNOWN_PEOPLE[i].toLowerCase() === name.toLowerCase()) {
      return PERSON_COLORS[i % PERSON_COLORS.length];
    }
  }
  var hash = 0;
  for (var j = 0; j < name.length; j++) {
    hash = (hash * 31 + name.charCodeAt(j)) % 997;
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
  var hex = personColor(name);
  var rgb = hexToRgb(hex);
  var rgbStr = rgb.r + "," + rgb.g + "," + rgb.b;
  return (
    "background:linear-gradient(135deg, rgba(" +
    rgbStr +
    ",0.4), rgba(" +
    rgbStr +
    ",0.18));" +
    "border:1px solid rgba(" +
    rgbStr +
    ",0.6);" +
    "color:" +
    hex +
    ";"
  );
}

// Matches "[name:category] rest of text". Returns null if the summary doesn't start
// with that exact bracket form.
function parseTaggedSummary(summary) {
  var match = (summary || "").match(/^\[([^:\]]+):([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  return { name: match[1], category: match[2], text: match[3] };
}

function isToday(date) {
  var now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function renderTodayPeople(taggedEvents) {
  var container = document.getElementById("today-people");
  if (taggedEvents.length === 0) {
    container.innerHTML = '<p class="empty">Nothing tagged for today</p>';
    return;
  }

  var byPerson = {};
  var order = [];
  taggedEvents.forEach(function (item) {
    if (!byPerson[item.name]) {
      byPerson[item.name] = [];
      order.push(item.name);
    }
    byPerson[item.name].push(item);
  });
  // Alphabetical, not calendar order -- consistent regardless of the order events
  // happen to appear in the ICS feed.
  order.sort();

  container.innerHTML = order
    .map(function (name) {
      var items = byPerson[name]
        .slice()
        .sort(function (a, b) {
          return a.category.localeCompare(b.category);
        })
        .map(function (item) {
          var icon = categoryIcon(item.category);
          var inner = icon
            ? '<span class="category-icon">' + icon + "</span>"
            : '<span class="category-dot" style="background:' +
              categoryColor(item.category) +
              '"></span>';
          // Text wrapped in its own inline-block, centered by the <li>'s text-align:center
          // based purely on the text's own width -- the marker is then positioned outside
          // that box (not inside it), so it doesn't pull the centering off to one side.
          return (
            '<li><span class="item-text"><span class="category-marker">' +
            inner +
            "</span>" +
            (item.text || "(untitled)") +
            "</span></li>"
          );
        })
        .join("");
      return (
        '<div class="person-column"><div class="person-name" style="' +
        personPillStyle(name) +
        '">' +
        capitalize(name) +
        "</div><ul>" +
        items +
        "</ul></div>"
      );
    })
    .join("");
}

function renderEvents(events) {
  var list = document.getElementById("events");
  var now = new Date();
  var upcoming = events
    .filter(function (e) {
      if (!e.start) return false;
      var endDate = e.end ? e.end.date : e.start.date;
      return endDate >= now;
    })
    .sort(function (a, b) {
      return a.start.date - b.start.date;
    })
    .slice(0, 8);

  if (upcoming.length === 0) {
    list.innerHTML = '<li class="empty">Nothing upcoming</li>';
    return;
  }
  list.innerHTML = upcoming
    .map(function (e) {
      var time = e.start.allDay
        ? e.start.date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })
        : e.start.date.toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
      return (
        '<li><span class="time">' +
        time +
        "</span>" +
        (e.summary || "(untitled)") +
        "</li>"
      );
    })
    .join("");
}

function loadCalendar() {
  var list = document.getElementById("events");
  var today = document.getElementById("today-people");
  fetch("calendar.ics", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(function (text) {
      var events = parseICS(text);
      var taggedToday = [];
      var rest = [];
      events.forEach(function (e) {
        var tagged =
          e.start && e.start.allDay && isToday(e.start.date)
            ? parseTaggedSummary(e.summary)
            : null;
        if (tagged) taggedToday.push(tagged);
        else rest.push(e);
      });
      renderTodayPeople(taggedToday);
      renderEvents(rest);
    })
    .catch(function (err) {
      list.innerHTML =
        '<li class="empty">Calendar unavailable (' + err.message + ")</li>";
      today.innerHTML = '<p class="empty">Calendar unavailable</p>';
    });
}

loadCalendar();
setInterval(loadCalendar, 1000 * 60 * 15);

// --- Weather: reads weather.json (fetched locally by fetch-weather.sh). Open-Meteo uses
// a Let's Encrypt cert, and this frame's WebView has no ISRG Root X1 (Let's Encrypt's
// root CA) in its trust store -- same fetch-then-serve-locally workaround as the iCloud
// calendar, same-origin so it's a plain fetch() like calendar.ics, no XHR needed.
// WMO weather codes: https://open-meteo.com/en/docs -- only the common buckets are
// mapped, not all 100, that's enough for a home dashboard.

var WEATHER_CODES = {
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
  return WEATHER_CODES[code] || ["☁️", "Unknown"];
}

function parseISOMinute(s) {
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
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
var RAIN_PROBABILITY_THRESHOLD = 60;

function rainForecastText(minutely) {
  if (!minutely || !minutely.time) return null;
  var now = new Date();
  for (var i = 0; i < minutely.time.length; i++) {
    var hasAmount = minutely.precipitation[i] > 0;
    var hasProbability =
      minutely.precipitation_probability &&
      minutely.precipitation_probability[i] >= RAIN_PROBABILITY_THRESHOLD;
    if (!hasAmount && !hasProbability) continue;
    var slot = parseISOMinute(minutely.time[i]);
    if (!slot) continue;
    var mins = Math.round((slot - now) / 60000);
    var text;
    if (mins <= 10) text = "Rain expected soon";
    else if (mins < 60) text = "Rain in " + mins + " min";
    else text = "Rain in ~" + Math.round(mins / 60) + "h"; // minute-level precision this
    // far out would be false
    // accuracy the forecast doesn't have
    return { text: text, urgent: true };
  }
  var windowMins = minutely.time.length * 15;
  var windowH = Math.round(windowMins / 60);
  return { text: "No rain expected for " + windowH + "h", urgent: false };
}

function renderWeather(current, daily, minutely) {
  var info = weatherInfo(current.weather_code);
  var icon = info[0],
    label = info[1];
  document.getElementById("weather-icon").innerHTML = icon;

  var html = '<span class="weather-icon-big">' + icon + "</span>";
  html +=
    '<span class="temp">' + Math.round(current.temperature_2m) + "&deg;</span>";
  html += '<span class="details">' + label;
  if (daily) {
    html +=
      "<br>H: " +
      Math.round(daily.temperature_2m_max[0]) +
      "&deg;" +
      " L: " +
      Math.round(daily.temperature_2m_min[0]) +
      "&deg;";
  }
  html += "</span>";
  document.getElementById("weather").innerHTML = html;

  var rain = rainForecastText(minutely);
  var rainEl = document.getElementById("rain-alert");
  if (!rain) {
    rainEl.innerHTML = "";
  } else {
    rainEl.className = rain.urgent
      ? "rain-alert rain-urgent"
      : "rain-alert rain-calm";
    rainEl.innerHTML =
      (rain.urgent ? "&#127783;&#65039; " : "&#9989; ") + rain.text;
  }
}

function loadWeather() {
  fetch("weather.json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      if (data.error) throw new Error(data.reason || "unknown error");
      renderWeather(data.current, data.daily || null, data.minutely_15 || null);
    })
    .catch(function (err) {
      document.getElementById("weather").innerHTML =
        '<p class="empty">Weather unavailable (' + err.message + ")</p>";
      document.getElementById("rain-alert").innerHTML = "";
    });
}

loadWeather();
setInterval(loadWeather, 1000 * 60 * 15);
