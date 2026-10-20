# Current-State Diagnosis — 2026-07-07

Read-only investigation of three live failures after weeks away. **Nothing was
fixed.** This document only characterizes what exists so we can plan real fixes
together.

The three symptoms under investigation:

1. Every `tank_sensor_log` reading is clamped to **1733 gal** ("CLAMPED high"),
   even though raw sensor values vary (465–480 cm in the Railway logs).
2. Four cron jobs fail daily with **`db.prepare is not a function`**
   (2:05 AM, 2:10 AM, 2:15 AM, 5:00 AM).
3. ET logging fails with **`there is no unique or exclusion constraint matching
   the ON CONFLICT specification`**.

---

## Q1: Tank sensor clamping

### Short answer

`1733` is **the gallons value of the last row of the active strapping table**
(`[41, 1733]` in `tank-strapping.js:60`). It is *not* a hardcoded constant and
*not* `RATED_FULL_GALLONS` (which is 1725). It is whatever
`depthInchesToGallons()` returns when it clamps an over-range depth to the top
of the table.

Every current reading clamps high because **the raw sensor value jumped ~4.5×
around July 4** — from the sane ~94–105 cm range to ~431–485 cm — while
`poll.js` still divides the raw value by 100 and treats it as a water-depth in
metres. `465 cm → 4.65 m → ×39.3701 = ~183 inches`, which massively exceeds the
table's 41-inch full mark, so the conversion pins to the last row (1733 gal) and
flags `clamped: 'high'`.

### The clamp path, exactly

`poll.js` (tank-sensor cycle, lines ~386–449):

```js
const depthDp = dps.find(d => d.code === 'liquid_depth');
...
// DP unit is integer centimetres (confirmed against installation_height/
// liquid_depth_max calibration constants during 2026-06-20 discovery).
const depthCm = depthDp.value;
const depthM = depthCm / 100;
const { gallons, depthIn, clamped } = depthMetersToGallons(depthM);
...
console.log(`[TANK-SENSOR] Cycle #${sensorPollCount} (${reason}) | ${depthCm}cm → ${Math.round(gallons)} gal${clamped ? ` (CLAMPED ${clamped})` : ''}`);
```

`depthMetersToGallons()` in `tank-strapping.js`:

```js
function depthMetersToGallons(depthM) {
  const depthIn = depthM * IN_PER_METER;          // IN_PER_METER = 39.3701
  const { gallons, clamped } = depthInchesToGallons(depthIn);
  return { gallons, depthIn, clamped };
}

function depthInchesToGallons(depthIn) {
  ...
  const last = STRAPPING_TABLE[STRAPPING_TABLE.length - 1];  // [41, 1733]
  ...
  if (depthIn >= last[0]) {
    return { gallons: last[1], clamped: depthIn > last[0] ? 'high' : null };
    //               ^^^^^^^  ← this is where 1733 comes from
  }
  ...
}
```

So the moment `depthIn >= 41`, gallons is forced to `last[1] = 1733` and
`clamped = 'high'`. The raw 465–480 cm always satisfies that condition (they map
to 170–191 inches), so **every** current reading is 1733.

### Where 1733 comes from — definitive

- Active table `tank-strapping.js:60`: `[40, 1595], [41, 1733]`. The 41" anchor
  is **1733**, not the documented `RATED_FULL_GALLONS = 1725`.
- Historical proof it is the table max and not a constant: the earliest
  clamped-high rows (June 21, when the tank was genuinely slightly over-full at
  depth 1.05 m / 41.3") returned **1725**, not 1733. Between June 21 and now the
  deployed table's last row was edited from 1725 → 1733, and the clamp value
  moved in lockstep. This confirms 1733 is simply "whatever the top table row
  says."

### The current empirical calibration table (what's deployed)

The **active** table lives in `tank-strapping.js` (`STRAPPING_TABLE`, marked
"EMPIRICAL v1 — adopted 2026-06-22"). `depth_inches → gallons`:

```
 0→0     1→18    2→36    3→53    4→71    5→89    6→107   7→124
 8→142   9→160   10→178  11→195  12→251  13→310  14→352  15→400
16→457   17→504  18→548  19→593  20→637  21→681  22→728  23→769
24→816   25→862  26→910  27→951  28→996  29→1040 30→1085 31→1130
32→1174  33→1218 34→1263 35→1303 36→1375 37→1430 38→1465 39→1508
40→1595  41→1733
```

**Table-proliferation hazard (found during this audit):** there are **three
different "empirical" tables** in the tree, and they disagree:

| Source | 41" anchor | 16" value | Status |
|---|---|---|---|
| `tank-strapping.js` (`STRAPPING_TABLE`) | 1733 | 457 | **ACTIVE / deployed** |
| `tank-strapping-empirical.js` (`STRAPPING_TABLE`) | 1733 | 454 | DRAFT — "NOT YET DEPLOYED" |
| `scripts/validate-empirical-table.js` (`EMPIRICAL_TABLE` inline) | 1733 | 457 | "v3" copy inside a validator |

The active table and the validate-script "v3" table happen to match; the
`-empirical.js` draft is a slightly different fit. None of this causes the
clamping bug, but it is a latent footgun — whichever table is "canonical" is
ambiguous.

### Expected raw range vs observed raw range

- **Expected by the code:** raw `liquid_depth` in **integer centimetres of water
  column**, range **0–104 cm** (full = ~104 cm = 41"). The code does
  `depthM = depthCm / 100`, then `depthIn = depthM × 39.3701`.
- **Observed before July 4 (worked correctly):** ~94–105 cm.
  - e.g. earliest row `id=2`: `depth_meters=0.94` (94 cm) → 37.01" → **1556.3
    gal**, `clamped=null`. Sane.
  - last good row `id=3992` (2026-07-04 19:46 UTC): `depth_meters=1.02` (102 cm)
    → **1616.7 gal**, `clamped=null`.
- **Observed since July 4 (broken):** ~431–485 cm (`depth_meters` 4.31–4.85 in
  the last 200 rows). Every one clamps to 1733.

### What the Supabase data shows

`tank_sensor_log`: **4,897 rows** total (id 2 → 4898).

| Metric | Value |
|---|---|
| `clamped = 'high'` | 1,284 rows |
| `clamped = 'low'` | 0 rows |
| `clamped = NULL` (valid) | 3,613 rows |
| `level_gallons = 1733` exactly | 1,257 rows |
| Earliest row timestamp | 2026-06-21 01:41:57 UTC |
| Latest row timestamp | 2026-07-07 15:38:13 UTC |

So it is **not** true that every row ever recorded is 1733 — the pipeline worked
correctly from June 21 through July 4 (3,613 valid rows). The all-1733 regime
began at a sharp transition:

| | Row | `depth_meters` | `level_gallons` | `clamped` | Time (UTC) |
|---|---|---|---|---|---|
| Last good | id 3992 | 1.02 | 1616.7 | null | 2026-07-04 19:46:12 |
| ...then    | id 3993+ | 4.3–4.85 | 1733 | high | after 19:46 |

**Correlated device event:** on the current broken rows, `device_update_time` is
**frozen at 1783194567 = 2026-07-04 19:49:27 UTC** — i.e. the device's own
timestamp stopped advancing at essentially the same minute the depth value
jumped 4.5×. That points to a **device-side event around July 4 ~19:46–19:49**
(reboot, re-pairing, recalibration, firmware/DP change), not a code change on
our side. Note CLAUDE.md already flags `update_time` as chronically
frozen/unreliable, but the *coincidence in timing* with the depth jump is new
signal.

### Is the raw signal being lost at write time?

Partially. `tank_sensor_log` has **no dedicated raw column** (`raw_cm`,
`distance_cm`, etc.). The insert stores:
`timestamp, depth_meters, depth_inches, level_gallons, source, clamped,
device_update_time`.

The raw value is *recoverable* only because `depth_meters = rawCm / 100` is a
pure scaling — so `rawCm = depth_meters × 100` (e.g. 4.65 → 465). But:

- The cm→m assumption is **baked in at write time**. If the true unit is not cm,
  `depth_meters` is mislabeled and there is no independent record of the raw DP
  to prove it.
- `depth_inches` and `level_gallons` are both derived from that same assumption,
  so they are garbage in the broken regime and cannot be re-derived to truth
  without re-reading the device.

### Hypothesis on the real value (needs confirmation, do NOT act yet)

If the raw 465–480 were actually **millimetres** (or the device now reports a
different DP/scale), then 465 mm = 46.5 cm = ~18.3" → the active table gives
~**547 gal** — a plausible ~half-full tank consistent with several days of July
irrigation drawdown. That is only a hypothesis. CLAUDE.md Key Design Decision
#10 is explicit that **hardcoded unit conversions are forbidden until the DP code
and unit are confirmed against a raw `/v1.0/devices/{id}/status` dump** — "a
1000× error sails right through the strapping table and writes plausible
garbage." Diagnosing the actual current unit requires that raw dump; it was not
performed here (read-only, no device calls).

---

## Q2: `db.prepare` files and the crons that depend on them

### Root cause

`getDb()` (in `db.js`) returns the `@supabase/supabase-js` client, which has **no
`.prepare()` method** — that was the synchronous better-sqlite3 API. Any file
still calling `db.prepare(...)` throws `db.prepare is not a function` the moment
that code path runs. These files were **missed in the Phase 4 SQLite→Supabase
migration**. (CLAUDE.md: "The function name is a holdover from the better-sqlite3
era… **Never use better-sqlite3 for new code.**")

### Every file that still calls `db.prepare`

| File | Lines | What it does | Wired to a failing cron? |
|---|---|---|---|
| **`scheduler.js`** | 48, 57, 124, 144 | Cron definitions; inline SQLite queries for skip-eval, ditch-health, monthly check-in | **YES — 2:05 & 5:00 (and monthly)** |
| **`coefficient-model.js`** | 63, 93, 155, 209 | `logDailyComparison()` + Kz seeding; full better-sqlite3 API (`.prepare`, `.transaction`, `.run/.get/.all`, `unixepoch()`, `ON CONFLICT`) | **YES — 2:10 & 2:15** |
| `sms/commands.js` | 18, 19, 22, 63, 68, 110, 125, 139, 154 | STATUS/TANK/SUSPEND/RESUME/SKIP command handlers | No (Phase 3 SMS paused) |
| `sms/handler.js` | 42, 56 | Twilio inbound webhook, user lookup | No (Phase 3 paused) |
| `sms/sender.js` | 25 | Logs outbound SMS to `sms_log` | No (Phase 3 paused) |
| `sync.js` | 47 | SQLite→Supabase sync (dead in prod per CLAUDE.md) | No (dead code) |
| `verify-schema.js` | 10, 25, 33, 40, 45, 56 | Dev script; reads `sqlite_master`/PRAGMA | No (manual dev tool) |
| `export-tables.js` | 20 | One-shot SQLite export | No (manual dev tool) |
| `coefficient-model.test.js` | 51, 58, 159, 180 | Test file | No (tests) |

### Mapping the four failing crons (all defined in `scheduler.js`, run in-process via `node-cron`)

| Cron time | Job | Call chain | Where it throws |
|---|---|---|---|
| **2:05 AM** | Skip evaluation | `scheduler.js` inline `db.prepare` | `scheduler.js:48` (`SELECT … FROM warnings … 'suspension'`) and `:57` |
| **2:10 AM** | Daily zone analysis | `scheduler.js` → `coefficient-model.logDailyComparison()` | inside `coefficient-model.js` (`db.prepare` at 155/209 via `logDailyComparison` @195) |
| **2:15 AM** | Daily report | `scheduler.js` → `reports/daily-report.generateReport()` → `coefficient-model.logDailyComparison()` | fails in `coefficient-model.js` (same as 2:10) |
| **5:00 AM** | Ditch health check | `scheduler.js` inline `db.prepare` | `scheduler.js:124` (`INSERT INTO ditch_health_log …`) |

Notes:
- The 5:00 AM job has a *second* latent problem beyond `db.prepare`: it inserts
  into `ditch_health_log`, and its own comment calls it a "Phase 6 stub … not
  yet implemented." Even after the Supabase port it would still be a stub.
- The **monthly check-in** cron (`scheduler.js:144`, 1st of month 8:00 AM) is
  *also* broken by `db.prepare` but only fires monthly, so it isn't in the daily
  failure set.
- `reports/daily-report.js` itself contains **no** `db.prepare` — it fails
  purely because it calls into the un-migrated `coefficient-model.js`.
- The 2:00 AM ET cron does **not** use `db.prepare` (it uses the async
  `upsertEtLog`) — its failure is a different bug, see Q3.

---

## Q3: ET upsert constraint mismatch

### What the code conflicts on

The upsert is in `db.js`, `upsertEtLog()` (called by `et-logger.js:28` and `:45`,
which is driven by the 2:00 AM ET cron):

```js
async function upsertEtLog(row) {
  const { data, error } = await supabase
    .from('et_log')
    .upsert({
      date: row.date, et_inches: row.et_inches, temp_high_f: row.temp_high_f,
      temp_low_f: row.temp_low_f, humidity_pct: row.humidity_pct,
      wind_mph: row.wind_mph, solar_rad: row.solar_rad, source: row.source,
      created_at: Math.floor(Date.now() / 1000)
    }, {
      onConflict: 'date'          // ← conflict target is the `date` column
    });
  if (error) throw new Error(`Failed to upsert et_log: ${error.message}`);
  ...
}
```

So the code needs a **UNIQUE (or PK) constraint on `et_log.date`**. Postgres
requires the `ON CONFLICT` target to be backed by a real unique/exclusion
constraint; without it, it raises exactly the observed error.

### What the live `et_log` schema actually has — schema drift

There are two schema files in the repo and **they disagree on `et_log.date`**:

`supabase/schema.sql:54` (the stated "file-of-record"):
```sql
CREATE TABLE IF NOT EXISTS et_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE UNIQUE NOT NULL,        -- ← HAS the unique constraint
  ...
);
```

`migrations/supabase_schema.sql:91` (the data-export migration that actually
built the live DB):
```sql
CREATE TABLE et_log (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  date TEXT,                        -- ← NO unique, and TEXT not DATE
  ...
);
```

Evidence the **live table matches the migration file (no UNIQUE)**, not
schema.sql:

1. The runtime error itself ("no unique or exclusion constraint matching the ON
   CONFLICT specification") is Postgres definitively reporting there is no unique
   constraint on `date`.
2. The stored `date` value is a **string** `"2026-05-11"` (consistent with
   `TEXT`, per the migration file), not a native `DATE`.
3. `et_log` currently holds **exactly 1 row**, dated **2026-05-11** — meaning the
   upsert has been failing on every run since May 11, so no new ET rows have
   landed. (The `date` values are "unique" in the data only by accident of there
   being a single row — that is not a constraint.)
4. `schema.sql:340` also defines only a *non-unique* index
   `idx_et_log_date ON et_log(date)` — a plain index does **not** satisfy
   `ON CONFLICT`.

This is precisely the failure mode CLAUDE.md warns about under "Schema drift
watch": *"`supabase/schema.sql` is the file-of-record for new deploys but the
live DB has drifted… Always query information_schema before trusting
schema.sql."* The live DB was created from the migration file (`date TEXT`, no
UNIQUE), while the code was written against schema.sql (`date DATE UNIQUE`).

### The mismatch, stated plainly

- **Code wants:** `ON CONFLICT (date)` → requires `UNIQUE(date)`.
- **Live DB has:** `date TEXT` with only a plain (non-unique) index; **no unique
  constraint**.
- **Result:** every `upsertEtLog` throws; `et_log` frozen at 1 row since
  2026-05-11.

---

## Cross-cutting finding: the modeled tank table is already frozen

`tank_level_log` (the "LEGACY MODEL" that CLAUDE.md's schema table claims is
"kept running in parallel"):

- **52,125 rows**, last row **2026-06-22 21:25:29 UTC** (`level_gallons=981`,
  `source='calculated'`).
- Nothing has written to it since 2026-06-22.

This contradicts the schema-table narrative ("kept running in parallel… Do not
retire until the strapping table is validated") but **matches** the `db.js`
comment ("poll.js stopped writing it 2026-06-22, so it is frozen"). So during the
current tank-sensor outage there is **no modeled fallback** being written either
— both the measured source (garbage since July 4) and the modeled source (frozen
since June 22) are effectively dark. Worth flagging for the fix discussion.

---

## Relevant CLAUDE.md excerpts

**On tank measurement & units (Key Design Decision #9, #10):**
> **Tank level: measured beats modeled** — Tuya ME201W reports liquid-level depth
> in meters; `tank-strapping.js` converts depth → gallons via the Norwesco 44407
> elliptical strapping table (anchored to 1725 gal at 41"). … The strapping table
> is the canonical curve — never reimplement; refine in place…
>
> **Tuya sensor dedup: liquid_depth value, not update_time** … The device's
> `update_time` field is FROZEN/unreliable … **Hardcoded unit conversions (mm vs
> cm vs m) are forbidden until the DP code and unit are confirmed against a raw
> `/v1.0/devices/{id}/status` dump — a 1000× error sails right through the
> strapping table and writes plausible garbage.**

**On the DB pattern (Database Schema section):**
> `getDb()` from db.js returns the @supabase/supabase-js client (async). The
> function name is a holdover from the better-sqlite3 era… **Never use
> better-sqlite3 for new code.** sync.js still references SQLite but is dead in
> production — pending removal.

**On schema drift (Schema drift watch):**
> `supabase/schema.sql` is the file-of-record for new deploys but the live DB has
> drifted. … Always query information_schema before trusting schema.sql.

**On Railway env-var risk (relevant if the Tuya device was re-provisioned):**
> Railway's auto-detection has historically missed env vars added after the
> initial deploy… After adding TUYA_* … immediately mirror them into Railway's
> environment variables … and re-deploy.

---

## Recommended fixes

*(Descriptions only — nothing here has been applied. Confirm the Q1 root cause
with a live device dump before touching any conversion code.)*

### Fix 1 — Tank sensor clamping (Q1)

The bug is upstream of the strapping table: the raw `liquid_depth` value changed
character around July 4 and the code's fixed "÷100, treat as metres" assumption
no longer holds. Do **not** just widen the clamp — that would launder garbage
into plausible gallons.

1. **Get ground truth first.** Pull a raw `/v1.0/devices/{id}/status` dump from
   the ME201W (the CLAUDE.md-mandated step) and read the *current* `liquid_depth`
   DP code, value, and any unit/scale field. Compare to the ~465–480 the logs
   show. This tells us whether the device switched units (cm→mm), switched DPs,
   was recalibrated, or is reporting distance-to-surface instead of depth.
2. **Decide the conversion from evidence, not a guess.** If it is now mm, the
   conversion becomes `/1000` (or convert cm properly). If it now reports
   distance-from-sensor-to-water, gallons must be derived as
   `full_span − distance`. Whatever it is, encode the confirmed unit explicitly.
3. **Add a sanity guard** so a future unit flip fails loudly instead of silently
   clamping: reject/alarm on any raw depth outside a physical plausible band
   (0–~110 cm of water column) rather than pinning to the table top.
4. **Store the raw DP value** in a new column (e.g. `raw_value` + `raw_unit`) so
   the signal is preserved independent of the conversion assumption — right now
   `depth_meters` bakes in the ÷100 and there's no un-assumed record.
5. **Consolidate the three strapping tables** to one canonical source so
   `tank-strapping.js`, `tank-strapping-empirical.js`, and the validator can't
   drift. Decide whether the 41" anchor is 1725 (rated) or 1733 (empirical) and
   make it consistent.
6. Consider **un-freezing the modeled `tank_level_log`** (or another fallback)
   until the sensor is trustworthy, since it's currently dark too.

### Fix 2 — `db.prepare` crons (Q2)

Port the un-migrated modules from the better-sqlite3 API to async Supabase, the
same way `server.js` and `db.js` were already converted:

1. **`coefficient-model.js`** — rewrite `logDailyComparison()`,
   `getActualApplication()`, `initializeCoefficients()`, etc. to `await
   supabase.from(...)` calls. This unblocks **both 2:10 and 2:15**. Its callers
   (`scheduler.js`, `reports/daily-report.js`) will need to become `async`/await
   since the functions stop being synchronous. Watch the SQLite-isms
   (`unixepoch()`, `ON CONFLICT`, `db.transaction`) — those need Postgres/Supabase
   equivalents.
2. **`scheduler.js` inline queries** — convert the 2:05 skip-eval reads
   (`warnings`) and the 5:00 ditch-health insert to Supabase. Separately decide
   whether the 5:00 job should stay a stub (it inserts into `ditch_health_log`
   and self-describes as unimplemented).
3. Also port the **monthly check-in** query (same file) while in there, and the
   **SMS modules** (`sms/*.js`) before Phase 3 resumes — they'll hit the identical
   wall.
4. Retire/quarantine the genuinely dead SQLite scripts (`sync.js`,
   `verify-schema.js`, `export-tables.js`) so they stop implying the old API is
   live.

### Fix 3 — ET upsert constraint (Q3)

Two options; pick based on whether we treat the live DB or schema.sql as truth.

- **Preferred — make the live DB match the code's intent:** add a unique
  constraint on `et_log.date` (`ALTER TABLE et_log ADD CONSTRAINT et_log_date_key
  UNIQUE (date)`). Requires first confirming no duplicate `date` values exist
  (currently only 1 row, so trivially safe today). This is a one-line DDL and
  leaves `upsertEtLog`'s `onConflict: 'date'` working as written. It also aligns
  the live table with `supabase/schema.sql`.
  - Optional cleanup: the live `date` column is `TEXT` while schema.sql says
    `DATE`; the string comparison still works for uniqueness but converting to a
    real `DATE` type would remove that drift.
- **Alternative — change the code to a get-then-insert/update** keyed on `date`
  (no `ON CONFLICT`). Avoids DDL but is racier and papers over the schema drift
  rather than fixing it.
- Either way, **reconcile the two schema files** so the next deploy doesn't
  re-introduce the mismatch, and per CLAUDE.md verify against
  `information_schema` rather than trusting `schema.sql`.

---

*Investigation was strictly read-only: source reads, `SELECT`-only Supabase
queries, no DDL/DML, no device calls, no service restarts. This report is
intentionally left uncommitted for joint review.*
