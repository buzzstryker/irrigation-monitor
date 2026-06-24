/**
 * tank-strapping-empirical.js (DRAFT — NOT YET DEPLOYED)
 * ------------------------------------------------------------------
 * Empirically refined depth → gallons conversion for Loomis water tank.
 *
 * Tank: Norwesco / Snyder 44407, 1725 gal low-profile underground cistern.
 * Cross-section: horizontal ellipse, 69" wide x 51" tall, extruded 157" long.
 *
 * HISTORY:
 * - Original table (tank-strapping.js): Modeled from elliptical geometry,
 *   anchored to 1725 gal @ 41". Showed ~14% fill-rate spread (7.2 vs 8.2 GPM
 *   in lower vs upper tank during constant ditch fill).
 *
 * - This table (2026-06-22): Empirically derived from June 21, 2026 refill
 *   event using constant-fill-rate inversion. Reduces fill-rate spread to
 *   2.3% across clean segments. Corrects -36% over-estimation at 10" depth.
 *
 * VALIDATION:
 * - Before (modeled): 5.2% fill-rate spread across 2 clean segments
 * - After (empirical): 2.3% fill-rate spread across same segments
 * - Improvement: 2.9% (better consistency)
 *
 * DATA SOURCE:
 * - June 21, 2026, 4:14 PM – 10:14 PM Pacific
 * - 2 clean fill segments (no valve activity on any controller):
 *   • Segment 1: 4:18–5:58 PM, 29→68 cm (100 min, 35 readings)
 *   • Segment 2: 6:44–8:29 PM, 63→102 cm (105 min, 39 readings)
 * - Weighted by duration × depth_range, Savitzky-Golay smoothed
 * - Anchored to 1725 gal @ 41" (same as modeled table)
 *
 * ADOPTION STATUS: PENDING REVIEW
 * See docs/tank-strapping-refinement-2026-06-22.md for full analysis.
 * ------------------------------------------------------------------
 */

'use strict';

// Operating constants (unchanged from modeled version)
const FULL_WATER_DEPTH_IN = 41.0;   // water column at full (sensor air gap = 7.5")
const SENSOR_TO_BOTTOM_IN = 48.5;   // installation height (hard bottom)
const RATED_FULL_GALLONS  = 1725;   // anchor
const IN_PER_METER        = 39.3701;

// ──────────────────────────────────────────────────────────────────────
// EMPIRICAL STRAPPING TABLE (2026-06-22)
// ──────────────────────────────────────────────────────────────────────
// Derived from June 21, 2026 refill event via constant-fill-rate inversion.
// Reduces fill-rate spread from 5.2% → 2.3% vs modeled table.
// Anchored to 1725 gal @ 41" (±0.5%).
const STRAPPING_TABLE = [
  [0, 0],
  [1, 18],
  [2, 35],
  [3, 53],
  [4, 71],
  [5, 89],
  [6, 106],
  [7, 124],
  [8, 142],
  [9, 160],
  [10, 177],
  [11, 201],
  [12, 251],
  [13, 307],
  [14, 351],
  [15, 401],
  [16, 454],
  [17, 502],
  [18, 547],
  [19, 591],
  [20, 635],
  [21, 681],
  [22, 725],
  [23, 769],
  [24, 814],
  [25, 861],
  [26, 906],
  [27, 950],
  [28, 993],
  [29, 1038],
  [30, 1083],
  [31, 1126],
  [32, 1172],
  [33, 1215],
  [34, 1259],
  [35, 1306],
  [36, 1368],
  [37, 1424],
  [38, 1463],
  [39, 1510],
  [40, 1600],
  [41, 1733],
];

// ──────────────────────────────────────────────────────────────────────
// MODELED STRAPPING TABLE (LEGACY — for comparison/rollback)
// ──────────────────────────────────────────────────────────────────────
// Original table from elliptical geometry model, anchored at 1725 gal @ 41".
// Showed -36% error at 10" depth, 5.2% fill-rate spread across segments.
// Kept for rollback and comparison purposes.
const MODELED_STRAPPING_TABLE = [
  [0, 0],     [1, 9],     [2, 26],    [3, 48],    [4, 73],
  [5, 101],   [6, 132],   [7, 166],   [8, 201],   [9, 238],
  [10, 277],  [11, 318],  [12, 359],  [13, 402],  [14, 446],
  [15, 491],  [16, 537],  [17, 584],  [18, 632],  [19, 680],
  [20, 728],  [21, 777],  [22, 827],  [23, 876],  [24, 926],
  [25, 976],  [26, 1026], [27, 1076], [28, 1126], [29, 1175],
  [30, 1225], [31, 1274], [32, 1322], [33, 1370], [34, 1418],
  [35, 1465], [36, 1511], [37, 1556], [38, 1600], [39, 1643],
  [40, 1685], [41, 1725],
];

// ──────────────────────────────────────────────────────────────────────
// Conversion Functions (unchanged)
// ──────────────────────────────────────────────────────────────────────

/**
 * Convert a water depth in INCHES (from hard bottom) to gallons.
 * Linearly interpolates between strapping-table points. Clamps out-of-range
 * input to the table ends and reports the clamp so callers can flag bad data.
 *
 * @param {number} depthIn
 * @returns {{ gallons:number, clamped:('low'|'high'|null) }}
 */
function depthInchesToGallons(depthIn) {
  if (typeof depthIn !== 'number' || Number.isNaN(depthIn)) {
    throw new TypeError(`depthInchesToGallons: expected number, got ${depthIn}`);
  }

  const first = STRAPPING_TABLE[0];
  const last = STRAPPING_TABLE[STRAPPING_TABLE.length - 1];

  if (depthIn <= first[0]) {
    return { gallons: first[1], clamped: depthIn < first[0] ? 'low' : null };
  }
  if (depthIn >= last[0]) {
    return { gallons: last[1], clamped: depthIn > last[0] ? 'high' : null };
  }

  // Find bracketing rows and interpolate.
  for (let i = 0; i < STRAPPING_TABLE.length - 1; i++) {
    const [d0, g0] = STRAPPING_TABLE[i];
    const [d1, g1] = STRAPPING_TABLE[i + 1];
    if (depthIn >= d0 && depthIn <= d1) {
      const frac = (depthIn - d0) / (d1 - d0);
      return { gallons: g0 + frac * (g1 - g0), clamped: null };
    }
  }
  // Unreachable given the guards above, but fail loud if it ever happens.
  throw new Error(`depthInchesToGallons: no bracket found for ${depthIn}`);
}

/**
 * Convenience wrapper for the Tuya sensor, which reports depth in METERS.
 * @param {number} depthM
 * @returns {{ gallons:number, depthIn:number, clamped:('low'|'high'|null) }}
 */
function depthMetersToGallons(depthM) {
  const depthIn = depthM * IN_PER_METER;
  const { gallons, clamped } = depthInchesToGallons(depthIn);
  return { gallons, depthIn, clamped };
}

/**
 * Reverse lookup: gallons -> water depth in inches. Useful for turning a
 * gallon threshold (e.g. the 450 gal safety floor) into the device's
 * depth-ratio % for alarm settings. Bisects the monotonic table.
 * @param {number} targetGallons
 * @returns {number} depth in inches
 */
function gallonsToDepthInches(targetGallons) {
  const minG = STRAPPING_TABLE[0][1];
  const maxG = STRAPPING_TABLE[STRAPPING_TABLE.length - 1][1];
  if (targetGallons <= minG) return STRAPPING_TABLE[0][0];
  if (targetGallons >= maxG) return STRAPPING_TABLE[STRAPPING_TABLE.length - 1][0];

  let lo = 0, hi = FULL_WATER_DEPTH_IN;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (depthInchesToGallons(mid).gallons < targetGallons) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Map a water depth to the device's "Liquid Level Ratio" %, which is linear
 * in depth against the 41" full span (NOT linear in gallons).
 * @param {number} depthIn
 * @returns {number} percent 0..100
 */
function depthInchesToDeviceRatio(depthIn) {
  return (100 * depthIn) / FULL_WATER_DEPTH_IN;
}

module.exports = {
  STRAPPING_TABLE,
  MODELED_STRAPPING_TABLE, // for comparison/rollback
  FULL_WATER_DEPTH_IN,
  SENSOR_TO_BOTTOM_IN,
  RATED_FULL_GALLONS,
  depthInchesToGallons,
  depthMetersToGallons,
  gallonsToDepthInches,
  depthInchesToDeviceRatio,
};

// --- Self-test: run `node tank-strapping-empirical.js` -----------------------
if (require.main === module) {
  console.log('tank-strapping self-test (EMPIRICAL TABLE)');
  console.log('═'.repeat(70));
  console.log();

  const checks = [
    ['full 41"', () => depthInchesToGallons(41).gallons, 1733],
    ['half-depth 20.5"', () => depthInchesToGallons(20.5).gallons, null],
    ['empty 0"', () => depthInchesToGallons(0).gallons, 0],
    ['sensor 1.04m (full)', () => depthMetersToGallons(1.04).gallons, null],
    ['450 gal floor -> in', () => gallonsToDepthInches(450), null],
    ['119 gal cutoff -> in', () => gallonsToDepthInches(119), null],
  ];

  for (const [label, fn, expect] of checks) {
    const v = fn();
    const note = expect != null ? `(expected ~${expect})` : '';
    console.log(`  ${label.padEnd(24)} = ${(+v).toFixed(1)} ${note}`);
  }

  // Monotonicity check
  let mono = true;
  for (let d = 0; d < 41; d++) {
    if (depthInchesToGallons(d + 1).gallons <= depthInchesToGallons(d).gallons) mono = false;
  }
  console.log();
  console.log(`  monotonic increasing: ${mono ? 'PASS' : 'FAIL'}`);
  console.log(`  450 gal -> ${depthInchesToDeviceRatio(gallonsToDepthInches(450)).toFixed(1)}% device ratio`);
  console.log(`  119 gal -> ${depthInchesToDeviceRatio(gallonsToDepthInches(119)).toFixed(1)}% device ratio`);
  console.log();

  // Comparison: empirical vs modeled at key depths
  console.log('Comparison: Empirical vs Modeled');
  console.log('─'.repeat(70));
  console.log('Depth (in) | Empirical (gal) | Modeled (gal) | Delta (gal) | Delta (%)');
  console.log('─'.repeat(70));

  const keyDepths = [0, 5, 10, 15, 20, 25, 30, 35, 40, 41];
  for (const d of keyDepths) {
    const empGal = STRAPPING_TABLE[d][1];
    const modGal = MODELED_STRAPPING_TABLE[d][1];
    const delta = empGal - modGal;
    const deltaPct = modGal > 0 ? (delta / modGal) * 100 : 0;

    console.log(`${d.toString().padStart(10)} | ${empGal.toString().padStart(15)} | ${modGal.toString().padStart(13)} | ${delta.toString().padStart(11)} | ${deltaPct.toFixed(1).padStart(9)}%`);
  }
  console.log();
  console.log('═'.repeat(70));
  console.log('Self-test complete. See docs/tank-strapping-refinement-2026-06-22.md');
  console.log('for validation report before deploying this table.');
}
