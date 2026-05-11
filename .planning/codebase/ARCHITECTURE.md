# Architecture

**Analysis Date:** 2026-05-11

## Naming Patterns

**Files:**
- kebab-case: coefficient-model.js, et-engine.js, daily-report.js
- Test files: .test.js suffix (e.g., coefficient-model.test.js, et-engine.test.js)
- Config files: .config.js suffix (e.g., zones.config.js, ecosystem.config.js)

**Functions:**
- camelCase: getDb(), calculateETo(), logDailyComparison(), handleInboundSMS()
- Verb-first naming: get, fetch, parse, log, handle, send, validate
- Boolean functions use should prefix: shouldSkipIrrigation()

**Variables:**
- camelCase: tankLevel, pollCount, zoneState, etInches
- UPPER_SNAKE_CASE for constants: ET_SUMMER_AVG, POLL_INTERVAL_MS, DAILY_VARS, API_KEY, TIMEZONE

**Types:**
- Object keys use snake_case for database fields: zone_id, et_inches, temp_high_f, created_at
- camelCase for in-memory objects: targetGallons, actualGal, deltaGal

## Code Style

**Formatting:**
- No formatter configured (no .prettierrc or .eslintrc in project root)
- Indentation: 2 spaces
- String quotes: Single quotes preferred
- Semicolons: Consistently used at end of statements
- Line length: ~90-100 characters typical

**Linting:**
- No ESLint configuration in project root

## Import Organization

**Order:**
1. Node.js built-ins
2. External dependencies
3. Local modules: relative paths (./, ../)

**Destructuring:**
- Consistently used for module exports

## Module Design

**Exports:**
- Named exports only (no default exports)
- Pattern: module.exports = { func1, func2, ... }

**Singleton Pattern:**
- Database: let _db = null; function getDb() { if (_db) return _db; ... }
- Twilio: let _client = null; function getClient() { if (_client) return _client; ... }
- Supabase: let supabase = null; function getSupabase() { if (supabase) return supabase; ... }

## Error Handling

**Patterns:**
- Try-catch blocks for async operations
- Console logging: console.error('[TAG] Error:', err.message)
- Graceful degradation: operations continue after logging errors

**Validation:**
- Early returns for invalid input
- Null coalescing: const value = input || defaultValue

## Logging

**Framework:** Console only

**Pattern:**
- Prefix with bracketed tag: [POLL], [ET], [SMS], [CRON], [API], [sync]
- Levels:
  - console.log(): Normal operations
  - console.warn(): Warnings
  - console.error(): Errors

## Comments

**When to Comment:**
- File-level docstrings (all files)
- Complex logic (Penman-Monteith equation)
- Section headers with banner comments
- Non-obvious inline logic

**JSDoc:**
- Used for public API functions with parameters

## Function Design

**Size:** 30-80 lines typical for main functions

**Parameters:** 1-3 parameters typical

**Return Values:**
- Objects for multiple values
- Arrays for collections
- Null for not found/error
- Void for side-effect functions

**Async/Await:**
- Async functions for API calls
- No .then() chains

## Database Patterns

**Query Style:**
- Synchronous better-sqlite3 API: db.prepare('...').run(), .get(), .all()
- Prepared statements always used
- Parameterized queries

**Transactions:**
- Used for bulk operations

## API Response Patterns

**Express Routes:**
- Success: res.json({ status: 'ok', ... })
- Error: res.status(400).json({ error: 'message' })
- Try-catch wrapper for all route handlers

## Environment Variables

**Access:**
- Via process.env.VAR_NAME
- Loaded via require('dotenv').config()
- Provide defaults and check existence

## CLI Script Pattern

- Entry point check: if (require.main === module)
- Used in: et-logger.js, reports/daily-report.js, test files

---

*Convention analysis: 2026-05-11*
