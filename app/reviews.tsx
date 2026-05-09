import { useState, useMemo } from "react";
import { Text, View, Pressable, StyleSheet, FlatList } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter } from "expo-router";
import { FuturisticBackground } from "@/components/futuristic-background";


type SortMode = "newest" | "oldest" | "highest" | "lowest";

export default function ReviewsScreen() {
  const { state } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth } = useResponsive();
  const [sort, setSort] = useState<SortMode>("newest");

  const avgRating = useMemo(() => {
    if (state.reviews.length === 0) return 0;
    return state.reviews.reduce((s, r) => s + r.rating, 0) / state.reviews.length;
  }, [state.reviews]);

  const ratingDist = useMemo(() => {
    const dist = [0, 0, 0, 0, 0]; // 1-5
    state.reviews.forEach((r) => { if (r.rating >= 1 && r.rating <= 5) dist[r.rating - 1]++; });
    return dist;
  }, [state.reviews]);

  const sorted = useMemo(() => {
    const arr = [...state.reviews];
    switch (sort) {
      case "newest": return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      case "oldest": return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      case "highest": return arr.sort((a, b) => b.rating - a.rating);
      case "lowest": return arr.sort((a, b) => a.rating - b.rating);
    }
  }, [state.reviews, sort]);

  return (
    <ScreenContainer tabletMaxWidth={900} edges={["top", "left", "right"]}>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: hp }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Client Reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Summary Card */}
      <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: hp }]}>
        <View style={styles.summaryLeft}>
          <Text style={[styles.bigRating, { color: colors.foreground }]}>{avgRating.toFixed(1)}</Text>
          <Text style={{ fontSize: 22, color: "#f59e0b", marginTop: 2 }}>
            {Array.from({ length: 5 }, (_, i) => i < Math.round(avgRating) ? "★" : "☆").join("")}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{state.reviews.length} review{state.reviews.length !== 1 ? "s" : ""}</Text>
        </View>
        <View style={styles.summaryRight}>
          {[5, 4, 3, 2, 1].map((star) => {
            const count = ratingDist[star - 1];
            const pct = state.reviews.length > 0 ? (count / state.reviews.length) * 100 : 0;
            return (
              <View key={star} style={styles.distRow}>
                <Text style={{ fontSize: 11, color: colors.muted, width: 14 }}>{star}</Text>
                <View style={[styles.distBar, { backgroundColor: colors.border }]}>
                  <View style={[styles.distFill, { width: `${pct}%`, backgroundColor: "#f59e0b" }]} />
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, width: 24, textAlign: "right" }}>{count}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Sort Chips */}
      <View style={[styles.sortRow, { paddingHorizontal: hp }]}>
        {(["newest", "oldest", "highest", "lowest"] as SortMode[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => setSort(s)}
            style={({ pressed }) => [
              styles.sortChip,
              {
                backgroundColor: sort === s ? colors.primary : colors.surface,
                borderColor: sort === s ? colors.primary : colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: sort === s ? "#fff" : colors.foreground, textTransform: "capitalize" }}>
              {s}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Reviews List */}
      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <IconSymbol name="star.fill" size={40} color={colors.muted + "40"} />
          <Text style={{ fontSize: 15, fontWeight: "500", color: colors.muted, marginTop: 12 }}>No reviews yet</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4, textAlign: "center" }}>
            Reviews will appear here after clients leave feedback
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
          renderItem={({ item: review }) => {
            const client = state.clients.find((c) => c.id === review.clientId);
            const stars = Array.from({ length: 5 }, (_, i) => i < review.rating ? "★" : "☆").join("");
            return (
              <View style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewUser}>
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>
                        {(client?.name || "?")[0].toUpperCase()}
                      </Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{client?.name || "Anonymous"}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{new Date(review.createdAt).toLocaleDateString()}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 15, color: "#f59e0b" }}>{stars}</Text>
                </View>
                {review.comment ? (
                  <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20, marginTop: 8 }}>{review.comment}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  summaryCard: { marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 16, borderWidth: 1, flexDirection: "row" },
  summaryLeft: { alignItems: "center", justifyContent: "center", paddingRight: 20, borderRightWidth: 0.5, borderRightColor: "#e5e7eb" },
  summaryRight: { flex: 1, paddingLeft: 16, justifyContent: "center", gap: 4 },
  bigRating: { fontSize: 40, fontWeight: "800", lineHeight: 44 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  distBar: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  distFill: { height: 6, borderRadius: 3 },
  sortRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 16, marginBottom: 12 },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  reviewCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 10 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewUser: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
