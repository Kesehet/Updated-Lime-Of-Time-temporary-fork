import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform, StyleSheet, View } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import * as SplashScreen from "expo-splash-screen";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { StoreProvider, useStore } from "@/lib/store";
import { ClientStoreProvider } from "@/lib/client-store";
import { AppLockProvider, ClientAppLockProvider } from "@/lib/app-lock-provider";
import { SplashDoneProvider } from "@/lib/splash-done-context";
import { NotificationProvider } from "@/lib/notification-provider";
import { StripeProvider } from "@/lib/stripe-provider";
import { getApiBaseUrl } from "@/constants/oauth";
import { initSentry, withSentryWrapper } from "@/lib/sentry";
import { AnimatedSplash } from "@/components/animated-splash";
import * as FileSystem from "expo-file-system/legacy";
import * as Auth from "@/lib/_core/auth";
import { SessionExpiredToast } from "@/components/session-expired-toast";
import {
  businessNeedsReauth,
  clientNeedsLogout,
  clientNeedsReauth,
  CLIENT_BIOMETRIC_ENABLED_KEY,
  CLIENT_LAST_ACTIVE_KEY,
  BUSINESS_LAST_ACTIVE_KEY,
} from "@/hooks/use-app-lock";

/**
 * One-time migration: if businessLogoUri is a local file:/// path (from a
 * previous bug), re-upload it to cloud storage and save the permanent URL.
 * Runs once when the store first loads.
 */
function LogoMigration() {
  const { state, dispatch, syncToDb } = useStore();
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!state.loaded || hasRun.current) return;
    const logoUri = state.settings.businessLogoUri;
    if (!logoUri || !logoUri.startsWith("file:///")) return;
    hasRun.current = true;
    (async () => {
      try {
        const base64 = await FileSystem.readAsStringAsync(logoUri, { encoding: FileSystem.EncodingType.Base64 });
        const { url } = await uploadImageMut.mutateAsync({ base64, mimeType: "image/jpeg", folder: "logos" });
        const action = { type: "UPDATE_SETTINGS" as const, payload: { businessLogoUri: url } };
        dispatch(action);
        syncToDb(action);
      } catch {
        // Migration failed silently — logo will just be missing until re-uploaded manually
      }
    })();
  }, [state.loaded, state.settings.businessLogoUri]);

  return null;
}

// Initialize Sentry as early as possible (before any React rendering)
initSentry();

SplashScreen.preventAutoHideAsync();

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  // index is the true entry point — Expo Router renders this first on cold launch.
  // Without this, Expo Router would fall back to the first alphabetical route
  // in app/ which is "(client-tabs)", causing the Client Portal to open instead
  // of the Portal Selector.
  anchor: "index",
};

function RootLayout() {
  // Use system fonts (SF Pro on iOS, Roboto on Android) — no external font package needed
  const fontsLoaded = true;
  const [splashDone, setSplashDone] = useState(false);
  const router = useRouter();

  // NOTE: Navigation to /profile-select is handled exclusively by handleSplashFinish
  // (called when the AnimatedSplash overlay completes). The AnimatedSplash covers
  // the entire screen with pointerEvents="none" during startup, so there is no
  // risk of the last-visited route flashing before the portal selector appears.
  // A redundant mount-time router.replace() was previously here but caused the
  // portal selector to appear twice on cold launch — it has been removed.

  const handleSplashFinish = useCallback(async () => {
    // NOTE: Do NOT call setSplashDone(true) here yet.
    // We first navigate to portal-select, then remove the splash overlay
    // so the user never sees the last-visited route flash underneath.
    // Helper: decode JWT payload and check if token is expired (client-side only, no verification)
    const isTokenExpired = (token: string): boolean => {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return true;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (!payload.exp) return false; // no expiry = never expires
        return Date.now() / 1000 > payload.exp;
      } catch {
        return true; // malformed token — treat as expired
      }
    };
    try {
      // ── Business portal ──────────────────────────────────────────────────
      // Always land on Portal Selector first. If a valid business session exists,
      // the user still taps "Business Portal" — but we skip the onboarding flow
      // and go straight to the dashboard (handled in profile-select.tsx).
      // Exception: if biometric lock is enabled AND the owner was away < 24 h,
      // we auto-route to the dashboard (Face ID lock overlay will appear on top).
      const storedOwnerId = await AsyncStorage.getItem("@bookease_business_owner_id");
      if (storedOwnerId) {
        const businessToken = await Auth.getSessionToken();
        if (!businessToken || isTokenExpired(businessToken)) {
          // JWT expired — clear stale session, fall through to portal selector
          await Auth.removeSessionToken();
          await AsyncStorage.multiRemove([
            "@bookease_business_owner_id",
            "@bookease_business_name",
            "@bookease_settings",
            BUSINESS_LAST_ACTIVE_KEY,
          ]);
        } else {
          // Valid session. Check if biometric is enabled and owner was away > 24 h.
          // If so, auto-route to dashboard — the AppLockProvider will show Face ID.
          // If biometric is NOT enabled, always show portal selector (user must tap).
          const biometricEnabled = await AsyncStorage.getItem("@bookease_biometric_enabled");
          const needsReauth = await businessNeedsReauth();
          if (biometricEnabled === "true" && !needsReauth) {
            // Recently used AND biometric enabled → auto-route, Face ID will guard
            router.replace("/(tabs)" as any);
            // Remove splash overlay after navigation commits
            setTimeout(() => setSplashDone(true), 80);
            return;
          }
          // Otherwise: show portal selector. User taps Business Portal → goes to dashboard.
          // (profile-select.tsx already handles the "storedOwnerId exists" fast-path)
        }
      }

      // ── Client portal ────────────────────────────────────────────────────
      const clientToken = await AsyncStorage.getItem("client_session_token");
      if (clientToken) {
        if (isTokenExpired(clientToken)) {
          // JWT expired — clear stale session
          await AsyncStorage.multiRemove(["client_session_token", "client_account_info", CLIENT_LAST_ACTIVE_KEY]);
        } else {
          // Check 30-day inactivity
          const needsLogout = await clientNeedsLogout();
          if (needsLogout) {
            // Inactive for > 30 days — clear session and show portal selector
            await AsyncStorage.multiRemove(["client_session_token", "client_account_info", CLIENT_LAST_ACTIVE_KEY]);
            // Fall through to portal selector — do NOT check biometrics for a cleared session
          } else {
            // Session is valid and active. Check if client biometric is enabled
            // and the client was active within the last 24 hours.
            // If so, auto-route to client tabs — ClientAppLockProvider will show Face ID.
            const clientBiometricEnabled = await AsyncStorage.getItem(CLIENT_BIOMETRIC_ENABLED_KEY);
            const clientNeedsReauthResult = await clientNeedsReauth();
            if (clientBiometricEnabled === "true" && !clientNeedsReauthResult) {
              // Recently used AND client biometric enabled → auto-route, Face ID will guard
              router.replace("/(client-tabs)/discover" as any);
              setTimeout(() => setSplashDone(true), 80);
              return;
            }
            // Biometric not enabled or needs re-auth → show portal selector.
            // User taps Client Portal → goes to discover.
          }
        }
      }
    } catch { /* ignore */ }
    // Always show portal selector on cold launch
    router.replace("/profile-select" as any);
    // Small delay to let the navigation commit before removing the splash overlay
    setTimeout(() => setSplashDone(true), 80);
  }, [router, setSplashDone]);
  const onLayoutRootView = useCallback(() => {
    // No-op: SplashScreen.hideAsync is now called in a useEffect after first render
    // to ensure our AnimatedSplash overlay is painted before the native splash disappears.
  }, []);

  // Hide the native splash screen after the first render so our AnimatedSplash
  // is guaranteed to be on screen before the native splash disappears.
  // On production builds (TestFlight) the JS bundle takes longer to parse;
  // we wait 150 ms after the first two rAFs to ensure the AnimatedSplash
  // view is fully composited on the native layer before the native splash
  // is dismissed — preventing a black/white flash between the two.
  useEffect(() => {
    let cancelled = false;
    const hide = async () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          // Extra 150 ms for production bundle parse + native compositing
          setTimeout(async () => {
            if (cancelled) return;
            try {
              await SplashScreen.hideAsync();
            } catch {
              // Ignore — harmless Expo Go timing issue
            }
          }, 150);
        });
      });
    };
    hide();
    return () => { cancelled = true; };
  }, []);

  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  useEffect(() => {
    const apiBase = getApiBaseUrl();
    fetch(`${apiBase}/api/public/stripe-config`)
      .then((r) => r.json())
      .then((d) => { if (d?.publishableKey) setStripePublishableKey(d.publishableKey); })
      .catch(() => {});
  }, []);

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  if (!fontsLoaded) {
    return null;
  }

  const content = (
    <View style={{ flex: 1 }}>
    {/* AnimatedSplash is rendered first so it is composited before the Stack navigator
        mounts — this guarantees it is on screen when the native splash is dismissed. */}
    {!splashDone && (
      <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <AnimatedSplash onFinish={handleSplashFinish} />
      </View>
    )}
    <StripeProvider publishableKey={stripePublishableKey}>
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <StoreProvider>
            <LogoMigration />
            <ClientStoreProvider>
            <SplashDoneProvider splashDone={splashDone}>
            <AppLockProvider splashDone={splashDone}>
            <NotificationProvider>
            {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
            {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
            {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="new-booking" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="calendar-booking" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="appointment-detail" options={{ presentation: "card" }} />
              <Stack.Screen name="client-detail" options={{ presentation: "card" }} />
              <Stack.Screen name="service-form" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="booking" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="onboarding" options={{ presentation: "card", gestureEnabled: false }} />
              <Stack.Screen name="analytics-detail" options={{ presentation: "card" }} />
              <Stack.Screen name="discounts" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="gift-cards" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="book/[slug]" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="review/[slug]" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="gift/[code]" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="oauth/callback" />
              <Stack.Screen name="schedule-settings" options={{ presentation: "card" }} />
              <Stack.Screen name="booking-policies" options={{ presentation: "card" }} />
              <Stack.Screen name="business-profile" options={{ presentation: "card" }} />
              <Stack.Screen name="locations" options={{ presentation: "card" }} />
              <Stack.Screen name="location-form" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="reviews" options={{ presentation: "card" }} />
              <Stack.Screen name="notification-settings" options={{ presentation: "card" }} />
              <Stack.Screen name="notification-inbox" options={{ presentation: "card" }} />
              <Stack.Screen name="data-export" options={{ presentation: "card" }} />
              <Stack.Screen name="staff" options={{ presentation: "card" }} />
              <Stack.Screen name="staff-form" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="staff-calendar" options={{ presentation: "card" }} />
              <Stack.Screen name="product-form" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="sms-templates" options={{ presentation: "card" }} />
              <Stack.Screen name="edit-appointment" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="send-reminder" options={{ presentation: "card" }} />
              <Stack.Screen name="template-library" options={{ presentation: "card" }} />
              <Stack.Screen name="reminder-templates" options={{ presentation: "card" }} />
              <Stack.Screen name="subscription" options={{ presentation: "card" }} />
              <Stack.Screen name="payment-methods" options={{ presentation: "card" }} />
              <Stack.Screen name="payments-history" options={{ presentation: "card" }} />
              <Stack.Screen name="social-links" options={{ presentation: "card" }} />
              <Stack.Screen name="note-templates" options={{ presentation: "card" }} />
              <Stack.Screen name="promo-codes" options={{ presentation: "card" }} />
              <Stack.Screen name="category-management" options={{ presentation: "card" }} />
              <Stack.Screen name="usage-guide" options={{ presentation: "card" }} />
              <Stack.Screen name="onboarding-analytics" options={{ presentation: "card" }} />
              <Stack.Screen name="choose-plan" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="birthday-campaigns" options={{ presentation: "card" }} />
              <Stack.Screen name="packages" options={{ presentation: "card" }} />
              <Stack.Screen name="package-browser" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="sms-automation" options={{ presentation: "card" }} />
              <Stack.Screen name="twilio-setup" options={{ presentation: "card" }} />
              <Stack.Screen name="business-hours-settings" options={{ presentation: "card" }} />
              <Stack.Screen name="service-gallery" options={{ presentation: "card" }} />
              <Stack.Screen name="status-detail" options={{ presentation: "card" }} />
              <Stack.Screen name="payment-summary" options={{ presentation: "card" }} />
              <Stack.Screen name="payment-method-cashapp" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="payment-method-venmo" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="payment-method-zelle" options={{ presentation: "fullScreenModal" }} />
              {/* Client Portal Screens */}
              <Stack.Screen name="profile-select" options={{ presentation: "card" }} />
              <Stack.Screen name="client-signin" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-profile-onboarding" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="client-edit-profile" options={{ presentation: "fullScreenModal", headerShown: false, contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-notifications" options={{ presentation: "fullScreenModal", headerShown: false, contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="(client-tabs)" options={{ presentation: "fullScreenModal",
                // Wrap client tabs in their own biometric lock provider
                contentStyle: { flex: 1 } }} />
              <Stack.Screen name="client-business-detail" options={{ presentation: "formSheet", contentStyle: { backgroundColor: "#0D2318" }, gestureEnabled: true, headerShown: false, sheetAllowedDetents: [1.0], sheetLargestUndimmedDetentIndex: 0, sheetGrabberVisible: true, sheetCornerRadius: 24 }} />
              <Stack.Screen name="client-booking-wizard" options={{ presentation: "card", headerShown: false, contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-appointment-detail" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-booking-confirmation" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-message-thread" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-saved-businesses" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
              <Stack.Screen name="client-message-thread-business" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: "#0D2318" } , gestureEnabled: true}} />
            </Stack>
            <StatusBar style="auto" />
            <SessionExpiredToast />
            </NotificationProvider>
            </AppLockProvider>
            </SplashDoneProvider>
            </ClientStoreProvider>
          </StoreProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
    </StripeProvider>
    </View>
  );
  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>
        {content}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

// Wrap with Sentry for automatic crash reporting and performance monitoring.
// withSentryWrapper is a no-op when EXPO_PUBLIC_SENTRY_DSN is not set.
export default withSentryWrapper(RootLayout);
