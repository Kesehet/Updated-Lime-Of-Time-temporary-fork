// Script to update Wellness Suite address and re-geocode
import "./load-env.js";
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Parse mysql2 connection URL
const url = new URL(DB_URL.replace(/^mysql:\/\//, "http://"));
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
});

// Use known coordinates for Pittsburgh 15237 (North Hills/McCandless area)
// Nominatim doesn't have 134 Locust Ct in its DB, so we use the zip centroid
const newAddress = "134 Locust Ct, Pittsburgh, PA 15237";
// 15237 zip code centroid (North Hills Pittsburgh)
const lat = 40.5534;
const lng = -80.0076;
console.log(`Using coordinates for 15237: lat=${lat}, lng=${lng}`);

// Find Wellness Suite business owner
const [owners] = await conn.execute(
  "SELECT id, businessName, address, lat, lng FROM business_owners WHERE businessName LIKE '%Wellness%' LIMIT 5"
);
console.log("Found businesses:", owners);

if (!owners.length) {
  console.error("No Wellness Suite found");
  await conn.end();
  process.exit(1);
}

const owner = owners[0];
console.log(`Updating business ID ${owner.id}: ${owner.businessName}`);
console.log(`  Old address: ${owner.address} | lat: ${owner.lat} | lng: ${owner.lng}`);

// Update business owner address and coordinates
await conn.execute(
  "UPDATE business_owners SET address=?, lat=?, lng=? WHERE id=?",
  [newAddress, lat, lng, owner.id]
);

// Also update all locations for this business
const [locs] = await conn.execute(
  "SELECT localId, address, city, state, zipCode FROM locations WHERE businessOwnerId=?",
  [owner.id]
);
console.log(`Found ${locs.length} locations for this business`);
for (const loc of locs) {
  console.log(`  Location ${loc.localId}: ${loc.address}, ${loc.city}, ${loc.state} ${loc.zipCode}`);
  await conn.execute(
    "UPDATE locations SET address=?, city=?, state=?, zipCode=?, lat=?, lng=? WHERE localId=?",
    ["134 Locust Ct", "Pittsburgh", "PA", "15237", lat, lng, loc.localId]
  );
  console.log(`  Updated location ${loc.localId}`);
}

console.log(`\nDone! Wellness Suite address updated to: ${newAddress}`);
console.log(`New coordinates: lat=${lat}, lng=${lng}`);
await conn.end();
