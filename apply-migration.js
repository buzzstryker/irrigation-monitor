// Apply Wave 1 migration
const { getDb } = require('./db');
const fs = require('fs');
const path = require('path');

const db = getDb();
const migrationPath = path.join(__dirname, 'migrations', 'migration_wave1_phase4a_cleanup.sql');

console.log('Applying migration: migration_wave1_phase4a_cleanup.sql\n');

try {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  db.exec(sql);
  console.log('✓ Migration applied successfully');
} catch (err) {
  console.error('✗ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
