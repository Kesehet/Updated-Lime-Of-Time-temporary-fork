import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Auth from "@/lib/_core/auth";
import { onSessionExpired } from "@/lib/_core/session-events";

/**
 * SessionExpiredToast
 *
 * Mounts once in the root layout. Listens for session-expired events from
 * api.ts / trpc.ts (401 responses). When triggered:
 *  1. Shows a brief toast: "Your session has expired. Please sign in again."
 *  2. Clears the stale session data from storage.
 *  3. Redirects to /profile-select after the toast fades out.
 */
export function SessionExpiredToast() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const opacity = useRef(new Animated.Value(0)).current;
  const router = useRouter();
  const isHandling = useRef(false);

  useEffect(() => {
    const unsubscribe = onSessionExpired(async (portal) => {
      if (isHandling.current) return;
      isHandling.current = true;

      const msg =
        portal === "client"
          ? "Your client session has expired. Please sign in again."
          : "Your business session has expired. Please sign in again.";
      setMessage(msg);
      setVisible(true);

      // Fade in
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Clear stale session
      try {
        if (portal === "business") {
          await Auth.removeSessionToken();
          await AsyncStorage.multiRemove([
            "@bookease_business_owner_id",
            "@bookease_business_name",
          ]);
        } else {
          await AsyncStorage.multiRemove([
            "client_session_token",
            "client_account_info",
          ]);
        }
      } catch { /* ignore */ }

      // Hold for 2.5s then fade out and redirect
      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(() => {
          setVisible(false);
          isHandling.current = false;
          router.replace("/profile-select" as any);
        });
      }, 2500);
    });

    return unsubscribe;
  }, [opacity, router]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={styles.toast}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: 380,
  },
  icon: {
    fontSize: 18,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    lineHeight: 20,
  },
});
