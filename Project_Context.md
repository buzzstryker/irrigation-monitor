# Project Context — irrigation-monitor

*Master template lives at: `C:\Users\buzzs\OneDrive\Desktop\Projects\Project_Context_TEMPLATE.md`*

---

## What this project is

A Node.js service running on a Lenovo Legion (Windows/WSL, always-on) that replaces static Hydrawise programmed schedules at the Loomis, CA property with a dynamic, ET-driven zone controller. The system polls three Hydrawise controllers (Garage, Pool Equipment, Barn), maintains a local SQLite database of zone state, tank level, watering events, and per-zone learning coefficients, and (in later phases) takes scheduling control via the Hydrawise setzone API. A structured SMS observation feedback loop (Twilio) lets the property owner and landscaper rate zone health, which updates per-zone Kz coefficients over time. The Hydrawise app becomes monitoring-only — scheduling is owned by this software.

## Stack

- **Frontend:** None yet. Phase 4+ adds a Next.js web app for dashboard/check-in/control.
- **Backend:** Node.js v22.22.2, Express on port 3001, better-sqlite3 for local persistence, pm2 process manager (two processes: irrigation-poll, irrigation-server).
- **Hosting:** Local — Lenovo Legion, always on. Future Phase 3+: Railway for always-on cloud polling (~$7/mo).
- **Auth:** N/A currently. Phase 4 web app will use Supabase auth (OTP code flow per procedure section 2.2b).
- **Other:**
  - Hydrawise API — controller polling and (Phase 4) setzone commands
  - Open-Meteo API — weather + ET data (free)
  - Twilio — SMS/MMS for observation feedback loop (Phase 3, in progress)
  - Supabase (Phase 4+) — Postgres backend with RLS, for web app data layer
  - Anthropic API — SMS translation per recipient language preference

## Repo structure

- **GitHub:** https://github.com/buzzstryker/irrigation-monitor
- **Local path:** `C:\Users\buzzs\Desktop\Projects\irrigation-monitor\` (DELIBERATELY OUTSIDE OneDrive — see Key decisions)
- **Default branch:** `master`
- **Top-level layout:**
  - `poll.js` — Hydrawise polling loop, all 3 controllers, every 60s
  - `server.js` — Express server, 8 endpoints
  - `et-engine.js` — Open-Meteo fetch + Penman-Monteith ETo
  - `et-logger.js` — Daily 2AM cron, logs actual + forecast ET
  - `scheduler.js` — 7 cron jobs
  - `coefficient-model.js` — Zone Kz model, daily target vs actual
  - `sync.js` — SQLite → Supabase sync (Phase 4+)
  - `zones.config.js` — Full zone inventory + tank/ditch constants
  - `db.js` — better-sqlite3 wrapper, 13 tables, synchronous getDb() pattern
  - `sms/` — Twilio handler, sender, command parser (Phase 3)
  - `reports/` — Daily console report
  - `supabase/` — Postgres schema + seed (Phase 4+)
  - `ecosystem.config.js` — pm2 process definitions

## Data model

See CLAUDE.md "Database Schema (13 tables)" section for the canonical table list and phase mapping. Brief overview: zone state, tank level, watering events, warnings, daily ET log, per-zone learning coefficients, daily target-vs-actual analysis, SMS log, observation ratings, scheduled reminders, ditch health diagnostic log, ESP32 tank sensor readings, user preferences. Always use synchronous `getDb()` from db.js — never use async initDb() or sql.js (failed workaround, replaced).

## Key decisions

- Two-doc design: this file (Project_Context.md) is the procedural anchor (working agreement, stack, repo, high-level overview). CLAUDE.md is the operational anchor (zones, schema, phases, optimized schedule, key design decisions). Both are authoritative for their respective scopes. See "Cross-reference" section below.
- **Project deliberately lives OUTSIDE OneDrive at `C:\Users\buzzs\Desktop\Projects\irrigation-monitor\`.** The procedure doc's OneDrive\Desktop\Projects convention is overridden here for technical reasons: SQLite write-ahead log files (.db-wal, .db-shm) are rewritten constantly by the always-on poll process, and OneDrive sync attempting to upload these mid-write is a real risk for lock contention or database corruption. If this project is ever migrated to a server without an always-on local SQLite write workload, the OneDrive convention can be reconsidered.
- No zone square footage — ET-to-gallons uses historical summer baseline ÷ summer ET avg instead.
- Barn controller has no flow meter — uses duration scaling: runtime = baseline_minutes × (ET/ET_avg) × Kz.
- Pool Equipment flow meter is permanently unreliable — Pool zones are physically downstream of the Garage flow meter, so flow is attributed to the Garage meter via a flowMeterAttribution config block, using capped Garage Z5 as a gating dummy (per Phase 4 attribution design, 2026-05-11).
- Hydrawise controllers serialize valves: at most one zone per controller open at a time. Garage and Pool Equipment therefore share a single serialized timeline (single "attribution group") in the Phase 4 scheduler.
- GSD planning structure not yet initialized; planned as a separate step after this doc lands.

## Live URLs (if deployed)

Not yet deployed. Future entries when applicable:
- Production: (Phase 4+, Next.js web app on Vercel)
- Supabase project ID: (Phase 4+)
- Vercel project name: (Phase 4+)

---

## Working agreement with Claude

**All Claude Code prompts drafted in this project must enforce the following sections of `Buzz_Project_Development_Procedure.md` (kept at `C:\Users\buzzs\OneDrive\Desktop\Projects\Buzz_Project_Development_Procedure.md`):**

- **3.2a — Working-tree hygiene.** Every Claude Code session ends with a clean `git status`. No "I'll commit this later." Backend deploys (Supabase migrations, Edge Functions) and the corresponding git commits are paired operations.
- **3.2b — Backend deploys are git operations.** Any `npx supabase db query`, `npx supabase functions deploy`, or `npx vercel env add` must be followed by a git commit of the source in the same session.
- **4.1a — Path-filter Vercel deploys.** If this project deploys to Vercel from a subfolder of a multi-folder repo, the Vercel project's `vercel.json` must include `"ignoreCommand": "git diff --quiet HEAD^ HEAD -- ."` so commits outside the deployed folder don't trigger rebuilds.

When drafting prompts for Claude Code, include verifications for these rules where relevant — e.g. "verify clean working tree before starting," "commit any backend deploy source in the same session," etc.

---

## Cross-reference: CLAUDE.md

This project maintains two authoritative documents:

- **Project_Context.md** (this file) — procedural anchor: what the project is, stack, repo location, key architectural decisions, working agreement with Claude. Read this first on any new session.
- **CLAUDE.md** — operational anchor: full property/system constants (lat/lon, tank capacity, ditch fill rate, season windows), complete zone inventory across all 3 controllers, 13-table database schema with phase mapping, implementation phase status, the optimized static schedule used until Phase 4 takes scheduling control, environment variable specs, and the open to-do list.

When the two documents disagree on a fact, CLAUDE.md is canonical for operational details (zones, schema, schedule, constants) and Project_Context.md is canonical for procedural rules (working agreement, stack summary, repo layout). If you find a true conflict (not just different levels of detail), fix both in the same commit.

---

## Recent changes / project log

*Append major changes here as the project evolves so future sessions have context. Format: date, one-line summary, commit hash if applicable.*

- [2026-05-11] GitHub repo created at github.com/buzzstryker/irrigation-monitor; first push of existing master branch (Phases 0–2 complete). Commit: 93e4d09.
- [2026-05-11] Project relocated to `C:\Users\buzzs\Desktop\Projects\irrigation-monitor\`. Obsolete "3200 irrigation" parent folder removed. Project remains deliberately outside OneDrive — see Key decisions.
- [2026-05-11] Project_Context.md and Project_README.md added; cross-referenced with CLAUDE.md. (This commit.)
