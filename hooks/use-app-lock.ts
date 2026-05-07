import { useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Storage keys ───────────────────────────────────────────────────────────────
/** Business portal biometric lock enabled */
const BIOMETRIC_ENABLED_KEY = "@bookease_biometric_enabled";
/** Client portal biometric lock enabled */
export const CLIENT_BIOMETRIC_ENABLED_KEY = "@bookease_client_biometric_enabled";

// Key to track the last time the business owner actively used the app
export const BUSINESS_LAST_ACTIVE_KEY = "@bookease_business_last_active";
// Key to track the last time the client actively used the app
export const CLIENT_LAST_ACTIVE_KEY = "@bookease_client_last_active";

// Business: require Face ID re-auth if away for more than 24 hours
export const BUSINESS_REAUTH_MS = 24 * 60 * 60 * 1000; // 24 hours
// Client: require Face ID re-auth if away for more than 24 hours
export const CLIENT_REAUTH_MS = 24 * 60 * 60 * 1000; // 24 hours
// Client: auto-logout after 30 days of inactivity
export const CLIENT_INACTIVITY_LOGOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Activity helpers ───────────────────────────────────────────────────────────

/**
 * Records the current timestamp as the business owner's last-active time.
 * Call this whenever the business portal is actively used.
 */
export async function recordBusinessActivity(): Promise<void> {
  try {
    await AsyncStorage.setItem(BUSINESS_LAST_ACTIVE_KEY, Date.now().toString());
  } catch { /* ignore */ }
}

/**
 * Records the current timestamp as the client's last-active time.
 * Call this whenever the client portal is actively used.
 */
export async function recordClientActivity(): Promise<void> {
  try {
    await AsyncStorage.setItem(CLIENT_LAST_ACTIVE_KEY, Date.now().toString());
  } catch { /* ignore */ }
}

// ── Re-auth / logout checks ────────────────────────────────────────────────────

/**
 * Returns true if the business owner has been away for more than 24 hours.
 * In that case the app should require Face ID (if enabled).
 */
export async function businessNeedsReauth(): Promise<boolean> {
  try {
    const lastActive = await AsyncStorage.getItem(BUSINESS_LAST_ACTIVE_KEY);
    if (!lastActive) return false; // first launch — no history yet
    const elapsed = Date.now() - parseInt(lastActive, 10);
    return elapsed > BUSINESS_REAUTH_MS;
  } catch {
    return false;
  }
}

/**
 * Returns true if the client has been away for more than 24 hours.
 * In that case the app should require Face ID (if client biometric is enabled).
 */
export async function clientNeedsReauth(): Promise<boolean> {
  try {
    const lastActive = await AsyncStorage.getItem(CLIENT_LAST_ACTIVE_KEY);
    if (!lastActive) return false;
    const elapsed = Date.now() - parseInt(lastActive, 10);
    return elapsed > CLIENT_REAUTH_MS;
  } catch {
    return false;
  }
}

/**
 * Returns true if the client has been inactive for more than 30 days.
 * In that case the client session should be cleared and they must sign in again.
 */
export async function clientNeedsLogout(): Promise<boolean> {
  try {
    const lastActive = await AsyncStorage.getItem(CLIENT_LAST_ACTIVE_KEY);
    if (!lastActive) return false; // first launch — no history yet
    const elapsed = Date.now() - parseInt(lastActive, 10);
    return elapsed > CLIENT_INACTIVITY_LOGOUT_MS;
  } catch {
    return false;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Hook that manages app lock with biometric authentication.
 *
 * @param splashDone   When false, defers the Face ID prompt until the animated splash finishes.
 * @param storageKey   Which AsyncStorage key to read/write the enabled flag.
 *                     Defaults to the business key; pass CLIENT_BIOMETRIC_ENABLED_KEY for client portal.
 * @param onUnlocked   Optional callback invoked after a successful biometric unlock.
 *                     Use it to record activity for the correct portal.
 */
export function useAppLock(
  splashDone: boolean = true,
  storageKey: string = BIOMETRIC_ENABLED_KEY,
  onUnlocked?: () => Promise<void>,
) {
  const [isLocked, setIsLocked] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<"face" | "fingerprint" | "none">("none");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const hasRunInitialAuth = useRef(false);
  const isAuthenticating = useRef(false);

  // Check biometric hardware availability AND load saved preference
  useEffect(() => {
    if (Platform.OS === "web") {
      setSettingsLoaded(true);
      return;
    }

    (async () => {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricAvailable(hasHardware && isEnrolled);

        if (hasHardware && isEnrolled) {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            setBiometricType("face");
          } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            setBiometricType("fingerprint");
          }
        }

        // Load saved preference
        const saved = await AsyncStorage.getItem(storageKey);
        if (saved === "true" && hasHardware && isEnrolled) {
          setBiometricEnabled(true);
          // Set locked immediately so the lock screen shows before auth prompt
          setIsLocked(true);
        }
      } catch (err) {
        console.warn("[AppLock] Error checking biometrics:", err);
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, [storageKey]);

  // Authenticate with biometrics
  const authenticate = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") return true;

    // Prevent concurrent auth prompts
    if (isAuthenticating.current) return false;
    isAuthenticating.current = true;

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        setIsLocked(false);
        return true;
      }

      const promptMessage =
        biometricType === "face"
          ? "Unlock with Face ID"
          : biometricType === "fingerprint"
          ? "Unlock with Fingerprint"
          : "Authenticate to continue";

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });

      if (result.success) {
        setIsLocked(false);
        // Record activity so the 24h timer resets after successful unlock
        if (onUnlocked) {
          await onUnlocked();
        } else {
          await recordBusinessActivity(); // default: business portal
        }
        return true;
      }

      // User cancelled or failed — keep locked, they can tap "Unlock" button to retry
      return false;
    } catch (err) {
      console.warn("[AppLock] Authentication error:", err);
      return false;
    } finally {
      isAuthenticating.current = false;
    }
  }, [biometricType, onUnlocked]);

  // Toggle biometric lock on/off
  const toggleBiometric = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        // Verify biometrics work before enabling
        const success = await authenticate();
        if (success) {
          setBiometricEnabled(true);
          await AsyncStorage.setItem(storageKey, "true");
          return true;
        }
        return false;
      } else {
        setBiometricEnabled(false);
        await AsyncStorage.setItem(storageKey, "false");
        setIsLocked(false);
        return true;
      }
    },
    [authenticate, storageKey]
  );

  // Initial authentication on first mount AFTER settings are loaded AND splash is done.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!settingsLoaded) return;
    if (!biometricEnabled) return;
    if (!splashDone) return; // wait for animated splash to finish
    if (hasRunInitialAuth.current) return;
    hasRunInitialAuth.current = true;

    // isLocked was already set to true during load, now prompt
    const timer = setTimeout(async () => {
      await authenticate();
    }, 300);

    return () => clearTimeout(timer);
  }, [settingsLoaded, biometricEnabled, splashDone, authenticate]);

  return {
    isLocked,
    biometricEnabled,
    biometricAvailable,
    biometricType,
    authenticate,
    toggleBiometric,
  };
}
