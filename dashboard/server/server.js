#!/usr/bin/env node
// The dashboard's app server: a no-cache static file server (see below) PLUS a live relay
// to Home Assistant for the shopping-list/tracker/lighting widgets. Everything else in this
// project is a cron-fetched static snapshot; those widgets need live reads and writes
// (adding a shopping item, dragging the brightness slider, from the kiosk's own
// touchscreen), so unlike calendar.ics/weather.json they can't just be a file on disk --
// something has to be running to make the authenticated HA call on demand. Runs the same in
// local dev (via dev-deploy.sh) and in production (via entrypoint.sh/docker-compose.yml) --
// there's no separate "real" server, this is it.
//
// Cache-Control: no-store on every response: the frame's WebView caches each linked
// resource (style.css, app.js, ...) independently by its own URL, not tied to the page's
// URL at all -- cache-busting the page's URL on reload doesn't touch them, and it's easy to
// end up editing a file, reloading, and silently looking at a stale cached version with no
// indication anything's wrong.
"use strict";

const path = require("path");
const express = require("express");
const {
  haConfig,
  haCall,
  haGetState,
  haGetHistory,
  windowIsActive,
  feedWindowStatus,
} = require("./ha");

const PORT = 8765;
// __dirname-relative, not cwd-relative -- entrypoint.sh/dev-deploy.sh both launch this from
// the dashboard/ root, not from server/, so cwd can't be trusted to find this.
const UI_DIR = path.resolve(__dirname, "../ui");

// input_datetime-backed "last done X days ago, tap to reset" widgets -- /api/<name> reads
// days-since, /api/<name>/<action> resets it to now. Route name maps to the config key
// holding that tracker's entity_id in dashboard.env.
const TRACKERS = {
  litter: ["litterEntityId", "scoop"],
  fish: ["fishEntityId", "fed"],
};

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json());

app.get("/api/shopping-list", async (req, res) => {
  try {
    const entityId = haConfig().entityId;
    const result = await haCall(
      "todo",
      "get_items",
      { entity_id: entityId },
      true,
    );
    res.json({ items: result.service_response[entityId].items });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.post("/api/shopping-list", async (req, res) => {
  try {
    const item = (req.body.item || "").trim();
    if (!item) return res.status(400).json({ error: "empty item" });
    const entityId = haConfig().entityId;
    await haCall("todo", "add_item", { entity_id: entityId, item });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.delete("/api/shopping-list", async (req, res) => {
  const uid = req.query.uid || "";
  if (!uid) return res.status(400).json({ error: "missing uid" });
  try {
    const entityId = haConfig().entityId;
    await haCall("todo", "remove_item", { entity_id: entityId, item: uid });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

for (const [name, [entityKey, action]] of Object.entries(TRACKERS)) {
  app.get("/api/" + name, async (_req, res) => {
    try {
      const cfg = haConfig();
      const attrs = (await haGetState(cfg[entityKey])).attributes;
      // Calendar-day difference, not elapsed-time // 86400 -- something logged yesterday at
      // 11pm and checked at 9am today is only ~10h ago, which would floor to 0 ("today")
      // even though it should read "yesterday".
      const done = new Date(attrs.year, attrs.month - 1, attrs.day);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysAgo = Math.round((today - done) / 86400000);
      res.json({ days_ago: daysAgo });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  app.post("/api/" + name + "/" + action, async (_req, res) => {
    try {
      const cfg = haConfig();
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const nowStr =
        now.getFullYear() +
        "-" +
        pad(now.getMonth() + 1) +
        "-" +
        pad(now.getDate()) +
        " " +
        pad(now.getHours()) +
        ":" +
        pad(now.getMinutes()) +
        ":" +
        pad(now.getSeconds());
      await haCall("input_datetime", "set_datetime", {
        entity_id: cfg[entityKey],
        datetime: nowStr,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });
}

app.get("/api/kitchen-light", async (_req, res) => {
  try {
    const cfg = haConfig();
    const lightState = await haGetState(cfg.kitchenLightEntityId);
    const autoState = await haGetState(cfg.kitchenAdaptiveSwitchEntityId);
    const brightness = lightState.attributes.brightness || 0;
    res.json({
      brightness_pct: Math.round((brightness / 255) * 100),
      auto: autoState.state === "on",
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.post("/api/kitchen-light/brightness", async (req, res) => {
  try {
    const pct = parseInt(req.body.brightness_pct, 10);
    const cfg = haConfig();
    // Adaptive Lighting keeps overriding manual brightness unless its switch is off first
    // -- disabling it here, not relying on it to notice the manual change itself, is what
    // the user asked for.
    await haCall("switch", "turn_off", {
      entity_id: cfg.kitchenAdaptiveSwitchEntityId,
    });
    await haCall("light", "turn_on", {
      entity_id: cfg.kitchenLightEntityId,
      brightness_pct: pct,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.post("/api/kitchen-light/auto", async (_req, res) => {
  try {
    const cfg = haConfig();
    await haCall("switch", "turn_on", {
      entity_id: cfg.kitchenAdaptiveSwitchEntityId,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get("/api/dog-fed", async (_req, res) => {
  try {
    const cfg = haConfig();
    const entityId = cfg.dogFedEntityId;
    if (!entityId) return res.json({ configured: false });
    if (!cfg.dogFedMorningWindow || !cfg.dogFedAfternoonWindow) {
      throw new Error(
        "HA_DOG_FED_MORNING_WINDOW / HA_DOG_FED_AFTERNOON_WINDOW not set in dashboard.env",
      );
    }
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const history = await haGetHistory(entityId, todayStart);
    const events = history[0] || [];
    const openTimes = events
      .filter((e) => e.state === "on")
      .map((e) => new Date(e.last_changed));
    const morning = feedWindowStatus(cfg.dogFedMorningWindow, openTimes, now);
    const afternoon = feedWindowStatus(
      cfg.dogFedAfternoonWindow,
      openTimes,
      now,
    );
    // Tells the client to poll fast -- the whole point is knowing within a couple of
    // minutes, not whenever the slow background poll happens to land -- while a feed is
    // still outstanding and due right now. No point polling fast once that window's
    // already fed, or before/after it's even open.
    res.json({
      configured: true,
      morning,
      afternoon,
      in_window:
        (morning === "pending" &&
          windowIsActive(cfg.dogFedMorningWindow, now)) ||
        (afternoon === "pending" &&
          windowIsActive(cfg.dogFedAfternoonWindow, now)),
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// dashboard.env/.deploy.env hold real secrets (HA token, calendar share link) that have no
// business leaving the server. express.static's own `dotfiles` option only catches
// dot-*prefixed* paths (.git, .deploy.env) -- "dashboard.env" isn't dot-prefixed, so that
// alone wouldn't block the actual secrets file this project uses. config.local.js and
// calendar.ics also carry personal data but are legitimately fetched by the browser (see
// index.html/app.js), so this can't be a blanket "nothing personal" rule -- just "no
// dotfiles, no *.env files anywhere in the path".
app.use((req, res, next) => {
  const parts = req.path.split("/");
  if (parts.some((p) => p.startsWith(".")) || req.path.endsWith(".env")) {
    return res.status(403).type("text/plain").send("Forbidden");
  }
  next();
});
app.use(express.static(UI_DIR));

app.use((_req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT);
