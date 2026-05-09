import { Text, View, Pressable, StyleSheet, Alert, ScrollView } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { useResponsive } from "@/hooks/use-responsive";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter } from "expo-router";
import { FuturisticBackground } from "@/components/futuristic-background";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";


const EXPORT_ITEMS = [
  { key: "Clients", icon: "person.2.fill" as const, desc: "Client list with contact info and visit history" },
  { key: "Appointments", icon: "calendar" as const, desc: "All appointments with dates, services, and pricing" },
  { key: "Services", icon: "list.bullet" as const, desc: "Service catalog with pricing and booking counts" },
  { key: "Revenue", icon: "dollarsign.circle.fill" as const, desc: "Revenue breakdown by period and service" },
];

export default function DataExportScreen() {
  const { state, filterAppointmentsByLocation, clientsForActiveLocation } = useStore();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { planInfo } = usePlanLimitCheck();
  const isFreeplan = !planInfo || planInfo.planKey === "solo";

  const handleExport = async (label: string) => {
    if (isFreeplan) {
      Alert.alert(
        "Upgrade Required",
        "PDF exports are available on the Growth and Pro plans. Upgrade your subscription to unlock professional PDF reports.",
        [
          { text: "Not Now", style: "cancel" },
          { text: "View Plans", onPress: () => router.push("/subscription" as any) },
        ]
      );
      return;
    }
    try {
      const { generateClientsPdf, generateAppointmentsPdf, generateServicesPdf, generateRevenuePdf, exportPdf } = await import("@/lib/pdf-export");
      const accent = colors.primary;
      const bizName = state.settings.businessName;
      const logoUri = state.settings.businessLogoUri || undefined;
      const activeLocation = state.activeLocationId ? state.locations.find((l) => l.id === state.activeLocationId) : null;
      const locName = activeLocation?.name;
      const locAddress = activeLocation?.address;
      const filteredAppts = filterAppointmentsByLocation(state.appointments);
      const filteredClients = clientsForActiveLocation;
      let html = "";
      if (label === "Clients") {
        html = generateClientsPdf(bizName, filteredClients, accent, locName, locAddress, logoUri);
      } else if (label === "Appointments") {
        html = generateAppointmentsPdf(bizName, filteredAppts, state.services, filteredClients, accent, locName, locAddress, logoUri);
      } else if (label === "Services") {
        html = generateServicesPdf(bizName, state.services, filteredAppts, accent, locName, locAddress, logoUri);
      } else {
        html = generateRevenuePdf(bizName, filteredAppts, state.services, accent, locName, locAddress, logoUri);
      }
      await exportPdf(html, `${bizName}${locName ? `_${locName}` : ""}_${label}_Report.pdf`);
    } catch (err) {
      Alert.alert("Export Error", "Failed to generate PDF report");
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]} tabletMaxWidth={720}>
      <FuturisticBackground />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: hp }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <IconSymbol name="arrow.left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Export Data</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: hp, paddingVertical: 16, paddingBottom: 40 }}>
        {isFreeplan && (
          <Pressable
            onPress={() => router.push("/subscription" as any)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: "#FF980015",
              borderRadius: 12,
              padding: 12,
              borderWidth: 1,
              borderColor: "#FF980040",
              marginBottom: 14,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <IconSymbol name="lock.fill" size={18} color="#FF9800" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#FF9800" }}>PDF Export is a Pro Feature</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2 }}>Upgrade to Growth or Pro to download professional PDF reports.</Text>
            </View>
            <IconSymbol name="chevron.right" size={14} color="#FF9800" />
          </Pressable>
        )}
        <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 16, lineHeight: 20 }}>
          Generate professional PDF reports for your business data. Reports include your business branding and current data.
        </Text>

        {EXPORT_ITEMS.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => handleExport(item.key)}
            style={({ pressed }) => [
              styles.exportCard,
              { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: isFreeplan ? colors.muted + "15" : colors.primary + "15" }]}>
              <IconSymbol name={item.icon} size={22} color={isFreeplan ? colors.muted : colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fs.sm, fontWeight: "600", color: isFreeplan ? colors.muted : colors.foreground }}>{item.key} Report</Text>
              <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 3, lineHeight: 17 }}>{item.desc}</Text>
            </View>
            {isFreeplan ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FF980015", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <IconSymbol name="lock.fill" size={12} color="#FF9800" />
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: "#FF9800" }}>Pro</Text>
              </View>
            ) : (
              <IconSymbol name="square.and.arrow.up.fill" size={18} color={colors.primary} />
            )}
          </Pressable>
        ))}

        {/* Quick Stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: fs.xs, fontWeight: "500", color: colors.muted, marginBottom: 12 }}>Data Summary</Text>
          <View style={styles.statsGrid}>
            {[
              { label: "Services", count: state.services.length },
              { label: "Clients", count: state.clients.length },
              { label: "Appointments", count: state.appointments.length },
              { label: "Reviews", count: state.reviews.length },
            ].map((s) => (
              <View key={s.label} style={styles.statItem}>
                <Text style={[styles.statNum, { color: colors.primary }]}>{s.count}</Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "700" },
  exportCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 12, gap: 14 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statsCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginTop: 8 },
  statsGrid: { flexDirection: "row", justifyContent: "space-between" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 17, fontWeight: "700", lineHeight: 28 },
});
