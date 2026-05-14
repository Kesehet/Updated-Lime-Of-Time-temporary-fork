/**
 * One-time migration script: normalize all phone numbers in client_accounts,
 * business_owners, and clients tables to E.164 format (+countrycode+number).
 *
 * Run with:
 *   npx tsx server/scripts/normalize-phones.ts
 *
 * Safe to run multiple times — already-normalized rows are skipped.
 * Duplicate merging: if normalizing a bare number produces a phone that already
 * exists in the table, the bare-phone row's data is merged into the E.164 row
 * (keeping the richer record) and the bare-phone row is deleted.
 */

import "../../scripts/load-env.js";
import mysql2 from "mysql2/promise";

function normalizePhone(phone: string): string {
  if (!phone || phone.startsWith("oauth:")) return phone;
  if (phone.trim().startsWith("+")) {
    // Already has country code — strip formatting only
    return "+" + phone.replace(/\D/g, "");
  }
  const digits = phone.replace(/\D/g, "");
  // 11-digit starting with 1 → US/Canada E.164
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  // 10-digit → assume US/Canada (+1)
  if (digits.length === 10) return "+1" + digits;
  // Anything else: prepend + and hope for the best (international bare number)
  return "+" + digits;
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const conn = await mysql2.createConnection(url);
  console.log("Connected to database.\n");

  // ── 1. client_accounts ────────────────────────────────────────────────────
  console.log("=== client_accounts ===");
  const [caRows] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT id, phone, name, email FROM client_accounts"
  );
  let caFixed = 0, caMerged = 0, caSkipped = 0;
  for (const row of caRows) {
    const orig = row.phone as string;
    if (!orig || orig.startsWith("oauth:") || orig.startsWith("+")) { caSkipped++; continue; }
    const normalized = normalizePhone(orig);
    if (normalized === orig) { caSkipped++; continue; }

    // Check if a row with the normalized phone already exists
    const [existing] = await conn.execute<mysql2.RowDataPacket[]>(
      "SELECT id, name, email FROM client_accounts WHERE phone = ? LIMIT 1",
      [normalized]
    );
    if (existing.length > 0) {
      const target = existing[0];
      // Merge: keep the richer name/email, then delete the bare-phone row
      const mergedName = target.name || row.name || null;
      const mergedEmail = target.email || row.email || null;
      await conn.execute(
        "UPDATE client_accounts SET name = ?, email = ? WHERE id = ?",
        [mergedName, mergedEmail, target.id]
      );
      // Reassign any foreign-key references from the bare-phone row to the E.164 row
      await conn.execute(
        "UPDATE appointments SET client_account_id = ? WHERE client_account_id = ?",
        [target.id, row.id]
      ).catch(() => {});
      await conn.execute(
        "UPDATE client_messages SET client_account_id = ? WHERE client_account_id = ?",
        [target.id, row.id]
      ).catch(() => {});
      await conn.execute("DELETE FROM client_accounts WHERE id = ?", [row.id]);
      console.log(`  MERGED  id=${row.id} phone="${orig}" → id=${target.id} phone="${normalized}"`);
      caMerged++;
    } else {
      await conn.execute(
        "UPDATE client_accounts SET phone = ? WHERE id = ?",
        [normalized, row.id]
      );
      console.log(`  UPDATED id=${row.id} "${orig}" → "${normalized}"`);
      caFixed++;
    }
  }
  console.log(`  Done: ${caFixed} updated, ${caMerged} merged, ${caSkipped} already OK\n`);

  // ── 2. business_owners ────────────────────────────────────────────────────
  console.log("=== business_owners ===");
  const [boRows] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT id, phone FROM business_owners WHERE phone IS NOT NULL"
  );
  let boFixed = 0, boSkipped = 0;
  for (const row of boRows) {
    const orig = row.phone as string;
    if (!orig || orig.startsWith("+")) { boSkipped++; continue; }
    const normalized = normalizePhone(orig);
    if (normalized === orig) { boSkipped++; continue; }
    await conn.execute("UPDATE business_owners SET phone = ? WHERE id = ?", [normalized, row.id]);
    console.log(`  UPDATED id=${row.id} "${orig}" → "${normalized}"`);
    boFixed++;
  }
  console.log(`  Done: ${boFixed} updated, ${boSkipped} already OK\n`);

  // ── 3. clients ────────────────────────────────────────────────────────────
  console.log("=== clients ===");
  const [cRows] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT id, phone FROM clients WHERE phone IS NOT NULL AND phone != ''"
  );
  let cFixed = 0, cSkipped = 0;
  for (const row of cRows) {
    const orig = row.phone as string;
    if (!orig || orig.startsWith("+")) { cSkipped++; continue; }
    const normalized = normalizePhone(orig);
    if (normalized === orig) { cSkipped++; continue; }
    await conn.execute("UPDATE clients SET phone = ? WHERE id = ?", [normalized, row.id]);
    console.log(`  UPDATED id=${row.id} "${orig}" → "${normalized}"`);
    cFixed++;
  }
  console.log(`  Done: ${cFixed} updated, ${cSkipped} already OK\n`);

  await conn.end();
  console.log("Migration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
