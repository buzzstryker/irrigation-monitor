/**
 * debug-neighbor-detection.js — Debug why the 13:48 dip isn't detected
 */

'use strict';

const { supabase } = require('../db');

const NEIGHBOR_SUB_WINDOW_MINUTES = 5;
const NEIGHBOR_DIP_THRESHOLD = 0.70;
const BASELINE_GPM = 7.3;

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;

  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const sumY2 = points.reduce((s, p) => s + p.y * p.y, 0);

  const denominator = (n * sumX2 - sumX * sumX);
  if (Math.abs(denominator) < 1e-10) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  const ssTotal = points.reduce((s, p) => s + Math.pow(p.y - meanY, 2), 0);
  const ssRes = points.reduce((s, p) => {
    const predicted = slope * p.x + intercept;
    return s + Math.pow(p.y - predicted, 2);
  }, 0);
  const r2 = ssTotal > 0 ? 1 - (ssRes / ssTotal) : 0;

  const fill_gpm = slope * 60;

  return { slope, intercept, r2, fill_gpm };
}

async function debugDipDetection() {
  console.log('[DEBUG] Analyzing 13:30–14:15 window for neighbor-draw detection...\n');

  const windowStart = Math.floor(new Date('2026-06-22T13:30:00-07:00').getTime() / 1000);
  const windowEnd = Math.floor(new Date('2026-06-22T14:15:00-07:00').getTime() / 1000);

  const { data: tankReadings, error } = await supabase
    .from('tank_sensor_log')
    .select('timestamp, level_gallons')
    .gte('timestamp', windowStart)
    .lte('timestamp', windowEnd)
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('Error fetching tank readings:', error.message);
    return;
  }

  console.log(`[DEBUG] Fetched ${tankReadings.length} tank readings\n`);

  const subWindowSeconds = NEIGHBOR_SUB_WINDOW_MINUTES * 60;
  const rollingRates = [];

  console.log('[DEBUG] Computing rolling 10-min fill rates...\n');

  for (let i = 0; i < tankReadings.length; i++) {
    const subStart = tankReadings[i].timestamp;
    const subEnd = subStart + subWindowSeconds;

    const subPoints = tankReadings.filter(r =>
      r.timestamp >= subStart && r.timestamp <= subEnd
    );

    if (subPoints.length < 3) continue;

    const points = subPoints.map(r => ({ x: r.timestamp, y: r.level_gallons }));
    const regr = linearRegression(points);

    if (regr && regr.r2 >= 0.85) {
      const startTime = new Date(subStart * 1000);
      const endTime = new Date(subEnd * 1000);
      const isDipping = regr.fill_gpm < (BASELINE_GPM * NEIGHBOR_DIP_THRESHOLD);

      rollingRates.push({
        timestamp: subStart,
        fill_gpm: regr.fill_gpm,
        r2: regr.r2,
        sample_count: subPoints.length,
        isDipping,
      });

      console.log(
        startTime.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }),
        '–',
        endTime.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }),
        '|',
        regr.fill_gpm.toFixed(2),
        'GPM | R²',
        regr.r2.toFixed(3),
        '|',
        subPoints.length,
        'pts',
        isDipping ? '🔻 DIP' : ''
      );
    }
  }

  console.log(`\n[DEBUG] Found ${rollingRates.length} qualifying rolling windows`);
  console.log(`[DEBUG] Threshold: ${(BASELINE_GPM * NEIGHBOR_DIP_THRESHOLD).toFixed(2)} GPM (70% of ${BASELINE_GPM} GPM baseline)\n`);

  const dippingWindows = rollingRates.filter(r => r.isDipping);
  console.log(`[DEBUG] Windows below threshold: ${dippingWindows.length}`);

  if (dippingWindows.length > 0) {
    console.log('\n[DEBUG] Dipping windows:');
    dippingWindows.forEach(w => {
      const t = new Date(w.timestamp * 1000);
      console.log(
        ' -',
        t.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }),
        '|',
        w.fill_gpm.toFixed(2),
        'GPM'
      );
    });
  }
}

debugDipDetection().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
