# State — irrigation-monitor

**Last Updated:** 2026-05-11
**GSD Version:** 1.41.2

---

## Current Phase

**Phase 4a: Attribution Infrastructure**
- Status: 🔄 Active
- Started: 2026-05-11
- Target Completion: 3-5 sessions
- Priority Shift: Phase 3 (Twilio SMS) paused to unblock Phase 4b infrastructure needs

---

## Completed Phases

### Phase 0: Hydrawise Polling
- ✅ Complete
- poll.js: 60s polling loop for 3 controllers (Garage, Pool Equipment, Barn)
- zone_state_log table: zone on/off transitions
- tank_level_log table: tank level every 60s (model-based)
- watering_events table: completed zone runs with gallons
- warnings table: low tank, ditch failure alerts

### Phase 1: ET Engine
- ✅ Complete
- et-engine.js: Open-Meteo API + Penman-Monteith ETo calculation
- et-logger.js: Daily 2 AM cron, logs actual + forecast ET
- et_log table: daily ET data

### Phase 2: Zone Coefficient Model
- ✅ Complete
- coefficient-model.js: per-zone Kz learning model
- zone_coefficients table: Kz per zone
- zone_daily_analysis table: daily target vs actual per zone
- reports/daily-report.js: console output, target vs actual

---

## Active Work

### Phase 4a: Attribution Infrastructure (Current Focus)

**Objective:** Land schema, config, and module changes for flowMeterAttribution. Additive only — no runtime behavior change until Phase 4b.

**Key Deliverables:**
- [ ] migration_flow_attribution.sql, migration_z5_selftest_log.sql, migration_flow_calibration_log.sql
- [ ] zones.config.js: hasFlowMeter/flowMeterHealthy fields, flowMeterAttribution block, Z5 capped marking
- [ ] z5-startup-selftest.js module (standalone, not yet wired)
- [ ] flow-calibration.js CLI tool for measuring Pool Equipment zone GPMs
- [ ] CLAUDE.md updates: Z5 role documentation, Phase 4 split (4a vs 4b)
- [ ] Calibration runs: measure all 11 Pool Equipment zone GPMs
- [ ] Decision: which pm2 process runs Z5 self-test on startup

**Why Now:** Phase 4b scheduling cutover requires accurate Pool Equipment GPMs and attribution infrastructure. This work unblocks both the calibration runs and the runtime attribution logic.

### Phase 3: Twilio SMS (Paused)

**Status:** ⏸️ Paused - will resume after Phase 4a lands

**Completed:**
- [x] Twilio account created
- [x] SMS directory structure (sms/handler.js, sms/sender.js, sms/commands.js)
- [x] Command set defined (STATUS, TANK, SUSPEND, RESUME, SKIP TODAY, DITCH CHECK)

**Remaining When Resumed:**
- [ ] Twilio credentials (TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) need to land in .env
- [ ] Webhook endpoint implementation
- [ ] Command handler completion
- [ ] Outbound SMS/MMS sending
- [ ] Language translation via Anthropic API
- [ ] Deployment (ngrok dev → Railway prod)

---

## Pending Phases

### Phase 4b: Scheduling Cutover
- Blockers: Phase 4a complete, Phase 3 complete, setzone API design finalized
- Key Work: setzone API integration, daily scheduling algorithm, runtime attribution logic in poll.js, tank safety, weather skip, program suspension, execution engine, web dashboard
- Deliverables: Software-owned ET-based scheduling operational, Hydrawise programs suspended, web dashboard live

### Phase 5: Observation Feedback Loop
- Blockers: Phase 4b complete (Kz adjustments need active scheduling)
- Deliverables: Monthly check-in MMS, GOOD/LOW/HIGH rating processing, Kz adjustments, multi-recipient coordination

### Phase 6: Ditch Water Health Check
- Blockers: Mechanism redesign (Z5 capping workaround)
- Deliverables: Daily flow meter diagnostic, ditch failure detection, alert SMS

### Phase 7: ESP32 Tank Sensor
- Blockers: Hardware purchase (~$20)
- Deliverables: Ultrasonic sensor integration, real-time tank readings, sensor failure detection

---

## Technical Debt

1. **Pool Equipment flow meter permanently broken** → attribution workaround designed (Phase 4a+4b), infrastructure landing now in 4a
2. **Garage flow meter intermittent** → needs repair/cleaning (hardware issue)
3. **Barn controller has no flow meter** → duration scaling only (design constraint, not fixable)
4. **Phase 6 ditch check mechanism** → redesign needed (Z5 capping closed off original approach)
5. **Garage Z5 role clarified** → now documented as attribution gate, capped, system critical (Phase 4a work)

---

## Recent Decisions

**2026-05-11:**
- GSD planning initialized for Phases 3-7
- Scope: Phases 0-2 treated as complete pre-existing work
- Reference docs: CLAUDE.md (operational) + Project_Context.md (procedural)
- Codebase mapped: .planning/codebase/ with 7 analysis documents
- **Phase 4 split into 4a (Attribution Infrastructure) and 4b (Scheduling Cutover)**
- **Priority shift: Phase 4a active, Phase 3 paused** — infrastructure needs to land before summer scheduling, and before completing Phase 3 SMS work
- Phase 4a is additive only: schema migrations and config changes don't affect runtime behavior until Phase 4b poll.js/scheduler.js changes ship

---

## Environment

**Development:**
- Host: Lenovo Legion (Windows/WSL, always-on)
- Node: v22.22.2
- Process manager: pm2 (irrigation-poll + irrigation-server)
- Database: SQLite (irrigation.db, 13 tables, synchronous getDb() pattern)
- Local path: C:\Users\buzzs\Desktop\Projects\irrigation-monitor\

**APIs:**
- Hydrawise: Polling only (Phase 0-2), setzone control (Phase 4b+)
- Open-Meteo: Weather + ET data
- Twilio: SMS/MMS (Phase 3, paused)
- Anthropic: SMS translation (Phase 3, paused)

**Future Deployment (Phase 4b+):**
- Railway: Always-on cloud polling (~$7/mo)
- Vercel: Next.js web app
- Supabase: Postgres backend with RLS, OTP auth

---

## Next Steps

1. **Immediate:** Execute Phase 4a — schema migrations, zones.config.js patch, z5-startup-selftest.js, flow-calibration.js, CLAUDE.md updates
2. **After 4a.1-4a.5:** Run calibration for all 11 Pool Equipment zones, update GPMs in zones.config.js
3. **After Phase 4a complete:** Resume Phase 3 (Twilio SMS) — add credentials, complete webhook, deploy
4. **After Phase 3 complete:** Execute Phase 4b (Scheduling Cutover) — setzone API, daily scheduling, runtime attribution
5. **Before Phase 6:** Redesign ditch health check mechanism (Z5 now serves attribution role)
6. **Before Phase 7:** Purchase ESP32 hardware (~$20)

---

*This file is automatically updated by GSD workflows. Manual edits may be overwritten.*
