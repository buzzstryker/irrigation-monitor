-- migration_neighbor_draw_log_v2.sql
-- Add net_gallons_drop column to filter sensor quantization noise
---
--- The net_gallons_drop field captures the net tank level change during a dip
--- event. Real neighbor draws cause meaningful net drops (≥30 gal); 1-cm sensor
--- quantization wobbles (±17-21 gal) are rejected.
---
--- Run: paste into Supabase SQL editor AFTER creating the table with v1 migration.

ALTER TABLE neighbor_draw_log ADD COLUMN IF NOT EXISTS net_gallons_drop REAL;

COMMENT ON COLUMN neighbor_draw_log.net_gallons_drop IS
  'Net tank level drop during dip (level_start - level_end). Real neighbor draws show ≥30 gal drop; 1-cm quantization wobbles are ~17-21 gal and rejected.';
