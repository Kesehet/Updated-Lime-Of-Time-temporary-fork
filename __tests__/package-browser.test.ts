/**
 * Tests for the Package Browser feature set:
 * 1. package-browser.tsx screen exists and has required UI elements
 * 2. calendar.tsx has the Packages & Bundles preview row with View All
 * 3. calendar-booking.tsx has the Book a Package banner in Step 1
 * 4. calendar-booking.tsx has packageId param support
 * 5. calendar-booking.tsx Step 8 has slot count badges with color coding
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");

const readFile = (rel: string) => readFileSync(join(root, rel), "utf-8");

// ─── 1. Package Browser screen ───────────────────────────────────────────────

describe("package-browser.tsx", () => {
  const src = readFile("app/package-browser.tsx");

  it("exports a default component", () => {
    expect(src).toContain("export default function PackageBrowserScreen");
  });

  it("renders category filter chips", () => {
    expect(src).toContain("selectedCategory");
    expect(src).toContain("setSelectedCategory");
  });

  it("shows package list with FlatList", () => {
    expect(src).toContain("<FlatList");
  });

  it("shows full detail bottom sheet modal", () => {
    expect(src).toContain("<Modal");
    expect(src).toContain("detailPackage");
    expect(src).toContain("setDetailPackage");
  });

  it("shows savings percentage on package cards", () => {
    expect(src).toContain("savingsPct");
    expect(src).toContain("Save");
  });

  it("shows included services breakdown in detail sheet", () => {
    expect(src).toContain("Included Services");
    expect(src).toContain("includedSvcs.map");
  });

  it("shows package details (sessions, duration, buffer, expiry)", () => {
    expect(src).toContain("Package Details");
    expect(src).toContain("bufferDays");
    expect(src).toContain("expiryDays");
    expect(src).toContain("formatExpiry");
  });

  it("has Book This Package CTA that navigates to calendar-booking", () => {
    expect(src).toContain("Book This Package");
    expect(src).toContain("/calendar-booking");
    expect(src).toContain("packageId: pkg.id");
  });

  it("shows empty state when no packages exist", () => {
    expect(src).toContain("No Packages Yet");
  });

  it("passes locationId param to calendar-booking when available", () => {
    expect(src).toContain("locationId: params.locationId");
  });
});

// ─── 2. Calendar tab entry point ─────────────────────────────────────────────
// NOTE: The inline Packages & Bundles preview row was intentionally removed
// from calendar.tsx (see ui-changes-4.test.ts). These tests are skipped.

describe("calendar.tsx — Packages & Bundles preview row", () => {
  const src = readFile("app/(tabs)/calendar.tsx");

  it.skip("renders a Packages & Bundles label", () => {
    expect(src).toContain("Packages & Bundles");
  });

  it.skip("has a View All button that navigates to package-browser", () => {
    expect(src).toContain("View All");
    expect(src).toContain("/package-browser");
  });

  it.skip("renders a horizontal ScrollView of package cards", () => {
    // The preview row uses a horizontal ScrollView
    expect(src).toContain("activePkgs.slice(0, 6).map");
  });

  it.skip("shows savings badge on preview cards", () => {
    expect(src).toContain("Save $");
  });

  it.skip("passes calLocationFilter to package-browser navigation", () => {
    expect(src).toContain("calLocationFilter !== null ? { locationId: calLocationFilter }");
  });
});

// ─── 3. Calendar booking page — Book a Package banner ────────────────────────

describe("calendar-booking.tsx — Book a Package banner", () => {
  const src = readFile("app/calendar-booking.tsx");

  it("shows Book a Package banner in Step 1", () => {
    expect(src).toContain("Book a Package");
    expect(src).toContain("bundle");
  });

  it("banner navigates to package-browser", () => {
    expect(src).toContain('pathname: "/package-browser"');
  });
});

// ─── 4. packageId param support ──────────────────────────────────────────────

describe("calendar-booking.tsx — packageId param", () => {
  const src = readFile("app/calendar-booking.tsx");

  it("declares packageId in useLocalSearchParams", () => {
    expect(src).toContain("packageId?: string");
  });

  it("has a useEffect that pre-populates selectedServices from packageId", () => {
    expect(src).toContain("params.packageId");
    expect(src).toContain("state.packages");
    expect(src).toContain("setSelectedServices");
  });

  it("sets type: package in the pre-populated cart item", () => {
    expect(src).toContain('type: "package"');
    expect(src).toContain("packageId: pkg.id");
    expect(src).toContain("packageServiceIds: pkg.serviceIds");
  });
});

// ─── 5. Step 8 slot count badges ─────────────────────────────────────────────

describe("calendar-booking.tsx — Step 8 slot count badges", () => {
  const src = readFile("app/calendar-booking.tsx");

  it("computes pkgSlotCount for each day cell", () => {
    expect(src).toContain("pkgSlotCount");
    expect(src).toContain("generateCalendarSlots");
  });

  it("shows FULL label for fully-booked days", () => {
    expect(src).toContain("FULL");
    expect(src).toContain("isFull");
  });

  it("shows color-coded slot count badge (green/amber/red)", () => {
    expect(src).toContain("#22C55E");
    expect(src).toContain("#F59E0B");
    expect(src).toContain("#EF4444");
    expect(src).toContain("pkgSlotCount >= 6");
    expect(src).toContain("pkgSlotCount >= 2");
  });

  it("shows slot count as white when day is selected", () => {
    expect(src).toContain("rgba(255,255,255,0.85)");
  });
});
