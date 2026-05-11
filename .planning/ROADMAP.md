# Roadmap — irrigation-monitor

**Scope:** Phases 3 through 7
**Current Phase:** 4a (Attribution Infrastructure - active)

---

## Phase 3: Twilio SMS Integration

**Goal:** Complete SMS command interface and notification system

**Status:** ⏸️ Paused (resuming after Phase 4a)
**Priority:** High
**Estimated Duration:** 1-2 weeks

### Tasks

**3.1 Environment & Credentials**
- [ ] Add TWILIO_ACCOUNT_SID to .env
- [ ] Add TWILIO_AUTH_TOKEN to .env
- [ ] Add TWILIO_PHONE_NUMBER to .env (+1XXXXXXXXXX format)
- [ ] Add OWNER_PHONE to .env
- [ ] Update .env.example with Twilio variable specs

**3.2 Inbound SMS Webhook**
- [ ] Complete sms/handler.js webhook endpoint (/sms/webhook)
- [ ] Implement Twilio signature validation
- [ ] Parse command from message body
- [ ] Route to command handlers in sms/commands.js
- [ ] Test with ngrok: ngrok http 3001

**3.3 Command Handlers**
- [ ] STATUS: current zone states, tank level, ET today
- [ ] TANK: detailed tank status (level, usable, pump cutoff)
- [ ] SUSPEND [n]: suspend scheduling for n days (default 1)
- [ ] RESUME: resume normal scheduling
- [ ] SKIP TODAY: cancel today's schedule, resume tomorrow
- [ ] DITCH CHECK: trigger flow meter diagnostic (Phase 6 dependency)

**3.4 Outbound SMS**
- [ ] Implement sendSMS() in sms/sender.js
- [ ] Retry logic: 3 attempts with exponential backoff
- [ ] Log all outbound messages to sms_log table
- [ ] Error handling: send failure notification to owner

**3.5 MMS with Photos**
- [ ] Implement sendMMS() in sms/sender.js
- [ ] Load zone photos from zone-images/ directory
- [ ] Format check-in message: zone name, ET avg 30d, gallons, Kz
- [ ] Test MMS delivery to owner phone

**3.6 Language Translation**
- [ ] Integrate Anthropic API for message translation
- [ ] Load user language preference from user_preferences table
- [ ] Translate outbound messages (preserve GOOD/LOW/HIGH/SKIP keywords)
- [ ] Log API usage and costs

**3.7 Deployment**
- [ ] Deploy to Railway (or keep local with ngrok)
- [ ] Set Railway environment variables
- [ ] Configure Twilio webhook URL
- [ ] Test end-to-end: send SMS → receive response

**3.8 Testing**
- [ ] Unit tests for command parsing
- [ ] Integration test: send test SMS, verify response
- [ ] Test all 6 commands
- [ ] Test error cases (unknown command, unauthorized sender)

---

## Phase 4a: Attribution Infrastructure

**Goal:** Land all schema, config, and module changes required to support flowMeterAttribution. Additive only — no runtime behavior change. Unblocks Phase 4b and unblocks the calibration runs that produce accurate Pool Equipment zone GPMs.

**Status:** 🔄 Active
**Priority:** High (blocks Phase 4b; accurate Pool Equip GPMs needed before summer scheduling)
**Estimated Duration:** 3-5 sessions
**Blockers:** None (additive work, safe to land while Phase 0-2 polling continues)

### Tasks

**4a.1 Schema Migrations**
- [ ] migration_flow_attribution.sql — watering_events column additions, flow_attribution_warnings table, controller_flow_meter_health table, controller_flow_meter_health_log table
- [ ] migration_z5_selftest_log.sql — z5_selftest_log table
- [ ] migration_flow_calibration_log.sql — flow_calibration_log table
- [ ] Apply migrations to local SQLite db; verify tables exist; commit migration files

**4a.2 zones.config.js Patch**
- [ ] Add hasFlowMeter, flowMeterHealthy fields to all three controllers
- [ ] Add flowMeterAttribution block to POOL_EQUIP
- [ ] Add SYSTEM CRITICAL warning comment block above Garage Z5 definition
- [ ] Mark Z5 as capped: true with cappedAt date and role='attribution_gate'
- [ ] Export groupControllersByAttribution helper function

**4a.3 z5-startup-selftest.js Module**
- [ ] Implement runZ5SelfTest() with preflight checks (no other zones active, meter healthy), valve cycling, sample analysis, threshold check, log writing
- [ ] Add skipIfRecent guard (don't cycle valve more than once per 24h on restart)
- [ ] Standalone module — NOT wired into service startup yet (wiring is a separate decision)

**4a.4 flow-calibration.js Module**
- [ ] Implement runCalibration() — preflight gates, open Z5 then target Pool zone, sample Garage meter, close zones, tank-drawdown cross-check, log result, recommend GPM update
- [ ] CLI interface: node flow-calibration.js --zone pool-equip-zN [--duration 300] [--dry-run]
- [ ] Does NOT auto-write to zones.config.js — human reviews logged results and updates config manually

**4a.5 CLAUDE.md Update**
- [ ] Document Z5's new role (attribution gate, capped, system critical)
- [ ] Document flowMeterAttribution mechanism in a Key Design Decisions entry
- [ ] Update Z5 row in Garage controller table to reflect capped status and new role
- [ ] Add Phase 4 split (4a vs 4b) to Implementation Phases table

**4a.6 Calibration Runs** (after 4a.1–4a.5 land)
- [ ] Apply schema migrations to local db
- [ ] Run z5-startup-selftest.js manually once to confirm Z5 reads <0.3 GPM (threshold from design)
- [ ] Run flow-calibration.js for each of the 11 Pool Equipment zones in dry-run mode first, then live
- [ ] Update zones.config.js with measured GPM values; commit

**4a.7 Decide pm2 Process Wiring** (deferred)
- [ ] Decide whether irrigation-poll or irrigation-server runs the Z5 startup self-test on service start
- [ ] Wire selected process; verify both processes still start cleanly after restart

---

## Phase 4b: Scheduling Cutover

**Goal:** Replace Hydrawise programs with software-owned scheduling

**Status:** ⬜ Pending
**Priority:** High
**Estimated Duration:** 3-4 weeks
**Blockers:** Phase 4a complete, Phase 3 complete, setzone API design finalized

### Tasks

**4b.1 setzone API Integration**
- [ ] Research Hydrawise setzone API endpoint and auth
- [ ] Implement setzone() function: POST to Hydrawise API
- [ ] Test with single zone: open Z6 for 5 minutes, verify via polling
- [ ] Implement zone close (stop) command
- [ ] Log all setzone calls with timestamps

**4b.2 Daily Scheduling Algorithm**
- [ ] Create scheduler.js → dailySchedule() function
- [ ] Fetch today's ET from et_log table
- [ ] Calculate target gallons per zone: baseline × (ET/ET_avg) × Kz
- [ ] Convert to runtime: gallons / GPM (or baseline_minutes × factor for Barn)
- [ ] Sort zones by priority (sod first, drips second)
- [ ] Build schedule to complete by 6 AM

**4b.3 Flow Meter Attribution Runtime**
- [ ] Implement attribution logic in poll.js: map Pool Equipment flow → Garage meter
- [ ] Use Z5 gating signal to detect Pool Equipment zone activity
- [ ] Create attribution timeline: Garage + Pool Equipment serialized
- [ ] Test: run Pool Z1, verify Garage meter increments correctly

**4b.4 Tank Safety Logic**
- [ ] Check tank level before scheduling
- [ ] Calculate total gallons needed for schedule
- [ ] Abort if final tank level < 450 gal safety floor
- [ ] Alert user: "Insufficient tank capacity for today's schedule"

**4b.5 Rain/Weather Skip**
- [ ] Fetch forecast from Open-Meteo (3-day lookahead)
- [ ] Skip logic: ET < 0.05 OR forecast rain > 0.25 OR yesterday > 0.5 OR temp < 68°F
- [ ] Log skip reason to warnings table
- [ ] Notify user: "Irrigation skipped today: [reason]"

**4b.6 Program Suspension**
- [ ] Suspend all Hydrawise programs via API
- [ ] Daily check: verify programs still suspended
- [ ] Conflict detection: alert if program re-enabled
- [ ] Fallback: re-suspend automatically or alert user

**4b.7 Execution Engine**
- [ ] Execute schedule: issue setzone commands sequentially
- [ ] Poll zone state every 60s to confirm execution
- [ ] Track actual runtime vs planned
- [ ] Handle errors: retry failed setzone, log to warnings table

**4b.8 Testing**
- [ ] Unit tests for scheduling algorithm (gallons → runtime)
- [ ] Integration test: fetch ET, calculate schedule, execute (dry-run mode)
- [ ] End-to-end test: full cycle from 2 AM ET log to 6 AM completion
- [ ] Test skip logic: manually set ET < 0.05, verify skip

**4b.9 Web Dashboard (Next.js + Supabase)**
- [ ] Create Next.js app in new web/ directory
- [ ] Setup Supabase project, deploy schema.sql
- [ ] Implement sync.js: SQLite → Supabase hourly
- [ ] Deploy to Vercel
- [ ] Dashboard tab: tank, ET, schedule, warnings
- [ ] Control tab: SUSPEND, RESUME, SKIP TODAY buttons

---

## Phase 5: Observation Feedback Loop & Kz Learning

**Goal:** Monthly zone check-ins with landscaper/owner ratings

**Status:** ⬜ Pending
**Priority:** Medium
**Estimated Duration:** 2-3 weeks
**Blockers:** Phase 4b complete (Kz adjustments need active scheduling)

### Tasks

**5.1 Monthly Check-In System**
- [ ] Create scheduled_reminders table (zone_id, recipient, next_check_date)
- [ ] Daily cron job: check for due reminders (9 AM)
- [ ] Send MMS: zone photo + ET 30d + gallons + Kz + "Reply GOOD/LOW/HIGH/SKIP"
- [ ] Populate recipient list from zones.config.js

**5.2 Rating Processing**
- [ ] Extend sms/commands.js: handle GOOD/LOW/HIGH/SKIP replies
- [ ] Match reply to recent check-in MMS (within 7 days)
- [ ] Validate sender is authorized recipient for that zone
- [ ] Process rating: adjust Kz, schedule next check-in

**5.3 Kz Adjustment Logic**
- [ ] GOOD: no change, next check 30 days
- [ ] LOW: Kz × 1.15 (clamped to max 2.0), next check 10 days
- [ ] HIGH: Kz × 0.85 (clamped to min 0.5), next check 10 days
- [ ] SKIP: defer 7 days, no change
- [ ] Log adjustment to zone_coefficients table with reason + user

**5.4 Multi-Recipient Coordination**
- [ ] Identify landscaper vs owner in user_preferences table
- [ ] Landscaper feedback takes priority (ignore owner if landscaper replied)
- [ ] Send confirmation SMS to all recipients: "[User] rated [Zone] as [Rating]. Kz adjusted to [value]."

**5.5 Observations Table**
- [ ] Store all ratings: zone, user, timestamp, rating, kz_before, kz_after
- [ ] Query: show rating history for a zone (last 12 months)
- [ ] Dashboard: display observations timeline per zone

**5.6 Testing**
- [ ] Unit tests for Kz adjustment math (clamping, multipliers)
- [ ] Integration test: send check-in MMS, reply LOW, verify Kz × 1.15
- [ ] Test priority: landscaper + owner both reply, verify landscaper wins
- [ ] Test expiration: reply after 8 days, verify ignored

---

## Phase 6: Ditch Water Health Check

**Goal:** Daily flow meter diagnostic to detect ditch water failures

**Status:** ⬜ Pending
**Priority:** Low
**Estimated Duration:** 1 week
**Blockers:** Mechanism redesign (Z5 capping workaround)

### Tasks

**6.1 Mechanism Redesign**
- [ ] Discuss alternatives: Garage Z6 as test zone? Passive monitoring only?
- [ ] Document chosen approach in CLAUDE.md
- [ ] Update Phase 6 requirements with final design

**6.2 Daily Diagnostic (Assuming Z6 Test Zone)**
- [ ] Scheduler: 2 AM cron job → ditchHealthCheck()
- [ ] Open test zone for 2 minutes
- [ ] Record flow meter readings: start, end
- [ ] Calculate actual flow rate: (end - start) / 2 minutes
- [ ] Compare to expected baseline (from zones.config.js)

**6.3 Failure Detection**
- [ ] If actual < 50% expected: log to ditch_health_log with status "degraded"
- [ ] If degraded 2 consecutive days: status "failed"
- [ ] Send SMS alert: "Ditch water failure detected - check gate"
- [ ] Fallback: suspend scheduling until resolved

**6.4 Testing**
- [ ] Unit test: flow calculation logic
- [ ] Integration test: manually throttle ditch gate, verify failure detection
- [ ] Test alert: confirm SMS sent to owner

---

## Phase 7: ESP32 Tank Sensor

**Goal:** Replace model-based tank estimates with real sensor readings

**Status:** ⬜ Pending
**Priority:** Low
**Estimated Duration:** 1-2 weeks
**Blockers:** Hardware purchase (~$20)

### Tasks

**7.1 Hardware Setup**
- [ ] Purchase: ESP32 dev board, HC-SR04 ultrasonic sensor, weatherproof box
- [ ] Assemble: mount sensor above tank, wire to ESP32
- [ ] Power: USB 5V always-on (from Lenovo Legion or wall adapter)
- [ ] Position: sensor facing down, 12-18 inches above max water level

**7.2 ESP32 Firmware**
- [ ] Write Arduino sketch: read HC-SR04 distance every 5 minutes
- [ ] Convert distance (cm) to tank level (inches): level = max_depth - distance
- [ ] POST reading to http://localhost:3001/tank/sensor (JSON: {level_inches, timestamp})
- [ ] Flash firmware to ESP32

**7.3 Server Endpoint**
- [ ] Add POST /tank/sensor to server.js
- [ ] Validate request (check timestamp is recent, level is plausible)
- [ ] Insert reading into tank_sensor_log table
- [ ] Convert inches → gallons: use tank geometry (6.25 ft diameter cylinder)
- [ ] Update tank_level_log with sensor reading

**7.4 Sensor Failure Detection**
- [ ] Monitor last_reading_timestamp in tank_sensor_log
- [ ] If > 15 minutes ago: status "offline", fallback to model estimates
- [ ] Send alert SMS: "Tank sensor offline - using model estimates"
- [ ] Resume sensor readings when POST resumes

**7.5 Calibration**
- [ ] Measure tank at known levels: empty, 25%, 50%, 75%, full
- [ ] Record sensor distance readings for each level
- [ ] Compute linear calibration: gallons = a × inches + b
- [ ] Store constants in zones.config.js: TANK_CALIBRATION = {a, b}

**7.6 Testing**
- [ ] Unit test: inches → gallons conversion
- [ ] Integration test: manually POST reading, verify tank_level_log updates
- [ ] Test offline detection: stop POSTs for 20 minutes, verify alert
- [ ] Calibration test: fill tank to known level, verify gallons match

---

## Cross-Phase Milestones

### Milestone 1: SMS & Monitoring (Phase 3 complete)
- SMS commands functional
- Outbound notifications working
- MMS with zone photos
- Deployment to Railway

### Milestone 2: Scheduling Takeover (Phases 4a + 4b complete)
- Attribution infrastructure in place (4a)
- Pool Equipment zone GPMs accurately measured (4a)
- Hydrawise programs suspended (4b)
- Daily ET-based scheduling operational (4b)
- Flow meter attribution working at runtime (4b)
- Tank safety checks in place (4b)
- Web dashboard live on Vercel (4b)

### Milestone 3: Feedback Loop (Phase 5 complete)
- Monthly check-ins automated
- Kz learning active
- Multi-recipient coordination working
- Observations history in dashboard

### Milestone 4: Full System (Phases 6-7 complete)
- Ditch health check operational
- ESP32 tank sensor replacing model estimates
- All 22 zones under software control
- System running autonomously with minimal manual intervention

---

*Last updated: 2026-05-11*
*Next: /gsd-plan-phase 4a to generate detailed task plan*
