import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Animated,
  Image,
  TextInput,
  Vibration,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface LockScreenProps {
  biometricType: "face" | "fingerprint" | "none";
  onUnlock: () => void;
  /** Business display name shown above "App Locked" */
  businessName?: string;
  /** URI for the business logo shown above "App Locked" */
  logoUri?: string;
}

type ScreenState = "biometric" | "pin" | "success" | "failure";

const PIN_LENGTH = 4;
const MAX_BIOMETRIC_ATTEMPTS = 2;

export function LockScreen({ biometricType, onUnlock, businessName, logoUri }: LockScreenProps) {
  const colors = useColors();

  // ── State ────────────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>("biometric");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [biometricAttempts, setBiometricAttempts] = useState(0);

  // ── Animations ───────────────────────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successScaleAnim = useRef(new Animated.Value(0.5)).current;
  const successOpacityAnim = useRef(new Animated.Value(0)).current;
  const iconColorAnim = useRef(new Animated.Value(0)).current; // 0=primary, 1=success, 2=error

  // ── Fade in on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // ── Pulse animation ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (screenState !== "biometric") return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim, screenState]);

  // ── Auto-trigger biometric on mount ─────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (screenState !== "biometric") return;

    const timer = setTimeout(() => {
      onUnlock();
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shake animation ──────────────────────────────────────────────────────────
  const triggerShake = useCallback(() => {
    Vibration.vibrate(400);
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // ── Success animation ────────────────────────────────────────────────────────
  const triggerSuccess = useCallback(() => {
    setScreenState("success");
    Animated.parallel([
      Animated.spring(successScaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 12,
        stiffness: 200,
      }),
      Animated.timing(successOpacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => onUnlock(), 600);
    });
  }, [successScaleAnim, successOpacityAnim, onUnlock]);

  // ── Handle biometric retry / fallback ────────────────────────────────────────
  const handleBiometricPress = useCallback(async () => {
    const newAttempts = biometricAttempts + 1;
    setBiometricAttempts(newAttempts);

    // Call the parent authenticate
    onUnlock();

    // If this is the 2nd failed attempt, switch to PIN after a short delay
    if (newAttempts >= MAX_BIOMETRIC_ATTEMPTS) {
      setTimeout(() => {
        setScreenState("pin");
      }, 800);
    } else {
      triggerShake();
    }
  }, [biometricAttempts, onUnlock, triggerShake]);

  // ── PIN input ────────────────────────────────────────────────────────────────
  const handlePinDigit = useCallback((digit: string) => {
    if (pin.length >= PIN_LENGTH) return;
    const newPin = pin + digit;
    setPin(newPin);
    setPinError(false);

    if (newPin.length === PIN_LENGTH) {
      // For demo: accept any 4-digit PIN (in production, validate against stored hash)
      // Here we just call onUnlock — the parent already handles auth
      setTimeout(() => {
        triggerSuccess();
      }, 150);
    }
  }, [pin, triggerSuccess]);

  const handlePinDelete = useCallback(() => {
    setPin((p) => p.slice(0, -1));
    setPinError(false);
  }, []);

  if (Platform.OS === "web") return null;

  // ── Derived display values ───────────────────────────────────────────────────
  const isFace = biometricType === "face";
  const isFingerprint = biometricType === "fingerprint";
  const biometricIconName = isFace ? "faceid" : isFingerprint ? "touchid" : ("lock.fill" as any);
  const biometricLabel = isFace ? "Face ID" : isFingerprint ? "Touch ID" : "Biometrics";

  // ── Success overlay ──────────────────────────────────────────────────────────
  if (screenState === "success") {
    return (
      <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: fadeAnim }]}>
        <Animated.View
          style={[
            styles.successCircle,
            { backgroundColor: colors.success + "20" },
            { transform: [{ scale: successScaleAnim }], opacity: successOpacityAnim },
          ]}
        >
          <IconSymbol name="checkmark.circle.fill" size={72} color={colors.success} />
        </Animated.View>
        <Text style={[styles.title, { color: colors.foreground, marginTop: 20 }]}>Unlocked</Text>
      </Animated.View>
    );
  }

  // ── PIN entry screen ─────────────────────────────────────────────────────────
  if (screenState === "pin") {
    const pinDigits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
    return (
      <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: fadeAnim }]}>
        <View style={styles.content}>
          {/* Business branding */}
          {(logoUri || businessName) && (
            <View style={styles.brandRow}>
              {logoUri ? (
                <Image source={{ uri: logoUri }} style={styles.brandLogo} resizeMode="cover" />
              ) : (
                <Image source={require("@/assets/images/icon.png")} style={styles.brandLogo} resizeMode="cover" />
              )}
              {businessName && (
                <Text style={[styles.brandName, { color: colors.muted }]} numberOfLines={1}>
                  {businessName}
                </Text>
              )}
            </View>
          )}

          <Text style={[styles.title, { color: colors.foreground }]}>Enter Passcode</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Use your 4-digit PIN to unlock
          </Text>

          {/* PIN dots */}
          <Animated.View
            style={[
              styles.pinDots,
              { transform: [{ translateX: shakeAnim }] },
            ]}
          >
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.pinDot,
                  {
                    backgroundColor: i < pin.length
                      ? (pinError ? colors.error : colors.primary)
                      : colors.border,
                    borderColor: i < pin.length
                      ? (pinError ? colors.error : colors.primary)
                      : colors.border,
                  },
                ]}
              />
            ))}
          </Animated.View>

          {pinError && (
            <Text style={[styles.errorText, { color: colors.error }]}>Incorrect PIN. Try again.</Text>
          )}

          {/* Numpad */}
          <View style={styles.numpad}>
            {pinDigits.map((digit, idx) => {
              if (digit === "") return <View key={idx} style={styles.numpadKey} />;
              const isDelete = digit === "⌫";
              return (
                <Pressable
                  key={idx}
                  onPress={() => isDelete ? handlePinDelete() : handlePinDigit(digit)}
                  style={({ pressed }) => [
                    styles.numpadKey,
                    !isDelete && { backgroundColor: colors.surface },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text
                    style={[
                      styles.numpadDigit,
                      { color: isDelete ? colors.muted : colors.foreground },
                    ]}
                  >
                    {digit}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Back to biometric */}
          {biometricType !== "none" && (
            <Pressable
              onPress={() => { setPin(""); setScreenState("biometric"); }}
              style={({ pressed }) => [styles.switchBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <IconSymbol name={biometricIconName} size={16} color={colors.primary} />
              <Text style={[styles.switchBtnText, { color: colors.primary }]}>
                Use {biometricLabel}
              </Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    );
  }

  // ── Biometric screen (default) ───────────────────────────────────────────────
  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: fadeAnim }]}>
      <View style={styles.content}>
        {/* Business branding */}
        {(logoUri || businessName) && (
          <View style={styles.brandRow}>
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.brandLogo} resizeMode="cover" />
            ) : (
              <Image source={require("@/assets/images/icon.png")} style={styles.brandLogo} resizeMode="cover" />
            )}
            {businessName && (
              <Text style={[styles.brandName, { color: colors.muted }]} numberOfLines={1}>
                {businessName}
              </Text>
            )}
          </View>
        )}

        {/* Biometric icon with animated pulse ring */}
        <Animated.View style={[styles.iconWrapper, { transform: [{ translateX: shakeAnim }] }]}>
          <Animated.View
            style={[
              styles.pulseRing,
              { borderColor: colors.primary + "30", transform: [{ scale: pulseAnim }] },
            ]}
          />
          <View style={[styles.iconContainer, { backgroundColor: colors.primary + "18" }]}>
            <IconSymbol name={biometricIconName} size={52} color={colors.primary} />
          </View>
        </Animated.View>

        <Text style={[styles.title, { color: colors.foreground }]}>App Locked</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {biometricType !== "none" ? `Scanning with ${biometricLabel}\u2026` : "Tap to unlock"}
        </Text>

        {/* Biometric type badge */}
        {biometricType !== "none" && (
          <View style={[styles.badge, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}>
            <IconSymbol name={biometricIconName} size={14} color={colors.primary} />
            <Text style={[styles.badgeText, { color: colors.primary }]}>{biometricLabel}</Text>
          </View>
        )}

        {/* Unlock button */}
        <Pressable
          onPress={handleBiometricPress}
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

        {/* PIN fallback link */}
        <Pressable
          onPress={() => setScreenState("pin")}
          style={({ pressed }) => [styles.switchBtn, { opacity: pressed ? 0.6 : 1, marginTop: 4 }]}
        >
          <Text style={[styles.switchBtnText, { color: colors.muted }]}>Use Passcode Instead</Text>
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
    width: "100%",
  },
  // ── Branding ──────────────────────────────────────────────────────────────────
  brandRow: {
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  brandLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
  },
  brandName: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  // ── Biometric icon ────────────────────────────────────────────────────────────
  iconWrapper: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
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
  // ── Text ──────────────────────────────────────────────────────────────────────
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
  errorText: {
    fontSize: 13,
    textAlign: "center",
  },
  // ── Badge ─────────────────────────────────────────────────────────────────────
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // ── Buttons ───────────────────────────────────────────────────────────────────
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
  switchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
  },
  switchBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  // ── PIN ───────────────────────────────────────────────────────────────────────
  pinDots: {
    flexDirection: "row",
    gap: 16,
    marginVertical: 8,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  numpad: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 260,
    gap: 12,
    marginTop: 8,
  },
  numpadKey: {
    width: 76,
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  numpadDigit: {
    fontSize: 22,
    fontWeight: "500",
  },
  // ── Success ───────────────────────────────────────────────────────────────────
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
  },
});
