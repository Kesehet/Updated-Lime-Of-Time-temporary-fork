/**
 * SMS Automation Screen
 * ─────────────────────────────────────────────────────────────────────────────
 * Configure which automated SMS messages are sent via Twilio:
 *   • Booking confirmation
 *   • Appointment reminder (X hours before)
 *   • Rebooking nudge (X days after)
 *   • Birthday SMS
 *
 * Actual sending is triggered from the relevant screens (new-booking,
 * appointment-detail, birthday-campaigns) using the trpc.twilio.sendSms
 * mutation — this screen only manages the on/off toggles and timing.
 */
import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FuturisticBackground } from "@/components/futuristic-background";
import { trpc } from "@/lib/trpc";
import { UpgradeSheet } from "@/components/upgrade-sheet";

type RuleKey =
  | "twilioBookingReminder"
  | "twilioRebookingNudge"
  | "twilioBirthdaySms";

interface AutomationRule {
  key: RuleKey;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  timingKey?: "twilioReminderHoursBeforeAppt" | "twilioRebookingNudgeDays";
  timingLabel?: string;
  timingUnit?: string;
  timingMin?: number;
  timingMax?: number;
}

const RULES: AutomationRule[] = [
  {
    key: "twilioBookingReminder",
    title: "Appointment Reminder",
    description: "Send a reminder SMS to the client before their appointment.",
    icon: "bell.fill",
    iconColor: "#F59E0B",
    timingKey: "twilioReminderHoursBeforeAppt",
    timingLabel: "Hours before appointment",
    timingUnit: "hrs",
    timingMin: 1,
    timingMax: 72,
  },
  {
    key: "twilioRebookingNudge",
    title: "Rebooking Nudge",
    description: "Remind clients to rebook after their appointment.",
    icon: "arrow.clockwise",
    iconColor: "#6366F1",
    timingKey: "twilioRebookingNudgeDays",
    timingLabel: "Days after appointment",
    timingUnit: "days",
    timingMin: 1,
    timingMax: 90,
  },
  {
    key: "twilioBirthdaySms",
    title: "Birthday SMS",
    description: "Send a happy birthday message to clients on their birthday.",
    icon: "birthday.cake.fill",
    iconColor: "#EC4899",
  },
];

export default function SmsAutomationScreen() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const colors = useColors();
  const settings = state.settings;
  // SMS is handled by the Lime Of Time platform backend — no Twilio credentials required
  // The master toggle simply enables/disables the automation rules

  // ── Plan gating ──────────────────────────────────────────────────────────
  const businessOwnerId = state.businessOwnerId;
  const { data: planInfo } = trpc.subscription.getMyPlan.useQuery(
    { businessOwnerId: businessOwnerId! },
    { enabled: !!businessOwnerId, staleTime: 60_000 }
  );
  // smsLevel: "none" (Solo) | "confirmations" (Growth) | "full" (Studio/Enterprise/Admin)
  const smsLevel = planInfo?.limits?.smsLevel ?? "none";
  const hasSmsAccess = smsLevel !== "none";
  const hasFullSms = smsLevel === "full" || (planInfo?.isAdminOverride ?? false);

  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeFeatureName, setUpgradeFeatureName] = useState("");
  const [upgradeRequiredPlan, setUpgradeRequiredPlan] = useState<"growth" | "studio" | "enterprise">("growth");

  const handleLockedSmsTap = (featureName: string, plan: "growth" | "studio" | "enterprise" = "growth") => {
    setUpgradeFeatureName(featureName);
    setUpgradeRequiredPlan(plan);
    setUpgradeSheetVisible(true);
  };

  const [timingValues, setTimingValues] = useState<Record<string, string>>({
    twilioReminderHoursBeforeAppt: String(
      settings.twilioReminderHoursBeforeAppt ?? 24
    ),
    twilioRebookingNudgeDays: String(settings.twilioRebookingNudgeDays ?? 14),
  });

  const handleToggle = (key: RuleKey, value: boolean) => {
    dispatch({ type: "UPDATE_SETTINGS", payload: { [key]: value } });
  };

  const handleTimingBlur = (
    timingKey: "twilioReminderHoursBeforeAppt" | "twilioRebookingNudgeDays",
    rule: AutomationRule
  ) => {
    const raw = timingValues[timingKey];
    const parsed = parseInt(raw, 10);
    if (
      isNaN(parsed) ||
      parsed < (rule.timingMin ?? 1) ||
      parsed > (rule.timingMax ?? 999)
    ) {
      Alert.alert(
        "Invalid value",
        `Please enter a number between ${rule.timingMin} and ${rule.timingMax}.`
      );
      setTimingValues((prev) => ({
        ...prev,
        [timingKey]: String(settings[timingKey] ?? (timingKey === "twilioReminderHoursBeforeAppt" ? 24 : 14)),
      }));
      return;
    }
    dispatch({ type: "UPDATE_SETTINGS", payload: { [timingKey]: parsed } });
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </Pressable>
        <Text
          style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}
        >
          SMS Automation
        </Text>
        <View style={{ width: 24 }} />
      </View>

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Plan gating banner */}
        {!hasSmsAccess && (
          <View style={{ backgroundColor: colors.warning + "18", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.warning + "40", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <IconSymbol name="lock.fill" size={16} color={colors.warning} />
            <Text style={{ fontSize: 13, color: colors.warning, flex: 1, lineHeight: 18 }}>
              SMS Automation is not available on the Solo plan. Upgrade to Growth or above to send automated SMS messages.
            </Text>
          </View>
        )}
        {hasSmsAccess && !hasFullSms && (
          <View style={{ backgroundColor: colors.warning + "18", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.warning + "40", flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <IconSymbol name="lock.fill" size={16} color={colors.warning} />
            <Text style={{ fontSize: 13, color: colors.warning, flex: 1, lineHeight: 18 }}>
              Your Growth plan includes booking confirmation SMS only. The Appointment Reminder rule below is available. Upgrade to Studio or above for full automation (reminders, rebooking nudges, birthday SMS).
            </Text>
          </View>
        )}
        {/* Master toggle — only available on Studio+ or Admin override */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 14,
            marginBottom: 20,
            opacity: hasSmsAccess && !hasFullSms ? 0.55 : 1,
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: colors.foreground,
              }}
            >
              SMS Automation Enabled
            </Text>
            <Text
              style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}
            >
              {hasFullSms
                ? settings.twilioEnabled
                  ? "Full SMS automation is active"
                  : "Enable to send automated SMS to clients"
                : hasSmsAccess
                ? "Upgrade to Studio to enable full automation"
                : "Upgrade to Growth or above to enable SMS"}
            </Text>
          </View>
          {!hasFullSms ? (
            <Pressable onPress={() => handleLockedSmsTap("SMS Automation", hasSmsAccess ? "studio" : "growth")}>
              <IconSymbol name="lock.fill" size={20} color={colors.muted} />
            </Pressable>
          ) : (
            <Switch
              value={settings.twilioEnabled ?? false}
              onValueChange={(v) => {
                dispatch({
                  type: "UPDATE_SETTINGS",
                  payload: { twilioEnabled: v },
                });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFF"
            />
          )}
        </View>

        {/* Automation rules */}
        <Text
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: colors.foreground,
            marginBottom: 12,
          }}
        >
          Automation Rules
        </Text>

          {RULES.map((rule) => {
          // Rebooking nudge and birthday SMS require full SMS access (Studio+)
          const ruleRequiresFull = rule.key === "twilioRebookingNudge" || rule.key === "twilioBirthdaySms";
          const ruleAvailable = ruleRequiresFull ? hasFullSms : hasSmsAccess;
          const isOn = !!(settings[rule.key] ?? false) && ruleAvailable;
          return (
            <Pressable
              key={rule.key}
              onPress={!ruleAvailable ? () => handleLockedSmsTap(rule.title, ruleRequiresFull ? "studio" : "growth") : undefined}
              style={{
                backgroundColor: colors.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: isOn ? rule.iconColor + "40" : colors.border,
                padding: 14,
                marginBottom: 12,
                opacity: ruleAvailable ? 1 : 0.55,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    flex: 1,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: rule.iconColor + "20",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconSymbol
                      name={rule.icon as any}
                      size={18}
                      color={rule.iconColor}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "700",
                        color: colors.foreground,
                      }}
                    >
                      {rule.title}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.muted,
                        marginTop: 2,
                      }}
                    >
                      {rule.description}
                    </Text>
                  </View>
                </View>
                {!ruleAvailable ? (
                  <IconSymbol name="lock.fill" size={18} color={colors.muted} />
                ) : (
                  <Switch
                    value={isOn}
                    onValueChange={(v) => handleToggle(rule.key, v)}
                    trackColor={{ false: colors.border, true: rule.iconColor }}
                    thumbColor="#FFF"
                  />
                )}
              </View>

              {/* Timing input */}
              {isOn && rule.timingKey && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 12,
                    gap: 10,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: colors.muted,
                      flex: 1,
                    }}
                  >
                    {rule.timingLabel}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TextInput
                      value={timingValues[rule.timingKey]}
                      onChangeText={(v) =>
                        setTimingValues((prev) => ({
                          ...prev,
                          [rule.timingKey!]: v,
                        }))
                      }
                      onBlur={() => handleTimingBlur(rule.timingKey!, rule)}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      style={{
                        width: 64,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        fontSize: 15,
                        fontWeight: "700",
                        color: colors.foreground,
                        textAlign: "center",
                      }}
                    />
                    <Text style={{ fontSize: 13, color: colors.muted }}>
                      {rule.timingUnit}
                    </Text>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Twilio info */}
        <View
          style={{
            backgroundColor: colors.primary + "10",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.primary + "30",
            padding: 14,
            marginTop: 8,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "700",
              color: colors.foreground,
              marginBottom: 6,
            }}
          >
            How SMS automation works
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
            • <Text style={{ fontWeight: "600" }}>Booking Reminder</Text>: Sent
            automatically when you confirm an appointment in the app.{"\n"}•{" "}
            <Text style={{ fontWeight: "600" }}>Rebooking Nudge</Text>: Sent
            from the appointment detail screen after marking as completed.{"\n"}
            • <Text style={{ fontWeight: "600" }}>Birthday SMS</Text>: Sent from
            the Birthday Campaigns screen with one tap.
          </Text>
        </View>

        {/* Powered-by note */}
        <View style={{ alignItems: "center", marginTop: 20, marginBottom: 4 }}>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            SMS powered by Lime Of Time
          </Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Upgrade sheet — shown when user taps a locked SMS toggle */}
      <UpgradeSheet
        visible={upgradeSheetVisible}
        onClose={() => setUpgradeSheetVisible(false)}
        featureName={upgradeFeatureName}
        requiredPlan={upgradeRequiredPlan}
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
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
});
