import "../../scripts/load-env.js";
import { getDb } from "../db.js";

async function main() {
  const drizzleDb = await getDb();
  if (!drizzleDb) { console.log("No DB connection"); return; }

  // Find the clientLocalId for Jane's phone from the clients table
  const clientRows = await drizzleDb.execute(
    "SELECT id, localId, phone, name FROM clients WHERE phone IN ('+15559871234', '5559871234')"
  );
  const clients = clientRows[0] as any[];
  console.log("Client rows:", clients.map((c: any) => ({ id: c.id, localId: c.localId, phone: c.phone, name: c.name })));

  const localIds: string[] = clients.map((c: any) => c.localId).filter(Boolean);
  console.log("LocalIds to delete appointments for:", localIds);

  if (localIds.length === 0) {
    console.log("No client rows found.");
    return;
  }

  // Use string interpolation (safe since localIds come from our own DB)
  const localIdList = localIds.map((id) => `'${id}'`).join(",");

  // Find appointments by clientLocalId
  const apptRows = await drizzleDb.execute(
    `SELECT id, date, status, clientLocalId FROM appointments WHERE clientLocalId IN (${localIdList})`
  );
  const appts = (apptRows[0] as unknown) as any[];
  console.log("Appointments found:", appts.length);
  console.log("Details:", appts.map((a: any) => ({ id: a.id, date: a.date, status: a.status })));

  if (appts.length === 0) {
    console.log("No appointments to delete.");
    return;
  }

  const ids = (appts as any[]).map((a: any) => a.id);
  const idList = ids.join(",");
  await drizzleDb.execute(`DELETE FROM appointments WHERE id IN (${idList})`);
  console.log(`Successfully deleted ${ids.length} appointments for (555) 987-1234`);
}

main().catch(console.error).finally(() => process.exit(0));
