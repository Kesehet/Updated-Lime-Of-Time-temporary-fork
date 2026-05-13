/**
 * Client Portal — My Packages Tab
 *
 * Shows all purchased packages with session progress and history.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useClientStore } from "@/lib/client-store";
import { ClientPortalBackground } from "@/components/client-portal-background";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// ── Palette ──────────────────────────────────────────────────────────────────
const GREEN_ACCENT = "#8FBF6A";
const GREEN_DARK = "#1A3A28";
const CARD_BG = "rgba(255,255,255,0.09)";
const CARD_BORDER = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_MUTED = "rgba(255,255,255,0.6)";
const DIVIDER = "rgba(255,255,255,0.10)";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ClientPackage {
  localId: string;
  packageLocalId: string;
  packageName: string;
  businessName: string;
  businessLogoUri: string | null;
  businessSlug: string | null;
  totalSessions: number;
  sessionsCompleted: number;
  totalValue: number | null;
  status: "active" | "completed" | "expired" | "cancelled";
  paymentStatus: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
}

interface SessionAppt {
  id: number;
  date: string;
  time: string;
  serviceName: string;
  status: string;
  staffName: string | null;
  locationName: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatTime12(time: string): string {
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function statusColor(status: ClientPackage["status"]) {
  switch (status) {
    case "active": return GREEN_ACCENT;
    case "completed": return "rgba(255,255,255,0.5)";
    case "expired": return "#FCA5A5";
    case "cancelled": return "#FCA5A5";
    default: return "rgba(255,255,255,0.5)";
  }
}

function statusLabel(status: ClientPackage["status"]): string {
  switch (status) {
    case "active": return "Active";
    case "completed": return "Completed";
    case "expired": return "Expired";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function apptStatusColor(status: string): string {
  switch (status) {
    case "confirmed": return "#6EE7B7";
    case "completed": return "rgba(255,255,255,0.5)";
    case "cancelled": return "#FCA5A5";
    case "pending": return "#FCD34D";
    default: return "rgba(255,255,255,0.4)";
  }
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function SessionProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.min(completed / total, 1) : 0;
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>Sessions used</Text>
        <Text style={{ color: GREEN_ACCENT, fontSize: 12, fontWeight: "700" }}>
          {completed} / {total}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 3, overflow: "hidden" }}>
        <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: GREEN_ACCENT, borderRadius: 3 }} />
      </View>
      {total - completed > 0 && (
        <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 4 }}>
          {total - completed} session{total - completed !== 1 ? "s" : ""} remaining
        </Text>
      )}
    </View>
  );
}

// ── Package Card ──────────────────────────────────────────────────────────────
function PackageCard({ pkg, onPress }: { pkg: ClientPackage; onPress: () => void }) {
  const remaining = pkg.totalSessions - pkg.sessionsCompleted;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
        {pkg.businessLogoUri ? (
          <Image source={{ uri: pkg.businessLogoUri }} style={{ width: 40, height: 40, borderRadius: 10 }} />
        ) : (
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 18 }}>📦</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 15, fontWeight: "700" }} numberOfLines={1}>{pkg.packageName}</Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 1 }}>{pkg.businessName}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={{ backgroundColor: `${statusColor(pkg.status)}22`, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${statusColor(pkg.status)}55` }}>
            <Text style={{ color: statusColor(pkg.status), fontSize: 11, fontWeight: "700" }}>{statusLabel(pkg.status)}</Text>
          </View>
          {pkg.status === "active" && remaining > 0 && (
            <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "600" }}>{remaining} left</Text>
          )}
        </View>
      </View>

      <SessionProgressBar completed={pkg.sessionsCompleted} total={pkg.totalSessions} />

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: DIVIDER }}>
        {pkg.totalValue != null && (
          <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>
            💰 <Text style={{ color: TEXT_PRIMARY, fontWeight: "600" }}>${pkg.totalValue.toFixed(2)}</Text>
          </Text>
        )}
        {pkg.expiresAt && (
          <Text style={{ color: pkg.status === "expired" ? "#FCA5A5" : TEXT_MUTED, fontSize: 12 }}>
            📅 Expires {formatDate(pkg.expiresAt)}
          </Text>
        )}
        {pkg.purchasedAt && !pkg.expiresAt && (
          <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>
            Purchased {formatDate(pkg.purchasedAt.split("T")[0])}
          </Text>
        )}
        <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>Tap for history →</Text>
      </View>
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function MyPackagesScreen() {
  const insets = useSafeAreaInsets();
  const { state, apiCall } = useClientStore();
  const [packages, setPackages] = useState<ClientPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Detail modal
  const [selectedPkg, setSelectedPkg] = useState<ClientPackage | null>(null);
  const [sessions, setSessions] = useState<SessionAppt[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const loadPackages = useCallback(async (silent = false) => {
    if (!state.account) return;
    if (!silent) setLoading(true);
    try {
      const data = await apiCall<ClientPackage[]>("/api/client/my-packages");
      setPackages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn("[MyPackages] load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [state.account, apiCall]);

  useFocusEffect(useCallback(() => { loadPackages(true); }, [loadPackages]));

  const openDetail = async (pkg: ClientPackage) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPkg(pkg);
    setSessionsLoading(true);
    setSessions([]);
    try {
      // Fetch all appointments and filter by packageLocalId
      const raw = await apiCall<{ appointments: any[] } | any[]>("/api/client/appointments");
      const appts: any[] = Array.isArray(raw) ? raw : (raw as any).appointments ?? [];
      const pkgSessions = appts
        .filter((a) => a.packageLocalId === pkg.packageLocalId || a.packageLocalId === pkg.localId)
        .sort((a, b) => {
          const da = new Date(`${a.date}T${a.time ?? "00:00"}`);
          const db2 = new Date(`${b.date}T${b.time ?? "00:00"}`);
          return db2.getTime() - da.getTime();
        })
        .map((a) => ({
          id: a.id,
          date: a.date,
          time: a.time ?? "00:00",
          serviceName: a.serviceName ?? "Service",
          status: a.status,
          staffName: a.staffName ?? null,
          locationName: a.locationName ?? null,
        }));
      setSessions(pkgSessions);
    } catch (err) {
      console.warn("[MyPackages] sessions load error:", err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadPackages(); };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
        <ClientPortalBackground />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={GREEN_ACCENT} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
      <ClientPortalBackground />
      <View style={[s.container, { paddingTop: insets.top + 8 }]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>My Packages</Text>
          <Text style={s.headerSub}>{packages.length} package{packages.length !== 1 ? "s" : ""}</Text>
        </View>

        {packages.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>📦</Text>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 8 }}>No Packages Yet</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
              When you purchase a service package from a business, it will appear here with your session history.
            </Text>
          </View>
        ) : (
          <FlatList
            data={packages}
            keyExtractor={(item) => item.localId}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 80 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_ACCENT} />}
            renderItem={({ item }) => (
              <PackageCard pkg={item} onPress={() => openDetail(item)} />
            )}
          />
        )}
      </View>

      {/* Package Detail Modal */}
      <Modal
        visible={selectedPkg !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedPkg(null)}
      >
        <View style={{ flex: 1, backgroundColor: GREEN_DARK }}>
          {/* Modal Header */}
          <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: DIVIDER, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 18, fontWeight: "700" }} numberOfLines={1}>{selectedPkg?.packageName}</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 13, marginTop: 2 }}>{selectedPkg?.businessName}</Text>
            </View>
            <Pressable
              onPress={() => setSelectedPkg(null)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
            >
              <Text style={{ color: GREEN_ACCENT, fontSize: 15, fontWeight: "600" }}>Done</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
            {/* Progress summary */}
            {selectedPkg && (
              <View style={[s.card, { marginBottom: 20 }]}>
                <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Progress</Text>
                <SessionProgressBar completed={selectedPkg.sessionsCompleted} total={selectedPkg.totalSessions} />
                <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
                  <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, alignItems: "center" }}>
                    <Text style={{ color: GREEN_ACCENT, fontSize: 22, fontWeight: "800" }}>{selectedPkg.sessionsCompleted}</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2 }}>Used</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, alignItems: "center" }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 22, fontWeight: "800" }}>{selectedPkg.totalSessions - selectedPkg.sessionsCompleted}</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2 }}>Remaining</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, alignItems: "center" }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 22, fontWeight: "800" }}>{selectedPkg.totalSessions}</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2 }}>Total</Text>
                  </View>
                </View>
                {selectedPkg.totalValue != null && (
                  <Text style={{ color: TEXT_MUTED, fontSize: 13, marginTop: 12 }}>
                    Package value: <Text style={{ color: TEXT_PRIMARY, fontWeight: "600" }}>${selectedPkg.totalValue.toFixed(2)}</Text>
                  </Text>
                )}
                {selectedPkg.expiresAt && (
                  <Text style={{ color: selectedPkg.status === "expired" ? "#FCA5A5" : TEXT_MUTED, fontSize: 13, marginTop: 4 }}>
                    {selectedPkg.status === "expired" ? "⚠️ Expired" : "📅 Expires"}: {formatDate(selectedPkg.expiresAt)}
                  </Text>
                )}
              </View>
            )}

            {/* Session History */}
            <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>Session History</Text>

            {sessionsLoading ? (
              <ActivityIndicator color={GREEN_ACCENT} style={{ marginTop: 24 }} />
            ) : sessions.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <Text style={{ fontSize: 32, marginBottom: 10 }}>📅</Text>
                <Text style={{ color: TEXT_MUTED, fontSize: 14, textAlign: "center" }}>No sessions booked yet</Text>
              </View>
            ) : (
              sessions.map((sess, idx) => (
                <View key={sess.id} style={[s.sessionRow, idx === sessions.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${GREEN_ACCENT}22`, borderWidth: 1, borderColor: `${GREEN_ACCENT}55`, alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                    <Text style={{ color: GREEN_ACCENT, fontSize: 11, fontWeight: "700" }}>{sessions.length - idx}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: "600" }}>{sess.serviceName}</Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }}>
                      {formatDate(sess.date)} · {formatTime12(sess.time)}
                    </Text>
                    {(sess.staffName || sess.locationName) && (
                      <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 1 }}>
                        {[sess.staffName, sess.locationName].filter(Boolean).join(" · ")}
                      </Text>
                    )}
                  </View>
                  <View style={{ backgroundColor: `${apptStatusColor(sess.status)}22`, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: `${apptStatusColor(sess.status)}55` }}>
                    <Text style={{ color: apptStatusColor(sess.status), fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>{sess.status}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  headerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 24,
    fontWeight: "800",
  },
  headerSub: {
    color: TEXT_MUTED,
    fontSize: 13,
    marginTop: 2,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
});
