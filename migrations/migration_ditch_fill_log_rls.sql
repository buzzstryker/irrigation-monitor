-- migration_ditch_fill_log_rls.sql
-- Add the missing RLS policy for ditch_fill_log.
--
-- BUG: ditch_fill_log was created (migration_ditch_fill_log.sql) without any RLS
-- policy. RLS later got enabled (Supabase dashboard nag) but no SELECT policy was
-- ever added, so the table returns ZERO rows to the anon AND authenticated roles
-- while the service_role (poller / ditch-monitor, which bypasses RLS) writes and
-- reads it fine. Result: the dashboard's "Ditch Fill Rate - Last 7 Days" chart
-- showed "No ditch fill events recorded" even though the table held 40+ rows.
--
-- The file-of-record schema.sql compounded this: its RLS block names the WRONG
-- table (ditch_health_log) where it should read ditch_fill_log.
--
-- This mirrors the authenticated-read + service_role-write pattern every other
-- dashboard-visible table already uses (watering_events, tank_sensor_log, zones).
--
-- Run: paste into Supabase SQL editor, execute, verify with the SELECT at the end.

-- Enable RLS (idempotent — safe whether or not it was already on).
ALTER TABLE ditch_fill_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users (the logged-in dashboard) can read.
DROP POLICY IF EXISTS "Authenticated users can read ditch_fill_log" ON ditch_fill_log;
CREATE POLICY "Authenticated users can read ditch_fill_log"
  ON ditch_fill_log FOR SELECT TO authenticated USING (true);

-- Service role can write (bypasses RLS anyway; declared for parity/clarity).
DROP POLICY IF EXISTS "Service role can insert ditch_fill_log" ON ditch_fill_log;
CREATE POLICY "Service role can insert ditch_fill_log"
  ON ditch_fill_log FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update ditch_fill_log" ON ditch_fill_log;
CREATE POLICY "Service role can update ditch_fill_log"
  ON ditch_fill_log FOR UPDATE TO service_role USING (true);

-- Verify: should list the three policies above.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'ditch_fill_log'
ORDER BY policyname;
