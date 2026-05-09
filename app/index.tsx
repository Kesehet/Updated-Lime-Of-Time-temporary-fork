/**
 * App Entry Point
 *
 * This file exists solely to give Expo Router a concrete index route so it
 * does NOT fall back to the first alphabetical route in the app directory
 * (which would be "(client-tabs)" — causing the Client Portal to open on
 * cold launch instead of the Portal Selector).
 *
 * This screen renders a plain background. The AnimatedSplash overlay in
 * _layout.tsx (zIndex 9999, absoluteFill) covers it entirely during startup.
 * handleSplashFinish() navigates to /profile-select once the splash completes.
 */
import { View } from "react-native";

export default function Index() {
  // Blank screen — covered by AnimatedSplash overlay in _layout.tsx.
  // Navigation to /profile-select is handled by handleSplashFinish().
  return <View style={{ flex: 1, backgroundColor: "#0D2318" }} />;
}
