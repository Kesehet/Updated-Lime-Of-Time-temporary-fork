/**
 * Profile Selection Screen
 * Premium redesign — gradient cards with glass morphism, bold typography,
 * animated entry, and clear visual hierarchy for Business vs Client portals.
 */

import React, { useEffect } from "react";
import {
  Text,
  View,
  StyleSheet,
  Image,
  Dimensions,
  Platform,
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
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width, height } = Dimensions.get("window");

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
  { x: width * 0.08, y: height * 0.12, size: 5, delay: 200, duration: 2800, opacity: 0.35 },
  { x: width * 0.85, y: height * 0.09, size: 4, delay: 600, duration: 3200, opacity: 0.28 },
  { x: width * 0.15, y: height * 0.35, size: 3, delay: 400, duration: 2600, opacity: 0.22 },
  { x: width * 0.78, y: height * 0.28, size: 6, delay: 800, duration: 3600, opacity: 0.3 },
  { x: width * 0.5,  y: height * 0.08, size: 4, delay: 300, duration: 3000, opacity: 0.25 },
  { x: width * 0.92, y: height * 0.45, size: 3, delay: 700, duration: 2900, opacity: 0.2 },
  { x: width * 0.05, y: height * 0.55, size: 5, delay: 500, duration: 3400, opacity: 0.28 },
  { x: width * 0.65, y: height * 0.15, size: 3, delay: 900, duration: 2700, opacity: 0.22 },
];

// ─── Premium Portal Card ──────────────────────────────────────────────────────
function PortalCard({
  gradientColors,
  accentLight,
  icon,
  badgeLabel,
  title,
  subtitle,
  features,
  ctaLabel,
  onPress,
  delay,
}: {
  gradientColors: [string, string, string];
  accentLight: string;
  icon: string;
  badgeLabel: string;
  title: string;
  subtitle: string;
  features: string[];
  ctaLabel: string;
  onPress: () => void;
  delay: number;
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
          {/* Decorative circle top-right */}
          <View style={[styles.cardCircle1, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
          <View style={[styles.cardCircle2, { backgroundColor: "rgba(255,255,255,0.05)" }]} />

          {/* Top row: icon + badge */}
          <View style={styles.cardTopRow}>
            <View style={[styles.cardIconBox, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
              <Text style={styles.cardIconText}>{icon}</Text>
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

          {/* CTA row */}
          <View style={styles.cardCtaRow}>
            <Text style={styles.cardCtaLabel}>{ctaLabel}</Text>
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

  const handleSelect = async (mode: "business" | "client") => {
    await setProfileMode(mode);
    if (mode === "business") {
      // If a business owner ID is already saved, go straight to the dashboard
      // instead of the onboarding flow (handles post-logout re-entry)
      try {
        const storedOwnerId = await AsyncStorage.getItem("@bookease_business_owner_id");
        if (storedOwnerId) {
          router.replace("/(tabs)" as any);
          return;
        }
      } catch { /* ignore */ }
      router.replace("/onboarding");
    } else {
      router.replace("/client-signin" as any);
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

      {PARTICLES.map((p, i) => <FloatingParticle key={i} {...p} />)}

      <View style={styles.wave1} />
      <View style={styles.wave2} />

      <View style={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}>

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
          <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }, byLineStyle]}>
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
            badgeLabel="For Businesses"
            title="Business Portal"
            subtitle="Your complete business management hub"
            features={["Appointments", "Clients", "Analytics"]}
            ctaLabel="Get started"
            onPress={() => handleSelect("business")}
            delay={600}
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
          />
        </View>

        {/* ─── Footer Note ─── */}
        <Animated.Text style={[styles.footerNote, footerStyle]}>
          You can switch between portals at any time from Settings
        </Animated.Text>
      </View>
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
    height: height * 0.38,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderTopLeftRadius: width * 0.5,
    borderTopRightRadius: width * 0.5,
  },
  wave2: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.28,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderTopLeftRadius: width * 0.6,
    borderTopRightRadius: width * 0.6,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 4,
  },
  logoRing: {
    width: 96,
    height: 96,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    marginBottom: 10,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },
  appName: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
    marginTop: 2,
  },
  appTagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.65)",
    marginTop: 3,
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
});
