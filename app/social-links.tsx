import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import Svg, { Path, Rect, Circle, G } from "react-native-svg";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";
import { FuturisticBackground } from "@/components/futuristic-background";

// ── Brand SVG Icons ──────────────────────────────────────────────────────────

function InstagramIcon({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="2" width="20" height="20" rx="5" ry="5" stroke={color} strokeWidth="2" />
      <Circle cx="12" cy="12" r="4" stroke={color} strokeWidth="2" />
      <Circle cx="17.5" cy="6.5" r="1" fill={color} />
    </Svg>
  );
}

function FacebookIcon({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </Svg>
  );
}

function TikTokIcon({ size = 22 }: { size?: number }) {
  // TikTok's official dual-color logo: red shadow + cyan shadow + white main
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Red shadow layer */}
      <Path
        d="M20.59 7.69a4.83 4.83 0 0 1-3.77-4.25V3h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V10.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.69a8.18 8.18 0 0 0 4.78 1.52V7.76a4.85 4.85 0 0 1-1.01-.07z"
        fill="#fe2c55"
        opacity={0.7}
        transform="translate(0.5, 0)"
      />
      {/* Cyan shadow layer */}
      <Path
        d="M20.59 7.69a4.83 4.83 0 0 1-3.77-4.25V3h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V10.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.69a8.18 8.18 0 0 0 4.78 1.52V7.76a4.85 4.85 0 0 1-1.01-.07z"
        fill="#25f4ee"
        opacity={0.7}
        transform="translate(-0.5, 0)"
      />
      {/* White main layer */}
      <Path
        d="M20.09 7.19a4.83 4.83 0 0 1-3.77-4.25V2.5h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.51a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.19a8.18 8.18 0 0 0 4.78 1.52V7.26a4.85 4.85 0 0 1-1.01-.07z"
        fill="#fff"
      />
    </Svg>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SocialLinksScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const settings = state.settings;

  const [instagram, setInstagram] = useState(settings.instagramHandle ?? "");
  const [facebook, setFacebook] = useState(settings.facebookHandle ?? "");
  const [tiktok, setTiktok] = useState(settings.tiktokHandle ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(() => {
    const action = {
      type: "UPDATE_SETTINGS" as const,
      payload: {
        instagramHandle: instagram.replace(/^@/, "").trim(),
        facebookHandle: facebook.trim(),
        tiktokHandle: tiktok.replace(/^@/, "").trim(),
      },
    };
    dispatch(action);
    syncToDb(action);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [instagram, facebook, tiktok, dispatch, syncToDb]);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => Alert.alert("Cannot open URL", url));
  }, []);

  const SOCIAL_FIELDS: {
    key: "instagram" | "facebook" | "tiktok";
    label: string;
    placeholder: string;
    prefix: string;
    renderIcon: () => React.ReactNode;
    /** Background for the icon badge */
    badgeBg: string;
    /** Border color for the badge (visible on dark mode) */
    badgeBorder?: string;
    buildUrl: (handle: string) => string;
    value: string;
    setter: (v: string) => void;
    previewColor: string;
  }[] = [
    {
      key: "instagram",
      label: "Instagram",
      placeholder: "your_handle",
      prefix: "@",
      renderIcon: () => <InstagramIcon size={20} color="#fff" />,
      badgeBg: "linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)",
      buildUrl: (h) => `https://instagram.com/${h}`,
      value: instagram,
      setter: setInstagram,
      previewColor: "#E1306C",
    },
    {
      key: "facebook",
      label: "Facebook",
      placeholder: "YourPageName",
      prefix: "fb.com/",
      renderIcon: () => <FacebookIcon size={20} color="#fff" />,
      badgeBg: "#1877F2",
      buildUrl: (h) => `https://facebook.com/${h}`,
      value: facebook,
      setter: setFacebook,
      previewColor: "#1877F2",
    },
    {
      key: "tiktok",
      label: "TikTok",
      placeholder: "your_handle",
      prefix: "@",
      renderIcon: () => <TikTokIcon size={20} />,
      badgeBg: "#111",
      badgeBorder: "#fe2c55",
      buildUrl: (h) => `https://tiktok.com/@${h}`,
      value: tiktok,
      setter: setTiktok,
      previewColor: "#fe2c55",
    },
  ];

  return (
    <ScreenContainer>
      <FuturisticBackground />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={[styles.backLabel, { color: colors.primary }]}>Settings</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Social Links</Text>
        <View style={styles.backBtn} />
      </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Section heading */}
        <View style={[styles.sectionHeadingRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="person.2.fill" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionHeadingTitle, { color: colors.foreground }]}>Your Business Social Media</Text>
            <Text style={[styles.sectionDesc, { color: colors.muted }]}>
              These links appear as tap-to-open icons on your public booking page so clients can follow your business.
            </Text>
          </View>
        </View>

        {SOCIAL_FIELDS.map((field) => (
          <View key={field.key} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              {/* Brand icon badge */}
              <View style={[
                styles.iconBadge,
                { backgroundColor: field.badgeBg as any },
                field.badgeBorder ? { borderWidth: 2, borderColor: field.badgeBorder } : {},
              ]}>
                {field.renderIcon()}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardLabel, { color: colors.foreground }]}>{field.label}</Text>
                {field.value.trim() !== "" && (
                  <Text style={[styles.handlePreview, { color: colors.muted }]} numberOfLines={1}>
                    {field.prefix}{field.value.replace(/^@/, "")}
                  </Text>
                )}
              </View>
              {field.value.trim() !== "" && (
                <Pressable
                  onPress={() => openLink(field.buildUrl(field.value.replace(/^@/, "").trim()))}
                  style={({ pressed }) => [styles.previewBtn, { opacity: pressed ? 0.6 : 1, backgroundColor: field.previewColor + "18", borderColor: field.previewColor + "40" }]}
                >
                  <Text style={[styles.previewBtnText, { color: field.previewColor }]}>Open ↗</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[styles.prefix, { color: colors.muted }]}>{field.prefix}</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={field.value}
                onChangeText={field.setter}
                placeholder={field.placeholder}
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>
          </View>
        ))}

        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: saved ? "#22C55E" : colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.saveBtnText}>{saved ? "Saved ✓" : "Save Social Links"}</Text>
        </Pressable>

        <View style={styles.note}>
          <IconSymbol name="info.circle.fill" size={14} color={colors.muted} />
          <Text style={[styles.noteText, { color: colors.muted }]}>
            Clients will see these icons at the bottom of your booking page and can tap them to visit your profiles.
          </Text>
        </View>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 80,
  },
  backLabel: {
    fontSize: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  scroll: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  sectionHeadingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  sectionHeadingTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  sectionDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  handlePreview: {
    fontSize: 12,
    marginTop: 1,
  },
  previewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  previewBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  prefix: {
    fontSize: 15,
  },
  input: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 4,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
});
