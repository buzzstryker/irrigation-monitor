/**
 * server.js — Express server for the Loomis irrigation system
 *
 * Runs on port 3001 alongside poll.js.
 * Handles Twilio webhooks, web app API calls, and sensor data.
 */

require('dotenv').config();

const express = require('express');
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
