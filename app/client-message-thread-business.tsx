/**
 * Business Owner — Client Message Thread Screen
 *
 * Chat UI for the business owner to view and reply to messages from a specific client.
 * Route params: { clientAccountId: string, clientName: string }
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
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { apiCall } from "@/lib/_core/api";
import * as Haptics from "expo-haptics";

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

export default function ClientMessageThreadBusinessScreen() {
  const colors = useColors();
  const router = useRouter();
  const { clientAccountId, clientName } = useLocalSearchParams<{ clientAccountId: string; clientName: string }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiCall<Message[]>(`/api/business/messages/${clientAccountId}`);
      setMessages(Array.isArray(data) ? data : []);
      // Mark messages as read
      apiCall(`/api/business/messages/${clientAccountId}/read`, { method: "POST" }).catch(() => {});
    } catch (err: any) {
      if (!silent) setError("Could not load messages");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [clientAccountId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
      // Poll every 10 seconds for new messages
      pollRef.current = setInterval(() => loadMessages(true), 10000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [loadMessages])
  );

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    setDraft("");
    try {
      const newMsg = await apiCall<Message>(`/api/business/messages/${clientAccountId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setMessages((prev) => [...prev, newMsg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      setDraft(body); // Restore draft on error
    } finally {
      setSending(false);
    }
  };

  // Build flat list items with date separators
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

  const s = makeStyles(colors);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Pressable style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
        </Pressable>
        <View style={s.headerInfo}>
          <Text style={[s.headerName, { color: colors.foreground }]} numberOfLines={1}>
            {clientName ?? "Client"}
          </Text>
          <Text style={[s.headerSub, { color: colors.muted }]}>Client message</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={s.errorContainer}>
            <IconSymbol name="exclamationmark.circle" size={32} color={colors.error} />
            <Text style={{ color: colors.error, marginTop: 10, fontSize: 14 }}>{error}</Text>
            <Pressable
              onPress={() => loadMessages()}
              style={({ pressed }) => [s.retryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={items}
            keyExtractor={(item) => ("id" in item ? String(item.id) : item.key)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={s.emptyContainer}>
                <IconSymbol name="text.bubble" size={32} color={colors.muted} />
                <Text style={[s.emptyText, { color: colors.muted }]}>
                  No messages yet. Reply to start the conversation.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === "date") {
                return (
                  <View style={s.dateSeparator}>
                    <View style={[s.dateLine, { backgroundColor: colors.border }]} />
                    <Text style={[s.dateLabel, { color: colors.muted, backgroundColor: colors.background }]}>
                      {(item as any).label}
                    </Text>
                    <View style={[s.dateLine, { backgroundColor: colors.border }]} />
                  </View>
                );
              }
              const msg = item as Message & { type: "message" };
              const isBusiness = msg.senderType === "business";
              return (
                <View style={[s.msgRow, isBusiness ? s.msgRowRight : s.msgRowLeft]}>
                  {!isBusiness && (
                    <View style={[s.msgAvatar, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>
                        {(clientName ?? "C").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[
                    s.msgBubble,
                    isBusiness
                      ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                      : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
                  ]}>
                    <Text style={[s.msgBody, { color: isBusiness ? "#FFFFFF" : colors.foreground }]}>
                      {msg.body}
                    </Text>
                    <Text style={[s.msgTime, { color: isBusiness ? "#FFFFFF99" : colors.muted }]}>
                      {formatTime(msg.createdAt)}
                      {isBusiness && msg.readAt && "  ✓"}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Input Bar */}
        <View style={[s.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TextInput
            style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Reply to client..."
            placeholderTextColor={colors.muted}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <Pressable
            style={({ pressed }) => [
              s.sendBtn,
              { backgroundColor: draft.trim() ? colors.primary : colors.border },
              pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] },
            ]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
    backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    headerInfo: { flex: 1 },
    headerName: { fontSize: 16, fontWeight: "700" },
    headerSub: { fontSize: 12 },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
    retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
    emptyContainer: { alignItems: "center", paddingTop: 60, gap: 12 },
    emptyText: { fontSize: 14, textAlign: "center", maxWidth: 240 },
    dateSeparator: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 12 },
    dateLine: { flex: 1, height: 1 },
    dateLabel: { fontSize: 12, fontWeight: "600", paddingHorizontal: 8 },
    msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 8, gap: 8 },
    msgRowLeft: { justifyContent: "flex-start" },
    msgRowRight: { justifyContent: "flex-end" },
    msgAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    msgBubble: { maxWidth: "75%", borderRadius: 16, padding: 10, gap: 4 },
    msgBody: { fontSize: 14, lineHeight: 20 },
    msgTime: { fontSize: 10, alignSelf: "flex-end" },
    inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1 },
    input: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
    sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  });
