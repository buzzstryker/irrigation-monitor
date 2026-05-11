# Codebase Structure

**Analysis Date:** 2026-05-11

## Test Framework

**Runner:**
- No formal test framework (no Jest, Mocha, Vitest)
- Custom test harness using plain Node.js scripts
- Config: None

**Assertion Library:**
- Custom assert() function in each test file

**Run Commands:**
```bash
node et-engine.test.js
node coefficient-model.test.js
npm test
```

## Test File Organization

**Location:**
- Co-located with source in project root
- Files: `et-engine.test.js`, `coefficient-model.test.js`

**Naming:**
- Pattern: `<module-name>.test.js`

## Test Structure

**Suite Organization:**
Custom test runner with passed/failed counters, custom assert(), process.exit()

**Patterns:**
- Block scope for each test
- Banner comments separate tests
- Exit code reflects results

## Assertion Patterns

Custom assert(condition, msg) logs checkmark or FAIL

## Async Testing

**Pattern:**
- async function runTests()
- try/catch around API calls
- Graceful degradation if API unavailable

## Test Data

**Fixtures:**
- Inline test data
- Database seeding in tests

## Mocking

**Framework:** None

**Patterns:**
- No mocking
- Real database (SQLite)
- Real API calls

## Test Types

**Unit Tests:**
- calculateETo(), getDailyTarget(), getSeason()

**Integration Tests:**
- Database ops, API calls, full workflows

**E2E Tests:**
- Not implemented

## Coverage

**Current:**
- `et-engine.js`: 7 tests
- `coefficient-model.js`: 9 tests
- `server.js`, `poll.js`, `scheduler.js`, `sms/`: Not tested

**View Coverage:**
- No tooling configured

## Test Execution

```bash
node et-engine.test.js
npm test
```

## Known Gaps

**Untested:**
- server.js (Express, webhooks)
- poll.js (Hydrawise polling)
- scheduler.js (Cron jobs)
- sms/ (SMS handling)
- sync.js (Supabase)

**Recommended:**
1. Add Jest or Mocha
2. Mock external APIs
3. Add Supertest for Express
4. Add coverage reporting

---

*Testing analysis: 2026-05-11*
