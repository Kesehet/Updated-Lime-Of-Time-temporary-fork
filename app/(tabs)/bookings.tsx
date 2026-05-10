/**
 * Bookings Tab
 * ─────────────────────────────────────────────────────────────────────────────
 * Full appointment list with:
 *  - Filter tabs (Upcoming, Confirmed, Unpaid, Requests, Completed, Paid, Cancelled)
 *  - Collapsible month calendar picker (tap a day to filter by date)
 *  - "Show All" button to clear the date filter
 *  - Payment modal (mark as paid / bulk mark all paid)
 *  - Refund modal (for card-paid appointments)
 *  - Undo toast (after bulk mark paid)
 *  - Swipeable request cards (Accept / Reject)
 */
import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  Alert,
  Linking,
  Platform,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Animated,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useStore, formatTime, formatDateStr, formatDateDisplay } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter, useLocalSearchParams } from "expo-router";
import { apiCall } from "@/lib/_core/api";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import {
  Appointment,
  getServiceDisplayName,
  formatTimeDisplay,
  minutesToTime,
  timeToMinutes,
  generateAcceptMessage,
  generateRejectMessage,
  stripPhoneFormat,
} from "@/lib/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SwipeableRequestCard } from "@/components/swipeable-request-card";
import { useScrollToTopOnFocus } from "@/hooks/use-scroll-to-top-on-focus";

// ─── Constants ────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "confirmed", label: "Confirmed" },
  { key: "unpaid", label: "Unpaid" },
  { key: "requests", label: "Requests" },
  { key: "completed", label: "Completed" },
  { key: "paid", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "zelle", label: "Zelle" },
  { key: "venmo", label: "Venmo" },
  { key: "cashapp", label: "CashApp" },
  { key: "card", label: "Card" },
] as const;
type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];

const FILTER_STORAGE_KEY = "bookings_active_filter";

// ─── BookingsScreen ───────────────────────────────────────────────────────────

export default function BookingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string; packageGroupId?: string }>();
  const { hp, width, maxContentWidth, isTablet, fs, modalMaxWidth, useSideBySide, touchTarget, buttonHeight, iconButtonSize } = useResponsive();
  const { state, dispatch, getServiceById, getClientById, getStaffById, getLocationById, syncToDb, filterAppointmentsByLocation, bulkMarkPaid, bulkMarkUnpaid } = useStore();
  const { activeLocation, activeLocations, hasMultipleLocations: hasMultiLoc } = useActiveLocation();
  const scrollRef = useScrollToTopOnFocus<ScrollView>();

  const todayStr = formatDateStr(new Date());

  // ─── Location filter (mirrors calendar) ──────────────────────────────
  const locationAppointments = useMemo(
    () => filterAppointmentsByLocation(state.appointments),
    [state.appointments, filterAppointmentsByLocation]
  );

  // ─── Filter state ─────────────────────────────────────────────────────
  type MethodFilterKey = "cash" | "zelle" | "venmo" | "cashapp" | "card";
  const METHOD_FILTER_OPTIONS: { key: MethodFilterKey; label: string; color: string }[] = [
    { key: "cash", label: "Cash", color: "#22C55E" },
    { key: "zelle", label: "Zelle", color: "#6600CC" },
    { key: "venmo", label: "Venmo", color: "#008CFF" },
    { key: "cashapp", label: "CashApp", color: "#00D632" },
    { key: "card", label: "Card", color: "#635BFF" },
  ];
  const [methodFilter, setMethodFilter] = useState<MethodFilterKey | null>(null);
  // Service type filter: null = all, 'in_store' = in-store only, 'mobile' = mobile only
  const [serviceTypeFilter, setServiceTypeFilter] = useState<'in_store' | 'mobile' | null>(null);

  const initialFilter = (params.filter as FilterKey) || "upcoming";
  const [activeFilter, setActiveFilter] = useState<FilterKey>(initialFilter);

  // Package group filter — when navigating from 'View all sessions' in appointment-detail
  const [packageGroupFilter, setPackageGroupFilter] = useState<string | null>(params.packageGroupId ?? null);

  // Split-view: selected appointment for the right panel on tablet landscape
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);

  // Package completion modal
  const [showPkgCompleteModal, setShowPkgCompleteModal] = useState(false);
  const [pkgCompleteInfo, setPkgCompleteInfo] = useState<{ name: string; sessions: number; totalValue: number; groupId: string } | null>(null);
  const shownPkgCompleteRef = React.useRef<Set<string>>(new Set());

  const setActiveFilterPersisted = useCallback((key: FilterKey) => {
    setActiveFilter(key);
    AsyncStorage.setItem(FILTER_STORAGE_KEY, key).catch(() => {});
  }, []);

  // Restore persisted filter on mount (only if no param was passed)
  useEffect(() => {
    if (params.filter) return;
    AsyncStorage.getItem(FILTER_STORAGE_KEY).then((stored) => {
      if (stored && FILTERS.some((f) => f.key === stored)) {
        setActiveFilter(stored as FilterKey);
      }
    }).catch(() => {});
  }, []);

  // When a filter param arrives (e.g. from notification tap), apply it
  useEffect(() => {
    if (params.filter && FILTERS.some((f) => f.key === params.filter)) {
      setActiveFilterPersisted(params.filter as FilterKey);
    }
  }, [params.filter]);

  // Detect package completion: when all sessions of a package are booked
  useEffect(() => {
    const pkgGroups = new Map<string, { appts: typeof locationAppointments; name: string; total: number }>();
    for (const a of locationAppointments) {
      if (!a.packageGroupId || a.sessionTotal == null) continue;
      if (!pkgGroups.has(a.packageGroupId)) {
        pkgGroups.set(a.packageGroupId, { appts: [], name: a.packageName ?? 'Package', total: a.sessionTotal });
      }
      pkgGroups.get(a.packageGroupId)!.appts.push(a);
    }
    for (const [groupId, { appts, name, total }] of pkgGroups) {
      const nonCancelled = appts.filter((a) => a.status !== 'cancelled');
      if (nonCancelled.length >= total && !shownPkgCompleteRef.current.has(groupId)) {
        shownPkgCompleteRef.current.add(groupId);
        const totalValue = nonCancelled.reduce((sum, a) => sum + (a.totalPrice ?? 0), 0);
        setPkgCompleteInfo({ name, sessions: total, totalValue, groupId });
        setShowPkgCompleteModal(true);
        break; // show one at a time
      }
    }
  }, [locationAppointments]);

  // ─── Date filter (from collapsible calendar) ──────────────────────────
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);

  // ─── Collapsible calendar state ───────────────────────────────────────
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const calendarAnim = useRef(new Animated.Value(0)).current;

  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());

  const toggleCalendar = () => {
    const toValue = calendarExpanded ? 0 : 1;
    setCalendarExpanded(!calendarExpanded);
    Animated.timing(calendarAnim, {
      toValue,
      duration: 280,
      useNativeDriver: false,
    }).start();
  };

  // Compute calendar height dynamically based on number of weeks in the month
  const calendarContentHeight = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const totalCells = firstDay + daysInMonth;
    const weeks = Math.ceil(totalCells / 7);
    const cellW = Math.floor((width - hp * 2 - 24) / 7); // 24 = card horizontal padding
    return 44 + 28 + weeks * cellW + 24; // header + day labels + rows + padding
  }, [calYear, calMonth, width, hp]);

  const calendarHeight = calendarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, calendarContentHeight + 50], // +50 accounts for legend row (~34px) + spacing
  });

  // ─── Calendar grid days ───────────────────────────────────────────────
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [calMonth, calYear]);

  // Appointment dot indicators per day
  const dayStatuses = useMemo(() => {
    const statuses: Record<string, Set<string>> = {};
    locationAppointments.forEach((a) => {
      if (!statuses[a.date]) statuses[a.date] = new Set();
      statuses[a.date].add(a.status);
    });
    return statuses;
  }, [locationAppointments]);

  // ─── Payment modal state ──────────────────────────────────────────────
  const [payModalAppt, setPayModalAppt] = useState<Appointment | null>(null);
  const [payModalMethod, setPayModalMethod] = useState<PaymentMethodKey>("cash");
  const [payModalIsBulk, setPayModalIsBulk] = useState(false);
  const [undoToast, setUndoToast] = useState<{ count: number; ids: string[] } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Refund modal state ───────────────────────────────────────────────
  const [refundAppt, setRefundAppt] = useState<Appointment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundLoading, setRefundLoading] = useState(false);

  // ─── Helpers ──────────────────────────────────────────────────────────

  const getEndTime = (time: string, duration: number): string =>
    formatTimeDisplay(minutesToTime(timeToMinutes(time) + duration));

  const openSmsWithMessage = useCallback((phone: string, message: string) => {
    if (Platform.OS === "web") { Alert.alert("SMS Message", message); return; }
    const rawPhone = stripPhoneFormat(phone);
    const separator = Platform.OS === "ios" ? "&" : "?";
    const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(message)}`;
    Linking.openURL(url).catch(() => Alert.alert("SMS", message));
  }, []);

  const doMarkPaid = useCallback(async (appts: Appointment[], method: PaymentMethodKey) => {
    if (appts.length === 0) return;
    if (appts.length === 1) {
      const updated = { ...appts[0], paymentStatus: "paid" as const, paymentMethod: method };
      dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
      await syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
    } else {
      await bulkMarkPaid(appts.map((a) => a.id), method);
    }
  }, [dispatch, syncToDb, bulkMarkPaid]);

  // ─── Accept / Reject ──────────────────────────────────────────────────

  const handleAccept = useCallback((appt: Appointment) => {
    const client = getClientById(appt.clientId);
    const svc = getServiceById(appt.serviceId);
    const apptLoc = appt.locationId ? getLocationById(appt.locationId) : null;
    dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appt.id, status: "confirmed" } });
    dispatch({ type: "MARK_INBOX_READ_BY_APPOINTMENT", payload: appt.id });
    syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appt.id, status: "confirmed" } });
    const message = generateAcceptMessage(
      state.settings.businessName,
      apptLoc?.address || state.settings.profile.address,
      client?.name ?? "Valued Client",
      svc ? getServiceDisplayName(svc) : "Service",
      appt.duration, appt.date, appt.time,
      apptLoc?.phone || state.settings.profile.phone,
      client?.phone, appt.id, apptLoc?.name, apptLoc?.id,
      state.settings.customSlug,
      apptLoc?.city, apptLoc?.state, apptLoc?.zipCode,
      state.settings.zelleHandle,
      state.settings.cashAppHandle,
      state.settings.venmoHandle
    );
    if (client?.phone) openSmsWithMessage(client.phone, message);
    else Alert.alert("Appointment Confirmed", message);
  }, [getClientById, getServiceById, getLocationById, dispatch, state.settings, openSmsWithMessage, syncToDb]);

  const handleReject = useCallback((appt: Appointment) => {
    const client = getClientById(appt.clientId);
    const svc = getServiceById(appt.serviceId);
    Alert.alert("Reject Appointment", "Are you sure you want to reject this appointment request?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject", style: "destructive",
        onPress: () => {
          dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appt.id, status: "cancelled" } });
          dispatch({ type: "MARK_INBOX_READ_BY_APPOINTMENT", payload: appt.id });
          syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appt.id, status: "cancelled" } });
          const apptLoc = appt.locationId ? getLocationById(appt.locationId) : null;
          const message = generateRejectMessage(
            state.settings.businessName, client?.name ?? "Valued Client",
            svc ? getServiceDisplayName(svc) : "Service", appt.date, appt.time,
            apptLoc?.phone || state.settings.profile.phone,
            apptLoc?.name, apptLoc?.address, apptLoc?.city, apptLoc?.state, apptLoc?.zipCode
          );
          if (client?.phone) openSmsWithMessage(client.phone, message);
          else Alert.alert("Appointment Rejected", message);
        },
      },
    ]);
  }, [getClientById, getServiceById, getLocationById, dispatch, state.settings, openSmsWithMessage, syncToDb]);

  // ─── Refund handler ───────────────────────────────────────────────────

  const handleRefund = useCallback(async () => {
    if (!refundAppt) return;
    const appt = refundAppt;
    const total = appt.totalPrice ?? 0;
    const amountNum = refundAmount.trim() ? parseFloat(refundAmount.trim()) : total;
    if (isNaN(amountNum) || amountNum <= 0 || amountNum > total) {
      Alert.alert("Invalid Amount", `Please enter an amount between $0.01 and $${total.toFixed(2)}.`);
      return;
    }
    Alert.alert(
      "Confirm Refund",
      `Issue a $${amountNum.toFixed(2)} refund for this appointment?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Refund",
          style: "destructive",
          onPress: async () => {
            setRefundLoading(true);
            try {
              await apiCall("/api/stripe-connect/refund", {
                method: "POST",
                body: JSON.stringify({ appointmentLocalId: appt.id, amount: amountNum }),
              });
              dispatch({
                type: "UPDATE_APPOINTMENT",
                payload: { ...appt, refundedAt: new Date().toISOString(), refundedAmount: amountNum },
              });
              setRefundAppt(null);
              setRefundAmount("");
              Alert.alert("Refund Issued", `$${amountNum.toFixed(2)} refund has been processed.`);
            } catch (err: any) {
              Alert.alert("Refund Failed", err?.message ?? "Could not process refund. Please try again.");
            } finally {
              setRefundLoading(false);
            }
          },
        },
      ]
    );
  }, [refundAppt, refundAmount, dispatch]);

  // ─── Filter colors ────────────────────────────────────────────────────

  const filterColors: Record<FilterKey, string> = {
    upcoming: colors.success,
    confirmed: colors.primary,
    unpaid: "#EF4444",
    requests: "#FF9800",
    completed: "#00C896",
    paid: "#22C55E",
    cancelled: "#9CA3AF",
  };

  // ─── Filtered appointments ────────────────────────────────────────────

  const filteredAppointments = useMemo(() => {
    const base = locationAppointments;
    let result: Appointment[];
    switch (activeFilter) {
      case "upcoming":
        result = base.filter((a) => a.status === "confirmed" && a.date > todayStr)
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        break;
      case "unpaid":
        result = base
          .filter((a) => a.status !== "cancelled" && a.paymentStatus !== "paid")
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        break;
      case "paid": {
        const paidList = base.filter((a) => a.paymentStatus === "paid");
        const methodFiltered = methodFilter ? paidList.filter((a) => a.paymentMethod === methodFilter) : paidList;
        result = methodFiltered.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
        break;
      }
      case "requests":
        result = base.filter((a) => a.status === "pending")
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        break;
      case "confirmed":
        result = base.filter((a) => a.status === "confirmed")
          .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
        break;
      case "cancelled":
        result = base.filter((a) => a.status === "cancelled")
          .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
        break;
      case "completed":
        result = base.filter((a) => a.status === "completed")
          .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
        break;
      default:
        result = [];
    }
    // Apply date filter if set
    if (selectedDateFilter) {
      result = result.filter((a) => a.date === selectedDateFilter);
    }
    // Apply package group filter if set
    if (packageGroupFilter) {
      result = locationAppointments.filter((a) => a.packageGroupId === packageGroupFilter)
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    }
    // Apply service type filter
    if (serviceTypeFilter) {
      result = result.filter((a) => {
        const svc = getServiceById(a.serviceId);
        const svcType = svc?.serviceType ?? 'in_store';
        return svcType === serviceTypeFilter;
      });
    }
    return result;
  }, [locationAppointments, activeFilter, methodFilter, todayStr, selectedDateFilter, packageGroupFilter, serviceTypeFilter, getServiceById]);

  // ─── Grouped sections ─────────────────────────────────────────────────

  const filteredSections = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const a of filteredAppointments) {
      if (!map[a.date]) map[a.date] = [];
      map[a.date].push(a);
    }
    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((date) => ({ date, items: map[date] }));
  }, [filteredAppointments]);

  const formatSectionDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };

  // ─── Appointment card renderer ────────────────────────────────────────

  const renderApptCard = (appt: Appointment) => {
    const svc = getServiceById(appt.serviceId);
    const client = getClientById(appt.clientId);
    const staff = appt.staffId ? getStaffById(appt.staffId) : null;
    const statusColor =
      appt.status === "confirmed" ? "#1B5E20"
      : appt.status === "pending" ? "#FF9800"
      : appt.status === "completed" ? colors.primary
      : appt.status === "no_show" ? "#F59E0B"
      : "#F44336";
    const isRequest = appt.status === "pending";
    const isCardPaidUnrefunded = appt.paymentMethod === "card" && appt.paymentStatus === "paid" && !appt.refundedAt;

    const cardContent = (
      <View key={appt.id} style={[styles.apptCard, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: svc?.color ?? colors.primary }]}>
        <Pressable
          onPress={() => router.push({ pathname: "/appointment-detail", params: { id: appt.id } })}
          onLongPress={isCardPaidUnrefunded ? () => { setRefundAppt(appt); setRefundAmount(""); } : undefined}
          delayLongPress={500}
          style={{ alignSelf: "stretch" }}
        >
          <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>
            {formatTime(appt.time)} – {getEndTime(appt.time, appt.duration)}
          </Text>
          <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.foreground, marginTop: 2 }}>
            {svc ? getServiceDisplayName(svc) : "Service"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>{client?.name}</Text>
            {staff && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: staff.color || colors.primary }} />
                <Text style={{ fontSize: fs.xs, color: staff.color || colors.primary, fontWeight: "500" }}>{staff.name}</Text>
              </View>
            )}
          </View>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: statusColor, textTransform: "capitalize" }}>{appt.status}</Text>
          </View>
          {appt.paymentMethod === "card" && appt.paymentStatus === "paid" && (
            <View style={{ backgroundColor: "#635BFF18", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#635BFF" }}>💳 Card</Text>
            </View>
          )}
          {appt.clientPaidNotifiedAt && appt.paymentStatus !== "paid" && (
            <View style={{ backgroundColor: "#FFF7ED", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "#FED7AA" }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#C2410C" }}>💰 Payment Sent</Text>
            </View>
          )}
          {hasMultiLoc && appt.locationId && (() => {
            const loc = getLocationById(appt.locationId);
            if (!loc) return null;
            const locColor = (loc as any).color || colors.primary;
            return (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: locColor + "18", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: locColor }} />
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: locColor }} numberOfLines={1}>{loc.name}</Text>
              </View>
            );
          })()}
          {appt.paymentStatus !== "paid" && appt.status !== "cancelled" && (
            <Pressable
              onPress={() => { setPayModalAppt(appt); setPayModalMethod("cash"); }}
              style={({ pressed }) => [{
                backgroundColor: pressed ? "#16a34a" : "#22C55E",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
                marginLeft: "auto" as any,
              }]}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#FFF" }}>Mark Paid</Text>
            </Pressable>
          )}
        </View>
        {isRequest && (
          <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
            <Pressable onPress={() => handleAccept(appt)} style={({ pressed }) => [styles.acceptBtn, { backgroundColor: "#1B5E20", opacity: pressed ? 0.8 : 1 }]}>
              <IconSymbol name="checkmark" size={16} color="#FFF" />
              <Text style={{ color: "#FFF", fontSize: fs.xs, fontWeight: "600", marginLeft: 4 }}>Accept</Text>
            </Pressable>
            <Pressable onPress={() => handleReject(appt)} style={({ pressed }) => [styles.rejectBtn, { borderColor: "#F44336", opacity: pressed ? 0.8 : 1 }]}>
              <IconSymbol name="xmark" size={16} color="#F44336" />
              <Text style={{ color: "#F44336", fontSize: fs.xs, fontWeight: "600", marginLeft: 4 }}>Reject</Text>
            </Pressable>
          </View>
        )}
      </View>
    );

    if (isRequest) {
      return (
        <SwipeableRequestCard
          key={appt.id}
          onAccept={() => handleAccept(appt)}
          onReject={() => handleReject(appt)}
        >
          {cardContent}
        </SwipeableRequestCard>
      );
    }
    return cardContent;
  };

  // ─── Mini calendar renderer ───────────────────────────────────────────

  const renderMiniCalendar = () => {
    const cellW = Math.floor((width - hp * 2 - 24) / 7); // 24 = card horizontal padding (12 each side)
    const cellH = cellW; // square cells
    return (
      <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12 }}>
        {/* Month navigation */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Pressable
            onPress={() => {
              if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
              else setCalMonth(calMonth - 1);
            }}
            style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.5 : 1 }]}
          >
            <IconSymbol name="chevron.left" size={18} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>
            {MONTH_NAMES[calMonth]} {calYear}
          </Text>
          <Pressable
            onPress={() => {
              if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
              else setCalMonth(calMonth + 1);
            }}
            style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.5 : 1 }]}
          >
            <IconSymbol name="chevron.right" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Day headers */}
        <View style={{ flexDirection: "row", marginBottom: 2 }}>
          {DAY_HEADERS.map((d) => (
            <View key={d} style={{ width: cellW, alignItems: "center", paddingVertical: 4 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Day cells */}
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {calendarDays.map((day, idx) => {
            if (day === null) {
              return <View key={`empty-${idx}`} style={{ width: cellW, height: cellH }} />;
            }
            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDateFilter;
            const statuses = dayStatuses[dateStr];
            const hasAppts = statuses && statuses.size > 0;
            const radius = Math.floor(cellW / 2);

            return (
              <Pressable
                key={dateStr}
                onPress={() => {
                  setSelectedDateFilter(selectedDateFilter === dateStr ? null : dateStr);
                }}
                style={({ pressed }) => [{
                  width: cellW,
                  height: cellH,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius,
                  backgroundColor: "transparent",
                  borderWidth: isSelected ? 1.5 : 0,
                  borderColor: isSelected ? colors.primary : "transparent",
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <Text style={{
                  fontSize: fs.xs,
                  fontWeight: isToday || isSelected ? "700" : "400",
                  color: isSelected || isToday ? colors.primary : colors.foreground,
                }}>
                  {day}
                </Text>
                {hasAppts && (
                  <View style={{
                    flexDirection: "row",
                    gap: 2,
                    position: "absolute",
                    bottom: Math.max(2, Math.floor(cellH * 0.06)),
                  }}>
                    {Array.from(statuses).slice(0, 3).map((status, si) => {
                      const dotColor =
                        status === "confirmed" ? "#60A5FA"
                        : status === "pending" ? "#9CA3AF"
                        : status === "completed" ? colors.success
                        : colors.error;
                      return <View key={si} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor }} />;
                    })}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };



  const listContent = (
    <>
      {/* Header */}
      <View style={{ paddingHorizontal: hp, paddingTop: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: fs.xl, fontWeight: "800", color: colors.foreground }}>Bookings</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {/* Show All button — visible when a date filter is active */}
            {selectedDateFilter && (
              <Pressable
                onPress={() => setSelectedDateFilter(null)}
                style={({ pressed }) => [{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: colors.primary + "18",
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <IconSymbol name="xmark" size={12} color={colors.primary} />
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary }}>Show All</Text>
              </Pressable>
            )}
            {/* Calendar toggle button */}
            <Pressable
              onPress={toggleCalendar}
              style={({ pressed }) => [{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: calendarExpanded ? colors.primary : colors.surface,
                borderRadius: 16,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: calendarExpanded ? colors.primary : colors.border,
                opacity: pressed ? 0.7 : 1,
              }]}
            >
              <IconSymbol name="calendar" size={14} color={calendarExpanded ? "#FFF" : colors.foreground} />
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: calendarExpanded ? "#FFF" : colors.foreground }}>
                {selectedDateFilter
                  ? (() => {
                      const [, m, d] = selectedDateFilter.split("-").map(Number);
                      return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
                    })()
                  : "Calendar"}
              </Text>
            </Pressable>
          </View>
        </View>
        {/* Active date filter pill */}
        {selectedDateFilter && (
          <View style={{ marginTop: 6 }}>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>
              Showing appointments for{" "}
              <Text style={{ fontWeight: "700", color: colors.primary }}>
                {formatSectionDate(selectedDateFilter)}
              </Text>
            </Text>
          </View>
        )}
      </View>

      {/* Collapsible calendar */}
      <Animated.View style={{ height: calendarHeight, overflow: "hidden" }}>
        <View style={{
          marginHorizontal: hp,
          marginBottom: 4,
          backgroundColor: colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}>
          {renderMiniCalendar()}
        </View>
        {/* Dot color legend */}
        <View style={{
          marginHorizontal: hp,
          marginBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          paddingVertical: 6,
        }}>
          {([
            { color: "#60A5FA", label: "Confirmed" },
            { color: "#9CA3AF", label: "Pending" },
            { color: "#22C55E", label: "Completed" },
            { color: "#EF4444", label: "Cancelled" },
          ] as { color: string; label: string }[]).map((item) => (
            <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.color }} />
              <Text style={{ fontSize: 10, color: colors.muted, fontWeight: "500" }}>{item.label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Filter tabs */}
      <View style={{ paddingHorizontal: hp, marginBottom: activeFilter === "paid" ? 6 : 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {/* Today pill — filters to today's appointments */}
          {(() => {
            const isTodayActive = selectedDateFilter === todayStr;
            const todayCount = locationAppointments.filter((a) => a.date === todayStr).length;
            return (
              <Pressable
                onPress={() => setSelectedDateFilter(isTodayActive ? null : todayStr)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor: isTodayActive ? "#F59E0B18" : colors.surface,
                    borderColor: isTodayActive ? "#F59E0B" : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: isTodayActive ? "700" : "500", color: isTodayActive ? "#F59E0B" : colors.muted }}>
                  Today
                </Text>
                {todayCount > 0 && (
                  <View style={{ backgroundColor: isTodayActive ? "#F59E0B" : colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: isTodayActive ? "#FFF" : colors.muted }}>{todayCount}</Text>
                  </View>
                )}
              </Pressable>
            );
          })()}
          {FILTERS.map((f) => {
            const isActive = activeFilter === f.key;
            const count =
              f.key === "upcoming" ? locationAppointments.filter((a) => a.status === "confirmed" && a.date > todayStr).length
              : f.key === "confirmed" ? locationAppointments.filter((a) => a.status === "confirmed").length
              : f.key === "unpaid" ? locationAppointments.filter((a) => a.status !== "cancelled" && a.paymentStatus !== "paid").length
              : f.key === "paid" ? locationAppointments.filter((a) => a.paymentStatus === "paid").length
              : f.key === "requests" ? locationAppointments.filter((a) => a.status === "pending" || (a.rescheduleRequest as any)?.status === "pending").length
              : f.key === "cancelled" ? locationAppointments.filter((a) => a.status === "cancelled").length
              : locationAppointments.filter((a) => a.status === "completed").length;
            return (
              <Pressable
                key={f.key}
                onPress={() => { setActiveFilterPersisted(f.key); setMethodFilter(null); }}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor: isActive ? filterColors[f.key] + "18" : colors.surface,
                    borderColor: isActive ? filterColors[f.key] : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: isActive ? "700" : "500", color: isActive ? filterColors[f.key] : colors.muted }}>
                  {f.label}
                </Text>
                {count > 0 && (
                  <View style={{ backgroundColor: isActive ? filterColors[f.key] : colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: isActive ? "#FFF" : colors.muted }}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Service Type filter toggle */}
      <View style={{ paddingHorizontal: hp, marginBottom: 12, flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => setServiceTypeFilter(null)}
          style={({ pressed }) => ({
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 20,
            borderWidth: 1,
            backgroundColor: serviceTypeFilter === null ? colors.primary + "18" : colors.surface,
            borderColor: serviceTypeFilter === null ? colors.primary : colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: serviceTypeFilter === null ? "700" : "500", color: serviceTypeFilter === null ? colors.primary : colors.muted }}>All Types</Text>
        </Pressable>
        <Pressable
          onPress={() => setServiceTypeFilter(serviceTypeFilter === 'in_store' ? null : 'in_store')}
          style={({ pressed }) => ({
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 20,
            borderWidth: 1,
            backgroundColor: serviceTypeFilter === 'in_store' ? colors.primary + "18" : colors.surface,
            borderColor: serviceTypeFilter === 'in_store' ? colors.primary : colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: serviceTypeFilter === 'in_store' ? "700" : "500", color: serviceTypeFilter === 'in_store' ? colors.primary : colors.muted }}>🏪 In-Store</Text>
        </Pressable>
        <Pressable
          onPress={() => setServiceTypeFilter(serviceTypeFilter === 'mobile' ? null : 'mobile')}
          style={({ pressed }) => ({
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 20,
            borderWidth: 1,
            backgroundColor: serviceTypeFilter === 'mobile' ? "#0891b218" : colors.surface,
            borderColor: serviceTypeFilter === 'mobile' ? "#0891b2" : colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: serviceTypeFilter === 'mobile' ? "700" : "500", color: serviceTypeFilter === 'mobile' ? "#0891b2" : colors.muted }}>🚗 Mobile</Text>
        </Pressable>
      </View>
      {/* Method sub-filter (only for Paid) */}
      {activeFilter === "paid" && (
        <View style={{ paddingHorizontal: hp, marginBottom: 12 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Pressable
              onPress={() => setMethodFilter(null)}
              style={({ pressed }) => [
                styles.filterChip,
                {
                  backgroundColor: !methodFilter ? colors.primary + "18" : colors.surface,
                  borderColor: !methodFilter ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: !methodFilter ? "700" : "500", color: !methodFilter ? colors.primary : colors.muted }}>All</Text>
            </Pressable>
            {METHOD_FILTER_OPTIONS.map((m) => {
              const isActive = methodFilter === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMethodFilter(isActive ? null : m.key)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      backgroundColor: isActive ? m.color + "18" : colors.surface,
                      borderColor: isActive ? m.color : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={{ fontSize: fs.xs, fontWeight: isActive ? "700" : "500", color: isActive ? m.color : colors.muted }}>{m.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Reschedule request alert banner */}
      {(() => {
        const pendingRescheduled = locationAppointments.filter((a) => (a.rescheduleRequest as any)?.status === "pending");
        if (pendingRescheduled.length === 0) return null;
        return (
          <Pressable
            style={({ pressed }) => ({ paddingHorizontal: hp, marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
            onPress={() => setActiveFilterPersisted("requests")}
          >
            <View style={{ backgroundColor: "#F59E0B18", borderRadius: 12, borderWidth: 1.5, borderColor: "#F59E0B", padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: fs.md }}>🔄</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#92400E" }}>
                  {pendingRescheduled.length} reschedule request{pendingRescheduled.length !== 1 ? "s" : ""} pending
                </Text>
                <Text style={{ fontSize: fs.xs, color: "#B45309", marginTop: 2 }}>
                  Tap to review — clients are waiting for your response
                </Text>
              </View>
              <Text style={{ fontSize: fs.xs, color: "#92400E", fontWeight: "700" }}>→</Text>
            </View>
          </Pressable>
        );
      })()}
      {/* Bulk Mark All Paid banner (Unpaid filter only) */}
      {activeFilter === "unpaid" && filteredAppointments.length > 1 && (
        <View style={{ paddingHorizontal: hp, marginBottom: 10 }}>
          <View style={{ backgroundColor: "#22C55E18", borderRadius: 12, borderWidth: 1, borderColor: "#22C55E40", padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#15803D" }}>
                {filteredAppointments.length} unpaid appointment{filteredAppointments.length !== 1 ? "s" : ""}
              </Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                Total: ${filteredAppointments.reduce((s, a) => s + (a.totalPrice ?? 0), 0).toFixed(2)}
              </Text>
            </View>
            <Pressable
              onPress={() => { setPayModalIsBulk(true); setPayModalMethod("cash"); }}
              style={({ pressed }) => [{ backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={{ color: "#FFF", fontSize: fs.xs, fontWeight: "700" }}>Mark All Paid</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Package group filter banner */}
      {packageGroupFilter && (
        <View style={{ paddingHorizontal: hp, marginBottom: 10 }}>
          <View style={{ backgroundColor: '#0891b215', borderRadius: 12, borderWidth: 1.5, borderColor: '#0891b2', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: fs.sm }}>📦</Text>
            <View style={{ flex: 1 }}>
              {(() => {
                const pkgAppts = locationAppointments.filter((a) => a.packageGroupId === packageGroupFilter && a.status !== 'cancelled');
                const booked = pkgAppts.length;
                const total = pkgAppts[0]?.sessionTotal ?? booked;
                const pct = total > 0 ? Math.min(booked / total, 1) : 0;
                return (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: '700', color: '#0891b2' }}>Package Sessions</Text>
                      <Text style={{ fontSize: fs.xs, fontWeight: '600', color: '#0891b2' }}>{booked}/{total}</Text>
                    </View>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: '#0891b230', marginTop: 5, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${Math.round(pct * 100)}%`, borderRadius: 3, backgroundColor: '#0891b2' }} />
                    </View>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 3 }}>{booked === total ? 'All sessions booked ✓' : `${total - booked} session${total - booked !== 1 ? 's' : ''} remaining`}</Text>
                  </>
                );
              })()}
            </View>
            <Pressable
              onPress={() => setPackageGroupFilter(null)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#0891b220' })}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: '700', color: '#0891b2' }}>Clear</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Appointment list */}
      <View style={{ paddingHorizontal: hp }}>
        {filteredSections.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="calendar.badge.clock" size={32} color={colors.muted} />
            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.muted, marginTop: 10 }}>
              {selectedDateFilter
                ? `No ${activeFilter} appointments on ${formatSectionDate(selectedDateFilter)}`
                : `No ${activeFilter} appointments`}
            </Text>
          </View>
        ) : (
          filteredSections.map(({ date, items }) => (
            <View key={date}>
              {/* Date section header */}
              <View style={[styles.sectionHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                  {formatSectionDate(date)}
                </Text>
                <View style={{ backgroundColor: colors.border, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>{items.length}</Text>
                </View>
              </View>
              {items.map((appt) => renderApptCard(appt))}
            </View>
          ))
        )}
      </View>
    </>
  );

  // ─── Inline detail panel for split-view (tablet landscape) ─────────────
  const renderDetailPanel = () => {
    if (!selectedAppt) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <IconSymbol name="calendar.badge.clock" size={48} color={colors.border} />
          <Text style={{ fontSize: fs.md, color: colors.muted, marginTop: 16, textAlign: 'center', fontWeight: '500' }}>
            Select an appointment{'\n'}to view details
          </Text>
        </View>
      );
    }
    const svc = getServiceById(selectedAppt.serviceId);
    const client = getClientById(selectedAppt.clientId);
    const staff = selectedAppt.staffId ? getStaffById(selectedAppt.staffId) : null;
    const statusColor =
      selectedAppt.status === 'confirmed' ? '#1B5E20'
      : selectedAppt.status === 'pending' ? '#FF9800'
      : selectedAppt.status === 'completed' ? colors.primary
      : selectedAppt.status === 'no_show' ? '#F59E0B'
      : '#F44336';
    const isRequest = selectedAppt.status === 'pending';
    const isPaid = selectedAppt.paymentStatus === 'paid';
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Text style={{ fontSize: fs.xl, fontWeight: '800', color: colors.foreground, flex: 1 }} numberOfLines={2}>
            {client?.name ?? 'Client'}
          </Text>
          <Pressable
            onPress={() => router.push({ pathname: '/appointment-detail', params: { id: selectedAppt.id } })}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              opacity: pressed ? 0.8 : 1,
              marginLeft: 12,
            })}
          >
            <Text style={{ color: '#FFF', fontSize: fs.sm, fontWeight: '700' }}>Full Details</Text>
          </Pressable>
        </View>

        {/* Service card */}
        <View style={{ backgroundColor: (svc?.color ?? colors.primary) + '12', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: svc?.color ?? colors.primary, marginRight: 8 }} />
            <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.foreground, flex: 1 }} numberOfLines={2}>
              {svc ? getServiceDisplayName(svc) : 'Service'}
            </Text>
          </View>
          <Text style={{ fontSize: fs.sm, color: colors.muted }}>
            {formatTime(selectedAppt.time)} · {selectedAppt.duration} min
          </Text>
          {selectedAppt.totalPrice != null && (
            <Text style={{ fontSize: fs.lg, fontWeight: '800', color: colors.foreground, marginTop: 8 }}>
              ${selectedAppt.totalPrice.toFixed(2)}
            </Text>
          )}
        </View>

        {/* Status + staff row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <View style={{ backgroundColor: statusColor + '18', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: '700', color: statusColor, textTransform: 'capitalize' }}>{selectedAppt.status.replace('_', ' ')}</Text>
          </View>
          {isPaid && (
            <View style={{ backgroundColor: '#22C55E18', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#22C55E' }}>Paid</Text>
            </View>
          )}
          {staff && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: (staff.color || colors.primary) + '18', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: staff.color || colors.primary }} />
              <Text style={{ fontSize: fs.sm, fontWeight: '600', color: staff.color || colors.primary }}>{staff.name}</Text>
            </View>
          )}
        </View>

        {/* Date */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Date & Time</Text>
          <Text style={{ fontSize: fs.md, fontWeight: '600', color: colors.foreground }}>
            {formatSectionDate(selectedAppt.date)}
          </Text>
          <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 2 }}>
            {formatTime(selectedAppt.time)} · {selectedAppt.duration} min
          </Text>
        </View>

        {/* Notes */}
        {selectedAppt.notes ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Notes</Text>
            <Text style={{ fontSize: fs.sm, color: colors.foreground }}>{selectedAppt.notes}</Text>
          </View>
        ) : null}

        {/* Quick actions */}
        <View style={{ gap: 10 }}>
          {!isPaid && selectedAppt.status !== 'cancelled' && (
            <Pressable
              onPress={() => { setPayModalAppt(selectedAppt); setPayModalMethod('cash'); }}
              style={({ pressed }) => ({
                backgroundColor: '#22C55E',
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: '#FFF', fontSize: fs.md, fontWeight: '700' }}>Mark as Paid</Text>
            </Pressable>
          )}
          {isRequest && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => handleAccept(selectedAppt)}
                style={({ pressed }) => ({
                  flex: 1, backgroundColor: '#1B5E20', borderRadius: 14,
                  paddingVertical: 14, alignItems: 'center',
                  opacity: pressed ? 0.8 : 1, flexDirection: 'row', justifyContent: 'center', gap: 6,
                })}
              >
                <IconSymbol name="checkmark" size={16} color="#FFF" />
                <Text style={{ color: '#FFF', fontSize: fs.md, fontWeight: '700' }}>Accept</Text>
              </Pressable>
              <Pressable
                onPress={() => handleReject(selectedAppt)}
                style={({ pressed }) => ({
                  flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: '#F44336',
                  paddingVertical: 14, alignItems: 'center',
                  opacity: pressed ? 0.8 : 1, flexDirection: 'row', justifyContent: 'center', gap: 6,
                })}
              >
                <IconSymbol name="xmark" size={16} color="#F44336" />
                <Text style={{ color: '#F44336', fontSize: fs.md, fontWeight: '700' }}>Reject</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };
  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <ScreenContainer>
      <FuturisticBackground />
      {useSideBySide ? (
        // ── Tablet landscape: two-column split view ──────────────────────────
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* Left column: filter + list (42%) */}
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            style={{ width: '42%', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {listContent}
          </ScrollView>
          {/* Right column: detail panel (58%) */}
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            {renderDetailPanel()}
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120, maxWidth: maxContentWidth, alignSelf: "center", width: "100%" }}
        >
          {listContent}
        </ScrollView>
      )}

      {/* Payment Method Modal */}
      <Modal visible={!!payModalAppt || payModalIsBulk} transparent animationType="slide">
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} onPress={() => { setPayModalAppt(null); setPayModalIsBulk(false); }}>
          <Pressable style={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 20, backgroundColor: colors.background, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }} onPress={() => {}}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
                {payModalIsBulk ? `Mark All ${filteredAppointments.length} as Paid` : "Mark as Paid"}
              </Text>
              <Pressable onPress={() => { setPayModalAppt(null); setPayModalIsBulk(false); }} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            {payModalAppt && (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16 }}>
                {getClientById(payModalAppt.clientId)?.name ?? "Client"}{payModalAppt.totalPrice != null ? ` · $${payModalAppt.totalPrice.toFixed(2)}` : ""}
              </Text>
            )}
            {payModalIsBulk && (() => {
              const total = filteredAppointments.reduce((s, a) => s + (a.totalPrice ?? 0), 0);
              return (
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16 }}>
                  {filteredAppointments.length} appointment{filteredAppointments.length !== 1 ? "s" : ""} · ${total.toFixed(2)} total
                </Text>
              );
            })()}
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Payment Method</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
              {PAYMENT_METHODS.map((pm) => (
                <Pressable
                  key={pm.key}
                  onPress={() => setPayModalMethod(pm.key)}
                  style={({ pressed }) => [{
                    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22,
                    backgroundColor: payModalMethod === pm.key ? "#22C55E" : colors.surface,
                    borderWidth: 1.5,
                    borderColor: payModalMethod === pm.key ? "#22C55E" : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  }]}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: payModalMethod === pm.key ? "#FFF" : colors.foreground }}>{pm.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                if (payModalIsBulk) {
                  const apptsToPay = filteredAppointments.filter((a) => a.paymentStatus !== "paid");
                  const ids = apptsToPay.map((a) => a.id);
                  doMarkPaid(apptsToPay, payModalMethod);
                  if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                  setUndoToast({ count: apptsToPay.length, ids });
                  undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
                } else if (payModalAppt) {
                  doMarkPaid([payModalAppt], payModalMethod);
                }
                setPayModalAppt(null);
                setPayModalIsBulk(false);
                setPayModalMethod("cash");
              }}
              style={({ pressed }) => [{ backgroundColor: "#22C55E", paddingVertical: 16, borderRadius: 14, alignItems: "center", opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={{ color: "#FFF", fontWeight: "700", fontSize: fs.md }}>
                {payModalIsBulk ? `Mark All Paid · ${payModalMethod.charAt(0).toUpperCase() + payModalMethod.slice(1)}` : `Confirm Payment · ${PAYMENT_METHODS.find((p) => p.key === payModalMethod)?.label ?? payModalMethod}`}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Refund Modal */}
      <Modal
        visible={!!refundAppt}
        transparent
        animationType="slide"
        onRequestClose={() => setRefundAppt(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={() => setRefundAppt(null)} />
          <View style={[styles.payModal, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <Text style={[styles.payModalTitle, { color: colors.foreground }]}>Issue Refund</Text>
            {refundAppt && (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 12, textAlign: "center" }}>
                {getClientById(refundAppt.clientId)?.name ?? "Client"} · {refundAppt.date} · ${(refundAppt.totalPrice ?? 0).toFixed(2)} total
              </Text>
            )}
            <Pressable
              onPress={() => { if (refundAppt) setRefundAmount(String(refundAppt.totalPrice ?? 0)); }}
              style={({ pressed }) => [{
                backgroundColor: pressed ? "#4f46e5" : "#635BFF",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
                marginBottom: 10,
              }]}
            >
              <Text style={{ color: "#FFF", fontWeight: "700", fontSize: fs.sm }}>
                Full Refund · ${(refundAppt?.totalPrice ?? 0).toFixed(2)}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text style={{ color: colors.muted, fontSize: fs.xs, marginHorizontal: 10 }}>or partial amount</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>
            <TextInput
              value={refundAmount}
              onChangeText={setRefundAmount}
              placeholder={`Amount (max $${(refundAppt?.totalPrice ?? 0).toFixed(2)})`}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
              style={[styles.payModalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
            <Pressable
              onPress={handleRefund}
              style={({ pressed }) => [{
                backgroundColor: pressed ? "#b91c1c" : "#EF4444",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
                marginBottom: 8,
              }]}
            >
              {refundLoading
                ? <ActivityIndicator color="#FFF" />
                : <Text style={{ color: "#FFF", fontWeight: "700", fontSize: fs.sm }}>Confirm Refund</Text>
              }
            </Pressable>
            <Pressable onPress={() => setRefundAppt(null)} style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ color: colors.muted, fontSize: fs.sm }}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Package Completion Modal */}
      <Modal visible={showPkgCompleteModal} transparent animationType="fade">
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onPress={() => setShowPkgCompleteModal(false)}
        >
          <Pressable
            style={{ width: '100%', maxWidth: 340, backgroundColor: colors.background, borderRadius: 24, padding: 28, alignItems: 'center', gap: 12 }}
            onPress={() => {}}
          >
            <Text style={{ fontSize: 52 }}>🎉</Text>
            <Text style={{ fontSize: fs.lg, fontWeight: '800', color: colors.foreground, textAlign: 'center' }}>Package Complete!</Text>
            {pkgCompleteInfo && (
              <>
                <Text style={{ fontSize: fs.sm, color: colors.muted, textAlign: 'center', lineHeight: 22 }}>
                  All {pkgCompleteInfo.sessions} sessions of{' '}
                  <Text style={{ fontWeight: '700', color: colors.foreground }}>{pkgCompleteInfo.name}</Text>{' '}
                  have been booked.
                </Text>
                {pkgCompleteInfo.totalValue > 0 && (
                  <View style={{ backgroundColor: colors.success + '18', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 18, marginTop: 4 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.success, fontWeight: '700', textAlign: 'center' }}>
                      Total package value: ${pkgCompleteInfo.totalValue.toFixed(2)}
                    </Text>
                  </View>
                )}
              </>
            )}
            {pkgCompleteInfo && (
              <Pressable
                onPress={() => {
                  setShowPkgCompleteModal(false);
                  setPackageGroupFilter(pkgCompleteInfo.groupId);
                }}
                style={({ pressed }) => ({ marginTop: 4, width: '100%', paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.primary }}>View Package Sessions</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setShowPkgCompleteModal(false)}
              style={({ pressed }) => ({ marginTop: 4, width: '100%', paddingVertical: 14, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}
            >
              <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>Awesome!</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Undo toast */}
      {undoToast && (
        <View style={styles.undoToast}>
          <Text style={styles.undoToastText}>
            {undoToast.count} appointment{undoToast.count !== 1 ? "s" : ""} marked paid
          </Text>
          <Pressable
            onPress={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              bulkMarkUnpaid(undoToast.ids);
              setUndoToast(null);
            }}
            style={({ pressed }) => [styles.undoBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.undoBtnText}>Undo</Text>
          </Pressable>
        </View>
      )}
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  apptCard: {
    flexDirection: "column",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    marginTop: 4,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    width: "100%",
  },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
  },
  rejectBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
  },
  undoToast: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    backgroundColor: "#1F2937",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
    zIndex: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  undoToastText: { flex: 1, color: "#FFF", fontSize: 13, fontWeight: "500" },
  undoBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#00C896", borderRadius: 10 },
  undoBtnText: { color: "#FFF", fontWeight: "700", fontSize: 11 },
  payModal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    borderTopWidth: 1,
  },
  payModalTitle: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  payModalInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 16,
  },
});
