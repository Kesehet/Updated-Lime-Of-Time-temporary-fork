/**
 * Client Portal — Message Thread Screen
 *
 * Real-time-style message thread between client and business.
 * Uses businessOwnerId-based API endpoints.
 *
 * Design: dark forest-green portal aesthetic matching all other client portal screens.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  Platform,
  ActivityIndicator,
  Image,
  Alert,
  Linking,
  Keyboard,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect } from "@react-navigation/native";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Calendar from "expo-calendar";
import { getMapUrl } from "@/lib/types";

// ─── Portal palette ───────────────────────────────────────────────────────────
const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

// Client bubble: lime-green tinted
const CLIENT_BUBBLE_BG = "rgba(143,191,106,0.85)";
const CLIENT_BUBBLE_TEXT = "#1A3A28";

// Business bubble: translucent white card
const BUSINESS_BUBBLE_BG = "rgba(255,255,255,0.10)";
const BUSINESS_BUBBLE_BORDER = "rgba(255,255,255,0.18)";

interface Message {
  id: number;
  senderType: "client" | "business";
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ─── Calendar helper ─────────────────────────────────────────────────────────
async function addDateToCalendar(dateStr: string, timeStr: string, title: string, locationStr?: string) {
  if (Platform.OS === "web") {
    Alert.alert("Not supported", "Calendar integration is not available on web.");
    return;
  }
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission needed", "Please allow calendar access to add this appointment.");
    return;
  }
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [h, m] = (timeStr ?? "09:00").split(":").map(Number);
    const startDate = new Date(year, month - 1, day, h, m);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    let calendarId: string;
    if (Platform.OS === "ios") {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = defaultCal.id;
    } else {
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const primary = cals.find(c => c.isPrimary) ?? cals.find(c => c.allowsModifications) ?? cals[0];
      if (!primary) { Alert.alert("No calendar", "No calendar found on this device."); return; }
      calendarId = primary.id;
    }
    await Calendar.createEventAsync(calendarId, {
      title,
      startDate,
      endDate,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: locationStr,
      alarms: [{ relativeOffset: -60 }, { relativeOffset: -1440 }],
    });
    Alert.alert("Added!", "Appointment added to your calendar.");
  } catch {
    Alert.alert("Error", "Could not add to calendar.");
  }
}

// ─── Clickable message segment types ─────────────────────────────────────────
type MsgSegment =
  | { kind: "text"; text: string }
  | { kind: "phone"; text: string; digits: string }
  | { kind: "address"; text: string; address: string }
  | { kind: "date"; text: string; dateStr: string; timeStr: string };

function parseMessageSegments(body: string): MsgSegment[] {
  const segments: MsgSegment[] = [];
  const lines = body.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineWithNL = li < lines.length - 1 ? line + "\n" : line;
    if (line.startsWith("\u{1F4CD}") || line.startsWith("📍")) {
      const addr = line.replace(/^📍\s*/, "").trim();
      if (addr) { segments.push({ kind: "address", text: lineWithNL, address: addr }); continue; }
    }
    if (line.startsWith("\u{1F4DE}") || line.startsWith("📞") || line.startsWith("☎") || line.startsWith("☏")) {
      const raw = line.replace(/^[📞☎☏]\s*/, "").trim();
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 10) { segments.push({ kind: "phone", text: lineWithNL, digits }); continue; }
    }
    if (line.startsWith("\u{1F4C5}") || line.startsWith("📅")) {
      const raw = line.replace(/^📅\s*/, "").trim();
      const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
      const timeMatch = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (isoMatch) {
        const timeStr = timeMatch ? (() => {
          let h = parseInt(timeMatch[1]);
          const min = timeMatch[2];
          const ampm = timeMatch[3].toUpperCase();
          if (ampm === "PM" && h < 12) h += 12;
          if (ampm === "AM" && h === 12) h = 0;
          return `${String(h).padStart(2, "0")}:${min}`;
        })() : "09:00";
        segments.push({ kind: "date", text: lineWithNL, dateStr: isoMatch[0], timeStr }); continue;
      }
    }
    const phoneRegex = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let hasPhone = false;
    while ((match = phoneRegex.exec(lineWithNL)) !== null) {
      hasPhone = true;
      if (match.index > lastIndex) segments.push({ kind: "text", text: lineWithNL.slice(lastIndex, match.index) });
      const digits = match[1].replace(/\D/g, "");
      segments.push({ kind: "phone", text: match[1], digits });
      lastIndex = match.index + match[1].length;
    }
    if (hasPhone) {
      if (lastIndex < lineWithNL.length) segments.push({ kind: "text", text: lineWithNL.slice(lastIndex) });
    } else {
      segments.push({ kind: "text", text: lineWithNL });
    }
  }
  return segments;
}

function RichMessageBody({ body, textColor, linkColor, msgTitle }: { body: string; textColor: string; linkColor: string; msgTitle: string }) {
  const segments = useMemo(() => parseMessageSegments(body), [body]);
  const addrSeg = segments.find((s): s is Extract<MsgSegment, { kind: "address" }> => s.kind === "address");
  return (
    <Text style={{ fontSize: 14, lineHeight: 20, color: textColor }}>
      {segments.map((seg, i) => {
        if (seg.kind === "phone") return (
          <Text key={i} style={{ color: linkColor, textDecorationLine: "underline", fontWeight: "600" }}
            onPress={() => Linking.openURL(`tel:${seg.digits}`)}>{seg.text}</Text>
        );
        if (seg.kind === "address") return (
          <Text key={i} style={{ color: linkColor, textDecorationLine: "underline", fontWeight: "600" }}
            onPress={() => Linking.openURL(getMapUrl(seg.address))}>{seg.text}</Text>
        );
        if (seg.kind === "date") return (
          <Text key={i} style={{ color: linkColor, textDecorationLine: "underline", fontWeight: "600" }}
            onPress={() => addDateToCalendar(seg.dateStr, seg.timeStr, msgTitle, addrSeg?.address)}>{seg.text}</Text>
        );
        return <Text key={i} style={{ color: textColor }}>{seg.text}</Text>;
      })}
    </Text>
  );
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ClientMessageThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Accept either businessOwnerId (new) or appointmentId (legacy) params
  const params = useLocalSearchParams<{
    businessOwnerId?: string;
    businessName?: string;
    businessLogoUri?: string;
    serviceName?: string;
    appointmentDate?: string;
  }>();
  const businessOwnerId = params.businessOwnerId;
  const { apiCall, dispatch } = useClientStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Keyboard height tracking (works with edge-to-edge Android) ───────────
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0)
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const loadMessages = useCallback(async (silent = false) => {
    if (!businessOwnerId) return;
    if (!silent) setLoading(true);
    try {
      const data = await apiCall<{ messages: Message[] }>(`/api/client/messages/${businessOwnerId}`);
      setMessages(data.messages ?? []);
      // Refresh unread count after marking as read
      apiCall<{ count: number }>("/api/client/messages/unread-count")
        .then((r) => dispatch({ type: "SET_UNREAD_COUNT", payload: r.count }))
        .catch(() => {});
    } catch (err) {
      console.warn("[MessageThread] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [businessOwnerId, apiCall, dispatch]);

  useFocusEffect(useCallback(() => {
    loadMessages();
    pollRef.current = setInterval(() => loadMessages(true), 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMessages]));

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending || !businessOwnerId) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    setDraft("");
    try {
      const data = await apiCall<{ message: Message }>(`/api/client/messages/${businessOwnerId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setMessages((prev) => [...prev, data.message]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      console.warn("[MessageThread] send error:", err);
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = (msg: Message) => {
    Alert.alert(
      "Delete Message",
      "This message will be removed from your view only.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            try {
              await apiCall(`/api/client/messages/${businessOwnerId}/${msg.id}`, { method: "DELETE" });
            } catch {
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.createdAt > msg.createdAt);
                const copy = [...prev];
                if (idx === -1) copy.push(msg); else copy.splice(idx, 0, msg);
                return copy;
              });
            }
          },
        },
      ]
    );
  };
  // Build grouped items (date separators + messages)
  const items: ({ type: "date"; key: string; label: string } | (Message & { type: "message" }))[] = [];
  let lastDay = "";
  messages.forEach((msg) => {
    const day = formatDay(msg.createdAt);
    if (day !== lastDay) {
      items.push({ type: "date", key: `date-${msg.createdAt}`, label: day });
      lastDay = day;
    }
    items.push({ ...msg, type: "message" });
  });

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <StatusBar style="light" />
      <ClientPortalBackground />
      {/* Drag handle */}
      <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
      </View>


      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
        </Pressable>
        {/* Business logo avatar */}
        {params.businessLogoUri ? (
          <View style={styles.headerAvatar}>
            <Image
              source={{ uri: params.businessLogoUri }}
              style={{ width: 36, height: 36, borderRadius: 18 }}
              resizeMode="cover"
            />
          </View>
        ) : (
          <View style={styles.headerAvatarInitials}>
            <Text style={styles.headerAvatarText}>
              {(params.businessName ?? "B").split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("")}
            </Text>
          </View>
        )}
        <View style={styles.headerInfo}>
          <Text style={styles.headerBusiness} numberOfLines={1}>
            {params.businessName ?? "Business"}
          </Text>
          {params.serviceName ? (
            <Text style={styles.headerAppt} numberOfLines={1}>
              {params.serviceName}{params.appointmentDate ? ` · ${params.appointmentDate}` : ""}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={{ flex: 1, paddingBottom: keyboardHeight > 0 ? keyboardHeight - insets.bottom : 0 }}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={GREEN_ACCENT} size="large" />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={items}
            keyExtractor={(item) => ("id" in item ? String(item.id) : item.key)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <IconSymbol name="text.bubble" size={28} color={GREEN_ACCENT} />
                </View>
                <Text style={styles.emptyText}>
                  No messages yet.{"\n"}Send a message to the business!
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === "date") {
                return (
                  <View style={styles.dateSeparator}>
                    <View style={styles.dateLine} />
                    <Text style={styles.dateLabel}>{(item as any).label}</Text>
                    <View style={styles.dateLine} />
                  </View>
                );
              }
              const msg = item as Message & { type: "message" };
              const isClient = msg.senderType === "client";
              return (
                <View style={[styles.msgRow, isClient ? styles.msgRowRight : styles.msgRowLeft]}>
                  {!isClient && (
                    <View style={styles.msgAvatar}>
                      {params.businessLogoUri ? (
                        <Image
                          source={{ uri: params.businessLogoUri }}
                          style={{ width: 30, height: 30, borderRadius: 15 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <Text style={{ fontSize: 13, fontWeight: "700", color: GREEN_ACCENT }}>
                          {(params.businessName ?? "B").charAt(0).toUpperCase()}
                        </Text>
                      )}
                    </View>
                  )}
                  <Pressable
                    onLongPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      Alert.alert(
                        "Message Options",
                        undefined,
                        [
                          {
                            text: "📋 Copy Text",
                            onPress: () => {
                              const Clipboard = require("expo-clipboard");
                              Clipboard.setStringAsync?.(msg.body) ?? Clipboard.setString?.(msg.body);
                            },
                          },
                          {
                            text: "🗑 Delete",
                            style: "destructive",
                            onPress: () => handleDeleteMessage(msg),
                          },
                          { text: "Cancel", style: "cancel" },
                        ]
                      );
                    }}
                    delayLongPress={400}
                    style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, maxWidth: "75%", flexShrink: 1 }]}
                  >
                    <View style={[
                      styles.msgBubble,
                      isClient ? styles.msgBubbleClient : styles.msgBubbleBusiness,
                    ]}>
                      <RichMessageBody
                        body={msg.body}
                        textColor={isClient ? CLIENT_BUBBLE_TEXT : TEXT_PRIMARY}
                        linkColor={isClient ? "#1A5C2A" : GREEN_ACCENT}
                        msgTitle={params.businessName ?? "Appointment"}
                      />
                      <Text style={[
                        styles.msgTime,
                        { color: isClient ? "rgba(26,58,40,0.6)" : TEXT_MUTED },
                      ]}>
                        {formatTime(msg.createdAt)}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              );
            }}
          />
        )}

        {/* ── Input Bar ──────────────────────────────────────────────── */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={TEXT_MUTED}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: draft.trim() ? GREEN_ACCENT : "rgba(255,255,255,0.15)" },
              pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] },
            ]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={draft.trim() ? GREEN_DARK : TEXT_MUTED} />
            ) : (
              <IconSymbol
                name="paperplane.fill"
                size={18}
                color={draft.trim() ? GREEN_DARK : TEXT_MUTED}
              />
            )}
          </Pressable>
        </View>
        {/* Character counter */}
        {draft.length > 0 && (
          <Text style={[
            { fontSize: 11, textAlign: "right", paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4 },
            { color: draft.length > 900 ? "#EF4444" : draft.length > 750 ? "#F59E0B" : TEXT_MUTED }
          ]}>
            {draft.length}/1000
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.3)",
  },
  headerAvatarInitials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(143,191,106,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.3)",
  },
  headerAvatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  headerInfo: {
    flex: 1,
  },
  headerBusiness: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  headerAppt: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 1,
  },
  // ─── Loading / Empty ─────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: 60,
    gap: 14,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    maxWidth: 240,
    color: TEXT_MUTED,
    lineHeight: 20,
  },
  // ─── Date Separator ──────────────────────────────────────────────────────
  dateSeparator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 14,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: CARD_BORDER,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: TEXT_MUTED,
    paddingHorizontal: 6,
  },
  // ─── Message Bubbles ─────────────────────────────────────────────────────
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 8,
    gap: 8,
  },
  msgRowLeft: {
    justifyContent: "flex-start",
  },
  msgRowRight: {
    justifyContent: "flex-end",
  },
  msgAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(143,191,106,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.25)",
  },
  msgBubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
  },
  msgBubbleClient: {
    backgroundColor: CLIENT_BUBBLE_BG,
    borderBottomRightRadius: 4,
  },
  msgBubbleBusiness: {
    backgroundColor: BUSINESS_BUBBLE_BG,
    borderWidth: 1,
    borderColor: BUSINESS_BUBBLE_BORDER,
    borderBottomLeftRadius: 4,
  },
  msgBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  msgTime: {
    fontSize: 10,
    alignSelf: "flex-end",
  },
  // ─── Input Bar ───────────────────────────────────────────────────────────
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
    backgroundColor: "rgba(26,58,40,0.85)",
  },
  input: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
    color: TEXT_PRIMARY,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
});
