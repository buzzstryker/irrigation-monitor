-- Wave 1 of Phase 4a deprecation refactor.
-- Date: 2026-05-12
-- See docs/phase-4a-audit.md for context.

BEGIN TRANSACTION;

-- Drop tables that never functioned (REST API v1 doesn't expose real-time flow)
DROP TABLE IF EXISTS flow_attribution_warnings;
DROP TABLE IF EXISTS controller_flow_meter_health;
DROP TABLE IF EXISTS controller_flow_meter_health_log;
DROP TABLE IF EXISTS z5_selftest_log;

-- Drop the unused attribution column from watering_events.
-- Requires SQLite 3.35+ (March 2021). better-sqlite3's bundled SQLite is current.
ALTER TABLE watering_events DROP COLUMN flow_source_controller_id;

-- Update column defaults for flow_source and flow_quality.
-- SQLite doesn't support ALTER COLUMN SET DEFAULT directly, so we use the
-- table-rebuild pattern: create new table with correct shape, copy data,
-- swap names. This is a documented pattern, see SQLite docs section
-- "Making Other Kinds Of Table Schema Changes".

-- (Build a new watering_events table with the desired schema)
CREATE TABLE watering_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  controller TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  relay_id INTEGER,
  duration_seconds INTEGER,
  gallons REAL,
  flow_gpm REAL,
  source TEXT,
  flow_source TEXT NOT NULL DEFAULT 'calculated',
  flow_quality TEXT NOT NULL DEFAULT 'calculated'
);

-- Copy data, backfilling flow_source and flow_quality to 'calculated'
-- (replaces whatever stale values were there — they were never measured).
INSERT INTO watering_events_new (id, timestamp, controller, zone_id, relay_id, duration_seconds, gallons, flow_gpm, source, flow_source, flow_quality)
SELECT id, timestamp, controller, zone_id, relay_id, duration_seconds, gallons, flow_gpm, source,
       'calculated', 'calculated'
FROM watering_events;

-- Atomic swap.
DROP TABLE watering_events;
ALTER TABLE watering_events_new RENAME TO watering_events;

-- Repurpose flow_calibration_log: drop meter-related and cross-check columns.
-- Use the same table-rebuild pattern.
CREATE TABLE flow_calibration_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME NOT NULL,
  controller_id INTEGER NOT NULL,
  zone_relay INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  tank_gpm REAL,
  tank_drawdown_gal REAL,
  ditch_fill_gal REAL,
  notes TEXT
);

INSERT INTO flow_calibration_log_new (id, timestamp, controller_id, zone_relay, duration_sec, tank_gpm, tank_drawdown_gal, ditch_fill_gal, notes)
SELECT id, timestamp, controller_id, zone_relay, duration_sec, tank_gpm, tank_drawdown_gal, ditch_fill_gal, notes
FROM flow_calibration_log;

DROP TABLE flow_calibration_log;
ALTER TABLE flow_calibration_log_new RENAME TO flow_calibration_log;

CREATE INDEX IF NOT EXISTS idx_flow_cal_zone
  ON flow_calibration_log (controller_id, zone_relay, timestamp DESC);

COMMIT;
