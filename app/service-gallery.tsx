import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  Alert,
  Modal,
  TextInput,
  Platform,
  Image,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { ServicePhoto } from "@/lib/types";
import { FuturisticBackground } from "@/components/futuristic-background";
import { trpc } from "@/lib/trpc";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

type LabelKey = "before" | "after" | "other";

const LABEL_CONFIG: Record<LabelKey, { label: string; color: string; icon: string }> = {
  before: { label: "Before", color: "#F59E0B", icon: "circle.lefthalf.filled" },
  after: { label: "After", color: "#22C55E", icon: "checkmark.circle.fill" },
  other: { label: "Other", color: "#6366F1", icon: "photo.fill" },
};

export default function ServiceGalleryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serviceId: string }>();
  const { state, dispatch } = useStore();
  const colors = useColors();

  const service = state.services.find((s) => s.id === params.serviceId);
  const photos: ServicePhoto[] = (state.servicePhotos ?? []).filter(
    (p) => p.serviceId === params.serviceId
  );

  const [activeFilter, setActiveFilter] = useState<LabelKey | "all">("all");
  const [editingPhoto, setEditingPhoto] = useState<ServicePhoto | null>(null);
  const [editNote, setEditNote] = useState("");
  const [viewingPhoto, setViewingPhoto] = useState<ServicePhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  // Map localId → server DB id for delete sync
  const serverPhotoIds = useRef<Map<string, number>>(new Map());

  const filteredPhotos = activeFilter === "all" ? photos : photos.filter((p) => p.label === activeFilter);

  const handleAddPhoto = useCallback(async (label: LabelKey) => {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow access to your photo library.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const localUri = result.assets[0].uri;
    const localId = generateId();
    const photo: ServicePhoto = {
      id: localId,
      serviceId: params.serviceId,
      uri: localUri,
      label,
      note: "",
      takenAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_SERVICE_PHOTO", payload: photo });

    // Upload to S3 and register with server
    setUploading(true);
    try {
      const mimeType = localUri.endsWith(".png") ? "image/png" : "image/jpeg";
      let base64: string;
      if (Platform.OS === "web") {
        const resp = await fetch(localUri);
        const blob = await resp.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
      }
      const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "gallery" });
      // Update local photo URI to the S3 URL so client portal can load it
      dispatch({ type: "UPDATE_SERVICE_PHOTO", payload: { ...photo, uri: url } });
      // Register with server
      const token = await Auth.getSessionToken();
      const apiBase = getApiBaseUrl();
      const serverResp = await fetch(`${apiBase}/api/business/service-photos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          serviceLocalId: params.serviceId,
          uri: url,
          label,
          note: "",
          sortOrder: photos.length,
        }),
      });
      if (serverResp.ok) {
        const { photo: serverPhoto } = await serverResp.json();
        if (serverPhoto?.id) serverPhotoIds.current.set(localId, serverPhoto.id);
      }
    } catch (uploadErr) {
      console.error("[Gallery] Failed to upload photo to server:", uploadErr);
    } finally {
      setUploading(false);
    }
  }, [params.serviceId, dispatch, photos.length, uploadImageMut]);

  const handleDeletePhoto = useCallback((photoId: string) => {
    const doDelete = async () => {
      dispatch({ type: "DELETE_SERVICE_PHOTO", payload: photoId });
      // Also delete from server if we have the server ID
      const serverId = serverPhotoIds.current.get(photoId);
      if (serverId) {
        try {
          const token = await Auth.getSessionToken();
          const apiBase = getApiBaseUrl();
          await fetch(`${apiBase}/api/business/service-photos/${serverId}`, {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          serverPhotoIds.current.delete(photoId);
        } catch (delErr) {
          console.error("[Gallery] Failed to delete photo from server:", delErr);
        }
      }
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete Photo", "Remove this photo from the gallery?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  }, [dispatch]);

  const handleSetCover = useCallback(async (photoId: string) => {
    const serverId = serverPhotoIds.current.get(photoId);
    if (!serverId) {
      Alert.alert("Not synced", "This photo hasn't synced to the server yet. Please wait a moment and try again.");
      return;
    }
    try {
      const token = await Auth.getSessionToken();
      const apiBase = getApiBaseUrl();
      const resp = await fetch(`${apiBase}/api/business/service-photos/${serverId}/set-cover`, {
        method: "PATCH",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (resp.ok) {
        Alert.alert("Cover set", "This photo is now the cover for the service.");
      } else {
        const body = await resp.json().catch(() => ({}));
        Alert.alert("Error", body.error ?? "Failed to set cover photo.");
      }
    } catch (err) {
      console.error("[Gallery] Failed to set cover:", err);
      Alert.alert("Error", "Could not set cover photo. Please try again.");
    }
  }, []);

  const handleSaveNote = useCallback(() => {
    if (!editingPhoto) return;
    dispatch({ type: "UPDATE_SERVICE_PHOTO", payload: { ...editingPhoto, note: editNote } });
    setEditingPhoto(null);
  }, [editingPhoto, editNote, dispatch]);

  const beforeCount = photos.filter((p) => p.label === "before").length;
  const afterCount = photos.filter((p) => p.label === "after").length;
  const otherCount = photos.filter((p) => p.label === "other").length;

  if (!service) {
    return (
      <ScreenContainer>
      <FuturisticBackground />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>Service not found.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.primary }}>Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
            {service.name}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>Before & After Gallery</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {uploading && <ActivityIndicator size="small" color={colors.primary} />}
          {(["before", "after", "other"] as LabelKey[]).map((lbl) => (
            <Pressable
              key={lbl}
              onPress={() => handleAddPhoto(lbl)}
              style={({ pressed }) => ({
                backgroundColor: LABEL_CONFIG[lbl].color + "20",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: LABEL_CONFIG[lbl].color }}>
                + {LABEL_CONFIG[lbl].label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        {[
          { key: "all", label: "All", count: photos.length, color: colors.primary },
          { key: "before", label: "Before", count: beforeCount, color: LABEL_CONFIG.before.color },
          { key: "after", label: "After", count: afterCount, color: LABEL_CONFIG.after.color },
          { key: "other", label: "Other", count: otherCount, color: LABEL_CONFIG.other.color },
        ].map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveFilter(tab.key as LabelKey | "all")}
            style={({ pressed }) => ({
              flex: 1,
              backgroundColor: activeFilter === tab.key ? tab.color + "20" : colors.surface,
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: "center",
              borderWidth: activeFilter === tab.key ? 1.5 : 1,
              borderColor: activeFilter === tab.key ? tab.color : colors.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: "800", color: activeFilter === tab.key ? tab.color : colors.foreground }}>
              {tab.count}
            </Text>
            <Text style={{ fontSize: 10, color: activeFilter === tab.key ? tab.color : colors.muted, fontWeight: "600" }}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {filteredPhotos.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <IconSymbol name="photo.fill" size={48} color={colors.border} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 16, textAlign: "center" }}>
            No {activeFilter === "all" ? "" : activeFilter + " "}photos yet
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
            Tap + Before, + After, or + Other above to add photos to this service's gallery.{"\n"}Photos sync to the client portal automatically.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredPhotos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          columnWrapperStyle={{ gap: 10 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => {
            const cfg = LABEL_CONFIG[item.label];
            return (
              <Pressable
                onPress={() => setViewingPhoto(item)}
                style={({ pressed }) => ({
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Image
                  source={{ uri: item.uri }}
                  style={{ width: "100%", height: 160 }}
                  resizeMode="cover"
                />
                {/* Label badge */}
                <View style={{
                  position: "absolute", top: 8, left: 8,
                  backgroundColor: cfg.color + "EE",
                  borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
                }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFF" }}>{cfg.label}</Text>
                </View>
                {/* Delete button */}
                <Pressable
                  onPress={() => handleDeletePhoto(item.id)}
                  style={({ pressed }) => ({
                    position: "absolute", top: 8, right: 8,
                    backgroundColor: "rgba(0,0,0,0.55)",
                    borderRadius: 12, width: 24, height: 24,
                    alignItems: "center", justifyContent: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <IconSymbol name="xmark" size={12} color="#FFF" />
                </Pressable>
                {/* Set as Cover button */}
                <Pressable
                  onPress={() => handleSetCover(item.id)}
                  style={({ pressed }) => ({
                    position: "absolute", top: 38, right: 8,
                    backgroundColor: "rgba(0,0,0,0.55)",
                    borderRadius: 10,
                    paddingHorizontal: 7, paddingVertical: 3,
                    opacity: pressed ? 0.7 : 1,
                    flexDirection: "row", alignItems: "center", gap: 3,
                  })}
                >
                  <Text style={{ fontSize: 10, color: "#FFD700", fontWeight: "700" }}>⭐ Cover</Text>
                </Pressable>
                {/* Note area */}
                <View style={{ padding: 8 }}>
                  {item.note ? (
                    <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={2}>{item.note}</Text>
                  ) : (
                    <Pressable
                      onPress={() => { setEditingPhoto(item); setEditNote(item.note); }}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: 12, color: colors.primary }}>+ Add note</Text>
                    </Pressable>
                  )}
                  {item.note ? (
                    <Pressable
                      onPress={() => { setEditingPhoto(item); setEditNote(item.note); }}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginTop: 2 })}
                    >
                      <Text style={{ fontSize: 11, color: colors.primary }}>Edit note</Text>
                    </Pressable>
                  ) : null}
                  <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                    {new Date(item.takenAt).toLocaleDateString()}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Note Edit Modal */}
      <Modal
        visible={editingPhoto !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingPhoto(null)}
      >
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <Pressable onPress={() => setEditingPhoto(null)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 16, color: colors.primary }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>Edit Note</Text>
            <Pressable onPress={handleSaveNote} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>Save</Text>
            </Pressable>
          </View>
          {editingPhoto && (
            <Image
              source={{ uri: editingPhoto.uri }}
              style={{ width: "100%", height: 200, borderRadius: 12, marginBottom: 16 }}
              resizeMode="cover"
            />
          )}
          <TextInput
            value={editNote}
            onChangeText={setEditNote}
            placeholder="Add a note about this photo..."
            placeholderTextColor={colors.muted}
            multiline
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: 14,
              fontSize: 15,
              color: colors.foreground,
              minHeight: 100,
              borderWidth: 1,
              borderColor: colors.border,
            }}
           />
        </KeyboardAvoidingView>
      </Modal>
      {/* Full-screen Photo Viewer Modal */}
      <Modal
        visible={viewingPhoto !== null}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setViewingPhoto(null)}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <Pressable
            onPress={() => setViewingPhoto(null)}
            style={({ pressed }) => ({
              position: "absolute", top: 50, right: 20, zIndex: 10,
              backgroundColor: "rgba(255,255,255,0.15)",
              borderRadius: 20, width: 40, height: 40,
              alignItems: "center", justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <IconSymbol name="xmark" size={20} color="#FFF" />
          </Pressable>
          {viewingPhoto && (
            <ScrollView
              contentContainerStyle={{ flex: 1, alignItems: "center", justifyContent: "center" }}
              maximumZoomScale={3}
              minimumZoomScale={1}
            >
              <Image
                source={{ uri: viewingPhoto.uri }}
                style={{ width: "100%", height: 400 }}
                resizeMode="contain"
              />
              {viewingPhoto.note ? (
                <View style={{ position: "absolute", bottom: 60, left: 20, right: 20, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 12, padding: 12 }}>
                  <Text style={{ color: "#FFF", fontSize: 14 }}>{viewingPhoto.note}</Text>
                </View>
              ) : null}
            </ScrollView>
          )}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
