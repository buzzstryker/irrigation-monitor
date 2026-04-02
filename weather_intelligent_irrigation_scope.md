# Weather-Intelligent Irrigation System — Scope Document
## Loomis, California Property

*Version 1.0 — Draft*

---

## Overview

A Node.js service running on the Lenovo that replaces static Hydrawise programmed schedules with a dynamic, ET-driven zone controller. The system learns optimal water application rates per zone through a structured observation feedback loop delivered via SMS. All zone commands are issued via the Hydrawise `setzone` API. The Hydrawise app becomes a monitoring tool only — scheduling is owned by this software.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Lenovo (always on)                    │
│                                                          │
│  ┌─────────────┐    ┌──────────────┐   ┌─────────────┐  │
│  │ ET Engine   │───▶│  Scheduler   │──▶│ Hydrawise   │  │
│  │ (Open-Meteo)│    │  (zone cmds) │   │ API client  │  │
│  └─────────────┘    └──────────────┘   └─────────────┘  │
│         │                  │                             │
│         ▼                  ▼                             │
│  ┌─────────────────────────────────┐                     │
│  │         SQLite Database         │                     │
│  │  - ET history                   │                     │
│  │  - Zone application log         │                     │
│  │  - Zone coefficients            │                     │
│  │  - Observations                 │                     │
│  │  - Scheduled reminders          │                     │
│  └─────────────────────────────────┘                     │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐    ┌──────────────┐                     │
│  │   Twilio    │◀──▶│ SMS Handler  │                     │
│  │  (inbound   │    │  (Express)   │                     │
│  │  webhook)   │    └──────────────┘                     │
└──┴─────────────┴─────────────────────────────────────────┘
```

---

## Core Concepts

### ET (Evapotranspiration)
The amount of water lost from soil and plants per day, measured in inches or gallons per square foot. Open-Meteo provides hourly temperature, humidity, wind speed, and solar radiation — from these the system calculates reference ET (ETo) using the Penman-Monteith equation (industry standard).

### Zone Coefficient (Kz)
Each zone has a learned coefficient that translates ET into required water application:

```
gallons_to_apply = ET_today × Kz × zone_area_sqft
```

Kz starts at a default value (1.0) and is adjusted up or down based on user observations. Over a season it converges on the correct value for each zone's specific conditions (sun exposure, soil type, head type, plant variety).

### Application Rate Ceiling
No zone will be commanded to apply more water than its measured GPM × maximum safe runtime allows, and no sequence of zones will be scheduled such that the tank drops below 450 gallons at any projected point in the day.

---

## Data Sources

| Source | Data | Cost | Notes |
|--------|------|------|-------|
| Open-Meteo | Hourly temp, humidity, wind, solar radiation, forecast | Free | No API key required |
| Hydrawise API | Zone state, flow meter readings, manual run commands | Free | Existing setup |
| SQLite (local) | All historical data, coefficients, observations | Free | Existing db |
| Twilio | SMS send/receive | ~$1/mo + usage | Node SDK |

---

## Zone Inventory (All Three Controllers)

### Garage Controller

| Zone | Name | Type | GPM | Default Kz |
|------|------|------|-----|------------|
| Z1 | Frontyard East Sod | Sod | 7.8 | 1.0 |
| Z2 | Frontyard West Sod | Sod | 14.4 | 1.0 |
| Z3 | Backyard East Sod | Sod | 10.8 | 1.0 |
| Z4 | Backyard West Sod | Sod | 7.6 | 1.0 |
| Z6 | Frontyard Drip | Drip | 10.4 | 1.0 |
| Z7 | Backyard House Drip | Drip | 2.8 | 1.0 |
| Z8 | Garden Raised Beds | Drip | 3.0 | 1.0 |
| Z9 | Viewshed Hedges | Drip | 4.0 | 1.0 |

### Pool Equipment Controller

| Zone | Name | Type | GPM | Default Kz |
|------|------|------|-----|------------|
| Z1 | Pool Drip | Drip | 1.7 | 1.0 |
| Z2 | Soccer West South | Sod | 9.2 | 1.0 |
| Z3 | Soccer West North | Sod | 7.0 | 1.0 |
| Z4 | Soccer East South | Sod | 13.0 | 1.0 |
| Z5 | Soccer East North | Sod | 9.5 | 1.0 |
| Z6 | Soccer East North2 | Sod | 7.0 | 1.0 |
| Z7 | East Trees South | Sod | 10.5 | 1.0 |
| Z8 | East Trees North | Sod | 16.0 | 1.0 |
| Z9 | West Trees Woodpile | Sod | 12.0 | 1.0 |
| Z10 | West Trees Rocks | Sod | 11.0 | 1.0 |
| Z11 | West Trees Septic | Sod | 10.0 | 1.0 |

### Barn Controller

| Zone | Name | Type | GPM | Default Kz |
|------|------|------|-----|------------|
| TBD | Iris & Street Front Drip | Drip | TBD | 1.0 |
| TBD | Barn Fruit Trees | Drip | TBD | 1.0 |

*Barn zone GPM to be populated after flow meter data is captured.*

---

## Daily Scheduling Loop

Runs once per day at 2:00 AM:

```
1. Fetch yesterday's actual ET from Open-Meteo (Loomis coords)
2. Fetch today's forecast ET
3. For each active zone:
   a. Calculate gallons_needed = ET × Kz × zone_area
   b. Calculate runtime_minutes = gallons_needed / zone_gpm
   c. Assign to optimized time slot (respecting tank model)
4. Run tank simulation with proposed schedule
   - If any point projects below 450 gal → redistribute or defer lowest-priority zones
5. Issue setzone commands via Hydrawise API at scheduled times
6. Log every run: zone, start_time, duration, gallons_applied, ET_used, Kz_at_time
```

---

## Observation Feedback Loop

### Trigger
The system schedules a check-in SMS for each zone on a rolling 10-day cycle after any coefficient adjustment, or on a 30-day routine check during active season.

### Outbound SMS Format
```
Loomis Irrigation: Soccer East Sod check-in.
Last 10 days: ET avg 0.28 in/day, applied 4.2 gal/day.
Kz: 1.0 (baseline). How does it look?
Reply: GOOD, LOW, HIGH, or SKIP
```

### Inbound Reply Handling

| Reply | Action | Kz Adjustment | Next Check |
|-------|--------|---------------|------------|
| GOOD | Log positive observation | None | 30 days |
| LOW | Increase application | Kz × 1.15 | 10 days |
| HIGH | Decrease application | Kz × 0.85 | 10 days |
| SKIP | Defer reminder | None | 7 days |

### Confirmation SMS (sent immediately after reply)
```
Got it. Reducing Soccer East Sod by 15%.
New daily target: 3.6 gal (was 4.2 gal).
I'll check in again on April 18.
```

### Coefficient Guardrails
- Kz never goes below 0.4 (prevent severe underwatering)
- Kz never goes above 2.0 (prevent tank overload)
- Any adjustment > 30% in a single step triggers a confirmation SMS before applying

---

## Ditch Water Health Check

Leverages the flow meter on Pool Equipment controller to detect ditch water delivery failures:

1. Once per day at 5:00 AM, trigger a 60-second manual run on a Pool Equipment zone
2. Read flow meter via `statusschedule` API
3. If flow = 0 and zone current > 0 mA (valve opened but no water): **ditch failure detected**
4. Send SMS alert: *"⚠️ Loomis Irrigation: No flow detected on ditch water check. Tank may not be filling. Check ditch supply."*
5. Log event to `warnings` table
6. Suspend all non-critical zones until flow is confirmed restored

---

## Seasonal Modes

| Mode | Dates | Behavior |
|------|-------|----------|
| Spring | Mar 15 – May 15 | Sod Kz × 0.67, drips unchanged, city water (barn location) |
| Summer | May 16 – Oct 15 | Full ET-based scheduling, ditch water |
| Off-season | Oct 16 – Mar 14 | All zones suspended |

Mode transitions send an SMS notification and require no manual action.

---

## SMS Commands (User-Initiated)

Beyond observation replies, the user can text commands at any time:

| Command | Action |
|---------|--------|
| `STATUS` | Returns current tank level, today's ET, zones run today |
| `SUSPEND 3` | Suspends all irrigation for 3 days (rain event etc.) |
| `RESUME` | Cancels any active suspension |
| `SKIP TODAY` | Skips today's irrigation cycle |
| `ZONE PE-Z4 HIGH` | Manual observation on a specific zone without waiting for prompt |
| `DITCH CHECK` | Manually triggers a flow meter health check |
| `TANK` | Returns current calculated tank level and recent trend |

---

## Database Schema Additions

New tables added to existing `irrigation.db`:

**`et_log`**
```
id, date, et_inches, temp_high_f, temp_low_f, humidity_pct, wind_mph, solar_rad
```

**`zone_coefficients`**
```
id, zone_id, controller, kz_value, last_updated, observation_count
```

**`observations`**
```
id, timestamp, zone_id, rating (GOOD/LOW/HIGH), et_avg_10day, 
gallons_per_day_at_time, kz_before, kz_after, follow_up_date
```

**`sms_log`**
```
id, timestamp, direction (in/out), from_number, body, parsed_command, zone_id
```

**`scheduled_reminders`**
```
id, zone_id, reminder_date, reminder_type, status (pending/sent/replied)
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js (existing) |
| Database | SQLite via better-sqlite3 (existing) |
| Hydrawise API | Existing hydrawise.js client |
| ET calculation | Open-Meteo REST API (free, no key) |
| SMS | Twilio Node SDK |
| Inbound SMS webhook | Express.js (small addition to existing service) |
| Scheduling | node-cron (lightweight, no external dependency) |
| Process management | pm2 (existing) |

---

## Implementation Phases

### Phase 1 — ET Engine + Logging (no zone control yet)
- Integrate Open-Meteo API
- Calculate daily ET for Loomis coords
- Log ET to database alongside existing zone run logs
- Run in parallel with existing static schedule for 2 weeks to establish baseline
- **Deliverable:** Confirmed ET data flowing into db, no behavior change yet

### Phase 2 — Zone Coefficient Model
- Build `zone_coefficients` table with defaults
- Calculate daily target gallons per zone from ET × Kz
- Compare against what static schedule is actually applying
- Log the delta — this shows where the static schedule is over/under watering
- **Deliverable:** Report showing current vs ET-optimized application per zone

### Phase 3 — Twilio SMS Integration
- Set up Twilio account and phone number
- Build outbound SMS sender
- Build inbound webhook (Express endpoint)
- Build command parser (GOOD/LOW/HIGH/SKIP + manual commands)
- Test with STATUS and TANK commands before any zone control
- **Deliverable:** Two-way SMS working, user can query system state

### Phase 4 — Take Control of Scheduling
- Disable Hydrawise programmed schedules (suspend all programs in app)
- System issues all zone commands via setzone API
- Tank model runs before each day's schedule to verify safety
- **Deliverable:** System fully in control of irrigation timing and duration

### Phase 5 — Observation Loop + Learning
- Enable scheduled check-in SMS per zone
- Kz adjustment logic on reply
- Follow-up reminder scheduling
- Guardrails and confirmation for large adjustments
- **Deliverable:** Full learning loop operational

### Phase 6 — Ditch Health Check
- Daily flow meter diagnostic
- SMS alert on failure
- Auto-suspend on confirmed failure
- **Deliverable:** Automatic supply monitoring

---

## Open Questions

- [ ] Barn zone relay IDs and GPM — needed before Barn can be included in Phase 4
- [ ] Garage Z6 Frontyard Drip zone type confirmation — affects ET coefficient calculation (drip vs spray have different application efficiency)
- [ ] Zone square footage — needed for accurate ET-to-gallons conversion. Can be estimated from satellite imagery if not known
- [ ] Twilio phone number — US long code (~$1/mo) or toll-free ($2/mo). Long code fine for personal use.
- [ ] Should the system water every day, or skip days when ET is below a threshold (e.g. cool cloudy days where ET < 0.1 inches)?

---

*Next step: Start with Phase 1 — ET engine integration into existing irrigation-monitor project.*
*Estimated Claude Code sessions to Phase 1 completion: 1–2*
