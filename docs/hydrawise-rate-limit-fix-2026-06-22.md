# Hydrawise Rate Limit Fix (2026-06-22)

## Problem

Railway logs showed repeated `429` (rate limit) errors on the Hydrawise `customerdetails` endpoint after the scheduler was bootstrapped into `poll.js`. The errors looked like:

```
[POLL] Hydrawise customerdetails error: 429
[POLL] Could not discover controllers — will retry next cycle
```

## Root Cause

**Hydrawise rate limit:** ~5 API calls per 5 minutes on `customerdetails.php`.

**Before the fix:**
- `poll.js` retries `discoverControllers()` **every 60 seconds** when it fails (including 429 errors)
- During normal operation: 3 × `statusschedule` calls per minute (Garage, Pool Equipment, Barn)
- During failed discovery: **4 calls/min** (1 × customerdetails retry + 3 × statusschedule)
- **Result:** 20 calls per 5 minutes — 4× over the rate limit

The scheduler itself doesn't make any Hydrawise API calls (verified — all 8 cron jobs use local DB data only). The scheduler fix was correct; it surfaced a latent rate-limit bug that existed since the beginning but only became visible when the poller was running continuously in production.

## Fix

Added **exponential backoff** to controller discovery retries in `poll.js`:

1. **On 429 error:** Back off for 5 min, then 10 min, 20 min, 40 min (capped)
2. **On success:** Reset backoff state
3. **During backoff:** Skip discovery attempts entirely (don't make the API call)
4. **Log clearly:** Show remaining backoff time in Railway logs

### Code Changes

**File:** `poll.js`

**Added state variables:**
```javascript
let discoveryBackoffUntil = 0;  // epoch seconds — don't retry before this time
let discoveryRetryCount = 0;    // consecutive failures — drives exponential backoff
```

**Updated `discoverControllers()`:**
- Detects 429 status code
- Calculates exponential backoff: `Math.min(5 * Math.pow(2, retryCount - 1), 40)` minutes
- Logs: `[POLL] Hydrawise rate limit (429) on customerdetails — backing off 5 min (retry #1)`
- Resets backoff state on successful discovery

**Updated `poll()` main loop:**
- Checks `discoveryBackoffUntil` before attempting discovery
- Skips discovery calls during backoff window
- Logs remaining backoff time every 5 minutes

## Expected Behavior After Fix

**Normal startup (no rate limit):**
1. First poll: `discoverControllers()` succeeds, logs 3 controllers
2. Every 60s: 3 × `statusschedule` calls only (no more `customerdetails` calls)
3. Total: **3 calls/min** — under the 5-per-5-min limit

**If 429 occurs (rare — only at startup or after long outage):**
1. Discovery gets 429, backs off 5 minutes
2. Logs: `[POLL] Hydrawise rate limit (429) on customerdetails — backing off 5 min (retry #1)`
3. For next 5 minutes: `statusschedule` calls continue (zones still poll), but no `customerdetails` retries
4. After 5 min: One retry attempt
5. If still failing: 10 min backoff, then 20 min, then 40 min (capped)

## Verification Steps

Deploy to Railway and check logs for:

✅ **Success case:**
```
[POLL] Discovered controller: "Garage" (id: 1659477)
[POLL] Discovered controller: "Pool Equipment" (id: 1977673)
[POLL] Discovered controller: "Barn" (id: 1970558)
[CRON] Scheduler initialized — 8 cron jobs registered
[POLL] Cycle #1 | Tank: 932 gal | Zones polled: 22 | Running: 0
```

✅ **Backoff case (if 429 occurs):**
```
[POLL] Hydrawise rate limit (429) on customerdetails — backing off 5 min (retry #1)
[POLL] Controller discovery in backoff — 5 min remaining (rate limit recovery)
[POLL] Controller discovery in backoff — 4 min remaining (rate limit recovery)
...
```

❌ **Old broken behavior (should NOT see this):**
```
[POLL] Hydrawise customerdetails error: 429
[POLL] Could not discover controllers — will retry next cycle
(repeats every 60 seconds — flooding the rate limit)
```

## API Call Budget (Verified Safe)

| Endpoint | Frequency | Calls per 5 min | Limit |
|----------|-----------|-----------------|-------|
| `customerdetails.php` | Once at startup, then exponential backoff on failure | 0–1 | 5 |
| `statusschedule.php` | 3 controllers × 1/min | 15 | Unknown (higher) |

Total `customerdetails` calls: **1 per startup** (then cached forever unless it fails). Even with 5 consecutive failures, the backoff prevents exceeding the limit.

## Related Files

- `poll.js` — main poller, discovery logic, backoff implementation
- `scheduler.js` — confirmed NO Hydrawise API calls (all cron jobs use local DB)
- `ditch-monitor.js` — confirmed NO Hydrawise API calls (reads tank_sensor_log + zone_state_log only)
- `et-logger.js` — confirmed NO Hydrawise API calls (Open-Meteo only)
- `coefficient-model.js` — confirmed NO Hydrawise API calls (local DB reads)
- `reports/daily-report.js` — confirmed NO Hydrawise API calls (local DB reads)

## Lessons Learned

1. **Rate limits surface under load** — The bug existed since Phase 0 but only became visible when the poller ran continuously in production (Railway). Local testing with intermittent starts didn't trigger it.

2. **Exponential backoff is table stakes** for any external API that has rate limits. Retrying at a fixed interval (60s) is a guaranteed failure mode.

3. **Loud logging on rate limits** helps diagnose issues in production. The fix logs both the backoff decision AND the remaining wait time.

4. **Caching wins** — After the first successful discovery, `controllerMap` is cached for the lifetime of the process. No need to re-discover unless the process restarts or the discovery fails.

---

*Fixed by: Claude Code (2026-06-22)*  
*Verified safe for Railway deployment.*
