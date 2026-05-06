/**
 * Client Portal — Sign In Screen
 *
 * Matches the business onboarding visual style exactly:
 * - Same dark green LinearGradient background (#1A3A28 → #4A7C59)
 * - App logo (icon.png) at top, same ring treatment
 * - White card with Phone+OTP flow AND social login buttons
 * - Real Google / Microsoft / Apple brand logos (via brand-icons.tsx)
 * - Back button to profile-select
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  ScrollView,
  TextInput,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { setProfileMode, useClientStore } from "@/lib/client-store";
import { startOAuthLogin, getApiBaseUrl } from "@/constants/oauth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LinearGradient } from "expo-linear-gradient";
import { CountryCodePicker, DEFAULT_COUNTRY, type Country } from "@/components/country-code-picker";
import { GoogleLogo, MicrosoftLogo, AppleLogo } from "@/components/brand-icons";
// trpc removed (OTP no longer used)
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";

const { width, height } = Dimensions.get("window");
const API_BASE = getApiBaseUrl();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatPhoneUS(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
function stripPhoneFormat(formatted: string): string {
  return formatted.replace(/\D/g, "");
}

// ─── Animated OAuth Button ────────────────────────────────────────────────────
function OAuthButton({
  label, icon, bgColor, textColor, borderColor, loading, disabled, delay, onPress,
}: {
  label: string; icon: React.ReactNode; bgColor: string; textColor: string;
  borderColor?: string; loading?: boolean; disabled?: boolean; delay?: number; onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);
  useEffect(() => {
    opacity.value = withDelay(delay ?? 0, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay ?? 0, withSpring(0, { damping: 18, stiffness: 120 }));
  }, []);
  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const tap = Gesture.Tap()
    .onBegin(() => { scale.value = withSpring(0.96, { damping: 20, stiffness: 300 }); })
    .onFinalize((_, success) => {
      scale.value = withSpring(1, { damping: 18, stiffness: 200 });
      if (success && !disabled) {
        if (Platform.OS !== "web") runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(onPress)();
      }
    });
  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[styles.oauthWrap, animStyle]}>
        <View style={[
          styles.oauthBtn,
          { backgroundColor: bgColor },
          borderColor ? { borderWidth: 1, borderColor } : {},
        ]}>
          {loading ? (
            <ActivityIndicator color={textColor} size="small" />
          ) : icon}
          <Text style={[styles.oauthBtnText, { color: textColor }]}>{label}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
type Step = "options" | "phone";

export default function ClientSignInScreen() {
  const router = useRouter();
  const { signIn } = useClientStore();
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("options");

  // Phone step
  const [selectedCountry, setSelectedCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // (OTP step removed — phone number signs in directly)

  // ── Animations ──────────────────────────────────────────────────────────────
  const logoScale = useSharedValue(0.5);
  const logoOpacity = useSharedValue(0);
  const appNameOpacity = useSharedValue(0);
  const appNameY = useSharedValue(10);
  const cardOpacity = useSharedValue(0);
  const cardY = useSharedValue(40);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    logoScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    appNameOpacity.value = withDelay(300, withTiming(1, { duration: 500 }));
    appNameY.value = withDelay(300, withSpring(0, { damping: 18, stiffness: 100 }));
    cardOpacity.value = withDelay(500, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    cardY.value = withDelay(500, withSpring(0, { damping: 20, stiffness: 120 }));
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const appNameStyle = useAnimatedStyle(() => ({
    opacity: appNameOpacity.value,
    transform: [{ translateY: appNameY.value }],
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  // (OTP animated styles removed — OTP step no longer used)

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleOAuth = async (provider: "apple" | "google" | "microsoft") => {
    setOauthLoading(provider);
    await setProfileMode("client");
    await startOAuthLogin(provider);
    setOauthLoading(null);
  };

  const handlePhoneChange = (text: string) => {
    setPhoneError("");
    if (selectedCountry.dial === "+1") {
      setPhone(formatPhoneUS(text));
    } else {
      setPhone(text.replace(/[^0-9]/g, "").slice(0, 15));
    }
  };

  const handlePhoneNext = async () => {
    const stripped = stripPhoneFormat(phone);
    const isValid = selectedCountry.dial === "+1" ? stripped.length === 10 : stripped.length >= 7;
    if (!isValid) { setPhoneError("Please enter a valid phone number."); return; }
    setPhoneLoading(true);
    setPhoneError("");
    try {
      const rawPhone = selectedCountry.dial === "+1" ? stripped : `${selectedCountry.dial.replace("+", "")}${stripped}`;
      // Directly sign in with phone number (no OTP required)
      const res = await fetch(`${API_BASE}/api/client/phone-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: rawPhone }),
      });
      if (!res.ok) throw new Error("Login failed. Please try again.");
      const data = await res.json() as { token: string; account: any };
      await signIn(data.account, data.token);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate to profile onboarding for new users (no name set yet)
      if (!data.account?.name) {
        router.replace("/client-profile-onboarding" as any);
      } else {
        router.replace("/(client-tabs)" as any);
      }
    } catch (e: any) {
      setPhoneError(e.message ?? "Failed to sign in. Please try again.");
    } finally {
      setPhoneLoading(false);
    }
  };

  // (OTP handlers removed — phone number signs in directly without OTP)

  // (unused OTP resend removed)

  // Back button
  const backScale = useSharedValue(1);
  const goBack = () => {
    if (step === "phone") { setStep("options"); return; }
    router.replace("/profile-select" as any);
  };
  const backTap = Gesture.Tap()
    .onBegin(() => { backScale.value = withSpring(0.93, { damping: 20, stiffness: 300 }); })
    .onFinalize((_, success) => {
      backScale.value = withSpring(1, { damping: 18, stiffness: 200 });
      if (success) {
        if (Platform.OS !== "web") runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(goBack)();
      }
    });
  const backStyle = useAnimatedStyle(() => ({ transform: [{ scale: backScale.value }] }));

  const isPhoneReady = selectedCountry.dial === "+1"
    ? stripPhoneFormat(phone).length === 10
    : stripPhoneFormat(phone).length >= 7;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-[#1A3A28]">
      {/* ─── Green gradient background ────────────────────────── */}
      <LinearGradient
        colors={["#1A3A28", "#2D5A3D", "#4A7C59", "#3D6B4A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.wave1} />
      <View style={styles.wave2} />

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Back button ─────────────────────────────────── */}
          <GestureDetector gesture={backTap}>
            <Animated.View style={[styles.backBtn, backStyle]}>
              <IconSymbol name="chevron.left" size={20} color="rgba(255,255,255,0.8)" />
              <Text style={styles.backText}>Back</Text>
            </Animated.View>
          </GestureDetector>

          {/* ─── Logo + App Name ─────────────────────────────── */}
          <Animated.View style={[styles.logoWrap, logoStyle]}>
            <View style={styles.logoRing}>
              <Image
                source={require("../assets/images/icon.png")}
                style={styles.logo}
                resizeMode="cover"
              />
            </View>
          </Animated.View>
          <Animated.View style={[styles.titleWrap, appNameStyle]}>
            <Text style={styles.appName}>Lime Of Time</Text>
            <Text style={styles.appTagline}>Book appointments with ease</Text>
            <View style={styles.byLine}>
              <View style={styles.byLineDash} />
              <Text style={styles.byLineText}>CLIENT PORTAL</Text>
              <View style={styles.byLineDash} />
            </View>
          </Animated.View>

          {/* ─── White Card ──────────────────────────────────── */}
          <Animated.View style={[styles.card, cardStyle]}>

            {/* ── Step: Options ──────────────────────────────── */}
            {step === "options" && (
              <>
                <Text style={styles.cardTitle}>Welcome!</Text>
                <Text style={styles.cardSubtitle}>
                  Sign in with your phone number to book appointments and discover services.
                </Text>
                {/* Primary: Phone Number */}
                <OAuthButton
                  label="Continue with Phone Number"
                  icon={<Text style={{ fontSize: 18 }}>📱</Text>}
                  bgColor="#1A3A28"
                  textColor="#FFFFFF"
                  disabled={oauthLoading !== null}
                  delay={500}
                  onPress={() => setStep("phone")}
                />
                {/* Divider */}
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or continue with</Text>
                  <View style={styles.dividerLine} />
                </View>
                {/* Social options */}
                <View style={styles.buttons}>
                  <OAuthButton
                    label="Continue with Apple"
                    icon={<AppleLogo size={20} color="#FFFFFF" />}
                    bgColor="#000000"
                    textColor="#FFFFFF"
                    loading={oauthLoading === "apple"}
                    disabled={oauthLoading !== null}
                    delay={600}
                    onPress={() => handleOAuth("apple")}
                  />
                  <OAuthButton
                    label="Continue with Google"
                    icon={<GoogleLogo size={20} />}
                    bgColor="#FFFFFF"
                    textColor="#111827"
                    borderColor="#E5E7EB"
                    loading={oauthLoading === "google"}
                    disabled={oauthLoading !== null}
                    delay={700}
                    onPress={() => handleOAuth("google")}
                  />
                  <OAuthButton
                    label="Continue with Microsoft"
                    icon={<MicrosoftLogo size={20} />}
                    bgColor="#FFFFFF"
                    textColor="#111827"
                    borderColor="#E5E7EB"
                    loading={oauthLoading === "microsoft"}
                    disabled={oauthLoading !== null}
                    delay={800}
                    onPress={() => handleOAuth("microsoft")}
                  />
                </View>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>
                <Pressable
                  onPress={() => router.replace("/(client-tabs)" as any)}
                  style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={styles.skipText}>Browse without signing in</Text>
                </Pressable>
                <Text style={styles.terms}>
                  By continuing you agree to our Terms of Service and Privacy Policy.
                </Text>
              </>
            )}

            {/* ── Step: Phone Number ──────────────────────────── */}
            {step === "phone" && (
              <>
                <View style={styles.stepBackRow}>
                  <Pressable
                    onPress={() => setStep("options")}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4, marginRight: 4 })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={styles.stepBackChevron}>‹</Text>
                  </Pressable>
                  <Text style={styles.stepBackLabel}>Back</Text>
                </View>
                <Text style={styles.stepTitle}>Your Phone Number</Text>
                <Text style={styles.stepSubtitle}>
                  Enter your phone number to sign in or create an account.
                </Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <View style={styles.phoneRow}>
                    <CountryCodePicker
                      selected={selectedCountry}
                      onSelect={setSelectedCountry}
                      backgroundColor="#F9FAFB"
                      textColor="#111827"
                      borderColor="#E5E7EB"
                    />
                    <TextInput
                      style={[
                        styles.input,
                        styles.phoneInput,
                        inputFocused && styles.inputFocused,
                        phoneError ? styles.inputError : undefined,
                      ]}
                      placeholder={selectedCountry.dial === "+1" ? "(000) 000-0000" : "Phone number"}
                      placeholderTextColor="#9CA3AF"
                      value={phone}
                      onChangeText={handlePhoneChange}
                      keyboardType="phone-pad"
                      returnKeyType="done"
                      onSubmitEditing={handlePhoneNext}
                      maxLength={selectedCountry.dial === "+1" ? 14 : 15}
                      editable={!phoneLoading}
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setInputFocused(false)}
                      autoFocus={false}
                    />
                  </View>
                  {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
                </View>
                <Pressable
                  onPress={handlePhoneNext}
                  disabled={!isPhoneReady || phoneLoading}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: isPhoneReady && !phoneLoading ? "#4A7C59" : "#9CA3AF", opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  {phoneLoading
                    ? <ActivityIndicator color="#FFF" size="small" />
                    : <Text style={styles.primaryBtnText}>Continue</Text>}
                </Pressable>
              </>
            )}

            {/* OTP step removed — phone signs in directly */}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    minHeight: height, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48,
  },
  wave1: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: height * 0.38,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderTopLeftRadius: width * 0.5, borderTopRightRadius: width * 0.5,
  },
  wave2: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: height * 0.28,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderTopLeftRadius: width * 0.6, borderTopRightRadius: width * 0.6,
  },
  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 16, alignSelf: "flex-start",
  },
  backText: { fontSize: 16, color: "rgba(255,255,255,0.8)", fontWeight: "500" },
  logoWrap: { alignItems: "center", marginBottom: 12, marginTop: 8 },
  logoRing: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.25)",
  },
  logo: { width: 72, height: 72, borderRadius: 20 },
  titleWrap: { alignItems: "center", marginBottom: 24 },
  appName: {
    fontSize: 28, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5, marginBottom: 4,
  },
  appTagline: { fontSize: 14, color: "rgba(255,255,255,0.65)", letterSpacing: 0.2, marginBottom: 10 },
  byLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  byLineDash: { width: 24, height: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  byLineText: {
    fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: 1.5, textTransform: "uppercase",
  },
  card: {
    backgroundColor: "#FFFFFF", borderRadius: 24, padding: 24,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 10,
  },
  cardTitle: {
    fontSize: 24, fontWeight: "800", color: "#111827", marginBottom: 8, letterSpacing: -0.3,
  },
  cardSubtitle: { fontSize: 14, color: "#6B7280", lineHeight: 20, marginBottom: 24 },
  buttons: { gap: 10 },
  oauthWrap: { borderRadius: 14, overflow: "hidden" },
  oauthBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 14,
  },
  oauthBtnText: { fontSize: 15, fontWeight: "600" },
  dividerRow: {
    flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  dividerText: { fontSize: 13, color: "#9CA3AF", fontWeight: "500" },
  skipBtn: {
    alignItems: "center", paddingVertical: 12, borderRadius: 12,
    backgroundColor: "#F3F4F6", marginBottom: 16,
  },
  skipText: { fontSize: 14, color: "#4A7C59", fontWeight: "600" },
  terms: { fontSize: 11, color: "#9CA3AF", textAlign: "center", lineHeight: 16, marginTop: 4 },
  // Phone step
  stepBackRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  stepBackChevron: { fontSize: 22, color: "#4A7C59", fontWeight: "600" },
  stepBackLabel: { fontSize: 13, color: "#4A7C59", fontWeight: "600" },
  stepTitle: { fontSize: 22, fontWeight: "800", color: "#111827", marginBottom: 6, letterSpacing: -0.3 },
  stepSubtitle: { fontSize: 14, color: "#6B7280", lineHeight: 20, marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: {
    fontSize: 11, fontWeight: "700", color: "#6B7280",
    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8,
  },
  phoneRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1, height: 52, borderWidth: 1.5, borderColor: "#E5E7EB",
    borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: "#111827", backgroundColor: "#F9FAFB",
  },
  phoneInput: { flex: 1 },
  inputFocused: { borderColor: "#4A7C59", backgroundColor: "#F0FFF4" },
  inputError: { borderColor: "#EF4444" },
  errorText: { fontSize: 12, color: "#EF4444", marginTop: 6 },
  primaryBtn: {
    height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  secondaryBtn: {
    height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: "#F3F4F6", paddingHorizontal: 20, marginTop: 4,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  buttonRow: { flexDirection: "row", gap: 10 },
  // OTP
  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 12 },
  otpBox: {
    flex: 1, height: 56, borderRadius: 14, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  otpInput: {
    width: "100%", height: "100%", textAlign: "center",
    fontSize: 22, fontWeight: "700", color: "#111827",
  },
  otpErrorWrap: {
    backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginBottom: 8,
  },
  otpErrorText: { fontSize: 13, color: "#EF4444", textAlign: "center" },
});
