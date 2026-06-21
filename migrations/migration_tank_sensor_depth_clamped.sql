-- Migration: add depth_meters + clamped to tank_sensor_log.
-- Date: 2026-06-20
-- Target: Supabase Postgres (NOT the legacy SQLite path — db.js is Supabase-only now).
--
-- Two unrelated changes bundled because they both stem from confronting
-- supabase/schema.sql against the live schema (queried 2026-06-20):
--
--   1. Add `depth_meters` (raw Tuya sensor value, pre-strapping) and `clamped`
--      ('low' | 'high' | NULL — written when the strapping table clamps an
--      out-of-range depth, so we can flag-and-investigate without losing the
--      gallons reading).
--
--   2. The live tank_sensor_log uses BIGINT `timestamp` (epoch seconds) and has
--      no `created_at` column, matching the convention in watering_events,
--      tank_level_log, and warnings. schema.sql was wrong (claimed TIMESTAMPTZ
--      + created_at) — see updated schema.sql in this same commit.
--
-- HOW TO APPLY: paste this file into the Supabase SQL editor and run.
-- (apply-migration.js targets SQLite and won't run Postgres DDL; we don't have
--  a `pg` dep or a direct DATABASE_URL configured.)

BEGIN;

ALTER TABLE tank_sensor_log
  ADD COLUMN IF NOT EXISTS depth_meters REAL;

ALTER TABLE tank_sensor_log
  ADD COLUMN IF NOT EXISTS clamped TEXT
    CHECK (clamped IN ('low', 'high'));

COMMENT ON COLUMN tank_sensor_log.depth_meters IS
  'Raw Tuya ME201W liquid-level-depth reading in meters, pre-strapping. Kept alongside depth_inches/level_gallons so the gallon value can be re-derived if the strapping table is refined later.';

COMMENT ON COLUMN tank_sensor_log.clamped IS
  'Set to ''low'' or ''high'' if the depth fell outside the strapping table''s 0..41 inch domain and the gallons value was clamped to a table edge. NULL on healthy readings. A non-null value triggers a row in warnings (type = ''tank_sensor_clamped'').';

COMMIT;
