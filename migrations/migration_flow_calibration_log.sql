-- Migration: Flow Calibration Log
-- Phase: 4a
-- Created: 2026-05-11
-- Purpose: Track Pool Equipment zone GPM measurements from calibration runs

CREATE TABLE IF NOT EXISTS flow_calibration_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    controller_id INTEGER NOT NULL,
    zone_relay INTEGER NOT NULL,
    duration_sec INTEGER NOT NULL,
    meter_gpm REAL,
    meter_stddev REAL,
    sample_count INTEGER,
    tank_gpm REAL,
    tank_drawdown_gal REAL,
    ditch_fill_gal REAL,
    agreement_pct REAL,
    confidence TEXT,  -- 'high' | 'medium' | 'low'
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_flow_cal_zone ON flow_calibration_log (controller_id, zone_relay, timestamp DESC);