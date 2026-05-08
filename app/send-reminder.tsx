import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  Platform,
  TextInput,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, formatTime } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useMemo, useCallback, useRef } from "react";
import {
  getServiceDisplayName,
  stripPhoneFormat,
  formatPhoneNumber,
  formatDateLong,
  formatTimeDisplay,
  generateReminderMessage,
  buildPriceLine,
  formatFullAddress,
  minutesToTime,
  timeToMinutes,
  PUBLIC_BOOKING_URL,
  LIME_OF_TIME_FOOTER,
  appendLimeFooter,
  ReminderTemplate,
  DEFAULT_REMINDER_TEMPLATES,
  STATUS_TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
  TemplateCategory,
} from "@/lib/types";

function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, val);
  }
  return result + LIME_OF_TIME_FOOTER;
}

const VARIABLES = [
  { label: "{clientName}", description: "Client's name" },
  { label: "{businessName}", description: "Business name" },
  { label: "{service}", description: "Service name" },
  { label: "{date}", description: "Appointment date" },
  { label: "{time}", description: "Appointment time" },
  { label: "{location}", description: "Location" },
  { label: "{priceLine}", description: "Smart pricing block (total, discounts, gift cards)" },
  { label: "{phone}", description: "Business phone" },
  { label: "{bookingUrl}", description: "Booking link" },
  { label: "{reviewUrl}", description: "Review link" },
];

export default function SendReminderScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { state, dispatch, getServiceById, getClientById, getLocationById, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { hp } = useResponsive();

  const appointment = useMemo(
    () => state.appointments.find((a) => a.id === appointmentId),
    [state.appointments, appointmentId]
  );
  const client = useMemo(
    () => (appointment ? getClientById(appointment.clientId) : null),
    [appointment, getClientById]
  );
  const service = useMemo(
    () => (appointment ? getServiceById(appointment.serviceId) : null),
    [appointment, getServiceById]
  );
  const assignedLocation = useMemo(
    () => (appointment?.locationId ? getLocationById(appointment.locationId) : null),
    [appointment, getLocationById]
  );

  const biz = state.settings;
  const profile = biz.profile ?? {};

  // Reminder templates from store (fall back to defaults if empty)
  const allReminderTemplates: ReminderTemplate[] = useMemo(() => {
    const stored = state.reminderTemplates ?? [];
    return stored.length > 0 ? stored : DEFAULT_REMINDER_TEMPLATES;
  }, [state.reminderTemplates]);

  // IDs of the 5 built-in default time-based templates that should NOT appear
  // in the Send Reminder quick-select list (they live in the Template Library instead).
  // Library templates added by the user (even if they have minutesBefore set) should still show.
  const DEFAULT_TIME_BASED_IDS = new Set(["rt-30m", "rt-1h", "rt-2h", "rt-6h", "rt-24h"]);

  // Filter templates by appointment status, and exclude the 5 built-in time-based defaults
  const reminderTemplates: ReminderTemplate[] = useMemo(() => {
    const withoutTimeBased = allReminderTemplates.filter((t) => !DEFAULT_TIME_BASED_IDS.has(t.id));
    if (!appointment) return withoutTimeBased;
    const status = appointment.status as string;
    const allowedCategories = STATUS_TEMPLATE_CATEGORIES[status];
    if (!allowedCategories) return withoutTimeBased;
    return withoutTimeBased.filter(
      (t) => !t.category || allowedCategories.includes(t.category as TemplateCategory)
    );
  }, [allReminderTemplates, appointment]);

  // Build message variables from appointment context
  const tplVars = useMemo(() => {
    if (!appointment || !client) return null;
    const svc = service;
    const primarySvcName = svc ? getServiceDisplayName(svc) : "your appointment";
    const bizName = biz.businessName;
    const locPhone = assignedLocation?.phone || profile.phone || "";
    const locCity = assignedLocation?.city ?? profile.city ?? "";
    const locState = assignedLocation?.state ?? profile.state ?? "";
    const locZip = assignedLocation?.zipCode ?? profile.zipCode ?? "";
    const addr = assignedLocation?.address || profile.address || "";
    const locName = assignedLocation?.name;
    const locId = assignedLocation?.id;
    const slug = biz.customSlug || bizName.replace(/\s+/g, "-").toLowerCase();
    const fullAddrStr = formatFullAddress(addr, locCity, locState, locZip);
    const locLine = locName ? (fullAddrStr ? `${locName} — ${fullAddrStr}` : locName) : fullAddrStr;
    const bookUrl = locId
      ? `${PUBLIC_BOOKING_URL}/book/${slug}?location=${locId}`
      : `${PUBLIC_BOOKING_URL}/book/${slug}`;
    const reviewUrl = `${PUBLIC_BOOKING_URL}/review/${slug}`;

    // Build multi-service expansion for {service} and {time} variables
    const extraServiceItems = (appointment.extraItems ?? []).filter(e => e.type === 'service');
    const hasMultiService = extraServiceItems.length > 0;

    let serviceName: string;
    let timeDisplay: string;
    let totalPrice: string;

    if (hasMultiService) {
      // Build sequential time blocks
      const startMins = timeToMinutes(appointment.time);
      const primaryDuration = svc?.duration ?? appointment.duration;
      const serviceLines: string[] = [];

      // Primary service block
      const primaryStart = minutesToTime(startMins);
      const primaryEnd = minutesToTime(startMins + primaryDuration);
      const primaryPrice = svc?.price ?? 0;
      serviceLines.push(
        `• ${primarySvcName} (${primaryDuration} min) ${formatTimeDisplay(primaryStart)}–${formatTimeDisplay(primaryEnd)} — $${primaryPrice.toFixed(2)}`
      );

      // Extra service blocks
      let cursor = startMins + primaryDuration;
      for (const item of extraServiceItems) {
        const itemStart = minutesToTime(cursor);
        const itemEnd = minutesToTime(cursor + item.duration);
        serviceLines.push(
          `• ${item.name} (${item.duration} min) ${formatTimeDisplay(itemStart)}–${formatTimeDisplay(itemEnd)} — $${item.price.toFixed(2)}`
        );
        cursor += item.duration;
      }

      serviceName = serviceLines.join('\n');

      // {time} = full window start → end of last service
      const windowEnd = minutesToTime(cursor);
      timeDisplay = `${formatTimeDisplay(appointment.time)}–${formatTimeDisplay(windowEnd)}`;

      // {price} = total
      const rawTotal = appointment.totalPrice ?? (primaryPrice + extraServiceItems.reduce((s, e) => s + e.price, 0));
      totalPrice = `$${rawTotal.toFixed(2)}`;
    } else {
      serviceName = primarySvcName;
      timeDisplay = formatTimeDisplay(appointment.time);
      totalPrice = appointment.totalPrice != null ? `$${appointment.totalPrice.toFixed(2)}` : (svc ? `$${svc.price.toFixed(2)}` : "");
    }

    // Build smart pricing block
    const priceLine = buildPriceLine({
      totalPrice: appointment.totalPrice,
      discountAmount: appointment.discountAmount,
      discountName: appointment.discountName,
      giftUsedAmount: appointment.giftUsedAmount,
      paymentStatus: appointment.paymentStatus,
    });

    return {
      clientName: client.name,
      businessName: bizName,
      serviceName,
      service: serviceName,
      duration: String(appointment.duration),
      date: appointment.date,
      time: timeDisplay,
      price: totalPrice,
      total: totalPrice,
      priceLine,
      location: locLine,
      phone: formatPhoneNumber(stripPhoneFormat(locPhone)),
      clientPhone: client.phone ?? "",
      bookingUrl: bookUrl,
      reviewUrl,
      addr,
      locCity,
      locState,
      locZip,
      locName: locName ?? "",
      locId: locId ?? "",
      locPhone,
    };
  }, [appointment, client, service, assignedLocation, biz, profile]);

  // Generate default reminder message
  const defaultMessage = useMemo(() => {
    if (!tplVars || !appointment) return "";
    const customTpl = biz.smsTemplates?.reminder;
    if (customTpl) return applyTemplate(customTpl, tplVars);
    return generateReminderMessage(
      tplVars.businessName,
      tplVars.addr,
      tplVars.clientName,
      tplVars.serviceName,
      appointment.duration,
      appointment.date,
      appointment.time,
      tplVars.locPhone,
      tplVars.locName || undefined,
      tplVars.locCity,
      tplVars.locState,
      tplVars.locZip,
      appointment.totalPrice,
      appointment.discountAmount,
      appointment.discountName,
      appointment.giftUsedAmount,
      appointment.paymentStatus
    );
  }, [tplVars, appointment, biz.smsTemplates]);

  // Category pill filter (null = All)
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | null>(null);

  // Unique categories present in the filtered reminder templates (excluding "Default")
  const availableCategories = useMemo<TemplateCategory[]>(() => {
    const seen = new Set<TemplateCategory>();
    reminderTemplates.forEach((t) => {
      if (t.category) seen.add(t.category as TemplateCategory);
    });
    return Array.from(seen);
  }, [reminderTemplates]);

  // Templates further filtered by selected category pill
  const visibleTemplates = useMemo(() => {
    if (!selectedCategory) return reminderTemplates;
    return reminderTemplates.filter((t) => t.category === selectedCategory);
  }, [reminderTemplates, selectedCategory]);

  // Selected template (null = use default reminder message)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // Compute the current message body
  const currentMessage = useMemo(() => {
    if (editingBody !== null) return editingBody;
    if (selectedTemplateId) {
      const tpl = reminderTemplates.find((t) => t.id === selectedTemplateId);
      if (tpl?.customMessage && tplVars) {
        return applyTemplate(tpl.customMessage, tplVars);
      }
    }
    return defaultMessage;
  }, [editingBody, selectedTemplateId, reminderTemplates, tplVars, defaultMessage]);

  const openEditor = useCallback(() => {
    setEditingBody(currentMessage);
    setShowEditor(true);
  }, [currentMessage]);

  const handleSendSMS = useCallback(() => {
    if (!client?.phone) {
      Alert.alert("No Phone Number", "This client doesn't have a phone number on file.");
      return;
    }
    if (!appointment) return;
    const rawPhone = stripPhoneFormat(client.phone);
    const message = currentMessage;

    const doSend = () => {
      if (Platform.OS === "web") {
        Alert.alert("SMS Message", message);
        return;
      }
      const separator = Platform.OS === "ios" ? "&" : "?";
      const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(message)}`;
      Linking.openURL(url).catch(() => Alert.alert("SMS", message));

      // Mark reminder as sent in store
      dispatch({
        type: "MARK_REMINDER_SENT",
        payload: {
          appointmentId: appointment.id,
          templateId: selectedTemplateId ?? "default",
          sentAt: new Date().toISOString(),
        },
      });
      syncToDb({
        type: "MARK_REMINDER_SENT",
        payload: {
          appointmentId: appointment.id,
          templateId: selectedTemplateId ?? "default",
          sentAt: new Date().toISOString(),
        },
      });
    };

    doSend();
  }, [client, appointment, currentMessage, selectedTemplateId, dispatch, syncToDb]);

  // ── Guard ──────────────────────────────────────────────────────────────
  if (!appointment || !client) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>Appointment or client not found.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.primary }}>Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const endTime = formatTimeDisplay(minutesToTime(timeToMinutes(appointment.time) + appointment.duration));

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, paddingTop: 8, paddingHorizontal: hp }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="arrow.left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, marginLeft: 16, flex: 1 }}>
          Send Reminder
        </Text>
      </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40 }}
      
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Client + Appointment Summary */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>
                {client.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{client.name}</Text>
              {client.phone ? (
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
                  {formatPhoneNumber(stripPhoneFormat(client.phone))}
                </Text>
              ) : (
                <Text style={{ fontSize: 12, color: colors.error, marginTop: 1 }}>No phone number</Text>
              )}
            </View>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <IconSymbol name="calendar" size={13} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600" }}>
                {new Date(appointment.date + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric",
                })}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <IconSymbol name="clock" size={13} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.foreground }}>
                {formatTime(appointment.time)} – {endTime}
              </Text>
            </View>
            {service && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: service.color ?? colors.primary }} />
                <Text style={{ fontSize: 13, color: colors.foreground }}>{service.name}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Template Selector */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginHorizontal: 2 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
            Choose Template
          </Text>
          <Pressable
            onPress={() => router.push({ pathname: "/template-library" as any })}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 4 })}
          >
            <IconSymbol name="plus" size={13} color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Browse Library</Text>
          </Pressable>
        </View>
        {/* Category pill filter — only shown when there are multiple categories */}
        {availableCategories.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
            style={{ marginBottom: 2 }}
          >
            {/* "All" pill */}
            <Pressable
              onPress={() => setSelectedCategory(null)}
              style={({ pressed }) => ([
                styles.categoryPill,
                {
                  backgroundColor: selectedCategory === null ? colors.primary : colors.surface,
                  borderColor: selectedCategory === null ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ])}
            >
              <Text style={[
                styles.categoryPillText,
                { color: selectedCategory === null ? "#fff" : colors.muted },
              ]}>
                All
              </Text>
            </Pressable>

            {availableCategories.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setSelectedCategory(isActive ? null : cat)}
                  style={({ pressed }) => ([
                    styles.categoryPill,
                    {
                      backgroundColor: isActive ? CATEGORY_PILL_COLORS[cat] ?? colors.primary : colors.surface,
                      borderColor: isActive ? CATEGORY_PILL_COLORS[cat] ?? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ])}
                >
                  <Text style={[
                    styles.categoryPillText,
                    { color: isActive ? "#fff" : colors.muted },
                  ]}>
                    {TEMPLATE_CATEGORY_LABELS[cat]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Empty state when category filter yields no templates */}
        {visibleTemplates.length === 0 && selectedCategory !== null && (
          <View style={{ alignItems: "center", paddingVertical: 16, marginBottom: 8 }}>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
              No {TEMPLATE_CATEGORY_LABELS[selectedCategory]} templates saved.{"\n"}
              Browse the library to add some.
            </Text>
          </View>
        )}

        <View style={{ gap: 8, marginBottom: 16 }}>
          {/* Default reminder option */}
          <Pressable
            onPress={() => { setSelectedTemplateId(null); setEditingBody(null); }}
            style={({ pressed }) => [
              styles.templateChip,
              {
                borderColor: selectedTemplateId === null ? colors.primary : colors.border,
                backgroundColor: selectedTemplateId === null ? colors.primary + "12" : colors.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: selectedTemplateId === null ? colors.primary + "20" : colors.border + "40", alignItems: "center", justifyContent: "center" }}>
                <IconSymbol name="bell.fill" size={16} color={selectedTemplateId === null ? colors.primary : colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: selectedTemplateId === null ? colors.primary : colors.foreground }}>
                  Default Reminder
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                  Standard appointment reminder message
                </Text>
              </View>
              {selectedTemplateId === null && (
                <IconSymbol name="checkmark.circle.fill" size={20} color={colors.primary} />
              )}
            </View>
          </Pressable>

          {/* Custom reminder templates — filtered by category pill */}
          {visibleTemplates.map((tpl) => {
            const isSelected = selectedTemplateId === tpl.id;
            // First line of the custom message as subtitle (variables not yet resolved)
            const previewLine = tpl.customMessage
              ? tpl.customMessage.split("\n")[0].substring(0, 70) + (tpl.customMessage.length > 70 ? "…" : "")
              : "Uses default reminder message";
            const canRemove = !DEFAULT_REMINDER_TEMPLATES.some((d) => d.id === tpl.id);
            return (
              <View key={tpl.id} style={{ position: "relative" }}>
                <Pressable
                  onPress={() => { setSelectedTemplateId(tpl.id); setEditingBody(null); }}
                  style={({ pressed }) => [
                    styles.templateChip,
                    {
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected ? colors.primary + "12" : colors.surface,
                      opacity: pressed ? 0.7 : 1,
                      paddingRight: canRemove ? 48 : 12,
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isSelected ? colors.primary + "20" : colors.border + "40", alignItems: "center", justifyContent: "center" }}>
                      <IconSymbol name="clock" size={16} color={isSelected ? colors.primary : colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: isSelected ? colors.primary : colors.foreground }}>
                        {tpl.label}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                        {previewLine}
                      </Text>
                    </View>
                    {isSelected && (
                      <IconSymbol name="checkmark.circle.fill" size={20} color={colors.primary} />
                    )}
                  </View>
                </Pressable>
                {canRemove && (
                  <Pressable
                    onPress={() => {
                      Alert.alert(
                        "Remove Template",
                        `Remove "${tpl.label}" from your templates?`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove", style: "destructive",
                            onPress: () => {
                              if (selectedTemplateId === tpl.id) { setSelectedTemplateId(null); setEditingBody(null); }
                              dispatch({ type: "DELETE_REMINDER_TEMPLATE", payload: tpl.id });
                              syncToDb({ type: "DELETE_REMINDER_TEMPLATE", payload: tpl.id });
                            },
                          },
                        ]
                      );
                    }}
                    style={({ pressed }) => ({
                      position: "absolute", right: 8, top: 0, bottom: 0,
                      alignItems: "center", justifyContent: "center",
                      width: 36, opacity: pressed ? 0.5 : 1,
                    })}
                  >
                    <IconSymbol name="xmark.circle.fill" size={20} color={colors.error} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        {/* Message Preview */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginHorizontal: 2 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>Message Preview</Text>
          <Pressable
            onPress={openEditor}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 4 })}
          >
            <IconSymbol name="pencil" size={13} color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Edit</Text>
          </Pressable>
        </View>
        <View style={[styles.previewBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>
            {currentMessage}
          </Text>
        </View>

        {/* Character count */}
        <Text style={{ fontSize: 11, color: colors.muted, textAlign: "right", marginTop: 4, marginBottom: 16 }}>
          {currentMessage.length} characters
        </Text>

        {/* Send Button */}
        {client.phone ? (
          <Pressable
            onPress={handleSendSMS}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <IconSymbol name="message.fill" size={18} color="#FFFFFF" />
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFFFFF", marginLeft: 8 }}>
              Send via SMS
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.sendButton, { backgroundColor: colors.border }]}>
            <IconSymbol name="message.fill" size={18} color={colors.muted} />
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.muted, marginLeft: 8 }}>
              No phone number on file
            </Text>
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Message Editor Modal */}
      <Modal
        visible={showEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditor(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Modal Header */}
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}>
            <Pressable
              onPress={() => setShowEditor(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ fontSize: 16, color: colors.primary }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>Edit Message</Text>
            <Pressable
              onPress={() => {
                // Enforce footer on save
                if (editingBody !== null) {
                  setEditingBody(appendLimeFooter(editingBody));
                }
                setShowEditor(false);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>Done</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Variable chips */}
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8 }}>
              Insert Variable
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {VARIABLES.map((v) => (
                  <Pressable
                    key={v.label}
                    onPress={() => setEditingBody((prev) => (prev ?? "") + v.label)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: colors.primary + "15",
                      borderWidth: 1,
                      borderColor: colors.primary + "40",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {/* Message body editor */}
            <TextInput
              value={editingBody ?? ""}
              onChangeText={setEditingBody}
              multiline
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 14,
                fontSize: 13,
                color: colors.foreground,
                minHeight: 200,
                textAlignVertical: "top",
                lineHeight: 20,
              }}
              placeholder="Enter your reminder message..."
              placeholderTextColor={colors.muted}
            />

            {/* Locked footer preview */}
            <View style={{
              marginTop: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              padding: 12,
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
            }}>
              <IconSymbol name="lock.fill" size={13} color={colors.muted} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>
                  Always appended — cannot be removed:
                </Text>
                <Text style={{ fontSize: 13, color: colors.foreground, fontStyle: "italic" }}>
                  {LIME_OF_TIME_FOOTER.trim()}
                </Text>
              </View>
            </View>

            {/* Character count */}
            <Text style={{ fontSize: 11, color: colors.muted, textAlign: "right", marginTop: 6 }}>
              {(editingBody ?? "").length} characters
            </Text>

            {/* Reset to default */}
            <Pressable
              onPress={() => setEditingBody(defaultMessage)}
              style={({ pressed }) => ({
                marginTop: 12,
                alignSelf: "center",
                opacity: pressed ? 0.6 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              })}
            >
              <IconSymbol name="arrow.clockwise" size={13} color={colors.muted} />
              <Text style={{ fontSize: 12, color: colors.muted }}>Reset to default</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const CATEGORY_PILL_COLORS: Partial<Record<TemplateCategory, string>> = {
  upcoming:   "#3B82F6",
  confirmed:  "#22C55E",
  pending:    "#F59E0B",
  cancelled:  "#EF4444",
  completed:  "#8B5CF6",
  no_show:    "#F97316",
  reschedule: "#06B6D4",
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  templateChip: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
  },
  previewBox: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 8,
  },
  categoryPill: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
