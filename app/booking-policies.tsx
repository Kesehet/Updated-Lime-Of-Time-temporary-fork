import { useState, useCallback } from "react";
import { Text, View, Pressable, StyleSheet, Switch, TextInput, Alert, ScrollView, Linking,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter } from "expo-router";
import { FuturisticBackground } from "@/components/futuristic-background";


export default function BookingPoliciesScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();
  const settings = state.settings;
  const policy = settings.cancellationPolicy;

  const autoComplete = settings.autoCompleteEnabled;
  const autoCompleteDelay = settings.autoCompleteDelayMinutes ?? 5;
  const responseWindow = settings.requestResponseWindowHours ?? 48;
  const giftValidDays = settings.giftValidDays ?? 90;
  const giftMinBalance = settings.giftMinBalance ?? 10;
  const PRESET_VALIDITY_DAYS = [30, 60, 90, 180, 365];
  // "Custom" chip state — show text input when user selects a non-preset value
  const isCustomValidity = !PRESET_VALIDITY_DAYS.includes(giftValidDays);
  const [customDaysInput, setCustomDaysInput] = useState(isCustomValidity ? String(giftValidDays) : "");
  const [showCustomInput, setShowCustomInput] = useState(isCustomValidity);

  const setGiftValidDays = useCallback((days: number) => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { giftValidDays: days } };
    dispatch(action);
    syncToDb(action);
  }, [dispatch, syncToDb]);

  const applyCustomDays = useCallback(() => {
    const parsed = parseInt(customDaysInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 3650) {
      setGiftValidDays(parsed);
    } else {
      Alert.alert("Invalid Value", "Please enter a number between 1 and 3650 days.");
    }
  }, [customDaysInput, setGiftValidDays]);

  const setGiftMinBalance = useCallback((amount: number) => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { giftMinBalance: amount } };
    dispatch(action);
    syncToDb(action);
  }, [dispatch, syncToDb]);

  const restoreGiftOnNoShow = settings.restoreGiftOnNoShow ?? false;
  const toggleRestoreGiftOnNoShow = useCallback(() => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { restoreGiftOnNoShow: !restoreGiftOnNoShow } };
    dispatch(action);
    syncToDb(action);
  }, [restoreGiftOnNoShow, dispatch, syncToDb]);

  const toggleAutoComplete = useCallback(() => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { autoCompleteEnabled: !autoComplete } };
    dispatch(action);
    syncToDb(action);
  }, [autoComplete, dispatch, syncToDb]);

  const setAutoCompleteDelay = useCallback((minutes: number) => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { autoCompleteDelayMinutes: minutes } };
    dispatch(action);
    syncToDb(action);
  }, [dispatch, syncToDb]);

  const setResponseWindow = useCallback((hours: number) => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { requestResponseWindowHours: hours } };
    dispatch(action);
    syncToDb(action);
  }, [dispatch, syncToDb]);

  const toggleCancellation = useCallback(() => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { cancellationPolicy: { ...policy, enabled: !policy.enabled } } };
    dispatch(action);
    syncToDb(action);
  }, [policy, dispatch, syncToDb]);

  const setCancellationHours = useCallback((hours: number) => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { cancellationPolicy: { ...policy, hoursBeforeAppointment: hours } } };
    dispatch(action);
    syncToDb(action);
  }, [policy, dispatch, syncToDb]);

  const setCancellationFee = useCallback((fee: number) => {
    const action = { type: "UPDATE_SETTINGS" as const, payload: { cancellationPolicy: { ...policy, feePercentage: fee } } };
    dispatch(action);
    syncToDb(action);
  }, [policy, dispatch, syncToDb]);

  const toggleTemporaryClosed = useCallback(() => {
    const newValue = !settings.temporaryClosed;
    const action = { type: "UPDATE_SETTINGS" as const, payload: { temporaryClosed: newValue } };
    dispatch(action);
    syncToDb(action);
    if (newValue) {
      Alert.alert("Business Closed", "Your business is now marked as temporarily closed. Clients will not be able to book new appointments.");
    }
  }, [settings.temporaryClosed, dispatch, syncToDb]);

  return (
    <ScreenContainer edges={["top", "left", "right"]} tabletMaxWidth={720}>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: hp }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Booking Policies</Text>
        <View style={{ width: 36 }} />
      </View>

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: hp, paddingVertical: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Cancellation Policy */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#FF9800" />
              <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground, marginLeft: 12 }}>Cancellation Fee</Text>
            </View>
            <Switch
              value={policy.enabled}
              onValueChange={toggleCancellation}
              trackColor={{ false: colors.border, true: colors.primary + "60" }}
              thumbColor={policy.enabled ? colors.primary : colors.muted}
            />
          </View>
          {!policy.enabled && (
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 8, lineHeight: 16 }}>
              Enable to charge a cancellation fee when clients cancel within a set window. The fee is calculated as a percentage of the service price.
            </Text>
          )}
          {policy.enabled && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginBottom: 8 }}>Hours Before Appointment</Text>
              <View style={styles.chipRow}>
                {[1, 2, 4, 6, 12, 24].map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => setCancellationHours(h)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: policy.hoursBeforeAppointment === h ? colors.primary : colors.background,
                        borderColor: policy.hoursBeforeAppointment === h ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "500", color: policy.hoursBeforeAppointment === h ? "#FFFFFF" : colors.foreground }}>
                      {h}h
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginTop: 12, marginBottom: 8 }}>Fee Percentage</Text>
              <View style={styles.chipRow}>
                {[25, 50, 75, 100].map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setCancellationFee(p)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: policy.feePercentage === p ? colors.primary : colors.background,
                        borderColor: policy.feePercentage === p ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "500", color: policy.feePercentage === p ? "#FFFFFF" : colors.foreground }}>
                      {p}%
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 8, lineHeight: 16 }}>
                Clients will be charged {policy.feePercentage}% of the service price if they cancel within {policy.hoursBeforeAppointment} hour{policy.hoursBeforeAppointment > 1 ? "s" : ""} of the appointment.
              </Text>
            </View>
          )}
        </View>

        {/* Request Response Window */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="clock.fill" size={20} color={colors.primary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground }}>Request Response Window</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
                  How long you have to approve or decline cancel/reschedule requests
                </Text>
              </View>
            </View>
          </View>
          <View style={{ marginTop: 14 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginBottom: 8 }}>Auto-Decline After</Text>
            <View style={styles.chipRow}>
              {[12, 24, 48, 72].map((h) => (
                <Pressable
                  key={h}
                  onPress={() => setResponseWindow(h)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: responseWindow === h ? colors.primary : colors.background,
                      borderColor: responseWindow === h ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={{ fontSize: fs.xs, fontWeight: "500", color: responseWindow === h ? "#FFFFFF" : colors.foreground }}>
                    {h}h
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 8, lineHeight: 16 }}>
              Pending requests will be automatically declined after {responseWindow} hour{responseWindow > 1 ? "s" : ""} with an SMS sent to the client.
            </Text>
          </View>
        </View>

        {/* Auto-Complete Appointments */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground }}>Auto-Complete Appointments</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
                  Automatically mark appointments as completed after the service ends
                </Text>
              </View>
            </View>
            <Switch
              value={autoComplete}
              onValueChange={toggleAutoComplete}
              trackColor={{ false: colors.border, true: colors.success + "60" }}
              thumbColor={autoComplete ? colors.success : colors.muted}
            />
          </View>
          {autoComplete && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginBottom: 8 }}>Mark Complete After End Time</Text>
              <View style={styles.chipRow}>
                {[5, 10, 15, 30].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setAutoCompleteDelay(m)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: autoCompleteDelay === m ? colors.success : colors.background,
                        borderColor: autoCompleteDelay === m ? colors.success : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "500", color: autoCompleteDelay === m ? "#FFFFFF" : colors.foreground }}>
                      +{m} min
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 8, lineHeight: 16 }}>
                Appointments will be automatically marked as completed {autoCompleteDelay} minute{autoCompleteDelay > 1 ? "s" : ""} after the scheduled end time. A notification will be sent to confirm.
              </Text>
            </View>
          )}
        </View>

        {/* Gift Card Validity */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="gift.fill" size={20} color="#E91E63" />
              <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground, marginLeft: 12 }}>Gift Card Validity</Text>
            </View>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 10, marginTop: 4 }}>
            How many days a publicly-purchased gift card remains valid
          </Text>
          <View style={styles.chipRow}>
            {PRESET_VALIDITY_DAYS.map((d) => (
              <Pressable
                key={d}
                onPress={() => {
                  setGiftValidDays(d);
                  setShowCustomInput(false);
                  setCustomDaysInput("");
                }}
                style={[styles.chip, {
                  backgroundColor: giftValidDays === d && !showCustomInput ? "#E91E63" : colors.background,
                  borderColor: giftValidDays === d && !showCustomInput ? "#E91E63" : colors.border,
                }]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: giftValidDays === d && !showCustomInput ? "#fff" : colors.foreground }}>
                  {d === 365 ? "1 year" : `${d} days`}
                </Text>
              </Pressable>
            ))}
            {/* Custom days chip */}
            <Pressable
              onPress={() => {
                setShowCustomInput(true);
                setCustomDaysInput(isCustomValidity ? String(giftValidDays) : "");
              }}
              style={[styles.chip, {
                backgroundColor: showCustomInput ? "#E91E63" : colors.background,
                borderColor: showCustomInput ? "#E91E63" : colors.border,
              }]}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: showCustomInput ? "#fff" : colors.foreground }}>
                {showCustomInput && isCustomValidity ? `${giftValidDays}d ✎` : "Custom"}
              </Text>
            </Pressable>
          </View>
          {/* Custom days input — shown when Custom chip is selected */}
          {showCustomInput && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
              <TextInput
                style={[
                  styles.chip,
                  { flex: 1, backgroundColor: colors.background, borderColor: "#E91E63",
                    color: colors.foreground, fontSize: fs.xs, fontWeight: "600",
                    textAlign: "center", minWidth: 80, paddingHorizontal: 10 }
                ]}
                placeholder="e.g. 45"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                value={customDaysInput}
                onChangeText={setCustomDaysInput}
                returnKeyType="done"
                onSubmitEditing={applyCustomDays}
                maxLength={4}
              />
              <Text style={{ fontSize: fs.xs, color: colors.muted }}>days</Text>
              <Pressable
                onPress={applyCustomDays}
                style={({ pressed }) => [{
                  backgroundColor: "#E91E63", borderRadius: 8,
                  paddingHorizontal: 14, paddingVertical: 8,
                  opacity: pressed ? 0.8 : 1,
                }]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#fff" }}>Apply</Text>
              </Pressable>
            </View>
          )}
          {/* Current selection label */}
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 8 }}>
            Currently: gift cards expire after{" "}
            <Text style={{ fontWeight: "700", color: colors.foreground }}>
              {giftValidDays === 365 ? "1 year" : `${giftValidDays} days`}
            </Text>
          </Text>
        </View>
        {/* Gift Card Minimum Balance */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="dollarsign.circle.fill" size={20} color="#E91E63" />
              <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground, marginLeft: 12 }}>Min. Balance Gift Amount</Text>
            </View>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 10, marginTop: 4 }}>
            Minimum dollar amount clients can purchase as a balance gift card
          </Text>
          <View style={styles.chipRow}>
            {[5, 10, 15, 20, 25, 50].map((amt) => (
              <Pressable
                key={amt}
                onPress={() => setGiftMinBalance(amt)}
                style={[styles.chip, {
                  backgroundColor: giftMinBalance === amt ? "#E91E63" : colors.background,
                  borderColor: giftMinBalance === amt ? "#E91E63" : colors.border,
                }]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: giftMinBalance === amt ? "#fff" : colors.foreground }}>
                  ${amt}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {/* No-Show Gift Policy */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="gift.fill" size={20} color="#E91E63" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground }}>Restore Gift on No-Show</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                  {restoreGiftOnNoShow
                    ? "Gift balance is restored when you mark an appointment as no-show."
                    : "Gift balance is kept consumed when an appointment is marked as no-show."}
                </Text>
              </View>
            </View>
            <Switch
              value={restoreGiftOnNoShow}
              onValueChange={toggleRestoreGiftOnNoShow}
              trackColor={{ false: colors.border, true: "#E91E63" }}
              thumbColor="#fff"
            />
          </View>
        </View>
        {/* Custom Booking Slug */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <IconSymbol name="link" size={20} color={colors.primary} />
              <Text style={{ fontSize: fs.sm, fontWeight: "500", color: colors.foreground, marginLeft: 12 }}>Booking Page URL</Text>
            </View>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8, marginTop: 4 }}>
            Custom slug for your public booking page
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            value={settings.customSlug || ""}
            onChangeText={(text) => {
              const slug = text.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
              dispatch({ type: "UPDATE_SETTINGS", payload: { customSlug: slug } });
            }}
            onBlur={() => {
              if (settings.customSlug) {
                syncToDb({ type: "UPDATE_SETTINGS", payload: { customSlug: settings.customSlug } });
              }
            }}
            placeholder={settings.businessName.toLowerCase().replace(/\s+/g, "-")}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "700" },
  card: { borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel: { flexDirection: "row", alignItems: "center", flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: 36 },
  input: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13, lineHeight: 20, borderWidth: 1 },
});
