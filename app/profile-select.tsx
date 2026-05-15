/**
 * Profile Selection Screen
 * Premium redesign — gradient cards with glass morphism, bold typography,
 * animated entry, and clear visual hierarchy for Business vs Client portals.
 *
 * Layout: ScrollView-based so content never clips on small devices.
 * Transition: branded full-screen overlay fades in when a portal card is tapped.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  StyleSheet,
  Image,
  Platform,
  ScrollView,
  Animated as RNAnimated,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { setProfileMode } from "@/lib/client-store";
import { useStore } from "@/lib/store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { recordBusinessActivity, recordClientActivity, CLIENT_BIOMETRIC_ENABLED_KEY } from "@/hooks/use-app-lock";
import * as LocalAuthentication from "expo-local-authentication";

// ─── Floating Particle ────────────────────────────────────────────────────────
function FloatingParticle({
  x, y, size, delay, duration, opacity: baseOpacity,
}: { x: number; y: number; size: number; delay: number; duration: number; opacity: number }) {
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

const PARTICLES = [
  { x: "8%",  y: "10%", size: 5, delay: 200, duration: 2800, opacity: 0.35 },
  { x: "85%", y: "8%",  size: 4, delay: 600, duration: 3200, opacity: 0.28 },
  { x: "15%", y: "32%", size: 3, delay: 400, duration: 2600, opacity: 0.22 },
  { x: "78%", y: "25%", size: 6, delay: 800, duration: 3600, opacity: 0.3  },
  { x: "50%", y: "6%",  size: 4, delay: 300, duration: 3000, opacity: 0.25 },
  { x: "92%", y: "42%", size: 3, delay: 700, duration: 2900, opacity: 0.2  },
  { x: "5%",  y: "52%", size: 5, delay: 500, duration: 3400, opacity: 0.28 },
  { x: "65%", y: "12%", size: 3, delay: 900, duration: 2700, opacity: 0.22 },
] as const;

// ─── Bouncing Dot ────────────────────────────────────────────────────────────
function BouncingDot({ delay }: { delay: number }) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-10, { duration: 320, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1.3, { duration: 320, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 320, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 }),
          withTiming(0.4, { duration: 320 }),
        ),
        -1,
        false,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.transitionDot, style]} />;
}

// ─── Portal Transition Overlay ────────────────────────────────────────────────
function PortalTransitionOverlay({
  visible,
  colors,
  label,
}: {
  visible: boolean;
  colors: [string, string, string];
  label: string;
}) {
  const opacity = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      RNAnimated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    } else {
      opacity.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <RNAnimated.View style={[StyleSheet.absoluteFillObject, { opacity, zIndex: 9999 }]}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFillObject, styles.transitionOverlay]}
      >
        <View style={styles.transitionContent}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.transitionLogo}
            resizeMode="contain"
          />
          <Text style={styles.transitionLabel}>{label}</Text>
          <View style={styles.transitionDots}>
            <BouncingDot delay={0} />
            <BouncingDot delay={160} />
            <BouncingDot delay={320} />
          </View>
        </View>
      </LinearGradient>
    </RNAnimated.View>
  );
}

// ─── Premium Portal Card ──────────────────────────────────────────────────────
function PortalCard({
  gradientColors,
  icon,
  logoUri,
  badgeLabel,
  title,
  subtitle,
  features,
  ctaLabel,
  onPress,
  delay,
  welcomeBack,
}: {
  gradientColors: [string, string, string];
  accentLight: string;
  icon: string;
  logoUri?: string;
  badgeLabel: string;
  title: string;
  subtitle: string;
  features: string[];
  ctaLabel: string;
  onPress: () => void;
  delay: number;
  welcomeBack?: string | null;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(32);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 450 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 450, easing: Easing.out(Easing.quad) }));
  }, []);

  const tap = Gesture.Tap()
    .onBegin(() => { scale.value = withSpring(0.97, { damping: 18, stiffness: 300 }); })
    .onFinalize((_, success) => {
      scale.value = withSpring(1, { damping: 18, stiffness: 200 });
      if (success) {
        if (Platform.OS !== "web") runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
        runOnJS(onPress)();
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[styles.cardOuter, animStyle]}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          {/* Decorative circles */}
          <View style={[styles.cardCircle1, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
          <View style={[styles.cardCircle2, { backgroundColor: "rgba(255,255,255,0.05)" }]} />

          {/* Top row: icon + badge */}
          <View style={styles.cardTopRow}>
            <View style={[styles.cardIconBox, { backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden", padding: 0 }]}>
              {logoUri ? (
                <Image
                  source={{ uri: logoUri }}
                  style={{ width: 44, height: 44, borderRadius: 10 }}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.cardIconText}>{icon}</Text>
              )}
            </View>
            <View style={[styles.cardBadge, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
              <Text style={styles.cardBadgeText}>{badgeLabel}</Text>
            </View>
          </View>

          {/* Title + subtitle */}
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>

          {/* Feature pills */}
          <View style={styles.featureRow}>
            {features.map((f, i) => (
              <View key={i} style={[styles.featurePill, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
                <Text style={styles.featurePillText}>{f}</Text>
              </View>
            ))}
          </View>

          {/* Divider */}
          <View style={[styles.cardDivider, { backgroundColor: "rgba(255,255,255,0.18)" }]} />

          {/* Welcome-back hint */}
          {welcomeBack ? (
            <View style={styles.welcomeBackRow}>
              <Text style={styles.welcomeBackText}>👋 Welcome back, {welcomeBack}</Text>
            </View>
          ) : null}

          {/* CTA row */}
          <View style={styles.cardCtaRow}>
            <Text style={styles.cardCtaLabel}>{welcomeBack ? "Continue" : ctaLabel}</Text>
            <View style={[styles.cardCtaArrowBox, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
              <Text style={styles.cardCtaArrow}>→</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileSelectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [returnBusinessName, setReturnBusinessName] = useState<string | null>(null);
  const [returnClientName, setReturnClientName] = useState<string | null>(null);
  const [transitionVisible, setTransitionVisible] = useState(false);
  const [transitionConfig, setTransitionConfig] = useState<{
    colors: [string, string, string];
    label: string;
  }>({ colors: ["#1E5C3A", "#2D7A50", "#3A9463"], label: "Business Portal" });

  const { state } = useStore();
  const businessLogoUri = state.settings.businessLogoUri ||
    state.settings.profile?.businessLogoUri ||
    undefined;

  useEffect(() => {
    (async () => {
      try {
        const bOwnerId = await AsyncStorage.getItem("@bookease_business_owner_id");
        const bName = await AsyncStorage.getItem("@bookease_business_name");
        if (bOwnerId && bName) setReturnBusinessName(bName);
      } catch { /* ignore */ }
      try {
        const { getUserInfo } = await import("@/lib/_core/auth");
        const info = await getUserInfo();
        if (info?.name) setReturnClientName(info.name);
      } catch { /* ignore */ }
    })();
  }, []);

  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.8);
  const appNameOpacity = useSharedValue(0);
  const appNameTranslateY = useSharedValue(16);
  const taglineOpacity = useSharedValue(0);
  const taglineTranslateY = useSharedValue(12);
  const byLineOpacity = useSharedValue(0);
  const footerOpacity = useSharedValue(0);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 500 });
    logoScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    appNameOpacity.value = withDelay(220, withTiming(1, { duration: 380 }));
    appNameTranslateY.value = withDelay(220, withTiming(0, { duration: 360, easing: Easing.out(Easing.quad) }));
    taglineOpacity.value = withDelay(380, withTiming(1, { duration: 400 }));
    taglineTranslateY.value = withDelay(380, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));
    byLineOpacity.value = withDelay(520, withTiming(1, { duration: 400 }));
    footerOpacity.value = withDelay(900, withTiming(1, { duration: 400 }));
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const appNameStyle = useAnimatedStyle(() => ({
    opacity: appNameOpacity.value,
    transform: [{ translateY: appNameTranslateY.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: taglineTranslateY.value }],
  }));
  const byLineStyle = useAnimatedStyle(() => ({ opacity: byLineOpacity.value }));
  const footerStyle = useAnimatedStyle(() => ({ opacity: footerOpacity.value }));

  const tryBiometric = async (enabledKey: string, promptLabel: string): Promise<boolean> => {
    if (Platform.OS === "web") return true;
    try {
      const enabled = await AsyncStorage.getItem(enabledKey);
      if (enabled !== "true") return true;
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return true;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: promptLabel,
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });
      return result.success;
    } catch {
      return true;
    }
  };

  const handleSelect = async (mode: "business" | "client") => {
    // Show transition overlay immediately
    if (mode === "business") {
      setTransitionConfig({ colors: ["#1E5C3A", "#2D7A50", "#3A9463"], label: "Business Portal" });
    } else {
      setTransitionConfig({ colors: ["#4C2D8A", "#6B3FAD", "#8B5CF6"], label: "Client Portal" });
    }
    setTransitionVisible(true);

    await setProfileMode(mode);
    if (mode === "business") {
      try {
        const storedOwnerId = await AsyncStorage.getItem("@bookease_business_owner_id");
        if (storedOwnerId) {
          const passed = await tryBiometric(
            "@bookease_biometric_enabled",
            "Unlock Business Portal",
          );
          if (!passed) {
            setTransitionVisible(false);
            return;
          }
          await recordBusinessActivity();
          router.replace("/(tabs)" as any);
          return;
        }
      } catch { /* ignore */ }
      router.push("/onboarding");
    } else {
      try {
        const clientToken = await AsyncStorage.getItem("client_session_token");
        if (clientToken) {
          const passed = await tryBiometric(
            CLIENT_BIOMETRIC_ENABLED_KEY,
            "Unlock Client Portal",
          );
          if (!passed) {
            setTransitionVisible(false);
            return;
          }
        }
      } catch { /* ignore */ }
      await recordClientActivity();
      router.replace("/(client-tabs)/discover" as any);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0F2318", "#1A3A28", "#2D5A3D", "#3D6B4A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Decorative waves — absolute, behind content */}
      <View style={styles.wave1} />
      <View style={styles.wave2} />

      {/* Floating particles — absolute, behind content */}
      {PARTICLES.map((p, i) => (
        <FloatingParticle
          key={i}
          x={parseFloat(p.x) / 100 * 390} // approximate, particles are decorative
          y={parseFloat(p.y) / 100 * 844}
          size={p.size}
          delay={p.delay}
          duration={p.duration}
          opacity={p.opacity}
        />
      ))}

      {/* Scrollable content — fills screen, scrolls if needed */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        {/* ─── Logo + App Name ─── */}
        <View style={styles.logoContainer}>
          <Animated.View style={logoStyle}>
            <View style={styles.logoRing}>
              <Image
                source={require("@/assets/images/icon.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </Animated.View>
          <Animated.Text style={[styles.appName, appNameStyle]}>Lime Of Time</Animated.Text>
          <Animated.Text style={[styles.appTagline, taglineStyle]}>Book Appointments Near You</Animated.Text>
          <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }, byLineStyle]}>
            <View style={{ width: 24, height: 1, backgroundColor: "rgba(255,255,255,0.3)" }} />
            <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: 1.5, textTransform: "uppercase" }}>by Innovancio</Text>
            <View style={{ width: 24, height: 1, backgroundColor: "rgba(255,255,255,0.3)" }} />
          </Animated.View>
        </View>

        {/* ─── Portal Cards ─── */}
        <View style={styles.cardsContainer}>
          <PortalCard
            gradientColors={["#1E5C3A", "#2D7A50", "#3A9463"]}
            accentLight="#7ECFA0"
            icon="🏢"
            logoUri={businessLogoUri}
            badgeLabel="For Businesses"
            title="Business Portal"
            subtitle="Your complete business management hub"
            features={["Appointments", "Clients", "Analytics"]}
            ctaLabel="Get started"
            onPress={() => handleSelect("business")}
            delay={600}
            welcomeBack={returnBusinessName}
          />
          <PortalCard
            gradientColors={["#4C2D8A", "#6B3FAD", "#8B5CF6"]}
            accentLight="#C4B5FD"
            icon="✨"
            badgeLabel="For Customers"
            title="Client Portal"
            subtitle="Discover and book services near you"
            features={["Discover", "Book", "Track"]}
            ctaLabel="Get started"
            onPress={() => handleSelect("client")}
            delay={750}
            welcomeBack={returnClientName}
          />
        </View>

        {/* ─── Footer Note ─── */}
        <Animated.Text style={[styles.footerNote, footerStyle]}>
          You can switch between portals at any time from Settings
        </Animated.Text>
      </ScrollView>

      {/* ─── Portal Transition Overlay ─── */}
      <PortalTransitionOverlay
        visible={transitionVisible}
        colors={transitionConfig.colors}
        label={transitionConfig.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  wave1: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "38%",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderTopLeftRadius: 300,
    borderTopRightRadius: 300,
  },
  wave2: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "28%",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderTopLeftRadius: 400,
    borderTopRightRadius: 400,
  },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 20,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 4,
  },
  logoRing: {
    width: 110,
    height: 110,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    marginBottom: 12,
    shadowColor: "#8FBF6A",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  logo: {
    width: 82,
    height: 82,
    borderRadius: 20,
  },
  appName: {
    fontSize: 32,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
    marginTop: 2,
  },
  appTagline: {
    fontSize: 14,
    color: "rgba(255,255,255,0.65)",
    marginTop: 4,
    letterSpacing: 0.2,
  },
  cardsContainer: {
    width: "100%",
    gap: 14,
  },
  // ─── Premium Card ─────────────────────────────────────────────────────────
  cardOuter: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 14,
  },
  cardGradient: {
    borderRadius: 24,
    padding: 20,
    overflow: "hidden",
  },
  cardCircle1: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  cardCircle2: {
    position: "absolute",
    bottom: -20,
    right: 40,
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  cardIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconText: {
    fontSize: 26,
  },
  cardBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  cardBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.1,
    marginBottom: 5,
  },
  cardSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    lineHeight: 19,
    marginBottom: 14,
  },
  featureRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 16,
  },
  featurePill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
  },
  featurePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.2,
  },
  cardDivider: {
    height: 1,
    marginBottom: 14,
  },
  cardCtaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardCtaLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  cardCtaArrowBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCtaArrow: {
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  footerNote: {
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
    letterSpacing: 0.2,
    marginTop: 4,
  },
  welcomeBackRow: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 10,
    alignSelf: "flex-start",
  },
  welcomeBackText: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.92)",
    letterSpacing: 0.1,
  },
  // ─── Transition Overlay ───────────────────────────────────────────────────
  transitionOverlay: {
    alignItems: "center",
    justifyContent: "center",
  },
  transitionContent: {
    alignItems: "center",
    gap: 16,
  },
  transitionLogo: {
    width: 88,
    height: 88,
    borderRadius: 22,
    shadowColor: "#fff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  transitionLabel: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  transitionDots: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  transitionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
});
