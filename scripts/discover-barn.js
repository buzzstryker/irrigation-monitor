/**
 * scripts/discover-barn.js - Query Hydrawise API for Barn controller relay inventory
 *
 * One-shot script to discover relay IDs for the Barn controller (1970558).
 */

require('dotenv').config();

const API_KEY = process.env.HYDRAWISE_API_KEY;
const BARN_CONTROLLER_ID = 1970558;

async function discoverBarn() {
  try {
    const statusUrl = `https://api.hydrawise.com/api/v1/statusschedule.php?api_key=${API_KEY}&controller_id=${BARN_CONTROLLER_ID}`;
    const statusRes = await fetch(statusUrl);
    const text = await statusRes.text();

    if (!statusRes.ok) {
      console.error('HTTP error:', statusRes.status, text);
      return;
    }

    const statusData = JSON.parse(text);

    console.log('=== BARN CONTROLLER (1970558) ===');
    console.log('Controller name:', statusData.name || '(not found)');
    console.log('\n=== RELAY INVENTORY ===');

    if (statusData.relays && statusData.relays.length > 0) {
      for (const relay of statusData.relays) {
        console.log(`relay_id: ${relay.relay_id} | relay: ${relay.relay} | name: "${relay.name}" | type: ${relay.type || 'unknown'}`);
      }
      console.log(`\nTotal relays: ${statusData.relays.length}`);
    } else {
      console.log('No relays found');
      console.log('Raw response structure:', Object.keys(statusData));
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
}

discoverBarn();
