/**
 * Tests for plan carousel logic — trial eligibility, CTA labels, centering math.
 */
import { describe, it, expect } from "vitest";

// ─── CTA Label Logic ──────────────────────────────────────────────────────────
function getCtaLabel(opts: {
  isCurrentPlan: boolean;
  isFree: boolean;
  isTrialEligible: boolean;
  isUpgrade: boolean;
  displayName: string;
}): string {
  const { isCurrentPlan, isFree, isTrialEligible, isUpgrade, displayName } = opts;
  if (isCurrentPlan) return "Current Plan";
  if (isFree) return "Continue with Free";
  if (isTrialEligible && !isFree) return "Start 14-Day Free Trial";
  if (isUpgrade) return "Upgrade to " + displayName;
  return "Switch to " + displayName;
}

// ─── Carousel Centering Math ──────────────────────────────────────────────────
function computeSidePad(availableWidth: number, slideWidth: number): number {
  return (availableWidth - slideWidth) / 2;
}

function computeSlideWidth(availableWidth: number): number {
  return Math.min(availableWidth - 40, 420);
}

// ─── Trial Eligibility ────────────────────────────────────────────────────────
function isTrialEligible(planInfo: {
  hasUsedTrial?: boolean;
  subscriptionStatus?: string;
} | null): boolean {
  if (!planInfo) return true; // No plan info = new user = eligible
  return (
    !planInfo.hasUsedTrial &&
    planInfo.subscriptionStatus !== "trial" &&
    planInfo.subscriptionStatus !== "active"
  );
}

describe("CTA Label Logic", () => {
  it("shows 'Current Plan' for the current plan", () => {
    expect(getCtaLabel({ isCurrentPlan: true, isFree: false, isTrialEligible: false, isUpgrade: false, displayName: "Growth" }))
      .toBe("Current Plan");
  });

  it("shows 'Continue with Free' for free plan", () => {
    expect(getCtaLabel({ isCurrentPlan: false, isFree: true, isTrialEligible: false, isUpgrade: false, displayName: "Solo" }))
      .toBe("Continue with Free");
  });

  it("shows '14-Day Free Trial' when trial eligible and not free", () => {
    expect(getCtaLabel({ isCurrentPlan: false, isFree: false, isTrialEligible: true, isUpgrade: true, displayName: "Growth" }))
      .toBe("Start 14-Day Free Trial");
  });

  it("shows 'Upgrade to X' when not trial eligible and upgrading", () => {
    expect(getCtaLabel({ isCurrentPlan: false, isFree: false, isTrialEligible: false, isUpgrade: true, displayName: "Studio" }))
      .toBe("Upgrade to Studio");
  });

  it("shows 'Switch to X' when not trial eligible and not upgrading", () => {
    expect(getCtaLabel({ isCurrentPlan: false, isFree: false, isTrialEligible: false, isUpgrade: false, displayName: "Growth" }))
      .toBe("Switch to Growth");
  });
});

describe("Carousel Centering Math", () => {
  it("centers a card on a 390px screen", () => {
    const w = 390;
    const slideW = computeSlideWidth(w); // 350
    const pad = computeSidePad(w, slideW); // 20
    expect(slideW).toBe(350);
    expect(pad).toBe(20);
  });

  it("caps slide width at 420px on wide screens", () => {
    const w = 800;
    const slideW = computeSlideWidth(w); // 420 (capped)
    expect(slideW).toBe(420);
  });

  it("centers on a 375px screen", () => {
    const w = 375;
    const slideW = computeSlideWidth(w); // 335
    const pad = computeSidePad(w, slideW); // 20
    expect(slideW).toBe(335);
    expect(pad).toBe(20);
  });
});

describe("Trial Eligibility", () => {
  it("is eligible for new users with no plan info", () => {
    expect(isTrialEligible(null)).toBe(true);
  });

  it("is eligible when hasUsedTrial is false and not active", () => {
    expect(isTrialEligible({ hasUsedTrial: false, subscriptionStatus: "free" })).toBe(true);
  });

  it("is NOT eligible when hasUsedTrial is true", () => {
    expect(isTrialEligible({ hasUsedTrial: true, subscriptionStatus: "free" })).toBe(false);
  });

  it("is NOT eligible when currently in trial", () => {
    expect(isTrialEligible({ hasUsedTrial: false, subscriptionStatus: "trial" })).toBe(false);
  });

  it("is NOT eligible when currently active", () => {
    expect(isTrialEligible({ hasUsedTrial: false, subscriptionStatus: "active" })).toBe(false);
  });
});
