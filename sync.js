/**
 * sync.js — Push new SQLite rows to Supabase after each poll cycle.
 * Uses better-sqlite3 for local reads and @supabase/supabase-js for remote writes.
 * Errors are caught per-table so one failure never crashes the polling loop.
 */

const { createClient } = require('@supabase/supabase-js');
const { getDb } = require('./db');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your-project-id')) {
    console.warn('[sync] SUPABASE_URL or SUPABASE_ANON_KEY not configured — sync disabled');
    return null;
  }
  supabase = createClient(supabaseUrl, supabaseKey);
  return supabase;
}

// High-water marks — track last synced id per table
const lastSyncedId = {};

function getLastSyncedId(table) {
  if (lastSyncedId[table] !== undefined) return lastSyncedId[table];
  lastSyncedId[table] = 0;
  return 0;
}

/**
 * Sync new rows from a local SQLite table to Supabase.
 * Reads rows with id > lastSyncedId, transforms them, and upserts to Supabase.
 */
async function syncTable(tableName, { transform, upsertKey } = {}) {
  const client = getSupabase();
  if (!client) return;

  const db = getDb();
  const lastId = getLastSyncedId(tableName);

  let rows;
  try {
    rows = db.prepare(`SELECT * FROM ${tableName} WHERE id > ? ORDER BY id ASC LIMIT 500`).all(lastId);
  } catch (err) {
    console.error(`[sync] Failed to read ${tableName} from SQLite:`, err.message);
    return;
  }

  if (rows.length === 0) return;

  // Apply row transforms (e.g. epoch → ISO timestamps)
  const mapped = transform ? rows.map(transform) : rows;

  // Strip SQLite auto-increment id — Supabase generates its own
  const cleaned = mapped.map(({ id, ...rest }) => rest);

  try {
    const { error } = await client.from(tableName).upsert(cleaned, {
      onConflict: upsertKey || undefined,
      ignoreDuplicates: !upsertKey,
    });

    if (error) {
      console.error(`[sync] Supabase upsert error on ${tableName}:`, error.message);
      return;
    }

    const maxId = rows[rows.length - 1].id;
    lastSyncedId[tableName] = maxId;
    console.log(`[sync] ${tableName}: synced ${rows.length} rows (up to id ${maxId})`);
  } catch (err) {
    console.error(`[sync] Network error syncing ${tableName}:`, err.message);
  }
}

// Convert unix epoch seconds to ISO 8601 string
function epochToISO(epoch) {
  if (!epoch) return null;
  return new Date(epoch * 1000).toISOString();
}

/**
 * Run a full sync cycle. Call this after each poll loop.
 */
async function syncAll() {
  const client = getSupabase();
  if (!client) return;

  console.log('[sync] Starting sync cycle...');

  await syncTable('et_log', {
    upsertKey: 'date',
  });

  await syncTable('watering_events', {
    transform: (row) => ({
      ...row,
      timestamp: epochToISO(row.timestamp),
    }),
  });

  await syncTable('tank_level_log', {
    transform: (row) => ({
      ...row,
      timestamp: epochToISO(row.timestamp),
    }),
  });

  await syncTable('observations', {
    transform: (row) => ({
      ...row,
      timestamp: epochToISO(row.timestamp),
    }),
  });

  await syncTable('tank_sensor_log', {
    transform: (row) => ({
      ...row,
      timestamp: epochToISO(row.timestamp),
    }),
  });

  await syncTable('zone_coefficients', {
    upsertKey: 'zone_id,controller',
    transform: (row) => ({
      ...row,
      last_updated: epochToISO(row.last_updated),
    }),
  });

  console.log('[sync] Sync cycle complete.');
}

module.exports = { syncAll, syncTable, getSupabase };
