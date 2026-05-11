-- Migration: Z5 Self-Test Log
-- Phase: 4a
-- Created: 2026-05-11
-- Purpose: Track Z5 cap integrity self-tests on service startup

CREATE TABLE IF NOT EXISTS z5_selftest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    passed INTEGER NOT NULL,  -- 0 or 1 (simpler design matches z5-startup-selftest.js)
    max_gpm REAL,
    sample_count INTEGER,
    reason TEXT
);

-- skipIfRecent guard queries: passed=1 AND timestamp >= datetime('now', '-24 hours')