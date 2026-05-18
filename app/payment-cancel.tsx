/**
 * payment-cancel.tsx
 *
 * Deep-link handler screen for Stripe Checkout cancel redirects.
 *
 * Stripe redirects to: manus20260406102824://payment-cancel?appt=APPT_ID&boid=OWNER_ID
 *
 * This screen shows a brief "Payment cancelled" message then navigates back.
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "@/lib/store";

export default function PaymentCancelScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appt?: string; boid?: string }>();
  const { state: bizState } = useStore();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const apptId = params.appt;
    const boid = params.boid ? parseInt(params.boid, 10) : null;

    const navigate = () => {
      if (!apptId || !boid) {
        router.replace("/");
        return;
      }
      const isBusinessOwner = bizState.businessOwnerId === boid;
      if (isBusinessOwner) {
        router.replace({ pathname: "/appointment-detail", params: { id: apptId } });
      } else {
        router.replace({ pathname: "/client-appointment-detail", params: { apptId, businessOwnerId: String(boid) } });
      }
    };

    const timer = setTimeout(navigate, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>✕</Text>
        <Text style={styles.title}>Payment Cancelled</Text>
        <Text style={styles.subtitle}>Returning to your appointment…</Text>
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
  icon: {
    fontSize: 48,
    color: "#F87171",
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
  },
});
