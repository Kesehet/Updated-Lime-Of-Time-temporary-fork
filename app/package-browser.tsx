/**
 * Package Browser Screen
 *
 * Displays all active packages/bundles with:
 *  - Category filter chips (derived from the services included in each package)
 *  - Package list cards (name, category tags, session count, price, savings, description)
 *  - Full detail bottom sheet (all fields + included services breakdown)
 *  - "Book This Package" CTA that navigates to calendar-booking with the package pre-selected
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useStore } from "@/lib/store";
import { ServicePackage } from "@/lib/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatExpiry(days: number): string {
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""}`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return `${w} week${w !== 1 ? "s" : ""}`;
  }
  const mo = Math.round(days / 30);
  return `${mo} month${mo !== 1 ? "s" : ""}`;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function PackageBrowserScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ locationId?: string; preselectedLocationId?: string; fromCalendarBooking?: string }>();

  const { state } = useStore();
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [detailPackage, setDetailPackage] = useState<ServicePackage | null>(null);

  const activePackages = useMemo(
    // Treat missing/undefined active field as true (backward compat with older data)
    () => (state.packages ?? []).filter((p) => p.active !== false),
    [state.packages]
  );

  // Derive categories from the services included in each package
  const categories = useMemo(() => {
    const cats = new Set<string>();
    activePackages.forEach((pkg) => {
      pkg.serviceIds.forEach((sid) => {
        const svc = state.services.find((s) => s.id === sid);
        if (svc?.category?.trim()) cats.add(svc.category.trim());
      });
    });
    return ["All", ...Array.from(cats).sort()];
  }, [activePackages, state.services]);

  // Filter packages by selected category
  const filteredPackages = useMemo(() => {
    if (selectedCategory === "All") return activePackages;
    return activePackages.filter((pkg) =>
      pkg.serviceIds.some((sid) => {
        const svc = state.services.find((s) => s.id === sid);
        return svc?.category?.trim() === selectedCategory;
      })
    );
  }, [activePackages, selectedCategory, state.services]);

  // Compute derived info for a package
  const getPackageInfo = (pkg: ServicePackage) => {
    const includedSvcs = pkg.serviceIds
      .map((id) => state.services.find((s) => s.id === id))
      .filter(Boolean) as typeof state.services;
    const totalDuration = includedSvcs.reduce((s, sv) => s + sv.duration, 0);
    const retailTotal = includedSvcs.reduce((s, sv) => s + parseFloat(String(sv.price)), 0);
    const savings = retailTotal - pkg.price;
    const savingsPct = retailTotal > 0 ? Math.round((savings / retailTotal) * 100) : 0;
    const cats = [...new Set(includedSvcs.map((sv) => sv.category?.trim()).filter(Boolean))] as string[];
    return { includedSvcs, totalDuration, retailTotal, savings, savingsPct, cats };
  };

  const handleBookPackage = (pkg: ServicePackage) => {
    setDetailPackage(null);
    const navParams = {
      packageId: pkg.id,
      ...(params.locationId ? { locationId: params.locationId } : {}),
      ...(params.preselectedLocationId ? { preselectedLocationId: params.preselectedLocationId } : {}),
    };
    // If opened from within calendar-booking (Step 1 banner), replace this screen so the
    // back stack is clean: (tabs) → calendar-booking (with package pre-selected).
    // If opened standalone (e.g. from home quick-actions), push a fresh calendar-booking.
    if (params.fromCalendarBooking === "1") {
      router.replace({ pathname: "/calendar-booking", params: navParams } as any);
    } else {
      router.push({ pathname: "/calendar-booking", params: navParams });
    }
  };

  const s = styles(colors);

  // ── empty state ──
  if (activePackages.length === 0) {
    return (
      <ScreenContainer>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 8 })}>
            <IconSymbol name="chevron.left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={s.headerTitle}>Packages & Bundles</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📦</Text>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 6, textAlign: "center" }}>No Packages Yet</Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 }}>
            Create packages in Packages & Bundles settings to offer bundled deals to your clients.
          </Text>
          <Pressable
            onPress={() => router.push("/packages" as any)}
            style={({ pressed }) => ({
              marginTop: 24,
              paddingHorizontal: 24,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: colors.primary,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFFFFF" }}>Go to Packages Settings</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ marginTop: 12, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontSize: 14, color: colors.muted }}>Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 8 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={s.headerTitle}>Packages & Bundles</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Category filter chips */}
      {categories.length > 2 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 48 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, flexDirection: "row" }}
        >
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => setSelectedCategory(cat)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  backgroundColor: isActive ? colors.primary : colors.surface,
                  borderColor: isActive ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: isActive ? "#FFF" : colors.foreground }}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Package list */}
      <FlatList
        data={filteredPackages}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingTop: 40 }}>
            <Text style={{ fontSize: 14, color: colors.muted }}>No packages in this category.</Text>
          </View>
        }
        renderItem={({ item: pkg }) => {
          const { includedSvcs, totalDuration, retailTotal, savings, savingsPct, cats } = getPackageInfo(pkg);
          return (
            <Pressable
              onPress={() => setDetailPackage(pkg)}
              style={({ pressed }) => ({
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1.5,
                borderRadius: 16,
                padding: 16,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              {/* Top row: name + price */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 6 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 2 }}>
                    {pkg.name}
                  </Text>
                  {/* Category tags */}
                  {cats.length > 0 && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                      {cats.map((c) => (
                        <View key={c} style={{ backgroundColor: colors.primary + "18", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ fontSize: 10, fontWeight: "600", color: colors.primary }}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>${pkg.price.toFixed(2)}</Text>
                  {savings > 0 && (
                    <View style={{ backgroundColor: "#22C55E20", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
                      <Text style={{ fontSize: 11, color: "#22C55E", fontWeight: "700" }}>Save {savingsPct}%</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Description */}
              {!!pkg.description && (
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }} numberOfLines={2}>
                  {pkg.description}
                </Text>
              )}

              {/* Meta pills row */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {pkg.sessions && pkg.sessions > 1 && (
                  <View style={s.metaPill}>
                    <Text style={s.metaPillText}>🔁 {pkg.sessions} sessions</Text>
                  </View>
                )}
                <View style={s.metaPill}>
                  <Text style={s.metaPillText}>⏱ {formatDuration(totalDuration)}</Text>
                </View>
                <View style={s.metaPill}>
                  <Text style={s.metaPillText}>🛎 {includedSvcs.length} service{includedSvcs.length !== 1 ? "s" : ""}</Text>
                </View>
                {pkg.expiryDays && pkg.expiryDays > 0 ? (
                  <View style={s.metaPill}>
                    <Text style={s.metaPillText}>📅 Valid {formatExpiry(pkg.expiryDays)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Included services preview */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {includedSvcs.slice(0, 4).map((sv) => (
                  <View key={sv.id} style={{ backgroundColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{sv.name}</Text>
                  </View>
                ))}
                {includedSvcs.length > 4 && (
                  <View style={{ backgroundColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>+{includedSvcs.length - 4} more</Text>
                  </View>
                )}
              </View>

              {/* Footer: retail vs bundle price + View Details */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                {savings > 0 ? (
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    Retail: <Text style={{ textDecorationLine: "line-through" }}>${retailTotal.toFixed(2)}</Text>
                    {"  "}Save ${savings.toFixed(2)}
                  </Text>
                ) : (
                  <View />
                )}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>View Details</Text>
                  <IconSymbol name="chevron.right" size={14} color={colors.primary} />
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      {/* ── Detail Bottom Sheet ── */}
      <Modal
        visible={!!detailPackage}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailPackage(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
          onPress={() => setDetailPackage(null)}
        />
        {detailPackage && (() => {
          const pkg = detailPackage;
          const { includedSvcs, totalDuration, retailTotal, savings, savingsPct, cats } = getPackageInfo(pkg);
          return (
            <View style={[s.sheet, { backgroundColor: colors.background }]}>
              {/* Sheet handle */}
              <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
                {/* Header */}
                <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>{pkg.name}</Text>
                    {cats.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                        {cats.map((c) => (
                          <View key={c} style={{ backgroundColor: colors.primary + "18", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>{c}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  <Pressable onPress={() => setDetailPackage(null)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}>
                    <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
                  </Pressable>
                </View>

                {/* Description */}
                {!!pkg.description && (
                  <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 16 }}>{pkg.description}</Text>
                )}

                {/* Price block */}
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: savings > 0 ? 8 : 0 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Bundle Price</Text>
                    <Text style={{ fontSize: 22, fontWeight: "800", color: colors.primary }}>${pkg.price.toFixed(2)}</Text>
                  </View>
                  {savings > 0 && (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <Text style={{ fontSize: 13, color: colors.muted }}>Retail value</Text>
                        <Text style={{ fontSize: 13, color: colors.muted, textDecorationLine: "line-through" }}>${retailTotal.toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#22C55E" }}>You save</Text>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#22C55E" }}>${savings.toFixed(2)} ({savingsPct}%)</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Package details */}
                <Text style={s.sectionLabel}>Package Details</Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
                  {[
                    pkg.sessions && pkg.sessions > 1 ? { label: "Sessions", value: `${pkg.sessions} sessions` } : null,
                    { label: "Total Duration", value: formatDuration(totalDuration) },
                    { label: "Services Included", value: `${includedSvcs.length} service${includedSvcs.length !== 1 ? "s" : ""}` },
                    pkg.bufferDays ? { label: "Min. Gap Between Sessions", value: `${pkg.bufferDays} day${pkg.bufferDays !== 1 ? "s" : ""}` } : null,
                    pkg.bufferMinutes ? { label: "Buffer After Each Session", value: `${pkg.bufferMinutes} min` } : null,
                    pkg.expiryDays && pkg.expiryDays > 0 ? { label: "Validity", value: formatExpiry(pkg.expiryDays) } : { label: "Validity", value: "No expiry" },
                  ].filter(Boolean).map((row, i, arr) => (
                    <View
                      key={row!.label}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 13, color: colors.muted }}>{row!.label}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{row!.value}</Text>
                    </View>
                  ))}
                </View>

                {/* Included services breakdown */}
                <Text style={s.sectionLabel}>Included Services</Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, overflow: "hidden", marginBottom: 24 }}>
                  {includedSvcs.map((sv, i) => (
                    <View
                      key={sv.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        borderBottomWidth: i < includedSvcs.length - 1 ? 1 : 0,
                        borderBottomColor: colors.border,
                        gap: 10,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{sv.name}</Text>
                        {sv.category ? (
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{sv.category}</Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>${parseFloat(String(sv.price)).toFixed(2)}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{sv.duration} min</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Book CTA */}
                <Pressable
                  onPress={() => handleBookPackage(pkg)}
                  style={({ pressed }) => ({
                    backgroundColor: colors.primary,
                    borderRadius: 14,
                    paddingVertical: 16,
                    alignItems: "center",
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFF" }}>
                    Book This Package →
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          );
        })()}
      </Modal>
    </ScreenContainer>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 8,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.foreground,
    },
    metaPill: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    metaPillText: {
      fontSize: 11,
      color: colors.muted,
      fontWeight: "500",
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 8,
    },
    sheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "85%",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 10,
    },
  });
