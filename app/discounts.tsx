import {
  Text,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Alert,
  ScrollView,
  Switch,
  Modal,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useCallback, useMemo } from "react";
import {
  Discount,
  formatTimeDisplay,
} from "@/lib/types";
import { TapTimePicker, timeToMinutes as tapTimeToMinutes } from "@/components/tap-time-picker";
import { useRef } from "react";
import { FuturisticBackground } from "@/components/futuristic-background";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DiscountsScreen() {
  const { state, dispatch, syncToDb, getServiceById } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, fs, buttonHeight, iconButtonSize } = useResponsive();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [percentage, setPercentage] = useState("10");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [maxUses, setMaxUses] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[] | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[] | null>(null);
  const [expandedServiceCats, setExpandedServiceCats] = useState<Set<string>>(new Set());
  const [expandedProductBrands, setExpandedProductBrands] = useState<Set<string>>(new Set());
  const toggleServiceCat = (cat: string) => setExpandedServiceCats(prev => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });
  const toggleProductBrand = (brand: string) => setExpandedProductBrands(prev => {
    const next = new Set(prev);
    if (next.has(brand)) next.delete(brand); else next.add(brand);
    return next;
  });
  const [showTimePicker, setShowTimePicker] = useState<"start" | "end" | null>(null);
  const draftStartRef = useRef(startTime);
  const draftEndRef = useRef(endTime);
  const [draftPickerStart, setDraftPickerStart] = useState(startTime);
  const [draftPickerEnd, setDraftPickerEnd] = useState(endTime);
  const [discountTimeError, setDiscountTimeError] = useState<string | null>(null);

  const openTimePicker = useCallback((field: "start" | "end") => {
    draftStartRef.current = startTime;
    draftEndRef.current = endTime;
    setDraftPickerStart(startTime);
    setDraftPickerEnd(endTime);
    setShowTimePicker(field);
  }, [startTime, endTime]);

  const saveTimePicker = useCallback(() => {
    const [sh, sm] = draftStartRef.current.split(":").map(Number);
    const [eh, em] = draftEndRef.current.split(":").map(Number);
    const startMin = sh * 60 + (sm || 0);
    const endMin = eh * 60 + (em || 0);
    if (endMin <= startMin) {
      setDiscountTimeError("End time must be after start time.");
      return;
    }
    setDiscountTimeError(null);
    setStartTime(draftStartRef.current);
    setEndTime(draftEndRef.current);
    setShowTimePicker(null);
  }, []);

  // Calendar state
  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const calDays = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth]);

  const nextMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 11) { setCalYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);
  const prevMonth = useCallback(() => {
    const now = new Date();
    if (calYear === now.getFullYear() && calMonth <= now.getMonth()) return;
    setCalMonth((m) => {
      if (m === 0) { setCalYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, [calYear, calMonth]);

  const toggleDate = useCallback((dateStr: string) => {
    setSelectedDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]
    );
  }, []);

  const resetForm = useCallback(() => {
    setName("");
    setPercentage("10");
    setStartTime("09:00");
    setEndTime("12:00");
    setSelectedDates([]);
    setRepeatWeekly(false);
    setMaxUses("");
    setSelectedServiceIds(null);
    setSelectedProductIds(null);
    setEditingId(null);
    setShowForm(false);
  }, []);

  const handleEdit = useCallback((disc: Discount) => {
    setEditingId(disc.id);
    setName(disc.name);
    setPercentage(String(disc.percentage));
    setStartTime(disc.startTime);
    setEndTime(disc.endTime);
    setSelectedDates(disc.dates ?? []);
    setRepeatWeekly(false);
    setMaxUses(disc.maxUses != null ? String(disc.maxUses) : "");
    setSelectedServiceIds(disc.serviceIds);
    setSelectedProductIds(disc.productIds ?? null);
    setShowForm(true);
  }, []);

  // Generate weekly repeat dates for all weekdays present in selectedDates, 12 weeks ahead
  const buildFinalDates = useCallback((baseDates: string[]): string[] => {
    if (!repeatWeekly || baseDates.length === 0) return baseDates;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const weekdays = new Set(baseDates.map((d) => new Date(d + 'T12:00:00').getDay()));
    const result = new Set<string>(baseDates);
    weekdays.forEach((wd) => {
      for (let w = 1; w <= 12; w++) {
        const d = new Date(todayDate);
        const diff = ((wd - d.getDay()) + 7) % 7 || 7;
        d.setDate(d.getDate() + diff + (w - 1) * 7);
        const str = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
        result.add(str);
      }
    });
    return Array.from(result).sort();
  }, [repeatWeekly]);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      Alert.alert("Required", "Please enter a discount name.");
      return;
    }
    const pct = parseInt(percentage, 10);
    if (isNaN(pct) || pct < 1 || pct > 100) {
      Alert.alert("Invalid", "Percentage must be between 1 and 100.");
      return;
    }
    if (selectedDates.length === 0) {
      Alert.alert("Required", "Please select at least one date for this discount.");
      return;
    }
    const finalDates = buildFinalDates(selectedDates);

    if (editingId) {
      const parsedMaxUses = maxUses.trim() !== "" ? parseInt(maxUses.trim(), 10) : null;
      const updated: Discount = {
        id: editingId,
        name: name.trim(),
        percentage: pct,
        startTime,
        endTime,
        daysOfWeek: [],
        dates: finalDates,
        serviceIds: selectedServiceIds,
        productIds: selectedProductIds,
        active: state.discounts.find((d) => d.id === editingId)?.active ?? true,
        createdAt: state.discounts.find((d) => d.id === editingId)?.createdAt ?? new Date().toISOString(),
        maxUses: (!isNaN(parsedMaxUses as number) && (parsedMaxUses as number) > 0) ? parsedMaxUses : null,
      };
      dispatch({ type: "UPDATE_DISCOUNT", payload: updated });
      syncToDb({ type: "UPDATE_DISCOUNT", payload: updated });
    } else {
      const parsedMaxUsesNew = maxUses.trim() !== "" ? parseInt(maxUses.trim(), 10) : null;
      const newDiscount: Discount = {
        id: generateId(),
        name: name.trim(),
        percentage: pct,
        startTime,
        endTime,
        daysOfWeek: [],
        dates: finalDates,
        serviceIds: selectedServiceIds,
        productIds: selectedProductIds,
        active: true,
        createdAt: new Date().toISOString(),
        maxUses: (!isNaN(parsedMaxUsesNew as number) && (parsedMaxUsesNew as number) > 0) ? parsedMaxUsesNew : null,
      };
      dispatch({ type: "ADD_DISCOUNT", payload: newDiscount });
      syncToDb({ type: "ADD_DISCOUNT", payload: newDiscount });
    }
    resetForm();
  }, [name, percentage, startTime, endTime, selectedDates, selectedServiceIds, selectedProductIds, editingId, maxUses, state.discounts, dispatch, syncToDb, resetForm, buildFinalDates]);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert("Delete Discount", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            dispatch({ type: "DELETE_DISCOUNT", payload: id });
            syncToDb({ type: "DELETE_DISCOUNT", payload: id });
          },
        },
      ]);
    },
    [dispatch, syncToDb]
  );

  const handleToggleActive = useCallback(
    (disc: Discount) => {
      const updated = { ...disc, active: !disc.active };
      dispatch({ type: "UPDATE_DISCOUNT", payload: updated });
      syncToDb({ type: "UPDATE_DISCOUNT", payload: updated });
    },
    [dispatch, syncToDb]
  );

  const toggleServiceFilter = useCallback((serviceId: string) => {
    setSelectedServiceIds((prev) => {
      if (!prev) return [serviceId];
      if (prev.includes(serviceId)) {
        const next = prev.filter((id) => id !== serviceId);
        return next.length === 0 ? null : next;
      }
      return [...prev, serviceId];
    });
  }, []);

  const toggleProductFilter = useCallback((productId: string) => {
    setSelectedProductIds((prev) => {
      if (!prev) return [productId];
      if (prev.includes(productId)) {
        const next = prev.filter((id) => id !== productId);
        return next.length === 0 ? null : next;
      }
      return [...prev, productId];
    });
  }, []);

  const availableProducts = useMemo(
    () => state.products.filter((p) => p.available),
    [state.products]
  );

  const sortedDiscounts = useMemo(
    () => [...state.discounts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.discounts]
  );

  const renderDiscount = useCallback(
    ({ item }: { item: Discount }) => {
      const serviceNames =
        item.serviceIds && item.serviceIds.length > 0
          ? item.serviceIds.map((id) => getServiceById(id)?.name ?? "Unknown").join(", ")
          : "All Services";
      const productNames =
        item.productIds && item.productIds.length > 0
          ? item.productIds.map((id) => state.products.find((p) => p.id === id)?.name ?? "Unknown").join(", ")
          : item.productIds === null ? "All Products" : "No Products";
      const dateLabels = (item.dates ?? []).length > 0
        ? (item.dates ?? []).slice(0, 3).map(formatDateLabel).join(", ") + ((item.dates ?? []).length > 3 ? ` +${(item.dates ?? []).length - 3} more` : "")
        : "No dates selected";
      // Count how many completed appointments used this discount by name
      const usageCount = state.appointments.filter(
        (a) => a.status === "completed" && a.discountName === item.name
      ).length;
      // Total revenue saved via this discount
      const totalSaved = state.appointments
        .filter((a) => a.status === "completed" && a.discountName === item.name)
        .reduce((sum, a) => sum + (a.discountAmount ?? 0), 0);
      // Expiry: find the latest future date
      const today2 = new Date(); today2.setHours(0, 0, 0, 0);
      const todayStr2 = toDateStr(today2.getFullYear(), today2.getMonth(), today2.getDate());
      const futureDates = (item.dates ?? []).filter((d) => d >= todayStr2).sort();
      const latestDate = futureDates.length > 0 ? futureDates[futureDates.length - 1] : null;
      const daysUntilExpiry = latestDate ? Math.round((new Date(latestDate + "T12:00:00").getTime() - today2.getTime()) / 86400000) : null;
      const isExpired = (item.dates ?? []).length > 0 && futureDates.length === 0;
      // Max uses progress
      const maxUsesReached = item.maxUses != null && usageCount >= item.maxUses;

      return (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: item.active ? 1 : 0.6 }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                <Text style={[styles.cardSubtitle, { color: colors.primary, marginTop: 0 }]}>{item.percentage}% off</Text>
                {isExpired ? (
                  <View style={{ backgroundColor: colors.error + "20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.error }}>Expired</Text>
                  </View>
                ) : daysUntilExpiry !== null && daysUntilExpiry <= 7 ? (
                  <View style={{ backgroundColor: colors.warning + "20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.warning }}>
                      {daysUntilExpiry === 0 ? "Expires today" : `Expires in ${daysUntilExpiry}d`}
                    </Text>
                  </View>
                ) : daysUntilExpiry !== null ? (
                  <View style={{ backgroundColor: colors.success + "15", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.success }}>Expires in {daysUntilExpiry}d</Text>
                  </View>
                ) : null}
                {item.maxUses != null && (
                  <View style={{ backgroundColor: maxUsesReached ? colors.error + "20" : colors.muted + "20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: maxUsesReached ? colors.error : colors.muted }}>
                      {usageCount}/{item.maxUses} uses{maxUsesReached ? " (limit reached)" : ""}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <Switch
              value={item.active}
              onValueChange={() => handleToggleActive(item)}
              trackColor={{ false: colors.border, true: colors.primary + "60" }}
              thumbColor={item.active ? colors.primary : colors.muted}
            />
          </View>
          {/* Usage stats */}
          {usageCount > 0 && (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, marginTop: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.primary + "12", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
                <IconSymbol name="checkmark.circle.fill" size={13} color={colors.primary} />
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.primary }}>{usageCount} uses</Text>
              </View>
              {totalSaved > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.success + "12", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <IconSymbol name="tag.fill" size={13} color={colors.success} />
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.success }}>${totalSaved.toFixed(0)} saved</Text>
                </View>
              )}
            </View>
          )}
          {/* Usage progress bar — only shown when maxUses is set */}
          {item.maxUses != null && item.maxUses > 0 && (
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, fontWeight: "600" }}>Usage</Text>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: maxUsesReached ? colors.error : colors.primary }}>
                  {usageCount} / {item.maxUses} uses
                </Text>
              </View>
              <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" }}>
                <View style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: maxUsesReached ? colors.error : colors.primary,
                  width: `${Math.min((usageCount / item.maxUses) * 100, 100)}%` as any,
                }} />
              </View>
            </View>
          )}
          <View style={styles.cardDetails}>
            <View style={styles.detailRow}>
              <IconSymbol name="clock.fill" size={14} color={colors.muted} />
              <Text style={[styles.detailText, { color: colors.muted }]}>
                {formatTimeDisplay(item.startTime)} – {formatTimeDisplay(item.endTime)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <IconSymbol name="calendar" size={14} color={colors.muted} />
              <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>{dateLabels}</Text>
            </View>
            <View style={styles.detailRow}>
              <IconSymbol name="list.bullet" size={14} color={colors.muted} />
              <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>Services: {serviceNames}</Text>
            </View>
            {(item.productIds === null || (item.productIds && item.productIds.length > 0)) && (
              <View style={styles.detailRow}>
                <IconSymbol name="bag.fill" size={14} color={colors.muted} />
                <Text style={[styles.detailText, { color: colors.muted }]} numberOfLines={1}>Products: {productNames}</Text>
              </View>
            )}
          </View>
          <View style={styles.cardActions}>
            <Pressable
              onPress={() => handleEdit(item)}
              style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary + "15" }, pressed && { opacity: 0.7 }]}
            >
              <IconSymbol name="pencil" size={16} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item.id)}
              style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.error + "15" }, pressed && { opacity: 0.7 }]}
            >
              <IconSymbol name="trash.fill" size={16} color={colors.error} />
              <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      );
    },
    [colors, getServiceById, state.products, state.appointments, handleEdit, handleDelete, handleToggleActive]
  );

  const formContent = showForm ? (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.formTitle, { color: colors.foreground }]}>
        {editingId ? "Edit Discount" : "New Discount"}
      </Text>

      {/* Name */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Discount Name</Text>
      <TextInput
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Happy Hour, Early Bird"
        placeholderTextColor={colors.muted + "80"}
      />

      {/* Percentage */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Discount Percentage</Text>
      <View style={styles.percentRow}>
        <TextInput
          style={[styles.input, { flex: 1, color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, marginBottom: 0 }]}
          value={percentage}
          onChangeText={setPercentage}
          keyboardType="number-pad"
          placeholder="10"
          placeholderTextColor={colors.muted + "80"}
        />
        <View style={[styles.percentBadge, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.percentLabel, { color: colors.primary }]}>%</Text>
        </View>
      </View>

      {/* Time Window */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Time Window</Text>
      <View style={styles.timeRow}>
        <Pressable
          onPress={() => openTimePicker("start")}
          style={[styles.timeBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <IconSymbol name="clock.fill" size={14} color={colors.primary} />
          <Text style={[styles.timeBtnText, { color: colors.foreground }]}>{formatTimeDisplay(startTime)}</Text>
        </Pressable>
        <Text style={{ color: colors.muted, fontSize: fs.sm, fontWeight: "600" }}>to</Text>
        <Pressable
          onPress={() => openTimePicker("end")}
          style={[styles.timeBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <IconSymbol name="clock.fill" size={14} color={colors.primary} />
          <Text style={[styles.timeBtnText, { color: colors.foreground }]}>{formatTimeDisplay(endTime)}</Text>
        </Pressable>
      </View>

      {/* Weekday Quick-Select */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Quick-Select Weekday</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, wd) => {
          // Generate all future dates for this weekday for the next 12 weeks
          const genDates = () => {
            const today2 = new Date();
            today2.setHours(0, 0, 0, 0);
            const dates: string[] = [];
            for (let w = 0; w < 12; w++) {
              const d = new Date(today2);
              const diff = ((wd - d.getDay()) + 7) % 7 || 7;
              d.setDate(d.getDate() + diff + w * 7);
              dates.push(toDateStr(d.getFullYear(), d.getMonth(), d.getDate()));
            }
            return dates;
          };
          const isAllSelected = genDates().every((ds) => selectedDates.includes(ds));
          return (
            <Pressable
              key={label}
              onPress={() => {
                const dates = genDates();
                if (isAllSelected) {
                  setSelectedDates((prev) => prev.filter((d) => !dates.includes(d)));
                } else {
                  setSelectedDates((prev) => Array.from(new Set([...prev, ...dates])).sort());
                }
              }}
              style={[{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: isAllSelected ? colors.primary : colors.border,
                backgroundColor: isAllSelected ? colors.primary : colors.background,
              }]}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: isAllSelected ? "#fff" : colors.foreground }}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Calendar Date Picker */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Select Dates (future only)</Text>
      <View style={[styles.calendarCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
        {/* Month Navigation */}
        <View style={styles.calNavRow}>
          <Pressable onPress={prevMonth} style={({ pressed }) => [styles.calNavBtn, pressed && { opacity: 0.5 }]}>
            <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.calMonthTitle, { color: colors.foreground }]}>
            {MONTH_NAMES[calMonth]} {calYear}
          </Text>
          <Pressable onPress={nextMonth} style={({ pressed }) => [styles.calNavBtn, pressed && { opacity: 0.5 }]}>
            <IconSymbol name="chevron.right" size={20} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Weekday Headers */}
        <View style={styles.calWeekRow}>
          {WEEKDAY_HEADERS.map((d) => (
            <Text key={d} style={[styles.calDayHeader, { color: colors.muted }]}>{d}</Text>
          ))}
        </View>

        {/* Calendar Grid */}
        <View style={styles.calGrid}>
          {calDays.map((day, idx) => {
            if (day === null) return <View key={`e-${idx}`} style={styles.calCell} />;
            const dateStr = toDateStr(calYear, calMonth, day);
            const isPast = dateStr < todayStr;
            const isSelected = selectedDates.includes(dateStr);
            const isToday = dateStr === todayStr;
            return (
              <Pressable
                key={dateStr}
                onPress={() => !isPast && toggleDate(dateStr)}
                style={[
                  styles.calCell,
                  isSelected && { backgroundColor: colors.primary, borderRadius: 20 },
                  isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.primary, borderRadius: 20 },
                ]}
                disabled={isPast}
              >
                <Text
                  style={{
                    fontSize: fs.sm,
                    fontWeight: isSelected || isToday ? "700" : "400",
                    color: isPast ? colors.muted + "40" : isSelected ? "#fff" : colors.foreground,
                    lineHeight: 20,
                  }}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Selected dates summary */}
        {selectedDates.length > 0 && (
          <View style={styles.selectedSummary}>
            <Text style={[styles.selectedCount, { color: colors.primary }]}>
              {selectedDates.length} date{selectedDates.length !== 1 ? "s" : ""} selected
              {repeatWeekly && selectedDates.length > 0 ? ` (+${Math.max(0, buildFinalDates(selectedDates).length - selectedDates.length)} weekly)` : ""}
            </Text>
            <Pressable onPress={() => setSelectedDates([])} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
              <Text style={{ color: colors.error, fontSize: fs.xs, fontWeight: "600" }}>Clear All</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Repeat Weekly Toggle */}
      <View style={[styles.repeatRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, lineHeight: 20 }}>Repeat Weekly</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, lineHeight: 16, marginTop: 2 }}>
            Auto-apply to the same weekday(s) for 12 weeks
          </Text>
        </View>
        <Switch
          value={repeatWeekly}
          onValueChange={setRepeatWeekly}
          trackColor={{ false: colors.border, true: colors.primary + "60" }}
          thumbColor={repeatWeekly ? colors.primary : colors.muted}
        />
      </View>

      {/* Service Filter — Accordion */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Applies To (Services)</Text>
      {/* All Services toggle */}
      <Pressable
        onPress={() => setSelectedServiceIds(null)}
        style={[styles.allToggleRow, { borderColor: selectedServiceIds === null ? colors.primary : colors.border, backgroundColor: selectedServiceIds === null ? colors.primary + "18" : colors.surface }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: selectedServiceIds === null ? colors.primary : colors.foreground }}>All Services</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>Discount applies to every service</Text>
        </View>
        {selectedServiceIds === null && <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>✓</Text></View>}
      </Pressable>
      {/* Category accordions */}
      {(() => {
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
        return catEntries.map(([cat, svcs]) => {
          const isOpen = expandedServiceCats.has(cat);
          const selectedInCat = svcs.filter(s => selectedServiceIds?.includes(s.id)).length;
          return (
            <View key={cat} style={[styles.accordionCard, { borderColor: colors.border }]}>
              <Pressable
                onPress={() => toggleServiceCat(cat)}
                style={styles.accordionHeader}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{cat}</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>
                    {selectedInCat > 0 ? `${selectedInCat} of ${svcs.length} selected` : `${svcs.length} service${svcs.length !== 1 ? "s" : ""}`}
                  </Text>
                </View>
                {selectedInCat > 0 && (
                  <View style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                    <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>{selectedInCat}</Text>
                  </View>
                )}
                <Text style={{ fontSize: fs.md, color: colors.muted, fontWeight: "300" }}>{isOpen ? "−" : "+"}</Text>
              </Pressable>
              {isOpen && (
                <View style={styles.accordionBody}>
                  {svcs.map((svc) => {
                    const sel = selectedServiceIds?.includes(svc.id) ?? false;
                    return (
                      <Pressable
                        key={svc.id}
                        onPress={() => toggleServiceFilter(svc.id)}
                        style={[styles.accordionItem, { backgroundColor: sel ? svc.color + "18" : "transparent", borderColor: sel ? svc.color : colors.border }]}
                      >
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: svc.color, marginRight: 10, marginTop: 2 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: fs.sm, fontWeight: sel ? "600" : "400", color: colors.foreground }}>{svc.name}</Text>
                          {svc.price != null && <Text style={{ fontSize: fs.xs, color: colors.muted }}>${svc.price}</Text>}
                        </View>
                        {sel && (
                          <View style={{ backgroundColor: svc.color, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginRight: 6 }}>
                            <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>−{percentage}%</Text>
                          </View>
                        )}
                        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: sel ? svc.color : colors.border, backgroundColor: sel ? svc.color : "transparent", alignItems: "center", justifyContent: "center" }}>
                          {sel && <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>✓</Text>}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        });
      })()}

      {/* Product Filter — Accordion */}
      {availableProducts.length > 0 && (
        <>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>Applies To (Products)</Text>
          {/* All Products toggle */}
          <Pressable
            onPress={() => setSelectedProductIds(null)}
            style={[styles.allToggleRow, { borderColor: selectedProductIds === null ? colors.primary : colors.border, backgroundColor: selectedProductIds === null ? colors.primary + "18" : colors.surface }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: selectedProductIds === null ? colors.primary : colors.foreground }}>All Products</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>Discount applies to every product</Text>
            </View>
            {selectedProductIds === null && <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>✓</Text></View>}
          </Pressable>
          {/* Brand accordions */}
          {(() => {
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
            return brandEntries.map(([brand, prods]) => {
              const isOpen = expandedProductBrands.has(brand);
              const selectedInBrand = prods.filter(p => selectedProductIds?.includes(p.id)).length;
              return (
                <View key={brand} style={[styles.accordionCard, { borderColor: colors.border }]}>
                  <Pressable
                    onPress={() => toggleProductBrand(brand)}
                    style={styles.accordionHeader}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{brand}</Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 1 }}>
                        {selectedInBrand > 0 ? `${selectedInBrand} of ${prods.length} selected` : `${prods.length} product${prods.length !== 1 ? "s" : ""}`}
                      </Text>
                    </View>
                    {selectedInBrand > 0 && (
                      <View style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                        <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>{selectedInBrand}</Text>
                      </View>
                    )}
                    <Text style={{ fontSize: fs.md, color: colors.muted, fontWeight: "300" }}>{isOpen ? "−" : "+"}</Text>
                  </Pressable>
                  {isOpen && (
                    <View style={styles.accordionBody}>
                      {prods.map((prod) => {
                        const sel = selectedProductIds?.includes(prod.id) ?? false;
                        return (
                          <Pressable
                            key={prod.id}
                            onPress={() => toggleProductFilter(prod.id)}
                            style={[styles.accordionItem, { backgroundColor: sel ? colors.primary + "12" : "transparent", borderColor: sel ? colors.primary : colors.border }]}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: fs.sm, fontWeight: sel ? "600" : "400", color: colors.foreground }}>{prod.name}</Text>
                              {prod.price != null && <Text style={{ fontSize: fs.xs, color: colors.muted }}>${prod.price}</Text>}
                            </View>
                            {sel && (
                              <View style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginRight: 6 }}>
                                <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>−{percentage}%</Text>
                              </View>
                            )}
                            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                              {sel && <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "700" }}>✓</Text>}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            });
          })()}
        </>
      )}

      {/* Max Uses Cap */}
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>Max Uses (Optional)</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <TextInput
          style={[styles.input, { flex: 1, color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, marginBottom: 0 }]}
          value={maxUses}
          onChangeText={setMaxUses}
          keyboardType="number-pad"
          placeholder="e.g. 20 (leave blank for unlimited)"
          placeholderTextColor={colors.muted + "80"}
          returnKeyType="done"
        />
      </View>
      {maxUses.trim() !== "" && !isNaN(parseInt(maxUses.trim(), 10)) && parseInt(maxUses.trim(), 10) > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, backgroundColor: colors.warning + "15", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
          <IconSymbol name="exclamationmark.circle.fill" size={14} color={colors.warning} />
          <Text style={{ fontSize: fs.xs, color: colors.warning, fontWeight: "600", flex: 1 }}>
            Discount auto-deactivates after {parseInt(maxUses.trim(), 10)} use{parseInt(maxUses.trim(), 10) !== 1 ? "s" : ""}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.formActions}>
        <Pressable
          onPress={resetForm}
          style={({ pressed }) => [styles.formBtnCancel, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.formBtnSave, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs.sm, lineHeight: 20 }}>
            {editingId ? "Update" : "Create"}
          </Text>
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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Discounts</Text>
        <Pressable
          onPress={() => { resetForm(); setShowForm(true); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
        >
          <IconSymbol name="plus" size={20} color="#fff" />
        </Pressable>
      </View>

      {sortedDiscounts.length === 0 && !showForm ? (
        <View style={styles.empty}>
          <IconSymbol name="tag.fill" size={48} color={colors.muted + "40"} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Discounts Yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
            Create date-based discounts to attract more clients during specific hours.
          </Text>
          <Pressable
            onPress={() => setShowForm(true)}
            style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.emptyBtnText}>Create Discount</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <FlatList
          data={sortedDiscounts}
          keyExtractor={(item) => item.id}
          renderItem={renderDiscount}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: hp, paddingTop: 16, paddingBottom: 100 }}
          ListHeaderComponent={formContent}
        />
        </KeyboardAvoidingView>
      )}

      {/* Time Picker Modal */}
      <Modal visible={showTimePicker !== null} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowTimePicker(null)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {showTimePicker === "start" ? "Start Time" : "End Time"}
              </Text>
              <Pressable onPress={() => setShowTimePicker(null)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                <IconSymbol name="xmark" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {showTimePicker === "start" && (
              <TapTimePicker
                value={draftPickerStart}
                onChange={(v) => { draftStartRef.current = v; setDraftPickerStart(v); setDiscountTimeError(null); }}
                stepMinutes={15}
              />
            )}
            {showTimePicker === "end" && (
              <TapTimePicker
                value={draftPickerEnd}
                onChange={(v) => { draftEndRef.current = v; setDraftPickerEnd(v); setDiscountTimeError(null); }}
                stepMinutes={15}
              />
            )}
            {discountTimeError ? (
              <Text style={{ color: colors.error, fontSize: fs.xs, textAlign: "center", marginVertical: 8 }}>{discountTimeError}</Text>
            ) : null}
            <Pressable
              onPress={saveTimePicker}
              style={({ pressed }) => [{ backgroundColor: discountTimeError ? colors.border : colors.primary, paddingVertical: 14, borderRadius: 12, alignItems: "center", opacity: pressed ? 0.8 : 1, marginTop: 12 }]}
            >
              <Text style={{ color: discountTimeError ? colors.muted : "#fff", fontWeight: "700", fontSize: fs.sm }}>Apply</Text>
            </Pressable>
          </Pressable>
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
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    width: "100%",
  },
  cardTitle: { fontSize: 15, fontWeight: "700", lineHeight: 22 },
  cardSubtitle: { fontSize: 13, marginTop: 2, fontWeight: "600", lineHeight: 18 },
  cardDetails: { gap: 8, marginBottom: 14, width: "100%" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailText: { fontSize: 11, lineHeight: 18, flex: 1 },
  cardActions: { flexDirection: "row", gap: 8, width: "100%" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    minHeight: 40,
  },
  actionText: { fontSize: 11, fontWeight: "600", lineHeight: 18 },
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
  percentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
    width: "100%",
  },
  percentBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  percentLabel: { fontSize: 15, fontWeight: "700" },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    width: "100%",
  },
  timeBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  timeBtnText: { fontSize: 13, fontWeight: "600", lineHeight: 20 },
  calendarCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    width: "100%",
  },
  calNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    width: "100%",
  },
  calNavBtn: { padding: 4 },
  calMonthTitle: { fontSize: 15, fontWeight: "700", lineHeight: 22 },
  calWeekRow: { flexDirection: "row", marginBottom: 4, width: "100%" },
  calDayHeader: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600" },
  calGrid: { flexDirection: "row", flexWrap: "wrap", width: "100%" },
  calCell: { width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  selectedSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#E5E7EB",
    width: "100%",
  },
  selectedCount: { fontSize: 11, fontWeight: "600", lineHeight: 18 },
  serviceWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
    width: "100%",
  },
  serviceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  repeatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    width: "100%",
  },
  allToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    width: "100%",
  },
  accordionCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: "hidden",
    width: "100%",
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  accordionBody: {
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.07)",
  },
  accordionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  formActions: { flexDirection: "row", gap: 10, marginTop: 8, width: "100%" },
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
  timePickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 4,
    height: 48,
  },
});
