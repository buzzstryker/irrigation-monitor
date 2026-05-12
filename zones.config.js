/**
 * zones.config.js — Zone inventory for all three Hydrawise controllers
 *
 * Each controller has a name matching the Hydrawise controller name
 * and a list of zones with relay_id, name, type, and measured GPM.
 *
 * Barn zones are TBD — GPM will be populated after flow meter data is captured.
 */

module.exports = {
  controllers: [
    {
      id: 1659477,  // Hydrawise controller ID (discovered at runtime, hardcoded here for attribution config)
      name: 'Loomis Garage',
      hasFlowMeter: true,
      flowMeterHealthy: true,
      zones: [
        { relay_id: 1, zone_id: 'Z1', name: 'Frontyard East Sod', type: 'sod', gpm: 7.8 },
        { relay_id: 2, zone_id: 'Z2', name: 'Frontyard West Sod', type: 'sod', gpm: 14.4 },
        { relay_id: 3, zone_id: 'Z3', name: 'Backyard East Sod', type: 'sod', gpm: 10.8 },
        { relay_id: 4, zone_id: 'Z4', name: 'Backyard West Sod', type: 'sod', gpm: 7.6 },
        // SYSTEM CRITICAL: Z5 is capped and serves as the attribution gate for Pool Equipment flow metering.
        // DO NOT uncap or modify without coordination with flow attribution logic.
        { relay_id: 5, zone_id: 'Z5', name: 'Garage Z5 (capped dummy)', type: 'system', gpm: 0, capped: true, cappedAt: '2026-05-11', role: 'attribution_gate' },
        { relay_id: 6, zone_id: 'Z6', name: 'Frontyard Drip', type: 'drip', gpm: 10.4 },
        { relay_id: 7, zone_id: 'Z7', name: 'Backyard House Drip', type: 'drip', gpm: 2.8 },
        { relay_id: 8, zone_id: 'Z8', name: 'Garden Raised Beds', type: 'drip', gpm: 3.0 },
        { relay_id: 9, zone_id: 'Z9', name: 'Viewshed Hedges', type: 'drip', gpm: 4.0 },
      ],
    },
    {
      id: 1977673,  // Hydrawise controller ID
      name: 'Loomis Pool Equipment',
      hasFlowMeter: true,  // physical meter installed, but...
      flowMeterHealthy: false,  // ...permanently unreliable; flow attributed via flowMeterAttribution below
      flowMeterAttribution: {
        sourceControllerId: 1659477,  // Numeric Hydrawise controller ID — must match the id field on the GARAGE controller config object. String 'GARAGE' would not match at runtime; poll.js and setzone calls use numeric IDs.
        sourceMeterRelay: null,  // Garage controller's main meter (not zone-specific)
        gatingRelay: 5,  // Garage Z5 relay
        gatingZoneName: 'Garage Z5 (capped dummy)',
        gateBufferSec: 30,  // How long Z5 must be open before Pool zone opens
        gateStaggerMs: 2000,  // Delay between Z5 open and Pool zone open commands
        reason: 'Pool Equip meter unreliable; Pool zones are downstream of Garage flow meter',
        establishedAt: '2026-05-11',
        degradationBehavior: 'estimate',  // When Garage meter unhealthy, fall back to estimation
        estimateSource: 'zones.config.js gpm field'  // When meter is unhealthy, estimated mode computes gallons = config_gpm × runtime_min using the GPM field on the zone in zones.config.js. This is NOT pure duration-scaling (which is what the Barn controller does because it has no measured GPMs). Pool Equip zones DO have measured GPMs (after calibration), so estimated mode uses those measurements multiplied by runtime.
      },
      zones: [
        { relay_id: 1, zone_id: 'Z1', name: 'Pool Drip', type: 'drip', gpm: 1.7 },
        { relay_id: 2, zone_id: 'Z2', name: 'Soccer West South', type: 'sod', gpm: 9.2 },
        { relay_id: 3, zone_id: 'Z3', name: 'Soccer West North', type: 'sod', gpm: 7.0 },
        { relay_id: 4, zone_id: 'Z4', name: 'Soccer East South', type: 'sod', gpm: 13.0 },
        { relay_id: 5, zone_id: 'Z5', name: 'Soccer East North', type: 'sod', gpm: 9.5 },
        { relay_id: 6, zone_id: 'Z6', name: 'Soccer East North2', type: 'sod', gpm: 7.0 },
        { relay_id: 7, zone_id: 'Z7', name: 'East Trees South', type: 'sod', gpm: 10.5 },
        { relay_id: 8, zone_id: 'Z8', name: 'East Trees North', type: 'sod', gpm: 16.0 },
        { relay_id: 9, zone_id: 'Z9', name: 'West Trees Woodpile', type: 'sod', gpm: 12.0 },
        { relay_id: 10, zone_id: 'Z10', name: 'West Trees Rocks', type: 'sod', gpm: 11.0 },
        { relay_id: 11, zone_id: 'Z11', name: 'West Trees Septic', type: 'sod', gpm: 10.0 },
      ],
    },
    {
      id: null,  // Barn controller ID not yet discovered
      name: 'Loomis barn',
      hasFlowMeter: false,
      flowMeterHealthy: null,
      zones: [
        { relay_id: 1, zone_id: 'Z1', name: 'Iris & Street Front Drip', type: 'drip', gpm: null },
        { relay_id: 2, zone_id: 'Z2', name: 'Barn Fruit Trees', type: 'drip', gpm: null },
      ],
    },
  ],

  /** Tank constants */
  tank: {
    capacity_gal: 1725,
    usable_gal: 981,
    pump_cutoff_gal: 408,
    low_warning_gal: 450,
    fill_rate_gpm: 5.77,  // 346 GPH, 24/7 — measured 2026-05 (5 gal in 52 sec)
  },

  /**
   * Group controllers by attribution strategy.
   * Returns an object mapping attribution group names to arrays of controller names.
   * 
   * Attribution groups share a single flow meter timeline:
   * - 'garage-pool-shared': Garage and Pool Equipment serialize valve operations
   * - 'barn-solo': Barn operates independently (no flow meter)
   */
  groupControllersByAttribution() {
    return {
      'garage-pool-shared': ['Loomis Garage', 'Loomis Pool Equipment'],
      'barn-solo': ['Loomis barn']
    };
  },
};