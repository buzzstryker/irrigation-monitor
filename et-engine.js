/**
 * et-engine.js — ET (evapotranspiration) calculation engine
 *
 * Fetches weather data from Open-Meteo (free, no API key) and calculates
 * reference ET (ETo) using the FAO-56 Penman-Monteith equation.
 *
 * Location: Loomis, CA (38.8024, -121.1964, ~122m elevation)
 */

require('dotenv').config();

const LAT = parseFloat(process.env.LATITUDE) || 38.8024;
const LON = parseFloat(process.env.LONGITUDE) || -121.1964;
const ELEVATION_M = parseFloat(process.env.ELEVATION_M) || 122;

// Open-Meteo daily variables we need
const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'windspeed_10m_max',
  'shortwave_radiation_sum',
  'relative_humidity_2m_max'
].join(',');

// ─────────────────────────────────────────────────
// Unit conversions
// ─────────────────────────────────────────────────

function celsiusToFahrenheit(c) {
  return c * 9 / 5 + 32;
}

function kmhToMph(kmh) {
  return kmh * 0.621371;
}

/** Convert 10m wind speed to 2m using log wind profile */
function wind10mTo2m(u10) {
  // FAO-56 eq. 47: u2 = u_z × 4.87 / ln(67.8×z - 5.42)
  // For z=10: ln(67.8×10 - 5.42) = ln(672.58) ≈ 6.502
  return u10 * 4.87 / Math.log(67.8 * 10 - 5.42);
}

// ─────────────────────────────────────────────────
// FAO-56 Penman-Monteith ETo calculation
// ─────────────────────────────────────────────────

/**
 * Calculate reference ET using the FAO-56 Penman-Monteith equation.
 *
 * @param {number} tMax  - Max temperature (°C)
 * @param {number} tMin  - Min temperature (°C)
 * @param {number} rhMax - Max relative humidity (%)
 * @param {number} u10   - Wind speed at 10m height (km/h)
 * @param {number} Rs    - Incoming shortwave radiation (MJ/m²/day)
 * @returns {number} ETo in mm/day
 */
function calculateETo(tMax, tMin, rhMax, u10, Rs) {
  const tMean = (tMax + tMin) / 2;

  // Convert wind: km/h → m/s, then 10m → 2m
  const u10_ms = u10 / 3.6;
  const u2 = wind10mTo2m(u10_ms);

  // Atmospheric pressure (kPa) from elevation — FAO-56 eq. 7
  const P = 101.3 * Math.pow((293 - 0.0065 * ELEVATION_M) / 293, 5.26);

  // Psychrometric constant — FAO-56 eq. 8
  const gamma = 0.000665 * P;

  // Saturation vapor pressure — FAO-56 eq. 11
  function eSat(t) {
    return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
  }

  const esMax = eSat(tMax);
  const esMin = eSat(tMin);
  const es = (esMax + esMin) / 2;

  // Actual vapor pressure from RH_max — FAO-56 eq. 17 (simplified)
  // Using only RH_max with T_min gives best estimate when only max RH is available
  const ea = eSat(tMin) * rhMax / 100;

  // Slope of saturation vapor pressure curve — FAO-56 eq. 13
  const delta = (4098 * eSat(tMean)) / Math.pow(tMean + 237.3, 2);

  // Net shortwave radiation — FAO-56 eq. 38 (albedo = 0.23 for grass reference)
  const Rns = 0.77 * Rs;

  // Net longwave radiation — FAO-56 eq. 39
  const tMaxK4 = Math.pow(tMax + 273.16, 4);
  const tMinK4 = Math.pow(tMin + 273.16, 4);
  const sigma = 4.903e-9; // Stefan-Boltzmann (MJ/m²/day/K⁴)

  // Estimate clear-sky radiation: Rso = (0.75 + 2e-5 × elevation) × Ra
  // We approximate Ra from Rs (assuming Rs/Rso ≈ 0.7 on average clear day)
  // Better: use Rs/Rso ratio directly
  const Rso = Rs / 0.7; // rough estimate; on clear days Rs ≈ 0.75 × Ra
  const RsRso = Math.min(Rs / Math.max(Rso, 0.01), 1.0);

  const Rnl = sigma * ((tMaxK4 + tMinK4) / 2) *
    (0.34 - 0.14 * Math.sqrt(ea)) *
    (1.35 * RsRso - 0.35);

  // Net radiation
  const Rn = Rns - Rnl;

  // Soil heat flux — approximately 0 for daily periods (FAO-56 eq. 42)
  const G = 0;

  // FAO-56 Penman-Monteith equation (eq. 6)
  const numerator = 0.408 * delta * (Rn - G) +
    gamma * (900 / (tMean + 273)) * u2 * (es - ea);
  const denominator = delta + gamma * (1 + 0.34 * u2);

  const eto = numerator / denominator;

  // Clamp to sensible range (0 to ~15 mm/day)
  return Math.max(0, Math.min(eto, 15));
}

/** Convert ETo from mm/day to inches/day */
function mmToInches(mm) {
  return mm / 25.4;
}

// ─────────────────────────────────────────────────
// Open-Meteo API fetching
// ─────────────────────────────────────────────────

/**
 * Fetch historical (actual) weather for a specific date.
 * Open-Meteo archive API has ~5 day delay for some variables,
 * but recent days are usually available.
 */
async function fetchHistorical(dateStr) {
  const url = `https://archive-api.open-meteo.com/v1/archive?` +
    `latitude=${LAT}&longitude=${LON}` +
    `&start_date=${dateStr}&end_date=${dateStr}` +
    `&daily=${DAILY_VARS}` +
    `&temperature_unit=celsius&windspeed_unit=kmh&timezone=America%2FLos_Angeles`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo archive API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Fetch forecast weather (today + next 2 days).
 */
async function fetchForecast() {
  const url = `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${LAT}&longitude=${LON}` +
    `&daily=${DAILY_VARS},precipitation_sum` +
    `&forecast_days=3` +
    `&temperature_unit=celsius&windspeed_unit=kmh&timezone=America%2FLos_Angeles`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Parse Open-Meteo daily response into our ET data format.
 * Returns array of { date, et_inches, temp_high_f, ... } objects.
 */
function parseWeatherResponse(data, source) {
  const d = data.daily;
  const results = [];

  for (let i = 0; i < d.time.length; i++) {
    const tMax = d.temperature_2m_max[i];
    const tMin = d.temperature_2m_min[i];
    const rh = d.relative_humidity_2m_max[i];
    const wind = d.windspeed_10m_max[i];
    const rad = d.shortwave_radiation_sum[i];
    const precip = d.precipitation_sum ? d.precipitation_sum[i] : 0;

    // Skip if critical data is missing
    if (tMax == null || tMin == null || rh == null || wind == null || rad == null) {
      continue;
    }

    const etoMm = calculateETo(tMax, tMin, rh, wind, rad);

    results.push({
      date: d.time[i],
      et_inches: Math.round(mmToInches(etoMm) * 1000) / 1000,
      temp_high_f: Math.round(celsiusToFahrenheit(tMax) * 10) / 10,
      temp_low_f: Math.round(celsiusToFahrenheit(tMin) * 10) / 10,
      humidity_pct: Math.round(rh * 10) / 10,
      wind_mph: Math.round(kmhToMph(wind) * 10) / 10,
      solar_rad: Math.round(rad * 100) / 100,
      precipitation_in: Math.round(precip / 25.4 * 1000) / 1000,
      source
    });
  }

  return results;
}

// ─────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────

/**
 * Get yesterday's actual ET data.
 */
async function getYesterdayActual() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  const data = await fetchHistorical(dateStr);
  const results = parseWeatherResponse(data, 'actual');

  if (results.length === 0) {
    throw new Error(`No historical data available for ${dateStr}`);
  }
  return results[0];
}

/**
 * Get today's and tomorrow's forecast ET data.
 * Returns array of ET data objects.
 */
async function getForecast() {
  const data = await fetchForecast();
  return parseWeatherResponse(data, 'forecast');
}

/**
 * Determine if irrigation should be skipped based on ET data and precipitation.
 *
 * @param {object} etData - ET data object from getYesterdayActual or getForecast
 * @param {object} [forecastData] - Today's forecast data (for rainfall check)
 * @returns {{ skip: boolean, reason: string }}
 */
function shouldSkipIrrigation(etData, forecastData) {
  // Skip if ET is negligible (cool/cloudy day)
  if (etData.et_inches < 0.05) {
    return {
      skip: true,
      reason: `ET too low (${etData.et_inches} in) — negligible water loss`
    };
  }

  // Skip if yesterday had significant rainfall
  if (etData.precipitation_in > 0.5) {
    return {
      skip: true,
      reason: `Recent rainfall (${etData.precipitation_in} in yesterday) — soil still moist`
    };
  }

  // Skip if forecast shows significant rainfall coming
  if (forecastData && forecastData.precipitation_in > 0.25) {
    return {
      skip: true,
      reason: `Rain forecast (${forecastData.precipitation_in} in expected) — hold off`
    };
  }

  return { skip: false, reason: 'Normal ET — irrigate as scheduled' };
}

module.exports = {
  getYesterdayActual,
  getForecast,
  shouldSkipIrrigation,
  calculateETo,
  mmToInches,
  celsiusToFahrenheit,
  kmhToMph,
  parseWeatherResponse
};
