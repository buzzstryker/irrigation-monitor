// Verify Wave 1 schema changes
const { getDb } = require('./db');

const db = getDb();

console.log('=== VERIFICATION ===\n');

// 1. List all tables
console.log('1. Tables in database:');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach((t, i) => console.log(`   ${i + 1}. ${t.name}`));
console.log(`   Total: ${tables.length} tables\n`);

// 2. Verify dropped tables are gone
const droppedTables = ['flow_attribution_warnings', 'controller_flow_meter_health', 'controller_flow_meter_health_log', 'z5_selftest_log'];
console.log('2. Verify dropped tables are gone:');
droppedTables.forEach(table => {
  const exists = tables.some(t => t.name === table);
  console.log(`   ${table}: ${exists ? '✗ STILL EXISTS' : '✓ dropped'}`);
});
console.log();

// 3. watering_events schema
console.log('3. watering_events schema:');
const weInfo = db.prepare("PRAGMA table_info(watering_events)").all();
weInfo.forEach(col => {
  console.log(`   ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
});
console.log();

// 4. flow_calibration_log schema
console.log('4. flow_calibration_log schema:');
const fclInfo = db.prepare("PRAGMA table_info(flow_calibration_log)").all();
fclInfo.forEach(col => {
  console.log(`   ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
});
console.log();

// 5. watering_events row count
const weCount = db.prepare("SELECT COUNT(*) as count FROM watering_events").get();
console.log(`5. watering_events row count: ${weCount.count}\n`);

// 6. flow_source/flow_quality distribution
console.log('6. flow_source/flow_quality distribution:');
const distribution = db.prepare("SELECT flow_source, flow_quality, COUNT(*) as count FROM watering_events GROUP BY flow_source, flow_quality").all();
distribution.forEach(row => {
  console.log(`   flow_source='${row.flow_source}', flow_quality='${row.flow_quality}': ${row.count} rows`);
});
console.log();

// 7. Table row counts
console.log('7. Row counts for key tables:');
const keyTables = ['watering_events', 'tank_level_log', 'zone_state_log', 'et_log', 'flow_calibration_log'];
keyTables.forEach(table => {
  try {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    console.log(`   ${table}: ${count.count} rows`);
  } catch (err) {
    console.log(`   ${table}: ERROR - ${err.message}`);
  }
});
