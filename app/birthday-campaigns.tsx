import { useState, useMemo, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  FlatList,
  Alert,
  Linking,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter } from "expo-router";
import { Client, formatPhoneNumber, stripPhoneFormat, LIME_OF_TIME_FOOTER } from "@/lib/types";
import { trpc } from "@/lib/trpc";
import { FuturisticBackground } from "@/components/futuristic-background";


// Parse birthday string (MM/DD/YYYY or MM/DD) and return { month, day }
function parseBirthday(birthday: string): { month: number; day: number } | null {
  if (!birthday) return null;
  const parts = birthday.trim().split("/");
  if (parts.length < 2) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function getDaysUntilBirthday(birthday: string): number | null {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;
  const now = new Date();
  const thisYear = now.getFullYear();
  let next = new Date(thisYear, parsed.month - 1, parsed.day);
  if (next < now) {
    next = new Date(thisYear + 1, parsed.month - 1, parsed.day);
  }
  const diff = Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function formatBirthdayDisplay(birthday: string): string {
  const parsed = parseBirthday(birthday);
  if (!parsed) return birthday;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parsed.month - 1]} ${parsed.day}`;
}

type BirthdayFilter = "upcoming" | "today" | "all";

export default function BirthdayCampaignsScreen() {
  const { state } = useStore();
  const colors = useColors();
  const sendSmsMutation = trpc.twilio.sendSms.useMutation();
  const router = useRouter();
  const { hp, fs, buttonHeight, iconButtonSize } = useResponsive();
  const [filter, setFilter] = useState<BirthdayFilter>("upcoming");
  const [discountCode, setDiscountCode] = useState("BDAY15");
  const [discountPct, setDiscountPct] = useState("15");
  const [showSettings, setShowSettings] = useState(false);

  const biz = state.settings;

  const clientsWithBirthdays = useMemo(() => {
    return state.clients
      .filter((c) => c.birthday && parseBirthday(c.birthday) !== null)
      .map((c) => ({
        client: c,
        daysUntil: getDaysUntilBirthday(c.birthday!) ?? 999,
        display: formatBirthdayDisplay(c.birthday!),
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [state.clients]);

  const filteredClients = useMemo(() => {
    if (filter === "today") return clientsWithBirthdays.filter((e) => e.daysUntil === 0);
    if (filter === "upcoming") return clientsWithBirthdays.filter((e) => e.daysUntil <= 30);
    return clientsWithBirthdays;
  }, [clientsWithBirthdays, filter]);

  const generateBirthdayMessage = useCallback(
    (client: Client) => {
      const bizName = biz.businessName;
      const code = discountCode.trim();
      const pct = discountPct.trim();
      const hasDiscount = code && pct;
      if (hasDiscount) {
        return `🎂 Happy Birthday, ${client.name}!\n\nWishing you a wonderful day! As a special birthday gift from ${bizName}, enjoy ${pct}% off your next appointment.\n\n🎁 Use code: ${code}\n\nBook now and treat yourself!\n\n${bizName}${LIME_OF_TIME_FOOTER}`;
      }
      return `🎂 Happy Birthday, ${client.name}!\n\nWishing you a wonderful birthday from all of us at ${bizName}! We hope your day is as special as you are. 🎉\n\nWe'd love to see you soon!\n\n${bizName}${LIME_OF_TIME_FOOTER}`;
    },
    [biz.businessName, discountCode, discountPct]
  );

  const handleSendMessage = useCallback(
    (client: Client) => {
      if (!client.phone) {
        Alert.alert("No Phone", `${client.name} doesn't have a phone number.`);
        return;
      }
      const message = generateBirthdayMessage(client);
      const biz2 = state.settings;
      const rawPhone = stripPhoneFormat(client.phone);
      const smsEnabled = biz2.twilioEnabled && biz2.twilioBirthdaySms;
      if (smsEnabled && state.businessOwnerId) {
        const toNumber = rawPhone.startsWith("+") ? rawPhone : `+1${rawPhone.replace(/\D/g, "")}`;
        sendSmsMutation
          .mutateAsync({
            businessOwnerId: state.businessOwnerId,
            toNumber,
            body: message,
            smsAction: "birthday",
          })
          .then(() => Alert.alert("Sent!", `Birthday SMS sent to ${client.name}.`))
          .catch(() => {
            if (Platform.OS === "web") {
              Alert.alert("Birthday Message", message);
            } else {
              const separator = Platform.OS === "ios" ? "&" : "?";
              const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(message)}`;
              Linking.openURL(url).catch(() => Alert.alert("Birthday Message", message));
            }
          });
      } else if (Platform.OS === "web") {
        Alert.alert("Birthday Message", message);
      } else {
        const separator = Platform.OS === "ios" ? "&" : "?";
        const url = `sms:${rawPhone}${separator}body=${encodeURIComponent(message)}`;
        Linking.openURL(url).catch(() => Alert.alert("Birthday Message", message));
      }
    },
    [generateBirthdayMessage, state.settings, sendSmsMutation]
  );

  const handleSendAll = useCallback(() => {
    const withPhone = filteredClients.filter((e) => e.client.phone);
    if (withPhone.length === 0) {
      Alert.alert("No Contacts", "None of the clients in this list have phone numbers.");
      return;
    }
    Alert.alert(
      "Send Birthday Messages",
      `Send birthday messages to ${withPhone.length} client${withPhone.length !== 1 ? "s" : ""}? Each message will open in your SMS app.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: () => {
            // Open SMS for the first client; on mobile the user sends one at a time
            handleSendMessage(withPhone[0].client);
          },
        },
      ]
    );
  }, [filteredClients, handleSendMessage]);

  const todayCount = clientsWithBirthdays.filter((e) => e.daysUntil === 0).length;
  const upcomingCount = clientsWithBirthdays.filter((e) => e.daysUntil <= 30).length;

  const filters: { key: BirthdayFilter; label: string; count: number }[] = [
    { key: "today", label: "Today", count: todayCount },
    { key: "upcoming", label: "Next 30 Days", count: upcomingCount },
    { key: "all", label: "All", count: clientsWithBirthdays.length },
  ];

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <FuturisticBackground />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: hp }}>
        {/* Header */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="chevron.left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground }}>Birthday Campaigns</Text>
          <Pressable onPress={() => setShowSettings(!showSettings)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="gearshape.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>

        {/* Campaign Settings Panel */}
        {showSettings && (
          <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>Birthday Discount Settings</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 4 }}>Discount %</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  value={discountPct}
                  onChangeText={setDiscountPct}
                  keyboardType="numeric"
                  placeholder="15"
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 4 }}>Promo Code</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  value={discountCode}
                  onChangeText={setDiscountCode}
                  placeholder="BDAY15"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  returnKeyType="done"
                />
              </View>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>
              Leave code empty to send a greeting without a discount.
            </Text>
          </View>
        )}

        {/* Summary Banner */}
        {todayCount > 0 && (
          <View style={[styles.todayBanner, { backgroundColor: "#FF9800" + "18", borderColor: "#FF9800" + "40" }]}>
            <Text style={{ fontSize: fs.lg }}>🎂</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#FF9800" }}>
                {todayCount === 1 ? "1 client has a birthday today!" : `${todayCount} clients have birthdays today!`}
              </Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Send them a special message now.</Text>
            </View>
          </View>
        )}

        {/* Filter Tabs */}
        <View style={[styles.filterRow, { borderColor: colors.border }]}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={({ pressed }) => [styles.filterTab, { borderBottomColor: filter === f.key ? colors.primary : "transparent", opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: filter === f.key ? colors.primary : colors.muted }}>{f.label}</Text>
              {f.count > 0 && (
                <View style={[styles.badge, { backgroundColor: filter === f.key ? colors.primary : colors.muted + "30" }]}>
                  <Text style={{ fontSize: 9, fontWeight: "700", color: filter === f.key ? "#FFF" : colors.muted }}>{f.count}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Send All Button */}
        {filteredClients.length > 1 && (
          <Pressable
            onPress={handleSendAll}
            style={({ pressed }) => [styles.sendAllBtn, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30", opacity: pressed ? 0.7 : 1 }]}
          >
            <IconSymbol name="paperplane.fill" size={14} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary, marginLeft: 6 }}>
              Send to All ({filteredClients.filter((e) => e.client.phone).length})
            </Text>
          </Pressable>
        )}

        {/* Client List */}
        <FlatList
          data={filteredClients}
          keyExtractor={(item) => item.client.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32, paddingTop: 8 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <IconSymbol name="birthday.cake" size={40} color={colors.muted + "60"} />
              <Text style={{ color: colors.muted, fontSize: fs.sm, marginTop: 12 }}>
                {filter === "today"
                  ? "No birthdays today"
                  : filter === "upcoming"
                  ? "No birthdays in the next 30 days"
                  : "No clients have birthdays on file"}
              </Text>
              <Text style={{ color: colors.muted, fontSize: fs.xs, marginTop: 4, textAlign: "center" }}>
                Add birthdays to client profiles to see them here.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const { client, daysUntil, display } = item;
            const isToday = daysUntil === 0;
            const isSoon = daysUntil <= 7;
            const accentColor = isToday ? "#FF9800" : isSoon ? colors.primary : colors.muted;
            return (
              <View style={[styles.clientCard, { backgroundColor: colors.surface, borderColor: isToday ? "#FF9800" + "50" : colors.border, borderLeftColor: accentColor }]}>
                <View style={[styles.avatar, { backgroundColor: accentColor + "20" }]}>
                  <Text style={{ fontSize: fs.md, fontWeight: "700", color: accentColor }}>
                    {client.name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{client.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 }}>
                    <IconSymbol name="birthday.cake" size={12} color={accentColor} />
                    <Text style={{ fontSize: fs.xs, color: accentColor, fontWeight: "500" }}>{display}</Text>
                    {isToday ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#FF9800" + "20" }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: "#FF9800" }}>TODAY</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>
                        {daysUntil === 1 ? "Tomorrow" : `in ${daysUntil} days`}
                      </Text>
                    )}
                  </View>
                  {client.phone ? (
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{formatPhoneNumber(client.phone)}</Text>
                  ) : (
                    <Text style={{ fontSize: fs.xs, color: colors.error, marginTop: 2 }}>No phone number</Text>
                  )}
                </View>
                <Pressable
                  onPress={() => handleSendMessage(client)}
                  style={({ pressed }) => [styles.sendBtn, { backgroundColor: accentColor, opacity: pressed ? 0.8 : 1 }]}
                >
                  <IconSymbol name="paperplane.fill" size={14} color="#FFF" />
                </Pressable>
              </View>
            );
          }}
        />
      </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  settingsCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 12 },
  input: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, fontSize: fs.sm, borderWidth: 1 },
  todayBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 12 },
  filterRow: { flexDirection: "row", borderBottomWidth: 1, marginBottom: 8 },
  filterTab: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, flexDirection: "row", justifyContent: "center", gap: 4 },
  badge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8, minWidth: 18, alignItems: "center" },
  sendAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  clientCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderLeftWidth: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyState: { alignItems: "center", paddingVertical: 60 },
});
