/**
 * Client Portal — Booking Wizard
 *
 * Dynamic step flow:
 * 0. Service selection (pre-selected if coming from service card)
 * 1. Staff selection (or "Any available")
 * 2. Location selection (only shown when business has >1 active location)
 * 3. Date picker
 * 4. Time slot picker (location-aware when location selected)
 * 5. Payment
 * 6. Confirm & notes
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  Modal,
  TouchableOpacity,
  Linking,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getApiBaseUrl } from "@/constants/oauth";
import { scheduleAppointmentReminders } from "@/lib/notifications";
import * as Haptics from "expo-haptics";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { getCategoryDef, ALL_CATEGORY } from "@/constants/categories";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import { useStripe } from "@/lib/use-stripe";

const LIME_GREEN = "#4A7C59";
// ─── Portal palette (same as business detail) ────────────────────────────────
const PORTAL_BG    = "#1A3A28";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED   = "rgba(255,255,255,0.60)";
const CARD_BG      = "rgba(255,255,255,0.07)";
const CARD_BORDER  = "rgba(255,255,255,0.12)";
const DIVIDER      = "rgba(255,255,255,0.10)";

interface PublicService {
  localId: string;
  name: string;
  duration: number;
  price: string | null;
  description: string | null;
  category?: string | null;
  photoUri?: string | null;
  serviceType?: 'in_store' | 'mobile' | null;
  travelFee?: number | null;
  maxTravelDistance?: number | null;
}
interface PublicPackage {
  localId: string;
  name: string;
  description: string | null;
  packageItems: { serviceLocalId: string; sessions: number; daysPerSession?: number; serviceName?: string; serviceCategory?: string | null; servicePhotoUri?: string | null }[];
  totalSessions: number;
  sessionDurationMinutes: number;
  originalPrice: number;
  packagePrice: number;
  photoUri: string | null;
  firstServicePhotoUri?: string | null;
  category: string | null;
}
interface PublicStaff {
  localId: string;
  name: string;
  role: string | null;
  photoUri: string | null;
  serviceIds: string[];
  locationIds?: string[] | null;
}
interface PublicLocation {
  localId: string;
  name: string;
  address: string;
  phone: string;
  workingHours: Record<string, { enabled: boolean; start: string; end: string }> | null;
  temporarilyClosed: boolean;
}
interface AvailableSlot {
  time: string;
}

type PaymentMethodId = "zelle" | "venmo" | "cashapp" | "cash" | "card";
const BASE_PAYMENT_METHODS: { id: PaymentMethodId; label: string; icon: string; hint: string }[] = [
  { id: "zelle",   label: "Zelle",    icon: "💜", hint: "" },
  { id: "venmo",   label: "Venmo",    icon: "💙", hint: "" },
  { id: "cashapp", label: "Cash App", icon: "💚", hint: "" },
  { id: "cash",    label: "Cash",     icon: "💵", hint: "Pay in person at appointment" },
];

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw; // return as-is if not standard
}

function formatPrice(price: string | null): string {
  if (price == null) return "Price varies";
  const n = parseFloat(price);
  return isNaN(n) ? "Price varies" : `$${n.toFixed(2)}`;
}
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

export default function ClientBookingWizardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { slug, businessSlug, serviceLocalId, preServiceName, preStaffId, preStaffName, packageLocalId, preGiftCode } = useLocalSearchParams<{ slug?: string; businessSlug?: string; serviceLocalId?: string; preServiceName?: string; preStaffId?: string; preStaffName?: string; packageLocalId?: string; preGiftCode?: string }>();
  const effectiveSlug = slug || businessSlug || "";
  const { state } = useClientStore();
  const apiBase = getApiBaseUrl();

  const [step, setStep] = useState(0);
  const [services, setServices] = useState<PublicService[]>([]);
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<PublicPackage | null>(null);
  const [serviceTab, setServiceTab] = useState<"services" | "packages">("services");
  // Multi-session scheduling: array of { date: Date | null, slot: AvailableSlot | null } for each session
  const [sessionDates, setSessionDates] = useState<{ date: Date | null; slot: AvailableSlot | null }[]>([]);
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [locations, setLocations] = useState<PublicLocation[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedService, setSelectedService] = useState<PublicService | null>(null);
  const [selectedServices, setSelectedServices] = useState<PublicService[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("any");
  const [selectedLocation, setSelectedLocation] = useState<PublicLocation | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [notes, setNotes] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  // Split address sub-fields
  const [addrStreet, setAddrStreet] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [zipLookupLoading, setZipLookupLoading] = useState(false);
  // Address autocomplete state
  const [addrSearchQuery, setAddrSearchQuery] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<{ display: string; street: string; city: string; state: string; zip: string }[]>([]);
  const [addrSearchLoading, setAddrSearchLoading] = useState(false);
  const addrSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveAddressToProfile, setSaveAddressToProfile] = useState(false);
  // Derived full address from sub-fields
  const fullClientAddress = [addrStreet.trim(), addrCity.trim(), addrState.trim(), addrZip.trim()].filter(Boolean).join(", ");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId | null>(null);
  const [paymentConfirmationNumber, setPaymentConfirmationNumber] = useState("");
  // Promo / discount state
  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<{ localId: string; code: string; label: string; percentage: number | null; flatAmount: number | null } | null>(null);
  const [promoError, setPromoError] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [discounts, setDiscounts] = useState<{ localId: string; name: string; percentage: number; serviceIds: string[] }[]>([]);
  // Gift certificate state
  const [giftInput, setGiftInput] = useState("");
  const [giftApplied, setGiftApplied] = useState<{ code: string; value: number; totalValue: number; label: string; giftType: string } | null>(null);
  const [giftError, setGiftError] = useState("");
  const [giftLoading, setGiftLoading] = useState(false);
  const [businessDisplayName, setBusinessDisplayName] = useState<string>("");
  const [stripeConnectEnabled, setStripeConnectEnabled] = useState(false);
  const [businessOwnerId, setBusinessOwnerId] = useState<number | null>(null);
  // Business payment handles — loaded from bizData, shown on Payment step
  const [bizZelleHandle, setBizZelleHandle] = useState<string>("");
  const [bizVenmoHandle, setBizVenmoHandle] = useState<string>("");
  const [bizCashAppHandle, setBizCashAppHandle] = useState<string>("");
  // Tracks which handle was just copied for brief "Copied!" feedback
  const [copiedHandle, setCopiedHandle] = useState<string | null>(null);
  // Ref to hold card last4 after Stripe payment sheet succeeds (passed to confirmation screen)
  const cardLast4Ref = useRef<{ last4: string; brand: string } | null>(null);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  // Build dynamic payment methods list — Card only shown when Stripe is connected
  const PAYMENT_METHODS = useMemo(() => {
    const methods = [...BASE_PAYMENT_METHODS];
    if (stripeConnectEnabled) {
      methods.unshift({ id: "card", label: "Credit / Debit Card", icon: "💳", hint: "Pay securely online via Stripe" });
    }
    return methods;
  }, [stripeConnectEnabled]);
  // Category filter for the service selection step
  const [wizardCatFilter, setWizardCatFilter] = useState<string | null>(null);
  // ── Products step state ──────────────────────────────────────────────────
  const [wizardProducts, setWizardProducts] = useState<{ localId: string; name: string; price: string; description?: string; brand?: string }[]>([]);
  const [productCart, setProductCart] = useState<Record<string, number>>({});
  const [selectedBrandFilter, setSelectedBrandFilter] = useState<string | null>(null);
  const productBrands = useMemo(() => {
    const brands = new Set<string>();
    wizardProducts.forEach((p) => { if (p.brand) brands.add(p.brand); });
    return Array.from(brands).sort();
  }, [wizardProducts]);
  const filteredWizardProducts = useMemo(() => {
    if (!selectedBrandFilter || selectedBrandFilter === "__all__") return wizardProducts;
    return wizardProducts.filter((p) => p.brand === selectedBrandFilter);
  }, [wizardProducts, selectedBrandFilter]);
  const productCartTotal = useMemo(() => {
    return wizardProducts.reduce((sum, p) => sum + (productCart[p.localId] ?? 0) * parseFloat(p.price), 0);
  }, [wizardProducts, productCart]);
  // Full-screen photo preview state
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  // Working-days data: which weekdays are open + custom date overrides
  const [weeklyDays, setWeeklyDays] = useState<Record<string, boolean>>({});
  const [customDays, setCustomDays] = useState<Record<string, boolean>>({});
  // Set of YYYY-MM-DD strings that have zero available slots (fully booked / closed)
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  // Distinguish closed (business not working that day) vs full (working but all slots taken)
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());
  const [fullDates, setFullDates] = useState<Set<string>>(new Set());
  // Map of YYYY-MM-DD → slot count for available days
  const [slotCounts, setSlotCounts] = useState<Record<string, number>>({});
  const [loadingMonthAvail, setLoadingMonthAvail] = useState(false);
  // Tracks the month we last fetched availability for ("YYYY-MM")
  const lastAvailFetchKey = useRef<string>("");

  // Location step is always shown when there is at least 1 location (step 2 after Service)
  const showLocationStep = locations.length >= 1;

  // Build the step list dynamically — Date & Time are merged into one step
  // Products step is only shown when the business has products available
  const hasProducts = wizardProducts.length > 0;
  // Address step is shown when selected service is mobile type
  const isMobileService = selectedService?.serviceType === 'mobile';
  // Find the last client address used for this business (for pre-fill)
  const lastUsedAddress = useMemo(() => {
    if (!effectiveSlug) return (state.account as any)?.savedAddress ?? "";
    const past = state.appointments
      .filter((a) => a.businessSlug === effectiveSlug && a.clientAddress)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return past[0]?.clientAddress ?? (state.account as any)?.savedAddress ?? "";
  }, [state.appointments, effectiveSlug, state.account]);
  // Auto-populate address fields from saved/previous address when fields are empty
  useEffect(() => {
    if (!lastUsedAddress || addrStreet) return;
    // Pre-fill the search box display
    setAddrSearchQuery(lastUsedAddress);
    const parts = lastUsedAddress.split(",").map((p: string) => p.trim());
    if (parts.length >= 3) {
      setAddrStreet(parts[0] ?? "");
      setAddrCity(parts[1] ?? "");
      const last = parts[parts.length - 1] ?? "";
      const stateZip = last.split(" ").filter(Boolean);
      if (stateZip.length >= 2) {
        setAddrState(stateZip[0]);
        setAddrZip(stateZip.slice(1).join(" "));
      } else {
        setAddrState(last);
        if (parts.length >= 4) setAddrZip(parts[parts.length - 2] ?? "");
      }
    } else {
      setAddrStreet(lastUsedAddress);
    }
  }, [lastUsedAddress]); // eslint-disable-line react-hooks/exhaustive-deps
  const eligibleStaff = useMemo(() => {
    let filtered = selectedService
      ? staff.filter((m) => !m.serviceIds?.length || m.serviceIds.includes(selectedService.localId))
      : staff;
    // Further filter by selected location (only show staff assigned to that location)
    if (selectedLocation) {
      filtered = filtered.filter((m) => {
        if (!m.locationIds || !m.locationIds.length) return true; // null/empty = all locations
        return m.locationIds.includes(selectedLocation.localId);
      });
    }
    return filtered;
  }, [staff, selectedService, selectedLocation]);
  const STEPS = showLocationStep
    ? (hasProducts
        ? (isMobileService ? ["Service", "Location", "Staff", "Date & Time", "Address", "Products", "Promo", "Payment", "Confirm"] : ["Service", "Location", "Staff", "Date & Time", "Products", "Promo", "Payment", "Confirm"])
        : (isMobileService ? ["Service", "Location", "Staff", "Date & Time", "Address", "Promo", "Payment", "Confirm"] : ["Service", "Location", "Staff", "Date & Time", "Promo", "Payment", "Confirm"]))
    : (hasProducts
        ? (isMobileService ? ["Service", "Staff", "Date & Time", "Address", "Products", "Promo", "Payment", "Confirm"] : ["Service", "Staff", "Date & Time", "Products", "Promo", "Payment", "Confirm"])
        : (isMobileService ? ["Service", "Staff", "Date & Time", "Address", "Promo", "Payment", "Confirm"] : ["Service", "Staff", "Date & Time", "Promo", "Payment", "Confirm"]));
  // Step indices (dynamic)
  const STEP_SERVICE = 0;
  const STEP_LOCATION = showLocationStep ? 1 : -1;
  const STEP_STAFF = showLocationStep ? 2 : 1;
  const STEP_DATE = showLocationStep ? 3 : 2;
  const STEP_TIME = STEP_DATE;
  const _addrOff = isMobileService ? 1 : 0;
  const STEP_ADDRESS = isMobileService ? (showLocationStep ? 4 : 3) : -1;
  const STEP_PRODUCTS = hasProducts ? (showLocationStep ? 4 + _addrOff : 3 + _addrOff) : -1;
  const STEP_PROMO = hasProducts ? (showLocationStep ? 5 + _addrOff : 4 + _addrOff) : (showLocationStep ? 4 + _addrOff : 3 + _addrOff);
  const STEP_PAYMENT = hasProducts ? (showLocationStep ? 6 + _addrOff : 5 + _addrOff) : (showLocationStep ? 5 + _addrOff : 4 + _addrOff);
  const STEP_CONFIRM = hasProducts ? (showLocationStep ? 7 + _addrOff : 6 + _addrOff) : (showLocationStep ? 6 + _addrOff : 5 + _addrOff);

  // Compute the net amount due for the current booking (used to bypass Payment step when $0)
  const wizardAmountDue = useMemo(() => {
    if (!selectedService) return 0;
    const svcPrice = selectedService.price ? parseFloat(selectedService.price) : 0;
    const activeDiscount = discounts.find(d =>
      !d.serviceIds || (d.serviceIds as string[]).length === 0 || (d.serviceIds as string[]).includes(selectedService.localId)
    );
    const discSaving = activeDiscount ? parseFloat((svcPrice * activeDiscount.percentage / 100).toFixed(2)) : 0;
    const afterDiscount = svcPrice - discSaving;
    const promoSaving = promoApplied
      ? (promoApplied.flatAmount
          ? Math.min(promoApplied.flatAmount, afterDiscount)
          : parseFloat((afterDiscount * (promoApplied.percentage ?? 0) / 100).toFixed(2)))
      : 0;
    const afterPromo = Math.max(0, afterDiscount - promoSaving);
    const giftSaving = giftApplied ? Math.min(giftApplied.value, afterPromo) : 0;
    const travelFee = (isMobileService && selectedService.travelFee && selectedService.travelFee > 0) ? selectedService.travelFee : 0;
    return Math.max(0, afterPromo - giftSaving) + productCartTotal + travelFee;
  }, [selectedService, discounts, promoApplied, giftApplied, isMobileService, productCartTotal]);

  // Load services, staff, locations, and discounts
  useEffect(() => {
    (async () => {
      try {
        const [svcRes, staffRes, locRes, discRes, bizRes, pkgRes, prodRes] = await Promise.all([
          fetch(`${apiBase}/api/public/business/${effectiveSlug}/services`),
          fetch(`${apiBase}/api/public/business/${effectiveSlug}/staff`),
          fetch(`${apiBase}/api/public/business/${effectiveSlug}/locations`),
          fetch(`${apiBase}/api/public/business/${effectiveSlug}/discounts`),
          fetch(`${apiBase}/api/public/business/${effectiveSlug}`),
          fetch(`${apiBase}/api/client/packages/${effectiveSlug}`),
          fetch(`${apiBase}/api/public/business/${effectiveSlug}/products`),
        ]);
        const svcData = svcRes.ok ? await svcRes.json() : [];
        const staffData = staffRes.ok ? await staffRes.json() : [];
        const locData = locRes.ok ? await locRes.json() : [];
        const discData = discRes.ok ? await discRes.json() : [];
        const bizData = bizRes.ok ? await bizRes.json() : {};
        const pkgData = pkgRes.ok ? await pkgRes.json() : [];
        const prodData = prodRes.ok ? await prodRes.json() : [];
        setWizardProducts(Array.isArray(prodData) ? prodData : []);
        setDiscounts(Array.isArray(discData) ? discData : []);
        if (bizData?.businessName) setBusinessDisplayName(bizData.businessName);
        if (bizData?.stripeConnectEnabled) setStripeConnectEnabled(true);
        if (bizData?.id) setBusinessOwnerId(bizData.id);
        if (bizData?.zelleHandle) setBizZelleHandle(bizData.zelleHandle);
        if (bizData?.venmoHandle) setBizVenmoHandle(bizData.venmoHandle);
        if (bizData?.cashAppHandle) setBizCashAppHandle(bizData.cashAppHandle);
        setPackages(Array.isArray(pkgData) ? pkgData : []);
        const svcList: PublicService[] = Array.isArray(svcData) ? svcData : [];
        const staffList: PublicStaff[] = Array.isArray(staffData) ? staffData : [];
        const locList: PublicLocation[] = Array.isArray(locData)
          ? locData.filter((l: any) => !l.temporarilyClosed)
          : [];
        setServices(svcList);
        setStaff(staffList);
        setLocations(locList);
        // Auto-select single location
        if (locList.length === 1) {
          setSelectedLocation(locList[0]);
        }
        // Step routing:
        // - packageLocalId (Book This Package) → pre-select package + Location step (step 1)
        // - serviceLocalId (per-service Book button) → Location step (step 1) so client picks branch first
        // - preGiftCode (Redeem Gift) → Location step (step 1)
        // - preServiceName (Book Again) → Location step (step 1)
        // - no params (Book an Appointment) → stays at step 0 (Service selection)
        const pkgList: any[] = Array.isArray(pkgData) ? pkgData : [];
        if (packageLocalId) {
          // Pre-select the package and jump straight to Location step
          const pkg = pkgList.find((p: any) => p.localId === String(packageLocalId));
          if (pkg) {
            setSelectedPackage(pkg);
            setServiceTab("packages");
            setSessionDates(Array.from({ length: pkg.totalSessions }, () => ({ date: null, slot: null })));
            setActiveSessionIdx(0);
            const syntheticService = {
              localId: pkg.localId,
              name: pkg.name,
              duration: pkg.sessionDurationMinutes,
              price: String(pkg.packagePrice),
              description: pkg.description,
              category: pkg.category,
              photoUri: pkg.photoUri,
            };
            setSelectedService(syntheticService as any);
            setSelectedServices([syntheticService as any]);
            setStep(1); // Jump to Location step
          }
        } else if (serviceLocalId) {
          const found = svcList.find((s) => s.localId === serviceLocalId);
          if (found) {
            setSelectedService(found);
            setStep(1); // Location step
          }
        } else if (preServiceName) {
          // Book Again / Redeem Gift by name: pre-select service by name (case-insensitive match)
          const found = svcList.find((s) => s.name.toLowerCase() === String(preServiceName).toLowerCase());
          if (found) {
            setSelectedService(found);
            setStep(1); // Location step
          }
        }
        // Pre-select staff from "Book with [Name]" on business detail
        if (preStaffId) {
          const foundStaff = staffList.find((m) => m.localId === preStaffId);
          if (foundStaff) {
            setSelectedStaffId(foundStaff.localId);
          } else if (preStaffName) {
            const byName = staffList.find((m) => m.name.toLowerCase() === String(preStaffName).toLowerCase());
            if (byName) setSelectedStaffId(byName.localId);
          }
        }
      } catch (err) {
        console.warn("[BookingWizard] load error:", err);
      } finally {
        setLoadingData(false);
      }
     })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSlug, serviceLocalId, preServiceName, preStaffId, preStaffName, packageLocalId, apiBase]);

  // Pre-fill gift code when navigating from "Redeem" on home screen
  useEffect(() => {
    if (preGiftCode) {
      setGiftInput(String(preGiftCode));
    }
  }, [preGiftCode]);

  // Auto-advance past Location step for single-location businesses
  // When the user lands on the Location step and there is only one location (already auto-selected),
  // wait 300 ms then skip forward to the Staff step automatically.
  useEffect(() => {
    if (step !== STEP_LOCATION) return;
    if (locations.length !== 1) return;
    if (!selectedLocation) return;
    const timer = setTimeout(() => {
      setStep(STEP_STAFF);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, STEP_LOCATION, STEP_STAFF, locations.length, selectedLocation]);

  // Auto-validate gift code when client reaches the Promo step with a pre-filled code
  useEffect(() => {
    if (step !== STEP_PROMO) return;
    if (!giftInput.trim() || giftApplied) return;
    if (!effectiveSlug || !apiBase) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/public/business/${effectiveSlug}/gift-validate/${encodeURIComponent(giftInput.trim())}`);
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json();
          const giftType = data.giftType ?? "service";
          const label = giftType === "balance"
            ? `Balance Credit — $${parseFloat(data.value).toFixed(2)} available`
            : `Gift Certificate — $${parseFloat(data.value).toFixed(2)} value`;
          setGiftApplied({ code: data.code, value: parseFloat(data.value), totalValue: parseFloat(data.totalValue ?? data.value), label, giftType });
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // If this is a package gift, auto-select the package in the service step
          if (data.packageLocalId && packages.length > 0) {
            const pkg = packages.find((p) => p.localId === data.packageLocalId);
            if (pkg) {
              setSelectedPackage(pkg);
              setServiceTab("packages");
              setSessionDates(Array.from({ length: pkg.totalSessions }, () => ({ date: null, slot: null })));
              setActiveSessionIdx(0);
              const syntheticService = {
                localId: pkg.localId,
                name: pkg.name,
                duration: pkg.sessionDurationMinutes,
                price: String(pkg.packagePrice),
                description: pkg.description,
                category: pkg.category,
                photoUri: pkg.photoUri,
              };
              setSelectedService(syntheticService as any);
              setSelectedServices([syntheticService as any]);
            }
          }
        }
      } catch { /* silent — user can still apply manually */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, STEP_PROMO]);

  // Fetch working-days info (weeklyDays + customDays) whenever slug/location changes
  useEffect(() => {
    if (!effectiveSlug) return;
    (async () => {
      try {
        const locParam = selectedLocation ? `?locationId=${encodeURIComponent(selectedLocation.localId)}` : "";
        const res = await fetch(`${apiBase}/api/public/business/${effectiveSlug}/working-days${locParam}`);
        if (res.ok) {
          const data = await res.json();
          setWeeklyDays(data.weeklyDays ?? {});
          setCustomDays(data.customDays ?? {});
        }
      } catch (err) {
        console.warn("[BookingWizard] working-days error:", err);
      }
    })();
  }, [effectiveSlug, selectedLocation, apiBase]);

  // Auto-detect state (and city) from ZIP code using Zippopotam.us
  const handleZipChange = useCallback(async (zip: string) => {
    setAddrZip(zip);
    const clean = zip.replace(/\D/g, "");
    if (clean.length === 5) {
      setZipLookupLoading(true);
      try {
        const r = await fetch(`https://api.zippopotam.us/us/${clean}`);
        if (r.ok) {
          const d = await r.json();
          if (d?.places?.[0]) {
            const place = d.places[0];
            // Only auto-fill if user hasn't already typed something
            setAddrState((prev) => prev.trim() ? prev : (place["state abbreviation"] || ""));
            setAddrCity((prev) => prev.trim() ? prev : (place["place name"] || ""));
          }
        }
      } catch (_) {}
      setZipLookupLoading(false);
    }
  }, []);

  // Fetch month-level availability: for each day in the visible month, check if any slots exist.
  // Uses the slots endpoint per day but only for the current calendar month when it changes.
  const fetchMonthAvailability = useCallback(async (year: number, month: number, service: typeof selectedService, location: typeof selectedLocation, staffId: string) => {
    if (!service || !effectiveSlug) return;
    const fetchKey = `${year}-${String(month + 1).padStart(2, "0")}-${service.localId}-${location?.localId ?? "any"}-${staffId}`;
    if (lastAvailFetchKey.current === fetchKey) return; // already fetched
    lastAvailFetchKey.current = fetchKey;
    setLoadingMonthAvail(true);
    const newUnavailable = new Set<string>();
    const newClosed = new Set<string>();
    const newFull = new Set<string>();
    const newSlotCounts: Record<string, number> = {};
    const todayStr = new Date().toISOString().split("T")[0];
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    // Build list of future dates in this month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayDate = new Date();
    const WEEKDAY_KEYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    const promises: Promise<void>[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      if (dateObj < new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate())) continue;
      const dateStr = dateObj.toISOString().split("T")[0];
      const staffParam = staffId !== "any" ? `&staffId=${encodeURIComponent(staffId)}` : "";
      const locParam = location ? `&locationId=${encodeURIComponent(location.localId)}` : "";
      const url = `${apiBase}/api/public/business/${effectiveSlug}/slots?date=${dateStr}&duration=${service.duration}${staffParam}${locParam}&clientToday=${todayStr}&nowMinutes=${nowMinutes}`;
      // Determine if the day is a working day per weeklyDays/customDays
      const weekdayKey = WEEKDAY_KEYS[dateObj.getDay()];
      const customOverride = customDays[dateStr];
      const isWorkingDay = customOverride !== undefined ? customOverride : (weeklyDays[weekdayKey] ?? false);
      promises.push(
        fetch(url)
          .then((r) => r.ok ? r.json() : { slots: [] })
          .then((data) => {
            const count = data.slots?.length ?? 0;
            if (!count) {
              newUnavailable.add(dateStr);
              if (!isWorkingDay) {
                newClosed.add(dateStr);
              } else {
                newFull.add(dateStr);
              }
            } else {
              newSlotCounts[dateStr] = count;
            }
          })
          .catch(() => {})
      );
    }
    await Promise.all(promises);
    setUnavailableDates(newUnavailable);
    setClosedDates(newClosed);
    setFullDates(newFull);
    setSlotCounts(newSlotCounts);
    setLoadingMonthAvail(false);
  }, [effectiveSlug, apiBase, weeklyDays, customDays]);

  // Trigger month availability fetch when calendar month or service changes
  useEffect(() => {
    if (selectedService) {
      fetchMonthAvailability(calYear, calMonth, selectedService, selectedLocation, selectedStaffId);
    }
  }, [calYear, calMonth, selectedService, selectedLocation, selectedStaffId, fetchMonthAvailability]);

  // Manual refresh: re-fetch slots for the currently selected date
  const handleRefreshSlots = useCallback(() => {
    if (!selectedDate || !selectedService) return;
    // Force re-fetch by clearing slots and re-triggering the slots useEffect
    setSlots([]);
    setSelectedSlot(null);
    // Bump a counter to force the useEffect to re-run even if deps haven't changed
    setRefreshCounter((c) => c + 1);
  }, [selectedDate, selectedService]);
  const [refreshCounter, setRefreshCounter] = useState(0);
  // Slot interval: 0 = Auto (use business default), or 5/10/15/20/25/30 min
  const [slotStep, setSlotStep] = useState<number>(0);

  // Load slots — location-aware
  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    (async () => {
      setLoadingSlots(true);
      setSlots([]);
      setSelectedSlot(null);
      try {
        const dateStr = selectedDate.toISOString().split("T")[0];
        const staffParam = selectedStaffId !== "any" ? `&staffId=${encodeURIComponent(selectedStaffId)}` : "";
        const locParam = selectedLocation ? `&locationId=${encodeURIComponent(selectedLocation.localId)}` : "";
        const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        const clientToday = new Date().toISOString().split("T")[0];
        const stepParam = slotStep > 0 ? `&step=${slotStep}` : "";
        const url = `${apiBase}/api/public/business/${effectiveSlug}/slots?date=${dateStr}&duration=${selectedService.duration}${staffParam}${locParam}&clientToday=${clientToday}&nowMinutes=${nowMinutes}${stepParam}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const rawSlots: string[] = data.slots ?? [];
          setSlots(rawSlots.map((t) => ({ time: t })));
        }
      } catch (err) {
        console.warn("[BookingWizard] slots error:", err);
      } finally {
        setLoadingSlots(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedService, selectedStaffId, selectedLocation, effectiveSlug, apiBase, refreshCounter, slotStep]);

  const handleNext = () => {
    Keyboard.dismiss();
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // When the step just before Payment is completed and the net amount due is $0
    // (gift fully covers the booking), skip the Payment step entirely and jump to Confirm.
    const nextStep = step + 1;
    if (nextStep === STEP_PAYMENT && wizardAmountDue <= 0) {
      setPaymentMethod("cash" as PaymentMethodId); // sentinel — server treats $0 as free/paid
      setStep(STEP_CONFIRM);
      return;
    }
    // Address step: sync address and handle travel zone warning
    if (step === STEP_ADDRESS) {
      if (selectedService?.maxTravelDistance) {
        Alert.alert(
          "⚠️ Check Service Area",
          `This service has a maximum travel distance of ${selectedService.maxTravelDistance} miles. Please confirm your address is within the service area before continuing.`,
          [
            { text: "Go Back", style: "cancel" },
            {
              text: "I'm in Range",
              onPress: () => {
                setClientAddress(fullClientAddress);
                setStep((s) => Math.min(s + 1, STEPS.length - 1));
              },
            },
          ]
        );
        return;
      }
      setClientAddress(fullClientAddress);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const handleBack = () => {
    if (step === 0) {
      // If wizard was started from a gift card, signal the home screen to scroll to gifts on return
      if (preGiftCode) {
        AsyncStorage.setItem("scroll_to_gifts_on_focus", "1").catch(() => {});
      }
      router.back();
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    if (!selectedService || !selectedDate || !selectedSlot) return;
    // When the gift fully covers the booking ($0 due), skip all payment validation
    if (wizardAmountDue > 0) {
      if (!paymentMethod) {
        Alert.alert("Payment Required", "Please select a payment method before confirming.");
        return;
      }
      // Card payments don't need a confirmation number — Stripe handles it
      if (paymentMethod !== "cash" && paymentMethod !== "card" && !paymentConfirmationNumber.trim()) {
        Alert.alert("Confirmation Number Required", "Please enter your payment confirmation number.");
        return;
      }
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Pre-check: if a package is being used, verify it hasn't expired
    if (packageLocalId) {
      try {
        const pkgCheckRes = await fetch(`${apiBase}/api/client/my-packages/${packageLocalId}/use-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.sessionToken}` },
          body: JSON.stringify({ dryRun: true }),
        });
        if (!pkgCheckRes.ok) {
          const pkgErr = await pkgCheckRes.json().catch(() => ({ error: "Package check failed" }));
          if ((pkgErr as any).code === "PACKAGE_EXPIRED") {
            Alert.alert("Package Expired", `This package expired on ${(pkgErr as any).expiresAt}. Please book without a package or purchase a new one.`);
            return;
          }
        }
      } catch {
        // Non-blocking — proceed with booking
      }
    }
    setSubmitting(true);
    try {
      const dateStr = selectedDate.toISOString().split("T")[0];
      const clientName = state.account?.name ?? "Guest";
      const clientEmail = state.account?.email ?? undefined;
      const rawPhone = state.account?.phone ?? "";
      const clientPhone = rawPhone.startsWith("oauth:") ? undefined : rawPhone || undefined;
      // Calculate promo/discount savings
      const servicePrice = selectedService.price ? parseFloat(selectedService.price) : 0;
      let finalPrice = servicePrice;
      let discountName: string | undefined;
      let discountPercentage: number | undefined;
      let discountAmount: number | undefined;
      // Check active discounts for this service
      const activeDiscount = discounts.find(d =>
        !d.serviceIds || (d.serviceIds as string[]).length === 0 || (d.serviceIds as string[]).includes(selectedService.localId)
      );
      if (activeDiscount) {
        discountName = activeDiscount.name;
        discountPercentage = activeDiscount.percentage;
        discountAmount = parseFloat((servicePrice * activeDiscount.percentage / 100).toFixed(2));
        finalPrice -= discountAmount;
      }
      // Apply promo code on top
      let promoSaving = 0;
      if (promoApplied) {
        if (promoApplied.flatAmount) {
          promoSaving = Math.min(promoApplied.flatAmount, finalPrice);
        } else if (promoApplied.percentage) {
          promoSaving = parseFloat((finalPrice * promoApplied.percentage / 100).toFixed(2));
        }
        finalPrice = Math.max(0, finalPrice - promoSaving);
      }
      // Add product cart total to final price
      const selectedProductItems = wizardProducts
        .filter(p => (productCart[p.localId] ?? 0) > 0)
        .map(p => ({ localId: p.localId, name: p.name, price: p.price, qty: productCart[p.localId] }));
      finalPrice += productCartTotal;
      // Add travel fee for mobile services when client address is provided
      // Sync fullClientAddress into clientAddress before submission
      const effectiveClientAddress = isMobileService ? fullClientAddress || clientAddress : clientAddress;
      const travelFeeAmount = (isMobileService && effectiveClientAddress.trim() && selectedService.travelFee) ? selectedService.travelFee : 0;
      finalPrice += travelFeeAmount;
      const res = await fetch(`${apiBase}/api/public/business/${effectiveSlug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientEmail,
          clientPhone,
          serviceLocalId: selectedService.localId,
          date: dateStr,
          time: selectedSlot.time,
          duration: selectedService.duration,
          notes: notes.trim() || null,
          staffId: selectedStaffId !== "any" ? selectedStaffId : undefined,
          locationId: selectedLocation?.localId ?? undefined,
          // When the gift fully covers the booking (amount due = $0), mark as free/paid
          paymentMethod: wizardAmountDue <= 0 ? "free" : paymentMethod,
          paymentStatus: wizardAmountDue <= 0 ? "paid" : undefined,
          paymentConfirmationNumber: (paymentMethod !== "cash" && wizardAmountDue > 0) ? paymentConfirmationNumber.trim() : undefined,
          promoCode: promoApplied?.code ?? undefined,
          promoLocalId: promoApplied?.localId ?? undefined,
          giftCode: giftApplied?.code ?? undefined,
          giftSaving: giftApplied ? Math.min(giftApplied.value, Math.max(0, servicePrice - (discountAmount ?? 0) - (promoSaving ?? 0))) : undefined,
          packageLocalId: packageLocalId ?? undefined,
          sessionDates: selectedPackage && sessionDates.length > 1
            ? sessionDates.map(sd => ({ date: sd.date?.toISOString().split("T")[0] ?? null, time: sd.slot?.time ?? null }))
            : undefined,
          discountName,
          discountPercentage,
          discountAmount,
          subtotal: servicePrice,
          totalPrice: finalPrice,
          products: selectedProductItems.length > 0 ? selectedProductItems : undefined,
          clientAddress: isMobileService && effectiveClientAddress.trim() ? effectiveClientAddress.trim() : undefined,
          travelFee: travelFeeAmount > 0 ? travelFeeAmount : undefined,
          // Client's local date/time so server can correctly validate slot availability across timezones
          clientToday: (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })(),
          nowMinutes: (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Booking failed" }));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }
      const bookingResult = await res.json().catch(() => ({}));
      const appointmentId = bookingResult?.appointmentId ?? `appt-${Date.now()}`;
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      scheduleAppointmentReminders(
        appointmentId,
        effectiveSlug,
        selectedService.name,
        dateStr,
        selectedSlot.time
      ).catch(() => {});
      // Decrement package session count if this booking used a package
      if (packageLocalId) {
        fetch(`${apiBase}/api/client/my-packages/${packageLocalId}/use-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.sessionToken}` },
          body: JSON.stringify({ appointmentId }),
        }).catch(() => {});
      }
      const selectedStaffMember = selectedStaffId !== "any" ? staff.find((m) => m.localId === selectedStaffId) : null;

      // ── Card payment: native Stripe payment sheet (iOS/Android) or web redirect ──
      if (paymentMethod === "card" && finalPrice > 0) {
        try {
          if (Platform.OS !== "web" && businessOwnerId) {
            // Native: use Stripe React Native payment sheet
            const sheetRes = await fetch(`${apiBase}/api/stripe-connect/create-payment-sheet`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.sessionToken}` },
              body: JSON.stringify({
                businessOwnerId,
                appointmentLocalId: appointmentId,
                amount: finalPrice,
                currency: "usd",
                description: `${selectedService.name} — ${dateStr} at ${selectedSlot.time}`,
                clientEmail: state.account?.email ?? undefined,
              }),
            });
            if (sheetRes.ok) {
              const { publishableKey, paymentIntent, accountId } = await sheetRes.json();
              const { error: initError } = await initPaymentSheet({
                merchantDisplayName: businessDisplayName || effectiveSlug,
                paymentIntentClientSecret: paymentIntent,
                style: "alwaysDark",
                stripeAccountId: accountId,
              });
              if (!initError) {
                const { error: presentError } = await presentPaymentSheet();
                if (presentError && presentError.code !== "Canceled") {
                  Alert.alert("Payment Failed", presentError.message ?? "Please try again.");
                } else if (!presentError) {
                  // Payment succeeded — fetch card last4 for receipt display
                  try {
                    const last4Res = await fetch(
                      `${apiBase}/api/stripe-connect/payment-intent-last4?appointmentId=${encodeURIComponent(appointmentId)}&businessOwnerId=${encodeURIComponent(String(businessOwnerId))}`,
                      { headers: { "Authorization": `Bearer ${state.sessionToken}` } }
                    );
                    if (last4Res.ok) {
                      const { last4, brand } = await last4Res.json();
                      if (last4) cardLast4Ref.current = { last4, brand: brand ?? "card" };
                    }
                  } catch { /* non-blocking */ }
                }
              }
            } else {
              // Fallback to web checkout
              const fallbackRes = await fetch(`${apiBase}/api/stripe-connect/request-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.sessionToken}` },
                body: JSON.stringify({ appointmentId, businessSlug: effectiveSlug, amount: finalPrice, clientEmail: state.account?.email ?? undefined }),
              });
              if (fallbackRes.ok) {
                const { paymentUrl } = await fallbackRes.json();
                if (paymentUrl) await WebBrowser.openAuthSessionAsync(paymentUrl, undefined, { showInRecents: false });
              }
            }
          } else {
            // Web: redirect to Stripe Checkout
            const stripeRes = await fetch(`${apiBase}/api/stripe-connect/request-payment`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.sessionToken}` },
              body: JSON.stringify({
                appointmentId,
                businessSlug: effectiveSlug,
                amount: finalPrice,
                description: `${selectedService.name} — ${dateStr} at ${selectedSlot.time}`,
                clientEmail: state.account?.email ?? undefined,
              }),
            });
            if (stripeRes.ok) {
              const { paymentUrl } = await stripeRes.json();
              if (paymentUrl) {
                window.location.href = paymentUrl;
                return;
              }
            }
          }
        } catch {
          // Non-blocking — booking is already confirmed, payment link failure is recoverable
        }
      }

      // Save address to client profile if checkbox was checked
      if (saveAddressToProfile && isMobileService && effectiveClientAddress.trim() && state.sessionToken) {
        fetch(`${apiBase}/api/client/profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.sessionToken}` },
          body: JSON.stringify({ savedAddress: effectiveClientAddress.trim() }),
        }).then(async (r) => {
          if (r.ok) {
            const data = await r.json().catch(() => ({}));
            if (data.clientAccount) dispatch({ type: "SET_ACCOUNT", account: data.clientAccount });
          }
        }).catch(() => {});
      }
      router.replace({
        pathname: "/client-booking-confirmation",
        params: {
          serviceName: selectedService.name,
          staffName: selectedStaffMember?.name ?? "",
          staffAvatarUrl: selectedStaffMember?.photoUri ?? "",
          locationName: selectedLocation?.name ?? "",
          locationAddress: selectedLocation?.address ?? "",
          locationPhone: selectedLocation?.phone ?? "",
          date: dateStr,
          time: selectedSlot.time,
          duration: String(selectedService.duration),
          businessName: businessDisplayName || effectiveSlug,
          businessSlug: effectiveSlug,
          price: `$${finalPrice.toFixed(2)}`,
          originalPrice: selectedService.price ?? "",
          discountName: discountName ?? "",
          discountAmount: discountAmount ? `$${discountAmount.toFixed(2)}` : "",
          promoCode: promoApplied?.code ?? "",
          promoSaving: promoSaving > 0 ? `$${promoSaving.toFixed(2)}` : "",
          giftCode: giftApplied?.code ?? "",
          giftSaving: giftApplied ? `$${Math.min(giftApplied.value, Math.max(0, (selectedService ? (parseFloat(selectedService.price ?? "0") || 0) : 0) - (discountAmount ?? 0) - (promoSaving ?? 0))).toFixed(2)}` : "",
          paymentMethod: paymentMethod ?? "",
          paymentConfirmationNumber: paymentMethod !== "cash" ? paymentConfirmationNumber.trim() : "",
          cardLast4: cardLast4Ref.current?.last4 ?? "",
          cardBrand: cardLast4Ref.current?.brand ?? "",
          clientAddress: isMobileService && effectiveClientAddress.trim() ? effectiveClientAddress.trim() : "",
          travelFee: travelFeeAmount > 0 ? `$${travelFeeAmount.toFixed(2)}` : "",
        },
      } as any);
    } catch (err: any) {
      Alert.alert("Booking Failed", err?.message ?? "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const s = styles(colors);

  if (loadingData) {
    return (
      <ScreenContainer containerClassName="bg-[#0D2318]">
      <StatusBar style="light" />
        <ClientPortalBackground />
        <View style={s.loadingContainer}>
          <ActivityIndicator color={LIME_GREEN} size="large" />
          <Text style={{ color: TEXT_MUTED, marginTop: 12 }}>Loading...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const calDays = getDaysInMonth(calYear, calMonth);
  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <ScreenContainer containerClassName="bg-[#0D2318]">
      <ClientPortalBackground />
      {/* Drag handle — visual affordance for fullScreenModal dismiss */}
      <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
      </View>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]} onPress={handleBack}>
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
        </Pressable>
        {/* Service thumbnail + name in header when a service is pre-selected */}
        {selectedService && step > STEP_SERVICE ? (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {selectedService.imageUrl ? (
              <Image
                source={{ uri: selectedService.imageUrl }}
                style={{ width: 28, height: 28, borderRadius: 6 }}
                contentFit="cover"
              />
            ) : null}
            <Text numberOfLines={1} style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "700", flexShrink: 1 }}>
              {selectedService.name}
            </Text>
          </View>
        ) : (
          <Text style={[s.headerTitle, { color: TEXT_PRIMARY }]}>Book Appointment</Text>
        )}
        <View style={{ width: 32 }} />
      </View>

      {/* Step indicator */}
      <View style={s.stepIndicator}>
        {STEPS.map((label, i) => (
          <View key={i} style={s.stepItem}>
            <View style={[s.stepDot, { backgroundColor: i <= step ? LIME_GREEN : DIVIDER }]}>
              {i < step ? (
                <IconSymbol name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={{ color: i <= step ? "#FFFFFF" : TEXT_MUTED, fontSize: 11, fontWeight: "700" }}>{i + 1}</Text>
              )}
            </View>
            {i < STEPS.length - 1 && (
              <View style={[s.stepLine, { backgroundColor: i < step ? LIME_GREEN : DIVIDER }]} />
            )}
          </View>
        ))}
      </View>
      <Text style={[s.stepLabel, { color: TEXT_PRIMARY }]}>{STEPS[step]}</Text>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >

        {/* Step 0: Service */}
        {step === STEP_SERVICE && (() => {
          // Derive unique categories from the service list
          const svcCats = Array.from(new Set(services.map((s) => s.category).filter(Boolean) as string[]));
          const filteredServices = wizardCatFilter
            ? services.filter((s) => s.category === wizardCatFilter)
            : services;
          return (
            <View style={s.stepContent}>
              <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Choose a Service</Text>
              {/* Services / Packages tab switcher */}
              {packages.length > 0 && (
                <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 3, marginBottom: 14 }}>
                  {(["services", "packages"] as const).map((tab) => (
                    <Pressable
                      key={tab}
                      style={({ pressed }) => [{
                        flex: 1, alignItems: "center" as const, paddingVertical: 8, borderRadius: 8,
                        backgroundColor: serviceTab === tab ? LIME_GREEN : "transparent",
                        opacity: pressed ? 0.8 : 1,
                      }]}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setServiceTab(tab);
                        if (tab === "services") setSelectedPackage(null);
                      }}
                    >
                      <Text style={{ color: serviceTab === tab ? "#FFFFFF" : TEXT_MUTED, fontWeight: "600", fontSize: 14, textTransform: "capitalize" }}>
                        {tab === "services" ? "Services" : "Packages"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {/* ── Packages tab ── */}
              {serviceTab === "packages" && packages.length > 0 && (
                <View style={{ gap: 12 }}>
                  {packages.map((pkg) => {
                    const savings = pkg.originalPrice > pkg.packagePrice ? pkg.originalPrice - pkg.packagePrice : 0;
                    const isSelected = selectedPackage?.localId === pkg.localId;
                    return (
                      <Pressable
                        key={pkg.localId}
                        style={({ pressed }) => [
                          s.optionCard,
                          { backgroundColor: CARD_BG, borderColor: isSelected ? LIME_GREEN : CARD_BORDER, padding: 0, overflow: "hidden", flexDirection: "column", alignItems: "stretch" },
                          isSelected && { borderWidth: 2 },
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          if (isSelected) {
                            setSelectedPackage(null);
                            setSelectedService(null);
                            setSelectedServices([]);
                            setSessionDates([]);
                            setActiveSessionIdx(0);
                          } else {
                            setSelectedPackage(pkg);
                            // Initialize sessionDates array for each session
                            setSessionDates(Array.from({ length: pkg.totalSessions }, () => ({ date: null, slot: null })));
                            setActiveSessionIdx(0);
                            // Auto-populate selectedService with a synthetic service for downstream steps
                            const syntheticService: PublicService = {
                              localId: pkg.localId,
                              name: pkg.name,
                              duration: pkg.sessionDurationMinutes,
                              price: String(pkg.packagePrice),
                              description: pkg.description,
                              category: pkg.category,
                              photoUri: pkg.photoUri,
                            };
                            setSelectedService(syntheticService);
                            setSelectedServices([syntheticService]);
                          }
                        }}
                      >
                        {/* Package image — use package photo, fallback to first service photo */}
                        {(pkg.photoUri || pkg.firstServicePhotoUri) ? (
                          <Image
                            source={{ uri: (pkg.photoUri || pkg.firstServicePhotoUri)! }}
                            style={{ width: "100%", height: 130 }}
                            contentFit="cover"
                          />
                        ) : null}
                        <View style={{ padding: 14, gap: 6 }}>
                          {/* Top row: name + price side by side, no overlap */}
                          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                            <View style={{ flex: 1, gap: 4 }}>
                              <Text style={{ color: TEXT_PRIMARY, fontSize: 16, fontWeight: "700" }}>{pkg.name}</Text>
                              {pkg.description ? <Text style={{ color: TEXT_MUTED, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{pkg.description}</Text> : null}
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(74,124,89,0.2)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                  <Text style={{ color: LIME_GREEN, fontSize: 12, fontWeight: "600" }}>📦 {pkg.totalSessions} session{pkg.totalSessions !== 1 ? "s" : ""}</Text>
                                </View>
                                {pkg.category ? (
                                  <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                    <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>{pkg.category}</Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                            {/* Price column — no absolute-positioned badge overlapping it */}
                            <View style={{ alignItems: "flex-end", gap: 4, minWidth: 80 }}>
                              <Text style={{ color: LIME_GREEN, fontSize: 18, fontWeight: "800" }}>${pkg.packagePrice.toFixed(2)}</Text>
                              {savings > 0 ? (
                                <>
                                  <Text style={{ color: TEXT_MUTED, fontSize: 12, textDecorationLine: "line-through" }}>${pkg.originalPrice.toFixed(2)}</Text>
                                  <View style={{ backgroundColor: "#22C55E20", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                                    <Text style={{ color: "#4ADE80", fontSize: 11, fontWeight: "700" }}>Save ${savings.toFixed(2)}</Text>
                                  </View>
                                </>
                              ) : null}
                            </View>
                          </View>
                          {/* Included services */}
                          {pkg.packageItems.length > 0 && (
                            <View style={{ marginTop: 4, gap: 3 }}>
                              {pkg.packageItems.map((item, idx) => (
                                <Text key={idx} style={{ color: TEXT_MUTED, fontSize: 12 }}>
                                  • {item.serviceName ?? item.serviceLocalId}{item.sessions > 1 ? ` × ${item.sessions}` : ""}
                                </Text>
                              ))}
                            </View>
                          )}
                          {/* Check circle — bottom-right, inside the content area, never overlaps price */}
                          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
                            <View style={[s.checkCircle, { backgroundColor: isSelected ? LIME_GREEN : "rgba(255,255,255,0.12)", borderWidth: isSelected ? 0 : 1.5, borderColor: "rgba(255,255,255,0.30)" }]}>
                              {isSelected && <IconSymbol name="checkmark" size={14} color="#FFFFFF" />}
                            </View>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {/* ── Services tab ── */}
              {serviceTab === "services" && <>
              {/* Category filter chips — use wrapping View to avoid ScrollView touch conflicts on iOS */}
              {svcCats.length > 1 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 12 }}>
                  {[null, ...svcCats].map((cat) => {
                    const isAll = cat === null;
                    const isActive = wizardCatFilter === cat;
                    const def = isAll ? ALL_CATEGORY : getCategoryDef(cat);
                    const accentColor = def.color;
                    return (
                      <Pressable
                        key={cat ?? "__all__"}
                        style={({ pressed }) => [{
                          flexDirection: "row" as const,
                          alignItems: "center" as const,
                          gap: 5,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 20,
                          borderWidth: 1,
                          height: 34,
                          backgroundColor: isActive ? accentColor + "30" : CARD_BG,
                          borderColor: isActive ? accentColor : CARD_BORDER,
                          opacity: pressed ? 0.75 : 1,
                        }]}
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setWizardCatFilter(isAll ? null : cat);
                        }}
                      >
                        <Text style={{ fontSize: 13, lineHeight: 16 }}>{def.emoji}</Text>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: isActive ? accentColor : TEXT_PRIMARY }}>
                          {isAll ? "All" : cat}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {filteredServices.length === 0 ? (
                <Text style={{ color: TEXT_MUTED, textAlign: "center", marginTop: 24 }}>No services in this category.</Text>
              ) : filteredServices.map((svc) => (
                <Pressable
                  key={svc.localId}
                  style={({ pressed }) => [
                    s.optionCard,
                    { backgroundColor: CARD_BG, borderColor: selectedServices.some((s) => s.localId === svc.localId) ? LIME_GREEN : CARD_BORDER, padding: 0, overflow: "hidden", flexDirection: "column", alignItems: "stretch" },
                    selectedServices.some((s) => s.localId === svc.localId) && { borderWidth: 2 },
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const isSelected = selectedServices.some((s) => s.localId === svc.localId);
                    const updated = isSelected
                      ? selectedServices.filter((s) => s.localId !== svc.localId)
                      : [...selectedServices, svc];
                    setSelectedServices(updated);
                    // Keep selectedService as the first selected for backward compat
                    setSelectedService(updated.length > 0 ? updated[0] : null);
                    setSelectedStaffId("any");
                    setSelectedDate(null);
                    setSelectedSlot(null);
                  }}
                >
                  {/* Service photo thumbnail */}
                  {svc.photoUri ? (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPreviewUri(svc.photoUri!);
                      }}
                      style={{ width: "100%" }}
                    >
                      <Image
                        source={{ uri: svc.photoUri }}
                        style={{ width: "100%", height: 130, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
                        contentFit="cover"
                      />
                      {/* Dark gradient overlay at bottom for readability */}
                      <LinearGradient
                        colors={["transparent", "rgba(0,0,0,0.55)"]}
                        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
                        pointerEvents="none"
                      />
                      <View style={{ position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <IconSymbol name="arrow.up.left.and.arrow.down.right" size={11} color="#FFFFFF" />
                        <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "600" }}>Preview</Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                  {/* Text content — always shown below photo (or as full card if no photo) */}
                  <View style={{ flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={[s.optionName, { color: TEXT_PRIMARY }]}>{svc.name}</Text>
                        {svc.category && (() => {
                          const def = getCategoryDef(svc.category);
                          return (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: def.color + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, lineHeight: 13 }}>{def.emoji}</Text>
                              <Text style={{ fontSize: 10, fontWeight: "600", color: def.color }}>{svc.category}</Text>
                            </View>
                          );
                        })()}
                      </View>
                      {svc.description ? <Text style={[s.optionDesc, { color: TEXT_MUTED }]} numberOfLines={2}>{svc.description}</Text> : null}
                      <Text style={[s.optionMeta, { color: LIME_GREEN }]}>{svc.duration} min · {formatPrice(svc.price)}</Text>
                    </View>
                    <View style={[s.checkCircle, { flexShrink: 0, backgroundColor: selectedServices.some((s) => s.localId === svc.localId) ? LIME_GREEN : "rgba(255,255,255,0.12)", borderWidth: selectedServices.some((s) => s.localId === svc.localId) ? 0 : 1.5, borderColor: "rgba(255,255,255,0.30)" }]}>
                      {selectedServices.some((s) => s.localId === svc.localId) && (
                        <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                      )}
                    </View>
                  </View>
                </Pressable>
              ))}
          </>}
            </View>
          );
        })()}

            {/* Selected services summary bar */}
            {selectedServices.length > 0 && (
              <View style={{ marginTop: 8, backgroundColor: "rgba(74,124,89,0.18)", borderRadius: 12, borderWidth: 1, borderColor: `${LIME_GREEN}40`, padding: 12, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "700" }}>
                    {selectedServices.length} service{selectedServices.length > 1 ? "s" : ""} selected
                  </Text>
                  <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "700" }}>
                    {formatPrice(
                      selectedServices.reduce((sum, s) => sum + (s.price ? parseFloat(s.price) : 0), 0).toFixed(2)
                    )}
                  </Text>
                </View>
                {selectedServices.map((s) => (
                  <View key={s.localId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 13, flex: 1 }} numberOfLines={1}>{s.name}</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 12, marginLeft: 8 }}>{s.duration} min · {formatPrice(s.price)}</Text>
                  </View>
                ))}
              </View>
            )}
        {/* Step 1: Staff */}
        {step === STEP_STAFF && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Choose a Staff Member</Text>
            <Pressable
              style={({ pressed }) => [
                s.optionCard,
                { backgroundColor: CARD_BG, borderColor: selectedStaffId === "any" ? LIME_GREEN : CARD_BORDER },
                selectedStaffId === "any" && { borderWidth: 2 },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setSelectedStaffId("any")}
            >
              <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}20`, alignItems: "center", justifyContent: "center" }]}>
                <IconSymbol name="person.3.fill" size={20} color={LIME_GREEN} />
              </View>
              <View style={s.optionLeft}>
                <Text style={[s.optionName, { color: TEXT_PRIMARY }]}>Any Available</Text>
                <Text style={[s.optionDesc, { color: TEXT_MUTED }]}>First available staff member</Text>
              </View>
              {selectedStaffId === "any" && (
                <View style={[s.checkCircle, { backgroundColor: LIME_GREEN }]}>
                  <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
            {eligibleStaff.length === 0 && (
              <View style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 13, textAlign: "center" }}>
                  No individual staff members are listed. Select "Any Available" to continue.
                </Text>
              </View>
            )}
            {eligibleStaff.map((member) => (
              <Pressable
                key={member.localId}
                style={({ pressed }) => [
                  s.optionCard,
                  { backgroundColor: CARD_BG, borderColor: selectedStaffId === member.localId ? LIME_GREEN : CARD_BORDER },
                  selectedStaffId === member.localId && { borderWidth: 2 },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setSelectedStaffId(member.localId)}
              >
                {member.photoUri && !member.photoUri.startsWith("file://") ? (
                  <Image
                    source={{ uri: member.photoUri }}
                    style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}20` }]}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}25`, alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: LIME_GREEN }}>{member.name.charAt(0)}</Text>
                  </View>
                )}
                <View style={s.optionLeft}>
                  <Text style={[s.optionName, { color: TEXT_PRIMARY }]}>{member.name}</Text>
                  {member.role ? <Text style={[s.optionDesc, { color: TEXT_MUTED }]}>{member.role}</Text> : null}
                </View>
                {selectedStaffId === member.localId && (
                  <View style={[s.checkCircle, { backgroundColor: LIME_GREEN }]}>
                    <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* Step 2 (dynamic): Location — only shown when >1 location */}
        {step === STEP_LOCATION && showLocationStep && (
          <View style={s.stepContent}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <Text style={[s.stepTitle, { color: TEXT_PRIMARY, marginBottom: 0 }]}>Choose a Location</Text>
              {selectedService && (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setStep(STEP_SERVICE);
                  }}
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, paddingVertical: 4, paddingHorizontal: 2 }]}
                >
                  <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "600" }}>Change service</Text>
                </Pressable>
              )}
            </View>
            <Text style={[s.stepSubtitle, { color: TEXT_MUTED }]}>Select where you'd like your appointment.</Text>
            {locations.map((loc) => (
              <Pressable
                key={loc.localId}
                style={({ pressed }) => [
                  s.optionCard,
                  { backgroundColor: CARD_BG, borderColor: selectedLocation?.localId === loc.localId ? LIME_GREEN : CARD_BORDER },
                  selectedLocation?.localId === loc.localId && { borderWidth: 2 },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedLocation(loc);
                  setSelectedDate(null);
                  setSelectedSlot(null);
                  // Invalidate the availability cache so the calendar re-fetches slots
                  // for the newly chosen location on the Date & Time step.
                  lastAvailFetchKey.current = "";
                }}
              >
                <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}20`, alignItems: "center", justifyContent: "center" }]}>
                  <IconSymbol name="location.fill" size={18} color={LIME_GREEN} />
                </View>
                <View style={s.optionLeft}>
                  <Text style={[s.optionName, { color: TEXT_PRIMARY }]}>{loc.name}</Text>
                  {loc.address ? (
                    <Text style={[s.optionDesc, { color: TEXT_MUTED }]} numberOfLines={2}>{loc.address}</Text>
                  ) : null}
                  {loc.phone ? (
                    <Text style={[s.optionMeta, { color: TEXT_MUTED }]}>{formatPhone(loc.phone)}</Text>
                  ) : null}
                </View>
                {selectedLocation?.localId === loc.localId && (
                  <View style={[s.checkCircle, { backgroundColor: LIME_GREEN }]}>
                    <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* Date & Time step — merged into one */}
        {step === STEP_DATE && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Pick a Date & Time</Text>
            {selectedLocation && (
              <View style={[s.locationBadge, { backgroundColor: `${LIME_GREEN}15`, borderColor: `${LIME_GREEN}40` }]}>
                <IconSymbol name="location.fill" size={12} color={LIME_GREEN} />
                <Text style={{ color: LIME_GREEN, fontSize: 12, fontWeight: "600" }}>{selectedLocation.name}</Text>
              </View>
            )}
            {/* ── Multi-session session selector (packages only) ── */}
            {selectedPackage && sessionDates.length > 1 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 8, lineHeight: 18 }}>
                  This package includes <Text style={{ color: LIME_GREEN, fontWeight: "700" }}>{selectedPackage.totalSessions} sessions</Text>. Schedule each session below — each must be at least 7 days apart.
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {sessionDates.map((sd, idx) => {
                    const isActive = activeSessionIdx === idx;
                    const isDone = sd.date != null && sd.slot != null;
                    return (
                      <Pressable
                        key={idx}
                        style={({ pressed }) => [{
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 20,
                          borderWidth: 1.5,
                          borderColor: isActive ? LIME_GREEN : isDone ? `${LIME_GREEN}60` : CARD_BORDER,
                          backgroundColor: isActive ? `${LIME_GREEN}20` : isDone ? `${LIME_GREEN}10` : CARD_BG,
                          alignItems: "center" as const,
                          minWidth: 80,
                        }, pressed && { opacity: 0.7 }]}
                        onPress={() => {
                          setActiveSessionIdx(idx);
                          // Restore this session's date/slot into the main pickers
                          const prev = sessionDates[idx];
                          setSelectedDate(prev.date);
                          setSelectedSlot(prev.slot);
                          if (prev.date) {
                            setCalMonth(prev.date.getMonth());
                            setCalYear(prev.date.getFullYear());
                          }
                        }}
                      >
                        <Text style={{ color: isActive ? LIME_GREEN : isDone ? `${LIME_GREEN}CC` : TEXT_MUTED, fontSize: 12, fontWeight: "700" }}>
                          Session {idx + 1}
                        </Text>
                        {isDone ? (
                          <Text style={{ color: isDone ? `${LIME_GREEN}CC` : TEXT_MUTED, fontSize: 10, marginTop: 2 }}>
                            {sd.date!.toLocaleDateString("en-US", { month: "short", day: "numeric" })} {sd.slot!.time}
                          </Text>
                        ) : (
                          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 2 }}>Not set</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {/* Buffer enforcement info */}
                {activeSessionIdx > 0 && sessionDates[activeSessionIdx - 1]?.date && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, padding: 8, backgroundColor: `${LIME_GREEN}10`, borderRadius: 8, borderWidth: 1, borderColor: `${LIME_GREEN}30` }}>
                    <Text style={{ fontSize: 14 }}>📅</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 12, flex: 1, lineHeight: 16 }}>
                      Session {activeSessionIdx + 1} must be at least{" "}
                      <Text style={{ color: LIME_GREEN, fontWeight: "700" }}>7 days</Text> after Session {activeSessionIdx} (
                      {(() => {
                        const minDate = new Date(sessionDates[activeSessionIdx - 1]!.date!);
                        minDate.setDate(minDate.getDate() + 7);
                        return minDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      })()}{" "}
                      or later).
                    </Text>
                  </View>
                )}
              </View>
            )}
            {/* ── Calendar ── */}
            <View style={s.monthNav}>
              <Pressable
                style={({ pressed }) => [s.monthBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else setCalMonth((m) => m - 1); }}
              >
                <IconSymbol name="chevron.left" size={18} color={TEXT_PRIMARY} />
              </Pressable>
              <Text style={[s.monthLabel, { color: TEXT_PRIMARY }]}>{monthLabel}</Text>
              <Pressable
                style={({ pressed }) => [s.monthBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else setCalMonth((m) => m + 1); }}
              >
                <IconSymbol name="chevron.right" size={18} color={TEXT_PRIMARY} />
              </Pressable>
            </View>
            <View style={s.dayHeaders}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <Text key={i} style={[s.dayHeader, { color: TEXT_MUTED }]}>{d}</Text>
              ))}
            </View>
            {/* Month-level availability loading indicator */}
            {loadingMonthAvail && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <ActivityIndicator size="small" color={LIME_GREEN} />
                <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>Checking availability…</Text>
              </View>
            )}
            <View style={s.calGrid}>
              {Array.from({ length: new Date(calYear, calMonth, 1).getDay() }).map((_, i) => (
                <View key={`empty-${i}`} style={s.calCell} />
              ))}
              {calDays.map((day) => {
                const isPast = day < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const dateStr = day.toISOString().split("T")[0];
                const isUnavailable = !isPast && unavailableDates.has(dateStr);
                const isClosed = !isPast && closedDates.has(dateStr);
                const isFull = !isPast && fullDates.has(dateStr);
                const isSelected = selectedDate?.toDateString() === day.toDateString();
                const isToday = day.toDateString() === today.toDateString();
                // Buffer enforcement for multi-session packages
                const isBeforeBuffer = selectedPackage && sessionDates.length > 1 && activeSessionIdx > 0 && sessionDates[activeSessionIdx - 1]?.date != null
                  ? (() => {
                      const minDate = new Date(sessionDates[activeSessionIdx - 1]!.date!);
                      minDate.setDate(minDate.getDate() + 7);
                      return day < minDate;
                    })()
                  : false;
                const isDisabled = isPast || isUnavailable || isBeforeBuffer;
                return (
                  <Pressable
                    key={day.toISOString()}
                    style={({ pressed }) => [
                      s.calCell,
                      isSelected && { backgroundColor: LIME_GREEN, borderRadius: 20 },
                      isToday && !isSelected && { borderWidth: 1.5, borderColor: LIME_GREEN, borderRadius: 20 },
                      (isPast || isUnavailable) && { opacity: isClosed ? 0.25 : 0.45 },
                      pressed && !isDisabled && { opacity: 0.7 },
                    ]}
                    onPress={() => {
                      if (isDisabled) return;
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedDate(day);
                      setSelectedSlot(null); // reset time when date changes
                      // For packages: save to sessionDates
                      if (selectedPackage && sessionDates.length > 1) {
                        setSessionDates(prev => prev.map((sd, i) => i === activeSessionIdx ? { ...sd, date: day, slot: null } : sd));
                      }
                    }}
                    disabled={isDisabled}
                  >
                    <Text style={{ color: isSelected ? "#FFFFFF" : isUnavailable ? TEXT_MUTED : TEXT_PRIMARY, fontSize: 14, fontWeight: isToday ? "700" : "400" }}>
                      {day.getDate()}
                    </Text>
                    {isClosed && !isPast && (
                      <Text style={{ fontSize: 7, fontWeight: "600", color: TEXT_MUTED, marginTop: 1, lineHeight: 9 }}>
                        Closed
                      </Text>
                    )}
                    {isFull && !isPast && (
                      <Text style={{ fontSize: 7, fontWeight: "600", color: "#F59E0B", marginTop: 1, lineHeight: 9 }}>
                        Full
                      </Text>
                    )}
                    {!isUnavailable && !isPast && slotCounts[dateStr] != null && (
                      <Text style={{
                        fontSize: 9,
                        fontWeight: "700",
                        color: isSelected ? "rgba(255,255,255,0.85)" : LIME_GREEN,
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

            {/* ── Available Times (shown below calendar once a date is selected) ── */}
            {selectedDate && (
              <View style={{ marginTop: 4 }}>
                <View style={s.timeSectionHeader}>
                  <IconSymbol name="clock" size={15} color={LIME_GREEN} />
                  <Text style={[s.timeSectionTitle, { color: TEXT_PRIMARY, flex: 1 }]}>
                    Available Times · {formatDateLabel(selectedDate)}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [{ padding: 6, borderRadius: 16, opacity: pressed || loadingSlots ? 0.5 : 1 }]}
                    onPress={handleRefreshSlots}
                    disabled={loadingSlots}
                  >
                    <IconSymbol name="arrow.clockwise" size={16} color={LIME_GREEN} />
                  </Pressable>
                </View>
                {/* Interval picker */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10, marginTop: 2 }}>
                  {([0, 5, 10, 15, 20, 25, 30] as const).map((mins) => {
                    const isActive = slotStep === mins;
                    return (
                      <Pressable
                        key={mins}
                        onPress={() => {
                          setSlotStep(mins);
                          setSelectedSlot(null);
                          setRefreshCounter((c) => c + 1);
                        }}
                        style={({ pressed }) => [{
                          paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
                          borderWidth: 1.5,
                          borderColor: isActive ? LIME_GREEN : CARD_BORDER,
                          backgroundColor: isActive ? `${LIME_GREEN}20` : CARD_BG,
                          opacity: pressed ? 0.7 : 1,
                        }]}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "600", color: isActive ? LIME_GREEN : TEXT_MUTED }}>
                          {mins === 0 ? "Auto" : `${mins}m`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {loadingSlots ? (
                  <ActivityIndicator color={LIME_GREEN} style={{ marginTop: 16 }} />
                ) : slots.length === 0 ? (
                  <View style={s.noSlots}>
                    <Text style={[s.noSlotsText, { color: TEXT_MUTED }]}>No available times on this date.</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>Try selecting a different date above.</Text>
                  </View>
                ) : (
                  <View style={s.slotsGrid}>
                    {slots.map((slot) => {
                      const isSelected = selectedSlot?.time === slot.time;
                      return (
                        <Pressable
                          key={slot.time}
                          style={({ pressed }) => [
                            s.slotBtn,
                            { backgroundColor: isSelected ? LIME_GREEN : CARD_BG, borderColor: isSelected ? LIME_GREEN : CARD_BORDER },
                            pressed && { opacity: 0.8 },
                          ]}
                          onPress={() => {
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setSelectedSlot(slot);
                            // For packages: save to sessionDates
                            if (selectedPackage && sessionDates.length > 1) {
                              setSessionDates(prev => prev.map((sd, i) => i === activeSessionIdx ? { ...sd, slot } : sd));
                              // Auto-advance to next unset session
                              const nextUnset = sessionDates.findIndex((sd, i) => i > activeSessionIdx && (sd.date == null || sd.slot == null));
                              if (nextUnset !== -1) {
                                setTimeout(() => {
                                  setActiveSessionIdx(nextUnset);
                                  setSelectedDate(null);
                                  setSelectedSlot(null);
                                  // Jump calendar to min date for next session
                                  const minDate = new Date(sessionDates[nextUnset - 1]?.date ?? new Date());
                                  minDate.setDate(minDate.getDate() + 7);
                                  setCalMonth(minDate.getMonth());
                                  setCalYear(minDate.getFullYear());
                                }, 300);
                              }
                            }
                          }}
                        >
                          <Text style={{ color: isSelected ? "#FFFFFF" : TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>
                            {slot.time}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Products step */}
        {step === STEP_PRODUCTS && hasProducts && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Add Products</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 16 }}>Optionally add retail products to your appointment.</Text>
            {/* Brand filter pills */}
            {productBrands.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                <Pressable
                  onPress={() => setSelectedBrandFilter(null)}
                  style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: !selectedBrandFilter ? LIME_GREEN : "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: !selectedBrandFilter ? LIME_GREEN : CARD_BORDER }}
                >
                  <Text style={{ color: !selectedBrandFilter ? "#FFF" : TEXT_MUTED, fontSize: 13, fontWeight: "600" }}>All</Text>
                </Pressable>
                {productBrands.map((brand) => (
                  <Pressable
                    key={brand}
                    onPress={() => setSelectedBrandFilter(selectedBrandFilter === brand ? null : brand)}
                    style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: selectedBrandFilter === brand ? LIME_GREEN : "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: selectedBrandFilter === brand ? LIME_GREEN : CARD_BORDER }}
                  >
                    <Text style={{ color: selectedBrandFilter === brand ? "#FFF" : TEXT_MUTED, fontSize: 13, fontWeight: "600" }}>{brand}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {/* Product list */}
            {filteredWizardProducts.map((product) => {
              const qty = productCart[product.localId] ?? 0;
              return (
                <View key={product.localId} style={{ backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: CARD_BORDER, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>{product.name}</Text>
                    {product.brand && <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }}>{product.brand}</Text>}
                    {product.description ? <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{product.description}</Text> : null}
                    <Text style={{ color: LIME_GREEN, fontSize: 14, fontWeight: "700", marginTop: 4 }}>${parseFloat(product.price).toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Pressable
                      onPress={() => setProductCart(prev => { const next = { ...prev }; if ((next[product.localId] ?? 0) > 0) next[product.localId] = (next[product.localId] ?? 0) - 1; return next; })}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: qty > 0 ? LIME_GREEN : "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "700", lineHeight: 20 }}>-</Text>
                    </Pressable>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 16, fontWeight: "700", minWidth: 20, textAlign: "center" }}>{qty}</Text>
                    <Pressable
                      onPress={() => setProductCart(prev => ({ ...prev, [product.localId]: (prev[product.localId] ?? 0) + 1 }))}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LIME_GREEN, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "700", lineHeight: 20 }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {/* Cart summary */}
            {productCartTotal > 0 && (
              <View style={{ backgroundColor: "rgba(74,124,89,0.12)", borderRadius: 12, borderWidth: 1, borderColor: `${LIME_GREEN}40`, padding: 14, marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>Products subtotal</Text>
                <Text style={{ color: LIME_GREEN, fontSize: 16, fontWeight: "700" }}>+${productCartTotal.toFixed(2)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Payment step */}
        {step === STEP_PAYMENT && selectedService && (() => {
          // Price breakdown calculation (same logic as Confirm step)
          const _svcPrice = selectedService.price ? parseFloat(selectedService.price) : 0;
          const _activeDiscount = discounts.find(d => !d.serviceIds || (d.serviceIds as string[]).length === 0 || (d.serviceIds as string[]).includes(selectedService.localId));
          const _discSaving = _activeDiscount ? parseFloat((_svcPrice * _activeDiscount.percentage / 100).toFixed(2)) : 0;
          const _afterDiscount = _svcPrice - _discSaving;
          const _promoSaving = promoApplied
            ? promoApplied.flatAmount
              ? Math.min(promoApplied.flatAmount, _afterDiscount)
              : parseFloat((_afterDiscount * (promoApplied.percentage ?? 0) / 100).toFixed(2))
            : 0;
          const _afterPromo = Math.max(0, _afterDiscount - _promoSaving);
          const _giftSaving = giftApplied ? Math.min(giftApplied.value, _afterPromo) : 0;
          // Travel fee for mobile services
          const _travelFee = (isMobileService && selectedService.travelFee && selectedService.travelFee > 0) ? selectedService.travelFee : 0;
          const _finalPrice = Math.max(0, _afterPromo - _giftSaving) + productCartTotal + _travelFee;
          const _hasDiscounts = _discSaving > 0 || _promoSaving > 0 || _giftSaving > 0 || _travelFee > 0;
          return (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Payment</Text>
            {/* 🎁 Partial gift banner — shown when gift covers some but not all of the total */}
            {_giftSaving > 0 && _finalPrice > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(74,222,128,0.10)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(74,222,128,0.35)", padding: 12, marginBottom: 12 }}>
                <Text style={{ fontSize: 20 }}>🎁</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#4ADE80", fontSize: 13, fontWeight: "700", marginBottom: 2 }}>Gift Applied — ${_giftSaving.toFixed(2)} off</Text>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 15, fontWeight: "800" }}>Remaining: ${_finalPrice.toFixed(2)}</Text>
                </View>
              </View>
            )}
            {/* Price breakdown summary card */}
            <View style={{ backgroundColor: "rgba(74,124,89,0.12)", borderRadius: 12, borderWidth: 1, borderColor: `${LIME_GREEN}40`, padding: 14, marginBottom: 16, gap: 6 }}>
              <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "700", marginBottom: 4 }}>Order Summary</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>{selectedService.name}</Text>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 13 }}>${_svcPrice.toFixed(2)}</Text>
              </View>
              {productCartTotal > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Products ({Object.values(productCart).reduce((a,b) => a+b, 0)} items)</Text>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 13 }}>+${productCartTotal.toFixed(2)}</Text>
                </View>
              )}
              {_discSaving > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Discount ({_activeDiscount!.percentage}%)</Text>
                  <Text style={{ color: "#4ADE80", fontSize: 13 }}>-${_discSaving.toFixed(2)}</Text>
                </View>
              )}
              {_promoSaving > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Promo ({promoApplied!.code})</Text>
                  <Text style={{ color: "#4ADE80", fontSize: 13 }}>-${_promoSaving.toFixed(2)}</Text>
                </View>
              )}
              {_giftSaving > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>Gift ({giftApplied!.code})</Text>
                  <Text style={{ color: "#4ADE80", fontSize: 13 }}>-${_giftSaving.toFixed(2)}</Text>
                </View>
              )}
              {_travelFee > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>🚗 Travel Fee</Text>
                  <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "600" }}>+${_travelFee.toFixed(2)}</Text>
                </View>
              )}
              {_hasDiscounts && <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.1)", marginVertical: 4 }} />}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "700" }}>Amount Due</Text>
                <Text style={{ color: LIME_GREEN, fontSize: 16, fontWeight: "800" }}>${_finalPrice.toFixed(2)}</Text>
              </View>
            </View>
            <Text style={[s.stepSubtitle, { color: TEXT_MUTED }]}>
              Select how you'll pay for this appointment.
            </Text>

            <View style={{ gap: 10, marginTop: 8 }}>
              {PAYMENT_METHODS.map((method) => (
                <Pressable
                  key={method.id}
                  style={({ pressed }) => [
                    s.paymentCard,
                    {
                      backgroundColor: paymentMethod === method.id ? LIME_GREEN + "20" : CARD_BG,
                      borderColor: paymentMethod === method.id ? LIME_GREEN : CARD_BORDER,
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setPaymentMethod(method.id);
                    if (method.id === "cash") setPaymentConfirmationNumber("");
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{method.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.paymentMethodLabel, { color: TEXT_PRIMARY }]}>{method.label}</Text>
                    {/* Show handle with copy button if available */}
                    {(method.id === "zelle" && bizZelleHandle) ||
                     (method.id === "venmo" && bizVenmoHandle) ||
                     (method.id === "cashapp" && bizCashAppHandle) ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <Text style={[s.paymentMethodHint, { color: TEXT_MUTED, flex: 1 }]}>
                          {method.id === "zelle" ? bizZelleHandle : method.id === "venmo" ? bizVenmoHandle : bizCashAppHandle}
                        </Text>
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            const handle = method.id === "zelle" ? bizZelleHandle : method.id === "venmo" ? bizVenmoHandle : bizCashAppHandle;
                            Clipboard.setStringAsync(handle);
                            setCopiedHandle(method.id);
                            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            setTimeout(() => setCopiedHandle(null), 2000);
                          }}
                          style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: copiedHandle === method.id ? LIME_GREEN + "40" : CARD_BORDER }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ fontSize: 11, color: copiedHandle === method.id ? LIME_GREEN : TEXT_MUTED, fontWeight: "600" }}>
                            {copiedHandle === method.id ? "Copied!" : "Copy"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={[s.paymentMethodHint, { color: TEXT_MUTED }]}>
                        {method.hint || (method.id === "zelle" ? "Send to business Zelle" : method.id === "venmo" ? "Send via @username" : method.id === "cashapp" ? "Send via $cashtag" : "")}
                      </Text>
                    )}
                  </View>
                  {paymentMethod === method.id && (
                    <IconSymbol name="checkmark.circle.fill" size={22} color={LIME_GREEN} />
                  )}
                </Pressable>
              ))}
            </View>

            {paymentMethod && paymentMethod !== "cash" && paymentMethod !== "card" && (
              <View style={{ marginTop: 16 }}>
                <Text style={[s.notesLabel, { color: TEXT_PRIMARY }]}>
                  {paymentMethod === "zelle" ? "Zelle" : paymentMethod === "venmo" ? "Venmo" : "Cash App"} Confirmation
                </Text>
                <TextInput
                  style={[s.notesInput, { backgroundColor: CARD_BG, borderColor: paymentConfirmationNumber.trim() ? LIME_GREEN : CARD_BORDER, color: TEXT_PRIMARY }]}
                  placeholder={
                    paymentMethod === "zelle"
                      ? (bizZelleHandle ? `Sent to ${bizZelleHandle}? Enter confirmation` : "e.g. Phone or email you sent to")
                      : paymentMethod === "venmo"
                      ? (bizVenmoHandle ? `Sent to ${bizVenmoHandle}? Enter confirmation` : "e.g. @username or transaction ID")
                      : (bizCashAppHandle ? `Sent to ${bizCashAppHandle}? Enter confirmation` : "e.g. $cashtag or transaction ID")
                  }
                  placeholderTextColor={TEXT_MUTED}
                  value={paymentConfirmationNumber}
                  onChangeText={setPaymentConfirmationNumber}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {/* Format hint per method */}
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 6 }}>
                  <Text style={{ fontSize: 13 }}>
                    {paymentMethod === "zelle" ? "📱" : paymentMethod === "venmo" ? "💙" : "💚"}
                  </Text>
                  <Text style={{ color: TEXT_MUTED, fontSize: 12, flex: 1, lineHeight: 16 }}>
                    {paymentMethod === "zelle"
                      ? "Enter the phone number or email address you used to send the Zelle payment."
                      : paymentMethod === "venmo"
                      ? "Enter the @username you sent to, or copy the transaction ID from the Venmo app."
                      : "Enter the $cashtag you sent to, or copy the transaction ID from the Cash App."}
                  </Text>
                </View>
              </View>
            )}

            {paymentMethod === "cash" && (
              <View style={[s.cashInfoCard, { backgroundColor: CARD_BG, borderColor: CARD_BORDER }]}>
                <IconSymbol name="info.circle.fill" size={18} color={TEXT_MUTED} />
                <Text style={[{ color: TEXT_MUTED, fontSize: 13, flex: 1, lineHeight: 18 }]}>
                  Cash payments are collected at your appointment. The business will confirm receipt from their side.
                </Text>
              </View>
            )}
            {paymentMethod === "card" && (
              <View style={[s.cashInfoCard, { backgroundColor: "rgba(74,222,128,0.07)", borderColor: `${LIME_GREEN}40` }]}>
                <Text style={{ fontSize: 16 }}>💳</Text>
                <Text style={[{ color: TEXT_MUTED, fontSize: 13, flex: 1, lineHeight: 18 }]}>
                  You'll be taken to a secure Stripe payment screen after confirming your booking.
                </Text>
              </View>
            )}
          </View>
          );
        })()}

        {/* Address Step (mobile services) */}
        {step === STEP_ADDRESS && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Your Address</Text>
            <Text style={[s.stepSubtitle, { color: TEXT_MUTED }]}>This service is performed at your location. Please enter the address where you'd like the service.</Text>
            <View style={[s.card, { padding: 16, marginTop: 8 }]}>
              {/* Pre-fill hint when a previous address is available */}
              {!addrStreet && lastUsedAddress ? (
                <Pressable
                  onPress={() => {
                    // Parse "Street, City, State ZIP" or "Street, City, State, ZIP"
                    const parts = lastUsedAddress.split(",").map((p: string) => p.trim());
                    if (parts.length >= 3) {
                      setAddrStreet(parts[0] ?? "");
                      setAddrCity(parts[1] ?? "");
                      // Last part might be "State ZIP" or just "State"
                      const last = parts[parts.length - 1] ?? "";
                      const stateZip = last.split(" ").filter(Boolean);
                      if (stateZip.length >= 2) {
                        setAddrState(stateZip[0]);
                        setAddrZip(stateZip.slice(1).join(" "));
                      } else {
                        setAddrState(last);
                        if (parts.length >= 4) setAddrZip(parts[parts.length - 2] ?? "");
                      }
                    } else {
                      setAddrStreet(lastUsedAddress);
                    }
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "rgba(143,191,106,0.10)",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: "rgba(143,191,106,0.25)",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: 11, color: "#8FBF6A", flex: 1 }}>📍 Use previous address: {lastUsedAddress}</Text>
                  <Text style={{ fontSize: 11, color: "#8FBF6A", fontWeight: "700", marginLeft: 8 }}>Use</Text>
                </Pressable>
              ) : null}
              {/* Address Search Autocomplete */}
              <Text style={{ fontSize: 11, fontWeight: "600", color: TEXT_MUTED, marginBottom: 4 }}>Search Address</Text>
              <View style={{ position: "relative", marginBottom: 14 }}>
                <TextInput
                  placeholder="Start typing your address…"
                  placeholderTextColor={TEXT_MUTED}
                  value={addrSearchQuery}
                  onChangeText={(text) => {
                    setAddrSearchQuery(text);
                    if (addrSearchTimer.current) clearTimeout(addrSearchTimer.current);
                    if (text.length < 4) { setAddrSuggestions([]); return; }
                    addrSearchTimer.current = setTimeout(async () => {
                      setAddrSearchLoading(true);
                      try {
                        const url = `${apiBase}/api/public/places-autocomplete?q=${encodeURIComponent(text)}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        const { results } = data as { results: { display: string; street: string; city: string; state: string; zip: string }[] };
                        setAddrSuggestions(results ?? []);
                      } catch { setAddrSuggestions([]); }
                      finally { setAddrSearchLoading(false); }
                    }, 500);
                  }}
                  style={{
                    color: TEXT_PRIMARY,
                    fontSize: 13,
                    borderWidth: 1,
                    borderColor: "rgba(143,191,106,0.5)",
                    borderRadius: 10,
                    padding: 12,
                    paddingRight: 36,
                    backgroundColor: "rgba(255,255,255,0.05)",
                  }}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {addrSearchLoading && (
                  <ActivityIndicator size="small" color={LIME_GREEN} style={{ position: "absolute", right: 10, top: 12 }} />
                )}
                {addrSuggestions.length > 0 && (
                  <View style={{ borderWidth: 1, borderColor: CARD_BORDER, borderRadius: 10, backgroundColor: CARD_BG, marginTop: 4 }}>
                    {addrSuggestions.map((s, i) => (
                      <Pressable
                        key={i}
                        onPress={() => {
                          setAddrStreet(s.street);
                          setAddrCity(s.city);
                          setAddrState(s.state);
                          setAddrZip(s.zip);
                          setAddrSearchQuery(s.street + (s.city ? ", " + s.city : ""));
                          setAddrSuggestions([]);
                          Keyboard.dismiss();
                        }}
                        style={({ pressed }) => ({
                          padding: 12,
                          borderTopWidth: i > 0 ? 1 : 0,
                          borderTopColor: CARD_BORDER,
                          backgroundColor: pressed ? "rgba(143,191,106,0.12)" : "transparent",
                        })}
                      >
                        <Text style={{ color: TEXT_PRIMARY, fontSize: 13 }} numberOfLines={1}>{s.street}{s.city ? ", " + s.city : ""}</Text>
                        <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{s.state}{s.zip ? " " + s.zip : ""}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
              {/* Street Address */}
              <Text style={{ fontSize: 11, fontWeight: "600", color: TEXT_MUTED, marginBottom: 4 }}>Street Address <Text style={{ color: "#EF4444" }}>*</Text></Text>
              <TextInput
                placeholder="e.g. 456 Oak Ave"
                placeholderTextColor={TEXT_MUTED}
                value={addrStreet}
                onChangeText={setAddrStreet}
                style={{
                  color: TEXT_PRIMARY,
                  fontSize: 13,
                  borderWidth: 1,
                  borderColor: addrStreet.trim() ? "rgba(255,255,255,0.2)" : "#EF444480",
                  borderRadius: 10,
                  padding: 12,
                  backgroundColor: "rgba(255,255,255,0.05)",
                  marginBottom: 10,
                }}
                returnKeyType="next"
              />
              {/* City */}
              <Text style={{ fontSize: 11, fontWeight: "600", color: TEXT_MUTED, marginBottom: 4 }}>City <Text style={{ color: "#EF4444" }}>*</Text></Text>
              <TextInput
                placeholder="Your city"
                placeholderTextColor={TEXT_MUTED}
                value={addrCity}
                onChangeText={setAddrCity}
                style={{
                  color: TEXT_PRIMARY,
                  fontSize: 13,
                  borderWidth: 1,
                  borderColor: addrCity.trim() ? "rgba(255,255,255,0.2)" : "#EF444480",
                  borderRadius: 10,
                  padding: 12,
                  backgroundColor: "rgba(255,255,255,0.05)",
                  marginBottom: 10,
                }}
                returnKeyType="next"
              />
              {/* State & ZIP side by side */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: TEXT_MUTED, marginBottom: 4 }}>State <Text style={{ color: "#EF4444" }}>*</Text></Text>
                  <TextInput
                    placeholder="ST"
                    placeholderTextColor={TEXT_MUTED}
                    value={addrState}
                    onChangeText={setAddrState}
                    autoCapitalize="characters"
                    maxLength={2}
                    style={{
                      color: TEXT_PRIMARY,
                      fontSize: 13,
                      borderWidth: 1,
                      borderColor: addrState.trim() ? "rgba(255,255,255,0.2)" : "#EF444480",
                      borderRadius: 10,
                      padding: 12,
                      backgroundColor: "rgba(255,255,255,0.05)",
                    }}
                    returnKeyType="next"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: TEXT_MUTED, marginBottom: 4 }}>ZIP Code <Text style={{ color: "#EF4444" }}>*</Text></Text>
                  <View style={{ position: "relative" }}>
                    <TextInput
                      placeholder="ZIP code"
                      placeholderTextColor={TEXT_MUTED}
                      value={addrZip}
                      onChangeText={handleZipChange}
                      keyboardType="number-pad"
                      maxLength={10}
                      style={{
                        color: TEXT_PRIMARY,
                        fontSize: 13,
                        borderWidth: 1,
                        borderColor: addrZip.trim() ? "rgba(255,255,255,0.2)" : "#EF444480",
                        borderRadius: 10,
                        padding: 12,
                        paddingRight: zipLookupLoading ? 36 : 12,
                        backgroundColor: "rgba(255,255,255,0.05)",
                      }}
                      returnKeyType="done"
                    />
                    {zipLookupLoading && (
                      <ActivityIndicator size="small" color={TEXT_MUTED} style={{ position: "absolute", right: 10, top: 12 }} />
                    )}
                  </View>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 8 }}>
                We'll come to you at this address.
              </Text>
            </View>
            <View style={{ flex: 1 }} />
          </View>
        )}
        {/* Promo / Discount step */}
        {step === STEP_PROMO && selectedService && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Discounts & Promo</Text>
            <Text style={[s.stepSubtitle, { color: TEXT_MUTED }]}>Apply a promo code or see active discounts. This step is optional.</Text>

            {/* Active discounts for this service — show only the best (highest %) one */}
            {(() => {
              const applicable = discounts.filter(d => !d.serviceIds || (d.serviceIds as string[]).length === 0 || (d.serviceIds as string[]).includes(selectedService.localId));
              const best = applicable.length > 0 ? applicable.reduce((a, b) => b.percentage > a.percentage ? b : a) : null;
              if (!best) {
                return (
                  <View style={[s.discountBanner, { backgroundColor: CARD_BG, borderColor: CARD_BORDER }]}>
                    <Text style={{ fontSize: 18 }}>💡</Text>
                    <Text style={[{ color: TEXT_MUTED, fontSize: 13, flex: 1 }]}>No active discounts for this service right now.</Text>
                  </View>
                );
              }
              return (
                <View style={[s.discountBanner, { backgroundColor: `${LIME_GREEN}18`, borderColor: `${LIME_GREEN}40` }]}>
                  <Text style={{ fontSize: 20 }}>🏷️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.discountName, { color: TEXT_PRIMARY }]}>{best.name}</Text>
                    <Text style={[s.discountPct, { color: LIME_GREEN }]}>{best.percentage}% off — saves ${((selectedService.price ? parseFloat(selectedService.price) : 0) * best.percentage / 100).toFixed(2)}</Text>
                  </View>
                  <View style={[s.discountBadge, { backgroundColor: LIME_GREEN }]}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>AUTO</Text>
                  </View>
                </View>
              );
            })()}

            {/* Promo code entry */}
            <Text style={[s.notesLabel, { color: TEXT_PRIMARY, marginTop: 8 }]}>Promo Code</Text>
            {promoApplied ? (
              <View style={[s.promoAppliedCard, { backgroundColor: `${LIME_GREEN}15`, borderColor: `${LIME_GREEN}50` }]}>
                <Text style={{ fontSize: 20 }}>✅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }]}>{promoApplied.code}</Text>
                  <Text style={[{ color: LIME_GREEN, fontSize: 13 }]}>
                    {promoApplied.label} — saves {promoApplied.flatAmount ? `$${promoApplied.flatAmount.toFixed(2)}` : `${promoApplied.percentage}%`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => { setPromoApplied(null); setPromoInput(""); setPromoError(""); }}
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: "600" }}>Remove</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={[s.notesInput, { flex: 1, minHeight: 0, paddingVertical: 12, backgroundColor: CARD_BG, borderColor: promoError ? "#F87171" : CARD_BORDER, color: TEXT_PRIMARY }]}
                  placeholder="e.g. SUMMER20"
                  placeholderTextColor={TEXT_MUTED}
                  value={promoInput}
                  onChangeText={v => { setPromoInput(v.toUpperCase()); setPromoError(""); }}
                  autoCapitalize="characters"
                  returnKeyType="done"
                />
                <Pressable
                  style={({ pressed }) => [s.promoApplyBtn, { backgroundColor: LIME_GREEN, opacity: promoLoading || !promoInput.trim() ? 0.5 : pressed ? 0.85 : 1 }]}
                  onPress={async () => {
                    if (!promoInput.trim()) return;
                    setPromoLoading(true);
                    setPromoError("");
                    try {
                      const r = await fetch(`${apiBase}/api/public/business/${effectiveSlug}/promo/${encodeURIComponent(promoInput.trim())}`);
                      if (!r.ok) {
                        const e = await r.json().catch(() => ({}));
                        setPromoError((e as any).error ?? "Invalid promo code");
                      } else {
                        const data = await r.json();
                        setPromoApplied(data);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }
                    } catch {
                      setPromoError("Could not validate promo code");
                    } finally {
                      setPromoLoading(false);
                    }
                  }}
                  disabled={promoLoading || !promoInput.trim()}
                >
                  {promoLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Apply</Text>}
                </Pressable>
              </View>
            )}
            {promoError ? <Text style={{ color: "#F87171", fontSize: 13, marginTop: 4 }}>{promoError}</Text> : null}
            {/* Gift Certificate entry */}
            <Text style={[s.notesLabel, { color: TEXT_PRIMARY, marginTop: 16 }]}>Gift Certificate Code</Text>
            {giftApplied ? (
              <GiftAppliedCard
                giftApplied={giftApplied}
                selectedService={selectedService}
                discounts={discounts}
                promoApplied={promoApplied}
                onRemove={() => { setGiftApplied(null); setGiftInput(""); setGiftError(""); }}
              />
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={[s.notesInput, { flex: 1, minHeight: 0, paddingVertical: 12, backgroundColor: CARD_BG, borderColor: giftError ? "#F87171" : CARD_BORDER, color: TEXT_PRIMARY }]}
                  placeholder="e.g. GIFT-ABCD1234"
                  placeholderTextColor={TEXT_MUTED}
                  value={giftInput}
                  onChangeText={v => { setGiftInput(v.toUpperCase()); setGiftError(""); }}
                  autoCapitalize="characters"
                  returnKeyType="done"
                />
                <Pressable
                  style={({ pressed }) => [s.promoApplyBtn, { backgroundColor: LIME_GREEN, opacity: giftLoading || !giftInput.trim() ? 0.5 : pressed ? 0.85 : 1 }]}
                  onPress={async () => {
                    if (!giftInput.trim()) return;
                    setGiftLoading(true);
                    setGiftError("");
                    try {
                      const r = await fetch(`${apiBase}/api/public/business/${effectiveSlug}/gift-validate/${encodeURIComponent(giftInput.trim())}`);
                      if (!r.ok) {
                        const e = await r.json().catch(() => ({}));
                        setGiftError((e as any).error ?? "Invalid gift certificate");
                      } else {
                        const data = await r.json();
                        const giftType = data.giftType ?? "service";
                        const label = giftType === "balance"
                          ? `Balance Credit — $${parseFloat(data.value).toFixed(2)} available`
                          : `Gift Certificate — $${parseFloat(data.value).toFixed(2)} value`;
                        setGiftApplied({ code: data.code, value: parseFloat(data.value), totalValue: parseFloat(data.totalValue ?? data.value), label, giftType });
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        // If this is a package gift, auto-select the package
                        if (data.packageLocalId && packages.length > 0) {
                          const pkg = packages.find((p) => p.localId === data.packageLocalId);
                          if (pkg) {
                            setSelectedPackage(pkg);
                            setServiceTab("packages");
                            setSessionDates(Array.from({ length: pkg.totalSessions }, () => ({ date: null, slot: null })));
                            setActiveSessionIdx(0);
                            const syntheticService = {
                              localId: pkg.localId, name: pkg.name,
                              duration: pkg.sessionDurationMinutes, price: String(pkg.packagePrice),
                              description: pkg.description, category: pkg.category, photoUri: pkg.photoUri,
                            };
                            setSelectedService(syntheticService as any);
                            setSelectedServices([syntheticService as any]);
                          }
                        }
                      }
                    } catch {
                      setGiftError("Could not validate gift certificate");
                    } finally {
                      setGiftLoading(false);
                    }
                  }}
                  disabled={giftLoading || !giftInput.trim()}
                >
                  {giftLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Apply</Text>}
                </Pressable>
              </View>
            )}
            {giftError ? <Text style={{ color: "#F87171", fontSize: 13, marginTop: 4 }}>{giftError}</Text> : null}
          </View>
        )}

        {/* Confirm step */}
        {step === STEP_CONFIRM && selectedService && selectedDate && selectedSlot && (() => {
          const svcPrice = selectedService.price ? parseFloat(selectedService.price) : 0;
          const activeDiscount = discounts.find(d => !d.serviceIds || (d.serviceIds as string[]).length === 0 || (d.serviceIds as string[]).includes(selectedService.localId));
          const discSaving = activeDiscount ? parseFloat((svcPrice * activeDiscount.percentage / 100).toFixed(2)) : 0;
          const afterDiscount = svcPrice - discSaving;
          const promoSaving = promoApplied
            ? promoApplied.flatAmount
              ? Math.min(promoApplied.flatAmount, afterDiscount)
              : parseFloat((afterDiscount * (promoApplied.percentage ?? 0) / 100).toFixed(2))
            : 0;
          const afterPromo = Math.max(0, afterDiscount - promoSaving);
          const giftSaving = giftApplied ? Math.min(giftApplied.value, afterPromo) : 0;
          // Travel fee for mobile services
          const confirmTravelFee = (isMobileService && selectedService.travelFee && selectedService.travelFee > 0) ? selectedService.travelFee : 0;
          const finalPrice = Math.max(0, afterPromo - giftSaving) + confirmTravelFee;
          const effectiveAddress = fullClientAddress || clientAddress;
          return (
            <View style={s.stepContent}>
              <Text style={[s.stepTitle, { color: TEXT_PRIMARY }]}>Confirm Booking</Text>
              {/* 📦 Package summary banner — shown when booking via a package */}
              {selectedPackage && (
                <View style={{
                  backgroundColor: `${LIME_GREEN}18`,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: `${LIME_GREEN}55`,
                  padding: 14,
                  marginBottom: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}>
                  <Text style={{ fontSize: 28, lineHeight: 32 }}>📦</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: LIME_GREEN, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>Package Booking</Text>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 15, fontWeight: "700", marginBottom: 3 }}>{selectedPackage.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>🔁</Text>
                        <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: "600" }}>{selectedPackage.totalSessions} session{selectedPackage.totalSessions !== 1 ? "s" : ""}</Text>
                      </View>
                      <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: TEXT_MUTED }} />
                      {selectedPackage.originalPrice > selectedPackage.packagePrice && (
                        <Text style={{ color: TEXT_MUTED, fontSize: 12, textDecorationLine: "line-through" }}>${parseFloat(String(selectedPackage.originalPrice)).toFixed(2)}</Text>
                      )}
                      <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "700" }}>${parseFloat(String(selectedPackage.packagePrice)).toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              )}
              {/* 🚗 Comes to You banner — shown for mobile services */}
              {isMobileService && effectiveAddress.trim() ? (
                <View style={{ backgroundColor: "rgba(74,124,89,0.18)", borderRadius: 12, borderWidth: 1, borderColor: `${LIME_GREEN}50`, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
                  <Text style={{ fontSize: 20, lineHeight: 24 }}>🚗</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "700", marginBottom: 2 }}>We Come to You</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 13, lineHeight: 18 }}>{effectiveAddress}</Text>
                  </View>
                </View>
              ) : isMobileService ? (
                <View style={{ backgroundColor: "rgba(74,124,89,0.18)", borderRadius: 12, borderWidth: 1, borderColor: `${LIME_GREEN}50`, padding: 12, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 18 }}>🚗</Text>
                  <Text style={{ color: LIME_GREEN, fontSize: 13, fontWeight: "600" }}>Comes to You — Mobile Service</Text>
                </View>
              ) : null}
              <View style={[s.confirmCard, { backgroundColor: CARD_BG, borderColor: CARD_BORDER }]}>
                <Row label="Service" value={selectedService.name} />
                <Row label="Duration" value={`${selectedService.duration} min`} colors={colors} />
                {discSaving > 0 ? (
                  <>
                    <Row label="Original Price" value={`$${svcPrice.toFixed(2)}`} colors={colors} />
                    <Row label={`Discount (${activeDiscount!.percentage}%)`} value={`-$${discSaving.toFixed(2)}`} colors={colors} />
                  </>
                ) : (
                  <Row label="Price" value={formatPrice(selectedService.price)} />
                )}
                {promoSaving > 0 && (
                  <Row label={`Promo (${promoApplied!.code})`} value={`-$${promoSaving.toFixed(2)}`} colors={colors} />
                )}
                {giftSaving > 0 && (
                  <Row label={`Gift (${giftApplied!.code})`} value={`-$${giftSaving.toFixed(2)}`} colors={colors} />
                )}
                {confirmTravelFee > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: DIVIDER }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>🚗 Travel Fee</Text>
                    </View>
                    <Text style={{ color: LIME_GREEN, fontSize: 14, fontWeight: "600" }}>+${confirmTravelFee.toFixed(2)}</Text>
                  </View>
                )}
                {(discSaving > 0 || promoSaving > 0 || giftSaving > 0 || confirmTravelFee > 0) && (
                  <Row label="Total" value={`$${finalPrice.toFixed(2)}`} colors={colors} />
                )}
                <Row label="Date" value={formatDateLabel(selectedDate)} />
                <Row label="Time" value={selectedSlot.time} />
                {selectedLocation && (
                  <Row label="Location" value={selectedLocation.name} />
                )}
                {selectedStaffId !== "any" && (
                  <Row
                    label="Staff"
                    value={staff.find((m) => m.localId === selectedStaffId)?.name ?? selectedStaffId}
                    colors={colors}
                  />
                )}
                {/* 🎁 Fully covered by gift banner */}
                {giftSaving > 0 && finalPrice <= 0 && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: DIVIDER }}>
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(74,222,128,0.12)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(74,222,128,0.35)", paddingHorizontal: 10, paddingVertical: 7 }}>
                      <Text style={{ fontSize: 16 }}>🎁</Text>
                      <Text style={{ color: "#4ADE80", fontSize: 13, fontWeight: "700", flex: 1 }}>Fully covered by gift — No payment needed</Text>
                    </View>
                  </View>
                )}
                {paymentMethod && wizardAmountDue > 0 && (
                  <Row
                    label="Payment"
                    value={PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label ?? paymentMethod}
                    colors={colors}
                  />
                )}
                {paymentMethod !== "cash" && paymentConfirmationNumber && (
                  <Row label="Confirmation #" value={paymentConfirmationNumber} />
                )}
              </View>
              <Text style={[s.notesLabel, { color: TEXT_PRIMARY }]}>Notes (optional)</Text>
              <TextInput
                style={[s.notesInput, { backgroundColor: CARD_BG, borderColor: CARD_BORDER, color: TEXT_PRIMARY }]}
                placeholder="Any special requests..."
                placeholderTextColor={TEXT_MUTED}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                returnKeyType="done"
              />
              {/* Save address to profile checkbox — only shown for mobile services */}
              {isMobileService && fullClientAddress.trim() ? (
                <Pressable
                  onPress={() => setSaveAddressToProfile(v => !v)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 14,
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: saveAddressToProfile ? `${LIME_GREEN}60` : CARD_BORDER,
                    backgroundColor: saveAddressToProfile ? `${LIME_GREEN}12` : CARD_BG,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                    borderColor: saveAddressToProfile ? LIME_GREEN : TEXT_MUTED,
                    backgroundColor: saveAddressToProfile ? LIME_GREEN : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {saveAddressToProfile && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700", lineHeight: 16 }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: "600" }}>Save address to my profile</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2 }}>Pre-fill this address for future bookings</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          );
        })()}
      </ScrollView>

      {/* Bottom Action — inside KeyboardAvoidingView so it rises above the keyboard */}
      <View style={[s.bottomAction, { backgroundColor: PORTAL_BG, borderTopColor: DIVIDER }]}>
        {step < STEPS.length - 1 ? (
          <Pressable
            style={({ pressed }) => [
              s.nextBtn,
              { opacity: canProceed(step, STEP_SERVICE, STEP_STAFF, STEP_LOCATION, STEP_DATE, STEP_TIME, STEP_PAYMENT, showLocationStep, selectedService, selectedStaffId, selectedLocation, selectedDate, selectedSlot, paymentMethod, paymentConfirmationNumber, selectedServices.length, STEP_ADDRESS, addrStreet, addrCity, addrState, addrZip) ? 1 : 0.4 },
              pressed && canProceed(step, STEP_SERVICE, STEP_STAFF, STEP_LOCATION, STEP_DATE, STEP_TIME, STEP_PAYMENT, showLocationStep, selectedService, selectedStaffId, selectedLocation, selectedDate, selectedSlot, paymentMethod, paymentConfirmationNumber, selectedServices.length, STEP_ADDRESS, addrStreet, addrCity, addrState, addrZip) && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={handleNext}
            disabled={!canProceed(step, STEP_SERVICE, STEP_STAFF, STEP_LOCATION, STEP_DATE, STEP_TIME, STEP_PAYMENT, showLocationStep, selectedService, selectedStaffId, selectedLocation, selectedDate, selectedSlot, paymentMethod, paymentConfirmationNumber, selectedServices.length, STEP_ADDRESS, addrStreet, addrCity, addrState, addrZip)}
          >
            <Text style={s.nextBtnText}>Continue</Text>
            <IconSymbol name="chevron.right" size={16} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [s.nextBtn, submitting && { opacity: 0.7 }, pressed && { transform: [{ scale: 0.97 }] }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <IconSymbol name="checkmark.circle.fill" size={18} color="#FFFFFF" />
                <Text style={s.nextBtnText}>Confirm Booking</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
      </KeyboardAvoidingView>

      {/* Full-screen photo preview modal */}
      <Modal
        visible={previewUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUri(null)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" }}>
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              style={{ width: "100%", height: "70%" }}
              contentFit="contain"
            />
          ) : null}
          <TouchableOpacity
            onPress={() => setPreviewUri(null)}
            style={{ position: "absolute", top: 52, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
          >
            <IconSymbol name="xmark" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function canProceed(
  step: number,
  STEP_SERVICE: number,
  STEP_STAFF: number,
  STEP_LOCATION: number,
  STEP_DATE: number,
  STEP_TIME: number,
  STEP_PAYMENT: number,
  showLocationStep: boolean,
  selectedService: any,
  selectedStaffId: any,
  selectedLocation: any,
  selectedDate: Date | null,
  selectedSlot: any,
  paymentMethod?: string | null,
  paymentConfirmationNumber?: string,
  selectedServicesCount?: number,
  STEP_ADDRESS?: number,
  addrStreet?: string,
  addrCity?: string,
  addrState?: string,
  addrZip?: string
): boolean {
  if (step === STEP_SERVICE) return selectedService != null || (selectedServicesCount ?? 0) > 0;
  if (step === STEP_STAFF) return selectedStaffId !== undefined;
  if (showLocationStep && step === STEP_LOCATION) return selectedLocation != null;
  // Date and Time are merged — require both a date AND a time slot to proceed
  if (step === STEP_DATE) return selectedDate != null && selectedSlot != null;
  // Address step — all four fields required
  if (STEP_ADDRESS !== undefined && STEP_ADDRESS >= 0 && step === STEP_ADDRESS) {
    return !!(addrStreet?.trim() && addrCity?.trim() && addrState?.trim() && addrZip?.trim());
  }
  if (step === STEP_PAYMENT) {
    if (!paymentMethod) return false;
    // Card payments don't need a confirmation number — Stripe handles it
    // Cash payments don't need one either — paid in person
    if (paymentMethod !== "cash" && paymentMethod !== "card" && !paymentConfirmationNumber?.trim()) return false;
    return true;
  }
  // Promo step is always skippable (optional)
  return true;
}

function GiftAppliedCard({
  giftApplied,
  selectedService,
  discounts,
  promoApplied,
  onRemove,
}: {
  giftApplied: { code: string; value: number; totalValue: number; label: string; giftType: string };
  selectedService: PublicService | null;
  discounts: { localId: string; name: string; percentage: number; serviceIds: string[] }[];
  promoApplied: { localId: string; code: string; label: string; percentage: number | null; flatAmount: number | null } | null;
  onRemove: () => void;
}) {
  const svcPrice = selectedService?.price ? parseFloat(selectedService.price) : 0;
  const activeDisc = discounts.find(d => !d.serviceIds || (d.serviceIds as string[]).length === 0 || (d.serviceIds as string[]).includes(selectedService?.localId ?? ""));
  const discSaving = activeDisc ? parseFloat((svcPrice * activeDisc.percentage / 100).toFixed(2)) : 0;
  const afterDiscount = svcPrice - discSaving;
  const promoSaving = promoApplied
    ? promoApplied.flatAmount
      ? Math.min(promoApplied.flatAmount, afterDiscount)
      : parseFloat((afterDiscount * (promoApplied.percentage ?? 0) / 100).toFixed(2))
    : 0;
  const afterPromo = Math.max(0, afterDiscount - promoSaving);
  const giftUsed = Math.min(giftApplied.value, afterPromo);
  const remainingAfterBooking = Math.max(0, giftApplied.value - giftUsed);
  const isBalance = giftApplied.giftType === "balance";
  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 }, { backgroundColor: `${LIME_GREEN}15`, borderColor: `${LIME_GREEN}50` }]}>
      <Text style={{ fontSize: 20 }}>🎁</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: TEXT_PRIMARY, fontWeight: "700", fontSize: 15 }}>{giftApplied.code}</Text>
        <Text style={{ color: LIME_GREEN, fontSize: 13 }}>{giftApplied.label}</Text>
        {isBalance && (
          <Text style={{ color: giftUsed >= giftApplied.value ? "#F87171" : "#FBBF24", fontSize: 12, marginTop: 2 }}>
            {giftUsed >= giftApplied.value
              ? `Covers full booking — $0.00 remaining`
              : `Using $${giftUsed.toFixed(2)} — $${remainingAfterBooking.toFixed(2)} balance remaining`}
          </Text>
        )}
      </View>
      <Pressable onPress={onRemove} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
        <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: "600" }}>Remove</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string; colors?: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: DIVIDER }}>
      <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right", marginLeft: 12 }}>{value}</Text>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 17, fontWeight: "600", color: TEXT_PRIMARY },
    stepIndicator: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingTop: 8 },
    stepItem: { flexDirection: "row", alignItems: "center" },
    stepDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    stepLine: { width: 20, height: 2, marginHorizontal: 1 },
    stepLabel: { textAlign: "center", fontSize: 13, fontWeight: "600", marginTop: 6, marginBottom: 4 },
    stepContent: { paddingTop: 16, gap: 12 },
    stepTitle: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
    stepSubtitle: { fontSize: 14, marginBottom: 4 },
    optionCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
    optionLeft: { flex: 1, gap: 3 },
    optionName: { fontSize: 15, fontWeight: "600" },
    optionDesc: { fontSize: 12, lineHeight: 17 },
    optionMeta: { fontSize: 12 },
    checkCircle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    staffAvatar: { width: 44, height: 44, borderRadius: 22, overflow: "hidden" },
    locationBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignSelf: "flex-start", marginBottom: 4 },
    monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    monthBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    monthLabel: { fontSize: 16, fontWeight: "700" },
    dayHeaders: { flexDirection: "row", marginBottom: 4 },
    dayHeader: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600" },
    calGrid: { flexDirection: "row", flexWrap: "wrap" },
    calCell: { width: "14.28%" as any, aspectRatio: 1.1, alignItems: "center", justifyContent: "center" },
    selectedDateLabel: { textAlign: "center", fontSize: 14, fontWeight: "600", marginTop: 12 },
    timeSectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 10 },
    timeSectionTitle: { fontSize: 15, fontWeight: "700" as const },
    noSlots: { alignItems: "center", paddingTop: 40, gap: 12 },
    noSlotsText: { fontSize: 14 },
    slotsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    slotBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", minWidth: 90 },
    confirmCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingTop: 4, marginBottom: 16 },
    discountBanner: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
    discountName: { fontSize: 14, fontWeight: "600" },
    discountPct: { fontSize: 12, marginTop: 2 },
    discountBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
    promoAppliedCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
    promoApplyBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", minWidth: 72 },
    notesLabel: { fontSize: 15, fontWeight: "600", marginBottom: 6 },
    notesInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, minHeight: 80 },
    paymentCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 12 },
    paymentMethodLabel: { fontSize: 15, fontWeight: "600" },
    paymentMethodHint: { fontSize: 12, marginTop: 2 },
    cashInfoCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10, marginTop: 12 },
    bottomAction: { padding: 16, borderTopWidth: 1 },
    nextBtn: { backgroundColor: LIME_GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
    nextBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  });
