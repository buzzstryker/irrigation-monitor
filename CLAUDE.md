# CLAUDE.md — Irrigation Monitor
## Loomis, California Property — Weather-Intelligent Irrigation System

This file gives Claude Code instant context about the project. Read this before writing any code.

---

## Project Overview

A Node.js service running on a Lenovo Legion (Windows/WSL) that replaces static Hydrawise programmed schedules with a dynamic, ET-driven zone controller. The system learns optimal water application rates per zone through a structured SMS observation feedback loop. All zone commands are issued via the Hydrawise `setzone` API. The Hydrawise app becomes monitoring-only — scheduling is owned by this software.

**Local project path:** `C:\Users\buzzs\Desktop\Projects\irrigation-monitor\`
**GitHub:** Not yet pushed — create repo at github.com/buzzstryker/irrigation-monitor
**Node version:** v22.22.2 (downgraded from 24 — better-sqlite3 requires this)
**Process manager:** pm2 (two processes: irrigation-poll, irrigation-server)

---

## System Architecture

```
Lenovo (always on)
+-- poll.js                    — Hydrawise polling every 60s, all 3 controllers
+-- server.js                  — Express port 3001, 8 endpoints
+-- et-engine.js               — Open-Meteo fetch + Penman-Monteith ETo
+-- et-logger.js               — Daily 2AM cron, logs actual + forecast ET
+-- scheduler.js               — 7 cron jobs
+-- coefficient-model.js       — Zone Kz model, daily target vs actual
+-- sync.js                    — SQLite ? Supabase sync
+-- zones.config.js            — Full zone inventory + tank constants
+-- db.js                      — better-sqlite3, 15 tables, getDb() sync pattern
+-- tank-drawdown-calibration.js — Tank-drawdown GPM calibration CLI
+-- migrations/                — SQL migration files
+-- sms/
¦   +-- handler.js             — Twilio inbound webhook
¦   +-- sender.js              — sendSMS(), sendMMS(), broadcast()
¦   +-- commands.js            — STATUS, TANK, SUSPEND, RESUME, SKIP TODAY, DITCH CHECK
+-- reports/
¦   +-- daily-report.js        — Console report, target vs actual per zone
+-- supabase/
¦   +-- schema.sql             — Postgres schema with RLS
¦   +-- seed.sql               — All 3 controllers, 22 zones
+-- ecosystem.config.js        — pm2: irrigation-poll + irrigation-server
```

---

## Property & System Constants

| Parameter | Value |
|-----------|-------|
| Location | Loomis, CA (lat: 38.8024, lon: -121.1964, elevation: 122m) |
| Tank capacity | 1,725 gal total, 981 gal usable |
| Pump cutoff | ~408 gal (dry-run sensor) |
| Ditch fill rate | 5.77 GPM (346 GPH, 24/7) — measured 2026-05 |
| Ditch water season | April 15 – October 15 |
| City water season | March 15 – April 14 (BARN LOCATION ONLY) |
| Off-season | October 16 – March 14 |
| Spring sod multiplier | 0.67× summer demand |
| ET summer baseline | 0.25 in/day |
| Tank safety floor | 450 gal (never schedule below this) |

---

## Controllers & Zones

### Garage Controller (id: 1659477) — flow meter physically installed
| Zone | Name | Type | GPM |
|------|------|------|-----|
| Z1 | Frontyard East Sod | Sod | 7.8 |
| Z2 | Frontyard West Sod | Sod | 14.4 |
| Z3 | Backyard East Sod | Sod | 10.8 |
| Z4 | Backyard West Sod | Sod | 7.6 |
| Z5 | **Capped (vestigial)** | System | 0.0 |
| Z6 | Frontyard Drip | Drip | 10.4 |
| Z7 | Backyard House Drip | Drip | 2.8 |
| Z8 | Garden Raised Beds | Drip | 3.0 |
| Z9 | Viewshed Hedges East | Drip | 4.0 |

**Z5 Note:** Physically capped (as of 2026-05-11). Was Phase 4a attribution gate; deprecated. Safe to leave as-is. See "Phase 4a History" section below for context.

### Pool Equipment Controller (id: 1977673) — physical flow meter installed but unreliable
| Zone | Name | Type | GPM |
|------|------|------|-----|
| Z1 | Pool Drip | Drip | 1.7 |
| Z2 | Soccer West South | Sod | 9.2 |
| Z3 | Soccer West North | Sod | 7.0 |
| Z4 | Soccer East South | Sod | 13.0 |
| Z5 | Soccer East North | Sod | 9.5 |
| Z6 | Soccer East North2 | Sod | 7.0 |
| Z7 | East Trees South | Sod | 10.5 |
| Z8 | East Trees North | Sod | 16.0 |
| Z9 | West Trees Woodpile | Sod | 12.0 |
| Z10 | West Trees Rocks | Sod | 11.0 |
| Z11 | West Trees Septic | Sod | 10.0 |

**Note:** GPM values should be re-measured via tank-drawdown calibration when emitter configuration changes.

### Barn Controller (id: 1970558) — NO flow meter, duration scaling only
| Zone | Name | Type | GPM |
|------|------|------|-----|
| Z5 | Iris & Street Front Drip | Drip | TBD |
| Z6 | Barn Fruit Trees Drip | Drip | TBD |

**Honcut Ranch (id: 1659099):** On Hydrawise account but OUT OF SCOPE — do not include.

---

## Database Schema (15 tables)

| Table | Phase | Purpose |
|-------|-------|---------|
| zone_state_log | 0 | Zone on/off transitions every poll |
| tank_level_log | 0 | Tank level every 60s |
| watering_events | 0 | Completed zone runs; gallons calculated from configured GPM × duration |
| warnings | 0 | Low tank, ditch failure alerts |
| et_log | 1 | Daily ET from Open-Meteo |
| zone_coefficients | 2 | Per-zone Kz learning coefficients |
| zone_daily_analysis | 2 | Daily target vs actual per zone |
| sms_log | 3 | All inbound/outbound SMS |
| observations | 5 | User feedback ratings per zone |
| scheduled_reminders | 5 | Check-in SMS schedule |
| ditch_health_log | 6 | Daily flow meter diagnostic |
| tank_sensor_log | 7 | ESP32 ultrasonic sensor readings |
| user_preferences | — | Per-user language, phone, role |
| flow_calibration_log | 4 | Tank-drawdown GPM calibration measurements |
| et_forecast_log | 1 | Multi-day ET forecast snapshots |

**Note:** `watering_events.flow_source` and `flow_quality` columns always contain 'calculated' (backfilled 2026-05-12)

**Pattern:** Always use `getDb()` from db.js — synchronous better-sqlite3.
**Never use:** async initDb() or sql.js — was a failed workaround, now replaced.

---

## Implementation Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 0 | ✅ Complete | Hydrawise polling, zone state, tank model |
| 1 | ✅ Complete | ET engine (Open-Meteo + Penman-Monteith), daily logging |
| 2 | ✅ Complete | Zone coefficient model, daily target vs actual report |
| 3 | ⏸️ Paused | Twilio SMS — account created, credentials needed |
| 4 | ⬜ Pending | Scheduling cutover via Hydrawise setzone API |
| 5 | ⬜ Pending | Observation feedback loop, Kz learning |
| 6 | ⬜ Pending | Ditch water health check |
| 7 | ⬜ Pending | ESP32 tank sensor (~$20 hardware) |

---

## Optimized Static Schedule (baseline before Phase 4)

This is the manually-entered Hydrawise schedule to use until Phase 4 takes control.

### Summer (Apr 15 – Oct 15) — 1,398.6 gal/day

**Garage Program A (3:00 AM):** Z7 12min, Z8 4min, Z9 15min
**Garage Program B (5:00 AM):** Z1 5min, Z3 5min, Z4 5min, Z2 5min
**Garage Program C (6:00 PM):** Z6 30min

**Pool Equip Program A (11:00 PM):** Z2 5min, Z3 5min, Z4 5min, Z5 5min, Z6 5min
**Pool Equip Program B (1:00 AM):** Z1 20min, Z7 7min, Z8 7min
**Pool Equip Program C (9:00 PM):** Z9 10min, Z10 10min, Z11 10min

**Tank minimum:** 780 gal at 9:29 PM (80% usable, 372 gal above pump cutoff)

### Spring (Mar 15 – May 15) — ~1,025 gal/day
Same timing, sod zones × 0.67 duration, drips unchanged.

---

## SMS Observation Feedback System

### Outbound MMS (monthly check-in)
- Zone photo attached (stored in `zone-images/`)
- ET avg last 30 days, gallons applied, current Kz
- Default rating pre-set to GOOD

### Reply Commands
| Reply | Action | Kz Change | Next Check |
|-------|--------|-----------|------------|
| GOOD | Log positive | None | 30 days |
| LOW | Increase water | Kz × 1.15 | 10 days |
| HIGH | Decrease water | Kz × 0.85 | 10 days |
| SKIP | Defer | None | 7 days |

### Manual SMS Commands
`STATUS`, `TANK`, `SUSPEND [n]`, `RESUME`, `SKIP TODAY`, `DITCH CHECK`

### Recipients
- Per-zone recipient arrays in zones.config.js
- Landscaper feedback takes priority over owner
- All feedback logged with user identity
- Confirmation SMS sent to all recipients after any reply

### Language
- Per-user language preference in user_preferences table
- Translation via Claude API on send
- Reply keywords (GOOD/LOW/HIGH/SKIP) always English

---

## Web App (Phase 4+)

**Stack:** Next.js + Supabase + Vercel (same as Late Add v2)
**Tabs:** Dashboard, Zones, Check-In, History/Logs, Control, Settings

**Check-in flow:**
- Monthly SMS with link to web app
- User identifies themselves (name selection, no password)
- All zones shown with photo, default GOOD pre-selected
- Submit all ratings at once
- Fresh session button available anytime

**Dashboard shows:** Tank level, ET today, ditch health check result, today's schedule, active warnings, weather forecast

---

## Key Design Decisions

1. **No zone square footage** — ET-to-gallons uses historical summer baseline ÷ summer ET avg instead
2. **Barn uses duration scaling** — no flow meter, runtime = baseline_minutes × (ET/ET_avg) × Kz
3. **Skip irrigation if:** ET < 0.05 in, forecast rain > 0.25 in, or yesterday rain > 0.5 in
4. **Temperature threshold:** Don't water when forecast < 68°F (matches current Hydrawise Predictive Watering setting)
5. **Hydrawise programs suspended** when Phase 4 takes control — system issues setzone commands only
6. **Conflict detection:** Daily check that Hydrawise programs are still suspended — alert if re-enabled
7. **sql.js was a failed workaround** for Node 24 — Node was downgraded to 22, better-sqlite3 reinstalled
8. **Per-zone GPM is static configuration** — Real-time flow measurement is not available via the Hydrawise REST API v1 (investigated and documented 2026-05-12; see docs/hydrawise-api-flow-fields.md). Per-zone GPM values are manually maintained in zones.config.js. These should be re-measured and updated whenever emitter configuration changes (added/removed/repaired outlets downstream of a valve). Tank-drawdown calibration via tank-drawdown-calibration.js is the recommended measurement method: run a zone for known duration, measure tank level before/after, subtract concurrent ditch fill, compute GPM.

---

## Environment Variables (.env)

```
HYDRAWISE_API_KEY=         # Hydrawise account API key
LATITUDE=38.8024
LONGITUDE=-121.1964
ELEVATION_M=122
SUPABASE_URL=              # From Supabase dashboard
SUPABASE_ANON_KEY=         # From Supabase dashboard
TWILIO_ACCOUNT_SID=        # From Twilio console (starts with AC...)
TWILIO_AUTH_TOKEN=         # From Twilio console
TWILIO_PHONE_NUMBER=       # +1XXXXXXXXXX format
OWNER_PHONE=               # Owner's phone +1XXXXXXXXXX
PORT=3001
DB_PATH=./irrigation.db
```

---

## Open To-Dos

- [x] ~~Push irrigation-monitor to GitHub~~ — created at github.com/buzzstryker/irrigation-monitor (2026-05-11)
- [ ] Add Twilio Auth Token and phone number to .env (Phase 3)
- [ ] Create Supabase project, run schema.sql + seed.sql
- [ ] Walk Garage Z6 Frontyard Drip while running — verify spray vs drip (10.4 GPM is anomalously high for drip)
- [ ] Capture Barn controller zone relay IDs
- [ ] Cutover city water from barn location (not house) before spring irrigation
- [ ] Deploy to Railway for always-on cloud polling (after Phase 3)
- [ ] Import zone photos from Hydrawise screenshots into zone-images/ folder
- [ ] Implement optimized schedule in Hydrawise app (manual until Phase 4)
- [ ] Periodic GPM re-measurement via tank-drawdown-calibration.js when emitter configuration changes

---

## Services Stack

| Service | Purpose | Cost |
|---------|---------|------|
| GitHub | Code hosting | Free |
| Supabase | Postgres backend, RLS | Free tier |
| Vercel | Web app deployment | Free tier |
| Hydrawise API | Controller polling | Free |
| Open-Meteo | Weather + ET data | Free |
| Twilio | SMS/MMS | ~$1/mo + usage |
| Railway | Cloud server for polling | ~$7/mo |
| Anthropic API | SMS translation | Pay per use |

---

## Phase 4a History

Phase 4a (Attribution Infrastructure) was developed in May 2026 with the goal of capturing real-time per-zone flow data from the Hydrawise flow meters via the REST v1 API. The design assumed that during an active zone run, the API would expose a real-time GPM value that could be attributed to the running zone — and for Pool Equipment zones (whose flow meter is unreliable), the architecture used a capped "dummy" Z5 valve on the Garage controller to gate flow readings through the Garage flow meter.

The infrastructure was built across multiple sessions: a flowMeterAttribution config block in zones.config.js, new database tables (flow_attribution_warnings, controller_flow_meter_health, controller_flow_meter_health_log, z5_selftest_log, flow_calibration_log), standalone modules (z5-startup-selftest.js, flow-calibration.js), and dashboard support for attribution-aware flow display.

Then a focused investigation in May 2026 (see docs/hydrawise-api-flow-fields.md) determined definitively that the Hydrawise REST v1 API does NOT expose real-time flow data — neither in the statusschedule.php endpoint during an active run, nor in any documented historical endpoint. The only flow-related field is the meter calibration constant (sensors[0].rate), not live data.

Phase 4a's infrastructure was deprecated in May 2026 across six refactor waves. See docs/phase-4a-audit.md for the complete audit of what was removed, repurposed, or kept. The flow_calibration_log table survives, repurposed for tank-drawdown calibration measurements (tank_gpm is now the primary measured value, not a cross-check).

**The new architecture (current):** Per-zone GPM is a manual static input in zones.config.js, updated whenever emitter configuration changes. Tank-drawdown calibration via tank-drawdown-calibration.js is the closest approximation to measurement available without real-time API data. Real-time per-zone flow data would require migrating to Hydrawise's undocumented GraphQL API, which is potential future work but not currently planned.

**What was learned:** Building infrastructure before validating API capabilities is costly. The Phase 4a work wasn't wasted — it forced a systematic investigation of the API's actual capabilities and produced the tank-drawdown measurement method as a workaround. But validating the API first (via a 5-minute focused test with an active zone) would have saved ~8 hours of infrastructure development that had to be unwound.

---

*Last updated 2026-05-19 — Phase 4a deprecated in favor of static-GPM architecture. Phases 0, 1, 2 complete. Phase 3 paused. Phase 4 pending.*
