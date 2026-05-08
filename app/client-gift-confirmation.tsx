/**
 * Client Portal — Gift Card Confirmation
 *
 * Shown after a successful gift card purchase.
 * Displays the gift code, share link, and summary.
 */
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Share,
  Platform,
  ScrollView,
  Animated,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";

// ─── Portal palette ───────────────────────────────────────────────────────────
const GREEN_DARK   = "#1A3A28";
const GREEN_ACCENT = "#8FBF6A";
const LIME         = "#4A7C59";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED   = "rgba(255,255,255,0.60)";
const CARD_BG      = "rgba(255,255,255,0.07)";
const CARD_BORDER  = "rgba(255,255,255,0.12)";

export default function ClientGiftConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    giftCode,
    shareLink,
    totalValue,
    recipientName,
    businessName,
    businessSlug,
    paymentMethod,
    bannerImageUri,
  } = useLocalSearchParams<{
    giftCode: string;
    shareLink: string;
    totalValue: string;
    recipientName: string;
    businessName: string;
    businessSlug: string;
    paymentMethod: string;
    bannerImageUri?: string;
  }>();

  // ── Entrance animation ─────────────────────────────────────────────────────
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 120 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `🎁 You've received a gift from ${businessName}! Redeem here: ${shareLink}`,
        url: shareLink,
        title: `Gift from ${businessName}`,
      });
    } catch {}
  };

  const handleCopyCode = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(giftCode ?? "");
  };

  const paymentLabel = (() => {
    switch (paymentMethod) {
      case "zelle": return "Zelle";
      case "venmo": return "Venmo";
      case "cashapp": return "Cash App";
      default: return "Cash (in person)";
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Top spacing for status bar */}
        <View style={{ height: insets.top + 16 }} />

        {/* Banner image (if provided) */}
        {bannerImageUri ? (
          <Animated.View style={{ opacity: opacityAnim, marginBottom: 20 }}>
            <Image
              source={{ uri: bannerImageUri }}
              style={{ width: "100%", height: 160, borderRadius: 16 }}
              resizeMode="cover"
            />
          </Animated.View>
        ) : (
          /* Success icon (fallback when no banner) */
          <Animated.View style={[s.iconWrap, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
            <Text style={{ fontSize: 52 }}>🎁</Text>
          </Animated.View>
        )}

        <Text style={s.headline}>Gift Purchased!</Text>
        {recipientName ? (
          <Text style={s.subline}>Your gift for {recipientName} has been created.</Text>
        ) : (
          <Text style={s.subline}>Your gift has been created successfully.</Text>
        )}

        {/* Gift code card */}
        {giftCode ? (
          <View style={s.codeCard}>
            <Text style={s.codeLabel}>GIFT CODE</Text>
            <Text style={s.codeValue}>{giftCode}</Text>
            <Pressable
              style={({ pressed }) => [s.copyBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={handleCopyCode}
            >
              <IconSymbol name="doc.on.doc.fill" size={14} color={GREEN_ACCENT} />
              <Text style={s.copyBtnText}>Copy Code</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Summary card */}
        <View style={s.summaryCard}>
          {totalValue ? (
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Gift Value</Text>
              <Text style={s.summaryValue}>${parseFloat(totalValue).toFixed(2)}</Text>
            </View>
          ) : null}
          {businessName ? (
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Business</Text>
              <Text style={s.summaryValue}>{businessName}</Text>
            </View>
          ) : null}
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Payment</Text>
            <Text style={s.summaryValue}>{paymentLabel}</Text>
          </View>
        </View>

        {/* Payment reminder */}
        {paymentMethod !== "cash" && (
          <View style={s.reminderCard}>
            <Text style={{ fontSize: 18 }}>⚠️</Text>
            <Text style={s.reminderText}>
              Remember to send your {paymentLabel} payment to the business to activate this gift card.
            </Text>
          </View>
        )}

        {/* Share button */}
        {shareLink ? (
          <Pressable
            style={({ pressed }) => [s.shareBtn, { opacity: pressed ? 0.85 : 1, transform: pressed ? [{ scale: 0.97 }] : [] }]}
            onPress={handleShare}
          >
            <IconSymbol name="square.and.arrow.up" size={18} color="#fff" />
            <Text style={s.shareBtnText}>Share Gift Link</Text>
          </Pressable>
        ) : null}

        {/* Done button */}
        <Pressable
          style={({ pressed }) => [s.doneBtn, { opacity: pressed ? 0.85 : 1, transform: pressed ? [{ scale: 0.97 }] : [] }]}
          onPress={() => router.replace("/(client-tabs)/discover" as any)}
        >
          <Text style={s.doneBtnText}>Back to Discover</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  iconWrap: {
    alignSelf: "center",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: `${LIME}30`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: `${LIME}60`,
  },
  headline: {
    color: TEXT_PRIMARY,
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 6,
  },
  subline: {
    color: TEXT_MUTED,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  codeCard: {
    backgroundColor: `${LIME}20`,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: `${LIME}50`,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  codeLabel: {
    color: GREEN_ACCENT,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  codeValue: {
    color: TEXT_PRIMARY,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginTop: 4,
  },
  copyBtnText: {
    color: GREEN_ACCENT,
    fontSize: 13,
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: { color: TEXT_MUTED, fontSize: 14 },
  summaryValue: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right", marginLeft: 12 },
  reminderCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(251,191,36,0.10)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
    padding: 14,
    gap: 10,
    marginBottom: 20,
  },
  reminderText: {
    color: "rgba(251,191,36,0.90)",
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  shareBtn: {
    backgroundColor: LIME,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 12,
  },
  shareBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  doneBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  doneBtnText: { color: TEXT_MUTED, fontSize: 15, fontWeight: "600" },
});
