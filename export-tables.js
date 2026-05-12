// Temporary script to export tables being dropped in Wave 1
const { getDb } = require('./db');
const fs = require('fs');
const path = require('path');

const db = getDb();
const backupDir = path.join(__dirname, 'backups', 'wave1-2026-05-12');

const tables = [
  'flow_attribution_warnings',
  'controller_flow_meter_health',
  'controller_flow_meter_health_log',
  'z5_selftest_log'
];

console.log('Exporting tables to CSV...\n');

for (const table of tables) {
  try {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    const outputPath = path.join(backupDir, `${table}.csv`);

    if (rows.length === 0) {
      fs.writeFileSync(outputPath, '# No data\n');
      console.log(`${table}: 0 rows (empty table)`);
    } else {
      // Get column names from first row
      const columns = Object.keys(rows[0]);
      const csvHeader = columns.join(',') + '\n';

      // Convert rows to CSV
      const csvRows = rows.map(row =>
        columns.map(col => {
          const value = row[col];
          if (value === null) return '';
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      ).join('\n');

      fs.writeFileSync(outputPath, csvHeader + csvRows);
      console.log(`${table}: ${rows.length} rows exported to ${path.basename(outputPath)}`);
    }
  } catch (err) {
    console.error(`Error exporting ${table}: ${err.message}`);
  }
}

console.log('\nExport complete.');
