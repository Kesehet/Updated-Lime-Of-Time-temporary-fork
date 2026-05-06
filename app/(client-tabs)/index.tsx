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
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/use-colors";
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

  const isSignedIn = !!state.account;

  const loadData = useCallback(async (silent = false) => {
    if (!isSignedIn) return;
    if (!silent) setLoading(true);
    try {
      const [appts, saved] = await Promise.all([
        apiCall<ClientAppointment[]>("/api/client/appointments"),
        apiCall<any[]>("/api/client/saved-businesses"),
      ]);
      dispatch({ type: "SET_APPOINTMENTS", payload: appts });
      dispatch({ type: "SET_SAVED_BUSINESSES", payload: saved });
      const msgs = await apiCall<{ unreadCount: number }>("/api/client/messages/unread-count");
      dispatch({ type: "SET_UNREAD_COUNT", payload: msgs.unreadCount });
    } catch (err) {
      console.warn("[ClientHome] load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isSignedIn, apiCall, dispatch]);

  useFocusEffect(useCallback(() => { loadData(true); }, [loadData]));

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const upcoming = state.appointments
    .filter((a) => a.status === "confirmed" || a.status === "pending")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

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
    screenSlideX.value = withTiming(SCREEN_W, { duration: 280, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(router.replace)("/profile-select");
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
        contentContainerStyle={{ paddingBottom: 32, paddingTop: insets.top }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_ACCENT} />}
      >
        {/* Header */}
        <Animated.View style={[styles.header, headerStyle]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greetingLabel}>{getGreeting()},</Text>
            <Text style={styles.greeting}>{state.account?.name?.split(" ")[0] ?? "there"} 👋</Text>
            <Text style={styles.greetingSub}>What are you booking today?</Text>
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
                      <View style={styles.savedIcon}>
                        <IconSymbol name="scissors" size={20} color={GREEN_ACCENT} />
                      </View>
                      <Text style={styles.savedName} numberOfLines={2}>{biz.businessName}</Text>
                      {biz.businessCategory && (
                        <Text style={[styles.savedCat, { color: TEXT_MUTED }]} numberOfLines={1}>{biz.businessCategory}</Text>
                      )}
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
    width: 110,
    borderRadius: 14,
    padding: 12,
    gap: 6,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  savedIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(143,191,106,0.15)",
    alignItems: "center",
    justifyContent: "center",
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
