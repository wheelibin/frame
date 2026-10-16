// Fixed location for the weather widget -- the frame doesn't move, so no need for
// geolocation. Set your own via Open-Meteo's geocoding API, e.g.:
//   curl "https://geocoding-api.open-meteo.com/v1/search?name=<your town>&count=1"
// Placeholder below is Death Valley, deliberately -- if config.local.js (gitignored) isn't
// overriding this, it's obvious at a glance from a suspiciously hot reading, not something
// you'd have to dig through devtools to notice.
var WEATHER_LAT = 36.23962;
var WEATHER_LON = -116.81133;

// Names that always appear in the "Today" widget, in a fixed order -- their color is
// their position in this list (indexed into PERSON_COLORS in app.js), not a hash of their
// name. Gives deterministic, fully-controllable colors (reorder this list to reassign
// colors) for your regulars, while anyone tagged in the calendar who ISN'T in this list
// still gets a color via the old hash-based fallback, so a one-off guest doesn't break
// anything. Empty here (committed placeholder, like WEATHER_LAT/LON above) -- real names
// go in config.local.js (gitignored), not here.
var KNOWN_PEOPLE = [];
