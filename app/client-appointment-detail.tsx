/**
 * Client Portal — Appointment Detail Screen
 *
 * Shows full appointment details, cancel/reschedule request options,
 * and a link to the message thread.
 *
 * Design: dark forest-green portal aesthetic matching all other client portal screens.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useClientStore, ClientAppointment } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

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
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const { apiCall } = useClientStore();
  const [appt, setAppt] = useState<ClientAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<ClientAppointment>(`/api/client/appointments/${id}`);
        setAppt(data);
      } catch (err) {
        console.warn("[ApptDetail] load error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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
        <ClientPortalBackground />
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
            <InfoRow icon="timer" label="Duration" value={`${appt.duration} min`} />
          ) : null}
          {appt.staffName ? (
            <InfoRow icon="person.fill" label="Staff" value={appt.staffName} />
          ) : null}
          {appt.totalPrice != null ? (
            <InfoRow
              icon="creditcard.fill"
              label="Price"
              value={`$${parseFloat(appt.totalPrice).toFixed(2)}`}
            />
          ) : null}
          {appt.locationName ? (
            <InfoRow icon="location" label="Location" value={appt.locationName} />
          ) : null}
          {appt.locationAddress ? (
            <InfoRow icon="location" label="Address" value={appt.locationAddress} />
          ) : null}
          {appt.notes ? (
            <InfoRow icon="note.text" label="Notes" value={appt.notes} />
          ) : null}
        </View>

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
});
