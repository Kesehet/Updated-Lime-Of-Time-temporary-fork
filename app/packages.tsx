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
  Image,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useState, useCallback, useMemo } from "react";
import { ServicePackage } from "@/lib/types";
import { FuturisticBackground } from "@/components/futuristic-background";
import { trpc } from "@/lib/trpc";


const EMPTY_FORM = {
  name: "",
  description: "",
  price: "",
  sessions: "",
  expiryDays: "",
  bufferDays: "",
  bufferMinutes: "",
  active: true,
  serviceIds: [] as string[],
  photoUri: null as string | null,
};

export default function PackagesScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, modalMaxWidth, maxContentWidth, fs, buttonHeight, iconButtonSize } = useResponsive();
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const packages = useMemo(
    () => [...(state.packages ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.packages]
  );

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setShowForm(true);
  }, []);

  const openEdit = useCallback((pkg: ServicePackage) => {
    setEditingId(pkg.id);
    setForm({
      name: pkg.name,
      description: pkg.description,
      price: String(pkg.price),
      sessions: pkg.sessions != null ? String(pkg.sessions) : "",
      expiryDays: pkg.expiryDays != null ? String(pkg.expiryDays) : "",
      bufferDays: pkg.bufferDays != null ? String(pkg.bufferDays) : "",
      bufferMinutes: pkg.bufferMinutes != null ? String(pkg.bufferMinutes) : "",
      active: pkg.active,
      serviceIds: pkg.serviceIds,
      photoUri: pkg.photoUri ?? null,
    });
    setErrors({});
    setShowForm(true);
  }, []);

  const validate = useCallback(() => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Package name is required";
    const priceNum = parseFloat(form.price);
    if (isNaN(priceNum) || priceNum < 0) errs.price = "Enter a valid price";
    if (form.serviceIds.length === 0) errs.serviceIds = "Select at least one service";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    const priceNum = parseFloat(form.price);
    const sessionsNum = form.sessions.trim() ? parseInt(form.sessions, 10) : undefined;
    const expiryNum = form.expiryDays.trim() ? parseInt(form.expiryDays, 10) : null;
    const bufferDaysNum = form.bufferDays.trim() ? parseInt(form.bufferDays, 10) : null;
    const bufferMinutesNum = form.bufferMinutes.trim() ? parseInt(form.bufferMinutes, 10) : null;

    if (editingId) {
      const existing = (state.packages ?? []).find((p) => p.id === editingId);
      if (!existing) return;
      const updated: ServicePackage = {
        ...existing,
        name: form.name.trim(),
        description: form.description.trim(),
        price: priceNum,
        sessions: sessionsNum,
        expiryDays: expiryNum,
        bufferDays: bufferDaysNum,
        bufferMinutes: bufferMinutesNum,
        active: form.active,
        serviceIds: form.serviceIds,
        photoUri: form.photoUri,
      };
      dispatch({ type: "UPDATE_PACKAGE", payload: updated });
      syncToDb({ type: "UPDATE_PACKAGE", payload: updated });
    } else {
      const newPkg: ServicePackage = {
        id: generateId(),
        name: form.name.trim(),
        description: form.description.trim(),
        price: priceNum,
        sessions: sessionsNum,
        expiryDays: expiryNum,
        bufferDays: bufferDaysNum,
        bufferMinutes: bufferMinutesNum,
        active: form.active,
        serviceIds: form.serviceIds,
        photoUri: form.photoUri,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_PACKAGE", payload: newPkg });
      syncToDb({ type: "ADD_PACKAGE", payload: newPkg });
    }
    setShowForm(false);
  }, [form, editingId, validate, dispatch, state.packages]);

  const handleDelete = useCallback((pkg: ServicePackage) => {
    Alert.alert(
      "Delete Package",
      `Delete "${pkg.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => { dispatch({ type: "DELETE_PACKAGE", payload: pkg.id }); syncToDb({ type: "DELETE_PACKAGE", payload: pkg.id }); },
        },
      ]
    );
  }, [dispatch]);

  const toggleService = useCallback((serviceId: string) => {
    setForm((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter((id) => id !== serviceId)
        : [...prev.serviceIds, serviceId],
    }));
  }, []);

  // Compute the sum of selected services' prices for comparison
  const selectedServicesTotal = useMemo(() => {
    return form.serviceIds.reduce((sum, id) => {
      const svc = state.services.find((s) => s.id === id);
      return sum + (svc?.price ?? 0);
    }, 0);
  }, [form.serviceIds, state.services]);

  const packagePrice = parseFloat(form.price) || 0;
  const savings = selectedServicesTotal - packagePrice;

  const handlePickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Allow photo access to add a package image."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      if (Platform.OS !== "web") {
        try {
          setUploadingPhoto(true);
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const mimeType = result.assets[0].mimeType ?? "image/jpeg";
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "packages" });
          setForm((f) => ({ ...f, photoUri: url }));
        } catch {
          setForm((f) => ({ ...f, photoUri: localUri }));
        } finally {
          setUploadingPhoto(false);
        }
      } else {
        setForm((f) => ({ ...f, photoUri: localUri }));
      }
    }
  }, [uploadImageMut]);

  // Derive package usage from appointments (same logic as bookings.tsx)
  const packageUsageMap = useMemo(() => {
    const map = new Map<string, { usedSessions: number; totalSessions: number }>();
    for (const appt of state.appointments) {
      if (!appt.packageGroupId || !appt.sessionTotal) continue;
      // The packageGroupId is "<packageId>-<clientId>-<timestamp>" — extract the base packageId
      // by matching against known package IDs as a prefix
      const matchingPkg = (state.packages ?? []).find(
        (p) => appt.packageGroupId!.startsWith(p.id)
      );
      if (!matchingPkg) continue;
      const existing = map.get(matchingPkg.id) ?? { usedSessions: 0, totalSessions: appt.sessionTotal };
      if (appt.status !== 'cancelled') {
        existing.usedSessions += 1;
      }
      existing.totalSessions = appt.sessionTotal;
      map.set(matchingPkg.id, existing);
    }
    return map;
  }, [state.appointments, state.packages]);

  const renderPackage = useCallback(({ item }: { item: ServicePackage }) => {
    const includedServices = item.serviceIds
      .map((id) => state.services.find((s) => s.id === id)?.name)
      .filter(Boolean);
    const retailTotal = item.serviceIds.reduce((sum, id) => {
      const svc = state.services.find((s) => s.id === id);
      return sum + (svc?.price ?? 0);
    }, 0);
    const savingsAmt = retailTotal - item.price;
    const usage = packageUsageMap.get(item.id);
    const isFullyUsed = usage && usage.usedSessions >= usage.totalSessions;
    const isPartiallyUsed = usage && usage.usedSessions > 0 && !isFullyUsed;

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: item.active ? colors.border : colors.border + "60",
            opacity: item.active ? 1 : 0.65,
          },
        ]}
      >
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={{ width: "100%", height: 140, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />
        ) : null}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>{item.name}</Text>
              {!item.active && (
                <View style={[styles.badge, { backgroundColor: colors.muted + "20" }]}>
                  <Text style={{ fontSize: 10, color: colors.muted, fontWeight: "600" }}>INACTIVE</Text>
                </View>
              )}
              {isFullyUsed && (
                <View style={[styles.badge, { backgroundColor: colors.error + "20" }]}>
                  <Text style={{ fontSize: 10, color: colors.error, fontWeight: "700" }}>USED</Text>
                </View>
              )}
              {isPartiallyUsed && (
                <View style={[styles.badge, { backgroundColor: "#F59E0B20" }]}>
                  <Text style={{ fontSize: 10, color: "#F59E0B", fontWeight: "700" }}>{usage!.usedSessions}/{usage!.totalSessions} USED</Text>
                </View>
              )}
            </View>
            {item.description ? (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>
              ${item.price.toFixed(2)}
            </Text>
            {savingsAmt > 0 && (
              <Text style={{ fontSize: fs.xs, color: "#22C55E", fontWeight: "600" }}>
                Save ${savingsAmt.toFixed(2)}
              </Text>
            )}
          </View>
        </View>

        {/* Services list */}
        <View style={{ marginTop: 8, gap: 4 }}>
          {includedServices.map((name, idx) => (
            <View key={idx} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
              <Text style={{ fontSize: fs.xs, color: colors.foreground }}>{name}</Text>
            </View>
          ))}
        </View>

        {/* Meta row */}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          {item.sessions != null && (
            <View style={[styles.metaChip, { backgroundColor: colors.primary + "15" }]}>
              <IconSymbol name="calendar" size={12} color={colors.primary} />
              <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>
                {item.sessions} session{item.sessions !== 1 ? "s" : ""}
              </Text>
            </View>
          )}
          {item.expiryDays != null && (
            <View style={[styles.metaChip, { backgroundColor: "#F59E0B15" }]}>
              <IconSymbol name="clock.fill" size={12} color="#F59E0B" />
              <Text style={{ fontSize: fs.xs, color: "#F59E0B", fontWeight: "600" }}>
                Expires in {item.expiryDays} days
              </Text>
            </View>
          )}
          <View style={[styles.metaChip, { backgroundColor: colors.border }]}>
            <Text style={{ fontSize: fs.xs, color: colors.muted }}>
              {item.serviceIds.length} service{item.serviceIds.length !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => openEdit(item)}
            style={({ pressed }) => [styles.actionBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <IconSymbol name="pencil" size={14} color={colors.primary} />
            <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>Edit</Text>
          </Pressable>
          <Pressable
            onPress={() => handleDelete(item)}
            style={({ pressed }) => [styles.actionBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <IconSymbol name="trash.fill" size={14} color={colors.error} />
            <Text style={{ fontSize: fs.xs, color: colors.error, fontWeight: "600" }}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [colors, state.services, openEdit, handleDelete, packageUsageMap]);

  return (
    <ScreenContainer>
      <FuturisticBackground />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Packages & Bundles</Text>
        <Pressable
          onPress={openCreate}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <IconSymbol name="plus" size={18} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        data={packages}
        keyExtractor={(item) => item.id}
        renderItem={renderPackage}
        contentContainerStyle={{ padding: hp, paddingBottom: 100, alignSelf: 'center', width: '100%', maxWidth: maxContentWidth }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconSymbol name="gift.fill" size={48} color={colors.muted} />
            <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>
              No Packages Yet
            </Text>
            <Text style={{ fontSize: fs.sm, color: colors.muted, textAlign: "center", marginTop: 6 }}>
              Create service bundles to offer clients a better deal and increase booking value.
            </Text>
            <Pressable
              onPress={openCreate}
              style={({ pressed }) => [
                styles.emptyBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs.sm }}>Create Package</Text>
            </Pressable>
          </View>
        }
      />

      {/* Create / Edit Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowForm(false)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
              <Text style={{ fontSize: fs.md, color: colors.muted }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
              {editingId ? "Edit Package" : "New Package"}
            </Text>
            <Pressable onPress={handleSave} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>Save</Text>
            </Pressable>
          </View>

                <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
<ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
            {/* Photo */}
            <Text style={[styles.label, { color: colors.muted }]}>Package Photo (optional)</Text>
            <Pressable
              onPress={handlePickPhoto}
              style={({ pressed }) => ({
                width: "100%", height: 160, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed",
                borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
                marginBottom: 16, overflow: "hidden", opacity: pressed ? 0.8 : 1,
              })}
            >
              {uploadingPhoto ? (
                <View style={{ alignItems: "center", gap: 8 }}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={{ fontSize: fs.xs, color: colors.muted, fontWeight: "600" }}>Uploading photo…</Text>
                </View>
              ) : form.photoUri ? (
                <>
                  <Image source={{ uri: form.photoUri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  <View style={{ position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: "#fff", fontSize: fs.xs, fontWeight: "600" }}>Change Photo</Text>
                  </View>
                </>
              ) : (
                <View style={{ alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 28 }}>📷</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, fontWeight: "600" }}>Tap to add a photo</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>16:9 ratio recommended</Text>
                </View>
              )}
            </Pressable>
            {/* Name */}
            <Text style={[styles.label, { color: colors.muted }]}>Package Name *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: errors.name ? colors.error : colors.border, color: colors.foreground }]}
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="e.g. Summer Glow Bundle"
              placeholderTextColor={colors.muted}
              returnKeyType="next"
            />
            {errors.name ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 8 }}>{errors.name}</Text> : null}

            {/* Description */}
            <Text style={[styles.label, { color: colors.muted }]}>Description</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, minHeight: 72, textAlignVertical: "top" }]}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Describe what's included..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
            />

            {/* Price */}
            <Text style={[styles.label, { color: colors.muted }]}>Package Price ($) *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: errors.price ? colors.error : colors.border, color: colors.foreground }]}
              value={form.price}
              onChangeText={(v) => setForm((f) => ({ ...f, price: v }))}
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />
            {errors.price ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 8 }}>{errors.price}</Text> : null}
            {form.serviceIds.length > 0 && selectedServicesTotal > 0 && (
              <View style={[styles.savingsRow, { backgroundColor: savings > 0 ? "#22C55E15" : colors.surface, borderColor: savings > 0 ? "#22C55E40" : colors.border }]}>
                <Text style={{ fontSize: fs.xs, color: savings > 0 ? "#22C55E" : colors.muted }}>
                  Retail total: ${selectedServicesTotal.toFixed(2)}
                  {savings > 0 ? `  ·  Client saves $${savings.toFixed(2)}` : savings < 0 ? "  ·  ⚠️ Package price exceeds retail" : "  ·  No discount"}
                </Text>
              </View>
            )}

            {/* Sessions */}
            <Text style={[styles.label, { color: colors.muted }]}>Number of Sessions (optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.sessions}
              onChangeText={(v) => setForm((f) => ({ ...f, sessions: v }))}
              placeholder="e.g. 5"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              returnKeyType="next"
            />

            {/* Expiry */}
            <Text style={[styles.label, { color: colors.muted }]}>Expires After (days, optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.expiryDays}
              onChangeText={(v) => setForm((f) => ({ ...f, expiryDays: v }))}
              placeholder="e.g. 90"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              returnKeyType="done"
            />

            {/* Buffer Days between sessions */}
            <Text style={[styles.label, { color: colors.muted }]}>Min. Days Between Sessions (optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.bufferDays}
              onChangeText={(v) => setForm((f) => ({ ...f, bufferDays: v }))}
              placeholder="e.g. 14"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              returnKeyType="next"
            />
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8, marginTop: 2 }}>
              Minimum days a client must wait between each session of this package.
            </Text>

            {/* Buffer Minutes after each session */}
            <Text style={[styles.label, { color: colors.muted }]}>Buffer Time After Each Session (minutes, optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.bufferMinutes}
              onChangeText={(v) => setForm((f) => ({ ...f, bufferMinutes: v }))}
              placeholder="e.g. 30"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              returnKeyType="done"
            />
            <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 8, marginTop: 2 }}>
              Extra padding time added after each session appointment.
            </Text>

            {/* Active toggle */}
            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
              <View>
                <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>Active</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Clients can see and book this package</Text>
              </View>
              <Switch
                value={form.active}
                onValueChange={(v) => setForm((f) => ({ ...f, active: v }))}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            {/* Services */}
            <Text style={[styles.label, { color: colors.muted, marginTop: 8 }]}>Included Services *</Text>
            {errors.serviceIds ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 8 }}>{errors.serviceIds}</Text> : null}
            {state.services.length === 0 ? (
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 12 }}>No services yet. Add services first.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {state.services.map((svc) => {
                  const selected = form.serviceIds.includes(svc.id);
                  return (
                    <Pressable
                      key={svc.id}
                      onPress={() => toggleService(svc.id)}
                      style={({ pressed }) => [
                        styles.serviceRow,
                        {
                          backgroundColor: selected ? colors.primary + "15" : colors.surface,
                          borderColor: selected ? colors.primary : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.checkbox, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" }]}>
                        {selected && <IconSymbol name="checkmark" size={12} color="#fff" />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{svc.name}</Text>
                        <Text style={{ fontSize: fs.xs, color: colors.muted }}>{svc.duration} min · ${svc.price.toFixed(2)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
      </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 32 },
  emptyBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  label: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    marginBottom: 4,
  },
  savingsRow: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
