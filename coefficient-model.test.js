/**
 * coefficient-model.test.js — Tests for the zone coefficient model
 *
 * Verifies coefficient seeding, target calculations, daily comparison,
 * and the full daily report output.
 *
 * Run: node coefficient-model.test.js
 */

require('dotenv').config();

const {
  initializeCoefficients,
  getKz,
  getDailyTarget,
  getActualApplication,
  logDailyComparison,
  getSeason,
  ET_SUMMER_AVG,
  SUMMER_BASELINE,
} = require('./coefficient-model');
const { getDb, upsertEtLog } = require('./db');
const { generateReport } = require('./reports/daily-report');
const { controllers } = require('./zones.config');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  Zone Coefficient Model Test Suite');
  console.log('═══════════════════════════════════════════\n');

  const db = getDb();

  // ── Test 1: Initialize coefficients ──
  console.log('Test 1: Initialize zone coefficients');
  {
    const seeded = initializeCoefficients();
    const totalZones = controllers.reduce((sum, c) => sum + c.zones.length, 0);
    const dbCount = db.prepare('SELECT COUNT(*) as cnt FROM zone_coefficients').get().cnt;

    console.log(`  Total zones in config: ${totalZones}`);
    console.log(`  Rows in zone_coefficients: ${dbCount}`);
    assert(dbCount === totalZones, `zone_coefficients has ${totalZones} rows (got ${dbCount})`);

    // Verify all start at Kz=1.0
    const nonDefault = db.prepare('SELECT COUNT(*) as cnt FROM zone_coefficients WHERE kz_value != 1.0').get().cnt;
    assert(nonDefault === 0, `All coefficients initialized to Kz=1.0 (${nonDefault} non-default)`);
  }

  // ── Test 2: getKz ──
  console.log('\nTest 2: getKz lookup');
  {
    const kz = getKz('Z1', 'Loomis Garage');
    assert(kz === 1.0, `Garage Z1 Kz = ${kz} (expected 1.0)`);

    const kzMissing = getKz('Z99', 'Nonexistent');
    assert(kzMissing === 1.0, `Missing zone returns default Kz=1.0 (got ${kzMissing})`);
  }

  // ── Test 3: getDailyTarget — summer ET day ──
  console.log('\nTest 3: getDailyTarget for summer ET day (0.28 in)');
  {
    const etSummer = 0.28;
    const ratio = etSummer / ET_SUMMER_AVG;

    // Garage Z1: baseline 39 gal at 0.25 ET → at 0.28: 39 × 1.12 = 43.7
    const z1 = getDailyTarget('Z1', 'Loomis Garage', etSummer);
    console.log(`  Garage Z1: target=${z1.target_gallons} gal (baseline=${z1.baseline_gallons}, ratio=${ratio.toFixed(2)}, Kz=${z1.kz})`);
    assert(z1.target_gallons > 40 && z1.target_gallons < 50, `Garage Z1 target ${z1.target_gallons} gal in range 40-50`);

    // Pool Equipment Z4: baseline 65 gal → at 0.28: 65 × 1.12 = 72.8
    const pe4 = getDailyTarget('Z4', 'Loomis Pool Equipment', etSummer);
    console.log(`  Pool Z4: target=${pe4.target_gallons} gal (baseline=${pe4.baseline_gallons})`);
    assert(pe4.target_gallons > 68 && pe4.target_gallons < 78, `Pool Z4 target ${pe4.target_gallons} gal in range 68-78`);

    // Pool Equipment Z8: baseline 112 gal → at 0.28: 112 × 1.12 = 125.4
    const pe8 = getDailyTarget('Z8', 'Loomis Pool Equipment', etSummer);
    console.log(`  Pool Z8: target=${pe8.target_gallons} gal (baseline=${pe8.baseline_gallons})`);
    assert(pe8.target_gallons > 120 && pe8.target_gallons < 135, `Pool Z8 target ${pe8.target_gallons} gal in range 120-135`);
  }

  // ── Test 4: getDailyTarget — spring ET day ──
  console.log('\nTest 4: getDailyTarget for spring ET day (0.15 in)');
  {
    const etSpring = 0.15;
    const ratio = etSpring / ET_SUMMER_AVG; // 0.6

    // Garage Z1: 39 × 0.6 = 23.4
    const z1 = getDailyTarget('Z1', 'Loomis Garage', etSpring);
    console.log(`  Garage Z1: target=${z1.target_gallons} gal (ratio=${ratio.toFixed(2)})`);
    assert(z1.target_gallons > 20 && z1.target_gallons < 28, `Spring target ${z1.target_gallons} gal is ~60% of summer`);

    // Compare to summer: should be roughly 60%
    const z1Summer = getDailyTarget('Z1', 'Loomis Garage', 0.25);
    const pctOfSummer = (z1.target_gallons / z1Summer.target_gallons * 100).toFixed(0);
    console.log(`  Spring/Summer ratio: ${pctOfSummer}% (expected ~60%)`);
    assert(Math.abs(pctOfSummer - 60) < 2, `Spring is ${pctOfSummer}% of summer (expected ~60%)`);
  }

  // ── Test 5: getDailyTarget — Barn zone (minutes-based) ──
  console.log('\nTest 5: getDailyTarget for Barn zone (no GPM)');
  {
    const barn = getDailyTarget('Z1', 'Loomis barn', 0.25);
    console.log(`  Barn Z1: target_minutes=${barn.target_minutes}, target_gallons=${barn.target_gallons}`);
    assert(barn.target_gallons === null, 'Barn zone returns null gallons');
    assert(barn.target_minutes === 20, `Barn Z1 target ${barn.target_minutes} min at baseline ET (expected 20)`);

    const barnHot = getDailyTarget('Z1', 'Loomis barn', 0.35);
    console.log(`  Barn Z1 at 0.35 ET: target_minutes=${barnHot.target_minutes}`);
    assert(barnHot.target_minutes > 25 && barnHot.target_minutes < 30, `Hot day target ${barnHot.target_minutes} min (expected ~28)`);
  }

  // ── Test 6: getActualApplication (empty — no events yet) ──
  console.log('\nTest 6: getActualApplication (no events recorded)');
  {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const actual = getActualApplication('Z1', 'Loomis Garage', dateStr);
    console.log(`  Garage Z1 on ${dateStr}: ${actual.gallons} gal, ${actual.runs} runs`);
    assert(actual.gallons === 0, `No events → 0 gallons (got ${actual.gallons})`);
    assert(actual.runs === 0, `No events → 0 runs (got ${actual.runs})`);
  }

  // ── Test 7: getSeason ──
  console.log('\nTest 7: getSeason logic');
  {
    assert(getSeason('2026-01-15') === 'off-season', 'January = off-season');
    assert(getSeason('2026-03-20') === 'spring', 'March 20 = spring');
    assert(getSeason('2026-04-01') === 'spring', 'April 1 = spring');
    assert(getSeason('2026-05-10') === 'spring', 'May 10 = spring');
    assert(getSeason('2026-06-15') === 'summer', 'June 15 = summer');
    assert(getSeason('2026-08-01') === 'summer', 'August 1 = summer');
    assert(getSeason('2026-10-10') === 'summer', 'October 10 = summer');
    assert(getSeason('2026-11-01') === 'off-season', 'November 1 = off-season');
  }

  // ── Test 8: Ensure ET data exists for yesterday, then run logDailyComparison ──
  console.log('\nTest 8: logDailyComparison for yesterday');
  {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    // Make sure we have ET data (insert if missing)
    const existing = db.prepare('SELECT * FROM et_log WHERE date = ?').get(dateStr);
    if (!existing) {
      console.log(`  Inserting placeholder ET data for ${dateStr}`);
      upsertEtLog({
        date: dateStr,
        et_inches: 0.022,
        temp_high_f: 58.3,
        temp_low_f: 53.4,
        humidity_pct: 95,
        wind_mph: 10.9,
        solar_rad: 4.03,
        source: 'actual',
      });
    }

    const rows = logDailyComparison(dateStr);
    const totalZones = controllers.reduce((sum, c) => sum + c.zones.length, 0);
    console.log(`  Analyzed ${rows.length} zones for ${dateStr}`);
    assert(rows.length === totalZones, `All ${totalZones} zones analyzed (got ${rows.length})`);

    // Verify DB rows were written
    const dbRows = db.prepare('SELECT COUNT(*) as cnt FROM zone_daily_analysis WHERE date = ?').get(dateStr).cnt;
    assert(dbRows === totalZones, `${totalZones} rows in zone_daily_analysis (got ${dbRows})`);

    // Show a few sample rows
    for (const r of rows.slice(0, 3)) {
      console.log(`  ${r.controller} ${r.zone_id}: target=${r.target_gallons} gal, actual=${r.actual_gallons} gal, delta=${r.delta_pct}%`);
    }
  }

  // ── Test 9: Full daily report ──
  console.log('\nTest 9: Full daily report output');
  {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const report = generateReport(dateStr);
    console.log(report);
    assert(report.includes('LOOMIS IRRIGATION DAILY ANALYSIS'), 'Report contains header');
    assert(report.includes('GARAGE'), 'Report contains Garage section');
    assert(report.includes('POOL EQUIPMENT'), 'Report contains Pool Equipment section');
    assert(report.includes('SYSTEM TOTAL'), 'Report contains system total');
  }

  // ── Summary ──
  console.log('═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
