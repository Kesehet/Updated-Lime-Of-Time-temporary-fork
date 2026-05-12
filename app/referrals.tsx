/**
 * Referrals Screen
 * - Shows the business owner's unique referral code
 * - Allows sharing via native share sheet or SMS
 * - Displays stats: total referred, converted, rewards earned
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Share,
  Linking,
  Platform,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Alert,
  Clipboard,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useStore } from "@/lib/store";

const REFERRAL_SHARE_URL = "https://lime-of-time.com";

export default function ReferralsScreen() {
  const colors = useColors();
  const { state } = useStore();
  const businessOwnerId = state.businessOwnerId;
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = trpc.referrals.getMyReferrals.useQuery(
    { businessOwnerId: businessOwnerId ?? 0 },
    { enabled: !!businessOwnerId },
  );

  const code = data?.code?.code ?? null;
  const bookingSlug = data?.bookingSlug ?? null;
  const totalReferred = data?.totalReferred ?? 0;
  const totalConverted = data?.totalConverted ?? 0;
  const totalRewarded = data?.totalRewarded ?? 0;

  // Build a booking URL with the ref= param so the badge shows on the booking page
  const bookingUrl = bookingSlug && code
    ? `https://lime-of-time.com/book/${bookingSlug}?ref=${encodeURIComponent(code)}`
    : REFERRAL_SHARE_URL;

  const shareMessage = code
    ? `Hey! I use Lime of Time to manage my business appointments. Sign up with my referral code ${code} and get 50% off your first 3 months!\n\nBook directly here: ${bookingUrl}`
    : "";

  async function handleShare() {
    if (!code) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    try {
      await Share.share({ message: shareMessage, title: "Get 50% off Lime of Time" });
    } catch {}
  }

  function handleSMS() {
    if (!code) return;
    const separator = Platform.OS === "ios" ? "&" : "?";
    const smsUrl = `sms:${separator}body=${encodeURIComponent(shareMessage)}`;
    Linking.openURL(smsUrl).catch(() =>
      Alert.alert("SMS not available", "Please use the Share button instead."),
    );
  }

  function handleCopyLink() {
    if (!bookingUrl) return;
    Clipboard.setString(bookingUrl);
    setCopied(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopy() {
    if (!code) return;
    Clipboard.setString(code);
    setCopied(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setTimeout(() => setCopied(false), 2000);
  }

  const ss = StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
    backBtn: { paddingRight: 12, paddingVertical: 4 },
    backTxt: { fontSize: 16, color: colors.primary },
    title: { fontSize: 20, fontWeight: "700", color: colors.foreground },
    body: { padding: 20, gap: 20 },
    heroCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: colors.border },
    heroLabel: { fontSize: 13, color: colors.muted, letterSpacing: 1, textTransform: "uppercase" },
    codeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    codeText: { fontSize: 34, fontWeight: "800", color: colors.primary, letterSpacing: 4 },
    copyBtn: { backgroundColor: colors.primary + "22", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
    copyBtnTxt: { fontSize: 13, fontWeight: "600", color: colors.primary },
    heroBadge: { backgroundColor: colors.success + "22", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
    heroBadgeTxt: { fontSize: 13, color: colors.success, fontWeight: "600" },
    heroDesc: { fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 20 },
    statsRow: { flexDirection: "row", gap: 12 },
    statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, alignItems: "center", gap: 4, borderWidth: 0.5, borderColor: colors.border },
    statNum: { fontSize: 28, fontWeight: "800", color: colors.foreground },
    statLabel: { fontSize: 11, color: colors.muted, textAlign: "center" },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.foreground, marginBottom: 4 },
    actionRow: { flexDirection: "row", gap: 12 },
    actionBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
    primaryBtn: { backgroundColor: colors.primary },
    secondaryBtn: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border },
    primaryBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff" },
    secondaryBtnTxt: { fontSize: 15, fontWeight: "600", color: colors.foreground },
    howCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 14, borderWidth: 0.5, borderColor: colors.border },
    howRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
    howNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center" },
    howNumTxt: { fontSize: 13, fontWeight: "700", color: colors.primary },
    howText: { flex: 1 },
    howTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    howDesc: { fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 2 },
    referralList: { gap: 10 },
    referralRow: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 0.5, borderColor: colors.border },
    referralDate: { fontSize: 12, color: colors.muted, marginTop: 2 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
    emptyTxt: { fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 20 },
  });

  function statusColor(status: string) {
    if (status === "rewarded") return colors.success;
    if (status === "converted") return colors.primary;
    if (status === "expired") return colors.error;
    return colors.warning;
  }

  function statusLabel(status: string) {
    if (status === "rewarded") return "Rewarded";
    if (status === "converted") return "Converted";
    if (status === "expired") return "Expired";
    return "Pending";
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backTxt}>{"< Back"}</Text>
        </TouchableOpacity>
        <Text style={ss.title}>{"Referrals"}</Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={ss.body} showsVerticalScrollIndicator={false}>
          {/* Referral Code Card */}
          <View style={ss.heroCard}>
            <Text style={ss.heroLabel}>{"Your Referral Code"}</Text>
            {code ? (
              <>
                <View style={ss.codeRow}>
                  <Text style={ss.codeText}>{code}</Text>
                  <TouchableOpacity style={ss.copyBtn} onPress={handleCopy}>
                    <Text style={ss.copyBtnTxt}>{copied ? "Copied!" : "Copy"}</Text>
                  </TouchableOpacity>
                </View>
                <View style={ss.heroBadge}>
                  <Text style={ss.heroBadgeTxt}>{"50% off for 3 months"}</Text>
                </View>
                <Text style={ss.heroDesc}>
                  {"Share this code with friends, family, or business partners. New users get 50% off their first 3 months, and you earn 1 free month when they convert."}
                </Text>
              </>
            ) : (
              <Text style={ss.heroDesc}>{"Generating your code..."}</Text>
            )}
          </View>

          {/* Stats */}
          <View style={ss.statsRow}>
            <View style={ss.statCard}>
              <Text style={ss.statNum}>{totalReferred}</Text>
              <Text style={ss.statLabel}>{"Referred"}</Text>
            </View>
            <View style={ss.statCard}>
              <Text style={ss.statNum}>{totalConverted}</Text>
              <Text style={ss.statLabel}>{"Converted"}</Text>
            </View>
            <View style={ss.statCard}>
              <Text style={[ss.statNum, { color: colors.success }]}>{totalRewarded}</Text>
              <Text style={ss.statLabel}>{"Free Months\nEarned"}</Text>
            </View>
          </View>

          {/* Share Actions */}
          {code && (
            <View>
              <Text style={ss.sectionTitle}>{"Share Your Code"}</Text>
              <View style={ss.actionRow}>
                <TouchableOpacity style={[ss.actionBtn, ss.primaryBtn]} onPress={handleShare}>
                  <Text style={ss.primaryBtnTxt}>{"Share"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ss.actionBtn, ss.secondaryBtn]} onPress={handleSMS}>
                  <Text style={ss.secondaryBtnTxt}>{"Send SMS"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* How It Works */}
          <View>
            <Text style={ss.sectionTitle}>{"How It Works"}</Text>
            <View style={ss.howCard}>
              {[
                { n: "1", title: "Share your code", desc: "Send your unique code to anyone who runs a service business." },
                { n: "2", title: "They sign up", desc: "New users enter your code during signup and start a 14-day free trial." },
                { n: "3", title: "They get 50% off", desc: "After the trial, they pay 50% off for their first 3 months automatically." },
                { n: "4", title: "You earn a free month", desc: "Once they complete their first paid month, 1 free month is added to your account." },
              ].map((step) => (
                <View key={step.n} style={ss.howRow}>
                  <View style={ss.howNum}>
                    <Text style={ss.howNumTxt}>{step.n}</Text>
                  </View>
                  <View style={ss.howText}>
                    <Text style={ss.howTitle}>{step.title}</Text>
                    <Text style={ss.howDesc}>{step.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Referral History */}
          <View>
            <Text style={ss.sectionTitle}>{"Referral History"}</Text>
            {data?.referrals && data.referrals.length > 0 ? (
              <View style={ss.referralList}>
                {data.referrals.map((ref, i) => (
                  <View key={ref.id ?? i} style={ss.referralRow}>
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                        {`Referral #${ref.id}`}
                      </Text>
                      <Text style={ss.referralDate}>
                        {ref.createdAt ? new Date(ref.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                      </Text>
                    </View>
                    <View style={[ss.statusBadge, { backgroundColor: statusColor(ref.status) + "22" }]}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: statusColor(ref.status) }}>
                        {statusLabel(ref.status)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={ss.emptyTxt}>{"No referrals yet. Share your code to get started!"}</Text>
            )}
          </View>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
