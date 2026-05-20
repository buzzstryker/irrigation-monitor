/**
 * test-supabase-smoke.js — Supabase smoke test
 *
 * Verifies that the refactored code can read/write/delete from Supabase.
 * Inserts a test row, reads it back, then deletes it.
 */

require('dotenv').config();
const { supabase } = require('./db');

async function runSmokeTest() {
  console.log('[SMOKE TEST] Starting Supabase round-trip test...');

  const testMarker = `smoke-test-${Date.now()}`;
  const testTimestamp = Math.floor(Date.now() / 1000);

  try {
    // Step 1: Insert a test row into zone_gpm_change_log
    console.log('[SMOKE TEST] 1. Inserting test row...');
    const { data: insertData, error: insertError } = await supabase
      .from('zone_gpm_change_log')
      .insert({
        controller: 'TEST_CONTROLLER',
        zone_id: 'Z99',
        old_gpm: 5.0,
        new_gpm: 6.0,
        reason: testMarker,
        changed_at: testTimestamp
      })
      .select();

    if (insertError) {
      throw new Error(`Insert failed: ${insertError.message}`);
    }

    console.log('[SMOKE TEST] ✓ Insert successful');

    // Step 2: Read it back
    console.log('[SMOKE TEST] 2. Reading test row back...');
    const { data: readData, error: readError } = await supabase
      .from('zone_gpm_change_log')
      .select('*')
      .eq('reason', testMarker)
      .single();

    if (readError) {
      throw new Error(`Read failed: ${readError.message}`);
    }

    if (readData.controller !== 'TEST_CONTROLLER' || readData.zone_id !== 'Z99') {
      throw new Error('Read data does not match inserted data');
    }

    console.log('[SMOKE TEST] ✓ Read successful - data matches');

    // Step 3: Delete it
    console.log('[SMOKE TEST] 3. Deleting test row...');
    const { error: deleteError } = await supabase
      .from('zone_gpm_change_log')
      .delete()
      .eq('reason', testMarker);

    if (deleteError) {
      throw new Error(`Delete failed: ${deleteError.message}`);
    }

    console.log('[SMOKE TEST] ✓ Delete successful');

    // Step 4: Verify deletion
    console.log('[SMOKE TEST] 4. Verifying deletion...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('zone_gpm_change_log')
      .select('*')
      .eq('reason', testMarker);

    if (verifyError) {
      throw new Error(`Verify failed: ${verifyError.message}`);
    }

    if (verifyData && verifyData.length > 0) {
      throw new Error('Test row still exists after deletion');
    }

    console.log('[SMOKE TEST] ✓ Deletion verified - row no longer exists');

    console.log('');
    console.log('[SMOKE TEST] ========================================');
    console.log('[SMOKE TEST] ALL TESTS PASSED ✓');
    console.log('[SMOKE TEST] Supabase round-trip: INSERT → READ → DELETE');
    console.log('[SMOKE TEST] ========================================');

    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('[SMOKE TEST] ========================================');
    console.error('[SMOKE TEST] TEST FAILED ✗');
    console.error('[SMOKE TEST]', err.message);
    console.error('[SMOKE TEST] ========================================');
    process.exit(1);
  }
}

runSmokeTest();
