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
import { getApiBaseUrl } from "@/constants/oauth";

const CATEGORIES = [
  { label: "All", emoji: "🔍" },
  { label: "Hair", emoji: "✂️" },
  { label: "Nails", emoji: "💅" },
  { label: "Skin", emoji: "✨" },
  { label: "Massage", emoji: "💆" },
  { label: "Fitness", emoji: "🏋️" },
  { label: "Dental", emoji: "🦷" },
  { label: "Medical", emoji: "🏥" },
  { label: "Spa", emoji: "🧖" },
  { label: "Barber", emoji: "💈" },
  { label: "Tattoo", emoji: "🎨" },
  { label: "Other", emoji: "📍" },
];

// Radius options in miles
const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

// Category accent colors
// Green-toned category colors for dark background
const CATEGORY_COLORS: Record<string, string> = {
  Hair: "#8FBF6A",
  Nails: "#F9A8D4",
  Skin: "#FCD34D",
  Massage: "#6EE7B7",
  Fitness: "#93C5FD",
  Dental: "#67E8F9",
  Medical: "#FCA5A5",
  Spa: "#C4B5FD",
  Barber: "#8FBF6A",
  Tattoo: "#FDBA74",
  Other: "rgba(255,255,255,0.5)",
  All: "#8FBF6A",
};

const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

function kmToMiles(km: number): number {
  return km * 0.621371;
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
          const emoji = CATEGORIES.find((c) => c.label === biz.businessCategory)?.emoji ?? "🏢";
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
              {/* Logo */}
              <View style={[recentStyles.logoWrap, { backgroundColor: accentColor + "18" }]}>
                {biz.businessLogoUri ? (
                  <Image source={{ uri: biz.businessLogoUri }} style={recentStyles.logoImage} />
                ) : (
                  <Text style={{ fontSize: 22 }}>{emoji}</Text>
                )}
              </View>
              {/* Name */}
              <Text style={[recentStyles.name, { color: TEXT_PRIMARY }]} numberOfLines={2}>
                {biz.businessName}
              </Text>
              {/* Last service */}
              <Text style={[recentStyles.service, { color: TEXT_MUTED }]} numberOfLines={1}>
                {biz.lastService}
              </Text>
              {/* Rebook button */}
              <View style={[recentStyles.rebookBtn, { backgroundColor: accentColor + "18", borderColor: accentColor + "40" }]}>
                <Text style={[recentStyles.rebookText, { color: accentColor }]}>Rebook</Text>
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
    marginTop: 4,
    marginBottom: 2,
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
    width: 130,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 6,
    alignItems: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: 44,
    height: 44,
    borderRadius: 12,
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

  const apiBase = getApiBaseUrl();

  const fetchBusinesses = useCallback(async (lat?: number, lng?: number, query?: string, category?: string | null, radius?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (lat != null) params.set("lat", String(lat));
      if (lng != null) params.set("lng", String(lng));
      if (query) params.set("q", query);
      if (category && category !== "All") params.set("category", category);
      if (radius) params.set("radiusMiles", String(radius));
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
  }, [apiBase]);

  // Get user location on mount
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocationError("Location access denied. Showing all businesses.");
          fetchBusinesses(undefined, undefined, searchQuery, state.discoverCategory, state.discoverRadius);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
        fetchBusinesses(loc.coords.latitude, loc.coords.longitude, searchQuery, state.discoverCategory, state.discoverRadius);
      } catch {
        setLocationError("Could not get location. Showing all businesses.");
        fetchBusinesses(undefined, undefined, searchQuery, state.discoverCategory, state.discoverRadius);
      }
    })();
  }, []));

  const handleSearch = () => {
    fetchBusinesses(userLat ?? undefined, userLng ?? undefined, searchQuery, state.discoverCategory, state.discoverRadius);
  };

  const handleCategorySelect = (cat: string) => {
    const newCat = cat === "All" ? null : cat;
    dispatch({ type: "SET_DISCOVER_CATEGORY", payload: newCat });
    fetchBusinesses(userLat ?? undefined, userLng ?? undefined, searchQuery, newCat, state.discoverRadius);
  };

  const handleRadiusSelect = (r: number) => {
    dispatch({ type: "SET_DISCOVER_RADIUS", payload: r });
    setShowRadiusPicker(false);
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
            placeholder="Search businesses..."
            placeholderTextColor={TEXT_MUTED}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => { setSearchQuery(""); fetchBusinesses(userLat ?? undefined, userLng ?? undefined, "", state.discoverCategory, state.discoverRadius); }}>
              <IconSymbol name="xmark.circle.fill" size={15} color={TEXT_MUTED} />
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

      {/* Category chips — fixed height horizontal scroll */}
      <View style={s.categoryWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.categoryRow}
          style={s.categoryScroll}
        >
          {CATEGORIES.map(({ label, emoji }) => {
            const isActive = activeCategory === label;
            const accentColor = CATEGORY_COLORS[label] ?? GREEN_ACCENT;
            return (
              <Pressable
                key={label}
                style={({ pressed }) => [
                  s.categoryChip,
                  {
                    backgroundColor: isActive ? accentColor + "30" : CARD_BG,
                    borderColor: isActive ? accentColor : CARD_BORDER,
                  },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => handleCategorySelect(label)}
              >
                <Text style={s.categoryEmoji}>{emoji}</Text>
                <Text style={[s.categoryLabel, { color: isActive ? accentColor : TEXT_PRIMARY }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Recently Visited */}
      {!loading && recentlyVisited.length > 0 && (
        <RecentlyVisited items={recentlyVisited} router={router} />
      )}

      {/* Divider between recently visited and results */}
      {!loading && recentlyVisited.length > 0 && businesses.length > 0 && (
        <View style={[s.sectionDivider, { borderTopColor: CARD_BORDER }]}>
          <Text style={[s.sectionDividerText, { color: TEXT_MUTED }]}>All Businesses</Text>
        </View>
      )}

      {/* Results */}
      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={GREEN_ACCENT} />
          <Text style={[s.loadingText, { color: TEXT_MUTED }]}>Finding businesses near you...</Text>
        </View>
      ) : businesses.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={s.emptyIcon}>📍</Text>
          <Text style={[s.emptyTitle, { color: TEXT_PRIMARY }]}>
            {userLat != null ? "No businesses nearby" : "No businesses found"}
          </Text>
          <Text style={[s.emptySubtitle, { color: TEXT_MUTED }]}>
            {userLat != null
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
      ) : (
        <FlatList
          data={businesses}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => <BusinessCard item={item} router={router} index={index} />}
        />
      )}
    </View>
  );
}

// ─── Business Card Component ─────────────────────────────────────────────────

function BusinessCard({ item, router, index }: { item: DiscoverBusiness; router: ReturnType<typeof useRouter>; index: number }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  // Stable wrapper needed so runOnJS preserves the correct `this` context on iOS native
  const navigateToBusiness = useCallback(() => {
    router.push({ pathname: "/client-business-detail", params: { slug: item.customSlug ?? item.slug, distanceKm: item.distanceKm != null ? String(item.distanceKm) : "" } } as any);
  }, [router, item.customSlug, item.slug, item.distanceKm]);

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
            {(item.businessLogoUri || item.logoUrl) ? (
              <Image source={{ uri: item.businessLogoUri ?? item.logoUrl ?? "" }} style={cardStyles.logoImage} resizeMode="cover" />
            ) : (
              <Text style={cardStyles.logoEmoji}>{CATEGORIES.find(c => c.label === (item.businessCategory ?? item.category))?.emoji ?? "🏢"}</Text>
            )}
          </View>

          {/* Info */}
          <View style={cardStyles.info}>
            <Text style={[cardStyles.name, { color: TEXT_PRIMARY }]} numberOfLines={1}>
              {item.businessName}
            </Text>
            {displayCategory && (
              <View style={[cardStyles.categoryBadge, { backgroundColor: accentColor + "18" }]}>
                <Text style={[cardStyles.categoryBadgeText, { color: accentColor }]}>
                  {CATEGORIES.find(c => c.label === displayCategory)?.emoji ?? ""} {displayCategory}
                </Text>
              </View>
            )}
            {item.address && (
              <Text style={[cardStyles.address, { color: TEXT_MUTED }]} numberOfLines={1}>
                📍 {item.address}
              </Text>
            )}
            <View style={cardStyles.meta}>
              {item.avgRating != null && (
                <View style={cardStyles.ratingRow}>
                  <Text style={{ fontSize: 11 }}>⭐</Text>
                  <Text style={[cardStyles.ratingText, { color: TEXT_PRIMARY }]}>
                    {item.avgRating.toFixed(1)}
                  </Text>
                  <Text style={[cardStyles.reviewCount, { color: TEXT_MUTED }]}>
                    ({item.reviewCount})
                  </Text>
                </View>
              )}
              {distanceMiles != null && (
                <Text style={[cardStyles.distance, { color: TEXT_MUTED }]}>
                  {distanceMiles < 0.1 ? "< 0.1 mi" : `${distanceMiles.toFixed(1)} mi`}
                </Text>
              )}
            </View>
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
    alignItems: "center",
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
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
  },
  reviewCount: {
    fontSize: 11,
  },
  distance: {
    fontSize: 12,
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
  });
