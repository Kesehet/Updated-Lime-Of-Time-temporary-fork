/**
 * Client Portal — Profile Tab
 *
 * Shows account info, saved businesses shortcut, notification prefs,
 * and sign out. Also allows switching back to Business profile.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
  Image,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { formatPhone } from "@/lib/utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppLockContextSafe } from "@/lib/app-lock-provider";
import {
  loadNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
  DEFAULT_PREFS,
} from "@/lib/notifications";
import * as Notifications from "expo-notifications";

const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

interface MenuItemProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  destructive?: boolean;
  badge?: number;
}

function MenuItem({ icon, label, subtitle, onPress, destructive, badge }: MenuItemProps) {
  const iconBg = destructive ? "rgba(252,165,165,0.15)" : "rgba(143,191,106,0.12)";
  const iconColor = destructive ? "#FCA5A5" : GREEN_ACCENT;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuItem,
        pressed && { backgroundColor: "rgba(255,255,255,0.05)" },
      ]}
      onPress={onPress}
    >
      <View style={[styles.menuIconWrap, { backgroundColor: iconBg }]}>
        <IconSymbol name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuLabel, destructive && { color: "#FCA5A5" }]}>{label}</Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
      {badge != null && badge > 0 && (
        <View style={styles.badgeWrap}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      {!destructive && <IconSymbol name="chevron.right" size={14} color={TEXT_MUTED} />}
    </Pressable>
  );
}

export default function ClientProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, signOut, dispatch } = useClientStore();
  const [signingOut, setSigningOut] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [pushPermission, setPushPermission] = useState<"granted" | "denied" | "undetermined">("undetermined");
  const { biometricEnabled, biometricAvailable, biometricType, toggleBiometric } = useAppLockContextSafe();

  // Load notification prefs and push permission on mount
  useEffect(() => {
    loadNotificationPrefs().then(setNotifPrefs);
    if (Platform.OS !== "web") {
      Notifications.getPermissionsAsync().then((s) => setPushPermission(s.status as any));
    }
  }, []);

  const updateNotifPref = async (key: keyof NotificationPrefs, value: boolean) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    await saveNotificationPrefs(updated);
  };

  const handleToggleFaceId = async (value: boolean) => {
    if (!biometricAvailable) {
      Alert.alert(
        "Not Available",
        "Face ID / Touch ID is not set up on this device. Please enable it in iOS Settings first.",
      );
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const success = await toggleBiometric(value);
    if (!success && value) {
      Alert.alert("Authentication Failed", "Could not enable Face ID. Please try again.");
    }
  };

  const faceIdLabel =
    biometricType === "face" ? "Face ID Lock" :
    biometricType === "fingerprint" ? "Fingerprint Lock" :
    "Biometric Lock";
  const faceIdSubtitle = biometricEnabled
    ? "Re-authenticates after 24 hours away"
    : "Require Face ID to open the client portal";

  const handleSignOut = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out of your client account?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setSigningOut(true);
            await signOut();
            try { router.dismissAll(); } catch {}
            router.replace("/profile-select" as any);
          },
        },
      ]
    );
  };

  const handleSwitchToBusiness = async () => {
    // Check if a business account is already saved on this device
    const savedOwnerId = await AsyncStorage.getItem("@bookease_business_owner_id");
    const savedBusinessName = await AsyncStorage.getItem("@bookease_business_name");

    if (savedOwnerId) {
      // Returning business owner — show confirmation with their business name
      const displayName = savedBusinessName ?? "your business";
      Alert.alert(
        "Switch to Business Portal",
        `Switch to ${displayName}? Your client account will remain active.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Switch",
            onPress: async () => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const { setProfileMode } = await import("@/lib/client-store");
              await setProfileMode("business");
              // Dismiss the fullScreenModal stack before navigating to profile-select
              try { router.dismissAll(); } catch {}
              router.replace("/profile-select" as any);
            },
          },
        ]
      );
    } else {
      // No business account — go to onboarding to create/login
      Alert.alert(
        "Switch to Business Portal",
        "Set up or log into a business account to manage appointments, clients, and more.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Get Started",
            onPress: async () => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const { setProfileMode } = await import("@/lib/client-store");
              await setProfileMode("business");
              // Dismiss the fullScreenModal stack before navigating to profile-select
              try { router.dismissAll(); } catch {}
              router.replace("/profile-select" as any);
            },
          },
        ]
      );
    }
  };

  if (!state.account) {
    const features = [
      { icon: 'calendar', title: 'Book Appointments', desc: 'Schedule services at your favourite businesses' },
      { icon: 'message.fill', title: 'Message Businesses', desc: 'Chat directly with salons, spas, and more' },
      { icon: 'bell.fill', title: 'Smart Reminders', desc: 'Get notified 24h, 1h, and 30 min before each visit' },
      { icon: 'gift.fill', title: 'Gifts & Packages', desc: 'Buy and redeem gift cards and service bundles' },
    ] as const;
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <ScrollView
          contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Page title */}
          <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 4 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 }}>Profile</Text>
          </View>

          {/* Hero card */}
          <View style={{
            marginHorizontal: 16, marginTop: 16,
            borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.07)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
            padding: 24, alignItems: 'center',
          }}>
            {/* Avatar ring */}
            <View style={{
              width: 88, height: 88, borderRadius: 44,
              backgroundColor: 'rgba(143,191,106,0.14)',
              borderWidth: 2.5, borderColor: 'rgba(143,191,106,0.35)',
              alignItems: 'center', justifyContent: 'center', marginBottom: 18,
            }}>
              <IconSymbol name="person.crop.circle.fill" size={50} color={GREEN_ACCENT} />
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 6, textAlign: 'center', letterSpacing: -0.3 }}>
              Welcome to Lime Of Time
            </Text>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 21, marginBottom: 22, maxWidth: 270 }}>
              Sign in to manage your bookings, message businesses, and receive appointment reminders.
            </Text>
            {/* Primary CTA */}
            <Pressable
              style={({ pressed }) => ({
                backgroundColor: GREEN_ACCENT,
                paddingVertical: 15,
                borderRadius: 30,
                width: '100%',
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                shadowColor: GREEN_ACCENT,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.35,
                shadowRadius: 10,
                elevation: 6,
              })}
              onPress={() => {
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push('/client-signin' as any);
              }}
            >
              <Text style={{ color: GREEN_DARK, fontSize: 16, fontWeight: '800', letterSpacing: 0.2 }}>Sign In / Create Account</Text>
            </Pressable>
          </View>

          {/* Feature list */}
          <View style={{ marginHorizontal: 16, marginTop: 14, gap: 10 }}>
            {features.map((f) => (
              <View
                key={f.icon}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: 16, borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.08)',
                  padding: 14,
                }}
              >
                <View style={{
                  width: 44, height: 44, borderRadius: 13,
                  backgroundColor: 'rgba(143,191,106,0.14)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <IconSymbol name={f.icon as any} size={22} color={GREEN_ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 }}>{f.title}</Text>
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.48)', lineHeight: 17 }}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Switch to Business link */}
          <Pressable
            style={({ pressed }) => ({
              marginHorizontal: 16, marginTop: 16,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 14, borderRadius: 16,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
              backgroundColor: 'rgba(255,255,255,0.05)',
              opacity: pressed ? 0.7 : 1,
            })}
            onPress={handleSwitchToBusiness}
          >
            <IconSymbol name="briefcase.fill" size={16} color={'rgba(255,255,255,0.5)'} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.55)' }}>Switch to Business Portal</Text>
          </Pressable>

          {/* App Branding */}
          <View style={[styles.brandingWrap, { marginTop: 28 }]}>
            <View style={styles.brandLogoRing}>
              <Image source={require('../../assets/images/icon.png')} style={styles.brandLogo} resizeMode="cover" />
            </View>
            <View style={styles.brandTitleWrap}>
              <Text style={styles.brandAppName}>Lime Of Time</Text>
              <Text style={styles.brandTagline}>Book appointments with ease</Text>
              <View style={styles.brandByLine}>
                <View style={styles.brandByLineDash} />
                <Text style={styles.brandByLineText}>CLIENT PORTAL</Text>
                <View style={styles.brandByLineDash} />
              </View>
              <Text style={styles.brandByInnovancio}>BY INNOVANCIO</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  const handlePickAvatar = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library to change your profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    try {
      setUploadingAvatar(true);
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const filename = uri.split("/").pop() ?? "photo.jpg";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      const { getApiBaseUrl } = await import("@/constants/oauth");
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/client/upload-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.sessionToken}` },
        body: JSON.stringify({ base64, mimeType }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as { url: string };
      // Save to profile
      const patchRes = await fetch(`${apiBase}/api/client/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.sessionToken}` },
        body: JSON.stringify({ profilePhotoUri: data.url }),
      });
      if (!patchRes.ok) throw new Error("Save failed");
      const updated = await patchRes.json() as any;
      dispatch({ type: "SET_ACCOUNT", payload: { ...state.account!, profilePhotoUri: data.url } });
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert("Error", "Could not update profile photo. Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40, paddingTop: insets.top }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <Pressable
            style={({ pressed }) => [{ position: "relative" }, pressed && { opacity: 0.85 }]}
            onPress={handlePickAvatar}
            disabled={uploadingAvatar}
            accessibilityLabel="Change profile photo"
          >
            {state.account.profilePhotoUri ? (
              <ExpoImage
                source={{ uri: state.account.profilePhotoUri }}
                style={[styles.avatar, { borderWidth: 2.5, borderColor: GREEN_ACCENT }]}
                contentFit="cover"
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>
                  {state.account.name
                    ? state.account.name.charAt(0).toUpperCase()
                    : (state.account.phone?.replace(/\D/g, "").slice(-10, -9) ?? "?").toUpperCase()}
                </Text>
              </View>
            )}
            {/* Camera badge */}
            <View style={{ position: "absolute", bottom: 2, right: 2, width: 24, height: 24, borderRadius: 12, backgroundColor: GREEN_ACCENT, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: GREEN_DARK }}>
              {uploadingAvatar ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: GREEN_DARK, borderTopColor: "transparent" }} />
              ) : (
                <IconSymbol name="camera.fill" size={11} color={GREEN_DARK} />
              )}
            </View>
          </Pressable>
          <Text style={styles.name}>{state.account.name ?? "Tap Edit Profile to set your name"}</Text>
          {state.account.email && (
            <Text style={styles.email}>{state.account.email}</Text>
          )}
          {state.account.phone && !state.account.phone.startsWith("oauth:") && (
            <Text style={styles.phone}>{formatPhone(state.account.phone)}</Text>
          )}
          <Pressable
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.push("/client-edit-profile" as any)}
          >
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </Pressable>

          {/* Stats Row */}
          {(() => {
            const appts = state.appointments ?? [];
            const completedAppts = appts.filter((a: any) => a.status === "completed");
            const totalVisits = completedAppts.length;
            const totalSpent = completedAppts.reduce((sum: number, a: any) => sum + (a.totalPrice ? Number(a.totalPrice) : 0), 0);
            // Format as "May '26" to keep it compact and single-line
            const memberSince = state.account?.createdAt
              ? (() => {
                  const d = new Date(state.account!.createdAt);
                  const mon = d.toLocaleDateString(undefined, { month: "short" });
                  const yr = String(d.getFullYear()).slice(2);
                  return `${mon} '${yr}`;
                })()
              : null;
            const statCell = (value: string, label: string) => (
              <View style={{ flex: 1, alignItems: "center", paddingVertical: 14, paddingHorizontal: 4 }}>
                <Text
                  style={{ fontSize: 20, fontWeight: "800", color: GREEN_ACCENT, lineHeight: 24 }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >{value}</Text>
                <Text style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 3, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</Text>
              </View>
            );
            return (
              <View style={{
                flexDirection: "row",
                backgroundColor: "rgba(255,255,255,0.07)",
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.1)",
                marginTop: 16,
                marginBottom: 4,
                overflow: "hidden",
              }}>
                {statCell(String(totalVisits), "Visits")}
                <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.1)", marginVertical: 12 }} />
                {statCell(`$${totalSpent.toFixed(0)}`, "Spent")}
                {memberSince ? (
                  <>
                    <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.1)", marginVertical: 12 }} />
                    {statCell(memberSince, "Since")}
                  </>
                ) : null}
              </View>
            );
          })()}
        </View>

        {/* Menu Sections */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BOOKINGS</Text>
          <MenuItem icon="calendar" label="My Bookings" onPress={() => router.push("/(client-tabs)/bookings" as any)} />
          <View style={styles.divider} />
          <MenuItem icon="bookmark.fill" label="Saved Businesses" onPress={() => router.push("/client-saved-businesses" as any)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          {/* Notification settings — tappable row that opens full notification settings */}
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "rgba(255,255,255,0.05)" }]}
            onPress={() => router.push("/client-notifications" as any)}
          >
            <View style={[styles.menuIconWrap, { backgroundColor: "rgba(143,191,106,0.12)" }]}>
              <IconSymbol name="bell.fill" size={18} color={GREEN_ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>All Notifications</Text>
              <Text style={styles.menuSubtitle}>Reminders, push settings & more</Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color="rgba(255,255,255,0.35)" />
          </Pressable>
          <View style={styles.divider} />
          {/* Face ID / Biometric lock toggle */}
          <Pressable
            style={[styles.menuItem]}
            onPress={() => handleToggleFaceId(!biometricEnabled)}
          >
            <View style={[styles.menuIconWrap, { backgroundColor: "rgba(143,191,106,0.12)" }]}>
              <IconSymbol name={biometricType === "face" ? "faceid" : "touchid"} size={18} color={GREEN_ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>{faceIdLabel}</Text>
              <Text style={styles.menuSubtitle}>{faceIdSubtitle}</Text>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={handleToggleFaceId}
              trackColor={{ false: "rgba(255,255,255,0.15)", true: GREEN_ACCENT }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="rgba(255,255,255,0.15)"
            />
          </Pressable>
          <View style={styles.divider} />
          <MenuItem icon="briefcase.fill" label="Switch to Business Profile" subtitle="Manage your own business" onPress={handleSwitchToBusiness} />
        </View>

        <View style={styles.section}>
          <MenuItem icon="rectangle.portrait.and.arrow.right" label="Sign Out" onPress={handleSignOut} destructive />
        </View>

        {/* App Branding - bottom */}
        <View style={[styles.brandingWrap, { marginTop: 8 }]}>
          <View style={styles.brandLogoRing}>
            <Image source={require("../../assets/images/icon.png")} style={styles.brandLogo} resizeMode="cover" />
          </View>
          <View style={styles.brandTitleWrap}>
            <Text style={styles.brandAppName}>Lime Of Time</Text>
            <Text style={styles.brandTagline}>Book appointments with ease</Text>
            <View style={styles.brandByLine}>
              <View style={styles.brandByLineDash} />
              <Text style={styles.brandByLineText}>CLIENT PORTAL</Text>
              <View style={styles.brandByLineDash} />
            </View>
            <Text style={styles.brandByInnovancio}>BY INNOVANCIO</Text>
          </View>
        </View>
        <Text style={styles.version}>Client Portal v1.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  profileHeader: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 6,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(143,191,106,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 2,
    borderColor: "rgba(143,191,106,0.4)",
  },
  avatarInitial: {
    fontSize: 34,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  email: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  phone: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  editBtn: {
    borderWidth: 1.5,
    borderColor: GREEN_ACCENT,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: 8,
  },
  editBtnText: {
    color: GREEN_ACCENT,
    fontSize: 14,
    fontWeight: "600",
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BG,
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
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: TEXT_PRIMARY,
  },
  menuSubtitle: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 1,
  },
  badgeWrap: {
    backgroundColor: "#FCA5A5",
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: CARD_BORDER,
    marginLeft: 64,
  },
  version: {
    textAlign: "center",
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 8,
  },
  brandingWrap: {
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 4,
    gap: 10,
  },
  brandLogoRing: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.22)",
    marginBottom: 4,
  },
  brandLogo: { width: 66, height: 66, borderRadius: 18 },
  brandTitleWrap: { alignItems: "center", gap: 4 },
  brandAppName: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 0.2,
  },
  brandByLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  brandByLineDash: { width: 20, height: 1, backgroundColor: "rgba(255,255,255,0.28)" },
  brandByLineText: {
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  brandByInnovancio: {
    fontSize: 9,
    color: "rgba(255,255,255,0.28)",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 4,
  },
  guestContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  guestAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  guestTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    color: TEXT_PRIMARY,
  },
  guestSubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
    color: TEXT_MUTED,
  },
  signInBtn: {
    backgroundColor: GREEN_ACCENT,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
    marginTop: 8,
  },
  signInBtnText: {
    color: GREEN_DARK,
    fontSize: 15,
    fontWeight: "700",
  },
});
