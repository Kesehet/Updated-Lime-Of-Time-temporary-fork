/**
 * calendar-sync.ts
 * One-way sync: app → device calendar (Lime Of Time calendar).
 * - Creates a dedicated "Lime Of Time" calendar on the device.
 * - Adds an event when an appointment is accepted.
 * - Deletes the event when an appointment is cancelled.
 * - Bulk-syncs all existing confirmed appointments when the toggle is first enabled.
 * - Stores the mapping of appointmentId → calendarEventId in AsyncStorage.
 */
import * as Calendar from "expo-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const CALENDAR_ID_KEY = "@limeofttime_calendar_id";
const EVENT_MAP_KEY = "@limeofttime_event_map"; // JSON: { [appointmentId]: eventId }

// ─── Permission ───────────────────────────────────────────────────────────────
export async function requestCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

// ─── Get or create the "Lime Of Time" calendar ────────────────────────────────
export async function getOrCreateLimeCalendar(): Promise<string | null> {
  try {
    // Check if we already stored the calendar ID
    const stored = await AsyncStorage.getItem(CALENDAR_ID_KEY);
    if (stored) {
      // Verify it still exists on the device
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const still = calendars.find((c) => c.id === stored);
      if (still) return stored;
    }

    // Find an existing "Lime Of Time" calendar
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const existing = calendars.find((c) => c.title === "Lime Of Time");
    if (existing) {
      await AsyncStorage.setItem(CALENDAR_ID_KEY, existing.id);
      return existing.id;
    }

    // Create a new one
    let sourceId: string | undefined;
    if (Platform.OS === "ios") {
      const sources = await Calendar.getSourcesAsync();
      const local = sources.find((s) => s.type === Calendar.SourceType.LOCAL);
      const iCloud = sources.find((s) => s.type === Calendar.SourceType.CALDAV && s.name === "iCloud");
      sourceId = (iCloud ?? local)?.id;
    }

    const newId = await Calendar.createCalendarAsync({
      title: "Lime Of Time",
      color: "#4ade80",
      entityType: Calendar.EntityTypes.EVENT,
      sourceId,
      source: Platform.OS === "android"
        ? { isLocalAccount: true, name: "Lime Of Time", type: "" }
        : undefined,
      name: "Lime Of Time",
      ownerAccount: Platform.OS === "android" ? "personal" : undefined,
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });

    await AsyncStorage.setItem(CALENDAR_ID_KEY, newId);
    return newId;
  } catch (e) {
    console.warn("[CalendarSync] getOrCreateLimeCalendar error:", e);
    return null;
  }
}

// ─── Event map helpers ────────────────────────────────────────────────────────
async function getEventMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function setEventMap(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(EVENT_MAP_KEY, JSON.stringify(map));
}

// ─── Build event details ──────────────────────────────────────────────────────
type AppointmentEventInput = {
  appointmentId: string;
  clientName: string;
  serviceName: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  duration: number;   // minutes
  notes?: string;
  clientPhone?: string;
  locationAddress?: string;
  locationCity?: string;
  locationState?: string;
  locationZip?: string;
};

function buildEventDetails(appt: AppointmentEventInput): Calendar.Event {
  const [year, month, day] = appt.date.split("-").map(Number);
  const [hour, minute] = appt.time.split(":").map(Number);
  const startDate = new Date(year, month - 1, day, hour, minute);
  const endDate = new Date(startDate.getTime() + appt.duration * 60 * 1000);

  const locationParts = [
    appt.locationAddress,
    appt.locationCity,
    appt.locationState,
    appt.locationZip,
  ].filter(Boolean);
  const location = locationParts.join(", ");

  const notesParts: string[] = [];
  if (appt.serviceName) notesParts.push(`Service: ${appt.serviceName}`);
  if (appt.duration) notesParts.push(`Duration: ${appt.duration} min`);
  if (appt.clientPhone) notesParts.push(`Client phone: ${appt.clientPhone}`);
  if (appt.notes) notesParts.push(`Notes: ${appt.notes}`);

  return {
    title: `${appt.clientName} — ${appt.serviceName}`,
    startDate,
    endDate,
    location: location || undefined,
    notes: notesParts.join("\n") || undefined,
    alarms: [{ relativeOffset: -60 }], // 1-hour reminder
  } as unknown as Calendar.Event;
}

// ─── Add event ────────────────────────────────────────────────────────────────
export async function addCalendarEvent(appt: AppointmentEventInput): Promise<void> {
  try {
    const calId = await getOrCreateLimeCalendar();
    if (!calId) return;

    const map = await getEventMap();
    if (map[appt.appointmentId]) return; // already synced

    const details = buildEventDetails(appt);
    const eventId = await Calendar.createEventAsync(calId, details);
    map[appt.appointmentId] = eventId;
    await setEventMap(map);
  } catch (e) {
    console.warn("[CalendarSync] addCalendarEvent error:", e);
  }
}

// ─── Delete event ─────────────────────────────────────────────────────────────
export async function deleteCalendarEvent(appointmentId: string): Promise<void> {
  try {
    const map = await getEventMap();
    const eventId = map[appointmentId];
    if (!eventId) return;

    await Calendar.deleteEventAsync(eventId);
    delete map[appointmentId];
    await setEventMap(map);
  } catch (e) {
    console.warn("[CalendarSync] deleteCalendarEvent error:", e);
  }
}

// ─── Bulk sync all confirmed appointments ────────────────────────────────────
export async function bulkSyncConfirmedAppointments(
  appointments: AppointmentEventInput[],
): Promise<void> {
  for (const appt of appointments) {
    await addCalendarEvent(appt);
  }
}

// ─── Remove all Lime Of Time events (when toggle is disabled) ─────────────────
export async function removeAllCalendarEvents(): Promise<void> {
  try {
    const map = await getEventMap();
    for (const eventId of Object.values(map)) {
      try {
        await Calendar.deleteEventAsync(eventId);
      } catch {
        // ignore individual delete errors
      }
    }
    await AsyncStorage.removeItem(EVENT_MAP_KEY);
  } catch (e) {
    console.warn("[CalendarSync] removeAllCalendarEvents error:", e);
  }
}
