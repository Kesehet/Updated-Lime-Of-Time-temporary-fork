/**
 * Status Detail Page
 * Swipeable columns for each appointment status (All / Completed / Confirmed / Pending / Cancelled)
 * with a timeline filter (Week / Month / 3M / 6M / Year) and scrollable appointment list.
 * Appointment rows support swipe-left (Mark Paid) and swipe-right (Reschedule) actions.
 */
import React, { useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useStore, formatDateStr } from "@/lib/store";
import type { Appointment, AppointmentStatus } from "@/lib/types";

const { width: SCREEN_W } = Dimensions.get("window");

// ─── Status config ────────────────────────────────────────────────────────────
const STATUSES: { key: AppointmentStatus | "all"; label: string; color: string }[] = [
  { key: "all", label: "All", color: "#00C896" },
  { key: "completed", label: "Completed", color: "#00C896" },
  { key: "confirmed", label: "Confirmed", color: "#0a7ea4" },
  { key: "pending", label: "Pending", color: "#FF9800" },
  { key: "cancelled", label: "Cancelled", color: "#EF4444" },
];

// ─── Timeline options ─────────────────────────────────────────────────────────
type TimelineKey = "week" | "month" | "3m" | "6m" | "year";
const TIMELINES: { key: TimelineKey; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "year", label: "Year" },
];

function getDateRange(key: TimelineKey): { start: string; end: string } {
  const now = new Date();
  // Use end of current month as the far-future bound so upcoming appointments are included
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const farFuture = formatDateStr(endOfMonth);
  switch (key) {
    case "week": {
      const s = new Date(now);
      s.setDate(now.getDate() - now.getDay());
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return { start: formatDateStr(s), end: formatDateStr(e) };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: formatDateStr(s), end: formatDateStr(e) };
    }
    case "3m": {
      const s = new Date(now);
      s.setMonth(now.getMonth() - 3);
      return { start: formatDateStr(s), end: farFuture };
    }
    case "6m": {
      const s = new Date(now);
      s.setMonth(now.getMonth() - 6);
      return { start: formatDateStr(s), end: farFuture };
    }
    case "year": {
      const s = new Date(now);
      s.setFullYear(now.getFullYear() - 1);
      return { start: formatDateStr(s), end: farFuture };
    }
  }
}

function formatApptDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatApptTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

// ─── Swipeable Appointment Row ────────────────────────────────────────────────
function ApptRow({
  appt,
  clientName,
  serviceName,
  statusColor,
  onPress,
  onMarkPaid,
  onReschedule,
}: {
  appt: Appointment;
  clientName: string;
  serviceName: string;
  statusColor: string;
  onPress: () => void;
  onMarkPaid: () => void;
  onReschedule: () => void;
}) {
  const colors = useColors();
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        swipeRef.current?.close();
        onMarkPaid();
      }}
      style={styles.swipeActionRight}
    >
      <View style={[styles.swipeActionInner, { backgroundColor: "#00C896" }]}>
        <IconSymbol name="checkmark.circle.fill" size={22} color="#fff" />
        <Text style={styles.swipeActionText}>Mark{"\n"}Paid</Text>
      </View>
    </Pressable>
  );

  const renderLeftActions = () => (
    <Pressable
      onPress={() => {
        swipeRef.current?.close();
        onReschedule();
      }}
      style={styles.swipeActionLeft}
    >
      <View style={[styles.swipeActionInner, { backgroundColor: "#0a7ea4" }]}>
        <IconSymbol name="calendar.badge.clock" size={22} color="#fff" />
        <Text style={styles.swipeActionText}>Reschedule</Text>
      </View>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      overshootRight={false}
      overshootLeft={false}
      friction={2}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.apptRow,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        {/* Status indicator */}
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
              {clientName}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {formatApptDate(appt.date)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
              {serviceName} · {formatApptTime(appt.time)}
            </Text>
            {appt.totalPrice != null && appt.totalPrice > 0 && (
              <Text style={{ fontSize: 13, fontWeight: "700", color: statusColor }}>
                ${appt.totalPrice.toLocaleString()}
              </Text>
            )}
          </View>
        </View>
        <IconSymbol name="chevron.right" size={14} color={colors.muted} style={{ marginLeft: 8 }} />
      </Pressable>
    </Swipeable>
  );
}

// ─── Status column content ────────────────────────────────────────────────────
function StatusColumn({
  statusKey,
  appointments,
  clients,
  services,
  onPressAppt,
  onMarkPaid,
  onReschedule,
  width,
}: {
  statusKey: AppointmentStatus | "all";
  appointments: Appointment[];
  clients: { id: string; name: string }[];
  services: { id: string; name: string }[];
  onPressAppt: (id: string) => void;
  onMarkPaid: (id: string) => void;
  onReschedule: (id: string) => void;
  width: number;
}) {
  const colors = useColors();
  const cfg = STATUSES.find((s) => s.key === statusKey) ?? STATUSES[0];
  const filtered = statusKey === "all" ? appointments : appointments.filter((a) => a.status === statusKey);

  const clientMap = useMemo(() => {
    const m: Record<string, string> = {};
    clients.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [clients]);

  const serviceMap = useMemo(() => {
    const m: Record<string, string> = {};
    services.forEach((s) => { m[s.id] = s.name; });
    return m;
  }, [services]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
    [filtered]
  );

  return (
    <View style={{ width }}>
      {/* Count badge */}
      <View style={[styles.countBadge, { backgroundColor: cfg.color + "18", borderColor: cfg.color + "40" }]}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: cfg.color }}>{sorted.length}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {cfg.key === "all" ? "Total" : cfg.label}
        </Text>
      </View>

      {/* Swipe hint */}
      {sorted.length > 0 && (
        <View style={styles.swipeHint}>
          <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center" }}>
            ← Reschedule  ·  Swipe rows  ·  Mark Paid →
          </Text>
        </View>
      )}

      {sorted.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>
            No {cfg.key === "all" ? "" : cfg.label.toLowerCase()} appointments in this period
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <ApptRow
              appt={item}
              clientName={clientMap[item.clientId] ?? "Unknown"}
              serviceName={serviceMap[item.serviceId] ?? "Service"}
              statusColor={cfg.color}
              onPress={() => onPressAppt(item.id)}
              onMarkPaid={() => onMarkPaid(item.id)}
              onReschedule={() => onReschedule(item.id)}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 24 }}
        />
      )}
    </View>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StatusDetailPage() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const { state, dispatch, syncToDb } = useStore();

  // Determine initial status from params
  const initialStatus = useMemo<AppointmentStatus | "all">(() => {
    const s = params.status;
    if (s === "completed" || s === "confirmed" || s === "pending" || s === "cancelled") return s;
    return "all";
  }, [params.status]);

  const [activeStatusIdx, setActiveStatusIdx] = useState(() =>
    STATUSES.findIndex((s) => s.key === initialStatus)
  );
  const [timeline, setTimeline] = useState<TimelineKey>("month");

  const statusScrollRef = useRef<ScrollView>(null);

  const { start, end } = useMemo(() => getDateRange(timeline), [timeline]);

  const filteredAppts = useMemo(() => {
    return state.appointments.filter((a) => a.date >= start && a.date <= end);
  }, [state.appointments, start, end]);

  const handleStatusScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / SCREEN_W);
      const clamped = Math.max(0, Math.min(idx, STATUSES.length - 1));
      if (clamped !== activeStatusIdx) setActiveStatusIdx(clamped);
    },
    [activeStatusIdx]
  );

  const scrollToStatus = useCallback(
    (idx: number) => {
      setActiveStatusIdx(idx);
      statusScrollRef.current?.scrollTo({ x: idx * SCREEN_W, animated: true });
    },
    []
  );

  const handleMarkPaid = useCallback((id: string) => {
    Alert.alert(
      "Mark as Paid",
      "Mark this appointment as completed and paid?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark Paid",
          style: "default",
          onPress: () => {
            const action = { type: "UPDATE_APPOINTMENT_STATUS" as const, payload: { id, status: "completed" as AppointmentStatus } };
            dispatch(action);
            syncToDb(action).catch(() => {});
          },
        },
      ]
    );
  }, [dispatch]);

  const handleReschedule = useCallback((id: string) => {
    router.push({ pathname: "/appointment-detail", params: { id } } as any);
  }, [router]);

  const activeStatus = STATUSES[activeStatusIdx];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, flex: 1, textAlign: "center" }}>
          Appointment Status
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Timeline filter */}
      <View style={[styles.timelineRow, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {TIMELINES.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTimeline(t.key)}
              style={[
                styles.timelineChip,
                {
                  backgroundColor: timeline === t.key ? activeStatus.color : colors.surface,
                  borderColor: timeline === t.key ? activeStatus.color : colors.border,
                },
              ]}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: timeline === t.key ? "#fff" : colors.muted }}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Status tab strip */}
      <View style={[styles.statusStrip, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}>
          {STATUSES.map((s, i) => {
            const count = s.key === "all"
              ? filteredAppts.length
              : filteredAppts.filter((a) => a.status === s.key).length;
            const isActive = i === activeStatusIdx;
            return (
              <Pressable
                key={s.key}
                onPress={() => scrollToStatus(i)}
                style={[
                  styles.statusTab,
                  {
                    backgroundColor: isActive ? s.color + "18" : "transparent",
                    borderBottomWidth: isActive ? 2 : 0,
                    borderBottomColor: s.color,
                  },
                ]}
              >
                <Text style={{ fontSize: 13, fontWeight: isActive ? "700" : "500", color: isActive ? s.color : colors.muted }}>
                  {s.label}
                </Text>
                <View style={[styles.countPill, { backgroundColor: s.color + "25" }]}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: s.color }}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Swipeable status columns */}
      <ScrollView
        ref={statusScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleStatusScrollEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
        contentOffset={{ x: activeStatusIdx * SCREEN_W, y: 0 }}
        style={{ flex: 1 }}
      >
        {STATUSES.map((s) => (
          <ScrollView key={s.key} style={{ width: SCREEN_W }} showsVerticalScrollIndicator={false}>
            <StatusColumn
              statusKey={s.key}
              appointments={filteredAppts}
              clients={state.clients}
              services={state.services}
              onPressAppt={(id) => router.push({ pathname: "/appointment-detail", params: { id } } as any)}
              onMarkPaid={handleMarkPaid}
              onReschedule={handleReschedule}
              width={SCREEN_W}
            />
          </ScrollView>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timelineRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timelineChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusStrip: {
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  countPill: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countBadge: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
  },
  swipeHint: {
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: -4,
  },
  emptyState: {
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  apptRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  swipeActionRight: {
    justifyContent: "center",
    marginBottom: 0,
  },
  swipeActionLeft: {
    justifyContent: "center",
  },
  swipeActionInner: {
    width: 72,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
  },
  swipeActionText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
});
