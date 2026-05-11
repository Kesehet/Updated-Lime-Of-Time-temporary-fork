/**
 * Business Owner — Client Message Thread Screen
 *
 * Chat UI for the business owner to view and reply to messages from a specific client.
 * Route params: { clientAccountId: string, clientName: string, clientAvatarUrl?: string, clientId?: string }
 * - clientId (optional): if provided, enables appointment-aware template picker
 * - Shows client profile picture (photo or initials fallback)
 * - Full theme support (dark/light follows business portal)
 * - Reminder template library with appointment selector and auto-fill
 */
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  Linking,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import * as Calendar from "expo-calendar";
import { ScreenContainer } from "@/components/screen-container";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { apiCall } from "@/lib/_core/api";
import { useStore } from "@/lib/store";
import {
  ReminderTemplate,
  DEFAULT_REMINDER_TEMPLATES,
  TEMPLATE_LIBRARY,
  getServiceDisplayName,
  stripPhoneFormat,
  formatPhoneNumber,
  formatDateLong,
  formatTimeDisplay,
  buildPriceLine,
  formatFullAddress,
  minutesToTime,
  timeToMinutes,
  PUBLIC_BOOKING_URL,
  LIME_OF_TIME_FOOTER,
  STATUS_TEMPLATE_CATEGORIES,
  TemplateCategory,
  Appointment,
  getMapUrl,
} from "@/lib/types";

// ─── Calendar helper ─────────────────────────────────────────────────────────
async function addDateToCalendar(dateStr: string, timeStr: string, title: string, locationStr?: string) {
  if (Platform.OS === "web") {
    Alert.alert("Not supported", "Calendar integration is not available on web.");
    return;
  }
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission needed", "Please allow calendar access to add this appointment.");
    return;
  }
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [h, m] = (timeStr ?? "09:00").split(":").map(Number);
    const startDate = new Date(year, month - 1, day, h, m);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // default 1h
    let calendarId: string;
    if (Platform.OS === "ios") {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = defaultCal.id;
    } else {
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const primary = cals.find(c => c.isPrimary) ?? cals.find(c => c.allowsModifications) ?? cals[0];
      if (!primary) { Alert.alert("No calendar", "No calendar found on this device."); return; }
      calendarId = primary.id;
    }
    await Calendar.createEventAsync(calendarId, {
      title,
      startDate,
      endDate,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: locationStr,
      alarms: [{ relativeOffset: -60 }, { relativeOffset: -1440 }],
    });
    Alert.alert("Added!", "Appointment added to your calendar.");
  } catch {
    Alert.alert("Error", "Could not add to calendar.");
  }
}

// ─── Clickable message segment types ─────────────────────────────────────────
type MsgSegment =
  | { kind: "text"; text: string }
  | { kind: "phone"; text: string; digits: string }
  | { kind: "address"; text: string; address: string }
  | { kind: "date"; text: string; dateStr: string; timeStr: string };

/** Parse a message body into clickable segments */
function parseMessageSegments(body: string): MsgSegment[] {
  const segments: MsgSegment[] = [];
  const lines = body.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineWithNL = li < lines.length - 1 ? line + "\n" : line;
    // 📍 address line
    if (line.startsWith("\u{1F4CD}") || line.startsWith("📍")) {
      const addr = line.replace(/^📍\s*/, "").trim();
      if (addr) {
        segments.push({ kind: "address", text: lineWithNL, address: addr });
        continue;
      }
    }
    // 📞 phone line
    if (line.startsWith("\u{1F4DE}") || line.startsWith("📞")) {
      const raw = line.replace(/^📞\s*/, "").trim();
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 10) {
        segments.push({ kind: "phone", text: lineWithNL, digits });
        continue;
      }
    }
    // 📅 date line — try to extract date and time
    if (line.startsWith("\u{1F4C5}") || line.startsWith("📅")) {
      const raw = line.replace(/^📅\s*/, "").trim();
      // Try to parse a date from the line (e.g. "Thursday, April 17, 2026" or "Today, 2:00 PM")
      const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
      const timeMatch = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (isoMatch) {
        const timeStr = timeMatch ? (() => {
          let h = parseInt(timeMatch[1]);
          const min = timeMatch[2];
          const ampm = timeMatch[3].toUpperCase();
          if (ampm === "PM" && h < 12) h += 12;
          if (ampm === "AM" && h === 12) h = 0;
          return `${String(h).padStart(2, "0")}:${min}`;
        })() : "09:00";
        segments.push({ kind: "date", text: lineWithNL, dateStr: isoMatch[0], timeStr });
        continue;
      }
    }
    // 🕐 time line — look for inline phone numbers
    const phoneRegex = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let hasPhone = false;
    while ((match = phoneRegex.exec(lineWithNL)) !== null) {
      hasPhone = true;
      if (match.index > lastIndex) {
        segments.push({ kind: "text", text: lineWithNL.slice(lastIndex, match.index) });
      }
      const digits = match[1].replace(/\D/g, "");
      segments.push({ kind: "phone", text: match[1], digits });
      lastIndex = match.index + match[1].length;
    }
    if (hasPhone) {
      if (lastIndex < lineWithNL.length) segments.push({ kind: "text", text: lineWithNL.slice(lastIndex) });
    } else {
      segments.push({ kind: "text", text: lineWithNL });
    }
  }
  return segments;
}

// ─── Template variable substitution ──────────────────────────────────────────
function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, val);
  }
  return result + LIME_OF_TIME_FOOTER;
}

// ─── Message types ────────────────────────────────────────────────────────────
interface Message {
  id: number;
  senderType: "client" | "business";
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ─── Template categories (for the "General" tab with non-appointment templates) ──
const GENERAL_TEMPLATE_CATEGORIES = [
  {
    label: "Cancellations",
    icon: "❌",
    templates: [
      { title: "Cancellation Confirmed", body: "Hi {name}! Your appointment has been cancelled as requested. We hope to see you again soon — feel free to book a new appointment anytime!" },
      { title: "Business Cancellation", body: "Hi {name}, we're sorry but we need to cancel your upcoming appointment due to an unforeseen circumstance. We sincerely apologize for the inconvenience and would love to reschedule at your earliest convenience." },
      { title: "Late Cancellation Policy", body: "Hi {name}, we noticed your appointment was cancelled within our late cancellation window. Our policy requires 24 hours notice. Please reach out if you have any questions." },
      { title: "No-Show Follow-Up", body: "Hi {name}, we missed you at your appointment today! We hope everything is okay. Please reach out if you'd like to reschedule." },
    ],
  },
  {
    label: "Rescheduling",
    icon: "🔄",
    templates: [
      { title: "Reschedule Request", body: "Hi {name}! We'd love to reschedule your appointment. Please let us know your availability and we'll find a time that works for you." },
      { title: "Reschedule Confirmed", body: "Hi {name}! Your appointment has been rescheduled. We've updated your booking and look forward to seeing you at the new time." },
      { title: "New Opening Available", body: "Hi {name}! We have a new opening available that might work for you. Would you like to book it? Just reply and we'll get you set up!" },
    ],
  },
  {
    label: "Follow-Up",
    icon: "⭐",
    templates: [
      { title: "Post-Service Thank You", body: "Hi {name}! Thank you for visiting us today. We hope you enjoyed your service! We'd love to hear your feedback — your satisfaction means everything to us." },
      { title: "Review Request", body: "Hi {name}! We hope you loved your recent visit. If you have a moment, we'd really appreciate a review — it helps us grow and serve you better. Thank you so much!" },
      { title: "Check-In", body: "Hi {name}! We just wanted to check in and see how you're doing after your recent visit. We hope everything went well!" },
    ],
  },
  {
    label: "Promotions",
    icon: "🎁",
    templates: [
      { title: "Special Offer", body: "Hi {name}! We have a special offer just for you. Reply to this message or book online to take advantage of this limited-time deal!" },
      { title: "Birthday Greeting", body: "Hi {name}! 🎂 Wishing you a wonderful birthday! As a special treat, we'd love to offer you a birthday discount on your next visit. Come celebrate with us!" },
      { title: "Loyalty Reward", body: "Hi {name}! You've been such a loyal client and we want to say thank you! You've earned a special reward — reach out to learn more." },
    ],
  },
  {
    label: "General",
    icon: "💬",
    templates: [
      { title: "Welcome", body: "Hi {name}! Welcome to our family! We're so excited to have you as a new client. Don't hesitate to reach out if you have any questions." },
      { title: "Thank You", body: "Hi {name}! Thank you so much for your continued support. We truly appreciate you and look forward to seeing you again soon!" },
      { title: "Payment Reminder", body: "Hi {name}! We noticed there's an outstanding balance on your account. Please reach out at your earliest convenience so we can get this sorted for you." },
    ],
  },
];
// ─── Rich message body renderer ──────────────────────────────────────────
function RichMessageBody({ body, textColor, linkColor, msgTitle }: { body: string; textColor: string; linkColor: string; msgTitle: string }) {
  const segments = useMemo(() => parseMessageSegments(body), [body]);
  // Find address segment for calendar use
  const addrSeg = segments.find((s): s is Extract<MsgSegment, { kind: "address" }> => s.kind === "address");

  return (
    <Text style={{ fontSize: 14, lineHeight: 20, color: textColor }}>
      {segments.map((seg, i) => {
        if (seg.kind === "phone") {
          return (
            <Text
              key={i}
              style={{ color: linkColor, textDecorationLine: "underline", fontWeight: "600" }}
              onPress={() => Linking.openURL(`tel:${seg.digits}`)}
            >
              {seg.text}
            </Text>
          );
        }
        if (seg.kind === "address") {
          return (
            <Text
              key={i}
              style={{ color: linkColor, textDecorationLine: "underline", fontWeight: "600" }}
              onPress={() => Linking.openURL(getMapUrl(seg.address))}
            >
              {seg.text}
            </Text>
          );
        }
        if (seg.kind === "date") {
          return (
            <Text
              key={i}
              style={{ color: linkColor, textDecorationLine: "underline", fontWeight: "600" }}
              onPress={() => addDateToCalendar(seg.dateStr, seg.timeStr, msgTitle, addrSeg?.address)}
            >
              {seg.text}
            </Text>
          );
        }
        return <Text key={i} style={{ color: textColor }}>{seg.text}</Text>;
      })}
    </Text>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────────
export default function ClientMessageThreadBusinessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, getServiceById, getLocationById } = useStore();
  const { clientAccountId, clientName, clientAvatarUrl: paramAvatarUrl, clientId } = useLocalSearchParams<{
    clientAccountId: string;
    clientName: string;
    clientAvatarUrl?: string;
    clientId?: string;
  }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(paramAvatarUrl || null);

  // Template picker state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateTab, setTemplateTab] = useState<"reminders" | "general">("reminders");
  const [selectedGeneralCategory, setSelectedGeneralCategory] = useState(0);
  // Appointment selector for reminder templates
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Client appointments from store (for template context) ─────────────────
  const clientAppointments = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    // Primary match: by clientId (local ID)
    // Fallback: by client name lookup (in case clientId wasn't passed or doesn't match)
    let matchingClientIds: Set<string>;
    if (clientId) {
      matchingClientIds = new Set([clientId as string]);
      // Also find any clients with the same name (for web-booked clients with different IDs)
      const nameMatch = state.clients.filter((c) => c.name === clientName);
      nameMatch.forEach((c) => matchingClientIds.add(c.id));
    } else {
      // No clientId — match by name
      const nameMatch = state.clients.filter((c) => c.name === clientName);
      matchingClientIds = new Set(nameMatch.map((c) => c.id));
    }
    if (matchingClientIds.size === 0) return [];
    return state.appointments
      .filter((a) => matchingClientIds.has(a.clientId) && (a.status === "confirmed" || a.status === "pending" || a.status === "completed"))
      .sort((a, b) => {
        // Upcoming first, then past
        const aFuture = a.date >= todayStr;
        const bFuture = b.date >= todayStr;
        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;
        if (aFuture) return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
        return b.date.localeCompare(a.date) || b.time.localeCompare(a.time);
      })
      .slice(0, 10); // show at most 10
  }, [clientId, state.appointments]);

  // Auto-select the next upcoming appointment when the picker opens
  useEffect(() => {
    if (showTemplates && clientAppointments.length > 0 && !selectedApptId) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const next = clientAppointments.find((a) => a.date >= todayStr) ?? clientAppointments[0];
      setSelectedApptId(next.id);
    }
  }, [showTemplates, clientAppointments, selectedApptId]);

  // ── Reminder templates from store — deduplicated, grouped by category ──────
  const allReminderTemplates: ReminderTemplate[] = useMemo(() => {
    const stored = state.reminderTemplates ?? [];
    // Priority: user-saved templates first, then library templates
    // Deduplicate: if a user saved a library template (same id), skip the library copy
    // Also deduplicate by customMessage content to avoid near-identical entries
    const seen = new Set<string>();
    const seenContent = new Set<string>();
    const result: ReminderTemplate[] = [];
    for (const t of [...stored, ...TEMPLATE_LIBRARY]) {
      if (seen.has(t.id)) continue;
      const contentKey = (t.customMessage ?? "").trim().slice(0, 80);
      if (contentKey && seenContent.has(contentKey)) continue;
      seen.add(t.id);
      if (contentKey) seenContent.add(contentKey);
      result.push(t);
    }
    return result;
  }, [state.reminderTemplates]);

  // Filter reminder templates by selected appointment status
  const reminderTemplates: ReminderTemplate[] = useMemo(() => {
    const selectedAppt = clientAppointments.find((a) => a.id === selectedApptId);
    if (!selectedAppt) return allReminderTemplates;
    const status = selectedAppt.status as string;
    const allowedCategories = STATUS_TEMPLATE_CATEGORIES[status];
    if (!allowedCategories) return allReminderTemplates;
    return allReminderTemplates.filter(
      (t) => !t.category || allowedCategories.includes(t.category as TemplateCategory)
    );
  }, [allReminderTemplates, clientAppointments, selectedApptId]);

  // Group reminder templates by category for the picker
  const REMINDER_CATEGORY_ORDER: TemplateCategory[] = ["upcoming", "confirmed", "pending", "completed", "cancelled", "no_show", "reschedule"];
  const REMINDER_CATEGORY_ICONS: Record<TemplateCategory, string> = {
    upcoming:  "⏰",
    confirmed: "✅",
    pending:   "🕐",
    completed: "⭐",
    cancelled: "❌",
    no_show:   "🚫",
    reschedule:"🔄",
  };
  const REMINDER_CATEGORY_LABELS: Record<TemplateCategory, string> = {
    upcoming:   "Upcoming Reminders",
    confirmed:  "Booking Confirmations",
    pending:    "Pending / Awaiting",
    completed:  "Follow-up & Reviews",
    cancelled:  "Cancellations",
    no_show:    "No-Show",
    reschedule: "Reschedule",
  };
  const groupedReminderTemplates = useMemo(() => {
    const groups: { cat: TemplateCategory; label: string; icon: string; templates: ReminderTemplate[] }[] = [];
    const uncategorized: ReminderTemplate[] = [];
    const byCategory: Partial<Record<TemplateCategory, ReminderTemplate[]>> = {};
    for (const t of reminderTemplates) {
      const cat = t.category as TemplateCategory | undefined;
      if (!cat) { uncategorized.push(t); continue; }
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat]!.push(t);
    }
    for (const cat of REMINDER_CATEGORY_ORDER) {
      const templates = byCategory[cat];
      if (templates && templates.length > 0) {
        groups.push({ cat, label: REMINDER_CATEGORY_LABELS[cat], icon: REMINDER_CATEGORY_ICONS[cat], templates });
      }
    }
    if (uncategorized.length > 0) {
      groups.push({ cat: "upcoming" as TemplateCategory, label: "Custom Templates", icon: "✏️", templates: uncategorized });
    }
    return groups;
  }, [reminderTemplates]);

  // ── Build template variables for the selected appointment ─────────────────
  const buildTplVars = useCallback((appt: Appointment): Record<string, string> => {
    const client = state.clients.find((c) => c.id === appt.clientId);
    // Use clientName from route params as fallback if client not in local store
    const resolvedClientName = client?.name ?? (clientName as string) ?? "there";
    const svc = getServiceById(appt.serviceId);
    const assignedLocation = appt.locationId ? getLocationById(appt.locationId) : null;
    const biz = state.settings;
    const profile = biz.profile ?? {};
    const primarySvcName = svc ? getServiceDisplayName(svc) : "your appointment";
    const locPhone = assignedLocation?.phone || profile.phone || "";
    const locCity = assignedLocation?.city ?? profile.city ?? "";
    const locState = assignedLocation?.state ?? profile.state ?? "";
    const locZip = assignedLocation?.zipCode ?? profile.zipCode ?? "";
    const addr = assignedLocation?.address || profile.address || "";
    const locName = assignedLocation?.name;
    const locId = assignedLocation?.id;
    const slug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
    const fullAddrStr = formatFullAddress(addr, locCity, locState, locZip);
    const locLine = locName ? (fullAddrStr ? `${locName} — ${fullAddrStr}` : locName) : fullAddrStr;
    const bookUrl = locId ? `${PUBLIC_BOOKING_URL}/book/${slug}?location=${locId}` : `${PUBLIC_BOOKING_URL}/book/${slug}`;
    const reviewUrl = `${PUBLIC_BOOKING_URL}/review/${slug}`;

    // Multi-service expansion
    const extraServiceItems = (appt.extraItems ?? []).filter((e) => e.type === "service");
    const hasMultiService = extraServiceItems.length > 0;
    let serviceName: string;
    let timeDisplay: string;
    let totalPrice: string;

    if (hasMultiService) {
      const startMins = timeToMinutes(appt.time);
      const primaryDuration = svc?.duration ?? appt.duration;
      const serviceLines: string[] = [];
      const primaryEnd = minutesToTime(startMins + primaryDuration);
      const primaryPrice = svc?.price ?? 0;
      serviceLines.push(`• ${primarySvcName} (${primaryDuration} min) ${formatTimeDisplay(minutesToTime(startMins))}–${formatTimeDisplay(primaryEnd)} — $${Number(primaryPrice).toFixed(2)}`);
      let cursor = startMins + primaryDuration;
      for (const item of extraServiceItems) {
        const itemEnd = minutesToTime(cursor + item.duration);
        serviceLines.push(`• ${item.name} (${item.duration} min) ${formatTimeDisplay(minutesToTime(cursor))}–${formatTimeDisplay(itemEnd)} — $${item.price.toFixed(2)}`);
        cursor += item.duration;
      }
      serviceName = serviceLines.join("\n");
      timeDisplay = `${formatTimeDisplay(appt.time)}–${formatTimeDisplay(minutesToTime(cursor))}`;
      const rawTotal = appt.totalPrice ?? (Number(svc?.price ?? 0) + extraServiceItems.reduce((s, e) => s + e.price, 0));
      totalPrice = `$${rawTotal.toFixed(2)}`;
    } else {
      serviceName = primarySvcName;
      timeDisplay = formatTimeDisplay(appt.time);
      totalPrice = appt.totalPrice != null ? `$${appt.totalPrice.toFixed(2)}` : (svc ? `$${Number(svc.price).toFixed(2)}` : "");
    }

    const priceLine = buildPriceLine({
      totalPrice: appt.totalPrice,
      discountAmount: appt.discountAmount,
      discountName: appt.discountName,
      giftUsedAmount: appt.giftUsedAmount,
      paymentStatus: appt.paymentStatus,
    });

    return {
      clientName: resolvedClientName,
      name: resolvedClientName,
      businessName: biz.businessName,
      serviceName,
      service: serviceName,
      duration: String(appt.duration),
      date: formatDateLong(appt.date),
      time: timeDisplay,
      price: totalPrice,
      total: totalPrice,
      priceLine,
      location: locLine,
      phone: formatPhoneNumber(stripPhoneFormat(locPhone)),
      clientPhone: client?.phone ?? "",
      bookingUrl: bookUrl,
      reviewUrl,
    };
  }, [state.clients, state.settings, getServiceById, getLocationById, clientName]);

  // ── Messages API ──────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiCall<any>(`/api/business/messages/${clientAccountId}`);
      const msgs: Message[] = Array.isArray(data) ? data : (data?.messages ?? []);
      setMessages(msgs);
      if (data?.clientAvatarUrl) setAvatarUrl(data.clientAvatarUrl);
    } catch (err: any) {
      if (!silent) setError(err?.message ?? "Failed to load messages");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [clientAccountId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
      pollRef.current = setInterval(() => loadMessages(true), 10_000);
      return () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };
    }, [loadMessages])
  );

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    const optimistic: Message = {
      id: Date.now(),
      senderType: "business",
      senderName: "You",
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      await apiCall(`/api/business/messages/${clientAccountId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      await loadMessages(true);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [draft, sending, clientAccountId, loadMessages]);

  // ── Delete message ───────────────────────────────────────────────────────
  const handleDeleteMessage = useCallback((msg: Message) => {
    Alert.alert(
      "Delete Message",
      "This message will be removed from your view only. The client will still see it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // Optimistically remove from UI
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            try {
              await apiCall(`/api/business/messages/${clientAccountId}/${msg.id}`, { method: "DELETE" });
            } catch {
              // Restore on failure
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.createdAt > msg.createdAt);
                const copy = [...prev];
                if (idx === -1) copy.push(msg); else copy.splice(idx, 0, msg);
                return copy;
              });
            }
          },
        },
      ]
    );
  }, [clientAccountId]);
  // ── Template selection ────────────────────────────────────────────────────
  const handleSelectReminderTemplate = useCallback((tpl: ReminderTemplate) => {
    if (!tpl.customMessage) return;
    const selectedAppt = clientAppointments.find((a) => a.id === selectedApptId);
    let filled: string;
    if (selectedAppt) {
      // buildTplVars always returns a vars object now (never null)
      const vars = buildTplVars(selectedAppt);
      filled = applyTemplate(tpl.customMessage, vars);
    } else {
      const firstName = (clientName ?? "there").split(" ")[0];
      filled = applyTemplate(tpl.customMessage, { clientName: firstName, name: firstName });
    }
    setDraft(filled);
    setShowTemplates(false);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [clientAppointments, selectedApptId, clientName, buildTplVars]);

  const handleSelectGeneralTemplate = useCallback((body: string) => {
    const firstName = (clientName ?? "there").split(" ")[0];
    const filled = body.replace(/\{name\}/g, firstName) + LIME_OF_TIME_FOOTER;
    setDraft(filled);
    setShowTemplates(false);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [clientName]);

  // ── List data ─────────────────────────────────────────────────────────────
  const listData = React.useMemo(() => {
    const items: Array<{ type: "date"; label: string; key: string } | (Message & { type: "message" })> = [];
    let lastDay = "";
    for (const msg of messages) {
      const day = formatDay(msg.createdAt);
      if (day !== lastDay) {
        items.push({ type: "date", label: day, key: `date-${day}` });
        lastDay = day;
      }
      items.push({ ...msg, type: "message" });
    }
    return items;
  }, [messages]);

  const s = makeStyles(colors);

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-background">
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
      <View style={[s.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [s.backBtn, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.right" size={16} color={colors.foreground} style={{ transform: [{ scaleX: -1 }] }} />
        </Pressable>
        <View style={[s.headerAvatar, { backgroundColor: colors.primary + "25", overflow: "hidden" }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={{ width: 38, height: 38, borderRadius: 19 }} resizeMode="cover" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>
              {getInitials(clientName ?? "C")}
            </Text>
          )}
        </View>
        <View style={s.headerInfo}>
          <Text style={[s.headerName, { color: colors.foreground }]} numberOfLines={1}>{clientName ?? "Client"}</Text>
          <Text style={[s.headerSub, { color: colors.muted }]}>Message thread</Text>
        </View>
        <Pressable
          style={({ pressed }) => [s.templateBtn, { backgroundColor: colors.primary + "20", opacity: pressed ? 0.7 : 1 }]}
          onPress={() => { setShowTemplates(true); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Text style={{ fontSize: 16 }}>⚡</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={s.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : error ? (
          <View style={s.errorContainer}>
            <Text style={{ fontSize: 32 }}>⚠️</Text>
            <Text style={[s.emptyText, { color: colors.muted }]}>{error}</Text>
            <Pressable style={({ pressed }) => [s.retryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]} onPress={() => loadMessages()}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={listData}
            keyExtractor={(item) => item.type === "date" ? item.key : String(item.id)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
            ListEmptyComponent={
              <View style={s.emptyContainer}>
                <Text style={{ fontSize: 32 }}>💬</Text>
                <Text style={[s.emptyText, { color: colors.muted }]}>No messages yet. Start the conversation!</Text>
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === "date") {
                return (
                  <View style={s.dateSeparator}>
                    <View style={[s.dateLine, { backgroundColor: colors.border }]} />
                    <Text style={[s.dateLabel, { color: colors.muted, backgroundColor: colors.background }]}>{(item as any).label}</Text>
                    <View style={[s.dateLine, { backgroundColor: colors.border }]} />
                  </View>
                );
              }
              const msg = item as Message & { type: "message" };
              const isBusiness = msg.senderType === "business";
              return (
                <View style={[s.msgRow, isBusiness ? s.msgRowRight : s.msgRowLeft]}>
                  {!isBusiness && (
                    <View style={[s.msgAvatar, { backgroundColor: colors.primary + "25", overflow: "hidden" }]}>
                      {avatarUrl ? (
                        <Image source={{ uri: avatarUrl }} style={{ width: 28, height: 28, borderRadius: 14 }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{(clientName ?? "C").charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                  )}
                  <Pressable
                    onLongPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      Alert.alert(
                        "Message Options",
                        undefined,
                        [
                          {
                            text: "📋 Copy Text",
                            onPress: () => {
                              const { Clipboard } = require("@react-native-clipboard/clipboard") as any;
                              if (Clipboard?.setString) { Clipboard.setString(msg.body); }
                              else { require("react-native").Clipboard?.setString?.(msg.body); }
                            },
                          },
                          {
                            text: "🗑 Delete",
                            style: "destructive",
                            onPress: () => handleDeleteMessage(msg),
                          },
                          { text: "Cancel", style: "cancel" },
                        ]
                      );
                    }}
                    delayLongPress={400}
                    style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
                  >
                    <View style={[s.msgBubble, isBusiness ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 } : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 }]}>
                      <RichMessageBody body={msg.body} textColor={isBusiness ? "#FFFFFF" : colors.foreground} linkColor={isBusiness ? "rgba(255,255,255,0.9)" : colors.primary} msgTitle={clientName ?? "Appointment"} />
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[s.msgTime, { color: isBusiness ? "rgba(255,255,255,0.6)" : colors.muted }]}>
                          {formatTime(msg.createdAt)}
                        </Text>
                        {isBusiness && (
                          <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: -1.5, color: msg.readAt ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)" }}>
                            {msg.readAt ? "✓✓" : "✓"}
                          </Text>
                        )}
                      </View>
                    </View>
                  </Pressable>
                </View>
              );
            }}
          />
        )}
        <View style={[s.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={s.inputRow}>
            {/* ⚡ Template button */}
            <Pressable
              style={({ pressed }) => [s.templateIconBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              onPress={() => { setShowTemplates(true); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Text style={{ fontSize: 18 }}>⚡</Text>
            </Pressable>
            {/* Text input - grows up to 5 lines */}
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Reply to client..."
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={1000}
              returnKeyType="default"
              textAlignVertical="top"
            />
            {/* Send button */}
            <Pressable
              style={({ pressed }) => [s.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.border }, pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] }]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />}
            </Pressable>
          </View>
        </View>
      </View>

      </KeyboardAvoidingView>

      {/* ── Template Picker Modal ─────────────────────────────────────────── */}
      <Modal visible={showTemplates} animationType="slide" transparent onRequestClose={() => setShowTemplates(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowTemplates(false)} />
        <View style={[s.templateSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {/* Header */}
          <View style={[s.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>⚡ Templates</Text>
            <Pressable style={({ pressed }) => [s.closeBtn, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]} onPress={() => setShowTemplates(false)}>
              <Text style={{ fontSize: 14, color: colors.muted }}>✕</Text>
            </Pressable>
          </View>

          {/* Tab bar: Reminders | General */}
          <View style={[s.tabBar, { borderBottomColor: colors.border }]}>
            <Pressable
              style={[s.tab, templateTab === "reminders" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
              onPress={() => setTemplateTab("reminders")}
            >
              <Text style={[s.tabLabel, { color: templateTab === "reminders" ? colors.primary : colors.muted }]}>📋 Reminders</Text>
            </Pressable>
            <Pressable
              style={[s.tab, templateTab === "general" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
              onPress={() => setTemplateTab("general")}
            >
              <Text style={[s.tabLabel, { color: templateTab === "general" ? colors.primary : colors.muted }]}>💬 General</Text>
            </Pressable>
          </View>

          {templateTab === "reminders" ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
              {/* Appointment selector */}
              {clientAppointments.length > 0 ? (
                <View style={{ gap: 8 }}>
                  <Text style={[s.sectionLabel, { color: colors.muted }]}>Select appointment to fill template:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {clientAppointments.map((appt) => {
                      const svc = getServiceById(appt.serviceId);
                      const svcName = svc ? getServiceDisplayName(svc) : "Appointment";
                      const isSelected = appt.id === selectedApptId;
                      const todayStr = new Date().toISOString().slice(0, 10);
                      const isFuture = appt.date >= todayStr;
                      return (
                        <Pressable
                          key={appt.id}
                          onPress={() => setSelectedApptId(appt.id)}
                          style={({ pressed }) => [{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 12,
                            borderWidth: 1.5,
                            borderColor: isSelected ? colors.primary : colors.border,
                            backgroundColor: isSelected ? colors.primary + "15" : colors.surface,
                            opacity: pressed ? 0.8 : 1,
                            minWidth: 140,
                          }]}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "700", color: isSelected ? colors.primary : colors.foreground }} numberOfLines={1}>{svcName}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{appt.date} · {formatTimeDisplay(appt.time)}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isFuture ? colors.success : colors.muted }} />
                            <Text style={{ fontSize: 10, color: isFuture ? colors.success : colors.muted }}>{appt.status}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : (
                <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.surface }}>
                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>No appointments found for this client. Templates will use client name only.</Text>
                </View>
              )}
              {/* Reminder templates — grouped by category */}
              {groupedReminderTemplates.length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", paddingVertical: 20 }}>No templates available. Add templates in Settings → Reminder Templates.</Text>
              ) : (
                groupedReminderTemplates.map((group) => (
                  <View key={group.cat + group.label} style={{ gap: 8 }}>
                    {/* Category header */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <Text style={{ fontSize: 15 }}>{group.icon}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.6, flex: 1 }}>{group.label}</Text>
                      <View style={{ backgroundColor: colors.primary + "20", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{group.templates.length}</Text>
                      </View>
                    </View>
                    <View style={{ width: "100%", height: 1, backgroundColor: colors.border, marginBottom: 4 }} />
                    {group.templates.map((tpl) => (
                  <Pressable
                    key={tpl.id}
                    style={({ pressed }) => [s.templateCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => handleSelectReminderTemplate(tpl)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <Text style={[s.templateTitle, { color: colors.primary }]}>{tpl.label}</Text>
                      <View style={[s.useBtn, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>Use</Text>
                      </View>
                    </View>
                    <Text style={[s.templateBody, { color: colors.muted }]} numberOfLines={3}>
                      {(tpl.customMessage ?? "").slice(0, 120)}{(tpl.customMessage ?? "").length > 120 ? "…" : ""}
                    </Text>
                  </Pressable>
                    ))}
                  </View>
                ))
              )}
            </ScrollView>
          ) : (
            <>
              {/* General category chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.categoryScroll, { borderBottomColor: colors.border }]} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}>
                {GENERAL_TEMPLATE_CATEGORIES.map((cat, idx) => (
                  <Pressable
                    key={cat.label}
                    style={({ pressed }) => [s.categoryChip, { backgroundColor: selectedGeneralCategory === idx ? colors.primary : colors.surface, borderColor: selectedGeneralCategory === idx ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { setSelectedGeneralCategory(idx); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={{ fontSize: 14 }}>{cat.icon}</Text>
                    <Text style={[s.categoryLabel, { color: selectedGeneralCategory === idx ? "#fff" : colors.foreground }]}>{cat.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
                {GENERAL_TEMPLATE_CATEGORIES[selectedGeneralCategory].templates.map((tpl, idx) => (
                  <Pressable
                    key={idx}
                    style={({ pressed }) => [s.templateCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => handleSelectGeneralTemplate(tpl.body)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <Text style={[s.templateTitle, { color: colors.primary }]}>{tpl.title}</Text>
                      <View style={[s.useBtn, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>Use</Text>
                      </View>
                    </View>
                    <Text style={[s.templateBody, { color: colors.muted }]} numberOfLines={3}>
                      {tpl.body.replace(/\{name\}/g, (clientName ?? "there").split(" ")[0])}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
    backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    headerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    headerInfo: { flex: 1 },
    headerName: { fontSize: 15, fontWeight: "700" },
    headerSub: { fontSize: 11 },
    templateBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
    retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
    emptyContainer: { alignItems: "center", paddingTop: 60, gap: 12 },
    emptyText: { fontSize: 14, textAlign: "center", maxWidth: 240 },
    dateSeparator: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 12 },
    dateLine: { flex: 1, height: 1 },
    dateLabel: { fontSize: 12, fontWeight: "600", paddingHorizontal: 8 },
    msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 8, gap: 8 },
    msgRowLeft: { justifyContent: "flex-start" },
    msgRowRight: { justifyContent: "flex-end" },
    msgAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    msgBubble: { maxWidth: "75%", borderRadius: 16, padding: 10, gap: 4 },
    msgBody: { fontSize: 14, lineHeight: 20 },
    msgTime: { fontSize: 10, alignSelf: "flex-end" },
    inputBar: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    inputActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
    templateIconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, flexShrink: 0 },
    input: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 15, minHeight: 38, maxHeight: 120, textAlignVertical: "top" },
    sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    modalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
    templateSheet: { position: "absolute", bottom: 0, left: 0, right: 0, height: "80%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" },
    sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
    sheetTitle: { fontSize: 17, fontWeight: "700" },
    closeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    tabBar: { flexDirection: "row", borderBottomWidth: 1 },
    tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabLabel: { fontSize: 14, fontWeight: "600" },
    sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    categoryScroll: { borderBottomWidth: 1, paddingVertical: 12, flexGrow: 0 },
    categoryChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
    categoryLabel: { fontSize: 13, fontWeight: "600" },
    templateCard: { borderRadius: 14, padding: 14, borderWidth: 1 },
    templateTitle: { fontSize: 14, fontWeight: "700" },
    templateBody: { fontSize: 13, lineHeight: 19 },
    useBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  });
