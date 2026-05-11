/**
 * z5-startup-selftest.js — Garage Z5 cap integrity self-test
 * 
 * Phase 4a Wave 3: Standalone module (NOT wired to service startup yet)
 * 
 * Tests that Garage Z5 (attribution gate) cap is intact by opening the valve
 * and verifying no flow is detected. This confirms Z5 can serve as a gating
 * signal for Pool Equipment flow attribution without actually delivering water.
 * 
 * NOTE: This module creates the self-test function but does NOT wire it into
 * pm2 service startup. Wave 7 (separate decision) determines which process
 * (irrigation-poll or irrigation-server) runs this test on startup.
 */

const { getDb } = require('./db');
const hydrawise = require('./hydrawise-api');

// Constants
const THRESHOLD_GPM = 0.3;  // Z5 flow must be below this to pass (cap integrity check)
const SAMPLE_DURATION_SEC = 30;  // Total sampling duration
const SAMPLE_INTERVAL_SEC = 5;  // Sample flow every 5 seconds
const STABILIZATION_SEC = 10;  // Ignore first 10s (valve stabilization)
const SKIP_IF_RECENT_HOURS = 24;  // Don't re-test if passed test exists within 24h

/**
 * Run Z5 cap integrity self-test.
 * 
 * @param {Object} options
 * @param {boolean} [options.skipIfRecent=true] - Skip if test passed within 24h
 * @param {boolean} [options.dryRun=false] - Log what would happen without executing
 * @returns {Promise<Object>} Test result: { passed, maxGPM, sampleCount, timestamp, skipped?, reason }
 */
async function runZ5SelfTest(options = {}) {
  const { skipIfRecent = true, dryRun = false } = options;
  const db = getDb();

  // -------------------------------------------------------------
  // Step 1: skipIfRecent guard
  // -------------------------------------------------------------
  if (skipIfRecent) {
    const recentTest = db.prepare(`
      SELECT * FROM z5_selftest_log
      WHERE passed = 1
        AND timestamp >= datetime('now', '-${SKIP_IF_RECENT_HOURS} hours')
      ORDER BY timestamp DESC
      LIMIT 1
    `).get();

    if (recentTest) {
      console.log(`[Z5-SELFTEST] Skipping - test passed within ${SKIP_IF_RECENT_HOURS}h (last: ${recentTest.timestamp})`);
      return {
        skipped: true,
        reason: `Recent test passed within ${SKIP_IF_RECENT_HOURS}h`,
        lastTest: recentTest
      };
    }
  }

  if (dryRun) {
    console.log('[Z5-SELFTEST] DRY RUN - would execute self-test sequence:');
    console.log('  1. Check no other Garage zones active');
    console.log('  2. Check Garage flow meter healthy (controller_flow_meter_health.is_healthy=1)');
    console.log(`  3. Open Garage Z5, wait ${STABILIZATION_SEC}s stabilization`);
    console.log(`  4. Sample flow meter every ${SAMPLE_INTERVAL_SEC}s for ${SAMPLE_DURATION_SEC}s total`);
    console.log('  5. Close Garage Z5');
    console.log(`  6. Verify maxGPM < ${THRESHOLD_GPM} (cap integrity)`);
    console.log('  7. Log result to z5_selftest_log');
    return {
      dryRun: true,
      message: 'Dry run - no valves opened, no actual test executed'
    };
  }

  // -------------------------------------------------------------
  // Step 2: Preflight checks
  // -------------------------------------------------------------
  
  // Check: Garage flow meter must be healthy
  const meterHealth = db.prepare(`
    SELECT is_healthy FROM controller_flow_meter_health
    WHERE controller_id = 1659477
  `).get();

  if (!meterHealth || meterHealth.is_healthy !== 1) {
    const reason = 'Garage flow meter unhealthy - cannot run Z5 self-test';
    console.error(`[Z5-SELFTEST] ABORT: ${reason}`);
    
    // Log failed attempt
    db.prepare(`
      INSERT INTO z5_selftest_log (timestamp, passed, max_gpm, sample_count, reason)
      VALUES (datetime('now'), 0, NULL, 0, ?)
    `).run(reason);

    return {
      passed: 0,
      maxGPM: null,
      sampleCount: 0,
      timestamp: new Date().toISOString(),
      reason
    };
  }

  // Check: No other Garage zones should be active
  // (In real implementation, query zone_state_log for active Garage zones)
  // For now, this is a placeholder - actual implementation would check:
  // SELECT COUNT(*) FROM zone_state_log WHERE controller = 'Loomis Garage' AND state = 'on' AND timestamp > datetime('now', '-5 minutes')

  // -------------------------------------------------------------
  // Step 3-6: VALVE OPERATION PLACEHOLDER
  // -------------------------------------------------------------
  
  // IMPORTANT: This is Wave 3 (module creation only).
  // Actual valve opening and flow meter sampling is Wave 6 (calibration runs).
  // 
  // This function signature and logic structure is correct, but the Hydrawise
  // setzone API integration and live flow meter reading happens in Wave 6.
  // 
  // For Wave 3, we create the module and verify it loads without errors.
  // The actual test execution will be implemented when:
  // 1. Hydrawise setzone API is integrated (Phase 4b)
  // 2. Human is present to supervise live valve operations (Wave 6)

  throw new Error('Z5 self-test valve operation not yet implemented - requires Hydrawise setzone API (Phase 4b) and human supervision (Wave 6)');

  // FUTURE IMPLEMENTATION (Wave 6):
  // 1. Open Z5 via Hydrawise setzone API
  // 2. Wait STABILIZATION_SEC
  // 3. Sample Garage flow meter every SAMPLE_INTERVAL_SEC for SAMPLE_DURATION_SEC
  // 4. Close Z5
  // 5. Analyze samples: maxGPM = Math.max(...flowSamples)
  // 6. Determine pass/fail: passed = maxGPM < THRESHOLD_GPM ? 1 : 0
  // 7. Log to z5_selftest_log
  // 8. Return result
}

/**
 * CLI interface for manual self-test execution.
 * Usage: node z5-startup-selftest.js [--dry-run] [--force]
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  console.log('[Z5-SELFTEST] Running Z5 cap integrity self-test...');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  skipIfRecent: ${!force}`);

  runZ5SelfTest({ skipIfRecent: !force, dryRun })
    .then(result => {
      console.log('[Z5-SELFTEST] Result:', JSON.stringify(result, null, 2));
      if (result.skipped) {
        console.log('[Z5-SELFTEST] Test skipped - recent pass exists');
        process.exit(0);
      }
      if (result.dryRun) {
        console.log('[Z5-SELFTEST] Dry run complete');
        process.exit(0);
      }
      if (result.passed === 1) {
        console.log('[Z5-SELFTEST] ? PASS - Z5 cap intact');
        process.exit(0);
      } else {
        console.error('[Z5-SELFTEST] ? FAIL - Z5 cap may be compromised');
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('[Z5-SELFTEST] Error:', err.message);
      if (err.message.includes('not yet implemented')) {
        console.log('[Z5-SELFTEST] This is expected for Phase 4a Wave 3 - valve operations implemented in Wave 6');
        process.exit(0);  // Exit successfully - module structure is correct
      }
      process.exit(1);
    });
}

module.exports = { runZ5SelfTest };