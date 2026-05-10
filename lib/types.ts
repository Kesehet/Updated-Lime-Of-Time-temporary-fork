export interface Service {
  id: string;
  name: string;
  duration: number; // in minutes
  price: number;
  color: string;
  description?: string; // optional description shown on booking page detail sheet
  category?: string; // service category for grouping
  photoUri?: string; // optional photo shown on booking page
  locationIds?: string[] | null; // null = all locations
  reminderHours?: number | null; // override global SMS reminder timing for this service (null = use global)
  serviceType?: 'in_store' | 'mobile'; // whether service is performed at client location
  travelFee?: number | null; // optional travel/surcharge fee added when clientAddress is provided
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  birthday: string; // MM-DD format, e.g. "03-15" for March 15 (empty string = not set)
  createdAt: string;
}

/** A before/after photo attached to a client profile */
export interface ClientPhoto {
  id: string;
  clientId: string;
  uri: string; // local file URI or base64 data URI
  label: "before" | "after" | "other";
  note: string;
  takenAt: string; // ISO date string
  /** Optional service this photo is tagged to (e.g. "Balayage") */
  serviceId?: string;
  serviceName?: string;
}

export interface ServicePhoto {
  id: string;
  serviceId: string;
  uri: string; // local file URI or base64 data URI
  label: "before" | "after" | "other";
  note: string;
  takenAt: string; // ISO date string
}

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export interface AppointmentExtraItem {
  type: "service" | "product" | "package";
  id: string;
  name: string;
  price: number;
  duration: number;
}

export interface Appointment {
  id: string;
  serviceId: string;
  clientId: string;
  date: string; // ISO date string YYYY-MM-DD
  time: string; // HH:MM format
  duration: number; // in minutes
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
  /** Total price including primary service + extra items. Falls back to service price if not set. */
  totalPrice?: number;
  /** Structured list of extra items (services/products) added to this appointment */
  // Package session metadata
  packageGroupId?: string;
  packageName?: string;
  sessionIndex?: number;
  sessionTotal?: number;
  extraItems?: AppointmentExtraItem[];
  /** Whether a gift card was applied to this appointment */
  giftApplied?: boolean;
  /** Amount deducted from gift card balance for this appointment */
  giftUsedAmount?: number;
  /** Staff member assigned to this appointment */
  staffId?: string;
  /** Discount percentage applied (0-100) */
  discountPercent?: number;
  /** Discount amount deducted */
  discountAmount?: number;
  /** Discount name/label */
  discountName?: string;
  /** Location assigned to this appointment */
  locationId?: string;
  /** Client address for mobile/at-home service appointments */
  clientAddress?: string;
  /** Reason for cancellation (set when status changes to 'cancelled') */
  cancellationReason?: string;
  /** Payment method chosen: zelle | venmo | cashapp | cash | card | unpaid */
  paymentMethod?: "zelle" | "venmo" | "cashapp" | "cash" | "card" | "unpaid" | "free";
  /** Payment status: unpaid | pending_cash | paid */
  paymentStatus?: "unpaid" | "pending_cash" | "paid";
  /** Confirmation number provided by business owner after receiving digital payment */
  paymentConfirmationNumber?: string;
  /** ISO timestamp when payment was confirmed */
  paymentConfirmedAt?: string;
  /** ISO timestamp when a Stripe refund was issued */
  refundedAt?: string;
  /** Amount refunded in dollars */
  refundedAmount?: number;
  /** Stripe refund ID */
  stripeRefundId?: string;
  /** Sent reminder timestamps keyed by reminder template id */
  sentReminders?: Record<string, string>; // { [templateId]: ISO timestamp }
  /** ISO timestamp when client tapped 'I Sent Payment' on the manage page */
  clientPaidNotifiedAt?: string;
  /** Client-submitted cancellation request */
  cancelRequest?: {
    status: 'pending' | 'approved' | 'declined';
    reason?: string;
    submittedAt: string;
    resolvedAt?: string;
  } | null;
  /** Client-submitted reschedule request */
  rescheduleRequest?: {
    status: 'pending' | 'approved' | 'declined';
    requestedDate: string;
    requestedTime: string;
    reason?: string;
    submittedAt: string;
    resolvedAt?: string;
  } | null;
  /** Reason provided when owner reschedules the appointment */
  rescheduleReason?: string;
}

export interface Review {
  id: string;
  clientId: string;
  appointmentId?: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string;
}

export interface Discount {
  id: string;
  name: string;
  percentage: number; // 0-100
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  daysOfWeek: string[]; // legacy, kept for backward compat
  dates: string[]; // specific dates YYYY-MM-DD (future dates only)
  serviceIds: string[] | null; // null = all services
  productIds?: string[] | null; // null = all products, [] = no products
  active: boolean;
  createdAt: string;
  /** Optional max number of uses; discount auto-deactivates when reached */
  maxUses?: number | null;
}

export interface GiftCard {
  id: string;
  code: string;
  serviceLocalId: string; // primary service (backward compat)
  serviceIds?: string[]; // multiple services
  productIds?: string[]; // products included
  /** Total monetary value of the gift card when created */
  originalValue: number;
  /** Remaining balance (decreases with each use, 0 = fully redeemed) */
  remainingBalance: number;
  recipientName: string;
  recipientPhone: string;
  message: string;
  redeemed: boolean;
  redeemedAt?: string;
  expiresAt?: string;
  createdAt: string;
  purchasedPublicly?: boolean;
  purchaserName?: string;
  purchaserEmail?: string;
  recipientEmail?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  totalValue?: number;
  recipientChoosesDate?: boolean;
  preselectedDate?: string;
  preselectedTime?: string;
  /** "service" for specific service gifts, "balance" for dollar credit gifts */
  giftType?: "service" | "balance";
  /** Optional banner image URI shown on gift confirmation and client home screen */
  bannerImageUri?: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  brand?: string; // product brand for grouping
  category?: string; // product category for grouping
  photoUri?: string; // optional photo shown on booking page
  available: boolean;
  createdAt: string;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone: string;
  email: string;
  isDefault: boolean;
  active: boolean;
  /** When true, the location is paused for new bookings without being fully deactivated */
  temporarilyClosed?: boolean;
  /** ISO date string YYYY-MM-DD: if set, location auto-reopens on this date */
  reopenOn?: string;
  /** ISO date string YYYY-MM-DD: if set, this location stops accepting bookings after this date */
  activeUntil?: string;
  workingHours: Record<string, WorkingHours> | null; // null = use business hours
  createdAt: string;
  /** Optional cover photo URL for the location */
  photoUri?: string | null;
  /** Per-location buffer time override in minutes. null/undefined = use global BusinessSettings.bufferTime */
  bufferMinutes?: number | null;
  /** Per-location slot interval override in minutes. 0 = Auto. null/undefined = use global BusinessSettings.slotInterval */
  slotIntervalMinutes?: number | null;
}

export const LOCATION_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
];

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  color: string;
  serviceIds: string[] | null; // null = all services
  locationIds: string[] | null; // null = all locations
  workingHours: Record<string, WorkingHours> | null; // null = use business hours
  active: boolean;
  createdAt: string;
  /** Commission rate as a percentage (0-100). e.g. 40 means staff earns 40% of service revenue */
  commissionRate?: number | null;
  /** Profile photo URI (local file URI or remote URL) */
  photoUri?: string | null;
}

export const STAFF_COLORS = [
  "#3B82F6", // blue
  "#EF4444", // red
  "#10B981", // emerald
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
];

/** Reusable appointment note template saved per client or globally */
export interface NoteTemplate {
  id: string;
  title: string; // short label e.g. "Prefers no heat styling"
  body: string;  // full note text
  createdAt: string;
}

/** A service bundle / package deal — multiple services sold together at a discounted price */
export interface ServicePackage {
  id: string;
  name: string;
  description: string;
  /** Service localIds included in this package */
  serviceIds: string[];
  /** Total price for the bundle (should be less than sum of individual prices) */
  price: number;
  /** Optional number of sessions (e.g. 5-session package) */
  sessions?: number;
  /** Whether this package is currently active / available for booking */
  active: boolean;
  /** Optional photo URI for the package card */
  photoUri?: string | null;
  /** Optional expiry in days from purchase date (null = no expiry) */
  expiryDays?: number | null;
  /**
   * Minimum gap in days required between consecutive sessions of this package.
   * e.g. 14 means the client must wait at least 14 days between each visit.
   * null / undefined = no restriction.
   */
  bufferDays?: number | null;
  /**
   * Buffer time in minutes to add after each session appointment (same-day padding).
   * null / undefined = no extra buffer.
   */
  bufferMinutes?: number | null;
  createdAt: string;
}

/** Waitlist entry for a fully-booked time slot */
export interface WaitlistEntry {
  id: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  locationId?: string;
  staffId?: string;
  createdAt: string;
  notified: boolean; // true once we've sent the "slot available" SMS
}

/** A referral or promotional code that gives clients a discount at checkout */
export interface PromoCode {
  id: string;
  code: string; // e.g. "SUMMER20"
  label: string; // e.g. "Summer Referral"
  percentage: number; // 0-100; if 0, use flatAmount
  flatAmount?: number | null; // flat dollar discount
  maxUses?: number | null; // null = unlimited
  usedCount: number;
  expiresAt?: string | null; // YYYY-MM-DD
  active: boolean;
  createdAt: string;
}

export interface CustomScheduleDay {
  date: string; // YYYY-MM-DD
  isOpen: boolean;
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  /** When set, this override applies only to this location. Null/undefined = global override. */
  locationId?: string | null;
}

export interface WorkingHours {
  enabled: boolean;
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface BusinessProfile {
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  /** City — stored alongside address for full-address SMS fallback */
  city?: string;
  /** State/Province — stored alongside address for full-address SMS fallback */
  state?: string;
  /** ZIP code — stored alongside address for full-address SMS fallback */
  zipCode?: string;
  description: string;
  website: string;
  /** Zelle phone/email handle for payment SMS */
  zelleHandle?: string;
  /** Cash App $handle for payment SMS */
  cashAppHandle?: string;
  /** Venmo @handle for payment SMS */
  venmoHandle?: string;
  /** Optional business logo URI (local file URI or remote S3 URL) shown on the public booking page */
  businessLogoUri?: string;
}

export interface CancellationPolicy {
  enabled: boolean;
  hoursBeforeAppointment: number; // e.g. 2 hours
  feePercentage: number; // e.g. 50 means 50% of service price
}

/** Per-event notification preferences for the business owner */
export interface NotificationPreferences {
  /** Push notification on new booking request */
  pushOnNewBooking: boolean;
  /** Push notification on client cancellation */
  pushOnCancellation: boolean;
  /** Push notification on client reschedule */
  pushOnReschedule: boolean;
  /** Push notification on waitlist entry */
  pushOnWaitlist: boolean;
  /** Email notification to business owner on new booking request */
  emailOnNewBooking: boolean;
  /** Email confirmation to client when business owner accepts appointment */
  emailClientOnConfirmation: boolean;
  /** Daily push notification listing clients with birthdays today */
  birthdayReminderEnabled?: boolean;
  /** Hour (0-23) at which the daily birthday reminder fires. Default 8 (8 AM) */
  birthdayReminderHour?: number;
  /** Push notification to business owner before their upcoming appointment */
  pushOnReminder?: boolean;
  /** Email reminder sent to the client before their confirmed appointment */
  emailOnReminder?: boolean;
  /** How many hours before the appointment to send the client reminder email.
   * Options: 12, 24, 48, 72, 168 (1 week). Default: 24. */
  reminderHoursBefore?: number;
  /** SMS to client when appointment is confirmed by owner */
  smsClientOnConfirmation?: boolean;
  /** SMS to client when appointment is cancelled */
  smsClientOnCancellation?: boolean;
  /** Email to client when appointment is cancelled */
  emailClientOnCancellation?: boolean;
  /** Email to client when appointment is marked completed */
  emailClientOnComplete?: boolean;
  /** SMS to client when appointment is marked as no-show */
  smsClientOnNoShow?: boolean;
  /** Email to client when owner marks appointment as paid (payment receipt) */
  emailClientOnPaymentConfirmed?: boolean;
}

/** Per-event SMS message templates. Each key maps to a custom message body.
 * The "Lime Of Time" footer is always appended automatically and cannot be removed.
 */
export interface SmsTemplates {
  confirmation?: string;   // sent when owner confirms/accepts appointment
  reminder?: string;       // sent as upcoming reminder
  cancellation?: string;   // sent when appointment is cancelled
  completed?: string;      // sent when appointment is marked complete
  newBooking?: string;     // sent to owner on new booking request (internal)
  followUp?: string;       // sent as a follow-up / re-booking nudge from client page
  noShow?: string;         // sent when appointment is marked as no-show
}
export const DEFAULT_SMS_TEMPLATES: SmsTemplates = {
  confirmation: undefined,
  reminder: undefined,
  cancellation: undefined,
  completed: undefined,
  newBooking: undefined,
  followUp: undefined,
  noShow: undefined,
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushOnNewBooking: true,
  pushOnCancellation: true,
  pushOnReschedule: true,
  pushOnWaitlist: true,
  emailOnNewBooking: false,
  emailClientOnConfirmation: false,
  birthdayReminderEnabled: true,
  birthdayReminderHour: 8,
  pushOnReminder: true,
  emailOnReminder: false,
  reminderHoursBefore: 24,
  smsClientOnConfirmation: false,
  smsClientOnCancellation: false,
  emailClientOnCancellation: false,
  emailClientOnComplete: false,
  smsClientOnNoShow: false,
  emailClientOnPaymentConfirmed: false,
};

/** An item in the in-app notification inbox */
export interface InboxNotification {
  id: string;
  type: "new_booking" | "cancelled_by_client" | "rescheduled_by_client";
  title: string;
  body: string;
  appointmentId?: string;
  clientName?: string;
  timestamp: string; // ISO string
  read: boolean;
}

export interface BusinessSettings {
  businessName: string;
  defaultDuration: number;
  notificationsEnabled: boolean;
  notificationPreferences: NotificationPreferences;
  workingHours: Record<string, WorkingHours>;
  profile: BusinessProfile;
  themeMode: "light" | "dark" | "system";
  cancellationPolicy: CancellationPolicy;
  onboardingComplete: boolean;
  temporaryClosed: boolean;
  businessLogoUri: string; // local URI for custom uploaded logo
  scheduleMode: "weekly" | "custom"; // which schedule drives availability
  bufferTime: number; // minutes between appointments (0 = no buffer)
  slotInterval: number; // time slot step in minutes (5, 10, 15, 30) — 0 means auto (match service duration, capped at 30)
  customSlug: string; // custom booking page slug
  businessHoursEndDate: string | null; // ISO date string "YYYY-MM-DD" or null for open-ended
  autoCompleteEnabled: boolean; // automatically mark appointments as completed after end time + delay
  autoCompleteDelayMinutes: number; // minutes after appointment end time to auto-complete (5, 10, 15, 30)
  smsTemplates: SmsTemplates; // custom SMS message templates per event type
  monthlyRevenueGoal: number; // monthly revenue target in dollars (0 = no goal set)
  staffAlertThreshold: number; // completion rate % below which staff alert fires (0 = disabled)
  // Twilio SMS integration (all optional so existing settings objects remain valid)
  twilioAccountSid?: string; // Twilio Account SID (starts with AC)
  twilioAuthToken?: string; // Twilio Auth Token
  twilioFromNumber?: string; // Twilio phone number in E.164 format e.g. +14124827733
  twilioEnabled?: boolean; // master on/off switch for Twilio SMS sending
  twilioBookingReminder?: boolean; // send reminder SMS before appointment
  twilioReminderHoursBeforeAppt?: number; // hours before appointment to send reminder (e.g. 24)
  twilioRebookingNudge?: boolean; // send rebooking nudge after appointment
  twilioRebookingNudgeDays?: number; // days after appointment to send rebooking nudge
  twilioBirthdaySms?: boolean; // send birthday SMS to clients
  // Email notification preferences (all optional so existing settings remain valid)
  emailNotifNewBooking?: boolean;    // receive email when a new booking is made
  emailNotifCancellation?: boolean;  // receive email when a booking is cancelled
  emailNotifReschedule?: boolean;    // receive email when a booking is rescheduled
  emailNotifReminder?: boolean;      // receive daily summary email of upcoming appointments
  emailNotifReview?: boolean;        // receive email when a client leaves a review
  emailNotifPayment?: boolean;       // receive email when a payment is received
  // Payment methods for booking page
  zelleHandle?: string; // Zelle phone/email handle
  cashAppHandle?: string; // CashApp $handle (include the $)
  venmoHandle?: string; // Venmo @handle (include the @)
  paymentNotes?: string; // free-text payment instructions shown on booking page
  // Social media handles
  instagramHandle?: string; // Instagram username (without @)
  facebookHandle?: string; // Facebook page name or URL slug
  tiktokHandle?: string; // TikTok username (without @)
  // Request response window
  requestResponseWindowHours?: number; // hours before a pending cancel/reschedule request auto-expires (default: 48)
  /** Number of days a publicly-purchased gift card is valid for. Default 90. */
  giftValidDays?: number;
  /** Custom emoji per category name. Key = category name, value = emoji string. */
  categoryEmojis?: Record<string, string>;
  /** Whether this business is visible in the client portal Discover tab */
  clientPortalVisible?: boolean;
  /** Business category for client portal discovery (e.g. "Hair Salon", "Barbershop") */
  businessCategory?: string | null;
}

/** A global reminder template that can be sent to clients for any appointment */
export type TemplateCategory =
  | "upcoming"
  | "confirmed"
  | "pending"
  | "cancelled"
  | "completed"
  | "no_show"
  | "reschedule";

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  upcoming:   "Upcoming Appointment",
  confirmed:  "Confirmed Appointment",
  pending:    "Pending / Awaiting Confirmation",
  cancelled:  "Cancelled Appointment",
  completed:  "Completed / Follow-up",
  no_show:    "No-Show",
  reschedule: "Reschedule",
};

/** Which categories are shown on the Send Reminder screen for each appointment status */
const ALL_TEMPLATE_CATEGORIES: TemplateCategory[] = ["upcoming", "confirmed", "pending", "cancelled", "completed", "no_show", "reschedule"];
export const STATUS_TEMPLATE_CATEGORIES: Record<string, TemplateCategory[]> = {
  pending:   ALL_TEMPLATE_CATEGORIES,
  confirmed: ALL_TEMPLATE_CATEGORIES,
  completed: ALL_TEMPLATE_CATEGORIES,
  cancelled: ALL_TEMPLATE_CATEGORIES,
  no_show:   ALL_TEMPLATE_CATEGORIES,
  upcoming:  ALL_TEMPLATE_CATEGORIES,
};

export interface ReminderTemplate {
  id: string;
  /** Label shown in the list e.g. "1 hour before" */
  label: string;
  /** Number of minutes before appointment this reminder is for (e.g. 60 = 1 hour before). 0 = custom/manual */
  minutesBefore: number;
  /** Custom SMS message body. If empty, a default is generated from appointment details */
  customMessage?: string;
  createdAt: string;
  /** Category this template belongs to */
  category?: TemplateCategory;
  /** Whether this template came from the built-in library (not user-created) */
  isLibrary?: boolean;
}

export const DEFAULT_REMINDER_TEMPLATES: ReminderTemplate[] = [
  {
    id: "rt-30m", label: "30 minutes before", minutesBefore: 30, category: "upcoming",
    createdAt: new Date().toISOString(),
    customMessage: "Dear {clientName},\n\nYour appointment begins in just 30 minutes \u2014 please head over now!\n\n\ud83d\udccb Service: {service}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe look forward to seeing you shortly!",
  },
  {
    id: "rt-1h", label: "1 hour before", minutesBefore: 60, category: "upcoming",
    createdAt: new Date().toISOString(),
    customMessage: "Dear {clientName},\n\nYour appointment is in 1 hour. Please start making your way over.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive a few minutes early. If you need to reschedule, contact us right away.",
  },
  {
    id: "rt-2h", label: "2 hours before", minutesBefore: 120, category: "upcoming",
    createdAt: new Date().toISOString(),
    customMessage: "Dear {clientName},\n\nThis is a reminder that your appointment is in 2 hours.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease ensure you are prepared and arrive 5 minutes early. We look forward to serving you.",
  },
  {
    id: "rt-6h", label: "6 hours before", minutesBefore: 360, category: "upcoming",
    createdAt: new Date().toISOString(),
    customMessage: "Dear {clientName},\n\nJust a reminder \u2014 your appointment is today in approximately 6 hours.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nIf you need to make any changes, please contact us right away.",
  },
  {
    id: "rt-24h", label: "24 hours before", minutesBefore: 1440, category: "upcoming",
    createdAt: new Date().toISOString(),
    customMessage: "Dear {clientName},\n\nThis is your 24-hour reminder for your appointment tomorrow. We look forward to seeing you!\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. If you need to reschedule or cancel, contact us as soon as possible.",
  },
];

/** Built-in template library — 54 professional SMS templates across 7 categories (not saved to user store by default) */
export const TEMPLATE_LIBRARY: ReminderTemplate[] = [
  // ─── UPCOMING (12 — includes 5 time-based) ──────────────────────────────────
  { id: "lib-up-t30m", label: "30 Minutes Before", minutesBefore: 30, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment begins in just 30 minutes \u2014 please head over now!\n\n\ud83d\udccb Service: {service}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe look forward to seeing you shortly!" },
  { id: "lib-up-t1h", label: "1 Hour Before", minutesBefore: 60, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is in 1 hour. Please start making your way over.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive a few minutes early. If you need to reschedule, contact us right away." },
  { id: "lib-up-t2h", label: "2 Hours Before", minutesBefore: 120, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is a reminder that your appointment is in 2 hours.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease ensure you are prepared and arrive 5 minutes early. We look forward to serving you." },
  { id: "lib-up-t6h", label: "6 Hours Before", minutesBefore: 360, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nJust a reminder \u2014 your appointment is today in approximately 6 hours.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nIf you need to make any changes, please contact us right away." },
  { id: "lib-up-t24h", label: "24 Hours Before", minutesBefore: 1440, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is your 24-hour reminder for your appointment tomorrow. We look forward to seeing you!\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. If you need to reschedule or cancel, contact us as soon as possible." },
  { id: "lib-up-1", label: "Standard Reminder", minutesBefore: 1440, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is a friendly reminder about your upcoming appointment.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease reply CONFIRM to confirm or CANCEL to cancel. We look forward to seeing you!" },
  { id: "lib-up-2", label: "Same-Day Reminder", minutesBefore: 120, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nJust a reminder \u2014 your appointment is today!\n\n\ud83d\udccb Service: {service}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. We look forward to seeing you!" },
  { id: "lib-up-3", label: "Location & Directions", minutesBefore: 1440, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nHere are your appointment details and directions.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nIf you need directions or have any questions, please do not hesitate to contact us." },
  { id: "lib-up-4", label: "Preparation Reminder", minutesBefore: 1440, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is coming up. Please ensure you are prepared.\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early and ensure you are ready for your session. We look forward to serving you." },
  { id: "lib-up-5", label: "48-Hour Advance Notice", minutesBefore: 2880, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is in 2 days. We want to make sure you are ready!\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us if you need to make any changes." },
  { id: "lib-up-6", label: "1-Hour Reminder", minutesBefore: 60, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment begins in 1 hour. Please start making your way over.\n\n\ud83d\udccb Service: {service}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe look forward to seeing you shortly!" },
  { id: "lib-up-7", label: "Friendly Nudge", minutesBefore: 1440, category: "upcoming", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe are looking forward to your upcoming appointment!\n\n\ud83d\udccb Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nIf anything changes, please let us know as soon as possible. Thank you!" },

  // ─── CONFIRMED (7) ──────────────────────────────────────────────────────────
  { id: "lib-co-1", label: "Booking Confirmation", minutesBefore: 0, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment has been confirmed. We look forward to seeing you!\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. If you need to reschedule, contact us as soon as possible." },
  { id: "lib-co-2", label: "Confirmation with Payment", minutesBefore: 0, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is confirmed and your payment details are below.\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nThank you for your payment. We look forward to serving you!" },
  { id: "lib-co-3", label: "What to Bring", minutesBefore: 1440, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is confirmed. Here is a reminder of what to bring.\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease remember to bring any relevant documents or items for your session." },
  { id: "lib-co-4", label: "Deposit Reminder", minutesBefore: 0, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is confirmed. A deposit is required to secure your booking.\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us to arrange your deposit at your earliest convenience." },
  { id: "lib-co-5", label: "Confirmation with Staff", minutesBefore: 0, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is confirmed. We are excited to serve you!\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. We look forward to seeing you!" },
  { id: "lib-co-6", label: "Policy Reminder", minutesBefore: 1440, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is confirmed. Please review our cancellation policy.\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease note that cancellations within 24 hours may be subject to a fee. Contact us if you need to reschedule." },
  { id: "lib-co-7", label: "Confirmation Summary", minutesBefore: 0, category: "confirmed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nBooking confirmed! Here is your full appointment summary.\n\n\u2705 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nSee you soon!" },

  // ─── PENDING (7) ────────────────────────────────────────────────────────────
  { id: "lib-pe-1", label: "Awaiting Confirmation", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment request has been received and is pending confirmation.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe will notify you as soon as your appointment is confirmed." },
  { id: "lib-pe-2", label: "Action Required", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment requires your confirmation. Please respond at your earliest convenience.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease reply YES to confirm or NO to cancel." },
  { id: "lib-pe-3", label: "Booking Request Received", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe have received your booking request and are reviewing it now.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe will confirm your appointment shortly. Thank you for your patience." },
  { id: "lib-pe-4", label: "Pending Follow-up", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is still pending. Please contact us to confirm or reschedule.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease respond at your earliest convenience." },
  { id: "lib-pe-5", label: "Deposit Pending", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment is pending. A deposit is required to secure your booking.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us to arrange your deposit and confirm your booking." },
  { id: "lib-pe-6", label: "Availability Check", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe are checking availability for your requested appointment time.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Requested Date: {date}\n\u23f0 Requested Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe will confirm your appointment as soon as possible. Thank you for your patience." },
  { id: "lib-pe-7", label: "Reminder to Confirm", minutesBefore: 0, category: "pending", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is a reminder that your appointment is awaiting your confirmation.\n\n\ud83d\udd52 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease respond at your earliest convenience to secure your spot." },

  // ─── CANCELLED (7) ──────────────────────────────────────────────────────────
  { id: "lib-ca-1", label: "Cancellation Notice", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment has been cancelled. We are sorry for any inconvenience.\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us to reschedule at your convenience." },
  { id: "lib-ca-2", label: "Rebooking Invitation", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe noticed your appointment was cancelled. We would love to have you back!\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Book again: {bookingUrl}\n\nWe are here whenever you are ready. We hope to see you soon!" },
  { id: "lib-ca-3", label: "Waitlist Offer", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment has been cancelled. We have added you to our waitlist.\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe will notify you as soon as a new slot becomes available. Thank you for your patience." },
  { id: "lib-ca-4", label: "Cancellation with Fee Notice", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment has been cancelled. Please note that a cancellation fee may apply.\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us if you have any questions regarding our cancellation policy." },
  { id: "lib-ca-5", label: "Apology & Rebook", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe sincerely apologize for the cancellation of your appointment. We would like to make it right.\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Rebook: {bookingUrl}\n\nPlease contact us to reschedule at a time that works for you. Thank you for your understanding." },
  { id: "lib-ca-6", label: "Business-Initiated Cancel", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe regret to inform you that your appointment has been cancelled due to unforeseen circumstances.\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe sincerely apologize for the inconvenience and will contact you to reschedule as soon as possible." },
  { id: "lib-ca-7", label: "Final Cancellation Notice", minutesBefore: 0, category: "cancelled", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is to confirm that your appointment has been cancelled as requested.\n\n\u274c Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe hope to serve you again in the future. Please do not hesitate to reach out whenever you are ready to book." },

  // ─── COMPLETED / FOLLOW-UP (7) ──────────────────────────────────────────────
  { id: "lib-cm-1", label: "Thank You", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThank you for visiting us! We hope you had a wonderful experience.\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe look forward to seeing you again soon!" },
  { id: "lib-cm-2", label: "Rebook Reminder", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nIt was a pleasure serving you! When you are ready for your next appointment, we are here.\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Book again: {bookingUrl}\n\nWe look forward to your next visit!" },
  { id: "lib-cm-3", label: "Review Request", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThank you for your recent appointment. Your feedback means the world to us!\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\u2b50 Leave a review: {reviewUrl}\n\nThank you for taking a moment to share your experience!" },
  { id: "lib-cm-4", label: "Loyalty Appreciation", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThank you for your continued loyalty. It is always a pleasure to serve you.\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nAs a valued client, we truly appreciate your trust in us. We look forward to your next visit!" },
  { id: "lib-cm-5", label: "Next Appointment Suggestion", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThank you for your appointment. Based on your service, we recommend scheduling your next visit soon.\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Book your next visit: {bookingUrl}\n\nWe recommend scheduling your next appointment in 4\u20136 weeks. Contact us whenever you are ready!" },
  { id: "lib-cm-6", label: "Aftercare Instructions", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThank you for your appointment today. Here are a few aftercare reminders.\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease follow any aftercare instructions provided during your visit. Do not hesitate to contact us if you have any questions or concerns." },
  { id: "lib-cm-7", label: "Special Offer for Next Visit", minutesBefore: 0, category: "completed", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThank you for your recent visit! As a valued client, we have a special offer for you.\n\n\u2728 Service: {service}\n\ud83d\udcc5 Date: {date}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Book your next visit: {bookingUrl}\n\nContact us to learn about your exclusive discount on your next appointment!" },

  // ─── NO-SHOW (7) ────────────────────────────────────────────────────────────
  { id: "lib-ns-1", label: "Missed Appointment Notice", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe noticed you were unable to make your appointment. We understand things come up.\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us to reschedule at your convenience." },
  { id: "lib-ns-2", label: "Reschedule Offer", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe missed you at your appointment! We would be happy to reschedule.\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Rebook: {bookingUrl}\n\nPlease contact us at your earliest convenience to arrange a new time." },
  { id: "lib-ns-3", label: "Final Notice", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is a final notice regarding your missed appointment.\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us to reschedule or to discuss any concerns. We value your business." },
  { id: "lib-ns-4", label: "Gentle Follow-up", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe hope everything is well. We missed you at your appointment and wanted to check in.\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease let us know if you would like to reschedule. We are here to help!" },
  { id: "lib-ns-5", label: "No-Show Fee Notice", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe are following up regarding your missed appointment. Please be aware that a no-show fee may apply.\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us to discuss your account and reschedule at your convenience." },
  { id: "lib-ns-6", label: "Rebooking Invitation", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe missed you and would love to have you back!\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\ud83d\udd17 Book again: {bookingUrl}\n\nWe are here whenever you are ready. We hope to see you soon!" },
  { id: "lib-ns-7", label: "Check-In", minutesBefore: 0, category: "no_show", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe wanted to check in after your missed appointment. Is there anything we can do to help?\n\n\ud83d\uddd3 Service: {service}\n\ud83d\udcc5 Date: {date}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nIf there is anything we can do to accommodate your schedule, please do not hesitate to reach out." },

  // ─── RESCHEDULE (7) ─────────────────────────────────────────────────────────
  { id: "lib-rs-1", label: "Appointment Rescheduled", minutesBefore: 0, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour appointment has been rescheduled. Here are your updated details.\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 New Date: {date}\n\u23f0 New Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us if this does not work for you." },
  { id: "lib-rs-2", label: "New Time Confirmation", minutesBefore: 0, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is to confirm your rescheduled appointment. We look forward to seeing you!\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 New Date: {date}\n\u23f0 New Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. We look forward to serving you!" },
  { id: "lib-rs-3", label: "Apology & New Time", minutesBefore: 0, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe sincerely apologize for the change to your appointment. Here are your new details.\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 New Date: {date}\n\u23f0 New Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nThank you for your understanding and flexibility." },
  { id: "lib-rs-4", label: "Reschedule Request", minutesBefore: 0, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nWe would like to reschedule your appointment. Please contact us to arrange a new time.\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 Original Date: {date}\n\u23f0 Original Time: {time}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease contact us at your earliest convenience to arrange a new appointment time." },
  { id: "lib-rs-5", label: "Client-Initiated Reschedule", minutesBefore: 0, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nAs requested, your appointment has been rescheduled. Here are your new details.\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 New Date: {date}\n\u23f0 New Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nWe look forward to seeing you then!" },
  { id: "lib-rs-6", label: "Reschedule Confirmation", minutesBefore: 0, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nYour rescheduled appointment is confirmed. We look forward to seeing you!\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 New Date: {date}\n\u23f0 New Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive on time. We look forward to serving you!" },
  { id: "lib-rs-7", label: "Reschedule Reminder", minutesBefore: 1440, category: "reschedule", isLibrary: true, createdAt: "",
    customMessage: "Dear {clientName},\n\nThis is a reminder that your rescheduled appointment is tomorrow.\n\n\ud83d\udd04 Service: {service}\n\ud83d\udcc5 Date: {date}\n\u23f0 Time: {time}\n\ud83d\udccd Location: {location}\n{priceLine}\n\ud83c\udfe2 {businessName}\n\ud83d\udcde {phone}\n\nPlease arrive 5 minutes early. We look forward to seeing you!" },
];

export const SERVICE_COLORS = [
  "#4CAF50",
  "#2E7D32",
  "#8BC34A",
  "#FF9800",
  "#2196F3",
  "#9C27B0",
];

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  enabled: false,
  hoursBeforeAppointment: 2,
  feePercentage: 50,
};

export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  ownerName: "",
  phone: "",
  email: "",
  address: "",
  description: "",
  website: "",
};

export const DEFAULT_WORKING_HOURS: Record<string, WorkingHours> = {
  monday: { enabled: true, start: "09:00", end: "17:00" },
  tuesday: { enabled: true, start: "09:00", end: "17:00" },
  wednesday: { enabled: true, start: "09:00", end: "17:00" },
  thursday: { enabled: true, start: "09:00", end: "17:00" },
  friday: { enabled: true, start: "09:00", end: "17:00" },
  saturday: { enabled: false, start: "10:00", end: "14:00" },
  sunday: { enabled: false, start: "10:00", end: "14:00" },
};

export const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

// ─── Phone Normalization ────────────────────────────────────────────────
/** Normalize a phone number to 10-digit US format for consistent matching.
 *  "4124820000" -> "4124820000"
 *  "+14124820000" -> "4124820000"
 *  "14124820000" -> "4124820000"
 *  "(412) 482-0000" -> "4124820000" */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  if (digits.length === 10) {
    return digits;
  }
  return digits;
}

// ─── Phone Formatting ────────────────────────────────────────────────────
/** Format a phone number to (000) 000-0000 or +1 (000) 000-0000 format.
 *  Handles US numbers with or without country code (+1 or leading 1). */
export function formatPhoneNumber(value: string): string {
  // Strip all non-digit characters
  let digits = value.replace(/\D/g, "");
  // Detect +1 prefix in original value
  const hasPlus1 = value.replace(/\s/g, "").startsWith("+1");
  // If 11 digits starting with 1, or original had +1, treat as US +1 number
  let prefix = "";
  if (hasPlus1 || (digits.length === 11 && digits.startsWith("1"))) {
    prefix = "+1 ";
    // Strip the leading country code 1
    if (digits.startsWith("1") && digits.length > 10) {
      digits = digits.slice(1);
    }
  }
  // Limit to 10 digits (the local part)
  const limited = digits.slice(0, 10);
  if (limited.length === 0) return prefix ? "+1" : "";
  if (limited.length <= 3) return `${prefix}(${limited}`;
  if (limited.length <= 6) return `${prefix}(${limited.slice(0, 3)}) ${limited.slice(3)}`;
  return `${prefix}(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
}

/** Strip phone formatting to get raw digits (keeps country code digit if present) */
export function stripPhoneFormat(formatted: string): string {
  return formatted.replace(/\D/g, "");
}

// ─── Address Formatting ────────────────────────────────────────────────
/**
 * Formats separate address components into a single clean address string.
 * e.g. "123 S Main St", "Pittsburgh", "PA", "15220" → "123 S Main St, Pittsburgh, PA 15220"
 */
export function formatFullAddress(
  address: string,
  city?: string,
  state?: string,
  zipCode?: string
): string {
  const streetPart = address?.trim() || "";
  const stateZip = [state?.trim(), zipCode?.trim()].filter(Boolean).join(" ");
  const cityStatePart = [city?.trim(), stateZip].filter(Boolean).join(", ");
  return [streetPart, cityStatePart].filter(Boolean).join(", ");
}

// ─── Map URL Helper ────────────────────────────────────────────────
/** Generate a map URL that opens in the device's default map app */
export function getMapUrl(address: string): string {
  const encoded = encodeURIComponent(address);
  return `https://maps.google.com/?q=${encoded}`;
}

// ─── Time Helpers ───────────────────────────────────────────────────
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Check if two time ranges overlap: [startA, startA+durA) vs [startB, startB+durB) */
export function timeSlotsOverlap(
  startA: string,
  durationA: number,
  startB: string,
  durationB: number
): boolean {
  const aStart = timeToMinutes(startA);
  const aEnd = aStart + durationA;
  const bStart = timeToMinutes(startB);
  const bEnd = bStart + durationB;
  return aStart < bEnd && bStart < aEnd;
}

/** Filter slots by past times and existing appointments (with optional buffer time) */
function filterSlots(
  slots: string[],
  date: string,
  serviceDuration: number,
  appointments: Appointment[],
  bufferTime: number = 0
): string[] {
  let filtered = [...slots];
  // Filter out past times for today (using device local time, which is always correct on-device)
  // Only show slots that start strictly in the future (current minute is already in progress)
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (date === todayStr) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    filtered = filtered.filter((s) => timeToMinutes(s) > currentMinutes);
  }
  // Filter out slots that overlap with existing non-cancelled appointments
  const dayAppointments = appointments.filter(
    (a) => a.date === date && a.status !== "cancelled"
  );
  return filtered.filter((slot) => {
    const slotStart = timeToMinutes(slot);
    const slotEnd = slotStart + serviceDuration;
    return !dayAppointments.some((a) => {
      const apptStart = timeToMinutes(a.time);
      const apptEnd = apptStart + a.duration;
      // Buffer applies ONLY after an appointment ends (not before it starts).
      // A slot is blocked if:
      //   - it overlaps the appointment itself (slotStart < apptEnd && slotEnd > apptStart), OR
      //   - it starts within bufferTime minutes after the appointment ends
      //     (i.e., slotStart < apptEnd + bufferTime)
      // But we do NOT block slots that end within bufferTime of the appointment start.
      return slotStart < (apptEnd + bufferTime) && slotEnd > apptStart;
    });
  });
}

/**
 * Calendar-page slot generator: produces slots that restart at appointment_end + buffer
 * after each existing appointment, rather than using a fixed grid from day start.
 *
 * Algorithm:
 *  1. Build a sorted list of "blocked segments" from existing appointments + buffer.
 *  2. Walk through the day in segments of free time.
 *  3. Within each free segment, generate slots starting at the segment start,
 *     spaced by stepMinutes, stopping when slot_start + serviceDuration > segment_end.
 *
 * This ensures that after a 6:00–7:30 appointment with 15m buffer, the next slot
 * is exactly 7:45 (not 8:00), and continues at 8:15, 8:45, etc. for 30m interval.
 */
export function generateCalendarSlots(
  date: string,
  serviceDuration: number,
  workingHours: Record<string, WorkingHours> | null | undefined,
  appointments: Appointment[],
  stepMinutes: number = 30,
  customSchedule?: CustomScheduleDay[],
  scheduleMode: "weekly" | "custom" = "weekly",
  bufferTime: number = 0
): string[] {
  const safeStep = Math.max(1, Math.floor(stepMinutes) || 30);
  const safeDuration = Math.max(1, Math.floor(serviceDuration) || 30);
  const resolvedWorkingHours: Record<string, WorkingHours> = workingHours ?? DEFAULT_WORKING_HOURS;
  const customDay = customSchedule?.find((cs) => cs.date === date);

  // Resolve the workday start/end minutes
  let dayStartMin: number;
  let dayEndMin: number;
  let isOpen = false;

  if (scheduleMode === "custom") {
    if (!customDay || !customDay.isOpen || !customDay.startTime || !customDay.endTime) return [];
    dayStartMin = timeToMinutes(customDay.startTime);
    dayEndMin = timeToMinutes(customDay.endTime);
    isOpen = true;
  } else if (customDay) {
    if (!customDay.isOpen) return [];
    if (customDay.startTime && customDay.endTime) {
      dayStartMin = timeToMinutes(customDay.startTime);
      dayEndMin = timeToMinutes(customDay.endTime);
      isOpen = true;
    } else {
      // Workday ON but no explicit hours — fall back to weekly
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const d2 = new Date(date + "T12:00:00");
      const dn2 = DAYS_OF_WEEK[d2.getDay()];
      if (!dn2) return [];
      const wh2 = resolvedWorkingHours[dn2] || resolvedWorkingHours[dn2.toLowerCase()];
      dayStartMin = timeToMinutes(wh2?.start ?? "09:00");
      dayEndMin = timeToMinutes(wh2?.end ?? "17:00");
      isOpen = true;
    }
  } else {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const d = new Date(date + "T12:00:00");
    const dn = DAYS_OF_WEEK[d.getDay()];
    if (!dn) return [];
    const wh = resolvedWorkingHours[dn] || resolvedWorkingHours[dn.toLowerCase()];
    if (!wh || !wh.enabled) return [];
    dayStartMin = timeToMinutes(wh.start);
    dayEndMin = timeToMinutes(wh.end);
    isOpen = true;
  }

  if (!isOpen) return [];

  // Build sorted blocked segments from non-cancelled appointments on this day
  const dayAppts = appointments
    .filter((a) => a.date === date && a.status !== "cancelled")
    .map((a) => ({
      start: timeToMinutes(a.time),
      end: timeToMinutes(a.time) + a.duration + bufferTime,
    }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping blocked segments
  const blocked: { start: number; end: number }[] = [];
  for (const seg of dayAppts) {
    if (blocked.length > 0 && seg.start < blocked[blocked.length - 1].end) {
      blocked[blocked.length - 1].end = Math.max(blocked[blocked.length - 1].end, seg.end);
    } else {
      blocked.push({ ...seg });
    }
  }

  // Build free segments between blocked ones
  const freeSegments: { start: number; end: number }[] = [];
  let cursor = dayStartMin;
  for (const blk of blocked) {
    if (cursor < blk.start) {
      freeSegments.push({ start: cursor, end: blk.start });
    }
    cursor = Math.max(cursor, blk.end);
  }
  if (cursor < dayEndMin) {
    freeSegments.push({ start: cursor, end: dayEndMin });
  }

  // Generate slots within each free segment
  const slots: string[] = [];
  for (const seg of freeSegments) {
    for (let min = seg.start; min + safeDuration <= seg.end; min += safeStep) {
      slots.push(minutesToTime(min));
    }
  }

  // Filter out past times for today
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (date === todayStr) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return slots.filter((s) => timeToMinutes(s) > currentMinutes);
  }
  return slots;
}

/** Generate available time slots for a given date, considering working hours, custom schedule overrides, existing appointments, and past-time filtering.
 *  When scheduleMode is "custom", ONLY custom schedule entries are used (no weekly fallback).
 *  When scheduleMode is "weekly" (default), custom overrides take precedence for specific dates, then weekly hours are used. */
export function generateAvailableSlots(
  date: string,
  serviceDuration: number,
  workingHours: Record<string, WorkingHours> | null | undefined,
  appointments: Appointment[],
  stepMinutes: number = 30,
  customSchedule?: CustomScheduleDay[],
  scheduleMode: "weekly" | "custom" = "weekly",
  bufferTime: number = 0
): string[] {
  // Guard: ensure stepMinutes and serviceDuration are positive to prevent infinite loops
  const safeStep = Math.max(1, Math.floor(stepMinutes) || 30);
  const safeDuration = Math.max(1, Math.floor(serviceDuration) || 30);
  stepMinutes = safeStep;
  serviceDuration = safeDuration;
  // Guard: if workingHours is null/undefined, fall back to DEFAULT_WORKING_HOURS
  const resolvedWorkingHours: Record<string, WorkingHours> = workingHours ?? DEFAULT_WORKING_HOURS;
  const customDay = customSchedule?.find((cs) => cs.date === date);

  if (scheduleMode === "custom") {
    // In custom mode, ONLY custom schedule entries matter — no weekly fallback
    if (!customDay) return []; // No custom entry for this date = closed
    if (!customDay.isOpen) return []; // Explicitly closed
    if (customDay.startTime && customDay.endTime) {
      const startMin = timeToMinutes(customDay.startTime);
      const endMin = timeToMinutes(customDay.endTime);
      const slots: string[] = [];
      for (let min = startMin; min + serviceDuration <= endMin; min += stepMinutes) {
        slots.push(minutesToTime(min));
      }
      return filterSlots(slots, date, serviceDuration, appointments, bufferTime);
    }
    return []; // Custom entry exists but no hours set
  }

  // Weekly mode: custom overrides take precedence for specific dates
  if (customDay) {
    if (!customDay.isOpen) return [];
    if (customDay.startTime && customDay.endTime) {
      // Workday is ON with explicit custom hours — use them regardless of weekly schedule
      const startMin = timeToMinutes(customDay.startTime);
      const endMin = timeToMinutes(customDay.endTime);
      const slots: string[] = [];
      for (let min = startMin; min + serviceDuration <= endMin; min += stepMinutes) {
        slots.push(minutesToTime(min));
      }
      return filterSlots(slots, date, serviceDuration, appointments, bufferTime);
    }
    // Workday is ON but no explicit hours set — use weekly hours as fallback.
    // IMPORTANT: we still proceed even if the weekly day is normally disabled,
    // because the Workday override explicitly opens this date.
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const dateObj2 = new Date(date + "T12:00:00");
    const dayIndex2 = dateObj2.getDay();
    const dayName2 = DAYS_OF_WEEK[dayIndex2];
    if (!dayName2) return []; // safety guard for invalid date
    const wh2 = resolvedWorkingHours[dayName2] || resolvedWorkingHours[dayName2.toLowerCase()];
    const fallbackStart = wh2?.start ?? "09:00";
    const fallbackEnd = wh2?.end ?? "17:00";
    const startMin2 = timeToMinutes(fallbackStart);
    const endMin2 = timeToMinutes(fallbackEnd);
    const slots2: string[] = [];
    for (let min = startMin2; min + serviceDuration <= endMin2; min += stepMinutes) {
      slots2.push(minutesToTime(min));
    }
    return filterSlots(slots2, date, serviceDuration, appointments, bufferTime);
  }

  // Fall back to weekly working hours
  // Guard: if date is empty or invalid, getDay() returns NaN and DAYS_OF_WEEK[NaN] is undefined
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const dateObj = new Date(date + "T12:00:00");
  const dayIndex = dateObj.getDay();
  const dayName = DAYS_OF_WEEK[dayIndex];
  if (!dayName) return []; // safety guard for invalid date
  const wh = resolvedWorkingHours[dayName] || resolvedWorkingHours[dayName.toLowerCase()];
  if (!wh || !wh.enabled) return [];

  const startMin = timeToMinutes(wh.start);
  const endMin = timeToMinutes(wh.end);
  const slots: string[] = [];

  for (let min = startMin; min + serviceDuration <= endMin; min += stepMinutes) {
    slots.push(minutesToTime(min));
  }

  return filterSlots(slots, date, serviceDuration, appointments, bufferTime);
}

/** Get applicable discount for a given time slot, date, and service */
export function getApplicableDiscount(
  discounts: Discount[],
  date: string,
  time: string,
  serviceId: string,
  appointments?: { discountName?: string; status?: string }[]
): Discount | null {
  const dateObj = new Date(date + "T12:00:00");
  const dayIndex = dateObj.getDay();
  const dayName = DAYS_OF_WEEK[dayIndex];
  const timeMin = timeToMinutes(time);

  for (const disc of discounts) {
    if (!disc.active) continue;
    // Check specific dates first (new system)
    if (disc.dates && disc.dates.length > 0) {
      if (!disc.dates.includes(date)) continue;
    } else if (disc.daysOfWeek.length > 0) {
      // Legacy: check day of week
      if (!disc.daysOfWeek.includes(dayName)) continue;
    }
    // Check time window
    const discStart = timeToMinutes(disc.startTime);
    const discEnd = timeToMinutes(disc.endTime);
    if (timeMin < discStart || timeMin >= discEnd) continue;
    // Check service filter
    if (disc.serviceIds && disc.serviceIds.length > 0 && !disc.serviceIds.includes(serviceId)) continue;
    // Check maxUses: count all appointments (any status except cancelled) that used this discount
    if (disc.maxUses != null && appointments) {
      const usedCount = appointments.filter(
        (a) => a.discountName === disc.name && a.status !== "cancelled"
      ).length;
      if (usedCount >= disc.maxUses) continue;
    }
    return disc;
  }
  return null;
}

/** Generate a unique gift card code */
export function generateGiftCardCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "GIFT-";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/** Generate all time options for a scrolling time picker (every 30 min from 00:00 to 23:30) */
export function generateAllTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      options.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return options;
}

/** Format a date string for display in messages: "Monday, January 15, 2026" */
export function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Format time for display: "9:00 AM" */
export function formatTimeDisplay(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Get service display name with duration: "Haircut (20 min)" */
export function getServiceDisplayName(service: Service): string {
  return `${service.name} (${service.duration} min)`;
}

/** Check if a date string is in the past (before today) */
export function isDateInPast(dateStr: string): boolean {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return dateStr < todayStr;
}

/** Generate professional appointment confirmation message */
export function generateConfirmationMessage(
  businessName: string,
  address: string,
  clientName: string,
  serviceName: string,
  serviceDuration: number,
  date: string,
  time: string,
  businessPhone: string,
  clientPhone?: string,
  locationName?: string,
  locationId?: string,
  customSlug?: string,
  city?: string,
  state?: string,
  zipCode?: string
): string {
  const endTime = formatTimeDisplay(minutesToTime(timeToMinutes(time) + serviceDuration));
  const slug = customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  const reviewParams = new URLSearchParams();
  if (clientName) reviewParams.set("name", clientName);
  if (clientPhone) reviewParams.set("phone", stripPhoneFormat(clientPhone));
  const reviewUrl = `${PUBLIC_BOOKING_URL}/review/${slug}${reviewParams.toString() ? "?" + reviewParams.toString() : ""}`;
  const fullAddr = formatFullAddress(address, city, state, zipCode);
  const locationLine = locationName
    ? (fullAddr ? `${locationName} — ${fullAddr}` : locationName)
    : fullAddr;
  const bookingUrl = locationId
    ? `${PUBLIC_BOOKING_URL}/book/${slug}?location=${locationId}`
    : `${PUBLIC_BOOKING_URL}/book/${slug}`;
  return `Dear ${clientName},\n\nYour appointment has been confirmed!\n\n📋 Service: ${serviceName} (${serviceDuration} min)\n📅 Date: ${formatDateLong(date)}\n⏰ Time: ${formatTimeDisplay(time)} - ${endTime}\n📍 Location: ${locationLine}\n🏢 Business: ${businessName}\n📞 Contact: ${formatPhoneNumber(stripPhoneFormat(businessPhone))}\n\nPlease arrive 5 minutes early. If you need to reschedule or cancel, please contact us at least 2 hours before your appointment.\n\n🔗 Book again: ${bookingUrl}\n⭐ After your visit, leave a review: ${reviewUrl}\n\nThank you for choosing ${businessName}!`;
}

/** Generate professional appointment request accepted message */
export function generateAcceptMessage(
  businessName: string,
  address: string,
  clientName: string,
  serviceName: string,
  serviceDuration: number,
  date: string,
  time: string,
  businessPhone: string,
  clientPhone?: string,
  appointmentId?: string,
  locationName?: string,
  locationId?: string,
  customSlug?: string,
  city?: string,
  state?: string,
  zipCode?: string,
  zelleHandle?: string,
  cashAppHandle?: string,
  venmoHandle?: string
): string {
  const endTime = formatTimeDisplay(minutesToTime(timeToMinutes(time) + serviceDuration));
  const slug = customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  const reviewParams = new URLSearchParams();
  if (clientName) reviewParams.set("name", clientName);
  if (clientPhone) reviewParams.set("phone", stripPhoneFormat(clientPhone));
  const reviewUrl = `${PUBLIC_BOOKING_URL}/review/${slug}${reviewParams.toString() ? "?" + reviewParams.toString() : ""}`;
  const manageUrl = appointmentId ? `${PUBLIC_BOOKING_URL}/manage/${slug}/${appointmentId}` : "";
  const fullAddr = formatFullAddress(address, city, state, zipCode);
  const locationLine = locationName
    ? (fullAddr ? `${locationName} — ${fullAddr}` : locationName)
    : fullAddr;
  // Build payment handles line
  const paymentLines: string[] = [];
  if (zelleHandle) paymentLines.push(`💳 Zelle: ${zelleHandle}`);
  if (cashAppHandle) paymentLines.push(`💵 Cash App: ${cashAppHandle}`);
  if (venmoHandle) paymentLines.push(`💸 Venmo: ${venmoHandle}`);
  const paymentSection = paymentLines.length > 0
    ? `\n\n💰 Payment Options:\n${paymentLines.join("\n")}`
    : "";
  return `Dear ${clientName},\n\nGreat news! Your appointment request has been accepted.\n\n📋 Service: ${serviceName} (${serviceDuration} min)\n📅 Date: ${formatDateLong(date)}\n⏰ Time: ${formatTimeDisplay(time)} - ${endTime}\n📍 Location: ${locationLine}\n🏢 Business: ${businessName}\n📞 Contact: ${formatPhoneNumber(stripPhoneFormat(businessPhone))}${paymentSection}\n\nPlease arrive 5 minutes early.${manageUrl ? `\n\n🔄 Need to reschedule or cancel? Use this link (available 24+ hours before your appointment):\n${manageUrl}` : ""}\n\n⭐ After your visit, leave a review: ${reviewUrl}\n\nWe look forward to seeing you!\n${businessName}`;
}

/** Generate professional appointment rejection message */
export function generateRejectMessage(
  businessName: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string,
  businessPhone: string,
  locationName?: string,
  locationAddress?: string,
  locationCity?: string,
  locationState?: string,
  locationZip?: string
): string {
  const fullAddr = formatFullAddress(locationAddress ?? "", locationCity, locationState, locationZip);
  const locationLine = locationName
    ? (fullAddr ? `${locationName} — ${fullAddr}` : locationName)
    : fullAddr;
  const locationRow = locationLine ? `\n📍 Location: ${locationLine}` : "";
  return `Dear ${clientName},\n\nWe regret to inform you that your appointment request could not be accommodated at this time.\n\n📋 Service: ${serviceName}\n📅 Requested Date: ${formatDateLong(date)}\n⏰ Requested Time: ${formatTimeDisplay(time)}${locationRow}\n\nWe apologize for any inconvenience. Please feel free to book another available time slot through our scheduling page or contact us directly.\n\n📞 Contact: ${formatPhoneNumber(stripPhoneFormat(businessPhone))}\n\nThank you for your understanding.\n${businessName}`;
}

/** Generate professional cancellation message */
export function generateCancellationMessage(
  businessName: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string,
  cancellationFee: string,
  businessPhone: string,
  locationName?: string,
  locationAddress?: string,
  locationCity?: string,
  locationState?: string,
  locationZip?: string
): string {
  const feeNote = cancellationFee
    ? `\n\n⚠️ Cancellation Fee: ${cancellationFee}\nAs per our cancellation policy, a fee applies for cancellations made within the required notice period.`
    : "";
  const fullAddr = formatFullAddress(locationAddress ?? "", locationCity, locationState, locationZip);
  const locationLine = locationName
    ? (fullAddr ? `${locationName} — ${fullAddr}` : locationName)
    : fullAddr;
  const locationRow = locationLine ? `\n📍 Location: ${locationLine}` : "";
  return `Dear ${clientName},\n\nYour appointment has been cancelled.\n\n📋 Service: ${serviceName}\n📅 Date: ${formatDateLong(date)}\n⏰ Time: ${formatTimeDisplay(time)}${locationRow}${feeNote}\n\nIf you would like to reschedule, please visit our booking page or contact us directly.\n\n📞 Contact: ${formatPhoneNumber(stripPhoneFormat(businessPhone))}\n\nThank you.\n${businessName}`;
}

/**
 * Build a smart pricing block for SMS templates.
 * - Shows full breakdown when discount/gift/promo is applied.
 * - Shows just the total when no adjustments.
 * - Distinguishes "Total Paid" vs "Amount Due" based on paymentStatus.
 */
export function buildPriceLine(opts: {
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
    // Simple case — just show total
    if (totalPrice != null) {
      return `💰 ${totalLabel}: $${totalPrice.toFixed(2)}`;
    }
    return "💰 Total: See invoice";
  }

  // Full breakdown
  const lines: string[] = [];
  if (totalPrice != null) {
    // Reconstruct subtotal
    const subtotal = totalPrice + (discountAmount ?? 0) + (giftUsedAmount ?? 0);
    lines.push(`💰 Subtotal: $${subtotal.toFixed(2)}`);
    if (hasDiscount) {
      const label = discountName ? `Discount (${discountName})` : "Discount";
      lines.push(`🏷️ ${label}: -$${(discountAmount as number).toFixed(2)}`);
    }
    if (hasGift) {
      lines.push(`🎁 Gift Card Applied: -$${(giftUsedAmount as number).toFixed(2)}`);
    }
    lines.push(`✅ ${totalLabel}: $${totalPrice.toFixed(2)}`);
  } else {
    lines.push("💰 Total: See invoice");
  }
  return lines.join("\n");
}

/** Generate professional upcoming reminder message */
export function generateReminderMessage(
  businessName: string,
  address: string,
  clientName: string,
  serviceName: string,
  serviceDuration: number,
  date: string,
  time: string,
  businessPhone: string,
  locationName?: string,
  city?: string,
  state?: string,
  zipCode?: string,
  totalPrice?: number | null,
  discountAmount?: number | null,
  discountName?: string | null,
  giftUsedAmount?: number | null,
  paymentStatus?: string | null
): string {
  const endTime = formatTimeDisplay(minutesToTime(timeToMinutes(time) + serviceDuration));
  const fullAddr = formatFullAddress(address, city, state, zipCode);
  const locationLine = locationName
    ? (fullAddr ? `${locationName} — ${fullAddr}` : locationName)
    : fullAddr;
  const priceLine = buildPriceLine({ totalPrice, discountAmount, discountName, giftUsedAmount, paymentStatus });
  return appendLimeFooter(`Dear ${clientName},\n\nThis is a friendly reminder about your upcoming appointment.\n\n📋 Service: ${serviceName}\n📅 Date: ${formatDateLong(date)}\n⏰ Time: ${formatTimeDisplay(time)} – ${endTime}\n📍 Location: ${locationLine}\n${priceLine}\n🏢 ${businessName}\n📞 ${formatPhoneNumber(stripPhoneFormat(businessPhone))}\n\nPlease arrive 5 minutes early. If you need to reschedule or cancel, please contact us as soon as possible.`);
}

/** Locked footer appended to every reminder message — cannot be removed by users */
export const LIME_OF_TIME_FOOTER = "\n\n— Powered by Lime Of Time";

/** Append the locked footer to a message body, ensuring it is not duplicated */
export function appendLimeFooter(body: string): string {
  const footer = LIME_OF_TIME_FOOTER.trim();
  if (body.trimEnd().endsWith(footer)) return body;
  return body.trimEnd() + LIME_OF_TIME_FOOTER;
}

/** Public booking URL base — DO NOT CHANGE. Production domain is lime-of-time.com */
export const PUBLIC_BOOKING_URL = "https://lime-of-time.com";

/** Generate the correct public booking link for a business */
export function getBookingUrl(businessName: string, customSlug?: string): string {
  const slug = customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  return `${PUBLIC_BOOKING_URL}/book/${slug}`;
}

/** Generate the correct public review link for a business */
export function getReviewUrl(businessName: string, customSlug?: string): string {
  const slug = customSlug || businessName.replace(/\s+/g, "-").toLowerCase();
  return `${PUBLIC_BOOKING_URL}/review/${slug}`;
}

/** Generate the correct public gift card link */
export function getGiftUrl(code: string): string {
  return `${PUBLIC_BOOKING_URL}/gift/${code}`;
}
