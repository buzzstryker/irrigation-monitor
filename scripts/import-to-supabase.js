/**
 * import-to-supabase.js — One-time CSV data import to Supabase
 *
 * Phase 3 of Supabase migration. Loads all CSV files from migrations/data_export/
 * and bulk-inserts them into the Supabase Postgres database.
 *
 * Run: node scripts/import-to-supabase.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Supabase client setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// CSV parser (handles quoted fields with embedded commas and newlines)
function parseCSV(csvText) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n') {
        // Row separator
        currentRow.push(currentField);
        if (currentRow.length > 0 && currentRow.some(f => f.trim() !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char === '\r') {
        // Ignore \r (Windows line endings)
        continue;
      } else {
        currentField += char;
      }
    }
  }

  // Handle last field and row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.length > 0 && currentRow.some(f => f.trim() !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Type conversion based on column name patterns
function convertValue(value, columnName) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  // Integer columns (IDs and timestamps)
  // Note: zone_id is TEXT (Z1, Z2, etc.), not integer
  if (columnName === 'id' ||
      columnName === 'relay_id' || columnName === 'controller_id' || columnName === 'zone_relay' ||
      columnName === 'timestamp' || columnName.endsWith('_at') ||
      columnName === 'duration_seconds' || columnName === 'duration_sec' ||
      columnName === 'run_seconds' ||
      columnName === 'resolved' || columnName === 'flow_detected' ||
      columnName === 'observation_count') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  // Float columns
  if (columnName.includes('gpm') || columnName.includes('gallons') ||
      columnName.includes('inches') || columnName.includes('_pct') ||
      columnName.includes('_f') || columnName.includes('_mph') ||
      columnName.includes('_rad') || columnName.includes('kz_') ||
      columnName.includes('delta') || columnName === 'temp_high_f' ||
      columnName === 'temp_low_f' || columnName === 'humidity_pct' ||
      columnName === 'wind_mph' || columnName === 'solar_rad' ||
      columnName === 'et_avg_10day' || columnName === 'gallons_per_day_at_time') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  // Everything else is text
  return value;
}

// Read MANIFEST.txt to get table list and expected counts
function readManifest() {
  const manifestPath = path.join(__dirname, '..', 'migrations', 'data_export', 'MANIFEST.txt');
  const content = fs.readFileSync(manifestPath, 'utf8');
  const tables = [];

  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)\s+(\d+) rows\s+→\s+(\S+)$/);
    if (match) {
      tables.push({
        name: match[1],
        expectedRows: parseInt(match[2], 10),
        csvFile: match[3]
      });
    }
  }

  return tables;
}

// Import a single table
async function importTable(tableName, csvFile, expectedRows) {
  const csvPath = path.join(__dirname, '..', 'migrations', 'data_export', csvFile);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(csvText);

  if (rows.length === 0) {
    console.log(`${tableName}: 0 rows (empty table) ✓`);
    return { loaded: 0, expected: expectedRows, status: 'empty' };
  }

  // First row is header
  const headers = rows[0];
  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    console.log(`${tableName}: 0 rows (header only) ✓`);
    return { loaded: 0, expected: expectedRows, status: 'empty' };
  }

  // Convert CSV rows to objects with type conversion
  const records = dataRows.map((row, idx) => {
    const record = {};
    headers.forEach((header, i) => {
      record[header] = convertValue(row[i], header);
    });
    return record;
  });

  // Bulk insert in batches of 500
  const batchSize = 500;
  let loaded = 0;
  let errors = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    try {
      const { data, error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        errors.push({
          batchStart: i,
          batchEnd: i + batch.length,
          error: error.message
        });
        console.error(`  ✗ Batch ${i}-${i + batch.length} failed: ${error.message}`);
      } else {
        loaded += batch.length;
        if (records.length > batchSize) {
          process.stdout.write(`\r${tableName}: ${loaded}/${records.length} rows inserted...`);
        }
      }
    } catch (err) {
      errors.push({
        batchStart: i,
        batchEnd: i + batch.length,
        error: err.message
      });
      console.error(`  ✗ Batch ${i}-${i + batch.length} exception: ${err.message}`);
    }
  }

  if (records.length > batchSize) {
    process.stdout.write('\r');
  }

  const status = errors.length > 0 ? 'partial' : 'ok';
  const statusSymbol = errors.length > 0 ? '⚠' : '✓';

  console.log(`${tableName}: ${loaded}/${records.length} rows inserted ${statusSymbol}`);

  if (errors.length > 0) {
    console.error(`  Errors encountered in ${errors.length} batch(es)`);
  }

  return { loaded, expected: expectedRows, status, errors };
}

// Main import function
async function runImport() {
  console.log('=== SUPABASE DATA IMPORT ===\n');
  console.log(`Project: ${supabaseUrl}`);
  console.log(`Source: migrations/data_export/\n`);

  const tables = readManifest();
  console.log(`Found ${tables.length} tables in MANIFEST.txt\n`);

  const results = [];

  for (const table of tables) {
    const result = await importTable(table.name, table.csvFile, table.expectedRows);
    results.push({ name: table.name, ...result });
  }

  // Summary table
  console.log('\n=== IMPORT SUMMARY ===\n');
  console.log('Table                              Expected  Loaded  Status');
  console.log('─────────────────────────────────  ────────  ──────  ──────');

  let totalExpected = 0;
  let totalLoaded = 0;

  for (const r of results) {
    const name = r.name.padEnd(33);
    const expected = String(r.expected).padStart(8);
    const loaded = String(r.loaded).padStart(6);
    const status = r.status === 'ok' ? '✓' :
                   r.status === 'empty' ? '✓ (empty)' :
                   '⚠';

    console.log(`${name}  ${expected}  ${loaded}  ${status}`);

    totalExpected += r.expected;
    totalLoaded += r.loaded;
  }

  console.log('─────────────────────────────────  ────────  ──────  ──────');
  const totalName = 'TOTAL'.padEnd(33);
  const totalExpStr = String(totalExpected).padStart(8);
  const totalLoadStr = String(totalLoaded).padStart(6);
  console.log(`${totalName}  ${totalExpStr}  ${totalLoadStr}\n`);

  const hasErrors = results.some(r => r.status === 'partial');
  if (hasErrors) {
    console.error('⚠ Some batches failed. Check error messages above.\n');
    process.exit(1);
  } else {
    console.log('✓ Import complete\n');
  }
}

// Run import
runImport().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
