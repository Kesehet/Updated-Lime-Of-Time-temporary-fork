import { FlatList, Text, View, Pressable, StyleSheet, TextInput, Alert, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Client, formatPhoneNumber, stripPhoneFormat, LOCATION_COLORS } from "@/lib/types";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { LocationSwitcher } from "@/components/location-switcher";
import * as Contacts from "expo-contacts";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { UpgradePlanSheet } from "@/components/upgrade-plan-sheet";
import { BirthdayPicker } from "@/components/birthday-picker";
import { apiCall } from "@/lib/_core/api";
import { useFocusEffect } from "expo-router";

// ── Types ─────────────────────────────────────────────────────────────────────
interface MessageThread {
  clientAccountId: number;
  clientName: string;
  clientPhone: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  senderType: "client" | "business";
}

export default function ClientsScreen() {
  const { state, dispatch, getReviewsForClient, getAppointmentsForClient, syncToDb, clientsForActiveLocation, filterAppointmentsByLocation } = useStore();
  const { hasMultipleLocations } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, isLargeTablet, hp, maxContentWidth } = useResponsive();
  const { checkLimit } = usePlanLimitCheck();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"clients" | "messages">("clients");

  // ── Clients tab state ─────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"name" | "recent" | "appts">("name");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBirthday, setNewBirthday] = useState("");
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeSheetInfo, setUpgradeSheetInfo] = useState<{ planKey: string; planName: string; limit: number } | null>(null);

  // ── Messages tab state ────────────────────────────────────────────────────
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const data = await apiCall<{ inbox: MessageThread[] }>("/api/business/messages");
      setThreads(data.inbox ?? []);
    } catch (err: any) {
      const isSessionError =
        err?.message?.includes("Invalid session") ||
        err?.message?.includes("Unauthorized") ||
        err?.message?.includes("401");
      setThreadsError(isSessionError ? "session_expired" : "Could not load messages");
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  // Reload threads when Messages tab becomes active
  useFocusEffect(
    useCallback(() => {
      if (activeTab === "messages") {
        loadThreads();
      }
    }, [activeTab, loadThreads])
  );

  useEffect(() => {
    if (activeTab === "messages") {
      loadThreads();
    }
  }, [activeTab]);

  // ── Clients helpers ───────────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = clientsForActiveLocation.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.email.toLowerCase().includes(q)
    );
    if (sortOrder === "name") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOrder === "recent") {
      return [...filtered].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    } else {
      return [...filtered].sort((a, b) => filterAppointmentsByLocation(getAppointmentsForClient(b.id)).length - filterAppointmentsByLocation(getAppointmentsForClient(a.id)).length);
    }
  }, [clientsForActiveLocation, search, sortOrder, filterAppointmentsByLocation, getAppointmentsForClient]);

  const getLocationApptCount = useCallback(
    (clientId: string) => filterAppointmentsByLocation(getAppointmentsForClient(clientId)).length,
    [filterAppointmentsByLocation, getAppointmentsForClient]
  );

  const getClientLocationBadges = useCallback(
    (clientId: string) => {
      const appts = getAppointmentsForClient(clientId);
      const locationIds = [...new Set(appts.map((a) => a.locationId).filter(Boolean) as string[])];
      return locationIds
        .map((lid) => state.locations.find((l) => l.id === lid))
        .filter(Boolean) as import("@/lib/types").Location[];
    },
    [getAppointmentsForClient, state.locations]
  );

  const handlePhoneChange = useCallback((text: string) => {
    setNewPhone(formatPhoneNumber(text));
  }, []);

  const handleAddClient = useCallback(() => {
    if (!newName.trim()) return;
    const limitInfo = checkLimit("clients");
    if (!limitInfo.allowed) {
      setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
      setUpgradeSheetVisible(true);
      return;
    }
    const client: Client = {
      id: generateId(),
      name: newName.trim(),
      phone: newPhone.trim(),
      email: newEmail.trim(),
      notes: "",
      birthday: newBirthday.trim(),
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_CLIENT", payload: client });
    syncToDb({ type: "ADD_CLIENT", payload: client });
    setNewName(""); setNewPhone(""); setNewEmail(""); setNewBirthday("");
    setShowAdd(false);
  }, [newName, newPhone, newEmail, newBirthday, dispatch, syncToDb]);

  const handleSelectFromContacts = useCallback(async () => {
    const limitInfo = checkLimit("clients");
    if (!limitInfo.allowed) {
      setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
      setUpgradeSheetVisible(true);
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Contact import is only available on mobile devices.");
      return;
    }
    try {
      if (Platform.OS === "android") {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Denied", "Please allow access to contacts in your device settings.");
          return;
        }
      }
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      const name = contact.name || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
      if (!name) { Alert.alert("Invalid Contact", "The selected contact has no name."); return; }
      const exists = state.clients.some((c) => c.name.toLowerCase() === name.toLowerCase());
      if (exists) { Alert.alert("Already Added", `${name} is already in your client list.`); return; }
      const phone = contact.phoneNumbers?.[0]?.number ?? "";
      const email = contact.emails?.[0]?.email ?? "";
      const formattedPhone = phone ? formatPhoneNumber(stripPhoneFormat(phone)) : "";
      const client: Client = { id: generateId(), name, phone: formattedPhone, email, notes: "Imported from contacts", birthday: "", createdAt: new Date().toISOString() };
      dispatch({ type: "ADD_CLIENT", payload: client });
      syncToDb({ type: "ADD_CLIENT", payload: client });
      Alert.alert("Added", `${name} has been added as a client.`);
    } catch {
      Alert.alert("Error", "Failed to access contacts. Please try again.");
    }
  }, [state.clients, dispatch, syncToDb]);

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getExpireBadge = (birthday: string | undefined): { label: string; color: string } | null => {
    if (!birthday) return null;
    const parts = birthday.split("/");
    if (parts.length < 3) return null;
    const [mm, dd, yyyy] = parts;
    const expDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (isNaN(expDate.getTime())) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0); expDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((expDate.getTime() - now.getTime()) / 86400000);
    if (diffDays < 0) return { label: "Expired", color: "#EF4444" };
    if (diffDays <= 7) return { label: "Expiring soon", color: "#F59E0B" };
    return null;
  };

  const getClientRating = (clientId: string): number | null => {
    const reviews = getReviewsForClient(clientId);
    if (reviews.length === 0) return null;
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return Math.round(avg * 10) / 10;
  };

  const formatRelativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Total unread count for tab badge
  const totalUnread = threads.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);

  return (
    <ScreenContainer tabletMaxWidth={0}>
      <FuturisticBackground />
      <View style={{ flex: 1, alignSelf: "center", width: "100%", maxWidth: maxContentWidth }}>
        <View style={{ paddingHorizontal: hp }}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 24, fontWeight: "700", color: colors.foreground }}>
                {activeTab === "clients" ? "Clients" : "Messages"}
              </Text>
              {activeTab === "clients" && hasMultipleLocations && <LocationSwitcher compact />}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {activeTab === "clients" && (
                <>
                  <Pressable
                    onPress={() => router.push("/birthday-campaigns")}
                    style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <IconSymbol name="birthday.cake" size={20} color="#FF9800" />
                  </Pressable>
                  <Pressable
                    onPress={handleSelectFromContacts}
                    style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <IconSymbol name="person.crop.circle.badge.plus" size={20} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setShowAdd(!showAdd)}
                    style={({ pressed }) => [styles.addButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <IconSymbol name="plus" size={20} color="#FFFFFF" />
                  </Pressable>
                </>
              )}
              {activeTab === "messages" && (
                <Pressable
                  onPress={loadThreads}
                  style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Tab Switcher */}
          <View style={[styles.tabSwitcher, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(["clients", "messages"] as const).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={({ pressed }) => [
                  styles.tabBtn,
                  activeTab === tab && { backgroundColor: colors.primary },
                  { opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: activeTab === tab ? "#fff" : colors.muted }}>
                    {tab === "clients" ? "Clients" : "Messages"}
                  </Text>
                  {tab === "messages" && totalUnread > 0 && (
                    <View style={{ backgroundColor: activeTab === "messages" ? "rgba(255,255,255,0.3)" : colors.error, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>{totalUnread > 99 ? "99+" : totalUnread}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Clients Tab ─────────────────────────────────────────────────── */}
        {activeTab === "clients" && (
          <>
            <View style={{ paddingHorizontal: hp }}>
              {/* Search */}
              <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground }]}
                  placeholder="Search clients..."
                  placeholderTextColor={colors.muted}
                  value={search}
                  onChangeText={setSearch}
                  returnKeyType="done"
                />
              </View>
              {/* Sort chips */}
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
                {(["name", "recent", "appts"] as const).map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => setSortOrder(opt)}
                    style={({ pressed }) => ([
                      styles.sortChip,
                      { backgroundColor: sortOrder === opt ? colors.primary : colors.surface, borderColor: sortOrder === opt ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 },
                    ])}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: sortOrder === opt ? "#fff" : colors.muted }}>
                      {opt === "name" ? "A–Z" : opt === "recent" ? "Recent" : "Most Appts"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {/* Add Client Form */}
              {showAdd && (
                <View style={[styles.addForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>New Client</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} placeholder="Full Name *" placeholderTextColor={colors.muted} value={newName} onChangeText={setNewName} returnKeyType="next" />
                  <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} placeholder="(000) 000-0000" placeholderTextColor={colors.muted} value={newPhone} onChangeText={handlePhoneChange} keyboardType="phone-pad" returnKeyType="next" maxLength={19} />
                  <TextInput style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} placeholder="Email" placeholderTextColor={colors.muted} value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
                  <BirthdayPicker value={newBirthday} onChange={setNewBirthday} placeholder="Expire Date (optional)" style={{ marginBottom: 14 }} />
                  <View style={styles.formActions}>
                    <Pressable onPress={() => setShowAdd(false)} style={({ pressed }) => [styles.formButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, opacity: pressed ? 0.7 : 1 }]}>
                      <Text style={{ fontSize: 14, fontWeight: "500", color: colors.foreground }}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={handleAddClient} style={({ pressed }) => [styles.formButton, { backgroundColor: colors.primary, flex: 1, opacity: pressed ? 0.8 : 1 }]}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: "#FFF" }}>Save Client</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
            <FlatList
              data={filteredClients}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 80 }}
              renderItem={({ item }) => {
                const rating = getClientRating(item.id);
                const apptCount = getLocationApptCount(item.id);
                const locationBadges = getClientLocationBadges(item.id);
                const expireBadge = getExpireBadge(item.birthday);
                return (
                  <Pressable
                    onPress={() => router.push({ pathname: "/client-detail", params: { id: item.id } })}
                    style={({ pressed }) => [styles.clientRow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[styles.avatarText, { color: colors.primary }]}>{getInitials(item.name)}</Text>
                    </View>
                    <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 12, paddingRight: 4 }}>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{item.name}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                        <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                          {item.phone ? formatPhoneNumber(item.phone) : (item.email || "No contact info")}
                        </Text>
                        {apptCount > 0 && <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 8 }}>{apptCount} appt{apptCount > 1 ? "s" : ""}</Text>}
                      </View>
                      {locationBadges.length > 0 && (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                          {locationBadges.map((loc) => {
                            const dotColor = LOCATION_COLORS[state.locations.indexOf(loc) % LOCATION_COLORS.length] ?? colors.primary;
                            return (
                              <View key={loc.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: dotColor + "18", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: dotColor + "40" }}>
                                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor, marginRight: 4 }} />
                                <Text style={{ fontSize: 10, fontWeight: "600", color: dotColor }} numberOfLines={1}>{loc.name}</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                      {expireBadge && (
                        <View style={{ alignSelf: "flex-start", marginTop: 5, backgroundColor: expireBadge.color + "18", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: expireBadge.color + "50" }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: expireBadge.color }}>{expireBadge.label}</Text>
                        </View>
                      )}
                      {rating !== null && (
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                          <IconSymbol name="star.fill" size={12} color="#FFB300" />
                          <Text style={{ fontSize: 11, color: "#FFB300", fontWeight: "600", marginLeft: 3 }}>{rating}</Text>
                        </View>
                      )}
                    </View>
                    <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginRight: 14 }} />
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <IconSymbol name="person.2.fill" size={48} color={colors.muted + "60"} />
                  <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>No clients yet</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>Tap + to add or import from contacts</Text>
                </View>
              }
            />
          </>
        )}

        {/* ── Messages Tab ─────────────────────────────────────────────────── */}
        {activeTab === "messages" && (
          <>
            {threadsLoading ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.muted, marginTop: 12, fontSize: 14 }}>Loading conversations...</Text>
              </View>
            ) : threadsError ? (
              <View style={styles.emptyContainer}>
                <IconSymbol name="exclamationmark.circle" size={40} color={colors.error} />
                {threadsError === "session_expired" ? (
                  <>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>Session Expired</Text>
                    <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center", paddingHorizontal: 32 }}>
                      Your session has expired. Please sign out and sign back in to load messages.
                    </Text>
                    <Pressable onPress={loadThreads} style={({ pressed }) => [{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: 14, color: colors.error, marginTop: 12 }}>{threadsError}</Text>
                    <Pressable onPress={loadThreads} style={({ pressed }) => [{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                      <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : threads.length === 0 ? (
              <View style={styles.emptyContainer}>
                <IconSymbol name="message.fill" size={48} color={colors.muted + "60"} />
                <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>No messages yet</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4, textAlign: "center", paddingHorizontal: 32 }}>
                  When clients send you messages from the client app, they'll appear here.
                </Text>
              </View>
            ) : (
              <FlatList
                data={threads}
                keyExtractor={(item) => String(item.clientAccountId)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 80 }}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => router.push({ pathname: "/client-message-thread-business" as any, params: { clientAccountId: String(item.clientAccountId), clientName: item.clientName } })}
                    style={({ pressed }) => [
                      styles.threadRow,
                      { backgroundColor: colors.surface, borderColor: item.unreadCount > 0 ? colors.primary + "60" : colors.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    {/* Avatar */}
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[styles.avatarText, { color: colors.primary }]}>{getInitials(item.clientName)}</Text>
                    </View>
                    <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 12, paddingRight: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 15, fontWeight: item.unreadCount > 0 ? "700" : "600", color: colors.foreground }} numberOfLines={1}>{item.clientName}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{formatRelativeTime(item.lastMessageAt)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, gap: 4 }}>
                        {item.senderType === "business" && (
                          <Text style={{ fontSize: 12, color: colors.muted }}>You: </Text>
                        )}
                        <Text style={{ fontSize: 13, color: item.unreadCount > 0 ? colors.foreground : colors.muted, flex: 1 }} numberOfLines={1}>{item.lastMessage}</Text>
                        {item.unreadCount > 0 && (
                          <View style={{ backgroundColor: colors.primary, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                            <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff" }}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                          </View>
                        )}
                      </View>
                      {item.clientPhone && (
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{formatPhoneNumber(item.clientPhone)}</Text>
                      )}
                    </View>
                    <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginRight: 14 }} />
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>

      {/* Upgrade Plan Sheet */}
      {upgradeSheetInfo && (
        <UpgradePlanSheet
          visible={upgradeSheetVisible}
          onClose={() => setUpgradeSheetVisible(false)}
          currentPlanKey={upgradeSheetInfo.planKey}
          currentPlanName={upgradeSheetInfo.planName}
          resource="clients"
          currentLimit={upgradeSheetInfo.limit}
          businessOwnerId={state.businessOwnerId!}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingTop: 4 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  addButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabSwitcher: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 14, gap: 3 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  searchBar: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingHorizontal: 12, marginBottom: 16, borderWidth: 1 },
  searchInput: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, fontSize: 14, lineHeight: 20 },
  addForm: { borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, width: "100%" },
  input: { width: "100%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, lineHeight: 20, marginBottom: 8, borderWidth: 1 },
  formActions: { flexDirection: "row", gap: 8, width: "100%" },
  formButton: { paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, minHeight: 44 },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start", height: 34, justifyContent: "center", alignItems: "center" },
  clientRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, marginBottom: 10, borderWidth: 1, paddingLeft: 12, paddingRight: 4 },
  threadRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, marginBottom: 10, borderWidth: 1, paddingLeft: 12, paddingRight: 4 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { fontSize: 14, fontWeight: "700" },
  emptyContainer: { alignItems: "center", paddingVertical: 48 },
});
