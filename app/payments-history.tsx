import React, { useState, useCallback, useEffect } from "react";
import {
  Text,
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { apiCall } from "@/lib/_core/api";

type Transaction = {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: string;
  created: number;
  description: string;
  clientName: string | null;
  sourceId: string | null;
};

type BalanceEntry = { amount: number; currency: string };
type StripeBalance = { available: BalanceEntry[]; pending: BalanceEntry[] };

const TX_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  charge:              { label: "Charge",       color: "#22C55E", icon: "+" },
  refund:              { label: "Refund",        color: "#EF4444", icon: "↩" },
  payout:              { label: "Payout",        color: "#635BFF", icon: "→" },
  stripe_fee:          { label: "Stripe Fee",    color: "#F59E0B", icon: "%" },
  application_fee:     { label: "Platform Fee",  color: "#F59E0B", icon: "%" },
  payment:             { label: "Payment",       color: "#22C55E", icon: "+" },
  payment_refund:      { label: "Refund",        color: "#EF4444", icon: "↩" },
  payout_cancel:       { label: "Payout Cancel", color: "#9CA3AF", icon: "✕" },
  payout_failure:      { label: "Payout Failed", color: "#EF4444", icon: "✕" },
  adjustment:          { label: "Adjustment",    color: "#9CA3AF", icon: "~" },
};

function getTxConfig(type: string) {
  return TX_TYPE_CONFIG[type] ?? { label: type.replace(/_/g, " "), color: "#9CA3AF", icon: "·" };
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

type FilterType = "all" | "charge" | "refund" | "payout";

export default function PaymentsHistoryScreen() {
  const { state } = useStore();
  const colors = useColors();
  const router = useRouter();
  const businessOwnerId = state.businessOwnerId;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState<StripeBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [notConnected, setNotConnected] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (!businessOwnerId) return;
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [txData, balData] = await Promise.all([
        apiCall<{ transactions: Transaction[] }>(
          `/api/stripe-connect/transactions?businessOwnerId=${businessOwnerId}&limit=50`
        ).catch((e) => {
          if (e?.message?.includes("No Stripe account")) { setNotConnected(true); return null; }
          throw e;
        }),
        apiCall<StripeBalance>(
          `/api/stripe-connect/balance?businessOwnerId=${businessOwnerId}`
        ).catch(() => null),
      ]);
      if (txData) setTransactions(txData.transactions);
      if (balData) setBalance(balData);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load payment history");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessOwnerId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true);
  }, [loadData]);

  const filteredTx = transactions.filter((tx) => {
    if (filter === "all") return true;
    if (filter === "charge") return tx.type === "charge" || tx.type === "payment";
    if (filter === "refund") return tx.type === "refund" || tx.type === "payment_refund";
    if (filter === "payout") return tx.type === "payout";
    return true;
  });

  const totalNet = filteredTx.reduce((sum, tx) => sum + tx.net, 0);

  const renderItem = ({ item }: { item: Transaction }) => {
    const cfg = getTxConfig(item.type);
    const isPositive = item.net >= 0;
    return (
      <View style={[styles.txRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Type badge */}
        <View style={[styles.txBadge, { backgroundColor: cfg.color + "18" }]}>
          <Text style={{ fontSize: 16, color: cfg.color }}>{cfg.icon}</Text>
        </View>
        {/* Details */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{cfg.label}</Text>
            {item.clientName ? (
              <Text style={{ fontSize: 11, color: colors.muted }}>· {item.clientName}</Text>
            ) : null}
          </View>
          {item.description ? (
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
            {formatDate(item.created)} · {formatTime(item.created)}
          </Text>
          {item.fee > 0 ? (
            <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1 }}>
              Gross ${Math.abs(item.amount).toFixed(2)} · Fee ${item.fee.toFixed(2)}
            </Text>
          ) : null}
        </View>
        {/* Net amount */}
        <Text style={{ fontSize: 15, fontWeight: "700", color: isPositive ? "#22C55E" : "#EF4444" }}>
          {isPositive ? "+" : ""}${item.net.toFixed(2)}
        </Text>
      </View>
    );
  };

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "all",    label: "All" },
    { key: "charge", label: "Charges" },
    { key: "refund", label: "Refunds" },
    { key: "payout", label: "Payouts" },
  ];

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Payments History</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.muted, marginTop: 12 }}>Loading transactions…</Text>
        </View>
      ) : notConnected ? (
        <View style={styles.center}>
          <IconSymbol name="creditcard.fill" size={48} color={colors.muted + "60"} />
          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600", marginTop: 16 }}>
            Stripe Not Connected
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", marginTop: 8, paddingHorizontal: 32 }}>
            Connect your Stripe account in Payment Methods to view transaction history.
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/payment-methods")}
            style={[styles.connectBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: "#fff", fontWeight: "600" }}>Go to Payment Methods</Text>
          </TouchableOpacity>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <IconSymbol name="exclamationmark.triangle.fill" size={40} color={colors.error} />
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 12 }}>
            Failed to Load
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", marginTop: 6, paddingHorizontal: 32 }}>
            {error}
          </Text>
          <TouchableOpacity onPress={() => loadData()} style={[styles.connectBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredTx}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              {/* Balance cards */}
              {balance && (
                <View style={styles.balanceRow}>
                  {balance.available.map((b) => (
                    <View key={`avail-${b.currency}`} style={[styles.balanceCard, { backgroundColor: "#22C55E18", borderColor: "#22C55E40" }]}>
                      <Text style={{ fontSize: 11, color: "#22C55E", fontWeight: "600" }}>Available</Text>
                      <Text style={{ fontSize: 20, fontWeight: "700", color: "#22C55E", marginTop: 2 }}>
                        ${b.amount.toFixed(2)}
                      </Text>
                      <Text style={{ fontSize: 10, color: "#22C55E80" }}>{b.currency}</Text>
                    </View>
                  ))}
                  {balance.pending.map((b) => (
                    <View key={`pend-${b.currency}`} style={[styles.balanceCard, { backgroundColor: "#F59E0B18", borderColor: "#F59E0B40" }]}>
                      <Text style={{ fontSize: 11, color: "#F59E0B", fontWeight: "600" }}>Pending</Text>
                      <Text style={{ fontSize: 20, fontWeight: "700", color: "#F59E0B", marginTop: 2 }}>
                        ${b.amount.toFixed(2)}
                      </Text>
                      <Text style={{ fontSize: 10, color: "#F59E0B80" }}>{b.currency}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Filter tabs */}
              <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
                {FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[
                      styles.filterTab,
                      filter === f.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                    ]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: filter === f.key ? "700" : "500", color: filter === f.key ? colors.primary : colors.muted }}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Net total for current filter */}
              {filteredTx.length > 0 && (
                <View style={[styles.summaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    {filteredTx.length} transaction{filteredTx.length !== 1 ? "s" : ""}
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: totalNet >= 0 ? "#22C55E" : "#EF4444" }}>
                    Net {totalNet >= 0 ? "+" : ""}${totalNet.toFixed(2)}
                  </Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <IconSymbol name="creditcard.fill" size={40} color={colors.muted + "60"} />
              <Text style={{ color: colors.muted, fontSize: 14, marginTop: 12 }}>No transactions found</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  connectBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  balanceRow: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    paddingBottom: 8,
  },
  balanceCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
  },
  filterRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 4,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  txBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
