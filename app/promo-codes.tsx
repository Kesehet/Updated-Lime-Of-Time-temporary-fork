import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Switch,
  Share,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { PromoCode } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { FuturisticBackground } from "@/components/futuristic-background";
import { BirthdayPicker } from "@/components/birthday-picker";


// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(prefix?: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return prefix ? `${prefix.toUpperCase().replace(/\s+/g, "").slice(0, 6)}${code}` : code;
}

function formatDiscount(pc: PromoCode): string {
  if (pc.percentage > 0) return `${pc.percentage}% off`;
  if (pc.flatAmount && pc.flatAmount > 0) return `$${pc.flatAmount.toFixed(2)} off`;
  return "No discount";
}

function isExpired(pc: PromoCode): boolean {
  if (!pc.expiresAt) return false;
  return pc.expiresAt < new Date().toISOString().slice(0, 10);
}
function isLimitReached(pc: PromoCode): boolean {
  return !!(pc.maxUses && pc.maxUses > 0 && pc.usedCount >= pc.maxUses);
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PromoCodesScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const promoCodes = state.promoCodes ?? [];

  // Auto-deactivate promo codes that have reached their limit or expired
  useEffect(() => {
    promoCodes.forEach((pc) => {
      if (pc.active && (isExpired(pc) || isLimitReached(pc))) {
        const updated = { ...pc, active: false };
        dispatch({ type: "UPDATE_PROMO_CODE", payload: updated });
        syncToDb({ type: "UPDATE_PROMO_CODE", payload: updated });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [percentage, setPercentage] = useState("10");
  const [flatAmount, setFlatAmount] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [active, setActive] = useState(true);

  const resetForm = useCallback(() => {
    setLabel("");
    setCode(generateCode());
    setPercentage("10");
    setFlatAmount("");
    setDiscountType("percent");
    setMaxUses("");
    setExpiresAt("");
    setActive(true);
    setEditingId(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setCode(generateCode());
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((pc: PromoCode) => {
    setLabel(pc.label);
    setCode(pc.code);
    if (pc.percentage > 0) {
      setDiscountType("percent");
      setPercentage(String(pc.percentage));
      setFlatAmount("");
    } else {
      setDiscountType("flat");
      setFlatAmount(pc.flatAmount ? String(pc.flatAmount) : "");
      setPercentage("0");
    }
    setMaxUses(pc.maxUses != null ? String(pc.maxUses) : "");
    setExpiresAt(pc.expiresAt ?? "");
    setActive(pc.active);
    setEditingId(pc.id);
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!label.trim()) {
      Alert.alert("Missing Label", "Please enter a label for this promo code.");
      return;
    }
    if (!code.trim()) {
      Alert.alert("Missing Code", "Please enter a promo code.");
      return;
    }
    const upperCode = code.toUpperCase().replace(/\s+/g, "");
    // Check for duplicate code (excluding current edit)
    const duplicate = promoCodes.find(
      (p) => p.code === upperCode && p.id !== editingId
    );
    if (duplicate) {
      Alert.alert("Duplicate Code", `The code "${upperCode}" already exists. Please choose a different code.`);
      return;
    }

    const pct = discountType === "percent" ? parseInt(percentage, 10) || 0 : 0;
    const flat = discountType === "flat" ? parseFloat(flatAmount) || 0 : 0;
    if (pct === 0 && flat === 0) {
      Alert.alert("No Discount", "Please enter a percentage or flat amount discount.");
      return;
    }

    const now = new Date().toISOString();
    if (editingId) {
      const existing = promoCodes.find((p) => p.id === editingId);
      if (!existing) return;
      const updated: PromoCode = {
        ...existing,
        label: label.trim(),
        code: upperCode,
        percentage: pct,
        flatAmount: flat > 0 ? flat : null,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        expiresAt: expiresAt || null,
        active,
      };
      dispatch({ type: "UPDATE_PROMO_CODE", payload: updated });
      syncToDb({ type: "UPDATE_PROMO_CODE", payload: updated });
    } else {
      const newCode: PromoCode = {
        id: generateId(),
        label: label.trim(),
        code: upperCode,
        percentage: pct,
        flatAmount: flat > 0 ? flat : null,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        usedCount: 0,
        expiresAt: expiresAt || null,
        active,
        createdAt: now,
      };
      dispatch({ type: "ADD_PROMO_CODE", payload: newCode });
      syncToDb({ type: "ADD_PROMO_CODE", payload: newCode });
    }
    setShowForm(false);
    resetForm();
  }, [label, code, percentage, flatAmount, discountType, maxUses, expiresAt, active, editingId, promoCodes, dispatch, syncToDb, resetForm]);

  const handleDelete = useCallback((pc: PromoCode) => {
    Alert.alert(
      "Delete Promo Code",
      `Delete "${pc.code}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            dispatch({ type: "DELETE_PROMO_CODE", payload: pc.id });
            syncToDb({ type: "DELETE_PROMO_CODE", payload: pc.id });
          },
        },
      ]
    );
  }, [dispatch, syncToDb]);

  const handleToggleActive = useCallback((pc: PromoCode) => {
    const updated = { ...pc, active: !pc.active };
    dispatch({ type: "UPDATE_PROMO_CODE", payload: updated });
    syncToDb({ type: "UPDATE_PROMO_CODE", payload: updated });
  }, [dispatch, syncToDb]);

  const handleShare = useCallback(async (pc: PromoCode) => {
    const discount = formatDiscount(pc);
    const msg = `Use code ${pc.code} for ${discount} on your booking!`;
    try {
      await Share.share({ message: msg });
    } catch (_) {}
  }, []);

  // Analytics: total savings given
  const totalSavings = promoCodes.reduce((sum, pc) => {
    const appts = state.appointments.filter(
      (a) => a.discountName === pc.code && a.status === "completed"
    );
    return sum + appts.reduce((s, a) => s + (a.discountAmount ?? 0), 0);
  }, 0);

  const s = styles(colors);

  return (
    <ScreenContainer>
      <FuturisticBackground />
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Promo Codes</Text>
        <TouchableOpacity onPress={openCreate} style={s.addBtn}>
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Summary card */}
        <View style={s.summaryCard}>
          <View style={s.summaryItem}>
            <Text style={s.summaryValue}>{promoCodes.length}</Text>
            <Text style={s.summaryLabel}>Total Codes</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <Text style={s.summaryValue}>{promoCodes.filter((p) => p.active && !isExpired(p)).length}</Text>
            <Text style={s.summaryLabel}>Active</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <Text style={s.summaryValue}>${totalSavings.toFixed(0)}</Text>
            <Text style={s.summaryLabel}>Total Savings Given</Text>
          </View>
        </View>

        {/* Create form */}
        {showForm && (
          <View style={s.formCard}>
            <Text style={s.formTitle}>{editingId ? "Edit Promo Code" : "New Promo Code"}</Text>

            <Text style={s.fieldLabel}>Label</Text>
            <TextInput
              style={s.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Summer Referral"
              placeholderTextColor={colors.muted}
            />

            <Text style={s.fieldLabel}>Code</Text>
            <View style={s.codeRow}>
              <TextInput
                style={[s.input, { flex: 1, marginRight: 8 }]}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="e.g. SUMMER20"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={s.refreshBtn}
                onPress={() => setCode(generateCode())}
              >
                <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <Text style={s.fieldLabel}>Discount Type</Text>
            <View style={s.segmentRow}>
              <TouchableOpacity
                style={[s.segment, discountType === "percent" && s.segmentActive]}
                onPress={() => setDiscountType("percent")}
              >
                <Text style={[s.segmentText, discountType === "percent" && s.segmentTextActive]}>
                  Percentage
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.segment, discountType === "flat" && s.segmentActive]}
                onPress={() => setDiscountType("flat")}
              >
                <Text style={[s.segmentText, discountType === "flat" && s.segmentTextActive]}>
                  Flat Amount
                </Text>
              </TouchableOpacity>
            </View>

            {discountType === "percent" ? (
              <>
                <Text style={s.fieldLabel}>Percentage Off</Text>
                <TextInput
                  style={s.input}
                  value={percentage}
                  onChangeText={setPercentage}
                  placeholder="10"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </>
            ) : (
              <>
                <Text style={s.fieldLabel}>Flat Discount ($)</Text>
                <TextInput
                  style={s.input}
                  value={flatAmount}
                  onChangeText={setFlatAmount}
                  placeholder="5.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </>
            )}

            <Text style={s.fieldLabel}>Max Uses (leave blank for unlimited)</Text>
            <TextInput
              style={s.input}
              value={maxUses}
              onChangeText={setMaxUses}
              placeholder="Unlimited"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              returnKeyType="done"
            />

            <Text style={s.fieldLabel}>Expires (leave blank for no expiry)</Text>
            <BirthdayPicker
              value={expiresAt
                ? (() => { const [y, m, d] = expiresAt.split("-"); return `${m}/${d}/${y}`; })()
                : ""}
              onChange={(v) => {
                if (!v) { setExpiresAt(""); return; }
                const [m, d, y] = v.split("/");
                if (y && m && d) setExpiresAt(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
              }}
              placeholder="No expiry date"
              futureOnly
            />

            <View style={s.activeRow}>
              <Text style={s.fieldLabel}>Active</Text>
              <Switch
                value={active}
                onValueChange={setActive}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>

            <View style={s.formButtons}>
              <TouchableOpacity
                style={[s.formBtn, s.cancelBtn]}
                onPress={() => { setShowForm(false); resetForm(); }}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.formBtn, s.saveBtn]} onPress={handleSave}>
                <Text style={s.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* List */}
        {promoCodes.length === 0 && !showForm ? (
          <View style={s.emptyState}>
            <IconSymbol name="ticket.fill" size={48} color={colors.muted} />
            <Text style={s.emptyTitle}>No promo codes yet</Text>
            <Text style={s.emptySubtitle}>
              Create referral or discount codes to share with clients.
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openCreate}>
              <Text style={s.emptyBtnText}>Create First Code</Text>
            </TouchableOpacity>
          </View>
        ) : (
          promoCodes
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((pc) => {
              const expired = isExpired(pc);
              const usagePercent =
                pc.maxUses && pc.maxUses > 0
                  ? Math.min((pc.usedCount / pc.maxUses) * 100, 100)
                  : null;
              return (
                <View key={pc.id} style={[s.card, !pc.active && s.cardInactive]}>
                  <View style={s.cardTop}>
                    <View style={s.codeChip}>
                      <Text style={s.codeChipText}>{pc.code}</Text>
                    </View>
                    <View style={s.cardBadges}>
                      {expired && (
                        <View style={[s.badge, s.badgeExpired]}>
                          <Text style={s.badgeText}>Expired</Text>
                        </View>
                      )}
                      {!expired && isLimitReached(pc) && (
                        <View style={[s.badge, { backgroundColor: colors.error + "22", borderColor: colors.error + "44" }]}>
                          <Text style={[s.badgeText, { color: colors.error }]}>Limit Reached</Text>
                        </View>
                      )}
                      {!pc.active && !expired && !isLimitReached(pc) && (
                        <View style={[s.badge, s.badgeInactive]}>
                          <Text style={s.badgeText}>Inactive</Text>
                        </View>
                      )}
                      {pc.active && !expired && !isLimitReached(pc) && (
                        <View style={[s.badge, s.badgeActive]}>
                          <Text style={s.badgeText}>Active</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <Text style={s.cardLabel}>{pc.label}</Text>
                  <Text style={s.cardDiscount}>{formatDiscount(pc)}</Text>

                  {/* Usage bar */}
                  <View style={s.usageRow}>
                    <Text style={s.usageText}>
                      {pc.usedCount} use{pc.usedCount !== 1 ? "s" : ""}
                      {pc.maxUses ? ` / ${pc.maxUses} max` : ""}
                    </Text>
                    {pc.expiresAt && (
                      <Text style={[s.expiryText, expired && { color: colors.error }]}>
                        {expired ? "Expired" : `Expires ${pc.expiresAt}`}
                      </Text>
                    )}
                  </View>
                  {usagePercent !== null && (
                    <View style={s.progressBg}>
                      <View
                        style={[
                          s.progressFill,
                          {
                            width: `${usagePercent}%` as any,
                            backgroundColor:
                              usagePercent >= 100 ? colors.error : colors.primary,
                          },
                        ]}
                      />
                    </View>
                  )}

                  {/* Actions */}
                  <View style={s.cardActions}>
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => handleShare(pc)}
                    >
                      <IconSymbol name="square.and.arrow.up" size={16} color={colors.primary} />
                      <Text style={[s.actionText, { color: colors.primary }]}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => handleToggleActive(pc)}
                    >
                      <IconSymbol
                        name={pc.active ? "xmark.circle.fill" : "checkmark.circle.fill"}
                        size={16}
                        color={pc.active ? colors.muted : colors.success}
                      />
                      <Text style={[s.actionText, { color: pc.active ? colors.muted : colors.success }]}>
                        {pc.active ? "Deactivate" : "Activate"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => openEdit(pc)}
                    >
                      <IconSymbol name="pencil" size={16} color={colors.foreground} />
                      <Text style={[s.actionText, { color: colors.foreground }]}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => handleDelete(pc)}
                    >
                      <IconSymbol name="trash.fill" size={16} color={colors.error} />
                      <Text style={[s.actionText, { color: colors.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: { padding: 4, marginRight: 8 },
    headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.foreground },
    addBtn: { padding: 4 },
    summaryCard: {
      flexDirection: "row",
      margin: 16,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    summaryItem: { flex: 1, alignItems: "center" },
    summaryValue: { fontSize: 22, fontWeight: "700", color: colors.foreground },
    summaryLabel: { fontSize: 11, color: colors.muted, marginTop: 2, textAlign: "center" },
    summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
    formCard: {
      margin: 16,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    formTitle: { fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 16 },
    fieldLabel: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 12 },
    input: {
      backgroundColor: colors.background,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.foreground,
    },
    codeRow: { flexDirection: "row", alignItems: "center" },
    refreshBtn: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentRow: {
      flexDirection: "row",
      backgroundColor: colors.background,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    segment: { flex: 1, paddingVertical: 10, alignItems: "center" },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { fontSize: 14, color: colors.muted },
    segmentTextActive: { color: "#fff", fontWeight: "600" },
    activeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 12,
    },
    formButtons: { flexDirection: "row", gap: 12, marginTop: 20 },
    formBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
    cancelBtn: { backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    cancelBtnText: { color: colors.foreground, fontWeight: "600" },
    saveBtn: { backgroundColor: colors.primary },
    saveBtnText: { color: "#fff", fontWeight: "700" },
    emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.foreground, marginTop: 16 },
    emptySubtitle: { fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 8, lineHeight: 20 },
    emptyBtn: { marginTop: 24, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
    emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
    card: {
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardInactive: { opacity: 0.6 },
    cardTop: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
    codeChip: {
      backgroundColor: colors.primary + "22",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      marginRight: 8,
    },
    codeChipText: { fontSize: 14, fontWeight: "700", color: colors.primary, letterSpacing: 1 },
    cardBadges: { flexDirection: "row", gap: 6, flex: 1, justifyContent: "flex-end" },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeActive: { backgroundColor: colors.success + "22" },
    badgeInactive: { backgroundColor: colors.muted + "22" },
    badgeExpired: { backgroundColor: colors.error + "22" },
    badgeText: { fontSize: 11, fontWeight: "600", color: colors.foreground },
    cardLabel: { fontSize: 15, fontWeight: "600", color: colors.foreground, marginBottom: 2 },
    cardDiscount: { fontSize: 13, color: colors.muted, marginBottom: 8 },
    usageRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
    usageText: { fontSize: 12, color: colors.muted },
    expiryText: { fontSize: 12, color: colors.muted },
    progressBg: {
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      marginBottom: 12,
      overflow: "hidden",
    },
    progressFill: { height: 4, borderRadius: 2 },
    cardActions: { flexDirection: "row", justifyContent: "space-around", paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
    actionText: { fontSize: 12, fontWeight: "500" },
  });
}
