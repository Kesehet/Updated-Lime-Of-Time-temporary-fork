import { useState, useCallback, useRef } from "react";
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FuturisticBackground } from "@/components/futuristic-background";
import QRCode from "react-native-qrcode-svg";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";

const CA_COLOR = "#00C244";
const CA_LIGHT = "#f0fdf4";
const CA_BORDER = "#86efac";

export default function PaymentMethodCashAppScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const settings = state.settings;

  const [handle, setHandle] = useState(settings.cashAppHandle ?? "");
  const [saved, setSaved] = useState(false);
  const [savingQr, setSavingQr] = useState(false);
  const qrRef = useRef<ViewShot>(null);

  const trimmed = handle.trim();
  const tag = trimmed.startsWith("$") ? trimmed : trimmed.length > 0 ? `$${trimmed}` : "";
  const qrValue = tag ? `https://cash.app/${tag.replace("$", "")}` : "";
  const hasHandle = tag.length > 0;

  const handleSave = useCallback(() => {
    const action = {
      type: "UPDATE_SETTINGS" as const,
      payload: { cashAppHandle: trimmed },
    };
    dispatch(action);
    syncToDb(action);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [trimmed, dispatch, syncToDb]);

  const handleShareQr = useCallback(async () => {
    if (!qrRef.current) return;
    setSavingQr(true);
    try {
      const uri = await captureRef(qrRef, { format: "png", quality: 1 });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share Cash App QR Code" });
      } else {
        Alert.alert("Sharing not available", "Cannot share on this device.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to share QR code");
    } finally {
      setSavingQr(false);
    }
  }, []);

  return (
    <ScreenContainer>
      <FuturisticBackground />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <IconSymbol name="chevron.left" size={22} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <View style={[styles.headerIcon, { backgroundColor: CA_COLOR }]}>
                <Text style={styles.headerIconText}>$</Text>
              </View>
              <Text style={[styles.title, { color: colors.foreground }]}>Cash App</Text>
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* Description Card */}
          <View style={[styles.descCard, { backgroundColor: CA_LIGHT, borderColor: CA_BORDER }]}>
            <Text style={[styles.descTitle, { color: "#15803d" }]}>How Cash App Works</Text>
            <Text style={[styles.descText, { color: "#166534" }]}>
              Cash App lets clients send money instantly to your $Cashtag — no bank details needed, funds arrive in seconds.
            </Text>
            <View style={styles.descSteps}>
              <Text style={[styles.descStep, { color: "#166534" }]}>1. Enter your $Cashtag below (with or without the $ sign)</Text>
              <Text style={[styles.descStep, { color: "#166534" }]}>2. A QR code is generated that links directly to your Cash App profile</Text>
              <Text style={[styles.descStep, { color: "#166534" }]}>3. Clients scan the QR or search your $Cashtag in Cash App to pay you</Text>
            </View>
          </View>

          {/* Input */}
          <View style={[styles.inputCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Your $Cashtag</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: hasHandle ? CA_COLOR : colors.border, backgroundColor: colors.background }]}
              value={handle}
              onChangeText={(v) => { setHandle(v); setSaved(false); }}
              placeholder="e.g. $YourCashtag"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            {tag && tag !== trimmed ? (
              <Text style={[styles.inputHint, { color: CA_COLOR }]}>Will be saved as: {tag}</Text>
            ) : null}
            <Text style={[styles.inputHint, { color: colors.muted }]}>
              Clients will see your $Cashtag and the QR code on their booking confirmation page.
            </Text>
          </View>

          {/* Live QR Preview */}
          {hasHandle ? (
            <View style={[styles.qrCard, { backgroundColor: colors.surface, borderColor: CA_COLOR }]}>
              <Text style={[styles.qrCardTitle, { color: colors.foreground }]}>Your Cash App QR Code</Text>
              <Text style={[styles.qrCardSubtitle, { color: colors.muted }]}>
                Clients scan this to open Cash App and send you money
              </Text>
              <ViewShot ref={qrRef} style={styles.qrCapture}>
                <QRCode value={qrValue} size={200} color="#000" backgroundColor="#FFF" />
              </ViewShot>
              <Text style={[styles.qrHandle, { color: CA_COLOR }]}>{tag}</Text>
              <TouchableOpacity
                style={[styles.shareBtn, { backgroundColor: CA_COLOR }]}
                onPress={handleShareQr}
                disabled={savingQr}
                activeOpacity={0.8}
              >
                <IconSymbol name="square.and.arrow.up" size={16} color="#FFF" />
                <Text style={styles.shareBtnText}>{savingQr ? "Sharing..." : "Save / Share QR Code"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.qrPlaceholder, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={styles.qrPlaceholderIcon}>💸</Text>
              <Text style={[styles.qrPlaceholderText, { color: colors.muted }]}>
                Enter your $Cashtag above to generate your QR code
              </Text>
            </View>
          )}

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: saved ? "#22C55E" : CA_COLOR }]}
            onPress={handleSave}
            activeOpacity={0.8}
          >
            <Text style={styles.saveBtnText}>{saved ? "✓ Saved!" : "Save Cash App Handle"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerIconText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  title: { fontSize: 18, fontWeight: "700" },
  descCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  descTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  descText: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  descSteps: { gap: 6 },
  descStep: { fontSize: 13, lineHeight: 18 },
  inputCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  inputHint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  qrCard: { borderRadius: 14, borderWidth: 2, padding: 20, marginBottom: 16, alignItems: "center" },
  qrCardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  qrCardSubtitle: { fontSize: 13, textAlign: "center", marginBottom: 20, lineHeight: 18 },
  qrCapture: { padding: 16, backgroundColor: "#FFFFFF", borderRadius: 16, marginBottom: 12 },
  qrHandle: { fontSize: 14, fontWeight: "600", marginBottom: 16, textAlign: "center" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 24, borderRadius: 12 },
  shareBtnText: { color: "#FFF", fontWeight: "700", fontSize: 14 },
  qrPlaceholder: { borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", padding: 32, marginBottom: 16, alignItems: "center", gap: 10 },
  qrPlaceholderIcon: { fontSize: 36 },
  qrPlaceholderText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  saveBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 20 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
