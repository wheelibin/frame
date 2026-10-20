// Home Assistant client: reads dashboard.env, makes the authenticated HA calls, and works
// out the dog-fed morning/afternoon window status. No Express/routing in here -- server.js
// owns the HTTP side, this just answers "what does HA say" questions.
"use strict";

const path = require("path");
const fs = require("fs");

// __dirname-relative, not cwd-relative -- entrypoint.sh/dev-deploy.sh both launch the
// server from the dashboard/ root, not from server/, so cwd can't be trusted to find this.
const ENV_FILE = path.join(__dirname, "dashboard.env");

function loadEnv() {
  const env = {};
  for (const rawLine of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const line = rawLine.trim();
    const eq = line.indexOf("=");
    if (!line || line.startsWith("#") || eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function haConfig() {
  const env = loadEnv();
  return {
    url: env.HA_URL,
    token: env.HA_TOKEN,
    entityId: env.HA_ENTITY_ID,
    litterEntityId: env.HA_LITTER_ENTITY_ID,
    dogFedEntityId: env.HA_DOG_FED_ENTITY_ID || "",
    dogFedMorningWindow: env.HA_DOG_FED_MORNING_WINDOW || "",
    dogFedAfternoonWindow: env.HA_DOG_FED_AFTERNOON_WINDOW || "",
    fishEntityId: env.HA_FISH_ENTITY_ID,
    kitchenLightEntityId: env.HA_KITCHEN_LIGHT_ENTITY_ID,
    kitchenAdaptiveSwitchEntityId: env.HA_KITCHEN_ADAPTIVE_SWITCH_ENTITY_ID,
  };
}

async function haFetch(url, options) {
  const res = await fetch(
    url,
    Object.assign({ signal: AbortSignal.timeout(5000) }, options),
  );
  if (!res.ok) throw new Error("HA request failed: HTTP " + res.status);
  return res.json();
}

function haCall(domain, service, body, returnResponse) {
  const cfg = haConfig();
  let url = cfg.url + "/api/services/" + domain + "/" + service;
  if (returnResponse) url += "?return_response";
  return haFetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function haGetState(entityId) {
  const cfg = haConfig();
  return haFetch(cfg.url + "/api/states/" + entityId, {
    headers: { Authorization: "Bearer " + cfg.token },
  });
}

// Current state alone can't say "was the dog fed this morning" -- the sensor flips back to
// closed the moment the lid shuts, so this reads the day's history of state changes instead.
function haGetHistory(entityId, startDt) {
  const cfg = haConfig();
  const url =
    cfg.url +
    "/api/history/period/" +
    encodeURIComponent(startDt.toISOString()) +
    "?filter_entity_id=" +
    encodeURIComponent(entityId) +
    "&minimal_response&no_attributes";
  return haFetch(url, { headers: { Authorization: "Bearer " + cfg.token } });
}

function parseWindow(windowStr, now) {
  const [startS, endS] = windowStr.split("-");
  const [sh, sm] = startS.split(":").map(Number);
  const [eh, em] = endS.split(":").map(Number);
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    sh,
    sm,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    eh,
    em,
    0,
    0,
  );
  return [start, end];
}

// "fed" if the container was opened at any point inside the window; "pending" before the
// window opens; "missed" only once the window has closed with no open event in it -- avoids
// flagging the PM feed as missed first thing in the morning.
function windowIsActive(windowStr, now) {
  const [start, end] = parseWindow(windowStr, now);
  return start <= now && now <= end;
}

function feedWindowStatus(windowStr, openTimes, now) {
  const [start, end] = parseWindow(windowStr, now);
  if (openTimes.some((t) => t >= start && t <= end)) return "fed";
  if (now > end) return "missed";
  return "pending";
}

module.exports = {
  haConfig,
  haCall,
  haGetState,
  haGetHistory,
  windowIsActive,
  feedWindowStatus,
};
