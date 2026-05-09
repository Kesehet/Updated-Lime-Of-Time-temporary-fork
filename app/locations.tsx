import { useMemo, useState, useCallback } from "react";
import {
  FlatList,
  Text,
  View,
  Pressable,
  Switch,
  StyleSheet,
  Linking,
  Share,
  Modal,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Location, LOCATION_COLORS, formatFullAddress, getMapUrl, PUBLIC_BOOKING_URL, formatPhoneNumber } from "@/lib/types";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { FuturisticBackground } from "@/components/futuristic-background";


export default function LocationsScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const { activeLocation, setActiveLocation } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();

  // Track which location just had its link copied (for toast feedback)
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // QR code modal state
  const [qrLocation, setQrLocation] = useState<Location | null>(null);
  const [qrCopied, setQrCopied] = useState(false);

  // Reopen date picker state: which location is being edited
  const [reopenPickerId, setReopenPickerId] = useState<string | null>(null);
  // Calendar picker state
  const [calPickerMonth, setCalPickerMonth] = useState(() => new Date().getMonth());
  const [calPickerYear, setCalPickerYear] = useState(() => new Date().getFullYear());
  const [calPickerSelected, setCalPickerSelected] = useState<string | null>(null);

  const CAL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const CAL_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  /** Build calendar grid for the picker */
  const buildCalGrid = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  };

  /** Format a date to YYYY-MM-DD */
  const toDateStr = (year: number, month: number, day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const todayStr = (() => {
    const n = new Date();
    return toDateStr(n.getFullYear(), n.getMonth(), n.getDate());
  })();

  const sortedLocations = useMemo(
    () =>
      [...state.locations].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [state.locations]
  );

  /** Toggle a location's temporarily closed state */
  const handleToggleTemporarilyClosed = (item: Location, value: boolean) => {
    if (value) {
      // Opening the picker for reopen date
      const now = new Date();
      setReopenPickerId(item.id);
      setCalPickerMonth(now.getMonth());
      setCalPickerYear(now.getFullYear());
      setCalPickerSelected(item.reopenOn ?? null);
      // Mark as closed immediately (reopen date can be set after)
      const action = { type: "UPDATE_LOCATION" as const, payload: { ...item, temporarilyClosed: true, reopenOn: item.reopenOn } };
      dispatch(action);
      syncToDb(action);
    } else {
      // Re-opening: clear closure and reopen date
      setReopenPickerId(null);
      setCalPickerSelected(null);
      const action = { type: "UPDATE_LOCATION" as const, payload: { ...item, temporarilyClosed: false, reopenOn: undefined } };
      dispatch(action);
      syncToDb(action);
    }
  };

  /** Save the reopen date for a location */
  const handleSaveReopenDate = (item: Location, dateStr: string | null) => {
    const action = {
      type: "UPDATE_LOCATION" as const,
      payload: { ...item, temporarilyClosed: true, reopenOn: dateStr ?? undefined },
    };
    dispatch(action);
    syncToDb(action);
    setReopenPickerId(null);
    setCalPickerSelected(null);
  };

  /** Format a YYYY-MM-DD string to a readable date like "Apr 20" */
  const formatReopenDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return null;
    }
  };

  /** Toggle a location's active/inactive state. Multiple locations can be active simultaneously. */
  const handleToggleActive = (item: Location, value: boolean) => {
    if (!value) {
      // Prevent deactivating the last active location
      const otherActive = state.locations.find((l) => l.id !== item.id && l.active);
      if (!otherActive) return;
    }
    const action = { type: "UPDATE_LOCATION" as const, payload: { ...item, active: value } };
    dispatch(action);
    syncToDb(action);
    // If activating, also set as the current UI filter location
    if (value) setActiveLocation(item.id);
  };

  /** Build the unique booking URL for a specific location */
  const getLocationBookingUrl = useCallback(
    (item: Location) => {
      const slug =
        state.settings.customSlug ||
        state.settings.businessName.replace(/\s+/g, "-").toLowerCase();
      return `${PUBLIC_BOOKING_URL}/book/${slug}?location=${item.id}`;
    },
    [state.settings.customSlug, state.settings.businessName]
  );

  /** Copy this location's booking URL to clipboard and show brief toast */
  const handleCopyLink = useCallback(
    async (item: Location) => {
      const url = getLocationBookingUrl(item);
      await Clipboard.setStringAsync(url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 2500);
    },
    [getLocationBookingUrl]
  );

  /** Share this location's booking URL via native Share sheet */
  const handleShareLink = useCallback(
    async (item: Location) => {
      const url = getLocationBookingUrl(item);
      const businessName = state.settings.businessName || "our business";
      try {
        const fullAddr = formatFullAddress(item.address, item.city, item.state, item.zipCode);
        const addrLine = fullAddr ? `\n📍 ${fullAddr}` : "";
        const phoneLine = item.phone ? `\n📞 ${formatPhoneNumber(item.phone)}` : "";
        await Share.share({
          message: `Book an appointment with ${businessName}!${addrLine}${phoneLine}\n\nSchedule online: ${url}\n\nPowered by Lime Of Time`,
          title: `Book at ${item.name}`,
        });
      } catch {
        // User dismissed the sheet — no action needed
      }
    },
    [getLocationBookingUrl, state.settings.businessName]
  );

  const renderLocation = ({ item }: { item: Location }) => {
    const colorIndex = state.locations.indexOf(item) % LOCATION_COLORS.length;
    const locColor = LOCATION_COLORS[colorIndex];
    const isActiveContext = activeLocation?.id === item.id;
    const formattedAddress = formatFullAddress(item.address, item.city, item.state, item.zipCode);
    const bookingUrl = getLocationBookingUrl(item);
    const isCopied = copiedId === item.id;

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: isActiveContext ? colors.primary : colors.border,
            borderWidth: isActiveContext ? 1.5 : 1,
          },
        ]}
      >
        {/* Toggle row at top */}
        <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <View style={[styles.colorDot, { backgroundColor: locColor }]} />
            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, flex: 1 }} numberOfLines={1}>
              {item.name}
            </Text>

          </View>
          <Switch
            value={item.active}
            onValueChange={(v) => handleToggleActive(item, v)}
            trackColor={{ false: colors.border, true: colors.primary + "80" }}
            thumbColor={item.active ? colors.primary : colors.muted}
          />
        </View>

        {/* Card body — tappable to edit */}
        <Pressable
          onPress={() => router.push({ pathname: "/location-form", params: { id: item.id } })}
          style={({ pressed }) => [styles.cardBody, { opacity: pressed ? 0.7 : 1 }]}
        >
          {!!formattedAddress && (
            <Pressable
              onPress={() => Linking.openURL(getMapUrl(formattedAddress))}
              style={({ pressed }) => [styles.infoRow, { opacity: pressed ? 0.6 : 1 }]}
            >
              <IconSymbol name="mappin" size={13} color={colors.primary} />
              <Text style={{ fontSize: fs.xs, color: colors.primary, flex: 1, textDecorationLine: "underline" }} numberOfLines={2}>
                {formattedAddress}
              </Text>
              <IconSymbol name="arrow.up.right.square" size={13} color={colors.primary} />
            </Pressable>
          )}

          {!!item.phone && (
            <View style={styles.infoRow}>
              <IconSymbol name="phone.fill" size={13} color={colors.muted} />
              <Text style={{ fontSize: fs.xs, color: colors.muted }}>{formatPhoneNumber(item.phone)}</Text>
            </View>
          )}
          {!!item.email && (
            <View style={styles.infoRow}>
              <IconSymbol name="envelope.fill" size={13} color={colors.muted} />
              <Text style={{ fontSize: fs.xs, color: colors.muted }} numberOfLines={1}>{item.email}</Text>
            </View>
          )}

          <View style={[styles.editRow, { borderTopColor: colors.border }]}>
            <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }}>
              {isActiveContext ? "Currently active location" : item.active ? "Tap to edit" : "Inactive — toggle to activate"}
            </Text>
            <IconSymbol name="chevron.right" size={14} color={colors.muted} />
          </View>
        </Pressable>

        {/* Temporarily Closed toggle */}
        <View style={[styles.tempClosedRow, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: item.temporarilyClosed ? colors.warning : colors.foreground }}>
              {item.temporarilyClosed ? "⏸ Temporarily Closed" : "Accepting Bookings"}
            </Text>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
              {item.temporarilyClosed
                ? (item.reopenOn
                    ? `Reopens ${formatReopenDate(item.reopenOn)}`
                    : "New bookings are paused at this location")
                : "Toggle to pause bookings without deactivating"}
            </Text>
          </View>
          <Switch
            value={!!item.temporarilyClosed}
            onValueChange={(v) => handleToggleTemporarilyClosed(item, v)}
            trackColor={{ false: colors.border, true: colors.warning + "80" }}
            thumbColor={item.temporarilyClosed ? colors.warning : colors.muted}
          />
        </View>

        {/* Reopen date picker — shown only when this location is temporarily closed */}
        {item.temporarilyClosed && (
          <View style={[styles.reopenRow, { borderTopColor: colors.border, backgroundColor: colors.warning + "08" }]}>
            {reopenPickerId === item.id ? (
              <>
                {/* Month navigation */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.warning }}>
                    Set Reopen Date
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      onPress={() => {
                        if (calPickerMonth === 0) { setCalPickerMonth(11); setCalPickerYear(calPickerYear - 1); }
                        else setCalPickerMonth(calPickerMonth - 1);
                      }}
                      style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, padding: 4 }]}
                    >
                      <IconSymbol name="chevron.left" size={14} color={colors.foreground} />
                    </Pressable>
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, minWidth: 80, textAlign: "center" }}>
                      {CAL_MONTHS[calPickerMonth]} {calPickerYear}
                    </Text>
                    <Pressable
                      onPress={() => {
                        if (calPickerMonth === 11) { setCalPickerMonth(0); setCalPickerYear(calPickerYear + 1); }
                        else setCalPickerMonth(calPickerMonth + 1);
                      }}
                      style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, padding: 4 }]}
                    >
                      <IconSymbol name="chevron.right" size={14} color={colors.foreground} />
                    </Pressable>
                  </View>
                </View>

                {/* Day headers */}
                <View style={{ flexDirection: "row", marginBottom: 4 }}>
                  {CAL_DAYS.map((d) => (
                    <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: "600", color: colors.muted }}>{d}</Text>
                  ))}
                </View>

                {/* Calendar grid */}
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {buildCalGrid(calPickerYear, calPickerMonth).map((day, idx) => {
                    if (!day) return <View key={`e-${idx}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
                    const ds = toDateStr(calPickerYear, calPickerMonth, day);
                    const isPast = ds < todayStr;
                    const isSelected = calPickerSelected === ds;
                    const isToday = ds === todayStr;
                    return (
                      <Pressable
                        key={ds}
                        onPress={() => { if (!isPast) setCalPickerSelected(ds); }}
                        style={({ pressed }) => ([
                          {
                            width: `${100 / 7}%`,
                            aspectRatio: 1,
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 100,
                            backgroundColor: isSelected ? colors.warning : "transparent",
                            opacity: isPast ? 0.3 : pressed ? 0.7 : 1,
                          },
                        ])}
                      >
                        <Text style={{
                          fontSize: fs.xs,
                          fontWeight: isSelected || isToday ? "700" : "400",
                          color: isSelected ? "#FFF" : isToday ? colors.warning : colors.foreground,
                        }}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Action buttons */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pressable
                    onPress={() => handleSaveReopenDate(item, null)}
                    style={({ pressed }) => [{
                      flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                      borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>No date</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleSaveReopenDate(item, calPickerSelected)}
                    style={({ pressed }) => [{
                      flex: 2, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                      backgroundColor: calPickerSelected ? colors.warning : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: calPickerSelected ? "#FFF" : colors.muted }}>
                      {calPickerSelected ? `Reopen ${formatReopenDate(calPickerSelected)}` : "Confirm"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setReopenPickerId(null)}
                    style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.6 : 1, justifyContent: "center" }]}
                  >
                    <IconSymbol name="xmark" size={14} color={colors.muted} />
                  </Pressable>
                </View>
                <Text style={{ fontSize: 10, color: colors.muted, marginTop: 6 }}>
                  Tap a date to set auto-reopen, or "No date" to close indefinitely.
                </Text>
              </>
            ) : (
              <Pressable
                onPress={() => {
                  const now = new Date();
                  setReopenPickerId(item.id);
                  setCalPickerMonth(now.getMonth());
                  setCalPickerYear(now.getFullYear());
                  setCalPickerSelected(item.reopenOn ?? null);
                }}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.7 : 1 }]}
              >
                <IconSymbol name="calendar" size={13} color={colors.warning} />
                <Text style={{ fontSize: fs.xs, color: colors.warning, fontWeight: "600" }}>
                  {item.reopenOn
                    ? `Reopens ${formatReopenDate(item.reopenOn)} • Tap to change`
                    : "Set reopen date (optional)"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Booking Link: URL preview + Copy + Share ── */}
        <View style={[styles.bookingLinkContainer, { borderTopColor: colors.border }]}>
          {/* URL preview line */}
          <Text style={[styles.bookingUrlPreview, { color: colors.muted }]} numberOfLines={1}>
            {bookingUrl}
          </Text>

          {/* Action buttons side by side */}
          <View style={styles.bookingLinkActions}>
            {/* Copy button */}
            <Pressable
              onPress={() => handleCopyLink(item)}
              style={({ pressed }) => [
                styles.linkActionBtn,
                {
                  backgroundColor: isCopied ? colors.success + "18" : colors.primary + "12",
                  borderColor: isCopied ? colors.success + "50" : colors.primary + "30",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <IconSymbol
                name={isCopied ? "checkmark.circle.fill" : "doc.on.doc.fill"}
                size={14}
                color={isCopied ? colors.success : colors.primary}
              />
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isCopied ? colors.success : colors.primary }}>
                {isCopied ? "Copied!" : "Copy Link"}
              </Text>
            </Pressable>

            {/* Share button */}
            <Pressable
              onPress={() => handleShareLink(item)}
              style={({ pressed }) => [
                styles.linkActionBtn,
                {
                  backgroundColor: colors.primary + "12",
                  borderColor: colors.primary + "30",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <IconSymbol name="square.and.arrow.up" size={14} color={colors.primary} />
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>Share</Text>
            </Pressable>

            {/* QR Code button */}
            <Pressable
              onPress={() => { setQrLocation(item); setQrCopied(false); }}
              style={({ pressed }) => [
                styles.linkActionBtn,
                {
                  backgroundColor: colors.primary + "12",
                  borderColor: colors.primary + "30",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <IconSymbol name="qrcode" size={14} color={colors.primary} />
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>QR</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer tabletMaxWidth={900} edges={["top", "left", "right"]} className="pt-2" style={{ paddingHorizontal: hp }}>
      <FuturisticBackground />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text className="text-xl font-bold text-foreground" style={{ flex: 1 }}>
          Locations
        </Text>
        <Pressable
          onPress={() => router.push("/location-form")}
          style={({ pressed }) => [
            styles.addBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <IconSymbol name="plus" size={18} color="#FFFFFF" />
          <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: fs.sm }}>Add</Text>
        </Pressable>
      </View>

      {state.locations.length > 1 && (
        <View style={[styles.infoBox, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
          <IconSymbol name="info.circle.fill" size={14} color={colors.primary} />
          <Text style={{ fontSize: fs.xs, color: colors.primary, flex: 1, lineHeight: 18 }}>
            Only one location can be active at a time. Toggle a location on to switch the entire app to that location's data.
          </Text>
        </View>
      )}

      {sortedLocations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconSymbol name="building.2.fill" size={48} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground mt-4">No Locations Yet</Text>
          <Text className="text-sm text-muted text-center mt-2" style={{ maxWidth: 280 }}>
            Add your business locations to manage multiple branches, each with their own address and schedule.
          </Text>
          <Pressable
            onPress={() => router.push("/location-form")}
            style={({ pressed }) => [
              styles.emptyBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: fs.sm }}>
              Add First Location
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sortedLocations}
          renderItem={renderLocation}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
        />
      )}

      {/* ─── Per-Location QR Code Modal ─────────────────────────────── */}
      <Modal
        visible={!!qrLocation}
        transparent
        animationType="fade"
        onRequestClose={() => setQrLocation(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => setQrLocation(null)}
        >
          <View
            style={[{
              borderRadius: 24,
              padding: 24,
              alignItems: "center",
              width: "100%",
              maxWidth: 340,
              gap: 16,
            }, { backgroundColor: colors.surface }]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", width: "100%", marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.md, fontWeight: "800", color: colors.foreground }}>Location QR Code</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }} numberOfLines={1}>
                  {qrLocation?.name}
                </Text>
              </View>
              <Pressable
                onPress={() => setQrLocation(null)}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}
              >
                <IconSymbol name="xmark.circle.fill" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* QR Code */}
            <View style={{
              width: 220, height: 220, backgroundColor: "#fff", borderRadius: 16,
              alignItems: "center", justifyContent: "center", padding: 12,
              shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
            }}>
              {qrLocation && (
                <QRCode
                  value={getLocationBookingUrl(qrLocation)}
                  size={196}
                  color="#000"
                  backgroundColor="#fff"
                />
              )}
            </View>

            {/* URL pill */}
            <View style={[{ borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, width: "100%" }, { backgroundColor: colors.background }]}>
              <Text style={{ fontSize: fs.xs, color: colors.muted, textAlign: "center" }} numberOfLines={2}>
                {qrLocation ? getLocationBookingUrl(qrLocation) : ""}
              </Text>
            </View>

            {/* Action buttons */}
            <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
              <Pressable
                onPress={async () => {
                  if (!qrLocation) return;
                  await Clipboard.setStringAsync(getLocationBookingUrl(qrLocation));
                  setQrCopied(true);
                  setTimeout(() => setQrCopied(false), 2500);
                }}
                style={({ pressed }) => [{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 6, paddingVertical: 12, borderRadius: 12, opacity: pressed ? 0.8 : 1,
                }, { backgroundColor: qrCopied ? colors.success + "20" : colors.border }]}
              >
                <IconSymbol name={qrCopied ? "checkmark.circle.fill" : "doc.on.doc.fill"} size={16} color={qrCopied ? colors.success : colors.foreground} />
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: qrCopied ? colors.success : colors.foreground }}>
                  {qrCopied ? "Copied!" : "Copy Link"}
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (!qrLocation) return;
                  const url = getLocationBookingUrl(qrLocation);
                  const addr = formatFullAddress(qrLocation.address, qrLocation.city, qrLocation.state, qrLocation.zipCode);
                  const addrLine = addr ? `\n📍 ${addr}` : "";
                  const phoneLine = qrLocation.phone ? `\n📞 ${formatPhoneNumber(qrLocation.phone)}` : "";
                  try {
                    await Share.share({
                      message: `Book at ${qrLocation.name}!${addrLine}${phoneLine}\n\nSchedule online: ${url}\n\nPowered by Lime Of Time`,
                      title: `Book at ${qrLocation.name}`,
                    });
                  } catch { /* dismissed */ }
                }}
                style={({ pressed }) => [{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 6, paddingVertical: 12, borderRadius: 12, opacity: pressed ? 0.8 : 1,
                }, { backgroundColor: colors.primary }]}
              >
                <IconSymbol name="paperplane.fill" size={16} color="#fff" />
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#fff" }}>Share</Text>
              </Pressable>
            </View>

            <Text style={{ fontSize: fs.xs, color: colors.muted, textAlign: "center" }}>
              Scan to book at this specific location
            </Text>
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
    marginBottom: 12,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  card: {
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 8,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 0,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 0.5,
    marginTop: 4,
  },
  tempClosedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    gap: 10,
  },
  bookingLinkContainer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 0.5,
    gap: 8,
  },
  bookingUrlPreview: {
    fontSize: fs.xs,
    lineHeight: 16,
  },
  bookingLinkActions: {
    flexDirection: "row",
    gap: 8,
  },
  linkActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 80,
  },
  emptyBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  reopenRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 0.5,
  },
});
