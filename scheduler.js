/**
 * scheduler.js — Daily cron jobs for the irrigation system
 *
 * All times are Pacific (America/Los_Angeles).
 * Jobs log start/end and any errors.
 */

const cron = require('node-cron');
const { getDb } = require('./db');
const { broadcast } = require('./sms/sender');

const TIMEZONE = 'America/Los_Angeles';

/**
 * 2:00 AM — Trigger ET fetch and log
 */
cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] 2:00 AM — ET fetch started');
  try {
    const { runEtUpdate } = require('./et-logger');
    await runEtUpdate();
    console.log('[CRON] 2:00 AM — ET fetch complete');
  } catch (err) {
    console.error('[CRON] 2:00 AM — ET fetch failed:', err.message);
  }
}, { timezone: TIMEZONE });

/**
 * 2:05 AM — Evaluate skip conditions for today
 */
cron.schedule('5 2 * * *', async () => {
  console.log('[CRON] 2:05 AM — Skip evaluation started');
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    // Check for active suspension
    const suspension = db.prepare(
      `SELECT message FROM warnings WHERE type = 'suspension' AND resolved = 0`
    ).all();
    if (suspension.length > 0) {
      console.log(`[CRON] 2:05 AM — Active suspension found: ${suspension[0].message}`);
      return;
    }

    // Check for skip-today flag
    const skip = db.prepare(
      `SELECT message FROM warnings WHERE type = 'skip' AND resolved = 0
       AND message LIKE ?`
    ).all(`%${today}%`);
    if (skip.length > 0) {
      console.log(`[CRON] 2:05 AM — Skip today flag active`);
      return;
    }

    // Check ET-based skip conditions
    try {
      const { shouldSkipIrrigation, getYesterdayActual } = require('./et-engine');
      const yesterday = await getYesterdayActual();
      const result = shouldSkipIrrigation(yesterday);
      if (result.skip) {
        console.log(`[CRON] 2:05 AM — Skip recommended: ${result.reason}`);
      } else {
        console.log(`[CRON] 2:05 AM — No skip conditions met`);
      }
    } catch (err) {
      console.log('[CRON] 2:05 AM — ET engine not available for skip check');
    }

    console.log('[CRON] 2:05 AM — Skip evaluation complete');
  } catch (err) {
    console.error('[CRON] 2:05 AM — Skip evaluation failed:', err.message);
  }
}, { timezone: TIMEZONE });

/**
 * 2:10 AM — Calculate and queue today's zone run schedule
 */
cron.schedule('10 2 * * *', async () => {
  console.log('[CRON] 2:10 AM — Schedule calculation started');
  try {
    // Phase 4 stub — will calculate zone runtimes from ET × Kz × area
    // and issue setzone commands via Hydrawise API
    console.log('[CRON] 2:10 AM — Schedule calculation is a Phase 4 feature (stub)');
    console.log('[CRON] 2:10 AM — Schedule calculation complete');
  } catch (err) {
    console.error('[CRON] 2:10 AM — Schedule calculation failed:', err.message);
  }
}, { timezone: TIMEZONE });

/**
 * 5:00 AM — Ditch water health check
 */
cron.schedule('0 5 * * *', async () => {
  console.log('[CRON] 5:00 AM — Ditch health check started');
  try {
    // Phase 6 stub — will trigger a 60-second manual run on Pool Equipment zone
    // and read flow meter via statusschedule API
    const db = getDb();
    db.prepare(
      `INSERT INTO ditch_health_log (zone_id, controller, flow_detected, result, notes)
       VALUES ('Z2', 'Pool Equipment', NULL, 'error', 'Automated check — not yet implemented')`
    ).run();
    console.log('[CRON] 5:00 AM — Ditch health check is a Phase 6 feature (stub)');
    console.log('[CRON] 5:00 AM — Ditch health check complete');
  } catch (err) {
    console.error('[CRON] 5:00 AM — Ditch health check failed:', err.message);
  }
}, { timezone: TIMEZONE });

/**
 * 1st of each month at 8:00 AM — Monthly check-in reminder
 */
cron.schedule('0 8 1 * *', async () => {
  console.log('[CRON] Monthly check-in — started');
  try {
    const db = getDb();

    // Get all users with phone numbers
    const users = db.prepare(
      `SELECT phone_number FROM user_preferences WHERE phone_number IS NOT NULL`
    ).all();

    if (users.length === 0) {
      console.log('[CRON] Monthly check-in — no users to notify');
      return;
    }

    const phones = users.map(u => u.phone_number);
    const month = new Date().toLocaleString('en-US', { month: 'long', timeZone: TIMEZONE });

    await broadcast(phones,
      `Loomis Irrigation: ${month} check-in.\n` +
      'Reply STATUS to see current system state, or TANK for tank level.\n' +
      'Zone observation reminders are sent separately.');

    console.log(`[CRON] Monthly check-in — notified ${phones.length} users`);
  } catch (err) {
    console.error('[CRON] Monthly check-in failed:', err.message);
  }
}, { timezone: TIMEZONE });

console.log('[CRON] Scheduler initialized — 5 cron jobs registered');

module.exports = {};
