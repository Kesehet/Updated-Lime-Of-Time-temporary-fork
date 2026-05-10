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
  Modal,
  Image,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId, formatDateStr, formatTime, formatDateDisplay } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Appointment, Client, Product, Discount, DAYS_OF_WEEK, DEFAULT_WORKING_HOURS, generateAvailableSlots, minutesToTime, timeToMinutes, getApplicableDiscount, generateConfirmationMessage, getServiceDisplayName, stripPhoneFormat, timeSlotsOverlap, PUBLIC_BOOKING_URL, formatPhoneNumber, formatFullAddress } from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useStripe } from "@/lib/use-stripe";
import { apiCall } from "@/lib/_core/api";


type Step = 1 | 2 | 3 | 4 | 5;

type CartItem = {
  type: "service" | "product" | "package";
  id: string;
  /** For packages: the package id */
  packageId?: string;
  /** For packages: the list of included service ids */
  packageServiceIds?: string[];
  name: string;
  price: number;
  duration: number;
};

export default function NewBookingScreen() {
  const { state, dispatch, getServiceById, getClientById, getLocationById, syncToDb, filterAppointmentsByLocation, getActiveCustomSchedule } = useStore();
  // Helper: merge global customSchedule entries with location-specific ones (location takes precedence)
  const getLocCustomSchedule = useCallback((locId: string): import('@/lib/types').CustomScheduleDay[] => {
    const locEntries = (state as any).locationCustomSchedule?.[locId] ?? [];
    const locDates = new Set(locEntries.map((cs: any) => cs.date));
    const globalFallback = (state.customSchedule ?? []).filter((cs) => !locDates.has(cs.date));
    return [...locEntries, ...globalFallback];
  }, [(state as any).locationCustomSchedule, state.customSchedule]);
  const { activeLocations: _allActiveLocations } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, width: screenWidth, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const params = useLocalSearchParams<{ date?: string }>();

   const sendSmsMutation = trpc.twilio.sendSms.useMutation();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [chargingCard, setChargingCard] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(params.date ?? formatDateStr(new Date()));
  const todayStr2 = formatDateStr(new Date());
  // Calendar month view: track which month is displayed (offset from today's month)
  // Initialize to the month of the incoming date (e.g., when navigating from calendar)
  const [calMonthOffset, setCalMonthOffset] = useState(() => {
    if (!params.date) return 0;
    const today = new Date();
    const sel = new Date(params.date + "T12:00:00");
    return (sel.getFullYear() - today.getFullYear()) * 12 + (sel.getMonth() - today.getMonth());
  });
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [addrStreet, setAddrStreet] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const clientAddress = [addrStreet.trim(), addrCity.trim(), addrState.trim(), addrZip.trim()].filter(Boolean).join(", ");
  const [showTemplatesPicker, setShowTemplatesPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [addMoreTab, setAddMoreTab] = useState<"services" | "products">("services");
  // Category drill-down for Step 1: null = show category tiles, string = show services in that category
  const [step1CategoryFilter, setStep1CategoryFilter] = useState<string | null>(null);
  // Filter chips for the "Add More" section
  const [addMoreCategoryFilter, setAddMoreCategoryFilter] = useState<string | null>(null);
  const [addMoreBrandFilter, setAddMoreBrandFilter] = useState<string | null>(null);
  // Product quantity map: productId → quantity (0 = not in cart)
  const [productQty, setProductQty] = useState<Record<string, number>>({});
  const [recurring, setRecurring] = useState<"none" | "weekly" | "biweekly" | "monthly">("none");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  // Pre-select the currently active location (single source of truth).
  // When activeLocationId is null (All mode), keep null so the date picker shows all locations.
  const [refreshKey, setRefreshKey] = useState(0);
  // Local slot interval override: null = use global setting (Auto or configured)
  // 0 = Auto (service duration + buffer), positive = explicit minutes
  const [localSlotInterval, setLocalSlotInterval] = useState<number | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    const allActive = state.locations.filter((l) => l.active);
    // If user is in "All" mode (null) AND there are multiple locations, keep null
    if (state.activeLocationId === null && allActive.length > 1) {
      return null;
    }
    // If there's an explicit active location, use it
    const activeLoc = state.locations.find((l) => l.id === state.activeLocationId && l.active);
    if (activeLoc) return activeLoc.id;
    // If there's only one active location, always pre-select it so its hours are used
    if (allActive.length === 1) return allActive[0].id;
    // Fall back to default location
    const defaultLoc = state.locations.find((l) => l.isDefault && l.active);
    return defaultLoc?.id ?? null;
  });

  const activeLocations = useMemo(
    () => state.locations.filter((l) => l.active),
    [state.locations]
  );

  // Per-location open/closed check for the currently selected date.
  // Returns a map of locationId -> boolean (true = open, false = closed).
  const locationOpenOnDate = useMemo((): Record<string, boolean> => {
    const result: Record<string, boolean> = {};
    const endDate = state.settings.businessHoursEndDate;
    const d = new Date(selectedDate + "T12:00:00");
    const dayName = DAYS_OF_WEEK[d.getDay()];
    for (const loc of activeLocations) {
      // Temporarily closed = never open
      if (loc.temporarilyClosed) { result[loc.id] = false; continue; }
      // Active Until expiry
      if (endDate && selectedDate > endDate) { result[loc.id] = false; continue; }
      const locCustomSchedule = getLocCustomSchedule(loc.id);
      const customDay = locCustomSchedule.find((cs: { date: string; isOpen: boolean }) => cs.date === selectedDate);
      const locWH = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
        ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
        : (state.settings.workingHours ?? undefined);
      if (state.settings.scheduleMode === "custom") {
        result[loc.id] = !!(customDay?.isOpen);
      } else if (customDay) {
        result[loc.id] = customDay.isOpen;
      } else {
        const wh = locWH[dayName];
        result[loc.id] = !!(wh && wh.enabled);
      }
    }
    return result;
  }, [activeLocations, selectedDate, state.settings.businessHoursEndDate, state.settings.scheduleMode, state.settings.workingHours, (state as any).locationCustomSchedule]);

  const activeStaff = useMemo(() => {
    return state.staff.filter((s) => {
      if (!s.active) return false;
      // Filter by selected location if set
      if (selectedLocationId && s.locationIds && s.locationIds.length > 0) {
        if (!s.locationIds.includes(selectedLocationId)) return false;
      }
      if (!selectedServiceId) return true;
      if (!s.serviceIds || s.serviceIds.length === 0) return true; // null = all services
      return s.serviceIds.includes(selectedServiceId);
    });
  }, [state.staff, selectedServiceId, selectedLocationId]);

  const selectedStaff = useMemo(() => {
    if (!selectedStaffId) return null;
    return state.staff.find((s) => s.id === selectedStaffId) ?? null;
  }, [state.staff, selectedStaffId]);

  // Resolve selectedServiceId: if it starts with 'pkg:' it's a package selection
  const selectedPackage = useMemo(() => {
    if (!selectedServiceId?.startsWith("pkg:")) return null;
    const pkgId = selectedServiceId.slice(4);
    return (state.packages ?? []).find((p) => p.id === pkgId) ?? null;
  }, [selectedServiceId, state.packages]);

  const selectedService = useMemo(() => {
    if (!selectedServiceId || selectedServiceId.startsWith("pkg:")) return null;
    return getServiceById(selectedServiceId);
  }, [selectedServiceId, getServiceById]);

  const selectedClient = selectedClientId ? getClientById(selectedClientId) : null;

  // Total duration includes primary service/package + cart items
  const totalDuration = useMemo(() => {
    if (selectedPackage) {
      const pkgDur = selectedPackage.serviceIds
        .map((id) => state.services.find((s) => s.id === id))
        .filter(Boolean)
        .reduce((sum, sv) => sum + (sv?.duration ?? 0), 0);
      return pkgDur + cart.reduce((sum, item) => sum + item.duration, 0);
    }
    const baseDur = selectedService?.duration ?? state.settings.defaultDuration;
    return baseDur + cart.reduce((sum, item) => sum + item.duration, 0);
  }, [selectedService, selectedPackage, cart, state.settings.defaultDuration, state.services]);

  const subtotal = useMemo(() => {
    const basePrice = selectedPackage
      ? selectedPackage.price
      : selectedService ? parseFloat(String(selectedService.price)) : 0;
    return basePrice + cart.reduce((sum, item) => sum + item.price, 0);
  }, [selectedService, selectedPackage, cart]);

  // Effective slot step:
  // Priority: localSlotInterval (user picked in UI) > global slotInterval setting > Auto
  // Auto = service duration + buffer time (so next slot starts right after appointment + buffer)
  const effectiveStep = useMemo(() => {
    const bufferMin = (state.settings as any).bufferTime ?? 0;
    const autoStep = Math.max(5, totalDuration + bufferMin);
    if (localSlotInterval !== null) {
      return localSlotInterval === 0 ? autoStep : localSlotInterval;
    }
    const configured = (state.settings as any).slotInterval ?? 0;
    return configured > 0 ? configured : autoStep;
  }, [localSlotInterval, (state.settings as any).slotInterval, (state.settings as any).bufferTime, totalDuration]);

  // Auto-detect applicable discount (pass appointments to enforce maxUses cap)
  const appliedDiscount = useMemo(() => {
    if (!selectedServiceId || !selectedDate || !selectedTime) return null;
    return getApplicableDiscount(state.discounts, selectedDate, selectedTime, selectedServiceId, state.appointments);
  }, [state.discounts, selectedDate, selectedTime, selectedServiceId, state.appointments]);

  const discountAmount = useMemo(() => {
    if (!appliedDiscount) return 0;
    // Apply discount to the full cart subtotal (base service + extra items)
    return subtotal * (appliedDiscount.percentage / 100);
  }, [appliedDiscount, subtotal]);

  const totalPrice = subtotal - discountAmount;
  const isMobileService = selectedService?.serviceType === 'mobile';
  const travelFeeAmount = (isMobileService && clientAddress.trim() && selectedService?.travelFee) ? (selectedService.travelFee as unknown as number) : 0;
  const grandTotal = totalPrice + travelFeeAmount;

  // Per-location time-slot availability: when a time is selected, check whether that specific
  // time slot is available at each location (within working hours + no conflicting appointments).
  // Returns a map of locationId -> boolean (true = time is available at this location).
  const locationTimeAvailable = useMemo((): Record<string, boolean> => {
    // If no time selected yet, all open locations are considered available
    if (!selectedTime) {
      const all: Record<string, boolean> = {};
      for (const loc of activeLocations) all[loc.id] = true;
      return all;
    }
    const result: Record<string, boolean> = {};
    for (const loc of activeLocations) {
      // If location is closed on this date, time is also unavailable
      if (locationOpenOnDate[loc.id] === false) { result[loc.id] = false; continue; }
      const locCustomSchedule = getLocCustomSchedule(loc.id);
      const locWH = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
        ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
        : (state.settings.workingHours ?? undefined);
      const locAppts = state.appointments.filter((a) => a.locationId === loc.id);
      const slots = generateAvailableSlots(
        selectedDate, totalDuration, locWH, locAppts, effectiveStep,
        locCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0
      );
      result[loc.id] = slots.includes(selectedTime);
    }
    return result;
  }, [activeLocations, selectedTime, selectedDate, totalDuration, locationOpenOnDate,
      state.appointments, state.settings.workingHours, state.settings.scheduleMode,
      state.settings.bufferTime, (state as any).locationCustomSchedule]);

  // Combined availability: open on date AND time slot available
  const locationAvailable = useMemo((): Record<string, boolean> => {
    const result: Record<string, boolean> = {};
    for (const loc of activeLocations) {
      result[loc.id] = (locationOpenOnDate[loc.id] !== false) && (locationTimeAvailable[loc.id] !== false);
    }
    return result;
  }, [activeLocations, locationOpenOnDate, locationTimeAvailable]);

  // Auto-select single location whenever activeLocations changes
  // This handles the case where locations load after initial render
  useEffect(() => {
    if (!selectedLocationId && activeLocations.length === 1) {
      setSelectedLocationId(activeLocations[0].id);
    }
  }, [activeLocations.length, selectedLocationId]);

  // Auto-clear selectedLocationId if the chosen location is no longer available
  // (closed on this date OR time slot not available there)
  useEffect(() => {
    if (selectedLocationId && locationAvailable[selectedLocationId] === false) {
      setSelectedLocationId(null);
    }
  }, [selectedLocationId, locationAvailable]);

  // Per-staff availability: a staff member is unavailable if they have a confirmed/pending
  // appointment that overlaps the selected date + time + totalDuration.
  const staffAvailabilityMap = useMemo((): Record<string, boolean> => {
    if (!selectedDate || !selectedTime) return {};
    const result: Record<string, boolean> = {};
    for (const member of activeStaff) {
      const staffAppts = state.appointments.filter(
        (a) =>
          a.staffId === member.id &&
          a.date === selectedDate &&
          (a.status === "confirmed" || a.status === "pending")
      );
      const hasConflict = staffAppts.some((a) =>
        timeSlotsOverlap(selectedTime, totalDuration, a.time, a.duration)
      );
      result[member.id] = !hasConflict;
    }
    return result;
  }, [activeStaff, state.appointments, selectedDate, selectedTime, totalDuration]);

  // Use the form-selected location's working hours (not the globally active location)
  const selectedLocation = useMemo(
    () => state.locations.find((l) => l.id === selectedLocationId) ?? null,
    [state.locations, selectedLocationId]
  );
  const locationWorkingHours = useMemo(() => {
    // Use the explicitly selected location's hours
    if (selectedLocation?.workingHours && Object.keys(selectedLocation.workingHours).length > 0) {
      return selectedLocation.workingHours as Record<string, import('@/lib/types').WorkingHours>;
    }
    // If no location is selected but there is exactly one active location, use its hours
    // (handles the case where selectedLocationId is null but only one location exists)
    if (!selectedLocationId && activeLocations.length === 1) {
      const onlyLoc = activeLocations[0];
      if (onlyLoc.workingHours && Object.keys(onlyLoc.workingHours).length > 0) {
        return onlyLoc.workingHours as Record<string, import('@/lib/types').WorkingHours>;
      }
    }
    return state.settings.workingHours ?? DEFAULT_WORKING_HOURS;
  }, [selectedLocation, selectedLocationId, activeLocations, state.settings.workingHours]);
  // Filter appointments by the form-selected location (not the global active location)
  const locationAppts = useMemo(
    () => {
      if (!selectedLocationId) return state.appointments;
      return state.appointments.filter((a) => a.locationId === selectedLocationId);
    },
    [state.appointments, selectedLocationId]
  );
  const activeCustomSchedule = useMemo(() => {
    const mergeWithGlobal = (locId: string) => {
      const locEntries = (state as any).locationCustomSchedule?.[locId] ?? [];
      const locDates = new Set(locEntries.map((cs: any) => cs.date));
      const globalFallback = (state.customSchedule ?? []).filter((cs) => !locDates.has(cs.date));
      return [...locEntries, ...globalFallback];
    };
    if (selectedLocationId) {
      return mergeWithGlobal(selectedLocationId);
    }
    // No location explicitly selected — if there is exactly one active location,
    // use its per-location custom schedule so Workday overrides are visible.
    if (activeLocations.length === 1) {
      return mergeWithGlobal(activeLocations[0].id);
    }
    // Multi-location with no selection: fall back to global custom schedule
    return state.customSchedule ?? [];
  }, [selectedLocationId, activeLocations, (state as any).locationCustomSchedule, state.customSchedule]);
  // isAllMode: no location pre-selected and multiple active locations exist.
  // In this mode the time slot list is the UNION of all open locations' slots so the user
  // can see every possible time across all locations before choosing one.
  const isAllMode = !selectedLocationId && activeLocations.length > 1;

  const timeSlots = useMemo(() => {
    if (!isAllMode) {
      // Single-location mode: use the selected (or only) location's hours and appointments
      return generateAvailableSlots(
        selectedDate,
        totalDuration,
        locationWorkingHours,
        locationAppts,
        effectiveStep,
        activeCustomSchedule,
        state.settings.scheduleMode,
        state.settings.bufferTime ?? 0
      );
    }
    // All-mode: union of available slots across every open, non-temporarily-closed location
    const slotSet = new Set<string>();
    for (const loc of activeLocations) {
      if (locationOpenOnDate[loc.id] === false) continue;
      const locCustomSchedule = getLocCustomSchedule(loc.id);
      const locWH = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
        ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
        : (state.settings.workingHours ?? undefined);
      const locAppts = state.appointments.filter((a) => a.locationId === loc.id);
      const slots = generateAvailableSlots(
        selectedDate, totalDuration, locWH, locAppts, effectiveStep,
        locCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0
      );
      slots.forEach((s) => slotSet.add(s));
    }
    // Sort chronologically
    return Array.from(slotSet).sort();
  }, [isAllMode, selectedDate, locationWorkingHours, locationAppts, totalDuration,
      effectiveStep, activeCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime,
      activeLocations, locationOpenOnDate, state.appointments, state.settings.workingHours,
      (state as any).locationCustomSchedule, refreshKey]);

  // Per-slot location count: how many locations are available for each time slot in All mode.
  // Used to show a badge like "2 locations" on the time chip when multiple locations share a slot.
  const slotLocationCount = useMemo((): Record<string, number> => {
    if (!isAllMode) return {};
    const counts: Record<string, number> = {};
    for (const loc of activeLocations) {
      if (locationOpenOnDate[loc.id] === false) continue;
      const locCustomSchedule = getLocCustomSchedule(loc.id);
      const locWH = (loc.workingHours && Object.keys(loc.workingHours).length > 0)
        ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
        : state.settings.workingHours;
      const locAppts = state.appointments.filter((a) => a.locationId === loc.id);
      const slots = generateAvailableSlots(
        selectedDate, totalDuration, locWH, locAppts, effectiveStep,
        locCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0
      );
      slots.forEach((s) => { counts[s] = (counts[s] ?? 0) + 1; });
    }
    return counts;
  }, [isAllMode, activeLocations, locationOpenOnDate, selectedDate, totalDuration,
      state.appointments, state.settings.workingHours, state.settings.scheduleMode,
      state.settings.bufferTime, (state as any).locationCustomSchedule]);

  // Staff-filtered time slots: when a specific staff member is selected,
  // remove any slot where that staff member already has a conflicting appointment.
  const staffFilteredTimeSlots = useMemo(() => {
    if (!selectedStaffId) return timeSlots;
    const staffAppts = state.appointments.filter(
      (a) =>
        a.staffId === selectedStaffId &&
        a.date === selectedDate &&
        (a.status === "confirmed" || a.status === "pending")
    );
    return timeSlots.filter(
      (t) => !staffAppts.some((a) => timeSlotsOverlap(t, totalDuration, a.time, a.duration))
    );
  }, [timeSlots, selectedStaffId, state.appointments, selectedDate, totalDuration]);

  // Bidirectional sync (location → time):
  // If a specific location is selected and the previously chosen time is no longer in its
  // slot list, clear it. Only applies in single-location mode to avoid clearing valid
  // union-mode times when switching to All.
  if (!isAllMode && selectedTime && timeSlots.length > 0 && !timeSlots.includes(selectedTime)) {
    setSelectedTime(null);
  }
  // If selected staff changes and the chosen time is no longer available for them, clear it.
  if (selectedStaffId && selectedTime && staffFilteredTimeSlots.length > 0 && !staffFilteredTimeSlots.includes(selectedTime)) {
    setSelectedTime(null);
  }

  // Auto-select location when only one location has the chosen time available.
  // This gives the user instant feedback without requiring an extra tap.
  if (isAllMode && selectedTime && !selectedLocationId) {
    const availableForTime = activeLocations.filter(
      (loc) => locationTimeAvailable[loc.id] === true
    );
    if (availableForTime.length === 1) {
      setSelectedLocationId(availableForTime[0].id);
    }
  }

  // Date options: next 14 days with closed-day and no-slots awareness
  // When no location is selected (All mode), aggregate across all active locations:
  // a day is open if ANY location has it open, and has slots if ANY location has slots.
  const dateOptions = useMemo(() => {
    const dates: { date: string; closed: boolean; noSlots: boolean; slotCount: number }[] = [];
    const today = new Date();
    const endDate = state.settings.businessHoursEndDate;
    // All-locations mode: selectedLocationId is null and there are multiple active locations
    const isAllMode = !selectedLocationId && activeLocations.length > 1;
    for (let i = 0; i < 90; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const ds = formatDateStr(d);
      // Check Active Until expiry first
      let closed = !!(endDate && ds > endDate);
      if (!closed) {
        if (isAllMode) {
          // Open if ANY active location has this day open
          let anyOpen = false;
          for (const loc of activeLocations) {
            if (loc.temporarilyClosed) continue;
            const locCustomSchedule = getLocCustomSchedule(loc.id);
            const locCustomDay = locCustomSchedule.find((cs: { date: string; isOpen: boolean }) => cs.date === ds);
            const locWH = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
              ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
              : (state.settings.workingHours ?? undefined);
            if (state.settings.scheduleMode === "custom") {
              if (locCustomDay?.isOpen) { anyOpen = true; break; }
            } else {
              if (locCustomDay) {
                if (locCustomDay.isOpen) { anyOpen = true; break; }
              } else {
                const dayName = DAYS_OF_WEEK[d.getDay()];
                const wh = locWH[dayName];
                if (wh && wh.enabled) { anyOpen = true; break; }
              }
            }
          }
          closed = !anyOpen;
        } else {
          const customDay = activeCustomSchedule.find((cs: { date: string; isOpen: boolean }) => cs.date === ds);
          if (state.settings.scheduleMode === "custom") {
            closed = !customDay || !customDay.isOpen;
          } else {
            if (customDay) {
              closed = !customDay.isOpen;
            } else {
              const dayIndex = d.getDay();
              const dayName = DAYS_OF_WEEK[dayIndex];
              const wh = locationWorkingHours[dayName];
              closed = !wh || !wh.enabled;
            }
          }
        }
      }
      let noSlots = false;
      if (!closed) {
        if (isAllMode) {
          // Has slots if ANY location has at least one slot
          let anySlots = false;
          for (const loc of activeLocations) {
            if (loc.temporarilyClosed) continue;
            const locCustomSchedule = getLocCustomSchedule(loc.id);
            const locWH = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
              ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
              : (state.settings.workingHours ?? undefined);
            const locAppts = state.appointments.filter((a) => a.locationId === loc.id);
            const slots = generateAvailableSlots(ds, totalDuration, locWH, locAppts, effectiveStep, locCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0);
            if (slots.length > 0) { anySlots = true; break; }
          }
          noSlots = !anySlots;
        } else {
          const slots = generateAvailableSlots(ds, totalDuration, locationWorkingHours, locationAppts, effectiveStep, activeCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0);
          noSlots = slots.length === 0;
        }
      }
      // Compute slot count for badge
      let slotCount = 0;
      if (!closed && !noSlots) {
        if (isAllMode) {
          const allTimes = new Set<string>();
          for (const loc of activeLocations) {
            if (loc.temporarilyClosed) continue;
            const locCustomSchedule = getLocCustomSchedule(loc.id);
            const locWH = (loc.workingHours != null && Object.keys(loc.workingHours).length > 0)
              ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
              : (state.settings.workingHours ?? undefined);
            const locAppts = state.appointments.filter((a) => a.locationId === loc.id);
            const slots = generateAvailableSlots(ds, totalDuration, locWH, locAppts, effectiveStep, locCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0);
            slots.forEach((s) => allTimes.add(s));
          }
          slotCount = allTimes.size;
        } else {
          const slots = generateAvailableSlots(ds, totalDuration, locationWorkingHours, locationAppts, effectiveStep, activeCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0);
          slotCount = slots.length;
        }
      }
      dates.push({ date: ds, closed, noSlots, slotCount });
    }
    return dates;
  }, [selectedLocationId, activeLocations, activeCustomSchedule, locationWorkingHours, locationAppts, totalDuration, state.settings.scheduleMode, state.settings.bufferTime, state.settings.businessHoursEndDate, (state as any).locationCustomSchedule, state.appointments, state.settings.workingHours]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.toLowerCase();
    return state.clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.clients, clientSearch]);

  // Available products (all active products — quantity controls replace the add/remove pattern)
  const availableProducts = useMemo(() => {
    return state.products.filter((p) => p.available);
  }, [state.products]);

  // Available extra services (not primary, not already in cart)
  const availableExtraServices = useMemo(() => {
    const cartServiceIds = cart.filter((c) => c.type === "service").map((c) => c.id);
    return state.services.filter(
      (s) => s.id !== selectedServiceId && !cartServiceIds.includes(s.id)
    );
  }, [state.services, selectedServiceId, cart]);

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
    setStep(3);
  }, [quickName, quickPhone, dispatch]);

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => [...prev, item]);
  }, []);

  const removeFromCart = useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Update product quantity and sync the service-only cart + product rows
  const setProductQtyAndSync = useCallback((productId: string, newQty: number) => {
    setProductQty((prev) => {
      const updated = { ...prev, [productId]: Math.max(0, newQty) };
      // Rebuild cart: keep all service items, then add product rows for each qty
      setCart((prevCart) => {
        const serviceItems = prevCart.filter((c) => c.type === "service");
        const productRows: CartItem[] = [];
        for (const [pid, qty] of Object.entries(updated)) {
          if (qty <= 0) continue;
          const prod = state.products.find((p) => p.id === pid);
          if (!prod) continue;
          for (let i = 0; i < qty; i++) {
            productRows.push({ type: "product", id: pid, name: prod.name, price: parseFloat(String(prod.price)), duration: 0 });
          }
        }
        return [...serviceItems, ...productRows];
      });
      return updated;
    });
  }, [state.products]);

  const handleBook = useCallback(async () => {
    if (!selectedServiceId || !selectedClientId || !selectedTime) return;
    // Auto-select the only location if none is selected
    let effectiveLocationId = selectedLocationId;
    if (!effectiveLocationId && activeLocations.length === 1) {
      effectiveLocationId = activeLocations[0].id;
      setSelectedLocationId(effectiveLocationId);
    }
    if (activeLocations.length > 1 && !effectiveLocationId) {
      Alert.alert("Location Required", "Please select a location before confirming the booking.");
      return;
    }
    // Build notes with extra items
    let bookNotes = notes.trim();
    if (cart.length > 0) {
      const extras = cart.map((c) => `${c.name} ($${c.price.toFixed(2)})`).join(", ");
      bookNotes = bookNotes ? `${bookNotes}\nAdditional items: ${extras}` : `Additional items: ${extras}`;
    }
    if (recurring !== "none") {
      bookNotes = bookNotes ? `${bookNotes}\nRecurring: ${recurring}` : `Recurring: ${recurring}`;
    }

    // Calculate dates for recurring appointments
    const dates: string[] = [selectedDate];
    if (recurring !== "none") {
      const baseDate = new Date(selectedDate + "T12:00:00");
      const count = recurring === "weekly" ? 8 : recurring === "biweekly" ? 6 : 4; // weeks ahead
      for (let i = 1; i < count; i++) {
        const nextDate = new Date(baseDate);
        if (recurring === "weekly") nextDate.setDate(baseDate.getDate() + 7 * i);
        else if (recurring === "biweekly") nextDate.setDate(baseDate.getDate() + 14 * i);
        else nextDate.setMonth(baseDate.getMonth() + i);
        dates.push(formatDateStr(nextDate));
      }
    }

    let firstAppointmentId: string | null = null;
    for (const date of dates) {
      const appointmentId = generateId();
      if (!firstAppointmentId) firstAppointmentId = appointmentId;
      // Resolve service ID: for packages use the first service in the package
      const resolvedServiceId = selectedPackage
        ? (selectedPackage.serviceIds[0] ?? selectedServiceId)
        : selectedServiceId;
      const appointment: Appointment = {
        id: appointmentId,
        serviceId: resolvedServiceId!,
        clientId: selectedClientId,
        date,
        time: selectedTime,
        duration: totalDuration,
        status: "confirmed",
        notes: selectedPackage
          ? (bookNotes ? `${bookNotes}\nPackage: ${selectedPackage.name}` : `Package: ${selectedPackage.name}`)
          : bookNotes,
        createdAt: new Date().toISOString(),
        totalPrice,
        extraItems: cart.length > 0 ? cart.map((c) => ({ type: c.type, id: c.id, name: c.name, price: c.price, duration: c.duration })) : undefined,
        staffId: selectedStaffId ?? undefined,
        locationId: effectiveLocationId ?? undefined,
        discountPercent: appliedDiscount?.percentage,
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        discountName: appliedDiscount?.name,
        clientAddress: isMobileService && clientAddress.trim() ? clientAddress.trim() : undefined,
        totalPrice: grandTotal,
        paymentMethod: grandTotal <= 0 ? 'free' as any : (selectedPaymentMethod === 'card' ? 'card' as any : ((selectedPaymentMethod as 'zelle' | 'venmo' | 'cashapp' | 'cash' | undefined) ?? undefined)),
        paymentStatus: grandTotal <= 0 ? 'paid' as const : (selectedPaymentMethod === 'cash' ? 'pending_cash' : (selectedPaymentMethod === 'card' ? 'unpaid' : (selectedPaymentMethod ? 'unpaid' : undefined))),
      };
      dispatch({ type: "ADD_APPOINTMENT", payload: appointment });
      syncToDb({ type: "ADD_APPOINTMENT", payload: appointment });
    }

    // Send confirmation SMS to client
    // Respect master notificationsEnabled and smsClientOnConfirmation toggle
    const notifPrefs = state.settings.notificationPreferences ?? {};
    const masterNotifOn = state.settings.notificationsEnabled !== false;
    const smsClientConfirmOn = (notifPrefs as any).smsClientOnConfirmation !== false; // default true
    if (selectedClient?.phone && masterNotifOn && smsClientConfirmOn) {
      const svc = selectedService;
      const biz = state.settings;
      const profile = biz.profile;
      const apptLoc = selectedLocationId ? getLocationById(selectedLocationId) : null;
      const msg = generateConfirmationMessage(
        biz.businessName,
        apptLoc?.address || profile.address,
        selectedClient.name,
        svc ? getServiceDisplayName(svc) : "Service",
        totalDuration,
        selectedDate,
        selectedTime,
        apptLoc?.phone || profile.phone,
        selectedClient.phone,
        apptLoc?.name,
        apptLoc?.id,
        biz.customSlug,
        apptLoc?.city,
        apptLoc?.state,
        apptLoc?.zipCode
      );
      const rawPhone = stripPhoneFormat(selectedClient.phone);
      // Try server-side SMS (subscription gated); fall back to native SMS app
      const smsEnabled = biz.twilioEnabled && biz.twilioBookingReminder;
      if (smsEnabled && state.businessOwnerId) {
        const toNumber = rawPhone.startsWith("+") ? rawPhone : `+1${rawPhone.replace(/\D/g, "")}`;
        sendSmsMutation
          .mutateAsync({
            businessOwnerId: state.businessOwnerId,
            toNumber,
            body: msg,
            smsAction: "confirmation",
          })
          .catch(() => {
            // Silently fall back — don't block booking flow
          });
      } else if (Platform.OS === "web") {
        Alert.alert("SMS Message", msg);
      } else {
        const separator = Platform.OS === "ios" ? "&" : "?";
        const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(msg)}`;
        Linking.openURL(url).catch(() => Alert.alert("SMS", msg));
      }
    }

    // If card payment selected, present native Stripe payment sheet before navigating
    if (selectedPaymentMethod === 'card' && firstAppointmentId && grandTotal > 0 && state.businessOwnerId) {
      setChargingCard(true);
      try {
        const sheetData = await apiCall<{ publishableKey: string; paymentIntent: string; accountId: string }>(
          '/api/stripe-connect/create-payment-sheet',
          {
            method: 'POST',
            body: JSON.stringify({
              businessOwnerId: state.businessOwnerId,
              appointmentLocalId: firstAppointmentId,
              amount: grandTotal,
              description: selectedService ? `${getServiceDisplayName(selectedService)} - ${selectedClient?.name ?? 'Client'}` : 'Appointment',
              clientEmail: (selectedClient as any)?.email ?? undefined,
            }),
          }
        );
        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: state.settings.businessName ?? 'Business',
          paymentIntentClientSecret: sheetData.paymentIntent,
          stripeAccountId: sheetData.accountId,
          customerId: undefined,
          allowsDelayedPaymentMethods: false,
          defaultBillingDetails: selectedClient?.name ? { name: selectedClient.name } : undefined,
        });
        if (initError) {
          Alert.alert('Payment Error', initError.message);
          setChargingCard(false);
          router.replace({ pathname: '/appointment-detail', params: { id: firstAppointmentId } });
          return;
        }
        const { error: presentError } = await presentPaymentSheet();
        if (presentError) {
          if (presentError.code !== 'Canceled') {
            Alert.alert('Payment Failed', presentError.message);
          }
          setChargingCard(false);
          router.replace({ pathname: '/appointment-detail', params: { id: firstAppointmentId } });
          return;
        }
        // Payment succeeded — update appointment payment status
        dispatch({ type: 'UPDATE_APPOINTMENT', payload: { id: firstAppointmentId, paymentStatus: 'paid', paymentMethod: 'card' } });
        syncToDb({ type: 'UPDATE_APPOINTMENT', payload: { id: firstAppointmentId, paymentStatus: 'paid', paymentMethod: 'card' } });
        setChargingCard(false);
      } catch (err: any) {
        Alert.alert('Payment Error', err?.message ?? 'Failed to process card payment');
        setChargingCard(false);
      }
    }
    // Navigate to the newly created appointment detail
    if (firstAppointmentId) {
      router.replace({ pathname: "/appointment-detail", params: { id: firstAppointmentId } });
    } else {
      router.back();
    }
  }, [selectedServiceId, selectedClientId, selectedDate, selectedTime, totalDuration, notes, cart, recurring, dispatch, router, appliedDiscount, discountAmount, totalPrice, subtotal, grandTotal, clientAddress, isMobileService, travelFeeAmount, selectedStaffId, selectedLocationId, syncToDb, selectedService, selectedClient, state.settings, sendSmsMutation, selectedPaymentMethod, initPaymentSheet, presentPaymentSheet, state.businessOwnerId, chargingCard]);

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getEndTime = (time: string) => {
    return formatTime(minutesToTime(timeToMinutes(time) + totalDuration));
  };

  const TOTAL_STEPS = 5;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={720}>
      <FuturisticBackground />
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingTop: 8, paddingHorizontal: hp }}>
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="xmark" size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-xl font-bold text-foreground ml-4">New Booking</Text>
        </View>
        <Text className="text-sm text-muted">Step {step}/{TOTAL_STEPS}</Text>
      </View>

      {/* Progress Bar */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20, paddingHorizontal: hp }}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <View
            key={s}
            className="flex-1 h-1 rounded-full"
            style={{ backgroundColor: s <= step ? colors.primary : colors.border }}
          />
        ))}
      </View>

      {/* Step 1: Select Service — category drill-down */}
      {step === 1 && (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: hp, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
          {/* ── Packages & Bundles section ─────────────────────────────────── */}
          {(() => {
            const activePackages = (state.packages ?? []).filter((p) => p.active);
            if (activePackages.length === 0) return null;
            return (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Packages &amp; Bundles</Text>
                {activePackages.map((pkg) => {
                  const isSelected = selectedServiceId === `pkg:${pkg.id}`;
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
                        setSelectedServiceId(`pkg:${pkg.id}`);
                        setStep(2);
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
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>{pkg.name}</Text>
                            {savings > 0 && (
                              <View style={{ backgroundColor: "#22C55E20", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
                                <Text style={{ fontSize: fs.xs, color: "#22C55E", fontWeight: "700" }}>Save ${savings.toFixed(2)}</Text>
                              </View>
                            )}
                          </View>
                          {pkg.description ? (
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 6 }} numberOfLines={2}>{pkg.description}</Text>
                          ) : null}
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                            {includedSvcs.map((sv) => (
                              <View key={sv.id} style={{ backgroundColor: colors.border, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                                <Text style={{ fontSize: fs.xs, color: colors.muted }}>{sv.name}</Text>
                              </View>
                            ))}
                          </View>
                          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>{totalDuration} min total</Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                          <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>${pkg.price.toFixed(2)}</Text>
                          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
                <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 16 }} />
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Individual Services</Text>
              </View>
            );
          })()}

          {state.services.length === 0 ? (
            <View className="items-center py-12">
              <Text className="text-base text-muted">No services available</Text>
              <Text className="text-sm text-muted mt-1">Create a service first</Text>
            </View>
          ) : (() => {
            // Build category map
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

            if (hasMultiCat && step1CategoryFilter === null) {
              // Level 1: show category tiles
              const CATEGORY_EMOJI: Record<string, string> = {
                Hair: "✂️", Massage: "💆", Nails: "💅", Skincare: "🧴",
                "Waxing & Brows": "🪮", Waxing: "🪮", Brows: "🪮",
                Makeup: "💄", Lashes: "👁️", Spa: "🛁", Fitness: "🏋️",
                Tattoo: "🖊️", Piercing: "💎", Barber: "💈", General: "⭐",
              };
              const getCatEmoji = (c: string) => CATEGORY_EMOJI[c] ?? "✨";
              return (
                <View>
                  <Text className="text-base font-semibold text-foreground mb-3">Select a Category</Text>
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
                        <Text style={{ fontSize: fs.xxl }}>{getCatEmoji(cat)}</Text>
                        <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>{cat}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted }}>{svcs.length} service{svcs.length !== 1 ? "s" : ""}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            }

            // Level 2 (or single category): show services
            const displaySvcs = hasMultiCat && step1CategoryFilter
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
                      <Text style={{ fontSize: fs.sm, color: colors.primary }}>← Categories</Text>
                    </Pressable>
                    <Text className="text-base font-semibold text-foreground">{step1CategoryFilter}</Text>
                  </View>
                )}
                {!hasMultiCat && (
                  <Text className="text-base font-semibold text-foreground mb-3">Select a Service</Text>
                )}
                {displaySvcs.map((item) => {
                  const NB_CAT_EMOJI: Record<string, string> = {
                    Hair: "✂️", Massage: "💆", Nails: "💅", Skincare: "🧴",
                    "Waxing & Brows": "🪮", Waxing: "🪮", Brows: "🪮",
                    Makeup: "💄", Lashes: "👁️", Spa: "🛁", Fitness: "🏋️",
                    Tattoo: "🖊️", Piercing: "💎", Barber: "💈", General: "⭐",
                  };
                  const nbSvcEmoji = NB_CAT_EMOJI[item.category ?? ""] ?? "✨";
                  return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setSelectedServiceId(item.id);
                      setStep(2);
                    }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: selectedServiceId === item.id ? item.color + "15" : colors.surface,
                        borderColor: selectedServiceId === item.id ? item.color : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    {item.photoUri ? (
                      <Image source={{ uri: item.photoUri }} style={{ width: 40, height: 40, borderRadius: 8, marginRight: 12 }} />
                    ) : (
                      <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: item.color + "22", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                        <Text style={{ fontSize: fs.lg }}>{nbSvcEmoji}</Text>
                      </View>
                    )}
                    <View style={styles.optionContent}>
                      <Text className="text-base font-semibold text-foreground">{item.name}</Text>
                      <Text className="text-xs text-muted mt-0.5">{item.duration} min · ${item.price}</Text>
                    </View>
                    <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                  </Pressable>
                  );
                })}
              </View>
            );
          })()}
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      {/* Step 2: Select Client */}
      {step === 2 && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: hp }}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable onPress={() => setStep(1)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
              <Text className="text-sm" style={{ color: colors.primary }}>← Back</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Select Client</Text>
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
                placeholder="Phone (optional)"
                placeholderTextColor={colors.muted}
                value={quickPhone}
                onChangeText={setQuickPhone}
                keyboardType="phone-pad"
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
                <Text className="text-sm font-semibold text-white">Add & Continue</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View
                className="flex-row items-center rounded-xl px-3 mb-3 border"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
                <TextInput
                  className="flex-1 py-3 px-2 text-sm"
                  placeholder="Search clients..."
                  placeholderTextColor={colors.muted}
                  value={clientSearch}
                  onChangeText={setClientSearch}
                  style={{ color: colors.foreground }}
                />
              </View>
              <FlatList
                data={filteredClients}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      setSelectedClientId(item.id);
                      setStep(3);
                    }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: selectedClientId === item.id ? colors.primary + "15" : colors.surface,
                        borderColor: selectedClientId === item.id ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary }}>
                        {getInitials(item.name)}
                      </Text>
                    </View>
                    <View style={styles.optionContent}>
                      <Text className="text-base font-semibold text-foreground">{item.name}</Text>
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
                    <Pressable
                      onPress={() => setShowQuickAdd(true)}
                      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: 8 }]}
                    >
                      <Text className="text-sm font-medium" style={{ color: colors.primary }}>
                        + Add New Client
                      </Text>
                    </Pressable>
                  </View>
                }
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            </>
          )}
        </View>
        </KeyboardAvoidingView>
      )}

      {/* Step 3: Pick Date & Time */}
      {step === 3 && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable onPress={() => setStep(2)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
              <Text className="text-sm" style={{ color: colors.primary }}>← Back</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Pick Date & Time</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Location Selector — shown at top of Step 3 */}
          {activeLocations.length > 1 && (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              <Text className="text-xs font-medium text-muted mb-3">Location</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {/* All Locations option */}
                  <Pressable
                    onPress={() => {
                      setSelectedLocationId(null);
                      setSelectedTime(null);
                    }}
                    style={({ pressed }) => [{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      backgroundColor: !selectedLocationId ? colors.primary + "15" : colors.background,
                      borderColor: !selectedLocationId ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }]}
                  >
                    <IconSymbol name="location.fill" size={14} color={!selectedLocationId ? colors.primary : colors.muted} />
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: !selectedLocationId ? colors.primary : colors.foreground }}>All Locations</Text>
                  </Pressable>
                  {/* Individual locations */}
                  {activeLocations.map((loc) => {
                    const isSelected = selectedLocationId === loc.id;
                    return (
                      <Pressable
                        key={loc.id}
                        onPress={() => {
                          setSelectedLocationId(loc.id);
                          setSelectedTime(null);
                        }}
                        style={({ pressed }) => [{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          backgroundColor: isSelected ? colors.primary + "15" : colors.background,
                          borderColor: isSelected ? colors.primary : colors.border,
                          opacity: pressed ? 0.7 : 1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }]}
                      >
                        <IconSymbol name="location.fill" size={14} color={isSelected ? colors.primary : colors.muted} />
                        <View>
                          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isSelected ? colors.primary : colors.foreground }}>{loc.name}</Text>
                          {!!loc.address && (
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }} numberOfLines={2}>{formatFullAddress(loc.address, loc.city, loc.state, loc.zipCode)}</Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Staff Selector — shown at top of Step 3, filtered by selected location */}
          {activeStaff.length > 0 && (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              <Text className="text-xs font-medium text-muted mb-3">Assign Staff (Optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setSelectedStaffId(null)}
                    style={({ pressed }) => [{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      backgroundColor: !selectedStaffId ? colors.primary + "15" : colors.background,
                      borderColor: !selectedStaffId ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: !selectedStaffId ? colors.primary : colors.foreground }}>Any Available</Text>
                  </Pressable>
                  {activeStaff.map((member) => {
                    const hasTimeSelected = !!(selectedDate && selectedTime);
                    const isAvailable = staffAvailabilityMap[member.id] !== false;
                    const dotColor = !hasTimeSelected ? colors.border : isAvailable ? colors.success : colors.muted;
                    return (
                      <Pressable
                        key={member.id}
                        onPress={() => setSelectedStaffId(member.id)}
                        style={({ pressed }) => [{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          backgroundColor: selectedStaffId === member.id ? (member.color || colors.primary) + "15" : colors.background,
                          borderColor: selectedStaffId === member.id ? (member.color || colors.primary) : colors.border,
                          opacity: pressed ? 0.7 : 1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }]}
                      >
                        <View style={{ position: "relative" }}>
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: member.color || colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                            {member.photoUri ? (
                              <Image source={{ uri: member.photoUri }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                            ) : (
                              <Text style={{ color: "#FFF", fontSize: fs.xs, fontWeight: "700" }}>{member.name.charAt(0).toUpperCase()}</Text>
                            )}
                          </View>
                          <View style={{
                            position: "absolute",
                            bottom: -1,
                            right: -1,
                            width: 9,
                            height: 9,
                            borderRadius: 5,
                            backgroundColor: dotColor,
                            borderWidth: 1.5,
                            borderColor: colors.background,
                          }} />
                        </View>
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: selectedStaffId === member.id ? (member.color || colors.primary) : colors.foreground }}>{member.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Date Selection — Monthly Calendar Grid */}
          {(() => {
            const MONTH_NAMES_CAL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const DAY_HEADERS_CAL = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
            const today = new Date();
            const todayStr = todayStr2;
            // Compute the displayed month from calMonthOffset
            const displayDate = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
            const displayMonth = displayDate.getMonth();
            const displayYear = displayDate.getFullYear();
            // Build the grid: empty cells for days before the 1st, then day numbers
            const firstDayOfWeek = new Date(displayYear, displayMonth, 1).getDay();
            const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
            const calCells: (number | null)[] = [
              ...Array(firstDayOfWeek).fill(null),
              ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
            ];
            // Compute cell size based on available width (same as calendar.tsx)
            const calCellSize = Math.floor((screenWidth - hp * 2) / 7);
            // Max date for the 90-day range
            const maxDate = new Date(today);
            maxDate.setDate(today.getDate() + 89);
            const maxDateStr = maxDate.getFullYear() + "-" + String(maxDate.getMonth()+1).padStart(2,"0") + "-" + String(maxDate.getDate()).padStart(2,"0");
            // Determine if prev/next month navigation is possible
            const canGoPrev = calMonthOffset > 0;
            const canGoNext = calMonthOffset < 3; // max ~3 months ahead covers 90 days
            return (
              <View style={{ marginBottom: 8 }}>
                {/* Month Navigation Header */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Pressable
                    onPress={() => { if (canGoPrev) setCalMonthOffset((o) => o - 1); }}
                    style={({ pressed }) => ({ padding: 8, opacity: canGoPrev ? (pressed ? 0.5 : 1) : 0.25 })}
                  >
                    <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setCalMonthOffset(0);
                      setSelectedDate(todayStr);
                      setSelectedTime(null);
                    }}
                  >
                    <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>
                      {MONTH_NAMES_CAL[displayMonth]} {displayYear}
                    </Text>
                  </Pressable>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    {selectedDate !== todayStr && (
                      <Pressable
                        onPress={() => {
                          setCalMonthOffset(0);
                          setSelectedDate(todayStr);
                          setSelectedTime(null);
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 12,
                          backgroundColor: colors.primary + "18",
                          opacity: pressed ? 0.65 : 1,
                          marginRight: 4,
                        })}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>Today</Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => { if (canGoNext) setCalMonthOffset((o) => o + 1); }}
                      style={({ pressed }) => ({ padding: 8, opacity: canGoNext ? (pressed ? 0.5 : 1) : 0.25 })}
                    >
                      <IconSymbol name="chevron.right" size={20} color={colors.foreground} />
                    </Pressable>
                  </View>
                </View>
                {/* Day of Week Headers */}
                <View style={{ flexDirection: "row", marginBottom: 4 }}>
                  {DAY_HEADERS_CAL.map((d) => (
                    <View key={d} style={{ width: calCellSize, alignItems: "center" }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>{d}</Text>
                    </View>
                  ))}
                </View>
                {/* Calendar Grid */}
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {calCells.map((day, idx) => {
                    if (day === null) {
                      return <View key={`empty-${idx}`} style={{ width: calCellSize, height: calCellSize }} />;
                    }
                    const dateStr = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const isSelected = dateStr === selectedDate;
                    const isToday = dateStr === todayStr;
                    const isPast = dateStr < todayStr;
                    const isOutOfRange = dateStr > maxDateStr;
                    // Look up in dateOptions for closed/noSlots flags
                    const opt = dateOptions.find((o) => o.date === dateStr);
                    const isClosed = opt ? opt.closed : true; // dates outside 90-day range treated as closed
                    const isNoSlots = opt ? opt.noSlots : false;
                    const slotCount = opt ? opt.slotCount : 0;
                    const isDisabled = isPast || isOutOfRange || isClosed || isNoSlots;
                    return (
                      <Pressable
                        key={dateStr}
                        onPress={() => {
                          if (!isDisabled) {
                            setSelectedDate(dateStr);
                            setSelectedTime(null);
                          }
                        }}
                        style={({ pressed }) => ({
                          width: calCellSize,
                          height: calCellSize,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "transparent",
                          borderRadius: calCellSize / 2,
                          borderWidth: isSelected ? 1.5 : 0,
                          borderColor: isSelected ? colors.primary : "transparent",
                          opacity: (isPast || isOutOfRange) ? 0.3 : pressed && !isDisabled ? 0.7 : 1,
                        })}
                      >
                        <Text
                          style={{
                            fontSize: fs.sm,
                            fontWeight: isToday || isSelected ? "700" : "400",
                            color: isSelected || isToday
                              ? colors.primary
                              : isClosed && !isPast && !isOutOfRange
                              ? colors.muted
                              : colors.foreground,
                            textDecorationLine: isClosed && !isPast && !isOutOfRange ? "line-through" : "none",
                          }}
                        >
                          {day}
                        </Text>
                        {/* Today dot — always show when today, even when selected */}
                        {isToday && (
                          <View style={{ position: "absolute", bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary }} />
                        )}
                        {/* OFF badge for closed days (not past, not out of range) */}
                        {isClosed && !isPast && !isOutOfRange && !isSelected && (
                          <View style={{ position: "absolute", top: 2, right: 2, backgroundColor: colors.error + "20", borderRadius: 3, paddingHorizontal: 2, paddingVertical: 0 }}>
                            <Text style={{ fontSize: 7, color: colors.error, fontWeight: "700" }}>OFF</Text>
                          </View>
                        )}
                        {/* FULL badge for fully-booked days */}
                        {!isClosed && isNoSlots && !isPast && !isOutOfRange && !isSelected && (
                          <View style={{ position: "absolute", top: 2, right: 2, backgroundColor: colors.warning + "20", borderRadius: 3, paddingHorizontal: 2, paddingVertical: 0 }}>
                            <Text style={{ fontSize: 7, color: colors.warning, fontWeight: "700" }}>FULL</Text>
                          </View>
                        )}
                        {/* Slot count badge — green rounded-square */}
                        {!isClosed && !isNoSlots && !isPast && !isOutOfRange && slotCount > 0 && (
                          <View style={{
                            position: "absolute",
                            top: 1,
                            right: 1,
                            backgroundColor: slotCount <= 2 ? colors.warning + "30" : colors.success + "30",
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: slotCount <= 2 ? colors.warning + "80" : colors.success + "80",
                            paddingHorizontal: 2,
                            paddingVertical: 0,
                            minWidth: 12,
                            alignItems: "center",
                          }}>
                            <Text style={{
                              fontSize: 7,
                              fontWeight: "700",
                              color: slotCount <= 2 ? colors.warning : colors.success,
                            }}>{slotCount}</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          {/* Selected date full label */}
          {selectedDate && (
            <View style={{ marginBottom: 8, marginHorizontal: 2 }}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
                {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </Text>
            </View>
          )}
          {/* Slot Interval Selector */}
          {(() => {
            const INTERVALS = [
              { label: "Auto", value: 0 },
              { label: "5m", value: 5 },
              { label: "10m", value: 10 },
              { label: "15m", value: 15 },
              { label: "20m", value: 20 },
              { label: "25m", value: 25 },
              { label: "30m", value: 30 },
              { label: "35m", value: 35 },
              { label: "40m", value: 40 },
              { label: "45m", value: 45 },
              { label: "50m", value: 50 },
              { label: "55m", value: 55 },
            ];
            const globalConfigured = (state.settings as any).slotInterval ?? 0;
            const activeValue = localSlotInterval !== null ? localSlotInterval : globalConfigured;
            return (
              <View style={{ marginBottom: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}>
                  {INTERVALS.map((iv) => {
                    const isActive = iv.value === activeValue;
                    return (
                      <Pressable
                        key={iv.value}
                        onPress={() => setLocalSlotInterval(iv.value)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 12,
                          paddingVertical: 5,
                          borderRadius: 20,
                          backgroundColor: isActive ? colors.primary : colors.surface,
                          borderWidth: 1,
                          borderColor: isActive ? colors.primary : colors.border,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isActive ? "#FFFFFF" : colors.muted }}>{iv.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            );
          })()}
          {/* Time Slots */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, marginHorizontal: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text className="text-xs font-medium text-muted">Available Times</Text>
              {selectedStaffId && selectedStaff && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: (selectedStaff.color || colors.primary) + "20", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selectedStaff.color || colors.primary }} />
                  <Text style={{ fontSize: 10, fontWeight: "600", color: selectedStaff.color || colors.primary }}>{selectedStaff.name}</Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => setRefreshKey((k) => k + 1)}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
            >
              <IconSymbol name="arrow.clockwise" size={16} color={colors.muted} />
            </Pressable>
          </View>
          {staffFilteredTimeSlots.length === 0 ? (
            <View className="items-center py-8 bg-surface rounded-2xl border border-border">
              {selectedStaffId && timeSlots.length > 0 ? (
                <>
                  <Text className="text-sm font-semibold text-muted">{selectedStaff?.name ?? "This staff member"} is fully booked</Text>
                  <Text className="text-xs text-muted mt-1">Select another staff member or a different date</Text>
                </>
              ) : selectedDate === formatDateStr(new Date()) ? (
                <>
                  <Text className="text-sm font-semibold text-warning">All slots for today have passed</Text>
                  <Text className="text-xs text-muted mt-1">Select another date to book an appointment</Text>
                </>
              ) : (
                <>
                  <Text className="text-sm text-muted">No available times for this date</Text>
                  <Text className="text-xs text-muted mt-1">Try a different date or check working hours</Text>
                </>
              )}
            </View>
          ) : (
            (() => {
              const slotChipWidth = Math.floor((screenWidth - hp * 2 - 12) / 3);
              const renderSlotChip = (t: string) => {
                const isSelected = t === selectedTime;
                const locCount = isAllMode ? (slotLocationCount[t] ?? 1) : 1;
                const multiLoc = isAllMode && locCount > 1;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setSelectedTime(t)}
                    style={({ pressed }) => [
                      styles.timeChip,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surface,
                        borderColor: isSelected ? colors.primary : multiLoc ? colors.primary + "60" : colors.border,
                        opacity: pressed ? 0.7 : 1,
                        width: slotChipWidth,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isSelected ? "#FFFFFF" : colors.foreground, textAlign: "center", lineHeight: 17 }}>
                      {formatTime(t)}
                    </Text>
                    <Text style={{ fontSize: 9, color: isSelected ? "#FFFFFF99" : colors.muted, marginTop: 1, textAlign: "center", lineHeight: 12 }}>
                      to {getEndTime(t)}
                    </Text>
                    {multiLoc && (
                      <View style={{ marginTop: 3, backgroundColor: isSelected ? "#FFFFFF30" : colors.primary + "20", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: isSelected ? "#FFFFFF" : colors.primary, textAlign: "center" }}>
                          {locCount} locations
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              };
              // Group into Morning/Afternoon/Evening when there are many slots
              const useGroups = staffFilteredTimeSlots.length > 12;
              if (!useGroups) {
                return (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {staffFilteredTimeSlots.map(renderSlotChip)}
                  </View>
                );
              }
              const groups = [
                { label: "Morning", slots: staffFilteredTimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h < 12; }) },
                { label: "Afternoon", slots: staffFilteredTimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h >= 12 && h < 17; }) },
                { label: "Evening", slots: staffFilteredTimeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h >= 17; }) },
              ].filter((g) => g.slots.length > 0);
              return (
                <View style={{ marginBottom: 12 }}>
                  {groups.map((group) => (
                    <View key={group.label} style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, marginBottom: 6, marginLeft: 2 }}>{group.label}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {group.slots.map(renderSlotChip)}
                      </View>
                    </View>
                  ))}
                </View>
              );
            })()
          )}

          {/* Notes */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4, marginTop: 6 }}>
            <Text className="text-xs font-medium text-muted ml-1">Notes (optional)</Text>
            {(state.noteTemplates ?? []).length > 0 && (
              <Pressable
                onPress={() => setShowTemplatesPicker(true)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 4 })}
              >
                <IconSymbol name="doc.text.fill" size={13} color={colors.primary} />
                <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>Templates</Text>
              </Pressable>
            )}
          </View>
          <TextInput
            className="bg-surface rounded-xl px-4 py-3 text-sm mb-4 border border-border"
            placeholder="Add any notes..."
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={2}
            style={{ color: colors.foreground, minHeight: 50, textAlignVertical: "top" }}
          />
          {/* Client Address (mobile services only) — split into Street / City / State / ZIP */}
          {isMobileService && (
            <View style={{ marginBottom: 4, marginTop: 2 }}>
              <Text className="text-xs font-medium text-muted ml-1 mb-2">Client Address <Text style={{ color: colors.error }}>*</Text></Text>
              {/* Street */}
              <Text style={{ fontSize: 10, fontWeight: "600", color: colors.muted, marginBottom: 3, marginLeft: 2 }}>Street Address</Text>
              <TextInput
                className="bg-surface rounded-xl px-4 py-3 text-sm mb-2 border border-border"
                placeholder="123 Main St"
                placeholderTextColor={colors.muted}
                value={addrStreet}
                onChangeText={setAddrStreet}
                returnKeyType="next"
                style={{ color: colors.foreground }}
              />
              {/* City */}
              <Text style={{ fontSize: 10, fontWeight: "600", color: colors.muted, marginBottom: 3, marginLeft: 2 }}>City</Text>
              <TextInput
                className="bg-surface rounded-xl px-4 py-3 text-sm mb-2 border border-border"
                placeholder="Austin"
                placeholderTextColor={colors.muted}
                value={addrCity}
                onChangeText={setAddrCity}
                returnKeyType="next"
                style={{ color: colors.foreground }}
              />
              {/* State + ZIP side by side */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: colors.muted, marginBottom: 3, marginLeft: 2 }}>State</Text>
                  <TextInput
                    className="bg-surface rounded-xl px-4 py-3 text-sm border border-border"
                    placeholder="TX"
                    placeholderTextColor={colors.muted}
                    value={addrState}
                    onChangeText={setAddrState}
                    autoCapitalize="characters"
                    maxLength={2}
                    returnKeyType="next"
                    style={{ color: colors.foreground }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: colors.muted, marginBottom: 3, marginLeft: 2 }}>ZIP Code</Text>
                  <TextInput
                    className="bg-surface rounded-xl px-4 py-3 text-sm border border-border"
                    placeholder="78701"
                    placeholderTextColor={colors.muted}
                    value={addrZip}
                    onChangeText={setAddrZip}
                    keyboardType="number-pad"
                    maxLength={10}
                    returnKeyType="done"
                    style={{ color: colors.foreground }}
                  />
                </View>
              </View>
            </View>
          )}

          {/* Staff Selector — REMOVED from bottom of Step 3 (now at top) */}
          {false && activeStaff.length > 0 && (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              <Text className="text-xs font-medium text-muted mb-3">Assign Staff (Optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setSelectedStaffId(null)}
                    style={({ pressed }) => [{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      backgroundColor: !selectedStaffId ? colors.primary + "15" : colors.background,
                      borderColor: !selectedStaffId ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: !selectedStaffId ? colors.primary : colors.foreground }}>Any Available</Text>
                  </Pressable>
                  {activeStaff.map((member) => {
                    // Availability dot: green = available, grey = busy (only shown when date+time selected)
                    const hasTimeSelected = !!(selectedDate && selectedTime);
                    const isAvailable = staffAvailabilityMap[member.id] !== false;
                    const dotColor = !hasTimeSelected ? colors.border : isAvailable ? colors.success : colors.muted;
                    return (
                      <Pressable
                        key={member.id}
                        onPress={() => setSelectedStaffId(member.id)}
                        style={({ pressed }) => [{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          backgroundColor: selectedStaffId === member.id ? (member.color || colors.primary) + "15" : colors.background,
                          borderColor: selectedStaffId === member.id ? (member.color || colors.primary) : colors.border,
                          opacity: pressed ? 0.7 : 1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }]}
                      >
                        <View style={{ position: "relative" }}>
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: member.color || colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                            {member.photoUri ? (
                              <Image source={{ uri: member.photoUri }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                            ) : (
                              <Text style={{ color: "#FFF", fontSize: fs.xs, fontWeight: "700" }}>{member.name.charAt(0).toUpperCase()}</Text>
                            )}
                          </View>
                          {/* Availability dot — bottom-right of avatar */}
                          <View style={{
                            position: "absolute",
                            bottom: -1,
                            right: -1,
                            width: 9,
                            height: 9,
                            borderRadius: 5,
                            backgroundColor: dotColor,
                            borderWidth: 1.5,
                            borderColor: colors.background,
                          }} />
                        </View>
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: selectedStaffId === member.id ? (member.color || colors.primary) : colors.foreground }}>{member.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}
          {/* Continue to Add More or Book */}
          {selectedTime && (
            <Pressable
              onPress={() => setStep(4)}
              style={({ pressed }) => [
                styles.bookButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text className="text-base font-semibold text-white">Continue</Text>
            </Pressable>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Step 4: Add More & Confirm */}
      {step === 4 && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable onPress={() => setStep(3)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
              <Text className="text-sm" style={{ color: colors.primary }}>← Back</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Review & Add More</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Cart Summary */}
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <Text className="text-xs font-medium text-muted mb-3">Booking Items</Text>

            {/* Primary Service */}
            {selectedService && (
              <View style={styles.cartItem}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={[styles.colorDot, { backgroundColor: selectedService.color, marginRight: 8 }]} />
                    <Text className="text-sm font-semibold text-foreground">{selectedService.name}</Text>
                  </View>
                  <Text className="text-xs text-muted ml-5">{selectedService.duration} min</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text className="text-sm font-bold" style={{ color: colors.primary }}>${parseFloat(String(selectedService.price)).toFixed(2)}</Text>
                  <Text style={{ fontSize: 10, color: colors.success, fontWeight: "600" }}>PRIMARY</Text>
                </View>
              </View>
            )}

            {/* Cart Items — services shown individually, products grouped by id */}
            {(() => {
              const serviceExtras = cart.filter((c) => c.type === "service");
              const productGroups = new Map<string, { name: string; price: number; qty: number }>();
              cart.forEach((item) => {
                if (item.type !== "product") return;
                if (!productGroups.has(item.id)) {
                  productGroups.set(item.id, { name: item.name, price: item.price, qty: 0 });
                }
                productGroups.get(item.id)!.qty += 1;
              });
              const rows: React.ReactNode[] = [];
              serviceExtras.forEach((item) => {
                const originalIdx = cart.indexOf(item);
                rows.push(
                  <View key={`svc-${item.id}-${originalIdx}`} style={styles.cartItem}>
                    <View style={{ flex: 1 }}>
                      <Text className="text-sm font-semibold text-foreground">{item.name}</Text>
                      <Text className="text-xs text-muted">{item.duration} min</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text className="text-sm font-bold" style={{ color: colors.primary }}>${item.price.toFixed(2)}</Text>
                      <Pressable
                        onPress={() => removeFromCart(originalIdx)}
                        style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                      >
                        <IconSymbol name="xmark" size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  </View>
                );
              });
              productGroups.forEach((group, productId) => {
                rows.push(
                  <View key={`prod-${productId}`} style={styles.cartItem}>
                    <View style={{ flex: 1 }}>
                      <Text className="text-sm font-semibold text-foreground">{group.name}</Text>
                      <Text className="text-xs text-muted">Product</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {group.qty > 1 && (
                        <Text style={{ fontSize: fs.xs, color: colors.muted, fontWeight: "600" }}>×{group.qty}</Text>
                      )}
                      <Text className="text-sm font-bold" style={{ color: colors.primary }}>${(group.price * group.qty).toFixed(2)}</Text>
                      <Pressable
                        onPress={() => setProductQtyAndSync(productId, 0)}
                        style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                      >
                        <IconSymbol name="xmark" size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  </View>
                );
              });
              return rows;
            })()}

            {/* Services + Products sub-lines: show when both types are in cart */}
            {(() => {
              const serviceTotal = cart
                .filter(c => c.type === 'service')
                .reduce((s, c) => s + c.price, 0);
              const productTotal = cart
                .filter(c => c.type === 'product')
                .reduce((s, c) => s + c.price, 0);
              const hasBoth = serviceTotal > 0 && productTotal > 0;
              if (!hasBoth) return null;
              return (
                <>
                  <View style={[styles.cartItem, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4, paddingTop: 8 }]}>
                    <Text className="text-sm text-muted">Services</Text>
                    <Text className="text-sm font-semibold text-foreground">${serviceTotal.toFixed(2)}</Text>
                  </View>
                  <View style={[styles.cartItem]}>
                    <Text className="text-sm text-muted">Products</Text>
                    <Text className="text-sm font-semibold" style={{ color: colors.primary }}>${productTotal.toFixed(2)}</Text>
                  </View>
                </>
              );
            })()}
            {/* Subtotal */}
            {discountAmount > 0 && (
              <View style={[styles.cartItem, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 8 }]}>
                <Text className="text-sm text-muted">Subtotal</Text>
                <Text className="text-sm text-muted">${subtotal.toFixed(2)}</Text>
              </View>
            )}
            {/* Discount */}
            {appliedDiscount && discountAmount > 0 && (
              <View style={[styles.cartItem]}>
                <Text className="text-sm font-medium" style={{ color: colors.warning }}>{appliedDiscount.name} ({appliedDiscount.percentage}% off)</Text>
                <Text className="text-sm font-medium" style={{ color: colors.warning }}>-${discountAmount.toFixed(2)}</Text>
              </View>
            )}
            {/* Travel Fee (mobile services) */}
            {travelFeeAmount > 0 && (
              <View style={[styles.cartItem]}>
                <Text className="text-sm font-medium" style={{ color: "#0891b2" }}>🚗 Travel Fee</Text>
                <Text className="text-sm font-medium" style={{ color: "#0891b2" }}>+${travelFeeAmount.toFixed(2)}</Text>
              </View>
            )}
            {/* Totals */}
            <View style={[styles.cartItem, { borderTopWidth: 2, borderTopColor: colors.border, marginTop: 4, paddingTop: 10 }]}>
              <Text className="text-sm font-bold text-foreground">Total ({totalDuration} min)</Text>
              <Text className="text-base font-bold" style={{ color: colors.primary }}>${grandTotal.toFixed(2)}</Text>
            </View>
          </View>


          {/* Location Selector — REMOVED from Step 4 (now in Step 3) */}
          {false && activeLocations.length > 0 && (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              <Text className="text-xs font-medium text-muted mb-3">Location <Text style={{ color: colors.error }}>*</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {activeLocations.map((loc) => {
                    const isAvailable = locationAvailable[loc.id] !== false;
                    const isSelected = selectedLocationId === loc.id;
                    // Determine the reason for being unavailable (for the label)
                    const isClosed = locationOpenOnDate[loc.id] === false;
                    const noTimeSlot = !isClosed && selectedTime != null && locationTimeAvailable[loc.id] === false;
                    return (
                      <Pressable
                        key={loc.id}
                        onPress={() => { if (isAvailable) setSelectedLocationId(loc.id); }}
                        style={[{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          backgroundColor: isSelected ? colors.primary + "15" : colors.background,
                          borderColor: isSelected ? colors.primary : isAvailable ? colors.border : colors.error + "40",
                          opacity: isAvailable ? 1 : 0.45,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }]}
                      >
                        <IconSymbol name="location.fill" size={14} color={isSelected ? colors.primary : isAvailable ? colors.muted : colors.error} />
                        <View>
                          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isSelected ? colors.primary : isAvailable ? colors.foreground : colors.muted }}>{loc.name}</Text>
                          {!!loc.address && (
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }} numberOfLines={2}>{formatFullAddress(loc.address, loc.city, loc.state, loc.zipCode)}</Text>
                          )}
                          {isClosed && (
                            <Text style={{ fontSize: 10, color: colors.error, marginTop: 1, fontWeight: "600" }}>Closed this day</Text>
                          )}
                          {noTimeSlot && (
                            <Text style={{ fontSize: 10, color: colors.error, marginTop: 1, fontWeight: "600" }}>Time unavailable here</Text>
                          )}
                        </View>

                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Add More Section */}
          <Text className="text-xs font-medium text-muted mb-2 ml-1">Add More (Optional)</Text>

          {/* Segmented Control */}
          <View style={[styles.segControl, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              onPress={() => setAddMoreTab("services")}
              style={[
                styles.segBtn,
                addMoreTab === "services" && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: addMoreTab === "services" ? "#FFFFFF" : colors.muted }}
              >
                Services
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAddMoreTab("products")}
              style={[
                styles.segBtn,
                addMoreTab === "products" && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: addMoreTab === "products" ? "#FFFFFF" : colors.muted }}
              >
                Products
              </Text>
            </Pressable>
          </View>

          {/* Extra Services — category filter chips */}
          {addMoreTab === "services" && (
            <View className="mb-4">
              {availableExtraServices.length === 0 ? (
                <View className="items-center py-6 bg-surface rounded-xl border border-border">
                  <Text className="text-xs text-muted">No additional services available</Text>
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
                                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: isExpanded ? colors.primary : colors.foreground }}>{cat}</Text>
                                <View style={{ backgroundColor: colors.primary + "20", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary }}>{svcs.length}</Text>
                                </View>
                              </View>
                              <IconSymbol name={isExpanded ? "chevron.down" : "chevron.right"} size={14} color={isExpanded ? colors.primary : colors.muted} />
                            </Pressable>
                          )}
                          {isExpanded && svcs.map((s) => (
                            <Pressable
                              key={s.id}
                              onPress={() =>
                                addToCart({ type: "service", id: s.id, name: s.name, price: parseFloat(String(s.price)), duration: s.duration })
                              }
                              style={({ pressed }) => [
                                styles.optionCard,
                                { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1, marginLeft: hasMultiCat ? 8 : 0 },
                              ]}
                            >
                              {s.photoUri ? (
                                <Image source={{ uri: s.photoUri }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12 }} />
                              ) : (
                                <View style={[styles.colorDot, { backgroundColor: s.color }]} />
                              )}
                              <View style={styles.optionContent}>
                                <Text className="text-sm font-semibold text-foreground">{s.name}</Text>
                                <Text className="text-xs text-muted">{s.duration} min</Text>
                              </View>
                              <Text className="text-sm font-bold" style={{ color: colors.primary }}>+ ${parseFloat(String(s.price)).toFixed(2)}</Text>
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

          {/* Products — quantity controls */}
          {addMoreTab === "products" && (
            <View className="mb-4">
              {availableProducts.length === 0 ? (
                <View className="items-center py-6 bg-surface rounded-xl border border-border">
                  <Text className="text-xs text-muted">No products available</Text>
                </View>
              ) : (() => {
                const brandGroups = new Map<string, typeof availableProducts>();
                availableProducts.forEach((p) => {
                  const brand = p.brand?.trim() || "Other";
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
                                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: isExpanded ? colors.primary : colors.foreground }}>{brand}</Text>
                                <View style={{ backgroundColor: colors.primary + "20", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary }}>{prods.length}</Text>
                                </View>
                              </View>
                              <IconSymbol name={isExpanded ? "chevron.down" : "chevron.right"} size={14} color={isExpanded ? colors.primary : colors.muted} />
                            </Pressable>
                          )}
                          {isExpanded && prods.map((p) => {
                            const qty = productQty[p.id] ?? 0;
                            return (
                              <View
                                key={p.id}
                                style={[
                                  styles.optionCard,
                                  { backgroundColor: qty > 0 ? colors.primary + "10" : colors.surface, borderColor: qty > 0 ? colors.primary : colors.border, marginLeft: hasMultiBrand ? 8 : 0 },
                                ]}
                              >
                                {p.photoUri ? (
                                  <Image source={{ uri: p.photoUri }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12 }} />
                                ) : (
                                  <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                                    <IconSymbol name="bag.fill" size={18} color={colors.primary} />
                                  </View>
                                )}
                                <View style={styles.optionContent}>
                                  <Text className="text-sm font-semibold text-foreground">{p.name}</Text>
                                  {p.description ? <Text className="text-xs text-muted" numberOfLines={1}>{p.description}</Text> : null}
                                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary, marginTop: 2 }}>${parseFloat(String(p.price)).toFixed(2)}</Text>
                                </View>
                                {/* Quantity stepper */}
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 0 }}>
                                  <Pressable
                                    onPress={() => setProductQtyAndSync(p.id, qty - 1)}
                                    style={({ pressed }) => ({
                                      width: 32, height: 32, borderRadius: 16,
                                      backgroundColor: qty > 0 ? colors.error + "18" : colors.surface,
                                      borderWidth: 1, borderColor: qty > 0 ? colors.error + "60" : colors.border,
                                      alignItems: "center", justifyContent: "center",
                                      opacity: pressed ? 0.6 : qty > 0 ? 1 : 0.35,
                                    })}
                                    disabled={qty === 0}
                                  >
                                    <Text style={{ fontSize: fs.md, fontWeight: "700", color: qty > 0 ? colors.error : colors.muted, lineHeight: 22 }}>−</Text>
                                  </Pressable>
                                  <Text style={{ minWidth: 28, textAlign: "center", fontSize: fs.sm, fontWeight: "700", color: qty > 0 ? colors.primary : colors.muted }}>{qty}</Text>
                                  <Pressable
                                    onPress={() => setProductQtyAndSync(p.id, qty + 1)}
                                    style={({ pressed }) => ({
                                      width: 32, height: 32, borderRadius: 16,
                                      backgroundColor: colors.primary + "18",
                                      borderWidth: 1, borderColor: colors.primary + "60",
                                      alignItems: "center", justifyContent: "center",
                                      opacity: pressed ? 0.6 : 1,
                                    })}
                                  >
                                    <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary, lineHeight: 22 }}>+</Text>
                                  </Pressable>
                                </View>
                              </View>
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

          {/* Booking Summary */}
          {selectedTime && (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              <Text className="text-xs text-muted mb-2">Booking Summary</Text>
              <View className="flex-row items-center mb-2">
                <View
                  style={[
                    styles.summaryDot,
                    { backgroundColor: selectedService?.color ?? colors.primary },
                  ]}
                />
                <Text className="text-base font-semibold text-foreground ml-2">
                  {selectedPackage ? selectedPackage.name : selectedService?.name}
                  {cart.length > 0 ? ` + ${cart.length} more` : ""}
                </Text>
              </View>
              <Text className="text-sm text-muted">
                {selectedClient?.name} · {formatDateDisplay(selectedDate)}
              </Text>
              {selectedStaff && (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2, gap: 4 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: selectedStaff.color || colors.primary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#FFF", fontSize: 8, fontWeight: "700" }}>{selectedStaff.name.charAt(0)}</Text>
                  </View>
                  <Text className="text-sm text-muted">{selectedStaff.name}</Text>
                </View>
              )}
              <Text className="text-sm text-muted">
                {formatTime(selectedTime)} - {getEndTime(selectedTime)} ({totalDuration} min)
              </Text>
              {appliedDiscount && discountAmount > 0 ? (
                <View style={{ marginTop: 2 }}>
                  <Text style={{ fontSize: fs.xs, color: colors.warning }}>{appliedDiscount.name} ({appliedDiscount.percentage}% off)</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, textDecorationLine: "line-through" }}>${subtotal.toFixed(2)}</Text>
                    <Text className="text-sm font-semibold" style={{ color: colors.primary }}>Total: ${grandTotal.toFixed(2)}</Text>
                  </View>
                </View>
              ) : (
                <Text className="text-sm font-semibold" style={{ color: colors.primary, marginTop: 2 }}>
                  Total: ${grandTotal.toFixed(2)}
                </Text>
              )}
            </View>
          )}

          {/* Recurring Option */}
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <Text className="text-xs text-muted mb-2">Repeat Appointment</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["none", "weekly", "biweekly", "monthly"] as const).map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => setRecurring(opt)}
                  style={({ pressed }) => [{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    backgroundColor: recurring === opt ? colors.primary : colors.background,
                    borderColor: recurring === opt ? colors.primary : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  }]}
                >
                  <Text style={{ fontSize: fs.xs, fontWeight: "500", color: recurring === opt ? "#FFFFFF" : colors.foreground }}>
                    {opt === "none" ? "One-time" : opt === "weekly" ? "Weekly" : opt === "biweekly" ? "Bi-weekly" : "Monthly"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {recurring !== "none" && (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
                {recurring === "weekly" ? "8 appointments" : recurring === "biweekly" ? "6 appointments" : "4 appointments"} will be created
              </Text>
            )}
          </View>

          {/* Continue to Payment Button */}
          {(() => {
            // Disable Continue when multiple locations have the selected time but none is chosen
            const locationsForSelectedTime = isAllMode && selectedTime
              ? activeLocations.filter((loc) => !loc.temporarilyClosed && locationTimeAvailable[loc.id] === true)
              : [];
            const needsLocationSelection = isAllMode && !!selectedTime && locationsForSelectedTime.length > 1 && !selectedLocationId;
            const canContinue = !!selectedTime && !needsLocationSelection;
            return (
              <>
                {needsLocationSelection && (
                  <Text style={{ fontSize: fs.xs, color: colors.warning, textAlign: "center", marginBottom: 8 }}>
                    Please select a location above to continue
                  </Text>
                )}
                <Pressable
                  onPress={() => {
                    if (!canContinue) return;
                    setStep(5);
                  }}
                  style={({ pressed }) => [
                    styles.bookButton,
                    {
                      backgroundColor: canContinue ? colors.primary : colors.muted,
                      opacity: pressed && canContinue ? 0.8 : 1,
                    },
                  ]}
                  disabled={!canContinue}
                >
                  <Text className="text-base font-semibold text-white">Continue to Payment →</Text>
                </Pressable>
              </>
            );
          })()}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Step 5: Payment Method ── */}
      {step === 5 && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable onPress={() => setStep(4)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
              <Text className="text-sm" style={{ color: colors.primary }}>← Back</Text>
            </Pressable>
            <Text className="text-base font-semibold text-foreground">Payment Method</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Amount Due */}
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <Text className="text-xs font-medium text-muted mb-1">Amount Due</Text>
            <Text className="text-2xl font-bold" style={{ color: colors.primary }}>${grandTotal.toFixed(2)}</Text>
            {selectedService && <Text className="text-xs text-muted mt-1">{selectedService.name}{cart.length > 0 ? ` + ${cart.length} extra item${cart.length > 1 ? 's' : ''}` : ''}</Text>}
          </View>

          {/* Payment Options */}
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <Text className="text-xs font-medium text-muted mb-3">How will the client pay?</Text>
            {(() => {
              const pm = state.settings;
              const opts: { id: string; label: string; sub: string; color: string }[] = [];
              if (pm.zelleHandle) opts.push({ id: 'zelle', label: '💜 Zelle', sub: pm.zelleHandle, color: '#6d28d9' });
              if (pm.cashAppHandle) opts.push({ id: 'cashapp', label: '💚 Cash App', sub: pm.cashAppHandle.startsWith('$') ? pm.cashAppHandle : '$' + pm.cashAppHandle, color: '#00d632' });
              if (pm.venmoHandle) opts.push({ id: 'venmo', label: '💙 Venmo', sub: pm.venmoHandle.startsWith('@') ? pm.venmoHandle : '@' + pm.venmoHandle, color: '#3d95ce' });
              opts.push({ id: 'cash', label: '💵 Cash', sub: 'Collect in person', color: '#888' });
              // Add card option if Stripe is connected
              if ((state.settings as any).stripeConnectEnabled) {
                opts.unshift({ id: 'card', label: '💳 Charge Card Now', sub: 'Enter client card details via Stripe', color: '#635BFF' });
              }
              return opts.map((opt) => (
                <Pressable
                  key={opt.id}
                  onPress={() => setSelectedPaymentMethod(opt.id)}
                  style={[{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    padding: 14, borderRadius: 14, marginBottom: 8,
                    borderWidth: 2,
                    borderColor: selectedPaymentMethod === opt.id ? opt.color : colors.border,
                    backgroundColor: selectedPaymentMethod === opt.id ? opt.color + '18' : colors.background,
                  }]}
                >
                  <Text style={{ fontSize: fs.lg }}>{opt.label.split(' ')[0]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', fontSize: fs.sm, color: colors.foreground }}>{opt.label.slice(opt.label.indexOf(' ') + 1)}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{opt.sub}</Text>
                  </View>
                  {selectedPaymentMethod === opt.id && (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: opt.color, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: fs.xs, fontWeight: '700' }}>✓</Text>
                    </View>
                  )}
                </Pressable>
              ));
            })()}
          </View>

          {/* Confirm Booking Button */}
          <Pressable
            onPress={() => {
              if (!selectedPaymentMethod) {
                Alert.alert('Payment Method', 'Please select a payment method to continue.');
                return;
              }
              handleBook();
            }}
            disabled={chargingCard}
            style={({ pressed }) => [styles.bookButton, { backgroundColor: selectedPaymentMethod ? (selectedPaymentMethod === 'card' ? '#635BFF' : colors.primary) : colors.muted, opacity: (pressed || chargingCard) ? 0.8 : 1 }]}
          >
            <Text className="text-base font-semibold text-white">
              {chargingCard ? 'Processing Payment…' : selectedPaymentMethod === 'card' ? '💳 Book & Charge Card' : (recurring !== 'none' ? `Book ${recurring === 'weekly' ? 8 : recurring === 'biweekly' ? 6 : 4} Appointments` : 'Confirm Booking')}
            </Text>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
      {/* Note Templates Picker Modal */}
      <Modal
        visible={showTemplatesPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTemplatesPicker(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Pressable onPress={() => setShowTemplatesPicker(false)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
              <Text style={{ fontSize: fs.md, color: colors.muted }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Note Templates</Text>
            <View style={{ width: 60 }} />
          </View>
          <FlatList
            data={state.noteTemplates ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setNotes((prev) => prev ? `${prev}\n${item.body}` : item.body);
                  setShowTemplatesPicker(false);
                }}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? colors.primary + "15" : colors.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 14,
                  marginBottom: 10,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>{item.title}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, lineHeight: 18 }} numberOfLines={3}>{item.body}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    width: "100%",
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
  dateChip: {
    minWidth: 56,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  timeChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 84,
    minHeight: 38,
  },
  summaryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  bookButton: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
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
});
