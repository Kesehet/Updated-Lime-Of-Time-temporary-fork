/**
 * AnimatedSplash — branded launch screen.
 *
 * Shows the app logo, "Lime Of Time" name, and tagline with a
 * scale+fade-in animation, a subtle logo pulse, then fades out the
 * entire overlay after a short pause and calls onFinish.
 *
 * Timing:
 *   0 ms    → logo + text fade/scale in (420 ms)
 *   200 ms  → loading bar animates from 60% → 100% (800 ms)
 *             shimmer sweeps across the fill continuously
 *   500 ms  → logo pulse: 1.0 → 1.06 → 1.0 (400 ms)
 *   1 800 ms → entire screen fades out (380 ms)
 *   2 180 ms → onFinish() called
 *
 * The loading bar starts at 60% to seamlessly continue from where the
 * native splash screen's static loading bar left off.
 * A shimmer highlight sweeps left-to-right across the green fill to
 * make the bar feel alive and polished.
 */

import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";

const BRAND_BG = "#0D2318";
const BRAND_ACCENT = "#8FBF6A";
const BRAND_TEXT = "#ECEDEE";
const BRAND_MUTED = "rgba(236,237,238,0.55)";

// Loading bar dimensions — must match the native splash bar
const BAR_TOTAL_WIDTH = 220;
const BAR_HEIGHT = 14;
const BAR_RADIUS = 7;

// Shimmer highlight width (the gloss stripe)
const SHIMMER_WIDTH = 60;

interface AnimatedSplashProps {
  onFinish: () => void;
}

export function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  // Overall screen opacity (used for the fade-out exit)
  const screenOpacity = useRef(new Animated.Value(1)).current;

  // Logo: scale from 0.72 → 1.0 + fade in
  const logoScale = useRef(new Animated.Value(0.72)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Pulse scale (applied on top of the entry scale)
  const pulseScale = useRef(new Animated.Value(1)).current;

  // Text: fade in slightly after logo
  const textOpacity = useRef(new Animated.Value(0)).current;

  // Accent line width: grows from 0 → 40
  const accentWidth = useRef(new Animated.Value(0)).current;

  // Loading bar: starts at 60% fill, animates to 100%
  const loadingBarWidth = useRef(
    new Animated.Value(BAR_TOTAL_WIDTH * 0.6)
  ).current;

  // Loading label opacity: fades in with text block
  const loadingLabelOpacity = useRef(new Animated.Value(0)).current;

  // Shimmer position: translateX sweeping from -SHIMMER_WIDTH to BAR_TOTAL_WIDTH
  // Loops continuously while the bar is visible
  const shimmerX = useRef(new Animated.Value(-SHIMMER_WIDTH)).current;

  useEffect(() => {
    // Step 1: logo appears (scale + fade)
    Animated.parallel([
      Animated.timing(logoScale, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
    ]).start();

    // Step 2: text fades in 180 ms after logo starts
    const textTimer = setTimeout(() => {
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }).start();
    }, 180);

    // Step 3: accent line grows in 250 ms after logo
    const accentTimer = setTimeout(() => {
      Animated.timing(accentWidth, {
        toValue: 40,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // width is not supported by native driver
      }).start();
    }, 250);

    // Step 4: logo pulse at 500 ms (1.0 → 1.06 → 1.0)
    const pulseTimer = setTimeout(() => {
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.06,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 220,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }, 500);

    // Step 5: loading label fades in with text block
    const loadingLabelTimer = setTimeout(() => {
      Animated.timing(loadingLabelOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, 180);

    // Step 6: loading bar animates from 60% → 100% starting at 200 ms
    // On completion, fire a light haptic to signal the app is ready.
    const loadingBarTimer = setTimeout(() => {
      Animated.timing(loadingBarWidth, {
        toValue: BAR_TOTAL_WIDTH,
        duration: 800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false, // width cannot use native driver
      }).start(({ finished }) => {
        if (finished && Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      });
    }, 200);

    // Step 7: shimmer sweeps left-to-right on a loop
    // Each sweep takes 900 ms; loop until screen fades out
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerX, {
          toValue: BAR_TOTAL_WIDTH + SHIMMER_WIDTH,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        // Brief pause between sweeps
        Animated.delay(200),
        // Reset instantly (no animation)
        Animated.timing(shimmerX, {
          toValue: -SHIMMER_WIDTH,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    const shimmerTimer = setTimeout(() => {
      shimmerLoop.start();
    }, 200);

    // Step 8: after 1 800 ms total, fade the whole screen out
    const exitTimer = setTimeout(() => {
      shimmerLoop.stop();
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 380,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        onFinish();
      });
    }, 1800);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(accentTimer);
      clearTimeout(pulseTimer);
      clearTimeout(loadingLabelTimer);
      clearTimeout(loadingBarTimer);
      clearTimeout(shimmerTimer);
      clearTimeout(exitTimer);
      shimmerLoop.stop();
    };
  }, [
    logoScale,
    logoOpacity,
    pulseScale,
    textOpacity,
    accentWidth,
    loadingBarWidth,
    loadingLabelOpacity,
    shimmerX,
    screenOpacity,
    onFinish,
  ]);

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]} pointerEvents="none">
      {/* Decorative background circles */}
      <View style={styles.bgCircle1} />
      <View style={styles.bgCircle2} />

      {/* Logo */}
      <Animated.View
        style={[
          styles.logoWrapper,
          {
            opacity: logoOpacity,
            transform: [
              { scale: logoScale },
              { scale: pulseScale },
            ],
          },
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

      {/* Loading section: label + animated progress bar with shimmer */}
      <Animated.View style={[styles.loadingSection, { opacity: loadingLabelOpacity }]}>
        <Text style={styles.loadingLabel}>LOADING....</Text>

        {/* Bar track */}
        <View style={styles.barTrack}>
          {/* Animated green fill */}
          <Animated.View style={[styles.barFill, { width: loadingBarWidth }]}>
            {/*
             * Shimmer highlight — a semi-transparent white diagonal stripe
             * that slides across the fill.
             * overflow: "hidden" on barFill clips it to the fill area.
             */}
            <Animated.View
              style={[
                styles.shimmer,
                { transform: [{ translateX: shimmerX }] },
              ]}
            />
          </Animated.View>
        </View>
      </Animated.View>

      {/* Animated bottom accent line */}
      <Animated.View style={[styles.accentLine, { width: accentWidth }]} />
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
  bgCircle1: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(143,191,106,0.06)",
  },
  bgCircle2: {
    position: "absolute",
    bottom: -60,
    left: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(143,191,106,0.04)",
  },
  logoWrapper: {
    width: 104,
    height: 104,
    borderRadius: 26,
    overflow: "hidden",
    marginBottom: 28,
    // Soft glow ring
    shadowColor: BRAND_ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 14,
  },
  logo: {
    width: 104,
    height: 104,
  },
  textBlock: {
    alignItems: "center",
    gap: 6,
  },
  appName: {
    fontSize: 30,
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
    marginTop: 12,
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
  // Loading section sits below the text block
  loadingSection: {
    alignItems: "center",
    marginTop: 36,
    gap: 10,
  },
  loadingLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: BRAND_ACCENT,
    letterSpacing: 2,
  },
  barTrack: {
    width: BAR_TOTAL_WIDTH,
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    backgroundColor: "rgba(25,55,38,1)",
    overflow: "hidden",
  },
  barFill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    backgroundColor: BRAND_ACCENT,
    overflow: "hidden", // clips the shimmer to the fill area
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SHIMMER_WIDTH,
    height: BAR_HEIGHT,
    // Diagonal white gloss stripe using a skewed rectangle trick:
    // We tilt the shimmer 20° by making it taller and offsetting vertically,
    // but since overflow:hidden clips it, a simple semi-transparent white
    // rectangle with slight skew via transform gives the gloss look.
    backgroundColor: "rgba(255,255,255,0.30)",
    transform: [{ skewX: "-20deg" }],
  },
  accentLine: {
    position: "absolute",
    bottom: 52,
    height: 3,
    borderRadius: 2,
    backgroundColor: BRAND_ACCENT,
    opacity: 0.7,
  },
});
