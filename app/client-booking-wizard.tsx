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
import React, { useCallback, useEffect, useRef, useState } from "react";
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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getApiBaseUrl } from "@/constants/oauth";
import { scheduleAppointmentReminders } from "@/lib/notifications";
import * as Haptics from "expo-haptics";
import { FuturisticBackground } from "@/components/futuristic-background";

const LIME_GREEN = "#4A7C59";

interface PublicService {
  localId: string;
  name: string;
  duration: number;
  price: string | null;
  description: string | null;
}
interface PublicStaff {
  localId: string;
  name: string;
  role: string | null;
  photoUri: string | null;
  serviceIds: string[];
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

const PAYMENT_METHODS = [
  { id: "zelle", label: "Zelle", icon: "💜", hint: "Send to business Zelle number" },
  { id: "venmo", label: "Venmo", icon: "💙", hint: "Send via @username" },
  { id: "cashapp", label: "Cash App", icon: "💚", hint: "Send via $cashtag" },
  { id: "cash", label: "Cash", icon: "💵", hint: "Pay in person at appointment" },
] as const;
type PaymentMethodId = typeof PAYMENT_METHODS[number]["id"];

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
  const { slug, serviceLocalId } = useLocalSearchParams<{ slug: string; serviceLocalId?: string }>();
  const { state } = useClientStore();
  const apiBase = getApiBaseUrl();

  const [step, setStep] = useState(0);
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [locations, setLocations] = useState<PublicLocation[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedService, setSelectedService] = useState<PublicService | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("any");
  const [selectedLocation, setSelectedLocation] = useState<PublicLocation | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId | null>(null);
  const [paymentConfirmationNumber, setPaymentConfirmationNumber] = useState("");

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  // Working-days data: which weekdays are open + custom date overrides
  const [weeklyDays, setWeeklyDays] = useState<Record<string, boolean>>({});
  const [customDays, setCustomDays] = useState<Record<string, boolean>>({});
  // Set of YYYY-MM-DD strings that have zero available slots (fully booked / closed)
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  // Map of YYYY-MM-DD → slot count for available days
  const [slotCounts, setSlotCounts] = useState<Record<string, number>>({});
  const [loadingMonthAvail, setLoadingMonthAvail] = useState(false);
  // Tracks the month we last fetched availability for ("YYYY-MM")
  const lastAvailFetchKey = useRef<string>("");

  // Whether to show the location step (only when >1 active location)
  const showLocationStep = locations.length > 1;

  // Build the step list dynamically — Date & Time are merged into one step
  const STEPS = showLocationStep
    ? ["Service", "Staff", "Location", "Date & Time", "Payment", "Confirm"]
    : ["Service", "Staff", "Date & Time", "Payment", "Confirm"];

  // Step indices (dynamic based on whether location step is shown)
  const STEP_SERVICE = 0;
  const STEP_STAFF = 1;
  const STEP_LOCATION = showLocationStep ? 2 : -1;
  const STEP_DATE = showLocationStep ? 3 : 2;   // merged Date+Time step
  const STEP_TIME = STEP_DATE;                   // same step as date
  const STEP_PAYMENT = showLocationStep ? 4 : 3;
  const STEP_CONFIRM = showLocationStep ? 5 : 4;

  // Load services, staff, and locations
  useEffect(() => {
    (async () => {
      try {
        const [svcRes, staffRes, locRes] = await Promise.all([
          fetch(`${apiBase}/api/public/business/${slug}/services`),
          fetch(`${apiBase}/api/public/business/${slug}/staff`),
          fetch(`${apiBase}/api/public/business/${slug}/locations`),
        ]);
        const svcData = svcRes.ok ? await svcRes.json() : [];
        const staffData = staffRes.ok ? await staffRes.json() : [];
        const locData = locRes.ok ? await locRes.json() : [];
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
        if (serviceLocalId) {
          const found = svcList.find((s) => s.localId === serviceLocalId);
          if (found) {
            setSelectedService(found);
            setStep(1);
          }
        }
      } catch (err) {
        console.warn("[BookingWizard] load error:", err);
      } finally {
        setLoadingData(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, serviceLocalId, apiBase]);

  // Fetch working-days info (weeklyDays + customDays) whenever slug/location changes
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const locParam = selectedLocation ? `?locationId=${encodeURIComponent(selectedLocation.localId)}` : "";
        const res = await fetch(`${apiBase}/api/public/business/${slug}/working-days${locParam}`);
        if (res.ok) {
          const data = await res.json();
          setWeeklyDays(data.weeklyDays ?? {});
          setCustomDays(data.customDays ?? {});
        }
      } catch (err) {
        console.warn("[BookingWizard] working-days error:", err);
      }
    })();
  }, [slug, selectedLocation, apiBase]);

  // Fetch month-level availability: for each day in the visible month, check if any slots exist.
  // Uses the slots endpoint per day but only for the current calendar month when it changes.
  const fetchMonthAvailability = useCallback(async (year: number, month: number, service: typeof selectedService, location: typeof selectedLocation, staffId: string) => {
    if (!service || !slug) return;
    const fetchKey = `${year}-${String(month + 1).padStart(2, "0")}-${service.localId}-${location?.localId ?? "any"}-${staffId}`;
    if (lastAvailFetchKey.current === fetchKey) return; // already fetched
    lastAvailFetchKey.current = fetchKey;
    setLoadingMonthAvail(true);
    const newUnavailable = new Set<string>();
    const newSlotCounts: Record<string, number> = {};
    const todayStr = new Date().toISOString().split("T")[0];
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    // Build list of future dates in this month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayDate = new Date();
    const promises: Promise<void>[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      if (dateObj < new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate())) continue;
      const dateStr = dateObj.toISOString().split("T")[0];
      const staffParam = staffId !== "any" ? `&staffId=${encodeURIComponent(staffId)}` : "";
      const locParam = location ? `&locationId=${encodeURIComponent(location.localId)}` : "";
      const url = `${apiBase}/api/public/business/${slug}/slots?date=${dateStr}&duration=${service.duration}${staffParam}${locParam}&clientToday=${todayStr}&nowMinutes=${nowMinutes}`;
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
        const url = `${apiBase}/api/public/business/${slug}/slots?date=${dateStr}&duration=${selectedService.duration}${staffParam}${locParam}&clientToday=${clientToday}&nowMinutes=${nowMinutes}`;
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
  }, [selectedDate, selectedService, selectedStaffId, selectedLocation, slug, apiBase, refreshCounter]);

  const handleNext = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const handleBack = () => {
    if (step === 0) { router.back(); return; }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    if (!selectedService || !selectedDate || !selectedSlot) return;
    if (!paymentMethod) {
      Alert.alert("Payment Required", "Please select a payment method before confirming.");
      return;
    }
    if (paymentMethod !== "cash" && !paymentConfirmationNumber.trim()) {
      Alert.alert("Confirmation Number Required", "Please enter your payment confirmation number.");
      return;
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitting(true);
    try {
      const dateStr = selectedDate.toISOString().split("T")[0];
      const clientName = state.account?.name ?? "Guest";
      const clientEmail = state.account?.email ?? undefined;
      const rawPhone = state.account?.phone ?? "";
      const clientPhone = rawPhone.startsWith("oauth:") ? undefined : rawPhone || undefined;
      const res = await fetch(`${apiBase}/api/public/business/${slug}/book`, {
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
          paymentMethod,
          paymentConfirmationNumber: paymentMethod !== "cash" ? paymentConfirmationNumber.trim() : undefined,
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
        slug,
        selectedService.name,
        dateStr,
        selectedSlot.time
      ).catch(() => {});
      const selectedStaffMember = selectedStaffId !== "any" ? staff.find((m) => m.localId === selectedStaffId) : null;
      router.replace({
        pathname: "/client-booking-confirmation",
        params: {
          serviceName: selectedService.name,
          staffName: selectedStaffMember?.name ?? "",
          locationName: selectedLocation?.name ?? "",
          locationAddress: selectedLocation?.address ?? "",
          date: dateStr,
          time: selectedSlot.time,
          duration: String(selectedService.duration),
          businessName: slug,
          businessSlug: slug,
          price: selectedService.price ?? "",
          paymentMethod: paymentMethod ?? "",
          paymentConfirmationNumber: paymentMethod !== "cash" ? paymentConfirmationNumber.trim() : "",
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
      <ScreenContainer>
        <FuturisticBackground />
        <View style={s.loadingContainer}>
          <ActivityIndicator color={LIME_GREEN} size="large" />
          <Text style={{ color: colors.muted, marginTop: 12 }}>Loading...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const calDays = getDaysInMonth(calYear, calMonth);
  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const eligibleStaff = selectedService
    ? staff.filter((m) => !m.serviceIds?.length || m.serviceIds.includes(selectedService.localId))
    : staff;

  return (
    <ScreenContainer>
      <FuturisticBackground />
      {/* Header */}
      <View style={s.header}>
        <Pressable style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]} onPress={handleBack}>
          <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Book Appointment</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Step indicator */}
      <View style={s.stepIndicator}>
        {STEPS.map((label, i) => (
          <View key={i} style={s.stepItem}>
            <View style={[s.stepDot, { backgroundColor: i <= step ? LIME_GREEN : colors.border }]}>
              {i < step ? (
                <IconSymbol name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={{ color: i <= step ? "#FFFFFF" : colors.muted, fontSize: 11, fontWeight: "700" }}>{i + 1}</Text>
              )}
            </View>
            {i < STEPS.length - 1 && (
              <View style={[s.stepLine, { backgroundColor: i < step ? LIME_GREEN : colors.border }]} />
            )}
          </View>
        ))}
      </View>
      <Text style={[s.stepLabel, { color: LIME_GREEN }]}>{STEPS[step]}</Text>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* Step 0: Service */}
        {step === STEP_SERVICE && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Choose a Service</Text>
            {services.length === 0 ? (
              <Text style={{ color: colors.muted, textAlign: "center", marginTop: 24 }}>No services available.</Text>
            ) : services.map((svc) => (
              <Pressable
                key={svc.localId}
                style={({ pressed }) => [
                  s.optionCard,
                  { backgroundColor: colors.surface, borderColor: selectedService?.localId === svc.localId ? LIME_GREEN : colors.border },
                  selectedService?.localId === svc.localId && { borderWidth: 2 },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedService(svc);
                  setSelectedStaffId("any");
                  setSelectedDate(null);
                  setSelectedSlot(null);
                }}
              >
                <View style={s.optionLeft}>
                  <Text style={[s.optionName, { color: colors.foreground }]}>{svc.name}</Text>
                  {svc.description ? <Text style={[s.optionDesc, { color: colors.muted }]} numberOfLines={2}>{svc.description}</Text> : null}
                  <Text style={[s.optionMeta, { color: LIME_GREEN }]}>{svc.duration} min · {formatPrice(svc.price)}</Text>
                </View>
                {selectedService?.localId === svc.localId && (
                  <View style={[s.checkCircle, { backgroundColor: LIME_GREEN }]}>
                    <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* Step 1: Staff */}
        {step === STEP_STAFF && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Choose a Staff Member</Text>
            <Pressable
              style={({ pressed }) => [
                s.optionCard,
                { backgroundColor: colors.surface, borderColor: selectedStaffId === "any" ? LIME_GREEN : colors.border },
                selectedStaffId === "any" && { borderWidth: 2 },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setSelectedStaffId("any")}
            >
              <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}20` }]}>
                <IconSymbol name="person.3.fill" size={20} color={LIME_GREEN} />
              </View>
              <View style={s.optionLeft}>
                <Text style={[s.optionName, { color: colors.foreground }]}>Any Available</Text>
                <Text style={[s.optionDesc, { color: colors.muted }]}>First available staff member</Text>
              </View>
              {selectedStaffId === "any" && (
                <View style={[s.checkCircle, { backgroundColor: LIME_GREEN }]}>
                  <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
            {eligibleStaff.map((member) => (
              <Pressable
                key={member.localId}
                style={({ pressed }) => [
                  s.optionCard,
                  { backgroundColor: colors.surface, borderColor: selectedStaffId === member.localId ? LIME_GREEN : colors.border },
                  selectedStaffId === member.localId && { borderWidth: 2 },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setSelectedStaffId(member.localId)}
              >
                <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}20` }]}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: LIME_GREEN }}>{member.name.charAt(0)}</Text>
                </View>
                <View style={s.optionLeft}>
                  <Text style={[s.optionName, { color: colors.foreground }]}>{member.name}</Text>
                  {member.role ? <Text style={[s.optionDesc, { color: colors.muted }]}>{member.role}</Text> : null}
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
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Choose a Location</Text>
            <Text style={[s.stepSubtitle, { color: colors.muted }]}>Select where you'd like your appointment.</Text>
            {locations.map((loc) => (
              <Pressable
                key={loc.localId}
                style={({ pressed }) => [
                  s.optionCard,
                  { backgroundColor: colors.surface, borderColor: selectedLocation?.localId === loc.localId ? LIME_GREEN : colors.border },
                  selectedLocation?.localId === loc.localId && { borderWidth: 2 },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedLocation(loc);
                  setSelectedDate(null);
                  setSelectedSlot(null);
                }}
              >
                <View style={[s.staffAvatar, { backgroundColor: `${LIME_GREEN}20` }]}>
                  <IconSymbol name="location.fill" size={18} color={LIME_GREEN} />
                </View>
                <View style={s.optionLeft}>
                  <Text style={[s.optionName, { color: colors.foreground }]}>{loc.name}</Text>
                  {loc.address ? (
                    <Text style={[s.optionDesc, { color: colors.muted }]} numberOfLines={2}>{loc.address}</Text>
                  ) : null}
                  {loc.phone ? (
                    <Text style={[s.optionMeta, { color: LIME_GREEN }]}>{loc.phone}</Text>
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
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Pick a Date & Time</Text>
            {selectedLocation && (
              <View style={[s.locationBadge, { backgroundColor: `${LIME_GREEN}15`, borderColor: `${LIME_GREEN}40` }]}>
                <IconSymbol name="location.fill" size={12} color={LIME_GREEN} />
                <Text style={{ color: LIME_GREEN, fontSize: 12, fontWeight: "600" }}>{selectedLocation.name}</Text>
              </View>
            )}

            {/* ── Calendar ── */}
            <View style={s.monthNav}>
              <Pressable
                style={({ pressed }) => [s.monthBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else setCalMonth((m) => m - 1); }}
              >
                <IconSymbol name="chevron.left" size={18} color={colors.foreground} />
              </Pressable>
              <Text style={[s.monthLabel, { color: colors.foreground }]}>{monthLabel}</Text>
              <Pressable
                style={({ pressed }) => [s.monthBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else setCalMonth((m) => m + 1); }}
              >
                <IconSymbol name="chevron.right" size={18} color={colors.foreground} />
              </Pressable>
            </View>
            <View style={s.dayHeaders}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <Text key={i} style={[s.dayHeader, { color: colors.muted }]}>{d}</Text>
              ))}
            </View>
            {/* Month-level availability loading indicator */}
            {loadingMonthAvail && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <ActivityIndicator size="small" color={LIME_GREEN} />
                <Text style={{ color: colors.muted, fontSize: 11 }}>Checking availability…</Text>
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
                const isSelected = selectedDate?.toDateString() === day.toDateString();
                const isToday = day.toDateString() === today.toDateString();
                const isDisabled = isPast || isUnavailable;
                return (
                  <Pressable
                    key={day.toISOString()}
                    style={({ pressed }) => [
                      s.calCell,
                      isSelected && { backgroundColor: LIME_GREEN, borderRadius: 20 },
                      isToday && !isSelected && { borderWidth: 1.5, borderColor: LIME_GREEN, borderRadius: 20 },
                      (isPast || isUnavailable) && { opacity: 0.3 },
                      pressed && !isDisabled && { opacity: 0.7 },
                    ]}
                    onPress={() => {
                      if (isDisabled) return;
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedDate(day);
                      setSelectedSlot(null); // reset time when date changes
                    }}
                    disabled={isDisabled}
                  >
                    <Text style={{ color: isSelected ? "#FFFFFF" : isUnavailable ? colors.muted : colors.foreground, fontSize: 14, fontWeight: isToday ? "700" : "400" }}>
                      {day.getDate()}
                    </Text>
                    {isUnavailable && !isPast && (
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.muted, marginTop: 1 }} />
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
              <View style={{ marginTop: 8 }}>
                <View style={s.timeSectionHeader}>
                  <IconSymbol name="clock" size={15} color={LIME_GREEN} />
                  <Text style={[s.timeSectionTitle, { color: colors.foreground, flex: 1 }]}>
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
                {loadingSlots ? (
                  <ActivityIndicator color={LIME_GREEN} style={{ marginTop: 16 }} />
                ) : slots.length === 0 ? (
                  <View style={s.noSlots}>
                    <Text style={[s.noSlotsText, { color: colors.muted }]}>No available times on this date.</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Try selecting a different date above.</Text>
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
                            { backgroundColor: isSelected ? LIME_GREEN : colors.surface, borderColor: isSelected ? LIME_GREEN : colors.border },
                            pressed && { opacity: 0.8 },
                          ]}
                          onPress={() => {
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setSelectedSlot(slot);
                          }}
                        >
                          <Text style={{ color: isSelected ? "#FFFFFF" : colors.foreground, fontSize: 14, fontWeight: "600" }}>
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

        {/* Payment step */}
        {step === STEP_PAYMENT && selectedService && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Payment</Text>
            <Text style={[s.stepSubtitle, { color: colors.muted }]}>
              Select how you'll pay for this appointment.
            </Text>

            <View style={{ gap: 10, marginTop: 8 }}>
              {PAYMENT_METHODS.map((method) => (
                <Pressable
                  key={method.id}
                  style={({ pressed }) => [
                    s.paymentCard,
                    {
                      backgroundColor: paymentMethod === method.id ? LIME_GREEN + "20" : colors.surface,
                      borderColor: paymentMethod === method.id ? LIME_GREEN : colors.border,
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
                    <Text style={[s.paymentMethodLabel, { color: colors.foreground }]}>{method.label}</Text>
                    <Text style={[s.paymentMethodHint, { color: colors.muted }]}>{method.hint}</Text>
                  </View>
                  {paymentMethod === method.id && (
                    <IconSymbol name="checkmark.circle.fill" size={22} color={LIME_GREEN} />
                  )}
                </Pressable>
              ))}
            </View>

            {paymentMethod && paymentMethod !== "cash" && (
              <View style={{ marginTop: 16 }}>
                <Text style={[s.notesLabel, { color: colors.foreground }]}>
                  {paymentMethod === "zelle" ? "Zelle" : paymentMethod === "venmo" ? "Venmo" : "Cash App"} Confirmation Number
                </Text>
                <TextInput
                  style={[s.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Enter confirmation number..."
                  placeholderTextColor={colors.muted}
                  value={paymentConfirmationNumber}
                  onChangeText={setPaymentConfirmationNumber}
                  returnKeyType="done"
                  autoCapitalize="none"
                />
                <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 6, lineHeight: 16 }]}>
                  After sending payment, enter the confirmation number here so the business can verify your payment.
                </Text>
              </View>
            )}

            {paymentMethod === "cash" && (
              <View style={[s.cashInfoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <IconSymbol name="info.circle.fill" size={18} color={colors.muted} />
                <Text style={[{ color: colors.muted, fontSize: 13, flex: 1, lineHeight: 18 }]}>
                  Cash payments are collected at your appointment. The business will confirm receipt from their side.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Confirm step */}
        {step === STEP_CONFIRM && selectedService && selectedDate && selectedSlot && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Confirm Booking</Text>
            <View style={[s.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Row label="Service" value={selectedService.name} colors={colors} />
              <Row label="Duration" value={`${selectedService.duration} min`} colors={colors} />
              <Row label="Price" value={formatPrice(selectedService.price)} colors={colors} />
              <Row label="Date" value={formatDateLabel(selectedDate)} colors={colors} />
              <Row label="Time" value={selectedSlot.time} colors={colors} />
              {selectedLocation && (
                <Row label="Location" value={selectedLocation.name} colors={colors} />
              )}
              {selectedStaffId !== "any" && (
                <Row
                  label="Staff"
                  value={staff.find((m) => m.localId === selectedStaffId)?.name ?? selectedStaffId}
                  colors={colors}
                />
              )}
              {paymentMethod && (
                <Row
                  label="Payment"
                  value={PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label ?? paymentMethod}
                  colors={colors}
                />
              )}
              {paymentMethod !== "cash" && paymentConfirmationNumber && (
                <Row label="Confirmation #" value={paymentConfirmationNumber} colors={colors} />
              )}
            </View>
            <Text style={[s.notesLabel, { color: colors.foreground }]}>Notes (optional)</Text>
            <TextInput
              style={[s.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Any special requests..."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              returnKeyType="done"
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom Action */}
      <View style={[s.bottomAction, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {step < STEPS.length - 1 ? (
          <Pressable
            style={({ pressed }) => [
              s.nextBtn,
              { opacity: canProceed(step, STEP_SERVICE, STEP_STAFF, STEP_LOCATION, STEP_DATE, STEP_TIME, STEP_PAYMENT, showLocationStep, selectedService, selectedStaffId, selectedLocation, selectedDate, selectedSlot, paymentMethod, paymentConfirmationNumber) ? 1 : 0.4 },
              pressed && canProceed(step, STEP_SERVICE, STEP_STAFF, STEP_LOCATION, STEP_DATE, STEP_TIME, STEP_PAYMENT, showLocationStep, selectedService, selectedStaffId, selectedLocation, selectedDate, selectedSlot, paymentMethod, paymentConfirmationNumber) && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={handleNext}
            disabled={!canProceed(step, STEP_SERVICE, STEP_STAFF, STEP_LOCATION, STEP_DATE, STEP_TIME, STEP_PAYMENT, showLocationStep, selectedService, selectedStaffId, selectedLocation, selectedDate, selectedSlot, paymentMethod, paymentConfirmationNumber)}
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
  paymentConfirmationNumber?: string
): boolean {
  if (step === STEP_SERVICE) return selectedService != null;
  if (step === STEP_STAFF) return selectedStaffId !== undefined;
  if (showLocationStep && step === STEP_LOCATION) return selectedLocation != null;
  // Date and Time are merged — require both a date AND a time slot to proceed
  if (step === STEP_DATE) return selectedDate != null && selectedSlot != null;
  if (step === STEP_PAYMENT) {
    if (!paymentMethod) return false;
    if (paymentMethod !== "cash" && !paymentConfirmationNumber?.trim()) return false;
    return true;
  }
  return true;
}

function Row({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right", marginLeft: 12 }}>{value}</Text>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 17, fontWeight: "600" },
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
    staffAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    locationBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignSelf: "flex-start", marginBottom: 4 },
    monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    monthBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    monthLabel: { fontSize: 16, fontWeight: "700" },
    dayHeaders: { flexDirection: "row", marginBottom: 4 },
    dayHeader: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600" },
    calGrid: { flexDirection: "row", flexWrap: "wrap" },
    calCell: { width: "14.28%" as any, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
    selectedDateLabel: { textAlign: "center", fontSize: 14, fontWeight: "600", marginTop: 12 },
    timeSectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 10 },
    timeSectionTitle: { fontSize: 15, fontWeight: "700" as const },
    noSlots: { alignItems: "center", paddingTop: 40, gap: 12 },
    noSlotsText: { fontSize: 14 },
    slotsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    slotBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", minWidth: 90 },
    confirmCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingTop: 4, marginBottom: 16 },
    notesLabel: { fontSize: 15, fontWeight: "600", marginBottom: 6 },
    notesInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, minHeight: 80 },
    paymentCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 12 },
    paymentMethodLabel: { fontSize: 15, fontWeight: "600" },
    paymentMethodHint: { fontSize: 12, marginTop: 2 },
    cashInfoCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10, marginTop: 12 },
    bottomAction: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: 1 },
    nextBtn: { backgroundColor: LIME_GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
    nextBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  });
