/**
 * Client Portal Tab Layout
 *
 * Dark forest-green tab bar matching the onboarding screen aesthetic.
 * 5-tab navigation: Home, Discover, Bookings, Messages, Profile
 */

import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform } from "react-native";
import { useClientStore } from "@/lib/client-store";
import { useClientNotifications } from "@/hooks/use-client-notifications";

// Forest green palette (matches onboarding)
const TAB_BG = "#1A3A28";
const TAB_ACTIVE = "#8FBF6A";   // light green accent
const TAB_INACTIVE = "rgba(255,255,255,0.45)";
const TAB_BORDER = "rgba(255,255,255,0.08)";

export default function ClientTabLayout() {
  const insets = useSafeAreaInsets();
  const { state } = useClientStore();
  // Register push token and handle notification taps
  useClientNotifications();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: TAB_INACTIVE,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: TAB_BG,
          borderTopColor: TAB_BORDER,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="safari.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="text.bubble.fill" color={color} />,
          tabBarBadge: state.unreadMessageCount > 0 ? state.unreadMessageCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#EF4444",
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
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.crop.circle.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
