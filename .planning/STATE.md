# State — irrigation-monitor

**Last Updated:** 2026-05-11
**GSD Version:** 1.41.2

---

## Current Phase

**Phase 3: Twilio SMS Integration**
- Status: 🔄 In Progress
- Started: Unknown (pre-GSD)
- Target Completion: TBD

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

### Phase 3 Tasks

**Completed:**
- [x] Twilio account created
- [x] SMS directory structure (sms/handler.js, sms/sender.js, sms/commands.js)
- [x] Command set defined (STATUS, TANK, SUSPEND, RESUME, SKIP TODAY, DITCH CHECK)

**In Progress:**
- [ ] Twilio credentials (TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) need to land in .env
- [ ] Webhook endpoint implementation
- [ ] Command handler completion
- [ ] Outbound SMS/MMS sending
- [ ] Language translation via Anthropic API
- [ ] Deployment (ngrok dev → Railway prod)

---

## Pending Phases

### Phase 4: Scheduling Takeover
- Blockers: Phase 3 complete, setzone API design finalized
- Key Design: flowMeterAttribution (Pool Equipment → Garage meter via Z5 gating)
- Deliverables: Daily ET-based scheduling, setzone API integration, web dashboard (Next.js + Supabase + Vercel)

### Phase 5: Observation Feedback Loop
- Blockers: Phase 4 complete (Kz adjustments need active scheduling)
- Deliverables: Monthly check-in MMS, GOOD/LOW/HIGH rating processing, Kz adjustments, multi-recipient coordination

### Phase 6: Ditch Water Health Check
- Blockers: Mechanism redesign (Z5 capping workaround)
- Deliverables: Daily flow meter diagnostic, ditch failure detection, alert SMS

### Phase 7: ESP32 Tank Sensor
- Blockers: Hardware purchase (~$20)
- Deliverables: Ultrasonic sensor integration, real-time tank readings, sensor failure detection

---

## Technical Debt

1. **Pool Equipment flow meter permanently broken** → attribution workaround designed (Phase 4), not yet implemented
2. **Garage flow meter intermittent** → needs repair/cleaning (hardware issue)
3. **Barn controller has no flow meter** → duration scaling only (design constraint, not fixable)
4. **Phase 6 ditch check mechanism** → redesign needed (Z5 capping closed off original approach)
5. **Garage Z5 "Dummy Flow Test"** → purpose unclear, needs verification (does it release water?)

---

## Recent Decisions

**2026-05-11:**
- GSD planning initialized for Phases 3-7
- Scope: Phases 0-2 treated as complete pre-existing work
- Reference docs: CLAUDE.md (operational) + Project_Context.md (procedural)
- Codebase mapped: .planning/codebase/ with 7 analysis documents

---

## Environment

**Development:**
- Host: Lenovo Legion (Windows/WSL, always-on)
- Node: v22.22.2
- Process manager: pm2 (irrigation-poll + irrigation-server)
- Database: SQLite (irrigation.db, 13 tables, synchronous getDb() pattern)
- Local path: C:\Users\buzzs\Desktop\Projects\irrigation-monitor\

**APIs:**
- Hydrawise: Polling only (Phase 0-2), setzone control (Phase 4+)
- Open-Meteo: Weather + ET data
- Twilio: SMS/MMS (Phase 3)
- Anthropic: SMS translation (Phase 3)

**Future Deployment (Phase 4+):**
- Railway: Always-on cloud polling (~$7/mo)
- Vercel: Next.js web app
- Supabase: Postgres backend with RLS, OTP auth

---

## Next Steps

1. **Immediate:** Continue Phase 3 - add Twilio credentials to .env, complete webhook implementation
2. **After Phase 3:** Run `/gsd-plan-phase 4` to plan Phase 4 (Scheduling Takeover)
3. **Before Phase 4 execution:** Finalize setzone API design, test with single zone
4. **Before Phase 6:** Redesign ditch health check mechanism (Z5 capping workaround)
5. **Before Phase 7:** Purchase ESP32 hardware (~$20)

---

*This file is automatically updated by GSD workflows. Manual edits may be overwritten.*
