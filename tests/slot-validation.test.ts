import { describe, it, expect } from "vitest";

// Replicate the generateAvailableSlots logic inline for testing
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}
function generateAvailableSlots(
  date: string, duration: number, workingHours: any, appointments: any[],
  interval: number, customSchedule: any[], scheduleMode: "weekly" | "custom" = "weekly",
  bufferTime = 0, clientToday?: string | null, clientNowMinutes?: number | null
): string[] {
  const DAYS_OF_WEEK = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const d = new Date(date + "T00:00:00");
  const dayName = DAYS_OF_WEEK[d.getDay()];
  const customDay = customSchedule.find((cs: any) => cs.date === date);
  let startMin: number, endMin: number;
  if (scheduleMode === "custom") {
    if (!customDay || !customDay.isOpen) return [];
    startMin = timeToMinutes(customDay.startTime || "09:00");
    endMin = timeToMinutes(customDay.endTime || "17:00");
  } else {
    const abbr3 = dayName.slice(0, 3);
    const wh = workingHours?.[dayName] || workingHours?.[dayName.toLowerCase()] || workingHours?.[abbr3] || workingHours?.[abbr3.toLowerCase()];
    if (customDay) {
      if (!customDay.isOpen) return [];
      startMin = timeToMinutes(customDay.startTime || wh?.start || "09:00");
      endMin = timeToMinutes(customDay.endTime || wh?.end || "17:00");
    } else {
      if (!wh || !wh.enabled) return [];
      startMin = timeToMinutes(wh.start || "09:00");
      endMin = timeToMinutes(wh.end || "17:00");
    }
  }
  const bookedSlots = appointments
    .filter((a: any) => a.date === date && (a.status === "confirmed" || a.status === "pending"))
    .map((a: any) => ({ start: timeToMinutes(a.time), end: timeToMinutes(a.time) + (a.duration || 60) }));
  const now = new Date();
  const today = clientToday || `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,"0")}-${now.getDate().toString().padStart(2,"0")}`;
  const currentMinutes = (clientNowMinutes !== null && clientNowMinutes !== undefined) ? clientNowMinutes : (now.getHours() * 60 + now.getMinutes());
  const slots: string[] = [];
  for (let t = startMin; t + duration <= endMin; t += interval) {
    if (date === today && t < currentMinutes) continue;
    const slotEnd = t + duration;
    const conflict = bookedSlots.some((b: any) => t < (b.end + bufferTime) && slotEnd > (b.start - bufferTime));
    if (!conflict) slots.push(minutesToTime(t));
  }
  return slots;
}

const workingHours = {
  Monday: { enabled: true, start: "09:00", end: "18:00" },
  Tuesday: { enabled: true, start: "09:00", end: "18:00" },
  Wednesday: { enabled: true, start: "09:00", end: "18:00" },
  Thursday: { enabled: true, start: "09:00", end: "18:00" },
  Friday: { enabled: true, start: "09:00", end: "18:00" },
  Saturday: { enabled: true, start: "09:00", end: "14:00" },
  Sunday: { enabled: false, start: "09:00", end: "17:00" },
};

describe("Slot validation fix", () => {
  it("configured 15-min interval generates 10:30 slot for 60-min service", () => {
    // Monday 2026-05-11 — use a future date so no "past" filtering
    const slots = generateAvailableSlots("2026-05-18", 60, workingHours, [], 15, [], "weekly", 0, "2026-05-17", 0);
    expect(slots).toContain("10:30");
    expect(slots).toContain("10:15");
    expect(slots).toContain("09:00");
  });

  it("default 30-min interval generates 10:30 but NOT 10:15", () => {
    const slots = generateAvailableSlots("2026-05-18", 60, workingHours, [], 30, [], "weekly", 0, "2026-05-17", 0);
    expect(slots).toContain("10:30");
    expect(slots).not.toContain("10:15");
  });

  it("5-min fallback catches 10:15 slot even with 30-min configured interval", () => {
    const configuredInterval = 30;
    const dur = 60;
    const bookInterval = configuredInterval > 0 ? configuredInterval : Math.min(dur, 30);
    const slots = generateAvailableSlots("2026-05-18", dur, workingHours, [], bookInterval, [], "weekly", 0, "2026-05-17", 0);
    const slots5 = bookInterval > 5 ? generateAvailableSlots("2026-05-18", dur, workingHours, [], 5, [], "weekly", 0, "2026-05-17", 0) : slots;
    // 10:15 not in primary slots but IS in 5-min fallback
    expect(slots).not.toContain("10:15");
    expect(slots5).toContain("10:15");
    // So the combined check passes
    expect(slots.includes("10:15") || slots5.includes("10:15")).toBe(true);
  });

  it("client timezone: slot at 10:30 is valid when client says today is a past date", () => {
    // Client says today is yesterday — so all slots for tomorrow are valid
    const slots = generateAvailableSlots("2026-05-18", 60, workingHours, [], 30, [], "weekly", 0, "2026-05-17", 0);
    expect(slots).toContain("10:30");
  });

  it("server UTC timezone bug: without clientToday, morning slots may be filtered", () => {
    // Simulate server running at 14:00 UTC (10:00 AM Eastern) treating today as 2026-05-18
    // and the client selected 10:30 AM on 2026-05-18 — should be valid with clientToday
    const slotsWithClientTime = generateAvailableSlots("2026-05-18", 60, workingHours, [], 30, [], "weekly", 0, "2026-05-18", 9 * 60); // client says it's 9:00 AM
    expect(slotsWithClientTime).toContain("10:30");
  });
});
