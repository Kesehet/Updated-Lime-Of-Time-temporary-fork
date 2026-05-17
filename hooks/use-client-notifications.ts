/**
 * useClientNotifications
 *
 * Registers the client portal user for Expo push notifications and handles
 * notification taps to navigate to the correct screen.
 *
 * Events that trigger a push to the client:
 *  - Business confirms appointment  → navigate to client-appointment-detail
 *  - Business cancels appointment   → navigate to client-appointment-detail
 *  - Business marks completed       → navigate to client-appointment-detail (with review=1)
 *  - Business updates appointment   → navigate to client-appointment-detail
 *  - Gift card balance restored     → navigate to client-appointment-detail
 *  - Business sends a message       → navigate to client-message-thread
 *  - Local reminder (24h/1h/30m)    → navigate to client-appointment-detail
 *
 * Call this hook once inside the (client-tabs) layout so it runs for the
 * entire lifetime of the client portal session.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useClientStore } from "@/lib/client-store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerForClientPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("client-portal", {
        name: "Lime Of Time — Client Portal",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#8FBF6A",
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) return null;

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch {
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useClientNotifications() {
  const { state, apiCall } = useClientStore();
  const router = useRouter();
  const tokenRegisteredRef = useRef(false);
  const listenerSetupRef = useRef(false);

  // ── Register push token once when signed in ──────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!state.sessionToken || !state.account) return;
    if (tokenRegisteredRef.current) return;
    tokenRegisteredRef.current = true;

    registerForClientPushNotificationsAsync().then(async (token) => {
      if (!token) return;
      // Only save if different from what's already stored
      if (state.account?.expoPushToken === token) return;
      try {
        await apiCall("/api/client/profile", {
          method: "PATCH",
          body: JSON.stringify({ expoPushToken: token }),
        });
      } catch {
        // Silent — token will be registered on next session
      }
    });
  }, [state.sessionToken, state.account]);

  // ── Handle notification taps ─────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (listenerSetupRef.current) return;
    listenerSetupRef.current = true;

    // Set foreground notification handler
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        if (!data) return;

        const notifType = data.type as string;
        const appointmentId = data.appointmentId as string | undefined;
        const businessOwnerId = data.businessOwnerId as number | undefined;

        switch (notifType) {
          case "appointment_confirmed":
          case "appointment_cancelled":
            if (appointmentId) {
              router.push({
                pathname: "/client-appointment-detail",
                params: { id: appointmentId },
              } as any);
            } else {
              router.push("/(client-tabs)/bookings" as any);
            }
            break;
          case "appointment_completed":
            if (appointmentId) {
              // Pass review=1 so the detail screen auto-opens the review modal
              router.push({
                pathname: "/client-appointment-detail",
                params: { id: appointmentId, review: "1" },
              } as any);
            } else {
              router.push("/(client-tabs)/bookings" as any);
            }
            break;

          // Bug #2: business updated appointment details (travel fee, time, etc.)
          case "appointment_updated":
            if (appointmentId) {
              router.push({
                pathname: "/client-appointment-detail",
                params: { id: appointmentId },
              } as any);
            } else {
              router.push("/(client-tabs)/bookings" as any);
            }
            break;

          // Bug #2: gift card balance was restored after a cancellation
          case "gift_restored":
            if (appointmentId) {
              router.push({
                pathname: "/client-appointment-detail",
                params: { id: appointmentId },
              } as any);
            } else {
              router.push("/(client-tabs)" as any);
            }
            break;

          case "business_message":
            if (businessOwnerId) {
              router.push({
                pathname: "/client-message-thread",
                params: { businessOwnerId: String(businessOwnerId) },
              } as any);
            } else {
              router.push("/(client-tabs)/messages" as any);
            }
            break;

          // Bug #4: local reminder notifications scheduled by the client app
          case "reminder_24h":
          case "reminder_1h":
          case "reminder_30m":
            if (appointmentId) {
              router.push({
                pathname: "/client-appointment-detail",
                params: { id: appointmentId },
              } as any);
            } else {
              router.push("/(client-tabs)/bookings" as any);
            }
            break;

          default:
            router.push("/(client-tabs)" as any);
            break;
        }
      }
    );

    return () => {
      responseSubscription.remove();
    };
  }, [router]);
}
