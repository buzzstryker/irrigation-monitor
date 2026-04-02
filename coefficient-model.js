/**
 * coefficient-model.js — Zone coefficient model (Phase 2)
 *
 * Calculates daily target water application per zone based on ET × Kz,
 * compares against actual watering_events, and logs the delta.
 * Read-only analysis — does not issue any Hydrawise commands.
 *
 * Baseline: summer schedule gallons per zone from the optimization doc,
 * calibrated to ET_summer_avg = 0.25 in/day. For any given day:
 *   target_gallons = baseline_gallons × (ET_today / ET_summer_avg) × Kz
 */

const { getDb, getEtByDate } = require('./db');
const { controllers } = require('./zones.config');

const ET_SUMMER_AVG = 0.25; // in/day — reference ET for summer baseline

/**
 * Summer baseline gallons per zone per day (from irrigation schedule doc).
 * These are the gallons each zone applies daily on the static summer schedule.
 * Key: "controller:zone_id"
 */
const SUMMER_BASELINE = {
  // Garage
  'Loomis Garage:Z1': { gallons: 39.0, minutes: 5 },
  'Loomis Garage:Z2': { gallons: 72.0, minutes: 5 },
  'Loomis Garage:Z3': { gallons: 54.0, minutes: 5 },
  'Loomis Garage:Z4': { gallons: 38.0, minutes: 5 },
  'Loomis Garage:Z6': { gallons: 312.0, minutes: 30 },
  'Loomis Garage:Z7': { gallons: 33.6, minutes: 12 },
  'Loomis Garage:Z8': { gallons: 12.0, minutes: 4 },
  'Loomis Garage:Z9': { gallons: 60.0, minutes: 15 },

  // Pool Equipment
  'Loomis Pool Equipment:Z1': { gallons: 34.0, minutes: 20 },
  'Loomis Pool Equipment:Z2': { gallons: 46.0, minutes: 5 },
  'Loomis Pool Equipment:Z3': { gallons: 35.0, minutes: 5 },
  'Loomis Pool Equipment:Z4': { gallons: 65.0, minutes: 5 },
  'Loomis Pool Equipment:Z5': { gallons: 47.5, minutes: 5 },
  'Loomis Pool Equipment:Z6': { gallons: 35.0, minutes: 5 },
  'Loomis Pool Equipment:Z7': { gallons: 73.5, minutes: 7 },
  'Loomis Pool Equipment:Z8': { gallons: 112.0, minutes: 7 },
  'Loomis Pool Equipment:Z9': { gallons: 120.0, minutes: 10 },
  'Loomis Pool Equipment:Z10': { gallons: 110.0, minutes: 10 },
  'Loomis Pool Equipment:Z11': { gallons: 100.0, minutes: 10 },

  // Barn (no GPM — use minutes only; gallons estimated later when GPM known)
  'Loomis barn:Z1': { gallons: null, minutes: 20 },
  'Loomis barn:Z2': { gallons: null, minutes: 20 },
};

// ──────────────────────────────────────────────
// Coefficient initialization
// ──────────────────────────────────────────────

/**
 * Seed zone_coefficients table with Kz=1.0 for all active zones
 * if they aren't already seeded.
 */
function initializeCoefficients() {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO zone_coefficients (zone_id, controller, kz_value, last_updated, observation_count)
    VALUES (?, ?, 1.0, unixepoch(), 0)
    ON CONFLICT(zone_id, controller) DO NOTHING
  `);

  const insertMany = db.transaction(() => {
    let count = 0;
    for (const ctrl of controllers) {
      for (const zone of ctrl.zones) {
        const result = upsert.run(zone.zone_id, ctrl.name);
        if (result.changes > 0) count++;
      }
    }
    return count;
  });

  const seeded = insertMany();
  if (seeded > 0) {
    console.log(`[KZ] Seeded ${seeded} zone coefficients with Kz=1.0`);
  }

  return seeded;
}

/**
 * Get the Kz value for a zone. Returns 1.0 if not found.
 */
function getKz(zoneId, controller) {
  const db = getDb();
  const row = db.prepare(
    'SELECT kz_value FROM zone_coefficients WHERE zone_id = ? AND controller = ?'
  ).get(zoneId, controller);
  return row ? row.kz_value : 1.0;
}

// ──────────────────────────────────────────────
// Target calculation
// ──────────────────────────────────────────────

/**
 * Calculate target gallons (or minutes for Barn) for a zone on a given ET day.
 *
 * For zones with GPM:
 *   target_gallons = baseline_gallons × (ET_today / ET_summer_avg) × Kz
 *
 * For Barn zones (no GPM):
 *   target_minutes = baseline_minutes × (ET_today / ET_summer_avg) × Kz
 *
 * @returns {{ target_gallons: number|null, target_minutes: number|null, kz: number, baseline_gallons: number|null }}
 */
function getDailyTarget(zoneId, controller, etInches) {
  const key = `${controller}:${zoneId}`;
  const baseline = SUMMER_BASELINE[key];

  if (!baseline) {
    return { target_gallons: null, target_minutes: null, kz: 1.0, baseline_gallons: null };
  }

  const kz = getKz(zoneId, controller);
  const etRatio = etInches / ET_SUMMER_AVG;

  if (baseline.gallons !== null) {
    const target = baseline.gallons * etRatio * kz;
    return {
      target_gallons: Math.round(target * 10) / 10,
      target_minutes: null,
      kz,
      baseline_gallons: baseline.gallons,
    };
  }

  // Barn zones — minutes-based
  const targetMin = baseline.minutes * etRatio * kz;
  return {
    target_gallons: null,
    target_minutes: Math.round(targetMin * 10) / 10,
    kz,
    baseline_gallons: null,
  };
}

// ──────────────────────────────────────────────
// Actual application lookup
// ──────────────────────────────────────────────

/**
 * Read watering_events for a zone on a specific date.
 * Returns total gallons actually applied.
 */
function getActualApplication(zoneId, controller, date) {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(gallons), 0) as total_gallons,
           COALESCE(SUM(duration_seconds), 0) as total_seconds,
           COUNT(*) as run_count
    FROM watering_events
    WHERE zone_id = ? AND controller = ?
      AND date(timestamp, 'unixepoch') = ?
  `).get(zoneId, controller, date);

  return {
    gallons: row.total_gallons,
    seconds: row.total_seconds,
    minutes: Math.round(row.total_seconds / 60 * 10) / 10,
    runs: row.run_count,
  };
}

// ──────────────────────────────────────────────
// Daily comparison logging
// ──────────────────────────────────────────────

/**
 * Determine the current season based on date.
 */
function getSeason(dateStr) {
  const [, month, day] = dateStr.split('-').map(Number);
  if ((month > 10 || month < 3) || (month === 10 && day > 15) || (month === 3 && day < 15)) {
    return 'off-season';
  }
  if ((month === 3 && day >= 15) || month === 4 || (month === 5 && day <= 15)) {
    return 'spring';
  }
  return 'summer';
}

/**
 * For each active zone, calculate target vs actual, log delta to zone_daily_analysis.
 * @param {string} [date] — defaults to yesterday
 * @returns {Array} analysis rows
 */
function logDailyComparison(date) {
  if (!date) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().slice(0, 10);
  }

  const db = getDb();
  const etRow = getEtByDate(date);
  const etInches = etRow ? etRow.et_inches : 0;
  const season = getSeason(date);

  initializeCoefficients();

  const upsert = db.prepare(`
    INSERT INTO zone_daily_analysis (date, zone_id, controller, et_inches, kz_value,
      target_gallons, actual_gallons, delta_gallons, delta_pct, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, zone_id, controller) DO UPDATE SET
      et_inches = excluded.et_inches,
      kz_value = excluded.kz_value,
      target_gallons = excluded.target_gallons,
      actual_gallons = excluded.actual_gallons,
      delta_gallons = excluded.delta_gallons,
      delta_pct = excluded.delta_pct,
      notes = excluded.notes,
      created_at = unixepoch()
  `);

  const results = [];

  const insertAll = db.transaction(() => {
    for (const ctrl of controllers) {
      for (const zone of ctrl.zones) {
        const target = getDailyTarget(zone.zone_id, ctrl.name, etInches);
        const actual = getActualApplication(zone.zone_id, ctrl.name, date);

        const targetGal = target.target_gallons;
        const actualGal = actual.gallons;

        let deltaGal = null;
        let deltaPct = null;
        let notes = '';

        if (targetGal !== null && targetGal > 0) {
          deltaGal = Math.round((actualGal - targetGal) * 10) / 10;
          deltaPct = Math.round((deltaGal / targetGal) * 1000) / 10;
        } else if (targetGal !== null && targetGal === 0) {
          deltaGal = actualGal;
          deltaPct = actualGal > 0 ? 100 : 0;
          notes = 'ET zero — no irrigation needed';
        } else {
          // Barn zones — no gallons target
          notes = `Minutes-based: target ${target.target_minutes} min, actual ${actual.minutes} min`;
        }

        if (season === 'off-season') {
          notes = 'Off-season — no irrigation expected';
        }

        if (etInches === 0 && !notes) {
          notes = 'No ET data for this date';
        }

        if (actual.runs === 0 && targetGal > 0) {
          notes = notes || 'No watering events recorded';
        }

        const row = {
          date,
          zone_id: zone.zone_id,
          controller: ctrl.name,
          zone_name: zone.name,
          zone_type: zone.type,
          gpm: zone.gpm,
          et_inches: etInches,
          kz_value: target.kz,
          target_gallons: targetGal,
          target_minutes: target.target_minutes,
          actual_gallons: actualGal,
          actual_minutes: actual.minutes,
          actual_runs: actual.runs,
          delta_gallons: deltaGal,
          delta_pct: deltaPct,
          notes,
          season,
        };

        upsert.run(
          date, zone.zone_id, ctrl.name, etInches, target.kz,
          targetGal, actualGal, deltaGal, deltaPct, notes
        );

        results.push(row);
      }
    }
  });

  insertAll();
  return results;
}

module.exports = {
  initializeCoefficients,
  getKz,
  getDailyTarget,
  getActualApplication,
  logDailyComparison,
  getSeason,
  ET_SUMMER_AVG,
  SUMMER_BASELINE,
};
