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
  KeyboardAvoidingView,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { getApiBaseUrl } from "@/constants/oauth";
import { getCategoryDef, ALL_CATEGORY, SERVICE_CATEGORIES } from "@/constants/categories";
import * as WebBrowser from "expo-web-browser";
import { useStripe } from "@/lib/use-stripe";

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
  brand?: string | null;
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
  stripeEnabled?: boolean;
  businessOwnerId?: number;
}

const STEPS = ["Items", "Products", "Details", "Date", "Staff", "Payment"];

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

/** Auto-format a US phone number as (XXX) XXX-XXXX while typing */
function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethods>({ zelle: null, cashApp: null, venmo: null, cashEnabled: true, stripeEnabled: false });
  const [businessName, setBusinessName] = useState(bizNameParam ?? "");

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  // Product cart for Products step (step 1)
  const [productCart, setProductCart] = useState<Record<string, number>>({});
  const [selectedProductBrand, setSelectedProductBrand] = useState<string | null>(null);
  const [packages, setPackages] = useState<GiftPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [giftTab, setGiftTab] = useState<"services" | "packages">("services");
  const [giftMode, setGiftMode] = useState<"specific" | "balance" | "package">("specific");
  const [balanceAmount, setBalanceAmount] = useState<string>("");
  const [giftCategoryFilter, setGiftCategoryFilter] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GiftItem | null>(null);
  const [previewPackage, setPreviewPackage] = useState<GiftPackage | null>(null);
  const SCREEN_WIDTH = Dimensions.get("window").width;
  const MODAL_MAX_WIDTH = Math.min(SCREEN_WIDTH, 560);
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
  // Ref to hold card last4 after Stripe payment sheet succeeds (passed to gift confirmation screen)
  const cardLast4Ref = useRef<{ last4: string; brand: string } | null>(null);
  // Staff
  const [selectedStaffId, setSelectedStaffId] = useState<string>("any");
  // Payment
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [paymentConfirmationNumber, setPaymentConfirmationNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = new Date();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

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

   // ── Helpers ──────────────────────────────────────────────────────────
  const allItems: GiftItem[] = [...services, ...products];
  const selectedItemsList = allItems.filter(i => selectedItems.has(i.localId));
  // Product cart helpers
  const productBrands = useMemo(() => {
    const brands = new Set<string>();
    products.forEach(p => { if (p.brand) brands.add(p.brand); });
    return Array.from(brands).sort();
  }, [products]);
  const filteredGiftProducts = useMemo(() => {
    if (!selectedProductBrand) return products;
    return products.filter(p => p.brand === selectedProductBrand);
  }, [products, selectedProductBrand]);
  const productCartTotal = useMemo(() => {
    return products.reduce((sum, p) => sum + (productCart[p.localId] ?? 0) * p.price, 0);
  }, [products, productCart]);
  const selectedPackage = packages.find(p => p.localId === selectedPackageId) ?? null;
  const totalValue = giftMode === "balance"
    ? (parseFloat(balanceAmount) || 0)
    : (giftMode === "package" || selectedPackage)
      ? (selectedPackage?.packagePrice ?? 0)
      : selectedItemsList.reduce((sum, i) => sum + i.price, 0) + productCartTotal;

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
    if (giftMode === "balance" || giftMode === "package") {
      // Balance/Package mode: skip steps 3 (Date) and 4 (Staff)
      // Steps: 0=Items, 1=Products, 2=Details, 3=Date, 4=Staff, 5=Payment
      if (step === 5) { setStep(2); return; }
    }
    setStep(s => s - 1);
  };

  const handleNext = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (giftMode === "balance" || giftMode === "package") {
      // Balance/Package mode: skip steps 3 (Date) and 4 (Staff) — go directly from 2 to 5
      // Steps: 0=Items, 1=Products, 2=Details, 3=Date, 4=Staff, 5=Payment
      if (step === 2) { setStep(5); return; }
    }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const canProceed = (): boolean => {
    if (step === 0) {
      if (giftMode === "balance") return parseFloat(balanceAmount) > 0;
      if (giftMode === "package") return !!selectedPackageId;
      return selectedItems.size > 0 || !!selectedPackageId;
    }
    // step 1 = Products: always can proceed (products are optional add-ons)
    if (step === 1) return true;
    // step 2 = Details
    if (step === 2) return purchaserName.trim().length > 0 && recipientName.trim().length > 0;
    // step 3 = Date
    if (step === 3) {
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
      const serviceIds = (giftMode === "balance" || giftMode === "package") ? [] : selectedItemsList.filter(i => i.type === "service").map(i => i.localId);
      const productIds = (giftMode === "balance" || giftMode === "package") ? [] : selectedItemsList.filter(i => i.type === "product").map(i => i.localId);
      // Include product cart items (from Products step)
      const addedProductItems = products
        .filter(p => (productCart[p.localId] ?? 0) > 0)
        .map(p => ({ localId: p.localId, name: p.name, price: p.price, qty: productCart[p.localId] }));
      const addedProductTotal = productCartTotal;
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
        addedProductItems: addedProductItems.length > 0 ? addedProductItems : undefined,
        addedProductTotal: addedProductTotal > 0 ? addedProductTotal : undefined,
        packageLocalId: selectedPackageId || undefined,
        giftType: giftMode === "balance" ? "balance" : giftMode === "package" ? "package" : "service",
        balanceAmount: giftMode === "balance" ? parseFloat(balanceAmount) : undefined,
        paymentMethod,
        paymentConfirmationNumber: ["zelle","venmo","cashapp"].includes(paymentMethod) ? paymentConfirmationNumber.trim() : undefined,
        recipientChoosesDate: (giftMode === "balance" || giftMode === "package") ? true : recipientChoosesDate,
        preselectedDate: !recipientChoosesDate && giftMode !== "balance" && giftMode !== "package" ? preselectedDate : undefined,
        preselectedTime: !recipientChoosesDate && selectedSlot && giftMode !== "balance" && giftMode !== "package" ? selectedSlot : undefined,
        staffId: giftMode !== "balance" && giftMode !== "package" && selectedStaffId !== "any" ? selectedStaffId : undefined,
        locationId: giftMode !== "balance" && giftMode !== "package" ? (selectedLocation?.localId ?? undefined) : undefined,
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

      // ── Card payment: native Stripe payment sheet (iOS/Android) or Checkout (web) ──
      if (paymentMethod === "card" && totalValue > 0) {
        const bizOwnerId = paymentMethods.businessOwnerId;
        if (!bizOwnerId) {
          Alert.alert("Payment Error", "Unable to process card payment. Please try another payment method.");
          return;
        }
        try {
          const giftItems = selectedItemsList.map((i) => ({ name: i.name, price: i.price }));
          if (giftItems.length === 0 && giftMode === "balance") {
            giftItems.push({ name: "Gift Card Balance", price: totalValue });
          }
          if (Platform.OS !== "web") {
            // Native: use Stripe payment sheet
            const sheetRes = await fetch(`${apiBase}/api/stripe-connect/create-gift-payment-sheet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                businessOwnerId: bizOwnerId,
                giftCode: result.code,
                recipientName: recipientName.trim(),
                items: giftItems,
                totalAmount: totalValue,
              }),
            });
            const sheetData = await sheetRes.json();
            if (!sheetRes.ok || !sheetData?.paymentIntent) {
              Alert.alert("Payment Error", sheetData?.error ?? "Failed to start card payment.");
              setSubmitting(false);
              return;
            }
            const { error: initError } = await initPaymentSheet({
              paymentIntentClientSecret: sheetData.paymentIntent,
              stripeAccountId: sheetData.accountId,
              merchantDisplayName: businessName || "Business",
              style: "alwaysDark",
            });
            if (initError) { Alert.alert("Payment Error", initError.message); setSubmitting(false); return; }
            const { error: presentError } = await presentPaymentSheet();
            if (presentError) {
              if (presentError.code !== "Canceled") Alert.alert("Payment Failed", presentError.message);
              setSubmitting(false);
              return;
            }
            // Payment sheet succeeded — immediately mark gift as paid in DB
            // (don't rely solely on webhook since connected account events may not reach platform webhook)
            try {
              await fetch(`${apiBase}/api/stripe-connect/mark-gift-paid`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  businessOwnerId: bizOwnerId,
                  giftCode: result.code,
                }),
              });
            } catch { /* non-blocking — webhook will also handle this */ }
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
                businessOwnerId: String(bizOwnerId ?? ""),
                cardLast4: cardLast4Ref.current?.last4 ?? "",
                cardBrand: cardLast4Ref.current?.brand ?? "",
              },
            } as any);
          } else {
            // Web: redirect to Stripe Checkout — the successUrl will bring the user back
            const origin = apiBase.replace(/\/$/, "");
            const successUrl = `${origin}/api/stripe-connect/gift-checkout-success?giftCode=${encodeURIComponent(result.code ?? "")}&bizOwnerId=${encodeURIComponent(String(bizOwnerId))}&redirectBase=${encodeURIComponent(apiBase)}`;
            const cancelUrl = `${origin}/api/buy-gift/${slug}`;
            const stripeRes = await fetch(`${apiBase}/api/stripe-connect/create-gift-checkout`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                businessOwnerId: bizOwnerId,
                giftCode: result.code,
                recipientName: recipientName.trim(),
                items: giftItems,
                totalAmount: totalValue,
                successUrl,
                cancelUrl,
              }),
            });
            if (stripeRes.ok) {
              const { url } = await stripeRes.json();
              if (url) {
                // Redirect to Stripe Checkout — user will be sent to successUrl after payment
                if (typeof window !== "undefined") window.location.href = url;
              } else {
                Alert.alert("Payment Error", "Could not get payment link.");
              }
            } else {
              const errData = await stripeRes.json().catch(() => ({}));
              Alert.alert("Payment Error", (errData as any)?.error ?? "Failed to start card payment.");
            }
            setSubmitting(false);
          }
        } catch (err: any) {
          // Stripe call failed — gift is already created, navigate to confirmation anyway
          Alert.alert("Payment Error", `Could not connect to payment service. Your gift was created but payment was not completed.\nError: ${err?.message ?? "Unknown error"}\n\nPlease contact the business to arrange payment.`);
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
              businessOwnerId: String(bizOwnerId ?? ""),
              cardLast4: "",
              cardBrand: "",
            },
          } as any);
        }
        return;
      }
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
          cardLast4: "",
          cardBrand: "",
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
    paymentMethods.stripeEnabled && { id: "card", label: "Credit / Debit Card", icon: "💳", hint: "Pay securely online via Stripe" },
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
      {/* Drag handle — visual affordance for modal dismiss (swipe down) */}
      <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 2 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
      </View>

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

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* ── Step 0: Items ─────────────────────────────────────────── */}
        {step === 0 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Choose Gift Items</Text>
            <Text style={s.stepSub}>Select one or more services or products to include in the gift.</Text>
            {/* Gift Type Selector */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
              <Pressable
                onPress={() => { setGiftMode("specific"); setSelectedPackageId(null); }}
                style={({ pressed }) => [{
                  flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                  backgroundColor: giftMode === "specific" ? GREEN_ACCENT : "rgba(255,255,255,0.07)",
                  borderWidth: 1.5, borderColor: giftMode === "specific" ? GREEN_ACCENT : "rgba(255,255,255,0.15)",
                  opacity: pressed ? 0.85 : 1,
                }]}
              >
                <Text style={{ fontSize: 18, marginBottom: 2 }}>{"\uD83C\uDF81"}</Text>
                <Text style={{ color: giftMode === "specific" ? "#1A3A28" : TEXT_PRIMARY, fontWeight: "700", fontSize: 12 }}>Service</Text>
                <Text style={{ color: giftMode === "specific" ? "#1A3A28" : TEXT_MUTED, fontSize: 10, textAlign: "center", marginTop: 2 }}>Gift a service</Text>
              </Pressable>
              {packages.length > 0 && (
                <Pressable
                  onPress={() => { setGiftMode("package"); setSelectedItems(new Set()); }}
                  style={({ pressed }) => [{
                    flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                    backgroundColor: giftMode === "package" ? GREEN_ACCENT : "rgba(255,255,255,0.07)",
                    borderWidth: 1.5, borderColor: giftMode === "package" ? GREEN_ACCENT : "rgba(255,255,255,0.15)",
                    opacity: pressed ? 0.85 : 1,
                  }]}
                >
                  <Text style={{ fontSize: 18, marginBottom: 2 }}>{"\uD83D\uDCE6"}</Text>
                  <Text style={{ color: giftMode === "package" ? "#1A3A28" : TEXT_PRIMARY, fontWeight: "700", fontSize: 12 }}>Package</Text>
                  <Text style={{ color: giftMode === "package" ? "#1A3A28" : TEXT_MUTED, fontSize: 10, textAlign: "center", marginTop: 2 }}>Gift a bundle</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => { setGiftMode("balance"); setSelectedPackageId(null); }}
                style={({ pressed }) => [{
                  flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                  backgroundColor: giftMode === "balance" ? GREEN_ACCENT : "rgba(255,255,255,0.07)",
                  borderWidth: 1.5, borderColor: giftMode === "balance" ? GREEN_ACCENT : "rgba(255,255,255,0.15)",
                  opacity: pressed ? 0.85 : 1,
                }]}
              >
                <Text style={{ fontSize: 18, marginBottom: 2 }}>{"\uD83D\uDCB5"}</Text>
                <Text style={{ color: giftMode === "balance" ? "#1A3A28" : TEXT_PRIMARY, fontWeight: "700", fontSize: 12 }}>Balance</Text>
                <Text style={{ color: giftMode === "balance" ? "#1A3A28" : TEXT_MUTED, fontSize: 10, textAlign: "center", marginTop: 2 }}>Gift credit</Text>
              </Pressable>
            </View>
            {giftMode === "balance" && (
              <View style={{ marginBottom: 16, gap: 8 }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>Gift Amount</Text>
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Text style={{ color: GREEN_ACCENT, fontWeight: "700", fontSize: 20, marginRight: 4 }}>$</Text>
                  <TextInput
                    value={balanceAmount}
                    onChangeText={(v) => setBalanceAmount(v.replace(/[^0-9.]/g, ""))}
                    placeholder="0.00"
                    placeholderTextColor={TEXT_MUTED}
                    keyboardType="decimal-pad"
                    style={{ flex: 1, color: TEXT_PRIMARY, fontSize: 20, fontWeight: "700" }}
                    returnKeyType="done"
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {[25, 50, 75, 100, 150, 200].map(amt => (
                    <Pressable
                      key={amt}
                      onPress={() => setBalanceAmount(String(amt))}
                      style={({ pressed }) => [{
                        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                        backgroundColor: parseFloat(balanceAmount) === amt ? GREEN_ACCENT : "rgba(255,255,255,0.08)",
                        borderWidth: 1, borderColor: parseFloat(balanceAmount) === amt ? GREEN_ACCENT : "rgba(255,255,255,0.15)",
                        opacity: pressed ? 0.85 : 1,
                      }]}
                    >
                      <Text style={{ color: parseFloat(balanceAmount) === amt ? "#1A3A28" : TEXT_PRIMARY, fontWeight: "600", fontSize: 13 }}>${amt}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ color: TEXT_MUTED, fontSize: 12, lineHeight: 18 }}>
                  The recipient can use this balance as a credit toward any service at {businessName}.
                </Text>
              </View>
            )}

            {giftMode === "specific" && services.length > 0 && (() => {
              // Derive unique categories from services
              const cats = Array.from(new Set(services.map(s => s.category ?? "Other")));
              const showCats = cats.length > 1;
              const filteredServices = giftCategoryFilter
                ? services.filter(s => (s.category ?? "Other") === giftCategoryFilter)
                : services;
              return (
                <>
                  {showCats && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                      <Pressable
                        key="all"
                        onPress={() => setGiftCategoryFilter(null)}
                        style={({ pressed }) => [{
                          paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                          backgroundColor: !giftCategoryFilter ? GREEN_ACCENT : "rgba(255,255,255,0.08)",
                          borderWidth: 1, borderColor: !giftCategoryFilter ? GREEN_ACCENT : "rgba(255,255,255,0.15)",
                          opacity: pressed ? 0.85 : 1,
                        }]}
                      >
                        <Text style={{ color: !giftCategoryFilter ? "#1A3A28" : TEXT_PRIMARY, fontWeight: "600", fontSize: 13 }}>All</Text>
                      </Pressable>
                      {cats.map(cat => {
                        const def = getCategoryDef(cat);
                        const active = giftCategoryFilter === cat;
                        return (
                          <Pressable
                            key={cat}
                            onPress={() => setGiftCategoryFilter(active ? null : cat)}
                            style={({ pressed }) => [{
                              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 4,
                              backgroundColor: active ? GREEN_ACCENT : "rgba(255,255,255,0.08)",
                              borderWidth: 1, borderColor: active ? GREEN_ACCENT : "rgba(255,255,255,0.15)",
                              opacity: pressed ? 0.85 : 1,
                            }]}
                          >
                            <Text style={{ fontSize: 13 }}>{def.emoji}</Text>
                            <Text style={{ color: active ? "#1A3A28" : TEXT_PRIMARY, fontWeight: "600", fontSize: 13 }}>{cat}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                  <Text style={s.sectionHeader}>Services</Text>
                  {filteredServices.map(item => (
                    <Pressable
                      key={item.localId}
                      style={({ pressed }) => [
                        s.itemCard,
                        selectedItems.has(item.localId) && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                        pressed && { opacity: 0.85 },
                      ]}
                      onPress={() => toggleItem(item.localId)}
                    >
                      {/* Service image or placeholder */}
                      <Pressable
                        onPress={() => setPreviewItem(item)}
                        style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
                      >
                        <View style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                          {item.photoUri ? (
                            <Image source={{ uri: item.photoUri }} style={{ width: 60, height: 60 }} contentFit="cover" />
                          ) : (
                            <Text style={{ fontSize: 24 }}>{getCategoryDef(item.category).emoji}</Text>
                          )}
                        </View>
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemName}>{item.name}</Text>
                        {item.description ? <Text style={s.itemDesc} numberOfLines={2}>{item.description}</Text> : null}
                        <Text style={s.itemPrice}>{formatPrice(item.price)}</Text>
                      </View>
                      {/* Right-side checkmark */}
                      <View style={[s.checkBox, selectedItems.has(item.localId) && { backgroundColor: GREEN_ACCENT, borderColor: GREEN_ACCENT }]}>
                        {selectedItems.has(item.localId) && <IconSymbol name="checkmark" size={14} color="#fff" />}
                      </View>
                    </Pressable>
                  ))}
                </>
              );
            })()}

            {giftMode === "specific" && products.length > 0 && (
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
                    {/* Product image or placeholder */}
                    <Pressable
                      onPress={() => setPreviewItem(item)}
                      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
                    >
                      <View style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                        {item.photoUri ? (
                          <Image source={{ uri: item.photoUri }} style={{ width: 60, height: 60 }} contentFit="cover" />
                        ) : (
                          <Text style={{ fontSize: 24 }}>🛍️</Text>
                        )}
                      </View>
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{item.name}</Text>
                      {item.description ? <Text style={s.itemDesc} numberOfLines={2}>{item.description}</Text> : null}
                      <Text style={s.itemPrice}>{formatPrice(item.price)}</Text>
                    </View>
                    {/* Right-side checkmark */}
                    <View style={[s.checkBox, selectedItems.has(item.localId) && { backgroundColor: GREEN_ACCENT, borderColor: GREEN_ACCENT }]}>
                      {selectedItems.has(item.localId) && <IconSymbol name="checkmark" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {/* ── Package mode: show packages list ── */}
            {giftMode === "package" && (
              <>
                {packages.length === 0 ? (
                  <View style={s.emptyState}>
                    <Text style={{ fontSize: 32 }}>📦</Text>
                    <Text style={{ color: TEXT_MUTED, textAlign: "center" }}>No packages available yet.</Text>
                  </View>
                ) : (
                  <>
                    <Text style={s.sectionHeader}>Available Packages</Text>
                    {packages.map(pkg => (
                      <Pressable
                        key={pkg.localId}
                        style={({ pressed }) => [
                          s.itemCard,
                          selectedPackageId === pkg.localId && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSelectedPackageId(prev => prev === pkg.localId ? null : pkg.localId);
                        }}
                      >
                        <View style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                          {pkg.photoUri ? (
                            <Image source={{ uri: pkg.photoUri }} style={{ width: 60, height: 60 }} contentFit="cover" />
                          ) : (
                            <Text style={{ fontSize: 28 }}>📦</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.itemName}>{pkg.name}</Text>
                          {pkg.description ? <Text style={s.itemDesc} numberOfLines={2}>{pkg.description}</Text> : null}
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                            <Text style={{ color: TEXT_MUTED, fontSize: 12, textDecorationLine: "line-through" }}>${pkg.originalPrice.toFixed(2)}</Text>
                            <Text style={s.itemPrice}>${pkg.packagePrice.toFixed(2)}</Text>
                            <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "700" }}>{Math.round((1 - pkg.packagePrice / pkg.originalPrice) * 100)}% OFF</Text>
                          </View>
                          <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }}>{pkg.totalSessions} session{pkg.totalSessions > 1 ? "s" : ""} · {pkg.packageItems.length} service{pkg.packageItems.length > 1 ? "s" : ""}</Text>
                        </View>
                        <View style={[s.checkBox, selectedPackageId === pkg.localId && { backgroundColor: GREEN_ACCENT, borderColor: GREEN_ACCENT }]}>
                          {selectedPackageId === pkg.localId && <IconSymbol name="checkmark" size={14} color="#fff" />}
                        </View>
                      </Pressable>
                    ))}
                    <Text style={{ color: TEXT_MUTED, fontSize: 12, lineHeight: 18, marginTop: 4 }}>
                      The recipient will choose their own session dates when they redeem the gift.
                    </Text>
                  </>
                )}
              </>
            )}

            {giftMode === "specific" && packages.length > 0 && !selectedPackageId && (
              <>
                <Text style={s.sectionHeader}>Packages & Bundles</Text>
                {packages.map(pkg => (
                  <Pressable
                    key={pkg.localId}
                    style={({ pressed }) => [
                      s.itemCard,
                      selectedPackageId === pkg.localId && { borderColor: GREEN_ACCENT, borderWidth: 2 },
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedPackageId(prev => prev === pkg.localId ? null : pkg.localId);
                      setSelectedItems(new Set()); // clear individual items when package selected
                    }}
                  >
                    <View style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                      {pkg.photoUri ? (
                        <Image source={{ uri: pkg.photoUri }} style={{ width: 60, height: 60 }} contentFit="cover" />
                      ) : (
                        <Text style={{ fontSize: 28 }}>📦</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{pkg.name}</Text>
                      {pkg.description ? <Text style={s.itemDesc} numberOfLines={2}>{pkg.description}</Text> : null}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                        <Text style={{ color: TEXT_MUTED, fontSize: 12, textDecorationLine: "line-through" }}>${pkg.originalPrice.toFixed(2)}</Text>
                        <Text style={s.itemPrice}>${pkg.packagePrice.toFixed(2)}</Text>
                        <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "700" }}>{Math.round((1 - pkg.packagePrice / pkg.originalPrice) * 100)}% OFF</Text>
                      </View>
                      <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }}>{pkg.totalSessions} session{pkg.totalSessions > 1 ? "s" : ""} · {pkg.packageItems.length} service{pkg.packageItems.length > 1 ? "s" : ""}</Text>
                    </View>
                    <View style={[s.checkBox, selectedPackageId === pkg.localId && { backgroundColor: GREEN_ACCENT, borderColor: GREEN_ACCENT }]}>
                      {selectedPackageId === pkg.localId && <IconSymbol name="checkmark" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {giftMode === "specific" && selectedPackageId && (
              <>
                <Text style={s.sectionHeader}>Selected Package</Text>
                {packages.filter(p => p.localId === selectedPackageId).map(pkg => (
                  <View key={pkg.localId} style={[s.itemCard, { borderColor: GREEN_ACCENT, borderWidth: 2 }]}>
                    <View style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                      {pkg.photoUri ? (
                        <Image source={{ uri: pkg.photoUri }} style={{ width: 60, height: 60 }} contentFit="cover" />
                      ) : (
                        <Text style={{ fontSize: 28 }}>📦</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{pkg.name}</Text>
                      {pkg.description ? <Text style={s.itemDesc} numberOfLines={2}>{pkg.description}</Text> : null}
                      <Text style={s.itemPrice}>${pkg.packagePrice.toFixed(2)}</Text>
                    </View>
                    <Pressable
                      onPress={() => setSelectedPackageId(null)}
                      style={{ padding: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)" }}
                    >
                      <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Change</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            {giftMode === "specific" && allItems.length === 0 && packages.length === 0 && (
              <View style={s.emptyState}>
                <Text style={{ fontSize: 32 }}>🎁</Text>
                <Text style={{ color: TEXT_MUTED, textAlign: "center" }}>No gift items available yet.</Text>
              </View>
            )}

            {(selectedItems.size > 0 || selectedPackageId || (giftMode === "balance" && parseFloat(balanceAmount) > 0)) && (
              <View style={[s.totalBanner, { backgroundColor: `${GREEN_ACCENT}15`, borderColor: `${GREEN_ACCENT}40` }]}>
                <Text style={{ fontSize: 20 }}>{giftMode === "balance" ? "💵" : selectedPackageId ? "📦" : "🎁"}</Text>
                <View style={{ flex: 1 }}>
                  {giftMode === "balance" ? (
                    <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>Balance Credit Gift</Text>
                  ) : selectedPackageId ? (
                    <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>Package gift selected</Text>
                  ) : (
                    <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>
                      {selectedItems.size} item{selectedItems.size > 1 ? "s" : ""} selected
                    </Text>
                  )}
                  <Text style={{ color: GREEN_ACCENT, fontWeight: "600", fontSize: 14 }}>
                    Total value: {formatPrice(totalValue)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Step 1: Productss ───────────────────────────────────────────────────── */}
        {step === 1 && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Add Products</Text>
            <Text style={s.stepSub}>Optionally include retail products in the gift. This step is optional.</Text>
            {/* Brand filter pills */}
            {productBrands.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                <Pressable
                  onPress={() => setSelectedProductBrand(null)}
                  style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: !selectedProductBrand ? LIME : CARD_BG, borderWidth: 1, borderColor: !selectedProductBrand ? LIME : CARD_BORDER, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={{ color: !selectedProductBrand ? "#FFF" : TEXT_MUTED, fontSize: 13, fontWeight: "600" }}>All</Text>
                </Pressable>
                {productBrands.map((brand) => (
                  <Pressable
                    key={brand}
                    onPress={() => setSelectedProductBrand(selectedProductBrand === brand ? null : brand)}
                    style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: selectedProductBrand === brand ? LIME : CARD_BG, borderWidth: 1, borderColor: selectedProductBrand === brand ? LIME : CARD_BORDER, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Text style={{ color: selectedProductBrand === brand ? "#FFF" : TEXT_MUTED, fontSize: 13, fontWeight: "600" }}>{brand}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {/* Product list */}
            {filteredGiftProducts.length === 0 && (
              <View style={s.emptyState}>
                <Text style={{ fontSize: 32 }}>🛍️</Text>
                <Text style={{ color: TEXT_MUTED, textAlign: "center" }}>No products available.</Text>
              </View>
            )}
            {filteredGiftProducts.map((product) => {
              const qty = productCart[product.localId] ?? 0;
              return (
                <View key={product.localId} style={{ backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: qty > 0 ? GREEN_ACCENT : CARD_BORDER, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>{product.name}</Text>
                    {product.brand && <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }}>{product.brand}</Text>}
                    {product.description ? <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{product.description}</Text> : null}
                    <Text style={{ color: GREEN_ACCENT, fontSize: 14, fontWeight: "700", marginTop: 4 }}>{formatPrice(product.price)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Pressable
                      onPress={() => setProductCart(prev => { const next = { ...prev }; if ((next[product.localId] ?? 0) > 0) next[product.localId] = (next[product.localId] ?? 0) - 1; return next; })}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: qty > 0 ? LIME : "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "700", lineHeight: 20 }}>-</Text>
                    </Pressable>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 16, fontWeight: "700", minWidth: 20, textAlign: "center" }}>{qty}</Text>
                    <Pressable
                      onPress={() => setProductCart(prev => ({ ...prev, [product.localId]: (prev[product.localId] ?? 0) + 1 }))}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LIME, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "700", lineHeight: 20 }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {/* Cart summary */}
            {productCartTotal > 0 && (
              <View style={{ backgroundColor: `${GREEN_ACCENT}15`, borderRadius: 12, borderWidth: 1, borderColor: `${GREEN_ACCENT}40`, padding: 14, marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>Products subtotal</Text>
                <Text style={{ color: GREEN_ACCENT, fontSize: 16, fontWeight: "700" }}>+{formatPrice(productCartTotal)}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Step 2: Details ────────────────────────────────────────────────── */}
        {step === 2 && (
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
              onChangeText={(text) => setRecipientPhone(formatPhoneNumber(text))}
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

        {/* ── Step 3: Date ──────────────────────────────────────────── */}
        {step === 3 && (
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

        {/* ── Step 4: Staff ─────────────────────────────────────────── */}
        {step === 4 && (
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

        {/* ── Step 5: Payment ───────────────────────────────────────── */}
        {step === 5 && (
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
                  onPress={() => { setPaymentMethod(method.id); setPaymentConfirmationNumber(""); }}
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
              {["zelle","venmo","cashapp"].includes(paymentMethod) && (
                <View style={{ marginTop: 4, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: GREEN_ACCENT + "40" }}>
                  <Text style={{ color: GREEN_ACCENT, fontWeight: "700", fontSize: 13, marginBottom: 6 }}>
                    {paymentMethod === "zelle" ? "💜 Zelle Confirmation" : paymentMethod === "venmo" ? "💙 Venmo Confirmation" : "💚 Cash App Confirmation"}
                  </Text>
                  <TextInput
                    style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" }}
                    placeholder={
                      paymentMethod === "zelle" ? "Phone or email you sent from" :
                      paymentMethod === "venmo" ? "@username or transaction ID" :
                      "$cashtag or transaction ID"
                    }
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    value={paymentConfirmationNumber}
                    onChangeText={setPaymentConfirmationNumber}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                  <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 5, lineHeight: 16 }}>
                    {paymentMethod === "zelle" ? "Enter the phone number or email address you used to send the Zelle payment." :
                     paymentMethod === "venmo" ? "Enter the @username you sent to, or copy the transaction ID from the Venmo app." :
                     "Enter the $cashtag you sent to, or copy the transaction ID from the Cash App."}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Image Preview Modal */}
      <Modal visible={!!previewItem} transparent animationType="fade" onRequestClose={() => setPreviewItem(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center" }} onPress={() => setPreviewItem(null)}>
          {previewItem?.photoUri ? (
            <Image source={{ uri: previewItem.photoUri }} style={{ width: MODAL_MAX_WIDTH - 40, height: MODAL_MAX_WIDTH - 40, borderRadius: 16 }} contentFit="cover" />
          ) : (
            <View style={{ width: MODAL_MAX_WIDTH - 40, height: 200, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 48 }}>{getCategoryDef(previewItem?.category).emoji}</Text>
            </View>
          )}
          {previewItem && (
            <View style={{ marginTop: 16, alignItems: "center", gap: 4 }}>
              <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 17 }}>{previewItem.name}</Text>
              <Text style={{ color: GREEN_ACCENT, fontWeight: "700", fontSize: 15 }}>{formatPrice(previewItem.price)}</Text>
              {previewItem.description ? <Text style={{ color: TEXT_MUTED, fontSize: 13, textAlign: "center", paddingHorizontal: 24 }}>{previewItem.description}</Text> : null}
              <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 8 }}>Tap anywhere to close</Text>
            </View>
          )}
        </Pressable>
      </Modal>

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
