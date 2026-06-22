/**
 * refine-strapping-table.js
 * ------------------------------------------------------------------
 * Empirically refine the tank strapping table (depth→gallons) using real
 * constant-fill sensor data. The ditch delivers water at a constant volumetric
 * rate (GPM), so the rate at which depth changes reveals the true gallons-per-cm
 * at each depth level.
 *
 * METHOD:
 * 1. Extract clean fill windows from tank_sensor_log (no valve activity on ANY controller)
 * 2. Assume constant true fill rate (GPM) during each clean segment
 * 3. Compute gallons-per-cm at each depth: GPM / (depth_change_rate)
 * 4. Integrate gallons-per-cm from bottom → top to build depth→gallons curve
 * 5. Anchor the curve to 1725 gal at 41" (104cm), same as current table
 * 6. Validate: re-compute fill rate across segments using new table — should be consistent
 *
 * USAGE: node scripts/refine-strapping-table.js
 * ------------------------------------------------------------------
 */

'use strict';

require('dotenv').config();
const { supabase } = require('../db');
const { STRAPPING_TABLE: OLD_TABLE } = require('../tank-strapping');

// Operating constants (from tank-strapping.js)
const FULL_WATER_DEPTH_IN = 41.0;
const FULL_WATER_DEPTH_CM = 104.14; // 41" in cm
const RATED_FULL_GALLONS = 1725;
const IN_PER_METER = 39.3701;
const CM_PER_METER = 100;

// ──────────────────────────────────────────────
// Data Fetching
// ──────────────────────────────────────────────

/**
 * Fetch tank sensor readings for a time range (epoch seconds).
 */
async function fetchTankReadings(startEpoch, endEpoch) {
  const { data, error } = await supabase
    .from('tank_sensor_log')
    .select('timestamp, depth_meters')
    .gte('timestamp', startEpoch)
    .lte('timestamp', endEpoch)
    .order('timestamp', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch tank_sensor_log: ${error.message}`);
  }

  return data.map(r => ({
    timestamp: r.timestamp,
    depth_cm: r.depth_meters * CM_PER_METER,
  }));
}

/**
 * Fetch zone state transitions for all controllers in a time range.
 * Returns array of { timestamp, controller, zone_id, state }.
 */
async function fetchZoneStates(startEpoch, endEpoch) {
  const { data, error } = await supabase
    .from('zone_state_log')
    .select('timestamp, controller, zone_id, state')
    .gte('timestamp', startEpoch)
    .lte('timestamp', endEpoch)
    .order('timestamp', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch zone_state_log: ${error.message}`);
  }

  return data;
}

/**
 * Find clean fill segments: stretches where tank depth rose monotonically
 * with NO valve activity on ANY controller.
 */
function findCleanFillSegments(tankReadings, zoneStates, minSegmentSeconds = 30 * 60) {
  const segments = [];

  // Build a set of timestamps where any valve was active
  const valveActiveTimes = new Set();
  let activeZones = new Map(); // track which zones are currently on

  for (const z of zoneStates) {
    const key = `${z.controller}:${z.zone_id}`;

    if (z.state === 'on' || z.state === 1) {
      activeZones.set(key, z.timestamp);
    } else if (z.state === 'off' || z.state === 0) {
      const onTime = activeZones.get(key);
      if (onTime) {
        // Mark all seconds between ON and OFF as valve-active
        for (let t = onTime; t <= z.timestamp; t++) {
          valveActiveTimes.add(t);
        }
        activeZones.delete(key);
      }
    }
  }

  // Find continuous stretches where tank rose monotonically AND no valves active
  let segmentStart = null;
  let prevReading = null;

  for (let i = 0; i < tankReadings.length; i++) {
    const reading = tankReadings[i];
    const isValveActive = valveActiveTimes.has(reading.timestamp);
    const isMonotonic = !prevReading || reading.depth_cm >= prevReading.depth_cm;

    if (!isValveActive && isMonotonic) {
      // Extend or start segment
      if (!segmentStart) {
        segmentStart = i;
      }
    } else {
      // End current segment if long enough
      if (segmentStart !== null && i > segmentStart) {
        const start = tankReadings[segmentStart];
        const end = tankReadings[i - 1];
        const duration = end.timestamp - start.timestamp;

        if (duration >= minSegmentSeconds) {
          segments.push({
            startIdx: segmentStart,
            endIdx: i - 1,
            startTime: start.timestamp,
            endTime: end.timestamp,
            duration,
            startDepth: start.depth_cm,
            endDepth: end.depth_cm,
            readings: tankReadings.slice(segmentStart, i),
          });
        }
      }
      segmentStart = null;
    }

    prevReading = reading;
  }

  // Handle trailing segment
  if (segmentStart !== null) {
    const start = tankReadings[segmentStart];
    const end = tankReadings[tankReadings.length - 1];
    const duration = end.timestamp - start.timestamp;

    if (duration >= minSegmentSeconds) {
      segments.push({
        startIdx: segmentStart,
        endIdx: tankReadings.length - 1,
        startTime: start.timestamp,
        endTime: end.timestamp,
        duration,
        startDepth: start.depth_cm,
        endDepth: end.depth_cm,
        readings: tankReadings.slice(segmentStart),
      });
    }
  }

  return segments;
}

// ──────────────────────────────────────────────
// Strapping Table Derivation
// ──────────────────────────────────────────────

/**
 * Compute depth change rate (cm/min) at each reading in a segment.
 * Uses centered difference for interior points, forward/back diff for edges.
 */
function computeDepthRates(readings) {
  const rates = [];

  for (let i = 0; i < readings.length; i++) {
    let rate;

    if (i === 0) {
      // Forward difference
      const dt = (readings[i + 1].timestamp - readings[i].timestamp) / 60; // minutes
      const dd = readings[i + 1].depth_cm - readings[i].depth_cm;
      rate = dt > 0 ? dd / dt : 0;
    } else if (i === readings.length - 1) {
      // Backward difference
      const dt = (readings[i].timestamp - readings[i - 1].timestamp) / 60;
      const dd = readings[i].depth_cm - readings[i - 1].depth_cm;
      rate = dt > 0 ? dd / dt : 0;
    } else {
      // Centered difference (more accurate)
      const dt = (readings[i + 1].timestamp - readings[i - 1].timestamp) / 60;
      const dd = readings[i + 1].depth_cm - readings[i - 1].depth_cm;
      rate = dt > 0 ? dd / dt : 0;
    }

    rates.push({
      timestamp: readings[i].timestamp,
      depth_cm: readings[i].depth_cm,
      depth_rate_cm_per_min: rate,
    });
  }

  return rates;
}

/**
 * Derive gallons-per-cm at each depth level from multiple clean segments.
 *
 * Theory: if the ditch fills at constant GPM, then:
 *   GPM = gallons_per_cm(depth) × depth_rate_cm_per_min(depth)
 *
 * Since GPM is constant during a segment:
 *   gallons_per_cm(depth) ∝ 1 / depth_rate_cm_per_min(depth)
 *
 * We bin readings by depth (1cm bins), average the inverse rates, then
 * integrate to get cumulative gallons.
 */
function deriveGallonsPerCm(segments) {
  // Bin all readings by depth (1cm resolution)
  const depthBins = new Map(); // depth_cm → array of inverse rates

  for (const seg of segments) {
    const rates = computeDepthRates(seg.readings);

    for (const r of rates) {
      if (r.depth_rate_cm_per_min <= 0) continue; // skip non-rising points

      const depthBin = Math.floor(r.depth_cm);
      const inverseRate = 1 / r.depth_rate_cm_per_min; // proportional to gal/cm

      if (!depthBins.has(depthBin)) {
        depthBins.set(depthBin, []);
      }
      depthBins.get(depthBin).push(inverseRate);
    }
  }

  // Average inverse rates per bin
  const avgInverseRates = new Map();
  for (const [depth, inverseRates] of depthBins.entries()) {
    const avg = inverseRates.reduce((s, v) => s + v, 0) / inverseRates.length;
    avgInverseRates.set(depth, avg);
  }

  // Fill gaps with linear interpolation
  const maxDepth = Math.ceil(FULL_WATER_DEPTH_CM);
  const smoothedRates = [];

  for (let d = 0; d <= maxDepth; d++) {
    if (avgInverseRates.has(d)) {
      smoothedRates.push(avgInverseRates.get(d));
    } else {
      // Interpolate from nearest neighbors
      let below = null, above = null;
      for (let offset = 1; offset <= 20; offset++) {
        if (below === null && avgInverseRates.has(d - offset)) below = { depth: d - offset, rate: avgInverseRates.get(d - offset) };
        if (above === null && avgInverseRates.has(d + offset)) above = { depth: d + offset, rate: avgInverseRates.get(d + offset) };
        if (below && above) break;
      }

      if (below && above) {
        const frac = (d - below.depth) / (above.depth - below.depth);
        smoothedRates.push(below.rate + frac * (above.rate - below.rate));
      } else if (below) {
        smoothedRates.push(below.rate);
      } else if (above) {
        smoothedRates.push(above.rate);
      } else {
        smoothedRates.push(1.0); // fallback
      }
    }
  }

  return smoothedRates; // array indexed by depth_cm
}

/**
 * Integrate gallons-per-cm curve to get cumulative depth→gallons table.
 * Anchor to RATED_FULL_GALLONS at FULL_WATER_DEPTH_CM.
 */
function buildStrappingTable(gallonsPerCmCurve) {
  const maxDepth = Math.ceil(FULL_WATER_DEPTH_CM);

  // Cumulative integration (trapezoidal rule)
  const cumulative = [0];
  for (let i = 1; i <= maxDepth; i++) {
    const avgGalPerCm = (gallonsPerCmCurve[i - 1] + gallonsPerCmCurve[i]) / 2;
    cumulative.push(cumulative[i - 1] + avgGalPerCm);
  }

  // Anchor: scale so cumulative[FULL_WATER_DEPTH_CM] = RATED_FULL_GALLONS
  const anchorIdx = Math.round(FULL_WATER_DEPTH_CM);
  const scaleFactor = RATED_FULL_GALLONS / cumulative[anchorIdx];

  const scaled = cumulative.map(g => g * scaleFactor);

  // Build table in inches (1" resolution, 0..41")
  const table = [];
  for (let depthIn = 0; depthIn <= FULL_WATER_DEPTH_IN; depthIn++) {
    const depthCm = depthIn * 2.54;
    const idxLo = Math.floor(depthCm);
    const idxHi = Math.ceil(depthCm);
    const frac = depthCm - idxLo;

    const gallons = idxLo === idxHi
      ? scaled[idxLo]
      : scaled[idxLo] + frac * (scaled[idxHi] - scaled[idxLo]);

    table.push([depthIn, Math.round(gallons)]);
  }

  return table;
}

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

/**
 * Convert depth (cm) to gallons using a given strapping table.
 */
function depthCmToGallons(depthCm, table) {
  const depthIn = depthCm / 2.54;

  // Find bracketing rows
  for (let i = 0; i < table.length - 1; i++) {
    const [d0, g0] = table[i];
    const [d1, g1] = table[i + 1];
    if (depthIn >= d0 && depthIn <= d1) {
      const frac = (depthIn - d0) / (d1 - d0);
      return g0 + frac * (g1 - g0);
    }
  }

  // Out of range — clamp
  if (depthIn <= table[0][0]) return table[0][1];
  return table[table.length - 1][1];
}

/**
 * Validate table by computing fill rate consistency across segments.
 * Returns { avgGPM, minGPM, maxGPM, spreadPct }.
 */
function validateTable(segments, table) {
  const fillRates = [];

  for (const seg of segments) {
    const readings = seg.readings;
    if (readings.length < 2) continue;

    const startGal = depthCmToGallons(readings[0].depth_cm, table);
    const endGal = depthCmToGallons(readings[readings.length - 1].depth_cm, table);
    const durationMin = (readings[readings.length - 1].timestamp - readings[0].timestamp) / 60;

    const gpm = (endGal - startGal) / durationMin;
    fillRates.push({ segment: seg, gpm });
  }

  if (fillRates.length === 0) {
    return { avgGPM: 0, minGPM: 0, maxGPM: 0, spreadPct: 0 };
  }

  const gpms = fillRates.map(r => r.gpm);
  const avgGPM = gpms.reduce((s, v) => s + v, 0) / gpms.length;
  const minGPM = Math.min(...gpms);
  const maxGPM = Math.max(...gpms);
  const spreadPct = avgGPM > 0 ? ((maxGPM - minGPM) / avgGPM) * 100 : 0;

  return { avgGPM, minGPM, maxGPM, spreadPct, fillRates };
}

// ──────────────────────────────────────────────
// Main Analysis
// ──────────────────────────────────────────────

async function main() {
  console.log('Tank Strapping Table Refinement');
  console.log('═'.repeat(70));
  console.log();

  // Analyze June 21, 2026 refill event
  // Start at 4:14 PM (16:14) to skip early contamination
  const refillDate = new Date('2026-06-21T16:14:00-07:00'); // Pacific
  const startEpoch = Math.floor(refillDate.getTime() / 1000);
  const endEpoch = startEpoch + (6 * 60 * 60); // 6-hour window (end before midnight)

  console.log(`Analyzing refill event: ${refillDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`);
  console.log(`Time range: ${startEpoch} → ${endEpoch} (epoch seconds)`);
  console.log();

  // Fetch data
  console.log('Fetching sensor data...');
  const tankReadings = await fetchTankReadings(startEpoch, endEpoch);
  console.log(`  ✓ ${tankReadings.length} tank sensor readings`);

  console.log('Fetching zone states (all controllers)...');
  const zoneStates = await fetchZoneStates(startEpoch, endEpoch);
  console.log(`  ✓ ${zoneStates.length} zone state transitions`);
  console.log();

  // Log zone activity detected
  console.log('Zone activity detected:');
  const zoneOnEvents = zoneStates.filter(z => z.state === 'on' || z.state === 1);
  for (const z of zoneOnEvents) {
    const time = new Date(z.timestamp * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    console.log(`  ${time}: ${z.controller} ${z.zone_id} ON`);
  }
  console.log();

  // Find clean fill segments
  console.log('Finding clean fill segments (no valve activity)...');
  const segments = findCleanFillSegments(tankReadings, zoneStates);
  console.log(`  ✓ Found ${segments.length} clean segments`);
  console.log();

  if (segments.length === 0) {
    console.log('⚠️  No clean fill segments found. Cannot derive table.');
    console.log('   Try a different time range with uninterrupted fill.');
    return;
  }

  // Print segment summary
  console.log('Clean Fill Segments:');
  console.log('─'.repeat(70));
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const startTime = new Date(s.startTime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    const endTime = new Date(s.endTime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    const durationMin = Math.round(s.duration / 60);
    console.log(`  Segment ${i + 1}: ${startTime} → ${endTime} (${durationMin} min)`);
    console.log(`    Depth: ${s.startDepth.toFixed(1)} → ${s.endDepth.toFixed(1)} cm`);
    console.log(`    Readings: ${s.readings.length}`);
  }
  console.log();

  // Derive gallons-per-cm curve
  console.log('Deriving gallons-per-cm curve from segment data...');
  const gallonsPerCmCurve = deriveGallonsPerCm(segments);
  console.log(`  ✓ Computed for depth range 0 → ${gallonsPerCmCurve.length - 1} cm`);
  console.log();

  // Build new strapping table
  console.log('Building empirical strapping table (anchored to 1725 gal @ 41")...');
  const newTable = buildStrappingTable(gallonsPerCmCurve);
  console.log(`  ✓ Table built: ${newTable.length} rows (0" → ${FULL_WATER_DEPTH_IN}")`);
  console.log();

  // Validation: before vs after fill-rate consistency
  console.log('Validation: Fill Rate Consistency');
  console.log('─'.repeat(70));

  const oldValidation = validateTable(segments, OLD_TABLE);
  const newValidation = validateTable(segments, newTable);

  console.log('BEFORE (modeled ellipse table):');
  console.log(`  Avg fill rate: ${oldValidation.avgGPM.toFixed(2)} GPM`);
  console.log(`  Range: ${oldValidation.minGPM.toFixed(2)} → ${oldValidation.maxGPM.toFixed(2)} GPM`);
  console.log(`  Spread: ${oldValidation.spreadPct.toFixed(1)}% of average`);
  console.log();

  console.log('AFTER (empirical table):');
  console.log(`  Avg fill rate: ${newValidation.avgGPM.toFixed(2)} GPM`);
  console.log(`  Range: ${newValidation.minGPM.toFixed(2)} → ${newValidation.maxGPM.toFixed(2)} GPM`);
  console.log(`  Spread: ${newValidation.spreadPct.toFixed(1)}% of average`);
  console.log();

  const improvement = oldValidation.spreadPct - newValidation.spreadPct;
  console.log(`  ✓ Spread improvement: ${improvement.toFixed(1)}% (${improvement > 0 ? 'better' : 'worse'})`);
  console.log();

  // Per-segment fill rates
  console.log('Per-Segment Fill Rates:');
  console.log('─'.repeat(70));
  for (let i = 0; i < segments.length; i++) {
    const oldGPM = oldValidation.fillRates[i].gpm;
    const newGPM = newValidation.fillRates[i].gpm;
    const s = segments[i];
    const startTime = new Date(s.startTime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });

    console.log(`  Segment ${i + 1} (${startTime}, ${s.startDepth.toFixed(0)}→${s.endDepth.toFixed(0)} cm):`);
    console.log(`    Old: ${oldGPM.toFixed(2)} GPM | New: ${newGPM.toFixed(2)} GPM`);
  }
  console.log();

  // Compare tables at key depths
  console.log('Table Comparison (gallons at key depths):');
  console.log('─'.repeat(70));
  console.log('Depth (in) | Old (gal) | New (gal) | Delta (gal) | Delta (%)');
  console.log('─'.repeat(70));

  const keyDepths = [0, 5, 10, 15, 20, 25, 30, 35, 40, 41];
  for (const d of keyDepths) {
    const oldGal = OLD_TABLE[d][1];
    const newGal = newTable[d][1];
    const delta = newGal - oldGal;
    const deltaPct = oldGal > 0 ? (delta / oldGal) * 100 : 0;

    console.log(`${d.toString().padStart(10)} | ${oldGal.toString().padStart(9)} | ${newGal.toString().padStart(9)} | ${delta.toString().padStart(11)} | ${deltaPct.toFixed(1).padStart(9)}%`);
  }
  console.log();

  // Output new table as code
  console.log('New Empirical Strapping Table (JavaScript):');
  console.log('─'.repeat(70));
  console.log('const EMPIRICAL_STRAPPING_TABLE = [');
  for (let i = 0; i < newTable.length; i++) {
    const [d, g] = newTable[i];
    const line = `  [${d}, ${g}],`;
    console.log(line + (i % 5 === 4 ? '' : '').padEnd(20 - line.length));
  }
  console.log('];');
  console.log();

  console.log('═'.repeat(70));
  console.log('Analysis complete. Review validation results before adopting table.');
}

// Run
main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
