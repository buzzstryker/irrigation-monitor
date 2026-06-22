-- migration_neighbor_draw_log.sql
-- Neighbor-draw detection: passive logging of fill-rate dips (Stage 1)
---
--- Logs transient fill-rate dips that recover (likely neighbor draws on the
--- party-line pressurized pipe) vs sustained declines (likely clogs). Used for
--- schedule inference and neighbor-aware clog monitoring.
---
--- Run: paste into Supabase SQL editor, execute, verify CREATE confirms.

CREATE TABLE IF NOT EXISTS neighbor_draw_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_start BIGINT NOT NULL,        -- Epoch seconds when dip began
  event_end BIGINT NOT NULL,          -- Epoch seconds when dip ended
  duration_minutes REAL NOT NULL,     -- Duration of the dip event
  baseline_gpm REAL NOT NULL,         -- Clean fill rate before/after dip
  dip_gpm REAL NOT NULL,              -- Reduced fill rate during dip
  estimated_neighbor_draw_gpm REAL NOT NULL, -- baseline_gpm - dip_gpm
  recovered BOOLEAN NOT NULL,         -- TRUE = neighbor (recovered), FALSE = possible clog
  fit_quality REAL,                   -- R² of dip-window regression (0-1)
  sample_count INTEGER,               -- Number of tank readings in dip window
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_neighbor_draw_log_event_start ON neighbor_draw_log(event_start DESC);
CREATE INDEX IF NOT EXISTS idx_neighbor_draw_log_recovered ON neighbor_draw_log(recovered);

COMMENT ON TABLE neighbor_draw_log IS
  'Passive logging of fill-rate dips during qualifying ditch-fill windows. Transient dips that recover = likely neighbor draws on party-line pipe. Sustained declines = possible clogs (feeds existing clog monitor).';

COMMENT ON COLUMN neighbor_draw_log.recovered IS
  'TRUE if fill rate returned to baseline after dip (neighbor draw). FALSE if rate stayed low or declined further (possible clog).';

COMMENT ON COLUMN neighbor_draw_log.estimated_neighbor_draw_gpm IS
  'Estimated concurrent neighbor water usage = baseline_gpm - dip_gpm. Positive values indicate neighbor drawing water from shared supply.';
