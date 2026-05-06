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
import { useClientStore, SavedBusiness } from "@/lib/client-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ClientPortalBackground } from "@/components/client-portal-background";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const ACCENT       = "#8FBF6A";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED   = "rgba(255,255,255,0.65)";
const CARD_BG      = "rgba(255,255,255,0.07)";
const CARD_BORDER  = "rgba(255,255,255,0.12)";

export default function ClientSavedBusinessesScreen() {
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

  return (
    <ScreenContainer>
      <ClientPortalBackground />
      {/* Header */}
      <View style={s.header}>
        <Pressable style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={20} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={s.headerTitle}>Saved Businesses</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : (
        <FlatList
          data={state.savedBusinesses}
          keyExtractor={(item) => item.businessSlug}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <IconSymbol name="bookmark" size={40} color={TEXT_MUTED} />
              <Text style={s.emptyTitle}>No saved businesses</Text>
              <Text style={s.emptySubtitle}>
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
              style={({ pressed }) => [s.bizCard, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({ pathname: "/client-business-detail", params: { slug: item.businessSlug } } as any)}
            >
              <View style={s.bizLogo}>
                <IconSymbol name="scissors" size={22} color={ACCENT} />
              </View>
              <View style={s.bizInfo}>
                <Text style={s.bizName}>{item.businessName}</Text>
                {item.businessCategory && (
                  <Text style={s.bizCategory}>{item.businessCategory}</Text>
                )}
                {item.businessAddress && (
                  <Text style={s.bizAddress} numberOfLines={1}>{item.businessAddress}</Text>
                )}
              </View>
              <Pressable
                style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.7 }]}
                onPress={() => handleUnsave(item.businessSlug)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <IconSymbol name="bookmark.fill" size={18} color={ACCENT} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600", color: TEXT_PRIMARY },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyContainer: { alignItems: "center", paddingTop: 60, gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: TEXT_PRIMARY },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, color: TEXT_MUTED },
  discoverBtn: { backgroundColor: ACCENT, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, marginTop: 8 },
  discoverBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  bizCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG, padding: 14, marginBottom: 10, gap: 12 },
  bizLogo: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(143,191,106,0.15)" },
  bizInfo: { flex: 1, gap: 3 },
  bizName: { fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY },
  bizCategory: { fontSize: 12, fontWeight: "600", color: ACCENT },
  bizAddress: { fontSize: 12, color: TEXT_MUTED },
});
