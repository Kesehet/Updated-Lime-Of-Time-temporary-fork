/**
 * One-time migration: merge duplicate client_accounts records that have the same
 * phone number stored in different formats (e.g. "5559871234" vs "+15559871234").
 *
 * For each pair of duplicates:
 * 1. Keep the record with the normalized E.164 phone (starts with "+")
 * 2. Re-point all foreign key references from the duplicate to the canonical record
 * 3. Delete the duplicate
 *
 * Tables with clientAccountId FK:
 *   - client_messages
 *   - client_saved_businesses
 *   - gift_certificate_recipients
 *   - client_packages
 */
import { createConnection } from "mysql2/promise";
import "../scripts/load-env.js";

function normalizePhone(phone: string, countryCode = "+1"): string {
  if (phone.trim().startsWith("+")) {
    return "+" + phone.replace(/\D/g, "");
  }
  const digits = phone.replace(/\D/g, "");
  const cc = countryCode.trim().startsWith("+") ? countryCode.trim() : "+" + countryCode.trim();
  const ccDigits = cc.slice(1);
  if (digits.startsWith(ccDigits) && digits.length > ccDigits.length) {
    const remaining = digits.slice(ccDigits.length);
    if (remaining.length >= 6 && remaining.length <= 12) {
      return cc + remaining;
    }
  }
  return cc + digits;
}

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);
  console.log("Connected to DB");

  // Fetch all non-oauth client accounts
  const [rows] = await conn.execute(
    "SELECT id, phone, name, email FROM client_accounts WHERE phone NOT LIKE 'oauth:%' ORDER BY id"
  ) as any[];

  // Group by normalized phone
  const groups = new Map<string, { id: number; phone: string; name: string | null; email: string | null }[]>();
  for (const row of rows) {
    const norm = normalizePhone(row.phone);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(row);
  }

  let mergeCount = 0;
  for (const [normPhone, accounts] of groups) {
    if (accounts.length <= 1) continue;

    // Prefer the record that already has the + prefix (canonical E.164)
    const canonical = accounts.find(a => a.phone.startsWith("+")) ?? accounts[0];
    const duplicates = accounts.filter(a => a.id !== canonical.id);

    console.log(`\nMerging ${accounts.length} accounts for phone ${normPhone}`);
    console.log(`  Canonical: id=${canonical.id}, phone="${canonical.phone}", name="${canonical.name}"`);

    for (const dup of duplicates) {
      console.log(`  Duplicate: id=${dup.id}, phone="${dup.phone}", name="${dup.name}"`);

      // Re-point FK references
      const tables = [
        "client_messages",
        "client_saved_businesses",
        "gift_certificate_recipients",
        "client_packages",
      ];
      for (const table of tables) {
        const [result] = await conn.execute(
          `UPDATE ${table} SET clientAccountId = ? WHERE clientAccountId = ?`,
          [canonical.id, dup.id]
        ) as any[];
        if (result.affectedRows > 0) {
          console.log(`    Re-pointed ${result.affectedRows} row(s) in ${table}`);
        }
      }

      // Delete the duplicate
      await conn.execute("DELETE FROM client_accounts WHERE id = ?", [dup.id]);
      console.log(`  Deleted duplicate id=${dup.id}`);
      mergeCount++;
    }

    // Ensure canonical phone is in E.164 format
    if (canonical.phone !== normPhone) {
      await conn.execute("UPDATE client_accounts SET phone = ? WHERE id = ?", [normPhone, canonical.id]);
      console.log(`  Updated canonical phone: "${canonical.phone}" → "${normPhone}"`);
    }
  }

  console.log(`\nDone. Merged ${mergeCount} duplicate account(s).`);
  await conn.end();
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
