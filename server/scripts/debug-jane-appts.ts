import "../../scripts/load-env.js";
import * as db from "../db.js";

async function main() {
  const clientAccount = await db.getClientAccountByPhone("+15559871234");
  console.log("clientAccount:", JSON.stringify({ id: clientAccount?.id, phone: clientAccount?.phone, name: clientAccount?.name }));

  if (!clientAccount) { console.log("No account found"); return; }

  let phone: string | null = clientAccount.phone.startsWith("oauth:")
    ? clientAccount.email
    : clientAccount.phone;
  console.log("phone before normalize:", phone);

  if (!phone) { console.log("No phone, returning []"); return; }

  phone = db.normalizePhone(phone);
  console.log("phone after normalize:", phone);

  const rawAppts = await db.getAppointmentsByClientPhone(phone);
  console.log("appointments found:", rawAppts.length);
  console.log("sample:", rawAppts.slice(0, 3).map((a) => ({
    id: a.id,
    date: a.date,
    status: a.status,
    clientLocalId: a.clientLocalId,
    businessOwnerId: a.businessOwnerId,
  })));
}

main().catch(console.error).finally(() => process.exit(0));
