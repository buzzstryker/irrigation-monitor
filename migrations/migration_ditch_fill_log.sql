-- migration_ditch_fill_log.sql
-- Create ditch_fill_log table for passive ditch-fill monitoring (Phase 6 precursor)
--
-- Stores qualifying windows where the tank was filling with no valve activity,
-- allowing us to detect ditch slowdowns/clogs by comparing measured fill rates
-- against a rolling baseline.
--
-- Run: paste into Supabase SQL editor, execute, verify CREATE confirms.

CREATE TABLE IF NOT EXISTS ditch_fill_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  window_start BIGINT NOT NULL,       -- Epoch seconds
  window_end BIGINT NOT NULL,         -- Epoch seconds
  window_minutes REAL NOT NULL,       -- Duration in minutes
  fill_gpm REAL NOT NULL,             -- Measured fill rate (gallons per minute)
  fit_r2 REAL NOT NULL,               -- Linear regression R² (fit quality, 0-1)
  sample_count INTEGER NOT NULL,      -- Number of tank_sensor_log readings in window
  gal_start REAL NOT NULL,            -- Tank level at window start
  gal_end REAL NOT NULL,              -- Tank level at window end
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ditch_fill_log_window_start ON ditch_fill_log(window_start DESC);

COMMENT ON TABLE ditch_fill_log IS
  'Passive ditch-fill monitoring: stores qualifying fill-rate measurements from quiet windows (no valve activity, tank not full). Used to detect ditch slowdowns/clogs by comparing against rolling baseline.';

COMMENT ON COLUMN ditch_fill_log.fit_r2 IS
  'R² from linear regression of level_gallons ~ timestamp. Values >= 0.9 indicate clean fill windows; lower values suggest contamination (brief draws, sensor noise, strapping table errors).';
