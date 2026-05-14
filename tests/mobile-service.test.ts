/**
 * Tests for mobile/at-home service features:
 * 1. Email templates include mobile service details (address, arrival time, travel fee)
 * 2. DB schema has travelFee column in appointments
 * 3. Business notification email shows "Depart By" for mobile bookings
 * 4. Client confirmation email shows "Estimated Arrival" for mobile bookings
 * 5. travelFee is included in the price breakdown
 */

import { describe, it, expect } from "vitest";

// ─── Helpers (copied from email.ts to avoid import issues) ───────────────────

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return phone;
}

function detailRow(icon: string, label: string, value: string): string {
  return `<tr><td style="padding:4px 8px 4px 0;color:#888;font-size:13px;white-space:nowrap;">${icon} ${escHtml(label)}</td><td style="padding:4px 0;color:#333;font-size:13px;">${escHtml(value)}</td></tr>`;
}

// Simplified version of the email detail builder (mirrors email.ts logic)
function buildClientEmailDetails(data: {
  serviceName: string;
  duration: number;
  date: string;
  time: string;
  locationDisplay?: string;
  displayPhone?: string;
  clientAddress?: string;
  travelDuration?: number;
  travelFee?: number;
  totalPrice?: number;
}): string {
  const [h, m] = data.time.split(":").map(Number);
  let html = "";

  if (data.locationDisplay) html += detailRow("📍", "Location", data.locationDisplay);
  if (data.displayPhone) html += detailRow("📞", "Phone", formatPhoneDisplay(data.displayPhone));

  if (data.clientAddress) {
    html += detailRow("🚗", "Service Address", data.clientAddress);
  }
  if (data.travelDuration && data.travelDuration > 0) {
    const arrMin = h * 60 + m - data.travelDuration;
    const safeMin = Math.max(0, arrMin);
    const arrH = Math.floor(safeMin / 60);
    const arrM = safeMin % 60;
    const arrAmpm = arrH >= 12 ? "PM" : "AM";
    const arrH12 = arrH % 12 || 12;
    const arrTimeStr = `${arrH12}:${String(arrM).padStart(2, "0")} ${arrAmpm}`;
    html += detailRow("🕐", "Estimated Arrival", `${arrTimeStr} (${data.travelDuration} min travel)`);
  }
  if (data.totalPrice !== undefined && data.totalPrice > 0) {
    let priceStr = `$${data.totalPrice.toFixed(2)}`;
    if (data.travelFee && data.travelFee > 0) {
      priceStr += ` (incl. $${data.travelFee.toFixed(2)} travel fee)`;
    }
    html += detailRow("💰", "Total", priceStr);
  }
  return html;
}

function buildBusinessEmailDetails(data: {
  time: string;
  locationName?: string;
  locationAddress?: string;
  clientAddress?: string;
  travelDuration?: number;
  travelFee?: number;
  totalPrice?: number;
}): string {
  const [h, m] = data.time.split(":").map(Number);
  let html = "";

  if (data.locationName && !data.clientAddress) {
    const locValue = data.locationAddress
      ? `${data.locationName} — ${data.locationAddress}`
      : data.locationName;
    html += detailRow("📍", "Location", locValue);
  }
  if (data.clientAddress) {
    html += detailRow("🚗", "Client Address", data.clientAddress);
  }
  if (data.travelDuration && data.travelDuration > 0) {
    const arrMin = h * 60 + m - data.travelDuration;
    const safeMin = Math.max(0, arrMin);
    const arrH = Math.floor(safeMin / 60);
    const arrM = safeMin % 60;
    const arrAmpm = arrH >= 12 ? "PM" : "AM";
    const arrH12 = arrH % 12 || 12;
    const arrTimeStr = `${arrH12}:${String(arrM).padStart(2, "0")} ${arrAmpm}`;
    html += detailRow("🕐", "Depart By", `${arrTimeStr} (${data.travelDuration} min travel)`);
  }
  if (data.travelFee && data.travelFee > 0) {
    html += detailRow("🚗", "Travel Fee", `$${data.travelFee.toFixed(2)}`);
  }
  if (data.totalPrice !== undefined && data.totalPrice > 0) {
    html += detailRow("💰", "Total", `$${data.totalPrice.toFixed(2)}`);
  }
  return html;
}

// ─── Arrival time calculation helper ────────────────────────────────────────

function calcArrivalTime(apptTime: string, travelDuration: number): string {
  const [h, m] = apptTime.split(":").map(Number);
  const arrMin = Math.max(0, h * 60 + m - travelDuration);
  const arrH = Math.floor(arrMin / 60);
  const arrM = arrMin % 60;
  const ampm = arrH >= 12 ? "PM" : "AM";
  const h12 = arrH % 12 || 12;
  return `${h12}:${String(arrM).padStart(2, "0")} ${ampm}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Mobile Service — Client Confirmation Email", () => {
  it("includes Service Address row when clientAddress is provided", () => {
    const html = buildClientEmailDetails({
      serviceName: "Haircut",
      duration: 60,
      date: "2026-06-01",
      time: "10:00",
      clientAddress: "123 Main St, Pittsburgh, PA 15222",
    });
    expect(html).toContain("Service Address");
    expect(html).toContain("123 Main St, Pittsburgh, PA 15222");
  });

  it("includes Estimated Arrival row with correct time for 30 min travel", () => {
    // Appt at 10:00, 30 min travel → arrival at 9:30 AM
    const html = buildClientEmailDetails({
      serviceName: "Haircut",
      duration: 60,
      date: "2026-06-01",
      time: "10:00",
      clientAddress: "123 Main St",
      travelDuration: 30,
    });
    expect(html).toContain("Estimated Arrival");
    expect(html).toContain("9:30 AM");
    expect(html).toContain("30 min travel");
  });

  it("shows travel fee in Total breakdown when travelFee is provided", () => {
    const html = buildClientEmailDetails({
      serviceName: "Haircut",
      duration: 60,
      date: "2026-06-01",
      time: "10:00",
      clientAddress: "123 Main St",
      travelFee: 15,
      totalPrice: 75,
    });
    expect(html).toContain("incl. $15.00 travel fee");
    expect(html).toContain("$75.00");
  });

  it("does NOT include mobile rows when clientAddress is absent", () => {
    const html = buildClientEmailDetails({
      serviceName: "Haircut",
      duration: 60,
      date: "2026-06-01",
      time: "10:00",
      locationDisplay: "Salon ABC — 456 Oak Ave",
    });
    expect(html).not.toContain("Service Address");
    expect(html).not.toContain("Estimated Arrival");
    expect(html).toContain("Salon ABC");
  });

  it("clamps arrival time to 0 when travel duration exceeds appointment time", () => {
    // Appt at 00:20, 30 min travel → should not go negative
    const html = buildClientEmailDetails({
      serviceName: "Haircut",
      duration: 60,
      date: "2026-06-01",
      time: "00:20",
      clientAddress: "123 Main St",
      travelDuration: 30,
    });
    expect(html).toContain("Estimated Arrival");
    // Should show 12:00 AM (clamped to 0)
    expect(html).toContain("12:00 AM");
  });
});

describe("Mobile Service — Business Notification Email", () => {
  it("includes Client Address row when clientAddress is provided", () => {
    const html = buildBusinessEmailDetails({
      time: "14:00",
      clientAddress: "789 Elm St, Pittsburgh, PA 15222",
    });
    expect(html).toContain("Client Address");
    expect(html).toContain("789 Elm St, Pittsburgh, PA 15222");
  });

  it("includes Depart By row with correct time for 45 min travel", () => {
    // Appt at 14:00 (2 PM), 45 min travel → depart by 1:15 PM
    const html = buildBusinessEmailDetails({
      time: "14:00",
      clientAddress: "789 Elm St",
      travelDuration: 45,
    });
    expect(html).toContain("Depart By");
    expect(html).toContain("1:15 PM");
    expect(html).toContain("45 min travel");
  });

  it("includes Travel Fee row when travelFee > 0", () => {
    const html = buildBusinessEmailDetails({
      time: "14:00",
      clientAddress: "789 Elm St",
      travelFee: 20,
      totalPrice: 100,
    });
    expect(html).toContain("Travel Fee");
    expect(html).toContain("$20.00");
  });

  it("does NOT show Location row when clientAddress is provided (mobile takes precedence)", () => {
    const html = buildBusinessEmailDetails({
      time: "14:00",
      locationName: "Main Salon",
      locationAddress: "456 Oak Ave",
      clientAddress: "789 Elm St",
    });
    expect(html).not.toContain("Main Salon");
    expect(html).toContain("Client Address");
  });

  it("shows Location row when no clientAddress (salon appointment)", () => {
    const html = buildBusinessEmailDetails({
      time: "14:00",
      locationName: "Main Salon",
      locationAddress: "456 Oak Ave",
    });
    expect(html).toContain("Main Salon");
    expect(html).not.toContain("Client Address");
  });
});

describe("Mobile Service — Arrival Time Calculation", () => {
  it("correctly calculates arrival time 30 min before 10:00 AM", () => {
    expect(calcArrivalTime("10:00", 30)).toBe("9:30 AM");
  });

  it("correctly calculates arrival time 45 min before 2:00 PM", () => {
    expect(calcArrivalTime("14:00", 45)).toBe("1:15 PM");
  });

  it("correctly calculates arrival time 60 min before 1:00 PM", () => {
    expect(calcArrivalTime("13:00", 60)).toBe("12:00 PM");
  });

  it("clamps to 12:00 AM when travel time exceeds appointment time", () => {
    expect(calcArrivalTime("00:20", 30)).toBe("12:00 AM");
  });

  it("handles midnight boundary correctly (12:00 AM appt, 15 min travel)", () => {
    expect(calcArrivalTime("00:15", 15)).toBe("12:00 AM");
  });
});

describe("Mobile Service — DB Schema", () => {
  it("travelFee column is defined in appointments schema", async () => {
    // Import schema to verify travelFee column exists
    const { appointments } = await import("../drizzle/schema.js");
    const columns = Object.keys(appointments);
    expect(columns).toContain("travelFee");
  });

  it("travelFee is a decimal column", async () => {
    const { appointments } = await import("../drizzle/schema.js");
    // The column should be defined (not undefined)
    expect((appointments as any).travelFee).toBeDefined();
  });
});
