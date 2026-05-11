/**
 * Stripe Connect Return Screen
 *
 * This screen handles the deep link callback after a business owner completes
 * (or cancels) Stripe Connect onboarding. The server redirects to:
 *   manus20260406102824://stripe-connect/return?success=true&businessOwnerId=123
 *
 * When openAuthSessionAsync detects this deep link, it closes the in-app browser
 * and navigates here. We show a brief success message then navigate back.
 */
import { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ScreenContainer } from "@/components/screen-container";

// Required: complete the auth session so openAuthSessionAsync resolves
WebBrowser.maybeCompleteAuthSession();

export default function StripeConnectReturn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ success?: string; businessOwnerId?: string }>();

  useEffect(() => {
    // Navigate back after a short delay so the user sees the success state
    const timer = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/settings" as any);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [router]);

  const isSuccess = params.success === "true";

  return (
    <ScreenContainer>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
        <Text style={{ fontSize: 48 }}>{isSuccess ? "✅" : "↩️"}</Text>
        <Text style={{ fontSize: 20, fontWeight: "700", textAlign: "center" }}>
          {isSuccess ? "Stripe Connected!" : "Returning to app..."}
        </Text>
        {isSuccess && (
          <Text style={{ fontSize: 14, color: "#6b7280", textAlign: "center", lineHeight: 20 }}>
            Your Stripe account has been connected. You can now accept card payments from clients.
          </Text>
        )}
        <ActivityIndicator size="small" color="#635bff" style={{ marginTop: 8 }} />
      </View>
    </ScreenContainer>
  );
}
