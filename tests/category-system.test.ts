/**
 * Tests for the category system:
 * 1. SERVICE_CATEGORIES constant completeness
 * 2. getCategoryDef fallback for custom/unknown categories
 * 3. Discovery filter logic (serviceCategories matching)
 */
import { describe, it, expect } from "vitest";
import { SERVICE_CATEGORIES, ALL_CATEGORY, getCategoryDef, CATEGORY_MAP } from "../constants/categories";

describe("SERVICE_CATEGORIES", () => {
  it("includes all required standard categories", () => {
    const labels = SERVICE_CATEGORIES.map((c) => c.label);
    expect(labels).toContain("Hair");
    expect(labels).toContain("Nails");
    expect(labels).toContain("Massage");
    expect(labels).toContain("Skincare");
    expect(labels).toContain("Waxing & Brows");
    expect(labels).toContain("Lashes");
    expect(labels).toContain("Makeup");
    expect(labels).toContain("Barbering");
    expect(labels).toContain("Spa");
    expect(labels).toContain("Fitness");
    expect(labels).toContain("Tattoo & Piercing");
    expect(labels).toContain("Teeth Whitening");
    expect(labels).toContain("Tanning");
    expect(labels).toContain("Holistic");
    expect(labels).toContain("Other");
  });

  it("every category has emoji, icon, and color", () => {
    for (const cat of SERVICE_CATEGORIES) {
      expect(cat.emoji, `${cat.label} missing emoji`).toBeTruthy();
      expect(cat.icon, `${cat.label} missing icon`).toBeTruthy();
      expect(cat.color, `${cat.label} missing color`).toBeTruthy();
    }
  });

  it("ALL_CATEGORY is defined with label 'All'", () => {
    expect(ALL_CATEGORY.label).toBe("All");
    expect(ALL_CATEGORY.emoji).toBeTruthy();
  });
});

describe("getCategoryDef", () => {
  it("returns correct def for known category", () => {
    const def = getCategoryDef("Hair");
    expect(def.label).toBe("Hair");
    expect(def.emoji).toBe("✂️");
  });

  it("returns Other def for null input", () => {
    const def = getCategoryDef(null);
    expect(def.label).toBe("Other");
  });

  it("returns Other def for undefined input", () => {
    const def = getCategoryDef(undefined);
    expect(def.label).toBe("Other");
  });

  it("returns Other def for unknown category label (non-standard labels normalize to Other)", () => {
    const def = getCategoryDef("Lash Extensions");
    expect(def.label).toBe("Other"); // unknown labels fall back to Other
    expect(def.emoji).toBe("✦"); // Other emoji
  });
});

describe("Discovery category filter logic", () => {
  // Simulate the server-side filter logic
  function matchesCategory(
    category: string,
    bizCategory: string | null,
    serviceCategories: string[]
  ): boolean {
    const filterCat = category.toLowerCase();
    const bizCat = (bizCategory ?? "").toLowerCase();
    const svcCats = serviceCategories.map((c) => c.toLowerCase());

    if (filterCat === "other") {
      // Match businesses that have at least one service category normalized to "Other"
      // OR have no category at all
      const hasOtherSvc = svcCats.some((c) => c === "other");
      const hasNoCat = !bizCat && svcCats.length === 0;
      return hasOtherSvc || hasNoCat;
    } else {
      const bizCatMatch = bizCat && (bizCat.includes(filterCat) || filterCat.includes(bizCat));
      const svcCatMatch = svcCats.some(
        (c) => c && (c.includes(filterCat) || filterCat.includes(c))
      );
      return !!(bizCatMatch || svcCatMatch);
    }
  }

  it("matches business by businessCategory", () => {
    expect(matchesCategory("Hair", "Hair", [])).toBe(true);
    expect(matchesCategory("Spa", "Hair", [])).toBe(false);
  });

  it("matches business by serviceCategories even if businessCategory differs", () => {
    // Lime Cut & Wellness: bizCat=Hair, svcCats=[Hair, Nails, Skincare, Massage, Waxing & Brows]
    expect(matchesCategory("Massage", "Hair", ["Hair", "Nails", "Skincare", "Massage", "Waxing & Brows"])).toBe(true);
    expect(matchesCategory("Nails", "Hair", ["Hair", "Nails", "Skincare", "Massage", "Waxing & Brows"])).toBe(true);
    expect(matchesCategory("Skincare", "Hair", ["Hair", "Nails", "Skincare", "Massage", "Waxing & Brows"])).toBe(true);
  });

  it("does not match when neither bizCat nor svcCats match", () => {
    expect(matchesCategory("Fitness", "Hair", ["Hair", "Nails", "Massage"])).toBe(false);
  });

  it("Other filter matches businesses with no category", () => {
    expect(matchesCategory("Other", null, [])).toBe(true);
    expect(matchesCategory("Other", "", [])).toBe(true);
  });

  it("Other filter matches businesses with Other service categories (Wellness Suite case)", () => {
    // Wellness Suite: bizCat=Spa, svcCats=[Other] — should appear under Other chip
    expect(matchesCategory("Other", "Spa", ["other"])).toBe(true);
    // Lime Cut & Wellness: all standard svcCats — should NOT appear under Other
    expect(matchesCategory("Other", "Hair", ["hair", "nails", "massage"])).toBe(false);
  });

  it("custom category matches correctly", () => {
    // A business with a custom "Lash Extensions" service category
    expect(matchesCategory("Lash Extensions", null, ["Lash Extensions"])).toBe(true);
    expect(matchesCategory("Lash Extensions", "Lash Extensions", [])).toBe(true);
    expect(matchesCategory("Hair", null, ["Lash Extensions"])).toBe(false);
  });
});
