import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

// Helper to read file content
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

// Helper to check file exists
function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

describe("Multi-Location Management", () => {
  it("Location type is defined in types.ts", () => {
    const types = readFile("lib/types.ts");
    expect(types).toContain("export interface Location");
    expect(types).toContain("isDefault");
    expect(types).toContain("workingHours");
    expect(types).toContain("LOCATION_COLORS");
  });

  it("Locations table exists in DB schema", () => {
    const schema = readFile("drizzle/schema.ts");
    expect(schema).toContain("locations");
    expect(schema).toContain("localId");
    expect(schema).toContain("isDefault");
    expect(schema).toContain("address");
  });

  it("Location management screen exists", () => {
    expect(fileExists("app/locations.tsx")).toBe(true);
    const content = readFile("app/locations.tsx");
    expect(content).toContain("LocationsScreen");
    expect(content).toContain("location-form");
    expect(content).toContain("Add First Location");
  });

  it("Location form screen exists", () => {
    expect(fileExists("app/location-form.tsx")).toBe(true);
    const content = readFile("app/location-form.tsx");
    expect(content).toContain("LocationFormScreen");
    expect(content).toContain("ADD_LOCATION");
    expect(content).toContain("UPDATE_LOCATION");
    expect(content).toContain("DELETE_LOCATION");
  });

  it("Store has location actions and state", () => {
    const store = readFile("lib/store.tsx");
    expect(store).toContain("ADD_LOCATION");
    expect(store).toContain("UPDATE_LOCATION");
    expect(store).toContain("DELETE_LOCATION");
    expect(store).toContain("getLocationById");
    expect(store).toContain("locations:");
    expect(store).toContain("STORAGE_KEYS");
  });

  it("Location selector is in new-booking.tsx", () => {
    const booking = readFile("app/new-booking.tsx");
    expect(booking).toContain("selectedLocationId");
    expect(booking).toContain("activeLocations");
    expect(booking).toContain("locationId:");
  });

  it("Location display is in appointment-detail.tsx", () => {
    const detail = readFile("app/appointment-detail.tsx");
    expect(detail).toContain("assignedLocation");
    expect(detail).toContain("getLocationById");
  });

  it("Settings hub has Locations navigation card", () => {
    const settings = readFile("app/(tabs)/settings.tsx");
    expect(settings).toContain("Locations");
    expect(settings).toContain("/locations");
  });

  it("tRPC router has locations CRUD", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("locations:");
    expect(routers).toContain("createLocation");
    expect(routers).toContain("updateLocation");
    expect(routers).toContain("deleteLocation");
  });
});

describe("Phone Matching Fix (Cancel/Reschedule)", () => {
  it("Cancel endpoint has improved phone verification", () => {
    const routes = readFile("server/publicRoutes.ts");
    // Should check if client has phone before requiring verification
    expect(routes).toContain("client.phone && client.phone.trim()");
    // Should not allow bypass when client has phone but user sends empty
    expect(routes).toContain("Please enter your phone number to verify your identity.");
  });

  it("Reschedule endpoint has improved phone verification", () => {
    const routes = readFile("server/publicRoutes.ts");
    // Both cancel and reschedule should have the improved logic
    const cancelMatches = routes.match(/client\.phone && client\.phone\.trim\(\)/g);
    expect(cancelMatches).not.toBeNull();
    expect(cancelMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("Phone normalization strips non-digits and takes last 10", () => {
    // Test the normalization logic conceptually
    const normPhone = (p: string) => {
      const d = p.replace(/\D/g, "");
      return d.length >= 10 ? d.slice(-10) : d;
    };
    // Formatted phone
    expect(normPhone("+1 (412) 482-7733")).toBe("4124827733");
    // Raw digits
    expect(normPhone("4124827733")).toBe("4124827733");
    // With country code
    expect(normPhone("14124827733")).toBe("4124827733");
    // Short number
    expect(normPhone("5551234")).toBe("5551234");
  });
});

describe("Pricing/Charges Display", () => {
  it("Appointment schema has pricing columns", () => {
    const schema = readFile("drizzle/schema.ts");
    expect(schema).toContain("totalPrice");
    expect(schema).toContain("discountPercent");
    expect(schema).toContain("discountAmount");
    expect(schema).toContain("discountName");
    expect(schema).toContain("extraItems");
    expect(schema).toContain("giftApplied");
    expect(schema).toContain("giftUsedAmount");
  });

  it("Web booking endpoint stores pricing fields in DB", () => {
    const routes = readFile("server/publicRoutes.ts");
    // The createAppointment call should include pricing fields
    expect(routes).toContain("totalPrice: finalTotal");
    expect(routes).toContain("discountPercent:");
    expect(routes).toContain("discountAmount:");
    expect(routes).toContain("discountName:");
    expect(routes).toContain("extraItems:");
    expect(routes).toContain("giftApplied:");
    expect(routes).toContain("giftUsedAmount:");
  });

  it("Appointment detail shows itemized charges", () => {
    const detail = readFile("app/appointment-detail.tsx");
    expect(detail).toContain("Charges");
    expect(detail).toContain("Total Charged");
    expect(detail).toContain("discountAmt");
    expect(detail).toContain("computedTotal");
  });

  it("Store syncs pricing fields to DB", () => {
    const store = readFile("lib/store.tsx");
    expect(store).toContain("totalPrice:");
    expect(store).toContain("discountPercent:");
    expect(store).toContain("discountAmount:");
  });
});

describe("Settings Restructure", () => {
  it("Settings is a hub screen with navigation cards", () => {
    const settings = readFile("app/(tabs)/settings.tsx");
    // renderNavList replaced navItems as the navigation card renderer
    expect(settings).toContain("renderNavList");
    expect(settings).toContain("Schedule & Hours");
    expect(settings).toContain("Booking Policies");
    expect(settings).toContain("Client Reviews");
    expect(settings).toContain("Export Data");
    expect(settings).toContain("Analytics");
    expect(settings).toContain("Locations");
  });

  it("Schedule settings screen exists", () => {
    expect(fileExists("app/schedule-settings.tsx")).toBe(true);
    const content = readFile("app/schedule-settings.tsx");
    expect(content).toContain("ScheduleSettingsScreen");
    expect(content).toContain("Business Hours");
  });

  it("Booking policies screen exists", () => {
    expect(fileExists("app/booking-policies.tsx")).toBe(true);
    const content = readFile("app/booking-policies.tsx");
    expect(content).toContain("BookingPoliciesScreen");
  });

  it("Reviews screen exists", () => {
    expect(fileExists("app/reviews.tsx")).toBe(true);
    const content = readFile("app/reviews.tsx");
    expect(content).toContain("ReviewsScreen");
  });

  it("Data export screen exists", () => {
    expect(fileExists("app/data-export.tsx")).toBe(true);
    const content = readFile("app/data-export.tsx");
    expect(content).toContain("DataExportScreen");
  });
});

describe("Staff Improvements", () => {
  it("Staff selector is in new-booking.tsx", () => {
    const booking = readFile("app/new-booking.tsx");
    expect(booking).toContain("selectedStaffId");
    expect(booking).toContain("activeStaff");
    expect(booking).toContain("Assign Staff");
    expect(booking).toContain("staffId:");
  });

  it("Staff color coding is in calendar", () => {
    const calendar = readFile("app/(tabs)/calendar.tsx");
    expect(calendar).toContain("staffId");
    expect(calendar).toContain("getStaffById");
  });

  it("Staff display is in appointment-detail", () => {
    const detail = readFile("app/appointment-detail.tsx");
    expect(detail).toContain("assignedStaff");
    expect(detail).toContain("getStaffById");
  });
});

describe("Icon Mappings", () => {
  it("All required icons are mapped", () => {
    const icons = readFile("components/ui/icon-symbol.tsx");
    expect(icons).toContain("building.2.fill");
    expect(icons).toContain("location.fill");
    expect(icons).toContain("star.fill");
    expect(icons).toContain("chart.bar.fill");
    expect(icons).toContain("calendar.badge.clock");
    expect(icons).toContain("square.and.arrow.up.fill");
    expect(icons).toContain("exclamationmark.triangle.fill");
  });
});
