import React, { useState, useCallback, useMemo } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, generateId } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { NoteTemplate } from "@/lib/types";
import { FuturisticBackground } from "@/components/futuristic-background";


const STARTER_TEMPLATES = [
  { title: "Prefers no heat styling", body: "Client prefers no heat tools. Use air-dry or diffuser only." },
  { title: "Sensitive scalp", body: "Client has a sensitive scalp. Use gentle products and avoid harsh chemicals." },
  { title: "First-time client", body: "First visit — take extra time for consultation before starting." },
  { title: "Allergy: latex", body: "Client is allergic to latex. Use non-latex gloves at all times." },
  { title: "Preferred products", body: "Client prefers sulfate-free shampoo and silicone-free conditioner." },
  { title: "Running late policy", body: "Client tends to arrive late. Confirm 30 min before appointment." },
];

export default function NoteTemplatesScreen() {
  const { state, dispatch } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { hp, fs, buttonHeight, iconButtonSize } = useResponsive();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [titleError, setTitleError] = useState("");
  const [bodyError, setBodyError] = useState("");

  const templates = useMemo(
    () => [...(state.noteTemplates ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.noteTemplates]
  );

  const openCreate = useCallback(() => {
    setEditingId(null);
    setTitle("");
    setBody("");
    setTitleError("");
    setBodyError("");
    setShowForm(true);
  }, []);

  const openEdit = useCallback((t: NoteTemplate) => {
    setEditingId(t.id);
    setTitle(t.title);
    setBody(t.body);
    setTitleError("");
    setBodyError("");
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    let valid = true;
    if (!title.trim()) { setTitleError("Title is required"); valid = false; }
    else setTitleError("");
    if (!body.trim()) { setBodyError("Note body is required"); valid = false; }
    else setBodyError("");
    if (!valid) return;

    if (editingId) {
      const existing = (state.noteTemplates ?? []).find((t) => t.id === editingId);
      if (!existing) return;
      dispatch({ type: "UPDATE_NOTE_TEMPLATE", payload: { ...existing, title: title.trim(), body: body.trim() } });
    } else {
      dispatch({
        type: "ADD_NOTE_TEMPLATE",
        payload: { id: generateId(), title: title.trim(), body: body.trim(), createdAt: new Date().toISOString() },
      });
    }
    setShowForm(false);
  }, [title, body, editingId, dispatch, state.noteTemplates]);

  const handleDelete = useCallback((t: NoteTemplate) => {
    Alert.alert("Delete Template", `Delete "${t.title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => dispatch({ type: "DELETE_NOTE_TEMPLATE", payload: t.id }) },
    ]);
  }, [dispatch]);

  const addStarterTemplate = useCallback((starter: { title: string; body: string }) => {
    dispatch({
      type: "ADD_NOTE_TEMPLATE",
      payload: { id: generateId(), title: starter.title, body: starter.body, createdAt: new Date().toISOString() },
    });
  }, [dispatch]);

  const renderTemplate = useCallback(({ item }: { item: NoteTemplate }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>{item.title}</Text>
          <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, lineHeight: 18 }} numberOfLines={3}>
            {item.body}
          </Text>
        </View>
      </View>
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
  ), [colors, openEdit, handleDelete]);

  // Starter templates not yet added
  const unusedStarters = useMemo(() => {
    const existingTitles = new Set((state.noteTemplates ?? []).map((t) => t.title));
    return STARTER_TEMPLATES.filter((s) => !existingTitles.has(s.title));
  }, [state.noteTemplates]);

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Note Templates</Text>
        <Pressable
          onPress={openCreate}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <IconSymbol name="plus" size={18} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        renderItem={renderTemplate}
        contentContainerStyle={{ padding: hp, paddingBottom: 100 }}
        ListHeaderComponent={
          unusedStarters.length > 0 ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Quick Add Starters
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {unusedStarters.map((s) => (
                  <Pressable
                    key={s.title}
                    onPress={() => addStarterTemplate(s)}
                    style={({ pressed }) => [
                      styles.starterChip,
                      { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40", opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <IconSymbol name="plus" size={14} color={colors.primary} />
                    <Text style={{ fontSize: fs.xs, color: colors.primary, fontWeight: "600" }}>{s.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconSymbol name="note.text" size={48} color={colors.muted} />
            <Text style={{ fontSize: fs.md, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>
              No Note Templates
            </Text>
            <Text style={{ fontSize: fs.sm, color: colors.muted, textAlign: "center", marginTop: 6 }}>
              Save reusable notes for appointments — like client preferences, allergies, or reminders.
            </Text>
            <Pressable
              onPress={openCreate}
              style={({ pressed }) => [
                styles.emptyBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs.sm }}>Create Template</Text>
            </Pressable>
          </View>
        }
      />

      {/* Create / Edit Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setShowForm(false)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                <Text style={{ fontSize: fs.md, color: colors.muted }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground }}>
                {editingId ? "Edit Template" : "New Template"}
              </Text>
              <Pressable onPress={handleSave} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>Save</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
              <Text style={[styles.label, { color: colors.muted }]}>Template Title *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: titleError ? colors.error : colors.border, color: colors.foreground }]}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Sensitive scalp"
                placeholderTextColor={colors.muted}
                returnKeyType="next"
              />
              {titleError ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 8 }}>{titleError}</Text> : null}

              <Text style={[styles.label, { color: colors.muted }]}>Note Body *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: bodyError ? colors.error : colors.border, color: colors.foreground, minHeight: 120, textAlignVertical: "top" }]}
                value={body}
                onChangeText={setBody}
                placeholder="Write the full note that will be inserted into the appointment..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={5}
              />
              {bodyError ? <Text style={{ color: colors.error, fontSize: fs.xs, marginBottom: 8 }}>{bodyError}</Text> : null}

              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 8, lineHeight: 18 }}>
                This template will appear as a quick-insert option when creating or editing appointments.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  headerTitle: { flex: 1, fontSize: fs.md, fontWeight: "700" },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
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
  starterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
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
  label: { fontSize: fs.xs, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fs.sm,
    marginBottom: 4,
  },
});
