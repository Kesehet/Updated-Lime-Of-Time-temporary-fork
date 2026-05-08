/**
 * KeyboardAwareScroll
 *
 * A thin wrapper around ScrollView + KeyboardAvoidingView that ensures
 * focused TextInput fields are always visible above the software keyboard
 * on both iOS and Android.
 *
 * Usage:
 *   Replace a bare <ScrollView> with <KeyboardAwareScroll> — same props.
 *   The component automatically applies:
 *     - KeyboardAvoidingView with behavior="padding" (iOS) / "height" (Android)
 *     - keyboardShouldPersistTaps="handled" so tapping outside a TextInput
 *       dismisses the keyboard without swallowing the tap event
 *     - automaticallyAdjustKeyboardInsets (iOS 15+) for extra safety
 */
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native";

interface KeyboardAwareScrollProps extends ScrollViewProps {
  /** Extra offset from the top (e.g. header height). Defaults to 0. */
  keyboardVerticalOffset?: number;
  /** Pass children directly. */
  children?: React.ReactNode;
}

export function KeyboardAwareScroll({
  children,
  keyboardVerticalOffset = 0,
  contentContainerStyle,
  style,
  ...rest
}: KeyboardAwareScrollProps) {
  return (
    <KeyboardAvoidingView
      style={styles.kav}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        // automaticallyAdjustKeyboardInsets is iOS 15+ — provides additional
        // inset adjustment so the scroll view shrinks when the keyboard appears.
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        style={[styles.scroll, style]}
        showsVerticalScrollIndicator={false}
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
