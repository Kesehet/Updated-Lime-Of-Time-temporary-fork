/**
 * Appointment Reminder Notifications
 * Schedules local push notifications for upcoming appointments
 * based on the client's notification preferences.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFS_KEY = "@client_notification_prefs";

export interface NotificationPrefs {
  pushEnabled: boolean;
  smsEnabled: boolean;
  reminder24h: boolean;
  reminder1h: boolean;
  bookingConfirmation: boolean;
  cancellationAlerts: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  pushEnabled: true,
  smsEnabled: true,
  reminder24h: true,
  reminder1h: true,
  bookingConfirmation: true,
  cancellationAlerts: true,
};

/** Load saved notification preferences */
export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREFS;
}

/** Save notification preferences */
export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** Request notification permissions (call once at app start or when user enables push) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("appointments", {
        name: "Appointment Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#4A7C59",
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/** Check if notification permission is granted */
export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Schedule appointment reminder notifications based on user preferences.
 * Call this after a booking is confirmed.
 *
 * @param appointmentId  Unique appointment identifier (used for cancellation)
 * @param businessName   Business name to show in notification
 * @param serviceName    Service name to show in notification
 * @param date           Appointment date string "YYYY-MM-DD"
 * @param time           Appointment time string "HH:MM" (24h)
 */
export async function scheduleAppointmentReminders(
  appointmentId: string,
  businessName: string,
  serviceName: string,
  date: string,
  time: string
): Promise<void> {
  if (Platform.OS === "web") return;

  const prefs = await loadNotificationPrefs();
  const hasPermission = await hasNotificationPermission();
  if (!hasPermission) return;

  // Parse appointment datetime
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const apptDate = new Date(year, month - 1, day, hour, minute, 0);

  const now = Date.now();

  // Cancel any existing reminders for this appointment
  await cancelAppointmentReminders(appointmentId);

  const scheduled: string[] = [];

  // 24-hour reminder
  if (prefs.pushEnabled && prefs.reminder24h) {
    const trigger24h = new Date(apptDate.getTime() - 24 * 60 * 60 * 1000);
    if (trigger24h.getTime() > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Appointment Tomorrow",
          body: `${serviceName} at ${businessName} — ${formatTime(time)}`,
          data: { appointmentId, type: "reminder_24h" },
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger24h },
      });
      scheduled.push(id);
    }
  }

  // 1-hour reminder
  if (prefs.pushEnabled && prefs.reminder1h) {
    const trigger1h = new Date(apptDate.getTime() - 60 * 60 * 1000);
    if (trigger1h.getTime() > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Appointment in 1 Hour",
          body: `${serviceName} at ${businessName} — ${formatTime(time)}`,
          data: { appointmentId, type: "reminder_1h" },
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger1h },
      });
      scheduled.push(id);
    }
  }

  // Store the notification IDs so we can cancel them later
  if (scheduled.length > 0) {
    const existing = await getStoredNotificationIds();
    existing[appointmentId] = scheduled;
    await AsyncStorage.setItem("appt_notification_ids", JSON.stringify(existing));
  }
}

/** Cancel all scheduled reminders for a specific appointment */
export async function cancelAppointmentReminders(appointmentId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const existing = await getStoredNotificationIds();
    const ids = existing[appointmentId] ?? [];
    for (const id of ids) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
    delete existing[appointmentId];
    await AsyncStorage.setItem("appt_notification_ids", JSON.stringify(existing));
  } catch {}
}

async function getStoredNotificationIds(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem("appt_notification_ids");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
}
