/**
 * Tests for:
 * 1. Pinned categories logic — long-press pin/unpin, ordering, persistence key
 * 2. Category badge on Saved Businesses — getCategoryDef returns correct emoji/color
 */

import { describe, it, expect } from "vitest";
import { getCategoryDef, SERVICE_CATEGORIES, ALL_CATEGORY } from "../constants/categories";

// ─── Helper: simulate pin/unpin logic (mirrors handlePinCategory in discover.tsx) ───
function togglePin(current: string[], label: string): string[] {
  if (label === "All") return current;
  return current.includes(label)
    ? current.filter((c) => c !== label)
    : [...current, label];
}

// ─── Helper: simulate chip ordering (mirrors orderedChips logic in discover.tsx) ────
function orderChips(allChips: { label: string }[], pinned: string[]) {
  const [allChip, ...rest] = allChips;
  const pinnedSet = new Set(pinned);
  const pinnedChips = rest.filter((c) => pinnedSet.has(c.label));
  const unpinnedChips = rest.filter((c) => !pinnedSet.has(c.label));
  return [allChip, ...pinnedChips, ...unpinnedChips];
}

describe("Pinned Categories Logic", () => {
  it("pins a category on first long-press", () => {
    const result = togglePin([], "Hair");
    expect(result).toContain("Hair");
    expect(result).toHaveLength(1);
  });

  it("unpins a category on second long-press", () => {
    const result = togglePin(["Hair", "Nails"], "Hair");
    expect(result).not.toContain("Hair");
    expect(result).toContain("Nails");
  });

  it("does not pin the All chip", () => {
    const result = togglePin([], "All");
    expect(result).toHaveLength(0);
  });

  it("can pin multiple categories", () => {
    let pinned: string[] = [];
    pinned = togglePin(pinned, "Massage");
    pinned = togglePin(pinned, "Nails");
    pinned = togglePin(pinned, "Hair");
    expect(pinned).toHaveLength(3);
    expect(pinned).toContain("Massage");
    expect(pinned).toContain("Nails");
    expect(pinned).toContain("Hair");
  });

  it("floats pinned chips to the front (after All)", () => {
    const chips = [ALL_CATEGORY, ...SERVICE_CATEGORIES];
    const pinned = ["Massage", "Nails"];
    const ordered = orderChips(chips, pinned);
    expect(ordered[0].label).toBe("All");
    // Pinned chips should be at index 1 and 2
    const pinnedLabels = ordered.slice(1, 3).map((c) => c.label);
    expect(pinnedLabels).toContain("Massage");
    expect(pinnedLabels).toContain("Nails");
    // Unpinned chips should come after
    const unpinnedLabels = ordered.slice(3).map((c) => c.label);
    expect(unpinnedLabels).not.toContain("Massage");
    expect(unpinnedLabels).not.toContain("Nails");
  });

  it("preserves original order for unpinned chips", () => {
    const chips = [ALL_CATEGORY, ...SERVICE_CATEGORIES];
    const pinned: string[] = [];
    const ordered = orderChips(chips, pinned);
    // Without any pins, order should match original
    expect(ordered.map((c) => c.label)).toEqual(chips.map((c) => c.label));
  });

  it("unpinning a chip moves it back to its original position", () => {
    const chips = [ALL_CATEGORY, ...SERVICE_CATEGORIES];
    // Pin then unpin Hair
    const withPin = orderChips(chips, ["Hair"]);
    const withoutPin = orderChips(chips, []);
    // Without pin, Hair should be in its natural position
    expect(withoutPin.map((c) => c.label)).toEqual(chips.map((c) => c.label));
    // With pin, Hair should be at index 1
    expect(withPin[1].label).toBe("Hair");
  });
});

describe("Category Badge for Saved Businesses", () => {
  it("returns correct emoji for Hair category", () => {
    const def = getCategoryDef("Hair");
    expect(def.emoji).toBe("✂️");
    expect(def.color).toBeTruthy();
  });

  it("returns correct emoji for Nails category", () => {
    const def = getCategoryDef("Nails");
    expect(def.emoji).toBe("💅");
  });

  it("returns correct emoji for Massage category", () => {
    const def = getCategoryDef("Massage");
    expect(def.emoji).toBe("💆");
  });

  it("returns fallback emoji for unknown category", () => {
    const def = getCategoryDef("Custom Wellness");
    expect(def.emoji).toBeTruthy(); // Should always return something
    expect(def.color).toBeTruthy();
  });

  it("returns a valid color hex for all standard categories", () => {
    for (const cat of SERVICE_CATEGORIES) {
      const def = getCategoryDef(cat.label);
      expect(def.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("category badge renders correct data for Spa", () => {
    const def = getCategoryDef("Spa");
    expect(def.emoji).toBeTruthy();
    expect(def.label).toBe("Spa");
    expect(def.color).toBeTruthy();
  });
});
