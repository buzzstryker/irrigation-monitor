/**
 * scripts/check-controller-names.js - Check exact controller names from Hydrawise API
 *
 * Queries customerdetails to see exact name strings returned by API.
 * Use this to diagnose name-match failures in poll.js.
 */

require('dotenv').config();

const API_KEY = process.env.HYDRAWISE_API_KEY;

async function checkNames() {
  if (!API_KEY) {
    console.error('HYDRAWISE_API_KEY not set');
    return;
  }

  const url = `https://api.hydrawise.com/api/v1/customerdetails.php?api_key=${API_KEY}&type=controllers`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`HTTP ${res.status}`);
      return;
    }

    const data = await res.json();

    console.log('=== CONTROLLERS FROM HYDRAWISE API ===\n');

    if (data.controllers && Array.isArray(data.controllers)) {
      for (const ctrl of data.controllers) {
        console.log(`Name: "${ctrl.name}"`);
        console.log(`  ID: ${ctrl.controller_id}`);
        console.log(`  Name length: ${ctrl.name.length} chars`);
        console.log(`  Name bytes: ${Buffer.from(ctrl.name).toString('hex')}`);
        console.log('');
      }
      console.log(`Total: ${data.controllers.length} controllers`);
    } else {
      console.log('No controllers found');
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

checkNames();
