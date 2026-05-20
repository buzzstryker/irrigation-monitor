/**
 * zone-gpm.js — Zone GPM override management (Phase 4: Supabase async)
 *
 * Provides runtime GPM override capability. zones.config.js holds defaults;
 * zone_gpm_overrides table holds operator edits. getEffectiveGpm() reads
 * override-first, falls back to config default.
 *
 * All functions are now async and use Supabase client.
 */

const { supabase } = require('./db');
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
 */
async function getEffectiveGpm(controller, zoneId) {
  // Check for override first
  const { data: override, error } = await supabase
    .from('zone_gpm_overrides')
    .select('gpm, updated_at')
    .eq('controller', controller)
    .eq('zone_id', zoneId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error(`Error getting GPM override: ${error.message}`);
  }

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

  return {
    gpm: null,
    source: 'unknown',
    updatedAt: null,
  };
}

/**
 * Get all zones with their effective GPM values.
 */
async function getAllZoneGpms() {
  // Fetch all overrides
  const { data: overrideRows, error } = await supabase
    .from('zone_gpm_overrides')
    .select('controller, zone_id, gpm, updated_at, reason');

  if (error) {
    console.error(`Error getting GPM overrides: ${error.message}`);
  }

  const overrides = new Map();
  if (overrideRows) {
    for (const row of overrideRows) {
      const key = `${row.controller}:${row.zone_id}`;
      overrides.set(key, {
        gpm: row.gpm,
        updatedAt: new Date(row.updated_at * 1000).toISOString(),
        reason: row.reason,
      });
    }
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

  // Sort by controller then zone_id naturally
  result.sort((a, b) => {
    if (a.controller !== b.controller) {
      return a.controller.localeCompare(b.controller);
    }
    const aNum = parseInt(a.zoneId.substring(1));
    const bNum = parseInt(b.zoneId.substring(1));
    return aNum - bNum;
  });

  return result;
}

/**
 * Set a GPM override for a zone.
 * Note: Supabase doesn't have native transactions like SQLite. We use sequential awaits
 * and accept that if the second write fails after the first succeeded, manual cleanup may be needed.
 * For this single-user system with infrequent edits, this is acceptable.
 */
async function setOverride(controller, zoneId, newGpm, reason = null) {
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

  // Get the previous effective GPM (for change log)
  const prevGpmData = await getEffectiveGpm(controller, zoneId);
  const oldGpm = prevGpmData.source === 'config' ? null : prevGpmData.gpm;

  // Upsert the override
  const { error: overrideError } = await supabase
    .from('zone_gpm_overrides')
    .upsert({
      controller,
      zone_id: zoneId,
      gpm: newGpm,
      reason,
      updated_at: Math.floor(Date.now() / 1000)
    }, {
      onConflict: 'controller,zone_id'
    });

  if (overrideError) {
    throw new Error(`Failed to set override: ${overrideError.message}`);
  }

  // Log the change
  const { error: logError } = await supabase
    .from('zone_gpm_change_log')
    .insert({
      controller,
      zone_id: zoneId,
      old_gpm: oldGpm,
      new_gpm: newGpm,
      reason,
      changed_at: Math.floor(Date.now() / 1000)
    });

  if (logError) {
    console.error(`Failed to log GPM change: ${logError.message}`);
    // Continue despite log failure
  }

  // Return the updated zone data
  const allZones = await getAllZoneGpms();
  return allZones.find(z => z.controller === controller && z.zoneId === zoneId);
}

/**
 * Reset a zone to its config default (remove override).
 */
async function resetOverride(controller, zoneId, reason = null) {
  // Validate zone exists in config
  const controllerZones = zonesByController.get(controller);
  if (!controllerZones || !controllerZones.has(zoneId)) {
    throw new Error(`Zone ${controller}:${zoneId} not found in configuration`);
  }

  // Get the previous effective GPM (for change log)
  const prevGpmData = await getEffectiveGpm(controller, zoneId);
  const oldGpm = prevGpmData.source === 'override' ? prevGpmData.gpm : null;

  // Delete the override
  const { error: deleteError, count } = await supabase
    .from('zone_gpm_overrides')
    .delete()
    .eq('controller', controller)
    .eq('zone_id', zoneId);

  if (deleteError) {
    throw new Error(`Failed to reset override: ${deleteError.message}`);
  }

  // Log the change (new_gpm = NULL means reset to default)
  const { error: logError } = await supabase
    .from('zone_gpm_change_log')
    .insert({
      controller,
      zone_id: zoneId,
      old_gpm: oldGpm,
      new_gpm: null,
      reason,
      changed_at: Math.floor(Date.now() / 1000)
    });

  if (logError) {
    console.error(`Failed to log GPM reset: ${logError.message}`);
  }

  // Return the updated zone data
  const allZones = await getAllZoneGpms();
  const zone = allZones.find(z => z.controller === controller && z.zoneId === zoneId);

  return {
    success: true,
    wasOverridden: count > 0,
    zone,
  };
}

/**
 * Get the change history for a specific zone.
 */
async function getChangeHistory(controller, zoneId, limit = 20) {
  // Clamp limit to 1-100
  limit = Math.max(1, Math.min(100, limit));

  const { data: rows, error } = await supabase
    .from('zone_gpm_change_log')
    .select('id, old_gpm, new_gpm, reason, changed_at')
    .eq('controller', controller)
    .eq('zone_id', zoneId)
    .order('changed_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get change history: ${error.message}`);
  }

  return (rows || []).map(row => ({
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
