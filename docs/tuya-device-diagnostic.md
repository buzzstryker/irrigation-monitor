# Tuya Tank-Sensor Device Diagnostic — 2026-07-07

Read-only diagnostic of the Tuya ME201W ultrasonic tank sensor, fulfilling the
CLAUDE.md mandate to fetch the raw `/v1.0/devices/{id}/status` dump before making
any unit-interpretation or calibration decision. **No device settings were
changed; all Tuya calls were GET-only; no DDL/DML was run against Supabase.**

---

## Executive summary

The sensor is **online and actively measuring**, but its **on-device calibration
constants have reverted to factory defaults**: `installation_height` and
`liquid_depth_max` are both **5.00 m** (the range maximum), versus the correct
**1.23 m** and **1.04 m** for this tank. As a result the device now reports
`liquid_depth = 4.60 m` (91% of a bogus 5.00 m span) and `liquid_state:
upper_alarm`, which poll.js correctly converts to ~181" and clamps to the
strapping-table maximum of **1733 gal**. This is **not a units problem and not a
code problem** — `liquid_depth` is and always was reported in meters (Tuya spec
`unit=m, scale=2`), so poll.js's `÷100` has been correct the whole time. The
trigger was the **July 4, 2026 power outage**: the sensor does not persist
calibration across power loss, and `device_update_time` froze at the same moment
(2026-07-04 12:49 PM PT) the outage struck. **Fix path: restore the calibration
constants on the device (Smart Life app) — do not touch `tank-strapping.js` or
`poll.js`.**

---

## Section 1 — Device metadata

`GET /v1.0/devices/{device_id}` (region: `us` → `openapi.tuyaus.com`):

| Field | Value | Note |
|-------|-------|------|
| `name` / `product_name` | ME201W Level Sensor | Ultrasonic liquid-level sensor |
| `model` | ME201W | Matches expected hardware |
| `category` | `ywcgq` | Tuya category for liquid/level sensors |
| `product_id` | `4u9z7qg3je42rsw8` | |
| `id` (device) | `<TUYA_DEVICE_ID>` | |
| **`online`** | **`true`** | **Device is online right now** |
| `sub` | `false` | Not a sub-device / gateway child |
| `time_zone` | `-07:00` | Pacific, correct for Loomis |
| `ip` | 76.246.170.46 | |
| `lat` / `lon` | 38.84 / -121.15 | Consistent with property |
| `active_time` / `create_time` | 1779745834 → **2026-05-25 2:50 PM PT** | Device first activated |
| **`update_time`** | 1783194567 → **2026-07-04 12:49:27 PM PT** | **FROZEN — see analysis 7b** |

The device-level `status` array is identical to Section 2.

Firmware/module versions are not exposed by `/v1.0/devices/{id}` (would require
`/v1.0/devices/{id}/firmware` or the IoT console). The icon path is the standard
Tuya level-sensor icon; not material.

---

## Section 2 — Raw status dump (verbatim)

`GET /v1.0/devices/{device_id}/status` — full response, unfiltered:

```json
[
  { "code": "liquid_state",         "value": "upper_alarm" },
  { "code": "liquid_depth",         "value": 460 },
  { "code": "battery_percentage",   "value": 51 },
  { "code": "max_set",              "value": 80 },
  { "code": "mini_set",             "value": 20 },
  { "code": "installation_height",  "value": 500 },
  { "code": "liquid_depth_max",     "value": 500 },
  { "code": "liquid_level_percent", "value": 91 }
]
```

Interpreted through the Section 3 specification (`scale=2` → divide integer by
100 for the `m`/unit fields):

| code | raw | decoded | meaning |
|------|-----|---------|---------|
| `liquid_state` | `upper_alarm` | — | Over the `max_set` alarm threshold |
| `liquid_depth` | 460 | **4.60 m** | Reported water column depth |
| `installation_height` | 500 | **5.00 m** | Sensor mount height above tank floor **(WRONG — should be 1.23 m)** |
| `liquid_depth_max` | 500 | **5.00 m** | Full-tank depth reference **(WRONG — should be 1.04 m)** |
| `liquid_level_percent` | 91 | **91%** | 4.60 / 5.00 ≈ 92% — internally consistent with the bad constants |
| `max_set` | 80 | 80% | Upper-alarm threshold |
| `mini_set` | 20 | 20% | Lower-alarm threshold |
| `battery_percentage` | 51 | 51 (spec unit `V`, scale 1 → 5.1) | Powered; not the fault |

The smoking gun is the pair of calibration constants pinned at their **range
maximum of 5.00 m**. The real tank is ~1.04 m of usable water column (41"); a
5.00 m reference is physically impossible for this tank and is the classic
signature of a factory-default reset.

---

## Section 3 — Data-point specifications (verbatim)

`GET /v1.0/devices/{device_id}/specifications` — `success: true`, HTTP 200:

```json
{
  "category": "ywcgq",
  "functions": [
    { "code": "max_set",             "type": "Integer", "values": "{\"unit\":\"%\",\"min\":10,\"max\":100,\"scale\":0,\"step\":1}" },
    { "code": "mini_set",            "type": "Integer", "values": "{\"unit\":\"%\",\"min\":0,\"max\":100,\"scale\":0,\"step\":1}" },
    { "code": "installation_height", "type": "Integer", "values": "{\"unit\":\"m\",\"min\":10,\"max\":500,\"scale\":2,\"step\":1}" },
    { "code": "liquid_depth_max",    "type": "Integer", "values": "{\"unit\":\"m\",\"min\":10,\"max\":500,\"scale\":2,\"step\":1}" }
  ],
  "status": [
    { "code": "liquid_state",         "type": "Enum",    "values": "{\"range\":[\"normal\",\"lower_alarm\",\"upper_alarm\"]}" },
    { "code": "liquid_depth",         "type": "Integer", "values": "{\"unit\":\"m\",\"min\":-500,\"max\":10000,\"scale\":2,\"step\":1}" },
    { "code": "battery_percentage",   "type": "Integer", "values": "{\"unit\":\"V\",\"min\":0,\"max\":100,\"scale\":1,\"step\":1}" },
    { "code": "max_set",              "type": "Integer", "values": "{\"unit\":\"%\",\"min\":10,\"max\":100,\"scale\":0,\"step\":1}" },
    { "code": "mini_set",             "type": "Integer", "values": "{\"unit\":\"%\",\"min\":0,\"max\":100,\"scale\":0,\"step\":1}" },
    { "code": "installation_height",  "type": "Integer", "values": "{\"unit\":\"m\",\"min\":10,\"max\":500,\"scale\":2,\"step\":1}" },
    { "code": "liquid_depth_max",     "type": "Integer", "values": "{\"unit\":\"m\",\"min\":10,\"max\":500,\"scale\":2,\"step\":1}" },
    { "code": "liquid_level_percent", "type": "Integer", "values": "{\"unit\":\"%\",\"min\":0,\"max\":200,\"scale\":0,\"step\":1}" }
  ]
}
```

**Decisive facts from the spec:**

- **`liquid_depth`: `unit=m`, `scale=2`.** The integer is meters × 100. Raw
  `460` → **4.60 m**. Dividing by 100 yields meters directly — this is exactly
  what poll.js does (`depthM = depthCm / 100`). The variable name "cm" in the
  code is a misnomer, but the arithmetic is correct. **Units did NOT change.**
- **`installation_height` / `liquid_depth_max`: `unit=m`, `scale=2`, `max=500`.**
  Range maximum is 500 → **5.00 m**. The current values (500/500) sit exactly at
  that ceiling — the hallmark of a reset-to-default, not a deliberate setting.
- `liquid_depth` range allows up to `max=10000` (100.00 m), so a value of 460 is
  well within range and passes silently — nothing on the device flags it.

---

## Section 4 — Recent device logs (unavailable)

`GET /v1.0/devices/{device_id}/logs` failed on both attempts. Reported verbatim
(not fabricated):

- `.../logs?start_time=…&end_time=…&type=7&size=100` →
  `{"code":1004,"msg":"sign invalid","success":false}` (query params not in the
  alphabetical order Tuya's signer requires).
- `.../logs?end_time=…&size=100&start_time=…` →
  `{"code":40000303,"msg":"Parameter error!","success":false}` (missing required
  `type`).

A corrected retry (sorted params + `type`) was prepared but **not run** (the run
was interrupted before completion), so no device-log timeline is included here.
This gap does **not** affect the conclusions: the live status variance (Section 5)
already proves the device is actively measuring. The Tuya IoT console's device
log viewer, or a corrected `logs` call, can supply the exact reset event if
needed.

---

## Section 5 — Supabase `tank_sensor_log`, most recent 50 rows

`SELECT * … ORDER BY timestamp DESC LIMIT 50`. Every one of the 50 rows shows the
broken regime — condensed (all rows: `source='sensor'`, `level_gallons=1733`,
`clamped='high'`, `device_update_time=1783194567`):

| id | timestamp (PT) | depth_meters | depth_inches | level_gallons | clamped |
|----|----------------|--------------|--------------|---------------|---------|
| 4905 | 2026-07-07 08:56 | 4.60 | 181.10 | 1733 | high |
| 4904 | 2026-07-07 08:54 | 4.59 | 180.71 | 1733 | high |
| 4901 | 2026-07-07 08:46 | 4.63 | 182.28 | 1733 | high |
| 4899 | 2026-07-07 08:42 | 4.65 | 183.07 | 1733 | high |
| 4894 | 2026-07-07 08:26 | 4.71 | 185.43 | 1733 | high |
| 4888 | 2026-07-07 08:06 | 4.75 | 187.01 | 1733 | high |
| 4877 | 2026-07-07 07:24 | 4.70 | 185.04 | 1733 | high |
| 4866 | 2026-07-07 06:48 | 4.57 | 179.92 | 1733 | high |
| 4856 (oldest of 50) | 2026-07-07 05:58 | 4.46 | 175.59 | 1733 | high |

- **All 50 rows** `level_gallons = 1733`, `clamped = 'high'`,
  `device_update_time = 1783194567` (the frozen July-4 timestamp).
- `depth_meters` **micro-varies across the window (4.46 → 4.79)** — this is live
  measurement noise, confirming the sensor is taking fresh readings even though
  the derived gallons are pinned. Compare the live status (`liquid_depth = 460` →
  4.60 m) which falls right in this band.
- **Raw-signal note:** `tank_sensor_log` has **no dedicated raw column**
  (`raw_cm`/`raw_value`). The raw DP is recoverable only because
  `depth_meters = rawInteger / 100` is a pure scaling (`4.60 ↔ 460`). There is no
  independent record of the un-scaled DP, so if the scale itself ever changed we
  could not tell from stored data alone. Worth adding a raw column when the
  pipeline is next touched.

**What poll.js produces from the current reading:** `460 → 4.60 m → ×39.3701 =
181.1" ≥ 41"` → high-clamp → last strapping row `[41, 1733]` → **1733 gal,
`clamped:'high'`**. The code is behaving exactly as written; the input is bad.

---

## Section 6 — CLAUDE.md tank-sensor context

Relevant excerpts governing units, calibration, and troubleshooting:

**Key Design Decision #9 — measured beats modeled:**
> Tuya ME201W reports liquid-level depth in meters; `tank-strapping.js` converts
> depth → gallons via the Norwesco 44407 elliptical strapping table (anchored to
> 1725 gal at 41"). … The strapping table is the canonical curve — never
> reimplement; refine in place…

**Key Design Decision #10 — dedup + the units guardrail:**
> ME201W pushes liquid_depth to Tuya cloud every ~2.5 min … The device's
> `update_time` field is FROZEN/unreliable (stayed constant for 13+ hours…). …
> **Hardcoded unit conversions (mm vs cm vs m) are forbidden until the DP code
> and unit are confirmed against a raw `/v1.0/devices/{id}/status` dump — a 1000×
> error sails right through the strapping table and writes plausible garbage.**

This diagnostic *is* that mandated raw dump. It confirms the unit is meters
(`scale=2`), so **no code-side unit change is warranted** — the failure is a
device-config reset, addressed operationally.

**Tank-strapping.js header — the calibration anchors (the correct values):**
> SENSOR INPUT: the Tuya ME201W reports "Liquid Level Depth" in METERS, measured
> from the hard tank bottom (after calibration: **Installation height = 1.23 m /
> 48.5", Liquid maximum depth = 1.04 m / 41"**).

These are exactly the two constants that are now wrong on the device (5.00 m /
5.00 m). The recovery procedure is documented in CLAUDE.md §"Post-Power-Outage
Recovery: Tank Sensor Calibration".

---

## Section 7 — Analysis

### 7a. What units is `liquid_depth` in right now?

**Meters, encoded as integer × 100 (Tuya `unit=m, scale=2`).** Raw `460` = **4.60
m**. Evidence: the device specification (Section 3) states `liquid_depth:
{"unit":"m","scale":2}` explicitly, and the companion `liquid_level_percent = 91`
equals 4.60 / 5.00 to rounding, confirming the device itself is doing meters math
against the (wrong) 5.00 m span. **The units are unchanged from before July 4** —
poll.js's `÷100` was and remains correct. The earlier hypothesis that this might
be a mm-vs-cm unit switch is **disproven** by the spec.

### 7b. Is the device actually measuring, or is it offline/stuck?

**Actively measuring — not stuck, not offline.** Evidence:
- `deviceInfo.online = true`.
- Live `liquid_depth` (4.60 m) and the last 50 stored `depth_meters` values
  **vary continuously (4.46–4.79 m)** — stale telemetry would be flat.
- Battery present (`battery_percentage` reporting).

The frozen `device_update_time` (stuck at 2026-07-04 12:49 PM PT) is a **known
ME201W quirk** already documented in CLAUDE.md §Decision #10 ("FROZEN/unreliable")
— it is **not** evidence of offline state. Its freeze *coinciding* with the
outage is expected: the field last advanced just before power dropped and hasn't
moved since, while the DP telemetry itself keeps flowing.

### 7c. What does the sensor think the water level is right now?

The device believes the tank is **91% full** — `liquid_depth = 4.60 m` against
its (incorrect) `liquid_depth_max = 5.00 m`, hence `liquid_state: upper_alarm`
(over the 80% `max_set`). Through poll.js + the strapping table this becomes the
clamped **1733 gal**.

The **true** level cannot be read directly off this reading because the depth is
computed against a 5.00 m reference instead of 1.04 m. If the ultrasonic
distance-to-surface is unchanged and only `installation_height` shifted (1.23 →
5.00 m, +3.77 m), the corrected depth ≈ 4.60 − 3.77 = **~0.83 m (≈33", ≈1,190
gal)** — a plausible, partly-drawn-down tank. **This is an estimate, not a
measurement;** the authoritative value only returns after the device constants
are restored (see §7c caveat and the recovery procedure). Do not backfill history
from this estimate.

---

## Section 8 — Root causes assessed against evidence

### Cause A — On-device calibration reset by the July 4 power outage ✅ CONFIRMED

- **For:** `installation_height` and `liquid_depth_max` both sit at the exact
  range maximum (5.00 m) — the factory-default signature. Last good reading was
  2026-07-04 12:46 PM PT; `device_update_time` froze at 12:49 PM PT — a ~3-minute
  window consistent with a power event. The user has independently confirmed a
  **power outage on July 4, 2026**, and that this sensor does not persist
  calibration across power loss. Units/firmware are otherwise unchanged (spec
  intact, device online).
- **Against:** none. All evidence converges here.
- **Verdict:** this is the cause. The depth jump, the alarm, the clamp, and the
  frozen timestamp all fall out of a single calibration reset at the outage.

### Cause B — Units/firmware change (mm↔cm↔m or DP schema change) ❌ REJECTED

- **For:** superficially, the raw value jumped ~4.5× (≈100 → ≈460), which *could*
  look like a scale change.
- **Against:** the specification explicitly reports `liquid_depth: unit=m,
  scale=2` — the same encoding that produced correct readings before July 4. If
  the scale had changed, `liquid_level_percent` (91%) would not reconcile with
  `liquid_depth/liquid_depth_max` (4.60/5.00). The jump is fully explained by the
  reference constant moving, not the unit.
- **Verdict:** disproven by the raw dump. No code-side unit fix is warranted.

### Cause C — Physical / mounting / sensor-fault issue ❌ REJECTED

- **For:** a dislodged or fouled ultrasonic sensor can produce wild depths.
- **Against:** the device is online, the battery reports, and the depth telemetry
  varies smoothly (4.46–4.79 m) like a healthy live signal rather than dropout or
  railed garbage. The bad numbers are perfectly explained by the software
  calibration constants (5.00 m) with no need to invoke hardware failure. Nothing
  points to a mounting change.
- **Verdict:** no supporting evidence; not the cause.

---

## Recommended next step (not performed here)

Restore the two calibration constants on the device via the Smart Life app —
**Installation height = 1.23 m**, **Liquid maximum depth = 1.04 m** (override the
app's auto-fill) — then verify readings come off the 1733 clamp. Full procedure
and detection/verification checklist are in CLAUDE.md §"Post-Power-Outage
Recovery: Tank Sensor Calibration". **No `tank-strapping.js` / `poll.js` change is
needed or appropriate.** Consider adding a poll.js sanity guard that alarms on
physically-impossible depth (> ~1.1 m) instead of silently clamping, so the next
outage is caught immediately.

---

*All Tuya calls were GET-only; no device settings modified. Supabase access was
SELECT-only. This report is intentionally left uncommitted for review.*
