import React from "react";
import { FlatList, Text, View, Pressable, StyleSheet, TextInput, Alert, Platform, ActivityIndicator, Image,
  ScrollView, Modal,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Client, Appointment, Location, formatPhoneNumber, stripPhoneFormat, LOCATION_COLORS, getServiceDisplayName, formatDateLong, formatTimeDisplay, PUBLIC_BOOKING_URL } from "@/lib/types";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { LocationSwitcher } from "@/components/location-switcher";
import * as Contacts from "expo-contacts";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { UpgradePlanSheet } from "@/components/upgrade-plan-sheet";
import { BirthdayPicker } from "@/components/birthday-picker";
import { apiCall } from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useFocusEffect } from "expo-router";

// ── Types ─────────────────────────────────────────────────────────────────────
interface MessageThread {
  clientAccountId: number;
  clientName: string;
  clientPhone: string | null;
  clientAvatarUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  senderType: "client" | "business";
}

// ── Client filter types ───────────────────────────────────────────────────────
type ClientFilter = "all" | "upcoming" | "pending" | "payment" | "completed";

const CLIENT_FILTERS: { key: ClientFilter; label: string; icon: string; color: string }[] = [
  { key: "all",       label: "All",        icon: "👥", color: "#6B7280" },
  { key: "upcoming",  label: "Upcoming",   icon: "📅", color: "#3B82F6" },
  { key: "pending",   label: "Pending",    icon: "🕐", color: "#F59E0B" },
  { key: "payment",   label: "Unpaid",     icon: "💳", color: "#EF4444" },
  { key: "completed", label: "Completed",  icon: "✅", color: "#10B981" },
];

// ── Action sheet per filter ───────────────────────────────────────────────────
interface FilterAction {
  key: string;
  label: string;
  icon: string;
  color: string;
  templateBody: string;
}

const FILTER_ACTIONS: Record<ClientFilter, FilterAction[]> = {
  all: [],
  upcoming: [
    {
      key: "reminder_24h",
      label: "Send 24h Reminder",
      icon: "⏰",
      color: "#3B82F6",
      templateBody: "Hi {name}! Just a reminder that your appointment is tomorrow.\n\n📋 Service: {service}\n📅 Date: {date}\n⏰ Time: {time}\n📍 Location: {location}\n\n🏢 {businessName}\n📞 {phone}\n\nPlease arrive 5 minutes early. If you need to reschedule, contact us right away.",
    },
    {
      key: "reminder_1h",
      label: "Send 1h Reminder",
      icon: "🔔",
      color: "#8B5CF6",
      templateBody: "Hi {name}! Your appointment is in 1 hour.\n\n📋 Service: {service}\n⏰ Time: {time}\n📍 Location: {location}\n\n🏢 {businessName}\n📞 {phone}\n\nWe look forward to seeing you shortly!",
    },
  ],
  pending: [
    {
      key: "pending_confirm",
      label: "Request Confirmation",
      icon: "✅",
      color: "#F59E0B",
      templateBody: "Hi {name}! We wanted to follow up on your appointment request.\n\n📋 Service: {service}\n📅 Date: {date}\n⏰ Time: {time}\n\n🏢 {businessName}\n📞 {phone}\n\nPlease confirm your appointment or let us know if you need to reschedule.",
    },
    {
      key: "pending_reschedule",
      label: "Offer to Reschedule",
      icon: "🔄",
      color: "#6B7280",
      templateBody: "Hi {name}! We noticed your appointment request is still pending. We'd love to help you find a time that works!\n\n📅 Book online: {bookingUrl}\n\n🏢 {businessName}\n📞 {phone}",
    },
  ],
  payment: [
    {
      key: "payment_reminder",
      label: "Send Payment Reminder",
      icon: "💰",
      color: "#EF4444",
      templateBody: "Hi {name}! We noticed there's an outstanding balance for your recent appointment.\n\n📋 Service: {service}\n📅 Date: {date}\n\nPlease reach out at your earliest convenience so we can get this sorted for you.\n\n🏢 {businessName}\n📞 {phone}",
    },
    {
      key: "payment_link",
      label: "Send Payment Link",
      icon: "🔗",
      color: "#635BFF",
      templateBody: "Hi {name}! Here is your secure payment link for your recent appointment.\n\n📋 Service: {service}\n📅 Date: {date}\n{priceLine}\n\nPlease complete your payment at your earliest convenience.\n\n🏢 {businessName}\n📞 {phone}",
    },
  ],
  completed: [
    {
      key: "review_request",
      label: "Request a Review",
      icon: "⭐",
      color: "#F59E0B",
      templateBody: "Hi {name}! Thank you so much for your recent visit! We hope you loved your {service}.\n\nIf you have a moment, we'd truly appreciate a review — it helps us grow and serve you better.\n\n⭐ Leave a review: {reviewUrl}\n\n🏢 {businessName}\n📞 {phone}\n\nThank you for your continued support! 💛",
    },
    {
      key: "come_back_soon",
      label: "Come Back Soon",
      icon: "💅",
      color: "#10B981",
      templateBody: "Hi {name}! We hope you're loving your {service} results! 💛\n\nIt's been a little while since your last visit and we'd love to see you again. Book your next appointment anytime:\n\n📅 Book online: {bookingUrl}\n\n🏢 {businessName}\n📞 {phone}\n\nWe can't wait to see you again!",
    },
    {
      key: "rebooking_nudge",
      label: "Rebooking Nudge",
      icon: "🔁",
      color: "#8B5CF6",
      templateBody: "Hi {name}! Your last {service} was amazing and we'd love to keep the momentum going! Ready to book your next appointment?\n\n📅 Book online: {bookingUrl}\n\n🏢 {businessName}\n📞 {phone}",
    },
  ],
};

export default function ClientsScreen() {
  const { state, dispatch, getReviewsForClient, getAppointmentsForClient, syncToDb, clientsForActiveLocation, filterAppointmentsByLocation, getServiceById, getLocationById } = useStore();
  const { hasMultipleLocations } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, isLargeTablet, hp, maxContentWidth, modalMaxWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { checkLimit } = usePlanLimitCheck();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<"clients" | "messages">(tabParam === "messages" ? "messages" : "clients");
  useEffect(() => {
    if (tabParam === "messages") setActiveTab("messages");
  }, [tabParam]);

  // ── Client filter state ───────────────────────────────────────────────────
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");

  // ── Clients tab state ─────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"name" | "recent" | "appts">("name");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBirthday, setNewBirthday] = useState("");
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeSheetInfo, setUpgradeSheetInfo] = useState<{ planKey: string; planName: string; limit: number } | null>(null);

  // ── Action sheet state ────────────────────────────────────────────────────
  const [actionSheetClient, setActionSheetClient] = useState<{ client: Client; appt: Appointment | null } | null>(null);

  // ── Messages tab state ────────────────────────────────────────────────────
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [messageSearch, setMessageSearch] = useState("");

  const loadThreads = useCallback(async () => {
    const token = await Auth.getSessionToken();
    if (!token) return;
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const data = await apiCall<{ inbox: MessageThread[] }>("/api/business/messages");
      setThreads(data.inbox ?? []);
    } catch (err: any) {
      const isSessionError =
        err?.message?.includes("Invalid session") ||
        err?.message?.includes("Unauthorized") ||
        err?.message?.includes("401");
      setThreadsError(isSessionError ? "session_expired" : "Could not load messages");
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (activeTab === "messages") {
        loadThreads();
      }
    }, [activeTab, loadThreads])
  );

  useEffect(() => {
    if (activeTab === "messages") {
      loadThreads();
    }
  }, [activeTab]);

  // ── Per-client appointment helpers ────────────────────────────────────────
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  /** Returns the most relevant appointment for a client given the current filter */
  const getRelevantAppt = useCallback((clientId: string): Appointment | null => {
    const appts = filterAppointmentsByLocation(getAppointmentsForClient(clientId));
    if (clientFilter === "upcoming") {
      return appts
        .filter((a) => (a.status === "confirmed" || a.status === "pending") && a.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0] ?? null;
    }
    if (clientFilter === "pending") {
      return appts
        .filter((a) => a.status === "pending")
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    }
    if (clientFilter === "payment") {
      return appts
        .filter((a) => (a.paymentStatus === "unpaid" || !a.paymentStatus) && (a.totalPrice ?? 0) > 0 && a.status !== "cancelled")
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    }
    if (clientFilter === "completed") {
      return appts
        .filter((a) => a.status === "completed")
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    }
    return null;
  }, [clientFilter, filterAppointmentsByLocation, getAppointmentsForClient, todayStr]);

  /** Returns true if a client matches the current filter */
  const clientMatchesFilter = useCallback((clientId: string): boolean => {
    if (clientFilter === "all") return true;
    const appts = filterAppointmentsByLocation(getAppointmentsForClient(clientId));
    if (clientFilter === "upcoming") {
      return appts.some((a) => (a.status === "confirmed" || a.status === "pending") && a.date >= todayStr);
    }
    if (clientFilter === "pending") {
      return appts.some((a) => a.status === "pending");
    }
    if (clientFilter === "payment") {
      return appts.some((a) => (a.paymentStatus === "unpaid" || !a.paymentStatus) && (a.totalPrice ?? 0) > 0 && a.status !== "cancelled");
    }
    if (clientFilter === "completed") {
      return appts.some((a) => a.status === "completed");
    }
    return true;
  }, [clientFilter, filterAppointmentsByLocation, getAppointmentsForClient, todayStr]);

  // ── Clients helpers ───────────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = clientsForActiveLocation.filter(
      (c) =>
        (c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.email.toLowerCase().includes(q)) &&
        clientMatchesFilter(c.id)
    );
    if (sortOrder === "name") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOrder === "recent") {
      return [...filtered].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    } else {
      return [...filtered].sort((a, b) => filterAppointmentsByLocation(getAppointmentsForClient(b.id)).length - filterAppointmentsByLocation(getAppointmentsForClient(a.id)).length);
    }
  }, [clientsForActiveLocation, search, sortOrder, filterAppointmentsByLocation, getAppointmentsForClient, clientMatchesFilter]);

  const getLocationApptCount = useCallback(
    (clientId: string) => filterAppointmentsByLocation(getAppointmentsForClient(clientId)).length,
    [filterAppointmentsByLocation, getAppointmentsForClient]
  );

  const getClientLocationBadges = useCallback(
    (clientId: string) => {
      const appts = getAppointmentsForClient(clientId);
      const locationIds = [...new Set(appts.map((a) => a.locationId).filter(Boolean) as string[])];
      return locationIds
        .map((lid) => state.locations.find((l) => l.id === lid))
        .filter(Boolean) as import("@/lib/types").Location[];
    },
    [getAppointmentsForClient, state.locations]
  );

  const handlePhoneChange = useCallback((text: string) => {
    setNewPhone(formatPhoneNumber(text));
  }, []);

  const handleAddClient = useCallback(() => {
    if (!newName.trim()) return;
    const limitInfo = checkLimit("clients");
    if (!limitInfo.allowed) {
      setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
      setUpgradeSheetVisible(true);
      return;
    }
    const client: Client = {
      id: generateId(),
      name: newName.trim(),
      phone: newPhone.trim(),
      email: newEmail.trim(),
      notes: "",
      birthday: newBirthday.trim(),
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_CLIENT", payload: client });
    syncToDb({ type: "ADD_CLIENT", payload: client });
    setNewName(""); setNewPhone(""); setNewEmail(""); setNewBirthday("");
    setShowAdd(false);
  }, [newName, newPhone, newEmail, newBirthday, dispatch, syncToDb]);

  const handleSelectFromContacts = useCallback(async () => {
    const limitInfo = checkLimit("clients");
    if (!limitInfo.allowed) {
      setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
      setUpgradeSheetVisible(true);
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Contact import is only available on mobile devices.");
      return;
    }
    try {
      if (Platform.OS === "android") {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Denied", "Please allow access to contacts in your device settings.");
          return;
        }
      }
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      const name = contact.name || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
      if (!name) { Alert.alert("Invalid Contact", "The selected contact has no name."); return; }
      const exists = state.clients.some((c) => c.name.toLowerCase() === name.toLowerCase());
      if (exists) { Alert.alert("Already Added", `${name} is already in your client list.`); return; }
      const phone = contact.phoneNumbers?.[0]?.number ?? "";
      const email = contact.emails?.[0]?.email ?? "";
      const formattedPhone = phone ? formatPhoneNumber(stripPhoneFormat(phone)) : "";
      const client: Client = { id: generateId(), name, phone: formattedPhone, email, notes: "Imported from contacts", birthday: "", createdAt: new Date().toISOString() };
      dispatch({ type: "ADD_CLIENT", payload: client });
      syncToDb({ type: "ADD_CLIENT", payload: client });
      Alert.alert("Added", `${name} has been added as a client.`);
    } catch {
      Alert.alert("Error", "Failed to access contacts. Please try again.");
    }
  }, [state.clients, dispatch, syncToDb]);

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getExpireBadge = (birthday: string | undefined): { label: string; color: string } | null => {
    if (!birthday) return null;
    const parts = birthday.split("/");
    if (parts.length < 3) return null;
    const [mm, dd, yyyy] = parts;
    const expDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (isNaN(expDate.getTime())) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0); expDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((expDate.getTime() - now.getTime()) / 86400000);
    if (diffDays < 0) return { label: "Expired", color: "#EF4444" };
    if (diffDays <= 7) return { label: "Expiring soon", color: "#F59E0B" };
    return null;
  };

  const getClientRating = (clientId: string): number | null => {
    const reviews = getReviewsForClient(clientId);
    if (reviews.length === 0) return null;
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return Math.round(avg * 10) / 10;
  };

  const formatRelativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // ── Build template variables for an appointment ───────────────────────────
  const buildMsgVars = useCallback((client: Client, appt: Appointment | null): Record<string, string> => {
    const firstName = client.name.split(" ")[0];
    const biz = state.settings;
    const profile = biz.profile ?? {};
    const slug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
    const bookingUrl = `${PUBLIC_BOOKING_URL}/book/${slug}`;
    const reviewUrl = `${PUBLIC_BOOKING_URL}/review/${slug}`;
    const bizPhone = formatPhoneNumber(stripPhoneFormat(profile.phone || ""));

    if (!appt) {
      return {
        name: firstName,
        clientName: firstName,
        businessName: biz.businessName,
        phone: bizPhone,
        bookingUrl,
        reviewUrl,
        service: "your service",
        date: "",
        time: "",
        location: profile.address || "",
        priceLine: "",
      };
    }

    const svc = getServiceById(appt.serviceId);
    const loc = appt.locationId ? getLocationById(appt.locationId) : null;
    const svcName = svc ? getServiceDisplayName(svc) : "your appointment";
    const locPhone = loc?.phone || profile.phone || "";
    const locAddr = loc?.address || profile.address || "";
    const locName = loc?.name;
    const locLine = locName ? (locAddr ? `${locName} — ${locAddr}` : locName) : locAddr;
    const totalPrice = appt.totalPrice != null ? `$${appt.totalPrice.toFixed(2)}` : (svc ? `$${Number(svc.price).toFixed(2)}` : "");
    const priceLine = totalPrice ? `💰 Total: ${totalPrice}` : "";

    return {
      name: firstName,
      clientName: firstName,
      businessName: biz.businessName,
      phone: formatPhoneNumber(stripPhoneFormat(locPhone)),
      bookingUrl: loc ? `${bookingUrl}?location=${loc.id}` : bookingUrl,
      reviewUrl,
      service: svcName,
      date: formatDateLong(appt.date),
      time: formatTimeDisplay(appt.time),
      location: locLine,
      priceLine,
    };
  }, [state.settings, getServiceById, getLocationById]);

  /** Apply template body with vars substitution */
  const applyMsgTemplate = useCallback((body: string, vars: Record<string, string>): string => {
    let result = body;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replaceAll(`{${k}}`, v);
    }
    return result;
  }, []);

  /** Handle tapping an action button for a client */
  const handleFilterAction = useCallback((client: Client, appt: Appointment | null, action: FilterAction) => {
    setActionSheetClient(null);
    const vars = buildMsgVars(client, appt);
    const body = applyMsgTemplate(action.templateBody, vars);

    // Navigate to messaging thread if client has portal account, otherwise open SMS
    router.push({
      pathname: "/client-message-thread-business" as any,
      params: {
        clientAccountId: "0", // will be resolved by the thread screen
        clientName: client.name,
        clientId: client.id,
        prefillMessage: body,
      },
    });
  }, [buildMsgVars, applyMsgTemplate, router]);

  // Total unread count for tab badge
  const totalUnread = threads.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);

  // Filtered threads for search
  const filteredThreads = useMemo(() => {
    if (!messageSearch.trim()) return threads;
    const q = messageSearch.trim().toLowerCase();
    return threads.filter(
      (t) =>
        t.clientName.toLowerCase().includes(q) ||
        t.lastMessage.toLowerCase().includes(q)
    );
  }, [threads, messageSearch]);

  // Filter counts for badges
  const filterCounts = useMemo(() => {
    const counts: Record<ClientFilter, number> = { all: 0, upcoming: 0, pending: 0, payment: 0, completed: 0 };
    for (const c of clientsForActiveLocation) {
      counts.all++;
      const appts = filterAppointmentsByLocation(getAppointmentsForClient(c.id));
      if (appts.some((a) => (a.status === "confirmed" || a.status === "pending") && a.date >= todayStr)) counts.upcoming++;
      if (appts.some((a) => a.status === "pending")) counts.pending++;
      if (appts.some((a) => (a.paymentStatus === "unpaid" || !a.paymentStatus) && (a.totalPrice ?? 0) > 0 && a.status !== "cancelled")) counts.payment++;
      if (appts.some((a) => a.status === "completed")) counts.completed++;
    }
    return counts;
  }, [clientsForActiveLocation, filterAppointmentsByLocation, getAppointmentsForClient, todayStr]);

  const activeFilterConfig = CLIENT_FILTERS.find((f) => f.key === clientFilter)!;
  const activeFilterActions = FILTER_ACTIONS[clientFilter];

  return (
    <ScreenContainer tabletMaxWidth={0}>
      <FuturisticBackground />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <View style={{ flex: 1, alignSelf: "center", width: "100%", maxWidth: maxContentWidth }}>
        <View style={{ paddingHorizontal: hp }}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: fs.xl, fontWeight: "700", color: colors.foreground }}>
                {activeTab === "clients" ? "Clients" : "Messages"}
              </Text>
              {activeTab === "clients" && hasMultipleLocations && <LocationSwitcher compact />}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {activeTab === "clients" && (
                <>
                  <Pressable
                    onPress={() => router.push("/birthday-campaigns")}
                    style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <IconSymbol name="birthday.cake" size={20} color="#FF9800" />
                  </Pressable>
                  <Pressable
                    onPress={handleSelectFromContacts}
                    style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <IconSymbol name="person.crop.circle.badge.plus" size={20} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setShowAdd(!showAdd)}
                    style={({ pressed }) => [styles.addButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <IconSymbol name="plus" size={20} color="#FFFFFF" />
                  </Pressable>
                </>
              )}
              {activeTab === "messages" && (
                <>
                  {totalUnread > 0 && (
                    <Pressable
                      onPress={async () => {
                        try {
                          await apiCall("/api/business/messages/mark-all-read", { method: "POST" });
                          loadThreads();
                        } catch {
                          // silently fail
                        }
                      }}
                      style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "50", opacity: pressed ? 0.7 : 1, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minWidth: 0 }]}
                    >
                      <IconSymbol name="checkmark.circle.fill" size={14} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontSize: fs.xs, fontWeight: "600" }}>Mark all read</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={loadThreads}
                    style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {/* Tab Switcher */}
          <View style={[styles.tabSwitcher, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(["clients", "messages"] as const).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={({ pressed }) => [
                  styles.tabBtn,
                  activeTab === tab && { backgroundColor: colors.primary },
                  { opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: activeTab === tab ? "#fff" : colors.muted }}>
                    {tab === "clients" ? "Clients" : "Messages"}
                  </Text>
                  {tab === "messages" && totalUnread > 0 && (
                    <View style={{ backgroundColor: activeTab === "messages" ? "rgba(255,255,255,0.3)" : colors.error, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>{totalUnread > 99 ? "99+" : totalUnread}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Clients Tab ─────────────────────────────────────────────────── */}
        {activeTab === "clients" && (
          <>
            <View style={{ paddingHorizontal: hp }}>
              {/* Smart filter chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
                {CLIENT_FILTERS.map((f) => {
                  const isActive = clientFilter === f.key;
                  const count = filterCounts[f.key];
                  return (
                    <Pressable
                      key={f.key}
                      onPress={() => setClientFilter(f.key)}
                      style={({ pressed }) => [{
                        flexDirection: "row" as const,
                        alignItems: "center" as const,
                        gap: 5,
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: isActive ? f.color : colors.border,
                        backgroundColor: isActive ? f.color + "18" : colors.surface,
                        opacity: pressed ? 0.8 : 1,
                      }]}
                    >
                      <Text style={{ fontSize: 13 }}>{f.icon}</Text>
                      <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isActive ? f.color : colors.muted }}>{f.label}</Text>
                      {count > 0 && (
                        <View style={{ backgroundColor: isActive ? f.color : colors.border, borderRadius: 8, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: isActive ? "#fff" : colors.muted }}>{count}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Action buttons for active filter */}
              {activeFilterActions.length > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {activeFilterConfig.icon} Quick Actions for {activeFilterConfig.label} Clients
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {activeFilterActions.map((action) => (
                      <Pressable
                        key={action.key}
                        onPress={() => {
                          // Show a note that user needs to select a client first
                          Alert.alert(
                            `${action.icon} ${action.label}`,
                            `Tap on a client below to send them a "${action.label}" message.`,
                            [{ text: "OK" }]
                          );
                        }}
                        style={({ pressed }) => [{
                          flexDirection: "row" as const,
                          alignItems: "center" as const,
                          gap: 6,
                          paddingHorizontal: 14,
                          paddingVertical: 9,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: action.color + "50",
                          backgroundColor: action.color + "12",
                          opacity: pressed ? 0.8 : 1,
                        }]}
                      >
                        <Text style={{ fontSize: 14 }}>{action.icon}</Text>
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: action.color }}>{action.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Search */}
              <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground }]}
                  placeholder={clientFilter === "all" ? "Search clients..." : `Search ${activeFilterConfig.label.toLowerCase()} clients...`}
                  placeholderTextColor={colors.muted}
                  value={search}
                  onChangeText={setSearch}
                  returnKeyType="done"
                />
              </View>
              {/* Sort chips */}
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
                {(["name", "recent", "appts"] as const).map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => setSortOrder(opt)}
                    style={({ pressed }) => ([
                      styles.sortChip,
                      { backgroundColor: sortOrder === opt ? colors.primary : colors.surface, borderColor: sortOrder === opt ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 },
                    ])}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: sortOrder === opt ? "#fff" : colors.muted }}>
                      {opt === "name" ? "A–Z" : opt === "recent" ? "Recent" : "Most Appts"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {/* Add Client Form */}
              {showAdd && (
                <View style={[styles.addForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>New Client</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} placeholder="Full Name *" placeholderTextColor={colors.muted} value={newName} onChangeText={setNewName} returnKeyType="next" />
                  <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} placeholder="(000) 000-0000" placeholderTextColor={colors.muted} value={newPhone} onChangeText={handlePhoneChange} keyboardType="phone-pad" returnKeyType="next" maxLength={19} />
                  <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} placeholder="Email" placeholderTextColor={colors.muted} value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
                  <BirthdayPicker value={newBirthday} onChange={setNewBirthday} placeholder="Expire Date (optional)" style={{ marginBottom: 14 }} />
                  <View style={styles.formActions}>
                    <Pressable onPress={() => setShowAdd(false)} style={({ pressed }) => [styles.formButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, opacity: pressed ? 0.7 : 1 }]}>
                      <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground }}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={handleAddClient} style={({ pressed }) => [styles.formButton, { backgroundColor: colors.primary, flex: 1, opacity: pressed ? 0.8 : 1 }]}>
                      <Text style={{ fontSize: fs.sm, fontWeight: "600", color: "#FFF" }}>Save Client</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
            <FlatList
              data={filteredClients}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 80 }}
              renderItem={({ item }) => {
                const rating = getClientRating(item.id);
                const apptCount = getLocationApptCount(item.id);
                const locationBadges = getClientLocationBadges(item.id);
                const expireBadge = getExpireBadge(item.birthday);
                const relevantAppt = getRelevantAppt(item.id);
                const filterActions = FILTER_ACTIONS[clientFilter];
                const svc = relevantAppt ? getServiceById(relevantAppt.serviceId) : null;
                return (
                  <View>
                    <Pressable
                      onPress={() => router.push({ pathname: "/client-detail", params: { id: item.id } })}
                      style={({ pressed }) => [styles.clientRow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={[styles.avatarText, { color: colors.primary }]}>{getInitials(item.name)}</Text>
                      </View>
                      <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 12, paddingRight: 4 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{item.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                          <Text style={{ fontSize: fs.xs, color: colors.muted }} numberOfLines={1}>
                            {item.phone ? formatPhoneNumber(item.phone) : (item.email || "No contact info")}
                          </Text>
                          {apptCount > 0 && <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 8 }}>{apptCount} appt{apptCount > 1 ? "s" : ""}</Text>}
                        </View>
                        {/* Show relevant appointment info for the active filter */}
                        {relevantAppt && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <View style={{ backgroundColor: activeFilterConfig.color + "18", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: activeFilterConfig.color + "40" }}>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: activeFilterConfig.color }} numberOfLines={1}>
                                {activeFilterConfig.icon} {svc ? getServiceDisplayName(svc) : "Appointment"} · {relevantAppt.date}
                              </Text>
                            </View>
                          </View>
                        )}
                        {locationBadges.length > 0 && (
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                            {locationBadges.map((loc) => {
                              const dotColor = LOCATION_COLORS[state.locations.indexOf(loc) % LOCATION_COLORS.length] ?? colors.primary;
                              return (
                                <View key={loc.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: dotColor + "18", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: dotColor + "40" }}>
                                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor, marginRight: 4 }} />
                                  <Text style={{ fontSize: 10, fontWeight: "600", color: dotColor }} numberOfLines={1}>{loc.name}</Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                        {expireBadge && (
                          <View style={{ alignSelf: "flex-start", marginTop: 5, backgroundColor: expireBadge.color + "18", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: expireBadge.color + "40" }}>
                            <Text style={{ fontSize: 10, fontWeight: "600", color: expireBadge.color }}>{expireBadge.label}</Text>
                          </View>
                        )}
                        {rating !== null && (
                          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                            <IconSymbol name="star.fill" size={12} color="#FFB300" />
                            <Text style={{ fontSize: fs.xs, color: "#FFB300", fontWeight: "600", marginLeft: 3 }}>{rating}</Text>
                          </View>
                        )}
                      </View>
                      {/* Quick action button when filter is active */}
                      {filterActions.length > 0 ? (
                        <Pressable
                          onPress={() => setActionSheetClient({ client: item, appt: relevantAppt })}
                          style={({ pressed }) => [{
                            width: 36, height: 36, borderRadius: 18,
                            backgroundColor: activeFilterConfig.color + "18",
                            alignItems: "center" as const, justifyContent: "center" as const,
                            marginRight: 10, opacity: pressed ? 0.7 : 1,
                          }]}
                        >
                          <Text style={{ fontSize: 16 }}>⚡</Text>
                        </Pressable>
                      ) : (
                        <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginRight: 14 }} />
                      )}
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={{ fontSize: 32 }}>{activeFilterConfig.icon}</Text>
                  <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 12 }}>
                    {clientFilter === "all" ? "No clients yet" : `No ${activeFilterConfig.label.toLowerCase()} clients`}
                  </Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, textAlign: "center", paddingHorizontal: 24 }}>
                    {clientFilter === "all"
                      ? "Tap + to add or import from contacts"
                      : clientFilter === "upcoming"
                      ? "No clients have upcoming appointments"
                      : clientFilter === "pending"
                      ? "No clients have pending appointment requests"
                      : clientFilter === "payment"
                      ? "No clients have outstanding payments"
                      : "No clients have completed appointments yet"}
                  </Text>
                </View>
              }
            />
          </>
        )}

        {/* ── Messages Tab ─────────────────────────────────────────────────────────────── */}
        {activeTab === "messages" && (
          <>
            {/* Search bar */}
            <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: hp, marginBottom: 8 }]}>
              <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search by name or message..."
                placeholderTextColor={colors.muted}
                value={messageSearch}
                onChangeText={setMessageSearch}
                returnKeyType="done"
                clearButtonMode="while-editing"
              />
              {messageSearch.length > 0 && (
                <Pressable onPress={() => setMessageSearch("")} style={{ padding: 4 }}>
                  <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>
            {threadsLoading ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.muted, marginTop: 12, fontSize: fs.sm }}>Loading conversations...</Text>
              </View>
            ) : threadsError ? (
              <View style={styles.emptyContainer}>
                <IconSymbol name="exclamationmark.circle" size={40} color={colors.error} />
                {threadsError === "session_expired" ? (
                  <>
                    <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>Session Expired</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6, textAlign: "center", paddingHorizontal: 32 }}>
                      Your session has expired. Please sign out and sign back in to load messages.
                    </Text>
                    <Pressable onPress={loadThreads} style={({ pressed }) => [{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: fs.sm, color: colors.error, marginTop: 12 }}>{threadsError}</Text>
                    <Pressable onPress={loadThreads} style={({ pressed }) => [{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : threads.length === 0 ? (
              <View style={styles.emptyContainer}>
                <IconSymbol name="message.fill" size={48} color={colors.muted + "60"} />
                <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 12 }}>No messages yet</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, textAlign: "center", paddingHorizontal: 32 }}>
                  When clients send you messages from the client app, they'll appear here.
                </Text>
              </View>
            ) : filteredThreads.length === 0 ? (
              <View style={styles.emptyContainer}>
                <IconSymbol name="magnifyingglass" size={40} color={colors.muted + "60"} />
                <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 12 }}>No results</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, textAlign: "center", paddingHorizontal: 32 }}>
                  No conversations match "{messageSearch}"
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredThreads}
                keyExtractor={(item) => String(item.clientAccountId)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 80 }}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => router.push({ pathname: "/client-message-thread-business" as any, params: { clientAccountId: String(item.clientAccountId), clientName: item.clientName, clientAvatarUrl: item.clientAvatarUrl ?? "" } })}
                    style={({ pressed }) => [
                      styles.threadRow,
                      { backgroundColor: colors.surface, borderColor: item.unreadCount > 0 ? colors.primary + "60" : colors.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    {/* Avatar */}
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "20", overflow: "hidden" }]}>
                      {item.clientAvatarUrl ? (
                        <Image source={{ uri: item.clientAvatarUrl }} style={{ width: 44, height: 44, borderRadius: 12 }} resizeMode="cover" />
                      ) : (
                        <Text style={[styles.avatarText, { color: colors.primary }]}>{getInitials(item.clientName)}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 12, paddingRight: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: item.unreadCount > 0 ? "700" : "600", color: colors.foreground }} numberOfLines={1}>{item.clientName}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted }}>{formatRelativeTime(item.lastMessageAt)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, gap: 4 }}>
                        {item.senderType === "business" && (
                          <Text style={{ fontSize: fs.xs, color: colors.muted }}>You: </Text>
                        )}
                        <Text style={{ fontSize: fs.xs, color: item.unreadCount > 0 ? colors.foreground : colors.muted, flex: 1 }} numberOfLines={1}>{item.lastMessage}</Text>
                        {item.unreadCount > 0 && (
                          <View style={{ backgroundColor: colors.primary, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#fff" }}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                          </View>
                        )}
                      </View>
                      {item.clientPhone && (
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{formatPhoneNumber(item.clientPhone)}</Text>
                      )}
                    </View>
                    <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginRight: 14 }} />
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>
      </KeyboardAvoidingView>

      {/* ── Action Sheet Modal ────────────────────────────────────────────── */}
      <Modal
        visible={!!actionSheetClient}
        animationType="slide"
        transparent
        onRequestClose={() => setActionSheetClient(null)}
      >
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setActionSheetClient(null)} />
        {actionSheetClient && (
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 20, paddingBottom: 36 }}>
            {/* Client info */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>{getInitials(actionSheetClient.client.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{actionSheetClient.client.name}</Text>
                {actionSheetClient.appt && (
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {getServiceById(actionSheetClient.appt.serviceId) ? getServiceDisplayName(getServiceById(actionSheetClient.appt.serviceId)!) : "Appointment"} · {actionSheetClient.appt.date}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => setActionSheetClient(null)} style={({ pressed }) => [{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ fontSize: 14, color: colors.muted }}>✕</Text>
              </Pressable>
            </View>

            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              Send a message
            </Text>

            {FILTER_ACTIONS[clientFilter].map((action) => (
              <Pressable
                key={action.key}
                onPress={() => handleFilterAction(actionSheetClient.client, actionSheetClient.appt, action)}
                style={({ pressed }) => [{
                  flexDirection: "row" as const,
                  alignItems: "center" as const,
                  gap: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: action.color + "40",
                  backgroundColor: action.color + "10",
                  marginBottom: 10,
                  opacity: pressed ? 0.8 : 1,
                }]}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: action.color + "20", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 20 }}>{action.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: action.color }}>{action.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Opens messaging thread with pre-filled message</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={action.color} />
              </Pressable>
            ))}

            {/* Also open client detail */}
            <Pressable
              onPress={() => {
                setActionSheetClient(null);
                router.push({ pathname: "/client-detail", params: { id: actionSheetClient.client.id } });
              }}
              style={({ pressed }) => [{ paddingVertical: 14, alignItems: "center" as const, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ fontSize: 14, color: colors.muted }}>View Client Profile</Text>
            </Pressable>
          </View>
        )}
      </Modal>

      {/* Upgrade Plan Sheet */}
      {upgradeSheetInfo && (
        <UpgradePlanSheet
          visible={upgradeSheetVisible}
          onClose={() => setUpgradeSheetVisible(false)}
          currentPlanKey={upgradeSheetInfo.planKey}
          currentPlanName={upgradeSheetInfo.planName}
          resource="clients"
          currentLimit={upgradeSheetInfo.limit}
          businessOwnerId={state.businessOwnerId!}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingTop: 4 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  addButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabSwitcher: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 14, gap: 3 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  searchBar: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingHorizontal: 12, marginBottom: 16, borderWidth: 1 },
  searchInput: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, fontSize: 13, lineHeight: 20 },
  addForm: { borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, width: "100%" },
  input: { width: "100%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13, lineHeight: 20, marginBottom: 8, borderWidth: 1 },
  formActions: { flexDirection: "row", gap: 8, width: "100%" },
  formButton: { paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, minHeight: 44 },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start", height: 34, justifyContent: "center", alignItems: "center" },
  clientRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, marginBottom: 10, borderWidth: 1, paddingLeft: 12, paddingRight: 4 },
  threadRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, marginBottom: 10, borderWidth: 1, paddingLeft: 12, paddingRight: 4 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { fontSize: 13, fontWeight: "700" },
  emptyContainer: { alignItems: "center", paddingVertical: 48 },
});
