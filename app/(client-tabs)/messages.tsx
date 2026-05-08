/**
 * Client Portal — Messages Tab
 *
 * Lists all message threads (one per appointment) with unread count badges.
 * Threads are sorted newest-first. Long-press a thread to delete (local hide).
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Image,
  Alert,
  Modal,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/use-colors";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

const HIDDEN_THREADS_KEY = "client_hidden_threads";

interface MessageThread {
  businessOwnerId: number;
  businessName: string;
  businessLogoUri: string | null;
  businessSlug: string;
  serviceName: string;
  appointmentDate: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

async function loadHiddenThreadIds(): Promise<Set<number>> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_THREADS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

async function saveHiddenThreadIds(ids: Set<number>): Promise<void> {
  try {
    await AsyncStorage.setItem(HIDDEN_THREADS_KEY, JSON.stringify([...ids]));
  } catch {}
}

export default function MessagesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, apiCall } = useClientStore();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadThreads = useCallback(async (silent = false) => {
    if (!state.account) return;
    if (!silent) setLoading(true);
    try {
      const [data, hidden] = await Promise.all([
        apiCall<MessageThread[]>("/api/client/messages/threads"),
        loadHiddenThreadIds(),
      ]);
      // Sort newest-first by lastMessageAt
      const sorted = [...data].sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return tb - ta;
      });
      setThreads(sorted);
      setHiddenIds(hidden);
      const total = data.reduce((sum, t) => sum + t.unreadCount, 0);
      dispatch({ type: "SET_UNREAD_COUNT", payload: total });
    } catch (err) {
      console.warn("[Messages] load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [state.account, apiCall, dispatch]);

  useFocusEffect(useCallback(() => { loadThreads(true); }, [loadThreads]));

  const onRefresh = () => { setRefreshing(true); loadThreads(); };

  const handleDeleteThread = useCallback((item: MessageThread) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Delete Conversation",
      `Remove your conversation with ${item.businessName}? This only hides it on your device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const next = new Set(hiddenIds);
            next.add(item.businessOwnerId);
            setHiddenIds(next);
            await saveHiddenThreadIds(next);
            // Update unread count
            const remaining = threads.filter(
              (t) => !next.has(t.businessOwnerId)
            );
            const total = remaining.reduce((sum, t) => sum + t.unreadCount, 0);
            dispatch({ type: "SET_UNREAD_COUNT", payload: total });
          },
        },
      ]
    );
  }, [hiddenIds, threads, dispatch]);

  // Entrance animation
  const headerOpacity = useSharedValue(0);
  const headerY = useSharedValue(-16);
  React.useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    headerY.value = withSpring(0, { damping: 18, stiffness: 120 });
  }, []);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));

  const visibleThreads = threads.filter((t) => !hiddenIds.has(t.businessOwnerId));
  const hiddenThreads = threads.filter((t) => hiddenIds.has(t.businessOwnerId));

  const handleRestoreThread = useCallback(async (item: MessageThread) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = new Set(hiddenIds);
    next.delete(item.businessOwnerId);
    setHiddenIds(next);
    await saveHiddenThreadIds(next);
    const visible = threads.filter((t) => !next.has(t.businessOwnerId));
    const total = visible.reduce((sum, t) => sum + t.unreadCount, 0);
    dispatch({ type: "SET_UNREAD_COUNT", payload: total });
  }, [hiddenIds, threads, dispatch]);

  if (!state.account) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <View style={[styles.guestContainer, { paddingTop: insets.top }]}>
          <View style={styles.guestIconWrap}>
            <IconSymbol name="text.bubble.fill" size={36} color={GREEN_ACCENT} />
          </View>
          <Text style={styles.guestTitle}>Sign in to view messages</Text>
          <Text style={styles.guestSub}>Chat with businesses about your appointments.</Text>
          <Pressable
            style={({ pressed }) => [styles.signInBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/client-signin" as any)}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />
      <Animated.View style={[styles.header, headerStyle, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Messages</Text>
          <Text style={styles.subtitle}>Hold a conversation to delete it</Text>
        </View>
        {hiddenThreads.length > 0 && (
          <TouchableOpacity
            style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 }}
            onPress={() => setShowRestoreModal(true)}
          >
            <IconSymbol name="arrow.counterclockwise" size={14} color={GREEN_ACCENT} />
            <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "600" }}>Deleted ({hiddenThreads.length})</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
      {/* Restore Deleted Threads Modal */}
      <Modal visible={showRestoreModal} transparent animationType="slide" onRequestClose={() => setShowRestoreModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#1A3A28", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 18, fontWeight: "700" }}>Deleted Conversations</Text>
              <TouchableOpacity onPress={() => setShowRestoreModal(false)}>
                <IconSymbol name="xmark.circle.fill" size={24} color={TEXT_MUTED} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
              {hiddenThreads.map((item) => {
                const initials = item.businessName.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
                return (
                  <View key={item.businessOwnerId} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, padding: 12, gap: 12, marginBottom: 8 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(143,191,106,0.2)", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {item.businessLogoUri ? (
                        <Image source={{ uri: item.businessLogoUri }} style={{ width: 44, height: 44, borderRadius: 22 }} resizeMode="cover" />
                      ) : (
                        <Text style={{ color: GREEN_ACCENT, fontWeight: "700", fontSize: 16 }}>{initials}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: TEXT_PRIMARY, fontWeight: "600", fontSize: 14 }}>{item.businessName}</Text>
                      {item.lastMessage ? <Text style={{ color: TEXT_MUTED, fontSize: 12 }} numberOfLines={1}>{item.lastMessage}</Text> : null}
                    </View>
                    <TouchableOpacity
                      style={{ backgroundColor: GREEN_ACCENT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}
                      onPress={() => handleRestoreThread(item)}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "700" }}>Restore</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={GREEN_ACCENT} />
        </View>
      ) : (
        <FlatList
          data={visibleThreads}
          keyExtractor={(item) => String(item.businessOwnerId)}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_ACCENT} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <IconSymbol name="text.bubble.fill" size={32} color={GREEN_ACCENT} />
              </View>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySubtitle}>
                Messages with businesses will appear here after you book an appointment.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <ThreadRow
              item={item}
              index={index}
              router={router}
              onLongPress={() => handleDeleteThread(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function ThreadRow({
  item,
  index,
  router,
  onLongPress,
}: {
  item: MessageThread;
  index: number;
  router: ReturnType<typeof useRouter>;
  onLongPress: () => void;
}) {
  const scale = useSharedValue(1);

  const navigateToThread = useCallback(() => {
    router.push({
      pathname: "/client-message-thread",
      params: {
        businessOwnerId: String(item.businessOwnerId),
        businessName: item.businessName,
        businessLogoUri: item.businessLogoUri ?? "",
        serviceName: item.serviceName,
        appointmentDate: item.appointmentDate,
      },
    } as any);
  }, [router, item]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Get initials from business name
  const initials = item.businessName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={({ pressed }) => [
          styles.threadCard,
          pressed && { backgroundColor: "rgba(255,255,255,0.05)" },
        ]}
        onPress={() => {
          scale.value = withSpring(0.98, { damping: 20, stiffness: 300 });
          setTimeout(() => {
            scale.value = withSpring(1, { damping: 18, stiffness: 200 });
          }, 100);
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigateToThread();
        }}
        onLongPress={onLongPress}
        delayLongPress={500}
      >
        {/* Avatar — show business logo if available, else initials */}
        <View style={styles.avatar}>
          {item.businessLogoUri ? (
            <Image
              source={{ uri: item.businessLogoUri }}
              style={{ width: 48, height: 48, borderRadius: 24 }}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        {/* Thread info */}
        <View style={styles.threadInfo}>
          <View style={styles.threadTop}>
            <Text style={styles.businessName} numberOfLines={1}>{item.businessName}</Text>
            {item.lastMessageAt && (
              <Text style={styles.timeAgo}>{timeAgo(item.lastMessageAt)}</Text>
            )}
          </View>
          <Text style={styles.serviceName} numberOfLines={1}>{item.serviceName}</Text>
          {item.lastMessage ? (
            <Text
              style={[styles.lastMessage, item.unreadCount > 0 && { fontWeight: "600", color: TEXT_PRIMARY }]}
              numberOfLines={1}
            >
              {item.lastMessage}
            </Text>
          ) : (
            <Text style={[styles.lastMessage, { fontStyle: "italic" }]}>No messages yet — tap to send one</Text>
          )}
        </View>

        {/* Unread badge */}
        {item.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unreadCount}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  subtitle: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    color: TEXT_MUTED,
  },
  threadCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(143,191,106,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(143,191,106,0.3)",
    overflow: "hidden",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: GREEN_ACCENT,
  },
  threadInfo: {
    flex: 1,
    gap: 3,
  },
  threadTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  businessName: {
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
    color: TEXT_PRIMARY,
  },
  timeAgo: {
    fontSize: 11,
    marginLeft: 8,
    color: TEXT_MUTED,
  },
  serviceName: {
    fontSize: 12,
    fontWeight: "600",
    color: GREEN_ACCENT,
  },
  lastMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: TEXT_MUTED,
  },
  unreadBadge: {
    backgroundColor: GREEN_ACCENT,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  unreadText: {
    color: GREEN_DARK,
    fontSize: 11,
    fontWeight: "700",
  },
  guestContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  guestIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: "rgba(143,191,106,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  guestTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    textAlign: "center",
  },
  guestSub: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: "center",
    lineHeight: 20,
  },
  signInBtn: {
    backgroundColor: GREEN_ACCENT,
    paddingHorizontal: 36,
    paddingVertical: 13,
    borderRadius: 24,
    marginTop: 4,
  },
  signInBtnText: {
    color: GREEN_DARK,
    fontSize: 15,
    fontWeight: "700",
  },
});
