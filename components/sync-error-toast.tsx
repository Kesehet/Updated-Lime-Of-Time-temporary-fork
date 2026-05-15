/**
 * SyncErrorToast
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounts once in the root layout. Listens for DB sync errors emitted by
 * syncToDb. Shows a non-blocking bottom toast with:
 *   - "Couldn't save changes" message
 *   - "Retry" button that re-runs the failed sync action
 *   - Auto-dismisses after 6 seconds if not interacted with
 *
 * Usage: place <SyncErrorToast /> in app/_layout.tsx alongside SessionExpiredToast.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Animated, Pressable, StyleSheet, Text, View, Platform } from "react-native";
import { onSyncError } from "@/lib/_core/sync-error-events";

export function SyncErrorToast() {
  const [visible, setVisible] = useState(false);
  const [retryFn, setRetryFn] = useState<(() => void) | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 20, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      setRetryFn(null);
    });
  }, [opacity, translateY]);

  const show = useCallback((retry: () => void) => {
    // Reset any existing timer
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setRetryFn(() => retry);
    setVisible(true);
    translateY.setValue(20);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    // Auto-dismiss after 6 seconds
    dismissTimer.current = setTimeout(dismiss, 6000);
  }, [opacity, translateY, dismiss]);

  useEffect(() => {
    const unsubscribe = onSyncError((_actionType, retry) => {
      show(retry);
    });
    return () => {
      unsubscribe();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [show]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.toast}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.message} numberOfLines={2}>
          Couldn't save changes. Check your connection.
        </Text>
        <Pressable
          onPress={() => {
            dismiss();
            if (retryFn) retryFn();
          }}
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
        <Pressable
          onPress={dismiss}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 100 : 80,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e2022",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    maxWidth: 480,
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    gap: 8,
  },
  icon: {
    fontSize: 16,
  },
  message: {
    flex: 1,
    fontSize: 13,
    color: "#ECEDEE",
    fontWeight: "500",
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: "#0a7ea4",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  closeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  closeText: {
    color: "#9BA1A6",
    fontSize: 14,
    fontWeight: "600",
  },
});
