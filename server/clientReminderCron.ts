/**
 * Client Reminder Cron
 *
 * Runs every 30 minutes and sends in-app messages to clients
 * who have a client portal account for their upcoming confirmed appointments.
 *
 * Reminder windows:
 *   - 24 hours before appointment
 *   - 1 hour before appointment
 *   - 30 minutes before appointment
 *
 * Each reminder is sent only once per appointment (tracked via clientReminderFlags JSON column).
 * The message includes the service name, date, time, and location.
 */
import { getDb, insertClientMessage, getClientAccountByPhone } from "./db";
import {
  appointments,
  businessOwners,
  clients,
  services,
  locations,
} from "../drizzle/schema";
import { and, eq, inArray, gte, lte } from "drizzle-orm";

/** Format HH:MM → "10:30 AM" */
function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Format YYYY-MM-DD → "Thursday, April 17, 2026" */
function formatDate(date: string): string {
  const d = new Date(date + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Reminder windows: [key, minutes before appointment, label]
 *  windowMinutes = ±15 min (cron runs every 30 min, so we fire within 15 min of the exact time)
 */
const REMINDER_WINDOWS = [
  { key: "sent24h", minutesBefore: 24 * 60, label: "24 hours", windowMinutes: 30 },
  { key: "sent1h",  minutesBefore: 60,       label: "1 hour",   windowMinutes: 30 },
] as const;

async function sendClientReminders() {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  // Fetch confirmed appointments in the next 25 hours (covers all windows)
  const maxWindowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const endDate = maxWindowEnd.toISOString().slice(0, 10);
  const startDate = now.toISOString().slice(0, 10);

  try {
    // Fetch all confirmed appointments in the date range
    const targetAppts = await db
      .select()
      .from(appointments)
      .where(eq(appointments.status, "confirmed"));

    const rangeAppts = targetAppts.filter(
      (a) => a.date >= startDate && a.date <= endDate
    );

    if (rangeAppts.length === 0) return;

    // Collect unique IDs for batch fetching
    const ownerIds = [...new Set(rangeAppts.map((a) => a.businessOwnerId))];
    const clientLocalIds = [...new Set(rangeAppts.map((a) => a.clientLocalId))];
    const serviceLocalIds = [...new Set(rangeAppts.map((a) => a.serviceLocalId))];
    const locationIds = [...new Set(rangeAppts.map((a) => a.locationId).filter(Boolean))] as string[];

    // Batch fetch all related data
    const [ownerRows, clientRows, serviceRows] = await Promise.all([
      db.select({
        id: businessOwners.id,
        businessName: businessOwners.businessName,
        address: businessOwners.address,
        notificationsEnabled: businessOwners.notificationsEnabled,
        notificationPreferences: businessOwners.notificationPreferences,
      }).from(businessOwners).where(inArray(businessOwners.id, ownerIds)),
      db.select().from(clients).where(inArray(clients.localId, clientLocalIds)),
      db.select().from(services).where(inArray(services.localId, serviceLocalIds)),
    ]);

    let locationRows: (typeof locations.$inferSelect)[] = [];
    if (locationIds.length > 0) {
      locationRows = await db.select().from(locations).where(inArray(locations.localId, locationIds));
    }

    const ownerMap = new Map(ownerRows.map((o) => [o.id, o]));
    const clientMap = new Map(clientRows.map((c) => [c.localId, c]));
    const serviceMap = new Map(serviceRows.map((s) => [s.localId, s]));
    const locationMap = new Map(locationRows.map((l) => [l.localId, l]));

    let msgSent = 0;

    for (const appt of rangeAppts) {
      const owner = ownerMap.get(appt.businessOwnerId);
      const client = clientMap.get(appt.clientLocalId);
      const service = serviceMap.get(appt.serviceLocalId);
      const location = appt.locationId ? locationMap.get(appt.locationId) : undefined;

      if (!owner || !client?.phone) continue;

      // Check if owner has notifications enabled
      const masterEnabled = (owner as any).notificationsEnabled !== false;
      if (!masterEnabled) continue;

      // Get client portal account
      const rawDigits = client.phone.replace(/\D/g, "");
      const normPhone = rawDigits.length === 11 && rawDigits.startsWith("1") ? rawDigits.slice(1) : rawDigits;
      const clientAcc = await getClientAccountByPhone(normPhone)
        ?? await getClientAccountByPhone(client.phone);
      if (!clientAcc) continue;

      // Parse existing reminder flags
      const flags = ((appt as any).clientReminderFlags ?? {}) as Record<string, boolean>;

      // Build appointment datetime
      const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
      const minutesUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60);

      // Build location line (full address + zip for in-store services)
      const locName = location?.name ?? "";
      const locAddrParts = [location?.address, location?.city, location?.state, location?.zipCode].filter(Boolean);
      const locAddr = locAddrParts.join(", ");
      const ownerAddrParts = [(owner as any).address, (owner as any).city, (owner as any).state].filter(Boolean);
      const ownerAddr = ownerAddrParts.join(", ");
      const locLine = locName || locAddr
        ? `\n📍 ${locName}${locAddr ? (locName ? " — " : "") + locAddr : ""}`
        : (ownerAddr ? `\n📍 ${ownerAddr}` : "");
      // Build phone line
      const locPhone = (location as any)?.phone || (owner as any)?.phone || "";
      const phoneDigits = locPhone.replace(/\D/g, "");
      const phoneFormatted = phoneDigits.length === 10
        ? `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`
        : locPhone;
      const phoneLine = phoneFormatted ? `\n📞 ${phoneFormatted}` : "";

      const serviceName = service?.name ?? "appointment";
      const dateStr = formatDate(appt.date);
      const timeStr = formatTime(appt.time);
      const bName = owner.businessName;

      // Check each reminder window
      for (const window of REMINDER_WINDOWS) {
        if (flags[window.key]) continue; // already sent

        const windowStart = window.minutesBefore;
        const windowEnd = window.minutesBefore - window.windowMinutes;

        // Check if appointment falls within this reminder window
        if (minutesUntil <= windowStart && minutesUntil > windowEnd) {
          // Build the message
          let msgBody = "";
          if (window.key === "sent24h") {
            msgBody = `⏰ Gentle Reminder: Your ${serviceName} appointment is tomorrow!\n\n📅 ${dateStr}\n🕐 ${timeStr}${locLine}${phoneLine}\n\nPlease reply here if you need to make any changes. We look forward to seeing you! — ${bName}`;
          } else if (window.key === "sent1h") {
            msgBody = `⏰ Your ${serviceName} appointment is in 1 hour!\n\n📅 Today, ${timeStr}${locLine}${phoneLine}\n\nWe're looking forward to seeing you! — ${bName}`;
          }

          if (msgBody) {
            try {
              await insertClientMessage({
                businessOwnerId: appt.businessOwnerId,
                clientAccountId: clientAcc.id,
                senderType: "business",
                body: msgBody,
              });

              // Update flags in DB
              const newFlags = { ...flags, [window.key]: true };
              await db.update(appointments)
                .set({ clientReminderFlags: newFlags } as any)
                .where(eq(appointments.localId, appt.localId));

              flags[window.key] = true;
              msgSent++;
              console.log(`[ClientReminderCron] Sent ${window.label} reminder to client ${clientAcc.id} for appt ${appt.localId}`);
            } catch (err) {
              console.warn(`[ClientReminderCron] Failed to send ${window.label} reminder for appt ${appt.localId}:`, err);
            }
          }
        }
      }
    }

    if (msgSent > 0) {
      console.log(`[ClientReminderCron] Sent ${msgSent} client reminder messages`);
    }
  } catch (err) {
    console.error("[ClientReminderCron] Error:", err);
  }
}

/**
 * Start the client reminder cron.
 * Runs every 30 minutes to check for upcoming appointments.
 */
export function startClientReminderCron() {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  console.log("[ClientReminderCron] Started — checking every 30 minutes for 24h/1h/30min client reminders");
  // Run immediately on startup
  sendClientReminders().catch(console.error);
  // Then run every 30 minutes
  setInterval(() => {
    sendClientReminders().catch(console.error);
  }, INTERVAL_MS);
}
