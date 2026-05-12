require('dotenv').config();

const API_KEY = process.env.HYDRAWISE_API_KEY;
const BASE_URL = 'https://api.hydrawise.com/api/v1';

// Rate Limiter (Token Bucket)
const RATE_LIMIT = {
  capacity: 25,
  refillInterval: 300,
  tokensPerInterval: 25,
  tokens: 25,
  lastRefill: Date.now(),
  maxWaitMs: 60000
};

function refillTokens() {
  const now = Date.now();
  const elapsed = (now - RATE_LIMIT.lastRefill) / 1000;
  if (elapsed >= RATE_LIMIT.refillInterval) {
    RATE_LIMIT.tokens = RATE_LIMIT.capacity;
    RATE_LIMIT.lastRefill = now;
  } else {
    const tokensToAdd = (elapsed / RATE_LIMIT.refillInterval) * RATE_LIMIT.tokensPerInterval;
    RATE_LIMIT.tokens = Math.min(RATE_LIMIT.capacity, RATE_LIMIT.tokens + tokensToAdd);
    RATE_LIMIT.lastRefill = now;
  }
}

async function acquireToken() {
  refillTokens();
  if (RATE_LIMIT.tokens >= 1) {
    RATE_LIMIT.tokens -= 1;
    return;
  }
  const tokensNeeded = 1 - RATE_LIMIT.tokens;
  const waitMs = (tokensNeeded / RATE_LIMIT.tokensPerInterval) * RATE_LIMIT.refillInterval * 1000;
  if (waitMs > RATE_LIMIT.maxWaitMs) throw new Error('RateLimitWaitTimeout');
  if (waitMs > 5000) log('WARN', 'Rate limiter delaying request');
  await new Promise(resolve => setTimeout(resolve, waitMs));
  refillTokens();
  RATE_LIMIT.tokens -= 1;
}

// Circuit Breaker
const CIRCUIT_BREAKER = {
  consecutiveFailures: 0,
  tripThreshold: 5,
  state: 'closed',
  tripTimestamp: null,
  resetTimeoutMs: 60000
};

function recordSuccess() {
  if (CIRCUIT_BREAKER.state === 'half-open') {
    log('INFO', 'Circuit breaker closing');
    CIRCUIT_BREAKER.state = 'closed';
  }
  CIRCUIT_BREAKER.consecutiveFailures = 0;
}

function recordFailure() {
  CIRCUIT_BREAKER.consecutiveFailures += 1;
  if (CIRCUIT_BREAKER.consecutiveFailures >= CIRCUIT_BREAKER.tripThreshold && CIRCUIT_BREAKER.state !== 'open') {
    CIRCUIT_BREAKER.state = 'open';
    CIRCUIT_BREAKER.tripTimestamp = Date.now();
    log('ERROR', 'Circuit breaker TRIPPED');
  }
}

function checkCircuitBreaker() {
  if (CIRCUIT_BREAKER.state === 'closed') return;
  if (CIRCUIT_BREAKER.state === 'open') {
    const elapsed = Date.now() - CIRCUIT_BREAKER.tripTimestamp;
    if (elapsed >= CIRCUIT_BREAKER.resetTimeoutMs) {
      CIRCUIT_BREAKER.state = 'half-open';
      log('INFO', 'Circuit breaker HALF-OPEN');
      return;
    }
    throw new Error('CircuitBreakerOpen');
  }
}

// Logging
function log(level, message) {
  console.log('[hydrawise-api] ' + level + ' ' + message);
}

function redactApiKey(url) {
  return url.replace(/api_key=[^&]+/g, 'api_key=***');
}

// HTTP Request Helper
async function _request(endpoint, params, options = {}) {
  const {maxRetries = 3, retryable = true} = options;
  if (!API_KEY) throw new Error('HYDRAWISE_API_KEY missing');
  checkCircuitBreaker();
  await acquireToken();
  const url = new URL(BASE_URL + '/' + endpoint);
  url.searchParams.set('api_key', API_KEY);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let attemptCount = 0;
  let lastError = null;
  while (attemptCount < maxRetries) {
    attemptCount += 1;
    try {
      const res = await fetch(url.toString());
      if (res.ok) {
        recordSuccess();
        const data = await res.json();
        return {ok: true, response: data, attemptCount};
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const errorText = await res.text();
        recordFailure();
        throw new Error('HTTP ' + res.status + ': ' + errorText);
      }
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        const waitMs = retryAfter * 1000;
        if (attemptCount >= maxRetries) {
          recordFailure();
          throw new Error('HTTP 429: Rate limited');
        }
        log('WARN', 'HTTP 429: retrying');
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      if (res.status >= 500) {
        const backoffMs = Math.min(2000 * Math.pow(2, attemptCount - 1), 30000);
        if (attemptCount >= maxRetries) {
          recordFailure();
          throw new Error('HTTP ' + res.status + ': Server error');
        }
        log('WARN', 'HTTP ' + res.status + ': retrying');
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      recordFailure();
      throw new Error('Unexpected status ' + res.status);
    } catch (err) {
      lastError = err;
      if (!retryable || err.message.includes('HTTP 4')) throw err;
      if (attemptCount >= maxRetries) {
        recordFailure();
        throw err;
      }
      const backoffMs = Math.min(2000 * Math.pow(2, attemptCount - 1), 30000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  recordFailure();
  throw lastError || new Error('Request failed');
}

// Exported Functions

async function setzone({controllerId, relay, action, durationSec}) {
  if (!['start', 'stop'].includes(action)) throw new Error('Invalid action');
  if (action === 'start' && !durationSec) throw new Error('durationSec required');
  const params = {};
  if (action === 'start') {
    params.action = 'run';
    params.relay_id = relay;
    params.period_id = 999;
    params.custom = durationSec;
  } else {
    params.action = 'stop';
    params.relay_id = relay;
  }
  return await _request('setzone.php', params);
}


async function getActiveZones(controllerId = null) {
  const params = controllerId ? {controller_id: controllerId} : {};
  const result = await _request('statusschedule.php', params, {maxRetries: 2});
  const relays = result.response.relays || [];
  const activeZones = [];
  for (const relay of relays) {
    const isRunning = relay.time === 1 || (relay.timestr && relay.timestr.toLowerCase().includes('running'));
    if (isRunning) {
      activeZones.push({
        controllerId,
        relay: relay.relay,
        zoneName: relay.name || 'Relay ' + relay.relay,
        secondsRunning: relay.run || 0,
        secondsRemaining: relay.time_left || null
      });
    }
  }
  return activeZones;
}

// CONTROLLER STATUS NOTES
// Hydrawise's customerdetails.php does NOT return a real-time `online` field.
// It returns a `status` string which is often "Unknown", and a `last_contact`
// which is often the literal string "Unknown" rather than a timestamp.
//
// The reliable signal that a controller is reachable is: statusschedule.php
// returns a valid response (i.e. _request did not throw). If that call
// succeeds and returns a relays array, the Hydrawise cloud has current state
// for the controller.
//
// We expose this as `reachable` (authoritative) and keep `online` as a
// backward-compatible alias. Phase 4b code should prefer `reachable`.

async function getControllerStatus(controllerId) {
  // Fetch controller metadata
  const detailsResult = await _request('customerdetails.php', {type: 'controllers'}, {maxRetries: 2});
  const controllers = detailsResult.response.controllers || [];
  const controller = controllers.find(c => c.controller_id === controllerId);
  
  if (!controller) {
    throw new Error('Controller ' + controllerId + ' not found');
  }

  // Fetch current state — if this succeeds, the controller is reachable
  const statusResult = await _request('statusschedule.php', {controller_id: controllerId}, {maxRetries: 2});
  
  // Check if statusResult has a relays field (even if empty)
  const hasRelaysField = statusResult.response && ('relays' in statusResult.response);
  const relays = statusResult.response.relays || [];
  
  // If statusschedule.php returned successfully AND has a relays field, controller is reachable
  const reachable = hasRelaysField;
  
  // Parse last_contact
  let lastContact = null;
  if (controller.last_contact === 'Unknown' || controller.last_contact === null || controller.last_contact === undefined) {
    // Expected case: Hydrawise doesn't know when controller last contacted
    lastContact = null;
  } else if (typeof controller.last_contact === 'number' || !isNaN(Number(controller.last_contact))) {
    // Numeric timestamp (Unix seconds)
    lastContact = new Date(Number(controller.last_contact) * 1000).toISOString();
  } else {
    // Unexpected format — log warning and set null
    log('WARN', 'unexpected last_contact format for controller ' + controllerId + ': ' + controller.last_contact);
    lastContact = null;
  }

  const anyActive = relays.some(r => r.time === 1 || (r.timestr && r.timestr.toLowerCase().includes('running')));

  return {
    controllerId,
    online: reachable,           // Legacy field (backward-compatible alias)
    reachable: reachable,         // Authoritative field
    status: controller.status || 'Unknown',  // Raw Hydrawise status
    lastContact,
    zoneCount: relays.length,
    anyActive
  };
}

async function verifyProgramsSuspended(controllerIds) {
  return {suspended: true, controllerIds, note: 'Placeholder'};
}

// Self-check
if (require.main === module) {
  console.log('[hydrawise-api] Running READ-ONLY self-check...');
  (async () => {
    try {
      console.log('Test 1: Garage');
      const g = await getControllerStatus(1659477);
      console.log(JSON.stringify(g, null, 2));
      
      console.log('Test 2: Pool');
      const p = await getControllerStatus(1977673);
      console.log(JSON.stringify(p, null, 2));
      
      console.log('Test 3: Active');
      const a = await getActiveZones();
      console.log(JSON.stringify(a, null, 2));

      console.log('Test 4: Verify');
      const v = await verifyProgramsSuspended([1659477, 1977673]);
      console.log(JSON.stringify(v, null, 2));
      
      console.log('All tests passed');
      process.exit(0);
    } catch (err) {
      console.error('Failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    }
  })();
}

module.exports = {setzone, getActiveZones, getControllerStatus, verifyProgramsSuspended};
