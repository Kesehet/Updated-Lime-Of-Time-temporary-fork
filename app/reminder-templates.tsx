import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useStore, generateId } from "@/lib/store";
import {
  ReminderTemplate,
  DEFAULT_REMINDER_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  TemplateCategory,
} from "@/lib/types";

const CATEGORY_COLORS: Record<string, string> = {
  upcoming:   "#3B82F6",
  confirmed:  "#22C55E",
  pending:    "#F59E0B",
  cancelled:  "#EF4444",
  completed:  "#8B5CF6",
  no_show:    "#F97316",
  reschedule: "#06B6D4",
};

const VARIABLES = [
  "{clientName}", "{businessName}", "{service}", "{date}", "{time}",
  "{location}", "{phone}", "{bookingUrl}", "{reviewUrl}",
];

export default function ReminderTemplatesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { state, dispatch, syncToDb } = useStore();

  const savedTemplates: ReminderTemplate[] = useMemo(
    () => state.reminderTemplates ?? [],
    [state.reminderTemplates]
  );

  // Edit modal state
  const [editModal, setEditModal] = useState<{
    visible: boolean;
    template: ReminderTemplate | null;
    label: string;
    message: string;
  }>({ visible: false, template: null, label: "", message: "" });

  function openEdit(tpl: ReminderTemplate) {
    setEditModal({
      visible: true,
      template: tpl,
      label: tpl.label,
      message: tpl.customMessage ?? "",
    });
  }

  function closeEdit() {
    setEditModal({ visible: false, template: null, label: "", message: "" });
  }

  function saveEdit() {
    const trimLabel = editModal.label.trim();
    const trimMsg   = editModal.message.trim();
    if (!trimLabel) {
      Alert.alert("Required", "Please provide a template name.");
      return;
    }
    if (!editModal.template) return;
    const updated: ReminderTemplate = {
      ...editModal.template,
      label:         trimLabel,
      customMessage: trimMsg || undefined,
    };
    const action = { type: "UPDATE_REMINDER_TEMPLATE" as const, payload: updated };
    dispatch(action);
    syncToDb(action);
    closeEdit();
  }

  function handleDelete(tpl: ReminderTemplate) {
    const isDefault = DEFAULT_REMINDER_TEMPLATES.some((d) => d.id === tpl.id);
    if (isDefault) {
      Alert.alert("Cannot Delete", "Default timing templates cannot be deleted.");
      return;
    }
    Alert.alert(
      "Delete Template",
      `Delete "${tpl.label}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: () => {
            const action = { type: "DELETE_REMINDER_TEMPLATE" as const, payload: tpl.id as string };
            dispatch(action);
            syncToDb(action);
          },
        },
      ]
    );
  }

  function insertVariable(tag: string) {
    setEditModal((prev) => ({ ...prev, message: prev.message + tag }));
  }

  const grouped = useMemo(() => {
    const cats = Array.from(new Set(savedTemplates.map((t) => t.category ?? "upcoming")));
    return cats.map((cat) => ({
      cat: cat as TemplateCategory,
      templates: savedTemplates.filter((t) => (t.category ?? "upcoming") === cat),
    }));
  }, [savedTemplates]);

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Templates</Text>
        <Pressable
          onPress={() => router.push("/template-library" as any)}
          style={({ pressed }) => [styles.headerRight, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {savedTemplates.length === 0 ? (
          <View style={styles.emptyState}>
            <IconSymbol name="note.text" size={40} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Templates Yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              Browse the Template Library to add professional SMS templates, or they will appear here once added from the Send Reminder screen.
            </Text>
            <Pressable
              onPress={() => router.push("/template-library" as any)}
              style={({ pressed }) => [styles.browseBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconSymbol name="books.vertical.fill" size={16} color="#fff" />
              <Text style={styles.browseBtnText}>Browse Template Library</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {grouped.map(({ cat, templates }) => (
              <View key={cat} style={{ marginBottom: 20 }}>
                {/* Category header */}
                <View style={styles.categoryHeader}>
                  <View style={[styles.categoryDot, { backgroundColor: CATEGORY_COLORS[cat] ?? colors.primary }]} />
                  <Text style={[styles.categoryLabel, { color: colors.foreground }]}>
                    {TEMPLATE_CATEGORY_LABELS[cat] ?? cat}
                  </Text>
                  <View style={[styles.countBadge, { backgroundColor: colors.border }]}>
                    <Text style={[styles.countText, { color: colors.muted }]}>{templates.length}</Text>
                  </View>
                </View>

                {/* Template cards */}
                {templates.map((tpl) => {
                  const isDefault = DEFAULT_REMINDER_TEMPLATES.some((d) => d.id === tpl.id);
                  return (
                    <View
                      key={tpl.id}
                      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                      <View style={styles.cardTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardLabel, { color: colors.foreground }]}>{tpl.label}</Text>
                          {tpl.minutesBefore > 0 && (
                            <Text style={[styles.timingText, { color: colors.muted }]}>
                              {formatMinutes(tpl.minutesBefore)} before appointment
                            </Text>
                          )}
                        </View>
                        {isDefault && (
                          <View style={[styles.defaultBadge, { backgroundColor: colors.border }]}>
                            <Text style={[styles.defaultBadgeText, { color: colors.muted }]}>Default</Text>
                          </View>
                        )}
                      </View>

                      {tpl.customMessage ? (
                        <Text
                          style={[styles.previewText, { color: colors.muted }]}
                          numberOfLines={2}
                        >
                          {tpl.customMessage}
                        </Text>
                      ) : (
                        <Text style={[styles.previewText, { color: colors.muted, fontStyle: "italic" }]}>
                          Uses default reminder message
                        </Text>
                      )}

                      {/* Action buttons */}
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={() => openEdit(tpl)}
                          style={({ pressed }) => [
                            styles.editBtn,
                            { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <IconSymbol name="pencil" size={13} color={colors.primary} />
                          <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit</Text>
                        </Pressable>

                        {!isDefault && (
                          <Pressable
                            onPress={() => handleDelete(tpl)}
                            style={({ pressed }) => [
                              styles.deleteBtn,
                              { borderColor: colors.error + "60", opacity: pressed ? 0.7 : 1 },
                            ]}
                          >
                            <IconSymbol name="trash" size={13} color={colors.error} />
                            <Text style={[styles.deleteBtnText, { color: colors.error }]}>Delete</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}

            {/* Browse library link */}
            <Pressable
              onPress={() => router.push("/template-library" as any)}
              style={({ pressed }) => [
                styles.libraryLink,
                { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <IconSymbol name="books.vertical.fill" size={18} color="#8B5CF6" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.libraryLinkTitle, { color: colors.foreground }]}>Browse Template Library</Text>
                <Text style={[styles.libraryLinkSub, { color: colors.muted }]}>49 professional SMS templates by category</Text>
              </View>
              <IconSymbol name="chevron.right" size={16} color={colors.muted} />
            </Pressable>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Edit Modal */}
      <Modal
        visible={editModal.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeEdit}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          {/* Modal header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={closeEdit} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 16, color: colors.muted }}>Cancel</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Template</Text>
            <Pressable onPress={saveEdit} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
            {/* Template name */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Template Name</Text>
              <TextInput
                style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={editModal.label}
                onChangeText={(v) => setEditModal((p) => ({ ...p, label: v }))}
                placeholder="e.g. 30 Minutes Before"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
              />
            </View>

            {/* Message body */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Message</Text>
              <Text style={[styles.fieldHint, { color: colors.muted }]}>
                Tap a variable below to insert it at the end of your message.
              </Text>
              <TextInput
                style={[styles.textArea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={editModal.message}
                onChangeText={(v) => setEditModal((p) => ({ ...p, message: v }))}
                placeholder="Type your SMS message here..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
            </View>

            {/* Variable chips */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Insert Variable</Text>
              <View style={styles.variableRow}>
                {VARIABLES.map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => insertVariable(v)}
                    style={({ pressed }) => [
                      styles.variableChip,
                      { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40", opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={[styles.variableChipText, { color: colors.primary }]}>{v}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Live preview */}
            {editModal.message.trim().length > 0 && (
              <View style={[styles.previewBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.fieldLabel, { color: colors.muted, marginBottom: 6 }]}>Preview</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 19 }}>
                  {editModal.message}
                </Text>
                <Text style={{ fontSize: 12, color: colors.primary, marginTop: 6 }}>
                  …Sent via Lime Of Time
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function formatMinutes(min: number): string {
  if (min >= 1440) return `${min / 1440}d`;
  if (min >= 60) return `${min / 60}h`;
  return `${min}m`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 44, alignItems: "flex-start" },
  headerRight: { width: 44, alignItems: "flex-end" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 8 },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  browseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    marginTop: 8,
  },
  browseBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  categoryDot: { width: 10, height: 10, borderRadius: 5 },
  categoryLabel: { fontSize: 14, fontWeight: "600", flex: 1 },
  countBadge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  countText: { fontSize: 12, fontWeight: "500" },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardLabel: { fontSize: 15, fontWeight: "600" },
  timingText: { fontSize: 12, marginTop: 2 },
  defaultBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  defaultBadgeText: { fontSize: 11, fontWeight: "500" },
  previewText: { fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  editBtnText: { fontSize: 13, fontWeight: "500" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  deleteBtnText: { fontSize: 13, fontWeight: "500" },
  libraryLink: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 8,
  },
  libraryLinkTitle: { fontSize: 15, fontWeight: "600" },
  libraryLinkSub: { fontSize: 12, marginTop: 2 },
  // Modal
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: "600" },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fieldHint: { fontSize: 12, marginBottom: 8, lineHeight: 17 },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 160,
  },
  variableRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  variableChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  variableChipText: { fontSize: 12, fontWeight: "500" },
  previewBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
});
