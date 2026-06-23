/**
 * ditch-monitor.test.js — Unit tests for valve-gating (interval-overlap).
 *
 * Verifies isAnyValveActive() correctly treats a window as valves-OFF only when
 * every zone on every controller was off for the WHOLE window — including the
 * case of a zone that turned on before the window and is still running across it
 * (the interval-overlap case the old transition-only logic missed).
 *
 * No network / DB — pure function test. Run: node ditch-monitor.test.js
 */

const { isAnyValveActive } = require('./ditch-monitor');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

// Window under test: [1000, 2000] (epoch seconds, arbitrary).
const WS = 1000;
const WE = 2000;
const on = (ts, ctrl, zone) => ({ timestamp: ts, controller: ctrl, zone_id: zone, state: 'on' });
const off = (ts, ctrl, zone) => ({ timestamp: ts, controller: ctrl, zone_id: zone, state: 'off' });

console.log('\n── Valve gating: isAnyValveActive (interval-overlap) ──\n');

// 1. No transitions at all → valves off.
assert(isAnyValveActive(WS, WE, []) === false,
  'empty zone_state_log → valves OFF');

// 2. Zone turns on INSIDE the window → active.
assert(isAnyValveActive(WS, WE, [on(1500, 'Loomis Garage', 'Z1')]) === true,
  "'on' transition inside window → ACTIVE");

// 3. Zone on BEFORE window, off AFTER window (running across the whole window).
//    This is the case the old logic missed (no transition inside the window).
assert(isAnyValveActive(WS, WE, [on(500, 'Loomis Garage', 'Z1'), off(2500, 'Loomis Garage', 'Z1')]) === true,
  'zone running across window (on before, off after) → ACTIVE');

// 4. Zone on then off, BOTH before the window → off during window.
assert(isAnyValveActive(WS, WE, [on(200, 'Loomis Garage', 'Z1'), off(800, 'Loomis Garage', 'Z1')]) === false,
  'zone ran entirely before window → valves OFF');

// 5. Zone on + off BOTH inside the window (brief run) → active.
assert(isAnyValveActive(WS, WE, [on(1200, 'Loomis Garage', 'Z1'), off(1400, 'Loomis Garage', 'Z1')]) === true,
  'brief run fully inside window → ACTIVE');

// 6. Zone off-transition inside window but it was already off at start, no 'on' →
//    valves OFF (a stray 'off' must not be read as activity).
assert(isAnyValveActive(WS, WE, [off(1300, 'Loomis Garage', 'Z1')]) === false,
  "lone 'off' inside window (was already off) → valves OFF");

// 7. Multiple controllers: Garage off, Barn running across window → ACTIVE.
assert(isAnyValveActive(WS, WE, [
  on(100, 'Loomis Garage', 'Z1'), off(300, 'Loomis Garage', 'Z1'),  // Garage ran early, off by window
  on(900, 'Loomis barn', 'Z5'),                                      // Barn on before window, still running
]) === true,
  'any one controller active (Barn running) → ACTIVE');

// 8. Zone on long before window with no later transition → still on at start → ACTIVE.
assert(isAnyValveActive(WS, WE, [on(10, 'Loomis Pool Equipment', 'Z2')]) === true,
  'zone on far before window, never turned off → ACTIVE');

// 9. On exactly at windowStart boundary → ACTIVE (conservative).
assert(isAnyValveActive(WS, WE, [on(WS, 'Loomis Garage', 'Z1')]) === true,
  "'on' exactly at windowStart → ACTIVE");

// 10. Same zone cycled before window (on→off→on→off) ending OFF → valves OFF.
assert(isAnyValveActive(WS, WE, [
  on(100, 'Loomis Garage', 'Z1'), off(200, 'Loomis Garage', 'Z1'),
  on(300, 'Loomis Garage', 'Z1'), off(400, 'Loomis Garage', 'Z1'),
]) === false,
  'zone cycled and ended OFF before window → valves OFF');

console.log('\n═══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════');

process.exit(failed > 0 ? 1 : 0);
