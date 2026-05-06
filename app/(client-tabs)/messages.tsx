/**
 * Client Portal — Messages Tab
 *
 * Lists all message threads (one per appointment) with unread count badges.
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
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/use-colors";
import { useClientStore } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";

const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";

interface MessageThread {
  businessOwnerId: number;
  businessName: string;
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

export default function MessagesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, apiCall } = useClientStore();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadThreads = useCallback(async (silent = false) => {
    if (!state.account) return;
    if (!silent) setLoading(true);
    try {
      const data = await apiCall<MessageThread[]>("/api/client/messages/threads");
      setThreads(data);
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
        <Text style={styles.title}>Messages</Text>
      </Animated.View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={GREEN_ACCENT} />
        </View>
      ) : (
        <FlatList
          data={threads}
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
            <ThreadRow item={item} index={index} router={router} />
          )}
        />
      )}
    </View>
  );
}

function ThreadRow({ item, index, router }: { item: MessageThread; index: number; router: ReturnType<typeof useRouter> }) {
  const scale = useSharedValue(1);

  // Stable wrapper needed so runOnJS preserves the correct `this` context on iOS native
  const navigateToThread = useCallback(() => {
    router.push({
      pathname: "/client-message-thread",
      params: {
        businessOwnerId: String(item.businessOwnerId),
        businessName: item.businessName,
        serviceName: item.serviceName,
        appointmentDate: item.appointmentDate,
      },
    } as any);
  }, [router, item.businessOwnerId, item.businessName, item.serviceName, item.appointmentDate]);

  const tap = Gesture.Tap()
    .onBegin(() => { scale.value = withSpring(0.98, { damping: 20, stiffness: 300 }); })
    .onFinalize((_, success) => {
      scale.value = withSpring(1, { damping: 18, stiffness: 200 });
      if (success) {
        if (Platform.OS !== "web") runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(navigateToThread)();
      }
    });

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
    <GestureDetector gesture={tap}>
      <Animated.View style={[animStyle, styles.threadCard]}>
        {/* Avatar */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
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
      </Animated.View>
    </GestureDetector>
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
