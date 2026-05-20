/**
 * db.js — Supabase database client (Phase 4 migration)
 *
 * Replaces better-sqlite3 with @supabase/supabase-js for cloud Postgres.
 * All reads/writes now go to Supabase. Local irrigation.db is preserved on disk
 * as a rollback safety net but is no longer accessed by this module.
 *
 * Uses SUPABASE_SERVICE_KEY for server-side operations (bypasses RLS).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

// Create Supabase client with service key (full access, bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Get the Supabase client (for backward compat with existing getDb() calls)
 */
function getDb() {
  return supabase;
}

/**
 * Upsert a row into et_log (async version)
 */
async function upsertEtLog(row) {
  const { data, error } = await supabase
    .from('et_log')
    .upsert({
      date: row.date,
      et_inches: row.et_inches,
      temp_high_f: row.temp_high_f,
      temp_low_f: row.temp_low_f,
      humidity_pct: row.humidity_pct,
      wind_mph: row.wind_mph,
      solar_rad: row.solar_rad,
      source: row.source,
      created_at: Math.floor(Date.now() / 1000)
    }, {
      onConflict: 'date'
    });

  if (error) {
    throw new Error(`Failed to upsert et_log: ${error.message}`);
  }

  return data;
}

/**
 * Get ET log entry by date (async version)
 */
async function getEtByDate(date) {
  const { data, error } = await supabase
    .from('et_log')
    .select('*')
    .eq('date', date)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - this is not an error, return null
      return null;
    }
    throw new Error(`Failed to get et_log by date: ${error.message}`);
  }

  return data;
}

module.exports = { getDb, upsertEtLog, getEtByDate, supabase };
