/**
 * SwipeableClientRow
 *
 * Wraps a client list row with a swipe-left gesture that reveals a red
 * Delete action panel. Uses react-native-gesture-handler's Swipeable
 * component — the same library used by SwipeableRequestCard.
 *
 * Usage:
 *   <SwipeableClientRow onDelete={() => handleDelete(client)}>
 *     {row content}
 *   </SwipeableClientRow>
 */
import { useRef } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
  /** Set to false to disable swipe (e.g., web platform) */
  enabled?: boolean;
}

export function SwipeableClientRow({ children, onDelete, enabled = true }: Props) {
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <View style={styles.rightAction}>
      <IconSymbol name="trash" size={20} color="#FFFFFF" />
      <Text style={styles.actionLabel}>Delete</Text>
    </View>
  );

  if (!enabled || Platform.OS === "web") {
    return <>{children}</>;
  }

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={(direction) => {
        if (direction === "right") {
          // Snap back before calling onDelete so the row doesn't stay open
          swipeRef.current?.close();
          onDelete();
        }
      }}
      rightThreshold={80}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  rightAction: {
    backgroundColor: "#EF4444",
    justifyContent: "center",
    alignItems: "center",
    width: 80,
    flexDirection: "column",
    gap: 4,
    borderRadius: 12,
    marginVertical: 4,
    marginRight: 4,
  },
  actionLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
});
