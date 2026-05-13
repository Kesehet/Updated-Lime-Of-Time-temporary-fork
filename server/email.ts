import { Resend } from "resend";

const LOGO_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png";
const FROM_EMAIL = "Lime Of Time <no-reply@lime-of-time.com>";

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY not set, email sending disabled");
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

/** Branded HTML email template for Lime Of Time */
function brandedTemplate(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header with Logo -->
          <tr>
            <td style="background: linear-gradient(135deg, #2d5a27 0%, #4a8c3f 100%);padding:32px 24px;text-align:center;">
              <img src="${LOGO_URL}" alt="Lime Of Time" width="64" height="64" style="width:64px;height:64px;border-radius:14px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
              <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">Lime Of Time</div>
            </td>
          </tr>
          <!-- Title Bar -->
          <tr>
            <td style="background-color:#e8f5e3;padding:16px 24px;text-align:center;">
              <div style="color:#2d5a27;font-size:18px;font-weight:700;">${escHtml(title)}</div>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding:28px 24px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f8faf8;padding:20px 24px;border-top:1px solid #e8ebe8;text-align:center;">
              <div style="color:#888;font-size:12px;line-height:1.5;">
                <div style="margin-bottom:4px;">Lime Of Time — Scheduling Made Simple</div>
                <a href="https://lime-of-time.com" style="color:#4a8c3f;text-decoration:none;">lime-of-time.com</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Detail row for email body */
function detailRow(icon: string, label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">${icon}</td>
    <td style="padding:6px 0;vertical-align:top;">
      <span style="color:#888;font-size:13px;">${escHtml(label)}</span><br/>
      <span style="color:#1a1a1a;font-size:15px;font-weight:500;">${escHtml(value)}</span>
    </td>
  </tr>`;
}

export interface ConfirmationEmailData {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  date: string;
  time: string;
  duration: number;
  totalPrice?: number;
  locationName?: string;
  locationAddress?: string;
  locationCity?: string;
  locationState?: string;
  locationZip?: string;
  locationPhone?: string;
  businessPhone?: string;
  businessAddress?: string;
  customSlug?: string;
  locationId?: string;
  clientAddress?: string;
}

/**
 * Send a branded "Appointment Confirmed" email to the client.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendAppointmentConfirmationEmail(
  businessName: string,
  data: ConfirmationEmailData
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  if (!data.clientEmail || !data.clientEmail.includes("@")) return false;

  const dateObj = new Date(data.date + "T12:00:00");
  const dateStr = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const [h, m] = data.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  const timeStr = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;

  const totalMin = h * 60 + m + data.duration;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  const endAmpm = endH >= 12 ? "PM" : "AM";
  const endHour12 = endH % 12 || 12;
  const endTimeStr = `${endHour12}:${String(endM).padStart(2, "0")} ${endAmpm}`;

  // Build location display
  const locationParts: string[] = [];
  if (data.locationName) locationParts.push(data.locationName);
  if (data.locationAddress) locationParts.push(data.locationAddress);
  if (data.locationCity) locationParts.push(data.locationCity + (data.locationState ? `, ${data.locationState}` : "") + (data.locationZip ? ` ${data.locationZip}` : ""));
  const locationDisplay = locationParts.join(" — ") || data.businessAddress || "";
  const displayPhone = data.locationPhone || data.businessPhone || "";

  // Booking link
  const slug = data.customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  const bookingLink = `https://lime-of-time.com/book/${slug}${data.locationId ? "?location=" + data.locationId : ""}`;

  let detailsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">`;
  detailsHtml += detailRow("💈", "Service", `${data.serviceName} (${data.duration} min)`);
  detailsHtml += detailRow("📅", "Date", dateStr);
  detailsHtml += detailRow("⏰", "Time", `${timeStr} — ${endTimeStr}`);
  if (locationDisplay) detailsHtml += detailRow("📍", "Location", locationDisplay);
  if (displayPhone) detailsHtml += detailRow("📞", "Phone", formatPhoneDisplay(displayPhone));
  if (data.totalPrice !== undefined && data.totalPrice > 0) {
    detailsHtml += detailRow("💰", "Total", `$${data.totalPrice.toFixed(2)}`);
  }
  detailsHtml += `</table>`;

  // Build Google Calendar link
  const gcalStart = data.date.replace(/-/g, "") + "T" + data.time.replace(":", "") + "00";
  const gcalEndMin = h * 60 + m + data.duration;
  const gcalEndH = Math.floor(gcalEndMin / 60) % 24;
  const gcalEndM = gcalEndMin % 60;
  const gcalEnd = data.date.replace(/-/g, "") + "T" + String(gcalEndH).padStart(2, "0") + String(gcalEndM).padStart(2, "0") + "00";
  const gcalTitle = encodeURIComponent(`${data.serviceName} @ ${businessName}`);
  const gcalLocation = encodeURIComponent(locationDisplay || "");
  const gcalDetails = encodeURIComponent(`Service: ${data.serviceName} (${data.duration} min)\nBooked via Lime Of Time`);
  const googleCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${gcalTitle}&dates=${gcalStart}/${gcalEnd}&location=${gcalLocation}&details=${gcalDetails}`;

  const bodyHtml = `
    <div style="color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi <strong>${escHtml(data.clientName)}</strong>, your appointment has been <strong style="color:#2d5a27;">confirmed</strong>! We look forward to seeing you.
    </div>
    ${detailsHtml}
    <div style="margin-top:20px;padding:16px;background-color:#e8f5e3;border-radius:12px;text-align:center;">
      <div style="color:#2d5a27;font-size:14px;font-weight:600;margin-bottom:10px;">📅 Add to Your Calendar</div>
      <a href="${googleCalUrl}" target="_blank" style="display:inline-block;background-color:#4a8c3f;color:#ffffff;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:8px;">Open in Google Calendar</a>
      <div style="color:#666;font-size:11px;margin-top:6px;">iPhone / Mac users: tap the date &amp; time above to save to Apple Calendar</div>
    </div>
    <div style="margin-top:16px;padding:16px;background-color:#f5f5f5;border-radius:12px;text-align:center;">
      <div style="color:#555;font-size:14px;font-weight:600;margin-bottom:8px;">Need to reschedule or cancel?</div>
      <div style="color:#555;font-size:13px;">Please contact us as soon as possible so we can accommodate you.</div>
      ${displayPhone ? `<div style="margin-top:8px;"><a href="tel:${displayPhone.replace(/\D/g,"")}" style="color:#4a8c3f;font-weight:600;text-decoration:none;">${escHtml(formatPhoneDisplay(displayPhone))}</a></div>` : ""}
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="${bookingLink}" style="display:inline-block;background-color:#2d5a27;color:#ffffff;padding:12px 28px;border-radius:24px;font-size:14px;font-weight:600;text-decoration:none;">Book Another Appointment</a>
    </div>
  `;

  const html = brandedTemplate(`Appointment Confirmed — ${businessName}`, bodyHtml);

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [data.clientEmail],
      subject: `Your appointment is confirmed — ${data.serviceName} on ${dateStr}`,
      html,
    });
    console.log("[Email] Confirmation email sent to client:", result);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send confirmation email:", err);
    return false;
  }
}

export interface BookingNotificationData {
  clientName: string;
  clientPhone?: string;
  serviceName: string;
  date: string;
  time: string;
  duration: number;
  totalPrice?: number;
  extras?: Array<{ name: string; price: number; type: string }>;
  giftApplied?: boolean;
  giftUsedAmount?: number;
  notes?: string;
  locationName?: string;
  locationAddress?: string;
  clientAddress?: string;
}

/**
 * Send a branded "New Booking Request" email to the business owner.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendBookingNotificationEmail(
  toEmail: string,
  businessName: string,
  data: BookingNotificationData
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  // Format date nicely
  const dateObj = new Date(data.date + "T12:00:00");
  const dateStr = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Format time
  const [h, m] = data.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  const timeStr = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;

  // End time
  const totalMin = h * 60 + m + data.duration;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  const endAmpm = endH >= 12 ? "PM" : "AM";
  const endHour12 = endH % 12 || 12;
  const endTimeStr = `${endHour12}:${String(endM).padStart(2, "0")} ${endAmpm}`;

  // Build details table
  let detailsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">`;
  detailsHtml += detailRow("👤", "Client", data.clientName + (data.clientPhone ? ` — ${formatPhoneDisplay(data.clientPhone)}` : ""));
  detailsHtml += detailRow("💈", "Service", `${data.serviceName} (${data.duration} min)`);
  detailsHtml += detailRow("📅", "Date", dateStr);
  detailsHtml += detailRow("⏰", "Time", `${timeStr} — ${endTimeStr}`);

  // Location
  if (data.locationName) {
    const locValue = data.clientAddress
      ? `Client Address: ${data.clientAddress}`
      : data.locationAddress
      ? `${data.locationName} — ${data.locationAddress}`
      : data.locationName;
    detailsHtml += detailRow("📍", "Location", locValue);
  }

  // Extras
  if (data.extras && data.extras.length > 0) {
    const extrasList = data.extras.map(e => `${e.name} ($${(e.price || 0).toFixed(2)})`).join(", ");
    detailsHtml += detailRow("🛒", "Add-ons", extrasList);
  }

  // Pricing
  if (data.totalPrice !== undefined && data.totalPrice > 0) {
    let priceStr = `$${data.totalPrice.toFixed(2)}`;
    if (data.giftApplied && data.giftUsedAmount) {
      priceStr += ` (Gift card applied: -$${data.giftUsedAmount.toFixed(2)})`;
    }
    detailsHtml += detailRow("💰", "Total", priceStr);
  }

  detailsHtml += `</table>`;

  // Notes
  let notesHtml = "";
  if (data.notes) {
    // Strip pricing block from notes for the email
    const cleanNotes = data.notes.replace(/\n?--- Pricing ---[\s\S]*$/, "").trim();
    if (cleanNotes) {
      notesHtml = `<div style="margin-top:12px;padding:12px 16px;background-color:#f8f8f8;border-radius:8px;border-left:3px solid #4a8c3f;">
        <div style="color:#888;font-size:12px;font-weight:600;margin-bottom:4px;">CLIENT NOTE</div>
        <div style="color:#333;font-size:14px;line-height:1.5;">${escHtml(cleanNotes)}</div>
      </div>`;
    }
  }

  const bodyHtml = `
    <div style="color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;">
      You have a new appointment request that needs your review.
    </div>
    ${detailsHtml}
    ${notesHtml}
    <div style="margin-top:24px;text-align:center;">
      <div style="display:inline-block;background-color:#2d5a27;color:#ffffff;padding:12px 32px;border-radius:24px;font-size:15px;font-weight:600;">
        Open the app to accept or decline
      </div>
    </div>
    <div style="margin-top:16px;text-align:center;color:#888;font-size:13px;">
      Please respond promptly so your client can plan accordingly.
    </div>
  `;

  const html = brandedTemplate("New Booking Request", bodyHtml);

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: `New Booking Request — ${data.clientName} for ${data.serviceName}`,
      html,
    });
    console.log("[Email] Booking notification sent:", result);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send booking notification:", err);
    return false;
  }
}

// ─── Subscription Confirmation Email ────────────────────────────────────────

export interface SubscriptionConfirmationData {
  planName: string;
  planKey: string;
  billingPeriod: "monthly" | "yearly";
  amount: number;
  nextRenewalDate: string;
  ownerName: string;
}

/**
 * Send a branded subscription activation confirmation email to the business owner.
 * Includes plan name, billing cycle, amount, and next renewal date.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendSubscriptionConfirmationEmail(
  toEmail: string,
  businessName: string,
  data: SubscriptionConfirmationData
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const isFree = data.amount === 0;
  const planEmoji: Record<string, string> = {
    solo: "👤",
    growth: "👥",
    studio: "🏪",
    enterprise: "🏢",
  };
  const emoji = planEmoji[data.planKey] ?? "✅";

  let detailsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">`;
  detailsHtml += detailRow(emoji, "Plan", data.planName);
  detailsHtml += detailRow("📅", "Billing Cycle", data.billingPeriod === "yearly" ? "Annual (billed once per year)" : "Monthly");
  if (isFree) {
    detailsHtml += detailRow("💚", "Amount", "Free forever — no credit card required");
  } else {
    detailsHtml += detailRow("💳", "Amount", `$${data.amount.toFixed(2)} / ${data.billingPeriod === "yearly" ? "year" : "month"}`);
    detailsHtml += detailRow("🔄", "Next Renewal", data.nextRenewalDate);
  }
  detailsHtml += `</table>`;

  const bodyHtml = `
    <div style="color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi ${escHtml(data.ownerName)},<br/><br/>
      Your <strong>${escHtml(businessName)}</strong> account is now active on the
      <strong>${escHtml(data.planName)}</strong> plan. Here's a summary of your subscription:
    </div>
    ${detailsHtml}
    <div style="margin:24px 0;padding:16px;background-color:#f0fff4;border-radius:12px;border-left:4px solid #4a8c3f;">
      <div style="color:#2d5a27;font-size:14px;font-weight:600;margin-bottom:4px;">You're all set!</div>
      <div style="color:#555;font-size:13px;line-height:1.6;">
        Open the Lime Of Time app to manage your appointments, clients, and services.
        Your subscription is active and ready to use.
      </div>
    </div>
    <div style="margin-top:24px;text-align:center;">
      <div style="display:inline-block;background-color:#2d5a27;color:#ffffff;padding:12px 32px;border-radius:24px;font-size:15px;font-weight:600;">
        Open Lime Of Time
      </div>
    </div>
    <div style="margin-top:20px;text-align:center;color:#888;font-size:12px;line-height:1.6;">
      Questions? Contact us anytime.<br/>
      You can manage your subscription from the Settings screen in the app.
    </div>
  `;

  const html = brandedTemplate("Subscription Activated 🎉", bodyHtml);

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: `Your ${data.planName} subscription is now active — Lime Of Time`,
      html,
    });
    console.log("[Email] Subscription confirmation sent:", result);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send subscription confirmation:", err);
    return false;
  }
}

// ─── Appointment Reminder Email (to client) ──────────────────────────────────

export interface AppointmentReminderEmailData {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  date: string;
  time: string;
  duration: number;
  totalPrice?: number;
  locationName?: string;
  locationAddress?: string;
  locationPhone?: string;
  businessPhone?: string;
  customSlug?: string;
  locationId?: string;
  /** Human-readable cancellation deadline, e.g. "April 16 at 9:00 AM" */
  cancellationDeadline?: string;
  /** Cancellation fee percentage (0-100), shown if policy is enabled */
  cancellationFeePercentage?: number;
}

/**
 * Send a "Your appointment is tomorrow" reminder email to the client.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendAppointmentReminderEmail(
  businessName: string,
  data: AppointmentReminderEmailData
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  if (!data.clientEmail || !data.clientEmail.includes("@")) return false;

  const dateObj = new Date(data.date + "T12:00:00");
  const dateStr = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const [h, m] = data.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  const timeStr = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;

  const totalMin = h * 60 + m + data.duration;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  const endAmpm = endH >= 12 ? "PM" : "AM";
  const endHour12 = endH % 12 || 12;
  const endTimeStr = `${endHour12}:${String(endM).padStart(2, "0")} ${endAmpm}`;

  const locationDisplay = [data.locationName, data.locationAddress].filter(Boolean).join(" — ");
  const displayPhone = data.locationPhone || data.businessPhone || "";

  // Google Calendar link
  const gcalStart = data.date.replace(/-/g, "") + "T" + data.time.replace(":", "") + "00";
  const gcalEndH = Math.floor(totalMin / 60) % 24;
  const gcalEndM = totalMin % 60;
  const gcalEnd = data.date.replace(/-/g, "") + "T" + String(gcalEndH).padStart(2, "0") + String(gcalEndM).padStart(2, "0") + "00";
  const gcalTitle = encodeURIComponent(`${data.serviceName} @ ${businessName}`);
  const gcalLocation = encodeURIComponent(locationDisplay || "");
  const gcalDetails = encodeURIComponent(`Service: ${data.serviceName} (${data.duration} min)\nBooked via Lime Of Time`);
  const googleCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${gcalTitle}&dates=${gcalStart}/${gcalEnd}&location=${gcalLocation}&details=${gcalDetails}`;

  const slug = data.customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  const bookingLink = `https://lime-of-time.com/book/${slug}${data.locationId ? "?location=" + data.locationId : ""}`;

  let detailsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">`;
  detailsHtml += detailRow("💈", "Service", `${data.serviceName} (${data.duration} min)`);
  detailsHtml += detailRow("📅", "Date", dateStr);
  detailsHtml += detailRow("⏰", "Time", `${timeStr} — ${endTimeStr}`);
  if (locationDisplay) detailsHtml += detailRow("📍", "Location", locationDisplay);
  if (displayPhone) detailsHtml += detailRow("📞", "Phone", formatPhoneDisplay(displayPhone));
  if (data.totalPrice !== undefined && data.totalPrice > 0) {
    detailsHtml += detailRow("💰", "Total", `$${data.totalPrice.toFixed(2)}`);
  }
  detailsHtml += `</table>`;

  const bodyHtml = `
    <div style="color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi <strong>${escHtml(data.clientName)}</strong>, just a friendly reminder that your appointment is <strong>tomorrow</strong>! We look forward to seeing you.
    </div>
    ${detailsHtml}
    <div style="margin-top:20px;padding:16px;background-color:#e8f5e3;border-radius:12px;text-align:center;">
      <div style="color:#2d5a27;font-size:14px;font-weight:600;margin-bottom:10px;">📅 Add to Your Calendar</div>
      <a href="${googleCalUrl}" target="_blank" style="display:inline-block;background-color:#4a8c3f;color:#ffffff;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:8px;">Open in Google Calendar</a>
    </div>
    <div style="margin-top:16px;padding:16px;background-color:#f5f5f5;border-radius:12px;text-align:center;">
      <div style="color:#555;font-size:14px;font-weight:600;margin-bottom:8px;">Need to reschedule or cancel?</div>
      ${data.cancellationDeadline
        ? `<div style="color:#c0392b;font-size:13px;font-weight:600;margin-bottom:6px;">&#9888; Free cancellation until <strong>${escHtml(data.cancellationDeadline)}</strong>${data.cancellationFeePercentage ? ` &mdash; a ${data.cancellationFeePercentage}% fee applies after this time` : ""}</div>`
        : `<div style="color:#555;font-size:13px;">Please contact us as soon as possible so we can accommodate you.</div>`
      }
      ${displayPhone ? `<div style="margin-top:8px;"><a href="tel:${displayPhone.replace(/\D/g,"")}" style="color:#4a8c3f;font-weight:600;text-decoration:none;">${escHtml(formatPhoneDisplay(displayPhone))}</a></div>` : ""}
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="${bookingLink}" style="display:inline-block;background-color:#2d5a27;color:#ffffff;padding:12px 28px;border-radius:24px;font-size:14px;font-weight:600;text-decoration:none;">Book Another Appointment</a>
    </div>
  `;

  const html = brandedTemplate(`Reminder: Your appointment tomorrow — ${businessName}`, bodyHtml);

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [data.clientEmail],
      subject: `Reminder: ${data.serviceName} tomorrow at ${timeStr} — ${businessName}`,
      html,
    });
    console.log("[Email] Reminder email sent to client:", result);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send reminder email:", err);
    return false;
  }
}

export interface PaymentReceiptEmailData {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  date: string;
  time: string;
  duration: number;
  totalPrice?: number;
  paymentMethod?: string;
  paymentConfirmationNumber?: string;
  locationName?: string;
  locationAddress?: string;
  businessPhone?: string;
  customSlug?: string;
  locationId?: string;
}

/**
 * Send a branded "Payment Received" receipt email to the client.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendPaymentReceiptEmail(
  businessName: string,
  data: PaymentReceiptEmailData
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  if (!data.clientEmail || !data.clientEmail.includes("@")) return false;

  const dateObj = new Date(data.date + "T12:00:00");
  const dateStr = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const [h, m] = data.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  const timeStr = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;

  const methodLabels: Record<string, string> = {
    cash: "Cash",
    zelle: "Zelle",
    venmo: "Venmo",
    cashapp: "Card",
  };
  const methodLabel = data.paymentMethod ? (methodLabels[data.paymentMethod] ?? data.paymentMethod) : undefined;

  const slug = data.customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  const bookingLink = `https://lime-of-time.com/book/${slug}${data.locationId ? "?location=" + data.locationId : ""}`;

  let detailsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">`;
  detailsHtml += detailRow("💈", "Service", `${data.serviceName} (${data.duration} min)`);
  detailsHtml += detailRow("📅", "Date", dateStr);
  detailsHtml += detailRow("⏰", "Time", timeStr);
  if (data.locationName || data.locationAddress) {
    detailsHtml += detailRow("📍", "Location", [data.locationName, data.locationAddress].filter(Boolean).join(" — "));
  }
  if (data.totalPrice !== undefined && data.totalPrice > 0) {
    detailsHtml += detailRow("💰", "Amount Paid", `$${data.totalPrice.toFixed(2)}`);
  }
  if (methodLabel) {
    detailsHtml += detailRow("💳", "Payment Method", methodLabel);
  }
  if (data.paymentConfirmationNumber) {
    detailsHtml += detailRow("🔖", "Confirmation #", escHtml(data.paymentConfirmationNumber));
  }
  detailsHtml += `</table>`;

  const bodyHtml = `
    <div style="color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi <strong>${escHtml(data.clientName)}</strong>, your payment has been <strong style="color:#2d5a27;">received</strong>. Thank you for your business!
    </div>
    ${detailsHtml}
    <div style="margin-top:16px;padding:16px;background-color:#e8f5e3;border-radius:12px;text-align:center;">
      <div style="color:#2d5a27;font-size:14px;font-weight:600;margin-bottom:8px;">✅ Payment Confirmed</div>
      <div style="color:#555;font-size:13px;">This email serves as your payment receipt. Please keep it for your records.</div>
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="${bookingLink}" style="display:inline-block;background-color:#2d5a27;color:#ffffff;padding:12px 28px;border-radius:24px;font-size:14px;font-weight:600;text-decoration:none;">Book Another Appointment</a>
    </div>
  `;

  const html = brandedTemplate(`Payment Received — ${businessName}`, bodyHtml);

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [data.clientEmail],
      subject: `Payment received for ${data.serviceName} — ${businessName}`,
      html,
    });
    console.log("[Email] Payment receipt email sent to client:", result);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send payment receipt email:", err);
    return false;
  }
}

// ─── Gift Email Functions ─────────────────────────────────────────────────────
export interface GiftNotificationEmailData {
  recipientName: string;
  recipientEmail: string;
  purchaserName: string;
  businessName: string;
  businessSlug: string;
  giftCode: string;
  items: { name: string; price: number; type: string }[];
  totalValue: number;
  personalMessage?: string;
  expiresAt?: string;
  recipientChoosesDate: boolean;
  preselectedDate?: string;
  preselectedTime?: string;
}

export async function sendGiftNotificationEmail(data: GiftNotificationEmailData): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  if (!data.recipientEmail || !data.recipientEmail.includes("@")) return false;
  const redeemLink = "https://lime-of-time.com/api/gift/" + encodeURIComponent(data.giftCode);
  let itemsHtml = "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:16px 0;\">";
  for (const item of data.items) {
    itemsHtml += detailRow(item.type === "service" ? "✂️" : "🛍️", item.name, "$" + item.price.toFixed(2));
  }
  if (data.items.length > 1) itemsHtml += detailRow("💰", "Total Value", "$" + data.totalValue.toFixed(2));
  if (data.expiresAt) {
    const expDate = new Date(data.expiresAt + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    itemsHtml += detailRow("📅", "Valid Until", expDate);
  }
  itemsHtml += "</table>";
  const messageBlock = data.personalMessage
    ? "<div style=\"background:#f0fdf4;border-left:4px solid #4a8c3f;border-radius:8px;padding:16px;margin:16px 0;\"><div style=\"color:#2d5a27;font-size:12px;font-weight:600;margin-bottom:6px;\">Personal Message from " + escHtml(data.purchaserName) + "</div><div style=\"color:#374151;font-size:15px;font-style:italic;line-height:1.6;\">\"" + escHtml(data.personalMessage) + "\"</div></div>"
    : "";
  const dateNote = data.recipientChoosesDate
    ? "<div style=\"color:#555;font-size:13px;margin-top:8px;\">You can choose your own appointment date when you redeem this gift.</div>"
    : data.preselectedDate ? "<div style=\"color:#555;font-size:13px;margin-top:8px;\">A date has been pre-selected for you.</div>" : "";
  const bodyHtml = "<div style=\"color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;\">Hi <strong>" + escHtml(data.recipientName) + "</strong>!</div><div style=\"color:#333;font-size:15px;line-height:1.6;margin-bottom:20px;\"><strong>" + escHtml(data.purchaserName) + "</strong> has gifted you a special experience at <strong>" + escHtml(data.businessName) + "</strong>!</div>" + messageBlock + itemsHtml + dateNote + "<div style=\"margin-top:24px;text-align:center;\"><a href=\"" + redeemLink + "\" style=\"display:inline-block;background-color:#2d5a27;color:#ffffff;padding:14px 32px;border-radius:24px;font-size:16px;font-weight:700;text-decoration:none;\">Redeem Your Gift</a></div><div style=\"margin-top:16px;text-align:center;\"><div style=\"color:#888;font-size:12px;\">Or use code: <strong style=\"color:#2d5a27;font-size:14px;letter-spacing:2px;\">" + escHtml(data.giftCode) + "</strong></div></div>";
  const html = brandedTemplate("You received a gift from " + data.purchaserName + "!", bodyHtml);
  try {
    await resend.emails.send({ from: FROM_EMAIL, to: [data.recipientEmail], subject: "Gift from " + data.purchaserName + " at " + data.businessName, html });
    console.log("[Email] Gift notification email sent to recipient");
    return true;
  } catch (err) { console.error("[Email] Failed to send gift notification email:", err); return false; }
}

export async function sendGiftPurchaseConfirmationEmail(data: {
  purchaserName: string; purchaserEmail: string; recipientName: string; businessName: string;
  giftCode: string; items: { name: string; price: number; type: string }[]; totalValue: number;
  paymentMethod: string; shareLink: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;
  if (!data.purchaserEmail || !data.purchaserEmail.includes("@")) return false;
  const methodLabels: Record<string, string> = { cash: "Cash (pay in person)", zelle: "Zelle", venmo: "Venmo", cashapp: "Cash App", card: "Credit/Debit Card" };
  const methodLabel = methodLabels[data.paymentMethod] ?? data.paymentMethod;
  let itemsHtml = "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:16px 0;\">";
  for (const item of data.items) itemsHtml += detailRow(item.type === "service" ? "✂️" : "🛍️", item.name, "$" + item.price.toFixed(2));
  itemsHtml += detailRow("💰", "Total", "$" + data.totalValue.toFixed(2));
  itemsHtml += detailRow("💳", "Payment Method", methodLabel);
  itemsHtml += detailRow("🎁", "Gift Code", data.giftCode);
  itemsHtml += "</table>";
  const bodyHtml = "<div style=\"color:#333;font-size:15px;line-height:1.6;margin-bottom:16px;\">Hi <strong>" + escHtml(data.purchaserName) + "</strong>, your gift for <strong>" + escHtml(data.recipientName) + "</strong> at <strong>" + escHtml(data.businessName) + "</strong> has been created!</div>" + itemsHtml + "<div style=\"background:#e8f5e3;border-radius:12px;padding:16px;margin:16px 0;text-align:center;\"><div style=\"color:#2d5a27;font-size:13px;font-weight:600;margin-bottom:8px;\">Share this link with " + escHtml(data.recipientName) + "</div><a href=\"" + data.shareLink + "\" style=\"color:#4a8c3f;font-size:13px;word-break:break-all;\">" + data.shareLink + "</a></div><div style=\"color:#555;font-size:13px;margin-top:8px;text-align:center;\">" + (data.paymentMethod === "card" ? "Your card has been charged." : "Please complete your payment via <strong>" + methodLabel + "</strong> to activate the gift.") + "</div>";
  const html = brandedTemplate("Gift Purchase Confirmation — " + data.businessName, bodyHtml);
  try {
    await resend.emails.send({ from: FROM_EMAIL, to: [data.purchaserEmail], subject: "Your gift for " + data.recipientName + " at " + data.businessName + " — Confirmation", html });
    console.log("[Email] Gift purchase confirmation email sent to buyer");
    return true;
  } catch (err) { console.error("[Email] Failed to send gift purchase confirmation email:", err); return false; }
}

/** Send a deletion-scheduled confirmation email to the business owner */
export async function sendDeletionScheduledEmail(data: {
  businessName: string;
  ownerName: string | null;
  email: string;
  deletionDate: Date;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend || !data.email) return false;

  const deletionDateStr = data.deletionDate.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const html = brandedTemplate(
    "Your account deletion has been scheduled",
    `
    <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
      Hi ${escHtml(data.ownerName ?? data.businessName)},
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      We've received your request to delete your <strong>${escHtml(data.businessName)}</strong> account on Lime Of Time.
    </p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:12px;padding:20px;margin:0 0 20px;">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#856404;">⚠️ Your account is scheduled for permanent deletion on:</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#856404;">${escHtml(deletionDateStr)}</p>
    </div>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
      <strong>What will be deleted:</strong>
    </p>
    <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;line-height:1.8;">
      <li>All appointments and booking history</li>
      <li>All client records and contact information</li>
      <li>All services, packages, and pricing</li>
      <li>All staff members and their schedules</li>
      <li>All locations and working hours</li>
      <li>All uploaded photos and images</li>
      <li>All discount codes and gift cards</li>
      <li>Your business profile and settings</li>
      <li>All billing and subscription data</li>
    </ul>
    <div style="background:#d1fae5;border:1px solid #34d399;border-radius:12px;padding:20px;margin:0 0 20px;">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#065f46;">✅ You can cancel this deletion</p>
      <p style="margin:0;font-size:14px;color:#065f46;line-height:1.6;">
        If you change your mind, open the Lime Of Time app, go to <strong>Settings → Delete Business</strong>, and tap <strong>Cancel Deletion</strong> before ${escHtml(deletionDateStr)}.
      </p>
    </div>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
      If you did not request this deletion, please contact us immediately at support@lime-of-time.com.
    </p>
    `
  );

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: data.email,
      subject: `⚠️ Account deletion scheduled for ${deletionDateStr} — ${escHtml(data.businessName)}`,
      html,
    });
    console.log("[Email] Deletion scheduled email sent to", data.email);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send deletion scheduled email:", err);
    return false;
  }
}

/** Send an internal admin alert when a business schedules or cancels deletion */
export async function sendAdminDeletionAlertEmail(data: {
  businessName: string;
  ownerName: string | null;
  email: string | null;
  phone: string;
  businessOwnerId: number;
  action: "scheduled" | "cancelled" | "completed";
  deletionDate?: Date;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const ADMIN_EMAIL = "admin@lime-of-time.com";
  const actionLabel = data.action === "scheduled" ? "🗑️ Deletion Scheduled" :
    data.action === "cancelled" ? "✅ Deletion Cancelled" : "💀 Account Deleted";
  const deletionDateStr = data.deletionDate
    ? data.deletionDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "N/A";

  const html = brandedTemplate(
    `Admin Alert: ${actionLabel}`,
    `
    <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#374151;">${escHtml(actionLabel)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;width:40%;">Business Name</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escHtml(data.businessName)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Owner Name</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escHtml(data.ownerName ?? "N/A")}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Email</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escHtml(data.email ?? "N/A")}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Phone</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escHtml(data.phone)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Business Owner ID</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${data.businessOwnerId}</td></tr>
      ${data.action === "scheduled" ? `<tr><td style="padding:8px 0;font-weight:600;">Scheduled Deletion</td><td style="padding:8px 0;">${escHtml(deletionDateStr)}</td></tr>` : ""}
    </table>
    `
  );

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[Lime Of Time Admin] ${actionLabel}: ${data.businessName}`,
      html,
    });
    console.log("[Email] Admin deletion alert sent for", data.businessName);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send admin deletion alert:", err);
    return false;
  }
}
