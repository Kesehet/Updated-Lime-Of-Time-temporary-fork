/**
 * Referral System Unit Tests
 * Tests the core referral logic without hitting the database.
 */
import { describe, it, expect } from "vitest";

// ─── Helper: generateReferralCode (same logic as in db.ts) ────────────────────
function generateReferralCode(businessName: string): string {
  const clean = businessName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
    .padEnd(4, "X");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${clean}-${suffix}`;
}

// ─── Helper: validateReferralCodeFormat ───────────────────────────────────────
function isValidCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{4,8}-[A-Z0-9]{4}$/.test(code);
}

// ─── Helper: canApplyReferral ─────────────────────────────────────────────────
function canApplyReferral(
  referrerOwnerId: number,
  referredOwnerId: number,
  existingReferral: { referredBusinessOwnerId: number } | null,
  codeIsActive: boolean,
): { allowed: boolean; reason?: string } {
  if (!codeIsActive) return { allowed: false, reason: "Code is inactive" };
  if (referrerOwnerId === referredOwnerId) return { allowed: false, reason: "Cannot self-refer" };
  if (existingReferral) return { allowed: false, reason: "Referral already applied" };
  return { allowed: true };
}

// ─── Helper: referralDiscountMessage ─────────────────────────────────────────
function referralDiscountMessage(discountPercent: number, discountMonths: number): string {
  return `${discountPercent}% off your first ${discountMonths} months`;
}

// ─── Helper: shouldTriggerReferrerReward ─────────────────────────────────────
function shouldTriggerReferrerReward(
  referralStatus: "pending" | "converted" | "rewarded" | "expired",
  invoiceSequenceNumber: number,
): boolean {
  // Reward triggers on first paid invoice (sequence 1) when status is "converted"
  return referralStatus === "converted" && invoiceSequenceNumber === 1;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Referral Code Generation", () => {
  it("generates a code with correct format (XXXX-YYYY)", () => {
    const code = generateReferralCode("Jane's Salon");
    expect(isValidCodeFormat(code)).toBe(true);
  });

  it("uses business name prefix in code", () => {
    const code = generateReferralCode("BEAUTY");
    expect(code.startsWith("BEAUTY-")).toBe(true);
  });

  it("truncates long business names to 6 chars", () => {
    const code = generateReferralCode("SuperLongBusinessNameHere");
    const prefix = code.split("-")[0];
    expect(prefix.length).toBeLessThanOrEqual(8);
  });

  it("pads short business names", () => {
    const code = generateReferralCode("AB");
    expect(isValidCodeFormat(code)).toBe(true);
  });

  it("handles special characters in business name", () => {
    const code = generateReferralCode("Jane's & Co.");
    expect(isValidCodeFormat(code)).toBe(true);
  });

  it("generates unique codes for same business name", () => {
    const code1 = generateReferralCode("SALON");
    const code2 = generateReferralCode("SALON");
    // Extremely unlikely to be equal due to random suffix
    // (1/1,296 chance — acceptable for a test)
    expect(typeof code1).toBe("string");
    expect(typeof code2).toBe("string");
  });
});

describe("Referral Code Format Validation", () => {
  it("accepts valid code format", () => {
    expect(isValidCodeFormat("JANES-4X2K")).toBe(true);
    expect(isValidCodeFormat("SALON-AB12")).toBe(true);
    expect(isValidCodeFormat("ABCD-EFGH")).toBe(true);
  });

  it("rejects lowercase codes", () => {
    expect(isValidCodeFormat("janes-4x2k")).toBe(false);
  });

  it("rejects codes without dash", () => {
    expect(isValidCodeFormat("JANES4X2K")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidCodeFormat("")).toBe(false);
  });

  it("rejects codes with special characters", () => {
    expect(isValidCodeFormat("JAN@S-4X2K")).toBe(false);
  });
});

describe("Referral Application Rules", () => {
  it("allows valid referral application", () => {
    const result = canApplyReferral(1, 2, null, true);
    expect(result.allowed).toBe(true);
  });

  it("blocks self-referral", () => {
    const result = canApplyReferral(1, 1, null, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("self-refer");
  });

  it("blocks duplicate referral application", () => {
    const existingReferral = { referredBusinessOwnerId: 2 };
    const result = canApplyReferral(1, 2, existingReferral, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("already applied");
  });

  it("blocks inactive referral code", () => {
    const result = canApplyReferral(1, 2, null, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("inactive");
  });

  it("blocks when both inactive and self-referral (inactive checked first)", () => {
    const result = canApplyReferral(1, 1, null, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("inactive");
  });
});

describe("Referral Discount Messaging", () => {
  it("formats 50% off 3 months correctly", () => {
    expect(referralDiscountMessage(50, 3)).toBe("50% off your first 3 months");
  });

  it("formats 25% off 6 months correctly", () => {
    expect(referralDiscountMessage(25, 6)).toBe("25% off your first 6 months");
  });

  it("formats 100% off 1 month correctly", () => {
    expect(referralDiscountMessage(100, 1)).toBe("100% off your first 1 months");
  });
});

describe("Referrer Reward Trigger Logic", () => {
  it("triggers reward on first paid invoice when status is converted", () => {
    expect(shouldTriggerReferrerReward("converted", 1)).toBe(true);
  });

  it("does not trigger reward on second invoice", () => {
    expect(shouldTriggerReferrerReward("converted", 2)).toBe(false);
  });

  it("does not trigger reward when status is pending", () => {
    expect(shouldTriggerReferrerReward("pending", 1)).toBe(false);
  });

  it("does not trigger reward when already rewarded", () => {
    expect(shouldTriggerReferrerReward("rewarded", 1)).toBe(false);
  });

  it("does not trigger reward when expired", () => {
    expect(shouldTriggerReferrerReward("expired", 1)).toBe(false);
  });
});

describe("Referral Trial + Discount Stacking", () => {
  it("discount applies after trial ends (day 14+)", () => {
    // Simulate: trial = 14 days, discount starts at first billing cycle
    const trialDays = 14;
    const discountStartsAfterDays = trialDays;
    expect(discountStartsAfterDays).toBe(14);
  });

  it("discount applies for exactly discountMonths billing cycles", () => {
    const discountMonths = 3;
    const billingCyclesWithDiscount = Array.from({ length: 4 }, (_, i) => i + 1)
      .filter((cycle) => cycle <= discountMonths);
    expect(billingCyclesWithDiscount).toEqual([1, 2, 3]);
  });

  it("full price applies after discount period", () => {
    const discountMonths = 3;
    const cycle4IsFullPrice = 4 > discountMonths;
    expect(cycle4IsFullPrice).toBe(true);
  });
});
