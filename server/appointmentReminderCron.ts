/**
 * Appointment Reminder Cron
 *
 * Runs every hour and sends reminder emails/push notifications for upcoming confirmed appointments.
 * Each business can configure how far in advance to send the reminder (reminderHoursBefore):
 *   12h, 24h (default), 48h, 72h, or 168h (1 week).
 *
 * For each confirmed appointment in the reminder window:
 *   - Sends a push notification to the business owner's device
 *   - Sends a reminder email to the client (if they have an email on file)
 *
 * Dedup: appointments.reminderSentAt is set after a reminder is sent.
 * If reminderSentAt is within the last 2 hours, the reminder is skipped.
 * This prevents duplicate notifications when the server restarts within the same window.
 */
import { getDb } from "./db";
import {
  appointments,
  businessOwners,
  clients,
  services,
  locations,
} from "../drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { sendExpoPush } from "./push";
import { sendAppointmentReminderEmail } from "./email";

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

/** Supported reminder windows in hours */
const SUPPORTED_WINDOWS = [12, 24, 48, 72, 168] as const;

/**
 * Check if an appointment falls within the reminder window for a given reminderHoursBefore value.
 * The window is [reminderHoursBefore, reminderHoursBefore + 1) hours from now.
 */
function isInReminderWindow(
  apptDate: string,
  apptTime: string,
  reminderHours: number,
  now: Date
): boolean {
  const windowStart = new Date(now.getTime() + reminderHours * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (reminderHours + 1) * 60 * 60 * 1000);

  // Build appointment datetime in local server time.
  // Using "T" + time + ":00" directly avoids the midnight UTC offset bug
  // that caused 24h reminders to fire 26-27h early when server is in UTC.
  const apptDateObj = new Date(`${apptDate}T${apptTime}:00`);

  return apptDateObj >= windowStart && apptDateObj < windowEnd;
}

async function sendAppointmentReminders() {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  // We need to cover all possible reminder windows (12h–168h).
  // Fetch confirmed appointments in the next 170 hours (max window + 2h buffer).
  const maxWindowEnd = new Date(now.getTime() + 170 * 60 * 60 * 1000);
  const minWindowStart = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  // Get the date range to query
  const startDate = minWindowStart.toISOString().slice(0, 10);
  const endDate = maxWindowEnd.toISOString().slice(0, 10);

  try {
    // Fetch all confirmed appointments in the date range
    const targetAppts = await db
      .select()
      .from(appointments)
      .where(eq(appointments.status, "confirmed"));

    // Filter to the date range in JS (simpler than complex SQL date range)
    const rangeAppts = targetAppts.filter(
      (a) => a.date >= startDate && a.date <= endDate
    );

    if (rangeAppts.length === 0) return;

    // Collect unique owner IDs
    const ownerIds = [...new Set(rangeAppts.map((a) => a.businessOwnerId))];

    // Fetch all relevant business owners
    const owners = await db
      .select({
        id: businessOwners.id,
        businessName: businessOwners.businessName,
        email: businessOwners.email,
        expoPushToken: businessOwners.expoPushToken,
        notificationsEnabled: businessOwners.notificationsEnabled,
        notificationPreferences: businessOwners.notificationPreferences,
        customSlug: businessOwners.customSlug,
        address: businessOwners.address,
        phone: businessOwners.phone,
        cancellationPolicy: businessOwners.cancellationPolicy,
        subscriptionStatus: businessOwners.subscriptionStatus,
      })
      .from(businessOwners)
      .where(inArray(businessOwners.id, ownerIds));

    const ownerMap = new Map(owners.map((o) => [o.id, o]));

    // For each appointment, check if it falls in the owner's configured reminder window
    const toRemind = rangeAppts.filter((appt) => {
      const owner = ownerMap.get(appt.businessOwnerId);
      if (!owner) return false;
      const notifPrefs = (owner.notificationPreferences as any) ?? {};
      const emailEnabled = notifPrefs.emailOnReminder === true;
      const pushEnabled = notifPrefs.pushOnReminder !== false;
      if (!emailEnabled && !pushEnabled) return false;

      const reminderHours: number = notifPrefs.reminderHoursBefore ?? 24;
      // Only process supported windows to avoid sending at wrong times
      if (!SUPPORTED_WINDOWS.includes(reminderHours as any)) return false;
      if (!isInReminderWindow(appt.date, appt.time, reminderHours, now)) return false;
      // Dedup: skip if a reminder was already sent within the last 2 hours.
      // This prevents duplicate notifications when the server restarts within the same window.
      if (appt.reminderSentAt) {
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        if (appt.reminderSentAt > twoHoursAgo) return false;
      }
      return true;
    });

    if (toRemind.length === 0) return;

    // Collect unique client and service IDs
    const clientLocalIds = [...new Set(toRemind.map((a) => a.clientLocalId))];
    const serviceLocalIds = [...new Set(toRemind.map((a) => a.serviceLocalId))];
    const locationIds = [...new Set(toRemind.map((a) => a.locationId).filter(Boolean))] as string[];

    // Fetch clients
    const clientRows = await db
      .select()
      .from(clients)
      .where(inArray(clients.localId, clientLocalIds));
    const clientMap = new Map(clientRows.map((c) => [c.localId, c]));

    // Fetch services
    const serviceRows = await db
      .select()
      .from(services)
      .where(inArray(services.localId, serviceLocalIds));
    const serviceMap = new Map(serviceRows.map((s) => [s.localId, s]));

    // Fetch locations
    let locationMap = new Map<string, typeof locations.$inferSelect>();
    if (locationIds.length > 0) {
      const locationRows = await db
        .select()
        .from(locations)
        .where(inArray(locations.localId, locationIds));
      locationMap = new Map(locationRows.map((l) => [l.localId, l]));
    }

    let pushSent = 0;
    let emailSent = 0;

    for (const appt of toRemind) {
      const owner = ownerMap.get(appt.businessOwnerId);
      if (!owner) continue;

      const client = clientMap.get(appt.clientLocalId);
      const service = serviceMap.get(appt.serviceLocalId);
      const location = appt.locationId ? locationMap.get(appt.locationId) : undefined;

      const serviceName = service?.name ?? "Appointment";
      const clientName = client?.name ?? "Client";
      const dateStr = formatDate(appt.date);
      const timeStr = formatTime(appt.time);

      const notifPrefs = (owner.notificationPreferences as any) ?? {};
      const reminderHours: number = notifPrefs.reminderHoursBefore ?? 24;

      // Build a human-readable "in X" label for the push notification
      let inLabel = "soon";
      if (reminderHours === 12) inLabel = "in 12 hours";
      else if (reminderHours === 24) inLabel = "tomorrow";
      else if (reminderHours === 48) inLabel = "in 2 days";
      else if (reminderHours === 72) inLabel = "in 3 days";
      else if (reminderHours === 168) inLabel = "next week";

      // ── Push notification to business owner ─────────────────────────
      // Check master notifications toggle first
      const masterEnabled = owner.notificationsEnabled !== false;
      const pushEnabled = masterEnabled && notifPrefs.pushOnReminder !== false;
      if (pushEnabled && owner.expoPushToken) {
        try {
          const sent = await sendExpoPush(owner.expoPushToken, {
            title: `⏰ Reminder: Appointment ${inLabel}`,
            body: `${clientName} — ${serviceName} at ${timeStr} on ${dateStr}`,
            data: { type: "appointment_reminder", appointmentId: appt.localId },
            sound: "default",
          });
          if (sent) {
            pushSent++;
            console.log(`[ReminderCron] Push sent to owner ${owner.id} for appt ${appt.localId} (${reminderHours}h window)`);
          }
        } catch (err) {
          console.warn(`[ReminderCron] Push failed for appt ${appt.localId}:`, err);
        }
      }

      // ── Mark reminder as sent (dedup) ──────────────────────────────────────────────
      // Update reminderSentAt so that if the server restarts within the same window,
      // this appointment is skipped on the next startup run.
      try {
        await db.update(appointments)
          .set({ reminderSentAt: now })
          .where(eq(appointments.localId, appt.localId));
      } catch (err) {
        console.warn(`[ReminderCron] Failed to update reminderSentAt for appt ${appt.localId}:`, err);
      }
      // ── Reminder email to client ───────────────────────────────────────────────────
      // Email reminders are only available on paid plans (not free tier)
      const ownerSubStatus = owner.subscriptionStatus as string | undefined;
      const isFreePlan = !ownerSubStatus || ownerSubStatus === "free";
      const masterNotifEnabled = owner.notificationsEnabled !== false;
      const emailEnabled = notifPrefs.emailOnReminder === true;
      const clientEmail = client?.email;
      if (masterNotifEnabled && emailEnabled && !isFreePlan && clientEmail && clientEmail.includes("@")) {
        try {
          const locationAddress = location
            ? [location.address, location.city, location.state, location.zipCode]
                .filter(Boolean)
                .join(", ")
            : owner.address ?? undefined;

          // Parse cancellation policy for deadline info
          const cp = owner.cancellationPolicy as { enabled?: boolean; hoursBeforeAppointment?: number; feePercentage?: number } | null;
          let cancellationDeadline: string | undefined;
          if (cp?.enabled && cp.hoursBeforeAppointment) {
            const apptDateObj = new Date(appt.date + "T" + appt.time + ":00");
            const deadlineDate = new Date(apptDateObj.getTime() - cp.hoursBeforeAppointment * 60 * 60 * 1000);
            const deadlineStr = deadlineDate.toLocaleDateString("en-US", { month: "long", day: "numeric" });
            const dH = deadlineDate.getHours();
            const dM = deadlineDate.getMinutes();
            const dAmpm = dH >= 12 ? "PM" : "AM";
            const dH12 = dH % 12 || 12;
            const dTimeStr = `${dH12}:${String(dM).padStart(2, "0")} ${dAmpm}`;
            cancellationDeadline = `${deadlineStr} at ${dTimeStr}`;
          }

          const sent = await sendAppointmentReminderEmail(owner.businessName, {
            clientName,
            clientEmail,
            serviceName,
            date: appt.date,
            time: appt.time,
            duration: appt.duration,
            totalPrice: appt.totalPrice ? parseFloat(String(appt.totalPrice)) : undefined,
            locationName: location?.name ?? undefined,
            locationAddress,
            locationPhone: location?.phone ?? undefined,
            businessPhone: owner.phone ?? undefined,
            customSlug: owner.customSlug ?? undefined,
            locationId: appt.locationId ?? undefined,
            cancellationDeadline,
            cancellationFeePercentage: cp?.enabled && cp.feePercentage ? cp.feePercentage : undefined,
          });
          if (sent) {
            emailSent++;
            console.log(`[ReminderCron] Email sent to ${clientEmail} for appt ${appt.localId} (${reminderHours}h window)`);
          }
        } catch (err) {
          console.warn(`[ReminderCron] Email failed for appt ${appt.localId}:`, err);
        }
      }
    }

    if (pushSent > 0 || emailSent > 0) {
      console.log(`[ReminderCron] Sent ${pushSent} push + ${emailSent} email reminders`);
    }
  } catch (err) {
    console.error("[ReminderCron] Error sending reminders:", err);
  }
}

/**
 * Start the appointment reminder cron.
 * Runs every hour; checks each business's configured reminder window (12h–168h).
 */
export function startAppointmentReminderCron() {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  console.log("[ReminderCron] Started — checking every hour for appointment reminders (per-business window: 12h–168h)");

  // Run immediately on startup
  sendAppointmentReminders().catch(console.error);

  // Then run every hour
  setInterval(() => {
    sendAppointmentReminders().catch(console.error);
  }, INTERVAL_MS);
}
