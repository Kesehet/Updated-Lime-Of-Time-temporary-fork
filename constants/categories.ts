/**
 * Shared category definitions used across:
 *  - service-form.tsx (picker grid)
 *  - discover.tsx (filter chips)
 *  - settings.tsx (business category picker)
 *  - clientRoutes.ts (server-side category filtering)
 *
 * Each CategoryDef has:
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

/** Full list of standard in-store service categories. */
export const SERVICE_CATEGORIES: CategoryDef[] = [
  { label: "Hair",                emoji: "✂️",  icon: "scissors",                              color: "#8FBF6A" },
  { label: "Nails",               emoji: "💅",  icon: "paintbrush.fill",                       color: "#F9A8D4" },
  { label: "Skincare",            emoji: "✨",  icon: "sparkles",                              color: "#FCD34D" },
  { label: "Massage",             emoji: "💆",  icon: "hand.raised.fill",                      color: "#6EE7B7" },
  { label: "Waxing & Brows",      emoji: "🪮",  icon: "eyebrow",                               color: "#FDBA74" },
  { label: "Lashes",              emoji: "👁️",  icon: "eye.fill",                              color: "#C4B5FD" },
  { label: "Makeup",              emoji: "💄",  icon: "paintpalette.fill",                     color: "#FCA5A5" },
  { label: "Barbering",           emoji: "💈",  icon: "comb.fill",                             color: "#86EFAC" },
  { label: "Spa",                 emoji: "🧖",  icon: "drop.fill",                             color: "#A5F3FC" },
  { label: "Fitness",             emoji: "🏋️",  icon: "figure.strengthtraining.traditional",   color: "#93C5FD" },
  { label: "Yoga & Pilates",      emoji: "🧘",  icon: "figure.mind.and.body",                  color: "#4ADE80" },
  { label: "Personal Training",   emoji: "🏃",  icon: "figure.run",                            color: "#60A5FA" },
  { label: "Tattoo & Piercing",   emoji: "🎨",  icon: "pencil.tip",                            color: "#FB923C" },
  { label: "Teeth Whitening",     emoji: "🦷",  icon: "mouth.fill",                            color: "#67E8F9" },
  { label: "Tanning",             emoji: "☀️",  icon: "sun.max.fill",                          color: "#FDE68A" },
  { label: "Holistic",            emoji: "🌿",  icon: "leaf.fill",                             color: "#4ADE80" },
  { label: "Acupuncture",         emoji: "🪡",  icon: "cross.fill",                            color: "#A78BFA" },
  { label: "Chiropractic",        emoji: "🦴",  icon: "figure.walk",                           color: "#FCA5A5" },
  { label: "Physical Therapy",    emoji: "🩺",  icon: "stethoscope",                           color: "#6EE7B7" },
  { label: "Mental Health",       emoji: "🧠",  icon: "brain.head.profile",                    color: "#C4B5FD" },
  { label: "Nutrition",           emoji: "🥗",  icon: "fork.knife",                            color: "#86EFAC" },
  { label: "Medical",             emoji: "🏥",  icon: "cross.case.fill",                       color: "#F87171" },
  { label: "Dental",              emoji: "😁",  icon: "mouth.fill",                            color: "#67E8F9" },
  { label: "Pet Grooming",        emoji: "🐾",  icon: "pawprint.fill",                         color: "#FDBA74" },
  { label: "Photography",         emoji: "📸",  icon: "camera.fill",                           color: "#93C5FD" },
  { label: "Spray Tan",           emoji: "🌅",  icon: "sun.horizon.fill",                      color: "#FDE68A" },
  { label: "Microblading",        emoji: "🖊️",  icon: "pencil",                                color: "#F9A8D4" },
  { label: "IV Therapy",          emoji: "💉",  icon: "syringe.fill",                          color: "#A5F3FC" },
  { label: "Other",               emoji: "✦",   icon: "ellipsis.circle.fill",                  color: "#9CA3AF" },
];

/** Full list of standard mobile / traveling service categories. */
export const MOBILE_SERVICE_CATEGORIES: CategoryDef[] = [
  { label: "Mobile Hair",              emoji: "✂️",  icon: "scissors",                              color: "#8FBF6A" },
  { label: "Mobile Nails",             emoji: "💅",  icon: "paintbrush.fill",                       color: "#F9A8D4" },
  { label: "Mobile Massage",           emoji: "💆",  icon: "hand.raised.fill",                      color: "#6EE7B7" },
  { label: "Mobile Makeup",            emoji: "💄",  icon: "paintpalette.fill",                     color: "#FCA5A5" },
  { label: "Mobile Skincare",          emoji: "✨",  icon: "sparkles",                              color: "#FCD34D" },
  { label: "Mobile Lashes",            emoji: "👁️",  icon: "eye.fill",                              color: "#C4B5FD" },
  { label: "Mobile Waxing",            emoji: "🪮",  icon: "eyebrow",                               color: "#FDBA74" },
  { label: "Mobile Barbering",         emoji: "💈",  icon: "comb.fill",                             color: "#86EFAC" },
  { label: "Mobile Spray Tan",         emoji: "☀️",  icon: "sun.max.fill",                          color: "#FDE68A" },
  { label: "Mobile Personal Training", emoji: "🏋️",  icon: "figure.strengthtraining.traditional",   color: "#93C5FD" },
  { label: "Mobile Yoga",              emoji: "🧘",  icon: "figure.mind.and.body",                  color: "#4ADE80" },
  { label: "Mobile Pet Grooming",      emoji: "🐾",  icon: "pawprint.fill",                         color: "#FDBA74" },
  { label: "Mobile Photography",       emoji: "📸",  icon: "camera.fill",                           color: "#93C5FD" },
  { label: "Car Detailing",            emoji: "🚗",  icon: "car.fill",                              color: "#60A5FA" },
  { label: "Mobile Medical",           emoji: "🩺",  icon: "stethoscope",                           color: "#F87171" },
  { label: "Mobile IV Therapy",        emoji: "💉",  icon: "syringe.fill",                          color: "#A5F3FC" },
  { label: "Mobile Nutrition",         emoji: "🥗",  icon: "fork.knife",                            color: "#86EFAC" },
  { label: "Mobile Hair & Makeup",     emoji: "🌟",  icon: "star.fill",                             color: "#FCA5A5" },
  { label: "Other Mobile",             emoji: "🚐",  icon: "car.side.fill",                         color: "#9CA3AF" },
];

/** The "All" chip shown at the start of the filter row. */
export const ALL_CATEGORY: CategoryDef = {
  label: "All",
  emoji: "🔍",
  icon: "magnifyingglass",
  color: "#8FBF6A",
};

/**
 * Default CategoryDef used for custom/unknown labels.
 * Custom categories get a generic tag icon and neutral purple color.
 */
export const CUSTOM_CATEGORY_DEFAULT: CategoryDef = {
  label: "Custom",
  emoji: "🏷️",
  icon: "tag.fill",
  color: "#8B5CF6",
};

/** Quick lookup: label → CategoryDef (in-store + mobile + All) */
export const CATEGORY_MAP: Record<string, CategoryDef> = Object.fromEntries(
  [...SERVICE_CATEGORIES, ...MOBILE_SERVICE_CATEGORIES, ALL_CATEGORY].map((c) => [c.label, c])
);

/**
 * Set of all standard category labels (lowercase) for quick membership checks.
 * Includes both in-store and mobile standard categories.
 */
export const STANDARD_LABELS: Set<string> = new Set(
  [...SERVICE_CATEGORIES, ...MOBILE_SERVICE_CATEGORIES].map((c) => c.label.toLowerCase())
);

/**
 * Set of all standard mobile category labels (lowercase).
 */
export const MOBILE_LABELS: Set<string> = new Set(
  MOBILE_SERVICE_CATEGORIES.map((c) => c.label.toLowerCase())
);

/**
 * Returns the CategoryDef for a given label.
 * For standard labels: returns the matching def.
 * For custom/unknown labels: returns a generic def with the custom label preserved.
 */
export function getCategoryDef(label: string | null | undefined): CategoryDef {
  if (!label) return CATEGORY_MAP["Other"] ?? CUSTOM_CATEGORY_DEFAULT;
  return CATEGORY_MAP[label] ?? { ...CUSTOM_CATEGORY_DEFAULT, label };
}

/**
 * Normalizes a raw service category string.
 * Standard labels are returned with proper casing.
 * Custom/unknown labels are returned AS-IS (not collapsed to "Other").
 * This allows custom categories to appear as their own chips in the client portal.
 */
export function normalizeCategory(label: string | null | undefined): string {
  if (!label) return "Other";
  const trimmed = label.trim();
  if (!trimmed) return "Other";
  const lower = trimmed.toLowerCase();
  if (STANDARD_LABELS.has(lower)) {
    const found = [...SERVICE_CATEGORIES, ...MOBILE_SERVICE_CATEGORIES].find(
      (c) => c.label.toLowerCase() === lower
    );
    return found ? found.label : trimmed;
  }
  // Custom label — return as-is so it appears as its own category in the client portal
  return trimmed;
}

/**
 * Returns true if the given category label belongs to the mobile category list.
 */
export function isMobileCategory(label: string | null | undefined): boolean {
  if (!label) return false;
  return MOBILE_LABELS.has(label.trim().toLowerCase());
}
