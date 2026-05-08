/**
 * AnimatedSplash — minimal green loading screen.
 * Shows a solid dark-green background with a small spinner,
 * then fades out after 1.2 s and calls onFinish.
 */

import { useEffect, useRef } from "react";
import { Animated, StyleSheet, ActivityIndicator } from "react-native";

interface AnimatedSplashProps {
  onFinish: () => void;
}

export function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        onFinish();
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [opacity, onFinish]);

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="none">
      <ActivityIndicator size="small" color="rgba(143,191,106,0.85)" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0D2318",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
});
