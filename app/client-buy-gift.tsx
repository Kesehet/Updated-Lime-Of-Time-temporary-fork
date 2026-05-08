/**
 * Client Portal — Buy a Gift Card
 *
 * 5-step native gift card purchase flow mirroring the web buy-gift page.
 * Steps: Items → Details → Date → Staff → Payment
 *
 * Step 2 (Date) includes:
 *   - Location selection (only if >1 active location; single location auto-selected)
 *   - Working-days calendar grid (grays out closed/unavailable days)
 *   - Time slot grid (pill buttons, fetched from /slots endpoint)
 *
 * Design: dark forest-green portal aesthetic.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { getApiBaseUrl } from "@/constants/oauth";

// ─── Portal palette ───────────────────────────────────────────────────────────
const GREEN_DARK   = "#1A3A28";
const GREEN_ACCENT = "#8FBF6A";
const LIME         = "#4A7C59";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED   = "rgba(255,255,255,0.60)";
const CARD_BG      = "rgba(255,255,255,0.07)";
const CARD_BORDER  = "rgba(255,255,255,0.12)";

// ─── Types ────────────────────────────────────────────────────────────────────
interface GiftItem {
  localId: string;
  name: string;
  price: number;
  description: string | null;
  category?: string | null;
  photoUri?: string | null;
  type: "service" | "product";
}
interface GiftPackage {
  localId: string;
  name: string;
  description: string | null;
  packageItems: Array<{ serviceLocalId: string; sessions: number; serviceName: string; serviceCategory: string | null }>;
  totalSessions: number;
  sessionDurationMinutes: number;
  originalPrice: number;
  packagePrice: number;
  photoUri: string | null;
  category: string | null;
}

interface GiftStaff {
  localId: string;
  name: string;
  role: string | null;
}

interface GiftLocation {
  localId: string;
  name: string;
  address?: string;
  phone?: string;
}

interface PaymentMethods {
  zelle: string | null;
  cashApp: string | null;
  venmo: string | null;
  cashEnabled: boolean;
}

const STEPS = ["Items", "Details", "Date", "Staff", "Payment"];

function formatPrice(n: number) {
  return `$${n.toFixed(2)}`;
}

// Calendar helpers
function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function ClientBuyGiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { slug, businessName: bizNameParam } = useLocalSearchParams<{ slug: string; businessName?: string }>();
  const apiBase = getApiBaseUrl();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<GiftItem[]>([]);
  const [products, setProducts] = useState<GiftItem[]>([]);
  const [staffList, setStaffList] = useState<GiftStaff[]>([]);
  const [locations, setLocations] = useState<GiftLocation[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethods>({ zelle: null, cashApp: null, venmo: null, cashEnabled: true });
  const [businessName, setBusinessName] = useState(bizNameParam ?? "");

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [packages, setPackages] = useState<GiftPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [giftTab, setGiftTab] = useState<"services" | "packages">("services");
  const [giftCategoryFilter, setGiftCategoryFilter] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GiftItem | null>(null);
  const [previewPackage, setPreviewPackage] = useState<GiftPackage | null>(null);
  const SCREEN_WIDTH = Dimensions.get("window").width;
  // Details
  const [purchaserName, setPurchaserName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  // Date step
  const [recipientChoosesDate, setRecipientChoosesDate] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<GiftLocation | null>(null);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  const [slotCounts, setSlotCounts] = useState<Record<string, number>>({});
  const [loadingMonthAvail, setLoadingMonthAvail] = useState(false);
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const lastAvailFetchKey = useRef<string>("");
  // Staff
  const [selectedStaffId, setSelectedStaffId] = useState<string>("any");
  // Payment
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [submitting, setSubmitting] = useState(false);

  const today = new Date();

  // ── Load gift info ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const [infoRes, staffRes] = await Promise.all([
          fetch(`${apiBase}/api/public/business/${slug}/gift-info`),
          fetch(`${apiBase}/api/public/business/${slug}/staff-list`),
        ]);
        // Also fetch packages
        const pkgRes = await fetch(`${apiBase}/api/client/packages/${slug}`).catch(() => null);
        if (pkgRes?.ok) {
          const pkgData = await pkgRes.json();
          setPackages(Array.isArray(pkgData) ? pkgData : []);
        }
        if (infoRes.ok) {
          const data = await infoRes.json();
          setBusinessName(data.businessName ?? bizNameParam ?? "");
          setServices((data.services ?? []).map((s: any) => ({ ...s, type: "service" as const })));
          setProducts((data.products ?? []).map((p: any) => ({ ...p, type: "product" as const })));
          const locs: GiftLocation[] = data.locations ?? [];
          setLocations(locs);
          // Auto-select single location
          if (locs.length === 1) setSelectedLocation(locs[0]);
          setPaymentMethods(data.paymentMethods ?? { zelle: null, cashApp: null, venmo: null, cashEnabled: true });
        }
        if (staffRes.ok) {
          const sData = await staffRes.json();
          setStaffList(sData.staff ?? []);
        }
      } catch (err) {
        console.warn("[BuyGift] load error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, apiBase, bizNameParam]);

  // ── Month availability fetch ───────────────────────────────────────────────
  const fetchMonthAvailability = useCallback(async (year: number, month: number, location: GiftLocation | null) => {
    if (!slug) return;
    const fetchKey = `${year}-${String(month + 1).padStart(2, "0")}-${location?.localId ?? "any"}`;
    if (lastAvailFetchKey.current === fetchKey) return;
    lastAvailFetchKey.current = fetchKey;
    setLoadingMonthAvail(true);
    const newUnavailable = new Set<string>();
    const newSlotCounts: Record<string, number> = {};
    const todayStr = new Date().toISOString().split("T")[0];
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayDate = new Date();
    const promises: Promise<void>[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      if (dateObj < new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate())) continue;
      const dateStr = dateObj.toISOString().split("T")[0];
      const locParam = location ? `&locationId=${encodeURIComponent(location.localId)}` : "";
      // Use duration=60 as a generic gift card duration for availability checking
      const url = `${apiBase}/api/public/business/${slug}/slots?date=${dateStr}&duration=60${locParam}&clientToday=${todayStr}&nowMinutes=${nowMinutes}`;
      promises.push(
        fetch(url)
          .then((r) => r.ok ? r.json() : { slots: [] })
          .then((data) => {
            const count = data.slots?.length ?? 0;
            if (!count) {
              newUnavailable.add(dateStr);
            } else {
              newSlotCounts[dateStr] = count;
            }
          })
          .catch(() => {})
      );
    }
    await Promise.all(promises);
    setUnavailableDates(newUnavailable);
    setSlotCounts(newSlotCounts);
    setLoadingMonthAvail(false);
  }, [slug, apiBase]);

  // Trigger month availability when calendar changes or location changes
  useEffect(() => {
    if (!recipientChoosesDate) {
      fetchMonthAvailability(calYear, calMonth, selectedLocation);
    }
  }, [calYear, calMonth, selectedLocation, recipientChoosesDate, fetchMonthAvailability]);

  // ── Slots fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDate || recipientChoosesDate) return;
    (async () => {
      setLoadingSlots(true);
      setSlots([]);
      setSelectedSlot(null);
      try {
        const dateStr = selectedDate.toISOString().split("T")[0];
        const locParam = selectedLocation ? `&locationId=${encodeURIComponent(selectedLocation.localId)}` : "";
        const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        const clientToday = new Date().toISOString().split("T")[0];
        const url = `${apiBase}/api/public/business/${slug}/slots?date=${dateStr}&duration=60${locParam}&clientToday=${clientToday}&nowMinutes=${nowMinutes}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setSlots(data.slots ?? []);
        }
      } catch (err) {
        console.warn("[BuyGift] slots error:", err);
      } finally {
        setLoadingSlots(false);
      }
    })();
  }, [selectedDate, selectedLocation, recipientChoosesDate, slug, apiBase]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const allItems: GiftItem[] = [...services, ...products];
  const selectedItemsList = allItems.filter(i => selectedItems.has(i.localId));
  const totalValue = selectedItemsList.reduce((sum, i) => sum + i.price, 0);

  const toggleItem = useCallback((id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBack = () => {
    if (step === 0) { router.back(); return; }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(s => s - 1);
  };

  const handleNext = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const canProceed = (): boolean => {
    if (step === 0) return selectedItems.size > 0 || !!selectedPackageId;
    if (step === 1) return purchaserName.trim().length > 0 && recipientName.trim().length > 0;
    if (step === 2) {
      if (recipientChoosesDate) return true;
      // Must have selected a date; time slot is optional
      return selectedDate !== null;
    }
    return true; // staff and payment steps are always valid
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const serviceIds = selectedItemsList.filter(i => i.type === "service").map(i => i.localId);
      const productIds = selectedItemsList.filter(i => i.type === "product").map(i => i.localId);
      const preselectedDate = selectedDate ? selectedDate.toISOString().split("T")[0] : undefined;
      const body: any = {
        purchaserName: purchaserName.trim(),
        purchaserEmail: purchaserEmail.trim() || undefined,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim() || undefined,
        recipientPhone: recipientPhone.trim() || undefined,
        personalMessage: personalMessage.trim() || undefined,
        serviceIds,
        productIds,
        paymentMethod,
        recipientChoosesDate,
        preselectedDate: !recipientChoosesDate ? preselectedDate : undefined,
        preselectedTime: !recipientChoosesDate && selectedSlot ? selectedSlot : undefined,
        staffId: selectedStaffId !== "any" ? selectedStaffId : undefined,
        locationId: selectedLocation?.localId ?? undefined,
      };
      const res = await fetch(`${apiBase}/api/public/business/${slug}/buy-gift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }
      const result = await res.json();
      // Navigate to confirmation
      router.replace({
        pathname: "/client-gift-confirmation",
        params: {
          giftCode: result.code ?? "",
          shareLink: result.shareLink ?? "",
          totalValue: String(result.totalValue ?? totalValue),
          recipientName: recipientName.trim(),
          businessName,
          businessSlug: slug,
          paymentMethod,
        },
      } as any);
    } catch (err: any) {
      Alert.alert("Purchase Failed", err?.message ?? "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={GREEN_ACCENT} size="large" />
          <Text style={{ color: TEXT_MUTED, marginTop: 12 }}>Loading gift options...</Text>
        </View>
      </View>
    );
  }

  const availablePaymentOptions = [
    paymentMethods.zelle && { id: "zelle", label: "Zelle", icon: "💜", hint: "Send to business Zelle" },
    paymentMethods.venmo && { id: "venmo", label: "Venmo", icon: "💙", hint: "Send via @username" },
    paymentMethods.cashApp && { id: "cashapp", label: "Cash App", icon: "💚", hint: "Send via $cashtag" },
    paymentMethods.cashEnabled && { id: "cash", label: "Cash", icon: "💵", hint: "Pay in person" },
  ].filter(Boolean) as { id: string; label: string; icon: string; hint: string }[];

  const calDays = getDaysInMonth(calYear, calMonth);
  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const showLocationStep = locations.length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={({ pressed }) => [s.backBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={handleBack}>
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>🎁 Buy a Gift</Text>
          {businessName ? <Text style={s.headerSub}>{businessName}</Text> : null}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* Step indicator */}
      <View style={s.stepIndicator}>
        {STEPS.map((label, i) => (
          <View key={i} style={s.stepItem}>
            <View style={[s.stepDot, { backgroundColor: i <= step ? LIME : "rgba(255,255,255,0.15)" }]}>
              {i < step ? (
                <IconSymbol name="checkmark" size={11} color="#fff" />
              ) : (
                <Text style={{ color: i <= step ? "#fff" : TEXT_MUTED, fontSize: 10, fontWeight: "700" }}>{i + 1}</Text>
              )}
            </View>
            {i < STEPS.length - 1 && (
              <View style={[s.stepLine, { backgroundColor: i < step ? LIME : "rgba(255,255,255,0.12)" }]} />
            )}
          </View>
        ))}
      </View>
      <Text style={s.stepLabel}>{STEPS[step]}</Text>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Step 0: Items ─────────────────────────────────────────── */}
        {step === 0 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Choose Gift Items</Text>
            <Text style={s.stepSub}>Select one or more services or products to include in the gift.</Text>

            {services.length > 0 && (
              <>
                <Text style={s.sectionHeader}>Services</Text>
                {services.map(item => (
                  <Pressable
                    key={item.localId}
                    style={({ pressed }) => [
                      s.itemCard,
                      selectedItems.has(item.localId) && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => toggleItem(item.localId)}
                  >
                    <View style={[s.checkBox, selectedItems.has(item.localId) && { backgroundColor: GREEN_ACCENT, borderColor: GREEN_ACCENT }]}>
                      {selectedItems.has(item.localId) && <IconSymbol name="checkmark" size={14} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{item.name}</Text>
                      {item.description ? <Text style={s.itemDesc} numberOfLines={2}>{item.description}</Text> : null}
                      <Text style={s.itemPrice}>{formatPrice(item.price)}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {products.length > 0 && (
              <>
                <Text style={s.sectionHeader}>Products</Text>
                {products.map(item => (
                  <Pressable
                    key={item.localId}
                    style={({ pressed }) => [
                      s.itemCard,
                      selectedItems.has(item.localId) && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => toggleItem(item.localId)}
                  >
                    <View style={[s.checkBox, selectedItems.has(item.localId) && { backgroundColor: GREEN_ACCENT, borderColor: GREEN_ACCENT }]}>
                      {selectedItems.has(item.localId) && <IconSymbol name="checkmark" size={14} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{item.name}</Text>
                      {item.description ? <Text style={s.itemDesc} numberOfLines={2}>{item.description}</Text> : null}
                      <Text style={s.itemPrice}>{formatPrice(item.price)}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {allItems.length === 0 && (
              <View style={s.emptyState}>
                <Text style={{ fontSize: 32 }}>🎁</Text>
                <Text style={{ color: TEXT_MUTED, textAlign: "center" }}>No gift items available yet.</Text>
              </View>
            )}

            {selectedItems.size > 0 && (
              <View style={[s.totalBanner, { backgroundColor: `${GREEN_ACCENT}15`, borderColor: `${GREEN_ACCENT}40` }]}>
                <Text style={{ fontSize: 20 }}>🎁</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>
                    {selectedItems.size} item{selectedItems.size > 1 ? "s" : ""} selected
                  </Text>
                  <Text style={{ color: GREEN_ACCENT, fontWeight: "600", fontSize: 14 }}>
                    Total value: {formatPrice(totalValue)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Step 1: Details ───────────────────────────────────────── */}
        {step === 1 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Gift Details</Text>
            <Text style={s.stepSub}>Who is this gift from, and who is it for?</Text>

            <Text style={s.fieldLabel}>Your Name *</Text>
            <TextInput
              style={s.input}
              placeholder="Your full name"
              placeholderTextColor={TEXT_MUTED}
              value={purchaserName}
              onChangeText={setPurchaserName}
              returnKeyType="next"
            />

            <Text style={s.fieldLabel}>Your Email</Text>
            <TextInput
              style={s.input}
              placeholder="your@email.com (for receipt)"
              placeholderTextColor={TEXT_MUTED}
              value={purchaserEmail}
              onChangeText={setPurchaserEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />

            <View style={s.divider} />

            <Text style={s.fieldLabel}>Recipient's Name *</Text>
            <TextInput
              style={s.input}
              placeholder="Recipient's full name"
              placeholderTextColor={TEXT_MUTED}
              value={recipientName}
              onChangeText={setRecipientName}
              returnKeyType="next"
            />

            <Text style={s.fieldLabel}>Recipient's Email</Text>
            <TextInput
              style={s.input}
              placeholder="recipient@email.com (to send gift)"
              placeholderTextColor={TEXT_MUTED}
              value={recipientEmail}
              onChangeText={setRecipientEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />

            <Text style={s.fieldLabel}>Recipient's Phone</Text>
            <TextInput
              style={s.input}
              placeholder="(412) 555-0100"
              placeholderTextColor={TEXT_MUTED}
              value={recipientPhone}
              onChangeText={setRecipientPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
            />

            <Text style={s.fieldLabel}>Personal Message (optional)</Text>
            <TextInput
              style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
              placeholder="Write a heartfelt message..."
              placeholderTextColor={TEXT_MUTED}
              value={personalMessage}
              onChangeText={setPersonalMessage}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
          </View>
        )}

        {/* ── Step 2: Date ──────────────────────────────────────────── */}
        {step === 2 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Appointment Date</Text>
            <Text style={s.stepSub}>Let the recipient choose, or pre-select a date now.</Text>

            {/* Option: recipient chooses */}
            <Pressable
              style={({ pressed }) => [
                s.dateOptionCard,
                recipientChoosesDate && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => {
                setRecipientChoosesDate(true);
                setSelectedDate(null);
                setSelectedSlot(null);
              }}
            >
              <Text style={{ fontSize: 24 }}>📅</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.dateOptionTitle}>Recipient Chooses</Text>
                <Text style={s.dateOptionSub}>They'll pick a date when they redeem the gift</Text>
              </View>
              {recipientChoosesDate && (
                <View style={[s.radioCheck, { backgroundColor: GREEN_ACCENT }]}>
                  <IconSymbol name="checkmark" size={13} color="#fff" />
                </View>
              )}
            </Pressable>

            {/* Option: pre-select */}
            <Pressable
              style={({ pressed }) => [
                s.dateOptionCard,
                !recipientChoosesDate && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setRecipientChoosesDate(false)}
            >
              <Text style={{ fontSize: 24 }}>🗓️</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.dateOptionTitle}>Pre-select a Date</Text>
                <Text style={s.dateOptionSub}>Book a specific date and time now</Text>
              </View>
              {!recipientChoosesDate && (
                <View style={[s.radioCheck, { backgroundColor: GREEN_ACCENT }]}>
                  <IconSymbol name="checkmark" size={13} color="#fff" />
                </View>
              )}
            </Pressable>

            {/* ── Calendar section (only when pre-select is chosen) ── */}
            {!recipientChoosesDate && (
              <View style={{ gap: 12, marginTop: 4 }}>

                {/* Location selection — only if >1 location */}
                {showLocationStep && (
                  <View>
                    <Text style={s.sectionHeader}>Location</Text>
                    {locations.map(loc => (
                      <Pressable
                        key={loc.localId}
                        style={({ pressed }) => [
                          s.locationCard,
                          selectedLocation?.localId === loc.localId && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSelectedLocation(loc);
                          setSelectedDate(null);
                          setSelectedSlot(null);
                          // Reset availability cache so it re-fetches for new location
                          lastAvailFetchKey.current = "";
                        }}
                      >
                        <View style={s.locationIcon}>
                          <IconSymbol name="location.fill" size={16} color={GREEN_ACCENT} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.locationName}>{loc.name}</Text>
                          {loc.address ? <Text style={s.locationAddr} numberOfLines={1}>{loc.address}</Text> : null}
                        </View>
                        {selectedLocation?.localId === loc.localId && (
                          <View style={[s.radioCheck, { backgroundColor: GREEN_ACCENT }]}>
                            <IconSymbol name="checkmark" size={13} color="#fff" />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* Single location info card */}
                {!showLocationStep && selectedLocation && (
                  <View style={[s.locationCard, { borderColor: `${GREEN_ACCENT}40` }]}>
                    <View style={s.locationIcon}>
                      <IconSymbol name="location.fill" size={16} color={GREEN_ACCENT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.locationName}>{selectedLocation.name}</Text>
                      {selectedLocation.address ? (
                        <Text style={s.locationAddr} numberOfLines={1}>{selectedLocation.address}</Text>
                      ) : null}
                    </View>
                  </View>
                )}

                {/* Calendar grid */}
                <View>
                  <Text style={s.sectionHeader}>Select a Date</Text>

                  {/* Month navigation */}
                  <View style={s.monthNav}>
                    <Pressable
                      style={({ pressed }) => [s.monthBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => {
                        if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
                        else setCalMonth(m => m - 1);
                        lastAvailFetchKey.current = "";
                      }}
                    >
                      <IconSymbol name="chevron.left" size={18} color={TEXT_PRIMARY} />
                    </Pressable>
                    <Text style={s.monthLabel}>{monthLabel}</Text>
                    <Pressable
                      style={({ pressed }) => [s.monthBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => {
                        if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
                        else setCalMonth(m => m + 1);
                        lastAvailFetchKey.current = "";
                      }}
                    >
                      <IconSymbol name="chevron.right" size={18} color={TEXT_PRIMARY} />
                    </Pressable>
                  </View>

                  {/* Day headers */}
                  <View style={s.dayHeaders}>
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <Text key={i} style={s.dayHeader}>{d}</Text>
                    ))}
                  </View>

                  {/* Loading indicator */}
                  {loadingMonthAvail && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <ActivityIndicator size="small" color={GREEN_ACCENT} />
                      <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>Checking availability…</Text>
                    </View>
                  )}

                  {/* Calendar cells */}
                  <View style={s.calGrid}>
                    {Array.from({ length: new Date(calYear, calMonth, 1).getDay() }).map((_, i) => (
                      <View key={`empty-${i}`} style={s.calCell} />
                    ))}
                    {calDays.map((day) => {
                      const isPast = day < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                      const dateStr = day.toISOString().split("T")[0];
                      const isUnavailable = !isPast && unavailableDates.has(dateStr);
                      const isSelected = selectedDate?.toDateString() === day.toDateString();
                      const isToday = day.toDateString() === today.toDateString();
                      const isDisabled = isPast || isUnavailable;
                      return (
                        <Pressable
                          key={day.toISOString()}
                          style={({ pressed }) => [
                            s.calCell,
                            isSelected && { backgroundColor: LIME, borderRadius: 20 },
                            isToday && !isSelected && { borderWidth: 1.5, borderColor: GREEN_ACCENT, borderRadius: 20 },
                            (isPast || isUnavailable) && { opacity: 0.3 },
                            pressed && !isDisabled && { opacity: 0.7 },
                          ]}
                          onPress={() => {
                            if (isDisabled) return;
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setSelectedDate(day);
                            setSelectedSlot(null);
                          }}
                          disabled={isDisabled}
                        >
                          <Text style={{
                            color: isSelected ? "#FFFFFF" : isUnavailable ? TEXT_MUTED : TEXT_PRIMARY,
                            fontSize: 14,
                            fontWeight: isToday ? "700" : "400",
                          }}>
                            {day.getDate()}
                          </Text>
                          {isUnavailable && !isPast && (
                            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: TEXT_MUTED, marginTop: 1 }} />
                          )}
                          {!isUnavailable && !isPast && slotCounts[dateStr] != null && (
                            <Text style={{
                              fontSize: 9,
                              fontWeight: "700",
                              color: isSelected ? "rgba(255,255,255,0.85)" : GREEN_ACCENT,
                              marginTop: 1,
                              lineHeight: 11,
                            }}>
                              {slotCounts[dateStr]}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* Time slot grid — shown after a date is selected */}
                {selectedDate && (
                  <View>
                    <View style={s.timeSectionHeader}>
                      <IconSymbol name="clock" size={15} color={GREEN_ACCENT} />
                      <Text style={s.timeSectionTitle}>
                        Available Times · {formatDateLabel(selectedDate)}
                      </Text>
                    </View>
                    {loadingSlots ? (
                      <ActivityIndicator color={GREEN_ACCENT} style={{ marginTop: 12 }} />
                    ) : slots.length === 0 ? (
                      <View style={s.noSlots}>
                        <Text style={s.noSlotsText}>No available times on this date.</Text>
                        <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>Try selecting a different date above.</Text>
                      </View>
                    ) : (
                      <View style={s.slotsGrid}>
                        {slots.map((time) => {
                          const isSelected = selectedSlot === time;
                          return (
                            <Pressable
                              key={time}
                              style={({ pressed }) => [
                                s.slotBtn,
                                { backgroundColor: isSelected ? LIME : CARD_BG, borderColor: isSelected ? LIME : CARD_BORDER },
                                pressed && { opacity: 0.8 },
                              ]}
                              onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setSelectedSlot(isSelected ? null : time);
                              }}
                            >
                              <Text style={{ color: isSelected ? "#FFFFFF" : TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>
                                {time}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    {selectedSlot && (
                      <View style={[s.selectedTimeBanner, { backgroundColor: `${GREEN_ACCENT}15`, borderColor: `${GREEN_ACCENT}40` }]}>
                        <IconSymbol name="checkmark.circle.fill" size={18} color={GREEN_ACCENT} />
                        <Text style={{ color: GREEN_ACCENT, fontWeight: "600", fontSize: 14 }}>
                          {formatDateLabel(selectedDate)} at {selectedSlot}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Step 3: Staff ─────────────────────────────────────────── */}
        {step === 3 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Staff Preference</Text>
            <Text style={s.stepSub}>Optional — choose a preferred staff member for the recipient.</Text>

            <Pressable
              style={({ pressed }) => [
                s.staffCard,
                selectedStaffId === "any" && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setSelectedStaffId("any")}
            >
              <View style={s.staffAvatar}>
                <IconSymbol name="person.3.fill" size={18} color={GREEN_ACCENT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.staffName}>Any Available</Text>
                <Text style={s.staffRole}>First available staff member</Text>
              </View>
              {selectedStaffId === "any" && (
                <View style={[s.radioCheck, { backgroundColor: GREEN_ACCENT }]}>
                  <IconSymbol name="checkmark" size={13} color="#fff" />
                </View>
              )}
            </Pressable>

            {staffList.map(member => (
              <Pressable
                key={member.localId}
                style={({ pressed }) => [
                  s.staffCard,
                  selectedStaffId === member.localId && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setSelectedStaffId(member.localId)}
              >
                <View style={s.staffAvatar}>
                  <Text style={{ color: GREEN_ACCENT, fontWeight: "700", fontSize: 16 }}>{member.name.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.staffName}>{member.name}</Text>
                  {member.role ? <Text style={s.staffRole}>{member.role}</Text> : null}
                </View>
                {selectedStaffId === member.localId && (
                  <View style={[s.radioCheck, { backgroundColor: GREEN_ACCENT }]}>
                    <IconSymbol name="checkmark" size={13} color="#fff" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* ── Step 4: Payment ───────────────────────────────────────── */}
        {step === 4 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Payment</Text>
            <Text style={s.stepSub}>How would you like to pay for this gift?</Text>

            {/* Summary */}
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>Gift Summary</Text>
              {selectedItemsList.map(item => (
                <View key={item.localId} style={s.summaryRow}>
                  <Text style={s.summaryItemName}>{item.name}</Text>
                  <Text style={s.summaryItemPrice}>{formatPrice(item.price)}</Text>
                </View>
              ))}
              {!recipientChoosesDate && selectedDate && (
                <View style={s.summaryRow}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Date</Text>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 13 }}>
                    {formatDateLabel(selectedDate)}{selectedSlot ? ` at ${selectedSlot}` : ""}
                  </Text>
                </View>
              )}
              <View style={[s.summaryRow, { borderTopWidth: 1, borderTopColor: CARD_BORDER, marginTop: 8, paddingTop: 8 }]}>
                <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>Total</Text>
                <Text style={{ color: GREEN_ACCENT, fontWeight: "800", fontSize: 16 }}>{formatPrice(totalValue)}</Text>
              </View>
            </View>

            <View style={{ gap: 10, marginTop: 8 }}>
              {availablePaymentOptions.map(method => (
                <Pressable
                  key={method.id}
                  style={({ pressed }) => [
                    s.paymentCard,
                    paymentMethod === method.id && { borderColor: GREEN_ACCENT, backgroundColor: `${GREEN_ACCENT}15` },
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => setPaymentMethod(method.id)}
                >
                  <Text style={{ fontSize: 22 }}>{method.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.payLabel}>{method.label}</Text>
                    <Text style={s.payHint}>{method.hint}</Text>
                  </View>
                  {paymentMethod === method.id && (
                    <IconSymbol name="checkmark.circle.fill" size={22} color={GREEN_ACCENT} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Action */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {step < STEPS.length - 1 ? (
          <Pressable
            style={({ pressed }) => [
              s.actionBtn,
              { opacity: canProceed() ? (pressed ? 0.85 : 1) : 0.4 },
              pressed && canProceed() && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={handleNext}
            disabled={!canProceed()}
          >
            <Text style={s.actionBtnText}>Continue</Text>
            <IconSymbol name="chevron.right" size={16} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              s.actionBtn,
              submitting && { opacity: 0.7 },
              pressed && !submitting && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={{ fontSize: 18 }}>🎁</Text>
                <Text style={s.actionBtnText}>Purchase Gift</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "700",
  },
  headerSub: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 1,
  },
  stepIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  stepItem: { flexDirection: "row", alignItems: "center" },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLine: { width: 18, height: 2, marginHorizontal: 2 },
  stepLabel: {
    color: GREEN_ACCENT,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 4,
  },
  stepContent: { paddingTop: 16, gap: 12 },
  stepTitle: { color: TEXT_PRIMARY, fontSize: 20, fontWeight: "700", marginBottom: 2 },
  stepSub: { color: TEXT_MUTED, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  sectionHeader: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  richCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    marginBottom: 14,
    overflow: "hidden",
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 12,
  },
  itemName: { color: TEXT_PRIMARY, fontSize: 15, fontWeight: "600" },
  itemDesc: { color: TEXT_MUTED, fontSize: 12, marginTop: 2, lineHeight: 17 },
  itemPrice: { color: GREEN_ACCENT, fontSize: 13, fontWeight: "700", marginTop: 4 },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  totalBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  fieldLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 4,
  },
  input: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 12,
    fontSize: 14,
    color: TEXT_PRIMARY,
  },
  divider: {
    height: 1,
    backgroundColor: CARD_BORDER,
    marginVertical: 8,
  },
  dateOptionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 12,
  },
  dateOptionTitle: { color: TEXT_PRIMARY, fontSize: 15, fontWeight: "600" },
  dateOptionSub: { color: TEXT_MUTED, fontSize: 12, marginTop: 2 },
  radioCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  // Location
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 12,
    gap: 10,
  },
  locationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${GREEN_ACCENT}15`,
    alignItems: "center",
    justifyContent: "center",
  },
  locationName: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600" },
  locationAddr: { color: TEXT_MUTED, fontSize: 12, marginTop: 2 },
  // Calendar
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  monthBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_BG,
  },
  monthLabel: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "700",
  },
  dayHeaders: {
    flexDirection: "row",
    marginBottom: 4,
  },
  dayHeader: {
    flex: 1,
    textAlign: "center",
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "600",
  },
  calGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calCell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  // Time slots
  timeSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    marginTop: 4,
  },
  timeSectionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "600",
  },
  noSlots: { alignItems: "center", paddingVertical: 16, gap: 4 },
  noSlotsText: { color: TEXT_MUTED, fontSize: 14, fontWeight: "600" },
  slotsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  slotBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    minWidth: 80,
    alignItems: "center",
  },
  selectedTimeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 8,
  },
  // Staff
  staffCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 12,
  },
  staffAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  staffName: { color: TEXT_PRIMARY, fontSize: 15, fontWeight: "600" },
  staffRole: { color: TEXT_MUTED, fontSize: 12, marginTop: 2 },
  // Payment
  summaryCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 8,
  },
  summaryTitle: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryItemName: { color: TEXT_PRIMARY, fontSize: 14, flex: 1 },
  summaryItemPrice: { color: TEXT_MUTED, fontSize: 14, fontWeight: "600" },
  paymentCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 12,
  },
  payLabel: { color: TEXT_PRIMARY, fontSize: 15, fontWeight: "600" },
  payHint: { color: TEXT_MUTED, fontSize: 12, marginTop: 2 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: GREEN_DARK,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  actionBtn: {
    backgroundColor: LIME,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
