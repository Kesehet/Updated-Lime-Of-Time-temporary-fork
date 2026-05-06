/**
 * Expo Push Notification Service
 *
 * Sends push notifications directly to the business owner's device via
 * the Expo Push API. All notifications include full appointment details
 * and professional messaging.
 */

export type PushNotificationData = {
  /** Notification type for deep-link routing in the app */
  type:
    | "appointment_request"
    | "appointment_cancelled"
    | "appointment_rescheduled"
    | "cancel_request"
    | "reschedule_request"
    | "waitlist"
    | "appointment_reminder"
    | "appointment_completed"
    | "payment_received"
    | "stripe_payout"
    | "subscription_renewal"
    | "client_message"
    | "business_message"
    | "general";
  /** Appointment local ID for navigating to the specific appointment */
  appointmentId?: string;
  /** Calendar tab filter to open (requests, cancelled, upcoming, completed) */
  filter?: "requests" | "cancelled" | "upcoming" | "completed";
  /** Client account ID for client portal message deep-links */
  clientAccountId?: number;
  /** Business owner ID for business message deep-links */
  businessOwnerId?: number;
};

export type PushPayload = {
  title: string;
  body: string;
  data?: PushNotificationData;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  /** Notification category identifier for inline action buttons (iOS/Android) */
  categoryIdentifier?: string;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/**
 * Send a push notification to a specific Expo push token.
 * Returns true if the notification was accepted by Expo, false otherwise.
 */
export async function sendExpoPush(
  expoPushToken: string,
  payload: PushPayload
): Promise<boolean> {
  // Accept both legacy "ExponentPushToken[...]" and modern "ExpoPushToken[...]" formats
  if (!expoPushToken || (!expoPushToken.startsWith("ExponentPushToken[") && !expoPushToken.startsWith("ExpoPushToken["))) {
    console.warn("[Push] Invalid or missing Expo push token:", expoPushToken);
    return false;
  }

  const body: Record<string, unknown> = {
    to: expoPushToken,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? "default",
    badge: payload.badge,
    channelId: payload.channelId ?? "appointments",
    priority: "high",
  };
  // Attach category identifier for inline action buttons (iOS/Android)
  if (payload.categoryIdentifier) {
    body.categoryIdentifier = payload.categoryIdentifier;
  }

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`[Push] Expo push API error (${response.status}): ${text}`);
      return false;
    }

    const result = await response.json();
    const ticket = result?.data;

    if (ticket?.status === "error") {
      console.warn("[Push] Expo push ticket error:", ticket.message, ticket.details);
      return false;
    }

    console.log("[Push] Notification sent successfully:", ticket?.id ?? "ok");
    return true;
  } catch (err) {
    console.error("[Push] Failed to send Expo push notification:", err);
    return false;
  }
}

// ─── Notification Functions ────────────────────────────────────────────────

/**
 * New appointment booking request from a client.
 * Tapping navigates to Calendar → Requests tab.
 */
export async function notifyNewBooking(
  expoPushToken: string,
  businessName: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string,
  appointmentId: string,
  opts?: {
    duration?: number;
    locationName?: string;
    clientPhone?: string;
    staffName?: string;
    notes?: string;
  }
): Promise<boolean> {
  const endTime = opts?.duration ? computeEndTime(time, opts.duration) : null;
  const timeRange = endTime ? `${fmt12(time)} – ${fmt12(endTime)}` : fmt12(time);
  const lines = [
    `A new appointment request requires your review.`,
    ``,
    `👤 Client: ${clientName}${opts?.clientPhone ? ` · ${fmtPhone(opts.clientPhone)}` : ""}`,
    `💈 Service: ${serviceName}${opts?.duration ? ` (${opts.duration} min)` : ""}`,
    `📅 Date: ${date}`,
    `⏰ Time: ${timeRange}`,
    opts?.locationName ? `📍 Location: ${opts.locationName}` : null,
    opts?.staffName ? `🧑‍💼 Staff: ${opts.staffName}` : null,
    opts?.notes ? `📝 Notes: ${opts.notes}` : null,
    ``,
    `Tap to confirm or decline this request.`,
  ].filter((l) => l !== null).join("\n");

  return sendExpoPush(expoPushToken, {
    title: `📅 New Booking Request — ${businessName}`,
    body: lines,
    data: { type: "appointment_request", appointmentId, filter: "requests" },
    channelId: "appointments",
    // Show Accept / Decline action buttons on the notification banner
    categoryIdentifier: "apptrequest",
  });
}

/**
 * Client-initiated appointment cancellation.
 * Tapping navigates to Calendar → Cancelled tab.
 */
export async function notifyCancellation(
  expoPushToken: string,
  businessName: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string,
  appointmentId: string,
  opts?: {
    duration?: number;
    locationName?: string;
    clientPhone?: string;
    cancellationFee?: number;
    reason?: string;
  }
): Promise<boolean> {
  const endTime = opts?.duration ? computeEndTime(time, opts.duration) : null;
  const timeRange = endTime ? `${fmt12(time)} – ${fmt12(endTime)}` : fmt12(time);
  const lines = [
    `An appointment has been cancelled by the client.`,
    ``,
    `👤 Client: ${clientName}${opts?.clientPhone ? ` · ${fmtPhone(opts.clientPhone)}` : ""}`,
    `💈 Service: ${serviceName}${opts?.duration ? ` (${opts.duration} min)` : ""}`,
    `📅 Date: ${date}`,
    `⏰ Time: ${timeRange}`,
    opts?.locationName ? `📍 Location: ${opts.locationName}` : null,
    opts?.reason ? `💬 Reason: ${opts.reason}` : null,
    opts?.cancellationFee && opts.cancellationFee > 0
      ? `💳 Cancellation Fee: $${opts.cancellationFee.toFixed(2)}`
      : null,
    ``,
    `This time slot is now available for new bookings.`,
  ].filter((l) => l !== null).join("\n");

  return sendExpoPush(expoPushToken, {
    title: `❌ Appointment Cancelled — ${businessName}`,
    body: lines,
    data: { type: "appointment_cancelled", appointmentId, filter: "cancelled" },
    channelId: "appointments",
  });
}

/**
 * Client-initiated appointment reschedule request.
 * Tapping navigates to Calendar → Requests tab for re-confirmation.
 */
export async function notifyReschedule(
  expoPushToken: string,
  businessName: string,
  clientName: string,
  serviceName: string,
  newDate: string,
  newTime: string,
  appointmentId: string,
  opts?: {
    oldDate?: string;
    oldTime?: string;
    duration?: number;
    locationName?: string;
    clientPhone?: string;
  }
): Promise<boolean> {
  const endTime = opts?.duration ? computeEndTime(newTime, opts.duration) : null;
  const timeRange = endTime ? `${fmt12(newTime)} – ${fmt12(endTime)}` : fmt12(newTime);
  const lines = [
    `A client has requested to reschedule their appointment.`,
    ``,
    `👤 Client: ${clientName}${opts?.clientPhone ? ` · ${fmtPhone(opts.clientPhone)}` : ""}`,
    `💈 Service: ${serviceName}${opts?.duration ? ` (${opts.duration} min)` : ""}`,
    opts?.oldDate && opts?.oldTime
      ? `📅 Original: ${opts.oldDate} at ${fmt12(opts.oldTime)}`
      : null,
    `📅 Requested: ${newDate}`,
    `⏰ New Time: ${timeRange}`,
    opts?.locationName ? `📍 Location: ${opts.locationName}` : null,
    ``,
    `Tap to confirm or decline the new time.`,
  ].filter((l) => l !== null).join("\n");

  return sendExpoPush(expoPushToken, {
    title: `🔄 Reschedule Request — ${businessName}`,
    body: lines,
    data: { type: "appointment_rescheduled", appointmentId, filter: "requests" },
    channelId: "appointments",
    // Show Accept / Decline action buttons on the notification banner
    categoryIdentifier: "apptrequest",
  });
}

/**
 * New waitlist entry from a client.
 * Tapping navigates to Calendar → Requests tab.
 */
export async function notifyWaitlist(
  expoPushToken: string,
  businessName: string,
  clientName: string,
  serviceName: string,
  preferredDate: string,
  opts?: {
    clientPhone?: string;
    preferredTime?: string;
    notes?: string;
  }
): Promise<boolean> {
  const lines = [
    `A client has joined the waitlist and is requesting an appointment.`,
    ``,
    `👤 Client: ${clientName}${opts?.clientPhone ? ` · ${fmtPhone(opts.clientPhone)}` : ""}`,
    `💈 Service: ${serviceName}`,
    `📅 Preferred Date: ${preferredDate}`,
    opts?.preferredTime ? `⏰ Preferred Time: ${fmt12(opts.preferredTime)}` : null,
    opts?.notes ? `📝 Notes: ${opts.notes}` : null,
    ``,
    `Tap to review and schedule this client.`,
  ].filter((l) => l !== null).join("\n");

  return sendExpoPush(expoPushToken, {
    title: `⏳ New Waitlist Entry — ${businessName}`,
    body: lines,
    data: { type: "waitlist", filter: "requests" },
    channelId: "appointments",
  });
}

/**
 * Appointment automatically marked as completed by the system.
 * Tapping navigates to the specific appointment detail screen.
 */
export async function notifyAutoComplete(
  expoPushToken: string,
  businessName: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string,
  appointmentId: string,
  opts?: {
    duration?: number;
    locationName?: string;
    clientPhone?: string;
    staffName?: string;
    delayMinutes?: number;
  }
): Promise<boolean> {
  const endTime = opts?.duration ? computeEndTime(time, opts.duration) : null;
  const timeRange = endTime ? `${fmt12(time)} – ${fmt12(endTime)}` : fmt12(time);
  const delay = opts?.delayMinutes ?? 5;
  const lines = [
    `The following appointment has been automatically marked as completed.`,
    ``,
    `👤 Client: ${clientName}${opts?.clientPhone ? ` · ${fmtPhone(opts.clientPhone)}` : ""}`,
    `💈 Service: ${serviceName}${opts?.duration ? ` (${opts.duration} min)` : ""}`,
    `📅 Date: ${date}`,
    `⏰ Time: ${timeRange}`,
    opts?.locationName ? `📍 Location: ${opts.locationName}` : null,
    opts?.staffName ? `🧑‍💼 Staff: ${opts.staffName}` : null,
    ``,
    `Auto-completed ${delay} minute${delay !== 1 ? "s" : ""} after the scheduled end time.`,
    `Tap to view the full appointment record.`,
  ].filter((l) => l !== null).join("\n");

  return sendExpoPush(expoPushToken, {
    title: `✅ Appointment Completed — ${businessName}`,
    body: lines,
    data: { type: "appointment_completed", appointmentId, filter: "completed" },
    channelId: "completions",
  });
}

/**
 * Card payment received via Stripe checkout.
 * Tapping navigates directly to the appointment detail screen.
 */
export async function notifyCardPayment(
  expoPushToken: string,
  businessName: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string,
  appointmentId: string,
  totalPrice: string | number,
  opts?: {
    duration?: number;
    locationName?: string;
    clientPhone?: string;
  }
): Promise<boolean> {
  const endTime = opts?.duration ? computeEndTime(time, opts.duration) : null;
  const timeRange = endTime ? `${fmt12(time)} – ${fmt12(endTime)}` : fmt12(time);
  const amount = typeof totalPrice === "number" ? totalPrice.toFixed(2) : parseFloat(String(totalPrice || "0")).toFixed(2);
  const lines = [
    `A card payment of $${amount} has been received.`,
    ``,
    `👤 Client: ${clientName}${opts?.clientPhone ? ` · ${fmtPhone(opts.clientPhone)}` : ""}`,
    `💈 Service: ${serviceName}${opts?.duration ? ` (${opts.duration} min)` : ""}`,
    `📅 Date: ${date}`,
    `⏰ Time: ${timeRange}`,
    opts?.locationName ? `📍 Location: ${opts.locationName}` : null,
    ``,
    `Appointment is confirmed and fully paid. Tap to view details.`,
  ].filter((l) => l !== null).join("\n");
  return sendExpoPush(expoPushToken, {
    title: `💳 Card Payment Received — ${businessName}`,
    body: lines,
    data: { type: "payment_received", appointmentId, filter: "upcoming" },
    channelId: "appointments",
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Format "HH:MM" → "h:MM AM/PM" */
function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** Compute end time "HH:MM" from start time + duration in minutes */
function computeEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const totalMins = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}
