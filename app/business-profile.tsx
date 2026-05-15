import { useState, useCallback, useRef } from "react";
import {
  Text,
  View,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  StyleSheet,
  Alert,
  Linking,
  Platform,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { formatPhoneNumber, stripPhoneFormat } from "@/lib/types";
import { FuturisticBackground } from "@/components/futuristic-background";


// ─── Timezone options ────────────────────────────────────────────────────────
const TIMEZONE_OPTIONS = [
  { value: "America/New_York",    label: "Eastern Time (ET) — New York, Miami" },
  { value: "America/Chicago",     label: "Central Time (CT) — Chicago, Dallas" },
  { value: "America/Denver",      label: "Mountain Time (MT) — Denver, Salt Lake City" },
  { value: "America/Phoenix",     label: "Mountain Time - AZ (no DST) — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT) — Los Angeles, Seattle" },
  { value: "America/Anchorage",   label: "Alaska Time (AKT) — Anchorage" },
  { value: "Pacific/Honolulu",    label: "Hawaii Time (HT) — Honolulu" },
  { value: "America/Puerto_Rico", label: "Atlantic Time (AT) — Puerto Rico" },
  { value: "Europe/London",       label: "GMT / London" },
  { value: "Europe/Paris",        label: "Central European Time (CET) — Paris, Berlin" },
  { value: "Europe/Moscow",       label: "Moscow Time (MSK)" },
  { value: "Asia/Dubai",          label: "Gulf Standard Time (GST) — Dubai" },
  { value: "Asia/Kolkata",        label: "India Standard Time (IST)" },
  { value: "Asia/Singapore",      label: "Singapore Time (SGT)" },
  { value: "Asia/Tokyo",          label: "Japan Standard Time (JST)" },
  { value: "Australia/Sydney",    label: "Australian Eastern Time (AET) — Sydney" },
];

// ─── Field wrapper ────────────────────────────────────────────────────────────
// IMPORTANT: defined OUTSIDE the screen component so its identity is stable
// across re-renders. If defined inside, React unmounts/remounts it on every
// keystroke (because the function reference changes), which dismisses the keyboard.
type FieldProps = {
  label: string;
  required?: boolean;
  error?: string;
  errorColor: string;
  foregroundColor: string;
  children: React.ReactNode;
};

function Field({ label, required, error, errorColor, foregroundColor, children }: FieldProps) {
  const { fs } = useResponsive();
  return (
    <View style={styles.fieldWrapper}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 }}>
        <Text style={[styles.fieldLabel, { color: foregroundColor }]}>{label}</Text>
        {required && <Text style={{ fontSize: fs.xs, color: errorColor }}>*</Text>}
      </View>
      {children}
      {!!error && (
        <View style={styles.errorRow}>
          <IconSymbol name="exclamationmark.triangle.fill" size={12} color={errorColor} />
          <Text style={[styles.errorText, { color: errorColor }]}>{error}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function BusinessProfileScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();
  const contentMaxWidth = isTablet ? 640 : undefined;

  const profile = state.settings.profile;

  const [businessName, setBusinessName] = useState(state.settings.businessName);
  const [ownerName, setOwnerName] = useState(profile.ownerName ?? "");
  const [phone, setPhone] = useState(formatPhoneNumber(profile.phone || ""));
  const [email, setEmail] = useState(profile.email ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [timezone, setTimezone] = useState<string>((state.settings as any).timezone ?? "America/New_York");
  const [showTimezonePicker, setShowTimezonePicker] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoUri, setLogoUri] = useState<string>(profile.businessLogoUri ?? "");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const [coverPhotoUri, setCoverPhotoUri] = useState<string>((profile as any).coverPhotoUri ?? "");
  const [uploadingCover, setUploadingCover] = useState(false);
  const pickCoverPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      if (Platform.OS !== "web") {
        try {
          setUploadingCover(true);
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const mimeType = result.assets[0].mimeType ?? "image/jpeg";
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "covers" });
          setCoverPhotoUri(url);
        } catch {
          setCoverPhotoUri(localUri);
        } finally {
          setUploadingCover(false);
        }
      } else {
        setCoverPhotoUri(localUri);
      }
    }
  };
  const pickLogo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to upload a logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      if (Platform.OS !== "web") {
        try {
          setUploadingLogo(true);
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const mimeType = result.assets[0].mimeType ?? "image/jpeg";
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "logos" });
          setLogoUri(url);
        } catch {
          setLogoUri(localUri);
        } finally {
          setUploadingLogo(false);
        }
      } else {
        setLogoUri(localUri);
      }
    }
  };

  const ownerRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const websiteRef = useRef<TextInput>(null);
  const descRef = useRef<TextInput>(null);

  const validate = useCallback(() => {
    const newErrors: Record<string, string> = {};
    if (!businessName.trim()) newErrors.businessName = "Business name is required.";
    if (!phone.trim()) {
      newErrors.phone = "Phone number is required.";
    } else if (stripPhoneFormat(phone).length < 10) {
      newErrors.phone = "Please enter a valid 10-digit phone number.";
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = "Please enter a valid email address.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [businessName, phone, email]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    const settingsAction = {
      type: "UPDATE_SETTINGS" as const,
      payload: {
        businessName: businessName.trim(),
        // Write to top-level so portal selector, settings header, and lock screen
        // all read the same value via state.settings.businessLogoUri
        businessLogoUri: logoUri.trim() || "",
        timezone,
        profile: {
          ...profile,
          ownerName: ownerName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          website: website.trim(),
          description: description.trim(),
          businessLogoUri: logoUri.trim() || undefined,
          coverPhotoUri: coverPhotoUri.trim() || undefined,
        },
      } as any,
    };
    dispatch(settingsAction);
    syncToDb(settingsAction);
    router.back();
  }, [businessName, ownerName, phone, email, website, description, timezone, profile, dispatch, syncToDb, router, validate]);

  const openWebsite = useCallback(() => {
    const url = website.startsWith("http") ? website : `https://${website}`;
    Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open website."));
  }, [website]);

  return (
    <ScreenContainer edges={["top", "left", "right"]} tabletMaxWidth={720} style={{ paddingHorizontal: hp }}>
      <FuturisticBackground />
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, flex: 1 }}>
          Business Profile
        </Text>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: fs.sm }}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100, alignItems: contentMaxWidth ? "center" : undefined }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: "100%", maxWidth: contentMaxWidth }}>
            <Text style={[styles.requiredNote, { color: colors.muted }]}>
              Fields marked with <Text style={{ color: colors.error }}>*</Text> are required.
            </Text>

            {/* Business Name */}
            <Field
              label="Business Name"
              required
              error={errors.businessName}
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <TextInput
                value={businessName}
                onChangeText={(v) => { setBusinessName(v); setErrors((e) => ({ ...e, businessName: "" })); }}
                placeholder="e.g. Lime of Time"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: errors.businessName ? colors.error : colors.border,
                    color: colors.foreground,
                  },
                ]}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => ownerRef.current?.focus()}
              />
            </Field>

            {/* Owner Name */}
            <Field
              label="Owner Name (optional)"
              error={errors.ownerName}
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <TextInput
                ref={ownerRef}
                value={ownerName}
                onChangeText={(v) => { setOwnerName(v); setErrors((e) => ({ ...e, ownerName: "" })); }}
                placeholder="e.g. Jane Smith"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: errors.ownerName ? colors.error : colors.border,
                    color: colors.foreground,
                  },
                ]}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => phoneRef.current?.focus()}
              />
            </Field>

            {/* Phone */}
            <Field
              label="Phone"
              required
              error={errors.phone}
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <TextInput
                ref={phoneRef}
                value={phone}
                onChangeText={(v) => { setPhone(formatPhoneNumber(v)); setErrors((e) => ({ ...e, phone: "" })); }}
                placeholder="(000) 000-0000"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: errors.phone ? colors.error : colors.border,
                    color: colors.foreground,
                  },
                ]}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </Field>

            {/* Email */}
            <Field
              label="Email (optional)"
              error={errors.email}
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <TextInput
                ref={emailRef}
                value={email}
                onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: "" })); }}
                placeholder="hello@yourbusiness.com"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: errors.email ? colors.error : colors.border,
                    color: colors.foreground,
                  },
                ]}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => websiteRef.current?.focus()}
              />
            </Field>

            {/* Website */}
            <Field
              label="Website (optional)"
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <View style={styles.websiteRow}>
                <TextInput
                  ref={websiteRef}
                  value={website}
                  onChangeText={setWebsite}
                  placeholder="https://www.yourbusiness.com"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  keyboardType="url"
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => descRef.current?.focus()}
                />
                {!!website.trim() && (
                  <Pressable
                    onPress={openWebsite}
                    style={({ pressed }) => [
                      styles.websiteOpenBtn,
                      { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <IconSymbol name="arrow.up.right.square" size={18} color={colors.primary} />
                  </Pressable>
                )}
              </View>
            </Field>

            {/* Timezone */}
            <Field
              label="Business Timezone"
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8, lineHeight: 15 }}>
                Used to display appointment times correctly to clients in other time zones.
              </Text>
              <Pressable
                onPress={() => setShowTimezonePicker(true)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: colors.foreground, fontSize: fs.sm }}>
                  {TIMEZONE_OPTIONS.find((t) => t.value === timezone)?.label ?? timezone}
                </Text>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            </Field>

            {/* Timezone picker modal */}
            <Modal visible={showTimezonePicker} transparent animationType="slide" onRequestClose={() => setShowTimezonePicker(false)}>
              <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setShowTimezonePicker(false)} />
              <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, maxHeight: "70%" }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Select Timezone</Text>
                  <Pressable onPress={() => setShowTimezonePicker(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                    <IconSymbol name="xmark" size={20} color={colors.muted} />
                  </Pressable>
                </View>
                <ScrollView>
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => { setTimezone(opt.value); setShowTimezonePicker(false); }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: 20,
                        paddingVertical: 14,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                        backgroundColor: pressed ? colors.border : "transparent",
                      })}
                    >
                      <Text style={{ color: colors.foreground, fontSize: fs.sm }}>{opt.label}</Text>
                      {timezone === opt.value && (
                        <IconSymbol name="checkmark" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </Modal>

            {/* Business Logo */}
            <Field
              label="Business Logo (optional)"
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8, lineHeight: 15 }}>
                Shown on your public booking page and client-facing screens.
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <Pressable
                  onPress={pickLogo}
                  style={({ pressed }) => ({
                    width: 80, height: 80,
                    borderRadius: 16,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {uploadingLogo ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : logoUri ? (
                    <Image
                      source={{ uri: logoUri }}
                      style={{ width: 80, height: 80 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <IconSymbol name="photo.badge.plus" size={28} color={colors.muted} />
                  )}
                </Pressable>
                <View style={{ flex: 1, gap: 8 }}>
                  <Pressable
                    onPress={pickLogo}
                    style={({ pressed }) => ({
                      backgroundColor: colors.primary + "18",
                      borderColor: colors.primary + "40",
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      alignItems: "center",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>
                      {logoUri ? "Change Logo" : "Upload Logo"}
                    </Text>
                  </Pressable>
                  {logoUri ? (
                    <Pressable
                      onPress={() => setLogoUri("")}
                      style={({ pressed }) => ({ alignItems: "center", opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: fs.xs, color: colors.error }}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {/* Warning nudge for local file:/// logos */}
              {logoUri.startsWith("file:///") && (
                <Pressable
                  onPress={pickLogo}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, backgroundColor: colors.warning + "18", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.warning + "40" }}
                >
                  <Text style={{ fontSize: fs.md }}>⚠️</Text>
                  <Text style={{ flex: 1, fontSize: fs.xs, color: colors.warning, lineHeight: 17 }}>
                    Logo may not display after reinstall — tap to re-upload to cloud storage.
                  </Text>
                </Pressable>
              )}
            </Field>

            {/* Cover Photo */}
            <Field
              label="Cover Photo (optional)"
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 10 }}>
                Shown as the banner image on your client portal page (16:9 ratio recommended)
              </Text>
              {coverPhotoUri ? (
                <View style={{ borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
                  <Image source={{ uri: coverPhotoUri }} style={{ width: "100%", height: 140 }} resizeMode="cover" />
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={pickCoverPhoto}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: colors.primary + "18",
                    borderColor: colors.primary + "40",
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingVertical: 9,
                    paddingHorizontal: 14,
                    alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {uploadingCover ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>
                      {coverPhotoUri ? "Change Cover" : "Upload Cover Photo"}
                    </Text>
                  )}
                </Pressable>
                {coverPhotoUri ? (
                  <Pressable
                    onPress={() => setCoverPhotoUri("")}
                    style={({ pressed }) => ({
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: colors.error + "40",
                      alignItems: "center",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.error }}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            </Field>
            {/* Description */}
            <Field
              label="Description (optional)"
              errorColor={colors.error}
              foregroundColor={colors.foreground}
            >
              <TextInput
                ref={descRef}
                value={description}
                onChangeText={setDescription}
                placeholder="Tell clients about your business, specialties, and what makes you unique..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                    minHeight: 100,
                    textAlignVertical: "top",
                    paddingTop: 12,
                  },
                ]}
              />
            </Field>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
  },
  requiredNote: {
    fontSize: 11,
    marginBottom: 16,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 16,
    marginTop: 8,
    marginBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  sectionNote: {
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 12,
  },
  twoColRow: {
    flexDirection: "row",
    gap: 10,
  },
  fieldWrapper: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
  },
  errorText: {
    fontSize: 11,
  },
  websiteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  websiteOpenBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
});
