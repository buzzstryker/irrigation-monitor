-- migration_tank_sensor_device_update_time.sql
-- Add device_update_time column to tank_sensor_log for diagnostics.
--
-- Why: The Tuya ME201W's update_time field (device's last push timestamp to
-- Tuya cloud) is FROZEN for long periods (~13 hours in production, didn't
-- advance during a 10-min fast drawdown). This column captures it purely for
-- diagnostics — so we can audit the device's actual reporting behavior vs. the
-- liquid_depth change cadence after deployment. NOT used for dedup logic.
--
-- Run: paste into Supabase SQL editor, execute, verify ALTER confirms.

ALTER TABLE tank_sensor_log
  ADD COLUMN device_update_time BIGINT;

COMMENT ON COLUMN tank_sensor_log.device_update_time IS
  'Device last-push timestamp (epoch sec) from Tuya API device.update_time field. Diagnostic only — dedup logic uses liquid_depth value, not this timestamp.';
