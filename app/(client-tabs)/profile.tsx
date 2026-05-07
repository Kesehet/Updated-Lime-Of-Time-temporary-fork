/**
 * Client Portal — Profile Tab
 *
 * Shows account info, saved businesses shortcut, notification prefs,
 * and sign out. Also allows switching back to Business profile.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { formatPhone } from "@/lib/utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
  const { state, signOut } = useClientStore();
  const [signingOut, setSigningOut] = useState(false);

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
              // Auto-routing in _layout.tsx will send them straight to the dashboard
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
              router.replace("/profile-select" as any);
            },
          },
        ]
      );
    }
  };

  if (!state.account) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top }} showsVerticalScrollIndicator={false}>
          {/* App Branding */}
          <View style={styles.brandingWrap}>
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
          <View style={[styles.guestContainer, { paddingTop: 0 }]}>
          <View style={styles.guestAvatar}>
            <IconSymbol name="person.crop.circle.fill" size={48} color={GREEN_ACCENT} />
          </View>
          <Text style={styles.guestTitle}>Create your client account</Text>
          <Text style={styles.guestSubtitle}>
            Sign in to save your bookings, message businesses, and get reminders.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.signInBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/client-signin" as any)}
          >
            <Text style={styles.signInBtnText}>Sign In / Create Account</Text>
          </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40, paddingTop: insets.top }}
        showsVerticalScrollIndicator={false}
      >
        {/* App Branding */}
        <View style={styles.brandingWrap}>
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
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          {state.account.profilePhotoUri ? (
            <Image
              source={{ uri: state.account.profilePhotoUri }}
              style={[styles.avatar, { borderWidth: 2.5, borderColor: GREEN_ACCENT }]}
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
          <MenuItem icon="bell.fill" label="Notification Preferences" subtitle="SMS, push reminders" onPress={() => router.push("/client-notifications" as any)} />
          <View style={styles.divider} />
          <MenuItem icon="briefcase.fill" label="Switch to Business Profile" subtitle="Manage your own business" onPress={handleSwitchToBusiness} />
        </View>

        <View style={styles.section}>
          <MenuItem icon="rectangle.portrait.and.arrow.right" label="Sign Out" onPress={handleSignOut} destructive />
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
