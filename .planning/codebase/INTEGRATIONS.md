# External Integrations

**Analysis Date:** 2026-05-11

## APIs & External Services

**Hydrawise (Irrigation Controller):**
- Purpose: Poll zone states, trigger manual runs, read flow meters
- Endpoints used:
  - https://api.hydrawise.com/api/v1/customerdetails.php - Discover controller IDs (poll.js:40)
  - https://api.hydrawise.com/api/v1/statusschedule.php - Real-time zone status and relay states (poll.js:74)
- SDK/Client: Native fetch API (no SDK)
- Auth: API key in query string (?api_key=...)
- Env var: HYDRAWISE_API_KEY
- Polling: Every 60 seconds via poll.js
- Controllers: Three Hydrawise HC controllers named "Loomis Garage", "Loomis Pool Equipment", "Loomis barn" (configured in zones.config.js)

**Open-Meteo (Weather Data):**
- Purpose: Fetch weather data for ET (evapotranspiration) calculations
- Endpoints used:
  - https://archive-api.open-meteo.com/v1/archive - Historical weather (5-day lookback, et-engine.js:138)
  - https://api.open-meteo.com/v1/forecast - 3-day forecast (et-engine.js:154)
- SDK/Client: Native fetch API
- Auth: None (free tier, no API key)
- Variables fetched: temp_max, temp_min, humidity, wind_speed, solar_radiation, precipitation
- Location: Loomis, CA (38.8024°N, 121.1964°W, 122m elevation)
- Used by: et-engine.js for FAO-56 Penman-Monteith ET calculation

**Twilio (SMS/MMS):**
- Purpose: Inbound SMS command handling, outbound notifications
- SDK/Client: twilio package v5.13.1
- Auth: Account SID and Auth Token
- Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
- Implementation:
  - Outbound: sms/sender.js (sendSMS, sendMMS, broadcast functions)
  - Inbound: sms/handler.js (webhook handler with signature validation)
  - Commands: STATUS, TANK, SUSPEND, RESUME, SKIP TODAY, DITCH CHECK, GOOD/LOW/HIGH/SKIP (observation replies)
- Phase: Phase 3 (in progress)

**Supabase (Cloud Database):**
- Purpose: Sync local SQLite data to cloud for web app access
- SDK/Client: @supabase/supabase-js v2.101.1
- Auth: Anonymous key (public read/write)
- Env vars: SUPABASE_URL, SUPABASE_ANON_KEY
- Sync strategy: High-water mark tracking per table, 500 rows per batch, runs every 5 minutes during poll cycle (sync.js)
- Tables synced: et_log, watering_events, tank_level_log, observations, tank_sensor_log, zone_coefficients
- Transforms: Unix epoch timestamps to ISO 8601 strings
- Phase: Phase 4+ (configured but deployment pending)

## Data Storage

**Databases:**
- SQLite3 (local file: irrigation.db)
  - Connection: Synchronous via better-sqlite3
  - Client: db.js exports getDb() singleton
  - Tables: 14 tables including zone_state_log, watering_events, tank_level_log, et_log, sms_log, observations, ditch_health_log, user_preferences
  - Pragmas: WAL mode, foreign keys enabled

**File Storage:**
- Local filesystem only
- Logs written to ./logs/ directory (PM2-managed)
- Database file: ./irrigation.db in project root

**Caching:**
- None (in-memory state in poll.js for zone transition detection)

## Authentication & Identity

**Auth Provider:**
- Custom (phone-based identification)
  - Implementation: SMS handler looks up users by phone number in user_preferences table (sms/handler.js:54)
  - No passwords, no OAuth
  - User roles: owner, spouse, landscaper, other

## Monitoring & Observability

**Error Tracking:**
- None (console logging only)

**Logs:**
- Console output captured by PM2
- Log files: ./logs/poll-out.log, ./logs/poll-error.log, ./logs/server-out.log, ./logs/server-error.log
- Log format: Prefixed with [POLL], [SERVER], [SMS], [sync], [CRON], [API], [SENSOR]

## CI/CD & Deployment

**Hosting:**
- Self-hosted (local hardware/VM)
- Process manager: PM2 with ecosystem.config.js
- Start command: npm start (runs pm2 start ecosystem.config.js)

**CI Pipeline:**
- None (manual deployment)

## Environment Configuration

**Required env vars:**
- HYDRAWISE_API_KEY - Controller polling (system fails gracefully if missing)
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER - SMS (dry-run mode if missing)
- SUPABASE_URL, SUPABASE_ANON_KEY - Cloud sync (disabled if missing)

**Optional env vars:**
- LATITUDE, LONGITUDE, ELEVATION_M - Weather location (defaults to Loomis, CA)
- PORT - Server port (defaults to 3001)

**Secrets location:**
- .env file in project root (exists, git-ignored)

## Webhooks & Callbacks

**Incoming:**
- POST /webhook/sms - Twilio inbound SMS webhook (server.js:98, handler in sms/handler.js)
  - Validates Twilio signature
  - Returns empty TwiML response
- POST /webhook/sensor - ESP32 tank sensor data (Phase 7 stub, server.js:104)
  - Expects JSON: { depth_inches, level_gallons }

**Outgoing:**
- None (all integrations are pull-based or initiated by this system)

## Future Integrations (Planned)

**Next.js Web App (Phase 8+):**
- Hosting: Vercel
- Data source: Supabase (cloud database)
- Authentication: Supabase Auth (not yet configured)

**ESP32 Tank Sensor (Phase 7):**
- Hardware: Ultrasonic distance sensor
- Protocol: HTTP POST to /webhook/sensor
- Data: Tank depth in inches, calculated gallons

**Hydrawise Write Operations (Phase 4):**
- Endpoints: setzone API for manual zone start/stop
- Currently stubbed in server.js:138-189

---

*Integration audit: 2026-05-11*
