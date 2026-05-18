/**
 * Client Portal — Appointment Detail Screen
 *
 * Shows full appointment details, cancel/reschedule request options,
 * and a link to the message thread.
 *
 * Design: dark forest-green portal aesthetic matching all other client portal screens.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
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
  KeyboardAvoidingView,
  Share,
  AppState,
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
import { getApiBaseUrl } from "@/constants/oauth";
import { PaymentReceiptModal } from "@/components/payment-receipt-modal";

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

function formatTime12(time: string): string {
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}
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
  const [rescheduleModalVisible, setRescheduleModalVisible] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [submittingReschedule, setSubmittingReschedule] = useState(false);

  // ── Card payment state ─────────────────────────────────────────────────────
  const [payingCard, setPayingCard] = useState(false);
  const [receiptData, setReceiptData] = useState<{
    amount: number;
    serviceName?: string;
    confirmationId?: string;
  } | null>(null);
  // Payment Summary sheet state
  const [showPaymentSummary, setShowPaymentSummary] = useState(false);
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(null);
  // Set to true when we open Stripe in Safari so we check status when app resumes
  const pendingPaymentCheckRef = useRef(false);
  const [pendingCheckoutBreakdown, setPendingCheckoutBreakdown] = useState<{
    serviceAmount: number;
    platformFee: number;
    platformFeePercent: number;
    totalCharged: number;
    stripeFee: number;
    businessNetPayout: number;
  } | null>(null);

  const handlePayWithCard = useCallback(async () => {
    if (!appt || !appt.localId) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPayingCard(true);
    try {
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/stripe-connect/request-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessOwnerId: appt.businessOwnerId,
          appointmentLocalId: appt.localId,
          amount: appt.totalPrice ? parseFloat(String(appt.totalPrice)) : 0,
          clientEmail: undefined,
          description: appt.serviceName ?? "Appointment payment",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Could not prepare payment");
      }
      const data = await res.json();
      if (!data.url) throw new Error("No payment URL returned");
      // Show Payment Summary sheet before opening Stripe Checkout
      const serviceAmount = appt.totalPrice ? parseFloat(String(appt.totalPrice)) : 0;
      const PLATFORM_FEE_PERCENT = 1.5;
      const platformFee = parseFloat((serviceAmount * PLATFORM_FEE_PERCENT / 100).toFixed(2));
      const totalCharged = parseFloat((serviceAmount + platformFee).toFixed(2));
      const stripeFee = parseFloat((totalCharged * 0.029 + 0.30).toFixed(2));
      const businessNetPayout = parseFloat((totalCharged - platformFee - stripeFee).toFixed(2));
      setPendingCheckoutBreakdown({ serviceAmount, platformFee, platformFeePercent: PLATFORM_FEE_PERCENT, totalCharged, stripeFee, businessNetPayout });
      setPendingCheckoutUrl(data.url);
      setPayingCard(false);
      setShowPaymentSummary(true);
    } catch (err: any) {
      Alert.alert("Payment Error", err?.message ?? "Could not open payment page. Please try again.");
      setPayingCard(false);
    }
  }, [appt]);

  const handleConfirmAndPay = useCallback(async () => {
    const url = pendingCheckoutUrl;
    setShowPaymentSummary(false);
    setPendingCheckoutUrl(null);
    setPendingCheckoutBreakdown(null);
    if (!url || !appt) return;
    try {
      if (Platform.OS !== "web") {
        // Mark that we're awaiting payment — AppState listener will check status on return
        pendingPaymentCheckRef.current = true;
        await Linking.openURL(url);
      } else {
        window.location.href = url;
      }
    } catch (err: any) {
      Alert.alert("Payment Error", err?.message ?? "Could not open payment page. Please try again.");
    }
  }, [appt, pendingCheckoutUrl]);

  // ── Review state ──────────────────────────────────────────────────────────
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [showSessionsAccordion, setShowSessionsAccordion] = useState(false);

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

  // ── AppState listener: check payment status immediately when client returns from Safari ──
  useEffect(() => {
    if (!appt || appt.paymentStatus === "paid") return;
    const subscription = AppState.addEventListener("change", async (nextState) => {
      if (nextState === "active" && pendingPaymentCheckRef.current) {
        pendingPaymentCheckRef.current = false;
        try {
          const apiBase = getApiBaseUrl();
          const statusRes = await fetch(
            `${apiBase}/api/stripe-connect/appointment-payment-status?appointmentLocalId=${encodeURIComponent(appt.localId ?? "")}&businessOwnerId=${encodeURIComponent(appt.businessOwnerId)}`,
          ).catch(() => null);
          if (statusRes?.ok) {
            const statusData = await statusRes.json();
            if (statusData.paymentStatus === "paid") {
              setAppt((prev) => prev ? { ...prev, paymentStatus: "paid", paymentMethod: "card" } : prev);
              setReceiptData({
                amount: appt.totalPrice ? parseFloat(String(appt.totalPrice)) : 0,
                serviceName: appt.serviceName,
                confirmationId: appt.localId ?? undefined,
              });
            }
          }
        } catch {
          // Silently ignore
        }
      }
    });
    return () => subscription.remove();
  }, [appt?.localId, appt?.paymentStatus, appt?.businessOwnerId]);


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
  const handleRescheduleRequest = async () => {
    if (!rescheduleDate.trim() || !rescheduleTime.trim()) {
      Alert.alert("Missing Info", "Please enter both a date and time for your reschedule request.");
      return;
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setSubmittingReschedule(true);
    try {
      await apiCall(`/api/client/appointments/${id}/reschedule-request`, {
        method: "POST",
        body: JSON.stringify({ requestedDate: rescheduleDate.trim(), requestedTime: rescheduleTime.trim(), reason: rescheduleReason.trim() || undefined }),
      });
      const updated = await apiCall<ClientAppointment>(`/api/client/appointments/${id}`);
      setAppt(updated);
      setRescheduleModalVisible(false);
      setRescheduleDate("");
      setRescheduleTime("");
      setRescheduleReason("");
      Alert.alert("Request Sent", "Your reschedule request has been sent. The business will respond shortly.");
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not send reschedule request.");
    } finally {
      setSubmittingReschedule(false);
    }
  };
  const handleGetDirections = () => {
    const address = appt?.locationAddress;
    if (!address) return;
    const encoded = encodeURIComponent(address);
    const url = Platform.OS === "ios"
      ? `maps://?q=${encoded}`
      : `https://maps.google.com/?q=${encoded}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.google.com/?q=${encoded}`);
    });
  };
  const handleShareBusiness = async () => {
    if (!appt?.businessSlug) return;
    const url = `https://lime-of-time.com/book/${appt.businessSlug}`;
    try {
      await Share.share({
        message: `Book an appointment with ${appt.businessName}: ${url}`,
        url,
        title: `Book with ${appt.businessName}`,
      });
    } catch { /* user cancelled */ }
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
          <InfoRow icon="clock" label="Time" value={formatTime12(appt.time)} />
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
          {(appt as any).clientAddress ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(10,126,164,0.15)", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                <Text style={{ fontSize: 16 }}>🚗</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Service Address</Text>
                <Text style={{ fontSize: 14, color: "#FFFFFF", fontWeight: "500" }}>{(appt as any).clientAddress}</Text>
              </View>
            </View>
          ) : null}
          {/* Travel fee for mobile services */}
          {(appt as any).travelFee != null && Number((appt as any).travelFee) > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(10,126,164,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 14 }}>🚗</Text>
                </View>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5 }}>Travel Fee</Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#0891b2" }}>+${Number((appt as any).travelFee).toFixed(2)}</Text>
            </View>
          ) : null}
          {/* Estimated arrival time for mobile services */}
          {(appt as any).travelDuration != null && Number((appt as any).travelDuration) > 0 && ((appt as any).serviceType === 'mobile' || (appt as any).clientAddress) ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(10,126,164,0.15)", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                <Text style={{ fontSize: 14 }}>🕐</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Estimated Arrival</Text>
                <Text style={{ fontSize: 14, color: "#FFFFFF", fontWeight: "500" }}>
                  {(() => {
                    const [h, m] = appt.time.split(":").map(Number);
                    const apptMin = h * 60 + m;
                    const arrMin = Math.max(0, apptMin - Number((appt as any).travelDuration));
                    const arrH = Math.floor(arrMin / 60);
                    const arrM = arrMin % 60;
                    const ampm = arrH >= 12 ? "PM" : "AM";
                    const h12 = arrH % 12 === 0 ? 12 : arrH % 12;
                    return `${h12}:${String(arrM).padStart(2, "0")} ${ampm} (${(appt as any).travelDuration} min travel)`;
                  })()}
                </Text>
              </View>
            </View>
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

        {/* ── Payment Summary Card ────────────────────────────────── */}
        {appt.paymentStatus != null && appt.paymentStatus !== "unpaid" || appt.paymentMethod != null && appt.paymentMethod !== "unpaid" && appt.paymentMethod !== "free" ? (
          <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", marginBottom: 12, overflow: "hidden" }}>
            {/* Card header */}
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(143,191,106,0.18)", alignItems: "center", justifyContent: "center" }}>
                <IconSymbol name="creditcard.fill" size={18} color={GREEN_ACCENT} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY, flex: 1 }}>Payment Summary</Text>
              {/* Status badge */}
              {appt.paymentStatus === "paid" && (
                <View style={{ backgroundColor: "rgba(74,222,128,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#4ADE80" }}>✅ Paid</Text>
                </View>
              )}
              {appt.paymentStatus === "pending_cash" && (
                <View style={{ backgroundColor: "rgba(251,191,36,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#FBBF24" }}>💵 Cash Due</Text>
                </View>
              )}
            </View>
            {/* Payment method */}
            {appt.paymentMethod && appt.paymentMethod !== "unpaid" && appt.paymentMethod !== "free" && (
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
                <Text style={{ fontSize: 13, color: TEXT_MUTED, flex: 1 }}>Payment Method</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: TEXT_PRIMARY, textTransform: "capitalize" }}>
                  {appt.paymentMethod === "cashapp" ? "Cash App" : appt.paymentMethod.charAt(0).toUpperCase() + appt.paymentMethod.slice(1)}
                </Text>
              </View>
            )}
            {/* Price breakdown */}
            {(() => {
              const basePrice = appt.price != null ? Number(appt.price) : appt.totalPrice != null ? Number(appt.totalPrice) : null;
              const discount = appt.discountAmount ? Number(appt.discountAmount) : 0;
              const gift = appt.giftUsedAmount ? Number(appt.giftUsedAmount) : 0;
              const travel = (appt as any).travelFee ? Number((appt as any).travelFee) : 0;
              const extras: any[] = appt.extraItems ?? [];
              const extrasTotal = extras.reduce((sum: number, e: any) => sum + (Number(e.price ?? 0) * (e.qty ?? 1)), 0);
              const hasBreakdown = discount > 0 || gift > 0 || travel > 0 || extras.length > 0;
              if (!hasBreakdown || basePrice == null) return null;
              return (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Price Breakdown</Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: TEXT_MUTED }}>{appt.serviceName}</Text>
                    <Text style={{ fontSize: 13, color: TEXT_PRIMARY }}>${basePrice.toFixed(2)}</Text>
                  </View>
                  {extras.map((e: any, i: number) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: TEXT_MUTED }}>{e.name ?? "Add-on"}{e.qty > 1 ? ` ×${e.qty}` : ""}</Text>
                      <Text style={{ fontSize: 13, color: TEXT_PRIMARY }}>+${(Number(e.price ?? 0) * (e.qty ?? 1)).toFixed(2)}</Text>
                    </View>
                  ))}
                  {travel > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: TEXT_MUTED }}>Travel Fee</Text>
                      <Text style={{ fontSize: 13, color: "#0891b2" }}>+${travel.toFixed(2)}</Text>
                    </View>
                  )}
                  {discount > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: TEXT_MUTED }}>{appt.discountName ? `Discount (${appt.discountName})` : "Discount"}</Text>
                      <Text style={{ fontSize: 13, color: "#4ADE80" }}>-${discount.toFixed(2)}</Text>
                    </View>
                  )}
                  {gift > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: TEXT_MUTED }}>Gift Card Applied</Text>
                      <Text style={{ fontSize: 13, color: "#4ADE80" }}>-${gift.toFixed(2)}</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)" }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY }}>Total</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: GREEN_ACCENT }}>${appt.totalPrice ? Number(appt.totalPrice).toFixed(2) : "0.00"}</Text>
                  </View>
                </View>
              );
            })()}
            {/* Confirmation number for card payments */}
            {appt.paymentConfirmationNumber && (
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
                <Text style={{ fontSize: 13, color: TEXT_MUTED, flex: 1 }}>Confirmation #</Text>
                <Text style={{ fontSize: 12, fontWeight: "600", color: TEXT_MUTED, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" }}>{appt.paymentConfirmationNumber}</Text>
              </View>
            )}
            {/* Refund notice */}
            {appt.refundedAt && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
                <IconSymbol name="arrow.clockwise" size={16} color="#60A5FA" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#60A5FA" }}>Refund Issued</Text>
                  {appt.refundedAmount && (
                    <Text style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>${Number(appt.refundedAmount).toFixed(2)} refunded on {new Date(appt.refundedAt).toLocaleDateString()}</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        ) : null}

        {/* ── Package Sessions Accordion ──────────────────────────────── */}
        {(appt as any).packageGroupId && (appt as any).packageSiblings && (
          <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", marginBottom: 12, overflow: "hidden" }}>
            {/* Header row */}
            <Pressable
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }, pressed && { opacity: 0.7 }]}
              onPress={() => setShowSessionsAccordion(v => !v)}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(143,191,106,0.18)", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 18 }}>📦</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#8FBF6A" }}>Part of a Package</Text>
                <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 1 }}>
                  {(appt as any).packageName ?? "Package"} · {
                    (() => {
                      const sibs: any[] = (appt as any).packageSiblings ?? [];
                      const done = sibs.filter((s: any) => s.status === "completed").length;
                      const total = sibs.length;
                      const remaining = total - done;
                      if (done === 0) return `Session ${((appt as any).sessionIndex ?? 0) + 1} of ${total}`;
                      if (remaining === 0) return `All ${total} sessions completed`;
                      return `${done} completed · ${remaining} to go`;
                    })()
                  }
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: "600" }}>
                {showSessionsAccordion ? "Hide" : "View all"}
              </Text>
            </Pressable>
            {/* Expanded sessions list */}
            {showSessionsAccordion && (
              <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
                {((appt as any).packageSiblings as any[]).map((sib: any, idx: number) => {
                  const isCurrentSession = sib.id === appt.id;
                  const isDone = sib.status === "completed";
                  const isCancelled = sib.status === "cancelled";
                  const sessionNum = (sib.sessionIndex ?? idx) + 1;
                  return (
                    <View
                      key={sib.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        padding: 14,
                        paddingLeft: 16,
                        borderBottomWidth: idx < ((appt as any).packageSiblings as any[]).length - 1 ? 1 : 0,
                        borderBottomColor: "rgba(255,255,255,0.07)",
                        backgroundColor: isCurrentSession ? "rgba(143,191,106,0.07)" : "transparent",
                      }}
                    >
                      {/* Status icon */}
                      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isDone ? "rgba(74,222,128,0.2)" : isCancelled ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 2 }}>
                        <Text style={{ fontSize: 13 }}>{isDone ? "✅" : isCancelled ? "❌" : isCurrentSession ? "📍" : "🕐"}</Text>
                      </View>
                      {/* Session info */}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: isCurrentSession ? "#8FBF6A" : "#FFFFFF" }}>
                            Session {sessionNum}
                          </Text>
                          {isCurrentSession && (
                            <View style={{ backgroundColor: "rgba(143,191,106,0.25)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: "#8FBF6A" }}>THIS SESSION</Text>
                            </View>
                          )}
                          {isDone && (
                            <View style={{ backgroundColor: "rgba(74,222,128,0.2)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: "#4ADE80" }}>COMPLETED</Text>
                            </View>
                          )}
                          {isCancelled && (
                            <View style={{ backgroundColor: "rgba(248,113,113,0.2)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: "#F87171" }}>CANCELLED</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 1 }}>
                          {(() => { const d = new Date(sib.date + "T00:00:00"); return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); })()} · {formatTime12(sib.time)}
                        </Text>
                        {sib.duration ? (
                          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{sib.duration} min</Text>
                        ) : null}
                        {sib.locationName ? (
                          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>📍 {sib.locationName}</Text>
                        ) : null}
                        {sib.staffName ? (
                          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>👤 {sib.staffName}</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
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

          {/* Pay with Card — shown when business has Stripe and appointment is unpaid */}
          {appt.stripeConnectEnabled && appt.localId &&
            (appt.paymentStatus === "unpaid" || appt.paymentStatus === "pending_cash" || appt.paymentStatus == null) && (
            <Pressable
              style={({ pressed }) => [{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                paddingVertical: 16,
                borderRadius: 14,
                backgroundColor: payingCard ? "rgba(143,191,106,0.5)" : GREEN_ACCENT,
                opacity: pressed || payingCard ? 0.85 : 1,
              }]}
              onPress={handlePayWithCard}
              disabled={payingCard}
            >
              {payingCard ? (
                <ActivityIndicator size="small" color={GREEN_DARK} />
              ) : (
                <IconSymbol name="creditcard.fill" size={18} color={GREEN_DARK} />
              )}
              <Text style={{ fontSize: 15, fontWeight: "700", color: GREEN_DARK }}>
                {payingCard ? "Preparing payment..." : `Pay $${appt.totalPrice ? parseFloat(String(appt.totalPrice)).toFixed(2) : "0.00"} with Card`}
              </Text>
            </Pressable>
          )}

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

          {/* Request Reschedule */}
          {canCancel && !hasPendingReschedule && !hasPendingCancel && (
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: "rgba(251,191,36,0.1)", borderColor: "rgba(251,191,36,0.3)", borderWidth: 1 },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRescheduleModalVisible(true);
              }}
            >
              <IconSymbol name="calendar.badge.clock" size={18} color="#FBBF24" />
              <Text style={[styles.actionBtnText, { color: "#FBBF24" }]}>Request Reschedule</Text>
            </Pressable>
          )}

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
          {/* Get Directions */}
          {appt.locationAddress && (appt as any).serviceType !== "mobile" ? (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionBtnGhost, pressed && { opacity: 0.85 }]}
              onPress={handleGetDirections}
            >
              <IconSymbol name="arrow.triangle.turn.up.right.diamond.fill" size={18} color={TEXT_MUTED} />
              <Text style={[styles.actionBtnText, { color: TEXT_MUTED }]}>Get Directions</Text>
            </Pressable>
          ) : null}

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

          {/* Share Business */}
          {appt.businessSlug ? (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionBtnGhost, pressed && { opacity: 0.85 }]}
              onPress={handleShareBusiness}
            >
              <IconSymbol name="square.and.arrow.up" size={18} color={TEXT_MUTED} />
              <Text style={[styles.actionBtnText, { color: TEXT_MUTED }]}>Share Business</Text>
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
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: GREEN_DARK, padding: 24 }}>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Payment Receipt Modal ─────────────────────────────────────── */}
      {/* Payment Summary Sheet - shown before Stripe Checkout */}
      <Modal
        visible={showPaymentSummary}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPaymentSummary(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View style={{ backgroundColor: GREEN_DARK, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)", alignSelf: "center", marginBottom: 20 }} />
            <Text style={{ color: TEXT_PRIMARY, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Payment Summary</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 20 }}>Review the charge breakdown before paying</Text>
            {pendingCheckoutBreakdown && (
              <View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>Service amount</Text>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>${pendingCheckoutBreakdown.serviceAmount.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>Platform fee ({pendingCheckoutBreakdown.platformFeePercent}%)</Text>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>+${pendingCheckoutBreakdown.platformFee.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, marginTop: 4 }}>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 16, fontWeight: "700" }}>Total charged to you</Text>
                  <Text style={{ color: GREEN_ACCENT, fontSize: 16, fontWeight: "700" }}>${pendingCheckoutBreakdown.totalCharged.toFixed(2)}</Text>
                </View>
                <View style={{ backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 12, marginTop: 4, gap: 6 }}>
                  <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Business payout breakdown</Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Stripe processing fee (2.9% + $0.30)</Text>
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>-${pendingCheckoutBreakdown.stripeFee.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Business net payout</Text>
                    <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "600" }}>${pendingCheckoutBreakdown.businessNetPayout.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 24 }}>
              <Pressable
                onPress={() => { setShowPaymentSummary(false); setPendingCheckoutUrl(null); setPendingCheckoutBreakdown(null); }}
                style={({ pressed }) => [{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center" }, pressed && { opacity: 0.7 }]}
              >
                <Text style={{ color: TEXT_MUTED, fontSize: 15, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmAndPay}
                style={({ pressed }) => [{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: "#4A7C59", alignItems: "center" }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
              >
                <Text style={{ color: TEXT_PRIMARY, fontSize: 15, fontWeight: "700" }}>Confirm & Pay</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {receiptData && (
        <PaymentReceiptModal
          visible={!!receiptData}
          amount={receiptData.amount}
          serviceName={receiptData.serviceName}
          confirmationId={receiptData.confirmationId}
          onDone={() => setReceiptData(null)}
        />
      )}

      {/* ── Reschedule Request Modal ──────────────────────────────────── */}
      <Modal
        visible={rescheduleModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !submittingReschedule && setRescheduleModalVisible(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: GREEN_DARK, padding: 24 }}>
          <ClientPortalBackground />
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24, marginTop: 12 }}>
            <Pressable
              onPress={() => !submittingReschedule && setRescheduleModalVisible(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontSize: 16, color: TEXT_MUTED }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: "700", color: TEXT_PRIMARY }}>Request Reschedule</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 20, lineHeight: 20 }}>
              Enter your preferred date and time. The business will review and confirm or suggest an alternative.
            </Text>
            {/* Requested Date */}
            <Text style={{ fontSize: 12, fontWeight: "700", color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Preferred Date</Text>
            <TextInput
              placeholder="e.g. June 20, 2025"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={rescheduleDate}
              onChangeText={setRescheduleDate}
              style={{ backgroundColor: CARD_BG, borderRadius: 12, padding: 14, fontSize: 15, color: TEXT_PRIMARY, borderWidth: 1, borderColor: CARD_BORDER, marginBottom: 16 }}
            />
            {/* Requested Time */}
            <Text style={{ fontSize: 12, fontWeight: "700", color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Preferred Time</Text>
            <TextInput
              placeholder="e.g. 2:00 PM"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={rescheduleTime}
              onChangeText={setRescheduleTime}
              style={{ backgroundColor: CARD_BG, borderRadius: 12, padding: 14, fontSize: 15, color: TEXT_PRIMARY, borderWidth: 1, borderColor: CARD_BORDER, marginBottom: 16 }}
            />
            {/* Reason (optional) */}
            <Text style={{ fontSize: 12, fontWeight: "700", color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Reason (optional)</Text>
            <TextInput
              placeholder="Let the business know why you need to reschedule..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={rescheduleReason}
              onChangeText={setRescheduleReason}
              multiline
              numberOfLines={3}
              style={{ backgroundColor: CARD_BG, borderRadius: 12, padding: 14, fontSize: 15, color: TEXT_PRIMARY, borderWidth: 1, borderColor: CARD_BORDER, minHeight: 90, textAlignVertical: "top", marginBottom: 24 }}
            />
            {/* Submit */}
            <Pressable
              style={({ pressed }) => ({
                backgroundColor: "#FBBF24",
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                marginBottom: 32,
                opacity: pressed || submittingReschedule ? 0.8 : 1,
              })}
              onPress={handleRescheduleRequest}
              disabled={submittingReschedule}
            >
              {submittingReschedule ? (
                <ActivityIndicator size="small" color={GREEN_DARK} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: "700", color: GREEN_DARK }}>Send Request</Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
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
