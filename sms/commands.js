/**
 * sms/commands.js — SMS command handlers
 *
 * Each handler queries the database, composes a response, and sends it back
 * to the user via SMS.
 */

const { getDb } = require('../db');
const { sendSMS } = require('./sender');

/**
 * STATUS — current tank level, today's ET, zones run today
 */
async function handleStatus(userPhone) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const etRow = db.prepare('SELECT et_inches, source FROM et_log WHERE date = ?').get(today);
  const tankRow = db.prepare(
    'SELECT level_gallons, timestamp FROM tank_level_log ORDER BY id DESC LIMIT 1'
  ).get();
  const zonesRun = db.prepare(
    `SELECT zone_id, controller, duration_seconds, gallons
     FROM watering_events
     WHERE date(timestamp, 'unixepoch') = ?
     ORDER BY timestamp ASC`
  ).all(today);

  let msg = 'Loomis Irrigation Status\n';
  msg += '────────────────────\n';

  if (tankRow) {
    msg += `Tank: ${Math.round(tankRow.level_gallons)} gal\n`;
  } else {
    msg += 'Tank: No data\n';
  }

  if (etRow) {
    msg += `ET today: ${etRow.et_inches} in (${etRow.source})\n`;
  } else {
    msg += 'ET today: No data\n';
  }

  if (zonesRun.length > 0) {
    msg += `Zones run: ${zonesRun.length}\n`;
    for (const z of zonesRun) {
      const mins = Math.round((z.duration_seconds || 0) / 60);
      msg += `  ${z.controller} ${z.zone_id}: ${mins}min, ${(z.gallons || 0).toFixed(1)}gal\n`;
    }
  } else {
    msg += 'Zones run today: None\n';
  }

  await sendSMS(userPhone, msg.trim());
}

/**
 * TANK — current level and 7-day trend
 */
async function handleTank(userPhone) {
  const db = getDb();

  const current = db.prepare(
    'SELECT level_gallons, timestamp FROM tank_level_log ORDER BY id DESC LIMIT 1'
  ).get();

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  const trend = db.prepare(
    `SELECT date(timestamp, 'unixepoch') as day,
            MIN(level_gallons) as low,
            MAX(level_gallons) as high,
            AVG(level_gallons) as avg
     FROM tank_level_log
     WHERE timestamp > ?
     GROUP BY day
     ORDER BY day ASC`
  ).all(sevenDaysAgo);

  let msg = 'Tank Level Report\n';
  msg += '────────────────────\n';

  if (current) {
    msg += `Current: ${Math.round(current.level_gallons)} gal\n\n`;
  } else {
    msg += 'Current: No data\n\n';
  }

  if (trend.length > 0) {
    msg += '7-Day Trend:\n';
    for (const t of trend) {
      msg += `  ${t.day}: avg ${Math.round(t.avg)} gal (${Math.round(t.low)}-${Math.round(t.high)})\n`;
    }
  } else {
    msg += '7-Day Trend: No data yet\n';
  }

  await sendSMS(userPhone, msg.trim());
}

/**
 * SUSPEND [n] — suspend all irrigation for N days
 */
async function handleSuspend(userPhone, days) {
  const n = parseInt(days, 10) || 3;
  const db = getDb();
  const resumeDate = new Date();
  resumeDate.setDate(resumeDate.getDate() + n);
  const resumeStr = resumeDate.toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO warnings (type, message, resolved)
     VALUES ('suspension', ?, 0)`
  ).run(`Suspended until ${resumeStr} by SMS command`);

  const msg = `All irrigation suspended for ${n} days.\nWill resume on ${resumeStr}.\nText RESUME to cancel.`;
  await sendSMS(userPhone, msg);
}

/**
 * RESUME — cancel active suspension
 */
async function handleResume(userPhone) {
  const db = getDb();

  db.prepare(
    `UPDATE warnings SET resolved = 1 WHERE type = 'suspension' AND resolved = 0`
  ).run();

  await sendSMS(userPhone, 'Suspension cancelled. Normal irrigation schedule resumed.');
}

/**
 * SKIP TODAY — skip today's irrigation
 */
async function handleSkipToday(userPhone) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO warnings (type, message, resolved)
     VALUES ('skip', ?, 0)`
  ).run(`Skip irrigation for ${today} by SMS command`);

  await sendSMS(userPhone, `Today's irrigation (${today}) has been skipped.`);
}

/**
 * DITCH CHECK — trigger a flow meter diagnostic
 */
async function handleDitchCheck(userPhone) {
  // Phase 6 stub — will integrate with Hydrawise API to trigger a test run
  const db = getDb();

  db.prepare(
    `INSERT INTO ditch_health_log (zone_id, controller, flow_detected, result, notes)
     VALUES ('Z2', 'Pool Equipment', NULL, 'error', 'Manual check requested via SMS — not yet implemented')`
  ).run();

  await sendSMS(userPhone,
    'Ditch check requested. This feature is not yet fully implemented.\n' +
    'When active, it will trigger a 60-second test run on a Pool Equipment zone and report flow status.');
}

module.exports = {
  handleStatus,
  handleTank,
  handleSuspend,
  handleResume,
  handleSkipToday,
  handleDitchCheck,
};
