/**
 * reports/daily-report.js — Daily irrigation analysis report
 *
 * Generates a console report showing target vs actual water application
 * per zone, highlighting over- and under-watered zones.
 *
 * Can be run directly: node reports/daily-report.js [YYYY-MM-DD]
 */

const { logDailyComparison, getSeason, ET_SUMMER_AVG } = require('../coefficient-model');
const { getEtByDate } = require('../db');

/**
 * Generate and print the daily analysis report.
 * @param {string} [date] — defaults to yesterday
 * @returns {string} the full report text
 */
function generateReport(date) {
  if (!date) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().slice(0, 10);
  }

  const rows = logDailyComparison(date);
  const etRow = getEtByDate(date);
  const etInches = etRow ? etRow.et_inches : 0;
  const season = getSeason(date);

  const lines = [];

  lines.push('');
  lines.push(`=== LOOMIS IRRIGATION DAILY ANALYSIS — ${date} ===`);
  lines.push(`ET: ${etInches} in | Season: ${season.charAt(0).toUpperCase() + season.slice(1)} | ET summer baseline: ${ET_SUMMER_AVG} in/day`);
  if (etRow) {
    lines.push(`Weather: High ${etRow.temp_high_f}°F, Low ${etRow.temp_low_f}°F, Humidity ${etRow.humidity_pct}%, Wind ${etRow.wind_mph} mph`);
  }
  lines.push('');

  // Group by controller
  const byController = {};
  for (const row of rows) {
    if (!byController[row.controller]) byController[row.controller] = [];
    byController[row.controller].push(row);
  }

  let totalTarget = 0;
  let totalActual = 0;
  const overWatered = [];
  const underWatered = [];

  for (const [ctrlName, zones] of Object.entries(byController)) {
    const shortName = ctrlName.replace('Loomis ', '').toUpperCase();
    lines.push(`${shortName}`);
    lines.push('─'.repeat(90));

    // Header
    lines.push(
      pad('Zone', 5) +
      pad('Name', 26) +
      pad('Type', 6) +
      padR('Target', 10) +
      padR('Actual', 10) +
      padR('Delta', 10) +
      padR('Delta%', 9) +
      '  Notes'
    );

    let ctrlTarget = 0;
    let ctrlActual = 0;

    for (const z of zones) {
      const targetStr = z.target_gallons !== null
        ? `${z.target_gallons.toFixed(1)} gal`
        : (z.target_minutes !== null ? `${z.target_minutes} min` : '—');

      const actualStr = z.target_gallons !== null
        ? `${z.actual_gallons.toFixed(1)} gal`
        : `${z.actual_minutes} min`;

      const deltaStr = z.delta_gallons !== null
        ? `${z.delta_gallons > 0 ? '+' : ''}${z.delta_gallons.toFixed(1)}`
        : '—';

      const pctStr = z.delta_pct !== null
        ? `${z.delta_pct > 0 ? '+' : ''}${z.delta_pct.toFixed(0)}%`
        : '—';

      // Flag significant deltas
      let flag = '';
      if (z.delta_pct !== null) {
        if (z.actual_runs === 0 && z.target_gallons > 0) {
          flag = 'SKIP DAY';
        } else if (z.delta_pct > 15) {
          flag = 'OVER';
          overWatered.push(z);
        } else if (z.delta_pct < -15) {
          flag = 'UNDER';
          underWatered.push(z);
        }
      }

      const noteStr = flag
        ? `${flag}${z.notes ? ' — ' + z.notes : ''}`
        : (z.notes || '');

      lines.push(
        pad(z.zone_id, 5) +
        pad(z.zone_name, 26) +
        pad(z.zone_type, 6) +
        padR(targetStr, 10) +
        padR(actualStr, 10) +
        padR(deltaStr, 10) +
        padR(pctStr, 9) +
        (noteStr ? '  ' + noteStr : '')
      );

      if (z.target_gallons !== null) {
        ctrlTarget += z.target_gallons;
        ctrlActual += z.actual_gallons;
      }
    }

    lines.push('─'.repeat(90));
    lines.push(
      pad('', 5) +
      pad('Controller Total', 26) +
      pad('', 6) +
      padR(`${ctrlTarget.toFixed(1)} gal`, 10) +
      padR(`${ctrlActual.toFixed(1)} gal`, 10) +
      padR(`${(ctrlActual - ctrlTarget) > 0 ? '+' : ''}${(ctrlActual - ctrlTarget).toFixed(1)}`, 10)
    );
    lines.push('');

    totalTarget += ctrlTarget;
    totalActual += ctrlActual;
  }

  // Summary
  lines.push('='.repeat(90));
  lines.push(`SYSTEM TOTAL   Target: ${totalTarget.toFixed(1)} gal   Actual: ${totalActual.toFixed(1)} gal   Delta: ${(totalActual - totalTarget) > 0 ? '+' : ''}${(totalActual - totalTarget).toFixed(1)} gal`);

  if (overWatered.length > 0) {
    lines.push('');
    lines.push(`OVER-WATERED (>${'+'}15%): ${overWatered.map(z => `${z.controller.replace('Loomis ', '')} ${z.zone_id} (${z.delta_pct > 0 ? '+' : ''}${z.delta_pct.toFixed(0)}%)`).join(', ')}`);
  }
  if (underWatered.length > 0) {
    lines.push('');
    lines.push(`UNDER-WATERED (<-15%): ${underWatered.map(z => `${z.controller.replace('Loomis ', '')} ${z.zone_id} (${z.delta_pct.toFixed(0)}%)`).join(', ')}`);
  }

  lines.push('='.repeat(90));
  lines.push('');

  return lines.join('\n');
}

function pad(str, len) {
  return String(str).padEnd(len);
}

function padR(str, len) {
  return String(str).padStart(len);
}

// Run directly
if (require.main === module) {
  const date = process.argv[2] || undefined;
  const report = generateReport(date);
  console.log(report);
}

module.exports = { generateReport };
