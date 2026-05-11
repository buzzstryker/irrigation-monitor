---
phase: 4a-attribution-infrastructure
type: phase-plan
status: ready
created: 2026-05-11
---

# Phase 4a: Attribution Infrastructure — Detailed Plan

**Goal:** Land all schema, config, and module changes required to support flowMeterAttribution. Additive only — no runtime behavior change. Unblocks Phase 4b and the calibration runs that produce accurate Pool Equipment zone GPMs.

**Duration:** 3-5 sessions
**Priority:** High (blocks Phase 4b; accurate Pool Equip GPMs needed before summer scheduling)

---

## Task Breakdown

### 4a.1 Schema Migrations (Wave 1)

**Deliverable:** Three migration SQL files with new tables and columns

**Tasks:**

**4a.1.1 Create migration_flow_attribution.sql**
- [ ] CREATE TABLE flow_attribution_warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME NOT NULL, source_controller_id INTEGER NOT NULL, flow_gpm REAL, active_zones_json TEXT NOT NULL, reason TEXT NOT NULL, notes TEXT)
  - This table records ATTRIBUTION AMBIGUITY events (when poll.js can't confidently attribute a flow reading), NOT zone-level water-volume anomalies. Zone-anomaly logging belongs to the existing ``warnings`` table from Phase 0.
  - reason categorical: 'multiple_attributed' | 'gate_not_open' | 'concurrent_local_zone' | 'unattributed_flow' | 'gate_open_no_consumer'
- [ ] CREATE TABLE controller_flow_meter_health (controller_id INTEGER PRIMARY KEY, is_healthy INTEGER NOT NULL DEFAULT 1, last_assessed DATETIME NOT NULL, valid_fraction REAL, sample_count INTEGER, reason TEXT)
  - is_healthy: 0 = unhealthy, 1 = healthy (use INTEGER not BOOLEAN for explicit 0/1 storage)
  - One row per controller (state table, not log)
- [ ] CREATE TABLE controller_flow_meter_health_log (id INTEGER PRIMARY KEY AUTOINCREMENT, controller_id INTEGER NOT NULL, timestamp DATETIME NOT NULL, transitioned_to TEXT NOT NULL, valid_fraction REAL, sample_count INTEGER, reason TEXT)
  - Logs healthy?unhealthy transitions only (not every health check — only state changes)
  - transitioned_to ? {'healthy', 'unhealthy'}
- [ ] ALTER TABLE watering_events ADD COLUMN flow_source TEXT NOT NULL DEFAULT 'direct'
  - Values: 'direct' | 'attributed' | 'estimated' | 'ambiguous'
- [ ] ALTER TABLE watering_events ADD COLUMN flow_source_controller_id INTEGER
- [ ] ALTER TABLE watering_events ADD COLUMN flow_quality TEXT NOT NULL DEFAULT 'good'
  - Values: 'good' | 'degraded' | 'estimated'
  - Phase 5 Kz learning weights 'good' at 1.0, 'degraded' at 0.5, ignores 'estimated' entirely
- [ ] Commit: "chore(schema): add flow attribution tables and watering_events columns"

**4a.1.2 Create migration_z5_selftest_log.sql**
- [ ] CREATE TABLE z5_selftest_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME NOT NULL, passed INTEGER NOT NULL, max_gpm REAL, sample_count INTEGER, reason TEXT)
  - passed: 0 or 1 (simpler design matches z5-startup-selftest.js)
  - skipIfRecent guard queries: passed=1 AND timestamp >= datetime('now', '-24 hours')
- [ ] Commit: "chore(schema): add z5_selftest_log table"

**4a.1.3 Create migration_flow_calibration_log.sql**
- [ ] CREATE TABLE flow_calibration_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME NOT NULL, controller_id INTEGER NOT NULL, zone_relay INTEGER NOT NULL, duration_sec INTEGER NOT NULL, meter_gpm REAL, meter_stddev REAL, sample_count INTEGER, tank_gpm REAL, tank_drawdown_gal REAL, ditch_fill_gal REAL, agreement_pct REAL, confidence TEXT, notes TEXT)
  - Tracks Pool Equipment zone GPM measurements
- [ ] CREATE INDEX IF NOT EXISTS idx_flow_cal_zone ON flow_calibration_log (controller_id, zone_relay, timestamp DESC)
- [ ] Commit: "chore(schema): add flow_calibration_log table"

**4a.1.4 Apply migrations locally**
- [ ] Run: sqlite3 irrigation.db < migrations/migration_flow_attribution.sql
- [ ] Run: sqlite3 irrigation.db < migrations/migration_z5_selftest_log.sql
- [ ] Run: sqlite3 irrigation.db < migrations/migration_flow_calibration_log.sql
- [ ] Verify: sqlite3 irrigation.db ".tables" shows 6 new tables
- [ ] Verify: sqlite3 irrigation.db ".schema watering_events" shows 3 new columns

**4a.1.5 Update db.js table count**
- [ ] Update comment from "13 tables" to "19 tables" (13 existing + 6 new)
- [ ] Add JSDoc comments for new tables in getDb() function
- [ ] Commit: "chore(db): update table count to 19 after attribution migrations"

**Success Criteria:**
- ? Three migration files exist in migrations/ directory
- ? All migrations apply cleanly to local SQLite db
- ? 6 new tables visible in .schema
- ? watering_events has 3 new attribution columns
- ? db.js reflects 19 tables

---

### 4a.2 zones.config.js Patch (Wave 2, depends on 4a.1 complete)

**Deliverable:** Updated zones.config.js with attribution infrastructure

**Tasks:**

**4a.2.1 Add flow meter fields to all controllers**
- [ ] GARAGE: add hasFlowMeter: true, flowMeterHealthy: true
- [ ] POOL_EQUIP: add hasFlowMeter: false, flowMeterHealthy: null
- [ ] BARN: add hasFlowMeter: false, flowMeterHealthy: null

**4a.2.2 Add flowMeterAttribution block to POOL_EQUIP**
- [ ] flowMeterAttribution: { sourceControllerId: 'GARAGE', sourceMeterRelay: null, gatingRelay: 5, gatingZoneName: 'Z5', gateBufferSec: 30, gateStaggerMs: 2000, reason: 'Pool Equipment flow meter broken', establishedAt: '2026-05-11', degradationBehavior: 'estimate', estimateSource: 'duration' }

**4a.2.3 Mark Garage Z5 as capped**
- [ ] Add SYSTEM CRITICAL comment block above Z5 definition: "// SYSTEM CRITICAL: Z5 is capped and serves as the attribution gate for Pool Equipment flow metering. DO NOT uncap or modify without coordination with flow attribution logic."
- [ ] Z5 object: add capped: true, cappedAt: '2026-05-11', role: 'attribution_gate'

**4a.2.4 Export groupControllersByAttribution helper**
- [ ] function groupControllersByAttribution() - returns { 'garage-pool-shared': ['GARAGE', 'POOL_EQUIP'], 'barn-solo': ['BARN'] }
- [ ] module.exports: add groupControllersByAttribution

**4a.2.5 Commit zones.config.js changes**
- [ ] Commit: "feat(config): add flowMeterAttribution infrastructure to zones.config.js"

**Success Criteria:**
- ? All three controllers have hasFlowMeter and flowMeterHealthy fields
- ? POOL_EQUIP has flowMeterAttribution block pointing to GARAGE/Z5
- ? Z5 marked as capped with SYSTEM CRITICAL warning
- ? groupControllersByAttribution helper exported
- ? zones.config.js still loads without errors (node -e "require('./zones.config.js')")

---

### 4a.3 z5-startup-selftest.js Module (Wave 3, depends on 4a.1 + 4a.2)

**Deliverable:** Standalone Z5 self-test module (not wired to startup yet)

**Tasks:**

**4a.3.1 Create z5-startup-selftest.js skeleton**
- [ ] Module exports: runZ5SelfTest(options = {})
- [ ] Import: getDb() from db.js, GARAGE controller from zones.config.js
- [ ] Constants: THRESHOLD_GPM = 0.3, SAMPLE_DURATION_SEC = 60, SAMPLE_INTERVAL_MS = 2000, SKIP_IF_RECENT_HOURS = 24

**4a.3.2 Implement skipIfRecent guard**
- [ ] Query z5_selftest_log for most recent test
- [ ] If last test < 24 hours ago, return { skipped: true, reason: 'recent test exists', lastTest: {...} }

**4a.3.3 Implement preflight checks**
- [ ] Check: no other zones active on GARAGE controller (query zone_state_log)
- [ ] Check: GARAGE flow meter healthy (controller_flow_meter_health.healthy = true)
- [ ] If preflights fail, return { error: true, reason: '...' }

**4a.3.4 Implement valve cycling and sampling**
- [ ] Open Z5 via Hydrawise API (use existing poll.js patterns)
- [ ] Wait 10 seconds for valve to stabilize
- [ ] Sample flow meter every 2 seconds for 60 seconds (30 samples)
- [ ] Close Z5
- [ ] Calculate: avgFlowGPM, maxFlowGPM

**4a.3.5 Implement threshold check**
- [ ] If avgFlowGPM > THRESHOLD_GPM (0.3): passed = 0, reason = 'Z5 cap appears compromised - flow detected'
- [ ] Else: passed = 1, reason = 'Z5 cap verified'

**4a.3.6 Implement logging**
- [ ] INSERT into z5_selftest_log: timestamp, passed, max_gpm, sample_count, reason
- [ ] Return: { passed, maxFlowGPM, sampleCount, threshold: THRESHOLD_GPM, timestamp }

**4a.3.7 Add CLI interface**
- [ ] if (require.main === module): parse --dry-run flag, run runZ5SelfTest(), print results

**4a.3.8 Commit z5-startup-selftest.js**
- [ ] Commit: "feat(attribution): add z5-startup-selftest.js module (standalone, not wired)"

**Success Criteria:**
- ? z5-startup-selftest.js exists and exports runZ5SelfTest()
- ? Module has skipIfRecent guard (24h)
- ? Preflight checks implemented (no active zones, meter healthy)
- ? Valve cycling + sampling logic implemented
- ? Threshold check against 0.3 GPM
- ? Logging to z5_selftest_log table
- ? CLI runnable: node z5-startup-selftest.js --dry-run

---

### 4a.4 flow-calibration.js Module (Wave 4, depends on 4a.1 + 4a.2 + 4a.3)

**Deliverable:** CLI tool for measuring Pool Equipment zone GPMs

**Tasks:**

**4a.4.1 Create flow-calibration.js skeleton**
- [ ] Module exports: runCalibration(zoneId, options = {})
- [ ] Import: getDb() from db.js, GARAGE, POOL_EQUIP from zones.config.js
- [ ] Constants: DEFAULT_DURATION_SEC = 300, SAMPLE_INTERVAL_MS = 2000, STABILIZATION_SEC = 10

**4a.4.2 Parse CLI arguments**
- [ ] --zone pool-equip-z1 (required)
- [ ] --duration 300 (optional, default 300)
- [ ] --dry-run (optional, skip actual valve commands)
- [ ] Exit with usage if --zone missing

**4a.4.3 Implement preflight gates**
- [ ] Check: Z5 self-test passed recently (query z5_selftest_log, last result = 'pass', < 7 days ago)
- [ ] Check: Target zone exists in POOL_EQUIP controller
- [ ] Check: No other zones active on GARAGE or POOL_EQUIP
- [ ] Check: GARAGE flow meter healthy
- [ ] Check: Tank level > 600 gal (need buffer for calibration run)
- [ ] If any check fails, exit with error

**4a.4.4 Implement calibration sequence**
- [ ] Record: tank_level_start (from tank_level_log)
- [ ] Open Z5 (via Hydrawise API)
- [ ] Wait STABILIZATION_SEC (10 sec)
- [ ] Open target Pool zone (via Hydrawise API)
- [ ] Wait STABILIZATION_SEC again
- [ ] Sample Garage flow meter every 2 seconds for duration (default 300 sec = 5 minutes)
- [ ] Close target Pool zone
- [ ] Close Z5
- [ ] Record: tank_level_end

**4a.4.5 Calculate results**
- [ ] avgFlowGPM = average of all samples
- [ ] tankDrawdownGal = tank_level_start - tank_level_end
- [ ] tankCrossCheckGPM = tankDrawdownGal / (duration / 60)
- [ ] confidence = 'high' if abs(avgFlowGPM - tankCrossCheckGPM) < 1.0, 'medium' if < 2.0, else 'low'

**4a.4.6 Log result**
- [ ] INSERT into flow_calibration_log: timestamp, controller_id, zone_relay, duration_sec, meter_gpm, meter_stddev, sample_count, tank_gpm, tank_drawdown_gal, ditch_fill_gal, agreement_pct, confidence, notes

**4a.4.7 Print recommendation**
- [ ] Console output: "Calibration complete for {zone_name}. Measured GPM: {avgFlowGPM:.2f} (confidence: {confidence}). Tank cross-check: {tankCrossCheckGPM:.2f} GPM. Recommend updating zones.config.js GPM to {avgFlowGPM:.1f}"
- [ ] Note: "Does NOT auto-update zones.config.js — human must review and apply"

**4a.4.8 Commit flow-calibration.js**
- [ ] Commit: "feat(attribution): add flow-calibration.js CLI tool for measuring Pool zone GPMs"

**Success Criteria:**
- ? flow-calibration.js exists and exports runCalibration()
- ? CLI interface: node flow-calibration.js --zone pool-equip-z1 [--duration 300] [--dry-run]
- ? Preflight gates implemented (Z5 test passed, no active zones, tank > 600 gal)
- ? Calibration sequence: open Z5, open Pool zone, sample Garage meter, close both
- ? Tank drawdown cross-check for confidence scoring
- ? Results logged to flow_calibration_log table
- ? Recommendation printed, does NOT auto-update zones.config.js

---

### 4a.5 CLAUDE.md Update (Wave 5, depends on 4a.1 + 4a.2 + 4a.3 + 4a.4)

**Deliverable:** CLAUDE.md reflects Z5's new role and Phase 4 split

**Tasks:**

**4a.5.1 Update Garage controller table - Z5 row**
- [ ] Change Z5 row in "Controllers & Zones" section
- [ ] Old: "Z5 | Dummy Flow Test | System | —"
- [ ] New: "Z5 | Attribution Gate (CAPPED) | System | 0.0 (capped 2026-05-11)"
- [ ] Add footnote: "**Z5 CRITICAL:** Capped and serves as attribution gate for Pool Equipment flow metering. Valve opens for gating signal but cap prevents flow. Self-test on startup verifies cap integrity (<0.3 GPM)."

**4a.5.2 Add flowMeterAttribution to Key Design Decisions**
- [ ] New entry: "**Pool Equipment flow attribution** — Pool Equipment controller's broken flow meter is worked around by attributing flow to the Garage flow meter. When a Pool zone runs, capped Garage Z5 opens first (providing a gating signal), then the Pool zone opens. The Garage meter's incremental flow is attributed to the Pool zone. This allows accurate GPM measurement and eventual water usage tracking. Garage Z5 is system-critical and must remain capped."

**4a.5.3 Update Implementation Phases table**
- [ ] Split Phase 4 row into two rows:
  - "| 4a | ?? Active | Attribution infrastructure (schema, config, modules, calibration) |"
  - "| 4b | ? Pending | Scheduling cutover via Hydrawise setzone API |"

**4a.5.4 Update Database Schema table**
- [ ] Change table count from "13 tables" to "19 tables" in section header
- [ ] Add 6 new rows:
  - "| flow_attribution_warnings | 4a | Flow attribution deviation alerts |"
  - "| controller_flow_meter_health | 4a | Per-controller meter health status |"
  - "| controller_flow_meter_health_log | 4a | Historical meter health checks |"
  - "| z5_selftest_log | 4a | Z5 cap integrity tests on startup |"
  - "| flow_calibration_log | 4a | Pool Equipment zone GPM measurements |"
  - "| watering_events (columns added) | 4a | flow_source, flow_source_controller_id, flow_quality |"

**4a.5.5 Commit CLAUDE.md updates**
- [ ] Commit: "docs(CLAUDE): document Z5 attribution role, Phase 4 split, new tables"

**Success Criteria:**
- ? Z5 row in Garage controller table reflects capped status and attribution role
- ? Key Design Decisions section includes flowMeterAttribution entry
- ? Implementation Phases table shows Phase 4a (Active) and 4b (Pending) separately
- ? Database Schema section updated to 19 tables with 6 new entries

---

### 4a.6 Calibration Runs (Wave 6, depends on 4a.1-4a.5 complete)

**Deliverable:** Accurate GPMs measured for all 11 Pool Equipment zones

**Tasks:**

**4a.6.1 Verify infrastructure ready**
- [ ] Confirm: All migrations applied (sqlite3 irrigation.db ".tables" shows 19 tables)
- [ ] Confirm: zones.config.js updated (hasFlowMeter, flowMeterAttribution present)
- [ ] Confirm: z5-startup-selftest.js and flow-calibration.js committed

**4a.6.2 Run Z5 self-test (baseline)**
- [ ] node z5-startup-selftest.js
- [ ] Verify: result = 'pass', avgFlowGPM < 0.3
- [ ] If fail: STOP, investigate Z5 cap before proceeding

**4a.6.3 Dry-run calibration for Pool Z1**
- [ ] node flow-calibration.js --zone pool-equip-z1 --duration 60 --dry-run
- [ ] Verify: CLI runs without errors, prints "DRY RUN" mode

**4a.6.4 Live calibration: Pool Z1 (Pool Drip, 1.7 GPM estimated)**
- [ ] Verify: Tank > 650 gal, no other zones active
- [ ] node flow-calibration.js --zone pool-equip-z1 --duration 300
- [ ] Record: meter_gpm, confidence from console output
- [ ] Manual: Update zones.config.js POOL_EQUIP.Z1.gpm = {measured value}

**4a.6.5 Live calibration: Pool Z2 (Soccer West South, 9.2 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z2 --duration 300
- [ ] Update zones.config.js Z2.gpm

**4a.6.6 Live calibration: Pool Z3 (Soccer West North, 7.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z3 --duration 300
- [ ] Update zones.config.js Z3.gpm

**4a.6.7 Live calibration: Pool Z4 (Soccer East South, 13.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z4 --duration 300
- [ ] Update zones.config.js Z4.gpm

**4a.6.8 Live calibration: Pool Z5 (Soccer East North, 9.5 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z5 --duration 300
- [ ] Update zones.config.js Z5.gpm

**4a.6.9 Live calibration: Pool Z6 (Soccer East North2, 7.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z6 --duration 300
- [ ] Update zones.config.js Z6.gpm

**4a.6.10 Live calibration: Pool Z7 (East Trees South, 10.5 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z7 --duration 300
- [ ] Update zones.config.js Z7.gpm

**4a.6.11 Live calibration: Pool Z8 (East Trees North, 16.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z8 --duration 300
- [ ] Update zones.config.js Z8.gpm

**4a.6.12 Live calibration: Pool Z9 (West Trees Woodpile, 12.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z9 --duration 300
- [ ] Update zones.config.js Z9.gpm

**4a.6.13 Live calibration: Pool Z10 (West Trees Rocks, 11.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z10 --duration 300
- [ ] Update zones.config.js Z10.gpm

**4a.6.14 Live calibration: Pool Z11 (West Trees Septic, 10.0 GPM estimated)**
- [ ] node flow-calibration.js --zone pool-equip-z11 --duration 300
- [ ] Update zones.config.js Z11.gpm

**4a.6.15 Commit measured GPMs**
- [ ] Commit: "feat(calibration): update Pool Equipment zone GPMs with measured values"
- [ ] Commit message includes: summary table of old vs new GPMs, confidence scores

**Success Criteria:**
- ? Z5 self-test passed before calibration runs
- ? All 11 Pool Equipment zones calibrated (flow_calibration_log has 11 entries)
- ? zones.config.js updated with measured GPM values
- ? At least 9/11 zones have 'high' or 'medium' confidence
- ? Commit documenting GPM updates

---

### 4a.7 Decide pm2 Process Wiring (Wave 7, deferred - does not block 4a completion)

**Deliverable:** Decision documented, wiring implemented (or deferred to later)

**Tasks:**

**4a.7.1 Evaluate options**
- [ ] Option A: irrigation-poll runs Z5 self-test on startup (runs every restart, closer to zone operations)
- [ ] Option B: irrigation-server runs Z5 self-test on startup (less frequent restarts, separate from polling)
- [ ] Document: Pros/cons of each option in .planning/phases/4a/DECISION-pm2-wiring.md

**4a.7.2 Make decision (can defer)**
- [ ] Decision: Choose A or B, or defer to Phase 4b
- [ ] If deferring: Document in DECISION-pm2-wiring.md: "Deferred to Phase 4b — self-test module is standalone and can be wired later"

**4a.7.3 Implement wiring (if decided now)**
- [ ] Update selected process file (poll.js or server.js): import runZ5SelfTest, call on startup
- [ ] Test: pm2 restart irrigation-poll (or irrigation-server), verify self-test runs
- [ ] Verify: Both processes still start cleanly after restart
- [ ] Commit: "feat(attribution): wire Z5 self-test to {process} startup"

**4a.7.4 Document deferral (if deferred)**
- [ ] Create DECISION-pm2-wiring.md with deferral reasoning
- [ ] Commit: "docs(attribution): defer pm2 Z5 self-test wiring decision to Phase 4b"

**Success Criteria:**
- ? Decision documented in DECISION-pm2-wiring.md (either chosen or deferred)
- ? If wired: Z5 self-test runs on process startup, both pm2 processes restart cleanly
- ? If deferred: Documented reasoning, no blocker for Phase 4a completion

---

## Verification Checklist (Phase 4a Complete)

**Code Artifacts:**
- [ ] migrations/ contains 3 new SQL files (migration_flow_attribution.sql, migration_z5_selftest_log.sql, migration_flow_calibration_log.sql)
- [ ] z5-startup-selftest.js module exists, exports runZ5SelfTest(), has CLI interface
- [ ] flow-calibration.js module exists, exports runCalibration(), has CLI interface
- [ ] zones.config.js has hasFlowMeter/flowMeterHealthy on all controllers, flowMeterAttribution block on POOL_EQUIP, Z5 marked capped
- [ ] db.js comment updated to "19 tables"

**Database State:**
- [ ] sqlite3 irrigation.db ".tables" shows 19 tables (13 original + 6 new)
- [ ] watering_events has flow_source, flow_source_controller_id, flow_quality columns
- [ ] z5_selftest_log has at least 1 entry (baseline test)
- [ ] flow_calibration_log has 11 entries (all Pool Equipment zones)

**Documentation:**
- [ ] CLAUDE.md updated: Z5 row reflects capped status, Key Design Decisions includes flowMeterAttribution, Phase 4 split into 4a/4b, Database Schema shows 19 tables
- [ ] .planning/phases/4a/DECISION-pm2-wiring.md exists (decision or deferral documented)

**Measured GPMs:**
- [ ] zones.config.js POOL_EQUIP zones have measured GPMs (not estimates)
- [ ] Commit message with GPM update includes confidence summary

**No Runtime Behavior Change:**
- [ ] Existing Phase 0-2 polling continues unaffected
- [ ] pm2 processes (irrigation-poll, irrigation-server) still start cleanly
- [ ] No setzone commands issued (Phase 4b work)
- [ ] No poll.js or scheduler.js attribution logic yet (Phase 4b work)

---

## Commit Strategy

**Atomic commits per deliverable:**

1. "chore(schema): add flow attribution tables and watering_events columns"
2. "chore(schema): add z5_selftest_log table"
3. "chore(schema): add flow_calibration_log table"
4. "chore(db): update table count to 19 after attribution migrations"
5. "feat(config): add flowMeterAttribution infrastructure to zones.config.js"
6. "feat(attribution): add z5-startup-selftest.js module (standalone, not wired)"
7. "feat(attribution): add flow-calibration.js CLI tool for measuring Pool zone GPMs"
8. "docs(CLAUDE): document Z5 attribution role, Phase 4 split, new tables"
9. "feat(calibration): update Pool Equipment zone GPMs with measured values"
10. "feat(attribution): wire Z5 self-test to {process} startup" OR "docs(attribution): defer pm2 Z5 self-test wiring decision to Phase 4b"

**Final commit count:** 9-10 commits (depending on 4a.7 decision)

---

## Dependencies & Blockers

**Depends on (external):**
- None (Phase 4a is additive, does not depend on Phase 3 SMS completion)

**Blocks:**
- Phase 4b (Scheduling Cutover) — requires accurate Pool Equipment GPMs and attribution infrastructure
- Phase 4b runtime attribution logic requires zones.config.js flowMeterAttribution block
- Summer scheduling needs measured GPMs before ET-based scheduling can begin

**Critical Path:**
- 4a.1 ? 4a.2 ? 4a.3 ? 4a.4 ? 4a.5 ? 4a.6 (calibration runs)
- 4a.7 (pm2 wiring) can be done in parallel with 4a.5-4a.6 or deferred entirely

---

## Risk Mitigation

**Risk: Z5 self-test fails (cap compromised)**
- Mitigation: Manual inspection of Z5 valve cap before starting calibration runs
- Fallback: If cap fails, reconsider Phase 6 ditch health check mechanism (Z5 no longer available)

**Risk: Pool zone calibration yields low-confidence results**
- Mitigation: Run multiple calibration cycles, average results
- Fallback: Use tank cross-check GPM as fallback if meter sampling is noisy

**Risk: Tank level insufficient for 11 calibration runs**
- Mitigation: Stagger calibration runs over multiple days (tank refills overnight via ditch)
- Ensure tank > 600 gal before each run

**Risk: Calibration runs disrupt existing Phase 0-2 polling**
- Mitigation: Run calibrations during low-activity windows (not during scheduled watering)
- Preflight checks ensure no other zones active before calibration

---

*Plan created: 2026-05-11*
*Ready for execution: /gsd-execute-phase 4a*
