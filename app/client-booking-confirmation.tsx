/**
 * Client Portal — Booking Confirmation Screen
 *
 * Shown after a successful booking. Displays appointment summary
 * (service, staff, date, time, business, location) and an "Add to Calendar" button.
 *
 * Design: dark forest-green portal aesthetic matching all other client portal screens.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
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

export default function ClientBookingConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    serviceName,
    staffName,
    staffAvatarUrl,
    date,
    time,
    duration,
    businessName,
    businessSlug,
    price,
    locationName,
    locationAddress,
    locationPhone,
    clientAddress,
  } = useLocalSearchParams<{
    serviceName: string;
    staffName?: string;
    staffAvatarUrl?: string;
    date: string;
    time: string;
    duration: string;
    businessName: string;
    businessSlug: string;
    price?: string;
    locationName?: string;
    locationAddress?: string;
    locationPhone?: string;
    clientAddress?: string;
  }>();

  // Entrance animation
  const scale = useSharedValue(0.85);
  const opacity = useSharedValue(0);
  const checkScale = useSharedValue(0);

  useEffect(() => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    opacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    scale.value = withSpring(1, { damping: 16, stiffness: 140 });
    // Stagger the checkmark pop
    setTimeout(() => {
      checkScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    }, 150);
  }, []);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  function formatDateDisplay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11 && digits[0] === "1") {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  function formatTime12(t: string): string {
    if (!t) return t;
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  const [calendarAdded, setCalendarAdded] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);

  const handleAddToCalendar = async () => {
    const startDate = new Date(`${date}T${time}:00`);
    const durationMins = parseInt(duration ?? "60", 10);
    const endDate = new Date(startDate.getTime() + durationMins * 60000);

    if ((Platform.OS as string) === "web") {
      const pad = (n: number) => String(n).padStart(2, "0");
      const toICS = (d: Date) =>
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `SUMMARY:${serviceName} at ${businessName}`,
        `DTSTART:${toICS(startDate)}`,
        `DTEND:${toICS(endDate)}`,
        `DESCRIPTION:${staffName ? `Staff: ${staffName}\\n` : ""}${locationAddress ? `Location: ${locationAddress}` : ""}`,
        locationAddress ? `LOCATION:${locationAddress}` : "",
        "END:VEVENT",
        "END:VCALENDAR",
      ].filter(Boolean).join("\r\n");
      const blob = new Blob([icsContent], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "appointment.ics";
      a.click();
      URL.revokeObjectURL(url);
      setCalendarAdded(true);
      return;
    }

    try {
      setCalendarLoading(true);
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Please allow calendar access in Settings to add this appointment.");
        return;
      }

      let calendarId: string | undefined;
      if (Platform.OS === "ios") {
        const defaultCal = await Calendar.getDefaultCalendarAsync();
        calendarId = defaultCal?.id;
      }
      if (!calendarId) {
        const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const writable = cals.filter(c => c.allowsModifications);
        calendarId = writable[0]?.id;
      }
      if (!calendarId) {
        Alert.alert("No Calendar", "No writable calendar found on this device.");
        return;
      }

      await Calendar.createEventAsync(calendarId, {
        title: `${serviceName} at ${businessName}`,
        startDate,
        endDate,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: locationAddress ?? businessName ?? "",
        alarms: [{ relativeOffset: -60 }],
      } as Calendar.Event);

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCalendarAdded(true);
      Alert.alert("Added!", "Your appointment has been added to your calendar.");
    } catch {
      Alert.alert("Error", "Could not add to calendar. Please try again.");
    } finally {
      setCalendarLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <StatusBar style="light" />
      <ClientPortalBackground />
      {/* Drag handle */}
      <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
      </View>


      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Success Icon ─────────────────────────────────────────────── */}
        <View style={styles.iconSection}>
          <View style={styles.successRing}>
            <Animated.View style={[styles.successCircle, checkStyle]}>
              <IconSymbol name="checkmark" size={40} color={GREEN_DARK} />
            </Animated.View>
          </View>
        </View>

        <Animated.View style={[styles.content, contentStyle]}>
          {/* ── Headline ─────────────────────────────────────────────── */}
          <Text style={styles.headline}>Booking Confirmed!</Text>
          <Text style={styles.subline}>
            Your appointment has been submitted.{"\n"}The business will confirm shortly.
          </Text>

          {/* ── Summary Card ─────────────────────────────────────────── */}
          <View style={styles.card}>
            <SummaryRow icon="scissors" label="Service" value={serviceName ?? "—"} />
            {staffName ? (
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, overflow: "hidden", backgroundColor: "rgba(143,191,106,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(143,191,106,0.35)", marginRight: 10 }}>
                  {staffAvatarUrl ? (
                    <Image source={{ uri: staffAvatarUrl }} style={{ width: 34, height: 34 }} contentFit="cover" />
                  ) : (
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#8FBF6A" }}>{staffName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>Staff</Text>
                  <Text style={{ fontSize: 15, color: "#FFFFFF", fontWeight: "500" }}>{staffName}</Text>
                </View>
              </View>
            ) : null}
            <SummaryRow icon="calendar" label="Date" value={formatDateDisplay(date ?? "")} />
            <SummaryRow icon="clock" label="Time" value={formatTime12(time ?? "")} />
            {price ? (
              <SummaryRow icon="creditcard" label="Price" value={price} />
            ) : null}
            <SummaryRow
              icon="building.2"
              label="Business"
              value={businessName ?? "—"}
              last={!locationName && !locationAddress}
            />
            {locationName ? (
              <SummaryRow
                icon="mappin"
                label="Branch"
                value={locationName}
                last={!locationPhone && !locationAddress}
              />
            ) : null}
            {locationPhone ? (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => Linking.openURL(`tel:${locationPhone.replace(/\D/g, "")}`)}
              >
                <SummaryRow
                  icon="phone"
                  label="Phone"
                  value={formatPhone(locationPhone)}
                  last={!locationAddress}
                  tappable
                />
              </TouchableOpacity>
            ) : null}
            {locationAddress ? (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  const encoded = encodeURIComponent(locationAddress);
                  const url = Platform.OS === "ios"
                    ? `maps://maps.apple.com/?q=${encoded}`
                    : `https://maps.google.com/?q=${encoded}`;
                  Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${encoded}`));
                }}
              >
                <SummaryRow icon="location" label="Address" value={locationAddress} last={!clientAddress} tappable />
                <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "600", marginLeft: 46, marginTop: -6, marginBottom: 8 }}>
                  Get Directions →
                </Text>
              </TouchableOpacity>
            ) : null}
            {clientAddress ? (
              <SummaryRow icon="location" label="Your Address" value={clientAddress} last />
            ) : null}
          </View>

          {/* ── Add to Calendar ──────────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [
              styles.calBtn,
              calendarAdded && styles.calBtnDone,
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleAddToCalendar}
            disabled={calendarLoading || calendarAdded}
          >
            {calendarLoading ? (
              <ActivityIndicator size="small" color={GREEN_ACCENT} />
            ) : calendarAdded ? (
              <IconSymbol name="checkmark" size={18} color={GREEN_ACCENT} />
            ) : (
              <IconSymbol name="calendar" size={18} color={GREEN_ACCENT} />
            )}
            <Text style={styles.calBtnText}>
              {calendarAdded ? "Added to Calendar" : "Add to Calendar"}
            </Text>
          </Pressable>

          {/* ── Request Reschedule ──────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [styles.rescheduleBtn, pressed && { opacity: 0.8 }]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              // Navigate to booking wizard pre-filled with the same business so client can pick a new slot
              router.push({
                pathname: "/client-booking-wizard",
                params: { businessSlug: businessSlug ?? "" },
              } as any);
            }}
          >
            <IconSymbol name="calendar" size={16} color={TEXT_MUTED} />
            <Text style={styles.rescheduleBtnText}>Book Again / Reschedule</Text>
          </Pressable>
          {/* ── View Bookings ────────────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.replace("/(client-tabs)/bookings" as any);
            }}
          >
            <Text style={styles.primaryBtnText}>View My Bookings</Text>
          </Pressable>

          {/* ── Back to Business ─────────────────────────────────────── */}
          {businessSlug ? (
            <Pressable
              style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.replace({ pathname: "/client-business-detail", params: { slug: businessSlug } } as any);
              }}
            >
              <Text style={styles.ghostBtnText}>Back to Business</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  last,
  tappable,
}: {
  icon: string;
  label: string;
  value: string;
  last?: boolean;
  tappable?: boolean;
}) {
  return (
    <View style={[rowStyles.row, !last && rowStyles.rowBorder]}>
      <View style={rowStyles.iconWrap}>
        <IconSymbol name={icon as any} size={15} color={GREEN_ACCENT} />
      </View>
      <View style={rowStyles.textWrap}>
        <Text style={rowStyles.label}>{label}</Text>
        <Text style={[rowStyles.value, tappable && { textDecorationLine: "underline" }]}>{value}</Text>
      </View>
      {tappable ? (
        <IconSymbol name="chevron.right" size={14} color={GREEN_ACCENT} />
      ) : null}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
    color: TEXT_MUTED,
  },
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
});

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  // ─── Success Icon ─────────────────────────────────────────────────────────
  iconSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  successRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "rgba(143,191,106,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(143,191,106,0.3)",
  },
  successCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: GREEN_ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  // ─── Text ─────────────────────────────────────────────────────────────────
  content: {
    width: "100%",
    alignItems: "center",
  },
  headline: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    color: TEXT_PRIMARY,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subline: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 8,
    color: TEXT_MUTED,
  },
  // ─── Summary Card ─────────────────────────────────────────────────────────
  card: {
    width: "100%",
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  // ─── Calendar Button ──────────────────────────────────────────────────────
  calBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: GREEN_ACCENT,
    marginBottom: 12,
    backgroundColor: "rgba(143,191,106,0.07)",
  },
  calBtnDone: {
    backgroundColor: "rgba(143,191,106,0.12)",
  },
  calBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  // ─── Primary Button ───────────────────────────────────────────────────────
  primaryBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: GREEN_ACCENT,
    shadowColor: GREEN_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryBtnText: {
    color: GREEN_DARK,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  // ─── Ghost Button ─────────────────────────────────────────────────────────
  ghostBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: TEXT_MUTED,
  },
  // ─── Reschedule Button ────────────────────────────────────────────────────
  rescheduleBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 10,
  },
  rescheduleBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT_MUTED,
  },
});
