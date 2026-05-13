import { useState, useMemo, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  Share,
  Platform,
  Switch,
  Modal,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { trpc } from "@/lib/trpc";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  Location,
  formatPhoneNumber,
  formatFullAddress,
  PUBLIC_BOOKING_URL,
  WorkingHours,
  DEFAULT_WORKING_HOURS,
  DAYS_OF_WEEK,
} from "@/lib/types";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { TapTimePicker, timeToMinutes as tapTimeToMinutes } from "@/components/tap-time-picker";
import QRCode from "react-native-qrcode-svg";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { FuturisticBackground } from "@/components/futuristic-background";
import ConfettiCannon from "react-native-confetti-cannon";


const DAY_LABELS: Record<string, string> = { sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat" };
const DAY_FULL: Record<string, string> = { sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday" };

function formatTimeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function LocationFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, dispatch, syncToDb, getClientById } = useStore();
  const { setActiveLocation } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { checkLimit } = usePlanLimitCheck();
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeSheetInfo, setUpgradeSheetInfo] = useState<{ planKey: string; planName: string; limit: number } | null>(null);

  const existing = useMemo(
    () => (id ? state.locations.find((l) => l.id === id) : undefined),
    [state.locations, id]
  );

  const isEdit = !!existing;

  const [name, setName] = useState(existing?.name ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [city, setCity] = useState(existing?.city ?? "");
  const [locationState, setLocationState] = useState(existing?.state ?? "");
  const [zipCode, setZipCode] = useState(existing?.zipCode ?? "");
  const isFirstLocation = !isEdit && state.locations.length === 0;
  const [phone, setPhone] = useState(
    formatPhoneNumber(existing?.phone ?? (isFirstLocation ? (state.settings.profile?.phone ?? "") : ""))
  );
  const [email, setEmail] = useState(existing?.email ?? "");
  const [photoUri, setPhotoUri] = useState<string>(existing?.photoUri ?? "");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const pickLocationPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to add a location photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      if (Platform.OS !== "web") {
        try {
          setUploadingPhoto(true);
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const mimeType = result.assets[0].mimeType ?? "image/jpeg";
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "locations" });
          setPhotoUri(url);
        } catch {
          setPhotoUri(localUri);
        } finally {
          setUploadingPhoto(false);
        }
      } else {
        setPhotoUri(localUri);
      }
    }
  };
  // Validation errors
  const [errors, setErrors] = useState<{ name?: string; address?: string }>({});
  // First-action prompt (shown once after saving the very first location)
  const [showFirstActionPrompt, setShowFirstActionPrompt] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiRef = useRef<any>(null);

  const handleSave = () => {
    // Check plan limit for new locations only
    if (!isEdit) {
      const limitInfo = checkLimit("locations");
      if (!limitInfo.allowed) {
        setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
        setUpgradeSheetVisible(true);
        return;
      }
    }
    const newErrors: { name?: string; address?: string } = {};
    if (!name.trim()) newErrors.name = "Location name is required";
    if (!address.trim()) newErrors.address = "Street address is required";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    // New locations default to active. The first location is also set as default.
    const loc: Location = {
      id: existing?.id ?? generateId(),
      name: name.trim(),
      address: address.trim(),
      city: city.trim(),
      state: locationState.trim(),
      zipCode: zipCode.trim(),
      phone: phone.trim(),
      email: email.trim(),
      isDefault: existing?.isDefault ?? isFirstLocation,
      active: existing?.active ?? true,
      temporarilyClosed: existing?.temporarilyClosed,
      reopenOn: existing?.reopenOn,
      activeUntil: activeUntil,
      workingHours: useLocationHours ? locationHours : {},
      photoUri: photoUri.trim() || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      bufferMinutes: locBufferMinutes ?? undefined,
      slotIntervalMinutes: locSlotIntervalMinutes ?? undefined,
    };

    const action = isEdit
      ? { type: "UPDATE_LOCATION" as const, payload: loc }
      : { type: "ADD_LOCATION" as const, payload: loc };

    dispatch(action);
    syncToDb(action);
    // Auto-set as active location when adding a new location
    if (!isEdit) setActiveLocation(loc.id);

    // Show first-action prompt once after the very first location is saved
    if (isFirstLocation) {
      AsyncStorage.getItem("@lime_first_action_shown").then((val) => {
        if (!val) {
          // Fire confetti first, then show prompt
          setShowConfetti(true);
          setTimeout(() => setShowFirstActionPrompt(true), 400);
        } else {
          router.back();
        }
      });
    } else {
      router.back();
    }
  };

  const handleDelete = () => {
    if (!existing) return;
    Alert.alert(
      "Delete Location",
      `Are you sure you want to delete "${existing.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const action = { type: "DELETE_LOCATION" as const, payload: existing.id };
            dispatch(action);
            syncToDb(action);
            router.back();
          },
        },
      ]
    );
  };

  // ── Business Hours state ────────────────────────────────────────────────────
  const [locationHours, setLocationHours] = useState<Record<string, WorkingHours>>(() => {
    if (existing?.workingHours && Object.keys(existing.workingHours).length > 0) {
      return existing.workingHours as Record<string, WorkingHours>;
    }
    return { ...DEFAULT_WORKING_HOURS };
  });
  const [useLocationHours, setUseLocationHours] = useState(
    !!(existing?.workingHours && Object.keys(existing.workingHours).length > 0)
  );
  // ── Per-location Buffer & Slot Interval overrides ────────────────────────────
  const [locBufferMinutes, setLocBufferMinutes] = useState<number | null>(
    existing?.bufferMinutes != null ? existing.bufferMinutes : null
  );
  const [locSlotIntervalMinutes, setLocSlotIntervalMinutes] = useState<number | null>(
    existing?.slotIntervalMinutes != null ? existing.slotIntervalMinutes : null
  );
  const [showLocBufferPicker, setShowLocBufferPicker] = useState(false);
  const [showLocSlotPicker, setShowLocSlotPicker] = useState(false);

  // ── Active Until ────────────────────────────────────────────────────────────
  const [activeUntil, setActiveUntil] = useState<string | undefined>(existing?.activeUntil);
  const [showActiveUntilPicker, setShowActiveUntilPicker] = useState(false);
  const [activeUntilCalMonth, setActiveUntilCalMonth] = useState(() => new Date().getMonth());
  const [activeUntilCalYear, setActiveUntilCalYear] = useState(() => new Date().getFullYear());
  const todayStr = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
  const CAL_MONTHS_AU = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const CAL_DAYS_AU = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const buildActiveUntilGrid = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  };
  const formatActiveUntilLabel = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch { return null; }
  };
  const [timePickerDay, setTimePickerDay] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState("09:00");
  const [draftEnd, setDraftEnd] = useState("17:00");
  const [weekTimeError, setWeekTimeError] = useState<string | null>(null);
  const [weekSubPicker, setWeekSubPicker] = useState<"start" | "end" | null>(null);

  const openTimePicker = useCallback((day: string) => {
    const wh = locationHours[day];
    setDraftStart(wh?.start ?? "09:00");
    setDraftEnd(wh?.end ?? "17:00");
    setWeekTimeError(null);
    setWeekSubPicker(null);
    setTimePickerDay(day);
  }, [locationHours]);

  const saveTimePicker = useCallback(() => {
    if (!timePickerDay) return;
    if (tapTimeToMinutes(draftEnd) <= tapTimeToMinutes(draftStart)) {
      setWeekTimeError("End time must be after start time.");
      return;
    }
    setWeekTimeError(null);
    setLocationHours((prev) => {
      const existing = prev[timePickerDay] ?? { enabled: true, start: "09:00", end: "17:00" };
      return { ...prev, [timePickerDay]: { ...existing, start: draftStart, end: draftEnd } };
    });
    setTimePickerDay(null);
    setWeekSubPicker(null);
  }, [timePickerDay, draftStart, draftEnd]);

  const toggleDay = useCallback((day: string) => {
    const currentHours = locationHours[day] ?? { enabled: false, start: "09:00", end: "17:00" };
    // Only check for conflicts when disabling (turning OFF) a day that is currently enabled
    if (currentHours.enabled) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayIndex = DAYS_OF_WEEK.indexOf(day as typeof DAYS_OF_WEEK[number]);
      const upcomingOnDay = state.appointments.filter((appt) => {
        if (appt.status === "cancelled" || appt.status === "completed") return false;
        const apptDate = new Date(appt.date + "T00:00:00");
        if (apptDate < today) return false;
        if (apptDate.getDay() !== dayIndex) return false;
        if (existing?.id && appt.locationId && appt.locationId !== existing.id) return false;
        return true;
      });
      if (upcomingOnDay.length > 0) {
        const clientNames = upcomingOnDay
          .slice(0, 3)
          .map((a) => {
            const client = getClientById(a.clientId);
            return client ? client.name : "Client";
          })
          .join(", ");
        const moreCount = upcomingOnDay.length > 3 ? ` +${upcomingOnDay.length - 3} more` : "";
        Alert.alert(
          "Upcoming Appointments",
          `${DAY_FULL[day]} has ${upcomingOnDay.length} upcoming appointment${upcomingOnDay.length > 1 ? "s" : ""}: ${clientNames}${moreCount}.\n\nYou cannot close this day while appointments are scheduled.`,
          [
            { text: "Keep Open", style: "cancel" },
            {
              text: "Stop New Bookings Only",
              onPress: () => {
                Alert.alert(
                  "Stop New Bookings",
                  `${DAY_FULL[day]} will stay open for existing appointments. To stop new bookings for this location entirely, use the 'Accepting Bookings' toggle on the Locations screen.`,
                  [{ text: "OK" }]
                );
              },
            },
          ]
        );
        return;
      }
    }
    setLocationHours((prev) => {
      const cur = prev[day] ?? { enabled: false, start: "09:00", end: "17:00" };
      return { ...prev, [day]: { ...cur, enabled: !cur.enabled } };
    });
  }, [locationHours, state.appointments, existing, getClientById]);

  // ── QR code modal ────────────────────────────────────────────────────────────
  const [showQr, setShowQr] = useState(false);
  const qrRef = useRef<ViewShot>(null);
  const [savingQr, setSavingQr] = useState(false);

  const saveQrToPhotos = useCallback(async () => {
    if (!qrRef.current) return;
    setSavingQr(true);
    try {
      const uri = await captureRef(qrRef, { format: "png", quality: 1 });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Save or Share QR Code" });
      } else {
        Alert.alert("Saved!", "QR code is ready to share.");
      }
    } catch {
      Alert.alert("Error", "Could not save QR code. Please try again.");
    } finally {
      setSavingQr(false);
    }
  }, []);

  const [copiedLink, setCopiedLink] = useState(false);

  const locationBookingUrl = useMemo(() => {
    if (!existing) return null;
    const slug =
      state.settings.customSlug ||
      state.settings.businessName.replace(/\s+/g, "-").toLowerCase();
    return `${PUBLIC_BOOKING_URL}/book/${slug}?location=${existing.id}`;
  }, [existing, state.settings.customSlug, state.settings.businessName]);

  const handleCopyLink = useCallback(async () => {
    if (!locationBookingUrl) return;
    await Clipboard.setStringAsync(locationBookingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  }, [locationBookingUrl]);

  const handleShareLink = useCallback(async () => {
    if (!locationBookingUrl || !existing) return;
    const businessName = state.settings.businessName || "our business";
    const fullAddr = formatFullAddress(existing.address, existing.city, existing.state, existing.zipCode);
    const addrLine = fullAddr ? `\n📍 ${fullAddr}` : "";
    const phoneLine = existing.phone ? `\n📞 ${formatPhoneNumber(existing.phone)}` : "";
    try {
      await Share.share({
        message: `Book an appointment with ${businessName}!${addrLine}${phoneLine}\n\nSchedule online: ${locationBookingUrl}\n\nPowered by Lime Of Time`,
        title: `Book at ${existing.name}`,
      });
    } catch {
      // User dismissed
    }
  }, [locationBookingUrl, existing, state.settings.businessName]);

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
          {isEdit ? "Edit Location" : "Add Location"}
        </Text>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: fs.sm }}>Save</Text>
        </Pressable>
      </View>

            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* First-location welcome banner */}
        {isFirstLocation && (
          <View style={[styles.section, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <Text style={{ fontSize: fs.lg }}>📍</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.primary, marginBottom: 4 }}>Add Your Business Location</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, lineHeight: 19 }}>
                  Your address will appear on your booking page so clients know where to find you. You can always add more locations later.
                </Text>
              </View>
            </View>
          </View>
        )}
        {/* Basic Info */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text className="text-base font-semibold text-foreground mb-3">Location Details</Text>

          <Text className="text-xs font-medium text-muted mb-1">Name *</Text>
          <TextInput
            value={name}
            onChangeText={(v) => { setName(v); if (errors.name) setErrors((e) => ({ ...e, name: undefined })); }}
            placeholder="e.g. Main Office, Downtown Branch"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.background, borderColor: errors.name ? colors.error : colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />
          {errors.name ? <Text style={{ color: colors.error, fontSize: fs.xs, marginTop: 4 }}>{errors.name}</Text> : null}

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Address *</Text>
          <TextInput
            value={address}
            onChangeText={(v) => { setAddress(v); if (errors.address) setErrors((e) => ({ ...e, address: undefined })); }}
            placeholder="e.g. 123 Main Street"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.background, borderColor: errors.address ? colors.error : colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />
          {errors.address ? <Text style={{ color: colors.error, fontSize: fs.xs, marginTop: 4 }}>{errors.address}</Text> : null}

          {/* City / State / ZIP row */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 2 }}>
              <Text className="text-xs font-medium text-muted mb-1">City</Text>
              <TextInput
                value={city}
                onChangeText={setCity}
                placeholder="e.g. New York"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="next"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text className="text-xs font-medium text-muted mb-1">State</Text>
              <TextInput
                value={locationState}
                onChangeText={setLocationState}
                placeholder="NY"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                maxLength={2}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="next"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text className="text-xs font-medium text-muted mb-1">ZIP</Text>
              <TextInput
                value={zipCode}
                onChangeText={setZipCode}
                placeholder="10001"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                maxLength={10}
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="next"
              />
            </View>
          </View>

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Phone</Text>
          <TextInput
            value={phone}
            onChangeText={(val) => setPhone(formatPhoneNumber(val))}
            placeholder="e.g. (212) 555-0100"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />

          <Text className="text-xs font-medium text-muted mb-1 mt-3">Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="e.g. info@yourbusiness.com"
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            returnKeyType="done"
          />
          {/* Studio Photo */}
          <Text className="text-xs font-medium text-muted mb-1 mt-4">Studio Photo (optional)</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8, lineHeight: 15 }}>
            Shown on the client booking page as a cover image for this location.
          </Text>
          <Pressable
            onPress={pickLocationPhoto}
            style={({ pressed }) => ({
              borderRadius: 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              height: photoUri ? 160 : 80,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : photoUri ? (
              <>
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
                <View style={{
                  position: "absolute", bottom: 8, right: 8,
                  backgroundColor: "rgba(0,0,0,0.55)",
                  borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                  flexDirection: "row", alignItems: "center", gap: 5,
                }}>
                  <IconSymbol name="pencil" size={12} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "600" }}>Change</Text>
                </View>
              </>
            ) : (
              <View style={{ alignItems: "center", gap: 6 }}>
                <IconSymbol name="photo.badge.plus" size={28} color={colors.muted} />
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Tap to add a studio photo</Text>
              </View>
            )}
          </Pressable>
          {photoUri ? (
            <Pressable
              onPress={() => setPhotoUri("")}
              style={({ pressed }) => ({ alignSelf: "flex-end", marginTop: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontSize: fs.xs, color: colors.error }}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Booking Link (edit mode only) */}
        {isEdit && locationBookingUrl && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <IconSymbol name="link" size={15} color={colors.primary} />
              <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>Booking Link</Text>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, lineHeight: 17, marginBottom: 10 }}>
              Share this link so clients can book directly at this location.
            </Text>
            {/* URL preview */}
            <View style={[styles.urlPreviewBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.xs, color: colors.muted, flex: 1 }} numberOfLines={1}>
                {locationBookingUrl}
              </Text>
            </View>
            {/* Copy + Share buttons */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                onPress={handleCopyLink}
                style={({ pressed }) => [
                  styles.linkBtn,
                  {
                    backgroundColor: copiedLink ? colors.success + "18" : colors.primary + "12",
                    borderColor: copiedLink ? colors.success + "50" : colors.primary + "30",
                    opacity: pressed ? 0.7 : 1,
                    flex: 1,
                  },
                ]}
              >
                <IconSymbol
                  name={copiedLink ? "checkmark.circle.fill" : "doc.on.doc.fill"}
                  size={15}
                  color={copiedLink ? colors.success : colors.primary}
                />
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: copiedLink ? colors.success : colors.primary }}>
                  {copiedLink ? "Copied!" : "Copy Link"}
                </Text>
              </Pressable>
              {Platform.OS !== "web" && (
                <Pressable
                  onPress={handleShareLink}
                  style={({ pressed }) => [
                    styles.linkBtn,
                    {
                      backgroundColor: colors.primary + "12",
                      borderColor: colors.primary + "30",
                      opacity: pressed ? 0.7 : 1,
                      flex: 1,
                    },
                  ]}
                >
                  <IconSymbol name="square.and.arrow.up" size={15} color={colors.primary} />
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>Share</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Business Hours (add and edit mode) */}
        {true && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>Location Business Hours</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, lineHeight: 17 }}>
                  {useLocationHours ? "Custom hours for this location." : "Using global business hours from Schedule Settings."}
                </Text>
              </View>
              <Switch
                value={useLocationHours}
                onValueChange={setUseLocationHours}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={useLocationHours ? colors.primary : colors.muted}
              />
            </View>
            {useLocationHours && (
              <View style={{ marginTop: 12 }}>
                {DAYS_OF_WEEK.map((day, idx) => {
                  const wh = locationHours[day] ?? { enabled: false, start: "09:00", end: "17:00" };
                  const isLast = idx === DAYS_OF_WEEK.length - 1;
                  return (
                    <View key={day} style={[styles.dayRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border + "40" }]}>
                      <Switch
                        value={wh.enabled}
                        onValueChange={() => toggleDay(day)}
                        trackColor={{ false: colors.border, true: colors.primary + "60" }}
                        thumbColor={wh.enabled ? colors.primary : colors.muted}
                        style={{ transform: [{ scale: 0.8 }] }}
                      />
                      <Text style={{ fontSize: fs.xs, fontWeight: "500", width: 44, marginLeft: 8, color: wh.enabled ? colors.foreground : colors.muted }}>
                        {DAY_LABELS[day]}
                      </Text>
                      {wh.enabled && (
                        <Pressable
                          onPress={() => openTimePicker(day)}
                          style={({ pressed }) => [
                            styles.timeButton,
                            { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <Text style={{ fontSize: fs.xs, color: colors.foreground }}>
                            {formatTimeLabel(wh.start)} – {formatTimeLabel(wh.end)}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Per-location Buffer & Slot Interval overrides */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <IconSymbol name="clock" size={16} color={colors.primary} />
            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>Scheduling Overrides</Text>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 12, lineHeight: 17 }}>
            Override the global buffer time and slot interval for this location only. Leave blank to use the global setting.
          </Text>
          {/* Buffer Time */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Buffer Time (minutes)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: "row" }}>
              {[null, 0, 5, 10, 15, 20, 30, 45, 60].map((mins) => {
                const isActive = locBufferMinutes === mins;
                const label = mins === null ? "Global" : mins === 0 ? "None" : `${mins}m`;
                return (
                  <Pressable
                    key={String(mins)}
                    onPress={() => setLocBufferMinutes(mins)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
                      backgroundColor: isActive ? colors.primary : colors.background,
                      borderWidth: 1, borderColor: isActive ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isActive ? "#FFFFFF" : colors.foreground }}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          {/* Slot Interval */}
          <View>
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Slot Interval (minutes)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: "row" }}>
              {[null, 0, 5, 10, 15, 20, 25, 30, 45, 60].map((mins) => {
                const isActive = locSlotIntervalMinutes === mins;
                const label = mins === null ? "Global" : mins === 0 ? "Auto" : `${mins}m`;
                return (
                  <Pressable
                    key={String(mins)}
                    onPress={() => setLocSlotIntervalMinutes(mins)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
                      backgroundColor: isActive ? colors.primary : colors.background,
                      borderWidth: 1, borderColor: isActive ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: fs.xs, fontWeight: "600", color: isActive ? "#FFFFFF" : colors.foreground }}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* Active Until */}
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <IconSymbol name="calendar.badge.clock" size={16} color="#9C27B0" />
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>Active Until</Text>
              </View>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 3, lineHeight: 17 }}>
                {activeUntil
                  ? `Bookings accepted until ${formatActiveUntilLabel(activeUntil)}. After this date, no slots are shown.`
                  : "Optionally set an end date. After this date, no booking slots will be shown for this location."}
              </Text>
            </View>
            <Switch
              value={!!activeUntil || showActiveUntilPicker}
              onValueChange={(v) => {
                if (!v) { setActiveUntil(undefined); setShowActiveUntilPicker(false); }
                else { setShowActiveUntilPicker(true); }
              }}
              trackColor={{ false: colors.border, true: "#9C27B060" }}
              thumbColor={activeUntil ? "#9C27B0" : colors.muted}
            />
          </View>
          {activeUntil && !showActiveUntilPicker && (
            <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#9C27B015", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "#9C27B040" }}>
                <IconSymbol name="calendar" size={14} color="#9C27B0" />
                <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#9C27B0" }}>{formatActiveUntilLabel(activeUntil)}</Text>
              </View>
              <Pressable
                onPress={() => setShowActiveUntilPicker(true)}
                style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ fontSize: fs.xs, color: colors.foreground }}>Change</Text>
              </Pressable>
            </View>
          )}
          {showActiveUntilPicker && (
            <View style={{ marginTop: 12 }}>
              {/* Month navigation */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Pressable
                  onPress={() => {
                    if (activeUntilCalMonth === 0) { setActiveUntilCalMonth(11); setActiveUntilCalYear(y => y - 1); }
                    else setActiveUntilCalMonth(m => m - 1);
                  }}
                  style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.5 : 1 }]}
                >
                  <IconSymbol name="chevron.left" size={18} color={colors.foreground} />
                </Pressable>
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>
                  {CAL_MONTHS_AU[activeUntilCalMonth]} {activeUntilCalYear}
                </Text>
                <Pressable
                  onPress={() => {
                    if (activeUntilCalMonth === 11) { setActiveUntilCalMonth(0); setActiveUntilCalYear(y => y + 1); }
                    else setActiveUntilCalMonth(m => m + 1);
                  }}
                  style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.5 : 1 }]}
                >
                  <IconSymbol name="chevron.right" size={18} color={colors.foreground} />
                </Pressable>
              </View>
              {/* Day headers */}
              <View style={{ flexDirection: "row", marginBottom: 4 }}>
                {CAL_DAYS_AU.map(d => (
                  <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>{d}</Text>
                ))}
              </View>
              {/* Calendar grid */}
              {(() => {
                const cells = buildActiveUntilGrid(activeUntilCalYear, activeUntilCalMonth);
                const rows: (number | null)[][] = [];
                for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
                return rows.map((row, ri) => (
                  <View key={ri} style={{ flexDirection: "row", marginBottom: 2 }}>
                    {row.map((day, ci) => {
                      const dateStr = day ? `${activeUntilCalYear}-${String(activeUntilCalMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                      const isPast = dateStr ? dateStr < todayStr : false;
                      const isSelected = dateStr === activeUntil;
                      return (
                        <Pressable
                          key={ci}
                          onPress={() => {
                            if (!day || isPast) return;
                            if (dateStr) { setActiveUntil(dateStr); setShowActiveUntilPicker(false); }
                          }}
                          style={({ pressed }) => [{
                            flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 8, margin: 1,
                            backgroundColor: isSelected ? "#9C27B0" : "transparent",
                            opacity: isPast ? 0.3 : pressed ? 0.7 : 1,
                          }]}
                        >
                          <Text style={{ fontSize: fs.xs, fontWeight: isSelected ? "700" : "400", color: isSelected ? "#fff" : colors.foreground }}>
                            {day ?? ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ));
              })()}
              <Pressable
                onPress={() => { setActiveUntil(undefined); setShowActiveUntilPicker(false); }}
                style={({ pressed }) => [{ marginTop: 10, alignSelf: "center", opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Clear date</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* QR Code (edit mode only) */}
        {isEdit && locationBookingUrl && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <IconSymbol name="qrcode" size={15} color={colors.primary} />
              <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>QR Code</Text>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, lineHeight: 17, marginBottom: 10 }}>
              Display or print this QR code so walk-in clients can scan it to book online.
            </Text>
            <Pressable
              onPress={() => setShowQr(true)}
              style={({ pressed }) => [
                styles.linkBtn,
                { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30", opacity: pressed ? 0.7 : 1, alignSelf: "flex-start" },
              ]}
            >
              <IconSymbol name="qrcode" size={15} color={colors.primary} />
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>View QR Code</Text>
            </Pressable>
          </View>
        )}

        {/* Delete Button (edit mode only) */}
        {isEdit && (
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [
              styles.deleteBtn,
              { borderColor: colors.error, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <IconSymbol name="trash.fill" size={18} color={colors.error} />
            <Text style={{ color: colors.error, fontWeight: "600", fontSize: fs.sm }}>
              Delete Location
            </Text>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      {/* Time Picker Modal */}
      <Modal visible={!!timePickerDay} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => { setTimePickerDay(null); setWeekSubPicker(null); }}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.background }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
                {timePickerDay ? DAY_FULL[timePickerDay] : ""} Hours
              </Text>
              <Pressable onPress={() => { setTimePickerDay(null); setWeekSubPicker(null); }} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <Pressable
              onPress={() => setWeekSubPicker(weekSubPicker === "start" ? null : "start")}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, borderRadius: 12, backgroundColor: weekSubPicker === "start" ? colors.primary + "18" : "transparent", marginBottom: 4 }}
            >
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Start Time</Text>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>{formatTimeLabel(draftStart)}</Text>
            </Pressable>
            {weekSubPicker === "start" && (
              <TapTimePicker value={draftStart} onChange={(v) => { setDraftStart(v); setWeekTimeError(null); }} stepMinutes={5} />
            )}
            <Pressable
              onPress={() => setWeekSubPicker(weekSubPicker === "end" ? null : "end")}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, borderRadius: 12, backgroundColor: weekSubPicker === "end" ? colors.primary + "18" : "transparent", marginBottom: 4 }}
            >
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>End Time</Text>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>{formatTimeLabel(draftEnd)}</Text>
            </Pressable>
            {weekSubPicker === "end" && (
              <TapTimePicker value={draftEnd} onChange={(v) => { setDraftEnd(v); setWeekTimeError(null); }} stepMinutes={5} />
            )}
            {weekTimeError ? (
              <Text style={{ color: colors.error, fontSize: fs.xs, textAlign: "center", marginVertical: 8 }}>{weekTimeError}</Text>
            ) : null}
            <Pressable
              onPress={saveTimePicker}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: weekTimeError ? colors.border : colors.primary, opacity: pressed ? 0.8 : 1, marginTop: 12 }]}
            >
              <Text style={{ color: weekTimeError ? colors.muted : "#fff", fontWeight: "700", fontSize: fs.md }}>Save Hours</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* QR Code Modal */}
      <Modal visible={showQr} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowQr(false)}>
          <Pressable style={[styles.qrModalContent, { backgroundColor: colors.background }]} onPress={() => {}}>
            <View style={[styles.modalHeader, { width: "100%" }]}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>Booking QR Code</Text>
              <Pressable onPress={() => setShowQr(false)} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                <IconSymbol name="xmark" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            {existing && locationBookingUrl && (
              <>
                <Text style={{ fontSize: fs.xs, color: colors.muted, textAlign: "center", marginBottom: 20, lineHeight: 18 }}>
                  Scan to book at {existing.name}
                </Text>
                <ViewShot ref={qrRef} style={{ padding: 16, backgroundColor: "#FFFFFF", borderRadius: 16, marginBottom: 20 }}>
                  <QRCode value={locationBookingUrl} size={200} />
                </ViewShot>
                <Text style={{ fontSize: fs.xs, color: colors.muted, textAlign: "center", lineHeight: 16, marginBottom: 20 }} numberOfLines={2}>
                  {locationBookingUrl}
                </Text>
                {/* Action buttons */}
                <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
                  <Pressable
                    onPress={saveQrToPhotos}
                    disabled={savingQr}
                    style={({ pressed }) => [{
                      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                      gap: 6, paddingVertical: 12, borderRadius: 12,
                      backgroundColor: savingQr ? "#9CA3AF" : "#4A7C59",
                      opacity: pressed ? 0.85 : 1,
                    }]}
                  >
                    <IconSymbol name="arrow.down.to.line" size={16} color="#FFF" />
                    <Text style={{ color: "#FFF", fontWeight: "700", fontSize: fs.sm }}>
                      {savingQr ? "Saving..." : "Save to Photos"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Share.share({ url: locationBookingUrl, message: locationBookingUrl })}
                    style={({ pressed }) => [{
                      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                      gap: 6, paddingVertical: 12, borderRadius: 12,
                      borderWidth: 1.5, borderColor: colors.border,
                      backgroundColor: colors.surface,
                      opacity: pressed ? 0.7 : 1,
                    }]}
                  >
                    <IconSymbol name="square.and.arrow.up" size={16} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs.sm }}>Share</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {upgradeSheetInfo && (
        <UpgradePlanSheet
          visible={upgradeSheetVisible}
          onClose={() => setUpgradeSheetVisible(false)}
          currentPlanKey={upgradeSheetInfo.planKey}
          currentPlanName={upgradeSheetInfo.planName}
          resource="locations"
          currentLimit={upgradeSheetInfo.limit}
          businessOwnerId={state.businessOwnerId!}
        />
      )}

      {/* ── First-Action Prompt ─────────────────────────────────────────── */}
      <Modal
        visible={showFirstActionPrompt}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          AsyncStorage.setItem("@lime_first_action_shown", "1");
          setShowFirstActionPrompt(false);
          router.back();
        }}
      >
        <View style={styles.firstActionOverlay}>
          <View style={styles.firstActionCard}>
            <Text style={styles.firstActionEmoji}>🎉</Text>
            <Text style={styles.firstActionTitle}>You're all set!</Text>
            <Text style={styles.firstActionSubtitle}>
              Your location has been saved. What would you like to do first?
            </Text>
            <View style={styles.firstActionButtons}>
              {[
                { label: "Add a Service", emoji: "✂️", route: "/service-form" },
                { label: "Add a Client", emoji: "👤", route: "/(tabs)/clients" },
                { label: "Set Working Hours", emoji: "🕐", route: "/(tabs)/settings" },
              ].map((item) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [styles.firstActionBtn, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={async () => {
                    await AsyncStorage.setItem("@lime_first_action_shown", "1");
                    setShowFirstActionPrompt(false);
                    router.replace(item.route as any);
                  }}
                >
                  <Text style={styles.firstActionBtnEmoji}>{item.emoji}</Text>
                  <Text style={styles.firstActionBtnLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [styles.firstActionSkip, { opacity: pressed ? 0.6 : 1 }]}
              onPress={async () => {
                await AsyncStorage.setItem("@lime_first_action_shown", "1");
                setShowFirstActionPrompt(false);
                router.back();
              }}
            >
              <Text style={styles.firstActionSkipText}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Confetti burst on first location save ── */}
      {showConfetti && (
        <ConfettiCannon
          ref={confettiRef}
          count={180}
          origin={{ x: -10, y: 0 }}
          autoStart
          fadeOut
          fallSpeed={2800}
          explosionSpeed={350}
          onAnimationEnd={() => setShowConfetti(false)}
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
    fontSize: 13,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  urlPreviewBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  dayRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  timeButton: { flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: 36, marginLeft: 4 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 40, paddingHorizontal: 20,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center' as const, },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  qrModalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 40, paddingHorizontal: 20, alignItems: "center",
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center' as const },
  // First-action prompt
  firstActionOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  firstActionCard: { width: "100%", maxWidth: 360, backgroundColor: "#fff", borderRadius: 24, padding: 28, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 12 },
  firstActionEmoji: { fontSize: 48, marginBottom: 12 },
  firstActionTitle: { fontSize: 17, fontWeight: "700", color: "#11181C", textAlign: "center", marginBottom: 8 },
  firstActionSubtitle: { fontSize: 13, color: "#687076", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  firstActionButtons: { width: "100%", gap: 10, marginBottom: 16 },
  firstActionBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#F5F5F5", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, gap: 12 },
  firstActionBtnEmoji: { fontSize: 17 },
  firstActionBtnLabel: { fontSize: 13, fontWeight: "600", color: "#11181C" },
  firstActionSkip: { paddingVertical: 8, paddingHorizontal: 16 },
  firstActionSkipText: { fontSize: 11, color: "#687076", textDecorationLine: "underline" },
});
