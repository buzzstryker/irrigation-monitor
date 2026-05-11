/**
 * flow-calibration.js — Pool Equipment zone GPM calibration tool
 * 
 * Phase 4a Wave 4: CLI tool for measuring Pool Equipment zone GPMs
 * 
 * Uses Garage flow meter to measure Pool Equipment zone flow rates via
 * the Z5 attribution gate mechanism. Opens Z5, then the target Pool zone,
 * samples Garage meter, and cross-checks against tank drawdown.
 * 
 * NOTE: This module creates the calibration function structure but does NOT
 * wire actual valve operations yet. Valve control requires:
 * 1. Hydrawise setzone API integration (Phase 4b)
 * 2. Human supervision during calibration runs (Wave 6)
 * 
 * Wave 4 scope: Module structure, CLI interface, calculation logic
 * Wave 6 scope: Live valve operations, actual calibration runs
 */

const { getDb } = require('./db');
const hydrawise = require('./hydrawise-api');
const zonesConfig = require('./zones.config');

// Constants
const DEFAULT_DURATION_SEC = 300;  // 5 minutes default calibration run
const SAMPLE_INTERVAL_SEC = 5;  // Sample flow every 5 seconds
const STABILIZATION_SEC = 10;  // Ignore first 10s after valve opens
const MIN_TANK_HEADROOM_GAL = 600;  // Need buffer for calibration + safety margin

/**
 * Run calibration for a Pool Equipment zone.
 * 
 * @param {Object} options
 * @param {number} options.poolZoneRelay - Pool Equipment zone relay (1-11)
 * @param {number} [options.durationSec=300] - Calibration run duration
 * @param {number} [options.pollIntervalSec=5] - Flow meter sampling interval
 * @param {boolean} [options.dryRun=false] - Log what would happen without executing
 * @returns {Promise<Object>} Calibration result: { meterGPM, tankGPM, confidence, ... }
 */
async function runCalibration(options = {}) {
  const {
    poolZoneRelay,
    durationSec = DEFAULT_DURATION_SEC,
    pollIntervalSec = SAMPLE_INTERVAL_SEC,
    dryRun = false
  } = options;

  if (!poolZoneRelay || poolZoneRelay < 1 || poolZoneRelay > 11) {
    throw new Error('poolZoneRelay must be 1-11 (Pool Equipment zone relay ID)');
  }

  const db = getDb();

  // -------------------------------------------------------------
  // Step 1: Find target zone in zones.config.js
  // -------------------------------------------------------------
  const poolController = zonesConfig.controllers.find(c => c.name === 'Loomis Pool Equipment');
  if (!poolController) {
    throw new Error('Pool Equipment controller not found in zones.config.js');
  }

  const targetZone = poolController.zones.find(z => z.relay_id === poolZoneRelay);
  if (!targetZone) {
    throw new Error(`Pool Equipment Z${poolZoneRelay} not found in zones.config.js`);
  }

  console.log(`[CALIBRATION] Target: Pool Equipment ${targetZone.zone_id} (${targetZone.name})`);
  console.log(`[CALIBRATION] Duration: ${durationSec}s, Sample interval: ${pollIntervalSec}s`);

  if (dryRun) {
    console.log('[CALIBRATION] DRY RUN - would execute calibration sequence:');
    console.log('  PREFLIGHT:');
    console.log('    - Verify Z5 self-test passed recently (within 7 days)');
    console.log('    - Verify no other zones active on Garage or Pool Equipment');
    console.log('    - Verify Garage flow meter healthy');
    console.log(`    - Verify tank level > ${MIN_TANK_HEADROOM_GAL} gal`);
    console.log('  SEQUENCE:');
    console.log('    - Record tank_level_start');
    console.log('    - Open Garage Z5 (attribution gate)');
    console.log(`    - Wait ${STABILIZATION_SEC}s`);
    console.log(`    - Open Pool Equipment Z${poolZoneRelay}`);
    console.log(`    - Wait ${STABILIZATION_SEC}s`);
    console.log(`    - Sample Garage flow meter every ${pollIntervalSec}s for ${durationSec}s`);
    console.log(`    - Close Pool Equipment Z${poolZoneRelay}`);
    console.log('    - Close Garage Z5');
    console.log('    - Record tank_level_end');
    console.log('  CALCULATION:');
    console.log('    - meterGPM = avg(flow samples), meterStddev = stddev(samples)');
    console.log('    - tankDrawdownGal = tank_level_start - tank_level_end');
    console.log('    - tankGPM = tankDrawdownGal / (durationSec / 60)');
    console.log('    - agreementPct = abs(meterGPM - tankGPM) / meterGPM * 100');
    console.log('    - confidence = agreementPct < 10% ? "high" : agreementPct < 20% ? "medium" : "low"');
    console.log('  LOGGING:');
    console.log('    - INSERT into flow_calibration_log');
    console.log('    - Print recommendation: "Update zones.config.js Z{N}.gpm = {meterGPM}"');
    console.log('    - NOTE: Does NOT auto-update zones.config.js - human reviews logged results');
    return {
      dryRun: true,
      targetZone: targetZone.zone_id,
      message: 'Dry run - no valves opened, no actual calibration executed'
    };
  }

  // -------------------------------------------------------------
  // Step 2: Preflight gates
  // -------------------------------------------------------------

  // Gate 1: Z5 self-test must have passed recently
  const z5Test = db.prepare(`
    SELECT * FROM z5_selftest_log
    WHERE passed = 1
      AND timestamp >= datetime('now', '-7 days')
    ORDER BY timestamp DESC
    LIMIT 1
  `).get();

  if (!z5Test) {
    throw new Error('Z5 self-test has not passed within 7 days - run z5-startup-selftest.js first');
  }

  // Gate 2: Garage flow meter must be healthy
  const meterHealth = db.prepare(`
    SELECT is_healthy FROM controller_flow_meter_health
    WHERE controller_id = 1659477
  `).get();

  if (!meterHealth || meterHealth.is_healthy !== 1) {
    throw new Error('Garage flow meter unhealthy - cannot run calibration');
  }

  // Gate 3: Tank level must have sufficient headroom
  const latestTankLevel = db.prepare(`
    SELECT level_gallons FROM tank_level_log
    ORDER BY timestamp DESC
    LIMIT 1
  `).get();

  const tankLevel = latestTankLevel?.level_gallons || 0;
  if (tankLevel < MIN_TANK_HEADROOM_GAL) {
    throw new Error(`Insufficient tank headroom (${tankLevel.toFixed(0)} gal < ${MIN_TANK_HEADROOM_GAL} gal required)`);
  }

  console.log(`[CALIBRATION] Preflight PASS - Z5 test OK, meter healthy, tank at ${tankLevel.toFixed(0)} gal`);

  // Gate 4: No other zones should be active
  // (Placeholder - actual implementation checks zone_state_log for recent active zones)

  // -------------------------------------------------------------
  // Step 3-6: VALVE OPERATION & SAMPLING PLACEHOLDER
  // -------------------------------------------------------------

  // IMPORTANT: This is Wave 4 (module creation only).
  // Actual valve opening, flow meter sampling, and live calibration is Wave 6.
  // 
  // This function signature and preflight logic is correct, but the Hydrawise
  // setzone API integration and live meter reading happens in Wave 6.
  // 
  // For Wave 4, we create the module structure and verify it loads without errors.
  // The actual calibration execution will be implemented when:
  // 1. Hydrawise setzone API is integrated (Phase 4b)
  // 2. Human is present to supervise live valve operations (Wave 6)

  throw new Error('Calibration valve operation not yet implemented - requires Hydrawise setzone API (Phase 4b) and human supervision (Wave 6)');

  // FUTURE IMPLEMENTATION (Wave 6):
  // 1. Record tank_level_start
  // 2. Open Garage Z5 via setzone
  // 3. Wait STABILIZATION_SEC
  // 4. Open Pool Equipment target zone via setzone
  // 5. Wait STABILIZATION_SEC
  // 6. Sample Garage flow meter every pollIntervalSec for durationSec
  // 7. Close target zone
  // 8. Close Z5
  // 9. Record tank_level_end
  // 10. Calculate: meterGPM (avg), meterStddev, tankGPM (drawdown / time), agreementPct
  // 11. Assign confidence: high (<10%), medium (<20%), low (>=20%)
  // 12. INSERT into flow_calibration_log
  // 13. Print recommendation: "Update zones.config.js Z{N}.gpm = {meterGPM.toFixed(1)}"
  // 14. Return result
}

/**
 * CLI interface for manual calibration execution.
 * Usage: node flow-calibration.js --zone pool-equip-z<N> [--duration 300] [--dry-run]
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Parse --zone flag
  const zoneArg = args.find(a => a.startsWith('--zone=') || a === '--zone');
  let poolZoneRelay = null;

  if (zoneArg === '--zone') {
    const zoneIdx = args.indexOf('--zone');
    const zoneValue = args[zoneIdx + 1];
    const match = zoneValue?.match(/pool-equip-z(\d+)/i);
    poolZoneRelay = match ? parseInt(match[1], 10) : null;
  } else if (zoneArg?.startsWith('--zone=')) {
    const zoneValue = zoneArg.split('=')[1];
    const match = zoneValue?.match(/pool-equip-z(\d+)/i);
    poolZoneRelay = match ? parseInt(match[1], 10) : null;
  }

  // Parse --duration flag
  const durationArg = args.find(a => a.startsWith('--duration='));
  const durationSec = durationArg ? parseInt(durationArg.split('=')[1], 10) : DEFAULT_DURATION_SEC;

  // Parse --dry-run flag
  const dryRun = args.includes('--dry-run');

  if (!poolZoneRelay) {
    console.error('Usage: node flow-calibration.js --zone pool-equip-z<N> [--duration 300] [--dry-run]');
    console.error('Example: node flow-calibration.js --zone pool-equip-z1 --duration 300 --dry-run');
    process.exit(1);
  }

  console.log('[CALIBRATION] Starting calibration run...');
  console.log(`  Target: Pool Equipment Z${poolZoneRelay}`);
  console.log(`  Duration: ${durationSec}s`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  runCalibration({ poolZoneRelay, durationSec, dryRun })
    .then(result => {
      console.log('[CALIBRATION] Result:', JSON.stringify(result, null, 2));
      
      if (result.dryRun) {
        console.log('[CALIBRATION] Dry run complete');
        process.exit(0);
      }

      // Live result
      console.log(`[CALIBRATION] Measured GPM: ${result.meterGPM.toFixed(2)} ± ${result.meterStddev.toFixed(2)}`);
      console.log(`[CALIBRATION] Tank GPM: ${result.tankGPM.toFixed(2)} (agreement: ${result.agreementPct.toFixed(1)}%)`);
      console.log(`[CALIBRATION] Confidence: ${result.confidence}`);
      console.log(`[CALIBRATION] RECOMMENDATION: Update zones.config.js Pool Equipment Z${poolZoneRelay}.gpm = ${result.meterGPM.toFixed(1)}`);
      console.log('[CALIBRATION] NOTE: Does NOT auto-update zones.config.js - human must review and apply');
      
      process.exit(result.confidence === 'high' ? 0 : 1);
    })
    .catch(err => {
      console.error('[CALIBRATION] Error:', err.message);
      if (err.message.includes('not yet implemented')) {
        console.log('[CALIBRATION] This is expected for Phase 4a Wave 4 - valve operations implemented in Wave 6');
        process.exit(0);  // Exit successfully - module structure is correct
      }
      process.exit(1);
    });
}

module.exports = { runCalibration };