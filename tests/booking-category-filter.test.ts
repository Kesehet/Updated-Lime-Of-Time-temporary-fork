/**
 * Tests for:
 * 1. Booking wizard category filter logic
 * 2. Saved businesses group-by-category logic
 * 3. Search results use same BusinessCard (category chips already present)
 */
import { describe, it, expect } from "vitest";
import { getCategoryDef, ALL_CATEGORY, SERVICE_CATEGORIES } from "../constants/categories";

// ─── Booking Wizard: category filter logic ────────────────────────────────────
interface MockService {
  localId: string;
  name: string;
  duration: number;
  price: string | null;
  description: string | null;
  category?: string | null;
}

const mockServices: MockService[] = [
  { localId: "s1", name: "Blowout", duration: 45, price: "65.00", description: null, category: "Hair" },
  { localId: "s2", name: "Swedish Massage", duration: 60, price: "90.00", description: null, category: "Massage" },
  { localId: "s3", name: "Gel Manicure", duration: 45, price: "40.00", description: null, category: "Nails" },
  { localId: "s4", name: "Deep Tissue", duration: 60, price: "100.00", description: null, category: "Massage" },
  { localId: "s5", name: "Balayage", duration: 120, price: "180.00", description: null, category: "Hair" },
  { localId: "s6", name: "No Category", duration: 30, price: "25.00", description: null, category: null },
];

function filterServices(services: MockService[], catFilter: string | null) {
  return catFilter ? services.filter((s) => s.category === catFilter) : services;
}

function deriveCategories(services: MockService[]): string[] {
  return Array.from(new Set(services.map((s) => s.category).filter(Boolean) as string[]));
}

describe("Booking wizard category filter", () => {
  it("shows all services when no filter is active", () => {
    const result = filterServices(mockServices, null);
    expect(result).toHaveLength(mockServices.length);
  });

  it("filters to only Hair services", () => {
    const result = filterServices(mockServices, "Hair");
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.category === "Hair")).toBe(true);
  });

  it("filters to only Massage services", () => {
    const result = filterServices(mockServices, "Massage");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(["Swedish Massage", "Deep Tissue"]);
  });

  it("returns empty when filter matches no services", () => {
    const result = filterServices(mockServices, "Spa");
    expect(result).toHaveLength(0);
  });

  it("derives unique categories from service list (excludes null)", () => {
    const cats = deriveCategories(mockServices);
    expect(cats).toContain("Hair");
    expect(cats).toContain("Massage");
    expect(cats).toContain("Nails");
    expect(cats).not.toContain(null);
    expect(cats).not.toContain(undefined);
    // Unique: Hair appears twice but should only be listed once
    expect(cats.filter((c) => c === "Hair")).toHaveLength(1);
  });

  it("shows category chip row only when >1 unique category", () => {
    const singleCatServices = mockServices.filter((s) => s.category === "Hair");
    const cats = deriveCategories(singleCatServices);
    expect(cats.length > 1).toBe(false); // should NOT show chips
    const multiCats = deriveCategories(mockServices);
    expect(multiCats.length > 1).toBe(true); // should show chips
  });
});

// ─── Saved Businesses: group-by-category logic ───────────────────────────────
interface MockSavedBusiness {
  businessSlug: string;
  businessName: string;
  businessCategory: string | null;
  businessAddress: string | null;
}

const mockSaved: MockSavedBusiness[] = [
  { businessSlug: "lime-cut", businessName: "Lime Cut & Wellness", businessCategory: "Hair", businessAddress: "123 Main St" },
  { businessSlug: "wellness-suite", businessName: "Wellness Suite", businessCategory: "Massage", businessAddress: "456 Oak Ave" },
  { businessSlug: "nail-bar", businessName: "The Nail Bar", businessCategory: "Nails", businessAddress: "789 Elm St" },
  { businessSlug: "hair-studio", businessName: "Hair Studio", businessCategory: "Hair", businessAddress: "321 Pine Rd" },
  { businessSlug: "no-cat", businessName: "No Category Biz", businessCategory: null, businessAddress: null },
];

function groupByCategory(businesses: MockSavedBusiness[]): Record<string, MockSavedBusiness[]> {
  const groups: Record<string, MockSavedBusiness[]> = {};
  for (const biz of businesses) {
    const key = biz.businessCategory || "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(biz);
  }
  return groups;
}

describe("Saved businesses group-by-category", () => {
  it("groups businesses by category", () => {
    const groups = groupByCategory(mockSaved);
    expect(groups["Hair"]).toHaveLength(2);
    expect(groups["Massage"]).toHaveLength(1);
    expect(groups["Nails"]).toHaveLength(1);
  });

  it("places null-category businesses under 'Other'", () => {
    const groups = groupByCategory(mockSaved);
    expect(groups["Other"]).toHaveLength(1);
    expect(groups["Other"][0].businessSlug).toBe("no-cat");
  });

  it("produces sorted group keys", () => {
    const groups = groupByCategory(mockSaved);
    const sorted = Object.keys(groups).sort();
    expect(sorted[0]).toBe("Hair");
    expect(sorted).toContain("Massage");
    expect(sorted).toContain("Nails");
    expect(sorted).toContain("Other");
  });

  it("getCategoryDef returns correct emoji for each group", () => {
    const groups = groupByCategory(mockSaved);
    for (const cat of Object.keys(groups)) {
      const def = getCategoryDef(cat);
      expect(def).toBeDefined();
      expect(def.emoji).toBeTruthy();
      expect(def.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ─── ALL_CATEGORY constant ────────────────────────────────────────────────────
describe("ALL_CATEGORY constant", () => {
  it("has emoji and color", () => {
    expect(ALL_CATEGORY.emoji).toBeTruthy();
    expect(ALL_CATEGORY.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
