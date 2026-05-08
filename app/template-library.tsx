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
import { useRouter, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useStore, generateId, formatDateDisplay } from "@/lib/store";
import {
  TEMPLATE_LIBRARY,
  TEMPLATE_CATEGORY_LABELS,
  TemplateCategory,
  ReminderTemplate,
  appendLimeFooter,
} from "@/lib/types";

const CATEGORY_ORDER: TemplateCategory[] = [
  "upcoming",
  "confirmed",
  "pending",
  "cancelled",
  "completed",
  "no_show",
  "reschedule",
];

// Sample values used for live preview
const SAMPLE_VARS: Record<string, string> = {
  clientName:    "Jane Smith",
  service:       "Lifting Facial Massage (60 min)",
  date:          formatDateDisplay("2026-05-12") ?? "Tuesday, May 12",
  time:          "6:00 PM",
  endTime:       "7:00 PM",
  location:      "Wellness Suite — 134 Locust Ct, Pittsburgh, PA",
  staffName:     "Alex Johnson",
  price:         "$55.00",
  paymentMethod: "Cash",
  businessName:  "Lime Of Time",
  businessPhone: "(412) 555-0100",
  bookingUrl:    "https://lime-of-time.com/book/lime-of-time",
  reviewUrl:     "https://lime-of-time.com/review/lime-of-time",
};

function applyPreview(template: string): string {
  let result = template;
  for (const [key, val] of Object.entries(SAMPLE_VARS)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), val);
  }
  return result;
}

export default function TemplateLibraryScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ onSelectId?: string; filterCategory?: string }>();
  const { state, dispatch } = useStore();

  // Search query state
  const [searchQuery, setSearchQuery] = useState("");

  // Which categories are expanded — collapsed by default
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(CATEGORY_ORDER.map((c) => [c, false]))
  );

  // Which template cards have preview toggled on — all previewing by default
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set(TEMPLATE_LIBRARY.map((t) => t.id)));

  // Duplicate & Edit modal state
  const [editModal, setEditModal] = useState<{
    visible: boolean;
    sourceId: string;
    label: string;
    message: string;
  }>({ visible: false, sourceId: "", label: "", message: "" });

  const savedIds = useMemo(
    () => new Set((state.reminderTemplates ?? []).map((t) => t.id)),
    [state.reminderTemplates]
  );

  // If opened from Send Reminder, filter to relevant categories
  const filterCategory = params.filterCategory as TemplateCategory | undefined;
  const visibleCategories = filterCategory
    ? CATEGORY_ORDER.filter((c) => c === filterCategory || !filterCategory)
    : CATEGORY_ORDER;

  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visibleCategories
      .map((cat) => ({
        cat,
        templates: TEMPLATE_LIBRARY.filter((t) => {
          if (t.category !== cat) return false;
          if (!q) return true;
          return (
            t.label.toLowerCase().includes(q) ||
            (t.customMessage ?? "").toLowerCase().includes(q)
          );
        }),
      }))
      .filter(({ templates }) => templates.length > 0);
  }, [visibleCategories, searchQuery]);

  function toggleCategory(cat: string) {
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  function togglePreview(id: string) {
    setPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleAdd(template: ReminderTemplate) {
    const alreadySaved = savedIds.has(template.id);
    if (alreadySaved) {
      if (params.onSelectId !== undefined) {
        router.back();
        router.setParams({ selectedLibraryId: template.id });
      }
      return;
    }

    const toSave: ReminderTemplate = {
      ...template,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_REMINDER_TEMPLATE", payload: toSave });

    if (params.onSelectId !== undefined) {
      router.back();
      router.setParams({ selectedLibraryId: template.id });
    } else {
      Alert.alert("Template Added", `"${template.label}" has been added to your templates.`);
    }
  }

  function openDuplicateEdit(template: ReminderTemplate) {
    setEditModal({
      visible: true,
      sourceId: template.id,
      label: `${template.label} (Custom)`,
      message: template.customMessage ?? "",
    });
  }

  function saveDuplicate() {
    const trimLabel = editModal.label.trim();
    const trimMsg   = editModal.message.trim();
    if (!trimLabel || !trimMsg) {
      Alert.alert("Required", "Please provide both a name and a message.");
      return;
    }
    // Find source template to copy category
    const source = TEMPLATE_LIBRARY.find((t) => t.id === editModal.sourceId);
    const newTemplate: ReminderTemplate = {
      id:            generateId(),
      label:         trimLabel,
      customMessage: appendLimeFooter(trimMsg),
      minutesBefore: source?.minutesBefore ?? 0,
      category:      (source?.category ?? "upcoming") as TemplateCategory,
      isLibrary:     false,
      createdAt:     new Date().toISOString(),
    };
    dispatch({ type: "ADD_REMINDER_TEMPLATE", payload: newTemplate });
    setEditModal({ visible: false, sourceId: "", label: "", message: "" });
    Alert.alert("Saved", `"${trimLabel}" has been added to your templates.`);
  }

  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScreenContainer>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Text style={s.headerTitle}>Template Library</Text>
        <View style={{ width: 60 }} />
      </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
<ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <Text style={s.subtitle}>
          Browse 49 professional SMS templates organized by category. Tap{" "}
          <Text style={{ color: colors.primary }}>Add to My Templates</Text> to save, or{" "}
          <Text style={{ color: colors.primary }}>Duplicate &amp; Edit</Text> to personalise.
        </Text>

        {/* Search bar */}
        <View style={[s.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            style={[s.searchInput, { color: colors.foreground }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search templates…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
              <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>

        {searchQuery.trim().length > 0 && grouped.length === 0 && (
          <View style={{ alignItems: "center", paddingVertical: 32 }}>
            <IconSymbol name="magnifyingglass" size={32} color={colors.border} />
            <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12, textAlign: "center" }}>
              No templates match "{searchQuery.trim()}"
            </Text>
          </View>
        )}

        {grouped.map(({ cat, templates }) => (
          <View key={cat} style={s.section}>
            <Pressable style={s.sectionHeader} onPress={() => toggleCategory(cat)}>
              <View style={s.sectionHeaderLeft}>
                <View style={[s.categoryDot, { backgroundColor: CATEGORY_COLORS[cat] }]} />
                <Text style={s.sectionTitle}>{TEMPLATE_CATEGORY_LABELS[cat]}</Text>
                <View style={s.countBadge}>
                  <Text style={s.countText}>{templates.length}</Text>
                </View>
              </View>
              <IconSymbol
                name={expanded[cat] ? "chevron.down" : "chevron.right"}
                size={16}
                color={colors.muted}
              />
            </Pressable>

            {expanded[cat] && (
              <View style={s.templateList}>
                {templates.map((tmpl, idx) => {
                  const isSaved      = savedIds.has(tmpl.id);
                  const isPreviewing = previewIds.has(tmpl.id);
                  return (
                    <View key={tmpl.id} style={[s.templateCard, idx === templates.length - 1 && s.templateCardLast]}>
                      {/* Title row */}
                      <View style={s.templateTop}>
                        <Text style={s.templateLabel}>{tmpl.label}</Text>
                        {tmpl.minutesBefore > 0 && (
                          <View style={s.timingBadge}>
                            <Text style={s.timingText}>{formatMinutes(tmpl.minutesBefore)}</Text>
                          </View>
                        )}
                      </View>

                      {/* Message body — always shown as full formatted preview */}
                      <Text style={[s.templatePreview, s.templatePreviewFull]}>
                        {applyPreview(tmpl.customMessage ?? "")}
                      </Text>

                      {/* Action buttons row */}
                      <View style={s.actionRow}>
                        <Pressable
                          style={[s.addBtn, isSaved && s.addBtnSaved]}
                          onPress={() => handleAdd(tmpl)}
                        >
                          <IconSymbol
                            name={isSaved ? "checkmark" : "plus"}
                            size={13}
                            color={isSaved ? colors.success : colors.primary}
                          />
                          <Text style={[s.addBtnText, isSaved && s.addBtnTextSaved]}>
                            {isSaved ? "Added" : "Add to My Templates"}
                          </Text>
                        </Pressable>

                        <Pressable
                          style={s.dupBtn}
                          onPress={() => openDuplicateEdit(tmpl)}
                        >
                          <IconSymbol name="doc.on.doc.fill" size={13} color={colors.muted} />
                          <Text style={s.dupBtnText}>Duplicate &amp; Edit</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Duplicate & Edit Modal */}
      <Modal
        visible={editModal.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModal((p) => ({ ...p, visible: false }))}
      >
        <View style={[s.modalContainer, { backgroundColor: colors.background }]}>
          <View style={s.modalHeader}>
            <Pressable onPress={() => setEditModal((p) => ({ ...p, visible: false }))}>
              <Text style={{ fontSize: 16, color: colors.muted }}>Cancel</Text>
            </Pressable>
            <Text style={s.modalTitle}>Duplicate &amp; Edit</Text>
            <Pressable onPress={saveDuplicate}>
              <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
            <View>
              <Text style={s.fieldLabel}>Template Name</Text>
              <TextInput
                style={[s.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={editModal.label}
                onChangeText={(v) => setEditModal((p) => ({ ...p, label: v }))}
                placeholder="e.g. My Custom Reminder"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
              />
            </View>

            <View>
              <Text style={s.fieldLabel}>Message</Text>
              <Text style={s.fieldHint}>
                Variables: {"{"}clientName{"}"} {"{"}service{"}"} {"{"}date{"}"} {"{"}time{"}"} {"{"}location{"}"} {"{"}price{"}"} {"{"}businessName{"}"}  
              </Text>
              <TextInput
                style={[s.textArea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={editModal.message}
                onChangeText={(v) => {
                  // Prevent removing the locked footer
                  const footer = "\u2014 Powered by Lime Of Time";
                  setEditModal((p) => ({ ...p, message: v }));
                }}
                placeholder="Type your message here..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
              {/* Locked footer indicator */}
              <View style={[s.lockedFooter, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <IconSymbol name="lock.fill" size={12} color={colors.muted} />
                <Text style={[s.lockedFooterText, { color: colors.muted }]}>— Powered by Lime Of Time</Text>
              </View>
            </View>

            {/* Live preview of edited message */}
            {editModal.message.trim().length > 0 && (
              <View style={[s.livePreviewBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[s.fieldLabel, { marginBottom: 6 }]}>Live Preview</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 19 }}>
                  {applyPreview(editModal.message)}
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
  if (min >= 1440) return `${min / 1440}d before`;
  if (min >= 60) return `${min / 60}h before`;
  return `${min}m before`;
}

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  upcoming:   "#3B82F6",
  confirmed:  "#22C55E",
  pending:    "#F59E0B",
  cancelled:  "#EF4444",
  completed:  "#8B5CF6",
  no_show:    "#F97316",
  reschedule: "#06B6D4",
};

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      width: 60,
    },
    backText: {
      fontSize: 16,
      color: colors.primary,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: "600",
      color: colors.foreground,
    },
    scroll: {
      padding: 16,
      gap: 12,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 4,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      padding: 0,
    },
    subtitle: {
      fontSize: 14,
      color: colors.muted,
      lineHeight: 20,
      marginBottom: 8,
    },
    section: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: 12,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 14,
    },
    sectionHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    categoryDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.foreground,
    },
    countBadge: {
      backgroundColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    countText: {
      fontSize: 12,
      color: colors.muted,
      fontWeight: "500",
    },
    templateList: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 4,
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    templateCard: {
      padding: 16,
      paddingVertical: 18,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      marginBottom: 10,
      gap: 10,
    },
    templateCardLast: {
      marginBottom: 4,
    },
    templateTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    templateLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.foreground,
      flex: 1,
    },
    timingBadge: {
      backgroundColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    timingText: {
      fontSize: 11,
      color: colors.muted,
    },
    templatePreview: {
      fontSize: 13,
      color: colors.muted,
      lineHeight: 20,
      numberOfLines: 3,
    } as any,
    templatePreviewFull: {
      color: colors.foreground,
      lineHeight: 20,
    },
    previewToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: 2,
    },
    previewToggleText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "500",
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
      flexWrap: "wrap",
    },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    addBtnSaved: {
      borderColor: colors.success,
      backgroundColor: `${colors.success}15`,
    },
    addBtnText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: "500",
    },
    addBtnTextSaved: {
      color: colors.success,
    },
    dupBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dupBtnText: {
      fontSize: 13,
      color: colors.muted,
      fontWeight: "500",
    },
    // Modal styles
    modalContainer: {
      flex: 1,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#E5E7EB",
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: "600",
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: "#687076",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    fieldHint: {
      fontSize: 12,
      color: "#687076",
      marginBottom: 8,
      lineHeight: 17,
    },
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
    livePreviewBox: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
    },
    lockedFooter: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderTopWidth: 0,
      borderBottomLeftRadius: 10,
      borderBottomRightRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginTop: -1,
    },
    lockedFooterText: {
      fontSize: 12,
      fontStyle: "italic",
    },
  });
}
