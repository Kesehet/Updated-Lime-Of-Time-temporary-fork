/**
 * PlanCarousel — Horizontal swipe carousel, one plan per screen.
 * Full-gradient background per card, big price, feature checklist, CTA.
 * All existing logic (downgrade checks, Stripe checkout, compare modal) preserved.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Modal,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/use-colors";
import { formatPrice } from "@/lib/utils";

const { width: SCREEN_W } = Dimensions.get("window");

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
const PLAN_GRADIENTS: Record<string, readonly [string, string, string]> = {
  solo:       ["#1a2a1a", "#0D2318", "#0a1a0a"] as const,
  growth:     ["#0a2240", "#0D2318", "#0a1a20"] as const,
  studio:     ["#1a0a30", "#0D2318", "#120a20"] as const,
  enterprise: ["#2a1a00", "#0D2318", "#1a1000"] as const,
};

const PLAN_ACCENT: Record<string, string> = {
  solo:       "#4ade80",
  growth:     "#34d399",
  studio:     "#a78bfa",
  enterprise: "#fbbf24",
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

// ─── Single Plan Slide ────────────────────────────────────────────────────────
function PlanSlide({
  plan,
  isYearly,
  onSelect,
  isLoading,
  isCurrentPlan,
  isUpgrade,
  slideWidth,
}: {
  plan: PlanData;
  isYearly: boolean;
  onSelect: () => void;
  isLoading: boolean;
  isCurrentPlan: boolean;
  isUpgrade?: boolean;
  slideWidth: number;
}) {
  const colors = useColors();
  const gradients = PLAN_GRADIENTS[plan.planKey] ?? PLAN_GRADIENTS.solo;
  const accent = PLAN_ACCENT[plan.planKey] ?? "#4ade80";
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

  const priceInt = isFree ? "0" : Math.floor(rawPrice).toString();
  const priceDec = isFree ? ".00" : ("." + (rawPrice % 1).toFixed(2).slice(2));

  const ctaLabel = isCurrentPlan
    ? "✓ Current Plan"
    : isFree
    ? "Downgrade to Free"
    : isUpgrade
    ? `Upgrade to ${plan.displayName}`
    : `Downgrade to ${plan.displayName}`;

  return (
    <View style={[ss.slide, { width: slideWidth }]}>
      <LinearGradient
        colors={[...gradients] as [string, string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={ss.gradient}
      >
        {/* Top badges */}
        <View style={ss.topBadgeRow}>
          {isPopular && (
            <View style={[ss.badge, { backgroundColor: accent + "30", borderColor: accent + "60" }]}>
              <Text style={[ss.badgeText, { color: accent }]}>⭐ MOST POPULAR</Text>
            </View>
          )}
          {isCurrentPlan && (
            <View style={[ss.badge, { backgroundColor: "#22C55E30", borderColor: "#22C55E60" }]}>
              <Text style={[ss.badgeText, { color: "#4ade80" }]}>✓ YOUR PLAN</Text>
            </View>
          )}
          {hasDiscount && (
            <View style={[ss.badge, { backgroundColor: "#F59E0B30", borderColor: "#F59E0B60" }]}>
              <Text style={[ss.badgeText, { color: "#FCD34D" }]}>
                🏷️ {plan.discountLabel ?? `${plan.discountPercent}% OFF`}
              </Text>
            </View>
          )}
          {hasDiscount && discDaysLeft !== null && (
            <View style={[ss.badge, { backgroundColor: "#EF444430", borderColor: "#EF444460" }]}>
              <Text style={[ss.badgeText, { color: "#FCA5A5" }]}>
                ⏰ {discDaysLeft === 0 ? "Expires today" : `${discDaysLeft}d left`}
              </Text>
            </View>
          )}
        </View>

        {/* Plan name + emoji */}
        <View style={ss.nameRow}>
          <Text style={ss.emoji}>{emoji}</Text>
          <Text style={[ss.planName, { color: accent }]}>{plan.displayName}</Text>
        </View>

        {/* Big price */}
        <View style={ss.priceRow}>
          <Text style={[ss.currency, { color: "rgba(255,255,255,0.7)" }]}>$</Text>
          <Text style={ss.priceInt}>{priceInt}</Text>
          <View style={ss.priceRight}>
            <Text style={[ss.priceDec, { color: "rgba(255,255,255,0.7)" }]}>{priceDec}</Text>
            <Text style={[ss.pricePer, { color: "rgba(255,255,255,0.5)" }]}>
              {isFree ? "forever" : "/mo"}
            </Text>
          </View>
        </View>

        {/* Yearly billing note */}
        {isYearly && !isFree && (
          <Text style={ss.billedNote}>
            Billed ${effectiveYearly.toFixed(2)}/yr
            {savings > 0 ? `  ·  Save ${savings}%` : ""}
          </Text>
        )}
        {hasDiscount && rawOriginal > rawPrice && (
          <Text style={[ss.billedNote, { textDecorationLine: "line-through", opacity: 0.5 }]}>
            Was ${rawOriginal.toFixed(2)}/mo
          </Text>
        )}

        {/* Tagline */}
        <Text style={ss.tagline}>{tagline}</Text>

        {/* Divider */}
        <View style={[ss.divider, { backgroundColor: accent + "40" }]} />

        {/* Feature list */}
        <ScrollView
          style={ss.featureScroll}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {features.map((feat, i) => (
            <View key={i} style={ss.featureRow}>
              <View style={[ss.checkDot, { backgroundColor: accent + "25", borderColor: accent + "50" }]}>
                <Text style={[ss.checkMark, { color: accent }]}>✓</Text>
              </View>
              <Text style={ss.featureText}>{feat}</Text>
            </View>
          ))}
        </ScrollView>

        {/* CTA */}
        <Pressable
          onPress={onSelect}
          disabled={isLoading || isCurrentPlan}
          style={({ pressed }) => [
            ss.cta,
            {
              backgroundColor: isCurrentPlan ? "rgba(255,255,255,0.1)" : accent,
              opacity: pressed || isLoading ? 0.8 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              borderColor: isCurrentPlan ? "rgba(255,255,255,0.2)" : "transparent",
              borderWidth: isCurrentPlan ? 1 : 0,
            },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={[ss.ctaText, { color: isCurrentPlan ? "rgba(255,255,255,0.5)" : "#0D2318" }]}>
              {ctaLabel}
            </Text>
          )}
        </Pressable>
      </LinearGradient>
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
  containerWidth,
  isOnboarding = false,
}: PlanCarouselProps) {
  const colors = useColors();
  const [showCompare, setShowCompare] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const slideWidth = (containerWidth ?? SCREEN_W) - 32; // 16px padding each side

  // Reset to first slide when remounted (onboarding flow)
  useEffect(() => {
    if (isOnboarding) {
      setActiveIdx(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [isOnboarding]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / (slideWidth + 16));
      setActiveIdx(Math.max(0, Math.min(idx, plans.length - 1)));
    },
    [slideWidth, plans.length],
  );

  const scrollTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, plans.length - 1));
    scrollRef.current?.scrollTo({ x: clamped * (slideWidth + 16), animated: true });
    setActiveIdx(clamped);
  };

  if (isLoading) {
    return (
      <View style={[ss.center, { backgroundColor: "#0D2318" }]}>
        <ActivityIndicator color="#4ade80" size="large" />
        <Text style={[ss.loadingText, { color: "rgba(255,255,255,0.5)" }]}>Loading plans…</Text>
      </View>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <View style={[ss.center, { backgroundColor: "#0D2318" }]}>
        <Text style={[ss.loadingText, { color: "rgba(255,255,255,0.5)" }]}>No plans available.</Text>
      </View>
    );
  }

  const currentIdx = plans.findIndex((p) => p.planKey === currentPlanKey);

  return (
    <View style={ss.container}>
      {/* Billing Toggle */}
      <View style={ss.toggleWrap}>
        <Pressable
          onPress={() => onToggleBilling(false)}
          style={[ss.toggleBtn, !isYearly && ss.toggleBtnActive]}
        >
          <Text style={[ss.toggleText, { color: isYearly ? "rgba(255,255,255,0.45)" : "#0D2318" }]}>
            Monthly
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onToggleBilling(true)}
          style={[ss.toggleBtn, isYearly && ss.toggleBtnActive]}
        >
          <Text style={[ss.toggleText, { color: !isYearly ? "rgba(255,255,255,0.45)" : "#0D2318" }]}>
            Yearly
          </Text>
          <View style={ss.savePill}>
            <Text style={ss.savePillText}>SAVE 20%</Text>
          </View>
        </Pressable>
      </View>

      {/* Horizontal carousel */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToInterval={slideWidth + 16}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}
        onMomentumScrollEnd={handleScroll}
        onScrollEndDrag={handleScroll}
        scrollEventThrottle={16}
      >
        {plans.map((plan, idx) => (
          <PlanSlide
            key={plan.planKey}
            plan={plan}
            isYearly={isYearly}
            onSelect={() => onSelectPlan(plan.planKey, isYearly ? "yearly" : "monthly")}
            isLoading={loadingPlanKey === plan.planKey}
            isCurrentPlan={currentPlanKey === plan.planKey}
            isUpgrade={currentIdx !== -1 ? idx > currentIdx : true}
            slideWidth={slideWidth}
          />
        ))}
      </ScrollView>

      {/* Navigation arrows + dots */}
      <View style={ss.navRow}>
        <Pressable
          onPress={() => scrollTo(activeIdx - 1)}
          disabled={activeIdx === 0}
          style={({ pressed }) => [
            ss.navArrow,
            { opacity: activeIdx === 0 ? 0.25 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={ss.navArrowText}>‹</Text>
        </Pressable>

        <View style={ss.dotsRow}>
          {plans.map((_, i) => (
            <Pressable key={i} onPress={() => scrollTo(i)}>
              <View
                style={[
                  ss.dot,
                  i === activeIdx
                    ? { backgroundColor: PLAN_ACCENT[plans[i]?.planKey] ?? "#4ade80", width: 20 }
                    : { backgroundColor: "rgba(255,255,255,0.2)", width: 8 },
                ]}
              />
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => scrollTo(activeIdx + 1)}
          disabled={activeIdx === plans.length - 1}
          style={({ pressed }) => [
            ss.navArrow,
            { opacity: activeIdx === plans.length - 1 ? 0.25 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={ss.navArrowText}>›</Text>
        </Pressable>
      </View>

      {/* Plan counter */}
      <Text style={ss.planCounter}>
        {activeIdx + 1} of {plans.length} plans
      </Text>

      {/* Compare link */}
      <Pressable
        onPress={() => setShowCompare(true)}
        style={({ pressed }) => [ss.compareBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={ss.compareBtnText}>📊 Compare all plans</Text>
      </Pressable>

      {/* Plan Comparison Modal */}
      <Modal
        visible={showCompare}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCompare(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#0D2318" }}>
          <View style={[ss.compareHeader, { borderBottomColor: "rgba(255,255,255,0.1)" }]}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff" }}>Compare Plans</Text>
            <Pressable
              onPress={() => setShowCompare(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: "#4ade80" }}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: "row" }}>
                <View style={[ss.compareCell, ss.compareLabelCol, { backgroundColor: "#0D2318" }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.4)" }}>FEATURE</Text>
                </View>
                {COMPARE_PLANS.map((p) => (
                  <View key={p.planKey} style={[ss.compareCell, ss.comparePlanCol, { backgroundColor: p.color + "18" }]}>
                    <View style={[ss.comparePlanDot, { backgroundColor: p.color }]} />
                    <Text style={{ fontSize: 13, fontWeight: "700", color: p.color }} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                      {p.monthlyPrice === 0 ? "Free" : `${formatPrice(p.monthlyPrice)}/mo`}
                    </Text>
                  </View>
                ))}
              </View>
              {COMPARE_FEATURE_ROWS.map((row) => (
                <View key={row} style={{ flexDirection: "row" }}>
                  <View style={[ss.compareCell, ss.compareLabelCol, { backgroundColor: "#0D2318" }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.7)" }}>{row}</Text>
                  </View>
                  {COMPARE_PLANS.map((p) => {
                    const feat = p.features.find((f) => f.label === row);
                    const isDim = (feat as any)?.dim === true;
                    return (
                      <View key={p.planKey} style={[ss.compareCell, ss.comparePlanCol, { backgroundColor: p.color + "08" }]}>
                        <Text style={{ fontSize: 12, color: isDim ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)", textAlign: "center" }} numberOfLines={2}>
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
    </View>
  );
}

// ─── Comparison Data ──────────────────────────────────────────────────────────
const COMPARE_PLANS = [
  {
    planKey: "solo", displayName: "Solo", monthlyPrice: 0, color: "#4ade80",
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
    planKey: "growth", displayName: "Growth", monthlyPrice: 19, color: "#34d399",
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
    planKey: "studio", displayName: "Studio", monthlyPrice: 39, color: "#a78bfa",
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
    planKey: "enterprise", displayName: "Enterprise", monthlyPrice: 69, color: "#fbbf24",
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
const ss = StyleSheet.create({
  container: {
    width: "100%",
  },
  center: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  // Billing toggle
  toggleWrap: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 3,
    marginBottom: 20,
    alignSelf: "center",
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 11,
    gap: 6,
  },
  toggleBtnActive: {
    backgroundColor: "#4ade80",
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
    color: "#0D2318",
    letterSpacing: 0.5,
  },
  // Slide
  slide: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  gradient: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 24,
    minHeight: 480,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  topBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 16,
    minHeight: 24,
  },
  badge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  emoji: {
    fontSize: 28,
  },
  planName: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  currency: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 10,
    marginRight: 2,
  },
  priceInt: {
    fontSize: 72,
    fontWeight: "900",
    color: "#fff",
    lineHeight: 76,
    letterSpacing: -3,
  },
  priceRight: {
    flexDirection: "column",
    justifyContent: "flex-end",
    paddingBottom: 8,
    marginLeft: 3,
  },
  priceDec: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24,
  },
  pricePer: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 16,
  },
  billedNote: {
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 2,
    fontWeight: "500",
  },
  tagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.55)",
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    marginBottom: 14,
  },
  featureScroll: {
    maxHeight: 200,
    marginBottom: 18,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    gap: 12,
  },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkMark: {
    fontSize: 11,
    fontWeight: "900",
  },
  featureText: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255,255,255,0.8)",
    flex: 1,
    lineHeight: 20,
  },
  cta: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  // Navigation
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    gap: 16,
  },
  navArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  navArrowText: {
    fontSize: 22,
    color: "#fff",
    fontWeight: "300",
    lineHeight: 26,
    marginTop: -2,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  planCounter: {
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.3)",
    marginTop: 8,
    fontWeight: "500",
  },
  compareBtn: {
    alignSelf: "center",
    marginTop: 14,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.3)",
    backgroundColor: "rgba(74,222,128,0.08)",
  },
  compareBtnText: {
    fontSize: 13,
    color: "#4ade80",
    fontWeight: "600",
  },
  // Compare modal
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
    borderBottomColor: "rgba(255,255,255,0.06)",
    minHeight: 44,
  },
  compareLabelCol: {
    width: 140,
    alignItems: "flex-start",
  },
  comparePlanCol: {
    width: 110,
  },
  comparePlanDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 4,
  },
});
