import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { InboxNotification } from "@/lib/types";

const ICON_MAP: Record<InboxNotification["type"], { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  new_booking: { name: "calendar-outline", color: "#4ade80" },
  cancelled_by_client: { name: "close-circle-outline", color: "#f87171" },
  rescheduled_by_client: { name: "refresh-circle-outline", color: "#60a5fa" },
};

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function NotificationInboxScreen() {
  const router = useRouter();
  const colors = useColors();
  const { state, dispatch } = useStore();

  const notifications = state.inboxNotifications ?? [];
  const unread = notifications.filter((n) => !n.read);
  const recent = notifications.filter((n) => n.read);

  // Auto-mark all unread as read when the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (unread.length > 0) {
        dispatch({ type: "MARK_INBOX_READ" });
      }
    }, [unread.length, dispatch])
  );

  const handleDismiss = useCallback(
    (id: string) => {
      // Mark as read (moves to Recent section) rather than deleting
      dispatch({ type: "DISMISS_INBOX_NOTIFICATION", payload: id });
    },
    [dispatch]
  );

  const handleTap = useCallback(
    (item: InboxNotification) => {
      // Item is already marked read by useFocusEffect, just navigate
      if (item.appointmentId) {
        router.push({
          pathname: "/appointment-detail",
          params: { id: item.appointmentId, from: "notification" },
        });
      } else {
        router.push({ pathname: "/(tabs)/bookings", params: { filter: "requests" } });
      }
    },
    [dispatch, router]
  );

  const renderItem = useCallback(
    ({ item, isUnread }: { item: InboxNotification; isUnread: boolean }) => {
      const icon = ICON_MAP[item.type] ?? { name: "notifications-outline" as keyof typeof Ionicons.glyphMap, color: colors.primary };
      return (
        <Pressable
          onPress={() => handleTap(item)}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: isUnread
                ? colors.surface + "ee"
                : colors.surface + "88",
              borderLeftColor: icon.color,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <View style={styles.iconWrap}>
            <Ionicons name={icon.name} size={22} color={icon.color} />
          </View>
          <View style={styles.textWrap}>
            <Text
              style={[
                styles.title,
                { color: colors.foreground, fontWeight: isUnread ? "700" : "500" },
              ]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Text
              style={[styles.body, { color: colors.muted }]}
              numberOfLines={2}
            >
              {item.body}
            </Text>
            <Text style={[styles.time, { color: colors.muted }]}>
              {timeAgo(item.timestamp)}
            </Text>
          </View>
          {isUnread && (
            <Pressable
              onPress={() => handleDismiss(item.id)}
              hitSlop={12}
              style={styles.dismissBtn}
            >
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          )}
        </Pressable>
      );
    },
    [colors, handleTap, handleDismiss]
  );

  const sections: Array<{ key: string; title?: string; data: InboxNotification[]; isUnread: boolean }> = [];
  if (unread.length > 0) {
    sections.push({ key: "unread", title: "Unread", data: unread, isUnread: true });
  }
  if (recent.length > 0) {
    // Group by date
    const grouped: Record<string, InboxNotification[]> = {};
    for (const n of recent) {
      const dateKey = n.timestamp.slice(0, 10);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(n);
    }
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    for (const dateKey of sortedDates) {
      sections.push({
        key: `recent-${dateKey}`,
        title: formatDate(dateKey + "T12:00:00"),
        data: grouped[dateKey],
        isUnread: false,
      });
    }
  }

  const flatData: Array<
    | { kind: "header"; title: string; sectionKey: string }
    | { kind: "item"; item: InboxNotification; isUnread: boolean }
    | { kind: "empty" }
  > = [];

  if (sections.length === 0) {
    flatData.push({ kind: "empty" });
  } else {
    for (const section of sections) {
      if (section.title) {
        flatData.push({ kind: "header", title: section.title, sectionKey: section.key });
      }
      for (const item of section.data) {
        flatData.push({ kind: "item", item, isUnread: section.isUnread });
      }
    }
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Alerts</Text>
        <View style={{ width: 80, alignItems: 'flex-end', gap: 2 }}>
          {unread.length > 0 && (
            <Pressable
              onPress={() => dispatch({ type: "MARK_INBOX_READ" })}
              hitSlop={8}
            >
              <Text style={[styles.markAll, { color: colors.primary }]}>Mark all read</Text>
            </Pressable>
          )}
          {notifications.length > 0 && (
            <Pressable
              onPress={() => {
                Alert.alert(
                  "Clear All Notifications",
                  "Remove all notifications from your inbox?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Clear All",
                      style: "destructive",
                      onPress: () => dispatch({ type: "CLEAR_INBOX" }),
                    },
                  ]
                );
              }}
              hitSlop={8}
            >
              <Text style={[styles.markAll, { color: colors.error }]}>Clear all</Text>
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={flatData}
        keyExtractor={(item, index) => {
          if (item.kind === "header") return `header-${item.sectionKey}`;
          if (item.kind === "item") return `item-${item.item.id}`;
          return `empty-${index}`;
        }}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return (
              <Text style={[styles.sectionHeader, { color: colors.muted }]}>
                {item.title}
              </Text>
            );
          }
          if (item.kind === "empty") {
            return (
              <View style={styles.emptyWrap}>
                <Ionicons name="notifications-off-outline" size={48} color={colors.muted} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No notifications
                </Text>
                <Text style={[styles.emptyBody, { color: colors.muted }]}>
                  New booking requests and client updates will appear here.
                </Text>
              </View>
            );
          }
          return renderItem({ item: item.item, isUnread: item.isUnread });
        }}
      />
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
    width: 80,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    flex: 1,
  },
  markAll: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "right",
    width: 80,
  },
  list: {
    padding: 16,
    gap: 8,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    gap: 10,
    marginBottom: 6,
  },
  iconWrap: {
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 14,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    marginTop: 2,
  },
  dismissBtn: {
    padding: 4,
    marginTop: 2,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  emptyBody: {
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});
