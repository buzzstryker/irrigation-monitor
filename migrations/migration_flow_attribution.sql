-- Migration: Flow Attribution Infrastructure
-- Phase: 4a
-- Created: 2026-05-11
-- Purpose: Add tables and columns to support flow meter attribution for Pool Equipment zones

-- Flow attribution warnings table
-- Records ATTRIBUTION AMBIGUITY events (when poll.js can't confidently attribute a flow reading)
-- NOT zone-level water-volume anomalies (those go in existing warnings table)
CREATE TABLE IF NOT EXISTS flow_attribution_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    source_controller_id INTEGER NOT NULL,
    flow_gpm REAL,
    active_zones_json TEXT NOT NULL,
    reason TEXT NOT NULL,  -- 'multiple_attributed' | 'gate_not_open' | 'concurrent_local_zone' | 'unattributed_flow' | 'gate_open_no_consumer'
    notes TEXT
);

-- Controller flow meter health state table (one row per controller)
CREATE TABLE IF NOT EXISTS controller_flow_meter_health (
    controller_id INTEGER PRIMARY KEY,
    is_healthy INTEGER NOT NULL DEFAULT 1,  -- 0 = unhealthy, 1 = healthy (INTEGER not BOOLEAN)
    last_assessed DATETIME NOT NULL,
    valid_fraction REAL,
    sample_count INTEGER,
    reason TEXT
);

-- Controller flow meter health transition log
-- Logs healthy?unhealthy transitions only (not every health check — only state changes)
CREATE TABLE IF NOT EXISTS controller_flow_meter_health_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    controller_id INTEGER NOT NULL,
    timestamp DATETIME NOT NULL,
    transitioned_to TEXT NOT NULL,  -- 'healthy' | 'unhealthy'
    valid_fraction REAL,
    sample_count INTEGER,
    reason TEXT
);

-- Add flow attribution columns to watering_events
ALTER TABLE watering_events ADD COLUMN flow_source TEXT NOT NULL DEFAULT 'direct';  -- 'direct' | 'attributed' | 'estimated' | 'ambiguous'
ALTER TABLE watering_events ADD COLUMN flow_source_controller_id INTEGER;
ALTER TABLE watering_events ADD COLUMN flow_quality TEXT NOT NULL DEFAULT 'good';  -- 'good' | 'degraded' | 'estimated' (Phase 5 Kz learning: 'good'=1.0, 'degraded'=0.5, 'estimated'=ignore)

-- Seed controller_flow_meter_health with initial state
-- Garage: meter healthy (recently restored)
INSERT OR REPLACE INTO controller_flow_meter_health (controller_id, is_healthy, last_assessed, valid_fraction, sample_count, reason)
VALUES (1659477, 1, datetime('now'), NULL, NULL, 'Initial state - meter will be verified by next health assessment');

-- Pool Equipment: meter permanently broken (physical hardware issue)
INSERT OR REPLACE INTO controller_flow_meter_health (controller_id, is_healthy, last_assessed, valid_fraction, sample_count, reason)
VALUES (1977673, 0, datetime('now'), 0.0, 0, 'Physical flow meter broken - using Garage meter attribution via Z5 gating');