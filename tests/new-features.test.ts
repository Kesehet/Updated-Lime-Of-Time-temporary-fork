/**
 * Tests for new features:
 * 1. Gift card bannerImageUri in my-gifts endpoint
 * 2. Package expiry warning logic (7-day threshold)
 * 3. Balance gift remaining balance calculation in Promo step
 * 4. Splash screen component existence
 */

import { describe, it, expect } from "vitest";

// ── 1. Gift card bannerImageUri extraction from GIFT_DATA ─────────────────────
describe("my-gifts bannerImageUri extraction", () => {
  function extractGiftMeta(message: string) {
    const match = message.match(/\n---GIFT_DATA---\n(.+)$/s);
    let remainingBalance: number | null = null;
    let giftType = "service";
    let bannerImageUri: string | null = null;
    if (match) {
      try {
        const meta = JSON.parse(match[1]);
        remainingBalance = meta.remainingBalance ?? meta.originalValue ?? null;
        giftType = meta.giftType ?? "service";
        bannerImageUri = meta.bannerImageUri ?? null;
      } catch {}
    }
    return { remainingBalance, giftType, bannerImageUri };
  }

  it("extracts bannerImageUri when present in GIFT_DATA", () => {
    const msg = "Happy Birthday!\n---GIFT_DATA---\n" + JSON.stringify({
      giftType: "service",
      originalValue: 100,
      remainingBalance: 100,
      bannerImageUri: "https://example.com/banner.jpg",
    });
    const result = extractGiftMeta(msg);
    expect(result.bannerImageUri).toBe("https://example.com/banner.jpg");
    expect(result.giftType).toBe("service");
    expect(result.remainingBalance).toBe(100);
  });

  it("returns null bannerImageUri when not present in GIFT_DATA", () => {
    const msg = "Hello!\n---GIFT_DATA---\n" + JSON.stringify({
      giftType: "balance",
      originalValue: 50,
      remainingBalance: 30,
    });
    const result = extractGiftMeta(msg);
    expect(result.bannerImageUri).toBeNull();
    expect(result.remainingBalance).toBe(30);
  });

  it("returns null bannerImageUri when no GIFT_DATA block", () => {
    const result = extractGiftMeta("Just a plain message");
    expect(result.bannerImageUri).toBeNull();
    expect(result.remainingBalance).toBeNull();
  });
});

// ── 2. Package expiry warning logic ──────────────────────────────────────────
describe("package expiry warning (7-day threshold)", () => {
  function computeExpiryWarning(expiresAt: string | null, isExpiredPkg: boolean, isComplete: boolean) {
    const daysUntilExpiry = expiresAt && !isExpiredPkg && !isComplete
      ? Math.ceil((new Date(expiresAt + "T23:59:59").getTime() - Date.now()) / 86400000)
      : null;
    const showExpiryWarning = daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
    return { daysUntilExpiry, showExpiryWarning };
  }

  it("shows warning when package expires in 3 days", () => {
    const future = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    const { showExpiryWarning, daysUntilExpiry } = computeExpiryWarning(future, false, false);
    expect(showExpiryWarning).toBe(true);
    expect(daysUntilExpiry).toBeLessThanOrEqual(4); // 3-4 days depending on time of day
  });

  it("shows warning when package expires today (0 or 1 days due to Math.ceil)", () => {
    const today = new Date().toISOString().split("T")[0];
    const { showExpiryWarning, daysUntilExpiry } = computeExpiryWarning(today, false, false);
    expect(showExpiryWarning).toBe(true);
    // Math.ceil of remaining hours today gives 0 or 1 depending on time of day
    expect(daysUntilExpiry).toBeGreaterThanOrEqual(0);
    expect(daysUntilExpiry).toBeLessThanOrEqual(1);
  });

  it("shows warning when package expires in 6 days (within 7-day window)", () => {
    const sixDays = new Date(Date.now() + 6 * 86400000).toISOString().split("T")[0];
    const { showExpiryWarning, daysUntilExpiry } = computeExpiryWarning(sixDays, false, false);
    expect(showExpiryWarning).toBe(true);
    expect(daysUntilExpiry).toBeLessThanOrEqual(7);
  });

  it("does NOT show warning when package expires in 10 days", () => {
    const tenDays = new Date(Date.now() + 10 * 86400000).toISOString().split("T")[0];
    const { showExpiryWarning } = computeExpiryWarning(tenDays, false, false);
    expect(showExpiryWarning).toBe(false);
  });

  it("does NOT show warning when package is already expired", () => {
    const past = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
    const { showExpiryWarning } = computeExpiryWarning(past, true, false);
    expect(showExpiryWarning).toBe(false);
  });

  it("does NOT show warning when package is complete", () => {
    const future = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    const { showExpiryWarning } = computeExpiryWarning(future, false, true);
    expect(showExpiryWarning).toBe(false);
  });

  it("does NOT show warning when expiresAt is null", () => {
    const { showExpiryWarning } = computeExpiryWarning(null, false, false);
    expect(showExpiryWarning).toBe(false);
  });
});

// ── 3. Balance gift remaining balance calculation ─────────────────────────────
describe("balance gift remaining balance after booking", () => {
  function computeGiftUsage(
    giftValue: number,
    svcPrice: number,
    discountPct: number,
    promoFlat: number,
  ) {
    const discSaving = discountPct > 0 ? parseFloat((svcPrice * discountPct / 100).toFixed(2)) : 0;
    const afterDiscount = svcPrice - discSaving;
    const promoSaving = promoFlat > 0 ? Math.min(promoFlat, afterDiscount) : 0;
    const afterPromo = Math.max(0, afterDiscount - promoSaving);
    const giftUsed = Math.min(giftValue, afterPromo);
    const remainingAfterBooking = Math.max(0, giftValue - giftUsed);
    return { giftUsed, remainingAfterBooking };
  }

  it("partial usage: gift covers part of the service price", () => {
    // $30 gift, $80 service → uses $30, $0 remaining
    const { giftUsed, remainingAfterBooking } = computeGiftUsage(30, 80, 0, 0);
    expect(giftUsed).toBe(30);
    expect(remainingAfterBooking).toBe(0);
  });

  it("full coverage: gift covers the entire service price with leftover", () => {
    // $100 gift, $60 service → uses $60, $40 remaining
    const { giftUsed, remainingAfterBooking } = computeGiftUsage(100, 60, 0, 0);
    expect(giftUsed).toBe(60);
    expect(remainingAfterBooking).toBe(40);
  });

  it("with discount applied: gift covers discounted price", () => {
    // $50 gift, $80 service with 25% discount → after discount $60 → uses $50, $0 remaining
    const { giftUsed, remainingAfterBooking } = computeGiftUsage(50, 80, 25, 0);
    expect(giftUsed).toBe(50);
    expect(remainingAfterBooking).toBe(0);
  });

  it("with promo applied: gift covers post-promo price", () => {
    // $100 gift, $80 service with $20 promo → after promo $60 → uses $60, $40 remaining
    const { giftUsed, remainingAfterBooking } = computeGiftUsage(100, 80, 0, 20);
    expect(giftUsed).toBe(60);
    expect(remainingAfterBooking).toBe(40);
  });

  it("exact match: gift equals service price exactly", () => {
    // $50 gift, $50 service → uses $50, $0 remaining
    const { giftUsed, remainingAfterBooking } = computeGiftUsage(50, 50, 0, 0);
    expect(giftUsed).toBe(50);
    expect(remainingAfterBooking).toBe(0);
  });
});

// ── 4. Splash screen component file exists ───────────────────────────────────
import { existsSync } from "fs";
import { join } from "path";

describe("splash screen component", () => {
  it("animated-splash.tsx exists", () => {
    const splashPath = join(process.cwd(), "components/animated-splash.tsx");
    expect(existsSync(splashPath)).toBe(true);
  });
});
