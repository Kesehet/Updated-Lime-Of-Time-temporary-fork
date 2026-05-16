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
import { useState, useEffect } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, Text, Pressable, Alert, Linking, TextInput, ActivityIndicator } from "react-native";
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
  const [referralCode, setReferralCode] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);
  // Pre-fill referral code from deep link (stored by onboarding or booking page)
  useEffect(() => {
    AsyncStorage.getItem("@lot_pending_ref").then((val) => {
      if (val && !referralApplied) {
        setReferralCode(val);
      }
    }).catch(() => {});
  }, []);
  const [referralError, setReferralError] = useState("");
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralDiscount, setReferralDiscount] = useState<{ percent: number; months: number } | null>(null);
  const [appliedReferralCodeId, setAppliedReferralCodeId] = useState<number | null>(null);
  const [referrerBusinessName, setReferrerBusinessName] = useState<string | null>(null);
  const { state } = useStore();

  const applyReferralMutation = trpc.referrals.applyCode.useMutation();

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
        body: JSON.stringify({
          businessOwnerId,
          planKey,
          period,
          ...(appliedReferralCodeId ? { referralCodeId: appliedReferralCodeId } : {}),
        }),
      });
      const data = await res.json();
      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        await utils.subscription.getMyPlan.invalidate();
        // Clear stored referral code after checkout is initiated
        await AsyncStorage.removeItem("@lot_pending_ref");
      } else if (data.activated || data.free) {
        await utils.subscription.getMyPlan.invalidate();
        await AsyncStorage.removeItem("@lot_pending_ref");
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

      {/* Back button only — title removed, it's now inside the card */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 4 }}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            padding: 8,
            borderRadius: 12,
            backgroundColor: "rgba(74,222,128,0.08)",
            borderWidth: 1,
            borderColor: "rgba(74,222,128,0.2)",
          })}
        >
          <IconSymbol name="arrow.left" size={20} color="#4ade80" />
        </Pressable>
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
      <View style={{ flex: 1, paddingTop: 4 }}>
        <PlanCarousel
          plans={(plans ?? []) as any}
          isLoading={isLoading}
          isYearly={isYearly}
          onToggleBilling={setIsYearly}
          onSelectPlan={handleSelectPlan}
          loadingPlanKey={loadingPlanKey}
          currentPlanKey={planInfo?.planKey ?? null}
          isTrialEligible={isTrialEligible}
          referralDiscountPercent={referralApplied && referralDiscount ? referralDiscount.percent : undefined}
        />
      </View>

      {/* Referral Code Entry */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
        {!referralApplied ? (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput
              style={{
                flex: 1, height: 44, borderRadius: 12, paddingHorizontal: 14,
                backgroundColor: "rgba(255,255,255,0.07)", color: "#fff",
                borderWidth: 1, borderColor: referralError ? "#f87171" : "rgba(74,222,128,0.25)",
                fontSize: 14, letterSpacing: 1,
              }}
              placeholder="Have a referral code?"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={referralCode}
              onChangeText={(t) => { setReferralCode(t.toUpperCase()); setReferralError(""); }}
              autoCapitalize="characters"
              returnKeyType="done"
            />
            <Pressable
              onPress={async () => {
                if (!referralCode.trim() || !state.businessOwnerId) return;
                setReferralLoading(true);
                setReferralError("");
                try {
                  const result = await applyReferralMutation.mutateAsync({
                    code: referralCode.trim(),
                    referredBusinessOwnerId: state.businessOwnerId,
                  });
                  setReferralApplied(true);
                  setReferralDiscount({ percent: result.discountPercent, months: result.discountMonths });
                  setAppliedReferralCodeId((result as any).referralCodeId ?? null);
                  setReferrerBusinessName((result as any).referrerBusinessName ?? null);
                } catch (e: any) {
                  setReferralError(e?.message ?? "Invalid code");
                } finally {
                  setReferralLoading(false);
                }
              }}
              style={({ pressed }) => ({
                height: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center",
                backgroundColor: "rgba(74,222,128,0.15)", borderWidth: 1,
                borderColor: "rgba(74,222,128,0.4)", opacity: pressed ? 0.7 : 1,
              })}
            >
              {referralLoading
                ? <ActivityIndicator size="small" color="#4ade80" />
                : <Text style={{ color: "#4ade80", fontWeight: "700", fontSize: 14 }}>Apply</Text>
              }
            </Pressable>
          </View>
        ) : (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 8, padding: 12,
            backgroundColor: "rgba(74,222,128,0.1)", borderRadius: 12,
            borderWidth: 1, borderColor: "rgba(74,222,128,0.3)",
          }}>
            <Text style={{ fontSize: 18 }}>🎉</Text>
            <Text style={{ flex: 1, fontSize: 13, color: "#4ade80", fontWeight: "600" }}>
              {referrerBusinessName
                ? `Referred by ${referrerBusinessName}! ${referralDiscount?.percent ?? 50}% off your first ${referralDiscount?.months ?? 3} months.`
                : `Referral applied! ${referralDiscount?.percent ?? 50}% off your first ${referralDiscount?.months ?? 3} months.`}
            </Text>
            <Pressable
              onPress={() => {
                setReferralApplied(false);
                setAppliedReferralCodeId(null);
                setReferralDiscount(null);
                setReferrerBusinessName(null);
                setReferralCode("");
                setReferralError("");
              }}
              style={({ pressed }) => ({
                padding: 6, borderRadius: 8,
                backgroundColor: "rgba(255,255,255,0.08)",
                opacity: pressed ? 0.6 : 1,
              })}
              hitSlop={8}
            >
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: "600" }}>{"\u2715"}</Text>
            </Pressable>
          </View>
        )}
        {!!referralError && (
          <Text style={{ fontSize: 12, color: "#f87171", marginTop: 4, marginLeft: 4 }}>{referralError}</Text>
        )}
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
