/**
 * PaymentReceiptModal
 *
 * A bottom-sheet modal shown after a successful card payment.
 * Displays: confirmation number, service name, client name, amount charged,
 * card brand + last 4 digits, and date/time of payment.
 *
 * Usage:
 * ```tsx
 * <PaymentReceiptModal
 *   visible={showReceipt}
 *   onDone={() => { setShowReceipt(false); router.replace(...); }}
 *   amount={125.00}
 *   serviceName="Haircut & Style"
 *   clientName="Jane Smith"
 *   cardLast4="4242"
 *   cardBrand="visa"
 *   confirmationId="APT-abc123"
 * />
 * ```
 */
import React, { useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";

// ─── Card brand logo helpers ──────────────────────────────────────────────────
function getCardBrandLabel(brand: string): string {
  const b = brand.toLowerCase();
  if (b === "visa") return "Visa";
  if (b === "mastercard") return "Mastercard";
  if (b === "amex" || b === "american_express") return "Amex";
  if (b === "discover") return "Discover";
  if (b === "jcb") return "JCB";
  if (b === "unionpay") return "UnionPay";
  if (b === "diners" || b === "diners_club") return "Diners";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function getCardBrandColor(brand: string): string {
  const b = brand.toLowerCase();
  if (b === "visa") return "#1A1F71";
  if (b === "mastercard") return "#EB001B";
  if (b === "amex" || b === "american_express") return "#007BC1";
  if (b === "discover") return "#FF6600";
  return "#4A7C59";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface PaymentReceiptModalProps {
  visible: boolean;
  onDone: () => void;
  /** Amount charged in dollars (e.g. 125.00) */
  amount: number;
  serviceName?: string;
  clientName?: string;
  /** Last 4 digits of the card */
  cardLast4?: string;
  /** Card brand string from Stripe (e.g. "visa", "mastercard") */
  cardBrand?: string;
  /** Confirmation ID — typically the appointment localId */
  confirmationId?: string;
  /** Optional: date/time of payment. Defaults to now. */
  paidAt?: Date;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function PaymentReceiptModal({
  visible,
  onDone,
  amount,
  serviceName,
  clientName,
  cardLast4,
  cardBrand,
  confirmationId,
  paidAt,
}: PaymentReceiptModalProps) {
  const colors = useColors();

  // Entrance animation
  const translateY = useSharedValue(120);
  const opacity = useSharedValue(0);
  const checkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      opacity.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      translateY.value = withSpring(0, { damping: 18, stiffness: 160 });
      setTimeout(() => {
        checkScale.value = withSpring(1, { damping: 12, stiffness: 220 });
      }, 120);
    } else {
      opacity.value = 0;
      translateY.value = 120;
      checkScale.value = 0;
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const brandLabel = cardBrand ? getCardBrandLabel(cardBrand) : "Card";
  const brandColor = cardBrand ? getCardBrandColor(cardBrand) : "#4A7C59";
  const paymentDate = paidAt ?? new Date();
  const shortId = confirmationId
    ? confirmationId.slice(-8).toUpperCase()
    : Math.random().toString(36).slice(-8).toUpperCase();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDone}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]} />

      {/* Sheet */}
      <View style={styles.sheetContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface },
            sheetStyle,
          ]}
        >
          {/* Drag handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Success circle */}
          <View style={styles.iconRow}>
            <View style={[styles.successRing, { borderColor: "#4A7C5930" }]}>
              <Animated.View style={[styles.successCircle, checkStyle]}>
                <Text style={styles.checkmark}>✓</Text>
              </Animated.View>
            </View>
          </View>

          {/* Headline */}
          <Text style={[styles.headline, { color: colors.foreground }]}>
            Payment Successful
          </Text>
          <Text style={[styles.amount, { color: "#4A7C59" }]}>
            {formatCurrency(amount)}
          </Text>

          {/* Receipt card */}
          <View style={[styles.receiptCard, { backgroundColor: colors.surfaceAlt ?? colors.background, borderColor: colors.border }]}>
            {/* Dashed divider line */}
            <View style={[styles.dashedTop, { borderColor: colors.border }]} />

            {serviceName ? (
              <ReceiptRow label="Service" value={serviceName} colors={colors} />
            ) : null}
            {clientName ? (
              <ReceiptRow label="Client" value={clientName} colors={colors} />
            ) : null}
            <ReceiptRow
              label="Card"
              value={
                cardLast4
                  ? `${brandLabel} ••••\u00a0${cardLast4}`
                  : `${brandLabel} (Stripe)`
              }
              valueColor={brandColor}
              colors={colors}
            />
            <ReceiptRow
              label="Date"
              value={formatDateTime(paymentDate)}
              colors={colors}
            />
            <ReceiptRow
              label="Confirmation"
              value={`#${shortId}`}
              colors={colors}
              last
              mono
            />

            {/* Dashed divider line */}
            <View style={[styles.dashedBottom, { borderColor: colors.border }]} />
          </View>

          {/* Done button */}
          <Pressable
            onPress={onDone}
            style={({ pressed }) => [
              styles.doneBtn,
              { backgroundColor: "#4A7C59", opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>

          {/* Subtle note */}
          <Text style={[styles.note, { color: colors.muted }]}>
            A receipt has been recorded for this transaction.
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Receipt row ──────────────────────────────────────────────────────────────
function ReceiptRow({
  label,
  value,
  valueColor,
  colors,
  last = false,
  mono = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
  mono?: boolean;
}) {
  return (
    <View
      style={[
        styles.receiptRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Text style={[styles.receiptLabel, { color: colors.muted }]}>{label}</Text>
      <Text
        style={[
          styles.receiptValue,
          { color: valueColor ?? colors.foreground },
          mono && styles.receiptValueMono,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.52)",
  },
  sheetContainer: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 12,
    alignItems: "center",
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  iconRow: {
    marginBottom: 16,
  },
  successRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(74,124,89,0.10)",
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#4A7C59",
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    fontSize: 30,
    color: "#FFFFFF",
    fontWeight: "700",
    lineHeight: 36,
  },
  headline: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  amount: {
    fontSize: 36,
    fontWeight: "900",
    marginBottom: 24,
    letterSpacing: -1,
  },
  receiptCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 24,
  },
  dashedTop: {
    borderTopWidth: 1,
    borderStyle: "dashed",
    marginHorizontal: 16,
    marginBottom: 4,
  },
  dashedBottom: {
    borderBottomWidth: 1,
    borderStyle: "dashed",
    marginHorizontal: 16,
    marginTop: 4,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  receiptLabel: {
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 0,
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
  },
  receiptValueMono: {
    fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
    letterSpacing: 0.5,
  },
  doneBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  doneBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  note: {
    fontSize: 12,
    textAlign: "center",
    opacity: 0.7,
  },
});
