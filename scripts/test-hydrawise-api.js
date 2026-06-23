/**
 * scripts/test-hydrawise-api.js - Test Hydrawise API availability
 *
 * Checks if customerdetails and statusschedule endpoints are reachable.
 */

require('dotenv').config();

const API_KEY = process.env.HYDRAWISE_API_KEY;

async function testAPI() {
  console.log('=== HYDRAWISE API TEST ===\n');
  console.log('Time:', new Date().toISOString());
  console.log('API Key:', API_KEY ? `${API_KEY.substring(0, 8)}... (${API_KEY.length} chars)` : 'NOT SET');

  // Test 1: customerdetails
  console.log('\n--- Test 1: customerdetails ---');
  try {
    const url = `https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${API_KEY}&type=controllers`;
    const res = await fetch(url);
    console.log(`Status: ${res.status} ${res.statusText}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`Controllers found: ${data.controllers ? data.controllers.length : 0}`);
      if (data.controllers) {
        data.controllers.forEach(c => console.log(`  - "${c.name}" (id: ${c.controller_id})`));
      }
    } else {
      const text = await res.text();
      console.log(`Error response: ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error(`Exception: ${err.message}`);
  }

  // Test 2: statusschedule (Garage controller)
  console.log('\n--- Test 2: statusschedule (Garage 1659477) ---');
  try {
    const url = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${API_KEY}&controller_id=1659477`;
    const res = await fetch(url);
    console.log(`Status: ${res.status} ${res.statusText}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`Controller: ${data.name || 'unknown'}`);
      console.log(`Relays: ${data.relays ? data.relays.length : 0}`);
      if (data.relays) {
        const running = data.relays.filter(r => r.time === 1);
        console.log(`Running now: ${running.length}`);
        running.forEach(r => console.log(`  - relay ${r.relay}: ${r.name}`));
      }
    } else {
      const text = await res.text();
      console.log(`Error response: ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error(`Exception: ${err.message}`);
  }

  // Test 3: statusschedule (Pool Equipment controller)
  console.log('\n--- Test 3: statusschedule (Pool Equipment 1977673) ---');
  try {
    const url = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${API_KEY}&controller_id=1977673`;
    const res = await fetch(url);
    console.log(`Status: ${res.status} ${res.statusText}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`Controller: ${data.name || 'unknown'}`);
      console.log(`Relays: ${data.relays ? data.relays.length : 0}`);
    } else {
      const text = await res.text();
      console.log(`Error response: ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error(`Exception: ${err.message}`);
  }

  // Test 4: statusschedule (Barn controller)
  console.log('\n--- Test 4: statusschedule (Barn 1970558) ---');
  try {
    const url = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${API_KEY}&controller_id=1970558`;
    const res = await fetch(url);
    console.log(`Status: ${res.status} ${res.statusText}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`Controller: ${data.name || 'unknown'}`);
      console.log(`Relays: ${data.relays ? data.relays.length : 0}`);
    } else {
      const text = await res.text();
      console.log(`Error response: ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error(`Exception: ${err.message}`);
  }
}

testAPI();
