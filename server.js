/**
 * server.js — Express server for the Loomis irrigation system
 *
 * Runs on port 3001 alongside poll.js.
 * Handles Twilio webhooks, web app API calls, and sensor data.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { getDb } = require('./db');
const { handleInboundSMS } = require('./sms/handler');
const { sendSMS } = require('./sms/sender');

// Load scheduler (registers cron jobs on import)
require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

// Parse URL-encoded bodies (Twilio sends form data)
app.use(bodyParser.urlencoded({ extended: false }));
// Parse JSON bodies (web app and sensor data)
app.use(bodyParser.json());

// Static assets for the local operator dashboard (see public/index.html)
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'irrigation-server',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ──────────────────────────────────────────────
// System status
// ──────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const tank = db.prepare(
      'SELECT level_gallons, source, timestamp FROM tank_level_log ORDER BY id DESC LIMIT 1'
    ).get();

    const et = db.prepare(
      'SELECT et_inches, source FROM et_log WHERE date = ?'
    ).get(today);

    const zonesRunning = db.prepare(
      `SELECT zone_id, controller, run_seconds, flow_gpm
       FROM zone_state_log
       WHERE state = 'on'
       ORDER BY timestamp DESC`
    ).all();

    const zonesToday = db.prepare(
      `SELECT zone_id, controller, duration_seconds, gallons
       FROM watering_events
       WHERE date(timestamp, 'unixepoch') = ?`
    ).all(today);

    const suspension = db.prepare(
      `SELECT message FROM warnings WHERE type = 'suspension' AND resolved = 0`
    ).get();

    res.json({
      tank: tank ? {
        level_gallons: tank.level_gallons,
        source: tank.source,
        last_updated: tank.timestamp,
      } : null,
      et_today: et ? {
        et_inches: et.et_inches,
        source: et.source,
      } : null,
      zones_running: zonesRunning,
      zones_today: zonesToday,
      suspended: suspension ? suspension.message : null,
    });
  } catch (err) {
    console.error('[API] /api/status error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// Dashboard API endpoints
// ──────────────────────────────────────────────

app.get('/api/dashboard/health', (req, res) => {
  try {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Last poll: most recent tank_level_log entry (poll.js writes every 60s)
    const lastPollRow = db.prepare(
      'SELECT timestamp FROM tank_level_log ORDER BY id DESC LIMIT 1'
    ).get();

    const lastPoll = lastPollRow ? {
      timestamp: new Date(lastPollRow.timestamp * 1000).toISOString(),
      secondsAgo: now - lastPollRow.timestamp
    } : null;

    // Last watering event: most recent watering_events entry
    const lastEventRow = db.prepare(
      'SELECT timestamp, controller, zone_id FROM watering_events ORDER BY id DESC LIMIT 1'
    ).get();

    let lastWateringEvent = null;
    if (lastEventRow) {
      // Load zones.config.js to resolve zone name
      const { controllers } = require('./zones.config.js');
      const controller = controllers.find(c => c.name === lastEventRow.controller);
      const zone = controller ? controller.zones.find(z => z.zone_id === lastEventRow.zone_id) : null;
      const zoneName = zone ? zone.name : 'Unknown zone';

      lastWateringEvent = {
        timestamp: new Date(lastEventRow.timestamp * 1000).toISOString(),
        secondsAgo: now - lastEventRow.timestamp,
        zone: `${lastEventRow.controller} ${lastEventRow.zone_id} (${zoneName})`
      };
    }

    // Last tank level: same as lastPoll but include level
    const lastTankRow = db.prepare(
      'SELECT timestamp, level_gallons FROM tank_level_log ORDER BY id DESC LIMIT 1'
    ).get();

    const lastTankLevel = lastTankRow ? {
      timestamp: new Date(lastTankRow.timestamp * 1000).toISOString(),
      secondsAgo: now - lastTankRow.timestamp,
      level_gallons: lastTankRow.level_gallons
    } : null;

    // Health flags
    const pollHealthy = lastPoll ? lastPoll.secondsAgo < 90 : false;
    const dbReachable = true; // if we got here, db is reachable

    res.json({
      lastPoll,
      lastWateringEvent,
      lastTankLevel,
      pollHealthy,
      dbReachable
    });
  } catch (err) {
    console.error('[API] /api/dashboard/health error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      dbReachable: false
    });
  }
});

app.get('/api/dashboard/events', (req, res) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(30, parseInt(req.query.days, 10) || 7));
    const now = Math.floor(Date.now() / 1000);
    const rangeStart = now - (days * 86400);

    // Load zones.config.js once and build a lookup map
    const { controllers } = require('./zones.config.js');
    const zoneMap = new Map();
    for (const ctrl of controllers) {
      for (const z of ctrl.zones) {
        const key = `${ctrl.name}:${z.zone_id}`;
        zoneMap.set(key, z);
      }
    }

    // Query watering_events
    const rows = db.prepare(
      `SELECT timestamp, controller, zone_id, relay_id, duration_seconds, gallons,
              flow_source, flow_quality
       FROM watering_events
       WHERE timestamp >= ?
       ORDER BY timestamp DESC`
    ).all(rangeStart);

    const events = rows.map(row => {
      const key = `${row.controller}:${row.zone_id}`;
      const zone = zoneMap.get(key);

      return {
        timestamp: new Date(row.timestamp * 1000).toISOString(),
        controller: row.controller,
        zoneId: row.zone_id,
        zoneName: zone ? zone.name : null,
        zoneType: zone ? zone.type : null,
        relayId: row.relay_id,
        durationSeconds: row.duration_seconds,
        gallonsCalculated: row.gallons,
        configuredGpm: zone ? zone.gpm : null,
        flowQuality: row.flow_quality || 'calculated',
        flowSource: row.flow_source || 'calculated'
      };
    });

    res.json({
      events,
      rangeStart: new Date(rangeStart * 1000).toISOString(),
      rangeEnd: new Date(now * 1000).toISOString(),
      count: events.length,
      note: "Gallons are calculated from configured zone GPM × run duration. Real-time flow measurement is not available via the Hydrawise REST API v1."
    });
  } catch (err) {
    console.error('[API] /api/dashboard/events error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dashboard/tank', (req, res) => {
  try {
    const db = getDb();
    const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 24));
    const now = Math.floor(Date.now() / 1000);
    const rangeStart = now - (hours * 3600);

    // Query tank_level_log
    const rows = db.prepare(
      `SELECT timestamp, level_gallons, source
       FROM tank_level_log
       WHERE timestamp >= ?
       ORDER BY timestamp ASC`
    ).all(rangeStart);

    const estimates = rows.map(row => ({
      timestamp: new Date(row.timestamp * 1000).toISOString(),
      level_gallons: row.level_gallons,
      source: row.source
    }));

    // Thresholds from zones.config.js
    const { tank } = require('./zones.config.js');

    res.json({
      estimates,
      rangeStart: new Date(rangeStart * 1000).toISOString(),
      rangeEnd: new Date(now * 1000).toISOString(),
      count: estimates.length,
      thresholds: {
        maxUsable: tank.usable_gal,
        safetyFloor: tank.low_warning_gal,
        pumpCutoff: tank.pump_cutoff_gal
      }
    });
  } catch (err) {
    console.error('[API] /api/dashboard/tank error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// Twilio inbound SMS webhook
// ──────────────────────────────────────────────

app.post('/webhook/sms', handleInboundSMS);

// ──────────────────────────────────────────────
// ESP32 tank sensor data (Phase 7 stub)
// ──────────────────────────────────────────────

app.post('/webhook/sensor', (req, res) => {
  try {
    const { depth_inches, level_gallons } = req.body;

    if (depth_inches == null && level_gallons == null) {
      return res.status(400).json({ error: 'depth_inches or level_gallons required' });
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO tank_sensor_log (depth_inches, level_gallons, source)
       VALUES (?, ?, 'sensor')`
    ).run(depth_inches || null, level_gallons || null);

    // Also update tank_level_log with sensor reading
    if (level_gallons != null) {
      db.prepare(
        `INSERT INTO tank_level_log (level_gallons, source)
         VALUES (?, 'sensor')`
      ).run(level_gallons);
    }

    console.log(`[SENSOR] Tank reading: depth=${depth_inches}in, level=${level_gallons}gal`);
    res.json({ status: 'ok', received: { depth_inches, level_gallons } });
  } catch (err) {
    console.error('[SENSOR] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// Zone control API (from web app)
// ──────────────────────────────────────────────

app.post('/api/zone/start', (req, res) => {
  try {
    const { zone_id, controller, duration_seconds } = req.body;
    if (!zone_id || !controller) {
      return res.status(400).json({ error: 'zone_id and controller required' });
    }

    // Phase 4 stub — will call Hydrawise setzone API
    console.log(`[API] Zone start requested: ${controller} ${zone_id} for ${duration_seconds || 'default'}s`);

    const db = getDb();
    db.prepare(
      `INSERT INTO zone_state_log (controller, zone_id, state, run_seconds)
       VALUES (?, ?, 'on', ?)`
    ).run(controller, zone_id, duration_seconds || 0);

    res.json({
      status: 'ok',
      message: `Zone ${zone_id} on ${controller} start command queued`,
      note: 'Hydrawise API integration pending (Phase 4)',
    });
  } catch (err) {
    console.error('[API] /api/zone/start error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/zone/stop', (req, res) => {
  try {
    const { zone_id, controller } = req.body;
    if (!zone_id || !controller) {
      return res.status(400).json({ error: 'zone_id and controller required' });
    }

    console.log(`[API] Zone stop requested: ${controller} ${zone_id}`);

    const db = getDb();
    db.prepare(
      `INSERT INTO zone_state_log (controller, zone_id, state)
       VALUES (?, ?, 'off')`
    ).run(controller, zone_id);

    res.json({
      status: 'ok',
      message: `Zone ${zone_id} on ${controller} stop command queued`,
      note: 'Hydrawise API integration pending (Phase 4)',
    });
  } catch (err) {
    console.error('[API] /api/zone/stop error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/zone/suspend', (req, res) => {
  try {
    const { zone_id, controller, days } = req.body;
    if (!zone_id || !controller) {
      return res.status(400).json({ error: 'zone_id and controller required' });
    }

    const n = parseInt(days, 10) || 3;
    const resumeDate = new Date();
    resumeDate.setDate(resumeDate.getDate() + n);
    const resumeStr = resumeDate.toISOString().slice(0, 10);

    console.log(`[API] Zone suspend requested: ${controller} ${zone_id} for ${n} days`);

    const db = getDb();
    db.prepare(
      `INSERT INTO warnings (type, message, zone_id, controller, resolved)
       VALUES ('zone_suspension', ?, ?, ?, 0)`
    ).run(`Zone ${zone_id} suspended until ${resumeStr}`, zone_id, controller);

    res.json({
      status: 'ok',
      message: `Zone ${zone_id} on ${controller} suspended until ${resumeStr}`,
    });
  } catch (err) {
    console.error('[API] /api/zone/suspend error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/controller/suspend', (req, res) => {
  try {
    const { controller, days } = req.body;
    if (!controller) {
      return res.status(400).json({ error: 'controller required' });
    }

    const n = parseInt(days, 10) || 3;
    const resumeDate = new Date();
    resumeDate.setDate(resumeDate.getDate() + n);
    const resumeStr = resumeDate.toISOString().slice(0, 10);

    console.log(`[API] Controller suspend requested: ${controller} for ${n} days`);

    const db = getDb();
    db.prepare(
      `INSERT INTO warnings (type, message, controller, resolved)
       VALUES ('controller_suspension', ?, ?, 0)`
    ).run(`Controller ${controller} suspended until ${resumeStr}`, controller);

    res.json({
      status: 'ok',
      message: `All zones on ${controller} suspended until ${resumeStr}`,
    });
  } catch (err) {
    console.error('[API] /api/controller/suspend error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────

function start() {
  getDb(); // ensure tables exist
  app.listen(PORT, () => {
    console.log(`[SERVER] Irrigation server listening on port ${PORT}`);
    console.log(`[SERVER] Health check: http://localhost:${PORT}/api/health`);
  });
}

start();

module.exports = app;
