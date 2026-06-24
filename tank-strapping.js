/**
 * tank-strapping.js
 * ------------------------------------------------------------------
 * Depth -> gallons conversion for the Loomis water tank.
 *
 * Tank: Norwesco / Snyder 44407, 1725 gal low-profile underground cistern.
 * Cross-section: horizontal ellipse, 69" wide x 51" tall, extruded 157" long.
 * Because the tank lies on its side, gallons-per-inch is NOT linear: an inch
 * of depth through the wide middle holds nearly double what an inch near the
 * empty bottom or full top holds. This module captures that S-curve.
 *
 * EMPIRICAL TABLE (v1 — adopted 2026-06-22):
 * Derived from June 21, 2026 refill event via constant-fill-rate inversion.
 * Uses real Tuya ME201W sensor data from two clean fill segments (29→68cm,
 * 63→102cm) with global fit across all observations. Reduces fill-rate spread
 * from 5.2% (modeled) → 0.9% (empirical). Anchored to 1725 gal @ 41".
 *
 * Known limitations (v1):
 * - 40% segment-boundary deviation at 63-68cm (two-segment stitch artifact)
 * - 11 local kinks in gal/in deltas (data-sparse regions: 10-15", 34-40")
 * - Future v2: single-sweep clean fill (no segment boundaries) will eliminate both
 *
 * CUTOFF FLOOR / LOW ALARM:
 * DO NOT derive pump cutoff from table gallons in the 10-15" region (sparsest/kinkiest).
 * Measured float behavior (June 21 test): tank reached ~255 gal / ~9.4" depth
 * STILL RISING (float not tripped) → true cutoff is BELOW 9.4". Set safety
 * floor with margin above this measured observation. Exact float trip depth
 * pending completed drawdown-to-trip test.
 *
 * SENSOR INPUT: the Tuya ME201W reports "Liquid Level Depth" in METERS,
 * measured from the hard tank bottom (after calibration:
 * Installation height = 1.23 m / 48.5", Liquid maximum depth = 1.04 m / 41").
 * Use depthMetersToGallons() for the raw sensor value.
 *
 * See docs/tank-strapping-refinement-2026-06-22.md for full derivation.
 * ------------------------------------------------------------------
 */

'use strict';

// Operating constants (inches), from on-site measurement.
const FULL_WATER_DEPTH_IN = 41.0;   // water column at full (sensor air gap = 7.5")
const SENSOR_TO_BOTTOM_IN = 48.5;   // installation height (hard bottom)
const RATED_FULL_GALLONS  = 1725;   // anchor
const IN_PER_METER        = 39.3701;

// Strapping table: [water_depth_inches, gallons], 1" resolution, 0..41".
// EMPIRICAL v1 (2026-06-22): derived from June 21 refill via constant-fill-rate
// inversion. Global fit across 2 clean segments. Reduces fill-rate spread from
// 5.2% (modeled) → 0.9% (empirical). Anchored to 1725 gal @ 41".
const STRAPPING_TABLE = [
  [0, 0],     [1, 18],    [2, 36],    [3, 53],    [4, 71],
  [5, 89],    [6, 107],   [7, 124],   [8, 142],   [9, 160],
  [10, 178],  [11, 195],  [12, 251],  [13, 310],  [14, 352],
  [15, 400],  [16, 457],  [17, 504],  [18, 548],  [19, 593],
  [20, 637],  [21, 681],  [22, 728],  [23, 769],  [24, 816],
  [25, 862],  [26, 910],  [27, 951],  [28, 996],  [29, 1040],
  [30, 1085], [31, 1130], [32, 1174], [33, 1218], [34, 1263],
  [35, 1303], [36, 1375], [37, 1430], [38, 1465], [39, 1508],
  [40, 1595], [41, 1733],
];

// ──────────────────────────────────────────────────────────────────────
// LEGACY MODELED TABLE (for rollback only — NOT ACTIVE)
// ──────────────────────────────────────────────────────────────────────
// Original table from elliptical geometry model, anchored at 1725 gal @ 41".
// Showed -36% error at 10" depth, 5.2% fill-rate spread across segments.
// Kept for comparison and emergency rollback only.
//
// To rollback: uncomment this table and replace STRAPPING_TABLE above with it.
//
// const MODELED_STRAPPING_TABLE = [
//   [0, 0],     [1, 9],     [2, 26],    [3, 48],    [4, 73],
//   [5, 101],   [6, 132],   [7, 166],   [8, 201],   [9, 238],
//   [10, 277],  [11, 318],  [12, 359],  [13, 402],  [14, 446],
//   [15, 491],  [16, 537],  [17, 584],  [18, 632],  [19, 680],
//   [20, 728],  [21, 777],  [22, 827],  [23, 876],  [24, 926],
//   [25, 976],  [26, 1026], [27, 1076], [28, 1126], [29, 1175],
//   [30, 1225], [31, 1274], [32, 1322], [33, 1370], [34, 1418],
//   [35, 1465], [36, 1511], [37, 1556], [38, 1600], [39, 1643],
//   [40, 1685], [41, 1725],
// ];

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
  FULL_WATER_DEPTH_IN,
  SENSOR_TO_BOTTOM_IN,
  RATED_FULL_GALLONS,
  depthInchesToGallons,
  depthMetersToGallons,
  gallonsToDepthInches,
  depthInchesToDeviceRatio,
};

// --- Self-test: run `node tank-strapping.js` -----------------------
if (require.main === module) {
  const checks = [
    ['full 41"', () => depthInchesToGallons(41).gallons, 1725],
    ['half-depth 20.5"', () => depthInchesToGallons(20.5).gallons, null],
    ['empty 0"', () => depthInchesToGallons(0).gallons, 0],
    ['sensor 1.04m (full)', () => depthMetersToGallons(1.04).gallons, null],
    ['450 gal floor -> in', () => gallonsToDepthInches(450), null],
    ['119 gal cutoff -> in', () => gallonsToDepthInches(119), null],
  ];
  console.log('tank-strapping self-test\n');
  for (const [label, fn, expect] of checks) {
    const v = fn();
    const note = expect != null ? `(expected ~${expect})` : '';
    console.log(`  ${label.padEnd(24)} = ${(+v).toFixed(1)} ${note}`);
  }
  // Monotonicity check.
  let mono = true;
  for (let d = 0; d < 41; d++) {
    if (depthInchesToGallons(d + 1).gallons <= depthInchesToGallons(d).gallons) mono = false;
  }
  console.log(`\n  monotonic increasing: ${mono ? 'PASS' : 'FAIL'}`);
  console.log(`  450 gal -> ${depthInchesToDeviceRatio(gallonsToDepthInches(450)).toFixed(1)}% device ratio`);
  console.log(`  119 gal -> ${depthInchesToDeviceRatio(gallonsToDepthInches(119)).toFixed(1)}% device ratio`);
}
