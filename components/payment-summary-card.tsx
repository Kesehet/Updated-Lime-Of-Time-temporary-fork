import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useMemo } from "react";
import type { Appointment } from "@/lib/types";

const ACCENT = "#00C896";

const METHOD_COLORS: Record<string, string> = {
  cash: "#22C55E",
  zelle: "#6366F1",
  venmo: "#3B82F6",
  cashapp: "#00C896",
  card: "#635BFF",
  free: "#9CA3AF",
  unpaid: "#EF4444",
};

const SLIDES = ["Status", "Payment", "By Service"] as const;
type Slide = typeof SLIDES[number];

export interface ServiceBreakdownItem {
  label: string;
  value: number;
  revenue?: number;
  color: string;
}

export interface StatusCounts {
  completed: number;
  confirmed: number;
  pending: number;
  cancelled: number;
}

export interface MethodBreakdownEntry {
  label: string;
  count: number;
  revenue: number;
}

export interface PaymentSummaryCardProps {
  paidRevenue: number;
  unpaidRevenue: number;
  paidCount: number;
  unpaidCount: number;
  giftRevenue?: number;
  giftCount?: number;
  methodBreakdown: Record<string, MethodBreakdownEntry>;
  serviceBreakdown: ServiceBreakdownItem[];
  statusCounts: StatusCounts;
  totalAppointments: number;
  /** Full appointments array for local timeline filtering in the Status slide */
  appointments?: Appointment[];
  width: number;
  onPressPaid?: () => void;
  onPressUnpaid?: () => void;
  onPressFullSummary?: () => void;
  onPressStatus?: (status: string) => void;
  onPressService?: (serviceLabel: string) => void;
  onPressMethod?: (method: string) => void;
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
function DonutChart({
  data,
  size = 96,
  selectedIdx,
  onPressSegment,
}: {
  data: ServiceBreakdownItem[];
  size?: number;
  selectedIdx: number | null;
  onPressSegment: (idx: number) => void;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 16;

  let offset = 0;
  const segments = data.slice(0, 6).map((item, idx) => {
    const pct = item.value / total;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const rotation = offset * 360 - 90;
    offset += pct;
    return { ...item, dash, gap, rotation, idx };
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G>
          {segments.map((seg) => (
            <Circle
              key={seg.idx}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={selectedIdx === seg.idx ? strokeWidth + 3 : strokeWidth}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={0}
              strokeLinecap="round"
              transform={`rotate(${seg.rotation} ${cx} ${cy})`}
              opacity={selectedIdx === null || selectedIdx === seg.idx ? 0.92 : 0.45}
            />
          ))}
        </G>
      </Svg>
      {/* Invisible pressable overlay per segment is complex in SVG — use a single tap to cycle */}
      <Pressable
        onPress={() => {
          const next = selectedIdx === null ? 0 : (selectedIdx + 1) % segments.length;
          onPressSegment(next);
        }}
        style={{ position: "absolute", top: 0, left: 0, width: size, height: size, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ alignItems: "center" }}>
          {selectedIdx !== null && selectedIdx < segments.length ? (
            <>
              <Text style={{ fontSize: 15, fontWeight: "800", color: segments[selectedIdx].color }}>
                {segments[selectedIdx].value}
              </Text>
              <Text style={{ fontSize: 9, color: "#888", fontWeight: "600", textAlign: "center", maxWidth: 44 }} numberOfLines={2}>
                {segments[selectedIdx].label}
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 17, fontWeight: "800", color: "#fff" }}>{total}</Text>
              <Text style={{ fontSize: 9, color: "#888", fontWeight: "600" }}>TOTAL</Text>
            </>
          )}
        </View>
      </Pressable>
    </View>
  );
}

// ─── By Service Slide ─────────────────────────────────────────────────────────
function ServiceSlide({
  data,
  width,
  onPressService,
}: {
  data: ServiceBreakdownItem[];
  width: number;
  onPressService?: (label: string) => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const displayData = expanded ? data : data.slice(0, 5);

  if (data.length === 0) {
    return (
      <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 13, color: colors.muted }}>No service data yet</Text>
      </View>
    );
  }

  return (
    <View>
      {/* Donut + legend row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <DonutChart
          data={data}
          size={96}
          selectedIdx={selectedIdx}
          onPressSegment={(idx) => {
            setSelectedIdx((prev) => (prev === idx ? null : idx));
            if (onPressService) onPressService(data[idx]?.label ?? "");
          }}
        />

        {/* Legend */}
        <View style={{ flex: 1, gap: 5 }}>
          {displayData.map((item, i) => {
            const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
            const isSelected = selectedIdx === i;
            return (
              <Pressable
                key={i}
                onPress={() => {
                  setSelectedIdx((prev) => (prev === i ? null : i));
                  if (onPressService) onPressService(item.label);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  opacity: pressed ? 0.7 : 1,
                  backgroundColor: isSelected ? item.color + "18" : "transparent",
                  borderRadius: 6,
                  paddingVertical: 2,
                  paddingHorizontal: 3,
                })}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color, flexShrink: 0 }} />
                <Text style={{ fontSize: 11, color: colors.foreground, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>{pct}%</Text>
                <Text style={{ fontSize: 11, fontWeight: "700", color: item.color }}>{item.value}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Revenue per service rows */}
      {data.some((d) => (d.revenue ?? 0) > 0) && (
        <View style={{ marginTop: 10, gap: 4 }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", marginBottom: 2 }}>REVENUE BY SERVICE</Text>
          {displayData.filter((d) => (d.revenue ?? 0) > 0).map((item, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.color }} />
                <Text style={{ fontSize: 12, color: colors.foreground, flex: 1 }} numberOfLines={1}>{item.label}</Text>
              </View>
              <Text style={{ fontSize: 12, fontWeight: "700", color: item.color }}>
                {item.value} appt{item.value !== 1 ? "s" : ""} · ${(item.revenue ?? 0).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* View Data expand button */}
      {data.length > 5 && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => ({
            marginTop: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            paddingVertical: 7,
            borderRadius: 10,
            backgroundColor: colors.primary + "15",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary }}>
            {expanded ? "Show Less" : `View All ${data.length} Services`}
          </Text>
          <IconSymbol
            name="chevron.right"
            size={12}
            color={colors.primary}
            style={{ transform: [{ rotate: expanded ? "-90deg" : "90deg" }] }}
          />
        </Pressable>
      )}
    </View>
  );
}

// ─── Status Slide ─────────────────────────────────────────────────────────────
type StatusTimeline = "today" | "week" | "month" | "all";
const STATUS_TIMELINES: { key: StatusTimeline; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All" },
];

function StatusSlide({
  statusCounts,
  total,
  appointments,
  onPressStatus,
}: {
  statusCounts: StatusCounts;
  total: number;
  appointments?: Appointment[];
  onPressStatus?: (status: string) => void;
}) {
  const colors = useColors();
  const [timeline, setTimeline] = useState<StatusTimeline>("month");

  // Compute filtered counts based on selected timeline
  // rangeEnd extends to end of the period (not just today) so future confirmed/pending appts are included
  const filteredCounts = useMemo((): StatusCounts => {
    if (!appointments || appointments.length === 0) return statusCounts;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let rangeStart = "2000-01-01";
    let rangeEnd = "2099-12-31";
    if (timeline === "today") {
      rangeStart = todayStr;
      rangeEnd = todayStr;
    } else if (timeline === "week") {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      rangeStart = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`;
      rangeEnd = `${weekEnd.getFullYear()}-${pad(weekEnd.getMonth() + 1)}-${pad(weekEnd.getDate())}`;
    } else if (timeline === "month") {
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      rangeStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      rangeEnd = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;
    }
    const ranged = appointments.filter((a) => a.date >= rangeStart && a.date <= rangeEnd);
    return {
      completed: ranged.filter((a) => a.status === "completed").length,
      confirmed: ranged.filter((a) => a.status === "confirmed").length,
      pending: ranged.filter((a) => a.status === "pending").length,
      cancelled: ranged.filter((a) => a.status === "cancelled").length,
    };
  }, [appointments, timeline, statusCounts]);

  // Per-tab total counts for badges — also extend to full period (not just past)
  const tabCounts = useMemo((): Record<StatusTimeline, number> => {
    if (!appointments || appointments.length === 0) return { today: 0, week: 0, month: 0, all: 0 };
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekStartStr = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`;
    const weekEndStr = `${weekEnd.getFullYear()}-${pad(weekEnd.getMonth() + 1)}-${pad(weekEnd.getDate())}`;
    const monthStartStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthEndStr = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;
    const count = (start: string, end: string) =>
      appointments.filter((a) => a.date >= start && a.date <= end).length;
    return {
      today: count(todayStr, todayStr),
      week: count(weekStartStr, weekEndStr),
      month: count(monthStartStr, monthEndStr),
      all: appointments.length,
    };
  }, [appointments]);

  const filteredTotal = filteredCounts.completed + filteredCounts.confirmed + filteredCounts.pending + filteredCounts.cancelled;

  const statuses = [
    { key: "completed", label: "Completed", value: filteredCounts.completed, color: ACCENT, icon: "checkmark.circle.fill" as const },
    { key: "confirmed", label: "Confirmed", value: filteredCounts.confirmed, color: colors.primary, icon: "paperplane.fill" as const },
    { key: "pending", label: "Pending", value: filteredCounts.pending, color: "#FF9800", icon: "chevron.right" as const },
    { key: "cancelled", label: "Cancelled", value: filteredCounts.cancelled, color: colors.error, icon: "xmark.circle.fill" as const },
  ];

  return (
    <View style={{ gap: 8 }}>
      {/* Timeline filter */}
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
        {STATUS_TIMELINES.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => {
              setTimeline(t.key);
            }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: timeline === t.key ? ACCENT + "20" : colors.border + "50",
              borderWidth: 1,
              borderColor: timeline === t.key ? ACCENT : "transparent",
              opacity: pressed ? 0.7 : 1,
              gap: 1,
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: timeline === t.key ? ACCENT : colors.muted }}>
              {t.label}
            </Text>
            <Text style={{ fontSize: 10, fontWeight: "600", color: timeline === t.key ? ACCENT : colors.muted, opacity: 0.8 }}>
              {tabCounts[t.key]}
            </Text>
          </Pressable>
        ))}
      </View>

      {statuses.map((item) => {
        const pct = filteredTotal > 0 ? item.value / filteredTotal : 0;
        return (
          <Pressable
            key={item.key}
            onPress={() => onPressStatus?.(item.key)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.75 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: item.color + "12",
              borderRadius: 10,
              padding: 10,
            })}
          >
            {/* Icon badge */}
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: item.color + "25", alignItems: "center", justifyContent: "center" }}>
              <IconSymbol name={item.icon} size={16} color={item.color} />
            </View>
            {/* Label + bar */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>{item.label}</Text>
                <Text style={{ fontSize: 14, fontWeight: "800", color: item.color }}>{item.value}</Text>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: item.color, width: `${Math.round(pct * 100)}%` as any }} />
              </View>
            </View>
            <IconSymbol name="chevron.right" size={12} color={colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function PaymentSummaryCard({
  paidRevenue,
  unpaidRevenue,
  paidCount,
  unpaidCount,
  giftRevenue = 0,
  giftCount = 0,
  methodBreakdown,
  serviceBreakdown,
  statusCounts,
  totalAppointments,
  appointments,
  width,
  onPressPaid,
  onPressUnpaid,
  onPressFullSummary,
  onPressStatus,
  onPressService,
  onPressMethod,
}: PaymentSummaryCardProps) {
  const colors = useColors();
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / width);
      const clamped = Math.max(0, Math.min(idx, SLIDES.length - 1));
      if (clamped !== activeIdx) setActiveIdx(clamped);
    },
    [activeIdx, width]
  );

  const totalRevenue = paidRevenue + unpaidRevenue;
  const collectedPct = totalRevenue > 0 ? Math.round((paidRevenue / totalRevenue) * 100) : 0;
  const totalAppts = totalAppointments + statusCounts.cancelled;

  // Slide-specific header config
  const slideConfig = [
    { title: "Status", icon: "checkmark.circle.fill" as const, iconColor: "#00C896", action: () => onPressStatus?.("all"), actionLabel: "View All" },
    { title: "Payment Summary", icon: "dollarsign.circle.fill" as const, iconColor: ACCENT, action: onPressFullSummary, actionLabel: "Full Summary" },
    { title: "By Service", icon: "paperplane.fill" as const, iconColor: "#A78BFA", action: undefined, actionLabel: undefined },
  ];
  const cfg = slideConfig[activeIdx];

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: cfg.iconColor + "22", alignItems: "center", justifyContent: "center" }}>
            <IconSymbol name={cfg.icon} size={18} color={cfg.iconColor} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{cfg.title}</Text>
        </View>
        {cfg.action && cfg.actionLabel && (
          <Pressable
            onPress={cfg.action}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: colors.primary + "15",
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 5,
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary }}>{cfg.actionLabel}</Text>
            <IconSymbol name="chevron.right" size={12} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {/* Swipeable slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={width}
        snapToAlignment="start"
        style={{ width }}
      >
        {/* Slide 1: Status */}
        <View style={{ width, paddingHorizontal: 16, paddingBottom: 12 }}>
          <StatusSlide
            statusCounts={statusCounts}
            total={totalAppts}
            appointments={appointments}
            onPressStatus={onPressStatus}
          />
        </View>

        {/* Slide 2: Payment */}
        <View style={{ width, paddingHorizontal: 16, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
              onPress={onPressPaid}
              style={({ pressed }) => ({ flex: 1, backgroundColor: ACCENT + "18", borderRadius: 12, padding: 12, opacity: pressed ? 0.75 : 1 })}
            >
              <Text style={{ fontSize: 11, fontWeight: "600", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Paid</Text>
              <Text style={{ fontSize: 20, fontWeight: "800", color: ACCENT }}>${paidRevenue.toLocaleString()}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{paidCount} appointment{paidCount !== 1 ? "s" : ""}</Text>
            </Pressable>
            <Pressable
              onPress={onPressUnpaid}
              style={({ pressed }) => ({ flex: 1, backgroundColor: colors.error + "15", borderRadius: 12, padding: 12, opacity: pressed ? 0.75 : 1 })}
            >
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.error, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Outstanding</Text>
              <Text style={{ fontSize: 20, fontWeight: "800", color: colors.error }}>${unpaidRevenue.toLocaleString()}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{unpaidCount} appointment{unpaidCount !== 1 ? "s" : ""}</Text>
            </Pressable>
          </View>

          {/* Payment method breakdown */}
          {Object.keys(methodBreakdown).length > 0 && (
            <View style={{ marginTop: 12, gap: 0 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>By Payment Method</Text>
              {Object.entries(methodBreakdown)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([method, entry], idx, arr) => (
                <Pressable
                  key={method}
                  onPress={() => onPressMethod?.(method)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 8,
                    borderBottomWidth: idx < arr.length - 1 ? 0.5 : 0,
                    borderBottomColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {/* Color dot */}
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: METHOD_COLORS[method] ?? ACCENT, marginRight: 8 }} />
                  {/* Method name */}
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1 }}>{entry.label}</Text>
                  {/* Count */}
                  <Text style={{ fontSize: 12, color: colors.muted, marginRight: 10 }}>{entry.count} appt{entry.count !== 1 ? "s" : ""}</Text>
                  {/* Revenue */}
                  <Text style={{ fontSize: 13, fontWeight: "800", color: METHOD_COLORS[method] ?? ACCENT }}>${entry.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  <IconSymbol name="chevron.right" size={11} color={colors.muted} style={{ marginLeft: 4 }} />
                </Pressable>
              ))}
            </View>
          )}

          {/* Gift Redeemed line */}
          {giftCount > 0 && (
            <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' }} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>🎁 Gift Redeemed</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#22C55E' }}>${giftRevenue.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{giftCount} appt{giftCount !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          )}

          {/* Progress bar */}
          {totalRevenue > 0 && (
            <View style={{ marginTop: 10 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: ACCENT, width: `${collectedPct}%` as any }} />
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{collectedPct}% collected</Text>
            </View>
          )}
        </View>

        {/* Slide 3: By Service */}
        <View style={{ width, paddingHorizontal: 16, paddingBottom: 12 }}>
          <ServiceSlide data={serviceBreakdown} width={width - 32} onPressService={onPressService} />
        </View>
      </ScrollView>

      {/* Page dots */}
      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === activeIdx ? ACCENT : colors.border,
                  width: i === activeIdx ? 16 : 5,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 12,
    paddingTop: 4,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },
});
