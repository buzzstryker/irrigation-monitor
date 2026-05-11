# Codebase Concerns

**Analysis Date:** 2026-05-11

## Tech Debt

**Hardware workarounds — broken/intermittent flow meters:**
- Issue: Pool Equipment flow meter permanently broken; Garage flow meter intermittent; Barn controller has NO flow meter at all
- Files: `zones.config.js` (GPM values), `poll.js` (flow attribution logic lines 115-118), `coefficient-model.js` (Barn zones use duration scaling only lines 47-49, 135-142)
- Impact: Cannot verify actual water delivery for Pool Equipment zones; Barn zones calculate target in minutes instead of gallons; Garage zones may report inaccurate flow data; water accounting relies on GPM estimates rather than measured flow
- Fix approach: Phase 6 was intended to add flow meter health checks but requires redesign after Z5 capping blocked the original mechanism; consider replacing broken Pool Equipment meter or implementing alternative verification (e.g., tank level sensor correlation)

**Garage Z5 "Dummy Flow Test" zone unclear purpose:**
- Issue: Zone 5 on Garage controller exists in Hydrawise but is marked unused in `zones.config.js` line 19; purpose unclear; unknown if it actually releases water
- Files: `zones.config.js` line 19
- Impact: If Z5 accidentally triggers, it may waste water with no accounting; zone health checks in Phase 6 depend on understanding all zones
- Fix approach: Physically verify whether Z5 releases water; if unused, disable in Hydrawise controller; if used for testing, document purpose and add to config with gpm=0 or test-only flag

**Node.js version constraint for better-sqlite3:**
- Issue: Node.js downgraded from v24 to v22 due to better-sqlite3 native binary compatibility
- Files: `package.json` (implicitly requires Node v22), `db.js` (uses better-sqlite3)
- Impact: Cannot use latest Node.js features; may face compatibility issues with other dependencies expecting newer Node versions; limits upgrade path
- Fix approach: Monitor better-sqlite3 releases for v24 support; consider alternative: migrate to a different SQLite driver that supports newer Node versions (e.g., sql.js was attempted but had async issues); worst case, stay on Node v22 LTS until better-sqlite3 catches up

**Failed sql.js workaround attempt still in git history:**
- Issue: Attempted to use sql.js as async-compatible alternative to better-sqlite3, but abandoned due to complexity and async/await propagation issues
- Files: Not present in codebase anymore (removed), but mentioned in project context
- Impact: Future developers may attempt the same failed path; tech debt documentation incomplete
- Fix approach: Document the sql.js attempt in STACK.md or technical notes; if async SQLite access becomes critical, consider moving database operations to a worker thread instead of switching libraries

**Project deliberately outside OneDrive due to SQLite WAL conflicts:**
- Issue: SQLite WAL (Write-Ahead Logging) files cause sync conflicts in OneDrive; project must live outside cloud sync folders
- Files: `db.js` line 20 (enables WAL mode), `irrigation.db-wal` (generated), `.gitignore` lines 3-5
- Impact: No automatic cloud backup of project files or database; risk of data loss if local disk fails; developer onboarding requires explicit instruction to avoid OneDrive
- Fix approach: Add README warning about OneDrive; implement separate database backup strategy (e.g., daily Supabase sync for critical tables, periodic .db file backup to non-synced location); consider alternative: disable WAL mode if OneDrive sync is priority (but loses performance benefits)

---

*Concerns audit: 2026-05-11*

## Known Bugs

**Phase 6 ditch health check stub broken by design change:**
- Symptoms: Ditch health check scheduled at 5:00 AM daily but logs "not yet implemented" errors
- Files: `scheduler.js` lines 108-123, `sms/commands.js` lines 149-162
- Trigger: Scheduled cron job runs daily; manual SMS command "DITCH CHECK" also triggers stub
- Workaround: Stub currently logs error entries to `ditch_health_log` table; no actual flow verification happens
- Fix approach: Original design was to trigger Pool Equipment zone for 60-second test run and read flow meter via Hydrawise API, but that flow meter is permanently broken; new approach needed: either (1) use Garage zones with intermittent meter, (2) rely on tank level sensor (Phase 7), or (3) abandon automated ditch health checks in favor of manual SMS reports during irrigation season

**Polling service has no catchup mechanism for missed cycles:**
- Symptoms: If poll.js crashes or is stopped, zone state transitions during downtime are lost forever; watering_events table will have gaps
- Files: `poll.js` (no historical catchup logic), `ecosystem.config.js` lines 15, 30 (autorestart configured but no state recovery)
- Trigger: PM2 restart delay (5 seconds), network outage during poll, or manual service stop
- Workaround: PM2 autorestart minimizes downtime; Supabase sync every 5 minutes provides off-machine backup
- Fix approach: On startup, query Hydrawise API for recent history (if available) or accept that polling is best-effort monitoring only; alternatively, add a startup check that compares last poll timestamp to Hydrawise controller's last-run timestamps and log a warning if gap detected

**Tank level estimate drifts over time without sensor correction:**
- Symptoms: Tank level calculated via fill rate and consumption (lines 180-227 in `poll.js`) accumulates error; no correction mechanism until Phase 7 sensor is deployed
- Files: `poll.js` lines 180-227 (updateTankLevel function), `zones.config.js` lines 52-58 (tank constants)
- Trigger: Continuous operation; errors compound daily (e.g., inaccurate GPM values, untracked manual water usage, ditch flow interruptions)
- Workaround: Initial tank level hardcoded to `tank.usable_gal` on service start (line 24); manual intervention required if estimate becomes obviously wrong
- Fix approach: Phase 7 ESP32 ultrasonic sensor will provide ground truth; until then, add manual correction API endpoint (POST /api/tank/set-level) or SMS command (TANK SET 800) to reset estimate

**Cron jobs continue to run even if database is locked or corrupted:**
- Symptoms: Scheduler cron jobs (scheduler.js) catch errors per-job but do not halt system; if database is locked or corrupted, jobs will spam error logs indefinitely
- Files: `scheduler.js` lines 17-155 (all cron job definitions have try/catch but no circuit breaker)
- Trigger: SQLite database lock (unlikely with WAL mode but possible), database file corruption, disk full
- Workaround: PM2 logs capture repeated errors for manual investigation
- Fix approach: Add health check mechanism: if 3+ consecutive cron job failures occur across any job, send alert SMS and optionally suspend cron jobs until manual intervention; alternatively, add system-level health check endpoint that external monitoring can ping

## Security Considerations

**No authentication on HTTP API endpoints:**
- Risk: Anyone with network access to port 3001 can query system status, trigger zone commands, inject sensor data, or suspend irrigation
- Files: `server.js` (all routes lines 31-249 have no auth middleware)
- Current mitigation: System runs on local network only; assumes trusted LAN
- Recommendations: (1) Add API key header requirement for write endpoints (/api/zone/*, /api/controller/*, /webhook/sensor); (2) Implement IP whitelist for Twilio webhook validation only; (3) If exposing to internet for remote access, add proper JWT authentication or OAuth; (4) At minimum, add rate limiting to prevent abuse

**API keys and auth tokens in .env file with no encryption:**
- Risk: `.env` file contains HYDRAWISE_API_KEY, TWILIO credentials, SUPABASE keys in plaintext; if file is leaked (e.g., accidental git commit, disk access), full system control is compromised
- Files: `.env` (not in repo per `.gitignore` line 2), loaded by `dotenv` in all entry points
- Current mitigation: `.gitignore` prevents commit; file is local-only; project documentation warns not to commit .env
- Recommendations: (1) Use environment variable injection at runtime (e.g., systemd service files, PM2 ecosystem env block) instead of .env file; (2) Consider secrets manager for production deployment (e.g., AWS Secrets Manager, HashiCorp Vault); (3) Rotate API keys periodically; (4) Add pre-commit hook that scans for accidental .env inclusion

**Twilio webhook signature validation skipped in development:**
- Risk: If TWILIO_AUTH_TOKEN is not set or is placeholder value, SMS handler accepts any POST request to /webhook/sms without validation (lines 25-29 in `sms/handler.js`)
- Files: `sms/handler.js` lines 25-34
- Current mitigation: Intended for development only; production deployment should have real auth token
- Recommendations: Never deploy to production without real TWILIO_AUTH_TOKEN; add startup check that fails if placeholder token detected and NODE_ENV=production; log warning on every unvalidated request

**SQL injection risk in dynamic queries:**
- Risk: Some queries use string interpolation of table names from constants, but all user-provided values use prepared statement parameters; low risk but worth noting
- Files: `sync.js` line 47 (table name interpolated), `coefficient-model.js` line 95 (table name hardcoded), `db.js` (all schema definitions)
- Current mitigation: No user input is used for table names; all data values use parameterized queries
- Recommendations: Current approach is safe; maintain discipline of NEVER interpolating user input into SQL; consider using query builder library (e.g., Knex.js) if query complexity grows

**Supabase anonymous key exposed in environment variables:**
- Risk: SUPABASE_ANON_KEY is "anonymous" public key but still grants database access via Row Level Security policies; if leaked, unauthorized users could read/write data if RLS is misconfigured
- Files: `sync.js` lines 10-11 (key loaded from env), Supabase remote database (RLS policies not visible in this codebase)
- Current mitigation: Assumes Supabase RLS is properly configured to restrict access
- Recommendations: (1) Audit Supabase RLS policies to ensure only authenticated users or specific service roles can write; (2) Consider using service role key instead of anon key for backend sync operations (service role bypasses RLS, so requires trust in backend security); (3) Rotate keys if ever exposed

## Performance Bottlenecks

**Polling every 60 seconds generates high API call volume:**
- Problem: Poll service fetches Hydrawise statusschedule for 3 controllers every 60 seconds = ~4,320 API calls/day; Hydrawise API may have rate limits (not documented in code)
- Files: `poll.js` line 18 (POLL_INTERVAL_MS = 60,000), lines 235-283 (poll function)
- Cause: Conservative polling interval chosen to catch zone state transitions promptly; Hydrawise does not provide webhooks
- Improvement path: (1) Increase interval to 90-120 seconds if 60s is unnecessary; (2) Implement exponential backoff if Hydrawise API returns 429 rate limit errors; (3) Consider using Hydrawise's "next run" schedule data to poll only when activity is expected (e.g., skip polling during night hours 10 PM - 5 AM)

**Synchronous database operations block event loop:**
- Problem: better-sqlite3 runs synchronous SQL operations; large queries or table scans can block Node.js event loop, causing HTTP response delays
- Files: `db.js` (entire file uses synchronous API), `poll.js` lines 134-173 (zone state processing in tight loop), `coefficient-model.js` lines 226-291 (transaction with 23+ zone iterations)
- Cause: better-sqlite3 chosen for simplicity; Node v22 downgrade made async alternatives harder
- Improvement path: (1) Move database operations to worker thread if blocking becomes noticeable; (2) Limit query result set sizes (e.g., add LIMIT clauses to log queries); (3) Index frequently queried columns (timestamp, date, zone_id, controller); (4) Migrate to async SQLite driver if Node.js version constraint is lifted

**No database cleanup for old log entries:**
- Problem: Log tables grow indefinitely; after 1 year of operation, zone_state_log could have ~4M rows (4 state changes/hour × 24 hours × 365 days × 23 zones)
- Files: `db.js` (schema lines 33-78), no archival logic anywhere
- Cause: No retention policy defined; useful to keep full history for machine learning and analysis
- Improvement path: (1) Add monthly cron job to archive logs older than 1 year to separate archive database or CSV export; (2) Delete local rows after successful Supabase sync + 90 day grace period; (3) Add database size monitoring and alert when irrigation.db exceeds 1GB

**Supabase sync can fall behind if offline for extended period:**
- Problem: If internet is down for days, local SQLite log tables will accumulate thousands of rows; when sync resumes, syncTable() fetches 500 rows at a time (line 47 in sync.js) but only syncs once every 5 minutes (line 276 in poll.js)
- Files: `sync.js` lines 38-78 (syncTable function with LIMIT 500), `poll.js` line 276 (sync every 5 poll cycles)
- Cause: Conservative batching to avoid overwhelming Supabase API; sync is best-effort, not critical
- Improvement path: (1) Increase batch size to 1000 or 5000 if Supabase API can handle it; (2) Sync more frequently during catchup (detect lastSyncedId lag and trigger immediate sync); (3) Add sync status endpoint to monitor lag

## Fragile Areas

**Zone state tracking relies on in-memory zoneState object:**
- Files: `poll.js` line 21 (zoneState object), lines 133-173 (processZoneStates function)
- Why fragile: If poll.js restarts, in-memory state is lost; zones that were "on" before restart will not generate "off" events, breaking watering_events records and leaving orphaned "on" entries in zone_state_log
- Safe modification: Never clear zoneState object outside of restart; consider persisting last-known state to database on each transition and rehydrating on startup from zone_state_log (query for zones with state='on' and no corresponding state='off')
- Test coverage: No automated tests for state tracking logic; manual testing required

**Cron job timing assumptions depend on stable system clock:**
- Files: `scheduler.js` lines 17-155 (all cron schedules use specific times in America/Los_Angeles timezone)
- Why fragile: If system clock jumps forward/backward (e.g., NTP correction, DST transition, manual change), cron jobs may skip or double-fire; particularly risky for 2:00 AM jobs during DST spring-forward
- Safe modification: Do not change system time while services are running; add idempotency checks in cron handlers (e.g., skip if today's ET log already exists)
- Test coverage: No tests for DST edge cases

**Controller name matching is case-sensitive and brittle:**
- Files: `poll.js` lines 239-257 (controller discovery maps by name), `zones.config.js` lines 13, 26, 43 (hardcoded controller names)
- Why fragile: If Hydrawise controller name is changed (e.g., "Loomis Garage" → "Loomis garage"), polling breaks silently; no warning, zones just stop being tracked
- Safe modification: Always use exact name match from zones.config.js; add startup validation that checks discovered controller names against config; consider normalizing names (lowercase, trim whitespace)
- Test coverage: No tests for name mismatch scenarios

**Hydrawise API has undocumented response format:**
- Files: `poll.js` lines 96-123 (parseRelays function assumes specific JSON structure)
- Why fragile: Hydrawise API is not formally versioned; if API response schema changes (e.g., relay.time field removed, relay.timestr format changes), parsing breaks and all zones stop being tracked
- Safe modification: Add schema validation/logging for unexpected API response shapes; gracefully handle missing fields; version API URL if Hydrawise ever provides versioned endpoints
- Test coverage: `et-engine.test.js` exists but no tests for poll.js Hydrawise parsing

**Tank level estimate initialization is hardcoded:**
- Files: `poll.js` line 24 (tankLevel = tank.usable_gal)
- Why fragile: Every restart assumes tank is full; if service restarts mid-day when tank is actually at 600 gal, estimate will be wrong until corrected
- Safe modification: On startup, load most recent tank_level_log entry and use that as initial value; only default to usable_gal if no prior data exists
- Test coverage: No tests for tank level persistence

## Scaling Limits

**Single-threaded Node.js architecture:**
- Current capacity: Handles 3 controllers × 23 zones with 60-second polling; ~150 HTTP requests/day (health checks, Twilio webhooks, sensor POSTs)
- Limit: If zone count exceeds ~100 or polling interval drops below 30 seconds, synchronous database operations may cause event loop blocking and delayed HTTP responses
- Scaling path: (1) Move database operations to worker threads; (2) Shard by controller (run separate poll.js instance per controller); (3) Migrate to async database driver; (4) Switch to queue-based architecture with separate consumer processes

**SQLite database is single-writer:**
- Current capacity: One poll.js process + one server.js process both writing to same database via WAL mode; WAL allows concurrent reads but writers still serialize
- Limit: If write frequency exceeds ~1000/sec, lock contention becomes issue; currently far below this (~10 writes/minute during irrigation)
- Scaling path: (1) Partition data: logs stay in SQLite, real-time state moves to Redis; (2) Migrate to PostgreSQL for multi-writer concurrency; (3) Use separate databases per service (poll.js writes to local DB, server.js writes to separate DB, periodic merge)

**Local-only deployment — no redundancy:**
- Current capacity: Runs on single machine; if machine is off or fails, entire system is down
- Limit: System cannot tolerate hardware failure; no geographic redundancy
- Scaling path: (1) Deploy to cloud VM (EC2, DigitalOcean Droplet) with automated backups; (2) Add secondary polling instance in read-only mode for monitoring; (3) Migrate to serverless architecture (AWS Lambda + DynamoDB) for multi-region redundancy; (4) For local deployment, add Raspberry Pi backup that monitors primary server and takes over if it goes down

**Twilio SMS broadcast is serial:**
- Current capacity: `broadcast()` function sends SMS one at a time in for-loop (sender.js lines 92-105)
- Limit: If broadcasting to 100+ users, latency becomes noticeable (~1 sec per SMS = 100 sec total)
- Scaling path: Use Promise.all() to send in parallel (Twilio API supports concurrency); add rate limiting to avoid Twilio throttling (max 1 SMS/sec per account on free tier); consider batching large broadcasts across multiple minutes

## Dependencies at Risk

**Hydrawise API is undocumented and may change without notice:**
- Risk: Core polling functionality depends entirely on Hydrawise statusschedule API; no official documentation, no versioning, no SLA
- Impact: If Hydrawise deprecates or changes API, entire polling system breaks; no alternative API available
- Migration plan: (1) Monitor Hydrawise community forums and release notes for API changes; (2) Add API response logging to detect schema changes early; (3) If API breaks, fallback options: (a) direct hardware control via ESP32 + relays bypassing Hydrawise, (b) migrate to OpenSprinkler or similar open-source controller, (c) reverse-engineer Hydrawise mobile app API

**better-sqlite3 native module requires specific Node version:**
- Risk: Locks project to Node v22; if better-sqlite3 maintainer abandons project or stops supporting v22, upgrade path is blocked
- Impact: Cannot use newer Node.js features; security patches may lag
- Migration plan: (1) Fork better-sqlite3 and maintain our own build if needed; (2) Migrate to sql.js (async) despite earlier failure — reconsider now that codebase is more stable; (3) Switch to PostgreSQL or DuckDB (also has Node native bindings but more active maintenance)

**Open-Meteo free API tier has rate limits:**
- Risk: ET engine fetches from Open-Meteo archive and forecast APIs (et-engine.js); free tier allows "non-commercial use"; if project becomes commercial or hits rate limits, API access may be revoked
- Impact: Daily ET calculations break; irrigation scheduling loses intelligence
- Migration plan: (1) Cache ET data more aggressively (currently fetches daily at 2 AM only, which is safe); (2) Switch to CIMIS (California Irrigation Management Information System) API — official California agricultural data source; (3) Purchase OpenWeather or similar commercial API if needed; (4) Install local weather station with API (e.g., Davis Vantage Pro2 + WeatherLink)

**Twilio is only SMS provider — no fallback:**
- Risk: If Twilio service is down or account is suspended, all notifications and commands fail
- Impact: Cannot alert users of tank low warnings; cannot receive manual commands via SMS
- Migration plan: (1) Add email fallback via SendGrid or Postmark; (2) Add push notification fallback via Pushover or Firebase Cloud Messaging; (3) Build simple web UI dashboard as alternative command interface

## Missing Critical Features

**No automated schedule adjustments based on ET:**
- Problem: System calculates daily target gallons (coefficient-model.js) and logs target vs actual (zone_daily_analysis table), but never adjusts Hydrawise schedules to match target; irrigation remains on static summer schedule
- Blocks: Cannot achieve weather-responsive irrigation; defeats purpose of ET calculations
- Priority: High — this is the core value proposition
- Fix approach: Phase 4 integration with Hydrawise setzone API; calculate daily runtime per zone = (target_gallons / gpm) × 60; call setzone API at 3:00 AM to adjust today's schedule

**No flow meter verification or alerting:**
- Problem: Pool Equipment flow meter is known broken but system never alerts; Garage intermittent meter fails silently
- Blocks: Cannot detect irrigation failures (e.g., broken valve, clogged emitter, pipe leak)
- Priority: Medium — affects water waste and under-watering detection
- Fix approach: Compare expected flow (relay on + GPM × duration) vs actual flow from API; if delta > 20%, log warning and send SMS alert; requires working flow meters

**No user observation feedback loop (Phase 5 incomplete):**
- Problem: SMS handler accepts GOOD/LOW/HIGH observation replies (sms/handler.js lines 156-168) but does not process them; Kz coefficients remain static at 1.0
- Blocks: Cannot learn from user feedback; cannot improve watering accuracy over time
- Priority: Medium — manual Kz tuning is slow and error-prone
- Fix approach: Store observations in observations table; calculate 10-day rolling average ET and gallons-per-day at observation time; adjust Kz based on rating (LOW → Kz × 1.1, HIGH → Kz × 0.9); schedule follow-up observation in 7-14 days

**No tank level sensor integration (Phase 7 incomplete):**
- Problem: Tank level is calculated estimate only; drifts over time; no ground truth
- Blocks: Cannot detect tank overfill, unexpected drainage, or pump failures
- Priority: Medium — current estimate is "good enough" for now but degrades
- Fix approach: Deploy ESP32 with ultrasonic distance sensor (HC-SR04); POST to /webhook/sensor every 5 minutes; system already accepts sensor data (server.js lines 104-132) and logs to tank_sensor_log; need to use sensor readings to correct drift in calculated estimate

**No web dashboard UI:**
- Problem: Only access is via SMS commands or raw database queries; no visual status display
- Blocks: Cannot quickly understand system state; cannot show graphs to others; debugging is tedious
- Priority: Low — SMS interface is sufficient for owner's needs but limits broader adoption
- Fix approach: Build simple React or vanilla JS dashboard; serve from Express static middleware; show current tank level, today's ET, zone run status, 7-day watering history per zone, target vs actual chart

## Test Coverage Gaps

**Poll.js zone state tracking has no tests:**
- What's not tested: Zone on/off transition detection, watering event creation, tank level calculation, state persistence across restarts
- Files: `poll.js` lines 133-227
- Risk: Regression could silently break watering event logging; tank level calculation errors could cause false low-tank warnings
- Priority: High — core polling logic is fragile and complex

**Coefficient model calculation has no tests:**
- What's not tested: Target gallons calculation, ET ratio scaling, Kz application, season detection, daily analysis logging
- Files: `coefficient-model.js` all functions except hardcoded SUMMER_BASELINE constant
- Risk: Math errors could cause persistent over/under-watering; zone-specific bugs could affect specific plant types
- Priority: High — this is the "brain" of weather-responsive irrigation

**Scheduler cron jobs have no automated tests:**
- What's not tested: Cron job timing, execution order, error recovery, skip condition evaluation
- Files: `scheduler.js` lines 17-155
- Risk: Jobs could fail silently; DST transitions could cause double-execution or skips; dependency order violations (e.g., 2:10 AM job runs before 2:00 AM ET fetch completes)
- Priority: Medium — manual testing on schedule changes is tedious

**SMS command parsing has no tests:**
- What's not tested: parseMessage function for all command variants, edge cases like extra whitespace, case variations, typos
- Files: `sms/handler.js` lines 60-91
- Risk: Users send malformed commands and get no feedback or wrong behavior
- Priority: Medium — SMS is primary user interface, parsing must be bulletproof

**Database migration/schema evolution has no tests:**
- What's not tested: Adding new tables, altering existing columns, data backfill scripts
- Files: `db.js` schema definitions lines 28-230
- Risk: Schema changes could break existing deployments; no rollback mechanism
- Priority: Low — schema is stable, but future phases will add tables

**No integration tests for full poll → sync → report flow:**
- What's not tested: End-to-end flow from Hydrawise API poll → database write → Supabase sync → daily report generation
- Files: All files (integration test would span multiple modules)
- Risk: Component tests pass but system fails in production due to timing, data format mismatches, or missing error handling at boundaries
- Priority: Medium — would catch issues like sync lag, report calculation errors, timezone bugs

---

*Concerns audit: 2026-05-11*
