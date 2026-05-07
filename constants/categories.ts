/**
 * Shared category definitions used across:
 * - Business service form (category picker)
 * - Discovery filter chips
 * - Business card category chips
 *
 * Each entry has:
 *   label   — canonical display name (stored in DB as service.category)
 *   emoji   — emoji icon for filter chips and cards
 *   icon    — SF Symbol name for the picker grid
 *   color   — accent color for dark backgrounds
 */

export interface CategoryDef {
  label: string;
  emoji: string;
  icon: string;
  color: string;
}

/** Ordered list of standard service categories. */
export const SERVICE_CATEGORIES: CategoryDef[] = [
  { label: "Hair",              emoji: "✂️",  icon: "scissors",                    color: "#8FBF6A" },
  { label: "Nails",             emoji: "💅",  icon: "paintbrush.fill",             color: "#F9A8D4" },
  { label: "Skincare",          emoji: "✨",  icon: "sparkles",                    color: "#FCD34D" },
  { label: "Massage",           emoji: "💆",  icon: "hand.raised.fill",            color: "#6EE7B7" },
  { label: "Waxing & Brows",    emoji: "🪮",  icon: "eyebrow",                     color: "#FDBA74" },
  { label: "Lashes",            emoji: "👁️",  icon: "eye.fill",                    color: "#C4B5FD" },
  { label: "Makeup",            emoji: "💄",  icon: "paintpalette.fill",           color: "#FCA5A5" },
  { label: "Barbering",         emoji: "💈",  icon: "comb.fill",                   color: "#86EFAC" },
  { label: "Spa",               emoji: "🧖",  icon: "drop.fill",                   color: "#A5F3FC" },
  { label: "Fitness",           emoji: "🏋️",  icon: "figure.strengthtraining.traditional", color: "#93C5FD" },
  { label: "Tattoo & Piercing", emoji: "🎨",  icon: "pencil.tip",                  color: "#FB923C" },
  { label: "Teeth Whitening",   emoji: "🦷",  icon: "mouth.fill",                  color: "#67E8F9" },
  { label: "Tanning",           emoji: "☀️",  icon: "sun.max.fill",                color: "#FDE68A" },
  { label: "Holistic",          emoji: "🌿",  icon: "leaf.fill",                   color: "#4ADE80" },
  { label: "Other",             emoji: "📍",  icon: "ellipsis.circle.fill",        color: "#9CA3AF" },
];

/** The "All" chip shown at the start of the filter row. */
export const ALL_CATEGORY: CategoryDef = {
  label: "All",
  emoji: "🔍",
  icon: "magnifyingglass",
  color: "#8FBF6A",
};

/** Quick lookup: label → CategoryDef */
export const CATEGORY_MAP: Record<string, CategoryDef> = Object.fromEntries(
  [...SERVICE_CATEGORIES, ALL_CATEGORY].map((c) => [c.label, c])
);

/** Returns the CategoryDef for a given label, falling back to "Other". */
export function getCategoryDef(label: string | null | undefined): CategoryDef {
  if (!label) return CATEGORY_MAP["Other"];
  return CATEGORY_MAP[label] ?? {
    label,
    emoji: "📍",
    icon: "ellipsis.circle.fill",
    color: "#9CA3AF",
  };
}
