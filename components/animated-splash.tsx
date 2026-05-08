/**
 * AnimatedSplash — branded launch screen.
 *
 * Shows the app logo, "Lime Of Time" name, and tagline with a
 * scale+fade-in animation, then fades out the entire overlay after
 * a short pause and calls onFinish.
 *
 * Timing:
 *   0 ms    → logo + text fade/scale in (400 ms)
 *   1 600 ms → entire screen fades out (350 ms)
 *   1 950 ms → onFinish() called
 */

import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

const BRAND_BG = "#0D2318";
const BRAND_ACCENT = "#8FBF6A";
const BRAND_TEXT = "#ECEDEE";
const BRAND_MUTED = "rgba(236,237,238,0.55)";

interface AnimatedSplashProps {
  onFinish: () => void;
}

export function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  // Overall screen opacity (used for the fade-out exit)
  const screenOpacity = useRef(new Animated.Value(1)).current;

  // Logo: scale from 0.75 → 1.0 + fade in
  const logoScale = useRef(new Animated.Value(0.75)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Text: fade in slightly after logo
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Step 1: logo appears (scale + fade)
    Animated.parallel([
      Animated.timing(logoScale, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
    ]).start();

    // Step 2: text fades in 150 ms after logo starts
    const textTimer = setTimeout(() => {
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }, 150);

    // Step 3: after 1 600 ms total, fade the whole screen out
    const exitTimer = setTimeout(() => {
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => {
        onFinish();
      });
    }, 1600);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(exitTimer);
    };
  }, [logoScale, logoOpacity, textOpacity, screenOpacity, onFinish]);

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]} pointerEvents="none">
      {/* Logo */}
      <Animated.View
        style={[
          styles.logoWrapper,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <Image
          source={require("@/assets/images/icon.png")}
          style={styles.logo}
          contentFit="contain"
        />
      </Animated.View>

      {/* App name + tagline */}
      <Animated.View style={[styles.textBlock, { opacity: textOpacity }]}>
        <Text style={styles.appName}>Lime Of Time</Text>
        <Text style={styles.tagline}>Book Appointments Near You</Text>
        <View style={styles.byLineRow}>
          <View style={styles.byLineDash} />
          <Text style={styles.byLine}>BY INNOVANCIO</Text>
          <View style={styles.byLineDash} />
        </View>
      </Animated.View>

      {/* Subtle bottom accent line */}
      <View style={styles.accentLine} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND_BG,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  logoWrapper: {
    width: 96,
    height: 96,
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 24,
    // Soft glow ring
    shadowColor: BRAND_ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 12,
  },
  logo: {
    width: 96,
    height: 96,
  },
  textBlock: {
    alignItems: "center",
    gap: 6,
  },
  appName: {
    fontSize: 28,
    fontWeight: "700",
    color: BRAND_TEXT,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 13,
    fontWeight: "400",
    color: BRAND_MUTED,
    letterSpacing: 0.3,
  },
  byLineRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8,
  },
  byLineDash: {
    width: 20,
    height: 1,
    backgroundColor: BRAND_MUTED,
    opacity: 0.5,
  },
  byLine: {
    fontSize: 10,
    fontWeight: "500",
    color: BRAND_MUTED,
    letterSpacing: 2,
    opacity: 0.7,
  },
  accentLine: {
    position: "absolute",
    bottom: 48,
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: BRAND_ACCENT,
    opacity: 0.6,
  },
});
