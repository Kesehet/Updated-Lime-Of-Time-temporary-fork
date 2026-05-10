/**
 * Client Portal — Notification Preferences Screen
 *
 * Lets clients toggle SMS and push reminders for upcoming appointments.
 * Preferences are stored locally via AsyncStorage.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";

const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

const PREFS_KEY = "@client_notification_prefs";

interface NotificationPrefs {
  pushEnabled: boolean;
  smsEnabled: boolean;
  reminder24h: boolean;
  reminder1h: boolean;
  reminder30m: boolean;
  bookingConfirmation: boolean;
  cancellationAlerts: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  pushEnabled: false,
  smsEnabled: false,
  reminder24h: false,
  reminder1h: false,
  reminder30m: false,
  bookingConfirmation: false,
  cancellationAlerts: false,
};

export default function ClientNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [pushPermission, setPushPermission] = useState<"granted" | "denied" | "undetermined">("undetermined");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load saved prefs
    AsyncStorage.getItem(PREFS_KEY).then((raw) => {
      if (raw) {
        try { setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) }); } catch {}
      }
    });
    // Check push permission
    if (Platform.OS !== "web") {
      Notifications.getPermissionsAsync().then((status) => {
        setPushPermission(status.status as any);
      });
    }
  }, []);

  const updatePref = async (key: keyof NotificationPrefs, value: boolean) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(updated));
  };

  const requestPushPermission = async () => {
    if ((Platform.OS as string) === "web") return;
    const { status } = await Notifications.requestPermissionsAsync();
    setPushPermission(status as any);
    if (status === "granted") {
      await updatePref("pushEnabled", true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert(
        "Push Notifications Disabled",
        "To receive appointment reminders, please enable notifications for this app in your device Settings.",
        [{ text: "OK" }]
      );
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


      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Push permission banner */}
        {Platform.OS !== "web" && pushPermission === "denied" && (
          <View style={styles.permissionBanner}>
            <IconSymbol name="bell.slash.fill" size={18} color="#FCD34D" />
            <View style={{ flex: 1 }}>
              <Text style={styles.permissionTitle}>Push Notifications Disabled</Text>
              <Text style={styles.permissionSub}>Enable in device Settings to receive reminders.</Text>
            </View>
          </View>
        )}

        {Platform.OS !== "web" && pushPermission === "undetermined" && (
          <Pressable
            style={({ pressed }) => [styles.permissionBanner, styles.permissionBannerGreen, pressed && { opacity: 0.85 }]}
            onPress={requestPushPermission}
          >
            <IconSymbol name="bell.fill" size={18} color={GREEN_ACCENT} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.permissionTitle, { color: GREEN_ACCENT }]}>Enable Push Notifications</Text>
              <Text style={styles.permissionSub}>Tap to allow appointment reminders on this device.</Text>
            </View>
            <IconSymbol name="chevron.right" size={14} color={TEXT_MUTED} />
          </Pressable>
        )}

        {/* Push Notifications section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PUSH NOTIFICATIONS</Text>
          <ToggleRow
            icon="bell.fill"
            label="Push Notifications"
            subtitle="Receive alerts on your device"
            value={prefs.pushEnabled && pushPermission === "granted"}
            onToggle={(v) => {
              if (v && pushPermission !== "granted") {
                requestPushPermission();
              } else {
                updatePref("pushEnabled", v);
              }
            }}
            disabled={pushPermission === "denied"}
          />
          <View style={styles.divider} />
          <ToggleRow
            icon="clock.fill"
            label="24-Hour Reminder"
            subtitle="Day before your appointment"
            value={prefs.reminder24h}
            onToggle={(v) => updatePref("reminder24h", v)}
            disabled={!prefs.pushEnabled || pushPermission !== "granted"}
          />
          <View style={styles.divider} />
          <ToggleRow
            icon="alarm.fill"
            label="1-Hour Reminder"
            subtitle="One hour before your appointment"
            value={prefs.reminder1h}
            onToggle={(v) => updatePref("reminder1h", v)}
            disabled={!prefs.pushEnabled || pushPermission !== "granted"}
          />
          <View style={styles.divider} />
          <ToggleRow
            icon="timer"
            label="30-Minute Reminder"
            subtitle="30 minutes before your appointment"
            value={prefs.reminder30m}
            onToggle={(v) => updatePref("reminder30m", v)}
            disabled={!prefs.pushEnabled || pushPermission !== "granted"}
          />
        </View>

        {/* SMS section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SMS NOTIFICATIONS</Text>
          <ToggleRow
            icon="message.fill"
            label="SMS Reminders"
            subtitle="Text message reminders to your phone"
            value={prefs.smsEnabled}
            onToggle={(v) => updatePref("smsEnabled", v)}
          />
          <View style={styles.divider} />
          <ToggleRow
            icon="checkmark.circle.fill"
            label="Booking Confirmation"
            subtitle="SMS when your booking is confirmed"
            value={prefs.bookingConfirmation}
            onToggle={(v) => updatePref("bookingConfirmation", v)}
            disabled={!prefs.smsEnabled}
          />
          <View style={styles.divider} />
          <ToggleRow
            icon="xmark.circle.fill"
            label="Cancellation Alerts"
            subtitle="SMS if your appointment is cancelled"
            value={prefs.cancellationAlerts}
            onToggle={(v) => updatePref("cancellationAlerts", v)}
            disabled={!prefs.smsEnabled}
          />
        </View>

        <Text style={styles.footer}>
          SMS notifications are sent to the phone number on your account. Push notifications require the app to be installed on your device.
        </Text>
      </ScrollView>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  subtitle,
  value,
  onToggle,
  disabled = false,
}: {
  icon: string;
  label: string;
  subtitle: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.45 }]}>
      <View style={styles.toggleIconWrap}>
        <IconSymbol name={icon as any} size={18} color={GREEN_ACCENT} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value && !disabled}
        onValueChange={disabled ? undefined : onToggle}
        trackColor={{ false: "rgba(255,255,255,0.15)", true: GREEN_ACCENT }}
        thumbColor={Platform.OS === "android" ? (value ? "#FFFFFF" : "#AAAAAA") : undefined}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 16,
    color: TEXT_PRIMARY,
    fontWeight: "500",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  permissionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(252,211,77,0.12)",
    borderWidth: 1,
    borderColor: "rgba(252,211,77,0.3)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  permissionBannerGreen: {
    backgroundColor: "rgba(143,191,106,0.1)",
    borderColor: "rgba(143,191,106,0.3)",
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FCD34D",
  },
  permissionSub: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  section: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    marginBottom: 16,
    overflow: "hidden",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: TEXT_MUTED,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: CARD_BORDER,
    marginLeft: 64,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  toggleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: TEXT_PRIMARY,
  },
  toggleSubtitle: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 1,
  },
  footer: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
    marginTop: 4,
  },
});
