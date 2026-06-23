/**
 * poll.js — Hydrawise polling service
 *
 * Polls the Hydrawise statusschedule API every 60 seconds for all three
 * controllers (Garage, Pool Equipment, Barn). Logs zone state transitions,
 * calculates tank level, detects watering events, and warns on low tank.
 *
 * Phase 4: Uses Supabase client (async API) instead of better-sqlite3.
 */

require('dotenv').config();

const { supabase } = require('./db');
const { controllers, tank, isDitchSeason, getZoneGpm } = require('./zones.config');
const tuya = require('./tuya');
const { depthMetersToGallons } = require('./tank-strapping');

const API_KEY = process.env.HYDRAWISE_API_KEY;
const POLL_INTERVAL_MS = 60_000;

// Tuya ME201W liquid-level sensor poll interval: 2 minutes (120s).
// Rationale: device pushes fresh liquid_depth to Tuya cloud every ~2.5 min
// (144-165s observed via scripts/tuya-discover.js Phase A/B, 2026-06-21).
// Polling at 2 min stays just ahead of the device's push cadence while
// minimizing duplicate reads. update_time is FROZEN/unreliable (didn't advance
// during 10-min fast drawdown), so dedup logic is based on liquid_depth VALUE,
// not timestamp. Override via TANK_POLL_INTERVAL_MS env var for calibration
// sessions (e.g., 20000 for 20s during valve runs).
const TANK_SENSOR_INTERVAL_MS = parseInt(process.env.TANK_POLL_INTERVAL_MS, 10) || 120_000;

// Heartbeat interval: insert a tank_sensor_log row even if depth is unchanged
// when this much time has elapsed since the last insert. Critical for detecting
// logger/sensor failures during long owner absences (~2 months). A silent gap
// must be distinguishable from a stable tank.
const TANK_SENSOR_HEARTBEAT_MS = 20 * 60_000;  // 20 minutes

// In-memory state for detecting zone on/off transitions
const zoneState = {};  // key: "controller:zone_id" → { on: bool, startedAt: number }

// Running tank level estimate (gallons)
let tankLevel = tank.usable_gal;

// Controller IDs discovered from the API (name → id mapping)
// EMERGENCY FALLBACK: If discovery fails due to 429 rate limit, use hardcoded IDs
// from zones.config.js so zone polling never blocks permanently. Discovery will
// still attempt to verify/update these, but polling proceeds immediately.
let controllerMap = {
  'Loomis Garage': 1659477,
  'Loomis Pool Equipment': 1977673,
  'Loomis barn': 1970558
};

// Controller discovery one-shot state
let discoveryCompleted = false;  // true after first successful discovery — never retry customerdetails

// Controller discovery backoff state (only used during startup before first success)
let discoveryBackoffUntil = 0;  // epoch seconds — don't retry discovery before this time
let discoveryRetryCount = 0;    // consecutive failures — drives exponential backoff

// Statusschedule 429 backoff state (when polling endpoints hit rate limit)
let statusschedule429BackoffUntil = 0;  // epoch seconds — skip polling before this time
let statusschedule429Count = 0;  // consecutive 429s — drives exponential backoff (5min → 10min → 20min → 40min cap)

// ──────────────────────────────────────────────
// Hydrawise API
// ──────────────────────────────────────────────

/**
 * Discover controller IDs from the Hydrawise customerdetails endpoint.
 * Returns a map of controller name → controller_id.
 *
 * Rate limit handling: Hydrawise allows ~5 calls per 5 minutes on customerdetails.
 * On 429 (rate limit), exponentially backs off (5min → 10min → 20min → 40min cap).
 */
async function discoverControllers() {
  if (!API_KEY) return null;

  const url = `https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${API_KEY}&type=controllers`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) {
        // Rate limit hit — exponential backoff: 5min → 10min → 20min → 40min (cap)
        discoveryRetryCount++;
        const backoffMin = Math.min(5 * Math.pow(2, discoveryRetryCount - 1), 40);
        discoveryBackoffUntil = Math.floor(Date.now() / 1000) + (backoffMin * 60);
        console.error(`[POLL] Hydrawise rate limit (429) on customerdetails — backing off ${backoffMin} min (retry #${discoveryRetryCount})`);
      } else {
        console.error(`[POLL] Hydrawise customerdetails error: ${res.status}`);
      }
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

    // Success — reset backoff state and mark discovery as permanently complete
    if (Object.keys(map).length > 0) {
      discoveryRetryCount = 0;
      discoveryBackoffUntil = 0;
      discoveryCompleted = true;  // One-shot: never call customerdetails again
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
 * Returns { data, is429 } where data is the JSON response and is429 indicates rate limit.
 */
async function fetchStatus(controllerId) {
  if (!API_KEY) {
    return { data: null, is429: false };
  }

  let url = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${API_KEY}`;
  if (controllerId) {
    url += `&controller_id=${controllerId}`;
  }

  try {
    const res = await fetch(url);
    if (res.status === 429) {
      // Rate limit hit — return special indicator so poll() can back off
      return { data: null, is429: true };
    }
    if (!res.ok) {
      console.error(`[POLL] Hydrawise API error (controller ${controllerId || 'default'}): ${res.status}`);
      return { data: null, is429: false };
    }
    const data = await res.json();
    return { data, is429: false };
  } catch (err) {
    console.error(`[POLL] Hydrawise API fetch failed: ${err.message}`);
    return { data: null, is429: false };
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
        gpm: getZoneGpm(zone),  // measured-primary, configured-fallback
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
 * Detects on→off and off→on transitions, logs to Supabase (async).
 */
async function processZoneStates(zones) {
  const now = Math.floor(Date.now() / 1000);

  for (const z of zones) {
    const key = `${z.controller}:${z.zone_id}`;
    const prev = zoneState[key];
    const isOn = z.running;

    if (isOn && (!prev || !prev.on)) {
      // Zone just turned ON
      zoneState[key] = { on: true, startedAt: now };

      const { error } = await supabase
        .from('zone_state_log')
        .insert({
          controller: z.controller,
          zone_id: z.zone_id,
          relay_id: z.relay_id,
          state: 'on',
          run_seconds: z.run_seconds,
          flow_gpm: z.flow || null
        });

      if (error) {
        console.error(`[POLL] Error logging zone ON: ${error.message}`);
      } else {
        console.log(`[POLL] ${z.controller} ${z.zone_id} (${z.name}) → ON`);
      }

    } else if (!isOn && prev && prev.on) {
      // Zone just turned OFF — record watering event
      const duration = now - prev.startedAt;
      const gallons = z.gpm ? (z.gpm * duration / 60) : null;

      zoneState[key] = { on: false, startedAt: null };

      // Log OFF state
      const { error: offError } = await supabase
        .from('zone_state_log')
        .insert({
          controller: z.controller,
          zone_id: z.zone_id,
          relay_id: z.relay_id,
          state: 'off',
          run_seconds: 0,
          flow_gpm: z.flow || null
        });

      if (offError) {
        console.error(`[POLL] Error logging zone OFF: ${offError.message}`);
      }

      // Log watering event
      const { error: eventError } = await supabase
        .from('watering_events')
        .insert({
          controller: z.controller,
          zone_id: z.zone_id,
          relay_id: z.relay_id,
          duration_seconds: duration,
          gallons: gallons,
          flow_gpm: z.flow || null,
          source: 'scheduled',
          flow_source: 'calculated',
          flow_quality: 'calculated'
        });

      if (eventError) {
        console.error(`[POLL] Error logging watering event: ${eventError.message}`);
      } else {
        console.log(`[POLL] ${z.controller} ${z.zone_id} (${z.name}) → OFF | ${duration}s | ${gallons ? gallons.toFixed(1) : '?'} gal`);
      }
    }
  }
}

/**
 * Update the running tank level estimate (in-memory only).
 * Subtract water used by running zones, add ditch fill rate.
 *
 * NOTE: As of 2026-06-22, we no longer write to tank_level_log (legacy modeled table).
 * tank_sensor_log (measured Tuya ME201W) is the system-of-record. This function keeps
 * the in-memory tankLevel estimate updated for low-tank warnings, but the authoritative
 * tank level for dashboards/reports comes from tank_sensor_log.
 */
async function updateTankLevel(zones) {
  const intervalMin = POLL_INTERVAL_MS / 60_000;

  // Water consumed by all running zones this interval
  let consumed = 0;
  for (const z of zones) {
    if (z.running && z.gpm) {
      consumed += z.gpm * intervalMin;
    }
  }

  // Ditch fill (assume continuous during ditch season Apr 15 - Oct 15)
  const filled = isDitchSeason() ? tank.fill_rate_gpm * intervalMin : 0;

  tankLevel = Math.min(tank.usable_gal, Math.max(0, tankLevel - consumed + filled));

  // Legacy tank_level_log write removed 2026-06-22 — was causing PK violations,
  // and tank_sensor_log (measured) is now authoritative. In-memory tankLevel still
  // tracks for low-tank warnings (until warnings switch to tank_sensor_log queries).

  // Warn if tank is low
  if (tankLevel < tank.low_warning_gal) {
    const { data: existing, error: checkError } = await supabase
      .from('warnings')
      .select('id')
      .eq('type', 'low_tank')
      .eq('resolved', 0)
      .limit(1);

    if (checkError) {
      console.error(`[POLL] Error checking warnings: ${checkError.message}`);
    } else if (!existing || existing.length === 0) {
      const { error: warnError } = await supabase
        .from('warnings')
        .insert({
          type: 'low_tank',
          message: `Tank level critically low: ${Math.round(tankLevel)} gal (threshold: ${tank.low_warning_gal} gal)`,
          resolved: 0
        });

      if (warnError) {
        console.error(`[POLL] Error creating warning: ${warnError.message}`);
      } else {
        console.warn(`[POLL] ⚠ TANK LOW: ${Math.round(tankLevel)} gal`);
      }
    }
  } else {
    // Resolve low tank warning if level recovered
    const { error: resolveError } = await supabase
      .from('warnings')
      .update({ resolved: 1 })
      .eq('type', 'low_tank')
      .eq('resolved', 0);

    if (resolveError) {
      console.error(`[POLL] Error resolving warning: ${resolveError.message}`);
    }
  }
}

// ──────────────────────────────────────────────
// Tuya ME201W tank-sensor poll (independent 2-min timer)
// ──────────────────────────────────────────────

let sensorPollCount = 0;

// Dedup state: track last-logged depth and timestamp to skip duplicate rows.
// Key insight from Phase A/B measurement (2026-06-21): device's update_time is
// FROZEN (didn't advance during 10-min fast drawdown even as liquid_depth
// changed), so we dedup on liquid_depth VALUE, not timestamp. Also enforce a
// 20-min heartbeat: insert even if depth unchanged to prove logger is alive.
let lastLoggedDepthCm = null;
let lastLoggedTimestamp = null;

/**
 * One Tuya read → tank_sensor_log insert (if depth changed OR heartbeat).
 * Dedup logic: only insert when liquid_depth differs from last logged value,
 * OR when >= 20 min since last insert (heartbeat to prove logger is alive).
 *
 * Idempotent w.r.t. failures: the Tuya fetch and the Supabase insert are
 * guarded separately so a Tuya outage doesn't masquerade as a Supabase outage
 * in the logs. Loud errors, but never throws — the setInterval must survive
 * transient failures.
 *
 * The strapping table's `clamped` value (when non-null) is mirrored into
 * `warnings` so dashboards/SMS surface the out-of-range condition without
 * having to scan tank_sensor_log themselves.
 */
async function pollTankSensor() {
  sensorPollCount++;

  // Step 1: Tuya read (device status + device info for update_time).
  let dps, deviceInfo;
  try {
    [dps, deviceInfo] = await Promise.all([
      tuya.getDeviceStatus(),
      tuya.getDeviceInfo()
    ]);
  } catch (err) {
    console.error(`[TANK-SENSOR] Tuya fetch failed: ${err.message}`);
    return;
  }

  const depthDp = dps.find(d => d.code === 'liquid_depth');
  if (!depthDp) {
    console.error('[TANK-SENSOR] liquid_depth DP not present in Tuya response — device profile changed?');
    return;
  }

  // DP unit is integer centimetres (confirmed against installation_height/
  // liquid_depth_max calibration constants during 2026-06-20 discovery).
  const depthCm = depthDp.value;
  const depthM = depthCm / 100;
  const { gallons, depthIn, clamped } = depthMetersToGallons(depthM);
  const timestamp = Math.floor(Date.now() / 1000);
  const deviceUpdateTime = deviceInfo.update_time;

  // Step 2: Dedup check — skip insert if depth unchanged AND heartbeat not due.
  const depthChanged = lastLoggedDepthCm === null || depthCm !== lastLoggedDepthCm;
  const heartbeatDue = lastLoggedTimestamp === null ||
    (timestamp - lastLoggedTimestamp) >= (TANK_SENSOR_HEARTBEAT_MS / 1000);

  if (!depthChanged && !heartbeatDue) {
    // Depth unchanged and heartbeat not due — skip insert, preserve dedup state.
    return;
  }

  // Step 3: Supabase insert.
  const { error: insertErr } = await supabase
    .from('tank_sensor_log')
    .insert({
      timestamp,
      depth_meters: depthM,
      depth_inches: Math.round(depthIn * 100) / 100,
      level_gallons: Math.round(gallons * 10) / 10,
      source: 'sensor',
      clamped,
      device_update_time: deviceUpdateTime,
    });

  if (insertErr) {
    console.error(`[TANK-SENSOR] tank_sensor_log insert failed: ${insertErr.message}`);
    return;
  }

  // Update dedup state ONLY after successful insert.
  lastLoggedDepthCm = depthCm;
  lastLoggedTimestamp = timestamp;

  // Step 4: clamp fan-out to warnings.
  if (clamped) {
    const { error: warnErr } = await supabase
      .from('warnings')
      .insert({
        type: 'tank_sensor_clamped',
        message: `Tank sensor reading clamped ${clamped} (raw depth ${depthM.toFixed(3)} m / ${depthIn.toFixed(2)} in)`,
        resolved: 0,
      });
    if (warnErr) {
      console.error(`[TANK-SENSOR] warnings insert failed: ${warnErr.message}`);
    }
  }

  // Log on first cycle, hourly (~30 cycles × 2min = 60min), or when depth changed.
  const reason = depthChanged ? 'CHANGED' : 'heartbeat';
  if (sensorPollCount === 1 || sensorPollCount % 30 === 0 || depthChanged) {
    console.log(`[TANK-SENSOR] Cycle #${sensorPollCount} (${reason}) | ${depthCm}cm → ${Math.round(gallons)} gal${clamped ? ` (CLAMPED ${clamped})` : ''}`);
  }
}

// ──────────────────────────────────────────────
// Main poll loop
// ──────────────────────────────────────────────

let pollCount = 0;

async function poll() {
  try {
    pollCount++;

    // ONE-SHOT DISCOVERY: only attempt if not yet completed
    // With the emergency fallback controllerMap initialized above, discovery failure
    // no longer blocks zone polling. Discovery still runs to verify IDs, but polling
    // proceeds with fallback values if discovery is rate-limited.
    if (!discoveryCompleted) {
      const now = Math.floor(Date.now() / 1000);

      // Check backoff window — don't retry discovery if we're in backoff
      if (discoveryBackoffUntil > 0 && now < discoveryBackoffUntil) {
        const waitMin = Math.ceil((discoveryBackoffUntil - now) / 60);
        if (pollCount === 1 || pollCount % 5 === 0) {
          console.warn(`[POLL] Controller discovery in backoff — ${waitMin} min remaining (rate limit recovery). Using fallback controller IDs; zone polling continues.`);
        }
        // FALLBACK: controllerMap already initialized with hardcoded IDs — fall through to polling
      } else {
        // Attempt discovery (not in backoff)
        const discovered = await discoverControllers();
        if (discovered) {
          // Discovery succeeded — update controllerMap and mark complete
          controllerMap = discovered;
          console.log(`[POLL] Discovery succeeded — verified ${Object.keys(controllerMap).length} controllers`);
        } else {
          // Discovery failed (429 or network error) — backoff already set in discoverControllers()
          if (pollCount === 1 || pollCount % 5 === 0) {
            console.warn(`[POLL] Discovery failed (will retry) — using fallback controller IDs for now`);
          }
        }
      }
    }

    // ZONE-STATE POLLING: runs every cycle once controllers are cached
    // This section is DECOUPLED from discovery — continues uninterrupted even if
    // a future 429 on customerdetails (which we never call again) would trigger backoff.
    const now = Math.floor(Date.now() / 1000);
    let allZones = [];

    // Check if we're in statusschedule 429 backoff
    if (statusschedule429BackoffUntil > 0 && now < statusschedule429BackoffUntil) {
      const waitMin = Math.ceil((statusschedule429BackoffUntil - now) / 60);
      if (pollCount === 1 || pollCount % 5 === 0) {
        console.warn(`[POLL] Statusschedule API rate-limited (429) — backing off ${waitMin} min. Zone polling skipped this cycle.`);
      }
      // Skip polling this cycle but don't crash — tank level update with empty zones
      await updateTankLevel([]);
      return;
    }

    // Poll each controller separately
    let any429 = false;
    for (const ctrl of controllers) {
      const ctrlId = controllerMap[ctrl.name];
      if (!ctrlId) {
        // Controller not found in Hydrawise account — name mismatch or not registered
        if (pollCount === 1) {
          console.warn(`[POLL] Controller "${ctrl.name}" (id: ${ctrl.id || 'null'}) not found in discovered controllers — skipping. Check name matches Hydrawise exactly (case-sensitive).`);
        }
        continue;
      }

      const { data, is429 } = await fetchStatus(ctrlId);
      if (is429) {
        any429 = true;
        continue;  // Skip this controller, don't crash
      }
      if (!data) continue;

      const zones = parseRelays(data, ctrl);
      allZones = allZones.concat(zones);
    }

    // If any controller hit 429, set exponential backoff
    if (any429) {
      statusschedule429Count++;
      const backoffMin = Math.min(5 * Math.pow(2, statusschedule429Count - 1), 40);
      statusschedule429BackoffUntil = now + (backoffMin * 60);
      console.warn(`[POLL] Statusschedule API rate-limited (429) on one or more controllers — backing off ${backoffMin} min (retry #${statusschedule429Count}). Zone polling will resume automatically.`);
    } else if (statusschedule429Count > 0) {
      // Successful poll after previous 429s — reset backoff state
      console.log(`[POLL] Statusschedule API recovered from rate limit — zone polling resumed`);
      statusschedule429Count = 0;
      statusschedule429BackoffUntil = 0;
    }

    await processZoneStates(allZones);
    await updateTankLevel(allZones);

    // Log every poll on first cycle, then every 5 minutes
    const running = allZones.filter(z => z.running);
    if (pollCount === 1 || pollCount % 5 === 0) {
      console.log(`[POLL] Cycle #${pollCount} | Tank: ${Math.round(tankLevel)} gal | Zones polled: ${allZones.length} | Running: ${running.length}`);
    }
  } catch (err) {
    console.error(`[POLL] Poll cycle error: ${err.message}`);
    console.error(err.stack);
  }
}

// ──────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────

// CRITICAL: Prevent crashes from unhandled promise rejections (e.g., transient API errors)
// Railway will restart the container on crash, creating a feedback loop that deepens
// rate limits. Log and continue instead.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[POLL] UNHANDLED PROMISE REJECTION — process will NOT crash');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('[POLL] UNCAUGHT EXCEPTION — process will NOT crash');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
});

console.log('[POLL] Hydrawise polling service starting (Supabase mode)');
console.log(`[POLL] Controllers: ${controllers.map(c => c.name).join(', ')}`);
console.log(`[POLL] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`[POLL] API key: ${API_KEY ? 'loaded (' + API_KEY.length + ' chars)' : 'NOT SET'}`);

if (!API_KEY) {
  console.warn('[POLL] HYDRAWISE_API_KEY not set in .env — will poll but get no data');
}

// First poll immediately, then every 60s
poll();
setInterval(poll, POLL_INTERVAL_MS);

// Tuya tank-sensor poll: independent 2-min timer (env-overridable for calibration).
// Skipped (with a loud one-time warning) if Tuya creds aren't configured — same
// silent-failure trap that bit SUPABASE_SERVICE_KEY on Railway is exactly what
// this guard protects against.
const tuyaConfigured = !!(process.env.TUYA_ACCESS_ID && process.env.TUYA_ACCESS_SECRET && process.env.TUYA_DEVICE_ID);
const intervalDisplay = TANK_SENSOR_INTERVAL_MS >= 60_000
  ? `${TANK_SENSOR_INTERVAL_MS / 60_000}min`
  : `${TANK_SENSOR_INTERVAL_MS / 1000}s`;
console.log(`[TANK-SENSOR] Tuya creds: ${tuyaConfigured ? 'loaded' : 'NOT SET'} | region: ${process.env.TUYA_REGION || 'us (default)'} | interval: ${intervalDisplay} | heartbeat: ${TANK_SENSOR_HEARTBEAT_MS / 60_000}min`);

if (tuyaConfigured) {
  pollTankSensor();
  setInterval(pollTankSensor, TANK_SENSOR_INTERVAL_MS);
} else {
  console.warn('[TANK-SENSOR] TUYA_ACCESS_ID/SECRET/DEVICE_ID not set — measured-tank logging disabled. In-memory tank tracking active for low-tank warnings only.');
}

// ──────────────────────────────────────────────
// Bootstrap scheduler (cron jobs)
// ──────────────────────────────────────────────

// Railway runs poll.js directly (not server.js), so the scheduler must be
// bootstrapped here to activate all 8 cron jobs (ditch monitor, ET logger,
// daily reports, etc.). The scheduler module is idempotent/singleton-safe,
// so loading it from both poll.js (production) and server.js (local dev) is fine.
require('./scheduler');
