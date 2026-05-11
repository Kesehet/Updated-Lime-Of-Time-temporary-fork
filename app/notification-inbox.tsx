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

export default function NotificationInboxScreen() {
  const router = useRouter();
  const colors = useColors();
  const { state, dispatch } = useStore();

  const notifications = state.inboxNotifications ?? [];

  // Tapping a notification navigates AND removes it from the list
  const handleTap = useCallback(
    (item: InboxNotification) => {
      // Remove immediately from the list
      dispatch({ type: "DISMISS_INBOX_NOTIFICATION", payload: item.id });
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

  // X button also removes
  const handleDismiss = useCallback(
    (id: string) => {
      dispatch({ type: "DISMISS_INBOX_NOTIFICATION", payload: id });
    },
    [dispatch]
  );

  const renderItem = useCallback(
    ({ item }: { item: InboxNotification }) => {
      const icon = ICON_MAP[item.type] ?? { name: "notifications-outline" as keyof typeof Ionicons.glyphMap, color: colors.primary };
      return (
        <Pressable
          onPress={() => handleTap(item)}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: colors.surface,
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
              style={[styles.title, { color: colors.foreground, fontWeight: "700" }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Text style={[styles.body, { color: colors.muted }]} numberOfLines={2}>
              {item.body}
            </Text>
            <Text style={[styles.time, { color: colors.muted }]}>
              {timeAgo(item.timestamp)}
            </Text>
          </View>
          <Pressable
            onPress={() => handleDismiss(item.id)}
            hitSlop={12}
            style={styles.dismissBtn}
          >
            <Ionicons name="close" size={16} color={colors.muted} />
          </Pressable>
        </Pressable>
      );
    },
    [colors, handleTap, handleDismiss]
  );

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Alerts</Text>
        <View style={{ width: 80, alignItems: "flex-end" }}>
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

      {notifications.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No notifications</Text>
          <Text style={[styles.emptyBody, { color: colors.muted }]}>
            New booking requests and client updates will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => renderItem({ item })}
        />
      )}
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
  },
  list: {
    padding: 16,
    gap: 8,
    paddingBottom: 40,
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
