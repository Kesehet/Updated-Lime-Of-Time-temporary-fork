/**
 * Apply the composite unique index on clients(businessOwnerId, phone).
 * Safe to run multiple times — skips if the index already exists.
 */
import "../../scripts/load-env.js";
import mysql2 from "mysql2/promise";

async function run() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

  // Check if index already exists
  const [existing] = await conn.execute<mysql2.RowDataPacket[]>(
    "SHOW INDEX FROM clients WHERE Key_name = 'clients_businessOwnerId_phone_unique'"
  );

  if (existing.length > 0) {
    console.log("✅ Index clients_businessOwnerId_phone_unique already exists — nothing to do.");
    await conn.end();
    return;
  }

  // Apply the constraint
  console.log("Applying unique index on clients(businessOwnerId, phone)...");
  await conn.execute(
    "ALTER TABLE `clients` ADD CONSTRAINT `clients_businessOwnerId_phone_unique` UNIQUE(`businessOwnerId`,`phone`)"
  );
  console.log("✅ Index applied successfully.");

  // Verify
  const [verify] = await conn.execute<mysql2.RowDataPacket[]>(
    "SHOW INDEX FROM clients WHERE Key_name = 'clients_businessOwnerId_phone_unique'"
  );
  if (verify.length > 0) {
    console.log(`   Confirmed: Key_name=${verify[0].Key_name} | Non_unique=${verify[0].Non_unique} | Columns: ${verify.map((r: any) => r.Column_name).join(", ")}`);
  }

  // Also record this migration in the drizzle migrations table so drizzle-kit knows it was applied
  try {
    await conn.execute(
      "INSERT IGNORE INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)",
      ["0083_uneven_deathbird", Date.now()]
    );
    console.log("   Migration recorded in __drizzle_migrations.");
  } catch (e) {
    // Table may not exist or have different schema — non-fatal
    console.log("   Note: could not record in __drizzle_migrations (non-fatal).");
  }

  await conn.end();
}

run().catch(console.error);
