/**
 * ditch-monitor.js — Passive ditch-fill / clog detection (Phase 6)
 *
 * Monitors ditch fill rate by analyzing quiet windows (no valve activity, tank
 * not full) from tank_sensor_log. Detects slowdowns and stoppages by comparing
 * against a rolling baseline. Alerts via warnings table.
 *
 * LOOSE thresholds (60% baseline) absorb ~14% strapping table spread until the
 * table is empirically refined. Will tighten to ~80% after strapping refinement.
 *
 * Season-aware: suppresses all alerts outside ditch season (Apr 15 – Oct 15).
 */

'use strict';

const { supabase } = require('./db');
const { tank, isDitchSeason } = require('./zones.config');

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const MIN_WINDOW_SECONDS = 30 * 60;  // 30 minutes
const MIN_SAMPLE_COUNT = 8;          // At least 8 tank_sensor_log readings
const MIN_R2 = 0.9;                  // Linear fit quality threshold
const TANK_FULL_THRESHOLD = tank.usable_gal * 0.95;  // 95% of usable capacity

// Rolling baseline config
const BASELINE_WINDOW_COUNT = 10;    // Last N qualifying windows for median
const SEED_BASELINE_GPM = 7.5;       // Seed value until enough windows accumulate

// Alert thresholds (LOOSE — absorbs strapping table spread)
const SLOWDOWN_THRESHOLD = 0.60;     // Fire if <60% of baseline
const SLOWDOWN_CONSECUTIVE_COUNT = 3; // Require 3 consecutive slow windows

// Scan config
const SCAN_DAYS = 7;                 // Analyze last 7 days
const WINDOW_DURATIONS = [30, 60, 90, 120]; // Attempt these durations (minutes)

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────

/**
 * Linear regression: returns { slope, intercept, r2, fill_gpm }
 * Slope is in gallons/second; fill_gpm is slope × 60.
 */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;

  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const sumY2 = points.reduce((s, p) => s + p.y * p.y, 0);

  const denominator = (n * sumX2 - sumX * sumX);
  if (Math.abs(denominator) < 1e-10) return null; // Avoid division by zero

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
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

// ──────────────────────────────────────────────
// Qualifying Window Detection
// ──────────────────────────────────────────────

/**
 * Check if a time window is "qualifying" for ditch fill measurement:
 * - No valve activity across ALL three controllers
 * - Tank not near full (< 95% capacity)
 * - Adequate duration (>= 30 min)
 * - Enough sensor readings (>= 8)
 * - Good linear fit (R² >= 0.9)
 * - Positive slope (rising tank)
 *
 * Returns { qualified: true, fill_gpm, r2, sample_count, gal_start, gal_end }
 * or { qualified: false, reason: 'valve_active' | 'tank_full' | ... }
 */
async function checkWindow(windowStart, windowEnd, tankReadings, zoneStates) {
  // Criterion 1: No valve activity
  const activeZones = zoneStates.filter(z =>
    z.timestamp >= windowStart && z.timestamp <= windowEnd && z.state === 1
  );
  if (activeZones.length > 0) {
    return { qualified: false, reason: 'valve_active' };
  }

  // Criterion 2: Adequate duration
  const durationSec = windowEnd - windowStart;
  if (durationSec < MIN_WINDOW_SECONDS) {
    return { qualified: false, reason: 'too_short' };
  }

  // Get tank readings in window
  const windowReadings = tankReadings.filter(r =>
    r.timestamp >= windowStart && r.timestamp <= windowEnd
  );

  // Criterion 3: Enough sensor points
  if (windowReadings.length < MIN_SAMPLE_COUNT) {
    return { qualified: false, reason: 'too_few_samples' };
  }

  // Criterion 4: Tank not near full
  const maxLevel = Math.max(...windowReadings.map(r => r.level_gallons));
  if (maxLevel >= TANK_FULL_THRESHOLD) {
    return { qualified: false, reason: 'tank_full' };
  }

  // Criterion 5: Good linear fit with positive slope
  const points = windowReadings.map(r => ({ x: r.timestamp, y: r.level_gallons }));
  const regr = linearRegression(points);

  if (!regr) {
    return { qualified: false, reason: 'regression_failed' };
  }

  if (regr.r2 < MIN_R2) {
    return { qualified: false, reason: 'poor_fit' };
  }

  if (regr.fill_gpm <= 0) {
    // Negative or zero slope in an otherwise-qualifying window = COMPLETE STOPPAGE
    return { qualified: false, reason: 'negative_slope', isStoppage: true, r2: regr.r2 };
  }

  const gal_start = windowReadings[0].level_gallons;
  const gal_end = windowReadings[windowReadings.length - 1].level_gallons;

  return {
    qualified: true,
    fill_gpm: regr.fill_gpm,
    r2: regr.r2,
    sample_count: windowReadings.length,
    gal_start,
    gal_end,
  };
}

/**
 * Scan for qualifying windows over the last N days.
 * Attempts sliding windows every hour with multiple durations.
 */
async function findQualifyingWindows() {
  const now = Math.floor(Date.now() / 1000);
  const scanStart = now - (SCAN_DAYS * 24 * 60 * 60);

  // Fetch tank readings
  const { data: tankReadings, error: tankErr } = await supabase
    .from('tank_sensor_log')
    .select('timestamp, level_gallons')
    .gte('timestamp', scanStart)
    .order('timestamp', { ascending: true });

  if (tankErr) {
    console.error('[DITCH-MONITOR] Error fetching tank_sensor_log:', tankErr.message);
    return [];
  }

  // Fetch zone states (all three controllers)
  const { data: zoneStates, error: zoneErr } = await supabase
    .from('zone_state_log')
    .select('timestamp, controller, zone_id, state')
    .gte('timestamp', scanStart)
    .order('timestamp', { ascending: true });

  if (zoneErr) {
    console.error('[DITCH-MONITOR] Error fetching zone_state_log:', zoneErr.message);
    return [];
  }

  const qualifyingWindows = [];

  // Sliding window: attempt start times every hour
  const hourStep = 60 * 60;
  for (let start = scanStart; start < now; start += hourStep) {
    for (const durationMin of WINDOW_DURATIONS) {
      const end = start + (durationMin * 60);
      if (end > now) continue;

      const result = await checkWindow(start, end, tankReadings, zoneStates);

      if (result.qualified) {
        qualifyingWindows.push({
          window_start: start,
          window_end: end,
          window_minutes: durationMin,
          fill_gpm: result.fill_gpm,
          fit_r2: result.r2,
          sample_count: result.sample_count,
          gal_start: result.gal_start,
          gal_end: result.gal_end,
        });
      } else if (result.isStoppage) {
        // Track stoppage events separately
        qualifyingWindows.push({
          window_start: start,
          window_end: end,
          window_minutes: durationMin,
          fill_gpm: 0,  // Stopped
          fit_r2: result.r2,
          sample_count: 0,
          gal_start: 0,
          gal_end: 0,
          isStoppage: true,
        });
      }
    }
  }

  return qualifyingWindows;
}

// ──────────────────────────────────────────────
// Baseline Calculation & Alerting
// ──────────────────────────────────────────────

/**
 * Get rolling baseline fill_gpm: median of last N qualifying windows.
 * Seeds with SEED_BASELINE_GPM if not enough windows yet.
 */
async function getRollingBaseline() {
  const { data: recent, error } = await supabase
    .from('ditch_fill_log')
    .select('fill_gpm')
    .order('window_start', { ascending: false })
    .limit(BASELINE_WINDOW_COUNT);

  if (error) {
    console.error('[DITCH-MONITOR] Error fetching baseline:', error.message);
    return SEED_BASELINE_GPM;
  }

  if (!recent || recent.length < 3) {
    // Not enough data yet — use seed
    return SEED_BASELINE_GPM;
  }

  // Median of recent fill_gpm values
  const sorted = recent.map(r => r.fill_gpm).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return median;
}

/**
 * Check for slowdown alert: 3 consecutive windows below 60% of baseline.
 */
async function checkSlowdownAlert(baseline) {
  const { data: recent, error } = await supabase
    .from('ditch_fill_log')
    .select('fill_gpm')
    .order('window_start', { ascending: false })
    .limit(SLOWDOWN_CONSECUTIVE_COUNT);

  if (error || !recent || recent.length < SLOWDOWN_CONSECUTIVE_COUNT) {
    return null; // Not enough windows yet
  }

  const threshold = baseline * SLOWDOWN_THRESHOLD;
  const allSlow = recent.every(r => r.fill_gpm < threshold);

  if (allSlow) {
    const avgRecent = recent.reduce((s, r) => s + r.fill_gpm, 0) / recent.length;
    return {
      type: 'ditch_fill_slowdown',
      message: `Ditch fill rate dropped: ${avgRecent.toFixed(1)} GPM (${SLOWDOWN_CONSECUTIVE_COUNT} consecutive windows) vs baseline ${baseline.toFixed(1)} GPM`,
      avgRecent,
      baseline,
    };
  }

  return null;
}

/**
 * Check for stoppage alert: a qualifying window with zero/negative slope.
 */
async function checkStoppageAlert(windows) {
  const stoppage = windows.find(w => w.isStoppage);
  if (stoppage) {
    return {
      type: 'ditch_fill_stopped',
      message: `Ditch fill STOPPED: tank level flat/falling during quiet window (${stoppage.window_minutes} min, R²=${stoppage.fit_r2.toFixed(2)})`,
      window: stoppage,
    };
  }
  return null;
}

/**
 * Fire alert: insert into warnings table, deduped by type.
 */
async function fireAlert(alert) {
  // Check if this alert type already exists and is unresolved
  const { data: existing, error: checkErr } = await supabase
    .from('warnings')
    .select('id')
    .eq('type', alert.type)
    .eq('resolved', false)
    .limit(1);

  if (checkErr) {
    console.error('[DITCH-MONITOR] Error checking existing alerts:', checkErr.message);
    return;
  }

  if (existing && existing.length > 0) {
    // Alert already fired and not resolved — don't re-fire
    return;
  }

  // Insert new alert
  const { error: insertErr } = await supabase
    .from('warnings')
    .insert({
      type: alert.type,
      message: alert.message,
      resolved: false,
    });

  if (insertErr) {
    console.error('[DITCH-MONITOR] Error inserting alert:', insertErr.message);
  } else {
    console.warn(`[DITCH-MONITOR] 🚨 ALERT: ${alert.message}`);
  }
}

// ──────────────────────────────────────────────
// Main Monitor Loop
// ──────────────────────────────────────────────

/**
 * Run ditch fill monitor: find qualifying windows, store results, check alerts.
 */
async function runDitchMonitor() {
  console.log('[DITCH-MONITOR] Starting ditch fill analysis...');

  // Season guard: suppress all alerts outside ditch season
  if (!isDitchSeason()) {
    console.log('[DITCH-MONITOR] Outside ditch season (Apr 15 – Oct 15) — skipping monitor');
    return;
  }

  try {
    // Find qualifying windows
    const windows = await findQualifyingWindows();
    console.log(`[DITCH-MONITOR] Found ${windows.length} qualifying windows over last ${SCAN_DAYS} days`);

    if (windows.length === 0) {
      console.log('[DITCH-MONITOR] No qualifying windows found — need more quiet time or tank activity');
      return;
    }

    // Store new windows (avoid duplicates by checking window_start)
    for (const window of windows) {
      if (window.isStoppage) continue; // Don't store stoppage as normal window

      const { data: existing, error: checkErr } = await supabase
        .from('ditch_fill_log')
        .select('id')
        .eq('window_start', window.window_start)
        .limit(1);

      if (checkErr) {
        console.error('[DITCH-MONITOR] Error checking existing window:', checkErr.message);
        continue;
      }

      if (existing && existing.length > 0) {
        continue; // Already logged
      }

      const { error: insertErr } = await supabase
        .from('ditch_fill_log')
        .insert(window);

      if (insertErr) {
        console.error('[DITCH-MONITOR] Error inserting window:', insertErr.message);
      }
    }

    // Get rolling baseline
    const baseline = await getRollingBaseline();
    console.log(`[DITCH-MONITOR] Rolling baseline: ${baseline.toFixed(1)} GPM (last ${BASELINE_WINDOW_COUNT} windows)`);

    // Check for alerts
    const slowdownAlert = await checkSlowdownAlert(baseline);
    if (slowdownAlert) {
      await fireAlert(slowdownAlert);
    }

    const stoppageAlert = await checkStoppageAlert(windows);
    if (stoppageAlert) {
      await fireAlert(stoppageAlert);
    }

    console.log('[DITCH-MONITOR] Analysis complete');
  } catch (err) {
    console.error('[DITCH-MONITOR] Error during analysis:', err.message);
    console.error(err.stack);
  }
}

module.exports = { runDitchMonitor };
