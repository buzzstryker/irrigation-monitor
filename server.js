/**
 * server.js — Express server for the Loomis irrigation system
 *
 * Runs on port 3001 alongside poll.js.
 * Handles Twilio webhooks, web app API calls, and sensor data.
 *
 * Phase 4: Uses Supabase client (async API) instead of better-sqlite3.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { supabase } = require('./db');
const { handleInboundSMS } = require('./sms/handler');
const { sendSMS } = require('./sms/sender');
const { getEffectiveGpm, getAllZoneGpms, setOverride, resetOverride, getChangeHistory } = require('./zone-gpm');

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

app.get('/api/status', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get latest tank level
    const { data: tankData, error: tankError } = await supabase
      .from('tank_level_log')
      .select('level_gallons, source, timestamp')
      .order('id', { ascending: false })
      .limit(1)
      .single();

    if (tankError && tankError.code !== 'PGRST116') {
      console.error('[API] Tank level query error:', tankError.message);
    }

    // Get today's ET
    const { data: etData, error: etError } = await supabase
      .from('et_log')
      .select('et_inches, source')
      .eq('date', today)
      .maybeSingle();

    if (etError) {
      console.error('[API] ET query error:', etError.message);
    }

    // Get zones currently running
    const { data: zonesRunning, error: zonesError } = await supabase
      .from('zone_state_log')
      .select('zone_id, controller, run_seconds, flow_gpm')
      .eq('state', 'on')
      .order('timestamp', { ascending: false });

    if (zonesError) {
      console.error('[API] Zones running query error:', zonesError.message);
    }

    // Get today's watering events
    const now = Math.floor(Date.now() / 1000);
    const todayStart = now - (now % 86400); // Start of today in Unix epoch
    const { data: zonesToday, error: todayError } = await supabase
      .from('watering_events')
      .select('zone_id, controller, duration_seconds, gallons')
      .gte('timestamp', todayStart);

    if (todayError) {
      console.error('[API] Today events query error:', todayError.message);
    }

    // Check for suspension
    const { data: suspensionData, error: suspensionError } = await supabase
      .from('warnings')
      .select('message')
      .eq('type', 'suspension')
      .eq('resolved', 0)
      .maybeSingle();

    if (suspensionError) {
      console.error('[API] Suspension query error:', suspensionError.message);
    }

    res.json({
      tank: tankData ? {
        level_gallons: tankData.level_gallons,
        source: tankData.source,
        last_updated: tankData.timestamp,
      } : null,
      et_today: etData ? {
        et_inches: etData.et_inches,
        source: etData.source,
      } : null,
      zones_running: zonesRunning || [],
      zones_today: zonesToday || [],
      suspended: suspensionData ? suspensionData.message : null,
    });
  } catch (err) {
    console.error('[API] /api/status error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// Dashboard API endpoints
// ──────────────────────────────────────────────

app.get('/api/dashboard/health', async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Last poll: most recent tank_level_log entry (poll.js writes every 60s)
    const { data: lastPollRow, error: pollError } = await supabase
      .from('tank_level_log')
      .select('timestamp')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pollError) {
      console.error('[API] Last poll query error:', pollError.message);
    }

    const lastPoll = lastPollRow ? {
      timestamp: new Date(lastPollRow.timestamp * 1000).toISOString(),
      secondsAgo: now - lastPollRow.timestamp
    } : null;

    // Last watering event: most recent watering_events entry
    const { data: lastEventRow, error: eventError } = await supabase
      .from('watering_events')
      .select('timestamp, controller, zone_id')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (eventError) {
      console.error('[API] Last event query error:', eventError.message);
    }

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
    const { data: lastTankRow, error: tankError } = await supabase
      .from('tank_level_log')
      .select('timestamp, level_gallons')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tankError) {
      console.error('[API] Last tank query error:', tankError.message);
    }

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

app.get('/api/dashboard/events', async (req, res) => {
  try {
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
    const { data: rows, error } = await supabase
      .from('watering_events')
      .select('timestamp, controller, zone_id, relay_id, duration_seconds, gallons, flow_source, flow_quality')
      .gte('timestamp', rangeStart)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('[API] Events query error:', error.message);
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Map events with effective GPM (need to await each call)
    const events = await Promise.all((rows || []).map(async row => {
      const key = `${row.controller}:${row.zone_id}`;
      const zone = zoneMap.get(key);

      // Get effective GPM (override if present, else config default) - now async
      const effectiveGpmData = await getEffectiveGpm(row.controller, row.zone_id);

      return {
        timestamp: new Date(row.timestamp * 1000).toISOString(),
        controller: row.controller,
        zoneId: row.zone_id,
        zoneName: zone ? zone.name : null,
        zoneType: zone ? zone.type : null,
        relayId: row.relay_id,
        durationSeconds: row.duration_seconds,
        gallonsCalculated: row.gallons,
        configuredGpm: effectiveGpmData.gpm,
        gpmSource: effectiveGpmData.source,
        flowQuality: row.flow_quality || 'calculated',
        flowSource: row.flow_source || 'calculated'
      };
    }));

    res.json({
      events,
      rangeStart: new Date(rangeStart * 1000).toISOString(),
      rangeEnd: new Date(now * 1000).toISOString(),
      count: events.length,
      note: "Gallons are calculated from the zone's effective GPM (override if present, else configured default) × run duration. Real-time flow measurement is not available via the Hydrawise REST API v1 (see docs/hydrawise-api-flow-fields.md)."
    });
  } catch (err) {
    console.error('[API] /api/dashboard/events error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dashboard/tank', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 24));
    const now = Math.floor(Date.now() / 1000);
    const rangeStart = now - (hours * 3600);

    // Query tank_level_log
    const { data: rows, error } = await supabase
      .from('tank_level_log')
      .select('timestamp, level_gallons, source')
      .gte('timestamp', rangeStart)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('[API] Tank query error:', error.message);
      return res.status(500).json({ error: 'Database query failed' });
    }

    const estimates = (rows || []).map(row => ({
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
// Zone GPM management endpoints
// ──────────────────────────────────────────────

app.get('/api/zones/gpm', async (req, res) => {
  try {
    const zones = await getAllZoneGpms();
    res.json({
      zones,
      count: zones.length
    });
  } catch (err) {
    console.error('[API] /api/zones/gpm error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/zones/gpm/:controller/:zoneId', async (req, res) => {
  try {
    const controller = decodeURIComponent(req.params.controller);
    const zoneId = req.params.zoneId;
    const { gpm, reason } = req.body;

    // Validate gpm value
    if (typeof gpm !== 'number') {
      return res.status(400).json({ success: false, error: 'gpm must be a number' });
    }

    if (gpm < 0) {
      return res.status(400).json({ success: false, error: 'gpm must be non-negative' });
    }

    if (gpm >= 100) {
      return res.status(400).json({ success: false, error: 'gpm exceeds maximum of 100 (likely a typo)' });
    }

    // Set the override
    const zone = await setOverride(controller, zoneId, gpm, reason);

    res.json({
      success: true,
      zone
    });
  } catch (err) {
    console.error('[API] PUT /api/zones/gpm/:controller/:zoneId error:', err.message);
    if (err.message.includes('not found')) {
      res.status(400).json({ success: false, error: err.message });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

app.delete('/api/zones/gpm/:controller/:zoneId', async (req, res) => {
  try {
    const controller = decodeURIComponent(req.params.controller);
    const zoneId = req.params.zoneId;
    const { reason } = req.body || {};

    // Reset the override
    const result = await resetOverride(controller, zoneId, reason);

    res.json({
      success: true,
      zone: result.zone
    });
  } catch (err) {
    console.error('[API] DELETE /api/zones/gpm/:controller/:zoneId error:', err.message);
    if (err.message.includes('not found')) {
      res.status(400).json({ success: false, error: err.message });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

app.get('/api/zones/gpm/:controller/:zoneId/history', async (req, res) => {
  try {
    const controller = decodeURIComponent(req.params.controller);
    const zoneId = req.params.zoneId;
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));

    const history = await getChangeHistory(controller, zoneId, limit);

    res.json({
      controller,
      zoneId,
      history,
      count: history.length
    });
  } catch (err) {
    console.error('[API] GET /api/zones/gpm/:controller/:zoneId/history error:', err.message);
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

app.post('/webhook/sensor', async (req, res) => {
  try {
    const { depth_inches, level_gallons } = req.body;

    if (depth_inches == null && level_gallons == null) {
      return res.status(400).json({ error: 'depth_inches or level_gallons required' });
    }

    // Insert into tank_sensor_log
    const { error: sensorError } = await supabase
      .from('tank_sensor_log')
      .insert({
        depth_inches: depth_inches || null,
        level_gallons: level_gallons || null,
        source: 'sensor'
      });

    if (sensorError) {
      console.error('[SENSOR] Error logging to tank_sensor_log:', sensorError.message);
      return res.status(500).json({ error: 'Failed to log sensor data' });
    }

    // Also update tank_level_log with sensor reading
    if (level_gallons != null) {
      const { error: tankError } = await supabase
        .from('tank_level_log')
        .insert({
          level_gallons: level_gallons,
          source: 'sensor'
        });

      if (tankError) {
        console.error('[SENSOR] Error logging to tank_level_log:', tankError.message);
      }
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

app.post('/api/zone/start', async (req, res) => {
  try {
    const { zone_id, controller, duration_seconds } = req.body;
    if (!zone_id || !controller) {
      return res.status(400).json({ error: 'zone_id and controller required' });
    }

    // Phase 4 stub — will call Hydrawise setzone API
    console.log(`[API] Zone start requested: ${controller} ${zone_id} for ${duration_seconds || 'default'}s`);

    const { error } = await supabase
      .from('zone_state_log')
      .insert({
        controller,
        zone_id,
        state: 'on',
        run_seconds: duration_seconds || 0
      });

    if (error) {
      console.error('[API] Error logging zone start:', error.message);
      return res.status(500).json({ error: 'Failed to log zone start' });
    }

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

app.post('/api/zone/stop', async (req, res) => {
  try {
    const { zone_id, controller } = req.body;
    if (!zone_id || !controller) {
      return res.status(400).json({ error: 'zone_id and controller required' });
    }

    console.log(`[API] Zone stop requested: ${controller} ${zone_id}`);

    const { error } = await supabase
      .from('zone_state_log')
      .insert({
        controller,
        zone_id,
        state: 'off'
      });

    if (error) {
      console.error('[API] Error logging zone stop:', error.message);
      return res.status(500).json({ error: 'Failed to log zone stop' });
    }

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

app.post('/api/zone/suspend', async (req, res) => {
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

    const { error } = await supabase
      .from('warnings')
      .insert({
        type: 'zone_suspension',
        message: `Zone ${zone_id} suspended until ${resumeStr}`,
        zone_id,
        controller,
        resolved: 0
      });

    if (error) {
      console.error('[API] Error creating zone suspension warning:', error.message);
      return res.status(500).json({ error: 'Failed to create suspension warning' });
    }

    res.json({
      status: 'ok',
      message: `Zone ${zone_id} on ${controller} suspended until ${resumeStr}`,
    });
  } catch (err) {
    console.error('[API] /api/zone/suspend error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/controller/suspend', async (req, res) => {
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

    const { error } = await supabase
      .from('warnings')
      .insert({
        type: 'controller_suspension',
        message: `Controller ${controller} suspended until ${resumeStr}`,
        controller,
        resolved: 0
      });

    if (error) {
      console.error('[API] Error creating controller suspension warning:', error.message);
      return res.status(500).json({ error: 'Failed to create suspension warning' });
    }

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
  // Supabase schema already exists — no need to ensure tables
  app.listen(PORT, () => {
    console.log(`[SERVER] Irrigation server listening on port ${PORT} (Supabase mode)`);
    console.log(`[SERVER] Health check: http://localhost:${PORT}/api/health`);
  });
}

start();

module.exports = app;
