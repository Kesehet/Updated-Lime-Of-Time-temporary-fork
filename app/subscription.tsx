/**
 * My Subscription Screen
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows:
 * - Current plan card with status, pricing, renewal date
 * - Manage Billing button (Stripe Customer Portal)
 * - Usage meters for each resource
 * - Full plan benefits comparison table (all 4 plans)
 * - Upgrade / Change Plan button
 */
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
} from "react-native";
import { useCallback, useEffect, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { useStore } from "@/lib/store";
import { trpc } from "@/lib/trpc";
import { getApiBaseUrl } from "@/constants/oauth";
import { FuturisticBackground } from "@/components/futuristic-background";
import { formatPrice } from "@/lib/utils";


// ─── Plan Colors ──────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  solo: "#6B7280",
  growth: "#3B82F6",
  studio: "#8B5CF6",
  enterprise: "#F59E0B",
};

// ─── Plan Benefits Data ───────────────────────────────────────────────────────

const PLAN_BENEFITS = [
  {
    planKey: "solo",
    displayName: "Solo",
    tagline: "Perfect for solo practitioners",
    monthlyPrice: 0,
    yearlyPrice: 0,
    color: "#6B7280",
    features: [
      { label: "Clients", value: "Up to 20" },
      { label: "Services", value: "Up to 5" },
      { label: "Staff Members", value: "1 (you)" },
      { label: "Products", value: "Up to 5" },
      { label: "Locations", value: "1" },
      { label: "Monthly Appointments", value: "Up to 50" },
      { label: "SMS Automation", value: "Not included", dim: true },
      { label: "Payment Methods", value: "Cash & P2P (Zelle, Venmo)" },
      { label: "Online Booking Page", value: "Included" },
      { label: "Analytics & Reports", value: "Basic" },
    ],
  },
  {
    planKey: "growth",
    displayName: "Growth",
    tagline: "For growing businesses",
    monthlyPrice: 19,
    yearlyPrice: 190,
    color: "#3B82F6",
    features: [
      { label: "Clients", value: "Up to 100" },
      { label: "Services", value: "Up to 20" },
      { label: "Staff Members", value: "Up to 2" },
      { label: "Products", value: "Up to 20" },
      { label: "Locations", value: "1" },
      { label: "Monthly Appointments", value: "Unlimited" },
      { label: "SMS Automation", value: "Confirmations only" },
      { label: "Payment Methods", value: "Cash & P2P (Zelle, Venmo)" },
      { label: "Online Booking Page", value: "Included" },
      { label: "Analytics & Reports", value: "Full" },
    ],
  },
  {
    planKey: "studio",
    displayName: "Studio",
    tagline: "For multi-staff studios",
    monthlyPrice: 39,
    yearlyPrice: 390,
    color: "#8B5CF6",
    features: [
      { label: "Clients", value: "Unlimited" },
      { label: "Services", value: "Unlimited" },
      { label: "Staff Members", value: "Up to 10" },
      { label: "Products", value: "Unlimited" },
      { label: "Locations", value: "Up to 3" },
      { label: "Monthly Appointments", value: "Unlimited" },
      { label: "SMS Automation", value: "Full (reminders, rebooking, birthday)" },
      { label: "Payment Methods", value: "All methods + Stripe" },
      { label: "Online Booking Page", value: "Included" },
      { label: "Analytics & Reports", value: "Full + Staff" },
    ],
  },
  {
    planKey: "enterprise",
    displayName: "Enterprise",
    tagline: "For large operations & chains",
    monthlyPrice: 69,
    yearlyPrice: 690,
    color: "#F59E0B",
    features: [
      { label: "Clients", value: "Unlimited" },
      { label: "Services", value: "Unlimited" },
      { label: "Staff Members", value: "Up to 100" },
      { label: "Products", value: "Unlimited" },
      { label: "Locations", value: "Up to 10" },
      { label: "Monthly Appointments", value: "Unlimited" },
      { label: "SMS Automation", value: "Full (reminders, rebooking, birthday)" },
      { label: "Payment Methods", value: "All methods + Stripe" },
      { label: "Online Booking Page", value: "Included" },
      { label: "Analytics & Reports", value: "Full + Multi-location" },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function UsageMeter({
  label,
  current,
  max,
  color,
}: {
  label: string;
  current: number;
  max: number;
  color: string;
}) {
  const colors = useColors();
  const { modalMaxWidth } = useResponsive();
  const isUnlimited = max === -1 || max >= 9999;
  const pct = isUnlimited ? 0 : Math.min(1, current / Math.max(max, 1));
  const barColor = pct >= 0.9 ? "#EF4444" : pct >= 0.7 ? "#F59E0B" : color;

  // Animated bar width
  const animWidth = useSharedValue(0);
  useEffect(() => {
    animWidth.value = withTiming(pct, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [pct]); // eslint-disable-line react-hooks/exhaustive-deps

  const barStyle = useAnimatedStyle(() => ({
    width: `${Math.round(animWidth.value * 100)}%` as any,
  }));

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{label}</Text>
        <Text style={{
          fontSize: 12,
          fontWeight: "600",
          color: isUnlimited
            ? color
            : pct >= 0.9
            ? "#EF4444"
            : pct >= 0.7
            ? "#F59E0B"
            : colors.muted,
        }}>
          {isUnlimited ? "Unlimited" : `${current} / ${max} used`}
        </Text>
      </View>
      {!isUnlimited && (
        <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}>
          <Animated.View
            style={[
              {
                height: 7,
                borderRadius: 4,
                backgroundColor: barColor,
              },
              barStyle,
            ]}
          />
        </View>
      )}
      {isUnlimited && (
        <View style={{ height: 7, borderRadius: 4, backgroundColor: color + "30", overflow: "hidden" }}>
          <View style={{ height: 7, borderRadius: 4, backgroundColor: color, width: "100%", opacity: 0.35 }} />
        </View>
      )}
    </View>
  );
}

function PlanBadge({ planKey, displayName, isAdminOverride }: { planKey: string; displayName: string; isAdminOverride: boolean }) {
  const badgeColor = isAdminOverride ? "#F59E0B" : (PLAN_COLORS[planKey] ?? "#6B7280");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ backgroundColor: badgeColor + "20", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <IconSymbol name="crown.fill" size={13} color={badgeColor} />
        <Text style={{ fontSize: 13, fontWeight: "700", color: badgeColor }}>
          {isAdminOverride ? "Complimentary" : displayName}
        </Text>
      </View>
    </View>
  );
}

function FeatureRow({
  label,
  value,
  dim,
  colors,
}: {
  label: string;
  value: string;
  dim?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
      <IconSymbol
        name={dim ? "xmark.circle.fill" : "checkmark.circle.fill"}
        size={16}
        color={dim ? colors.border : colors.success}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{label}</Text>
        <Text style={{ fontSize: 12, color: dim ? colors.border : colors.muted, marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Plan Benefits Card ───────────────────────────────────────────────────────

function PlanBenefitsCard({
  plan,
  isCurrentPlan,
  colors,
}: {
  plan: typeof PLAN_BENEFITS[0];
  isCurrentPlan: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(isCurrentPlan);
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: isCurrentPlan ? plan.color : colors.border,
          borderWidth: isCurrentPlan ? 1.5 : StyleSheet.hairlineWidth,
          marginBottom: 12,
        },
      ]}
    >
      {/* Plan header */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => ({
          opacity: pressed ? 0.7 : 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        })}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: plan.color }} />
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{plan.displayName}</Text>
            {isCurrentPlan && (
              <View style={{ backgroundColor: plan.color + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: plan.color }}>Current</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 12, color: colors.muted }}>{plan.tagline}</Text>
        </View>
        <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
          {plan.monthlyPrice === 0 ? (
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.success }}>Free</Text>
          ) : (() => {
            const discPct = (plan as any).discountPercent ?? 0;
            const effMonthly = (plan as any).effectiveMonthlyPrice ?? plan.monthlyPrice;
            const effYearly = (plan as any).effectiveYearlyPrice ?? plan.yearlyPrice;
            const discLabel = (plan as any).discountLabel;
            return (
              <>
                {discPct > 0 && (
                  <View style={{ backgroundColor: "#F59E0B22", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginBottom: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: "800", color: "#F59E0B", letterSpacing: 0.3 }}>
                      🏷️ {discLabel ?? `${discPct}% OFF`}
                    </Text>
                  </View>
                )}
                {discPct > 0 && (
                  <Text style={{ fontSize: 11, color: colors.muted, textDecorationLine: "line-through" }}>{formatPrice(plan.monthlyPrice)}/mo</Text>
                )}
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>{formatPrice(effMonthly)}<Text style={{ fontSize: 12, fontWeight: "400", color: colors.muted }}>/mo</Text></Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{formatPrice(effYearly)}/yr</Text>
              </>
            );
          })()}
        </View>
        <IconSymbol
          name={expanded ? "chevron.down" : "chevron.right"}
          size={16}
          color={colors.muted}
          style={{ marginLeft: 8 }}
        />
      </Pressable>

      {/* Feature list */}
      {expanded && (
        <View style={{ marginTop: 12 }}>
          {plan.features.map((f) => (
            <FeatureRow key={f.label} label={f.label} value={f.value} dim={f.dim} colors={colors} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const colors = useColors();
  const router = useRouter();
  const { state } = useStore();
  const businessOwnerId = state.businessOwnerId;
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [nextInvoice, setNextInvoice] = useState<{ amount: number | null; amountFormatted: string | null; date: number | null } | null>(null);

  const { data: planInfo, isLoading, isError, refetch } = trpc.subscription.getMyPlan.useQuery(
    { businessOwnerId: businessOwnerId! },
    { enabled: !!businessOwnerId, staleTime: 30_000, retry: 2 }
  );

  // Fetch live plan prices from DB (Admin Panel) so hardcoded prices are never shown
  const { data: publicPlans } = trpc.subscription.getPublicPlans.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: true,
  });

  // Merge live DB prices (including discounts) into PLAN_BENEFITS
  const planBenefits = PLAN_BENEFITS.map((p) => {
    const live = publicPlans?.find((lp: any) => lp.planKey === p.planKey);
    if (!live) return p;
    return {
      ...p,
      monthlyPrice: live.monthlyPrice,
      yearlyPrice: live.yearlyPrice,
      effectiveMonthlyPrice: live.effectiveMonthlyPrice ?? live.monthlyPrice,
      effectiveYearlyPrice: live.effectiveYearlyPrice ?? live.yearlyPrice,
      discountPercent: live.discountPercent ?? 0,
      discountLabel: live.discountLabel ?? null,
      discountExpiresAt: live.discountExpiresAt ?? null,
    };
  });

  // Refetch when screen comes into focus (e.g. after returning from Stripe checkout)
  useFocusEffect(
    useCallback(() => {
      if (businessOwnerId) {
        refetch();
      }
    }, [businessOwnerId, refetch])
  );

  const handleManageBilling = useCallback(async () => {
    if (!businessOwnerId) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/stripe/create-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessOwnerId,
          returnUrl: "https://lime-of-time.com",
        }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        await Linking.openURL(data.url);
      } else {
        Alert.alert("Billing Portal", data.error ?? "Could not open billing portal. Please try again.");
      }
    } catch {
      Alert.alert("Billing Portal", "Could not connect to billing portal. Please check your connection.");
    } finally {
      setPortalLoading(false);
    }
  }, [businessOwnerId]);

  // Fetch next invoice when plan info is available and subscription is active
  useEffect(() => {
    if (!businessOwnerId || !planInfo?.stripeCustomerId || planInfo?.planKey === "solo") return;
    fetch(`${getApiBaseUrl()}/api/stripe/next-invoice?businessOwnerId=${businessOwnerId}`)
      .then((r) => r.json())
      .then((data: any) => setNextInvoice(data))
      .catch(() => {});
  }, [businessOwnerId, planInfo?.stripeCustomerId, planInfo?.planKey]);

  const handleCancelSubscription = useCallback(async () => {
    if (!businessOwnerId) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/stripe/cancel-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessOwnerId }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        Alert.alert("Subscription Cancelled", "Your subscription will cancel at the end of the current billing period. You'll keep full access until then.");
        setShowCancelModal(false);
        refetch();
      } else {
        Alert.alert("Error", data.error ?? "Failed to cancel subscription. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not connect to server. Please check your connection.");
    } finally {
      setCancelLoading(false);
    }
  }, [businessOwnerId, refetch]);

  const handleResumeSubscription = useCallback(async () => {
    if (!businessOwnerId) return;
    setResumeLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/stripe/resume-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessOwnerId }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        Alert.alert("Subscription Resumed", "Your subscription has been resumed and will continue to renew automatically.");
        refetch();
      } else {
        Alert.alert("Error", data.error ?? "Failed to resume subscription. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not connect to server. Please check your connection.");
    } finally {
      setResumeLoading(false);
    }
  }, [businessOwnerId, refetch]);

  if (!businessOwnerId || isLoading) {
    return (
      <ScreenContainer>
      <FuturisticBackground />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  if (!planInfo) {
    return (
      <ScreenContainer className="p-5">
        <FuturisticBackground />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <IconSymbol name="exclamationmark.triangle.fill" size={40} color={colors.warning} />
          <Text style={{ fontSize: 16, color: colors.foreground, textAlign: "center", fontWeight: "700" }}>
            {isError ? "Connection Error" : "Subscription Not Found"}
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 }}>
            {isError
              ? "Could not reach the server.\nPlease check your connection and try again."
              : "Your account is not yet fully set up.\nPlease complete onboarding or contact support."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Retry</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const { planKey, displayName, subscriptionStatus, subscriptionPeriod, trialDaysRemaining, isAdminOverride, limits, usage } = planInfo;

  const statusLabel: Record<string, string> = {
    trial: "Trial",
    active: "Active",
    expired: "Expired",
    free: "Free",
  };

  const statusColor: Record<string, string> = {
    trial: colors.warning,
    active: colors.success,
    expired: colors.error,
    free: colors.muted,
  };

  // Format renewal date from stripeCurrentPeriodEnd (Unix timestamp in seconds)
  let renewalDateStr: string | null = null;
  if (planInfo.stripeCurrentPeriodEnd) {
    const d = new Date(planInfo.stripeCurrentPeriodEnd * 1000);
    renewalDateStr = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  // Format period start (estimate: period end minus billing interval)
  let periodStartStr: string | null = null;
  if (planInfo.stripeCurrentPeriodEnd && planInfo.subscriptionPeriod) {
    const intervalMs = planInfo.subscriptionPeriod === "yearly" ? 365 * 86400 * 1000 : 30 * 86400 * 1000;
    const startMs = planInfo.stripeCurrentPeriodEnd * 1000 - intervalMs;
    periodStartStr = new Date(startMs).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  // Compute the effective price the user is paying (use effective price which accounts for discounts)
  let billingAmountStr: string | null = null;
  if (!planInfo.isAdminOverride && planInfo.monthlyPrice > 0) {
    const effMonthly = (planInfo as any).effectiveMonthlyPrice ?? planInfo.monthlyPrice;
    const effYearly = (planInfo as any).effectiveYearlyPrice ?? planInfo.yearlyPrice;
    if (planInfo.subscriptionPeriod === "yearly") {
      billingAmountStr = `${formatPrice(effYearly)}/year`;
    } else {
      billingAmountStr = `${formatPrice(effMonthly)}/month`;
    }
  }

  const hasStripeSubscription = !!planInfo.stripeCustomerId && planKey !== "solo";

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 12 })}
          >
            <IconSymbol name="arrow.left" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground, flex: 1 }}>My Subscription</Text>
        </View>

        {/* Plan Card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: PLAN_COLORS[planKey] ?? colors.border, borderWidth: 1.5 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <PlanBadge planKey={planKey} displayName={displayName} isAdminOverride={isAdminOverride} />
            <View style={{ backgroundColor: (statusColor[subscriptionStatus] ?? colors.muted) + "20", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: statusColor[subscriptionStatus] ?? colors.muted }}>
                {statusLabel[subscriptionStatus] ?? subscriptionStatus}
              </Text>
            </View>
          </View>

          {/* Grace period / scheduled downgrade banner */}
          {(planInfo as any)?.isInGracePeriod && (planInfo as any)?.stripeCurrentPeriodEnd && (
            <View style={{ backgroundColor: colors.warning + "15", borderRadius: 10, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <IconSymbol name="clock.fill" size={18} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.warning }}>
                  {(planInfo as any)?.cancelAtPeriodEnd ? "Subscription Cancelling" : "Downgrade Scheduled"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  {(planInfo as any)?.cancelAtPeriodEnd
                    ? `Cancels on ${new Date((planInfo as any).stripeCurrentPeriodEnd * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Full access until then.`
                    : `Changes to ${(planInfo as any)?.scheduledPlanKey ?? "lower tier"} on ${new Date((planInfo as any).stripeCurrentPeriodEnd * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
                  }
                </Text>
              </View>
            </View>
          )}

          {/* Trial countdown */}
          {subscriptionStatus === "trial" && trialDaysRemaining !== null && (
            <View style={{ backgroundColor: colors.warning + "15", borderRadius: 10, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <IconSymbol name="clock.fill" size={18} color={colors.warning} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.warning, flex: 1 }}>
                {trialDaysRemaining > 0
                  ? `${trialDaysRemaining} day${trialDaysRemaining !== 1 ? "s" : ""} remaining in your trial`
                  : "Your trial has ended"}
              </Text>
            </View>
          )}

          {/* Expired warning */}
          {subscriptionStatus === "expired" && (
            <View style={{ backgroundColor: colors.error + "15", borderRadius: 10, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <IconSymbol name="exclamationmark.triangle.fill" size={18} color={colors.error} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.error, flex: 1 }}>
                Your subscription has expired. Upgrade to restore full access.
              </Text>
            </View>
          )}

          {/* ── Subscription Details Grid ── */}
          <View style={{ marginBottom: 14, marginTop: 4 }}>
            {/* Billing Amount */}
            {billingAmountStr && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="creditcard.fill" size={14} color={colors.muted} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Billing</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{billingAmountStr}</Text>
              </View>
            )}
            {/* Billing Cycle */}
            {subscriptionPeriod && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="arrow.clockwise" size={14} color={colors.muted} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Cycle</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {subscriptionPeriod.charAt(0).toUpperCase() + subscriptionPeriod.slice(1)}
                </Text>
              </View>
            )}
            {/* Period Start */}
            {periodStartStr && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="calendar" size={14} color={colors.muted} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Started</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{periodStartStr}</Text>
              </View>
            )}
            {/* Next Renewal / Cancellation */}
            {renewalDateStr && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol
                    name={(planInfo as any).cancelAtPeriodEnd ? "xmark.circle.fill" : "arrow.clockwise"}
                    size={14}
                    color={(planInfo as any).cancelAtPeriodEnd ? colors.error : colors.success}
                  />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>
                    {(planInfo as any).cancelAtPeriodEnd ? "Cancels on" : "Renews on"}
                  </Text>
                </View>
                <Text style={[
                  styles.infoValue,
                  { color: (planInfo as any).cancelAtPeriodEnd ? colors.error : colors.foreground },
                ]}>{renewalDateStr}</Text>
              </View>
            )}
            {/* Next invoice amount */}
            {nextInvoice?.amountFormatted && nextInvoice?.date && !(planInfo as any).cancelAtPeriodEnd && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="dollarsign.circle.fill" size={14} color={colors.success} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Next charge</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {nextInvoice.amountFormatted} on {new Date(nextInvoice.date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Text>
              </View>
            )}
            {/* Trial end date */}
            {subscriptionStatus === "trial" && planInfo.trialEndsAt && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="clock.fill" size={14} color={colors.warning} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Trial ends</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.warning }]}>
                  {new Date(planInfo.trialEndsAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                </Text>
              </View>
            )}
            {/* Free / Complimentary */}
            {isAdminOverride && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="gift.fill" size={14} color={colors.muted} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Billing</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.success }]}>Complimentary — no charge</Text>
              </View>
            )}
            {planKey === "solo" && !isAdminOverride && (
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeft}>
                  <IconSymbol name="checkmark.seal.fill" size={14} color={colors.success} />
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>Billing</Text>
                </View>
                <Text style={[styles.infoValue, { color: colors.success }]}>Free forever</Text>
              </View>
            )}
          </View>

          {/* Action buttons */}
          <View style={{ gap: 10 }}>
            {/* Manage Billing (Stripe Portal) */}
            {hasStripeSubscription && (
              <Pressable
                onPress={handleManageBilling}
                disabled={portalLoading}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { borderColor: colors.border, opacity: pressed || portalLoading ? 0.7 : 1 },
                ]}
              >
                {portalLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <IconSymbol name="creditcard.fill" size={16} color={colors.primary} />
                )}
                <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
                  Manage Billing
                </Text>
              </Pressable>
            )}

            {/* Upgrade / Change Plan */}
            {!isAdminOverride && (
              <Pressable
                onPress={() => router.push("/choose-plan" as any)}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
              >
                <IconSymbol
                  name={subscriptionStatus === "expired" || planKey === "solo" || planKey === "growth" ? "arrow.up.right" : "arrow.up.arrow.down"}
                  size={16}
                  color="#fff"
                />
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15, marginLeft: 6 }}>
                  {subscriptionStatus === "expired" || planKey === "solo"
                    ? "Upgrade Plan"
                    : planKey === "growth"
                    ? "Upgrade or Downgrade"
                    : planKey === "enterprise"
                    ? "Downgrade Plan"
                    : "Upgrade or Downgrade"}
                </Text>
              </Pressable>
            )}

            {/* Cancel / Resume Subscription */}
            {hasStripeSubscription && !isAdminOverride && (
              (planInfo as any).cancelAtPeriodEnd ? (
                <Pressable
                  onPress={handleResumeSubscription}
                  disabled={resumeLoading}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: colors.success, opacity: pressed || resumeLoading ? 0.7 : 1 },
                  ]}
                >
                  {resumeLoading ? (
                    <ActivityIndicator size="small" color={colors.success} />
                  ) : (
                    <IconSymbol name="arrow.clockwise" size={16} color={colors.success} />
                  )}
                  <Text style={{ color: colors.success, fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
                    Resume Subscription
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setShowCancelModal(true)}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: colors.error + "60", opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <IconSymbol name="xmark.circle" size={16} color={colors.error} />
                  <Text style={{ color: colors.error, fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
                    Cancel Subscription
                  </Text>
                </Pressable>
              )
            )}
          </View>
        </View>

        {/* Cancel Subscription Confirmation Modal */}
        <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, margin: 16, marginBottom: 32, padding: 24 }]}>
              <View style={{ alignItems: "center", marginBottom: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.error + "18", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <IconSymbol name="xmark.circle.fill" size={28} color={colors.error} />
                </View>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>Cancel Subscription?</Text>
                <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
                  Your subscription will remain active until the end of the current billing period. After that, you'll be moved to the free Solo plan.
                </Text>
              </View>

              {/* Next billing date reminder */}
              {renewalDateStr && (
                <View style={{ backgroundColor: colors.warning + "15", borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <IconSymbol name="calendar" size={16} color={colors.warning} />
                  <Text style={{ fontSize: 13, color: colors.warning, flex: 1 }}>
                    Access continues until {renewalDateStr}
                  </Text>
                </View>
              )}

              {/* Pause suggestion */}
              <View style={{ backgroundColor: colors.primary + "12", borderRadius: 10, padding: 12, marginBottom: 20, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <IconSymbol name="lightbulb.fill" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>Thinking of pausing?</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 }}>
                    Contact us to pause your subscription for up to 3 months instead of cancelling.
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handleCancelSubscription}
                disabled={cancelLoading}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.error, opacity: pressed || cancelLoading ? 0.8 : 1, marginBottom: 10 }]}
              >
                {cancelLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <IconSymbol name="xmark.circle.fill" size={16} color="#fff" />
                )}
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15, marginLeft: 6 }}>Yes, Cancel at Period End</Text>
              </Pressable>

              <Pressable
                onPress={() => setShowCancelModal(false)}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>Keep My Subscription</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Usage Meters */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>Usage</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <UsageMeter label="Clients" current={usage.clients} max={limits.maxClients} color={colors.primary} />
          <UsageMeter label="Services" current={usage.services} max={limits.maxServices} color="#8B5CF6" />
          <UsageMeter label="Products" current={usage.products} max={limits.maxProducts} color="#3B82F6" />
          <UsageMeter label="Staff Members" current={usage.staff} max={limits.maxStaff} color="#F59E0B" />
          <UsageMeter label="Locations" current={usage.locations} max={limits.maxLocations} color="#EC4899" />
        </View>

        {/* Plan Comparison */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>All Plans</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12, lineHeight: 18 }}>
          Tap any plan to see its full feature list. Your current plan is highlighted.
        </Text>
        {planBenefits.map((plan) => (
          <PlanBenefitsCard
            key={plan.planKey}
            plan={plan}
            isCurrentPlan={plan.planKey === planKey && !isAdminOverride}
            colors={colors}
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  infoRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
    marginLeft: 12,
  },
});
