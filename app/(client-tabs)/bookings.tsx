/**
 * Client Portal — My Bookings Tab
 *
 * Lists all client appointments grouped by status with filter tabs.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Image,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/use-colors";
import { useClientStore, ClientAppointment } from "@/lib/client-store";
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

type FilterTab = "upcoming" | "past" | "all";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

function statusColor(status: ClientAppointment["status"]) {
  switch (status) {
    case "confirmed": return "#6EE7B7";
    case "pending": return "#FCD34D";
    case "completed": return "rgba(255,255,255,0.5)";
    case "cancelled":
    case "no_show": return "#FCA5A5";
    default: return "rgba(255,255,255,0.5)";
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

function isUpcoming(appt: ClientAppointment): boolean {
  return appt.status === "confirmed" || appt.status === "pending";
}

export default function BookingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, apiCall } = useClientStore();
  const [activeTab, setActiveTab] = useState<FilterTab>("upcoming");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Review modal state
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewAppt, setReviewAppt] = useState<ClientAppointment | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const loadAppointments = useCallback(async (silent = false) => {
    if (!state.account) return;
    if (!silent) setLoading(true);
    try {
      const raw = await apiCall<{ appointments: ClientAppointment[] } | ClientAppointment[]>("/api/client/appointments");
      const appts: ClientAppointment[] = Array.isArray(raw) ? raw : (raw as any).appointments ?? [];
      dispatch({ type: "SET_APPOINTMENTS", payload: appts });
    } catch (err) {
      console.warn("[Bookings] load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [state.account, apiCall, dispatch]);

  useFocusEffect(useCallback(() => { loadAppointments(true); }, [loadAppointments]));

  const openReviewModal = (appt: ClientAppointment) => {
    setReviewAppt(appt);
    setReviewRating(5);
    setReviewComment("");
    setReviewModalVisible(true);
  };

  const submitReview = async () => {
    if (!reviewAppt) return;
    setSubmittingReview(true);
    try {
      const apiBase = (await import("@/constants/oauth")).getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/public/business/${reviewAppt.businessSlug}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: state.account?.name ?? "Guest",
          clientPhone: state.account?.phone ?? "",
          rating: reviewRating,
          comment: reviewComment.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit review");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReviewModalVisible(false);
      Alert.alert("Thank you!", "Your review has been submitted.");
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not submit review. Please try again.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadAppointments(); };

  const filteredAppts = state.appointments.filter((a) => {
    if (activeTab === "upcoming") return isUpcoming(a);
    if (activeTab === "past") return !isUpcoming(a);
    return true;
  }).sort((a, b) => {
    if (activeTab === "upcoming") return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });

  // Entrance animation
  const headerOpacity = useSharedValue(0);
  const headerY = useSharedValue(-16);
  React.useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    headerY.value = withSpring(0, { damping: 18, stiffness: 120 });
  }, []);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));

  const s = styles(colors);

  if (!state.account) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <View style={[s.guestContainer, { paddingTop: insets.top }]}>
          <View style={s.guestLogoWrap}>
            <Image
              source={require("@/assets/images/icon.png")}
              style={{ width: 64, height: 64, borderRadius: 18 }}
              resizeMode="contain"
            />
          </View>
          <Text style={[s.guestTitle, { color: TEXT_PRIMARY }]}>Sign in to see your bookings</Text>
          <Text style={[s.guestSub, { color: TEXT_MUTED }]}>Track all your upcoming and past appointments in one place.</Text>
          <Pressable
            style={({ pressed }) => [s.signInBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/client-signin" as any)}
          >
            <LinearGradient
              colors={["#4A7C59", "#2D5A3D"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.signInBtnGradient}
            >
              <Text style={s.signInBtnText}>Sign In</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />
      {/* Header */}
      <Animated.View style={[s.header, headerStyle, { paddingTop: insets.top + 16 }]}>
        <Text style={s.title}>My Bookings</Text>
      </Animated.View>

      {/* Filter Tabs */}
      <View style={[s.tabRow, { borderBottomColor: CARD_BORDER }]}>
        {(["upcoming", "past", "all"] as FilterTab[]).map((tab) => (
          <Pressable
            key={tab}
            style={[s.tab, activeTab === tab && { borderBottomColor: GREEN_ACCENT, borderBottomWidth: 2 }]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(tab);
            }}
          >
            <Text style={[s.tabText, { color: activeTab === tab ? GREEN_ACCENT : TEXT_MUTED }]}>
              {tab === "upcoming" ? "Upcoming" : tab === "past" ? "Past" : "All"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color={GREEN_ACCENT} />
        </View>
      ) : (
        <FlatList
          data={filteredAppts}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_ACCENT} />}
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <View style={s.emptyLogoWrap}>
                <Image
                  source={require("@/assets/images/icon.png")}
                  style={{ width: 56, height: 56, borderRadius: 16 }}
                  resizeMode="contain"
                />
              </View>
              <Text style={[s.emptyTitle, { color: TEXT_PRIMARY }]}>
                {activeTab === "upcoming" ? "No upcoming appointments" : "No appointments yet"}
              </Text>
              <Text style={[s.emptySub, { color: TEXT_MUTED }]}>
                {activeTab === "upcoming"
                  ? "Discover local services and book your first appointment."
                  : "Your booking history will appear here."}
              </Text>
              {activeTab === "upcoming" && (
                <Pressable
                  style={({ pressed }) => [s.bookNowBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => router.push("/(client-tabs)/discover" as any)}
                >
                  <LinearGradient
                    colors={["#4A7C59", "#2D5A3D"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.bookNowBtnGradient}
                  >
                    <Text style={s.bookNowBtnText}>Discover Services</Text>
                  </LinearGradient>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                s.apptCard,
                { backgroundColor: CARD_BG, borderColor: CARD_BORDER },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/client-appointment-detail", params: { id: String(item.id) } } as any);
              }}
            >
              <View style={s.apptTop}>
                <View style={s.apptInfo}>
                  <Text style={[s.apptService, { color: TEXT_PRIMARY }]}>{item.serviceName}</Text>
                  <Text style={[s.apptBusiness, { color: GREEN_ACCENT }]}>{item.businessName}</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + "30" }]}>
                  <Text style={[s.statusText, { color: statusColor(item.status) }]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              </View>
              <View style={[s.apptDivider, { backgroundColor: CARD_BORDER }]} />
              <View style={s.apptMeta}>
                <View style={s.metaItem}>
                  <IconSymbol name="calendar" size={13} color={TEXT_MUTED} />
                  <Text style={[s.metaText, { color: TEXT_MUTED }]}>{formatDate(item.date)}</Text>
                </View>
                <View style={s.metaItem}>
                  <IconSymbol name="clock" size={13} color={TEXT_MUTED} />
                  <Text style={[s.metaText, { color: TEXT_MUTED }]}>{item.time}</Text>
                </View>
                {item.staffName && (
                  <View style={s.metaItem}>
                    {item.staffAvatarUrl ? (
                      <Image
                        source={{ uri: item.staffAvatarUrl }}
                        style={{ width: 18, height: 18, borderRadius: 9, marginRight: 2 }}
                      />
                    ) : (
                      <View style={[s.staffInitialBadge, { backgroundColor: "#4A7C5920" }]}>
                        <Text style={[s.staffInitialText, { color: "#4A7C59" }]}>
                          {(item.staffName ?? "?").charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text style={[s.metaText, { color: TEXT_MUTED }]}>{item.staffName}</Text>
                  </View>
                )}
              </View>
              {/* Cancel/Reschedule request badge */}
              {(item.cancelRequest?.status === "pending" || item.rescheduleRequest?.status === "pending") && (
                <View style={[s.requestBadge, { backgroundColor: "rgba(252,211,77,0.15)" }]}>
                  <IconSymbol name="clock" size={12} color="#FCD34D" />
                  <Text style={[s.requestBadgeText, { color: "#FCD34D" }]}>
                    {item.cancelRequest?.status === "pending" ? "Cancel request pending" : "Reschedule request pending"}
                  </Text>
                </View>
              )}
              {/* Leave a Review button for completed appointments */}
              {item.status === "completed" && (
                <Pressable
                  style={({ pressed }) => [s.reviewBtn, pressed && { opacity: 0.75 }]}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    openReviewModal(item);
                  }}
                >
                  <IconSymbol name="star" size={13} color="#4A7C59" />
                  <Text style={s.reviewBtnText}>Leave a Review</Text>
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 8,
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      color: TEXT_PRIMARY,
    },
    tabRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      marginHorizontal: 16,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabText: {
      fontSize: 14,
      fontWeight: "600",
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyContainer: {
      alignItems: "center",
      paddingTop: 60,
      gap: 12,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
    },

    apptCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 14,
      marginBottom: 12,
      gap: 10,
    },
    apptTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
    apptInfo: {
      flex: 1,
      gap: 3,
    },
    apptService: {
      fontSize: 15,
      fontWeight: "700",
    },
    apptBusiness: {
      fontSize: 13,
      fontWeight: "600",
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      marginLeft: 10,
    },
    statusText: {
      fontSize: 11,
      fontWeight: "700",
    },
    apptDivider: {
      height: 1,
    },
    apptMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    metaText: {
      fontSize: 12,
    },
    requestBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
    },
    requestBadgeText: {
      fontSize: 12,
      fontWeight: "600",
    },
    guestContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    guestTitle: {
      fontSize: 16,
      fontWeight: "600",
      textAlign: "center",
    },
    signInBtn: {
      borderRadius: 24,
      overflow: "hidden" as const,
      marginTop: 4,
    },
    signInBtnGradient: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      alignItems: "center" as const,
      borderRadius: 24,
    },
    signInBtnText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "700" as const,
    },
    guestLogoWrap: {
      width: 88,
      height: 88,
      borderRadius: 24,
      backgroundColor: "rgba(74,124,89,0.12)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: 8,
    },
    guestSub: {
      fontSize: 13,
      textAlign: "center" as const,
      lineHeight: 19,
      paddingHorizontal: 24,
    },
    emptyLogoWrap: {
      width: 80,
      height: 80,
      borderRadius: 22,
      backgroundColor: "rgba(74,124,89,0.12)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: 4,
    },
    emptySub: {
      fontSize: 13,
      textAlign: "center" as const,
      lineHeight: 19,
      paddingHorizontal: 32,
    },
    bookNowBtn: {
      borderRadius: 24,
      overflow: "hidden" as const,
      marginTop: 4,
    },
    bookNowBtnGradient: {
      paddingHorizontal: 28,
      paddingVertical: 12,
      alignItems: "center" as const,
      borderRadius: 24,
    },
    bookNowBtnText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "700" as const,
    },
    staffInitialBadge: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginRight: 2,
    },
    staffInitialText: {
      fontSize: 9,
      fontWeight: "700" as const,
    },
    reviewBtn: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: "rgba(74,124,89,0.12)",
      alignSelf: "flex-start" as const,
    },
    reviewBtnText: {
      color: "#4A7C59",
      fontSize: 12,
      fontWeight: "700" as const,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end" as const,
    },
    modalSheet: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      paddingBottom: 40,
      gap: 12,
    },
    modalHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      marginBottom: 4,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700" as const,
    },
    modalBiz: {
      fontSize: 13,
      marginBottom: 4,
    },
    starsRow: {
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: 8,
      marginVertical: 8,
    },
    starBtn: {
      padding: 4,
    },
    ratingLabel: {
      textAlign: "center" as const,
      fontSize: 13,
      fontWeight: "600" as const,
      marginBottom: 4,
    },
    reviewInput: {
      borderRadius: 12,
      borderWidth: 1,
      padding: 12,
      fontSize: 14,
      minHeight: 90,
    },
    submitReviewBtn: {
      backgroundColor: "#4A7C59",
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center" as const,
      marginTop: 4,
    },
    submitReviewBtnText: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight: "700" as const,
    },
  });
