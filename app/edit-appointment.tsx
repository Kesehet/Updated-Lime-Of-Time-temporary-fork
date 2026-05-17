import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  Image,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, formatTime, formatDateStr } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  DAYS_OF_WEEK,
  DEFAULT_WORKING_HOURS,
  generateAvailableSlots,
  minutesToTime,
  timeToMinutes,
  timeSlotsOverlap,
  formatTimeDisplay,
} from "@/lib/types";
import { TapTimePicker } from "@/components/tap-time-picker";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
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

export default function EditAppointmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch, getServiceById, getLocationById, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { hp, width: screenWidth, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();

  const appointment = useMemo(
    () => state.appointments.find((a) => a.id === id),
    [state.appointments, id]
  );

  const service = useMemo(
    () => (appointment ? getServiceById(appointment.serviceId) : null),
    [appointment, getServiceById]
  );

  const todayStr = formatDateStr(new Date());

  // ── Local state (pre-populated from appointment) ──────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(
    appointment?.date ?? todayStr
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(
    appointment?.time ?? null
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    appointment?.locationId ?? null
  );

  // Calendar month navigation
  const [calMonthOffset, setCalMonthOffset] = useState(() => {
    if (!appointment?.date) return 0;
    const today = new Date();
    const sel = new Date(appointment.date + "T12:00:00");
    return (
      (sel.getFullYear() - today.getFullYear()) * 12 +
      (sel.getMonth() - today.getMonth())
    );
  });

  // Slot interval override
  const [localSlotInterval, setLocalSlotInterval] = useState<number | null>(null);

  // Closed-day tooltip
  const [closedDayMsg, setClosedDayMsg] = useState<string | null>(null);
  const closedDayTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showClosedDayMsg = React.useCallback((msg: string) => {
    if (closedDayTimer.current) clearTimeout(closedDayTimer.current);
    setClosedDayMsg(msg);
    closedDayTimer.current = setTimeout(() => setClosedDayMsg(null), 3000);
  }, []);

  // Custom time modal
  const [showCustomTime, setShowCustomTime] = useState(false);
  const [customTimeValue, setCustomTimeValue] = useState(
    appointment?.time ?? "09:00"
  );

  // Discount modal state
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");

  // Service editor state
  const [editExtraItems, setEditExtraItems] = useState<import("@/lib/types").AppointmentExtraItem[]>(
    appointment?.extraItems ?? []
  );
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [editingServiceIdx, setEditingServiceIdx] = useState<number | null>(null); // null = adding new
  const [svcPickerSearch, setSvcPickerSearch] = useState("");
  const [svcPickerCategory, setSvcPickerCategory] = useState<string | null>(null);
  const [editPrimaryService, setEditPrimaryService] = useState<string>(appointment?.serviceId ?? "");

  // Product editor state: productId → quantity (0 = not in appointment)
  const [productsExpanded, setProductsExpanded] = useState(false);
  const [productQty, setProductQty] = useState<Record<string, number>>(() => {
    const qtyMap: Record<string, number> = {};
    for (const item of (appointment?.extraItems ?? [])) {
      if (item.type === 'product') {
        qtyMap[item.id] = (qtyMap[item.id] ?? 0) + 1;
      }
    }
    return qtyMap;
  });

  // Update product quantity and sync to editExtraItems (keeping service extras intact)
  const setProductQtyAndSync = useCallback((productId: string, newQty: number) => {
    const clamped = Math.max(0, newQty);
    setProductQty((prev) => {
      const updated = { ...prev, [productId]: clamped };
      setEditExtraItems((prevItems) => {
        const serviceItems = prevItems.filter((e) => e.type === 'service');
        const productRows: import('@/lib/types').AppointmentExtraItem[] = [];
        for (const [pid, qty] of Object.entries(updated)) {
          if (qty <= 0) continue;
          const prod = state.products.find((p) => p.id === pid);
          if (!prod) continue;
          for (let i = 0; i < qty; i++) {
            productRows.push({ type: 'product', id: pid, name: prod.name, price: parseFloat(String(prod.price)), duration: 0 });
          }
        }
        return [...serviceItems, ...productRows];
      });
      return updated;
    });
  }, [state.products]);

  // ── Derived data ───────────────────────────────────────────────────────
  const activeLocations = useMemo(
    () => state.locations.filter((l) => l.active),
    [state.locations]
  );

  const selectedLocation = useMemo(
    () => (selectedLocationId ? state.locations.find((l) => l.id === selectedLocationId) ?? null : null),
    [state.locations, selectedLocationId]
  );

  const locationWorkingHours = useMemo(() => {
    if (selectedLocation?.workingHours && Object.keys(selectedLocation.workingHours).length > 0) {
      return selectedLocation.workingHours as Record<string, import("@/lib/types").WorkingHours>;
    }
    return state.settings.workingHours ?? DEFAULT_WORKING_HOURS;
  }, [selectedLocation, state.settings.workingHours]);

  // Use editPrimaryService for live service changes
  const primaryService = useMemo(
    () => state.services.find(s => s.id === editPrimaryService) ?? service,
    [state.services, editPrimaryService, service]
  );

  // Total duration = primary service + all extra services (no buffer)
  const totalEditDuration = useMemo(() => {
    const primaryDur = primaryService?.duration ?? appointment?.duration ?? 60;
    const extrasDur = editExtraItems
      .filter(e => e.type === 'service')
      .reduce((s, e) => s + e.duration, 0);
    let total = primaryDur + extrasDur;
    // Add travel duration (round trip) for mobile services
    if (primaryService?.serviceType === 'mobile' && (primaryService as any)?.travelDuration > 0) {
      total += (primaryService as any).travelDuration * 2;
    }
    return total;
  }, [primaryService, appointment, editExtraItems]);

  const duration = totalEditDuration;

  const effectiveStep = useMemo(() => {
    const bufferMin = (state.settings as any).bufferTime ?? 0;
    const autoStep = Math.max(5, duration + bufferMin);
    if (localSlotInterval !== null) {
      return localSlotInterval === 0 ? autoStep : localSlotInterval;
    }
    const configured = (state.settings as any).slotInterval ?? 0;
    return configured > 0 ? configured : autoStep;
  }, [localSlotInterval, (state.settings as any).slotInterval, (state.settings as any).bufferTime, duration]);

  // Appointments at the selected location, excluding the current appointment being edited
  const locationAppts = useMemo(() => {
    const appts = state.appointments.filter((a) => a.id !== id);
    if (!selectedLocationId) return appts;
    return appts.filter((a) => a.locationId === selectedLocationId);
  }, [state.appointments, id, selectedLocationId]);

  const activeCustomSchedule = useMemo(() => {
    const locEntries = selectedLocationId
      ? ((state as any).locationCustomSchedule?.[selectedLocationId] ?? [])
      : [];
    const locDates = new Set(locEntries.map((cs: any) => cs.date));
    const globalFallback = (state.customSchedule ?? []).filter((cs) => !locDates.has(cs.date));
    return [...locEntries, ...globalFallback];
  }, [selectedLocationId, (state as any).locationCustomSchedule, state.customSchedule]);

  const timeSlots = useMemo(() => {
    return generateAvailableSlots(
      selectedDate,
      duration,
      locationWorkingHours,
      locationAppts,
      effectiveStep,
      activeCustomSchedule,
      state.settings.scheduleMode,
      (state.settings as any).bufferTime ?? 0
    );
  }, [selectedDate, duration, locationWorkingHours, locationAppts, effectiveStep,
      activeCustomSchedule, state.settings.scheduleMode, (state.settings as any).bufferTime]);

  // Date options for the calendar (90 days)
  const dateOptions = useMemo(() => {
    const dates: { date: string; closed: boolean; noSlots: boolean; slotCount: number }[] = [];
    const today = new Date();
    const endDate = state.settings.businessHoursEndDate;
    for (let i = 0; i < 90; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const ds = formatDateStr(d);
      let closed = !!(endDate && ds > endDate);
      if (!closed) {
        const customDay = activeCustomSchedule.find((cs: { date: string; isOpen: boolean }) => cs.date === ds);
        if (state.settings.scheduleMode === "custom") {
          closed = !customDay || !customDay.isOpen;
        } else if (customDay) {
          closed = !customDay.isOpen;
        } else {
          const dayName = DAYS_OF_WEEK[d.getDay()];
          const wh = locationWorkingHours[dayName];
          closed = !wh || !wh.enabled;
        }
      }
      let slotCount = 0;
      if (!closed) {
        const slots = generateAvailableSlots(
          ds, duration, locationWorkingHours, locationAppts, effectiveStep,
          activeCustomSchedule, state.settings.scheduleMode, (state.settings as any).bufferTime ?? 0
        );
        slotCount = slots.length;
      }
      dates.push({ date: ds, closed, noSlots: slotCount === 0, slotCount });
    }
    return dates;
  }, [activeCustomSchedule, locationWorkingHours, locationAppts, duration,
      state.settings.scheduleMode, state.settings.businessHoursEndDate,
      (state.settings as any).bufferTime, effectiveStep]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const getEndTime = useCallback(
    (t: string) => formatTimeDisplay(minutesToTime(timeToMinutes(t) + duration)),
    [duration]
  );

  // Check if a custom time conflicts with confirmed/pending appointments (excluding self)
  const customTimeHasConflict = useCallback(
    (time: string) => {
      const otherAppts = state.appointments.filter(
        (a) =>
          a.id !== id &&
          a.date === selectedDate &&
          (a.status === "confirmed" || a.status === "pending") &&
          (!selectedLocationId || a.locationId === selectedLocationId)
      );
      return otherAppts.some((a) => timeSlotsOverlap(time, duration, a.time, a.duration));
    },
    [state.appointments, id, selectedDate, selectedLocationId, duration]
  );

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!appointment) return;
    if (!selectedTime) {
      Alert.alert("Select a Time", "Please select a time for the appointment.");
      return;
    }
    if (activeLocations.length > 1 && !selectedLocationId) {
      Alert.alert("Select a Location", "Please select a location for the appointment.");
      return;
    }

    // Recalculate total price from primary service + extra items
    const newPrimaryService = state.services.find(s => s.id === editPrimaryService) ?? service;
    const primaryPrice = newPrimaryService?.price ?? appointment.totalPrice ?? 0;
    const extrasPrice = editExtraItems.reduce((s, e) => s + e.price, 0);
    const rawTotal = primaryPrice + extrasPrice;
    const discountAmt = appointment.discountAmount ?? 0;
    const newTotal = Math.max(0, rawTotal - discountAmt);

    const updated = {
      ...appointment,
      serviceId: editPrimaryService || appointment.serviceId,
      date: selectedDate,
      time: selectedTime,
      locationId: selectedLocationId ?? appointment.locationId,
      duration: totalEditDuration,
      extraItems: editExtraItems,
      totalPrice: newTotal,
    };

    dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
    syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });

    // Go back to Appointment Detail first, then offer reminder
    router.back();
    // Small delay so navigation commits before the alert appears
    setTimeout(() => {
      Alert.alert(
        "Appointment Updated",
        "Would you like to send a reminder to the client?",
        [
          { text: "Not Now", style: "cancel" },
          {
            text: "Send Reminder",
            onPress: () => {
              router.push({
                pathname: "/send-reminder" as any,
                params: { appointmentId: appointment.id },
              });
            },
          },
        ]
      );
    }, 350);
  }, [appointment, selectedDate, selectedTime, selectedLocationId, activeLocations.length,
      dispatch, syncToDb, router]);

  // ── Guard: appointment not found ───────────────────────────────────────
  if (!appointment) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>Appointment not found.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.primary }}>Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  // ── Calendar rendering ─────────────────────────────────────────────────
  const today = new Date();
  const displayDate = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
  const displayMonth = displayDate.getMonth();
  const displayYear = displayDate.getFullYear();
  const firstDayOfWeek = new Date(displayYear, displayMonth, 1).getDay();
  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
  const calCells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const calCellSize = Math.floor((screenWidth - hp * 2) / 7);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 89);
  const maxDateStr = formatDateStr(maxDate);
  const canGoPrev = calMonthOffset > 0;
  const canGoNext = calMonthOffset < 3;

  const renderSlotChip = (t: string) => {
    const isSelected = t === selectedTime;
    return (
      <Pressable
        key={t}
        onPress={() => setSelectedTime(t)}
        style={({ pressed }) => ({
          width: "22%",
          paddingVertical: 9,
          borderRadius: 10,
          backgroundColor: isSelected ? colors.primary : colors.surface,
          borderWidth: 1.5,
          borderColor: isSelected ? colors.primary : colors.border,
          alignItems: "center",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isSelected ? "#FFFFFF" : colors.foreground, textAlign: "center", lineHeight: 17 }}>
          {formatTime(t)}
        </Text>
        <Text style={{ fontSize: 9, color: isSelected ? "#FFFFFF99" : colors.muted, marginTop: 1, textAlign: "center", lineHeight: 12 }}>
          to {getEndTime(t)}
        </Text>
      </Pressable>
    );
  };

  const slotGroups = [
    { label: "Morning", slots: timeSlots.filter((t) => parseInt(t.split(":")[0]) < 12) },
    { label: "Afternoon", slots: timeSlots.filter((t) => { const h = parseInt(t.split(":")[0]); return h >= 12 && h < 17; }) },
    { label: "Evening", slots: timeSlots.filter((t) => parseInt(t.split(":")[0]) >= 17) },
  ].filter((g) => g.slots.length > 0);

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, paddingTop: 8, paddingHorizontal: hp }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="arrow.left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, marginLeft: 16, flex: 1 }}>
          Edit Appointment
        </Text>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: fs.sm }}>Save</Text>
        </Pressable>
      </View>
      {/* Live New Total preview */}
      {(() => {
        const ps = state.services.find(s => s.id === editPrimaryService) ?? service;
        const primaryPrice = parseFloat(String(ps?.price ?? appointment?.totalPrice ?? 0));
        const extrasTotal = editExtraItems.reduce((s, e) => s + e.price, 0);
        const rawTotal = primaryPrice + extrasTotal;
        const discountAmt = appointment?.discountAmount ?? 0;
        const discountName = (appointment as any)?.discountName as string | undefined;
        const discountPct = (appointment as any)?.discountPercent as number | undefined;
        const liveTotal = Math.max(0, rawTotal - discountAmt);
        const origTotal = appointment?.totalPrice ?? 0;
        const changed = Math.abs(liveTotal - origTotal) > 0.001;
        return (
          <View style={{ paddingHorizontal: hp, paddingBottom: 8, alignItems: 'flex-end', gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: fs.xs, color: colors.muted }}>New Total:</Text>
              <Text style={{ fontSize: fs.md, fontWeight: '800', color: changed ? colors.primary : colors.muted }}>
                ${liveTotal.toFixed(2)}
              </Text>
              {changed && (
                <Text style={{ fontSize: fs.xs, color: colors.muted, textDecorationLine: 'line-through' }}>
                  ${origTotal.toFixed(2)}
                </Text>
              )}
            </View>
            {discountAmt > 0 && (
              <Text style={{ fontSize: fs.xs, color: colors.warning }}>
                {discountName ? `${discountName}` : discountPct ? `${discountPct}% off` : 'Discount'} −${discountAmt.toFixed(2)} applied
              </Text>
            )}
          </View>
        );
      })()}

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
      
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Services Editor */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.muted, flex: 1 }}>SERVICES</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>{totalEditDuration} min total</Text>
          </View>

          {/* Primary service row */}
          {(() => {
            const ps = state.services.find(s => s.id === editPrimaryService) ?? service;
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ps?.color ?? colors.primary, marginRight: 8 }} />
                <Text style={{ flex: 1, fontSize: fs.sm, fontWeight: '600', color: colors.foreground }} numberOfLines={2}>{ps?.name ?? 'Service'}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginRight: 8 }}>{ps?.duration ?? 0}m</Text>
                <Text style={{ fontSize: fs.xs, color: colors.primary, marginRight: 4 }}>${(ps?.price ?? 0).toFixed(2)}</Text>
                <Pressable
                  onPress={() => { setEditingServiceIdx(-1); setSvcPickerSearch(''); setSvcPickerCategory(null); setShowServicePicker(true); }}
                  style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
                >
                  <IconSymbol name="pencil" size={14} color={colors.primary} />
                </Pressable>
              </View>
            );
          })()}

          {/* Extra service rows */}
          {editExtraItems.filter(e => e.type === 'service').map((item, idx) => (
            <View key={item.id + idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: fs.sm, color: colors.foreground }} numberOfLines={2}>{item.name}</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginRight: 8 }}>{item.duration}m</Text>
              <Text style={{ fontSize: fs.xs, color: colors.primary, marginRight: 4 }}>${item.price.toFixed(2)}</Text>
              <Pressable
                onPress={() => {
                  const realIdx = editExtraItems.findIndex((e, i) => e.type === 'service' && editExtraItems.filter(x => x.type === 'service').indexOf(e) === idx);
                  setEditingServiceIdx(idx);
                  setSvcPickerSearch('');
                  setSvcPickerCategory(null);
                  setShowServicePicker(true);
                }}
                style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
              >
                <IconSymbol name="pencil" size={14} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  // Capture values immediately to avoid stale closure inside Alert callback
                  const svcItems = editExtraItems.filter(e => e.type === 'service');
                  const toRemoveId = svcItems[idx]?.id;
                  const toRemoveName = svcItems[idx]?.name ?? item.name;
                  if (!toRemoveId) return;
                  Alert.alert('Remove Service', `Remove "${toRemoveName}" from this appointment?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => {
                      setEditExtraItems(prev => {
                        let removed = false;
                        return prev.filter(e => {
                          if (!removed && e.type === 'service' && e.id === toRemoveId) { removed = true; return false; }
                          return true;
                        });
                      });
                    }},
                  ]);
                }}
                style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1, marginLeft: 2 })}
              >
                <IconSymbol name="trash.fill" size={16} color={colors.error} />
              </Pressable>
            </View>
          ))}

          {/* Add Service button */}
          <Pressable
            onPress={() => { setEditingServiceIdx(null); setSvcPickerSearch(''); setSvcPickerCategory(null); setShowServicePicker(true); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingTop: 10, opacity: pressed ? 0.6 : 1 })}
          >
            <IconSymbol name="plus.circle.fill" size={16} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: '600', marginLeft: 6 }}>Add Service</Text>
          </Pressable>
        </View>

        {/* Service Picker Modal */}
        <Modal visible={showServicePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowServicePicker(false)}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: fs.md, fontWeight: '700', color: colors.foreground }}>
                {editingServiceIdx === null ? 'Add Service' : editingServiceIdx === -1 ? 'Change Primary Service' : 'Change Service'}
              </Text>
              <Pressable onPress={() => setShowServicePicker(false)} style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.6 : 1 })}>
                <IconSymbol name="xmark" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {/* Search */}
            <View style={{ margin: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border }}>
              <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
              <TextInput
                value={svcPickerSearch}
                onChangeText={setSvcPickerSearch}
                placeholder="Search services..."
                placeholderTextColor={colors.muted}
                style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: fs.sm, color: colors.foreground }}
              />
            </View>

            {/* Category filter — compact horizontal chips with icons */}
            {(() => {
              const cats = Array.from(new Set(state.services.filter(s => s.category).map(s => s.category as string)));
              if (cats.length === 0) return null;
              // Map common category names to SF Symbol icon names
              const catIconMap: Record<string, string> = {
                'Hair': 'scissors',
                'Nails': 'paintbrush.fill',
                'Skincare': 'sparkles',
                'Skin Care': 'sparkles',
                'Massage': 'hand.raised.fill',
                'Waxing': 'eye.fill',
                'Waxing & Brows': 'eye.fill',
                'Brows': 'eye.fill',
                'Lashes': 'eye',
                'Makeup': 'face.smiling',
                'Facials': 'sparkles',
                'Body': 'figure.stand',
                'Tanning': 'sun.max.fill',
                'Threading': 'scissors',
                'Coloring': 'paintbrush',
                'Extensions': 'scissors',
                'Braids': 'scissors',
                'Barber': 'scissors',
              };
              const getIcon = (name: string): string => {
                if (catIconMap[name]) return catIconMap[name];
                // Partial match
                const lower = name.toLowerCase();
                if (lower.includes('hair')) return 'scissors';
                if (lower.includes('nail')) return 'paintbrush.fill';
                if (lower.includes('skin') || lower.includes('facial')) return 'sparkles';
                if (lower.includes('massage') || lower.includes('body')) return 'hand.raised.fill';
                if (lower.includes('wax') || lower.includes('brow') || lower.includes('lash')) return 'eye.fill';
                if (lower.includes('makeup') || lower.includes('color')) return 'paintbrush';
                return 'tag.fill';
              };
              return (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 12, marginBottom: 8, flexGrow: 0 }} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingVertical: 4 }}>
                  {/* All pill */}
                  <Pressable
                    onPress={() => setSvcPickerCategory(null)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: svcPickerCategory === null ? colors.primary : colors.surface, borderWidth: 1, borderColor: svcPickerCategory === null ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontSize: fs.xs, lineHeight: 16 }}>✦</Text>
                    <Text style={{ fontSize: fs.xs, fontWeight: '600', color: svcPickerCategory === null ? '#fff' : colors.foreground }}>All</Text>
                  </Pressable>
                  {cats.map(cat => {
                    const isActive = svcPickerCategory === cat;
                    return (
                      <Pressable
                        key={cat}
                        onPress={() => setSvcPickerCategory(cat === svcPickerCategory ? null : cat)}
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: isActive ? colors.primary : colors.surface, borderWidth: 1, borderColor: isActive ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 })}
                      >
                        <IconSymbol name={getIcon(cat) as any} size={13} color={isActive ? '#fff' : colors.muted} />
                        <Text style={{ fontSize: fs.xs, fontWeight: '600', color: isActive ? '#fff' : colors.foreground }}>{cat}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              );
            })()}

            {/* Service list */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
              {(() => {
                // Build set of already-added service IDs to exclude
                const addedIds = new Set<string>();
                if (editingServiceIdx === null) {
                  // Adding new: exclude primary + all existing extras
                  addedIds.add(editPrimaryService);
                  editExtraItems.filter(e => e.type === 'service').forEach(e => addedIds.add(e.id));
                } else if (editingServiceIdx === -1) {
                  // Changing primary: exclude existing extras only
                  editExtraItems.filter(e => e.type === 'service').forEach(e => addedIds.add(e.id));
                } else {
                  // Changing an extra: exclude primary + other extras (not the one being edited)
                  addedIds.add(editPrimaryService);
                  const svcItems = editExtraItems.filter(e => e.type === 'service');
                  svcItems.forEach((e, i) => { if (i !== editingServiceIdx) addedIds.add(e.id); });
                }

                const filtered = state.services.filter(s => {
                  if (addedIds.has(s.id)) return false;
                  if (svcPickerCategory && s.category !== svcPickerCategory) return false;
                  if (svcPickerSearch.trim()) {
                    const q = svcPickerSearch.toLowerCase();
                    return s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q);
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 32, fontSize: fs.sm }}>No services found</Text>;
                }

                return filtered.map(s => (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      if (editingServiceIdx === -1) {
                        setEditPrimaryService(s.id);
                      } else if (editingServiceIdx === null) {
                        setEditExtraItems(prev => [...prev, { type: 'service', id: s.id, name: s.name, price: s.price, duration: s.duration }]);
                      } else {
                        setEditExtraItems(prev => {
                          const newItem: import('@/lib/types').AppointmentExtraItem = { type: 'service', id: s.id, name: s.name, price: s.price, duration: s.duration };
                          let svcCount = 0;
                          return prev.map(e => {
                            if (e.type === 'service') {
                              if (svcCount === editingServiceIdx) { svcCount++; return newItem; }
                              svcCount++;
                            }
                            return e;
                          });
                        });
                      }
                      setShowServicePicker(false);
                    }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 })}
                  >
                    {/* Service image or colored avatar */}
                    {s.photoUri ? (
                      <Image source={{ uri: s.photoUri }} style={{ width: 44, height: 44, borderRadius: 10, marginRight: 12 }} resizeMode="cover" />
                    ) : (
                      <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: (s.color ?? colors.primary) + '22', alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: (s.color ?? colors.primary) + '40' }}>
                        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: s.color ?? colors.primary }} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.foreground }} numberOfLines={2}>{s.name}</Text>
                      {!!s.category && <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{s.category}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary }}>${s.price.toFixed(2)}</Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>{s.duration}m</Text>
                    </View>
                  </Pressable>
                ));
              })()}
            </ScrollView>
          </View>
        </Modal>

        {/* Products Editor — collapsible */}
        {state.products.filter(p => p.available).length > 0 && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {/* Collapsible header */}
            <Pressable
              onPress={() => setProductsExpanded(e => !e)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.7 : 1, marginBottom: productsExpanded ? 10 : 0 })}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.muted, flex: 1 }}>PRODUCTS</Text>
              {(() => {
                const totalSelected = Object.values(productQty).reduce((s, q) => s + q, 0);
                return totalSelected > 0 ? (
                  <View style={{ backgroundColor: colors.primary + '18', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: '700' }}>{totalSelected} selected</Text>
                  </View>
                ) : null;
              })()}
              <Text style={{ fontSize: fs.md, color: colors.muted, lineHeight: 22 }}>{productsExpanded ? '▲' : '▼'}</Text>
            </Pressable>
            {productsExpanded && state.products.filter(p => p.available).map((p) => {
              const qty = productQty[p.id] ?? 0;
              return (
                <View
                  key={p.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 10,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{p.name}</Text>
                    {p.description ? <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }} numberOfLines={1}>{p.description}</Text> : null}
                    <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary, marginTop: 2 }}>${parseFloat(String(p.price)).toFixed(2)}</Text>
                  </View>
                  {/* Quantity stepper */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Pressable
                      onPress={() => setProductQtyAndSync(p.id, qty - 1)}
                      style={({ pressed }) => ({
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: qty > 0 ? colors.error + '18' : colors.surface,
                        borderWidth: 1, borderColor: qty > 0 ? colors.error + '60' : colors.border,
                        alignItems: 'center', justifyContent: 'center',
                        opacity: pressed ? 0.6 : qty > 0 ? 1 : 0.35,
                      })}
                      disabled={qty === 0}
                    >
                      <Text style={{ fontSize: fs.md, fontWeight: '700', color: qty > 0 ? colors.error : colors.muted, lineHeight: 22 }}>−</Text>
                    </Pressable>
                    <Text style={{ minWidth: 26, textAlign: 'center', fontSize: fs.sm, fontWeight: '700', color: qty > 0 ? colors.primary : colors.muted }}>{qty}</Text>
                    <Pressable
                      onPress={() => setProductQtyAndSync(p.id, qty + 1)}
                      style={({ pressed }) => ({
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: colors.primary + '18',
                        borderWidth: 1, borderColor: colors.primary + '60',
                        alignItems: 'center', justifyContent: 'center',
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.primary, lineHeight: 22 }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {/* Product subtotal — only when expanded */}
            {productsExpanded && (() => {
              const totalItems = Object.values(productQty).reduce((s, q) => s + q, 0);
              if (totalItems === 0) return null;
              const subtotal = state.products
                .filter(p => p.available)
                .reduce((s, p) => s + (productQty[p.id] ?? 0) * parseFloat(String(p.price)), 0);
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 2 }}>
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>
                    {totalItems} item{totalItems !== 1 ? 's' : ''}
                  </Text>
                  <Text style={{ fontSize: fs.sm, fontWeight: '700', color: colors.primary }}>
                    ${subtotal.toFixed(2)}
                  </Text>
                </View>
              );
            })()}
          </View>
        )}

        {/* Location Selector */}
        {activeLocations.length > 0 && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted, marginBottom: 10 }}>Location</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {activeLocations.map((loc) => {
                  const isSelected = selectedLocationId === loc.id;
                  return (
                    <Pressable
                      key={loc.id}
                      onPress={() => {
                        setSelectedLocationId(loc.id);
                        setSelectedTime(null);
                      }}
                      style={({ pressed }) => ({
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
                      })}
                    >
                      <IconSymbol name="location.fill" size={14} color={isSelected ? colors.primary : colors.muted} />
                      <View>
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isSelected ? colors.primary : colors.foreground }}>
                          {loc.name}
                        </Text>
                        {!!loc.address && (
                          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                            {loc.address}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Calendar */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {/* Month navigation */}
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
                {MONTH_NAMES[displayMonth]} {displayYear}
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

          {/* Day headers — flex:1 per column so they stay aligned with % cells */}
          <View style={{ flexDirection: "row", width: "100%", marginBottom: 4 }}>
            {DAY_HEADERS.map((d) => (
              <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>{d}</Text>
            ))}
          </View>

          {/* Calendar grid — 14.28% cells so columns align with headers */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", width: "100%" }}>
            {calCells.map((day, idx) => {
              if (day === null) {
                return <View key={`empty-${idx}`} style={{ width: "14.28%", height: 44 }} />;
              }
              const dateStr = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === todayStr;
              const isPast = dateStr < todayStr;
              const isOutOfRange = dateStr > maxDateStr;
              const opt = dateOptions.find((o) => o.date === dateStr);
              const isClosed = opt ? opt.closed : true;
              const isNoSlots = opt ? opt.noSlots : false;
              const slotCount = opt?.slotCount ?? 0;
              const isDisabled = isPast || isOutOfRange || isClosed || isNoSlots;
              // Dot color: green=many(6+), amber=few(3-5), primary=limited(1-2)
              const dotColor = slotCount >= 6 ? colors.success : slotCount >= 3 ? colors.warning : colors.primary;
              return (
                <Pressable
                  key={dateStr}
                  onPress={() => {
                    if (!isDisabled) {
                      setSelectedDate(dateStr);
                      setSelectedTime(null);
                    } else if (!isPast && !isOutOfRange && (isClosed || isNoSlots)) {
                      showClosedDayMsg(isClosed ? "Closed — no working hours set for this day" : "No available slots on this day");
                    }
                  }}
                  style={({ pressed }) => ({
                    width: "14.28%",
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: (isPast || isOutOfRange) ? 0.35 : pressed && !isDisabled ? 0.7 : 1,
                  })}
                >
                  {/* Selected: outlined rounded square, no fill */}
                  {isSelected && (
                    <View style={{
                      position: "absolute",
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: colors.primary,
                      backgroundColor: "transparent",
                    }} />
                  )}
                  <Text
                    style={{
                      fontSize: fs.sm,
                      fontWeight: isToday || isSelected ? "700" : "400",
                      color: isToday
                        ? colors.primary
                        : isSelected
                        ? colors.primary
                        : isClosed && !isPast && !isOutOfRange
                        ? colors.muted
                        : colors.foreground,
                      textDecorationLine: "none",
                      lineHeight: 20,
                    }}
                  >
                    {day}
                  </Text>
                  {/* Availability dot: green/amber/primary for open days, red for closed/no-slot future days */}
                  {!isPast && !isOutOfRange && slotCount > 0 && (
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor, marginTop: 1 }} />
                  )}
                  {!isPast && !isOutOfRange && slotCount === 0 && (
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.error, marginTop: 1 }} />
                  )}
                  {/* Spacer for past/out-of-range dates */}
                  {(isPast || isOutOfRange) && (
                    <View style={{ width: 4, height: 4, marginTop: 1 }} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Dot legend */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10, paddingHorizontal: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
            <Text style={{ fontSize: 10, color: colors.muted }}>Many slots</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning }} />
            <Text style={{ fontSize: 10, color: colors.muted }}>Few slots</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
            <Text style={{ fontSize: 10, color: colors.muted }}>Limited</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
            <Text style={{ fontSize: 10, color: colors.muted }}>Closed</Text>
          </View>
        </View>

        {/* Closed-day tooltip */}
        {closedDayMsg ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error + "18", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6, marginBottom: 2 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
            <Text style={{ fontSize: fs.xs, color: colors.error, fontWeight: "500", flex: 1 }}>{closedDayMsg}</Text>
          </View>
        ) : null}

        {/* Selected date label */}
        {selectedDate && (
          <View style={{ marginBottom: 8, marginHorizontal: 2 }}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric",
              })}
            </Text>
          </View>
        )}

        {/* Slot Interval Selector */}
        <View style={{ marginBottom: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}>
            {INTERVALS.map((iv) => {
              const globalConfigured = (state.settings as any).slotInterval ?? 0;
              const activeValue = localSlotInterval !== null ? localSlotInterval : globalConfigured;
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
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isActive ? "#FFFFFF" : colors.muted }}>
                    {iv.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Time Slots */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, marginHorizontal: 4 }}>
          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>Available Times</Text>
        </View>

        {timeSlots.length === 0 ? (
          <View style={[styles.emptySlots, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>No available times for this date</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>Try a different date or check working hours</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 12 }}>
            {slotGroups.map((group) => (
              <View key={group.label} style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, marginBottom: 6, marginLeft: 2 }}>
                  {group.label}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {group.slots.map(renderSlotChip)}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Custom Time Option */}
        <Pressable
          onPress={() => setShowCustomTime(true)}
          style={({ pressed }) => [
            styles.customTimeBtn,
            {
              borderColor: selectedTime && !timeSlots.includes(selectedTime) ? colors.primary : colors.border,
              backgroundColor: selectedTime && !timeSlots.includes(selectedTime) ? colors.primary + "12" : colors.surface,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <IconSymbol name="clock" size={16} color={selectedTime && !timeSlots.includes(selectedTime) ? colors.primary : colors.muted} />
          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: selectedTime && !timeSlots.includes(selectedTime) ? colors.primary : colors.muted, marginLeft: 6 }}>
            {selectedTime && !timeSlots.includes(selectedTime)
              ? `Custom: ${formatTime(selectedTime)}`
              : "Custom Time..."}
          </Text>
        </Pressable>

        {/* Currently selected time summary */}
        {selectedTime && (
          <View style={[styles.selectedSummary, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}>
            <IconSymbol name="checkmark.circle.fill" size={16} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary, marginLeft: 6 }}>
              {formatTime(selectedTime)} – {getEndTime(selectedTime)}
            </Text>
            {selectedDate !== appointment.date || selectedTime !== appointment.time ? (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 8 }}>
                (changed)
              </Text>
            ) : null}
          </View>
        )}

        {/* Apply Discount — only for pending/confirmed */}
        {(appointment.status === "pending" || appointment.status === "confirmed") && (
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.foreground }}>Discount</Text>
              {appointment.discountAmount != null && appointment.discountAmount > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.success + "18", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <IconSymbol name="tag.fill" size={12} color={colors.success} />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.success }}>
                    {appointment.discountName ? appointment.discountName + " · " : ""}
                    {appointment.discountPercent != null ? `${appointment.discountPercent}%` : `$${appointment.discountAmount.toFixed(2)}`} off
                  </Text>
                </View>
              )}
            </View>

            {/* Saved discounts list */}
            {state.discounts.filter((d) => d.active).length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                  {state.discounts.filter((d) => d.active).map((d) => {
                    const isApplied = appointment.discountName === d.name;
                    return (
                      <Pressable
                        key={d.id}
                        onPress={() => {
                          if (isApplied) {
                            // Remove discount
                            const updated = { ...appointment, discountAmount: undefined, discountPercent: undefined, discountName: undefined, totalPrice: (appointment.totalPrice ?? 0) + (appointment.discountAmount ?? 0) };
                            dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                            syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                          } else {
                            const basePrice = (appointment.totalPrice ?? 0) + (appointment.discountAmount ?? 0);
                            const amt = basePrice * (d.percentage / 100);
                            const updated = { ...appointment, discountAmount: amt, discountPercent: d.percentage, discountName: d.name, totalPrice: Math.max(0, basePrice - amt) };
                            dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                            syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                          }
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                          borderWidth: 1.5,
                          borderColor: isApplied ? colors.success : colors.border,
                          backgroundColor: isApplied ? colors.success + "18" : colors.surface,
                          opacity: pressed ? 0.7 : 1,
                          flexDirection: "row", alignItems: "center", gap: 5,
                        })}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isApplied ? colors.success : colors.foreground }}>
                          {d.name} · {d.percentage}% off
                        </Text>
                        {isApplied && <IconSymbol name="checkmark" size={12} color={colors.success} />}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {/* Custom discount button */}
            <Pressable
              onPress={() => {
                setDiscountInput("");
                setDiscountType("percent");
                setShowDiscountModal(true);
              }}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10,
                borderWidth: 1, borderColor: colors.border,
                backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1,
              })}
            >
              <IconSymbol name="tag.fill" size={14} color={colors.muted} />
              <Text style={{ fontSize: fs.xs, color: colors.muted, fontWeight: "600" }}>Custom Discount...</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Custom Time Modal */}
      <Modal
        visible={showCustomTime}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCustomTime(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Modal Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable onPress={() => setShowCustomTime(false)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ fontSize: fs.md, color: colors.primary }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Custom Time</Text>
            <Pressable
              onPress={() => {
                // Check for conflict with confirmed/pending appointments
                if (customTimeHasConflict(customTimeValue)) {
                  Alert.alert(
                    "Time Conflict",
                    "This time overlaps with an existing confirmed or pending appointment. Please choose a different time.",
                    [{ text: "OK" }]
                  );
                  return;
                }
                setSelectedTime(customTimeValue);
                setShowCustomTime(false);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>Set</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 24 }}>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 20, textAlign: "center" }}>
              Custom time overrides normal slot availability. It will not block confirmed or pending appointments.
            </Text>

            <TapTimePicker
              value={customTimeValue}
              onChange={setCustomTimeValue}
              stepMinutes={5}
              label="Select Time"
            />

            <View style={{ marginTop: 24, padding: 14, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: fs.xs, color: colors.muted, textAlign: "center" }}>
                Selected: <Text style={{ fontWeight: "700", color: colors.foreground }}>{formatTimeDisplay(customTimeValue)}</Text>
                {" → "}
                <Text style={{ fontWeight: "700", color: colors.foreground }}>{getEndTime(customTimeValue)}</Text>
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Custom Discount Modal */}
      <Modal
        visible={showDiscountModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDiscountModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable onPress={() => setShowDiscountModal(false)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ fontSize: fs.md, color: colors.primary }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Custom Discount</Text>
            <Pressable
              onPress={() => {
                const val = parseFloat(discountInput);
                if (isNaN(val) || val <= 0) {
                  Alert.alert("Invalid Value", "Please enter a valid discount amount.");
                  return;
                }
                const basePrice = (appointment.totalPrice ?? 0) + (appointment.discountAmount ?? 0);
                const amt = discountType === "percent" ? Math.min(basePrice * (val / 100), basePrice) : Math.min(val, basePrice);
                const pct = discountType === "percent" ? val : undefined;
                const updated = { ...appointment, discountAmount: amt, discountPercent: pct, discountName: discountType === "percent" ? `${val}% off` : `$${val.toFixed(2)} off`, totalPrice: Math.max(0, basePrice - amt) };
                dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                setShowDiscountModal(false);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>Apply</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 24 }}>
            {/* Type toggle */}
            <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginBottom: 20 }}>
              {(["percent", "flat"] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setDiscountType(t)}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center",
                    backgroundColor: discountType === t ? colors.primary : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: discountType === t ? "#FFF" : colors.muted }}>
                    {t === "percent" ? "Percentage (%)" : "Flat Amount ($)"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8 }}>
              {discountType === "percent" ? "Enter discount percentage (e.g. 20 for 20% off)" : "Enter dollar amount to deduct (e.g. 10 for $10 off)"}
            </Text>
            <TextInput
              value={discountInput}
              onChangeText={setDiscountInput}
              placeholder={discountType === "percent" ? "e.g. 20" : "e.g. 10.00"}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: fs.lg, fontWeight: "700", color: colors.foreground, textAlign: "center" }}
            />

            {/* Preview */}
            {discountInput !== "" && !isNaN(parseFloat(discountInput)) && parseFloat(discountInput) > 0 && (() => {
              const val = parseFloat(discountInput);
              const basePrice = (appointment.totalPrice ?? 0) + (appointment.discountAmount ?? 0);
              const amt = discountType === "percent" ? Math.min(basePrice * (val / 100), basePrice) : Math.min(val, basePrice);
              const newTotal = Math.max(0, basePrice - amt);
              return (
                <View style={{ marginTop: 20, padding: 16, backgroundColor: colors.success + "12", borderRadius: 12, borderWidth: 1, borderColor: colors.success + "40" }}>
                  <Text style={{ fontSize: fs.xs, color: colors.success, textAlign: "center" }}>
                    Discount: <Text style={{ fontWeight: "700" }}>-${amt.toFixed(2)}</Text>
                  </Text>
                  <Text style={{ fontSize: fs.md, fontWeight: "800", color: colors.success, textAlign: "center", marginTop: 4 }}>
                    New Total: ${newTotal.toFixed(2)}
                  </Text>
                </View>
              );
            })()}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  timeChip: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    minHeight: 52,
  },
  emptySlots: {
    alignItems: "center",
    paddingVertical: 32,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  customTimeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    marginBottom: 12,
  },
  selectedSummary: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
});
