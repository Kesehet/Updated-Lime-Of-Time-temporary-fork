import { useMemo, useState, useCallback, useRef } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useStore, formatDateDisplay, formatTime } from "@/lib/store";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { minutesToTime, timeToMinutes } from "@/lib/types";
import { useActiveLocation } from "@/hooks/use-active-location";
import { useResponsive } from "@/hooks/use-responsive";
import { LocationSwitcher } from "@/components/location-switcher";
import { FuturisticBackground } from "@/components/futuristic-background";
import { usePlanLimitCheck } from "@/hooks/use-plan-limit-check";

export default function AnalyticsDetailScreen() {
  const { tab } = useLocalSearchParams<{ tab: string }>();
  const { state, getServiceById, getClientById, filterAppointmentsByLocation, clientsForActiveLocation } = useStore();
  const { activeLocation, hasMultipleLocations: hasMultiLoc } = useActiveLocation();
  const colors = useColors();
  const router = useRouter();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();
  const { planInfo } = usePlanLimitCheck();
  const isFreeplan = !planInfo || planInfo.planKey === "solo";
  const [generating, setGenerating] = useState(false);
  const [dateRange, setDateRange] = useState<"today" | "this_week" | "this_month" | "last_month" | "last_3m" | "last_6m" | "this_year" | "all" | "custom">("last_6m");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customStartInput, setCustomStartInput] = useState("");
  const [customEndInput, setCustomEndInput] = useState("");
  // Scroll-wheel date picker state
  const today = new Date();
  const [startYear, setStartYear] = useState(today.getFullYear());
  const [startMonth, setStartMonth] = useState(today.getMonth() + 1);
  const [startDay, setStartDay] = useState(1);
  const [endYear, setEndYear] = useState(today.getFullYear());
  const [endMonth, setEndMonth] = useState(today.getMonth() + 1);
  const [endDay, setEndDay] = useState(today.getDate());

  const DATE_RANGES: { key: typeof dateRange; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "this_week", label: "This Week" },
    { key: "this_month", label: "This Month" },
    { key: "last_month", label: "Last Month" },
    { key: "last_3m", label: "3 Months" },
    { key: "last_6m", label: "6 Months" },
    { key: "this_year", label: "This Year" },
    { key: "all", label: "All Time" },
    { key: "custom", label: "Custom" },
  ];

  const dateRangeFilter = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (dateRange === "today") {
      const today = now.toISOString().substring(0, 10);
      return { start: today, end: today };
    } else if (dateRange === "this_week") {
      const day = now.getDay(); // 0=Sun
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - day);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return { start: weekStart.toISOString().substring(0, 10), end: weekEnd.toISOString().substring(0, 10) };
    } else if (dateRange === "custom") {
      if (customStart && customEnd && customStart <= customEnd) {
        return { start: customStart, end: customEnd };
      }
      return null;
    } else if (dateRange === "this_month") {
      const start = new Date(y, m, 1).toISOString().substring(0, 10);
      const end = new Date(y, m + 1, 0).toISOString().substring(0, 10);
      return { start, end };
    } else if (dateRange === "last_month") {
      const start = new Date(y, m - 1, 1).toISOString().substring(0, 10);
      const end = new Date(y, m, 0).toISOString().substring(0, 10);
      return { start, end };
    } else if (dateRange === "last_3m") {
      const start = new Date(y, m - 2, 1).toISOString().substring(0, 10);
      const end = new Date(y, m + 1, 0).toISOString().substring(0, 10);
      return { start, end };
    } else if (dateRange === "last_6m") {
      const start = new Date(y, m - 5, 1).toISOString().substring(0, 10);
      const end = new Date(y, m + 1, 0).toISOString().substring(0, 10);
      return { start, end };
    } else if (dateRange === "this_year") {
      const start = new Date(y, 0, 1).toISOString().substring(0, 10);
      const end = new Date(y, 11, 31).toISOString().substring(0, 10);
      return { start, end };
    }
    return null; // all time
  }, [dateRange, customStart, customEnd]);

  // Use global activeLocationId — no separate local filter needed
  const allLocationAppts = useMemo(
    () => filterAppointmentsByLocation(state.appointments),
    [state.appointments, filterAppointmentsByLocation]
  );
  const filteredAppts = useMemo(() => {
    if (!dateRangeFilter) return allLocationAppts;
    return allLocationAppts.filter(
      (a) => a.date >= dateRangeFilter.start && a.date <= dateRangeFilter.end
    );
  }, [allLocationAppts, dateRangeFilter]);

  const TAB_ORDER = ["overview", "clients", "appointments", "revenue", "topservice", "staff", "promoCodes"] as const;
  const titles: Record<string, string> = {
    overview: "Analytics Overview",
    clients: "Total Clients",
    appointments: "Appointments",
    revenue: "Revenue",
    topservice: "Top Service",
    staff: "Staff Performance",
    promoCodes: "Promo Code Report",
  };



  // Clients analytics — scoped to active location
  const clientsData = useMemo(() => {
    return clientsForActiveLocation
      .map((c) => {
        const apptCount = filteredAppts.filter(
          (a) => a.clientId === c.id && a.status !== "cancelled"
        ).length;
        const totalSpent = filteredAppts
          .filter((a) => a.clientId === c.id && a.status === "completed")
          .reduce((sum, a) => {
            if (a.totalPrice != null) return sum + a.totalPrice;
            const svc = getServiceById(a.serviceId);
            return sum + (svc?.price ?? 0);
          }, 0);
        return { ...c, apptCount, totalSpent };
      })
      .sort((a, b) => b.apptCount - a.apptCount);
  }, [clientsForActiveLocation, filteredAppts, state.services]);

  // Appointments analytics - by month
  const appointmentsData = useMemo(() => {
    const months: Record<
      string,
      { confirmed: number; completed: number; cancelled: number; pending: number }
    > = {};
    filteredAppts.forEach((a) => {
      const monthKey = a.date.substring(0, 7);
      if (!months[monthKey])
        months[monthKey] = { confirmed: 0, completed: 0, cancelled: 0, pending: 0 };
      if (a.status === "confirmed") months[monthKey].confirmed++;
      else if (a.status === "completed") months[monthKey].completed++;
      else if (a.status === "cancelled") months[monthKey].cancelled++;
      else if (a.status === "pending") months[monthKey].pending++;
    });
    return Object.entries(months)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, counts]) => ({ month, ...counts }));
  }, [filteredAppts]);

  // Revenue analytics - by service
  const revenueData = useMemo(() => {
    const byService: Record<
      string,
      { name: string; revenue: number; count: number; color: string }
    > = {};
    filteredAppts
      .filter((a) => a.status === "completed")
      .forEach((a) => {
        const svc = getServiceById(a.serviceId);
        if (svc) {
          if (!byService[svc.id])
            byService[svc.id] = { name: svc.name, revenue: 0, count: 0, color: svc.color };
          // Use totalPrice if available (includes extras), else fall back to service price
          const apptRevenue = a.totalPrice != null ? a.totalPrice : svc.price;
          byService[svc.id].revenue += apptRevenue;
          byService[svc.id].count++;
        }
      });
    return Object.values(byService).sort((a, b) => b.revenue - a.revenue);
  }, [filteredAppts, state.services]);

  const totalRevenue = revenueData.reduce((s, r) => s + r.revenue, 0);

  // Top service analytics
  const serviceRanking = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredAppts
      .filter((a) => a.status !== "cancelled")
      .forEach((a) => {
        counts[a.serviceId] = (counts[a.serviceId] || 0) + 1;
      });
    return state.services
      .map((s) => ({ ...s, bookings: counts[s.id] || 0 }))
      .sort((a, b) => b.bookings - a.bookings);
  }, [state.services, filteredAppts]);

  const maxBar = Math.max(...serviceRanking.map((s) => s.bookings), 1);

  // ─── Overview analytics ────────────────────────────────────────────
  const overviewData = useMemo(() => {
    const completed = filteredAppts.filter((a) => a.status === "completed");
    const cancelled = filteredAppts.filter((a) => a.status === "cancelled");
    const confirmed = filteredAppts.filter((a) => a.status === "confirmed");
    const pending = filteredAppts.filter((a) => a.status === "pending");
    const total = filteredAppts.length;
    const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    const cancellationRate = total > 0 ? Math.round((cancelled.length / total) * 100) : 0;
    const avgRevenue = completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0;

    // Monthly revenue for last 6 months
    const now = new Date();
    const last6Months: { label: string; revenue: number; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short" });
      const monthAppts = completed.filter((a) => a.date.startsWith(key));
      const rev = monthAppts.reduce((s, a) => {
        if (a.totalPrice != null) return s + a.totalPrice;
        const svc = getServiceById(a.serviceId);
        return s + (svc?.price ?? 0);
      }, 0);
      last6Months.push({ label, revenue: rev, count: monthAppts.length });
    }
    const maxMonthRev = Math.max(...last6Months.map((m) => m.revenue), 1);

    // Busiest day of week
    const dayCount: number[] = [0, 0, 0, 0, 0, 0, 0];
    filteredAppts.filter((a) => a.status !== "cancelled").forEach((a) => {
      const d = new Date(a.date + "T12:00:00");
      dayCount[d.getDay()]++;
    });
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const busiestDayIdx = dayCount.indexOf(Math.max(...dayCount));
    const busiestDay = dayNames[busiestDayIdx];

    // Top client
    const topClient = clientsData[0];
    // Top service
    const topService = serviceRanking[0];
    // Avg rating
    const reviews = state.reviews;
    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null;

    // New clients last 30 days (by first appointment)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyKey = thirtyDaysAgo.toISOString().substring(0, 10);
    const recentClientIds = new Set(
      filteredAppts
        .filter((a) => a.date >= thirtyKey)
        .map((a) => a.clientId)
    );
    const newClientsLast30 = recentClientIds.size;

    return {
      total, completed: completed.length, cancelled: cancelled.length,
      confirmed: confirmed.length, pending: pending.length,
      completionRate, cancellationRate, avgRevenue,
      last6Months, maxMonthRev, busiestDay,
      topClient, topService, avgRating, newClientsLast30,
      totalClients: clientsForActiveLocation.length,
      reviewCount: reviews.length,
    };
  }, [filteredAppts, totalRevenue, clientsData, serviceRanking, state.reviews, clientsForActiveLocation, getServiceById]);

  // ─── Year-End / Tax Report Generation ─────────────────────────────
  const generateYearEndReport = useCallback(
    async (reportType: string) => {
      setGenerating(true);
      try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const businessName = state.settings.businessName || "My Business";
        const profile = state.settings.profile;

        // Filter appointments for the current year — scoped to active location
        const locationAppts = filterAppointmentsByLocation(state.appointments);
        const yearAppts = locationAppts.filter((a) =>
          a.date.startsWith(`${currentYear}`)
        );
        const completedAppts = yearAppts.filter((a) => a.status === "completed");
        const cancelledAppts = yearAppts.filter((a) => a.status === "cancelled");
        const pendingAppts = yearAppts.filter((a) => a.status === "pending");
        const confirmedAppts = yearAppts.filter((a) => a.status === "confirmed");

        // Revenue calculations
        const yearRevenue = completedAppts.reduce((sum, a) => {
          if (a.totalPrice != null) return sum + a.totalPrice;
          const svc = getServiceById(a.serviceId);
          return sum + (svc?.price ?? 0);
        }, 0);

        // Monthly revenue breakdown
        const monthlyRevenue: Record<string, number> = {};
        completedAppts.forEach((a) => {
          const monthKey = a.date.substring(0, 7);
          const apptPrice = a.totalPrice != null ? a.totalPrice : (getServiceById(a.serviceId)?.price ?? 0);
          monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + apptPrice;
        });

        // Service revenue breakdown
        const serviceRevenue: Record<string, { name: string; revenue: number; count: number }> = {};
        completedAppts.forEach((a) => {
          const svc = getServiceById(a.serviceId);
          if (svc) {
            if (!serviceRevenue[svc.id])
              serviceRevenue[svc.id] = { name: svc.name, revenue: 0, count: 0 };
            serviceRevenue[svc.id].revenue += a.totalPrice != null ? a.totalPrice : svc.price;
            serviceRevenue[svc.id].count++;
          }
        });

        // Client revenue breakdown
        const clientRevenue: Record<string, { name: string; phone: string; email: string; revenue: number; visits: number }> = {};
        completedAppts.forEach((a) => {
          const client = getClientById(a.clientId);
          const svc = getServiceById(a.serviceId);
          if (client) {
            if (!clientRevenue[client.id])
              clientRevenue[client.id] = {
                name: client.name,
                phone: client.phone,
                email: client.email,
                revenue: 0,
                visits: 0,
              };
            clientRevenue[client.id].revenue += a.totalPrice != null ? a.totalPrice : (svc?.price ?? 0);
            clientRevenue[client.id].visits++;
          }
        });

        // Cancellation fee estimate
        const cancellationFees = cancelledAppts.reduce((sum, a) => {
          if (state.settings.cancellationPolicy.enabled) {
            const svc = getServiceById(a.serviceId);
            return sum + ((svc?.price ?? 0) * state.settings.cancellationPolicy.feePercentage) / 100;
          }
          return sum;
        }, 0);

        // Total hours worked
        const totalMinutesWorked = completedAppts.reduce((sum, a) => sum + a.duration, 0);
        const totalHoursWorked = Math.round((totalMinutesWorked / 60) * 10) / 10;

        // Average revenue per appointment
        const avgRevenuePerAppt =
          completedAppts.length > 0 ? Math.round(yearRevenue / completedAppts.length) : 0;

        // Build CSV content based on report type
        let csvContent = "";
        let fileName = "";
        const dateGenerated = now.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        if (reportType === "revenue" || reportType === "full") {
          fileName = `${businessName.replace(/\s+/g, "_")}_Tax_Report_${currentYear}.csv`;
          csvContent += `"${businessName} - Year-End Tax Report ${currentYear}"\n`;
          csvContent += `"Generated: ${dateGenerated}"\n`;
          if (profile.ownerName) csvContent += `"Owner: ${profile.ownerName}"\n`;
          if (profile.address) csvContent += `"Address: ${profile.address}"\n`;
          if (profile.phone) csvContent += `"Phone: ${profile.phone}"\n`;
          if (profile.email) csvContent += `"Email: ${profile.email}"\n`;
          csvContent += `\n`;

          // Summary section
          csvContent += `"ANNUAL SUMMARY"\n`;
          csvContent += `"Metric","Value"\n`;
          csvContent += `"Total Gross Revenue","$${yearRevenue.toLocaleString()}"\n`;
          csvContent += `"Total Completed Appointments","${completedAppts.length}"\n`;
          csvContent += `"Total Cancelled Appointments","${cancelledAppts.length}"\n`;
          csvContent += `"Total Pending Appointments","${pendingAppts.length}"\n`;
          csvContent += `"Total Confirmed Appointments","${confirmedAppts.length}"\n`;
          csvContent += `"Estimated Cancellation Fees","$${cancellationFees.toLocaleString()}"\n`;
          csvContent += `"Total Hours Worked","${totalHoursWorked}"\n`;
          csvContent += `"Average Revenue Per Appointment","$${avgRevenuePerAppt}"\n`;
          csvContent += `"Total Clients Served","${Object.keys(clientRevenue).length}"\n`;
          csvContent += `"Total Services Offered","${state.services.length}"\n`;
          csvContent += `\n`;

          // Monthly breakdown
          csvContent += `"MONTHLY REVENUE BREAKDOWN"\n`;
          csvContent += `"Month","Revenue","Appointments"\n`;
          const monthNames = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ];
          for (let m = 0; m < 12; m++) {
            const monthKey = `${currentYear}-${String(m + 1).padStart(2, "0")}`;
            const rev = monthlyRevenue[monthKey] || 0;
            const count = completedAppts.filter((a) => a.date.startsWith(monthKey)).length;
            csvContent += `"${monthNames[m]} ${currentYear}","$${rev.toLocaleString()}","${count}"\n`;
          }
          csvContent += `\n`;

          // Service breakdown
          csvContent += `"REVENUE BY SERVICE"\n`;
          csvContent += `"Service","Revenue","Appointments","Avg Price"\n`;
          Object.values(serviceRevenue)
            .sort((a, b) => b.revenue - a.revenue)
            .forEach((s) => {
              const avg = s.count > 0 ? Math.round(s.revenue / s.count) : 0;
              csvContent += `"${s.name}","$${s.revenue.toLocaleString()}","${s.count}","$${avg}"\n`;
            });
          csvContent += `\n`;

          // Client breakdown
          csvContent += `"REVENUE BY CLIENT"\n`;
          csvContent += `"Client","Phone","Email","Revenue","Visits"\n`;
          Object.values(clientRevenue)
            .sort((a, b) => b.revenue - a.revenue)
            .forEach((c) => {
              csvContent += `"${c.name}","${c.phone}","${c.email}","$${c.revenue.toLocaleString()}","${c.visits}"\n`;
            });
        } else if (reportType === "clients") {
          fileName = `${businessName.replace(/\s+/g, "_")}_Client_Report_${currentYear}.csv`;
          csvContent += `"${businessName} - Client Report ${currentYear}"\n`;
          csvContent += `"Generated: ${dateGenerated}"\n\n`;
          const reportClients = filterAppointmentsByLocation === ((a: any[]) => a) ? state.clients : clientsForActiveLocation;
          csvContent += `"TOTAL CLIENTS: ${reportClients.length}"\n\n`;
          csvContent += `"Client Name","Phone","Email","Total Appointments","Completed","Cancelled","Total Spent","Notes"\n`;
          reportClients.forEach((c) => {
            const cAppts = yearAppts.filter((a) => a.clientId === c.id);
            const cCompleted = cAppts.filter((a) => a.status === "completed").length;
            const cCancelled = cAppts.filter((a) => a.status === "cancelled").length;
            const cSpent = cAppts
              .filter((a) => a.status === "completed")
              .reduce((sum, a) => {
                if (a.totalPrice != null) return sum + a.totalPrice;
                const svc = getServiceById(a.serviceId);
                return sum + (svc?.price ?? 0);
              }, 0);
            csvContent += `"${c.name}","${c.phone}","${c.email}","${cAppts.length}","${cCompleted}","${cCancelled}","$${cSpent}","${c.notes.replace(/"/g, '""')}"\n`;
          });
        } else if (reportType === "appointments") {
          fileName = `${businessName.replace(/\s+/g, "_")}_Appointment_Report_${currentYear}.csv`;
          csvContent += `"${businessName} - Appointment Report ${currentYear}"\n`;
          csvContent += `"Generated: ${dateGenerated}"\n\n`;
          csvContent += `"TOTAL APPOINTMENTS: ${yearAppts.length}"\n`;
          csvContent += `"Completed: ${completedAppts.length} | Confirmed: ${confirmedAppts.length} | Pending: ${pendingAppts.length} | Cancelled: ${cancelledAppts.length}"\n\n`;
          csvContent += `"Date","Time","End Time","Client","Service","Duration (min)","Price","Status","Notes"\n`;
          yearAppts
            .sort((a, b) => {
              const dc = a.date.localeCompare(b.date);
              return dc !== 0 ? dc : a.time.localeCompare(b.time);
            })
            .forEach((a) => {
              const client = getClientById(a.clientId);
              const svc = getServiceById(a.serviceId);
              const endMin = timeToMinutes(a.time) + a.duration;
              const endTime = minutesToTime(endMin);
              csvContent += `"${a.date}","${a.time}","${endTime}","${client?.name ?? "Unknown"}","${svc?.name ?? "Unknown"}","${a.duration}","$${a.totalPrice != null ? a.totalPrice : (svc?.price ?? 0)}","${a.status}","${a.notes.replace(/"/g, '""')}"\n`;
            });
        } else if (reportType === "topservice") {
          fileName = `${businessName.replace(/\s+/g, "_")}_Service_Report_${currentYear}.csv`;
          csvContent += `"${businessName} - Service Performance Report ${currentYear}"\n`;
          csvContent += `"Generated: ${dateGenerated}"\n\n`;
          csvContent += `"Service Name","Price","Duration (min)","Total Bookings","Completed","Revenue","Avg Monthly Bookings"\n`;
          state.services.forEach((s) => {
            const sAppts = yearAppts.filter((a) => a.serviceId === s.id);
            const sCompleted = sAppts.filter((a) => a.status === "completed").length;
            const sRevenue = sCompleted * s.price;
            const avgMonthly = Math.round((sAppts.length / 12) * 10) / 10;
            csvContent += `"${s.name}","$${s.price}","${s.duration}","${sAppts.length}","${sCompleted}","$${sRevenue}","${avgMonthly}"\n`;
          });
        } else if (reportType === "overview") {
          fileName = `${businessName.replace(/\s+/g, "_")}_Overview_Report_${currentYear}.csv`;
          csvContent += `"${businessName} - Analytics Overview Report ${currentYear}"\n`;
          csvContent += `"Generated: ${dateGenerated}"\n`;
          if (profile.ownerName) csvContent += `"Owner: ${profile.ownerName}"\n`;
          csvContent += `\n`;

          // Summary
          const completionRate = yearAppts.length > 0 ? Math.round((completedAppts.length / yearAppts.length) * 100) : 0;
          const cancellationRate = yearAppts.length > 0 ? Math.round((cancelledAppts.length / yearAppts.length) * 100) : 0;
          const avgRevenuePerAppt = completedAppts.length > 0 ? Math.round(yearRevenue / completedAppts.length) : 0;
          const totalMinutes = completedAppts.reduce((s, a) => s + a.duration, 0);
          const totalHrs = Math.round((totalMinutes / 60) * 10) / 10;
          csvContent += `"OVERVIEW SUMMARY"\n`;
          csvContent += `"Metric","Value"\n`;
          csvContent += `"Total Gross Revenue","$${yearRevenue.toLocaleString()}"\n`;
          csvContent += `"Total Appointments","${yearAppts.length}"\n`;
          csvContent += `"Completed","${completedAppts.length}"\n`;
          csvContent += `"Cancelled","${cancelledAppts.length}"\n`;
          csvContent += `"Pending","${pendingAppts.length}"\n`;
          csvContent += `"Confirmed","${confirmedAppts.length}"\n`;
          csvContent += `"Completion Rate","${completionRate}%"\n`;
          csvContent += `"Cancellation Rate","${cancellationRate}%"\n`;
          csvContent += `"Avg Revenue / Appointment","$${avgRevenuePerAppt}"\n`;
          csvContent += `"Total Hours Worked","${totalHrs}"\n`;
          csvContent += `"Total Clients Served","${Object.keys(clientRevenue).length}"\n`;
          csvContent += `"Total Services Offered","${state.services.length}"\n`;
          csvContent += `\n`;

          // Monthly revenue
          csvContent += `"MONTHLY REVENUE BREAKDOWN"\n`;
          csvContent += `"Month","Revenue","Appointments"\n`;
          const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          for (let m = 0; m < 12; m++) {
            const monthKey = `${currentYear}-${String(m + 1).padStart(2, "0")}`;
            const rev = monthlyRevenue[monthKey] || 0;
            const count = completedAppts.filter((a) => a.date.startsWith(monthKey)).length;
            csvContent += `"${monthNames[m]} ${currentYear}","$${rev.toLocaleString()}","${count}"\n`;
          }
          csvContent += `\n`;

          // Top services
          csvContent += `"TOP SERVICES"\n`;
          csvContent += `"Service","Revenue","Appointments"\n`;
          Object.values(serviceRevenue)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .forEach((s) => {
              csvContent += `"${s.name}","$${s.revenue.toLocaleString()}","${s.count}"\n`;
            });
        }

        // Write file and share
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, csvContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (Platform.OS === "web") {
          // On web, create a download link
          const blob = new Blob([csvContent], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
          Alert.alert("Report Downloaded", `${fileName} has been downloaded.`);
        } else {
          const available = await Sharing.isAvailableAsync();
          if (available) {
            await Sharing.shareAsync(fileUri, {
              mimeType: "text/csv",
              dialogTitle: `Share ${fileName}`,
            });
          } else {
            Alert.alert("Report Saved", `Report saved to: ${fileUri}`);
          }
        }
      } catch (error) {
        Alert.alert("Error", "Failed to generate report. Please try again.");
      } finally {
        setGenerating(false);
      }
    },
    [state, getServiceById, getClientById, filterAppointmentsByLocation, clientsForActiveLocation]
  );

  const getReportType = (): string => {
    if (tab === "revenue") return "full";
    return tab ?? "full";
  };

  const getReportLabel = (): string => {
    switch (tab) {
      case "clients":
        return "Client Report";
      case "appointments":
        return "Appointment Report";
      case "revenue":
        return "Tax / Year-End Report";
      case "topservice":
        return "Service Performance Report";
      default:
        return "Year-End Report";
    }
  };

  return (
    <ScreenContainer tabletMaxWidth={900} edges={["top", "bottom", "left", "right"]}>
      <FuturisticBackground />
      <View
        style={[
          styles.header,
          { paddingHorizontal: hp, borderBottomColor: colors.border },
        ]}
      >
        <Pressable
          onPress={() => {
            if (tab && tab !== "overview") {
              router.replace({ pathname: "/analytics-detail", params: { tab: "overview" } });
            } else {
              router.back();
            }
          }}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="arrow.left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {titles[tab ?? ""] ?? "Analytics"}
        </Text>
        <View style={{ width: 24 }} />
      </View>


      <View style={{ flex: 1 }}>
        {/* ─── Date Range Picker (outside main scroll so it's not clipped) ─── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 10, paddingHorizontal: hp, flexDirection: "row" }}
          style={{ flexShrink: 0 }}
        >
          {DATE_RANGES.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => {
                if (r.key === "custom") {
                  setCustomStartInput(customStart);
                  setCustomEndInput(customEnd);
                  setShowCustomModal(true);
                } else {
                  setDateRange(r.key);
                }
              }}
              style={[
                styles.dateChip,
                {
                  backgroundColor: dateRange === r.key ? colors.primary : colors.surface,
                  borderColor: dateRange === r.key ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ fontSize: fs.xs, fontWeight: "600", color: dateRange === r.key ? "#fff" : colors.muted }}>
                {r.key === "custom" && customStart && customEnd
                  ? `${customStart.substring(5)} – ${customEnd.substring(5)}`
                  : r.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: hp, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Location Switcher — uses global activeLocationId */}
        {hasMultiLoc && (
          <View style={{ marginTop: 4, marginBottom: 4 }}>
            <LocationSwitcher showAll />
          </View>
        )}
        {/* ─── Custom Date Range Modal ─── */}
        <Modal
          visible={showCustomModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCustomModal(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>Custom Date Range</Text>
              {/* Quick presets */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                {[
                  { label: "Last 7 days", days: 7 },
                  { label: "Last 30 days", days: 30 },
                  { label: "Last 90 days", days: 90 },
                ].map(({ label, days }) => {
                  const endD = new Date();
                  const startD = new Date();
                  startD.setDate(startD.getDate() - (days - 1));
                  const fmt = (d: Date) => d.toISOString().slice(0, 10);
                  return (
                    <Pressable
                      key={label}
                      onPress={() => {
                        const s = fmt(startD);
                        const e = fmt(endD);
                        setCustomStartInput(s);
                        setCustomEndInput(e);
                        setCustomStart(s);
                        setCustomEnd(e);
                        setDateRange("custom");
                        setShowCustomModal(false);
                      }}
                      style={({ pressed }) => ({
                        flex: 1,
                        paddingVertical: 8,
                        borderRadius: 10,
                        backgroundColor: colors.primary + "18",
                        borderWidth: 1,
                        borderColor: colors.primary + "40",
                        alignItems: "center",
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.primary }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {/* ── Scroll-wheel date pickers ── */}
              {([
                { label: "Start Date", year: startYear, month: startMonth, day: startDay, setYear: setStartYear, setMonth: setStartMonth, setDay: setStartDay, isEnd: false },
                { label: "End Date", year: endYear, month: endMonth, day: endDay, setYear: setEndYear, setMonth: setEndMonth, setDay: setEndDay, isEnd: true },
              ] as const).map(({ label, year, month, day, setYear, setMonth, setDay, isEnd }) => {
                const daysInMonth = new Date(year, month, 0).getDate();
                // Limit end date to today; start date can go back 5 years
                const maxYear = isEnd ? today.getFullYear() : today.getFullYear();
                const maxMonth = (isEnd && year === today.getFullYear()) ? today.getMonth() + 1 : 12;
                const maxDay = (isEnd && year === today.getFullYear() && month === today.getMonth() + 1) ? today.getDate() : daysInMonth;
                const years = Array.from({ length: 6 }, (_, i) => today.getFullYear() - 5 + i).filter(y => y <= maxYear);
                const months = Array.from({ length: 12 }, (_, i) => i + 1).filter(m => !isEnd || year < today.getFullYear() || m <= maxMonth);
                const days = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter(d => !isEnd || year < today.getFullYear() || month < today.getMonth() + 1 || d <= maxDay);
                const ITEM_H = 36;
                const VISIBLE = 3;
                const mkPicker = (items: number[], selected: number, onSelect: (v: number) => void, fmt?: (v: number) => string, colWidth = 64) => (
                  <View style={{ position: "relative" }}>
                    {/* Center highlight lines */}
                    <View style={{ position: "absolute", top: ITEM_H, left: 0, right: 0, height: ITEM_H, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.primary + "60", borderRadius: 6, backgroundColor: colors.primary + "10", zIndex: 1, pointerEvents: "none" }} />
                    <ScrollView
                      style={{ height: ITEM_H * VISIBLE, width: colWidth }}
                      showsVerticalScrollIndicator={false}
                      snapToInterval={ITEM_H}
                      decelerationRate="fast"
                      contentOffset={{ x: 0, y: (items.indexOf(selected)) * ITEM_H }}
                      onMomentumScrollEnd={(e) => {
                        const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
                        const clamped = Math.max(0, Math.min(idx, items.length - 1));
                        onSelect(items[clamped]);
                      }}
                    >
                      {items.map((v) => (
                        <Pressable key={v} onPress={() => onSelect(v)} style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: fs.sm, fontWeight: v === selected ? "700" : "400", color: v === selected ? colors.primary : colors.muted }}>
                            {fmt ? fmt(v) : String(v).padStart(2, "0")}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                );
                return (
                  <View key={label} style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 6 }}>{label}</Text>
                    <View style={{ flexDirection: "row", gap: 6, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 8, alignItems: "center", justifyContent: "center" }}>
                      {mkPicker(years, year, setYear, (v) => String(v), 72)}
                      <Text style={{ color: colors.muted, fontSize: fs.md }}>/</Text>
                      {mkPicker(months, month, (v) => { setMonth(v); if (day > new Date(year, v, 0).getDate()) setDay(1); }, undefined, 52)}
                      <Text style={{ color: colors.muted, fontSize: fs.md }}>/</Text>
                      {mkPicker(days, day, setDay, undefined, 52)}
                    </View>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, textAlign: "center" }}>
                      {String(year)}-{String(month).padStart(2, "0")}-{String(day).padStart(2, "0")}
                    </Text>
                  </View>
                );
              })}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => setShowCustomModal(false)}
                  style={({ pressed }) => ({ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const s = `${startYear}-${String(startMonth).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
                    const e = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
                    if (s > e) {
                      Alert.alert("Invalid Range", "Start date must be before or equal to end date.");
                      return;
                    }
                    setCustomStart(s);
                    setCustomEnd(e);
                    setCustomStartInput(s);
                    setCustomEndInput(e);
                    setDateRange("custom");
                    setShowCustomModal(false);
                  }}
                  style={({ pressed }) => ({ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#fff" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ─── Report Generation Button ─── */}
        {isFreeplan ? (
          <Pressable
            onPress={() => Alert.alert("Upgrade Required", "Analytics reports and data export are available on Growth, Studio, and Enterprise plans. Upgrade to unlock full analytics.", [
              { text: "Not Now", style: "cancel" },
              { text: "View Plans", onPress: () => router.push("/choose-plan" as any) },
            ])}
            style={[styles.reportButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
          >
            <IconSymbol name="lock.fill" size={18} color={colors.muted} />
            <Text style={[styles.reportButtonText, { color: colors.muted }]}>
              {`Generate ${getReportLabel()}`}
            </Text>
            <View style={{ backgroundColor: "#F59E0B22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#F59E0B44" }}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: "#F59E0B" }}>UPGRADE</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => generateYearEndReport(getReportType())}
            disabled={generating}
            style={({ pressed }) => [
              styles.reportButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed || generating ? 0.7 : 1,
              },
            ]}
          >
            {generating ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <IconSymbol name="doc.text.fill" size={18} color="#FFF" />
            )}
            <Text style={styles.reportButtonText}>
              {generating ? "Generating..." : `Generate ${getReportLabel()}`}
            </Text>
            <IconSymbol name="square.and.arrow.up" size={16} color="#FFF" />
          </Pressable>
        )}

        {/* Overview Tab */}
        {tab === "overview" && (
          <View>
            {/* KPI Grid — dark-mode safe, icon-enhanced */}
            <View style={{ gap: 10, marginTop: 12, marginBottom: 4 }}>
              {([
                [
                  { label: "Total Revenue", value: `$${totalRevenue.toLocaleString()}`, color: "#FF9800", icon: "chart.bar.fill" as const },
                  { label: "Avg / Appt", value: `$${overviewData.avgRevenue}`, color: "#FF9800", icon: "dollarsign.circle.fill" as const },
                ],
                [
                  { label: "Total Clients", value: overviewData.totalClients, color: "#4CAF50", icon: "person.2.fill" as const },
                  { label: "New (30d)", value: overviewData.newClientsLast30, color: "#4CAF50", icon: "person.badge.plus" as const },
                ],
                [
                  { label: "Completed", value: overviewData.completed, color: "#2196F3", icon: "checkmark.circle.fill" as const },
                  { label: "Completion %", value: `${overviewData.completionRate}%`, color: "#2196F3", icon: "percent" as const },
                ],
                [
                  { label: "Cancelled", value: overviewData.cancelled, color: "#EF4444", icon: "xmark.circle.fill" as const },
                  { label: "Cancel Rate", value: `${overviewData.cancellationRate}%`, color: "#EF4444", icon: "exclamationmark.triangle.fill" as const },
                ],
              ] as const).map((row, rowIdx) => (
                <View key={rowIdx} style={{ flexDirection: "row", gap: 10 }}>
                  {row.map((kpi) => (
                    <View key={kpi.label} style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: kpi.color + "40" }]}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: kpi.color + "18", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                        <IconSymbol name={kpi.icon} size={18} color={kpi.color} />
                      </View>
                      <Text style={{ fontSize: fs.lg, fontWeight: "800", color: kpi.color }}>{String(kpi.value)}</Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4, textAlign: "center" }}>{kpi.label}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>

            {/* Monthly Revenue Goal Progress Bar */}
            {state.settings.monthlyRevenueGoal > 0 && (() => {
              const now = new Date();
              const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10);
              const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().substring(0, 10);
              const thisMonthRevenue = allLocationAppts
                .filter((a) => a.status === "completed" && a.date >= thisMonthStart && a.date <= thisMonthEnd)
                .reduce((sum, a) => {
                  if (a.totalPrice != null) return sum + a.totalPrice;
                  const svc = getServiceById(a.serviceId);
                  return sum + (svc?.price ?? 0);
                }, 0);
              const goal = state.settings.monthlyRevenueGoal;
              const pct = Math.min(100, Math.round((thisMonthRevenue / goal) * 100));
              const goalColor = pct >= 100 ? "#4CAF50" : pct >= 70 ? "#FF9800" : "#EF4444";
              return (
                <View style={[styles.sectionCard, { backgroundColor: goalColor + "10", borderColor: goalColor + "30", marginTop: 10 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={{ fontSize: fs.sm, fontWeight: "700", color: goalColor }}>This Month's Goal</Text>
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: goalColor }}>{pct}%</Text>
                  </View>
                  <View style={{ height: 10, backgroundColor: goalColor + "25", borderRadius: 5, overflow: "hidden" }}>
                    <View style={{ height: 10, width: `${pct}%`, backgroundColor: goalColor, borderRadius: 5 }} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ fontSize: fs.xs, color: goalColor + "CC" }}>${thisMonthRevenue.toLocaleString()} earned</Text>
                    <Text style={{ fontSize: fs.xs, color: goalColor + "CC" }}>Goal: ${goal.toLocaleString()}</Text>
                  </View>
                  {pct >= 100 && (
                    <Text style={{ fontSize: fs.xs, fontWeight: "700", color: goalColor, textAlign: "center", marginTop: 6 }}>🎉 Goal reached! Great work!</Text>
                  )}
                </View>
              );
            })()}

            {/* Revenue Trend — last 6 months */}
            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Revenue — Last 6 Months</Text>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 80 }}>
                {overviewData.last6Months.map((m) => (
                  <View key={m.label} style={{ flex: 1, alignItems: "center" }}>
                    <View style={{
                      width: "100%",
                      height: Math.max((m.revenue / overviewData.maxMonthRev) * 64, m.revenue > 0 ? 4 : 0),
                      backgroundColor: colors.primary,
                      borderRadius: 4,
                    }} />
                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>{m.label}</Text>
                    <Text style={{ fontSize: 9, color: colors.primary, fontWeight: "600" }}>
                      {m.revenue > 0 ? `$${Math.round(m.revenue / 1000)}k` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Highlights row */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={[styles.sectionCard, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 4 }}>Busiest Day</Text>
                <Text style={{ fontSize: fs.lg, fontWeight: "800", color: colors.primary }}>{overviewData.busiestDay}</Text>
              </View>
              <View style={[styles.sectionCard, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.xs, color: colors.muted, marginBottom: 4 }}>Avg Rating</Text>
                <Text style={{ fontSize: fs.lg, fontWeight: "800", color: "#f59e0b" }}>
                  {overviewData.avgRating ? `${overviewData.avgRating} ★` : "—"}
                </Text>
                {overviewData.reviewCount > 0 && (
                  <Text style={{ fontSize: 10, color: colors.muted }}>{overviewData.reviewCount} reviews</Text>
                )}
              </View>
            </View>

            {/* Top Client */}
            {overviewData.topClient && (
              <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Top Client</Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[styles.avatar, { backgroundColor: "#4CAF5018" }]}>
                    <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#4CAF50" }}>{overviewData.topClient.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{overviewData.topClient.name}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>{overviewData.topClient.apptCount} appointments · ${overviewData.topClient.totalSpent} spent</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Top Service */}
            {overviewData.topService && (
              <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Top Service</Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[styles.avatar, { backgroundColor: overviewData.topService.color + "18" }]}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: overviewData.topService.color }} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{overviewData.topService.name}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>{overviewData.topService.bookings} bookings · ${overviewData.topService.price}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Quick nav to detailed tabs */}
            <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.muted, marginTop: 8, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Detailed Reports</Text>
            {[
              { label: "Clients", tab: "clients", icon: "person.2.fill" as const, color: "#4CAF50" },
              { label: "Appointments", tab: "appointments", icon: "calendar" as const, color: "#2196F3" },
              { label: "Revenue", tab: "revenue", icon: "chart.bar.fill" as const, color: "#FF9800" },
              { label: "Top Services", tab: "topservice", icon: "crown.fill" as const, color: "#9C27B0" },
              { label: "Staff Performance", tab: "staff", icon: "person.2.fill" as const, color: "#6366f1" },
              { label: "Promo Codes", tab: "promoCodes", icon: "ticket.fill" as const, color: "#0369a1" },
            ].map((item) => (
              <Pressable
                key={item.tab}
                onPress={() => router.replace({ pathname: "/analytics-detail", params: { tab: item.tab } })}
                style={({ pressed }) => [styles.listItem, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={[styles.avatar, { backgroundColor: item.color + "18" }]}>
                  <IconSymbol name={item.icon} size={18} color={item.color} />
                </View>
                <Text style={{ flex: 1, marginLeft: 12, fontSize: fs.sm, fontWeight: "600", color: colors.foreground }}>{item.label}</Text>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Clients Tab */}
        {tab === "clients" && (
          <View>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: "#4CAF5040" }]}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#4CAF5018", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <IconSymbol name="person.2.fill" size={24} color="#4CAF50" />
              </View>
              <Text style={{ fontSize: 40, fontWeight: "800", color: "#4CAF50" }}>
                {clientsForActiveLocation.length}
              </Text>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 4 }}>
                Total Clients
              </Text>
            </View>
            {/* Quick stats */}
            <View style={styles.quickStats}>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.lg, fontWeight: "700", color: colors.primary }}>
                  {clientsData.filter((c) => c.apptCount > 0).length}
                </Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Active</Text>
              </View>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.lg, fontWeight: "700", color: "#FF9800" }}>
                  ${clientsData.reduce((s, c) => s + c.totalSpent, 0).toLocaleString()}
                </Text>
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Total Spent</Text>
              </View>
            </View>
            {clientsData.map((c) => (
              <Pressable
                key={c.id}
                onPress={() =>
                  router.push({
                    pathname: "/client-detail",
                    params: { id: c.id },
                  })
                }
                style={({ pressed }) => [
                  styles.listItem,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View
                  style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}
                >
                  <Text
                    style={{
                      fontSize: fs.md,
                      fontWeight: "700",
                      color: colors.primary,
                    }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text
                    style={{
                      fontSize: fs.sm,
                      fontWeight: "600",
                      color: colors.foreground,
                    }}
                  >
                    {c.name}
                  </Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted }}>
                    {c.phone || c.email || "No contact info"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <View
                    style={[
                      styles.countBadge,
                      { backgroundColor: colors.primary + "15" },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: fs.xs,
                        fontWeight: "600",
                        color: colors.primary,
                      }}
                    >
                      {c.apptCount} appts
                    </Text>
                  </View>
                  {c.totalSpent > 0 && (
                    <Text style={{ fontSize: fs.xs, color: "#FF9800", fontWeight: "600", marginTop: 4 }}>
                      ${c.totalSpent}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* Appointments Tab */}
        {tab === "appointments" && (
          <View>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: "#2196F340" }]}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#2196F318", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <IconSymbol name="calendar" size={24} color="#2196F3" />
              </View>
              <Text style={{ fontSize: 40, fontWeight: "800", color: "#2196F3" }}>
                {state.appointments.filter((a) => a.status !== "cancelled").length}
              </Text>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 4 }}>
                Total Appointments
              </Text>
            </View>
            {/* Status breakdown */}
            <View style={styles.quickStats}>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#4CAF50" }}>
                  {state.appointments.filter((a) => a.status === "completed").length}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>Completed</Text>
              </View>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#2196F3" }}>
                  {state.appointments.filter((a) => a.status === "confirmed").length}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>Confirmed</Text>
              </View>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#FF9800" }}>
                  {state.appointments.filter((a) => a.status === "pending").length}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>Pending</Text>
              </View>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#EF4444" }}>
                  {state.appointments.filter((a) => a.status === "cancelled").length}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>Cancelled</Text>
              </View>
            </View>
            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 4 }]}>
              <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Monthly Breakdown</Text>
              {appointmentsData.map((m) => {
                const total = m.confirmed + m.completed + m.pending;
                const grandTotal = Math.max(total + m.cancelled, 1);
                const monthLabel = new Date(m.month + "-01").toLocaleDateString(
                  "en-US",
                  { month: "short", year: "2-digit" }
                );
                return (
                  <View key={m.month} style={[styles.barRow, { marginBottom: 14 }]}>
                    <Text style={{ width: 56, fontSize: fs.xs, fontWeight: "600", color: colors.muted }}>
                      {monthLabel}
                    </Text>
                    <View style={{ flex: 1, marginHorizontal: 8 }}>
                      <View style={{ height: 20, borderRadius: 10, backgroundColor: colors.border, flexDirection: "row", overflow: "hidden" }}>
                        <View style={{ height: 20, width: `${(m.completed / grandTotal) * 100}%`, backgroundColor: "#4CAF50" }} />
                        <View style={{ height: 20, width: `${(m.confirmed / grandTotal) * 100}%`, backgroundColor: "#2196F3" }} />
                        <View style={{ height: 20, width: `${(m.pending / grandTotal) * 100}%`, backgroundColor: "#FF9800" }} />
                      </View>
                    </View>
                    <Text style={{ width: 32, fontSize: fs.xs, color: colors.foreground, textAlign: "right", fontWeight: "700" }}>
                      {total}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#4CAF50" }]} />
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Completed</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#2196F3" }]} />
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Confirmed</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#FF9800" }]} />
                <Text style={{ fontSize: fs.xs, color: colors.muted }}>Pending</Text>
              </View>
            </View>
            {appointmentsData.length === 0 && (
              <Text
                style={{
                  textAlign: "center",
                  color: colors.muted,
                  marginTop: 20,
                }}
              >
                No appointment data yet
              </Text>
            )}
            {/* Cancellation Reason Breakdown */}
            {(() => {
              const cancelledWithReason = state.appointments.filter((a) => a.status === "cancelled" && a.cancellationReason);
              if (cancelledWithReason.length === 0) return null;
              const reasonMap: Record<string, number> = {};
              cancelledWithReason.forEach((a) => {
                const r = a.cancellationReason!;
                reasonMap[r] = (reasonMap[r] ?? 0) + 1;
              });
              const sorted = Object.entries(reasonMap).sort((a, b) => b[1] - a[1]);
              const maxCount = sorted[0]?.[1] ?? 1;
              const REASON_COLORS = ["#EF4444", "#F97316", "#EAB308", "#8B5CF6", "#06B6D4", "#64748B"];
              return (
                <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 12 }]}>
                  <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Cancellation Reasons</Text>
                  {sorted.map(([reason, count], idx) => (
                    <View key={reason} style={{ marginBottom: 10 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                        <Text style={{ fontSize: fs.xs, color: colors.foreground, flex: 1 }} numberOfLines={1}>{reason}</Text>
                        <Text style={{ fontSize: fs.xs, fontWeight: "700", color: REASON_COLORS[idx % REASON_COLORS.length] }}>{count}</Text>
                      </View>
                      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                        <View style={{ height: 8, width: `${Math.round((count / maxCount) * 100)}%`, backgroundColor: REASON_COLORS[idx % REASON_COLORS.length], borderRadius: 4 }} />
                      </View>
                    </View>
                  ))}
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 4 }}>{cancelledWithReason.length} of {state.appointments.filter((a) => a.status === "cancelled").length} cancelled appointments have a recorded reason</Text>
                </View>
              );
            })()}
          </View>
        )}

        {/* Revenue Tab */}
        {tab === "revenue" && (
          <View>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: "#FF980040" }]}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#FF980018", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <IconSymbol name="chart.bar.fill" size={24} color="#FF9800" />
              </View>
              <Text style={{ fontSize: 40, fontWeight: "800", color: "#FF9800" }}>
                ${totalRevenue.toLocaleString()}
              </Text>
              <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 4 }}>
                Total Revenue
              </Text>
            </View>
            {/* Revenue quick stats */}
            <View style={styles.quickStats}>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.primary }}>
                  {state.appointments.filter((a) => a.status === "completed").length}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>Paid Appts</Text>
              </View>
              <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#FF9800" }}>
                  ${state.appointments.filter((a) => a.status === "completed").length > 0
                    ? Math.round(totalRevenue / state.appointments.filter((a) => a.status === "completed").length)
                    : 0}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>Avg/Appt</Text>
              </View>
            </View>
            {revenueData.length > 0 && (
              <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 8 }]}>
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Revenue by Service</Text>
                {revenueData.map((r) => {
                  const pct = totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 100) : 0;
                  return (
                    <View key={r.name} style={{ marginBottom: 14 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: r.color }} />
                          <Text style={{ fontSize: fs.sm, fontWeight: "600", color: colors.foreground, flex: 1 }} numberOfLines={1}>{r.name}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: fs.sm, fontWeight: "800", color: "#FF9800" }}>${r.revenue.toLocaleString()}</Text>
                          <Text style={{ fontSize: fs.xs, color: colors.muted }}>{r.count} appts · {pct}%</Text>
                        </View>
                      </View>
                      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                        <View style={{ height: 8, width: `${pct}%`, backgroundColor: r.color, borderRadius: 4 }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {revenueData.length === 0 && (
              <Text
                style={{
                  textAlign: "center",
                  color: colors.muted,
                  marginTop: 20,
                }}
              >
                No revenue data yet. Complete appointments to track revenue.
              </Text>
            )}
          </View>
        )}

        {/* Top Service Tab */}
        {tab === "topservice" && (
          <View>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: "#9C27B040" }]}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#9C27B018", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <IconSymbol name="crown.fill" size={24} color="#9C27B0" />
              </View>
              {serviceRanking.length > 0 ? (
                <>
                  <Text style={{ fontSize: fs.xs, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Top Service</Text>
                  <Text style={{ fontSize: fs.xl, fontWeight: "800", color: "#9C27B0", textAlign: "center" }}>
                    {serviceRanking[0].name}
                  </Text>
                  <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 4 }}>
                    {serviceRanking[0].bookings} bookings
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: fs.sm, color: colors.muted }}>No services yet</Text>
              )}
            </View>
            {serviceRanking.length > 0 && (
              <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Service Rankings</Text>
                {serviceRanking.map((s, idx) => {
                  const pct = maxBar > 0 ? Math.round((s.bookings / maxBar) * 100) : 0;
                  const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];
                  const rankColor = idx < 3 ? medalColors[idx] : colors.muted;
                  return (
                    <View key={s.id} style={{ marginBottom: 14 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: rankColor + "22", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                          <Text style={{ fontSize: fs.xs, fontWeight: "800", color: rankColor }}>#{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>{s.name}</Text>
                          <Text style={{ fontSize: fs.xs, color: colors.muted }}>${s.price} · {s.duration} min</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: fs.md, fontWeight: "800", color: "#9C27B0" }}>{s.bookings}</Text>
                          <Text style={{ fontSize: 10, color: colors.muted }}>bookings</Text>
                        </View>
                      </View>
                      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                        <View style={{ height: 8, width: `${pct}%`, backgroundColor: s.color, borderRadius: 4 }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Staff Performance Tab */}
        {tab === "staff" && (() => {
          const staffData = state.staff
            .filter((sm) => sm.active)
            .map((sm) => {
              const smAppts = filteredAppts.filter(
                (a) => a.staffId === sm.id && a.status !== "cancelled"
              );
              const completed = smAppts.filter((a) => a.status === "completed");
              const revenue = completed.reduce((sum, a) => {
                if (a.totalPrice != null) return sum + a.totalPrice;
                const svc = getServiceById(a.serviceId);
                return sum + (svc?.price ?? 0);
              }, 0);
              // Avg rating from reviews linked to appointments by this staff
              const smApptIds = new Set(smAppts.map((a) => a.id));
              const smReviews = state.reviews.filter(
                (r) => r.appointmentId && smApptIds.has(r.appointmentId)
              );
              const avgRating =
                smReviews.length > 0
                  ? smReviews.reduce((s, r) => s + r.rating, 0) / smReviews.length
                  : null;
              const completionRate =
                smAppts.length > 0
                  ? Math.round((completed.length / smAppts.length) * 100)
                  : 0;
              const commissionDue = sm.commissionRate != null
                ? Math.round(revenue * (sm.commissionRate / 100) * 100) / 100
                : null;
              return {
                ...sm,
                apptCount: smAppts.length,
                completedCount: completed.length,
                revenue,
                avgRating,
                reviewCount: smReviews.length,
                completionRate,
                commissionDue,
              };
            })
            .sort((a, b) => b.revenue - a.revenue);

          const maxRevenue = Math.max(...staffData.map((s) => s.revenue), 1);
          const totalStaffRevenue = staffData.reduce((s, m) => s + m.revenue, 0);

          const top3 = staffData.slice(0, 3);

          return (
            <View>

              {/* ── Top Staff Podium ── */}
              {top3.length > 0 && (
                <View style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                    <IconSymbol name="crown.fill" size={16} color="#f59e0b" />
                    <Text style={{ fontSize: fs.sm, fontWeight: "800", color: colors.foreground }}>Top Staff</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted, marginLeft: 2 }}>by revenue</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {top3.map((sm, idx) => {
                      const medals = ["🥇", "🥈", "🥉"];
                      const podiumColors = ["#FFD700", "#C0C0C0", "#CD7F32"];
                      const podiumBorder = ["#FFD70050", "#C0C0C050", "#CD7F3250"];
                      return (
                        <View
                          key={sm.id}
                          style={[{
                            flex: 1,
                            borderRadius: 16,
                            padding: 12,
                            alignItems: "center",
                            gap: 4,
                            borderWidth: 1.5,
                          }, {
                            backgroundColor: colors.surface,
                            borderColor: podiumBorder[idx] ?? colors.border,
                          }]}
                        >
                          <Text style={{ fontSize: fs.lg }}>{medals[idx]}</Text>
                          {/* Avatar circle */}
                          <View style={[{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: 2,
                          }, { backgroundColor: sm.color + "22", borderColor: podiumColors[idx] ?? sm.color }]}>
                            <Text style={{ fontSize: fs.md, fontWeight: "800", color: sm.color }}>
                              {sm.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          {/* Name */}
                          <Text style={{ fontSize: fs.xs, fontWeight: "700", color: colors.foreground, textAlign: "center" }} numberOfLines={1}>
                            {sm.name.split(" ")[0]}
                          </Text>
                          {/* Revenue */}
                          <Text style={{ fontSize: fs.xs, fontWeight: "800", color: podiumColors[idx] ?? sm.color }}>
                            ${sm.revenue >= 1000 ? (sm.revenue / 1000).toFixed(1) + "k" : sm.revenue.toLocaleString()}
                          </Text>
                          {/* Appts */}
                          <Text style={{ fontSize: 10, color: colors.muted }}>{sm.apptCount} appts</Text>
                          {/* Star rating */}
                          {sm.avgRating !== null && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                              <Text style={{ fontSize: 10, color: "#f59e0b" }}>★</Text>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: "#f59e0b" }}>{sm.avgRating.toFixed(1)}</Text>
                              <Text style={{ fontSize: 9, color: colors.muted }}>({sm.reviewCount})</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Summary */}
              <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: "#9C27B040" }]}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#9C27B018", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <IconSymbol name="person.2.fill" size={24} color="#9C27B0" />
                </View>
                <Text style={{ fontSize: 40, fontWeight: "800", color: "#9C27B0" }}>{staffData.length}</Text>
                <Text style={{ fontSize: fs.sm, color: colors.muted, marginTop: 4 }}>Active Staff Members</Text>
                <View style={[styles.quickStats, { marginTop: 16, alignSelf: "stretch" }]}>
                  <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: "#FF980040" }]}>
                    <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#FF9800" }}>${totalStaffRevenue.toLocaleString()}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Total Revenue</Text>
                  </View>
                  <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: "#2196F340" }]}>
                    <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#2196F3" }}>{staffData.reduce((s, m) => s + m.apptCount, 0)}</Text>
                    <Text style={{ fontSize: fs.xs, color: colors.muted }}>Total Appts</Text>
                  </View>
                  {staffData.some((m) => m.commissionDue != null) && (
                    <View style={[styles.quickStatCard, { backgroundColor: colors.surface, borderColor: "#4CAF5040" }]}>
                      <Text style={{ fontSize: fs.md, fontWeight: "700", color: "#4CAF50" }}>
                        ${staffData.reduce((s, m) => s + (m.commissionDue ?? 0), 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </Text>
                      <Text style={{ fontSize: fs.xs, color: colors.muted }}>Commission Due</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Staff Performance Alerts */}
              {(() => {
                const threshold = state.settings.staffAlertThreshold ?? 80;
                if (threshold === 0) return null;
                const underperforming = staffData.filter(
                  (sm) => sm.apptCount >= 5 && sm.completionRate < threshold
                );
                if (underperforming.length === 0) return null;
                return (
                  <View style={{ backgroundColor: "#FEF2F2", borderColor: "#EF444430", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <IconSymbol name="exclamationmark.triangle.fill" size={18} color="#EF4444" />
                      <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#EF4444" }}>Performance Alert</Text>
                    </View>
                    <Text style={{ fontSize: fs.xs, color: "#EF4444CC", marginBottom: 8 }}>
                      {underperforming.length} staff member{underperforming.length > 1 ? "s are" : " is"} below the {threshold}% completion threshold:
                    </Text>
                    {underperforming.map((sm) => (
                      <View key={sm.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 }}>
                        <Text style={{ fontSize: fs.xs, fontWeight: "600", color: "#EF4444" }}>{sm.name}</Text>
                        <Text style={{ fontSize: fs.xs, color: "#EF4444" }}>{sm.completionRate}% completion ({sm.completedCount}/{sm.apptCount} appts)</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}

              {staffData.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 40 }}>
                  <Text style={{ fontSize: fs.sm, color: colors.muted }}>No staff data for this period</Text>
                </View>
              ) : (
                staffData.map((sm, idx) => (
                  <View
                    key={sm.id}
                    style={[styles.listItem, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 10 }]}
                  >
                    {/* Rank badge */}
                    <View
                      style={[styles.avatar, {
                        backgroundColor:
                          idx === 0 ? "#FFD70020" :
                          idx === 1 ? "#C0C0C020" :
                          idx === 2 ? "#CD7F3220" :
                          sm.color + "18",
                      }]}
                    >
                      {idx < 3 ? (
                        <Text style={{ fontSize: fs.sm }}>
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                        </Text>
                      ) : (
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sm.color }} />
                      )}
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>{sm.name}</Text>
                        <View style={{ backgroundColor: sm.color + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, fontWeight: "600", color: sm.color }}>{sm.role}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                        <Text style={{ fontSize: fs.xs, color: colors.muted }}>{sm.apptCount} appts</Text>
                        <Text style={{ fontSize: fs.xs, color: "#4CAF50" }}>{sm.completionRate}% done</Text>
                        {sm.avgRating !== null && (
                          <Text style={{ fontSize: fs.xs, color: "#f59e0b" }}>★ {sm.avgRating.toFixed(1)}</Text>
                        )}
                      </View>
                      {/* Revenue bar */}
                      <View style={{ marginTop: 8, height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}>
                        <View style={{ height: 4, width: `${(sm.revenue / maxRevenue) * 100}%`, backgroundColor: sm.color, borderRadius: 2 }} />
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
                        <Text style={{ fontSize: fs.xs, color: sm.color, fontWeight: "600" }}>${sm.revenue.toLocaleString()} revenue</Text>
                        {sm.commissionDue != null && (
                          <Text style={{ fontSize: fs.xs, color: "#4CAF50", fontWeight: "600" }}>
                            ${sm.commissionDue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} commission ({sm.commissionRate}%)
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          );
        })()}

        {/* ─── Promo Codes Tab ─────────────────────────────────── */}
        {tab === "promoCodes" && (() => {
          const promoCodes = state.promoCodes || [];
          const appts = filterAppointmentsByLocation(state.appointments);
          // Build per-code stats from appointments using discountName to match
          const codeStats = promoCodes.map((pc) => {
            const matchingAppts = appts.filter((a) => {
              if (!a.discountName) return false;
              return a.discountName.toLowerCase().includes(pc.label.toLowerCase()) ||
                     a.discountName.toLowerCase().includes(pc.code.toLowerCase());
            });
            const totalDiscount = matchingAppts.reduce((s, a) => s + (a.discountAmount || 0), 0);
            const totalRevenue = matchingAppts.reduce((s, a) => s + (a.totalPrice || 0), 0);
            return { ...pc, apptCount: matchingAppts.length, totalDiscount, totalRevenue };
          }).sort((a, b) => b.apptCount - a.apptCount);

          const totalDiscountGiven = codeStats.reduce((s, c) => s + c.totalDiscount, 0);
          const totalRevenueViaPromo = codeStats.reduce((s, c) => s + c.totalRevenue, 0);
          const totalUses = codeStats.reduce((s, c) => s + c.usedCount, 0);

          return (
            <View>
              {/* Summary cards */}
              <View style={{ flexDirection: "row", gap: 10, marginVertical: 16 }}>
                <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#0369a140", alignItems: "center" }}>
                  <IconSymbol name="tag.fill" size={18} color="#0369a1" />
                  <Text style={{ fontSize: fs.lg, fontWeight: "800", color: "#0369a1", marginTop: 4 }}>{totalUses}</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, textAlign: "center" }}>Total Uses</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#ef444440", alignItems: "center" }}>
                  <IconSymbol name="minus.circle.fill" size={18} color="#ef4444" />
                  <Text style={{ fontSize: fs.lg, fontWeight: "800", color: "#ef4444", marginTop: 4 }}>${totalDiscountGiven.toFixed(0)}</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, textAlign: "center" }}>Discount Given</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#22c55e40", alignItems: "center" }}>
                  <IconSymbol name="checkmark.circle.fill" size={18} color="#22c55e" />
                  <Text style={{ fontSize: fs.lg, fontWeight: "800", color: "#22c55e", marginTop: 4 }}>${totalRevenueViaPromo.toFixed(0)}</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 2, textAlign: "center" }}>Revenue via Promo</Text>
                </View>
              </View>

              {promoCodes.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 40 }}>
                  <Text style={{ fontSize: fs.xxl }}>🎫</Text>
                  <Text style={{ fontSize: fs.md, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>No Promo Codes Yet</Text>
                  <Text style={{ fontSize: fs.xs, color: colors.muted, marginTop: 6, textAlign: "center" }}>Create promo codes in Settings → Tools → Promo Codes</Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {codeStats.map((pc) => {
                    const discountStr = pc.percentage > 0 ? `${pc.percentage}% off` : pc.flatAmount ? `$${pc.flatAmount} off` : "—";
                    const usageRatio = pc.maxUses ? pc.usedCount / pc.maxUses : null;
                    const isExpired = pc.expiresAt ? pc.expiresAt < new Date().toISOString().substring(0, 10) : false;
                    const statusColor = !pc.active || isExpired ? colors.muted : "#22c55e";
                    const statusLabel = !pc.active ? "Inactive" : isExpired ? "Expired" : "Active";
                    return (
                      <View key={pc.id} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <View style={{ backgroundColor: "#0369a118", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: fs.xs, fontWeight: "800", color: "#0369a1", letterSpacing: 1 }}>{pc.code}</Text>
                            </View>
                            <Text style={{ fontSize: fs.xs, color: colors.muted }}>{pc.label}</Text>
                          </View>
                          <View style={{ backgroundColor: statusColor + "18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ fontSize: fs.xs, fontWeight: "600", color: statusColor }}>{statusLabel}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 16, marginBottom: 8 }}>
                          <View>
                            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Discount</Text>
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#0369a1" }}>{discountStr}</Text>
                          </View>
                          <View>
                            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Uses</Text>
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: colors.foreground }}>{pc.usedCount}{pc.maxUses ? ` / ${pc.maxUses}` : ""}</Text>
                          </View>
                          <View>
                            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Discount Given</Text>
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#ef4444" }}>${pc.totalDiscount.toFixed(0)}</Text>
                          </View>
                          <View>
                            <Text style={{ fontSize: fs.xs, color: colors.muted }}>Revenue</Text>
                            <Text style={{ fontSize: fs.sm, fontWeight: "700", color: "#22c55e" }}>${pc.totalRevenue.toFixed(0)}</Text>
                          </View>
                        </View>
                        {usageRatio !== null && (
                          <View>
                            <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}>
                              <View style={{ height: 4, width: `${Math.min(usageRatio * 100, 100)}%`, backgroundColor: usageRatio >= 1 ? "#ef4444" : "#0369a1", borderRadius: 2 }} />
                            </View>
                            <Text style={{ fontSize: 10, color: colors.muted, marginTop: 3 }}>{Math.round(usageRatio * 100)}% of max uses reached</Text>
                          </View>
                        )}
                        {pc.expiresAt && (
                          <Text style={{ fontSize: fs.xs, color: isExpired ? "#ef4444" : colors.muted, marginTop: 6 }}>
                            {isExpired ? "⚠️ Expired" : "⏰ Expires"}: {pc.expiresAt}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })()}
      </ScrollView>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: fs.md,
    fontWeight: "700",
  },
  reportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 16,
    marginBottom: 4,
  },
  reportButtonText: {
    fontSize: fs.sm,
    fontWeight: "700",
    color: "#FFF",
  },
  summaryCard: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginVertical: 16,
  },
  dateChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  kpiCard: {
    flex: 1,
    minWidth: 140,
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  quickStats: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  quickStatCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    overflow: "hidden",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  barChart: {
    marginTop: 12,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  barTrack: {
    flex: 1,
    height: 16,
    borderRadius: 8,
    backgroundColor: "transparent",
    flexDirection: "row",
    overflow: "hidden",
    marginHorizontal: 8,
  },
  barFill: {
    height: 16,
  },
  barSmall: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: 3,
    borderRadius: 2,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
