import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Notification Fixes", () => {
  // ─── Server-side: Business name in notification titles ─────────────
  describe("Server-side notifications use business name", () => {
    const publicRoutesPath = path.join(__dirname, "..", "server", "publicRoutes.ts");
    const publicRoutesContent = fs.readFileSync(publicRoutesPath, "utf-8");

    it("should include business name in new booking request notification title", () => {
      // The notifyOwner call for new bookings should use owner.businessName
      expect(publicRoutesContent).toContain("owner.businessName");
      expect(publicRoutesContent).toContain("New Booking Request");
    });

    it("should include business name in cancellation notification title", () => {
      expect(publicRoutesContent).toContain("owner.businessName");
      expect(publicRoutesContent).toContain("Appointment Cancelled");
    });

    it("should include business name in reschedule notification title", () => {
      expect(publicRoutesContent).toContain("owner.businessName");
      expect(publicRoutesContent).toContain("Appointment Rescheduled");
    });

    it("should include business name in waitlist notification title", () => {
      expect(publicRoutesContent).toContain("owner.businessName");
      expect(publicRoutesContent).toContain("New Waitlist Entry");
    });

    it("should NOT use generic titles without business name", () => {
      // Ensure old generic titles are gone
      const notifyOwnerCalls = publicRoutesContent.match(/await notifyOwner\(\{[\s\S]*?\}\)/g) || [];
      for (const call of notifyOwnerCalls) {
        // Each notifyOwner call should reference owner.businessName in the title
        expect(call).toContain("owner.businessName");
      }
    });
  });

  // ─── Client-side: Local reminder notifications ─────────────────────
  describe("Local reminder notifications use business name", () => {
    const hookPath = path.join(__dirname, "..", "hooks", "use-notifications.ts");
    const hookContent = fs.readFileSync(hookPath, "utf-8");

    it("should use business name in 30-minute reminder title", () => {
      expect(hookContent).toContain("businessName");
      expect(hookContent).toContain("30 min");
    });

    it("should use business name in 1-hour reminder title", () => {
      expect(hookContent).toContain("businessName");
      expect(hookContent).toContain("1 Hour");
    });

    it("should NOT use generic emoji titles", () => {
      // Old generic titles should be gone
      expect(hookContent).not.toContain('title: "Upcoming Appointment 📅"');
      expect(hookContent).not.toContain('title: "Appointment in 1 Hour ⏰"');
    });

    it("should read business name from store settings", () => {
      expect(hookContent).toContain("state.settings.businessName");
    });
  });

  // ─── Notification data payloads for deep navigation ────────────────
  describe("Notification payloads include navigation data", () => {
    const hookPath = path.join(__dirname, "..", "hooks", "use-notifications.ts");
    const hookContent = fs.readFileSync(hookPath, "utf-8");

    it("should include type field in reminder notification data", () => {
      expect(hookContent).toContain('type: "appointment_reminder"');
    });

    it("should include appointmentId in reminder notification data", () => {
      expect(hookContent).toContain("appointmentId: appt.id");
    });

    it("should define NotificationData type with required fields", () => {
      expect(hookContent).toContain("export type NotificationData");
      expect(hookContent).toContain('"appointment_reminder"');
      expect(hookContent).toContain('"appointment_request"');
      expect(hookContent).toContain('"appointment_cancelled"');
      expect(hookContent).toContain('"appointment_rescheduled"');
      expect(hookContent).toContain('"waitlist"');
    });
  });

  // ─── Notification tap handling (deep navigation) ───────────────────
  describe("Notification tap navigation handler", () => {
    const hookPath = path.join(__dirname, "..", "hooks", "use-notifications.ts");
    const hookContent = fs.readFileSync(hookPath, "utf-8");

    it("should import useRouter from expo-router", () => {
      expect(hookContent).toContain('import { useRouter } from "expo-router"');
    });

    it("should add notification response listener", () => {
      expect(hookContent).toContain("addNotificationResponseReceivedListener");
    });

    it("should handle cold-start notification with getLastNotificationResponseAsync", () => {
      expect(hookContent).toContain("getLastNotificationResponseAsync");
    });

    it("should navigate to appointment-detail for reminder notifications", () => {
      expect(hookContent).toContain('pathname: "/appointment-detail"');
    });

    it("should navigate to calendar requests for waitlist notifications", () => {
      // Waitlist notifications now route to bookings tab (requests filter) instead of calendar
      expect(hookContent).toContain('pathname: "/(tabs)/bookings"');
      expect(hookContent).toContain('filter: "requests"');
    });

    it("should handle appointment_request type with navigation to appointment-detail", () => {
      // The switch case should handle appointment_request
      expect(hookContent).toContain('"appointment_request"');
      // And navigate to appointment detail
      expect(hookContent).toContain('pathname: "/appointment-detail"');
    });

    it("should clean up listener on unmount", () => {
      expect(hookContent).toContain("responseSubscription.remove()");
    });
  });

  // ─── Calendar screen reads filter param ────────────────────────────
  describe("Calendar screen reads filter param from navigation", () => {
    const calendarPath = path.join(__dirname, "..", "app", "(tabs)", "calendar.tsx");
    const calendarContent = fs.readFileSync(calendarPath, "utf-8");

    it("should import useLocalSearchParams from expo-router", () => {
      expect(calendarContent).toContain("useLocalSearchParams");
    });

    it("should read filter param from route params", () => {
      expect(calendarContent).toContain("params.filter");
    });

    it("should update activeFilter when filter param changes", () => {
      // setActiveFilterPersisted wraps setActiveFilter and also persists to AsyncStorage
      expect(calendarContent).toContain("setActiveFilterPersisted(params.filter");
    });
  });
});
