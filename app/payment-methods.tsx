import { useState, useCallback, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FuturisticBackground } from "@/components/futuristic-background";
import { apiCall } from "@/lib/_core/api";
import * as WebBrowser from "expo-web-browser";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";

type ConnectStatus = {
  connected: boolean;
  chargesEnabled: boolean;
  onboardingComplete: boolean;
  accountId: string | null;
  stripeConfigured: boolean;
};

type PayoutInfo = {
  id: string;
  amount: number;
  currency: string;
  arrivalDate: number;
  status: string;
  description: string | null;
};

type PayoutData = {
  schedule: {
    interval: string;
    weeklyAnchor: string | null;
    monthlyAnchor: number | null;
    delayDays: number | null;
  } | null;
  nextPayout: PayoutInfo | null;
  recentPayouts: PayoutInfo[];
};

type BalanceEntry = { amount: number; currency: string };
type StripeBalance = { available: BalanceEntry[]; pending: BalanceEntry[] };

// ── Stripe Setup Guide Component ─────────────────────────────────────────────
type StripeSetupGuideProps = {
  colors: ReturnType<typeof useColors>;
  onConnect: () => void;
  connectLoading: boolean;
};

function StripeSetupGuide({ colors, onConnect, connectLoading }: StripeSetupGuideProps) {
  const [expanded, setExpanded] = useState(false);

  const steps = [
    {
      num: "1",
      title: "Create a free Stripe account",
      desc: "Go to stripe.com and sign up for free. No monthly fees — Stripe only charges a small fee per transaction (2.9% + 30¢).",
      icon: "🌐",
    },
    {
      num: "2",
      title: "Verify your identity",
      desc: "Stripe will ask for your name, date of birth, and the last 4 digits of your SSN. This is required by law to send money to your bank.",
      icon: "🪪",
    },
    {
      num: "3",
      title: "Add your bank account",
      desc: "Enter your bank routing and account numbers so Stripe can deposit your earnings directly to your bank (usually within 2 business days).",
      icon: "🏦",
    },
    {
      num: "4",
      title: "Tap \"Connect with Stripe\" below",
      desc: "After your Stripe account is ready, tap the button below. You'll be guided through a quick 2-minute connection process.",
      icon: "✅",
    },
  ];

  return (
    <View style={{ marginBottom: 4 }}>
      {/* Collapsible guide toggle */}
      <TouchableOpacity
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: "#635bff15",
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "#635bff30",
          marginBottom: expanded ? 12 : 16,
        }}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 16 }}>📖</Text>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: "#635bff" }}>
          How to set up Stripe (step-by-step guide)
        </Text>
        <Text style={{ fontSize: 14, color: "#635bff" }}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {expanded && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 14,
            marginBottom: 16,
            gap: 14,
          }}
        >
          {/* What is Stripe */}
          <View style={{ backgroundColor: "#635bff10", borderRadius: 8, padding: 12, borderLeftWidth: 3, borderLeftColor: "#635bff" }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#635bff", marginBottom: 4 }}>💡 What is Stripe?</Text>
            <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>
              Stripe is a trusted payment service used by millions of businesses worldwide (including Amazon, Shopify, and Lyft). It lets your clients pay by credit card, debit card, Apple Pay, or Google Pay — and deposits the money directly into your bank account. It's completely free to sign up.
            </Text>
          </View>

          {/* Steps */}
          {steps.map((step) => (
            <View key={step.num} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: "#635bff",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{step.num}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <Text style={{ fontSize: 14 }}>{step.icon}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{step.title}</Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>{step.desc}</Text>
              </View>
            </View>
          ))}

          {/* Reassurance */}
          <View style={{ backgroundColor: "#f0fdf4", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#bbf7d0" }}>
            <Text style={{ fontSize: 12, color: "#15803d", lineHeight: 17 }}>
              🔒 <Text style={{ fontWeight: "700" }}>Your money is safe.</Text> Stripe is PCI-compliant and used by millions of businesses. You own your Stripe account — we never touch your funds.
            </Text>
          </View>
        </View>
      )}

      {/* Connect button */}
      <TouchableOpacity
        style={[guideStyles.stripeBtn, { backgroundColor: "#635bff" }]}
        onPress={onConnect}
        disabled={connectLoading}
        activeOpacity={0.8}
      >
        {connectLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={guideStyles.stripeBtnText}>Connect with Stripe →</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const guideStyles = StyleSheet.create({
  stripeBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 8,
  },
  stripeBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function PaymentMethodsScreen() {
  const { state } = useStore();
  const colors = useColors();
  const router = useRouter();
  const settings = state.settings;
  const businessOwnerId = state.businessOwnerId;
  const { planInfo } = usePlanLimitCheck();
  // Use paymentLevel from admin panel plan config ("full" = Stripe Connect enabled)
  // Falls back to checking plan key for backward compatibility
  const isStripePlan = planInfo && (
    (planInfo as any).limits?.paymentLevel === "full" ||
    planInfo.planKey === "studio" ||
    planInfo.planKey === "enterprise"
  );

  // Stripe Connect state
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectStatusLoading, setConnectStatusLoading] = useState(true);

  // Payout schedule state
  const [payoutData, setPayoutData] = useState<PayoutData | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);

  // Balance state
  const [balanceData, setBalanceData] = useState<StripeBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);

  const loadConnectStatus = useCallback(async () => {
    if (!businessOwnerId) return;
    setConnectStatusLoading(true);
    try {
      const data = await apiCall<ConnectStatus>(
        `/api/stripe-connect/status?businessOwnerId=${businessOwnerId}`
      );
      setConnectStatus(data);
    } catch {
      setConnectStatus(null);
    } finally {
      setConnectStatusLoading(false);
    }
  }, [businessOwnerId]);

  const loadPayoutData = useCallback(async () => {
    if (!businessOwnerId) return;
    setPayoutLoading(true);
    try {
      const data = await apiCall<PayoutData>(
        `/api/stripe-connect/payouts?businessOwnerId=${businessOwnerId}`
      );
      setPayoutData(data);
    } catch {
      setPayoutData(null);
    } finally {
      setPayoutLoading(false);
    }
  }, [businessOwnerId]);

  const loadBalanceData = useCallback(async () => {
    if (!businessOwnerId) return;
    setBalanceLoading(true);
    try {
      const data = await apiCall<StripeBalance>(
        `/api/stripe-connect/balance?businessOwnerId=${businessOwnerId}`
      );
      setBalanceData(data);
    } catch {
      setBalanceData(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [businessOwnerId]);

  useEffect(() => {
    loadConnectStatus();
  }, [loadConnectStatus]);

  useEffect(() => {
    if (connectStatus?.chargesEnabled) {
      loadPayoutData();
      loadBalanceData();
    }
  }, [connectStatus?.chargesEnabled, loadPayoutData, loadBalanceData]);

  // Pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadConnectStatus();
      if (connectStatus?.chargesEnabled) {
        await Promise.all([loadPayoutData(), loadBalanceData()]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [loadConnectStatus, loadPayoutData, loadBalanceData, connectStatus?.chargesEnabled]);

  const handleConnectStripe = useCallback(async () => {
    if (!businessOwnerId) return;
    setConnectLoading(true);
    try {
      const data = await apiCall<{ url: string }>("/api/stripe-connect/onboard", {
        method: "POST",
        body: JSON.stringify({ businessOwnerId }),
      });
      if (data.url) {
        // Use openAuthSessionAsync so the in-app browser auto-closes when Stripe
        // redirects back to our app deep link (manus20260406102824://stripe-connect/return)
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          "manus20260406102824://"
        );
        // Refresh status regardless of result type (success, cancel, dismiss)
        // The server already updated the DB when the return URL was hit
        await loadConnectStatus();
        if (result.type === "success") {
          // Deep link was followed — connection likely complete
          Alert.alert("Stripe Connected!", "Your Stripe account has been connected. You can now accept card payments from clients.");
        }
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Failed to start Stripe onboarding");
    } finally {
      setConnectLoading(false);
    }
  }, [businessOwnerId, loadConnectStatus]);

  const handleOpenDashboard = useCallback(async () => {
    if (!businessOwnerId) return;
    setConnectLoading(true);
    try {
      const data = await apiCall<{ url: string }>("/api/stripe-connect/dashboard-link", {
        method: "POST",
        body: JSON.stringify({ businessOwnerId }),
      });
      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Failed to open Stripe dashboard");
    } finally {
      setConnectLoading(false);
    }
  }, [businessOwnerId]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      "Disconnect Stripe",
      "Are you sure you want to disconnect your Stripe account? Clients will no longer be able to pay by card.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await apiCall("/api/admin/stripe-connect/disconnect", {
                method: "POST",
                body: JSON.stringify({ businessOwnerId }),
              });
              await loadConnectStatus();
            } catch (err: any) {
              Alert.alert("Error", err?.message ?? "Failed to disconnect");
            }
          },
        },
      ]
    );
  }, [businessOwnerId, loadConnectStatus]);

  const renderConnectBadge = () => {
    if (!connectStatus) return null;
    if (!connectStatus.stripeConfigured) {
      return (
        <View style={[styles.badge, { backgroundColor: "#f59e0b20" }]}>
          <Text style={[styles.badgeText, { color: "#f59e0b" }]}>⚠ Not Configured</Text>
        </View>
      );
    }
    if (!connectStatus.connected) {
      return (
        <View style={[styles.badge, { backgroundColor: "#6b728020" }]}>
          <Text style={[styles.badgeText, { color: "#6b7280" }]}>Not Connected</Text>
        </View>
      );
    }
    if (connectStatus.chargesEnabled) {
      return (
        <View style={[styles.badge, { backgroundColor: "#22c55e20" }]}>
          <Text style={[styles.badgeText, { color: "#16a34a" }]}>✓ Active</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, { backgroundColor: "#f59e0b20" }]}>
        <Text style={[styles.badgeText, { color: "#f59e0b" }]}>Pending Verification</Text>
      </View>
    );
  };

  // Helper: payment method row data
  const zelleHandle = settings.zelleHandle?.trim() ?? "";
  const cashAppHandle = settings.cashAppHandle?.trim() ?? "";
  const venmoHandle = settings.venmoHandle?.trim() ?? "";

  const methods = [
    {
      key: "zelle",
      label: "Zelle",
      icon: "Z",
      color: "#6C1D45",
      handle: zelleHandle,
      placeholder: "Phone or email",
      route: "/payment-method-zelle" as const,
    },
    {
      key: "cashapp",
      label: "Cash App",
      icon: "$",
      color: "#00C244",
      handle: cashAppHandle ? (cashAppHandle.startsWith("$") ? cashAppHandle : `$${cashAppHandle}`) : "",
      placeholder: "$Cashtag",
      route: "/payment-method-cashapp" as const,
    },
    {
      key: "venmo",
      label: "Venmo",
      icon: "V",
      color: "#3D95CE",
      handle: venmoHandle ? (venmoHandle.startsWith("@") ? venmoHandle : `@${venmoHandle}`) : "",
      placeholder: "@Username",
      route: "/payment-method-venmo" as const,
    },
  ];

  return (
    <ScreenContainer>
      <FuturisticBackground />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Payment Methods</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* ── Stripe Connect Section ── */}
        {!isStripePlan && planInfo && (
          <View style={[styles.stripeCard, { backgroundColor: "#635bff12", borderColor: "#635bff40" }]}>
            <View style={styles.stripeHeader}>
              <View style={styles.stripeTitleRow}>
                <Text style={styles.stripeIcon}>💳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stripeTitle, { color: colors.foreground }]}>Accept Card Payments</Text>
                  <Text style={[styles.stripeSubtitle, { color: colors.muted }]}>Powered by Stripe Connect</Text>
                </View>
              </View>
              <View style={{ backgroundColor: "#f59e0b20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: "#f59e0b" }}>🔒 Studio+</Text>
              </View>
            </View>
            <Text style={[styles.stripeNote, { color: colors.muted }]}>
              Card payments via Stripe are available on the Studio plan ($39/mo) and above. Upgrade to accept Visa, Mastercard, Apple Pay, and Google Pay directly on your booking page.
            </Text>
            <TouchableOpacity
              style={[styles.stripeBtn, { backgroundColor: "#f59e0b" }]}
              onPress={() => router.push("/subscription")}
              activeOpacity={0.8}
            >
              <Text style={styles.stripeBtnText}>Upgrade to Studio →</Text>
            </TouchableOpacity>
          </View>
        )}
        {isStripePlan && (
        <View style={[styles.stripeCard, { backgroundColor: "#635bff12", borderColor: "#635bff40" }]}>
          <View style={styles.stripeHeader}>
            <View style={styles.stripeTitleRow}>
              <Text style={styles.stripeIcon}>💳</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stripeTitle, { color: colors.foreground }]}>Accept Card Payments</Text>
                <Text style={[styles.stripeSubtitle, { color: colors.muted }]}>
                  Powered by Stripe Connect · 1.5% platform fee
                </Text>
              </View>
            </View>
            {connectStatusLoading ? (
              <ActivityIndicator size="small" color="#635bff" />
            ) : (
              renderConnectBadge()
            )}
          </View>

          {!connectStatusLoading && connectStatus && (
            <>
              {!connectStatus.stripeConfigured && (
                <Text style={[styles.stripeNote, { color: colors.muted }]}>
                  Stripe is not configured yet. Ask your platform admin to add the Stripe Secret Key in Platform Config.
                </Text>
              )}

              {connectStatus.stripeConfigured && !connectStatus.connected && (
                <>
                  <Text style={[styles.stripeNote, { color: colors.muted }]}>
                    Connect your Stripe account to let clients pay by card (Visa, Mastercard, Apple Pay, Google Pay) when booking. Funds go directly to your bank.
                  </Text>

                  {/* Step-by-step Stripe setup guide */}
                  <StripeSetupGuide colors={colors} onConnect={handleConnectStripe} connectLoading={connectLoading} />
                </>
              )}

              {connectStatus.connected && !connectStatus.chargesEnabled && (
                <>
                  <Text style={[styles.stripeNote, { color: "#f59e0b" }]}>
                    Your Stripe account is connected but not fully verified yet. Complete the onboarding to start accepting card payments.
                  </Text>
                  <TouchableOpacity
                    style={[styles.stripeBtn, { backgroundColor: "#f59e0b" }]}
                    onPress={handleConnectStripe}
                    disabled={connectLoading}
                    activeOpacity={0.8}
                  >
                    {connectLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.stripeBtnText}>Complete Onboarding →</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {connectStatus.chargesEnabled && (
                <>
                  <Text style={[styles.stripeNote, { color: "#16a34a" }]}>
                    Your Stripe account is active. Clients can now pay by card on the booking page.
                  </Text>

                  {/* Account Balance Section */}
                  <View style={[styles.payoutSection, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={styles.payoutSectionHeader}>
                      <Text style={[styles.payoutSectionTitle, { color: colors.foreground }]}>📊 Account Balance</Text>
                      {balanceLoading && <ActivityIndicator size="small" color="#635bff" />}
                    </View>
                    {!balanceLoading && balanceData ? (
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <View style={{ flex: 1, backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#bbf7d0" }}>
                          <Text style={{ fontSize: 11, color: "#16a34a", fontWeight: "600", marginBottom: 4 }}>AVAILABLE</Text>
                          {balanceData.available.length > 0 ? (
                            balanceData.available.map((b, i) => (
                              <Text key={i} style={{ fontSize: 20, fontWeight: "700", color: "#15803d" }}>
                                ${b.amount.toFixed(2)} <Text style={{ fontSize: 12, fontWeight: "400" }}>{b.currency}</Text>
                              </Text>
                            ))
                          ) : (
                            <Text style={{ fontSize: 18, fontWeight: "700", color: "#15803d" }}>$0.00</Text>
                          )}
                          <Text style={{ fontSize: 11, color: "#16a34a", marginTop: 2 }}>Ready to pay out</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#fde68a" }}>
                          <Text style={{ fontSize: 11, color: "#d97706", fontWeight: "600", marginBottom: 4 }}>PENDING</Text>
                          {balanceData.pending.length > 0 ? (
                            balanceData.pending.map((b, i) => (
                              <Text key={i} style={{ fontSize: 20, fontWeight: "700", color: "#b45309" }}>
                                ${b.amount.toFixed(2)} <Text style={{ fontSize: 12, fontWeight: "400" }}>{b.currency}</Text>
                              </Text>
                            ))
                          ) : (
                            <Text style={{ fontSize: 18, fontWeight: "700", color: "#b45309" }}>$0.00</Text>
                          )}
                          <Text style={{ fontSize: 11, color: "#d97706", marginTop: 2 }}>Processing (2-7 days)</Text>
                        </View>
                      </View>
                    ) : !balanceLoading ? (
                      <Text style={[styles.payoutLabel, { color: colors.muted }]}>Balance unavailable</Text>
                    ) : null}
                  </View>

                  {/* Payout Schedule Section */}
                  <View style={[styles.payoutSection, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={styles.payoutSectionHeader}>
                      <Text style={[styles.payoutSectionTitle, { color: colors.foreground }]}>💰 Payout Schedule</Text>
                      {payoutLoading && <ActivityIndicator size="small" color="#635bff" />}
                    </View>

                    {!payoutLoading && payoutData && (
                      <>
                        {payoutData.schedule && (
                          <View style={styles.payoutRow}>
                            <Text style={[styles.payoutLabel, { color: colors.muted }]}>Frequency</Text>
                            <Text style={[styles.payoutValue, { color: colors.foreground }]}>
                              {payoutData.schedule.interval === "daily" ? "Daily" :
                               payoutData.schedule.interval === "weekly"
                                 ? `Weekly (${payoutData.schedule.weeklyAnchor ? payoutData.schedule.weeklyAnchor.charAt(0).toUpperCase() + payoutData.schedule.weeklyAnchor.slice(1) : ""})` :
                               payoutData.schedule.interval === "monthly"
                                 ? `Monthly (day ${payoutData.schedule.monthlyAnchor ?? ""})` :
                               payoutData.schedule.interval === "manual" ? "Manual" :
                               payoutData.schedule.interval}
                              {payoutData.schedule.delayDays ? ` · ${payoutData.schedule.delayDays}d delay` : ""}
                            </Text>
                          </View>
                        )}

                        {payoutData.nextPayout ? (
                          <View style={styles.payoutRow}>
                            <Text style={[styles.payoutLabel, { color: colors.muted }]}>Next Payout</Text>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={[styles.payoutValue, { color: "#16a34a", fontWeight: "700" }]}>
                                ${payoutData.nextPayout.amount.toFixed(2)}
                              </Text>
                              <Text style={[styles.payoutSub, { color: colors.muted }]}>
                                {new Date(payoutData.nextPayout.arrivalDate * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={[styles.payoutEmpty, { color: colors.muted }]}>No upcoming payouts</Text>
                        )}

                        {payoutData.recentPayouts.filter(p => p.status === "paid").length > 0 && (
                          <>
                            <Text style={[styles.payoutHistoryLabel, { color: colors.muted }]}>Recent Payouts</Text>
                            {payoutData.recentPayouts
                              .filter(p => p.status === "paid")
                              .slice(0, 3)
                              .map((p) => (
                                <View key={p.id} style={[styles.payoutHistoryRow, { borderTopColor: colors.border }]}>
                                  <Text style={[styles.payoutHistoryDate, { color: colors.muted }]}>
                                    {new Date(p.arrivalDate * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </Text>
                                  <Text style={[styles.payoutHistoryAmount, { color: colors.foreground }]}>
                                    ${p.amount.toFixed(2)}
                                  </Text>
                                </View>
                              ))
                            }
                          </>
                        )}
                      </>
                    )}

                    {!payoutLoading && !payoutData && (
                      <Text style={[styles.payoutEmpty, { color: colors.muted }]}>Unable to load payout info</Text>
                    )}
                  </View>

                  <View style={styles.stripeActions}>
                    <TouchableOpacity
                      style={[styles.stripeBtnSmall, { backgroundColor: "#635bff" }]}
                      onPress={handleOpenDashboard}
                      disabled={connectLoading}
                      activeOpacity={0.8}
                    >
                      {connectLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.stripeBtnText}>View Stripe Dashboard</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.stripeBtnSmall, { backgroundColor: "#ef444420", borderWidth: 1, borderColor: "#ef4444" }]}
                      onPress={handleDisconnect}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.stripeBtnText, { color: "#ef4444" }]}>Disconnect</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <TouchableOpacity
                onPress={loadConnectStatus}
                style={styles.refreshBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <IconSymbol name="arrow.clockwise" size={13} color={colors.muted} />
                <Text style={[styles.refreshText, { color: colors.muted }]}>Refresh status</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        )}

        {/* Divider */}
        <View style={[styles.divider, { borderColor: colors.border }]}>
          <Text style={[styles.dividerText, { color: colors.muted, backgroundColor: colors.background }]}>
            Manual Payment Handles
          </Text>
        </View>

        {/* ── Stripe Not Connected Warning Banner ── */}
        {isStripePlan && !connectStatusLoading && connectStatus && !connectStatus.chargesEnabled && (
          <TouchableOpacity
            onPress={handleConnectStripe}
            disabled={connectLoading}
            activeOpacity={0.85}
            style={{
              backgroundColor: "#fffbeb",
              borderWidth: 1.5,
              borderColor: "#f59e0b",
              borderRadius: 14,
              padding: 14,
              marginBottom: 12,
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 20, lineHeight: 24 }}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#92400e", marginBottom: 3 }}>
                Card Payments Not Active
              </Text>
              <Text style={{ fontSize: 13, color: "#78350f", lineHeight: 18 }}>
                {connectStatus.connected
                  ? "Your Stripe account is connected but not fully verified. Complete onboarding to let clients pay by card."
                  : "Clients cannot pay by card until you connect your Stripe account. Tap here to connect Stripe and enable card payments on your booking page."}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 4 }}>
                {connectLoading ? (
                  <ActivityIndicator size="small" color="#635bff" />
                ) : (
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#635bff", textDecorationLine: "underline" }}>
                    {connectStatus.connected ? "Complete Stripe Onboarding →" : "Connect with Stripe →"}
                  </Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Info Banner */}
        <View style={[styles.infoBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="info.circle.fill" size={16} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.muted }]}>
            Tap a payment method to set up your handle and get a shareable QR code for clients.
          </Text>
        </View>

        {/* Payment Method Cards */}
        {methods.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.methodCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => router.push(m.route as any)}
            activeOpacity={0.75}
          >
            <View style={[styles.methodIconBadge, { backgroundColor: m.color }]}>
              <Text style={styles.methodIconText}>{m.icon}</Text>
            </View>
            <View style={styles.methodCardBody}>
              <Text style={[styles.methodCardLabel, { color: colors.foreground }]}>{m.label}</Text>
              {m.handle ? (
                <Text style={[styles.methodCardHandle, { color: m.color }]}>{m.handle}</Text>
              ) : (
                <Text style={[styles.methodCardPlaceholder, { color: colors.muted }]}>Tap to set up · {m.placeholder}</Text>
              )}
            </View>
            <View style={styles.methodCardRight}>
              {m.handle ? (
                <View style={[styles.methodSetBadge, { backgroundColor: m.color + "20", borderColor: m.color + "60" }]}>
                  <Text style={[styles.methodSetBadgeText, { color: m.color }]}>✓ Set</Text>
                </View>
              ) : (
                <View style={[styles.methodSetBadge, { backgroundColor: colors.border + "40", borderColor: colors.border }]}>
                  <Text style={[styles.methodSetBadgeText, { color: colors.muted }]}>Not set</Text>
                </View>
              )}
              <IconSymbol name="chevron.right" size={16} color={colors.muted} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  // Stripe Connect
  stripeCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 20,
  },
  stripeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  stripeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  stripeIcon: {
    fontSize: 24,
  },
  stripeTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  stripeSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  stripeNote: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  stripeBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  stripeActions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  stripeBtnSmall: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  stripeBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  refreshText: {
    fontSize: 12,
  },
  // Divider
  divider: {
    borderTopWidth: 1,
    alignItems: "center",
    marginBottom: 16,
    marginTop: 4,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 10,
    marginTop: -9,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  // Method cards
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  methodIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  methodIconText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 18,
  },
  methodCardBody: {
    flex: 1,
    gap: 2,
  },
  methodCardLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  methodCardHandle: {
    fontSize: 13,
    fontWeight: "500",
  },
  methodCardPlaceholder: {
    fontSize: 13,
  },
  methodCardRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  methodSetBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  methodSetBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  // Payout section
  payoutSection: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  payoutSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  payoutSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  payoutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  payoutLabel: {
    fontSize: 13,
  },
  payoutValue: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  payoutSub: {
    fontSize: 11,
    marginTop: 2,
  },
  payoutEmpty: {
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 4,
  },
  payoutHistoryLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 4,
  },
  payoutHistoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 0.5,
  },
  payoutHistoryDate: {
    fontSize: 13,
  },
  payoutHistoryAmount: {
    fontSize: 13,
    fontWeight: "600",
  },
});
