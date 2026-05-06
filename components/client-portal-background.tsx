/**
 * ClientPortalBackground
 *
 * Full-screen dark forest-green gradient background used across all Client Portal screens.
 * Matches the onboarding screen aesthetic: #1A3A28 → #2D5A3D → #4A7C59.
 * Always dark regardless of device light/dark mode setting.
 * Pointer-events: none so it never blocks touches.
 */
import { useEffect, useRef } from "react";
import { StyleSheet, View, Dimensions, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const { width: W, height: H } = Dimensions.get("window");

// Subtle floating orbs for depth
const ORBS = [
  { x: W * 0.75, y: H * 0.12, size: W * 0.55, color: "rgba(74,124,89,0.18)", dur: 9000, rangeX: W * 0.08, rangeY: H * 0.06 },
  { x: W * 0.05, y: H * 0.55, size: W * 0.45, color: "rgba(45,90,61,0.22)", dur: 12000, rangeX: W * 0.06, rangeY: H * 0.08 },
  { x: W * 0.4,  y: H * 0.78, size: W * 0.35, color: "rgba(26,58,40,0.28)", dur: 10000, rangeX: W * 0.05, rangeY: H * 0.05 },
];

export function ClientPortalBackground() {
  const orbAnims = useRef(ORBS.map(() => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
  }))).current;

  useEffect(() => {
    const anims = orbAnims.map((anim, i) => {
      const orb = ORBS[i];
      const drift = (val: Animated.Value, range: number, dur: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(val, { toValue: range, duration: dur, useNativeDriver: true }),
            Animated.timing(val, { toValue: -range, duration: dur * 1.1, useNativeDriver: true }),
          ])
        );
      return Animated.parallel([
        drift(anim.x, orb.rangeX, orb.dur),
        drift(anim.y, orb.rangeY, orb.dur * 1.2),
      ]);
    });
    const all = Animated.parallel(anims);
    all.start();
    return () => all.stop();
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Base gradient */}
      <LinearGradient
        colors={["#1A3A28", "#2D5A3D", "#1A3A28"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Floating orbs */}
      {ORBS.map((orb, i) => (
        <Animated.View
          key={i}
          style={[
            styles.orb,
            {
              left: orb.x - orb.size / 2,
              top: orb.y - orb.size / 2,
              width: orb.size,
              height: orb.size,
              backgroundColor: orb.color,
              transform: [
                { translateX: orbAnims[i].x },
                { translateY: orbAnims[i].y },
              ],
            },
          ]}
        />
      ))}
      {/* Subtle top shimmer */}
      <LinearGradient
        colors={["rgba(143,191,106,0.08)", "transparent"]}
        style={[StyleSheet.absoluteFillObject, { height: H * 0.35 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    position: "absolute",
    borderRadius: 9999,
  },
});
