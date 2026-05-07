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
import { AppLockProvider } from "@/lib/app-lock-provider";
import { NotificationProvider } from "@/lib/notification-provider";
import { initSentry, withSentryWrapper } from "@/lib/sentry";
import { AnimatedSplash } from "@/components/animated-splash";
import * as FileSystem from "expo-file-system/legacy";

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
  anchor: "profile-select",
};

function RootLayout() {
  // Use system fonts (SF Pro on iOS, Roboto on Android) — no external font package needed
  const fontsLoaded = true;
  const [splashDone, setSplashDone] = useState(false);
  const router = useRouter();
  const handleSplashFinish = useCallback(async () => {
    setSplashDone(true);
    try {
      // Check if a client session token exists — if so, skip profile-select and go straight to client portal
      const clientToken = await AsyncStorage.getItem("client_session_token");
      if (clientToken) {
        router.replace("/(client-tabs)" as any);
      } else {
        router.replace("/profile-select" as any);
      }
    } catch {
      router.replace("/profile-select" as any);
    }
  }, [router]);
  const onLayoutRootView = useCallback(async () => {
    // Hide the native splash immediately — we use our own animated splash instead
    await SplashScreen.hideAsync();
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
    {/* Opaque blocking view that hides stale routes until splash finishes and routing completes.
        This prevents the "last page flash" on app open. Removed once splashDone = true. */}
    {!splashDone && (
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#0D2318", zIndex: 9998 }]}
        pointerEvents="none"
      />
    )}
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <StoreProvider>
            <LogoMigration />
            <ClientStoreProvider>
            <AppLockProvider splashDone={splashDone}>
            <NotificationProvider>
            {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
            {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
            {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="new-booking" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="calendar-booking" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="appointment-detail" options={{ presentation: "card" }} />
              <Stack.Screen name="client-detail" options={{ presentation: "card" }} />
              <Stack.Screen name="service-form" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="booking" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="onboarding" options={{ presentation: "card" }} />
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
              <Stack.Screen name="profile-select" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="client-signin" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="client-profile-onboarding" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="client-edit-profile" options={{ presentation: "modal", headerShown: false }} />
              <Stack.Screen name="client-notifications" options={{ presentation: "modal", headerShown: false }} />
              <Stack.Screen name="(client-tabs)" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="client-business-detail" options={{ presentation: "modal" }} />
              <Stack.Screen name="client-booking-wizard" options={{ presentation: "modal", headerShown: false }} />
              <Stack.Screen name="client-appointment-detail" options={{ presentation: "modal" }} />
              <Stack.Screen name="client-booking-confirmation" options={{ presentation: "modal" }} />
              <Stack.Screen name="client-message-thread" options={{ presentation: "modal" }} />
              <Stack.Screen name="client-saved-businesses" options={{ presentation: "modal" }} />
              <Stack.Screen name="client-message-thread-business" options={{ presentation: "modal" }} />
            </Stack>
            <StatusBar style="auto" />
            </NotificationProvider>
            </AppLockProvider>
            </ClientStoreProvider>
          </StoreProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
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
              {!splashDone && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <AnimatedSplash onFinish={handleSplashFinish} />
                </View>
              )}
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
        {!splashDone && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <AnimatedSplash onFinish={handleSplashFinish} />
          </View>
        )}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

// Wrap with Sentry for automatic crash reporting and performance monitoring.
// withSentryWrapper is a no-op when EXPO_PUBLIC_SENTRY_DSN is not set.
export default withSentryWrapper(RootLayout);
