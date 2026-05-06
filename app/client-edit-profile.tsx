/**
 * Client Edit Profile Screen
 *
 * Allows signed-in clients to update their Full Name, Email, Birthday (MM/DD),
 * and Profile Photo. Accessed from the "Edit Profile" button in the Client Portal
 * profile tab. Saves via PATCH /api/client/profile.
 *
 * Design: dark forest-green portal aesthetic (#1A3A28 → #2D5A3D) matching all
 * other client portal screens.
 */
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useClientStore } from "@/lib/client-store";
import { getApiBaseUrl } from "@/constants/oauth";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Portal palette ───────────────────────────────────────────────────────────
const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";
const INPUT_BG = "rgba(255,255,255,0.07)";
const INPUT_BORDER = "rgba(255,255,255,0.18)";
const INPUT_FOCUSED_BORDER = "rgba(143,191,106,0.6)";

function formatBirthday(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return phone;
}

export default function ClientEditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, signIn } = useClientStore();

  const account = state.account;

  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [birthday, setBirthday] = useState(account?.birthday ?? "");
  const [photoUri, setPhotoUri] = useState<string | null>(account?.profilePhotoUri ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const emailRef = useRef<TextInput>(null);
  const birthdayRef = useRef<TextInput>(null);
  const token = state.sessionToken;

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleRemovePhoto = () => {
    Alert.alert("Remove Photo", "Are you sure you want to remove your profile photo?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => setPhotoUri(null) },
    ]);
  };

  const uploadPhoto = async (uri: string): Promise<string | null> => {
    try {
      setUploading(true);
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const filename = uri.split("/").pop() ?? "photo.jpg";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/client/upload-photo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ base64, mimeType }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { url: string };
      return data.url;
    } catch {
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Please enter your full name."); return; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (birthday && !/^\d{2}\/\d{2}$/.test(birthday)) {
      setError("Birthday should be in MM/DD format (e.g. 03/15).");
      return;
    }

    setSaving(true);
    setError("");
    try {
      let finalPhotoUri = account?.profilePhotoUri ?? null;

      if (photoUri === null) {
        finalPhotoUri = null;
      } else if (photoUri && photoUri.startsWith("file")) {
        const uploaded = await uploadPhoto(photoUri);
        if (uploaded) finalPhotoUri = uploaded;
      } else if (photoUri) {
        finalPhotoUri = photoUri;
      }

      const body: Record<string, string | null> = {
        name: trimmedName,
        email: email.trim() || null,
        birthday: birthday || null,
        profilePhotoUri: finalPhotoUri,
      };

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/client/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to save profile.");
      const data = await res.json() as { clientAccount: any };

      await signIn(data.clientAccount, token!);

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      setError(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!account) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK, alignItems: "center", justifyContent: "center" }}>
        <ClientPortalBackground />
        <Text style={{ color: TEXT_MUTED, fontSize: 15 }}>Not signed in.</Text>
      </View>
    );
  }

  const initials = (account.name ?? "?").charAt(0).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        {/* Save button in header (right side) */}
        <Pressable
          onPress={handleSave}
          disabled={saving || uploading}
          style={({ pressed }) => [styles.headerSaveBtn, (pressed || saving || uploading) && { opacity: 0.7 }]}
        >
          {saving || uploading ? (
            <ActivityIndicator size="small" color={GREEN_ACCENT} />
          ) : (
            <Text style={styles.headerSaveText}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Profile Photo ─────────────────────────────────────────────── */}
          <View style={styles.photoSection}>
            <View style={styles.photoWrap}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImage} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoInitial}>{initials}</Text>
                </View>
              )}
              {/* Camera badge */}
              <Pressable
                onPress={handlePickPhoto}
                style={({ pressed }) => [styles.cameraBadge, pressed && { opacity: 0.8 }]}
              >
                <Text style={{ fontSize: 14 }}>📷</Text>
              </Pressable>
            </View>

            <View style={styles.photoBtns}>
              <Pressable
                onPress={handlePickPhoto}
                style={({ pressed }) => [styles.photoChangeBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.photoChangeBtnText}>Change Photo</Text>
              </Pressable>
              {photoUri && (
                <Pressable
                  onPress={handleRemovePhoto}
                  style={({ pressed }) => [styles.photoRemoveBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.photoRemoveBtnText}>Remove</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* ── Form ──────────────────────────────────────────────────────── */}
          <View style={styles.card}>
            {/* Full Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                FULL NAME <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  focusedField === "name" && styles.inputFocused,
                ]}
                placeholder="e.g. Jane Smith"
                placeholderTextColor={TEXT_MUTED}
                value={name}
                onChangeText={(t) => { setName(t); setError(""); }}
                onFocus={() => setFocusedField("name")}
                onBlur={() => setFocusedField(null)}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>

            <View style={styles.divider} />

            {/* Phone (read-only) */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
              <View style={[styles.input, styles.inputReadOnly]}>
                <Text style={styles.inputReadOnlyText}>
                  {formatPhoneDisplay(account.phone)}
                </Text>
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedText}>✓ Verified</Text>
                </View>
              </View>
              <Text style={styles.fieldHint}>Phone number cannot be changed here</Text>
            </View>

            <View style={styles.divider} />

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                EMAIL <Text style={styles.optional}>(optional)</Text>
              </Text>
              <TextInput
                ref={emailRef}
                style={[
                  styles.input,
                  focusedField === "email" && styles.inputFocused,
                ]}
                placeholder="you@example.com"
                placeholderTextColor={TEXT_MUTED}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => birthdayRef.current?.focus()}
              />
            </View>

            <View style={styles.divider} />

            {/* Birthday */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                BIRTHDAY <Text style={styles.optional}>(optional)</Text>
              </Text>
              <TextInput
                ref={birthdayRef}
                style={[
                  styles.input,
                  focusedField === "birthday" && styles.inputFocused,
                ]}
                placeholder="MM/DD  (e.g. 03/15)"
                placeholderTextColor={TEXT_MUTED}
                value={birthday}
                onChangeText={(t) => { setBirthday(formatBirthday(t)); setError(""); }}
                onFocus={() => setFocusedField("birthday")}
                onBlur={() => setFocusedField(null)}
                keyboardType="number-pad"
                maxLength={5}
                returnKeyType="done"
              />
              <Text style={styles.fieldHint}>
                Businesses may send you birthday discounts
              </Text>
            </View>
          </View>

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Save Button ───────────────────────────────────────────────── */}
          <Pressable
            onPress={handleSave}
            disabled={saving || uploading}
            style={({ pressed }) => [
              styles.saveBtn,
              (pressed || saving || uploading) && { opacity: 0.85 },
            ]}
          >
            {saving || uploading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Header ─────────────────────────────────────────────────────────────────
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
    minWidth: 64,
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
  headerSaveBtn: {
    minWidth: 64,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  headerSaveText: {
    fontSize: 16,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  // ─── Scroll ──────────────────────────────────────────────────────────────────
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 16,
  },
  // ─── Photo ───────────────────────────────────────────────────────────────────
  photoSection: {
    alignItems: "center",
    gap: 14,
    paddingVertical: 8,
  },
  photoWrap: {
    position: "relative",
    width: 100,
    height: 100,
  },
  photoImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2.5,
    borderColor: GREEN_ACCENT,
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "rgba(143,191,106,0.5)",
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoInitial: {
    fontSize: 36,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  cameraBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: GREEN_ACCENT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: GREEN_DARK,
  },
  photoBtns: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  photoChangeBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderColor: GREEN_ACCENT,
  },
  photoChangeBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: GREEN_ACCENT,
  },
  photoRemoveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoRemoveBtnText: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255,100,100,0.85)",
  },
  // ─── Form Card ───────────────────────────────────────────────────────────────
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: "hidden",
    paddingVertical: 4,
  },
  fieldGroup: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: TEXT_MUTED,
    textTransform: "uppercase",
  },
  required: {
    color: "rgba(255,100,100,0.85)",
    fontWeight: "700",
  },
  optional: {
    fontWeight: "400",
    textTransform: "none",
    letterSpacing: 0,
    fontSize: 11,
    color: TEXT_MUTED,
  },
  input: {
    height: 48,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: TEXT_PRIMARY,
    backgroundColor: INPUT_BG,
    borderColor: INPUT_BORDER,
  },
  inputFocused: {
    borderColor: INPUT_FOCUSED_BORDER,
    backgroundColor: "rgba(143,191,106,0.06)",
  },
  inputReadOnly: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    opacity: 0.75,
  },
  inputReadOnlyText: {
    fontSize: 16,
    fontWeight: "500",
    color: TEXT_PRIMARY,
  },
  verifiedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(143,191,106,0.15)",
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_MUTED,
  },
  divider: {
    height: 1,
    backgroundColor: CARD_BORDER,
    marginHorizontal: 16,
  },
  // ─── Error ───────────────────────────────────────────────────────────────────
  errorBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    backgroundColor: "rgba(255,80,80,0.12)",
    borderColor: "rgba(255,80,80,0.3)",
  },
  errorText: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    color: "rgba(255,130,130,1)",
  },
  // ─── Save Button ─────────────────────────────────────────────────────────────
  saveBtn: {
    height: 54,
    backgroundColor: GREEN_ACCENT,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GREEN_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A3A28",
    letterSpacing: 0.2,
  },
});
