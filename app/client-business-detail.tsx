/**
 * Client Portal — Business Detail Screen
 * Full dark-green portal theme with white text, glass cards, no scrollbar.
 */

import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput,
  ActivityIndicator, Alert, Platform, Linking, Dimensions, FlatList, Modal,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useClientStore, SavedBusiness } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getApiBaseUrl } from "@/constants/oauth";
import { getCategoryDef, ALL_CATEGORY } from "@/constants/categories";
import * as Haptics from "expo-haptics";
import { ClientPortalBackground } from "@/components/client-portal-background";

// ─── Portal theme constants ───────────────────────────────────────────────────
const PORTAL_BG   = "#1A3A28";
const ACCENT      = "#8FBF6A";   // bright lime-green for active/accent
const LIME_GREEN  = "#4A7C59";   // used for buttons
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED   = "rgba(255,255,255,0.65)";
const CARD_BG      = "rgba(255,255,255,0.07)";
const CARD_BORDER  = "rgba(255,255,255,0.12)";
const DIVIDER      = "rgba(255,255,255,0.10)";

function formatPhone(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw ?? "";
}

function getCategoryEmoji(category?: string | null): string {
  if (!category) return "✨";
  const c = category.toLowerCase();
  if (c.includes("hair")) return "✂️";
  if (c.includes("nail")) return "💅";
  if (c.includes("skin") || c.includes("facial")) return "🧖";
  if (c.includes("massage") || c.includes("body")) return "💆";
  if (c.includes("brow") || c.includes("lash")) return "👁️";
  if (c.includes("wax")) return "🌿";
  if (c.includes("makeup") || c.includes("beauty")) return "💄";
  if (c.includes("wellness") || c.includes("spa")) return "🌸";
  if (c.includes("barber") || c.includes("beard")) return "🪒";
  return "✨";
}

interface ApiService {
  localId: string; name: string; description: string | null;
  duration: number; price: string | null; category: string | null; photoUri: string | null;
}
interface ApiStaff {
  localId: string; name: string; role: string | null; bio?: string | null; photoUri: string | null;
  avgRating?: number | null; reviewCount?: number;
}
interface ApiReview {
  rating: number; comment: string | null; clientName: string; createdAt: string;
}
interface ApiServicePhoto {
  id: number; serviceLocalId: string; url: string; caption: string | null; sortOrder: number;
}
interface ApiBusiness {
  id: number; businessName: string; ownerName: string; description: string | null;
  address: string | null; phone: string | null; email: string | null;
  businessCategory?: string | null; category?: string | null;
  avgRating?: number | null; reviewCount?: number;
  businessLogoUri?: string | null; coverPhotoUri?: string | null;
  workingHours?: Record<string, { enabled: boolean; start: string; end: string }> | null;
}
interface ApiLocation {
  localId: string; name: string; address: string; phone: string;
  workingHours: Record<string, { enabled: boolean; start: string; end: string }> | null;
  temporarilyClosed: boolean;
}

const DAY_ORDER = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const DAY_LABELS: Record<string,string> = {
  monday:"Monday", tuesday:"Tuesday", wednesday:"Wednesday",
  thursday:"Thursday", friday:"Friday", saturday:"Saturday", sunday:"Sunday",
};

function formatPrice(price: string | null | undefined): string {
  if (!price) return "Price varies";
  const n = parseFloat(price);
  return isNaN(n) ? "Price varies" : `$${n.toFixed(2)}`;
}

function parseWorkingHours(wh: Record<string, { enabled: boolean; start: string; end: string }> | null | undefined) {
  if (!wh) return [];
  return DAY_ORDER.map((day) => {
    const entry = wh[day];
    return { day, isOpen: entry?.enabled ?? false, openTime: entry?.start ?? "—", closeTime: entry?.end ?? "—" };
  });
}

const isRemoteUri = (uri: string | null | undefined) =>
  !!uri && (uri.startsWith("http://") || uri.startsWith("https://"));

export default function ClientBusinessDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { slug, distanceKm } = useLocalSearchParams<{ slug: string; distanceKm?: string }>();
  const distanceMiles = distanceKm && distanceKm !== "" ? (parseFloat(distanceKm) * 0.621371).toFixed(1) : null;
  const { state, apiCall, dispatch } = useClientStore();

  const [business, setBusiness] = useState<ApiBusiness | null>(null);
  const [services, setServices] = useState<ApiService[]>([]);
  const [staff, setStaff] = useState<ApiStaff[]>([]);
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [servicePhotos, setServicePhotos] = useState<ApiServicePhoto[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const [activeTab, setActiveTab] = useState<"services"|"staff"|"hours"|"reviews"|"gallery">("services");
  const reviewsTabRef = useRef<any>(null);
  const [serviceCategory, setServiceCategory] = useState<string | null>(null);
  const [detailReviewVisible, setDetailReviewVisible] = useState(false);
  const [detailReviewRating, setDetailReviewRating] = useState(5);
  const [detailReviewComment, setDetailReviewComment] = useState("");
  const [detailReviewSubmitting, setDetailReviewSubmitting] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [serviceLightboxUri, setServiceLightboxUri] = useState<string | null>(null);
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);

  const SCREEN_WIDTH = Dimensions.get("window").width;
  const apiBase = getApiBaseUrl();

  const serviceCategories = useMemo(() => {
    const cats = services.map(s => s.category).filter(Boolean) as string[];
    return Array.from(new Set(cats));
  }, [services]);

  const filteredServices = useMemo(() => {
    if (!serviceCategory) return services;
    return services.filter(s => s.category === serviceCategory);
  }, [services, serviceCategory]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const [bizRes, svcRes, staffRes, revRes, photosRes, locRes] = await Promise.all([
          fetch(`${apiBase}/api/public/business/${slug}`),
          fetch(`${apiBase}/api/public/business/${slug}/services`),
          fetch(`${apiBase}/api/public/business/${slug}/staff`),
          fetch(`${apiBase}/api/public/business/${slug}/reviews`),
          fetch(`${apiBase}/api/public/service-photos/${slug}`),
          fetch(`${apiBase}/api/public/business/${slug}/locations`),
        ]);
        if (bizRes.ok) setBusiness(await bizRes.json() as ApiBusiness);
        if (svcRes.ok) { const d = await svcRes.json(); setServices(Array.isArray(d) ? d : []); }
        if (staffRes.ok) { const d = await staffRes.json(); setStaff(Array.isArray(d) ? d : []); }
        if (revRes.ok) { const d = await revRes.json(); setReviews(Array.isArray(d) ? d : []); }
        if (photosRes.ok) { const d = await photosRes.json(); setServicePhotos(Array.isArray(d.photos) ? d.photos : (Array.isArray(d) ? d : [])); }
        if (locRes.ok) { const d = await locRes.json(); setLocations(Array.isArray(d) ? d : []); }
      } catch (err) {
        console.warn("[BizDetail] fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, apiBase]);

  useEffect(() => {
    if (state.account && business) {
      setIsSaved(state.savedBusinesses.some((s) => s.businessSlug === slug));
    }
  }, [state.savedBusinesses, state.account, business, slug]);

  const handleToggleSave = async () => {
    if (!state.account) { router.push("/client-signin" as any); return; }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSavingToggle(true);
    try {
      if (isSaved) {
        await apiCall(`/api/client/saved-businesses/${slug}`, { method: "DELETE" });
        dispatch({ type: "REMOVE_SAVED_BUSINESS", payload: slug });
        setIsSaved(false);
      } else {
        await apiCall<any>(`/api/client/saved-businesses`, { method: "POST", body: JSON.stringify({ businessSlug: slug }) });
        const optimistic: SavedBusiness = {
          id: Date.now(), businessOwnerId: business?.id ?? 0,
          businessName: business?.businessName ?? "", businessSlug: slug,
          businessCategory: business?.businessCategory ?? business?.category ?? null,
          businessAddress: business?.address ?? null, businessPhone: business?.phone ?? null,
          savedAt: new Date().toISOString(),
        };
        dispatch({ type: "ADD_SAVED_BUSINESS", payload: optimistic });
        setIsSaved(true);
      }
    } catch (err) { console.warn("[BizDetail] save error:", err); }
    finally { setSavingToggle(false); }
  };

  const handleBookService = (service: ApiService) => {
    if (!state.account) {
      // Pass returnTo params so sign-in redirects back to this booking after auth
      router.push({ pathname: "/client-signin", params: { returnSlug: slug, returnServiceLocalId: service.localId } } as any);
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/client-booking-wizard", params: { slug, serviceLocalId: service.localId } } as any);
  };

  const hours = parseWorkingHours(business?.workingHours);
  const category = business?.businessCategory ?? business?.category ?? null;
  const logoUri = isRemoteUri(business?.businessLogoUri) ? business!.businessLogoUri : null;
  const coverUri = isRemoteUri(business?.coverPhotoUri) ? business!.coverPhotoUri : null;

  if (loading) {
    return (
      <ScreenContainer>
        <ClientPortalBackground />
        <View style={s.loadingContainer}><ActivityIndicator size="large" color={ACCENT} /></View>
      </ScreenContainer>
    );
  }

  if (!business) {
    return (
      <ScreenContainer className="px-6">
        <ClientPortalBackground />
        <View style={s.loadingContainer}>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 16 }}>Business not found.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: ACCENT, fontSize: 14 }}>Go back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const tabs: Array<"services"|"staff"|"hours"|"reviews"|"gallery"> = [
    "services","staff","hours","reviews",
    ...(servicePhotos.length > 0 ? (["gallery"] as const) : []),
  ];

  return (
    <ScreenContainer>
      <ClientPortalBackground />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* ── Header Banner ── */}
        <View style={[s.banner, { backgroundColor: PORTAL_BG, overflow: "hidden" }]}>
          {(coverUri || logoUri) ? (
            <Image source={{ uri: coverUri || logoUri! }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={300} />
          ) : null}
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.35)" }]} />
          <Pressable style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
            <IconSymbol name="chevron.left" size={20} color="#FFFFFF" />
          </Pressable>
          <Pressable style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.7 }]} onPress={handleToggleSave} disabled={savingToggle}>
            <IconSymbol name={isSaved ? "bookmark.fill" : "bookmark"} size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ── Business Info ── */}
        <View style={s.infoSection}>
          <View style={[s.logoCircle, { backgroundColor: `${LIME_GREEN}30`, borderColor: PORTAL_BG }]}>
            {logoUri
              ? <Image source={{ uri: logoUri }} style={{ width: 66, height: 66, borderRadius: 33 }} contentFit="cover" />
              : <Image source={require("../assets/images/icon.png")} style={{ width: 66, height: 66, borderRadius: 33 }} contentFit="cover" />}
          </View>
          <Text style={[s.bizName, { color: TEXT_PRIMARY }]}>{business.businessName}</Text>
          {category && <Text style={[s.bizCategory, { color: ACCENT }]}>{category}</Text>}
          {distanceMiles ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <IconSymbol name="location.fill" size={12} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>{distanceMiles} mi away</Text>
            </View>
          ) : null}
          {/* ── Prominent star rating (tappable → jumps to Reviews tab) ── */}
          <Pressable
            style={({ pressed }) => [s.ratingRow, pressed && { opacity: 0.7 }]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab("reviews");
            }}
            accessibilityRole="button"
            accessibilityLabel="View all reviews"
          >
            {Array.from({ length: 5 }, (_, i) => {
              const rating = Number(business.avgRating ?? 0);
              const filled = business.avgRating != null && i < Math.floor(rating);
              const half = business.avgRating != null && !filled && i < rating;
              return (
                <Text key={i} style={filled || half ? s.starFilled : s.starEmpty}>
                  {filled || half ? "★" : "☆"}
                </Text>
              );
            })}
            {business.avgRating != null ? (
              <Text style={s.ratingValue}>
                {Number(business.avgRating).toFixed(1)}
                <Text style={[s.ratingCount, { color: TEXT_MUTED }]}> ({business.reviewCount ?? 0} reviews)</Text>
              </Text>
            ) : (
              <Text style={[s.ratingCount, { color: TEXT_MUTED }]}>No reviews yet</Text>
            )}
            {business.avgRating != null && (
              <IconSymbol name="chevron.right" size={12} color={TEXT_MUTED} style={{ marginLeft: 2 }} />
            )}
          </Pressable>
          {/* Show primary location address if only 1 location, else use business.address */}
          {(locations.length === 1 ? locations[0].address : business.address) ? (
            <View style={s.metaRow}>
              <IconSymbol name="location.fill" size={13} color={TEXT_MUTED} />
              <Text style={[s.metaText, { color: TEXT_MUTED }]}>
                {locations.length === 1 ? locations[0].address : business.address}
              </Text>
            </View>
          ) : null}
          {/* Phone: prefer location phone if single location */}
          {(locations.length === 1 ? (locations[0].phone || business.phone) : business.phone) ? (
            <Pressable
              style={({ pressed }) => [s.metaRow, pressed && { opacity: 0.7 }]}
              onPress={() => Linking.openURL(`tel:${(locations.length === 1 ? (locations[0].phone || business.phone) : business.phone) ?? ""}`)}
            >
              <IconSymbol name="phone.fill" size={13} color={TEXT_MUTED} />
              <Text style={[s.metaText, { color: ACCENT }]}>
                {formatPhone((locations.length === 1 ? (locations[0].phone || business.phone) : business.phone) ?? "")}
              </Text>
            </Pressable>
          ) : null}
          {business.description && (
            <Text style={[s.description, { color: TEXT_MUTED }]}>{business.description}</Text>
          )}
        </View>

        {/* ── Tab Bar ── */}
        <View style={[s.tabBar, { borderBottomColor: DIVIDER }]}>
          {tabs.map((tab) => (
            <Pressable key={tab} style={[s.tab, activeTab === tab && { borderBottomColor: ACCENT, borderBottomWidth: 2 }]} onPress={() => setActiveTab(tab)}>
              <Text style={[s.tabText, { color: activeTab === tab ? ACCENT : TEXT_MUTED }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {tab === "gallery"
                  ? `Gallery (${servicePhotos.length})`
                  : tab === "reviews" && reviews.length > 0
                  ? `Reviews (${reviews.length})`
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Services Tab ── */}
        {activeTab === "services" && (
          <View>
            {serviceCategories.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" }}>
                {/* All chip */}
                <Pressable
                  onPress={() => setServiceCategory(null)}
                  style={[s.catChip, !serviceCategory && { backgroundColor: ALL_CATEGORY.color + "30", borderColor: ALL_CATEGORY.color }]}
                >
                  <Text style={{ fontSize: 14, lineHeight: 18 }}>{ALL_CATEGORY.emoji}</Text>
                  <Text style={[s.catChipText, !serviceCategory && { color: ALL_CATEGORY.color }]}>All</Text>
                </Pressable>
                {serviceCategories.map(cat => {
                  const catDef = getCategoryDef(cat);
                  const isActive = serviceCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setServiceCategory(isActive ? null : cat)}
                      style={[s.catChip, isActive && { backgroundColor: catDef.color + "30", borderColor: catDef.color }]}
                    >
                      <Text style={{ fontSize: 14, lineHeight: 18 }}>{catDef.emoji}</Text>
                      <Text style={[s.catChipText, isActive && { color: catDef.color }]}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View style={s.tabContent}>
              {filteredServices.length === 0
                ? <Text style={[s.emptyText, { color: TEXT_MUTED }]}>No services in this category.</Text>
                : filteredServices.map((svc) => (
                  <View key={svc.localId} style={[s.serviceCard, { backgroundColor: CARD_BG, borderColor: CARD_BORDER, flexDirection: "column", padding: 0, overflow: "hidden" }]}>
                    {svc.photoUri ? (
                      <Pressable onPress={() => setServiceLightboxUri(svc.photoUri!)} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, width: "100%", height: 160 })}>
                        <Image source={{ uri: svc.photoUri }} style={{ width: "100%", height: 160 }} contentFit="cover" />
                        <View style={{ position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <IconSymbol name="magnifyingglass" size={12} color="#FFFFFF" />
                          <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "600" }}>Preview</Text>
                        </View>
                      </Pressable>
                    ) : (
                      <View style={{ width: "100%", height: 80, backgroundColor: `${LIME_GREEN}25`, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 }}>
                        <Text style={{ fontSize: 28 }}>{getCategoryEmoji(svc.category)}</Text>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: ACCENT }}>{svc.category || "Service"}</Text>
                      </View>
                    )}
                    <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={s.serviceInfo}>
                        {svc.category && (
                          <Text style={{ fontSize: 10, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 }}>{svc.category}</Text>
                        )}
                        <Text style={[s.serviceName, { color: TEXT_PRIMARY }]}>{svc.name}</Text>
                        {svc.description && <Text style={[s.serviceDesc, { color: TEXT_MUTED }]} numberOfLines={2}>{svc.description}</Text>}
                        <View style={s.serviceMeta}>
                          <Text style={[s.serviceDuration, { color: TEXT_MUTED }]}>⏱ {svc.duration} min</Text>
                          <Text style={[s.servicePrice, { color: TEXT_PRIMARY }]}>{formatPrice(svc.price)}</Text>
                        </View>
                      </View>
                      <Pressable style={({ pressed }) => [s.bookBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]} onPress={() => handleBookService(svc)}>
                        <Text style={s.bookBtnText}>Book</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
            </View>
          </View>
        )}

        {/* ── Staff Tab ── */}
        {activeTab === "staff" && (
          <View style={s.tabContent}>
            {staff.length === 0
              ? <Text style={[s.emptyText, { color: TEXT_MUTED }]}>No staff listed.</Text>
              : staff.map((member) => (
                <Pressable key={member.localId} style={({ pressed }) => [s.staffCard, { backgroundColor: CARD_BG, borderColor: CARD_BORDER, opacity: pressed ? 0.92 : 1 }]} onPress={() => setExpandedStaffId(expandedStaffId === member.localId ? null : member.localId)}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}30` }]}>
                      {member.photoUri
                        ? <Image source={{ uri: member.photoUri }} style={{ width: 48, height: 48, borderRadius: 24 }} contentFit="cover" />
                        : <Text style={{ fontSize: 20, fontWeight: "700", color: ACCENT }}>{member.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View style={[s.staffInfo, { flex: 1 }]}>
                      <Text style={[s.staffName, { color: TEXT_PRIMARY }]}>{member.name}</Text>
                      {member.role && <Text style={[s.staffRole, { color: ACCENT }]}>{member.role}</Text>}
                      {/* Per-staff star rating */}
                      {member.avgRating != null ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 }}>
                          {[1,2,3,4,5].map((i) => (
                            <Text key={i} style={{ fontSize: 11, color: i <= Math.round(member.avgRating!) ? "#FFD200" : "rgba(255,255,255,0.2)", lineHeight: 14 }}>
                              {i <= Math.round(member.avgRating!) ? "★" : "☆"}
                            </Text>
                          ))}
                          <Text style={{ fontSize: 11, color: "#FFD200", fontWeight: "700", marginLeft: 3 }}>
                            {Number(member.avgRating).toFixed(1)}
                          </Text>
                          <Text style={{ fontSize: 10, color: TEXT_MUTED, marginLeft: 1 }}>
                            ({member.reviewCount ?? 0})
                          </Text>
                        </View>
                      ) : null}
                      {member.bio && <Text style={[s.staffBio, { color: TEXT_MUTED }]} numberOfLines={expandedStaffId === member.localId ? 0 : 2}>{member.bio}</Text>}
                    </View>
                    <IconSymbol name={expandedStaffId === member.localId ? "chevron.up" : "chevron.down"} size={16} color={TEXT_MUTED} />
                  </View>
                  {expandedStaffId === member.localId && (
                    <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: DIVIDER, gap: 6 }}>
                      {member.role ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <IconSymbol name="person.fill" size={13} color={ACCENT} />
                          <Text style={{ fontSize: 13, color: ACCENT, fontWeight: "600" }}>{member.role}</Text>
                        </View>
                      ) : null}
                      {member.bio ? (
                        <Text style={{ fontSize: 13, color: TEXT_MUTED, lineHeight: 19 }}>{member.bio}</Text>
                      ) : (
                        <Text style={{ fontSize: 13, color: TEXT_MUTED, fontStyle: "italic" }}>No bio available.</Text>
                      )}
                    </View>
                  )}
                </Pressable>
              ))}
          </View>
        )}

        {/* ── Hours Tab ── */}
        {activeTab === "hours" && (
          <View style={s.tabContent}>
            {locations.length > 1 ? (
              locations.map((loc) => {
                const locHours = parseWorkingHours(loc.workingHours);
                return (
                  <View key={loc.localId} style={[s.locationHoursCard]}>
                    <View style={s.locationHoursHeader}>
                      <IconSymbol name="location.fill" size={14} color={ACCENT} />
                      <Text style={s.locationHoursName}>{loc.name}</Text>
                    </View>
                    {loc.address ? <Text style={{ color: TEXT_MUTED, fontSize: 12, marginBottom: 4 }}>{loc.address}</Text> : null}
                    {loc.phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${loc.phone}`)} style={{ marginBottom: 8 }}>
                        <Text style={{ color: ACCENT, fontSize: 12 }}>{formatPhone(loc.phone)}</Text>
                      </Pressable>
                    ) : null}
                    {loc.temporarilyClosed ? (
                      <Text style={{ color: "#F87171", fontSize: 14, fontWeight: "600", textAlign: "center", paddingVertical: 12 }}>Temporarily Closed</Text>
                    ) : locHours.length === 0 ? (
                      <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Hours not set</Text>
                    ) : (
                      locHours.map((h) => (
                        <View key={h.day} style={s.hoursRow}>
                          <Text style={s.hoursDay}>{DAY_LABELS[h.day] ?? h.day}</Text>
                          <Text style={[s.hoursTime, { color: h.isOpen ? ACCENT : TEXT_MUTED }]}>
                            {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                );
              })
            ) : locations.length === 1 ? (
              (() => {
                const loc = locations[0];
                const locHours = parseWorkingHours(loc.workingHours ?? business?.workingHours);
                return (
                  <View style={s.locationHoursCard}>
                    {loc.address ? (
                      <View style={[s.metaRow, { marginBottom: 8 }]}>
                        <IconSymbol name="location.fill" size={13} color={TEXT_MUTED} />
                        <Text style={[s.metaText, { color: TEXT_MUTED }]}>{loc.address}</Text>
                      </View>
                    ) : null}
                    {loc.phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${loc.phone}`)} style={[s.metaRow, { marginBottom: 12 }]}>
                        <IconSymbol name="phone.fill" size={13} color={TEXT_MUTED} />
                        <Text style={[s.metaText, { color: ACCENT }]}>{formatPhone(loc.phone)}</Text>
                      </Pressable>
                    ) : null}
                    {loc.temporarilyClosed ? (
                      <Text style={{ color: "#F87171", fontSize: 14, fontWeight: "600", textAlign: "center", paddingVertical: 16 }}>Temporarily Closed</Text>
                    ) : locHours.length === 0 ? (
                      <Text style={[s.emptyText, { color: TEXT_MUTED }]}>Hours not available.</Text>
                    ) : (
                      locHours.map((h) => (
                        <View key={h.day} style={s.hoursRow}>
                          <Text style={s.hoursDay}>{DAY_LABELS[h.day] ?? h.day}</Text>
                          <Text style={[s.hoursTime, { color: h.isOpen ? ACCENT : TEXT_MUTED }]}>
                            {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                );
              })()
            ) : (
              <View style={s.locationHoursCard}>
                {business.address ? (
                  <View style={[s.metaRow, { marginBottom: 8 }]}>
                    <IconSymbol name="location.fill" size={13} color={TEXT_MUTED} />
                    <Text style={[s.metaText, { color: TEXT_MUTED }]}>{business.address}</Text>
                  </View>
                ) : null}
                {hours.length === 0
                  ? <Text style={[s.emptyText, { color: TEXT_MUTED }]}>Hours not available.</Text>
                  : hours.map((h) => (
                    <View key={h.day} style={s.hoursRow}>
                      <Text style={s.hoursDay}>{DAY_LABELS[h.day] ?? h.day}</Text>
                      <Text style={[s.hoursTime, { color: h.isOpen ? ACCENT : TEXT_MUTED }]}>
                        {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </View>
        )}

        {/* ── Reviews Tab ── */}
        {activeTab === "reviews" && (
          <View style={s.tabContent}>
            {state.account && !reviews.some(r => r.clientName === (state.account?.name ?? "")) && (
              <Pressable onPress={() => setDetailReviewVisible(true)} style={({ pressed }) => [s.writeReviewBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}>
                <IconSymbol name="star.fill" size={15} color="#fff" />
                <Text style={s.writeReviewBtnText}>Write a Review</Text>
              </Pressable>
            )}
            {reviews.length === 0
              ? <Text style={[s.emptyText, { color: TEXT_MUTED }]}>No reviews yet.</Text>
              : (() => {
                  const clientName = state.account?.name ?? "";
                  const sorted = [...reviews].sort((a, b) => {
                    const aOwn = clientName && a.clientName === clientName;
                    const bOwn = clientName && b.clientName === clientName;
                    if (aOwn && !bOwn) return -1;
                    if (!aOwn && bOwn) return 1;
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                  });
                  return sorted.map((rev, idx) => {
                    const isOwn = clientName && rev.clientName === clientName;
                    return (
                      <View key={idx} style={[s.reviewCard, isOwn && { borderColor: ACCENT, backgroundColor: `${LIME_GREEN}15` }]}>
                        <View style={s.reviewHeader}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                            <Text style={[s.reviewerName, { color: TEXT_PRIMARY }]}>{rev.clientName}</Text>
                            {isOwn && (
                              <View style={{ backgroundColor: `${ACCENT}25`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                                <Text style={{ color: ACCENT, fontSize: 10, fontWeight: "700" }}>Your review</Text>
                              </View>
                            )}
                          </View>
                          <View style={s.reviewStars}>
                            {[1,2,3,4,5].map((star) => (
                              <IconSymbol key={star} name="star.fill" size={12} color={star <= rev.rating ? "#F59E0B" : DIVIDER} />
                            ))}
                          </View>
                        </View>
                        {rev.comment && <Text style={[s.reviewComment, { color: TEXT_MUTED }]}>{rev.comment}</Text>}
                        <Text style={[s.reviewDate, { color: TEXT_MUTED }]}>{new Date(rev.createdAt).toLocaleDateString()}</Text>
                      </View>
                    );
                  });
                })()
            }
          </View>
        )}

        {/* ── Gallery Tab ── */}
        {activeTab === "gallery" && (
          <View style={{ paddingTop: 16 }}>
            <FlatList
              data={servicePhotos} keyExtractor={(item) => String(item.id)}
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setGalleryIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
              renderItem={({ item, index }) => (
                <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })} onPress={() => { setLightboxIndex(index); setLightboxVisible(true); }}>
                  <Image source={{ uri: item.url }} style={{ width: SCREEN_WIDTH, height: 260 }} contentFit="cover" transition={300} />
                  {item.caption ? (
                    <View style={[s.photoCaptionBar, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
                      <Text style={s.photoCaptionText}>{item.caption}</Text>
                    </View>
                  ) : null}
                </Pressable>
              )}
            />
            {servicePhotos.length > 1 && (
              <View style={s.dotRow}>
                {servicePhotos.map((_, i) => (
                  <View key={i} style={[s.dot, { backgroundColor: i === galleryIndex ? ACCENT : DIVIDER }]} />
                ))}
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 12 }}>
              {servicePhotos.map((photo, idx) => (
                <Pressable key={photo.id} onPress={() => { setLightboxIndex(idx); setLightboxVisible(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                  <Image source={{ uri: photo.url }} style={[s.thumbnail, idx === galleryIndex && { borderColor: ACCENT, borderWidth: 2 }]} contentFit="cover" transition={200} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* ── Lightbox Modal ── */}
      <Modal visible={lightboxVisible} transparent animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <View style={s.lightboxOverlay}>
          <Pressable style={s.lightboxClose} onPress={() => setLightboxVisible(false)}>
            <IconSymbol name="xmark" size={22} color="#FFFFFF" />
          </Pressable>
          <FlatList
            data={servicePhotos} keyExtractor={(item) => String(item.id)}
            horizontal pagingEnabled initialScrollIndex={lightboxIndex}
            getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width: SCREEN_WIDTH, justifyContent: "center", alignItems: "center" }}>
                <Image source={{ uri: item.url }} style={{ width: SCREEN_WIDTH, height: 400 }} contentFit="contain" transition={200} />
                {item.caption ? <Text style={[s.lightboxCaption, { color: "#FFFFFF" }]}>{item.caption}</Text> : null}
              </View>
            )}
          />
        </View>
      </Modal>

      {/* ── Service Image Lightbox ── */}
      <Modal visible={!!serviceLightboxUri} transparent animationType="fade" onRequestClose={() => setServiceLightboxUri(null)}>
        <View style={s.lightboxOverlay}>
          <Pressable style={s.lightboxClose} onPress={() => setServiceLightboxUri(null)}>
            <IconSymbol name="xmark" size={22} color="#FFFFFF" />
          </Pressable>
          {serviceLightboxUri && (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <Image source={{ uri: serviceLightboxUri }} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 }} contentFit="contain" transition={200} />
            </View>
          )}
        </View>
      </Modal>

      {/* ── Write a Review Modal ── */}
      <Modal visible={detailReviewVisible} transparent animationType="slide" onRequestClose={() => setDetailReviewVisible(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View style={[s.reviewModal, { backgroundColor: "#1E3D2F" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={[s.reviewModalTitle, { color: TEXT_PRIMARY }]}>Write a Review</Text>
              <Pressable onPress={() => setDetailReviewVisible(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <IconSymbol name="xmark" size={20} color={TEXT_MUTED} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 8 }}>{business?.businessName}</Text>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 8 }}>
              {[1,2,3,4,5].map(star => (
                <Pressable key={star} onPress={() => setDetailReviewRating(star)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
                  <IconSymbol name="star.fill" size={36} color={star <= detailReviewRating ? "#F59E0B" : DIVIDER} />
                </Pressable>
              ))}
            </View>
            <Text style={{ textAlign: "center", color: ACCENT, fontWeight: "700", fontSize: 14, marginBottom: 12 }}>
              {["Terrible","Poor","Okay","Good","Excellent!"][detailReviewRating - 1]}
            </Text>
            <TextInput
              style={[s.reviewInput, { backgroundColor: "rgba(255,255,255,0.08)", color: TEXT_PRIMARY, borderColor: CARD_BORDER }]}
              placeholder="Share your experience (optional)"
              placeholderTextColor={TEXT_MUTED}
              multiline numberOfLines={3}
              value={detailReviewComment}
              onChangeText={setDetailReviewComment}
            />
            <Pressable
              style={({ pressed }) => [s.reviewSubmitBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }, detailReviewSubmitting && { opacity: 0.6 }]}
              onPress={async () => {
                if (!state.account || detailReviewSubmitting) return;
                setDetailReviewSubmitting(true);
                try {
                  const res = await apiCall<any>("/api/client/reviews", {
                    method: "POST",
                    body: JSON.stringify({ businessOwnerId: business?.id, rating: detailReviewRating, comment: detailReviewComment.trim() || null }),
                  });
                  if (res) {
                    const newRev = { clientName: state.account.name ?? "You", rating: detailReviewRating, comment: detailReviewComment.trim() || null, createdAt: new Date().toISOString() };
                    setReviews(prev => [newRev as any, ...prev]);
                    setDetailReviewVisible(false);
                    setDetailReviewComment("");
                    setDetailReviewRating(5);
                    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }
                } catch (err) { console.warn("[DetailReview]", err); }
                finally { setDetailReviewSubmitting(false); }
              }}
              disabled={detailReviewSubmitting}
            >
              <Text style={s.reviewSubmitBtnText}>{detailReviewSubmitting ? "Submitting..." : "Submit Review"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Sticky Book Button ── */}
      <View style={[s.stickyBook, { backgroundColor: PORTAL_BG, borderTopColor: DIVIDER }]}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            style={({ pressed }) => [s.stickyGiftBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={() => {
              if (!state.account) { router.push({ pathname: "/client-signin", params: { returnSlug: slug, returnServiceLocalId: "" } } as any); return; }
              router.push({ pathname: "/client-buy-gift", params: { slug, businessName: business?.businessName ?? "" } } as any);
            }}
          >
            <Text style={{ fontSize: 16 }}>🎁</Text>
            <Text style={s.stickyGiftBtnText}>Gift</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.stickyBookBtn, { flex: 1 }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={() => {
              if (!state.account) {
                const firstSvc = services[0];
                router.push({ pathname: "/client-signin", params: { returnSlug: slug, returnServiceLocalId: firstSvc?.localId ?? "" } } as any);
                return;
              }
              if (services.length > 0) handleBookService(services[0]);
            }}
          >
            <IconSymbol name="calendar" size={18} color="#FFFFFF" />
            <Text style={s.stickyBookBtnText}>Book an Appointment</Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  banner: { height: 160, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 16, paddingTop: 16 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center" },
  saveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center" },
  infoSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, alignItems: "center", gap: 6 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginTop: -36, borderWidth: 3 },
  bizName: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  bizCategory: { fontSize: 13, fontWeight: "600" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  ratingText: { fontSize: 12, marginLeft: 4 },
  starFilled: { fontSize: 16, color: "#FFD200", lineHeight: 20 },
  starEmpty: { fontSize: 16, color: "rgba(255,255,255,0.22)", lineHeight: 20 },
  ratingValue: { fontSize: 14, fontWeight: "700", color: "#FFD200", marginLeft: 6 },
  ratingCount: { fontSize: 12, fontWeight: "400" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13 },
  description: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 4 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, marginHorizontal: 0, paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent", paddingHorizontal: 4 },
  tabText: { fontSize: 12, fontWeight: "600", textAlign: "center" },
  tabContent: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  emptyText: { textAlign: "center", fontSize: 14, paddingVertical: 24 },
  serviceCard: { borderRadius: 14, borderWidth: 1 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: "transparent", flexDirection: "row", alignItems: "center", gap: 5 },
  catChipText: { fontSize: 13, fontWeight: "600", color: ACCENT },
  serviceInfo: { flex: 1, gap: 4 },
  serviceName: { fontSize: 15, fontWeight: "600" },
  serviceDesc: { fontSize: 12, lineHeight: 17 },
  serviceMeta: { flexDirection: "row", gap: 12 },
  serviceDuration: { fontSize: 12 },
  servicePrice: { fontSize: 13, fontWeight: "700" },
  bookBtn: { backgroundColor: ACCENT, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  bookBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  staffCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  staffAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  staffInfo: { flex: 1, gap: 3 },
  staffName: { fontSize: 15, fontWeight: "600" },
  staffRole: { fontSize: 12, fontWeight: "600" },
  staffBio: { fontSize: 12, lineHeight: 17 },
  hoursRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: DIVIDER },
  hoursDay: { fontSize: 14, fontWeight: "600", color: TEXT_PRIMARY },
  hoursTime: { fontSize: 14 },
  locationHoursCard: { borderRadius: 14, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG, padding: 14, marginBottom: 4 },
  locationHoursHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  locationHoursName: { fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY },
  reviewCard: { borderRadius: 14, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG, padding: 14, gap: 6 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewerName: { fontSize: 14, fontWeight: "600" },
  reviewStars: { flexDirection: "row", gap: 2 },
  reviewComment: { fontSize: 13, lineHeight: 18 },
  reviewDate: { fontSize: 11 },
  writeReviewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, marginBottom: 4 },
  writeReviewBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  reviewModal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  reviewModalTitle: { fontSize: 18, fontWeight: "700" },
  reviewInput: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: "top", marginBottom: 16 },
  reviewSubmitBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  reviewSubmitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  stickyBook: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: 1 },
  stickyGiftBtn: { backgroundColor: "rgba(255,255,255,0.10)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  stickyGiftBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  stickyBookBtn: { backgroundColor: LIME_GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14 },
  stickyBookBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  photoCaptionBar: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 8 },
  photoCaptionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "500" },
  dotRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  thumbnail: { width: 72, height: 72, borderRadius: 10, borderWidth: 0, borderColor: "transparent" },
  lightboxOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" },
  lightboxClose: { position: "absolute", top: 56, right: 20, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  lightboxCaption: { textAlign: "center", fontSize: 14, marginTop: 12, paddingHorizontal: 24 },
});
