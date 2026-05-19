/**
 * zone-gpm.js — Zone GPM override management
 *
 * Provides runtime GPM override capability. zones.config.js holds defaults;
 * zone_gpm_overrides table holds operator edits. getEffectiveGpm() reads
 * override-first, falls back to config default.
 *
 * All future code needing a zone's GPM should call getEffectiveGpm().
 */

const { getDb } = require('./db');
const zonesConfig = require('./zones.config');

// Cache the zones config on module load
const zonesByController = new Map();
for (const controller of zonesConfig.controllers) {
  const zoneMap = new Map();
  for (const zone of controller.zones) {
    zoneMap.set(zone.zone_id, {
      name: zone.name,
      type: zone.type,
      gpm: zone.gpm,
      relay_id: zone.relay_id,
    });
  }
  zonesByController.set(controller.name, zoneMap);
}

/**
 * Get the effective GPM for a zone (override if present, else config default).
 * @param {string} controller - Controller name (e.g. 'Loomis Garage')
 * @param {string} zoneId - Zone ID (e.g. 'Z1')
 * @returns {{ gpm: number|null, source: 'override'|'config'|'unknown', updatedAt: string|null }}
 */
function getEffectiveGpm(controller, zoneId) {
  const db = getDb();

  // Check for override first
  const override = db.prepare(`
    SELECT gpm, updated_at
    FROM zone_gpm_overrides
    WHERE controller = ? AND zone_id = ?
  `).get(controller, zoneId);

  if (override) {
    return {
      gpm: override.gpm,
      source: 'override',
      updatedAt: new Date(override.updated_at * 1000).toISOString(),
    };
  }

  // Fall back to config default
  const controllerZones = zonesByController.get(controller);
  if (controllerZones && controllerZones.has(zoneId)) {
    const zone = controllerZones.get(zoneId);
    return {
      gpm: zone.gpm,
      source: 'config',
      updatedAt: null,
    };
  }

  // Zone not found in config
  return {
    gpm: null,
    source: 'unknown',
    updatedAt: null,
  };
}

/**
 * Get all zones with their effective GPM values.
 * @returns {Array<Object>} Array of zone objects with config and effective GPM
 */
function getAllZoneGpms() {
  const db = getDb();

  // Fetch all overrides
  const overrides = new Map();
  const overrideRows = db.prepare(`
    SELECT controller, zone_id, gpm, updated_at, reason
    FROM zone_gpm_overrides
  `).all();

  for (const row of overrideRows) {
    const key = `${row.controller}:${row.zone_id}`;
    overrides.set(key, {
      gpm: row.gpm,
      updatedAt: new Date(row.updated_at * 1000).toISOString(),
      reason: row.reason,
    });
  }

  // Build result array from config with overrides applied
  const result = [];
  for (const controller of zonesConfig.controllers) {
    for (const zone of controller.zones) {
      const key = `${controller.name}:${zone.zone_id}`;
      const override = overrides.get(key);

      result.push({
        controller: controller.name,
        zoneId: zone.zone_id,
        zoneName: zone.name,
        zoneType: zone.type,
        configGpm: zone.gpm,
        effectiveGpm: override ? override.gpm : zone.gpm,
        source: override ? 'override' : 'config',
        overrideUpdatedAt: override ? override.updatedAt : null,
        overrideReason: override ? override.reason : null,
      });
    }
  }

  // Sort by controller then zone_id naturally (Z1, Z2, ..., Z10, Z11)
  result.sort((a, b) => {
    if (a.controller !== b.controller) {
      return a.controller.localeCompare(b.controller);
    }
    // Natural sort for zone IDs: extract number from Z1, Z2, etc.
    const aNum = parseInt(a.zoneId.substring(1));
    const bNum = parseInt(b.zoneId.substring(1));
    return aNum - bNum;
  });

  return result;
}

/**
 * Set a GPM override for a zone.
 * @param {string} controller - Controller name
 * @param {string} zoneId - Zone ID
 * @param {number} newGpm - New GPM value (must be >= 0)
 * @param {string} [reason] - Optional reason for the change
 * @returns {Object} The updated zone data
 * @throws {Error} If zone not found or validation fails
 */
function setOverride(controller, zoneId, newGpm, reason = null) {
  // Validate zone exists in config
  const controllerZones = zonesByController.get(controller);
  if (!controllerZones || !controllerZones.has(zoneId)) {
    throw new Error(`Zone ${controller}:${zoneId} not found in configuration`);
  }

  // Validate GPM value
  if (typeof newGpm !== 'number' || newGpm < 0) {
    throw new Error(`Invalid GPM value: ${newGpm}. Must be a non-negative number.`);
  }

  if (newGpm >= 100) {
    throw new Error(`GPM value ${newGpm} exceeds maximum of 100. This is likely a typo.`);
  }

  const db = getDb();

  // Get the previous effective GPM (for change log)
  const prevGpmData = getEffectiveGpm(controller, zoneId);
  const oldGpm = prevGpmData.source === 'config' ? null : prevGpmData.gpm;

  // Use transaction for atomic update
  const transaction = db.transaction(() => {
    // Upsert the override
    db.prepare(`
      INSERT INTO zone_gpm_overrides (controller, zone_id, gpm, reason, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(controller, zone_id) DO UPDATE SET
        gpm = excluded.gpm,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `).run(controller, zoneId, newGpm, reason);

    // Log the change
    db.prepare(`
      INSERT INTO zone_gpm_change_log (controller, zone_id, old_gpm, new_gpm, reason, changed_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(controller, zoneId, oldGpm, newGpm, reason);
  });

  transaction();

  // Return the updated zone data
  const allZones = getAllZoneGpms();
  return allZones.find(z => z.controller === controller && z.zoneId === zoneId);
}

/**
 * Reset a zone to its config default (remove override).
 * @param {string} controller - Controller name
 * @param {string} zoneId - Zone ID
 * @param {string} [reason] - Optional reason for the reset
 * @returns {Object} Success indicator and updated zone data
 * @throws {Error} If zone not found
 */
function resetOverride(controller, zoneId, reason = null) {
  // Validate zone exists in config
  const controllerZones = zonesByController.get(controller);
  if (!controllerZones || !controllerZones.has(zoneId)) {
    throw new Error(`Zone ${controller}:${zoneId} not found in configuration`);
  }

  const db = getDb();

  // Get the previous effective GPM (for change log)
  const prevGpmData = getEffectiveGpm(controller, zoneId);
  const oldGpm = prevGpmData.source === 'override' ? prevGpmData.gpm : null;

  // Use transaction for atomic update
  const transaction = db.transaction(() => {
    // Delete the override
    const result = db.prepare(`
      DELETE FROM zone_gpm_overrides
      WHERE controller = ? AND zone_id = ?
    `).run(controller, zoneId);

    // Log the change (new_gpm = NULL means reset to default)
    db.prepare(`
      INSERT INTO zone_gpm_change_log (controller, zone_id, old_gpm, new_gpm, reason, changed_at)
      VALUES (?, ?, ?, NULL, ?, unixepoch())
    `).run(controller, zoneId, oldGpm, reason);

    return result.changes > 0;
  });

  const deleted = transaction();

  // Return the updated zone data
  const allZones = getAllZoneGpms();
  const zone = allZones.find(z => z.controller === controller && z.zoneId === zoneId);

  return {
    success: true,
    wasOverridden: deleted,
    zone,
  };
}

/**
 * Get the change history for a specific zone.
 * @param {string} controller - Controller name
 * @param {string} zoneId - Zone ID
 * @param {number} [limit=20] - Maximum number of entries to return
 * @returns {Array<Object>} Array of change log entries
 */
function getChangeHistory(controller, zoneId, limit = 20) {
  const db = getDb();

  // Clamp limit to 1-100
  limit = Math.max(1, Math.min(100, limit));

  const rows = db.prepare(`
    SELECT id, old_gpm, new_gpm, reason, changed_at
    FROM zone_gpm_change_log
    WHERE controller = ? AND zone_id = ?
    ORDER BY changed_at DESC
    LIMIT ?
  `).all(controller, zoneId, limit);

  return rows.map(row => ({
    id: row.id,
    oldGpm: row.old_gpm,
    newGpm: row.new_gpm,
    reason: row.reason,
    changedAt: new Date(row.changed_at * 1000).toISOString(),
  }));
}

module.exports = {
  getEffectiveGpm,
  getAllZoneGpms,
  setOverride,
  resetOverride,
  getChangeHistory,
};
