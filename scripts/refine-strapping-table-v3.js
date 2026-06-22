/**
 * refine-strapping-table-v3.js
 * ------------------------------------------------------------------
 * Third iteration: fix boundary agreement and eliminate smoothing kinks.
 *
 * CHANGES from v2:
 * - Use GLOBAL fit instead of per-segment binning (eliminates boundary discontinuity)
 * - Assume constant GPM across ALL segments simultaneously
 * - Solve for the single best-fit gallons-per-cm curve that minimizes
 *   error across all observations
 * - Apply stronger smoothing (7-point Savitzky-Golay) to eliminate kinks
 * ------------------------------------------------------------------
 */

'use strict';

require('dotenv').config();
const { supabase } = require('../db');
const { STRAPPING_TABLE: OLD_TABLE } = require('../tank-strapping');

const FULL_WATER_DEPTH_IN = 41.0;
const FULL_WATER_DEPTH_CM = 104.14;
const RATED_FULL_GALLONS = 1725;
const CM_PER_METER = 100;

// ──────────────────────────────────────────────
// Data Fetching (same as v2)
// ──────────────────────────────────────────────

async function fetchTankReadings(startEpoch, endEpoch) {
  const { data, error } = await supabase
    .from('tank_sensor_log')
    .select('timestamp, depth_meters')
    .gte('timestamp', startEpoch)
    .lte('timestamp', endEpoch)
    .order('timestamp', { ascending: true });

  if (error) throw new Error(`Failed to fetch tank_sensor_log: ${error.message}`);

  return data.map(r => ({
    timestamp: r.timestamp,
    depth_cm: r.depth_meters * CM_PER_METER,
  }));
}

async function fetchZoneStates(startEpoch, endEpoch) {
  const { data, error } = await supabase
    .from('zone_state_log')
    .select('timestamp, controller, zone_id, state')
    .gte('timestamp', startEpoch)
    .lte('timestamp', endEpoch)
    .order('timestamp', { ascending: true});

  if (error) throw new Error(`Failed to fetch zone_state_log: ${error.message}`);
  return data;
}

function findCleanFillSegments(tankReadings, zoneStates, minSegmentSeconds = 30 * 60, minDepthRise = 5) {
  const valveActiveTimes = new Set();
  let activeZones = new Map();

  for (const z of zoneStates) {
    const key = `${z.controller}:${z.zone_id}`;
    if (z.state === 'on' || z.state === 1) {
      activeZones.set(key, z.timestamp);
    } else if (z.state === 'off' || z.state === 0) {
      const onTime = activeZones.get(key);
      if (onTime) {
        for (let t = onTime; t <= z.timestamp; t++) {
          valveActiveTimes.add(t);
        }
        activeZones.delete(key);
      }
    }
  }

  const segments = [];
  let segmentStart = null;
  let prevReading = null;

  for (let i = 0; i < tankReadings.length; i++) {
    const reading = tankReadings[i];
    const isValveActive = valveActiveTimes.has(reading.timestamp);
    const isMonotonic = !prevReading || reading.depth_cm >= prevReading.depth_cm;

    if (!isValveActive && isMonotonic) {
      if (!segmentStart) segmentStart = i;
    } else {
      if (segmentStart !== null && i > segmentStart) {
        const start = tankReadings[segmentStart];
        const end = tankReadings[i - 1];
        const duration = end.timestamp - start.timestamp;
        const depthRise = end.depth_cm - start.depth_cm;

        if (duration >= minSegmentSeconds && depthRise >= minDepthRise) {
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
    const depthRise = end.depth_cm - start.depth_cm;

    if (duration >= minSegmentSeconds && depthRise >= minDepthRise) {
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
// GLOBAL FIT: Solve for single best-fit curve
// ──────────────────────────────────────────────

/**
 * Derive gallons-per-cm using GLOBAL fit across all segments.
 * Assumes a single constant GPM across all segments, solves for the
 * gallons-per-cm curve that minimizes total error.
 */
function deriveGlobalGallonsPerCm(segments) {
  const maxDepth = Math.ceil(FULL_WATER_DEPTH_CM);
  const depthBins = Array(maxDepth + 1).fill(null).map(() => []);

  // Collect all depth-rate observations across ALL segments
  for (const seg of segments) {
    const readings = seg.readings;
    for (let i = 0; i < readings.length - 1; i++) {
      const r0 = readings[i];
      const r1 = readings[i + 1];
      const dt = (r1.timestamp - r0.timestamp) / 60; // minutes
      const dd = r1.depth_cm - r0.depth_cm;

      if (dd <= 0 || dt <= 0) continue;

      const depthBin = Math.floor(r0.depth_cm);
      if (depthBin < 0 || depthBin > maxDepth) continue;

      const depthRate = dd / dt; // cm/min
      const galPerCm = 1 / depthRate; // relative units

      depthBins[depthBin].push(galPerCm);
    }
  }

  // Average per bin
  const rawGalPerCm = depthBins.map(bin => {
    if (bin.length === 0) return 0;
    return bin.reduce((s, v) => s + v, 0) / bin.length;
  });

  // Fill gaps with linear interpolation
  for (let d = 0; d <= maxDepth; d++) {
    if (rawGalPerCm[d] === 0) {
      let below = null, above = null;
      for (let offset = 1; offset <= 20; offset++) {
        if (below === null && d - offset >= 0 && rawGalPerCm[d - offset] > 0) {
          below = { depth: d - offset, val: rawGalPerCm[d - offset] };
        }
        if (above === null && d + offset <= maxDepth && rawGalPerCm[d + offset] > 0) {
          above = { depth: d + offset, val: rawGalPerCm[d + offset] };
        }
        if (below && above) break;
      }

      if (below && above) {
        const frac = (d - below.depth) / (above.depth - below.depth);
        rawGalPerCm[d] = below.val + frac * (above.val - below.val);
      } else if (below) {
        rawGalPerCm[d] = below.val;
      } else if (above) {
        rawGalPerCm[d] = above.val;
      } else {
        rawGalPerCm[d] = 1.0; // fallback
      }
    }
  }

  // Apply STRONGER smoothing: 7-point Savitzky-Golay
  const smoothed = [...rawGalPerCm];
  for (let d = 3; d <= maxDepth - 3; d++) {
    // 7-point quadratic Savitzky-Golay coefficients: [-2, 3, 6, 7, 6, 3, -2] / 21
    const sum = -2*rawGalPerCm[d-3] + 3*rawGalPerCm[d-2] + 6*rawGalPerCm[d-1] +
                7*rawGalPerCm[d] +
                6*rawGalPerCm[d+1] + 3*rawGalPerCm[d+2] + -2*rawGalPerCm[d+3];
    smoothed[d] = sum / 21;
  }

  // Edge handling (keep first/last 3 points as-is to avoid extrapolation artifacts)
  for (let d = 0; d < 3; d++) smoothed[d] = rawGalPerCm[d];
  for (let d = maxDepth - 2; d <= maxDepth; d++) smoothed[d] = rawGalPerCm[d];

  return smoothed;
}

function buildStrappingTable(gallonsPerCmCurve) {
  const maxDepth = Math.ceil(FULL_WATER_DEPTH_CM);

  // Cumulative integration
  const cumulative = [0];
  for (let i = 1; i <= maxDepth; i++) {
    const avgGalPerCm = (gallonsPerCmCurve[i - 1] + gallonsPerCmCurve[i]) / 2;
    cumulative.push(cumulative[i - 1] + avgGalPerCm);
  }

  // Anchor to 1725 gal at full depth
  const anchorIdx = Math.round(FULL_WATER_DEPTH_CM);
  const scaleFactor = RATED_FULL_GALLONS / cumulative[anchorIdx];
  const scaled = cumulative.map(g => g * scaleFactor);

  // Build table in inches
  const table = [];
  for (let depthIn = 0; depthIn <= FULL_WATER_DEPTH_IN; depthIn++) {
    const depthCm = depthIn * 2.54;
    const idxLo = Math.floor(depthCm);
    const idxHi = Math.ceil(depthCm);
    const frac = depthCm - idxLo;

    const gallons = idxLo === idxHi ? scaled[idxLo] : scaled[idxLo] + frac * (scaled[idxHi] - scaled[idxLo]);
    table.push([depthIn, Math.round(gallons)]);
  }

  return table;
}

// ──────────────────────────────────────────────
// Validation (same as v2)
// ──────────────────────────────────────────────

function depthCmToGallons(depthCm, table) {
  const depthIn = depthCm / 2.54;

  for (let i = 0; i < table.length - 1; i++) {
    const [d0, g0] = table[i];
    const [d1, g1] = table[i + 1];
    if (depthIn >= d0 && depthIn <= d1) {
      const frac = (depthIn - d0) / (d1 - d0);
      return g0 + frac * (g1 - g0);
    }
  }

  if (depthIn <= table[0][0]) return table[0][1];
  return table[table.length - 1][1];
}

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
    return { avgGPM: 0, minGPM: 0, maxGPM: 0, spreadPct: 0, fillRates: [] };
  }

  const gpms = fillRates.map(r => r.gpm);
  const avgGPM = gpms.reduce((s, v) => s + v, 0) / gpms.length;
  const minGPM = Math.min(...gpms);
  const maxGPM = Math.max(...gpms);
  const spreadPct = avgGPM > 0 ? ((maxGPM - minGPM) / avgGPM) * 100 : 0;

  return { avgGPM, minGPM, maxGPM, spreadPct, fillRates };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('Tank Strapping Table Refinement (v3 — global fit + stronger smoothing)');
  console.log('═'.repeat(70));
  console.log();

  const refillDate = new Date('2026-06-21T16:14:00-07:00');
  const startEpoch = Math.floor(refillDate.getTime() / 1000);
  const endEpoch = startEpoch + (6 * 60 * 60);

  console.log(`Analyzing refill event: ${refillDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`);
  console.log(`Time range: ${startEpoch} → ${endEpoch} (epoch seconds)`);
  console.log();

  console.log('Fetching sensor data...');
  const tankReadings = await fetchTankReadings(startEpoch, endEpoch);
  console.log(`  ✓ ${tankReadings.length} tank sensor readings`);

  console.log('Fetching zone states (all controllers)...');
  const zoneStates = await fetchZoneStates(startEpoch, endEpoch);
  console.log(`  ✓ ${zoneStates.length} zone state transitions`);
  console.log();

  console.log('Zone activity detected:');
  const zoneOnEvents = zoneStates.filter(z => z.state === 'on' || z.state === 1);
  for (const z of zoneOnEvents) {
    const time = new Date(z.timestamp * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    console.log(`  ${time}: ${z.controller} ${z.zone_id} ON`);
  }
  if (zoneOnEvents.length === 0) console.log('  (none)');
  console.log();

  console.log('Finding clean fill segments (no valve, ≥5cm rise, ≥30 min)...');
  const segments = findCleanFillSegments(tankReadings, zoneStates, 30 * 60, 5);
  console.log(`  ✓ Found ${segments.length} qualifying segments`);
  console.log();

  if (segments.length === 0) {
    console.log('⚠️  No qualifying segments. Cannot derive table.');
    return;
  }

  console.log('Clean Fill Segments:');
  console.log('─'.repeat(70));
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const startTime = new Date(s.startTime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    const endTime = new Date(s.endTime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    const durationMin = Math.round(s.duration / 60);
    console.log(`  Segment ${i + 1}: ${startTime} → ${endTime} (${durationMin} min)`);
    console.log(`    Depth: ${s.startDepth.toFixed(1)} → ${s.endDepth.toFixed(1)} cm (${(s.endDepth - s.startDepth).toFixed(1)} cm rise)`);
    console.log(`    Readings: ${s.readings.length}`);
  }
  console.log();

  console.log('Deriving GLOBAL gallons-per-cm curve (7-point Savitzky-Golay smoothing)...');
  const gallonsPerCmCurve = deriveGlobalGallonsPerCm(segments);
  console.log(`  ✓ Computed for depth range 0 → ${gallonsPerCmCurve.length - 1} cm`);
  console.log();

  console.log('Building empirical strapping table (anchored to 1725 gal @ 41")...');
  const newTable = buildStrappingTable(gallonsPerCmCurve);
  console.log(`  ✓ Table built: ${newTable.length} rows (0" → ${FULL_WATER_DEPTH_IN}")`);
  console.log();

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
  console.log(`  ✓ Spread improvement: ${improvement.toFixed(1)}% ${improvement > 0 ? '(better)' : '(worse)'}`);
  console.log();

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

  console.log('New Empirical Strapping Table (JavaScript):');
  console.log('─'.repeat(70));
  console.log('const EMPIRICAL_STRAPPING_TABLE = [');
  for (let i = 0; i < newTable.length; i++) {
    const [d, g] = newTable[i];
    const comma = i === newTable.length - 1 ? '' : ',';
    console.log(`  [${d}, ${g}]${comma}`);
  }
  console.log('];');
  console.log();

  console.log('═'.repeat(70));
  console.log('Analysis complete. Run validate-empirical-table.js to check boundary agreement.');
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
