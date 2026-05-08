/**
 * Client Portal — Appointment Detail Screen
 *
 * Shows full appointment details, cancel/reschedule request options,
 * and a link to the message thread.
 *
 * Design: dark forest-green portal aesthetic matching all other client portal screens.
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useClientStore, ClientAppointment } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as Calendar from "expo-calendar";

// ─── Portal palette ───────────────────────────────────────────────────────────
const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

// Status colours (all on dark background)
const STATUS_COLORS: Record<string, string> = {
  confirmed: "#4ADE80",
  pending: "#FBBF24",
  completed: "rgba(255,255,255,0.45)",
  cancelled: "#F87171",
  no_show: "#F87171",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(status: ClientAppointment["status"]): string {
  switch (status) {
    case "confirmed": return "Confirmed";
    case "pending": return "Pending Approval";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "no_show": return "No Show";
    default: return status;
  }
}

export default function ClientAppointmentDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, new: isNew, review: openReview } = useLocalSearchParams<{ id: string; new?: string; review?: string }>();
  const { apiCall } = useClientStore();
  const [appt, setAppt] = useState<ClientAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  // ── Review state ──────────────────────────────────────────────────────────
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<ClientAppointment>(`/api/client/appointments/${id}`);
        setAppt(data);
        // Check if already reviewed (only for completed appointments)
        if (data.status === "completed") {
          try {
            const check = await apiCall<{ reviewed: boolean }>(`/api/client/reviews/check/${id}`);
            setAlreadyReviewed(check.reviewed);
          } catch {
            // Non-fatal — just don't show the review button
          }
        }
      } catch (err) {
        console.warn("[ApptDetail] load error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);
  // Auto-open review modal when navigated from push notification
  useEffect(() => {
    if (openReview === "1" && !loading && appt?.status === "completed" && !alreadyReviewed) {
      setReviewModalVisible(true);
    }
  }, [openReview, loading, appt?.status, alreadyReviewed]);


  const handleSubmitReview = useCallback(async () => {
    if (!appt || reviewRating < 1) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmittingReview(true);
    try {
      await apiCall("/api/client/reviews", {
        method: "POST",
        body: JSON.stringify({
          businessOwnerId: appt.businessOwnerId,
          appointmentId: id,
          rating: reviewRating,
          comment: reviewComment.trim() || null,
        }),
      });
      setReviewSuccess(true);
      setAlreadyReviewed(true);
      setTimeout(() => {
        setReviewModalVisible(false);
        setReviewSuccess(false);
      }, 1800);
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not submit review.");
    } finally {
      setSubmittingReview(false);
    }
  }, [appt, id, reviewRating, reviewComment, apiCall]);

  const handleAddToCalendar = async () => {
    if (!appt) return;
    try {
      if (Platform.OS === "web") {
        Alert.alert("Not supported", "Calendar integration is not available on web.");
        return;
      }
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please allow calendar access to add this appointment.");
        return;
      }
      // Build start/end dates
      const [year, month, day] = appt.date.split("-").map(Number);
      const [hourStr, minuteStr] = appt.time.replace(/[AP]M/i, "").trim().split(":");
      let hour = parseInt(hourStr, 10);
      const minute = parseInt(minuteStr ?? "0", 10);
      if (appt.time.toLowerCase().includes("pm") && hour !== 12) hour += 12;
      if (appt.time.toLowerCase().includes("am") && hour === 12) hour = 0;
      const startDate = new Date(year, month - 1, day, hour, minute);
      const endDate = new Date(startDate.getTime() + (appt.duration ?? 60) * 60 * 1000);
      // Get default calendar
      let calendarId: string;
      if (Platform.OS === "ios") {
        const defaultCal = await Calendar.getDefaultCalendarAsync();
        calendarId = defaultCal.id;
      } else {
        const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const primary = cals.find(c => c.isPrimary) ?? cals[0];
        if (!primary) { Alert.alert("No calendar", "No calendar found on this device."); return; }
        calendarId = primary.id;
      }
      const notes = [
        appt.staffName ? `Staff: ${appt.staffName}` : null,
        appt.locationName ? `Location: ${appt.locationName}` : null,
        appt.locationAddress ? appt.locationAddress : null,
        (appt as any).locationPhone ? `Phone: ${(appt as any).locationPhone}` : null,
      ].filter(Boolean).join("\n");
      await Calendar.createEventAsync(calendarId, {
        title: `${appt.serviceName} @ ${appt.businessName}`,
        startDate,
        endDate,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: appt.locationAddress ?? undefined,
        notes: notes || undefined,
        alarms: [{ relativeOffset: -60 }, { relativeOffset: -1440 }],
      });
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Added!", `"${appt.serviceName}" has been added to your calendar with reminders.`);
    } catch (err: any) {
      console.warn("[Calendar]", err);
      Alert.alert("Error", "Could not add to calendar. Please try again.");
    }
  };
  const handleCancelRequest = () => {
    Alert.alert(
      "Request Cancellation",
      "Send a cancellation request to the business? They will need to approve it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Request",
          style: "destructive",
          onPress: async () => {
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setRequesting(true);
            try {
              await apiCall(`/api/client/appointments/${id}/cancel-request`, { method: "POST" });
              const updated = await apiCall<ClientAppointment>(`/api/client/appointments/${id}`);
              setAppt(updated);
            } catch (err: any) {
              Alert.alert("Error", err?.message ?? "Could not send request.");
            } finally {
              setRequesting(false);
            }
          },
        },
      ]
    );
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <StatusBar style="light" />
        <ClientPortalBackground />
      {/* Drag handle */}
      <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
      </View>

        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={GREEN_ACCENT} />
        </View>
      </View>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!appt) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <View style={styles.loadingContainer}>
          <Text style={{ color: TEXT_MUTED, marginBottom: 16 }}>Appointment not found.</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: GREEN_ACCENT, fontWeight: "700" }}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const canCancel = appt.status === "confirmed" || appt.status === "pending";
  const hasPendingCancel = appt.cancelRequest?.status === "pending";
  const hasPendingReschedule = appt.rescheduleRequest?.status === "pending";
  const statusColor = STATUS_COLORS[appt.status] ?? TEXT_MUTED;
  const isCompleted = appt.status === "completed";

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={styles.headerTitle}>Appointment</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── New booking success banner ──────────────────────────────── */}
        {isNew === "1" && (
          <View style={styles.successBanner}>
            <IconSymbol name="checkmark.circle.fill" size={20} color={GREEN_ACCENT} />
            <Text style={styles.successText}>
              Booking request sent! The business will confirm shortly.
            </Text>
          </View>
        )}

        {/* ── Status Badge ─────────────────────────────────────────────── */}
        <View style={[styles.statusCard, { backgroundColor: statusColor + "22", borderColor: statusColor + "44" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel(appt.status)}</Text>
        </View>

        {/* ── Main Info Card ───────────────────────────────────────────── */}
        <View style={styles.card}>
          {/* Service + Business */}
          <Text style={styles.serviceName}>{appt.serviceName}</Text>
          <Text style={styles.businessName}>{appt.businessName}</Text>

          <View style={styles.divider} />

          <InfoRow icon="calendar" label="Date" value={formatDate(appt.date)} />
          <InfoRow icon="clock" label="Time" value={appt.time} />
          {appt.duration ? (
            <InfoRow icon="hourglass" label="Duration" value={`${appt.duration} min`} />
          ) : null}
          {appt.staffName ? (
            <StaffRow name={appt.staffName} avatarUrl={appt.staffAvatarUrl ?? null} />
          ) : null}
          {appt.totalPrice != null ? (
            <InfoRow
              icon="creditcard.fill"
              label="Price"
              value={`$${parseFloat(appt.totalPrice).toFixed(2)}`}
            />
          ) : null}
          {appt.locationName ? (
            <InfoRow icon="building.2.fill" label="Business" value={appt.locationName} />
          ) : null}
          {appt.locationAddress ? (
            <AddressRow address={appt.locationAddress} />
          ) : null}
          {(appt as any).locationPhone ? (
            <Pressable
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }, pressed && { opacity: 0.7 }]}
              onPress={() => Linking.openURL(`tel:${(appt as any).locationPhone.replace(/\D/g, "")}`)}
            >
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(143,191,106,0.15)", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                <IconSymbol name="phone" size={14} color="#8FBF6A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Phone</Text>
                <Text style={{ fontSize: 15, color: "#8FBF6A", textDecorationLine: "underline" }}>
                  {(() => { const d = (appt as any).locationPhone.replace(/\D/g, ""); return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : d.length === 11 ? `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}` : (appt as any).locationPhone; })()}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={14} color="rgba(143,191,106,0.6)" />
            </Pressable>
          ) : null}
          {appt.notes ? (
            <InfoRow icon="note.text" label="Notes" value={appt.notes} />
          ) : null}
        </View>

        {/* ── Review Prompt (completed only) ───────────────────────────── */}
        {isCompleted && !alreadyReviewed && (
          <View style={styles.reviewPromptCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Text style={{ fontSize: 22 }}>⭐</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY }}>
                  How was your experience?
                </Text>
                <Text style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>
                  Share your feedback with {appt.businessName}
                </Text>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setReviewModalVisible(true);
              }}
            >
              <Text style={styles.reviewBtnText}>Leave a Review</Text>
            </Pressable>
          </View>
        )}

        {isCompleted && alreadyReviewed && (
          <View style={[styles.reviewPromptCard, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <IconSymbol name="checkmark.circle.fill" size={20} color={GREEN_ACCENT} />
            <Text style={{ fontSize: 14, color: GREEN_ACCENT, fontWeight: "600" }}>
              You reviewed this appointment. Thank you!
            </Text>
          </View>
        )}

        {/* ── Pending request banners ──────────────────────────────────── */}
        {hasPendingCancel && (
          <View style={[styles.requestBanner, { borderColor: "#FBBF2440" }]}>
            <IconSymbol name="clock" size={16} color="#FBBF24" />
            <Text style={[styles.requestBannerText, { color: "#FBBF24" }]}>
              Cancellation request pending — awaiting business response.
            </Text>
          </View>
        )}
        {hasPendingReschedule && (
          <View style={[styles.requestBanner, { borderColor: "#FBBF2440" }]}>
            <IconSymbol name="clock" size={16} color="#FBBF24" />
            <Text style={[styles.requestBannerText, { color: "#FBBF24" }]}>
              Reschedule request pending — awaiting business response.
            </Text>
          </View>
        )}

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <View style={styles.actions}>
          {/* Message Business */}
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnPrimary,
              pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => router.push({
              pathname: "/client-message-thread",
              params: {
                businessOwnerId: String(appt.businessOwnerId),
                businessName: appt.businessName,
                serviceName: appt.serviceName,
                appointmentDate: appt.date,
              },
            } as any)}
          >
            <IconSymbol name="text.bubble.fill" size={18} color={GREEN_DARK} />
            <Text style={[styles.actionBtnText, { color: GREEN_DARK }]}>Message Business</Text>
          </Pressable>

          {/* Cancel Request */}
          {canCancel && !hasPendingCancel && !hasPendingReschedule && (
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionBtnDanger,
                pressed && { opacity: 0.85 },
                requesting && { opacity: 0.6 },
              ]}
              onPress={handleCancelRequest}
              disabled={requesting}
            >
              {requesting ? (
                <ActivityIndicator size="small" color="#F87171" />
              ) : (
                <IconSymbol name="xmark.circle" size={18} color="#F87171" />
              )}
              <Text style={[styles.actionBtnText, { color: "#F87171" }]}>Request Cancellation</Text>
            </Pressable>
          )}

          {/* Add to Calendar */}
          {(appt.status === "confirmed" || appt.status === "pending") && (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, { backgroundColor: "rgba(143,191,106,0.12)", borderColor: "rgba(143,191,106,0.3)", borderWidth: 1 }, pressed && { opacity: 0.85 }]}
              onPress={handleAddToCalendar}
            >
              <IconSymbol name="calendar.badge.plus" size={18} color={GREEN_ACCENT} />
              <Text style={[styles.actionBtnText, { color: GREEN_ACCENT }]}>Add to Calendar</Text>
            </Pressable>
          )}
          {/* View Business */}
          {appt.businessSlug ? (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionBtnGhost, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({
                pathname: "/client-business-detail",
                params: { slug: appt.businessSlug },
              } as any)}
            >
              <IconSymbol name="safari.fill" size={18} color={TEXT_MUTED} />
              <Text style={[styles.actionBtnText, { color: TEXT_MUTED }]}>View Business</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {/* ── Review Modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !submittingReview && setReviewModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: GREEN_DARK, padding: 24 }}>
          <ClientPortalBackground />

          {/* Modal Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24, marginTop: 12 }}>
            <Pressable
              onPress={() => !submittingReview && setReviewModalVisible(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontSize: 16, color: TEXT_MUTED }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: "700", color: TEXT_PRIMARY }}>Leave a Review</Text>
            <View style={{ width: 60 }} />
          </View>

          {reviewSuccess ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
              <Text style={{ fontSize: 20, fontWeight: "700", color: GREEN_ACCENT, textAlign: "center" }}>
                Thank you!
              </Text>
              <Text style={{ fontSize: 14, color: TEXT_MUTED, marginTop: 8, textAlign: "center" }}>
                Your review has been submitted.
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Business info */}
              <View style={{ alignItems: "center", marginBottom: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: TEXT_PRIMARY, textAlign: "center" }}>
                  {appt?.businessName}
                </Text>
                <Text style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 4, textAlign: "center" }}>
                  {appt?.serviceName} · {appt ? formatDate(appt.date) : ""}
                </Text>
              </View>

              {/* Star Rating */}
              <Text style={{ fontSize: 13, color: TEXT_MUTED, textAlign: "center", marginTop: 16, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>
                Your Rating
              </Text>
              <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginVertical: 12 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setReviewRating(star);
                    }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontSize: 36, color: star <= reviewRating ? "#FBBF24" : "rgba(255,255,255,0.25)" }}>
                      ★
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Rating label */}
              <Text style={{ textAlign: "center", fontSize: 14, color: GREEN_ACCENT, fontWeight: "600", marginBottom: 20 }}>
                {reviewRating === 1 ? "Poor" : reviewRating === 2 ? "Fair" : reviewRating === 3 ? "Good" : reviewRating === 4 ? "Very Good" : "Excellent"}
              </Text>

              {/* Comment */}
              <Text style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>
                Comments (optional)
              </Text>
              <TextInput
                value={reviewComment}
                onChangeText={setReviewComment}
                placeholder="Share your experience..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                multiline
                style={{
                  backgroundColor: CARD_BG,
                  borderRadius: 14,
                  padding: 14,
                  fontSize: 15,
                  color: TEXT_PRIMARY,
                  minHeight: 100,
                  borderWidth: 1,
                  borderColor: CARD_BORDER,
                  textAlignVertical: "top",
                }}
              />

              {/* Submit */}
              <Pressable
                style={({ pressed }) => ({
                  backgroundColor: GREEN_ACCENT,
                  borderRadius: 14,
                  paddingVertical: 16,
                  alignItems: "center",
                  marginTop: 24,
                  marginBottom: 32,
                  opacity: pressed || submittingReview ? 0.8 : 1,
                })}
                onPress={handleSubmitReview}
                disabled={submittingReview || reviewRating < 1}
              >
                {submittingReview ? (
                  <ActivityIndicator size="small" color={GREEN_DARK} />
                ) : (
                  <Text style={{ fontSize: 16, fontWeight: "700", color: GREEN_DARK }}>
                    Submit Review
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function StaffRow({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <View style={[infoStyles.row, { alignItems: "center" }]}>
      <View style={{ width: 36, height: 36, borderRadius: 18, overflow: "hidden", marginRight: 12, backgroundColor: "rgba(143,191,106,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(143,191,106,0.35)" }}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={{ width: 36, height: 36 }} contentFit="cover" />
        ) : (
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#8FBF6A" }}>{initials}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={infoStyles.label}>Staff</Text>
        <Text style={infoStyles.value}>{name}</Text>
      </View>
    </View>
  );
}
function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={infoStyles.row}>
      <View style={infoStyles.iconWrap}>
        <IconSymbol name={icon as any} size={14} color={GREEN_ACCENT} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={infoStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

function AddressRow({ address }: { address: string }) {
  const openMaps = () => {
    const encoded = encodeURIComponent(address);
    const url = Platform.OS === "ios"
      ? `maps://?q=${encoded}`
      : `geo:0,0?q=${encoded}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        // Fallback to Google Maps web
        Linking.openURL(`https://maps.google.com/?q=${encoded}`);
      }
    });
  };

  return (
    <Pressable
      style={({ pressed }) => [infoStyles.row, pressed && { opacity: 0.7 }]}
      onPress={openMaps}
    >
      <View style={infoStyles.iconWrap}>
        <IconSymbol name="mappin" size={14} color={GREEN_ACCENT} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={infoStyles.label}>Address</Text>
        <Text style={[infoStyles.value, { color: "#8FBF6A", textDecorationLine: "underline" }]}>
          {address}
        </Text>
        <Text style={{ fontSize: 11, color: "rgba(143,191,106,0.7)", marginTop: 2 }}>
          Tap to open in Maps
        </Text>
      </View>
      <IconSymbol name="arrow.up.right" size={14} color="rgba(143,191,106,0.6)" />
    </Pressable>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(143,191,106,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: TEXT_MUTED,
    marginBottom: 2,
  },
  value: {
    fontSize: 14,
    fontWeight: "500",
    color: TEXT_PRIMARY,
    lineHeight: 20,
  },
});

const styles = StyleSheet.create({
  // ─── Loading ──────────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // ─── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  // ─── Scroll Content ───────────────────────────────────────────────────────
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  // ─── Success Banner ───────────────────────────────────────────────────────
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
    backgroundColor: "rgba(143,191,106,0.12)",
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.25)",
  },
  successText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: GREEN_ACCENT,
    fontWeight: "600",
  },
  // ─── Status Card ──────────────────────────────────────────────────────────
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "700",
  },
  // ─── Main Card ────────────────────────────────────────────────────────────
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    marginBottom: 16,
  },
  serviceName: {
    fontSize: 22,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  businessName: {
    fontSize: 14,
    fontWeight: "600",
    color: GREEN_ACCENT,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: CARD_BORDER,
    marginBottom: 4,
  },
  // ─── Request Banners ──────────────────────────────────────────────────────
  requestBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    backgroundColor: "rgba(251,191,36,0.08)",
  },
  requestBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  // ─── Actions ──────────────────────────────────────────────────────────────
  actions: {
    gap: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionBtnPrimary: {
    backgroundColor: GREEN_ACCENT,
    shadowColor: GREEN_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  actionBtnDanger: {
    backgroundColor: CARD_BG,
    borderWidth: 1.5,
    borderColor: "#F8717140",
  },
  actionBtnGhost: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  reviewPromptCard: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  reviewBtn: {
    backgroundColor: "#4ADE80",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center" as const,
    marginTop: 4,
  },
  reviewBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0d2e1a",
  },
});
