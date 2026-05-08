import { useState, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FuturisticBackground } from "@/components/futuristic-background";
import { trpc } from "@/lib/trpc";
import { UpgradeSheet } from "@/components/upgrade-sheet";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotifEvent {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  channel: "push" | "email";
  /** Template variables available in the message */
  vars: string[];
  /** Default message template */
  defaultMessage: string;
}

const NOTIF_EVENTS: NotifEvent[] = [
  {
    key: "pushOnNewBooking",
    label: "New Booking Request",
    description: "Sent to you when a client submits a new booking.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}", "{time}", "{location}"],
    defaultMessage:
      "📅 New booking from {clientName} — {service} on {date} at {time} ({location}). Open the app to review and confirm.",
  },
  {
    key: "pushOnCancellation",
    label: "Client Cancellation",
    description: "Sent to you when a client cancels their appointment.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}", "{time}"],
    defaultMessage:
      "❌ {clientName} has cancelled their {service} appointment scheduled for {date} at {time}. The slot is now available.",
  },
  {
    key: "pushOnReschedule",
    label: "Client Reschedule",
    description: "Sent to you when a client requests to reschedule.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{oldDate}", "{oldTime}", "{newDate}", "{newTime}"],
    defaultMessage:
      "🔄 {clientName} rescheduled their {service} from {oldDate} at {oldTime} to {newDate} at {newTime}. Please review the change.",
  },
  {
    key: "pushOnWaitlist",
    label: "Waitlist Entry",
    description: "Sent to you when a client joins the waitlist.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}"],
    defaultMessage:
      "⏳ {clientName} has joined the waitlist for {service} on {date}. You will be notified when a slot opens.",
  },
  {
    key: "pushOnReminder",
    label: "Upcoming Appointment Reminder",
    description: "Push notification sent to you before each confirmed appointment.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}", "{time}"],
    defaultMessage:
      "⏰ Reminder: {clientName} — {service} at {time} on {date}. Please ensure everything is ready.",
  },
  {
    key: "emailOnNewBooking",
    label: "New Booking (Email to You)",
    description: "Email sent to your business address on each new booking.",
    channel: "email",
    vars: ["{clientName}", "{service}", "{date}", "{time}", "{location}", "{notes}"],
    defaultMessage:
      "You have received a new booking request from {clientName} for {service} on {date} at {time} at {location}. Notes: {notes}. Log in to confirm or decline.",
  },
  {
    key: "emailClientOnConfirmation",
    label: "Confirmation to Client",
    description: "Email sent to the client when you confirm their appointment.",
    channel: "email",
    vars: ["{clientName}", "{service}", "{date}", "{time}", "{location}", "{businessName}"],
    defaultMessage:
      "Hi {clientName}, your appointment for {service} has been confirmed for {date} at {time} at {location}. We look forward to seeing you! — {businessName}",
  },
  {
    key: "emailClientOnCancellation",
    label: "Cancellation Notice to Client",
    description: "Email sent to the client when their appointment is cancelled.",
    channel: "email",
    vars: ["{clientName}", "{service}", "{date}", "{time}", "{businessName}"],
    defaultMessage:
      "Hi {clientName}, your appointment for {service} on {date} at {time} has been cancelled. Please contact us to reschedule. — {businessName}",
  },
  {
    key: "emailClientOnComplete",
    label: "Completion Follow-up to Client",
    description: "Email sent to the client when their appointment is marked completed.",
    channel: "email",
    vars: ["{clientName}", "{service}", "{date}", "{businessName}"],
    defaultMessage:
      "Hi {clientName}, thank you for visiting us for {service} on {date}! We hope to see you again soon. — {businessName}",
  },
  {
    key: "emailClientOnPaymentConfirmed",
    label: "Payment Receipt to Client",
    description: "Email sent to the client when you mark their appointment as paid.",
    channel: "email",
    vars: ["{clientName}", "{service}", "{date}", "{amount}", "{paymentMethod}", "{businessName}"],
    defaultMessage:
      "Hi {clientName}, your payment of {amount} for {service} on {date} has been received. Thank you! — {businessName}",
  },
];

const CLIENT_SMS_EVENTS: NotifEvent[] = [
  {
    key: "smsClientOnConfirmation",
    label: "Confirmation SMS to Client",
    description: "SMS sent to the client when you confirm their appointment.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}", "{time}", "{location}"],
    defaultMessage:
      "Hi {clientName}, your {service} appointment on {date} at {time} is confirmed! 📍 {location}",
  },
  {
    key: "smsClientOnCancellation",
    label: "Cancellation SMS to Client",
    description: "SMS sent to the client when their appointment is cancelled.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}", "{time}"],
    defaultMessage:
      "Hi {clientName}, your {service} appointment on {date} at {time} has been cancelled. Please contact us to reschedule.",
  },
  {
    key: "smsClientOnNoShow",
    label: "No-Show SMS to Client",
    description: "SMS sent to the client when you mark their appointment as no-show, with a rebooking link.",
    channel: "push",
    vars: ["{clientName}", "{service}", "{date}", "{time}", "{bookingUrl}"],
    defaultMessage:
      "Hi {clientName}, we noticed you missed your {service} on {date} at {time}. We\u2019d love to see you \u2014 tap to rebook: {bookingUrl}",
  },
];

// ─── Message Preview ──────────────────────────────────────────────────────────

function MessagePreview({ template, vars }: { template: string; vars: string[] }) {
  const colors = useColors();
  const preview = vars.reduce((msg, v) => {
    const sampleMap: Record<string, string> = {
      "{clientName}": "Jane Smith",
      "{service}": "Haircut & Style",
      "{date}": "Mon, Apr 14",
      "{time}": "2:00 PM",
      "{location}": "Main Street Studio",
      "{notes}": "Prefers no heat styling",
      "{oldDate}": "Mon, Apr 14",
      "{oldTime}": "2:00 PM",
      "{newDate}": "Tue, Apr 15",
      "{newTime}": "3:30 PM",
      "{businessName}": "Lime Of Time",
    };
    return msg.replace(new RegExp(v.replace(/[{}]/g, "\\$&"), "g"), sampleMap[v] ?? v);
  }, template);

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.border,
        marginTop: 10,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Preview
      </Text>
      <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 19 }}>{preview}</Text>
    </View>
  );
}

// ─── Edit Message Modal ───────────────────────────────────────────────────────

function EditMessageModal({
  visible,
  event,
  currentMessage,
  onSave,
  onClose,
}: {
  visible: boolean;
  event: NotifEvent | null;
  currentMessage: string;
  onSave: (msg: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState(currentMessage);

  if (!event) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 16, color: colors.primary }}>Cancel</Text>
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>Edit Message</Text>
          <Pressable
            onPress={() => { onSave(draft); onClose(); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.primary }}>Save</Text>
          </Pressable>
        </View>

              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
            {event.label}
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>{event.description}</Text>

          {/* Available variables */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Available Variables
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {event.vars.map((v) => (
              <Pressable
                key={v}
                onPress={() => setDraft((prev) => prev + v)}
                style={({ pressed }) => ({
                  backgroundColor: colors.primary + "18",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{v}</Text>
              </Pressable>
            ))}
          </View>

          {/* Message editor */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Message
          </Text>
          <TextInput
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: 14,
              fontSize: 14,
              color: colors.foreground,
              borderWidth: 1,
              borderColor: colors.border,
              minHeight: 120,
              textAlignVertical: "top",
            }}
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Enter notification message..."
            placeholderTextColor={colors.muted}
          />

          {/* Reset to default */}
          <Pressable
            onPress={() => setDraft(event.defaultMessage)}
            style={({ pressed }) => ({
              marginTop: 10,
              alignSelf: "flex-end",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 13, color: colors.muted }}>Reset to default</Text>
          </Pressable>

          {/* Live preview */}
          <MessagePreview template={draft} vars={event.vars} />
        </ScrollView>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const colors = useColors();
  const { state, dispatch, syncToDb } = useStore();
  const settings = state.settings;
  const prefs = settings.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES;

  // Custom message templates (stored locally per session; persist via notificationPreferences extension)
  const [customMessages, setCustomMessages] = useState<Partial<Record<keyof NotificationPreferences, string>>>({});
  const [editingEvent, setEditingEvent] = useState<NotifEvent | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);

  const toggleMaster = useCallback(() => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { notificationsEnabled: !settings.notificationsEnabled } };
    dispatch(action);
    syncToDb(action);
  }, [settings.notificationsEnabled, dispatch, syncToDb]);

  const togglePref = useCallback(
    (key: keyof NotificationPreferences) => {
      const current = prefs;
      const updated = { ...current, [key]: !current[key] };
      const action = { type: "UPDATE_SETTINGS" as const, payload: { notificationPreferences: updated } };
      dispatch(action);
      syncToDb(action);
    },
    [prefs, dispatch, syncToDb]
  );

  const handleEditMessage = (event: NotifEvent) => {
    setEditingEvent(event);
    setEditModalVisible(true);
  };

  const handleSaveMessage = (msg: string) => {
    if (!editingEvent) return;
    setCustomMessages((prev) => ({ ...prev, [editingEvent.key]: msg }));
  };

  const pushEvents = NOTIF_EVENTS.filter((e) => e.channel === "push");
  const emailEvents = NOTIF_EVENTS.filter((e) => e.channel === "email");

  const handleLockedTap = () => setUpgradeSheetVisible(true);

  // ── Plan gating ──────────────────────────────────────────────────────────
  const businessOwnerId = state.businessOwnerId;
  const { data: planInfo } = trpc.subscription.getMyPlan.useQuery(
    { businessOwnerId: businessOwnerId! },
    { enabled: !!businessOwnerId, staleTime: 60_000 }
  );
  const smsLevel = planInfo?.limits?.smsLevel ?? "none";
  const hasSmsAccess = smsLevel !== "none"; // growth+ has confirmations; studio/enterprise/admin has full
  const hasEmailAccess = planInfo ? (planInfo.planKey !== "solo" || planInfo.isAdminOverride) : true;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <FuturisticBackground />
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Master toggle */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="bell.fill" size={20} color={colors.primary} />
              <View style={{ marginLeft: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Enable Notifications</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  {settings.notificationsEnabled ? "Notifications are active" : "All notifications are paused"}
                </Text>
              </View>
            </View>
            <Switch
              value={settings.notificationsEnabled}
              onValueChange={toggleMaster}
              trackColor={{ false: colors.border, true: colors.primary + "60" }}
              thumbColor={settings.notificationsEnabled ? colors.primary : colors.muted}
            />
          </View>
        </View>

        {!settings.notificationsEnabled && (
          <View style={{ backgroundColor: colors.warning + "18", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.warning + "40" }}>
            <Text style={{ fontSize: 13, color: colors.warning, lineHeight: 18 }}>
              All notifications are currently disabled. Enable the master toggle above to start receiving alerts.
            </Text>
          </View>
        )}

        {/* Push Notifications */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>Push Notifications</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, marginTop: -4 }}>
          Sent directly to your device. Tap "Edit" to customise the message text.
        </Text>

        {/* ── Auto-Complete Alert (top of push list) ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: settings.notificationsEnabled ? 1 : 0.5 }]}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Auto-Complete Alert</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
                Notifies you when an appointment is automatically marked as completed{settings.autoCompleteEnabled ? ` (${settings.autoCompleteDelayMinutes} min after end time)` : ""}.
              </Text>
            </View>
            <Switch
              value={settings.autoCompleteEnabled && settings.notificationsEnabled}
              onValueChange={() => {
                const action = { type: "UPDATE_SETTINGS" as const, payload: { autoCompleteEnabled: !settings.autoCompleteEnabled } };
                dispatch(action);
                syncToDb(action);
              }}
              trackColor={{ false: colors.border, true: colors.primary + "60" }}
              thumbColor={settings.autoCompleteEnabled ? colors.primary : colors.muted}
              disabled={!settings.notificationsEnabled}
            />
          </View>
          {settings.autoCompleteEnabled && settings.notificationsEnabled && (
            <MessagePreview
              template="✅ Appointment Completed — {clientName}'s {service} on {date} at {time} has been automatically marked as completed. Duration: {duration}."
              vars={["{clientName}", "{service}", "{date}", "{time}", "{duration}"]}
            />
          )}
        </View>

        {pushEvents.map((event) => {
          const enabled = !!prefs[event.key];
          const message = customMessages[event.key] ?? event.defaultMessage;
          return (
            <View
              key={event.key}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: settings.notificationsEnabled ? 1 : 0.5 }]}
            >
              <View style={styles.switchRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{event.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>{event.description}</Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={() => togglePref(event.key)}
                  trackColor={{ false: colors.border, true: colors.primary + "60" }}
                  thumbColor={enabled ? colors.primary : colors.muted}
                  disabled={!settings.notificationsEnabled}
                />
              </View>

              {enabled && settings.notificationsEnabled && (
                <>
                  <MessagePreview template={message} vars={event.vars} />
                  <Pressable
                    onPress={() => handleEditMessage(event)}
                    style={({ pressed }) => ({
                      marginTop: 10,
                      alignSelf: "flex-end",
                      backgroundColor: colors.primary + "15",
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>Edit Message</Text>
                  </Pressable>
                </>
              )}
            </View>
          );
        })}

        {/* Birthday Reminders */}
        <Text style={[styles.sectionHeader, { color: colors.muted, marginTop: 20 }]}>Birthday Reminders</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, marginTop: -4 }}>
          A daily push notification listing all clients with birthdays today.
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: settings.notificationsEnabled ? 1 : 0.5 }]}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Daily Birthday Alert</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
                Fires every morning if any client has a birthday that day. Tapping it opens Birthday Campaigns.
              </Text>
            </View>
            <Switch
              value={(prefs.birthdayReminderEnabled ?? false) && settings.notificationsEnabled}
              onValueChange={() => togglePref("birthdayReminderEnabled")}
              trackColor={{ false: colors.border, true: "#EC489960" }}
              thumbColor={(prefs.birthdayReminderEnabled ?? false) ? "#EC4899" : colors.muted}
              disabled={!settings.notificationsEnabled}
            />
          </View>
          {/* Time picker row — only visible when birthday reminder is enabled */}
          {(prefs.birthdayReminderEnabled ?? false) && settings.notificationsEnabled && (() => {
            const currentHour = prefs.birthdayReminderHour ?? 8;
            const HOURS = [6, 7, 8, 9, 10, 11, 12];
            const fmt = (h: number) => {
              const suffix = h >= 12 ? "PM" : "AM";
              const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
              return `${display}:00 ${suffix}`;
            };
            const setHour = (h: number) => {
              const updated = { ...prefs, birthdayReminderHour: h };
              const action = { type: "UPDATE_SETTINGS" as const, payload: { notificationPreferences: updated } };
              dispatch(action);
              syncToDb(action);
            };
            return (
              <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8 }}>REMINDER TIME</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: "row" }}>
                  {HOURS.map((h) => (
                    <Pressable
                      key={h}
                      onPress={() => setHour(h)}
                      style={[{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: currentHour === h ? "#EC4899" : colors.border,
                        backgroundColor: currentHour === h ? "#EC489915" : colors.background,
                      }]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: currentHour === h ? "#EC4899" : colors.muted }}>
                        {fmt(h)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={{ marginTop: 10, backgroundColor: "#EC489915", borderRadius: 10, padding: 10 }}>
                  <Text style={{ fontSize: 12, color: "#EC4899", lineHeight: 18 }}>
                    Preview: "🎂 Birthday today: Jane Smith. Open Birthday Campaigns to send a greeting!"
                  </Text>
                </View>
              </View>
            );
          })()}
        </View>

        {/* Email Notifications */}
        {!hasEmailAccess && (
          <View style={{ backgroundColor: colors.warning + "18", borderRadius: 12, padding: 12, marginTop: 16, marginBottom: 4, borderWidth: 1, borderColor: colors.warning + "40", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <IconSymbol name="lock.fill" size={16} color={colors.warning} />
            <Text style={{ fontSize: 13, color: colors.warning, flex: 1, lineHeight: 18 }}>
              Email notifications are available on all paid plans (Growth, Studio, Enterprise). Upgrade from Solo to unlock.
            </Text>
          </View>
        )}
        <Text style={[styles.sectionHeader, { color: colors.muted, marginTop: 20 }]}>Email Notifications</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, marginTop: -4 }}>
          Sent via email. Confirmation emails go to your clients; booking alerts go to your business address.
        </Text>

        {emailEvents.map((event) => {
          const enabled = !!prefs[event.key] && hasEmailAccess;
          const message = customMessages[event.key] ?? event.defaultMessage;
          return (
            <Pressable
              key={event.key}
              onPress={!hasEmailAccess ? handleLockedTap : undefined}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: (settings.notificationsEnabled && hasEmailAccess) ? 1 : 0.55 }]}
            >
              <View style={styles.switchRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{event.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>{event.description}</Text>
                </View>
                {!hasEmailAccess ? (
                  <IconSymbol name="lock.fill" size={18} color={colors.muted} />
                ) : (
                  <Switch
                    value={enabled}
                    onValueChange={() => togglePref(event.key)}
                    trackColor={{ false: colors.border, true: colors.primary + "60" }}
                    thumbColor={enabled ? colors.primary : colors.muted}
                    disabled={!settings.notificationsEnabled}
                  />
                )}
              </View>

              {enabled && settings.notificationsEnabled && hasEmailAccess && (
                <>
                  <MessagePreview template={message} vars={event.vars} />
                  <Pressable
                    onPress={() => handleEditMessage(event)}
                    style={({ pressed }) => ({
                      marginTop: 10,
                      alignSelf: "flex-end",
                      backgroundColor: colors.primary + "15",
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>Edit Message</Text>
                  </Pressable>
                </>
              )}
            </Pressable>
          );
        })}

        {/* ── Client Reminder Email ── */}
        <Text style={[styles.sectionHeader, { color: colors.muted, marginTop: 20 }]}>Client Reminder Email</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, marginTop: -4 }}>
          Automatically email clients before their confirmed appointment. Choose how far in advance below.
        </Text>
        <Pressable
          onPress={!hasEmailAccess ? handleLockedTap : undefined}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: (settings.notificationsEnabled && hasEmailAccess) ? 1 : 0.55 }]}
        >
          <View style={styles.switchRow}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1, marginRight: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12, backgroundColor: "#0ea5e918" }}>
                <IconSymbol name="bell.fill" size={18} color="#0ea5e9" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Appointment Reminder Email</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
                  Sends clients a reminder email before their appointment with date, time, location, and a Google Calendar link.
                </Text>
              </View>
            </View>
            {!hasEmailAccess ? (
              <IconSymbol name="lock.fill" size={18} color={colors.muted} />
            ) : (
              <Switch
                value={(prefs.emailOnReminder ?? false) && settings.notificationsEnabled}
                onValueChange={() => togglePref("emailOnReminder")}
                trackColor={{ false: colors.border, true: "#0ea5e960" }}
                thumbColor={(prefs.emailOnReminder ?? false) ? "#0ea5e9" : colors.muted}
                disabled={!settings.notificationsEnabled}
              />
            )}
          </View>
          {(prefs.emailOnReminder ?? false) && settings.notificationsEnabled && (
            <View style={{ marginTop: 10, paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8, fontWeight: "600" }}>Send reminder how far in advance?</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {([
                  { label: "12 hours", value: 12 },
                  { label: "24 hours", value: 24 },
                  { label: "48 hours", value: 48 },
                  { label: "3 days", value: 72 },
                  { label: "1 week", value: 168 },
                ] as { label: string; value: number }[]).map((opt) => {
                  const selected = (prefs.reminderHoursBefore ?? 24) === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        const updated = { ...prefs, reminderHoursBefore: opt.value };
                        const action = { type: "UPDATE_SETTINGS" as const, payload: { notificationPreferences: updated } };
                        dispatch(action);
                        syncToDb(action);
                      }}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: selected ? "#0ea5e9" : colors.border,
                        backgroundColor: selected ? "#0ea5e918" : colors.surface,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: selected ? "700" : "400", color: selected ? "#0ea5e9" : colors.foreground }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </Pressable>

        {/* ── Email Notifications Controller ── */}
        <Text style={[styles.sectionHeader, { color: colors.muted, marginTop: 20 }]}>Email Notifications to You</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, marginTop: -4 }}>
          Control which business events trigger an email to your registered address.
        </Text>

        {([
          {
            key: "emailNotifNewBooking" as const,
            label: "New Booking",
            description: "Email when a client submits a new booking request.",
            icon: "calendar.badge.plus" as const,
            color: "#2196F3",
          },
          {
            key: "emailNotifCancellation" as const,
            label: "Cancellation",
            description: "Email when a client cancels their appointment.",
            icon: "xmark.circle.fill" as const,
            color: "#EF4444",
          },
          {
            key: "emailNotifReschedule" as const,
            label: "Reschedule",
            description: "Email when a client requests to reschedule.",
            icon: "arrow.clockwise" as const,
            color: "#F59E0B",
          },
          {
            key: "emailNotifReminder" as const,
            label: "Daily Appointment Summary",
            description: "Morning email listing all appointments scheduled for today.",
            icon: "envelope.fill" as const,
            color: "#9C27B0",
          },
          {
            key: "emailNotifReview" as const,
            label: "New Client Review",
            description: "Email when a client leaves a review or rating.",
            icon: "star.fill" as const,
            color: "#f59e0b",
          },
          {
            key: "emailNotifPayment" as const,
            label: "Payment Received",
            description: "Email when a payment is recorded for an appointment.",
            icon: "dollarsign.circle.fill" as const,
            color: "#4CAF50",
          },
        ] as const).map((item) => {
          const isOn = settings[item.key] === true; // default OFF
          return (
            <Pressable
              key={item.key}
              onPress={!hasEmailAccess ? handleLockedTap : undefined}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: hasEmailAccess ? 1 : 0.55 }]}
            >
              <View style={styles.switchRow}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1, marginRight: 12 }}>
                  <View style={[{
                    width: 36, height: 36, borderRadius: 10,
                    alignItems: "center", justifyContent: "center",
                    marginRight: 12,
                  }, { backgroundColor: item.color + "18" }]}>
                    <IconSymbol name={item.icon} size={18} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.label}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>{item.description}</Text>
                  </View>
                </View>
                {!hasEmailAccess ? (
                  <IconSymbol name="lock.fill" size={18} color={colors.muted} />
                ) : (
                  <Switch
                    value={isOn}
                    onValueChange={() => {
                      const action = { type: "UPDATE_SETTINGS" as const, payload: { [item.key]: !isOn } };
                      dispatch(action);
                      syncToDb(action);
                    }}
                    trackColor={{ false: colors.border, true: item.color + "60" }}
                    thumbColor={isOn ? item.color : colors.muted}
                  />
                )}
              </View>
            </Pressable>
          );
        })}

        {/* ── Client SMS Notifications ── */}
        <Text style={[styles.sectionHeader, { color: colors.muted, marginTop: 20 }]}>Client SMS Notifications</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, marginTop: -4 }}>
          Control which events trigger an automated SMS to your clients. Requires SMS Automation to be enabled.
        </Text>
        {!hasSmsAccess && (
          <View style={{ backgroundColor: colors.warning + "18", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.warning + "40", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <IconSymbol name="lock.fill" size={16} color={colors.warning} />
            <Text style={{ fontSize: 13, color: colors.warning, flex: 1, lineHeight: 18 }}>
              Client SMS requires Growth plan or above. Upgrade to send automated SMS to clients.
            </Text>
          </View>
        )}
        {CLIENT_SMS_EVENTS.map((event) => {
          const enabled = !!(prefs[event.key as keyof NotificationPreferences]) && hasSmsAccess && (settings.notificationsEnabled ?? true);
          const message = customMessages[event.key] ?? event.defaultMessage;
          return (
            <Pressable
              key={event.key}
              onPress={!hasSmsAccess ? handleLockedTap : undefined}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: (hasSmsAccess && (settings.notificationsEnabled ?? true)) ? 1 : 0.55 }]}
            >
              <View style={styles.switchRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{event.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 }}>{event.description}</Text>
                </View>
                {!hasSmsAccess ? (
                  <IconSymbol name="lock.fill" size={18} color={colors.muted} />
                ) : (
                  <Switch
                    value={enabled}
                    onValueChange={() => togglePref(event.key as keyof NotificationPreferences)}
                    trackColor={{ false: colors.border, true: colors.primary + "60" }}
                    thumbColor={enabled ? colors.primary : colors.muted}
                    disabled={!(settings.notificationsEnabled ?? true)}
                  />
                )}
              </View>
              {enabled && (
                <>
                  <MessagePreview template={message} vars={event.vars} />
                  <Pressable
                    onPress={() => handleEditMessage(event)}
                    style={({ pressed }) => ({
                      marginTop: 10,
                      alignSelf: "flex-end",
                      backgroundColor: colors.primary + "15",
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>Edit Message</Text>
                  </Pressable>
                </>
              )}
            </Pressable>
          );
        })}

      </ScrollView>

      {/* Edit message modal */}
      <EditMessageModal
        visible={editModalVisible}
        event={editingEvent}
        currentMessage={editingEvent ? (customMessages[editingEvent.key] ?? editingEvent.defaultMessage) : ""}
        onSave={handleSaveMessage}
        onClose={() => setEditModalVisible(false)}
      />

      {/* Upgrade sheet — shown when user taps a locked notification toggle */}
      <UpgradeSheet
        visible={upgradeSheetVisible}
        onClose={() => setUpgradeSheetVisible(false)}
        featureName="Email Notifications"
        requiredPlan="growth"
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
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
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
  },
});
