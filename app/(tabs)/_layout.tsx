import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform, AppState } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { useEffect, useState, useMemo } from "react";
import * as Notifications from "expo-notifications";
import { useStore } from "@/lib/store";
import { useBusinessUnreadCount } from "@/hooks/use-business-unread-count";

/** Returns true when the OS push-notification permission has been denied. */
function usePushPermissionDenied(): boolean {
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const check = async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        setDenied(status === "denied");
      } catch {
        // ignore — non-blocking
      }
    };

    check();

    // Re-check whenever the user returns from device Settings
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") check();
    });
    return () => sub.remove();
  }, []);

  return denied;
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isTablet, isLargeTablet, iconSize, tabBarBaseHeight } = useResponsive();
  const pushDenied = usePushPermissionDenied();
  const { state } = useStore();
  const unreadMessageCount = useBusinessUnreadCount();

  const pendingCount = useMemo(
    () => state.appointments.filter((a) => a.status === "pending").length,
    [state.appointments]
  );

  const bottomPadding = Platform.OS === "web"
    ? (isTablet ? 16 : 12)
    : Math.max(insets.bottom, 8);

  const tabBarHeight = tabBarBaseHeight + bottomPadding;
  const labelSize = isLargeTablet ? 13 : isTablet ? 12 : 11;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: isTablet ? 10 : 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: labelSize,
          fontWeight: "600",
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginBottom: 2,
        },
        tabBarItemStyle: {
          paddingVertical: isTablet ? 6 : 4,
          gap: 3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="house.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="calendar" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="calendar.badge.clock" color={color} />
          ),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: "700" as const,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
          },
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: "Clients",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="person.2.fill" color={color} />
          ),
          // Show unread message count badge — clears when owner opens the Messages tab inside Clients
          tabBarBadge: unreadMessageCount > 0
            ? (unreadMessageCount > 99 ? "99+" : unreadMessageCount)
            : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: "700" as const,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
          },
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          title: "Services",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="list.bullet" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="gifts"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="gearshape.fill" color={color} />
          ),
          // Show a red dot badge when push notification permission is denied
          // so the owner knows to enable it in device Settings for reminders.
          tabBarBadge: pushDenied ? "" : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            minWidth: 10,
            height: 10,
            borderRadius: 5,
            fontSize: 0,
          },
        }}
      />
    </Tabs>
  );
}
