import { describe, expect, it } from "vitest";
import { generateAvailableSlots, generateCalendarSlots, type Appointment } from "../lib/types";

const workingHours = {
  monday: { enabled: true, start: "09:00", end: "12:00" },
} as any;

const appointments: Appointment[] = [
  {
    id: "appt-1",
    serviceId: "svc-1",
    clientId: "client-1",
    date: "2026-06-01",
    time: "10:00",
    duration: 60,
    status: "confirmed",
    notes: "",
    createdAt: "",
  },
];

describe("buffer time slot generation", () => {
  it("applies one symmetric buffer around existing appointments in generated availability", () => {
    const slots = generateAvailableSlots(
      "2026-06-01",
      30,
      workingHours,
      appointments,
      15,
      [],
      "weekly",
      15
    );

    expect(slots).toContain("09:15");
    expect(slots).not.toContain("09:30");
    expect(slots).not.toContain("11:00");
    expect(slots).toContain("11:15");
  });

  it("uses the same buffer boundary behavior for calendar slots", () => {
    const slots = generateCalendarSlots(
      "2026-06-01",
      30,
      workingHours,
      appointments,
      15,
      [],
      "weekly",
      15
    );

    expect(slots).toContain("09:15");
    expect(slots).not.toContain("09:30");
    expect(slots).not.toContain("11:00");
    expect(slots).toContain("11:15");
  });
});
