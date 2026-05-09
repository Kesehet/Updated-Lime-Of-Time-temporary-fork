import { useState, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { getServiceDisplayName } from "@/lib/types";
import { useResponsive } from "@/hooks/use-responsive";

/**
 * Public route: /gift/[code]
 * 
 * This route handles the public gift card URL format:
 *   https://lime-of-time.com/gift/GIFT-XXXX
 * 
 * Clients can view gift card details and navigate to booking.
 */
export default function GiftCodeScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { state, getServiceById } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();

  const giftCard = useMemo(() => {
    return state.giftCards.find((g) => g.code === code);
  }, [state.giftCards, code]);

  const service = giftCard ? getServiceById(giftCard.serviceLocalId) : null;

  if (!giftCard) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={640}>
        <View style={[styles.centered, { backgroundColor: colors.background, paddingHorizontal: hp }]}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🎁</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Gift Card Not Found</Text>
          <Text style={[styles.subtitle, { color: colors.muted, marginTop: 8 }]}>
            This gift card code is invalid or has expired. Please check the code and try again.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const isExpired = giftCard.expiresAt && new Date(giftCard.expiresAt) < new Date();
  const isRedeemed = giftCard.redeemed;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingHorizontal: hp, paddingVertical: 24 }}
      >
        {/* Header */}
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Text style={{ fontSize: 48, marginBottom: 8 }}>🎁</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {state.settings.businessName}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted, marginTop: 4 }]}>
            Gift Card
          </Text>
        </View>

        {/* Gift Card Details */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            {service ? getServiceDisplayName(service) : "Service"}
          </Text>

          {giftCard.recipientName ? (
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.muted }]}>For:</Text>
              <Text style={[styles.rowValue, { color: colors.foreground }]}>{giftCard.recipientName}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.muted }]}>Code:</Text>
            <Text style={[styles.rowValue, { color: colors.primary, fontWeight: "700" }]}>{giftCard.code}</Text>
          </View>

          {service ? (
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.muted }]}>Value:</Text>
              <Text style={[styles.rowValue, { color: colors.foreground }]}>${service.price.toFixed(2)}</Text>
            </View>
          ) : null}

          {giftCard.expiresAt ? (
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.muted }]}>Expires:</Text>
              <Text style={[styles.rowValue, { color: isExpired ? colors.error : colors.foreground }]}>
                {new Date(giftCard.expiresAt).toLocaleDateString()}
              </Text>
            </View>
          ) : null}

          {giftCard.message ? (
            <View style={[styles.messageBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ color: colors.muted, fontSize: fs.xs, marginBottom: 4 }}>Personal Message:</Text>
              <Text style={{ color: colors.foreground, fontSize: fs.sm, fontStyle: "italic", lineHeight: 20 }}>
                "{giftCard.message}"
              </Text>
            </View>
          ) : null}

          {/* Status */}
          <View style={[styles.statusBadge, {
            backgroundColor: isRedeemed
              ? colors.muted + "20"
              : isExpired
              ? colors.error + "20"
              : colors.success + "20",
          }]}>
            <Text style={{
              fontSize: fs.sm,
              fontWeight: "600",
              color: isRedeemed ? colors.muted : isExpired ? colors.error : colors.success,
            }}>
              {isRedeemed ? "Already Redeemed" : isExpired ? "Expired" : "Valid — Ready to Use"}
            </Text>
          </View>
        </View>

        {/* Book Now Button */}
        {!isRedeemed && !isExpired ? (
          <Pressable
            onPress={() => router.push("/booking")}
            style={({ pressed }) => [
              styles.bookBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={[styles.bookBtnText, { color: "#fff" }]}>Book Now with This Gift Card</Text>
          </Pressable>
        ) : null}

        <Text style={{ textAlign: "center", color: colors.muted, fontSize: fs.xs, marginTop: 24 }}>
          Powered by Lime Of Time
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 13, textAlign: "center" },
  card: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: 13 },
  rowValue: { fontSize: 13, fontWeight: "500" },
  messageBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  statusBadge: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    marginTop: 4,
  },
  bookBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    minHeight: 52,
  },
  bookBtnText: { fontSize: 15, fontWeight: "700" },
});
