/**
 * PlanCarousel — Full-screen futuristic lime-green carousel.
 * One plan per screen, dark deep-space background, neon lime accents,
 * glowing cards, animated scan lines, corner brackets, nav arrows, dots, compare modal.
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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { formatPrice } from "@/lib/utils";

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
};

// ─── Plan Config ──────────────────────────────────────────────────────────────
const PLAN_CONFIG: Record<string, {
  neon: string;
  bg: readonly [string, string, string];
  label: string;
  emoji: string;
  tagline: string;
}> = {
  solo: {
    neon: "#4ade80",
    bg: ["#001208", "#002410", "#001208"] as const,
    label: "STARTER",
    emoji: "🌱",
    tagline: "Perfect for solo practitioners",
  },
  growth: {
    neon: "#22d3ee",
    bg: ["#000e1a", "#001c2e", "#000e1a"] as const,
    label: "POPULAR",
    emoji: "⚡",
    tagline: "Scale your business fast",
  },
  studio: {
    neon: "#a78bfa",
    bg: ["#0a0018", "#140028", "#0a0018"] as const,
    label: "PRO",
    emoji: "💎",
    tagline: "For established studios",
  },
  enterprise: {
    neon: "#fbbf24",
    bg: ["#180e00", "#2c1800", "#180e00"] as const,
    label: "ENTERPRISE",
    emoji: "🏢",
    tagline: "Multi-location powerhouse",
  },
};

const PLAN_FEATURES: Record<string, Array<{ icon: string; text: string }>> = {
  solo: [
    { icon: "👤", text: "Up to 20 clients" },
    { icon: "✂️", text: "Up to 5 services" },
    { icon: "📅", text: "50 appointments/month" },
    { icon: "📍", text: "1 location" },
    { icon: "💳", text: "Cash & P2P payments" },
    { icon: "🌐", text: "Online booking page" },
    { icon: "📊", text: "Basic analytics" },
  ],
  growth: [
    { icon: "👥", text: "Up to 100 clients" },
    { icon: "✂️", text: "Up to 20 services" },
    { icon: "👨‍💼", text: "Up to 2 staff members" },
    { icon: "📅", text: "Unlimited appointments" },
    { icon: "📍", text: "1 location" },
    { icon: "💬", text: "SMS confirmations" },
    { icon: "📊", text: "Full analytics" },
  ],
  studio: [
    { icon: "♾️", text: "Unlimited clients" },
    { icon: "✂️", text: "Unlimited services" },
    { icon: "👨‍💼", text: "Up to 10 staff members" },
    { icon: "📅", text: "Unlimited appointments" },
    { icon: "📍", text: "Up to 3 locations" },
    { icon: "💬", text: "Full SMS automation" },
    { icon: "💳", text: "Stripe payments" },
    { icon: "📊", text: "Staff analytics" },
  ],
  enterprise: [
    { icon: "♾️", text: "Unlimited clients" },
    { icon: "✂️", text: "Unlimited services" },
    { icon: "👨‍💼", text: "Up to 100 staff members" },
    { icon: "📅", text: "Unlimited appointments" },
    { icon: "📍", text: "Up to 10 locations" },
    { icon: "💬", text: "Full SMS automation" },
    { icon: "💳", text: "Stripe payments" },
    { icon: "📊", text: "Multi-location analytics" },
    { icon: "🎯", text: "Priority support" },
  ],
};

// ─── Animated Glow Ring ───────────────────────────────────────────────────────
function GlowRing({ color, size }: { color: string; size: number }) {
  const pulse = useSharedValue(0.7);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.7, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.6,
    transform: [{ scale: interpolate(pulse.value, [0.7, 1], [0.96, 1.04]) }],
  }));
  return (
    <Animated.View
      style={[
        style,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: color,
          position: "absolute",
        },
      ]}
    />
  );
}

// ─── Scan Line ────────────────────────────────────────────────────────────────
function ScanLine({ color }: { color: string }) {
  const y = useSharedValue(-40);
  useEffect(() => {
    y.value = withRepeat(
      withTiming(SCREEN_H * 0.65, { duration: 3500, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[style, { position: "absolute", left: 0, right: 0, height: 1.5, backgroundColor: color, opacity: 0.1 }]}
    />
  );
}

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
}: {
  plan: PlanData;
  isYearly: boolean;
  onSelect: () => void;
  isLoading: boolean;
  isCurrentPlan: boolean;
  isUpgrade?: boolean;
  slideWidth: number;
  slideHeight?: number;
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

  const discExpiresAt = plan.discountExpiresAt ? new Date(plan.discountExpiresAt) : null;
  const discDaysLeft = discExpiresAt
    ? Math.max(0, Math.ceil((discExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const savings =
    isYearly && !isFree && effectiveMonthly > 0
      ? Math.round(((effectiveMonthly * 12 - effectiveYearly) / (effectiveMonthly * 12)) * 100)
      : 0;

  const priceWhole = isFree ? "0" : Math.floor(rawPrice).toString();
  const priceCents = isFree ? "00" : (rawPrice % 1).toFixed(2).slice(2);

  const ctaLabel = isCurrentPlan
    ? "✓ Current Plan"
    : isFree
    ? "Downgrade to Free"
    : isUpgrade
    ? `Upgrade to ${plan.displayName}`
    : `Switch to ${plan.displayName}`;

  const cardScale = useSharedValue(0.93);
  const cardOpacity = useSharedValue(0);
  useEffect(() => {
    cardScale.value = withSpring(1, { damping: 16, stiffness: 180 });
    cardOpacity.value = withTiming(1, { duration: 320 });
  }, []);
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  return (
    <Animated.View style={[{ width: slideWidth, height: slideHeight || undefined }, cardStyle]}>
      <View style={[ss.glowShadow, { shadowColor: cfg.neon }]}>
        <LinearGradient
          colors={[...cfg.bg] as [string, string, string]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={ss.cardGradient}
        >
          <ScanLine color={cfg.neon} />

          {/* Corner brackets */}
          <View style={[ss.cornerTL, { borderColor: cfg.neon + "90" }]} />
          <View style={[ss.cornerTR, { borderColor: cfg.neon + "90" }]} />
          <View style={[ss.cornerBL, { borderColor: cfg.neon + "90" }]} />
          <View style={[ss.cornerBR, { borderColor: cfg.neon + "90" }]} />

          {/* Top badges */}
          <View style={ss.topBadgeRow}>
            <View style={[ss.chip, { borderColor: cfg.neon + "70", backgroundColor: cfg.neon + "18" }]}>
              <Text style={[ss.chipText, { color: cfg.neon }]}>{cfg.label}</Text>
            </View>
            {isPopular && (
              <View style={[ss.chip, { borderColor: "#4ade8070", backgroundColor: "#4ade8018" }]}>
                <Text style={[ss.chipText, { color: "#4ade80" }]}>⭐ MOST POPULAR</Text>
              </View>
            )}
            {isCurrentPlan && (
              <View style={[ss.chip, { borderColor: "#22c55e70", backgroundColor: "#22c55e18" }]}>
                <Text style={[ss.chipText, { color: "#22c55e" }]}>✓ YOUR PLAN</Text>
              </View>
            )}
            {hasDiscount && (
              <View style={[ss.chip, { borderColor: "#f59e0b70", backgroundColor: "#f59e0b18" }]}>
                <Text style={[ss.chipText, { color: "#fcd34d" }]}>
                  🏷 {plan.discountLabel ?? `${plan.discountPercent}% OFF`}
                  {discDaysLeft !== null ? `  ·  ${discDaysLeft}d` : ""}
                </Text>
              </View>
            )}
          </View>

          {/* Plan name */}
          <View style={ss.nameRow}>
            <Text style={ss.planEmoji}>{cfg.emoji}</Text>
            <View>
              <Text style={[ss.planName, { color: cfg.neon }]}>{plan.displayName}</Text>
              <Text style={ss.planTagline}>{cfg.tagline}</Text>
            </View>
          </View>

          {/* Neon price block — compact horizontal layout */}
          <View style={[ss.priceBlock, { borderColor: cfg.neon + "28", backgroundColor: cfg.neon + "07" }]}>
            {/* Subtle glow rings behind price */}
            <View style={[ss.glowRingWrap, { width: 70, height: 70 }]}>
              <GlowRing color={cfg.neon + "40"} size={60} />
              <GlowRing color={cfg.neon + "20"} size={80} />
            </View>
            <View style={ss.priceMainRow}>
              <View style={ss.priceRow}>
                <Text style={[ss.priceCurrency, { color: cfg.neon + "cc" }]}>$</Text>
                <Text style={[ss.priceWhole, { color: "#ffffff" }]}>{priceWhole}</Text>
                <View style={ss.priceRight}>
                  <Text style={[ss.priceCents, { color: cfg.neon + "cc" }]}>.{priceCents}</Text>
                  <Text style={ss.pricePer}>{isFree ? "forever" : "/mo"}</Text>
                </View>
              </View>
              <View style={ss.priceMeta}>
                {isYearly && !isFree && (
                  <Text style={[ss.billedNote, { color: cfg.neon + "99" }]}>
                    Billed ${effectiveYearly.toFixed(2)}/yr{savings > 0 ? `  ·  Save ${savings}%` : ""}
                  </Text>
                )}
                {hasDiscount && rawOriginal > rawPrice && (
                  <Text style={[ss.billedNote, { color: "rgba(255,255,255,0.3)", textDecorationLine: "line-through" }]}>
                    Was ${rawOriginal.toFixed(2)}/mo
                  </Text>
                )}
                {!isYearly && !isFree && (
                  <Text style={[ss.billedNote, { color: "rgba(255,255,255,0.25)" }]}>billed monthly</Text>
                )}
              </View>
            </View>
          </View>

          {/* Neon divider */}
          <View style={[ss.neonDivider, { backgroundColor: cfg.neon }]} />

          {/* Features */}
          <ScrollView style={ss.featureScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {features.map((feat, i) => (
              <View key={i} style={ss.featureRow}>
                <View style={[ss.featureIconWrap, { backgroundColor: cfg.neon + "14", borderColor: cfg.neon + "40" }]}>
                  <Text style={ss.featureIcon}>{feat.icon}</Text>
                </View>
                <Text style={ss.featureText}>{feat.text}</Text>
                <View style={[ss.featureCheck, { backgroundColor: cfg.neon + "1a" }]}>
                  <Text style={[ss.featureCheckMark, { color: cfg.neon }]}>✓</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* CTA */}
          <Pressable
            onPress={onSelect}
            disabled={isLoading || isCurrentPlan}
            style={({ pressed }) => [
              ss.cta,
              isCurrentPlan
                ? [ss.ctaDisabled, { borderColor: cfg.neon + "40" }]
                : [ss.ctaActive, { backgroundColor: cfg.neon, shadowColor: cfg.neon }],
              pressed && !isCurrentPlan && { transform: [{ scale: 0.97 }], opacity: 0.85 },
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color={isCurrentPlan ? cfg.neon : "#001208"} size="small" />
            ) : (
              <>
                <Text style={[ss.ctaText, { color: isCurrentPlan ? cfg.neon + "80" : "#001208" }]}>
                  {ctaLabel}
                </Text>
                {!isCurrentPlan && <Text style={[ss.ctaArrow, { color: "#001208" }]}>→</Text>}
              </>
            )}
          </Pressable>
        </LinearGradient>
      </View>
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
  loadingPlanKey,
  currentPlanKey,
  containerWidth,
  isOnboarding = false,
}: PlanCarouselProps) {
  const [showCompare, setShowCompare] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [carouselHeight, setCarouselHeight] = useState(0);

  const slideWidth = (containerWidth ?? SCREEN_W) - 40;

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
      <View style={ss.center}>
        <ActivityIndicator color="#4ade80" size="large" />
        <Text style={ss.loadingText}>Loading plans…</Text>
      </View>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <View style={ss.center}>
        <Text style={ss.loadingText}>No plans available.</Text>
      </View>
    );
  }

  const currentIdx = plans.findIndex((p) => p.planKey === currentPlanKey);
  const activePlan = plans[activeIdx];
  const activeCfg = activePlan ? (PLAN_CONFIG[activePlan.planKey] ?? PLAN_CONFIG.solo) : PLAN_CONFIG.solo;

  // slideHeight: fill the carousel container minus the toggle + nav rows (~130px)
  const slideHeight = carouselHeight > 200 ? carouselHeight - 130 : SCREEN_H * 0.58;

  return (
    <View style={[ss.container, { flex: 1 }]} onLayout={(e) => setCarouselHeight(e.nativeEvent.layout.height)}>
      {/* Billing Toggle */}
      <View style={ss.toggleWrap}>
        <Pressable
          onPress={() => onToggleBilling(false)}
          style={[ss.toggleBtn, !isYearly && [ss.toggleBtnActive, { backgroundColor: activeCfg.neon }]]}
        >
          <Text style={[ss.toggleText, { color: !isYearly ? "#001208" : "rgba(255,255,255,0.4)" }]}>
            Monthly
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onToggleBilling(true)}
          style={[ss.toggleBtn, isYearly && [ss.toggleBtnActive, { backgroundColor: activeCfg.neon }]]}
        >
          <Text style={[ss.toggleText, { color: isYearly ? "#001208" : "rgba(255,255,255,0.4)" }]}>
            Yearly
          </Text>
          {!isYearly && (
            <View style={ss.savePill}>
              <Text style={ss.savePillText}>−20%</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Carousel */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToInterval={slideWidth + 16}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}
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
            { borderColor: activeCfg.neon + "50", opacity: activeIdx === 0 ? 0.2 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[ss.navArrowText, { color: activeCfg.neon }]}>‹</Text>
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
                      ? { backgroundColor: dotCfg.neon, width: 24, shadowColor: dotCfg.neon, shadowOpacity: 0.9, shadowRadius: 8, elevation: 4 }
                      : { backgroundColor: "rgba(255,255,255,0.15)", width: 8 },
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
            { borderColor: activeCfg.neon + "50", opacity: activeIdx === plans.length - 1 ? 0.2 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[ss.navArrowText, { color: activeCfg.neon }]}>›</Text>
        </Pressable>
      </View>

      {/* Plan counter */}
      <Text style={[ss.planCounter, { color: activeCfg.neon + "60" }]}>
        {activeIdx + 1} / {plans.length}
      </Text>

      {/* Compare link */}
      <Pressable
        onPress={() => setShowCompare(true)}
        style={({ pressed }) => [ss.compareBtn, { borderColor: activeCfg.neon + "40", opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[ss.compareBtnText, { color: activeCfg.neon }]}>⊞ Compare all plans</Text>
      </Pressable>

      {/* Compare Modal */}
      <Modal
        visible={showCompare}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCompare(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000d05" }}>
          <View style={[ss.compareHeader, { borderBottomColor: "rgba(74,222,128,0.15)" }]}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff", letterSpacing: -0.3 }}>Compare Plans</Text>
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
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#4ade80" }}>Done</Text>
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
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(74,222,128,0.5)", letterSpacing: 1 }}>FEATURE</Text>
                </View>
                {COMPARE_PLANS.map((p) => (
                  <View key={p.planKey} style={[ss.compareCell, ss.comparePlanCol, { backgroundColor: p.neon + "10" }]}>
                    <Text style={{ fontSize: 18, marginBottom: 2 }}>{p.emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: p.neon }} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                      {p.monthlyPrice === 0 ? "Free" : `$${p.monthlyPrice}/mo`}
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
                    return (
                      <View key={p.planKey} style={[ss.compareCell, ss.comparePlanCol, { backgroundColor: p.neon + "05" }]}>
                        <Text style={{ fontSize: 12, color: isDim ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.8)", textAlign: "center" }} numberOfLines={2}>
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
    planKey: "solo", displayName: "Solo", monthlyPrice: 0, neon: "#4ade80", emoji: "🌱",
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
    planKey: "growth", displayName: "Growth", monthlyPrice: 19, neon: "#22d3ee", emoji: "⚡",
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
    planKey: "studio", displayName: "Studio", monthlyPrice: 39, neon: "#a78bfa", emoji: "💎",
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
    planKey: "enterprise", displayName: "Enterprise", monthlyPrice: 69, neon: "#fbbf24", emoji: "🏢",
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
  center: { alignItems: "center", paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, color: "rgba(74,222,128,0.5)" },
  // Billing toggle
  toggleWrap: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.2)",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 3,
    marginBottom: 18,
    alignSelf: "center",
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 13,
    gap: 6,
  },
  toggleBtnActive: {
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  toggleText: { fontSize: 14, fontWeight: "700", letterSpacing: 0.2 },
  savePill: {
    backgroundColor: "#4ade80",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savePillText: { fontSize: 9, fontWeight: "900", color: "#001208", letterSpacing: 0.5 },
  // Card
  glowShadow: {
    borderRadius: 28,
    elevation: 16,
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    flex: 1,
  },
  cardGradient: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
    overflow: "hidden",
    flex: 1,
  },
  cornerTL: { position: "absolute", top: 14, left: 14, width: 20, height: 20, borderTopWidth: 2, borderLeftWidth: 2, borderRadius: 3 },
  cornerTR: { position: "absolute", top: 14, right: 14, width: 20, height: 20, borderTopWidth: 2, borderRightWidth: 2, borderRadius: 3 },
  cornerBL: { position: "absolute", bottom: 14, left: 14, width: 20, height: 20, borderBottomWidth: 2, borderLeftWidth: 2, borderRadius: 3 },
  cornerBR: { position: "absolute", bottom: 14, right: 14, width: 20, height: 20, borderBottomWidth: 2, borderRightWidth: 2, borderRadius: 3 },
  topBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10, minHeight: 24 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  planEmoji: { fontSize: 30 },
  planName: { fontSize: 28, fontWeight: "900", letterSpacing: -0.8, lineHeight: 32 },
  planTagline: { fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2, fontWeight: "500" },
  // Price block
  priceBlock: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: "center",
    overflow: "hidden",
  },
  glowRingWrap: { position: "absolute", alignItems: "center", justifyContent: "center", width: 120, height: 120 },
  priceRow: { flexDirection: "row", alignItems: "flex-start" },
  priceMainRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  priceMeta: { alignItems: "flex-end", justifyContent: "center", gap: 2 },
  priceCurrency: { fontSize: 18, fontWeight: "700", marginTop: 8, marginRight: 2 },
  priceWhole: { fontSize: 52, fontWeight: "900", lineHeight: 56, letterSpacing: -2 },
  priceRight: { flexDirection: "column", justifyContent: "flex-end", paddingBottom: 9, marginLeft: 3 },
  priceCents: { fontSize: 18, fontWeight: "700", lineHeight: 22 },
  pricePer: { fontSize: 12, fontWeight: "600", lineHeight: 15, color: "rgba(255,255,255,0.38)" },
  billedNote: { fontSize: 12, marginTop: 3, fontWeight: "600", letterSpacing: 0.2 },
  neonDivider: { height: 1.5, marginBottom: 12, opacity: 0.3, borderRadius: 1 },
  // Features
  featureScroll: { flex: 1, marginBottom: 12 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  featureIconWrap: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  featureIcon: { fontSize: 13 },
  featureText: { fontSize: 13, fontWeight: "500", color: "rgba(255,255,255,0.78)", flex: 1, lineHeight: 18 },
  featureCheck: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  featureCheckMark: { fontSize: 10, fontWeight: "900" },
  // CTA
  cta: { borderRadius: 18, paddingVertical: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaActive: { shadowOpacity: 0.7, shadowRadius: 20, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  ctaDisabled: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1 },
  ctaText: { fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
  ctaArrow: { fontSize: 18, fontWeight: "700" },
  // Navigation
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 16, gap: 16 },
  navArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", borderWidth: 1 },
  navArrowText: { fontSize: 26, fontWeight: "200", lineHeight: 30, marginTop: -2 },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { height: 8, borderRadius: 4 },
  planCounter: { textAlign: "center", fontSize: 11, marginTop: 8, fontWeight: "600", letterSpacing: 1 },
  compareBtn: { alignSelf: "center", marginTop: 12, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  compareBtnText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  // Compare modal
  compareHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  compareCell: { paddingVertical: 11, paddingHorizontal: 10, justifyContent: "center", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.05)", minHeight: 46 },
  compareLabelCol: { width: 130, alignItems: "flex-start", backgroundColor: "rgba(0,0,0,0.3)" },
  comparePlanCol: { width: 110 },
});
