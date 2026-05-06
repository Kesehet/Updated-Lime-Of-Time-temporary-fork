/**
 * Client Profile Onboarding Screen
 *
 * Shown once after phone sign-in for new users (no name set yet).
 * Collects: Full Name (required), Phone (pre-filled, read-only), Email (optional),
 *           Birthday MM/DD (optional), Profile Photo (optional).
 * Saves via PATCH /api/client/profile and then navigates to (client-tabs).
 * Users can also skip — they'll be prompted again next time they book.
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
import { LinearGradient } from "expo-linear-gradient";
import { ScreenContainer } from "@/components/screen-container";
import { useClientStore } from "@/lib/client-store";
import { getApiBaseUrl } from "@/constants/oauth";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

function formatBirthday(raw: string): string {
  // Auto-format as MM/DD
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function ClientProfileOnboardingScreen() {
  const router = useRouter();
  const { state, signIn } = useClientStore();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(state.account?.name ?? "");
  const [email, setEmail] = useState(state.account?.email ?? "");
  const [birthday, setBirthday] = useState(state.account?.birthday ?? "");
  const [photoUri, setPhotoUri] = useState<string | null>(state.account?.profilePhotoUri ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const emailRef = useRef<TextInput>(null);

  const phone = state.account?.phone ?? "";
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

  const uploadPhoto = async (uri: string): Promise<string | null> => {
    try {
      setUploading(true);
      // Read file as base64 using expo-file-system (works on iOS/Android)
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
      setError("Birthday should be in MM/DD format.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      // Upload photo if a new local URI was selected
      let finalPhotoUri = state.account?.profilePhotoUri ?? null;
      if (photoUri && photoUri !== state.account?.profilePhotoUri && photoUri.startsWith("file")) {
        const uploaded = await uploadPhoto(photoUri);
        if (uploaded) finalPhotoUri = uploaded;
        // If upload failed, just skip photo — don't block the user
      } else if (photoUri && !photoUri.startsWith("file")) {
        finalPhotoUri = photoUri; // already a remote URL
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

      // Update local store
      await signIn(data.clientAccount, token!);

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(client-tabs)" as any);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    router.replace("/(client-tabs)" as any);
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-[#0F2318]">
      <LinearGradient
        colors={["#0F2318", "#1A3A28", "#2D5A3D"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.stepLabel}>ALMOST THERE</Text>
            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>
              Help businesses know who you are. You can always update this later.
            </Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Photo picker */}
            <View style={styles.photoSection}>
              <Pressable
                onPress={handlePickPhoto}
                style={({ pressed }) => [styles.photoBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.photoImage} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoPlaceholderIcon}>📷</Text>
                  </View>
                )}
                <View style={styles.photoEditBadge}>
                  <Text style={styles.photoEditBadgeText}>+</Text>
                </View>
              </Pressable>
              <Text style={styles.photoHint}>Add a photo{"\n"}(optional)</Text>
            </View>

            {/* Full Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>FULL NAME <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Jane Smith"
                placeholderTextColor="#9CA3AF"
                value={name}
                onChangeText={(t) => { setName(t); setError(""); }}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus={false}
              />
            </View>

            {/* Phone (read-only) */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
              <View style={[styles.input, styles.inputReadOnly]}>
                <Text style={styles.inputReadOnlyText}>{formatPhoneDisplay(phone)}</Text>
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedText}>✓ Verified</Text>
                </View>
              </View>
            </View>

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EMAIL <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                ref={emailRef}
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* Birthday */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>BIRTHDAY <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="MM/DD  (e.g. 03/15)"
                placeholderTextColor="#9CA3AF"
                value={birthday}
                onChangeText={(t) => { setBirthday(formatBirthday(t)); setError(""); }}
                keyboardType="number-pad"
                maxLength={5}
                returnKeyType="done"
              />
              <Text style={styles.fieldHint}>Used for birthday discounts from businesses you visit</Text>
            </View>

            {/* Error */}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Save button */}
            <Pressable
              onPress={handleSave}
              disabled={saving || uploading}
              style={({ pressed }) => [
                styles.saveBtn,
                { opacity: pressed || saving || uploading ? 0.85 : 1 },
              ]}
            >
              {saving || uploading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save & Continue</Text>
              )}
            </Pressable>

            {/* Skip */}
            <Pressable
              onPress={handleSkip}
              style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 20,
  },
  header: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
    gap: 18,
  },
  // ─── Photo ──────────────────────────────────────────────────────────────────
  photoSection: {
    alignItems: "center",
    gap: 8,
  },
  photoBtn: {
    position: "relative",
    width: 90,
    height: 90,
  },
  photoImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#F3F4F6",
  },
  photoPlaceholder: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#F0FFF4",
    borderWidth: 2,
    borderColor: "#C6E8D1",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPlaceholderIcon: {
    fontSize: 32,
  },
  photoEditBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#4A7C59",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  photoEditBadgeText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    lineHeight: 20,
  },
  photoHint: {
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 17,
  },
  // ─── Fields ──────────────────────────────────────────────────────────────────
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  required: {
    color: "#EF4444",
  },
  optional: {
    color: "#9CA3AF",
    fontWeight: "400",
    textTransform: "none",
    letterSpacing: 0,
  },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  inputReadOnly: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F3F4F6",
    borderColor: "#E5E7EB",
  },
  inputReadOnlyText: {
    fontSize: 16,
    color: "#374151",
    fontWeight: "500",
  },
  verifiedBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16A34A",
  },
  fieldHint: {
    fontSize: 12,
    color: "#9CA3AF",
    lineHeight: 16,
  },
  errorText: {
    fontSize: 13,
    color: "#EF4444",
    textAlign: "center",
  },
  // ─── Buttons ─────────────────────────────────────────────────────────────────
  saveBtn: {
    height: 54,
    backgroundColor: "#4A7C59",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4A7C59",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 6,
  },
  skipText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "500",
  },
});
