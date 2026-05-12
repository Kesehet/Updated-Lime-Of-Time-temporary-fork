import { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Animated } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface LockScreenProps {
  biometricType: "face" | "fingerprint" | "none";
  onUnlock: () => void;
}

export function LockScreen({ biometricType, onUnlock }: LockScreenProps) {
  const colors = useColors();

  // Pulse animation for the icon ring
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Fade in the screen
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Pulse the icon ring and auto-trigger biometric on mount
  useEffect(() => {
    if (Platform.OS === "web") return;

    // Start pulsing animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    // Auto-trigger biometric scan after a short delay (let screen render first)
    const timer = setTimeout(() => {
      onUnlock();
    }, 400);

    return () => {
      pulse.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (Platform.OS === "web") return null;

  // Pick the right icon and label based on what the device supports
  const isFace = biometricType === "face";
  const isFingerprint = biometricType === "fingerprint";
  const iconName = isFace ? "faceid" : isFingerprint ? "touchid" : ("lock.fill" as any);
  const biometricLabel = isFace
    ? "Face ID"
    : isFingerprint
    ? "Touch ID"
    : "Biometrics";
  const unlockSubtitle =
    biometricType !== "none"
      ? `Scanning with ${biometricLabel}\u2026`
      : "Tap to unlock";

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: colors.background, opacity: fadeAnim },
      ]}
    >
      <View style={styles.content}>
        {/* Biometric icon with animated pulse ring */}
        <View style={styles.iconWrapper}>
          {/* Outer pulse ring */}
          <Animated.View
            style={[
              styles.pulseRing,
              {
                borderColor: colors.primary + "30",
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          {/* Icon circle */}
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: colors.primary + "18" },
            ]}
          >
            <IconSymbol name={iconName} size={52} color={colors.primary} />
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.foreground }]}>
          App Locked
        </Text>

        {/* Subtitle — shows biometric type */}
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {unlockSubtitle}
        </Text>

        {/* Biometric type badge */}
        {biometricType !== "none" && (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: colors.primary + "15",
                borderColor: colors.primary + "30",
              },
            ]}
          >
            <IconSymbol name={iconName} size={14} color={colors.primary} />
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {biometricLabel}
            </Text>
          </View>
        )}

        {/* Unlock button — tap to retry if auto-scan was dismissed */}
        <Pressable
          onPress={onUnlock}
          style={({ pressed }) => [
            styles.unlockButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <IconSymbol name="lock.open.fill" size={18} color="#FFFFFF" />
          <Text style={styles.unlockButtonText}>
            {biometricType !== "none" ? `Unlock with ${biometricLabel}` : "Unlock"}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 40,
  },
  iconWrapper: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  pulseRing: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 2,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  unlockButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 20,
  },
  unlockButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
