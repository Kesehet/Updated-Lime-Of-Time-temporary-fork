/**
 * payment-success.tsx
 *
 * Deep-link handler screen for Stripe Checkout success redirects.
 *
 * Stripe redirects to: manus20260406102824://payment-success?appt=APPT_ID&boid=OWNER_ID
 *
 * This screen:
 * 1. Shows a brief "Payment confirmed" animation
 * 2. Triggers an immediate payment status check via the server
 * 3. Navigates to the appropriate appointment detail screen
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "@/lib/store";
import { useClientStore } from "@/lib/client-store";
import { apiCall } from "@/lib/_core/api";

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appt?: string; boid?: string; type?: string }>();
  const { state: bizState } = useStore();
  const { state: clientState } = useClientStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const apptId = params.appt;
    const boid = params.boid ? parseInt(params.boid, 10) : null;

    if (!apptId || !boid) {
      // Fallback: just go home
      router.replace("/");
      return;
    }

    // Determine if this is the business owner or a client
    const isBusinessOwner = bizState.businessOwnerId === boid;

    // Trigger an immediate payment status check on the server
    const checkAndNavigate = async () => {
      try {
        await apiCall(`/api/stripe-connect/appointment-payment-status?businessOwnerId=${boid}&appointmentLocalId=${encodeURIComponent(apptId)}`, {
          method: "GET",
        });
      } catch {
        // Ignore errors — the webhook will update the status regardless
      }

      // Navigate to the appointment detail screen
      if (isBusinessOwner) {
        router.replace({ pathname: "/appointment-detail", params: { id: apptId } });
      } else {
        router.replace({ pathname: "/client-appointment-detail", params: { apptId, businessOwnerId: String(boid) } });
      }
    };

    // Small delay so the "Payment confirmed" text is visible briefly
    const timer = setTimeout(checkAndNavigate, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.checkmark}>✓</Text>
        <Text style={styles.title}>Payment Confirmed</Text>
        <Text style={styles.subtitle}>Returning to your appointment…</Text>
        <ActivityIndicator color="#8FBF6A" style={styles.spinner} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1a0d",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#1a2e1a",
    borderRadius: 20,
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2d4a2d",
    minWidth: 260,
  },
  checkmark: {
    fontSize: 56,
    color: "#8FBF6A",
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ECEDEE",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#9BA1A6",
    textAlign: "center",
    marginBottom: 24,
  },
  spinner: {
    marginTop: 4,
  },
});
