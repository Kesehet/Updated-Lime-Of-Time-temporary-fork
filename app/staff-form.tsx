import { useState, useCallback, useMemo, useRef } from "react";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { UpgradePlanSheet } from "@/components/upgrade-plan-sheet";
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  Switch,
  Platform,
  Modal,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { trpc } from "@/lib/trpc";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  StaffMember,
  STAFF_COLORS,
  DAYS_OF_WEEK,
  WorkingHours,
  DEFAULT_WORKING_HOURS,
  formatTimeDisplay,
  formatPhoneNumber,
  stripPhoneFormat,
} from "@/lib/types";
import { TapTimePicker, timeToMinutes as tapTimeToMinutes } from "@/components/tap-time-picker";
import { FuturisticBackground } from "@/components/futuristic-background";


type DaySchedule = { enabled: boolean; start: string; end: string };
type WeekSchedule = Record<string, DaySchedule>;

const DEFAULT_DAY: DaySchedule = { enabled: true, start: "09:00", end: "17:00" };

function buildDefaultWeekSchedule(): WeekSchedule {
  const schedule: WeekSchedule = {};
  DAYS_OF_WEEK.forEach((day) => {
    const isWeekend = day === "sunday" || day === "saturday";
    schedule[day] = { enabled: !isWeekend, start: "09:00", end: "17:00" };
  });
  return schedule;
}

export default function StaffFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp } = useResponsive();
  const { checkLimit } = usePlanLimitCheck();
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeSheetInfo, setUpgradeSheetInfo] = useState<{ planKey: string; planName: string; limit: number } | null>(null);

  const existing = useMemo(
    () => (id ? state.staff.find((s) => s.id === id) : undefined),
    [state.staff, id]
  );

  const isEdit = !!existing;

  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(() => existing?.phone ? formatPhoneNumber(stripPhoneFormat(existing.phone)) : "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [color, setColor] = useState(existing?.color ?? STAFF_COLORS[0]);
  const [active, setActive] = useState(existing?.active ?? true);
  const [commissionRate, setCommissionRate] = useState<string>(
    existing?.commissionRate != null ? String(existing.commissionRate) : ""
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    existing?.serviceIds ?? []
  );
  const [allServices, setAllServices] = useState(
    !existing?.serviceIds || existing.serviceIds.length === 0
  );

  // Location assignment — single location per staff member
  // Pre-select the currently active location for new staff
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    if (existing?.locationIds && existing.locationIds.length > 0) return existing.locationIds[0];
    // Pre-select active location for new staff
    if (!isEdit && state.activeLocationId) return state.activeLocationId;
    return null;
  });
  const [useCustomSchedule, setUseCustomSchedule] = useState(!!existing?.workingHours);
  const [weekSchedule, setWeekSchedule] = useState<WeekSchedule>(() => {
    if (existing?.workingHours) {
      const ws: WeekSchedule = {};
      DAYS_OF_WEEK.forEach((day) => {
        const wh = (existing.workingHours as any)?.[day];
        ws[day] = wh
          ? { enabled: wh.enabled ?? false, start: wh.start ?? "09:00", end: wh.end ?? "17:00" }
          : { ...DEFAULT_DAY };
      });
      return ws;
    }
    return buildDefaultWeekSchedule();
  });

  const toggleService = (svcId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(svcId) ? prev.filter((id) => id !== svcId) : [...prev, svcId]
    );
  };

  const updateDaySchedule = (day: string, field: keyof DaySchedule, value: any) => {
    setWeekSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const [staffTimePicker, setStaffTimePicker] = useState<{ day: string } | null>(null);
  const [staffDraftStart, setStaffDraftStart] = useState("09:00");
  const [staffDraftEnd, setStaffDraftEnd] = useState("17:00");
  const [staffTimeError, setStaffTimeError] = useState<string | null>(null);
  const [staffSubPicker, setStaffSubPicker] = useState<"start" | "end" | null>(null);

  // Profile photo
  const [photoUri, setPhotoUri] = useState<string | null>(existing?.photoUri ?? null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const uploadImageMut = trpc.files.uploadImage.useMutation();

  const uploadAndSetPhoto = async (localUri: string, mimeType: string) => {
    if (Platform.OS !== "web") {
      try {
        setUploadingPhoto(true);
        const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
        const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "staff" });
        setPhotoUri(url);
      } catch {
        setPhotoUri(localUri);
      } finally {
        setUploadingPhoto(false);
      }
    } else {
      setPhotoUri(localUri);
    }
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library to upload a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadAndSetPhoto(result.assets[0].uri, result.assets[0].mimeType ?? "image/jpeg");
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow camera access to take a profile photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadAndSetPhoto(result.assets[0].uri, result.assets[0].mimeType ?? "image/jpeg");
    }
  };

  const handlePhotoPress = () => {
    Alert.alert("Profile Photo", "Choose an option", [
      { text: "Take Photo", onPress: takePhoto },
      { text: "Choose from Library", onPress: pickPhoto },
      ...(photoUri ? [{ text: "Remove Photo", style: "destructive" as const, onPress: () => setPhotoUri(null) }] : []),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // Inline validation errors
  const [errors, setErrors] = useState<{ name?: string; location?: string; phone?: string }>({});

  const openStaffTimePicker = useCallback((day: string) => {
    const ds = weekSchedule[day];
    setStaffDraftStart(ds.start);
    setStaffDraftEnd(ds.end);
    setStaffTimeError(null);
    setStaffSubPicker(null);
    setStaffTimePicker({ day });
  }, [weekSchedule]);

  const saveStaffTimePicker = useCallback(() => {
    if (!staffTimePicker) return;
    const [sh, sm] = staffDraftStart.split(":").map(Number);
    const [eh, em] = staffDraftEnd.split(":").map(Number);
    const startMin = sh * 60 + (sm || 0);
    const endMin = eh * 60 + (em || 0);
    if (endMin <= startMin) {
      setStaffTimeError("End time must be after start time.");
      return;
    }
    setStaffTimeError(null);
    updateDaySchedule(staffTimePicker.day, "start", staffDraftStart);
    updateDaySchedule(staffTimePicker.day, "end", staffDraftEnd);
    setStaffTimePicker(null);
    setStaffSubPicker(null);
  }, [staffTimePicker, staffDraftStart, staffDraftEnd]);

  const handleSave = () => {
    // Check plan limit for new staff only
    if (!isEdit) {
      const limitInfo = checkLimit("staff");
      if (!limitInfo.allowed) {
        setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
        setUpgradeSheetVisible(true);
        return;
      }
    }
    const newErrors: { name?: string; location?: string; phone?: string } = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (state.locations.length > 0 && !selectedLocationId) newErrors.location = "Please assign this staff member to a location";
    if (phone.trim() && stripPhoneFormat(phone).length < 10) newErrors.phone = "Please enter a complete 10-digit phone number, e.g. (555) 555-5555";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    const member: StaffMember = {
      id: existing?.id ?? generateId(),
      name: name.trim(),
      phone: stripPhoneFormat(phone),
      email: email.trim(),
      role: role.trim(),
      color,
      serviceIds: allServices ? null : selectedServiceIds,
      locationIds: selectedLocationId ? [selectedLocationId] : null,
      workingHours: useCustomSchedule ? (weekSchedule as any) : null,
      active,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      commissionRate: commissionRate.trim() ? parseFloat(commissionRate) : null,
      photoUri: photoUri ?? null,
    };

    const action = isEdit
      ? { type: "UPDATE_STAFF" as const, payload: member }
      : { type: "ADD_STAFF" as const, payload: member };

    dispatch(action);
    syncToDb(action);
    router.back();
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]} tabletMaxWidth={720} className="pt-3" style={{ paddingHorizontal: hp }}>
      <FuturisticBackground />
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text className="text-xl font-bold text-foreground" style={{ flex: 1 }}>
          {isEdit ? "Edit Staff" : "Add Staff Member"}
        </Text>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Basic Info */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text className="text-base font-semibold text-foreground mb-3">Basic Information</Text>

          {/* Profile Photo */}
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <Pressable onPress={handlePhotoPress} disabled={uploadingPhoto} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              {uploadingPhoto ? (
                <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.primary }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : photoUri ? (
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: colors.primary }}
                />
              ) : (
                <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: color, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border }}>
                  <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>
                    {name.trim() ? name.trim()[0].toUpperCase() : "?"}
                  </Text>
                </View>
              )}
              {!uploadingPhoto && (
                <View style={{ position: "absolute", bottom: 0, right: 0, backgroundColor: colors.primary, borderRadius: 12, width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>+</Text>
                </View>
              )}
            </Pressable>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
              {uploadingPhoto ? "Uploading photo..." : "Tap to add photo"}
            </Text>
          </View>

          <Text className="text-xs font-medium text-muted mb-1">Name *</Text>
          <TextInput
            value={name}
            onChangeText={(v) => { setName(v); if (errors.name) setErrors((e) => ({ ...e, name: undefined })); }}
            placeholder="Staff member name"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.background, borderColor: errors.name ? colors.error : colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />
          {errors.name ? <Text style={{ color: colors.error, fontSize: 12, marginTop: 4 }}>{errors.name}</Text> : null}

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Role / Title</Text>
          <TextInput
            value={role}
            onChangeText={setRole}
            placeholder="e.g. Stylist, Therapist, Manager"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Commission Rate (%)</Text>
          <TextInput
            value={commissionRate}
            onChangeText={(v) => setCommissionRate(v.replace(/[^0-9.]/g, ""))}
            placeholder="e.g. 40 (staff earns 40% of revenue)"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Phone</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => {
              // Strip non-digits, limit to 10 digits, then auto-format
              const digits = v.replace(/\D/g, "").slice(0, 10);
              setPhone(formatPhoneNumber(digits));
              if (errors.phone) setErrors((e) => ({ ...e, phone: undefined }));
            }}
            placeholder="(555) 555-5555"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            maxLength={14}
            style={[styles.input, { backgroundColor: colors.background, borderColor: errors.phone ? colors.error : colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />
          {errors.phone ? <Text style={{ color: colors.error, fontSize: 12, marginTop: 4 }}>{errors.phone}</Text> : null}

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />

          <View style={styles.switchRow}>
            <Text className="text-sm text-foreground">Active</Text>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={Platform.OS === "android" ? (active ? colors.primary : "#f4f3f4") : undefined}
            />
          </View>
        </View>

        {/* Color */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text className="text-base font-semibold text-foreground mb-3">Profile Color</Text>
          <View style={styles.colorRow}>
            {STAFF_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: c },
                  color === c && styles.colorDotSelected,
                ]}
              >
                {color === c && (
                  <IconSymbol name="checkmark" size={16} color="#FFFFFF" />
                )}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Service Assignments */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text className="text-base font-semibold text-foreground mb-2">Service Assignments</Text>
          <Text className="text-xs text-muted mb-3">
            Choose which services this staff member can perform.
          </Text>

          <View style={styles.switchRow}>
            <Text className="text-sm text-foreground">Can perform all services</Text>
            <Switch
              value={allServices}
              onValueChange={(val) => {
                setAllServices(val);
                if (val) setSelectedServiceIds([]);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={Platform.OS === "android" ? (allServices ? colors.primary : "#f4f3f4") : undefined}
            />
          </View>

          {!allServices && (
            <View style={{ marginTop: 12, gap: 6 }}>
              {state.services.length === 0 ? (
                <Text className="text-sm text-muted">No services created yet.</Text>
              ) : (
                state.services.map((svc) => {
                  const selected = selectedServiceIds.includes(svc.id);
                  return (
                    <Pressable
                      key={svc.id}
                      onPress={() => toggleService(svc.id)}
                      style={({ pressed }) => [
                        styles.serviceChip,
                        {
                          backgroundColor: selected ? colors.primary + "15" : colors.background,
                          borderColor: selected ? colors.primary : colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.svcDot, { backgroundColor: svc.color }]} />
                      <Text
                        style={{
                          flex: 1,
                          fontSize: 14,
                          color: colors.foreground,
                        }}
                        numberOfLines={1}
                      >
                        {svc.name}
                      </Text>
                      {selected && (
                        <IconSymbol name="checkmark" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </View>

        {/* Location Assignment — single-select radio list */}
        {state.locations.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text className="text-base font-semibold text-foreground mb-2">Location</Text>
            <Text className="text-xs text-muted mb-3">
              Assign this staff member to one location.
            </Text>

            {errors.location ? <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8 }}>{errors.location}</Text> : null}
            <View style={{ gap: 6 }}>
              {state.locations.map((loc) => {
                const selected = selectedLocationId === loc.id;
                return (
                  <Pressable
                    key={loc.id}
                    onPress={() => { setSelectedLocationId(loc.id); if (errors.location) setErrors((e) => ({ ...e, location: undefined })); }}
                    style={({ pressed }) => [
                      styles.serviceChip,
                      {
                        backgroundColor: selected ? colors.primary + "15" : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <IconSymbol name="location.fill" size={14} color={selected ? colors.primary : colors.muted} />
                    <Text
                      style={{ flex: 1, fontSize: 14, color: colors.foreground }}
                      numberOfLines={1}
                    >
                      {loc.name}
                    </Text>
                    {selected ? (
                      <View style={[styles.radioSelected, { borderColor: colors.primary }]}>
                        <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />
                      </View>
                    ) : (
                      <View style={[styles.radioUnselected, { borderColor: colors.border }]} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Working Hours */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text className="text-base font-semibold text-foreground mb-2">Working Hours</Text>
          <Text className="text-xs text-muted mb-3">
            Set individual hours or use the business default schedule.
          </Text>

          <View style={styles.switchRow}>
            <Text className="text-sm text-foreground">Use custom schedule</Text>
            <Switch
              value={useCustomSchedule}
              onValueChange={setUseCustomSchedule}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={Platform.OS === "android" ? (useCustomSchedule ? colors.primary : "#f4f3f4") : undefined}
            />
          </View>

          {useCustomSchedule && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {DAYS_OF_WEEK.map((day) => {
                const ds = weekSchedule[day] || DEFAULT_DAY;
                return (
                  <View
                    key={day}
                    style={[
                      styles.dayRow,
                      { backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.dayHeader}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "600",
                          color: ds.enabled ? colors.foreground : colors.muted,
                          width: 80,
                        }}
                      >
                        {day.slice(0, 3)}
                      </Text>
                      <Switch
                        value={ds.enabled}
                        onValueChange={(val) => updateDaySchedule(day, "enabled", val)}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor={Platform.OS === "android" ? (ds.enabled ? colors.primary : "#f4f3f4") : undefined}
                        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                      />
                    </View>
                    {ds.enabled && (
                      <Pressable
                        onPress={() => openStaffTimePicker(day)}
                        style={({ pressed }) => [{
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: colors.border,
                          backgroundColor: colors.surface,
                          marginTop: 6,
                          opacity: pressed ? 0.7 : 1,
                        }]}
                      >
                        <IconSymbol name="clock.fill" size={14} color={colors.primary} />
                        <Text style={{ fontSize: 13, color: colors.foreground, marginLeft: 6 }}>
                          {formatTimeDisplay(ds.start)} – {formatTimeDisplay(ds.end)}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Staff Time Picker Modal */}
      <Modal visible={!!staffTimePicker} transparent animationType="slide">
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }} onPress={() => { setStaffTimePicker(null); setStaffSubPicker(null); }}>
          <Pressable style={[{ borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 40, paddingHorizontal: 20, backgroundColor: colors.background }]} onPress={() => {}}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>
                {staffTimePicker ? (staffTimePicker.day.charAt(0).toUpperCase() + staffTimePicker.day.slice(1)) : ""} Hours
              </Text>
              <Pressable onPress={() => { setStaffTimePicker(null); setStaffSubPicker(null); }} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.foreground} />
              </Pressable>
            </View>

            {/* Start row */}
            <Pressable
              onPress={() => setStaffSubPicker(staffSubPicker === "start" ? null : "start")}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, borderRadius: 12, backgroundColor: staffSubPicker === "start" ? colors.primary + "18" : "transparent", marginBottom: 4 }}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Start Time</Text>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.primary }}>{(() => { const [h, m] = staffDraftStart.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const hr = h === 0 ? 12 : h > 12 ? h - 12 : h; return `${hr}:${String(m).padStart(2,"0")} ${ap}`; })()}</Text>
            </Pressable>
            {staffSubPicker === "start" && (
              <TapTimePicker value={staffDraftStart} onChange={(v) => { setStaffDraftStart(v); setStaffTimeError(null); }} stepMinutes={15} />
            )}

            {/* End row */}
            <Pressable
              onPress={() => setStaffSubPicker(staffSubPicker === "end" ? null : "end")}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, borderRadius: 12, backgroundColor: staffSubPicker === "end" ? colors.primary + "18" : "transparent", marginBottom: 4 }}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>End Time</Text>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.primary }}>{(() => { const [h, m] = staffDraftEnd.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const hr = h === 0 ? 12 : h > 12 ? h - 12 : h; return `${hr}:${String(m).padStart(2,"0")} ${ap}`; })()}</Text>
            </Pressable>
            {staffSubPicker === "end" && (
              <TapTimePicker value={staffDraftEnd} onChange={(v) => { setStaffDraftEnd(v); setStaffTimeError(null); }} stepMinutes={15} />
            )}

            {staffTimeError ? (
              <Text style={{ color: colors.error, fontSize: 13, textAlign: "center", marginVertical: 8 }}>{staffTimeError}</Text>
            ) : null}
            <Pressable
              onPress={saveStaffTimePicker}
              style={({ pressed }) => [{ backgroundColor: staffTimeError ? colors.border : colors.primary, paddingVertical: 16, borderRadius: 14, alignItems: "center", opacity: pressed ? 0.8 : 1, marginTop: 12 }]}
            >
              <Text style={{ color: staffTimeError ? colors.muted : "#fff", fontWeight: "700", fontSize: 16 }}>Save Hours</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {upgradeSheetInfo && (
        <UpgradePlanSheet
          visible={upgradeSheetVisible}
          onClose={() => setUpgradeSheetVisible(false)}
          currentPlanKey={upgradeSheetInfo.planKey}
          currentPlanName={upgradeSheetInfo.planName}
          resource="staff"
          currentLimit={upgradeSheetInfo.limit}
          businessOwnerId={state.businessOwnerId!}
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
    paddingTop: 8,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  colorDotSelected: {
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.6)",
  },
  serviceChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  svcDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dayRow: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  timeInput: {
    height: 36,
    width: 80,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    textAlign: "center",
  },
  radioSelected: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  radioUnselected: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
});
