/**
 * Client Portal — Discover Screen
 *
 * Browse businesses by category and distance.
 * Scrollable card list with search, category filter, and radius picker.
 */

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/use-colors";
import { useClientStore, DiscoverBusiness } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/constants/oauth";
import { SERVICE_CATEGORIES, ALL_CATEGORY, CATEGORY_MAP, getCategoryDef } from "@/constants/categories";

const DISCOVER_PREFS_KEY = "client_discover_prefs";
const PINNED_CATS_KEY = "client_pinned_categories";  // persisted list of pinned category labels
const RECENTLY_VIEWED_KEY = "client_recently_viewed_businesses"; // last 5 tapped businesses

// ─── Recently Viewed (tap-based) helpers ─────────────────────────────────────

interface RecentlyViewedBusiness {
  id: number;
  businessName: string;
  slug: string;
  customSlug: string | null;
  businessLogoUri: string | null;
  logoUrl: string | null;
  businessCategory: string | null;
  avgRating: number | null;
  reviewCount: number;
  distanceKm: number | null;
  viewedAt: number; // timestamp ms
}

async function trackRecentlyViewed(biz: DiscoverBusiness): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    const existing: RecentlyViewedBusiness[] = raw ? JSON.parse(raw) : [];
    // Remove previous entry for same business
    const filtered = existing.filter((b) => b.id !== biz.id);
    const entry: RecentlyViewedBusiness = {
      id: biz.id,
      businessName: biz.businessName,
      slug: biz.slug,
      customSlug: biz.customSlug,
      businessLogoUri: biz.businessLogoUri,
      logoUrl: biz.logoUrl,
      businessCategory: biz.businessCategory,
      avgRating: biz.avgRating,
      reviewCount: biz.reviewCount,
      distanceKm: biz.distanceKm,
      viewedAt: Date.now(),
    };
    // Prepend and keep only last 5
    const updated = [entry, ...filtered].slice(0, 5);
    await AsyncStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated));
  } catch { /* silent */ }
}

async function loadRecentlyViewed(): Promise<RecentlyViewedBusiness[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// CATEGORIES and CATEGORY_COLORS are derived from the shared constants/categories.ts
// This ensures the service form picker and discover filter chips always stay in sync.
const STANDARD_CATEGORIES = [ALL_CATEGORY, ...SERVICE_CATEGORIES];
// Radius options in miles
const RADIUS_OPTIONS = [5, 10, 25, 50, 100];
// Accent color lookup — falls back to getCategoryDef for unknowns
const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  STANDARD_CATEGORIES.map((c) => [c.label, c.color])
);
const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

function kmToMiles(km: number): number {
  return km * 0.621371;
}

/** Returns true only for http/https URIs (safe to render on any device). */
function isRemoteUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return uri.startsWith("http://") || uri.startsWith("https://");
}

// ─── Recently Viewed Section (tap-based) ────────────────────────────────────
function RecentlyViewedSection({ items, router, onClear }: { items: RecentlyViewedBusiness[]; router: ReturnType<typeof useRouter>; onClear: () => void }) {
  if (items.length === 0) return null;
  return (
    <View style={recentStyles.section}>
      <View style={recentStyles.header}>
        <Text style={[recentStyles.title, { color: TEXT_PRIMARY }]}>Recently Viewed</Text>
        <Pressable
          onPress={onClear}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, paddingHorizontal: 8, paddingVertical: 4 }]}
        >
          <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: "600" }}>Clear</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={recentStyles.row}
      >
        {items.map((biz) => {
          const accentColor = CATEGORY_COLORS[biz.businessCategory ?? "Other"] ?? GREEN_ACCENT;
          const emoji = getCategoryDef(biz.businessCategory).emoji;
          return (
            <Pressable
              key={biz.id}
              style={({ pressed }) => [
                recentStyles.card,
                { backgroundColor: CARD_BG, borderColor: CARD_BORDER },
                pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
              ]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/client-business-detail", params: { slug: biz.customSlug ?? biz.slug } } as any);
              }}
            >
              {/* Cover image */}
              <View style={[recentStyles.logoWrap, { backgroundColor: accentColor + "22" }]}>
                {isRemoteUri(biz.businessLogoUri) || isRemoteUri(biz.logoUrl) ? (
                  <Image source={{ uri: (biz.businessLogoUri && isRemoteUri(biz.businessLogoUri) ? biz.businessLogoUri : biz.logoUrl) ?? "" }} style={recentStyles.logoImage} />
                ) : (
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  <Image source={require("../../assets/images/icon.png")} style={recentStyles.logoImage} resizeMode="cover" />
                )}
              </View>
              {/* Card body */}
              <View style={recentStyles.cardBody}>
                <Text style={[recentStyles.name, { color: TEXT_PRIMARY }]} numberOfLines={1}>
                  {biz.businessName}
                </Text>
                {biz.businessCategory ? (
                  <View style={[recentStyles.categoryBadge, { backgroundColor: accentColor + "18", borderColor: accentColor + "40" }]}>
                    <Text style={{ fontSize: 10, lineHeight: 13 }}>{emoji}</Text>
                    <Text style={[recentStyles.categoryBadgeText, { color: accentColor }]} numberOfLines={1}>{biz.businessCategory}</Text>
                  </View>
                ) : null}
                {biz.avgRating != null ? (
                  <View style={recentStyles.ratingBadge}>
                    <Text style={recentStyles.ratingStar}>★</Text>
                    <Text style={recentStyles.ratingBadgeText}>{biz.avgRating.toFixed(1)}</Text>
                    {biz.reviewCount > 0 && <Text style={[recentStyles.service, { color: TEXT_MUTED }]}>({biz.reviewCount})</Text>}
                  </View>
                ) : (
                  <Text style={[recentStyles.service, { color: TEXT_MUTED }]}>New</Text>
                )}
                <View style={[recentStyles.rebookBtn, { backgroundColor: accentColor + "18", borderColor: accentColor + "40" }]}>
                  <Text style={[recentStyles.rebookText, { color: accentColor }]}>View</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Recently Visited Component ─────────────────────────────────────────────

interface RecentBusiness {
  businessOwnerId: number;
  businessName: string;
  businessSlug: string;
  businessLogoUri: string | null;
  businessCategory: string | null;
  lastVisited: string; // ISO date string
  lastService: string;
}

function RecentlyVisited({ items, router }: { items: RecentBusiness[]; router: ReturnType<typeof useRouter> }) {
  if (items.length === 0) return null;
  return (
    <View style={recentStyles.section}>
      <View style={recentStyles.header}>
        <Text style={[recentStyles.title, { color: TEXT_PRIMARY }]}>Recently Visited</Text>
        <Text style={[recentStyles.subtitle, { color: TEXT_MUTED }]}>Tap to rebook</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={recentStyles.row}
      >
        {items.map((biz) => {
          const accentColor = CATEGORY_COLORS[biz.businessCategory ?? "Other"] ?? "#8B5CF6";
          const emoji = getCategoryDef(biz.businessCategory).emoji;
          return (
            <Pressable
              key={biz.businessOwnerId}
              style={({ pressed }) => [
                recentStyles.card,
                { backgroundColor: CARD_BG, borderColor: CARD_BORDER },
                pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
              ]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/client-business-detail", params: { slug: biz.businessSlug } } as any);
              }}
            >
              {/* Cover image */}
              <View style={[recentStyles.logoWrap, { backgroundColor: accentColor + "22" }]}>
                {isRemoteUri(biz.businessLogoUri) ? (
                  <Image source={{ uri: biz.businessLogoUri! }} style={recentStyles.logoImage} />
                ) : (
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  <Image source={require("../../assets/images/icon.png")} style={recentStyles.logoImage} resizeMode="cover" />
                )}
              </View>
              {/* Card body */}
              <View style={recentStyles.cardBody}>
                <Text style={[recentStyles.name, { color: TEXT_PRIMARY }]} numberOfLines={1}>
                  {biz.businessName}
                </Text>
                {biz.businessCategory ? (
                  <View style={[recentStyles.categoryBadge, { backgroundColor: accentColor + "18", borderColor: accentColor + "40" }]}>
                    <Text style={{ fontSize: 10, lineHeight: 13 }}>{emoji}</Text>
                    <Text style={[recentStyles.categoryBadgeText, { color: accentColor }]} numberOfLines={1}>{biz.businessCategory}</Text>
                  </View>
                ) : null}
                <Text style={[recentStyles.service, { color: TEXT_MUTED }]} numberOfLines={1}>
                  {biz.lastService}
                </Text>
                <View style={[recentStyles.rebookBtn, { backgroundColor: accentColor + "18", borderColor: accentColor + "40" }]}>
                  <Text style={[recentStyles.rebookText, { color: accentColor }]}>Rebook</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const recentStyles = StyleSheet.create({
  section: {
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "500",
  },
  row: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 2,
  },
  card: {
    width: 150,
    borderRadius: 18,
    borderWidth: 1,
    padding: 0,
    gap: 0,
    alignItems: "flex-start",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  logoWrap: {
    width: 150,
    height: 90,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: 150,
    height: 90,
    borderRadius: 0,
    resizeMode: "cover",
  },
  cardBody: {
    padding: 10,
    gap: 4,
    width: "100%",
  },
  name: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  service: {
    fontSize: 11,
    lineHeight: 14,
  },
  rebookBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 2,
  },
  rebookText: {
    fontSize: 12,
    fontWeight: "700",
  },
  ratingBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    backgroundColor: "rgba(255,210,0,0.12)",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(255,210,0,0.25)",
    alignSelf: "flex-start" as const,
  },
  ratingStar: {
    fontSize: 10,
    color: "#FFD200",
  },
  ratingBadgeText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: "#FFD200",
  },
  categoryBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    alignSelf: "flex-start" as const,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: "600" as const,
    lineHeight: 13,
  },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch } = useClientStore();

  const [businesses, setBusinesses] = useState<DiscoverBusiness[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const [nearMeLoading, setNearMeLoading] = useState(false);
  const [sortMode, setSortMode] = useState<"default" | "rating" | "reviews">("default");
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedBusiness[]>([]);
  // Dynamic categories fetched from API (includes custom categories from all businesses)
  const [dynamicCategories, setDynamicCategories] = useState<string[]>([]);
  // Pinned categories — long-press a chip to pin/unpin; pinned chips float to the front
  const [pinnedCategories, setPinnedCategories] = useState<string[]>([]);
  const clearRecentlyViewed = useCallback(async () => {
    await AsyncStorage.removeItem(RECENTLY_VIEWED_KEY);
    setRecentlyViewed([]);
  }, []);

  const apiBase = getApiBaseUrl();

  // Load recently viewed businesses from AsyncStorage on mount
  useEffect(() => {
    loadRecentlyViewed().then(setRecentlyViewed);
    // Load pinned categories from AsyncStorage
    AsyncStorage.getItem(PINNED_CATS_KEY).then((raw) => {
      if (raw) setPinnedCategories(JSON.parse(raw));
    }).catch(() => {});
    // Fetch all available categories from the server (includes custom ones)
    fetch(`${getApiBaseUrl()}/api/client/businesses/categories`)
      .then((r) => r.json())
      .then((data: { categories: string[] }) => {
        if (data?.categories) setDynamicCategories(data.categories);
      })
      .catch(() => {});
  }, []);

  // Detect if query looks like a zip code or city name (location identifier)
  const isLocationQuery = useCallback((q: string): boolean => {
    if (!q) return false;
    // Pure zip code (5 digits, optionally with dash extension)
    if (/^\d{5}(-\d{4})?$/.test(q.trim())) return true;
    // City, State pattern (e.g. "Pittsburgh, PA")
    if (/^[a-zA-Z\s]+,\s*[a-zA-Z]{2}$/.test(q.trim())) return true;
    return false;
  }, []);

  const fetchBusinesses = useCallback(async (lat?: number, lng?: number, query?: string, category?: string | null, radius?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (lat != null) params.set("lat", String(lat));
      if (lng != null) params.set("lng", String(lng));
      if (query) {
        // Send as both `q` and `search` for compatibility
        params.set("q", query);
        params.set("search", query);
        // If query looks like a location identifier (zip/city), also send as `location`
        // so the server can geocode it and find nearby businesses
        if (isLocationQuery(query)) {
          params.set("location", query);
          // Don't use device lat/lng when searching by location identifier
          params.delete("lat");
          params.delete("lng");
        }
      }
      if (category && category !== "All") params.set("category", category);
      if (radius) params.set("radiusMiles", String(radius));
      // When no GPS coords are provided, sort by rating so best businesses appear first
      if (sortMode === "rating") params.set("sortBy", "rating");
      else if (sortMode === "reviews") params.set("sortBy", "reviews");
      else if (lat == null && lng == null) params.set("sortBy", "rating");
      const res = await fetch(`${apiBase}/api/client/businesses/discover?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        // API returns { businesses: [...] } or plain array
        const data: DiscoverBusiness[] = Array.isArray(json) ? json : (json.businesses ?? []);
        setBusinesses(data);
      }
    } catch (err) {
      console.warn("[Discover] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, isLocationQuery]);

  // Track whether we've done the initial load so we don't double-fetch on focus
  const initialLoadDone = useRef(false);

  // On first mount: load immediately (using persisted GPS if available),
  // then silently upgrade to fresh GPS-filtered results once permission is granted.
  useFocusEffect(useCallback(() => {
    if (initialLoadDone.current) return; // only run once
    initialLoadDone.current = true;

    const persistedLat = state.lastDiscoverLat;
    const persistedLng = state.lastDiscoverLng;

    // Step 1: load immediately — use persisted GPS if available, otherwise no location filter
    // This ensures the list appears right away without waiting for GPS permission
    fetchBusinesses(
      persistedLat ?? undefined,
      persistedLng ?? undefined,
      searchQuery,
      state.discoverCategory,
      state.discoverRadius
    );
    if (persistedLat != null) {
      setUserLat(persistedLat);
      setUserLng(persistedLng);
    }

    // Step 2: request fresh GPS in the background and silently refresh with new coords
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocationError("Location access denied. Showing all businesses.");
          return; // already loaded above, nothing more to do
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        setUserLat(latitude);
        setUserLng(longitude);
        setLocationError(null);
        // Persist fresh GPS coords + current prefs for next launch
        dispatch({ type: "SET_DISCOVER_COORDS", payload: { lat: latitude, lng: longitude } });
        AsyncStorage.setItem(DISCOVER_PREFS_KEY, JSON.stringify({
          radius: state.discoverRadius,
          category: state.discoverCategory,
          lastLat: latitude,
          lastLng: longitude,
        })).catch(() => {});
        // Only refresh if coords changed meaningfully (> ~0.5 miles)
        const latDiff = Math.abs(latitude - (persistedLat ?? 0));
        const lngDiff = Math.abs(longitude - (persistedLng ?? 0));
        if (persistedLat == null || latDiff > 0.007 || lngDiff > 0.007) {
          fetchBusinesses(latitude, longitude, searchQuery, state.discoverCategory, state.discoverRadius);
        }
      } catch {
        setLocationError("Could not get location. Showing all businesses.");
        // Already loaded above, no further action needed
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])); // intentionally empty — run once on first focus


  const handleSearch = () => {
    fetchBusinesses(userLat ?? undefined, userLng ?? undefined, searchQuery, state.discoverCategory, state.discoverRadius);
  };

  const handleNearMe = async () => {
    setNearMeLoading(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location access denied.");
        setNearMeLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setUserLat(latitude);
      setUserLng(longitude);
      setSearchQuery("");
      // Persist fresh GPS coords for next launch
      dispatch({ type: "SET_DISCOVER_COORDS", payload: { lat: latitude, lng: longitude } });
      AsyncStorage.getItem(DISCOVER_PREFS_KEY).then((json) => {
        const prev = json ? JSON.parse(json) : {};
        AsyncStorage.setItem(DISCOVER_PREFS_KEY, JSON.stringify({ ...prev, lastLat: latitude, lastLng: longitude })).catch(() => {});
      }).catch(() => {});
      fetchBusinesses(latitude, longitude, "", state.discoverCategory, state.discoverRadius);
    } catch {
      setLocationError("Could not get location.");
    } finally {
      setNearMeLoading(false);
    }
  };

  const handlePinCategory = useCallback((label: string) => {
    if (label === "All") return; // "All" chip cannot be pinned
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPinnedCategories((prev) => {
      const next = prev.includes(label)
        ? prev.filter((c) => c !== label)  // unpin
        : [...prev, label];                // pin
      AsyncStorage.setItem(PINNED_CATS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const handleCategorySelect = (cat: string) => {
    const newCat = cat === "All" ? null : cat;
    dispatch({ type: "SET_DISCOVER_CATEGORY", payload: newCat });
    // Persist updated category
    AsyncStorage.getItem(DISCOVER_PREFS_KEY).then((json) => {
      const prev = json ? JSON.parse(json) : {};
      AsyncStorage.setItem(DISCOVER_PREFS_KEY, JSON.stringify({ ...prev, category: newCat })).catch(() => {});
    }).catch(() => {});
    fetchBusinesses(userLat ?? undefined, userLng ?? undefined, searchQuery, newCat, state.discoverRadius);
  };

  const handleRadiusSelect = (r: number) => {
    dispatch({ type: "SET_DISCOVER_RADIUS", payload: r });
    setShowRadiusPicker(false);
    // Persist updated radius
    AsyncStorage.getItem(DISCOVER_PREFS_KEY).then((json) => {
      const prev = json ? JSON.parse(json) : {};
      AsyncStorage.setItem(DISCOVER_PREFS_KEY, JSON.stringify({ ...prev, radius: r })).catch(() => {});
    }).catch(() => {});
    fetchBusinesses(userLat ?? undefined, userLng ?? undefined, searchQuery, state.discoverCategory, r);
  };

  const activeCategory = state.discoverCategory ?? "All";

  // Derive recently visited businesses from appointment history
  // Deduplicate by businessOwnerId, sort by most recent date, take top 5
  const recentlyVisited = useMemo<RecentBusiness[]>(() => {
    if (!state.account || state.appointments.length === 0) return [];
    const map = new Map<number, RecentBusiness>();
    // Sort appointments by date descending first
    const sorted = [...state.appointments]
      .filter((a) => a.status !== "cancelled")
      .sort((a, b) => {
        const da = new Date(`${a.date}T${a.time}`).getTime();
        const db2 = new Date(`${b.date}T${b.time}`).getTime();
        return db2 - da;
      });
    for (const appt of sorted) {
      if (!map.has(appt.businessOwnerId)) {
        map.set(appt.businessOwnerId, {
          businessOwnerId: appt.businessOwnerId,
          businessName: appt.businessName,
          businessSlug: appt.businessSlug,
          businessLogoUri: appt.businessLogoUri ?? null,
          businessCategory: appt.businessCategory ?? null,
          lastVisited: appt.date,
          lastService: appt.serviceName,
        });
      }
    }
     return Array.from(map.values()).slice(0, 5);
  }, [state.appointments, state.account]);

  // Compact appointment card: next upcoming or most recent completed for Book Again
  const nextUpcomingAppt = useMemo(() => {
    if (!state.account) return null;
    const today = new Date().toISOString().split("T")[0];
    return state.appointments
      .filter((a) => (a.status === "confirmed" || a.status === "pending") && a.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0] ?? null;
  }, [state.appointments, state.account]);

  const mostRecentCompleted = useMemo(() => {
    if (!state.account) return null;
    return state.appointments
      .filter((a) => a.status === "completed")
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  }, [state.appointments, state.account]);

  const s = styles(colors);
  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />

      {/* Search Bar + Radius */}
      <View style={[s.searchRow, { paddingTop: insets.top + 10 }]}>
        <View style={[s.searchBox, { backgroundColor: CARD_BG, borderColor: CARD_BORDER }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            style={[s.searchInput, { color: TEXT_PRIMARY }]}
            placeholder="Search by name, zip code, or city..."
            placeholderTextColor={TEXT_MUTED}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => { setSearchQuery(""); fetchBusinesses(userLat ?? undefined, userLng ?? undefined, "", state.discoverCategory, state.discoverRadius); }}>
              <IconSymbol name="xmark.circle.fill" size={15} color={TEXT_MUTED} />
            </Pressable>
          ) : (
            <Pressable
              onPress={handleNearMe}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10, backgroundColor: nearMeLoading ? "rgba(143,191,106,0.1)" : "rgba(143,191,106,0.15)" })}
            >
              <IconSymbol name="location.fill" size={12} color={GREEN_ACCENT} />
              <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "600" }}>{nearMeLoading ? "..." : "Near me"}</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [s.radiusBtn, { backgroundColor: CARD_BG, borderColor: CARD_BORDER }, pressed && { opacity: 0.7 }]}
          onPress={() => setShowRadiusPicker((v) => !v)}
        >
          <IconSymbol name="location.fill" size={13} color={GREEN_ACCENT} />
          <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "700" }}>{state.discoverRadius} mi</Text>
        </Pressable>
      </View>

      {/* Radius picker dropdown */}
      {showRadiusPicker && (
        <View style={[s.radiusPicker, { backgroundColor: "#1e4a32", borderColor: CARD_BORDER }]}>
          {RADIUS_OPTIONS.map((r) => (
            <Pressable
              key={r}
              style={({ pressed }) => [s.radiusOption, state.discoverRadius === r && { backgroundColor: "rgba(143,191,106,0.12)" }, pressed && { opacity: 0.7 }]}
              onPress={() => handleRadiusSelect(r)}
            >
              <Text style={{ color: state.discoverRadius === r ? GREEN_ACCENT : TEXT_PRIMARY, fontWeight: state.discoverRadius === r ? "700" : "400", fontSize: 14 }}>
                {r} miles
              </Text>
              {state.discoverRadius === r && <IconSymbol name="checkmark" size={13} color={GREEN_ACCENT} />}
            </Pressable>
          ))}
        </View>
      )}

      {/* Location error banner */}
      {locationError && (
        <View style={[s.locationBanner, { backgroundColor: "rgba(251,191,36,0.15)" }]}>
          <IconSymbol name="location.slash.fill" size={13} color="#FBBF24" />
          <Text style={{ color: "#FBBF24", fontSize: 12, flex: 1 }}>{locationError}</Text>
        </View>
      )}

      {/* ── Compact Appointment / Book Again Card ──────────────────────── */}
      {state.account && (nextUpcomingAppt || mostRecentCompleted) && (
        <View style={[s.apptBannerCard, { backgroundColor: "rgba(74,124,89,0.18)", borderColor: "rgba(143,191,106,0.25)" }]}>
          {nextUpcomingAppt ? (
            /* Next Upcoming Appointment */
            <Pressable
              style={({ pressed }) => [s.apptBannerInner, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({ pathname: "/client-appointment-detail", params: { id: String(nextUpcomingAppt.id) } } as any)}
            >
              <View style={[s.apptBannerDot, { backgroundColor: "#8FBF6A" }]} />
              <View style={s.apptBannerText}>
                <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }}>Next Appointment</Text>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: "700", marginTop: 1 }} numberOfLines={1}>
                  {nextUpcomingAppt.serviceName} · {nextUpcomingAppt.businessName}
                </Text>
                <Text style={{ color: GREEN_ACCENT, fontSize: 11, marginTop: 1 }}>
                  {new Date(nextUpcomingAppt.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at {nextUpcomingAppt.time}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={14} color={TEXT_MUTED} />
            </Pressable>
          ) : mostRecentCompleted ? (
            /* Book Again shortcut */
            <Pressable
              style={({ pressed }) => [s.apptBannerInner, pressed && { opacity: 0.85 }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/client-booking-wizard", params: { slug: mostRecentCompleted.businessSlug, preServiceName: mostRecentCompleted.serviceName } } as any);
              }}
            >
              <View style={[s.apptBannerDot, { backgroundColor: GREEN_ACCENT }]} />
              <View style={s.apptBannerText}>
                <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }}>Book Again</Text>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: "700", marginTop: 1 }} numberOfLines={1}>
                  {mostRecentCompleted.serviceName} · {mostRecentCompleted.businessName}
                </Text>
              </View>
              <View style={[s.bookAgainBtn, { backgroundColor: "rgba(143,191,106,0.2)" }]}>
                <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "700" }}>Book Again</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Category chips — fixed height horizontal scroll */}
      <View style={s.categoryWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.categoryRow}
          style={s.categoryScroll}
        >
          {(() => {
            // Merge standard categories with any custom categories from the API
            const standardLabels = new Set(STANDARD_CATEGORIES.map((c) => c.label));
            const customCats = dynamicCategories
              .filter((c) => !standardLabels.has(c))
              .map((c) => getCategoryDef(c));
            // Float pinned chips to the front (after "All"), preserve original order otherwise
            const allChips = [...STANDARD_CATEGORIES, ...customCats];
            const [allChip, ...restChips] = allChips;
            const pinnedSet = new Set(pinnedCategories);
            const pinned = restChips.filter((c) => pinnedSet.has(c.label));
            const unpinned = restChips.filter((c) => !pinnedSet.has(c.label));
            const orderedChips = [allChip, ...pinned, ...unpinned];
            return orderedChips.map(({ label, emoji, color }) => {
              const isActive = activeCategory === label;
              const isPinned = pinnedCategories.includes(label);
              const accentColor = color ?? GREEN_ACCENT;
              return (
                <Pressable
                  key={label}
                  style={({ pressed }) => [
                    s.categoryChip,
                    {
                      backgroundColor: isActive ? accentColor + "30" : CARD_BG,
                      borderColor: isActive ? accentColor : isPinned ? accentColor + "70" : CARD_BORDER,
                    },
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => handleCategorySelect(label)}
                  onLongPress={() => handlePinCategory(label)}
                  delayLongPress={400}
                >
                  <Text style={s.categoryEmoji}>{emoji}</Text>
                  <Text style={[s.categoryLabel, { color: isActive ? accentColor : isPinned ? accentColor : TEXT_PRIMARY }]}>
                    {label}
                  </Text>
                  {isPinned && (
                    <Text style={{ fontSize: 8, color: accentColor, lineHeight: 10, marginLeft: -2 }}>📌</Text>
                  )}
                </Pressable>
              );
            });
          })()}
        </ScrollView>
      </View>

      {/* Sort toggle row */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 4 }}>
        {(["default", "rating", "reviews"] as const).map((mode) => {
          const labels = { default: "Best Match", rating: "Top Rated", reviews: "Most Reviews" };
          const active = sortMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => {
                setSortMode(mode);
                fetchBusinesses(userLat ?? undefined, userLng ?? undefined, searchQuery, state.discoverCategory, state.discoverRadius);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 20,
                borderWidth: 1,
                backgroundColor: active ? "rgba(143,191,106,0.2)" : CARD_BG,
                borderColor: active ? GREEN_ACCENT : CARD_BORDER,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ color: active ? GREEN_ACCENT : TEXT_MUTED, fontSize: 12, fontWeight: active ? "700" : "500" }}>
                {labels[mode]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Results — FlatList with Recently Viewed/Visited in header so everything scrolls together */}
      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={GREEN_ACCENT} />
          <Text style={[s.loadingText, { color: TEXT_MUTED }]}>Finding businesses near you...</Text>
        </View>
      ) : (
        <FlatList
          data={businesses}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {recentlyViewed.length > 0 && (
                <RecentlyViewedSection items={recentlyViewed} router={router} onClear={clearRecentlyViewed} />
              )}
              {recentlyVisited.length > 0 && (
                <RecentlyVisited items={recentlyVisited} router={router} />
              )}
              {(recentlyViewed.length > 0 || recentlyVisited.length > 0) && businesses.length > 0 && (
                <View style={[s.sectionDivider, { borderTopColor: CARD_BORDER }]}>
                  <Text style={[s.sectionDividerText, { color: TEXT_MUTED }]}>{userLat != null ? "Nearby Businesses" : "All Businesses"}</Text>
                </View>
              )}
              {businesses.length === 0 && (
                <View style={s.emptyContainer}>
                  <Text style={s.emptyIcon}>📍</Text>
                  <Text style={[s.emptyTitle, { color: TEXT_PRIMARY }]}>
                    {state.discoverCategory
                      ? `No ${state.discoverCategory} businesses`
                      : userLat != null ? "No businesses nearby" : "No businesses found"}
                  </Text>
                  <Text style={[s.emptySubtitle, { color: TEXT_MUTED }]}>
                    {state.discoverCategory
                      ? `No businesses have set their category to "${state.discoverCategory}" yet. Tap "All" to see all available businesses.`
                      : userLat != null
                        ? `No businesses available within ${state.discoverRadius} miles. Try increasing your range or changing the category.`
                        : "No businesses match your search. Try a different keyword or category."}
                  </Text>
                  {userLat != null && (
                    <Pressable
                      style={({ pressed }) => [s.expandBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => {
                        const currentRadius = Number(state.discoverRadius);
                        const currentIdx = RADIUS_OPTIONS.indexOf(currentRadius);
                        const nextIdx = currentIdx === -1 ? 1 : Math.min(currentIdx + 1, RADIUS_OPTIONS.length - 1);
                        const nextRadius = RADIUS_OPTIONS[nextIdx];
                        handleRadiusSelect(nextRadius);
                      }}
                    >
                      <Text style={{ color: GREEN_ACCENT, fontWeight: "600", fontSize: 14 }}>Expand Range</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          }
          renderItem={({ item, index }) => (
            <BusinessCard
              item={item}
              router={router}
              index={index}
              onTap={() => {
                trackRecentlyViewed(item).then(() =>
                  loadRecentlyViewed().then(setRecentlyViewed)
                );
              }}
            />
          )}
        />
      )}
    </View>
  );
}

// ─── Business Card Component ─────────────────────────────────────────────────

function BusinessCard({ item, router, index, onTap }: { item: DiscoverBusiness; router: ReturnType<typeof useRouter>; index: number; onTap?: () => void }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  // Stable wrapper needed so runOnJS preserves the correct `this` context on iOS native
  const navigateToBusiness = useCallback(() => {
    onTap?.();
    router.push({ pathname: "/client-business-detail", params: { slug: item.customSlug ?? item.slug, distanceKm: item.distanceKm != null ? String(item.distanceKm) : "" } } as any);
  }, [router, item.customSlug, item.slug, item.distanceKm, onTap]);

  useEffect(() => {
    const delay = index * 60;
    opacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    translateY.value = withSpring(0, { damping: 18, stiffness: 120 });
  }, []);

  const tap = Gesture.Tap()
    .onBegin(() => { scale.value = withSpring(0.97, { damping: 20, stiffness: 300 }); })
    .onFinalize((_, success) => {
      scale.value = withSpring(1, { damping: 18, stiffness: 200 });
      if (success) {
        if (Platform.OS !== "web") runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(navigateToBusiness)();
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const displayCategory = item.businessCategory ?? item.category;
  const accentColor = CATEGORY_COLORS[displayCategory ?? "Other"] ?? GREEN_ACCENT;
  const distanceMiles = item.distanceKm != null ? kmToMiles(item.distanceKm) : null;

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[animStyle, { marginBottom: 12 }]}>
        <View style={[cardStyles.card, { backgroundColor: CARD_BG, borderColor: CARD_BORDER }]}>
          {/* Logo / Cover */}
          <View style={[cardStyles.logoBox, { backgroundColor: accentColor + "18" }]}>
            {isRemoteUri(item.businessLogoUri) || isRemoteUri(item.logoUrl) ? (
              <Image source={{ uri: (item.businessLogoUri && isRemoteUri(item.businessLogoUri) ? item.businessLogoUri : item.logoUrl) ?? "" }} style={cardStyles.logoImage} resizeMode="cover" />
            ) : (
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              <Image source={require("../../assets/images/icon.png")} style={cardStyles.logoImage} resizeMode="cover" />
            )}
          </View>

          {/* Info */}
          <View style={cardStyles.info}>
            <Text style={[cardStyles.name, { color: TEXT_PRIMARY }]} numberOfLines={1}>
              {item.businessName}
            </Text>

            {/* Professional 5-star rating row */}
            <View style={cardStyles.starRow}>
              {Array.from({ length: 5 }, (_, i) => {
                const rating = item.avgRating ?? 0;
                const filled = item.avgRating != null && i < Math.floor(rating);
                const half = item.avgRating != null && !filled && i < rating;
                return (
                  <Text key={i} style={filled || half ? cardStyles.starFilled : cardStyles.starEmpty}>
                    {filled || half ? "★" : "☆"}
                  </Text>
                );
              })}
              {item.avgRating != null ? (
                <>
                  <Text style={cardStyles.ratingValue}>{item.avgRating.toFixed(1)}</Text>
                  {item.reviewCount > 0 && (
                    <Text style={[cardStyles.reviewCountText, { color: TEXT_MUTED }]}>
                      ({item.reviewCount})
                    </Text>
                  )}
                </>
              ) : (
                <Text style={[cardStyles.reviewCountText, { color: TEXT_MUTED, marginLeft: 2 }]}>New</Text>
              )}
              {distanceMiles != null && (
                <Text style={[cardStyles.distanceText, { color: TEXT_MUTED }]}>
                  · {distanceMiles < 0.1 ? "< 0.1 mi" : `${distanceMiles.toFixed(1)} mi`}
                </Text>
              )}
            </View>

            {/* Multi-category service chips */}
            {((): React.ReactNode => {
              const cats: string[] =
                item.serviceCategories && item.serviceCategories.length > 0
                  ? item.serviceCategories
                  : displayCategory ? [displayCategory] : [];
              if (cats.length === 0) return null;
              return (
                <View style={cardStyles.chipsRow}>
                  {cats.slice(0, 4).map((cat) => {
                    const chipColor = CATEGORY_COLORS[cat] ?? GREEN_ACCENT;
                    const catEmoji = getCategoryDef(cat).emoji;
                    return (
                      <View key={cat} style={[cardStyles.chip, { backgroundColor: chipColor + "1A", borderColor: chipColor + "40" }]}>
                        <Text style={[cardStyles.chipText, { color: chipColor }]}>
                          {catEmoji ? `${catEmoji} ${cat}` : cat}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })()}

            {item.address && (
              <Text style={[cardStyles.address, { color: TEXT_MUTED }]} numberOfLines={1}>
                📍 {item.address}
              </Text>
            )}
          </View>

          <IconSymbol name="chevron.right" size={15} color={TEXT_MUTED} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  logoEmoji: {
    fontSize: 26,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  address: {
    fontSize: 12,
    marginTop: 1,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 3,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,210,0,0.12)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,210,0,0.25)",
  },
  ratingStar: {
    fontSize: 11,
    color: "#FFD200",
  },
  ratingStarEmpty: {
    fontSize: 11,
    color: "rgba(255,255,255,0.3)",
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFD200",
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
  },
  reviewCount: {
    fontSize: 11,
  },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  distance: {
    fontSize: 12,
  },
  // Star rating row
  starRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 1,
    marginTop: 2,
    flexWrap: "nowrap" as const,
  },
  starFilled: {
    fontSize: 13,
    color: "#FFD200",
    lineHeight: 17,
  },
  starEmpty: {
    fontSize: 13,
    color: "rgba(255,255,255,0.22)",
    lineHeight: 17,
  },
  ratingValue: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: "#FFD200",
    marginLeft: 4,
  },
  reviewCountText: {
    fontSize: 11,
    marginLeft: 2,
  },
  distanceText: {
    fontSize: 11,
    marginLeft: 4,
  },
  // Service category chips
  chipsRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 5,
    marginTop: 5,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
});

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    searchRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
      alignItems: "center",
    },
    searchBox: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
    },
    radiusBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    radiusPicker: {
      marginHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      overflow: "hidden",
      marginBottom: 6,
    },
    radiusOption: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 11,
    },
    locationBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
    },
    categoryWrapper: {
      height: 48,
      marginBottom: 4,
    },
    categoryScroll: {
      flexGrow: 0,
    },
    categoryRow: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      gap: 8,
      alignItems: "center",
    },
    categoryChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      height: 34,
    },
    categoryEmoji: {
      fontSize: 13,
      lineHeight: 16,
    },
    categoryLabel: {
      fontSize: 13,
      fontWeight: "600",
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 32,
      paddingTop: 4,
    },
    emptyContainer: {
      alignItems: "center",
      paddingTop: 60,
      gap: 10,
      paddingHorizontal: 32,
    },
    emptyIcon: {
      fontSize: 48,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      marginTop: 4,
    },
    emptySubtitle: {
      fontSize: 14,
      textAlign: "center",
      lineHeight: 20,
    },
    expandBtn: {
      marginTop: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: "rgba(143,191,106,0.12)",
      borderWidth: 1,
      borderColor: "rgba(143,191,106,0.3)",
    },
    sectionDivider: {
      borderTopWidth: 1,
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      paddingTop: 10,
    },
    sectionDividerText: {
      fontSize: 13,
      fontWeight: "700",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 4,
    },
    // Compact appointment / Book Again banner
    apptBannerCard: {
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 2,
      borderRadius: 14,
      borderWidth: 1,
      overflow: "hidden" as const,
    },
    apptBannerInner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 10,
    },
    apptBannerDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      flexShrink: 0,
    },
    apptBannerText: {
      flex: 1,
      gap: 1,
    },
    bookAgainBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      flexShrink: 0,
    },
  });
