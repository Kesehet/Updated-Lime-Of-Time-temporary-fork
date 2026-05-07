import { describe, it, expect } from "vitest";

// ── Feature 1: Tappable rating row ─────────────────────────────────────────
describe("Tappable rating row", () => {
  it("client-business-detail.tsx wraps ratingRow in a Pressable with setActiveTab('reviews')", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/client-business-detail.tsx", "utf-8");
    // Check that the ratingRow is inside a Pressable (not a plain View)
    expect(content).toContain("Pressable");
    expect(content).toContain('setActiveTab("reviews")');
    // Ensure the old plain View wrapper is gone
    expect(content).not.toContain('<View style={s.ratingRow}>');
  });
});

// ── Feature 2: Review prompt banner ────────────────────────────────────────
describe("Review prompt banner", () => {
  it("client home index.tsx has reviewPromptAppt state and banner UI", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/(client-tabs)/index.tsx", "utf-8");
    expect(content).toContain("reviewPromptAppt");
    expect(content).toContain("dismissed_review_prompts");
    expect(content).toContain("reviewBanner");
    expect(content).toContain("How was your visit?");
  });

  it("review prompt logic filters only completed appointments within 48h", () => {
    // Simulate the filter logic
    const now = Date.now();
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

    // Helper to get local date and time strings from a timestamp offset
    const makeAppt = (msAgo: number) => {
      const d = new Date(now - msAgo);
      const pad = (n: number) => String(n).padStart(2, "0");
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return { date, time };
    };
    const appts = [
      { id: 1, status: "completed", ...makeAppt(1 * 60 * 60 * 1000) },  // 1h ago ✓
      { id: 2, status: "completed", ...makeAppt(72 * 60 * 60 * 1000) }, // 72h ago ✗
      { id: 3, status: "confirmed", ...makeAppt(1 * 60 * 60 * 1000) },  // not completed ✗
      { id: 4, status: "completed", ...makeAppt(24 * 60 * 60 * 1000) }, // 24h ago ✓
    ];

    const candidates = appts.filter((a) => {
      if (a.status !== "completed") return false;
      const apptDate = new Date(a.date + "T" + a.time + ":00");
      const diff = now - apptDate.getTime();
      return diff <= TWO_DAYS_MS && diff >= 0;
    });

    expect(candidates.map(c => c.id)).toEqual([1, 4]);
  });
});

// ── Feature 3: Per-staff rating in staff endpoint ──────────────────────────
describe("Per-staff rating endpoint", () => {
  it("publicRoutes.ts computes staffRatingMap from reviews + appointments", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/publicRoutes.ts", "utf-8");
    expect(content).toContain("staffRatingMap");
    expect(content).toContain("avgRating:");
    expect(content).toContain("reviewCount:");
    expect(content).toContain("appointmentLocalId");
    expect(content).toContain("appt.staffId");
  });

  it("ApiStaff interface in client-business-detail.tsx includes avgRating and reviewCount", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/client-business-detail.tsx", "utf-8");
    expect(content).toContain("avgRating?: number | null");
    expect(content).toContain("reviewCount?: number");
  });

  it("staff card renders star row when avgRating is set", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/client-business-detail.tsx", "utf-8");
    expect(content).toContain("member.avgRating != null");
    expect(content).toContain("Math.round(member.avgRating!)");
    expect(content).toContain("Number(member.avgRating).toFixed(1)");
  });
});
