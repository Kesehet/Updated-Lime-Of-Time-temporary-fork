import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Platform,
  StyleSheet,
  Modal,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useStore } from "@/lib/store";
import { LIME_OF_TIME_FOOTER, SmsTemplates } from "@/lib/types";
import * as Haptics from "expo-haptics";
import { FuturisticBackground } from "@/components/futuristic-background";


// ─── Default template bodies (without the footer) ─────────────────────────────
const DEFAULT_BODIES: Record<keyof SmsTemplates, string> = {
  confirmation: `Dear {clientName},

Your appointment has been confirmed!

📋 Service: {serviceName} ({duration} min)
📅 Date: {date}
⏰ Time: {time}
📍 Location: {location}
🏢 Business: {businessName}
📞 Contact: {phone}

Please arrive 5 minutes early. If you need to reschedule or cancel, please contact us at least 2 hours before your appointment.

🔗 Book again: {bookingUrl}
⭐ Leave a review: {reviewUrl}

Thank you for choosing {businessName}!`,

  reminder: `Dear {clientName},

This is a friendly reminder about your upcoming appointment.

📋 Service: {serviceName} ({duration} min)
📅 Date: {date}
⏰ Time: {time}
📍 Location: {location}
🏢 Business: {businessName}
📞 Contact: {phone}

Please arrive 5 minutes early. If you need to reschedule or cancel, please contact us as soon as possible.

See you soon!
{businessName}`,

  cancellation: `Dear {clientName},

Your appointment has been cancelled.

📋 Service: {serviceName}
📅 Date: {date}
⏰ Time: {time}
📍 Location: {location}

If you would like to reschedule, please visit our booking page or contact us directly.

📞 Contact: {phone}

Thank you.
{businessName}`,

  completed: `Dear {clientName},

Thank you for visiting {businessName}! Your appointment for {serviceName} on {date} has been completed.

We hope you had a great experience. We'd love to see you again!

📍 {location}
📞 {phone}

🔗 Book again: {bookingUrl}

Best regards,
{businessName}`,

  newBooking: `New booking request from {clientName} for {serviceName} on {date} at {time}.
📞 Client: {clientPhone}
Open the app to review and accept or decline.`,
  followUp: `Dear {clientName},
Thank you for being a valued client of {businessName}! We'd love to schedule your next appointment.
📍 {location}
📞 Contact: {phone}
🔗 Book now: {bookingUrl}
Best regards,
{businessName}`,
  noShow: `Hi {clientName}, we noticed you missed your appointment for {serviceName} on {date} at {time}. We'd love to see you — tap to rebook: {bookingUrl}

Best regards,
{businessName}`,
};

const TEMPLATE_META: { key: keyof SmsTemplates; label: string; icon: string; description: string }[] = [
  {
    key: "confirmation",
    label: "Appointment Confirmed",
    icon: "checkmark.circle.fill",
    description: "Sent to client when you confirm/accept their appointment",
  },
  {
    key: "reminder",
    label: "Upcoming Reminder",
    icon: "clock.fill",
    description: "Sent to client as a reminder before their appointment",
  },
  {
    key: "cancellation",
    label: "Appointment Cancelled",
    icon: "xmark.circle.fill",
    description: "Sent to client when their appointment is cancelled",
  },
  {
    key: "completed",
    label: "Appointment Completed",
    icon: "star.fill",
    description: "Sent to client after their appointment is marked complete",
  },
  {
    key: "newBooking",
    label: "New Booking Alert",
    icon: "bell.fill",
    description: "Sent to you (the owner) when a new booking request arrives",
  },
  {
    key: "followUp",
    label: "Follow-Up / Re-book",
    icon: "message.fill",
    description: "Sent to client from the Clients page as a re-booking nudge",
  },
  {
    key: "noShow",
    label: "No-Show Notification",
    icon: "person.fill.xmark",
    description: "Sent to client when you mark their appointment as no-show (Growth plan)",
  },
];

const VARIABLES = [
  { tag: "{clientName}", hint: "Client's full name" },
  { tag: "{businessName}", hint: "Your business name" },
  { tag: "{serviceName}", hint: "Service name" },
  { tag: "{duration}", hint: "Duration in minutes" },
  { tag: "{date}", hint: "Appointment date" },
  { tag: "{time}", hint: "Appointment time" },
  { tag: "{location}", hint: "Location name & address" },
  { tag: "{phone}", hint: "Business phone" },
  { tag: "{clientPhone}", hint: "Client's phone" },
  { tag: "{bookingUrl}", hint: "Your booking page link" },
  { tag: "{reviewUrl}", hint: "Your review page link" },
  { tag: "{paymentOptions}", hint: "Zelle/Cash App/Venmo handles" },
];

export default function SmsTemplatesScreen() {
  const router = useRouter();
  const colors = useColors();
  const { state, dispatch, syncToDb } = useStore();
  const templates = state.settings.smsTemplates ?? {};

  const [editingKey, setEditingKey] = useState<keyof SmsTemplates | null>(null);
  const [editBody, setEditBody] = useState("");
  const inputRef = useRef<TextInput>(null);

  const openEditor = useCallback((key: keyof SmsTemplates) => {
    const saved = templates[key];
    setEditBody(saved ?? DEFAULT_BODIES[key]);
    setEditingKey(key);
  }, [templates]);

  const closeEditor = useCallback(() => {
    setEditingKey(null);
    setEditBody("");
  }, []);

  const saveTemplate = useCallback(() => {
    if (!editingKey) return;
    const updated: SmsTemplates = { ...templates, [editingKey]: editBody.trim() || undefined };
    const action = { type: "UPDATE_SETTINGS" as const, payload: { smsTemplates: updated } };
    dispatch(action);
    syncToDb(action);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeEditor();
  }, [editingKey, editBody, templates, dispatch, syncToDb, closeEditor]);

  const resetTemplate = useCallback((key: keyof SmsTemplates) => {
    Alert.alert(
      "Reset to Default",
      "This will restore the original message template. Your customizations will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            const updated: SmsTemplates = { ...templates };
            delete updated[key];
            const action = { type: "UPDATE_SETTINGS" as const, payload: { smsTemplates: updated } };
            dispatch(action);
            syncToDb(action);
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  }, [templates, dispatch, syncToDb]);

  const insertVariable = useCallback((tag: string) => {
    setEditBody((prev) => prev + tag);
    inputRef.current?.focus();
  }, []);

  const isCustomized = (key: keyof SmsTemplates) => !!templates[key];

  const editingMeta = editingKey ? TEMPLATE_META.find((m) => m.key === editingKey) : null;

  return (
    <ScreenContainer>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>SMS Messages</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Info card */}
        <View style={[styles.infoCard, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}>
          <IconSymbol name="message.fill" size={18} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.foreground }]}>
            Customize the SMS messages sent to your clients. Each message always ends with{" "}
            <Text style={{ fontWeight: "700" }}>"Sent via Lime Of Time"</Text> — this cannot be removed.
          </Text>
        </View>

        {/* Template cards */}
        {TEMPLATE_META.map((meta) => {
          const customized = isCustomized(meta.key);
          return (
            <View
              key={meta.key}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <IconSymbol name={meta.icon as any} size={18} color={colors.primary} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{meta.label}</Text>
                    <Text style={[styles.cardDesc, { color: colors.muted }]}>{meta.description}</Text>
                  </View>
                  {customized && (
                    <View style={[styles.customBadge, { backgroundColor: colors.success + "20" }]}>
                      <Text style={[styles.customBadgeText, { color: colors.success }]}>Custom</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Preview snippet */}
              <View style={[styles.previewBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.previewText, { color: colors.muted }]} numberOfLines={3}>
                  {(templates[meta.key] ?? DEFAULT_BODIES[meta.key]).split("\n").join(" ")}
                </Text>
                <Text style={[styles.previewFooter, { color: colors.primary }]}>
                  …Sent via Lime Of Time
                </Text>
              </View>

              {/* Actions */}
              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => openEditor(meta.key)}
                  style={({ pressed }) => [
                    styles.editBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <IconSymbol name="pencil" size={14} color="#fff" />
                  <Text style={styles.editBtnText}>Edit</Text>
                </Pressable>
                {customized && (
                  <Pressable
                    onPress={() => resetTemplate(meta.key)}
                    style={({ pressed }) => [
                      styles.resetBtn,
                      { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.resetBtnText, { color: colors.muted }]}>Reset</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={editingKey !== null} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: colors.background }}
          behavior="padding"
        >
          {/* Modal header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable
              onPress={closeEditor}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 8 }]}
            >
              <Text style={{ color: colors.muted, fontSize: 16 }}>Cancel</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingMeta?.label}</Text>
            <Pressable
              onPress={saveTemplate}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 8 }]}
            >
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Variable chips */}
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>INSERT VARIABLE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {VARIABLES.map((v) => (
                <Pressable
                  key={v.tag}
                  onPress={() => insertVariable(v.tag)}
                  style={({ pressed }) => [
                    styles.varChip,
                    { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40", opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.varChipText, { color: colors.primary }]}>{v.tag}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Message body editor */}
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>MESSAGE BODY</Text>
            <TextInput
              ref={inputRef}
              value={editBody}
              onChangeText={setEditBody}
              multiline
              style={[
                styles.textEditor,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              placeholderTextColor={colors.muted}
              placeholder="Type your message here…"
              autoCorrect={false}
              autoCapitalize="sentences"
            />

            {/* Locked footer preview */}
            <View style={[styles.footerPreview, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
              <IconSymbol name="lock.fill" size={13} color={colors.primary} />
              <Text style={[styles.footerPreviewText, { color: colors.primary }]}>
                This footer is always appended and cannot be removed:
              </Text>
              <Text style={[styles.footerPreviewValue, { color: colors.foreground }]}>
                {LIME_OF_TIME_FOOTER.trim()}
              </Text>
            </View>

            {/* Full preview */}
            <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 16 }]}>FULL MESSAGE PREVIEW</Text>
            <View style={[styles.fullPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.fullPreviewText, { color: colors.foreground }]}>
                {editBody.trim() + LIME_OF_TIME_FOOTER}
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    width: 70,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    marginBottom: 10,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  cardDesc: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  customBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 8,
    alignSelf: "flex-start",
  },
  customBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  previewBox: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 10,
  },
  previewText: {
    fontSize: 12,
    lineHeight: 17,
  },
  previewFooter: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  editBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  resetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  resetBtnText: {
    fontSize: 13,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  varChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 6,
  },
  varChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  textEditor: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    lineHeight: 20,
    minHeight: 220,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  footerPreview: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  footerPreviewText: {
    fontSize: 12,
    fontWeight: "500",
  },
  footerPreviewValue: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  fullPreview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  fullPreviewText: {
    fontSize: 12,
    lineHeight: 19,
  },
});
