import React, { useState, useCallback, useMemo } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  ScrollView,
  Alert,
  Image,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter } from "expo-router";
import { useThemeContext } from "@/lib/theme-provider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { removeSessionToken, clearUserInfo, getSessionToken } from "@/lib/_core/auth";
import { getApiBaseUrl } from "@/constants/oauth";
import { formatPhoneNumber, getMapUrl, DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { useAppLockContext } from "@/lib/app-lock-provider";
import { LocationSwitcher } from "@/components/location-switcher";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { useScrollToTopOnFocus } from "@/hooks/use-scroll-to-top-on-focus";
import {
  requestCalendarPermission,
  bulkSyncConfirmedAppointments,
  removeAllCalendarEvents,
} from "@/lib/calendar-sync";

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabKey = "business" | "payments" | "clients" | "comms" | "account";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "business",  label: "Business",  icon: "building.2.fill" },
  { key: "payments",  label: "Payments",  icon: "creditcard.fill" },
  { key: "clients",   label: "Clients",   icon: "person.2.fill" },
  { key: "comms",     label: "Alerts",    icon: "bell.fill" },
  { key: "account",   label: "Account",   icon: "person.fill" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Uppercase section header with optional count badge and accent line */
function SectionHeader({
  label,
  count,
  accentColor,
  colors,
  topSpacing = true,
}: {
  label: string;
  count?: number;
  accentColor?: string;
  colors: ReturnType<typeof useColors>;
  topSpacing?: boolean;
}) {
  return (
    <View style={[sectionStyles.row, topSpacing && { marginTop: 24 }]}>
      {accentColor && <View style={[sectionStyles.accent, { backgroundColor: accentColor }]} />}
      <Text style={[sectionStyles.label, { color: colors.muted }]}>{label}</Text>
      {count !== undefined && count > 0 && (
        <View style={[sectionStyles.badge, { backgroundColor: (accentColor ?? colors.primary) + "20" }]}>
          <Text style={[sectionStyles.badgeText, { color: accentColor ?? colors.primary }]}>{count}</Text>
        </View>
      )}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  accent:    { width: 3, height: 14, borderRadius: 2 },
  label:     { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.9, flex: 1 },
  badge:     { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "700" },
});

/** Status dot for nav cards */
function StatusDot({ status, colors }: { status: "ok" | "warn" | "off"; colors: ReturnType<typeof useColors> }) {
  const color = status === "ok" ? colors.success : status === "warn" ? colors.warning : colors.muted;
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { state, dispatch, syncToDb, filterAppointmentsByLocation, clientsForActiveLocation } = useStore();
  const deleteBusinessMut = trpc.business.delete.useMutation();
  const updateBusinessMut = trpc.business.update.useMutation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, maxContentWidth, modalMaxWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { setThemeMode: setThemeOverrideMode } = useThemeContext();
  const { biometricAvailable, biometricEnabled, biometricType, toggleBiometric } = useAppLockContext();
  const settings = state.settings;
  const { hasMultipleLocations, activeLocation } = useActiveLocation();
  const scrollRef = useScrollToTopOnFocus<ScrollView>();

  const [activeTab, setActiveTab] = useState<TabKey>("business");
  const [devTapCount, setDevTapCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Calendar Sync ─────────────────────────────────────────────────────────────
  const CALENDAR_SYNC_KEY = "@limeofttime_calendar_sync_enabled";
  const [calendarSyncEnabled, setCalendarSyncEnabled] = useState(false);
  React.useEffect(() => {
    AsyncStorage.getItem(CALENDAR_SYNC_KEY).then((v) => {
      if (v === "true") setCalendarSyncEnabled(true);
    });
  }, []);

  const handleCalendarSyncToggle = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestCalendarPermission();
      if (!granted) {
        Alert.alert(
          "Calendar Permission Required",
          "Please allow calendar access in Settings to sync appointments.",
        );
        return;
      }
      setCalendarSyncEnabled(true);
      await AsyncStorage.setItem(CALENDAR_SYNC_KEY, "true");
      const today = new Date().toISOString().slice(0, 10);
      const confirmed = state.appointments.filter(
        (a) => a.status === "confirmed" && a.date >= today,
      );
      const events = confirmed.map((a) => {
        const client = state.clients.find((c) => c.id === a.clientId);
        const svc = state.services.find((s) => s.id === a.serviceId);
        const loc = (state.locations ?? []).find((l) => l.id === a.locationId);
        return {
          appointmentId: a.id,
          clientName: client?.name ?? "Client",
          serviceName: svc?.name ?? "Appointment",
          date: a.date,
          time: a.time,
          duration: a.duration,
          notes: a.notes,
          clientPhone: client?.phone,
          locationAddress: loc?.address ?? state.settings.profile.address,
          locationCity: loc?.city ?? state.settings.profile.city,
          locationState: loc?.state ?? state.settings.profile.state,
          locationZip: loc?.zipCode ?? state.settings.profile.zipCode,
        };
      });
      await bulkSyncConfirmedAppointments(events);
      Alert.alert(
        "Calendar Synced",
        `${events.length} appointment${events.length !== 1 ? "s" : ""} added to your Lime Of Time calendar.`,
      );
    } else {
      setCalendarSyncEnabled(false);
      await AsyncStorage.setItem(CALENDAR_SYNC_KEY, "false");
      Alert.alert(
        "Remove Calendar Events?",
        "Do you want to remove all Lime Of Time events from your device calendar?",
        [
          { text: "Keep Events", style: "cancel" },
          {
            text: "Remove All",
            style: "destructive",
            onPress: async () => { await removeAllCalendarEvents(); },
          },
        ],
      );
    }
  }, [state.appointments, state.clients, state.services, state.locations, state.settings]);

  // Business Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(settings.businessName);

  // Monthly Revenue Goal
  const [goalInput, setGoalInput] = useState(settings.monthlyRevenueGoal > 0 ? String(settings.monthlyRevenueGoal) : "");
  const [editingGoal, setEditingGoal] = useState(false);

  // Staff Alert Threshold
  const [alertThresholdInput, setAlertThresholdInput] = useState(String(settings.staffAlertThreshold ?? 80));
  const [editingThreshold, setEditingThreshold] = useState(false);

  const saveName = useCallback(() => {
    if (nameValue.trim()) {
      const action = { type: "UPDATE_SETTINGS" as const, payload: { businessName: nameValue.trim() } };
      dispatch(action);
      syncToDb(action);
    }
    setEditingName(false);
  }, [nameValue, dispatch, syncToDb]);

  const saveGoal = useCallback(() => {
    const val = parseInt(goalInput.replace(/[^0-9]/g, ""), 10);
    const goal = isNaN(val) ? 0 : val;
    const action = { type: "UPDATE_SETTINGS" as const, payload: { monthlyRevenueGoal: goal } };
    dispatch(action);
    syncToDb(action);
    setEditingGoal(false);
  }, [goalInput, dispatch, syncToDb]);

  const saveThreshold = useCallback(() => {
    const val = parseInt(alertThresholdInput.replace(/[^0-9]/g, ""), 10);
    const threshold = isNaN(val) ? 80 : Math.min(100, Math.max(0, val));
    const action = { type: "UPDATE_SETTINGS" as const, payload: { staffAlertThreshold: threshold } };
    dispatch(action);
    syncToDb(action);
    setEditingThreshold(false);
  }, [alertThresholdInput, dispatch, syncToDb]);

  const setThemeMode = useCallback(
    (mode: "light" | "dark" | "system") => {
      const action = { type: "UPDATE_SETTINGS" as const, payload: { themeMode: mode } };
      dispatch(action);
      syncToDb(action);
      setThemeOverrideMode(mode);
    },
    [dispatch, setThemeOverrideMode, syncToDb]
  );

  const themeOptions: { key: "light" | "dark" | "system"; label: string; icon: string }[] = [
    { key: "light",  label: "Light",  icon: "sun.max.fill" },
    { key: "dark",   label: "Dark",   icon: "moon.fill" },
    { key: "system", label: "Auto",   icon: "gear" },
  ];

  // ── Client Portal Visibility ──────────────────────────────────────────────────
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const PORTAL_CATEGORIES = ["Hair", "Nails", "Skin", "Massage", "Fitness", "Dental", "Medical", "Spa", "Barber", "Tattoo", "Other"];
  const togglePortalVisible = useCallback(async (value: boolean) => {
    // Update local state immediately for responsive UI
    const action = { type: "UPDATE_SETTINGS" as const, payload: { clientPortalVisible: value } };
    dispatch(action);
    // Call the portal-visibility endpoint which also geocodes the business address
    // This ensures lat/lng are set so the business appears in location-based discovery
    try {
      const token = await getSessionToken();
      const apiBase = getApiBaseUrl();
      await fetch(`${apiBase}/api/business/portal-visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ visible: value, businessCategory: settings.businessCategory ?? null }),
      });
    } catch {
      // Fall back to standard syncToDb if the endpoint fails
      syncToDb(action);
    }
  }, [dispatch, syncToDb, settings.businessCategory]);
  // Multi-select: businessCategory stored as comma-separated string e.g. "Hair,Nails,Skin"
  const selectedCategories: string[] = settings.businessCategory
    ? settings.businessCategory.split(",").map((c: string) => c.trim()).filter(Boolean)
    : [];
  const togglePortalCategory = useCallback((cat: string) => {
    const current = settings.businessCategory
      ? settings.businessCategory.split(",").map((c: string) => c.trim()).filter(Boolean)
      : [];
    const next = current.includes(cat)
      ? current.filter((c: string) => c !== cat)
      : [...current, cat];
    const newValue = next.join(",");
    const action = { type: "UPDATE_SETTINGS" as const, payload: { businessCategory: newValue } };
    dispatch(action);
    syncToDb(action);
  }, [dispatch, syncToDb, settings.businessCategory]);

  const handleLogout = useCallback(() => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          // Clear push token from server so this device stops receiving notifications
          // for this business after logout (prevents cross-account contamination)
          if (state.businessOwnerId) {
            try {
              await updateBusinessMut.mutateAsync({ id: state.businessOwnerId, expoPushToken: null });
            } catch {}
          }
          dispatch({ type: "RESET_ALL_DATA" });
          try {
            await AsyncStorage.multiRemove([
              "@bookease_services","@bookease_clients","@bookease_appointments",
              "@bookease_reviews","@bookease_settings","@bookease_business_owner_id",
              "@bookease_discounts","@bookease_gift_cards","@bookease_custom_schedule",
              "@bookease_location_custom_schedule","@bookease_products","@bookease_staff",
              "@bookease_locations","@bookease_active_location_id",
              "@bookease_client_photos","@bookease_packages","@bookease_service_photos",
              "@bookease_biometric_enabled",
              "@bookease_business_name",
              "@lime_tutorial_seen","@lime_tour_analytics","@lime_first_action_shown",
            ]);
          } catch {}
          try { await removeSessionToken(); } catch {}
          try { await clearUserInfo(); } catch {}
          router.replace("/profile-select" as any);
        },
      },
    ]);
  }, [dispatch, router]);

  const handleDeleteBusiness = useCallback(() => {
    Alert.alert(
      "Delete Business",
      "This will permanently delete all your business data from our servers and remove all app data from this device. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Everything",
          style: "destructive",
          onPress: async () => {
            if (state.businessOwnerId) {
              try { await deleteBusinessMut.mutateAsync({ id: state.businessOwnerId }); } catch {}
            }
            dispatch({ type: "RESET_ALL_DATA" });
            try {
              await AsyncStorage.multiRemove([
                "@bookease_services","@bookease_clients","@bookease_appointments",
                "@bookease_reviews","@bookease_settings","@bookease_business_owner_id",
                "@bookease_discounts","@bookease_gift_cards","@bookease_custom_schedule",
                "@bookease_location_custom_schedule","@bookease_products","@bookease_staff",
                "@bookease_locations","@bookease_active_location_id",
                "@bookease_client_photos","@bookease_packages","@bookease_service_photos",
              "@bookease_biometric_enabled",
              "@bookease_business_name",
              "@lime_tutorial_seen","@lime_tour_analytics","@lime_first_action_shown",
            ]);
            } catch {}
            try { await removeSessionToken(); } catch {}
            try { await clearUserInfo(); } catch {}
            router.replace("/profile-select" as any);
          },
        },
      ]
    );
  }, [dispatch, router, state.businessOwnerId, deleteBusinessMut]);

  const reviewAvg = useMemo(() => {
    if (state.reviews.length === 0) return null;
    return (state.reviews.reduce((s, r) => s + r.rating, 0) / state.reviews.length).toFixed(1);
  }, [state.reviews]);

  // ── Shared nav card renderer ─────────────────────────────────────────────────

  const renderNavList = (
    items: Array<{ title: string; subtitle: string; icon: any; route: any; color: string; status?: "ok" | "warn" | "off" }>
  ) => (
    <View style={isTablet ? { flexDirection: "row", flexWrap: "wrap", gap: 10 } : undefined}>
      {items.map((item) => (
        <Pressable
          key={item.title}
          onPress={() => router.push(item.route as any)}
          style={({ pressed }) => [
            styles.navCard,
            { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            isTablet && { width: "48.5%" as any },
          ]}
        >
          <View style={[styles.navIcon, { backgroundColor: item.color + "15" }]}>
            <IconSymbol name={item.icon} size={22} color={item.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{item.title}</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, lineHeight: 17 }}>{item.subtitle}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {item.status && <StatusDot status={item.status} colors={colors} />}
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </View>
        </Pressable>
      ))}
    </View>
  );

  // ── BUSINESS TAB ─────────────────────────────────────────────────────────────

  const renderBusinessTab = () => (
    <>
      {/* Closed Banner */}
      {settings.temporaryClosed && (
        <View style={[styles.closedBanner, { backgroundColor: colors.error + "15", borderColor: colors.error + "40" }]}>
          <IconSymbol name="xmark.circle.fill" size={18} color={colors.error} />
          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.error, marginLeft: 8, flex: 1 }}>Business is temporarily closed</Text>
        </View>
      )}

      {/* Location Switcher */}
      {hasMultipleLocations && (
        <View style={[{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 10 }]}>
          <IconSymbol name="mappin.and.ellipse" size={18} color={colors.primary} />
          <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }}>Active Location</Text>
          <LocationSwitcher />
        </View>
      )}

      {/* Business Name */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <IconSymbol name="building.2.fill" size={20} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Business Name</Text>
          </View>
          {!editingName && (
            <Pressable onPress={() => { setNameValue(settings.businessName); setEditingName(true); }} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
              <IconSymbol name="pencil" size={18} color={colors.primary} />
            </Pressable>
          )}
        </View>
        {editingName ? (
          <View style={styles.editRow}>
            <TextInput
              style={[styles.editInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              value={nameValue}
              onChangeText={setNameValue}
              returnKeyType="done"
              onSubmitEditing={saveName}
              autoFocus
            />
            <Pressable onPress={saveName} style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
              <Text style={styles.smallButtonText}>Save</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={{ fontSize: fs.md, color: colors.foreground, fontWeight: "500" }}>{settings.businessName}</Text>
        )}
      </View>

      {/* Quick Stats */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardLabel, { color: colors.muted }]}>
          Quick Stats{hasMultipleLocations && activeLocation ? ` — ${activeLocation.name}` : ""}
        </Text>
        <View style={styles.statsRow}>
          {[
            { label: "Services",  value: state.services.length },
            { label: "Clients",   value: clientsForActiveLocation.length },
            { label: "Bookings",  value: filterAppointmentsByLocation(state.appointments).length },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={[styles.statNumber, { color: colors.primary }]}>{s.value}</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Operations */}
      <SectionHeader label="Operations" accentColor="#10B981" colors={colors} topSpacing={false} />
      {renderNavList([
        { title: "Schedule & Hours",  subtitle: hasMultipleLocations && activeLocation ? `${activeLocation.name} hours` : "Working hours, buffer time, custom days", icon: "calendar.badge.clock", route: "/schedule-settings", color: "#10B981", status: "ok" },
        { title: "Booking Policies",  subtitle: "Cancellation fees, booking URL, temp closure",  icon: "exclamationmark.triangle.fill", route: "/booking-policies",  color: "#FF9800" },
        { title: "Locations",         subtitle: `${state.locations.length} location${state.locations.length !== 1 ? "s" : ""} configured`, icon: "building.2.fill", route: "/locations", color: "#3B82F6", status: state.locations.length > 0 ? "ok" : "warn" },
      ])}

      {/* Goals & Targets */}
      <SectionHeader label="Goals & Targets" accentColor="#FF9800" colors={colors} />

      {/* Monthly Revenue Goal */}
      <View style={[styles.navCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.navIcon, { backgroundColor: "#FF980015" }]}>
          <IconSymbol name="chart.bar.fill" size={22} color="#FF9800" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Monthly Revenue Goal</Text>
          {editingGoal ? (
            <View style={{ marginTop: 6 }}>
              <TextInput
                value={goalInput}
                onChangeText={setGoalInput}
                keyboardType="numeric"
                placeholder="e.g. 10000"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                onSubmitEditing={saveGoal}
                style={{ fontSize: fs.sm, color: colors.foreground, borderBottomWidth: 1, borderBottomColor: colors.primary, paddingVertical: 4 }}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable onPress={saveGoal} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs.xs }}>Save</Text>
                </Pressable>
                <Pressable onPress={() => setEditingGoal(false)} style={{ flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: fs.xs, fontWeight: "600" }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
              {settings.monthlyRevenueGoal > 0 ? `$${settings.monthlyRevenueGoal.toLocaleString()} / month` : "Tap to set a monthly goal"}
            </Text>
          )}
        </View>
        {!editingGoal && (
          <Pressable onPress={() => setEditingGoal(true)}>
            <IconSymbol name="pencil" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {/* Staff Alert Threshold */}
      <View style={[styles.navCard, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 }]}>
        <View style={[styles.navIcon, { backgroundColor: "#EF444415" }]}>
          <IconSymbol name="person.2.fill" size={22} color="#EF4444" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Staff Alert Threshold</Text>
          {editingThreshold ? (
            <View style={{ marginTop: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <TextInput
                  value={alertThresholdInput}
                  onChangeText={setAlertThresholdInput}
                  keyboardType="numeric"
                  placeholder="e.g. 80"
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                  onSubmitEditing={saveThreshold}
                  style={{ flex: 1, fontSize: fs.sm, color: colors.foreground, borderBottomWidth: 1, borderBottomColor: colors.primary, paddingVertical: 4 }}
                  autoFocus
                />
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>%</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable onPress={saveThreshold} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs.xs }}>Save</Text>
                </Pressable>
                <Pressable onPress={() => setEditingThreshold(false)} style={{ flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: fs.xs, fontWeight: "600" }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
              Alert when staff completion rate is below {settings.staffAlertThreshold ?? 80}%
            </Text>
          )}
        </View>
        {!editingThreshold && (
          <Pressable onPress={() => setEditingThreshold(true)}>
            <IconSymbol name="pencil" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </>
  );

  // ── PAYMENTS TAB ─────────────────────────────────────────────────────────────

  const renderPaymentsTab = () => {
    const hasStripe = !!(settings as any).stripeConnected;
    const p2pCount = [settings.zelleHandle, settings.cashAppHandle, settings.venmoHandle].filter(Boolean).length;
    return (
      <>
        <SectionHeader label="Subscription" accentColor="#F59E0B" colors={colors} topSpacing={false} />
        {renderNavList([
          { title: "Subscription", subtitle: "Plan, usage & billing", icon: "crown.fill", route: "/subscription", color: "#F59E0B", status: "ok" },
        ])}

        <SectionHeader label="Accept Payments" accentColor="#10B981" colors={colors} />
        {renderNavList([
          {
            title: "Payment Methods",
            subtitle: p2pCount > 0
              ? `${p2pCount} method${p2pCount !== 1 ? "s" : ""} configured`
              : "Stripe, Zelle, Cash App, Venmo",
            icon: "creditcard.fill",
            route: "/payment-methods",
            color: "#10B981",
            status: p2pCount > 0 || hasStripe ? "ok" : "warn",
          },
        ])}

        <SectionHeader label="History & Reports" accentColor="#635BFF" colors={colors} />
        {renderNavList([
          { title: "Payments History", subtitle: "Charges, refunds & payouts audit trail", icon: "list.bullet", route: "/payments-history", color: "#635BFF" },
        ])}
      </>
    );
  };

  // ── CLIENTS TAB ──────────────────────────────────────────────────────────────

  const renderClientsTab = () => {
    const activePackages = (state.packages ?? []).filter((p) => p.active).length;
    const activeCodes    = (state.promoCodes ?? []).filter((p) => p.active).length;
    const noteCount      = (state.noteTemplates ?? []).length;
    return (
      <>
        <SectionHeader label="Client Experience" accentColor="#E91E63" colors={colors} topSpacing={false} />
        {renderNavList([
          {
            title: "Client Reviews",
            subtitle: reviewAvg ? `${reviewAvg} ★ — ${state.reviews.length} review${state.reviews.length !== 1 ? "s" : ""}` : "No reviews yet",
            icon: "star.fill",
            route: "/reviews",
            color: "#F59E0B",
            status: state.reviews.length > 0 ? "ok" : undefined,
          },
          {
            title: "Packages & Bundles",
            subtitle: `${activePackages} active package${activePackages !== 1 ? "s" : ""}`,
            icon: "gift.fill",
            route: "/packages",
            color: "#E91E63",
            status: activePackages > 0 ? "ok" : undefined,
          },
          {
            title: "Promo Codes",
            subtitle: `${activeCodes} active code${activeCodes !== 1 ? "s" : ""}`,
            icon: "ticket.fill",
            route: "/promo-codes",
            color: "#0EA5E9",
            status: activeCodes > 0 ? "ok" : undefined,
          },
          {
            title: "Referrals",
            subtitle: "Share your code & earn free months",
            icon: "person.2.fill",
            route: "/referrals",
            color: "#10B981",
          },
        ])}

        <SectionHeader label="Client Portal" accentColor="#8B5CF6" colors={colors} />
        {/* Portal visibility toggle */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#8B5CF620", alignItems: "center", justifyContent: "center" }}>
              <IconSymbol name="eye.fill" size={20} color="#8B5CF6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Visible in Client Portal</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                {settings.clientPortalVisible ? "Clients can discover and book your business" : "Hidden from client discovery"}
              </Text>
            </View>
            <Switch
              value={settings.clientPortalVisible ?? false}
              onValueChange={togglePortalVisible}
              trackColor={{ false: colors.border, true: "#8B5CF6" }}
              thumbColor="#fff"
            />
          </View>
          {settings.clientPortalVisible && (
            <>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />
              <Pressable
                onPress={() => setShowCategoryPicker(!showCategoryPicker)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#8B5CF620", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="tag.fill" size={18} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Business Category</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                    {selectedCategories.length > 0 ? selectedCategories.join(", ") : "Tap to select categories"}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
              {showCategoryPicker && (
                <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {PORTAL_CATEGORIES.map((cat) => {
                    const isSelected = selectedCategories.includes(cat);
                    return (
                      <Pressable
                        key={cat}
                        onPress={() => togglePortalCategory(cat)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 20,
                          backgroundColor: isSelected ? "#8B5CF6" : colors.border,
                          opacity: pressed ? 0.75 : 1,
                        })}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isSelected ? "#fff" : colors.foreground }}>{cat}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>

        <SectionHeader label="Organisation" accentColor="#10B981" colors={colors} />
        {renderNavList([
          {
            title: "Category Management",
            subtitle: "Manage service and product categories",
            icon: "tag.fill",
            route: "/category-management",
            color: "#10B981",
          },
          {
            title: "Note Templates",
            subtitle: `${noteCount} template${noteCount !== 1 ? "s" : ""} saved`,
            icon: "note.text",
            route: "/note-templates",
            color: "#6366F1",
            status: noteCount > 0 ? "ok" : undefined,
          },
        ])}
      </>
    );
  };

  // ── COMMS TAB ────────────────────────────────────────────────────────────────

  const renderCommsTab = () => (
    <>
      <SectionHeader label="Push Notifications" accentColor={colors.primary} colors={colors} topSpacing={false} />
      <Pressable
        onPress={() => router.push("/notification-settings")}
        style={({ pressed }) => [styles.navCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.navIcon, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="bell.fill" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Notification Preferences</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, lineHeight: 17 }}>
            {settings.notificationsEnabled ? "Active — push, email & reminder settings" : "Paused — tap to manage"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <StatusDot status={settings.notificationsEnabled ? "ok" : "off"} colors={colors} />
          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
        </View>
      </Pressable>

      <SectionHeader label="Reminder Templates" accentColor="#8B5CF6" colors={colors} />
      {renderNavList([
        {
          title: "My Templates",
          subtitle: `${(state.reminderTemplates ?? []).length} saved template${(state.reminderTemplates ?? []).length !== 1 ? "s" : ""}`,
          icon: "note.text",
          route: "/reminder-templates",
          color: "#8B5CF6",
          status: (state.reminderTemplates ?? []).length > 0 ? "ok" : undefined,
        },
        {
          title: "Browse Template Library",
          subtitle: "49 professional SMS templates by category",
          icon: "books.vertical.fill",
          route: "/template-library",
          color: "#8B5CF6",
        },
      ])}

      <SectionHeader label="SMS Messaging" accentColor="#00897B" colors={colors} />
      {renderNavList([
        {
          title: "SMS Messages",
          subtitle: "Customise messages sent to clients",
          icon: "message.fill",
          route: "/sms-templates",
          color: "#00897B",
        },
        {
          title: "SMS Automation",
          subtitle: state.settings.twilioEnabled ? "Enabled — messages send automatically" : "Disabled — tap to configure",
          icon: "wand.and.stars",
          route: "/sms-automation",
          color: "#00897B",
          status: state.settings.twilioEnabled ? "ok" : "warn",
        },
        ])}

      <SectionHeader label="Calendar Sync" accentColor="#22C55E" colors={colors} />
      <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#22C55E20", alignItems: "center", justifyContent: "center" }}>
            <IconSymbol name="calendar" size={20} color="#22C55E" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Sync to Device Calendar</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, lineHeight: 17 }}>
              {calendarSyncEnabled
                ? "Accepted appointments sync to Lime Of Time calendar"
                : "Tap to sync accepted appointments to your device calendar"}
            </Text>
          </View>
          <Switch
            value={calendarSyncEnabled}
            onValueChange={handleCalendarSyncToggle}
            trackColor={{ false: colors.border, true: "#22C55E" }}
            thumbColor="#fff"
          />
        </View>
        {calendarSyncEnabled && (
          <>
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 10 }} />
            <Text style={{ fontSize: fs.xs, color: colors.muted, lineHeight: 17 }}>
              New accepted appointments are automatically added to your device calendar. Cancelled appointments are removed.
            </Text>
          </>
        )}
      </View>
    </>
  );

  // ── ACCOUNT TAB ──────────────────────────────────────────────────────────────

  const renderAccountTab = () => (
    <>
      {/* Profile */}
      <SectionHeader label="Profile" accentColor={colors.primary} colors={colors} topSpacing={false} />
      {renderNavList([
        {
          title: "Business Profile",
          subtitle: settings.profile.ownerName
            ? `${settings.profile.ownerName} · ${settings.businessName}`
            : "Name, owner, phone, email, website",
          icon: "person.fill",
          route: "/business-profile",
          color: colors.primary,
        },
        {
          title: "Social Links",
          subtitle: (() => {
            const s: string[] = [];
            if (settings.instagramHandle) s.push("Instagram");
            if (settings.facebookHandle)  s.push("Facebook");
            if (settings.tiktokHandle)    s.push("TikTok");
            return s.length > 0 ? s.join(" · ") : "Instagram, Facebook, TikTok";
          })(),
          icon: "link",
          route: "/social-links",
          color: "#E1306C",
          status: (settings.instagramHandle || settings.facebookHandle || settings.tiktokHandle) ? "ok" : undefined,
        },
      ])}

      {/* Growth */}
      <SectionHeader label="Growth" accentColor="#16a34a" colors={colors} />
      {renderNavList([
        {
          title: "Refer a Business",
          subtitle: "Share the app, earn 1 free month per conversion",
          icon: "person.2.fill",
          route: "/referrals",
          color: "#16a34a",
        },
      ])}

      {/* Appearance */}
      <SectionHeader label="Appearance" accentColor="#8B5CF6" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardLabel, { color: colors.muted }]}>Theme Mode</Text>
        <View style={styles.themeRow}>
          {themeOptions.map((opt) => {
            const isActive = settings.themeMode === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setThemeMode(opt.key)}
                style={({ pressed }) => [
                  styles.themeOption,
                  {
                    flex: 1,
                    backgroundColor: isActive ? colors.primary + "15" : colors.background,
                    borderColor: isActive ? colors.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <IconSymbol name={opt.icon as any} size={22} color={isActive ? colors.primary : colors.muted} />
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isActive ? colors.primary : colors.muted, marginTop: 6 }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Security — only on native with biometrics */}
      {Platform.OS !== "web" && biometricAvailable && (
        <>
          <SectionHeader label="Security" accentColor="#EF4444" colors={colors} />
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <IconSymbol name="lock.fill" size={20} color={colors.primary} />
                <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground, marginLeft: 12 }}>
                  {biometricType === "face" ? "Face ID" : "Fingerprint"} Lock
                </Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={async (val) => { await toggleBiometric(val); }}
                trackColor={{ false: colors.border, true: colors.primary + "60" }}
                thumbColor={biometricEnabled ? colors.primary : colors.muted}
              />
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6, marginLeft: 32, lineHeight: 17 }}>
              {biometricEnabled ? "App will require authentication on launch" : "Enable to secure your app on launch"}
            </Text>
          </View>
        </>
      )}

      {/* Reports & Data */}
      <SectionHeader label="Reports & Data" accentColor="#8B5CF6" colors={colors} />
      {renderNavList([
        { title: "Analytics",    subtitle: "Revenue, clients, appointments insights", icon: "chart.bar.fill",             route: "/analytics-detail?tab=overview", color: "#8B5CF6" },
        { title: "Export Data",  subtitle: "PDF reports for clients, appointments, revenue", icon: "square.and.arrow.up.fill", route: "/data-export",                   color: colors.primary },
      ])}

      {/* Help */}
      <SectionHeader label="Help" accentColor="#6366F1" colors={colors} />
      {renderNavList([
        { title: "Usage Guide",  subtitle: "How to use every feature in the app", icon: "book.fill", route: "/usage-guide", color: "#0EA5E9" },
      ])}
      <Pressable
        onPress={async () => {
          try { await AsyncStorage.removeItem("@lime_tutorial_seen"); } catch {}
          router.push("/(tabs)/" as any);
        }}
        style={({ pressed }) => [styles.navCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.navIcon, { backgroundColor: "#6366F115" }]}>
          <IconSymbol name="play.fill" size={22} color="#6366F1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Restart Onboarding Tour</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Re-watch the app walkthrough</Text>
        </View>
        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
      </Pressable>

      {/* Switch Portal */}
      <SectionHeader label="Switch Portal" accentColor="#8B5CF6" colors={colors} />
      <Pressable
        onPress={() => {
          Alert.alert(
            "Switch to Client Portal",
            "Your business session will stay active. You can switch back anytime from the portal selector.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Switch",
                onPress: () => router.replace("/profile-select" as any),
              },
            ]
          );
        }}
        style={({ pressed }) => [styles.navCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.navIcon, { backgroundColor: "#8B5CF615" }]}>
          <IconSymbol name="person.2.fill" size={22} color="#8B5CF6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Switch to Client Portal</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Discover and book services as a client</Text>
        </View>
        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
      </Pressable>

      {/* Danger Zone */}
      <SectionHeader label="Danger Zone" accentColor={colors.error} colors={colors} />
      <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [styles.dangerButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.navIcon, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="arrow.right.square.fill" size={22} color={colors.primary} />
        </View>
        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.primary, flex: 1 }}>Log Out</Text>
        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
      </Pressable>
      <Pressable
        onPress={handleDeleteBusiness}
        style={({ pressed }) => [styles.dangerButton, { backgroundColor: colors.error + "08", borderColor: colors.error + "30", opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.navIcon, { backgroundColor: colors.error + "15" }]}>
          <IconSymbol name="trash.fill" size={22} color={colors.error} />
        </View>
        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.error, flex: 1 }}>Delete Business</Text>
        <IconSymbol name="chevron.right" size={16} color={colors.error + "60"} />
      </Pressable>

      {/* Dev Testing (hidden easter egg) */}
      {devTapCount >= 5 && (
        <Pressable
          onPress={() => router.push("/dev-testing" as any)}
          style={({ pressed }) => [styles.navCard, { backgroundColor: "#F59E0B10", borderColor: "#F59E0B30", opacity: pressed ? 0.75 : 1, marginBottom: 10 }]}
        >
          <View style={[styles.navIcon, { backgroundColor: "#F59E0B20" }]}>
            <IconSymbol name="wrench.fill" size={22} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: "#F59E0B" }}>Dev Testing Panel</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Seed & cleanup test data</Text>
          </View>
          <IconSymbol name="chevron.right" size={16} color="#F59E0B60" />
        </Pressable>
      )}

      {/* App Info */}
      <Pressable
        onPress={() => setDevTapCount((n) => n + 1)}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <View style={[styles.card, {
          backgroundColor: colors.surface,
          borderColor: devTapCount >= 3 && devTapCount < 5 ? "#F59E0B40" : colors.border,
          alignItems: "center",
          paddingVertical: 28,
          marginTop: 20,
          marginBottom: 8,
        }]}>
          <Image source={require("@/assets/images/icon.png")} style={{ width: 60, height: 60, borderRadius: 16, marginBottom: 10 }} resizeMode="contain" />
          <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>Lime Of Time</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 3 }}>Version 1.0.0</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Smart Scheduling for Small Business</Text>
        </View>
      </Pressable>
    </>
  );

  // ── Search ────────────────────────────────────────────────────────────────────

  const allSearchableItems = useMemo(() => [
    // Business
    { title: "Schedule & Hours",       subtitle: "Working hours, buffer time, custom days",             icon: "calendar.badge.clock" as const,           color: "#10B981", route: "/schedule-settings" as const },
    { title: "Booking Policies",       subtitle: "Cancellation fees, booking URL, temp closure",        icon: "exclamationmark.triangle.fill" as const,   color: "#FF9800", route: "/booking-policies" as const },
    { title: "Locations",              subtitle: `${state.locations.length} location${state.locations.length !== 1 ? "s" : ""} configured`, icon: "building.2.fill" as const, color: "#3B82F6", route: "/locations" as const },
    // Payments
    { title: "Subscription",           subtitle: "Plan, usage & billing",                               icon: "crown.fill" as const,                      color: "#F59E0B", route: "/subscription" as const },
    { title: "Payment Methods",        subtitle: "Stripe, Zelle, Cash App, Venmo",                      icon: "creditcard.fill" as const,                 color: "#10B981", route: "/payment-methods" as const },
    { title: "Payments History",       subtitle: "Charges, refunds & payouts audit trail",              icon: "list.bullet" as const,                     color: "#635BFF", route: "/payments-history" as const },
    // Clients
    { title: "Client Reviews",         subtitle: reviewAvg ? `${reviewAvg} ★ · ${state.reviews.length} reviews` : "No reviews yet", icon: "star.fill" as const, color: "#F59E0B", route: "/reviews" as const },
    { title: "Packages & Bundles",     subtitle: `${(state.packages ?? []).filter((p) => p.active).length} active packages`, icon: "gift.fill" as const, color: "#E91E63", route: "/packages" as const },
    { title: "Promo Codes",            subtitle: `${(state.promoCodes ?? []).filter((p) => p.active).length} active codes`, icon: "ticket.fill" as const, color: "#0EA5E9", route: "/promo-codes" as const },
    { title: "Category Management",    subtitle: "Manage service and product categories",               icon: "tag.fill" as const,                        color: "#10B981", route: "/category-management" as const },
    { title: "Note Templates",         subtitle: `${(state.noteTemplates ?? []).length} templates saved`, icon: "note.text" as const,                     color: "#6366F1", route: "/note-templates" as const },
    // Comms
    { title: "Notification Preferences", subtitle: "Push, email & reminder settings",                  icon: "bell.fill" as const,                       color: colors.primary, route: "/notification-settings" as const },
    { title: "SMS Messages",           subtitle: "Customise messages sent to clients",                  icon: "message.fill" as const,                    color: "#00897B", route: "/sms-templates" as const },
    { title: "SMS Automation",         subtitle: state.settings.twilioEnabled ? "Enabled" : "Disabled", icon: "wand.and.stars" as const,                  color: "#00897B", route: "/sms-automation" as const },
    // Account
    { title: "Business Profile",       subtitle: "Name, owner, phone, email, website",                  icon: "person.fill" as const,                     color: colors.primary, route: "/business-profile" as const },
    { title: "Social Links",           subtitle: "Instagram, Facebook, TikTok",                         icon: "link" as const,                            color: "#E1306C", route: "/social-links" as const },
    { title: "Analytics",              subtitle: "Revenue, clients, appointments insights",             icon: "chart.bar.fill" as const,                  color: "#8B5CF6", route: "/analytics-detail?tab=overview" as const },
    { title: "Export Data",            subtitle: "PDF reports for clients, appointments, revenue",      icon: "square.and.arrow.up.fill" as const,         color: colors.primary, route: "/data-export" as const },
    { title: "Usage Guide",            subtitle: "How to use every feature in the app",                 icon: "book.fill" as const,                       color: "#0EA5E9", route: "/usage-guide" as const },
    { title: "Restart Onboarding Tour",subtitle: "Re-watch the app walkthrough",                        icon: "play.fill" as const,                       color: "#6366F1", route: "/(tabs)/" as const },
  ], [state.locations.length, state.reviews.length, state.packages, state.noteTemplates, state.promoCodes, state.settings.twilioEnabled, reviewAvg, colors.primary]);

  const renderSearchResults = () => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = allSearchableItems.filter(
      (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q)
    );
    if (filtered.length === 0) {
      return (
        <View style={{ alignItems: "center", paddingVertical: 48 }}>
          <IconSymbol name="magnifyingglass" size={36} color={colors.muted} />
          <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>No results</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>Try a different keyword</Text>
        </View>
      );
    }
    return (
      <View>
        <Text style={[styles.sectionLabel, { color: colors.muted, marginBottom: 10 }]}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </Text>
        {filtered.map((item) => (
          <Pressable
            key={item.title}
            onPress={() => router.push(item.route as any)}
            style={({ pressed }) => [styles.navCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.navIcon, { backgroundColor: item.color + "15" }]}>
              <IconSymbol name={item.icon} size={22} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{item.title}</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{item.subtitle}</Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    );
  };

  const tabContent: Record<TabKey, () => React.ReactElement> = {
    business: renderBusinessTab,
    payments: renderPaymentsTab,
    clients:  renderClientsTab,
    comms:    renderCommsTab,
    account:  renderAccountTab,
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenContainer tabletMaxWidth={0}>
      <FuturisticBackground />

      {/* Header */}
      <View style={[styles.headerRow, { paddingHorizontal: hp, paddingTop: 8 }]}>
        <Text style={{ fontSize: fs.xl, fontWeight: "700", color: colors.foreground }}>Settings</Text>
        <Image source={require("@/assets/images/icon.png")} style={styles.headerLogo} resizeMode="contain" />
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border, paddingHorizontal: hp }]}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={({ pressed }) => [
                styles.tabItem,
                { borderBottomColor: isActive ? colors.primary : "transparent", opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <IconSymbol name={tab.icon as any} size={20} color={isActive ? colors.primary : colors.muted} />
              <Text style={{ fontSize: fs.xs, fontWeight: isActive ? "700" : "500", color: isActive ? colors.primary : colors.muted, marginTop: 3 }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Search Bar */}
      <View style={{ paddingHorizontal: hp, paddingTop: 10, paddingBottom: 6 }}>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: searchQuery ? colors.primary : colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search settings..."
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: fs.sm, color: colors.foreground, marginLeft: 8, paddingVertical: 0 }}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <IconSymbol name="xmark" size={14} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Tab Content */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={{ paddingHorizontal: hp, paddingTop: 14, paddingBottom: 100, alignSelf: "center", width: "100%", maxWidth: maxContentWidth }}
      >
        {searchQuery.trim() ? renderSearchResults() : tabContent[activeTab]()}
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 0, paddingBottom: 8 },
  headerLogo:     { width: 32, height: 32, borderRadius: 8 },
  tabBar:         { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 0 },
  tabItem:        { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2.5 },
  closedBanner:   { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  card:           { borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: StyleSheet.hairlineWidth },
  cardLabel:      { fontSize: 11, fontWeight: "500", marginBottom: 10 },
  cardHeader:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center" },
  cardTitle:      { fontSize: 13, fontWeight: "600", marginLeft: 10 },
  editRow:        { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
  editInput:      { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 20, borderWidth: 1 },
  smallButton:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 36 },
  smallButtonText:{ color: "#FFFFFF", fontSize: 11, fontWeight: "600", lineHeight: 18 },
  themeRow:       { flexDirection: "row", gap: 10, width: "100%" },
  themeOption:    { alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 14, borderWidth: 1.5 },
  switchRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel:    { flexDirection: "row", alignItems: "center", flex: 1 },
  statsRow:       { flexDirection: "row", justifyContent: "space-between", width: "100%" },
  statItem:       { flex: 1, alignItems: "center" },
  statNumber:     { fontSize: 20, fontWeight: "700", lineHeight: 30 },
  navCard:        { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, gap: 14 },
  navIcon:        { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dangerButton:   { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, width: "100%", gap: 14 },
  sectionLabel:   { fontSize: 11, fontWeight: "700", color: "#687076", marginBottom: 8, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.8 },
  searchBar:      { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
});
