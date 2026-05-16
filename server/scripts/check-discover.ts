import "../../scripts/load-env.js";
import { getDb } from "../db.js";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB connection"); return; }

  // First check actual columns
  const descRows = await db.execute("DESCRIBE business_owners");
  const cols = (descRows[0] as any[]).map((c: any) => c.Field);
  console.log("business_owners columns:", cols.join(", "));

  const rows = await db.execute(
    "SELECT id, businessName, clientPortalVisible, lat, lng, address FROM business_owners WHERE clientPortalVisible = 1"
  );
  const businesses = rows[0] as any[];
  console.log(`Discoverable businesses: ${businesses.length}`);
  for (const b of businesses) {
    console.log(JSON.stringify({
      id: b.id,
      name: b.businessName,
      lat: b.lat,
      lng: b.lng,
      address: b.address,
    }));
  }

  // Also check locations for these businesses
  if (businesses.length > 0) {
    const ids = businesses.map((b: any) => b.id).join(",");
    const locRows = await db.execute(
      `SELECT businessOwnerId, name, address, city, state, lat, lng, isDefault FROM locations WHERE businessOwnerId IN (${ids})`
    );
    const locs = locRows[0] as any[];
    console.log(`\nLocations for these businesses: ${locs.length}`);
    for (const l of locs) {
      console.log(JSON.stringify(l));
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
