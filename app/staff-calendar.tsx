import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, formatTime, formatDateStr, formatDateDisplay } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import {
  StaffMember,
  Appointment,
  isDateInPast,
  getServiceDisplayName,
  formatTimeDisplay,
  minutesToTime,
  timeToMinutes,
  DAYS_OF_WEEK,
} from "@/lib/types";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";
import { FuturisticBackground } from "@/components/futuristic-background";


const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_MAP = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function StaffCalendarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, getServiceById, getClientById, getStaffById } = useStore();
  const { activeLocation } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, width, fs, buttonHeight, iconButtonSize } = useResponsive();

  const staff = getStaffById(id ?? "");
  const now = new Date();
  // Live clock for the current-time indicator — updates every 30 seconds
  const [liveNow, setLiveNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setLiveNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [selectedDate, setSelectedDate] = useState(formatDateStr(now));
  const [viewMode, setViewMode] = useState<"calendar" | "timeline">("calendar");

  // Timeline scroll ref for auto-scroll to current hour
  const staffTimelineRef = useRef<any>(null);

  // Auto-scroll to current hour when timeline view opens
  useEffect(() => {
    if (viewMode !== "timeline" || !staffTimelineRef.current) return;
    const currentHour = new Date().getHours();
    const targetY = Math.max(0, (currentHour - 1) * 60);
    setTimeout(() => {
      staffTimelineRef.current?.scrollTo({ y: targetY, animated: true });
    }, 300);
  }, [viewMode]);

  const cellSize = Math.floor((width - hp * 2) / 7);
  const todayStr = formatDateStr(now);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [currentMonth, currentYear]);

  // All appointments for this staff member (matched by notes containing "Preferred staff: <name>")
  const staffAppointments = useMemo(() => {
    if (!staff) return [];
    return state.appointments.filter((a) => {
      // Match by staffId field
      if (a.staffId === staff.id) return true;
      // Also match by notes containing staff name (for bookings from the web page)
      if (a.notes && a.notes.includes(`Preferred staff: ${staff.name}`)) return true;
      return false;
    });
  }, [state.appointments, staff]);

  // Day statuses for dots
  const dayStatuses = useMemo(() => {
    const statuses: Record<string, Set<string>> = {};
    staffAppointments.forEach((a) => {
      if (!statuses[a.date]) statuses[a.date] = new Set();
      statuses[a.date].add(a.status);
    });
    return statuses;
  }, [staffAppointments]);

  // Selected date appointments
  const selectedDateAppts = useMemo(() => {
    return staffAppointments
      .filter((a) => a.date === selectedDate)
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [staffAppointments, selectedDate]);

  // Effective business hours for the selected date:
  // 1. Use staff custom working hours if set
  // 2. Otherwise fall back to assigned location's business hours (first assigned location)
  // 3. Otherwise fall back to global business hours
  const selectedDaySchedule = useMemo(() => {
    const d = new Date(selectedDate + "T12:00:00");
    const dayName = DAY_MAP[d.getDay()];

    // Staff custom schedule takes priority
    if (staff?.workingHours) {
      const staffDay = (staff.workingHours as any)[dayName];
      if (staffDay) {
        // Constrain to location hours if available
        const assignedLocId = staff.locationIds?.[0];
        const assignedLoc = assignedLocId ? state.locations.find((l) => l.id === assignedLocId) : null;
        const locDay = assignedLoc?.workingHours ? (assignedLoc.workingHours as any)[dayName] : null;
        if (locDay && locDay.enabled) {
          // Clamp staff hours within location hours
          const locStart = timeToMinutes(locDay.start);
          const locEnd = timeToMinutes(locDay.end);
          const staffStart = timeToMinutes(staffDay.start);
          const staffEnd = timeToMinutes(staffDay.end);
          return {
            enabled: staffDay.enabled && locDay.enabled,
            start: minutesToTime(Math.max(staffStart, locStart)),
            end: minutesToTime(Math.min(staffEnd, locEnd)),
          };
        }
        return staffDay;
      }
    }

    // Fall back to assigned location's business hours
    const assignedLocId = staff?.locationIds?.[0];
    const assignedLoc = assignedLocId ? state.locations.find((l) => l.id === assignedLocId) : null;
    if (assignedLoc?.workingHours) {
      return (assignedLoc.workingHours as any)[dayName] ?? null;
    }

    // Fall back to global business hours
    const globalDay = state.settings.workingHours?.[dayName];
    return globalDay ?? null;
  }, [staff, selectedDate, state.locations, state.settings.workingHours]);

  // Stats
  const stats = useMemo(() => {
    const upcoming = staffAppointments.filter((a) => a.status === "confirmed" && a.date >= todayStr).length;
    const pending = staffAppointments.filter((a) => a.status === "pending").length;
    const completed = staffAppointments.filter((a) => a.status === "completed").length;
    const totalRevenue = staffAppointments
      .filter((a) => a.status === "confirmed" || a.status === "completed")
      .reduce((sum, a) => {
        const svc = getServiceById(a.serviceId);
        return sum + (a.totalPrice ?? svc?.price ?? 0);
      }, 0);
    return { upcoming, pending, completed, totalRevenue };
  }, [staffAppointments, todayStr, getServiceById]);

  // Timeline hours (12 AM – 11 PM, full 24h)
  const timelineHours = useMemo(() => {
    const hours: string[] = [];
    for (let h = 0; h <= 23; h++) {
      hours.push(`${String(h).padStart(2, "0")}:00`);
    }
    return hours;
  }, []);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
  };

  const getEndTime = (time: string, duration: number): string => {
    return formatTimeDisplay(minutesToTime(timeToMinutes(time) + duration));
  };

  // ─── .ics Calendar Export ────────────────────────────────────────────
  const exportICS = async () => {
    if (!staff) return;
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//LimeOfTime//StaffCalendar//EN",
      `X-WR-CALNAME:${staff.name}'s Schedule`,
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];
    staffAppointments
      .filter((a) => a.status === "confirmed" || a.status === "pending")
      .forEach((a) => {
        const svc = getServiceById(a.serviceId);
        const client = getClientById(a.clientId);
        const [yr, mo, dy] = a.date.split("-").map(Number);
        const [hr, mn] = a.time.split(":").map(Number);
        const dur = svc?.duration ?? 30;
        const endMins = hr * 60 + mn + dur;
        const endHr = Math.floor(endMins / 60);
        const endMn = endMins % 60;
        const pad = (n: number) => String(n).padStart(2, "0");
        const dtStart = `${yr}${pad(mo)}${pad(dy)}T${pad(hr)}${pad(mn)}00`;
        const dtEnd = `${yr}${pad(mo)}${pad(dy)}T${pad(endHr)}${pad(endMn)}00`;
        lines.push(
          "BEGIN:VEVENT",
          `UID:${a.id}@lime-of-time.com`,
          `DTSTART:${dtStart}`,
          `DTEND:${dtEnd}`,
          `SUMMARY:${svc?.name ?? "Appointment"} - ${client?.name ?? "Client"}`,
          `DESCRIPTION:Status: ${a.status}`,
          `STATUS:${a.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
          "END:VEVENT",
        );
      });
    lines.push("END:VCALENDAR");
    const icsContent = lines.join("\r\n");
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([icsContent], { type: "text/calendar" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${staff.name.replace(/\s+/g, "_")}_schedule.ics`;
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        const path = `${FileSystem.cacheDirectory}${staff.name.replace(/\s+/g, "_")}_schedule.ics`;
        await FileSystem.writeAsStringAsync(path, icsContent, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(path, { mimeType: "text/calendar", dialogTitle: `${staff.name}'s Schedule` });
        } else {
          Alert.alert("Sharing not available", "Cannot share files on this device.");
        }
      }
    } catch {
      Alert.alert("Export failed", "Could not generate the calendar file.");
    }
  };

  if (!staff) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} className="p-6">
      <FuturisticBackground />
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 12 })}>
            <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground }}>Staff Calendar</Text>
        </View>
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>Staff member not found</Text>
      </ScreenContainer>
    );
  }

  // Assigned services
  const assignedServices = staff.serviceIds
    ? state.services.filter((s) => staff.serviceIds!.includes(s.id))
    : state.services;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={900}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: hp, paddingTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 12 })}>
              <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: staff.color || "#6366f1", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                <Text style={{ color: "#FFF", fontWeight: "700", fontSize: fs.md }}>{staff.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.foreground }}>{staff.name}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>{staff.role || "Staff Member"}</Text>
              </View>
            </View>
            <Pressable
              onPress={exportICS}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                backgroundColor: colors.surface,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              })}
            >
              <IconSymbol name="paperplane.fill" size={14} color={colors.primary} />
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>Export .ics</Text>
            </Pressable>
          </View>
        </View>

        {/* Temporarily Closed Banner */}
        {activeLocation?.temporarilyClosed && (
          <View style={{
            marginHorizontal: hp, marginBottom: 12,
            backgroundColor: colors.error + "18",
            borderColor: colors.error + "60",
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}>
            <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.error }}>Location Temporarily Closed</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                {activeLocation.reopenOn
                  ? `All dates unavailable. Reopens ${new Date(activeLocation.reopenOn + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
                  : "All dates unavailable. Closed indefinitely — no new bookings."}
              </Text>
            </View>
          </View>
        )}

        {/* Stats Row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: hp, marginBottom: 12 }}>
          <View style={[styles.statCard, { backgroundColor: colors.success + "15", borderColor: colors.success + "30" }]}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.success }}>{stats.upcoming}</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Upcoming</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#FF9800" + "15", borderColor: "#FF9800" + "30" }]}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#FF9800" }}>{stats.pending}</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Pending</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>{stats.completed}</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Completed</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.foreground + "08", borderColor: colors.border }]}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>${stats.totalRevenue.toFixed(0)}</Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Revenue</Text>
          </View>
        </ScrollView>

        {/* View Mode Toggle */}
        <View style={{ flexDirection: "row", paddingHorizontal: hp, marginBottom: 12, gap: 8 }}>
          <Pressable
            onPress={() => setViewMode("calendar")}
            style={({ pressed }) => [styles.viewToggle, { backgroundColor: viewMode === "calendar" ? colors.primary : colors.surface, borderColor: viewMode === "calendar" ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: viewMode === "calendar" ? "#FFF" : colors.foreground }}>Calendar</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode("timeline")}
            style={({ pressed }) => [styles.viewToggle, { backgroundColor: viewMode === "timeline" ? colors.primary : colors.surface, borderColor: viewMode === "timeline" ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: viewMode === "timeline" ? "#FFF" : colors.foreground }}>Timeline</Text>
          </Pressable>
        </View>

        {/* Month Header */}
        <View style={[styles.monthHeader, { paddingHorizontal: hp }]}>
          <Pressable onPress={prevMonth} style={({ pressed }) => [styles.navBtn, { opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="chevron.left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.monthTitle, { color: colors.foreground }]}>
            {MONTH_NAMES[currentMonth]} {currentYear}
          </Text>
          <Pressable onPress={nextMonth} style={({ pressed }) => [styles.navBtn, { opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="chevron.right" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Day Headers */}
        <View style={[styles.dayHeaderRow, { paddingHorizontal: hp }]}>
          {DAY_HEADERS.map((d) => (
            <View key={d} style={{ width: cellSize, alignItems: "center" }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Calendar Grid */}
        <View style={[styles.calendarGrid, { paddingHorizontal: hp }]}>
          {calendarDays.map((day, idx) => {
            if (day === null) return <View key={`e-${idx}`} style={{ width: cellSize, height: cellSize }} />;
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === todayStr;
            const statuses = dayStatuses[dateStr];

            // Check if staff works this day
            const d = new Date(dateStr + "T12:00:00");
            const dayName = DAY_MAP[d.getDay()];
            const isWorkingDay = staff.workingHours
              ? (staff.workingHours[dayName]?.enabled ?? false)
              : true;
            const isPast = dateStr < todayStr;
            // Also disable all days when location is temporarily closed
            const isDisabled = !isWorkingDay || isPast || !!activeLocation?.temporarilyClosed;
            // Red tint for future days when location is temporarily closed
            const isTempClosed = !!activeLocation?.temporarilyClosed && !isPast;

            return (
              <Pressable
                key={dateStr}
                onPress={() => { if (!isDisabled) setSelectedDate(dateStr); }}
                style={({ pressed }) => [
                  styles.dayCell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: isSelected
                      ? (isTempClosed ? colors.error : (staff.color || colors.primary))
                      : isTempClosed
                      ? colors.error + "18"
                      : "transparent",
                    borderRadius: cellSize / 2,
                    opacity: (isDisabled && !isTempClosed) ? 0.25 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: fs.sm,
                    fontWeight: isToday || isSelected ? "700" : "400",
                    color: isSelected
                      ? "#FFF"
                      : isTempClosed
                      ? colors.error
                      : isToday
                      ? (staff.color || colors.primary)
                      : colors.foreground,
                    textDecorationLine: isTempClosed ? "line-through" : "none",
                  }}
                >
                  {day}
                </Text>
                <View style={styles.dotsRow}>
                  {statuses?.has("confirmed") && <View style={[styles.dot, { backgroundColor: "#1B5E20" }]} />}
                  {statuses?.has("pending") && <View style={[styles.dot, { backgroundColor: "#FF9800" }]} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Working Hours for Selected Day */}
        {selectedDaySchedule && (
          <View style={{ paddingHorizontal: hp, marginTop: 8, marginBottom: 4 }}>
            <View style={[styles.scheduleBar, { backgroundColor: (staff.color || colors.primary) + "12", borderColor: (staff.color || colors.primary) + "30" }]}>
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: staff.color || colors.primary }}>
                {selectedDaySchedule.enabled
                  ? `Working: ${formatTimeDisplay(selectedDaySchedule.start)} - ${formatTimeDisplay(selectedDaySchedule.end)}`
                  : "Day Off"}
              </Text>
            </View>
          </View>
        )}

        {/* View Content */}
        {viewMode === "calendar" ? (
          /* Calendar View: Appointment List */
          <View style={{ paddingHorizontal: hp, marginTop: 8 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {formatDateDisplay(selectedDate)}
            </Text>
            {selectedDateAppts.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ color: colors.muted, fontSize: fs.xs }}>No appointments on this day</Text>
              </View>
            ) : (
              selectedDateAppts.map((appt) => {
                const svc = getServiceById(appt.serviceId);
                const client = getClientById(appt.clientId);
                const statusColor =
                  appt.status === "confirmed" ? "#1B5E20"
                  : appt.status === "pending" ? "#FF9800"
                  : appt.status === "completed" ? colors.primary
                  : "#F44336";
                return (
                  <Pressable
                    key={appt.id}
                    onPress={() => router.push({ pathname: "/appointment-detail", params: { id: appt.id } })}
                    style={({ pressed }) => [styles.apptCard, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: svc?.color ?? (staff.color || colors.primary), opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>
                        {formatTime(appt.time)} - {getEndTime(appt.time, appt.duration)}
                      </Text>
                      <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.foreground, marginTop: 2 }}>
                        {svc ? getServiceDisplayName(svc) : "Service"}
                      </Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>{client?.name}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
                      <Text style={{ fontSize: fs.xs, fontWeight: "600", color: statusColor, textTransform: "capitalize" }}>{appt.status}</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : (
          /* Timeline View — absolute-positioned blocks, no duplication */
          (() => {
            const STAFF_TIMELINE_START = 0;
            const STAFF_TIMELINE_END = 23;
            const STAFF_HOUR_HEIGHT = 60;
            const LABEL_WIDTH = 60;
            const totalHours = STAFF_TIMELINE_END - STAFF_TIMELINE_START + 1;
            const gridHeight = totalHours * STAFF_HOUR_HEIGHT;
            const isToday = selectedDate === formatDateStr(liveNow);
            const nowMinutes = liveNow.getHours() * 60 + liveNow.getMinutes();
            const nowTop = (nowMinutes - STAFF_TIMELINE_START * 60) * (STAFF_HOUR_HEIGHT / 60);
            const showNowLine = isToday && nowTop >= 0 && nowTop <= gridHeight;
            const nowPillLabel = liveNow.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "\u202f");
            return (
              <View style={{ paddingHorizontal: hp, marginTop: 8 }}>
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 4 }]}>
                  {formatDateDisplay(selectedDate)} — Timeline
                </Text>
                <View style={{ position: 'relative' }}>
                <ScrollView ref={staffTimelineRef} style={{ height: 480 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                <View style={[styles.timelineContainer, { borderColor: colors.border, position: "relative" }]}>
                  {/* Hour grid rows */}
                  {timelineHours.map((hour) => {
                    const isWorkingHour = selectedDaySchedule?.enabled
                      ? timeToMinutes(hour) >= timeToMinutes(selectedDaySchedule.start) && timeToMinutes(hour) < timeToMinutes(selectedDaySchedule.end)
                      : true;
                    return (
                      <View key={hour} style={[styles.timelineRow, { borderBottomColor: colors.border, height: STAFF_HOUR_HEIGHT }]}>
                        <View style={[styles.timelineLabel, { opacity: isWorkingHour ? 1 : 0.4 }]}>
                          <Text
                            style={{ fontSize: 10, fontWeight: "500", color: colors.muted }}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                          >
                            {formatTimeDisplay(hour)}
                          </Text>
                        </View>
                        <View style={[styles.timelineSlot, { backgroundColor: isWorkingHour ? "transparent" : colors.surface + "60" }]} />
                      </View>
                    );
                  })}
                  {/* Absolutely-positioned appointment blocks */}
                  {selectedDateAppts.map((appt) => {
                    const svc = getServiceById(appt.serviceId);
                    const client = getClientById(appt.clientId);
                    const color = svc?.color ?? staff.color ?? colors.primary;
                    const startMin = timeToMinutes(appt.time);
                    const top = (startMin - STAFF_TIMELINE_START * 60) * (STAFF_HOUR_HEIGHT / 60);
                    const height = Math.max(appt.duration * (STAFF_HOUR_HEIGHT / 60), 28);
                    if (top < 0 || top > gridHeight) return null;
                    return (
                      <Pressable
                        key={appt.id}
                        onPress={() => router.push({ pathname: "/appointment-detail", params: { id: appt.id } })}
                        style={({ pressed }) => ([
                          styles.timelineApptAbs,
                          {
                            top,
                            height,
                            left: LABEL_WIDTH + 4,
                            right: 4,
                            backgroundColor: color + "22",
                            borderLeftColor: color,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ])}
                      >
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                          {formatTime(appt.time)} {svc ? getServiceDisplayName(svc) : "Service"} ({appt.duration} min)
                        </Text>
                        {height > 36 && (
                          <Text style={{ fontSize: 10, color: colors.muted }} numberOfLines={1}>{client?.name}</Text>
                        )}
                      </Pressable>
                    );
                  })}
                  {/* iOS-style live current-time indicator */}
                  {showNowLine && (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        top: nowTop - 9,
                        left: 0,
                        right: 0,
                        height: 18,
                        zIndex: 20,
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                    >
                      {/* Red pill with time label */}
                      <View style={{
                        backgroundColor: "#EF4444",
                        borderRadius: 9,
                        paddingHorizontal: 5,
                        paddingVertical: 2,
                        minWidth: LABEL_WIDTH - 2,
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: "#fff", letterSpacing: 0.2 }}>
                          {nowPillLabel}
                        </Text>
                      </View>
                      {/* Full-width red line */}
                      <View style={{ flex: 1, height: 1.5, backgroundColor: "#EF4444" }} />
                    </View>
                  )}
                </View>
                </ScrollView>
                {/* Floating Jump to Now pill */}
                <Pressable
                  onPress={() => {
                    if (!staffTimelineRef.current) return;
                    const now = new Date();
                    const targetY = Math.max(0, (now.getHours() - 1) * STAFF_HOUR_HEIGHT);
                    staffTimelineRef.current.scrollTo({ y: targetY, animated: true });
                  }}
                  style={({ pressed }) => [{
                    position: 'absolute',
                    bottom: 12,
                    alignSelf: 'center',
                    left: '50%',
                    transform: [{ translateX: -44 }],
                    backgroundColor: colors.primary,
                    borderRadius: 20,
                    paddingHorizontal: 16,
                    paddingVertical: 7,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.18,
                    shadowRadius: 4,
                    elevation: 4,
                    opacity: pressed ? 0.75 : 1,
                  }]}
                >
                  <IconSymbol name="clock.fill" size={13} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: fs.xs, fontWeight: '700' }}>Jump to Now</Text>
                </Pressable>
                </View>
              </View>
            );
          })()
        )}

        {/* Assigned Services */}
        <View style={{ paddingHorizontal: hp, marginTop: 20 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Assigned Services</Text>
          {assignedServices.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: fs.xs }}>No services assigned</Text>
          ) : (
            assignedServices.map((svc) => (
              <View key={svc.id} style={[styles.serviceChip, { backgroundColor: (svc.color || colors.primary) + "15", borderColor: (svc.color || colors.primary) + "30" }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: svc.color || colors.primary, marginRight: 8 }} />
                <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.foreground, flex: 1 }}>{getServiceDisplayName(svc)}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>{svc.duration} min · ${svc.price}</Text>
              </View>
            ))
          )}
        </View>

        {/* Weekly Schedule */}
        {staff.workingHours && (
          <View style={{ paddingHorizontal: hp, marginTop: 20 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Weekly Schedule</Text>
            {DAYS_OF_WEEK.map((day) => {
              const schedule = staff.workingHours?.[day];
              const isEnabled = schedule?.enabled ?? false;
              return (
                <View key={day} style={[styles.scheduleRow, { borderBottomColor: colors.border }]}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, width: 90, textTransform: "capitalize" }}>{day}</Text>
                  {isEnabled && schedule ? (
                    <Text style={{ fontSize: fs.xs, color: colors.foreground }}>
                      {formatTimeDisplay(schedule.start)} - {formatTimeDisplay(schedule.end)}
                    </Text>
                  ) : (
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Day Off</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  statCard: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginRight: 10, alignItems: "center", minWidth: 80 },
  viewToggle: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  monthTitle: { fontSize: 15, fontWeight: "700" },
  navBtn: { padding: 8 },
  dayHeaderRow: { flexDirection: "row", marginBottom: 4 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", width: "100%" },
  dayCell: { alignItems: "center", justifyContent: "center" },
  dotsRow: { flexDirection: "row", gap: 2, position: "absolute", bottom: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  scheduleBar: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  emptyState: { alignItems: "center", paddingVertical: 24, borderRadius: 14, borderWidth: 1 },
  apptCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4, marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  timelineContainer: { borderWidth: 1, borderRadius: 12, overflow: "hidden", position: "relative" },
  timelineRow: { flexDirection: "row", borderBottomWidth: 0.5 },
  timelineLabel: { width: 68, paddingVertical: 8, paddingHorizontal: 6, justifyContent: "flex-start", alignItems: "flex-end" },
  timelineSlot: { flex: 1 },
  timelineAppt: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderLeftWidth: 3, marginBottom: 2 },
  timelineApptAbs: { position: "absolute", borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  serviceChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  scheduleRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5 },
});
