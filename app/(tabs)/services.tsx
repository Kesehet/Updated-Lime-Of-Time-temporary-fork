import React, { useState, useMemo, useRef, useCallback } from "react";
import { FlatList, Text, View, Pressable, StyleSheet, TextInput, LayoutAnimation, Platform, UIManager, Image,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useResponsive } from "@/hooks/use-responsive";
import { FuturisticBackground } from "@/components/futuristic-background";
import { useScrollToTopOnFocus } from "@/hooks/use-scroll-to-top-on-focus";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Tab = "services" | "products";

type ServiceListItem =
  | { type: "header"; category: string; key: string; count: number }
  | { type: "service"; item: ReturnType<typeof useStore>["state"]["services"][0]; key: string };

type ProductListItem =
  | { type: "header"; brand: string; key: string; count: number }
  | { type: "product"; item: ReturnType<typeof useStore>["state"]["products"][0]; key: string };

export default function ServicesScreen() {
  const { state } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { hp } = useResponsive();
  const [activeTab, setActiveTab] = useState<Tab>("services");
  const servicesListRef = useScrollToTopOnFocus<FlatList>();
  const productsListRef = useScrollToTopOnFocus<FlatList>();
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  // Track collapsed groups: key = category/brand name
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = useCallback((key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Derive sorted unique brands from products
  const allBrands = useMemo(() => {
    const brands = new Set<string>();
    state.products.forEach((p) => { if (p.brand) brands.add(p.brand); });
    return Array.from(brands).sort();
  }, [state.products]);

  // Derive sorted unique service categories
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    state.services.forEach((s) => { if (s.category) cats.add(s.category); });
    return Array.from(cats).sort();
  }, [state.services]);

  // Filtered products by selected brand and search query
  const filteredProducts = useMemo(() => {
    let prods = state.products;
    if (selectedBrand) prods = prods.filter((p) => p.brand === selectedBrand);
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      prods = prods.filter((p) => p.name.toLowerCase().includes(q));
    }
    return prods;
  }, [state.products, selectedBrand, productSearch]);

  // Filtered services by selected category and search query
  const filteredServices = useMemo(() => {
    let svcs = state.services;
    if (selectedCategory) svcs = svcs.filter((s) => s.category === selectedCategory);
    if (serviceSearch.trim()) {
      const q = serviceSearch.trim().toLowerCase();
      svcs = svcs.filter((s) => s.name.toLowerCase().includes(q));
    }
    return svcs;
  }, [state.services, selectedCategory, serviceSearch]);

  // Build service list data with collapsible category headers
  const serviceListData = useMemo((): ServiceListItem[] => {
    const catMap = new Map<string, typeof state.services>();
    const uncategorized: typeof state.services = [];
    filteredServices.forEach((s) => {
      const cat = s.category || "";
      if (!cat) { uncategorized.push(s); return; }
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(s);
    });

    const hasCategories = catMap.size > 0 && !selectedCategory && !serviceSearch.trim();
    const result: ServiceListItem[] = [];

    if (hasCategories) {
      // Grouped mode: show collapsible category headers
      Array.from(catMap.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([cat, svcs]) => {
        result.push({ type: "header", category: cat, key: `header-${cat}`, count: svcs.length });
        if (!collapsedGroups[cat]) {
          svcs.forEach((s) => result.push({ type: "service", item: s, key: s.id }));
        }
      });
      if (uncategorized.length > 0) {
        const uncatKey = "__uncategorized__";
        result.push({ type: "header", category: "Uncategorized", key: `header-${uncatKey}`, count: uncategorized.length });
        if (!collapsedGroups[uncatKey]) {
          uncategorized.forEach((s) => result.push({ type: "service", item: s, key: s.id }));
        }
      }
    } else {
      // Flat mode: no headers
      filteredServices.forEach((s) => result.push({ type: "service", item: s, key: s.id }));
    }
    return result;
  }, [filteredServices, selectedCategory, serviceSearch, collapsedGroups]);

  // Build product list data with collapsible brand headers
  const productListData = useMemo((): ProductListItem[] => {
    const brandMap = new Map<string, typeof state.products>();
    const noBrand: typeof state.products = [];
    filteredProducts.forEach((p) => {
      const brand = p.brand || "";
      if (!brand) { noBrand.push(p); return; }
      if (!brandMap.has(brand)) brandMap.set(brand, []);
      brandMap.get(brand)!.push(p);
    });

    const hasBrands = brandMap.size > 0 && !selectedBrand && !productSearch.trim();
    const result: ProductListItem[] = [];

    if (hasBrands) {
      Array.from(brandMap.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([brand, prods]) => {
        result.push({ type: "header", brand, key: `brand-${brand}`, count: prods.length });
        if (!collapsedGroups[`brand-${brand}`]) {
          prods.forEach((p) => result.push({ type: "product", item: p, key: p.id }));
        }
      });
      if (noBrand.length > 0) {
        const noBrandKey = "brand-__none__";
        result.push({ type: "header", brand: "No Brand", key: noBrandKey, count: noBrand.length });
        if (!collapsedGroups[noBrandKey]) {
          noBrand.forEach((p) => result.push({ type: "product", item: p, key: p.id }));
        }
      }
    } else {
      filteredProducts.forEach((p) => result.push({ type: "product", item: p, key: p.id }));
    }
    return result;
  }, [filteredProducts, selectedBrand, productSearch, collapsedGroups]);

  return (
    <ScreenContainer className="pt-2 flex-1" containerClassName="flex-1" safeAreaClassName="flex-1" tabletMaxWidth={0} style={{ paddingHorizontal: hp }}>
      <FuturisticBackground />
      {/* Header */}
      <View style={styles.header}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>
          {activeTab === "services" ? "Services" : "Products"}
        </Text>
        <Pressable
          onPress={() =>
            router.push(
              activeTab === "services"
                ? ({ pathname: "/service-form" as any, params: {} } as any)
                : ({ pathname: "/product-form" as any, params: {} } as any)
            )
          }
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <IconSymbol name="plus" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Segmented Control */}
      <View style={[styles.segmentContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          onPress={() => setActiveTab("services")}
          style={[styles.segmentBtn, activeTab === "services" && { backgroundColor: colors.primary }]}
        >
          <IconSymbol name="list.bullet" size={16} color={activeTab === "services" ? "#fff" : colors.muted} />
          <Text style={[styles.segmentText, { color: activeTab === "services" ? "#fff" : colors.muted }]}>Services</Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("products")}
          style={[styles.segmentBtn, activeTab === "products" && { backgroundColor: colors.primary }]}
        >
          <IconSymbol name="bag.fill" size={16} color={activeTab === "products" ? "#fff" : colors.muted} />
          <Text style={[styles.segmentText, { color: activeTab === "products" ? "#fff" : colors.muted }]}>Products</Text>
        </Pressable>
      </View>

      {/* ── Services Tab ── */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      {activeTab === "services" && (
        <View style={{ flex: 1 }}>
          {/* Search bar */}
          <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={15} color={colors.muted} />
            <TextInput
              value={serviceSearch}
              onChangeText={setServiceSearch}
              placeholder="Search services…"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, marginLeft: 8, fontSize: 14, color: colors.foreground, height: 40 }}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          {/* Category filter chips */}
          {allCategories.length > 0 && (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={[null, ...allCategories]}
              keyExtractor={(item) => item ?? "__all__"}
              style={{ marginBottom: 8, flexGrow: 0, height: 44 }}
              contentContainerStyle={{ gap: 8, paddingVertical: 4, alignItems: 'center' }}
              renderItem={({ item: cat }) => (
                <Pressable
                  onPress={() => setSelectedCategory(cat)}
                  style={[styles.brandChip, {
                    backgroundColor: selectedCategory === cat ? colors.primary : colors.surface,
                    borderColor: selectedCategory === cat ? colors.primary : colors.border,
                  }]}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: selectedCategory === cat ? "#fff" : colors.muted }}>
                    {cat ?? "All"}
                  </Text>
                </Pressable>
              )}
            />
          )}
          {/* Services list */}
          <FlatList
            ref={servicesListRef}
            data={serviceListData}
            keyExtractor={(item) => item.key}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: row }) => {
              if (row.type === "header") {
                const isCollapsed = !!collapsedGroups[row.category === "Uncategorized" ? "__uncategorized__" : row.category];
                return (
                  <Pressable
                    onPress={() => toggleGroup(row.category === "Uncategorized" ? "__uncategorized__" : row.category)}
                    style={[styles.groupHeader, { borderBottomColor: colors.border }]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                        {row.category}
                      </Text>
                      <View style={[styles.countBadge, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>{row.count}</Text>
                      </View>
                    </View>
                    <IconSymbol
                      name={isCollapsed ? "chevron.right" : "chevron.down"}
                      size={14}
                      color={colors.muted}
                    />
                  </Pressable>
                );
              }
              const svc = row.item;
              return (
                <Pressable
                  onPress={() => router.push({ pathname: "/service-form" as any, params: { id: svc.id } })}
                  style={({ pressed }) => [styles.serviceCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  {svc.photoUri ? (
                    <Image source={{ uri: svc.photoUri }} style={{ width: 44, height: 44, borderRadius: 8, marginRight: 10, marginLeft: 4 }} />
                  ) : (
                    <View style={[styles.colorBar, { backgroundColor: svc.color }]} />
                  )}
                  <View style={styles.cardContent}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{svc.name}</Text>
                    <View style={styles.metaRow}>
                      <IconSymbol name="clock.fill" size={12} color={colors.muted} />
                      <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 4 }}>{svc.duration} min</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginHorizontal: 6 }}>·</Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>${svc.price}</Text>
                      {svc.category && selectedCategory ? (
                        <>
                          <Text style={{ fontSize: 12, color: colors.muted, marginHorizontal: 6 }}>·</Text>
                          <Text style={{ fontSize: 12, color: colors.muted }}>{svc.category}</Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginRight: 8 }}>
                    <Pressable
                      onPress={() => router.push({ pathname: "/service-gallery" as any, params: { serviceId: svc.id } })}
                      style={({ pressed }) => ({ backgroundColor: colors.primary + "15", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, opacity: pressed ? 0.7 : 1 })}
                    >
                      <IconSymbol name="photo.fill" size={14} color={colors.primary} />
                    </Pressable>
                    <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <IconSymbol name="list.bullet" size={48} color={colors.muted} />
                <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>No services yet</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>Tap + to create your first service</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 80 }}
          />
        </View>
      )}

      {/* ── Products Tab ── */}
      {activeTab === "products" && (
        <View style={{ flex: 1 }}>
          {/* Product search bar */}
          <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={15} color={colors.muted} />
            <TextInput
              value={productSearch}
              onChangeText={setProductSearch}
              placeholder="Search products…"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, marginLeft: 8, fontSize: 14, color: colors.foreground, height: 40 }}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          {/* Brand filter chips */}
          {allBrands.length > 0 && (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={[null, ...allBrands]}
              keyExtractor={(item) => item ?? "__all__"}
              style={{ marginBottom: 8, flexGrow: 0, height: 44 }}
              contentContainerStyle={{ gap: 8, paddingVertical: 4, alignItems: 'center' }}
              renderItem={({ item: brand }) => (
                <Pressable
                  onPress={() => setSelectedBrand(brand)}
                  style={[styles.brandChip, {
                    backgroundColor: selectedBrand === brand ? colors.primary : colors.surface,
                    borderColor: selectedBrand === brand ? colors.primary : colors.border,
                  }]}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: selectedBrand === brand ? "#fff" : colors.muted }}>
                    {brand ?? "All"}
                  </Text>
                </Pressable>
              )}
            />
          )}
          {/* Products list */}
          <FlatList
            ref={productsListRef}
            data={productListData}
            keyExtractor={(item) => item.key}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: row }) => {
              if (row.type === "header") {
                const groupKey = `brand-${row.brand === "No Brand" ? "__none__" : row.brand}`;
                const isCollapsed = !!collapsedGroups[groupKey];
                return (
                  <Pressable
                    onPress={() => toggleGroup(groupKey)}
                    style={[styles.groupHeader, { borderBottomColor: colors.border }]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                        {row.brand}
                      </Text>
                      <View style={[styles.countBadge, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>{row.count}</Text>
                      </View>
                    </View>
                    <IconSymbol
                      name={isCollapsed ? "chevron.right" : "chevron.down"}
                      size={14}
                      color={colors.muted}
                    />
                  </Pressable>
                );
              }
              const item = row.item;
              return (
                <Pressable
                  onPress={() => router.push({ pathname: "/product-form" as any, params: { id: item.id } })}
                  style={({ pressed }) => [styles.productCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  {item.photoUri ? (
                    <Image source={{ uri: item.photoUri }} style={{ width: 44, height: 44, borderRadius: 8, marginRight: 10, marginLeft: 4 }} />
                  ) : (
                    <View style={[styles.productIcon, { backgroundColor: colors.primary + "18" }]}>
                      <IconSymbol name="bag.fill" size={20} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.cardContent}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.metaRow}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>${item.price.toFixed(2)}</Text>
                      {!item.available && (
                        <>
                          <Text style={{ fontSize: 12, color: colors.muted, marginHorizontal: 6 }}>·</Text>
                          <Text style={{ fontSize: 12, color: colors.error }}>Unavailable</Text>
                        </>
                      )}
                    </View>
                    {item.description ? (
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                  </View>
                  <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginRight: 14 }} />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <IconSymbol name="bag.fill" size={48} color={colors.muted} />
                <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>No products yet</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>Tap + to add your first product</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 80 }}
          />
        </View>
      )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentContainer: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    marginBottom: 14,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    marginBottom: 10,
    height: 40,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 20,
    alignItems: "center",
  },
  serviceCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  colorBar: {
    width: 5,
    alignSelf: "stretch",
  },
  cardContent: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  productCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  productIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 48,
  },
  brandChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
    height: 34,
    justifyContent: "center",
    alignItems: "center",
  },
});
