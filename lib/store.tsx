import React, { createContext, useContext, useEffect, useReducer, useCallback, useMemo, useRef } from "react";
import { AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/lib/logger";
import {
  Service,
  Client,
  ClientPhoto,
  Appointment,
  Review,
  Discount,
  GiftCard,
  CustomScheduleDay,
  Product,
  StaffMember,
  Location,
  BusinessSettings,
  DEFAULT_WORKING_HOURS,
  DEFAULT_BUSINESS_PROFILE,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_SMS_TEMPLATES,
  AppointmentStatus,
  timeToMinutes,
  NoteTemplate,
  WaitlistEntry,
  ServicePackage,
  ServicePhoto,
  PromoCode,
  InboxNotification,
  ReminderTemplate,
  DEFAULT_REMINDER_TEMPLATES,
} from "./types";
import { trpc } from "./trpc";

// --- State ---
interface AppState {
  services: Service[];
  clients: Client[];
  appointments: Appointment[];
  reviews: Review[];
  discounts: Discount[];
  giftCards: GiftCard[];
  customSchedule: CustomScheduleDay[];
  /** Per-location custom schedule overrides. Key = locationId, value = array of day overrides for that location. */
  locationCustomSchedule: Record<string, CustomScheduleDay[]>;
  products: Product[];
  staff: StaffMember[];
  locations: Location[];
  settings: BusinessSettings;
  loaded: boolean;
  /** DB id of the current business owner – null until bootstrap completes */
  businessOwnerId: number | null;
  /** Whether we're currently syncing with the server */
  syncing: boolean;
  /** The currently active location ID (null = all locations / no filter) */
  activeLocationId: string | null;
  /** Before/after photos per client, stored locally only (not synced to DB) */
  clientPhotos: ClientPhoto[];
  /** Reusable appointment note templates */
  noteTemplates: NoteTemplate[];
  /** Waitlist entries for fully-booked slots */
  waitlist: WaitlistEntry[];
  /** Service bundle / package deals */
  packages: ServicePackage[];
  /** Before/after photos per service */
  servicePhotos: ServicePhoto[];
  /** Referral and promotional codes */
  promoCodes: PromoCode[];
  /** In-app notification inbox items */
  inboxNotifications: InboxNotification[];
  /** Global reminder templates for sending SMS reminders to clients */
  reminderTemplates: ReminderTemplate[];
}

const initialSettings: BusinessSettings = {
  businessName: "My Business",
  defaultDuration: 60,
  notificationsEnabled: true,
  notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
  workingHours: DEFAULT_WORKING_HOURS,
  profile: DEFAULT_BUSINESS_PROFILE,
  themeMode: "system",
  cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
  onboardingComplete: false,
  temporaryClosed: false,
  businessLogoUri: "",
  scheduleMode: "weekly",
  bufferTime: 0,
  slotInterval: 0, // 0 = auto (match service duration, capped at 30 min)
  customSlug: "",
  businessHoursEndDate: null,
  autoCompleteEnabled: false,
  autoCompleteDelayMinutes: 5,
  requestResponseWindowHours: 48,
  giftValidDays: 90,
  smsTemplates: DEFAULT_SMS_TEMPLATES,
  monthlyRevenueGoal: 0,
  staffAlertThreshold: 80,
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioFromNumber: "",
  twilioEnabled: false,
  twilioBookingReminder: false,
  twilioReminderHoursBeforeAppt: 24,
  twilioRebookingNudge: false,
  twilioRebookingNudgeDays: 14,
  twilioBirthdaySms: false,
  zelleHandle: "",
  cashAppHandle: "",
  venmoHandle: "",
  paymentNotes: "",
  instagramHandle: "",
  facebookHandle: "",
  tiktokHandle: "",
};

const initialState: AppState = {
  services: [],
  clients: [],
  appointments: [],
  reviews: [],
  discounts: [],
  giftCards: [],
  customSchedule: [],
  locationCustomSchedule: {},
  products: [],
  staff: [],
  locations: [],
  settings: initialSettings,
  loaded: false,
  businessOwnerId: null,
  syncing: false,
  activeLocationId: null,
  clientPhotos: [],
  noteTemplates: [],
  waitlist: [],
  packages: [],
  servicePhotos: [],
  promoCodes: [],
  inboxNotifications: [],
  reminderTemplates: DEFAULT_REMINDER_TEMPLATES,
};

// --- Actions ---
type Action =
  | { type: "LOAD_DATA"; payload: Partial<AppState> }
  | { type: "SET_BUSINESS_OWNER_ID"; payload: number | null }
  | { type: "SET_SYNCING"; payload: boolean }
  | { type: "ADD_SERVICE"; payload: Service }
  | { type: "UPDATE_SERVICE"; payload: Service }
  | { type: "DELETE_SERVICE"; payload: string }
  | { type: "ADD_CLIENT"; payload: Client }
  | { type: "UPDATE_CLIENT"; payload: Client }
  | { type: "DELETE_CLIENT"; payload: string }
  | { type: "ADD_APPOINTMENT"; payload: Appointment }
  | { type: "UPDATE_APPOINTMENT"; payload: Appointment }
  | { type: "UPDATE_APPOINTMENT_STATUS"; payload: { id: string; status: AppointmentStatus; cancellationReason?: string } }
  | { type: "DELETE_APPOINTMENT"; payload: string }
  | { type: "UPDATE_SETTINGS"; payload: Partial<BusinessSettings> }
  | { type: "ADD_REVIEW"; payload: Review }
  | { type: "DELETE_REVIEW"; payload: string }
  | { type: "ADD_DISCOUNT"; payload: Discount }
  | { type: "UPDATE_DISCOUNT"; payload: Discount }
  | { type: "DELETE_DISCOUNT"; payload: string }
  | { type: "ADD_GIFT_CARD"; payload: GiftCard }
  | { type: "UPDATE_GIFT_CARD"; payload: GiftCard }
  | { type: "DELETE_GIFT_CARD"; payload: string }
  | { type: "SET_CUSTOM_SCHEDULE"; payload: CustomScheduleDay }
  | { type: "DELETE_CUSTOM_SCHEDULE"; payload: string }
  | { type: "SET_LOCATION_CUSTOM_SCHEDULE"; payload: { locationId: string; day: CustomScheduleDay } }
  | { type: "DELETE_LOCATION_CUSTOM_SCHEDULE"; payload: { locationId: string; date: string } }
  | { type: "ADD_PRODUCT"; payload: Product }
  | { type: "UPDATE_PRODUCT"; payload: Product }
  | { type: "DELETE_PRODUCT"; payload: string }
  | { type: "ADD_STAFF"; payload: StaffMember }
  | { type: "UPDATE_STAFF"; payload: StaffMember }
  | { type: "DELETE_STAFF"; payload: string }
  | { type: "ADD_LOCATION"; payload: Location }
  | { type: "UPDATE_LOCATION"; payload: Location }
  | { type: "DELETE_LOCATION"; payload: string }
  | { type: "SET_ACTIVE_LOCATION"; payload: string | null }
  | { type: "ADD_CLIENT_PHOTO"; payload: ClientPhoto }
  | { type: "UPDATE_CLIENT_PHOTO"; payload: ClientPhoto }
  | { type: "DELETE_CLIENT_PHOTO"; payload: string }
  | { type: "ADD_NOTE_TEMPLATE"; payload: NoteTemplate }
  | { type: "UPDATE_NOTE_TEMPLATE"; payload: NoteTemplate }
  | { type: "DELETE_NOTE_TEMPLATE"; payload: string }
  | { type: "ADD_WAITLIST_ENTRY"; payload: WaitlistEntry }
  | { type: "UPDATE_WAITLIST_ENTRY"; payload: WaitlistEntry }
  | { type: "DELETE_WAITLIST_ENTRY"; payload: string }
  | { type: "ADD_PACKAGE"; payload: ServicePackage }
  | { type: "UPDATE_PACKAGE"; payload: ServicePackage }
  | { type: "DELETE_PACKAGE"; payload: string }
  | { type: "ADD_SERVICE_PHOTO"; payload: ServicePhoto }
  | { type: "UPDATE_SERVICE_PHOTO"; payload: ServicePhoto }
  | { type: "DELETE_SERVICE_PHOTO"; payload: string }
  | { type: "ADD_PROMO_CODE"; payload: PromoCode }
  | { type: "UPDATE_PROMO_CODE"; payload: PromoCode }
  | { type: "DELETE_PROMO_CODE"; payload: string }
  | { type: "ADD_INBOX_NOTIFICATION"; payload: InboxNotification }
  | { type: "SYNC_INBOX_FROM_APPOINTMENTS" }
  | { type: "MARK_INBOX_READ" }
  | { type: "MARK_INBOX_READ_BY_APPOINTMENT"; payload: string }
  | { type: "CLEAR_INBOX" }
  | { type: "DISMISS_INBOX_NOTIFICATION"; payload: string }
  | { type: "CLEAR_OLD_INBOX_NOTIFICATIONS" }
  | { type: "ADD_REMINDER_TEMPLATE"; payload: ReminderTemplate }
  | { type: "UPDATE_REMINDER_TEMPLATE"; payload: ReminderTemplate }
  | { type: "DELETE_REMINDER_TEMPLATE"; payload: string }
  | { type: "MARK_REMINDER_SENT"; payload: { appointmentId: string; templateId: string; sentAt: string } }
  | { type: "RESET_ALL_DATA" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "LOAD_DATA":
      return { ...state, ...action.payload, loaded: true };
    case "SET_BUSINESS_OWNER_ID":
      return { ...state, businessOwnerId: action.payload };
    case "SET_SYNCING":
      return { ...state, syncing: action.payload };
    case "SET_ACTIVE_LOCATION":
      return { ...state, activeLocationId: action.payload };
    case "ADD_SERVICE":
      return { ...state, services: [...state.services, action.payload] };
    case "UPDATE_SERVICE":
      return {
        ...state,
        services: state.services.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case "DELETE_SERVICE":
      return {
        ...state,
        services: state.services.filter((s) => s.id !== action.payload),
      };
    case "ADD_CLIENT":
      return { ...state, clients: [...state.clients, action.payload] };
    case "UPDATE_CLIENT":
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.payload.id ? action.payload : c
        ),
      };
    case "DELETE_CLIENT":
      return {
        ...state,
        clients: state.clients.filter((c) => c.id !== action.payload),
        // Keep appointments so history is preserved (they become orphaned but still accessible)
        // Keep reviews so they are preserved even after client is deleted
      };
    case "ADD_APPOINTMENT": {
      // Auto-mark as paid when total charge is $0 (free service, full discount, gift card cover, etc.)
      const incomingAppt = (action.payload.totalPrice ?? 0) <= 0 && action.payload.paymentStatus !== 'paid'
        ? { ...action.payload, paymentStatus: 'paid' as const }
        : action.payload;
      const newAppts = [...state.appointments, incomingAppt];
      // Auto-deactivate discount if maxUses reached (count completed appointments)
      const addDiscountName = incomingAppt.discountName;
      let discountsAfterAdd = state.discounts;
      if (addDiscountName) {
        discountsAfterAdd = state.discounts.map((d) => {
          if (d.name === addDiscountName && d.maxUses != null && d.active) {
            const usedCount = newAppts.filter((a) => a.discountName === d.name && a.status === "completed").length;
            if (usedCount >= d.maxUses) return { ...d, active: false };
          }
          return d;
        });
      }
      // Increment promo code usedCount locally when appointment has a promo code
      // (Server-side increment happens via API; this keeps local state in sync immediately)
      let promoCodesAfterAdd = state.promoCodes ?? [];
      if (incomingAppt.discountName) {
        // Check if the discountName matches a promo code (promo codes use their label as discountName)
        const matchedPromo = promoCodesAfterAdd.find(
          (p) => p.label === incomingAppt.discountName || p.code === incomingAppt.discountName
        );
        if (matchedPromo) {
          promoCodesAfterAdd = promoCodesAfterAdd.map((p) =>
            p.id === matchedPromo.id ? { ...p, usedCount: (p.usedCount ?? 0) + 1 } : p
          );
        }
      }
      return { ...state, appointments: newAppts, discounts: discountsAfterAdd, promoCodes: promoCodesAfterAdd };
    }
    case "UPDATE_APPOINTMENT":
      return {
        ...state,
        appointments: state.appointments.map((a) =>
          a.id === action.payload.id ? action.payload : a
        ),
      };
    case "UPDATE_APPOINTMENT_STATUS": {
      const updatedAppts = state.appointments.map((a) =>
        a.id === action.payload.id
          ? {
              ...a,
              status: action.payload.status,
              ...(action.payload.cancellationReason != null
                ? { cancellationReason: action.payload.cancellationReason }
                : {}),
            }
          : a
      );
      // Auto-deactivate discount if maxUses reached when appointment is completed
      let discountsAfterUpdate = state.discounts;
      if (action.payload.status === "completed") {
        const completedAppt = updatedAppts.find((a) => a.id === action.payload.id);
        const completedDiscountName = completedAppt?.discountName;
        if (completedDiscountName) {
          discountsAfterUpdate = state.discounts.map((d) => {
            if (d.name === completedDiscountName && d.maxUses != null && d.active) {
              const usedCount = updatedAppts.filter((a) => a.discountName === d.name && a.status === "completed").length;
              if (usedCount >= d.maxUses) return { ...d, active: false };
            }
            return d;
          });
        }
      }
      return { ...state, appointments: updatedAppts, discounts: discountsAfterUpdate };
    }
    case "DELETE_APPOINTMENT":
      return {
        ...state,
        appointments: state.appointments.filter((a) => a.id !== action.payload),
      };
    case "UPDATE_SETTINGS":
      return {
        ...state,
        settings: { ...state.settings, ...action.payload },
      };
    case "ADD_REVIEW":
      return { ...state, reviews: [...state.reviews, action.payload] };
    case "DELETE_REVIEW":
      return { ...state, reviews: state.reviews.filter((r) => r.id !== action.payload) };
    case "ADD_DISCOUNT":
      return { ...state, discounts: [...state.discounts, action.payload] };
    case "UPDATE_DISCOUNT":
      return {
        ...state,
        discounts: state.discounts.map((d) =>
          d.id === action.payload.id ? action.payload : d
        ),
      };
    case "DELETE_DISCOUNT":
      return { ...state, discounts: state.discounts.filter((d) => d.id !== action.payload) };
    case "ADD_GIFT_CARD":
      return { ...state, giftCards: [...state.giftCards, action.payload] };
    case "UPDATE_GIFT_CARD":
      return {
        ...state,
        giftCards: state.giftCards.map((g) =>
          g.id === action.payload.id ? action.payload : g
        ),
      };
    case "DELETE_GIFT_CARD":
      return { ...state, giftCards: state.giftCards.filter((g) => g.id !== action.payload) };
    case "SET_CUSTOM_SCHEDULE": {
      const existing = state.customSchedule.findIndex((cs) => cs.date === action.payload.date);
      if (existing >= 0) {
        const updated = [...state.customSchedule];
        updated[existing] = action.payload;
        return { ...state, customSchedule: updated };
      }
      return { ...state, customSchedule: [...state.customSchedule, action.payload] };
    }
    case "DELETE_CUSTOM_SCHEDULE":
      return { ...state, customSchedule: state.customSchedule.filter((cs) => cs.date !== action.payload) };
    case "SET_LOCATION_CUSTOM_SCHEDULE": {
      const { locationId, day } = action.payload;
      const existing = (state.locationCustomSchedule[locationId] ?? []);
      const idx = existing.findIndex((cs) => cs.date === day.date);
      const updated = idx >= 0
        ? existing.map((cs, i) => i === idx ? day : cs)
        : [...existing, day];
      return { ...state, locationCustomSchedule: { ...state.locationCustomSchedule, [locationId]: updated } };
    }
    case "DELETE_LOCATION_CUSTOM_SCHEDULE": {
      const { locationId, date } = action.payload;
      const existing = (state.locationCustomSchedule[locationId] ?? []);
      const updated = existing.filter((cs) => cs.date !== date);
      return { ...state, locationCustomSchedule: { ...state.locationCustomSchedule, [locationId]: updated } };
    }
    case "ADD_PRODUCT":
      return { ...state, products: [...state.products, action.payload] };
    case "UPDATE_PRODUCT":
      return {
        ...state,
        products: state.products.map((p) =>
          p.id === action.payload.id ? action.payload : p
        ),
      };
    case "DELETE_PRODUCT":
      return { ...state, products: state.products.filter((p) => p.id !== action.payload) };
    case "ADD_STAFF":
      return { ...state, staff: [...state.staff, action.payload] };
    case "UPDATE_STAFF":
      return {
        ...state,
        staff: state.staff.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case "DELETE_STAFF":
      return { ...state, staff: state.staff.filter((s) => s.id !== action.payload) };
    case "ADD_LOCATION": {
      const addLocPayload = action.payload as Location;
      const normalizedAddLoc: Location = {
        ...addLocPayload,
        workingHours: (addLocPayload.workingHours && Object.keys(addLocPayload.workingHours).length > 0)
          ? normalizeWorkingHours(addLocPayload.workingHours)
          : null,
      };
      return { ...state, locations: [...state.locations, normalizedAddLoc] };
    }
    case "UPDATE_LOCATION": {
      const updLocPayload = action.payload as Location;
      const normalizedUpdLoc: Location = {
        ...updLocPayload,
        workingHours: (updLocPayload.workingHours && Object.keys(updLocPayload.workingHours).length > 0)
          ? normalizeWorkingHours(updLocPayload.workingHours)
          : null,
      };
      return {
        ...state,
        locations: state.locations.map((l) =>
          l.id === normalizedUpdLoc.id ? normalizedUpdLoc : l
        ),
      };
    }
    case "DELETE_LOCATION":
      return { ...state, locations: state.locations.filter((l) => l.id !== action.payload) };
    case "ADD_CLIENT_PHOTO":
      return { ...state, clientPhotos: [...state.clientPhotos, action.payload] };
    case "UPDATE_CLIENT_PHOTO":
      return { ...state, clientPhotos: state.clientPhotos.map((p) => p.id === action.payload.id ? action.payload : p) };
    case "DELETE_CLIENT_PHOTO":
      return { ...state, clientPhotos: state.clientPhotos.filter((p) => p.id !== action.payload) };
    case "ADD_NOTE_TEMPLATE":
      return { ...state, noteTemplates: [...(state.noteTemplates ?? []), action.payload] };
    case "UPDATE_NOTE_TEMPLATE":
      return { ...state, noteTemplates: (state.noteTemplates ?? []).map((t) => t.id === action.payload.id ? action.payload : t) };
    case "DELETE_NOTE_TEMPLATE":
      return { ...state, noteTemplates: (state.noteTemplates ?? []).filter((t) => t.id !== action.payload) };
    case "ADD_WAITLIST_ENTRY":
      return { ...state, waitlist: [...(state.waitlist ?? []), action.payload] };
    case "UPDATE_WAITLIST_ENTRY":
      return { ...state, waitlist: (state.waitlist ?? []).map((w) => w.id === action.payload.id ? action.payload : w) };
    case "DELETE_WAITLIST_ENTRY":
      return { ...state, waitlist: (state.waitlist ?? []).filter((w) => w.id !== action.payload) };
    case "ADD_PACKAGE":
      return { ...state, packages: [...(state.packages ?? []), action.payload] };
    case "UPDATE_PACKAGE":
      return { ...state, packages: (state.packages ?? []).map((p) => p.id === action.payload.id ? action.payload : p) };
    case "DELETE_PACKAGE":
      return { ...state, packages: (state.packages ?? []).filter((p) => p.id !== action.payload) };
    case "ADD_SERVICE_PHOTO":
      return { ...state, servicePhotos: [...(state.servicePhotos ?? []), action.payload] };
    case "UPDATE_SERVICE_PHOTO":
      return { ...state, servicePhotos: (state.servicePhotos ?? []).map((p) => p.id === action.payload.id ? action.payload : p) };
    case "DELETE_SERVICE_PHOTO":
      return { ...state, servicePhotos: (state.servicePhotos ?? []).filter((p) => p.id !== action.payload) };
    case "ADD_PROMO_CODE":
      return { ...state, promoCodes: [...(state.promoCodes ?? []), action.payload] };
    case "UPDATE_PROMO_CODE":
      return { ...state, promoCodes: (state.promoCodes ?? []).map((p) => p.id === action.payload.id ? action.payload : p) };
    case "DELETE_PROMO_CODE":
      return { ...state, promoCodes: (state.promoCodes ?? []).filter((p) => p.id !== action.payload) };
    case "ADD_INBOX_NOTIFICATION": {
      // Avoid duplicates by id
      const existing = state.inboxNotifications ?? [];
      if (existing.some((n) => n.id === action.payload.id)) return state;
      return { ...state, inboxNotifications: [action.payload, ...existing] };
    }
    case "SYNC_INBOX_FROM_APPOINTMENTS": {
      // Generate inbox entries from appointments for the last 30 days
      // This ensures the inbox is populated even when push notifications were missed
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const existingInbox = state.inboxNotifications ?? [];
      const existingIds = new Set(existingInbox.map((n) => n.id));
      const generated: InboxNotification[] = [];
      for (const appt of state.appointments) {
        // Only consider recent appointments
        const apptDate = new Date(appt.createdAt ?? appt.date);
        if (apptDate < cutoffDate) continue;
        const client = state.clients.find((c) => c.id === appt.clientId);
        const service = state.services.find((s) => s.id === appt.serviceId);
        const clientName = client?.name ?? "A client";
        const serviceName = service?.name ?? "an appointment";
        // New booking (pending status)
        if (appt.status === "pending") {
          const id = `nb_${appt.id}`;
          if (!existingIds.has(id)) {
            generated.push({
              id,
              type: "new_booking",
              title: "New Booking Request",
              body: `${clientName} requested ${serviceName} on ${appt.date} at ${appt.time}`,
              appointmentId: appt.id,
              clientName,
              timestamp: appt.createdAt ?? new Date(appt.date + 'T' + appt.time).toISOString(),
              read: false,
            });
          }
        }
        // Pending cancel request
        if (appt.cancelRequest?.status === "pending") {
          const id = `cr_${appt.id}`;
          if (!existingIds.has(id)) {
            generated.push({
              id,
              type: "cancelled_by_client",
              title: "Cancellation Request",
              body: `${clientName} wants to cancel ${serviceName} on ${appt.date}`,
              appointmentId: appt.id,
              clientName,
              timestamp: appt.cancelRequest.submittedAt,
              read: false,
            });
          }
        }
        // Pending reschedule request
        if (appt.rescheduleRequest?.status === "pending") {
          const id = `rr_${appt.id}`;
          if (!existingIds.has(id)) {
            generated.push({
              id,
              type: "rescheduled_by_client",
              title: "Reschedule Request",
              body: `${clientName} wants to reschedule ${serviceName} to ${appt.rescheduleRequest.requestedDate} at ${appt.rescheduleRequest.requestedTime}`,
              appointmentId: appt.id,
              clientName,
              timestamp: appt.rescheduleRequest.submittedAt,
              read: false,
            });
          }
        }
      }
      if (generated.length === 0) return state;
      // Merge new entries with existing, sorted newest first
      const merged = [...generated, ...existingInbox].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return { ...state, inboxNotifications: merged };
    }
    case "MARK_INBOX_READ":
      return {
        ...state,
        inboxNotifications: (state.inboxNotifications ?? []).map((n) => ({ ...n, read: true })),
      };
    case "MARK_INBOX_READ_BY_APPOINTMENT":
      return {
        ...state,
        inboxNotifications: (state.inboxNotifications ?? []).map((n) =>
          n.appointmentId === action.payload ? { ...n, read: true } : n
        ),
      };
    case "CLEAR_INBOX":
      return { ...state, inboxNotifications: [] };
    case "DISMISS_INBOX_NOTIFICATION":
      // Dismissing moves it to read immediately
      return {
        ...state,
        inboxNotifications: (state.inboxNotifications ?? []).map((n) =>
          n.id === action.payload ? { ...n, read: true } : n
        ),
      };
    case "CLEAR_OLD_INBOX_NOTIFICATIONS": {
      // Keep only items from the last 30 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      return {
        ...state,
        inboxNotifications: (state.inboxNotifications ?? []).filter(
          (n) => new Date(n.timestamp) >= cutoff
        ),
      };
    }
    case "ADD_REMINDER_TEMPLATE":
      if ((state.reminderTemplates ?? []).some((t) => t.id === action.payload.id)) return state;
      return { ...state, reminderTemplates: [...(state.reminderTemplates ?? []), action.payload] };
    case "UPDATE_REMINDER_TEMPLATE":
      return { ...state, reminderTemplates: (state.reminderTemplates ?? []).map((t) => t.id === action.payload.id ? action.payload : t) };
    case "DELETE_REMINDER_TEMPLATE":
      return { ...state, reminderTemplates: (state.reminderTemplates ?? []).filter((t) => t.id !== action.payload) };
    case "MARK_REMINDER_SENT": {
      const { appointmentId, templateId, sentAt } = action.payload;
      return {
        ...state,
        appointments: state.appointments.map((a) =>
          a.id === appointmentId
            ? { ...a, sentReminders: { ...(a.sentReminders ?? {}), [templateId]: sentAt } }
            : a
        ),
      };
    }
    case "RESET_ALL_DATA":
      return { ...initialState, loaded: true };
    default:
      return state;
  }
}

// --- Context ---
interface StoreContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getServiceById: (id: string) => Service | undefined;
  getClientById: (id: string) => Client | undefined;
  getStaffById: (id: string) => StaffMember | undefined;
  getLocationById: (id: string) => Location | undefined;
  getAppointmentsForDate: (date: string) => Appointment[];
  getAppointmentsForClient: (clientId: string) => Appointment[];
  getReviewsForClient: (clientId: string) => Review[];
  getPhotosForClient: (clientId: string) => ClientPhoto[];
  getTodayStats: () => { todayCount: number; weekCount: number; weekRevenue: number };
  /** Filter appointments by the active location (pass-through when no location selected) */
  filterAppointmentsByLocation: (appointments: Appointment[]) => Appointment[];
  /** Clients who have had at least one appointment at the active location (all clients when no location selected) */
  clientsForActiveLocation: Client[];
  /** Returns the custom schedule overrides for the active location (or global if no location active) */
  getActiveCustomSchedule: () => CustomScheduleDay[];
  /** Sync a specific action to the database */
  syncToDb: (action: Action, ownerIdOverride?: number | null) => Promise<void>;
  /** Set the active location and persist to AsyncStorage */
  setActiveLocation: (locationId: string | null) => void;
  /** Force a full re-fetch from the DB and update the store */
  refreshFromDb: () => Promise<void>;
  /** Bulk mark multiple appointments as paid in a single DB call */
  bulkMarkPaid: (localIds: string[], paymentMethod: string) => Promise<void>;
  /** Bulk revert appointments back to unpaid in a single DB call (for undo) */
  bulkMarkUnpaid: (localIds: string[]) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

const STORAGE_KEYS = {
  services: "@bookease_services",
  clients: "@bookease_clients",
  appointments: "@bookease_appointments",
  reviews: "@bookease_reviews",
  settings: "@bookease_settings",
  businessOwnerId: "@bookease_business_owner_id",
  discounts: "@bookease_discounts",
  giftCards: "@bookease_gift_cards",
  customSchedule: "@bookease_custom_schedule",
  locationCustomSchedule: "@bookease_location_custom_schedule",
  products: "@bookease_products",
  staff: "@bookease_staff",
  locations: "@bookease_locations",
  activeLocationId: "@bookease_active_location_id",
  clientPhotos: "@bookease_client_photos",
  packages: "@bookease_packages",
  servicePhotos: "@bookease_service_photos",
  inboxNotifications: "@bookease_inbox_notifications",
  reminderTemplates: "@bookease_reminder_templates",
};

/** Convert DB rows to local frontend models */
export function dbServiceToLocal(s: any): Service {
  return {
    id: s.localId,
    name: s.name,
    duration: s.duration,
    price: typeof s.price === "string" ? parseFloat(s.price) : s.price,
    color: s.color,
    category: s.category ?? undefined,
    locationIds: s.locationIds ?? null,
    description: s.description ?? undefined,
    photoUri: s.photoUri ?? undefined,
    reminderHours: s.reminderHours != null ? parseFloat(s.reminderHours) : null,
    serviceType: (s.serviceType as 'in_store' | 'mobile') ?? 'in_store',
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbClientToLocal(c: any): Client {
  return {
    id: c.localId,
    name: c.name,
    phone: c.phone ?? "",
    email: c.email ?? "",
    notes: c.notes ?? "",
    birthday: c.birthday ?? "",
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbAppointmentToLocal(a: any): Appointment {
  const notes = a.notes ?? "";
  // Prefer structured DB columns over notes parsing
  let totalPrice: number | undefined = a.totalPrice != null ? parseFloat(String(a.totalPrice)) : undefined;
  let extraItems: { type: "service" | "product"; id: string; name: string; price: number; duration: number }[] | undefined = Array.isArray(a.extraItems) ? a.extraItems : undefined;
  let giftApplied: boolean | undefined = a.giftApplied === true || a.giftApplied === 1 ? true : undefined;
  let giftUsedAmount: number | undefined = a.giftUsedAmount != null ? parseFloat(String(a.giftUsedAmount)) : undefined;
  let discountPercent: number | undefined = a.discountPercent != null ? a.discountPercent : undefined;
  let discountAmount: number | undefined = a.discountAmount != null ? parseFloat(String(a.discountAmount)) : undefined;
  let discountName: string | undefined = a.discountName ?? undefined;
  let cleanNotes = notes;
  const hasDbPricing = totalPrice != null;

  // Only parse notes for pricing if DB columns are empty (backward compat for old appointments)
  const pricingIdx = notes.indexOf("--- Pricing ---");
  if (!hasDbPricing && pricingIdx >= 0) {
    const pricingBlock = notes.slice(pricingIdx + "--- Pricing ---".length).trim();
    cleanNotes = notes.slice(0, pricingIdx).trim();
    // Also strip "Additional items:" line from clean notes
    cleanNotes = cleanNotes.replace(/\nAdditional items:.*$/m, "").trim();

    const lines = pricingBlock.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const extras: { type: "service" | "product"; id: string; name: string; price: number; duration: number }[] = [];
    for (const line of lines) {
      const totalMatch = line.match(/^Total Charged:\s*\$([\d.]+)/);
      if (totalMatch) {
        totalPrice = parseFloat(totalMatch[1]);
        continue;
      }
      const giftMatch = line.match(/^Gift Card:\s*-\$([\d.]+)/);
      if (giftMatch) {
        giftApplied = true;
        giftUsedAmount = parseFloat(giftMatch[1]);
        continue;
      }
      const discountMatch = line.match(/^Discount:\s*(.+?)\s*\((\d+)%\s*off\):\s*-\$([\d.]+)/);
      if (discountMatch) {
        discountName = discountMatch[1];
        discountPercent = parseInt(discountMatch[2], 10);
        discountAmount = parseFloat(discountMatch[3]);
        continue;
      }
      // Also match simpler discount format: "Discount: -$X.XX"
      const simpleDiscountMatch = line.match(/^Discount:\s*-\$([\d.]+)/);
      if (simpleDiscountMatch && !discountAmount) {
        discountAmount = parseFloat(simpleDiscountMatch[1]);
        continue;
      }
      const extraMatch = line.match(/^(Product|Extra|Service):\s*(.+?)\s*\u2014\s*\$([\d.]+)/);
      if (extraMatch) {
        extras.push({
          type: extraMatch[1] === "Product" ? "product" : "service",
          id: "",
          name: extraMatch[2],
          price: parseFloat(extraMatch[3]),
          duration: 0,
        });
      }
    }
    if (extras.length > 0) extraItems = extras;
  } else if (!hasDbPricing) {
    // Try to parse "Additional items:" from notes for older bookings
    const addlMatch = notes.match(/Additional items:\s*(.+)/);
    if (addlMatch) {
      const itemsStr = addlMatch[1];
      const items = itemsStr.split(",").map((s: string) => s.trim());
      const extras: { type: "service" | "product"; id: string; name: string; price: number; duration: number }[] = [];
      for (const item of items) {
        const m = item.match(/^(.+?)\s*\(\$([\d.]+)\)$/);
        if (m) {
          extras.push({ type: "service", id: "", name: m[1].trim(), price: parseFloat(m[2]), duration: 0 });
        }
      }
      if (extras.length > 0) extraItems = extras;
      cleanNotes = notes.replace(/\nAdditional items:.*$/m, "").trim();
    }
  }

  // Strip pricing block from notes for display regardless
  const pricingStripIdx = cleanNotes.indexOf("--- Pricing ---");
  if (pricingStripIdx >= 0) {
    cleanNotes = cleanNotes.slice(0, pricingStripIdx).trim();
  }
  cleanNotes = cleanNotes.replace(/\nAdditional items:.*$/m, "").trim();

  return {
    id: a.localId,
    serviceId: a.serviceLocalId,
    clientId: a.clientLocalId,
    date: a.date,
    time: a.time,
    duration: a.duration,
    status: a.status as AppointmentStatus,
    notes: cleanNotes,
    createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
    totalPrice,
    extraItems,
    giftApplied,
    giftUsedAmount,
    discountPercent,
    discountAmount,
    discountName,
    staffId: a.staffId ?? undefined,
    locationId: a.locationId ?? undefined,
    clientAddress: a.clientAddress ?? undefined,
    paymentStatus: (a.paymentStatus as Appointment['paymentStatus']) ?? undefined,
    paymentMethod: (a.paymentMethod as Appointment['paymentMethod']) ?? undefined,
    paymentConfirmationNumber: a.paymentConfirmationNumber ?? undefined,
    paymentConfirmedAt: a.paymentConfirmedAt ? new Date(a.paymentConfirmedAt).toISOString() : undefined,
    refundedAt: a.refundedAt ? new Date(a.refundedAt).toISOString() : undefined,
    refundedAmount: a.refundedAmount != null ? parseFloat(a.refundedAmount) : undefined,
    stripeRefundId: a.stripeRefundId ?? undefined,
    clientPaidNotifiedAt: a.clientPaidNotifiedAt ? new Date(a.clientPaidNotifiedAt).toISOString() : undefined,
  } as Appointment;
}
export function dbReviewToLocal(r: any): Review {
  return {
    id: r.localId,
    clientId: r.clientLocalId,
    appointmentId: r.appointmentLocalId ?? undefined,
    rating: r.rating,
    comment: r.comment ?? "",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbDiscountToLocal(d: any): Discount {
  return {
    id: d.localId,
    name: d.name,
    percentage: d.percentage,
    startTime: d.startTime,
    endTime: d.endTime,
    daysOfWeek: Array.isArray(d.daysOfWeek) ? d.daysOfWeek : [],
    dates: Array.isArray(d.dates) ? d.dates : [],
    serviceIds: d.serviceIds ?? null,
    maxUses: d.maxUses ?? null,
    active: d.active ?? true,
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbGiftCardToLocal(g: any): GiftCard {
  // Parse extended data from message field (JSON block at end)
  let serviceIds: string[] | undefined;
  let productIds: string[] | undefined;
  let originalValue = 0;
  let remainingBalance = 0;
  let hasGiftData = false;
  let bannerImageUri: string | undefined;
  const msg = g.message ?? "";
  const jsonMatch = msg.match(/\n---GIFT_DATA---\n(.+)$/s);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      serviceIds = data.serviceIds;
      productIds = data.productIds;
      originalValue = data.originalValue ?? 0;
      remainingBalance = data.remainingBalance ?? originalValue;
      bannerImageUri = data.bannerImageUri ?? undefined;
      hasGiftData = true;
    } catch {}
  }
  // For old cards without GIFT_DATA block, serviceIds defaults to serviceLocalId
  if (!hasGiftData && g.serviceLocalId) {
    serviceIds = [g.serviceLocalId];
    // originalValue and remainingBalance stay 0 — will be resolved at display time via catalog lookup
  }
  const cleanMessage = msg.replace(/\n---GIFT_DATA---\n.+$/s, "");
  return {
    id: g.localId,
    code: g.code,
    serviceLocalId: g.serviceLocalId,
    serviceIds,
    productIds,
    originalValue,
    remainingBalance,
    recipientName: g.recipientName ?? "",
    recipientPhone: g.recipientPhone ?? "",
    message: cleanMessage,
    redeemed: g.redeemed ?? false,
    redeemedAt: g.redeemedAt ? new Date(g.redeemedAt).toISOString() : undefined,
    expiresAt: g.expiresAt ?? undefined,
    createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : new Date().toISOString(),
    // Public gift purchase fields
    purchasedPublicly: g.purchasedPublicly === 1 || g.purchasedPublicly === true,
    purchaserName: g.purchaserName ?? undefined,
    purchaserEmail: g.purchaserEmail ?? undefined,
    recipientEmail: g.recipientEmail ?? undefined,
    paymentMethod: g.paymentMethod ?? undefined,
    paymentStatus: g.paymentStatus ?? undefined,
    totalValue: g.totalValue != null ? parseFloat(String(g.totalValue)) : undefined,
     recipientChoosesDate: g.recipientChoosesDate === 1 || g.recipientChoosesDate === true,
    preselectedDate: g.preselectedDate ?? undefined,
    preselectedTime: g.preselectedTime ?? undefined,
    giftType: (() => {
      const jsonMatch2 = (g.message ?? "").match(/\n---GIFT_DATA---\n(.+)$/s);
      if (jsonMatch2) {
        try { const d = JSON.parse(jsonMatch2[1]); if (d.giftType) return d.giftType as "service" | "balance"; } catch {}
      }
      return (g.serviceLocalId ? "service" : "balance") as "service" | "balance";
    })(),
    bannerImageUri,
  };
}
export function dbPromoCodeToLocal(p: any): import("./types").PromoCode {
  return {
    id: p.localId,
    code: p.code,
    label: p.label,
    percentage: p.percentage ?? 0,
    flatAmount: p.flatAmount != null ? parseFloat(String(p.flatAmount)) : null,
    maxUses: p.maxUses ?? null,
    usedCount: p.usedCount ?? 0,
    expiresAt: p.expiresAt ?? null,
    active: p.active ?? true,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbServicePackageToLocal(p: any): import("./types").ServicePackage {
  let serviceIds: string[] = [];
  try {
    const items = typeof p.packageItems === "string" ? JSON.parse(p.packageItems) : (p.packageItems ?? []);
    serviceIds = Array.isArray(items) ? items.map((i: any) => i.serviceLocalId ?? i.serviceId ?? i).filter(Boolean) : [];
  } catch {}
  return {
    id: p.localId,
    name: p.name,
    description: p.description ?? "",
    serviceIds,
    price: typeof p.packagePrice === "string" ? parseFloat(p.packagePrice) : (p.packagePrice ?? 0),
    sessions: p.totalSessions ?? null,
    expiryDays: p.expiryDays ?? null,
    bufferDays: p.bufferDays ?? null,
    bufferMinutes: p.bufferMinutes ?? null,
    active: p.isActive ?? true,
    photoUri: p.photoUri ?? null,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
  };
}
export function dbProductToLocal(p: any): Product {
  return {
    id: p.localId,
    name: p.name,
    price: typeof p.price === "string" ? parseFloat(p.price) : p.price,
    description: p.description ?? "",
    brand: p.brand ?? undefined,
    available: p.available ?? true,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbStaffToLocal(s: any): StaffMember {
  return {
    id: s.localId,
    name: s.name,
    phone: s.phone ?? "",
    email: s.email ?? "",
    role: s.role ?? "",
    color: s.color ?? "#3B82F6",
    serviceIds: s.serviceIds ?? null,
    locationIds: s.locationIds ?? null,
    workingHours: s.workingHours ?? null,
    active: s.active ?? true,
    photoUri: s.photoUri ?? undefined,
    commissionRate: s.commissionRate != null ? parseFloat(s.commissionRate) : null,
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbLocationToLocal(l: any): Location {
  return {
    id: l.localId,
    name: l.name,
    address: l.address ?? "",
    city: l.city ?? undefined,
    state: l.state ?? undefined,
    zipCode: l.zipCode ?? undefined,
    phone: l.phone ?? "",
    email: l.email ?? "",
    isDefault: l.isDefault ?? false,
    active: l.active ?? true,
    temporarilyClosed: l.temporarilyClosed ?? false,
    reopenOn: l.reopenOn ?? undefined,
    workingHours: (l.workingHours && Object.keys(l.workingHours).length > 0) ? normalizeWorkingHours(l.workingHours) : null,
    photoUri: l.photoUri ?? undefined,
    createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function dbCustomScheduleToLocal(cs: any): CustomScheduleDay {
  return {
    date: cs.date,
    isOpen: cs.isOpen ?? true,
    startTime: cs.startTime ?? undefined,
    endTime: cs.endTime ?? undefined,
    locationId: cs.locationId ?? null,
  };
}

/** Normalize working hours keys from any format (Mon/monday/Monday) to full lowercase (monday, tuesday, ...) */
function normalizeWorkingHours(wh: Record<string, any> | null | undefined): Record<string, any> {
  if (!wh) return DEFAULT_WORKING_HOURS;
  const SHORT_TO_FULL: Record<string, string> = {
    mon: "monday", tue: "tuesday", wed: "wednesday",
    thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday",
  };
  const normalized: Record<string, any> = {};
  for (const [key, val] of Object.entries(wh)) {
    const lower = key.toLowerCase();
    const fullKey = SHORT_TO_FULL[lower] ?? lower; // already full → keep as-is
    const defaults = DEFAULT_WORKING_HOURS[fullKey] ?? { enabled: false, start: "09:00", end: "17:00" };
    normalized[fullKey] = { start: defaults.start, end: defaults.end, ...val };
  }
  // Ensure all 7 days are present
  for (const day of Object.keys(DEFAULT_WORKING_HOURS)) {
    if (!normalized[day]) normalized[day] = { ...DEFAULT_WORKING_HOURS[day] };
  }
  return normalized;
}

export function dbOwnerToSettings(owner: any): Partial<BusinessSettings> {
  return {
    businessName: owner.businessName,
    defaultDuration: owner.defaultDuration ?? 60,
    notificationsEnabled: owner.notificationsEnabled ?? true,
    themeMode: owner.themeMode ?? "system",
    temporaryClosed: owner.temporaryClosed ?? false,
    onboardingComplete: owner.onboardingComplete ?? false,
    businessLogoUri: owner.businessLogoUri ?? "",
    scheduleMode: owner.scheduleMode ?? "weekly",
    workingHours: normalizeWorkingHours(owner.workingHours),
    cancellationPolicy: owner.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY,
    bufferTime: owner.bufferTime ?? 0,
    slotInterval: (owner as any).slotInterval ?? 0,
    customSlug: owner.customSlug ?? "",
    businessHoursEndDate: (owner as any).businessHoursEndDate ?? null,
    autoCompleteEnabled: (owner as any).autoCompleteEnabled ?? false,
    autoCompleteDelayMinutes: (owner as any).autoCompleteDelayMinutes ?? 5,
    requestResponseWindowHours: (owner as any).requestResponseWindowHours ?? 48,
    giftValidDays: (owner as any).giftValidDays ?? 90,
    // Merge with defaults so new fields are always present even for old DB records
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(owner.notificationPreferences ?? {}),
    },
    smsTemplates: {
      ...DEFAULT_SMS_TEMPLATES,
      ...((owner as any).smsTemplates ?? {}),
    },
    profile: {
      ownerName: owner.ownerName ?? "",
      phone: owner.phone ?? "",
      email: owner.email ?? "",
      address: owner.address ?? "",
      description: owner.description ?? "",
      website: owner.website ?? "",
    },
    // Payment methods
    zelleHandle: (owner as any).zelleHandle ?? "",
    cashAppHandle: (owner as any).cashAppHandle ?? "",
    venmoHandle: (owner as any).venmoHandle ?? "",
    paymentNotes: (owner as any).paymentNotes ?? "",
    instagramHandle: (owner as any).instagramHandle ?? "",
    facebookHandle: (owner as any).facebookHandle ?? "",
    tiktokHandle: (owner as any).tiktokHandle ?? "",
    // Client portal
    clientPortalVisible: (owner as any).clientPortalVisible ?? false,
    businessCategory: (owner as any).businessCategory ?? null,
    // Stripe Connect
    stripeConnectEnabled: (owner as any).stripeConnectEnabled ?? false,
    stripeConnectAccountId: (owner as any).stripeConnectAccountId ?? null,
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const trpcUtils = trpc.useUtils();
  const businessOwnerIdRef = useRef<number | null>(null);

  // Keep ref in sync
  useEffect(() => {
    businessOwnerIdRef.current = state.businessOwnerId;
  }, [state.businessOwnerId]);

  // --- tRPC mutations ---
  const createServiceMut = trpc.services.create.useMutation();
  const updateServiceMut = trpc.services.update.useMutation();
  const deleteServiceMut = trpc.services.delete.useMutation();
  const createClientMut = trpc.clients.create.useMutation();
  const updateClientMut = trpc.clients.update.useMutation();
  const deleteClientMut = trpc.clients.delete.useMutation();
  const createApptMut = trpc.appointments.create.useMutation();
  const updateApptMut = trpc.appointments.update.useMutation();
  const deleteApptMut = trpc.appointments.delete.useMutation();
  const bulkMarkPaidMut = trpc.appointments.bulkMarkPaid.useMutation();
  const bulkMarkUnpaidMut = trpc.appointments.bulkMarkUnpaid.useMutation();
  const createReviewMut = trpc.reviews.create.useMutation();
  const deleteReviewMut = trpc.reviews.delete.useMutation();
  const updateBusinessMut = trpc.business.update.useMutation();
  const createDiscountMut = trpc.discounts.create.useMutation();
  const updateDiscountMut = trpc.discounts.update.useMutation();
  const deleteDiscountMut = trpc.discounts.delete.useMutation();
  const createGiftCardMut = trpc.giftCards.create.useMutation();
  const updateGiftCardMut = trpc.giftCards.update.useMutation();
  const deleteGiftCardMut = trpc.giftCards.delete.useMutation();
  const upsertScheduleMut = trpc.customSchedule.upsert.useMutation();
  const deleteScheduleMut = trpc.customSchedule.delete.useMutation();
  const createProductMut = trpc.products.create.useMutation();
  const updateProductMut = trpc.products.update.useMutation();
  const deleteProductMut = trpc.products.delete.useMutation();
  const createStaffMut = trpc.staff.create.useMutation();
  const updateStaffMut = trpc.staff.update.useMutation();
  const deleteStaffMut = trpc.staff.delete.useMutation();
  const createLocationMut = trpc.locations.create.useMutation();
  const updateLocationMut = trpc.locations.update.useMutation();
  const deleteLocationMut = trpc.locations.delete.useMutation();

  // --- Mutation ref: keeps syncToDb's stale closure up-to-date ---
  // syncToDb has [] deps to avoid re-creating on every render, but it needs the
  // latest mutation objects. We solve this with a ref that is updated every render.
  const createPromoCodeMut = trpc.promoCodes.create.useMutation();
  const updatePromoCodeMut = trpc.promoCodes.update.useMutation();
  const deletePromoCodeMut = trpc.promoCodes.delete.useMutation();
  const createPackageMut = trpc.packages.create.useMutation();
  const updatePackageMut = trpc.packages.update.useMutation();
  const deletePackageMut = trpc.packages.delete.useMutation();
  const mutsRef = useRef({
    createServiceMut, updateServiceMut, deleteServiceMut,
    createClientMut, updateClientMut, deleteClientMut,
    createApptMut, updateApptMut, deleteApptMut,
    createReviewMut, deleteReviewMut,
    updateBusinessMut,
    createDiscountMut, updateDiscountMut, deleteDiscountMut,
    createGiftCardMut, updateGiftCardMut, deleteGiftCardMut,
    upsertScheduleMut, deleteScheduleMut,
    createProductMut, updateProductMut, deleteProductMut,
    createStaffMut, updateStaffMut, deleteStaffMut,
    createLocationMut, updateLocationMut, deleteLocationMut,
    createPromoCodeMut, updatePromoCodeMut, deletePromoCodeMut,
    createPackageMut, updatePackageMut, deletePackageMut,
  });
  // Update ref every render so syncToDb always has the latest mutateAsync
  mutsRef.current = {
    createServiceMut, updateServiceMut, deleteServiceMut,
    createClientMut, updateClientMut, deleteClientMut,
    createApptMut, updateApptMut, deleteApptMut,
    createReviewMut, deleteReviewMut,
    updateBusinessMut,
    createDiscountMut, updateDiscountMut, deleteDiscountMut,
    createGiftCardMut, updateGiftCardMut, deleteGiftCardMut,
    upsertScheduleMut, deleteScheduleMut,
    createProductMut, updateProductMut, deleteProductMut,
    createStaffMut, updateStaffMut, deleteStaffMut,
    createLocationMut, updateLocationMut, deleteLocationMut,
    createPromoCodeMut, updatePromoCodeMut, deletePromoCodeMut,
    createPackageMut, updatePackageMut, deletePackageMut,
  };

  // --- Bootstrap: Load from DB or fallback to AsyncStorage ---
  useEffect(() => {
    (async () => {
      try {
        // First check if we have a stored business owner ID
        const storedOwnerId = await AsyncStorage.getItem(STORAGE_KEYS.businessOwnerId);

        // ── STEP 1: Load AsyncStorage cache immediately (stale-while-revalidate) ──
        // Show the user their last-known data instantly (~50ms) while DB fetches in background
        if (storedOwnerId) {
          const [servicesRaw, clientsRaw, appointmentsRaw, reviewsRaw, settingsRaw, discountsRaw, giftCardsRaw, customScheduleRaw, productsRaw, staffRaw, locationsRaw, locationCustomScheduleRaw, clientPhotosRaw, packagesRaw, servicePhotosRaw, inboxNotificationsRaw, reminderTemplatesRaw] =
            await Promise.all([
              AsyncStorage.getItem(STORAGE_KEYS.services),
              AsyncStorage.getItem(STORAGE_KEYS.clients),
              AsyncStorage.getItem(STORAGE_KEYS.appointments),
              AsyncStorage.getItem(STORAGE_KEYS.reviews),
              AsyncStorage.getItem(STORAGE_KEYS.settings),
              AsyncStorage.getItem(STORAGE_KEYS.discounts),
              AsyncStorage.getItem(STORAGE_KEYS.giftCards),
              AsyncStorage.getItem(STORAGE_KEYS.customSchedule),
              AsyncStorage.getItem(STORAGE_KEYS.products),
              AsyncStorage.getItem(STORAGE_KEYS.staff),
              AsyncStorage.getItem(STORAGE_KEYS.locations),
              AsyncStorage.getItem(STORAGE_KEYS.locationCustomSchedule),
              AsyncStorage.getItem(STORAGE_KEYS.clientPhotos),
              AsyncStorage.getItem(STORAGE_KEYS.packages),
              AsyncStorage.getItem(STORAGE_KEYS.servicePhotos),
              AsyncStorage.getItem(STORAGE_KEYS.inboxNotifications),
              AsyncStorage.getItem(STORAGE_KEYS.reminderTemplates),
            ]);
          if (servicesRaw || clientsRaw || appointmentsRaw || locationsRaw) {
            const parsedSettingsCache = settingsRaw ? JSON.parse(settingsRaw) : {};
            const cachedSettings: BusinessSettings = settingsRaw
              ? {
                  ...initialSettings,
                  ...parsedSettingsCache,
                  notificationPreferences: {
                    ...DEFAULT_NOTIFICATION_PREFERENCES,
                    ...(parsedSettingsCache.notificationPreferences ?? {}),
                  },
                }
              : initialSettings;
            dispatch({
              type: "LOAD_DATA",
              payload: {
                services: servicesRaw ? JSON.parse(servicesRaw) : [],
                clients: clientsRaw ? JSON.parse(clientsRaw) : [],
                appointments: appointmentsRaw ? JSON.parse(appointmentsRaw) : [],
                reviews: reviewsRaw ? JSON.parse(reviewsRaw) : [],
                discounts: discountsRaw ? JSON.parse(discountsRaw) : [],
                giftCards: giftCardsRaw ? JSON.parse(giftCardsRaw) : [],
                customSchedule: customScheduleRaw ? JSON.parse(customScheduleRaw) : [],
                locationCustomSchedule: locationCustomScheduleRaw ? JSON.parse(locationCustomScheduleRaw) : {},
                products: productsRaw ? JSON.parse(productsRaw) : [],
                staff: staffRaw ? JSON.parse(staffRaw) : [],
                locations: locationsRaw ? (JSON.parse(locationsRaw) as Location[]).map((l) => ({
                  ...l,
                  workingHours: (l.workingHours && Object.keys(l.workingHours).length > 0)
                    ? normalizeWorkingHours(l.workingHours)
                    : null,
                })) : [],
                settings: cachedSettings,
                businessOwnerId: parseInt(storedOwnerId, 10),
                clientPhotos: clientPhotosRaw ? JSON.parse(clientPhotosRaw) : [],
                packages: packagesRaw ? JSON.parse(packagesRaw) : [],
                servicePhotos: servicePhotosRaw ? JSON.parse(servicePhotosRaw) : [],
                inboxNotifications: inboxNotificationsRaw ? JSON.parse(inboxNotificationsRaw) : [],
                reminderTemplates: reminderTemplatesRaw ? JSON.parse(reminderTemplatesRaw) : DEFAULT_REMINDER_TEMPLATES,
              },
            });
            // Restore active location
            const parsedLocsEarly: Location[] = locationsRaw ? JSON.parse(locationsRaw) : [];
            const activeLocsEarly = parsedLocsEarly.filter((l) => l.active);
            if (activeLocsEarly.length === 1) {
              // Single location — auto-select it
              dispatch({ type: "SET_ACTIVE_LOCATION", payload: activeLocsEarly[0].id });
            } else if (activeLocsEarly.length > 1) {
              // Multiple locations → always show All Locations (null), clear any stored preference
              AsyncStorage.removeItem(STORAGE_KEYS.activeLocationId).catch(() => {});
              // activeLocationId stays null — All Locations is pre-selected
            }
            logger.log("[Store] Loaded from AsyncStorage cache instantly, refreshing from DB in background...");
          }
        }

        // ── STEP 2: Refresh from DB in background (revalidate) ──
        if (storedOwnerId) {
          const ownerId = parseInt(storedOwnerId, 10);
          try {
            // Try to load from database
            const fullData = await trpcUtils.business.getFullData.fetch({ id: ownerId });
            if (fullData && fullData.owner) {
              const settingsFromDb = dbOwnerToSettings(fullData.owner);
              // If DB has no locations, check AsyncStorage for locally-created locations to recover
              let dbLocations = (fullData.locations || []).map(dbLocationToLocal);
              if (dbLocations.length === 0) {
                const cachedLocsRaw = await AsyncStorage.getItem(STORAGE_KEYS.locations);
                if (cachedLocsRaw) {
                  try {
                    const cachedLocs: Location[] = JSON.parse(cachedLocsRaw);
                    if (cachedLocs.length > 0) {
                      // Sync these locations to DB so they persist going forward
                      dbLocations = cachedLocs;
                      for (const loc of cachedLocs) {
                        createLocationMut.mutateAsync({
                          businessOwnerId: ownerId,
                          localId: loc.id,
                          name: loc.name,
                          address: loc.address || undefined,
                          city: loc.city || undefined,
                          state: loc.state || undefined,
                          zipCode: loc.zipCode || undefined,
                          phone: loc.phone || undefined,
                          email: loc.email || undefined,
                          isDefault: loc.isDefault,
                          active: loc.active,
                          temporarilyClosed: loc.temporarilyClosed,
                          reopenOn: loc.reopenOn,
                          workingHours: loc.workingHours,
                        }).catch(() => {});
                      }
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
              // Split custom schedule entries: global (no locationId) vs per-location
              const allScheduleEntries = (fullData.customSchedule || []).map(dbCustomScheduleToLocal);
              const globalSchedule = allScheduleEntries.filter((cs) => !cs.locationId);
              const locationScheduleMap: Record<string, CustomScheduleDay[]> = {};
              for (const cs of allScheduleEntries) {
                if (cs.locationId) {
                  if (!locationScheduleMap[cs.locationId]) locationScheduleMap[cs.locationId] = [];
                  locationScheduleMap[cs.locationId].push(cs);
                }
              }
              dispatch({
                type: "LOAD_DATA",
                payload: {
                  services: (fullData.services || []).map(dbServiceToLocal),
                  clients: (fullData.clients || []).map(dbClientToLocal),
                  appointments: (fullData.appointments || []).map(dbAppointmentToLocal),
                  reviews: (fullData.reviews || []).map(dbReviewToLocal),
                  discounts: (fullData.discounts || []).map(dbDiscountToLocal),
                  giftCards: (fullData.giftCards || []).map(dbGiftCardToLocal),
                  customSchedule: globalSchedule,
                  locationCustomSchedule: locationScheduleMap,
                  products: (fullData.products || []).map(dbProductToLocal),
                  staff: (fullData.staff || []).map(dbStaffToLocal),
                  locations: dbLocations,
                  settings: { ...initialSettings, ...settingsFromDb },
                  businessOwnerId: ownerId,
                  promoCodes: (fullData.promoCodes || []).map(dbPromoCodeToLocal),
                  packages: (fullData.servicePackages || []).map(dbServicePackageToLocal),
                },
              });
              // Sync inbox from appointments (populates inbox even when push notifications were missed)
              dispatch({ type: "SYNC_INBOX_FROM_APPOINTMENTS" });
              // Restore active location from AsyncStorage (or auto-set default)
              const storedActiveLoc = await AsyncStorage.getItem(STORAGE_KEYS.activeLocationId);
              const loadedLocations = dbLocations;
              const activeLocations = loadedLocations.filter((l) => l.active);
              let chosenActiveId: string | null = null;
              if (activeLocations.length === 1) {
                // Only one location — auto-select it
                chosenActiveId = activeLocations[0].id;
                AsyncStorage.setItem(STORAGE_KEYS.activeLocationId, chosenActiveId).catch(() => {});
              } else if (activeLocations.length > 1) {
                // Multiple locations → always default to All Locations (null)
                chosenActiveId = null;
                AsyncStorage.removeItem(STORAGE_KEYS.activeLocationId).catch(() => {});
              } else if (storedActiveLoc && activeLocations.some((l) => l.id === storedActiveLoc)) {
                chosenActiveId = storedActiveLoc;
              }
              if (chosenActiveId) {
                dispatch({ type: "SET_ACTIVE_LOCATION", payload: chosenActiveId });
                // Note: all locations remain active in DB; activeLocationId is just a UI filter
              }
              // Also persist to AsyncStorage as cache
              await persistToAsyncStorage(
                (fullData.services || []).map(dbServiceToLocal),
                (fullData.clients || []).map(dbClientToLocal),
                (fullData.appointments || []).map(dbAppointmentToLocal),
                (fullData.reviews || []).map(dbReviewToLocal),
                { ...initialSettings, ...settingsFromDb },
                (fullData.discounts || []).map(dbDiscountToLocal),
                (fullData.giftCards || []).map(dbGiftCardToLocal),
                globalSchedule,
                (fullData.products || []).map(dbProductToLocal),
                (fullData.staff || []).map(dbStaffToLocal),
                dbLocations,
                locationScheduleMap
              );
              return;
            }
          } catch (err) {
            // DB load failed — log clearly so it's visible in crash logs
            logger.error("[Store] Failed to load from DB:", err);
            // The AsyncStorage cache (written on last successful DB load) will be used as offline fallback below
            // This means the user sees their last-known data instead of a blank app
          }

          // ── ID mismatch recovery ──────────────────────────────────────────────
          // If the stored ID returned no owner (DB was re-seeded / migrated), try
          // looking up the owner by the cached phone number so the app self-heals
          // without requiring the user to re-onboard.
          try {
            const cachedSettingsRaw = await AsyncStorage.getItem(STORAGE_KEYS.settings);
            const cachedPhone: string | null = cachedSettingsRaw
              ? (JSON.parse(cachedSettingsRaw) as BusinessSettings).profile?.phone ?? null
              : null;
            if (cachedPhone) {
              const ownerByPhone = await trpcUtils.business.checkByPhone.fetch({ phone: cachedPhone });
              if (ownerByPhone && ownerByPhone.id && ownerByPhone.id !== parseInt(storedOwnerId, 10)) {
                logger.warn("[Store] businessOwnerId mismatch — updating from", storedOwnerId, "to", ownerByPhone.id);
                await AsyncStorage.setItem(STORAGE_KEYS.businessOwnerId, String(ownerByPhone.id));
                dispatch({ type: "SET_BUSINESS_OWNER_ID", payload: ownerByPhone.id });
                // Re-fetch full data with the corrected ID
                try {
                  const fullData2 = await trpcUtils.business.getFullData.fetch({ id: ownerByPhone.id });
                  if (fullData2 && fullData2.owner) {
                    const settingsFromDb2 = dbOwnerToSettings(fullData2.owner);
                    const dbLocations2 = (fullData2.locations || []).map(dbLocationToLocal);
                    const allScheduleEntries2 = (fullData2.customSchedule || []).map(dbCustomScheduleToLocal);
                    const globalSchedule2 = allScheduleEntries2.filter((cs) => !cs.locationId);
                    const locationScheduleMap2: Record<string, CustomScheduleDay[]> = {};
                    for (const cs of allScheduleEntries2) {
                      if (cs.locationId) {
                        if (!locationScheduleMap2[cs.locationId]) locationScheduleMap2[cs.locationId] = [];
                        locationScheduleMap2[cs.locationId].push(cs);
                      }
                    }
                    dispatch({
                      type: "LOAD_DATA",
                      payload: {
                        services: (fullData2.services || []).map(dbServiceToLocal),
                        clients: (fullData2.clients || []).map(dbClientToLocal),
                        appointments: (fullData2.appointments || []).map(dbAppointmentToLocal),
                        reviews: (fullData2.reviews || []).map(dbReviewToLocal),
                        discounts: (fullData2.discounts || []).map(dbDiscountToLocal),
                        giftCards: (fullData2.giftCards || []).map(dbGiftCardToLocal),
                        customSchedule: globalSchedule2,
                        locationCustomSchedule: locationScheduleMap2,
                        products: (fullData2.products || []).map(dbProductToLocal),
                        staff: (fullData2.staff || []).map(dbStaffToLocal),
                        locations: dbLocations2,
                        settings: { ...initialSettings, ...settingsFromDb2 },
                        businessOwnerId: ownerByPhone.id,
                        promoCodes: (fullData2.promoCodes || []).map(dbPromoCodeToLocal),
                        packages: (fullData2.servicePackages || []).map(dbServicePackageToLocal),
                      },
                    });
                    dispatch({ type: "SYNC_INBOX_FROM_APPOINTMENTS" });
                    return;
                  }
                } catch (e2) {
                  logger.error("[Store] Re-fetch after ID mismatch recovery failed:", e2);
                }
              }
            }
          } catch (recoveryErr) {
            logger.warn("[Store] ID mismatch recovery failed:", recoveryErr);
          }
        }

        // Fallback: load from AsyncStorage cache (written on last successful DB sync)
        // On first install with no cache, all arrays will be empty and the user will be prompted to log in
        const [servicesRaw, clientsRaw, appointmentsRaw, reviewsRaw, settingsRaw, discountsRaw, giftCardsRaw, customScheduleRaw, productsRaw, staffRaw, locationsRaw, locationCustomScheduleRaw, clientPhotosRaw, packagesRaw, servicePhotosRaw] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEYS.services),
            AsyncStorage.getItem(STORAGE_KEYS.clients),
            AsyncStorage.getItem(STORAGE_KEYS.appointments),
            AsyncStorage.getItem(STORAGE_KEYS.reviews),
            AsyncStorage.getItem(STORAGE_KEYS.settings),
            AsyncStorage.getItem(STORAGE_KEYS.discounts),
            AsyncStorage.getItem(STORAGE_KEYS.giftCards),
            AsyncStorage.getItem(STORAGE_KEYS.customSchedule),
            AsyncStorage.getItem(STORAGE_KEYS.products),
            AsyncStorage.getItem(STORAGE_KEYS.staff),
            AsyncStorage.getItem(STORAGE_KEYS.locations),
            AsyncStorage.getItem(STORAGE_KEYS.locationCustomSchedule),
            AsyncStorage.getItem(STORAGE_KEYS.clientPhotos),
            AsyncStorage.getItem(STORAGE_KEYS.packages),
            AsyncStorage.getItem(STORAGE_KEYS.servicePhotos),
          ]);
        
        const parsedSettings = settingsRaw ? JSON.parse(settingsRaw) : {};
        const loadedSettings: BusinessSettings = settingsRaw
          ? {
              ...initialSettings,
              ...parsedSettings,
              // Deep-merge notificationPreferences so new keys added after the user's
              // last cache write are always present (prevents undefined crash in Settings)
              notificationPreferences: {
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                ...(parsedSettings.notificationPreferences ?? {}),
              },
            }
          : initialSettings;
        
        dispatch({
          type: "LOAD_DATA",
          payload: {
            services: servicesRaw ? JSON.parse(servicesRaw) : [],
            clients: clientsRaw ? JSON.parse(clientsRaw) : [],
            appointments: appointmentsRaw ? JSON.parse(appointmentsRaw) : [],
            reviews: reviewsRaw ? JSON.parse(reviewsRaw) : [],
            discounts: discountsRaw ? JSON.parse(discountsRaw) : [],
            giftCards: giftCardsRaw ? JSON.parse(giftCardsRaw) : [],
            customSchedule: customScheduleRaw ? JSON.parse(customScheduleRaw) : [],
            locationCustomSchedule: locationCustomScheduleRaw ? JSON.parse(locationCustomScheduleRaw) : {},
            products: productsRaw ? JSON.parse(productsRaw) : [],
            staff: staffRaw ? JSON.parse(staffRaw) : [],
            locations: locationsRaw ? (JSON.parse(locationsRaw) as Location[]).map((l) => ({
              ...l,
              workingHours: (l.workingHours && Object.keys(l.workingHours).length > 0)
                ? normalizeWorkingHours(l.workingHours)
                : null,
            })) : [],
            settings: loadedSettings,
            businessOwnerId: storedOwnerId ? parseInt(storedOwnerId, 10) : null,
            clientPhotos: clientPhotosRaw ? JSON.parse(clientPhotosRaw) : [],
            packages: packagesRaw ? JSON.parse(packagesRaw) : [],
            servicePhotos: servicePhotosRaw ? JSON.parse(servicePhotosRaw) : [],
          },
        });
        // Restore active location from AsyncStorage (or auto-set default)
        const parsedLocations: Location[] = locationsRaw ? JSON.parse(locationsRaw) : [];
        const activeLocations2 = parsedLocations.filter((l) => l.active);
        if (activeLocations2.length === 1) {
          // Only one location — auto-select it
          dispatch({ type: "SET_ACTIVE_LOCATION", payload: activeLocations2[0].id });
          AsyncStorage.setItem(STORAGE_KEYS.activeLocationId, activeLocations2[0].id).catch(() => {});
        } else if (activeLocations2.length > 1) {
          // Multiple locations → always default to All Locations (null)
          AsyncStorage.removeItem(STORAGE_KEYS.activeLocationId).catch(() => {});
          // activeLocationId stays null — All Locations is pre-selected
        }
        // Multiple locations with no stored preference → leave null (show All Locations)
      } catch {
        dispatch({ type: "LOAD_DATA", payload: {} });
      }
    })();
  }, []);

  // --- Persist to AsyncStorage whenever state changes ---
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.services, JSON.stringify(state.services));
  }, [state.services, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(state.clients));
  }, [state.clients, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.appointments, JSON.stringify(state.appointments));
  }, [state.appointments, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(state.reviews));
  }, [state.reviews, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }, [state.settings, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.discounts, JSON.stringify(state.discounts));
  }, [state.discounts, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.giftCards, JSON.stringify(state.giftCards));
  }, [state.giftCards, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.customSchedule, JSON.stringify(state.customSchedule));
  }, [state.customSchedule, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.locationCustomSchedule, JSON.stringify(state.locationCustomSchedule));
  }, [state.locationCustomSchedule, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.products, JSON.stringify(state.products));
  }, [state.products, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.staff, JSON.stringify(state.staff));
  }, [state.staff, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.locations, JSON.stringify(state.locations));
  }, [state.locations, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.clientPhotos, JSON.stringify(state.clientPhotos));
  }, [state.clientPhotos, state.loaded]);
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.packages, JSON.stringify(state.packages ?? []));
  }, [state.packages, state.loaded]);
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.servicePhotos, JSON.stringify(state.servicePhotos ?? []));
  }, [state.servicePhotos, state.loaded]);
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.inboxNotifications, JSON.stringify(state.inboxNotifications ?? []));
  }, [state.inboxNotifications, state.loaded]);
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.reminderTemplates, JSON.stringify(state.reminderTemplates ?? DEFAULT_REMINDER_TEMPLATES));
  }, [state.reminderTemplates, state.loaded]);
  useEffect(() => {
    if (state.businessOwnerId !== null) {
      AsyncStorage.setItem(STORAGE_KEYS.businessOwnerId, String(state.businessOwnerId));
    }
  }, [state.businessOwnerId]);  // --- Auto-reopen: check reopenOn dates on load ---
  // We use a ref to avoid stale closure on syncToDb (which is defined below)
  const pendingReopenRef = useRef<Location[]>([]);
  // Pending auto-complete actions to run once syncToDb is available
  const pendingAutoCompleteRef = useRef<Array<{ id: string }>>([]);
  useEffect(() => {
    if (!state.loaded) return;
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const toReopen = state.locations.filter(
      (l) => l.temporarilyClosed && l.reopenOn && l.reopenOn <= todayStr
    );
    if (toReopen.length === 0) return;
    pendingReopenRef.current = toReopen;
    toReopen.forEach((l) => {
      const action = { type: "UPDATE_LOCATION" as const, payload: { ...l, temporarilyClosed: false, reopenOn: undefined } as Location };
      dispatch(action);
    });
  // Only run on initial load (state.loaded flip)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded]);

  // --- Auto-complete on initial load ---
  // Runs once when data first loads. Marks confirmed appointments whose
  // end time + delay has already passed (catches the fully-closed-app case).
  // syncToDb is not yet available here, so we queue IDs and flush them once
  // syncToDbRef is wired up (see the useEffect after syncToDb is defined).
  useEffect(() => {
    if (!state.loaded) return;
    if (!state.settings.autoCompleteEnabled) return;
    const delayMs = (state.settings.autoCompleteDelayMinutes ?? 5) * 60 * 1000;
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);
    const toComplete = state.appointments.filter((a) => {
      if (a.status !== "confirmed") return false;
      if (a.date > todayStr) return false;
      const svc = state.services.find((sv) => sv.id === a.serviceId);
      const duration = svc?.duration ?? (a as any).duration ?? 30;
      const endMins = timeToMinutes(a.time) + duration;
      const endDate = new Date(a.date + "T00:00:00");
      endDate.setMinutes(endDate.getMinutes() + endMins);
      return now >= endDate.getTime() + delayMs;
    });
    if (toComplete.length === 0) return;
    // Dispatch state updates immediately
    toComplete.forEach((a) => {
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: a.id, status: "completed" as AppointmentStatus } });
    });
    // Queue DB sync for after syncToDbRef is wired up
    pendingAutoCompleteRef.current = toComplete.map((a) => ({ id: a.id }));
  // Only run on initial load (state.loaded flip)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded]);

  // --- refreshFromDb: pull latest data from DB and update store ---
  const refreshFromDb = useCallback(async () => {
    const ownerId = businessOwnerIdRef.current;
    if (!ownerId) return;
    try {
      await trpcUtils.business.getFullData.invalidate({ id: ownerId });
      const fullData = await trpcUtils.business.getFullData.fetch({ id: ownerId });
      if (!fullData || !fullData.owner) return;
      const dbLocations = (fullData.locations || []).map(dbLocationToLocal);
      // Split custom schedule entries: global (no locationId) vs per-location
      const allRefreshEntries = (fullData.customSchedule || []).map(dbCustomScheduleToLocal);
      const refreshGlobalSchedule = allRefreshEntries.filter((cs) => !cs.locationId);
      const refreshLocationScheduleMap: Record<string, CustomScheduleDay[]> = {};
      for (const cs of allRefreshEntries) {
        if (cs.locationId) {
          if (!refreshLocationScheduleMap[cs.locationId]) refreshLocationScheduleMap[cs.locationId] = [];
          refreshLocationScheduleMap[cs.locationId].push(cs);
        }
      }
      dispatch({
        type: "LOAD_DATA",
        payload: {
          services: (fullData.services || []).map(dbServiceToLocal),
          clients: (fullData.clients || []).map(dbClientToLocal),
          appointments: (fullData.appointments || []).map(dbAppointmentToLocal),
          reviews: (fullData.reviews || []).map(dbReviewToLocal),
          discounts: (fullData.discounts || []).map(dbDiscountToLocal),
          giftCards: (fullData.giftCards || []).map(dbGiftCardToLocal),
          customSchedule: refreshGlobalSchedule,
          locationCustomSchedule: refreshLocationScheduleMap,
          products: (fullData.products || []).map(dbProductToLocal),
          staff: (fullData.staff || []).map(dbStaffToLocal),
          locations: dbLocations,
          settings: { ...initialSettings, ...dbOwnerToSettings(fullData.owner) },
          promoCodes: (fullData.promoCodes || []).map(dbPromoCodeToLocal),
          packages: (fullData.servicePackages || []).map(dbServicePackageToLocal),
        },
      });
      dispatch({ type: "SYNC_INBOX_FROM_APPOINTMENTS" });
      // Restore active location if it still exists, else pick default
      const activeLocations = dbLocations.filter((l) => l.active);
      if (activeLocations.length === 1) {
        // Only one location — auto-select it
        dispatch({ type: "SET_ACTIVE_LOCATION", payload: activeLocations[0].id });
        AsyncStorage.setItem(STORAGE_KEYS.activeLocationId, activeLocations[0].id).catch(() => {});
      } else if (activeLocations.length > 1) {
        // Multiple locations → always default to All Locations (null)
        dispatch({ type: "SET_ACTIVE_LOCATION", payload: null as any });
        AsyncStorage.removeItem(STORAGE_KEYS.activeLocationId).catch(() => {});
      }
      // Multiple locations with no stored preference → leave null (show All Locations)
    } catch (err) {
      logger.warn("[Store] refreshFromDb failed:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trpcUtils]);

  // --- Background-to-foreground sync ---
  // Stable refs so the AppState listener can read current values without
  // being re-created on every render (avoids stale closure).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  const syncToDbRef = useRef<((action: Action) => void) | null>(null);
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && businessOwnerIdRef.current) {
        refreshFromDb();
        // --- Foreground auto-complete check ---
        // The scheduled notification listener only fires in foreground.
        // When the app resumes from background, scan for any confirmed
        // appointments whose end time + delay has already passed and
        // mark them completed immediately.
        const s = stateRef.current;
        if (!s.settings.autoCompleteEnabled) return;
        const delayMs = (s.settings.autoCompleteDelayMinutes ?? 5) * 60 * 1000;
        const now = Date.now();
        const todayStr = new Date().toISOString().slice(0, 10);
        const toComplete = s.appointments.filter((a) => {
          if (a.status !== "confirmed") return false;
          if (a.date > todayStr) return false;
          const svc = s.services.find((sv) => sv.id === a.serviceId);
          const duration = svc?.duration ?? (a as any).duration ?? 30;
          const endMins = timeToMinutes(a.time) + duration;
          const endDate = new Date(a.date + "T00:00:00");
          endDate.setMinutes(endDate.getMinutes() + endMins);
          return now >= endDate.getTime() + delayMs;
        });
        if (toComplete.length > 0 && syncToDbRef.current) {
          toComplete.forEach((a) => {
            const action = { type: "UPDATE_APPOINTMENT_STATUS" as const, payload: { id: a.id, status: "completed" as AppointmentStatus } };
            dispatch(action);
            syncToDbRef.current!(action);
          });
        }
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshFromDb]);

  // --- Periodic auto-complete check (every 60 seconds while app is open) ---
  // Catches the case where the app stays in the foreground all day without
  // being backgrounded/foregrounded, so the AppState listener never fires.
  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!s.settings.autoCompleteEnabled) return;
      if (!syncToDbRef.current) return;
      const delayMs = (s.settings.autoCompleteDelayMinutes ?? 5) * 60 * 1000;
      const now = Date.now();
      const todayStr = new Date().toISOString().slice(0, 10);
      const toComplete = s.appointments.filter((a) => {
        if (a.status !== "confirmed") return false;
        if (a.date > todayStr) return false;
        const svc = s.services.find((sv) => sv.id === a.serviceId);
        const duration = svc?.duration ?? (a as any).duration ?? 30;
        const endMins = timeToMinutes(a.time) + duration;
        const endDate = new Date(a.date + "T00:00:00");
        endDate.setMinutes(endDate.getMinutes() + endMins);
        return now >= endDate.getTime() + delayMs;
      });
      if (toComplete.length > 0) {
        toComplete.forEach((a) => {
          const action = { type: "UPDATE_APPOINTMENT_STATUS" as const, payload: { id: a.id, status: "completed" as AppointmentStatus } };
          dispatch(action);
          syncToDbRef.current!(action);
        });
      }
    }, 60_000); // every 60 seconds
    return () => clearInterval(interval);
  }, []); // empty deps — uses stable refs only

  // --- Sync action to database ---
  const syncToDb = useCallback(
    async (action: Action, ownerIdOverride?: number | null) => {
      const ownerId = ownerIdOverride ?? businessOwnerIdRef.current;
      if (!ownerId) return; // No business owner yet, skip DB sync
      // Always read from ref to get the latest mutateAsync (avoids stale closure bug)
      const {
        createServiceMut, updateServiceMut, deleteServiceMut,
        createClientMut, updateClientMut, deleteClientMut,
        createApptMut, updateApptMut, deleteApptMut,
        createReviewMut, deleteReviewMut,
        updateBusinessMut,
        createDiscountMut, updateDiscountMut, deleteDiscountMut,
        createGiftCardMut, updateGiftCardMut, deleteGiftCardMut,
        upsertScheduleMut, deleteScheduleMut,
        createProductMut, updateProductMut, deleteProductMut,
        createStaffMut, updateStaffMut, deleteStaffMut,
        createLocationMut, updateLocationMut, deleteLocationMut,
        createPromoCodeMut, updatePromoCodeMut, deletePromoCodeMut,
        createPackageMut, updatePackageMut, deletePackageMut,
      } = mutsRef.current;

      try {
        switch (action.type) {
          case "ADD_SERVICE": {
            const svc = action.payload as Service;
            await createServiceMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: svc.id,
              name: svc.name,
              duration: svc.duration,
              price: String(svc.price),
              color: svc.color,
              category: svc.category,
              locationIds: svc.locationIds,
              description: svc.description,
              photoUri: svc.photoUri,
              reminderHours: svc.reminderHours != null ? svc.reminderHours : undefined,
              serviceType: svc.serviceType,
            });
            break;
          }
          case "UPDATE_SERVICE": {
            const svc = action.payload as Service;
            await updateServiceMut.mutateAsync({
              localId: svc.id,
              businessOwnerId: ownerId,
              name: svc.name,
              duration: svc.duration,
              price: String(svc.price),
              color: svc.color,
              category: svc.category,
              locationIds: svc.locationIds,
              description: svc.description,
              photoUri: svc.photoUri,
              reminderHours: svc.reminderHours != null ? svc.reminderHours : undefined,
              serviceType: svc.serviceType,
            });
            break;
          }
          case "DELETE_SERVICE": {
            await deleteServiceMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_CLIENT": {
            const cl = action.payload as Client;
            await createClientMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: cl.id,
              name: cl.name,
              phone: cl.phone || undefined,
              email: cl.email || undefined,
              notes: cl.notes || undefined,
              birthday: cl.birthday || undefined,
            });
            break;
          }
          case "UPDATE_CLIENT": {
            const cl = action.payload as Client;
            await updateClientMut.mutateAsync({
              localId: cl.id,
              businessOwnerId: ownerId,
              name: cl.name,
              phone: cl.phone || undefined,
              email: cl.email || undefined,
              notes: cl.notes || undefined,
              birthday: cl.birthday || undefined,
            });
            break;
          }
          case "DELETE_CLIENT": {
            await deleteClientMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_APPOINTMENT": {
            const appt = action.payload as Appointment;
            // Enrich notes with pricing info for DB persistence
            let enrichedNotes = appt.notes || "";
            const svc = state.services.find(s => s.id === appt.serviceId);
            const svcPrice = svc?.price ?? 0;
            const extras = appt.extraItems ?? [];
            const hasDiscount = (appt.discountAmount ?? 0) > 0;
            if (extras.length > 0 || appt.giftApplied || hasDiscount) {
              const pricingLines: string[] = [];
              pricingLines.push(`Service: ${svc?.name ?? "Service"} \u2014 $${svcPrice.toFixed(2)}`);
              extras.forEach(e => {
                pricingLines.push(`${e.type === "product" ? "Product" : "Extra"}: ${e.name} \u2014 $${(e.price || 0).toFixed(2)}`);
              });
              if (hasDiscount) {
                const dName = appt.discountName || "Discount";
                const dPct = appt.discountPercent ?? 0;
                const dAmt = appt.discountAmount ?? 0;
                pricingLines.push(`Discount: ${dName} (${dPct}% off): -$${dAmt.toFixed(2)}`);
              }
              if (appt.giftApplied) {
                const giftAmt = appt.giftUsedAmount ?? svcPrice;
                pricingLines.push(`Gift Card: -$${giftAmt.toFixed(2)}`);
              }
              pricingLines.push(`Total Charged: $${(appt.totalPrice ?? svcPrice).toFixed(2)}`);
              enrichedNotes = (enrichedNotes ? enrichedNotes + "\n" : "") + "--- Pricing ---\n" + pricingLines.join("\n");
            } else if (appt.totalPrice != null && appt.totalPrice !== svcPrice) {
              enrichedNotes = (enrichedNotes ? enrichedNotes + "\n" : "") + `--- Pricing ---\nService: ${svc?.name ?? "Service"} \u2014 $${svcPrice.toFixed(2)}\nTotal Charged: $${appt.totalPrice.toFixed(2)}`;
            }
            await createApptMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: appt.id,
              serviceLocalId: appt.serviceId,
              clientLocalId: appt.clientId,
              date: appt.date,
              time: appt.time,
              duration: appt.duration,
              status: appt.status,
              notes: enrichedNotes || undefined,
              totalPrice: appt.totalPrice,
              extraItems: appt.extraItems,
              discountPercent: appt.discountPercent,
              discountAmount: appt.discountAmount,
              discountName: appt.discountName,
              giftApplied: appt.giftApplied,
              giftUsedAmount: appt.giftUsedAmount,
              staffId: appt.staffId,
              locationId: appt.locationId,
              clientAddress: appt.clientAddress,
            });
            break;
          }
          case "UPDATE_APPOINTMENT": {
            const appt = action.payload as Appointment;
            await updateApptMut.mutateAsync({
              localId: appt.id,
              businessOwnerId: ownerId,
              status: appt.status,
              date: appt.date,
              time: appt.time,
              duration: appt.duration,
              notes: appt.notes || undefined,
              totalPrice: appt.totalPrice,
              extraItems: appt.extraItems,
              discountPercent: appt.discountPercent,
              discountAmount: appt.discountAmount,
              discountName: appt.discountName,
              giftApplied: appt.giftApplied,
              giftUsedAmount: appt.giftUsedAmount,
              staffId: appt.staffId,
              locationId: appt.locationId,
              clientAddress: appt.clientAddress,
              paymentStatus: appt.paymentStatus,
              paymentMethod: appt.paymentMethod || undefined,
              paymentConfirmationNumber: appt.paymentConfirmationNumber || undefined,
            });
            break;
          }
          case "UPDATE_APPOINTMENT_STATUS": {
            const { id, status, cancellationReason } = action.payload as { id: string; status: AppointmentStatus; cancellationReason?: string };
            await updateApptMut.mutateAsync({
              localId: id,
              businessOwnerId: ownerId,
              status,
              ...(cancellationReason != null ? { cancellationReason } : {}),
            });
            break;
          }
          case "DELETE_APPOINTMENT": {
            await deleteApptMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_REVIEW": {
            const rev = action.payload as Review;
            await createReviewMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: rev.id,
              clientLocalId: rev.clientId,
              appointmentLocalId: rev.appointmentId || undefined,
              rating: rev.rating,
              comment: rev.comment || undefined,
            });
            break;
          }
          case "DELETE_REVIEW": {
            await deleteReviewMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "UPDATE_SETTINGS": {
            const settings = action.payload as Partial<BusinessSettings>;
            const updateData: any = { id: ownerId };
            if (settings.businessName !== undefined) updateData.businessName = settings.businessName;
            if (settings.profile) {
              if (settings.profile.ownerName !== undefined) updateData.ownerName = settings.profile.ownerName;
              if (settings.profile.phone !== undefined) updateData.phone = settings.profile.phone;
              if (settings.profile.email !== undefined) updateData.email = settings.profile.email;
              if (settings.profile.address !== undefined) updateData.address = settings.profile.address;
              if (settings.profile.description !== undefined) updateData.description = settings.profile.description;
              if (settings.profile.website !== undefined) updateData.website = settings.profile.website;
            }
            if (settings.businessLogoUri !== undefined) updateData.businessLogoUri = settings.businessLogoUri;
            if (settings.defaultDuration !== undefined) updateData.defaultDuration = settings.defaultDuration;
            if (settings.notificationsEnabled !== undefined) updateData.notificationsEnabled = settings.notificationsEnabled;
            if (settings.themeMode !== undefined) updateData.themeMode = settings.themeMode;
            if (settings.temporaryClosed !== undefined) updateData.temporaryClosed = settings.temporaryClosed;
            if (settings.scheduleMode !== undefined) updateData.scheduleMode = settings.scheduleMode;
            if (settings.workingHours !== undefined) updateData.workingHours = settings.workingHours;
            if (settings.cancellationPolicy !== undefined) updateData.cancellationPolicy = settings.cancellationPolicy;
            if ((settings as any).bufferTime !== undefined) updateData.bufferTime = (settings as any).bufferTime;
            if ((settings as any).slotInterval !== undefined) updateData.slotInterval = (settings as any).slotInterval;
            if ((settings as any).customSlug !== undefined) updateData.customSlug = (settings as any).customSlug;
            if ((settings as any).businessHoursEndDate !== undefined) updateData.businessHoursEndDate = (settings as any).businessHoursEndDate;
            if ((settings as any).autoCompleteEnabled !== undefined) updateData.autoCompleteEnabled = (settings as any).autoCompleteEnabled;
            if ((settings as any).autoCompleteDelayMinutes !== undefined) updateData.autoCompleteDelayMinutes = (settings as any).autoCompleteDelayMinutes;
            if ((settings as any).requestResponseWindowHours !== undefined) updateData.requestResponseWindowHours = (settings as any).requestResponseWindowHours;
            if ((settings as any).giftValidDays !== undefined) updateData.giftValidDays = (settings as any).giftValidDays;
            if ((settings as any).notificationPreferences !== undefined) updateData.notificationPreferences = (settings as any).notificationPreferences;
            if ((settings as any).smsTemplates !== undefined) updateData.smsTemplates = (settings as any).smsTemplates;
            // Payment methods
            if (settings.zelleHandle !== undefined) updateData.zelleHandle = settings.zelleHandle;
            if (settings.cashAppHandle !== undefined) updateData.cashAppHandle = settings.cashAppHandle;
            if (settings.venmoHandle !== undefined) updateData.venmoHandle = settings.venmoHandle;
            if (settings.paymentNotes !== undefined) updateData.paymentNotes = settings.paymentNotes;
            if (settings.instagramHandle !== undefined) updateData.instagramHandle = settings.instagramHandle;
            if (settings.facebookHandle !== undefined) updateData.facebookHandle = settings.facebookHandle;
            if (settings.tiktokHandle !== undefined) updateData.tiktokHandle = settings.tiktokHandle;
            // Client portal
            if (settings.clientPortalVisible !== undefined) (updateData as any).clientPortalVisible = settings.clientPortalVisible;
            if (settings.businessCategory !== undefined) (updateData as any).businessCategory = settings.businessCategory;
            // Only update if there's something besides id
            if (Object.keys(updateData).length > 1) {
              await updateBusinessMut.mutateAsync(updateData);
            }
            break;
          }
          case "ADD_DISCOUNT": {
            const disc = action.payload as Discount;
            await createDiscountMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: disc.id,
              name: disc.name,
              percentage: disc.percentage,
              startTime: disc.startTime,
              endTime: disc.endTime,
              daysOfWeek: disc.daysOfWeek,
              dates: disc.dates ?? [],
              serviceIds: disc.serviceIds,
              maxUses: disc.maxUses ?? null,
              active: disc.active,
            });
            break;
          }
          case "UPDATE_DISCOUNT": {
            const disc = action.payload as Discount;
            await updateDiscountMut.mutateAsync({
              localId: disc.id,
              businessOwnerId: ownerId,
              name: disc.name,
              percentage: disc.percentage,
              startTime: disc.startTime,
              endTime: disc.endTime,
              daysOfWeek: disc.daysOfWeek,
              dates: disc.dates ?? [],
              serviceIds: disc.serviceIds,
              maxUses: disc.maxUses ?? null,
              active: disc.active,
            });
            break;
          }
          case "DELETE_DISCOUNT": {
            await deleteDiscountMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_GIFT_CARD": {
            const gc = action.payload as GiftCard;
            // Encode extended data (serviceIds, productIds, balance, bannerImageUri) in message field
            const giftDataBlock = `\n---GIFT_DATA---\n${JSON.stringify({
              serviceIds: gc.serviceIds,
              productIds: gc.productIds,
              originalValue: gc.originalValue,
              remainingBalance: gc.remainingBalance,
              ...(gc.bannerImageUri ? { bannerImageUri: gc.bannerImageUri } : {}),
            })}`;
            const msgWithData = (gc.message || "") + giftDataBlock;
            await createGiftCardMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: gc.id,
              code: gc.code,
              serviceLocalId: gc.serviceLocalId,
              recipientName: gc.recipientName || undefined,
              recipientPhone: gc.recipientPhone || undefined,
              message: msgWithData,
              expiresAt: gc.expiresAt || undefined,
            });
            break;
          }
          case "UPDATE_GIFT_CARD": {
            const gc = action.payload as GiftCard;
            // Re-encode extended data in message field for balance updates
            const updGiftDataBlock = `\n---GIFT_DATA---\n${JSON.stringify({
              serviceIds: gc.serviceIds,
              productIds: gc.productIds,
              originalValue: gc.originalValue,
              remainingBalance: gc.remainingBalance,
              ...(gc.bannerImageUri ? { bannerImageUri: gc.bannerImageUri } : {}),
            })}`;
            const updMsgWithData = (gc.message || "") + updGiftDataBlock;
            await updateGiftCardMut.mutateAsync({
              localId: gc.id,
              businessOwnerId: ownerId,
              redeemed: gc.redeemed,
              redeemedAt: gc.redeemedAt,
              message: updMsgWithData,
            });
            break;
          }
          case "DELETE_GIFT_CARD": {
            await deleteGiftCardMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "SET_CUSTOM_SCHEDULE": {
            const cs = action.payload as CustomScheduleDay;
            await upsertScheduleMut.mutateAsync({
              businessOwnerId: ownerId,
              date: cs.date,
              isOpen: cs.isOpen,
              startTime: cs.startTime,
              endTime: cs.endTime,
              locationId: cs.locationId ?? undefined,
            });
            break;
          }
          case "DELETE_CUSTOM_SCHEDULE": {
            await deleteScheduleMut.mutateAsync({
              businessOwnerId: ownerId,
              date: action.payload as string,
            });
            break;
          }
          case "SET_LOCATION_CUSTOM_SCHEDULE": {
            const { locationId, day } = action.payload as { locationId: string; day: CustomScheduleDay };
            await upsertScheduleMut.mutateAsync({
              businessOwnerId: ownerId,
              date: day.date,
              isOpen: day.isOpen,
              startTime: day.startTime,
              endTime: day.endTime,
              locationId,
            });
            break;
          }
          case "DELETE_LOCATION_CUSTOM_SCHEDULE": {
            const { locationId, date } = action.payload as { locationId: string; date: string };
            await deleteScheduleMut.mutateAsync({
              businessOwnerId: ownerId,
              date,
              locationId,
            });
            break;
          }
          case "ADD_PRODUCT": {
            const prod = action.payload as Product;
            await createProductMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: prod.id,
              name: prod.name,
              price: String(prod.price),
              description: prod.description || undefined,
              brand: prod.brand || undefined,
              available: prod.available,
            });
            break;
          }
          case "UPDATE_PRODUCT": {
            const prod = action.payload as Product;
            await updateProductMut.mutateAsync({
              localId: prod.id,
              businessOwnerId: ownerId,
              name: prod.name,
              price: String(prod.price),
              description: prod.description || undefined,
              brand: prod.brand || undefined,
              available: prod.available,
            });
            break;
          }
          case "DELETE_PRODUCT": {
            await deleteProductMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_STAFF": {
            const staff = action.payload as StaffMember;
            await createStaffMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: staff.id,
              name: staff.name,
              phone: staff.phone || undefined,
              email: staff.email || undefined,
              role: staff.role || undefined,
              color: staff.color || undefined,
              serviceIds: staff.serviceIds,
              locationIds: staff.locationIds,
              workingHours: staff.workingHours,
              active: staff.active,
              photoUri: staff.photoUri ?? undefined,
              commissionRate: staff.commissionRate ?? undefined,
            });
            break;
          }
          case "UPDATE_STAFF": {
            const staff = action.payload as StaffMember;
            await updateStaffMut.mutateAsync({
              localId: staff.id,
              businessOwnerId: ownerId,
              name: staff.name,
              phone: staff.phone || undefined,
              email: staff.email || undefined,
              role: staff.role || undefined,
              color: staff.color || undefined,
              serviceIds: staff.serviceIds,
              locationIds: staff.locationIds,
              workingHours: staff.workingHours,
              active: staff.active,
              photoUri: staff.photoUri ?? undefined,
              commissionRate: staff.commissionRate ?? undefined,
            });
            break;
          }
          case "DELETE_STAFF": {
            await deleteStaffMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_LOCATION": {
            const loc = action.payload as Location;
            await createLocationMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: loc.id,
              name: loc.name,
              address: loc.address || undefined,
              city: loc.city || undefined,
              state: loc.state || undefined,
              zipCode: loc.zipCode || undefined,
              phone: loc.phone || undefined,
              email: loc.email || undefined,
              isDefault: loc.isDefault,
              active: loc.active,
              workingHours: loc.workingHours,
            });
            break;
          }
          case "UPDATE_LOCATION": {
            const loc = action.payload as Location;
            // Check if location exists in DB first (upsert pattern)
            const existingLocs = await trpcUtils.locations.list.fetch({ businessOwnerId: ownerId });
            const existsInDb = existingLocs.some((l: any) => l.localId === loc.id);
            if (existsInDb) {
              await updateLocationMut.mutateAsync({
                localId: loc.id,
                businessOwnerId: ownerId,
                name: loc.name,
                address: loc.address || undefined,
                city: loc.city || undefined,
                state: loc.state || undefined,
                zipCode: loc.zipCode || undefined,
                phone: loc.phone || undefined,
                email: loc.email || undefined,
                isDefault: loc.isDefault,
                active: loc.active,
                temporarilyClosed: loc.temporarilyClosed,
                reopenOn: loc.reopenOn,
                workingHours: loc.workingHours,
              });
            } else {
              // Location not in DB yet — create it (handles cases where ADD_LOCATION sync failed)
              await createLocationMut.mutateAsync({
                businessOwnerId: ownerId,
                localId: loc.id,
                name: loc.name,
                address: loc.address || undefined,
                city: loc.city || undefined,
                state: loc.state || undefined,
                zipCode: loc.zipCode || undefined,
                phone: loc.phone || undefined,
                email: loc.email || undefined,
                isDefault: loc.isDefault,
                active: loc.active,
                temporarilyClosed: loc.temporarilyClosed,
                reopenOn: loc.reopenOn,
                workingHours: loc.workingHours,
              });
            }
            break;
          }
          case "DELETE_LOCATION": {
            await deleteLocationMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_PROMO_CODE": {
            const pc = action.payload as import("./types").PromoCode;
            await createPromoCodeMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: pc.id,
              code: pc.code.toUpperCase(),
              label: pc.label,
              percentage: pc.percentage,
              flatAmount: pc.flatAmount != null ? String(pc.flatAmount) : null,
              maxUses: pc.maxUses ?? null,
              expiresAt: pc.expiresAt ?? null,
              active: pc.active,
            });
            break;
          }
          case "UPDATE_PROMO_CODE": {
            const pc = action.payload as import("./types").PromoCode;
            await updatePromoCodeMut.mutateAsync({
              localId: pc.id,
              businessOwnerId: ownerId,
              code: pc.code.toUpperCase(),
              label: pc.label,
              percentage: pc.percentage,
              flatAmount: pc.flatAmount != null ? String(pc.flatAmount) : null,
              maxUses: pc.maxUses ?? null,
              expiresAt: pc.expiresAt ?? null,
              active: pc.active,
              usedCount: pc.usedCount,
            });
            break;
          }
          case "DELETE_PROMO_CODE": {
            await deletePromoCodeMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          case "ADD_PACKAGE": {
            const pkg = action.payload as import("./types").ServicePackage;
            await createPackageMut.mutateAsync({
              businessOwnerId: ownerId,
              localId: pkg.id,
              name: pkg.name,
              description: pkg.description || null,
              serviceIds: pkg.serviceIds,
              price: pkg.price,
              sessions: pkg.sessions ?? null,
              expiryDays: pkg.expiryDays ?? null,
              bufferDays: pkg.bufferDays ?? null,
              bufferMinutes: pkg.bufferMinutes ?? null,
              active: pkg.active,
              photoUri: pkg.photoUri ?? null,
            });
            break;
          }
          case "UPDATE_PACKAGE": {
            const pkg = action.payload as import("./types").ServicePackage;
            await updatePackageMut.mutateAsync({
              localId: pkg.id,
              businessOwnerId: ownerId,
              name: pkg.name,
              description: pkg.description || null,
              serviceIds: pkg.serviceIds,
              price: pkg.price,
              sessions: pkg.sessions ?? null,
              expiryDays: pkg.expiryDays ?? null,
              bufferDays: pkg.bufferDays ?? null,
              bufferMinutes: pkg.bufferMinutes ?? null,
              active: pkg.active,
              photoUri: pkg.photoUri ?? null,
            });
            break;
          }
          case "DELETE_PACKAGE": {
            await deletePackageMut.mutateAsync({
              localId: action.payload as string,
              businessOwnerId: ownerId,
            });
            break;
          }
          default:
            break;
        }
      } catch (err) {
        // Log clearly so it's visible in crash reports / Sentry
        logger.captureError(err, { context: "DB sync", action: action.type });
        // NOTE: Local state is already updated. The AsyncStorage cache will be written by the
        // useEffect watchers. On next app launch, if DB is reachable, the bootstrap will load
        // the correct data from DB. If DB is still unreachable, the cache will be used.
        // Do NOT re-throw — most call sites are fire-and-forget and would get unhandled rejections
      }
    },
     []
  );
  // Wire up the ref so the foreground auto-complete check can call syncToDb
  // Also flush any pending auto-complete actions queued during initial load.
  useEffect(() => {
    syncToDbRef.current = syncToDb;
    // Flush queued initial-load auto-complete actions
    const pending = pendingAutoCompleteRef.current;
    if (pending.length > 0) {
      pendingAutoCompleteRef.current = [];
      pending.forEach(({ id }) => {
        syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id, status: "completed" as AppointmentStatus } });
      });
    }
  }, [syncToDb]);
  // --- Selectors ---
  const getServiceById = useCallback(
    (id: string) => state.services.find((s) => s.id === id),
    [state.services]
  );

  const getClientById = useCallback(
    (id: string) => state.clients.find((c) => c.id === id),
    [state.clients]
  );

  const getStaffById = useCallback(
    (id: string) => state.staff.find((s) => s.id === id),
    [state.staff]
  );

  const getLocationById = useCallback(
    (id: string) => state.locations.find((l) => l.id === id),
    [state.locations]
  );

  const getAppointmentsForDate = useCallback(
    (date: string) =>
      state.appointments
        .filter((a) => a.date === date && a.status !== "cancelled")
        .sort((a, b) => a.time.localeCompare(b.time)),
    [state.appointments]
  );

  const getAppointmentsForClient = useCallback(
    (clientId: string) =>
      state.appointments
        .filter((a) => a.clientId === clientId)
        .sort((a, b) => {
          const dateComp = b.date.localeCompare(a.date);
          return dateComp !== 0 ? dateComp : b.time.localeCompare(a.time);
        }),
    [state.appointments]
  );

  const getReviewsForClient = useCallback(
    (clientId: string) =>
      state.reviews.filter((r) => r.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.reviews]
  );

  const getPhotosForClient = useCallback(
    (clientId: string) =>
      state.clientPhotos.filter((p) => p.clientId === clientId).sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [state.clientPhotos]
  );

  const getTodayStats = useCallback(() => {
    const now = new Date();
    const todayStr = formatDateStr(now);
    const todayCount = state.appointments.filter(
      (a) => a.date === todayStr && a.status !== "cancelled"
    ).length;

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const weekAppts = state.appointments.filter((a) => {
      if (a.status === "cancelled") return false;
      return a.date >= formatDateStr(startOfWeek) && a.date <= formatDateStr(endOfWeek);
    });

    const weekCount = weekAppts.length;
    const weekRevenue = weekAppts.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);

     return { todayCount, weekCount, weekRevenue };
  }, [state.appointments, state.services]);
  const bulkMarkPaid = useCallback(
    async (localIds: string[], paymentMethod: string) => {
      if (!state.businessOwnerId || localIds.length === 0) return;
      // Optimistically update local state for all appointments
      localIds.forEach((id) => {
        const appt = state.appointments.find((a) => a.id === id);
        if (appt) {
          dispatch({
            type: "UPDATE_APPOINTMENT",
            payload: { ...appt, paymentStatus: "paid", paymentMethod: paymentMethod as Appointment["paymentMethod"] },
          });
        }
      });
      // Single bulk DB call
      await bulkMarkPaidMut.mutateAsync({
        localIds,
        businessOwnerId: state.businessOwnerId,
        paymentMethod,
      });
    },
    [state.businessOwnerId, state.appointments, dispatch, bulkMarkPaidMut]
  );

  const bulkMarkUnpaid = useCallback(
    async (localIds: string[]) => {
      if (!state.businessOwnerId || localIds.length === 0) return;
      // Optimistically revert local state for all appointments
      localIds.forEach((id) => {
        const appt = state.appointments.find((a) => a.id === id);
        if (appt) {
          dispatch({
            type: "UPDATE_APPOINTMENT",
            payload: { ...appt, paymentStatus: "unpaid" as const, paymentMethod: "unpaid" as Appointment["paymentMethod"] },
          });
        }
      });
      // Single bulk DB call
      await bulkMarkUnpaidMut.mutateAsync({
        localIds,
        businessOwnerId: state.businessOwnerId,
      });
    },
    [state.businessOwnerId, state.appointments, dispatch, bulkMarkUnpaidMut]
  );

  const setActiveLocation = useCallback(
    (locationId: string | null) => {
      dispatch({ type: "SET_ACTIVE_LOCATION", payload: locationId });
      if (locationId) {
        AsyncStorage.setItem(STORAGE_KEYS.activeLocationId, locationId).catch(() => {});
      } else {
        AsyncStorage.removeItem(STORAGE_KEYS.activeLocationId).catch(() => {});
      }
    },
    [dispatch]
  );

  /**
   * Returns only appointments belonging to the active location.
   * When no location is active (null), returns all appointments unchanged.
   */
  const filterAppointmentsByLocation = useCallback(
    (appointments: Appointment[]) => {
      if (!state.activeLocationId) return appointments;
      return appointments.filter((a) => a.locationId === state.activeLocationId);
    },
    [state.activeLocationId]
  );

  /**
   * Returns the custom schedule overrides for the active location.
   * Falls back to the global customSchedule when no location is active.
   */
  const getActiveCustomSchedule = useCallback((): CustomScheduleDay[] => {
    if (!state.activeLocationId) return state.customSchedule;
    // Merge global (no locationId) entries with location-specific ones.
    // Location-specific entries take precedence for the same date.
    const locEntries = state.locationCustomSchedule[state.activeLocationId] ?? [];
    const locDates = new Set(locEntries.map((cs) => cs.date));
    const globalFallback = state.customSchedule.filter((cs) => !locDates.has(cs.date));
    return [...locEntries, ...globalFallback];
  }, [state.activeLocationId, state.locationCustomSchedule, state.customSchedule]);

  /**
   * Clients who have at least one appointment at the active location.
   * When no active location is set (single-location businesses), returns all clients.
   */
  const clientsForActiveLocation = useMemo(() => {
    if (!state.activeLocationId) return state.clients;
    // Build a Set of clientIds who have an appointment at the active location
    const clientIdsAtLocation = new Set(
      state.appointments
        .filter((a) => a.locationId === state.activeLocationId)
        .map((a) => a.clientId)
    );
    // If no appointments yet at this location, still show all clients so the list isn't empty on first use
    if (clientIdsAtLocation.size === 0) return state.clients;
    return state.clients.filter((c) => clientIdsAtLocation.has(c.id));
  }, [state.clients, state.appointments, state.activeLocationId]);
  return (
    <StoreContext.Provider
      value={{
        state,
        dispatch,
        getServiceById,
        getClientById,
        getStaffById,
        getLocationById,
        getAppointmentsForDate,
        getAppointmentsForClient,
        getReviewsForClient,
        getPhotosForClient,
        getTodayStats,
        filterAppointmentsByLocation,
        clientsForActiveLocation,
        getActiveCustomSchedule,
        syncToDb,
        setActiveLocation,
        refreshFromDb,
        bulkMarkPaid,
        bulkMarkUnpaid,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// --- Helpers ---
async function persistToAsyncStorage(
  services: Service[],
  clients: Client[],
  appointments: Appointment[],
  reviews: Review[],
  settings: BusinessSettings,
  discounts?: Discount[],
  giftCards?: GiftCard[],
  customSchedule?: CustomScheduleDay[],
  products?: Product[],
  staff?: StaffMember[],
  locations?: Location[],
  locationCustomSchedule?: Record<string, CustomScheduleDay[]>
) {
  try {
    const ops = [
      AsyncStorage.setItem(STORAGE_KEYS.services, JSON.stringify(services)),
      AsyncStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(clients)),
      AsyncStorage.setItem(STORAGE_KEYS.appointments, JSON.stringify(appointments)),
      AsyncStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(reviews)),
      AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings)),
    ];
    if (discounts) ops.push(AsyncStorage.setItem(STORAGE_KEYS.discounts, JSON.stringify(discounts)));
    if (giftCards) ops.push(AsyncStorage.setItem(STORAGE_KEYS.giftCards, JSON.stringify(giftCards)));
    if (customSchedule) ops.push(AsyncStorage.setItem(STORAGE_KEYS.customSchedule, JSON.stringify(customSchedule)));
    if (products) ops.push(AsyncStorage.setItem(STORAGE_KEYS.products, JSON.stringify(products)));
    if (staff) ops.push(AsyncStorage.setItem(STORAGE_KEYS.staff, JSON.stringify(staff)));
    if (locations) ops.push(AsyncStorage.setItem(STORAGE_KEYS.locations, JSON.stringify(locations)));
    if (locationCustomSchedule) ops.push(AsyncStorage.setItem(STORAGE_KEYS.locationCustomSchedule, JSON.stringify(locationCustomSchedule)));
    await Promise.all(ops);
  } catch (err) {
    logger.warn("[Store] Failed to persist to AsyncStorage:", err);
  }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
