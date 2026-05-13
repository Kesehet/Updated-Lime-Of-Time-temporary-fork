/**
 * Twilio Setup Screen
 * ─────────────────────────────────────────────────────────────────────────────
 * Step-by-step guide for connecting Twilio SMS to the app.
 * Stores credentials in BusinessSettings (encrypted at rest via AsyncStorage).
 * Credentials are sent to the server only when an SMS is dispatched — they are
 * NEVER stored on Twilio's side by this app.
 */
import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  Linking,
  Switch,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { trpc } from "@/lib/trpc";
import { FuturisticBackground } from "@/components/futuristic-background";


const STEPS = [
  {
    number: "1",
    title: "Create a Twilio account",
    body: "Go to twilio.com and sign up for a free trial. You'll get a $15 credit — enough for hundreds of SMS messages.",
    link: "https://www.twilio.com/try-twilio",
    linkLabel: "Open Twilio Sign-Up",
    icon: "globe",
  },
  {
    number: "2",
    title: "Get a Twilio phone number",
    body: "In the Twilio Console, go to Phone Numbers → Manage → Buy a number. Choose a US number with SMS capability. Use a new Twilio number — do not use your personal business number.",
    link: "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming",
    linkLabel: "Open Phone Numbers",
    icon: "phone.fill",
  },
  {
    number: "3",
    title: "Copy your Account SID & Auth Token",
    body: "On your Twilio Console dashboard, you'll see Account SID (starts with AC…) and Auth Token. Copy both and paste them below.",
    link: "https://console.twilio.com/",
    linkLabel: "Open Twilio Console",
    icon: "lock.fill",
  },
  {
    number: "4",
    title: "Enter your credentials below",
    body: "Paste your Account SID, Auth Token, and the Twilio phone number you purchased. Then tap Save & Test.",
    link: null,
    linkLabel: null,
    icon: "checkmark.circle.fill",
  },
];

export default function TwilioSetupScreen() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const colors = useColors();
  const settings = state.settings;

  const [accountSid, setAccountSid] = useState(settings.twilioAccountSid ?? "");
  const [authToken, setAuthToken] = useState(settings.twilioAuthToken ?? "");
  const [fromNumber, setFromNumber] = useState(settings.twilioFromNumber ?? "");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const sendSmsMutation = trpc.twilio.sendSms.useMutation();
  const otpTestSendMutation = trpc.otp.testSend.useMutation();
  const otpTestVerifyMutation = trpc.otp.testVerify.useMutation();

  // OTP test panel state
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpResult, setOtpResult] = useState<{ success: boolean; message: string } | null>(null);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);

  const handleSave = () => {
    const sid = accountSid.trim();
    const token = authToken.trim();
    const from = fromNumber.trim();
    if (!sid.startsWith("AC")) {
      Alert.alert("Invalid Account SID", "Account SID must start with 'AC'. Copy it from your Twilio Console dashboard.");
      return;
    }
    if (!token) {
      Alert.alert("Missing Auth Token", "Please enter your Twilio Auth Token.");
      return;
    }
    if (!from.startsWith("+")) {
      Alert.alert("Invalid Phone Number", "Phone number must be in E.164 format, e.g. +12125551234");
      return;
    }
    setSaving(true);
    dispatch({
      type: "UPDATE_SETTINGS",
      payload: {
        twilioAccountSid: sid,
        twilioAuthToken: token,
        twilioFromNumber: from,
        twilioEnabled: true,
      },
    });
    setTimeout(() => {
      setSaving(false);
      Alert.alert("Saved!", "Twilio credentials saved. Tap 'Send Test SMS' to verify the connection.");
    }, 400);
  };

  const handleTest = async () => {
    if (!state.businessOwnerId) {
      Alert.alert("Not logged in", "Please log in first.");
      return;
    }
    const businessPhone = settings.profile?.phone ?? "";
    if (!businessPhone) {
      Alert.alert("No business phone", "Please add your business phone number in Settings → Business Profile first.");
      return;
    }
    const toNumber = businessPhone.startsWith("+") ? businessPhone : `+1${businessPhone.replace(/\D/g, "")}`;
    setTesting(true);
    try {
      await sendSmsMutation.mutateAsync({
        businessOwnerId: state.businessOwnerId,
        toNumber,
        body: "✅ SMS automation is active on your Lime Of Time account!",
        smsAction: "confirmation",
      });
      Alert.alert("Test SMS Sent!", `A test message was sent to ${toNumber}. Check your phone.`);
    } catch (err: any) {
      Alert.alert("Test Failed", err.message ?? "Could not send test SMS. Contact support if this persists.");
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = !!(settings.twilioAccountSid && settings.twilioAuthToken && settings.twilioFromNumber);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>Twilio SMS Setup</Text>
        <View style={{ width: 24 }} />
      </View>

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Status banner */}
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 10,
          backgroundColor: isConfigured ? "#22C55E20" : colors.surface,
          borderRadius: 14, padding: 14, marginBottom: 20,
          borderWidth: 1, borderColor: isConfigured ? "#22C55E60" : colors.border,
        }}>
          <IconSymbol
            name={isConfigured ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
            size={24}
            color={isConfigured ? "#22C55E" : colors.warning}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
              {isConfigured ? "Twilio is connected" : "Twilio is not set up yet"}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
              {isConfigured
                ? `Sending from ${settings.twilioFromNumber}. SMS automation is ${settings.twilioEnabled ? "enabled" : "paused"}.`
                : "Follow the steps below to connect your Twilio account."}
            </Text>
          </View>
        </View>

        {/* Step-by-step guide */}
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>
          Setup Guide
        </Text>
        {STEPS.map((step) => (
          <View
            key={step.number}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: colors.primary + "20",
                alignItems: "center", justifyContent: "center",
              }}>
                <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{step.number}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
                  {step.title}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>
                  {step.body}
                </Text>
                {step.link && (
                  <Pressable
                    onPress={() => Linking.openURL(step.link!)}
                    style={({ pressed }) => ({
                      marginTop: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <IconSymbol name="arrow.up.right.square" size={14} color={colors.primary} />
                    <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>{step.linkLabel}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        ))}

        {/* Credentials Form */}
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 8, marginBottom: 12 }}>
          Your Credentials
        </Text>

        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
            Account SID (starts with AC…)
          </Text>
          <TextInput
            value={accountSid}
            onChangeText={setAccountSid}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>

        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>Auth Token</Text>
            <Pressable onPress={() => setShowToken((v) => !v)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 12, color: colors.primary }}>{showToken ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          <TextInput
            value={authToken}
            onChangeText={setAuthToken}
            placeholder="Your Auth Token"
            placeholderTextColor={colors.muted}
            secureTextEntry={!showToken}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
            Twilio Phone Number (E.164 format, e.g. +12125551234)
          </Text>
          <TextInput
            value={fromNumber}
            onChangeText={setFromNumber}
            placeholder="+1XXXXXXXXXX"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          />
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
            ⚠️ Use a new Twilio number — do not use your personal business number.
          </Text>
        </View>

        {/* Save button */}
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: "center",
            opacity: pressed || saving ? 0.8 : 1,
            marginBottom: 10,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFF" }}>
            {saving ? "Saving…" : "Save Credentials"}
          </Text>
        </Pressable>

        {/* Test button */}
        {isConfigured && (
          <Pressable
            onPress={handleTest}
            style={({ pressed }) => ({
              backgroundColor: colors.surface,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 14,
              alignItems: "center",
              opacity: pressed || testing ? 0.8 : 1,
              marginBottom: 20,
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
              {testing ? "Sending…" : "Send Test SMS to My Phone"}
            </Text>
          </Pressable>
        )}

        {/* Master toggle */}
        {isConfigured && (
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1,
            borderColor: colors.border, padding: 14, marginBottom: 20,
          }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Enable Twilio SMS</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                Master switch — turn off to pause all automated SMS without deleting credentials.
              </Text>
            </View>
            <Switch
              value={settings.twilioEnabled ?? false}
              onValueChange={(v) => dispatch({ type: "UPDATE_SETTINGS", payload: { twilioEnabled: v } })}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFF"
            />
          </View>
        )}

        {/* OTP Test Panel */}
        <View style={{
          backgroundColor: colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          marginBottom: 20,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <IconSymbol name="lock.fill" size={18} color={colors.primary} />
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Test OTP Verification</Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 14, lineHeight: 17 }}>
            Send a real Twilio Verify OTP to any phone number and confirm it arrives and verifies correctly.
          </Text>

          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>Phone Number (E.164, e.g. +12125551234)</Text>
          <TextInput
            value={otpPhone}
            onChangeText={(v) => { setOtpPhone(v); setOtpSent(false); setOtpResult(null); setOtpCode(""); }}
            placeholder="+1XXXXXXXXXX"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginBottom: 10 }]}
          />

          <Pressable
            onPress={async () => {
              if (!otpPhone.startsWith("+") || otpPhone.replace(/\D/g, "").length < 10) {
                Alert.alert("Invalid number", "Enter a full E.164 phone number, e.g. +12125551234");
                return;
              }
              setOtpSending(true);
              setOtpResult(null);
              try {
                const res = await otpTestSendMutation.mutateAsync({ phone: otpPhone });
                if (res.success) {
                  setOtpSent(true);
                  setOtpResult({ success: true, message: `OTP sent to ${otpPhone} via Twilio Verify. Check your phone.` });
                } else {
                  setOtpResult({ success: false, message: (res as any).error ?? "Failed to send OTP" });
                }
              } catch (e: any) {
                setOtpResult({ success: false, message: e.message ?? "Failed to send OTP" });
              } finally {
                setOtpSending(false);
              }
            }}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed || otpSending ? 0.7 : 1,
              marginBottom: 10,
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>
              {otpSending ? "Sending OTP…" : "Send OTP"}
            </Text>
          </Pressable>

          {otpSent && (
            <>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>Enter the 6-digit code you received</Text>
              <TextInput
                value={otpCode}
                onChangeText={(v) => { setOtpCode(v.replace(/\D/g, "").slice(0, 6)); setOtpResult(null); }}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={6}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginBottom: 10, letterSpacing: 8, textAlign: "center", fontSize: 20, fontWeight: "700" }]}
              />
              <Pressable
                onPress={async () => {
                  if (otpCode.length !== 6) {
                    Alert.alert("Enter code", "Please enter the 6-digit code from your SMS.");
                    return;
                  }
                  setOtpVerifying(true);
                  setOtpResult(null);
                  try {
                    const res = await otpTestVerifyMutation.mutateAsync({ phone: otpPhone, code: otpCode });
                    if (res.success) {
                      setOtpResult({ success: true, message: "✅ OTP verified successfully! Twilio Verify is working correctly." });
                      setOtpSent(false);
                      setOtpCode("");
                    } else {
                      setOtpResult({ success: false, message: (res as any).error ?? "Incorrect code" });
                    }
                  } catch (e: any) {
                    setOtpResult({ success: false, message: e.message ?? "Verification failed" });
                  } finally {
                    setOtpVerifying(false);
                  }
                }}
                style={({ pressed }) => ({
                  backgroundColor: "#22C55E",
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: "center",
                  opacity: pressed || otpVerifying ? 0.7 : 1,
                  marginBottom: 10,
                })}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>
                  {otpVerifying ? "Verifying…" : "Verify Code"}
                </Text>
              </Pressable>
            </>
          )}

          {otpResult && (
            <View style={{
              backgroundColor: otpResult.success ? "#22C55E15" : "#EF444415",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: otpResult.success ? "#22C55E50" : "#EF444450",
              padding: 12,
            }}>
              <Text style={{ fontSize: 13, color: otpResult.success ? "#16A34A" : "#DC2626", fontWeight: "600", lineHeight: 18 }}>
                {otpResult.message}
              </Text>
            </View>
          )}
        </View>

        {/* Next step link */}
        {isConfigured && (
          <Pressable
            onPress={() => router.push("/sms-automation" as any)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
              backgroundColor: colors.primary + "15", borderRadius: 14, padding: 14,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <IconSymbol name="bell.fill" size={16} color={colors.primary} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>
              Configure SMS Automation →
            </Text>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
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
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
});
