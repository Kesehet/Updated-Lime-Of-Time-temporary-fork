import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  ScrollView,
  Linking,
  Platform,
  Alert,
  Image,
  Modal,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import {
  useStore,
  generateId,
  formatDateStr,
  formatTime,
  formatDateDisplay,
} from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  Appointment,
  Client,
  DAYS_OF_WEEK,
  generateCalendarSlots,
  minutesToTime,
  timeToMinutes,
  getApplicableDiscount,
  generateConfirmationMessage,
  getServiceDisplayName,
  stripPhoneFormat,
  formatPhoneNumber,
  timeSlotsOverlap,
  formatFullAddress,
  getMapUrl,
} from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { apiCall } from "@/lib/_core/api";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { FuturisticBackground } from "@/components/futuristic-background";

// Steps:
// 0 = Date & Time picker (only when launched from Home page without a pre-selected time)
// 1 = Service Category / Service selection
// 1b (8) = Multi-session package scheduler (only when a package is selected)
// 2 = Client selection
// 3 = Location selection (only if multiple locations)
// 4 = Staff selection (filtered by location)
// 5 = Review & Add More
// 6 = Payment Method
// 7 = Confirm
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const BOOKING_INTERVALS = [
  { label: "Auto", value: 0 },
  { label: "5m", value: 5 },
  { label: "10m", value: 10 },
  { label: "15m", value: 15 },
  { label: "20m", value: 20 },
  { label: "25m", value: 25 },
  { label: "30m", value: 30 },
  { label: "1hr", value: 60 },
];

type CartItem = {
  type: "service" | "product" | "package";
  id: string;
  /** For packages: the package id; for services: the service id */
  packageId?: string;
  /** For packages: the list of included service ids */
  packageServiceIds?: string[];
  name: string;
  price: number;
  duration: number;
};

export default function CalendarBookingScreen() {
  const {
    state,
    dispatch,
    getServiceById,
    getClientById,
    getLocationById,
    syncToDb,
  } = useStore();
  const { activeLocations } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { hp } = useResponsive();
  const { width: screenWidth } = useWindowDimensions();
  // Fixed pill width: (screen - 2*horizontal_padding - 2*gaps) / 3 columns
  const slotPillWidth = Math.floor((screenWidth - hp * 2 - 16) / 3);
  const params = useLocalSearchParams<{
    date?: string;
    time?: string;
    locationId?: string;
    preselectedLocationId?: string; // passed from Home page location filter
    eligibleLocationIds?: string; // comma-separated list of location IDs available at the selected time
    packageId?: string; // pre-select a package (from Package Browser)
    clientId?: string; // pre-select a client (from Client Profile)
  }>();

  const sendSmsMutation = trpc.twilio.sendSms.useMutation();
  const { planInfo } = usePlanLimitCheck();
  const isStripePlan = planInfo && (planInfo.planKey === "studio" || planInfo.planKey === "enterprise");
  const [requestingCardPayment, setRequestingCardPayment] = useState(false);

  // Pre-selected from calendar (or from Step 0 date/time picker)
  // These are computed after step0 state is set, so we use a ref-like approach
  // The actual effective date/time is derived below after step0 state declarations
  // If a specific location was clicked from calendar or passed from Home page filter, pre-select it
  const preselectedLocationId = params.locationId ?? (params.preselectedLocationId || null);
  // Eligible location IDs for the selected time slot (passed from All-mode calendar)
  const eligibleLocationIds = params.eligibleLocationIds
    ? params.eligibleLocationIds.split(',')
    : null;

  // Step 0 date/time picker state
  const [step0Date, setStep0Date] = useState<string>(() => params.date ?? formatDateStr(new Date()));
  const [step0Time, setStep0Time] = useState<string | null>(null);
  const [step0CalMonthOffset, setStep0CalMonthOffset] = useState(0);
  const [step0SlotInterval, setStep0SlotInterval] = useState<number | null>(null);
  const [step0ClosedDayMsg, setStep0ClosedDayMsg] = useState<string | null>(null);
  // Pre-populate selectedServices when a packageId param is passed (from Package Browser)
  useEffect(() => {
    const pkgId = params.packageId;
    if (!pkgId) return;
    const pkg = (state.packages ?? []).find((p) => p.id === pkgId);
    if (!pkg) return;
    const includedSvcs = pkg.serviceIds
      .map((id: string) => state.services.find((s: any) => s.id === id))
      .filter(Boolean) as typeof state.services;
    const totalDuration = includedSvcs.reduce((s: number, sv: any) => s + sv.duration, 0);
    setSelectedServices([{
      type: "package",
      id: pkg.id,
      packageId: pkg.id,
      packageServiceIds: pkg.serviceIds,
      name: pkg.name,
      price: pkg.price,
      duration: totalDuration,
    }]);
    // Skip Step 1 (service selection) — go straight to Step 0 or Step 8
    // Step will already be 0 (date picker) or 1 (service) — keep as-is, package is pre-selected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.packageId]);

  const step0ClosedDayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStep0ClosedDayMsg = useCallback((msg: string) => {
    if (step0ClosedDayTimer.current) clearTimeout(step0ClosedDayTimer.current);
    setStep0ClosedDayMsg(msg);
    step0ClosedDayTimer.current = setTimeout(() => setStep0ClosedDayMsg(null), 3000);
  }, []);

  // Whether to show Step 0 (date/time picker) — show when launched without a pre-selected time
  // Package bookings skip Step 0 entirely (sessions are picked in Step 8)
  const showDateTimePicker = !params.time && !params.packageId;

  const [step, setStep] = useState<Step>(() => {
    // When a package is pre-selected (from Package Browser), jump straight to
    // Step 8 (multi-session scheduler), skipping date/time picker and service selection.
    if (params.packageId) return 8;
    return showDateTimePicker ? 0 : 1;
  });

  // Effective date/time: from Step 0 picker (when no time param) or from params (calendar tap)
  const preselectedDate = showDateTimePicker ? step0Date : (params.date ?? formatDateStr(new Date()));
  const preselectedTime = showDateTimePicker ? step0Time : (params.time ?? null);
  // Multi-service selection: array of services chosen in Step 1
  // Pre-populate from packageId param (from Package Browser) — synchronous init so it's ready before first render
  const [selectedServices, setSelectedServices] = useState<CartItem[]>(() => {
    const pkgId = params.packageId;
    if (!pkgId) return [];
    const pkg = (state.packages ?? []).find((p: any) => p.id === pkgId);
    if (!pkg) return [];
    const includedSvcs = (pkg.serviceIds ?? []).map((id: string) => state.services.find((s: any) => s.id === id)).filter(Boolean) as any[];
    const totalDuration = includedSvcs.reduce((s: number, sv: any) => s + sv.duration, 0);
    return [{
      type: "package" as const,
      id: pkg.id,
      packageId: pkg.id,
      packageServiceIds: pkg.serviceIds,
      name: pkg.name,
      price: pkg.price,
      duration: totalDuration,
    }];
  });
  // Derived: primary service ID is the first selected service
  const selectedServiceId = selectedServices.length > 0 ? selectedServices[0].id : null;
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => params.clientId ?? null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [step1CategoryFilter, setStep1CategoryFilter] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [addMoreTab, setAddMoreTab] = useState<"services" | "products">("services");
  const [addMoreCategoryFilter, setAddMoreCategoryFilter] = useState<string | null>(null);
  const [addMoreBrandFilter, setAddMoreBrandFilter] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  // Promo code state
  const [showPromoField, setShowPromoField] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<import("@/lib/types").PromoCode | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  // Separate promo / discount sheets
  const [showPromoSheet, setShowPromoSheet] = useState(false);
  const [showDiscountPickerSheet, setShowDiscountPickerSheet] = useState(false);
  const [appliedManualDiscount, setAppliedManualDiscount] = useState<import("@/lib/types").Discount | null>(null);
  // Legacy combined sheet (kept for backward compat, now unused)
  const [showDiscountSheet, setShowDiscountSheet] = useState(false);

  // Package multi-session scheduler state (Step 8)
  // packageSessions: array of { date, time } for each session the user schedules
  const [packageSessions, setPackageSessions] = useState<{ date: string; time: string }[]>([]);
  // Which session index is currently being scheduled (0-based)
  const [pkgSessionIdx, setPkgSessionIdx] = useState(0);
  // Calendar month offset for the package session scheduler
  const [pkgCalMonthOffset, setPkgCalMonthOffset] = useState(0);
  // Selected date in the package session scheduler
  const [pkgSessionDate, setPkgSessionDate] = useState<string>(() => formatDateStr(new Date()));
  // Selected time in the package session scheduler
  const [pkgSessionTime, setPkgSessionTime] = useState<string | null>(null);

  // Whether the location was pre-passed from the Home page filter (show banner in Step 4)
  const homePagePreselectedLocationId = params.preselectedLocationId || null;

  // Location selection — pre-select if only one active location or if passed from calendar
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    if (preselectedLocationId) return preselectedLocationId;
    // Auto-select when only one eligible location from All-mode calendar
    if (params.eligibleLocationIds) {
      const ids = params.eligibleLocationIds.split(',');
      if (ids.length === 1) return ids[0];
    }
    if (activeLocations.length === 1) return activeLocations[0].id;
    // If user is in single-location mode
    const activeLoc = state.locations.find(
      (l) => l.id === state.activeLocationId && l.active
    );
    if (activeLoc) return activeLoc.id;
    return null;
  });

  const selectedService = selectedServiceId ? getServiceById(selectedServiceId) : null;
  const selectedClient = selectedClientId ? getClientById(selectedClientId) : null;
  const selectedLocation = useMemo(
    () => state.locations.find((l) => l.id === selectedLocationId) ?? null,
    [state.locations, selectedLocationId]
  );

  const totalDuration = useMemo(
    () => selectedServices.reduce((s, i) => s + i.duration, 0) + cart.reduce((s, i) => s + i.duration, 0),
    [selectedServices, cart]
  );

  const servicePrice = useMemo(() => {
    if (!selectedService) return 0;
    return parseFloat(String(selectedService.price));
  }, [selectedService]);

  const subtotal = useMemo(
    () => selectedServices.reduce((s, i) => s + i.price, 0) + cart.reduce((s, i) => s + i.price, 0),
    [selectedServices, cart]
  );

  const effectiveStep = useMemo(() => {
    const configured = (state.settings as any).slotInterval ?? 0;
    return configured > 0 ? configured : Math.min(totalDuration, 30);
  }, [(state.settings as any).slotInterval, totalDuration]);

  const locationWorkingHours = useMemo(() => {
    if (
      selectedLocation?.workingHours &&
      Object.keys(selectedLocation.workingHours).length > 0
    ) {
      return selectedLocation.workingHours as Record<
        string,
        import("@/lib/types").WorkingHours
      >;
    }
    if (!selectedLocationId && activeLocations.length === 1) {
      const onlyLoc = activeLocations[0];
      if (onlyLoc.workingHours && Object.keys(onlyLoc.workingHours).length > 0) {
        return onlyLoc.workingHours as Record<
          string,
          import("@/lib/types").WorkingHours
        >;
      }
    }
    return state.settings.workingHours;
  }, [selectedLocation, selectedLocationId, activeLocations, state.settings.workingHours]);

  const locationAppts = useMemo(() => {
    if (!selectedLocationId) return state.appointments;
    return state.appointments.filter((a) => a.locationId === selectedLocationId);
  }, [state.appointments, selectedLocationId]);

  const activeCustomSchedule = useMemo(() => {
    const mergeWithGlobal = (locId: string) => {
      const locEntries = (state as any).locationCustomSchedule?.[locId] ?? [];
      const locDates = new Set(locEntries.map((cs: any) => cs.date));
      const globalFallback = (state.customSchedule ?? []).filter(
        (cs) => !locDates.has(cs.date)
      );
      return [...locEntries, ...globalFallback];
    };
    if (selectedLocationId) return mergeWithGlobal(selectedLocationId);
    if (activeLocations.length === 1) return mergeWithGlobal(activeLocations[0].id);
    return state.customSchedule ?? [];
  }, [
    selectedLocationId,
    activeLocations,
    (state as any).locationCustomSchedule,
    state.customSchedule,
  ]);

  // Resolve the closing time (in minutes) for the pre-selected date.
  // Used to disable services that would push the appointment past closing time.
  const closingTimeMin = useMemo(() => {
    if (!preselectedDate || !preselectedTime) return null;
    // Check custom schedule override first
    const customDay = activeCustomSchedule.find((cs: any) => cs.date === preselectedDate);
    if (customDay) {
      if (!customDay.isOpen) return null;
      if (customDay.endTime) return timeToMinutes(customDay.endTime);
    }
    // Fall back to weekly working hours
    const d = new Date(preselectedDate + "T12:00:00");
    const dayName = DAYS_OF_WEEK[d.getDay()];
    if (!dayName) return null;
    const wh = (locationWorkingHours as any)?.[dayName] ?? (locationWorkingHours as any)?.[dayName.toLowerCase()];
    if (!wh || !wh.enabled) return null;
    return timeToMinutes(wh.end);
  }, [preselectedDate, preselectedTime, activeCustomSchedule, locationWorkingHours]);

  // Check if a service with a given duration would be disabled at the pre-selected time.
  // A service is disabled if:
  //   1. selected_time + service_duration > closing_time, OR
  //   2. selected_time + service_duration overlaps an existing non-cancelled appointment
  const isServiceDisabledAtTime = useCallback((serviceDuration: number): { disabled: boolean; reason: string | null } => {
    if (!preselectedTime) return { disabled: false, reason: null };
    // When no location is selected yet (All-locations mode, Step 0 already validated the slot),
    // skip the overlap check — checking all appointments would falsely block slots that are
    // only booked at one location but free at others.
    if (!selectedLocationId) return { disabled: false, reason: null };
    const startMin = timeToMinutes(preselectedTime);
    const endMin = startMin + serviceDuration;
    // Check closing time
    if (closingTimeMin !== null && endMin > closingTimeMin) {
      const h = Math.floor(closingTimeMin / 60);
      const m = closingTimeMin % 60;
      const ap = h >= 12 ? "PM" : "AM";
      const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return { disabled: true, reason: `Exceeds closing time (${hr}:${String(m).padStart(2, "0")} ${ap})` };
    }
    // Check overlap with existing appointments
    const dayAppts = locationAppts.filter(
      (a) => a.date === preselectedDate && a.status !== "cancelled"
    );
    const overlaps = dayAppts.some((a) => {
      const apptStart = timeToMinutes(a.time);
      const apptEnd = apptStart + a.duration;
      return startMin < apptEnd && endMin > apptStart;
    });
    if (overlaps) return { disabled: true, reason: "Overlaps an existing appointment" };
    return { disabled: false, reason: null };
  }, [preselectedTime, closingTimeMin, locationAppts, preselectedDate]);

  // Available staff filtered by selected location and service
  const availableStaff = useMemo(() => {
    return state.staff.filter((s) => {
      if (!s.active) return false;
      // Only show staff assigned to the selected location (or unassigned staff when no location chosen)
      if (selectedLocationId && s.locationIds && s.locationIds.length > 0) {
        if (!s.locationIds.includes(selectedLocationId)) return false;
      }
      return true;
    });
  }, [state.staff, selectedLocationId]);

  // Staff availability map for the pre-selected date/time
  const staffAvailabilityMap = useMemo((): Record<string, boolean> => {
    if (!preselectedDate || !preselectedTime) return {};
    const result: Record<string, boolean> = {};
    for (const member of availableStaff) {
      const staffAppts = state.appointments.filter(
        (a) =>
          a.staffId === member.id &&
          a.date === preselectedDate &&
          (a.status === "confirmed" || a.status === "pending")
      );
      const hasConflict = staffAppts.some((a) =>
        timeSlotsOverlap(preselectedTime, totalDuration, a.time, a.duration)
      );
      result[member.id] = !hasConflict;
    }
    return result;
  }, [availableStaff, state.appointments, preselectedDate, preselectedTime, totalDuration]);

  const appliedDiscount = useMemo(() => {
    // For package bookings, use the first session's date/time for discount eligibility
    const effectiveDate = preselectedDate || (packageSessions.length > 0 ? packageSessions[0].date : null);
    const effectiveTime = preselectedTime || (packageSessions.length > 0 ? packageSessions[0].time : null);
    if (!selectedServiceId || !effectiveDate || !effectiveTime) return null;
    return getApplicableDiscount(
      state.discounts,
      effectiveDate,
      effectiveTime,
      selectedServiceId,
      state.appointments
    );
  }, [state.discounts, preselectedDate, preselectedTime, selectedServiceId, state.appointments, packageSessions]);

  const discountAmount = useMemo(() => {
    if (!appliedDiscount) return 0;
    return subtotal * (appliedDiscount.percentage / 100);
  }, [appliedDiscount, subtotal]);

  // Promo code discount amount
  const promoDiscountAmount = useMemo(() => {
    if (!appliedPromoCode) return 0;
    if (appliedPromoCode.percentage > 0) {
      return Math.min(subtotal * (appliedPromoCode.percentage / 100), subtotal);
    }
    return Math.min(appliedPromoCode.flatAmount ?? 0, subtotal);
  }, [appliedPromoCode, subtotal]);

  // Manual discount stacks on top of auto-discount (Happy Hour etc.)
  const manualDiscountAmount = appliedManualDiscount
    ? subtotal * (appliedManualDiscount.percentage / 100)
    : 0;
  const totalPrice = Math.max(0, subtotal - discountAmount - promoDiscountAmount - manualDiscountAmount);

  // Available extra services (exclude all services already in selectedServices)
  const selectedServiceIds = useMemo(() => new Set(selectedServices.map((s) => s.id)), [selectedServices]);
  const availableExtraServices = useMemo(
    () => state.services.filter((s) => !selectedServiceIds.has(s.id)),
    [state.services, selectedServiceIds]
  );

  const availableProducts = useMemo(() => state.products ?? [], [state.products]);

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => [...prev, item]);
  }, []);

  const removeFromCart = useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const filteredClients = useMemo(() => {
    const q = clientSearch.toLowerCase();
    return state.clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.phone.includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.clients, clientSearch]);

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const handleQuickAddClient = useCallback(() => {
    if (!quickName.trim()) return;
    const client: Client = {
      id: generateId(),
      name: quickName.trim(),
      phone: quickPhone.trim(),
      email: "",
      notes: "",
      birthday: "",
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_CLIENT", payload: client });
    syncToDb({ type: "ADD_CLIENT", payload: client });
    setSelectedClientId(client.id);
    setShowQuickAdd(false);
    setQuickName("");
    setQuickPhone("");
    advanceAfterClient();
  }, [quickName, quickPhone, dispatch, syncToDb]);

  // Determine next step after client selection
  const advanceAfterClient = useCallback(() => {
    if (activeLocations.length > 1 && !selectedLocationId) {
      setStep(3);
    } else {
      setStep(4);
    }
  }, [activeLocations.length, selectedLocationId]);

  const handleBook = useCallback(() => {
    // For package multi-session bookings, require at least client and sessions
    const isPackageBooking = packageSessions.length > 0;
    if (!isPackageBooking && (!selectedServiceId || !preselectedTime)) return;
    if (!selectedClientId) return;
    let effectiveLocationId = selectedLocationId;
    if (!effectiveLocationId && activeLocations.length === 1) {
      effectiveLocationId = activeLocations[0].id;
    }
    if (activeLocations.length > 1 && !effectiveLocationId) {
      Alert.alert(
        "Location Required",
        "Please select a location before confirming."
      );
      return;
    }

    // Build extraItems: selectedServices[1+] (additional primary services) + cart (add-ons from review page)
    const extraItems = [
      ...selectedServices.slice(1).map((item) => ({
        type: item.type,
        id: item.id,
        name: item.name,
        price: item.price,
        duration: item.duration,
      })),
      ...cart.map((item) => ({
        type: item.type,
        id: item.id,
        name: item.name,
        price: item.price,
        duration: item.duration,
      })),
    ];

    if (isPackageBooking) {
      // Multi-session package: create one appointment per session, all sharing a packageGroupId
      const pkgCartItem = selectedServices.find((s) => s.type === "package");
      const pkgId = pkgCartItem?.packageId;
      const pkgName = pkgCartItem?.name ?? "Package";
      const pkgDuration = pkgCartItem?.duration ?? totalDuration;
      const pkgPrice = pkgCartItem?.price ?? totalPrice;
      const packageGroupId = generateId(); // shared across all sessions
      const sessionCount = packageSessions.length;
      packageSessions.forEach((session, idx) => {
        const sessionAppointment: Appointment = {
          id: generateId(),
          serviceId: selectedServiceId ?? (state.services[0]?.id ?? "pkg"),
          clientId: selectedClientId,
          date: session.date,
          time: session.time,
          duration: pkgDuration,
          status: "confirmed",
          notes: notes.trim() ? `[Package: ${pkgName} — Session ${idx + 1}/${sessionCount}] ${notes.trim()}` : `Package: ${pkgName} — Session ${idx + 1}/${sessionCount}`,
          createdAt: new Date().toISOString(),
          totalPrice: idx === 0 ? Math.max(0, pkgPrice - discountAmount - promoDiscountAmount - manualDiscountAmount) : 0,
          staffId: selectedStaffId ?? undefined,
          locationId: effectiveLocationId ?? undefined,
          discountPercent: idx === 0 ? (appliedDiscount?.percentage ?? appliedManualDiscount?.percentage) : undefined,
          discountAmount: idx === 0 && (discountAmount + promoDiscountAmount + manualDiscountAmount) > 0
            ? (discountAmount + promoDiscountAmount + manualDiscountAmount)
            : undefined,
          discountName: idx === 0 ? (() => {
            const parts: string[] = [];
            if (appliedDiscount) parts.push(appliedDiscount.name);
            if (appliedManualDiscount) parts.push(appliedManualDiscount.name);
            if (appliedPromoCode) parts.push(appliedPromoCode.code);
            return parts.length > 0 ? parts.join(' + ') : undefined;
          })() : undefined,
          paymentStatus: idx === 0 ? (Math.max(0, pkgPrice - discountAmount - promoDiscountAmount - manualDiscountAmount) <= 0 ? "paid" : "unpaid") : "paid",
          paymentMethod: (selectedPaymentMethod ?? undefined) as "free" | "zelle" | "venmo" | "cashapp" | "cash" | "card" | "unpaid" | undefined,
          // Package metadata stored in extraItems
          extraItems: [{
            type: "package" as const,
            id: pkgId ?? "pkg",
            name: pkgName,
            price: pkgPrice,
            duration: pkgDuration,
            packageGroupId,
            sessionIndex: idx,
            sessionTotal: sessionCount,
          } as any],
        };
        dispatch({ type: "ADD_APPOINTMENT", payload: sessionAppointment });
        syncToDb({ type: "ADD_APPOINTMENT", payload: sessionAppointment });
      });
    } else {
    // Single appointment (non-package)
    const appointment: Appointment = {
      id: generateId(),
      serviceId: selectedServiceId!,
      clientId: selectedClientId,
      date: preselectedDate,
      time: preselectedTime!,
      duration: totalDuration,
      status: "confirmed",
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
      totalPrice,
      staffId: selectedStaffId ?? undefined,
      locationId: effectiveLocationId ?? undefined,
      discountPercent: appliedDiscount?.percentage ?? appliedManualDiscount?.percentage,
      discountAmount: (discountAmount + promoDiscountAmount + manualDiscountAmount) > 0 ? (discountAmount + promoDiscountAmount + manualDiscountAmount) : undefined,
      discountName: (() => {
        const parts: string[] = [];
        if (appliedDiscount) parts.push(appliedDiscount.name);
        if (appliedManualDiscount) parts.push(appliedManualDiscount.name);
        if (appliedPromoCode) parts.push(appliedPromoCode.code);
        return parts.length > 0 ? parts.join(' + ') : undefined;
      })(),
      paymentStatus: totalPrice <= 0 ? "paid" : "unpaid",
      paymentMethod: (selectedPaymentMethod ?? undefined) as "free" | "zelle" | "venmo" | "cashapp" | "cash" | "card" | "unpaid" | undefined,
      extraItems: extraItems.length > 0 ? extraItems : undefined,
    };
    dispatch({ type: "ADD_APPOINTMENT", payload: appointment });
    syncToDb({ type: "ADD_APPOINTMENT", payload: appointment });

    // Persist promo code usedCount increment to DB if a promo code was applied
    if (appliedPromoCode) {
      const newUsedCount = (appliedPromoCode.usedCount ?? 0) + 1;
      const maxUses = appliedPromoCode.maxUses;
      const limitReached = maxUses != null && maxUses > 0 && newUsedCount >= maxUses;
      const updatedPromo = {
        ...appliedPromoCode,
        usedCount: newUsedCount,
        // Auto-deactivate when limit is reached
        active: limitReached ? false : appliedPromoCode.active,
      };
      dispatch({ type: "UPDATE_PROMO_CODE", payload: updatedPromo });
      syncToDb({ type: "UPDATE_PROMO_CODE", payload: updatedPromo });
      // Notify the owner that the promo code has been used up
      if (limitReached) {
        // Use setTimeout so the alert fires after navigation completes
        setTimeout(() => {
          Alert.alert(
            "Promo Code Expired",
            `"${appliedPromoCode.code}" has reached its maximum of ${maxUses} use${maxUses !== 1 ? "s" : ""} and has been automatically deactivated.`,
            [{ text: "OK" }]
          );
        }, 800);
      }
    }

    // If card payment selected, send Stripe payment link after booking
    if (selectedPaymentMethod === "card" && state.businessOwnerId) {
      const clientForCard = getClientById(selectedClientId);
      if (clientForCard?.phone) {
        setRequestingCardPayment(true);
        apiCall<{ ok: boolean; url: string; sessionId: string }>("/api/stripe-connect/request-payment", {
          method: "POST",
          body: JSON.stringify({ businessOwnerId: state.businessOwnerId, appointmentLocalId: appointment.id }),
        }).then((result) => {
          const svcName = selectedService ? getServiceDisplayName(selectedService) : "your appointment";
          const apptDate = formatDateDisplay(preselectedDate);
          const smsBody = `Hi ${clientForCard.name}, please complete your payment of $${(appointment.totalPrice ?? 0).toFixed(2)} for ${svcName} on ${apptDate}.\n\nPay securely by card here:\n${result.url}\n\n— ${state.settings.businessName}`;
          const rawPhone = stripPhoneFormat(clientForCard.phone);
          const smsEnabled = state.settings.twilioEnabled && state.businessOwnerId;
          if (smsEnabled) {
            const toNumber = rawPhone.startsWith("+") ? rawPhone : `+1${rawPhone.replace(/\D/g, "")}`;
            sendSmsMutation.mutateAsync({ businessOwnerId: state.businessOwnerId!, toNumber, body: smsBody, smsAction: "confirmation" }).catch(() => {});
          } else if (Platform.OS !== "web") {
            const sep = Platform.OS === "ios" ? "&" : "?";
            Linking.openURL(`sms:${rawPhone}${sep}body=${encodeURIComponent(smsBody)}`).catch(() => {});
          }
        }).catch(() => {
          Alert.alert("Card Payment", "Appointment booked. Could not create card payment link — you can send it from the appointment detail.");
        }).finally(() => setRequestingCardPayment(false));
      }
    }

    // Send confirmation SMS
    const notifPrefs = state.settings.notificationPreferences ?? {};
    const masterNotifOn = state.settings.notificationsEnabled !== false;
    const smsClientConfirmOn =
      (notifPrefs as any).smsClientOnConfirmation !== false;
    const client = getClientById(selectedClientId);
    if (client?.phone && masterNotifOn && smsClientConfirmOn) {
      const svc = selectedService;
      const biz = state.settings;
      const profile = biz.profile;
      const apptLoc = effectiveLocationId ? getLocationById(effectiveLocationId) : null;
      const msg = generateConfirmationMessage(
        biz.businessName,
        apptLoc?.address || profile.address,
        client.name,
        svc ? getServiceDisplayName(svc) : "Service",
        totalDuration,
        preselectedDate,
        preselectedTime ?? "",
        apptLoc?.phone || profile.phone,
        client.phone,
        apptLoc?.name,
        apptLoc?.id,
        biz.customSlug,
        apptLoc?.city,
        apptLoc?.state,
        apptLoc?.zipCode
      );
      const rawPhone = stripPhoneFormat(client.phone);
      const smsEnabled = biz.twilioEnabled && biz.twilioBookingReminder;
      if (smsEnabled && state.businessOwnerId) {
        const toNumber = rawPhone.startsWith("+")
          ? rawPhone
          : `+1${rawPhone.replace(/\D/g, "")}`;
        sendSmsMutation
          .mutateAsync({
            businessOwnerId: state.businessOwnerId,
            toNumber,
            body: msg,
            smsAction: "confirmation",
          })
          .catch(() => {});
      } else if (Platform.OS === "web") {
        Alert.alert("SMS Message", msg);
      } else {
        const separator = Platform.OS === "ios" ? "&" : "?";
        const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(msg)}`;
        Linking.openURL(url).catch(() => Alert.alert("SMS", msg));
      }
    }

    // Navigate to the newly created appointment detail page
    router.replace({ pathname: "/appointment-detail", params: { id: appointment.id } });
    } // end else (single appointment)
    // For package bookings, navigate back to home after all sessions are created
    if (packageSessions.length > 0) {
      router.replace({ pathname: "/(tabs)" });
    }
  }, [
    selectedServiceId,
    selectedClientId,
    preselectedDate,
    preselectedTime,
    totalDuration,
    notes,
    totalPrice,
    subtotal,
    discountAmount,
    selectedStaffId,
    selectedLocationId,
    activeLocations,
    dispatch,
    syncToDb,
    appliedDiscount,
    cart,
    selectedPaymentMethod,
    state.settings,
    sendSmsMutation,
    router,
    getClientById,
    getLocationById,
    selectedService,
    requestingCardPayment,
    packageSessions,
  ]);

  // Determine step count based on whether location selection is needed
  // Skip location step if:
  // 1. Only one active location
  // 2. A specific location was pre-selected from the calendar
  // 3. Only one eligible location was passed from All-mode calendar (auto-select it)
  const singleEligibleLocationId = eligibleLocationIds?.length === 1 ? eligibleLocationIds[0] : null;
  const needsLocationStep = activeLocations.length > 1 && !preselectedLocationId && !singleEligibleLocationId;
  // Steps: [0=Date/Time if no preselected time], 1=Service, 2=Client, [3=Location if needed], 4=Staff, 5=Review+Add More, 6=Payment, 7=Confirm
  const TOTAL_STEPS = (showDateTimePicker ? 1 : 0) + (needsLocationStep ? 7 : 6);

  // Map logical steps to display step numbers (skip location step / date-time step if not needed)
  const displayStep = useMemo(() => {
    const dateOffset = showDateTimePicker ? 1 : 0;
    if (step === 0) return 1;
    if (!needsLocationStep) {
      // No location step: 1→1+offset, 2→2+offset, 4→3+offset, 5→4+offset, 6→5+offset, 7→6+offset
      if (step === 1) return 1 + dateOffset;
      if (step === 2) return 2 + dateOffset;
      if (step === 4) return 3 + dateOffset;
      if (step === 5) return 4 + dateOffset;
      if (step === 6) return 5 + dateOffset;
      if (step === 7) return 6 + dateOffset;
    } else {
      return step + dateOffset;
    }
    return step;
  }, [step, needsLocationStep, showDateTimePicker]);

  const formatTimeDisplay = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hr}:${String(m).padStart(2, "0")} ${ap}`;
  };

  const getEndTime = (time: string) => {
    return formatTime(minutesToTime(timeToMinutes(time) + totalDuration));
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={720}>
      <FuturisticBackground />

      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          paddingTop: 8,
          paddingHorizontal: hp,
        }}
      >
        <View className="flex-row items-center">
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
          >
            <IconSymbol name="xmark" size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-xl font-bold text-foreground ml-4">
            Book Appointment
          </Text>
        </View>
        <Text className="text-sm text-muted">
          Step {displayStep}/{TOTAL_STEPS}
        </Text>
      </View>

      {/* Progress Bar */}
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginBottom: 12,
          paddingHorizontal: hp,
        }}
      >
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <View
            key={s}
            className="flex-1 h-1 rounded-full"
            style={{
              backgroundColor: s <= displayStep ? colors.primary : colors.border,
            }}
          />
        ))}
      </View>

      {/* Date/time banner — only show when past Step 0 */}
      {step > 0 && (
        <View
          style={{
            marginHorizontal: hp,
            marginBottom: 12,
            backgroundColor: colors.primary + "15",
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderWidth: 1,
            borderColor: colors.primary + "40",
          }}
        >
          <IconSymbol name="calendar" size={16} color={colors.primary} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>
            {formatDateDisplay(preselectedDate)}
            {preselectedTime ? ` · ${formatTimeDisplay(preselectedTime)}` : ""}
          </Text>
        </View>
      )}

      {/* ─── Step 0: Date & Time Picker ─── */}
      {step === 0 && (() => {
        const todayStr = formatDateStr(new Date());
        const today = new Date();
        const displayDate = new Date(today.getFullYear(), today.getMonth() + step0CalMonthOffset, 1);
        const displayMonth = displayDate.getMonth();
        const displayYear = displayDate.getFullYear();
        const firstDayOfWeek = new Date(displayYear, displayMonth, 1).getDay();
        const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
        const calCells: (number | null)[] = [
          ...Array(firstDayOfWeek).fill(null),
          ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
        ];
        const maxDate = new Date(today);
        maxDate.setDate(today.getDate() + 89);
        const maxDateStr = formatDateStr(maxDate);
        const canGoPrev = step0CalMonthOffset > 0;
        const canGoNext = step0CalMonthOffset < 3;

        // Effective slot interval for Step 0 (no service selected yet, use 30min default or global setting)
        const globalInterval = (state.settings as any).slotInterval ?? 0;
        const step0EffectiveInterval = step0SlotInterval !== null
          ? (step0SlotInterval === 0 ? 30 : step0SlotInterval)
          : (globalInterval > 0 ? globalInterval : 30);
        // Default service duration — must match what the Calendar tab uses so slot counts are identical.
        // Calendar tab uses state.settings.defaultDuration ?? 30 as serviceDuration in generateCalendarSlots.
        const step0DefaultDuration = Math.max(1, state.settings.defaultDuration ?? 30);

        // Step 0 location-aware working hours and appointments
        // Use selectedLocationId (which is updated by the location chip selector) so that
        // slot availability and working hours react immediately when the user picks a location.
        const step0LocationId = selectedLocationId ?? preselectedLocationId;
        const step0IsAllMode = !step0LocationId && activeLocations.length > 1;
        const step0Location = step0LocationId ? state.locations.find((l) => l.id === step0LocationId) ?? null : null;
        const step0WorkingHours = (step0Location?.workingHours && Object.keys(step0Location.workingHours).length > 0)
          ? step0Location.workingHours as Record<string, import("@/lib/types").WorkingHours>
          : state.settings.workingHours;
        const step0Appts = step0LocationId
          ? state.appointments.filter((a) => a.locationId === step0LocationId)
          : state.appointments;
        const step0CustomSchedule = (() => {
          if (step0LocationId) {
            const locEntries = (state as any).locationCustomSchedule?.[step0LocationId] ?? [];
            const locDates = new Set(locEntries.map((cs: any) => cs.date));
            const globalFallback = (state.customSchedule ?? []).filter((cs) => !locDates.has(cs.date));
            return [...locEntries, ...globalFallback];
          }
          return state.customSchedule ?? [];
        })();

        // Helper: compute available slots for a given date, respecting All-locations union logic
        // IMPORTANT: always use generateCalendarSlots (same as Calendar tab) — NOT generateAvailableSlots.
        // The two functions use different algorithms (dynamic restart vs fixed grid), so mixing them
        // causes slot count mismatches between the Calendar tab and the booking page.
        const computeStep0Slots = (ds: string): string[] => {
          if (!step0IsAllMode) {
            return generateCalendarSlots(
              ds, step0DefaultDuration, step0WorkingHours, step0Appts, step0EffectiveInterval,
              step0CustomSchedule, state.settings.scheduleMode, (state.settings as any).bufferTime ?? 0
            );
          }
          // All-locations mode: union slots across all locations (same logic as Calendar tab)
          const d = new Date(ds + "T12:00:00");
          const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
          const timeSet = new Set<string>();
          for (const loc of activeLocations) {
            if (loc.temporarilyClosed) continue;
            const locWh: Record<string, any> = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
              ? (loc.workingHours as Record<string, any>)
              : ((state.settings.workingHours ?? {}) as Record<string, any>);
            const locCustomSchedule: any[] = (state as any).locationCustomSchedule?.[loc.id] ?? [];
            const locCustom = locCustomSchedule.find((cs: any) => cs.date === ds);
            let locHours: { start: string; end: string } | null = null;
            if (locCustom) {
              if (!locCustom.isOpen) continue;
              locHours = { start: locCustom.startTime ?? '09:00', end: locCustom.endTime ?? '17:00' };
            } else {
              const wh = locWh[dayName] ?? locWh[dayName.charAt(0).toUpperCase() + dayName.slice(1)];
              if (!wh || !wh.enabled) continue;
              locHours = { start: wh.start, end: wh.end };
            }
            const fullLocWh: Record<string, any> = { ...locWh };
            fullLocWh[dayName] = { enabled: true, start: locHours.start, end: locHours.end };
            const locAppts = state.appointments.filter((a) =>
              a.locationId === loc.id || (!a.locationId && activeLocations.length === 1)
            );
            const mergedCustomSchedule: any[] = [
              ...locCustomSchedule,
              ...(state.customSchedule ?? []).filter(
                (cs) => !locCustomSchedule.some((lcs: any) => lcs.date === cs.date)
              ),
            ];
            const locSlots = generateCalendarSlots(
              ds, step0DefaultDuration,
              fullLocWh,
              locAppts, step0EffectiveInterval,
              mergedCustomSchedule,
              state.settings.scheduleMode, (state.settings as any).bufferTime ?? 0
            );
            const locBooked = new Set(
              locAppts
                .filter((a) => a.date === ds && (a.status === 'confirmed' || a.status === 'pending'))
                .map((a) => a.time)
            );
            for (const t of locSlots) {
              if (!locBooked.has(t)) timeSet.add(t);
            }
          }
          return Array.from(timeSet).sort();
        };

        // Helper: check if a date is closed in All-locations mode
        const isStep0DateClosed = (ds: string): boolean => {
          const endDate = state.settings.businessHoursEndDate;
          if (endDate && ds > endDate) return true;
          if (!step0IsAllMode) {
            const customDay = step0CustomSchedule.find((cs: any) => cs.date === ds);
            if (state.settings.scheduleMode === "custom") return !customDay || !customDay.isOpen;
            if (customDay) return !customDay.isOpen;
            const d = new Date(ds + "T12:00:00");
            const dayName = DAYS_OF_WEEK[d.getDay()];
            const wh = (step0WorkingHours as any)[dayName];
            return !wh || !wh.enabled;
          }
          // All mode: open if any location has this day open
          const d = new Date(ds + "T12:00:00");
          const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
          for (const loc of activeLocations) {
            if (loc.temporarilyClosed) continue;
            const locCustomSchedule: any[] = (state as any).locationCustomSchedule?.[loc.id] ?? [];
            const locCustom = locCustomSchedule.find((cs: any) => cs.date === ds);
            if (locCustom) { if (locCustom.isOpen) return false; continue; }
            const locWh: Record<string, any> = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
              ? (loc.workingHours as Record<string, any>)
              : ((state.settings.workingHours ?? {}) as Record<string, any>);
            const wh = locWh[dayName] ?? locWh[dayName.charAt(0).toUpperCase() + dayName.slice(1)];
            if (wh && wh.enabled) return false;
          }
          return true;
        };

        // Date options for calendar (90 days)
        const step0DateOptions = (() => {
          const dates: { date: string; closed: boolean; noSlots: boolean; slotCount: number }[] = [];
          for (let i = 0; i < 90; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const ds = formatDateStr(d);
            const closed = isStep0DateClosed(ds);
            let slotCount = 0;
            if (!closed) {
              slotCount = computeStep0Slots(ds).length;
            }
            dates.push({ date: ds, closed, noSlots: slotCount === 0, slotCount });
          }
          return dates;
        })();

        // Time slots for selected date
        const step0TimeSlots = computeStep0Slots(step0Date);

        // Per-slot location count (All-locations mode only)
        // Uses generateCalendarSlots per location — identical logic to calendar.tsx slotCache
        // so the "X locs" label always matches what the Calendar tab shows.
        const step0SlotLocCount: Record<string, number> = {};
        if (step0IsAllMode) {
          const ds = step0Date;
          const d = new Date(ds + "T12:00:00");
          const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
          const allAppts = state.appointments;
          // Build a map: time → count of locations that have this slot available
          const timeToLocCount = new Map<string, number>();
          for (const loc of activeLocations) {
            if (loc.temporarilyClosed) continue;
            const locCustomSchedule: any[] = (state as any).locationCustomSchedule?.[loc.id] ?? [];
            const locCustom = locCustomSchedule.find((cs: any) => cs.date === ds);
            const locWh: Record<string, any> = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
              ? (loc.workingHours as Record<string, any>)
              : ((state.settings.workingHours ?? {}) as Record<string, any>);
            let locHours: { start: string; end: string } | null = null;
            if (locCustom) {
              if (!locCustom.isOpen) continue;
              locHours = { start: locCustom.startTime ?? '09:00', end: locCustom.endTime ?? '17:00' };
            } else {
              const wh = locWh[dayName] ?? locWh[dayName.charAt(0).toUpperCase() + dayName.slice(1)];
              if (!wh || !wh.enabled) continue;
              locHours = { start: wh.start, end: wh.end };
            }
            // Build full working-hours object so generateCalendarSlots can resolve day name
            const fullLocWh: Record<string, any> = { ...locWh };
            fullLocWh[dayName] = { enabled: true, start: locHours.start, end: locHours.end };
            // Filter appointments for this location (same as calendar.tsx)
            const locAppts = allAppts.filter((a) =>
              a.locationId === loc.id || (!a.locationId && activeLocations.length === 1)
            );
            const mergedCustomSchedule: any[] = [
              ...locCustomSchedule,
              ...(state.customSchedule ?? []).filter(
                (cs) => !locCustomSchedule.some((lcs: any) => lcs.date === cs.date)
              ),
            ];
            // Generate slots for this location using the same duration + interval as the Calendar tab
            const locSlots = generateCalendarSlots(
              ds, step0DefaultDuration,
              fullLocWh,
              locAppts, step0EffectiveInterval,
              mergedCustomSchedule,
              state.settings.scheduleMode, (state.settings as any).bufferTime ?? 0
            );
            const locBooked = new Set(
              locAppts
                .filter((a) => a.date === ds && (a.status === 'confirmed' || a.status === 'pending'))
                .map((a) => a.time)
            );
            const locAvailSlots = new Set(locSlots.filter((t) => !locBooked.has(t)));
            // Increment count for each time this location has available
            for (const t of locAvailSlots) {
              timeToLocCount.set(t, (timeToLocCount.get(t) ?? 0) + 1);
            }
          }
          for (const t of step0TimeSlots) {
            step0SlotLocCount[t] = timeToLocCount.get(t) ?? 0;
          }
        }
        const step0SlotGroups = [
          { label: "Morning", slots: step0TimeSlots.filter((t) => parseInt(t.split(":")[0]) < 12) },
          { label: "Afternoon", slots: step0TimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h >= 12 && h < 17; }) },
          { label: "Evening", slots: step0TimeSlots.filter((t) => parseInt(t.split(":")[0]) >= 17) },
        ].filter((g) => g.slots.length > 0);

        return (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40 }}
          >
            {/* ── Location selector (multi-location only) ── */}
            {activeLocations.length > 1 && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.foreground, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Select Location
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}
                >
                  {activeLocations.map((loc) => {
                    const isChosen = selectedLocationId === loc.id;
                    const fullAddr = formatFullAddress(loc.address, loc.city, loc.state, loc.zipCode);
                    return (
                      <Pressable
                        key={loc.id}
                        onPress={() => {
                          setSelectedLocationId(loc.id);
                          setStep0Time(null); // reset time when location changes
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 14,
                          borderWidth: 1.5,
                          borderColor: isChosen ? colors.primary : colors.border,
                          backgroundColor: isChosen ? colors.primary + '18' : colors.surface,
                          opacity: pressed ? 0.7 : 1,
                          maxWidth: 200,
                        })}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: isChosen ? colors.primary : colors.foreground }} numberOfLines={1}>
                          {loc.name}
                        </Text>
                        {!!fullAddr && (
                          <Text style={{ fontSize: 11, color: isChosen ? colors.primary + 'cc' : colors.muted, marginTop: 2 }} numberOfLines={1}>
                            {fullAddr}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {!selectedLocationId && (
                  <Text style={{ fontSize: 12, color: colors.warning, marginTop: 6 }}>
                    ⚠ Please select a location to see available times
                  </Text>
                )}
              </View>
            )}

            {/* Month navigation */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Pressable
                onPress={() => { if (canGoPrev) setStep0CalMonthOffset((o) => o - 1); }}
                style={({ pressed }) => ({ padding: 8, opacity: canGoPrev ? (pressed ? 0.5 : 1) : 0.25 })}
              >
                <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
              </Pressable>
              <Pressable onPress={() => { setStep0CalMonthOffset(0); setStep0Date(todayStr); setStep0Time(null); }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                  {MONTH_NAMES[displayMonth]} {displayYear}
                </Text>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {step0Date !== todayStr && (
                  <Pressable
                    onPress={() => { setStep0CalMonthOffset(0); setStep0Date(todayStr); setStep0Time(null); }}
                    style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.primary + "18", opacity: pressed ? 0.65 : 1, marginRight: 4 })}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Today</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => { if (canGoNext) setStep0CalMonthOffset((o) => o + 1); }}
                  style={({ pressed }) => ({ padding: 8, opacity: canGoNext ? (pressed ? 0.5 : 1) : 0.25 })}
                >
                  <IconSymbol name="chevron.right" size={20} color={colors.foreground} />
                </Pressable>
              </View>
            </View>

            {/* Location subtitle — shown once a location is selected */}
            {step0Location && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingHorizontal: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }} numberOfLines={1}>
                  Booking at {step0Location.name}
                </Text>
                {!!formatFullAddress(step0Location.address, step0Location.city, step0Location.state, step0Location.zipCode) && (
                  <Text style={{ fontSize: 11, color: colors.muted, flex: 1 }} numberOfLines={1}>
                    {formatFullAddress(step0Location.address, step0Location.city, step0Location.state, step0Location.zipCode)}
                  </Text>
                )}
              </View>
            )}
            {/* Day headers */}
            <View style={{ flexDirection: "row", width: "100%", marginBottom: 4 }}>
              {DAY_HEADERS.map((d) => (
                <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600", color: colors.muted }}>{d}</Text>
              ))}
            </View>

            {/* Calendar grid */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", width: "100%", marginBottom: 4 }}>
              {calCells.map((day, idx) => {
                if (day === null) {
                  return <View key={`empty-${idx}`} style={{ width: "14.28%", height: 52 }} />;
                }
                const dateStr = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isSelected = dateStr === step0Date;
                const isToday = dateStr === todayStr;
                const isPast = dateStr < todayStr;
                const isOutOfRange = dateStr > maxDateStr;
                const opt = step0DateOptions.find((o) => o.date === dateStr);
                const isClosed = opt ? opt.closed : true;
                const isNoSlots = opt ? opt.noSlots : false;
                const slotCount = opt?.slotCount ?? 0;
                const isDisabled = isPast || isOutOfRange || isClosed || isNoSlots;
                // Green if >2 slots, orange if ≤2 (but >0)
                const dotColor = slotCount > 2 ? colors.success : slotCount > 0 ? colors.warning : colors.error;
                return (
                  <Pressable
                    key={dateStr}
                    onPress={() => {
                      if (!isDisabled) {
                        setStep0Date(dateStr);
                        setStep0Time(null);
                      } else if (!isPast && !isOutOfRange && (isClosed || isNoSlots)) {
                        showStep0ClosedDayMsg(isClosed ? "Closed — no working hours set for this day" : "No available slots on this day");
                      }
                    }}
                    style={({ pressed }) => ({
                      width: "14.28%",
                      height: 52,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: (isPast || isOutOfRange) ? 0.35 : pressed && !isDisabled ? 0.7 : 1,
                    })}
                  >
                    {isSelected && (
                      <View style={{ position: "absolute", width: 36, height: 36, borderRadius: 10, borderWidth: 2, borderColor: colors.primary, backgroundColor: "transparent" }} />
                    )}
                    <Text style={{
                      fontSize: 14,
                      fontWeight: isToday || isSelected ? "700" : "400",
                      color: isToday ? colors.primary : isSelected ? colors.primary : isClosed && !isPast && !isOutOfRange ? colors.muted : colors.foreground,
                      lineHeight: 18,
                    }}>
                      {day}
                    </Text>
                    {/* Slot count label */}
                    {!isPast && !isOutOfRange && slotCount > 0 && (
                      <Text style={{ fontSize: 8, fontWeight: "700", color: dotColor, lineHeight: 10, marginTop: 1 }}>
                        {slotCount}
                      </Text>
                    )}
                    {!isPast && !isOutOfRange && slotCount === 0 && (
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.error, marginTop: 2 }} />
                    )}
                    {(isPast || isOutOfRange) && (
                      <View style={{ width: 4, height: 4, marginTop: 2 }} />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Slot count legend */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10, paddingHorizontal: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
                <Text style={{ fontSize: 10, color: colors.muted }}>Many slots</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning }} />
                <Text style={{ fontSize: 10, color: colors.muted }}>Few slots (≤2)</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
                <Text style={{ fontSize: 10, color: colors.muted }}>Closed</Text>
              </View>
            </View>

            {/* Closed-day tooltip */}
            {step0ClosedDayMsg ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error + "18", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 8 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
                <Text style={{ fontSize: 12, color: colors.error, fontWeight: "500", flex: 1 }}>{step0ClosedDayMsg}</Text>
              </View>
            ) : null}

            {/* Selected date label */}
            <View style={{ marginBottom: 8, marginHorizontal: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
                {new Date(step0Date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </Text>
            </View>

            {/* Interval selector — compact horizontal strip */}
            <View style={{ marginBottom: 12 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}>
                {BOOKING_INTERVALS.map((iv) => {
                  const activeValue = step0SlotInterval !== null ? step0SlotInterval : 0;
                  const isActive = iv.value === activeValue;
                  return (
                    <Pressable
                      key={iv.value}
                      onPress={() => { setStep0SlotInterval(iv.value); setStep0Time(null); }}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                        backgroundColor: isActive ? colors.primary : colors.background,
                        borderWidth: 1.5, borderColor: isActive ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "700", color: isActive ? "#FFFFFF" : colors.muted }}>
                        {iv.value === 0 ? `Auto (${step0EffectiveInterval}m)` : iv.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Time slots */}
            {step0TimeSlots.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 28, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted }}>No available times</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Try a different date or adjust working hours</Text>
              </View>
            ) : (
              <View style={{ marginBottom: 16 }}>
                {step0SlotGroups.map((group) => (
                  <View key={group.label} style={{ marginBottom: 16 }}>
                    {/* Section header with divider line */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted, letterSpacing: 1, textTransform: "uppercase" }}>{group.label}</Text>
                      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                    </View>
                    {/* 3-column fixed-width pill grid — no orphan pills */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {group.slots.map((t) => {
                        const isSlotSelected = t === step0Time;
                        const locCount = step0IsAllMode ? (step0SlotLocCount[t] ?? 0) : 0;
                        const isScarce = step0IsAllMode && locCount > 0 && locCount <= 2;
                        const locCountColor = locCount > 2 ? colors.success : locCount > 1 ? colors.warning : colors.muted;
                        const slotBg = isSlotSelected
                          ? colors.primary
                          : isScarce
                          ? colors.warning + "18"
                          : colors.surface;
                        const slotBorder = isSlotSelected
                          ? colors.primary
                          : isScarce
                          ? colors.warning + "60"
                          : colors.border;
                        return (
                          <Pressable
                            key={t}
                            onPress={() => setStep0Time(t)}
                            style={({ pressed }) => ({
                              width: slotPillWidth,
                              height: 48,
                              borderRadius: 12,
                              backgroundColor: slotBg,
                              borderWidth: isSlotSelected ? 0 : 1.5,
                              borderColor: slotBorder,
                              alignItems: "center",
                              justifyContent: "center",
                              opacity: pressed ? 0.7 : 1,
                              ...(isSlotSelected ? {
                                shadowColor: colors.primary,
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.25,
                                shadowRadius: 4,
                                elevation: 3,
                              } : {}),
                            })}
                          >
                            <Text style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: isSlotSelected ? "#FFFFFF" : colors.foreground,
                              textAlign: "center",
                              lineHeight: 18,
                            }}>
                              {formatTimeDisplay(t)}
                            </Text>
                            {step0IsAllMode && locCount > 0 && (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 }}>
                                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSlotSelected ? "rgba(255,255,255,0.7)" : locCountColor }} />
                                <Text style={{ fontSize: 9, fontWeight: "600", color: isSlotSelected ? "rgba(255,255,255,0.85)" : locCountColor, lineHeight: 11 }}>
                                  {locCount} {locCount === 1 ? "loc" : "locs"}
                                </Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Continue button */}
            {(() => {
              const needsLocation = activeLocations.length > 1 && !selectedLocationId;
              const canContinue = !!step0Time && !needsLocation;
              return (
                <Pressable
                  onPress={() => {
                    if (needsLocation) {
                      Alert.alert("Select a Location", "Please select a location before continuing.");
                      return;
                    }
                    if (!step0Time) {
                      Alert.alert("Select a Time", "Please select a time slot to continue.");
                      return;
                    }
                    // If a package is pre-selected (from Package Browser), skip service selection (Step 1)
                    // and go directly to Select Client (Step 2)
                    if (params.packageId && selectedServices.length > 0) {
                      setStep(2);
                    } else {
                      setStep(1);
                    }
                  }}
                  style={({ pressed }) => ([
                    styles.confirmBtn,
                    { backgroundColor: canContinue ? colors.primary : colors.muted, opacity: pressed ? 0.8 : 1 },
                  ])}
                >
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>
                    {needsLocation ? 'Select a Location First' : !step0Time ? 'Select a Time to Continue' : 'Continue →'}
                  </Text>
                </Pressable>
              );
            })()}
          </ScrollView>
        );
      })()}

      {/* ─── Step 1: Multi-Service Selection ─── */}
      {step === 1 && (
        <View style={{ flex: 1 }}>
          {/* Pinned cart at top — always visible */}
          {selectedServices.length > 0 && (
            <View style={{ marginHorizontal: hp, marginBottom: 10, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.primary + "50", padding: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary, textTransform: "uppercase", letterSpacing: 0.6 }}>Selected Services</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {selectedServices.reduce((s, i) => s + i.duration, 0)} min · ${selectedServices.reduce((s, i) => s + i.price, 0).toFixed(2)}
                </Text>
              </View>
              {selectedServices.map((svc, idx) => (
                <View key={svc.id + idx} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{svc.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{svc.duration} min · ${svc.price.toFixed(2)}</Text>
                  </View>
                  <Pressable
                    onPress={() => setSelectedServices((prev) => prev.filter((_, i) => i !== idx))}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                  >
                    <IconSymbol name="xmark" size={14} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: hp }}
          >
            {/* ── Book a Package banner ─────────────────────────────────────── */}
            {(() => {
              const activePackages = (state.packages ?? []).filter((p) => p.active !== false);
              if (activePackages.length === 0) return null;
              // Check if a package is already selected in this booking flow
              const selectedPkgItem = selectedServices.find((s) => s.type === "package");
              const selectedPkg = selectedPkgItem ? activePackages.find((p) => p.id === selectedPkgItem.packageId) : null;
              return (
                <TouchableOpacity
                  activeOpacity={selectedPkg ? 1 : 0.75}
                  onPress={() => {
                    if (selectedPkg) return; // inner buttons handle navigation when selected
                    router.push({
                      pathname: "/package-browser" as any,
                      params: { ...(selectedLocationId ? { locationId: selectedLocationId } : {}), fromCalendarBooking: '1' },
                    });
                  }}
                  style={{
                    backgroundColor: selectedPkg ? colors.success + "12" : colors.primary + "12",
                    borderColor: selectedPkg ? colors.success + "60" : colors.primary + "40",
                    borderWidth: 1.5,
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    marginBottom: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: selectedPkg ? colors.success + "20" : colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 18 }}>📦</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: selectedPkg ? colors.success : colors.primary }}>
                        {selectedPkg ? `${selectedPkg.name} ✓` : "Book a Package"}
                      </Text>
                      {selectedPkg && (() => {
                        const includedSvcs = (selectedPkg.serviceIds ?? []).map((sid: string) => state.services.find((sv: any) => sv.id === sid)).filter(Boolean) as any[];
                        const retailTotal = includedSvcs.reduce((s: number, sv: any) => s + parseFloat(String(sv.price)), 0);
                        const savings = retailTotal - selectedPkg.price;
                        if (savings <= 0) return null;
                        return (
                          <View style={{ backgroundColor: colors.success + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 10, fontWeight: "700", color: colors.success }}>Save ${savings.toFixed(2)}</Text>
                          </View>
                        );
                      })()}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
                      {selectedPkg
                        ? (() => {
                            const validityStr = selectedPkg.expiryDays
                              ? selectedPkg.expiryDays % 30 === 0
                                ? `Valid ${selectedPkg.expiryDays / 30} month${selectedPkg.expiryDays / 30 !== 1 ? "s" : ""}`
                                : `Valid ${selectedPkg.expiryDays} days`
                              : null;
                            const pkgDiscountTotal = discountAmount + promoDiscountAmount + manualDiscountAmount;
                            const discountedPkgPrice = Math.max(0, selectedPkg.price - pkgDiscountTotal);
                            const priceStr = pkgDiscountTotal > 0
                              ? `$${selectedPkg.price.toFixed(2)} → $${discountedPkgPrice.toFixed(2)}`
                              : `$${selectedPkg.price.toFixed(2)}`;
                            return `${selectedPkg.sessions ?? "?"} sessions · ${priceStr}${validityStr ? ` · ${validityStr}` : ""}`;
                          })()
                        : (() => {
                            const totalSessions = activePackages.reduce((sum, p) => sum + (p.sessions ?? 0), 0);
                            const minPrice = Math.min(...activePackages.map((p) => p.price));
                            return `${activePackages.length} bundle${activePackages.length !== 1 ? "s" : ""} · ${totalSessions} sessions · from $${minPrice.toFixed(2)}`;
                          })()
                      }
                    </Text>
                  </View>
                  {selectedPkg ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <TouchableOpacity
                        onPress={() => router.push({
                          pathname: "/package-browser" as any,
                          params: { ...(selectedLocationId ? { locationId: selectedLocationId } : {}), fromCalendarBooking: '1' },
                        })}
                        style={{ alignItems: "center", gap: 1, paddingHorizontal: 4 }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.success, letterSpacing: 0.2 }}>Change</Text>
                        <IconSymbol name="chevron.right" size={13} color={colors.success} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setSelectedServices([])}
                        style={{ padding: 6, borderRadius: 8, backgroundColor: colors.error + "15" }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.error, lineHeight: 14 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <IconSymbol name="chevron.right" size={16} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })()}

            {/* ── Packages & Bundles section removed — accessible via Book a Package banner above ── */}
            {false && (() => {
              const activePackages = (state.packages ?? []).filter((p) => p.active !== false);
              if (activePackages.length === 0) return null;
              return (
                <View style={{ marginBottom: 20 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Packages &amp; Bundles</Text>
                  {activePackages.map((pkg) => {
                    const isSelected = selectedServices.some((s) => s.packageId === pkg.id);
                    const includedSvcs = pkg.serviceIds
                      .map((id) => state.services.find((s) => s.id === id))
                      .filter(Boolean) as typeof state.services;
                    const totalDuration = includedSvcs.reduce((s, sv) => s + sv.duration, 0);
                    const retailTotal = includedSvcs.reduce((s, sv) => s + parseFloat(String(sv.price)), 0);
                    const savings = retailTotal - pkg.price;
                    return (
                      <Pressable
                        key={pkg.id}
                        onPress={() => {
                          if (isSelected) {
                            setSelectedServices((prev) => prev.filter((s) => s.packageId !== pkg.id));
                          } else {
                            setSelectedServices((prev) => [
                              ...prev.filter((s) => s.packageId !== pkg.id),
                              {
                                type: "package",
                                id: pkg.id,
                                packageId: pkg.id,
                                packageServiceIds: pkg.serviceIds,
                                name: pkg.name,
                                price: pkg.price,
                                duration: totalDuration,
                              },
                            ]);
                          }
                        }}
                        style={({ pressed }) => ({
                          backgroundColor: isSelected ? colors.primary + "15" : colors.surface,
                          borderColor: isSelected ? colors.primary : colors.border,
                          borderWidth: 1.5,
                          borderRadius: 14,
                          padding: 14,
                          marginBottom: 10,
                          opacity: pressed ? 0.75 : 1,
                        })}
                      >
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{pkg.name}</Text>
                              {savings > 0 && (
                                <View style={{ backgroundColor: "#22C55E20", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
                                  <Text style={{ fontSize: 11, color: "#22C55E", fontWeight: "700" }}>Save ${savings.toFixed(2)}</Text>
                                </View>
                              )}
                            </View>
                            {pkg.description ? (
                              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }} numberOfLines={2}>{pkg.description}</Text>
                            ) : null}
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                              {includedSvcs.map((sv) => (
                                <View key={sv.id} style={{ backgroundColor: colors.border, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                                  <Text style={{ fontSize: 11, color: colors.muted }}>{sv.name}</Text>
                                </View>
                              ))}
                            </View>
                            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>{totalDuration} min total</Text>
                          </View>
                          <View style={{ alignItems: "flex-end", gap: 6 }}>
                            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.primary }}>${pkg.price.toFixed(2)}</Text>
                            {isSelected ? (
                              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
                                <IconSymbol name="checkmark" size={14} color="#FFF" />
                              </View>
                            ) : (
                              <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border }} />
                            )}
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                  <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 16 }} />
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Individual Services</Text>
                </View>
              );
            })()}

            {state.services.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-base text-muted">No services available</Text>
                <Text className="text-sm text-muted mt-1">Create a service first</Text>
              </View>
            ) : (
              (() => {
                const groups = new Map<string, typeof state.services>();
                state.services.forEach((s) => {
                  const cat = s.category?.trim() || "General";
                  if (!groups.has(cat)) groups.set(cat, []);
                  groups.get(cat)!.push(s);
                });
                const entries = Array.from(groups.entries()).sort((a, b) => {
                  if (a[0] === "General") return 1;
                  if (b[0] === "General") return -1;
                  return a[0].localeCompare(b[0]);
                });
                const hasMultiCat = entries.length > 1;
                const CATEGORY_EMOJI: Record<string, string> = {
                  Hair: "✂️", Massage: "💆", Nails: "💅", Skincare: "🧴",
                  "Waxing & Brows": "🪮", Waxing: "🪮", Brows: "🪮",
                  Makeup: "💄", Lashes: "👁️", Spa: "🛁", Fitness: "🏋️",
                  Tattoo: "🖊️", Piercing: "💎", Barber: "💈", General: "⭐",
                };
                const getCatEmoji = (c: string) => CATEGORY_EMOJI[c] ?? "✨";

                // Total duration already selected — used for conflict checking of additional services
                const alreadySelectedDuration = selectedServices.reduce((s, i) => s + i.duration, 0);

                if (hasMultiCat && step1CategoryFilter === null) {
                  return (
                    <View>
                      <Text className="text-base font-semibold text-foreground mb-3">
                        {selectedServices.length > 0 ? "Add from another category" : "Select a Category"}
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {entries.map(([cat, svcs]) => (
                          <Pressable
                            key={cat}
                            onPress={() => setStep1CategoryFilter(cat)}
                            style={({ pressed }) => ({
                              width: "47%",
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                              borderWidth: 1,
                              borderRadius: 14,
                              paddingVertical: 18,
                              paddingHorizontal: 14,
                              alignItems: "center",
                              gap: 8,
                              opacity: pressed ? 0.7 : 1,
                            })}
                          >
                            <Text style={{ fontSize: 32 }}>{getCatEmoji(cat)}</Text>
                            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>{cat}</Text>
                            <Text style={{ fontSize: 11, color: colors.muted }}>{svcs.length} service{svcs.length !== 1 ? "s" : ""}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                }

                const displaySvcs =
                  hasMultiCat && step1CategoryFilter
                    ? (groups.get(step1CategoryFilter) ?? [])
                    : state.services;

                return (
                  <View>
                    {hasMultiCat && step1CategoryFilter && (
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 }}>
                        <Pressable
                          onPress={() => setStep1CategoryFilter(null)}
                          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                        >
                          <Text style={{ fontSize: 14, color: colors.primary }}>← Categories</Text>
                        </Pressable>
                        <Text className="text-base font-semibold text-foreground">{step1CategoryFilter}</Text>
                      </View>
                    )}
                    {!hasMultiCat && (
                      <Text className="text-base font-semibold text-foreground mb-3">Select Services</Text>
                    )}
                    {displaySvcs.map((item) => {
                      const svcEmoji = getCatEmoji(item.category ?? "");
                      const isSelected = selectedServices.some((s) => s.id === item.id);
                      // Check if adding this service would exceed closing time or overlap
                      const combinedDuration = alreadySelectedDuration + item.duration;
                      const { disabled: svcDisabled, reason: svcReason } = isServiceDisabledAtTime(combinedDuration);
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => {
                            if (svcDisabled) return;
                            if (isSelected) {
                              // Deselect
                              setSelectedServices((prev) => prev.filter((s) => s.id !== item.id));
                            } else {
                              // Check for duplicate
                              const alreadyAdded = selectedServices.some((s) => s.id === item.id);
                              if (alreadyAdded) {
                                Alert.alert("Already Added", `"${item.name}" is already in your selection.`);
                                return;
                              }
                              setSelectedServices((prev) => [...prev, {
                                type: "service",
                                id: item.id,
                                name: item.name,
                                price: parseFloat(String(item.price)),
                                duration: item.duration,
                              }]);
                            }
                          }}
                          style={({ pressed }) => [
                            styles.optionCard,
                            {
                              backgroundColor: isSelected ? (item.color ?? colors.primary) + "15" : colors.surface,
                              borderColor: svcDisabled ? colors.border : isSelected ? (item.color ?? colors.primary) : colors.border,
                              opacity: svcDisabled ? 0.45 : pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          {item.photoUri ? (
                            <Image source={{ uri: item.photoUri }} style={{ width: 40, height: 40, borderRadius: 8, marginRight: 12 }} />
                          ) : (
                            <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: (item.color ?? colors.primary) + "22", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                              <Text style={{ fontSize: 20 }}>{svcEmoji}</Text>
                            </View>
                          )}
                          <View style={styles.optionContent}>
                            <Text style={{ fontSize: 15, fontWeight: "600", color: svcDisabled ? colors.muted : colors.foreground }}>{item.name}</Text>
                            <Text className="text-xs text-muted mt-0.5">{item.duration} min · ${parseFloat(String(item.price)).toFixed(2)}</Text>
                            {svcDisabled && svcReason && (
                              <Text style={{ fontSize: 11, color: colors.error, marginTop: 2 }}>⚠️ {svcReason}</Text>
                            )}
                          </View>
                          {svcDisabled ? (
                            <IconSymbol name="lock.fill" size={16} color={colors.muted} />
                          ) : isSelected ? (
                            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: item.color ?? colors.primary, alignItems: "center", justifyContent: "center" }}>
                              <IconSymbol name="checkmark" size={14} color="#FFF" />
                            </View>
                          ) : (
                            <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border }} />
                          )}
                        </Pressable>
                      );
                    })}
                    {/* Add from another category button */}
                    {hasMultiCat && step1CategoryFilter && selectedServices.length > 0 && (
                      <Pressable
                        onPress={() => setStep1CategoryFilter(null)}
                        style={({ pressed }) => ({
                          flexDirection: "row", alignItems: "center", justifyContent: "center",
                          gap: 8, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5,
                          borderColor: colors.primary, backgroundColor: colors.primary + "12",
                          opacity: pressed ? 0.7 : 1, marginTop: 4,
                        })}
                      >
                        <IconSymbol name="plus" size={16} color={colors.primary} />
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>Add from another category</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })()
            )}
          </ScrollView>

          {/* Pinned Continue button */}
          <View style={{ paddingHorizontal: hp, paddingBottom: 16, paddingTop: 8, backgroundColor: colors.background }}>
            <Pressable
              onPress={() => {
                if (selectedServices.length === 0) return;
                // If a package is selected, go to multi-session scheduler (Step 8)
                const hasPackage = selectedServices.some((s) => s.type === "package");
                if (hasPackage) {
                  // Reset session scheduler state
                  setPackageSessions([]);
                  setPkgSessionIdx(0);
                  setPkgCalMonthOffset(0);
                  setPkgSessionDate(formatDateStr(new Date()));
                  setPkgSessionTime(null);
                  setStep(8);
                  return;
                }
                setStep(2);
              }}
              style={({ pressed }) => [
                styles.confirmBtn,
                {
                  backgroundColor: selectedServices.length > 0 ? colors.primary : colors.border,
                  opacity: pressed && selectedServices.length > 0 ? 0.8 : 1,
                  marginTop: 0,
                },
              ]}
            >
              <Text style={{ color: selectedServices.length > 0 ? "#FFF" : colors.muted, fontSize: 16, fontWeight: "700" }}>
                {selectedServices.length === 0 ? "Select at least one service" : `Continue with ${selectedServices.length} service${selectedServices.length > 1 ? "s" : ""} →`}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ─── Step 8: Multi-Session Package Scheduler ─── */}
      {step === 8 && (() => {
        const pkgCartItem = selectedServices.find((s) => s.type === "package");
        const pkg = pkgCartItem ? (state.packages ?? []).find((p) => p.id === pkgCartItem.packageId) : null;
        const totalSessions = pkg?.sessions ?? 1;
        const bufferDays = pkg?.bufferDays ?? 0;
        const sessionDuration = pkgCartItem?.duration ?? 60;

        const today = new Date();
        const todayStr = formatDateStr(today);
        const displayDate = new Date(today.getFullYear(), today.getMonth() + pkgCalMonthOffset, 1);
        const displayMonth = displayDate.getMonth();
        const displayYear = displayDate.getFullYear();
        const firstDayOfWeek = new Date(displayYear, displayMonth, 1).getDay();
        const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
        const calCells: (number | null)[] = [
          ...Array(firstDayOfWeek).fill(null),
          ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
        ];

        // Compute the minimum allowed date for this session (buffer days after previous session)
        const prevSession = pkgSessionIdx > 0 ? packageSessions[pkgSessionIdx - 1] : null;
        const minAllowedDate = prevSession && bufferDays > 0
          ? (() => {
              const d = new Date(prevSession.date + "T12:00:00");
              d.setDate(d.getDate() + bufferDays);
              return formatDateStr(d);
            })()
          : todayStr;

        // Check if a date is closed (uses same logic as Step 0)
        const isPkgDateClosed = (ds: string): boolean => {
          if (ds < minAllowedDate) return true;
          const endDate = state.settings.businessHoursEndDate;
          if (endDate && ds > endDate) return true;
          const customDay = (state.customSchedule ?? []).find((cs: any) => cs.date === ds);
          if (state.settings.scheduleMode === "custom") return !customDay || !customDay.isOpen;
          if (customDay) return !customDay.isOpen;
          const d = new Date(ds + "T12:00:00");
          const dayName = DAYS_OF_WEEK[d.getDay()];
          const wh = (state.settings.workingHours as any)?.[dayName];
          return !wh || !wh.enabled;
        };

        // Compute available time slots for the selected date
        const pkgTimeSlots: string[] = (() => {
          if (isPkgDateClosed(pkgSessionDate)) return [];
          return generateCalendarSlots(
            pkgSessionDate, sessionDuration,
            state.settings.workingHours,
            state.appointments,
            30,
            state.customSchedule ?? [],
            state.settings.scheduleMode,
            (state.settings as any).bufferTime ?? 0
          );
        })();

        // Group time slots by Morning / Afternoon / Evening
        const pkgSlotGroups: { label: string; slots: string[] }[] = [];
        const morningSlots = pkgTimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h < 12; });
        const afternoonSlots = pkgTimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h >= 12 && h < 17; });
        const eveningSlots = pkgTimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h >= 17; });
        if (morningSlots.length > 0) pkgSlotGroups.push({ label: "Morning", slots: morningSlots });
        if (afternoonSlots.length > 0) pkgSlotGroups.push({ label: "Afternoon", slots: afternoonSlots });
        if (eveningSlots.length > 0) pkgSlotGroups.push({ label: "Evening", slots: eveningSlots });

        const formatTimeDisplay = (time: string) => {
          const [h, m] = time.split(":").map(Number);
          const ap = h >= 12 ? "PM" : "AM";
          const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
          return `${hr}:${String(m).padStart(2, "0")} ${ap}`;
        };

        const handleConfirmSession = () => {
          if (!pkgSessionTime) {
            Alert.alert("Select a Time", "Please select a time slot for this session.");
            return;
          }
          const newSessions = [...packageSessions];
          newSessions[pkgSessionIdx] = { date: pkgSessionDate, time: pkgSessionTime };
          setPackageSessions(newSessions);

          if (pkgSessionIdx + 1 < totalSessions) {
            // Advance to next session
            const nextIdx = pkgSessionIdx + 1;
            setPkgSessionIdx(nextIdx);
            // Set default date for next session: minAllowed date after buffer
            const nextMinDate = bufferDays > 0
              ? (() => {
                  const d = new Date(pkgSessionDate + "T12:00:00");
                  d.setDate(d.getDate() + bufferDays);
                  return formatDateStr(d);
                })()
              : pkgSessionDate;
            setPkgSessionDate(nextMinDate);
            setPkgSessionTime(null);
            // Reset calendar month to show the new minimum date
            const nextDateObj = new Date(nextMinDate + "T12:00:00");
            const monthDiff = (nextDateObj.getFullYear() - today.getFullYear()) * 12 + (nextDateObj.getMonth() - today.getMonth());
            setPkgCalMonthOffset(Math.max(0, monthDiff));
          } else {
            // All sessions scheduled — proceed to client selection
            setStep(2);
          }
        };

        return (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40 }}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Pressable onPress={() => {
                if (pkgSessionIdx > 0) {
                  setPkgSessionIdx(pkgSessionIdx - 1);
                  const prev = packageSessions[pkgSessionIdx - 1];
                  if (prev) { setPkgSessionDate(prev.date); setPkgSessionTime(prev.time); }
                  else { setPkgSessionDate(formatDateStr(new Date())); setPkgSessionTime(null); }
                } else if (params.packageId) {
                  // Launched directly from Package Browser — go back to it
                  router.back();
                } else {
                  setStep(1);
                }
              }} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                <Text style={{ fontSize: 14, color: colors.primary }}>← Back</Text>
              </Pressable>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Schedule Sessions</Text>
              <View style={{ width: 50 }} />
            </View>

            {/* Package info banner */}
            {pkg && (
              <View style={{ backgroundColor: colors.primary + "15", borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.primary + "40" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.primary, marginBottom: 2 }}>{pkg.name}</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>{totalSessions} session{totalSessions !== 1 ? "s" : ""} · {sessionDuration} min each{bufferDays > 0 ? ` · ${bufferDays}+ day gap required` : ""}</Text>
              </View>
            )}

            {/* Session progress dots */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20, justifyContent: "center" }}>
              {Array.from({ length: totalSessions }).map((_, i) => {
                const isDone = i < pkgSessionIdx || (i === pkgSessionIdx && !!packageSessions[i]);
                const isCurrent = i === pkgSessionIdx;
                return (
                  <View key={i} style={{
                    width: isCurrent ? 32 : 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: isDone ? colors.success : isCurrent ? colors.primary : colors.border,
                  }} />
                );
              })}
            </View>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, textAlign: "center", marginBottom: 16 }}>
              Session {pkgSessionIdx + 1} of {totalSessions}
            </Text>

            {/* Buffer days notice */}
            {bufferDays > 0 && pkgSessionIdx > 0 && (
              <View style={{ backgroundColor: colors.warning + "20", borderRadius: 10, padding: 10, marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <IconSymbol name="exclamationmark.circle.fill" size={16} color={colors.warning} />
                <Text style={{ fontSize: 12, color: colors.warning, flex: 1, fontWeight: "600" }}>
                  Must be at least {bufferDays} day{bufferDays !== 1 ? "s" : ""} after Session {pkgSessionIdx} ({prevSession ? formatDateDisplay(prevSession.date) : ""})
                </Text>
              </View>
            )}

            {/* Calendar */}
            <View style={{ marginBottom: 16 }}>
              {/* Month navigation */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <Pressable onPress={() => pkgCalMonthOffset > 0 && setPkgCalMonthOffset(pkgCalMonthOffset - 1)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 8 })}>
                  <IconSymbol name="chevron.left" size={18} color={pkgCalMonthOffset > 0 ? colors.foreground : colors.border} />
                </Pressable>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{MONTH_NAMES[displayMonth]} {displayYear}</Text>
                <Pressable onPress={() => pkgCalMonthOffset < 5 && setPkgCalMonthOffset(pkgCalMonthOffset + 1)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 8 })}>
                  <IconSymbol name="chevron.right" size={18} color={pkgCalMonthOffset < 5 ? colors.foreground : colors.border} />
                </Pressable>
              </View>
              {/* Day headers */}
              <View style={{ flexDirection: "row", marginBottom: 4 }}>
                {DAY_HEADERS.map((d) => (
                  <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600", color: colors.muted }}>{d}</Text>
                ))}
              </View>
              {/* Calendar grid */}
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {calCells.map((day, idx) => {
                  if (!day) return <View key={`e${idx}`} style={{ width: "14.28%", aspectRatio: 1 }} />;
                  const ds = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const closed = isPkgDateClosed(ds);
                  const isSelected = ds === pkgSessionDate;
                  const isToday = ds === todayStr;
                  const isScheduled = packageSessions.some((s) => s.date === ds);
                  const isBufferBlocked = ds < minAllowedDate;
                  const pkgSlotCount = (() => {
                    if (closed || isBufferBlocked) return 0;
                    const slots = generateCalendarSlots(
                      ds, sessionDuration, state.settings.workingHours,
                      state.appointments, 30,
                      state.customSchedule ?? [], state.settings.scheduleMode,
                      (state.settings as any).bufferTime ?? 0
                    );
                    return slots.length;
                  })();
                  const isFull = !closed && !isBufferBlocked && pkgSlotCount === 0;
                  const isDisabled = closed || isFull || isBufferBlocked;
                  return (
                    <Pressable
                      key={ds}
                      onPress={() => {
                        if (isDisabled) return;
                        setPkgSessionDate(ds);
                        setPkgSessionTime(null);
                      }}
                      style={({ pressed }) => ({
                        width: "14.28%",
                        aspectRatio: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: isBufferBlocked ? 0.25 : isDisabled ? 0.45 : pressed ? 0.7 : 1,
                      })}
                    >
                      <View style={{
                        width: 34,
                        height: 34,
                        borderRadius: isSelected ? 8 : 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: isSelected ? colors.primary : isScheduled ? colors.success + "30" : "transparent",
                        borderWidth: isToday && !isSelected ? 1.5 : 0,
                        borderColor: colors.primary,
                      }}>
                        <Text style={{
                          fontSize: 14,
                          fontWeight: isSelected || isToday ? "700" : "400",
                          color: isSelected ? "#FFF" : isScheduled ? colors.success : isDisabled ? colors.muted : colors.foreground,
                        }}>{day}</Text>
                      </View>
                      {/* Slot count badge / FULL label — shown below the date circle */}
                      {!isBufferBlocked && !closed && !isScheduled && (() => {
                        if (isFull) {
                          return <Text style={{ fontSize: 8, fontWeight: "700", color: colors.error, marginTop: 1, letterSpacing: 0.3 }}>FULL</Text>;
                        }
                        // Color coding: green ≥ 6, amber 2–5, red 1
                        const slotColor = pkgSlotCount >= 6 ? "#22C55E" : pkgSlotCount >= 2 ? "#F59E0B" : "#EF4444";
                        return (
                          <Text style={{ fontSize: 8, fontWeight: "700", color: isSelected ? "rgba(255,255,255,0.85)" : slotColor, marginTop: 1 }}>
                            {pkgSlotCount}
                          </Text>
                        );
                      })()}
                      {isScheduled && !isSelected && (
                        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.success, marginTop: 1 }} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Time slots */}
            {pkgSlotGroups.length > 0 ? (
              <View style={{ marginBottom: 20 }}>
                {pkgSlotGroups.map((group) => (
                  <View key={group.label} style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>{group.label}</Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {group.slots.map((t) => {
                        const isSlotSelected = t === pkgSessionTime;
                        return (
                          <Pressable
                            key={t}
                            onPress={() => setPkgSessionTime(t)}
                            style={({ pressed }) => ({
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                              borderRadius: 50,
                              borderWidth: 1.5,
                              borderColor: isSlotSelected ? colors.primary : colors.border,
                              backgroundColor: isSlotSelected ? colors.primary : colors.surface,
                              opacity: pressed ? 0.7 : 1,
                              ...(isSlotSelected ? { shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 } : {}),
                            })}
                          >
                            <Text style={{ fontSize: 13, fontWeight: "700", color: isSlotSelected ? "#FFF" : colors.foreground }}>
                              {formatTimeDisplay(t)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <IconSymbol name="calendar" size={32} color={colors.muted} />
                <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8, textAlign: "center" }}>
                  {isPkgDateClosed(pkgSessionDate) ? (bufferDays > 0 && pkgSessionDate < minAllowedDate ? `Buffer period — select a date after ${formatDateDisplay(minAllowedDate)}` : "Closed on this day") : "No available slots on this day"}
                </Text>
              </View>
            )}

            {/* Already scheduled sessions summary */}
            {packageSessions.filter(Boolean).length > 0 && (
              <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Scheduled So Far</Text>
                {packageSessions.filter(Boolean).map((s, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: i < packageSessions.filter(Boolean).length - 1 ? 8 : 0 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.success + "20", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.success }}>{i + 1}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: colors.foreground }}>{formatDateDisplay(s.date)} · {formatTimeDisplay(s.time)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Confirm session button */}
            <Pressable
              onPress={handleConfirmSession}
              style={({ pressed }) => ([
                styles.confirmBtn,
                { backgroundColor: pkgSessionTime ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
              ])}
            >
              <Text style={{ color: pkgSessionTime ? "#FFF" : colors.muted, fontSize: 16, fontWeight: "700" }}>
                {pkgSessionIdx + 1 < totalSessions
                  ? `Confirm Session ${pkgSessionIdx + 1} → Schedule Session ${pkgSessionIdx + 2}`
                  : `Confirm Session ${pkgSessionIdx + 1} → Continue`}
              </Text>
            </Pressable>
          </ScrollView>
        );
      })()}

      {/* ─── Step 2: Client Selection ─── */}
      {step === 2 && (
        <View style={{ flex: 1, paddingHorizontal: hp }}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              onPress={() => setStep(1)}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <Text className="text-sm" style={{ color: colors.primary }}>
                ← Back
              </Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">
              Select Client
            </Text>
            <Pressable
              onPress={() => setShowQuickAdd(!showQuickAdd)}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <Text className="text-sm" style={{ color: colors.primary }}>
                {showQuickAdd ? "Cancel" : "+ New"}
              </Text>
            </Pressable>
          </View>

          {showQuickAdd ? (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              <TextInput
                className="bg-background rounded-xl px-3 py-3 text-sm mb-2 border border-border"
                placeholder="Client Name *"
                placeholderTextColor={colors.muted}
                value={quickName}
                onChangeText={setQuickName}
                style={{ color: colors.foreground }}
                returnKeyType="next"
              />
              <TextInput
                className="bg-background rounded-xl px-3 py-3 text-sm mb-3 border border-border"
                placeholder="(000) 000-0000"
                placeholderTextColor={colors.muted}
                value={quickPhone}
                onChangeText={(t) => setQuickPhone(formatPhoneNumber(t))}
                keyboardType="phone-pad"
                maxLength={14}
                style={{ color: colors.foreground }}
                returnKeyType="done"
                onSubmitEditing={handleQuickAddClient}
              />
              <Pressable
                onPress={handleQuickAddClient}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text className="text-sm font-semibold text-white">
                  Add & Continue
                </Text>
              </Pressable>
            </View>
          ) : (
            <TextInput
              className="bg-surface rounded-xl px-3 py-3 text-sm mb-3 border border-border"
              placeholder="Search clients..."
              placeholderTextColor={colors.muted}
              value={clientSearch}
              onChangeText={setClientSearch}
              style={{ color: colors.foreground }}
              returnKeyType="search"
            />
          )}

          <FlatList
            data={filteredClients}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setSelectedClientId(item.id);
                  advanceAfterClient();
                }}
                style={({ pressed }) => [
                  styles.optionCard,
                  {
                    backgroundColor:
                      selectedClientId === item.id
                        ? colors.primary + "15"
                        : colors.surface,
                    borderColor:
                      selectedClientId === item.id
                        ? colors.primary
                        : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: colors.primary + "20" },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: colors.primary,
                    }}
                  >
                    {getInitials(item.name)}
                  </Text>
                </View>
                <View style={styles.optionContent}>
                  <Text className="text-base font-semibold text-foreground">
                    {item.name}
                  </Text>
                  {item.phone ? (
                    <Text className="text-xs text-muted mt-0.5">{formatPhoneNumber(item.phone)}</Text>
                  ) : null}
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View className="items-center py-8">
                <Text className="text-sm text-muted">No clients found</Text>
              </View>
            }
          />
        </View>
      )}

      {/* ─── Step 3: Location Selection (only if multiple locations) ─── */}
      {step === 3 && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: hp }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <Pressable
              onPress={() => setStep(2)}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <Text className="text-sm" style={{ color: colors.primary }}>
                ← Back
              </Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">
              Select Location
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Green banner when location was pre-selected from Home page filter */}
          {homePagePreselectedLocationId && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: colors.success + "18",
                borderColor: colors.success + "40",
                borderWidth: 1,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                marginBottom: 16,
              }}
            >
              <IconSymbol name="location.fill" size={14} color={colors.success} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.success, fontWeight: "600" }}>
                Booking for {state.locations.find((l) => l.id === homePagePreselectedLocationId)?.name ?? "selected location"} — tap to change location
              </Text>
            </View>
          )}

          {/* Show locations that are open on the selected date */}
          {/* When coming from All-mode calendar with a specific time, only show eligible locations */}
          {activeLocations
            .filter((loc) => !eligibleLocationIds || eligibleLocationIds.includes(loc.id))
            .map((loc) => {
            const d = new Date(preselectedDate + "T12:00:00");
            const dayName = DAYS_OF_WEEK[d.getDay()];
            const locWH =
              loc.workingHours && Object.keys(loc.workingHours).length > 0
                ? (loc.workingHours as any)
                : state.settings.workingHours;
            const locCustom = (state as any).locationCustomSchedule?.[loc.id]?.find(
              (cs: any) => cs.date === preselectedDate
            );
            let isOpen = false;
            if (loc.temporarilyClosed) {
              isOpen = false;
            } else if (state.settings.scheduleMode === "custom") {
              isOpen = !!(locCustom?.isOpen);
            } else if (locCustom) {
              isOpen = locCustom.isOpen;
            } else {
              const wh = locWH?.[dayName];
              isOpen = !!(wh && wh.enabled);
            }

            let timeAvailable = true;
            if (preselectedTime && isOpen) {
              const locAppts = state.appointments.filter(
                (a) => a.locationId === loc.id
              );
              const locCustomSchedule =
                (state as any).locationCustomSchedule?.[loc.id] ?? [];
              const globalFallback = (state.customSchedule ?? []).filter(
                (cs) =>
                  !locCustomSchedule.some((lcs: any) => lcs.date === cs.date)
              );
              const mergedCustom = [...locCustomSchedule, ...globalFallback];
              const slots = generateCalendarSlots(
                preselectedDate,
                totalDuration,
                locWH,
                locAppts,
                effectiveStep,
                mergedCustom,
                state.settings.scheduleMode,
                state.settings.bufferTime ?? 0
              );
              timeAvailable = slots.includes(preselectedTime);
            }

            const isAvailable = isOpen && timeAvailable;
            const isSelected = selectedLocationId === loc.id;

            return (
              <Pressable
                key={loc.id}
                onPress={() => {
                  if (!isAvailable) return;
                  setSelectedLocationId(loc.id);
                  setStep(4);
                }}
                style={({ pressed }) => [
                  styles.optionCard,
                  {
                    backgroundColor: isSelected
                      ? colors.primary + "15"
                      : !isAvailable
                      ? colors.surface + "80"
                      : colors.surface,
                    borderColor: isSelected
                      ? colors.primary
                      : !isAvailable
                      ? colors.border + "60"
                      : colors.border,
                    opacity: !isAvailable ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                {/* Location photo or map-pin icon */}
                {(loc as any).photoUri ? (
                  <Image
                    source={{ uri: (loc as any).photoUri }}
                    style={{ width: 44, height: 44, borderRadius: 10, marginRight: 12 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: isSelected ? colors.primary + "20" : colors.primary + "12",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <IconSymbol name="location.fill" size={20} color={isSelected ? colors.primary : colors.muted} />
                  </View>
                )}
                <View style={styles.optionContent}>
                  <Text
                    className="text-base font-semibold"
                    style={{
                      color: isAvailable ? colors.foreground : colors.muted,
                    }}
                  >
                    {loc.name}
                  </Text>
                  {loc.address ? (
                    <Text className="text-xs text-muted mt-0.5" numberOfLines={2}>
                      {formatFullAddress(loc.address, loc.city, loc.state, loc.zipCode)}
                    </Text>
                  ) : null}
                  {!isOpen && (
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, gap: 6 }}>
                      {loc.temporarilyClosed && (
                        <View style={{ backgroundColor: colors.error + "20", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, color: colors.error, fontWeight: "700" }}>CLOSED</Text>
                        </View>
                      )}
                      <Text
                        style={{
                          fontSize: 11,
                          color: colors.error,
                          fontWeight: "600",
                        }}
                      >
                        {loc.temporarilyClosed ? "Temporarily closed" : "Closed on this day"}
                      </Text>
                    </View>
                  )}
                  {isOpen && !timeAvailable && preselectedTime && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: colors.warning,
                        marginTop: 2,
                        fontWeight: "600",
                      }}
                    >
                      {formatTimeDisplay(preselectedTime)} not available here
                    </Text>
                  )}
                </View>
                {isAvailable && (
                  <IconSymbol
                    name="chevron.right"
                    size={16}
                    color={colors.muted}
                  />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* ─── Step 4: Staff Selection ─── */}
      {step === 4 && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: hp }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <Pressable
              onPress={() => {
                if (needsLocationStep) setStep(3);
                else setStep(2);
              }}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <Text className="text-sm" style={{ color: colors.primary }}>
                ← Back
              </Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">
              Select Staff
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Skip option */}
          <Pressable
            onPress={() => {
              setSelectedStaffId(null);
              setStep(5);
            }}
            style={({ pressed }) => [
              styles.optionCard,
              {
                backgroundColor:
                  selectedStaffId === null ? colors.primary + "15" : colors.surface,
                borderColor:
                  selectedStaffId === null ? colors.primary : colors.border,
                opacity: pressed ? 0.7 : 1,
                marginBottom: 4,
              },
            ]}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.muted + "30" },
              ]}
            >
              <Text
                style={{ fontSize: 13, fontWeight: "700", color: colors.muted }}
              >
                Any
              </Text>
            </View>
            <View style={styles.optionContent}>
              <Text className="text-base font-semibold text-foreground">
                Any Available Staff
              </Text>
              <Text className="text-xs text-muted mt-0.5">
                No preference
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>

          {availableStaff.length === 0 ? (
            <View className="items-center py-8">
              <Text className="text-sm text-muted">No staff members found</Text>
            </View>
          ) : (
            availableStaff.map((member) => {
              // Staff in this list are already filtered to the selected location
              // Only check time availability here
              const isAvailable = staffAvailabilityMap[member.id] !== false;
              const isSelected = selectedStaffId === member.id;
              const unavailableReason = !isAvailable && preselectedTime
                ? `Busy at ${formatTimeDisplay(preselectedTime)}`
                : null;
              return (
                <Pressable
                  key={member.id}
                  onPress={() => {
                    if (!isAvailable) return;
                    setSelectedStaffId(member.id);
                    setStep(5);
                  }}
                  style={({ pressed }) => [
                    styles.optionCard,
                    {
                      backgroundColor: isSelected
                        ? (member.color || colors.primary) + "15"
                        : !isAvailable
                        ? colors.surface + "80"
                        : colors.surface,
                      borderColor: isSelected
                        ? (member.color || colors.primary)
                        : !isAvailable
                        ? colors.border + "60"
                        : colors.border,
                      opacity: !isAvailable ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {/* Staff photo or initials avatar */}
                  <View style={{ position: "relative", marginRight: 12 }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: (member.color || colors.primary) + "20",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        borderWidth: isSelected ? 2 : 0,
                        borderColor: member.color || colors.primary,
                      }}
                    >
                      {member.photoUri ? (
                        <Image
                          source={{ uri: member.photoUri }}
                          style={{ width: 44, height: 44, borderRadius: 22 }}
                        />
                      ) : (
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "700",
                            color: member.color || colors.primary,
                          }}
                        >
                          {getInitials(member.name)}
                        </Text>
                      )}
                    </View>
                    {/* Availability dot */}
                    <View
                      style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: preselectedTime
                          ? isAvailable
                            ? colors.success
                            : colors.muted
                          : colors.border,
                        borderWidth: 2,
                        borderColor: colors.background,
                      }}
                    />
                  </View>
                  <View style={styles.optionContent}>
                    <Text
                      className="text-base font-semibold"
                      style={{
                        color: isAvailable ? colors.foreground : colors.muted,
                      }}
                    >
                      {member.name}
                    </Text>
                    {member.role ? (
                      <Text className="text-xs text-muted mt-0.5">{member.role}</Text>
                    ) : null}
                    {unavailableReason && (
                      <Text
                        style={{
                          fontSize: 11,
                          color: colors.warning,
                          marginTop: 2,
                          fontWeight: "600",
                        }}
                      >
                        {unavailableReason}
                      </Text>
                    )}
                  </View>
                  {isAvailable && (
                    <IconSymbol
                      name="chevron.right"
                      size={16}
                      color={colors.muted}
                    />
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ─── Step 5: Review & Add More ─── */}
      {step === 5 && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40 }}
        >
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              onPress={() => {
                if (cart.length > 0) {
                  Alert.alert(
                    "Go Back?",
                    "Going back will clear the extra items you added to the cart. Continue?",
                    [
                      { text: "Stay", style: "cancel" },
                      { text: "Go Back & Clear", style: "destructive", onPress: () => { setCart([]); setStep(4); } },
                    ]
                  );
                } else {
                  setStep(4);
                }
              }}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <Text className="text-sm" style={{ color: colors.primary }}>← Back</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Review & Add More</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Booking Summary Card */}
          <View style={{ backgroundColor: colors.primary + "10", borderRadius: 14, borderWidth: 1, borderColor: colors.primary + "30", padding: 14, marginBottom: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Booking Summary</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <IconSymbol name="calendar" size={14} color={colors.primary} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                {formatDateDisplay(preselectedDate)}{preselectedTime ? ` · ${formatTimeDisplay(preselectedTime)}` : ""}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <IconSymbol name="clock" size={14} color={colors.muted} />
              <Text style={{ fontSize: 12, color: colors.muted }}>Total duration: {totalDuration} min</Text>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.primary + "20", paddingTop: 8, gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, color: colors.muted }}>Subtotal</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>${subtotal.toFixed(2)}</Text>
              </View>
              {(appliedDiscount && discountAmount > 0) && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: colors.warning }}>{appliedDiscount.name} ({appliedDiscount.percentage}% off)</Text>
                  <Text style={{ fontSize: 13, color: colors.warning }}>-${discountAmount.toFixed(2)}</Text>
                </View>
              )}
              {(appliedManualDiscount && manualDiscountAmount > 0) && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: colors.warning }}>{appliedManualDiscount.name} ({appliedManualDiscount.percentage}% off)</Text>
                  <Text style={{ fontSize: 13, color: colors.warning }}>-${manualDiscountAmount.toFixed(2)}</Text>
                </View>
              )}
              {appliedPromoCode && promoDiscountAmount > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: colors.success }}>Promo: {appliedPromoCode.code}</Text>
                  <Text style={{ fontSize: 13, color: colors.success }}>-${promoDiscountAmount.toFixed(2)}</Text>
                </View>
              )}
              {/* Total savings line — only shown when 2+ discount types are stacked */}
              {(() => {
                const activeDiscountCount = [discountAmount > 0, manualDiscountAmount > 0, promoDiscountAmount > 0].filter(Boolean).length;
                const totalSavings = discountAmount + manualDiscountAmount + promoDiscountAmount;
                if (activeDiscountCount < 2 || totalSavings <= 0) return null;
                return (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.success + "30" }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.success }}>Total savings</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.success }}>-${totalSavings.toFixed(2)}</Text>
                  </View>
                );
              })()}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4, borderTopWidth: 1, borderTopColor: colors.primary + "20", paddingTop: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Amount Due</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: colors.primary }}>${totalPrice.toFixed(2)}</Text>
              </View>
            </View>
          </View>

          {/* Cart Summary */}
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 16 }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 12 }}>Booking Items</Text>

            {/* All selected services — editable list with remove buttons */}
            {selectedServices.map((svc, idx) => {
              const svcData = state.services.find((s) => s.id === svc.id);
              return (
                <View key={svc.id + idx} style={styles.cartItem}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: svcData?.color ?? colors.primary, marginRight: 8 }} />
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{svc.name}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 18 }}>{svc.duration} min</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>${svc.price.toFixed(2)}</Text>
                    {selectedServices.length > 1 && (
                      <Pressable
                        onPress={() => setSelectedServices((prev) => prev.filter((_, i) => i !== idx))}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                      >
                        <IconSymbol name="xmark" size={16} color={colors.error} />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Cart Items */}
            {cart.map((item, index) => (
              <View key={`${item.type}-${item.id}-${index}`} style={styles.cartItem}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    {item.type === "product" ? "Product" : `${item.duration} min`}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>${item.price.toFixed(2)}</Text>
                  <Pressable
                    onPress={() => removeFromCart(index)}
                    style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                  >
                    <IconSymbol name="xmark" size={16} color={colors.error} />
                  </Pressable>
                </View>
              </View>
            ))}

            {/* Discount */}
            {((appliedDiscount && discountAmount > 0) || manualDiscountAmount > 0) && (
              <>
                <View style={[styles.cartItem, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 8 }]}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>Subtotal</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>${subtotal.toFixed(2)}</Text>
                </View>
                {appliedDiscount && discountAmount > 0 && (
                  <View style={styles.cartItem}>
                    <Text style={{ fontSize: 13, fontWeight: "500", color: colors.warning }}>{appliedDiscount.name} ({appliedDiscount.percentage}% off)</Text>
                    <Text style={{ fontSize: 13, fontWeight: "500", color: colors.warning }}>-${discountAmount.toFixed(2)}</Text>
                  </View>
                )}
                {manualDiscountAmount > 0 && appliedManualDiscount && (
                  <View style={styles.cartItem}>
                    <Text style={{ fontSize: 13, fontWeight: "500", color: colors.warning }}>{appliedManualDiscount.name} ({appliedManualDiscount.percentage}% off)</Text>
                    <Text style={{ fontSize: 13, fontWeight: "500", color: colors.warning }}>-${manualDiscountAmount.toFixed(2)}</Text>
                  </View>
                )}
              </>
            )}

            {/* Promo code row */}
            {appliedPromoCode && promoDiscountAmount > 0 && (
              <View style={styles.cartItem}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.success }}>Promo — {appliedPromoCode.code}</Text>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.success }}>-${promoDiscountAmount.toFixed(2)}</Text>
              </View>
            )}
            {/* Total savings line — only shown when 2+ discount types are stacked */}
            {(() => {
              const activeDiscountCount = [discountAmount > 0, manualDiscountAmount > 0, promoDiscountAmount > 0].filter(Boolean).length;
              const totalSavings = discountAmount + manualDiscountAmount + promoDiscountAmount;
              if (activeDiscountCount < 2 || totalSavings <= 0) return null;
              return (
                <View style={[styles.cartItem, { borderTopWidth: 1, borderTopColor: colors.success + "30", marginTop: 2, paddingTop: 6 }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.success }}>Total savings</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.success }}>-${totalSavings.toFixed(2)}</Text>
                </View>
              );
            })()}
            {/* Promo Code + Discount buttons — separate */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 6, marginBottom: 2 }}>
              <Pressable
                onPress={() => setShowPromoSheet(true)}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.success + "15", borderWidth: 1, borderColor: colors.success + "40" })}
              >
                <IconSymbol name="tag.fill" size={12} color={colors.success} />
                <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>
                  {appliedPromoCode ? `Promo: ${appliedPromoCode.code}` : "Add Promo Code"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowDiscountPickerSheet(true)}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.warning + "15", borderWidth: 1, borderColor: colors.warning + "40" })}
              >
                <IconSymbol name="percent" size={12} color={colors.warning} />
                <Text style={{ fontSize: 12, color: colors.warning, fontWeight: "600" }}>
                  {appliedManualDiscount ? appliedManualDiscount.name : "Add Discount"}
                </Text>
              </Pressable>
            </View>

            {/* Total */}
            <View style={[styles.cartItem, { borderTopWidth: 2, borderTopColor: colors.border, marginTop: 4, paddingTop: 10 }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Total ({totalDuration} min)</Text>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>${totalPrice.toFixed(2)}</Text>
            </View>
          </View>

          {/* Add More Section */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, marginLeft: 2 }}>Add More (Optional)</Text>

          {/* Segmented Control */}
          <View style={[styles.segControl, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              onPress={() => setAddMoreTab("services")}
              style={[styles.segBtn, addMoreTab === "services" && { backgroundColor: colors.primary }]}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: addMoreTab === "services" ? "#FFF" : colors.muted }}>Services</Text>
            </Pressable>
            <Pressable
              onPress={() => setAddMoreTab("products")}
              style={[styles.segBtn, addMoreTab === "products" && { backgroundColor: colors.primary }]}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: addMoreTab === "products" ? "#FFF" : colors.muted }}>Products</Text>
            </Pressable>
          </View>

          {/* Extra Services — collapsible by category */}
          {addMoreTab === "services" && (
            <View style={{ marginBottom: 16 }}>
              {availableExtraServices.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 24, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>No additional services available</Text>
                </View>
              ) : (() => {
                const catGroups = new Map<string, typeof availableExtraServices>();
                availableExtraServices.forEach((s) => {
                  const cat = s.category?.trim() || "General";
                  if (!catGroups.has(cat)) catGroups.set(cat, []);
                  catGroups.get(cat)!.push(s);
                });
                const catEntries = Array.from(catGroups.entries()).sort((a, b) => {
                  if (a[0] === "General") return 1;
                  if (b[0] === "General") return -1;
                  return a[0].localeCompare(b[0]);
                });
                const hasMultiCat = catEntries.length > 1;
                return (
                  <View>
                    {catEntries.map(([cat, svcs]) => {
                      const isExpanded = !hasMultiCat || addMoreCategoryFilter === cat;
                      return (
                        <View key={cat}>
                          {hasMultiCat && (
                            <Pressable
                              onPress={() => setAddMoreCategoryFilter(isExpanded ? null : cat)}
                              style={({ pressed }) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                paddingVertical: 12,
                                paddingHorizontal: 14,
                                backgroundColor: isExpanded ? colors.primary + "12" : colors.surface,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: isExpanded ? colors.primary + "40" : colors.border,
                                marginBottom: 4,
                                opacity: pressed ? 0.7 : 1,
                              })}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <Text style={{ fontSize: 14, fontWeight: "700", color: isExpanded ? colors.primary : colors.foreground }}>{cat}</Text>
                                <View style={{ backgroundColor: colors.primary + "20", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{svcs.length}</Text>
                                </View>
                              </View>
                              <IconSymbol name={isExpanded ? "chevron.down" : "chevron.right"} size={14} color={isExpanded ? colors.primary : colors.muted} />
                            </Pressable>
                          )}
                          {isExpanded && svcs.map((s) => {
                            // Disable add-on if total duration (primary + cart + this add-on) exceeds closing time.
                            // Buffer between stacked services is ignored — only buffer after the last service matters.
                            const addOnTotalDuration = totalDuration + s.duration;
                            const addOnEndMin = preselectedTime ? timeToMinutes(preselectedTime) + addOnTotalDuration : null;
                            const addOnDisabled = s.duration > 0 && closingTimeMin !== null && addOnEndMin !== null && addOnEndMin > closingTimeMin;
                            return (
                              <Pressable
                                key={s.id}
                                onPress={() => {
                                  if (addOnDisabled) return;
                                  addToCart({ type: "service", id: s.id, name: s.name, price: parseFloat(String(s.price)), duration: s.duration });
                                }}
                                style={({ pressed }) => [styles.optionCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: addOnDisabled ? 0.4 : pressed ? 0.7 : 1, marginLeft: hasMultiCat ? 8 : 0 }]}
                              >
                                {s.photoUri ? (
                                  <Image source={{ uri: s.photoUri }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12 }} />
                                ) : (
                                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color, marginRight: 12 }} />
                                )}
                                <View style={styles.optionContent}>
                                  <Text style={{ fontSize: 14, fontWeight: "600", color: addOnDisabled ? colors.muted : colors.foreground }}>{s.name}</Text>
                                  <Text style={{ fontSize: 12, color: colors.muted }}>{s.duration} min</Text>
                                  {addOnDisabled && (
                                    <Text style={{ fontSize: 11, color: colors.error, marginTop: 2 }}>⚠️ Exceeds closing time</Text>
                                  )}
                                </View>
                                {addOnDisabled ? (
                                  <IconSymbol name="lock.fill" size={14} color={colors.muted} />
                                ) : (
                                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>+ ${parseFloat(String(s.price)).toFixed(2)}</Text>
                                )}
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                );
              })()}
            </View>
          )}

          {/* Products — collapsible by brand */}
          {addMoreTab === "products" && (
            <View style={{ marginBottom: 16 }}>
              {availableProducts.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 24, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>No products available</Text>
                </View>
              ) : (() => {
                const brandGroups = new Map<string, typeof availableProducts>();
                availableProducts.forEach((p) => {
                  const brand = (p as any).brand?.trim() || "Other";
                  if (!brandGroups.has(brand)) brandGroups.set(brand, []);
                  brandGroups.get(brand)!.push(p);
                });
                const brandEntries = Array.from(brandGroups.entries()).sort((a, b) => {
                  if (a[0] === "Other") return 1;
                  if (b[0] === "Other") return -1;
                  return a[0].localeCompare(b[0]);
                });
                const hasMultiBrand = brandEntries.length > 1;
                return (
                  <View>
                    {brandEntries.map(([brand, prods]) => {
                      const isExpanded = !hasMultiBrand || addMoreBrandFilter === brand;
                      return (
                        <View key={brand}>
                          {hasMultiBrand && (
                            <Pressable
                              onPress={() => setAddMoreBrandFilter(isExpanded ? null : brand)}
                              style={({ pressed }) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                paddingVertical: 12,
                                paddingHorizontal: 14,
                                backgroundColor: isExpanded ? colors.primary + "12" : colors.surface,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: isExpanded ? colors.primary + "40" : colors.border,
                                marginBottom: 4,
                                opacity: pressed ? 0.7 : 1,
                              })}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <Text style={{ fontSize: 14, fontWeight: "700", color: isExpanded ? colors.primary : colors.foreground }}>{brand}</Text>
                                <View style={{ backgroundColor: colors.primary + "20", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{prods.length}</Text>
                                </View>
                              </View>
                              <IconSymbol name={isExpanded ? "chevron.down" : "chevron.right"} size={14} color={isExpanded ? colors.primary : colors.muted} />
                            </Pressable>
                          )}
                          {isExpanded && prods.map((p) => (
                            <Pressable
                              key={p.id}
                              onPress={() => addToCart({ type: "product", id: p.id, name: p.name, price: parseFloat(String(p.price)), duration: 0 })}
                              style={({ pressed }) => [styles.optionCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1, marginLeft: hasMultiBrand ? 8 : 0 }]}
                            >
                              {(p as any).photoUri ? (
                                <Image source={{ uri: (p as any).photoUri }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12 }} />
                              ) : (
                                <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                                  <IconSymbol name="bag.fill" size={18} color={colors.primary} />
                                </View>
                              )}
                              <View style={styles.optionContent}>
                                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{p.name}</Text>
                                {(p as any).description ? <Text style={{ fontSize: 12, color: colors.muted }}>{(p as any).description}</Text> : null}
                              </View>
                              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>+ ${parseFloat(String(p.price)).toFixed(2)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      );
                    })}
                  </View>
                );
              })()}
            </View>
          )}

          {/* Continue to Payment */}
          <Pressable
            onPress={() => setStep(6)}
            style={({ pressed }) => [
              styles.confirmBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Continue to Payment →</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ─── Step 6: Payment Method ─── */}
      {step === 6 && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40 }}
        >
          <View className="flex-row items-center justify-between mb-3">
            <Pressable onPress={() => setStep(5)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
              <Text className="text-sm" style={{ color: colors.primary }}>← Back</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Payment Method</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Amount Due */}
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 16 }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 4 }}>Amount Due</Text>
            <Text style={{ fontSize: 28, fontWeight: "700", color: colors.primary }}>${totalPrice.toFixed(2)}</Text>
            {selectedService && (
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                {selectedService.name}{cart.length > 0 ? ` + ${cart.length} extra item${cart.length > 1 ? "s" : ""}` : ""}
              </Text>
            )}
          </View>

          {/* Payment Options */}
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 16 }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 12 }}>How will the client pay?</Text>
            {(() => {
              const pm = state.settings;
              const opts: { id: string; label: string; sub: string; color: string }[] = [];
              if ((pm as any).zelleHandle) opts.push({ id: "zelle", label: "💜 Zelle", sub: (pm as any).zelleHandle, color: "#6d28d9" });
              if ((pm as any).cashAppHandle) opts.push({ id: "cashapp", label: "💚 Cash App", sub: (pm as any).cashAppHandle.startsWith("$") ? (pm as any).cashAppHandle : "$" + (pm as any).cashAppHandle, color: "#00d632" });
              if ((pm as any).venmoHandle) opts.push({ id: "venmo", label: "💙 Venmo", sub: (pm as any).venmoHandle.startsWith("@") ? (pm as any).venmoHandle : "@" + (pm as any).venmoHandle, color: "#3d95ce" });
              opts.push({ id: "cash", label: "💵 Cash", sub: "Collect in person", color: "#888" });
              // Add Stripe card payment option if available on this plan
              if (isStripePlan && !!(state.settings as any).stripeConnectEnabled) {
                opts.push({ id: "card", label: "💳 Pay by Card", sub: "Client pays via secure Stripe link", color: "#6366f1" });
              }
              return opts.map((opt) => (
                <Pressable
                  key={opt.id}
                  onPress={() => setSelectedPaymentMethod(opt.id)}
                  style={[{
                    flexDirection: "row", alignItems: "center", gap: 12,
                    padding: 14, borderRadius: 14, marginBottom: 8,
                    borderWidth: 2,
                    borderColor: selectedPaymentMethod === opt.id ? opt.color : colors.border,
                    backgroundColor: selectedPaymentMethod === opt.id ? opt.color + "18" : colors.background,
                  }]}
                >
                  <Text style={{ fontSize: 22 }}>{opt.label.split(" ")[0]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600", fontSize: 14, color: colors.foreground }}>{opt.label.slice(opt.label.indexOf(" ") + 1)}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{opt.sub}</Text>
                  </View>
                  {selectedPaymentMethod === opt.id && (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: opt.color, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓</Text>
                    </View>
                  )}
                </Pressable>
              ));
            })()}
          </View>

          {/* Continue to Confirm */}
          <Pressable
            onPress={() => {
              if (!selectedPaymentMethod) {
                Alert.alert("Payment Method", "Please select a payment method to continue.");
                return;
              }
              setStep(7);
            }}
            style={({ pressed }) => [
              styles.confirmBtn,
              { backgroundColor: selectedPaymentMethod ? colors.primary : colors.muted, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Continue →</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ─── Step 7: Confirm ─── */}
      {step === 7 && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: hp }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <Pressable
              onPress={() => setStep(6)}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <Text className="text-sm" style={{ color: colors.primary }}>
                ← Back
              </Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">
              Confirm Booking
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Summary card — professional receipt style */}
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Package session count banner */}
            {(() => {
              const pkgCartItem = selectedServices.find((s) => s.type === "package");
              if (!pkgCartItem) return null;
              const pkg = (state.packages ?? []).find((p: any) => p.id === pkgCartItem.packageId);
              const totalSessions = pkg?.sessions ?? packageSessions.length;
              const scheduledCount = packageSessions.length;
              const isComplete = scheduledCount === totalSessions;
              return (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.primary + "18", borderRadius: 10, padding: 12, marginBottom: 14 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary + "28", alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="calendar" size={17} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>
                      {scheduledCount} of {totalSessions} session{totalSessions !== 1 ? "s" : ""} will be scheduled
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{pkgCartItem.name}</Text>
                  </View>
                  {isComplete && (
                    <View style={{ backgroundColor: colors.success + "22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.success }}>Complete ✓</Text>
                    </View>
                  )}
                </View>
              );
            })()}
            {/* Services header — show all selected services */}
            {selectedServices.length > 0 && (
              <View style={{ marginBottom: 14 }}>
                {selectedServices.map((svc, idx) => {
                  const svcData = state.services.find((s) => s.id === svc.id);
                  return (
                    <View key={svc.id + idx} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: idx < selectedServices.length - 1 ? 6 : 0 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: svcData?.color ?? colors.primary }} />
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, flex: 1 }}>{svc.name}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{svc.duration} min</Text>
                    </View>
                  );
                })}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
                  <View style={{ backgroundColor: colors.primary + "18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{totalDuration} min total</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Section label */}
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Details</Text>

            {/* Package sessions list (multi-session packages) */}
            {packageSessions.length > 0 ? (
              <View style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="calendar" size={15} color={colors.primary} />
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{packageSessions.length} Session{packageSessions.length !== 1 ? "s" : ""} Scheduled</Text>
                </View>
                {packageSessions.map((s, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 38, marginBottom: 4 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.success + "20", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.success }}>{i + 1}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: colors.foreground }}>{formatDateDisplay(s.date)}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>· {formatTimeDisplay(s.time)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              /* Date + Time row (single session) */
              <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="calendar" size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{formatDateDisplay(preselectedDate)}</Text>
                  {preselectedTime && (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
                      {formatTimeDisplay(preselectedTime)}{" – "}{getEndTime(preselectedTime)}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Client row */}
            {selectedClient && (
              <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="person.fill" size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedClient.name}</Text>
                  {selectedClient.phone ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{formatPhoneNumber(selectedClient.phone)}</Text> : null}
                </View>
              </View>
            )}

            {/* Location row with tappable full address */}
            {selectedLocation && (() => {
              const fullAddr = formatFullAddress(selectedLocation.address, selectedLocation.city, selectedLocation.state, selectedLocation.zipCode);
              const mapUrl = fullAddr ? getMapUrl(fullAddr) : null;
              return (
                <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="location.fill" size={15} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedLocation.name}</Text>
                    {fullAddr ? (
                      <Pressable
                        onPress={() => mapUrl && Linking.openURL(mapUrl)}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text style={{ fontSize: 12, color: colors.primary, marginTop: 1, textDecorationLine: "underline" }} numberOfLines={2}>
                          {fullAddr}
                        </Text>
                      </Pressable>
                    ) : null}
                    {selectedLocation.phone ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{selectedLocation.phone}</Text> : null}
                  </View>
                </View>
              );
            })()}

            {/* Staff row with photo */}
            {selectedStaffId && (() => {
              const staff = state.staff.find((s) => s.id === selectedStaffId);
              return staff ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 10 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: (staff.color ?? colors.primary) + "20", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {staff.photoUri ? (
                      <Image source={{ uri: staff.photoUri }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                    ) : (
                      <Text style={{ color: staff.color ?? colors.primary, fontSize: 12, fontWeight: "700" }}>{staff.name.charAt(0).toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{staff.name}</Text>
                    {staff.role ? <Text style={{ fontSize: 11, color: colors.muted }}>{staff.role}</Text> : null}
                  </View>
                </View>
              ) : null;
            })()}

            {/* Payment row */}
            {selectedPaymentMethod && (
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="creditcard.fill" size={15} color={colors.primary} />
                </View>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                  {selectedPaymentMethod === "zelle" ? "Zelle" : selectedPaymentMethod === "cashapp" ? "Cash App" : selectedPaymentMethod === "venmo" ? "Venmo" : "Cash"}
                </Text>
              </View>
            )}

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />

            {/* Pricing section */}
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Pricing</Text>
            {/* Always show line items — use subtotal > 0 instead of servicePrice > 0 so packages show correctly */}
            {selectedServices.map((svc, idx) => (
              <SummaryRow key={svc.id + idx} label={svc.name} value={`$${svc.price.toFixed(2)}`} colors={colors} />
            ))}
            {cart.length > 0 && cart.map((item) => (
              <SummaryRow key={item.id} label={item.name} value={`$${item.price.toFixed(2)}`} colors={colors} />
            ))}
            {appliedDiscount && discountAmount > 0 && (
              <SummaryRow label={`Discount — ${appliedDiscount.name}`} value={`-$${discountAmount.toFixed(2)}`} colors={colors} valueColor={colors.success} />
            )}
            {appliedManualDiscount && manualDiscountAmount > 0 && (
              <SummaryRow label={`Discount — ${appliedManualDiscount.name}`} value={`-$${manualDiscountAmount.toFixed(2)}`} colors={colors} valueColor={colors.success} />
            )}
            {appliedPromoCode && promoDiscountAmount > 0 && (
              <SummaryRow
                label={`Promo — ${appliedPromoCode.code}`}
                value={`-$${promoDiscountAmount.toFixed(2)}`}
                colors={colors}
                valueColor={colors.success}
              />
            )}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Total</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.primary }}>${totalPrice.toFixed(2)}</Text>
            </View>
          </View>

          {/* Notes */}
          <View style={{ marginTop: 12 }}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: colors.foreground,
                marginBottom: 6,
              }}
            >
              Notes (optional)
            </Text>
            <TextInput
              multiline
              numberOfLines={3}
              placeholder="Add any notes..."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              style={[
                styles.notesInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
          </View>

          {/* Promo Code */}
          <View style={{ marginTop: 12 }}>
            {!appliedPromoCode ? (
              <Pressable
                onPress={() => setShowPromoField(!showPromoField)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 })}
              >
                <IconSymbol name="tag.fill" size={14} color={colors.primary} />
                <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>
                  {showPromoField ? "Hide promo code" : "Have a promo code?"}
                </Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.success + "18", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <IconSymbol name="tag.fill" size={14} color={colors.success} />
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.success }}>{appliedPromoCode.code}</Text>
                  <Text style={{ fontSize: 12, color: colors.success }}>applied</Text>
                </View>
                <Pressable
                  onPress={() => { setAppliedPromoCode(null); setPromoInput(""); setPromoError(null); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <IconSymbol name="xmark" size={14} color={colors.success} />
                </Pressable>
              </View>
            )}
            {showPromoField && !appliedPromoCode && (
              <View style={{ marginTop: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    value={promoInput}
                    onChangeText={(t) => { setPromoInput(t.toUpperCase()); setPromoError(null); }}
                    placeholder="Enter promo code"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    returnKeyType="done"
                    style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: promoError ? colors.error : colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.foreground, fontWeight: "600", letterSpacing: 1 }}
                  />
                  <Pressable
                    onPress={() => {
                      const code = promoInput.trim().toUpperCase();
                      if (!code) { setPromoError("Please enter a promo code."); return; }
                      const now = new Date();
                      const match = (state.promoCodes ?? []).find((p) => p.code.toUpperCase() === code && p.active);
                      if (!match) { setPromoError("Invalid or inactive promo code."); return; }
                      if (match.expiresAt && new Date(match.expiresAt) < now) { setPromoError("This promo code has expired."); return; }
                      if (match.maxUses != null && match.usedCount >= match.maxUses) { setPromoError("This promo code has reached its usage limit."); return; }
                      setAppliedPromoCode(match);
                      setShowPromoField(false);
                      setPromoError(null);
                    }}
                    style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>Apply</Text>
                  </Pressable>
                </View>
                {promoError && <Text style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>{promoError}</Text>}
              </View>
            )}
          </View>

          {/* Confirm Button */}
          <Pressable
            onPress={handleBook}
            disabled={requestingCardPayment}
            style={({ pressed }) => [
              styles.confirmBtn,
              { backgroundColor: colors.primary, opacity: pressed || requestingCardPayment ? 0.7 : 1 },
            ]}
          >
            <IconSymbol name="checkmark" size={18} color="#FFF" />
            <Text
              style={{
                color: "#FFF",
                fontSize: 16,
                fontWeight: "700",
                marginLeft: 8,
              }}
            >
              {requestingCardPayment ? "Processing..." : "Confirm Booking"}
            </Text>
          </Pressable>

          {/* Add to Calendar button */}
          {(() => {
            const hasDate = !!preselectedDate && !!preselectedTime;
            if (!hasDate) return null;
            const handleAddToCalendar = async () => {
              try {
                const Calendar = await import("expo-calendar");
                const { status } = await Calendar.requestCalendarPermissionsAsync();
                if (status !== "granted") {
                  Alert.alert("Permission Denied", "Calendar access is required to add this appointment.");
                  return;
                }
                const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
                const defaultCal = calendars.find((c) => c.allowsModifications) ?? calendars[0];
                if (!defaultCal) {
                  Alert.alert("No Calendar", "No writable calendar found on this device.");
                  return;
                }
                const [year, month, day] = preselectedDate.split("-").map(Number);
                const [startH, startM] = preselectedTime.split(":").map(Number);
                const startDate = new Date(year, month - 1, day, startH, startM, 0);
                const endDate = new Date(startDate.getTime() + totalDuration * 60 * 1000);
                const locationStr = selectedLocation
                  ? [selectedLocation.name, formatFullAddress(selectedLocation.address, selectedLocation.city, selectedLocation.state, selectedLocation.zipCode)].filter(Boolean).join(" — ")
                  : undefined;
                await Calendar.createEventAsync(defaultCal.id, {
                  title: selectedService ? `${selectedService.name}${selectedClient ? " — " + selectedClient.name : ""}` : "Appointment",
                  startDate,
                  endDate,
                  location: locationStr,
                  notes: notes || undefined,
                  alarms: [{ relativeOffset: -60 }],
                });
                Alert.alert("Added to Calendar", "The appointment has been added to your calendar.");
              } catch (e) {
                Alert.alert("Error", "Could not add to calendar. Please try again.");
              }
            };
            return (
              <Pressable
                onPress={handleAddToCalendar}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginTop: 10,
                  paddingVertical: 13,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: colors.primary,
                  backgroundColor: colors.primary + "12",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <IconSymbol name="calendar" size={16} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>Add to Calendar</Text>
              </Pressable>
            );
          })()}

          {selectedClient?.phone && (
            <Text
              style={{
                fontSize: 12,
                color: colors.muted,
                textAlign: "center",
                marginTop: 8,
              }}
            >
              A confirmation SMS will be sent to {selectedClient.name}
            </Text>
          )}
        </ScrollView>
      )}
      {/* Discount / Promo Bottom Sheet */}
      <Modal
        visible={showDiscountSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDiscountSheet(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowDiscountSheet(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>
              Promo / Discount
            </Text>

            {/* Currently applied promo */}
            {appliedPromoCode && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.success + "18", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.success, letterSpacing: 1 }}>{appliedPromoCode.code}</Text>
                  <Text style={{ fontSize: 13, color: colors.success }}>applied</Text>
                </View>
                <Pressable
                  onPress={() => { setAppliedPromoCode(null); setPromoInput(""); setPromoError(null); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.error }}>Remove</Text>
                </Pressable>
              </View>
            )}

            {/* Promo code input */}
            <TextInput
              value={promoInput}
              onChangeText={(t) => { setPromoInput(t.toUpperCase()); setPromoError(null); }}
              placeholder={appliedPromoCode ? "Enter a different promo code" : "Enter promo code"}
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              returnKeyType="done"
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: promoError ? colors.error : colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.foreground, fontWeight: "600", letterSpacing: 1, marginBottom: 8 }}
            />
            {promoError && (
              <Text style={{ fontSize: 12, color: colors.error, marginBottom: 8 }}>{promoError}</Text>
            )}

            {/* Apply button */}
            <Pressable
              onPress={() => {
                const code = promoInput.trim().toUpperCase();
                if (!code) { setPromoError("Please enter a promo code."); return; }
                const now = new Date();
                const match = (state.promoCodes ?? []).find((p) => p.code.toUpperCase() === code && p.active);
                if (!match) { setPromoError("Invalid or inactive promo code."); return; }
                if (match.expiresAt && new Date(match.expiresAt) < now) { setPromoError("This promo code has expired."); return; }
                if (match.maxUses != null && match.usedCount >= match.maxUses) { setPromoError("This promo code has reached its usage limit."); return; }
                setAppliedPromoCode(match);
                setPromoInput("");
                setPromoError(null);
                setShowDiscountSheet(false);
              }}
              style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center", marginBottom: 10, opacity: pressed ? 0.8 : 1 })}
            >
              <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 15 }}>Apply</Text>
            </Pressable>

            {/* Cancel */}
            <Pressable
              onPress={() => { setPromoError(null); setShowDiscountSheet(false); }}
              style={({ pressed }) => ({ alignItems: "center", paddingVertical: 10, opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {/* Promo Code Picker Sheet — shows list of active user promo codes */}
      <Modal
        visible={showPromoSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPromoSheet(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowPromoSheet(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: "70%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Select Promo Code</Text>
              <Pressable onPress={() => setShowPromoSheet(false)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <IconSymbol name="xmark" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* Currently applied */}
            {appliedPromoCode && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.success + "18", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <IconSymbol name="tag.fill" size={14} color={colors.success} />
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.success, letterSpacing: 1 }}>{appliedPromoCode.code}</Text>
                  <Text style={{ fontSize: 12, color: colors.success }}>applied</Text>
                </View>
                <Pressable
                  onPress={() => { setAppliedPromoCode(null); setPromoInput(""); setPromoError(null); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.error }}>Remove</Text>
                </Pressable>
              </View>
            )}

            {/* List of active promo codes */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
              {(state.promoCodes ?? []).filter((p) => p.active).length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>No active promo codes available.{"\n"}Create promo codes in Settings.</Text>
                </View>
              ) : (
                (state.promoCodes ?? []).filter((p) => {
                  if (!p.active) return false;
                  if (p.expiresAt && new Date(p.expiresAt) < new Date()) return false;
                  if (p.maxUses != null && p.usedCount >= p.maxUses) return false;
                  return true;
                }).map((promo) => {
                  const isSelected = appliedPromoCode?.code === promo.code;
                  const discountLabel = promo.percentage ? `${promo.percentage}% off` : promo.flatAmount ? `-$${promo.flatAmount.toFixed(2)}` : "";
                  return (
                    <Pressable
                      key={promo.code}
                      onPress={() => {
                        setAppliedPromoCode(promo);
                        setPromoInput("");
                        setPromoError(null);
                        setShowPromoSheet(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                        paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginBottom: 8,
                        backgroundColor: isSelected ? colors.success + "18" : colors.background,
                        borderWidth: 1.5, borderColor: isSelected ? colors.success : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: isSelected ? colors.success : colors.foreground, letterSpacing: 0.5 }}>{promo.code}</Text>
                        {promo.label ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{promo.label}</Text> : null}
                        {promo.expiresAt ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>Expires {new Date(promo.expiresAt).toLocaleDateString()}</Text> : null}
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        {discountLabel ? <Text style={{ fontSize: 13, fontWeight: "700", color: isSelected ? colors.success : colors.primary }}>{discountLabel}</Text> : null}
                        {promo.maxUses != null && (
                          <Text style={{ fontSize: 10, color: colors.muted }}>{promo.usedCount ?? 0}/{promo.maxUses} uses</Text>
                        )}
                        {isSelected && <IconSymbol name="checkmark.circle.fill" size={18} color={colors.success} />}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              onPress={() => setShowPromoSheet(false)}
              style={({ pressed }) => ({ alignItems: "center", paddingVertical: 12, marginTop: 8, opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Discount Picker Sheet — shows list of user-created discounts */}
      <Modal
        visible={showDiscountPickerSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDiscountPickerSheet(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowDiscountPickerSheet(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: "70%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Select Discount</Text>
              <Pressable onPress={() => setShowDiscountPickerSheet(false)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <IconSymbol name="xmark" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* Currently applied manual discount */}
            {appliedManualDiscount && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.warning + "18", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <IconSymbol name="percent" size={14} color={colors.warning} />
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.warning }}>{appliedManualDiscount.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.warning }}>applied</Text>
                </View>
                <Pressable
                  onPress={() => setAppliedManualDiscount(null)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.error }}>Remove</Text>
                </Pressable>
              </View>
            )}

            {/* List of user-created discounts */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
              {(state.discounts ?? []).filter((d) => d.active !== false).length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>No discounts available.{"\n"}Create discounts in Settings.</Text>
                </View>
              ) : (
                (state.discounts ?? []).filter((d) => d.active !== false).map((disc) => {
                  const isSelected = appliedManualDiscount?.id === disc.id;
                  return (
                    <Pressable
                      key={disc.id}
                      onPress={() => {
                        setAppliedManualDiscount(isSelected ? null : disc);
                        setShowDiscountPickerSheet(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                        paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginBottom: 8,
                        backgroundColor: isSelected ? colors.warning + "18" : colors.background,
                        borderWidth: 1.5, borderColor: isSelected ? colors.warning : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: isSelected ? colors.warning : colors.foreground }}>{disc.name}</Text>
                        {(disc as any).description ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={2}>{(disc as any).description}</Text> : null}
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: isSelected ? colors.warning : colors.primary }}>{disc.percentage}% off</Text>
                        {isSelected && <IconSymbol name="checkmark.circle.fill" size={18} color={colors.warning} />}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              onPress={() => setShowDiscountPickerSheet(false)}
              style={({ pressed }) => ({ alignItems: "center", paddingVertical: 12, marginTop: 8, opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

// Helper component for summary rows
function SummaryRow({
  label,
  value,
  colors,
  bold,
  valueColor,
}: {
  label: string;
  value: string;
  colors: any;
  bold?: boolean;
  valueColor?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          color: colors.muted,
          fontWeight: bold ? "700" : "400",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 13,
          color: valueColor ?? colors.foreground,
          fontWeight: bold ? "700" : "500",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  optionContent: {
    flex: 1,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  summaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 16,
    gap: 8,
  },
  cartItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  segControl: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    marginBottom: 12,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
    height: 34,
    justifyContent: "center",
    alignItems: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 36,
  },
});
