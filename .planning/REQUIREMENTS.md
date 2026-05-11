# Requirements — irrigation-monitor (Phases 3-7)

**Scope:** This document covers requirements for Phases 3 through 7. Phases 0-2 are complete and treated as pre-existing baseline.

---

## Phase 3: Twilio SMS Integration

### Functional Requirements

**FR3.1 — SMS Command Interface**
- System must accept inbound SMS commands from authorized phone numbers
- Supported commands: STATUS, TANK, SUSPEND [n], RESUME, SKIP TODAY, DITCH CHECK
- Commands must be case-insensitive
- System must respond with confirmation or status data within 10 seconds

**FR3.2 — Outbound SMS Notifications**
- System must send daily status reports on demand (STATUS command)
- Tank level alerts when below safety threshold (450 gal)
- Ditch water failure warnings
- Confirmation messages after command execution

**FR3.3 — MMS with Zone Photos**
- Monthly check-in MMS must include zone photo attachment
- Photos stored in zone-images/ directory
- MMS must include: zone name, ET avg (last 30 days), gallons applied, current Kz coefficient

**FR3.4 — Multi-Language Support**
- Per-user language preference stored in user_preferences table
- Outbound messages translated via Anthropic API before sending
- Reply keywords (GOOD/LOW/HIGH/SKIP) always English (not translated)

**FR3.5 — Webhook Handling**
- Twilio inbound webhook at /sms/webhook endpoint
- Express server must handle POST requests from Twilio
- Webhook must parse message body, sender, and timestamp

### Non-Functional Requirements

**NFR3.1 — Security**
- Twilio credentials stored in .env (never committed)
- Authorized phone numbers validated before command execution
- Webhook signature validation (Twilio request authentication)

**NFR3.2 — Reliability**
- SMS delivery retries (3 attempts) on Twilio API failure
- Command processing logged to sms_log table
- Error messages sent to user on failed commands

**NFR3.3 — Deployment**
- Webhook endpoint accessible via ngrok (dev) or Railway (prod)
- Environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, OWNER_PHONE

---

## Phase 4: Scheduling Takeover (Hydrawise setzone API)

### Functional Requirements

**FR4.1 — Daily Scheduling Algorithm**
- Calculate target gallons per zone: baseline × (ET_today / ET_avg) × Kz
- Convert gallons to runtime: gallons / GPM (flow meter zones) or baseline_minutes × (ET/ET_avg) × Kz (Barn)
- Schedule zones to complete by 6 AM (avoid mid-day evaporation)
- Enforce tank safety floor: never schedule if tank would drop below 450 gal

**FR4.2 — Flow Meter Attribution**
- Pool Equipment zones attributed to Garage flow meter
- Use capped Garage Z5 (dummy/gating zone) as attribution signal
- Garage + Pool Equipment share single serialized timeline (attribution group)
- Track water usage by controller, not by individual zone (Pool Equipment has no meter)

**FR4.3 — setzone API Integration**
- Issue Hydrawise setzone commands to open/close valves
- Poll zone state every 60s to confirm command execution
- Log all setzone commands with timestamps and zone IDs

**FR4.4 — Rain/Weather Skip Logic**
- Skip irrigation if ET < 0.05 in/day
- Skip if forecast rain > 0.25 in
- Skip if yesterday rain > 0.5 in
- Skip if forecast high temp < 68°F

**FR4.5 — Program Suspension & Conflict Detection**
- Suspend all Hydrawise programs when Phase 4 takes control
- Daily check: verify programs still suspended
- Alert if Hydrawise program re-enabled (conflict detection)

### Non-Functional Requirements

**NFR4.1 — Safety**
- Tank safety floor: 450 gal minimum (never schedule below this)
- Pump cutoff protection: stop if tank drops to 408 gal (dry-run sensor threshold)
- Ditch water season enforcement: Apr 15 - Oct 15 only (no city water usage outside Barn location)

**NFR4.2 — Fault Tolerance**
- Fallback to manual Hydrawise programs if setzone API unreachable for > 1 hour
- Zone state polling continues even if setzone fails
- Alert user if scheduling control lost

---

## Phase 5: Observation Feedback Loop & Kz Learning

### Functional Requirements

**FR5.1 — Monthly Check-In MMS**
- Send zone photo MMS to recipient list (per zone)
- Include: ET avg (30 days), gallons applied, current Kz, default rating pre-set to GOOD
- Recipients: landscaper (priority) + owner + others (per zones.config.js)

**FR5.2 — Rating Processing**
- Accept replies: GOOD, LOW, HIGH, SKIP
- GOOD: log positive observation, no Kz change, next check-in 30 days
- LOW (insufficient water): Kz × 1.15, next check-in 10 days
- HIGH (excess water): Kz × 0.85, next check-in 10 days
- SKIP: defer check-in 7 days, no Kz change

**FR5.3 — Multi-Recipient Coordination**
- Landscaper feedback takes priority over owner feedback
- Confirmation SMS sent to all recipients after any rating processed
- All feedback logged with user identity in observations table

**FR5.4 — Kz Coefficient Model**
- Store per-zone Kz in zone_coefficients table
- Apply Kz adjustment immediately (next scheduled run uses new Kz)
- Track Kz history: log every adjustment with timestamp, reason, user

### Non-Functional Requirements

**NFR5.1 — Data Quality**
- Kz clamps: min 0.5, max 2.0 (prevent runaway adjustments)
- Rating window: only accept replies within 7 days of check-in MMS
- Duplicate rating protection: only first reply from each recipient counts

---

## Phase 6: Ditch Water Health Check

### Functional Requirements

**FR6.1 — Daily Flow Meter Diagnostic**
- Run daily test at 2 AM (after ET logging, before scheduling)
- Record flow meter readings from Garage controller
- Store diagnostic results in ditch_health_log table

**FR6.2 — Ditch Failure Detection**
- Compare actual flow to expected baseline
- Flag as failure if flow < 50% of expected for 2 consecutive days
- Send alert SMS to owner: "Ditch water failure detected - check gate"

**FR6.3 — Mechanism Redesign**
- **Constraint:** Garage Z5 capping closed off original Z5-based test mechanism
- **New approach TBD:** Requires redesign discussion
- Possible alternatives: use Garage Z6 (Frontyard Drip) as test zone, or rely on passive flow meter monitoring during normal operation

### Non-Functional Requirements

**NFR6.1 — Minimal Impact**
- Test zone runtime: ≤ 2 minutes (minimize water waste)
- Run during low-demand window (2-3 AM)
- Skip test if tank < 500 gal

---

## Phase 7: ESP32 Tank Sensor

### Functional Requirements

**FR7.1 — Ultrasonic Sensor Integration**
- ESP32 with ultrasonic sensor (HC-SR04 or similar)
- Measure tank water level in inches
- Transmit reading to irrigation-monitor server via HTTP POST
- Reading interval: 5 minutes

**FR7.2 — Data Logging**
- Store readings in tank_sensor_log table
- Convert inches to gallons using tank geometry (cylindrical, 6.25 ft diameter)
- Replace model-based tank estimates with sensor readings

**FR7.3 — Sensor Failure Detection**
- Flag failure if no reading received for > 15 minutes
- Fallback to model-based estimates if sensor offline
- Alert user: "Tank sensor offline - using model estimates"

### Non-Functional Requirements

**NFR7.1 — Hardware**
- ESP32 dev board (~$10)
- HC-SR04 ultrasonic sensor (~$3)
- Weatherproof enclosure
- Power: USB 5V (always-on)

**NFR7.2 — Calibration**
- Calibrate sensor against known tank levels (empty, 25%, 50%, 75%, full)
- Store calibration constants in zones.config.js
- Recalibration process documented

---

## Cross-Phase Requirements

### Data Integrity

- SQLite write-ahead logging (WAL) for concurrent access
- Synchronous getDb() pattern (no async/await)
- Foreign key constraints enforced
- Backup strategy: daily SQLite dump to Supabase (Phase 4+)

### Logging & Observability

- All API calls logged (Hydrawise, Open-Meteo, Twilio)
- Daily console report: coefficient-model.js target vs actual per zone
- pm2 logs: irrigation-poll and irrigation-server
- Error tracking: warnings table for critical failures

### Testing

- Unit tests for coefficient-model.js and et-engine.js (existing)
- Integration tests for setzone API (Phase 4)
- End-to-end test: full scheduling cycle from ET fetch to zone execution (Phase 4)
- SMS command tests (Phase 3)

### Documentation

- CLAUDE.md updated with each phase completion
- Environment variable specs in .env.example
- Deployment guide for Railway (Phase 3+)

---

*Last updated: 2026-05-11*
