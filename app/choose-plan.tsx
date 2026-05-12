/**
 * Choose a Plan Screen
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-page subscription plan selector with:
 * - Billing toggle (monthly/yearly) built in
 * - "Compare all plans" link built in
 * - 14-day trial badge on eligible plans
 * - Centered plan cards
 * - Proper downgrade flow with usage checks
 */
import { useState } from "react";
import { useRouter } from "expo-router";
import { View, Text, Pressable, Alert, Linking } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { PlanCarousel } from "@/components/plan-carousel";
import * as WebBrowser from "expo-web-browser";
import { getApiBaseUrl } from "@/constants/oauth";
import { useStore } from "@/lib/store";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChoosePlanScreen() {
  const colors = useColors();
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(false);
  const [loadingPlanKey, setLoadingPlanKey] = useState<string | null>(null);
  const { state } = useStore();

  const { data: plans, isLoading } = trpc.subscription.getPublicPlans.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
  const { data: planInfo } = trpc.subscription.getMyPlan.useQuery(
    { businessOwnerId: state.businessOwnerId! },
    { enabled: !!state.businessOwnerId, staleTime: 30_000 }
  );
  const utils = trpc.useUtils();

  // Trial eligibility: user has not used trial yet and is not currently in a trial
  const isTrialEligible =
    !(planInfo as any)?.hasUsedTrial &&
    planInfo?.subscriptionStatus !== "trial" &&
    planInfo?.subscriptionStatus !== "active";

  /** Determine if the selected plan is a downgrade from the current effective plan. */
  const isDowngrade = (targetPlanKey: string): boolean => {
    if (!plans || !planInfo) return false;
    const currentIdx = plans.findIndex((p) => p.planKey === planInfo.planKey);
    const targetIdx = plans.findIndex((p) => p.planKey === targetPlanKey);
    return targetIdx < currentIdx;
  };

  /** Check server-side if downgrade is allowed given current usage. */
  const checkDowngradeEligibility = async (
    businessOwnerId: number,
    targetPlanKey: string
  ): Promise<{ allowed: boolean; blockers: string[]; targetPlanName: string }> => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/stripe/check-downgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessOwnerId, targetPlanKey }),
      });
      const data = await res.json();
      return {
        allowed: data.allowed ?? false,
        blockers: data.blockers ?? [],
        targetPlanName: data.targetPlanName ?? targetPlanKey,
      };
    } catch {
      // Fail open on network error
      return { allowed: true, blockers: [], targetPlanName: targetPlanKey };
    }
  };

  const handleSelectPlan = async (planKey: string, period: "monthly" | "yearly") => {
    const businessOwnerId = state.businessOwnerId;
    if (!businessOwnerId) {
      Alert.alert("Error", "Business owner not found. Please restart the app.");
      return;
    }
    const plan = plans?.find((p) => p.planKey === planKey);
    if (!plan) return;

    // Don't allow re-selecting the same active plan
    if (planKey === planInfo?.planKey && !(planInfo as any)?.isInGracePeriod && !(planInfo as any)?.cancelAtPeriodEnd) {
      Alert.alert("Already on this plan", "You are currently on the " + plan.displayName + " plan.");
      return;
    }

    const isDowngrading = isDowngrade(planKey);
    const isFree = plan.monthlyPrice === 0;

    // For any downgrade, check usage limits first
    if (isDowngrading || isFree) {
      setLoadingPlanKey(planKey);
      let eligibility: { allowed: boolean; blockers: string[]; targetPlanName: string };
      try {
        eligibility = await checkDowngradeEligibility(businessOwnerId, planKey);
      } finally {
        setLoadingPlanKey(null);
      }
      if (!eligibility.allowed) {
        const blockerList = eligibility.blockers.map((b) => "• " + b).join("\n\n");
        Alert.alert(
          "Cannot Downgrade",
          "To downgrade to the " + eligibility.targetPlanName + " plan, reduce your usage first:\n\n" + blockerList,
          [{ text: "OK" }]
        );
        return;
      }
    }

    if (isFree || isDowngrading) {
      // Build confirmation message based on whether there's an active paid period
      const periodEndSec = (planInfo as any)?.stripeCurrentPeriodEnd ?? null;
      const hasActivePeriod = periodEndSec &&
        periodEndSec > Math.floor(Date.now() / 1000) &&
        planInfo?.subscriptionStatus === "active";

      let confirmMessage = "";
      if (hasActivePeriod && periodEndSec) {
        const periodEndDate = new Date(periodEndSec * 1000).toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric"
        });
        if (isFree) {
          confirmMessage = "Your subscription will be cancelled at the end of your billing period on " + periodEndDate + ". You'll keep full access until then.";
        } else {
          confirmMessage = "Your plan will change to " + plan.displayName + " on " + periodEndDate + ". You'll keep your current plan's features until then.";
        }
      } else {
        if (isFree) {
          confirmMessage = "You will be moved to the free Solo plan immediately.";
        } else {
          confirmMessage = "You will be moved to the " + plan.displayName + " plan immediately.";
        }
      }

      Alert.alert(
        isFree ? "Cancel Subscription" : "Downgrade to " + plan.displayName,
        confirmMessage,
        [
          { text: "Keep Current Plan", style: "cancel" },
          {
            text: isFree ? "Cancel Subscription" : "Confirm Downgrade",
            style: "destructive",
            onPress: async () => {
              try {
                setLoadingPlanKey(planKey);
                const res = await fetch(`${getApiBaseUrl()}/api/stripe/create-checkout`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ businessOwnerId, planKey, period }),
                });
                const data = await res.json();
                await utils.subscription.getMyPlan.invalidate();
                if (data.scheduled) {
                  const scheduledDate = data.scheduledAt
                    ? new Date(data.scheduledAt * 1000).toLocaleDateString("en-US", {
                        year: "numeric", month: "long", day: "numeric"
                      })
                    : "your billing period end";
                  Alert.alert(
                    "Downgrade Scheduled",
                    "Your subscription will downgrade to " + plan.displayName + " on " + scheduledDate + ". You'll keep full access until then.",
                    [{ text: "OK", onPress: () => router.back() }]
                  );
                } else if (data.activated || data.free) {
                  Alert.alert("Plan Updated", "You are now on the " + plan.displayName + " plan.", [
                    { text: "OK", onPress: () => router.back() },
                  ]);
                } else {
                  Alert.alert("Error", data.error ?? "Could not update plan. Please try again.");
                }
              } catch {
                Alert.alert("Error", "Could not update plan. Please try again.");
              } finally {
                setLoadingPlanKey(null);
              }
            },
          },
        ]
      );
      return;
    }

    // Upgrade flow — go to Stripe Checkout
    try {
      setLoadingPlanKey(planKey);
      const res = await fetch(`${getApiBaseUrl()}/api/stripe/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessOwnerId, planKey, period }),
      });
      const data = await res.json();
      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        await utils.subscription.getMyPlan.invalidate();
      } else if (data.activated || data.free) {
        await utils.subscription.getMyPlan.invalidate();
        Alert.alert("Plan Updated", "You are now on the " + plan.displayName + " plan.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Error", data.error ?? "Could not start checkout. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not start checkout. Please try again.");
    } finally {
      setLoadingPlanKey(null);
    }
  };

  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: "#000d05" }}>
      {/* Dark deep-space background */}
      <LinearGradient
        colors={["#000d05", "#001208", "#000e1a", "#000d05"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* Subtle lime glow top-left */}
      <View style={{ position: "absolute", top: -80, left: -80, width: 260, height: 260, borderRadius: 130, backgroundColor: "rgba(74,222,128,0.06)" }} />
      {/* Subtle cyan glow bottom-right */}
      <View style={{ position: "absolute", bottom: -60, right: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34,211,238,0.05)" }} />

      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 4 }}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 12, padding: 4 })}
        >
          <IconSymbol name="arrow.left" size={24} color="#4ade80" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: "#4ade80", letterSpacing: -0.5 }}>{"Choose a Plan"}</Text>
          <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{"Swipe to compare · Upgrade or downgrade anytime"}</Text>
        </View>
      </View>

      {/* Trial eligibility banner */}
      {isTrialEligible && (
        <View style={{
          marginHorizontal: 20, marginTop: 8, marginBottom: 4, padding: 12,
          backgroundColor: "rgba(74,222,128,0.1)", borderRadius: 12,
          borderWidth: 1, borderColor: "rgba(74,222,128,0.3)",
          flexDirection: "row", alignItems: "center", gap: 10,
        }}>
          <Text style={{ fontSize: 20 }}>{"🎁"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#4ade80" }}>{"14-Day Free Trial Available"}</Text>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{"Try any paid plan free for 14 days. No credit card required to start."}</Text>
          </View>
        </View>
      )}

      {/* Grace period / scheduled downgrade banner */}
      {(planInfo as any)?.isInGracePeriod && (planInfo as any)?.stripeCurrentPeriodEnd && (
        <View style={{
          marginHorizontal: 20, marginTop: 8, marginBottom: 4, padding: 12,
          backgroundColor: colors.warning + "22", borderRadius: 12,
          borderWidth: 1, borderColor: colors.warning + "66",
          flexDirection: "row", alignItems: "flex-start", gap: 8,
        }}>
          <Text style={{ fontSize: 16 }}>{"⏳"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.warning }}>{"Downgrade Scheduled"}</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
              {(planInfo as any)?.cancelAtPeriodEnd
                ? "Your subscription cancels on " + new Date((planInfo as any).stripeCurrentPeriodEnd * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + ". Full access until then."
                : "Your plan changes on " + new Date((planInfo as any).stripeCurrentPeriodEnd * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + "."
              }
            </Text>
          </View>
        </View>
      )}

      {/* Full-page Carousel */}
      <View style={{ flex: 1, paddingTop: 8 }}>
        <PlanCarousel
          plans={(plans ?? []) as any}
          isLoading={isLoading}
          isYearly={isYearly}
          onToggleBilling={setIsYearly}
          onSelectPlan={handleSelectPlan}
          loadingPlanKey={loadingPlanKey}
          currentPlanKey={planInfo?.planKey ?? null}
          isTrialEligible={isTrialEligible}
        />
      </View>

      {/* Footer */}
      <View style={{ paddingBottom: Math.max(insets.bottom, 16), paddingHorizontal: 20, alignItems: "center" }}>
        <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
          {"Need a custom plan? "}
          <Text
            style={{ color: "#4ade80" }}
            onPress={() => Linking.openURL("mailto:support@lime-of-time.com")}
          >
            {"Contact us"}
          </Text>
        </Text>
      </View>
    </View>
  );
}
