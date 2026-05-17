import {
  Text,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Alert,
  Modal,
  Platform,
  Linking,
  ScrollView,
  Share,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Image } from "expo-image";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useCallback, useMemo } from "react";
import { GiftCard, formatPhoneNumber, stripPhoneFormat, PUBLIC_BOOKING_URL } from "@/lib/types";
import * as Clipboard from "expo-clipboard";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useScrollToTopOnFocus } from "@/hooks/use-scroll-to-top-on-focus";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

function generateGiftCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `GIFT-${code}`;
}

type FilterChip = "all" | "active" | "redeemed" | "unpaid" | "expired";

function getCardStatus(card: GiftCard): "active" | "redeemed" | "unpaid" | "expired" {
  if (card.redeemed) return "redeemed";
  const isPaid = (card as any).paymentStatus === "paid" || !(card as any).purchasedPublicly;
  if (!isPaid) return "unpaid";
  if (card.expiresAt && new Date(card.expiresAt) < new Date()) return "expired";
  return "active";
}

// ─── Bottom Sheet Editor ─────────────────────────────────────────────────────
function EditBottomSheet({
  card,
  colors,
  fs,
  visible,
  onClose,
  onSave,
  onDelete,
  getCardItems,
  getCardTotal,
}: {
  card: GiftCard | null;
  colors: any;
  fs: any;
  visible: boolean;
  onClose: () => void;
  onSave: (card: GiftCard, updates: Partial<GiftCard> & { ownerNotes?: string }) => void;
  onDelete: (id: string) => void;
  getCardItems: (card: GiftCard) => Array<{ name: string; price: string; type: string }>;
  getCardTotal: (card: GiftCard) => number;
}) {
  const [editBalance, setEditBalance] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync state when card changes
  const prevCardId = useMemo(() => card?.id, [card]);
  useMemo(() => {
    if (card) {
      const total = card.originalValue ?? 0;
      setEditBalance(card.remainingBalance != null ? String(card.remainingBalance) : String(total));
      setEditExpiry(card.expiresAt ? card.expiresAt.split("T")[0] : "");
      setEditNotes((card as any).ownerNotes ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevCardId]);

  if (!card) return null;

  const items = getCardItems(card);
  const total = getCardTotal(card);
  const isPaid = (card as any).paymentStatus === "paid" || !(card as any).purchasedPublicly;
  const isRedeemed = card.redeemed;
  const status = getCardStatus(card);

  const statusColor = {
    active: colors.success,
    redeemed: colors.muted,
    unpaid: colors.warning,
    expired: colors.error,
  }[status];

  const statusLabel = {
    active: "Active",
    redeemed: "Redeemed",
    unpaid: "Unpaid",
    expired: "Expired",
  }[status];

  const handleSave = async () => {
    setSaving(true);
    const balanceNum = parseFloat(editBalance);
    const updates: Partial<GiftCard> & { ownerNotes?: string } = {
      remainingBalance: isNaN(balanceNum) ? card.remainingBalance : balanceNum,
      expiresAt: editExpiry || undefined,
      ownerNotes: editNotes.trim(),
    };
    await onSave(card, updates);
    setSaving(false);
    onClose();
  };

  const handleToggleRedeemed = () => {
    Alert.alert(
      isRedeemed ? "Mark as Active" : "Mark as Redeemed",
      isRedeemed ? "Restore this gift card to active status?" : `Mark gift card ${card.code} as fully redeemed?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            onSave(card, {
              redeemed: !isRedeemed,
              redeemedAt: !isRedeemed ? new Date().toISOString() : undefined,
            });
            onClose();
          },
        },
      ]
    );
  };

  const handleTogglePaid = () => {
    const newStatus = isPaid ? "unpaid" : "paid";
    onSave(card, { paymentStatus: newStatus } as any);
    onClose();
  };

  const handleVoid = () => {
    Alert.alert("Void Gift Card", `Permanently delete gift card ${card.code}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Void", style: "destructive", onPress: () => { onDelete(card.id); onClose(); } },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView behavior="padding" style={{ width: "100%" }}>
          <View style={[styles.bottomSheet, { backgroundColor: colors.surface }]} onStartShouldSetResponder={() => true}>
            {/* Handle */}
            <View style={{ alignItems: "center", marginBottom: 12 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            {/* Card Header */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.md, fontWeight: "800", color: colors.foreground, letterSpacing: 1 }}>{card.code}</Text>
                {card.recipientName ? (
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>→ {card.recipientName}</Text>
                ) : null}
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: statusColor + "20" }}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: statusColor }}>{statusLabel}</Text>
              </View>
            </View>

            {/* Items */}
            {card.giftType === "balance" ? (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 4 }}>💵 Balance Credit — usable on any service</Text>
            ) : items.map((it, idx) => (
              <Text key={idx} style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 2 }}>
                {it.type === "product" ? "📦" : "✂️"} {it.name} — {it.price}
              </Text>
            ))}
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary, marginBottom: 12, marginTop: 4 }}>
              Original Value: ${total.toFixed(2)}
            </Text>

            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {/* Remaining Balance */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Remaining Balance ($)</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                value={editBalance}
                onChangeText={setEditBalance}
                keyboardType="decimal-pad"
                returnKeyType="done"
                placeholder={String(total)}
                placeholderTextColor={colors.muted + "80"}
              />

              {/* Expiry Date */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Expiry Date (YYYY-MM-DD)</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                value={editExpiry}
                onChangeText={setEditExpiry}
                placeholder="e.g. 2026-12-31"
                placeholderTextColor={colors.muted + "80"}
                returnKeyType="done"
              />

              {/* Owner Notes */}
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Internal Note (not visible to client)</Text>
              <TextInput
                style={[styles.input, styles.multilineInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="Optional note for your records"
                placeholderTextColor={colors.muted + "80"}
                multiline
              />

              {/* Transaction History */}
              {(() => {
                const txs: Array<{ type: string; amount: number; balanceAfter: number; at: string }> =
                  (card as any).transactions ?? [];
                return (
                  <View style={{ marginTop: 16, marginBottom: 4 }}>
                    <Text style={[styles.fieldLabel, { color: colors.muted, marginBottom: 6 }]}>Transaction History</Text>
                    {txs.length === 0 ? (
                      <Text style={{ fontSize: fs.xs, color: colors.muted, fontStyle: "italic" }}>No transactions yet</Text>
                    ) : (
                      txs.slice().reverse().map((tx, idx) => {
                        const isRestore = tx.type === "restored";
                        const icon = isRestore ? "↩" : "🎁";
                        const label = isRestore ? "Restored" : "Redeemed";
                        const amtColor = isRestore ? colors.success : colors.warning;
                        const date = new Date(tx.at);
                        const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                        const timeStr = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                        return (
                          <View key={idx} style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                            paddingVertical: 6, borderBottomWidth: idx < txs.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                          }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                              <Text style={{ fontSize: fs.sm }}>{icon}</Text>
                              <View>
                                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: amtColor }}>{label} ${tx.amount.toFixed(2)}</Text>
                                <Text style={{ fontSize: 10, color: colors.muted }}>{dateStr} · {timeStr}</Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: fs.xs, color: colors.muted }}>bal ${tx.balanceAfter.toFixed(2)}</Text>
                          </View>
                        );
                      })
                    )}
                  </View>
                );
              })()}

              {/* Toggle Actions */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {/* Mark Redeemed / Active */}
                <Pressable
                  onPress={handleToggleRedeemed}
                  style={({ pressed }) => [{
                    flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center",
                    backgroundColor: isRedeemed ? colors.primary + "20" : colors.success + "20",
                    borderWidth: 1, borderColor: isRedeemed ? colors.primary + "40" : colors.success + "40",
                  }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isRedeemed ? colors.primary : colors.success }}>
                    {isRedeemed ? "↩ Mark Active" : "✓ Mark Redeemed"}
                  </Text>
                </Pressable>

                {/* Mark Paid / Unpaid — only relevant for client-purchased cards */}
                {(card as any).purchasedPublicly && (
                  <Pressable
                    onPress={handleTogglePaid}
                    style={({ pressed }) => [{
                      flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center",
                      backgroundColor: isPaid ? colors.warning + "20" : colors.success + "20",
                      borderWidth: 1, borderColor: isPaid ? colors.warning + "40" : colors.success + "40",
                    }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isPaid ? colors.warning : colors.success }}>
                      {isPaid ? "Mark Unpaid" : "Mark as Paid"}
                    </Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>

            {/* Save + Void */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={handleVoid}
                style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.error + "20", borderWidth: 1, borderColor: colors.error + "40" }, pressed && { opacity: 0.7 }]}
              >
                <IconSymbol name="trash.fill" size={16} color={colors.error} />
              </Pressable>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
              >
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                style={({ pressed }) => [{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs.sm }}>Save Changes</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── Gift Card Row ────────────────────────────────────────────────────────────
function GiftCardRow({
  card, colors, fs, getCardItems, getCardTotal, onPress, onCopyCode, onSendSMS,
}: {
  card: GiftCard;
  colors: any;
  fs: any;
  getCardItems: (c: GiftCard) => Array<{ name: string; price: string; type: string }>;
  getCardTotal: (c: GiftCard) => number;
  onPress: (c: GiftCard) => void;
  onCopyCode: (code: string) => void;
  onSendSMS: (c: GiftCard) => void;
}) {
  const items = getCardItems(card);
  const total = getCardTotal(card);
  const status = getCardStatus(card);
  const statusColor = {
    active: colors.success,
    redeemed: colors.muted,
    unpaid: colors.warning,
    expired: colors.error,
  }[status];
  const statusLabel = { active: "Active", redeemed: "Redeemed", unpaid: "Unpaid", expired: "Expired" }[status];
  const isPaid = (card as any).paymentStatus === "paid" || !(card as any).purchasedPublicly;
  const paymentMethod = (card as any).paymentMethod;
  const paymentMethodLabel: Record<string, string> = { zelle: "Zelle", venmo: "Venmo", cashapp: "Cash App", cash: "Cash", card: "Card" };

  return (
    <Pressable
      onPress={() => onPress(card)}
      style={({ pressed }) => [{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 4,
        borderLeftColor: statusColor,
        opacity: status === "redeemed" ? 0.75 : 1,
      }, pressed && { opacity: 0.85 }]}
    >
      {/* Banner image if available */}
      {(card as any).bannerImageUri ? (
        <Image
          source={{ uri: (card as any).bannerImageUri }}
          style={{ width: "100%", height: 90, borderRadius: 10, marginBottom: 10, backgroundColor: colors.border }}
          contentFit="cover"
        />
      ) : null}

      {/* Top row: code + status badge */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: "800", color: colors.foreground, letterSpacing: 1 }}>{card.code}</Text>
            <Pressable onPress={() => onCopyCode(card.code)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
              <IconSymbol name="doc.text.fill" size={14} color={colors.primary} />
            </Pressable>
          </View>
          {/* Purchaser → Recipient (for Sold tab) */}
          {(card as any).purchasedPublicly && (
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
              {(card as any).purchaserName ?? "Unknown"} → {card.recipientName ?? "Recipient"}
            </Text>
          )}
          {/* Recipient only (for Issued tab) */}
          {!(card as any).purchasedPublicly && card.recipientName ? (
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>→ {card.recipientName}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {!isPaid && (card as any).purchasedPublicly && paymentMethod === "card" && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "rgba(59,130,246,0.15)", borderWidth: 1, borderColor: "rgba(59,130,246,0.30)" }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#3B82F6" }}>💳 Pending</Text>
            </View>
          )}
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: statusColor + "20" }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: statusColor }}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      {/* Items */}
      {card.giftType === "balance" ? (
        <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 2 }}>💵 Balance Credit — usable on any service</Text>
      ) : items.map((it, idx) => (
        <Text key={idx} style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 2 }}>
          {it.type === "product" ? "📦" : "✂️"} {it.name} — {it.price}
        </Text>
      ))}

      {/* Value row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
        {total > 0 && (
          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary }}>
            Value: ${total.toFixed(2)}
          </Text>
        )}
        {card.remainingBalance != null && card.remainingBalance < total && (
          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.success }}>
            Balance: ${card.remainingBalance.toFixed(2)}
          </Text>
        )}
      </View>

      {/* Owner notes */}
      {(card as any).ownerNotes ? (
        <Text style={{ fontSize: fs.xs, color: colors.muted, fontStyle: "italic", marginTop: 4 }} numberOfLines={1}>
          📝 {(card as any).ownerNotes}
        </Text>
      ) : null}

      {/* Footer */}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.border }}>
        <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }}>
          {new Date(card.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {card.expiresAt ? ` · Exp ${new Date(card.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          {paymentMethod && (card as any).purchasedPublicly ? ` · ${paymentMethodLabel[paymentMethod] ?? paymentMethod}` : ""}
        </Text>
        {status !== "redeemed" && status !== "expired" && (
          <Pressable
            onPress={() => onSendSMS(card)}
            style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.primary + "15", flexDirection: "row", alignItems: "center", gap: 4 }, pressed && { opacity: 0.7 }]}
          >
            <IconSymbol name="paperplane.fill" size={12} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>Send</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onPress(card)}
          style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginLeft: 6 }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground }}>Edit</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Filter Chips ─────────────────────────────────────────────────────────────
function FilterChips({
  active, onChange, counts, colors, fs,
}: {
  active: FilterChip;
  onChange: (f: FilterChip) => void;
  counts: Record<FilterChip, number>;
  colors: any;
  fs: any;
}) {
  const chips: { key: FilterChip; label: string; color: string }[] = [
    { key: "all", label: "All", color: colors.foreground },
    { key: "active", label: "Active", color: colors.success },
    { key: "redeemed", label: "Redeemed", color: colors.muted },
    { key: "unpaid", label: "Unpaid", color: colors.warning },
    { key: "expired", label: "Expired", color: colors.error },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingVertical: 8 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, flexDirection: "row" }}>
      {chips.map((chip) => {
        const isActive = active === chip.key;
        const count = counts[chip.key];
        if (chip.key !== "all" && count === 0) return null;
        return (
          <Pressable
            key={chip.key}
            onPress={() => onChange(chip.key)}
            style={({ pressed }) => [{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
              backgroundColor: isActive ? chip.color + "20" : colors.surface,
              borderWidth: 1.5,
              borderColor: isActive ? chip.color : colors.border,
            }, pressed && { opacity: 0.75 }]}
          >
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isActive ? chip.color : colors.muted }}>
              {chip.label}{count > 0 ? ` ${count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function GiftCardsScreen() {
  const { state, dispatch, syncToDb, getServiceById } = useStore();
  const buyGiftLink = state.settings?.customSlug
    ? `${PUBLIC_BOOKING_URL}/api/buy-gift/${state.settings.customSlug}`
    : null;

  const colors = useColors();
  const { hp, maxContentWidth, fs } = useResponsive();
  const issuedListRef = useScrollToTopOnFocus<FlatList>();
  const soldListRef = useScrollToTopOnFocus<FlatList>();

  // Split cards
  const issuedCards = useMemo(
    () => [...state.giftCards].filter(c => !(c as any).purchasedPublicly).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.giftCards]
  );
  const soldCards = useMemo(
    () => [...state.giftCards].filter(c => (c as any).purchasedPublicly).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.giftCards]
  );

  // Tabs & Filters
  const [mainTab, setMainTab] = useState<"issued" | "sold">("issued");
  const [issuedFilter, setIssuedFilter] = useState<FilterChip>("all");
  const [soldFilter, setSoldFilter] = useState<FilterChip>("all");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [message, setMessage] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<"services" | "products">("services");
  const [bannerImageUri, setBannerImageUri] = useState<string | undefined>(undefined);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  // Edit bottom sheet
  const [editCard, setEditCard] = useState<GiftCard | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const markAsPaidMut = trpc.giftCards.markAsPaid.useMutation();
  const updateMut = trpc.giftCards.update.useMutation();
  const uploadImageMut = trpc.files.uploadImage.useMutation();

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getCardItems = useCallback(
    (card: GiftCard) => {
      const items: { name: string; price: string; type: string }[] = [];
      const svcIds = card.serviceIds ?? (card.serviceLocalId ? [card.serviceLocalId] : []);
      for (const sid of svcIds) {
        const s = getServiceById(sid);
        if (s) items.push({ name: s.name, price: `$${parseFloat(String(s.price)).toFixed(2)}`, type: "service" });
      }
      for (const pid of card.productIds ?? []) {
        const p = state.products.find((pr) => pr.id === pid);
        if (p) items.push({ name: p.name, price: `$${parseFloat(String(p.price)).toFixed(2)}`, type: "product" });
      }
      if (items.length === 0 && card.serviceLocalId) {
        const s = getServiceById(card.serviceLocalId);
        if (s) items.push({ name: s.name, price: `$${parseFloat(String(s.price)).toFixed(2)}`, type: "service" });
      }
      return items;
    },
    [getServiceById, state.products]
  );

  const getCardTotal = useCallback(
    (card: GiftCard) => {
      if (card.originalValue != null && card.originalValue > 0) return card.originalValue;
      let total = 0;
      const svcIds = card.serviceIds ?? (card.serviceLocalId ? [card.serviceLocalId] : []);
      for (const sid of svcIds) {
        const s = getServiceById(sid);
        if (s) total += parseFloat(String(s.price));
      }
      for (const pid of card.productIds ?? []) {
        const p = state.products.find((pr) => pr.id === pid);
        if (p) total += parseFloat(String(p.price));
      }
      if (total === 0 && card.serviceLocalId) {
        const s = getServiceById(card.serviceLocalId);
        if (s) total = parseFloat(String(s.price));
      }
      return total;
    },
    [getServiceById, state.products]
  );

  // ── Filter counts ─────────────────────────────────────────────────────────
  const countChips = useCallback((cards: GiftCard[]): Record<FilterChip, number> => {
    const counts: Record<FilterChip, number> = { all: cards.length, active: 0, redeemed: 0, unpaid: 0, expired: 0 };
    for (const c of cards) {
      const s = getCardStatus(c);
      counts[s]++;
    }
    return counts;
  }, []);

  const issuedCounts = useMemo(() => countChips(issuedCards), [issuedCards, countChips]);
  const soldCounts = useMemo(() => countChips(soldCards), [soldCards, countChips]);

  const filteredIssued = useMemo(() => {
    if (issuedFilter === "all") return issuedCards;
    return issuedCards.filter(c => getCardStatus(c) === issuedFilter);
  }, [issuedCards, issuedFilter]);

  const filteredSold = useMemo(() => {
    if (soldFilter === "all") return soldCards;
    return soldCards.filter(c => getCardStatus(c) === soldFilter);
  }, [soldCards, soldFilter]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalActive = useMemo(() => state.giftCards.filter(c => !c.redeemed && !(c.expiresAt && new Date(c.expiresAt) < new Date())).length, [state.giftCards]);
  const totalRedeemed = useMemo(() => state.giftCards.filter(c => c.redeemed).length, [state.giftCards]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleShareBuyGiftLink = useCallback(async () => {
    if (!buyGiftLink) return;
    try { await Share.share({ message: `Buy a gift for someone special! ${buyGiftLink}`, url: buyGiftLink }); } catch {}
  }, [buyGiftLink]);

  const handleCopyBuyGiftLink = useCallback(async () => {
    if (!buyGiftLink) return;
    await Clipboard.setStringAsync(buyGiftLink);
    Alert.alert("Copied!", "The buy-a-gift link has been copied to your clipboard.");
  }, [buyGiftLink]);

  const handleCopyCode = useCallback(async (code: string) => {
    try {
      if (Platform.OS === "web") await navigator.clipboard.writeText(code);
      else await Clipboard.setStringAsync(code);
      Alert.alert("Copied", `Gift code ${code} copied.`);
    } catch { Alert.alert("Code", code); }
  }, []);

  const handleSendGiftSMS = useCallback((card: GiftCard) => {
    const items = getCardItems(card);
    const total = getCardTotal(card);
    const businessName = state.settings.businessName || "Our Business";
    const itemList = items.map((i) => `${i.name} (${i.price})`).join(", ");
    const expiryText = card.expiresAt ? `\nExpires: ${new Date(card.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.` : "";
    const personalMsg = card.message ? `\n\n"${card.message}"` : "";
    const giftUrl = `${PUBLIC_BOOKING_URL}/gift/${card.code}`;
    const body = `🎁 You've received a Gift Card from ${businessName}!\n\nIncludes: ${itemList}\nTotal Value: $${total.toFixed(2)}\nGift Code: ${card.code}${personalMsg}${expiryText}\n\nRedeem here: ${giftUrl}\n\n— ${businessName}`;
    const phone = card.recipientPhone ? stripPhoneFormat(card.recipientPhone) : "";
    const smsUrl = Platform.OS === "ios" ? `sms:${phone}&body=${encodeURIComponent(body)}` : `sms:${phone}?body=${encodeURIComponent(body)}`;
    Linking.openURL(smsUrl).catch(() => Alert.alert("Error", "Could not open messaging app."));
  }, [getCardItems, getCardTotal, state.settings.businessName]);

  const handleOpenEdit = useCallback((card: GiftCard) => {
    setEditCard(card);
    setShowEdit(true);
  }, []);

  const handleSaveEdit = useCallback(async (card: GiftCard, updates: Partial<GiftCard> & { ownerNotes?: string; paymentStatus?: string }) => {
    try {
      // Build updated card for local state
      const updatedCard: GiftCard = { ...card, ...updates };

      // Persist ownerNotes in GIFT_DATA block via message field
      // We use the update mutation which now accepts expiresAt, paymentStatus, recipientName, recipientPhone
      await updateMut.mutateAsync({
        localId: card.id,
        businessOwnerId: state.businessOwnerId ?? 0,
        redeemed: updates.redeemed ?? card.redeemed,
        redeemedAt: updates.redeemedAt ?? card.redeemedAt,
        expiresAt: updates.expiresAt ?? card.expiresAt,
        paymentStatus: (updates as any).paymentStatus ?? (card as any).paymentStatus,
        remainingBalance: updates.remainingBalance ?? card.remainingBalance,
        ownerNotes: updates.ownerNotes ?? (card as any).ownerNotes,
      } as any);

      dispatch({ type: "UPDATE_GIFT_CARD", payload: updatedCard as any });
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to save changes.");
    }
  }, [updateMut, state.businessOwnerId, dispatch]);

  const handleDelete = useCallback((id: string) => {
    dispatch({ type: "DELETE_GIFT_CARD", payload: id });
    syncToDb({ type: "DELETE_GIFT_CARD", payload: id });
  }, [dispatch, syncToDb]);

  // ── Create Form ───────────────────────────────────────────────────────────
  const totalValue = useMemo(() => {
    let total = 0;
    for (const sid of selectedServiceIds) {
      const s = getServiceById(sid);
      if (s) total += parseFloat(String(s.price));
    }
    for (const pid of selectedProductIds) {
      const p = state.products.find((pr) => pr.id === pid);
      if (p) total += parseFloat(String(p.price));
    }
    return total;
  }, [selectedServiceIds, selectedProductIds, state.products, getServiceById]);

  const availableProducts = useMemo(() => state.products.filter((p) => p.available), [state.products]);

  const resetForm = useCallback(() => {
    setSelectedServiceIds([]);
    setSelectedProductIds([]);
    setRecipientName("");
    setRecipientPhone("");
    setMessage("");
    setExpiresInDays("30");
    setBannerImageUri(undefined);
    setShowForm(false);
  }, []);

  const handleCreate = useCallback(() => {
    if (selectedServiceIds.length === 0 && selectedProductIds.length === 0) {
      Alert.alert("Required", "Please select at least one service or product.");
      return;
    }
    const days = parseInt(expiresInDays, 10);
    const expiresAt = !isNaN(days) && days > 0 ? new Date(Date.now() + days * 86400000).toISOString().split("T")[0] : undefined;
    const newCard: GiftCard = {
      id: generateId(),
      code: generateGiftCode(),
      serviceLocalId: selectedServiceIds[0] || "",
      serviceIds: selectedServiceIds,
      productIds: selectedProductIds,
      originalValue: totalValue,
      remainingBalance: totalValue,
      recipientName: recipientName.trim(),
      recipientPhone: recipientPhone.trim(),
      message: message.trim(),
      redeemed: false,
      expiresAt,
      createdAt: new Date().toISOString(),
      ...(bannerImageUri ? { bannerImageUri } : {}),
    };
    dispatch({ type: "ADD_GIFT_CARD", payload: newCard });
    syncToDb({ type: "ADD_GIFT_CARD", payload: newCard });
    resetForm();
  }, [selectedServiceIds, selectedProductIds, recipientName, recipientPhone, message, expiresInDays, totalValue, bannerImageUri, dispatch, syncToDb, resetForm]);

  const handlePhoneInput = useCallback((text: string) => setRecipientPhone(formatPhoneNumber(text)), []);
  const toggleService = useCallback((id: string) => setSelectedServiceIds((prev) => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]), []);
  const toggleProduct = useCallback((id: string) => setSelectedProductIds((prev) => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]), []);

  const pickBannerImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission Required", "Please allow access to your photo library."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      if (Platform.OS !== "web") {
        try {
          setUploadingBanner(true);
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const mimeType = result.assets[0].mimeType ?? "image/jpeg";
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "gifts" });
          setBannerImageUri(url);
        } catch { setBannerImageUri(localUri); }
        finally { setUploadingBanner(false); }
      } else { setBannerImageUri(localUri); }
    }
  }, [uploadImageMut]);

  const selectedItemsSummary = useMemo(() => {
    const items: string[] = [];
    for (const sid of selectedServiceIds) { const s = getServiceById(sid); if (s) items.push(s.name); }
    for (const pid of selectedProductIds) { const p = state.products.find((pr) => pr.id === pid); if (p) items.push(p.name); }
    return items;
  }, [selectedServiceIds, selectedProductIds, getServiceById, state.products]);

  // ── Render card row ───────────────────────────────────────────────────────
  const renderCardRow = useCallback(({ item }: { item: GiftCard }) => (
    <GiftCardRow
      card={item}
      colors={colors}
      fs={fs}
      getCardItems={getCardItems}
      getCardTotal={getCardTotal}
      onPress={handleOpenEdit}
      onCopyCode={handleCopyCode}
      onSendSMS={handleSendGiftSMS}
    />
  ), [colors, fs, getCardItems, getCardTotal, handleOpenEdit, handleCopyCode, handleSendGiftSMS]);

  // ── Create Form JSX ───────────────────────────────────────────────────────
  const formContent = showForm ? (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftWidth: 1 }]}>
      <Text style={[styles.formTitle, { color: colors.foreground }]}>New Gift Card</Text>

      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Services & Products *</Text>
      <Pressable
        onPress={() => setShowItemPicker(true)}
        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: "center" }]}
      >
        <Text style={{ color: selectedItemsSummary.length > 0 ? colors.foreground : colors.muted + "80", fontSize: fs.sm, lineHeight: 20 }} numberOfLines={1}>
          {selectedItemsSummary.length > 0 ? `${selectedItemsSummary.length} item${selectedItemsSummary.length > 1 ? "s" : ""} selected` : "Select services and/or products"}
        </Text>
      </Pressable>
      {selectedItemsSummary.length > 0 && (
        <View style={{ marginTop: 4, marginBottom: 4 }}>
          {selectedServiceIds.map((sid) => {
            const s = getServiceById(sid);
            if (!s) return null;
            return (
              <View key={sid} style={styles.selectedItemRow}>
                <View style={[styles.serviceColorDot, { backgroundColor: s.color }]} />
                <Text style={{ flex: 1, fontSize: fs.xs, color: colors.foreground }}>{s.name}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>${parseFloat(String(s.price)).toFixed(2)}</Text>
              </View>
            );
          })}
          {selectedProductIds.map((pid) => {
            const p = state.products.find((pr) => pr.id === pid);
            if (!p) return null;
            return (
              <View key={pid} style={styles.selectedItemRow}>
                <IconSymbol name="bag.fill" size={12} color={colors.primary} />
                <Text style={{ flex: 1, fontSize: fs.xs, color: colors.foreground, marginLeft: 4 }}>{p.name}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>${parseFloat(String(p.price)).toFixed(2)}</Text>
              </View>
            );
          })}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.primary }}>Total: ${totalValue.toFixed(2)}</Text>
          </View>
        </View>
      )}

      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Recipient Name</Text>
      <TextInput style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} value={recipientName} onChangeText={setRecipientName} placeholder="Optional" placeholderTextColor={colors.muted + "80"} />

      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Recipient Phone</Text>
      <TextInput style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} value={recipientPhone} onChangeText={handlePhoneInput} placeholder="(000) 000-0000" placeholderTextColor={colors.muted + "80"} keyboardType="phone-pad" maxLength={19} />

      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Personal Message</Text>
      <TextInput style={[styles.input, styles.multilineInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} value={message} onChangeText={setMessage} placeholder="Optional gift message" placeholderTextColor={colors.muted + "80"} multiline />

      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Banner Image (Optional)</Text>
      {bannerImageUri ? (
        <View style={{ marginBottom: 8 }}>
          <Image source={{ uri: bannerImageUri }} style={{ width: "100%", height: 140, borderRadius: 10, backgroundColor: colors.border }} contentFit="cover" />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Pressable onPress={pickBannerImage} style={({ pressed }) => [{ flex: 1, backgroundColor: colors.primary + "18", borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: colors.primary + "40" }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: colors.primary, fontWeight: "600", fontSize: fs.xs }}>Change</Text>
            </Pressable>
            <Pressable onPress={() => setBannerImageUri(undefined)} style={({ pressed }) => [{ paddingHorizontal: 16, backgroundColor: colors.error + "18", borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: colors.error + "40" }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: colors.error, fontWeight: "600", fontSize: fs.xs }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={pickBannerImage} style={({ pressed }) => [{ width: "100%", height: 80, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginBottom: 8, backgroundColor: colors.background }, pressed && { opacity: 0.7 }]}>
          {uploadingBanner ? <ActivityIndicator color={colors.primary} /> : (
            <View style={{ alignItems: "center", gap: 4 }}>
              <IconSymbol name="photo.fill" size={22} color={colors.muted} />
              <Text style={{ fontSize: fs.xs, color: colors.muted }}>Add Banner Image</Text>
            </View>
          )}
        </Pressable>
      )}

      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Expires In (days)</Text>
      <TextInput style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} value={expiresInDays} onChangeText={setExpiresInDays} keyboardType="number-pad" placeholder="30" placeholderTextColor={colors.muted + "80"} returnKeyType="done" />

      <View style={styles.formActions}>
        <Pressable onPress={resetForm} style={({ pressed }) => [styles.formBtnCancel, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}>
          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={handleCreate} style={({ pressed }) => [styles.formBtnSave, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}>
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>Create Gift Card</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  // ── Main Render ───────────────────────────────────────────────────────────
  return (
    <ScreenContainer tabletMaxWidth={900} edges={["top", "left", "right"]}>
      <FuturisticBackground />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground, marginLeft: 4 }]}>Gift Cards</Text>
        <Pressable
          onPress={() => { resetForm(); setShowForm(true); setMainTab("issued"); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
        >
          <IconSymbol name="plus" size={20} color="#fff" />
        </Pressable>
      </View>

      {/* Stats Row */}
      <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{totalActive}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Active</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.success }]}>{totalRedeemed}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Redeemed</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{issuedCards.length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Issued</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.warning }]}>{soldCards.length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Sold</Text>
        </View>
      </View>

      {/* Main Tab Switcher */}
      <View style={{ flexDirection: "row", marginHorizontal: hp, marginTop: 12, marginBottom: 0, backgroundColor: colors.surface, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.border }}>
        <Pressable
          onPress={() => setMainTab("issued")}
          style={({ pressed }) => [{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center", backgroundColor: mainTab === "issued" ? colors.primary : "transparent" }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: mainTab === "issued" ? "#fff" : colors.muted }}>
            🎁 Issued{issuedCards.length > 0 ? ` (${issuedCards.length})` : ""}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMainTab("sold")}
          style={({ pressed }) => [{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center", backgroundColor: mainTab === "sold" ? colors.primary : "transparent" }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: mainTab === "sold" ? "#fff" : colors.muted }}>
            🛍️ Sold{soldCards.length > 0 ? ` (${soldCards.length})` : ""}
          </Text>
        </Pressable>
      </View>

      {/* Buy a Gift Public Link Banner — only on Sold tab */}
      {mainTab === "sold" && buyGiftLink && (
        <View style={{ marginHorizontal: hp, marginTop: 12, marginBottom: 0, backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ fontSize: fs.md, marginRight: 8 }}>🎁</Text>
            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, flex: 1 }}>Client Gift Portal</Text>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 10, lineHeight: 17 }}>
            Share this link so clients can buy gifts for friends & family.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={handleCopyBuyGiftLink} style={({ pressed }) => [{ flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, alignItems: "center" }, pressed && { opacity: 0.75 }]}>
              <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>📋 Copy Link</Text>
            </Pressable>
            <Pressable onPress={handleShareBuyGiftLink} style={({ pressed }) => [{ flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", borderWidth: 1.5, borderColor: colors.primary }, pressed && { opacity: 0.75 }]}>
              <Text style={{ color: colors.primary, fontSize: fs.xs, fontWeight: "700" }}>📤 Share</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Filter Chips */}
      {mainTab === "issued" ? (
        <FilterChips active={issuedFilter} onChange={setIssuedFilter} counts={issuedCounts} colors={colors} fs={fs} />
      ) : (
        <FilterChips active={soldFilter} onChange={setSoldFilter} counts={soldCounts} colors={colors} fs={fs} />
      )}

      {/* Lists */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {mainTab === "issued" ? (
          filteredIssued.length === 0 && !showForm ? (
            <View style={styles.empty}>
              <IconSymbol name="gift.fill" size={48} color={colors.muted + "40"} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {issuedFilter === "all" ? "No Gift Cards Yet" : `No ${issuedFilter.charAt(0).toUpperCase() + issuedFilter.slice(1)} Cards`}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                {issuedFilter === "all" ? "Create gift cards with services and products that clients can share and redeem." : `No issued cards match the "${issuedFilter}" filter.`}
              </Text>
              {issuedFilter === "all" && (
                <Pressable onPress={() => setShowForm(true)} style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}>
                  <Text style={styles.emptyBtnText}>Create Gift Card</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              ref={issuedListRef}
              data={filteredIssued}
              keyExtractor={(item) => item.id}
              renderItem={renderCardRow}
              contentContainerStyle={{ paddingHorizontal: hp, paddingTop: 8, paddingBottom: 100, alignSelf: "center", width: "100%", maxWidth: maxContentWidth }}
              ListHeaderComponent={formContent}
              keyboardShouldPersistTaps="handled"
            />
          )
        ) : (
          filteredSold.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🛍️</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {soldFilter === "all" ? "No Client Purchases Yet" : `No ${soldFilter.charAt(0).toUpperCase() + soldFilter.slice(1)} Cards`}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                {soldFilter === "all" ? "Share the \"Buy a Gift\" link with clients so they can purchase gifts." : `No sold cards match the "${soldFilter}" filter.`}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={soldListRef}
              data={filteredSold}
              keyExtractor={(item) => item.id}
              renderItem={renderCardRow}
              contentContainerStyle={{ paddingHorizontal: hp, paddingTop: 8, paddingBottom: 100, alignSelf: "center", width: "100%", maxWidth: maxContentWidth }}
              keyboardShouldPersistTaps="handled"
            />
          )
        )}
      </KeyboardAvoidingView>

      {/* Edit Bottom Sheet */}
      <EditBottomSheet
        card={editCard}
        colors={colors}
        fs={fs}
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
        getCardItems={getCardItems}
        getCardTotal={getCardTotal}
      />

      {/* Item Picker Modal */}
      <Modal visible={showItemPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowItemPicker(false)}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select Items</Text>
              <Pressable onPress={() => setShowItemPicker(false)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                <IconSymbol name="xmark" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={[styles.segControl, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Pressable onPress={() => setPickerTab("services")} style={[styles.segBtn, pickerTab === "services" && { backgroundColor: colors.primary }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: pickerTab === "services" ? "#fff" : colors.muted }}>Services ({state.services.length})</Text>
              </Pressable>
              <Pressable onPress={() => setPickerTab("products")} style={[styles.segBtn, pickerTab === "products" && { backgroundColor: colors.primary }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: pickerTab === "products" ? "#fff" : colors.muted }}>Products ({availableProducts.length})</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              {pickerTab === "services" && (() => {
                const catMap = new Map<string, typeof state.services>();
                state.services.forEach((s) => { const cat = s.category?.trim() || "General"; if (!catMap.has(cat)) catMap.set(cat, []); catMap.get(cat)!.push(s); });
                const catEntries = Array.from(catMap.entries()).sort((a, b) => { if (a[0] === "General") return 1; if (b[0] === "General") return -1; return a[0].localeCompare(b[0]); });
                const hasMultiCat = catEntries.length > 1;
                return catEntries.map(([cat, svcs]) => (
                  <View key={cat}>
                    {hasMultiCat && <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary }} /><Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted }}>{cat}</Text></View>}
                    {svcs.map((item) => {
                      const isActive = selectedServiceIds.includes(item.id);
                      return (
                        <Pressable key={item.id} onPress={() => toggleService(item.id)} style={[styles.serviceOption, { backgroundColor: isActive ? colors.primary + "15" : "transparent", borderColor: isActive ? colors.primary : colors.border, marginLeft: hasMultiCat ? 4 : 0 }]}>
                          <View style={[styles.serviceColorDot, { backgroundColor: item.color }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>{item.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: fs.xs, lineHeight: 18 }}>${parseFloat(String(item.price)).toFixed(2)} · {item.duration} min</Text>
                          </View>
                          {isActive && <IconSymbol name="checkmark" size={18} color={colors.primary} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ));
              })()}
              {pickerTab === "products" && (() => {
                const brandMap = new Map<string, typeof availableProducts>();
                availableProducts.forEach((p) => { const br = p.brand?.trim() || "Other"; if (!brandMap.has(br)) brandMap.set(br, []); brandMap.get(br)!.push(p); });
                const brandEntries = Array.from(brandMap.entries()).sort((a, b) => { if (a[0] === "Other") return 1; if (b[0] === "Other") return -1; return a[0].localeCompare(b[0]); });
                const hasMultiBrand = brandEntries.length > 1;
                return brandEntries.map(([brand, prods]) => (
                  <View key={brand}>
                    {hasMultiBrand && <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.warning }} /><Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted }}>{brand}</Text></View>}
                    {prods.map((item) => {
                      const isActive = selectedProductIds.includes(item.id);
                      return (
                        <Pressable key={item.id} onPress={() => toggleProduct(item.id)} style={[styles.serviceOption, { backgroundColor: isActive ? colors.primary + "15" : "transparent", borderColor: isActive ? colors.primary : colors.border, marginLeft: hasMultiBrand ? 4 : 0 }]}>
                          <IconSymbol name="bag.fill" size={16} color={colors.primary} />
                          <View style={{ flex: 1, marginLeft: 4 }}>
                            <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>{item.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: fs.xs, lineHeight: 18 }}>${parseFloat(String(item.price)).toFixed(2)}{item.brand ? ` · ${item.brand}` : ""}</Text>
                          </View>
                          {isActive && <IconSymbol name="checkmark" size={18} color={colors.primary} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ));
              })()}
              {pickerTab === "services" && state.services.length === 0 && <Text style={{ color: colors.muted, textAlign: "center", padding: 20, fontSize: fs.sm }}>No services available.</Text>}
              {pickerTab === "products" && availableProducts.length === 0 && <Text style={{ color: colors.muted, textAlign: "center", padding: 20, fontSize: fs.sm }}>No products available.</Text>}
            </ScrollView>
            <Pressable onPress={() => setShowItemPicker(false)} style={({ pressed }) => [styles.formBtnSave, { backgroundColor: colors.primary, marginTop: 12 }, pressed && { opacity: 0.8 }]}>
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>Done ({selectedServiceIds.length + selectedProductIds.length} selected)</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5, gap: 12, width: "100%" },
  headerTitle: { fontSize: 17, fontWeight: "700", flex: 1, lineHeight: 26 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, width: "100%" },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 17, fontWeight: "800", lineHeight: 28 },
  statLabel: { fontSize: 11, marginTop: 2, lineHeight: 16 },
  statDivider: { width: 1, marginVertical: 4 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "700", lineHeight: 26 },
  emptySubtitle: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, marginTop: 8, minHeight: 44, alignItems: "center", justifyContent: "center" },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, lineHeight: 20 },
  card: { borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, width: "100%" },
  formTitle: { fontSize: 15, fontWeight: "700", marginBottom: 16, lineHeight: 24 },
  fieldLabel: { fontSize: 11, fontWeight: "500", marginBottom: 6, marginTop: 8 },
  input: { width: "100%", height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 13, lineHeight: 20, marginBottom: 4 },
  multilineInput: { height: 80, textAlignVertical: "top", paddingTop: 12 },
  formActions: { flexDirection: "row", gap: 10, marginTop: 12, width: "100%" },
  formBtnCancel: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
  formBtnSave: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44 },
  selectedItemRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  segControl: { flexDirection: "row", borderRadius: 10, borderWidth: 1, padding: 3, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 40, paddingHorizontal: 20, width: "100%", maxWidth: 560, alignSelf: "center" as const },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, width: "100%" },
  modalTitle: { fontSize: 15, fontWeight: "700", lineHeight: 24 },
  serviceOption: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, gap: 12, marginBottom: 4 },
  serviceColorDot: { width: 12, height: 12, borderRadius: 6 },
  bottomSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 40, paddingHorizontal: 20, width: "100%", maxWidth: 560, alignSelf: "center" as const },
});
