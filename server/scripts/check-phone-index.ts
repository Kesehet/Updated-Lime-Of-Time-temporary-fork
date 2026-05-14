import "../../scripts/load-env.js";
import mysql2 from "mysql2/promise";

async function run() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute<mysql2.RowDataPacket[]>(
    "SHOW INDEX FROM client_accounts WHERE Key_name = 'client_accounts_phone_unique'"
  );
  if (rows.length > 0) {
    console.log("✅ UNIQUE index confirmed on client_accounts.phone");
    console.log(`   Key: ${rows[0].Key_name} | Non_unique: ${rows[0].Non_unique} | Column: ${rows[0].Column_name}`);
  } else {
    console.log("❌ UNIQUE index NOT found — needs to be added");
  }
  await conn.end();
}

run().catch(console.error);
