/**
 * Client Portal — Saved Businesses Screen
 *
 * Lists all businesses the client has bookmarked.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useClientStore, SavedBusiness } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export default function ClientSavedBusinessesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { state, apiCall, dispatch } = useClientStore();
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          const data = await apiCall<SavedBusiness[]>("/api/client/saved-businesses");
          dispatch({ type: "SET_SAVED_BUSINESSES", payload: data });
        } catch (err) {
          console.warn("[SavedBiz] load error:", err);
        } finally {
          setLoading(false);
        }
      })();
    }, [apiCall, dispatch])
  );

  const handleUnsave = async (slug: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await apiCall(`/api/client/saved-businesses/${slug}`, { method: "DELETE" });
      dispatch({ type: "REMOVE_SAVED_BUSINESS", payload: String(slug) });
    } catch (err) {
      console.warn("[SavedBiz] unsave error:", err);
    }
  };

  const s = styles(colors);

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Saved Businesses</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color="#8B5CF6" />
        </View>
      ) : (
        <FlatList
          data={state.savedBusinesses}
          keyExtractor={(item) => item.businessSlug}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <IconSymbol name="bookmark" size={40} color={colors.muted} />
              <Text style={[s.emptyTitle, { color: colors.foreground }]}>No saved businesses</Text>
              <Text style={[s.emptySubtitle, { color: colors.muted }]}>
                Bookmark businesses from the Discover tab to find them quickly.
              </Text>
              <Pressable
                style={({ pressed }) => [s.discoverBtn, pressed && { opacity: 0.85 }]}
                onPress={() => router.back()}
              >
                <Text style={s.discoverBtnText}>Explore Businesses</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.bizCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({ pathname: "/client-business-detail", params: { slug: item.businessSlug } } as any)}
            >
              <View style={[s.bizLogo, { backgroundColor: "#8B5CF620" }]}>
                <IconSymbol name="scissors" size={22} color="#8B5CF6" />
              </View>
              <View style={s.bizInfo}>
                <Text style={[s.bizName, { color: colors.foreground }]}>{item.businessName}</Text>
                {item.businessCategory && (
                  <Text style={[s.bizCategory, { color: "#8B5CF6" }]}>{item.businessCategory}</Text>
                )}
                {item.businessAddress && (
                  <Text style={[s.bizAddress, { color: colors.muted }]} numberOfLines={1}>{item.businessAddress}</Text>
                )}
              </View>
              <Pressable
                style={({ pressed }) => [s.unsaveBtn, pressed && { opacity: 0.7 }]}
                onPress={() => handleUnsave(item.businessSlug)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <IconSymbol name="bookmark.fill" size={18} color="#8B5CF6" />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 17, fontWeight: "600" },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyContainer: { alignItems: "center", paddingTop: 60, gap: 12, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 18, fontWeight: "700" },
    emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
    discoverBtn: { backgroundColor: "#8B5CF6", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, marginTop: 8 },
    discoverBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
    bizCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
    bizLogo: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
    bizInfo: { flex: 1, gap: 3 },
    bizName: { fontSize: 15, fontWeight: "700" },
    bizCategory: { fontSize: 12, fontWeight: "600" },
    bizAddress: { fontSize: 12 },
    unsaveBtn: { padding: 4 },
  });
