# Roadmap — irrigation-monitor

**Scope:** Phases 3 through 7
**Current Phase:** Phase 3 (Twilio SMS - paused) / Phase 4 planning

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

## Phase 4a: Attribution Infrastructure (DEPRECATED)

**Status:** ✅ Completed and deprecated (May 2026)

Phase 4a's infrastructure was built to support real-time flow meter attribution from the Hydrawise REST API v1, but investigation revealed the API does not expose real-time flow data during active zone runs. The underlying assumption was disproved, rendering the attribution mechanism unviable.

**What happened:**
- Schema additions (6 tables), modules (z5-startup-selftest.js, flow-calibration.js), and configuration (flowMeterAttribution block) were completed across Waves 1-5
- Z5 (Garage controller) was capped to serve as an attribution gate for Pool Equipment zones
- Investigation confirmed Hydrawise REST v1 API only exposes a meter calibration constant (sensors[0].rate), not live flow readings
- Phase 4a infrastructure deprecated across deprecation waves 1-5 (May 2026)

**Current architecture:** Per-zone GPM is maintained as static configuration in zones.config.js. Tank-drawdown calibration (via tank-drawdown-calibration.js) is the measurement method when emitter configuration changes. The flow_calibration_log table was repurposed to track tank-drawdown measurements.

**See:** docs/phase-4a-audit.md for complete deprecation audit, CLAUDE.md "Phase 4a History" section for narrative context

---

## Phase 4: Scheduling Cutover

**Goal:** Replace Hydrawise programs with software-owned scheduling

**Status:** ⬜ Pending
**Priority:** High
**Estimated Duration:** 3-4 weeks
**Blockers:** Phase 3 complete, setzone API design finalized

### Tasks

**4.1 setzone API Integration**
- [ ] Research Hydrawise setzone API endpoint and auth
- [ ] Implement setzone() function: POST to Hydrawise API
- [ ] Test with single zone: open Z6 for 5 minutes, verify via polling
- [ ] Implement zone close (stop) command
- [ ] Log all setzone calls with timestamps

**4.2 Daily Scheduling Algorithm**
- [ ] Create scheduler.js → dailySchedule() function
- [ ] Fetch today's ET from et_log table
- [ ] Calculate target gallons per zone: baseline × (ET/ET_avg) × Kz
- [ ] Convert to runtime: gallons / GPM (or baseline_minutes × factor for Barn)
- [ ] Sort zones by priority (sod first, drips second)
- [ ] Build schedule to complete by 6 AM

**4.3 Tank Safety Logic**
- [ ] Check tank level before scheduling
- [ ] Calculate total gallons needed for schedule
- [ ] Abort if final tank level < 450 gal safety floor
- [ ] Alert user: "Insufficient tank capacity for today's schedule"

**4.4 Rain/Weather Skip**
- [ ] Fetch forecast from Open-Meteo (3-day lookahead)
- [ ] Skip logic: ET < 0.05 OR forecast rain > 0.25 OR yesterday > 0.5 OR temp < 68°F
- [ ] Log skip reason to warnings table
- [ ] Notify user: "Irrigation skipped today: [reason]"

**4.5 Program Suspension**
- [ ] Suspend all Hydrawise programs via API
- [ ] Daily check: verify programs still suspended
- [ ] Conflict detection: alert if program re-enabled
- [ ] Fallback: re-suspend automatically or alert user

**4.6 Execution Engine**
- [ ] Execute schedule: issue setzone commands sequentially
- [ ] Poll zone state every 60s to confirm execution
- [ ] Track actual runtime vs planned
- [ ] Handle errors: retry failed setzone, log to warnings table

**4.7 Testing**
- [ ] Unit tests for scheduling algorithm (gallons → runtime)
- [ ] Integration test: fetch ET, calculate schedule, execute (dry-run mode)
- [ ] End-to-end test: full cycle from 2 AM ET log to 6 AM completion
- [ ] Test skip logic: manually set ET < 0.05, verify skip

**4.8 Web Dashboard (Next.js + Supabase)**
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
**Blockers:** Phase 4 complete (Kz adjustments need active scheduling)

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

### Milestone 2: Scheduling Takeover (Phase 4 complete)
- Hydrawise programs suspended
- Daily ET-based scheduling operational
- Tank safety checks in place
- Web dashboard live on Vercel

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

*Last updated: 2026-05-19*
*Phase 4a deprecated May 2026 — see docs/phase-4a-audit.md*
