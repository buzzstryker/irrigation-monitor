# Technology Stack

**Analysis Date:** 2026-05-11

## Languages

**Primary:**
- JavaScript (ES6+) - All application code (Node.js backend services)

**Secondary:**
- SQL - Database queries and schema definitions in db.js

## Runtime

**Environment:**
- Node.js v22.22.2

**Package Manager:**
- npm (uses package-lock.json)
- Lockfile: present (package-lock.json)

## Frameworks

**Core:**
- Express 5.2.1 - HTTP server for API endpoints, webhooks, and health checks (server.js)
- better-sqlite3 11.0.0 - Synchronous SQLite database driver for local persistence (db.js)

**Testing:**
- None - Test files exist (et-engine.test.js, coefficient-model.test.js) but no test framework in dependencies

**Build/Dev:**
- PM2 (via ecosystem.config.js) - Process manager running two services: irrigation-poll and irrigation-server
- dotenv 16.4.0 - Environment variable management

## Key Dependencies

**Critical:**
- better-sqlite3 11.0.0 - Local SQLite database for zone states, watering events, ET logs, tank levels, SMS logs
- express 5.2.1 - HTTP API server (port 3001) for Twilio webhooks and web app endpoints
- node-cron 3.0.3 - Scheduled jobs for ET updates (2 AM), skip evaluation (2:05 AM), zone analysis (2:10 AM), ditch checks (5 AM)
- body-parser 2.2.2 - Parses URL-encoded webhooks from Twilio and JSON from web app

**Infrastructure:**
- @supabase/supabase-js 2.101.1 - Cloud sync for SQLite data to Supabase (Phase 4+ feature, configured in sync.js)
- twilio 5.13.1 - SMS/MMS sending and webhook validation (Phase 3, in progress in sms/ directory)

## Configuration

**Environment:**
- Configured via .env file (exists, contents not read per security policy)
- Required variables (from code inspection):
  - HYDRAWISE_API_KEY - Hydrawise controller polling (poll.js)
  - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER - SMS integration (sms/sender.js, sms/handler.js)
  - SUPABASE_URL, SUPABASE_ANON_KEY - Cloud sync (sync.js)
  - LATITUDE, LONGITUDE, ELEVATION_M - Weather/ET calculations (et-engine.js, defaults to Loomis, CA: 38.8024, -121.1964, 122m)
  - PORT - Server port (defaults to 3001)

**Build:**
- ecosystem.config.js - PM2 configuration for two processes
- No TypeScript, no build step (pure JavaScript runtime)

## Platform Requirements

**Development:**
- Node.js v22.22.2 (no .nvmrc file present)
- SQLite3 native bindings (via better-sqlite3)
- Write access for irrigation.db and logs/ directory

**Production:**
- Deployed on local hardware/VM (PM2-managed long-running processes)
- Logs to ./logs/poll-out.log, ./logs/poll-error.log, ./logs/server-out.log, ./logs/server-error.log
- Requires public HTTPS endpoint for Twilio webhook delivery to /webhook/sms

---

*Stack analysis: 2026-05-11*
