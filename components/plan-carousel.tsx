/**
 * PlanCarousel — Professional subscription plan selector.
 * Full-page layout: billing toggle inside card header, pagination dots inside card,
 * compare icon top-right of card. No external header/title — card fills all available space.
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

// ─── Expanded feature lists with benefit context ──────────────────────────────
const PLAN_FEATURES: Record<string, Array<{ text: string; sub?: string }>> = {
  solo: [
    { text: "Up to 20 clients", sub: "Full client profiles & history" },
    { text: "Up to 5 services", sub: "Custom pricing & duration per service" },
    { text: "50 appointments/month", sub: "Calendar view + booking management" },
    { text: "1 business location", sub: "Address, hours & contact info" },
    { text: "Cash & P2P payments", sub: "Zelle, Venmo, CashApp tracking" },
    { text: "Online booking page", sub: "Shareable link for clients to self-book" },
    { text: "Basic analytics", sub: "Revenue & appointment summaries" },
    { text: "Email confirmations", sub: "Auto-sent to clients on booking" },
  ],
  growth: [
    { text: "Up to 100 clients", sub: "Full profiles, notes & visit history" },
    { text: "Up to 20 services", sub: "Packages, bundles & custom pricing" },
    { text: "Up to 2 staff members", sub: "Individual schedules & booking links" },
    { text: "Unlimited appointments", sub: "No monthly cap — grow freely" },
    { text: "1 business location", sub: "Full location management" },
    { text: "SMS confirmations", sub: "Auto-reminders reduce no-shows" },
    { text: "Full analytics", sub: "Revenue trends, top services & clients" },
    { text: "Gift cards", sub: "Sell & redeem digital gift cards" },
    { text: "Discount codes", sub: "Percentage or fixed-amount promos" },
    { text: "Client portal", sub: "Clients view & manage their bookings" },
  ],
  studio: [
    { text: "Unlimited clients", sub: "No cap — scale as you grow" },
    { text: "Unlimited services", sub: "Full catalog with categories" },
    { text: "Up to 10 staff members", sub: "Roles, permissions & schedules" },
    { text: "Unlimited appointments", sub: "Across all staff & services" },
    { text: "Up to 3 locations", sub: "Separate calendars & settings per location" },
    { text: "Full SMS automation", sub: "Reminders, follow-ups & confirmations" },
    { text: "Stripe payments", sub: "Credit card, Apple Pay & Google Pay" },
    { text: "Staff analytics", sub: "Performance & revenue per staff member" },
    { text: "Waitlist management", sub: "Auto-fill cancellations from waitlist" },
    { text: "Custom booking form", sub: "Collect intake info before appointments" },
    { text: "Priority support", sub: "Faster response times" },
  ],
  enterprise: [
    { text: "Unlimited clients", sub: "Enterprise-scale client database" },
    { text: "Unlimited services", sub: "Full catalog across all locations" },
    { text: "Up to 100 staff members", sub: "Full team management & permissions" },
    { text: "Unlimited appointments", sub: "Across all staff, services & locations" },
    { text: "Up to 10 locations", sub: "Unified dashboard for all branches" },
    { text: "Full SMS automation", sub: "Bulk campaigns, reminders & follow-ups" },
    { text: "Stripe payments", sub: "All payment methods + invoicing" },
    { text: "Multi-location analytics", sub: "Compare performance across branches" },
    { text: "Dedicated account manager", sub: "Onboarding & ongoing support" },
    { text: "Custom integrations", sub: "API access & webhook support" },
    { text: "White-label booking page", sub: "Your brand, no Lime Of Time branding" },
    { text: "Priority 24/7 support", sub: "Phone, email & live chat" },
  ],
};

// ─── Single Plan Slide ────────────────────────────────────────────────────────
function PlanSlide({
  plan,
  isYearly,
  onToggleBilling,
  onSelect,
  isLoading,
  isCurrentPlan,
  isUpgrade,
  slideWidth,
  slideHeight,
  isTrialEligible,
  activeIdx,
  totalPlans,
  onPrev,
  onNext,
  onCompare,
}: {
  plan: PlanData;
  isYearly: boolean;
  onToggleBilling: (yearly: boolean) => void;
  onSelect: () => void;
  isLoading: boolean;
  isCurrentPlan: boolean;
  isUpgrade?: boolean;
  slideWidth: number;
  slideHeight?: number;
  isTrialEligible?: boolean;
  activeIdx: number;
  totalPlans: number;
  onPrev: () => void;
  onNext: () => void;
  onCompare: () => void;
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
        {/* ── Card top row: billing toggle (left) + compare icon (right) ── */}
        <View style={ss.cardTopRow}>
          {/* Billing toggle — compact, inside card */}
          <View style={[ss.toggleWrap, { borderColor: cfg.accent + "25" }]}>
            <Pressable
              onPress={() => onToggleBilling(false)}
              style={[ss.toggleBtn, !isYearly && [ss.toggleBtnActive, { backgroundColor: cfg.accent }]]}
            >
              <Text style={[ss.toggleText, { color: !isYearly ? "#000" : "rgba(255,255,255,0.45)" }]}>
                {"Monthly"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onToggleBilling(true)}
              style={[ss.toggleBtn, isYearly && [ss.toggleBtnActive, { backgroundColor: cfg.accent }]]}
            >
              <Text style={[ss.toggleText, { color: isYearly ? "#000" : "rgba(255,255,255,0.45)" }]}>
                {"Yearly"}
              </Text>
              {/* Always show savings pill on Yearly tab so it's always visible */}
              {!isFree && (
                <View style={[ss.savePill, isYearly && { backgroundColor: "rgba(0,0,0,0.3)" }]}>
                  <Text style={[ss.savePillText, { color: isYearly ? "#000" : cfg.accent }]}>
                    {"-20%"}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Compare icon button — top right */}
          <Pressable
            onPress={onCompare}
            style={({ pressed }) => [ss.compareIconBtn, { borderColor: cfg.accent + "35", opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <Text style={[ss.compareIconText, { color: cfg.accent }]}>{"⊞"}</Text>
          </Pressable>
        </View>

        {/* Header: plan tier badge + popular badge */}
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
            <View style={ss.popularBadge}>
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
            <Text style={[ss.trialBadgeText, { color: cfg.accent }]}>{"🎁  14-day free trial included"}</Text>
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
            <View style={[ss.savingsPill, { backgroundColor: cfg.accent + "20", borderColor: cfg.accent + "60" }]}>
              <Text style={[ss.savingsPillText, { color: cfg.accent }]}>{"Save " + savings + "%"}</Text>
            </View>
          )}
        </View>
        {isYearly && !isFree && (
          <View style={[ss.yearlyNote, { backgroundColor: cfg.accent + "12", borderColor: cfg.accent + "30" }]}>
            <Text style={[ss.yearlyNoteText, { color: cfg.accent }]}>
              {"Billed $" + effectiveYearly.toFixed(0) + "/year · saves $" + ((effectiveMonthly * 12) - effectiveYearly).toFixed(0) + " vs monthly"}
            </Text>
          </View>
        )}
        {hasDiscount && rawOriginal > rawPrice && (
          <Text style={[ss.billedNote, { textDecorationLine: "line-through", color: "rgba(255,255,255,0.25)" }]}>
            {"Was $" + rawOriginal.toFixed(2) + "/mo"}
          </Text>
        )}

        {/* Divider */}
        <View style={[ss.divider, { backgroundColor: cfg.accent + "30" }]} />

        {/* Features — expanded with sub-descriptions */}
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
              <View style={ss.featureTextBlock}>
                <Text style={ss.featureText}>{f.text}</Text>
                {f.sub ? (
                  <Text style={ss.featureSub}>{f.sub}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* ── Pagination dots + arrows — inside card, above CTA ── */}
        <View style={ss.inCardNavRow}>
          <Pressable
            onPress={onPrev}
            disabled={activeIdx === 0}
            style={({ pressed }) => [
              ss.navArrow,
              { borderColor: cfg.accent + "30", opacity: activeIdx === 0 ? 0.2 : pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[ss.navArrowText, { color: cfg.accent }]}>{"‹"}</Text>
          </Pressable>

          <View style={ss.dotsRow}>
            {Array.from({ length: totalPlans }).map((_, i) => (
              <View
                key={i}
                style={[
                  ss.dot,
                  i === activeIdx
                    ? { backgroundColor: cfg.accent, width: 20 }
                    : { backgroundColor: "rgba(255,255,255,0.18)", width: 6 },
                ]}
              />
            ))}
          </View>

          <Pressable
            onPress={onNext}
            disabled={activeIdx === totalPlans - 1}
            style={({ pressed }) => [
              ss.navArrow,
              { borderColor: cfg.accent + "30", opacity: activeIdx === totalPlans - 1 ? 0.2 : pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[ss.navArrowText, { color: cfg.accent }]}>{"›"}</Text>
          </Pressable>
        </View>

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

  // Card width: 90% of available width, capped at 420px
  const availableWidth = containerWidth ?? SCREEN_W;
  const slideWidth = Math.min(Math.round(availableWidth * 0.90), 420);
  // Side padding centers the first and last card
  const sidePad = Math.max(0, Math.round((availableWidth - slideWidth) / 2));
  // Gap between cards
  const CARD_GAP = 12;

  useEffect(() => {
    if (isOnboarding) {
      setActiveIdx(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [isOnboarding]);

  // snapToOffsets: each card's left edge relative to scroll content start (after sidePad)
  // The first card starts at x=0 inside the content (sidePad is handled by contentInset, not padding)
  const snapOffsets = plans.map((_, i) => i * (slideWidth + CARD_GAP));

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / (slideWidth + CARD_GAP));
      const clamped = Math.max(0, Math.min(idx, plans.length - 1));
      if (clamped !== activeIdx) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      setActiveIdx(clamped);
    },
    [slideWidth, plans.length, activeIdx],
  );

  const scrollTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, plans.length - 1));
    if (clamped !== activeIdx) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    scrollRef.current?.scrollTo({ x: clamped * (slideWidth + CARD_GAP), animated: true });
    setActiveIdx(clamped);
  }, [activeIdx, plans.length, slideWidth]);

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

  // slideHeight: fill the full carousel container
  const slideHeight = carouselHeight > 200 ? carouselHeight : SCREEN_H * 0.75;

  return (
    <View style={[ss.container, { flex: 1 }]} onLayout={(e) => setCarouselHeight(e.nativeEvent.layout.height)}>
      {/* Carousel — each card fills full height */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToOffsets={snapOffsets}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        // contentInset centers first/last card without shifting snap positions
        contentInset={{ left: sidePad, right: sidePad }}
        contentOffset={{ x: -sidePad, y: 0 }}
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={{
          gap: CARD_GAP,
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
            onToggleBilling={onToggleBilling}
            onSelect={() => onSelectPlan(plan.planKey, isYearly ? "yearly" : "monthly")}
            isLoading={loadingPlanKey === plan.planKey}
            isCurrentPlan={currentPlanKey === plan.planKey}
            isUpgrade={currentIdx !== -1 ? idx > currentIdx : true}
            slideWidth={slideWidth}
            slideHeight={slideHeight}
            isTrialEligible={isTrialEligible}
            activeIdx={activeIdx}
            totalPlans={plans.length}
            onPrev={() => scrollTo(activeIdx - 1)}
            onNext={() => scrollTo(activeIdx + 1)}
            onCompare={() => setShowCompare(true)}
          />
        ))}
      </ScrollView>

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

  // Card — no top accent bar
  card: {
    flex: 1,
    borderRadius: 40,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 18,
  },

  // ── Card top row: billing toggle (left) + compare icon (right) ──
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 10,
  },

  // Billing toggle — compact, inside card
  toggleWrap: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 20,
    borderWidth: 1,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 17,
    gap: 5,
  },
  toggleBtnActive: {
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  toggleText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.1 },
  savePill: {
    backgroundColor: "rgba(74,222,128,0.2)",
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  savePillText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.2 },

  // Compare icon button — top right of card
  compareIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  compareIconText: { fontSize: 18, lineHeight: 22 },

  // Card header badges
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
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
    paddingVertical: 5,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  trialBadgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },

  // Plan name
  planName: { fontSize: 28, fontWeight: "800", letterSpacing: -0.8, lineHeight: 32, marginBottom: 3 },
  planTagline: { fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: "500", marginBottom: 12 },

  // Price
  priceRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 4 },
  priceCurrency: { fontSize: 18, fontWeight: "700", marginTop: 5, marginRight: 1 },
  priceWhole: { fontSize: 52, fontWeight: "900", lineHeight: 56, letterSpacing: -2 },
  priceRight: { flexDirection: "column", justifyContent: "flex-end", paddingBottom: 7, marginLeft: 2 },
  priceCents: { fontSize: 16, fontWeight: "700", lineHeight: 20 },
  pricePer: { fontSize: 11, fontWeight: "500", color: "rgba(255,255,255,0.35)", lineHeight: 15 },
  savingsPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    marginLeft: 8,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  savingsPillText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  billedNote: { fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: "500", marginBottom: 3, marginTop: 1 },

  // Yearly savings note — highlighted pill
  yearlyNote: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
    marginBottom: 4,
    marginTop: 2,
  },
  yearlyNoteText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },

  // Divider
  divider: { height: 1, marginVertical: 10 },

  // Features — with sub-description
  featureScroll: { flex: 1, marginBottom: 10 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 5, gap: 10 },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  checkMark: { fontSize: 10, fontWeight: "900" },
  featureTextBlock: { flex: 1 },
  featureText: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.85)", lineHeight: 18 },
  featureSub: { fontSize: 11, fontWeight: "400", color: "rgba(255,255,255,0.38)", lineHeight: 15, marginTop: 1 },

  // In-card nav row (dots + arrows, above CTA)
  inCardNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 10,
  },
  navArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  navArrowText: { fontSize: 22, fontWeight: "300", lineHeight: 26, marginTop: -1 },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { height: 5, borderRadius: 3 },

  // CTA
  cta: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  ctaText: { fontSize: 15, fontWeight: "800", letterSpacing: 0.2 },

  // Compare modal
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
