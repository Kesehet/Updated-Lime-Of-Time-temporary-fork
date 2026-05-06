/**
 * Client Portal — Message Thread Screen
 *
 * Real-time-style message thread between client and business.
 * Uses businessOwnerId-based API endpoints.
 *
 * Design: dark forest-green portal aesthetic matching all other client portal screens.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

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
      <ClientPortalBackground />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
        </Pressable>
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
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
                      <IconSymbol name="scissors" size={13} color={GREEN_ACCENT} />
                    </View>
                  )}
                  <View style={[
                    styles.msgBubble,
                    isClient ? styles.msgBubbleClient : styles.msgBubbleBusiness,
                  ]}>
                    <Text style={[
                      styles.msgBody,
                      { color: isClient ? CLIENT_BUBBLE_TEXT : TEXT_PRIMARY },
                    ]}>
                      {msg.body}
                    </Text>
                    <Text style={[
                      styles.msgTime,
                      { color: isClient ? "rgba(26,58,40,0.6)" : TEXT_MUTED },
                    ]}>
                      {formatTime(msg.createdAt)}
                    </Text>
                  </View>
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
      </KeyboardAvoidingView>
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
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
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
    maxWidth: "75%",
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
