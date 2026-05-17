/**
 * Client Portal — Home Tab
 *
 * Dark forest-green aesthetic matching the onboarding screen.
 * White text on deep green gradient background, glass-morphism cards.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Image,
  Dimensions,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/use-colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useClientStore, ClientAppointment } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Linking } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────
interface GiftCertificate {
  localId: string;
  code: string;
  serviceLocalId?: string | null;
  serviceName: string | null;
  businessName: string;
  businessLogoUri: string | null;
  businessSlug: string | null;
  purchaserName: string | null;
  message: string | null;
  redeemed: boolean;
  redeemedAt: string | null;
  expiresAt: string | null;
  totalValue: number | null;
  remainingBalance: number | null;
  giftType: string;
  paymentStatus: string;
  createdAt: string;
  bannerImageUri?: string | null;
}
interface ClientPackage {
  localId: string;
  packageLocalId: string;
  packageName: string;
  businessName: string;
  businessLogoUri: string | null;
  businessSlug: string | null;
  totalSessions: number;
  sessionsCompleted: number;
  totalValue: number | null;
  status: string;
  paymentStatus: string;
  purchasedAt: string;
  expiresAt: string | null;
  notes: string | null;
}
// ─── Design tokens ────────────────────────────────────────────────────────────
const GREEN_ACCENT = "#8FBF6A";   // light green CTA
const GREEN_DARK   = "#1A3A28";
const GREEN_MID    = "#2D5A3D";
const GREEN_LIGHT  = "#4A7C59";
const CARD_BG      = "rgba(255,255,255,0.09)";
const CARD_BORDER  = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED   = "rgba(255,255,255,0.6)";
const { width: SCREEN_W } = Dimensions.get("window");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function statusColor(status: ClientAppointment["status"]): string {
  switch (status) {
    case "confirmed": return "#8FBF6A";
    case "pending": return "#FBBF24";
    case "completed": return "rgba(255,255,255,0.4)";
    case "cancelled":
    case "no_show": return "#F87171";
    default: return "rgba(255,255,255,0.4)";
  }
}

function statusLabel(status: ClientAppointment["status"]): string {
  switch (status) {
    case "confirmed": return "Confirmed";
    case "pending": return "Pending";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "no_show": return "No Show";
    default: return status;
  }
}

// ─── Animated Press Wrapper ───────────────────────────────────────────────────
function AnimCard({ children, onPress, style }: { children: React.ReactNode; onPress: () => void; style?: any }) {
  const scale = useSharedValue(1);
  const tap = Gesture.Tap()
    .onBegin(() => { scale.value = withSpring(0.97, { damping: 20, stiffness: 300 }); })
    .onFinalize((_, s) => {
      scale.value = withSpring(1, { damping: 18, stiffness: 200 });
      if (s) {
        if (Platform.OS !== "web") runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(onPress)();
      }
    });
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[animStyle, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ClientHomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, apiCall } = useClientStore();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewPromptAppt, setReviewPromptAppt] = useState<ClientAppointment | null>(null);
  const [myGifts, setMyGifts] = useState<GiftCertificate[]>([]);
  const [myPackages, setMyPackages] = useState<ClientPackage[]>([]);
  // Scroll-to-gifts: ref to the main ScrollView and the Y position of the gifts section
  const scrollRef = useRef<ScrollView>(null);
  const giftsYRef = useRef<number>(0);

  const isSignedIn = !!state.account;

  const loadData = useCallback(async (silent = false) => {
    if (!isSignedIn) return;
    if (!silent) setLoading(true);
    try {
      const [rawAppts, saved, giftsRaw, packagesRaw] = await Promise.all([
        apiCall<{ appointments: ClientAppointment[] } | ClientAppointment[]>("/api/client/appointments"),
        apiCall<any>("/api/client/saved-businesses"),
        apiCall<GiftCertificate[]>("/api/client/my-gifts").catch(() => []),
        apiCall<ClientPackage[]>("/api/client/my-packages").catch(() => []),
      ]);
      setMyGifts(Array.isArray(giftsRaw) ? giftsRaw : []);
      setMyPackages(Array.isArray(packagesRaw) ? packagesRaw.filter((p) => p.status === "active") : []);
      // API returns { appointments: [...] } — unwrap it
      const appts: ClientAppointment[] = Array.isArray(rawAppts) ? rawAppts : (rawAppts as any).appointments ?? [];
      dispatch({ type: "SET_APPOINTMENTS", payload: appts });
      // ── Review prompt: find a recently completed appointment (within 48h) not yet reviewed ──
      try {
        const dismissed = await AsyncStorage.getItem("dismissed_review_prompts");
        const dismissedIds: number[] = dismissed ? JSON.parse(dismissed) : [];
        const now = Date.now();
        const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
        const candidates = appts.filter((a) => {
          if (a.status !== "completed") return false;
          if (dismissedIds.includes(a.id)) return false;
          // Check if appointment was within the last 48 hours
          const apptDate = new Date(a.date + "T" + (a.time || "00:00") + ":00");
          return (now - apptDate.getTime()) <= TWO_DAYS_MS && (now - apptDate.getTime()) >= 0;
        });
        if (candidates.length > 0) {
          // Check if already reviewed
          const candidate = candidates[0];
          try {
            const checkRes = await apiCall<{ reviewed: boolean }>(`/api/client/reviews/check/${candidate.id}`);
            if (!checkRes.reviewed) {
              setReviewPromptAppt(candidate);
            }
          } catch { /* ignore */ }
        } else {
          setReviewPromptAppt(null);
        }
      } catch { /* ignore */ }
      // Saved businesses returns an array directly
      dispatch({ type: "SET_SAVED_BUSINESSES", payload: Array.isArray(saved) ? saved : [] });
      const msgs = await apiCall<{ count: number; unreadCount?: number }>("/api/client/messages/unread-count");
      dispatch({ type: "SET_UNREAD_COUNT", payload: msgs.count ?? msgs.unreadCount ?? 0 });
    } catch (err) {
      console.warn("[ClientHome] load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isSignedIn, apiCall, dispatch]);

  useFocusEffect(useCallback(() => { loadData(true); }, [loadData]));

  // When returning from booking wizard started via a gift card, scroll to the gifts section
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem("scroll_to_gifts_on_focus").then((val) => {
      if (val === "1") {
        AsyncStorage.removeItem("scroll_to_gifts_on_focus");
        // Small delay to let the screen fully render before scrolling
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: giftsYRef.current, animated: true });
        }, 350);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const upcoming = state.appointments
    .filter((a) => a.status === "confirmed" || a.status === "pending")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  // Most recent completed appointment for "Book Again" shortcut
  const lastCompleted = state.appointments
    .filter((a) => a.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  // Entrance animations
  const headerOpacity = useSharedValue(0);
  const headerY = useSharedValue(-20);
  const contentOpacity = useSharedValue(0);
  const contentY = useSharedValue(30);
  const screenSlideX = useSharedValue(0);

  useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
    headerY.value = withSpring(0, { damping: 18, stiffness: 120 });
    contentOpacity.value = withDelay(200, withTiming(1, { duration: 450 }));
    contentY.value = withDelay(200, withSpring(0, { damping: 18, stiffness: 100 }));
  }, []);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentY.value }],
  }));
  const screenSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: screenSlideX.value }],
  }));

  function handleBackToPortal() {
    function navigateToPortalSelect() {
      try { router.dismissAll(); } catch {}
      router.replace("/profile-select" as any);
    }
    screenSlideX.value = withTiming(SCREEN_W, { duration: 280, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(navigateToPortalSelect)();
    });
  }

  // ── Not signed in ──────────────────────────────────────────────────────────
  if (!isSignedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 40 }}
        >
          <GuestBanner router={router} />
        </ScrollView>
      </View>
    );
  }

  // ── Signed in ──────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[{ flex: 1, backgroundColor: GREEN_DARK }, screenSlideStyle]}>
      <ClientPortalBackground />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 32, paddingTop: insets.top }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_ACCENT} />}
      >
        {/* Header */}
        <Animated.View style={[styles.header, headerStyle]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greetingLabel}>{getGreeting()},</Text>
            <Text style={styles.greeting}>{state.account?.name?.split(" ")[0] ?? "there"} 👋</Text>
            <Text style={styles.greetingSub}>What are you booking today?</Text>
            {/* Portal indicator pill */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#8B5CF6" }} />
              <Text style={{ fontSize: 10, fontWeight: "700", color: "#8B5CF6", letterSpacing: 0.8, textTransform: "uppercase" }}>Client Portal</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <AnimCard onPress={handleBackToPortal}>
              <View style={styles.avatarBtn}>
                <IconSymbol name="chevron.left" size={16} color="rgba(255,255,255,0.7)" />
              </View>
            </AnimCard>
            <AnimCard onPress={() => router.push("/(client-tabs)/profile" as any)}>
              {state.account?.profilePhotoUri ? (
                <Image source={{ uri: state.account.profilePhotoUri }} style={styles.avatarPhoto} />
              ) : (
                <View style={[styles.avatarBtn, { backgroundColor: GREEN_ACCENT + "30" }]}>
                  <Text style={styles.avatarInitial}>
                    {(state.account?.name ?? "?").charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </AnimCard>
          </View>
        </Animated.View>

        {/* Profile completion nudge */}
        {!state.account?.profilePhotoUri && (
          <Animated.View style={[{ paddingHorizontal: 16, marginBottom: 4 }, headerStyle]}>
            <AnimCard onPress={() => router.push("/client-profile-onboarding" as any)}>
              <View style={styles.nudgeBanner}>
                <View style={styles.nudgeIcon}>
                  <IconSymbol name="person.crop.circle.fill" size={16} color={GREEN_ACCENT} />
                </View>
                <Text style={styles.nudgeText}>Complete your profile — add a photo</Text>
                <IconSymbol name="chevron.right" size={12} color={GREEN_ACCENT} />
              </View>
            </AnimCard>
          </Animated.View>
        )}

        {/* ── Payment Due Nudge Banner ── */}
        {(() => {
          // Find the earliest upcoming confirmed appointment with an outstanding payment
          // (pending_cash = client pays in person; pay_later = balance due at service time;
          //  unpaid = any other unpaid status)
          const cashDueAppt = upcoming.find(
            (a) => a.status === "confirmed" && (
              (a as any).paymentStatus === "pending_cash" ||
              (a as any).paymentStatus === "pay_later" ||
              (a as any).paymentStatus === "unpaid"
            )
          );
          if (!cashDueAppt) return null;
          const method = (cashDueAppt as any).paymentMethod;
          const methodLabel =
            method === "zelle" ? "Zelle" :
            method === "venmo" ? "Venmo" :
            method === "cashapp" ? "Cash App" :
            "cash";
          const amount = cashDueAppt.totalPrice ? `$${Number(cashDueAppt.totalPrice).toFixed(0)}` : "";
          return (
            <Animated.View style={[{ paddingHorizontal: 16, marginBottom: 4 }, headerStyle]}>
              <AnimCard
                onPress={() => router.push({ pathname: "/client-appointment-detail", params: { id: String(cashDueAppt.id) } } as any)}
              >
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderRadius: 12,
                  borderWidth: 1,
                  backgroundColor: "rgba(251,191,36,0.1)",
                  borderColor: "rgba(251,191,36,0.3)",
                }}>
                  {/* Icon */}
                  <View style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    backgroundColor: "rgba(251,191,36,0.2)",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <IconSymbol name="creditcard.fill" size={16} color="#FBBF24" />
                  </View>
                  {/* Text */}
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#FBBF24" }}>
                      Payment due{amount ? ` — ${amount}` : ""}
                    </Text>
                    <Text style={{ fontSize: 11, color: "rgba(251,191,36,0.75)" }} numberOfLines={1}>
                      Bring {methodLabel} for {cashDueAppt.serviceName} · {formatDate(cashDueAppt.date)}
                    </Text>
                  </View>
                  {/* Chevron */}
                  <IconSymbol name="chevron.right" size={13} color="#FBBF24" />
                </View>
              </AnimCard>
            </Animated.View>
          );
        })()}

        {/* ── Review Prompt Banner ── */}
        {reviewPromptAppt && (
          <Animated.View style={[{ paddingHorizontal: 16, marginBottom: 4 }, headerStyle]}>
            <Pressable
              style={({ pressed }) => [styles.reviewBanner, pressed && { opacity: 0.85 }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/client-appointment-detail", params: { id: String(reviewPromptAppt.id) } } as any);
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <Text style={{ fontSize: 20 }}>⭐</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewBannerTitle}>How was your visit?</Text>
                  <Text style={styles.reviewBannerSub} numberOfLines={1}>
                    {reviewPromptAppt.serviceName} at {reviewPromptAppt.businessName}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={GREEN_ACCENT} />
              </View>
              <Pressable
                style={{ padding: 6, marginRight: -4 }}
                onPress={async (e) => {
                  e.stopPropagation?.();
                  const dismissed = await AsyncStorage.getItem("dismissed_review_prompts");
                  const ids: number[] = dismissed ? JSON.parse(dismissed) : [];
                  ids.push(reviewPromptAppt.id);
                  await AsyncStorage.setItem("dismissed_review_prompts", JSON.stringify(ids));
                  setReviewPromptAppt(null);
                }}
                hitSlop={8}
              >
                <IconSymbol name="xmark" size={12} color="rgba(255,255,255,0.5)" />
              </Pressable>
            </Pressable>
          </Animated.View>
        )}
        <Animated.View style={contentStyle}>
          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <AnimCard onPress={() => router.push("/(client-tabs)/discover" as any)} style={{ flex: 1 }}>
              <LinearGradient
                colors={[GREEN_ACCENT, "#6aaa4a"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.quickBtnGrad}
              >
                <IconSymbol name="safari.fill" size={20} color="#1A3A28" />
                <Text style={[styles.quickBtnText, { color: "#1A3A28" }]}>Discover</Text>
              </LinearGradient>
            </AnimCard>
            <AnimCard onPress={() => router.push("/(client-tabs)/bookings" as any)} style={{ flex: 1 }}>
              <View style={styles.quickBtnOutline}>
                <IconSymbol name="calendar" size={20} color={TEXT_PRIMARY} />
                <Text style={[styles.quickBtnText, { color: TEXT_PRIMARY }]}>Bookings</Text>
              </View>
            </AnimCard>
          </View>

          {/* My Packages & Bundles */}
          {myPackages.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>📦 My Packages</Text>
                <Pressable onPress={() => router.push("/(client-tabs)/packages" as any)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: GREEN_ACCENT, fontSize: 13, fontWeight: "600" }}>View All →</Text>
                </Pressable>
              </View>
              {myPackages.map((pkg) => {
                const progress = pkg.totalSessions > 0 ? pkg.sessionsCompleted / pkg.totalSessions : 0;
                const remaining = pkg.totalSessions - pkg.sessionsCompleted;
                const isComplete = pkg.sessionsCompleted >= pkg.totalSessions;
                const isExpiredPkg = pkg.status === "expired" || (pkg.expiresAt ? new Date(pkg.expiresAt + "T23:59:59") < new Date() : false);
                const pkgStatusLabel = isComplete ? "✓ Complete" : isExpiredPkg ? "Expired" : "Active";
                const pkgStatusColor = isComplete ? "#22C55E" : isExpiredPkg ? "#F87171" : GREEN_ACCENT;
                // Expiry reminder: warn if expiring within 7 days and not yet expired/complete
                const daysUntilExpiry = pkg.expiresAt && !isExpiredPkg && !isComplete
                  ? Math.ceil((new Date(pkg.expiresAt + "T23:59:59").getTime() - Date.now()) / 86400000)
                  : null;
                const showExpiryWarning = daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
                return (
                  <View key={pkg.localId} style={{ backgroundColor: isExpiredPkg ? "rgba(255,255,255,0.04)" : CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: isExpiredPkg ? "rgba(248,113,113,0.25)" : showExpiryWarning ? "rgba(251,191,36,0.40)" : CARD_BORDER, padding: 16, marginBottom: 12, gap: 12 }}>
                    {/* Expiry warning banner */}
                    {showExpiryWarning && (
                      <View style={{ backgroundColor: "rgba(251,191,36,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 14 }}>⚠️</Text>
                        <Text style={{ color: "#FBBF24", fontSize: 12, fontWeight: "600", flex: 1 }}>
                          {daysUntilExpiry === 0
                            ? "Expires today! Book your remaining sessions."
                            : `Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"} — use your remaining sessions soon.`}
                        </Text>
                      </View>
                    )}
                    {/* Header row */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>{pkg.packageName}</Text>
                        <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>{pkg.businessName}</Text>
                      </View>
                      <View style={{ backgroundColor: pkgStatusColor + "25", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ color: pkgStatusColor, fontSize: 11, fontWeight: "700" }}>
                          {pkgStatusLabel}
                        </Text>
                      </View>
                    </View>
                    {/* Progress bar */}
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: "600" }}>Sessions</Text>
                        <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: "700" }}>
                          {pkg.sessionsCompleted} / {pkg.totalSessions}
                        </Text>
                      </View>
                      <View style={{ height: 8, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                        <View style={{ height: 8, width: `${Math.min(100, progress * 100)}%`, backgroundColor: isComplete ? "#22C55E" : GREEN_ACCENT, borderRadius: 4 }} />
                      </View>
                      {!isComplete && (
                        <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>
                          {remaining} session{remaining !== 1 ? "s" : ""} remaining
                        </Text>
                      )}
                    </View>
                    {/* Value + expiry */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      {pkg.totalValue ? (
                        <Text style={{ color: GREEN_ACCENT, fontWeight: "700", fontSize: 13 }}>Value: ${pkg.totalValue.toFixed(2)}</Text>
                      ) : <View />}
                      {pkg.expiresAt && !isComplete ? (
                        <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>Expires: {new Date(pkg.expiresAt).toLocaleDateString()}</Text>
                      ) : null}
                    </View>
                    {/* Book next session button */}
                    {!isComplete && !isExpiredPkg && pkg.businessSlug ? (
                      <Pressable
                        onPress={() => router.push({ pathname: "/client-booking-wizard", params: { slug: pkg.businessSlug } } as any)}
                        style={({ pressed }) => [{ backgroundColor: GREEN_ACCENT, borderRadius: 10, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.85 : 1 }]}
                      >
                        <Text style={{ color: "#1A3A28", fontWeight: "700", fontSize: 13 }}>Book Next Session →</Text>
                      </Pressable>
                    ) : isExpiredPkg ? (
                      <Text style={{ color: "#F87171", fontSize: 12, textAlign: "center" }}>This package has expired. Please contact {pkg.businessName} to renew.</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {/* My Gift Certificates */}
          {myGifts.length > 0 && (
            <View
              style={[styles.section, { marginBottom: 0 }]}
              onLayout={(e) => { giftsYRef.current = e.nativeEvent.layout.y; }}
            >
              <View style={[styles.sectionHeader, { marginBottom: 16 }]}>
                <Text style={styles.sectionTitle}>🎁 My Gift Certificates</Text>
              </View>
              {myGifts.map((gift) => {
                const isExpired = gift.expiresAt ? new Date(gift.expiresAt) < new Date() : false;
                const statusColor = gift.redeemed ? TEXT_MUTED : isExpired ? "#F87171" : GREEN_ACCENT;
                const statusLabel = gift.redeemed ? "Redeemed" : isExpired ? "Expired" : "Active";
                const canRedeem = !gift.redeemed && !isExpired && !!gift.businessSlug;
                const handleRedeemGift = () => {
                  if (!canRedeem) return;
                  const params: Record<string, string> = { slug: gift.businessSlug! };
                  if ((gift as any).packageLocalId) {
                    // Package gift — pre-select the package in the booking wizard
                    params.packageLocalId = (gift as any).packageLocalId;
                  } else if (gift.serviceLocalId) {
                    params.serviceLocalId = gift.serviceLocalId;
                  } else if (gift.serviceName) {
                    params.preServiceName = gift.serviceName;
                  }
                  params.preGiftCode = gift.code;
                  router.push({ pathname: "/client-booking-wizard", params } as any);
                };
                return (
                  <Pressable
                    key={gift.localId}
                    onPress={handleRedeemGift}
                    style={({ pressed }) => ({
                      marginBottom: 12,
                      opacity: pressed ? 0.88 : 1,
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    })}
                  >
                  <View
                    style={{
                      backgroundColor: gift.redeemed ? "rgba(255,255,255,0.04)" : GREEN_ACCENT + "14",
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: gift.redeemed ? CARD_BORDER : GREEN_ACCENT + "35",
                      padding: 14,
                      gap: 10,
                    }}
                  >
                    {/* Banner image (if present) */}
                    {gift.bannerImageUri ? (
                      <Image
                        source={{ uri: gift.bannerImageUri }}
                        style={{ width: "100%", height: 110, borderRadius: 10, marginBottom: 2 }}
                        resizeMode="cover"
                      />
                    ) : null}
                    {/* Header row */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: GREEN_ACCENT + "25", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                        {gift.businessLogoUri && gift.giftType !== "balance" ? (
                          <Image source={{ uri: gift.businessLogoUri }} style={{ width: 44, height: 44 }} resizeMode="cover" />
                        ) : (
                          <Text style={{ fontSize: 22 }}>{gift.giftType === "balance" ? "💵" : "🎁"}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{gift.businessName}</Text>
                        {gift.giftType === "balance" ? (
                          <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>Balance Credit Gift</Text>
                        ) : gift.serviceName ? (
                          <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{gift.serviceName}</Text>
                        ) : null}
                        {gift.purchaserName ? <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>From: {gift.purchaserName}</Text> : null}
                      </View>
                      <View style={{ backgroundColor: statusColor + "25", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700" }}>{statusLabel}</Text>
                      </View>
                    </View>
                    {/* Gift code */}
                    <View style={{ backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: "600" }}>GIFT CODE</Text>
                      <Text style={{ color: TEXT_PRIMARY, fontSize: 15, fontWeight: "800", letterSpacing: 2 }}>{gift.code}</Text>
                    </View>
                    {/* Balance bar */}
                    {gift.totalValue && !gift.redeemed ? (() => {
                      const remaining = gift.remainingBalance ?? gift.totalValue;
                      const pct = Math.max(0, Math.min(1, remaining / gift.totalValue));
                      return (
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: "600" }}>BALANCE REMAINING</Text>
                            <Text style={{ color: GREEN_ACCENT, fontWeight: "800", fontSize: 13 }}>${remaining.toFixed(2)} of ${gift.totalValue.toFixed(2)}</Text>
                          </View>
                          <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 3, overflow: "hidden" }}>
                            <View style={{ height: 6, width: `${Math.round(pct * 100)}%` as any, backgroundColor: pct > 0.5 ? GREEN_ACCENT : pct > 0.2 ? "#FBBF24" : "#F87171", borderRadius: 3 }} />
                          </View>
                        </View>
                      );
                    })() : gift.redeemed && gift.totalValue ? (
                      <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: "700" }}>Value: ${gift.totalValue.toFixed(2)} · Fully Redeemed</Text>
                    ) : null}
                    {/* Message */}
                    {gift.message ? (
                      <Text style={{ color: TEXT_MUTED, fontSize: 12, fontStyle: "italic" }}>"{gift.message}"</Text>
                    ) : null}
                    {/* Expiry */}
                    {gift.expiresAt && !gift.redeemed ? (
                      <Text style={{ color: isExpired ? "#F87171" : TEXT_MUTED, fontSize: 11 }}>
                        {isExpired ? "Expired" : "Expires"}: {new Date(gift.expiresAt).toLocaleDateString()}
                      </Text>
                    ) : null}
                    {/* How to use steps + redeem button */}
                    {!gift.redeemed && !isExpired && (
                      <View style={{ gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
                        {/* Redeem button — navigates to booking wizard with service pre-selected and gift code pre-filled */}
                        <Pressable
                          onPress={handleRedeemGift}
                          style={({ pressed }) => [{ backgroundColor: canRedeem ? GREEN_ACCENT : "rgba(143,191,106,0.35)", borderRadius: 10, paddingVertical: 11, alignItems: "center", opacity: pressed ? 0.85 : 1 }]}
                        >
                          <Text style={{ color: canRedeem ? "#1A3A28" : TEXT_MUTED, fontWeight: "700", fontSize: 14 }}>{canRedeem ? "Redeem Gift →" : "Gift not redeemable"}</Text>
                        </Pressable>
                        <Text style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>How to use</Text>
                        {(gift.giftType === "balance" || (!gift.serviceLocalId && !gift.serviceName)
                          ? [
                              "1. Tap this card or 'Redeem Gift' to start booking",
                              "2. Choose any service from the full menu",
                              "3. Your gift balance is applied automatically at checkout",
                            ]
                          : [
                              "1. Tap this card or 'Redeem Gift' to start booking",
                              "2. Your service is pre-selected — go straight to staff & time",
                              "3. Your gift code is pre-filled at checkout automatically",
                            ]
                        ).map((howStep, i) => (
                          <Text key={i} style={{ color: TEXT_MUTED, fontSize: 12, lineHeight: 18 }}>{howStep}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {/* Book Again Shortcut */}
          {lastCompleted && (
            <View style={[styles.section, { marginBottom: 0 }]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Book Again</Text>
              </View>
              <AnimCard
                onPress={() => router.push({ pathname: "/client-booking-wizard", params: { slug: lastCompleted.businessSlug, preServiceName: lastCompleted.serviceName } } as any)}
                style={{ marginBottom: 12 }}
              >
                {/* Clean horizontal card: logo | text | button */}
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: GREEN_ACCENT + "18",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: GREEN_ACCENT + "40",
                  padding: 14,
                  gap: 12,
                }}>
                  {/* Business logo */}
                  <View style={{
                    width: 56, height: 56, borderRadius: 14,
                    backgroundColor: GREEN_ACCENT + "30",
                    alignItems: "center", justifyContent: "center",
                    overflow: "hidden", flexShrink: 0,
                  }}>
                    {(lastCompleted as any).businessLogoUri ? (
                      <Image source={{ uri: (lastCompleted as any).businessLogoUri }} style={{ width: 56, height: 56 }} resizeMode="cover" />
                    ) : (
                      <Text style={{ fontSize: 24 }}>🏢</Text>
                    )}
                  </View>
                  {/* Text block */}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>{lastCompleted.businessName}</Text>
                    <Text style={{ color: GREEN_ACCENT, fontWeight: "600", fontSize: 13 }} numberOfLines={1}>{lastCompleted.serviceName}</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>Last visited {formatDate(lastCompleted.date)}</Text>
                  </View>
                  {/* Book Again pill */}
                  <View style={{
                    backgroundColor: GREEN_ACCENT,
                    borderRadius: 22,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    flexShrink: 0,
                  }}>
                    <Text style={{ color: "#1A3A28", fontWeight: "800", fontSize: 13 }}>Book{'\n'}Again</Text>
                  </View>
                </View>
              </AnimCard>
            </View>
          )}
          {/* ── Next Appointment Countdown Hero Card ── */}
          {(() => {
            const nextAppt = upcoming.find((a) => a.status === "confirmed");
            if (!nextAppt) return null;
            const apptDateTime = new Date(nextAppt.date + "T" + (nextAppt.time || "00:00") + ":00");
            const now = new Date();
            const diffMs = apptDateTime.getTime() - now.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            let countdownLabel = "";
            let countdownSub = "";
            if (diffMs < 0) {
              countdownLabel = "Now";
              countdownSub = "Your appointment is starting";
            } else if (diffMins < 60) {
              countdownLabel = `${diffMins}m`;
              countdownSub = "Starting very soon";
            } else if (diffHours < 24) {
              countdownLabel = `${diffHours}h`;
              countdownSub = `Today at ${nextAppt.time}`;
            } else if (diffDays === 1) {
              countdownLabel = "Tomorrow";
              countdownSub = `at ${nextAppt.time}`;
            } else {
              countdownLabel = `${diffDays} days`;
              countdownSub = `${formatDate(nextAppt.date)} at ${nextAppt.time}`;
            }
            const address = nextAppt.clientAddress || nextAppt.locationAddress;
            const handleDirections = () => {
              if (!address) return;
              const encoded = encodeURIComponent(address);
              const url = Platform.OS === "ios"
                ? `maps://?q=${encoded}`
                : `geo:0,0?q=${encoded}`;
              Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${encoded}`));
            };
            return (
              <Animated.View style={[{ paddingHorizontal: 16, marginBottom: 8 }, contentStyle]}>
                <AnimCard
                  onPress={() => router.push({ pathname: "/client-appointment-detail", params: { id: String(nextAppt.id) } } as any)}
                >
                  <LinearGradient
                    colors={["#2D5A3D", "#1A3A28"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: GREEN_ACCENT + "40",
                      padding: 16,
                      gap: 12,
                    }}
                  >
                    {/* Top row: label + countdown badge */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN_ACCENT }} />
                        <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Next Appointment</Text>
                      </View>
                      <View style={{ backgroundColor: GREEN_ACCENT + "25", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: GREEN_ACCENT + "50" }}>
                        <Text style={{ color: GREEN_ACCENT, fontSize: 13, fontWeight: "800" }}>{countdownLabel} away</Text>
                      </View>
                    </View>
                    {/* Service + business */}
                    <View style={{ gap: 2 }}>
                      <Text style={{ color: TEXT_PRIMARY, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 }} numberOfLines={1}>{nextAppt.serviceName}</Text>
                      <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: "500" }} numberOfLines={1}>{nextAppt.businessName}</Text>
                    </View>
                    {/* Date/time row */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <IconSymbol name="calendar" size={14} color={TEXT_MUTED} />
                      <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>{countdownSub}</Text>
                    </View>
                    {/* Staff row */}
                    {nextAppt.staffName ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <IconSymbol name="person.fill" size={14} color={TEXT_MUTED} />
                        <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>{nextAppt.staffName}</Text>
                      </View>
                    ) : null}
                    {/* Bottom row: address + directions button */}
                    {address ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
                        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <IconSymbol name="mappin" size={13} color={TEXT_MUTED} />
                          <Text style={{ color: TEXT_MUTED, fontSize: 12, flex: 1 }} numberOfLines={1}>{address}</Text>
                        </View>
                        <Pressable
                          style={({ pressed }) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 5,
                            backgroundColor: GREEN_ACCENT,
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            opacity: pressed ? 0.8 : 1,
                          })}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            handleDirections();
                          }}
                        >
                          <IconSymbol name="arrow.triangle.turn.up.right.diamond.fill" size={13} color="#1A3A28" />
                          <Text style={{ color: "#1A3A28", fontSize: 12, fontWeight: "700" }}>Directions</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </LinearGradient>
                </AnimCard>
              </Animated.View>
            );
          })()}
          {/* Upcoming Appointments */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {state.appointments.length > 0 && (
                <AnimCard onPress={() => router.push("/(client-tabs)/bookings" as any)}>
                  <Text style={styles.seeAll}>See all</Text>
                </AnimCard>
              )}
            </View>

            {loading ? (
              <ActivityIndicator color={GREEN_ACCENT} style={{ marginTop: 24 }} />
            ) : upcoming.length === 0 ? (
              <View style={styles.emptyCard}>
                <IconSymbol name="calendar" size={28} color={TEXT_MUTED} />
                <Text style={[styles.emptyText, { color: TEXT_MUTED }]}>No upcoming appointments</Text>
                <AnimCard onPress={() => router.push("/(client-tabs)/discover" as any)}>
                  <View style={styles.emptyBtn}>
                    <Text style={{ color: GREEN_ACCENT, fontWeight: "600", fontSize: 14 }}>Book Now</Text>
                  </View>
                </AnimCard>
              </View>
            ) : (
              upcoming.map((appt) => (
                <AnimCard
                  key={appt.id}
                  onPress={() => router.push({ pathname: "/client-appointment-detail", params: { id: String(appt.id) } } as any)}
                  style={{ marginBottom: 10 }}
                >
                  <View style={styles.apptCard}>
                    <View style={[styles.apptAccent, { backgroundColor: statusColor(appt.status) }]} />
                    {/* Service or business photo thumbnail */}
                    {((appt as any).servicePhotoUri || (appt as any).businessLogoUri) && (
                      <Image
                        source={{ uri: (appt as any).servicePhotoUri ?? (appt as any).businessLogoUri }}
                        style={{ width: 52, height: 52, borderRadius: 10, marginLeft: 8, marginRight: 6 }}
                        resizeMode="cover"
                      />
                    )}
                    <View style={styles.apptLeft}>
                      <Text style={styles.apptService}>{appt.serviceName}</Text>
                      <Text style={[styles.apptBusiness, { color: TEXT_MUTED }]}>{appt.businessName}</Text>
                      <Text style={[styles.apptDate, { color: TEXT_MUTED }]}>
                        {formatDate(appt.date)} · {appt.time}
                        {appt.staffName ? ` · ${appt.staffName}` : ""}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(appt.status) + "25" }]}>
                      <Text style={[styles.statusText, { color: statusColor(appt.status) }]}>
                        {statusLabel(appt.status)}
                      </Text>
                    </View>
                  </View>
                </AnimCard>
              ))
            )}
          </View>

          {/* Saved Businesses */}
          {state.savedBusinesses.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Saved</Text>
                <AnimCard onPress={() => router.push("/client-saved-businesses" as any)}>
                  <Text style={styles.seeAll}>See all</Text>
                </AnimCard>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 2 }}>
                {state.savedBusinesses.slice(0, 6).map((biz) => (
                  <AnimCard
                    key={biz.id}
                    onPress={() => router.push({ pathname: "/client-business-detail", params: { slug: biz.businessSlug } } as any)}
                  >
                    <View style={styles.savedCard}>
                      {/* Business logo or fallback icon */}
                      {(biz as any).businessLogoUri ? (
                        <Image
                          source={{ uri: (biz as any).businessLogoUri }}
                          style={styles.savedLogo}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.savedIcon}>
                          <IconSymbol name="building.2" size={22} color={GREEN_ACCENT} />
                        </View>
                      )}
                      {/* Business name */}
                      <Text style={styles.savedName} numberOfLines={2}>{biz.businessName}</Text>
                      {/* Category */}
                      {biz.businessCategory && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN_ACCENT }} />
                          <Text style={[styles.savedCat, { color: GREEN_ACCENT }]} numberOfLines={1}>{biz.businessCategory}</Text>
                        </View>
                      )}
                      {/* Address */}
                      {(biz as any).businessAddress && (
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 }}>
                          <IconSymbol name="location" size={10} color={TEXT_MUTED} style={{ marginTop: 1 }} />
                          <Text style={[styles.savedCat, { color: TEXT_MUTED, flex: 1 }]} numberOfLines={2}>{(biz as any).businessAddress}</Text>
                        </View>
                      )}
                      {/* Phone */}
                      {(biz as any).businessPhone && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
                          <IconSymbol name="phone.fill" size={10} color={TEXT_MUTED} />
                          <Text style={[styles.savedCat, { color: TEXT_MUTED }]} numberOfLines={1}>{(biz as any).businessPhone}</Text>
                        </View>
                      )}
                      {/* Book button */}
                      <View style={{ marginTop: 6, backgroundColor: GREEN_ACCENT + "20", borderRadius: 8, paddingVertical: 5, alignItems: "center" }}>
                        <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "700" }}>Book Now</Text>
                      </View>
                    </View>
                  </AnimCard>
                ))}
              </ScrollView>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

// ─── Guest Banner ─────────────────────────────────────────────────────────────
function GuestBanner({ router }: { router: any }) {
  const logoScale = useSharedValue(0.5);
  const logoOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(20);
  const btnsOpacity = useSharedValue(0);
  const btnsY = useSharedValue(20);
  const slideX = useSharedValue(0);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    logoScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    textOpacity.value = withDelay(250, withTiming(1, { duration: 450 }));
    textY.value = withDelay(250, withSpring(0, { damping: 18, stiffness: 100 }));
    btnsOpacity.value = withDelay(450, withTiming(1, { duration: 400 }));
    btnsY.value = withDelay(450, withSpring(0, { damping: 18, stiffness: 100 }));
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const btnsStyle = useAnimatedStyle(() => ({
    opacity: btnsOpacity.value,
    transform: [{ translateY: btnsY.value }],
  }));
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideX.value }],
  }));

  function navigateBack() {
    slideX.value = withTiming(SCREEN_W, { duration: 280, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(router.replace)("/profile-select");
    });
  }

  return (
    <Animated.View style={[styles.guestContainer, slideStyle]}>
      <Animated.View style={[styles.guestLogoWrap, logoStyle]}>
        <View style={styles.guestLogoCircle}>
          <Image source={require("@/assets/images/icon.png")} style={{ width: 72, height: 72, borderRadius: 20 }} resizeMode="contain" />
        </View>
        <View style={styles.guestLogoRing} />
      </Animated.View>

      <Animated.View style={[{ alignItems: "center", gap: 6 }, textStyle]}>
        <Text style={{ color: GREEN_ACCENT, fontSize: 13, fontWeight: "700", letterSpacing: 2 }}>LIME OF TIME</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <View style={{ height: 1, width: 28, backgroundColor: "rgba(143,191,106,0.4)" }} />
          <Text style={{ color: "rgba(143,191,106,0.7)", fontSize: 10, fontWeight: "500", letterSpacing: 1.5 }}>BY INNOVANCIO</Text>
          <View style={{ height: 1, width: 28, backgroundColor: "rgba(143,191,106,0.4)" }} />
        </View>
        <Text style={styles.guestTitle}>Book Appointments{"\n"}Near You</Text>
        <Text style={styles.guestSubtitle}>
          Discover local services, book instantly, and manage all your appointments in one place.
        </Text>
      </Animated.View>

      <Animated.View style={[{ width: "100%", gap: 12, marginTop: 8 }, btnsStyle]}>
        <AnimCard onPress={() => router.push("/client-signin" as any)}>
          <LinearGradient
            colors={[GREEN_ACCENT, "#6aaa4a"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.guestPrimaryBtn}
          >
            <Text style={styles.guestPrimaryBtnText}>Get Started</Text>
          </LinearGradient>
        </AnimCard>
        <AnimCard onPress={() => router.push("/(client-tabs)/discover" as any)}>
          <View style={styles.guestSecondaryBtn}>
            <Text style={styles.guestSecondaryBtnText}>Browse Without Account</Text>
          </View>
        </AnimCard>
        <AnimCard onPress={navigateBack}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 }}>
            <IconSymbol name="chevron.left" size={14} color={TEXT_MUTED} />
            <Text style={{ color: TEXT_MUTED, fontSize: 14, fontWeight: "500" }}>Back to Portal Selection</Text>
          </View>
        </AnimCard>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greetingLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: TEXT_MUTED,
    marginBottom: 1,
  },
  greeting: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: TEXT_PRIMARY,
  },
  greetingSub: {
    fontSize: 13,
    marginTop: 3,
    color: TEXT_MUTED,
  },
  avatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: GREEN_ACCENT,
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  nudgeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "rgba(143,191,106,0.1)",
    borderColor: "rgba(143,191,106,0.25)",
  },
  nudgeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(143,191,106,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  nudgeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: GREEN_ACCENT,
  },
  reviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "rgba(255,210,0,0.1)",
    borderColor: "rgba(255,210,0,0.3)",
  },
  reviewBannerTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  reviewBannerSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
    marginTop: 1,
  },
  quickActions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
  },
  quickBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
  quickBtnOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  quickBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },
  seeAll: {
    fontSize: 14,
    fontWeight: "600",
    color: GREEN_ACCENT,
  },
  emptyCard: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "500",
  },
  emptyBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GREEN_ACCENT + "60",
  },
  apptCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  apptAccent: {
    width: 4,
    alignSelf: "stretch",
  },
  apptLeft: {
    flex: 1,
    padding: 12,
    gap: 3,
  },
  apptService: {
    fontSize: 15,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  apptBusiness: {
    fontSize: 13,
    fontWeight: "500",
  },
  apptDate: {
    fontSize: 12,
  },
  statusBadge: {
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  savedCard: {
    width: 160,
    borderRadius: 14,
    padding: 12,
    gap: 4,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  savedLogo: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "rgba(143,191,106,0.1)",
    marginBottom: 2,
  },
  savedIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "rgba(143,191,106,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  savedName: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    lineHeight: 17,
  },
  savedCat: {
    fontSize: 11,
  },
  // Guest styles
  guestContainer: {
    alignItems: "center",
    gap: 24,
  },
  guestLogoWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  guestLogoCircle: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  guestLogoRing: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.3)",
  },
  guestTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    textAlign: "center",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  guestSubtitle: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  guestPrimaryBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  guestPrimaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: GREEN_DARK,
  },
  guestSecondaryBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.4)",
    backgroundColor: "rgba(143,191,106,0.08)",
  },
  guestSecondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: GREEN_ACCENT,
  },
});
