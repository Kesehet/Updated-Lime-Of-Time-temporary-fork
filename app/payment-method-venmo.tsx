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
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FuturisticBackground } from "@/components/futuristic-background";
import QRCode from "react-native-qrcode-svg";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";

const VENMO_COLOR = "#3D95CE";
const VENMO_LIGHT = "#eff8ff";
const VENMO_BORDER = "#93c5fd";

export default function PaymentMethodVenmoScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const settings = state.settings;

  const [handle, setHandle] = useState(settings.venmoHandle ?? "");
  const [saved, setSaved] = useState(false);
  const [savingQr, setSavingQr] = useState(false);
  const qrRef = useRef<ViewShot>(null);

  const trimmed = handle.trim();
  const username = trimmed.replace(/^@/, "");
  const displayHandle = username.length > 0 ? `@${username}` : "";
  const qrValue = username.length > 0 ? `https://venmo.com/${username}` : "";
  const hasHandle = username.length > 0;

  const handleSave = useCallback(() => {
    const action = {
      type: "UPDATE_SETTINGS" as const,
      payload: { venmoHandle: trimmed },
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
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share Venmo QR Code" });
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
              <View style={[styles.headerIcon, { backgroundColor: VENMO_COLOR }]}>
                <Text style={styles.headerIconText}>V</Text>
              </View>
              <Text style={[styles.title, { color: colors.foreground }]}>Venmo</Text>
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* Description Card */}
          <View style={[styles.descCard, { backgroundColor: VENMO_LIGHT, borderColor: VENMO_BORDER }]}>
            <Text style={[styles.descTitle, { color: "#1d4ed8" }]}>How Venmo Works</Text>
            <Text style={[styles.descText, { color: "#1e3a5f" }]}>
              Venmo lets clients send you money using your @username — popular for quick, social payments with no fees on standard transfers.
            </Text>
            <View style={styles.descSteps}>
              <Text style={[styles.descStep, { color: "#1e3a5f" }]}>1. Enter your Venmo @username below (with or without the @ sign)</Text>
              <Text style={[styles.descStep, { color: "#1e3a5f" }]}>2. A QR code is generated that links directly to your Venmo profile</Text>
              <Text style={[styles.descStep, { color: "#1e3a5f" }]}>3. Clients scan the QR or search your @username in Venmo to pay you</Text>
            </View>
          </View>

          {/* Input */}
          <View style={[styles.inputCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Your Venmo @username</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: hasHandle ? VENMO_COLOR : colors.border, backgroundColor: colors.background }]}
              value={handle}
              onChangeText={(v) => { setHandle(v); setSaved(false); }}
              placeholder="e.g. @YourVenmo"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            {displayHandle && displayHandle !== trimmed ? (
              <Text style={[styles.inputHint, { color: VENMO_COLOR }]}>Will be displayed as: {displayHandle}</Text>
            ) : null}
            <Text style={[styles.inputHint, { color: colors.muted }]}>
              Clients will see your @username and the QR code on their booking confirmation page.
            </Text>
          </View>

          {/* Live QR Preview */}
          {hasHandle ? (
            <View style={[styles.qrCard, { backgroundColor: colors.surface, borderColor: VENMO_COLOR }]}>
              <Text style={[styles.qrCardTitle, { color: colors.foreground }]}>Your Venmo QR Code</Text>
              <Text style={[styles.qrCardSubtitle, { color: colors.muted }]}>
                Clients scan this to open Venmo and send you money
              </Text>
              <ViewShot ref={qrRef} style={styles.qrCapture}>
                <QRCode value={qrValue} size={200} color="#000" backgroundColor="#FFF" />
              </ViewShot>
              <Text style={[styles.qrHandle, { color: VENMO_COLOR }]}>{displayHandle}</Text>
              <TouchableOpacity
                style={[styles.shareBtn, { backgroundColor: VENMO_COLOR }]}
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
              <Text style={styles.qrPlaceholderIcon}>💙</Text>
              <Text style={[styles.qrPlaceholderText, { color: colors.muted }]}>
                Enter your Venmo @username above to generate your QR code
              </Text>
            </View>
          )}

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: saved ? "#22C55E" : VENMO_COLOR }]}
            onPress={handleSave}
            activeOpacity={0.8}
          >
            <Text style={styles.saveBtnText}>{saved ? "✓ Saved!" : "Save Venmo Handle"}</Text>
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
