import {
  Text,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  formatPhoneNumber,
  stripPhoneFormat,
  DEFAULT_WORKING_HOURS,
  DEFAULT_CANCELLATION_POLICY,
} from "@/lib/types";
import {
  generateId,
  dbServiceToLocal,
  dbClientToLocal,
  dbAppointmentToLocal,
  dbReviewToLocal,
  dbDiscountToLocal,
  dbGiftCardToLocal,
  dbPromoCodeToLocal,
  dbLocationToLocal,
  dbProductToLocal,
  dbStaffToLocal,
  dbCustomScheduleToLocal,
  dbOwnerToSettings,
} from "@/lib/store";
import { trpc } from "@/lib/trpc";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppLockContext } from "@/lib/app-lock-provider";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { CountryCodePicker, DEFAULT_COUNTRY, COUNTRIES, type Country } from "@/components/country-code-picker";
import * as Location from "expo-location";
import { PlanCarousel } from "@/components/plan-carousel";
import { startOAuthLogin } from "@/constants/oauth";
import { GoogleLogo, MicrosoftLogo, AppleLogo } from "@/components/brand-icons";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import { getApiBaseUrl } from "@/constants/oauth";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Auth from "@/lib/_core/auth";
import { recordBusinessActivity } from "@/hooks/use-app-lock";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Step = 1 | "otp" | 2 | "subscription" | 3 | "socialPhone";

// ─── Swipe Up Hint ────────────────────────────────────────────────
function SwipeUpHint({ visible }: { visible: boolean }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      // Fade in
      opacity.value = withTiming(1, { duration: 350 });
      // Looping upward bounce
      translateY.value = withRepeat(
        withSequence(
          withTiming(-8, { duration: 500, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 500, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = 0;
    }
  }, [visible]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ alignItems: "center", marginTop: 14, gap: 4 }, style]}>
      <Text style={{ fontSize: 15, color: "#4A7C59" }}>↑</Text>
      <Text style={{ fontSize: 11, color: "#4A7C59", fontWeight: "600", letterSpacing: 0.4 }}>
        Tap Continue to proceed
      </Text>
    </Animated.View>
  );
}

// ─── Floating Particle ─────────────────────────────────────────────
function FloatingParticle({
  x,
  y,
  size,
  delay,
  duration,
  opacity: baseOpacity,
}: {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(baseOpacity, { duration: 800 }));
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-18, { duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    position: "absolute",
    left: x,
    top: y,
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: "rgba(255,255,255,0.6)",
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={style} />;
}

// ─── Clock Icon SVG-like (drawn with Views) ─────────────────────────
function ClockIcon({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Hour hand */}
      <View
        style={{
          position: "absolute",
          width: 2,
          height: size * 0.25,
          backgroundColor: color,
          bottom: "50%",
          left: "50%",
          marginLeft: -1,
          borderRadius: 1,
          transformOrigin: "bottom",
          transform: [{ rotate: "-30deg" }],
        }}
      />
      {/* Minute hand */}
      <View
        style={{
          position: "absolute",
          width: 2,
          height: size * 0.32,
          backgroundColor: color,
          bottom: "50%",
          left: "50%",
          marginLeft: -1,
          borderRadius: 1,
          transformOrigin: "bottom",
          transform: [{ rotate: "60deg" }],
        }}
      />
      {/* Center dot */}
      <View
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// ─── Animated Progress Dots ────────────────────────────────────────────────
function ProgressDots({ step }: { step: Step }) {
  const stepToNum = (st: Step): number => {
    if (st === 1 || st === "otp" || st === "socialPhone") return 1;
    if (st === 2) return 2;
    if (st === "subscription") return 3;
    return 4;
  };
  const numericStep = stepToNum(step);

  // One shared value per dot for width
  const w1 = useSharedValue(numericStep === 1 ? 24 : 8);
  const w2 = useSharedValue(numericStep === 2 ? 24 : 8);
  const w3 = useSharedValue(numericStep === 3 ? 24 : 8);
  const w4 = useSharedValue(numericStep === 4 ? 24 : 8);
  const widths = [w1, w2, w3, w4];

  useEffect(() => {
    widths.forEach((w, i) => {
      w.value = withTiming(i + 1 === numericStep ? 24 : 8, { duration: 250, easing: Easing.out(Easing.cubic) });
    });
  }, [numericStep]);

  const s1 = useAnimatedStyle(() => ({ width: w1.value }));
  const s2 = useAnimatedStyle(() => ({ width: w2.value }));
  const s3 = useAnimatedStyle(() => ({ width: w3.value }));
  const s4 = useAnimatedStyle(() => ({ width: w4.value }));
  const dotStyles = [s1, s2, s3, s4];

  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginBottom: 20 }}>
      {[1, 2, 3, 4].map((s, i) => (
        <Animated.View
          key={s}
          style={[
            { height: 8, borderRadius: 4, backgroundColor: s <= numericStep ? "#8FBF6A" : "rgba(255,255,255,0.25)" },
            dotStyles[i],
          ]}
        />
      ))}
    </View>
  );
}

export default function OnboardingScreen() {
  const { dispatch, syncToDb, state: appState } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, width, height, fs, buttonHeight, iconButtonSize, formMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();

  const socialParams = useLocalSearchParams<{ socialLogin?: string; socialName?: string; socialEmail?: string; ref?: string }>();
  const isSocialFlow = socialParams.socialLogin === "1";
  // Pre-fill referral code from deep link ?ref= param (e.g. from booking page share link)
  const deepLinkRef = socialParams.ref ?? null;
  const [step, setStep] = useState<Step>(isSocialFlow ? "socialPhone" : 1);
  const prevStepRef = useRef<Step>(isSocialFlow ? "socialPhone" : 1);
  const outerScrollRef = useRef<ScrollView>(null);
  const [displayStep, setDisplayStep] = useState<Step>(isSocialFlow ? "socialPhone" : 1);
  // Increment to force PlanCarousel remount (resets inner scroll to top) each time subscription step is shown
  const [planCarouselKey, setPlanCarouselKey] = useState(0);
  // Track whether this user has opened the app before (for smart greeting)
  const [isReturningUser, setIsReturningUser] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem("@lot_has_visited").then((val) => {
      setIsReturningUser(val === "true");
      // Mark as visited for future opens
      AsyncStorage.setItem("@lot_has_visited", "true");
    }).catch(() => setIsReturningUser(false));
  }, []);
  const slideX = useSharedValue(0);
  const slideOpacity = useSharedValue(1);

  // Step order for direction detection
  const STEP_ORDER: Step[] = [1, "socialPhone", "otp", 2, "subscription", 3];
  const stepIndex = (s: Step) => {
    const idx = STEP_ORDER.indexOf(s);
    return idx === -1 ? 0 : idx;
  };

  const navigateToStep = useCallback((nextStep: Step) => {
    const direction = stepIndex(nextStep) >= stepIndex(prevStepRef.current) ? 1 : -1;
    // Use real screen width for a full off-screen slide
    const W = width > 0 ? width : 400;
    const SLIDE_OUT_DURATION = 200;
    const SLIDE_IN_DURATION = 280;

    // Phase 1: slide current card out to the left (forward) or right (back)
    slideX.value = withTiming(
      direction * -W,
      { duration: SLIDE_OUT_DURATION, easing: Easing.in(Easing.cubic) },
      () => {
        // Swap content instantly while card is off-screen
        runOnJS(setDisplayStep)(nextStep);
        // Position new card off-screen on the opposite side
        slideX.value = direction * W;
        // Phase 2: slide new card in from the side
        slideX.value = withTiming(0, {
          duration: SLIDE_IN_DURATION,
          easing: Easing.out(Easing.cubic),
        });
      },
    );

    // Opacity: fade out quickly, then fade back in as new content arrives
    slideOpacity.value = withTiming(0, { duration: SLIDE_OUT_DURATION * 0.7 }, () => {
      slideOpacity.value = withTiming(1, { duration: SLIDE_IN_DURATION * 0.8 });
    });

    prevStepRef.current = nextStep;
    setStep(nextStep);

    // ─── Onboarding Analytics: track highest step reached ───────────────────────────
    const STEP_LABELS: Record<string, string> = {
      "1": "Phone Entry",
      socialPhone: "Social Phone",
      otp: "OTP Verification",
      "2": "Business Info",
      subscription: "Plan Selection",
      "3": "Biometric / Complete",
    };
    const nextIdx = STEP_ORDER.indexOf(nextStep);
    AsyncStorage.getItem("onboarding_analytics").then((raw) => {
      const data = raw ? JSON.parse(raw) : { sessions: [] };
      const now = new Date().toISOString();
      // Find or create a session started today
      const todayKey = now.slice(0, 10);
      let session = data.sessions.find((s: any) => s.date === todayKey);
      if (!session) {
        session = { date: todayKey, steps: [], highestIdx: -1, completed: false };
        data.sessions.push(session);
      }
      if (nextIdx > session.highestIdx) {
        session.highestIdx = nextIdx;
        session.highestStep = String(nextStep);
        session.highestStepLabel = STEP_LABELS[String(nextStep)] ?? String(nextStep);
      }
      if (nextStep === 3) session.completed = true;
      // Record each step visit with timestamp
      session.steps.push({ step: String(nextStep), label: STEP_LABELS[String(nextStep)] ?? String(nextStep), at: now });
      // Keep only last 30 days of sessions
      if (data.sessions.length > 30) data.sessions = data.sessions.slice(-30);
      AsyncStorage.setItem("onboarding_analytics", JSON.stringify(data));
    }).catch(() => {});
  }, [width]);
  const { biometricAvailable, biometricType, toggleBiometric } = useAppLockContext();
  const [selectedCountry, setSelectedCountry] = useState<Country>(DEFAULT_COUNTRY);

  // Auto-detect country from GPS on mount (best-effort, silent — never blocks the user)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === "web") return; // geolocation not needed on web
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest, timeoutInterval: 5000 });
        if (cancelled) return;
        const [geo] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        if (cancelled || !geo?.isoCountryCode) return;
        const match = COUNTRIES.find((c) => c.code === geo.isoCountryCode);
        if (match) setSelectedCountry(match);
      } catch (_) {
        // Silent — GPS failure should never block onboarding
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [phone, setPhone] = useState("");
  const [otpValue, setOtpValue] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(["" ,"","","","",""]);
  const otpRefs = useRef<(TextInput | null)[]>([null,null,null,null,null,null]);
  const otpScale0 = useSharedValue(1); const otpScale1 = useSharedValue(1); const otpScale2 = useSharedValue(1);
  const otpScale3 = useSharedValue(1); const otpScale4 = useSharedValue(1); const otpScale5 = useSharedValue(1);
  const otpBorder0 = useSharedValue(0); const otpBorder1 = useSharedValue(0); const otpBorder2 = useSharedValue(0);
  const otpBorder3 = useSharedValue(0); const otpBorder4 = useSharedValue(0); const otpBorder5 = useSharedValue(0);
  const otpBoxScales = [otpScale0, otpScale1, otpScale2, otpScale3, otpScale4, otpScale5];
  const otpBoxBorders = [otpBorder0, otpBorder1, otpBorder2, otpBorder3, otpBorder4, otpBorder5];
  // Pre-declare animated styles for each OTP box (can't call hooks inside map)
  const otpBoxStyle0 = useAnimatedStyle(() => ({
    transform: [{ scale: otpBoxScales[0].value }],
    borderColor: otpBorder0.value === 1 ? "#4A7C59" : "#E5E7EB",
    backgroundColor: otpBorder0.value === 1 ? "#F0FFF4" : "#F9FAFB",
  }));
  const otpBoxStyle1 = useAnimatedStyle(() => ({
    transform: [{ scale: otpBoxScales[1].value }],
    borderColor: otpBorder1.value === 1 ? "#4A7C59" : "#E5E7EB",
    backgroundColor: otpBorder1.value === 1 ? "#F0FFF4" : "#F9FAFB",
  }));
  const otpBoxStyle2 = useAnimatedStyle(() => ({
    transform: [{ scale: otpBoxScales[2].value }],
    borderColor: otpBorder2.value === 1 ? "#4A7C59" : "#E5E7EB",
    backgroundColor: otpBorder2.value === 1 ? "#F0FFF4" : "#F9FAFB",
  }));
  const otpBoxStyle3 = useAnimatedStyle(() => ({
    transform: [{ scale: otpBoxScales[3].value }],
    borderColor: otpBorder3.value === 1 ? "#4A7C59" : "#E5E7EB",
    backgroundColor: otpBorder3.value === 1 ? "#F0FFF4" : "#F9FAFB",
  }));
  const otpBoxStyle4 = useAnimatedStyle(() => ({
    transform: [{ scale: otpBoxScales[4].value }],
    borderColor: otpBorder4.value === 1 ? "#4A7C59" : "#E5E7EB",
    backgroundColor: otpBorder4.value === 1 ? "#F0FFF4" : "#F9FAFB",
  }));
  const otpBoxStyle5 = useAnimatedStyle(() => ({
    transform: [{ scale: otpBoxScales[5].value }],
    borderColor: otpBorder5.value === 1 ? "#4A7C59" : "#E5E7EB",
    backgroundColor: otpBorder5.value === 1 ? "#F0FFF4" : "#F9FAFB",
  }));
  const otpBoxAnimStyles = [otpBoxStyle0, otpBoxStyle1, otpBoxStyle2, otpBoxStyle3, otpBoxStyle4, otpBoxStyle5];
  const [otpError, setOtpError] = useState("");
  const [otpCountdown, setOtpCountdown] = useState(0); // seconds remaining before resend is allowed
  const [otpResendLoading, setOtpResendLoading] = useState(false);
  // Pending action after OTP: "existing" = login, "new" = go to step 2
  const [pendingOtpAction, setPendingOtpAction] = useState<"existing" | "new">("new");
  const [pendingExistingId, setPendingExistingId] = useState<number | null>(null);
  const [pendingFullData, setPendingFullData] = useState<any>(null);
  const STATIC_OTP = "123456";

  // ─── 6-box OTP helpers ───────────────────────────────────────────
  const handleOtpDigitChange = (index: number, value: string) => {
    // Handle paste / SMS autofill of full 6-digit code
    const digits = value.replace(/[^0-9]/g, "");
    if (digits.length > 1) {
      const filled = digits.slice(0, 6).split("");
      const newDigits = [...otpDigits];
      for (let j = 0; j < 6; j++) newDigits[j] = filled[j] ?? "";
      setOtpDigits(newDigits);
      const combined = newDigits.join("");
      setOtpValue(combined);
      setOtpError("");
      // Animate all filled boxes
      filled.forEach((d, j) => {
        if (d) {
          otpBoxScales[j].value = withSequence(withTiming(1.12, { duration: 60 }), withSpring(1, { damping: 12, stiffness: 200 }));
          otpBoxBorders[j].value = withTiming(1, { duration: 120 });
        }
      });
      // Focus last filled box
      const lastIdx = Math.min(filled.length - 1, 5);
      setTimeout(() => otpRefs.current[lastIdx]?.focus(), 30);
      // Auto-verify if all 6 filled
      if (combined.length === 6) {
        setTimeout(() => handleBtnPress(() => handleOtpVerifyWithCode(combined)), 150);
      }
      return;
    }
    const digit = digits.slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);
    const combined = newDigits.join("");
    setOtpValue(combined);
    setOtpError("");
    // Animate box
    if (digit) {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      otpBoxScales[index].value = withSequence(
        withTiming(1.12, { duration: 80 }),
        withSpring(1, { damping: 12, stiffness: 200 }),
      );
      otpBoxBorders[index].value = withTiming(1, { duration: 150 });
      // Move to next box
      if (index < 5) {
        setTimeout(() => otpRefs.current[index + 1]?.focus(), 30);
      } else {
        // All 6 filled — auto-verify
        setTimeout(() => handleBtnPress(() => handleOtpVerifyWithCode(combined)), 80);
      }
    } else {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      otpBoxBorders[index].value = withTiming(0, { duration: 150 });
    }
  };

  const handleOtpKeyPress = (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === "Backspace" && !otpDigits[index] && index > 0) {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const newDigits = [...otpDigits];
      newDigits[index - 1] = "";
      setOtpDigits(newDigits);
      setOtpValue(newDigits.join(""));
      otpBoxBorders[index - 1].value = withTiming(0, { duration: 150 });
      setTimeout(() => otpRefs.current[index - 1]?.focus(), 10);
    }
  };

  const handleOtpVerifyWithCode = async (code: string) => {
    if (code.length < 6) return;
    setLoading(true);
    try {
      const stripped = stripPhoneFormat(phone);
      const rawPhone = selectedCountry.dial === "+1" ? stripped : `${selectedCountry.dial.replace("+", "")}${stripped}`;
      const result = await verifyOtpMut.mutateAsync({ phone: rawPhone, code: code.trim() });
      // Store session token for native API calls (avoids "Invalid session cookie" error)
      if (result.success && result.sessionToken) {
        try { await Auth.setSessionToken(result.sessionToken); } catch {}
      }
      if (!result.success) {
        setOtpError(result.error ?? "Incorrect code. Please try again.");
        // Shake all boxes
        otpBoxScales.forEach((s, i) => {
          s.value = withDelay(i * 30, withSequence(
            withTiming(0.92, { duration: 60 }),
            withTiming(1.04, { duration: 60 }),
            withTiming(1, { duration: 60 }),
          ));
        });
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    } catch (err: any) {
      const errMsg = err?.message || err?.data?.message || "Verification failed. Please try again.";
      setOtpError(errMsg);
      // Shake all boxes on error
      otpBoxScales.forEach((s, i) => {
        s.value = withDelay(i * 30, withSequence(
          withTiming(0.92, { duration: 60 }),
          withTiming(1.04, { duration: 60 }),
          withTiming(1, { duration: 60 }),
        ));
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    } finally {
      setLoading(false);
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (pendingOtpAction === "existing" && pendingExistingId !== null) {
      setLoading(true);
      try {
        dispatch({ type: "SET_BUSINESS_OWNER_ID", payload: pendingExistingId });
        await AsyncStorage.setItem("@bookease_business_owner_id", String(pendingExistingId));
        await recordBusinessActivity(); // start 24h re-auth timer from this login
        // Store business name separately so client portal can show it in Switch confirmation
        if (pendingFullData?.owner?.businessName) {
          await AsyncStorage.setItem("@bookease_business_name", pendingFullData.owner.businessName);
        }
        if (pendingFullData && pendingFullData.owner) {
          const settingsFromDb = dbOwnerToSettings(pendingFullData.owner);
          dispatch({
            type: "LOAD_DATA",
            payload: {
              services: (pendingFullData.services || []).map(dbServiceToLocal),
              clients: (pendingFullData.clients || []).map(dbClientToLocal),
              appointments: (pendingFullData.appointments || []).map(dbAppointmentToLocal),
              reviews: (pendingFullData.reviews || []).map(dbReviewToLocal),
              discounts: (pendingFullData.discounts || []).map(dbDiscountToLocal),
              giftCards: (pendingFullData.giftCards || []).map(dbGiftCardToLocal),
              promoCodes: (pendingFullData.promoCodes || []).map(dbPromoCodeToLocal),
              locations: (pendingFullData.locations || []).map(dbLocationToLocal),
              products: (pendingFullData.products || []).map(dbProductToLocal),
              staff: (pendingFullData.staff || []).map(dbStaffToLocal),
              customSchedule: (pendingFullData.customSchedule || []).map(dbCustomScheduleToLocal),
              settings: settingsFromDb as any,
              businessOwnerId: pendingExistingId,
            },
          });
        }
        if (biometricAvailable && Platform.OS !== "web") {
          navigateToStep(3);
        } else {
          router.replace("/(tabs)");
        }
      } finally {
        setLoading(false);
      }
    } else {
      setBusinessPhone(phone);
      navigateToStep(2);
    }
  };
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [onboardingErrors, setOnboardingErrors] = useState<{ businessName?: string; businessPhone?: string }>({});
  const [logoUri, setLogoUri] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const updateBusinessMut = trpc.business.update.useMutation();
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
  const [inputFocused, setInputFocused] = useState(false);

  const trpcUtils = trpc.useUtils();
  const createBusinessMut = trpc.business.create.useMutation();

  // ─── Subscription step state ─────────────────────────────────────
  const [subIsYearly, setSubIsYearly] = useState(false);
  const [subPrefilledRef, setSubPrefilledRef] = useState<string | null>(null);
  // On mount: check AsyncStorage for a stored ref code (set by booking page web-to-app redirect)
  useEffect(() => {
    if (deepLinkRef) {
      setSubPrefilledRef(deepLinkRef);
      AsyncStorage.setItem("@lot_pending_ref", deepLinkRef).catch(() => {});
    } else {
      AsyncStorage.getItem("@lot_pending_ref").then((val) => {
        if (val) setSubPrefilledRef(val);
      }).catch(() => {});
    }
  }, [deepLinkRef]);
  const [subLoading, setSubLoading] = useState(false);
  const [subSelectedPlan, setSubSelectedPlan] = useState<string | null>(null);
  const { data: publicPlans, isLoading: plansLoading } = trpc.subscription.getPublicPlans.useQuery(undefined, { staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: true });
  const sendOtpMut = trpc.otp.send.useMutation();
  const verifyOtpMut = trpc.otp.verify.useMutation();

  // ─── Entrance animations ─────────────────────────────────────────
  const logoScale = useSharedValue(0.6);
  const logoOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const subtitleTranslateY = useSharedValue(20);
  const inputOpacity = useSharedValue(0);
  const inputTranslateY = useSharedValue(20);
  const btnScale = useSharedValue(1);
  const btnOpacity = useSharedValue(0);
  const gradientShift = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const taglineTranslateY = useSharedValue(12);
  const byLineOpacity = useSharedValue(0);
  const byLineTranslateY = useSharedValue(8);
  const appNameOpacity = useSharedValue(0);
  const appNameTranslateY = useSharedValue(16);

  useEffect(() => {
    // Staggered entrance
    logoScale.value = withDelay(100, withSpring(1, { damping: 14, stiffness: 120 }));
    logoOpacity.value = withDelay(100, withTiming(1, { duration: 500 }));
    appNameOpacity.value = withDelay(220, withTiming(1, { duration: 380 }));
    appNameTranslateY.value = withDelay(220, withTiming(0, { duration: 360, easing: Easing.out(Easing.quad) }));
    titleOpacity.value = withDelay(300, withTiming(1, { duration: 400 }));
    titleTranslateY.value = withDelay(300, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
    subtitleOpacity.value = withDelay(450, withTiming(1, { duration: 400 }));
    subtitleTranslateY.value = withDelay(450, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
    taglineOpacity.value = withDelay(520, withTiming(1, { duration: 450 }));
    taglineTranslateY.value = withDelay(520, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
    byLineOpacity.value = withDelay(680, withTiming(1, { duration: 450 }));
    byLineTranslateY.value = withDelay(680, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
    inputOpacity.value = withDelay(600, withTiming(1, { duration: 400 }));
    inputTranslateY.value = withDelay(600, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
    btnOpacity.value = withDelay(750, withTiming(1, { duration: 400 }));
    // Slow gradient animation
    gradientShift.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, []);

  // Re-animate on displayStep change
  useEffect(() => {
    titleOpacity.value = 0;
    titleTranslateY.value = 16;
    subtitleOpacity.value = 0;
    subtitleTranslateY.value = 16;
    inputOpacity.value = 0;
    inputTranslateY.value = 16;
    btnOpacity.value = 0;

    titleOpacity.value = withDelay(60, withTiming(1, { duration: 300 }));
    titleTranslateY.value = withDelay(60, withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) }));
    subtitleOpacity.value = withDelay(140, withTiming(1, { duration: 300 }));
    subtitleTranslateY.value = withDelay(140, withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) }));
    inputOpacity.value = withDelay(220, withTiming(1, { duration: 300 }));
    inputTranslateY.value = withDelay(220, withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) }));
    btnOpacity.value = withDelay(320, withTiming(1, { duration: 300 }));
  }, [displayStep]);

  // Reset OTP boxes when entering/leaving OTP step
  useEffect(() => {
    if (displayStep === "otp") {
      setOtpDigits(["","","","","",""]);
      setOtpValue("");
      setOtpError("");
      otpBoxScales.forEach(s => { s.value = 1; });
      otpBoxBorders.forEach(b => { b.value = 0; });
      // Auto-focus removed — user taps to start entering OTP
    }
    if (displayStep === "subscription") {
      // Force PlanCarousel to remount so its inner scroll resets to top (Solo plan visible first)
      setPlanCarouselKey(k => k + 1);
      // Also reset the outer onboarding ScrollView to top so Solo plan is the first visible card
      setTimeout(() => outerScrollRef.current?.scrollTo({ y: 0, animated: false }), 50);
    }
  }, [displayStep]);

  // OTP countdown timer — counts down from 30 when OTP step is shown
  useEffect(() => {
    if (displayStep !== "otp") return;
    setOtpCountdown(30);
    const id = setInterval(() => {
      setOtpCountdown((prev) => {
        if (prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [displayStep]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }));
  const appNameStyle = useAnimatedStyle(() => ({
    opacity: appNameOpacity.value,
    transform: [{ translateY: appNameTranslateY.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: taglineTranslateY.value }],
  }));
  const byLineStyle = useAnimatedStyle(() => ({
    opacity: byLineOpacity.value,
    transform: [{ translateY: byLineTranslateY.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleTranslateY.value }],
  }));
  const inputStyle = useAnimatedStyle(() => ({
    opacity: inputOpacity.value,
    transform: [{ translateY: inputTranslateY.value }],
  }));
  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
    transform: [{ scale: btnScale.value }],
  }));

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideX.value }],
    opacity: slideOpacity.value,
  }));

  // ─── Back navigation helper ───────────────────────────────────────
  const handleGoBack = useCallback(() => {
    const backMap: Partial<Record<Step, Step>> = {
      otp: 1,
      socialPhone: 1,
      2: 1,
      subscription: 2,
    };
    const target = backMap[displayStep];
    if (!target || loading) return;
    // Going back to step 1 (phone entry) — clear phone + OTP state
    // and reset the typing flag so auto-advance doesn't fire on the pre-filled value
    if (target === 1) {
      setPhone("");
      setOtpValue("");
      setOtpError("");
      setOtpDigits(["","","","","",""]);
      userIsTypingPhoneRef.current = false;
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigateToStep(target);
  }, [displayStep, loading, navigateToStep]);

  // ─── Swipe-right pan gesture (back navigation) ────────────────────
  const swipeGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-20, 20])   // only activate when horizontal movement dominates
    .failOffsetY([-12, 12])     // fail (pass to ScrollView) if vertical movement comes first
    .onEnd((e) => {
      // Only trigger if swiping right with enough velocity or distance
      const canGoBack = displayStep === "otp" || displayStep === "socialPhone" || displayStep === 2;
      if (!canGoBack) return;
      if (e.translationX > 60 && Math.abs(e.translationY) < 80) {
        handleGoBack();
      }
    });

  // ─── Auto-advance when phone is fully entered ──────────────────────
  // Only fires when the user is actively typing — NOT when navigating back
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIsTypingPhoneRef = useRef(false);

  useEffect(() => {
    // Only auto-advance if the user actively typed (not a back-navigation)
    if (displayStep !== 1 || loading || !userIsTypingPhoneRef.current) return;
    const stripped = stripPhoneFormat(phone);
    const isUS = selectedCountry.dial === "+1";
    const targetLen = isUS ? 10 : 8; // US: 10 digits, international: ≥8 digits
    const isComplete = isUS ? stripped.length === targetLen : stripped.length >= targetLen;
    if (isComplete) {
      // Small delay so the user sees the last digit before advancing
      autoAdvanceRef.current = setTimeout(() => {
        handleBtnPress(handlePhoneNext);
      }, 400);
    } else {
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
    }
    return () => {
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, [phone, displayStep, selectedCountry, loading]);

  const handlePhoneChange = (text: string) => {
    userIsTypingPhoneRef.current = true; // Mark that user is actively typing
    setPhone(formatPhoneNumber(text));
  };

  const handleBusinessPhoneChange = (text: string) => {
    setBusinessPhone(formatPhoneNumber(text));
  };

  const handleBtnPress = (cb: () => void) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    btnScale.value = withSequence(
      withTiming(0.96, { duration: 80 }),
      withSpring(1, { damping: 12, stiffness: 200 }),
    );
    cb();
  };

  const handlePhoneNext = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    try {
      // For non-US numbers, prepend the dial code; for US (+1) keep existing 10-digit format
      const stripped = stripPhoneFormat(phone);
      const rawPhone = selectedCountry.dial === "+1" ? stripped : `${selectedCountry.dial.replace("+", "")}${stripped}`;
      const existing = await trpcUtils.business.checkByPhone.fetch({ phone: rawPhone });
      if (existing) {
        // Existing user — fetch full data, then show OTP before logging in
        const fullData = await trpcUtils.business.getFullData.fetch({ id: existing.id });
        setPendingExistingId(existing.id);
        setPendingFullData(fullData);
        setPendingOtpAction("existing");
        setOtpValue("");
        setOtpError("");
        // Send OTP via server (Twilio or test mode 123456)
        sendOtpMut.mutate({ phone: rawPhone }, {
          onError: (err: any) => {
            setOtpError(err?.message || "Failed to send OTP. Please check your connection and try again.");
          },
        });
        navigateToStep("otp");
        return;
      }
    } catch (err) {
      console.error("[Onboarding] Phone check failed:", err);
      // If the API is unreachable, show error instead of silently going to step 2
      const isNetworkError =
        err instanceof Error &&
        (err.message.includes("Network") ||
          err.message.includes("fetch") ||
          err.message.includes("connect") ||
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("Failed to fetch"));
      if (isNetworkError) {
        Alert.alert(
          "Connection Error",
          "Cannot reach the server. Please check your internet connection and try again.",
          [{ text: "OK" }]
        );
        return;
      }
      // Non-network error (e.g. phone not found) — proceed to registration via OTP
    } finally {
      setLoading(false);
    }
      // New user — show OTP before registration
    setPendingOtpAction("new");
    setOtpValue("");
    setOtpError("");
    // Send OTP via server (Twilio or test mode 123456)
    const stripped2 = stripPhoneFormat(phone);
    const rawPhone2 = selectedCountry.dial === "+1" ? stripped2 : `${selectedCountry.dial.replace("+", "")}${stripped2}`;
    navigateToStep("otp");
    try {
      await sendOtpMut.mutateAsync({ phone: rawPhone2 });
    } catch (otpErr: any) {
      setOtpError(otpErr?.message || "Failed to send OTP. Please check your connection and try again.");
    }
  };

  const handleSocialPhoneNext = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    try {
      const stripped = stripPhoneFormat(phone);
      const rawPhone = selectedCountry.dial === "+1" ? stripped : `${selectedCountry.dial.replace("+", "")}${stripped}`;
      // Check if a business owner already exists with this phone
      const existing = await trpcUtils.business.checkByPhone.fetch({ phone: rawPhone });
      if (existing) {
        // Existing user — require OTP before logging in
        const fullData = await trpcUtils.business.getFullData.fetch({ id: existing.id });
        setPendingExistingId(existing.id);
        setPendingFullData(fullData);
        setPendingOtpAction("existing");
        setOtpValue("");
        setOtpError("");
        sendOtpMut.mutate({ phone: rawPhone }, {
          onError: (err: any) => {
            setOtpError(err?.message || "Failed to send OTP. Please check your connection and try again.");
          },
        });
        navigateToStep("otp");
        return;
      }
      // New user — pre-fill from social data and go to business registration
      if (socialParams.socialEmail) setEmail(socialParams.socialEmail);
      setBusinessPhone(phone);
      navigateToStep(2);
    } catch (err) {
      console.error("[Onboarding] Social phone check failed:", err);
      Alert.alert("Connection Error", "Cannot reach the server. Please check your internet connection and try again.", [{ text: "OK" }]);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpResend = async () => {
    if (otpCountdown > 0 || otpResendLoading) return;
    setOtpResendLoading(true);
    setOtpValue("");
    setOtpError("");
    setOtpDigits(["","","","","",""]);
    try {
      const stripped = stripPhoneFormat(phone);
      const rawPhone = selectedCountry.dial === "+1" ? stripped : `${selectedCountry.dial.replace("+", "")}${stripped}`;
      await sendOtpMut.mutateAsync({ phone: rawPhone });
      setOtpCountdown(60);
      const id = setInterval(() => {
        setOtpCountdown((prev) => {
          if (prev <= 1) { clearInterval(id); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setOtpError(err?.message || "Failed to resend OTP. Please try again.");
    } finally {
      setOtpResendLoading(false);
    }
  };

  // ─── Push notification permission request ──────────────────────
  const requestPushPermission = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      if (existingStatus === "granted") return;
      await Notifications.requestPermissionsAsync();
    } catch (err) {
      // Non-blocking — permission failure should not break onboarding
      console.warn("[Onboarding] Push permission request failed:", err);
    }
  }, []);

  const handleComplete = async () => {
    const newErrors: { businessName?: string; businessPhone?: string } = {};
    if (!businessName.trim()) newErrors.businessName = "Business name is required";
    if (!businessPhone.trim()) newErrors.businessPhone = "Phone number is required";
    if (Object.keys(newErrors).length > 0) {
      setOnboardingErrors(newErrors);
      return;
    }
    setOnboardingErrors({});
    setLoading(true);
    try {
      // Build E.164 phone: strip formatting, then prepend country dial code
      const stripped = stripPhoneFormat(businessPhone.trim() || phone.trim());
      // For US (+1): 10-digit → +14124827733; for other regions: prepend dial code digits
      const e164Phone = selectedCountry.dial === "+1"
        ? `+1${stripped.slice(-10)}`
        : `${selectedCountry.dial}${stripped}`;
      const newOwner = await createBusinessMut.mutateAsync({
        phone: e164Phone,
        businessName: businessName.trim(),
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        description: description.trim() || undefined,
        workingHours: DEFAULT_WORKING_HOURS,
        cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
      });
      dispatch({ type: "SET_BUSINESS_OWNER_ID", payload: newOwner.id });
      await AsyncStorage.setItem("@bookease_business_owner_id", String(newOwner.id));
      await recordBusinessActivity(); // start 24h re-auth timer from first login
      // Store business name separately so client portal can show it in Switch confirmation
      await AsyncStorage.setItem("@bookease_business_name", businessName.trim());
      dispatch({
        type: "UPDATE_SETTINGS",
        payload: {
          businessName: businessName.trim(),
          onboardingComplete: true,
          profile: {
            ownerName: "",
            phone: e164Phone,
            email: email.trim(),
            address: "",
            city: "",
            state: "",
            zipCode: "",
            description: description.trim(),
            website: website.trim(),
          },
        },
      });
      // Upload logo if one was selected during onboarding
      if (logoUri && !logoUri.startsWith("file:///")) {
        // Already uploaded to S3 — update the owner record
        try {
          await updateBusinessMut.mutateAsync({ businessLogoUri: logoUri });
          dispatch({ type: "UPDATE_SETTINGS", payload: { businessLogoUri: logoUri } });
        } catch { /* non-blocking */ }
      }
      // Request push notification permission after successful onboarding
      await requestPushPermission();
      // Always go to subscription step next
      navigateToStep("subscription");
    } catch (err) {
      console.error("[Onboarding] Failed to create business in DB:", err);
      // Show a clear error — do NOT silently proceed to local-only mode
      // because the user's data would be lost on logout/reinstall
      Alert.alert(
        "Connection Error",
        "Could not save your business to the server. Please check your internet connection and try again.\n\nYour data will not be saved until this succeeds.",
        [{ text: "Try Again" }]
      );
    } finally {
      setLoading(false);
    }
  };

  // ─── Subscription step handlers ───────────────────────────────────
  const handleSelectPlan = useCallback(async (planKey: string, period: "monthly" | "yearly") => {
    const businessOwnerId = appState?.businessOwnerId;
    if (!businessOwnerId) {
      // Fallback: skip to next step
      if (biometricAvailable && Platform.OS !== "web") {
        navigateToStep(3);
      } else {
        router.replace("/(tabs)");
      }
      return;
    }
    setSubLoading(true);
    setSubSelectedPlan(planKey);
    try {
      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/stripe/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessOwnerId,
          planKey,
          period,
          successUrl: `${apiBase}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}&boid=${businessOwnerId}`,
          cancelUrl: `${apiBase}/api/stripe/cancel?boid=${businessOwnerId}`,
        }),
      });
      const data = await response.json();
      if (data.url) {
        // Open Stripe Checkout in in-app browser
        await WebBrowser.openBrowserAsync(data.url, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
        // After browser closes, sync subscription status from server
        try {
          await trpcUtils.subscription.getMyPlan.invalidate({ businessOwnerId });
          await trpcUtils.business.getFullData.invalidate({ id: businessOwnerId });
        } catch { /* non-fatal */ }
        // Proceed to next step
        if (biometricAvailable && Platform.OS !== "web") {
          navigateToStep(3);
        } else {
          router.replace("/(tabs)");
        }
      } else if (data.activated || data.free) {
        // Free plan activated immediately
        if (biometricAvailable && Platform.OS !== "web") {
          navigateToStep(3);
        } else {
          router.replace("/(tabs)");
        }
      } else {
        Alert.alert("Error", data.error || "Could not start checkout. Please try again.");
      }
    } catch (err) {
      console.error("[Stripe] Checkout error:", err);
      Alert.alert("Error", "Could not start checkout. Please check your connection.");
    } finally {
      setSubLoading(false);
      setSubSelectedPlan(null);
    }
  }, [appState?.businessOwnerId, biometricAvailable, navigateToStep, router]);

  const handleSkipSubscription = useCallback(() => {
    // Mark onboarding complete so the home guard doesn't redirect back
    dispatch({
      type: "UPDATE_SETTINGS",
      payload: { onboardingComplete: true },
    });
    if (biometricAvailable && Platform.OS !== "web") {
      navigateToStep(3);
    } else {
      router.replace("/(tabs)");
    }
  }, [biometricAvailable, navigateToStep, router, dispatch]);

  const handleEnableFaceId = useCallback(async () => {
    setLoading(true);
    try {
      await toggleBiometric(true);
    } catch (err) {
      console.warn("[Onboarding] Face ID setup failed:", err);
    } finally {
      setLoading(false);
      router.replace("/(tabs)");
    }
  }, [toggleBiometric, router]);

  const handleSkipFaceId = useCallback(() => {
    router.replace("/(tabs)");
  }, [router]);

  // ─── Particles (only on step 1) ─────────────────────────────────
  const particles = [
    { x: width * 0.08, y: height * 0.12, size: 8, delay: 200, duration: 3200, opacity: 0.35 },
    { x: width * 0.82, y: height * 0.08, size: 12, delay: 600, duration: 2800, opacity: 0.25 },
    { x: width * 0.15, y: height * 0.35, size: 6, delay: 1000, duration: 3600, opacity: 0.3 },
    { x: width * 0.75, y: height * 0.28, size: 10, delay: 400, duration: 3000, opacity: 0.2 },
    { x: width * 0.55, y: height * 0.06, size: 7, delay: 800, duration: 2600, opacity: 0.3 },
    { x: width * 0.9, y: height * 0.42, size: 9, delay: 300, duration: 3400, opacity: 0.2 },
  ];

  return (
    <View style={{ flex: 1 }}>
      {/* ─── Animated Gradient Background ─────────────────────── */}
      <LinearGradient
        colors={["#1A3A28", "#2D5A3D", "#4A7C59", "#3D6B4A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* ─── Floating Particles ──────────────────────────────────── */}
      {displayStep === 1 && particles.map((p, i) => (
        <FloatingParticle key={i} {...p} />
      ))}
      {/* ─── Bottom Wave Decoration (hidden on subscription step) ──────────────────────────────────── */}
      {displayStep !== "subscription" && (
        <>
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: height * 0.38,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderTopLeftRadius: width * 0.5,
              borderTopRightRadius: width * 0.5,
            }}
          />
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: height * 0.28,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderTopLeftRadius: width * 0.6,
              borderTopRightRadius: width * 0.6,
            }}
          />
        </>
      )}

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={outerScrollRef}
          style={displayStep === "subscription" ? { flex: 1 } : undefined}
          contentContainerStyle={displayStep === "subscription" ? {
            flex: 1,
            paddingHorizontal: 0,
            paddingTop: insets.top + 16,
            paddingBottom: 0,
          } : {
            minHeight: height,
            paddingHorizontal: hp,
            paddingTop: 32,
            paddingBottom: 100,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={displayStep !== "subscription"}
        >
          {/* ─── Logo + App Name ─────────────────────────────── */}
          {displayStep !== "subscription" && (<Animated.View style={[styles.logoContainer, logoStyle]}>
            <View style={styles.logoRing}>
              <Image
                source={require("@/assets/images/icon.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Animated.Text style={[styles.appName, appNameStyle]}>Lime Of Time</Animated.Text>
            <Animated.Text style={[styles.appTagline, taglineStyle]}>Smart scheduling for your business</Animated.Text>
            {/* Decorative tagline separator — fades in last */}
            <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }, byLineStyle]}>
              <View style={{ width: 24, height: 1, backgroundColor: "rgba(255,255,255,0.3)" }} />
              <Text style={{ fontSize: fs.xs, color: "rgba(255,255,255,0.45)", letterSpacing: 1.5, textTransform: "uppercase" }}>by Innovancio</Text>
              <View style={{ width: 24, height: 1, backgroundColor: "rgba(255,255,255,0.3)" }} />
            </Animated.View>
          </Animated.View>)}

          {/* ─── Progress Dots ──────────────────────────────────── */}
          {displayStep !== "subscription" && <ProgressDots step={displayStep} />}

          {/* ─── White Card ──────────────────────────────────── */}
          {/* GestureDetector enables swipe-right to go back on applicable steps */}
          <GestureDetector gesture={swipeGesture}>
          {/* Clip container — no overflow:hidden so tall steps (Business Info) can scroll fully */}
          <View style={{ borderRadius: 24, flex: displayStep === "subscription" ? 1 : undefined, maxWidth: formMaxWidth > 0 ? formMaxWidth : undefined, alignSelf: formMaxWidth > 0 ? "center" : undefined, width: "100%" }}>
          <Animated.View style={[displayStep === "subscription" ? styles.cardTransparent : styles.card, slideStyle, { borderRadius: 24 }]}>
            {/* Step 1: Phone */}
            {displayStep === 1 && (
              <>
                <Animated.View style={titleStyle}>
                  <Text style={styles.stepTitle}>{isReturningUser ? "Welcome back!" : "Get started"}</Text>
                  <Text style={styles.stepSubtitle}>
                    {isReturningUser ? "Enter your phone number to continue" : "Enter your phone number to begin"}
                  </Text>
                </Animated.View>

                <Animated.View style={[styles.inputGroup, inputStyle]}>
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
                      ]}
                      placeholder={selectedCountry.dial === "+1" ? "(000) 000-0000" : "Phone number"}
                      placeholderTextColor="#9CA3AF"
                      value={phone}
                      onChangeText={handlePhoneChange}
                      keyboardType="phone-pad"
                      returnKeyType="none"
                      inputAccessoryViewID="suppress"
                      onSubmitEditing={() => handleBtnPress(handlePhoneNext)}
                      maxLength={selectedCountry.dial === "+1" ? 14 : 15}
                      editable={!loading}
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setInputFocused(false)}
                    />
                  </View>
                </Animated.View>

                <Animated.View style={btnStyle}>
                  <Pressable
                    onPress={() => handleBtnPress(handlePhoneNext)}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      {
                        backgroundColor: phone.trim() && !loading ? "#4A7C59" : "#9CA3AF",
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                    disabled={!phone.trim() || loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Continue</Text>
                    )}
                  </Pressable>

                  {/* ─── Swipe Up Hint (only shown when phone is fully entered) ─── */}
                  {!loading && stripPhoneFormat(phone).length === (selectedCountry.dial === "+1" ? 10 : 8) && (
                    <SwipeUpHint visible={true} />
                  )}

                  {/* ─── Back to Portal Selection ─────────────────── */}
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.back();
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      marginTop: 10,
                      borderWidth: 1.5,
                      borderColor: "#D1D5DB",
                      borderRadius: 12,
                      paddingVertical: 13,
                      paddingHorizontal: 20,
                      backgroundColor: pressed ? "#F9FAFB" : "transparent",
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 14, color: "#374151", fontWeight: "600", letterSpacing: 0.2 }}>
                      ← Back to Portal Selection
                    </Text>
                  </Pressable>

                  {/* ─── Social Login Divider ─────────────────── */}
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or continue with</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  {/* ─── Social Login Buttons ─────────────────── */}
                  <View style={styles.socialRow}>
                    <Pressable
                      onPress={() => startOAuthLogin("google")}
                      style={({ pressed }) => [styles.socialBtn, { opacity: pressed ? 0.75 : 1 }]}
                    >
                      <GoogleLogo size={18} />
                      <Text style={styles.socialBtnText}>Google</Text>
                    </Pressable>
                    {Platform.OS === "ios" && (
                      <Pressable
                        onPress={() => startOAuthLogin("apple")}
                        style={({ pressed }) => [styles.socialBtn, { opacity: pressed ? 0.75 : 1 }]}
                      >
                        <AppleLogo size={18} color="#000" />
                        <Text style={styles.socialBtnText}>Apple</Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => startOAuthLogin("microsoft")}
                      style={({ pressed }) => [styles.socialBtn, { opacity: pressed ? 0.75 : 1 }]}
                    >
                      <MicrosoftLogo size={18} />
                      <Text style={styles.socialBtnText}>Microsoft</Text>
                    </Pressable>
                  </View>
                </Animated.View>
              </>
            )}

            {/* Step socialPhone: Phone collection for new social login users */}
            {displayStep === "socialPhone" && (
              <>
                {/* ─── Back Chevron Header ─── */}
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Pressable
                    onPress={handleGoBack}
                    disabled={loading}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.5 : 1,
                      padding: 4,
                      marginRight: 4,
                    })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={{ fontSize: fs.lg, color: "#4A7C59", fontWeight: "600" }}>‹</Text>
                  </Pressable>
                  <Text style={{ fontSize: fs.xs, color: "#4A7C59", fontWeight: "600" }}>Back</Text>
                </View>
                <Animated.View style={titleStyle}>
                  <Text style={styles.stepTitle}>One more step!</Text>
                  <Text style={styles.stepSubtitle}>
                    {socialParams.socialName ? `Welcome, ${socialParams.socialName}! ` : ""}
                    Please enter your phone number to complete setup.
                  </Text>
                </Animated.View>

                <Animated.View style={[styles.inputGroup, inputStyle]}>
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
                      ]}
                      placeholder={selectedCountry.dial === "+1" ? "(000) 000-0000" : "Phone number"}
                      placeholderTextColor="#9CA3AF"
                      value={phone}
                      onChangeText={handlePhoneChange}
                      keyboardType="phone-pad"
                      returnKeyType="none"
                      inputAccessoryViewID="suppress"
                      onSubmitEditing={() => handleBtnPress(handleSocialPhoneNext)}
                      maxLength={selectedCountry.dial === "+1" ? 14 : 15}
                      editable={!loading}
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setInputFocused(false)}
                    />
                  </View>
                </Animated.View>

                <Animated.View style={btnStyle}>
                  <Pressable
                    onPress={() => handleBtnPress(handleSocialPhoneNext)}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      {
                        backgroundColor: phone.trim() && !loading ? "#4A7C59" : "#9CA3AF",
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                    disabled={!phone.trim() || loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Continue</Text>
                    )}
                  </Pressable>
                </Animated.View>
              </>
            )}

            {/* Step OTP: Verification — 6-box animated input */}
            {displayStep === "otp" && (
              <>
                <Animated.View style={[titleStyle, { alignItems: "center" }]}>
                  {/* Lock icon with green glow */}
                  <View style={styles.otpIconWrap}>
                    <Text style={{ fontSize: 34 }}>🔐</Text>
                  </View>
                  <Text style={[styles.stepTitle, { textAlign: "center" }]}>Verify Your Number</Text>
                  <Text style={[styles.stepSubtitle, { textAlign: "center" }]}>
                    Enter the 6-digit code sent to{"\n"}
                    <Text style={{ fontWeight: "700", color: "#111827" }}>{selectedCountry.dial} {phone}</Text>
                  </Text>
                </Animated.View>

                <Animated.View style={[{ width: "100%" }, inputStyle]}>
                  {/* 6 individual OTP boxes */}
                  <View style={styles.otpRow}>
                    {otpDigits.map((digit, i) => (
                      <Animated.View
                        key={i}
                        style={[
                          styles.otpBox,
                          otpBoxAnimStyles[i],
                          otpError ? { borderColor: "#EF4444" } : undefined,
                        ]}
                      >
                        <TextInput
                          ref={ref => { otpRefs.current[i] = ref; }}
                          style={styles.otpInput}
                          value={digit}
                          onChangeText={v => handleOtpDigitChange(i, v)}
                          onKeyPress={e => handleOtpKeyPress(i, e)}
                          keyboardType="number-pad"
                          maxLength={i === 0 ? 6 : 1}
                          editable={!loading}
                          selectTextOnFocus
                          caretHidden
                          textContentType={i === 0 ? "oneTimeCode" : "none"}
                          autoComplete={i === 0 ? "sms-otp" : "off"}
                        />
                      </Animated.View>
                    ))}
                  </View>

                  {/* Error message */}
                  {otpError ? (
                    <View style={styles.otpErrorWrap}>
                      <Text style={styles.otpErrorText}>{otpError}</Text>
                    </View>
                  ) : null}

                  {/* Resend Code */}
                  <View style={{ alignItems: "center", marginTop: 20 }}>
                    {otpCountdown > 0 ? (
                      <Text style={{ fontSize: fs.xs, color: "#6B7280", textAlign: "center" }}>
                        Resend code in{" "}
                        <Text style={{ fontWeight: "700", color: "#4A7C59" }}>{otpCountdown}s</Text>
                      </Text>
                    ) : (
                      <Pressable
                        onPress={handleOtpResend}
                        disabled={otpResendLoading}
                        style={({ pressed }) => ({
                          opacity: pressed || otpResendLoading ? 0.6 : 1,
                          paddingVertical: 8,
                          paddingHorizontal: 16,
                          borderRadius: 8,
                          backgroundColor: "rgba(74,124,89,0.08)",
                        })}
                      >
                        {otpResendLoading ? (
                          <ActivityIndicator size="small" color="#4A7C59" />
                        ) : (
                          <Text style={{ fontSize: fs.sm, color: "#4A7C59", fontWeight: "600" }}>
                            Resend Code
                          </Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                </Animated.View>

                <Animated.View style={btnStyle}>
                  <View style={styles.buttonRow}>
                    <Pressable
                      onPress={() => {
                        setOtpValue(""); setOtpError(""); setOtpDigits(["","","","","",""]);
                        userIsTypingPhoneRef.current = false;
                        if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; }
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigateToStep(1);
                      }}
                      style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
                      disabled={loading}
                    >
                      <Text style={styles.secondaryBtnText}>Back</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleBtnPress(() => handleOtpVerifyWithCode(otpValue))}
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        { flex: 1, backgroundColor: otpValue.length === 6 && !loading ? "#4A7C59" : "#9CA3AF", opacity: pressed ? 0.9 : 1 },
                      ]}
                      disabled={otpValue.length !== 6 || loading}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Verify</Text>
                      )}
                    </Pressable>
                  </View>
                </Animated.View>
              </>
            )}

            {/* Step 2: Business Info */}
            {displayStep === 2 && (
              <>
                {/* ─── Back Chevron Header ─── */}
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Pressable
                    onPress={handleGoBack}
                    disabled={loading}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.5 : 1,
                      padding: 4,
                      marginRight: 4,
                    })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={{ fontSize: fs.lg, color: "#4A7C59", fontWeight: "600" }}>‹</Text>
                  </Pressable>
                  <Text style={{ fontSize: fs.xs, color: "#4A7C59", fontWeight: "600" }}>Back</Text>
                </View>
                <Animated.View style={[titleStyle, { alignItems: "center" }]}>
                  {/* Business icon badge */}
                  <View style={styles.bizIconWrap}>
                    <Text style={{ fontSize: fs.xxl }}>🏢</Text>
                  </View>
                  <Text style={[styles.stepTitle, { textAlign: "center" }]}>Business Information</Text>
                  <Text style={[styles.stepSubtitle, { textAlign: "center" }]}>Setup takes about 2 minutes</Text>
                </Animated.View>

                <Animated.View style={inputStyle}>
                  {/* Quick-setup intro card */}
                  <View style={styles.bizIntroCard}>
                    <View style={styles.bizIntroRow}>
                      <View style={styles.bizIntroDot} />
                      <Text style={styles.bizIntroItem}>Your booking page goes live instantly</Text>
                    </View>
                    <View style={styles.bizIntroRow}>
                      <View style={styles.bizIntroDot} />
                      <Text style={styles.bizIntroItem}>Clients can book 24/7 from any device</Text>
                    </View>
                    <View style={styles.bizIntroRow}>
                      <View style={styles.bizIntroDot} />
                      <Text style={styles.bizIntroItem}>You get notified for every new request</Text>
                    </View>
                  </View>

                  {/* Logo Upload */}
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <Pressable
                      onPress={pickLogo}
                      disabled={uploadingLogo || loading}
                      style={({ pressed }) => ({
                        width: 90,
                        height: 90,
                        borderRadius: 45,
                        backgroundColor: "rgba(74,124,89,0.12)",
                        borderWidth: 2,
                        borderColor: "rgba(74,124,89,0.35)",
                        borderStyle: "dashed",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      {uploadingLogo ? (
                        <ActivityIndicator color="#4A7C59" size="small" />
                      ) : logoUri ? (
                        <Image source={{ uri: logoUri }} style={{ width: 90, height: 90, borderRadius: 45 }} />
                      ) : (
                        <View style={{ alignItems: "center", gap: 4 }}>
                          <Text style={{ fontSize: 28 }}>📷</Text>
                          <Text style={{ fontSize: 10, color: "#4A7C59", fontWeight: "600", textAlign: "center" }}>ADD LOGO</Text>
                        </View>
                      )}
                    </Pressable>
                    {logoUri ? (
                      <Pressable onPress={pickLogo} style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 12, color: "#4A7C59", fontWeight: "600" }}>Change Logo</Text>
                      </Pressable>
                    ) : (
                      <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>Optional — shown on your booking page</Text>
                    )}
                  </View>

                  {/* Required field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>BUSINESS NAME <Text style={{ color: "#EF4444" }}>*</Text></Text>
                    <TextInput
                      style={[
                        styles.input,
                        onboardingErrors.businessName && styles.inputError,
                      ]}
                      placeholder="e.g. Lime Cuts & Style"
                      placeholderTextColor="#9CA3AF"
                      value={businessName}
                      onChangeText={(v) => {
                        setBusinessName(v);
                        if (onboardingErrors.businessName) setOnboardingErrors((e) => ({ ...e, businessName: undefined }));
                      }}
                      returnKeyType="next"
                      editable={!loading}
                    />
                    {onboardingErrors.businessName ? (
                      <Text style={styles.errorText}>{onboardingErrors.businessName}</Text>
                    ) : null}
                  </View>

                  {/* Section divider */}
                  <View style={styles.sectionDivider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.sectionDividerText}>CONTACT</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>PHONE NUMBER <Text style={{ color: '#EF4444' }}>*</Text></Text>
                    <TextInput
                      style={[
                        styles.input,
                        onboardingErrors.businessPhone ? { borderColor: '#EF4444', borderWidth: 1 } : {},
                      ]}
                      placeholder="(000) 000-0000"
                      placeholderTextColor="#9CA3AF"
                      value={businessPhone}
                      onChangeText={(v) => {
                        handleBusinessPhoneChange(v);
                        if (onboardingErrors.businessPhone) setOnboardingErrors((e) => ({ ...e, businessPhone: undefined }));
                      }}
                      keyboardType="phone-pad"
                      returnKeyType="next"
                      maxLength={14}
                      editable={!loading}
                    />
                    {onboardingErrors.businessPhone ? (
                      <Text style={styles.errorText}>{onboardingErrors.businessPhone}</Text>
                    ) : null}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>EMAIL</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="email@business.com"
                      placeholderTextColor="#9CA3AF"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      returnKeyType="next"
                      editable={!loading}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>WEBSITE</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="https://www.yourbusiness.com"
                      placeholderTextColor="#9CA3AF"
                      value={website}
                      onChangeText={setWebsite}
                      autoCapitalize="none"
                      returnKeyType="next"
                      editable={!loading}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>DESCRIPTION</Text>
                    <TextInput
                      style={[styles.input, { minHeight: 80, textAlignVertical: "top", paddingTop: 12 }]}
                      placeholder="Brief description of your business..."
                      placeholderTextColor="#9CA3AF"
                      value={description}
                      onChangeText={setDescription}
                      multiline
                      numberOfLines={3}
                      editable={!loading}
                    />
                  </View>
                 </Animated.View>
                <Animated.View style={btnStyle}>
                  <View style={styles.buttonRow}>
                    <Pressable
                      onPress={() => navigateToStep(1)}
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                      disabled={loading}
                    >
                      <Text style={styles.secondaryBtnText}>Back</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleBtnPress(handleComplete)}
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        {
                          flex: 1,
                          backgroundColor: businessName.trim() && !loading ? "#4A7C59" : "#9CA3AF",
                          opacity: pressed ? 0.9 : 1,
                        },
                      ]}
                      disabled={!businessName.trim() || loading}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Get Started</Text>
                      )}
                    </Pressable>
                  </View>
                </Animated.View>
              </>
            )}

            {/* Step Subscription: Plan Selection */}
            {displayStep === "subscription" && (
              <>
                {/* Carousel — break out of card horizontal padding; header is now inside the card */}
                <Animated.View style={[inputStyle, { marginHorizontal: -hp, flex: 1 }]}>
                  <PlanCarousel
                    key={planCarouselKey}
                    plans={(publicPlans ?? []) as any}
                    isLoading={plansLoading}
                    isYearly={subIsYearly}
                    onToggleBilling={setSubIsYearly}
                    onSelectPlan={(planKey, period) => handleSelectPlan(planKey, period)}
                    loadingPlanKey={subLoading ? subSelectedPlan : null}
                    isOnboarding
                    isTrialEligible={true}
                  />
                </Animated.View>
                <Animated.View style={btnStyle}>
                  <Pressable
                    onPress={handleSkipSubscription}
                    style={({ pressed }) => [styles.subSkipBtn, { opacity: pressed ? 0.5 : 1 }]}
                  >
                    <Text style={styles.subSkipText}>Skip for now</Text>
                  </Pressable>
                </Animated.View>
              </>
            )}

            {/* Step 3: Biometrics */}
            {displayStep === 3 && (
              <>
                <Animated.View style={[titleStyle, { alignItems: "center" }]}>
                  <View style={styles.biometricIcon}>
                    <Text style={{ fontSize: 40 }}>
                      {biometricType === "face" ? "🔐" : "👆"}
                    </Text>
                  </View>
                  <Text style={[styles.stepTitle, { textAlign: "center" }]}>
                    {biometricType === "face" ? "Enable Face ID?" : "Enable Fingerprint?"}
                  </Text>
                  <Text style={[styles.stepSubtitle, { textAlign: "center" }]}>
                    Secure your app with {biometricType === "face" ? "Face ID" : "fingerprint"} authentication.
                  </Text>
                </Animated.View>

                <Animated.View style={btnStyle}>
                  <Pressable
                    onPress={() => handleBtnPress(handleEnableFaceId)}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      {
                        backgroundColor: !loading ? "#4A7C59" : "#9CA3AF",
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>
                        Enable {biometricType === "face" ? "Face ID" : "Fingerprint"}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={handleSkipFaceId}
                    style={({ pressed }) => [
                      styles.skipBtn,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                    disabled={loading}
                  >
                    <Text style={styles.skipBtnText}>Skip for now</Text>
                  </Pressable>
                </Animated.View>
              </>
            )}
          </Animated.View>
          </View>{/* end clip container */}
          </GestureDetector>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  logoContainer: {
    alignItems: "center",
    marginBottom: 24,
    paddingTop: 16,
  },
  logoRing: {
    width: 116,
    height: 116,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 24,
  },
  appName: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    fontFamily: Platform.OS === "ios" ? "Inter_700Bold" : undefined,
  },
  appTagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    marginTop: 3,
    fontFamily: Platform.OS === "ios" ? "Inter_400Regular" : undefined,
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  // Transparent card variant used for the subscription step (full-screen futuristic)
  cardTransparent: {
    backgroundColor: "transparent",
    borderRadius: 0,
    padding: 0,
    shadowOpacity: 0,
    elevation: 0,
    flex: 1,
  },
  // Subscription step header
  subHeader: {
    paddingTop: 4,
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  subTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  subSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.55)",
    marginTop: 3,
    fontWeight: "400",
  },
  subSkipBtn: {
    alignSelf: "center",
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  subSkipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.35)",
    letterSpacing: 0.2,
    fontFamily: Platform.OS === "ios" ? "Inter_600SemiBold" : undefined,
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
    fontFamily: Platform.OS === "ios" ? "Inter_700Bold" : undefined,
  },
  stepSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 24,
    lineHeight: 20,
    fontFamily: Platform.OS === "ios" ? "Inter_400Regular" : undefined,
  },
  inputGroup: {
    marginBottom: 16,
    width: "100%",
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
    marginLeft: 2,
    fontFamily: Platform.OS === "ios" ? "Inter_600SemiBold" : undefined,
  },
  input: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 13,
    lineHeight: 20,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    fontFamily: Platform.OS === "ios" ? "Inter_400Regular" : undefined,
  },
  inputFocused: {
    borderColor: "#4A7C59",
    backgroundColor: "#FFFFFF",
    shadowColor: "#4A7C59",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  phoneInput: {
    flex: 1,
    width: undefined,
  },
  inputError: {
    borderColor: "#EF4444",
  },
  errorText: {
    color: "#EF4444",
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.OS === "ios" ? "Inter_400Regular" : undefined,
  },
  primaryBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 52,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    fontFamily: Platform.OS === "ios" ? "Inter_700Bold" : undefined,
  },
  secondaryBtn: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 52,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    fontFamily: Platform.OS === "ios" ? "Inter_600SemiBold" : undefined,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    width: "100%",
  },
  biometricIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#F0FDF4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  skipBtn: {
    width: "100%",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  skipBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
    fontFamily: Platform.OS === "ios" ? "Inter_600SemiBold" : undefined,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 16,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  dividerText: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  socialRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
  socialBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  socialBtnIcon: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },
  socialBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    fontFamily: Platform.OS === "ios" ? "Inter_600SemiBold" : undefined,
  },
  // Business Info step 2 styles
  bizIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(74,124,89,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 2,
    borderColor: "rgba(74,124,89,0.2)",
  },
  bizIntroCard: {
    backgroundColor: "rgba(74,124,89,0.07)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(74,124,89,0.18)",
    gap: 8,
  },
  bizIntroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bizIntroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4A7C59",
  },
  bizIntroItem: {
    fontSize: 11,
    color: "#374151",
    fontWeight: "500",
    flex: 1,
    lineHeight: 18,
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    marginTop: 4,
  },
  sectionDividerText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1,
  },
  // OTP 6-box styles
  otpIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(74,124,89,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "rgba(74,124,89,0.25)",
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 8,
    marginTop: 8,
  },
  otpBox: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  otpInput: {
    width: 46,
    height: 56,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    padding: 0,
  },
  otpErrorWrap: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
    alignItems: "center",
  },
  otpErrorText: {
    color: "#EF4444",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
});
