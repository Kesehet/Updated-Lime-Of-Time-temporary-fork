/**
 * Business Owner — Client Message Thread Screen
 *
 * Chat UI for the business owner to view and reply to messages from a specific client.
 * Route params: { clientAccountId: string, clientName: string, clientAvatarUrl?: string }
 * - Shows client profile picture (photo or initials fallback)
 * - Full theme support (dark/light follows business portal)
 * - Rich template library for quick replies
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
  Image,
  Modal,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { apiCall } from "@/lib/_core/api";

// ─── Message Templates ────────────────────────────────────────────────────────
const TEMPLATE_CATEGORIES = [
  {
    label: "Appointments",
    icon: "📅",
    templates: [
      { title: "Confirmation", body: "Hi {name}! Your appointment has been confirmed. We look forward to seeing you. Please let us know if you have any questions." },
      { title: "Reminder (1 day)", body: "Hi {name}! Just a friendly reminder that you have an appointment with us tomorrow. See you soon!" },
      { title: "Reminder (1 hour)", body: "Hi {name}! Your appointment is in about 1 hour. We're looking forward to seeing you shortly!" },
      { title: "Running Late", body: "Hi {name}, we're running a few minutes behind schedule. Your appointment will start shortly — thank you for your patience!" },
      { title: "Ready Now", body: "Hi {name}! We're ready for you now. Please come in when you're ready." },
    ],
  },
  {
    label: "Cancellations",
    icon: "❌",
    templates: [
      { title: "Cancellation Confirmed", body: "Hi {name}, your appointment has been cancelled as requested. We hope to see you again soon — feel free to book a new appointment anytime!" },
      { title: "Business Cancellation", body: "Hi {name}, we're sorry but we need to cancel your upcoming appointment due to an unforeseen circumstance. We sincerely apologize for the inconvenience and would love to reschedule at your earliest convenience." },
      { title: "Late Cancellation Policy", body: "Hi {name}, we noticed your appointment was cancelled within our late cancellation window. Our policy requires 24 hours notice. Please reach out if you have any questions." },
      { title: "No-Show Follow-Up", body: "Hi {name}, we missed you at your appointment today! We hope everything is okay. Please reach out if you'd like to reschedule." },
    ],
  },
  {
    label: "Rescheduling",
    icon: "🔄",
    templates: [
      { title: "Reschedule Request", body: "Hi {name}! We'd love to reschedule your appointment. Please let us know your availability and we'll find a time that works for you." },
      { title: "Reschedule Confirmed", body: "Hi {name}! Your appointment has been rescheduled. We've updated your booking and look forward to seeing you at the new time." },
      { title: "New Opening Available", body: "Hi {name}! We have a new opening available that might work for you. Would you like to book it? Just reply and we'll get you set up!" },
    ],
  },
  {
    label: "Follow-Up",
    icon: "⭐",
    templates: [
      { title: "Post-Service Thank You", body: "Hi {name}! Thank you for visiting us today. We hope you enjoyed your service! We'd love to hear your feedback — your satisfaction means everything to us." },
      { title: "Review Request", body: "Hi {name}! We hope you loved your recent visit. If you have a moment, we'd really appreciate a review — it helps us grow and serve you better. Thank you so much!" },
      { title: "Check-In", body: "Hi {name}! We just wanted to check in and see how you're doing after your recent visit. We hope everything went well!" },
      { title: "Referral Thank You", body: "Hi {name}! Thank you so much for referring a friend to us — it means the world! We truly appreciate your support and loyalty." },
    ],
  },
  {
    label: "Promotions",
    icon: "🎁",
    templates: [
      { title: "Special Offer", body: "Hi {name}! We have a special offer just for you. Reply to this message or book online to take advantage of this limited-time deal!" },
      { title: "Birthday Greeting", body: "Hi {name}! 🎂 Wishing you a wonderful birthday! As a special treat, we'd love to offer you a birthday discount on your next visit. Come celebrate with us!" },
      { title: "Loyalty Reward", body: "Hi {name}! You've been such a loyal client and we want to say thank you! You've earned a special reward — reach out to learn more." },
      { title: "New Service Announcement", body: "Hi {name}! We're excited to announce a new service that we think you'll love. Ask us about it at your next visit or reply to learn more!" },
      { title: "Seasonal Promotion", body: "Hi {name}! We're running a seasonal promotion and wanted to make sure you heard about it first. Reply or book online to take advantage!" },
    ],
  },
  {
    label: "General",
    icon: "💬",
    templates: [
      { title: "Welcome", body: "Hi {name}! Welcome to our family! We're so excited to have you as a new client. Don't hesitate to reach out if you have any questions." },
      { title: "Thank You", body: "Hi {name}! Thank you so much for your continued support. We truly appreciate you and look forward to seeing you again soon!" },
      { title: "Hours Update", body: "Hi {name}! We wanted to let you know about an update to our business hours. Please check our booking page for the latest availability." },
      { title: "Policy Reminder", body: "Hi {name}! Just a quick reminder about our booking policy: we require 24 hours notice for cancellations. Thank you for your understanding!" },
      { title: "Payment Reminder", body: "Hi {name}! We noticed there's an outstanding balance on your account. Please reach out at your earliest convenience so we can get this sorted for you." },
    ],
  },
];

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

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function ClientMessageThreadBusinessScreen() {
  const colors = useColors();
  const router = useRouter();
  const { clientAccountId, clientName, clientAvatarUrl: paramAvatarUrl } = useLocalSearchParams<{
    clientAccountId: string;
    clientName: string;
    clientAvatarUrl?: string;
  }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(paramAvatarUrl || null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiCall<any>(`/api/business/messages/${clientAccountId}`);
      const msgs: Message[] = Array.isArray(data) ? data : (data?.messages ?? []);
      setMessages(msgs);
      if (data?.clientAvatarUrl) setAvatarUrl(data.clientAvatarUrl);
    } catch (err: any) {
      if (!silent) setError(err?.message ?? "Failed to load messages");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [clientAccountId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
      pollRef.current = setInterval(() => loadMessages(true), 10_000);
      return () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };
    }, [loadMessages])
  );

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    const optimistic: Message = {
      id: Date.now(),
      senderType: "business",
      senderName: "You",
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      await apiCall(`/api/business/messages/${clientAccountId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      await loadMessages(true);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [draft, sending, clientAccountId, loadMessages]);

  const handleSelectTemplate = useCallback((templateBody: string) => {
    const firstName = (clientName ?? "there").split(" ")[0];
    const filled = templateBody.replace(/\{name\}/g, firstName);
    setDraft(filled);
    setShowTemplates(false);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [clientName]);

  const listData = React.useMemo(() => {
    const items: Array<{ type: "date"; label: string; key: string } | (Message & { type: "message" })> = [];
    let lastDay = "";
    for (const msg of messages) {
      const day = formatDay(msg.createdAt);
      if (day !== lastDay) {
        items.push({ type: "date", label: day, key: `date-${day}` });
        lastDay = day;
      }
      items.push({ ...msg, type: "message" });
    }
    return items;
  }, [messages]);

  const s = makeStyles(colors);

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-background">
      <StatusBar style="auto" />
      <View style={[s.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [s.backBtn, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.back()}
        >
          <IconSymbol name="chevron.right" size={16} color={colors.foreground} style={{ transform: [{ scaleX: -1 }] }} />
        </Pressable>
        <View style={[s.headerAvatar, { backgroundColor: colors.primary + "25", overflow: "hidden" }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={{ width: 38, height: 38, borderRadius: 19 }} resizeMode="cover" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>
              {getInitials(clientName ?? "C")}
            </Text>
          )}
        </View>
        <View style={s.headerInfo}>
          <Text style={[s.headerName, { color: colors.foreground }]} numberOfLines={1}>{clientName ?? "Client"}</Text>
          <Text style={[s.headerSub, { color: colors.muted }]}>Message thread</Text>
        </View>
        <Pressable
          style={({ pressed }) => [s.templateBtn, { backgroundColor: colors.primary + "20", opacity: pressed ? 0.7 : 1 }]}
          onPress={() => { setShowTemplates(true); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Text style={{ fontSize: 16 }}>⚡</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={s.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : error ? (
          <View style={s.errorContainer}>
            <Text style={{ fontSize: 32 }}>⚠️</Text>
            <Text style={[s.emptyText, { color: colors.muted }]}>{error}</Text>
            <Pressable style={({ pressed }) => [s.retryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]} onPress={() => loadMessages()}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={listData}
            keyExtractor={(item) => item.type === "date" ? item.key : String(item.id)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
            ListEmptyComponent={
              <View style={s.emptyContainer}>
                <Text style={{ fontSize: 32 }}>💬</Text>
                <Text style={[s.emptyText, { color: colors.muted }]}>No messages yet. Start the conversation!</Text>
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === "date") {
                return (
                  <View style={s.dateSeparator}>
                    <View style={[s.dateLine, { backgroundColor: colors.border }]} />
                    <Text style={[s.dateLabel, { color: colors.muted, backgroundColor: colors.background }]}>{(item as any).label}</Text>
                    <View style={[s.dateLine, { backgroundColor: colors.border }]} />
                  </View>
                );
              }
              const msg = item as Message & { type: "message" };
              const isBusiness = msg.senderType === "business";
              return (
                <View style={[s.msgRow, isBusiness ? s.msgRowRight : s.msgRowLeft]}>
                  {!isBusiness && (
                    <View style={[s.msgAvatar, { backgroundColor: colors.primary + "25", overflow: "hidden" }]}>
                      {avatarUrl ? (
                        <Image source={{ uri: avatarUrl }} style={{ width: 28, height: 28, borderRadius: 14 }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{(clientName ?? "C").charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                  )}
                  <View style={[s.msgBubble, isBusiness ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 } : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 }]}>
                    <Text style={[s.msgBody, { color: isBusiness ? "#FFFFFF" : colors.foreground }]}>{msg.body}</Text>
                    <Text style={[s.msgTime, { color: isBusiness ? "rgba(255,255,255,0.6)" : colors.muted }]}>
                      {formatTime(msg.createdAt)}{isBusiness && msg.readAt && "  ✓"}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}
        <View style={[s.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <Pressable
            style={({ pressed }) => [s.templateIconBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            onPress={() => { setShowTemplates(true); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Text style={{ fontSize: 18 }}>⚡</Text>
          </Pressable>
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
            style={({ pressed }) => [s.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.border }, pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] }]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showTemplates} animationType="slide" transparent onRequestClose={() => setShowTemplates(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowTemplates(false)} />
        <View style={[s.templateSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[s.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>⚡ Quick Templates</Text>
            <Pressable style={({ pressed }) => [s.closeBtn, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]} onPress={() => setShowTemplates(false)}>
              <IconSymbol name="xmark" size={14} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.categoryScroll, { borderBottomColor: colors.border }]} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}>
            {TEMPLATE_CATEGORIES.map((cat, idx) => (
              <Pressable
                key={cat.label}
                style={({ pressed }) => [s.categoryChip, { backgroundColor: selectedCategory === idx ? colors.primary : colors.surface, borderColor: selectedCategory === idx ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 }]}
                onPress={() => { setSelectedCategory(idx); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <Text style={{ fontSize: 14 }}>{cat.icon}</Text>
                <Text style={[s.categoryLabel, { color: selectedCategory === idx ? "#fff" : colors.foreground }]}>{cat.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
            {TEMPLATE_CATEGORIES[selectedCategory].templates.map((tpl, idx) => (
              <Pressable
                key={idx}
                style={({ pressed }) => [s.templateCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => handleSelectTemplate(tpl.body)}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={[s.templateTitle, { color: colors.primary }]}>{tpl.title}</Text>
                  <View style={[s.useBtn, { backgroundColor: colors.primary + "20" }]}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>Use</Text>
                  </View>
                </View>
                <Text style={[s.templateBody, { color: colors.muted }]} numberOfLines={3}>
                  {tpl.body.replace(/\{name\}/g, (clientName ?? "there").split(" ")[0])}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
    backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    headerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    headerInfo: { flex: 1 },
    headerName: { fontSize: 15, fontWeight: "700" },
    headerSub: { fontSize: 11 },
    templateBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
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
    inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
    templateIconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    input: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
    sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    modalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
    templateSheet: { position: "absolute", bottom: 0, left: 0, right: 0, height: "75%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" },
    sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
    sheetTitle: { fontSize: 17, fontWeight: "700" },
    closeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    categoryScroll: { borderBottomWidth: 1, paddingVertical: 12, flexGrow: 0 },
    categoryChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
    categoryLabel: { fontSize: 13, fontWeight: "600" },
    templateCard: { borderRadius: 14, padding: 14, borderWidth: 1 },
    templateTitle: { fontSize: 14, fontWeight: "700" },
    templateBody: { fontSize: 13, lineHeight: 19 },
    useBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  });
