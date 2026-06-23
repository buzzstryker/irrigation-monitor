/**
 * zones.config.js — Zone inventory for all three Hydrawise controllers
 *
 * Each controller has a name matching the Hydrawise controller name
 * and a list of zones with relay_id, name, type, and GPM (two-tier model).
 *
 * GPM MODEL (measured-primary, configured-fallback):
 * - configured_gpm: head-count estimate (non-authoritative fallback)
 * - measured_gpm: tank-drawdown calibration result (authoritative when present)
 * - measured_date: ISO date of measurement (YYYY-MM-DD)
 * - getZoneGpm(zone) helper: returns measured_gpm if non-null, else configured_gpm
 *
 * Barn zones are TBD — GPM will be populated after flow meter data is captured.
 */

module.exports = {
  controllers: [
    {
      id: 1659477,
      name: 'Loomis Garage',
      // Informational only — these fields document meter status but do not gate any runtime logic.
      // Real-time flow readings are not available via Hydrawise REST API v1 (see docs/hydrawise-api-flow-fields.md).
      hasFlowMeter: true,          // Physical meter installed
      flowMeterHealthy: true,      // Meter appears functional in Hydrawise UI
      zones: [
        { relay_id: 1, zone_id: 'Z1', name: 'Frontyard East Sod', type: 'sod', configured_gpm: 7.8, measured_gpm: null, measured_date: null },
        { relay_id: 2, zone_id: 'Z2', name: 'Frontyard West Sod', type: 'sod', configured_gpm: 14.4, measured_gpm: null, measured_date: null },
        { relay_id: 3, zone_id: 'Z3', name: 'Backyard East Sod', type: 'sod', configured_gpm: 10.8, measured_gpm: null, measured_date: null },
        { relay_id: 4, zone_id: 'Z4', name: 'Backyard West Sod', type: 'sod', configured_gpm: 7.6, measured_gpm: null, measured_date: null },
        // Z5 is physically capped (as of 2026-05-11) to prevent water delivery.
        // Vestigial; previously served as Phase 4a attribution gate (deprecated).
        // If accidentally activated, valve opens but cap blocks flow (harmless).
        { relay_id: 5, zone_id: 'Z5', name: 'Garage Z5 (capped dummy)', type: 'system', configured_gpm: 0, measured_gpm: null, measured_date: null, capped: true, cappedAt: '2026-05-11', role: 'capped' },
        { relay_id: 6, zone_id: 'Z6', name: 'Frontyard Drip', type: 'drip', configured_gpm: 10.4, measured_gpm: null, measured_date: null },
        { relay_id: 7, zone_id: 'Z7', name: 'Backyard House Drip', type: 'drip', configured_gpm: 2.8, measured_gpm: null, measured_date: null },
        { relay_id: 8, zone_id: 'Z8', name: 'Garden Raised Beds', type: 'drip', configured_gpm: 3.0, measured_gpm: null, measured_date: null },
        { relay_id: 9, zone_id: 'Z9', name: 'Viewshed Hedges', type: 'drip', configured_gpm: 4.0, measured_gpm: null, measured_date: null },
      ],
    },
    {
      id: 1977673,
      name: 'Loomis Pool Equipment',
      // Informational only — these fields document meter status but do not gate any runtime logic.
      // Real-time flow readings are not available via Hydrawise REST API v1 (see docs/hydrawise-api-flow-fields.md).
      hasFlowMeter: true,          // Physical meter installed
      flowMeterHealthy: false,     // Meter is unreliable (manual observation)
      zones: [
        { relay_id: 1, zone_id: 'Z1', name: 'Pool Drip', type: 'drip', configured_gpm: 1.7, measured_gpm: null, measured_date: null },
        { relay_id: 2, zone_id: 'Z2', name: 'Soccer West South', type: 'sod', configured_gpm: 9.2, measured_gpm: null, measured_date: null },
        { relay_id: 3, zone_id: 'Z3', name: 'Soccer West North', type: 'sod', configured_gpm: 7.0, measured_gpm: null, measured_date: null },
        { relay_id: 4, zone_id: 'Z4', name: 'Soccer East South', type: 'sod', configured_gpm: 13.0, measured_gpm: 12.3, measured_date: '2026-06-22' },
        { relay_id: 5, zone_id: 'Z5', name: 'Soccer East North', type: 'sod', configured_gpm: 9.5, measured_gpm: null, measured_date: null },
        { relay_id: 6, zone_id: 'Z6', name: 'Soccer East North2', type: 'sod', configured_gpm: 7.0, measured_gpm: null, measured_date: null },
        { relay_id: 7, zone_id: 'Z7', name: 'East Trees South', type: 'sod', configured_gpm: 10.5, measured_gpm: null, measured_date: null },
        { relay_id: 8, zone_id: 'Z8', name: 'East Trees North', type: 'sod', configured_gpm: 16.0, measured_gpm: 21.0, measured_date: '2026-06-22' },
        { relay_id: 9, zone_id: 'Z9', name: 'West Trees Woodpile', type: 'sod', configured_gpm: 12.0, measured_gpm: 17.7, measured_date: '2026-06-22' },
        { relay_id: 10, zone_id: 'Z10', name: 'West Trees Rocks', type: 'sod', configured_gpm: 11.0, measured_gpm: null, measured_date: null },
        { relay_id: 11, zone_id: 'Z11', name: 'West Trees Septic', type: 'sod', configured_gpm: 10.0, measured_gpm: null, measured_date: null },
      ],
    },
    {
      id: 1970558,
      name: 'Loomis barn',
      // Informational only — these fields document meter status but do not gate any runtime logic.
      // Real-time flow readings are not available via Hydrawise REST API v1 (see docs/hydrawise-api-flow-fields.md).
      hasFlowMeter: false,         // No physical meter installed
      zones: [
        { relay_id: 11518884, zone_id: 'Z5', name: 'Iris & Street Front Drip', type: 'drip', configured_gpm: null, measured_gpm: null, measured_date: null },
        { relay_id: 11518885, zone_id: 'Z6', name: 'Barn Fruit Trees Drip', type: 'drip', configured_gpm: null, measured_gpm: null, measured_date: null },
      ],
    },
  ],

  /** Tank constants */
  tank: {
    capacity_gal: 1725,
    usable_gal: 981,
    pump_cutoff_gal: 408,
    low_warning_gal: 450,
    // Ditch fill rate: ~7.26 GPM (436 GPH) measured via empirical strapping table
    // (June 2026). The old 5.77 GPM (May 2026) was artificially low due to the
    // modeled table undercounting gallons (-36% error at 10" depth). Empirical
    // table corrects this, revealing true ditch fill rate ~7.3 GPM.
    fill_rate_gpm: 7.26,  // 436 GPH, 24/7 — re-measured 2026-06 (empirical table)
  },

  /** Ditch season checker (Apr 15 – Oct 15) */
  isDitchSeason(date = new Date()) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return (month > 4 || (month === 4 && day >= 15)) &&
           (month < 10 || (month === 10 && day <= 15));
  },

  /**
   * Get the authoritative GPM for a zone (measured-primary, configured-fallback).
   * Returns measured_gpm if non-null, else configured_gpm.
   *
   * @param {Object} zone - Zone object from controllers[].zones[]
   * @returns {number|null} Effective GPM value
   */
  getZoneGpm(zone) {
    return zone.measured_gpm !== null && zone.measured_gpm !== undefined
      ? zone.measured_gpm
      : zone.configured_gpm;
  },

  /**
   * Get GPM source indicator for a zone (for UI display).
   * Returns 'measured' if measured_gpm is present, else 'configured'.
   *
   * @param {Object} zone - Zone object from controllers[].zones[]
   * @returns {'measured'|'configured'} Source of the effective GPM value
   */
  getZoneGpmSource(zone) {
    return zone.measured_gpm !== null && zone.measured_gpm !== undefined
      ? 'measured'
      : 'configured';
  },
};