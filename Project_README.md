# irrigation-monitor

ET-driven residential irrigation monitoring and (eventually) scheduling system for the Loomis, CA property. Polls Hydrawise controllers, models per-zone water need from Open-Meteo ET data, learns optimal application rates via an SMS observation feedback loop, and (in Phase 4+) replaces Hydrawise's static programs with dynamic setzone commands.

## Orientation

- **What this is and why:** see `Project_Context.md`.
- **Operational reference** (zones, schema, phases, optimized schedule, constants): see `CLAUDE.md`.
- **Working agreement / procedure rules:** see the "Working agreement with Claude" section of `Project_Context.md`.

## Stack

Node.js v22.22.2, Express, better-sqlite3, pm2. See `Project_Context.md` for full details.

## How to run (current Phase 0–2 state)

```bash
pm2 start ecosystem.config.js
pm2 logs irrigation-poll       # see polling activity
pm2 logs irrigation-server     # see Express server
curl http://localhost:3001/status   # quick health check
```

Environment variables required: see `CLAUDE.md` "Environment Variables (.env)" section.

## Phase status

See `CLAUDE.md` "Implementation Phases" table. Current frontier: Phase 3 (Twilio SMS).
