import { logger } from "@/lib/logger";
import { useEffect, useCallback, useRef } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useStore } from "@/lib/store";
import { trpc } from "@/lib/trpc";

// Configure foreground notification display
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Notification data payload types for deep navigation.
 * Each notification carries a `type` and relevant IDs so tapping
 * navigates to the correct screen.
 */
export type NotificationData = {
  /** Type of notification for routing */
  type:
    | "appointment_reminder"
    | "appointment_request"
    | "appointment_cancelled"
    | "appointment_rescheduled"
    | "appointment_completed"
    | "payment_received"
    | "stripe_payout"
    | "subscription_renewal"
    | "waitlist"
    | "client_message"
    | "business_message"
    | "general";
  /** Appointment ID to navigate to */
  appointmentId?: string;
  /** Calendar tab filter to open */
  filter?: "requests" | "cancelled" | "upcoming" | "completed";
  /** URL to navigate to (Expo Router path) */
  url?: string;
  /** Client account ID for client portal message deep-links */
  clientAccountId?: number;
  /** Client name for display in the message thread */
  clientName?: string;
  /** Business owner ID for business message deep-links */
  businessOwnerId?: number;
};

/**
 * Register for Expo push notifications and return the Expo push token.
 * Returns null if not on a physical device or permissions denied.
 */
async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  // Must be a physical device — simulators don't support push
  if (!Device.isDevice) {
    logger.log("[Notifications] Push notifications require a physical device");
    return null;
  }

  // Register interactive notification category for appointment requests (Accept / Decline)
  // Category identifier must NOT contain `:` or `-` (Expo limitation)
  await Notifications.setNotificationCategoryAsync("apptrequest", [
    {
      identifier: "accept",
      buttonTitle: "✅ Accept",
      options: { opensAppToForeground: false, isDestructive: false, isAuthenticationRequired: false },
    },
    {
      identifier: "decline",
      buttonTitle: "❌ Decline",
      options: { opensAppToForeground: false, isDestructive: true, isAuthenticationRequired: false },
    },
  ]);

  // Set up Android notification channels
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("appointments", {
      name: "Appointment Notifications",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#4a8c3f",
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync("completions", {
      name: "Appointment Completions",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 100, 100, 100],
      lightColor: "#22C55E",
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    logger.log("[Notifications] Push notification permission denied");
    return null;
  }

  // Get the Expo push token
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      logger.warn("[Notifications] No EAS project ID found in app config");
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    logger.log("[Notifications] Expo push token:", tokenData.data);
    return tokenData.data;
  } catch (err) {
    logger.warn("[Notifications] Failed to get Expo push token:", err);
    return null;
  }
}

/** Format a time string "HH:MM" to "h:MM AM/PM" */
function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Format a date string "YYYY-MM-DD" to "Mon, Apr 14, 2026" */
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Compute appointment end time string "HH:MM" from start time + duration */
function computeEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const totalMins = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

/**
 * Hook to manage push notification registration, local appointment reminders,
 * auto-complete scheduling, and notification tap deep-link navigation.
 */
export function useNotifications() {
  const { state, dispatch, syncToDb, refreshFromDb } = useStore();
  const router = useRouter();
  const scheduledRef = useRef<Set<string>>(new Set());
  const listenerSetupRef = useRef(false);
  const tokenRegisteredRef = useRef(false);
  const prevOwnerIdRef = useRef<number | null>(null);
  const initialNotifHandledRef = useRef(false);
  // Keep a ref to appointments so the listener can access latest without re-registering
  const appointmentsRef = useRef(state.appointments);
  useEffect(() => { appointmentsRef.current = state.appointments; }, [state.appointments]);

  // Keep refs to services and clients for building clean notification body text
  const servicesRef = useRef(state.services);
  useEffect(() => { servicesRef.current = state.services; }, [state.services]);
  const clientsRef = useRef(state.clients);
  useEffect(() => { clientsRef.current = state.clients; }, [state.clients]);

  // Get business name for notification titles
  const businessName = state.settings.businessName || "Your Business";
  const autoCompleteEnabled = state.settings.autoCompleteEnabled ?? false;
  const autoCompleteDelayMinutes = state.settings.autoCompleteDelayMinutes ?? 5;

  // ── App icon badge count ─────────────────────────────────────────────────
  // Badge = pending booking requests + unread inbox notifications, capped at 99.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const pendingCount = state.appointments.filter((a) => a.status === "pending").length;
    const unreadCount = (state.inboxNotifications ?? []).filter((n) => !n.read).length;
    const total = Math.min(pendingCount + unreadCount, 99);
    Notifications.setBadgeCountAsync(total).catch(() => {});
  }, [state.appointments, state.inboxNotifications]);

  // tRPC mutation to save push token to server
  const updateBusiness = trpc.business.update.useMutation();

  /**
   * Navigate based on notification data payload.
   * Routes to the correct screen depending on notification type.
   */
  const handleNotificationNavigation = useCallback(
    (data: NotificationData | Record<string, unknown>) => {
      if (!data) return;

      const notifType = data.type as string;
      const appointmentId = data.appointmentId as string | undefined;
      const filter = data.filter as string | undefined;
      const clientAccountId = data.clientAccountId as number | undefined;

      switch (notifType) {
        // ── Actionable: go directly to the appointment so owner can accept/decline ──
        case "appointment_request":
        case "appointment_rescheduled":
          if (appointmentId) {
            // Deep-link straight to the detail screen — all accept/cancel actions are there
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else {
            // Fallback: open the Requests tab if no ID is available
            router.push({ pathname: "/(tabs)/bookings", params: { filter: "requests" } });
          }
          break;

        // ── Payment received: go to appointment detail to confirm payment ──────────
        case "payment_received":
          if (appointmentId) {
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else {
            router.push({ pathname: "/(tabs)/bookings", params: { filter: "upcoming" } });
          }
          break;

        // ── Cancel/Reschedule request from client: go to appointment to approve/decline ──
        case "cancel_request":
        case "reschedule_request":
          if (appointmentId) {
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else {
            router.push({ pathname: "/(tabs)/bookings", params: { filter: "upcoming" } });
          }
          break;

        // ── Cancellation: open cancelled tab (no appointment to act on) ───────────
        case "appointment_cancelled":
          if (appointmentId) {
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else {
            router.push({ pathname: "/(tabs)/bookings", params: { filter: "cancelled" } });
          }
          break;

        // ── Completed: view the completed appointment record ──────────────────────
        case "appointment_completed":
          if (appointmentId) {
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else {
            router.push({ pathname: "/(tabs)/bookings", params: { filter: "completed" } });
          }
          break;

        // ── Waitlist: no appointment yet — open Requests tab to schedule ──────────
        case "waitlist":
          router.push({ pathname: "/(tabs)/bookings", params: { filter: "requests" } });
          break;

        // ── Reminder: go directly to the appointment ──────────────────────────────
        case "appointment_reminder":
          if (appointmentId) {
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else {
            router.push({ pathname: "/(tabs)/bookings", params: { filter: "upcoming" } });
          }
          break;

        // ── Stripe / subscription / general ──────────────────────────────────────
        case "stripe_payout":
          router.push({ pathname: "/(tabs)/settings", params: { tab: "account" } });
          break;

        case "subscription_renewal":
          router.push({ pathname: "/subscription" });
          break;

        // ── Client message: business owner receives a message from a client ──────────────────
        case "client_message":
          if (clientAccountId) {
            // Navigate to the staff-side message thread with this client
            router.push({
              pathname: "/client-message-thread-business" as any,
              params: { clientAccountId: String(clientAccountId), clientName: (data.clientName as string | undefined) ?? "Client" },
            });
          } else {
            // Fallback: open the Clients tab on the Messages sub-tab
            router.push({ pathname: "/(tabs)/clients", params: { tab: "messages" } } as any);
          }
          break;

        default:
          if (appointmentId) {
            router.push({ pathname: "/appointment-detail", params: { id: appointmentId, from: "notification" } });
          } else if (filter) {
            router.push({ pathname: "/(tabs)/bookings", params: { filter } });
          } else if (data.url && typeof data.url === "string") {
            router.push(data.url as any);
          } else {
            // Fallback: open the calendar home
            router.push({ pathname: "/(tabs)/bookings" });
          }
          break;
      }
    },
    [router]
  );

  // Reset tokenRegisteredRef when the logged-in business owner changes so the
  // new account always registers its own push token (fixes cross-account contamination).
  useEffect(() => {
    if (state.businessOwnerId !== null && state.businessOwnerId !== prevOwnerIdRef.current) {
      // If there was a previous owner, clear their push token on the server so they
      // stop receiving notifications on this device after logout.
      if (prevOwnerIdRef.current !== null) {
        updateBusiness.mutate(
          { id: prevOwnerIdRef.current, expoPushToken: null },
          {
            onSuccess: () => logger.log("[Notifications] Cleared push token for previous owner", prevOwnerIdRef.current),
            onError: (err) => logger.warn("[Notifications] Failed to clear previous owner push token:", err),
          }
        );
      }
      tokenRegisteredRef.current = false;
      prevOwnerIdRef.current = state.businessOwnerId;
    } else if (state.businessOwnerId === null) {
      // Logged out — reset so next login re-registers
      tokenRegisteredRef.current = false;
      prevOwnerIdRef.current = null;
    }
  }, [state.businessOwnerId]);

  // Register for push notifications and save token to server.
  // We always register the token regardless of the notificationsEnabled toggle so that
  // the server has a valid token ready. The server-side checks (notificationsEnabled,
  // per-event toggles) gate whether a push is actually sent.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (tokenRegisteredRef.current) return;
    if (!state.businessOwnerId) return;
    if (!state.loaded) return; // Wait until store is fully loaded before registering

    tokenRegisteredRef.current = true;

    registerForPushNotificationsAsync().then((token) => {
      if (token && state.businessOwnerId) {
        updateBusiness.mutate(
          { id: state.businessOwnerId, expoPushToken: token },
          {
            onSuccess: () => logger.log("[Notifications] Push token saved to server"),
            onError: (err) => logger.warn("[Notifications] Failed to save push token:", err),
          }
        );
      }
    });
  }, [state.businessOwnerId, state.loaded]);

  // Set up notification response listener for tap handling (once)
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (listenerSetupRef.current) return;
    listenerSetupRef.current = true;

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotificationData;
      const actionId = response.actionIdentifier;

      // ── Inline action: Accept appointment ─────────────────────────────────────
      if (actionId === "accept" && data?.appointmentId) {
        const apptId = data.appointmentId;
        const appt = appointmentsRef.current.find((a) => a.id === apptId);
        if (appt && appt.status === "pending") {
          const updateAction = {
            type: "UPDATE_APPOINTMENT_STATUS" as const,
            payload: { id: apptId, status: "confirmed" as const },
          };
          dispatch(updateAction);
          syncToDb(updateAction);
          logger.log("[Notifications] Accepted appointment from banner:", apptId);
        }
        return; // Don't navigate — action was handled silently
      }

      // ── Inline action: Decline appointment ──────────────────────────────────
      if (actionId === "decline" && data?.appointmentId) {
        const apptId = data.appointmentId;
        const appt = appointmentsRef.current.find((a) => a.id === apptId);
        if (appt && (appt.status === "pending" || appt.status === "confirmed")) {
          const updateAction = {
            type: "UPDATE_APPOINTMENT_STATUS" as const,
            payload: { id: apptId, status: "cancelled" as const },
          };
          dispatch(updateAction);
          syncToDb(updateAction);
          logger.log("[Notifications] Declined appointment from banner:", apptId);
        }
        return; // Don't navigate — action was handled silently
      }

      // ── Default: tap on notification body → navigate ──────────────────────────
      if (data) {
        // For payment_received taps: immediately update local state to 'paid'
        if (data.type === 'payment_received' && data.appointmentId) {
          const apptId = data.appointmentId;
          const appt = appointmentsRef.current.find((a) => a.id === apptId);
          if (appt && appt.paymentStatus !== 'paid') {
            const updatedAppt = { ...appt, paymentStatus: 'paid' as const, paymentMethod: 'card' as const };
            const updateAction = { type: 'UPDATE_APPOINTMENT' as const, payload: updatedAppt };
            dispatch(updateAction);
            syncToDb(updateAction);
            logger.log('[Notifications] Pre-updated appointment to paid on notification tap:', apptId);
          }
        }
        setTimeout(() => handleNotificationNavigation(data), 300);
      }
    });

    // ── Foreground notification listener: auto-update payment status + add to inbox ────────
    const foregroundSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as NotificationData;
      // Auto-update payment status
      if (data?.type === "payment_received" && data?.appointmentId) {
        const apptId = data.appointmentId;
        const appt = appointmentsRef.current.find((a) => a.id === apptId);
        if (appt && appt.paymentStatus !== "paid") {
          const updatedAppt = { ...appt, paymentStatus: "paid" as const, paymentMethod: "card" as const };
          const updateAction = { type: "UPDATE_APPOINTMENT" as const, payload: updatedAppt };
          dispatch(updateAction);
          syncToDb(updateAction);
          logger.log("[Notifications] Auto-marked appointment as paid from card payment:", apptId);
        }
      }
      // Add to in-app notification inbox for relevant event types
      if (data?.type === "appointment_request") {
        // Haptic pulse: new booking arrival (fire immediately, don't wait for refresh)
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Refresh the store so the new appointment is available, then build the clean body
        const apptId = data.appointmentId;
        const rawBody = notification.request.content.body ?? "";
        // Helper to build clean body from store data
        const buildCleanBody = (apptIdToFind: string | undefined): string => {
          if (!apptIdToFind) return rawBody;
          const appt = appointmentsRef.current.find((a) => a.id === apptIdToFind);
          if (!appt) return rawBody;
          const client = clientsRef.current.find((c) => c.id === appt.clientId);
          const service = servicesRef.current.find((s) => s.id === appt.serviceId);
          const clientName = client?.name ?? "A client";
          const serviceName = service?.name ?? "an appointment";
          return `${clientName} requested ${serviceName} on ${appt.date} at ${appt.time}`;
        };
        // Try immediately (appointment may already be in store if synced)
        const immediateBody = buildCleanBody(apptId);
        if (immediateBody !== rawBody) {
          // Appointment already in store — dispatch clean notification immediately
          dispatch({
            type: "ADD_INBOX_NOTIFICATION",
            payload: {
              id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: "new_booking",
              title: "New Booking Request",
              body: immediateBody,
              appointmentId: apptId,
              timestamp: new Date().toISOString(),
              read: false,
            },
          });
        } else {
          // Appointment not yet in store — refresh from DB then build clean body
          const notifId = `inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          // Add a placeholder immediately so the notification appears right away
          dispatch({
            type: "ADD_INBOX_NOTIFICATION",
            payload: {
              id: notifId,
              type: "new_booking",
              title: "New Booking Request",
              body: rawBody,
              appointmentId: apptId,
              timestamp: new Date().toISOString(),
              read: false,
            },
          });
          // Refresh store and update the notification body with clean format
          refreshFromDb().then(() => {
            const cleanBody = buildCleanBody(apptId);
            if (cleanBody !== rawBody) {
              // Replace the placeholder with the clean version
              dispatch({
                type: "DISMISS_INBOX_NOTIFICATION",
                payload: notifId,
              });
              dispatch({
                type: "ADD_INBOX_NOTIFICATION",
                payload: {
                  id: notifId,
                  type: "new_booking",
                  title: "New Booking Request",
                  body: cleanBody,
                  appointmentId: apptId,
                  timestamp: new Date().toISOString(),
                  read: false,
                },
              });
            }
          }).catch(() => {
            // Refresh failed — keep the placeholder with raw body
          });
        }
      } else if (data?.type === "appointment_cancelled") {
        const content = notification.request.content;
        dispatch({
          type: "ADD_INBOX_NOTIFICATION",
          payload: {
            id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: "cancelled_by_client",
            title: content.title ?? "Appointment Cancelled",
            body: content.body ?? "",
            appointmentId: data.appointmentId,
            timestamp: new Date().toISOString(),
            read: false,
          },
        });
        // Haptic pulse: cancellation alert
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (data?.type === "appointment_rescheduled") {
        const content = notification.request.content;
        dispatch({
          type: "ADD_INBOX_NOTIFICATION",
          payload: {
            id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: "rescheduled_by_client",
            title: content.title ?? "Appointment Rescheduled",
            body: content.body ?? "",
            appointmentId: data.appointmentId,
            timestamp: new Date().toISOString(),
            read: false,
          },
        });
        // Haptic pulse: reschedule alert
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    });

    // Handle cold-start: only run ONCE per app session (not on every re-register)
    if (!initialNotifHandledRef.current) {
      initialNotifHandledRef.current = true;
      const checkInitialNotification = async () => {
        try {
          const lastResponse = await Notifications.getLastNotificationResponseAsync();
          if (lastResponse) {
            const data = lastResponse.notification.request.content.data as NotificationData;
            if (data) {
              if (data.type === 'payment_received' && data.appointmentId) {
                const apptId = data.appointmentId;
                const appt = appointmentsRef.current.find((a) => a.id === apptId);
                if (appt && appt.paymentStatus !== 'paid') {
                  const updatedAppt = { ...appt, paymentStatus: 'paid' as const, paymentMethod: 'card' as const };
                  const updateAction = { type: 'UPDATE_APPOINTMENT' as const, payload: updatedAppt };
                  dispatch(updateAction);
                  syncToDb(updateAction);
                  logger.log('[Notifications] Cold-start: pre-updated appointment to paid:', apptId);
                }
              }
              setTimeout(() => handleNotificationNavigation(data), 1000);
            }
          }
        } catch (err) {
          logger.warn("[Notifications] Failed to get last notification response:", err);
        }
      };
      checkInitialNotification();
    }

    return () => {
      responseSubscription.remove();
      foregroundSubscription.remove();
      listenerSetupRef.current = false;
    };
  // Remove state.appointments from deps — use appointmentsRef instead to prevent re-registering
  // the listener (and re-firing checkInitialNotification) on every appointment change
  }, [handleNotificationNavigation, dispatch, syncToDb]);

  // Schedule local reminders and auto-complete notifications for upcoming appointments
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!state.settings.notificationsEnabled) return;

    // Individual push toggle for appointment reminders
    const pushRemindersEnabled = state.settings.notificationPreferences?.pushOnNewBooking !== false;
    // We treat the 1h/30min reminders as always-on when master is on, but only for confirmed appts
    // (pending appts don't get reminders since they haven't been accepted yet)

    const now = new Date();

    const upcomingAppts = state.appointments.filter((a) => {
      if (a.status !== "confirmed") return false; // Only confirmed appointments get reminders
      const [h, m] = a.time.split(":").map(Number);
      // Use local date parsing to avoid timezone offset bugs
      const [yr, mo, dy] = a.date.split("-").map(Number);
      const apptDate = new Date(yr, mo - 1, dy, h, m, 0, 0);
      // Only schedule for appointments in the future (within 7 days)
      const diffMs = apptDate.getTime() - now.getTime();
      return diffMs > 0 && diffMs < 7 * 24 * 60 * 60 * 1000;
    });

    // Cancel notifications for appointments that are no longer confirmed/upcoming
    // (cancelled, deleted, or rescheduled appointments should not fire reminders)
    const cancelStaleReminders = async () => {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        const validIds = new Set(upcomingAppts.map((a) => a.id));
        for (const n of scheduled) {
          const id = n.identifier;
          // Match reminder-1h-{id}, reminder-30m-{id}, autocomplete-{id}-*, autocomplete-action-{id}
          const match = id.match(/^(?:reminder-1h|reminder-30m|autocomplete(?:-action)?)-([^-]+)/);
          if (match) {
            const apptId = match[1];
            if (!validIds.has(apptId)) {
              await Notifications.cancelScheduledNotificationAsync(id);
              logger.log("[Notifications] Cancelled stale notification:", id);
            }
          }
        }
      } catch (err) {
        logger.warn("[Notifications] Failed to cancel stale reminders:", err);
      }
    };
    cancelStaleReminders();

    // Get all currently scheduled notifications so we can skip already-scheduled ones
    // This prevents duplicates when the component re-mounts (app background/foreground)
    const scheduleIfNotExists = async (identifier: string, content: any, trigger: any) => {
      try {
        const existing = await Notifications.getAllScheduledNotificationsAsync();
        const alreadyScheduled = existing.some((n) => n.identifier === identifier);
        if (!alreadyScheduled) {
          await Notifications.scheduleNotificationAsync({ identifier, content, trigger });
        }
      } catch (err) {
        logger.warn("[Notifications] Failed to schedule notification:", identifier, err);
      }
    };

    upcomingAppts.forEach(async (appt) => {
      const svc = state.services.find((s) => s.id === appt.serviceId);
      const client = state.clients.find((c) => c.id === appt.clientId);
      const location = state.locations?.find((l) => l.id === appt.locationId);

      const clientName = client?.name || "Client";
      const svcName = svc?.name || "Service";
      const duration = appt.duration;
      const startFmt = fmt12(appt.time);
      const endTime = computeEndTime(appt.time, duration);
      const endFmt = fmt12(endTime);
      const dateFmt = fmtDate(appt.date);
      const locationLine = location?.name ? `📍 ${location.name}` : "";
      const staff = state.staff?.find((s: any) => s.id === appt.staffId);
      const staffLine = staff?.name ? `👤 ${staff.name}` : "";

      // Use local date parsing to avoid timezone offset bugs (prevents 26-27h drift)
      const [h, m] = appt.time.split(":").map(Number);
      const [yr, mo, dy] = appt.date.split("-").map(Number);
      const apptDate = new Date(yr, mo - 1, dy, h, m, 0, 0);

      // ── 1-hour reminder ──────────────────────────────────────────────────────
      const hourReminderDate = new Date(apptDate.getTime() - 60 * 60 * 1000);
      if (hourReminderDate.getTime() > now.getTime()) {
        await scheduleIfNotExists(
          `reminder-1h-${appt.id}`,
          {
            title: `⏰ Upcoming Appointment in 1 Hour — ${businessName}`,
            body: [
              `Client: ${clientName}`,
              `Service: ${svcName} (${duration} min)`,
              `Time: ${startFmt} – ${endFmt}`,
              `Date: ${dateFmt}`,
              locationLine,
              staffLine,
            ].filter(Boolean).join("\n"),
            data: { type: "appointment_reminder", appointmentId: appt.id } as NotificationData,
            sound: true,
          },
          { type: Notifications.SchedulableTriggerInputTypes.DATE, date: hourReminderDate }
        );
      }

      // ── 30-minute reminder ──────────────────────────────────────────────────────
      const reminderDate = new Date(apptDate.getTime() - 30 * 60 * 1000);
      if (reminderDate.getTime() > now.getTime()) {
        await scheduleIfNotExists(
          `reminder-30m-${appt.id}`,
          {
            title: `⏰ Appointment in 30 min — ${businessName}`,
            body: [
              `Client: ${clientName}`,
              `Service: ${svcName} (${duration} min)`,
              `Time: ${startFmt} – ${endFmt}`,
              `Date: ${dateFmt}`,
              locationLine,
              staffLine,
              `Please ensure everything is ready for your client's arrival.`,
            ].filter(Boolean).join("\n"),
            data: { type: "appointment_reminder", appointmentId: appt.id } as NotificationData,
            sound: true,
          },
          { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderDate }
        );
      }

      // ── Auto-complete notification ──────────────────────────────────────
      if (autoCompleteEnabled) {
        // End time = start time + duration + delay
        const [endH, endM] = endTime.split(":").map(Number);
        // Use local date parsing to avoid timezone offset bugs
        const autoCompleteDate = new Date(yr, mo - 1, dy, endH, endM + autoCompleteDelayMinutes, 0, 0);

        if (autoCompleteDate.getTime() > now.getTime()) {
          await scheduleIfNotExists(
            `autocomplete-${appt.id}-${autoCompleteDelayMinutes}`,
            {
              title: `✅ Appointment Completed — ${businessName}`,
              body: [
                `The following appointment has been automatically marked as completed:`,
                ``,
                `Client: ${clientName}`,
                `Service: ${svcName} (${duration} min)`,
                `Time: ${startFmt} – ${endFmt}`,
                `Date: ${dateFmt}`,
                locationLine,
                staffLine,
                ``,
                `Tap to view the appointment details.`,
              ].filter(Boolean).join("\n"),
              data: {
                type: "appointment_completed",
                appointmentId: appt.id,
                filter: "completed",
              } as NotificationData,
              sound: true,
            },
            { type: Notifications.SchedulableTriggerInputTypes.DATE, date: autoCompleteDate }
          );

          // Silent action notification to trigger status update in store
          await scheduleIfNotExists(
            `autocomplete-action-${appt.id}`,
            {
              title: "",
              body: "",
              data: {
                type: "appointment_completed",
                appointmentId: appt.id,
                _action: "mark_complete",
              } as any,
              sound: false,
              ...(Platform.OS === "ios" ? { interruptionLevel: "passive" as any } : {}),
            },
            { type: Notifications.SchedulableTriggerInputTypes.DATE, date: autoCompleteDate }
          );
        }
      }
    });
  }, [
    state.appointments,
    state.services,
    state.clients,
    state.locations,
    state.settings.notificationsEnabled,
    autoCompleteEnabled,
    autoCompleteDelayMinutes,
    businessName,
  ]);

  // Handle auto-complete action notifications (mark appointment as completed in store)
  useEffect(() => {
    if (Platform.OS === "web") return;

    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as any;
      if (data?._action === "mark_complete" && data?.appointmentId) {
        const apptId = data.appointmentId as string;
        const appt = state.appointments.find((a) => a.id === apptId);
        if (appt && appt.status === "confirmed") {
          const updateAction = {
            type: "UPDATE_APPOINTMENT_STATUS" as const,
            payload: { id: apptId, status: "completed" as const },
          };
          dispatch(updateAction);
          syncToDb(updateAction);
          logger.log("[Notifications] Auto-completed appointment:", apptId);
        }
      }
    });

    return () => subscription.remove();
  }, [state.appointments, dispatch, syncToDb]);

  // ── Daily birthday reminder at 8:00 AM ────────────────────────────────────
  // Schedules a single daily notification that fires every morning at 8 AM.
  // When the notification fires, it lists all clients whose birthday is today.
  // We re-schedule whenever the client list changes to keep the body up-to-date.
  const birthdayReminderScheduledRef = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!state.loaded) return;
    const birthdayEnabled = state.settings.notificationPreferences?.birthdayReminderEnabled ?? true;
    // If master notifications off OR birthday toggle off — cancel any existing reminder and bail
    if (!state.settings.notificationsEnabled || !birthdayEnabled) {
      Notifications.getAllScheduledNotificationsAsync().then((scheduled) => {
        for (const n of scheduled) {
          if (n.identifier?.startsWith("birthday-daily-reminder")) {
            Notifications.cancelScheduledNotificationAsync(n.identifier);
          }
        }
      }).catch(() => {});
      birthdayReminderScheduledRef.current = false;
      return;
    }

    // Build today's birthday list to decide whether to schedule
    const todayClients = state.clients.filter((c) => {
      if (!c.birthday) return false;
      const parts = c.birthday.trim().split(/[-\/]/);
      if (parts.length < 2) return false;
      const today = new Date();
      // Support MM/DD/YYYY, MM-DD-YYYY, MM/DD, MM-DD
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      return month === today.getMonth() + 1 && day === today.getDate();
    });

    const reminderHour = state.settings.notificationPreferences?.birthdayReminderHour ?? 8;
    const scheduleKey = `birthday-daily-${state.clients.length}-h${reminderHour}`;
    if (birthdayReminderScheduledRef.current && scheduleKey === (birthdayReminderScheduledRef as any)._lastKey) return;
    (birthdayReminderScheduledRef as any)._lastKey = scheduleKey;
    birthdayReminderScheduledRef.current = true;

    const doSchedule = async () => {
      try {
        // Cancel any previously scheduled birthday reminder before re-scheduling
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        for (const n of scheduled) {
          if (n.identifier?.startsWith("birthday-daily-reminder")) {
            await Notifications.cancelScheduledNotificationAsync(n.identifier);
          }
        }

        // Set up Android channel for birthdays
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("birthdays", {
            name: "Birthday Reminders",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 200, 100, 200],
            lightColor: "#F59E0B",
            sound: "default",
          });
        }

        // Build a preview of today's birthdays for the notification body
        const previewNames = todayClients.slice(0, 3).map((c) => c.name);
        const extraCount = todayClients.length - previewNames.length;
        const bodyToday =
          todayClients.length === 0
            ? "No client birthdays today."
            : previewNames.join(", ") + (extraCount > 0 ? ` +${extraCount} more` : "");

        const hourLabel = reminderHour > 12 ? `${reminderHour - 12}:00 PM` : reminderHour === 12 ? "12:00 PM" : `${reminderHour}:00 AM`;
        await Notifications.scheduleNotificationAsync({
          identifier: "birthday-daily-reminder",
          content: {
            title: todayClients.length > 0
              ? `🎂 ${todayClients.length} Birthday${todayClients.length > 1 ? "s" : ""} Today!`
              : `🎂 Birthday Check — ${businessName}`,
            body: bodyToday,
            data: { type: "general", url: "/birthday-campaigns" },
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: reminderHour,
            minute: 0,
            ...(Platform.OS === "android" ? { channelId: "birthdays" } : {}),
          },
        });
        logger.log(`[Notifications] Birthday daily reminder scheduled for ${hourLabel}`);
      } catch (err) {
        logger.warn("[Notifications] Failed to schedule birthday reminder:", err);
      }
    };

    doSchedule();
  }, [state.clients, state.settings.notificationsEnabled, state.settings.notificationPreferences?.birthdayReminderEnabled, state.settings.notificationPreferences?.birthdayReminderHour, state.loaded, businessName]);

  const cancelAllReminders = useCallback(async () => {
    if (Platform.OS === "web") return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    scheduledRef.current.clear();
    birthdayReminderScheduledRef.current = false;
  }, []);

  return { cancelAllReminders };
}
