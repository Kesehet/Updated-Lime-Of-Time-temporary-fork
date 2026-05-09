import { useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { formatPhoneNumber, stripPhoneFormat } from "@/lib/types";
import { useResponsive } from "@/hooks/use-responsive";

/**
 * Public route: /review/[slug]
 * 
 * This route handles the public review URL format:
 *   https://lime-of-time.com/review/business-name
 * 
 * Clients can leave a review for the business.
 */
export default function ReviewSlugScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();

  const [clientName, setClientName] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const businessName = state.settings.businessName || slug?.replace(/-/g, " ") || "Business";
  const profile = state.settings.profile;

  const handleSubmit = useCallback(() => {
    if (!clientName.trim()) {
      if (Platform.OS === "web") {
        window.alert("Please enter your name");
      } else {
        Alert.alert("Missing Info", "Please enter your name");
      }
      return;
    }

    const review = {
      id: generateId(),
      clientId: "",
      clientName: clientName.trim(),
      rating,
      comment: comment.trim(),
      date: new Date().toISOString().split("T")[0],
      createdAt: new Date().toISOString(),
    };

    dispatch({ type: "ADD_REVIEW", payload: review });
    syncToDb({ type: "ADD_REVIEW", payload: review });
    setSubmitted(true);
  }, [clientName, rating, comment, dispatch, syncToDb]);

  if (submitted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={640}>
        <View style={[styles.centered, { backgroundColor: colors.background, paddingHorizontal: hp }]}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>✓</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Thank You!</Text>
          <Text style={[styles.subtitle, { color: colors.muted, marginTop: 8 }]}>
            Your review has been submitted. We appreciate your feedback!
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingHorizontal: hp, paddingVertical: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{businessName}</Text>
          {profile.address ? (
            <Text style={[styles.subtitle, { color: colors.muted, marginTop: 4 }]}>{profile.address}</Text>
          ) : null}
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
            Leave a Review
          </Text>
        </View>

        {/* Name */}
        <Text style={[styles.label, { color: colors.foreground }]}>Your Name</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Enter your name"
          placeholderTextColor={colors.muted}
          value={clientName}
          onChangeText={setClientName}
        />

        {/* Rating */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Rating</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable
              key={star}
              onPress={() => setRating(star)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ fontSize: 36, color: star <= rating ? "#F59E0B" : colors.border }}>
                ★
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Comment */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Comment (optional)</Text>
        <TextInput
          style={[
            styles.input,
            styles.textArea,
            { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border },
          ]}
          placeholder="Tell us about your experience..."
          placeholderTextColor={colors.muted}
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Submit */}
        <Pressable
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.submitBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={[styles.submitText, { color: "#fff" }]}>Submit Review</Text>
        </Pressable>

        <Text style={{ textAlign: "center", color: colors.muted, fontSize: fs.xs, marginTop: 24 }}>
          Powered by Lime Of Time
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: fs.xl, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: fs.sm, textAlign: "center" },
  sectionTitle: { fontSize: fs.md, fontWeight: "600" },
  label: { fontSize: fs.sm, fontWeight: "600", marginBottom: 6 },
  input: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fs.md,
    lineHeight: 22,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  ratingRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 8,
  },
  submitBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    minHeight: 52,
  },
  submitText: {
    fontSize: fs.md,
    fontWeight: "700",
  },
});
