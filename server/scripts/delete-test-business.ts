import "../../scripts/load-env.js";
import { getDb } from "../db.js";

const BIZ_ID = 1950003;

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB connection"); return; }

  // Delete in dependency order
  const tables = [
    "appointments",
    "services",
    "locations",
    "clients",
    "reviews",
    "promos",
    "staff",
    "packages",
    "service_photos",
    "client_accounts", // only those linked to this biz via clientRoutes
    "blocked_times",
    "messages",
    "gift_cards",
  ];

  for (const table of tables) {
    try {
      const result = await db.execute(
        `DELETE FROM ${table} WHERE businessOwnerId = ${BIZ_ID}`
      );
      const affected = (result[0] as any).affectedRows ?? 0;
      if (affected > 0) console.log(`Deleted ${affected} rows from ${table}`);
    } catch (e: any) {
      // Table may not have businessOwnerId column — skip silently
      if (!e.message?.includes("Unknown column")) {
        console.log(`Skipped ${table}: ${e.message}`);
      }
    }
  }

  // Finally delete the business owner row itself
  const res = await db.execute(`DELETE FROM business_owners WHERE id = ${BIZ_ID}`);
  console.log(`Deleted business_owners row: ${(res[0] as any).affectedRows} affected`);

  // Show remaining businesses
  console.log("\n=== Remaining businesses ===");
  const rows = await db.execute(
    "SELECT id, businessName, phone, email, address, lat, lng, clientPortalVisible FROM business_owners ORDER BY id"
  );
  const businesses = (rows[0] as unknown) as any[];
  for (const b of businesses) {
    console.log(JSON.stringify({
      id: b.id,
      name: b.businessName,
      phone: b.phone,
      email: b.email,
      address: b.address,
      lat: b.lat,
      lng: b.lng,
      clientPortalVisible: b.clientPortalVisible,
    }));
  }
}

main().catch(console.error).finally(() => process.exit(0));
