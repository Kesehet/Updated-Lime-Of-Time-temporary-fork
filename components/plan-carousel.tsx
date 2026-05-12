/**
 * PlanCarousel — Professional subscription plan selector.
 * Full-page layout with centered cards, 14-day trial badge, compare modal.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import * as Haptics from "expo-haptics";
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
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

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
  isTrialEligible?: boolean;
};

// ─── Plan Config ──────────────────────────────────────────────────────────────
const PLAN_CONFIG: Record<string, {
  accent: string;
  topColor: string;
  bottomColor: string;
  label: string;
  tagline: string;
}> = {
  solo: {
    accent: "#4ade80",
    topColor: "#0a1f12",
    bottomColor: "#061209",
    label: "STARTER",
    tagline: "Perfect for solo practitioners",
  },
  growth: {
    accent: "#34d399",
    topColor: "#071a16",
    bottomColor: "#04100e",
    label: "MOST POPULAR",
    tagline: "Scale your business fast",
  },
  studio: {
    accent: "#a78bfa",
    topColor: "#120a1f",
    bottomColor: "#0a0614",
    label: "PRO",
    tagline: "For established studios",
  },
  enterprise: {
    accent: "#fbbf24",
    topColor: "#1a1200",
    bottomColor: "#100b00",
    label: "ENTERPRISE",
    tagline: "Multi-location powerhouse",
  },
};

const PLAN_FEATURES: Record<string, Array<{ text: string }>> = {
  solo: [
    { text: "Up to 20 clients" },
    { text: "Up to 5 services" },
    { text: "50 appointments/month" },
    { text: "1 location" },
    { text: "Cash & P2P payments" },
    { text: "Online booking page" },
    { text: "Basic analytics" },
  ],
  growth: [
    { text: "Up to 100 clients" },
    { text: "Up to 20 services" },
    { text: "Up to 2 staff members" },
    { text: "Unlimited appointments" },
    { text: "1 location" },
    { text: "SMS confirmations" },
    { text: "Full analytics" },
  ],
  studio: [
    { text: "Unlimited clients" },
    { text: "Unlimited services" },
    { text: "Up to 10 staff members" },
    { text: "Unlimited appointments" },
    { text: "Up to 3 locations" },
    { text: "Full SMS automation" },
    { text: "Stripe payments" },
    { text: "Staff analytics" },
  ],
  enterprise: [
    { text: "Unlimited clients" },
    { text: "Unlimited services" },
    { text: "Up to 100 staff members" },
    { text: "Unlimited appointments" },
    { text: "Up to 10 locations" },
    { text: "Full SMS automation" },
    { text: "Stripe payments" },
    { text: "Multi-location analytics" },
    { text: "Priority support" },
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
  slideHeight,
  isTrialEligible,
}: {
  plan: PlanData;
  isYearly: boolean;
  onSelect: () => void;
  isLoading: boolean;
  isCurrentPlan: boolean;
  isUpgrade?: boolean;
  slideWidth: number;
  slideHeight?: number;
  isTrialEligible?: boolean;
}) {
  const cfg = PLAN_CONFIG[plan.planKey] ?? PLAN_CONFIG.solo;
  const features = PLAN_FEATURES[plan.planKey] ?? [];
  const isFree = plan.monthlyPrice === 0;
  const isPopular = plan.planKey === "growth";
  const effectiveMonthly = plan.effectiveMonthlyPrice ?? plan.monthlyPrice;
  const effectiveYearly = plan.effectiveYearlyPrice ?? plan.yearlyPrice;
  const rawPrice = isYearly ? effectiveYearly / 12 : effectiveMonthly;
  const rawOriginal = isYearly ? plan.yearlyPrice / 12 : plan.monthlyPrice;
  const hasDiscount = (plan.discountPercent ?? 0) > 0;
  const savings =
    isYearly && !isFree && effectiveMonthly > 0
      ? Math.round(((effectiveMonthly * 12 - effectiveYearly) / (effectiveMonthly * 12)) * 100)
      : 0;
  const priceWhole = isFree ? "0" : Math.floor(rawPrice).toString();
  const priceCents = isFree ? "00" : (rawPrice % 1).toFixed(2).slice(2);

  // CTA label
  let ctaLabel = "";
  if (isCurrentPlan) {
    ctaLabel = "Current Plan";
  } else if (isFree) {
    ctaLabel = "Continue with Free";
  } else if (isTrialEligible && !isFree) {
    ctaLabel = "Start 14-Day Free Trial";
  } else if (isUpgrade) {
    ctaLabel = "Upgrade to " + plan.displayName;
  } else {
    ctaLabel = "Switch to " + plan.displayName;
  }

  // Subtle fade-in on mount
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 280 });
  }, []);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[{ width: slideWidth, height: slideHeight || undefined }, fadeStyle]}>
      <LinearGradient
        colors={[cfg.topColor, cfg.bottomColor]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[ss.card, { borderColor: cfg.accent + "22" }]}
      >
        {/* Top accent bar */}
        <View style={[ss.accentBar, { backgroundColor: cfg.accent }]} />

        {/* Header: badge + plan name */}
        <View style={ss.cardHeader}>
          <View style={[ss.badge, { backgroundColor: cfg.accent + "18", borderColor: cfg.accent + "40" }]}>
            <Text style={[ss.badgeText, { color: cfg.accent }]}>{cfg.label}</Text>
          </View>
          {isCurrentPlan && (
            <View style={[ss.currentBadge, { backgroundColor: cfg.accent + "18", borderColor: cfg.accent + "40" }]}>
              <Text style={[ss.badgeText, { color: cfg.accent }]}>{"YOUR PLAN"}</Text>
            </View>
          )}
          {isPopular && !isCurrentPlan && (
            <View style={[ss.popularBadge]}>
              <Text style={ss.popularBadgeText}>{"Popular"}</Text>
            </View>
          )}
        </View>

        {/* Plan name + tagline */}
        <Text style={[ss.planName, { color: "#ffffff" }]}>{plan.displayName}</Text>
        <Text style={ss.planTagline}>{cfg.tagline}</Text>

        {/* 14-day trial badge */}
        {isTrialEligible && !isFree && !isCurrentPlan && (
          <View style={[ss.trialBadge, { backgroundColor: cfg.accent + "18", borderColor: cfg.accent + "40" }]}>
            <Text style={[ss.trialBadgeText, { color: cfg.accent }]}>{"14-day free trial included"}</Text>
          </View>
        )}

        {/* Price */}
        <View style={ss.priceRow}>
          <Text style={[ss.priceCurrency, { color: cfg.accent }]}>{"$"}</Text>
          <Text style={[ss.priceWhole, { color: "#ffffff" }]}>{priceWhole}</Text>
          <View style={ss.priceRight}>
            <Text style={[ss.priceCents, { color: cfg.accent }]}>{"." + priceCents}</Text>
            <Text style={ss.pricePer}>{isFree ? "forever" : "/mo"}</Text>
          </View>
          {isYearly && !isFree && savings > 0 && (
            <View style={[ss.savingsPill, { backgroundColor: cfg.accent + "20", borderColor: cfg.accent + "40" }]}>
              <Text style={[ss.savingsPillText, { color: cfg.accent }]}>{"Save " + savings + "%"}</Text>
            </View>
          )}
        </View>
        {isYearly && !isFree && (
          <Text style={ss.billedNote}>
            {"Billed $" + effectiveYearly.toFixed(2) + "/year"}
          </Text>
        )}
        {hasDiscount && rawOriginal > rawPrice && (
          <Text style={[ss.billedNote, { textDecorationLine: "line-through", color: "rgba(255,255,255,0.25)" }]}>
            {"Was $" + rawOriginal.toFixed(2) + "/mo"}
          </Text>
        )}

        {/* Divider */}
        <View style={[ss.divider, { backgroundColor: cfg.accent + "30" }]} />

        {/* Features */}
        <ScrollView
          style={ss.featureScroll}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {features.map((f, i) => (
            <View key={i} style={ss.featureRow}>
              <View style={[ss.checkCircle, { backgroundColor: cfg.accent + "18" }]}>
                <Text style={[ss.checkMark, { color: cfg.accent }]}>{"✓"}</Text>
              </View>
              <Text style={ss.featureText}>{f.text}</Text>
            </View>
          ))}
        </ScrollView>

        {/* CTA */}
        <Pressable
          onPress={isCurrentPlan ? undefined : onSelect}
          style={({ pressed }) => [
            ss.cta,
            isCurrentPlan
              ? [ss.ctaDisabled, { borderColor: cfg.accent + "30" }]
              : [{ backgroundColor: cfg.accent }, pressed && { opacity: 0.85 }],
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color={isCurrentPlan ? cfg.accent : "#000"} size="small" />
          ) : (
            <Text style={[ss.ctaText, { color: isCurrentPlan ? cfg.accent : "#000" }]}>
              {ctaLabel}
            </Text>
          )}
        </Pressable>
      </LinearGradient>
    </Animated.View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function PlanCarousel({
  plans,
  isLoading = false,
  isYearly,
  onToggleBilling,
  onSelectPlan,
  loadingPlanKey = null,
  currentPlanKey = null,
  containerWidth,
  isOnboarding = false,
  isTrialEligible = false,
}: PlanCarouselProps) {
  const [showCompare, setShowCompare] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [carouselHeight, setCarouselHeight] = useState(0);

  // Card width: full width minus side padding, centered
  const availableWidth = containerWidth ?? SCREEN_W;
  // Use 88% of available width for the card, capped at 420px
  const slideWidth = Math.min(Math.round(availableWidth * 0.88), 420);
  // Center padding: each card centers on screen when scrolled to it
  // With snapToAlignment="center", the snap point is the center of each item
  // So we need sidePad = (availableWidth - slideWidth) / 2 for first/last card
  const sidePad = Math.max(0, Math.round((availableWidth - slideWidth) / 2));

  useEffect(() => {
    if (isOnboarding) {
      setActiveIdx(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [isOnboarding]);

  // snapToOffsets: each card's left edge position so that the card is centered in the viewport
  // Card i starts at: sidePad + i * (slideWidth + 16)
  // To center card i: scroll to sidePad + i*(slideWidth+16) - sidePad = i*(slideWidth+16)
  // But with paddingHorizontal=sidePad, the first card's left edge is at x=0 in content coords
  // The scroll offset to center card i = i * (slideWidth + 16)
  const snapOffsets = plans.map((_, i) => i * (slideWidth + 16));

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / (slideWidth + 16));
      const clamped = Math.max(0, Math.min(idx, plans.length - 1));
      if (clamped !== activeIdx) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      setActiveIdx(clamped);
    },
    [slideWidth, plans.length, activeIdx],
  );

  const scrollTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, plans.length - 1));
    if (clamped !== activeIdx) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    scrollRef.current?.scrollTo({ x: clamped * (slideWidth + 16), animated: true });
    setActiveIdx(clamped);
  };

  if (isLoading) {
    return (
      <View style={ss.center}>
        <ActivityIndicator color="#4ade80" size="large" />
        <Text style={ss.loadingText}>{"Loading plans..."}</Text>
      </View>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <View style={ss.center}>
        <Text style={ss.loadingText}>{"No plans available."}</Text>
      </View>
    );
  }

  const currentIdx = plans.findIndex((p) => p.planKey === currentPlanKey);
  const activePlan = plans[activeIdx];
  const activeCfg = activePlan ? (PLAN_CONFIG[activePlan.planKey] ?? PLAN_CONFIG.solo) : PLAN_CONFIG.solo;

  // slideHeight: fill the carousel container minus the toggle + nav rows (~120px)
  const slideHeight = carouselHeight > 200 ? carouselHeight - 120 : SCREEN_H * 0.60;

  return (
    <View style={[ss.container, { flex: 1 }]} onLayout={(e) => setCarouselHeight(e.nativeEvent.layout.height)}>
      {/* Billing Toggle */}
      <View style={ss.toggleWrap}>
        <Pressable
          onPress={() => onToggleBilling(false)}
          style={[ss.toggleBtn, !isYearly && [ss.toggleBtnActive, { backgroundColor: activeCfg.accent }]]}
        >
          <Text style={[ss.toggleText, { color: !isYearly ? "#000" : "rgba(255,255,255,0.5)" }]}>
            {"Monthly"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onToggleBilling(true)}
          style={[ss.toggleBtn, isYearly && [ss.toggleBtnActive, { backgroundColor: activeCfg.accent }]]}
        >
          <Text style={[ss.toggleText, { color: isYearly ? "#000" : "rgba(255,255,255,0.5)" }]}>
            {"Yearly"}
          </Text>
          {!isYearly && (
            <View style={ss.savePill}>
              <Text style={ss.savePillText}>{"-20%"}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Carousel — centered */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToOffsets={snapOffsets}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: sidePad,
          gap: 16,
          alignItems: "stretch",
        }}
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
            slideHeight={slideHeight}
            isTrialEligible={isTrialEligible}
          />
        ))}
      </ScrollView>

      {/* Nav row */}
      <View style={ss.navRow}>
        <Pressable
          onPress={() => scrollTo(activeIdx - 1)}
          disabled={activeIdx === 0}
          style={({ pressed }) => [
            ss.navArrow,
            { opacity: activeIdx === 0 ? 0.2 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[ss.navArrowText, { color: activeCfg.accent }]}>{"‹"}</Text>
        </Pressable>
        <View style={ss.dotsRow}>
          {plans.map((p, i) => {
            const dotCfg = PLAN_CONFIG[p.planKey] ?? PLAN_CONFIG.solo;
            const isActive = i === activeIdx;
            return (
              <Pressable key={i} onPress={() => scrollTo(i)}>
                <View
                  style={[
                    ss.dot,
                    isActive
                      ? { backgroundColor: dotCfg.accent, width: 24 }
                      : { backgroundColor: "rgba(255,255,255,0.2)", width: 8 },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => scrollTo(activeIdx + 1)}
          disabled={activeIdx === plans.length - 1}
          style={({ pressed }) => [
            ss.navArrow,
            { opacity: activeIdx === plans.length - 1 ? 0.2 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[ss.navArrowText, { color: activeCfg.accent }]}>{"›"}</Text>
        </Pressable>
      </View>

      {/* Compare link */}
      <Pressable
        onPress={() => setShowCompare(true)}
        style={({ pressed }) => [ss.compareBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[ss.compareBtnText, { color: activeCfg.accent }]}>{"Compare all plans →"}</Text>
      </Pressable>

      {/* Compare Modal */}
      <Modal
        visible={showCompare}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCompare(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0f0a" }}>
          <View style={ss.compareHeader}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff", letterSpacing: -0.3 }}>{"Compare Plans"}</Text>
            <Pressable
              onPress={() => setShowCompare(false)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "rgba(74,222,128,0.12)",
                borderWidth: 1,
                borderColor: "rgba(74,222,128,0.3)",
              })}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#4ade80" }}>{"Done"}</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: "row" }}>
                <View style={[ss.compareCell, ss.compareLabelCol]}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(74,222,128,0.5)", letterSpacing: 1 }}>{"FEATURE"}</Text>
                </View>
                {COMPARE_PLANS.map((p) => (
                  <View key={p.planKey} style={[ss.compareCell, ss.comparePlanCol, { backgroundColor: p.neon + "10" }]}>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: p.neon }} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                      {p.monthlyPrice === 0 ? "Free" : "$" + p.monthlyPrice + "/mo"}
                    </Text>
                  </View>
                ))}
              </View>
              {COMPARE_FEATURE_ROWS.map((row, ri) => (
                <View key={row} style={{ flexDirection: "row", backgroundColor: ri % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <View style={[ss.compareCell, ss.compareLabelCol]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.6)" }}>{row}</Text>
                  </View>
                  {COMPARE_PLANS.map((p) => {
                    const feat = p.features.find((f) => f.label === row);
                    const isDim = (feat as any)?.dim === true;
                    const featValue = feat?.value ?? "—";
                    return (
                      <View key={p.planKey} style={[ss.compareCell, ss.comparePlanCol, { backgroundColor: p.neon + "05" }]}>
                        <Text style={{ fontSize: 12, color: isDim ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.8)", textAlign: "center" }} numberOfLines={2}>
                          {featValue}
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
    planKey: "solo", displayName: "Solo", monthlyPrice: 0, neon: "#4ade80",
    features: [
      { label: "Clients", value: "Up to 20" },
      { label: "Services", value: "Up to 5" },
      { label: "Staff", value: "1 (you)" },
      { label: "Locations", value: "1" },
      { label: "Appointments", value: "50/month" },
      { label: "SMS", value: "Not included", dim: true },
      { label: "Payments", value: "Cash & P2P" },
      { label: "Analytics", value: "Basic" },
    ],
  },
  {
    planKey: "growth", displayName: "Growth", monthlyPrice: 19, neon: "#34d399",
    features: [
      { label: "Clients", value: "Up to 100" },
      { label: "Services", value: "Up to 20" },
      { label: "Staff", value: "Up to 2" },
      { label: "Locations", value: "1" },
      { label: "Appointments", value: "Unlimited" },
      { label: "SMS", value: "Confirmations" },
      { label: "Payments", value: "Cash & P2P" },
      { label: "Analytics", value: "Full" },
    ],
  },
  {
    planKey: "studio", displayName: "Studio", monthlyPrice: 39, neon: "#a78bfa",
    features: [
      { label: "Clients", value: "Unlimited" },
      { label: "Services", value: "Unlimited" },
      { label: "Staff", value: "Up to 10" },
      { label: "Locations", value: "Up to 3" },
      { label: "Appointments", value: "Unlimited" },
      { label: "SMS", value: "Full automation" },
      { label: "Payments", value: "All + Stripe" },
      { label: "Analytics", value: "Full + Staff" },
    ],
  },
  {
    planKey: "enterprise", displayName: "Enterprise", monthlyPrice: 69, neon: "#fbbf24",
    features: [
      { label: "Clients", value: "Unlimited" },
      { label: "Services", value: "Unlimited" },
      { label: "Staff", value: "Up to 100" },
      { label: "Locations", value: "Up to 10" },
      { label: "Appointments", value: "Unlimited" },
      { label: "SMS", value: "Full automation" },
      { label: "Payments", value: "All + Stripe" },
      { label: "Analytics", value: "Full + Multi-loc" },
    ],
  },
];

const COMPARE_FEATURE_ROWS = [
  "Clients", "Services", "Staff", "Locations", "Appointments", "SMS", "Payments", "Analytics",
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  container: { width: "100%" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, color: "rgba(74,222,128,0.5)" },

  // Billing toggle
  toggleWrap: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 22,
    padding: 4,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 18,
    gap: 6,
  },
  toggleBtnActive: {
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toggleText: { fontSize: 14, fontWeight: "700", letterSpacing: 0.2 },
  savePill: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savePillText: { fontSize: 10, fontWeight: "800", color: "#000", letterSpacing: 0.3 },

  // Card
  card: {
    flex: 1,
    borderRadius: 40,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 0,
  },
  accentBar: { height: 3, marginHorizontal: -24, marginBottom: 18 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  badge: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  currentBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  popularBadge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    backgroundColor: "rgba(251,191,36,0.1)",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  popularBadgeText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.8, color: "#fbbf24" },

  // Trial badge
  trialBadge: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
    marginBottom: 12,
  },
  trialBadgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },

  // Plan name
  planName: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, lineHeight: 34, marginBottom: 4 },
  planTagline: { fontSize: 13, color: "rgba(255,255,255,0.45)", fontWeight: "500", marginBottom: 18 },

  // Price
  priceRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 4 },
  priceCurrency: { fontSize: 20, fontWeight: "700", marginTop: 6, marginRight: 1 },
  priceWhole: { fontSize: 56, fontWeight: "900", lineHeight: 60, letterSpacing: -2 },
  priceRight: { flexDirection: "column", justifyContent: "flex-end", paddingBottom: 8, marginLeft: 2 },
  priceCents: { fontSize: 18, fontWeight: "700", lineHeight: 22 },
  pricePer: { fontSize: 12, fontWeight: "500", color: "rgba(255,255,255,0.35)", lineHeight: 16 },
  savingsPill: {
    alignSelf: "flex-start",
    marginTop: 10,
    marginLeft: 10,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  savingsPillText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  billedNote: { fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: "500", marginBottom: 4, marginTop: 2 },

  // Divider
  divider: { height: 1, marginVertical: 14 },

  // Features
  featureScroll: { flex: 1, marginBottom: 16 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 12 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkMark: { fontSize: 11, fontWeight: "900" },
  featureText: { fontSize: 14, fontWeight: "500", color: "rgba(255,255,255,0.75)", flex: 1, lineHeight: 19 },

  // CTA
  cta: {
    borderRadius: 28,
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  ctaText: { fontSize: 16, fontWeight: "800", letterSpacing: 0.2 },

  // Navigation
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 14, gap: 16 },
  navArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  navArrowText: { fontSize: 24, fontWeight: "300", lineHeight: 28, marginTop: -1 },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { height: 6, borderRadius: 3 },

  // Compare
  compareBtn: { alignSelf: "center", marginTop: 10, paddingVertical: 8, paddingHorizontal: 16 },
  compareBtnText: { fontSize: 13, fontWeight: "600", letterSpacing: 0.2 },
  compareHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  compareCell: {
    paddingVertical: 11,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
    minHeight: 46,
  },
  compareLabelCol: { width: 130, alignItems: "flex-start", backgroundColor: "rgba(0,0,0,0.3)" },
  comparePlanCol: { width: 110 },
});
