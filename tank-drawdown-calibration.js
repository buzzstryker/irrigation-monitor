/**
 * tank-drawdown-calibration.js — Tank-drawdown GPM calibration tool
 *
 * Measures zone GPM using tank level before/after method.
 *
 * CONTEXT:
 * - Hydrawise REST API v1 does not expose real-time flow meter data
 *   (investigation: docs/hydrawise-api-flow-fields.md)
 * - Tank-drawdown method: run zone for known duration, measure tank delta,
 *   subtract ditch fill contribution, compute GPM
 *
 * WHY TANK-DRAWDOWN:
 * - No flow meter required (works for all controllers including Barn)
 * - Only one zone can run at a time (drawdown isolation requirement)
 * - Net drawdown = actual_drawdown - ditch_fill_gal
 *   where ditch_fill_gal = DITCH_FILL_GPM × runtime_minutes
 *
 * WHY NO AUTO-WRITE:
 * - GPM measurements require human review before config changes
 * - Emitter clogs, leaks, or valve issues can produce bad readings
 * - User validates measurement, then manually updates zones.config.js
 *
 * REFERENCE:
 * - docs/phase-4a-audit.md (Wave 2: flow-calibration.js repurposed)
 * - flow_calibration_log schema fits this approach (tank_gpm is primary)
 *
 * Usage: node tank-drawdown-calibration.js --zone <zone-spec> --duration <seconds> [--dry-run]
 * Examples:
 *   node tank-drawdown-calibration.js --zone garage-z2 --duration 300 --dry-run
 *   node tank-drawdown-calibration.js --zone pool-equip-z1 --duration 300
 *   node tank-drawdown-calibration.js --zone barn-z1 --duration 180
 */

const { supabase } = require('./db');
const hydrawise = require('./hydrawise-api');
const zonesConfig = require('./zones.config');

// Constants
const DEFAULT_DURATION_SEC = 300;  // 5 minutes default
const MIN_TANK_HEADROOM_GAL = 600;  // Need buffer for drawdown + safety margin
const POLL_RECENT_THRESHOLD_SEC = 90;  // Tank model must have data within 90s
const DITCH_FILL_GPM = zonesConfig.tank.fill_rate_gpm;  // 5.77 GPM from zones.config.js

/**
 * Parse zone spec into {controllerId, controllerName, zoneRelay, zoneName}
 * Accepts: garage-z2, pool-equip-z1, barn-z1 (case-insensitive)
 */
function parseZoneSpec(zoneSpec) {
  const match = zoneSpec.match(/^(garage|pool-equip|barn)-z(\d+)$/i);
  if (!match) {
    throw new Error('Invalid zone spec format. Expected: garage-zN, pool-equip-zN, or barn-zN');
  }

  const [, controllerPart, relayStr] = match;
  const relay = parseInt(relayStr, 10);

  // Map controller name
  const controllerNameMap = {
    'garage': 'Loomis Garage',
    'pool-equip': 'Loomis Pool Equipment',
    'barn': 'Loomis barn'
  };
  const controllerName = controllerNameMap[controllerPart.toLowerCase()];

  // Find controller in config
  const controller = zonesConfig.controllers.find(c => c.name === controllerName);
  if (!controller) {
    throw new Error(`Controller "${controllerName}" not found in zones.config.js`);
  }

  // Find zone
  const zone = controller.zones.find(z => z.relay_id === relay);
  if (!zone) {
    throw new Error(`Zone relay ${relay} not found on ${controllerName}`);
  }

  return {
    controllerId: controller.id,
    controllerName: controller.name,
    zoneRelay: relay,
    zoneName: zone.name,
    zoneId: zone.zone_id
  };
}

/**
 * Run tank-drawdown calibration for a zone.
 *
 * @param {Object} options
 * @param {string} options.zoneSpec - Zone spec: garage-z2, pool-equip-z1, barn-z1
 * @param {number} [options.durationSec=300] - Calibration run duration in seconds
 * @param {boolean} [options.dryRun=false] - Log what would happen without executing
 * @returns {Promise<Object>} Calibration result: { tankGPM, tankDrawdownGal, ditchFillGal, ... }
 */
async function runCalibration(options = {}) {
  const {
    zoneSpec,
    durationSec = DEFAULT_DURATION_SEC,
    dryRun = false
  } = options;

  if (!zoneSpec) {
    throw new Error('zoneSpec required (e.g., "garage-z2", "pool-equip-z1")');
  }

  const zone = parseZoneSpec(zoneSpec);

  console.log(`[CALIBRATION] Target: ${zone.controllerName} ${zone.zoneId} (${zone.zoneName})`);
  console.log(`[CALIBRATION] Duration: ${durationSec}s (${(durationSec / 60).toFixed(1)} minutes)`);

  if (dryRun) {
    console.log('[CALIBRATION] DRY RUN - would execute calibration sequence:');
    console.log('  PREFLIGHT:');
    console.log(`    - Verify tank level > ${MIN_TANK_HEADROOM_GAL} gal`);
    console.log('    - Verify no other zones active (any controller)');
    console.log(`    - Verify tank model healthy (recent data within ${POLL_RECENT_THRESHOLD_SEC}s)`);
    console.log('  SEQUENCE:');
    console.log('    - Capture tank level t0 (most recent tank_level_log reading)');
    console.log(`    - Prompt: "Please start ${zone.controllerName} ${zone.zoneId} in Hydrawise UI for ${durationSec}s, press Enter"`);
    console.log(`    - Wait ${durationSec + 30}s (duration + buffer)`);
    console.log('    - Capture tank level t1 (most recent tank_level_log reading)');
    console.log('  CALCULATION:');
    console.log('    - tank_drawdown_gal = level_t0 - level_t1 (NET drawdown including ditch fill)');
    console.log(`    - ditch_fill_gal = ${DITCH_FILL_GPM} GPM × (t1 - t0) / 60`);
    console.log('    - gross_consumption_gal = tank_drawdown_gal + ditch_fill_gal');
    console.log('    - measured_gpm = gross_consumption_gal / (duration / 60)');
    console.log('  LOGGING:');
    console.log('    - INSERT into flow_calibration_log (tank_gpm = measured_gpm)');
    console.log(`    - Compare measured_gpm vs zones.config.js ${zone.zoneId}.gpm`);
    console.log('    - Print delta and recommendation');
    console.log('  NOTE: Does NOT auto-update zones.config.js - human reviews results');
    return {
      dryRun: true,
      targetZone: `${zone.controllerName} ${zone.zoneId}`,
      message: 'Dry run - no zone started, no actual calibration executed'
    };
  }

  // -------------------------------------------------------------
  // Preflight gates
  // -------------------------------------------------------------

  // Gate 1: Tank model must be healthy (recent data)
  const { data: latestTankReading, error: tankReadError } = await supabase
    .from('tank_level_log')
    .select('level_gallons, timestamp')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tankReadError) {
    throw new Error(`Error reading tank level: ${tankReadError.message}`);
  }

  if (!latestTankReading) {
    throw new Error('No tank level data found - tank model not initialized');
  }

  const tankDataAge = Date.now() / 1000 - latestTankReading.timestamp;
  if (tankDataAge > POLL_RECENT_THRESHOLD_SEC) {
    throw new Error(`Tank model stale (${tankDataAge.toFixed(0)}s old) - poll.js may not be running`);
  }

  console.log(`[CALIBRATION] Tank model healthy - last reading ${tankDataAge.toFixed(0)}s ago`);

  // Gate 2: Tank level must have sufficient headroom
  const tankLevel = latestTankReading.level_gallons;
  if (tankLevel < MIN_TANK_HEADROOM_GAL) {
    throw new Error(`Insufficient tank headroom (${tankLevel.toFixed(0)} gal < ${MIN_TANK_HEADROOM_GAL} gal required)`);
  }

  console.log(`[CALIBRATION] Tank headroom OK - current level ${tankLevel.toFixed(0)} gal`);

  // Gate 3: No other zones should be active (CRITICAL for drawdown isolation)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  const { data: activeZones, error: activeError } = await supabase
    .from('zone_state_log')
    .select('controller, zone_id')
    .eq('state', 'on')
    .gte('timestamp', fiveMinutesAgo);

  if (activeError) {
    throw new Error(`Error checking active zones: ${activeError.message}`);
  }

  if (activeZones && activeZones.length > 0) {
    const activeList = activeZones.map(z => `${z.controller} ${z.zone_id}`).join(', ');
    throw new Error(`Active zones detected: ${activeList}. Tank-drawdown requires ONE zone at a time.`);
  }

  console.log('[CALIBRATION] No other zones active - isolation check PASS');

  // -------------------------------------------------------------
  // Measurement sequence
  // -------------------------------------------------------------

  console.log('[CALIBRATION] Starting measurement sequence...');

  // Step 1: Capture tank level at t0
  const { data: t0_reading, error: t0Error } = await supabase
    .from('tank_level_log')
    .select('level_gallons, timestamp')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  if (t0Error) {
    throw new Error(`Error reading t0 tank level: ${t0Error.message}`);
  }

  const t0_level = t0_reading.level_gallons;
  const t0_timestamp = t0_reading.timestamp;

  console.log(`[CALIBRATION] t0: ${new Date(t0_timestamp * 1000).toISOString()}, level ${t0_level.toFixed(1)} gal`);

  // Step 2: Prompt user to start zone
  // (In production, this would call hydrawise.setzone once the API is validated)
  console.log('');
  console.log('='.repeat(80));
  console.log(`MANUAL STEP: Please start ${zone.controllerName} ${zone.zoneId} in the Hydrawise UI now.`);
  console.log(`Configure the zone for ${durationSec} seconds (${(durationSec / 60).toFixed(1)} minutes).`);
  console.log('Press Enter when the zone has started...');
  console.log('='.repeat(80));
  console.log('');

  // Wait for user confirmation (synchronous read from stdin)
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => {
    readline.question('', () => {
      readline.close();
      resolve();
    });
  });

  const zoneStartTime = Date.now();
  console.log(`[CALIBRATION] Zone started at ${new Date(zoneStartTime).toISOString()}`);

  // Step 3: Wait for zone to complete (duration + buffer)
  const waitMs = (durationSec + 30) * 1000;
  console.log(`[CALIBRATION] Waiting ${durationSec + 30}s for zone to complete...`);

  await new Promise(resolve => setTimeout(resolve, waitMs));

  // Step 4: Capture tank level at t1
  const { data: t1_reading, error: t1Error } = await supabase
    .from('tank_level_log')
    .select('level_gallons, timestamp')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  if (t1Error) {
    throw new Error(`Error reading t1 tank level: ${t1Error.message}`);
  }

  const t1_level = t1_reading.level_gallons;
  const t1_timestamp = t1_reading.timestamp;

  console.log(`[CALIBRATION] t1: ${new Date(t1_timestamp * 1000).toISOString()}, level ${t1_level.toFixed(1)} gal`);

  // -------------------------------------------------------------
  // Calculation
  // -------------------------------------------------------------

  const elapsed_sec = t1_timestamp - t0_timestamp;
  const elapsed_min = elapsed_sec / 60;

  // Net drawdown (includes ditch fill, which was happening concurrently)
  const tank_drawdown_gal = t0_level - t1_level;

  // Ditch fill contribution during the run
  const ditch_fill_gal = DITCH_FILL_GPM * elapsed_min;

  // Gross consumption = what the zone actually used
  const gross_consumption_gal = tank_drawdown_gal + ditch_fill_gal;

  // Measured GPM
  const measured_gpm = gross_consumption_gal / elapsed_min;

  console.log('');
  console.log('[CALIBRATION] === RESULTS ===');
  console.log(`  Elapsed time: ${elapsed_min.toFixed(2)} minutes`);
  console.log(`  Tank drawdown (net): ${tank_drawdown_gal.toFixed(2)} gal`);
  console.log(`  Ditch fill (concurrent): ${ditch_fill_gal.toFixed(2)} gal`);
  console.log(`  Gross consumption: ${gross_consumption_gal.toFixed(2)} gal`);
  console.log(`  Measured GPM: ${measured_gpm.toFixed(2)}`);

  // Compare to configured GPM
  const configuredGpm = zonesConfig.controllers
    .find(c => c.name === zone.controllerName)
    ?.zones.find(z => z.relay_id === zone.zoneRelay)
    ?.gpm;

  if (configuredGpm !== null && configuredGpm !== undefined) {
    const delta = measured_gpm - configuredGpm;
    const deltaPct = (delta / configuredGpm) * 100;
    console.log(`  Configured GPM: ${configuredGpm.toFixed(2)}`);
    console.log(`  Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} GPM (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%)`);
  } else {
    console.log(`  Configured GPM: (not set)`);
  }

  console.log('');

  // -------------------------------------------------------------
  // Log to database
  // -------------------------------------------------------------

  const notes = `Tank-drawdown calibration. Elapsed: ${elapsed_min.toFixed(2)} min. ` +
    `Config GPM: ${configuredGpm !== null && configuredGpm !== undefined ? configuredGpm.toFixed(1) : 'N/A'}`;

  const { error: logError } = await supabase
    .from('flow_calibration_log')
    .insert({
      controller_id: zone.controllerId,
      zone_relay: zone.zoneRelay,
      duration_sec: Math.round(elapsed_sec),
      tank_gpm: measured_gpm,
      tank_drawdown_gal,
      ditch_fill_gal,
      notes
    });

  if (logError) {
    console.error('[CALIBRATION] Error logging to flow_calibration_log:', logError.message);
  } else {
    console.log('[CALIBRATION] Logged to flow_calibration_log');
  }
  console.log('');
  console.log('[CALIBRATION] === RECOMMENDATION ===');
  console.log(`Update zones.config.js:`);
  console.log(`  ${zone.controllerName} ${zone.zoneId}.gpm = ${measured_gpm.toFixed(1)}`);
  console.log('');
  console.log('NOTE: This tool does NOT auto-update zones.config.js.');
  console.log('Review the measurement, then manually update the config file if appropriate.');
  console.log('');

  return {
    zoneSpec,
    controllerId: zone.controllerId,
    controllerName: zone.controllerName,
    zoneRelay: zone.zoneRelay,
    zoneName: zone.zoneName,
    durationSec: Math.round(elapsed_sec),
    tankGPM: measured_gpm,
    tankDrawdownGal: tank_drawdown_gal,
    ditchFillGal: ditch_fill_gal,
    configuredGPM: configuredGpm,
    timestamp: new Date().toISOString()
  };
}

/**
 * CLI interface for manual calibration execution.
 * Usage: node tank-drawdown-calibration.js --zone <zone-spec> --duration <seconds> [--dry-run]
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  // Parse --zone flag
  const zoneArg = args.find(a => a.startsWith('--zone=') || a === '--zone');
  let zoneSpec = null;

  if (zoneArg === '--zone') {
    const zoneIdx = args.indexOf('--zone');
    zoneSpec = args[zoneIdx + 1];
  } else if (zoneArg?.startsWith('--zone=')) {
    zoneSpec = zoneArg.split('=')[1];
  }

  // Parse --duration flag
  const durationArg = args.find(a => a.startsWith('--duration='));
  const durationSec = durationArg ? parseInt(durationArg.split('=')[1], 10) : DEFAULT_DURATION_SEC;

  // Parse --dry-run flag
  const dryRun = args.includes('--dry-run');

  if (!zoneSpec) {
    console.error('Usage: node tank-drawdown-calibration.js --zone <zone-spec> --duration <seconds> [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  node tank-drawdown-calibration.js --zone garage-z2 --duration 300 --dry-run');
    console.error('  node tank-drawdown-calibration.js --zone pool-equip-z1 --duration 300');
    console.error('  node tank-drawdown-calibration.js --zone barn-z1 --duration 180');
    console.error('');
    console.error('Zone specs: garage-zN, pool-equip-zN, barn-zN (case-insensitive)');
    process.exit(1);
  }

  console.log('[CALIBRATION] Starting tank-drawdown calibration...');
  console.log(`  Zone: ${zoneSpec}`);
  console.log(`  Duration: ${durationSec}s (${(durationSec / 60).toFixed(1)} minutes)`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  runCalibration({ zoneSpec, durationSec, dryRun })
    .then(result => {
      if (result.dryRun) {
        console.log('[CALIBRATION] Dry run complete');
        process.exit(0);
      }

      console.log('[CALIBRATION] Calibration complete');
      process.exit(0);
    })
    .catch(err => {
      console.error('[CALIBRATION] Error:', err.message);
      process.exit(1);
    });
}

module.exports = { runCalibration };
