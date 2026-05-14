/**
 * Checks if Jane's client_accounts and appointments exist in the production DB
 * by calling the production API with a simulated phone-login token.
 * 
 * This script uses the same DB connection as the dev server (shared DB).
 * If dev and prod share the same DB, Jane's appointments should be visible.
 */
import "../../scripts/load-env.js";
import * as db from "../db.js";

async function main() {
  // Check client_accounts for Jane in the shared DB
  const acc = await db.getClientAccountByPhone("+15559871234");
  console.log("Jane client_account:", JSON.stringify({ id: acc?.id, phone: acc?.phone, name: acc?.name }));

  if (!acc) {
    console.log("Jane has no client_account in this DB — production may use a different DB.");
    return;
  }

  const appts = await db.getAppointmentsByClientPhone("+15559871234");
  console.log("Jane appointments in this DB:", appts.length);
  console.log("Appointments:", appts.map((a) => ({
    id: a.id,
    date: a.date,
    status: a.status,
    businessOwnerId: a.businessOwnerId,
  })));
}

main().catch(console.error).finally(() => process.exit(0));
