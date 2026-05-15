import {
  Text,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  Linking,
  Platform,
  Image,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId, formatDateStr, formatTime, formatDateDisplay } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useResponsive } from "@/hooks/use-responsive";
import { FuturisticBackground } from "@/components/futuristic-background";

import {
  Appointment,
  Client,
  DAYS_OF_WEEK,
  generateAvailableSlots,
  getServiceDisplayName,
  formatPhoneNumber,
  stripPhoneFormat,
  getMapUrl,
  minutesToTime,
  timeToMinutes,
  formatDateLong,
  formatTimeDisplay,
  isDateInPast,
  getApplicableDiscount,
  Discount,
  GiftCard,
  Location,
  Product,
  formatFullAddress,
} from "@/lib/types";

// "location" is the new first step when the business has multiple active locations
type BookingStep = "location" | "info" | "service" | "staff" | "address" | "datetime" | "products" | "confirm" | "done";

export default function PublicBookingScreen() {
  const { state, dispatch, getServiceById, syncToDb, getStaffById } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();

  // Read optional location pre-selection from URL params (e.g. ?location=<locationId>)
  const { location: locationParam } = useLocalSearchParams<{ location?: string }>();

  // Active locations for this business
  const activeLocations = useMemo(
    () => state.locations.filter((l) => l.active !== false),
    [state.locations]
  );
  const hasMultipleLocations = activeLocations.length > 1;

  // If a locationParam is provided and valid, pre-select it and skip the location step
  const preselectedLocationId = useMemo(() => {
    if (!locationParam) return null;
    const found = activeLocations.find((l) => l.id === locationParam);
    return found ? found.id : null;
  }, [locationParam, activeLocations]);

  // Start at "location" step when multiple locations exist and no pre-selection, otherwise skip to "info"
  const [refreshKey, setRefreshKey] = useState(0);
  const [step, setStep] = useState<BookingStep>(() => {
    if (preselectedLocationId) return "info";
    return hasMultipleLocations ? "location" : "info";
  });
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    if (preselectedLocationId) return preselectedLocationId;
    return hasMultipleLocations ? null : (activeLocations[0]?.id ?? null);
  });

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(formatDateStr(new Date()));
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [giftCode, setGiftCode] = useState("");
  const [giftApplied, setGiftApplied] = useState<string | null>(null);

  // ── Client address (mobile services only) ─────────────────────────────────
  const [addrStreet, setAddrStreet] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  // OSRM travel time + distance estimate
  const [travelTimeEstimate, setTravelTimeEstimate] = useState<string | null>(null);
  const [travelTimeLoading, setTravelTimeLoading] = useState(false);
  const [dynamicTravelFee, setDynamicTravelFee] = useState<number | null>(null);
  const [routeDistanceMiles, setRouteDistanceMiles] = useState<number | null>(null);
  const [outsideServiceArea, setOutsideServiceArea] = useState(false);

  // ── Service drill-down state ───────────────────────────────────────────────
  // null = show category tiles; string = show services in that category; "__all__" = no categories exist
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
  // Service detail bottom sheet
  const [serviceDetailId, setServiceDetailId] = useState<string | null>(null);

  // ── Products step state ────────────────────────────────────────────────────
  // Cart: map of productId → quantity
  const [productCart, setProductCart] = useState<Record<string, number>>({});
  // null = show brand tiles; string = show products in that brand; "__all__" = no brands exist
  const [selectedBrandFilter, setSelectedBrandFilter] = useState<string | null>(null);
  // Product detail bottom sheet
  const [productDetailId, setProductDetailId] = useState<string | null>(null);
  // Available products (only available=true)
  const availableProducts = useMemo(
    () => state.products.filter((p) => p.available !== false),
    [state.products]
  );
  // Unique brands from available products
  const productBrands = useMemo(() => {
    const brands = new Set<string>();
    availableProducts.forEach((p) => { if (p.brand) brands.add(p.brand); });
    return Array.from(brands).sort();
  }, [availableProducts]);
  // Products filtered by selected brand
  const filteredProducts = useMemo(() => {
    if (!selectedBrandFilter || selectedBrandFilter === "__all__") return availableProducts;
    return availableProducts.filter((p) => p.brand === selectedBrandFilter);
  }, [availableProducts, selectedBrandFilter]);
  // Total cart items count
  const cartCount = useMemo(() => Object.values(productCart).reduce((a, b) => a + b, 0), [productCart]);
  // Cart total price
  const cartTotal = useMemo(() => {
    return availableProducts.reduce((sum, p) => sum + (productCart[p.id] ?? 0) * p.price, 0);
  }, [availableProducts, productCart]);
  // Selected product detail
  const productDetail: Product | null = productDetailId ? availableProducts.find((p) => p.id === productDetailId) ?? null : null;

  // Resolve package selection (pkg: prefix)
  const selectedPackage = useMemo(() => {
    if (!selectedServiceId?.startsWith("pkg:")) return null;
    const pkgId = selectedServiceId.slice(4);
    return (state.packages ?? []).find((p) => p.id === pkgId) ?? null;
  }, [selectedServiceId, state.packages]);

  const selectedService = useMemo(() => {
    if (!selectedServiceId || selectedServiceId.startsWith("pkg:")) return null;
    return getServiceById(selectedServiceId);
  }, [selectedServiceId, getServiceById]);

  const isMobileService = selectedService?.serviceType === 'mobile';
  const travelFeeAmount = isMobileService && addrStreet.trim()
    ? ((selectedService as any)?.distanceFeeEnabled && dynamicTravelFee != null
        ? dynamicTravelFee
        : ((selectedService?.travelFee as unknown as number) || 0))
    : 0;
  const fullClientAddress = [addrStreet.trim(), addrCity.trim(), addrState.trim(), addrZip.trim()].filter(Boolean).join(", ");

  // OSRM distance + travel time estimate for mobile services
  useEffect(() => {
    const allFilled = addrStreet.trim() && addrCity.trim() && addrState.trim() && addrZip.trim();
    if (!allFilled || !isMobileService) {
      setTravelTimeEstimate(null); setDynamicTravelFee(null); setRouteDistanceMiles(null); setOutsideServiceArea(false);
      return;
    }
    const bizLoc = selectedLocation ?? (state.locations.length > 0 ? state.locations[0] : null);
    const bizAddr = bizLoc
      ? [bizLoc.address, bizLoc.city, bizLoc.state, bizLoc.zipCode].filter(Boolean).join(', ')
      : null;
    if (!bizAddr) { setTravelTimeEstimate(null); return; }
    const destAddr = [addrStreet.trim(), addrCity.trim(), addrState.trim(), addrZip.trim()].filter(Boolean).join(', ');
    let cancelled = false;
    const geocode = async (addr: string): Promise<[number, number] | null> => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`, { headers: { 'User-Agent': 'LimeOfTime/1.0' } });
        const data = await res.json();
        if (!data || data.length === 0) return null;
        return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
      } catch { return null; }
    };
    const estimate = async () => {
      setTravelTimeLoading(true); setTravelTimeEstimate(null); setDynamicTravelFee(null); setRouteDistanceMiles(null); setOutsideServiceArea(false);
      const [origin, dest] = await Promise.all([geocode(bizAddr), geocode(destAddr)]);
      if (cancelled) return;
      if (!origin || !dest) { setTravelTimeLoading(false); return; }
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${dest[0]},${dest[1]}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (data?.routes?.[0]) {
          const route = data.routes[0];
          const mins = Math.round(route.duration / 60);
          const distMiles = (route.distance as number) / 1609.344;
          setRouteDistanceMiles(distMiles);
          setTravelTimeEstimate(`~${mins} min drive · ${distMiles.toFixed(1)} mi`);
          if ((selectedService as any)?.maxTravelDistance && distMiles > (selectedService as any).maxTravelDistance) setOutsideServiceArea(true);
          if ((selectedService as any)?.distanceFeeEnabled) {
            const rate = (selectedService as any).travelRatePerMile ?? 0.67;
            const freeThreshold = (selectedService as any).freeMiles ?? 0;
            const billableMiles = Math.max(0, distMiles - freeThreshold);
            let fee = billableMiles * rate;
            if ((selectedService as any).minTravelFee != null && fee < (selectedService as any).minTravelFee && billableMiles > 0) fee = (selectedService as any).minTravelFee;
            setDynamicTravelFee(Math.round(fee * 100) / 100);
          }
        }
      } catch { /* ignore */ }
      setTravelTimeLoading(false);
    };
    const debounce = setTimeout(estimate, 800);
    return () => { cancelled = true; clearTimeout(debounce); };
  }, [addrStreet, addrCity, addrState, addrZip, isMobileService]); // eslint-disable-line react-hooks/exhaustive-deps

  const businessName = state.settings.businessName || "Our Business";
  const profile = state.settings.profile;
  const businessLogoUri = profile.businessLogoUri;
  const isClosed = state.settings.temporaryClosed;

  // Resolve the selected location object
  const selectedLocation = useMemo(
    () => (selectedLocationId ? state.locations.find((l) => l.id === selectedLocationId) ?? null : null),
    [selectedLocationId, state.locations]
  );

  // ── Location-scoped working hours ──────────────────────────────────────────
  const locationWorkingHours = useMemo(() => {
    if (selectedLocation?.workingHours && Object.keys(selectedLocation.workingHours).length > 0) {
      return selectedLocation.workingHours;
    }
    return state.settings.workingHours;
  }, [selectedLocation, state.settings.workingHours]);

  // ── Location-scoped custom schedule ───────────────────────────────────────
  const locationCustomSchedule = useMemo(() => {
    if (selectedLocationId) {
      // Merge global (no locationId) entries with location-specific ones.
      // Location-specific entries take precedence for the same date.
      const locEntries = state.locationCustomSchedule[selectedLocationId] ?? [];
      const locDates = new Set(locEntries.map((cs) => cs.date));
      const globalFallback = state.customSchedule.filter((cs) => !locDates.has(cs.date));
      return [...locEntries, ...globalFallback];
    }
    return state.customSchedule;
  }, [selectedLocationId, state.locationCustomSchedule, state.customSchedule]);

  // ── Location-scoped appointments ──────────────────────────────────────────
  const locationAppointments = useMemo(() => {
    if (!selectedLocationId) return state.appointments;
    return state.appointments.filter((a) => a.locationId === selectedLocationId);
  }, [selectedLocationId, state.appointments]);

  // ── Location-scoped services (null locationIds = available everywhere) ────
  const locationServices = useMemo(() => {
    return state.services.filter((s) => {
      if (!s.locationIds || s.locationIds.length === 0) return true;
      if (!selectedLocationId) return true;
      return s.locationIds.includes(selectedLocationId);
    });
  }, [state.services, selectedLocationId]);

  const handlePhoneChange = (text: string) => {
    setClientPhone(formatPhoneNumber(text));
  };

  // Resolve effective duration: package total or service duration
  const effectiveDuration = useMemo(() => {
    if (selectedPackage) {
      return selectedPackage.serviceIds
        .map((id) => state.services.find((s) => s.id === id))
        .filter(Boolean)
        .reduce((sum, sv) => sum + (sv?.duration ?? 0), 0) || state.settings.defaultDuration;
    }
    return selectedService?.duration ?? state.settings.defaultDuration;
  }, [selectedPackage, selectedService, state.services, state.settings.defaultDuration]);

  // Effective slot step: use configured slotInterval when non-zero, else auto (service duration capped at 30)
  const effectiveStep = useMemo(() => {
    const configured = (state.settings as any).slotInterval ?? 0;
    return configured > 0 ? configured : Math.min(effectiveDuration, 30);
  }, [(state.settings as any).slotInterval, effectiveDuration]);

  // Generate available time slots using location-scoped data
  const timeSlots = useMemo(() => {
    return generateAvailableSlots(
      selectedDate,
      effectiveDuration,
      locationWorkingHours,
      locationAppointments,
      effectiveStep,
      locationCustomSchedule,
      state.settings.scheduleMode,
      state.settings.bufferTime ?? 0
    );
  }, [selectedDate, locationWorkingHours, locationAppointments, effectiveDuration, locationCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime, effectiveStep, refreshKey]);

  // Date options: next 30 days — mark closed days and days with no available slots
  const dateOptions = useMemo(() => {
    const dates: { date: string; closed: boolean; noSlots: boolean }[] = [];
    const today = new Date();
    const duration = effectiveDuration;
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const ds = formatDateStr(d);
      const customDay = locationCustomSchedule.find((cs) => cs.date === ds);
      let closed = false;
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
      let noSlots = false;
      if (!closed) {
        const slots = generateAvailableSlots(ds, duration, locationWorkingHours, locationAppointments, effectiveStep, locationCustomSchedule, state.settings.scheduleMode, state.settings.bufferTime ?? 0);
        noSlots = slots.length === 0;
      }
      dates.push({ date: ds, closed, noSlots });
    }
    return dates;
  }, [locationCustomSchedule, locationWorkingHours, locationAppointments, selectedService, state.settings.defaultDuration, state.settings.scheduleMode, state.settings.bufferTime]);

  // Get applicable discount for selected time
  const applicableDiscount = useMemo((): Discount | null => {
    if (!selectedServiceId || !selectedTime) return null;
    return getApplicableDiscount(state.discounts, selectedDate, selectedTime, selectedServiceId);
  }, [state.discounts, selectedDate, selectedTime, selectedServiceId]);

  // Gift card validation
  const handleApplyGiftCode = useCallback(() => {
    if (!giftCode.trim()) return;
    const card = state.giftCards.find((g) => g.code.toUpperCase() === giftCode.trim().toUpperCase() && (g.remainingBalance > 0 || (!g.redeemed)));
    if (!card) { setGiftApplied(null); return; }
    if (card.expiresAt && new Date(card.expiresAt) < new Date()) { setGiftApplied(null); return; }
    if (card.remainingBalance <= 0) { setGiftApplied(null); return; }
    setGiftApplied(card.id);
    if (card.serviceLocalId) setSelectedServiceId(card.serviceLocalId);
  }, [giftCode, state.giftCards]);

  const appliedGiftCard = giftApplied ? state.giftCards.find((g) => g.id === giftApplied) : null;

  const priceInfo = useMemo(() => {
    if (!selectedService && !selectedPackage) return { original: 0, final: 0, discountPct: 0, isGift: false, giftUsed: 0 };
    const original = selectedPackage ? selectedPackage.price : (selectedService?.price ?? 0);
    if (appliedGiftCard) {
      const balance = appliedGiftCard.remainingBalance ?? 0;
      const giftUsed = Math.min(balance, original);
      return { original, final: Math.max(0, original - balance), discountPct: 0, isGift: true, giftUsed };
    }
    if (applicableDiscount) {
      const discounted = original * (1 - applicableDiscount.percentage / 100);
      return { original, final: Math.round(discounted * 100) / 100, discountPct: applicableDiscount.percentage, isGift: false, giftUsed: 0 };
    }
    return { original, final: original, discountPct: 0, isGift: false, giftUsed: 0 };
  }, [selectedService, applicableDiscount, appliedGiftCard]);

  const handleConfirmBooking = useCallback(() => {
    if (!selectedServiceId || !selectedTime || !clientName.trim()) return;

    const existingClient = state.clients.find(
      (c) => stripPhoneFormat(c.phone) === stripPhoneFormat(clientPhone) && stripPhoneFormat(clientPhone) !== ""
    );
    let clientId: string;
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      clientId = generateId();
      const newClient: Client = {
        id: clientId,
        name: clientName.trim(),
        phone: clientPhone.trim(),
        email: clientEmail.trim(),
        notes: "Added via booking link",
        birthday: "",
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_CLIENT", payload: newClient });
      syncToDb({ type: "ADD_CLIENT", payload: newClient });
    }

    // Build extra items from cart
    const cartExtraItems = Object.entries(productCart)
      .filter(([, qty]) => qty > 0)
      .flatMap(([productId, qty]) => {
        const product = state.products.find((p) => p.id === productId);
        if (!product) return [];
        // Each unit is a separate line item (matching AppointmentExtraItem shape)
        return Array.from({ length: qty }, () => ({
          type: "product" as const,
          id: product.id,
          name: product.name,
          price: product.price,
          duration: 0,
        }));
      });

    // Resolve service ID: for packages use the first service in the package
    const resolvedServiceId = selectedPackage
      ? (selectedPackage.serviceIds[0] ?? selectedServiceId)
      : selectedServiceId;

    const appointment: Appointment = {
      id: generateId(),
      serviceId: resolvedServiceId!,
      clientId,
      date: selectedDate,
      time: selectedTime,
      duration: effectiveDuration,
      status: "pending",
      notes: selectedPackage
        ? (notes.trim() ? `${notes.trim()}\nPackage: ${selectedPackage.name}` : `Package: ${selectedPackage.name}`)
        : notes.trim(),
      createdAt: new Date().toISOString(),
      totalPrice: priceInfo.final + cartTotal,
      discountPercent: priceInfo.discountPct > 0 ? priceInfo.discountPct : undefined,
      discountAmount: priceInfo.discountPct > 0 ? Math.round((priceInfo.original - priceInfo.final) * 100) / 100 : undefined,
      discountName: applicableDiscount ? applicableDiscount.name : undefined,
      giftApplied: priceInfo.isGift,
      giftUsedAmount: priceInfo.giftUsed > 0 ? priceInfo.giftUsed : undefined,
      // Attach the selected location so the appointment is properly scoped
      locationId: selectedLocationId ?? undefined,
      staffId: selectedStaffId ?? undefined,
      extraItems: cartExtraItems.length > 0 ? cartExtraItems : undefined,
      clientAddress: isMobileService && fullClientAddress.trim() ? fullClientAddress.trim() : undefined,
      travelFee: travelFeeAmount > 0 ? travelFeeAmount : undefined,
      // Auto-mark as paid when total charge is $0 (fully discounted / gift card / free service)
      ...(priceInfo.final + cartTotal <= 0 ? { paymentStatus: 'paid' as const, paymentMethod: 'free' as any } : {}),
    };
    dispatch({ type: "ADD_APPOINTMENT", payload: appointment });
    syncToDb({ type: "ADD_APPOINTMENT", payload: appointment });

    if (appliedGiftCard) {
      const giftUsed = priceInfo.giftUsed;
      const newBalance = Math.max(0, (appliedGiftCard.remainingBalance ?? 0) - giftUsed);
      const fullyRedeemed = newBalance <= 0;
      const updatedGift: GiftCard = {
        ...appliedGiftCard,
        remainingBalance: newBalance,
        redeemed: fullyRedeemed,
        redeemedAt: fullyRedeemed ? new Date().toISOString() : appliedGiftCard.redeemedAt,
      };
      dispatch({ type: "UPDATE_GIFT_CARD", payload: updatedGift });
      syncToDb({ type: "UPDATE_GIFT_CARD", payload: updatedGift });
    }

    setStep("done");
  }, [selectedServiceId, selectedTime, clientName, clientPhone, clientEmail, notes, selectedDate, selectedService, selectedPackage, effectiveDuration, state, dispatch, appliedGiftCard, syncToDb, priceInfo, selectedLocationId, selectedStaffId, applicableDiscount, productCart, cartTotal]);

  // Resolve the address to show: use selected location's full address if available, else global profile
  const displayAddress = selectedLocation
    ? formatFullAddress(selectedLocation.address, selectedLocation.city, selectedLocation.state, selectedLocation.zipCode)
    : formatFullAddress(profile.address);
  const openMap = useCallback(() => {
    if (displayAddress) Linking.openURL(getMapUrl(displayAddress));
  }, [displayAddress]);

  const endTimeStr = useMemo(() => {
    if (!selectedTime || (!selectedService && !selectedPackage)) return "";
    return formatTimeDisplay(minutesToTime(timeToMinutes(selectedTime) + effectiveDuration));
  }, [selectedTime, selectedService, selectedPackage, effectiveDuration]);

  // If the pre-selected location (from URL param) is temporarily closed, show a gate screen
  const isLocationTemporarilyClosed = selectedLocation?.temporarilyClosed === true;

  if (isLocationTemporarilyClosed) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} style={{ paddingHorizontal: hp }}>
      <FuturisticBackground />
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            {businessLogoUri ? (
              <Image source={{ uri: businessLogoUri }} style={{ width: 32, height: 32, borderRadius: 8, marginBottom: 3 }} resizeMode="cover" />
            ) : null}
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Book with {businessName}</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Powered by Lime Of Time</Text>
          </View>
          <View style={{ width: 24 }} />
        </View>

        {/* Temporarily Closed Gate */}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: colors.warning + "20",
            alignItems: "center", justifyContent: "center",
            marginBottom: 20,
          }}>
            <IconSymbol name="exclamationmark.triangle.fill" size={36} color={colors.warning} />
          </View>
          <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, textAlign: "center", marginBottom: 12 }}>
            Location Temporarily Unavailable
          </Text>
          <Text style={{ fontSize: fs.sm, color: colors.muted, textAlign: "center", lineHeight: 22, marginBottom: 8 }}>
            <Text style={{ fontWeight: "600", color: colors.foreground }}>{selectedLocation?.name}</Text>
            {" is temporarily closed and not accepting new bookings at this time."}
          </Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, textAlign: "center", lineHeight: 20 }}>
            Please check back later or contact us directly to schedule your appointment.
          </Text>
          {profile.phone ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${profile.phone}`)}
              style={({ pressed }) => ({
                marginTop: 28,
                flexDirection: "row", alignItems: "center", gap: 8,
                backgroundColor: colors.primary + "18",
                borderColor: colors.primary + "40",
                borderWidth: 1,
                borderRadius: 12,
                paddingHorizontal: 20, paddingVertical: 12,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <IconSymbol name="phone.fill" size={16} color={colors.primary} />
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.primary }}>
                {formatPhoneNumber(stripPhoneFormat(profile.phone))}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={720} className="pt-2" style={{ paddingHorizontal: hp }}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (step === "info" && hasMultipleLocations) { setStep("location"); return; }
            router.back();
          }}
          style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          {businessLogoUri ? (
            <Image source={{ uri: businessLogoUri }} style={{ width: 32, height: 32, borderRadius: 8, marginBottom: 3 }} resizeMode="cover" />
          ) : null}
          <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Book with {businessName}</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Powered by Lime Of Time</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Step Progress Indicator */}
      {step !== "done" && (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 14 }}>
          {(hasMultipleLocations
            ? (isMobileService ? ["location", "info", "service", "staff", "address", "datetime", "products", "confirm"] : ["location", "info", "service", "staff", "datetime", "products", "confirm"])
            : (isMobileService ? ["info", "service", "staff", "address", "datetime", "products", "confirm"] : ["info", "service", "staff", "datetime", "products", "confirm"])
          ).map((s, i) => {
            const steps = hasMultipleLocations
              ? (isMobileService ? ["location", "info", "service", "staff", "address", "datetime", "products", "confirm"] : ["location", "info", "service", "staff", "datetime", "products", "confirm"])
              : (isMobileService ? ["info", "service", "staff", "address", "datetime", "products", "confirm"] : ["info", "service", "staff", "datetime", "products", "confirm"]);
            const currentIdx = steps.indexOf(step);
            const isActive = s === step;
            const isPast = steps.indexOf(s) < currentIdx;
            return (
              <View
                key={s}
                style={{
                  height: 4,
                  width: isActive ? 28 : 16,
                  borderRadius: 2,
                  backgroundColor: isActive ? colors.primary : isPast ? colors.primary + "60" : colors.border,
                }}
              />
            );
          })}
        </View>
      )}

      {/* Business Info Card — show selected location info when available */}
      <View style={[styles.bizInfoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
          {selectedLocation ? selectedLocation.name : businessName}
        </Text>
        {displayAddress ? (
          <Pressable onPress={openMap} style={({ pressed }) => [styles.bizInfoRow, { opacity: pressed ? 0.6 : 1 }]}>
            <IconSymbol name="mappin" size={14} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, color: colors.primary, marginLeft: 8, flex: 1, textDecorationLine: "underline" }}>{displayAddress}</Text>
          </Pressable>
        ) : null}
        {(selectedLocation?.phone || profile.phone) ? (
          <View style={styles.bizInfoRow}>
            <IconSymbol name="phone.fill" size={14} color={colors.muted} />
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 8 }}>{formatPhoneNumber(stripPhoneFormat(selectedLocation?.phone || profile.phone || ""))}</Text>
          </View>
        ) : null}
        {profile.email ? (
          <View style={styles.bizInfoRow}>
            <IconSymbol name="envelope.fill" size={14} color={colors.muted} />
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 8 }}>{profile.email}</Text>
          </View>
        ) : null}
        {profile.website ? (
          <View style={styles.bizInfoRow}>
            <IconSymbol name="globe" size={14} color={colors.muted} />
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 8 }}>{profile.website}</Text>
          </View>
        ) : null}
      </View>

      {/* Temporary Closed Banner */}
      {isClosed && (
        <View style={[styles.closedBanner, { backgroundColor: colors.error + "15", borderColor: colors.error + "30" }]}>
          <IconSymbol name="xmark.circle.fill" size={18} color={colors.error} />
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.error, marginLeft: 8 }}>
            {businessName} is temporarily closed
          </Text>
        </View>
      )}

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={{ paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}>
        {/* Closed message */}
        {isClosed && step !== "location" && (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <Text style={{ fontSize: fs.md, color: colors.muted, textAlign: "center", lineHeight: 24 }}>
              {businessName} is not accepting bookings at this time. Please check back later.
            </Text>
          </View>
        )}

        {/* ── Step: Choose Location ─────────────────────────────────────────── */}
        {step === "location" && (
          <View>
            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.iconRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name="mappin" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>Choose a Location</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Select the location you'd like to visit</Text>
                </View>
              </View>

              {activeLocations.filter((loc) => !loc.temporarilyClosed).map((loc) => (
                <Pressable
                  key={loc.id}
                  onPress={() => {
                    setSelectedLocationId(loc.id);
                    // Reset downstream selections when location changes
                    setSelectedServiceId(null);
                    setSelectedDate(formatDateStr(new Date()));
                    setSelectedTime(null);
                    setStep("info");
                  }}
                  style={({ pressed }) => [
                    {
                      borderRadius: 16,
                      marginBottom: 12,
                      borderWidth: 1.5,
                      overflow: "hidden",
                      backgroundColor: selectedLocationId === loc.id ? colors.primary + "10" : colors.surface,
                      borderColor: selectedLocationId === loc.id ? colors.primary : colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {/* Cover photo */}
                  {(loc as any).photoUri ? (
                    <Image
                      source={{ uri: (loc as any).photoUri }}
                      style={{ width: "100%", height: 110, borderTopLeftRadius: 14, borderTopRightRadius: 14 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={{ width: "100%", height: 70, backgroundColor: colors.primary + "15", alignItems: "center", justifyContent: "center" }}>
                      <IconSymbol name="mappin" size={28} color={colors.primary} />
                    </View>
                  )}
                  {/* Info row */}
                  <View style={{ flexDirection: "row", alignItems: "center", padding: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>{loc.name}</Text>
                      {loc.address ? (
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{formatFullAddress(loc.address, loc.city, loc.state, loc.zipCode)}</Text>
                      ) : null}
                      {loc.phone ? (
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>{formatPhoneNumber(stripPhoneFormat(loc.phone))}</Text>
                      ) : null}
                    </View>
                    <View style={{ backgroundColor: selectedLocationId === loc.id ? colors.primary : colors.border, borderRadius: 20, padding: 6, marginLeft: 8 }}>
                      <IconSymbol name="chevron.right" size={14} color={selectedLocationId === loc.id ? "#fff" : colors.muted} />
                    </View>
                  </View>
                </Pressable>
              ))}

              {activeLocations.filter((loc) => !loc.temporarilyClosed).length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <Text style={{ fontSize: fs.sm, color: colors.muted }}>No locations available at this time</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Step: Client Info ─────────────────────────────────────────────── */}
        {step === "info" && !isClosed && (
          <View>
            {/* Location badge — tap to go back and change */}
            {hasMultipleLocations && selectedLocation && (
              <Pressable
                onPress={() => setStep("location")}
                style={({ pressed }) => [styles.locationBadge, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30", opacity: pressed ? 0.7 : 1 }]}
              >
                <IconSymbol name="mappin" size={13} color={colors.primary} />
                <Text style={{ fontSize: fs.xs, color: colors.primary, marginLeft: 6, flex: 1 }}>{selectedLocation.name}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.primary }}>Change →</Text>
              </Pressable>
            )}

            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.iconRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name="person.fill" size={22} color={colors.primary} />
                </View>
                <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginLeft: 12 }}>Your Information</Text>
              </View>

              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Full Name *"
                placeholderTextColor={colors.muted}
                value={clientName}
                onChangeText={setClientName}
                returnKeyType="next"
              />
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="(000) 000-0000"
                placeholderTextColor={colors.muted}
                value={clientPhone}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                returnKeyType="next"
              />
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Email (optional)"
                placeholderTextColor={colors.muted}
                value={clientEmail}
                onChangeText={setClientEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                    marginBottom: 0,
                    height: 80,
                    textAlignVertical: "top",
                    paddingTop: 12,
                  },
                ]}
                placeholder="Special requests / notes (optional)"
                placeholderTextColor={colors.muted}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                returnKeyType="done"
              />
            </View>

            <Pressable
              onPress={() => { if (clientName.trim()) setStep("service"); }}
              style={({ pressed }) => [
                styles.continueButton,
                {
                  backgroundColor: clientName.trim() ? colors.primary : colors.muted,
                  opacity: pressed && clientName.trim() ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.continueText}>Continue</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step: Select Service ──────────────────────────────────────────── */}
        {step === "service" && (() => {
          // ── Build category map ─────────────────────────────────────────────────────────────────
          const catMap = new Map<string, typeof locationServices>();
          const uncategorized: typeof locationServices = [];
          locationServices.forEach((svc) => {
            if (svc.category?.trim()) {
              const cat = svc.category.trim();
              if (!catMap.has(cat)) catMap.set(cat, []);
              catMap.get(cat)!.push(svc);
            } else {
              uncategorized.push(svc);
            }
          });
          const hasCats = catMap.size > 0;
          const allCategories = Array.from(catMap.keys()).sort();

          // Service detail bottom sheet item
          const detailService = serviceDetailId ? getServiceById(serviceDetailId) : null;

          // ── Level 1: Category tiles ────────────────────────────────────────────────────────────────
          if (hasCats && selectedCategoryFilter === null) {
            return (
              <View>
                <Pressable onPress={() => setStep("info")} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}>
                  <Text style={{ color: colors.primary, fontSize: fs.sm }}>← Back</Text>
                </Pressable>
                <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>Choose a Category</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16 }}>Select a category to see available services</Text>
                {allCategories.map((cat) => {
                  const count = catMap.get(cat)?.length ?? 0;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setSelectedCategoryFilter(cat)}
                      style={({ pressed }) => ([
                        styles.serviceOption,
                        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1, padding: 16 },
                      ])}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>{cat}</Text>
                          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{count} service{count !== 1 ? "s" : ""}</Text>
                        </View>
                        <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                      </View>
                    </Pressable>
                  );
                })}
                {uncategorized.length > 0 && (
                  <Pressable
                    onPress={() => setSelectedCategoryFilter("__uncategorized__")}
                    style={({ pressed }) => ([
                      styles.serviceOption,
                      { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1, padding: 16 },
                    ])}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>Other Services</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{uncategorized.length} service{uncategorized.length !== 1 ? "s" : ""}</Text>
                      </View>
                      <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                    </View>
                  </Pressable>
                )}
                {locationServices.length === 0 && (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <Text style={{ fontSize: fs.sm, color: colors.muted }}>No services available at this location</Text>
                  </View>
                )}
              </View>
            );
          }

          // ── Level 2: Service list within selected category ─────────────────────────────────────────────
          const filteredServices =
            !hasCats || selectedCategoryFilter === null
              ? locationServices
              : selectedCategoryFilter === "__uncategorized__"
              ? uncategorized
              : (catMap.get(selectedCategoryFilter) ?? []);

          return (
            <View style={{ flex: 1 }}>
              {/* Back button */}
              <Pressable
                onPress={() => {
                  if (hasCats) {
                    setSelectedCategoryFilter(null);
                  } else {
                    setStep("info");
                  }
                }}
                style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}
              >
                <Text style={{ color: colors.primary, fontSize: fs.sm }}>← {hasCats ? selectedCategoryFilter === "__uncategorized__" ? "Other Services" : selectedCategoryFilter ?? "Categories" : "Back"}</Text>
              </Pressable>

              <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
                {hasCats && selectedCategoryFilter && selectedCategoryFilter !== "__uncategorized__"
                  ? selectedCategoryFilter
                  : hasCats && selectedCategoryFilter === "__uncategorized__"
                  ? "Other Services"
                  : "Choose a Service"}
              </Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16 }}>Tap a service to see full details</Text>

              {/* ── Packages & Bundles section ───────────────────────────────────── */}
              {(state.packages ?? []).filter((pkg) => pkg.active !== false).length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase" }}>Packages & Bundles</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                  </View>
                  {(state.packages ?? []).filter((pkg) => pkg.active !== false).map((pkg) => {
                    const pkgServices = pkg.serviceIds
                      .map((id) => state.services.find((s) => s.id === id))
                      .filter(Boolean);
                    const pkgDuration = pkgServices.reduce((sum, sv) => sum + (sv?.duration ?? 0), 0);
                    const isSelected = selectedServiceId === `pkg:${pkg.id}`;
                    return (
                      <Pressable
                        key={pkg.id}
                        onPress={() => {
                          setSelectedServiceId(`pkg:${pkg.id}`);
                          setSelectedStaffId(null);
                          setStep("staff");
                        }}
                        style={({ pressed }) => ([
                          styles.serviceOption,
                          {
                            backgroundColor: isSelected ? colors.primary + "15" : colors.surface,
                            borderColor: isSelected ? colors.primary : colors.primary + "40",
                            borderWidth: isSelected ? 1.5 : 1,
                            opacity: pressed ? 0.7 : 1,
                            padding: 14,
                          },
                        ])}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <View style={{ backgroundColor: colors.primary + "20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>Package</Text>
                            </View>
                            {pkg.sessions && pkg.sessions > 1 && (
                              <Text style={{ fontSize: fs.xs, color: colors.muted }}>{pkg.sessions} sessions</Text>
                            )}
                          </View>
                          <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>{pkg.name}</Text>
                          {pkgServices.length > 0 && (
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 3 }} numberOfLines={2}>
                              {pkgServices.map((sv) => sv?.name).join(" · ")}
                            </Text>
                          )}
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.primary }}>${pkg.price.toFixed(2)}</Text>
                            {pkgDuration > 0 && <Text style={{ fontSize: fs.xs, color: colors.muted }}>{pkgDuration} min total</Text>}
                          </View>
                        </View>
                        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                      </Pressable>
                    );
                  })}
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 4, gap: 8 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase" }}>Individual Services</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                  </View>
                </View>
              )}

              {filteredServices.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setServiceDetailId(item.id)}
                  style={({ pressed }) => ([
                    styles.serviceOption,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : 1,
                      padding: 0,
                      overflow: "hidden",
                    },
                  ])}
                >
                  {item.photoUri ? (
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Image
                        source={{ uri: item.photoUri }}
                        style={{ width: 80, height: 80, borderTopLeftRadius: 11, borderBottomLeftRadius: 11 }}
                        resizeMode="cover"
                      />
                      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{getServiceDisplayName(item)}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600", marginTop: 3 }}>${item.price}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>{item.duration} min{item.category ? " · " + item.category : ""}</Text>
                      </View>
                      <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginRight: 12 }} />
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", padding: 14 }}>
                      <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{getServiceDisplayName(item)}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600", marginTop: 3 }}>${item.price}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>{item.duration} min{item.category ? " · " + item.category : ""}</Text>
                      </View>
                      <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                    </View>
                  )}
                </Pressable>
              ))}

              {filteredServices.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Text style={{ fontSize: fs.sm, color: colors.muted }}>No services in this category</Text>
                </View>
              )}

              {/* ── Service Detail Bottom Sheet ──────────────────────────────────────────────── */}
              {detailService && (
                <Pressable
                  onPress={() => setServiceDetailId(null)}
                  style={{
                    position: "absolute",
                    top: -9999,
                    left: -9999,
                    right: -9999,
                    bottom: -9999,
                    backgroundColor: "rgba(0,0,0,0.45)",
                    zIndex: 10,
                  }}
                />
              )}
              {detailService && (
                <View
                  style={{
                    position: "absolute",
                    left: -16,
                    right: -16,
                    bottom: -32,
                    backgroundColor: colors.background,
                    borderTopLeftRadius: 20,
                    borderTopRightRadius: 20,
                    padding: 20,
                    zIndex: 11,
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: -4 },
                    shadowOpacity: 0.12,
                    shadowRadius: 12,
                    elevation: 12,
                  }}
                >
                  {/* Drag handle */}
                  <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 16 }} />

                  {/* Photo */}
                  {detailService.photoUri && (
                    <Image
                      source={{ uri: detailService.photoUri }}
                      style={{ width: "100%", height: 180, borderRadius: 12, marginBottom: 16 }}
                      resizeMode="cover"
                    />
                  )}

                  {/* Color bar + name */}
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                    <View style={{ width: 4, height: 24, borderRadius: 2, backgroundColor: detailService.color, marginRight: 10 }} />
                    <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, flex: 1 }}>{getServiceDisplayName(detailService)}</Text>
                  </View>

                  {/* Category badge */}
                  {detailService.category && (
                    <View style={{ flexDirection: "row", marginBottom: 10 }}>
                      <View style={{ backgroundColor: colors.primary + "18", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 }}>
                        <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>{detailService.category}</Text>
                      </View>
                    </View>
                  )}

                  {/* Price + duration row */}
                  <View style={{ flexDirection: "row", gap: 16, marginBottom: 12 }}>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, alignItems: "center" }}>
                      <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.primary }}>${detailService.price}</Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Price</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, alignItems: "center" }}>
                      <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground }}>{detailService.duration}</Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Minutes</Text>
                    </View>
                  </View>

                  {/* Description */}
                  {detailService.description && (
                    <Text style={{ fontSize: fs.sm, color: colors.muted, lineHeight: 20, marginBottom: 16 }}>{detailService.description}</Text>
                  )}

                  {/* Select button */}
                  <Pressable
                    onPress={() => {
                      setSelectedServiceId(detailService.id);
                      setSelectedStaffId(null);
                      setServiceDetailId(null);
                      setStep("staff");
                    }}
                    style={({ pressed }) => ({
                      backgroundColor: colors.primary,
                      borderRadius: 14,
                      paddingVertical: Math.round(buttonHeight * 0.31),
                      alignItems: "center",
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#fff" }}>Book This Service</Text>
                  </Pressable>

                  {/* Dismiss */}
                  <Pressable
                    onPress={() => setServiceDetailId(null)}
                    style={({ pressed }) => ({ marginTop: 12, alignItems: "center", opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text style={{ fontSize: fs.sm, color: colors.muted }}>Cancel</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })()}

        {/* ── Step: Choose Staff ────────────────────────────────────────────── */}
        {step === "staff" && (() => {
          const svc = selectedServiceId ? getServiceById(selectedServiceId) : null;
          const duration = svc?.duration ?? state.settings.defaultDuration;
          const availableStaff = state.staff.filter((m) => {
            if (!m.active) return false;
            // Filter by location
            if (selectedLocationId && m.locationIds && m.locationIds.length > 0) {
              if (!m.locationIds.includes(selectedLocationId)) return false;
            }
            // Filter by service
            if (svc && m.serviceIds && m.serviceIds.length > 0) {
              if (!m.serviceIds.includes(svc.id)) return false;
            }
            return true;
          });

          /**
           * Determine if a staff member has at least one open slot on the selected date.
           * Uses the staff member's own working hours (if set) or falls back to location/business hours.
           * Excludes time slots already booked by this staff member.
           */
          const isStaffAvailableOnDate = (memberId: string): boolean => {
            const member = state.staff.find((m) => m.id === memberId);
            if (!member) return false;
            // Use staff-specific working hours if set, else location/business hours
            const effectiveWH = (member.workingHours && Object.keys(member.workingHours).length > 0)
              ? member.workingHours
              : locationWorkingHours;
            // Appointments for this staff member on the selected date
            const staffAppts = locationAppointments.filter(
              (a) => a.staffId === memberId && a.date === selectedDate && a.status !== "cancelled"
            );
            const slots = generateAvailableSlots(
              selectedDate,
              duration,
              effectiveWH,
              staffAppts,
              effectiveStep,
              locationCustomSchedule,
              state.settings.scheduleMode,
              state.settings.bufferTime ?? 0
            );
            return slots.length > 0;
          };

          return (
            <View>
              <Pressable onPress={() => setStep("service")} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}>
                <Text style={{ color: colors.primary, fontSize: fs.sm }}>← Back</Text>
              </Pressable>
              <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>Choose a Staff Member</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 14 }}>Optional — skip to let us assign someone</Text>
              {/* No preference option */}
              <Pressable
                onPress={() => { setSelectedStaffId(null); setStep(isMobileService ? "address" : "datetime"); }}
                style={({ pressed }) => [styles.serviceOption, { backgroundColor: selectedStaffId === null ? colors.primary + "15" : colors.surface, borderColor: selectedStaffId === null ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={[styles.colorDot, { backgroundColor: colors.muted }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>No Preference</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Any available staff member</Text>
                </View>
                {selectedStaffId === null && <IconSymbol name="checkmark.circle.fill" size={20} color={colors.primary} />}
              </Pressable>
              {availableStaff.map((member) => {
                const isAvailable = isStaffAvailableOnDate(member.id);
                return (
                  <Pressable
                    key={member.id}
                    onPress={() => { setSelectedStaffId(member.id); setStep(isMobileService ? "address" : "datetime"); }}
                    style={({ pressed }) => [styles.serviceOption, { backgroundColor: selectedStaffId === member.id ? member.color + "15" : colors.surface, borderColor: selectedStaffId === member.id ? member.color : colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: member.color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{member.name}</Text>
                        {/* Availability dot: green = has open slots on selected date, grey = fully booked / unavailable */}
                        <View style={{
                          width: 8, height: 8, borderRadius: 4,
                          backgroundColor: isAvailable ? "#22C55E" : "#9CA3AF",
                        }} />
                        <Text style={{ fontSize: fs.xs, color: isAvailable ? "#22C55E" : "#9CA3AF", fontWeight: "500" }}>
                          {isAvailable ? "Available" : "Unavailable"}
                        </Text>
                      </View>
                      {member.role ? <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{member.role}</Text> : null}
                    </View>
                    {selectedStaffId === member.id && <IconSymbol name="checkmark.circle.fill" size={20} color={member.color} />}
                  </Pressable>
                );
              })}
              {availableStaff.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 16 }}>
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>No staff listed — we'll assign someone for you.</Text>
                </View>
              )}
            </View>
          );
        })()}
        {/* ── Step: Address (mobile services only) ─────────────────────────── */}
        {step === "address" && (
          <View>
            <Pressable onPress={() => setStep("staff")} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}>
              <Text style={{ color: colors.primary, fontSize: fs.sm }}>← Back</Text>
            </Pressable>

            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.iconRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name="mappin" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>Your Service Address</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>This service is performed at your location. Please enter the address where you'd like the service performed.</Text>
                </View>
              </View>

              {/* Mobile service info banner */}
              {selectedService && (
                <View style={{ backgroundColor: colors.primary + "12", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.primary + "30" }}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.primary, marginBottom: 4 }}>🚗 {selectedService.name} — Mobile Service</Text>
                  {(selectedService as any).travelDuration ? (
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Travel time: ~{(selectedService as any).travelDuration} min each way (added to your appointment slot)</Text>
                  ) : null}
                  {(selectedService as any).travelFee ? (
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Travel fee: ${Number((selectedService as any).travelFee).toFixed(2)} (included in total)</Text>
                  ) : null}
                  {(selectedService as any).maxTravelDistance ? (
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Service radius: up to {(selectedService as any).maxTravelDistance} miles</Text>
                  ) : null}
                </View>
              )}

              {/* Street Address */}
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Street Address <Text style={{ color: colors.error }}>*</Text></Text>
              <TextInput
                style={[styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginBottom: 12 }]}
                placeholder="123 Main St"
                placeholderTextColor={colors.muted}
                value={addrStreet}
                onChangeText={setAddrStreet}
                returnKeyType="next"
                autoCapitalize="words"
              />

              {/* City */}
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>City <Text style={{ color: colors.error }}>*</Text></Text>
              <TextInput
                style={[styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginBottom: 12 }]}
                placeholder="Pittsburgh"
                placeholderTextColor={colors.muted}
                value={addrCity}
                onChangeText={setAddrCity}
                returnKeyType="next"
                autoCapitalize="words"
              />

              {/* State + ZIP in a row */}
              <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>State <Text style={{ color: colors.error }}>*</Text></Text>
                  <TextInput
                    style={[styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="PA"
                    placeholderTextColor={colors.muted}
                    value={addrState}
                    onChangeText={(t) => setAddrState(t.toUpperCase())}
                    maxLength={2}
                    returnKeyType="next"
                    autoCapitalize="characters"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>ZIP Code <Text style={{ color: colors.error }}>*</Text></Text>
                  <TextInput
                    style={[styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="15220"
                    placeholderTextColor={colors.muted}
                    value={addrZip}
                    onChangeText={setAddrZip}
                    keyboardType="number-pad"
                    maxLength={5}
                    returnKeyType="done"
                  />
                </View>
              </View>

              {/* Travel time + distance hint */}
              {travelTimeLoading && (
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8 }}>Calculating travel time...</Text>
              )}
              {!travelTimeLoading && travelTimeEstimate && (
                <Text style={{ fontSize: fs.xs, color: colors.primary, marginBottom: 8 }}>🚗 {travelTimeEstimate} from business location</Text>
              )}
              {/* Dynamic travel fee display */}
              {!travelTimeLoading && dynamicTravelFee != null && (selectedService as any)?.distanceFeeEnabled && (
                <Text style={{ fontSize: fs.xs, color: colors.primary, marginBottom: 8 }}>
                  Travel fee: ${dynamicTravelFee.toFixed(2)}{(selectedService as any)?.freeMiles ? ` — first ${(selectedService as any).freeMiles} mi free` : ""}
                </Text>
              )}
              {/* Outside service area error */}
              {outsideServiceArea && (
                <Text style={{ fontSize: fs.xs, color: colors.error, marginBottom: 8, fontWeight: "600" }}>⚠️ This address is outside our service area.</Text>
              )}

              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16 }}>We'll come to you at this address.</Text>

              <Pressable
                onPress={() => {
                  if (!addrStreet.trim() || !addrCity.trim() || !addrState.trim() || !addrZip.trim() || outsideServiceArea) return;
                  setStep("datetime");
                }}
                style={({ pressed }) => [styles.continueButton, {
                  backgroundColor: (addrStreet.trim() && addrCity.trim() && addrState.trim() && addrZip.trim() && !outsideServiceArea) ? colors.primary : colors.muted,
                  opacity: pressed ? 0.8 : 1,
                }]}
              >
                <Text style={styles.continueText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Step: Date & Time ─────────────────────────────────────────────── */}
        {step === "datetime" && (
          <View>
            <Pressable onPress={() => setStep(isMobileService ? "address" : "staff")} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}>
              <Text style={{ color: colors.primary, fontSize: fs.sm }}>← Back</Text>
            </Pressable>
            <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>Pick a Date</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={styles.dateRow}>
                {dateOptions.map((opt) => {
                  const dateObj = new Date(opt.date + "T12:00:00");
                  const isSelected = opt.date === selectedDate;
                  const isToday = opt.date === formatDateStr(new Date());
                  const dayName = isToday ? "Today" : dateObj.toLocaleDateString("en-US", { weekday: "short" });
                  const dayNum = dateObj.getDate();
                  const isUnavailable = opt.closed || opt.noSlots;
                  return (
                    <Pressable
                      key={opt.date}
                      onPress={() => {
                        if (!isUnavailable) {
                          setSelectedDate(opt.date);
                          setSelectedTime(null);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.dateChip,
                        {
                          backgroundColor: isSelected ? colors.primary : isUnavailable ? colors.border + "30" : colors.surface,
                          borderColor: isSelected ? colors.primary : isToday && !isUnavailable ? colors.primary + "60" : colors.border,
                          opacity: isUnavailable ? 0.35 : pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: fs.xs, fontWeight: isToday ? "700" : "500", color: isSelected ? "#FFFFFF" : isToday ? colors.primary : colors.muted }}>{dayName}</Text>
                      <Text style={{ fontSize: fs.md, fontWeight: "700", color: isSelected ? "#FFFFFF" : isUnavailable ? colors.muted : colors.foreground, lineHeight: 24 }}>{dayNum}</Text>
                      {opt.closed && <Text style={{ fontSize: 9, color: colors.error, fontWeight: "600" }}>OFF</Text>}
                      {!opt.closed && opt.noSlots && <Text style={{ fontSize: 9, color: colors.warning, fontWeight: "600" }}>FULL</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>Available Times</Text>
              <Pressable
                onPress={() => setRefreshKey((k) => k + 1)}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
              >
                <IconSymbol name="arrow.clockwise" size={18} color={colors.muted} />
              </Pressable>
            </View>
            {timeSlots.length === 0 ? (
              <View style={[styles.emptySlots, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {selectedDate === formatDateStr(new Date()) ? (
                  <>
                    <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.warning }}>All slots for today have passed</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>Select another date to book an appointment</Text>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: fs.sm, color: colors.muted }}>No available times for this date</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>Try a different date</Text>
                  </>
                )}
              </View>
            ) : (
              <View style={styles.timeGrid}>
                {timeSlots.map((t) => {
                  const isSelected = t === selectedTime;
                  const endT = minutesToTime(timeToMinutes(t) + effectiveDuration);
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setSelectedTime(t)}
                      style={({ pressed }) => [
                        styles.timeChip,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surface,
                          borderColor: isSelected ? colors.primary : colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: fs.sm, fontWeight: "500", color: isSelected ? "#FFFFFF" : colors.foreground }}>{formatTime(t)}</Text>
                      <Text style={{ fontSize: 10, color: isSelected ? "#FFFFFF99" : colors.muted, marginTop: 1 }}>to {formatTime(endT)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Discount indicator */}
            {applicableDiscount && selectedTime && (
              <View style={[styles.discountBanner, { backgroundColor: "#FF9800" + "15", borderColor: "#FF9800" + "40" }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#FF9800" }}>
                  {applicableDiscount.percentage}% OFF — {applicableDiscount.name}
                </Text>
                <Text style={{ fontSize: fs.xs, color: "#FF9800", marginTop: 2 }}>
                  ${selectedService ? (selectedService.price * (1 - applicableDiscount.percentage / 100)).toFixed(2) : "0"} instead of ${selectedService?.price}
                </Text>
              </View>
            )}

            {/* Gift Card Code */}
            <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginTop: 16, marginBottom: 6 }}>Gift Card Code (optional)</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <TextInput
                style={[styles.notesInput, { flex: 1, backgroundColor: colors.surface, borderColor: giftApplied ? colors.success : colors.border, color: colors.foreground }]}
                placeholder="Enter gift code..."
                placeholderTextColor={colors.muted}
                value={giftCode}
                onChangeText={(t) => { setGiftCode(t.toUpperCase()); setGiftApplied(null); }}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={handleApplyGiftCode}
              />
              <Pressable
                onPress={handleApplyGiftCode}
                style={({ pressed }) => [{ backgroundColor: colors.primary, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center", opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs.xs }}>Apply</Text>
              </Pressable>
            </View>
            {giftApplied && appliedGiftCard && (
              <View style={[styles.discountBanner, { backgroundColor: colors.success + "15", borderColor: colors.success + "40" }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.success }}>Gift Card Applied!</Text>
                <Text style={{ fontSize: fs.xs, color: colors.success, marginTop: 2 }}>
                  Balance: ${(appliedGiftCard.remainingBalance ?? 0).toFixed(2)}
                  {priceInfo.giftUsed > 0 ? ` (using $${priceInfo.giftUsed.toFixed(2)})` : ""}
                </Text>
              </View>
            )}

            {/* Notes */}
            <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginTop: 16, marginBottom: 6 }}>Notes (optional)</Text>
            <TextInput
              style={[styles.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Any special requests..."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={2}
            />

            <Pressable
              onPress={() => { if (selectedTime) setStep(availableProducts.length > 0 ? "products" : "confirm"); }}
              style={({ pressed }) => [
                styles.continueButton,
                {
                  backgroundColor: selectedTime ? colors.primary : colors.muted,
                  opacity: pressed && selectedTime ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.continueText}>{availableProducts.length > 0 ? "Add Products (Optional)" : "Review Booking"}</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step: Products ────────────────────────────────────────────────── */}
        {step === "products" && (() => {
          return (
            <View>
              <Pressable onPress={() => setStep("datetime")} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}>
                <Text style={{ color: colors.primary, fontSize: fs.sm }}>← Back</Text>
              </Pressable>

              {/* Header */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground }}>Shop Products</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>Optional — add retail products to your appointment</Text>
              </View>

              {/* Cart badge */}
              {cartCount > 0 && (
                <View style={{ backgroundColor: colors.primary + "15", borderRadius: 12, padding: 12, marginBottom: 14, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.primary + "30" }}>
                  <IconSymbol name="cart.fill" size={18} color={colors.primary} />
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.primary, marginLeft: 8, flex: 1 }}>
                    {cartCount} item{cartCount !== 1 ? "s" : ""} in cart · ${cartTotal.toFixed(2)}
                  </Text>
                  <Pressable onPress={() => setProductCart({})} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                    <Text style={{ fontSize: fs.xs, color: colors.error }}>Clear</Text>
                  </Pressable>
                </View>
              )}

              {/* Brand drill-down or product list */}
              {!selectedBrandFilter ? (
                <View>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, marginBottom: 10 }}>Browse by Brand</Text>
                  {productBrands.length === 0 ? (
                    <View>
                      {availableProducts.map((product) => (
                        <Pressable
                          key={product.id}
                          onPress={() => setProductDetailId(product.id)}
                          style={({ pressed }) => [styles.serviceOption, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
                        >
                          {product.photoUri ? (
                            <Image source={{ uri: product.photoUri }} style={{ width: 48, height: 48, borderRadius: 10, marginRight: 12 }} />
                          ) : (
                            <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.primary + "15", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                              <IconSymbol name="cart.fill" size={20} color={colors.primary} />
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{product.name}</Text>
                            <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600", marginTop: 2 }}>${product.price.toFixed(2)}</Text>
                            {product.description ? <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{product.description}</Text> : null}
                          </View>
                          {productCart[product.id] ? (
                            <View style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>{productCart[product.id]}</Text>
                            </View>
                          ) : (
                            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {productBrands.map((brand) => {
                        const brandProducts = availableProducts.filter((p) => p.brand === brand);
                        const brandCartCount = brandProducts.reduce((sum, p) => sum + (productCart[p.id] ?? 0), 0);
                        return (
                          <Pressable
                            key={brand}
                            onPress={() => setSelectedBrandFilter(brand)}
                            style={({ pressed }) => [{
                              flex: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: 14,
                              padding: 16, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1,
                              alignItems: "center",
                            }]}
                          >
                            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary + "15", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                              <IconSymbol name="cart.fill" size={20} color={colors.primary} />
                            </View>
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>{brand}</Text>
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{brandProducts.length} product{brandProducts.length !== 1 ? "s" : ""}</Text>
                            {brandCartCount > 0 && (
                              <View style={{ position: "absolute", top: 8, right: 8, backgroundColor: colors.primary, borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
                                <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>{brandCartCount}</Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : (
                <View>
                  <Pressable onPress={() => setSelectedBrandFilter(null)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12, flexDirection: "row", alignItems: "center" }]}>
                    <IconSymbol name="chevron.left" size={16} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: fs.sm, marginLeft: 4 }}>All Brands</Text>
                  </Pressable>
                  <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>{selectedBrandFilter}</Text>
                  {filteredProducts.map((product) => (
                    <Pressable
                      key={product.id}
                      onPress={() => setProductDetailId(product.id)}
                      style={({ pressed }) => [styles.serviceOption, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
                    >
                      {product.photoUri ? (
                        <Image source={{ uri: product.photoUri }} style={{ width: 48, height: 48, borderRadius: 10, marginRight: 12 }} />
                      ) : (
                        <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.primary + "15", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                          <IconSymbol name="cart.fill" size={20} color={colors.primary} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{product.name}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600", marginTop: 2 }}>${product.price.toFixed(2)}</Text>
                        {product.description ? <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{product.description}</Text> : null}
                      </View>
                      {productCart[product.id] ? (
                        <View style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>{productCart[product.id]}</Text>
                        </View>
                      ) : (
                        <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Continue button */}
              <Pressable
                onPress={() => setStep("confirm")}
                style={({ pressed }) => [styles.continueButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1, marginTop: 16 }]}
              >
                <Text style={styles.continueText}>
                  {cartCount > 0 ? `Review Booking (${cartCount} product${cartCount !== 1 ? "s" : ""})` : "Skip — Review Booking"}
                </Text>
              </Pressable>

              {/* Product Detail Bottom Sheet Modal */}
              <Modal
                visible={productDetail !== null}
                transparent
                animationType="slide"
                onRequestClose={() => setProductDetailId(null)}
              >
                <Pressable
                  style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
                  onPress={() => setProductDetailId(null)}
                >
                  <Pressable
                    style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}
                    onPress={(e) => e.stopPropagation()}
                  >
                    {/* Drag handle */}
                    <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />

                    {productDetail && (
                      <>
                        {/* Photo */}
                        {productDetail.photoUri ? (
                          <Image
                            source={{ uri: productDetail.photoUri }}
                            style={{ width: "100%", height: 200, borderRadius: 14, marginBottom: 16 }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={{ width: "100%", height: 120, borderRadius: 14, backgroundColor: colors.primary + "12", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                            <IconSymbol name="cart.fill" size={40} color={colors.primary + "60"} />
                          </View>
                        )}

                        {/* Brand badge */}
                        {productDetail.brand && (
                          <View style={{ flexDirection: "row", marginBottom: 8 }}>
                            <View style={{ backgroundColor: colors.primary + "18", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 }}>
                              <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>{productDetail.brand}</Text>
                            </View>
                          </View>
                        )}

                        {/* Name */}
                        <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>{productDetail.name}</Text>

                        {/* Price */}
                        <Text style={{ fontSize: fs.xl, fontWeight: "700", color: colors.primary, marginBottom: 12 }}>${productDetail.price.toFixed(2)}</Text>

                        {/* Description */}
                        {productDetail.description ? (
                          <Text style={{ fontSize: fs.sm, color: colors.muted, lineHeight: 20, marginBottom: 20 }}>{productDetail.description}</Text>
                        ) : null}

                        {/* Quantity controls + Add/Remove */}
                        {productCart[productDetail.id] ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                            <Pressable
                              onPress={() => {
                                const qty = productCart[productDetail.id] ?? 0;
                                if (qty <= 1) {
                                  const next = { ...productCart };
                                  delete next[productDetail.id];
                                  setProductCart(next);
                                } else {
                                  setProductCart({ ...productCart, [productDetail.id]: qty - 1 });
                                }
                              }}
                              style={({ pressed }) => ({
                                width: 44, height: 44, borderRadius: 22,
                                backgroundColor: colors.error + "18",
                                alignItems: "center", justifyContent: "center",
                                opacity: pressed ? 0.7 : 1,
                              })}
                            >
                              <Text style={{ fontSize: fs.lg, color: colors.error, fontWeight: "700", lineHeight: 26 }}>−</Text>
                            </Pressable>
                            <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, minWidth: 32, textAlign: "center" }}>{productCart[productDetail.id]}</Text>
                            <Pressable
                              onPress={() => setProductCart({ ...productCart, [productDetail.id]: (productCart[productDetail.id] ?? 0) + 1 })}
                              style={({ pressed }) => ({
                                width: 44, height: 44, borderRadius: 22,
                                backgroundColor: colors.primary + "18",
                                alignItems: "center", justifyContent: "center",
                                opacity: pressed ? 0.7 : 1,
                              })}
                            >
                              <Text style={{ fontSize: fs.lg, color: colors.primary, fontWeight: "700", lineHeight: 26 }}>+</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setProductDetailId(null)}
                              style={({ pressed }) => [styles.continueButton, { flex: 1, backgroundColor: colors.primary, marginTop: 0, opacity: pressed ? 0.8 : 1 }]}
                            >
                              <Text style={styles.continueText}>Done</Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => {
                              setProductCart({ ...productCart, [productDetail.id]: 1 });
                            }}
                            style={({ pressed }) => ({
                              backgroundColor: colors.primary,
                              borderRadius: 14,
                              paddingVertical: Math.round(buttonHeight * 0.31),
                              alignItems: "center",
                              opacity: pressed ? 0.8 : 1,
                              marginBottom: 12,
                            })}
                          >
                            <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#fff" }}>Add to Cart</Text>
                          </Pressable>
                        )}

                        {/* Dismiss */}
                        <Pressable
                          onPress={() => setProductDetailId(null)}
                          style={({ pressed }) => ({ alignItems: "center", paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}
                        >
                          <Text style={{ fontSize: fs.sm, color: colors.muted }}>Close</Text>
                        </Pressable>
                      </>
                    )}
                  </Pressable>
                </Pressable>
              </Modal>
            </View>
          );
        })()}

        {/* ── Step: Confirm ──────────────────────────────────────────────────── */}
        {step === "confirm" && (
          <View>
            <Pressable onPress={() => setStep(availableProducts.length > 0 ? "products" : "datetime")} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, marginBottom: 12 }]}>
              <Text style={{ color: colors.primary, fontSize: fs.sm }}>← Back</Text>
            </Pressable>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>Booking Summary</Text>

              {/* Location row in summary */}
              {selectedLocation && (
                <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                  <Text style={{ fontSize: fs.sm, color: colors.muted }}>Location</Text>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{selectedLocation.name}</Text>
                </View>
              )}

              <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>Name</Text>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{clientName}</Text>
              </View>
              {clientPhone ? (
                <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                  <Text style={{ fontSize: fs.sm, color: colors.muted }}>Phone</Text>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{clientPhone}</Text>
                </View>
              ) : null}
              {selectedStaffId && getStaffById(selectedStaffId) && (
                <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                  <Text style={{ fontSize: fs.sm, color: colors.muted }}>Staff</Text>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{getStaffById(selectedStaffId)!.name}</Text>
                </View>
              )}
              <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>{selectedPackage ? "Package" : "Service"}</Text>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>
                  {selectedPackage ? selectedPackage.name : selectedService ? getServiceDisplayName(selectedService) : ""}
                </Text>
              </View>
              <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>Date</Text>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{formatDateDisplay(selectedDate)}</Text>
              </View>
              <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>Time</Text>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>
                  {selectedTime ? formatTime(selectedTime) : ""} - {endTimeStr}
                </Text>
              </View>
              <View style={[styles.summaryRow, { borderBottomColor: colors.border + "40" }]}>
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>Duration</Text>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{effectiveDuration} min</Text>
              </View>
              <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>Price</Text>
                <View style={{ alignItems: "flex-end" }}>
                  {priceInfo.discountPct > 0 && (
                    <Text style={{ fontSize: fs.xs, textDecorationLine: "line-through", color: colors.muted }}>${priceInfo.original.toFixed(2)}</Text>
                  )}
                  <Text style={{ fontSize: fs.md, fontWeight: "700", color: priceInfo.isGift ? colors.success : colors.primary }}>
                    {priceInfo.isGift ? "FREE (Gift)" : `$${priceInfo.final.toFixed(2)}`}
                  </Text>
                  {priceInfo.discountPct > 0 && !priceInfo.isGift && (
                    <Text style={{ fontSize: fs.xs, color: "#FF9800", fontWeight: "600" }}>{priceInfo.discountPct}% discount applied</Text>
                  )}
                </View>
              </View>

              {/* Selected products section */}
              {cartCount > 0 && (() => {
                const cartProducts = availableProducts.filter((p) => (productCart[p.id] ?? 0) > 0);
                return (
                  <>
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border + "40", marginTop: 8, paddingTop: 12, marginBottom: 4 }}>
                      <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Selected Products</Text>
                      {cartProducts.map((p) => {
                        const qty = productCart[p.id] ?? 0;
                        return (
                          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: fs.xs, color: colors.foreground, fontWeight: "500" }}>{p.name}</Text>
                              {qty > 1 && <Text style={{ fontSize: fs.xs, color: colors.muted }}>x{qty}</Text>}
                            </View>
                            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>${(p.price * qty).toFixed(2)}</Text>
                            <Pressable
                              onPress={() => {
                                const next = { ...productCart };
                                delete next[p.id];
                                setProductCart(next);
                              }}
                              style={({ pressed }) => ({ marginLeft: 12, opacity: pressed ? 0.5 : 1 })}
                            >
                              <Text style={{ fontSize: fs.xs, color: colors.error }}>Remove</Text>
                            </Pressable>
                          </View>
                        );
                      })}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border + "40" }}>
                        <Text style={{ fontSize: fs.xs, color: colors.muted }}>Products Subtotal</Text>
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.foreground }}>${cartTotal.toFixed(2)}</Text>
                      </View>
                    </View>
                  </>
                );
              })()}

              {/* Location address map link */}
              {displayAddress ? (
                <Pressable onPress={openMap} style={({ pressed }) => [styles.locationRow, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "20", opacity: pressed ? 0.7 : 1 }]}>
                  <IconSymbol name="mappin" size={16} color={colors.primary} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Address</Text>
                    <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.primary, textDecorationLine: "underline" }}>{displayAddress}</Text>
                  </View>
                  <Text style={{ fontSize: fs.xs, color: colors.primary }}>Open Map →</Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={handleConfirmBooking}
              style={({ pressed }) => [
                styles.continueButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.continueText}>Confirm Booking</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step: Done ────────────────────────────────────────────────────── */}
        {step === "done" && (
          <View style={styles.doneContainer}>
            <View style={[styles.checkCircle, { backgroundColor: colors.success + "15" }]}>
              <IconSymbol name="checkmark" size={36} color={colors.success} />
            </View>
            <Text style={{ fontSize: fs.xl, fontWeight: "700", color: colors.foreground, marginTop: 20 }}>Booking Requested!</Text>
            <Text style={{ fontSize: fs.sm, color: colors.muted, textAlign: "center", marginTop: 8, maxWidth: 280, lineHeight: 20 }}>
              Your appointment request with {businessName} has been submitted. The business owner will review and confirm your booking shortly.
            </Text>

            <View style={[styles.doneSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{selectedService ? getServiceDisplayName(selectedService) : ""}</Text>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 4 }}>
                {formatDateDisplay(selectedDate)} at {selectedTime ? formatTime(selectedTime) : ""} - {endTimeStr}
              </Text>
              {selectedLocation && (
                <Text style={{ fontSize: fs.xs, color: colors.primary, marginTop: 6, fontWeight: "500" }}>📍 {selectedLocation.name}</Text>
              )}
              {displayAddress ? (
                <Pressable onPress={openMap} style={({ pressed }) => [{ marginTop: 4, opacity: pressed ? 0.6 : 1 }]}>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, textDecorationLine: "underline" }}>{displayAddress}</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Payment Methods */}
            {(state.settings.zelleHandle || state.settings.cashAppHandle || state.settings.venmoHandle) ? (
              <View style={[styles.doneSummary, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 12 }]}>
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 10 }}>How to Pay</Text>
                {state.settings.zelleHandle ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: "#6C1D45", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: fs.sm }}>Z</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>Zelle</Text>
                      <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{state.settings.zelleHandle}</Text>
                    </View>
                  </View>
                ) : null}
                {state.settings.cashAppHandle ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: "#00C244", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: fs.sm }}>$</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>Cash App</Text>
                      <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{state.settings.cashAppHandle}</Text>
                    </View>
                  </View>
                ) : null}
                {state.settings.venmoHandle ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: "#3D95CE", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: fs.sm }}>V</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>Venmo</Text>
                      <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{state.settings.venmoHandle}</Text>
                    </View>
                  </View>
                ) : null}
                {state.settings.paymentNotes ? (
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, lineHeight: 18 }}>{state.settings.paymentNotes}</Text>
                ) : null}
              </View>
            ) : null}

            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.continueButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.continueText}>Done</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingVertical: 4,
    width: "100%",
  },
  bizInfoCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    width: "100%",
  },
  bizInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    width: "100%",
  },
  sectionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 20,
    width: "100%",
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    width: "100%",
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  locationOption: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    width: "100%",
  },
  locationDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    width: "100%",
  },
  input: {
    width: "100%",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
    borderWidth: 1,
    minHeight: 44,
  },
  continueButton: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 52,
  },
  continueText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  serviceOption: {
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
  dateRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "nowrap",
    paddingRight: 8,
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
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  timeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 84,
    minHeight: 44,
  },
  emptySlots: {
    alignItems: "center",
    paddingVertical: 24,
    borderRadius: 16,
    borderWidth: 1,
    width: "100%",
  },
  notesInput: {
    width: "100%",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 20,
    borderWidth: 1,
    minHeight: 50,
    textAlignVertical: "top",
    marginBottom: 8,
  },
  summaryCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    width: "100%",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    width: "100%",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    width: "100%",
  },
  doneContainer: {
    alignItems: "center",
    paddingVertical: 40,
    width: "100%",
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  doneSummary: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginTop: 24,
    marginBottom: 16,
    alignSelf: "stretch",
    alignItems: "center",
    width: "100%",
  },
  closedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    width: "100%",
  },
  discountBanner: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    width: "100%",
  },
});
