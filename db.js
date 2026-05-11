/**
 * db.js — SQLite database setup using better-sqlite3 (synchronous API)
 * Persists to irrigation.db in the project root.
 * 
 * Current schema: 18 tables
 * - Phase 0-3, 5-7: 13 tables (defined in initializeDatabase)
 * - Phase 4a: 5 tables (applied via migrations/)
 *   - flow_attribution_warnings: Attribution ambiguity events
 *   - controller_flow_meter_health: Per-controller meter health state
 *   - controller_flow_meter_health_log: Health transition log
 *   - z5_selftest_log: Z5 cap integrity self-tests
 *   - flow_calibration_log: Pool Equipment zone GPM calibration results
 * - Phase 4a: 3 columns added to watering_events (flow_source, flow_source_controller_id, flow_quality)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'irrigation.db');

let _db = null;

/**
 * Get (or create) the database instance. Synchronous.
 */
function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initializeDatabase(_db);
  return _db;
}

function initializeDatabase(db) {
  // ----------------------------------------------
  // Original tables (Phase 0 — polling service)
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS zone_state_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      controller TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      relay_id INTEGER,
      state TEXT CHECK(state IN ('on','off')),
      run_seconds INTEGER,
      flow_gpm REAL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tank_level_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      level_gallons REAL,
      source TEXT CHECK(source IN ('calculated','sensor')) DEFAULT 'calculated'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS watering_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      controller TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      relay_id INTEGER,
      duration_seconds INTEGER,
      gallons REAL,
      flow_gpm REAL,
      source TEXT CHECK(source IN ('scheduled','manual','system')) DEFAULT 'scheduled'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      type TEXT,
      message TEXT,
      zone_id TEXT,
      controller TEXT,
      resolved INTEGER DEFAULT 0
    )
  `);

  // ----------------------------------------------
  // Phase 1 — ET Engine
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS et_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE,
      et_inches REAL,
      temp_high_f REAL,
      temp_low_f REAL,
      humidity_pct REAL,
      wind_mph REAL,
      solar_rad REAL,
      source TEXT CHECK(source IN ('actual','forecast')),
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // ----------------------------------------------
  // Phase 2 — Zone Coefficient Model
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS zone_coefficients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id TEXT NOT NULL,
      controller TEXT NOT NULL,
      kz_value REAL DEFAULT 1.0,
      last_updated INTEGER,
      observation_count INTEGER DEFAULT 0,
      UNIQUE(zone_id, controller)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS zone_daily_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      controller TEXT NOT NULL,
      et_inches REAL,
      kz_value REAL,
      target_gallons REAL,
      actual_gallons REAL,
      delta_gallons REAL,
      delta_pct REAL,
      notes TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(date, zone_id, controller)
    )
  `);

  // ----------------------------------------------
  // Phase 3 — Twilio SMS Integration
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS sms_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      direction TEXT CHECK(direction IN ('inbound','outbound')),
      from_number TEXT,
      to_number TEXT,
      body TEXT,
      media_url TEXT,
      parsed_command TEXT,
      zone_id TEXT,
      session_token TEXT
    )
  `);

  // ----------------------------------------------
  // Phase 5 — Observation Loop + Learning
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      zone_id TEXT NOT NULL,
      controller TEXT NOT NULL,
      user_name TEXT,
      rating TEXT CHECK(rating IN ('GOOD','LOW','HIGH','SKIP')),
      et_avg_10day REAL,
      gallons_per_day_at_time REAL,
      kz_before REAL,
      kz_after REAL,
      follow_up_date TEXT,
      session_token TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id TEXT NOT NULL,
      controller TEXT NOT NULL,
      reminder_date TEXT NOT NULL,
      reminder_type TEXT CHECK(reminder_type IN ('checkin','followup','routine')),
      status TEXT CHECK(status IN ('pending','sent','replied','skipped')) DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // ----------------------------------------------
  // Phase 6 — Ditch Health Check
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS ditch_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      zone_id TEXT,
      controller TEXT,
      flow_detected INTEGER CHECK(flow_detected IN (0,1)),
      flow_gpm REAL,
      result TEXT CHECK(result IN ('pass','fail','error')),
      notes TEXT
    )
  `);

  // ----------------------------------------------
  // Phase 7 — Tank Sensor (ESP32)
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS tank_sensor_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER DEFAULT (unixepoch()),
      depth_inches REAL,
      level_gallons REAL,
      source TEXT CHECK(source IN ('sensor','calculated')) DEFAULT 'calculated'
    )
  `);

  // ----------------------------------------------
  // User Preferences
  // ----------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT UNIQUE NOT NULL,
      phone_number TEXT,
      language TEXT DEFAULT 'en',
      role TEXT CHECK(role IN ('owner','spouse','landscaper','other')) DEFAULT 'other',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);
}

/** Upsert a row into et_log */
function upsertEtLog(row) {
  const db = getDb();
  db.prepare(`
    INSERT INTO et_log (date, et_inches, temp_high_f, temp_low_f, humidity_pct, wind_mph, solar_rad, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(date) DO UPDATE SET
      et_inches = excluded.et_inches,
      temp_high_f = excluded.temp_high_f,
      temp_low_f = excluded.temp_low_f,
      humidity_pct = excluded.humidity_pct,
      wind_mph = excluded.wind_mph,
      solar_rad = excluded.solar_rad,
      source = excluded.source,
      created_at = unixepoch()
  `).run(
    row.date,
    row.et_inches,
    row.temp_high_f,
    row.temp_low_f,
    row.humidity_pct,
    row.wind_mph,
    row.solar_rad,
    row.source
  );
}

/** Get ET log entry by date */
function getEtByDate(date) {
  const db = getDb();
  return db.prepare('SELECT * FROM et_log WHERE date = ?').get(date) || null;
}

module.exports = { getDb, upsertEtLog, getEtByDate, DB_PATH };