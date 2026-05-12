# Hydrawise API Flow Fields Characterization

**Date:** 2026-05-12  
**Controller:** Garage (ID: 1659477)  
**Captures:** 22 samples over ~3.5 minutes (10-second intervals)  
**Active Zone Run:** Yes — Relay 1 (Frontyard East Sod, Z1) for ~90 seconds

---

## Summary

**Real-time flow data was NOT found in the Hydrawise REST API v1 `statusschedule.php` endpoint during an active zone run.** Despite capturing API responses while Garage Zone 1 was actively running (confirmed by `time=1` and `timestr="Now"`), no flow-related fields appeared in the response. The endpoint does not expose:
- `water_int` (cumulative water integer)
- `water_unit` (water units/gallons)
- `gpm` (gallons per minute)
- `flow` (current flow rate)
- `current_flow` (instantaneous flow)
- `water_used` (usage tracking)
- Any other flow measurement fields

The only field that could theoretically relate to flow is `sensors[0].rate`, which remained constant at **1.8927** across all captures (both idle and active states), indicating it represents a flow meter calibration constant, not real-time flow.

---

## Capture Timeline

| Seq | Time | Active Zone | sensors[0].rate | New Fields | Flow Fields |
|-----|------|-------------|-----------------|------------|-------------|
| 000 | 05:05:49 | None | 1.8927 | (baseline) | None |
| 001 | 05:05:59 | None | 1.8927 | — | None |
| 002 | 05:06:09 | None | 1.8927 | — | None |
| ... | ... | ... | ... | ... | ... |
| 008 | 05:07:29 | None | 1.8927 | — | None |
| 009 | 05:07:39 | None | 1.8927 | — | None |
| 010 | 05:07:49 | **Z1 Running** | 1.8927 | type=106 | **None** |
| 011 | 05:07:59 | **Z1 Running** | 1.8927 | — | **None** |
| 012 | 05:08:09 | **Z1 Running** | 1.8927 | — | **None** |
| 013 | 05:08:19 | **Z1 Running** | 1.8927 | — | **None** |
| 014 | 05:08:29 | **Z1 Running** | 1.8927 | — | **None** |
| 015 | 05:08:39 | **Z1 Running** | 1.8927 | — | **None** |
| 016 | 05:08:49 | **Z1 Running** | 1.8927 | — | **None** |
| 017 | 05:08:59 | **Z1 Running** | 1.8927 | — | **None** |
| 018 | 05:09:09 | **Z1 Running** | 1.8927 | — | **None** |
| 019 | 05:09:19 | None | 1.8927 | type=1 | None |
| 020 | 05:09:29 | None | 1.8927 | — | None |
| 021 | 05:09:39 | None | 1.8927 | — | None |

**Zone Run Duration:** Captures 010-018 (~90 seconds)

---

## Field Characterization

### Fields Present in All Captures (Baseline & Active)

**Top-level fields:**
- `time`: Unix timestamp
- `nextpoll`: Polling interval (constant 60)
- `message`: Status message (empty string)
- `simRelays`, `options`, `stupdate`, `master`, `master_timer`, `master_post_timer`: Status flags
- `expanders`: Array (empty)
- `sensors`: Array with flow meter configuration
- `relays`: Array of zone objects

**sensors[0] fields:**
- `input`, `type`, `mode`, `timer`, `offtimer`: Flow meter config
- **`rate`**: **1.8927** (constant across all captures)
  - **Inferred meaning:** Flow meter calibration constant (pulses per gallon or similar)
  - **Behavior:** Does NOT change during active run
  - **Conclusion:** Not real-time flow data
- `relays`: Array of relay IDs attached to this sensor

**relay fields (inactive zones):**
- `relay_id`: Unique relay identifier
- `time`: Seconds until next scheduled run (large number, e.g., 95951)
- `type`: Zone type (typically 1)
- `run`: Scheduled duration in seconds
- `relay`: Relay number (1-9)
- `name`: Zone name
- `period`: Schedule period
- `timestr`: Human-readable next run time (e.g., "Wed")
- `stop`: Stop flag (typically 1)

**relay fields (ACTIVE zones):**
- `time`: **1** (indicates "running now")
- `type`: **106** (vs. 1 for inactive) — indicates manual/immediate run
- `timestr`: **"Now"**
- All other fields same as inactive

### Fields NOT Found in Any Capture

Despite extensive search across all 22 captures (including 9 during active run):
- `water_int` ❌
- `water_unit` ❌
- `gallons` ❌
- `gpm` ❌
- `flow` ❌
- `current_flow` ❌
- `water_used` ❌
- `volume` ❌
- `usage` ❌
- `consumed` ❌
- `meter_reading` ❌

---

## Cross-Reference to Hydrawise UI

**User Verification Needed:**  
The Hydrawise web UI reportedly shows cumulative gallons used after a zone run completes (e.g., "77 gallons used" for a Z7 Pool Equipment run). This data is **NOT accessible via the REST API v1 `statusschedule.php` endpoint** based on this characterization.

**Hypothesis:**  
Hydrawise web UI likely accesses historical water usage data via:
1. A different REST API endpoint not yet discovered (e.g., `/api/v1/usage.php`, `/api/v1/history.php`)
2. The GraphQL API (newer, undocumented)
3. Internal/private API endpoints not exposed to third-party API keys

---

## Recommendation for poll.js Fix

### Current State

`poll.js` correctly **does NOT attempt to read flow data** from `statusschedule.php` because the data is not present in the API response. The current implementation that ignores flow is correct for REST API v1.

### Phase 2 Options

**Option A: Use Configured GPM Values (CURRENT APPROACH — RECOMMENDED)**

Continue calculating water usage from configured GPM values in `zones.config.js`:
```javascript
gallons = zone.gpm × (duration_seconds / 60)
```

**Pros:**
- Works with current API
- Accurate if GPM values are calibrated correctly
- No API limitations

**Cons:**
- Requires manual GPM calibration per zone
- Doesn't account for flow meter degradation
- No real-time validation against actual flow

**Option B: Investigate GraphQL API (FUTURE WORK)**

Research Hydrawise's GraphQL API to determine if it exposes real-time or historical flow data.

**Pros:**
- May provide actual measured flow data
- Aligns with newer Hydrawise infrastructure

**Cons:**
- Undocumented API
- May require different authentication
- Uncertain if flow data is available

**Option C: Parse Hydrawise Web Dashboard (NOT RECOMMENDED)**

Screen-scrape the Hydrawise web UI to extract usage data.

**Pros:**
- Data is definitely available in UI

**Cons:**
- Fragile (UI changes break scraper)
- Requires authenticated browser session
- Violates API terms of service

### Recommended Immediate Action

**✅ No changes to poll.js required.**  
The current approach (using configured GPM values) is the correct implementation for REST API v1. The "fix" mentioned in the task prompt is not needed — poll.js is already handling this correctly by not reading non-existent flow fields.

### Future Enhancement (Phase 4b+)

When implementing the scheduling cutover (Phase 4b), consider:
1. Completing Phase 4a flow calibration for all Pool Equipment zones
2. Periodic re-calibration of GPM values via flow meter observations
3. Investigating GraphQL API for potential flow data access

---

## Open Questions for Human Review

1. **Does the Hydrawise UI show real-time flow during an active run, or only cumulative gallons after completion?**  
   → If real-time, the data source is not REST API v1.

2. **Is there a REST API v1 endpoint for historical water usage?**  
   → Tried: `reportwatering.php` (404), `wateringhistory.php` (404), `runlog.php` (404), `history.php` (404)  
   → Need to research if other endpoint names exist.

3. **Does the Hydrawise account subscription level (HOME vs ENTHUSIAST) affect API data availability?**  
   → Current account may have limited API access compared to premium tiers.

4. **Is `sensors[0].rate = 1.8927` the correct flow meter calibration constant?**  
   → Value is consistent but unknown units (pulses/gallon? gallons/pulse?)  
   → Should verify against physical flow meter documentation.

5. **Should we contact Hydrawise/Hunter Industries support for API clarification?**  
   → Official answer on whether flow data is available via any API endpoint  
   → Documentation for undocumented endpoints  
   → GraphQL API access requirements

---

## Appendix: Sample API Response

### Inactive Zone (Baseline)
```json
{
  "relay_id": 11545266,
  "time": 95951,
  "type": 1,
  "run": 300,
  "relay": 1,
  "name": "1 frontyard eas",
  "period": 259200,
  "timestr": "Wed",
  "stop": 1
}
```

### Active Zone (Running)
```json
{
  "relay_id": 11545266,
  "time": 1,
  "type": 106,
  "run": 555,
  "relay": 1,
  "name": "1 frontyard eas",
  "period": 259200,
  "timestr": "Now",
  "stop": 1
}
```

**Key Difference:** Only status fields change (`time`, `type`, `timestr`). No flow measurement fields appear.

---

## Conclusion

The Hydrawise REST API v1 `statusschedule.php` endpoint **does not expose real-time or cumulative flow data** for active or completed zone runs. The current `poll.js` implementation that calculates water usage from configured GPM values is the correct approach given API limitations. Future investigation should focus on GraphQL API or alternative data sources if measured flow tracking is required.
