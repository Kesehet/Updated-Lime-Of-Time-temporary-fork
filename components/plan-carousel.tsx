/**
 * PlanCarousel — Modern subscription plan cards
 * Hero price, gradient banner, feature checklist, prominent CTA.
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/use-colors";
import { formatPrice } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
export type PlanData = {
  planKey: string;
  displayName: string;
  monthlyPrice: number;
  yearlyPrice: number;
  effectiveMonthlyPrice?: number;
  effectiveYearlyPrice?: number;
  discountPercent?: number;
  discountLabel?: string | null;
  discountExpiresAt?: string | null;
  maxClients: number;
  maxAppointments: number;
  maxLocations: number;
  maxStaff: number;
  maxServices: number;
  maxProducts: number;
  smsLevel: string;
  paymentLevel: string;
  sortOrder: number;
};

type PlanCarouselProps = {
  plans: PlanData[];
  isLoading?: boolean;
  isYearly: boolean;
  onToggleBilling: (yearly: boolean) => void;
  onSelectPlan: (planKey: string, period: "monthly" | "yearly") => void;
  loadingPlanKey?: string | null;
  currentPlanKey?: string | null;
  containerWidth?: number;
  isOnboarding?: boolean;
};

// ─── Plan Config ──────────────────────────────────────────────────────────────
const PLAN_GRADIENTS: Record<string, [string, string, string]> = {
  solo:       ["#6B7280", "#4B5563", "#374151"],
  growth:     ["#2563EB", "#1D4ED8", "#1E40AF"],
  studio:     ["#7C3AED", "#6D28D9", "#5B21B6"],
  enterprise: ["#D97706", "#B45309", "#92400E"],
};

const PLAN_EMOJIS: Record<string, string> = {
  solo:       "🌱",
  growth:     "🚀",
  studio:     "💎",
  enterprise: "🏢",
};

const PLAN_TAGLINES: Record<string, string> = {
  solo:       "Perfect for solo practitioners just getting started",
  growth:     "For growing businesses ready to scale up",
  studio:     "For established studios with a full team",
  enterprise: "For multi-location brands at scale",
};

const PLAN_FEATURES: Record<string, string[]> = {
  solo: [
    "Up to 20 clients",
    "Up to 5 services",
    "1 staff member (you)",
    "Up to 50 appointments/month",
    "1 location",
    "Online booking page",
    "Cash & P2P payments",
    "Basic analytics",
  ],
  growth: [
    "Up to 100 clients",
    "Up to 20 services",
    "Up to 2 staff members",
    "Unlimited appointments",
    "1 location",
    "Online booking page",
    "SMS confirmations",
    "Full analytics",
  ],
  studio: [
    "Unlimited clients",
    "Unlimited services",
    "Up to 10 staff members",
    "Unlimited appointments",
    "Up to 3 locations",
    "Online booking page",
    "Full SMS automation",
    "Stripe payments",
    "Staff analytics",
  ],
  enterprise: [
    "Unlimited clients",
    "Unlimited services",
    "Up to 100 staff members",
    "Unlimited appointments",
    "Up to 10 locations",
    "Online booking page",
    "Full SMS automation",
    "Stripe payments",
    "Multi-location analytics",
    "Priority support",
  ],
};

// ─── Plan Card ────────────────────────────────────────────────────────────────
function PlanCard({
  plan,
  isYearly,
  onSelect,
  isLoading,
  isCurrentPlan,
  isUpgrade,
}: {
  plan: PlanData;
  isYearly: boolean;
  onSelect: () => void;
  isLoading: boolean;
  isCurrentPlan: boolean;
  isHighlighted?: boolean;
  isUpgrade?: boolean;
}) {
  const colors = useColors();
  const gradients = (PLAN_GRADIENTS[plan.planKey] ?? PLAN_GRADIENTS.solo) as [string, string, string];
  const emoji = PLAN_EMOJIS[plan.planKey] ?? "✨";
  const tagline = PLAN_TAGLINES[plan.planKey] ?? "";
  const features = PLAN_FEATURES[plan.planKey] ?? [];
  const isPopular = plan.planKey === "growth";
  const isFree = plan.monthlyPrice === 0;

  const effectiveMonthly = plan.effectiveMonthlyPrice ?? plan.monthlyPrice;
  const effectiveYearly = plan.effectiveYearlyPrice ?? plan.yearlyPrice;
  const rawPrice = isYearly ? effectiveYearly / 12 : effectiveMonthly;
  const rawOriginal = isYearly ? plan.yearlyPrice / 12 : plan.monthlyPrice;
  const hasDiscount = (plan.discountPercent ?? 0) > 0;

  const discExpiresAt = plan.discountExpiresAt ? new Date(plan.discountExpiresAt) : null;
  const discDaysLeft = discExpiresAt
    ? Math.max(0, Math.ceil((discExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const savings =
    isYearly && !isFree && effectiveMonthly > 0
      ? Math.round(((effectiveMonthly * 12 - effectiveYearly) / (effectiveMonthly * 12)) * 100)
      : 0;

  const accent = gradients[0];
  const priceInt = isFree ? "0" : Math.floor(rawPrice).toString();
  const priceDec = isFree ? ".00" : ("." + (rawPrice % 1).toFixed(2).slice(2));

  return (
    <View style={[
      styles.card,
      { borderColor: isPopular ? accent : colors.border },
      isPopular && {
        shadowColor: accent,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 10,
      },
    ]}>
      {/* Gradient Hero Banner */}
      <LinearGradient
        colors={gradients}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroBanner}
      >
        {isPopular && (
          <View style={[styles.heroBadgeAbsolute, { backgroundColor: "#F59E0B" }]}>
            <Text style={styles.heroBadgeAbsoluteText}>⭐ MOST POPULAR</Text>
          </View>
        )}
        {isCurrentPlan && (
          <View style={[styles.heroBadgeAbsolute, { backgroundColor: "#22C55E" }]}>
            <Text style={styles.heroBadgeAbsoluteText}>✓ YOUR PLAN</Text>
          </View>
        )}

        <View style={styles.heroNameRow}>
          <Text style={styles.heroEmoji}>{emoji}</Text>
          <Text style={styles.heroPlanName}>{plan.displayName}</Text>
        </View>

        <View style={styles.heroPriceRow}>
          <Text style={styles.heroCurrency}>$</Text>
          <Text style={styles.heroPriceInt}>{priceInt}</Text>
          <View style={styles.heroPriceRight}>
            <Text style={styles.heroPriceDec}>{priceDec}</Text>
            <Text style={styles.heroPricePer}>{isFree ? "forever" : "/mo"}</Text>
          </View>
        </View>

        <Text style={styles.heroTagline}>{tagline}</Text>

        <View style={styles.heroBadgesRow}>
          {hasDiscount && (
            <View style={[styles.heroBadge, { backgroundColor: "#F59E0B30" }]}>
              <Text style={[styles.heroBadgeText, { color: "#FCD34D" }]}>
                🏷️ {plan.discountLabel ?? (plan.discountPercent + "% OFF")}
              </Text>
            </View>
          )}
          {hasDiscount && discDaysLeft !== null && (
            <View style={[styles.heroBadge, { backgroundColor: "#EF444430" }]}>
              <Text style={[styles.heroBadgeText, { color: "#FCA5A5" }]}>
                ⏰ {discDaysLeft === 0 ? "Expires today" : (discDaysLeft + "d left")}
              </Text>
            </View>
          )}
          {isYearly && savings > 0 && (
            <View style={[styles.heroBadge, { backgroundColor: "#22C55E30" }]}>
              <Text style={[styles.heroBadgeText, { color: "#86EFAC" }]}>
                💰 Save {savings}% yearly
              </Text>
            </View>
          )}
          {isYearly && !isFree && (
            <View style={[styles.heroBadge, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Text style={[styles.heroBadgeText, { color: "rgba(255,255,255,0.85)" }]}>
                Billed ${effectiveYearly.toFixed(2)}/yr
              </Text>
            </View>
          )}
          {hasDiscount && rawOriginal > rawPrice && (
            <View style={[styles.heroBadge, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
              <Text style={[styles.heroBadgeText, { color: "rgba(255,255,255,0.55)", textDecorationLine: "line-through" }]}>
                Was ${rawOriginal.toFixed(2)}/mo
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Feature List */}
      <View style={[styles.featureSection, { backgroundColor: colors.surface }]}>
        {features.map((feat, i) => (
          <View
            key={i}
            style={[
              styles.featureRow,
              i < features.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
          >
            <View style={[styles.checkCircle, { backgroundColor: accent + "20" }]}>
              <Text style={[styles.checkMark, { color: accent }]}>✓</Text>
            </View>
            <Text style={[styles.featureText, { color: colors.foreground }]}>{feat}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      <View style={[styles.ctaSection, { backgroundColor: colors.surface }]}>
        <Pressable
          onPress={onSelect}
          disabled={isLoading || isCurrentPlan}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: isCurrentPlan ? colors.border : accent,
              opacity: pressed || isLoading ? 0.8 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={[styles.ctaText, { color: isCurrentPlan ? colors.muted : "#fff" }]}>
              {isCurrentPlan
                ? "✓ Current Plan"
                : isFree
                ? "Downgrade to Free"
                : isUpgrade
                ? ("Upgrade to " + plan.displayName)
                : ("Downgrade to " + plan.displayName)}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function PlanCarousel({
  plans,
  isLoading = false,
  isYearly,
  onToggleBilling,
  onSelectPlan,
  loadingPlanKey,
  currentPlanKey,
  isOnboarding = false,
}: PlanCarouselProps) {
  const colors = useColors();
  const [showCompare, setShowCompare] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isOnboarding && scrollRef.current) {
      scrollRef.current.scrollTo({ y: 0, animated: false });
    }
  }, [isOnboarding]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2563EB" size="large" />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading plans…</Text>
      </View>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={[styles.loadingText, { color: colors.muted }]}>No plans available.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      scrollEnabled={!isOnboarding}
    >
      {/* Billing Toggle */}
      <View style={[styles.toggleWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          onPress={() => onToggleBilling(false)}
          style={[styles.toggleBtn, !isYearly && { backgroundColor: "#2563EB" }]}
        >
          <Text style={[styles.toggleText, { color: isYearly ? colors.muted : "#fff" }]}>
            Monthly
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onToggleBilling(true)}
          style={[styles.toggleBtn, isYearly && { backgroundColor: "#2563EB" }]}
        >
          <Text style={[styles.toggleText, { color: !isYearly ? colors.muted : "#fff" }]}>
            Yearly
          </Text>
          <View style={styles.savePill}>
            <Text style={styles.savePillText}>SAVE 20%</Text>
          </View>
        </Pressable>
      </View>

      {/* Plan list */}
      {(() => {
        const currentIdx = plans.findIndex((p) => p.planKey === currentPlanKey);
        return plans.map((plan, idx) => (
          <View key={plan.planKey} style={{ marginBottom: 24 }}>
            <PlanCard
              plan={plan}
              isYearly={isYearly}
              onSelect={() => onSelectPlan(plan.planKey, isYearly ? "yearly" : "monthly")}
              isLoading={loadingPlanKey === plan.planKey}
              isCurrentPlan={currentPlanKey === plan.planKey}
              isHighlighted={false}
              isUpgrade={currentIdx !== -1 ? idx > currentIdx : true}
            />
          </View>
        ));
      })()}

      {/* Compare link */}
      <Pressable
        onPress={() => setShowCompare(true)}
        style={({ pressed }) => ({
          opacity: pressed ? 0.6 : 1,
          alignSelf: "center",
          marginTop: 4,
          marginBottom: 16,
          paddingVertical: 10,
          paddingHorizontal: 20,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "#2563EB40",
          backgroundColor: "#2563EB10",
        })}
      >
        <Text style={{ fontSize: 13, color: "#2563EB", fontWeight: "600" }}>
          📊 Compare all plans
        </Text>
      </Pressable>

      {/* Plan Comparison Modal */}
      <Modal
        visible={showCompare}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCompare(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.compareHeader, { borderBottomColor: colors.border }]}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Compare Plans</Text>
            <Pressable
              onPress={() => setShowCompare(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: "#2563EB" }}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: "row" }}>
                <View style={[styles.compareCell, styles.compareLabelCol, { backgroundColor: colors.background }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>FEATURE</Text>
                </View>
                {COMPARE_PLANS.map((p) => (
                  <View key={p.planKey} style={[styles.compareCell, styles.comparePlanCol, { backgroundColor: p.color + "18" }]}>
                    <View style={[styles.comparePlanDot, { backgroundColor: p.color }]} />
                    <Text style={{ fontSize: 13, fontWeight: "700", color: p.color }} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                      {p.monthlyPrice === 0 ? "Free" : (formatPrice(p.monthlyPrice) + "/mo")}
                    </Text>
                  </View>
                ))}
              </View>
              {COMPARE_FEATURE_ROWS.map((row) => (
                <View key={row} style={{ flexDirection: "row" }}>
                  <View style={[styles.compareCell, styles.compareLabelCol, { backgroundColor: colors.background }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{row}</Text>
                  </View>
                  {COMPARE_PLANS.map((p) => {
                    const feat = p.features.find((f) => f.label === row);
                    const isDim = (feat as any)?.dim === true;
                    return (
                      <View key={p.planKey} style={[styles.compareCell, styles.comparePlanCol, { backgroundColor: p.color + "08" }]}>
                        <Text style={{ fontSize: 12, color: isDim ? colors.muted : colors.foreground, textAlign: "center" }} numberOfLines={2}>
                          {feat?.value ?? "—"}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

// ─── Comparison Data ──────────────────────────────────────────────────────────
const COMPARE_PLANS = [
  {
    planKey: "solo", displayName: "Solo", monthlyPrice: 0, color: "#6B7280",
    features: [
      { label: "Clients", value: "Up to 20" },
      { label: "Services", value: "Up to 5" },
      { label: "Staff Members", value: "1 (you)" },
      { label: "Products", value: "Up to 5" },
      { label: "Locations", value: "1" },
      { label: "Monthly Appointments", value: "Up to 50" },
      { label: "SMS Automation", value: "Not included", dim: true },
      { label: "Payment Methods", value: "Cash & P2P" },
      { label: "Online Booking", value: "Included" },
      { label: "Analytics", value: "Basic" },
    ],
  },
  {
    planKey: "growth", displayName: "Growth", monthlyPrice: 19, color: "#3B82F6",
    features: [
      { label: "Clients", value: "Up to 100" },
      { label: "Services", value: "Up to 20" },
      { label: "Staff Members", value: "Up to 2" },
      { label: "Products", value: "Up to 20" },
      { label: "Locations", value: "1" },
      { label: "Monthly Appointments", value: "Unlimited" },
      { label: "SMS Automation", value: "Confirmations only" },
      { label: "Payment Methods", value: "Cash & P2P" },
      { label: "Online Booking", value: "Included" },
      { label: "Analytics", value: "Full" },
    ],
  },
  {
    planKey: "studio", displayName: "Studio", monthlyPrice: 39, color: "#8B5CF6",
    features: [
      { label: "Clients", value: "Unlimited" },
      { label: "Services", value: "Unlimited" },
      { label: "Staff Members", value: "Up to 10" },
      { label: "Products", value: "Unlimited" },
      { label: "Locations", value: "Up to 3" },
      { label: "Monthly Appointments", value: "Unlimited" },
      { label: "SMS Automation", value: "Full" },
      { label: "Payment Methods", value: "All + Stripe" },
      { label: "Online Booking", value: "Included" },
      { label: "Analytics", value: "Full + Staff" },
    ],
  },
  {
    planKey: "enterprise", displayName: "Enterprise", monthlyPrice: 69, color: "#F59E0B",
    features: [
      { label: "Clients", value: "Unlimited" },
      { label: "Services", value: "Unlimited" },
      { label: "Staff Members", value: "Up to 100" },
      { label: "Products", value: "Unlimited" },
      { label: "Locations", value: "Up to 10" },
      { label: "Monthly Appointments", value: "Unlimited" },
      { label: "SMS Automation", value: "Full" },
      { label: "Payment Methods", value: "All + Stripe" },
      { label: "Online Booking", value: "Included" },
      { label: "Analytics", value: "Full + Multi-loc" },
    ],
  },
];

const COMPARE_FEATURE_ROWS = [
  "Clients", "Services", "Staff Members", "Products", "Locations",
  "Monthly Appointments", "SMS Automation", "Payment Methods", "Online Booking", "Analytics",
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingHorizontal: 2,
  },
  center: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  toggleWrap: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    marginBottom: 20,
    alignSelf: "center",
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 11,
    gap: 6,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "700",
  },
  savePill: {
    backgroundColor: "#22C55E",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savePillText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden",
    marginHorizontal: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  heroBanner: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
  },
  heroBadgeAbsolute: {
    position: "absolute",
    top: 14,
    right: 14,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  heroBadgeAbsoluteText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.5,
  },
  heroNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  heroEmoji: {
    fontSize: 22,
  },
  heroPlanName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
  },
  heroPriceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  heroCurrency: {
    fontSize: 22,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
    marginTop: 8,
    marginRight: 2,
  },
  heroPriceInt: {
    fontSize: 64,
    fontWeight: "900",
    color: "#fff",
    lineHeight: 68,
    letterSpacing: -2,
  },
  heroPriceRight: {
    flexDirection: "column",
    justifyContent: "flex-end",
    paddingBottom: 6,
    marginLeft: 2,
  },
  heroPriceDec: {
    fontSize: 20,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
    lineHeight: 22,
  },
  heroPricePer: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.65)",
    lineHeight: 16,
  },
  heroTagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    marginBottom: 10,
    lineHeight: 18,
  },
  heroBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  heroBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  heroBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  featureSection: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkMark: {
    fontSize: 12,
    fontWeight: "800",
  },
  featureText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    lineHeight: 20,
  },
  ctaSection: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  cta: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  compareHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compareCell: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
    minHeight: 44,
  },
  compareLabelCol: {
    width: 130,
    alignItems: "flex-start",
  },
  comparePlanCol: {
    width: 100,
  },
  comparePlanDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 3,
  },
});
