import { useState, useMemo, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  Platform,
  Image,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { ScreenContainer } from "@/components/screen-container";
import { BirthdayPicker } from "@/components/birthday-picker";
import { useStore, formatTime, formatDateDisplay, generateId } from "@/lib/store";
import { ClientPhoto } from "@/lib/types";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FuturisticBackground } from "@/components/futuristic-background";

import {
  Review,
  minutesToTime,
  timeToMinutes,
  Appointment,
  getServiceDisplayName,
  stripPhoneFormat,
  formatPhoneNumber,
  formatDateLong,
  formatTimeDisplay,
  generateConfirmationMessage,
  generateReminderMessage,
  generateCancellationMessage,
  formatFullAddress,
  PUBLIC_BOOKING_URL,
  LIME_OF_TIME_FOOTER,
} from "@/lib/types";

function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, val);
  }
  return result + LIME_OF_TIME_FOOTER;
}

type TabKey = "appointments" | "messages" | "reviews" | "photos";

export default function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch, getClientById, getAppointmentsForClient, getServiceById, getReviewsForClient, getPhotosForClient, getLocationById, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();

  const client = getClientById(id ?? "");
  const appointments = getAppointmentsForClient(id ?? "");
  const reviews = getReviewsForClient(id ?? "");
  const photos = getPhotosForClient(id ?? "");
  const [activeTab, setActiveTab] = useState<TabKey>("appointments");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const biz = state.settings;
  const profile = biz.profile;

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(client?.name ?? "");
  const [editPhone, setEditPhone] = useState(client?.phone ?? "");
  const [editEmail, setEditEmail] = useState(client?.email ?? "");
  const [editNotes, setEditNotes] = useState(client?.notes ?? "");
  const [editBirthday, setEditBirthday] = useState(client?.birthday ?? "");

  // Inline edit errors
  const [editErrors, setEditErrors] = useState<{ name?: string; phone?: string; email?: string }>({});

  // Review form
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  const handlePhoneChange = (text: string) => {
    setEditPhone(formatPhoneNumber(text));
  };

  const handleSave = useCallback(() => {
    if (!client) return;
    const newErrors: { name?: string; phone?: string; email?: string } = {};
    if (!editName.trim()) newErrors.name = "Name is required";
    if (editPhone.trim() && stripPhoneFormat(editPhone).length < 10) newErrors.phone = "Please enter a complete 10-digit phone number";
    if (editEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail.trim())) newErrors.email = "Please enter a valid email address";
    if (Object.keys(newErrors).length > 0) {
      setEditErrors(newErrors);
      return;
    }
    setEditErrors({});
    const action = {
      type: "UPDATE_CLIENT" as const,
      payload: { ...client, name: editName.trim(), phone: editPhone.trim(), email: editEmail.trim(), notes: editNotes.trim(), birthday: editBirthday.trim() },
    };
    dispatch(action);
    syncToDb(action);
    setEditing(false);
  }, [editName, editPhone, editEmail, editNotes, editBirthday, client, dispatch]);

  const handleDelete = useCallback(() => {
    if (!client) return;
    const doDelete = () => {
      // Navigate first to avoid re-render on a now-deleted client
      router.back();
      // Small delay so navigation is committed before state update
      setTimeout(() => {
        dispatch({ type: "DELETE_CLIENT", payload: client.id });
        syncToDb({ type: "DELETE_CLIENT", payload: client.id });
      }, 50);
    };
    if (Platform.OS === "web") {
      if (window.confirm(`Delete ${client.name}? This cannot be undone.`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        "Delete Client",
        `Remove ${client.name} permanently? Their reviews will be kept.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doDelete },
        ]
      );
    }
  }, [client, dispatch, syncToDb, router]);

  const handleAddReview = useCallback(() => {
    if (!id) return;
    const review: Review = {
      id: generateId(),
      clientId: id,
      rating: reviewRating,
      comment: reviewComment.trim(),
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_REVIEW", payload: review });
    syncToDb({ type: "ADD_REVIEW", payload: review });
    setReviewComment("");
    setReviewRating(5);
    setShowReviewForm(false);
  }, [id, reviewRating, reviewComment, dispatch]);

  const handleDeleteReview = useCallback(
    (reviewId: string) => {
      const doIt = () => {
        dispatch({ type: "DELETE_REVIEW", payload: reviewId });
        syncToDb({ type: "DELETE_REVIEW", payload: reviewId });
      };
      if (Platform.OS === "web") {
        doIt();
      } else {
        Alert.alert("Delete Review", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doIt },
        ]);
      }
    },
    [dispatch]
  );

  const openSMS = useCallback(
    (phone: string, message: string) => {
      const rawPhone = stripPhoneFormat(phone);
      if (Platform.OS === "web") {
        Alert.alert("SMS Message", message);
        return;
      }
      const separator = Platform.OS === "ios" ? "&" : "?";
      const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(message)}`;
      Linking.openURL(url).catch(() => Alert.alert("SMS", message));
    },
    []
  );

  const generateMessage = useCallback(
    (appt: Appointment, type: "confirmation" | "reminder" | "upcoming" | "cancelled" | "completed") => {
      if (!client) return "";
      const svc = getServiceById(appt.serviceId);
      const primarySvcName = svc ? getServiceDisplayName(svc) : "your appointment";
      const bizName = biz.businessName;
      const bizPhone = profile.phone;
      const apptLocation = appt.locationId ? getLocationById(appt.locationId) : null;
      const addr = apptLocation?.address || profile.address;
      const locName = apptLocation?.name;
      // Fall back to profile city/state/zip when no location is assigned
      const locCity = apptLocation?.city ?? profile.city;
      const locState = apptLocation?.state ?? profile.state;
      const locZip = apptLocation?.zipCode ?? profile.zipCode;
      const locPhone = apptLocation?.phone || bizPhone;
      const locId = apptLocation?.id;

      const slug = biz.customSlug || bizName.replace(/\s+/g, "-").toLowerCase();
      const fullAddrStr = formatFullAddress(addr, locCity, locState, locZip);
      const locLine = locName ? (fullAddrStr ? `${locName} — ${fullAddrStr}` : locName) : fullAddrStr;
      const bookUrl = locId ? `${PUBLIC_BOOKING_URL}/book/${slug}?location=${locId}` : `${PUBLIC_BOOKING_URL}/book/${slug}`;
      const reviewUrl = `${PUBLIC_BOOKING_URL}/review/${slug}`;
      const phoneFormatted = formatPhoneNumber(stripPhoneFormat(locPhone));

      // Multi-service expansion
      const extraServiceItems = (appt.extraItems ?? []).filter((e) => e.type === "service");
      const hasMultiService = extraServiceItems.length > 0;

      let serviceName: string;
      let timeDisplay: string;
      let totalPrice: string;
      let displayDuration: number;

      if (hasMultiService) {
        const startMins = timeToMinutes(appt.time);
        const primaryDuration = svc?.duration ?? appt.duration;
        const primaryPrice = svc?.price ?? 0;
        const serviceLines: string[] = [];

        const primaryEnd = minutesToTime(startMins + primaryDuration);
        serviceLines.push(
          `• ${primarySvcName} (${primaryDuration} min) ${formatTimeDisplay(minutesToTime(startMins))}–${formatTimeDisplay(primaryEnd)} — $${Number(primaryPrice).toFixed(2)}`
        );

        let cursor = startMins + primaryDuration;
        for (const item of extraServiceItems) {
          const itemEnd = minutesToTime(cursor + item.duration);
          serviceLines.push(
            `• ${item.name} (${item.duration} min) ${formatTimeDisplay(minutesToTime(cursor))}–${formatTimeDisplay(itemEnd)} — $${item.price.toFixed(2)}`
          );
          cursor += item.duration;
        }
        serviceName = serviceLines.join("\n");
        timeDisplay = `${formatTimeDisplay(appt.time)}–${formatTimeDisplay(minutesToTime(cursor))}`;
        displayDuration = cursor - startMins;
        const rawTotal = appt.totalPrice ?? (Number(primaryPrice) + extraServiceItems.reduce((s, e) => s + e.price, 0));
        totalPrice = `$${rawTotal.toFixed(2)}`;
      } else {
        serviceName = primarySvcName;
        timeDisplay = formatTimeDisplay(appt.time);
        displayDuration = appt.duration;
        totalPrice = appt.totalPrice != null ? `$${appt.totalPrice.toFixed(2)}` : (svc ? `$${Number(svc.price).toFixed(2)}` : "");
      }

      const tplVars = {
        clientName: client.name,
        businessName: bizName,
        serviceName,
        service: serviceName,
        duration: String(displayDuration),
        date: appt.date,
        time: timeDisplay,
        price: totalPrice,
        total: totalPrice,
        location: locLine,
        phone: phoneFormatted,
        clientPhone: client.phone ?? "",
        bookingUrl: bookUrl,
        reviewUrl,
      };

      switch (type) {
        case "confirmation": {
          const tpl = biz.smsTemplates?.confirmation;
          if (tpl) return applyTemplate(tpl, tplVars);
          return generateConfirmationMessage(bizName, addr, client.name, serviceName, displayDuration, appt.date, appt.time, locPhone, undefined, locName, locId, biz.customSlug, locCity, locState, locZip);
        }
        case "reminder": {
          const tpl = biz.smsTemplates?.reminder;
          if (tpl) return applyTemplate(tpl, tplVars);
          return generateReminderMessage(bizName, addr, client.name, serviceName, displayDuration, appt.date, appt.time, locPhone, locName, locCity, locState, locZip);
        }
        case "upcoming": {
          const endTime = formatTimeDisplay(minutesToTime(timeToMinutes(appt.time) + displayDuration));
          return `Dear ${client.name},\n\nYou have an upcoming appointment request pending confirmation.\n\n📋 Service: ${serviceName}\n📅 Date: ${formatDateLong(appt.date)}\n⏰ Time: ${formatTimeDisplay(appt.time)} - ${endTime}\n📍 Location: ${locLine}\n🏢 Business: ${bizName}\n📞 Contact: ${phoneFormatted}\n\n🔗 Book again: ${bookUrl}\n\nWe will confirm your appointment shortly. Thank you for your patience!\n\n${bizName}${LIME_OF_TIME_FOOTER}`;
        }
        case "cancelled": {
          const tpl = biz.smsTemplates?.cancellation;
          if (tpl) return applyTemplate(tpl, tplVars);
          return generateCancellationMessage(bizName, client.name, serviceName, appt.date, appt.time, "", locPhone, locName, apptLocation?.address, locCity, locState, locZip);
        }
        case "completed": {
          const tpl = biz.smsTemplates?.completed;
          if (tpl) return applyTemplate(tpl, tplVars);
          return `Dear ${client.name},\n\nThank you for visiting ${bizName}! Your appointment for ${serviceName} on ${formatDateLong(appt.date)} has been completed.\n\nWe hope you had a wonderful experience and we’d love to see you again!\n\n📍 Location: ${locLine}\n📞 Contact: ${phoneFormatted}\n\n🔗 Book again: ${bookUrl}\n\nBest regards,\n${bizName}${LIME_OF_TIME_FOOTER}`;
        }
        default:
          return "";
      }
    },
    [client, biz.businessName, biz.customSlug, biz.smsTemplates, profile, getServiceById, getLocationById]
  );

  const handleSendMessage = useCallback(
    (appt: Appointment, type: "confirmation" | "reminder" | "upcoming" | "cancelled" | "completed") => {
      if (!client?.phone) {
        Alert.alert("No Phone", "This client doesn't have a phone number.");
        return;
      }
      const message = generateMessage(appt, type);
      openSMS(client.phone, message);
    },
    [client, generateMessage, openSMS]
  );

  const handleQuickMessage = useCallback(async () => {
    if (!client?.phone) {
      Alert.alert("No Phone", "This client doesn't have a phone number.");
      return;
    }
    // Try to find the client's portal account and open in-app messaging thread
    try {
      const rawPhone = stripPhoneFormat(client.phone);
      const { apiCall } = await import("@/lib/_core/api");
      const data = await apiCall<{ found: boolean; clientAccountId?: number; clientName?: string; clientAvatarUrl?: string }>(
        `/api/business/client-account-by-phone?phone=${encodeURIComponent(rawPhone)}`
      );
      if (data.found && data.clientAccountId) {
        router.push({
          pathname: "/client-message-thread-business",
          params: {
            clientAccountId: String(data.clientAccountId),
            clientName: client.name,
            clientAvatarUrl: data.clientAvatarUrl ?? "",
            clientId: client.id,
          },
        });
        return;
      }
    } catch {
      // Fall through to SMS
    }
    // Use the active location's full address if available, else fall back to profile address
    const recentAppt = state.appointments
      .filter((a) => a.clientId === client.id && a.locationId)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const recentLoc = recentAppt?.locationId ? state.locations.find((l) => l.id === recentAppt.locationId) : null;
    const addr = recentLoc
      ? formatFullAddress(recentLoc.address, recentLoc.city, recentLoc.state, recentLoc.zipCode)
      : formatFullAddress(profile.address, profile.city, profile.state, profile.zipCode);
    const followUpSlug = biz.customSlug || biz.businessName.replace(/\s+/g, "-").toLowerCase();
    const bookUrl = recentLoc?.id
      ? `${PUBLIC_BOOKING_URL}/book/${followUpSlug}?location=${recentLoc.id}`
      : `${PUBLIC_BOOKING_URL}/book/${followUpSlug}`;
    const locationLine = addr ? `\n\n\uD83D\uDCCD Location: ${addr}` : "";
    const customFollowUpTpl = biz.smsTemplates?.followUp;
    let message: string;
    if (customFollowUpTpl) {
      message = applyTemplate(customFollowUpTpl, {
        clientName: client.name,
        businessName: biz.businessName,
        location: addr,
        phone: formatPhoneNumber(stripPhoneFormat(recentLoc?.phone || profile.phone)),
        clientPhone: client.phone,
        bookingUrl: bookUrl,
        reviewUrl: `${PUBLIC_BOOKING_URL}/review/${followUpSlug}`,
      });
    } else {
      message = `Dear ${client.name},\n\nThank you for being a valued client of ${biz.businessName}! We\u2019d love to schedule your next appointment.${locationLine}\n\n\uD83D\uDCDE Contact: ${formatPhoneNumber(stripPhoneFormat(recentLoc?.phone || profile.phone))}\n\n\uD83D\uDD17 Book now: ${bookUrl}\n\nBest regards,\n${biz.businessName}${LIME_OF_TIME_FOOTER}`;
    }
    openSMS(client.phone, message);
  }, [client, biz.businessName, biz.customSlug, biz.smsTemplates, profile, openSMS, state.appointments, state.locations]);

  if (!client) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <FuturisticBackground />
        <View style={{ padding: hp }}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
          </Pressable>
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <Text style={{ color: colors.muted, fontSize: fs.md }}>Client not found</Text>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
  const upcomingAppts = appointments.filter((a) => a.status === "confirmed" || a.status === "pending");
  const pastAppts = appointments.filter((a) => a.status === "completed" || a.status === "cancelled");

  // Location visit history: group appointments by locationId
  const locationVisitHistory = useMemo(() => {
    if (state.locations.length === 0) return [];
    return state.locations
      .filter((loc) => loc.active)
      .map((loc) => {
        const locAppts = appointments.filter((a) => a.locationId === loc.id);
        const lastVisit = locAppts
          .filter((a) => a.status === "completed" || a.status === "confirmed")
          .sort((a, b) => (b.date > a.date ? 1 : -1))[0];
        return {
          location: loc,
          totalVisits: locAppts.length,
          completedVisits: locAppts.filter((a) => a.status === "completed").length,
          lastVisitDate: lastVisit?.date ?? null,
        };
      })
      .filter((entry) => entry.totalVisits > 0);
  }, [appointments, state.locations]);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "appointments", label: "Appointments", count: appointments.length },
    { key: "messages", label: "Remind" },
    { key: "reviews", label: "Reviews", count: reviews.length },
    { key: "photos", label: "Photos", count: photos.length > 0 ? photos.length : undefined },
  ];

  const handleAddPhoto = useCallback(async (label: ClientPhoto["label"]) => {
    if (!client) return;
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow access to your photo library to add photos.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const photo: ClientPhoto = {
      id: generateId(),
      clientId: client.id,
      uri: result.assets[0].uri,
      label,
      note: "",
      takenAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_CLIENT_PHOTO", payload: photo });
  }, [client, dispatch]);

  const handleDeletePhoto = useCallback((photoId: string) => {
    if (Platform.OS === "web") {
      dispatch({ type: "DELETE_CLIENT_PHOTO", payload: photoId });
    } else {
      Alert.alert("Delete Photo", "Remove this photo from the client's gallery?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => dispatch({ type: "DELETE_CLIENT_PHOTO", payload: photoId }) },
      ]);
    }
  }, [dispatch]);

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={720}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Header */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="chevron.left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>Client</Text>
          {!editing ? (
            <Pressable
              onPress={() => { setEditName(client.name); setEditPhone(client.phone); setEditEmail(client.email); setEditNotes(client.notes); setEditBirthday(client.birthday ?? ""); setEditing(true); }}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
            >
              <IconSymbol name="pencil" size={20} color={colors.primary} />
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        {/* Profile Card */}
        {editing ? (
          <View style={[styles.editCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>Edit Client</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: editErrors.name ? colors.error : colors.border, color: colors.foreground }]}
              placeholder="Full Name *"
              placeholderTextColor={colors.muted}
              value={editName}
              onChangeText={(v) => { setEditName(v); if (editErrors.name) setEditErrors((e) => ({ ...e, name: undefined })); }}
              returnKeyType="next"
            />
            {editErrors.name ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 6, marginTop: -4 }}>{editErrors.name}</Text> : null}
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: editErrors.phone ? colors.error : colors.border, color: colors.foreground }]}
              placeholder="(000) 000-0000"
              placeholderTextColor={colors.muted}
              value={editPhone}
              onChangeText={(v) => { handlePhoneChange(v); if (editErrors.phone) setEditErrors((e) => ({ ...e, phone: undefined })); }}
              keyboardType="phone-pad"
              returnKeyType="next"
            />
            {editErrors.phone ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 6, marginTop: -4 }}>{editErrors.phone}</Text> : null}
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: editErrors.email ? colors.error : colors.border, color: colors.foreground }]}
              placeholder="Email"
              placeholderTextColor={colors.muted}
              value={editEmail}
              onChangeText={(v) => { setEditEmail(v); if (editErrors.email) setEditErrors((e) => ({ ...e, email: undefined })); }}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />
            {editErrors.email ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 6, marginTop: -4 }}>{editErrors.email}</Text> : null}
            <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, minHeight: 60, textAlignVertical: "top" }]} placeholder="Notes" placeholderTextColor={colors.muted} value={editNotes} onChangeText={setEditNotes} multiline numberOfLines={3} returnKeyType="done" />
            <BirthdayPicker
              value={editBirthday}
              onChange={setEditBirthday}
              placeholder="Birthday (optional)"
            />
            <View style={styles.editActions}>
              <Pressable onPress={() => setEditing(false)} style={({ pressed }) => [styles.cancelBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ fontSize: fs.sm, color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSave} style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: "#FFF" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.bigAvatar, { backgroundColor: colors.primary + "20" }]}>
              <Text style={{ fontSize: fs.xl, fontWeight: "700", color: colors.primary }}>{getInitials(client.name)}</Text>
            </View>
            <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>{client.name}</Text>
            {avgRating && (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                <IconSymbol name="star.fill" size={14} color="#FFB300" />
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: "#FFB300", marginLeft: 4 }}>{avgRating}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 4 }}>({reviews.length})</Text>
              </View>
            )}
            <View style={styles.contactRow}>
              {client.phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${stripPhoneFormat(client.phone)}`)} style={({ pressed }) => [styles.contactChip, { backgroundColor: colors.primary + "12", opacity: pressed ? 0.7 : 1 }]}>
                  <IconSymbol name="phone.fill" size={14} color={colors.primary} />
                  <Text style={{ fontSize: fs.xs, color: colors.primary, marginLeft: 6 }}>{formatPhoneNumber(client.phone)}</Text>
                </Pressable>
              ) : null}
              {client.email ? (
                <Pressable onPress={() => Linking.openURL(`mailto:${client.email}`)} style={({ pressed }) => [styles.contactChip, { backgroundColor: colors.primary + "12", opacity: pressed ? 0.7 : 1 }]}>
                  <IconSymbol name="envelope.fill" size={14} color={colors.primary} />
                  <Text style={{ fontSize: fs.xs, color: colors.primary, marginLeft: 6 }} numberOfLines={1}>{client.email}</Text>
                </Pressable>
              ) : null}
            </View>
            {client.notes ? (
              <View style={[styles.notesBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 2 }}>Notes</Text>
                <Text style={{ fontSize: fs.xs, color: colors.foreground, lineHeight: 18 }}>{client.notes}</Text>
              </View>
            ) : null}
            {client.birthday ? (
              <View style={[styles.notesBox, { backgroundColor: colors.background, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }]}>

                <View>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 2 }}>Birthday</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.foreground }}>{client.birthday}</Text>
                </View>
              </View>
            ) : null}
{/* ── Quick-action pair ─────────────────────────────────────────── */}
            <View style={{
              flexDirection: "row",
              gap: 8,
              marginTop: 14,
              marginHorizontal: -20, // bleed to card edges (card padding is 20)
              paddingHorizontal: 20,
            }}>
              {/* Call — only shown when phone exists */}
              {client.phone ? (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${stripPhoneFormat(client.phone)}`).catch(() => Alert.alert("Call", "Unable to open phone dialer."))}
                  onPressIn={() => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={({ pressed }) => [{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 46,
                    borderRadius: 14,
                    backgroundColor: "#2563EB",
                    opacity: pressed ? 0.82 : 1,
                    gap: 6,
                  }]}
                >
                  <IconSymbol name="phone.fill" size={17} color="#FFF" />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#FFF", letterSpacing: 0.1 }} numberOfLines={1}>Call</Text>
                </Pressable>
              ) : null}

              {/* Message */}
              {client.phone ? (
                <Pressable
                  onPress={handleQuickMessage}
                  onPressIn={() => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={({ pressed }) => [{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 46,
                    borderRadius: 14,
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.82 : 1,
                    gap: 6,
                  }]}
                >
                  <IconSymbol name="paperplane.fill" size={17} color="#FFF" />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#FFF", letterSpacing: 0.1 }} numberOfLines={1}>Remind</Text>
                </Pressable>
              ) : null}
            </View>

            {/* No-phone hint — shown only when client has no phone number */}
            {!client.phone && (
              <Pressable
                onPress={() => setEditing(true)}
                style={({ pressed }) => [{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  marginTop: 10,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: colors.muted + "14",
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <IconSymbol name="phone.fill" size={13} color={colors.muted} />
                <Text style={{ fontSize: fs.xs, color: colors.muted, fontStyle: "italic" }}>
                  Add phone to unlock Call &amp; Message
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Tabs */}
        {!editing && (
          <>
            <View style={[styles.tabBar, { borderColor: colors.border }]}>
              {tabs.map((tab) => (
                <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={({ pressed }) => [styles.tabItem, { borderBottomColor: activeTab === tab.key ? colors.primary : "transparent", opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: activeTab === tab.key ? colors.primary : colors.muted }}>{tab.label}</Text>
                  {tab.count !== undefined && tab.count > 0 && (
                    <View style={[styles.tabBadge, { backgroundColor: activeTab === tab.key ? colors.primary : colors.muted + "30" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: activeTab === tab.key ? "#FFF" : colors.muted }}>{tab.count}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>

            {/* Appointments Tab */}
            {activeTab === "appointments" && (
              <View>
                {upcomingAppts.length > 0 && <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Upcoming ({upcomingAppts.length})</Text>}
                {upcomingAppts.map((appt) => {
                  const svc = getServiceById(appt.serviceId);
                  const statusColor = appt.status === "confirmed" ? colors.success : appt.status === "pending" ? "#FF9800" : colors.primary;
                  const isRefunded = !!(appt as any).refundedAt;
                  const refundedAmt = (appt as any).refundedAmount;
                  const isCardPaid = appt.paymentMethod === 'card' && appt.paymentStatus === 'paid';
                  return (
                    <Pressable key={appt.id} onPress={() => router.push({ pathname: "/appointment-detail", params: { id: appt.id } })} style={({ pressed }) => [styles.apptCard, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: svc?.color ?? colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{svc ? getServiceDisplayName(svc) : "Service"}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{formatDateDisplay(appt.date)} · {formatTime(appt.time)} - {formatTime(minutesToTime(timeToMinutes(appt.time) + appt.duration))}</Text>
                        {isRefunded && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                            <View style={{ backgroundColor: '#EF444418', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#EF4444' }}>↩ Refunded{refundedAmt ? ` $${Number(refundedAmt).toFixed(2)}` : ''}</Text>
                            </View>
                          </View>
                        )}
                        {!isRefunded && isCardPaid && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                            <View style={{ backgroundColor: '#635BFF18', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#635BFF' }}>💳 Card Paid</Text>
                            </View>
                          </View>
                        )}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
                        <Text style={{ fontSize: 10, fontWeight: "600", color: statusColor, textTransform: "capitalize" }}>{appt.status}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {pastAppts.length > 0 && <Text style={[styles.sectionLabel, { color: colors.foreground, marginTop: 12 }]}>Past ({pastAppts.length})</Text>}
                {pastAppts.map((appt) => {
                  const svc = getServiceById(appt.serviceId);
                  const statusColor = appt.status === "completed" ? colors.success : colors.error;
                  const isRefunded = !!(appt as any).refundedAt;
                  const refundedAmt = (appt as any).refundedAmount;
                  const isCardPaid = appt.paymentMethod === 'card' && appt.paymentStatus === 'paid';
                  return (
                    <Pressable key={appt.id} onPress={() => router.push({ pathname: "/appointment-detail", params: { id: appt.id } })} style={({ pressed }) => [styles.apptCard, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: svc?.color ?? colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{svc ? getServiceDisplayName(svc) : "Service"}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{formatDateDisplay(appt.date)} · {formatTime(appt.time)} - {formatTime(minutesToTime(timeToMinutes(appt.time) + appt.duration))}</Text>
                        {isRefunded && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                            <View style={{ backgroundColor: '#EF444418', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#EF4444' }}>↩ Refunded{refundedAmt ? ` $${Number(refundedAmt).toFixed(2)}` : ''}</Text>
                            </View>
                          </View>
                        )}
                        {!isRefunded && isCardPaid && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                            <View style={{ backgroundColor: '#635BFF18', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#635BFF' }}>💳 Card Paid</Text>
                            </View>
                          </View>
                        )}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
                        <Text style={{ fontSize: 10, fontWeight: "600", color: statusColor, textTransform: "capitalize" }}>{appt.status}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {appointments.length === 0 && (
                  <View style={styles.emptyState}>
                    <IconSymbol name="calendar" size={36} color={colors.muted + "60"} />
                    <Text style={{ color: colors.muted, fontSize: fs.sm, marginTop: 8 }}>No appointments yet</Text>
                  </View>
                )}
              </View>
            )}

            {/* Location Visit History — shown in appointments tab when data exists */}
            {activeTab === "appointments" && locationVisitHistory.length > 0 && (
              <View style={{ marginTop: 20, marginBottom: 4 }}>
                <Text style={[styles.sectionLabel, { color: colors.foreground, marginBottom: 10 }]}>Locations Visited</Text>
                {locationVisitHistory.map((entry) => (
                  <View
                    key={entry.location.id}
                    style={[
                      styles.locHistoryCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                        <IconSymbol name="mappin.and.ellipse" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>
                          {entry.location.name}
                        </Text>
                        {!!entry.location.address && (
                          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                            {entry.location.address}{entry.location.city ? `, ${entry.location.city}` : ""}{entry.location.state ? ` ${entry.location.state}` : ""}{entry.location.zipCode ? ` ${entry.location.zipCode}` : ""}
                          </Text>
                        )}
                        {entry.lastVisitDate && (
                          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                            Last visit: {formatDateDisplay(entry.lastVisitDate)}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.primary }}>{entry.totalVisits}</Text>
                      <Text style={{ fontSize: 10, color: colors.muted, textAlign: "right" }}>{entry.totalVisits === 1 ? "visit" : "visits"}</Text>
                      {entry.completedVisits > 0 && entry.completedVisits !== entry.totalVisits && (
                        <Text style={{ fontSize: 10, color: colors.success }}>{entry.completedVisits} done</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Messages Tab */}
            {activeTab === "messages" && (
              <View>
                {appointments.length === 0 ? (
                  <View style={styles.emptyState}>
                    <IconSymbol name="paperplane.fill" size={36} color={colors.muted + "60"} />
                    <Text style={{ color: colors.muted, fontSize: fs.sm, marginTop: 8 }}>No appointments to message about</Text>
                  </View>
                ) : (
                  appointments.map((appt) => {
                    const svc = getServiceById(appt.serviceId);
                    const msgTypes: { key: "confirmation" | "reminder" | "upcoming" | "cancelled" | "completed"; label: string; icon: string; color: string }[] = [];
                    if (appt.status === "confirmed") {
                      msgTypes.push({ key: "confirmation", label: "Confirmed", icon: "checkmark.circle.fill", color: colors.success });
                      msgTypes.push({ key: "reminder", label: "Reminder", icon: "bell.fill", color: "#FF9800" });
                    }
                    if (appt.status === "pending") {
                      msgTypes.push({ key: "upcoming", label: "Pending", icon: "clock.fill", color: "#2196F3" });
                    }
                    if (appt.status === "cancelled") {
                      msgTypes.push({ key: "cancelled", label: "Cancelled", icon: "xmark.circle.fill", color: colors.error });
                    }
                    if (appt.status === "completed") {
                      msgTypes.push({ key: "completed", label: "Thank You", icon: "heart.fill", color: "#9C27B0" });
                    }
                    return (
                      <View key={appt.id} style={[styles.msgCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{svc ? getServiceDisplayName(svc) : "Service"}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{formatDateDisplay(appt.date)} at {formatTime(appt.time)} - {formatTime(minutesToTime(timeToMinutes(appt.time) + appt.duration))}</Text>
                        <View style={styles.msgButtons}>
                          {msgTypes.map((mt) => (
                            <Pressable
                              key={mt.key}
                              onPress={() => handleSendMessage(appt, mt.key)}
                              style={({ pressed }) => [styles.msgBtn, { backgroundColor: mt.color + "12", borderColor: mt.color + "30", opacity: pressed ? 0.7 : 1 }]}
                            >
                              <IconSymbol name={mt.icon as any} size={14} color={mt.color} />
                              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: mt.color, marginLeft: 6 }}>{mt.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {/* Reviews Tab — read-only, submitted by clients */}
            {activeTab === "reviews" && (
              <View>
                {reviews.length === 0 ? (
                  <View style={styles.emptyState}>
                    <IconSymbol name="star.fill" size={36} color={colors.muted + "60"} />
                    <Text style={{ color: colors.muted, fontSize: fs.sm, marginTop: 8 }}>No reviews yet</Text>
                    <Text style={{ color: colors.muted, fontSize: fs.xs, marginTop: 4, textAlign: "center" }}>Reviews are submitted by clients after their appointments.</Text>
                  </View>
                ) : (
                  reviews.map((rev) => (
                    <View key={rev.id} style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <View style={styles.reviewHeader}>
                        <View style={{ flexDirection: "row" }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <IconSymbol key={star} name="star.fill" size={14} color={star <= rev.rating ? "#FFB300" : colors.border} />
                          ))}
                        </View>
                        <Text style={{ fontSize: fs.xs, color: colors.muted }}>
                          {new Date(rev.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </Text>
                      </View>
                      {rev.comment ? <Text style={{ fontSize: fs.xs, color: colors.foreground, marginTop: 6, lineHeight: 18 }}>{rev.comment}</Text> : null}
                    </View>
                  ))
                )}
              </View>
            )}

            {/* Photos Tab */}
            {activeTab === "photos" && (
              <View>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                  <Pressable
                    onPress={() => handleAddPhoto("before")}
                    style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#3B82F6", backgroundColor: pressed ? "#3B82F610" : "transparent", opacity: pressed ? 0.7 : 1 })}
                  >
                    <IconSymbol name="plus" size={16} color="#3B82F6" />
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#3B82F6" }}>Before</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleAddPhoto("after")}
                    style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#10B981", backgroundColor: pressed ? "#10B98110" : "transparent", opacity: pressed ? 0.7 : 1 })}
                  >
                    <IconSymbol name="plus" size={16} color="#10B981" />
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#10B981" }}>After</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleAddPhoto("other")}
                    style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: colors.muted, backgroundColor: pressed ? colors.muted + "10" : "transparent", opacity: pressed ? 0.7 : 1 })}
                  >
                    <IconSymbol name="plus" size={16} color={colors.muted} />
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>Other</Text>
                  </Pressable>
                </View>
                {photos.length === 0 ? (
                  <View style={styles.emptyState}>
                    <IconSymbol name="photo" size={36} color={colors.muted + "60"} />
                    <Text style={{ color: colors.muted, fontSize: fs.sm, marginTop: 8 }}>No photos yet</Text>
                    <Text style={{ color: colors.muted, fontSize: fs.xs, marginTop: 4, textAlign: "center" }}>Add before/after photos to track client transformations.</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {photos.map((photo, photoIdx) => (
                      <View key={photo.id} style={{ width: "48%", borderRadius: 12, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                        <Pressable onPress={() => setLightboxIndex(photoIdx)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                          <Image source={{ uri: photo.uri }} style={{ width: "100%", aspectRatio: 1 }} resizeMode="cover" />
                        </Pressable>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6 }}>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: photo.label === "before" ? "#3B82F620" : photo.label === "after" ? "#10B98120" : colors.muted + "20" }}>
                            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: photo.label === "before" ? "#3B82F6" : photo.label === "after" ? "#10B981" : colors.muted, textTransform: "uppercase" }}>{photo.label}</Text>
                          </View>
                          <Pressable onPress={() => handleDeletePhoto(photo.id)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}>
                            <IconSymbol name="trash" size={14} color={colors.error} />
                          </Pressable>
                        </View>
                        <Text style={{ fontSize: 10, color: colors.muted, paddingHorizontal: 8, paddingBottom: 6 }}>
                          {new Date(photo.takenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
            {/* Photo Lightbox */}
            {lightboxIndex !== null && (
              <PhotoLightbox
                photos={photos}
                initialIndex={lightboxIndex}
                visible={lightboxIndex !== null}
                onClose={() => setLightboxIndex(null)}
              />
            )}
            {/* Delete Client */}
            <Pressable onPress={handleDelete} style={({ pressed }) => [styles.deleteBtn, { borderColor: colors.error, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.error }}>Delete Client</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  infoCard: { borderRadius: 16, padding: 20, borderWidth: 1, alignItems: "center", marginBottom: 16 },
  editCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 16 },
  bigAvatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  contactRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, justifyContent: "center" },
  contactChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  notesBox: { borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, width: "100%" },
  quickMsgBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginTop: 14, width: "100%" },
  input: { width: "100%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13, lineHeight: 20, marginBottom: 8, borderWidth: 1 },
  editActions: { flexDirection: "row", gap: 8, marginTop: 4, width: "100%" },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, marginBottom: 16 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, flexDirection: "row", justifyContent: "center", gap: 6 },
  tabBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, minWidth: 20, alignItems: "center" },
  sectionLabel: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  apptCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderLeftWidth: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  emptyState: { alignItems: "center", paddingVertical: 40 },
  msgCard: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1 },
  msgButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  msgBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  addReviewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, marginBottom: 14 },
  reviewForm: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 14 },
  starsRow: { flexDirection: "row", justifyContent: "center", marginBottom: 12 },
  reviewInput: { width: "100%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 20, borderWidth: 1, minHeight: 80, textAlignVertical: "top" },
  reviewActions: { flexDirection: "row", gap: 8, marginTop: 12, width: "100%" },
  reviewCancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: 40 },
  reviewSaveBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 40 },
  reviewCard: { borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1 },
  reviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  deleteBtn: { width: "100%", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 14, borderWidth: 1, marginTop: 24, minHeight: 48 },
  locHistoryCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1 },
});
