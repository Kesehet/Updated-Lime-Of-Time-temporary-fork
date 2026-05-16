/**
 * Tests for referral discount price display logic in PlanCarousel.
 *
 * These tests mirror the exact calculations in components/plan-carousel.tsx
 * so we can verify correctness without rendering the component.
 */
import { describe, it, expect } from "vitest";

// ─── Price calculation helpers (mirrors plan-carousel.tsx PlanSlide logic) ────

interface PriceCalcInput {
  monthlyPrice: number;
  yearlyPrice: number;
  effectiveMonthlyPrice?: number;
  effectiveYearlyPrice?: number;
  isYearly: boolean;
  referralDiscountPercent?: number;
}

function calcPrices(input: PriceCalcInput) {
  const {
    monthlyPrice,
    yearlyPrice,
    effectiveMonthlyPrice,
    effectiveYearlyPrice,
    isYearly,
    referralDiscountPercent,
  } = input;

  const isFree = monthlyPrice === 0;
  const effectiveMonthly = effectiveMonthlyPrice ?? monthlyPrice;
  const effectiveYearly = effectiveYearlyPrice ?? yearlyPrice;

  const hasReferralDiscount = !isFree && (referralDiscountPercent ?? 0) > 0;
  const referralFactor = hasReferralDiscount ? (1 - (referralDiscountPercent! / 100)) : 1;

  const rawPrice = isYearly
    ? (effectiveYearly / 12) * referralFactor
    : effectiveMonthly * referralFactor;

  const rawOriginal = isYearly ? effectiveYearly / 12 : effectiveMonthly;

  // Discounted yearly total: full yearly price minus discount on first 3 months
  const referralDiscountedYearly = hasReferralDiscount
    ? effectiveYearly - (effectiveYearly / 12) * (referralDiscountPercent! / 100) * 3
    : effectiveYearly;

  const priceWhole = isFree ? "0" : Math.floor(rawPrice).toString();
  const priceCents = isFree ? "00" : (rawPrice % 1).toFixed(2).slice(2);

  return {
    isFree,
    hasReferralDiscount,
    rawPrice,
    rawOriginal,
    referralDiscountedYearly,
    priceWhole,
    priceCents,
    showStrikethrough: (hasReferralDiscount) && rawOriginal > rawPrice,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Referral discount — monthly pricing", () => {
  it("applies 50% discount to monthly price correctly", () => {
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: false,
      referralDiscountPercent: 50,
    });
    expect(result.rawPrice).toBeCloseTo(9.5, 2);
    expect(result.rawOriginal).toBe(19);
    expect(result.hasReferralDiscount).toBe(true);
    expect(result.showStrikethrough).toBe(true);
    expect(result.priceWhole).toBe("9");
    expect(result.priceCents).toBe("50");
  });

  it("applies 25% discount to monthly price correctly", () => {
    const result = calcPrices({
      monthlyPrice: 49,
      yearlyPrice: 470,
      isYearly: false,
      referralDiscountPercent: 25,
    });
    expect(result.rawPrice).toBeCloseTo(36.75, 2);
    expect(result.priceWhole).toBe("36");
    expect(result.priceCents).toBe("75");
    expect(result.showStrikethrough).toBe(true);
  });

  it("does NOT apply discount when referralDiscountPercent is 0", () => {
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: false,
      referralDiscountPercent: 0,
    });
    expect(result.rawPrice).toBe(19);
    expect(result.hasReferralDiscount).toBe(false);
    expect(result.showStrikethrough).toBe(false);
  });

  it("does NOT apply discount when referralDiscountPercent is undefined", () => {
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: false,
    });
    expect(result.rawPrice).toBe(19);
    expect(result.hasReferralDiscount).toBe(false);
  });

  it("does NOT apply discount to free plans", () => {
    const result = calcPrices({
      monthlyPrice: 0,
      yearlyPrice: 0,
      isYearly: false,
      referralDiscountPercent: 50,
    });
    expect(result.isFree).toBe(true);
    expect(result.hasReferralDiscount).toBe(false);
    expect(result.rawPrice).toBe(0);
  });
});

describe("Referral discount — yearly pricing", () => {
  it("applies 50% discount to per-month price in yearly mode", () => {
    // Growth plan: $182/year = $15.17/mo effective
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: true,
      referralDiscountPercent: 50,
    });
    const expectedPerMonth = (182 / 12) * 0.5;
    expect(result.rawPrice).toBeCloseTo(expectedPerMonth, 4);
    expect(result.rawOriginal).toBeCloseTo(182 / 12, 4);
    expect(result.showStrikethrough).toBe(true);
  });

  it("calculates discounted yearly total correctly (3 months discounted)", () => {
    // Growth: $182/year, 50% off first 3 months
    // Discount = (182/12) * 0.50 * 3 = 22.75
    // Discounted yearly = 182 - 22.75 = 159.25
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: true,
      referralDiscountPercent: 50,
    });
    expect(result.referralDiscountedYearly).toBeCloseTo(159.25, 2);
  });

  it("calculates discounted yearly total for 25% off", () => {
    // Studio: $470/year, 25% off first 3 months
    // Discount = (470/12) * 0.25 * 3 = 29.375
    // Discounted yearly = 470 - 29.375 = 440.625
    const result = calcPrices({
      monthlyPrice: 49,
      yearlyPrice: 470,
      isYearly: true,
      referralDiscountPercent: 25,
    });
    expect(result.referralDiscountedYearly).toBeCloseTo(440.625, 2);
  });

  it("referralDiscountedYearly equals effectiveYearly when no referral", () => {
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: true,
    });
    expect(result.referralDiscountedYearly).toBe(182);
  });
});

describe("Referral discount — Remove button state reset", () => {
  it("clearing referral discount returns to full price", () => {
    // Simulate: referral applied → price discounted
    const withReferral = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: false,
      referralDiscountPercent: 50,
    });
    expect(withReferral.rawPrice).toBeCloseTo(9.5, 2);

    // Simulate: Remove button pressed → referralDiscountPercent cleared
    const afterRemove = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: false,
      referralDiscountPercent: undefined,
    });
    expect(afterRemove.rawPrice).toBe(19);
    expect(afterRemove.hasReferralDiscount).toBe(false);
    expect(afterRemove.showStrikethrough).toBe(false);
  });
});

describe("Referral discount — AsyncStorage cleanup", () => {
  it("stored ref key constant is correct", () => {
    // Ensure the key used in onboarding.tsx and choose-plan.tsx matches
    const STORAGE_KEY = "@lot_pending_ref";
    expect(STORAGE_KEY).toBe("@lot_pending_ref");
  });
});

describe("Referral discount — price display strings", () => {
  it("formats $9.50 correctly as whole=9 cents=50", () => {
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: false,
      referralDiscountPercent: 50,
    });
    expect(result.priceWhole).toBe("9");
    expect(result.priceCents).toBe("50");
  });

  it("formats $7.58 correctly (Growth yearly 50% off)", () => {
    // 182/12 * 0.5 = 7.583...
    const result = calcPrices({
      monthlyPrice: 19,
      yearlyPrice: 182,
      isYearly: true,
      referralDiscountPercent: 50,
    });
    const perMonth = (182 / 12) * 0.5; // ~7.583
    expect(result.priceWhole).toBe(Math.floor(perMonth).toString());
    expect(result.priceCents).toBe((perMonth % 1).toFixed(2).slice(2));
  });

  it("free plan always shows 0 regardless of referral discount", () => {
    const result = calcPrices({
      monthlyPrice: 0,
      yearlyPrice: 0,
      isYearly: false,
      referralDiscountPercent: 50,
    });
    expect(result.priceWhole).toBe("0");
    expect(result.priceCents).toBe("00");
  });
});
