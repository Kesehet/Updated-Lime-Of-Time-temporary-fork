import { useMemo, useEffect, useCallback, useState, useRef } from "react";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { LinearGradient } from "expo-linear-gradient";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  Share,
  ScrollView,
  Image,
  ImageBackground,
  Alert,
  Platform,
  Modal,
  Animated,
  ActivityIndicator,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, formatTime, formatDateStr } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { minutesToTime, timeToMinutes, PUBLIC_BOOKING_URL, formatFullAddress, formatPhoneNumber } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { FuturisticBackground } from "@/components/futuristic-background";
import * as ImagePicker from "expo-image-picker";
import { MiniBarChart, MiniDonutChart } from "@/components/mini-chart";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KpiDetailSheet, MicroSparkLine, MicroBarSpark, type KpiTab, type KpiDateRange, type KpiSlideFilter } from "@/components/kpi-detail-sheet";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import Svg, { Path as SvgPath } from "react-native-svg";
import { TourOverlay } from "@/components/tour-overlay";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";
import { useScrollToTopOnFocus } from "@/hooks/use-scroll-to-top-on-focus";
import { RevenueChartCard } from "@/components/revenue-chart-card";
import { PaymentSummaryCard } from "@/components/payment-summary-card";
import { ChartDrillDownSheet, type DrillDownAppointment } from "@/components/chart-drilldown-sheet";
import { ScheduleCard } from "@/components/schedule-card";
import { OverviewDayWeekCard } from "@/components/overview-day-week-card";
import { apiCall } from "@/lib/_core/api";
import { trpc } from "@/lib/trpc";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";

// App logo URL (same as app.config.ts logoUrl)
const APP_LOGO_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/IvzpqiWWzFzYmkTo.png";
// ─── Live clock hook (updates every second) ────────────────────────────
function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── Count-up hook ──────────────────────────────────────────────────────
function useCountUp(target: number, duration = 900): number {
  const [display, setDisplay] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (target === 0) { setDisplay(0); return; }
    const steps = 40;
    const stepTime = Math.max(16, Math.floor(duration / steps));
    let current = 0;
    ref.current = setInterval(() => {
      current += 1;
      setDisplay(Math.round((current / steps) * target));
      if (current >= steps) {
        setDisplay(target);
        if (ref.current) clearInterval(ref.current);
      }
    }, stepTime);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [target, duration]);
  return display;
}

// ─── Gradient KPI Card (redesigned with sparkline) ────────────────────
function GradientKpiCard({
  gradientColors,
  iconBg,
  icon,
  value,
  numericValue,
  valuePrefix,
  valueSuffix,
  label,
  sublabel,
  badge,
  miniStats,
  sparkData,
  sparkType,
  onPress,
  width: cardWidth,
}: {
  gradientColors: [string, string];
  iconBg: string;
  icon: React.ReactNode;
  value: string;
  numericValue?: number;
  valuePrefix?: string;
  valueSuffix?: string;
  label: string;
  sublabel?: string;
  badge?: React.ReactNode;
  miniStats?: React.ReactNode;
  sparkData?: number[];
  sparkType?: "line" | "bar";
  onPress?: () => void;
  width: number;
}) {
  const sparkW = cardWidth - 28;
  const animatedNum = useCountUp(numericValue ?? 0);
  const displayValue = numericValue != null
    ? `${valuePrefix ?? ""}${animatedNum.toLocaleString()}${valueSuffix ?? ""}`
    : value;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        width: cardWidth,
        marginBottom: 0,
        alignSelf: "stretch",
      }]}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 20,
          padding: 14,
          flex: 1,
          minHeight: 155,
          shadowColor: gradientColors[0],
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 14,
          elevation: 6,
          overflow: "hidden",
        }}
      >
        {/* Decorative circle */}
        <View style={{
          position: "absolute",
          top: -20,
          right: -20,
          width: 90,
          height: 90,
          borderRadius: 45,
          backgroundColor: "rgba(255,255,255,0.08)",
        }} />
        <View style={{
          position: "absolute",
          bottom: 20,
          right: -30,
          width: 70,
          height: 70,
          borderRadius: 35,
          backgroundColor: "rgba(255,255,255,0.05)",
        }} />

        {/* Top row: icon + badge */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <View style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: iconBg,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.15)",
          }}>
            {icon}
          </View>
          {badge}
        </View>

        {/* Value */}
        <Text style={{ fontSize: 26, fontWeight: "800", color: "#FFFFFF", lineHeight: 32, letterSpacing: -0.8 }} numberOfLines={1}>
          {displayValue}
        </Text>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.82)", marginTop: 1 }}>{label}</Text>
        {sublabel ? <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{sublabel}</Text> : null}
        {miniStats}

        {/* Sparkline at bottom */}
        {sparkData && sparkData.length > 1 && (
          <View style={{ marginTop: 8, opacity: 0.75 }}>
            {sparkType === "bar" ? (
              <MicroBarSpark data={sparkData} w={sparkW} h={28} color="#FFFFFF" />
            ) : (
              <MicroSparkLine data={sparkData} w={sparkW} h={28} color="#FFFFFF" />
            )}
          </View>
        )}

      </LinearGradient>
    </Pressable>
  );
}

// ─── Swipeable KPI Card (multiple slides with dot indicators) ──────────────
function SwipeableKpiCard({
  slides,
  width: cardWidth,
}: {
  slides: Array<{
    gradientColors: [string, string];
    iconBg: string;
    icon: React.ReactNode;
    value: string;
    numericValue?: number;
    valuePrefix?: string;
    valueSuffix?: string;
    label: string;
    sublabel?: string;
    badge?: React.ReactNode;
    sparkData?: number[];
    sparkType?: "line" | "bar";
    onPress?: () => void;
  }>;
  width: number;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View style={{ width: cardWidth }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
          setActiveIdx(idx);
        }}
        style={{ width: cardWidth }}
        contentContainerStyle={{ width: cardWidth * slides.length }}
      >
        {slides.map((slide, i) => (
          <GradientKpiCard key={i} width={cardWidth} {...slide} />
        ))}
      </ScrollView>
      {/* Dot indicators */}
      {slides.length > 1 && (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 6 }}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === activeIdx ? 14 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === activeIdx ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)",
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Progress Bar (inline, lightweight) ────────────────────────────
function ProgressBar({
  value,
  max,
  color,
  bgColor,
}: {
  value: number;
  max: number;
  color: string;
  bgColor: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: bgColor, overflow: "hidden", width: "100%" }}>
      <View style={{ height: "100%", width: `${pct}%`, backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────
export default function HomeScreen() {
  const { state, dispatch, getServiceById, getClientById, getAppointmentsForDate, syncToDb, filterAppointmentsByLocation, clientsForActiveLocation } =
    useStore();
  const colors = useColors();
  const router = useRouter();
  const { width, height, isTablet, isLargeTablet, hp, maxContentWidth, cardGap, kpiCols, fontScale: fs } = useResponsive();
  const contentWidth = maxContentWidth - hp * 2;
  const cardW = Math.floor((contentWidth - cardGap * (kpiCols - 1)) / kpiCols);

  useEffect(() => {
    if (state.loaded && !state.settings.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [state.loaded, state.settings.onboardingComplete]);

  // ─── Upload image mutation (for logo upload to cloud) ────────────
  const uploadImageMut = trpc.files.uploadImage.useMutation();
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // ─── Location Share Picker ──────────────────────────────
  const [showSharePicker, setShowSharePicker] = useState(false);

  // ─── QR Booking Card ──────────────────────────────────
  const [showQrModal, setShowQrModal] = useState(false);
  // Which location is selected inside the QR modal (null = all/base URL)
  const [qrSelectedLocationId, setQrSelectedLocationId] = useState<string | null>(null);

  // ─── KPI Detail Sheet ─────────────────────────────────────────
  const [kpiDetailTab, setKpiDetailTab] = useState<KpiTab | null>(null);
  const [kpiDateRange, setKpiDateRange] = useState<KpiDateRange>("week");
  const [kpiSlideFilter, setKpiSlideFilter] = useState<KpiSlideFilter>(null);
  const [kpiSlideExtraData, setKpiSlideExtraData] = useState<{
    label?: string;
    value?: string | number;
    sublabel?: string;
    clients?: { id: string; name: string; phone?: string; email?: string; apptCount: number; totalSpent: number; birthday?: string }[];
    services?: { id: string; name: string; color: string; bookings: number; price: number }[];
    appointmentCount?: number;
    appointments?: { id: string; clientName: string; serviceName: string; time: string; date: string; status: string; price: number }[];
    completedAppointments?: { id: string; clientName: string; serviceName: string; date: string; price: number }[];
  } | undefined>(undefined);

  // ─── Chart Drill-Down Sheet ─────────────────────────────────────
  const [drillDownVisible, setDrillDownVisible] = useState(false);
  const [drillDownLabel, setDrillDownLabel] = useState("");
  const [drillDownSubtitle, setDrillDownSubtitle] = useState("");
  const [drillDownAppointments, setDrillDownAppointments] = useState<DrillDownAppointment[]>([]);
  const [drillDownRevenue, setDrillDownRevenue] = useState(0);

  // ─── Recent Messages (business owner inbox preview) ─────────────────
  interface HomeMessageThread {
    clientAccountId: number;
    clientName: string;
    clientPhone: string | null;
    lastMessage: string;
    lastMessageAt: string;
    unreadCount: number;
    senderType: "client" | "business";
  }
  const [recentMessages, setRecentMessages] = useState<HomeMessageThread[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const loadRecentMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const data = await apiCall<{ inbox: HomeMessageThread[] }>("/api/business/messages");
      setRecentMessages((data.inbox ?? []).slice(0, 3));
    } catch {
      // silently fail — messages card is non-critical
    } finally {
      setMessagesLoading(false);
    }
  }, [apiCall]);

  useFocusEffect(
    useCallback(() => {
      loadRecentMessages();
    }, [loadRecentMessages])
  );

  // ─── Push Permission Banner ──────────────────────────────────────────
  const [pushDenied, setPushDenied] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      Notifications.getPermissionsAsync().then((status) => {
        setPushDenied(status.status === "denied");
      });
    }, [])
  );

  // ─── Tutorial Walkthrough ──────────────────────────────────────────────
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialFade = useState(() => new Animated.Value(0))[0];

  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  // Tutorial card colors that follow system light/dark mode
  const tutorialCardBg = isDark ? "#0F1F18" : "#FFFFFF";
  const tutorialCardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const tutorialTitleColor = isDark ? "#FFFFFF" : "#11181C";
  const tutorialSubtitleColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const tutorialDescColor = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.65)";
  const tutorialBulletTextColor = isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.75)";
  const tutorialActionBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const tutorialActionBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const tutorialActionTextColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
  const tutorialStepCountColor = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)";
  const tutorialProgressTrackBg = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
  const tutorialPrevBorderColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
  const tutorialPrevTextColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
  const tutorialSkipTextColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)";
  const tutorialSkipMidColor = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)";
  // Tutorial tab spotlight positions (index = tab index, 0-based left to right)
  // Each entry maps to one of the 5 bottom tabs: Home, Calendar, Clients, Services, Settings
  const TOUR_TAB_STEPS: Array<{
    tabIndex: number;
    title: string;
    message: string;
    emoji: string;
    isLastStep?: boolean;
  }> = [
    {
      tabIndex: 0,
      title: "Home",
      message: "This is your Home dashboard — see all your KPIs, today's appointments, revenue charts, and quick-action buttons at a glance.",
      emoji: "🏠",
    },
    {
      tabIndex: 1,
      title: "Calendar",
      message: "The Calendar tab shows your full schedule. Switch between day, week, and month views, and manage all your bookings here.",
      emoji: "📅",
    },
    {
      tabIndex: 2,
      title: "Clients",
      message: "The Clients tab is your client database. View booking history, add notes, and manage all your client relationships.",
      emoji: "👥",
    },
    {
      tabIndex: 3,
      title: "Services",
      message: "The Services tab lets you define your offerings — set prices, durations, and categories for everything you provide.",
      emoji: "💼",
    },
    {
      tabIndex: 4,
      title: "Settings",
      message: "Settings is your control center — manage locations, staff, schedule, notifications, subscription, and more.",
      emoji: "⚙️",
    },
    {
      tabIndex: 3,
      title: "Add Services & Clients",
      message: "On the Services and Clients tabs, tap the + button to add your first service or client. This is how you build your catalog!",
      emoji: "➕",
    },
    {
      tabIndex: 4,
      title: "Add Your First Location",
      message: "Before you start using the app, you must add your business address. Tap 'Set Up Location' below — it only takes a moment!",
      emoji: "📍",
      isLastStep: true,
    },
  ];
  // Re-check tour flag every time the Home tab comes into focus (supports Replay Tour)
  useFocusEffect(
    useCallback(() => {
      if (state.loaded) {
        AsyncStorage.getItem("@lime_tutorial_seen").then((val) => {
          if (!val) {
            setTutorialStep(0);
            tutorialFade.setValue(0);
            setShowTutorial(true);
          }
        });
      }
    }, [state.loaded, tutorialFade])
  );
  useEffect(() => {
    if (showTutorial) {
      Animated.timing(tutorialFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [showTutorial, tutorialStep]);
  // ─── Tour Analytics ──────────────────────────────────────────────
  const recordTourAnalytics = useCallback(async (event: "completed" | "skipped", stepReached: number) => {
    try {
      const existing = await AsyncStorage.getItem("@lime_tour_analytics");
      const prev = existing ? JSON.parse(existing) : { completions: 0, skips: 0, stepReachedHistory: [] };
      const updated = {
        completions: event === "completed" ? (prev.completions ?? 0) + 1 : (prev.completions ?? 0),
        skips: event === "skipped" ? (prev.skips ?? 0) + 1 : (prev.skips ?? 0),
        stepReachedHistory: [
          ...(prev.stepReachedHistory ?? []).slice(-49), // keep last 50 entries
          { event, stepReached, timestamp: new Date().toISOString() },
        ],
        lastEvent: event,
        lastStepReached: stepReached,
        lastUpdated: new Date().toISOString(),
      };
      await AsyncStorage.setItem("@lime_tour_analytics", JSON.stringify(updated));
    } catch (_) {}
  }, []);

  const dismissTutorial = useCallback(async (skipped = false) => {
    Animated.timing(tutorialFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowTutorial(false);
    });
    await AsyncStorage.setItem("@lime_tutorial_seen", "1");
    await recordTourAnalytics(skipped ? "skipped" : "completed", tutorialStep);
  }, [tutorialFade, tutorialStep, recordTourAnalytics]);
  const nextTutorialStep = useCallback(() => {
    if (tutorialStep < TOUR_TAB_STEPS.length - 1) {
      tutorialFade.setValue(0);
      setTutorialStep((s) => s + 1);
    } else {
      dismissTutorial(false);
    }
  }, [tutorialStep, TOUR_TAB_STEPS.length, dismissTutorial, tutorialFade]);
  const prevTutorialStep = useCallback(() => {
    if (tutorialStep > 0) {
      tutorialFade.setValue(0);
      setTutorialStep((s) => s - 1);
    }
  }, [tutorialStep, tutorialFade]);

  // ─── Location Filter (global) ──────────────────────────────
  const { activeLocation, activeLocations, hasMultipleLocations, setActiveLocation } = useActiveLocation();
  const selectedLocationFilter = activeLocation?.id ?? null;
  // openQrModal: default to active location (or first if only one) — declared after activeLocation
  const openQrModal = useCallback(() => {
    const locs = state.locations.filter((l) => l.active);
    if (locs.length === 1) {
      setQrSelectedLocationId(locs[0].id);
    } else {
      setQrSelectedLocationId(activeLocation?.id ?? null);
    }
    setShowQrModal(true);
  }, [state.locations, activeLocation]);
  // ─── Chart Drill-Down Handler ────────────────────────────────────────
  const handleChartPointPress = useCallback((period: string, label: string, value: number) => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let appts: typeof state.appointments = [];
    let subtitle = "";

    if (period === "daily") {
      // label is like "8am", "2pm" — find hour
      const h = label.endsWith("am") ? parseInt(label) : label === "12pm" ? 12 : parseInt(label) + 12;
      appts = state.appointments.filter((a) => {
        if (a.date !== todayStr || a.status === "cancelled") return false;
        const mins = timeToMinutes(a.time);
        return mins >= h * 60 && mins < (h + 1) * 60;
      });
      subtitle = `Today · ${label}`;
    } else if (period === "weekly") {
      // label is day name like "Mon", "Tue" — find the date
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayIdx = dayNames.indexOf(label);
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      const targetDate = new Date(weekStart);
      targetDate.setDate(weekStart.getDate() + dayIdx);
      const targetStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
      appts = state.appointments.filter((a) => a.date === targetStr && a.status !== "cancelled");
      subtitle = `This Week · ${label}`;
    } else if (period === "monthly") {
      // label is day number like "1", "15"
      const day = parseInt(label);
      const dStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      appts = state.appointments.filter((a) => a.date === dStr && a.status !== "cancelled");
      subtitle = `${now.toLocaleDateString("en-US", { month: "long" })} ${day}`;
    } else {
      // 3m, 6m, 1y — label is month name like "Jan", "Apr"
      // Find the year-month that matches this label
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const mIdx = monthNames.indexOf(label);
      if (mIdx !== -1) {
        // Find which year this month belongs to (could be last year)
        let year = now.getFullYear();
        if (mIdx > now.getMonth()) year -= 1;
        const mS = `${year}-${String(mIdx + 1).padStart(2, "0")}-01`;
        const mLD = new Date(year, mIdx + 1, 0).getDate();
        const mE = `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(mLD).padStart(2, "0")}`;
        appts = state.appointments.filter((a) => a.date >= mS && a.date <= mE && a.status !== "cancelled");
        subtitle = `${label} ${year}`;
      }
    }

    const clientMap: Record<string, string> = {};
    state.clients.forEach((c) => { clientMap[c.id] = c.name; });
    const serviceMap: Record<string, string> = {};
    state.services.forEach((s) => { serviceMap[s.id] = s.name; });

    const drillAppts: DrillDownAppointment[] = appts.map((a) => ({
      id: a.id,
      clientName: clientMap[a.clientId] ?? "Unknown",
      serviceName: serviceMap[a.serviceId] ?? "Service",
      time: a.time,
      date: a.date,
      amount: a.totalPrice ?? state.services.find((s) => s.id === a.serviceId)?.price ?? 0,
      status: a.status,
    }));

    const totalRev = drillAppts.filter((a) => a.status === "completed").reduce((s, a) => s + a.amount, 0);

    setDrillDownLabel(label);
    setDrillDownSubtitle(subtitle);
    setDrillDownAppointments(drillAppts);
    setDrillDownRevenue(totalRev);
    setDrillDownVisible(true);
  }, [state.appointments, state.clients, state.services]);

  // ─── Primary booking URL (for QR card) ────────────────────────────────────────
  // Base URL (no location param) used for the home card QR preview
  const primaryBookingUrl = useMemo(() => {
    const slug = state.settings.customSlug || state.settings.businessName.replace(/\s+/g, "-").toLowerCase();
    return `${PUBLIC_BOOKING_URL}/book/${slug}`;
  }, [state.settings]);
  // URL used inside the QR modal — always base URL (client selects location as first step)
  const qrBookingUrl = useMemo(() => {
    const slug = state.settings.customSlug || state.settings.businessName.replace(/\s+/g, "-").toLowerCase();
    return `${PUBLIC_BOOKING_URL}/book/${slug}`;
  }, [state.settings]);
  // Use the store's location-aware filter (single source of truth)
  const filterByLocation = filterAppointmentsByLocation;

  const now = useLiveClock();
  const todayStr = formatDateStr(now);
  const greeting =
    now.getHours() < 12
      ? "Good Morning"
      : now.getHours() < 17
      ? "Good Afternoon"
      : "Good Evening";
  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const liveTimeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const todayAppts = useMemo(() => {
    const all = filterByLocation(getAppointmentsForDate(todayStr));
    return all
      .filter((a) => a.status === "confirmed" || a.status === "pending")
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  }, [todayStr, selectedLocationFilter, filterByLocation, getAppointmentsForDate]);

  // ─── Next Appointment (for header widget) ────────────────────────
  const nextAppt = useMemo(() => {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return todayAppts.find((a) => timeToMinutes(a.time) > currentMinutes) ?? null;
  }, [todayAppts, now]);

  // ─── Birthday Clients ─────────────────────────────────────────────
  const birthdayClients = useMemo(() => {
    const todayMD = todayStr.slice(5); // "MM-DD"
    return state.clients.filter((c) => {
      if (!c.birthday) return false;
      const parts = c.birthday.replace(/-/g, "/").split("/");
      if (parts.length < 2) return false;
      const mm = parts[0].padStart(2, "0");
      const dd = parts[1].padStart(2, "0");
      return `${mm}-${dd}` === todayMD;
    });
  }, [state.clients, todayStr]);

  // ─── Analytics ──────────────────────────────────────────────
  const analytics = useMemo(() => {
    const totalClients = clientsForActiveLocation.length;
    const filteredAppts = filterByLocation(state.appointments);
    const activeAppts = filteredAppts.filter((a) => a.status !== "cancelled");
    const totalAppointments = activeAppts.length;
    const completedAppts = filteredAppts.filter((a) => a.status === "completed");
    const todayCompletedAppts = completedAppts.filter((a) => a.date === todayStr);
    const todayRevenue = todayCompletedAppts.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);
    const todayCompletedCount = todayCompletedAppts.length;
    const totalRevenue = completedAppts.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const weekStr = formatDateStr(startOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const endWeekStr = formatDateStr(endOfWeek);
    const weekAppts = completedAppts.filter(
      (a) => a.date >= weekStr && a.date <= endWeekStr
    );
    const weekRevenue = weekAppts.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);

    const prevWeekStart = new Date(startOfWeek);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(startOfWeek);
    prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
    const prevWeekAppts = completedAppts.filter(
      (a) =>
        a.date >= formatDateStr(prevWeekStart) && a.date <= formatDateStr(prevWeekEnd)
    );
    const prevWeekRevenue = prevWeekAppts.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);

    const monthlyData: { label: string; value: number; color: string }[] = [];
    const monthColors = [
      "#4CAF50",
      "#2196F3",
      "#FF9800",
      "#9C27B0",
      "#E91E63",
      "#00BCD4",
    ];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStr = d.toLocaleDateString("en-US", { month: "short" });
      const mStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const mEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const mRev = completedAppts
        .filter((a) => a.date >= mStart && a.date <= mEnd)
        .reduce((sum, a) => {
          if (a.totalPrice != null) return sum + a.totalPrice;
          const svc = state.services.find((s) => s.id === a.serviceId);
          return sum + (svc?.price ?? 0);
        }, 0);
      monthlyData.push({
        label: mStr,
        value: Math.round(mRev),
        color: monthColors[5 - i],
      });
    }

    const svcCounts: Record<string, number> = {};
    const svcRevenue: Record<string, number> = {};
    activeAppts.forEach((a) => {
      svcCounts[a.serviceId] = (svcCounts[a.serviceId] || 0) + 1;
      if (a.status === "completed" && a.totalPrice) {
        svcRevenue[a.serviceId] = (svcRevenue[a.serviceId] || 0) + a.totalPrice;
      }
    });
    const serviceBreakdown = state.services
      .map((s) => ({
        label: s.name,
        value: svcCounts[s.id] || 0,
        revenue: svcRevenue[s.id] || 0,
        color: s.color,
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);

    const statusCounts = {
      pending: filteredAppts.filter((a) => a.status === "pending").length,
      confirmed: filteredAppts.filter((a) => a.status === "confirmed").length,
      completed: completedAppts.length,
      cancelled: filteredAppts.filter((a) => a.status === "cancelled").length,
    };

    let topServiceId = "";
    let topCount = 0;
    Object.entries(svcCounts).forEach(([id, count]) => {
      if (count > topCount) {
        topServiceId = id;
        topCount = count;
      }
    });
    const topService = state.services.find((s) => s.id === topServiceId);

    // ─── 7-day daily chart data ─────────────────────────────
    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyDailyData: { label: string; value: number; color: string; apptCount: number }[] = [];
    const weeklyColors = ["#FF9800", "#4CAF50", "#2196F3", "#9C27B0", "#E91E63", "#00BCD4", "#FF5722"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dStr = formatDateStr(d);
      const dayAppts = completedAppts.filter((a) => a.date === dStr);
      const dayRev = dayAppts.reduce((sum, a) => {
        if (a.totalPrice != null) return sum + a.totalPrice;
        const svc = state.services.find((s) => s.id === a.serviceId);
        return sum + (svc?.price ?? 0);
      }, 0);
      const allDayAppts = filterByLocation(state.appointments).filter((a) => a.date === dStr && a.status !== "cancelled");
      weeklyDailyData.push({
        label: dayLabels[d.getDay()],
        value: Math.round(dayRev),
        color: weeklyColors[d.getDay()],
        apptCount: allDayAppts.length,
      });
    }

    // ─── Payment stats ─────────────────────────────────────────────────────
    const getApptPrice = (a: (typeof filteredAppts)[0]) => {
      if (a.totalPrice != null) return a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return svc?.price ?? 0;
    };
    const nonCancelledAppts = filteredAppts.filter((a) => a.status !== 'cancelled');
    const paidAppts = nonCancelledAppts.filter((a) => (a as any).paymentStatus === 'paid');
    const unpaidAppts = nonCancelledAppts.filter((a) => (a as any).paymentStatus !== 'paid');
    const paidRevenue = paidAppts.reduce((sum, a) => sum + getApptPrice(a), 0);
    const unpaidRevenue = unpaidAppts.reduce((sum, a) => sum + getApptPrice(a), 0);
    const paidCount = paidAppts.length;
    const unpaidCount = unpaidAppts.length;
    // Payment method breakdown — keyed by canonical method, value is { count, revenue }
    const METHOD_LABELS: Record<string, string> = {
      cash: 'Cash',
      zelle: 'Zelle',
      venmo: 'Venmo',
      cashapp: 'Cash App',
      card: 'Card',
      unpaid: 'Unpaid',
    };
    const methodBreakdown: Record<string, { count: number; revenue: number; label: string }> = {};
    paidAppts.forEach((a) => {
      const rawMethod = (a as any).paymentMethod;
      // Treat missing / 'unpaid' as 'cash' (legacy appointments without a stored method)
      const method = (rawMethod && rawMethod !== 'unpaid') ? rawMethod : 'cash';
      const label = METHOD_LABELS[method] ?? method.charAt(0).toUpperCase() + method.slice(1);
      if (!methodBreakdown[method]) methodBreakdown[method] = { count: 0, revenue: 0, label };
      methodBreakdown[method].count += 1;
      methodBreakdown[method].revenue += getApptPrice(a);
    });

    // ─── Upcoming this week (today through end of week) ──────────────────
    const upcomingThisWeekAppts = filteredAppts.filter(
      (a) => a.date >= todayStr && a.date <= endWeekStr && a.status !== 'cancelled' && a.status !== 'completed'
    );
    const weekConfirmed = upcomingThisWeekAppts.filter((a) => a.status === 'confirmed').length;
    const weekPending = upcomingThisWeekAppts.filter((a) => a.status === 'pending').length;
    const upcomingThisWeek = upcomingThisWeekAppts.length;

    // ─── Next-7-days daily upcoming counts (for spark) ────────────────────
    const upcomingDailyData: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const dStr = formatDateStr(d);
      upcomingDailyData.push(
        filteredAppts.filter((a) => a.date === dStr && a.status !== 'cancelled' && a.status !== 'completed').length
      );
    }

    // ─── Total Yearly Earnings (completed appts this calendar year) ─────────
    const yearStart = `${now.getFullYear()}-01-01`;
    const yearEnd = `${now.getFullYear()}-12-31`;
    const yearlyRevenue = completedAppts
      .filter((a) => a.date >= yearStart && a.date <= yearEnd)
      .reduce((sum, a) => {
        if (a.totalPrice != null) return sum + a.totalPrice;
        const svc = state.services.find((s) => s.id === a.serviceId);
        return sum + (svc?.price ?? 0);
      }, 0);

    // ─── Hourly data (today by hour, 8am-8pm) ──────────────────────────────
    const CHART_COLOR = "#00C896"; // single modern teal-green color for all charts
    const hourlyData: { label: string; value: number; apptCount: number }[] = [];
    const todayAppts = filterByLocation(state.appointments).filter((a) => a.date === todayStr && a.status !== "cancelled");
    for (let h = 8; h <= 20; h++) {
      const hLabel = h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
      const hAppts = todayAppts.filter((a) => {
        const mins = timeToMinutes(a.time);
        return mins >= h * 60 && mins < (h + 1) * 60;
      });
      const hRev = hAppts.filter((a) => a.status === "completed").reduce((sum, a) => {
        if (a.totalPrice != null) return sum + a.totalPrice;
        const svc = state.services.find((s) => s.id === a.serviceId);
        return sum + (svc?.price ?? 0);
      }, 0);
      hourlyData.push({ label: hLabel, value: Math.round(hRev), apptCount: hAppts.length });
    }

    // ─── Monthly data (current month by day) ───────────────────────────────
    const mStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const mLastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentMonthDailyData: { label: string; value: number; apptCount: number }[] = [];
    for (let d = 1; d <= mLastDay; d++) {
      const dStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dAppts = completedAppts.filter((a) => a.date === dStr);
      const dRev = dAppts.reduce((sum, a) => {
        if (a.totalPrice != null) return sum + a.totalPrice;
        const svc = state.services.find((s) => s.id === a.serviceId);
        return sum + (svc?.price ?? 0);
      }, 0);
      const allDAppts = filterByLocation(state.appointments).filter((a) => a.date === dStr && a.status !== "cancelled");
      currentMonthDailyData.push({ label: String(d), value: Math.round(dRev), apptCount: allDAppts.length });
    }

    // ─── 12-month yearly data ──────────────────────────────────────────────
    const yearlyMonthlyData: { label: string; value: number; apptCount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStr = d.toLocaleDateString("en-US", { month: "short" });
      const mS = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const mLD = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const mE = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(mLD).padStart(2, "0")}`;
      const mRev = completedAppts.filter((a) => a.date >= mS && a.date <= mE).reduce((sum, a) => {
        if (a.totalPrice != null) return sum + a.totalPrice;
        const svc = state.services.find((s) => s.id === a.serviceId);
        return sum + (svc?.price ?? 0);
      }, 0);
      const mAppts = filterByLocation(state.appointments).filter((a) => a.date >= mS && a.date <= mE && a.status !== "cancelled").length;
      yearlyMonthlyData.push({ label: mStr, value: Math.round(mRev), apptCount: mAppts });
    }

    // 3-month data (last 3 months, monthly buckets)
    const threeMonthData = yearlyMonthlyData.slice(-3);
    const threeMonthRevenue = threeMonthData.reduce((s, d) => s + d.value, 0);

    // 6-month data (last 6 months, monthly buckets)
    const sixMonthData = yearlyMonthlyData.slice(-6);
    const sixMonthRevenue = sixMonthData.reduce((s, d) => s + d.value, 0);

    return {
      totalClients,
      totalAppointments,
      totalRevenue,
      weekRevenue,
      prevWeekRevenue,
      monthlyData,
      weeklyDailyData,
      serviceBreakdown,
      statusCounts,
      filteredAppts,
      topService,
      topCount,
      paidRevenue,
      unpaidRevenue,
      paidCount,
      unpaidCount,
      methodBreakdown,
      upcomingThisWeek,
      weekConfirmed,
      weekPending,
      upcomingDailyData,
      yearlyRevenue,
      todayRevenue,
      todayCompletedCount,
      hourlyData,
      currentMonthDailyData,
      yearlyMonthlyData,
      threeMonthData,
      threeMonthRevenue,
      sixMonthData,
      sixMonthRevenue,
      CHART_COLOR,
      mStart,
    };
  }, [state.clients, state.appointments, state.services, filterByLocation, clientsForActiveLocation, todayStr]);

  // ─── Upcoming Appointments (next 10, future dates + today future times) ──────
  const tomorrowStr = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDateStr(d);
  }, [todayStr]);

  const upcomingAppointments = useMemo(() => {
    return filterByLocation(state.appointments)
      .filter((a) => {
        if (a.status === "cancelled" || a.status === "completed") return false;
        return a.date >= tomorrowStr;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return timeToMinutes(a.time) - timeToMinutes(b.time);
      })
      .slice(0, 10);
  }, [state.appointments, filterByLocation, tomorrowStr]);

  // ─── KPI Sheet Data ─────────────────────────────────────────────────────
  const kpiClientsData = useMemo(() => {
    const filteredAppts = filterByLocation(state.appointments);
    const completedAppts = filteredAppts.filter((a) => a.status === "completed");
    const clientsData = clientsForActiveLocation.map((c) => {
      const cAppts = completedAppts.filter((a) => a.clientId === c.id);
      const totalSpent = cAppts.reduce((sum, a) => {
        if (a.totalPrice != null) return sum + a.totalPrice;
        const svc = state.services.find((s) => s.id === a.serviceId);
        return sum + (svc?.price ?? 0);
      }, 0);
      return { id: c.id, name: c.name, phone: c.phone, email: c.email, apptCount: cAppts.length, totalSpent };
    }).filter((c) => c.apptCount > 0).sort((a, b) => b.apptCount - a.apptCount);
    return { totalClients: clientsForActiveLocation.length, clientsData };
  }, [state.clients, state.appointments, state.services, filterByLocation, clientsForActiveLocation]);

  const kpiServiceRanking = useMemo(() => {
    const filteredAppts = filterByLocation(state.appointments).filter((a) => a.status !== "cancelled");
    return state.services.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      price: s.price,
      bookings: filteredAppts.filter((a) => a.serviceId === s.id).length,
    })).filter((s) => s.bookings > 0).sort((a, b) => b.bookings - a.bookings);
  }, [state.services, state.appointments, filterByLocation]);

  // ─── KPI Ranged Data (responds to date range filter in KPI sheet) ────────
  const kpiRangedData = useMemo(() => {
    const now = new Date();
    const todayStr2 = formatDateStr(now);
    let rangeStart = "";
    let rangeEnd = todayStr2;
    if (kpiDateRange === "week") {
      const s = new Date(now);
      s.setDate(now.getDate() - now.getDay());
      rangeStart = formatDateStr(s);
    } else if (kpiDateRange === "month") {
      rangeStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    } else {
      rangeStart = "2000-01-01";
    }

    const allAppts = filterByLocation(state.appointments);
    const rangedAppts = allAppts.filter((a) => a.date >= rangeStart && a.date <= rangeEnd);
    const completedRanged = rangedAppts.filter((a) => a.status === "completed");
    const activeRanged = rangedAppts.filter((a) => a.status !== "cancelled");

    const getPrice = (a: (typeof state.appointments)[0]) => {
      if (a.totalPrice != null) return a.totalPrice;
      return state.services.find((s) => s.id === a.serviceId)?.price ?? 0;
    };

    const weekRevenue = completedRanged.reduce((s, a) => s + getPrice(a), 0);
    const totalRevenue = allAppts.filter((a) => a.status === "completed").reduce((s, a) => s + getPrice(a), 0);

    // Build 6 data points for the chart based on range
    const monthlyData: { label: string; value: number; color: string }[] = [];
    const mColors = ["#4CAF50", "#2196F3", "#FF9800", "#9C27B0", "#E91E63", "#00BCD4"];
    if (kpiDateRange === "week") {
      const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - now.getDay() + i);
        const dStr = formatDateStr(d);
        const rev = completedRanged.filter((a) => a.date === dStr).reduce((s, a) => s + getPrice(a), 0);
        monthlyData.push({ label: days[i], value: Math.round(rev), color: mColors[i % 6] });
      }
    } else if (kpiDateRange === "month") {
      for (let w = 0; w < 4; w++) {
        const wStart = new Date(now.getFullYear(), now.getMonth(), w * 7 + 1);
        const wEnd = new Date(now.getFullYear(), now.getMonth(), Math.min((w + 1) * 7, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));
        const rev = completedRanged.filter((a) => a.date >= formatDateStr(wStart) && a.date <= formatDateStr(wEnd)).reduce((s, a) => s + getPrice(a), 0);
        monthlyData.push({ label: `Wk${w + 1}`, value: Math.round(rev), color: mColors[w] });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mStr = d.toLocaleDateString("en-US", { month: "short" });
        const mStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const mEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        const rev = allAppts.filter((a) => a.status === "completed" && a.date >= mStart && a.date <= mEnd).reduce((s, a) => s + getPrice(a), 0);
        monthlyData.push({ label: mStr, value: Math.round(rev), color: mColors[5 - i] });
      }
    }

    const weeklyDailyData = monthlyData.map((d) => ({ ...d, apptCount: activeRanged.filter((a) => a.date === d.label).length }));

    const svcCounts: Record<string, number> = {};
    activeRanged.forEach((a) => { svcCounts[a.serviceId] = (svcCounts[a.serviceId] || 0) + 1; });
    const serviceBreakdown = state.services.map((s) => ({ label: s.name, value: svcCounts[s.id] || 0, color: s.color }))
      .filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

    const statusCounts = {
      pending: rangedAppts.filter((a) => a.status === "pending").length,
      confirmed: rangedAppts.filter((a) => a.status === "confirmed").length,
      completed: completedRanged.length,
      cancelled: rangedAppts.filter((a) => a.status === "cancelled").length,
    };

    const clientsData = clientsForActiveLocation.map((c) => {
      const cAppts = completedRanged.filter((a) => a.clientId === c.id);
      const totalSpent = cAppts.reduce((s, a) => s + getPrice(a), 0);
      return { id: c.id, name: c.name, phone: c.phone, email: c.email, apptCount: cAppts.length, totalSpent };
    }).filter((c) => c.apptCount > 0).sort((a, b) => b.apptCount - a.apptCount);

    const serviceRanking = state.services.map((s) => ({
      id: s.id, name: s.name, color: s.color, price: s.price,
      bookings: activeRanged.filter((a) => a.serviceId === s.id).length,
    })).filter((s) => s.bookings > 0).sort((a, b) => b.bookings - a.bookings);

    const topSvc = serviceRanking[0];

    return {
      revenueData: { weekRevenue, prevWeekRevenue: 0, totalRevenue, monthlyData, weeklyDailyData, serviceBreakdown },
      appointmentsData: { totalAppointments: activeRanged.length, statusCounts, weeklyDailyData, serviceBreakdown },
      clientsData: { totalClients: clientsForActiveLocation.length, clientsData },
      topServiceData: {
        topService: topSvc ? state.services.find((s) => s.id === topSvc.id) ?? undefined : undefined,
        topCount: topSvc?.bookings ?? 0,
        serviceRanking,
      },
    };
  }, [kpiDateRange, state.appointments, state.services, filterByLocation, clientsForActiveLocation]);

  // ─── Revenue Forecast (current month) ────────────────────────────────────
  const revenueForecast = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const mStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const mEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    const todayStr2 = formatDateStr(now);
    // Revenue earned so far this month (completed)
    const completedThisMonth = filterByLocation(state.appointments).filter(
      (a) => a.status === "completed" && a.date >= mStart && a.date <= mEnd
    );
    const earnedSoFar = completedThisMonth.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);
    // Revenue from upcoming confirmed/pending appointments this month
    const scheduledThisMonth = filterByLocation(state.appointments).filter(
      (a) => (a.status === "confirmed" || a.status === "pending") && a.date > todayStr2 && a.date <= mEnd
    );
    const scheduledRevenue = scheduledThisMonth.reduce((sum, a) => {
      if (a.totalPrice != null) return sum + a.totalPrice;
      const svc = state.services.find((s) => s.id === a.serviceId);
      return sum + (svc?.price ?? 0);
    }, 0);
    // Projected end-of-month based on daily run-rate
    const dailyRate = dayOfMonth > 0 ? earnedSoFar / dayOfMonth : 0;
    const remainingDays = daysInMonth - dayOfMonth;
    const projected = Math.round(earnedSoFar + dailyRate * remainingDays);
    const goal = state.settings.monthlyRevenueGoal ?? 0;
    const progressPct = goal > 0 ? Math.min(100, Math.round((earnedSoFar / goal) * 100)) : 0;
    const projectedPct = goal > 0 ? Math.min(100, Math.round((projected / goal) * 100)) : 0;
    const monthName = now.toLocaleDateString("en-US", { month: "long" });
    return { earnedSoFar, scheduledRevenue, projected, goal, progressPct, projectedPct, monthName, daysInMonth, dayOfMonth, remainingDays };
  }, [state.appointments, state.services, state.settings.monthlyRevenueGoal, filterByLocation]);

  // ─── KPI Slide Data (extra computed values for swipeable cards) ────────────
  const kpiSlideData = useMemo(() => {
    const allAppts = filterByLocation(state.appointments);
    const now2 = new Date();
    const todayStr2 = formatDateStr(now2);

    // Earnings: today, week, month, year, all-time
    const getPrice = (a: (typeof allAppts)[0]) => {
      if (a.totalPrice != null) return a.totalPrice;
      return state.services.find((s) => s.id === a.serviceId)?.price ?? 0;
    };
    const completed = allAppts.filter((a) => a.status === "completed");
    const todayEarnings = completed.filter((a) => a.date === todayStr2).reduce((s, a) => s + getPrice(a), 0);
    const startOfWeek2 = new Date(now2); startOfWeek2.setDate(now2.getDate() - now2.getDay());
    const endOfWeek2 = new Date(startOfWeek2); endOfWeek2.setDate(startOfWeek2.getDate() + 6);
    const weekEarnings = completed.filter((a) => a.date >= formatDateStr(startOfWeek2) && a.date <= formatDateStr(endOfWeek2)).reduce((s, a) => s + getPrice(a), 0);
    const mStart2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-01`;
    const mLastDay = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
    const mEnd2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-${String(mLastDay).padStart(2, "0")}`;
    const monthEarnings = completed.filter((a) => a.date >= mStart2 && a.date <= mEnd2).reduce((s, a) => s + getPrice(a), 0);
    const yearEarnings = completed.filter((a) => a.date >= `${now2.getFullYear()}-01-01` && a.date <= `${now2.getFullYear()}-12-31`).reduce((s, a) => s + getPrice(a), 0);
    const allTimeEarnings = completed.reduce((s, a) => s + getPrice(a), 0);

    // Appointments: today, week, month, year, total
    const activeAppts2 = allAppts.filter((a) => a.status !== "cancelled");
    const todayApptCount = activeAppts2.filter((a) => a.date === todayStr2).length;
    const weekApptCount = activeAppts2.filter((a) => a.date >= formatDateStr(startOfWeek2) && a.date <= formatDateStr(endOfWeek2)).length;
    const monthApptCount = activeAppts2.filter((a) => a.date >= mStart2 && a.date <= mEnd2).length;
    const yearApptCount = activeAppts2.filter((a) => a.date >= `${now2.getFullYear()}-01-01` && a.date <= `${now2.getFullYear()}-12-31`).length;
    const totalApptCount = activeAppts2.length;

    // Clients: top clients, recently added, upcoming birthdays next month
    const clientsAll = clientsForActiveLocation;
    const clientApptCounts: Record<string, number> = {};
    const clientSpend: Record<string, number> = {};
    completed.forEach((a) => {
      clientApptCounts[a.clientId] = (clientApptCounts[a.clientId] || 0) + 1;
      clientSpend[a.clientId] = (clientSpend[a.clientId] || 0) + getPrice(a);
    });
    const topClients = [...clientsAll]
      .filter((c) => clientApptCounts[c.id] > 0)
      .sort((a, b) => (clientSpend[b.id] || 0) - (clientSpend[a.id] || 0))
      .slice(0, 3)
      .map((c) => ({ ...c, apptCount: clientApptCounts[c.id] || 0, totalSpent: clientSpend[c.id] || 0 }));
    const recentlyAdded = [...clientsAll]
      .sort((a, b) => ((b as any).createdAt || "") > ((a as any).createdAt || "") ? 1 : -1)
      .slice(0, 3)
      .map((c) => ({ ...c, apptCount: clientApptCounts[c.id] || 0, totalSpent: clientSpend[c.id] || 0 }));
    const nextMonthIdx = (now2.getMonth() + 1) % 12;
    const nextMonthStr = String(nextMonthIdx + 1).padStart(2, "0");
    const birthdayNextMonth = clientsAll.filter((c) => {
      if (!c.birthday) return false;
      const parts = c.birthday.replace(/-/g, "/").split("/");
      if (parts.length < 2) return false;
      return parts[0].padStart(2, "0") === nextMonthStr;
    });

    // Services: top 3 this week, top 5 this month
    const weekAppts2 = activeAppts2.filter((a) => a.date >= formatDateStr(startOfWeek2) && a.date <= formatDateStr(endOfWeek2));
    const monthAppts2 = activeAppts2.filter((a) => a.date >= mStart2 && a.date <= mEnd2);
    const svcCountWeek: Record<string, number> = {};
    weekAppts2.forEach((a) => { svcCountWeek[a.serviceId] = (svcCountWeek[a.serviceId] || 0) + 1; });
    const svcCountMonth: Record<string, number> = {};
    monthAppts2.forEach((a) => { svcCountMonth[a.serviceId] = (svcCountMonth[a.serviceId] || 0) + 1; });
    const top3Week = state.services
      .map((s) => ({ name: s.name, count: svcCountWeek[s.id] || 0, color: s.color }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const top5Month = state.services
      .map((s) => ({ name: s.name, count: svcCountMonth[s.id] || 0, color: s.color }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Per-period pending counts for accurate sublabels
    const todayPendingCount = allAppts.filter((a) => a.status === "pending" && a.date === todayStr2).length;
    const weekPendingCount = allAppts.filter((a) => a.status === "pending" && a.date >= formatDateStr(startOfWeek2) && a.date <= formatDateStr(endOfWeek2)).length;
    const monthConfirmedCount = allAppts.filter((a) => a.status === "confirmed" && a.date >= mStart2 && a.date <= mEnd2).length;
    const yearCompletedCount = allAppts.filter((a) => a.status === "completed" && a.date >= `${now2.getFullYear()}-01-01` && a.date <= `${now2.getFullYear()}-12-31`).length;

    // Helper to build appointment row data
    const buildApptRow = (a: (typeof allAppts)[0]) => {
      const client = clientsAll.find((c) => c.id === a.clientId);
      const service = state.services.find((s) => s.id === a.serviceId);
      return {
        id: a.id,
        clientName: client?.name ?? "Unknown",
        serviceName: service?.name ?? "Service",
        time: a.time,
        date: a.date,
        status: a.status,
        price: getPrice(a),
      };
    };
    const buildCompletedRow = (a: (typeof allAppts)[0]) => ({
      id: a.id,
      clientName: clientsAll.find((c) => c.id === a.clientId)?.name ?? "Unknown",
      serviceName: state.services.find((s) => s.id === a.serviceId)?.name ?? "Service",
      date: a.date,
      price: getPrice(a),
    });

    // Filtered appointment lists for each period
    const todayApptList = activeAppts2.filter((a) => a.date === todayStr2).map(buildApptRow);
    const weekApptList = weekAppts2.map(buildApptRow);
    const monthApptList = monthAppts2.map(buildApptRow);
    const yearApptList = activeAppts2.filter((a) => a.date >= `${now2.getFullYear()}-01-01` && a.date <= `${now2.getFullYear()}-12-31`).map(buildApptRow);

    // Completed appointments for revenue filtered views
    const todayCompletedList = completed.filter((a) => a.date === todayStr2).map(buildCompletedRow);
    const weekCompletedList = completed.filter((a) => a.date >= formatDateStr(startOfWeek2) && a.date <= formatDateStr(endOfWeek2)).map(buildCompletedRow);
    const monthCompletedList = completed.filter((a) => a.date >= mStart2 && a.date <= mEnd2).map(buildCompletedRow);
    const yearCompletedList = completed.filter((a) => a.date >= `${now2.getFullYear()}-01-01` && a.date <= `${now2.getFullYear()}-12-31`).map(buildCompletedRow);
    const allTimeCompletedList = completed.map(buildCompletedRow);

    return {
      todayEarnings, weekEarnings, monthEarnings, yearEarnings, allTimeEarnings,
      todayApptCount, weekApptCount, monthApptCount, yearApptCount, totalApptCount,
      todayPendingCount, weekPendingCount, monthConfirmedCount, yearCompletedCount,
      topClients, recentlyAdded, birthdayNextMonth,
      top3Week, top5Month,
      todayApptList, weekApptList, monthApptList, yearApptList,
      todayCompletedList, weekCompletedList, monthCompletedList, yearCompletedList, allTimeCompletedList,
    };
  }, [state.appointments, state.services, filterByLocation, clientsForActiveLocation]);

  const pendingCount = analytics.statusCounts.pending;
  const revenueChange =
    analytics.prevWeekRevenue > 0
      ? Math.round(
          ((analytics.weekRevenue - analytics.prevWeekRevenue) /
            analytics.prevWeekRevenue) *
            100
        )
      : analytics.weekRevenue > 0
      ? 100
      : 0;

  const doShareForLocation = useCallback(async (loc: typeof activeLocation) => {
    const slug = state.settings.customSlug || state.settings.businessName.replace(/\s+/g, "-").toLowerCase();
    // Always use base URL — client selects location as the first step in the booking flow
    const url = `${PUBLIC_BOOKING_URL}/book/${slug}`;
    const profile = state.settings.profile;
    // Use full address (street + city + state + zip) for the share message
    const displayAddress = loc
      ? formatFullAddress(loc.address, loc.city, loc.state, loc.zipCode)
      : formatFullAddress(profile.address, profile.city, profile.state, profile.zipCode);
    const addressLine = displayAddress ? `\n📍 ${displayAddress}` : "";
    const rawPhone = loc?.phone || profile.phone;
    const phoneLine = rawPhone ? `\n📞 ${formatPhoneNumber(rawPhone)}` : "";
    const websiteLine = profile.website ? `\n🌐 ${profile.website}` : "";
    try {
      if (Platform.OS === "web") {
        // Web: use navigator.share if available, otherwise copy to clipboard
        const shareData = {
          title: "Book an Appointment",
          text: `Book an appointment with ${state.settings.businessName}!${addressLine}${phoneLine}${websiteLine}\n\nSchedule online: ${url}\n\nPowered by Lime Of Time`,
        };
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share(shareData);
        } else {
          const { default: Clipboard } = await import("expo-clipboard");
          await Clipboard.setStringAsync(url);
          Alert.alert("Link Copied!", "Booking link copied to clipboard.");
        }
      } else {
        await Share.share({
          message: `Book an appointment with ${state.settings.businessName}!${addressLine}${phoneLine}${websiteLine}\n\nSchedule online: ${url}\n\nPowered by Lime Of Time`,
          title: "Book an Appointment",
        });
      }
    } catch {}
  }, [state.settings, activeLocation]);

  const handleShareBookingLink = useCallback(() => {
    // Always share the base booking URL — client selects location as the first step
    doShareForLocation(null);
  }, [doShareForLocation]);

  const handlePickLogo = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Image upload is available on mobile devices.");
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const localUri = result.assets[0].uri;
        const mimeType = result.assets[0].mimeType ?? "image/jpeg";
        // Optimistically update UI with local URI immediately
        const optimisticAction = {
          type: "UPDATE_SETTINGS" as const,
          payload: { businessLogoUri: localUri },
        };
        dispatch(optimisticAction);
        // Upload to cloud storage so the URL persists across deployments
        setUploadingLogo(true);
        try {
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const { url } = await uploadImageMut.mutateAsync({ base64, mimeType, folder: "logos" });
          // Replace local URI with permanent cloud URL in store + DB
          const cloudAction = {
            type: "UPDATE_SETTINGS" as const,
            payload: { businessLogoUri: url },
          };
          dispatch(cloudAction);
          syncToDb(cloudAction);
        } catch {
          // Upload failed — keep local URI in store but still sync so it works on this device
          syncToDb(optimisticAction);
        } finally {
          setUploadingLogo(false);
        }
      }
    } catch {
      Alert.alert("Error", "Failed to pick image. Please try again.");
    }
  }, [dispatch, syncToDb, uploadImageMut]);

  const getEndTime = (time: string, duration: number) => {
    return formatTime(minutesToTime(timeToMinutes(time) + duration));
  };

  const { planInfo } = usePlanLimitCheck();
  const isFreeplan = !planInfo || planInfo.planKey === "solo";
  const isStripePlan = planInfo && (planInfo.planKey === "studio" || planInfo.planKey === "enterprise");
  // ─── Scroll to top on every focus ────────────────────────────────
  const mainScrollRef = useScrollToTopOnFocus<ScrollView>();
  // ─── Over-limit warnings (grace period) ──────────────────────────
  const { data: overLimitData } = trpc.subscription.getOverLimitWarnings.useQuery(
    { businessOwnerId: state.businessOwnerId! },
    { enabled: !!state.businessOwnerId, staleTime: 5 * 60 * 1000 }
  );
  // ─── Overview mode: "kpi" = 4-card grid, "dayweek" = Day/Week card ──
  const [overviewMode, setOverviewMode] = useState<"kpi" | "dayweek">("kpi");
  // Measured heights for each view (set via onLayout)
  const kpiMeasuredHeight = useRef(0);
  const dayWeekMeasuredHeight = useRef(0);
  // Track whether we have a first measurement yet
  const overviewHeightInitialized = useRef(false);
  // Animated container height — start at 0, set on first layout
  const overviewHeightAnim = useRef(new Animated.Value(0)).current;
  const [overviewHeightReady, setOverviewHeightReady] = useState(false);
  // Animated value: 0 = KPI visible, 1 = DayWeek visible
  const overviewAnim = useRef(new Animated.Value(0)).current;
  const switchOverviewMode = useCallback(
    (next: "kpi" | "dayweek") => {
      setOverviewMode(next);
      const targetH = next === "dayweek" ? dayWeekMeasuredHeight.current : kpiMeasuredHeight.current;
      Animated.parallel([
        Animated.timing(overviewAnim, {
          toValue: next === "dayweek" ? 1 : 0,
          duration: 260,
          useNativeDriver: true,
        }),
        ...(targetH > 0 ? [Animated.timing(overviewHeightAnim, {
          toValue: targetH,
          duration: 280,
          useNativeDriver: false,
        })] : []),
      ]).start();
    },
    [overviewAnim, overviewHeightAnim]
  );
  // Derived animated styles
  const kpiAnimStyle = {
    opacity: overviewAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateY: overviewAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) }],
  };
  const dayWeekAnimStyle = {
    opacity: overviewAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [{ translateY: overviewAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };

  const [overLimitDismissed, setOverLimitDismissed] = useState(false);
  const stripeConnected = !!(state.settings as any).stripeConnectEnabled;

  // ─── Stripe Balance (Studio/Enterprise plan only) ──────────────
  const [stripeBalance, setStripeBalance] = useState<{ available: number; pending: number } | null>(null);
  const [stripeBalanceLoading, setStripeBalanceLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isStripePlan || !stripeConnected || !state.businessOwnerId) return;
      setStripeBalanceLoading(true);
      apiCall<{ available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] }>(
        `/api/stripe-connect/balance?businessOwnerId=${state.businessOwnerId}`
      )
        .then((data) => {
          if (data) {
            const avail = (data.available ?? []).reduce((s: number, b: { amount: number }) => s + b.amount, 0) / 100;
            const pend = (data.pending ?? []).reduce((s: number, b: { amount: number }) => s + b.amount, 0) / 100;
            setStripeBalance({ available: avail, pending: pend });
          }
        })
        .catch(() => {})
        .finally(() => setStripeBalanceLoading(false));
    }, [isStripePlan, stripeConnected, state.businessOwnerId])
  );

  const handleKpiExport = useCallback(async (tab: KpiTab) => {
    if (isFreeplan) {
      Alert.alert(
        "Upgrade Required",
        "PDF exports are available on the Growth and Pro plans.",
        [
          { text: "Not Now", style: "cancel" },
          { text: "View Plans", onPress: () => router.push("/subscription" as any) },
        ]
      );
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "PDF export is available on mobile devices.");
      return;
    }
    try {
      const { generateRevenuePdf, generateAppointmentsPdf, generateClientsPdf, generateServicesPdf, exportPdf } = await import("@/lib/pdf-export");
      const businessName = state.settings.businessName || "Business";
      const locationName = activeLocation?.name;
      const locationAddress = activeLocation?.address;
      const filteredAppts = filterByLocation(state.appointments);
      const filteredClients = clientsForActiveLocation;
      const accent = "#4A7C59";
      let html = "";
      let filename = "";
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      if (tab === "revenue") {
        html = generateRevenuePdf(businessName, filteredAppts, state.services, accent, locationName, locationAddress);
        filename = `Revenue_Report_${dateStr}.pdf`;
      } else if (tab === "appointments") {
        html = generateAppointmentsPdf(businessName, filteredAppts, state.services, state.clients, accent, locationName, locationAddress);
        filename = `Appointments_Report_${dateStr}.pdf`;
      } else if (tab === "clients") {
        html = generateClientsPdf(businessName, filteredClients, accent, locationName, locationAddress);
        filename = `Clients_Report_${dateStr}.pdf`;
      } else if (tab === "topservice") {
        html = generateServicesPdf(businessName, state.services, filteredAppts, accent, locationName, locationAddress);
        filename = `Services_Report_${dateStr}.pdf`;
      }
      if (html) await exportPdf(html, filename);
    } catch (e) {
      Alert.alert("Export Failed", "Could not generate the report. Please try again.");
    }
  }, [state, activeLocation, filterByLocation, clientsForActiveLocation, isFreeplan, router]);

  const logoSource = state.settings.businessLogoUri
    ? { uri: state.settings.businessLogoUri }
    : require("@/assets/images/icon.png");

  return (
    <ScreenContainer tabletMaxWidth={0}>
      {/* ─── Animated gradient orbs background ──────────────────────── */}
      <FuturisticBackground />
      <ScrollView
        ref={mainScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: hp,
          paddingTop: 8,
          paddingBottom: 100,
          maxWidth: maxContentWidth,
          alignSelf: "center",
          width: "100%",
        }}
      >
        {/* ─── Business Header ──────────────────────────────────── */}
        <LinearGradient
          colors={[colors.primary + "18", colors.primary + "05"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.headerGradientBanner, { borderColor: colors.primary + "20" }]}
        >
          {/* App logo watermark — decorative background */}
          <Image
            source={require("@/assets/images/icon.png")}
            style={{
              position: "absolute",
              right: -14,
              bottom: -14,
              width: 120,
              height: 120,
              opacity: 0.06,
              borderRadius: 24,
            }}
            resizeMode="cover"
          />
          <View style={styles.businessHeader}>
            <Pressable
              onPress={handlePickLogo}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <Image source={logoSource} style={[styles.businessLogo, uploadingLogo && { opacity: 0.5 }]} resizeMode="cover" />
              <View style={[styles.cameraOverlay, { backgroundColor: colors.primary }]}>
                {uploadingLogo
                  ? <ActivityIndicator size={10} color="#FFF" />
                  : <IconSymbol name="photo" size={10} color="#FFF" />}
              </View>
            </Pressable>
            <View style={styles.headerTextWrap}>
              <Text
                style={[styles.businessName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {state.settings.businessName}
              </Text>
              <Text style={[styles.greetingText, { color: colors.muted }]}>{greeting}</Text>
            </View>
            {/* Bell icon + Live clock widget — right side of header */}
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              {/* Bell notification button */}
              <Pressable
                onPress={() => router.push("/notification-inbox" as any)}
                style={({ pressed }) => ({
                  position: "relative",
                  padding: 4,
                  marginBottom: 2,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name="notifications-outline" size={22} color={colors.primary} />
                {(() => {
                  const pendingCount = state.appointments.filter((a) => a.status === "pending").length;
                  const unreadCount = (state.inboxNotifications ?? []).filter((n) => !n.read).length;
                  const total = Math.min(pendingCount + unreadCount, 99);
                  if (total === 0) return null;
                  return (
                    <View style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: colors.error,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 3,
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>
                        {total > 99 ? "99+" : String(total)}
                      </Text>
                    </View>
                  );
                })()}
              </Pressable>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.primary, letterSpacing: 0.5, fontVariant: ["tabular-nums"] }}>
                {liveTimeStr.replace(/ (AM|PM)$/, "")}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>
                {liveTimeStr.match(/(AM|PM)$/)?.[0] ?? ""}
              </Text>
              {state.settings.temporaryClosed && (
                <View style={[styles.closedBadge, { backgroundColor: colors.error + "15" }]}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: colors.error }}>CLOSED</Text>
                </View>
              )}
            </View>
          </View>
          <View style={{ marginTop: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[styles.dateLabel, { color: colors.muted }]}>{dateLabel}</Text>
              {analytics.todayRevenue > 0 && (
                <Pressable
                  onPress={() => router.push({ pathname: "/analytics-detail", params: { tab: "overview" } } as any)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: colors.success + "20",
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderWidth: 1,
                    borderColor: colors.success + "40",
                    gap: 4,
                    opacity: pressed ? 0.7 : 1,
                  })}>
                  <Text style={{ fontSize: 10, color: colors.success + "CC" }}>
                    {analytics.todayCompletedCount} appt{analytics.todayCompletedCount !== 1 ? "s" : ""}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.success + "80" }}>·</Text>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.success }}>
                    ${analytics.todayRevenue.toFixed(0)} today
                  </Text>
                </Pressable>
              )}
            </View>
            {/* 7-day revenue sparkline */}
            {analytics.weeklyDailyData.some((d) => d.value > 0) && (
              <Pressable
                onPress={() => router.push({ pathname: "/analytics-detail", params: { tab: "overview" } } as any)}
                style={{ marginTop: 6, opacity: 0.72 }}
              >
                <MicroBarSpark
                  data={analytics.weeklyDailyData.map((d) => d.value)}
                  w={contentWidth - 32}
                  h={22}
                  color={colors.success}
                />
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 1 }}>
                  {analytics.weeklyDailyData.map((d, i) => (
                    <Text key={i} style={{ fontSize: 8, color: colors.muted + "99", flex: 1, textAlign: "center" }}>{d.label}</Text>
                  ))}
                </View>
              </Pressable>
            )}
            {/* Next Appointment widget */}
            {todayAppts.length > 0 && (
              <Pressable
                onPress={() => nextAppt
                  ? router.push({ pathname: "/appointment-detail", params: { id: nextAppt.id } })
                  : router.push("/(tabs)/calendar" as any)
                }
                style={({ pressed }) => ({
                  marginTop: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: nextAppt ? colors.primary + "12" : colors.surface,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor: nextAppt ? colors.primary + "30" : colors.border,
                  gap: 8,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <IconSymbol
                  name={nextAppt ? "clock.fill" : "checkmark.circle.fill"}
                  size={14}
                  color={nextAppt ? colors.primary : colors.success}
                />
                {nextAppt ? (() => {
                  const nextClient = getClientById(nextAppt.clientId);
                  const nextSvc = getServiceById(nextAppt.serviceId);
                  const minsUntil = timeToMinutes(nextAppt.time) - (now.getHours() * 60 + now.getMinutes());
                  const hoursUntil = Math.floor(minsUntil / 60);
                  const minsRemainder = minsUntil % 60;
                  const countdownStr = hoursUntil > 0
                    ? `in ${hoursUntil}h ${minsRemainder}m`
                    : `in ${minsUntil}m`;
                  return (
                    <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                      Next: {formatTime(nextAppt.time)} · {nextSvc?.name ?? "Appointment"} · {nextClient?.name ?? "Client"} · <Text style={{ fontWeight: "800" }}>{countdownStr}</Text>
                    </Text>
                  );
                })() : (
                  <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>
                    All done for today — {todayAppts.length} appt{todayAppts.length !== 1 ? "s" : ""} completed
                  </Text>
                )}
                <IconSymbol name="chevron.right" size={12} color={nextAppt ? colors.primary + "80" : colors.success + "80"} />
              </Pressable>
            )}
          </View>

          {/* ─── Header Quick Actions ──────────────────────────────────── */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable
              onPress={() => router.push({ pathname: "/calendar-booking", params: { preselectedLocationId: selectedLocationFilter ?? "" } } as any)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: colors.primary,
                borderRadius: 12,
                paddingVertical: 10,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <IconSymbol name="plus.circle.fill" size={16} color="#fff" />
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>New Booking</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: "/(tabs)/calendar", params: { filter: "today", date: todayStr, view: "day" } } as any)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: "rgba(255,255,255,0.12)",
                borderRadius: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.2)",
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <IconSymbol name="calendar" size={16} color={colors.foreground} />
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>View Today</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* No-location setup banner */}
        {state.locations.length === 0 && (
          <Pressable
            onPress={() => router.push("/locations" as any)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 12,
              backgroundColor: colors.warning + "18",
              borderWidth: 1, borderColor: colors.warning + "50",
              borderRadius: 14, padding: 14, marginTop: 12,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.warning + "25", alignItems: "center", justifyContent: "center" }}>
              <IconSymbol name="location.fill" size={20} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.warning, marginBottom: 2 }}>No Location Added</Text>
              <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 17 }}>Add your business address to start accepting bookings. Tap here to set up your first location.</Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        )}

        {/* Push Permission Denied Banner */}
        {pushDenied && Platform.OS !== "web" && (
          <Pressable
            onPress={() => Linking.openSettings()}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 12,
              backgroundColor: colors.warning + "18",
              borderWidth: 1, borderColor: colors.warning + "50",
              borderRadius: 14, padding: 14, marginTop: 12,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.warning + "25", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="notifications-off-outline" size={20} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.warning, marginBottom: 2 }}>Notifications Disabled</Text>
              <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 17 }}>You won’t receive booking alerts. Tap here to enable notifications in Settings.</Text>
            </View>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.warning }}>Fix →</Text>
          </Pressable>
        )}

        {/* Location Filter */}
        {hasMultipleLocations && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 4 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable
                onPress={() => setActiveLocation(null)}
                style={({ pressed }) => [{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 16,
                  borderWidth: 1,
                  backgroundColor: !selectedLocationFilter ? colors.primary + "15" : colors.surface,
                  borderColor: !selectedLocationFilter ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: !selectedLocationFilter ? colors.primary : colors.muted }}>All Locations</Text>
              </Pressable>
              {activeLocations.map((loc) => (
                <Pressable
                  key={loc.id}
                  onPress={() => setActiveLocation(loc.id)}
                  style={({ pressed }) => [{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 16,
                    borderWidth: 1,
                    backgroundColor: selectedLocationFilter === loc.id ? colors.primary + "15" : colors.surface,
                    borderColor: selectedLocationFilter === loc.id ? colors.primary : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  }]}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: selectedLocationFilter === loc.id ? colors.primary : colors.muted }}>{loc.name}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Pending badge */}
        {pendingCount > 0 && (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(tabs)/bookings",
                params: { filter: "requests" },
              })
            }
            style={({ pressed }) => [
              styles.pendingBanner,
              {
                backgroundColor: "#FFF3E0",
                borderColor: "#FF9800",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <IconSymbol name="clock.badge.fill" size={20} color="#FF9800" />
            <Text style={styles.pendingText}>
              {pendingCount} appointment request{pendingCount > 1 ? "s" : ""} pending
            </Text>
            <IconSymbol name="chevron.right" size={16} color="#FF9800" />
          </Pressable>
        )}

        {/* Temporary Closed Banner — per active location */}
        {activeLocation?.temporarilyClosed && (
          <View
            style={[
              styles.closedBanner,
              {
                backgroundColor: colors.error + "15",
                borderColor: colors.error + "50",
                borderWidth: 1,
                borderRadius: 10,
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
              },
            ]}
          >
            <IconSymbol name="exclamationmark.triangle.fill" size={18} color={colors.error} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: colors.error, fontWeight: "700", marginBottom: 2 }}>
                {activeLocation.name} — Temporarily Closed
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 17 }}>
                {activeLocation.reopenOn
                  ? `This location is temporarily closed and will reopen on ${new Date(activeLocation.reopenOn + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. No new bookings are being accepted until then.`
                  : `This location is temporarily closed for an indefinite period. No new bookings are being accepted at this time. Please check back later.`}
              </Text>
            </View>
          </View>
        )}

        {/* ─── Over-Limit Grace Period Warning Banner ─────────── */}
        {overLimitData?.isInGracePeriod && (overLimitData?.warnings?.length ?? 0) > 0 && !overLimitDismissed && (
          <View style={{
            backgroundColor: "#FEF3C7",
            borderRadius: 14,
            padding: 14,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: "#F59E0B",
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400E", marginBottom: 4 }}>
                  Action Required Before {overLimitData.periodEndDate}
                </Text>
                <Text style={{ fontSize: 12, color: "#78350F", marginBottom: 8, lineHeight: 18 }}>
                  Your plan downgrades to {overLimitData.scheduledPlanKey?.charAt(0).toUpperCase()}{overLimitData.scheduledPlanKey?.slice(1)} on {overLimitData.periodEndDate}. Reduce the following to avoid automatic removal:
                </Text>
                {overLimitData.warnings.map((w: { resource: string; current: number; limit: number; route: string }) => (
                  <Pressable
                    key={w.resource}
                    onPress={() => router.push(w.route as any)}
                    style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, flexDirection: "row", alignItems: "center", marginBottom: 4 }]}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B", marginRight: 8 }} />
                    <Text style={{ fontSize: 12, color: "#92400E", fontWeight: "600" }}>
                      {w.resource}: {w.current} / {w.limit} allowed
                    </Text>
                    <Text style={{ fontSize: 11, color: "#B45309", marginLeft: 6 }}>Tap to manage ›</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => setOverLimitDismissed(true)}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 4, marginLeft: 8 }]}
              >
                <Text style={{ fontSize: 18, color: "#92400E", fontWeight: "300" }}>×</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push("/subscription" as any)}
              style={({ pressed }) => [{
                marginTop: 10,
                backgroundColor: "#F59E0B",
                borderRadius: 8,
                paddingVertical: 8,
                paddingHorizontal: 14,
                alignSelf: "flex-start",
                opacity: pressed ? 0.8 : 1,
              }]}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#FFFFFF" }}>Keep Current Plan</Text>
            </Pressable>
          </View>
        )}
        {/* ─── KPI Cards (swipeable groups) ─────────────────── */}
        {/* Overview header with mode toggle */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 32, marginBottom: 2 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 0 }]}>Overview</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable
              onPress={() => switchOverviewMode("kpi")}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: overviewMode === "kpi" ? colors.primary : colors.border,
                backgroundColor: overviewMode === "kpi" ? colors.primary + "18" : colors.surface,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <IconSymbol name="square.grid.2x2" size={16} color={overviewMode === "kpi" ? colors.primary : colors.muted} />
            </Pressable>
            <Pressable
              onPress={() => switchOverviewMode("dayweek")}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: overviewMode === "dayweek" ? colors.primary : colors.border,
                backgroundColor: overviewMode === "dayweek" ? colors.primary + "18" : colors.surface,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <IconSymbol name="calendar.day.timeline.left" size={16} color={overviewMode === "dayweek" ? colors.primary : colors.muted} />
            </Pressable>
          </View>
        </View>

        {/* Overview content switcher — crossfade between KPI grid and Day/Week card */}
        {/* Animated height container — expands/contracts when switching modes */}
        <Animated.View
          style={[
            { overflow: "hidden" },
            overviewHeightReady ? { height: overviewHeightAnim } : {},
          ]}
        >
          {/* 4-KPI grid */}
          <Animated.View
            style={kpiAnimStyle}
            pointerEvents={overviewMode === "kpi" ? "auto" : "none"}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) {
                kpiMeasuredHeight.current = h;
                if (overviewMode === "kpi") {
                  overviewHeightAnim.setValue(h);
                  if (!overviewHeightInitialized.current) {
                    overviewHeightInitialized.current = true;
                    setOverviewHeightReady(true);
                  }
                }
              }
            }}
          >
          <View style={[styles.kpiGrid, { gap: cardGap, marginTop: 8 }]}>
          {/* ── Earnings Card (5 slides: Today / Week / Month / Year / All Time) ── */}
          <SwipeableKpiCard
            width={cardW}
            slides={[
              {
                gradientColors: ["#E65100", "#FF9800"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="dollarsign.circle.fill" size={22} color="#FFF" />,
                value: `$${Math.round(kpiSlideData.todayEarnings).toLocaleString()}`,
                numericValue: Math.round(kpiSlideData.todayEarnings),
                valuePrefix: "$",
                label: "Today's Earnings",
                sublabel: `$${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`,
                sparkData: analytics.weeklyDailyData.map((d) => d.value),
                sparkType: "line",
                onPress: () => { setKpiDetailTab("revenue"); setKpiSlideFilter("today"); setKpiSlideExtraData({ label: "Today's Earnings", value: Math.round(kpiSlideData.todayEarnings), sublabel: `vs $${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`, completedAppointments: kpiSlideData.todayCompletedList }); },
              },
              {
                gradientColors: ["#E65100", "#FF9800"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="dollarsign.circle.fill" size={22} color="#FFF" />,
                value: `$${Math.round(kpiSlideData.weekEarnings).toLocaleString()}`,
                numericValue: Math.round(kpiSlideData.weekEarnings),
                valuePrefix: "$",
                label: "This Week",
                sublabel: `$${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`,
                badge: revenueChange !== 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, backgroundColor: revenueChange > 0 ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.18)" }}>
                    <IconSymbol name={revenueChange > 0 ? "arrow.up.right" : "arrow.down.right"} size={10} color="#FFF" />
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFF" }}>{Math.abs(revenueChange)}%</Text>
                  </View>
                ) : undefined,
                sparkData: analytics.weeklyDailyData.map((d) => d.value),
                sparkType: "line",
                onPress: () => { setKpiDetailTab("revenue"); setKpiSlideFilter("week"); setKpiSlideExtraData({ label: "This Week's Earnings", value: Math.round(kpiSlideData.weekEarnings), sublabel: revenueChange !== 0 ? `${revenueChange >= 0 ? "+" : ""}${revenueChange}% vs last week` : undefined, completedAppointments: kpiSlideData.weekCompletedList }); },
              },
              {
                gradientColors: ["#BF360C", "#FF7043"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="dollarsign.circle.fill" size={22} color="#FFF" />,
                value: `$${Math.round(kpiSlideData.monthEarnings).toLocaleString()}`,
                numericValue: Math.round(kpiSlideData.monthEarnings),
                valuePrefix: "$",
                label: `${new Date().toLocaleDateString("en-US", { month: "long" })} Earnings`,
                sublabel: `$${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`,
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("revenue"); setKpiSlideFilter("month"); setKpiSlideExtraData({ label: `${new Date().toLocaleDateString("en-US", { month: "long" })} Earnings`, value: Math.round(kpiSlideData.monthEarnings), sublabel: `vs $${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`, completedAppointments: kpiSlideData.monthCompletedList }); },
              },
              {
                gradientColors: ["#7B1FA2", "#CE93D8"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="dollarsign.circle.fill" size={22} color="#FFF" />,
                value: `$${Math.round(kpiSlideData.yearEarnings).toLocaleString()}`,
                numericValue: Math.round(kpiSlideData.yearEarnings),
                valuePrefix: "$",
                label: `${new Date().getFullYear()} Earnings`,
                sublabel: `$${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`,
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("revenue"); setKpiSlideFilter("year"); setKpiSlideExtraData({ label: `${new Date().getFullYear()} Earnings`, value: Math.round(kpiSlideData.yearEarnings), sublabel: `vs $${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()} all-time`, completedAppointments: kpiSlideData.yearCompletedList }); },
              },
              {
                gradientColors: ["#4A148C", "#9C27B0"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="dollarsign.circle.fill" size={22} color="#FFF" />,
                value: `$${Math.round(kpiSlideData.allTimeEarnings).toLocaleString()}`,
                numericValue: Math.round(kpiSlideData.allTimeEarnings),
                valuePrefix: "$",
                label: "All-Time Earnings",
                sublabel: `${analytics.statusCounts.completed} completed appts`,
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("revenue"); setKpiSlideFilter("alltime"); setKpiSlideExtraData({ label: "All-Time Earnings", value: Math.round(kpiSlideData.allTimeEarnings), sublabel: `${analytics.statusCounts.completed} completed appointments`, completedAppointments: kpiSlideData.allTimeCompletedList }); },
              },
            ]}
          />

          {/* ── Clients Card (4 slides: Total / Top Clients / Recently Added / Birthdays) ── */}
          <SwipeableKpiCard
            width={cardW}
            slides={[
              {
                gradientColors: ["#1B5E20", "#66BB6A"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="person.2.fill" size={22} color="#FFF" />,
                value: String(analytics.totalClients),
                numericValue: analytics.totalClients,
                label: "Total Clients",
                sublabel: `${kpiClientsData.clientsData.length} active`,
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("clients"); setKpiSlideFilter(null); setKpiSlideExtraData(undefined); },
              },
              {
                gradientColors: ["#1B5E20", "#66BB6A"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="person.2.fill" size={22} color="#FFF" />,
                value: kpiSlideData.topClients.length > 0 ? kpiSlideData.topClients[0].name.split(" ")[0] : "—",
                label: "Top Clients",
                sublabel: kpiSlideData.topClients.length > 0
                  ? kpiSlideData.topClients.map((c) => c.name.split(" ")[0]).join(" · ")
                  : "No data yet",
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("clients"); setKpiSlideFilter("topclients"); setKpiSlideExtraData({ clients: kpiSlideData.topClients.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, apptCount: c.apptCount, totalSpent: c.totalSpent, birthday: c.birthday })) }); },
              },
              {
                gradientColors: ["#2E7D32", "#81C784"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="person.badge.plus" size={22} color="#FFF" />,
                value: String(kpiSlideData.recentlyAdded.length),
                numericValue: kpiSlideData.recentlyAdded.length,
                label: "Recently Added",
                sublabel: kpiSlideData.recentlyAdded.length > 0
                  ? kpiSlideData.recentlyAdded.map((c) => c.name.split(" ")[0]).join(" · ")
                  : "No new clients",
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("clients"); setKpiSlideFilter("recentlyadded"); setKpiSlideExtraData({ clients: kpiSlideData.recentlyAdded.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, apptCount: c.apptCount, totalSpent: c.totalSpent, birthday: c.birthday })) }); },
              },
              {
                gradientColors: ["#1A237E", "#5C6BC0"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="gift.fill" size={22} color="#FFF" />,
                value: String(kpiSlideData.birthdayNextMonth.length),
                numericValue: kpiSlideData.birthdayNextMonth.length,
                label: `Birthdays Next Month`,
                sublabel: kpiSlideData.birthdayNextMonth.length > 0
                  ? kpiSlideData.birthdayNextMonth.slice(0, 3).map((c) => c.name.split(" ")[0]).join(" · ")
                  : "None upcoming",
                sparkData: analytics.monthlyData.map((d) => d.value),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("clients"); setKpiSlideFilter("birthdays"); setKpiSlideExtraData({ clients: kpiSlideData.birthdayNextMonth.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, apptCount: 0, totalSpent: 0, birthday: c.birthday })) }); },
              },
            ]}
          />

          {/* ── Appointments Card (5 slides: Total / Today / Week / Month / Year) ── */}
          <SwipeableKpiCard
            width={cardW}
            slides={[
              {
                gradientColors: ["#1565C0", "#42A5F5"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="calendar" size={22} color="#FFF" />,
                value: String(kpiSlideData.totalApptCount),
                numericValue: kpiSlideData.totalApptCount,
                label: "Total Appointments",
                sublabel: `${analytics.statusCounts.completed} completed`,
                badge: analytics.statusCounts.pending > 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, backgroundColor: "rgba(255,152,0,0.55)" }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFF" }}>{analytics.statusCounts.pending} pending</Text>
                  </View>
                ) : undefined,
                sparkData: analytics.weeklyDailyData.map((d) => d.apptCount),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("appointments"); setKpiSlideFilter(null); setKpiSlideExtraData(undefined); },
              },
              {
                gradientColors: ["#1565C0", "#42A5F5"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="calendar" size={22} color="#FFF" />,
                value: String(kpiSlideData.todayApptCount),
                numericValue: kpiSlideData.todayApptCount,
                label: "Today's Appointments",
                sublabel: `${kpiSlideData.todayPendingCount} pending today`,
                sparkData: analytics.weeklyDailyData.map((d) => d.apptCount),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("appointments"); setKpiSlideFilter("today"); setKpiSlideExtraData({ label: "Today's Appointments", appointmentCount: kpiSlideData.todayApptCount, sublabel: `${kpiSlideData.todayPendingCount} pending`, appointments: kpiSlideData.todayApptList }); },
              },
              {
                gradientColors: ["#0D47A1", "#1976D2"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="calendar" size={22} color="#FFF" />,
                value: String(kpiSlideData.weekApptCount),
                numericValue: kpiSlideData.weekApptCount,
                label: "This Week",
                sublabel: `${kpiSlideData.weekPendingCount} pending this week`,
                sparkData: analytics.weeklyDailyData.map((d) => d.apptCount),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("appointments"); setKpiSlideFilter("week"); setKpiSlideExtraData({ label: "This Week's Appointments", appointmentCount: kpiSlideData.weekApptCount, sublabel: `${kpiSlideData.weekPendingCount} pending`, appointments: kpiSlideData.weekApptList }); },
              },
              {
                gradientColors: ["#006064", "#26C6DA"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="calendar" size={22} color="#FFF" />,
                value: String(kpiSlideData.monthApptCount),
                numericValue: kpiSlideData.monthApptCount,
                label: `${new Date().toLocaleDateString("en-US", { month: "long" })} Appointments`,
                sublabel: `${kpiSlideData.monthConfirmedCount} confirmed this month`,
                sparkData: analytics.weeklyDailyData.map((d) => d.apptCount),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("appointments"); setKpiSlideFilter("month"); setKpiSlideExtraData({ label: `${new Date().toLocaleDateString("en-US", { month: "long" })} Appointments`, appointmentCount: kpiSlideData.monthApptCount, sublabel: `${kpiSlideData.monthConfirmedCount} confirmed`, appointments: kpiSlideData.monthApptList }); },
              },
              {
                gradientColors: ["#01579B", "#0288D1"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="calendar" size={22} color="#FFF" />,
                value: String(kpiSlideData.yearApptCount),
                numericValue: kpiSlideData.yearApptCount,
                label: `${new Date().getFullYear()} Appointments`,
                sublabel: `${kpiSlideData.yearCompletedCount} completed this year`,
                sparkData: analytics.weeklyDailyData.map((d) => d.apptCount),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("appointments"); setKpiSlideFilter("year"); setKpiSlideExtraData({ label: `${new Date().getFullYear()} Appointments`, appointmentCount: kpiSlideData.yearApptCount, sublabel: `${kpiSlideData.yearCompletedCount} completed`, appointments: kpiSlideData.yearApptList }); },
              },
            ]}
          />

          {/* ── Top Service Card (3 slides: All-Time / Top 3 This Week / Top 5 This Month) ── */}
          <SwipeableKpiCard
            width={cardW}
            slides={[
              {
                gradientColors: ["#E65100", "#FF8A65"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="star.fill" size={22} color="#FFF" />,
                value: analytics.topService ? analytics.topService.name.split(" ").slice(0, 2).join(" ") : "—",
                numericValue: analytics.topCount,
                label: "Top Service",
                sublabel: analytics.topCount > 0 ? `${analytics.topCount} bookings all-time` : "No data yet",
                sparkData: kpiServiceRanking.slice(0, 7).map((s) => s.bookings),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("topservice"); setKpiSlideFilter(null); setKpiSlideExtraData(undefined); },
              },
              {
                gradientColors: ["#E65100", "#FF8A65"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="star.fill" size={22} color="#FFF" />,
                value: kpiSlideData.top3Week.length > 0 ? kpiSlideData.top3Week[0].name.split(" ").slice(0, 2).join(" ") : "—",
                label: "Top 3 This Week",
                sublabel: kpiSlideData.top3Week.length > 0
                  ? kpiSlideData.top3Week.map((s) => `${s.name.split(" ")[0]} (${s.count})`).join(" · ")
                  : "No bookings this week",
                sparkData: kpiSlideData.top3Week.map((s) => s.count),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("topservice"); setKpiSlideFilter("top3week"); setKpiSlideExtraData({ services: kpiSlideData.top3Week.map((s) => ({ id: s.name, name: s.name, color: s.color, bookings: s.count, price: 0 })) }); },
              },
              {
                gradientColors: ["#BF360C", "#FF7043"],
                iconBg: "rgba(255,255,255,0.22)",
                icon: <IconSymbol name="star.fill" size={22} color="#FFF" />,
                value: kpiSlideData.top5Month.length > 0 ? kpiSlideData.top5Month[0].name.split(" ").slice(0, 2).join(" ") : "—",
                label: "Top 5 This Month",
                sublabel: kpiSlideData.top5Month.length > 0
                  ? kpiSlideData.top5Month.slice(0, 3).map((s) => `${s.name.split(" ")[0]} (${s.count})`).join(" · ")
                  : "No bookings this month",
                sparkData: kpiSlideData.top5Month.map((s) => s.count),
                sparkType: "bar",
                onPress: () => { setKpiDetailTab("topservice"); setKpiSlideFilter("top5month"); setKpiSlideExtraData({ services: kpiSlideData.top5Month.map((s) => ({ id: s.name, name: s.name, color: s.color, bookings: s.count, price: 0 })) }); },
              },
            ]}
          />
          </View>
          </Animated.View>

          {/* Day/Week card: fades in on top, same flow position */}
          <Animated.View
            style={[
              dayWeekAnimStyle,
              { position: "absolute", top: 0, left: 0, right: 0 },
            ]}
            pointerEvents={overviewMode === "dayweek" ? "auto" : "none"}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) {
                dayWeekMeasuredHeight.current = h;
                if (overviewMode === "dayweek") {
                  overviewHeightAnim.setValue(h);
                }
              }
            }}
          >
            <OverviewDayWeekCard
              appointments={state.appointments}
              services={state.services}
              clients={state.clients}
              selectedLocationFilter={selectedLocationFilter}
              width={contentWidth}
            />
          </Animated.View>
        </Animated.View>
        {/* ─── Monthly Goal Progress Bar ──────────────────────────────────── */}
        {state.settings.monthlyRevenueGoal > 0 && (
          <Pressable
            onPress={() => router.push("/settings" as any)}
            style={({ pressed }) => [styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14, marginTop: 12, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="target" size={16} color={colors.primary} />
                </View>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Monthly Goal</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: "700", color: revenueForecast.progressPct >= 100 ? colors.success : colors.primary }}>
                {revenueForecast.progressPct}%
              </Text>
            </View>
            {/* Progress bar */}
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden", marginBottom: 6 }}>
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: revenueForecast.progressPct >= 100 ? colors.success : colors.primary,
                  width: `${Math.min(100, revenueForecast.progressPct)}%` as any,
                }}
              />
            </View>
            {/* Projected fill bar (lighter) */}
            {revenueForecast.projectedPct > revenueForecast.progressPct && revenueForecast.progressPct < 100 && (
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden", marginBottom: 6 }}>
                <View
                  style={{
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: colors.primary + "50",
                    width: `${Math.min(100, revenueForecast.projectedPct)}%` as any,
                  }}
                />
              </View>
            )}
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                ${revenueForecast.earnedSoFar.toLocaleString()} earned · {revenueForecast.remainingDays}d left
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                Goal: ${state.settings.monthlyRevenueGoal.toLocaleString()}
              </Text>
            </View>
            {revenueForecast.projectedPct > revenueForecast.progressPct && revenueForecast.progressPct < 100 && (
              <Text style={{ fontSize: 11, color: colors.primary, marginTop: 4 }}>
                On track to reach ${revenueForecast.projected.toLocaleString()} by month-end
              </Text>
            )}
            {revenueForecast.progressPct >= 100 && (
              <Text style={{ fontSize: 12, color: colors.success, fontWeight: "700", marginTop: 2 }}>🎉 Goal reached this month!</Text>
            )}
          </Pressable>
        )}

        {/* ─── Payment Summary Card (swipeable: Payment / By Service / Status) ── */}
        <PaymentSummaryCard
          paidRevenue={analytics.paidRevenue}
          unpaidRevenue={analytics.unpaidRevenue}
          paidCount={analytics.paidCount}
          unpaidCount={analytics.unpaidCount}
          methodBreakdown={analytics.methodBreakdown}
          serviceBreakdown={analytics.serviceBreakdown}
          statusCounts={analytics.statusCounts}
          totalAppointments={analytics.totalAppointments}
          appointments={analytics.filteredAppts}
          width={contentWidth}
          onPressPaid={() => router.push({ pathname: '/(tabs)/bookings', params: { filter: 'paid' } } as any)}
          onPressUnpaid={() => router.push({ pathname: '/(tabs)/bookings', params: { filter: 'unpaid' } } as any)}
          onPressFullSummary={() => router.push('/payment-summary' as any)}
          onPressStatus={(status) => {
            // Map appointment status keys to calendar filter keys
            const calendarFilter: Record<string, string> = {
              completed: 'completed',
              confirmed: 'confirmed',
              pending: 'requests',
              cancelled: 'cancelled',
              all: 'upcoming',
            };
            const filter = calendarFilter[status] ?? 'upcoming';
            router.push({ pathname: '/(tabs)/bookings', params: { filter } } as any);
          }}
          onPressMethod={(method) => router.push({ pathname: '/payment-summary', params: { method } } as any)}
        />
        {/* ─── Stripe Balance Card (Studio/Enterprise only) ───────────── */}
        {isStripePlan && stripeConnected && (
          <Pressable
            onPress={() => (router as any).push("/payments-history")}
            style={({ pressed }) => ({
              marginTop: 14,
              borderRadius: 16,
              overflow: "hidden" as const,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <LinearGradient
              colors={["#635BFF", "#4A3FCC"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 16, borderRadius: 16 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="creditcard.fill" size={16} color="#FFF" />
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>Stripe Balance</Text>
                </View>
                {stripeBalanceLoading ? (
                  <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.3)" }} />
                ) : (
                  <IconSymbol name="chevron.right" size={14} color="rgba(255,255,255,0.7)" />
                )}
              </View>
              {stripeBalance ? (
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>Available</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: "#FFF" }}>
                      ${stripeBalance.available.toFixed(2)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>Pending</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: "rgba(255,255,255,0.85)" }}>
                      ${stripeBalance.pending.toFixed(2)}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                  {stripeBalanceLoading ? "Loading balance..." : "Tap to view payment history"}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        )}

        {/* ─── Unified Revenue Chart Card ─────────────────────────────────── */}
        <RevenueChartCard
          hourlyData={analytics.hourlyData}
          weeklyData={analytics.weeklyDailyData.map((d) => ({ label: d.label, value: d.value, apptCount: d.apptCount }))}
          currentMonthData={analytics.currentMonthDailyData}
          threeMonthData={analytics.threeMonthData}
          sixMonthData={analytics.sixMonthData}
          yearlyData={analytics.yearlyMonthlyData}
          todayRevenue={analytics.todayRevenue}
          weekRevenue={analytics.weekRevenue}
          monthRevenue={analytics.currentMonthDailyData.reduce((s, d) => s + d.value, 0)}
          threeMonthRevenue={analytics.threeMonthRevenue}
          sixMonthRevenue={analytics.sixMonthRevenue}
          yearRevenue={analytics.yearlyRevenue}
          revenueChange={revenueChange}
          monthName={new Date().toLocaleDateString("en-US", { month: "long" })}
          onPress={(period) => router.push({ pathname: "/analytics-detail", params: { tab: "revenue" } } as any)}
          onPointPress={handleChartPointPress}
          width={contentWidth}
        />


        {/* ─── Birthday Banner ──────────────────────────────────────── */}
        {birthdayClients.length > 0 && (
          <View style={{ marginTop: 20, borderRadius: 16, overflow: "hidden" }}>
            <LinearGradient
              colors={["#FF6B9D", "#FF8E53"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ padding: 14, borderRadius: 16 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ fontSize: 22, marginRight: 8 }}>🎂</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFF" }}>
                  {birthdayClients.length === 1
                    ? `Today is ${birthdayClients[0].name}'s Birthday!`
                    : `${birthdayClients.length} Clients Have Birthdays Today!`}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {birthdayClients.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push({ pathname: "/client-detail", params: { id: c.id } })}
                    style={({ pressed }) => [{
                      backgroundColor: "rgba(255,255,255,0.25)",
                      borderRadius: 20,
                      paddingHorizontal: 12,
                      paddingVertical: 5,
                      opacity: pressed ? 0.7 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFF" }}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </LinearGradient>
          </View>
        )}

        {/* ─── Share Booking Link QR Card ──────────────────────────────────── */}
        <Pressable
          onPress={openQrModal}
          style={({ pressed }) => ({
            marginTop: 20,
            borderRadius: 18,
            overflow: "hidden",
            opacity: pressed ? 0.88 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          })}
        >
          <LinearGradient
            colors={["#0a7ea4", "#0369a1"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
              gap: 14,
            }}
          >
            {/* QR preview */}
            <View style={{
              width: 72,
              height: 72,
              borderRadius: 12,
              backgroundColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
              flexShrink: 0,
            }}>
              <QRCode
                value={primaryBookingUrl}
                size={60}
                color="#000"
                backgroundColor="#fff"
              />
            </View>
            {/* Text */}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff", marginBottom: 2 }}>
                Share Booking Link
              </Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 17 }}>
                Tap to view full QR code, copy link, or share with clients
              </Text>
              <View style={{
                flexDirection: "row",
                gap: 6,
                marginTop: 8,
              }}>
                {["Copy Link", "Share", "Full QR"].map((label) => (
                  <View key={label} style={{
                    backgroundColor: "rgba(255,255,255,0.2)",
                    borderRadius: 6,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <IconSymbol name="chevron.right" size={18} color="rgba(255,255,255,0.6)" />
          </LinearGradient>
        </Pressable>

        {/* ─── Quick Actions ──────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>
          Quick Actions
        </Text>
        <View style={styles.quickActionsRow}>
          <Pressable
            onPress={() => router.push("/discounts")}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: "#FF980010",
                borderColor: "#FF980030",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <IconSymbol name="tag.fill" size={22} color="#FF9800" />
            <Text style={[styles.quickActionLabel, { color: "#FF9800" }]}>
              Discounts
            </Text>
            <Text style={[styles.quickActionCount, { color: "#FF9800" }]}>
              {state.discounts.filter((d) => d.active).length}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/gift-cards")}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: "#E91E6310",
                borderColor: "#E91E6330",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <IconSymbol name="gift.fill" size={22} color="#E91E63" />
            <Text style={[styles.quickActionLabel, { color: "#E91E63" }]}>
              Gift Cards
            </Text>
            <Text style={[styles.quickActionCount, { color: "#E91E63" }]}>
              {state.giftCards.filter((g) => !g.redeemed).length}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/staff" as any)}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: "#3B82F610",
                borderColor: "#3B82F630",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <IconSymbol name="person.3.fill" size={22} color="#3B82F6" />
            <Text style={[styles.quickActionLabel, { color: "#3B82F6" }]}>
              Staff
            </Text>
            <Text style={[styles.quickActionCount, { color: "#3B82F6" }]}>
              {state.staff.filter((s) => s.active).length}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleShareBookingLink}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: colors.primary + "10",
                borderColor: colors.primary + "30",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <IconSymbol name="paperplane.fill" size={22} color={colors.primary} />
            <Text style={[styles.quickActionLabel, { color: colors.primary }]}>
              Share Link
            </Text>
          </Pressable>
        </View>

        {/* ─── Recent Messages Card ───────────────────────────────────── */}
        <View style={{ marginTop: 24, marginBottom: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <IconSymbol name="message.fill" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 0 }]}>Messages</Text>
              {recentMessages.some(t => t.unreadCount > 0) && (
                <View style={{ backgroundColor: colors.error, borderRadius: 8, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                    {recentMessages.reduce((s, t) => s + t.unreadCount, 0)}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/clients?tab=messages" as any)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>View All</Text>
            </Pressable>
          </View>

          {messagesLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
          ) : recentMessages.length === 0 ? (
            <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border, padding: 20, alignItems: "center", gap: 6 }]}>
              <IconSymbol name="message.fill" size={28} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center" }}>No messages yet</Text>
              <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>Client messages will appear here</Text>
            </View>
          ) : (
            <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0, overflow: "hidden" }]}>
              {recentMessages.map((thread, idx) => {
                const isUnread = thread.unreadCount > 0;
                const timeAgo = (() => {
                  const diff = Date.now() - new Date(thread.lastMessageAt).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 1) return "just now";
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })();
                return (
                  <Pressable
                    key={thread.clientAccountId}
                    onPress={() => router.push({ pathname: "/client-message-thread-business" as any, params: { clientAccountId: String(thread.clientAccountId), clientName: thread.clientName } })}
                    style={({ pressed }) => ([
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        gap: 12,
                        borderBottomWidth: idx < recentMessages.length - 1 ? 1 : 0,
                        borderBottomColor: colors.border,
                        backgroundColor: isUnread ? colors.primary + "08" : "transparent",
                        opacity: pressed ? 0.8 : 1,
                      },
                    ])}
                  >
                    {/* Avatar */}
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 16 }}>
                        {thread.clientName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    {/* Content */}
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ color: colors.foreground, fontWeight: isUnread ? "700" : "600", fontSize: 14 }} numberOfLines={1}>
                          {thread.clientName}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{timeAgo}</Text>
                      </View>
                      <Text style={{ color: isUnread ? colors.foreground : colors.muted, fontSize: 13, lineHeight: 18 }} numberOfLines={1}>
                        {thread.senderType === "business" ? "You: " : ""}{thread.lastMessage}
                      </Text>
                    </View>
                    {/* Unread badge */}
                    {isUnread && (
                      <View style={{ backgroundColor: colors.primary, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                        <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{thread.unreadCount}</Text>
                      </View>
                    )}
                    <IconSymbol name="chevron.right" size={14} color={colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* ─── Schedule Card (Today + Upcoming) ───────────────── */}
        <ScheduleCard
          todayAppts={todayAppts}
          upcomingAppointments={upcomingAppointments}
          selectedLocationFilter={selectedLocationFilter}
          getServiceById={getServiceById}
          getClientById={getClientById}
          staff={state.staff}
          locations={state.locations}
        />
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => router.push({ pathname: "/calendar-booking", params: { preselectedLocationId: selectedLocationFilter ?? "" } } as any)}
        style={({ pressed }) => [
          styles.fab,
          { right: hp, transform: [{ scale: pressed ? 0.93 : 1 }] },
        ]}
      >
        <LinearGradient
          colors={[colors.primary, colors.primary + "CC"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" }}
        >
          <IconSymbol name="plus" size={28} color="#FFF" />
        </LinearGradient>
      </Pressable>

      {/* Tutorial Walkthrough Overlay */}
      {showTutorial && (
        <TourOverlay
          step={tutorialStep}
          steps={TOUR_TAB_STEPS}
          fadeAnim={tutorialFade}
          colors={colors}
          isDark={isDark}
          tutorialCardBg={tutorialCardBg}
          tutorialCardBorder={tutorialCardBorder}
          tutorialTitleColor={tutorialTitleColor}
          tutorialDescColor={tutorialDescColor}
          tutorialPrevBorderColor={tutorialPrevBorderColor}
          tutorialPrevTextColor={tutorialPrevTextColor}
          tutorialSkipTextColor={tutorialSkipTextColor}
          tutorialProgressTrackBg={tutorialProgressTrackBg}
          onNext={nextTutorialStep}
          onPrev={prevTutorialStep}
          onSkip={() => dismissTutorial(true)}
          onSetupLocation={() => {
            dismissTutorial(false);
            router.push("/location-form" as any);
          }}
        />
      )}

      {/* ─── Location Share Picker Sheet ─────────────────────────────── */}
      <Modal visible={showSharePicker} transparent animationType="slide" onRequestClose={() => setShowSharePicker(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
          onPress={() => setShowSharePicker(false)}
        >
          <Pressable
            style={[
              styles.shareSheet,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}
            onPress={() => {}} // prevent dismiss on inner tap
          >
            <View style={styles.shareSheetHandle} />
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
              Share Booking Link
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>
              Clients will choose their location when booking
            </Text>
            <Pressable
              onPress={() => {
                setShowSharePicker(false);
                doShareForLocation(null);
              }}
              style={({ pressed }) => [
                styles.shareLocRow,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={[styles.shareLocDot, { backgroundColor: colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Share Booking Link</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Clients select location as first step</Text>
              </View>
              <IconSymbol name="paperplane.fill" size={16} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => setShowSharePicker(false)}
              style={({ pressed }) => [
                styles.shareCancelBtn,
                { backgroundColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── QR Booking Link Modal ───────────────────────────────────────── */}
      <Modal visible={showQrModal} transparent animationType="fade" onRequestClose={() => setShowQrModal(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => setShowQrModal(false)}
        >
          <View
            style={[{
              borderRadius: 24,
              padding: 24,
              alignItems: "center",
              width: "100%",
              maxWidth: 340,
              gap: 16,
            }, { backgroundColor: colors.surface }]}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", width: "100%", marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Booking QR Code</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{state.settings.businessName}</Text>
              </View>
              <Pressable
                onPress={() => setShowQrModal(false)}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}
              >
                <IconSymbol name="xmark.circle.fill" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* Large QR Code — always uses base booking URL (client selects location as first step) */}
            <View style={{
              width: 220, height: 220, backgroundColor: "#fff", borderRadius: 16,
              alignItems: "center", justifyContent: "center", padding: 12,
              shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
            }}>
              <QRCode value={qrBookingUrl} size={196} color="#000" backgroundColor="#fff" />
            </View>

            {/* URL pill */}
            <View style={[{ borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, width: "100%" }, { backgroundColor: colors.background }]}>
              <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center" }} numberOfLines={2}>
                {qrBookingUrl}
              </Text>
            </View>

            {/* Action buttons */}
            <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
              <Pressable
                onPress={async () => {
                  const { default: Clipboard } = await import("expo-clipboard");
                  await Clipboard.setStringAsync(qrBookingUrl);
                  Alert.alert("Copied!", "Booking link copied to clipboard.");
                }}
                style={({ pressed }) => [{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 6, paddingVertical: 12, borderRadius: 12, opacity: pressed ? 0.8 : 1,
                }, { backgroundColor: colors.border }]}
              >
                <IconSymbol name="doc.on.doc.fill" size={16} color={colors.foreground} />
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Copy Link</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  // Share base booking URL — client selects location as first step
                  await doShareForLocation(null);
                  setShowQrModal(false);
                }}
                style={({ pressed }) => [{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 6, paddingVertical: 12, borderRadius: 12, opacity: pressed ? 0.8 : 1,
                }, { backgroundColor: colors.primary }]}
              >
                <IconSymbol name="paperplane.fill" size={16} color="#fff" />
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>Share</Text>
              </Pressable>
            </View>

            <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center" }}>
              Display at your counter or print for clients to scan
            </Text>
          </View>
        </Pressable>
      </Modal>

      {/* ─── KPI Detail Sheet ──────────────────────────────────────────── */}
      <KpiDetailSheet
        visible={kpiDetailTab !== null}
        tab={kpiDetailTab}
        onClose={() => { setKpiDetailTab(null); setKpiSlideFilter(null); setKpiSlideExtraData(undefined); }}
        onExport={handleKpiExport}
        isFreeplan={isFreeplan}
        onDateRangeChange={setKpiDateRange}
        revenueData={kpiRangedData.revenueData}
        appointmentsData={kpiRangedData.appointmentsData}
        clientsData={kpiRangedData.clientsData}
        topServiceData={kpiRangedData.topServiceData}
        slideFilter={kpiSlideFilter}
        slideExtraData={kpiSlideExtraData}
      />
      <ChartDrillDownSheet
        visible={drillDownVisible}
        onClose={() => setDrillDownVisible(false)}
        label={drillDownLabel}
        subtitle={drillDownSubtitle}
        totalRevenue={drillDownRevenue}
        appointments={drillDownAppointments}
        onPressAppointment={(id) => {
          setDrillDownVisible(false);
          router.push({ pathname: "/appointment-detail", params: { id } } as any);
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // ─── Header ──────────────────────────────────────────────
  headerGradientBanner: {
    borderRadius: 18,
    padding: 14,
    marginTop: 4,
    marginBottom: 4,
    borderWidth: 1,
  },
  businessHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  businessLogo: {
    width: 52,
    height: 52,
    borderRadius: 14,
  },
  cameraOverlay: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: {
    flex: 1,
    marginLeft: 14,
  },
  businessName: {
    fontSize: 20,
    fontWeight: "700",
  },
  greetingText: {
    fontSize: 13,
    marginTop: 2,
  },
  closedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dateLabel: {
    fontSize: 14,
    marginTop: 2,
    marginBottom: 4,
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
  },
  pendingText: {
    color: "#E65100",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
    flex: 1,
  },
  closedBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },

  // ─── Section ─────────────────────────────────────────────
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },

  // ─── KPI Grid ────────────────────────────────────────────
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
  },
  kpiCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 0,
  },
  kpiHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  kpiIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  changeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  kpiTotal: {
    fontSize: 11,
    marginTop: 4,
  },
  miniStatRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  miniStat: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: "center",
  },

  // ─── Charts ──────────────────────────────────────────────
  chartCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  chartSubtitle: {
    fontSize: 12,
  },
  sideBySideRow: {
    flexDirection: "row",
  },

  statusList: {
    gap: 10,
  },
  statusItem: {
    width: "100%",
  },
  statusLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  statusLabel: {
    fontSize: 11,
  },
  statusValue: {
    fontSize: 11,
    fontWeight: "700",
  },

  // ─── Quick Actions ───────────────────────────────────────
  quickActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  quickAction: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 90,
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
  },
  quickActionCount: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },

  // ─── Today's Schedule ────────────────────────────────────
  emptyCard: {
    alignItems: "center",
    paddingVertical: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  bookBtn: {
    marginTop: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  bookBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  apptCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  apptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  apptTimeBlock: {
    width: 56,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  apptInfo: {
    flex: 1,
  },
  apptTime: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  apptService: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },

  // ─── FAB ─────────────────────────────────────────────────────
  fab: {
    position: "absolute",
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#4A7C59",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },

  // ─── Tutorial Walkthrough (kept for legacy ref) ───────────────
  tutorialOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  tutorialCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 12,
  },
  tutorialProgressTrack: {
    height: 3,
    width: "100%",
  },
  tutorialProgressBar: {
    height: 3,
    borderRadius: 2,
  },
  tutorialTitle: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
    paddingHorizontal: 20,
    letterSpacing: -0.3,
  },
  tutorialDesc: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  tutorialActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  tutorialSkipBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  tutorialPrevBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  tutorialNextBtn: {
    flex: 2,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 14,
  },
  // ─── Share Picker Sheet ──────────────────────────────────────────────
  shareSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  shareSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C0C0C0",
    alignSelf: "center",
    marginBottom: 16,
  },
  shareLocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  shareLocDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  shareCancelBtn: {
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
});
