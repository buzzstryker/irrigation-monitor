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
      name: 'Loomis Garage',
      zones: [
        { relay_id: 1, zone_id: 'Z1', name: 'Frontyard East Sod', type: 'sod', gpm: 7.8 },
        { relay_id: 2, zone_id: 'Z2', name: 'Frontyard West Sod', type: 'sod', gpm: 14.4 },
        { relay_id: 3, zone_id: 'Z3', name: 'Backyard East Sod', type: 'sod', gpm: 10.8 },
        { relay_id: 4, zone_id: 'Z4', name: 'Backyard West Sod', type: 'sod', gpm: 7.6 },
        // Z5 unused
        { relay_id: 6, zone_id: 'Z6', name: 'Frontyard Drip', type: 'drip', gpm: 10.4 },
        { relay_id: 7, zone_id: 'Z7', name: 'Backyard House Drip', type: 'drip', gpm: 2.8 },
        { relay_id: 8, zone_id: 'Z8', name: 'Garden Raised Beds', type: 'drip', gpm: 3.0 },
        { relay_id: 9, zone_id: 'Z9', name: 'Viewshed Hedges', type: 'drip', gpm: 4.0 },
      ],
    },
    {
      name: 'Loomis Pool Equipment',
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
      name: 'Loomis barn',
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
    fill_rate_gpm: 4.29,
  },
};
