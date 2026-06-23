/**
 * tank-warning.js — low-tank (pump dry-run) safety decision.
 *
 * Pure, stateless function so the dry-run safety net is testable and, critically,
 * has NO in-memory state to reset. The previous design tracked a modeled tankLevel
 * that was initialized to "full" (usable_gal) on every process start, so a Railway
 * restart wiped any low-tank knowledge. This decision is driven purely by the
 * latest MEASURED tank_sensor_log gallons (absolute scale, 0–1725), compared
 * against low_warning_gal (450, also absolute) — so it reflects reality and
 * survives restarts (the caller re-reads the measurement from the DB each cycle).
 */

'use strict';

/**
 * @param {number|null|undefined} measuredGallons latest tank_sensor_log.level_gallons
 * @param {number} thresholdGallons low_warning_gal (absolute gallons)
 * @returns {boolean|null} true = warn (low), false = clear (ok),
 *                         null = unknown (no/invalid measurement — caller should
 *                         neither raise nor resolve the warning)
 */
function shouldWarnLowTank(measuredGallons, thresholdGallons) {
  if (measuredGallons == null || Number.isNaN(measuredGallons)) return null;
  return measuredGallons < thresholdGallons;
}

module.exports = { shouldWarnLowTank };
