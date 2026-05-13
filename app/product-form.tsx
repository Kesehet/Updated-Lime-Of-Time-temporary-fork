import React, { useState, useEffect } from "react";
import {
  ScrollView, Text, View, TextInput, Pressable, StyleSheet,
  Alert, Switch, Platform, Image,
  Modal, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { Product } from "@/lib/types";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { FuturisticBackground } from "@/components/futuristic-background";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { UpgradePlanSheet } from "@/components/upgrade-plan-sheet";
import { trpc } from "@/lib/trpc";

export default function ProductFormScreen() {
  const { state, dispatch, syncToDb } = useStore();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hp, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { checkLimit } = usePlanLimitCheck();
  const [upgradeSheetVisible, setUpgradeSheetVisible] = useState(false);
  const [upgradeSheetInfo, setUpgradeSheetInfo] = useState<{ planKey: string; planName: string; limit: number } | null>(null);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const params = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!params.id;
  const uploadImageMut = trpc.files.uploadImage.useMutation();

  const existing = isEditing ? state.products.find((p) => p.id === params.id) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [price, setPrice] = useState(existing ? String(existing.price) : "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [brand, setBrand] = useState(existing?.brand ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [available, setAvailable] = useState(existing?.available ?? true);
  const [photoUri, setPhotoUri] = useState<string | undefined>(existing?.photoUri);

  const existingBrands = React.useMemo(() => {
    const brands = new Set<string>();
    state.products.forEach((p) => { if (p.brand?.trim()) brands.add(p.brand.trim()); });
    return Array.from(brands).sort();
  }, [state.products]);

  const existingCategories = React.useMemo(() => {
    const cats = new Set<string>();
    state.products.forEach((p) => { if (p.category?.trim()) cats.add(p.category.trim()); });
    return Array.from(cats).sort();
  }, [state.products]);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setPrice(String(existing.price));
      setDescription(existing.description);
      setBrand(existing.brand ?? "");
      setCategory(existing.category ?? "");
      setAvailable(existing.available);
      setPhotoUri(existing.photoUri);
    }
  }, [existing?.id]);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to add a product photo.");
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
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "products" });
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
    if (!isEditing) {
      const limitInfo = checkLimit("products");
      if (!limitInfo.allowed) {
        setUpgradeSheetInfo({ planKey: limitInfo.planKey, planName: limitInfo.planName, limit: limitInfo.currentLimit });
        setUpgradeSheetVisible(true);
        return;
      }
    }
    if (!name.trim()) {
      Alert.alert("Required", "Please enter a product name.");
      return;
    }
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      Alert.alert("Required", "Please enter a valid price.");
      return;
    }
    if (isEditing && existing) {
      const updated: Product = {
        ...existing,
        name: name.trim(),
        price: parsedPrice,
        description: description.trim(),
        brand: brand.trim() || undefined,
        category: category.trim() || undefined,
        available,
        photoUri: photoUri || undefined,
      };
      dispatch({ type: "UPDATE_PRODUCT", payload: updated });
      syncToDb({ type: "UPDATE_PRODUCT", payload: updated });
    } else {
      const newProduct: Product = {
        id: generateId(),
        name: name.trim(),
        price: parsedPrice,
        description: description.trim(),
        brand: brand.trim() || undefined,
        category: category.trim() || undefined,
        available,
        photoUri: photoUri || undefined,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_PRODUCT", payload: newProduct });
      syncToDb({ type: "ADD_PRODUCT", payload: newProduct });
    }
    router.back();
  };

  const handleDelete = () => {
    if (!existing) return;
    Alert.alert("Delete Product", `Are you sure you want to delete "${existing.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          dispatch({ type: "DELETE_PRODUCT", payload: existing.id });
          syncToDb({ type: "DELETE_PRODUCT", payload: existing.id });
          router.back();
        },
      },
    ]);
  };

  return (
    <ScreenContainer edges={["left", "right"]} tabletMaxWidth={680}>
      <FuturisticBackground />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>

        {/* ── Header ── */}
        <View style={[styles.header, { paddingTop: insets.top + 12, paddingHorizontal: hp, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}>
            <IconSymbol name="xmark" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {isEditing ? "Edit Product" : "New Product"}
          </Text>
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: hp, paddingVertical: 8, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Hero Image Picker ── */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>PRODUCT PHOTO</Text>
            {uploadingPhoto ? (
              <View style={[styles.imagePlaceholder, { borderColor: colors.border }]}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={[styles.imageHint, { color: colors.muted, marginTop: 10 }]}>Uploading…</Text>
              </View>
            ) : photoUri ? (
              <View style={styles.imageContainer}>
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
                <Text style={[styles.imageHint, { color: colors.foreground }]}>Add Product Photo</Text>
                <Text style={[styles.imageSubHint, { color: colors.muted }]}>Shown to clients on the booking page</Text>
              </Pressable>
            )}
          </View>

          {/* ── Basic Info ── */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>BASIC INFO</Text>

            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Product Name *</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Hair Serum, Styling Gel…"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              returnKeyType="next"
            />

            <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Price ($) *</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              returnKeyType="done"
            />

            <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Description (optional)</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Optional product description…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.textArea, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            />
          </View>

          {/* ── Brand & Category ── */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>CLASSIFICATION</Text>

            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Brand (optional)</Text>
            <TextInput
              value={brand}
              onChangeText={setBrand}
              placeholder="e.g. Olaplex, Redken, Paul Mitchell…"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              returnKeyType="next"
            />
            {existingBrands.length > 0 && (
              <View style={styles.chipRow}>
                {existingBrands.map((b) => (
                  <Pressable
                    key={b}
                    onPress={() => setBrand(b)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: brand === b ? colors.primary + "18" : colors.background,
                        borderColor: brand === b ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: brand === b ? colors.primary : colors.muted }]}>{b}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Category (optional)</Text>
            <TextInput
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Hair Care, Styling, Treatment…"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              returnKeyType="done"
            />
            {existingCategories.length > 0 && !category && (
              <View style={styles.chipRow}>
                {existingCategories.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={({ pressed }) => [styles.chip, { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.chipText, { color: colors.muted }]}>{cat}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* ── Availability ── */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>AVAILABILITY</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, { color: colors.foreground }]}>Available for Sale</Text>
                <Text style={[styles.toggleSub, { color: colors.muted }]}>Clients can add this product when booking</Text>
              </View>
              <Switch
                value={available}
                onValueChange={setAvailable}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* ── Delete ── */}
          {isEditing && (
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [styles.deleteBtn, { borderColor: colors.error, opacity: pressed ? 0.7 : 1 }]}
            >
              <IconSymbol name="trash.fill" size={16} color={colors.error} />
              <Text style={[styles.deleteBtnText, { color: colors.error }]}>Delete Product</Text>
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

      {upgradeSheetInfo && (
        <UpgradePlanSheet
          visible={upgradeSheetVisible}
          onClose={() => setUpgradeSheetVisible(false)}
          currentPlanKey={upgradeSheetInfo.planKey}
          currentPlanName={upgradeSheetInfo.planName}
          resource="products"
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
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  toggleSub: {
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
