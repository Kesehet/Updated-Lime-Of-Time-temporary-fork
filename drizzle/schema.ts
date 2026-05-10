import {
  int,
  bigint,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  decimal,
  json,
} from "drizzle-orm/mysql-core";

// ─── Users (Auth) ────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Business Owners ─────────────────────────────────────────────────
export const businessOwners = mysqlTable("business_owners", {
  id: int("id").autoincrement().primaryKey(),
  /** Links to users table for auth - nullable for phone-only signup */
  userId: int("userId"),
  /** Phone number used during onboarding (unique identifier for non-OAuth) */
  phone: varchar("phone", { length: 20 }).notNull(),
  /** Business name */
  businessName: varchar("businessName", { length: 255 }).notNull(),
  /** Owner's personal name */
  ownerName: varchar("ownerName", { length: 255 }),
  /** Business email */
  email: varchar("email", { length: 320 }),
  /** Business address */
  address: text("address"),
  /** Business website */
  website: varchar("website", { length: 500 }),
  /** Business description */
  description: text("description"),
  /** Business logo URI (S3 or local) */
  businessLogoUri: text("businessLogoUri"),
  /** Business cover/banner photo URI for client portal detail page header */
  coverPhotoUri: text("coverPhotoUri"),
  /** Default appointment duration in minutes */
  defaultDuration: int("defaultDuration").default(60).notNull(),
  /** Notifications enabled */
  notificationsEnabled: boolean("notificationsEnabled").default(true).notNull(),
  /** Theme mode preference */
  themeMode: mysqlEnum("themeMode", ["light", "dark", "system"]).default("system").notNull(),
  /** Temporary closed flag */
  temporaryClosed: boolean("temporaryClosed").default(false).notNull(),
  /** Schedule mode: weekly (recurring hours) or custom (per-day control) */
  scheduleMode: mysqlEnum("scheduleMode", ["weekly", "custom"]).default("weekly").notNull(),
  /** Working hours JSON: Record<string, { enabled: boolean, start: string, end: string }> */
  workingHours: json("workingHours"),
  /** Cancellation policy JSON: { enabled, hoursBeforeAppointment, feePercentage } */
  cancellationPolicy: json("cancellationPolicy"),
  /** Buffer time between appointments in minutes (0 = no buffer) */
  bufferTime: int("bufferTime").default(0).notNull(),
  /** Slot interval in minutes (0 = auto, match service duration capped at 30) */
  slotInterval: int("slotInterval").default(0).notNull(),
  /** Custom booking slug (overrides auto-generated slug from business name) */
  customSlug: varchar("customSlug", { length: 100 }),
  /** Business Hours end date: ISO date string YYYY-MM-DD, null = open-ended */
  businessHoursEndDate: varchar("businessHoursEndDate", { length: 10 }),
  /** Expo push notification token for sending push notifications to owner's device */
  expoPushToken: varchar("expoPushToken", { length: 255 }),
  /** Auto-complete appointments: automatically mark as completed after end time + delay */
  autoCompleteEnabled: boolean("autoCompleteEnabled").default(false).notNull(),
  /** Minutes after appointment end time to auto-complete (5, 10, 15, 30) */
  autoCompleteDelayMinutes: int("autoCompleteDelayMinutes").default(5).notNull(),
  /** Hours before auto-declining pending cancel/reschedule requests (12, 24, 48, 72) */
  requestResponseWindowHours: int("requestResponseWindowHours").default(48).notNull(),
  /** Number of days a publicly-purchased gift card is valid for. Default 90. */
  giftValidDays: int("giftValidDays").default(90).notNull(),
  /** Notification preferences JSON: per-event push/email toggles */
  notificationPreferences: json("notificationPreferences"),
  /** SMS message templates JSON: per-event custom message bodies */
  smsTemplates: json("smsTemplates"),
  /** Onboarding completed */
  onboardingComplete: boolean("onboardingComplete").default(false).notNull(),
  // ─── Subscription Fields ─────────────────────────────────────────────
  /** Subscription plan: solo | growth | studio | enterprise */
  subscriptionPlan: mysqlEnum("subscriptionPlan", ["solo", "growth", "studio", "enterprise"]).default("solo").notNull(),
  /** Subscription status: trial | active | expired | free */
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["trial", "active", "expired", "free"]).default("free").notNull(),
  /** Billing period: monthly | yearly */
  subscriptionPeriod: mysqlEnum("subscriptionPeriod", ["monthly", "yearly"]).default("monthly").notNull(),
  /** Trial end date (ISO string) */
  trialEndsAt: timestamp("trialEndsAt"),
  /** Stripe customer ID */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  /** Stripe subscription ID */
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  /** Stripe current billing period end (Unix timestamp in seconds) */
  stripeCurrentPeriodEnd: bigint("stripeCurrentPeriodEnd", { mode: "number" }),
  /** Scheduled downgrade/upgrade plan key - applied at period end (null = no change scheduled) */
  scheduledPlanKey: mysqlEnum("scheduledPlanKey", ["solo", "growth", "studio", "enterprise"]),
  /** Scheduled billing period for the next plan */
  scheduledPlanPeriod: mysqlEnum("scheduledPlanPeriod", ["monthly", "yearly"]),
  /** Whether the subscription is set to cancel at period end (no renewal) */
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  /** Admin override: grant full Unlimited access for free (SaaS feature) */
  adminOverride: boolean("adminOverride").default(false).notNull(),
  /** Admin override note (reason/description) */
  adminOverrideNote: text("adminOverrideNote"),
  // ─── Payment Methods ─────────────────────────────────────────────────
  /** Zelle phone/email handle shown on booking confirmation */
  zelleHandle: varchar("zelleHandle", { length: 255 }),
  /** CashApp $handle shown on booking confirmation */
  cashAppHandle: varchar("cashAppHandle", { length: 255 }),
  /** Venmo @handle shown on booking confirmation */
  venmoHandle: varchar("venmoHandle", { length: 255 }),
  /** Free-text payment instructions shown on booking page */
  paymentNotes: text("paymentNotes"),
  // ─── Stripe Connect (card payments for clients) ───────────────────────
  /** Stripe Connect Express account ID (acct_...) */
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 255 }),
  /** Whether this connected account has charges enabled */
  stripeConnectEnabled: boolean("stripeConnectEnabled").default(false).notNull(),
  /** Whether the Stripe Express onboarding flow has been completed */
  stripeConnectOnboardingComplete: boolean("stripeConnectOnboardingComplete").default(false).notNull(),
  /** Whether the business owner has opted in to accept card payments from clients */
  acceptCardPayments: boolean("acceptCardPayments").default(false).notNull(),
  /** Social media handles */
  instagramHandle: varchar("instagramHandle", { length: 255 }),
  facebookHandle: varchar("facebookHandle", { length: 255 }),
  tiktokHandle: varchar("tiktokHandle", { length: 255 }),
  // ─── Client Portal Discovery ─────────────────────────────────────────
  /** Business category for client portal discovery (e.g. Hair, Nails, Massage) */
  businessCategory: varchar("businessCategory", { length: 100 }),
  /** Geocoded latitude of primary business address */
  lat: decimal("lat", { precision: 10, scale: 7 }),
  /** Geocoded longitude of primary business address */
  lng: decimal("lng", { precision: 10, scale: 7 }),
  /** Whether this business is visible in the client portal discovery feed */
  clientPortalVisible: boolean("clientPortalVisible").default(false).notNull(),
  /** iOS App Store URL for the App Share card */
  appStoreUrl: varchar("appStoreUrl", { length: 500 }),
  /** Google Play Store URL for the App Share card */
  playStoreUrl: varchar("playStoreUrl", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BusinessOwner = typeof businessOwners.$inferSelect;
export type InsertBusinessOwner = typeof businessOwners.$inferInsert;

// ─── Services ────────────────────────────────────────────────────────
export const services = mysqlTable("services", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  duration: int("duration").notNull(), // minutes
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  color: varchar("color", { length: 20 }).notNull(),
  /** Service category for grouping */
  category: varchar("category", { length: 100 }),
  /** Location localIds this service is available at (JSON array, null = all) */
  locationIds: json("locationIds"),
  /** Optional description shown on booking page */
  description: text("description"),
  /** Optional photo URI (S3 URL) shown on booking page */
  photoUri: varchar("photoUri", { length: 2048 }),
  /** Override global SMS reminder timing (hours before appointment, null = use global) */
  reminderHours: decimal("reminderHours", { precision: 5, scale: 2 }),
  serviceType: varchar("serviceType", { length: 20 }).default("in_store"),
  travelFee: decimal("travelFee", { precision: 10, scale: 2 }),
  /** Max travel distance in miles for mobile services (null = unlimited) */
  maxTravelDistance: decimal("maxTravelDistance", { precision: 6, scale: 1 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbService = typeof services.$inferSelect;
export type InsertService = typeof services.$inferInsert;

// ─── Clients ─────────────────────────────────────────────────────────
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  notes: text("notes"),
  birthday: varchar("birthday", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbClient = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

// ─── Appointments ────────────────────────────────────────────────────
export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  /** References services.localId */
  serviceLocalId: varchar("serviceLocalId", { length: 64 }).notNull(),
  /** References clients.localId */
  clientLocalId: varchar("clientLocalId", { length: 64 }).notNull(),
  /** Date in YYYY-MM-DD format */
  date: varchar("date", { length: 10 }).notNull(),
  /** Time in HH:MM format */
  time: varchar("time", { length: 5 }).notNull(),
  /** Duration in minutes */
  duration: int("duration").notNull(),
  /** Appointment status */
  status: mysqlEnum("status", ["pending", "confirmed", "completed", "cancelled", "no_show"])
    .default("pending")
    .notNull(),
  notes: text("notes"),
  /** Total price charged for the appointment (after discounts/gifts) */
  totalPrice: decimal("totalPrice", { precision: 10, scale: 2 }),
  /** Extra items JSON: array of { type, id, name, price, duration } */
  extraItems: json("extraItems"),
  /** Discount percentage applied (0-100) */
  discountPercent: int("discountPercent"),
  /** Discount dollar amount */
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }),
  /** Name of the discount applied */
  discountName: varchar("discountName", { length: 255 }),
  /** Whether a gift card was applied */
  giftApplied: boolean("giftApplied").default(false),
  /** Dollar amount used from gift card */
  giftUsedAmount: decimal("giftUsedAmount", { precision: 10, scale: 2 }),
  /** Gift certificate code applied to this appointment */
  giftCode: varchar("giftCode", { length: 64 }),
  /** Staff member localId assigned to this appointment */
  staffId: varchar("staffId", { length: 64 }),
  /** Location localId for multi-location businesses */
  locationId: varchar("locationId", { length: 64 }),
  /** Reason provided when appointment was cancelled */
  cancellationReason: varchar("cancellationReason", { length: 255 }),
  /** Payment method chosen by client: zelle | venmo | cashapp | cash | card | unpaid | free */
  paymentMethod: mysqlEnum("paymentMethod", ["zelle", "venmo", "cashapp", "cash", "card", "unpaid", "free"]).default("unpaid"),
  /** Stripe Checkout Session ID when paid by card */
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 255 }),
  /** Payment status: unpaid | pending_cash | paid */
  paymentStatus: mysqlEnum("paymentStatus", ["unpaid", "pending_cash", "paid"]).default("unpaid"),
  /** Confirmation number provided by business owner after receiving digital payment */
  paymentConfirmationNumber: varchar("paymentConfirmationNumber", { length: 64 }),
  /** Timestamp when payment was confirmed */
  paymentConfirmedAt: timestamp("paymentConfirmedAt"),
  /** Timestamp when client tapped 'Mark as Paid' on the manage page */
  clientPaidNotifiedAt: timestamp("clientPaidNotifiedAt"),
  /** Timestamp when a Stripe refund was issued */
  refundedAt: timestamp("refundedAt"),
  /** Amount refunded in dollars (null = no refund issued) */
  refundedAmount: decimal("refundedAmount", { precision: 10, scale: 2 }),
  /** Stripe refund ID for reference */
  stripeRefundId: varchar("stripeRefundId", { length: 255 }),
  /**
   * Client-submitted cancellation request.
   * JSON: { status: 'pending'|'approved'|'declined', reason?: string, submittedAt: ISO string, resolvedAt?: ISO string }
   * null = no request submitted
   */
  cancelRequest: json("cancelRequest"),
  /**
   * Client-submitted reschedule request.
   * JSON: { status: 'pending'|'approved'|'declined', requestedDate: YYYY-MM-DD, requestedTime: HH:MM, reason?: string, submittedAt: ISO string, resolvedAt?: ISO string }
   * null = no request submitted
   */
  rescheduleRequest: json("rescheduleRequest"),
  /**
   * Timestamp when the last appointment reminder push/email was sent.
   * Used to prevent duplicate reminders when the server restarts within the same reminder window.
   */
  reminderSentAt: timestamp("reminderSentAt"),
  /**
   * Tracks which client-facing in-app reminders have been sent.
   * JSON: { sent24h?: boolean, sent1h?: boolean, sent30m?: boolean }
   */
  clientReminderFlags: json("clientReminderFlags"),
  clientAddress: text("clientAddress"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbAppointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

// ─── Reviews ─────────────────────────────────────────────────────────
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  /** References clients.localId */
  clientLocalId: varchar("clientLocalId", { length: 64 }).notNull(),
  /** References appointments.localId (optional) */
  appointmentLocalId: varchar("appointmentLocalId", { length: 64 }),
  /** Rating 1-5 */
  rating: int("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbReview = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

// ─── Discounts ──────────────────────────────────────────────────────
export const discounts = mysqlTable("discounts", {
  id: int("id").autoincrement().primaryKey(),
  businessOwnerId: int("businessOwnerId").notNull(),
  localId: varchar("localId", { length: 64 }).notNull(),
  /** Name of the discount (e.g. "Happy Hour", "Early Bird") */
  name: varchar("name", { length: 255 }).notNull(),
  /** Percentage off (0-100) */
  percentage: int("percentage").notNull(),
  /** Start time HH:MM – discount applies during this window */
  startTime: varchar("startTime", { length: 5 }).notNull(),
  /** End time HH:MM */
  endTime: varchar("endTime", { length: 5 }).notNull(),
  /** Which days of week this discount applies (JSON array of day names) – legacy */
  daysOfWeek: json("daysOfWeek"),
  /** Specific dates this discount applies (JSON array of YYYY-MM-DD strings) */
  dates: json("dates"),
  /** Optional: only for specific service localIds (JSON array), null = all services */
  serviceIds: json("serviceIds"),
  /** Optional max number of times this discount can be applied (null = unlimited) */
  maxUses: int("maxUses"),
  /** Whether the discount is currently active */
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbDiscount = typeof discounts.$inferSelect;
export type InsertDiscount = typeof discounts.$inferInsert;

// ─── Gift Cards ─────────────────────────────────────────────────────
export const giftCards = mysqlTable("gift_cards", {
  id: int("id").autoincrement().primaryKey(),
  businessOwnerId: int("businessOwnerId").notNull(),
  localId: varchar("localId", { length: 64 }).notNull(),
  /** Unique redemption code */
  code: varchar("code", { length: 20 }).notNull(),
  /** Service localId this gift card is for — nullable for balance-type gifts */
  serviceLocalId: varchar("serviceLocalId", { length: 64 }),
  /** Recipient name */
  recipientName: varchar("recipientName", { length: 255 }),
  /** Recipient phone */
  recipientPhone: varchar("recipientPhone", { length: 20 }),
  /** Personal message */
  message: text("message"),
  /** Whether the gift card has been redeemed */
  redeemed: boolean("redeemed").default(false).notNull(),
  /** When it was redeemed */
  redeemedAt: timestamp("redeemedAt"),
  /** Expiry date YYYY-MM-DD */
  expiresAt: varchar("expiresAt", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  purchaserName: varchar("purchaserName", { length: 255 }),
  purchaserEmail: varchar("purchaserEmail", { length: 320 }),
  recipientEmail: varchar("recipientEmail", { length: 320 }),
  recipientChoosesDate: boolean("recipientChoosesDate").default(true),
  paymentMethod: varchar("paymentMethod", { length: 30 }).default("unpaid"),
  paymentStatus: varchar("paymentStatus", { length: 20 }).default("unpaid"),
  totalValue: decimal("totalValue", { precision: 10, scale: 2 }),
  purchasedPublicly: boolean("purchasedPublicly").default(false).notNull(),
  preselectedDate: varchar("preselectedDate", { length: 10 }),
  preselectedTime: varchar("preselectedTime", { length: 5 }),
  pendingRedemptionAppointmentId: varchar("pendingRedemptionAppointmentId", { length: 64 }),
});

export type DbGiftCard = typeof giftCards.$inferSelect;
export type InsertGiftCard = typeof giftCards.$inferInsert;

// ─── Custom Schedule (per-date overrides) ───────────────────────────
export const customSchedule = mysqlTable("custom_schedule", {
  id: int("id").autoincrement().primaryKey(),
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Date in YYYY-MM-DD format */
  date: varchar("date", { length: 10 }).notNull(),
  /** Whether the business is open on this date */
  isOpen: boolean("isOpen").default(true).notNull(),
  /** Custom start time HH:MM (overrides weekly hours) */
  startTime: varchar("startTime", { length: 5 }),
  /** Custom end time HH:MM */
  endTime: varchar("endTime", { length: 5 }),
  /** Optional location-scoped override (null = global override for all locations) */
  locationId: varchar("locationId", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbCustomSchedule = typeof customSchedule.$inferSelect;
export type InsertCustomSchedule = typeof customSchedule.$inferInsert;

// ─── Products ──────────────────────────────────────────────────────
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  description: text("description"),
  /** Product brand for grouping */
  brand: varchar("brand", { length: 128 }),
  /** Whether the product is currently available */
  available: boolean("available").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbProduct = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ─── Waitlist ──────────────────────────────────────────────────────
export const waitlist = mysqlTable("waitlist", {
  id: int("id").autoincrement().primaryKey(),
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Client name */
  clientName: varchar("clientName", { length: 255 }).notNull(),
  /** Client phone */
  clientPhone: varchar("clientPhone", { length: 20 }),
  /** Client email */
  clientEmail: varchar("clientEmail", { length: 320 }),
  /** Service localId the client wants */
  serviceLocalId: varchar("serviceLocalId", { length: 64 }).notNull(),
  /** Preferred date YYYY-MM-DD */
  preferredDate: varchar("preferredDate", { length: 10 }).notNull(),
  /** Status */
  status: mysqlEnum("status", ["waiting", "notified", "booked", "expired"]).default("waiting").notNull(),
  /** Notes from the client */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbWaitlist = typeof waitlist.$inferSelect;
export type InsertWaitlist = typeof waitlist.$inferInsert;

// ─── Data Deletion Requests ─────────────────────────────────────────
export const dataDeletionRequests = mysqlTable("data_deletion_requests", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  requestType: mysqlEnum("request_type", ["full", "client_data", "business_data"]).default("full").notNull(),
  reason: text("reason"),
  status: mysqlEnum("status", ["pending", "processing", "completed", "rejected"]).default("pending").notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbDataDeletionRequest = typeof dataDeletionRequests.$inferSelect;
export type InsertDataDeletionRequest = typeof dataDeletionRequests.$inferInsert;

// ─── Staff Members ─────────────────────────────────────────────────
export const staffMembers = mysqlTable("staff_members", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  /** Staff member name */
  name: varchar("name", { length: 255 }).notNull(),
  /** Staff member phone */
  phone: varchar("phone", { length: 20 }),
  /** Staff member email */
  email: varchar("email", { length: 320 }),
  /** Role/title (e.g. "Stylist", "Therapist", "Manager") */
  role: varchar("role", { length: 100 }),
  /** Profile color for calendar display */
  color: varchar("color", { length: 20 }),
  /** Service localIds this staff member can perform (JSON array) */
  serviceIds: json("serviceIds"),
  /** Location localIds this staff member is assigned to (JSON array, null = all) */
  locationIds: json("locationIds"),
  /** Individual working hours JSON: Record<string, { enabled: boolean, start: string, end: string }> */
  workingHours: json("workingHours"),
  /** Whether the staff member is currently active */
  active: boolean("active").default(true).notNull(),
  /** Profile photo URI (local file URI or remote URL) */
  photoUri: varchar("photoUri", { length: 2048 }),
  /** Commission rate as a percentage (0-100) */
  commissionRate: int("commissionRate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbStaffMember = typeof staffMembers.$inferSelect;
export type InsertStaffMember = typeof staffMembers.$inferInsert;

// ─── Locations (Multi-Location) ─────────────────────────────────────
export const locations = mysqlTable("locations", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Local client-generated ID for backward compat */
  localId: varchar("localId", { length: 64 }).notNull(),
  /** Location name (e.g. "Main Office", "Downtown Branch") */
  name: varchar("name", { length: 255 }).notNull(),
  /** Full address */
  address: text("address"),
  /** City */
  city: varchar("city", { length: 100 }),
  /** State/Province */
  state: varchar("state", { length: 100 }),
  /** ZIP / Postal code */
  zipCode: varchar("zipCode", { length: 20 }),
  /** Phone number for this location */
  phone: varchar("phone", { length: 20 }),
  /** Email for this location */
  email: varchar("email", { length: 320 }),
  /** Whether this is the default/primary location */
  isDefault: boolean("isDefault").default(false).notNull(),
  /** Whether this location is currently active */
  active: boolean("active").default(true).notNull(),
  /** Whether this location is temporarily paused for new bookings */
  temporarilyClosed: boolean("temporarilyClosed").default(false),
  /** ISO date YYYY-MM-DD: if set, location auto-reopens on this date */
  reopenOn: varchar("reopenOn", { length: 10 }),
  /** Individual working hours JSON: Record<string, { enabled: boolean, start: string, end: string }> */
  /** Optional cover photo URL for this location */
  photoUri: text("photoUri"),
  workingHours: json("workingHours"),
  /** Geocoded latitude */
  lat: decimal("lat", { precision: 10, scale: 7 }),
  /** Geocoded longitude */
  lng: decimal("lng", { precision: 10, scale: 7 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbLocation = typeof locations.$inferSelect;
export type InsertLocation = typeof locations.$inferInsert;

// ─── Subscription Plans ────────────────────────────────────────────
export const subscriptionPlans = mysqlTable("subscription_plans", {
  id: int("id").autoincrement().primaryKey(),
  /** Plan key: solo | growth | studio | enterprise */
  planKey: mysqlEnum("planKey", ["solo", "growth", "studio", "enterprise"]).notNull().unique(),
  /** Display name shown to users */
  displayName: varchar("displayName", { length: 100 }).notNull(),
  /** Monthly price in USD (0 for free) */
  monthlyPrice: decimal("monthlyPrice", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Yearly price in USD (0 for free) */
  yearlyPrice: decimal("yearlyPrice", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Max clients (-1 = unlimited) */
  maxClients: int("maxClients").notNull().default(-1),
  /** Max appointments per month (-1 = unlimited) */
  maxAppointments: int("maxAppointments").notNull().default(-1),
  /** Max locations (-1 = unlimited) */
  maxLocations: int("maxLocations").notNull().default(-1),
  /** Max staff members (-1 = unlimited) */
  maxStaff: int("maxStaff").notNull().default(-1),
  /** Max services (-1 = unlimited) */
  maxServices: int("maxServices").notNull().default(-1),
  /** Max products (-1 = unlimited) */
  maxProducts: int("maxProducts").notNull().default(-1),
  /** SMS automation allowed: none | confirmations | full */
  smsLevel: mysqlEnum("smsLevel", ["none", "confirmations", "full"]).notNull().default("none"),
  /** Payment methods: basic (cash+p2p) | full (includes card) */
  paymentLevel: mysqlEnum("paymentLevel", ["basic", "full"]).notNull().default("basic"),
  /** Whether this plan is visible to the public (admin toggle) */
  isPublic: boolean("isPublic").notNull().default(false),
  /** Discount percentage 0-100 (0 = no discount). Admin-controlled. */
  discountPercent: int("discountPercent").notNull().default(0),
  /** Optional discount label shown in app (e.g. "Launch Special", "50% off first 3 months") */
  discountLabel: varchar("discountLabel", { length: 100 }),
  /** Optional expiry date for the discount — auto-expires when this date passes */
  discountExpiresAt: timestamp("discountExpiresAt"),
  /** Number of months the discount applies (0 = forever, 1+ = introductory). Admin-controlled. */
  discountMonths: int("discountMonths").notNull().default(0),
  /** Sort order for display */
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

// ─── Platform Config ───────────────────────────────────────────────
// Stores admin-controlled platform configuration (Twilio, Stripe, etc.)
export const platformConfig = mysqlTable("platform_config", {
  id: int("id").autoincrement().primaryKey(),
  /** Config key */
  configKey: varchar("configKey", { length: 100 }).notNull().unique(),
  /** Config value (encrypted for sensitive keys) */
  configValue: text("configValue"),
  /** Whether this is a sensitive value (masked in UI) */
  isSensitive: boolean("isSensitive").notNull().default(false),
  /** Description shown in admin UI */
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformConfig = typeof platformConfig.$inferSelect;
export type InsertPlatformConfig = typeof platformConfig.$inferInsert;

// ─── Admin Expenses ────────────────────────────────────────────────
// Platform-level expenses tracked by the admin for tax/reporting purposes
export const adminExpenses = mysqlTable("admin_expenses", {
  id: int("id").autoincrement().primaryKey(),
  /** Expense date in YYYY-MM-DD format */
  date: varchar("date", { length: 10 }).notNull(),
  /** Category: hosting | marketing | software | payroll | legal | other */
  category: mysqlEnum("category", ["hosting", "marketing", "software", "payroll", "legal", "other"]).notNull().default("other"),
  /** Short description */
  description: varchar("description", { length: 255 }).notNull(),
  /** Amount in USD */
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  /** Optional notes */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AdminExpense = typeof adminExpenses.$inferSelect;
export type InsertAdminExpense = typeof adminExpenses.$inferInsert;

// ─── Admin Audit Log ───────────────────────────────────────────────
// Tracks all configuration changes made by platform admins
export const adminAuditLog = mysqlTable("admin_audit_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Who performed the action (admin username or 'system') */
  actor: varchar("actor", { length: 100 }).notNull().default("admin"),
  /** Category: platform_config | plan_pricing | subscription_override | expense */
  category: varchar("category", { length: 50 }).notNull(),
  /** Short description of what changed */
  action: varchar("action", { length: 255 }).notNull(),
  /** Optional JSON snapshot of changed fields */
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLog.$inferInsert;
// ─── OTP Send Log ─────────────────────────────────────────────────────
export const otpSendLog = mysqlTable("otp_send_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Phone number the OTP was sent to (E.164) */
  phone: varchar("phone", { length: 30 }).notNull(),
  /** 'sent' | 'failed' */
  status: varchar("status", { length: 20 }).notNull().default("sent"),
  /** Twilio error message if status is 'failed' */
  errorMessage: text("errorMessage"),
  /** 'admin_panel' | 'app' */
  source: varchar("source", { length: 30 }).notNull().default("admin_panel"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type OtpSendLog = typeof otpSendLog.$inferSelect;
export type InsertOtpSendLog = typeof otpSendLog.$inferInsert;
// ─── Promo / Referral Codess ────────────────────────────────────────
export const promoCodes = mysqlTable("promo_codes", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Client-generated UUID for offline-first sync */
  localId: varchar("localId", { length: 64 }).notNull(),
  /** The code clients enter at checkout (e.g. "SUMMER20") */
  code: varchar("code", { length: 50 }).notNull(),
  /** Human-readable label (e.g. "Summer Referral") */
  label: varchar("label", { length: 255 }).notNull(),
  /** Discount percentage 0-100 */
  percentage: int("percentage").notNull().default(0),
  /** Optional flat discount amount in dollars (used when percentage is 0) */
  flatAmount: decimal("flatAmount", { precision: 10, scale: 2 }),
  /** Optional max number of times this code can be used (null = unlimited) */
  maxUses: int("maxUses"),
  /** Number of times this code has been used */
  usedCount: int("usedCount").notNull().default(0),
  /** Optional expiry date YYYY-MM-DD */
  expiresAt: varchar("expiresAt", { length: 10 }),
  /** Whether this code is currently active */
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type DbPromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = typeof promoCodes.$inferInsert;

// ─── Client Accounts (Client Portal) ─────────────────────────────────────
export const clientAccounts = mysqlTable("client_accounts", {
  id: int("id").autoincrement().primaryKey(),
  /** Normalized phone number (primary identifier, e.g. +14125551234) */
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  /** Display name */
  name: varchar("name", { length: 255 }),
  /** Email address (optional) */
  email: varchar("email", { length: 320 }),
  /** Birthday MM/DD (optional, for birthday campaigns) */
  birthday: varchar("birthday", { length: 5 }),
  /** Profile photo S3 URL */
  profilePhotoUri: varchar("profilePhotoUri", { length: 2048 }),
  /** Expo push token for client-facing push notifications */
  expoPushToken: varchar("expoPushToken", { length: 255 }),
  /** Preferred discovery radius in miles */
  preferredRadius: int("preferredRadius").default(25).notNull(),
  /** Theme mode preference */
  themeMode: mysqlEnum("themeMode", ["light", "dark", "system"]).default("system").notNull(),
  /** Notification preferences JSON */
  notificationPreferences: json("notificationPreferences"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ClientAccount = typeof clientAccounts.$inferSelect;
export type InsertClientAccount = typeof clientAccounts.$inferInsert;
// ─── Client Portal Messages ──────────────────────────────────────────────
export const clientMessages = mysqlTable("client_messages", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Foreign key to client_accounts */
  clientAccountId: int("clientAccountId").notNull(),
  /** Who sent this message */
  senderType: mysqlEnum("senderType", ["business", "client"]).notNull(),
  /** Message body */
  body: text("body").notNull(),
  /** When the recipient read this message (null = unread) */
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ClientMessage = typeof clientMessages.$inferSelect;
export type InsertClientMessage = typeof clientMessages.$inferInsert;
// ─── Client Saved Businesses ───────────────────────────────────────────────
export const clientSavedBusinesses = mysqlTable("client_saved_businesses", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to client_accounts */
  clientAccountId: int("clientAccountId").notNull(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  savedAt: timestamp("savedAt").defaultNow().notNull(),
});
export type ClientSavedBusiness = typeof clientSavedBusinesses.$inferSelect;
export type InsertClientSavedBusiness = typeof clientSavedBusinesses.$inferInsert;
// ─── Service Photos (Server-Synced) ──────────────────────────────────────────────
export const servicePhotos = mysqlTable("service_photos", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to business_owners */
  businessOwnerId: int("businessOwnerId").notNull(),
  /** Service localId this photo belongs to */
  serviceLocalId: varchar("serviceLocalId", { length: 64 }).notNull(),
  /** S3 URL of the photo */
  uri: varchar("uri", { length: 2048 }).notNull(),
  /** Photo label */
  label: mysqlEnum("label", ["before", "after", "other"]).default("other").notNull(),
  /** Optional caption/note */
  note: text("note"),
  /** Sort order */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ServicePhoto = typeof servicePhotos.$inferSelect;
export type InsertServicePhoto = typeof servicePhotos.$inferInsert;

// ─── Service Packages / Bundles ──────────────────────────────────────────────
export const servicePackages = mysqlTable("service_packages", {
  id: int("id").autoincrement().primaryKey(),
  businessOwnerId: int("businessOwnerId").notNull(),
  localId: varchar("localId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  /** JSON: Array<{ serviceLocalId: string; sessions: number; daysPerSession: number }> */
  packageItems: json("packageItems").notNull(),
  totalSessions: int("totalSessions").notNull().default(1),
  sessionDurationMinutes: int("sessionDurationMinutes").notNull().default(60),
  originalPrice: decimal("originalPrice", { precision: 10, scale: 2 }).notNull(),
  packagePrice: decimal("packagePrice", { precision: 10, scale: 2 }).notNull(),
  photoUri: varchar("photoUri", { length: 2048 }),
  category: varchar("category", { length: 100 }),
  /** Optional: number of days after purchase before the client's package expires */
  expiryDays: int("expiryDays"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type DbServicePackage = typeof servicePackages.$inferSelect;
export type InsertServicePackage = typeof servicePackages.$inferInsert;

// ─── Gift Certificate Recipients ─────────────────────────────────────────────
export const giftCertificateRecipients = mysqlTable("gift_certificate_recipients", {
  id: int("id").autoincrement().primaryKey(),
  giftCardLocalId: varchar("giftCardLocalId", { length: 64 }).notNull(),
  giftCardCode: varchar("giftCardCode", { length: 20 }).notNull(),
  businessOwnerId: int("businessOwnerId").notNull(),
  clientAccountId: int("clientAccountId"),
  recipientPhone: varchar("recipientPhone", { length: 20 }),
  recipientEmail: varchar("recipientEmail", { length: 320 }),
  linked: boolean("linked").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DbGiftCertificateRecipient = typeof giftCertificateRecipients.$inferSelect;
export type InsertGiftCertificateRecipient = typeof giftCertificateRecipients.$inferInsert;

// ─── Client Package Purchases ─────────────────────────────────────────────────
export const clientPackages = mysqlTable("client_packages", {
  id: int("id").autoincrement().primaryKey(),
  localId: varchar("localId", { length: 64 }).notNull().unique(),
  businessOwnerId: int("businessOwnerId").notNull(),
  clientAccountId: int("clientAccountId"),
  clientPhone: varchar("clientPhone", { length: 20 }),
  clientEmail: varchar("clientEmail", { length: 320 }),
  packageLocalId: varchar("packageLocalId", { length: 64 }).notNull(),
  packageName: varchar("packageName", { length: 255 }).notNull(),
  totalSessions: int("totalSessions").notNull().default(1),
  sessionsCompleted: int("sessionsCompleted").notNull().default(0),
  totalValue: decimal("totalValue", { precision: 10, scale: 2 }),
  status: varchar("status", { length: 32 }).notNull().default("active"), // active | completed | cancelled
  paymentStatus: varchar("paymentStatus", { length: 32 }).default("unpaid"),
  purchasedAt: timestamp("purchasedAt").defaultNow().notNull(),
  expiresAt: varchar("expiresAt", { length: 10 }),
  notes: text("notes"),
});
export type DbClientPackage = typeof clientPackages.$inferSelect;
export type InsertClientPackage = typeof clientPackages.$inferInsert;
