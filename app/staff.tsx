import { useState, useMemo } from "react";
import {
  FlatList,
  Text,
  View,
  Pressable,
  StyleSheet,
  Alert,
  Modal,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StaffMember } from "@/lib/types";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { LocationSwitcher } from "@/components/location-switcher";
import { FuturisticBackground } from "@/components/futuristic-background";


export default function StaffScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth } = useResponsive();
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const { activeLocation, activeLocations, hasMultipleLocations, staffForLocation, setActiveLocation } = useActiveLocation();

  // staffForLocation already filters by active location; apply active/inactive filter on top
  const filteredStaff = useMemo(() => {
    const base = filter === "all" ? state.staff : state.staff.filter((s) => filter === "active" ? s.active : !s.active);
    if (!activeLocation) return base;
    return base.filter((s) => !s.locationIds || s.locationIds.length === 0 || s.locationIds.includes(activeLocation.id));
  }, [state.staff, filter, activeLocation]);

  const getServiceNames = (member: StaffMember) => {
    if (!member.serviceIds || member.serviceIds.length === 0) return "All Services";
    return member.serviceIds
      .map((id) => state.services.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .join(", ") || "No services assigned";
  };

  const getLocationNames = (member: StaffMember): string | null => {
    if (!member.locationIds || member.locationIds.length === 0) return null;
    const names = member.locationIds
      .map((id) => state.locations.find((l) => l.id === id)?.name)
      .filter(Boolean) as string[];
    return names.length > 0 ? names.join(", ") : null;
  };

  // Returns true if the staff member is scheduled to work today
  const isWorkingToday = (member: StaffMember): boolean => {
    if (!member.active) return false;
    if (!member.workingHours || Object.keys(member.workingHours).length === 0) return true; // uses business hours
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayKey = days[new Date().getDay()];
    const todayHours = (member.workingHours as any)[todayKey];
    return todayHours?.enabled === true;
  };

  // Returns "[Business Name] · [Location Name]" subtitle for a staff member
  const getLocationSubtitle = (member: StaffMember): string => {
    const bizName = state.settings.businessName || "My Business";
    if (!member.locationIds || member.locationIds.length === 0) {
      // All locations — show first active location or just business name
      const firstLoc = state.locations.find((l) => l.active);
      return firstLoc ? `${bizName} · ${firstLoc.name}` : bizName;
    }
    const locName = state.locations.find((l) => l.id === member.locationIds![0])?.name;
    return locName ? `${bizName} · ${locName}` : bizName;
  };

  const getWorkdaySummary = (member: StaffMember): string => {
    if (!member.workingHours || Object.keys(member.workingHours).length === 0) return "Business Hours";
    const abbr: Record<string, string> = {
      monday: "Mon", tuesday: "Tue", wednesday: "Wed",
      thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
    };
    const active = Object.entries(member.workingHours)
      .filter(([, v]) => (v as any)?.enabled)
      .map(([k]) => abbr[k] ?? k.slice(0, 3));
    return active.length > 0 ? active.join(", ") : "No working days";
  };

  const handleDelete = (member: StaffMember) => {
    Alert.alert(
      "Delete Staff Member",
      `Are you sure you want to remove ${member.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const action = { type: "DELETE_STAFF" as const, payload: member.id };
            dispatch(action);
            syncToDb(action);
          },
        },
      ]
    );
  };

  const handleToggleActive = (member: StaffMember) => {
    const updated = { ...member, active: !member.active };
    const action = { type: "UPDATE_STAFF" as const, payload: updated };
    dispatch(action);
    syncToDb(action);
  };

  const renderStaffCard = ({ item }: { item: StaffMember }) => (
    <Pressable
      onPress={() => router.push({ pathname: "/staff-form" as any, params: { id: item.id } })}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : item.active ? 1 : 0.6,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeft}>
          <View style={{ position: 'relative' }}>
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={[styles.avatar, { borderWidth: 2, borderColor: item.color || colors.primary }]} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: item.color || colors.primary }]}>
                <Text style={styles.avatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            {/* Availability dot: green = working today, grey = off */}
            <View style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 11, height: 11, borderRadius: 6,
              backgroundColor: isWorkingToday(item) ? colors.success : colors.muted,
              borderWidth: 2, borderColor: colors.surface,
            }} />
          </View>
        </View>
        <View style={styles.cardInfo}>
            <Text
              className="text-base font-semibold text-foreground"
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {item.role ? (
              <Text className="text-sm text-muted" numberOfLines={1}>
                {item.role}
              </Text>
            ) : null}
            {/* Business + Location subtitle with color dot */}
            {state.locations.length > 0 && (() => {
              const assignedLoc = item.locationIds && item.locationIds.length > 0
                ? state.locations.find((l) => l.id === item.locationIds![0])
                : state.locations.find((l) => l.active);
              const locIndex = assignedLoc ? state.locations.indexOf(assignedLoc) : 0;
              const dotColor = item.color || colors.primary;
              return (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    if (hasMultipleLocations) setLocationPickerOpen(true);
                  }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: "flex-start" })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                    <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "500" }} numberOfLines={1}>
                      {getLocationSubtitle(item)}
                    </Text>
                    {hasMultipleLocations && (
                      <IconSymbol name="chevron.right" size={9} color={colors.muted} />
                    )}
                  </View>
                </Pressable>
              );
            })()}
        </View>{/* cardInfo */}
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => handleToggleActive(item)}
            style={({ pressed }) => [
              styles.toggleBtn,
              {
                backgroundColor: item.active ? colors.success + "20" : colors.error + "20",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: item.active ? colors.success : colors.error,
              }}
            >
              {item.active ? "Active" : "Inactive"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.cardDetails, { borderTopColor: colors.border }]}>
        {item.phone ? (
          <View style={styles.detailRow}>
            <IconSymbol name="phone.fill" size={14} color={colors.muted} />
            <Text className="text-xs text-muted ml-1">{item.phone}</Text>
          </View>
        ) : null}
        {item.email ? (
          <View style={styles.detailRow}>
            <IconSymbol name="envelope.fill" size={14} color={colors.muted} />
            <Text className="text-xs text-muted ml-1" numberOfLines={1}>
              {item.email}
            </Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <IconSymbol name="list.bullet" size={14} color={colors.muted} />
          <Text className="text-xs text-muted ml-1" numberOfLines={1}>
            {getServiceNames(item)}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <IconSymbol name="clock.fill" size={14} color={colors.muted} />
          <Text className="text-xs text-muted ml-1" numberOfLines={1}>
            {getWorkdaySummary(item)}
          </Text>
        </View>
        {hasMultipleLocations ? (
          <View style={styles.detailRow}>
            <IconSymbol name="mappin.and.ellipse" size={14} color={colors.muted} />
            <Text className="text-xs text-muted ml-1" numberOfLines={1}>
              {getLocationNames(item) ?? "All Locations"}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <Pressable
          onPress={() =>
            router.push({ pathname: "/staff-form" as any, params: { id: item.id } })
          }
          style={({ pressed }) => [
            styles.footerBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <IconSymbol name="pencil" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "500", marginLeft: 4 }}>
            Edit
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            router.push({ pathname: "/staff-calendar" as any, params: { id: item.id } })
          }
          style={({ pressed }) => [
            styles.footerBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <IconSymbol name="calendar" size={16} color={item.color || colors.primary} />
          <Text style={{ color: item.color || colors.primary, fontSize: 13, fontWeight: "500", marginLeft: 4 }}>
            Calendar
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleDelete(item)}
          style={({ pressed }) => [
            styles.footerBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <IconSymbol name="trash.fill" size={16} color={colors.error} />
          <Text style={{ color: colors.error, fontSize: 13, fontWeight: "500", marginLeft: 4 }}>
            Remove
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <ScreenContainer tabletMaxWidth={900} edges={["top", "left", "right"]} className="pt-2" style={{ paddingHorizontal: hp }}>
      <FuturisticBackground />
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text className="text-2xl font-bold text-foreground" style={{ flex: 1 }}>
          Stuffs
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: "/staff-form" as any })}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <IconSymbol name="plus" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Location Switcher */}
      {hasMultipleLocations && (
        <LocationSwitcher containerStyle={{ marginBottom: 8 }} />
      )}

      {/* Inline Location Picker Modal (triggered from subtitle tap) */}
      <Modal
        visible={locationPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLocationPickerOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 }}
          onPress={() => setLocationPickerOpen(false)}
        >
          <Pressable
            style={[{ width: "100%", maxWidth: 380, borderRadius: 16, borderWidth: 1, overflow: "hidden", backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, paddingHorizontal: 18, paddingVertical: 14 }}>
              Switch Location
            </Text>
            {activeLocations.map((loc) => {
              const isActive = loc.id === activeLocation?.id;
              return (
                <Pressable
                  key={loc.id}
                  onPress={() => { setActiveLocation(loc.id); setLocationPickerOpen(false); }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 18,
                    paddingVertical: 13,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                    backgroundColor: isActive ? colors.primary + "18" : pressed ? colors.border : "transparent",
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "500", color: isActive ? colors.primary : colors.foreground }} numberOfLines={1}>{loc.name}</Text>
                    {(loc.city || loc.address) && (
                      <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                        {loc.city ? [loc.address, loc.city, loc.state].filter(Boolean).join(", ") : loc.address}
                      </Text>
                    )}
                  </View>
                  {isActive && <IconSymbol name="checkmark" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {(["all", "active", "inactive"] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: filter === f ? colors.primary : colors.surface,
                borderColor: filter === f ? colors.primary : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: filter === f ? "#FFFFFF" : colors.foreground,
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {filteredStaff.length === 0 ? (
        <View style={styles.emptyState}>
          <IconSymbol name="person.3.fill" size={48} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground mt-4">
            {filter === "all" ? "No Staff Members" : `No ${filter} Staff`}
          </Text>
          <Text className="text-sm text-muted mt-1 text-center" style={{ maxWidth: 260 }}>
            {filter === "all"
              ? "Add your team members to assign services and manage individual schedules."
              : `No staff members are currently ${filter}.`}
          </Text>
          {filter === "all" && (
            <Pressable
              onPress={() => router.push({ pathname: "/staff-form" as any })}
              style={({ pressed }) => [
                styles.emptyBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>
                Add Staff Member
              </Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredStaff}
          keyExtractor={(item) => item.id}
          renderItem={renderStaffCard}
          contentContainerStyle={{ paddingBottom: 100, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  cardInfo: {
    marginLeft: 12,
    flex: 1,
  },
  cardActions: {
    marginLeft: 8,
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  cardDetails: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    gap: 6,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  footerBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  emptyState: {
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
});
