import { Text, View, Pressable, StyleSheet, ScrollView, Alert, Platform, Linking, Modal, TextInput, TouchableOpacity, Image, FlatList, KeyboardAvoidingView, AppState,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, formatTime, formatDateDisplay } from "@/lib/store";
import { getSessionToken } from "@/lib/_core/auth";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { apiCall } from "@/lib/_core/api";
import { trpc } from "@/lib/trpc";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { FuturisticBackground } from "@/components/futuristic-background";
import { getApiBaseUrl, DEEP_LINK_SCHEME } from "@/constants/oauth";
import { PaymentReceiptModal } from "@/components/payment-receipt-modal";

import {
  minutesToTime,
  timeToMinutes,
  formatTimeDisplay,
  getServiceDisplayName,
  getMapUrl,
  stripPhoneFormat,
  formatPhoneNumber,
  generateAcceptMessage,
  generateRejectMessage,
  generateCancellationMessage,
  formatFullAddress,
  PUBLIC_BOOKING_URL,
  LIME_OF_TIME_FOOTER,
  generateAvailableSlots,
  DAYS_OF_WEEK,
} from "@/lib/types";

/** Replace {variable} placeholders in a custom template and append the Lime Of Time footer */
function applyTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, val);
  }
  return result + LIME_OF_TIME_FOOTER;
}

export default function AppointmentDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { state, dispatch, getServiceById, getClientById, getStaffById, getLocationById, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const sendSmsMutation = trpc.twilio.sendSms.useMutation();
  const { planInfo } = usePlanLimitCheck();
  const isGrowthPlan = planInfo && planInfo.planKey !== "solo";
  // Card/Stripe payments are only available on Studio and Enterprise plans (adminOverride gets enterprise)
  const isStripePlan = planInfo && (planInfo.planKey === "studio" || planInfo.planKey === "enterprise");

  const appointment = useMemo(
    () => state.appointments.find((a) => a.id === id),
    [state.appointments, id]
  );

  // ── All hooks must be declared before any early return (Rules of Hooks) ──
  const [cancelReasonModal, setCancelReasonModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const today = new Date();
  const [reschedDate, setReschedDate] = useState<string>(appointment?.date ?? "");
  const [reschedTime, setReschedTime] = useState<string | null>(null);
  // null = use global setting, 0 = Auto, positive = explicit minutes
  const [reschedLocalInterval, setReschedLocalInterval] = useState<number | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [reschedClosedDayMsg, setReschedClosedDayMsg] = useState<string | null>(null);
  const reschedClosedDayTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showReschedClosedDayMsg = React.useCallback((msg: string) => {
    if (reschedClosedDayTimer.current) clearTimeout(reschedClosedDayTimer.current);
    setReschedClosedDayMsg(msg);
    reschedClosedDayTimer.current = setTimeout(() => setReschedClosedDayMsg(null), 3000);
  }, []);
  const [reschedCalMonth, setReschedCalMonth] = useState<{ year: number; month: number }>(() => {
    const d = appointment ? new Date(appointment.date + "T12:00:00") : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentConfirmInput, setPaymentConfirmInput] = useState("");
  // When completing a pay_later appointment, store the doIt callback so we can
  // call it after the payment sheet is confirmed or skipped.
  const pendingCompleteRef = useRef<(() => void) | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [showNoShowFeeModal, setShowNoShowFeeModal] = useState(false);
  const [noShowFeeAmount, setNoShowFeeAmount] = useState("");
  const [noShowFeeLoading, setNoShowFeeLoading] = useState(false);
  const [selectedPayMethod, setSelectedPayMethod] = useState<'cash' | 'zelle' | 'venmo' | 'cashapp'>(
    (appointment?.paymentMethod && appointment.paymentMethod !== 'unpaid' ? appointment.paymentMethod : 'cash') as 'cash' | 'zelle' | 'venmo' | 'cashapp'
  );
  const [requestingPayment, setRequestingPayment] = useState(false);
  const [paymentLinkSent, setPaymentLinkSent] = useState(false);
  // Track the last Stripe session ID so we can check expiry on Resend
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  // Track if we've already notified the owner about auto-detected payment
  const pollingNotifiedRef = useRef(false);
  // Set to true when we open Stripe in Safari so we check status when app resumes
  const pendingPaymentCheckRef = useRef(false);
  // Staff notes state (internal, not visible to clients)
  const [staffNotesValue, setStaffNotesValue] = useState(appointment?.staffNotes ?? "");
  const [staffNotesSaving, setStaffNotesSaving] = useState(false);
  const staffNotesTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveStaffNotes = useCallback((value: string) => {
    if (!appointment) return;
    const updated = { ...appointment, staffNotes: value };
    dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
    syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated }).catch(() => {});
    setStaffNotesSaving(false);
  }, [appointment, dispatch, syncToDb]);

  const handleStaffNotesChange = useCallback((value: string) => {
    setStaffNotesValue(value);
    setStaffNotesSaving(true);
    if (staffNotesTimer.current) clearTimeout(staffNotesTimer.current);
    staffNotesTimer.current = setTimeout(() => saveStaffNotes(value), 800);
  }, [saveStaffNotes]);

  // OSRM drive time estimate from business to client address (for mobile appointments)
  const [apptDriveTime, setApptDriveTime] = useState<string | null>(null);
  const [apptDriveLoading, setApptDriveLoading] = useState(false);

  useEffect(() => {
    const addr = appointment?.clientAddress;
    if (!addr) { setApptDriveTime(null); return; }
    const locs = state.locations;
    const bizLoc = locs.length > 0 ? locs[0] : null;
    const bizAddr = bizLoc
      ? [bizLoc.address, bizLoc.city, bizLoc.state, bizLoc.zipCode].filter(Boolean).join(', ')
      : [profile?.address, profile?.city, profile?.state, profile?.zipCode].filter(Boolean).join(', ');
    if (!bizAddr) { setApptDriveTime(null); return; }
    let cancelled = false;
    const geocode = async (a: string): Promise<[number, number] | null> => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(a)}&format=json&limit=1`, { headers: { 'User-Agent': 'LimeOfTime/1.0' } });
        const data = await res.json();
        if (!data || data.length === 0) return null;
        return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
      } catch { return null; }
    };
    const run = async () => {
      setApptDriveLoading(true); setApptDriveTime(null);
      const [origin, dest] = await Promise.all([geocode(bizAddr), geocode(addr)]);
      if (cancelled) return;
      if (!origin || !dest) { setApptDriveLoading(false); return; }
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${dest[0]},${dest[1]}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (data?.routes?.[0]) {
          const route = data.routes[0];
          const mins = Math.round(route.duration / 60);
          const distMiles = (route.distance as number) / 1609.344;
          setApptDriveTime(`~${mins} min drive · ${distMiles.toFixed(1)} mi from business`);
        }
      } catch { /* ignore */ }
      setApptDriveLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [appointment?.clientAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discount modal state
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [chargesExpanded, setChargesExpanded] = useState(true);
  // Edit Payment sheet state
  const [showEditPaymentSheet, setShowEditPaymentSheet] = useState(false);
  const [editPayMethod, setEditPayMethod] = useState<'cash' | 'zelle' | 'venmo' | 'cashapp' | 'card'>('cash');
  const [editPayStatus, setEditPayStatus] = useState<'paid' | 'unpaid'>('paid');
  const [editConfirmNumber, setEditConfirmNumber] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  // Partial gift redemption sheet
  const [showGiftRedeemSheet, setShowGiftRedeemSheet] = useState(false);
  const [giftRedeemAmount, setGiftRedeemAmount] = useState('');
  const [savingGiftRedeem, setSavingGiftRedeem] = useState(false);
  // Pay on behalf of client — native Stripe payment sheet
  const [payingOnBehalf, setPayingOnBehalf] = useState(false);
  // Receipt modal data — shown after a successful card payment
  const [receiptData, setReceiptData] = useState<{
    amount: number;
    serviceName?: string;
    clientName?: string;
    cardLast4?: string;
    cardBrand?: string;
    confirmationId?: string;
  } | null>(null);
  // Fee breakdown modal state
  const [feeBreakdown, setFeeBreakdown] = useState<{
    serviceAmount: number;
    discountAmount: number;
    discountName: string | null;
    platformFee: number;
    platformFeePercent: number;
    stripeFee: number;
    totalCharged: number;
    businessNetPayout: number;
  } | null>(null);
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);

  // Package sessions accordion
  const [showSessionsAccordion, setShowSessionsAccordion] = useState(false);


  // Derived variables — safe with optional chaining (appointment may be null during hydration)
  const service = appointment ? getServiceById(appointment.serviceId) : null;
  const client = appointment ? getClientById(appointment.clientId) : null;
  const assignedStaff = appointment?.staffId ? getStaffById(appointment.staffId) : null;
  const assignedLocation = appointment?.locationId ? getLocationById(appointment.locationId) : null;
  const endTimeStr = appointment ? formatTime(minutesToTime(timeToMinutes(appointment.time) + appointment.duration)) : "";
  // All sibling sessions in the same package group, sorted by sessionIndex
  const packageSiblings = useMemo(() => {
    if (!appointment?.packageGroupId) return [];
    return state.appointments
      .filter(a => a.packageGroupId === appointment.packageGroupId)
      .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0));
  }, [state.appointments, appointment?.packageGroupId]);
  const policy = state.settings.cancellationPolicy;
  const biz = state.settings;
  const profile = biz.profile;

  const openSms = (phone: string, message: string) => {
    const rawPhone = stripPhoneFormat(phone);
    if (Platform.OS === "web") {
      Alert.alert("SMS Message", message);
      return;
    }
    const separator = Platform.OS === "ios" ? "&" : "?";
    const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(message)}`;
    Linking.openURL(url).catch(() => Alert.alert("SMS", message));
  };

  const getCancellationInfo = () => {
    if (!policy.enabled) return { feeApplies: false, fee: 0 };
    const appt = appointment!;
    const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
    const now = new Date();
    const hoursUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const feeApplies = hoursUntil <= policy.hoursBeforeAppointment;
    const fee = feeApplies ? Math.round((service?.price ?? 0) * policy.feePercentage / 100) : 0;
    return { feeApplies, fee };
  };

  const handleAccept = () => {
    const appt = appointment!;
    dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appt.id, status: "confirmed" } });
    syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appt.id, status: "confirmed" } });
    if (client?.phone) {
      const customTpl = biz.smsTemplates?.confirmation;
      let msg: string;
      if (customTpl) {
        const slug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
        const fullAddr = assignedLocation
          ? formatFullAddress(assignedLocation.address, assignedLocation.city, assignedLocation.state, assignedLocation.zipCode)
          : formatFullAddress(profile.address, profile.city, profile.state, profile.zipCode);
        const locLine = assignedLocation?.name ? (fullAddr ? `${assignedLocation.name} \u2014 ${fullAddr}` : assignedLocation.name) : fullAddr;
        // Build paymentOptions string for {paymentOptions} template variable
        const _payLines: string[] = [];
        if (biz.zelleHandle) _payLines.push(`💳 Zelle: ${biz.zelleHandle}`);
        if (biz.cashAppHandle) _payLines.push(`💵 Cash App: ${biz.cashAppHandle}`);
        if (biz.venmoHandle) _payLines.push(`💸 Venmo: ${biz.venmoHandle}`);
        const _paymentOptions = _payLines.length > 0 ? _payLines.join("\n") : "";
        msg = applyTemplate(customTpl, {
          clientName: client.name,
          businessName: biz.businessName,
          serviceName: service ? getServiceDisplayName(service) : "Service",
          duration: String(appt.duration),
          date: appt.date,
          time: appt.time,
          location: locLine,
          phone: formatPhoneNumber(stripPhoneFormat(assignedLocation?.phone || profile.phone)),
          clientPhone: client.phone,
          bookingUrl: `${PUBLIC_BOOKING_URL}/book/${slug}${assignedLocation?.id ? "?location=" + assignedLocation.id : ""}`,
          reviewUrl: `${PUBLIC_BOOKING_URL}/review/${slug}`,
          paymentOptions: _paymentOptions,
        });
      } else {
        msg = generateAcceptMessage(
          biz.businessName,
          assignedLocation?.address || profile.address,
          client.name,
          service ? getServiceDisplayName(service) : "Service",
          appt.duration,
          appt.date,
          appt.time,
          assignedLocation?.phone || profile.phone,
          client.phone,
          appt.id,
          assignedLocation?.name,
          assignedLocation?.id,
          biz.customSlug,
          assignedLocation?.city ?? profile.city,
          assignedLocation?.state ?? profile.state,
          assignedLocation?.zipCode ?? profile.zipCode,
          biz.zelleHandle,
          biz.cashAppHandle,
          biz.venmoHandle
        );
      }
      openSms(client.phone, msg);
    }
    router.back();
  };

  const reschedSlots = useMemo(() => {
    // Guard: appointment not loaded yet or reschedDate is empty/invalid — skip slot generation
    if (!appointment || !reschedDate || !/^\d{4}-\d{2}-\d{2}$/.test(reschedDate)) return [];
    const loc = assignedLocation;
    const wh = (loc?.workingHours != null && Object.keys(loc.workingHours).length > 0)
      ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
      : (state.settings.workingHours ?? undefined);
    // Resolve slot interval: local UI override > location override > global setting > Auto
    const globalInterval = state.settings.slotInterval ?? 0;
    const locInterval = (loc as any)?.slotIntervalMinutes;
    const bufferMin = state.settings.bufferTime ?? 0;
    const autoStep = Math.max(5, appointment.duration + bufferMin);
    let stepMins: number;
    if (reschedLocalInterval !== null) {
      stepMins = reschedLocalInterval === 0 ? autoStep : reschedLocalInterval;
    } else if (locInterval != null && locInterval > 0) {
      stepMins = locInterval;
    } else {
      stepMins = globalInterval > 0 ? globalInterval : autoStep;
    }
    // Exclude the current appointment from conflict check
    const otherAppts = state.appointments.filter(a => a.id !== appointment.id);
    // Filter to only appointments for the assigned staff (staff availability)
    const staffId = appointment.staffId;
    const staffFilteredAppts = staffId
      ? otherAppts.filter(a => !a.staffId || a.staffId === staffId)
      : otherAppts;
    return generateAvailableSlots(
      reschedDate,
      appointment.duration,
      wh,
      staffFilteredAppts,
      stepMins,
      undefined,
      state.settings.scheduleMode,
      bufferMin
    );
  }, [reschedDate, appointment, assignedLocation, state.settings, state.appointments, reschedLocalInterval]);

  // Pre-compute slot counts for every day in the visible month (for calendar dot indicators + disabled dates)
  const reschedMonthSlotCounts = useMemo(() => {
    if (!appointment) return {} as Record<string, number>;
    const { year, month } = reschedCalMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const loc = assignedLocation;
    const wh = (loc?.workingHours != null && Object.keys(loc.workingHours).length > 0)
      ? loc.workingHours as Record<string, import('@/lib/types').WorkingHours>
      : (state.settings.workingHours ?? undefined);
    const globalInterval = state.settings.slotInterval ?? 0;
    const locInterval = (loc as any)?.slotIntervalMinutes;
    const bufferMin = state.settings.bufferTime ?? 0;
    const autoStep = Math.max(5, appointment.duration + bufferMin);
    let stepMins: number;
    if (reschedLocalInterval !== null) {
      stepMins = reschedLocalInterval === 0 ? autoStep : reschedLocalInterval;
    } else if (locInterval != null && locInterval > 0) {
      stepMins = locInterval;
    } else {
      stepMins = globalInterval > 0 ? globalInterval : autoStep;
    }
    const otherAppts = state.appointments.filter(a => a.id !== appointment.id);
    const staffId = appointment.staffId;
    const staffFilteredAppts = staffId
      ? otherAppts.filter(a => !a.staffId || a.staffId === staffId)
      : otherAppts;
    const counts: Record<string, number> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const slots = generateAvailableSlots(
        dateStr,
        appointment.duration,
        wh,
        staffFilteredAppts,
        stepMins,
        undefined,
        state.settings.scheduleMode,
        bufferMin
      );
      counts[dateStr] = slots.length;
    }
    return counts;
  }, [reschedCalMonth, appointment, assignedLocation, state.settings, state.appointments, reschedLocalInterval]);

  const handleReschedule = useCallback(() => {
    if (!reschedTime) return;
    const updated = {
      ...appointment!,
      date: reschedDate,
      time: reschedTime,
      rescheduleReason: rescheduleReason.trim() || undefined,
      // Preserve package session metadata so the session stays linked to its package
      packageGroupId: appointment!.packageGroupId,
      packageName: appointment!.packageName,
      sessionIndex: appointment!.sessionIndex,
      sessionTotal: appointment!.sessionTotal,
    };
    dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
    syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
    setShowRescheduleModal(false);
      // Send reschedule SMS if client has phone — respect master notificationsEnabled
    const _notifPrefs3 = state.settings.notificationPreferences ?? {};
    const _masterNotifOn3 = state.settings.notificationsEnabled !== false;
    const _smsReschedOn = (_notifPrefs3 as any).smsClientOnConfirmation !== false; // reuse confirmation toggle for reschedule
    if (client?.phone && _masterNotifOn3 && _smsReschedOn) {
      const svcName = service ? getServiceDisplayName(service) : "your appointment";
      const locLine = assignedLocation?.name ? `\n📍 ${assignedLocation.name}` : "";
      const slug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
      const bookingLink = `${PUBLIC_BOOKING_URL}/book/${slug}${assignedLocation?.id ? "?location=" + assignedLocation.id : ""}`;
      const manageLink = appointment!.id ? `${PUBLIC_BOOKING_URL}/manage/${slug}/${appointment!.id}` : "";
      const calendarLine = manageLink ? `\n\n🗓️ Add to calendar / manage: ${manageLink}` : "";
      const msg = `Hi ${client.name}, your appointment for ${svcName} has been rescheduled to ${reschedDate} at ${formatTime(reschedTime)}.${locLine}${calendarLine}\n\n📅 Book again: ${bookingLink}\n\n— ${biz.businessName}${LIME_OF_TIME_FOOTER}`;
      const rawPhone = stripPhoneFormat(client.phone);
      const smsEnabled = state.settings.twilioEnabled;
      if (smsEnabled && state.businessOwnerId) {
        const toNumber = rawPhone.startsWith('+') ? rawPhone : `+1${rawPhone.replace(/\D/g, '')}`;
        sendSmsMutation
          .mutateAsync({
            businessOwnerId: state.businessOwnerId,
            toNumber,
            body: msg,
            smsAction: 'confirmation',
          })
          .catch(() => openSms(client.phone!, msg));
      } else {
        openSms(client.phone, msg);
      }
    }
  }, [appointment, reschedDate, reschedTime, client, service, assignedLocation, biz, dispatch, syncToDb, sendSmsMutation, state.settings.twilioEnabled, state.businessOwnerId]);

  // Calendar helpers for reschedule
  const reschedCalDays = useMemo(() => {
    const { year, month } = reschedCalMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [reschedCalMonth]);
  const DETAIL_PAYMENT_METHODS = [
    { key: 'cash' as const, label: 'Cash' },
    { key: 'zelle' as const, label: 'Zelle' },
    { key: 'venmo' as const, label: 'Venmo' },
    { key: 'cashapp' as const, label: 'Cash App' },
  ];

  const handleRefund = useCallback(async (partial?: number) => {
    if (!appointment || !state.businessOwnerId) return;
    setRefunding(true);
    try {
      const result = await apiCall<{ ok: boolean; refundId: string; amount: number }>("/api/stripe-connect/refund", {
        method: "POST",
        body: JSON.stringify({
          businessOwnerId: state.businessOwnerId,
          appointmentLocalId: appointment.id,
          ...(partial ? { amount: partial } : {}),
        }),
      });
      const refundedAppt = { ...appointment, paymentStatus: "unpaid" as const, paymentMethod: undefined };
      dispatch({ type: "UPDATE_APPOINTMENT", payload: refundedAppt });
      syncToDb({ type: "UPDATE_APPOINTMENT", payload: refundedAppt });
      Alert.alert("Refund Issued", `$${result.amount.toFixed(2)} has been refunded to the client's card.\nRefund ID: ${result.refundId}`);
    } catch (err: any) {
      Alert.alert("Refund Failed", err?.message ?? "Could not issue refund. Please try again.");
    } finally {
      setRefunding(false);
      setShowRefundModal(false);
      setRefundAmount("");
    }
  }, [appointment, state.businessOwnerId, dispatch, syncToDb]);

  const handleRequestPayment = useCallback(async () => {
    if (!appointment || !state.businessOwnerId) return;
    if (!client?.phone) {
      Alert.alert("No Phone Number", "This client does not have a phone number on file. Please add one before sending a payment link.");
      return;
    }
    setRequestingPayment(true);
    try {
      const result = await apiCall<{ ok: boolean; url: string; sessionId: string }>("/api/stripe-connect/request-payment", {
        method: "POST",
        body: JSON.stringify({
          businessOwnerId: state.businessOwnerId,
          appointmentLocalId: appointment.id,
        }),
      });
      const paymentUrl = result.url;
      // Save the session ID so we can check expiry on Resend
      setLastSessionId(result.sessionId);
      const serviceName = service ? getServiceDisplayName(service) : "your appointment";
      const apptDate = formatDateDisplay(appointment.date);
      const smsBody = `Hi ${client.name}, please complete your payment of $${(appointment.totalPrice ?? 0).toFixed(2)} for ${serviceName} on ${apptDate}.\n\nPay securely by card here:\n${paymentUrl}\n\n— ${biz.businessName}${LIME_OF_TIME_FOOTER}`;
      // Try server-side Twilio SMS first; fall back to native SMS
      const smsEnabled = state.settings.twilioEnabled;
      if (smsEnabled && state.businessOwnerId) {
        const rawPhone = stripPhoneFormat(client.phone);
        const toNumber = rawPhone.startsWith('+') ? rawPhone : `+1${rawPhone.replace(/\D/g, '')}`;
        try {
          await sendSmsMutation.mutateAsync({ businessOwnerId: state.businessOwnerId!, toNumber, body: smsBody, smsAction: "confirmation" });
          setPaymentLinkSent(true);
          Alert.alert("Payment Link Sent", `A payment link has been sent to ${client.name} via SMS.\n\nThey will be taken to a secure card payment page.`);
        } catch {
          openSms(client.phone, smsBody);
          setPaymentLinkSent(true);
        }
      } else {
        openSms(client.phone, smsBody);
        setPaymentLinkSent(true);
      }
    } catch (err: any) {
      Alert.alert("Failed", err?.message ?? "Could not create payment link. Please check Stripe is connected.");
    } finally {
      setRequestingPayment(false);
    }
  }, [appointment, state.businessOwnerId, state.settings.twilioEnabled, client, service, biz.businessName, sendSmsMutation, openSms, dispatch]);

  // ── Helper: check appointment payment status after browser closes ──────────
  const checkPaymentStatusAfterBrowser = useCallback(async (appointmentLocalId: string) => {
    if (!state.businessOwnerId) return;
    try {
      const statusResult = await apiCall<{ ok: boolean; paymentStatus: string; paymentMethod: string | null }>(
        `/api/stripe-connect/appointment-payment-status?businessOwnerId=${state.businessOwnerId}&appointmentLocalId=${encodeURIComponent(appointmentLocalId)}`,
      );
      if (statusResult.paymentStatus === 'paid') {
        // Update local state
        const updated = { ...appointment!, paymentStatus: 'paid' as const, paymentMethod: 'card' as any };
        dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated as any });
        syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updated as any });
        // Show receipt
        setReceiptData({
          amount: appointment?.totalPrice ?? 0,
          serviceName: service ? getServiceDisplayName(service) : undefined,
          clientName: client?.name ?? undefined,
          confirmationId: appointmentLocalId,
        });
      }
    } catch { /* non-blocking — webhook will handle it */ }
  }, [state.businessOwnerId, appointment, service, client, dispatch, syncToDb]);

  // ── Pay on behalf of client via Stripe Checkout (browser-based) ──────────────
  const handlePayOnBehalf = useCallback(async () => {
    if (!appointment || !state.businessOwnerId) return;
    const totalAmount = appointment.totalPrice ?? 0;
    if (totalAmount <= 0) {
      Alert.alert('No Amount', 'This appointment has no charge amount.');
      return;
    }
    // Calculate fee breakdown locally and show confirmation modal.
    // The actual Stripe Checkout session is created only when the owner taps "Confirm & Charge".
    const total = totalAmount;
    const platformFeePercent = 1.5;
    const platformFee = Math.round(total * (platformFeePercent / 100) * 100) / 100;
    const stripeFee = Math.round((total * 0.029 + 0.30) * 100) / 100;
    const totalCharged = Math.round((total + platformFee) * 100) / 100;
    const businessNetPayout = Math.round((total - stripeFee) * 100) / 100;
    setFeeBreakdown({
      serviceAmount: total,
      discountAmount: 0,
      discountName: null,
      platformFee,
      platformFeePercent,
      stripeFee,
      totalCharged,
      businessNetPayout,
    });
    setShowFeeBreakdown(true);
  }, [appointment, state.businessOwnerId]);

  // Called when owner confirms the fee breakdown modal before charging client on behalf
  const handleConfirmBehalfPayment = useCallback(async () => {
    if (!appointment || !state.businessOwnerId) return;
    setShowFeeBreakdown(false);
    setFeeBreakdown(null);
    setPayingOnBehalf(true);
    try {
      // Create the Stripe Checkout session now that the owner has confirmed the fee breakdown
      // Pass deep-link URLs so Safari auto-closes and returns to the app after payment
      const deepSuccessUrl = `${DEEP_LINK_SCHEME}://payment-success?appt=${encodeURIComponent(appointment.id)}&boid=${state.businessOwnerId}`;
      const deepCancelUrl = `${DEEP_LINK_SCHEME}://payment-cancel?appt=${encodeURIComponent(appointment.id)}&boid=${state.businessOwnerId}`;
      const result = await apiCall<{ ok: boolean; url: string; sessionId: string }>(
        '/api/stripe-connect/request-payment',
        {
          method: 'POST',
          body: JSON.stringify({
            businessOwnerId: state.businessOwnerId,
            appointmentLocalId: appointment.id,
            successUrl: deepSuccessUrl,
            cancelUrl: deepCancelUrl,
          }),
        },
      );
      if (!result.url) throw new Error('Could not create payment session.');
      setPayingOnBehalf(false);
      // Open Stripe Checkout in system Safari — reliable on all platforms
      // Mark that we're awaiting payment so AppState listener checks status on return
      pendingPaymentCheckRef.current = true;
      await Linking.openURL(result.url);
    } catch (err: any) {
      Alert.alert('Payment Error', err?.message ?? 'Could not process payment. Please try again.');
    } finally {
      setPayingOnBehalf(false);
    }
  }, [appointment, state.businessOwnerId, checkPaymentStatusAfterBrowser]);

  // ── Payment status polling — check every 30s if appointment is unpaid ──────
  // ── Immediate payment status check on mount (for notification tap) ─────────
  // When the screen opens from a push notification, the DB may already be updated
  // but local state hasn't synced yet. Do a single immediate check.
  useEffect(() => {
    if (!appointment || !state.businessOwnerId) return;
    if (!(state.settings as any).stripeConnectEnabled) return;
    // Only do immediate check if opened from notification or if appointment is unpaid
    // (could have been paid while app was backgrounded)
    if (appointment.paymentStatus === 'paid') return;
    const immediateCheck = async () => {
      try {
        const result = await apiCall<{ ok: boolean; paymentStatus: string; paymentMethod: string | null }>(
          `/api/stripe-connect/appointment-payment-status?businessOwnerId=${state.businessOwnerId}&appointmentLocalId=${encodeURIComponent(appointment.id)}`,
          { method: 'GET' },
        );
        if (result.ok && result.paymentStatus === 'paid') {
          const updated = { ...appointment, paymentStatus: 'paid' as const, paymentMethod: (result.paymentMethod ?? 'card') as any };
          dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
          syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updated });
        }
      } catch {
        // Silently ignore
      }
    };
    immediateCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment?.id, state.businessOwnerId]);

  useEffect(() => {
    if (!appointment || appointment.paymentStatus === 'paid' || !state.businessOwnerId) return;
    // Only poll if Stripe is connected (stripeConnectEnabled flag)
    if (!(state.settings as any).stripeConnectEnabled) return;

    pollingNotifiedRef.current = false;

    const intervalId = setInterval(async () => {
      try {
        const result = await apiCall<{ ok: boolean; paymentStatus: string; paymentMethod: string | null; totalPrice: number }>(
          `/api/stripe-connect/appointment-payment-status?businessOwnerId=${state.businessOwnerId}&appointmentLocalId=${encodeURIComponent(appointment.id)}`,
          { method: 'GET' },
        );
        if (result.ok && result.paymentStatus === 'paid' && !pollingNotifiedRef.current) {
          pollingNotifiedRef.current = true;
          // Update local state so UI reflects payment immediately
          const updated = {
            ...appointment,
            paymentStatus: 'paid' as const,
            paymentMethod: (result.paymentMethod ?? 'card') as any,
          };
          dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
          Alert.alert('✅ Payment Received', `${client?.name ?? 'The client'} has paid $${(appointment.totalPrice ?? 0).toFixed(2)} by card.`);
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 10_000);

    return () => clearInterval(intervalId);
  }, [appointment?.id, appointment?.paymentStatus, state.businessOwnerId, (state.settings as any).stripeConnectEnabled]);

  // ── AppState listener: check payment status immediately when user returns from Safari ──
  useEffect(() => {
    if (!appointment || !state.businessOwnerId) return;
    if (appointment.paymentStatus === 'paid') return;

    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active' && pendingPaymentCheckRef.current) {
        pendingPaymentCheckRef.current = false;
        try {
          const result = await apiCall<{ ok: boolean; paymentStatus: string; paymentMethod: string | null; totalPrice: number }>(
            `/api/stripe-connect/appointment-payment-status?businessOwnerId=${state.businessOwnerId}&appointmentLocalId=${encodeURIComponent(appointment.id)}`,
            { method: 'GET' },
          );
          if (result.ok && result.paymentStatus === 'paid' && !pollingNotifiedRef.current) {
            pollingNotifiedRef.current = true;
            const updated = {
              ...appointment,
              paymentStatus: 'paid' as const,
              paymentMethod: (result.paymentMethod ?? 'card') as any,
            };
            dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
            syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updated });
            // Show receipt
            setReceiptData({
              amount: appointment.totalPrice ?? 0,
              serviceName: service ? getServiceDisplayName(service) : undefined,
              clientName: client?.name ?? undefined,
              confirmationId: appointment.id,
            });
          }
        } catch {
          // Silently ignore
        }
      }
    });

    return () => subscription.remove();
  }, [appointment?.id, appointment?.paymentStatus, state.businessOwnerId]);

  const handleMarkPaid = (confirmationNumber?: string) => {
    const appt = appointment!;
    // Use the method from the picker if the appointment doesn't have one set
    const effectiveMethod = appt.paymentMethod && appt.paymentMethod !== 'unpaid'
      ? appt.paymentMethod
      : selectedPayMethod;
    const updated = {
      ...appt,
      paymentStatus: 'paid' as const,
      paymentMethod: effectiveMethod,
      paymentConfirmationNumber: confirmationNumber || undefined,
    };
    dispatch({ type: "UPDATE_APPOINTMENT", payload: updated as any });
    syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated as any });
    setShowPaymentModal(false);
    setPaymentConfirmInput("");
    // If this payment sheet was triggered from the Complete flow, also mark as completed now.
    if (pendingCompleteRef.current) {
      const completeFn = pendingCompleteRef.current;
      pendingCompleteRef.current = null;
      completeFn();
      return; // router.back() is called inside completeFn, skip SMS below
    }
    // Send payment receipt SMS to client — respect master notificationsEnabled
    const _notifPrefsP = state.settings.notificationPreferences ?? {};
    const _masterNotifOnP = state.settings.notificationsEnabled !== false;
    const _smsPaymentOn = (_notifPrefsP as any).smsClientOnConfirmation !== false; // reuse confirmation toggle for payment receipt
    if (client?.phone && _masterNotifOnP && _smsPaymentOn) {
      const methodLabel =
        appt.paymentMethod === 'zelle' ? 'Zelle' :
        appt.paymentMethod === 'cashapp' ? 'Cash App' :
        appt.paymentMethod === 'venmo' ? 'Venmo' : 'Cash';
      const confLine = confirmationNumber ? `\nConfirmation #: ${confirmationNumber}` : '';
      const serviceName = service ? getServiceDisplayName(service) : 'your appointment';
      const locLine = assignedLocation?.name ? `\n\uD83D\uDCCD ${assignedLocation.name}` : '';
      const msg = `Hi ${client.name}, your payment of $${(appt.totalPrice ?? 0).toFixed(2)} via ${methodLabel} for ${serviceName} on ${formatDateDisplay(appt.date)} at ${appt.time} has been received.${confLine}${locLine}\n\nThank you! — ${biz.businessName}${LIME_OF_TIME_FOOTER}`;
      // Try server-side SMS first (subscription-gated), fall back to native SMS
      const rawPhone = stripPhoneFormat(client.phone);
      const smsEnabled = state.settings.twilioEnabled;
      if (smsEnabled && state.businessOwnerId) {
        const toNumber = rawPhone.startsWith('+') ? rawPhone : `+1${rawPhone.replace(/\D/g, '')}`;
        sendSmsMutation
          .mutateAsync({
            businessOwnerId: state.businessOwnerId,
            toNumber,
            body: msg,
            smsAction: 'confirmation',
          })
          .catch(() => openSms(client.phone!, msg));
      } else {
        openSms(client.phone, msg);
      }
    }
  };

  const handleSaveEditPayment = async () => {
    if (!appointment || !state.businessOwnerId) return;
    setSavingPayment(true);
    try {
      const parsedAmount = editAmount.trim() ? parseFloat(editAmount.trim()) : undefined;
      const updated = {
        ...appointment,
        paymentStatus: editPayStatus as any,
        paymentMethod: editPayMethod as any,
        paymentConfirmationNumber: editConfirmNumber.trim() || undefined,
        ...(parsedAmount != null && !isNaN(parsedAmount) ? { totalPrice: parsedAmount } : {}),
      };
      dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated as any });
      syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updated as any });
      setShowEditPaymentSheet(false);
    } catch (err) {
      Alert.alert('Error', 'Could not save payment changes.');
    } finally {
      setSavingPayment(false);
    }
  };

  const CANCEL_REASONS = [
    "Client requested",
    "No-show",
    "Staff unavailable",
    "Rescheduled",
    "Weather / emergency",
    "Other",
  ];

  const handleStatusChange = (status: "completed" | "cancelled") => {
    const cancInfo = getCancellationInfo();
    const doIt = (cancellationReason?: string) => {
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appointment!.id, status, ...(cancellationReason ? { cancellationReason } : {}) } });
      syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appointment!.id, status, ...(cancellationReason ? { cancellationReason } : {}) } });
      // Respect master notificationsEnabled and per-event SMS toggles
      const _notifPrefs2 = state.settings.notificationPreferences ?? {};
      const _masterNotifOn2 = state.settings.notificationsEnabled !== false;
      const _smsCancelOn = (_notifPrefs2 as any).smsClientOnCancellation !== false; // default true
      const _smsConfirmOn = (_notifPrefs2 as any).smsClientOnConfirmation !== false; // default true
      const _smsAllowed = status === "cancelled" ? _smsCancelOn : _smsConfirmOn;
      if (client?.phone && _masterNotifOn2 && _smsAllowed) {
        let msg = "";
        if (status === "completed") {
          const completedFullAddr = assignedLocation
            ? formatFullAddress(assignedLocation.address, assignedLocation.city, assignedLocation.state, assignedLocation.zipCode)
            : formatFullAddress(profile.address, profile.city, profile.state, profile.zipCode);
          const completedLocLine = assignedLocation?.name
            ? (completedFullAddr ? `${assignedLocation.name} \u2014 ${completedFullAddr}` : assignedLocation.name)
            : completedFullAddr;
          const completedSlug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
          const customCompletedTpl = biz.smsTemplates?.completed;
          if (customCompletedTpl) {
            msg = applyTemplate(customCompletedTpl, {
              clientName: client.name,
              businessName: biz.businessName,
              serviceName: service ? getServiceDisplayName(service) : "service",
              date: formatDateDisplay(appointment!.date),
              time: appointment!.time,
              location: completedLocLine,
              phone: formatPhoneNumber(stripPhoneFormat(assignedLocation?.phone || profile.phone)),
              clientPhone: client.phone,
              bookingUrl: `${PUBLIC_BOOKING_URL}/book/${completedSlug}${assignedLocation?.id ? "?location=" + assignedLocation.id : ""}`,
              reviewUrl: `${PUBLIC_BOOKING_URL}/review/${completedSlug}`,
            });
          } else {
            msg = `Dear ${client.name},\n\nThank you for visiting ${biz.businessName}! Your appointment for ${service ? getServiceDisplayName(service) : "service"} on ${formatDateDisplay(appointment!.date)} has been completed.\n\nWe hope you had a great experience. We\u2019d love to see you again!\n\n\uD83D\uDCCD ${completedLocLine}\n\uD83D\uDCDE ${formatPhoneNumber(stripPhoneFormat(assignedLocation?.phone || profile.phone))}\n\n\uD83D\uDD17 Book again: ${PUBLIC_BOOKING_URL}/book/${completedSlug}${assignedLocation?.id ? "?location=" + assignedLocation.id : ""}\n\nBest regards,\n${biz.businessName}${LIME_OF_TIME_FOOTER}`;
          }
        } else {
          const feeStr = cancInfo.feeApplies && cancInfo.fee > 0 ? `$${cancInfo.fee} (${policy.feePercentage}%)` : "";
          const customCancelTpl = biz.smsTemplates?.cancellation;
          if (customCancelTpl) {
            const cancelFullAddr = assignedLocation
              ? formatFullAddress(assignedLocation.address, assignedLocation.city, assignedLocation.state, assignedLocation.zipCode)
              : formatFullAddress(profile.address, profile.city, profile.state, profile.zipCode);
            const cancelLocLine = assignedLocation?.name
              ? (cancelFullAddr ? `${assignedLocation.name} \u2014 ${cancelFullAddr}` : assignedLocation.name)
              : cancelFullAddr;
            msg = applyTemplate(customCancelTpl, {
              clientName: client.name,
              businessName: biz.businessName,
              serviceName: service ? getServiceDisplayName(service) : "Service",
              date: appointment!.date,
              time: appointment!.time,
              location: cancelLocLine,
              phone: formatPhoneNumber(stripPhoneFormat(assignedLocation?.phone || profile.phone)),
              clientPhone: client.phone,
            });
          } else {
            msg = generateCancellationMessage(
              biz.businessName,
              client.name,
              service ? getServiceDisplayName(service) : "Service",
              appointment!.date,
              appointment!.time,
              feeStr,
              assignedLocation?.phone || profile.phone,
              assignedLocation?.name,
              assignedLocation?.address ?? profile.address,
              assignedLocation?.city ?? profile.city,
              assignedLocation?.state ?? profile.state,
              assignedLocation?.zipCode ?? profile.zipCode
            );
          }
        }
        // Try server-side SMS (subscription gated); fall back to native SMS
        const biz2 = state.settings;
        const isCompleted = status === "completed";
        const smsAction = isCompleted ? "rebooking" : "confirmation";
        const smsEnabled = biz2.twilioEnabled;
        const rawPhone2 = stripPhoneFormat(client.phone);
        if (smsEnabled && state.businessOwnerId) {
          const toNumber2 = rawPhone2.startsWith("+") ? rawPhone2 : `+1${rawPhone2.replace(/\D/g, "")}`;
          sendSmsMutation
            .mutateAsync({
              businessOwnerId: state.businessOwnerId,
              toNumber: toNumber2,
              body: msg,
              smsAction,
            })
            .catch(() => openSms(client.phone, msg));
        } else {
          openSms(client.phone, msg);
        }
      }
      router.back();
    };
    if (status === "cancelled") {
      // Show reason picker modal for cancellations
      setSelectedReason("");
      setCustomReason("");
      setCancelReasonModal(true);
      return;
    }
    // For pay_later appointments that haven't been paid yet, show the payment
    // collection sheet so the owner can record payment in the same step.
    const isPayLater = appointment?.paymentMethod === 'pay_later' && appointment?.paymentStatus !== 'paid';
    if (status === "completed" && isPayLater) {
      pendingCompleteRef.current = doIt;
      // Reset the method picker to cash as a sensible default
      setSelectedPayMethod('cash');
      setPaymentConfirmInput('');
      setShowPaymentModal(true);
      return;
    }
    if (Platform.OS === "web") {
      doIt();
    } else {
      Alert.alert(
        "Complete Appointment",
        "Are you sure you want to mark this appointment as completed?",
        [
          { text: "No", style: "cancel" },
          { text: "Yes", onPress: () => doIt() },
        ]
      );
    }
  };

  // ── No-show fee via Stripe ───────────────────────────────────────────────
  const handleChargeNoShowFee = useCallback(async (feeAmount: number) => {
    if (!state.businessOwnerId || !appointment) return;
    setNoShowFeeLoading(true);
    try {
      // Use deep-link URLs so Safari auto-closes and returns to the app after no-show fee payment
      const successUrl = `${DEEP_LINK_SCHEME}://payment-success?appt=${encodeURIComponent(appointment.id)}&boid=${state.businessOwnerId}&type=no_show_fee`;
      const cancelUrl = `${DEEP_LINK_SCHEME}://payment-cancel?appt=${encodeURIComponent(appointment.id)}&boid=${state.businessOwnerId}`;
      const result = await apiCall<{ url: string; sessionId: string }>("/api/stripe-connect/no-show-fee", {
        method: "POST",
        body: JSON.stringify({
          businessOwnerId: state.businessOwnerId,
          appointmentLocalId: appointment.id,
          amount: feeAmount,
          serviceName: service ? getServiceDisplayName(service) : "Appointment",
          clientName: client?.name ?? "",
          successUrl,
          cancelUrl,
        }),
      });
      setShowNoShowFeeModal(false);
      if (result.url) {
        // Open in system Safari — in-app browser closes immediately on iOS with Stripe redirects
        await Linking.openURL(result.url);
        Alert.alert(
          'Payment Link Opened',
          'Complete the no-show fee payment in Safari. The status will update automatically.',
          [{ text: 'OK' }],
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not create no-show fee charge");
    } finally {
      setNoShowFeeLoading(false);
    }
  }, [state.businessOwnerId, appointment, service, client]);

  if (!appointment) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} className="p-5">
      <FuturisticBackground />
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="arrow.left" size={24} color={colors.foreground} />
        </Pressable>
        <View className="flex-1 items-center justify-center">
          <Text className="text-base text-muted">Appointment not found</Text>
        </View>
      </ScreenContainer>
    );
  }
  const handleNoShow = () => {
    if (!isGrowthPlan) {
      Alert.alert("Upgrade Required", "No-Show SMS is available on the Growth plan and above. Upgrade to automatically notify clients when they miss their appointment.", [{ text: "OK" }]);
      return;
    }
    const doIt = () => {
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appointment.id, status: "no_show" } });
      syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appointment.id, status: "no_show" } });
      // Send no-show SMS if enabled
      const _notifPrefsNS = state.settings.notificationPreferences ?? {};
      const _masterNotifNS = state.settings.notificationsEnabled !== false;
      const _smsNoShowOn = (_notifPrefsNS as any).smsClientOnNoShow !== false;
      if (client?.phone && _masterNotifNS && _smsNoShowOn) {
        const biz = state.settings;
        const noShowSlug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
        const customNoShowTpl = biz.smsTemplates?.noShow;
        let msg: string;
        if (customNoShowTpl) {
          msg = applyTemplate(customNoShowTpl, {
            clientName: client.name,
            businessName: biz.businessName,
            serviceName: service ? getServiceDisplayName(service) : "service",
            date: formatDateDisplay(appointment.date),
            time: appointment.time,
            bookingUrl: `${PUBLIC_BOOKING_URL}/book/${noShowSlug}${assignedLocation?.id ? "?location=" + assignedLocation.id : ""}`,
          });
        } else {
          msg = `Hi ${client.name}, we noticed you missed your appointment for ${service ? getServiceDisplayName(service) : "your service"} on ${formatDateDisplay(appointment.date)} at ${appointment.time}. We’d love to see you — tap to rebook: ${PUBLIC_BOOKING_URL}/book/${noShowSlug}${assignedLocation?.id ? "?location=" + assignedLocation.id : ""}${LIME_OF_TIME_FOOTER}`;
        }
        const rawPhoneNS = stripPhoneFormat(client.phone);
        if (biz.twilioEnabled && state.businessOwnerId) {
          const toNumberNS = rawPhoneNS.startsWith("+") ? rawPhoneNS : `+1${rawPhoneNS.replace(/\D/g, "")}`;
          sendSmsMutation
            .mutateAsync({ businessOwnerId: state.businessOwnerId, toNumber: toNumberNS, body: msg, smsAction: "rebooking" })
            .catch(() => openSms(client.phone, msg));
        } else {
          openSms(client.phone, msg);
        }
      }
      router.back();
    };
    // Check if Stripe is connected — if so, offer fee charging option
    const stripeConnected = !!(state.settings as any).stripeConnectEnabled;
    if (Platform.OS === "web") {
      doIt();
    } else if (stripeConnected) {
      // Offer to charge a no-show fee via Stripe
      const defaultFee = service ? Math.round((service.price ?? 0) * 0.5 * 100) / 100 : 0;
      Alert.alert(
        "Mark as No-Show",
        `Mark this appointment as no-show?${isGrowthPlan && (state.settings.notificationPreferences as any)?.smsClientOnNoShow !== false ? " An SMS will be sent to " + (client?.name ?? "the client") + " with a rebooking link." : ""}

Would you also like to charge a no-show fee via Stripe?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "No Fee", style: "default", onPress: doIt },
          {
            text: "Charge Fee",
            style: "destructive",
            onPress: () => {
              doIt();
              setNoShowFeeAmount(String(defaultFee > 0 ? defaultFee : ""));
              setShowNoShowFeeModal(true);
            },
          },
        ]
      );
    } else {
      Alert.alert(
        "Mark as No-Show",
        `Mark this appointment as no-show? ${isGrowthPlan && (state.settings.notificationPreferences as any)?.smsClientOnNoShow !== false ? "An SMS will be sent to " + (client?.name ?? "the client") + " with a rebooking link." : ""}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Mark No-Show", style: "destructive", onPress: doIt },
        ]
      );
    }
  };

  const handleDelete = () => {
    const doIt = () => {
      dispatch({ type: "DELETE_APPOINTMENT", payload: appointment.id });
      syncToDb({ type: "DELETE_APPOINTMENT", payload: appointment.id });
      router.back();
    };
    if (Platform.OS === "web") {
      doIt();
    } else {
      Alert.alert("Delete Appointment", "This action cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doIt },
      ]);
    }
  };

  const handleSendReminder = () => {
    // Navigate to the Send Reminder screen instead of directly opening SMS
    router.push({ pathname: '/send-reminder' as any, params: { appointmentId: appointment.id } });
  };

  const handleConfirmGiftRedemption = () => {
    if (!appointment) return;
    // For balance gift cards, open the partial redemption sheet so staff can enter amount
    const giftCard = state.giftCards.find(
      (gc) => gc.id === (appointment as any).giftCardId ||
               gc.code === (appointment as any).giftCode
    );
    const isBalance = giftCard?.giftType === 'balance' || (appointment as any).giftCardType === 'balance';
    if (isBalance) {
      // Pre-fill with the amount already recorded on the appointment (or the full remaining balance)
      const preAmount = appointment.giftUsedAmount ?? giftCard?.remainingBalance ?? 0;
      setGiftRedeemAmount(preAmount > 0 ? String(preAmount) : '');
      setShowGiftRedeemSheet(true);
    } else {
      // Specific-service gift: confirm full redemption directly
      Alert.alert(
        'Confirm Gift Redemption',
        'Mark this gift certificate as fully redeemed?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: async () => {
              try {
                const token = await getSessionToken();
                const res = await fetch(`/api/business/appointments/${appointment.id}/confirm-gift-redemption`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
                  body: JSON.stringify({ appointmentId: appointment.id }),
                });
                if (!res.ok) throw new Error('Failed to confirm redemption');
                Alert.alert('Gift Redeemed', 'The gift certificate has been marked as redeemed.');
                dispatch({ type: 'LOAD_DATA', payload: {} });
              } catch (err) {
                const e = err as any;
                Alert.alert('Error', e?.message ?? 'Could not confirm gift redemption.');
              }
            },
          },
        ]
      );
    }
  };

  const handleSaveGiftRedeem = async () => {
    if (!appointment) return;
    const parsed = parseFloat(giftRedeemAmount.trim());
    if (isNaN(parsed) || parsed <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid redemption amount greater than $0.');
      return;
    }
    setSavingGiftRedeem(true);
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/business/appointments/${appointment.id}/confirm-gift-redemption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ appointmentId: appointment.id, redeemAmount: parsed }),
      });
      if (!res.ok) throw new Error('Failed to confirm redemption');
      // Update local appointment with the used amount
      const updated = { ...appointment, giftUsedAmount: parsed };
      dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated as any });
      syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updated as any });
      setShowGiftRedeemSheet(false);
      Alert.alert('Gift Redeemed', `$${parsed.toFixed(2)} has been deducted from the gift card balance.`);
      dispatch({ type: 'LOAD_DATA', payload: {} });
    } catch (err) {
      const e = err as any;
      Alert.alert('Error', e?.message ?? 'Could not confirm gift redemption.');
    } finally {
      setSavingGiftRedeem(false);
    }
  };

  const handleOpenMap = () => {
    if (!profile.address) return;
    const url = getMapUrl(profile.address);
    Linking.openURL(url).catch(() => {});
  };

  // ─── Shared gift / charge calculations (used by both Charges and Payment sections) ───
  const _extras = appointment?.extraItems ?? [];
  const _extrasTotal = _extras.reduce((s, e) => s + (e.price || 0), 0);
  const _discountAmt = appointment?.discountAmount ?? 0;
  const _giftUsedAmount = appointment?.giftUsedAmount ?? 0;
  const _svcPrice = appointment?.totalPrice != null
    ? Math.max(0, appointment.totalPrice + _discountAmt + _giftUsedAmount - _extrasTotal)
    : (service?.price ?? 0);
  const _subtotal = _svcPrice + _extrasTotal;
  const _afterDiscount = Math.max(0, _subtotal - _discountAmt);
  let _giftDeduction = 0;
  if (appointment?.giftApplied) {
    if (_giftUsedAmount > 0) {
      _giftDeduction = _giftUsedAmount;
    } else if (appointment.totalPrice != null) {
      _giftDeduction = Math.max(0, _afterDiscount - appointment.totalPrice);
    } else {
      _giftDeduction = _afterDiscount;
    }
  }
  const _computedTotal = appointment?.totalPrice != null
    ? appointment.totalPrice
    : Math.max(0, _afterDiscount - _giftDeduction);
  // True when gift fully covers the appointment cost
  const isGiftFullyCovered = !!(appointment?.giftApplied) && _giftDeduction > 0 && _computedTotal <= 0;
  // True when gift partially covers (some amount still owed)
  const isGiftPartiallyCovered = !!(appointment?.giftApplied) && _giftDeduction > 0 && _computedTotal > 0;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={680}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24, paddingTop: 8, paddingHorizontal: hp }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="arrow.left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, marginLeft: 16, flex: 1 }}>Appointment</Text>
        {/* Edit button — only show for non-cancelled/completed appointments */}
        {appointment && appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
          <Pressable
            onPress={() => router.push({ pathname: '/edit-appointment' as any, params: { id: appointment.id } })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 20,
              borderWidth: 1.5,
              borderColor: colors.primary,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <IconSymbol name="pencil" size={14} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary }}>Edit</Text>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}>
        {/* Service Card — multi-service aware */}
        {(() => {
          const extras = appointment.extraItems ?? [];
          const extraServices = extras.filter(e => e.type === 'service');
          // For package sessions, service lookup may fail — fall back to appointment.duration and packageName
          const primaryService = service
            ? { id: appointment.serviceId, name: getServiceDisplayName(service), duration: service.duration, color: service.color ?? colors.primary }
            : appointment.packageGroupId
              ? { id: appointment.serviceId, name: appointment.packageName ?? 'Package Session', duration: appointment.duration ?? 0, color: colors.primary }
              : null;
          const allServices = [
            ...(primaryService ? [primaryService] : []),
            ...extraServices.map(e => ({ id: e.id, name: e.name, duration: e.duration, color: colors.primary })),
          ];
          const totalDuration = allServices.reduce((s, sv) => s + sv.duration, 0) || appointment.duration || 0;
          const startMin = timeToMinutes(appointment.time);
          return (
            <View className="rounded-2xl p-4 mb-4" style={{ backgroundColor: (service?.color ?? colors.primary) + '12' }}>
              {/* Header */}
              <View className="flex-row items-center mb-2">
                <View style={[styles.colorDot, { backgroundColor: service?.color ?? colors.primary }]} />
                <Text className="text-xl font-bold text-foreground ml-3" numberOfLines={2} style={{ flex: 1 }}>
                  {allServices.length > 1 ? `${allServices.length} Services` : (service ? getServiceDisplayName(service) : 'Service')}
                </Text>
                {(service?.serviceType === 'mobile' || appointment.clientAddress) && (
                  <View style={{ marginLeft: 8, backgroundColor: '#0891b215', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: '#0891b2', fontWeight: '700' }}>🚗 Mobile</Text>
                  </View>
                )}
              </View>
              <Text className="text-sm text-muted mb-3">
                {totalDuration} min total · ${appointment.totalPrice != null ? appointment.totalPrice.toFixed(2) : (service?.price ?? 0)}
              </Text>
              {/* Sequential time blocks for each service */}
              {allServices.length > 1 && allServices.map((sv, idx) => {
                const svcStart = startMin + allServices.slice(0, idx).reduce((s, x) => s + x.duration, 0);
                const svcEnd = svcStart + sv.duration;
                return (
                  <View key={sv.id + idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sv.color, marginRight: 8 }} />
                    <Text style={{ flex: 1, fontSize: fs.xs, color: colors.foreground, fontWeight: '500' }} numberOfLines={2}>{sv.name}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 8 }}>{formatTime(minutesToTime(svcStart))} – {formatTime(minutesToTime(svcEnd))}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 6 }}>({sv.duration}m)</Text>
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* Part of Package Banner — inline accordion */}
        {appointment.packageGroupId && (() => {
          const completedCount = packageSiblings.filter(s => s.status === 'completed').length;
          const remainingCount = packageSiblings.length - completedCount;
          // Build timeline dots — use packageSiblings if loaded, else fall back to sessionTotal
          const totalSessions = packageSiblings.length > 0
            ? packageSiblings.length
            : (appointment.sessionTotal ?? 1);
          const timelineDots = Array.from({ length: totalSessions }, (_, i) => {
            const sibling = packageSiblings[i];
            const isThis = sibling?.id === appointment.id || (!sibling && i === (appointment.sessionIndex ?? 0));
            const isDone = sibling ? sibling.status === 'completed' : false;
            const isCancelled = sibling ? sibling.status === 'cancelled' : false;
            return { isThis, isDone, isCancelled, idx: i };
          });
          return (
            <View style={{ borderRadius: 14, borderWidth: 1.5, borderColor: '#0891b2', backgroundColor: '#0891b215', marginBottom: 16, overflow: 'hidden' }}>
              {/* Session timeline strip */}
              <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#0891b2', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {appointment.packageName ?? 'Package'} — Session Progress
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  {timelineDots.map(({ isThis, isDone, isCancelled, idx: dotIdx }) => (
                    <View key={dotIdx} style={{ alignItems: 'center', gap: 3 }}>
                      {/* Connector line between dots */}
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {dotIdx > 0 && (
                          <View style={{ width: 14, height: 2, backgroundColor: timelineDots[dotIdx - 1]?.isDone ? '#22c55e' : '#0891b230', marginRight: 6 }} />
                        )}
                        <View style={{
                          width: 30, height: 30, borderRadius: 15,
                          backgroundColor: isDone ? '#22c55e' : isCancelled ? '#ef444430' : isThis ? '#0891b2' : '#0891b215',
                          borderWidth: isThis ? 2 : 1,
                          borderColor: isDone ? '#16a34a' : isCancelled ? '#ef4444' : '#0891b2',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ fontSize: 13 }}>
                            {isDone ? '✅' : isCancelled ? '✕' : isThis ? '▶' : `${dotIdx + 1}`}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 9, color: isDone ? '#16a34a' : isThis ? '#0891b2' : '#9BA1A6', fontWeight: isThis ? '700' : '400' }}>
                        {isDone ? 'Done' : isCancelled ? 'Canc.' : isThis ? 'Now' : `S${dotIdx + 1}`}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={{ fontSize: 10, color: '#0891b2', marginTop: 6 }}>
                  {completedCount} of {totalSessions} sessions completed{remainingCount > 0 ? ` · ${remainingCount} remaining` : ' · All done! 🎉'}
                </Text>
              </View>
              {/* Header row */}
              <Pressable
                onPress={() => setShowSessionsAccordion(v => !v)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 })}
              >
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#0891b2', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: fs.md }}>📦</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: '#0891b2' }}>Part of a Package</Text>
                  {appointment.packageName ? (
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>{appointment.packageName}</Text>
                  ) : null}
                  {appointment.sessionIndex != null && appointment.sessionTotal != null ? (
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>Session {appointment.sessionIndex + 1} of {appointment.sessionTotal}</Text>
                  ) : null}
                </View>
                {/* Progress pill */}
                {packageSiblings.length > 0 && (
                  <View style={{ backgroundColor: completedCount > 0 ? '#22c55e20' : '#0891b220', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginRight: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: completedCount > 0 ? '#16a34a' : '#0891b2' }}>
                      {completedCount > 0 ? `${completedCount} done · ${remainingCount} left` : `${remainingCount} upcoming`}
                    </Text>
                  </View>
                )}
                <Text style={{ fontSize: fs.sm, color: '#0891b2', fontWeight: '700' }}>{showSessionsAccordion ? '▲' : '▼'}</Text>
              </Pressable>

              {/* Expanded sessions list */}
              {showSessionsAccordion && packageSiblings.length > 0 && (
                <View style={{ borderTopWidth: 1, borderTopColor: '#0891b230' }}>
                  {packageSiblings.map((sess, idx) => {
                    const isThis = sess.id === appointment.id;
                    const isDone = sess.status === 'completed';
                    const isCancelled = sess.status === 'cancelled';
                    const sessLocation = sess.locationId ? getLocationById(sess.locationId) : null;
                    const sessStaff = sess.staffId ? getStaffById(sess.staffId) : null;
                    const sessEndTime = formatTime(minutesToTime(timeToMinutes(sess.time) + sess.duration));
                    return (
                      <View
                        key={sess.id}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                          borderTopColor: '#0891b220',
                          backgroundColor: isThis ? '#0891b210' : 'transparent',
                          flexDirection: 'row',
                          alignItems: 'flex-start',
                          gap: 10,
                        }}
                      >
                        {/* Status icon */}
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: isDone ? '#22c55e' : isCancelled ? '#ef444430' : '#0891b220', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                          <Text style={{ fontSize: 11 }}>{isDone ? '✓' : isCancelled ? '✕' : `${idx + 1}`}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          {/* Session label */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontSize: fs.xs, fontWeight: '700', color: isDone ? '#16a34a' : isCancelled ? colors.muted : colors.foreground }}>
                              Session {(sess.sessionIndex ?? idx) + 1} of {sess.sessionTotal ?? packageSiblings.length}
                            </Text>
                            {isThis && (
                              <View style={{ backgroundColor: '#0891b2', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                                <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff' }}>THIS</Text>
                              </View>
                            )}
                            {isDone && (
                              <View style={{ backgroundColor: '#22c55e20', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                                <Text style={{ fontSize: 9, fontWeight: '700', color: '#16a34a' }}>COMPLETED</Text>
                              </View>
                            )}
                            {isCancelled && (
                              <View style={{ backgroundColor: '#ef444420', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                                <Text style={{ fontSize: 9, fontWeight: '700', color: '#ef4444' }}>CANCELLED</Text>
                              </View>
                            )}
                          </View>
                          {/* Date & Time */}
                          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                            {formatDateDisplay(sess.date)} · {formatTime(sess.time)} – {sessEndTime}
                          </Text>
                          {/* Location */}
                          {sessLocation && (
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>📍 {sessLocation.name}</Text>
                          )}
                          {/* Staff */}
                          {sessStaff && (
                            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>👤 {sessStaff.name}</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })()}

        {/* Itemized Charges */}
        {(() => {
          const extras = appointment.extraItems ?? [];
          const extrasTotal = extras.reduce((s, e) => s + (e.price || 0), 0);
          // Discount
          const discountAmt = appointment.discountAmount ?? 0;
          const discountPct = appointment.discountPercent ?? 0;
          const discountLabel = appointment.discountName || (discountPct > 0 ? `${discountPct}% Off` : "Discount");
          // Gift card
          const giftUsedAmount = appointment.giftUsedAmount ?? 0;
          // Derive the original service price at booking time:
          // If totalPrice is stored, back-calculate: svcPrice = totalPrice + discountAmt + giftUsed - extrasTotal
          // This ensures the service line matches what was actually charged, even if the service price changed later.
          let svcPrice: number;
          if (appointment.totalPrice != null) {
            svcPrice = appointment.totalPrice + discountAmt + giftUsedAmount - extrasTotal;
            // Clamp to 0 in edge cases
            if (svcPrice < 0) svcPrice = service?.price ?? 0;
          } else {
            svcPrice = service?.price ?? 0;
          }
          const subtotal = svcPrice + extrasTotal;
          const afterDiscount = Math.max(0, subtotal - discountAmt);
          let giftDeduction = 0;
          if (appointment.giftApplied) {
            if (giftUsedAmount > 0) {
              giftDeduction = giftUsedAmount;
            } else if (appointment.totalPrice != null) {
              giftDeduction = Math.max(0, afterDiscount - appointment.totalPrice);
            } else {
              giftDeduction = afterDiscount;
            }
          }
          const computedTotal = appointment.totalPrice != null
            ? appointment.totalPrice
            : Math.max(0, afterDiscount - giftDeduction);
          return (
            <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
              {/* Charges header — tappable to expand/collapse line items */}
              <Pressable
                onPress={() => setChargesExpanded(v => !v)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.7 : 1, marginBottom: chargesExpanded ? 8 : 0 })}
              >
                <Text className="text-xs text-muted" style={{ flex: 1 }}>Charges</Text>
                {(() => {
                  const productCount = (appointment.extraItems ?? []).filter(e => e.type === 'product').length;
                  return productCount > 0 ? (
                    <View style={{ backgroundColor: colors.primary + '18', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.primary + '40', marginRight: 8 }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary }}>
                        {productCount} product{productCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  ) : null;
                })()}
                <Text style={{ fontSize: fs.md, color: colors.muted }}>{chargesExpanded ? '▲' : '▼'}</Text>
              </Pressable>
              {/* Line items — only when expanded */}
              {chargesExpanded && (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.foreground, flex: 1, flexShrink: 1, paddingRight: 8 }} numberOfLines={2}>{service ? getServiceDisplayName(service) : "Service"}</Text>
                    <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.foreground, flexShrink: 0 }}>${svcPrice.toFixed(2)}</Text>
                  </View>
                  {/* Extra services shown individually; products grouped by id with ×qty */}
                  {(() => {
                    const serviceExtras = extras.filter(e => e.type === 'service');
                    const productGroups = new Map<string, { name: string; price: number; qty: number }>();
                    extras.forEach(e => {
                      if (e.type !== 'product') return;
                      if (!productGroups.has(e.id)) productGroups.set(e.id, { name: e.name, price: e.price || 0, qty: 0 });
                      productGroups.get(e.id)!.qty += 1;
                    });
                    return (
                      <>
                        {serviceExtras.map((item, idx) => (
                          <View key={`svc-${idx}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 }}>
                            <Text style={{ fontSize: fs.xs, color: colors.foreground, flex: 1, flexShrink: 1, paddingRight: 8 }} numberOfLines={2}>{item.name}</Text>
                            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.foreground, flexShrink: 0 }}>${(item.price || 0).toFixed(2)}</Text>
                          </View>
                        ))}
                        {Array.from(productGroups.entries()).map(([pid, g]) => (
                          <View key={`prod-${pid}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 }}>
                            <Text style={{ fontSize: fs.xs, color: colors.foreground, flex: 1, flexShrink: 1, paddingRight: 8 }} numberOfLines={2}>
                              {g.name}{g.qty > 1 ? ` ×${g.qty}` : ''}
                            </Text>
                            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.foreground, flexShrink: 0 }}>${(g.price * g.qty).toFixed(2)}</Text>
                          </View>
                        ))}
                      </>
                    );
                  })()}
                  {extras.length > 0 && (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border + "40", marginTop: 4, paddingTop: 4 }} className="flex-row justify-between py-1">
                      <Text className="text-sm text-muted">Subtotal</Text>
                      <Text className="text-sm text-muted">${subtotal.toFixed(2)}</Text>
                    </View>
                  )}
                </>
              )}
              {discountAmt > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                    <Text className="text-sm" style={{ color: '#F59E0B' }}>{discountLabel}</Text>
                    {(appointment.status === 'pending' || appointment.status === 'confirmed') && (
                      <Pressable
                        onPress={() => {
                          Alert.alert(
                            "Remove Discount",
                            `Remove the "${discountLabel}" discount from this appointment?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Remove",
                                style: "destructive",
                                onPress: () => {
                                  const restoredTotal = (appointment.totalPrice ?? 0) + discountAmt;
                                  const updated = { ...appointment, discountAmount: undefined, discountPercent: undefined, discountName: undefined, totalPrice: restoredTotal };
                                  dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                                  syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                                },
                              },
                            ]
                          );
                        }}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.error + '18' })}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.error }}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text className="text-sm font-semibold" style={{ color: '#F59E0B' }}>-${discountAmt.toFixed(2)}</Text>
                </View>
              )}
              {appointment.giftApplied && giftDeduction > 0 && (
                <View className="flex-row justify-between py-1">
                  <Text className="text-sm" style={{ color: colors.success }}>
                    🎁 Gift{(appointment as any).giftCode ? ` — Code: ${(appointment as any).giftCode}` : ' Card Applied'}
                  </Text>
                  <Text className="text-sm font-semibold" style={{ color: colors.success }}>-${giftDeduction.toFixed(2)}</Text>
                </View>
              )}
              {appointment.travelFee != null && Number(appointment.travelFee) > 0 && (
                <View className="flex-row justify-between py-1">
                  <Text className="text-sm" style={{ color: '#0891b2' }}>🚗 Travel Fee</Text>
                  <Text className="text-sm font-semibold" style={{ color: '#0891b2' }}>+${Number(appointment.travelFee).toFixed(2)}</Text>
                </View>
              )}
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }} className="flex-row justify-between">
                <Text className="text-sm font-bold text-foreground">Total Charged</Text>
                <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                  ${computedTotal.toFixed(2)}
                </Text>
              </View>
              {(discountAmt > 0 || giftDeduction > 0) && (
                <View className="flex-row justify-between py-1">
                  <Text className="text-xs" style={{ color: colors.success }}>You Saved</Text>
                  <Text className="text-xs font-semibold" style={{ color: colors.success }}>
                    ${(discountAmt + giftDeduction).toFixed(2)}
                  </Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* Payment Status — shown for all appointments (with or without a pre-set method) */}
        {appointment.status !== 'cancelled' && (
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text className="text-xs text-muted">Payment</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
                  backgroundColor: appointment.paymentStatus === 'paid' ? colors.success + '20' : isGiftFullyCovered ? colors.success + '20' : appointment.paymentMethod === 'pay_later' ? '#D9770618' : appointment.paymentStatus === 'pending_cash' ? '#FF980020' : colors.warning + '20',
                }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: appointment.paymentStatus === 'paid' ? colors.success : isGiftFullyCovered ? colors.success : appointment.paymentMethod === 'pay_later' ? '#D97706' : appointment.paymentStatus === 'pending_cash' ? '#FF9800' : colors.warning }}>
                    {appointment.paymentStatus === 'paid' ? '✓ Paid' : isGiftFullyCovered ? '🎁 Gift' : appointment.paymentMethod === 'pay_later' ? (() => { const svcForDetail = getServiceById(appointment.serviceId); return (svcForDetail as any)?.serviceType === 'mobile' ? '🤝 Pay After Service' : '🏪 Pay In Store'; })() : appointment.paymentStatus === 'pending_cash' ? 'Cash — Pending' : 'Unpaid'}
                  </Text>
                </View>
                {/* Edit Payment button */}
                <Pressable
                  onPress={() => {
                    setEditPayMethod((appointment.paymentMethod as any) === 'card' ? 'card' : (appointment.paymentMethod as any) ?? 'cash');
                    setEditPayStatus(appointment.paymentStatus === 'paid' ? 'paid' : 'unpaid');
                    setEditConfirmNumber(appointment.paymentConfirmationNumber ?? '');
                    setEditAmount(appointment.totalPrice != null ? String(appointment.totalPrice) : '');
                    setShowEditPaymentSheet(true);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
                    borderWidth: 1.5, borderColor: colors.primary + '60',
                    backgroundColor: colors.primary + '10',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <IconSymbol name="pencil" size={12} color={colors.primary} />
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary }}>Edit</Text>
                </Pressable>
              </View>
            </View>
            {isGiftFullyCovered ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <View style={{ backgroundColor: colors.success + '18', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text style={{ fontSize: fs.xs }}>🎁</Text>
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.success }}>Paid by Gift — ${_giftDeduction.toFixed(2)}</Text>
                </View>
              </View>
            ) : isGiftPartiallyCovered ? (
              // Partial gift: show how much was covered and how much remains
              <View style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <View style={{ backgroundColor: colors.primary + '18', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ fontSize: fs.xs }}>🎁</Text>
                    <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary }}>${_giftDeduction.toFixed(2)} covered by gift</Text>
                  </View>
                  <Text style={{ fontSize: fs.xs, color: colors.warning, fontWeight: '600' }}>${_computedTotal.toFixed(2)} remaining</Text>
                </View>
              </View>
            ) : (appointment.totalPrice ?? 0) <= 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <View style={{ backgroundColor: colors.primary + '18', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text style={{ fontSize: fs.xs }}>🎁</Text>
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.primary }}>Complimentary</Text>
                </View>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>No charge</Text>
              </View>
            ) : appointment.paymentMethod && appointment.paymentMethod !== 'free' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: appointment.paymentStatus !== 'paid' ? 10 : 0 }}>
                <Text style={{ fontSize: fs.sm, color: colors.foreground }}>
                  {appointment.paymentMethod === 'card' ? '💳 Card' : appointment.paymentMethod === 'zelle' ? '💜 Zelle' : appointment.paymentMethod === 'cashapp' ? '💚 Cash App' : appointment.paymentMethod === 'venmo' ? '💙 Venmo' : '💵 Cash'}
                </Text>
                {appointment.paymentConfirmationNumber && (
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>Conf# {appointment.paymentConfirmationNumber}</Text>
                )}
              </View>
            ) : null}
            {appointment.clientPaidNotifiedAt && appointment.paymentStatus !== 'paid' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, backgroundColor: '#FFF7ED', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#FED7AA' }}>
                <Text style={{ fontSize: fs.xs }}>💰</Text>
                <Text style={{ fontSize: fs.xs, fontWeight: '600', color: '#C2410C', flex: 1 }}>Client says payment was sent</Text>
                <Pressable onPress={() => setShowPaymentModal(true)} style={({ pressed }) => [{ backgroundColor: '#EA580C', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={{ color: '#fff', fontSize: fs.xs, fontWeight: '700' }}>Confirm</Text>
                </Pressable>
              </View>
            )}
            {appointment.paymentStatus !== 'paid' && !isGiftFullyCovered && (
              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={() => setShowPaymentModal(true)}
                  style={({ pressed }) => [{ backgroundColor: colors.success, borderRadius: 12, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>
                    {appointment.paymentMethod === 'cash' ? 'Confirm Cash Received' : 'Mark as Paid'}
                  </Text>
                </Pressable>
                {/* Request Card Payment via Stripe link — only on Studio/Enterprise plans with Stripe connected */}
                {isStripePlan && !!(state.settings as any).stripeConnectEnabled && (appointment.totalPrice ?? 0) > 0 && (
                  <Pressable
                    onPress={async () => {
                      // On Resend: check if the previous session is still active.
                      // If expired or missing, create a fresh session automatically.
                      if (paymentLinkSent && lastSessionId && state.businessOwnerId) {
                        try {
                          const status = await apiCall<{ ok: boolean; isActive: boolean; isPaid: boolean }>(
                            `/api/stripe-connect/session-status?sessionId=${encodeURIComponent(lastSessionId)}&businessOwnerId=${state.businessOwnerId}`,
                            { method: 'GET' },
                          );
                          if (status.isPaid) {
                            Alert.alert('✅ Already Paid', 'This appointment has already been paid. No need to resend.');
                            return;
                          }
                          if (!status.isActive) {
                            // Session expired — clear the old ID so handleRequestPayment creates a fresh one
                            setLastSessionId(null);
                          }
                        } catch {
                          // If check fails, proceed to create a new session
                          setLastSessionId(null);
                        }
                      }
                      handleRequestPayment();
                    }}
                    disabled={requestingPayment}
                    style={({ pressed }) => [{
                      backgroundColor: '#635BFF',
                      borderRadius: 12,
                      paddingVertical: 10,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                      opacity: (pressed || requestingPayment) ? 0.7 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: fs.md }}>{paymentLinkSent ? '✅' : '💳'}</Text>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>
                      {requestingPayment ? 'Creating Link…' : paymentLinkSent ? 'Resend Card Payment Link' : 'Request Card Payment'}
                    </Text>
                  </Pressable>
                )}
                {/* Pay on Behalf of Client — native Stripe payment sheet (visible for any unpaid appointment with a charge) */}
                {(appointment.totalPrice ?? 0) > 0 && Platform.OS !== 'web' && (
                  <Pressable
                    onPress={handlePayOnBehalf}
                    disabled={payingOnBehalf}
                    style={({ pressed }) => [{
                      backgroundColor: '#0F766E',
                      borderRadius: 12,
                      paddingVertical: 10,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                      opacity: (pressed || payingOnBehalf) ? 0.7 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: fs.md }}>💳</Text>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>
                      {payingOnBehalf ? 'Opening Payment…' : 'Pay on Behalf of Client'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
            {appointment.paymentStatus === 'paid' && appointment.paymentMethod === 'card' && !appointment.refundedAt && (
              <Pressable
                onPress={() => setShowRefundModal(true)}
                style={({ pressed }) => [{ backgroundColor: '#635BFF15', borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#635BFF40', opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: '#635BFF', fontWeight: '700', fontSize: fs.sm }}>
                  {refunding ? 'Processing Refund…' : '💳 Issue Refund'}
                </Text>
              </Pressable>
            )}
            {appointment.refundedAt && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: '#EF444415', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#EF444430' }}>
                <Text style={{ fontSize: fs.xs, color: '#EF4444' }}>↩ Refunded</Text>
                {appointment.refundedAmount != null && (
                  <Text style={{ fontSize: fs.xs, color: '#EF4444', fontWeight: '700' }}>${appointment.refundedAmount.toFixed(2)}</Text>
                )}
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 'auto' }}>
                  {new Date(appointment.refundedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Status */}
        <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
          <Text className="text-xs text-muted mb-1">Status</Text>
          <View
            className="self-start rounded-full px-3 py-1"
            style={{
              backgroundColor:
                appointment.status === "completed" ? colors.success + "20"
                : appointment.status === "cancelled" ? colors.error + "20"
                : appointment.status === "pending" ? "#FF980020"
                : colors.primary + "20",
            }}
          >
            <Text
              className="text-sm font-semibold capitalize"
              style={{
                color:
                  appointment.status === "completed" ? colors.success
                  : appointment.status === "cancelled" ? colors.error
                  : appointment.status === "pending" ? "#FF9800"
                  : colors.primary,
              }}
            >
              {appointment.status}
            </Text>
          </View>
        </View>

        {/* Special Requests / Notes */}
        {appointment.notes ? (
          <View
            style={{
              backgroundColor: colors.warning + "18",
              borderColor: colors.warning + "60",
              borderWidth: 1,
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.warning} />
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.warning, marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Special Requests
              </Text>
            </View>
            <Text style={{ fontSize: fs.sm, color: colors.foreground, lineHeight: 22 }}>
              {appointment.notes}
            </Text>
          </View>
        ) : null}

        {/* Details */}
        <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
          <DetailRow icon="calendar" label="Date" value={formatDateDisplay(appointment.date)} colors={colors} />
          <DetailRow
            icon="clock.fill"
            label="Time"
            value={(() => {
              const extras = appointment.extraItems ?? [];
              const extraServices = extras.filter(e => e.type === 'service');
              const totalDur = (service?.duration ?? appointment.duration) + extraServices.reduce((s, e) => s + e.duration, 0);
              const endMin = timeToMinutes(appointment.time) + totalDur;
              return `${formatTime(appointment.time)} – ${formatTime(minutesToTime(endMin))}`;
            })()}
            colors={colors}
          />
          <DetailRow
            icon="person.fill"
            label="Client"
            value={client?.name ?? "Unknown"}
            colors={colors}
            onPress={client ? () => router.push({ pathname: "/client-detail" as any, params: { id: client.id } }) : undefined}
          />
          {client?.phone ? (
            <DetailRow icon="phone.fill" label="Phone" value={formatPhoneNumber(client.phone)} colors={colors} />
          ) : null}
          {assignedStaff ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border + '40' }}>
              {assignedStaff.photoUri ? (
                <Image source={{ uri: assignedStaff.photoUri }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }} />
              ) : (
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: assignedStaff.color || colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>{assignedStaff.name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 1 }}>Staff</Text>
                <Text style={{ fontSize: fs.sm, color: colors.foreground, fontWeight: '600' }}>{assignedStaff.name}{assignedStaff.role ? ` · ${assignedStaff.role}` : ''}</Text>
              </View>
            </View>
          ) : null}
          {assignedLocation ? (
            <DetailRow
              icon="location.fill"
              label="Location"
              value={(() => {
                const fullAddr = formatFullAddress(
                  assignedLocation.address || "",
                  assignedLocation.city,
                  assignedLocation.state,
                  assignedLocation.zipCode
                );
                return assignedLocation.name
                  ? (fullAddr ? `${assignedLocation.name}\n${fullAddr}` : assignedLocation.name)
                  : (fullAddr || assignedLocation.address || "");
              })()}
              colors={colors}
              onPress={() => {
                const fullAddr = formatFullAddress(
                  assignedLocation.address || "",
                  assignedLocation.city,
                  assignedLocation.state,
                  assignedLocation.zipCode
                );
                const mapAddr = fullAddr || assignedLocation.address;
                if (mapAddr) Linking.openURL(getMapUrl(mapAddr)).catch(() => {});
              }}
            />
          ) : profile.address ? (
            <DetailRow
              icon="mappin"
              label="Location"
              value={profile.address}
              colors={colors}
              onPress={handleOpenMap}
            />
          ) : null}
          {appointment.clientAddress ? (
            <DetailRow
              icon="car.fill"
              label="Client Address"
              value={appointment.clientAddress}
              colors={colors}
              onPress={() => Linking.openURL(getMapUrl(appointment.clientAddress!)).catch(() => {})}
            />
          ) : null}
          {/* OSRM drive time estimate */}
          {appointment.clientAddress && (apptDriveLoading || apptDriveTime) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 6 }}>
              <Text style={{ fontSize: 14 }}>🚗</Text>
              {apptDriveLoading ? (
                <Text style={{ fontSize: fs.xs, color: colors.muted, fontStyle: 'italic' }}>Calculating drive time...</Text>
              ) : (
                <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: '600' }}>{apptDriveTime}</Text>
              )}
            </View>
          ) : null}
          {/* Estimated depart time for mobile services */}
          {(service?.serviceType === 'mobile' || appointment.clientAddress) && service?.travelDuration && service.travelDuration > 0 && (() => {
            const apptMin = timeToMinutes(appointment.time);
            const departMin = apptMin - service.travelDuration;
            const departTime = formatTime(minutesToTime(Math.max(0, departMin)));
            return (
              <DetailRow
                icon="car.fill"
                label="Depart By"
                value={`${departTime} (${service.travelDuration} min travel)`}
                colors={colors}
              />
            );
          })()}
        </View>

        {/* Cancellation Policy Info */}
        {policy.enabled && (appointment.status === "confirmed" || appointment.status === "pending") && (
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <Text className="text-xs text-muted mb-1">Cancellation Policy</Text>
            <Text className="text-sm text-foreground">
              {policy.feePercentage}% fee if cancelled within {policy.hoursBeforeAppointment} hours of appointment
            </Text>
          </View>
        )}

        {/* Cancellation Reason */}
        {appointment.status === "cancelled" && appointment.cancellationReason ? (
          <View style={{ backgroundColor: colors.error + "12", borderColor: colors.error + "40", borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.error, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Cancellation Reason</Text>
            <Text style={{ fontSize: fs.sm, color: colors.foreground }}>{appointment.cancellationReason}</Text>
          </View>
        ) : null}

        {/* Reschedule Reason */}
        {appointment.rescheduleReason ? (
          <View style={{ backgroundColor: colors.primary + "12", borderColor: colors.primary + "40", borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Reschedule Reason</Text>
            <Text style={{ fontSize: fs.sm, color: colors.foreground }}>{appointment.rescheduleReason}</Text>
          </View>
        ) : null}
        {/* Notes */}
        {appointment.notes ? (
          <View className="bg-surface rounded-2xl p-4 mb-4 border border-border">
            <Text className="text-xs text-muted mb-1">Notes</Text>
            <Text className="text-sm text-foreground">{appointment.notes}</Text>
          </View>
        ) : null}

        {/* Staff Notes — internal only, auto-saves on change */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <IconSymbol name="lock.fill" size={13} color={colors.muted} />
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginLeft: 5 }}>Staff Notes</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 6 }}>(internal only)</Text>
            {staffNotesSaving && <Text style={{ fontSize: fs.xs, color: colors.primary, marginLeft: "auto" }}>Saving…</Text>}
          </View>
          <TextInput
            value={staffNotesValue}
            onChangeText={handleStaffNotesChange}
            placeholder="Add internal notes visible only to staff…"
            placeholderTextColor={colors.muted}
            multiline
            style={{ fontSize: fs.sm, color: colors.foreground, minHeight: 60, textAlignVertical: "top" }}
          />
        </View>

        {/* Message Client Button */}
        {client?.phone && (
          <Pressable
            onPress={handleSendReminder}
            style={({ pressed }) => [
              styles.messageBtn,
              { borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <IconSymbol name="paperplane.fill" size={18} color={colors.primary} />
            <Text style={[styles.messageBtnText, { color: colors.primary }]}>Send Reminder</Text>
          </Pressable>
        )}

        {/* Add to Calendar button */}
        <Pressable
          onPress={async () => {
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
              const [year, month, day] = appointment.date.split("-").map(Number);
              const [startH, startM] = appointment.time.split(":").map(Number);
              const startDate = new Date(year, month - 1, day, startH, startM, 0);
              const endDate = new Date(startDate.getTime() + appointment.duration * 60 * 1000);
              const locName = assignedLocation?.name ?? biz.businessName ?? "";
              const locAddr = assignedLocation
                ? formatFullAddress(assignedLocation.address, assignedLocation.city, assignedLocation.state, assignedLocation.zipCode)
                : formatFullAddress(profile.address, profile.city, profile.state, profile.zipCode);
              const locationStr = [locName, locAddr].filter(Boolean).join(" — ");
              await Calendar.createEventAsync(defaultCal.id, {
                title: service ? `${getServiceDisplayName(service)}${client ? " — " + client.name : ""}` : "Appointment",
                startDate,
                endDate,
                location: locationStr || undefined,
                notes: appointment.notes || undefined,
                alarms: [{ relativeOffset: -60 }],
              });
              Alert.alert("Added to Calendar", "The appointment has been added to your calendar.");
            } catch (e) {
              Alert.alert("Error", "Could not add to calendar. Please try again.");
            }
          }}
          style={({ pressed }) => [
            styles.messageBtn,
            { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <IconSymbol name="calendar" size={18} color={colors.muted} />
          <Text style={[styles.messageBtnText, { color: colors.muted }]}>Add to Calendar</Text>
        </Pressable>

        {/* Add Discount button — only for pending/confirmed */}
        {(appointment.status === "pending" || appointment.status === "confirmed") && (
          <Pressable
            onPress={() => {
              setDiscountInput("");
              setDiscountType("percent");
              setShowDiscountModal(true);
            }}
            style={({ pressed }) => [
              styles.messageBtn,
              { borderColor: colors.warning, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <IconSymbol name="tag.fill" size={18} color={colors.warning} />
            <Text style={[styles.messageBtnText, { color: colors.warning }]}>
              {(appointment.discountAmount ?? 0) > 0 ? "Edit Discount" : "Add Discount"}
            </Text>
          </Pressable>
        )}

        {/* Pending Cancel/Reschedule Request Banner */}
        {(appointment.cancelRequest?.status === 'pending' || appointment.rescheduleRequest?.status === 'pending') && (
          <View style={{ backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            {appointment.cancelRequest?.status === 'pending' && (
              <>
                <Text style={{ fontSize: fs.xs, fontWeight: '700', color: '#92400E', marginBottom: 4 }}>⏳ Client Requested Cancellation</Text>
                {appointment.cancelRequest.reason ? (
                  <Text style={{ fontSize: fs.xs, color: '#78350F', marginBottom: 12 }}>Reason: "{appointment.cancelRequest.reason}"</Text>
                ) : (
                  <Text style={{ fontSize: fs.xs, color: '#78350F', marginBottom: 12 }}>No reason provided.</Text>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={async () => {
                      const { feeApplies, fee } = getCancellationInfo();
                      const total = appointment.totalPrice ?? 0;
                      const isPaidByCard = appointment.paymentStatus === 'paid' && appointment.paymentMethod === 'card';
                      const confirmMsg = isPaidByCard
                        ? feeApplies
                          ? `Approve cancellation?\n\nCancellation fee: $${fee.toFixed(2)} (${policy.feePercentage}%)\nRefund to client: $${(total - fee).toFixed(2)}\n\nThe fee will be charged off-session and the remainder refunded.`
                          : `Approve cancellation?\n\nNo fee applies — a full refund of $${total.toFixed(2)} will be issued to the client's card.`
                        : 'Approve this cancellation request? The appointment will be cancelled.';
                      Alert.alert('Approve Cancellation', confirmMsg, [
                        { text: 'Go Back', style: 'cancel' },
                        { text: 'Approve', style: 'destructive', onPress: async () => {
                          // Mark request as approved
                          const updatedAppt = { ...appointment, cancelRequest: { ...appointment.cancelRequest!, status: 'approved' as const, resolvedAt: new Date().toISOString() } };
                          dispatch({ type: 'MARK_INBOX_READ_BY_APPOINTMENT', payload: appointment.id });
                          dispatch({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                          // Handle card refund/fee
                          if (isPaidByCard) {
                            try {
                              if (feeApplies && fee > 0) {
                                await apiCall('/api/stripe-connect/cancellation-fee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointmentId: appointment.id, businessOwnerId: state.businessOwnerId, feeAmount: fee }) });
                              }
                              const refundAmt = feeApplies ? total - fee : undefined;
                              const result = await apiCall<{ ok: boolean; refundId: string; amount: number }>('/api/stripe-connect/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointmentId: appointment.id, businessOwnerId: state.businessOwnerId, amount: refundAmt }) });
                              const refundedAppt = { ...updatedAppt, status: 'cancelled' as const, refundedAmount: result.amount, stripeRefundId: result.refundId, cancellationReason: appointment.cancelRequest?.reason || 'Client requested cancellation' };
                              dispatch({ type: 'UPDATE_APPOINTMENT', payload: refundedAppt });
                              syncToDb({ type: 'UPDATE_APPOINTMENT', payload: refundedAppt });
                              Alert.alert('✅ Approved', `Appointment cancelled and $${result.amount.toFixed(2)} refunded to client's card.`);
                            } catch (err: any) {
                              // Still cancel even if refund fails
                              const cancelledAppt = { ...updatedAppt, status: 'cancelled' as const, cancellationReason: appointment.cancelRequest?.reason || 'Client requested cancellation' };
                              dispatch({ type: 'UPDATE_APPOINTMENT', payload: cancelledAppt });
                              syncToDb({ type: 'UPDATE_APPOINTMENT', payload: cancelledAppt });
                              Alert.alert('Refund Failed', `Appointment cancelled but refund failed: ${err?.message ?? 'Unknown error'}. Please issue manually from Stripe dashboard.`);
                            }
                          } else {
                            const cancelledAppt = { ...updatedAppt, status: 'cancelled' as const, cancellationReason: appointment.cancelRequest?.reason || 'Client requested cancellation' };
                            dispatch({ type: 'UPDATE_APPOINTMENT', payload: cancelledAppt });
                            syncToDb({ type: 'UPDATE_APPOINTMENT', payload: cancelledAppt });
                            Alert.alert('✅ Approved', 'Appointment has been cancelled.');
                          }
                        }},
                      ]);
                    }}
                    style={({ pressed }) => [{ flex: 1, backgroundColor: '#22C55E', borderRadius: 10, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>✓ Approve</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Alert.alert('Decline Cancellation', 'Decline this cancellation request? The appointment will remain active.', [
                        { text: 'Go Back', style: 'cancel' },
                        { text: 'Decline', style: 'destructive', onPress: () => {
                          const updatedAppt = { ...appointment, cancelRequest: { ...appointment.cancelRequest!, status: 'declined' as const, resolvedAt: new Date().toISOString() } };
                          dispatch({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                          dispatch({ type: 'MARK_INBOX_READ_BY_APPOINTMENT', payload: appointment.id });
                          syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                        }},
                      ]);
                    }}
                    style={({ pressed }) => [{ flex: 1, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>✗ Decline</Text>
                  </Pressable>
                </View>
              </>
            )}
            {appointment.rescheduleRequest?.status === 'pending' && (
              <>
                <Text style={{ fontSize: fs.xs, fontWeight: '700', color: '#92400E', marginBottom: 4 }}>⏳ Client Requested Reschedule</Text>
                <Text style={{ fontSize: fs.xs, color: '#78350F', marginBottom: 4 }}>Requested: {appointment.rescheduleRequest.requestedDate} at {formatTime(appointment.rescheduleRequest.requestedTime)}</Text>
                {appointment.rescheduleRequest.reason ? (
                  <Text style={{ fontSize: fs.xs, color: '#78350F', marginBottom: 12 }}>Reason: "{appointment.rescheduleRequest.reason}"</Text>
                ) : (
                  <Text style={{ fontSize: fs.xs, color: '#78350F', marginBottom: 12 }}></Text>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={() => {
                      Alert.alert('Approve Reschedule', `Reschedule to ${appointment.rescheduleRequest!.requestedDate} at ${formatTime(appointment.rescheduleRequest!.requestedTime)}?`, [
                        { text: 'Go Back', style: 'cancel' },
                        { text: 'Approve', onPress: () => {
                          const updatedAppt = { ...appointment, date: appointment.rescheduleRequest!.requestedDate, time: appointment.rescheduleRequest!.requestedTime, rescheduleRequest: { ...appointment.rescheduleRequest!, status: 'approved' as const, resolvedAt: new Date().toISOString() } };
                          dispatch({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                          dispatch({ type: 'MARK_INBOX_READ_BY_APPOINTMENT', payload: appointment.id });
                          syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                          Alert.alert('✅ Approved', 'Appointment rescheduled successfully.');
                        }},
                      ]);
                    }}
                    style={({ pressed }) => [{ flex: 1, backgroundColor: '#22C55E', borderRadius: 10, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>✓ Approve</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Alert.alert('Decline Reschedule', 'Decline this reschedule request?', [
                        { text: 'Go Back', style: 'cancel' },
                        { text: 'Decline', style: 'destructive', onPress: () => {
                          const updatedAppt = { ...appointment, rescheduleRequest: { ...appointment.rescheduleRequest!, status: 'declined' as const, resolvedAt: new Date().toISOString() } };
                          dispatch({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                          dispatch({ type: 'MARK_INBOX_READ_BY_APPOINTMENT', payload: appointment.id });
                          syncToDb({ type: 'UPDATE_APPOINTMENT', payload: updatedAppt });
                        }},
                      ]);
                    }}
                    style={({ pressed }) => [{ flex: 1, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.sm }}>✗ Decline</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}

        {/* Resolved Request SMS Prompt — shown after owner approves or declines */}
        {(() => {
          const cr = appointment.cancelRequest;
          const rr = appointment.rescheduleRequest;
          const resolved = (cr && cr.status !== 'pending') || (rr && rr.status !== 'pending');
          if (!resolved || !client?.phone) return null;
          const isCancel = cr && cr.status !== 'pending';
          const approved = isCancel ? cr?.status === 'approved' : rr?.status === 'approved';
          const svcName = getServiceById(appointment.serviceId)?.name ?? 'your appointment';
          const businessName = (state.settings as any).businessName ?? 'us';
          let smsText = '';
          if (isCancel) {
            smsText = approved
              ? `Hi ${client.name?.split(' ')[0] ?? 'there'}, your cancellation request for ${svcName} on ${appointment.date} has been approved. ${appointment.paymentMethod === 'card' ? 'Your refund is on its way (5-10 business days).' : ''} Thanks for letting us know. – ${businessName}`
              : `Hi ${client.name?.split(' ')[0] ?? 'there'}, your cancellation request for ${svcName} on ${appointment.date} was declined. Your appointment is still confirmed. Please contact us if you have questions. – ${businessName}`;
          } else {
            smsText = approved
              ? `Hi ${client.name?.split(' ')[0] ?? 'there'}, your reschedule request has been approved! Your new appointment is on ${rr?.requestedDate ?? appointment.date} at ${rr?.requestedTime ?? appointment.time}. See you then! – ${businessName}`
              : `Hi ${client.name?.split(' ')[0] ?? 'there'}, your reschedule request for ${svcName} was declined. Your original appointment on ${appointment.date} is still confirmed. – ${businessName}`;
          }
          return (
            <View style={{ backgroundColor: approved ? '#F0FDF4' : '#FFF7ED', borderColor: approved ? '#86EFAC' : '#FCD34D', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: '700', color: approved ? '#166534' : '#92400E', marginBottom: 6 }}>
                {approved ? '✅' : '❌'} Request {approved ? 'Approved' : 'Declined'} — Notify Client?
              </Text>
              <Text style={{ fontSize: fs.xs, color: approved ? '#166534' : '#78350F', marginBottom: 10, lineHeight: 18 }}>{smsText}</Text>
              <Pressable
                onPress={() => {
                  sendSmsMutation.mutate({ businessOwnerId: state.businessOwnerId!, toNumber: client.phone!.replace(/\D/g, '').startsWith('1') ? `+${client.phone!.replace(/\D/g, '')}` : `+1${client.phone!.replace(/\D/g, '')}`, body: smsText, smsAction: 'confirmation' });
                }}
                style={({ pressed }) => [{ backgroundColor: approved ? '#22C55E' : '#F59E0B', borderRadius: 10, paddingVertical: 9, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: fs.xs }}>📱 Send SMS to {client.name?.split(' ')[0] ?? 'Client'}</Text>
              </Pressable>
            </View>
          );
        })()}

        {/* Actions */}
        {appointment.status === "pending" && (
          <View className="gap-3 mt-2 mb-4">
            <Pressable
              onPress={handleAccept}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="checkmark" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Accept Appointment</Text>
            </Pressable>
            <Pressable
              onPress={() => { setReschedDate(appointment.date); setReschedTime(null); setReschedCalMonth(() => { const d = new Date(appointment.date + "T12:00:00"); return { year: d.getFullYear(), month: d.getMonth() }; }); setShowRescheduleModal(true); }}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="calendar" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Reschedule</Text>
            </Pressable>
            <Pressable
              onPress={() => handleStatusChange("cancelled")}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.error, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="xmark" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Reject Appointment</Text>
            </Pressable>
          </View>
        )}

        {appointment.status === "confirmed" && (
          <View className="gap-3 mt-2 mb-4">
            <Pressable
              onPress={() => handleStatusChange("completed")}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="checkmark" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Mark Complete</Text>
            </Pressable>
            {appointment.giftApplied && (
              <Pressable
                onPress={handleConfirmGiftRedemption}
                style={({ pressed }) => [styles.actionButton, { backgroundColor: "#22C55E", opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={{ fontSize: fs.md }}>🎁</Text>
                <Text className="text-white font-semibold ml-2">Confirm Gift Redemption</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => { setReschedDate(appointment.date); setReschedTime(null); setReschedCalMonth(() => { const d = new Date(appointment.date + "T12:00:00"); return { year: d.getFullYear(), month: d.getMonth() }; }); setShowRescheduleModal(true); }}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="calendar" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Reschedule</Text>
            </Pressable>
            <Pressable
              onPress={handleNoShow}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: "#F59E0B", opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="person.fill.xmark" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Mark as No-Show{!isGrowthPlan ? " 🔒" : ""}</Text>
            </Pressable>
            <Pressable
              onPress={() => handleStatusChange("cancelled")}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.error, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="xmark" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Cancel Appointment</Text>
            </Pressable>
          </View>
        )}

        {/* Persistent no-show fee button for already-marked no-show appointments */}
        {appointment.status === "no_show" && !!(state.settings as any).stripeConnectEnabled && (
          <View className="gap-3 mt-2 mb-2">
            <Pressable
              onPress={() => {
                const defaultFee = service ? Math.round((service.price ?? 0) * 0.5 * 100) / 100 : 0;
                setNoShowFeeAmount(String(defaultFee > 0 ? defaultFee : ""));
                setShowNoShowFeeModal(true);
              }}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: "#F59E0B", opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="creditcard" size={20} color="#FFFFFF" />
              <Text className="text-white font-semibold ml-2">Charge No-Show Fee</Text>
            </Pressable>
          </View>
        )}

        {/* Book Again — pre-fills new booking with same service, client, and staff */}
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/new-booking" as any,
              params: {
                prefillServiceId: appointment.serviceId,
                prefillClientId: appointment.clientId,
                ...(appointment.staffId ? { prefillStaffId: appointment.staffId } : {}),
              },
            })
          }
          style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1, marginBottom: 8 }]}
        >
          <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.primary, marginLeft: 8 }}>Book Again</Text>
        </Pressable>

        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [styles.deleteButton, { borderColor: colors.error, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text className="text-sm font-medium" style={{ color: colors.error }}>Delete Appointment</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Payment Receipt Modal — shown after successful card payment */}
      <PaymentReceiptModal
        visible={!!receiptData}
        onDone={() => setReceiptData(null)}
        amount={receiptData?.amount ?? 0}
        serviceName={receiptData?.serviceName}
        clientName={receiptData?.clientName}
        cardLast4={receiptData?.cardLast4}
        cardBrand={receiptData?.cardBrand}
        confirmationId={receiptData?.confirmationId}
      />

      {/* Payment Confirmation Modal */}
      <Modal
        visible={showPaymentModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          // Android back button — clear pending complete so it doesn't leak
          pendingCompleteRef.current = null;
          setShowPaymentModal(false);
          setPaymentConfirmInput('');
        }}
      >
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            {/* Handle bar */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.foreground, marginBottom: 4 }}>
              {pendingCompleteRef.current ? '✅ Complete & Collect Payment' : 'Mark as Paid'}
            </Text>
            {pendingCompleteRef.current && (
              <Text style={{ fontSize: fs.xs, color: colors.primary, marginBottom: 4 }}>Record how the client paid to complete this appointment.</Text>
            )}
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16 }}>
              {client?.name ?? 'Client'}{appointment.totalPrice != null ? ` · $${appointment.totalPrice.toFixed(2)}` : ''}
            </Text>

            {/* Method picker — always shown for pay_later or when no method is pre-set */}
            {(!appointment.paymentMethod || appointment.paymentMethod === 'unpaid' || appointment.paymentMethod === 'pay_later') && (
              <>
                <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Payment Method</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {DETAIL_PAYMENT_METHODS.map((pm) => (
                    <Pressable
                      key={pm.key}
                      onPress={() => setSelectedPayMethod(pm.key)}
                      style={({ pressed }) => [{
                        paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
                        backgroundColor: selectedPayMethod === pm.key ? colors.success : colors.background,
                        borderWidth: 1.5,
                        borderColor: selectedPayMethod === pm.key ? colors.success : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      }]}
                    >
                      <Text style={{ fontSize: fs.sm, fontWeight: '700', color: selectedPayMethod === pm.key ? '#FFF' : colors.foreground }}>{pm.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Confirmation number for digital methods */}
            {(appointment.paymentMethod ?? selectedPayMethod) !== 'cash' && (
              <TextInput
                value={paymentConfirmInput}
                onChangeText={setPaymentConfirmInput}
                placeholder="Confirmation number (optional)"
                placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: fs.sm, color: colors.foreground, backgroundColor: colors.background, marginBottom: 16 }}
                returnKeyType="done"
              />
            )}
            <View style={{ gap: 10 }}>
              <TouchableOpacity
                onPress={() => handleMarkPaid(paymentConfirmInput.trim() || undefined)}
                style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: colors.success, alignItems: 'center' }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>
                  {pendingCompleteRef.current ? '✅ Confirm Payment & Complete' : 'Confirm Paid'}
                </Text>
              </TouchableOpacity>
              {pendingCompleteRef.current ? (
                // Skip payment — just complete the appointment without recording payment
                <TouchableOpacity
                  onPress={() => {
                    const completeFn = pendingCompleteRef.current!;
                    pendingCompleteRef.current = null;
                    setShowPaymentModal(false);
                    setPaymentConfirmInput('');
                    completeFn();
                  }}
                  style={{ paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.muted }}>Complete — Collect Payment Later</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => { setShowPaymentModal(false); setPaymentConfirmInput(''); }}
                  style={{ paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.muted }}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Edit Payment Sheet */}
      <Modal visible={showEditPaymentSheet} transparent animationType="slide" onRequestClose={() => setShowEditPaymentSheet(false)}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.45)', ...StyleSheet.absoluteFillObject }} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
            {/* Handle bar */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.foreground, marginBottom: 4 }}>Edit Payment</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 20 }}>
              {client?.name ?? 'Client'}{appointment?.totalPrice != null ? ` · $${appointment.totalPrice.toFixed(2)}` : ''}
            </Text>

            {/* Payment Status Toggle */}
            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {(['paid', 'unpaid'] as const).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setEditPayStatus(s)}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                    backgroundColor: editPayStatus === s ? (s === 'paid' ? colors.success : colors.warning) : colors.background,
                    borderWidth: 1.5,
                    borderColor: editPayStatus === s ? (s === 'paid' ? colors.success : colors.warning) : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: '700', color: editPayStatus === s ? '#FFF' : colors.foreground }}>
                    {s === 'paid' ? '✓ Paid' : 'Unpaid'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Payment Method */}
            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Method</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {[
                { key: 'cash' as const, label: '💵 Cash' },
                { key: 'zelle' as const, label: '💜 Zelle' },
                { key: 'venmo' as const, label: '💙 Venmo' },
                { key: 'cashapp' as const, label: '💚 Cash App' },
                { key: 'card' as const, label: '💳 Card' },
              ].map((pm) => (
                <Pressable
                  key={pm.key}
                  onPress={() => setEditPayMethod(pm.key)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: editPayMethod === pm.key ? colors.primary : colors.background,
                    borderWidth: 1.5,
                    borderColor: editPayMethod === pm.key ? colors.primary : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: editPayMethod === pm.key ? '#FFF' : colors.foreground }}>{pm.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Confirmation Number */}
            {editPayMethod !== 'cash' && editPayMethod !== 'card' && (
              <>
                <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confirmation Number</Text>
                <TextInput
                  value={editConfirmNumber}
                  onChangeText={setEditConfirmNumber}
                  placeholder={
                    editPayMethod === 'zelle' ? 'e.g. ZL-123456789' :
                    editPayMethod === 'venmo' ? 'e.g. 3456789012' :
                    editPayMethod === 'cashapp' ? 'e.g. C-ABCDE123' : 'Confirmation number'
                  }
                  placeholderTextColor={colors.muted}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: fs.sm, color: colors.foreground, backgroundColor: colors.background, marginBottom: 16 }}
                  returnKeyType="done"
                />
              </>
            )}

            {/* Amount */}
            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Amount ($)</Text>
            <TextInput
              value={editAmount}
              onChangeText={setEditAmount}
              placeholder={appointment?.totalPrice != null ? String(appointment.totalPrice) : '0.00'}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: fs.sm, color: colors.foreground, backgroundColor: colors.background, marginBottom: 24 }}
              returnKeyType="done"
            />

            {/* Action Buttons */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowEditPaymentSheet(false)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveEditPayment}
                disabled={savingPayment}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', opacity: savingPayment ? 0.7 : 1 }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>{savingPayment ? 'Saving…' : 'Save Changes'}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Refund Modal */}
      <Modal visible={showRefundModal} transparent animationType="slide" onRequestClose={() => { setShowRefundModal(false); setRefundAmount(''); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.foreground }}>💳 Issue Refund</Text>
              <Pressable onPress={() => { setShowRefundModal(false); setRefundAmount(''); }} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.muted} />
              </Pressable>
            </View>

            {/* Charge breakdown card */}
            {(() => {
              const total = appointment?.totalPrice ?? 0;
              // Platform fee: 1.5% of service amount
              const platformFee = Math.round(total * 0.015 * 100) / 100;
              // Stripe processing fee: ~2.9% + $0.30 (standard card rate)
              const stripeFee = Math.round((total * 0.029 + 0.30) * 100) / 100;
              // Client receives back: full amount (Stripe fees are non-refundable)
              const clientReceives = Math.round((total - stripeFee) * 100) / 100;
              return (
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Refund Breakdown</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: fs.sm, color: colors.foreground }}>Amount charged</Text>
                    <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.foreground }}>${total.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Stripe processing fee (est.)</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>−${stripeFee.toFixed(2)}</Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: fs.sm, fontWeight: '700', color: colors.foreground }}>Client receives back</Text>
                    <Text style={{ fontSize: fs.sm, fontWeight: '700', color: colors.success }}>${clientReceives.toFixed(2)}</Text>
                  </View>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6, lineHeight: 16 }}>Note: Stripe's processing fee (2.9% + $0.30) is non-refundable. The platform fee (1.5%) is also retained.</Text>
                </View>
              );
            })()}

            {/* Full Refund quick-tap */}
            <Pressable
              onPress={() => {
                const total = appointment?.totalPrice ?? 0;
                const stripeFee = Math.round((total * 0.029 + 0.30) * 100) / 100;
                const clientReceives = Math.round((total - stripeFee) * 100) / 100;
                Alert.alert(
                  'Confirm Full Refund',
                  `Issue a full refund of $${total.toFixed(2)} to the client's card?\n\nThe client will receive approximately $${clientReceives.toFixed(2)} after Stripe's non-refundable processing fee.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Refund', style: 'destructive', onPress: () => handleRefund(undefined) },
                  ]
                );
              }}
              disabled={refunding}
              style={({ pressed }) => [{
                backgroundColor: '#635BFF',
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: 'center',
                marginBottom: 12,
                opacity: pressed || refunding ? 0.7 : 1,
              }]}
            >
              <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>
                {refunding ? 'Processing…' : `Full Refund · $${(appointment?.totalPrice ?? 0).toFixed(2)}`}
              </Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text style={{ fontSize: fs.xs, color: colors.muted }}>or enter partial amount</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>
            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Partial Refund Amount</Text>
            <TextInput
              value={refundAmount}
              onChangeText={setRefundAmount}
              placeholder={`Full refund ($${((appointment?.totalPrice ?? 0)).toFixed(2)})`}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
              style={{ backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: fs.sm, color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 20 }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => { setShowRefundModal(false); setRefundAmount(''); }}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const partial = refundAmount.trim() ? parseFloat(refundAmount.trim()) : undefined;
                  if (partial !== undefined && (isNaN(partial) || partial <= 0)) {
                    Alert.alert('Invalid Amount', 'Please enter a valid positive amount or leave blank for full refund.');
                    return;
                  }
                  const total = appointment?.totalPrice ?? 0;
                  const stripeFee = Math.round((total * 0.029 + 0.30) * 100) / 100;
                  const clientReceives = partial
                    ? partial
                    : Math.round((total - stripeFee) * 100) / 100;
                  Alert.alert(
                    'Confirm Refund',
                    partial
                      ? `Issue a $${partial.toFixed(2)} partial refund to the client's card?`
                      : `Issue a full refund of $${total.toFixed(2)}?\n\nClient receives approximately $${clientReceives.toFixed(2)} after Stripe's non-refundable processing fee.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Refund', style: 'destructive', onPress: () => handleRefund(partial) },
                    ]
                  );
                }}
                disabled={refunding}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#635BFF', alignItems: 'center', opacity: refunding ? 0.6 : 1 }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>{refunding ? 'Processing…' : 'Issue Refund'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* No-Show Fee Modal */}
      <Modal visible={showNoShowFeeModal} transparent animationType="slide" onRequestClose={() => setShowNoShowFeeModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.foreground }}>💳 Charge No-Show Fee</Text>
              <Pressable onPress={() => setShowNoShowFeeModal(false)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: fs.sm, color: colors.muted, marginBottom: 16, lineHeight: 20 }}>
              Charge {client?.name ?? 'the client'} a no-show fee via Stripe. They will receive a secure payment link.
              {service ? ` Suggested: $${Math.round((service.price ?? 0) * 0.5 * 100) / 100} (50% of service price)` : ''}
            </Text>
            <TextInput
              style={{ borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: fs.md, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }}
              value={noShowFeeAmount}
              onChangeText={setNoShowFeeAmount}
              placeholder="Fee amount (e.g. 25.00)"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setShowNoShowFeeModal(false)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const fee = parseFloat(noShowFeeAmount.trim());
                  if (isNaN(fee) || fee <= 0) {
                    Alert.alert('Invalid Amount', 'Please enter a valid fee amount.');
                    return;
                  }
                  Alert.alert(
                    'Confirm No-Show Fee',
                    `Charge ${client?.name ?? 'the client'} a no-show fee of $${fee.toFixed(2)} via Stripe?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Charge', style: 'destructive', onPress: () => handleChargeNoShowFee(fee) },
                    ]
                  );
                }}
                disabled={noShowFeeLoading}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F59E0B', alignItems: 'center', opacity: noShowFeeLoading ? 0.6 : 1 }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>{noShowFeeLoading ? 'Processing…' : 'Send Payment Link'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reschedule Modal */}
      <Modal visible={showRescheduleModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "85%", width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Reschedule Appointment</Text>
              <Pressable onPress={() => { setShowRescheduleModal(false); setRescheduleReason(""); }} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Calendar card */}
              <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                {/* Month navigation */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <Pressable
                    onPress={() => setReschedCalMonth(m => {
                      const d = new Date(m.year, m.month - 1, 1);
                      return { year: d.getFullYear(), month: d.getMonth() };
                    })}
                    style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.6 : 1, backgroundColor: colors.background, borderRadius: 10 }]}
                  >
                    <IconSymbol name="chevron.left" size={18} color={colors.primary} />
                  </Pressable>
                  <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
                    {new Date(reschedCalMonth.year, reschedCalMonth.month, 1).toLocaleString("default", { month: "long", year: "numeric" })}
                  </Text>
                  <Pressable
                    onPress={() => setReschedCalMonth(m => {
                      const d = new Date(m.year, m.month + 1, 1);
                      return { year: d.getFullYear(), month: d.getMonth() };
                    })}
                    style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.6 : 1, backgroundColor: colors.background, borderRadius: 10 }]}
                  >
                    <IconSymbol name="chevron.right" size={18} color={colors.primary} />
                  </Pressable>
                </View>

                {/* Day headers */}
                <View style={{ flexDirection: "row", marginBottom: 6 }}>
                  {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                    <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: fs.xs, fontWeight: "700", color: colors.foreground, opacity: 0.55, letterSpacing: 0.3 }}>{d}</Text>
                  ))}
                </View>

                {/* Calendar grid */}
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {reschedCalDays.map((day, idx) => {
                    if (!day) return <View key={`e${idx}`} style={{ width: "14.28%", height: 48 }} />;
                    const dateStr = `${reschedCalMonth.year}-${String(reschedCalMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const todayStr = today.toISOString().split("T")[0];
                    const isPast = new Date(dateStr + "T23:59:59") < today;
                    const slotCount = reschedMonthSlotCounts[dateStr] ?? 0;
                    const hasSlots = slotCount > 0;
                    const isDisabled = isPast || (!hasSlots && !isPast);
                    const isSelected = dateStr === reschedDate;
                    const isToday = dateStr === todayStr;
                    // Dot color: green if many slots, amber if few, red if 1-2
                    const dotColor = slotCount >= 6 ? colors.success : slotCount >= 3 ? colors.warning : colors.primary;
                    return (
                      <Pressable
                        key={dateStr}
                        onPress={() => {
                          if (!isDisabled) { setReschedDate(dateStr); setReschedTime(null); }
                          else if (!isPast && !hasSlots) { showReschedClosedDayMsg("Closed — no working hours set for this day"); }
                        }}
                        style={({ pressed }) => [{
                          width: "14.28%",
                          height: 48,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: isDisabled ? 0.22 : pressed ? 0.7 : 1,
                        }]}
                      >
                        {/* Selected: outlined rounded square, no fill */}
                        {isSelected && (
                          <View style={{
                            position: "absolute",
                            width: 36, height: 36,
                            borderRadius: 10,
                            borderWidth: 2,
                            borderColor: colors.primary,
                            backgroundColor: "transparent",
                          }} />
                        )}
                        <Text style={{
                          fontSize: fs.sm,
                          fontWeight: isToday || isSelected ? "700" : "500",
                          color: isToday ? colors.primary : isSelected ? colors.primary : colors.foreground,
                          lineHeight: 20,
                        }}>{day}</Text>
                        {/* Availability dot */}
                        {!isPast && hasSlots && (
                          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor, marginTop: 2 }} />
                        )}
                        {/* Red dot for closed/off days */}
                        {!isPast && !hasSlots && (
                          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.error, marginTop: 2 }} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Dot legend */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10, paddingHorizontal: 2 }}>
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
              {reschedClosedDayMsg ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.error + "18", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6, marginBottom: 2 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
                  <Text style={{ fontSize: fs.xs, color: colors.error, fontWeight: "500", flex: 1 }}>{reschedClosedDayMsg}</Text>
                </View>
              ) : null}

              {/* Time slots */}
              {/* Slot Interval Selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16, marginBottom: 4 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}>
                {[
                  { label: "Auto", value: 0 },
                  { label: "5m", value: 5 },
                  { label: "10m", value: 10 },
                  { label: "15m", value: 15 },
                  { label: "20m", value: 20 },
                  { label: "25m", value: 25 },
                  { label: "30m", value: 30 },
                ].map((iv) => {
                  const globalConfigured = (state.settings as any).slotInterval ?? 0;
                  const activeValue = reschedLocalInterval !== null ? reschedLocalInterval : globalConfigured;
                  const isActive = iv.value === activeValue;
                  return (
                    <Pressable
                      key={iv.value}
                      onPress={() => {
                        setReschedLocalInterval(iv.value);
                        setReschedTime(null);
                      }}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 20,
                        backgroundColor: isActive ? colors.primary : colors.surface,
                        borderWidth: 1.5,
                        borderColor: isActive ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isActive ? "#FFF" : colors.foreground }}>
                        {iv.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 10 }}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Available Times</Text>
                {reschedSlots.length > 0 && (
                  <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>{reschedSlots.length} slot{reschedSlots.length !== 1 ? "s" : ""}</Text>
                )}
              </View>
              {reschedSlots.length === 0 ? (
                <Text style={{ fontSize: fs.sm, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>No available slots on this date</Text>
              ) : (
                <View style={{ marginBottom: 16 }}>
                  {([
                    { label: "Morning", slots: reschedSlots.filter(s => timeToMinutes(s) < 12 * 60) },
                    { label: "Afternoon", slots: reschedSlots.filter(s => timeToMinutes(s) >= 12 * 60 && timeToMinutes(s) < 17 * 60) },
                    { label: "Evening", slots: reschedSlots.filter(s => timeToMinutes(s) >= 17 * 60) },
                  ] as { label: string; slots: string[] }[]).filter(g => g.slots.length > 0).map(group => (
                    <View key={group.label} style={{ marginBottom: 12 }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{group.label}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {group.slots.map(slot => (
                          <Pressable
                            key={slot}
                            onPress={() => setReschedTime(slot)}
                            style={({ pressed }) => ({
                              width: "22%",
                              paddingVertical: 9,
                              borderRadius: 10,
                              backgroundColor: reschedTime === slot ? colors.primary : colors.background,
                              borderWidth: 1.5,
                              borderColor: reschedTime === slot ? colors.primary : colors.border,
                              alignItems: "center",
                              opacity: pressed ? 0.7 : 1,
                            })}
                          >
                            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: reschedTime === slot ? "#FFF" : colors.foreground }}>
                              {formatTime(slot)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Reschedule Reason */}
              <View style={{ marginTop: 16, marginBottom: 4 }}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Reason (optional)</Text>
                <TextInput
                  value={rescheduleReason}
                  onChangeText={setRescheduleReason}
                  placeholder="e.g. Client requested earlier time"
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={2}
                  returnKeyType="done"
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1.5,
                    borderColor: rescheduleReason.trim() ? colors.primary : colors.border,
                    borderRadius: 10,
                    padding: 10,
                    fontSize: fs.sm,
                    color: colors.foreground,
                    minHeight: 60,
                    textAlignVertical: "top",
                  }}
                />
              </View>

              {/* Confirm button */}
              <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => { setShowRescheduleModal(false); setRescheduleReason(""); }}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleReschedule}
                  disabled={!reschedTime}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: reschedTime ? colors.primary : colors.border, alignItems: "center" }}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: reschedTime ? "#FFF" : colors.muted }}>Confirm Reschedule</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Cancellation Reason Modal */}
      <Modal visible={cancelReasonModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>Cancel Appointment</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 20 }}>Select a reason for cancellation</Text>
            {CANCEL_REASONS.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setSelectedReason(r)}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selectedReason === r ? colors.primary : colors.border, alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                  {selectedReason === r && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
                </View>
                <Text style={{ fontSize: fs.sm, color: colors.foreground }}>{r}</Text>
              </TouchableOpacity>
            ))}
            {selectedReason === "Other" && (
              <TextInput
                value={customReason}
                onChangeText={setCustomReason}
                placeholder="Describe the reason..."
                placeholderTextColor={colors.muted}
                style={{ marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: fs.sm, color: colors.foreground, backgroundColor: colors.background }}
                multiline
                numberOfLines={2}
              />
            )}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 24 }}>
              <TouchableOpacity
                onPress={() => setCancelReasonModal(false)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.muted }}>Go Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const reason = selectedReason === "Other" ? (customReason.trim() || "Other") : selectedReason;
                  setCancelReasonModal(false);
                  const cancInfo = getCancellationInfo();
                  const proceed = () => {
                    dispatch({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appointment.id, status: "cancelled", cancellationReason: reason || undefined } });
                    syncToDb({ type: "UPDATE_APPOINTMENT_STATUS", payload: { id: appointment.id, status: "cancelled", cancellationReason: reason || undefined } });
                    if (client?.phone) {
                      const feeStr = cancInfo.feeApplies && cancInfo.fee > 0 ? `$${cancInfo.fee} (${policy.feePercentage}%)` : "";
                      const msg = generateCancellationMessage(
                        biz.businessName, client.name,
                        service ? getServiceDisplayName(service) : "Service",
                        appointment.date, appointment.time, feeStr,
                        assignedLocation?.phone || profile.phone,
                        assignedLocation?.name,
                        assignedLocation?.address ?? profile.address,
                        assignedLocation?.city ?? profile.city,
                        assignedLocation?.state ?? profile.state,
                        assignedLocation?.zipCode ?? profile.zipCode
                      );
                      openSms(client.phone, msg);
                    }
                    router.back();
                  };
                  // ── Smart cancellation for card-paid appointments ──────────────────
                  const isCardPaid = appointment.paymentStatus === 'paid' && appointment.paymentMethod === 'card';
                  const stripeEnabled = !!(state.settings as any).stripeConnectEnabled;

                  if (isCardPaid && stripeEnabled) {
                    const total = appointment.totalPrice ?? 0;
                    const fee = cancInfo.feeApplies ? cancInfo.fee : 0;
                    const refundAmt = Math.max(0, total - fee);

                    const doCardCancel = async () => {
                      // Cancel the appointment in local state first
                      proceed();
                      if (total <= 0) return;

                      // Use the unified refund-on-cancel endpoint (handles cancellation fee + partial/full refund).
                      // Falls back to the basic /refund endpoint if the newer endpoint is not yet deployed.
                      try {
                        let refundAmt2 = 0;
                        let feeAmt2 = 0;
                        let feeCharged2 = false;
                        try {
                          const result = await apiCall<{
                            ok: boolean;
                            refundAmount: number;
                            feeAmount: number;
                            feeCharged: boolean;
                            refundId: string | null;
                          }>('/api/stripe-connect/refund-on-cancel', {
                            method: 'POST',
                            body: JSON.stringify({
                              businessOwnerId: state.businessOwnerId,
                              appointmentLocalId: appointment.id,
                            }),
                          });
                          refundAmt2 = result.refundAmount ?? 0;
                          feeAmt2 = result.feeAmount ?? 0;
                          feeCharged2 = result.feeCharged ?? false;
                        } catch (endpointErr: any) {
                          // If the endpoint doesn't exist yet (404 / "Cannot POST"), fall back to basic refund
                          const isNotFound = endpointErr?.message?.includes('Cannot POST') ||
                            endpointErr?.message?.includes('404') ||
                            endpointErr?.message?.includes('not found');
                          if (!isNotFound) throw endpointErr; // re-throw real errors
                          // Fallback: issue a full refund via the existing /refund endpoint
                          const fallback = await apiCall<{ ok: boolean; refundId: string; amount: number }>('/api/stripe-connect/refund', {
                            method: 'POST',
                            body: JSON.stringify({
                              businessOwnerId: state.businessOwnerId,
                              appointmentLocalId: appointment.id,
                            }),
                          });
                          refundAmt2 = fallback.amount ?? 0;
                        }

                        if (feeCharged2 && feeAmt2 > 0 && refundAmt2 > 0) {
                          Alert.alert(
                            '✅ Done',
                            `Cancellation fee kept: $${feeAmt2.toFixed(2)} (${policy.feePercentage}%)\nRefund issued: $${refundAmt2.toFixed(2)} to client's card.\n\nBoth transactions are visible in your Stripe dashboard.`
                          );
                        } else if (feeCharged2 && feeAmt2 > 0 && refundAmt2 === 0) {
                          Alert.alert(
                            '✅ Done',
                            `Cancellation fee of $${feeAmt2.toFixed(2)} was charged. No refund was issued (fee covered the full amount).`
                          );
                        } else if (refundAmt2 > 0) {
                          Alert.alert('✅ Refund Issued', `$${refundAmt2.toFixed(2)} has been fully refunded to the client's card.`);
                        } else {
                          Alert.alert('✅ Cancelled', 'The appointment has been cancelled. No payment action was needed.');
                        }
                      } catch (err: any) {
                        Alert.alert(
                          'Refund Failed',
                          `The appointment was cancelled but the refund could not be processed automatically.\nError: ${err?.message ?? 'Unknown error'}\n\nPlease issue the refund manually from your Stripe dashboard.`
                        );
                      }
                    };

                    if (fee > 0) {
                      Alert.alert(
                        'Cancel & Refund',
                        `This appointment was paid by card ($${total.toFixed(2)}).\n\nCancellation fee: $${fee.toFixed(2)} (${policy.feePercentage}%)\nRefund to client: $${refundAmt.toFixed(2)}\n\nThe cancellation fee will be kept and the remainder refunded to the client's card.`,
                        [
                          { text: 'Go Back', style: 'cancel' },
                          { text: 'Cancel & Refund', style: 'destructive', onPress: doCardCancel },
                        ]
                      );
                    } else {
                      Alert.alert(
                        'Cancel & Full Refund',
                        `This appointment was paid by card ($${total.toFixed(2)}).\n\nNo cancellation fee applies — a full refund will be issued to the client's card.`,
                        [
                          { text: 'Go Back', style: 'cancel' },
                          { text: 'Cancel & Refund', style: 'destructive', onPress: doCardCancel },
                        ]
                      );
                    }
                  } else if (cancInfo.feeApplies && cancInfo.fee > 0 && Platform.OS !== "web") {
                    Alert.alert("Cancellation Fee", `A fee of $${cancInfo.fee} (${policy.feePercentage}%) applies.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Confirm", onPress: proceed },
                    ]);
                  } else {
                    proceed();
                  }
                }}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.error, alignItems: "center" }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#FFF" }}>Cancel Appointment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add / Edit Discount Modal ── */}
      <Modal visible={showDiscountModal} transparent animationType="slide" onRequestClose={() => setShowDiscountModal(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Apply Discount</Text>
              <Pressable onPress={() => setShowDiscountModal(false)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <IconSymbol name="xmark" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {/* Saved discounts list */}
            {state.discounts.filter((d) => d.active).length > 0 && (
              <>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Saved Discounts</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {state.discounts.filter((d) => d.active).map((d) => (
                      <Pressable
                        key={d.id}
                        onPress={() => {
                          const basePrice = (appointment?.totalPrice ?? 0) + (appointment?.discountAmount ?? 0);
                          const amt = Math.round((basePrice * d.percentage) / 100 * 100) / 100;
                          const updated = { ...appointment!, discountPercent: d.percentage, discountAmount: amt, discountName: d.name, totalPrice: Math.max(0, basePrice - amt) };
                          dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                          syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                          setShowDiscountModal(false);
                        }}
                        style={({ pressed }) => ({
                          backgroundColor: colors.warning + "18",
                          borderColor: colors.warning,
                          borderWidth: 1,
                          borderRadius: 20,
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.warning }}>{d.name} — {d.percentage}% Off</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            {/* Custom discount */}
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Custom Discount</Text>
            {/* Type toggle */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {(["percent", "flat"] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setDiscountType(t)}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 12,
                    alignItems: "center",
                    backgroundColor: discountType === t ? colors.warning : colors.background,
                    borderWidth: 1,
                    borderColor: discountType === t ? colors.warning : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: discountType === t ? "#FFF" : colors.muted }}>
                    {t === "percent" ? "Percentage (%)" : "Flat Amount ($)"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={discountInput}
              onChangeText={setDiscountInput}
              placeholder={discountType === "percent" ? "e.g. 10  (for 10%)" : "e.g. 15  (for $15 off)"}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: fs.md, color: colors.foreground, marginBottom: 16 }}
            />

            {/* Apply / Remove buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(appointment?.discountAmount ?? 0) > 0 && (
                <Pressable
                  onPress={() => {
                    const basePrice = (appointment?.totalPrice ?? 0) + (appointment?.discountAmount ?? 0);
                    const updated = { ...appointment!, discountPercent: undefined, discountAmount: undefined, discountName: undefined, totalPrice: basePrice };
                    dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                    syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                    setShowDiscountModal(false);
                  }}
                  style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", backgroundColor: colors.error + "18", borderWidth: 1, borderColor: colors.error, opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.error }}>Remove</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  const val = parseFloat(discountInput);
                  if (isNaN(val) || val <= 0) { Alert.alert("Invalid", "Please enter a valid discount value."); return; }
                  const basePrice = (appointment?.totalPrice ?? 0) + (appointment?.discountAmount ?? 0);
                  let amt: number;
                  let pct: number | undefined;
                  if (discountType === "percent") {
                    if (val > 100) { Alert.alert("Invalid", "Percentage cannot exceed 100."); return; }
                    amt = Math.round((basePrice * val) / 100 * 100) / 100;
                    pct = val;
                  } else {
                    if (val > basePrice) { Alert.alert("Invalid", `Discount cannot exceed the total ($${basePrice.toFixed(2)}).`); return; }
                    amt = val;
                    pct = undefined;
                  }
                  const updated = { ...appointment!, discountPercent: pct, discountAmount: amt, discountName: discountType === "percent" ? `${val}% Off` : `$${val.toFixed(2)} Off`, totalPrice: Math.max(0, basePrice - amt) };
                  dispatch({ type: "UPDATE_APPOINTMENT", payload: updated });
                  syncToDb({ type: "UPDATE_APPOINTMENT", payload: updated });
                  setShowDiscountModal(false);
                }}
                style={({ pressed }) => ({ flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: "center", backgroundColor: colors.warning, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#FFF" }}>Apply Discount</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {/* ── Partial Gift Redemption Sheet ── */}
      <Modal visible={showGiftRedeemSheet} transparent animationType="slide" onRequestClose={() => setShowGiftRedeemSheet(false)}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.45)', ...StyleSheet.absoluteFillObject }} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, width: '100%', maxWidth: modalMaxWidth, alignSelf: 'center' }}>
            {/* Handle bar */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: fs.md, fontWeight: '700', color: colors.foreground }}>🎁 Redeem Gift Card</Text>
              <Pressable onPress={() => setShowGiftRedeemSheet(false)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 20 }}>
              Enter the amount to deduct from the gift card balance. You can redeem a partial amount and use the rest later.
            </Text>

            {/* Gift card balance info */}
            {(() => {
              const giftCard = state.giftCards.find(
                (gc) => gc.id === (appointment as any).giftCardId ||
                         gc.code === (appointment as any).giftCode
              );
              if (!giftCard) return null;
              return (
                <View style={{ backgroundColor: colors.background, borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gift Card Balance</Text>
                    <Text style={{ fontSize: fs.lg, fontWeight: '700', color: colors.success, marginTop: 2 }}>${(giftCard.remainingBalance ?? giftCard.originalValue ?? 0).toFixed(2)}</Text>
                  </View>
                  {giftCard.code && (
                    <View style={{ backgroundColor: colors.success + '18', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.success }}>{giftCard.code}</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Amount input */}
            <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Amount to Redeem</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderRadius: 12, borderWidth: 1.5, borderColor: giftRedeemAmount.trim() ? colors.success : colors.border, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 24 }}>
              <Text style={{ color: colors.success, fontWeight: '700', fontSize: fs.lg, marginRight: 4 }}>$</Text>
              <TextInput
                value={giftRedeemAmount}
                onChangeText={(v) => setGiftRedeemAmount(v.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                returnKeyType="done"
                style={{ flex: 1, color: colors.foreground, fontSize: fs.lg, fontWeight: '700' }}
                autoFocus
              />
            </View>

            {/* Quick-fill buttons */}
            {(() => {
              const giftCard = state.giftCards.find(
                (gc) => gc.id === (appointment as any).giftCardId ||
                         gc.code === (appointment as any).giftCode
              );
              const balance = giftCard?.remainingBalance ?? giftCard?.originalValue ?? 0;
              const apptTotal = appointment?.totalPrice ?? 0;
              if (balance <= 0) return null;
              const suggestions = [
                { label: 'Full Balance', value: balance },
                ...(apptTotal > 0 && apptTotal < balance ? [{ label: `Appt Total ($${apptTotal.toFixed(2)})`, value: apptTotal }] : []),
              ];
              return (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
                  {suggestions.map((s) => (
                    <Pressable
                      key={s.label}
                      onPress={() => setGiftRedeemAmount(String(s.value))}
                      style={({ pressed }) => ({
                        flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                        backgroundColor: colors.success + '18', borderWidth: 1, borderColor: colors.success + '40',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: fs.xs, fontWeight: '700', color: colors.success }}>{s.label}</Text>
                    </Pressable>
                  ))}
                </View>
              );
            })()}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setShowGiftRedeemSheet(false)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveGiftRedeem}
                disabled={savingGiftRedeem || !giftRedeemAmount.trim()}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.success, alignItems: 'center', opacity: (savingGiftRedeem || !giftRedeemAmount.trim()) ? 0.5 : 1 }}
              >
                <Text style={{ fontSize: fs.sm, fontWeight: '700', color: '#FFF' }}>{savingGiftRedeem ? 'Saving…' : 'Confirm Redemption'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Fee Breakdown Modal ────────────────────────────────────────── */}
      <Modal
        visible={showFeeBreakdown}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowFeeBreakdown(false); setFeeBreakdown(null); }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Payment Summary</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 20 }}>Review the charge breakdown before processing</Text>
            {feeBreakdown && (
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>Service amount</Text>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }}>${feeBreakdown.serviceAmount.toFixed(2)}</Text>
                </View>
                {feeBreakdown.discountAmount > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.success, fontSize: 14 }}>{feeBreakdown.discountName ? `Discount (${feeBreakdown.discountName})` : 'Discount'}</Text>
                    <Text style={{ color: colors.success, fontSize: 14, fontWeight: '600' }}>-${feeBreakdown.discountAmount.toFixed(2)}</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>Platform fee ({feeBreakdown.platformFeePercent}%)</Text>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }}>+${feeBreakdown.platformFee.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, marginTop: 4 }}>
                  <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '700' }}>Total charged to client</Text>
                  <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>${feeBreakdown.totalCharged.toFixed(2)}</Text>
                </View>
                <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 12, marginTop: 4, gap: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Business payout breakdown</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Stripe processing fee (2.9% + $0.30)</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>-${feeBreakdown.stripeFee.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Business net payout</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '600' }}>${feeBreakdown.businessNetPayout.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
              <TouchableOpacity
                onPress={() => { setShowFeeBreakdown(false); setFeeBreakdown(null); }}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
              >
                <Text style={{ color: colors.muted, fontSize: 15, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmBehalfPayment}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center' }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>Confirm & Charge</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function DetailRow({ icon, label, value, colors, onPress }: { icon: any; label: string; value: string; colors: any; onPress?: () => void }) {
  const content = (
    <View className="flex-row items-center py-2">
      <IconSymbol name={icon} size={18} color={colors.muted} />
      <Text className="text-xs text-muted ml-2 w-16">{label}</Text>
      <Text className="text-sm text-foreground flex-1" numberOfLines={2}>{value}</Text>
      {onPress && <IconSymbol name="chevron.right" size={14} color={colors.muted} />}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  actionButton: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 14, minHeight: 52 },
  deleteButton: { width: "100%", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 14, borderWidth: 1, minHeight: 48 },
  messageBtn: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 12, minHeight: 52 },
  messageBtnText: { fontSize: 13, fontWeight: "600", marginLeft: 8 },
});
