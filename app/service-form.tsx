import {
  Text, View, Pressable, StyleSheet, TextInput, ScrollView,
  Alert, Platform, Image, ActivityIndicator, Modal, TouchableOpacity, KeyboardAvoidingView, Switch,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useMemo } from "react";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { UpgradePlanSheet } from "@/components/upgrade-plan-sheet";
import { SERVICE_COLORS, Service } from "@/lib/types";
import { TapDurationPicker, formatDuration } from "@/components/tap-duration-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { FuturisticBackground } from "@/components/futuristic-background";
import { trpc } from "@/lib/trpc";
import { SERVICE_CATEGORIES, MOBILE_SERVICE_CATEGORIES, getCategoryDef } from "@/constants/categories";
import { FlatList } from "react-native";

// ─── Emoji data for service name picker ──────────────────────────────────────
const SERVICE_EMOJI_OPTIONS = [
  // Hair & Grooming
  "💇", "✂️", "💈", "🪮", "👱", "🧔",
  // Nails & Beauty
  "💅", "💎", "✨", "💄", "👄", "💋",
  // Face & Skin
  "🧖", "🫧", "🧴", "💆", "🌿", "🪷",
  // Body & Massage
  "💪", "🛁", "🧘", "🌸", "🪻", "🌺",
  // Wellness & Health
  "🌱", "🍃", "🩺", "💊", "🩹", "🏃",
  // Eyes & Lashes
  "👁️", "🎨", "🪞", "🌈", "🔮", "💫",
  // Spa & Relaxation
  "🕯️", "🌻", "🌼", "🌷", "🫖", "☕",
  // Fitness & Sport
  "🏋️", "🤸", "🧗", "🏊", "🚴", "⚽",
  // Food & Nutrition
  "🥗", "🥤", "🍎", "🥑", "🫐", "🍋",
  // Photography & Art
  "📸", "🎭", "🎨", "🖌️", "🎬", "🎤",
  // Education & Coaching
  "📚", "🎓", "🧠", "💡", "📝", "🏆",
  // Tech & Business
  "💻", "📱", "🔧", "⚙️", "📊", "💼",
  // Home & Cleaning
  "🏠", "🧹", "🧽", "🪣", "🌿", "🛋️",
  // Pets
  "🐾", "🐶", "🐱", "🐴", "🐠", "🦜",
  // Events & Celebrations
  "🎉", "🎊", "🎁", "🎂", "🥂", "🎈",
  // General
  "⭐", "🌟", "🎯", "🔖", "🏷️", "📌",
  // Symbols
  "➕", "❤️", "💛", "💚", "💙", "💜",
];

export default function ServiceFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { checkLimit, planInfo } = usePlanLimitCheck();
  const smsLevel: string = (planInfo?.limits as { smsLevel?: string } | undefined)?.smsLevel ?? "none";
  const hasSms = smsLevel !== "none";
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeSheetInfo, setUpgradeSheetInfo] = useState<{ planKey: string; planName: string; limit: number } | null>(null);
  const [lightboxVisible, setLightboxVisible] = useState(false);

  const existing = useMemo(
    () => (id ? state.services.find((s) => s.id === id) : undefined),
    [state.services, id]
  );

  const [name, setName] = useState(existing?.name ?? "");
  const [duration, setDuration] = useState(existing?.duration ?? 60);
  const [price, setPrice] = useState(existing?.price?.toString() ?? "");
  const [color, setColor] = useState(existing?.color ?? SERVICE_COLORS[0]);
  const [category, setCategory] = useState(existing?.category ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [photoUri, setPhotoUri] = useState<string | undefined>(existing?.photoUri);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [reminderHours, setReminderHours] = useState<string>(
    existing?.reminderHours != null ? String(existing.reminderHours) : ""
  );
  const [serviceType, setServiceType] = useState<'in_store' | 'mobile'>(existing?.serviceType ?? 'in_store');
  const [travelFee, setTravelFee] = useState<string>(
    existing?.travelFee != null ? String(existing.travelFee) : ""
  );
  const [maxTravelDistance, setMaxTravelDistance] = useState<string>(
    existing?.maxTravelDistance != null ? String(existing.maxTravelDistance) : ""
  );
  const [travelDuration, setTravelDuration] = useState<string>(
    existing?.travelDuration != null ? String(existing.travelDuration) : ""
  );
  const [travelRatePerMile, setTravelRatePerMile] = useState<string>(
    existing?.travelRatePerMile != null ? String(existing.travelRatePerMile) : ""
  );
  const [minTravelFee, setMinTravelFee] = useState<string>(
    existing?.minTravelFee != null ? String(existing.minTravelFee) : ""
  );
  const [distanceFeeEnabled, setDistanceFeeEnabled] = useState<boolean>(
    existing?.distanceFeeEnabled === true
  );
  const [freeMiles, setFreeMiles] = useState<string>(
    existing?.freeMiles != null ? String(existing.freeMiles) : ""
  );
  const [blockOutOfRange, setBlockOutOfRange] = useState<boolean>(
    existing?.blockOutOfRange === true
  );
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const isEdit = !!existing;

  const existingCategories = useMemo(() => {
    const cats = new Set<string>();
    state.services.forEach((s) => { if (s.category) cats.add(s.category); });
    return Array.from(cats).sort();
  }, [state.services]);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to add a service photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      if (Platform.OS !== "web") {
        try {
          setUploadingPhoto(true);
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const mimeType = result.assets[0].mimeType ?? "image/jpeg";
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "services" });
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

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert("Required", "Please enter a service name.");
      return;
    }
    if (!isEdit) {
      const limitInfo = checkLimit("services");
      if (!limitInfo.allowed) {
        setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
        setUpgradeSheetVisible(true);
        return;
      }
    }
    const service: Service = {
      id: existing?.id ?? generateId(),
      name: name.trim(),
      duration,
      price: parseFloat(price) || 0,
      color,
      category: category.trim() || undefined,
      description: description.trim() || undefined,
      photoUri: photoUri || undefined,
      reminderHours: reminderHours.trim() !== "" ? (parseFloat(reminderHours) || null) : null,
      serviceType,
      travelFee: travelFee.trim() !== "" ? (parseFloat(travelFee) || null) : null,
      maxTravelDistance: maxTravelDistance.trim() !== "" ? (parseFloat(maxTravelDistance) || null) : null,
      travelDuration: travelDuration.trim() !== "" ? (parseInt(travelDuration) || null) : null,
      travelRatePerMile: travelRatePerMile.trim() !== "" ? (parseFloat(travelRatePerMile) || null) : null,
      minTravelFee: minTravelFee.trim() !== "" ? (parseFloat(minTravelFee) || null) : null,
      distanceFeeEnabled: distanceFeeEnabled,
      freeMiles: freeMiles.trim() !== "" ? (parseFloat(freeMiles) || null) : null,
      blockOutOfRange: blockOutOfRange,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (isEdit) {
      dispatch({ type: "UPDATE_SERVICE", payload: service });
      syncToDb({ type: "UPDATE_SERVICE", payload: service });
    } else {
      dispatch({ type: "ADD_SERVICE", payload: service });
      syncToDb({ type: "ADD_SERVICE", payload: service });
    }
    router.back();
  };

  const handleDelete = () => {
    if (!existing) return;
    const doIt = () => {
      dispatch({ type: "DELETE_SERVICE", payload: existing.id });
      syncToDb({ type: "DELETE_SERVICE", payload: existing.id });
      router.back();
    };
    if (Platform.OS === "web") {
      doIt();
    } else {
      Alert.alert("Delete Service", "This will permanently remove the service and all related data.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doIt },
      ]);
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} tabletMaxWidth={680}>
      <FuturisticBackground />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingHorizontal: hp, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="xmark" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {isEdit ? "Edit Service" : "New Service"}
        </Text>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 48, paddingTop: 8 }}
      >

        {/* ── Service Type ── */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>
            Service Type
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => setServiceType('in_store')}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: serviceType === 'in_store' ? colors.primary : colors.border,
                backgroundColor: serviceType === 'in_store' ? colors.primary + "18" : colors.surface,
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: serviceType === 'in_store' ? colors.primary : colors.muted }}>
                🏪 In-Store
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setServiceType('mobile')}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: serviceType === 'mobile' ? colors.primary : colors.border,
                backgroundColor: serviceType === 'mobile' ? colors.primary + "18" : colors.surface,
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: serviceType === 'mobile' ? colors.primary : colors.muted }}>
                🚗 Mobile / At-Home
              </Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
            {serviceType === 'mobile' ? "Client's address will be collected at booking." : "Client comes to your location."}
          </Text>
        </View>
        {/* ── Hero Image Picker ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>SERVICE PHOTO</Text>
          {uploadingPhoto ? (
            <View style={styles.imagePlaceholder}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.imageHint, { color: colors.muted, marginTop: 10 }]}>Uploading…</Text>
            </View>
          ) : photoUri ? (
            <View style={styles.imageContainer}>
              {/* Full-aspect preview — no cropping */}
              <TouchableOpacity activeOpacity={0.9} onPress={() => setLightboxVisible(true)}>
                <Image
                  source={{ uri: photoUri }}
                  style={styles.imagePreview}
                  resizeMode="contain"
                />
                <View style={styles.imageOverlay}>
                  <IconSymbol name="arrow.up.left.and.arrow.down.right" size={16} color="#fff" />
                  <Text style={styles.imageOverlayText}>Tap to preview</Text>
                </View>
              </TouchableOpacity>
              <View style={styles.imageActions}>
                <Pressable
                  onPress={pickPhoto}
                  style={({ pressed }) => [styles.imageActionBtn, { backgroundColor: colors.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                >
                  <IconSymbol name="photo.badge.plus" size={16} color={colors.primary} />
                  <Text style={[styles.imageActionText, { color: colors.primary }]}>Change</Text>
                </Pressable>
                <Pressable
                  onPress={() => setPhotoUri(undefined)}
                  style={({ pressed }) => [styles.imageActionBtn, { backgroundColor: colors.error + "15", opacity: pressed ? 0.7 : 1 }]}
                >
                  <IconSymbol name="trash.fill" size={16} color={colors.error} />
                  <Text style={[styles.imageActionText, { color: colors.error }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={pickPhoto}
              style={({ pressed }) => [styles.imagePlaceholder, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={[styles.imageIconCircle, { backgroundColor: colors.primary + "18" }]}>
                <IconSymbol name="photo.badge.plus" size={28} color={colors.primary} />
              </View>
              <Text style={[styles.imageHint, { color: colors.foreground }]}>Add Service Photo</Text>
              <Text style={[styles.imageSubHint, { color: colors.muted }]}>Shown to clients on the booking page</Text>
            </Pressable>
          )}
        </View>

        {/* ── Basic Info ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>BASIC INFO</Text>

          <Text style={[styles.fieldLabel, { color: colors.muted }]}>Service Name *</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={() => setShowEmojiPicker(true)}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 22 }}>
                {/* Show the leading emoji from the name, or a smiley placeholder */}
                {name.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u)?.[0] ?? "😊"}
              </Text>
            </Pressable>
            <TextInput
              style={[styles.input, { flex: 1, backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="e.g. Haircut, Consultation, Massage…"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />
          </View>
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4, marginLeft: 2 }}>Tap the emoji button to add an emoji to your service name</Text>

          <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Price ($)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            placeholder="0.00"
            placeholderTextColor={colors.muted}
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />

          <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Category (optional)</Text>
          {/* Category picker — standard + existing custom categories for this service type */}
          {(() => {
            const standardList = serviceType === 'mobile' ? MOBILE_SERVICE_CATEGORIES : SERVICE_CATEGORIES;
            // Collect custom categories already used by other services of the same type
            const customUsed = existingCategories.filter(
              (c) => !SERVICE_CATEGORIES.find((s) => s.label === c) && !MOBILE_SERVICE_CATEGORIES.find((s) => s.label === c)
            );
            const allCats = [...standardList, ...customUsed.map((l) => getCategoryDef(l))];
            const isOther = category === "Other" || category === "Other Mobile";
            const isCustom = !!(category && !SERVICE_CATEGORIES.find((c) => c.label === category) && !MOBILE_SERVICE_CATEGORIES.find((c) => c.label === category) && !customUsed.includes(category));
            return (
              <View style={{ marginBottom: 4 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                    {allCats.map((cat) => {
                      const isSelected = category === cat.label;
                      return (
                        <Pressable
                          key={cat.label}
                          onPress={() => setCategory(isSelected ? "" : cat.label)}
                          style={({ pressed }) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 20,
                            borderWidth: 1.5,
                            borderColor: isSelected ? cat.color : colors.border,
                            backgroundColor: isSelected ? cat.color + "22" : colors.surface,
                            opacity: pressed ? 0.7 : 1,
                            gap: 6,
                          })}
                        >
                          <Text style={{ fontSize: 14 }}>{cat.emoji}</Text>
                          <Text style={{ fontSize: 12, fontWeight: isSelected ? "700" : "500", color: isSelected ? cat.color : colors.muted }}>
                            {cat.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
                {/* Custom category text input — shown when Other is selected or a brand-new name is being typed */}
                {(isOther || isCustom) && (
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border, marginTop: 4 }]}
                    placeholder="Enter custom category name…"
                    placeholderTextColor={colors.muted}
                    value={isOther ? "" : (category ?? "")}
                    onChangeText={(text) => setCategory(text || (serviceType === 'mobile' ? "Other Mobile" : "Other"))}
                    returnKeyType="done"
                  />
                )}
              </View>
            );
          })()}
                    <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Brief description shown to clients on the booking page…"
            placeholderTextColor={colors.muted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            returnKeyType="done"
          />
        </View>

        {/* ── Duration ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardRowHeader}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>DURATION</Text>
            <Text style={[styles.durationValue, { color: colors.primary }]}>{formatDuration(duration)}</Text>
          </View>
          <TapDurationPicker value={duration} onChange={setDuration} />
        </View>

        {/* ── Color ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>CALENDAR COLOR</Text>
          <View style={styles.colorRow}>
            {SERVICE_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={({ pressed }) => [
                  styles.colorCircle,
                  {
                    backgroundColor: c,
                    borderWidth: color === c ? 3 : 1.5,
                    borderColor: color === c ? colors.foreground : "transparent",
                    opacity: pressed ? 0.7 : 1,
                    transform: [{ scale: color === c ? 1.15 : 1 }],
                  },
                ]}
              />
            ))}
          </View>
          {/* Live preview */}
          <View style={[styles.previewRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.previewDot, { backgroundColor: color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.previewName, { color: colors.foreground }]} numberOfLines={1}>
                {name || "Service Name"}
              </Text>
              <Text style={[styles.previewMeta, { color: colors.muted }]}>
                {formatDuration(duration)} · ${price || "0.00"}
              </Text>
            </View>
          </View>
        </View>

        {/* ── SMS Reminder (only shown when plan includes SMS) ── */}
        {hasSms && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>SMS REMINDER</Text>
            <Text style={[styles.fieldHint, { color: colors.muted }]}>
              Override the global reminder window for this service. Leave blank to use the default ({state.settings.twilioReminderHoursBeforeAppt ?? 24} hrs).
            </Text>
            <View style={styles.reminderRow}>
              <TextInput
                style={[styles.input, { flex: 1, backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder={`Default (${state.settings.twilioReminderHoursBeforeAppt ?? 24} hrs)`}
                placeholderTextColor={colors.muted}
                value={reminderHours}
                onChangeText={(v) => setReminderHours(v.replace(/[^0-9.]/g, ""))}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text style={[styles.reminderUnit, { color: colors.muted }]}>hrs</Text>
            </View>
          </View>
        )}


        {/* ── Travel Fee (mobile only) ── */}
        {serviceType === 'mobile' && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>
              Travel Fee (optional)
            </Text>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginRight: 4 }}>$</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, flex: 1 }]}
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={travelFee}
                onChangeText={setTravelFee}
                returnKeyType="done"
              />
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
              Automatically added to the booking total when a client address is entered.
            </Text>
            {/* Max Travel Distance */}
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginTop: 16, marginBottom: 8 }}>
              Max Travel Distance (optional)
            </Text>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground, flex: 1 }]}
                placeholder="e.g. 25"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={maxTravelDistance}
                onChangeText={setMaxTravelDistance}
                returnKeyType="done"
              />
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginLeft: 4 }}>mi</Text>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
              Clients outside this radius will see a distance warning during booking.
            </Text>
            {/* Block vs Warn toggle — only shown when maxTravelDistance is set */}
            {maxTravelDistance.trim() !== "" && (
              <TouchableOpacity
                onPress={() => setBlockOutOfRange((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingVertical: 6 }}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 44, height: 24, borderRadius: 12,
                  backgroundColor: blockOutOfRange ? colors.primary : colors.border,
                  justifyContent: 'center', paddingHorizontal: 2,
                }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                    transform: [{ translateX: blockOutOfRange ? 20 : 0 }],
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fs.sm, fontWeight: '600', color: colors.foreground }}>
                    {blockOutOfRange ? 'Block bookings outside radius' : 'Warn only (allow booking)'}
                  </Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>
                    {blockOutOfRange
                      ? 'Clients beyond the max distance cannot complete their booking.'
                      : 'Clients beyond the max distance see a warning but can still book.'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            {/* Travel Duration */}
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginTop: 16, marginBottom: 8 }}>
              Estimated Travel Time (optional)
            </Text>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground, flex: 1 }]}
                placeholder="e.g. 20"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                value={travelDuration}
                onChangeText={setTravelDuration}
                returnKeyType="done"
              />
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginLeft: 4 }}>min</Text>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
              One-way travel time added to the booking slot so your calendar stays accurate.
            </Text>
            {/* Rate per Mile */}
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginTop: 16, marginBottom: 8 }}>
              Rate per Mile (optional)
            </Text>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginRight: 4 }}>$</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, flex: 1 }]}
                placeholder="0.67"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={travelRatePerMile}
                onChangeText={setTravelRatePerMile}
                returnKeyType="done"
              />
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginLeft: 4 }}>/mi</Text>
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
              Dynamic fee = distance × rate. Leave blank to use the default IRS rate ($0.67/mi).
            </Text>
            {/* Minimum Travel Fee */}
            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.foreground, marginTop: 16, marginBottom: 8 }}>
              Minimum Travel Fee (optional)
            </Text>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginRight: 4 }}>$</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, flex: 1 }]}
                placeholder="e.g. 10.00"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={minTravelFee}
                onChangeText={setMinTravelFee}
                returnKeyType="done"
              />
            </View>
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
              Minimum fee charged even for short trips (e.g. $10 floor regardless of distance).
            </Text>

            {/* Distance-based fee toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 4 }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.foreground }}>Distance-Based Fee</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>
                  {distanceFeeEnabled
                    ? 'Dynamic fee = (miles − free miles) × rate. Fixed fee above is ignored.'
                    : 'Enable to charge per mile instead of a fixed travel fee.'}
                </Text>
              </View>
              <Switch
                value={distanceFeeEnabled}
                onValueChange={setDistanceFeeEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={distanceFeeEnabled ? '#fff' : colors.muted}
              />
            </View>

            {/* Free Miles (only shown when distance fee is on) */}
            {distanceFeeEnabled && (
              <>
                <Text style={{ fontSize: fs.xs, fontWeight: '600', color: colors.foreground, marginTop: 14, marginBottom: 8 }}>
                  Free Miles
                </Text>
                <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, flex: 1 }]}
                    placeholder="e.g. 5"
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    value={freeMiles}
                    onChangeText={setFreeMiles}
                    returnKeyType="done"
                  />
                  <Text style={{ fontSize: fs.sm, color: colors.muted, marginLeft: 4 }}>mi free</Text>
                </View>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6 }}>
                  First N miles are free. Fee only applies to distance beyond this threshold.
                </Text>
              </>
            )}
          </View>
        )}
        {/* ── Delete ── */}
        {isEdit && (
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [styles.deleteBtn, { borderColor: colors.error, opacity: pressed ? 0.7 : 1 }]}
          >
            <IconSymbol name="trash.fill" size={16} color={colors.error} />
            <Text style={[styles.deleteBtnText, { color: colors.error }]}>Delete Service</Text>
          </Pressable>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Lightbox ── */}
      <Modal visible={lightboxVisible} transparent animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <View style={styles.lightboxOverlay}>
          <Pressable style={styles.lightboxClose} onPress={() => setLightboxVisible(false)}>
            <View style={styles.lightboxCloseBtn}>
              <IconSymbol name="xmark" size={20} color="#fff" />
            </View>
          </Pressable>
          {photoUri && (
            <Image
              source={{ uri: photoUri }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* ── Emoji Picker Modal ── */}
      <Modal visible={showEmojiPicker} transparent animationType="fade" onRequestClose={() => setShowEmojiPicker(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}
          onPress={() => setShowEmojiPicker(false)}
        >
          <Pressable style={[{ width: "100%", maxWidth: 380, borderRadius: 20, borderWidth: 1, padding: 20, gap: 12 }, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 16, fontWeight: "700", textAlign: "center", color: colors.foreground, marginBottom: 4 }}>Choose an Emoji</Text>
            <Text style={{ fontSize: 11, textAlign: "center", color: colors.muted, marginBottom: 8 }}>The emoji will be added to the beginning of your service name</Text>
            <FlatList
              data={Array.from(new Set(SERVICE_EMOJI_OPTIONS))}
              numColumns={6}
              keyExtractor={(item, i) => `emoji-${i}-${item}`}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    // Replace leading emoji if present, otherwise prepend
                    const stripped = name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, "");
                    setName(item + " " + stripped);
                    setShowEmojiPicker(false);
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    aspectRatio: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    margin: 3,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: 26 }}>{item}</Text>
                </Pressable>
              )}
              contentContainerStyle={{ paddingBottom: 8 }}
              style={{ maxHeight: 320 }}
            />
            <Pressable
              onPress={() => setShowEmojiPicker(false)}
              style={[{ borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 4 }, { backgroundColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>Cancel</Text>
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
          resource="services"
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
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 14,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  cardRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  durationValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: 12,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "500",
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  categoryTile: {
    width: "30%",
    minWidth: 90,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    gap: 4,
  },
  categoryTileEmoji: {
    fontSize: 17,
    lineHeight: 28,
  },
  categoryTileLabel: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 14,
  },
  colorRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  colorCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  previewDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  previewName: {
    fontSize: 13,
    fontWeight: "600",
  },
  previewMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reminderUnit: {
    fontSize: 13,
    minWidth: 28,
  },
  lockedRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lockedTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  lockedSub: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16,
  },
  imagePlaceholder: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 28,
  },
  imageIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  imageHint: {
    fontSize: 13,
    fontWeight: "600",
  },
  imageSubHint: {
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  imageContainer: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  imagePreview: {
    width: "100%",
    height: 220,
    backgroundColor: "#000",
  },
  imageOverlay: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  imageOverlayText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "500",
  },
  imageActions: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  imageActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  imageActionText: {
    fontSize: 11,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxClose: {
    position: "absolute",
    top: 52,
    right: 20,
    zIndex: 10,
  },
  lightboxCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: {
    width: "100%",
    height: "80%",
  },
});
