/**
 * poll.js — Hydrawise polling service
 *
 * Polls the Hydrawise statusschedule API every 60 seconds for all three
 * controllers (Garage, Pool Equipment, Barn). Logs zone state transitions,
 * calculates tank level, detects watering events, and warns on low tank.
 *
 * Uses better-sqlite3 via getDb() from db.js.
 */

require('dotenv').config();

const { getDb } = require('./db');
const { syncAll } = require('./sync');
const { controllers, tank } = require('./zones.config');

const API_KEY = process.env.HYDRAWISE_API_KEY;
const POLL_INTERVAL_MS = 60_000;

// In-memory state for detecting zone on/off transitions
const zoneState = {};  // key: "controller:zone_id" → { on: bool, startedAt: number }

// Running tank level estimate (gallons)
let tankLevel = tank.usable_gal;

// Controller IDs discovered from the API (name → id mapping)
let controllerMap = null;

// ──────────────────────────────────────────────
// Hydrawise API
// ──────────────────────────────────────────────

/**
 * Discover controller IDs from the Hydrawise customerdetails endpoint.
 * Returns a map of controller name → controller_id.
 */
async function discoverControllers() {
  if (!API_KEY) return null;

  const url = `https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${API_KEY}&type=controllers`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[POLL] Hydrawise customerdetails error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const map = {};

    if (data.controllers && Array.isArray(data.controllers)) {
      for (const ctrl of data.controllers) {
        map[ctrl.name] = ctrl.controller_id;
        console.log(`[POLL] Discovered controller: "${ctrl.name}" (id: ${ctrl.controller_id})`);
      }
    }

    return Object.keys(map).length > 0 ? map : null;
  } catch (err) {
    console.error(`[POLL] Controller discovery failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch statusschedule from Hydrawise API for a specific controller.
 * If controllerId is null, fetches the default controller.
 */
async function fetchStatus(controllerId) {
  if (!API_KEY) {
    return null;
  }

  let url = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${API_KEY}`;
  if (controllerId) {
    url += `&controller_id=${controllerId}`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[POLL] Hydrawise API error (controller ${controllerId || 'default'}): ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[POLL] Hydrawise API fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Parse Hydrawise relay data for a specific controller.
 * Returns array of { controller, zone_id, relay_id, name, gpm, running, run_seconds, flow }
 */
function parseRelays(apiData, ctrlConfig) {
  const results = [];
  const relays = apiData.relays || [];

  for (const relay of relays) {
    const relayId = relay.relay;
    const running = relay.time === 1 ||
      (typeof relay.timestr === 'string' && relay.timestr.toLowerCase().includes('running'));
    const runSec = relay.run || 0;

    // Match by relay number against this controller's zone config
    const zone = ctrlConfig.zones.find(z => z.relay_id === relayId);
    if (zone) {
      results.push({
        controller: ctrlConfig.name,
        zone_id: zone.zone_id,
        relay_id: relayId,
        name: zone.name,
        gpm: zone.gpm,
        running,
        run_seconds: runSec,
        flow: relay.flow || 0,
      });
    }
  }

  return results;
}

// ──────────────────────────────────────────────
// State tracking and logging
// ──────────────────────────────────────────────

/**
 * Process zone states from one poll cycle.
 * Detects on→off and off→on transitions, logs to DB.
 */
function processZoneStates(zones) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  for (const z of zones) {
    const key = `${z.controller}:${z.zone_id}`;
    const prev = zoneState[key];
    const isOn = z.running;

    if (isOn && (!prev || !prev.on)) {
      // Zone just turned ON
      zoneState[key] = { on: true, startedAt: now };

      db.prepare(
        `INSERT INTO zone_state_log (controller, zone_id, relay_id, state, run_seconds, flow_gpm)
         VALUES (?, ?, ?, 'on', ?, ?)`
      ).run(z.controller, z.zone_id, z.relay_id, z.run_seconds, z.flow || null);

      console.log(`[POLL] ${z.controller} ${z.zone_id} (${z.name}) → ON`);

    } else if (!isOn && prev && prev.on) {
      // Zone just turned OFF — record watering event
      const duration = now - prev.startedAt;
      const gallons = z.gpm ? (z.gpm * duration / 60) : null;

      zoneState[key] = { on: false, startedAt: null };

      db.prepare(
        `INSERT INTO zone_state_log (controller, zone_id, relay_id, state, run_seconds, flow_gpm)
         VALUES (?, ?, ?, 'off', 0, ?)`
      ).run(z.controller, z.zone_id, z.relay_id, z.flow || null);

      db.prepare(
        `INSERT INTO watering_events (controller, zone_id, relay_id, duration_seconds, gallons, flow_gpm, source)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
      ).run(z.controller, z.zone_id, z.relay_id, duration, gallons, z.flow || null);

      console.log(`[POLL] ${z.controller} ${z.zone_id} (${z.name}) → OFF | ${duration}s | ${gallons ? gallons.toFixed(1) : '?'} gal`);
    }
  }
}

/**
 * Update the running tank level estimate.
 * Subtract water used by running zones, add ditch fill rate.
 * Log to tank_level_log.
 */
function updateTankLevel(zones) {
  const db = getDb();
  const intervalMin = POLL_INTERVAL_MS / 60_000;

  // Water consumed by all running zones this interval
  let consumed = 0;
  for (const z of zones) {
    if (z.running && z.gpm) {
      consumed += z.gpm * intervalMin;
    }
  }

  // Ditch fill (assume continuous during ditch season Apr 15 - Oct 15)
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const isDitchSeason = (month > 4 || (month === 4 && day >= 15)) &&
                        (month < 10 || (month === 10 && day <= 15));
  const filled = isDitchSeason ? tank.fill_rate_gpm * intervalMin : 0;

  tankLevel = Math.min(tank.usable_gal, Math.max(0, tankLevel - consumed + filled));

  // Log tank level
  db.prepare(
    `INSERT INTO tank_level_log (level_gallons, source)
     VALUES (?, 'calculated')`
  ).run(Math.round(tankLevel * 10) / 10);

  // Warn if tank is low
  if (tankLevel < tank.low_warning_gal) {
    const existing = db.prepare(
      `SELECT id FROM warnings WHERE type = 'low_tank' AND resolved = 0`
    ).get();

    if (!existing) {
      db.prepare(
        `INSERT INTO warnings (type, message, resolved)
         VALUES ('low_tank', ?, 0)`
      ).run(`Tank level critically low: ${Math.round(tankLevel)} gal (threshold: ${tank.low_warning_gal} gal)`);
      console.warn(`[POLL] ⚠ TANK LOW: ${Math.round(tankLevel)} gal`);
    }
  } else {
    // Resolve low tank warning if level recovered
    db.prepare(
      `UPDATE warnings SET resolved = 1 WHERE type = 'low_tank' AND resolved = 0`
    ).run();
  }
}

// ──────────────────────────────────────────────
// Main poll loop
// ──────────────────────────────────────────────

let pollCount = 0;

async function poll() {
  pollCount++;
  const db = getDb();

  // Discover controller IDs on first poll
  if (!controllerMap) {
    controllerMap = await discoverControllers();
    if (!controllerMap) {
      console.warn('[POLL] Could not discover controllers — will retry next cycle');
      updateTankLevel([]);
      return;
    }
  }

  let allZones = [];

  // Poll each controller separately
  for (const ctrl of controllers) {
    const ctrlId = controllerMap[ctrl.name];
    if (!ctrlId) {
      // Controller not found in Hydrawise account (e.g. Barn not yet registered)
      continue;
    }

    const data = await fetchStatus(ctrlId);
    if (!data) continue;

    const zones = parseRelays(data, ctrl);
    allZones = allZones.concat(zones);
  }

  processZoneStates(allZones);
  updateTankLevel(allZones);

  // Log every poll on first cycle, then every 5 minutes
  const running = allZones.filter(z => z.running);
  if (pollCount === 1 || pollCount % 5 === 0) {
    console.log(`[POLL] Cycle #${pollCount} | Tank: ${Math.round(tankLevel)} gal | Zones polled: ${allZones.length} | Running: ${running.length}`);
  }

  // Periodic sync to Supabase (every 5 minutes)
  if (pollCount % 5 === 0) {
    try {
      await syncAll();
    } catch (err) {
      console.error(`[POLL] Sync error: ${err.message}`);
    }
  }
}

// ──────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────

console.log('[POLL] Hydrawise polling service starting');
console.log(`[POLL] Controllers: ${controllers.map(c => c.name).join(', ')}`);
console.log(`[POLL] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`[POLL] API key: ${API_KEY ? 'loaded (' + API_KEY.length + ' chars)' : 'NOT SET'}`);

if (!API_KEY) {
  console.warn('[POLL] HYDRAWISE_API_KEY not set in .env — will poll but get no data');
}

// Initialize DB
getDb();

// First poll immediately, then every 60s
poll();
setInterval(poll, POLL_INTERVAL_MS);
