-- Adds runtime GPM override tables.
-- Date: 2026-05-19
-- Architecture: zones.config.js holds defaults; this table holds operator overrides.
--   Read path uses override-first-fallback-to-config pattern via getEffectiveGpm().

BEGIN TRANSACTION;

-- Current effective override per (controller, zone_id) — at most one row each
CREATE TABLE IF NOT EXISTS zone_gpm_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  controller TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  gpm REAL NOT NULL CHECK (gpm >= 0),
  reason TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(controller, zone_id)
);

-- Audit log of every GPM change, including resets-to-default (new_gpm IS NULL means reset)
CREATE TABLE IF NOT EXISTS zone_gpm_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  controller TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  old_gpm REAL,                          -- NULL if previously using config default
  new_gpm REAL,                          -- NULL if resetting to default
  reason TEXT,
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_gpm_change_log_zone
  ON zone_gpm_change_log (controller, zone_id, changed_at DESC);

COMMIT;
