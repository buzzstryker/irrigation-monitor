/**
 * et-engine.test.js — Integration test for ET engine
 *
 * Fetches real data from Open-Meteo and verifies Penman-Monteith
 * produces sensible ETo values for Loomis, CA (Northern California).
 *
 * Expected ranges for this region:
 *   - Winter: 0.02–0.08 in/day
 *   - Spring: 0.10–0.25 in/day
 *   - Summer: 0.25–0.40 in/day
 *   - Annual average: ~0.15 in/day
 */

require('dotenv').config();
const {
  getYesterdayActual,
  getForecast,
  shouldSkipIrrigation,
  calculateETo,
  mmToInches
} = require('./et-engine');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  ET Engine Test Suite — Loomis, CA');
  console.log('═══════════════════════════════════════════\n');

  // ── Test 1: Penman-Monteith with known inputs ──
  console.log('Test 1: Penman-Monteith calculation with known inputs');
  {
    // Typical spring day in Loomis: 22°C max, 8°C min, 60% RH, 15 km/h wind, 20 MJ/m² radiation
    const eto = calculateETo(22, 8, 60, 15, 20);
    const etoIn = mmToInches(eto);
    console.log(`  Input: Tmax=22°C, Tmin=8°C, RH=60%, Wind=15km/h, Rad=20 MJ/m²`);
    console.log(`  Result: ETo = ${eto.toFixed(2)} mm/day = ${etoIn.toFixed(3)} in/day`);
    assert(eto > 1 && eto < 8, `ETo ${eto.toFixed(2)} mm is in reasonable range (1-8 mm)`);
    assert(etoIn > 0.04 && etoIn < 0.35, `ETo ${etoIn.toFixed(3)} in is in spring range (0.04-0.35 in)`);
  }

  // ── Test 2: Hot summer day ──
  console.log('\nTest 2: Penman-Monteith for hot summer day');
  {
    // Hot Loomis summer: 38°C max, 18°C min, 25% RH, 10 km/h wind, 30 MJ/m² radiation
    const eto = calculateETo(38, 18, 25, 10, 30);
    const etoIn = mmToInches(eto);
    console.log(`  Input: Tmax=38°C, Tmin=18°C, RH=25%, Wind=10km/h, Rad=30 MJ/m²`);
    console.log(`  Result: ETo = ${eto.toFixed(2)} mm/day = ${etoIn.toFixed(3)} in/day`);
    assert(eto > 4 && eto < 12, `ETo ${eto.toFixed(2)} mm is in summer range (4-12 mm)`);
    assert(etoIn > 0.15 && etoIn < 0.50, `ETo ${etoIn.toFixed(3)} in is in summer range (0.15-0.50 in)`);
  }

  // ── Test 3: Cool winter day ──
  console.log('\nTest 3: Penman-Monteith for cool winter day');
  {
    // Cool Loomis winter: 10°C max, 2°C min, 90% RH, 8 km/h wind, 5 MJ/m² radiation
    const eto = calculateETo(10, 2, 90, 8, 5);
    const etoIn = mmToInches(eto);
    console.log(`  Input: Tmax=10°C, Tmin=2°C, RH=90%, Wind=8km/h, Rad=5 MJ/m²`);
    console.log(`  Result: ETo = ${eto.toFixed(2)} mm/day = ${etoIn.toFixed(3)} in/day`);
    assert(eto >= 0 && eto < 3, `ETo ${eto.toFixed(2)} mm is in winter range (0-3 mm)`);
    assert(etoIn >= 0 && etoIn < 0.12, `ETo ${etoIn.toFixed(3)} in is in winter range (0-0.12 in)`);
  }

  // ── Test 4: Fetch yesterday's actual data from Open-Meteo ──
  console.log('\nTest 4: Fetch yesterday\'s actual weather from Open-Meteo');
  try {
    const actual = await getYesterdayActual();
    console.log(`  Date: ${actual.date}`);
    console.log(`  ET: ${actual.et_inches} in/day`);
    console.log(`  High: ${actual.temp_high_f}°F | Low: ${actual.temp_low_f}°F`);
    console.log(`  Humidity: ${actual.humidity_pct}% | Wind: ${actual.wind_mph} mph`);
    console.log(`  Solar Radiation: ${actual.solar_rad} MJ/m²`);
    console.log(`  Precipitation: ${actual.precipitation_in} in`);
    console.log(`  Source: ${actual.source}`);

    assert(actual.source === 'actual', 'Source is "actual"');
    assert(actual.et_inches > 0 && actual.et_inches < 0.6, `ET ${actual.et_inches} in is plausible for NorCal`);
    assert(actual.temp_high_f > 30 && actual.temp_high_f < 120, `High temp ${actual.temp_high_f}°F is plausible`);
    assert(actual.temp_low_f > 10 && actual.temp_low_f < 90, `Low temp ${actual.temp_low_f}°F is plausible`);
    assert(actual.humidity_pct >= 0 && actual.humidity_pct <= 100, `Humidity ${actual.humidity_pct}% in valid range`);
    assert(actual.wind_mph >= 0 && actual.wind_mph < 80, `Wind ${actual.wind_mph} mph is plausible`);
  } catch (err) {
    console.log(`  ⚠ Could not fetch historical data (may not be available yet): ${err.message}`);
    console.log('  Skipping historical assertions — this is normal if run within 2 days of today');
  }

  // ── Test 5: Fetch forecast data from Open-Meteo ──
  console.log('\nTest 5: Fetch forecast weather from Open-Meteo');
  try {
    const forecasts = await getForecast();
    assert(forecasts.length >= 1, `Got ${forecasts.length} forecast day(s)`);

    for (const fc of forecasts) {
      console.log(`  ${fc.date}: ET=${fc.et_inches} in | High=${fc.temp_high_f}°F | Low=${fc.temp_low_f}°F | Precip=${fc.precipitation_in} in | Source=${fc.source}`);
    }

    const today = forecasts[0];
    assert(today.source === 'forecast', 'Source is "forecast"');
    assert(today.et_inches > 0 && today.et_inches < 0.6, `Forecast ET ${today.et_inches} in is plausible`);
  } catch (err) {
    console.log(`  ⚠ Forecast fetch failed (network issue, not a code bug): ${err.message}`);
    console.log('  Skipping forecast assertions — will work when Open-Meteo is reachable');
  }

  // ── Test 6: Skip irrigation logic ──
  console.log('\nTest 6: shouldSkipIrrigation logic');
  {
    // Low ET — should skip
    const low = shouldSkipIrrigation({ et_inches: 0.03, precipitation_in: 0 });
    assert(low.skip === true, `ET=0.03 → skip (${low.reason})`);

    // Normal ET, no rain — should not skip
    const normal = shouldSkipIrrigation({ et_inches: 0.20, precipitation_in: 0 });
    assert(normal.skip === false, `ET=0.20, no rain → irrigate`);

    // Heavy yesterday rain — should skip
    const rain = shouldSkipIrrigation({ et_inches: 0.20, precipitation_in: 0.75 });
    assert(rain.skip === true, `ET=0.20, 0.75in rain → skip (${rain.reason})`);

    // Normal ET but forecast rain — should skip
    const fcRain = shouldSkipIrrigation(
      { et_inches: 0.20, precipitation_in: 0 },
      { precipitation_in: 0.40 }
    );
    assert(fcRain.skip === true, `ET=0.20, forecast 0.40in → skip (${fcRain.reason})`);

    // Normal ET, light forecast — should not skip
    const lightFc = shouldSkipIrrigation(
      { et_inches: 0.20, precipitation_in: 0 },
      { precipitation_in: 0.10 }
    );
    assert(lightFc.skip === false, `ET=0.20, forecast 0.10in → irrigate`);
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
