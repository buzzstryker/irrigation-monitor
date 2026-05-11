---
phase: 4a-attribution-infrastructure
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - migrations/migration_flow_attribution.sql
  - migrations/migration_z5_selftest_log.sql
  - migrations/migration_flow_calibration_log.sql
  - db.js
autonomous: true
requirements: [4a.1]

must_haves:
  truths:
    - "Three migration files exist with complete table definitions"
    - "watering_events table has flow attribution columns"
    - "Five new tables exist for attribution infrastructure"
    - "Migration files are executable via sqlite3 CLI"
  artifacts:
    - path: "migrations/migration_flow_attribution.sql"
      provides: "watering_events columns + 4 tables"
      min_lines: 80
    - path: "migrations/migration_z5_selftest_log.sql"
      provides: "z5_selftest_log table"
      min_lines: 15
    - path: "migrations/migration_flow_calibration_log.sql"
      provides: "flow_calibration_log table"
      min_lines: 20
    - path: "db.js"
      provides: "Updated table count (19 tables)"`n      contains: "19 tables"
---

See full plan content...
