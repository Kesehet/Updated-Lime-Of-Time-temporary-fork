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
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
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


function generateGiftCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `GIFT-${code}`;
}

// ─── Public Gift Card Component ─────────────────────────────────────────────
function PublicGiftCard({
  card, colors, onMarkPaid, getCardItems, getCardTotal,
}: {
  card: GiftCard;
  colors: any;
  onMarkPaid: (card: GiftCard) => void;
  getCardItems: (card: GiftCard) => Array<{ name: string; price: string; type: string }>;
  getCardTotal: (card: GiftCard) => number;
}) {
  const { fs } = useResponsive();
  const items = getCardItems(card);
  const total = getCardTotal(card);
  const isPaid = (card as any).paymentStatus === "paid";
  const isRedeemed = card.redeemed;
  const paymentMethod = (card as any).paymentMethod ?? "cash";
  const paymentMethodLabel: Record<string, string> = {
    zelle: "Zelle", venmo: "Venmo", cashapp: "Cash App", cash: "Cash", card: "Card",
  };
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
      borderWidth: 1, borderColor: colors.border,
      borderLeftWidth: 3, borderLeftColor: isRedeemed ? colors.muted : isPaid ? colors.success : colors.warning,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>
            {(card as any).purchaserName ?? "Unknown"} → {card.recipientName ?? "Recipient"}
          </Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>{card.code}</Text>
        </View>
        <View style={{
          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
          backgroundColor: isRedeemed ? colors.muted + "30" : isPaid ? colors.success + "20" : colors.warning + "20",
        }}>
          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isRedeemed ? colors.muted : isPaid ? colors.success : colors.warning }}>
            {isRedeemed ? "Redeemed" : isPaid ? "Paid" : "Awaiting Payment"}
          </Text>
        </View>
      </View>
      {items.map((it, idx) => (
        <Text key={idx} style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 2 }}>
          {it.type === "product" ? "📦" : "✂️"} {it.name} — {it.price}
        </Text>
      ))}
      {total > 0 && (
        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary, marginTop: 4 }}>
          Total: ${total.toFixed(2)}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
        {(card as any).purchaserEmail ? (
          <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }} numberOfLines={1}>
            From: {(card as any).purchaserEmail}
          </Text>
        ) : null}
        {(card as any).recipientEmail ? (
          <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }} numberOfLines={1}>
            To: {(card as any).recipientEmail}
          </Text>
        ) : null}
      </View>
      {card.message ? (
        <Text style={{ fontSize: fs.xs, color: colors.muted, fontStyle: "italic", marginTop: 6 }} numberOfLines={2}>
          "{card.message}"
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 }}>
        <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }}>
          {paymentMethodLabel[paymentMethod] ?? paymentMethod}
          {card.expiresAt ? ` · Expires ${new Date(card.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
        </Text>
        {!isRedeemed && (
          <Pressable
            onPress={() => onMarkPaid(card)}
            style={({ pressed }) => [{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
              backgroundColor: isPaid ? colors.warning + "20" : colors.success + "20",
            }, pressed && { opacity: 0.7 }]}
          >
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isPaid ? colors.warning : colors.success }}>
              {isPaid ? "Mark Unpaid" : "Mark as Paid"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function GiftCardsScreen() {
  const { state, dispatch, syncToDb, getServiceById } = useStore();
  const buyGiftLink = state.settings?.customSlug
    ? `${PUBLIC_BOOKING_URL}/api/book/${state.settings.customSlug}`
    : null;
  const publicGiftCards = state.giftCards.filter(c => (c as any).purchasedPublicly);
  const publicPendingPayment = publicGiftCards.filter(c => (c as any).paymentStatus !== "paid" && !c.redeemed);
  const publicPaid = publicGiftCards.filter(c => (c as any).paymentStatus === "paid" && !c.redeemed);
  const publicRedeemed = publicGiftCards.filter(c => c.redeemed);
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, fs, buttonHeight, iconButtonSize } = useResponsive();

  const [showForm, setShowForm] = useState(false);
  const [giftCreateMode, setGiftCreateMode] = useState<"items" | "balance">("items");
  const [balanceAmount, setBalanceAmount] = useState("");
  const PRESET_AMOUNTS = [25, 50, 100, 200];
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [message, setMessage] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(String(state.settings.giftValidDays ?? 90));
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<"services" | "products">("services");
  const [mainTab, setMainTab] = useState<"my" | "public">("my");
  const markAsPaidMut = trpc.giftCards.markAsPaid.useMutation();

  const resetForm = useCallback(() => {
    setSelectedServiceIds([]);
    setSelectedProductIds([]);
    setRecipientName("");
    setRecipientPhone("");
    setMessage("");
    setExpiresInDays(String(state.settings.giftValidDays ?? 90));
    setGiftCreateMode("items");
    setBalanceAmount("");
    setShowForm(false);
  }, [state.settings.giftValidDays]);

  // Calculate total value of selected items
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

  const handleShareBuyGiftLink = useCallback(async () => {
    if (!buyGiftLink) return;
    try {
      await Share.share({ message: `Buy a gift for someone special at our salon! ${buyGiftLink}`, url: buyGiftLink });
    } catch {}
  }, [buyGiftLink]);

  const handleCopyBuyGiftLink = useCallback(async () => {
    if (!buyGiftLink) return;
    await Clipboard.setStringAsync(buyGiftLink);
    Alert.alert("Copied!", "The buy-a-gift link has been copied to your clipboard.");
  }, [buyGiftLink]);

  const handleMarkAsPaid = useCallback(async (card: GiftCard) => {
    const newStatus = (card as any).paymentStatus === "paid" ? "unpaid" : "paid";
    try {
      await markAsPaidMut.mutateAsync({
        localId: card.id,
        businessOwnerId: state.businessOwnerId ?? 0,
        paymentStatus: newStatus as "paid" | "unpaid" | "pending_cash",
      });
      dispatch({ type: "UPDATE_GIFT_CARD", payload: { ...card, paymentStatus: newStatus } as any });
      Alert.alert("Updated", newStatus === "paid" ? "Gift marked as paid." : "Gift marked as unpaid.");
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to update payment status.");
    }
  }, [markAsPaidMut, state.businessOwnerId, dispatch]);

  const handleCreate = useCallback(() => {
    if (giftCreateMode === "items" && selectedServiceIds.length === 0 && selectedProductIds.length === 0) {
      Alert.alert("Required", "Please select at least one service or product for this gift card.");
      return;
    }
    if (giftCreateMode === "balance") {
      const amt = parseFloat(balanceAmount);
      if (isNaN(amt) || amt <= 0) {
        Alert.alert("Required", "Please enter a valid balance amount.");
        return;
      }
    }

    const days = parseInt(expiresInDays, 10);
    const expiresAt =
      !isNaN(days) && days > 0
        ? new Date(Date.now() + days * 86400000).toISOString().split("T")[0]
        : undefined;

    const cardValue = giftCreateMode === "balance" ? parseFloat(balanceAmount) : totalValue;

    const newCard: GiftCard = {
      id: generateId(),
      code: generateGiftCode(),
      serviceLocalId: giftCreateMode === "items" ? (selectedServiceIds[0] || "") : "",
      serviceIds: giftCreateMode === "items" ? selectedServiceIds : [],
      productIds: giftCreateMode === "items" ? selectedProductIds : [],
      originalValue: cardValue,
      remainingBalance: cardValue,
      recipientName: recipientName.trim(),
      recipientPhone: recipientPhone.trim(),
      message: message.trim(),
      redeemed: false,
      expiresAt,
      createdAt: new Date().toISOString(),
      ...(giftCreateMode === "balance" ? { isBalanceCard: true, balanceAmount: cardValue } : {}),
    } as GiftCard;

    dispatch({ type: "ADD_GIFT_CARD", payload: newCard });
    syncToDb({ type: "ADD_GIFT_CARD", payload: newCard });
    resetForm();
  }, [giftCreateMode, balanceAmount, selectedServiceIds, selectedProductIds, recipientName, recipientPhone, message, expiresInDays, totalValue, dispatch, syncToDb, resetForm]);

  const handleRedeem = useCallback(
    (card: GiftCard) => {
      Alert.alert("Redeem Gift Card", `Mark gift card ${card.code} as redeemed?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Redeem",
          onPress: () => {
            const updated: GiftCard = { ...card, redeemed: true, redeemedAt: new Date().toISOString() };
            dispatch({ type: "UPDATE_GIFT_CARD", payload: updated });
            syncToDb({ type: "UPDATE_GIFT_CARD", payload: updated });
          },
        },
      ]);
    },
    [dispatch, syncToDb]
  );

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert("Delete Gift Card", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            dispatch({ type: "DELETE_GIFT_CARD", payload: id });
            syncToDb({ type: "DELETE_GIFT_CARD", payload: id });
          },
        },
      ]);
    },
    [dispatch, syncToDb]
  );

  const handleCopyCode = useCallback(async (code: string) => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(code);
      } else {
        await Clipboard.setStringAsync(code);
      }
      Alert.alert("Copied", `Gift code ${code} copied to clipboard.`);
    } catch {
      Alert.alert("Code", code);
    }
  }, []);

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
      // For old single-service cards with no serviceIds, try serviceLocalId directly
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
      // Use stored originalValue first (reliable), fall back to catalog lookup
      if (card.originalValue != null && card.originalValue > 0) {
        return card.originalValue;
      }
      // Fallback: recalculate from catalog for old cards without stored value
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
      // For old single-service cards with no serviceIds, try serviceLocalId directly
      if (total === 0 && card.serviceLocalId) {
        const s = getServiceById(card.serviceLocalId);
        if (s) total = parseFloat(String(s.price));
      }
      return total;
    },
    [getServiceById, state.products]
  );

  const handleSendGiftSMS = useCallback((card: GiftCard) => {
    const items = getCardItems(card);
    const total = getCardTotal(card);
    const businessName = state.settings.businessName || "Our Business";
    const itemList = items.map((i) => `${i.name} (${i.price})`).join(", ");
    const expiryText = card.expiresAt
      ? `\nThis gift card expires on ${new Date(card.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
      : "";
    const personalMsg = card.message ? `\n\n"${card.message}"` : "";
    const giftUrl = `${PUBLIC_BOOKING_URL}/gift/${card.code}`;
    const body = `🎁 You've received a Gift Card from ${businessName}!\n\nIncludes: ${itemList}\nTotal Value: $${total.toFixed(2)}\nGift Code: ${card.code}${personalMsg}${expiryText}\n\nRedeem here: ${giftUrl}\n\n— ${businessName}`;
    const phone = card.recipientPhone ? stripPhoneFormat(card.recipientPhone) : "";
    const smsUrl = Platform.OS === "ios"
      ? `sms:${phone}&body=${encodeURIComponent(body)}`
      : `sms:${phone}?body=${encodeURIComponent(body)}`;
    Linking.openURL(smsUrl).catch(() => {
      Alert.alert("Error", "Could not open messaging app.");
    });
  }, [getCardItems, getCardTotal, state.settings.businessName]);

  const handlePhoneInput = useCallback((text: string) => {
    setRecipientPhone(formatPhoneNumber(text));
  }, []);

  const toggleService = useCallback((id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }, []);

  const toggleProduct = useCallback((id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }, []);

  const sortedCards = useMemo(
    () => [...state.giftCards].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.giftCards]
  );
  const activeCards = useMemo(() => sortedCards.filter((c) => !c.redeemed), [sortedCards]);
  const redeemedCards = useMemo(() => sortedCards.filter((c) => c.redeemed), [sortedCards]);
  const allCards = useMemo(() => [...activeCards, ...redeemedCards], [activeCards, redeemedCards]);

  const availableProducts = useMemo(
    () => state.products.filter((p) => p.available),
    [state.products]
  );

  const renderCard = useCallback(
    ({ item }: { item: GiftCard }) => {
      const items = getCardItems(item);
      const total = getCardTotal(item);
      const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date();
      const primaryService = getServiceById(item.serviceLocalId);

      return (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: item.redeemed ? colors.muted + "40" : primaryService?.color ?? colors.primary,
              borderLeftWidth: 4,
              opacity: item.redeemed ? 0.7 : 1,
            },
          ]}
        >
          {/* Code + Badge */}
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.codeRow}>
                <Text style={[styles.codeText, { color: colors.foreground }]}>{item.code}</Text>
                {!item.redeemed && (
                  <Pressable onPress={() => handleCopyCode(item.code)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="doc.text.fill" size={16} color={colors.primary} />
                  </Pressable>
                )}
              </View>
              {/* Balance card badge */}
              {(item as any).isBalanceCard ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 6 }}>
                  <Text style={{ fontSize: fs.lg, fontWeight: "800", color: colors.primary }}>
                    ${(item.remainingBalance ?? item.originalValue ?? 0).toFixed(2)}
                  </Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>balance card</Text>
                </View>
              ) : (
                <>
                  {/* Items list */}
                  {items.map((it, idx) => (
                    <Text key={idx} style={[styles.serviceName, { color: colors.muted }]}>
                      {it.type === "product" ? "📦 " : "✂️ "}{it.name} — {it.price}
                    </Text>
                  ))}
                  {total > 0 && (
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary, marginTop: 4 }}>
                      Value: ${total.toFixed(2)}
                    </Text>
                  )}
                  {!item.redeemed && item.remainingBalance != null && item.remainingBalance < total && (
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.success, marginTop: 2 }}>
                      Balance: ${item.remainingBalance.toFixed(2)}
                    </Text>
                  )}
                </>
              )}
            </View>
            <View style={[styles.badge, { backgroundColor: item.redeemed ? colors.success + "20" : isExpired ? colors.error + "20" : colors.primary + "20" }]}>
              <Text style={[styles.badgeText, { color: item.redeemed ? colors.success : isExpired ? colors.error : colors.primary }]}>
                {item.redeemed ? "Redeemed" : isExpired ? "Expired" : (item.remainingBalance != null && item.remainingBalance < (item.originalValue ?? total)) ? "Partially Used" : "Active"}
              </Text>
            </View>
          </View>

          {/* Recipient */}
          {(item.recipientName || item.recipientPhone) && (
            <View style={styles.detailRow}>
              <IconSymbol name="person.fill" size={14} color={colors.muted} />
              <Text style={[styles.detailText, { color: colors.muted }]}>
                {item.recipientName}{item.recipientPhone ? ` (${item.recipientPhone})` : ""}
              </Text>
            </View>
          )}

          {/* Message */}
          {item.message ? (
            <Text style={[styles.messageText, { color: colors.muted }]} numberOfLines={2}>
              &ldquo;{item.message}&rdquo;
            </Text>
          ) : null}

          {/* Footer */}
          <View style={styles.cardFooter}>
            <Text style={[styles.dateText, { color: colors.muted }]}>
              Created {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
            </Text>
            <View style={styles.cardActions}>
              {!item.redeemed && !isExpired && (
                <>
                  <Pressable
                    onPress={() => handleSendGiftSMS(item)}
                    style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary + "15" }, pressed && { opacity: 0.7 }]}
                  >
                    <IconSymbol name="paperplane.fill" size={14} color={colors.primary} />
                    <Text style={[styles.actionText, { color: colors.primary }]}>Send</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleRedeem(item)}
                    style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.success + "15" }, pressed && { opacity: 0.7 }]}
                  >
                    <IconSymbol name="checkmark" size={14} color={colors.success} />
                    <Text style={[styles.actionText, { color: colors.success }]}>Redeem</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                onPress={() => handleDelete(item.id)}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.error + "15" }, pressed && { opacity: 0.7 }]}
              >
                <IconSymbol name="trash.fill" size={14} color={colors.error} />
              </Pressable>
            </View>
          </View>
        </View>
      );
    },
    [colors, getCardItems, getCardTotal, getServiceById, handleRedeem, handleDelete, handleCopyCode, handleSendGiftSMS]
  );

  const selectedItemsSummary = useMemo(() => {
    const items: string[] = [];
    for (const sid of selectedServiceIds) {
      const s = getServiceById(sid);
      if (s) items.push(s.name);
    }
    for (const pid of selectedProductIds) {
      const p = state.products.find((pr) => pr.id === pid);
      if (p) items.push(p.name);
    }
    return items;
  }, [selectedServiceIds, selectedProductIds, getServiceById, state.products]);

  const formContent = showForm ? (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftWidth: 1 }]}>
      <Text style={[styles.formTitle, { color: colors.foreground }]}>New Gift Card</Text>

      {/* Mode Toggle */}
      <View style={{ flexDirection: "row", backgroundColor: colors.background, borderRadius: 10, padding: 3, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
        {(["items", "balance"] as const).map((mode) => (
          <Pressable
            key={mode}
            onPress={() => setGiftCreateMode(mode)}
            style={({ pressed }) => [{
              flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
              backgroundColor: giftCreateMode === mode ? colors.primary : "transparent",
            }, pressed && { opacity: 0.8 }]}
          >
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: giftCreateMode === mode ? "#fff" : colors.muted }}>
              {mode === "items" ? "Services & Products" : "Balance Card"}
            </Text>
          </Pressable>
        ))}
      </View>

      {giftCreateMode === "items" ? (
        <>
          {/* Services & Products */}
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>Services & Products *</Text>
          <Pressable
            onPress={() => setShowItemPicker(true)}
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: "center" }]}
          >
            <Text
              style={{ color: selectedItemsSummary.length > 0 ? colors.foreground : colors.muted + "80", fontSize: fs.sm, lineHeight: 20 }}
              numberOfLines={1}
            >
              {selectedItemsSummary.length > 0
                ? `${selectedItemsSummary.length} item${selectedItemsSummary.length > 1 ? "s" : ""} selected`
                : "Select services and/or products"}
            </Text>
          </Pressable>

          {/* Selected items preview */}
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
        </>
      ) : (
        <>
          {/* Balance Amount */}
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>Gift Card Amount *</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {PRESET_AMOUNTS.map((amt) => {
              const isSelected = balanceAmount === String(amt);
              return (
                <Pressable
                  key={amt}
                  onPress={() => setBalanceAmount(String(amt))}
                  style={({ pressed }) => [{
                    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
                    borderColor: isSelected ? colors.primary : colors.border,
                    backgroundColor: isSelected ? colors.primary + "20" : colors.background,
                  }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: isSelected ? colors.primary : colors.foreground }}>${amt}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>Custom Amount</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
            value={PRESET_AMOUNTS.includes(Number(balanceAmount)) ? "" : balanceAmount}
            onChangeText={(v) => setBalanceAmount(v.replace(/[^0-9.]/g, ""))}
            placeholder="Enter custom amount (e.g. 75)"
            placeholderTextColor={colors.muted + "80"}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          {balanceAmount && !isNaN(parseFloat(balanceAmount)) && parseFloat(balanceAmount) > 0 && (
            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.primary }}>Card Value: ${parseFloat(balanceAmount).toFixed(2)}</Text>
            </View>
          )}
        </>
      )}

      {/* Recipient Name */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Recipient Name</Text>
      <TextInput
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
        value={recipientName}
        onChangeText={setRecipientName}
        placeholder="Optional"
        placeholderTextColor={colors.muted + "80"}
      />

      {/* Recipient Phone */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Recipient Phone</Text>
      <TextInput
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
        value={recipientPhone}
        onChangeText={handlePhoneInput}
        placeholder="(000) 000-0000"
        placeholderTextColor={colors.muted + "80"}
        keyboardType="phone-pad"
        maxLength={19}
      />

      {/* Personal Message */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Personal Message</Text>
      <TextInput
        style={[styles.input, styles.multilineInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
        value={message}
        onChangeText={setMessage}
        placeholder="Optional gift message"
        placeholderTextColor={colors.muted + "80"}
        multiline
      />

      {/* Expires In */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Expires In (days)</Text>
      <TextInput
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
        value={expiresInDays}
        onChangeText={setExpiresInDays}
        keyboardType="number-pad"
        placeholder="30"
        placeholderTextColor={colors.muted + "80"}
      />

      {/* Actions */}
      <View style={styles.formActions}>
        <Pressable
          onPress={resetForm}
          style={({ pressed }) => [styles.formBtnCancel, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleCreate}
          style={({ pressed }) => [styles.formBtnSave, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>Create Gift Card</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  return (
    <ScreenContainer tabletMaxWidth={900} edges={["top", "left", "right"]}>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerBackBtn, pressed && { opacity: 0.6 }]}>
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Gift Cards</Text>
        <Pressable
          onPress={() => { resetForm(); setShowForm(true); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
        >
          <IconSymbol name="plus" size={20} color="#fff" />
        </Pressable>
      </View>

      {/* Stats Row */}
      <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{activeCards.length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Active</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.success }]}>{redeemedCards.length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Redeemed</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{state.giftCards.length}</Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Total</Text>
        </View>
      </View>

      {/* Main Tab Switcher */}
      <View style={{ flexDirection: "row", marginHorizontal: hp, marginTop: 12, marginBottom: 4, backgroundColor: colors.surface, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.border }}>
        <Pressable
          onPress={() => setMainTab("my")}
          style={({ pressed }) => [{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: mainTab === "my" ? colors.primary : "transparent" }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: mainTab === "my" ? "#fff" : colors.muted }}>🎁 My Gift Cards</Text>
        </Pressable>
        <Pressable
          onPress={() => setMainTab("public")}
          style={({ pressed }) => [{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: mainTab === "public" ? colors.primary : "transparent" }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: mainTab === "public" ? "#fff" : colors.muted }}>
            🛍️ Client Purchases{publicGiftCards.length > 0 ? ` (${publicGiftCards.length})` : ""}
          </Text>
        </Pressable>
      </View>
      {/* Buy a Gift Public Link Banner */}
      {buyGiftLink && (
        <View style={{ marginHorizontal: hp, marginTop: 14, marginBottom: 4, backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <Text style={{ fontSize: fs.md, marginRight: 8 }}>🎁</Text>
            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, flex: 1 }}>Client Gift Portal</Text>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 10, lineHeight: 17 }}>
            Share this link so clients can buy gifts for friends & family. They pick services, pay, and the recipient gets a redemption link.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={handleCopyBuyGiftLink}
              style={({ pressed }) => [{ flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, alignItems: "center" }, pressed && { opacity: 0.75 }]}
            >
              <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>📋 Copy Link</Text>
            </Pressable>
            <Pressable
              onPress={handleShareBuyGiftLink}
              style={({ pressed }) => [{ flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", borderWidth: 1.5, borderColor: colors.primary }, pressed && { opacity: 0.75 }]}
            >
              <Text style={{ color: colors.primary, fontSize: fs.xs, fontWeight: "700" }}>📤 Share</Text>
            </Pressable>
          </View>
        </View>
      )}
      {mainTab === "my" ? (
        allCards.length === 0 && !showForm ? (
          <View style={styles.empty}>
            <IconSymbol name="gift.fill" size={48} color={colors.muted + "40"} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Gift Cards Yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              Create gift cards with services and products that clients can share and redeem.
            </Text>
            <Pressable
              onPress={() => setShowForm(true)}
              style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.emptyBtnText}>Create Gift Card</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <FlatList
            data={allCards}
            keyExtractor={(item) => item.id}
            renderItem={renderCard}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: hp, paddingTop: 16, paddingBottom: 100 }}
            ListHeaderComponent={formContent}
          />
          </KeyboardAvoidingView>
        )
      ) : (
        /* Public Gifts Tab */
        publicGiftCards.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🛍️</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Client Purchases Yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              Share the "Buy a Gift" link with clients so they can purchase gifts for friends and family.
            </Text>
          </View>
        ) : (
                <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView contentContainerStyle={{ paddingHorizontal: hp, paddingTop: 12, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
            {/* Pending Payment Section */}
            {publicPendingPayment.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning, marginRight: 8 }} />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.warning }}>
                    Awaiting Payment ({publicPendingPayment.length})
                  </Text>
                </View>
                {publicPendingPayment.map((card) => (
                  <PublicGiftCard key={card.id} card={card} colors={colors} onMarkPaid={handleMarkAsPaid} getCardItems={getCardItems} getCardTotal={getCardTotal} />
                ))}
              </View>
            )}
            {/* Paid / Active Section */}
            {publicPaid.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success, marginRight: 8 }} />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.success }}>
                    Paid — Awaiting Redemption ({publicPaid.length})
                  </Text>
                </View>
                {publicPaid.map((card) => (
                  <PublicGiftCard key={card.id} card={card} colors={colors} onMarkPaid={handleMarkAsPaid} getCardItems={getCardItems} getCardTotal={getCardTotal} />
                ))}
              </View>
            )}
            {/* Redeemed Section */}
            {publicRedeemed.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted, marginRight: 8 }} />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted }}>
                    Redeemed ({publicRedeemed.length})
                  </Text>
                </View>
                {publicRedeemed.map((card) => (
                  <PublicGiftCard key={card.id} card={card} colors={colors} onMarkPaid={handleMarkAsPaid} getCardItems={getCardItems} getCardTotal={getCardTotal} />
                ))}
              </View>
            )}
          </ScrollView>
      </KeyboardAvoidingView>
        )
      )}

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

            {/* Tabs */}
            <View style={[styles.segControl, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Pressable
                onPress={() => setPickerTab("services")}
                style={[styles.segBtn, pickerTab === "services" && { backgroundColor: colors.primary }]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: pickerTab === "services" ? "#fff" : colors.muted }}>
                  Services ({state.services.length})
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPickerTab("products")}
                style={[styles.segBtn, pickerTab === "products" && { backgroundColor: colors.primary }]}
              >
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: pickerTab === "products" ? "#fff" : colors.muted }}>
                  Products ({availableProducts.length})
                </Text>
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 340 }}>
              {/* Services grouped by category */}
              {pickerTab === "services" && (() => {
                const catMap = new Map<string, typeof state.services>();
                state.services.forEach((s) => {
                  const cat = s.category?.trim() || "General";
                  if (!catMap.has(cat)) catMap.set(cat, []);
                  catMap.get(cat)!.push(s);
                });
                const catEntries = Array.from(catMap.entries()).sort((a, b) => {
                  if (a[0] === "General") return 1;
                  if (b[0] === "General") return -1;
                  return a[0].localeCompare(b[0]);
                });
                const hasMultiCat = catEntries.length > 1;
                return catEntries.map(([cat, svcs]) => (
                  <View key={cat}>
                    {hasMultiCat && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary }} />
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted }}>{cat}</Text>
                      </View>
                    )}
                    {svcs.map((item) => {
                      const isActive = selectedServiceIds.includes(item.id);
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => toggleService(item.id)}
                          style={[styles.serviceOption, { backgroundColor: isActive ? colors.primary + "15" : "transparent", borderColor: isActive ? colors.primary : colors.border, marginLeft: hasMultiCat ? 4 : 0 }]}
                        >
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
              {/* Products grouped by brand */}
              {pickerTab === "products" && (() => {
                const brandMap = new Map<string, typeof availableProducts>();
                availableProducts.forEach((p) => {
                  const br = p.brand?.trim() || "Other";
                  if (!brandMap.has(br)) brandMap.set(br, []);
                  brandMap.get(br)!.push(p);
                });
                const brandEntries = Array.from(brandMap.entries()).sort((a, b) => {
                  if (a[0] === "Other") return 1;
                  if (b[0] === "Other") return -1;
                  return a[0].localeCompare(b[0]);
                });
                const hasMultiBrand = brandEntries.length > 1;
                return brandEntries.map(([brand, prods]) => (
                  <View key={brand}>
                    {hasMultiBrand && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.warning }} />
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted }}>{brand}</Text>
                      </View>
                    )}
                    {prods.map((item) => {
                      const isActive = selectedProductIds.includes(item.id);
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => toggleProduct(item.id)}
                          style={[styles.serviceOption, { backgroundColor: isActive ? colors.primary + "15" : "transparent", borderColor: isActive ? colors.primary : colors.border, marginLeft: hasMultiBrand ? 4 : 0 }]}
                        >
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
              {pickerTab === "services" && state.services.length === 0 && (
                <Text style={{ color: colors.muted, textAlign: "center", padding: 20, fontSize: fs.sm }}>No services available.</Text>
              )}
              {pickerTab === "products" && availableProducts.length === 0 && (
                <Text style={{ color: colors.muted, textAlign: "center", padding: 20, fontSize: fs.sm }}>No products available.</Text>
              )}
            </ScrollView>

            <Pressable
              onPress={() => setShowItemPicker(false)}
              style={({ pressed }) => [styles.formBtnSave, { backgroundColor: colors.primary, marginTop: 12 }, pressed && { opacity: 0.8 }]}
            >
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>
                Done ({selectedServiceIds.length + selectedProductIds.length} selected)
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    gap: 12,
    width: "100%",
  },
  headerBackBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700", flex: 1, lineHeight: 26 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    width: "100%",
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 17, fontWeight: "800", lineHeight: 28 },
  statLabel: { fontSize: 11, marginTop: 2, lineHeight: 16 },
  statDivider: { width: 1, marginVertical: 4 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", lineHeight: 26 },
  emptySubtitle: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, lineHeight: 20 },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    width: "100%",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
    width: "100%",
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  codeText: { fontSize: 15, fontWeight: "800", letterSpacing: 1, lineHeight: 22 },
  serviceName: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, width: "100%" },
  detailText: { fontSize: 11, lineHeight: 18, flex: 1 },
  messageText: { fontSize: 11, fontStyle: "italic", marginBottom: 8, lineHeight: 18 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#E5E7EB",
    width: "100%",
  },
  dateText: { fontSize: 11, lineHeight: 16, flex: 1 },
  cardActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 36,
  },
  actionText: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  formTitle: { fontSize: 15, fontWeight: "700", marginBottom: 16, lineHeight: 24 },
  fieldLabel: { fontSize: 11, fontWeight: "500", marginBottom: 6, marginTop: 8 },
  input: {
    width: "100%",
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  multilineInput: {
    height: 80,
    textAlignVertical: "top",
    paddingTop: 12,
  },
  formActions: { flexDirection: "row", gap: 10, marginTop: 12, width: "100%" },
  formBtnCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  formBtnSave: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  selectedItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  segControl: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    marginBottom: 12,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 40,
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center' as const,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    width: "100%",
  },
  modalTitle: { fontSize: 15, fontWeight: "700", lineHeight: 24 },
  serviceOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginBottom: 4,
  },
  serviceColorDot: { width: 12, height: 12, borderRadius: 6 },
});
