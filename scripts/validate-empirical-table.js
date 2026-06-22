/**
 * validate-empirical-table.js
 * ------------------------------------------------------------------
 * Three validation checks before adopting the empirical strapping table:
 *
 * 1. SEGMENT-BOUNDARY AGREEMENT: Check gallons-per-cm agreement in the
 *    overlap region (63-68cm) where the two segments meet.
 *
 * 2. MONOTONICITY + SANITY: Verify monotonic increasing and flag any
 *    level where gallons-per-cm differs >25% from neighbors (smoothing kinks).
 *
 * 3. MAY MEASUREMENT RE-DERIVATION: Find May 2026 fill data, re-compute
 *    through the NEW table, check if it brings 5.77 GPM closer to 7.26 GPM.
 * ------------------------------------------------------------------
 */

'use strict';

require('dotenv').config();
const { supabase } = require('../db');
// Using v3 table (run refine-strapping-table-v3.js to regenerate)
const EMPIRICAL_TABLE = [
  [0, 0], [1, 18], [2, 36], [3, 53], [4, 71], [5, 89], [6, 107], [7, 124],
  [8, 142], [9, 160], [10, 178], [11, 195], [12, 251], [13, 310], [14, 352],
  [15, 400], [16, 457], [17, 504], [18, 548], [19, 593], [20, 637], [21, 681],
  [22, 728], [23, 769], [24, 816], [25, 862], [26, 910], [27, 951], [28, 996],
  [29, 1040], [30, 1085], [31, 1130], [32, 1174], [33, 1218], [34, 1263],
  [35, 1303], [36, 1375], [37, 1430], [38, 1465], [39, 1508], [40, 1595], [41, 1733]
];

const { STRAPPING_TABLE: OLD_TABLE } = require('../tank-strapping');

const CM_PER_METER = 100;
const FULL_WATER_DEPTH_CM = 104.14;

// ──────────────────────────────────────────────
// Data Fetching (from refine-strapping-table-v2.js)
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
    .order('timestamp', { ascending: true });

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
// CHECK 1: Segment-Boundary Agreement
// ──────────────────────────────────────────────

/**
 * Compute gallons-per-cm from a single segment.
 * Returns a Map: depth_cm → gallons_per_cm (relative units).
 */
function computeSegmentGallonsPerCm(segment) {
  const depthBins = new Map();
  const readings = segment.readings;

  for (let i = 0; i < readings.length - 1; i++) {
    const r0 = readings[i];
    const r1 = readings[i + 1];
    const dt = (r1.timestamp - r0.timestamp) / 60; // minutes
    const dd = r1.depth_cm - r0.depth_cm;

    if (dd <= 0 || dt <= 0) continue;

    const depthBin = Math.floor(r0.depth_cm);
    const depthRate = dd / dt; // cm/min
    const galPerCm = 1 / depthRate; // relative units (proportional to true gal/cm)

    if (!depthBins.has(depthBin)) {
      depthBins.set(depthBin, []);
    }
    depthBins.get(depthBin).push(galPerCm);
  }

  // Average per bin
  const avgGalPerCm = new Map();
  for (const [depth, values] of depthBins.entries()) {
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    avgGalPerCm.set(depth, avg);
  }

  return avgGalPerCm;
}

function checkBoundaryAgreement(segments) {
  console.log('CHECK 1: Segment-Boundary Agreement');
  console.log('─'.repeat(70));

  if (segments.length < 2) {
    console.log('⚠️  Only 1 segment — no boundary to check');
    return true;
  }

  const seg1 = segments[0];
  const seg2 = segments[1];

  const seg1GalPerCm = computeSegmentGallonsPerCm(seg1);
  const seg2GalPerCm = computeSegmentGallonsPerCm(seg2);

  // Find overlap region
  const overlapStart = Math.max(Math.floor(seg1.startDepth), Math.floor(seg2.startDepth));
  const overlapEnd = Math.min(Math.ceil(seg1.endDepth), Math.ceil(seg2.endDepth));

  console.log(`Segment 1: ${seg1.startDepth.toFixed(0)} → ${seg1.endDepth.toFixed(0)} cm`);
  console.log(`Segment 2: ${seg2.startDepth.toFixed(0)} → ${seg2.endDepth.toFixed(0)} cm`);
  console.log(`Overlap region: ${overlapStart} → ${overlapEnd} cm`);
  console.log();

  if (overlapStart >= overlapEnd) {
    console.log('⚠️  No overlap — segments don\'t cover the same depths');
    return false;
  }

  console.log('Depth (cm) | Seg1 gal/cm | Seg2 gal/cm | Ratio | Agreement');
  console.log('─'.repeat(70));

  let totalDeviation = 0;
  let count = 0;
  let maxDeviation = 0;
  let maxDeviationDepth = 0;

  for (let d = overlapStart; d <= overlapEnd; d++) {
    const val1 = seg1GalPerCm.get(d);
    const val2 = seg2GalPerCm.get(d);

    if (!val1 || !val2) continue;

    const ratio = val2 / val1;
    const deviationPct = Math.abs(ratio - 1) * 100;

    const status = deviationPct < 10 ? '✓ Good' : deviationPct < 25 ? '⚠️ Marginal' : '❌ Poor';

    console.log(`${d.toString().padStart(10)} | ${val1.toFixed(4).padStart(11)} | ${val2.toFixed(4).padStart(11)} | ${ratio.toFixed(3).padStart(5)} | ${deviationPct.toFixed(1).padStart(5)}% ${status}`);

    totalDeviation += deviationPct;
    count++;

    if (deviationPct > maxDeviation) {
      maxDeviation = deviationPct;
      maxDeviationDepth = d;
    }
  }

  const avgDeviation = count > 0 ? totalDeviation / count : 0;

  console.log();
  console.log(`Overlap statistics:`);
  console.log(`  Avg deviation: ${avgDeviation.toFixed(1)}%`);
  console.log(`  Max deviation: ${maxDeviation.toFixed(1)}% at ${maxDeviationDepth}cm`);
  console.log(`  Verdict: ${avgDeviation < 10 ? '✅ GOOD' : avgDeviation < 25 ? '⚠️ MARGINAL' : '❌ POOR'} (avg < 10% is good)`);
  console.log();

  return avgDeviation < 25;
}

// ──────────────────────────────────────────────
// CHECK 2: Monotonicity + Sanity
// ──────────────────────────────────────────────

function checkMonotonicityAndSanity(table) {
  console.log('CHECK 2: Monotonicity + Sanity');
  console.log('─'.repeat(70));

  // Check monotonic increasing
  let isMonotonic = true;
  const violations = [];

  for (let i = 0; i < table.length - 1; i++) {
    const [d0, g0] = table[i];
    const [d1, g1] = table[i + 1];

    if (g1 <= g0) {
      isMonotonic = false;
      violations.push({ depth: d1, gallons: g1, prev: g0 });
    }
  }

  console.log(`Monotonic increasing: ${isMonotonic ? '✅ PASS' : '❌ FAIL'}`);
  if (!isMonotonic) {
    console.log('Violations:');
    for (const v of violations) {
      console.log(`  ${v.depth}" → ${v.gallons} gal (prev: ${v.prev} gal)`);
    }
  }
  console.log();

  // Check gallons-per-inch deltas (sanity: flag >25% jumps vs neighbors)
  console.log('Gallons-per-inch deltas (flagging >25% jumps):');
  console.log('Depth (in) | Gal/in | Prev | Next | Vs Prev | Vs Next | Status');
  console.log('─'.repeat(70));

  const galPerIn = [];
  for (let i = 0; i < table.length - 1; i++) {
    const [d0, g0] = table[i];
    const [d1, g1] = table[i + 1];
    galPerIn.push({ depth: d0, rate: g1 - g0 });
  }

  const kinks = [];

  for (let i = 0; i < galPerIn.length; i++) {
    const curr = galPerIn[i];
    const prev = i > 0 ? galPerIn[i - 1] : null;
    const next = i < galPerIn.length - 1 ? galPerIn[i + 1] : null;

    const vsPrevPct = prev ? Math.abs(curr.rate - prev.rate) / prev.rate * 100 : 0;
    const vsNextPct = next ? Math.abs(curr.rate - next.rate) / next.rate * 100 : 0;

    const maxDelta = Math.max(vsPrevPct, vsNextPct);
    const status = maxDelta > 25 ? '⚠️ KINK' : maxDelta > 15 ? '△ Jump' : '✓';

    if (maxDelta > 25) {
      kinks.push({ depth: curr.depth, rate: curr.rate, prev: prev?.rate, next: next?.rate, maxDelta });
    }

    // Only print rows with significant jumps or kinks
    if (maxDelta > 15 || i < 5 || i >= galPerIn.length - 5) {
      console.log(`${curr.depth.toString().padStart(10)} | ${curr.rate.toFixed(1).padStart(6)} | ${prev ? prev.rate.toFixed(1).padStart(4) : ' N/A'} | ${next ? next.rate.toFixed(1).padStart(4) : ' N/A'} | ${vsPrevPct.toFixed(1).padStart(7)}% | ${vsNextPct.toFixed(1).padStart(7)}% | ${status}`);
    }
  }

  console.log();
  console.log(`Kinks detected (>25% jump): ${kinks.length}`);
  if (kinks.length > 0) {
    console.log('Kink details:');
    for (const k of kinks) {
      console.log(`  ${k.depth}" → ${k.rate.toFixed(1)} gal/in (prev: ${k.prev?.toFixed(1) || 'N/A'}, next: ${k.next?.toFixed(1) || 'N/A'}, max delta: ${k.maxDelta.toFixed(1)}%)`);
    }
  } else {
    console.log('✅ No kinks detected — table is smooth');
  }
  console.log();

  return isMonotonic && kinks.length === 0;
}

// ──────────────────────────────────────────────
// CHECK 3: May Measurement Re-Derivation
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

async function checkMayMeasurementRederivation() {
  console.log('CHECK 3: May Measurement Re-Derivation');
  console.log('─'.repeat(70));

  // Search for May 2026 fill events
  const mayStart = Math.floor(new Date('2026-05-01T00:00:00-07:00').getTime() / 1000);
  const mayEnd = Math.floor(new Date('2026-06-01T00:00:00-07:00').getTime() / 1000);

  console.log('Searching for May 2026 clean fill events...');

  const tankReadings = await fetchTankReadings(mayStart, mayEnd);
  const zoneStates = await fetchZoneStates(mayStart, mayEnd);

  console.log(`  ✓ ${tankReadings.length} tank sensor readings`);
  console.log(`  ✓ ${zoneStates.length} zone state transitions`);

  if (tankReadings.length === 0) {
    console.log('⚠️  No tank sensor data in May 2026 — cannot re-derive');
    console.log('   (ME201W was likely not installed yet)');
    console.log();
    return;
  }

  const segments = findCleanFillSegments(tankReadings, zoneStates, 30 * 60, 5);
  console.log(`  ✓ Found ${segments.length} clean fill segments in May`);
  console.log();

  if (segments.length === 0) {
    console.log('⚠️  No clean fill segments in May — cannot re-derive');
    console.log('   Try looking at the original May measurement method');
    console.log();
    return;
  }

  // Compute fill rates for May segments using BOTH tables
  console.log('May Fill Segments:');
  console.log('─'.repeat(70));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const startTime = new Date(seg.startTime * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const endTime = new Date(seg.endTime * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

    const readings = seg.readings;
    const durationMin = (readings[readings.length - 1].timestamp - readings[0].timestamp) / 60;

    // Compute using OLD table (what was used in May)
    const startGalOld = depthCmToGallons(readings[0].depth_cm, OLD_TABLE);
    const endGalOld = depthCmToGallons(readings[readings.length - 1].depth_cm, OLD_TABLE);
    const gpmOld = (endGalOld - startGalOld) / durationMin;

    // Compute using NEW empirical table
    const startGalNew = depthCmToGallons(readings[0].depth_cm, EMPIRICAL_TABLE);
    const endGalNew = depthCmToGallons(readings[readings.length - 1].depth_cm, EMPIRICAL_TABLE);
    const gpmNew = (endGalNew - startGalNew) / durationMin;

    console.log(`Segment ${i + 1}: ${startTime} → ${endTime}`);
    console.log(`  Depth: ${seg.startDepth.toFixed(1)} → ${seg.endDepth.toFixed(1)} cm (${durationMin.toFixed(0)} min)`);
    console.log(`  OLD table: ${gpmOld.toFixed(2)} GPM (${startGalOld.toFixed(0)} → ${endGalOld.toFixed(0)} gal)`);
    console.log(`  NEW table: ${gpmNew.toFixed(2)} GPM (${startGalNew.toFixed(0)} → ${endGalNew.toFixed(0)} gal)`);
    console.log(`  Delta: +${(gpmNew - gpmOld).toFixed(2)} GPM (+${((gpmNew - gpmOld) / gpmOld * 100).toFixed(1)}%)`);
    console.log();
  }

  // Average across all May segments
  let sumOld = 0, sumNew = 0;
  for (const seg of segments) {
    const readings = seg.readings;
    const durationMin = (readings[readings.length - 1].timestamp - readings[0].timestamp) / 60;

    const startGalOld = depthCmToGallons(readings[0].depth_cm, OLD_TABLE);
    const endGalOld = depthCmToGallons(readings[readings.length - 1].depth_cm, OLD_TABLE);
    const gpmOld = (endGalOld - startGalOld) / durationMin;

    const startGalNew = depthCmToGallons(readings[0].depth_cm, EMPIRICAL_TABLE);
    const endGalNew = depthCmToGallons(readings[readings.length - 1].depth_cm, EMPIRICAL_TABLE);
    const gpmNew = (endGalNew - startGalNew) / durationMin;

    sumOld += gpmOld;
    sumNew += gpmNew;
  }

  const avgOld = sumOld / segments.length;
  const avgNew = sumNew / segments.length;

  console.log('May Fill Rate Summary:');
  console.log('─'.repeat(70));
  console.log(`  OLD table avg: ${avgOld.toFixed(2)} GPM (what was measured in May)`);
  console.log(`  NEW table avg: ${avgNew.toFixed(2)} GPM (re-derived through empirical table)`);
  console.log(`  Delta: +${(avgNew - avgOld).toFixed(2)} GPM (+${((avgNew - avgOld) / avgOld * 100).toFixed(1)}%)`);
  console.log();
  console.log(`  June empirical avg: 7.26 GPM (from refine-strapping-table-v2.js)`);
  console.log(`  May re-derived → June: ${avgNew.toFixed(2)} → 7.26 (${((7.26 - avgNew) / avgNew * 100).toFixed(1)}% delta)`);
  console.log();

  if (Math.abs(avgNew - 7.26) < Math.abs(avgOld - 7.26)) {
    console.log(`  ✅ CONFIRMS HYPOTHESIS: May re-derived (${avgNew.toFixed(2)}) is closer to June (7.26) than May original (${avgOld.toFixed(2)})`);
    console.log(`     The 5.77 GPM was artificially LOW due to the broken modeled table.`);
  } else {
    console.log(`  ⚠️ HYPOTHESIS NOT CONFIRMED: May re-derived is NOT closer to June`);
    console.log(`     Other factors may be at play (seasonal flow, measurement method).`);
  }
  console.log();
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('Empirical Strapping Table Validation');
  console.log('═'.repeat(70));
  console.log();

  // Fetch June 21 data (same as refinement script)
  const refillDate = new Date('2026-06-21T16:14:00-07:00');
  const startEpoch = Math.floor(refillDate.getTime() / 1000);
  const endEpoch = startEpoch + (6 * 60 * 60);

  console.log(`Loading June 21 refill data (${refillDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })})...`);
  const tankReadings = await fetchTankReadings(startEpoch, endEpoch);
  const zoneStates = await fetchZoneStates(startEpoch, endEpoch);
  const segments = findCleanFillSegments(tankReadings, zoneStates, 30 * 60, 5);
  console.log(`  ✓ ${segments.length} clean segments loaded`);
  console.log();

  // Run checks
  const boundaryOk = checkBoundaryAgreement(segments);
  const tableOk = checkMonotonicityAndSanity(EMPIRICAL_TABLE);

  await checkMayMeasurementRederivation();

  // Final verdict
  console.log('═'.repeat(70));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(70));
  console.log(`  Boundary agreement: ${boundaryOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Monotonicity + sanity: ${tableOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log();

  if (boundaryOk && tableOk) {
    console.log('✅ ALL CHECKS PASS — Table is ready for deployment');
  } else {
    console.log('⚠️ SOME CHECKS FAILED — Review before deploying');
  }
  console.log();
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
