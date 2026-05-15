import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useStore } from "@/lib/store";
import { apiCall } from "@/lib/_core/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaitlistRow {
  id: number;
  clientName: string;
  clientPhone?: string | null;
  serviceLocalId?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  notes?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function WaitlistViewScreen() {
  const colors = useColors();
  const router = useRouter();
  const { state } = useStore();

  const [entries, setEntries] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive business slug (same logic as getBookingUrl helper in lib/types.ts)
  const slug = state.settings.customSlug || state.settings.businessName.replace(/\s+/g, "-").toLowerCase();

  const fetchWaitlist = useCallback(async () => {
    try {
      setError(null);
      const data = await apiCall<WaitlistRow[]>(`/api/public/business/${slug}/waitlist`);
      setEntries(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load waitlist");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchWaitlist();
  }, [fetchWaitlist]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchWaitlist();
  };

  // Look up service name from store
  const getServiceName = (serviceLocalId?: string | null) => {
    if (!serviceLocalId) return null;
    const svc = state.services.find((s) => s.id === serviceLocalId || (s as any).localId === serviceLocalId);
    return svc?.name ?? serviceLocalId;
  };

  // ── Render item ─────────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: WaitlistRow }) => {
    const serviceName = getServiceName(item.serviceLocalId);
    const statusColor = item.status === "notified" ? colors.success : colors.primary;
    const statusLabel = item.status === "notified" ? "Notified" : item.status === "booked" ? "Booked" : "Waiting";

    return (
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
          marginBottom: 10,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        {/* Avatar */}
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: "#14B8A620",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Text style={{ fontSize: 18, color: "#14B8A6", fontWeight: "700" }}>
            {(item.clientName ?? "?")[0].toUpperCase()}
          </Text>
        </View>

        {/* Info */}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
            {item.clientName}
          </Text>

          {item.clientPhone ? (
            <Text style={{ fontSize: 13, color: colors.muted }}>{item.clientPhone}</Text>
          ) : null}

          {serviceName ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
              <IconSymbol name="scissors" size={13} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.muted }}>{serviceName}</Text>
            </View>
          ) : null}

          {item.preferredDate ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <IconSymbol name="calendar" size={13} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.muted }}>
                {item.preferredDate}{item.preferredTime ? ` · ${item.preferredTime}` : ""}
              </Text>
            </View>
          ) : null}

          {item.notes ? (
            <Text style={{ fontSize: 12, color: colors.muted, fontStyle: "italic", marginTop: 2 }}>
              "{item.notes}"
            </Text>
          ) : null}

          {item.createdAt ? (
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
              Joined {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          ) : null}
        </View>

        {/* Status badge */}
        <View
          style={{
            backgroundColor: statusColor + "18",
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
            alignSelf: "flex-start",
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor }}>{statusLabel}</Text>
        </View>
      </View>
    );
  };

  // ── Header ──────────────────────────────────────────────────────────────────

  const ListHeader = () => (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>
        Clients below joined the waitlist because their preferred slot was fully booked.
        When an appointment is cancelled, the first waiting client is automatically notified.
      </Text>
    </View>
  );

  // ── Empty state ─────────────────────────────────────────────────────────────

  const ListEmpty = () => (
    <View style={{ alignItems: "center", paddingVertical: 64, gap: 12 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: "#14B8A615",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconSymbol name="clock.badge.fill" size={32} color="#14B8A6" />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>No Waitlist Entries</Text>
      <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", maxWidth: 260 }}>
        When clients join the waitlist for a fully booked slot, they'll appear here.
      </Text>
    </View>
  );

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <ScreenContainer>
      {/* Nav bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 0.5,
          borderBottomColor: colors.border,
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: "700", color: colors.foreground }}>
          Waitlist
        </Text>
        {entries.length > 0 && (
          <View
            style={{
              backgroundColor: "#14B8A6",
              borderRadius: 12,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>{entries.length}</Text>
          </View>
        )}
      </View>

      {/* Body */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
          <IconSymbol name="exclamationmark.triangle.fill" size={36} color={colors.error} />
          <Text style={{ fontSize: 15, color: colors.error, textAlign: "center" }}>{error}</Text>
          <Pressable
            onPress={() => { setLoading(true); fetchWaitlist(); }}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 10,
              paddingHorizontal: 20,
              paddingVertical: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          ListHeaderComponent={entries.length > 0 ? ListHeader : null}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </ScreenContainer>
  );
}
