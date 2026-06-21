/**
 * scripts/tuya-discover.js — Checkpoint script before wiring sensor reads.
 *
 * Hits the Tuya ME201W ONCE, dumps the raw datapoint list, the device info,
 * and (if invoked with --watch) polls every 30s to observe how often the
 * device's update_time actually changes — which tells us the real push
 * frequency to the Tuya cloud (the cadence ceiling for our poll loop).
 *
 *   node scripts/tuya-discover.js
 *   node scripts/tuya-discover.js --watch         (polls 10 times at 30s)
 *   node scripts/tuya-discover.js --watch --count 20 --interval 60
 *
 * NO unit conversion. NO Supabase write. The whole point is for the human
 * operator to confirm:
 *   1. WHICH DP code carries liquid level depth
 *   2. The UNIT (millimetres vs. centimetres vs. metres vs. scaled int)
 *   3. The device's REAL update cadence (so we don't poll faster than it pushes)
 *
 * Once those are confirmed, poll.js gets wired and this script becomes a debug
 * tool.
 */

'use strict';

require('dotenv').config();
const tuya = require('../tuya');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { watch: false, count: 10, intervalSec: 30 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--watch') out.watch = true;
    else if (args[i] === '--count') out.count = parseInt(args[++i], 10);
    else if (args[i] === '--interval') out.intervalSec = parseInt(args[++i], 10);
  }
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function dumpOnce() {
  const info = await tuya.getDeviceInfo();
  const status = await tuya.getDeviceStatus();

  console.log('--- DEVICE INFO -----------------------------------------------');
  console.log(`  name        : ${info.name}`);
  console.log(`  product     : ${info.product_name} (${info.product_id})`);
  console.log(`  category    : ${info.category}`);
  console.log(`  online      : ${info.online}`);
  console.log(`  update_time : ${info.update_time} (${new Date(info.update_time * 1000).toISOString()})`);
  console.log(`  active_time : ${info.active_time} (${new Date(info.active_time * 1000).toISOString()})`);

  console.log('\n--- RAW DATAPOINTS --------------------------------------------');
  for (const dp of status) {
    console.log(`  code=${String(dp.code).padEnd(30)} value=${JSON.stringify(dp.value)}`);
  }
  console.log('---------------------------------------------------------------\n');
  return info;
}

async function main() {
  const { watch, count, intervalSec } = parseArgs();

  // First dump — also catches credential/region errors loudly.
  const info0 = await dumpOnce();

  if (!watch) {
    console.log('Run again with --watch to observe update_time cadence (real push frequency).');
    return;
  }

  // Watch mode: track when device.update_time changes. update_time is seconds
  // since epoch and updates whenever Tuya cloud receives a fresh report from
  // the device, so the delta between successive distinct values is the device's
  // actual reporting interval (NOT our poll interval).
  console.log(`Watch mode: ${count} polls at ${intervalSec}s interval. Tracking update_time deltas...\n`);
  const updateTimes = [info0.update_time];

  for (let i = 1; i < count; i++) {
    await sleep(intervalSec * 1000);
    const info = await tuya.getDeviceInfo();
    const last = updateTimes[updateTimes.length - 1];
    const delta = info.update_time - last;
    const changed = delta > 0;
    const stamp = new Date().toISOString();
    console.log(`  [${stamp}] update_time=${info.update_time} ${changed ? `(NEW, +${delta}s since last change)` : '(unchanged)'}`);
    if (changed) updateTimes.push(info.update_time);
  }

  console.log('\n--- SUMMARY ---------------------------------------------------');
  if (updateTimes.length < 2) {
    console.log('  No update_time change observed during watch window. Either the device');
    console.log('  reports less often than the watch window, or it is offline. Increase');
    console.log(`  --count or --interval, or wait for the next push and retry.`);
  } else {
    const intervals = [];
    for (let i = 1; i < updateTimes.length; i++) {
      intervals.push(updateTimes[i] - updateTimes[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    console.log(`  observed push intervals (sec): ${intervals.join(', ')}`);
    console.log(`  average                       : ${avg.toFixed(0)}s`);
    console.log(`  -> recommended poll cadence   : floor(avg) but never less than the spec'd 300s (5 min).`);
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
