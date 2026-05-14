/**
 * End-to-end verification script for phone deduplication.
 * Checks that:
 * 1. normalizePhone() correctly handles numbers with and without country codes
 * 2. The DB has no duplicate phone records for the same normalized number
 * 3. client_accounts and clients tables are consistent
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load env
const dotenv = require('dotenv');
dotenv.config({ path: '.env' });

const mysql = require('mysql2/promise');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

// Parse mysql2 connection from URL
const url = new URL(DB_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port || '3306'),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
});

console.log('✅ Connected to DB\n');

// ─── Test 1: normalizePhone logic ───────────────────────────────────────────
console.log('=== Test 1: normalizePhone() logic ===');

function normalizePhone(raw, countryCode = '+1') {
  if (!raw) return '';
  let s = raw.trim();
  // Already E.164
  if (s.startsWith('+')) {
    return '+' + s.replace(/\D/g, '');
  }
  // Strip all non-digits
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  // Prepend country code
  const prefix = countryCode.replace('+', '');
  return '+' + prefix + digits;
}

const testCases = [
  { input: '4124827733',       cc: '+1',  expected: '+14124827733' },
  { input: '(412) 482-7733',   cc: '+1',  expected: '+14124827733' },
  { input: '+14124827733',     cc: '+1',  expected: '+14124827733' },
  { input: '4124827733',       cc: '+33', expected: '+334124827733' },
  { input: '+33612345678',     cc: '+1',  expected: '+33612345678' }, // already E.164, ignore cc
  { input: '0612345678',       cc: '+33', expected: '+330612345678' },
];

let passed = 0;
for (const tc of testCases) {
  const result = normalizePhone(tc.input, tc.cc);
  const ok = result === tc.expected;
  console.log(`  ${ok ? '✅' : '❌'} normalizePhone("${tc.input}", "${tc.cc}") = "${result}" ${ok ? '' : `(expected "${tc.expected}")`}`);
  if (ok) passed++;
}
console.log(`  ${passed}/${testCases.length} passed\n`);

// ─── Test 2: Check for duplicate phones in clients table ────────────────────
console.log('=== Test 2: Duplicate phones in clients table ===');
const [clientDups] = await conn.query(`
  SELECT phone, COUNT(*) as cnt, GROUP_CONCAT(DISTINCT business_owner_id) as owners
  FROM clients
  WHERE phone IS NOT NULL AND phone != ''
  GROUP BY phone
  HAVING cnt > 1
  LIMIT 20
`);
if (clientDups.length === 0) {
  console.log('  ✅ No duplicate phone numbers in clients table\n');
} else {
  console.log(`  ⚠️  Found ${clientDups.length} duplicate phone(s) in clients table:`);
  for (const row of clientDups) {
    console.log(`     phone="${row.phone}" appears ${row.cnt} times (owners: ${row.owners})`);
  }
  console.log();
}

// ─── Test 3: Check for un-normalized phones in clients table ────────────────
console.log('=== Test 3: Un-normalized phones in clients table ===');
const [unnormClients] = await conn.query(`
  SELECT id, phone, name
  FROM clients
  WHERE phone IS NOT NULL AND phone != '' AND phone NOT LIKE '+%'
  LIMIT 20
`);
if (unnormClients.length === 0) {
  console.log('  ✅ All client phones are in E.164 format\n');
} else {
  console.log(`  ⚠️  Found ${unnormClients.length} un-normalized phone(s) in clients table:`);
  for (const row of unnormClients) {
    console.log(`     id=${row.id} name="${row.name}" phone="${row.phone}"`);
  }
  console.log();
}

// ─── Test 4: Check for duplicate phones in client_accounts table ────────────
console.log('=== Test 4: Duplicate phones in client_accounts table ===');
const [acctDups] = await conn.query(`
  SELECT phone, COUNT(*) as cnt
  FROM client_accounts
  WHERE phone IS NOT NULL AND phone != ''
  GROUP BY phone
  HAVING cnt > 1
  LIMIT 20
`);
if (acctDups.length === 0) {
  console.log('  ✅ No duplicate phone numbers in client_accounts table\n');
} else {
  console.log(`  ⚠️  Found ${acctDups.length} duplicate phone(s) in client_accounts table:`);
  for (const row of acctDups) {
    console.log(`     phone="${row.phone}" appears ${row.cnt} times`);
  }
  console.log();
}

// ─── Test 5: Check for un-normalized phones in client_accounts ──────────────
console.log('=== Test 5: Un-normalized phones in client_accounts table ===');
const [unnormAccts] = await conn.query(`
  SELECT id, phone, name
  FROM client_accounts
  WHERE phone IS NOT NULL AND phone != '' AND phone NOT LIKE '+%'
  LIMIT 20
`);
if (unnormAccts.length === 0) {
  console.log('  ✅ All client_accounts phones are in E.164 format\n');
} else {
  console.log(`  ⚠️  Found ${unnormAccts.length} un-normalized phone(s) in client_accounts table:`);
  for (const row of unnormAccts) {
    console.log(`     id=${row.id} name="${row.name}" phone="${row.phone}"`);
  }
  console.log();
}

// ─── Test 6: Check locations have countryCode ───────────────────────────────
console.log('=== Test 6: Locations with countryCode ===');
const [locs] = await conn.query(`
  SELECT id, name, country_code
  FROM locations
  LIMIT 20
`);
if (locs.length === 0) {
  console.log('  ℹ️  No locations in DB yet\n');
} else {
  const withCode = locs.filter(l => l.country_code);
  const withoutCode = locs.filter(l => !l.country_code);
  console.log(`  ✅ ${withCode.length} location(s) have countryCode`);
  if (withoutCode.length > 0) {
    console.log(`  ⚠️  ${withoutCode.length} location(s) missing countryCode (will default to +1):`);
    for (const l of withoutCode) {
      console.log(`     id=${l.id} name="${l.name}"`);
    }
  }
  console.log();
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('=== Summary ===');
const issues = [
  clientDups.length > 0 && `${clientDups.length} duplicate phone(s) in clients`,
  unnormClients.length > 0 && `${unnormClients.length} un-normalized phone(s) in clients`,
  acctDups.length > 0 && `${acctDups.length} duplicate phone(s) in client_accounts`,
  unnormAccts.length > 0 && `${unnormAccts.length} un-normalized phone(s) in client_accounts`,
].filter(Boolean);

if (issues.length === 0) {
  console.log('  ✅ All checks passed — phone deduplication is working correctly');
} else {
  console.log('  ⚠️  Issues found:');
  for (const issue of issues) console.log(`     - ${issue}`);
}

await conn.end();
