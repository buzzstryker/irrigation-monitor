/**
 * tank-warning.test.js — low-tank (pump dry-run) safety decision.
 *
 * Verifies the warning is driven by MEASURED gallons vs the 450 absolute
 * threshold, and — critically — that the decision is STATELESS so it survives a
 * process restart (no reset-to-full). Run: node tank-warning.test.js
 */

const { shouldWarnLowTank } = require('./tank-warning');

const THRESHOLD = 450; // low_warning_gal (absolute)

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ FAIL: ${msg}`); failed++; }
}

console.log('\n── Low-tank warning decision (measured vs 450) ──\n');

// Core threshold behavior
assert(shouldWarnLowTank(400, THRESHOLD) === true,  'measured 400 → WARN (below 450)');
assert(shouldWarnLowTank(500, THRESHOLD) === false, 'measured 500 → no warn (above 450)');
assert(shouldWarnLowTank(450, THRESHOLD) === false, 'measured 450 (exactly threshold) → no warn');
assert(shouldWarnLowTank(449.9, THRESHOLD) === true, 'measured 449.9 → WARN');
assert(shouldWarnLowTank(1616.7, THRESHOLD) === false, 'measured 1616.7 (current real level) → no warn');
assert(shouldWarnLowTank(0, THRESHOLD) === true, 'measured 0 (empty) → WARN');

// Unknown / bad data → null (caller neither raises nor resolves)
assert(shouldWarnLowTank(null, THRESHOLD) === null, 'null measurement → unknown (null)');
assert(shouldWarnLowTank(undefined, THRESHOLD) === null, 'undefined measurement → unknown (null)');
assert(shouldWarnLowTank(NaN, THRESHOLD) === null, 'NaN measurement → unknown (null)');

// Restart survival: the function has NO internal state. Simulate the old bug where
// process start "reset to full" (981) — then the real measured level is low.
console.log('\n── Restart-survival (statelessness) ──\n');
{
  // Pretend a prior cycle saw a healthy level (no memory should persist).
  shouldWarnLowTank(900, THRESHOLD);
  // After a "restart", the only input is the freshly-read measured level.
  const afterRestart = shouldWarnLowTank(400, THRESHOLD);
  assert(afterRestart === true,
    'after a simulated restart, measured 400 still WARNS (no reset-to-full memory)');

  // And the inverse: a recovered tank clears regardless of prior low readings.
  shouldWarnLowTank(100, THRESHOLD);
  assert(shouldWarnLowTank(800, THRESHOLD) === false,
    'recovered tank (800) clears regardless of earlier low reading');
}

console.log('\n═══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════');
process.exit(failed > 0 ? 1 : 0);
