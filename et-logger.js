/**
 * et-logger.js — Daily ET data logger
 *
 * Fetches weather data and calculates ET. Called by scheduler.js at 2:00 AM.
 * Can also be run directly: node et-logger.js
 */

require('dotenv').config();
const { getYesterdayActual, getForecast, shouldSkipIrrigation } = require('./et-engine');
const { getDb, upsertEtLog } = require('./db');

function formatLog(data) {
  return `[ET] ${data.date} | ET: ${data.et_inches} in | ` +
    `High: ${data.temp_high_f}°F | Low: ${data.temp_low_f}°F | ` +
    `Wind: ${data.wind_mph}mph | Humidity: ${data.humidity_pct}% | ` +
    `Solar: ${data.solar_rad} MJ/m² | Source: ${data.source}`;
}

async function runEtUpdate() {
  console.log(`[ET] Starting ET update at ${new Date().toLocaleString()}`);

  // Initialize database
  getDb();

  // 1. Fetch and store yesterday's actual ET
  try {
    const yesterday = await getYesterdayActual();
    upsertEtLog(yesterday);
    console.log(formatLog(yesterday));

    // Check skip conditions using yesterday's data
    const skipCheck = shouldSkipIrrigation(yesterday);
    if (skipCheck.skip) {
      console.log(`[ET] SKIP recommended: ${skipCheck.reason}`);
    }
  } catch (err) {
    console.error(`[ET] Failed to fetch yesterday's actual ET: ${err.message}`);
    // Historical data might not be available yet — fall back to forecast only
  }

  // 2. Fetch and store today's + tomorrow's forecast ET
  try {
    const forecasts = await getForecast();
    for (const fc of forecasts) {
      upsertEtLog(fc);
      console.log(formatLog(fc));
    }

    // Check skip conditions: yesterday's actual + today's forecast precip
    if (forecasts.length >= 1) {
      const todayForecast = forecasts[0];
      try {
        const yesterday = await getYesterdayActual();
        const skipCheck = shouldSkipIrrigation(yesterday, todayForecast);
        if (skipCheck.skip) {
          console.log(`[ET] SKIP recommended: ${skipCheck.reason}`);
        } else {
          console.log(`[ET] ${skipCheck.reason}`);
        }
      } catch {
        // Yesterday data may not be available; check forecast alone
        const skipCheck = shouldSkipIrrigation(todayForecast);
        if (skipCheck.skip) {
          console.log(`[ET] SKIP recommended: ${skipCheck.reason}`);
        }
      }
    }
  } catch (err) {
    console.error(`[ET] Failed to fetch forecast ET: ${err.message}`);
  }

  console.log(`[ET] Update complete at ${new Date().toLocaleString()}`);
}

// When run directly (not required by scheduler)
if (require.main === module) {
  console.log('[ET] ET Logger running directly');
  runEtUpdate().catch(err => {
    console.error(`[ET] Update failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runEtUpdate };
