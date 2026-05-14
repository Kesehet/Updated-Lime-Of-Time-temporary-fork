/**
 * Client Reminder Cron
 *
 * Runs every 30 minutes and sends in-app messages to clients
 * who have a client portal account for their upcoming confirmed appointments.
 *
 * Reminder windows:
 *   - 24 hours before appointment
 *   - 1 hour before appointment
 *
 * Each reminder is sent only once per appointment (tracked via clientReminderFlags JSON column).
 * The message uses the same full professional format as the manual "Send Reminder" feature:
 * Dear {clientName}, service, date, time, location, pricing block, business name, phone, footer.
 */
import { getDb, insertClientMessage, getClientAccountByPhone, normalizePhone } from "./db";
import {
  appointments,
  businessOwners,
  clients,
  services,
  locations,
} from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

// ─── Formatting helpers (mirrored from lib/types.ts — no React Native deps) ───

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeDisplay(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDateLong(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatFullAddress(address: string, city?: string, state?: string, zipCode?: string): string {
  const streetPart = address?.trim() || "";
  const stateZip = [state?.trim(), zipCode?.trim()].filter(Boolean).join(" ");
  const cityStatePart = [city?.trim(), stateZip].filter(Boolean).join(", ");
  return [streetPart, cityStatePart].filter(Boolean).join(", ");
}

function formatPhoneNumber(value: string): string {
  let digits = value.replace(/\D/g, "");
  const hasPlus1 = value.replace(/\s/g, "").startsWith("+1");
  let prefix = "";
  if (hasPlus1 || (digits.length === 11 && digits.startsWith("1"))) {
    prefix = "+1 ";
    if (digits.startsWith("1") && digits.length > 10) digits = digits.slice(1);
  }
  const limited = digits.slice(0, 10);
  if (limited.length === 0) return prefix ? "+1" : "";
  if (limited.length <= 3) return `${prefix}(${limited}`;
  if (limited.length <= 6) return `${prefix}(${limited.slice(0, 3)}) ${limited.slice(3)}`;
  return `${prefix}(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
}

function stripPhoneFormat(formatted: string): string {
  return formatted.replace(/\D/g, "");
}

const LIME_OF_TIME_FOOTER = "\n\n— Powered by Lime Of Time";

function appendLimeFooter(body: string): string {
  const footer = LIME_OF_TIME_FOOTER.trim();
  if (body.trimEnd().endsWith(footer)) return body;
  return body.trimEnd() + LIME_OF_TIME_FOOTER;
}

/** Build the smart pricing block (subtotal / discount / gift / amount due) */
function buildPriceLine(opts: {
  totalPrice?: number | null;
  discountAmount?: number | null;
  discountName?: string | null;
  giftUsedAmount?: number | null;
  paymentStatus?: string | null;
}): string {
  const { totalPrice, discountAmount, discountName, giftUsedAmount, paymentStatus } = opts;
  const hasDiscount = discountAmount != null && discountAmount > 0;
  const hasGift = giftUsedAmount != null && giftUsedAmount > 0;
  const isPaid = paymentStatus === "paid";
  const totalLabel = isPaid ? "Total Paid" : "Amount Due";

  if (!hasDiscount && !hasGift) {
    if (totalPrice != null) return `💰 ${totalLabel}: $${Number(totalPrice).toFixed(2)}`;
    return "💰 Total: See invoice";
  }

  const lines: string[] = [];
  if (totalPrice != null) {
    const subtotal = Number(totalPrice) + Number(discountAmount ?? 0) + Number(giftUsedAmount ?? 0);
    lines.push(`💰 Subtotal: $${subtotal.toFixed(2)}`);
    if (hasDiscount) {
      const label = discountName ? `Discount (${discountName})` : "Discount";
      lines.push(`🏷️ ${label}: -$${Number(discountAmount).toFixed(2)}`);
    }
    if (hasGift) {
      lines.push(`🎁 Gift Card Applied: -$${Number(giftUsedAmount).toFixed(2)}`);
    }
    lines.push(`✅ ${totalLabel}: $${Number(totalPrice).toFixed(2)}`);
  } else {
    lines.push("💰 Total: See invoice");
  }
  return lines.join("\n");
}

/** Replace {variable} placeholders in a template string */
function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/**
 * Build the full professional reminder message body.
 * Mirrors the logic in send-reminder.tsx / generateReminderMessage in lib/types.ts.
 */
function buildReminderMessage(opts: {
  clientName: string;
  serviceName: string;
  serviceDuration: number;
  date: string;
  time: string;
  locationLine: string;
  priceLine: string;
  businessName: string;
  phoneFormatted: string;
  windowKey: "sent24h" | "sent1h";
  customReminderTemplate?: string | null;
}): string {
  const {
    clientName, serviceName, serviceDuration, date, time,
    locationLine, priceLine, businessName, phoneFormatted,
    windowKey, customReminderTemplate,
  } = opts;

  const endTime = formatTimeDisplay(minutesToTime(timeToMinutes(time) + serviceDuration));
  const dateStr = formatDateLong(date);
  const timeStr = formatTimeDisplay(time);
  const timeRange = `${timeStr} – ${endTime}`;

  // If the business has a custom smsTemplates.reminder, use it
  if (customReminderTemplate) {
    const vars: Record<string, string> = {
      clientName,
      service: serviceName,
      serviceName,
      date: dateStr,
      time: timeRange,
      location: locationLine,
      priceLine,
      businessName,
      phone: phoneFormatted,
    };
    return appendLimeFooter(applyTemplate(customReminderTemplate, vars));
  }

  // Default templates matching the DEFAULT_REMINDER_TEMPLATES in lib/types.ts
  let body: string;
  if (windowKey === "sent24h") {
    body =
      `Dear ${clientName},\n\n` +
      `This is your 24-hour reminder for your appointment tomorrow. We look forward to seeing you!\n\n` +
      `📋 Service: ${serviceName}\n` +
      `📅 Date: ${dateStr}\n` +
      `⏰ Time: ${timeRange}\n` +
      `📍 Location: ${locationLine}\n` +
      `${priceLine}\n` +
      `🏢 ${businessName}\n` +
      `📞 ${phoneFormatted}\n\n` +
      `Please arrive 5 minutes early. If you need to reschedule or cancel, contact us as soon as possible.`;
  } else {
    // sent1h
    body =
      `Dear ${clientName},\n\n` +
      `Your appointment is in 1 hour. Please start making your way over.\n\n` +
      `📋 Service: ${serviceName}\n` +
      `📅 Date: ${dateStr}\n` +
      `⏰ Time: ${timeRange}\n` +
      `📍 Location: ${locationLine}\n` +
      `${priceLine}\n` +
      `🏢 ${businessName}\n` +
      `📞 ${phoneFormatted}\n\n` +
      `Please arrive a few minutes early. If you need to reschedule, contact us right away.`;
  }
  return appendLimeFooter(body);
}

/** Reminder windows: [key, minutes before appointment, label]
 *  windowMinutes = ±15 min (cron runs every 30 min, so we fire within 15 min of the exact time)
 */
const REMINDER_WINDOWS = [
  { key: "sent24h" as const, minutesBefore: 24 * 60, label: "24 hours", windowMinutes: 30 },
  { key: "sent1h"  as const, minutesBefore: 60,       label: "1 hour",   windowMinutes: 30 },
];

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

    // Batch fetch all related data — include phone + smsTemplates for owner
    const [ownerRows, clientRows, serviceRows] = await Promise.all([
      db.select({
        id: businessOwners.id,
        businessName: businessOwners.businessName,
        phone: businessOwners.phone,
        address: businessOwners.address,
        notificationsEnabled: businessOwners.notificationsEnabled,
        notificationPreferences: businessOwners.notificationPreferences,
        smsTemplates: businessOwners.smsTemplates,
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
      const normPhone = normalizePhone(client.phone);
      const clientAcc = await getClientAccountByPhone(normPhone);
      if (!clientAcc) continue;

      // Parse existing reminder flags
      const flags = ((appt as any).clientReminderFlags ?? {}) as Record<string, boolean>;

      // Build appointment datetime
      const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
      const minutesUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60);

      // ── Build location line ──────────────────────────────────────────
      const locName = location?.name ?? "";
      const locAddr = formatFullAddress(
        location?.address ?? "",
        location?.city ?? "",
        location?.state ?? "",
        location?.zipCode ?? "",
      );
      const ownerAddr = (owner as any).address ?? "";
      const locationLine = locName || locAddr
        ? locName
          ? (locAddr ? `${locName} — ${locAddr}` : locName)
          : locAddr
        : ownerAddr;

      // ── Build phone ──────────────────────────────────────────────────
      const rawPhone = (location as any)?.phone || (owner as any)?.phone || "";
      const phoneFormatted = formatPhoneNumber(stripPhoneFormat(rawPhone));

      // ── Build pricing block ──────────────────────────────────────────
      const priceLine = buildPriceLine({
        totalPrice: (appt as any).totalPrice != null ? Number((appt as any).totalPrice) : null,
        discountAmount: (appt as any).discountAmount != null ? Number((appt as any).discountAmount) : null,
        discountName: (appt as any).discountName ?? null,
        giftUsedAmount: (appt as any).giftUsedAmount != null ? Number((appt as any).giftUsedAmount) : null,
        paymentStatus: (appt as any).paymentStatus ?? null,
      });

      const serviceName = service?.name ?? "your appointment";
      const serviceDuration = service?.duration ?? appt.duration ?? 60;
      const customReminderTpl = ((owner as any).smsTemplates as any)?.reminder ?? null;

      // Check each reminder window
      for (const window of REMINDER_WINDOWS) {
        if (flags[window.key]) continue; // already sent

        const windowStart = window.minutesBefore;
        const windowEnd = window.minutesBefore - window.windowMinutes;

        // Check if appointment falls within this reminder window
        if (minutesUntil <= windowStart && minutesUntil > windowEnd) {
          const msgBody = buildReminderMessage({
            clientName: client.name,
            serviceName,
            serviceDuration,
            date: appt.date,
            time: appt.time,
            locationLine,
            priceLine,
            businessName: owner.businessName,
            phoneFormatted,
            windowKey: window.key,
            customReminderTemplate: customReminderTpl,
          });

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
