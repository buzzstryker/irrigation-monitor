# Phase 4a Infrastructure Audit
## Static GPM Architecture Impact Assessment

**Date:** 2026-05-12  
**Context:** Following investigation in `docs/hydrawise-api-flow-fields.md`, Hydrawise REST API v1 does not expose real-time flow data. Phase 4a's flowMeterAttribution mechanism was designed under the assumption this data would be available.

**New Architecture:**
- GPM per zone is a static input in `zones.config.js`, manually maintained
- All GPM-derived values (gallons, tank drawdown, scheduling targets) are explicitly labeled "calculated"
- Flow meter attribution infrastructure is deprecated
- Future feature: users can edit GPM via dashboard UI
- Periodic calibration: tank-drawdown method (run zone, measure tank before/after, subtract ditch fill, compute GPM)

**Audit Scope:** Complete inventory of Phase 4a infrastructure and what should be DELETED, REPURPOSED, RELABELED, or KEPT AS-IS.

---

## 1. STANDALONE MODULES

### z5-startup-selftest.js

**Purpose:** Test Garage Z5 cap integrity by opening valve and verifying flow < 0.3 GPM

**Current State:** Functional structure but valve operations not implemented (throws "not yet implemented" error). Module exports `runZ5SelfTest()`, has CLI interface, includes skipIfRecent guard, preflight checks.

**Called By:** Nothing currently (standalone CLI tool, not wired to pm2 startup)

**Recommendation: DELETE**

**Justification:** Core function depends on real-time flow meter readings from Hydrawise API to verify Z5 produces <0.3 GPM. With no flow data available:
- Cannot execute the valve cycle → sample → threshold check sequence
- Preflight check logic (skipIfRecent, meter health) is unusable without the core test
- Z5's role as attribution gate is obsolete (see zones.config.js section below)

**Migration Strategy:**
- Remove file: `z5-startup-selftest.js`
- Remove table: `z5_selftest_log` (migration to drop table)
- No runtime dependencies (module never wired to startup)

---

### flow-calibration.js

**Purpose:** Measure Pool Equipment zone GPMs using Garage meter attribution via Z5 gating

**Current State:** Functional structure with preflight gates, CLI interface; valve operations throw "not yet implemented" error. Module exports `runCalibration()`.

**Called By:** Nothing (standalone CLI tool)

**Recommendation: REPURPOSE**

**Justification:** The tank-drawdown observation that yielded 15.87 GPM for Garage Z2 (vs 14.4 nominal) proves a viable calibration approach **without** real-time flow readings:

1. Open target zone via setzone API
2. Record tank level before (from `tank_level_log`)
3. Run zone for known duration (e.g., 5 minutes)
4. Record tank level after
5. Calculate: `actual_drawdown = tank_before - tank_after`
6. Subtract ditch fill contribution: `net_drawdown = actual_drawdown - (5.77 GPM × runtime_minutes)`
7. Compute: `zone_gpm = net_drawdown / runtime_minutes`

**Repurpose Plan:**
- **KEEP:** Module structure, CLI interface, preflight gates (tank headroom, no other zones active)
- **DELETE:** Z5 gating sequence, Garage meter sampling, flowMeterAttribution logic
- **REWRITE:** Core calibration sequence to tank-drawdown method
- **KEEP:** `flow_calibration_log` table — schema fits new approach (see Schema section)
- **RENAME:** Consider `tank-drawdown-calibration.js` for clarity

**New CLI Usage:**
```bash
node tank-drawdown-calibration.js --controller garage --zone z2 --duration 300
```

**Schema Mapping:**
- `meter_gpm`: NULL (or populated later if GraphQL API access obtained)
- `tank_gpm`: primary measurement (calculated from drawdown)
- `tank_drawdown_gal`: measured
- `ditch_fill_gal`: calculated (5.77 GPM × runtime)
- `agreement_pct`: N/A (no meter to compare against)
- `confidence`: 'high' if clean single-zone run, 'low' if concurrent activity detected

---

### hydrawise-api.js

**Purpose:** Wrapper for Hydrawise REST API v1 with rate limiting, circuit breaker, retry logic

**Current State:** Functional, exports 5 functions

**Called By:** `poll.js` (primary consumer), `server.js` (planned), calibration modules (future)

**Recommendation: Mixed — per-function analysis**

#### `setzone({controllerId, relay, action, durationSec})` → **KEEP**
- **Why:** Write-side API call, independent of flow readings
- **Usage:** Phase 4b scheduling cutover depends on this
- **No changes needed**

#### `getFlowReading(controllerId)` → **DELETE**
- **Why:** Attempts to read `runningRelay.flow` field that does not exist in REST API v1
- **Current Usage:** Not called anywhere (stub implementation)
- **Evidence:** Investigation in `docs/hydrawise-api-flow-fields.md` proved field never appears
- **Migration:** Remove function, no callers to update

#### `getActiveZones(controllerId)` → **KEEP**
- **Why:** Returns list of running zones based on `time=1` and `timestr="Now"` status fields
- **Usage:** Used by `poll.js` for zone state tracking
- **No changes needed**

#### `getControllerStatus(controllerId)` → **KEEP**
- **Why:** Returns `reachable`, `online`, `lastContact`, `anyActive` — all status-based, no flow data
- **Usage:** Core polling function, used by `poll.js`
- **No changes needed**

#### `verifyProgramsSuspended(controllerIds)` → **KEEP**
- **Why:** Phase 4b function for ensuring Hydrawise schedules are disabled
- **Current State:** Placeholder implementation (`return {suspended: true}`)
- **Usage:** Needed for Phase 4b conflict detection
- **No changes needed**

**Summary for hydrawise-api.js:**
- DELETE: `getFlowReading()` function only
- KEEP: All other exports unchanged
- UPDATE: Module-level comment to note flow data unavailability

---

## 2. SCHEMA ADDITIONS FROM PHASE 4A

### watering_events.flow_source (TEXT NOT NULL DEFAULT 'direct')

**Purpose (Phase 4a):** Track whether flow measurement came from zone's own meter ('direct'), attributed from another controller ('attributed'), estimated from config ('estimated'), or ambiguous ('ambiguous')

**Under New Architecture:**
- All values become 'calculated' — no real-time meter readings, only config-based GPM × runtime
- Existing rows with 'direct', 'good', etc. are semantically wrong under new model

**Recommendation: RELABEL**

**Migration Strategy:**
```sql
-- Update default value
ALTER TABLE watering_events ALTER COLUMN flow_source SET DEFAULT 'calculated';

-- Backfill existing rows
UPDATE watering_events SET flow_source = 'calculated' WHERE flow_source IN ('direct', 'attributed', 'estimated', 'ambiguous');
```

**New Semantics:**
- 'calculated' = gallons computed as `gpm × (duration_seconds / 60)` using zones.config.js GPM value

---

### watering_events.flow_quality (TEXT NOT NULL DEFAULT 'good')

**Purpose (Phase 4a):** Track confidence in flow measurement for Kz learning weighting ('good'=1.0, 'degraded'=0.5, 'estimated'=ignore)

**Under New Architecture:**
- No flow measurements, only calculated values
- Phase 5 Kz learning will trust all watering events equally (no degradation concept)

**Recommendation: RELABEL**

**Migration Strategy:**
```sql
-- Update default value
ALTER TABLE watering_events ALTER COLUMN flow_quality SET DEFAULT 'calculated';

-- Backfill existing rows
UPDATE watering_events SET flow_quality = 'calculated' WHERE flow_quality IN ('good', 'degraded', 'estimated');
```

**New Semantics:**
- 'calculated' = water volume derived from static GPM config, not measured
- Phase 5 Kz learning treats all 'calculated' events with weight 1.0 (trust the config GPM)

**Alternative:** Change to 'estimated' to be more honest that GPM values are approximations. User feedback from Phase 5 will refine them.

---

### watering_events.flow_source_controller_id (INTEGER)

**Purpose (Phase 4a):** When flow_source='attributed', track which controller's meter provided the reading (e.g., Garage meter for Pool Equipment zones)

**Under New Architecture:**
- No attribution, so column is always NULL or semantically meaningless

**Recommendation: DELETE**

**Migration Strategy:**
```sql
-- Option 1: Drop column (clean break)
ALTER TABLE watering_events DROP COLUMN flow_source_controller_id;

-- Option 2: Keep for historical data (if any Phase 4a test runs populated it)
-- Set to NULL going forward, preserve existing values
UPDATE watering_events SET flow_source_controller_id = NULL WHERE flow_source_controller_id IS NOT NULL;
-- Add comment: "Historical column from deprecated attribution system"
```

**Preferred:** Option 1 (drop column) — cleaner, no runtime dependencies

---

### controller_flow_meter_health (state table)

**Purpose (Phase 4a):** Track per-controller flow meter reliability (healthy vs unhealthy) based on automated meter reading validation

**Fields:** `controller_id`, `is_healthy`, `last_assessed`, `valid_fraction`, `sample_count`, `reason`

**Under New Architecture:**
- No meter readings → no automated health assessment
- Always shows "not assessed" or "unknown"

**Recommendation: DELETE**

**Justification:**
- Automated health tracking requires real-time flow readings (unavailable)
- Manual tracking ("meter looks broken in Hydrawise UI") belongs in `zones.config.js` as `flowMeterHealthy` field (already exists)
- No runtime code depends on this table (Phase 4a poll.js integration never shipped)

**Migration Strategy:**
```sql
DROP TABLE controller_flow_meter_health;
```

**Alternative Consideration:**
Could repurpose for manual observations:
- User sees Hydrawise UI showing broken meter → manually INSERT unhealthy status
- But this is redundant with `zones.config.js` `flowMeterHealthy` field
- Not worth keeping table for manual-only updates

**Decision needed:** Confirm no historical data worth preserving before drop

---

### controller_flow_meter_health_log (transition log)

**Purpose (Phase 4a):** Log healthy↔unhealthy transitions for meter debugging

**Fields:** `id`, `controller_id`, `timestamp`, `transitioned_to`, `valid_fraction`, `sample_count`, `reason`

**Under New Architecture:**
- Follows parent table (controller_flow_meter_health) — if parent is deleted, log is orphaned

**Recommendation: DELETE**

**Migration Strategy:**
```sql
DROP TABLE controller_flow_meter_health_log;
```

---

### flow_attribution_warnings

**Purpose (Phase 4a):** Log when poll.js can't confidently attribute a flow reading (multiple zones active, gate not open, unattributed flow, etc.)

**Fields:** `id`, `timestamp`, `source_controller_id`, `flow_gpm`, `active_zones_json`, `reason`, `notes`

**Reason Values:** 'multiple_attributed', 'gate_not_open', 'concurrent_local_zone', 'unattributed_flow', 'gate_open_no_consumer'

**Under New Architecture:**
- No attribution → no attribution warnings
- Pure Phase 4a artifact

**Recommendation: DELETE**

**Migration Strategy:**
```sql
DROP TABLE flow_attribution_warnings;
```

---

### z5_selftest_log

**Purpose (Phase 4a):** Log Z5 cap integrity self-tests (passed/failed, max GPM observed)

**Fields:** `id`, `timestamp`, `passed`, `max_gpm`, `sample_count`, `reason`

**Under New Architecture:**
- Depends on `z5-startup-selftest.js` module (recommended for deletion)
- No way to execute self-test without real-time flow readings

**Recommendation: DELETE**

**Migration Strategy:**
```sql
DROP TABLE z5_selftest_log;
```

---

### flow_calibration_log

**Purpose (Phase 4a):** Log Pool Equipment zone GPM calibration runs using Garage meter attribution

**Fields:** `id`, `timestamp`, `controller_id`, `zone_relay`, `duration_sec`, `meter_gpm`, `meter_stddev`, `sample_count`, `tank_gpm`, `tank_drawdown_gal`, `ditch_fill_gal`, `agreement_pct`, `confidence`, `notes`

**Under New Architecture (Tank-Drawdown Calibration):**

This schema **perfectly fits** the new approach! Field mapping:

| Field | Phase 4a Usage | New Usage |
|-------|----------------|-----------|
| `timestamp` | When calibration ran | Same |
| `controller_id` | Controller being calibrated | Same |
| `zone_relay` | Zone being calibrated | Same |
| `duration_sec` | How long zone ran | Same |
| `meter_gpm` | Garage meter reading | NULL (no meter) or future GraphQL data |
| `meter_stddev` | Meter reading variance | NULL |
| `sample_count` | Number of meter samples | NULL or 1 (single tank observation) |
| `tank_gpm` | Tank drawdown cross-check | **PRIMARY MEASUREMENT** |
| `tank_drawdown_gal` | Measured tank drop | Same (measured via tank_level_log) |
| `ditch_fill_gal` | Ditch fill during run | Same (5.77 GPM × duration) |
| `agreement_pct` | Meter vs tank agreement | N/A (no meter to compare) |
| `confidence` | 'high'/'medium'/'low' | 'high' if clean run, 'low' if noisy |
| `notes` | Free text | Same (capture anomalies) |

**Recommendation: KEEP (with semantic shift)**

**New Semantics:**
- `tank_gpm` becomes the authoritative measured value (not a "cross-check")
- `meter_gpm` is NULL until/unless GraphQL API access obtained
- `confidence` is based on run cleanliness (no concurrent zones, stable tank readings) not meter/tank agreement

**No Schema Changes Needed** — existing structure works as-is

**Update:** Documentation and code comments to reflect tank-drawdown as primary method

---

## 3. zones.config.js

### flowMeterAttribution Block (POOL_EQUIP)

**Current Content:**
```javascript
flowMeterAttribution: {
  sourceControllerId: 1659477,
  sourceMeterRelay: null,
  gatingRelay: 5,
  gatingZoneName: 'Garage Z5 (capped dummy)',
  gateBufferSec: 30,
  gateStaggerMs: 2000,
  reason: 'Pool Equip meter unreliable; Pool zones are downstream of Garage flow meter',
  establishedAt: '2026-05-11',
  degradationBehavior: 'estimate',
  estimateSource: 'zones.config.js gpm field'
}
```

**Recommendation: DELETE**

**Justification:**
- Entire attribution mechanism obsolete
- No runtime code depends on this (Phase 4a poll.js integration never shipped)
- Removal simplifies config, removes ~90 lines of now-misleading documentation

**Migration:**
```javascript
// REMOVE entire flowMeterAttribution block from POOL_EQUIP controller config
```

---

### hasFlowMeter and flowMeterHealthy Fields

**Current:**
```javascript
{ id: 1659477, name: 'Loomis Garage', hasFlowMeter: true, flowMeterHealthy: true, ... }
{ id: 1977673, name: 'Loomis Pool Equipment', hasFlowMeter: true, flowMeterHealthy: false, ... }
{ id: 1970558, name: 'Loomis barn', hasFlowMeter: false, flowMeterHealthy: null, ... }
```

**Purpose (Phase 4a):** Runtime flag for poll.js to decide whether to read flow vs estimate

**Under New Architecture:**
- No runtime polling of flow data
- Fields become **informational only** — "does Hydrawise UI show a flow meter icon"

**Recommendation: KEEP but RELABEL meaning**

**New Semantics:**
- `hasFlowMeter`: Does the controller have a physical flow meter installed (visible in Hydrawise UI)?
- `flowMeterHealthy`: Best-knowledge status from manual observation (true = UI shows plausible values, false = UI shows broken/zero, null = unknown/not checked)
- Used for: Documentation, future GraphQL exploration, human reference
- NOT used for: Runtime flow logic (no flow logic exists)

**Update:**
```javascript
// Add comment above fields:
// hasFlowMeter: Physical meter installed (informational; REST API v1 does not expose flow data)
// flowMeterHealthy: Manual observation from Hydrawise UI (true=working, false=broken, null=unknown)
```

**Values Stay Same:** No code changes, just updated comments

---

### Garage Z5 Special Role Marking

**Current:**
```javascript
{ 
  relay_id: 5, 
  zone_id: 'Z5', 
  name: 'Garage Z5 (capped dummy)', 
  type: 'system', 
  gpm: 0, 
  capped: true, 
  cappedAt: '2026-05-11', 
  role: 'attribution_gate' 
}
```

**Comment Above:**
```javascript
// SYSTEM CRITICAL: Z5 is capped and serves as the attribution gate for Pool Equipment flow metering.
// DO NOT uncap or modify without coordination with flow attribution logic.
```

**Under New Architecture:**
- Z5 is still physically capped (valve opens but cap prevents water flow)
- No longer "system critical" — accidental activation just delivers zero water (harmless)
- No special role in system architecture

**Recommendation: DELETE role marking, KEEP capped flag, RELABEL comment**

**New Config:**
```javascript
{ 
  relay_id: 5, 
  zone_id: 'Z5', 
  name: 'Garage Z5 (capped dummy)', 
  type: 'system', 
  gpm: 0, 
  capped: true, 
  cappedAt: '2026-05-11'
  // Remove: role: 'attribution_gate'
}
```

**New Comment:**
```javascript
// Z5 is physically capped (as of 2026-05-11) to prevent water delivery.
// If accidentally activated, valve opens but cap blocks flow (harmless).
```

---

### groupControllersByAttribution() Helper

**Current:**
```javascript
groupControllersByAttribution() {
  return {
    'garage-pool-shared': ['Loomis Garage', 'Loomis Pool Equipment'],
    'barn-solo': ['Loomis barn']
  };
}
```

**Purpose (Phase 4a):** Define which controllers share a flow meter timeline (serialized valve operations for attribution)

**Under New Architecture:**
- No attribution → no attribution groups
- No runtime code depends on this

**Recommendation: DELETE**

**Migration:**
```javascript
// Remove entire function from module.exports
// Remove function definition
```

---

## 4. SERVER.JS DASHBOARD ENDPOINTS

### /api/dashboard/events

**Current Response (per event):**
```javascript
{
  timestamp, controller, zoneId, zoneName, zoneType, relayId,
  durationSeconds, gallons,
  configuredGpm: zone.gpm,           // From zones.config.js
  measuredFlowGpm: row.flow_gpm,     // From watering_events.flow_gpm
  flowQuality: row.flow_quality,     // From watering_events.flow_quality
  flowSource: row.flow_source        // From watering_events.flow_source
}
```

**Under New Architecture:**
- `measuredFlowGpm` is NULL (watering_events.flow_gpm is never populated without real-time readings)
- `flowQuality` always 'calculated'
- `flowSource` always 'calculated'

**Recommendation: RELABEL**

**Option A — Rename Field (Honest Terminology):**
```javascript
{
  configuredGpm: zone.gpm,           // Static value from config (accurate label)
  estimatedGpm: zone.gpm,            // Same value, different label (emphasizes approximation)
  flowQuality: 'calculated',         // Always calculated (no variation)
  flowSource: 'calculated'           // Always calculated (no variation)
}
```

**Option B — Remove Redundant Fields:**
```javascript
{
  configuredGpm: zone.gpm,           // Only field needed (measuredGpm removed)
  // flowQuality removed (always 'calculated', provides no information)
  // flowSource removed (always 'calculated', provides no information)
}
```

**Recommendation: Option B** — Remove `measuredFlowGpm`, `flowQuality`, `flowSource` from API response. Keep only `configuredGpm`.

**Justification:**
- `flowQuality` and `flowSource` are always the same value → no information content
- Dashboard consumers don't need to know *how* gallons were calculated, just the GPM used
- Simplifies API, reduces confusion

**Migration:**
```javascript
// In /api/dashboard/events endpoint:
const events = rows.map(row => {
  const key = `${row.controller}:${row.zone_id}`;
  const zone = zoneMap.get(key);

  return {
    timestamp: new Date(row.timestamp * 1000).toISOString(),
    controller: row.controller,
    zoneId: row.zone_id,
    zoneName: zone ? zone.name : null,
    zoneType: zone ? zone.type : null,
    relayId: row.relay_id,
    durationSeconds: row.duration_seconds,
    gallons: row.gallons,
    configuredGpm: zone ? zone.gpm : null
    // REMOVE: measuredFlowGpm, flowQuality, flowSource
  };
});
```

**Frontend Impact:** public/index.html table columns need update (see next section)

---

## 5. PUBLIC/INDEX.HTML

### Events Table Headers (Lines 322-333)

**Current:**
```html
<th>Config GPM</th>
<th>Measured GPM</th>
<th>Flow Source</th>
<th>Flow Quality</th>
```

**Under New Architecture (Aligned with Server API Changes):**

**Recommendation: RELABEL and REMOVE**

**Option A — If Keeping All Columns:**
```html
<th>Configured GPM</th>
<th>Estimated GPM <span title="Calculated from configured GPM, not measured">ⓘ</span></th>
<th>Source</th>  <!-- Always "calculated" -->
<th>Quality</th> <!-- Always "calculated" -->
```

**Option B — Simplified (Recommended):**
```html
<th>GPM (from config)</th>
<!-- Remove Measured GPM, Flow Source, Flow Quality columns -->
```

**Recommendation: Option B** — Align with server.js Option B (remove redundant fields)

**Migration:**
```html
<!-- thead row -->
<th>When</th>
<th>Controller</th>
<th>Zone</th>
<th>Duration</th>
<th>Gallons</th>
<th>GPM (configured)</th>
<!-- REMOVE: Measured GPM, Flow Source, Flow Quality -->

<!-- tbody rendering -->
const rows = data.events.map(e => {
  const when = `${relativeTime((Date.now() - new Date(e.timestamp)) / 1000)}<br><small>${absoluteTime(e.timestamp)}</small>`;
  const zoneName = e.zoneName || '<span class="null-value">(unknown)</span>';
  const configGpm = e.configuredGpm !== null ? e.configuredGpm.toFixed(1) : '<span class="null-value">—</span>';

  return `
    <tr>
      <td>${when}</td>
      <td>${e.controller}</td>
      <td>${e.zoneId} (${zoneName})</td>
      <td>${formatDuration(e.durationSeconds)}</td>
      <td>${e.gallons ? e.gallons.toFixed(1) : '<span class="null-value">—</span>'}</td>
      <td>${configGpm}</td>
    </tr>
  `;
}).join('');
```

**Additional Honesty Marker:**

Tank section already has:
```html
<p style="...">
  Levels are calculated from polled flow data, not measured directly. 
  Phase 7 (ESP32 sensor) will add real readings.
</p>
```

Add similar note to events section:
```html
<section>
  <h2>Recent watering events — last 7 days</h2>
  <p style="margin-bottom: 12px; font-size: 13px; color: #7f8c8d;">
    GPM values are from configuration (zones.config.js), updated periodically via tank-drawdown calibration.
  </p>
  <div class="table-wrapper">
    ...
```

---

## 6. CLAUDE.MD

### Z5 Row in Garage Controller Table (Lines ~27-29)

**Current:**
```markdown
| Z5 | Attribution Gate (CAPPED) | System | 0.0 (capped 2026-05-11) |

**Z5 CRITICAL:** Capped and serves as attribution gate for Pool Equipment flow metering. 
Valve opens for gating signal but cap prevents flow. Self-test on startup verifies cap 
integrity (<0.3 GPM). **DO NOT uncap without coordinating with flow attribution logic.**
```

**Recommendation: REWRITE**

**New Text:**
```markdown
| Z5 | Dummy (Capped) | System | 0.0 (capped 2026-05-11) |

**Note:** Z5 is physically capped to prevent water delivery. If accidentally activated, 
the valve opens but the cap blocks flow (harmless).
```

---

### Pool Equipment Flow Meter Status (Lines ~35-36)

**Current:**
```markdown
### Pool Equipment Controller (id: 1977673) — physical flow meter broken; flow attributed 
to Garage meter via Z5 gating (per Phase 4a, 2026-05-11)
```

**Recommendation: REWRITE**

**New Text:**
```markdown
### Pool Equipment Controller (id: 1977673) — physical flow meter non-functional; GPM values 
maintained in zones.config.js, updated via tank-drawdown calibration
```

---

### Key Design Decisions — Pool Equipment Attribution Entry (Lines ~251-256)

**Current:**
```markdown
8. **Pool Equipment flow attribution (Phase 4a)** — Pool Equipment controller's broken flow 
meter is worked around by attributing flow to the Garage flow meter. When a Pool zone runs, 
capped Garage Z5 opens first (providing a gating signal), then the Pool zone opens. The 
Garage meter's incremental flow is attributed to the Pool zone. This allows accurate GPM 
measurement and water usage tracking despite the broken Pool Equipment meter. Garage and 
Pool Equipment share a serialized valve timeline (attribution group). **Garage Z5 is 
system-critical and must remain capped.**
```

**Recommendation: DELETE entire entry, REPLACE with new decision**

**New Entry:**
```markdown
8. **GPM values are static configuration** — Hydrawise REST API v1 does not expose real-time 
flow meter data (investigation: docs/hydrawise-api-flow-fields.md). GPM per zone is manually 
maintained in zones.config.js. All water volume calculations (gallons, tank drawdown, 
scheduling targets) are labeled "calculated" and derived as `gpm × runtime_minutes`. GPM 
values are periodically updated via tank-drawdown calibration when emitter configuration 
changes (run zone, measure tank before/after, subtract ditch fill contribution, compute GPM).
```

---

### Implementation Phases Table (Lines ~103-112)

**Current:**
```markdown
| Phase | Status | Description |
|-------|--------|-------------|
...
| 3 | ⏸️ Paused | Twilio SMS (resuming after 4a) — account created, credentials needed |
| 4a | 🔄 Active | Attribution infrastructure (schema, config, modules, calibration) |
| 4b | ⬜ Pending | Scheduling cutover via Hydrawise setzone API |
...
```

**Recommendation: REWRITE**

**New Table:**
```markdown
| Phase | Status | Description |
|-------|--------|-------------|
...
| 3 | ⏸️ Paused | Twilio SMS (resuming after 4) — account created, credentials needed |
| 4 | ⬜ Pending | Scheduling cutover via Hydrawise setzone API; includes GPM calibration |
...
```

**Note Entry After Table:**
```markdown
*Phase 4a (attribution infrastructure) was planned but discontinued after discovering 
Hydrawise REST API v1 does not expose real-time flow data. See 
docs/hydrawise-api-flow-fields.md. GPM calibration work redirected to tank-drawdown 
method (part of Phase 4 prep).*
```

---

### Database Schema Table (Lines ~86-103)

**Current (Partial):**
```markdown
| Table | Phase | Purpose |
|-------|-------|---------|
...
| flow_attribution_warnings | 4a | Flow attribution ambiguity events |
| controller_flow_meter_health | 4a | Per-controller meter health state |
| controller_flow_meter_health_log | 4a | Meter health transition log |
| z5_selftest_log | 4a | Z5 cap integrity self-tests |
| flow_calibration_log | 4a | Pool Equipment zone GPM measurements |
```

**Recommendation: REWRITE**

**New Rows:**
```markdown
| flow_calibration_log | 4 | Tank-drawdown GPM calibration runs |
```

**Remove:**
- `flow_attribution_warnings` (table deleted)
- `controller_flow_meter_health` (table deleted)
- `controller_flow_meter_health_log` (table deleted)
- `z5_selftest_log` (table deleted)

**Update watering_events Row:**
```markdown
| watering_events | 0 | Completed zone runs; Phase 4 added flow_source/flow_quality (always 'calculated') |
```

**Update Header:**
```markdown
## Database Schema (15 tables)
```
(18 tables - 4 deleted + 1 repurposed = 15 tables)

---

### Open To-Dos (Lines ~309-322)

**Current:**
```markdown
- [x] ~~Verify Garage Z5 "Dummy Flow Test"~~ — Z5 capped and designated as attribution 
      gate (Phase 4a)
...
- [ ] Run Phase 4a calibration for all 11 Pool Equipment zones (Wave 6 - human supervised)
- [ ] Decide pm2 Z5 self-test wiring (Wave 7 - irrigation-poll vs irrigation-server)
```

**Recommendation: REWRITE**

**Updated To-Dos:**
```markdown
- [x] ~~Verify Garage Z5 "Dummy Flow Test"~~ — Z5 capped 2026-05-11 (no longer special-purpose)
...
- [ ] Calibrate Pool Equipment zone GPMs via tank-drawdown method (before Phase 4 scheduling)
  - Run each zone for 5 min, measure tank before/after, subtract ditch fill (5.77 GPM × time)
  - Update zones.config.js with measured GPM values
- [ ] Calibrate Garage zone GPMs via same method (if emitter config changes)
```

**Remove:**
```markdown
- [ ] Decide pm2 Z5 self-test wiring (Wave 7 - ...) — OBSOLETE, self-test cannot execute without flow data
```

---

## 7. .PLANNING/ ARTIFACTS

### ROADMAP.md — Phase 4a Section (Lines 72-122)

**Current:**
```markdown
## Phase 4a: Attribution Infrastructure

**Goal:** Land all schema, config, and module changes required to support flowMeterAttribution...

**Status:** 🔄 Active
...

### Tasks
4a.1 Schema Migrations
4a.2 zones.config.js Patch
4a.3 z5-startup-selftest.js Module
4a.4 flow-calibration.js Module
4a.5 CLAUDE.md Update
4a.6 Calibration Runs (after 4a.1–4a.5 land)
4a.7 Decide pm2 Process Wiring (deferred)
```

**Recommendation: MARK AS HISTORICAL (collapsed section)**

**New Text:**
```markdown
## ~~Phase 4a: Attribution Infrastructure~~ (DISCONTINUED)

**Status:** ❌ Discontinued (2026-05-12)

**Reason:** Hydrawise REST API v1 does not expose real-time flow meter data 
(investigation: docs/hydrawise-api-flow-fields.md). The flowMeterAttribution mechanism 
cannot be implemented without live flow readings. Architecture changed to static GPM 
values in zones.config.js, updated via tank-drawdown calibration.

**Work Redirected To:**
- GPM calibration → Tank-drawdown method (see Phase 4 prep tasks)
- Schema/config infrastructure → Removed (not needed under new architecture)

<details>
<summary>Original Phase 4a Plan (for historical reference)</summary>

[Collapse original 4a.1–4a.7 task list here]

</details>
```

---

### ROADMAP.md — Phase 4b Becomes Phase 4 (Lines 123-194)

**Current:**
```markdown
## Phase 4b: Scheduling Cutover

**Goal:** Replace Hydrawise programs with software-owned scheduling

**Status:** ⬜ Pending
**Blockers:** Phase 4a complete, Phase 3 complete, setzone API design finalized
```

**Recommendation: RENAME to Phase 4, UPDATE blockers**

**New Text:**
```markdown
## Phase 4: Scheduling Cutover

**Goal:** Replace Hydrawise programs with software-owned ET-based scheduling

**Status:** ⬜ Pending
**Blockers:** Phase 3 complete (SMS commands), GPM calibration complete (tank-drawdown method)

### Prep Work (Before Phase 4 Begins)

**GPM Calibration via Tank-Drawdown:**
- [ ] Calibrate all Pool Equipment zones (11 zones)
  - Run zone for 5 minutes via setzone API
  - Record tank level before/after from tank_level_log
  - Subtract ditch fill: net_drawdown = actual_drawdown - (5.77 GPM × 5 min)
  - Compute: gpm = net_drawdown / 5 min
  - Log to flow_calibration_log table
  - Update zones.config.js with measured GPM
- [ ] Calibrate Garage zones if emitter config changed
- [ ] Review: At least 18/22 zones should have calibrated GPM (not estimates)

### Tasks

**4.1 setzone API Integration**
[Existing 4b.1 tasks unchanged]

**4.2 Daily Scheduling Algorithm**
[Existing 4b.2 tasks, remove references to "attribution"]

**4.3 ~~Flow Meter Attribution Runtime~~**
**REMOVE** — No longer applicable

**4.4 Tank Safety Logic**
[Existing 4b.4 tasks unchanged]

**4.5 Rain/Weather Skip**
[Existing 4b.5 tasks unchanged]

**4.6 Program Suspension**
[Existing 4b.6 tasks unchanged]

**4.7 Execution Engine**
[Existing 4b.7 tasks unchanged]

**4.8 Testing**
[Existing 4b.8 tasks, remove attribution test]

**4.9 Web Dashboard**
[Existing 4b.9 tasks unchanged]
```

---

### STATE.md — Current Phase (Lines 9-15)

**Current:**
```markdown
## Current Phase

**Phase 4a: Attribution Infrastructure**
- Status: 🔄 Active
- Started: 2026-05-11
- Target Completion: 3-5 sessions
- Priority Shift: Phase 3 (Twilio SMS) paused to unblock Phase 4b infrastructure needs
```

**Recommendation: REWRITE**

**New Text:**
```markdown
## Current Phase

**None (Between Phases)**
- Last Completed: Phase 2 (Zone Coefficient Model)
- Next Up: Phase 3 (Twilio SMS) or GPM Calibration prep for Phase 4
- Status: Phase 4a (attribution infrastructure) was discontinued 2026-05-12 after 
  investigation proved Hydrawise REST API v1 does not expose real-time flow data. 
  See docs/hydrawise-api-flow-fields.md.
```

---

### STATE.md — Recent Decisions (Lines 112-120)

**Current:**
```markdown
**2026-05-11:**
- GSD planning initialized for Phases 3-7
- **Phase 4 split into 4a (Attribution Infrastructure) and 4b (Scheduling Cutover)**
- **Priority shift: Phase 4a active, Phase 3 paused**
- Phase 4a is additive only: schema migrations and config changes don't affect runtime 
  behavior until Phase 4b poll.js/scheduler.js changes ship
```

**Recommendation: ADD new decision, KEEP old for history**

**New Entry:**
```markdown
**2026-05-12:**
- **Phase 4a discontinued** — Hydrawise REST API v1 does not expose real-time flow meter 
  data (22-sample investigation over active zone run, zero flow fields found). Attribution 
  infrastructure cannot be implemented.
- **Architecture change:** GPM values are static configuration in zones.config.js, 
  updated via tank-drawdown calibration (run zone, measure tank delta, subtract ditch fill, 
  compute GPM). All water calculations labeled "calculated."
- **Phase 4a/4b split dissolved:** Phase 4b becomes "Phase 4" (scheduling cutover). 
  GPM calibration becomes prep work for Phase 4.
- **Modules deleted:** z5-startup-selftest.js, getFlowReading() from hydrawise-api.js
- **Tables deleted:** flow_attribution_warnings, controller_flow_meter_health, 
  controller_flow_meter_health_log, z5_selftest_log
- **Modules repurposed:** flow-calibration.js → tank-drawdown-calibration.js (schema kept)
```

---

### .planning/phases/4a/PLAN.md

**Current:** Full 476-line execution plan for Phase 4a

**Recommendation: MARK AS HISTORICAL**

**Add Header Note:**
```markdown
---
phase: 4a-attribution-infrastructure
type: phase-plan
status: **DISCONTINUED**
created: 2026-05-11
discontinued: 2026-05-12
---

# ⚠️ HISTORICAL DOCUMENT — DO NOT EXECUTE

**This plan was discontinued on 2026-05-12** after investigation proved Hydrawise REST 
API v1 does not expose real-time flow meter data (see docs/hydrawise-api-flow-fields.md). 
The flowMeterAttribution mechanism cannot be implemented.

**Superseded By:** Tank-drawdown GPM calibration (prep work for Phase 4, see ROADMAP.md)

**Preserved For:** Historical reference and architectural decision record

---

[Original plan content follows...]
```

---

## 8. TESTS AND DOCUMENTATION

### coefficient-model.test.js

**References Phase 4a?** No

**Recommendation:** No changes needed

---

### et-engine.test.js

**References Phase 4a?** No

**Recommendation:** No changes needed

---

### docs/hydrawise-api-flow-fields.md

**Purpose:** Investigation report proving Hydrawise REST API v1 does not expose flow data

**Status:** This is the **authoritative decision document** that triggered this audit

**Recommendation:** KEEP AS-IS — this document explains *why* Phase 4a was discontinued

**Optional Addition:** Add frontmatter linking to this audit:
```markdown
---
date: 2026-05-12
type: investigation
impact: Phase 4a discontinued, architecture changed to static GPM
related: docs/phase-4a-audit.md
---
```

---

## 9. SUMMARY

### High-Level Action Counts

| Category | DELETE | REPURPOSE | RELABEL | KEEP | TOTAL |
|----------|--------|-----------|---------|------|-------|
| **Modules** | 2 | 1 | 0 | 1 | 4 |
| **Functions (hydrawise-api.js)** | 1 | 0 | 0 | 4 | 5 |
| **Tables** | 4 | 1 | 0 | 0 | 5 |
| **Columns (watering_events)** | 1 | 0 | 2 | 0 | 3 |
| **zones.config.js Items** | 2 | 0 | 2 | 0 | 4 |
| **API Endpoints** | 0 | 0 | 1 | 2 | 3 |
| **Dashboard Columns** | 3 | 0 | 1 | 1 | 5 |
| **CLAUDE.md Sections** | 1 | 0 | 7 | 0 | 8 |
| **Planning Docs** | 0 | 0 | 3 | 1 | 4 |
| **TOTAL** | **14** | **2** | **16** | **9** | **41** |

---

### Recommended Refactor Order

**Wave 1: Schema Cleanup (migrations required)**
1. Drop tables: `flow_attribution_warnings`, `controller_flow_meter_health`, `controller_flow_meter_health_log`, `z5_selftest_log`
2. Drop column: `watering_events.flow_source_controller_id`
3. Update defaults: `watering_events.flow_source` → 'calculated', `flow_quality` → 'calculated'
4. Backfill existing rows: `UPDATE watering_events SET flow_source='calculated', flow_quality='calculated'`

**Wave 2: Code Cleanup (no runtime impact)**
5. Delete module: `z5-startup-selftest.js`
6. Delete function: `hydrawise-api.js::getFlowReading()`
7. Repurpose module: `flow-calibration.js` → `tank-drawdown-calibration.js` (rewrite core logic)

**Wave 3: Configuration Cleanup**
8. Delete from `zones.config.js`:
   - POOL_EQUIP `flowMeterAttribution` block
   - `groupControllersByAttribution()` function
9. Update Z5 config: remove `role: 'attribution_gate'`, update comment
10. Update controller field comments: `hasFlowMeter`/`flowMeterHealthy` → informational only

**Wave 4: API/Dashboard Alignment**
11. Update `server.js` `/api/dashboard/events`: remove `measuredFlowGpm`, `flowQuality`, `flowSource` from response
12. Update `public/index.html`: remove "Measured GPM", "Flow Source", "Flow Quality" columns; add GPM honesty note

**Wave 5: Documentation Updates**
13. Update `CLAUDE.md`: 8 sections (Z5 row, Pool Equipment header, Key Decisions, Phases table, Schema table, To-Dos, etc.)
14. Update `.planning/ROADMAP.md`: collapse Phase 4a, rename 4b→4, add prep tasks
15. Update `.planning/STATE.md`: update current phase, add 2026-05-12 decision
16. Add header to `.planning/phases/4a/PLAN.md`: mark as discontinued

**Wave 6: Verification**
17. Run tests: `node coefficient-model.test.js`, `node et-engine.test.js` — must pass
18. Start services: `pm2 restart all` — must start cleanly
19. Check dashboard: http://localhost:3001 — must render without errors
20. Verify database: `sqlite3 irrigation.db ".tables"` — should show 15 tables (not 19)

---

### Decisions Needed from Human Review

**1. flow_source and flow_quality Terminology**

**Question:** Should the new values be 'calculated' or 'estimated'?

**Options:**
- **'calculated'** = Emphasizes deterministic computation (gpm × time)
- **'estimated'** = Emphasizes uncertainty (GPM values are approximations)

**Impact:** Affects schema defaults, API responses, user-facing labels

**Recommendation:** 'calculated' for flow_source (it's deterministic), 'estimated' for flow_quality (acknowledges uncertainty in GPM calibration)

---

**2. flow_calibration_log Table Reuse**

**Question:** Keep the table for tank-drawdown calibration or create a new table?

**Options:**
- **A: Keep `flow_calibration_log`** — Schema fits, just shift semantics (meter_gpm=NULL, tank_gpm=primary)
- **B: Create `tank_drawdown_calibration_log`** — New table, cleaner separation

**Impact:** Schema migration complexity, code clarity

**Recommendation:** Option A (keep existing table) — schema is a perfect fit, less migration work, preserves any future GraphQL meter data path

---

**3. Garage Z5 Physical Cap**

**Question:** Should the physical cap stay on Garage Z5?

**Context:** Cap was installed to prevent flow during attribution gating. Attribution is dead, so Z5 could be uncapped and used as a real zone (if it has emitters).

**Options:**
- **A: Keep cap** — Prevents accidental water delivery if Z5 is activated (safety margin)
- **B: Remove cap, restore Z5 as functional zone** — Gain an extra zone if it has usable emitters

**Impact:** Physical hardware change, zones.config.js `capped` flag, potential new irrigation coverage

**Recommendation:** Human decision — inspect Z5 physical setup. If it has no emitters downstream of the valve, keep cap (harmless). If it could be a useful zone, remove cap and restore.

---

**4. controller_flow_meter_health Tables**

**Question:** Delete immediately or preserve for manual observations?

**Options:**
- **A: Delete tables** — Clean break, use zones.config.js `flowMeterHealthy` field for manual tracking
- **B: Keep tables for manual logging** — Allow human to INSERT meter health observations from Hydrawise UI

**Impact:** Database schema, manual observation workflow

**Recommendation:** Option A (delete) — Redundant with zones.config.js, adds maintenance burden, no automated use case

---

**5. Phase Numbering After 4a Removal**

**Question:** Keep Phase 4b as "Phase 4b" or renumber to "Phase 4"?

**Options:**
- **A: Renumber 4b→4** — Cleaner numbering (Phases 3, 4, 5, 6, 7)
- **B: Keep as 4b** — Preserves historical references in commits/docs

**Impact:** Documentation consistency, git history clarity

**Recommendation:** Option A (renumber to Phase 4) — Simpler for future readers, 4a becomes a historical footnote

---

**6. Migration Strategy — All at Once vs Incremental**

**Question:** Should the refactor land as:
- **A: One large PR** — All changes together, single atomic cutover
- **B: Multiple PRs** — Schema first, then code, then docs (incremental)

**Options:**
- **A: Atomic** — Lower risk of inconsistent state, but large review surface
- **B: Incremental** — Easier review, but requires care to avoid broken intermediate states

**Impact:** Review process, rollback complexity, testing burden

**Recommendation:** Option B (incremental) with careful ordering:
1. PR1: Schema migrations (tables/columns) — backward compatible (adds/removes unused things)
2. PR2: Code cleanup (modules, functions) — depends on PR1
3. PR3: Config cleanup (zones.config.js) — depends on PR2
4. PR4: API/dashboard (server.js, index.html) — depends on PR3
5. PR5: Documentation (CLAUDE.md, planning/) — final sync

**Rationale:** Each PR is independently testable, rollback is easier, review is manageable

---

### Estimated Scope

**Files Modified:** 13
- Delete: 1 module (z5-startup-selftest.js)
- Modify: 12 files (hydrawise-api.js, flow-calibration.js, zones.config.js, db.js, server.js, index.html, CLAUDE.md, ROADMAP.md, STATE.md, PLAN.md, 3 migration files)

**Files Deleted:** 1 (z5-startup-selftest.js)

**New Migrations:** 1 (down-migration to drop 4 tables, 1 column, update 2 defaults)

**Schema Changes:**
- Tables dropped: 4
- Columns dropped: 1
- Defaults changed: 2
- Rows backfilled: All in `watering_events`

**Documentation Updates:** 8 sections in CLAUDE.md, 3 planning docs

**Lines Changed (estimate):**
- Added: ~150 (new calibration logic in flow-calibration.js, migration SQL, doc updates)
- Deleted: ~800 (z5-startup-selftest.js ~180 lines, attribution config ~90 lines, 4 tables worth of comments, planning docs)
- Modified: ~200 (relabeling, comment updates)

**Net Code Reduction:** ~450 lines (good — simpler codebase)

---

### Risks

**Risk 1: Existing Data in Attribution Tables**

**Scenario:** If any Phase 4a test runs populated `z5_selftest_log`, `flow_calibration_log`, etc. with data, dropping tables loses that data.

**Mitigation:**
1. Before migration, export tables: `sqlite3 irrigation.db ".dump z5_selftest_log" > z5_selftest_backup.sql`
2. Review: any valuable data to preserve?
3. If yes, export to CSV and document in `docs/phase-4a-historical-data.md`
4. Then drop tables

**Likelihood:** Low (Phase 4a never executed calibration runs)

---

**Risk 2: Breaking Live Polling**

**Scenario:** Schema changes during live service operation could crash poll.js or server.js

**Mitigation:**
1. Run migrations during maintenance window
2. Stop pm2 services before migration: `pm2 stop all`
3. Apply migrations
4. Restart services: `pm2 restart all`
5. Monitor logs: `pm2 logs --lines 50`

**Likelihood:** Medium — test migrations on dev database first

---

**Risk 3: Frontend Breaking Before Backend Deployed**

**Scenario:** If API changes (remove measuredFlowGpm) deploy before frontend changes, dashboard breaks

**Mitigation:**
- **Backward-compatible transition:** Keep `measuredFlowGpm` in API as `null` for one deploy cycle, then remove
- **Atomic deployment:** Deploy API + frontend together (same commit)

**Recommendation:** Atomic deployment (both changes in one PR, deployed together)

---

**Risk 4: Forgetting to Update a Reference**

**Scenario:** A file references Phase 4a attribution that wasn't caught in the audit

**Mitigation:**
- **Grep for references** before finalizing refactor:
  ```bash
  grep -r "attribution" --include="*.js" --include="*.md" .
  grep -r "Phase 4a" --include="*.md" .
  grep -r "flow_source_controller_id" .
  grep -r "getFlowReading" .
  ```
- **Test suite:** Verify no broken imports after deletions
- **Runtime smoke test:** Start services, trigger API endpoints, check logs

---

## 10. FINAL CHECKLIST

Before executing refactor, verify:

- [ ] Human decisions made (6 questions in section 9)
- [ ] Dev database backup created: `cp irrigation.db irrigation.db.backup`
- [ ] Git branch created: `git checkout -b refactor/phase-4a-cleanup`
- [ ] All tests passing baseline: `node coefficient-model.test.js && node et-engine.test.js`
- [ ] Services stop cleanly: `pm2 stop all`

After executing refactor, verify:

- [ ] Database shows 15 tables (not 19): `sqlite3 irrigation.db ".tables"`
- [ ] watering_events defaults updated: `sqlite3 irrigation.db ".schema watering_events"`
- [ ] Modules load without errors: `node -e "require('./zones.config.js')"`
- [ ] Services start cleanly: `pm2 restart all`
- [ ] Tests still pass: `node coefficient-model.test.js && node et-engine.test.js`
- [ ] Dashboard renders: open http://localhost:3001, check console for errors
- [ ] API returns expected schema: `curl http://localhost:3001/api/dashboard/events?days=7 | jq '.events[0]'`

---

## APPENDIX: Migration SQL

### Down-Migration for Phase 4a Cleanup

**File:** `migrations/down_migration_phase_4a_cleanup.sql`

```sql
-- Migration: Phase 4a Cleanup (Down-Migration)
-- Date: 2026-05-12
-- Purpose: Remove Phase 4a attribution infrastructure after architectural pivot
-- Context: Hydrawise REST API v1 does not expose flow data (see docs/hydrawise-api-flow-fields.md)

-- Drop Phase 4a tables
DROP TABLE IF EXISTS flow_attribution_warnings;
DROP TABLE IF EXISTS controller_flow_meter_health;
DROP TABLE IF EXISTS controller_flow_meter_health_log;
DROP TABLE IF EXISTS z5_selftest_log;

-- Drop attribution column from watering_events
-- Note: flow_calibration_log is KEPT (repurposed for tank-drawdown calibration)
ALTER TABLE watering_events DROP COLUMN IF EXISTS flow_source_controller_id;

-- Update watering_events defaults and backfill existing rows
-- Default: 'calculated' (was 'direct' and 'good')
-- Note: SQLite doesn't support ALTER COLUMN SET DEFAULT directly, so we use a workaround

-- Workaround: Create new table with updated defaults, copy data, swap tables
BEGIN TRANSACTION;

CREATE TABLE watering_events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    controller TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    relay_id INTEGER,
    duration_seconds INTEGER,
    gallons REAL,
    flow_gpm REAL,
    flow_source TEXT NOT NULL DEFAULT 'calculated',
    flow_quality TEXT NOT NULL DEFAULT 'calculated',
    date TEXT
);

-- Copy data with backfilled values
INSERT INTO watering_events_new (id, timestamp, controller, zone_id, relay_id, duration_seconds, gallons, flow_gpm, flow_source, flow_quality, date)
SELECT 
    id, 
    timestamp, 
    controller, 
    zone_id, 
    relay_id, 
    duration_seconds, 
    gallons, 
    flow_gpm, 
    'calculated' AS flow_source,  -- Backfill existing rows
    'calculated' AS flow_quality,  -- Backfill existing rows
    date
FROM watering_events;

-- Swap tables
DROP TABLE watering_events;
ALTER TABLE watering_events_new RENAME TO watering_events;

COMMIT;

-- Verification queries (run manually after migration)
-- SELECT COUNT(*) FROM watering_events WHERE flow_source != 'calculated';  -- Should be 0
-- SELECT COUNT(*) FROM watering_events WHERE flow_quality != 'calculated'; -- Should be 0
```

---

**End of Audit**

Next step: Human reviews decisions, approves migration strategy, then refactor execution begins.
