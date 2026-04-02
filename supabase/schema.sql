-- ============================================================
-- Supabase Schema for Loomis Irrigation Web App
-- Run this in the Supabase SQL editor to create all tables
-- ============================================================

-- ──────────────────────────────────────────────
-- Controllers
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS controllers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  hydrawise_id TEXT,
  has_flow_meter BOOLEAN DEFAULT FALSE,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Zones
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id UUID NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
  relay_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('sod','drip','system')),
  gpm REAL,
  image_path TEXT,
  kz_value REAL DEFAULT 1.0,
  is_active BOOLEAN DEFAULT TRUE,
  recipients JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Check-in Sessions (SMS observation flow)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS checkin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  submitted_by TEXT
);

-- ──────────────────────────────────────────────
-- ET Log (synced from SQLite)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS et_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  et_inches REAL,
  temp_high_f REAL,
  temp_low_f REAL,
  humidity_pct REAL,
  wind_mph REAL,
  solar_rad REAL,
  source TEXT CHECK(source IN ('actual','forecast')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Zone Coefficients
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zone_coefficients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id TEXT NOT NULL,
  controller TEXT NOT NULL,
  kz_value REAL DEFAULT 1.0,
  last_updated TIMESTAMPTZ,
  observation_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(zone_id, controller)
);

-- ──────────────────────────────────────────────
-- Watering Events (synced from SQLite)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watering_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  controller TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  relay_id INTEGER,
  duration_seconds INTEGER,
  gallons REAL,
  flow_gpm REAL,
  source TEXT CHECK(source IN ('scheduled','manual','system')) DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Tank Level Log (synced from SQLite)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tank_level_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  level_gallons REAL,
  source TEXT CHECK(source IN ('calculated','sensor')) DEFAULT 'calculated',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Tank Sensor Log (Phase 7 — ESP32)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tank_sensor_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  depth_inches REAL,
  level_gallons REAL,
  source TEXT CHECK(source IN ('sensor','calculated')) DEFAULT 'calculated',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Observations (synced from SQLite)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS observations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  zone_id TEXT NOT NULL,
  controller TEXT NOT NULL,
  user_name TEXT,
  rating TEXT CHECK(rating IN ('GOOD','LOW','HIGH','SKIP')),
  et_avg_10day REAL,
  gallons_per_day_at_time REAL,
  kz_before REAL,
  kz_after REAL,
  follow_up_date DATE,
  session_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- SMS Log
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sms_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  direction TEXT CHECK(direction IN ('inbound','outbound')),
  from_number TEXT,
  to_number TEXT,
  body TEXT,
  media_url TEXT,
  parsed_command TEXT,
  zone_id TEXT,
  session_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Scheduled Reminders
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id TEXT NOT NULL,
  controller TEXT NOT NULL,
  reminder_date DATE NOT NULL,
  reminder_type TEXT CHECK(reminder_type IN ('checkin','followup','routine')),
  status TEXT CHECK(status IN ('pending','sent','replied','skipped')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Ditch Health Log
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ditch_health_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  zone_id TEXT,
  controller TEXT,
  flow_detected BOOLEAN,
  flow_gpm REAL,
  result TEXT CHECK(result IN ('pass','fail','error')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Warnings
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warnings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT,
  message TEXT,
  zone_id TEXT,
  controller TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Zone State Log
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zone_state_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  controller TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  relay_id INTEGER,
  state TEXT CHECK(state IN ('on','off')),
  run_seconds INTEGER,
  flow_gpm REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- User Preferences
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_preferences (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_name TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  language TEXT DEFAULT 'en',
  role TEXT CHECK(role IN ('owner','spouse','landscaper','other')) DEFAULT 'other',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE controllers ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE et_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_coefficients ENABLE ROW LEVEL SECURITY;
ALTER TABLE watering_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tank_level_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tank_sensor_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ditch_health_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_state_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all tables
CREATE POLICY "Authenticated users can read controllers" ON controllers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read zones" ON zones FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read checkin_sessions" ON checkin_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read et_log" ON et_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read zone_coefficients" ON zone_coefficients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read watering_events" ON watering_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read tank_level_log" ON tank_level_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read tank_sensor_log" ON tank_sensor_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read observations" ON observations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read sms_log" ON sms_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read scheduled_reminders" ON scheduled_reminders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read ditch_health_log" ON ditch_health_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read warnings" ON warnings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read zone_state_log" ON zone_state_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read user_preferences" ON user_preferences FOR SELECT TO authenticated USING (true);

-- Service role can write to all tables (used by sync process)
CREATE POLICY "Service role can insert controllers" ON controllers FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update controllers" ON controllers FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert zones" ON zones FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update zones" ON zones FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert checkin_sessions" ON checkin_sessions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update checkin_sessions" ON checkin_sessions FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert et_log" ON et_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update et_log" ON et_log FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert zone_coefficients" ON zone_coefficients FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update zone_coefficients" ON zone_coefficients FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert watering_events" ON watering_events FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update watering_events" ON watering_events FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert tank_level_log" ON tank_level_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update tank_level_log" ON tank_level_log FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert tank_sensor_log" ON tank_sensor_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update tank_sensor_log" ON tank_sensor_log FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert observations" ON observations FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update observations" ON observations FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert sms_log" ON sms_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update sms_log" ON sms_log FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert scheduled_reminders" ON scheduled_reminders FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update scheduled_reminders" ON scheduled_reminders FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert ditch_health_log" ON ditch_health_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update ditch_health_log" ON ditch_health_log FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert warnings" ON warnings FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update warnings" ON warnings FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert zone_state_log" ON zone_state_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update zone_state_log" ON zone_state_log FOR UPDATE TO service_role USING (true);
CREATE POLICY "Service role can insert user_preferences" ON user_preferences FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can update user_preferences" ON user_preferences FOR UPDATE TO service_role USING (true);


-- ============================================================
-- Indexes for common query patterns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_et_log_date ON et_log(date);
CREATE INDEX IF NOT EXISTS idx_watering_events_timestamp ON watering_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_watering_events_zone ON watering_events(controller, zone_id);
CREATE INDEX IF NOT EXISTS idx_tank_level_log_timestamp ON tank_level_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_tank_sensor_log_timestamp ON tank_sensor_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_observations_zone ON observations(controller, zone_id);
CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_date ON scheduled_reminders(reminder_date, status);
CREATE INDEX IF NOT EXISTS idx_zone_state_log_timestamp ON zone_state_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_zones_controller ON zones(controller_id);
CREATE INDEX IF NOT EXISTS idx_warnings_timestamp ON warnings(timestamp);
CREATE INDEX IF NOT EXISTS idx_ditch_health_log_timestamp ON ditch_health_log(timestamp);
