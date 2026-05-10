import { Express, Request, Response } from "express";
import * as db from "./db";
import { getPlatformConfig } from "./subscription";
import { sendBookingNotificationEmail, sendGiftNotificationEmail, sendGiftPurchaseConfirmationEmail } from "./email";
import { notifyOwner } from "./_core/notification";
import {
  notifyNewBooking,
  notifyCancellation,
  notifyReschedule,
  notifyWaitlist,
  sendExpoPush,
} from "./push";

// ─── Rate limiter for Manus platform notifyOwner ────────────────────────────
// Manus platform notifications have a strict rate limit per project.
// We throttle to at most 1 notification per 60 seconds globally to avoid
// "Rate Exceeded" errors when multiple bookings arrive in quick succession.
const NOTIFY_OWNER_COOLDOWN_MS = 60_000; // 60 seconds
let lastNotifyOwnerAt = 0;

async function throttledNotifyOwner(payload: Parameters<typeof notifyOwner>[0]): Promise<boolean> {
  const now = Date.now();
  if (now - lastNotifyOwnerAt < NOTIFY_OWNER_COOLDOWN_MS) {
    console.log("[Notify] Skipping Manus notification (rate limit cooldown active)");
    return false;
  }
  lastNotifyOwnerAt = now;
  try {
    return await notifyOwner(payload);
  } catch (err: any) {
    // Silently swallow rate limit errors so they don't break the booking flow
    if (err?.message?.includes("Rate") || err?.message?.includes("rate") || err?.code === "TOO_MANY_REQUESTS") {
      console.warn("[Notify] Manus notification rate limit hit, skipping.");
      return false;
    }
    throw err;
  }
}

// ─── Helper: Generate available time slots ──────────────────────────────────
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function generateAvailableSlots(
  date: string,
  duration: number,
  workingHours: any,
  appointments: any[],
  interval: number,
  customSchedule: any[],
  scheduleMode: "weekly" | "custom" = "weekly",
  bufferTime: number = 0,
  clientToday?: string | null,
  clientNowMinutes?: number | null
): string[] {
  const d = new Date(date + "T00:00:00");
  const dayIndex = d.getDay();
  const dayName = DAYS_OF_WEEK[dayIndex];

  const customDay = customSchedule.find((cs: any) => cs.date === date);
  let startMin: number, endMin: number;

  if (scheduleMode === "custom") {
    // Custom mode: only dates explicitly in customSchedule are available
    if (!customDay || !customDay.isOpen) return [];
    startMin = timeToMinutes(customDay.startTime || "09:00");
    endMin = timeToMinutes(customDay.endTime || "17:00");
  } else {
    // Weekly mode: use weekly hours, custom days can still override
    const abbr3 = dayName.slice(0, 3);
    const wh = workingHours?.[dayName] || workingHours?.[dayName.toLowerCase()] || workingHours?.[abbr3] || workingHours?.[abbr3.toLowerCase()];
    if (customDay) {
      if (!customDay.isOpen) return [];
      if (customDay.startTime && customDay.endTime) {
        // Workday ON with explicit hours — use them regardless of weekly schedule
        startMin = timeToMinutes(customDay.startTime);
        endMin = timeToMinutes(customDay.endTime);
      } else {
        // Workday ON but no explicit hours — use weekly hours as fallback.
        // Still open even if the weekly day is normally disabled.
        startMin = timeToMinutes(wh?.start || "09:00");
        endMin = timeToMinutes(wh?.end || "17:00");
      }
    } else {
      // No custom override — use weekly working hours
      // workingHours keys may be stored as full names ("Monday"), lowercase ("monday"),
      // or 3-letter abbreviations ("Mon") — check all three forms.
      if (!wh || !wh.enabled) return [];
      startMin = timeToMinutes(wh.start || "09:00");
      endMin = timeToMinutes(wh.end || "17:00");
    }
  }

  // Get confirmed/pending appointments for this date
  const bookedSlots = appointments
    .filter((a: any) => a.date === date && (a.status === "confirmed" || a.status === "pending"))
    .map((a: any) => ({
      start: timeToMinutes(a.time),
      end: timeToMinutes(a.time) + (a.duration || 60),
    }));

  const slots: string[] = [];
  // Use client's local date/time if provided (avoids UTC timezone mismatch)
  const now = new Date();
  const today = clientToday || `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
  const currentMinutes = (clientNowMinutes !== null && clientNowMinutes !== undefined) ? clientNowMinutes : (now.getHours() * 60 + now.getMinutes());

  // Slot at time t is available if t >= currentMinutes (i.e., 9:00 AM is available at exactly 9:00 AM)
  // It becomes unavailable only after the minute has passed (t < currentMinutes)
  for (let t = startMin; t + duration <= endMin; t += interval) {
    // Skip past times for today: slot is past only if its start minute is strictly less than now
    if (date === today && t < currentMinutes) continue;

    // Check for conflicts
    const slotEnd = t + duration;
    const conflict = bookedSlots.some(
      (b: any) => t < (b.end + bufferTime) && slotEnd > (b.start - bufferTime)
    );
    if (!conflict) {
      slots.push(minutesToTime(t));
    }
  }
  return slots;
}

function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// ─── Register Public Routes ─────────────────────────────────────────

export function registerPublicRoutes(app: Express) {
  // ── Landing page at root ──────────────────────────────────────────
  app.get("/", (_req: Request, res: Response) => {
    import("path").then((pathMod) => {
      import("fs").then((fsMod) => {
        const landingPath = pathMod.join(process.cwd(), "public/landing.html");
        try {
          const html = fsMod.readFileSync(landingPath, "utf-8");
          res.setHeader("Content-Type", "text/html");
          res.send(html);
        } catch {
          res.status(404).send("Landing page not found");
        }
      });
    });
  });

  // ── Public REST API endpoints ──────────────────────────────────────

  /** Get business info by slug */
  app.get("/api/public/business/:slug", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      // Compute live avgRating and reviewCount from reviews table
      const reviewsList = await db.getReviewsByOwner(owner.id);
      const reviewCount = reviewsList.length;
      const avgRating = reviewCount > 0
        ? Math.round((reviewsList.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
        : null;
      res.json({
        id: owner.id,
        businessName: owner.businessName,
        ownerName: owner.ownerName,
        email: owner.email,
        address: owner.address,
        website: owner.website,
        description: owner.description,
        phone: owner.phone,
        temporaryClosed: owner.temporaryClosed,
        workingHours: owner.workingHours,
        cancellationPolicy: owner.cancellationPolicy,
        businessLogoUri: owner.businessLogoUri,
        coverPhotoUri: (owner as any).coverPhotoUri ?? null,
        avgRating,
        reviewCount,
        stripeConnectEnabled: (owner as any).stripeConnectEnabled ?? false,
        zelleHandle: (owner as any).zelleHandle ?? "",
        cashAppHandle: (owner as any).cashAppHandle ?? "",
        venmoHandle: (owner as any).venmoHandle ?? "",
      });
    } catch (err) {
      console.error("[Public API] Error fetching business:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get services for a business */
  app.get("/api/public/business/:slug/services", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const servicesList = await db.getServicesByOwner(owner.id);
      const locationIdFilter = req.query.locationId as string | undefined;
      const filteredServices = locationIdFilter
        ? servicesList.filter((s) => {
            const locIds: string[] | null = Array.isArray(s.locationIds)
              ? s.locationIds
              : s.locationIds
              ? JSON.parse(s.locationIds as unknown as string)
              : null;
            // null/empty locationIds means available at all locations
            if (!locIds || locIds.length === 0) return true;
            return locIds.includes(locationIdFilter);
          })
        : servicesList;
      // Count appointments per service for "Most Popular" ranking
      const appts = await db.getAppointmentsByOwner(owner.id);
      const apptCountMap: Record<string, number> = {};
      appts.forEach((a: any) => {
        if (a.serviceLocalId) {
          apptCountMap[a.serviceLocalId] = (apptCountMap[a.serviceLocalId] || 0) + 1;
        }
      });
      res.json(filteredServices.map((s) => ({
        localId: s.localId,
        name: s.name,
        duration: s.duration,
        price: s.price,
        color: s.color,
        category: s.category || null,
        description: (s as any).description || null,
        photoUri: ((s as any).photoUri && /^https?:\/\//i.test((s as any).photoUri)) ? (s as any).photoUri : null,
        appointmentCount: apptCountMap[s.localId] || 0,
        locationIds: Array.isArray(s.locationIds)
          ? s.locationIds
          : s.locationIds
          ? JSON.parse(s.locationIds as unknown as string)
          : null,
        serviceType: (s as any).serviceType ?? 'in_store',
        travelFee: (s as any).travelFee != null ? parseFloat(String((s as any).travelFee)) : null,
        maxTravelDistance: (s as any).maxTravelDistance != null ? parseFloat(String((s as any).maxTravelDistance)) : null,
        travelDuration: (s as any).travelDuration != null ? Number((s as any).travelDuration) : null,
        travelRatePerMile: (s as any).travelRatePerMile != null ? parseFloat(String((s as any).travelRatePerMile)) : null,
        minTravelFee: (s as any).minTravelFee != null ? parseFloat(String((s as any).minTravelFee)) : null,
      })));
    } catch (err) {
      console.error("[Public API] Error fetching services:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get staff members for a business (public-facing) */
  app.get("/api/public/business/:slug/staff", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const staffList = await db.getStaffByOwner(owner.id);
      // Load services so we can convert numeric DB ids → localId UUID strings
      const servicesList = await db.getServicesByOwner(owner.id);
      // Load reviews + appointments to compute per-staff ratings
      const [reviewsList, appointmentsList] = await Promise.all([
        db.getReviewsByOwner(owner.id),
        db.getAppointmentsByOwner(owner.id),
      ]);
      // Build a map: staffLocalId → { sum, count }
      const staffRatingMap = new Map<string, { sum: number; count: number }>();
      for (const review of reviewsList) {
        if (!review.appointmentLocalId) continue;
        const appt = appointmentsList.find((a: any) => a.localId === review.appointmentLocalId);
        if (!appt?.staffId) continue;
        const entry = staffRatingMap.get(appt.staffId) ?? { sum: 0, count: 0 };
        entry.sum += review.rating;
        entry.count += 1;
        staffRatingMap.set(appt.staffId, entry);
      }
      // Only return active staff with their name, services, and working hours
      res.json(staffList.filter((s: any) => s.active !== false).map((s: any) => {
        // serviceIds in the DB are stored as numeric DB primary keys (from staff-form.tsx svc.id).
        // The public booking page filters staff by selectedService.localId (a UUID string).
        // We must convert numeric ids → localId strings so the client-side filter works.
        const rawServiceIds: any[] = Array.isArray(s.serviceIds) ? s.serviceIds : (s.serviceIds ? JSON.parse(s.serviceIds) : []);
        const serviceLocalIds: string[] = rawServiceIds
          .map((numId: any) => {
            // If it's already a UUID string (e.g. already migrated data), pass through
            if (typeof numId === 'string' && numId.includes('-')) return numId;
            // Otherwise treat as numeric DB id and look up the localId
            const svc = servicesList.find((sv: any) => sv.id === numId || sv.id === Number(numId));
            return svc ? svc.localId : null;
          })
          .filter((id: string | null): id is string => id !== null);
        return {
          localId: s.localId,
          name: s.name,
          role: s.role || "",
          color: s.color || "#6366f1",
          photoUri: ((s as any).photoUri && /^https?:\/\//i.test((s as any).photoUri)) ? (s as any).photoUri : null,
          serviceIds: serviceLocalIds,
          locationIds: Array.isArray(s.locationIds) ? s.locationIds : (s.locationIds ? JSON.parse(s.locationIds) : null),
          workingHours: s.workingHours ? (typeof s.workingHours === 'object' ? s.workingHours : JSON.parse(s.workingHours)) : null,
          avgRating: staffRatingMap.has(s.localId) ? Math.round((staffRatingMap.get(s.localId)!.sum / staffRatingMap.get(s.localId)!.count) * 10) / 10 : null,
          reviewCount: staffRatingMap.get(s.localId)?.count ?? 0,
        };
      }));
    } catch (err) {
      console.error("[Public API] Error fetching staff:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get locations for a business */
  app.get("/api/public/business/:slug/locations", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const locs = await db.getLocationsByOwner(owner.id);
      res.json(locs.filter((l: any) => l.active !== false).map((l: any) => {
        const parts = [l.address?.trim(), l.city?.trim(), l.state?.trim() && l.zipCode?.trim() ? `${l.state.trim()} ${l.zipCode.trim()}` : (l.state?.trim() || l.zipCode?.trim())].filter(Boolean);
        const fullAddress = parts.join(", ");
        return {
          localId: l.localId,
          name: l.name,
          address: fullAddress || l.address || "",
          phone: l.phone || "",
          email: l.email || "",
          active: l.active,
          workingHours: l.workingHours ? (typeof l.workingHours === 'object' ? l.workingHours : JSON.parse(l.workingHours)) : null,
          temporarilyClosed: l.temporarilyClosed ?? false,
          reopenOn: l.reopenOn ?? null,
        };
      }));
    } catch (err) {
      console.error("[Public API] Error fetching locations:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get available time slots for a date */
  app.get("/api/public/business/:slug/slots", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const date = req.query.date as string;
      const duration = parseInt(req.query.duration as string) || 60;
      const staffLocalId = req.query.staffId as string | undefined;
      const locationLocalId = req.query.locationId as string | undefined;
      // Client-side timezone support: use client's local date/time for past-slot filtering
      const clientToday = (req.query.clientToday as string | undefined) || null;
      const nowMinutes = req.query.nowMinutes !== undefined ? parseInt(req.query.nowMinutes as string) : null;
      if (!date) {
        res.status(400).json({ error: "date query parameter is required" });
        return;
      }
      // Check Active Until expiry
      const endDate = (owner as any).businessHoursEndDate as string | null | undefined;
      if (endDate && date > endDate) {
        res.json({ date, slots: [], slotLocationCounts: {} });
        return;
      }
      const allAppts = await db.getAppointmentsByOwner(owner.id);
      const allSchedule = await db.getCustomScheduleByOwner(owner.id);
      const mode = (owner.scheduleMode as "weekly" | "custom") || "weekly";
      const buffer = (owner as any).bufferTime || 0;
      // Effective slot step: client can override via ?step= param; else use business slotInterval; else auto (duration capped at 30)
      const clientStep = req.query.step !== undefined ? parseInt(req.query.step as string) : 0;
      const configuredInterval = (owner as any).slotInterval ?? 0;
      const getStep = (dur: number) => {
        if (clientStep > 0) return clientStep;
        if (configuredInterval > 0) return configuredInterval;
        return Math.min(dur, 30);
      };

      // When a specific location is requested, use single-location logic (staff > location > global)
      if (locationLocalId) {
        const appts = allAppts.filter((a: any) => a.locationId === locationLocalId);
        const schedule = allSchedule.filter((cs: any) => cs.locationId === locationLocalId || cs.locationId == null);
        let effectiveWorkingHours = owner.workingHours;
        const locs = await db.getLocationsByOwner(owner.id);
        const loc = locs.find((l: any) => l.localId === locationLocalId);
        if (loc && loc.workingHours) {
          const locWh = typeof loc.workingHours === 'object' ? loc.workingHours : JSON.parse(loc.workingHours as string);
          effectiveWorkingHours = locWh;
        }
        if (staffLocalId) {
          const staffList = await db.getStaffByOwner(owner.id);
          const staff = staffList.find((s: any) => s.localId === staffLocalId);
          if (staff && staff.workingHours) {
            const staffWh = typeof staff.workingHours === 'object' ? staff.workingHours : JSON.parse(staff.workingHours as string);
            effectiveWorkingHours = staffWh;
          }
        }
        const slots = generateAvailableSlots(date, duration, effectiveWorkingHours, appts, getStep(duration), schedule, mode, buffer, clientToday, nowMinutes);
        // Single-location: each slot has exactly 1 location
        const slotLocationCounts: Record<string, number> = {};
        slots.forEach((s) => { slotLocationCounts[s] = 1; });
        res.json({ date, slots, slotLocationCounts });
        return;
      }

      // No location specified: compute UNION of slots across all active locations.
      // Each slot is annotated with how many locations have it available.
      const locs = await db.getLocationsByOwner(owner.id);
      const activeLocs = locs.filter((l: any) => l.active !== false && !l.temporarilyClosed);

      // If no active locations, fall back to global working hours
      if (activeLocs.length === 0) {
        let effectiveWorkingHours = owner.workingHours;
        if (staffLocalId) {
          const staffList = await db.getStaffByOwner(owner.id);
          const staff = staffList.find((s: any) => s.localId === staffLocalId);
          if (staff && staff.workingHours) {
            const staffWh = typeof staff.workingHours === 'object' ? staff.workingHours : JSON.parse(staff.workingHours as string);
            effectiveWorkingHours = staffWh;
          }
        }
        const slots = generateAvailableSlots(date, duration, effectiveWorkingHours, allAppts, getStep(duration), allSchedule, mode, buffer, clientToday, nowMinutes);
        const slotLocationCounts: Record<string, number> = {};
        slots.forEach((s) => { slotLocationCounts[s] = 1; });
        res.json({ date, slots, slotLocationCounts });
        return;
      }

      // Resolve staff working hours override (applies to all locations equally)
      let staffWorkingHours: any = null;
      if (staffLocalId) {
        const staffList = await db.getStaffByOwner(owner.id);
        const staff = staffList.find((s: any) => s.localId === staffLocalId);
        if (staff && staff.workingHours) {
          staffWorkingHours = typeof staff.workingHours === 'object' ? staff.workingHours : JSON.parse(staff.workingHours as string);
        }
      }

      // Compute per-location slot counts for the union
      const slotLocationCounts: Record<string, number> = {};
      for (const loc of activeLocs) {
        const locAppts = allAppts.filter((a: any) => a.locationId === loc.localId);
        const locSchedule = allSchedule.filter((cs: any) => cs.locationId === loc.localId || cs.locationId == null);
        let locWH = owner.workingHours;
        if (loc.workingHours) {
          const parsed = typeof loc.workingHours === 'object' ? loc.workingHours : JSON.parse(loc.workingHours as string);
          if (parsed && Object.keys(parsed).length > 0) locWH = parsed;
        }
        // Staff hours override location hours
        const effectiveWH = staffWorkingHours ?? locWH;
        const locSlots = generateAvailableSlots(date, duration, effectiveWH, locAppts, getStep(duration), locSchedule, mode, buffer, clientToday, nowMinutes);
        locSlots.forEach((s) => { slotLocationCounts[s] = (slotLocationCounts[s] ?? 0) + 1; });
      }

      // Union of all slots, sorted chronologically
      const slots = Object.keys(slotLocationCounts).sort();
      res.json({ date, slots, slotLocationCounts });
    } catch (err) {
      console.error("[Public API] Error fetching slots:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get discounts for a business */
  app.get("/api/public/business/:slug/discounts", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const discountsList = await db.getDiscountsByOwner(owner.id);
      res.json(discountsList.filter((d) => d.active).map((d) => ({
        localId: d.localId,
        name: d.name,
        percentage: d.percentage,
        startTime: d.startTime,
        endTime: d.endTime,
        dates: d.dates,
        // Normalise: null means "all services" → return empty array so clients can safely call .length
        serviceIds: Array.isArray(d.serviceIds) ? d.serviceIds : [],
      })));
    } catch (err) {
      console.error("[Public API] Error fetching discounts:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });


  /** Validate a promo code for a business */
  app.get("/api/public/business/:slug/promo/:code", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const code = req.params.code.toUpperCase();
      const promo = await db.getPromoCodeByCode(code, owner.id);
      if (!promo) {
        res.status(404).json({ error: "Promo code not found" });
        return;
      }
      if (!promo.active) {
        res.status(400).json({ error: "This promo code is no longer active" });
        return;
      }
      if (promo.expiresAt) {
        const today = new Date().toISOString().split('T')[0];
        if (promo.expiresAt < today) {
          res.status(400).json({ error: `This promo code expired on ${promo.expiresAt}` });
          return;
        }
      }
      if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
        res.status(400).json({ error: "This promo code has reached its maximum usage limit" });
        return;
      }
      res.json({
        localId: promo.localId,
        code: promo.code,
        label: promo.label,
        percentage: promo.percentage,
        flatAmount: promo.flatAmount ? parseFloat(String(promo.flatAmount)) : null,
        usedCount: promo.usedCount,
        maxUses: promo.maxUses,
      });
    } catch (err) {
      console.error("[Public API] Error validating promo code:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Validate a gift certificate code */
  app.get("/api/public/business/:slug/gift-validate/:code", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const code = req.params.code.toUpperCase().trim();
      const card = await db.getGiftCardByCode(code, owner.id);
      if (!card) { res.status(404).json({ error: "Gift certificate not found" }); return; }
      if (card.redeemed) { res.status(400).json({ error: "This gift certificate has already been fully redeemed" }); return; }
      if (card.paymentStatus !== "paid") { res.status(400).json({ error: "This gift certificate has not been paid for yet" }); return; }
      if (card.expiresAt) {
        const today = new Date().toISOString().split("T")[0];
        if (card.expiresAt < today) { res.status(400).json({ error: `This gift certificate expired on ${card.expiresAt}` }); return; }
      }
      // Compute remaining value from the message/meta or totalValue
      let remainingValue = 0;
      const totalValue = parseFloat(String(card.totalValue ?? "0"));
      // Try to get remaining balance from meta stored in message field
      let gcMeta: any = {};
      const gcMsgStr = (card as any).message || "";
      const gcDataMatch = gcMsgStr.match(/\n---GIFT_DATA---\n(.+)$/s);
      if (gcDataMatch) {
        try { gcMeta = JSON.parse(gcDataMatch[1]); } catch (_) {}
      } else {
        try { gcMeta = JSON.parse(gcMsgStr); } catch (_) {}
      }
      remainingValue = gcMeta.remainingBalance ?? gcMeta.originalValue ?? totalValue;
      if (remainingValue <= 0) { res.status(400).json({ error: "This gift certificate has no remaining value" }); return; }
      const giftType = gcMeta.giftType ?? (card.serviceLocalId ? "service" : "balance");
      res.json({ code: card.code, value: remainingValue, totalValue, expiresAt: card.expiresAt, giftType, serviceLocalId: card.serviceLocalId || null });
    } catch (err) {
      console.error("[Public API] Error validating gift certificate:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get reviews for a business */
  app.get("/api/public/business/:slug/reviews", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const reviewsList = await db.getReviewsByOwner(owner.id);
      const clientsList = await db.getClientsByOwner(owner.id);
      res.json(reviewsList.map((r) => {
        const client = clientsList.find((c) => c.localId === r.clientLocalId);
        return {
          rating: r.rating,
          comment: r.comment,
          clientName: client?.name || "Anonymous",
          createdAt: r.createdAt,
        };
      }));
    } catch (err) {
      console.error("[Public API] Error fetching reviews:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get products for a business */
  app.get("/api/public/business/:slug/products", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const productsList = await db.getProductsByOwner(owner.id);
      res.json(productsList.filter((p) => p.available).map((p) => ({
        localId: p.localId,
        name: p.name,
        price: p.price,
        description: p.description,
        brand: p.brand || null,
      })));
    } catch (err) {
      console.error("[Public API] Error fetching products:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get working days info for calendar */
  app.get("/api/public/business/:slug/working-days", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const locationIdWd = req.query.locationId as string | undefined;
      const allScheduleWd = await db.getCustomScheduleByOwner(owner.id);
      // Use location-scoped working hours when a locationId is provided
      let wh: Record<string, any> = owner.workingHours || {};
      if (locationIdWd) {
        const locs = await db.getLocationsByOwner(owner.id);
        const loc = locs.find((l: any) => l.localId === locationIdWd);
        if (loc && loc.workingHours) {
          const locWh = typeof loc.workingHours === 'object' ? loc.workingHours : JSON.parse(loc.workingHours as string);
          if (locWh && Object.keys(locWh).length > 0) wh = locWh;
        }
      }
      // Build weekly working days
      // workingHours keys may be stored as full names ("Monday"), lowercase ("monday"),
      // or 3-letter abbreviations ("Mon") — check all three forms.
      const weeklyDays: Record<string, boolean> = {};
      DAYS_OF_WEEK.forEach((day) => {
        const abbr = day.slice(0, 3); // e.g. "Mon", "Tue"
        const entry = wh[day] || wh[day.toLowerCase()] || wh[abbr] || wh[abbr.toLowerCase()];
        weeklyDays[day] = !!(entry && entry.enabled);
      });
      // Custom overrides filtered to this location (or global overrides if no locationId)
      const scheduleForLoc = locationIdWd
        ? allScheduleWd.filter((cs: any) => cs.locationId === locationIdWd || cs.locationId == null)
        : allScheduleWd;
      const customDays: Record<string, boolean> = {};
      scheduleForLoc.forEach((cs: any) => {
        customDays[cs.date] = cs.isOpen ?? true;
      });
      const scheduleMode = (owner.scheduleMode as string) || "weekly";
      const businessHoursEndDate = (owner as any).businessHoursEndDate || null;
      res.json({ weeklyDays, customDays, scheduleMode, businessHoursEndDate });
    } catch (err) {
      console.error("[Public API] Error fetching working days:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get gift card by code */
  app.get("/api/public/gift/:code", async (req: Request, res: Response) => {
    try {
      // Search across all business owners for this gift code
      const dbase = await db.getDb();
      if (!dbase) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const { giftCards, businessOwners, services } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const cards = await dbase.select().from(giftCards).where(eq(giftCards.code, req.params.code));
      if (cards.length === 0) {
        res.status(404).json({ error: "Gift card not found" });
        return;
      }
      const card = cards[0];
      const owner = await db.getBusinessOwnerById(card.businessOwnerId);
      const svcList = await db.getServicesByOwner(card.businessOwnerId);
      const prodList = await db.getProductsByOwner(card.businessOwnerId);
      const svc = svcList.find((s) => s.localId === card.serviceLocalId);

      // Parse extended data from message field
      let serviceIds: string[] = [];
      let productIds: string[] = [];
      let originalValue = 0;
      let remainingBalance = 0;
      const rawMsg = card.message ?? "";
      const jsonMatch = rawMsg.match(/\n---GIFT_DATA---\n(.+)$/s);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          serviceIds = data.serviceIds ?? [];
          productIds = data.productIds ?? [];
          originalValue = data.originalValue ?? 0;
          remainingBalance = data.remainingBalance ?? originalValue;
        } catch {}
      }
      // If no extended data, fall back to single service
      if (serviceIds.length === 0 && card.serviceLocalId) {
        serviceIds = [card.serviceLocalId];
        if (svc) {
          originalValue = parseFloat(String(svc.price));
          remainingBalance = card.redeemed ? 0 : originalValue;
        }
      }
      const cleanMessage = rawMsg.replace(/\n---GIFT_DATA---\n.+$/s, "");

      // Build items list for the client
      const giftItems: { localId: string; name: string; price: number; type: string }[] = [];
      for (const sid of serviceIds) {
        const s = svcList.find((sv) => sv.localId === sid);
        if (s) giftItems.push({ localId: s.localId, name: s.name, price: parseFloat(String(s.price)), type: "service" });
      }
      for (const pid of productIds) {
        const p = prodList.find((pr) => pr.localId === pid);
        if (p) giftItems.push({ localId: p.localId, name: p.name, price: parseFloat(String(p.price)), type: "product" });
      }

      res.json({
        code: card.code,
        redeemed: card.redeemed,
        expiresAt: card.expiresAt,
        recipientName: card.recipientName,
        message: cleanMessage,
        serviceName: svc?.name || "Service",
        servicePrice: svc?.price || "0",
        serviceDuration: svc?.duration || 60,
        serviceLocalId: card.serviceLocalId,
        businessName: owner?.businessName || "Business",
        businessSlug: owner?.businessName.toLowerCase().replace(/\s+/g, "-") || "",
        // Balance-based gift card fields
        originalValue,
        remainingBalance,
        serviceIds,
        productIds,
        items: giftItems,
      });
    } catch (err) {
      console.error("[Public API] Error fetching gift card:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Submit a booking (create client + appointment) */
  app.post("/api/public/business/:slug/book", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      if (owner.temporaryClosed) {
        res.status(400).json({ error: "Business is temporarily closed" });
        return;
      }

      const { clientName, clientPhone, clientEmail, serviceLocalId, date, time, duration, notes, giftCode, totalPrice, extraItems, giftApplied, giftUsedAmount, discountName, discountPercentage, discountAmount, subtotal, locationId, paymentMethod, paymentConfirmationNumber, promoCode, promoLocalId, clientAddress, travelFee } = req.body;

      if (!clientName || !serviceLocalId || !date || !time) {
        res.status(400).json({ error: "Missing required fields: clientName, serviceLocalId, date, time" });
        return;
      }

      // Normalize phone for consistent matching
      let clientLocalId: string;
      const rawDigits = (clientPhone || "").replace(/\D/g, "");
      const normalizedPhone = rawDigits.length === 11 && rawDigits.startsWith("1") ? rawDigits.slice(1) : rawDigits;
      if (normalizedPhone.length >= 10) {
        const existingClient = await db.getClientByPhone(normalizedPhone, owner.id);
        if (existingClient) {
          clientLocalId = existingClient.localId;
          // Update client name if different
          if (existingClient.name !== clientName) {
            await db.updateClient(existingClient.localId, owner.id, { name: clientName, email: clientEmail || undefined });
          }
        } else {
          clientLocalId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await db.createClient({
            businessOwnerId: owner.id,
            localId: clientLocalId,
            name: clientName,
            phone: normalizedPhone,
            email: clientEmail || null,
            notes: "Added via web booking",
          });
        }
      } else {
        clientLocalId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await db.createClient({
          businessOwnerId: owner.id,
          localId: clientLocalId,
          name: clientName,
          phone: normalizedPhone || null,
          email: clientEmail || null,
          notes: "Added via web booking",
        });
      }

      // Verify the time slot is still available
      const allBookAppts = await db.getAppointmentsByOwner(owner.id);
      const allBookSchedule = await db.getCustomScheduleByOwner(owner.id);
      const svcList = await db.getServicesByOwner(owner.id);
      const svc = svcList.find((s) => s.localId === serviceLocalId);
      const dur = duration || svc?.duration || 60;

      // Scope appointments and custom schedule to the selected location for accurate validation
      const bookAppts = locationId
        ? allBookAppts.filter((a: any) => a.locationId === locationId)
        : allBookAppts;
      const bookSchedule = locationId
        ? allBookSchedule.filter((cs: any) => cs.locationId === locationId || cs.locationId == null)
        : allBookSchedule;

      // Use location-scoped working hours for validation
      let bookWorkingHours = owner.workingHours;
      let bookLocationName: string | undefined;
      let bookLocationAddress: string | undefined;
      if (locationId) {
        const locs = await db.getLocationsByOwner(owner.id);
        const loc = locs.find((l: any) => l.localId === locationId);
        if (loc) {
          bookLocationName = loc.name || undefined;
          // Build full address including city/state/zip
          const addrParts = [
            loc.address?.trim(),
            loc.city?.trim(),
            loc.state?.trim() && loc.zipCode?.trim() ? `${loc.state.trim()} ${loc.zipCode.trim()}` : (loc.state?.trim() || loc.zipCode?.trim()),
          ].filter(Boolean);
          bookLocationAddress = addrParts.join(", ") || loc.address || undefined;
          if (loc.workingHours) {
            const locWh = typeof loc.workingHours === 'object' ? loc.workingHours : JSON.parse(loc.workingHours as string);
            if (locWh && Object.keys(locWh).length > 0) bookWorkingHours = locWh;
          }
        }
      }

      const bookMode = (owner.scheduleMode as "weekly" | "custom") || "weekly";
      const bookBuffer = (owner as any).bufferTime || 0;
      const slots = generateAvailableSlots(date, dur, bookWorkingHours, bookAppts, Math.min(dur, 30), bookSchedule, bookMode, bookBuffer);
      if (!slots.includes(time)) {
        res.status(400).json({ error: "Selected time slot is no longer available" });
        return;
      }

      // Validate gift card balance BEFORE creating the appointment
      if (giftCode && giftApplied) {
        const gcValidate = await db.getGiftCardByCode(giftCode, owner.id);
        if (!gcValidate) {
          res.status(400).json({ error: "Gift card not found or does not belong to this business" });
          return;
        }
        // Check expiry date
        if (gcValidate.expiresAt) {
          const today = new Date().toISOString().split('T')[0];
          if (gcValidate.expiresAt < today) {
            res.status(400).json({ error: `This gift card expired on ${gcValidate.expiresAt}` });
            return;
          }
        }
        // Parse current balance from message field (GIFT_DATA block or raw JSON)
        let gcMeta: any = {};
        const gcMsgStr = gcValidate.message || "";
        const gcDataMatch = gcMsgStr.match(/\n---GIFT_DATA---\n(.+)$/s);
        if (gcDataMatch) {
          try { gcMeta = JSON.parse(gcDataMatch[1]); } catch (_) {}
        } else {
          try { gcMeta = JSON.parse(gcMsgStr); } catch (_) {}
        }
        const gcCurrentBalance = gcMeta.remainingBalance ?? gcMeta.originalValue ?? 0;
        if (gcCurrentBalance <= 0) {
          res.status(400).json({ error: "This gift card has no remaining balance" });
          return;
        }
        const gcRequestedAmt = giftUsedAmount ? parseFloat(String(giftUsedAmount)) : 0;
        if (gcRequestedAmt > gcCurrentBalance + 0.01) { // 1-cent tolerance for float rounding
          res.status(400).json({ error: `Gift card balance ($${gcCurrentBalance.toFixed(2)}) is less than the requested amount ($${gcRequestedAmt.toFixed(2)})` });
          return;
        }
      }

      // Build enriched notes with pricing details
      let enrichedNotes = notes || "";
      const svcPrice = svc ? parseFloat(String(svc.price)) : 0;
      const extras: { name: string; price: number; type: string }[] = Array.isArray(extraItems) ? extraItems : [];
      const extrasTotal = extras.reduce((s: number, e: { price: number }) => s + (e.price || 0), 0);
      const finalTotal = totalPrice != null ? parseFloat(String(totalPrice)) : svcPrice + extrasTotal;

      const hasDiscount = discountAmount && parseFloat(String(discountAmount)) > 0;
      if (extras.length > 0 || giftApplied || hasDiscount) {
        const pricingLines: string[] = [];
        pricingLines.push(`Service: ${svc?.name ?? "Service"} \u2014 $${svcPrice.toFixed(2)}`);
        extras.forEach((e: { name: string; price: number; type: string }) => {
          pricingLines.push(`${e.type === "product" ? "Product" : "Extra"}: ${e.name} \u2014 $${(e.price || 0).toFixed(2)}`);
        });
        if (hasDiscount) {
          const dName = discountName || "Discount";
          const dPct = discountPercentage ? parseInt(String(discountPercentage), 10) : 0;
          const dAmt = parseFloat(String(discountAmount));
          pricingLines.push(`Discount: ${dName} (${dPct}% off): -$${dAmt.toFixed(2)}`);
        }
        if (giftApplied) {
          const giftAmt = giftUsedAmount ? parseFloat(String(giftUsedAmount)) : svcPrice;
          pricingLines.push(`Gift Card: -$${giftAmt.toFixed(2)}`);
        }
        pricingLines.push(`Total Charged: $${finalTotal.toFixed(2)}`);
        enrichedNotes = (enrichedNotes ? enrichedNotes + "\n" : "") + "--- Pricing ---\n" + pricingLines.join("\n");
      }
      if (paymentConfirmationNumber) {
        enrichedNotes = (enrichedNotes ? enrichedNotes + "\n" : "") + "Payment Ref: " + paymentConfirmationNumber;
      }

      // Create appointment
      const appointmentLocalId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await db.createAppointment({
        businessOwnerId: owner.id,
        localId: appointmentLocalId,
        serviceLocalId,
        clientLocalId,
        date,
        time,
        duration: dur,
        status: "pending",
        notes: enrichedNotes || null,
        totalPrice: finalTotal != null ? String(finalTotal) : null,
        discountPercent: discountPercentage ? parseInt(String(discountPercentage), 10) : null,
        discountAmount: hasDiscount ? String(parseFloat(String(discountAmount))) : null,
        discountName: discountName || null,
        extraItems: extras.length > 0 ? JSON.stringify(extras) : null,
        giftApplied: !!giftApplied,
        giftUsedAmount: giftUsedAmount ? String(parseFloat(String(giftUsedAmount))) : null,
        giftCode: giftCode || null,
        locationId: locationId || null,
        clientAddress: clientAddress || null,
        paymentMethod: (paymentMethod && paymentMethod !== 'later') ? paymentMethod : null,
        paymentStatus: paymentMethod === 'cash' ? 'pending_cash' : ((paymentMethod && paymentMethod !== 'later') ? 'unpaid' : null),
      });

      // Atomically deduct from gift card balance (prevents double-spend race conditions)
      if (giftCode) {
        const usedAmt = giftUsedAmount ? parseFloat(String(giftUsedAmount)) : (svcPrice + extrasTotal);
        const deductResult = await db.atomicDeductGiftCardBalance(giftCode, owner.id, usedAmt);
        if (!deductResult.success) {
          // Deduction failed (race condition: another request already deducted the balance)
          // The appointment was already saved — mark it with a note about the gift card issue
          console.warn(`[GiftCard] Atomic deduction failed for ${giftCode}: ${deductResult.reason}`);
          // Still allow the booking but log the discrepancy
        }
      }

      // Increment promo code usage count if applied
      if (promoCode && promoLocalId) {
        try {
          await db.incrementPromoCodeUsage(promoLocalId, owner.id);
        } catch (err) {
          console.warn("[PromoCode] Failed to increment usage:", err);
        }
      }
      // Send branded email notification via Resend
      // Email notifications are only available on paid plans (not free tier)
      const ownerNotifPrefs = (owner as any).notificationPreferences ?? {};
      const masterNotifEnabled = (owner as any).notificationsEnabled !== false;
      const emailOnNewBookingEnabled = ownerNotifPrefs.emailOnNewBooking === true;
      const ownerSubStatus = (owner as any).subscriptionStatus as string | undefined;
      const isFreePlan = !ownerSubStatus || ownerSubStatus === "free";
      if (masterNotifEnabled && owner.email && emailOnNewBookingEnabled && !isFreePlan) {
        try {
          await sendBookingNotificationEmail(owner.email, owner.businessName, {
            clientName,
            clientPhone: clientPhone || undefined,
            serviceName: svc?.name ?? "Service",
            date,
            time,
            duration: dur,
            totalPrice: finalTotal ?? undefined,
            extras: extras.length > 0 ? extras : undefined,
            giftApplied: !!giftApplied,
            giftUsedAmount: giftUsedAmount ? parseFloat(String(giftUsedAmount)) : undefined,
            notes: enrichedNotes || undefined,
            locationName: bookLocationName,
            locationAddress: bookLocationAddress,
          });
        } catch (emailErr) {
          console.warn("[Public API] Failed to send email notification:", emailErr);
        }
      }

      // Send push notification to business owner's device
      const pushOnNewBookingEnabled = masterNotifEnabled && ownerNotifPrefs.pushOnNewBooking !== false;
      if (pushOnNewBookingEnabled) try {
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        if (ownerPushToken) {
          // Send Expo push notification directly to owner's device (appears as "Lime Of Time")
          await notifyNewBooking(
            ownerPushToken,
            owner.businessName,
            clientName,
            svc?.name ?? "a service",
            date,
            time,
            appointmentLocalId,
            {
              duration: dur,
              locationName: bookLocationName || undefined,
              clientPhone: clientPhone || undefined,
              notes: enrichedNotes || undefined,
            }
          );
        } else {
          // Fallback: Manus platform notification (no device token registered yet)
          const extrasLabel = extras.length > 0 ? ` + ${extras.length} extra` : "";
          const phoneLabel = clientPhone ? ` | 📞 ${formatPhoneNumber(clientPhone)}` : "";
          const priceLabel = finalTotal > 0 ? ` | $${finalTotal.toFixed(2)}` : "";
          await throttledNotifyOwner({
            title: `📅 New Booking Request — ${owner.businessName}`,
            content: `${clientName}${phoneLabel} requested ${svc?.name ?? "a service"}${extrasLabel}\nDate: ${date} at ${time} (${dur} min)${priceLabel}\nTap to review and confirm.`,
          });
        }
      } catch (pushErr) {
        console.warn("[Public API] Failed to send push notification:", pushErr);
      }

      res.json({
        success: true,
        appointmentId: appointmentLocalId,
        manageUrl: `${req.headers.origin || 'https://lime-of-time.com'}/manage/${req.params.slug}/${appointmentLocalId}`,
        message: "Appointment request submitted! The business will confirm your booking.",
      });
    } catch (err) {
      console.error("[Public API] Error creating booking:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Submit a review */
  app.post("/api/public/business/:slug/review", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }

      const { clientName, clientPhone, rating, comment } = req.body;
      if (!clientName || !rating) {
        res.status(400).json({ error: "Missing required fields: clientName, rating" });
        return;
      }

      // Normalize phone for consistent matching
      let clientLocalId: string;
      const rawReviewDigits = (clientPhone || "").replace(/\D/g, "");
      const normalizedReviewPhone = rawReviewDigits.length === 11 && rawReviewDigits.startsWith("1") ? rawReviewDigits.slice(1) : rawReviewDigits;
      if (normalizedReviewPhone.length >= 10) {
        const existingClient = await db.getClientByPhone(normalizedReviewPhone, owner.id);
        if (existingClient) {
          clientLocalId = existingClient.localId;
          // Update client name if different
          if (existingClient.name !== clientName) {
            await db.updateClient(existingClient.localId, owner.id, { name: clientName });
          }
        } else {
          clientLocalId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await db.createClient({
            businessOwnerId: owner.id,
            localId: clientLocalId,
            name: clientName,
            phone: normalizedReviewPhone,
          });
        }
      } else {
        clientLocalId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await db.createClient({
          businessOwnerId: owner.id,
          localId: clientLocalId,
          name: clientName,
        });
      }

      const reviewLocalId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await db.createReview({
        businessOwnerId: owner.id,
        localId: reviewLocalId,
        clientLocalId,
        rating: Math.min(5, Math.max(1, parseInt(rating))),
        comment: comment || null,
      });

      res.json({ success: true, message: "Thank you for your review!" });
    } catch (err) {
      console.error("[Public API] Error creating review:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Cancel / Reschedule ────────────────────────────────────────────

  /** Get appointment details for cancel/reschedule page */
  app.get("/api/public/appointment/:appointmentId", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug } = req.query;
      if (!slug) {
        res.status(400).json({ error: "slug query parameter is required" });
        return;
      }
      const owner = await db.getBusinessOwnerBySlug(slug as string);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      const svcList = await db.getServicesByOwner(owner.id);
      const svc = svcList.find((s) => s.localId === appt.serviceLocalId);
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c) => c.localId === appt.clientLocalId);
      res.json({
        localId: appt.localId,
        date: appt.date,
        time: appt.time,
        duration: appt.duration,
        status: appt.status,
        serviceName: svc?.name || "Service",
        serviceLocalId: appt.serviceLocalId,
        clientName: client?.name || "Client",
        businessName: owner.businessName,
      });
    } catch (err) {
      console.error("[Public API] Error fetching appointment:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Cancel an appointment from client side */
  app.post("/api/public/appointment/:appointmentId/cancel", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug, clientPhone } = req.body;
      if (!slug) {
        res.status(400).json({ error: "slug is required" });
        return;
      }
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      if (appt.status === "cancelled" || appt.status === "completed") {
        res.status(400).json({ error: `Appointment is already ${appt.status}` });
        return;
      }
      // Verify client identity by phone
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c) => c.localId === appt.clientLocalId);
      const normPhone = (p: string) => {
        const d = p.replace(/\D/g, "");
        return d.length >= 10 ? d.slice(-10) : d;
      };
      // If client has a phone on record, require verification
      if (client && client.phone && client.phone.trim()) {
        if (!clientPhone || !clientPhone.trim()) {
          res.status(403).json({ error: "Please enter your phone number to verify your identity." });
          return;
        }
        if (normPhone(clientPhone) !== normPhone(client.phone)) {
          res.status(403).json({ error: "Phone number does not match. Please enter the phone number used when booking." });
          return;
        }
      }
      // If client has no phone on record, allow action without phone verification
      await db.updateAppointment(appointmentId, owner.id, { status: "cancelled" });
      // Notify business owner
      const cancelNotifPrefs = (owner as any).notificationPreferences ?? {};
      const pushOnCancellationEnabled = cancelNotifPrefs.pushOnCancellation !== false;
      if (pushOnCancellationEnabled) try {
        const svcList = await db.getServicesByOwner(owner.id);
        const svc = svcList.find((s) => s.localId === appt.serviceLocalId);
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        // Resolve location name for enriched notification
        let cancelLocationName: string | undefined;
        if (appt.locationId) {
          const locs = await db.getLocationsByOwner(owner.id);
          cancelLocationName = (locs as any[]).find((l: any) => l.localId === appt.locationId)?.name;
        }
        if (ownerPushToken) {
          await notifyCancellation(
            ownerPushToken,
            owner.businessName,
            client?.name || "A client",
            svc?.name || "appointment",
            appt.date,
            appt.time,
            appointmentId,
            {
              duration: appt.duration || undefined,
              locationName: cancelLocationName,
              clientPhone: client?.phone || undefined,
            }
          );
        } else {
          await throttledNotifyOwner({
            title: `❌ Appointment Cancelled — ${owner.businessName}`,
            content: `${client?.name || "A client"} cancelled their ${svc?.name || "appointment"}\nDate: ${appt.date} at ${appt.time} (${appt.duration} min)\nTap to view your calendar.`,
          });
        }
      } catch (pushErr) {
        console.warn("[Public API] Failed to send cancellation notification:", pushErr);
      }
      // Check waitlist for this slot
      const waitlistEntries = await db.getWaitlistForDateAndService(owner.id, appt.date, appt.serviceLocalId);
      if (waitlistEntries.length > 0) {
        // Mark first waitlist entry as notified
        await db.updateWaitlistEntry(waitlistEntries[0].id, { status: "notified" });
      }
      res.json({ success: true, message: "Appointment cancelled successfully." });
    } catch (err) {
      console.error("[Public API] Error cancelling appointment:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Reschedule an appointment from client side */
  app.post("/api/public/appointment/:appointmentId/reschedule", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug, clientPhone, newDate, newTime } = req.body;
      if (!slug || !newDate || !newTime) {
        res.status(400).json({ error: "slug, newDate, and newTime are required" });
        return;
      }
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      if (appt.status === "cancelled" || appt.status === "completed") {
        res.status(400).json({ error: `Cannot reschedule a ${appt.status} appointment` });
        return;
      }
      // Only confirmed appointments can be rescheduled (pending ones must be cancelled)
      if (appt.status === "pending") {
        res.status(400).json({ error: "Pending appointments cannot be rescheduled. Please cancel and rebook, or wait for the business to confirm your appointment first." });
        return;
      }
      // Enforce 24-hour reschedule window
      const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
      const hoursUntilAppt = (apptDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilAppt <= 24) {
        res.status(400).json({ error: "Rescheduling is not available within 24 hours of the appointment time. You may still cancel the appointment." });
        return;
      }
      // Verify client identity by phone
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c) => c.localId === appt.clientLocalId);
      const normPhone2 = (p: string) => {
        const d = p.replace(/\D/g, "");
        return d.length >= 10 ? d.slice(-10) : d;
      };
      // If client has a phone on record, require verification
      if (client && client.phone && client.phone.trim()) {
        if (!clientPhone || !clientPhone.trim()) {
          res.status(403).json({ error: "Please enter your phone number to verify your identity." });
          return;
        }
        if (normPhone2(clientPhone) !== normPhone2(client.phone)) {
          res.status(403).json({ error: "Phone number does not match. Please enter the phone number used when booking." });
          return;
        }
      }
      // Verify new slot is available
      const appts = await db.getAppointmentsByOwner(owner.id);
      const allReschedSchedule = await db.getCustomScheduleByOwner(owner.id);
      const mode = (owner.scheduleMode as "weekly" | "custom") || "weekly";
      const bufferVal = (owner as any).bufferTime || 0;
      // Use location-scoped working hours and custom schedule when appointment has a locationId
      let reschedWorkingHours = owner.workingHours;
      const reschedLocationId = (appt as any).locationId;
      const reschedSchedule = reschedLocationId
        ? allReschedSchedule.filter((cs: any) => cs.locationId === reschedLocationId || cs.locationId == null)
        : allReschedSchedule;
      if (reschedLocationId) {
        const locs = await db.getLocationsByOwner(owner.id);
        const loc = locs.find((l: any) => l.localId === reschedLocationId);
        if (loc && loc.workingHours) {
          const locWh = typeof loc.workingHours === 'object' ? loc.workingHours : JSON.parse(loc.workingHours as string);
          if (locWh && Object.keys(locWh).length > 0) reschedWorkingHours = locWh;
        }
      }
      // Exclude current appointment from conflict check
      const otherAppts = appts.filter((a: any) => a.localId !== appointmentId);
      const slots = generateAvailableSlots(newDate, appt.duration, reschedWorkingHours, otherAppts, Math.min(appt.duration, 30), reschedSchedule, mode, bufferVal);
      if (!slots.includes(newTime)) {
        res.status(400).json({ error: "Selected time slot is not available" });
        return;
      }
      await db.updateAppointment(appointmentId, owner.id, {
        date: newDate,
        time: newTime,
        status: "pending",
      });
      // Notify business owner
      const reschedNotifPrefs = (owner as any).notificationPreferences ?? {};
      const pushOnRescheduleEnabled = reschedNotifPrefs.pushOnReschedule !== false;
      if (pushOnRescheduleEnabled) try {
        const svcList = await db.getServicesByOwner(owner.id);
        const svc = svcList.find((s) => s.localId === appt.serviceLocalId);
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        // Resolve location name for enriched notification
        let reschedLocationName: string | undefined;
        if (appt.locationId) {
          const locs = await db.getLocationsByOwner(owner.id);
          reschedLocationName = (locs as any[]).find((l: any) => l.localId === appt.locationId)?.name;
        }
        if (ownerPushToken) {
          await notifyReschedule(
            ownerPushToken,
            owner.businessName,
            client?.name || "A client",
            svc?.name || "appointment",
            newDate,
            newTime,
            appointmentId,
            {
              oldDate: appt.date,
              oldTime: appt.time,
              duration: appt.duration || undefined,
              locationName: reschedLocationName,
              clientPhone: client?.phone || undefined,
            }
          );
        } else {
          await throttledNotifyOwner({
            title: `🔄 Appointment Rescheduled — ${owner.businessName}`,
            content: `${client?.name || "A client"} rescheduled their ${svc?.name || "appointment"}\nNew date: ${newDate} at ${newTime}\nTap to review and confirm.`,
          });
        }
      } catch (pushErr) {
        console.warn("[Public API] Failed to send reschedule notification:", pushErr);
      }
      res.json({ success: true, message: "Appointment rescheduled successfully. The business will confirm your new time." });
    } catch (err) {
      console.error("[Public API] Error rescheduling appointment:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Request-based Cancel / Reschedule (new flow) ──────────────────────────────

  /** Client submits a cancellation REQUEST (does NOT cancel immediately) */
  app.post("/api/public/appointment/:appointmentId/request-cancel", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug, clientPhone, reason } = req.body;
      if (!slug) { res.status(400).json({ error: "slug is required" }); return; }
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }
      // Block if already cancelled or completed
      if (appt.status === "cancelled") { res.status(400).json({ error: "Appointment is already cancelled." }); return; }
      if (appt.status === "completed") { res.status(400).json({ error: "Completed appointments cannot be cancelled." }); return; }
      // Block if a pending request already exists
      const existing = (appt as any).cancelRequest as any;
      if (existing?.status === "pending") { res.status(400).json({ error: "A cancellation request is already pending. Please wait for the business to respond." }); return; }
      // Verify client identity
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c: any) => c.localId === appt.clientLocalId);
      const normPhone = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
      if (client?.phone?.trim()) {
        if (!clientPhone?.trim()) { res.status(403).json({ error: "Please enter your phone number to verify your identity." }); return; }
        if (normPhone(clientPhone) !== normPhone(client.phone)) { res.status(403).json({ error: "Phone number does not match." }); return; }
      }
      const cancelRequest = { status: "pending", reason: reason || "", submittedAt: new Date().toISOString() };
      await db.updateAppointment(appointmentId, owner.id, { cancelRequest } as any);
      // Push notification to owner
      try {
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        const svcList = await db.getServicesByOwner(owner.id);
        const svc = svcList.find((s: any) => s.localId === appt.serviceLocalId);
        const responseWindowHours: number = (owner as any).requestResponseWindowHours ?? 48;
        if (ownerPushToken) {
          const formattedDate = appt.date
            ? new Date(appt.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
            : appt.date;
          await sendExpoPush(ownerPushToken, {
            title: `⚠️ Cancellation Request`,
            body: `${client?.name || "A client"} wants to cancel their ${svc?.name || "appointment"} on ${formattedDate}. Respond within ${responseWindowHours}h or it auto-expires.`,
            data: { type: "cancel_request", appointmentId, filter: "requests" },
            channelId: "requests",
          });
        }
      } catch { /* non-blocking */ }
      res.json({ success: true, message: "Your cancellation request has been submitted. The business will review it and get back to you." });
    } catch (err) {
      console.error("[Public API] Error submitting cancel request:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Client submits a reschedule REQUEST (does NOT reschedule immediately) */
  app.post("/api/public/appointment/:appointmentId/request-reschedule", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug, clientPhone, requestedDate, requestedTime, reason } = req.body;
      if (!slug || !requestedDate || !requestedTime) { res.status(400).json({ error: "slug, requestedDate, and requestedTime are required" }); return; }
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }
      if (appt.status === "cancelled") { res.status(400).json({ error: "Appointment is already cancelled." }); return; }
      if (appt.status === "completed") { res.status(400).json({ error: "Completed appointments cannot be rescheduled." }); return; }
      const existing = (appt as any).rescheduleRequest as any;
      if (existing?.status === "pending") { res.status(400).json({ error: "A reschedule request is already pending. Please wait for the business to respond." }); return; }
      // Verify client identity
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c: any) => c.localId === appt.clientLocalId);
      const normPhone = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
      if (client?.phone?.trim()) {
        if (!clientPhone?.trim()) { res.status(403).json({ error: "Please enter your phone number to verify your identity." }); return; }
        if (normPhone(clientPhone) !== normPhone(client.phone)) { res.status(403).json({ error: "Phone number does not match." }); return; }
      }
      const rescheduleRequest = { status: "pending", requestedDate, requestedTime, reason: reason || "", submittedAt: new Date().toISOString() };
      await db.updateAppointment(appointmentId, owner.id, { rescheduleRequest } as any);
      // Push notification to owner
      try {
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        const svcList = await db.getServicesByOwner(owner.id);
        const svc = svcList.find((s: any) => s.localId === appt.serviceLocalId);
        const responseWindowHours: number = (owner as any).requestResponseWindowHours ?? 48;
        if (ownerPushToken) {
          const formattedRequested = requestedDate
            ? new Date(requestedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
            : requestedDate;
          await sendExpoPush(ownerPushToken, {
            title: `🔄 Reschedule Request`,
            body: `${client?.name || "A client"} wants to move their ${svc?.name || "appointment"} to ${formattedRequested} at ${requestedTime}. Respond within ${responseWindowHours}h or it auto-expires.`,
            data: { type: "reschedule_request", appointmentId, filter: "requests" },
            channelId: "requests",
          });
        }
      } catch { /* non-blocking */ }
      res.json({ success: true, message: "Your reschedule request has been submitted. The business will review it and get back to you." });
    } catch (err) {
      console.error("[Public API] Error submitting reschedule request:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Client withdraws a pending cancel or reschedule request */
  app.post("/api/public/appointment/:appointmentId/withdraw-request", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug, clientPhone, requestType } = req.body; // requestType: 'cancel' | 'reschedule'
      if (!slug || !requestType) { res.status(400).json({ error: "slug and requestType are required" }); return; }
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }
      // Verify client identity
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c: any) => c.localId === appt.clientLocalId);
      const normPhone = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
      if (client?.phone?.trim()) {
        if (!clientPhone?.trim()) { res.status(403).json({ error: "Please enter your phone number to verify your identity." }); return; }
        if (normPhone(clientPhone) !== normPhone(client.phone)) { res.status(403).json({ error: "Phone number does not match." }); return; }
      }
      if (requestType === "cancel") {
        const existing = (appt as any).cancelRequest as any;
        if (!existing || existing.status !== "pending") { res.status(400).json({ error: "No pending cancellation request found." }); return; }
        await db.updateAppointment(appointmentId, owner.id, { cancelRequest: { ...existing, status: "withdrawn", withdrawnAt: new Date().toISOString() } } as any);
      } else if (requestType === "reschedule") {
        const existing = (appt as any).rescheduleRequest as any;
        if (!existing || existing.status !== "pending") { res.status(400).json({ error: "No pending reschedule request found." }); return; }
        await db.updateAppointment(appointmentId, owner.id, { rescheduleRequest: { ...existing, status: "withdrawn", withdrawnAt: new Date().toISOString() } } as any);
      } else {
        res.status(400).json({ error: "requestType must be cancel or reschedule" }); return;
      }
      res.json({ success: true, message: "Your request has been withdrawn." });
    } catch (err) {
      console.error("[Public API] Error withdrawing request:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Client marks payment as sent — flags appointment for owner review */
  app.post("/api/public/appointment/:appointmentId/mark-paid", async (req: Request, res: Response) => {
    try {
      const { appointmentId } = req.params;
      const { slug, clientPhone, paymentMethod, paymentNote } = req.body;
      if (!slug) {
        res.status(400).json({ error: "slug is required" });
        return;
      }
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const appt = await db.getAppointmentByLocalId(appointmentId, owner.id);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      if (appt.status === "cancelled" || appt.status === "completed") {
        res.status(400).json({ error: `Cannot mark a ${appt.status} appointment as paid` });
        return;
      }
      // Verify client identity by phone if phone is on record
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c) => c.localId === appt.clientLocalId);
      const normPhone = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
      if (client && client.phone && client.phone.trim()) {
        if (!clientPhone || !clientPhone.trim()) {
          res.status(403).json({ error: "Please enter your phone number to verify your identity." });
          return;
        }
        if (normPhone(clientPhone) !== normPhone(client.phone)) {
          res.status(403).json({ error: "Phone number does not match." });
          return;
        }
      }
      // Update appointment: set clientPaidNotifiedAt and paymentMethod if provided
      const updateData: Record<string, any> = { clientPaidNotifiedAt: new Date() };
      if (paymentMethod && ["zelle", "venmo", "cashapp", "cash", "card", "unpaid", "free"].includes(paymentMethod)) {
        updateData.paymentMethod = paymentMethod;
      }
      if (paymentNote) updateData.notes = (appt.notes ? appt.notes + "\n" : "") + `[Client payment note: ${paymentNote}]`;
      await db.updateAppointment(appointmentId, owner.id, updateData);
      // Push notification to business owner
      try {
        const svcList = await db.getServicesByOwner(owner.id);
        const svc = svcList.find((s) => s.localId === appt.serviceLocalId);
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        const methodLabel = paymentMethod ? paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1) : "Payment";
        if (ownerPushToken) {
          await sendExpoPush(ownerPushToken, {
            title: `💰 ${methodLabel} Received — ${owner.businessName}`,
            body: `${client?.name || "A client"} says they sent payment for ${svc?.name || "appointment"} on ${appt.date} at ${appt.time}. Tap to confirm.`,
            data: { type: "payment_received" as const, appointmentId, filter: "upcoming" as const },
          });
        }
      } catch (pushErr) {
        console.warn("[Public API] Failed to send mark-paid notification:", pushErr);
      }
      res.json({ success: true, message: "Payment notification sent to the business. They will confirm receipt shortly." });
    } catch (err) {
      console.error("[Public API] Error marking appointment as paid:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Waitlist ───────────────────────────────────────────────────────

  /** Join waitlist for a fully booked slot */
  app.post("/api/public/business/:slug/waitlist", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const { clientName, clientPhone, clientEmail, serviceLocalId, preferredDate, notes } = req.body;
      if (!clientName || !serviceLocalId || !preferredDate) {
        res.status(400).json({ error: "Missing required fields: clientName, serviceLocalId, preferredDate" });
        return;
      }
      await db.createWaitlistEntry({
        businessOwnerId: owner.id,
        clientName,
        clientPhone: clientPhone || null,
        clientEmail: clientEmail || null,
        serviceLocalId,
        preferredDate,
        notes: notes || null,
      });
      // Notify business owner
      const waitlistNotifPrefs = (owner as any).notificationPreferences ?? {};
      const pushOnWaitlistEnabled = waitlistNotifPrefs.pushOnWaitlist !== false;
      if (pushOnWaitlistEnabled) try {
        const svcList = await db.getServicesByOwner(owner.id);
        const svc = svcList.find((s) => s.localId === serviceLocalId);
        const ownerPushToken = (owner as any).expoPushToken as string | null | undefined;
        if (ownerPushToken) {
          await notifyWaitlist(
            ownerPushToken,
            owner.businessName,
            clientName,
            svc?.name || "a service",
            preferredDate,
            {
              clientPhone: clientPhone || undefined,
              notes: notes || undefined,
            }
          );
        } else {
          await throttledNotifyOwner({
            title: `⏳ New Waitlist Entry — ${owner.businessName}`,
            content: `${clientName} joined the waitlist for ${svc?.name || "a service"}\nPreferred date: ${preferredDate}\nTap to view waitlist.`,
          });
        }
      } catch (pushErr) {
        console.warn("[Public API] Failed to send waitlist notification:", pushErr);
      }
      res.json({ success: true, message: "You've been added to the waitlist! We'll notify you if a spot opens up." });
    } catch (err) {
      console.error("[Public API] Error adding to waitlist:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Get waitlist entries for admin/business owner */
  app.get("/api/public/business/:slug/waitlist", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const entries = await db.getWaitlistByOwner(owner.id);
      res.json(entries);
    } catch (err) {
      console.error("[Public API] Error fetching waitlist:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Stripe payment success: look up appointment by checkout session_id ──────
  // GET /api/public/business/:slug/appointment-by-session?session_id=cs_xxx
  app.get("/api/public/business/:slug/appointment-by-session", async (req: Request, res: Response) => {
    try {
      const { session_id } = req.query as { session_id?: string };
      if (!session_id) { res.status(400).json({ error: "session_id required" }); return; }
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const { getDb } = await import("./db");
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ error: "DB unavailable" }); return; }
      const { appointments: apptTable } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      let rows = await dbase.select().from(apptTable).where(
        and(eq((apptTable as any).stripeCheckoutSessionId, session_id), eq(apptTable.businessOwnerId, owner.id))
      ).limit(1);
      if (!rows.length) {
        // Webhook may not have fired yet — retry up to 3 times with 3s gaps (9s total)
        for (let attempt = 0; attempt < 3 && !rows.length; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          rows = await dbase.select().from(apptTable).where(
            and(eq((apptTable as any).stripeCheckoutSessionId, session_id), eq(apptTable.businessOwnerId, owner.id))
          ).limit(1);
        }
      }
      if (!rows.length) { res.status(404).json({ error: "Appointment not found for this session" }); return; }
      const appt = rows[0];
      const services = await db.getServicesByOwner(owner.id);
      const svc = (services as any[]).find((s: any) => s.localId === appt.serviceLocalId);
      const clientsList = await db.getClientsByOwner(owner.id);
      const client = (clientsList as any[]).find((c: any) => c.localId === appt.clientLocalId);
      const clientName = client?.name || "Client";
      const clientEmail = client?.email || "";
      const manageUrl = `/api/manage/${req.params.slug}/${appt.localId}`;
      // Load location data if appointment has a locationLocalId
      let locationName = "";
      let locationAddress = "";
      if ((appt as any).locationLocalId) {
        const locationsList = await db.getLocationsByOwner(owner.id);
        const loc = (locationsList as any[]).find((l: any) => l.localId === (appt as any).locationLocalId);
        if (loc) {
          locationName = loc.name || "";
          const addrParts = [loc.address, loc.city, loc.state, loc.zipCode].filter(Boolean);
          locationAddress = addrParts.join(", ");
        }
      }
      res.json({ ok: true, appointment: { localId: appt.localId, clientName, clientEmail, serviceName: svc?.name || appt.serviceLocalId, date: appt.date, time: appt.time, duration: appt.duration, totalPrice: appt.totalPrice, paymentStatus: appt.paymentStatus, paymentMethod: appt.paymentMethod, manageUrl, locationName, locationAddress } });
    } catch (err) {
      console.error("[Public] appointment-by-session error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Manage Appointment Page (client self-service) ─────────────────

  /** Client appointment management page */
  app.get("/api/manage/:slug/:appointmentId", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).send(notFoundPage("Business not found"));
        return;
      }
      const appt = await db.getAppointmentByLocalId(req.params.appointmentId, owner.id);
      if (!appt) {
        res.status(404).send(notFoundPage("Appointment not found"));
        return;
      }
      // Load client data to auto-populate phone
      const clientList = await db.getClientsByOwner(owner.id);
      const client = clientList.find((c: any) => c.localId === appt.clientLocalId);
      // Load locations so the manage page can display which location the appointment is at
      const locationsList = await db.getLocationsByOwner(owner.id);
      res.send(manageAppointmentPage(req.params.slug, owner, appt, client || null, locationsList));
    } catch (err) {
      console.error("[Public] Error serving manage page:", err);
      res.status(500).send(errorPage());
    }
  });

  // ── HTML Pages ─────────────────────────────────────────────────────

  /** Redirect /book/:slug → /api/book/:slug so shared links work on the platform domain */
  app.get("/book/:slug", (req: Request, res: Response) => {
    const qs = req.query.location ? `?location=${encodeURIComponent(req.query.location as string)}` : "";
    res.redirect(302, `/api/book/${req.params.slug}${qs}`);
  });
  app.get("/book/:slug/:locationId", (req: Request, res: Response) => {
    res.redirect(301, `/api/book/${req.params.slug}/${req.params.locationId}`);
  });

  /** Booking page */
  app.get("/api/book/:slug", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).send(notFoundPage("Business not found"));
        return;
      }
      const locationId = (req.query.location as string) || null;
      // Pre-fetch locations to get the full address for the initial HTML render
      const locs = await db.getLocationsByOwner(owner.id);
      const rawFee = await getPlatformConfig("STRIPE_PLATFORM_FEE_PERCENT");
      const feePercent = rawFee ? parseFloat(rawFee) : 1.5;
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(bookingPage(req.params.slug, owner, locationId, locs, feePercent));
    } catch (err) {
      console.error("[Public] Error serving booking page:", err);
      res.status(500).send(errorPage());
    }
  });

  // Location-specific booking link: /api/book/:slug/:locationId
  app.get("/api/book/:slug/:locationId", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).send(notFoundPage("Business not found"));
        return;
      }
      // Pre-fetch locations to get the full address for the initial HTML render
      const locs = await db.getLocationsByOwner(owner.id);
      const rawFee2 = await getPlatformConfig("STRIPE_PLATFORM_FEE_PERCENT");
      const feePercent2 = rawFee2 ? parseFloat(rawFee2) : 1.5;
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(bookingPage(req.params.slug, owner, req.params.locationId, locs, feePercent2));
    } catch (err) {
      console.error("[Public] Error serving booking page:", err);
      res.status(500).send(errorPage());
    }
  });

  /** Review page */
  app.get("/api/review/:slug", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).send(notFoundPage("Business not found"));
        return;
      }
      res.send(reviewPage(req.params.slug, owner));
    } catch (err) {
      console.error("[Public] Error serving review page:", err);
      res.status(500).send(errorPage());
    }
  });

  /** Gift card page */
  app.get("/api/gift/:code", async (req: Request, res: Response) => {
    res.send(giftCardPage(req.params.code));
  });

  // ─── Public Gift Purchase Routes ─────────────────────────────────────────────

  app.get("/api/public/business/:slug/gift-info", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const services = await db.getServicesByOwner(owner.id);
      const products = await db.getProductsByOwner(owner.id);
      const locations = await db.getLocationsByOwner(owner.id);
      // Count appointments per service for popularity ranking
      const appts = await db.getAppointmentsByOwner(owner.id);
      const apptCountMap: Record<string, number> = {};
      (appts as any[]).forEach(a => { if (a.serviceLocalId) apptCountMap[a.serviceLocalId] = (apptCountMap[a.serviceLocalId] || 0) + 1; });
      const o = owner as any;
      res.json({
        businessName: owner.businessName,
        businessLogoUri: o.businessLogoUri || null,
        paymentMethods: {
          zelle: o.zelleHandle || null,
          cashApp: o.cashAppHandle || null,
          venmo: o.venmoHandle || null,
          cashEnabled: true,
          stripeEnabled: !!(o.stripeConnectEnabled),
          businessOwnerId: owner.id,
        },
        services: (services as any[]).filter(s => s.available !== false).map(s => ({
          localId: s.localId, name: s.name, price: parseFloat(String(s.price)),
          duration: s.duration, description: s.description || null, photoUri: s.photoUri || null,
          category: s.category || null, appointmentCount: apptCountMap[s.localId] || 0,
        })),
        products: (products as any[]).filter(p => p.available !== false).map(p => ({
          localId: p.localId, name: p.name, price: parseFloat(String(p.price)),
          description: p.description || null, brand: p.brand || null,
        })),
        locations: (locations as any[]).filter(l => l.active !== false).map(l => ({
          localId: l.localId, name: l.name,
        })),
      });
    } catch (err) {
      console.error("[Public] Error fetching gift info:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  /** Public staff list for gift page */
  app.get("/api/public/business/:slug/staff-list", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const staffList = await db.getStaffByOwner(owner.id);
      res.json({
        staff: (staffList as any[]).filter(s => s.available !== false).map(s => ({
          localId: s.localId, name: s.name, role: s.role || null,
          photoUri: s.photoUri || null, color: s.color || null,
          serviceIds: s.serviceIds ? (Array.isArray(s.serviceIds) ? s.serviceIds : JSON.parse(s.serviceIds)) : [],
          locationIds: s.locationIds ? (Array.isArray(s.locationIds) ? s.locationIds : JSON.parse(s.locationIds)) : [],
        })),
      });
    } catch (err) {
      console.error("[Public] Error fetching staff list:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/public/business/:slug/buy-gift", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const { purchaserName, purchaserEmail, recipientName, recipientEmail, recipientPhone,
        serviceIds = [], productIds = [], personalMessage,
        giftType = "service", balanceAmount,
        paymentMethod = "unpaid", paymentConfirmationNumber,
        recipientChoosesDate = true, preselectedDate, preselectedTime } = req.body;
      // Use business-configured validity (default 90 days) instead of client-supplied value
      const expiresInDays = (owner as any).giftValidDays ?? 90;
      if (!purchaserName || !purchaserEmail || !recipientName) {
        res.status(400).json({ error: "purchaserName, purchaserEmail, and recipientName are required" }); return;
      }
      // For balance-type gifts, balanceAmount is required; for service-type, at least one item is required
      if (giftType === "balance") {
        const amt = parseFloat(String(balanceAmount ?? 0));
        if (!amt || amt <= 0) {
          res.status(400).json({ error: "A positive balance amount is required for balance-type gifts" }); return;
        }
      } else {
        if (!serviceIds.length && !productIds.length) {
          res.status(400).json({ error: "At least one service or product must be selected" }); return;
        }
      }
      let totalValue: number;
      let selectedServices: any[] = [];
      let selectedProducts: any[] = [];
      let primaryServiceLocalId: string | null = null;
      let items: Array<{ name: string; price: number; type: string }> = [];
      if (giftType === "balance") {
        totalValue = parseFloat(String(balanceAmount));
        items = [{ name: "Balance Credit", price: totalValue, type: "balance" }];
      } else {
        const allServices = await db.getServicesByOwner(owner.id) as any[];
        const allProducts = await db.getProductsByOwner(owner.id) as any[];
        selectedServices = serviceIds.map((id: string) => allServices.find((s: any) => s.localId === id)).filter(Boolean);
        selectedProducts = productIds.map((id: string) => allProducts.find((p: any) => p.localId === id)).filter(Boolean);
        if (!selectedServices.length && !selectedProducts.length) {
          res.status(400).json({ error: "Selected services or products not found" }); return;
        }
        totalValue = [...selectedServices, ...selectedProducts].reduce((sum: number, item: any) => sum + parseFloat(String(item.price)), 0);
        primaryServiceLocalId = selectedServices.length > 0 ? selectedServices[0].localId : selectedProducts[0].localId;
        items = [
          ...selectedServices.map((s: any) => ({ name: s.name, price: parseFloat(String(s.price)), type: "service" })),
          ...selectedProducts.map((p: any) => ({ name: p.name, price: parseFloat(String(p.price)), type: "product" })),
        ];
      }
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "GIFT-";
      for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      const localId = "pub-gift-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + (parseInt(String(expiresInDays)) || 365));
      const expiresAt = expiry.toISOString().split("T")[0];
      const giftData = JSON.stringify({ giftType, serviceIds, productIds, originalValue: totalValue, remainingBalance: totalValue, purchasedPublicly: true });
      const messageWithData = (personalMessage || "") + "\n---GIFT_DATA---\n" + giftData + (paymentConfirmationNumber ? "\n---PAYMENT_REF---\n" + paymentConfirmationNumber : "");
      const dbase = await db.getDb();
      if (!dbase) { res.status(500).json({ error: "Database not available" }); return; }
      const { giftCards } = await import("../drizzle/schema");
      await dbase.insert(giftCards).values({
        businessOwnerId: owner.id, localId, code,
        serviceLocalId: primaryServiceLocalId ?? undefined,
        recipientName, recipientPhone: recipientPhone || null, message: messageWithData,
        redeemed: false, expiresAt, purchaserName, purchaserEmail,
        recipientEmail: recipientEmail || null, recipientChoosesDate: giftType === "balance" ? true : !!recipientChoosesDate,
        paymentMethod, paymentStatus: "unpaid",
        totalValue: String(totalValue.toFixed(2)), purchasedPublicly: true,
        preselectedDate: giftType !== "balance" ? (preselectedDate || null) : null,
        preselectedTime: giftType !== "balance" ? (preselectedTime || null) : null,
      } as any);
      const o = owner as any;
      const slug = o.customSlug || owner.businessName.toLowerCase().replace(/\s+/g, "-");
      const shareLink = (req.headers.origin || 'https://lime-of-time.com') + '/api/gift/' + encodeURIComponent(code);
      if (recipientEmail && recipientEmail.includes("@")) {
        sendGiftNotificationEmail({ recipientName, recipientEmail, purchaserName, businessName: owner.businessName, businessSlug: slug, giftCode: code, items, totalValue, personalMessage: personalMessage || undefined, expiresAt, recipientChoosesDate: !!recipientChoosesDate, preselectedDate: preselectedDate || undefined, preselectedTime: preselectedTime || undefined }).catch((e: any) => console.error("[Gift] recipient email error:", e));
      }
      if (purchaserEmail && purchaserEmail.includes("@")) {
        sendGiftPurchaseConfirmationEmail({ purchaserName, purchaserEmail, recipientName, businessName: owner.businessName, giftCode: code, items, totalValue, paymentMethod, shareLink }).catch((e: any) => console.error("[Gift] buyer email error:", e));
      }
      res.json({ success: true, code, shareLink, totalValue, paymentMethod, items });
    } catch (err) {
      console.error("[Public] Error creating gift purchase:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/public/gift-purchase/:code", async (req: Request, res: Response) => {
    try {
      const dbase = await db.getDb();
      if (!dbase) { res.status(500).json({ error: "Database not available" }); return; }
      const { giftCards } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const cards = await dbase.select().from(giftCards).where(eq(giftCards.code, req.params.code));
      if (!cards.length) { res.status(404).json({ error: "Gift not found" }); return; }
      const card = cards[0] as any;
      const owner = await db.getBusinessOwnerById(card.businessOwnerId) as any;
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const allServices = await db.getServicesByOwner(card.businessOwnerId) as any[];
      const allProducts = await db.getProductsByOwner(card.businessOwnerId) as any[];
      let serviceIds: string[] = [];
      let productIds: string[] = [];
      let totalValue = parseFloat(String(card.totalValue || 0));
      const rawMsg = card.message ?? "";
      const jsonMatch = rawMsg.match(/\n---GIFT_DATA---\n(.+)$/s);
      if (jsonMatch) {
        try { const d = JSON.parse(jsonMatch[1]); serviceIds = d.serviceIds ?? []; productIds = d.productIds ?? []; if (!totalValue) totalValue = d.originalValue ?? 0; } catch {}
      }
      const items: { name: string; price: number; type: string }[] = [];
      for (const sid of serviceIds) { const s = allServices.find(sv => sv.localId === sid); if (s) items.push({ name: s.name, price: parseFloat(String(s.price)), type: "service" }); }
      for (const pid of productIds) { const p = allProducts.find(pr => pr.localId === pid); if (p) items.push({ name: p.name, price: parseFloat(String(p.price)), type: "product" }); }
      const cleanMessage = rawMsg.replace(/\n---GIFT_DATA---\n.+$/s, "");
      const slug = owner.customSlug || owner.businessName.toLowerCase().replace(/\s+/g, "-");
      res.json({ code: card.code, purchaserName: card.purchaserName || null, recipientName: card.recipientName || null, personalMessage: cleanMessage || null, totalValue, paymentMethod: card.paymentMethod || "unpaid", paymentStatus: card.paymentStatus || "unpaid", redeemed: card.redeemed, expiresAt: card.expiresAt || null, items, businessName: owner.businessName, businessSlug: slug, businessLogoUri: owner.businessLogoUri || null, paymentMethods: { zelle: owner.zelleHandle || null, cashApp: owner.cashAppHandle || null, venmo: owner.venmoHandle || null, stripeEnabled: !!(owner.stripeConnectEnabled) } });
    } catch (err) {
      console.error("[Public] Error fetching gift purchase:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/buy-gift/:slug", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).send("<h1>Business not found</h1>"); return; }
      res.send(buyGiftPage(req.params.slug, owner));
    } catch (err) {
      console.error("[Public] Error serving buy-gift page:", err);
      res.status(500).send("<h1>Server error</h1>");
    }
  });

  app.get("/api/gift-confirm/:code", async (req: Request, res: Response) => {
    res.send(giftConfirmPage(req.params.code));
  });

  app.get("/buy-gift/:slug", (req: Request, res: Response) => {
    res.redirect(301, "/api/buy-gift/" + req.params.slug);
  });

  app.get("/gift-confirm/:code", (req: Request, res: Response) => {
    res.redirect(301, "/api/gift-confirm/" + req.params.code);
  });

  /** Homepage */
  app.get("/home", (_req: Request, res: Response) => {
    res.send(homePage());
  });

  app.get("/api/home", (_req: Request, res: Response) => {
    res.send(homePage());
  });

  // ── Payment Receipt Page (owner-initiated card payment success) ──────────────
  // GET /api/payment-receipt/:slug?session_id=cs_xxx
  // Dedicated clean receipt page shown after owner sends a payment link to client.
  // No booking form — just the receipt and a "Done" button.
  app.get("/api/payment-receipt/:slug", async (req: Request, res: Response) => {
    try {
      const { session_id } = req.query as { session_id?: string };
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).send(notFoundPage("Business not found")); return; }
      const bizName = escHtml(owner.businessName);
      const logoUri = (owner as any).businessLogoUri || "";
      const logoTag = logoUri ? `<img src="${escHtml(logoUri)}" alt="${bizName}" style="width:64px;height:64px;border-radius:16px;object-fit:cover;border:2px solid var(--border);margin-bottom:12px;">` : "";
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Payment Receipt — ${bizName}</title>
  ${baseStyles()}
</head>
<body>
<div class="container" style="max-width:480px;margin:0 auto;padding:20px 16px;">
  <div style="text-align:center;padding:28px 0 20px;">
    ${logoTag}
    <h1 style="font-size:22px;font-weight:800;color:var(--accent-dark);margin-bottom:4px;">${bizName}</h1>
    <div style="font-size:12px;color:var(--text-muted);">Payment Receipt</div>
  </div>
  <div class="card" id="receiptCard" style="text-align:center;">
    <div id="loadingState">
      <div style="font-size:48px;margin-bottom:16px;">⏳</div>
      <p style="color:var(--text-secondary);">Confirming your payment...</p>
    </div>
    <div id="successState" style="display:none;">
      <div style="font-size:56px;margin-bottom:12px;">✅</div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:6px;">Payment Confirmed!</h2>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:20px;">Thank you — your payment has been received.</p>
      <div id="receiptDetails" style="text-align:left;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:20px;"></div>
      <div id="manageLink" style="margin-bottom:16px;display:none;">
        <a id="manageLinkHref" href="#" style="color:var(--accent);font-size:14px;text-decoration:none;font-weight:600;">Manage or Cancel This Appointment →</a>
      </div>
      <button onclick="window.close()" style="width:100%;padding:14px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;">Done</button>
    </div>
    <div id="errorState" style="display:none;">
      <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
      <h2 style="font-size:18px;font-weight:700;margin-bottom:8px;">Payment Received</h2>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:20px;">Your payment was processed. If you need a receipt, please contact ${bizName}.</p>
      <button onclick="window.close()" style="width:100%;padding:14px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;">Done</button>
    </div>
  </div>
  <div style="text-align:center;padding:16px 0;">
    <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" alt="Lime Of Time" style="width:24px;height:24px;border-radius:0;object-fit:contain;background:transparent;vertical-align:middle;margin-right:6px;">
    <span style="font-size:12px;color:var(--text-muted);">Powered by Lime Of Time</span>
  </div>
</div>
<script>
  const SESSION_ID = ${JSON.stringify(session_id || "")};
  const SLUG = ${JSON.stringify(req.params.slug.replace(/&/g, '\u0026'))};
  const API = window.location.origin + "/api/public/business/" + encodeURIComponent(SLUG);

  async function loadReceipt() {
    if (!SESSION_ID) { showError(); return; }
    try {
      const res = await fetch(API + '/appointment-by-session?session_id=' + encodeURIComponent(SESSION_ID));
      const data = await res.json();
      if (data.ok && data.appointment) {
        renderReceipt(data.appointment);
      } else {
        showError();
      }
    } catch(e) {
      showError();
    }
  }

  function renderReceipt(a) {
    const [yr, mo, dy] = (a.date || '').split('-').map(Number);
    const dateObj = new Date(yr, mo - 1, dy);
    const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const [hh, mm] = (a.time || '00:00').split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    const timeStr = h12 + ':' + String(mm).padStart(2,'0') + ' ' + ampm;
    const endMin = hh * 60 + mm + (a.duration || 60);
    const eh = Math.floor(endMin / 60), em = endMin % 60;
    const eampm = eh >= 12 ? 'PM' : 'AM';
    const eh12 = eh === 0 ? 12 : eh > 12 ? eh - 12 : eh;
    const endStr = eh12 + ':' + String(em).padStart(2,'0') + ' ' + eampm;
    const locationLine = a.locationName ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid var(--border);"><span style="color:var(--text-secondary);">Location</span><span style="font-weight:600;text-align:right;max-width:60%;">' + (a.locationAddress ? a.locationName + '<br><span style="font-weight:400;color:var(--text-muted);font-size:12px;">' + a.locationAddress + '</span>' : a.locationName) + '</span></div>' : '';
    const rows = [
      { label: 'Client', value: a.clientName },
      { label: 'Service', value: a.serviceName },
      { label: 'Date', value: dateStr },
      { label: 'Time', value: timeStr + ' — ' + endStr },
    ];
    let html = rows.map(r => '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid var(--border);"><span style="color:var(--text-secondary);">' + r.label + '</span><span style="font-weight:600;">' + r.value + '</span></div>').join('');
    html += locationLine;
    html += '<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:16px;font-weight:700;"><span>Total Paid</span><span style="color:var(--accent);">$' + parseFloat(a.totalPrice || '0').toFixed(2) + '</span></div>';
    html += '<div style="margin-top:8px;font-size:13px;color:var(--text-secondary);">💳 Paid by Card</div>';
    document.getElementById('receiptDetails').innerHTML = html;
    if (a.manageUrl) {
      const ml = document.getElementById('manageLinkHref');
      if (ml) ml.href = a.manageUrl;
      const mlWrap = document.getElementById('manageLink');
      if (mlWrap) mlWrap.style.display = 'block';
    }
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('successState').style.display = 'block';
  }

  function showError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
  }

  loadReceipt();
</script>
</body>
</html>`);
    } catch (err) {
      console.error("[Public] Error serving payment receipt page:", err);
      res.status(500).send(errorPage());
    }
  });

  // GET /api/public/stripe-config
  // Returns the platform Stripe publishable key for the native payment sheet
  app.get("/api/public/stripe-config", async (_req: Request, res: Response) => {
    try {
      const publishableKey = await getPlatformConfig("STRIPE_PUBLISHABLE_KEY");
      res.json({ publishableKey: publishableKey || "" });
    } catch {
      res.json({ publishableKey: "" });
    }
  });
}

// ─── HTML Templates ─────────────────────────────────────────────────

function baseStyles(): string {
  return `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :root {
        --bg: #f5f7f5; --bg-card: #fff; --bg-card-hover: #f8fbf8;
        --bg-input: #fafcfa; --bg-selected: #e8f5e3; --bg-selected-hover: #f0f7ef;
        --text: #1a1a1a; --text-secondary: #666; --text-muted: #888; --text-hint: #999; --text-light: #aaa;
        --accent: #4a8c3f; --accent-dark: #2d5a27; --accent-bg: #e8f0e6; --accent-bg-light: #f0f7ef;
        --border: #e8ece8; --border-input: #dde3dd; --border-heavy: #e8ece8;
        --btn-disabled: #b8d4b3;
        --error: #dc2626; --error-bg: #fef2f2; --error-border: #fecaca;
        --discount-bg: #fef3c7; --discount-text: #92400e;
        --star: #f59e0b;
        --shadow: rgba(0,0,0,0.04);
        --skeleton-from: #e8ece8; --skeleton-to: #f5f7f5;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f1210; --bg-card: #1a1f1a; --bg-card-hover: #222822;
          --bg-input: #1e241e; --bg-selected: #1e3a1a; --bg-selected-hover: #243024;
          --text: #e8ece8; --text-secondary: #a8b0a8; --text-muted: #8a928a; --text-hint: #6a726a; --text-light: #5a625a;
          --accent: #5ca84f; --accent-dark: #7cc070; --accent-bg: #1e3a1a; --accent-bg-light: #243024;
          --border: #2a322a; --border-input: #3a423a; --border-heavy: #2a322a;
          --btn-disabled: #3a4a38;
          --error: #f87171; --error-bg: #2a1515; --error-border: #5a2020;
          --discount-bg: #3a3018; --discount-text: #fbbf24;
          --star: #fbbf24;
          --shadow: rgba(0,0,0,0.2);
          --skeleton-from: #2a322a; --skeleton-to: #1a1f1a;
        }
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
      }
      .container {
        max-width: 480px;
        margin: 0 auto;
        padding: 20px 16px;
        min-height: 100vh;
      }
      .header {
        text-align: center;
        padding: 28px 0 20px;
      }
      .header .biz-logo {
        width: 72px; height: 72px;
        border-radius: 0;
        object-fit: contain;
        margin-bottom: 12px;
        border: none;
        box-shadow: none;
        background: transparent;
      }
      .header h1 {
        font-size: 24px;
        font-weight: 800;
        color: var(--accent-dark);
        margin-bottom: 4px;
        letter-spacing: -0.5px;
      }
      .header .subtitle {
        font-size: 12px;
        color: var(--text-muted);
        font-weight: 500;
      }
      .card {
        background: var(--bg-card);
        border-radius: 20px;
        padding: 22px;
        margin-bottom: 16px;
        border: 1px solid var(--border);
        box-shadow: 0 2px 12px var(--shadow), 0 1px 3px rgba(0,0,0,0.04);
      }
      .card h2 {
        font-size: 17px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 14px;
        letter-spacing: -0.3px;
      }
      .biz-info { display: flex; flex-direction: column; gap: 6px; }
      .biz-info-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
      .biz-info-row a { color: var(--accent); text-decoration: underline; }
      .btn {
        display: block;
        width: 100%;
        padding: 15px;
        border: none;
        border-radius: 14px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s;
        letter-spacing: -0.1px;
      }
      .btn:active { opacity: 0.88; transform: scale(0.98); }
      .btn-primary {
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
        color: #fff;
        box-shadow: 0 4px 14px rgba(74,140,63,0.35);
      }
      .btn-primary:hover:not(:disabled) { box-shadow: 0 6px 18px rgba(74,140,63,0.45); }
      .btn-primary:disabled { background: var(--btn-disabled); cursor: not-allowed; box-shadow: none; }
      .btn-secondary {
        background: var(--accent-bg);
        color: var(--accent-dark);
        border: 1.5px solid var(--border);
      }
      .input-group { margin-bottom: 14px; }
      .input-group label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 6px;
      }
      .input-group input, .input-group textarea {
        width: 100%;
        padding: 12px 14px;
        border: 1.5px solid var(--border-input);
        border-radius: 10px;
        font-size: 15px;
        background: var(--bg-input);
        color: var(--text);
        outline: none;
        transition: border-color 0.2s;
        font-family: inherit;
      }
      .input-group input:focus, .input-group textarea:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(74,140,63,0.15);
      }
      .input-group input::placeholder, .input-group textarea::placeholder {
        color: var(--text-hint);
      }
      .input-group textarea { resize: vertical; min-height: 80px; }
      .service-list { display: flex; flex-direction: column; gap: 12px; }
      .service-item {
        display: flex;
        align-items: center;
        padding: 14px 16px;
        border: 1.5px solid var(--border);
        border-radius: 14px;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
        background: var(--bg-card);
      }
      .service-item:hover { background: var(--bg-card-hover); border-color: var(--accent); }
      .service-item.selected { border-color: var(--accent); background: var(--accent-bg-light); box-shadow: 0 0 0 3px rgba(74,140,63,0.12); }
      .service-dot {
        width: 44px; height: 44px;
        border-radius: 10px;
        margin-right: 12px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 800;
        overflow: hidden;
      }
      .service-dot img { width:44px; height:44px; object-fit:cover; border-radius:10px; }
      .service-info { flex: 1; }
      .service-name { font-size: 15px; font-weight: 600; color: var(--text); }
      .service-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
      .service-price { font-size: 15px; font-weight: 700; color: var(--accent-dark); }
      .date-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
        margin-bottom: 16px;
      }
      .date-cell {
        aspect-ratio: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        border: 1.5px solid transparent;
        transition: all 0.15s;
      }
      .date-cell:hover:not(.disabled) { background: var(--accent-bg-light); border-color: var(--accent); }
      .date-cell.selected { border-color: var(--accent); background: var(--bg-selected); color: var(--accent-dark); font-weight: 700; box-shadow: 0 0 0 3px rgba(74,140,63,0.12); }
      .date-cell.disabled { opacity: 0.3; cursor: not-allowed; }
      .date-cell .day-name { font-size: 10px; color: var(--text-hint); font-weight: 400; }
      .date-cell .day-num { font-size: 15px; }
      .time-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .time-slot {
        padding: 11px 8px;
        text-align: center;
        border: 1.5px solid var(--border);
        border-radius: 12px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.15s;
        background: var(--bg-card);
      }
      .time-slot:hover { background: var(--accent-bg-light); border-color: var(--accent); }
      .time-slot.selected { border-color: var(--accent); background: var(--bg-selected); color: var(--accent-dark); font-weight: 700; box-shadow: 0 0 0 3px rgba(74,140,63,0.12); }
      .confirm-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid #f0f0f0;
        font-size: 14px;
      }
      .confirm-row:last-child { border-bottom: none; }
      .confirm-label { color: var(--text-muted); flex-shrink: 0; }
      .confirm-value { font-weight: 600; color: var(--text); text-align: right; }
      .success-icon {
        width: 64px; height: 64px;
        border-radius: 50%;
        background: var(--bg-selected);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
        font-size: 32px;
      }
      .step-indicator {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        gap: 0;
        margin-bottom: 24px;
        padding: 0 4px;
      }
      .step-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 1;
        position: relative;
      }
      .step-item:not(:last-child)::after {
        content: '';
        position: absolute;
        top: 11px;
        left: calc(50% + 12px);
        right: calc(-50% + 12px);
        height: 2px;
        background: var(--border);
        transition: background 0.3s;
        z-index: 0;
      }
      .step-item.done:not(:last-child)::after {
        background: var(--accent);
      }
      .step-dot {
        width: 22px; height: 22px;
        border-radius: 50%;
        background: var(--bg-card);
        border: 2px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700;
        color: var(--text-hint);
        transition: all 0.25s;
        position: relative; z-index: 1;
        margin-bottom: 4px;
      }
      .step-dot.active {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
        box-shadow: 0 0 0 4px rgba(74,140,63,0.15);
      }
      .step-dot.done {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }
      .step-label {
        font-size: 8px;
        font-weight: 500;
        color: var(--text-hint);
        text-align: center;
        transition: color 0.25s;
        line-height: 1.2;
        white-space: nowrap;
      }
      .step-item.active .step-label { color: var(--accent-dark); font-weight: 700; }
      .step-item.done .step-label { color: var(--accent); }
      /* Persistent selected-location banner (shown on steps 1–6) */
      #selectedLocBanner {
        display: none;
        align-items: center;
        gap: 8px;
        background: var(--accent-bg-light);
        border: 1px solid var(--accent);
        border-radius: 10px;
        padding: 8px 12px;
        margin-bottom: 12px;
        font-size: 13px;
        color: var(--accent-dark);
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }
      #selectedLocBanner.show { display: flex; }
      #selectedLocBanner:hover { background: var(--accent-bg); }
      #selectedLocBanner .loc-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #selectedLocBanner .loc-change { font-size: 11px; font-weight: 500; color: var(--accent); white-space: nowrap; text-decoration: underline; }
      .closed-banner {
        background: var(--error-bg);
        border: 1px solid var(--error-border);
        border-radius: 12px;
        padding: 16px;
        text-align: center;
        color: var(--error);
        font-weight: 500;
        margin-bottom: 16px;
      }
      .discount-badge {
        display: inline-block;
        background: var(--discount-bg);
        color: var(--discount-text);
        font-size: 12px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 6px;
        margin-left: 8px;
      }
      .stars { display: flex; gap: 4px; }
      .star {
        width: 36px; height: 36px;
        cursor: pointer;
        font-size: 28px;
        transition: transform 0.1s;
      }
      .star:hover { transform: scale(1.15); }
      .review-card {
        padding: 14px;
        border-bottom: 1px solid #f0f0f0;
      }
      .review-card:last-child { border-bottom: none; }
      .review-stars { color: var(--star); font-size: 14px; }
      .review-name { font-weight: 600; font-size: 14px; margin-top: 4px; }
      .review-comment { font-size: 13px; color: #666; margin-top: 4px; }
      .review-date { font-size: 11px; color: #aaa; margin-top: 4px; }
      .loading { text-align: center; padding: 40px; color: var(--text-muted); }
      .error-msg { color: var(--error); font-size: 13px; margin-top: 8px; text-align: center; }
      /* Skeleton loading */
      .skeleton { background: linear-gradient(90deg, var(--skeleton-from) 25%, var(--skeleton-to) 50%, var(--skeleton-from) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
      @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      .skeleton-line { height: 14px; margin-bottom: 10px; }
      .skeleton-block { height: 56px; margin-bottom: 8px; border-radius: 12px; }
      .cal-nav { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .cal-nav button { background:none; border:1px solid var(--border-input); border-radius:8px; padding:6px 12px; cursor:pointer; font-size:14px; color:var(--accent-dark); }
      .cal-nav button:hover { background:var(--accent-bg-light); }
      .cal-nav .cal-title { font-size:16px; font-weight:700; color:var(--text); }
      .cal-weekdays { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:4px; text-align:center; }
      .cal-weekdays span { font-size:11px; color:var(--text-hint); font-weight:500; padding:4px 0; }
      .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:16px; }
      .cal-day { aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:10px; cursor:pointer; font-size:14px; font-weight:500; border:2px solid transparent; transition:all 0.15s; position:relative; }
      .cal-day .avail-dot { width:5px; height:5px; border-radius:50%; background:var(--accent); margin-top:2px; }
      .cal-day.disabled .avail-dot { display:none; }
      .cal-day:hover:not(.disabled):not(.empty) { background:var(--accent-bg-light); }
      .cal-day.selected { border-color:var(--accent); background:var(--bg-selected); color:var(--accent-dark); font-weight:700; }
      .cal-day.disabled { opacity:0.25; cursor:not-allowed; color:var(--text-light); }
      .cal-day.empty { cursor:default; }
      .cal-day.today { font-weight:700; color:var(--accent); border-color:rgba(var(--accent-rgb,10,126,164),0.35); }
      .cal-day.today .today-label { display:block; font-size:8px; font-weight:700; color:var(--accent); line-height:1; margin-top:1px; text-transform:uppercase; letter-spacing:0.02em; }
      .cal-day:not(.today) .today-label { display:none; }
      .cal-day.temp-closed { background:rgba(239,68,68,0.1); color:#ef4444; cursor:not-allowed; text-decoration:line-through; opacity:0.85; }
      .cal-day.temp-closed:hover { background:rgba(239,68,68,0.15); }
      .loc-closed-banner { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.4); border-radius:12px; padding:14px 16px; margin-bottom:16px; display:none; }
      .loc-closed-banner.show { display:block; }
      .loc-closed-banner .lc-title { font-size:14px; font-weight:700; color:#ef4444; margin-bottom:4px; }
      .loc-closed-banner .lc-msg { font-size:13px; color:var(--text-secondary); line-height:1.5; }
      /* Top-level location closed banner (shown before step 0) */
      #topLocClosedBanner { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.4); border-radius:12px; padding:16px; margin-bottom:16px; display:none; text-align:center; }
      #topLocClosedBanner.show { display:block; }
      #topLocClosedBanner .lc-title { font-size:15px; font-weight:700; color:#ef4444; margin-bottom:6px; }
      #topLocClosedBanner .lc-msg { font-size:13px; color:var(--text-secondary); line-height:1.6; }
      .cart-items { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
      .cart-item { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:var(--bg-card-hover); border-radius:10px; font-size:13px; }
      .cart-item .cart-remove { color:var(--error); cursor:pointer; font-size:18px; padding:0 4px; }
      .cart-total { display:flex; justify-content:space-between; padding:10px 0; border-top:2px solid var(--border-heavy); font-size:15px; font-weight:700; }
      .product-item { display:flex; align-items:center; padding:12px; border:2px solid var(--border); border-radius:12px; cursor:pointer; transition:border-color 0.2s, background 0.2s; margin-bottom:6px; }
      .product-item:hover { background:var(--bg-card-hover); }
      .product-item.selected { border-color:var(--accent); background:var(--accent-bg-light); }
      .seg-control { display:flex; background:var(--border); border-radius:10px; padding:3px; margin-bottom:12px; }
      .seg-btn { flex:1; text-align:center; padding:8px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; color:var(--text-secondary); }
      .seg-btn.active { background:var(--bg-card); color:var(--accent-dark); box-shadow:0 1px 3px var(--shadow); }
      /* Category / Brand tile grid */
      .tile-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:8px; align-items:start; }
      .tile-card { background:var(--bg-card); border:2px solid var(--border); border-radius:14px; padding:16px 12px; cursor:pointer; text-align:center; transition:all 0.15s; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; box-sizing:border-box; min-height:90px; overflow:visible; }
      .tile-card .tile-emoji { font-size:24px; margin-bottom:8px; line-height:1; flex-shrink:0; }
      .tile-card:hover { border-color:var(--accent); background:var(--accent-bg-light); }
      .tile-card .tile-name { font-size:14px; font-weight:700; color:var(--text); margin-bottom:4px; line-height:1.3; width:100%; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; overflow-wrap:break-word; }
      .tile-card .tile-count { font-size:12px; color:var(--text-muted); flex-shrink:0; }
      /* Drill-down back link */
      .drill-back { display:inline-flex; align-items:center; gap:4px; color:var(--accent); font-size:13px; font-weight:600; cursor:pointer; margin-bottom:12px; }
      .drill-back:hover { opacity:0.75; }
      /* Item detail overlay */
      .detail-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:200; display:flex; align-items:flex-end; justify-content:center; }
      .detail-sheet { background:var(--bg-card); border-radius:24px 24px 0 0; padding:24px 20px 40px; max-width:480px; width:100%; max-height:85vh; overflow-y:auto; position:relative; }
      .detail-sheet .drag-handle { width:40px; height:4px; background:var(--border); border-radius:2px; margin:0 auto 20px; }
      .detail-sheet .detail-photo { width:100%; height:auto; max-height:none; object-fit:contain; border-radius:12px; margin-bottom:14px; display:block; }
      .detail-sheet .detail-photo-placeholder { width:100%; height:120px; background:var(--border); border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; margin-bottom:14px; font-size:36px; opacity:0.7; }
      .detail-sheet .detail-photo-placeholder .ph-hint { font-size:11px; color:var(--text-muted); font-weight:500; text-align:center; padding:0 12px; }
      .detail-sheet .detail-badge { display:inline-block; background:var(--accent-bg-light); color:var(--accent-dark); font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; margin-bottom:8px; }
      .detail-sheet .detail-name { font-size:20px; font-weight:800; color:var(--text); margin-bottom:6px; }
      .detail-sheet .detail-price { font-size:22px; font-weight:800; color:var(--accent-dark); margin-bottom:8px; }
      .detail-sheet .detail-meta { font-size:13px; color:var(--text-muted); margin-bottom:10px; }
      .detail-sheet .detail-desc { font-size:14px; color:var(--text-secondary); line-height:1.55; margin-bottom:18px; }
      .detail-sheet .detail-add-btn { width:100%; padding:14px; background:var(--accent); color:#fff; border:none; border-radius:14px; font-size:16px; font-weight:700; cursor:pointer; margin-bottom:10px; }
      .detail-sheet .detail-add-btn:hover { opacity:0.9; }
      .detail-sheet .detail-dismiss { width:100%; padding:10px; background:none; border:none; color:var(--text-muted); font-size:14px; cursor:pointer; }
      .detail-sheet .detail-dismiss:hover { color:var(--text); }
      .receipt-box { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:20px; }
      /* Cookie consent banner */
      .cookie-banner { position:fixed; bottom:0; left:0; right:0; background:var(--bg-card); border-top:1px solid var(--border); padding:14px 16px; z-index:9999; box-shadow:0 -2px 10px var(--shadow); display:none; }
      .cookie-banner.show { display:flex; align-items:center; gap:12px; justify-content:center; flex-wrap:wrap; }
      .cookie-banner p { font-size:12px; color:var(--text-secondary); margin:0; flex:1; min-width:200px; }
      .cookie-banner p a { color:var(--accent); text-decoration:underline; }
      .cookie-banner button { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 20px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
      /* Legal footer */
      .legal-footer { text-align:center; padding:20px 0 32px; font-size:11px; color:var(--text-hint); }
      .legal-footer a { color:var(--text-muted); text-decoration:underline; margin:0 6px; }
      /* Consent checkbox */
      .consent-row { display:flex; align-items:flex-start; gap:10px; margin:14px 0; font-size:12px; color:var(--text-secondary); }
      .consent-row input[type=checkbox] { margin-top:2px; width:18px; height:18px; accent-color:var(--accent); flex-shrink:0; }
      .consent-row a { color:var(--accent); text-decoration:underline; }
      /* Focus visible for accessibility */
      :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      @media (max-width: 360px) {
        .time-grid { grid-template-columns: repeat(2, 1fr); }
      }
    </style>
  `;
}

// ─── Buy a Gift Page ─────────────────────────────────────────────────────────
function buyGiftPage(slug: string, owner: any): string {
  const bizName = (owner.businessName || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const logoUri = owner.logoUrl || owner.businessLogoUri || "";
  // Always show the original app icon (Lime Of Time brand) on the gift page
  const APP_ICON_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png";
  const fallbackSrc = logoUri || '';
  const logoTag = `<img src="${APP_ICON_URL}" alt="Lime Of Time" class="biz-logo" onerror="this.src='${fallbackSrc}';this.onerror=null;">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <title>Buy a Gift — ${bizName}</title>
  <meta name="description" content="Buy a gift for someone special at ${bizName}.">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    :root{
      --bg:#f5f7f5;--bg-card:#fff;--bg-card-hover:#f8fbf8;
      --bg-input:#fafcfa;--bg-sel:#e8f5e3;--bg-sel-hover:#f0f7ef;
      --text:#1a1a1a;--text2:#666;--textm:#888;--textl:#aaa;
      --accent:#4a8c3f;--adk:#2d5a27;--accent-bg:#e8f0e6;--accent-bg-light:#f0f7ef;
      --border:#e8ece8;--bdi:#dde3dd;
      --err:#dc2626;--err-bg:#fef2f2;
      --gift:#4a8c3f;--gift-bg:#e8f0e6;
      --shadow:rgba(0,0,0,0.04);
    }
    @media(prefers-color-scheme:dark){:root{
      --bg:#0f1210;--bg-card:#1a1f1a;--bg-card-hover:#222822;
      --bg-input:#1e241e;--bg-sel:#1e3a1a;--bg-sel-hover:#243024;
      --text:#e8ece8;--text2:#a8b0a8;--textm:#8a928a;--textl:#5a625a;
      --accent:#5ca84f;--adk:#7cc070;--accent-bg:#1e3a1a;--accent-bg-light:#243024;
      --border:#2a322a;--bdi:#3a423a;
      --err:#f87171;--err-bg:#2a1515;
      --gift:#6db563;--gift-bg:#1a2e1a;
      --shadow:rgba(0,0,0,0.2);
    }}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
    .container{max-width:480px;margin:0 auto;padding:0 0 100px;}
    /* Header */
    .header{text-align:center;padding:28px 16px 20px;background:var(--bg-card);border-bottom:1px solid var(--border);margin-bottom:0;}
    .biz-logo{width:72px;height:72px;border-radius:0;object-fit:contain;border:none;box-shadow:none;background:transparent;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;}
    .biz-logo-placeholder{width:72px;height:72px;border-radius:20px;background:var(--gift-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:32px;border:2px solid var(--border);}
    .header h1{font-size:22px;font-weight:800;color:var(--text);margin-bottom:4px;letter-spacing:-0.5px;}
    .header .subtitle{font-size:13px;color:var(--textm);font-weight:500;}
    /* Step indicator */
    .steps{display:flex;align-items:center;justify-content:center;gap:0;padding:14px 16px;background:var(--bg-card);border-bottom:1px solid var(--border);margin-bottom:0;}
    .step-item{display:flex;flex-direction:column;align-items:center;flex:1;position:relative;}
    .step-item:not(:last-child)::after{content:'';position:absolute;top:14px;left:50%;width:100%;height:2px;background:var(--border);z-index:0;}
    .step-item.done::after{background:var(--accent);}
    .step-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid var(--border);background:var(--bg-card);color:var(--textm);position:relative;z-index:1;}
    .step-dot.active{background:var(--gift);border-color:var(--gift);color:#fff;}
    .step-dot.done{background:var(--accent);border-color:var(--accent);color:#fff;}
    .step-label{font-size:10px;color:var(--textm);margin-top:4px;font-weight:500;text-align:center;}
    .step-item.active .step-label{color:var(--gift);font-weight:700;}
    .step-item.done .step-label{color:var(--accent);}
    /* Cards */
    .card{background:var(--bg-card);border-radius:0;padding:20px 16px;margin-bottom:8px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
    .card h2{font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;letter-spacing:-0.3px;}
    .card .card-sub{font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5;}
    /* Service/product tiles */
    .tile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;align-items:start;}
    .tile{background:var(--bg-card);border:2px solid var(--border);border-radius:16px;padding:16px 12px;cursor:pointer;text-align:center;transition:all .15s;-webkit-tap-highlight-color:transparent;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;box-sizing:border-box;min-height:90px;overflow:visible;}
    .tile:active{transform:scale(0.97);}
    .tile.selected{border-color:var(--gift);background:var(--gift-bg);}
    .tile-icon{font-size:28px;margin-bottom:8px;display:block;flex-shrink:0;}
    .tile-name{font-size:13px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:4px;word-break:break-word;overflow-wrap:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    .tile-price{font-size:13px;font-weight:700;color:var(--accent);flex-shrink:0;}
    .tile-dur{font-size:11px;color:var(--textm);margin-top:2px;flex-shrink:0;}
    .tile.selected .tile-name{color:var(--gift);}
    /* Service list rows */
    .svc-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent;}
    .svc-row:last-child{border-bottom:none;}
    .svc-row-check{width:24px;height:24px;border-radius:50%;border:2px solid var(--bdi);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
    .svc-row-check.checked{background:var(--gift);border-color:var(--gift);}
    .svc-row-info{flex:1;}
    .svc-row-name{font-size:14px;font-weight:600;color:var(--text);}
    .svc-row-meta{font-size:12px;color:var(--textm);margin-top:2px;}
    .svc-row-price{font-size:14px;font-weight:700;color:var(--accent);flex-shrink:0;}
    /* Search */
    .search-wrap{position:relative;margin-bottom:14px;}
    .search-wrap input{width:100%;padding:11px 14px 11px 38px;border:1.5px solid var(--bdi);border-radius:12px;font-size:14px;background:var(--bg-input);color:var(--text);outline:none;-webkit-appearance:none;}
    .search-wrap input:focus{border-color:var(--gift);}
    .search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px;pointer-events:none;}
    /* Category back button */
    .cat-back{display:flex;align-items:center;gap:8px;padding:10px 0 14px;cursor:pointer;color:var(--gift);font-size:14px;font-weight:600;}
    /* Input groups */
    .input-group{margin-bottom:14px;}
    .input-group label{display:block;font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px;}
    .input-group input,.input-group textarea,.input-group select{width:100%;padding:13px 14px;border:1.5px solid var(--bdi);border-radius:12px;font-size:15px;background:var(--bg-input);color:var(--text);outline:none;-webkit-appearance:none;font-family:inherit;}
    .input-group input:focus,.input-group textarea:focus,.input-group select:focus{border-color:var(--gift);}
    .input-group textarea{resize:none;min-height:80px;line-height:1.5;}
    /* Toggle row */
    .toggle-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);}
    .toggle-row:last-child{border-bottom:none;}
    .toggle-info{flex:1;}
    .toggle-info .t-title{font-size:14px;font-weight:600;color:var(--text);}
    .toggle-info .t-sub{font-size:12px;color:var(--textm);margin-top:2px;}
    .toggle{width:48px;height:28px;border-radius:14px;background:var(--border);position:relative;cursor:pointer;transition:background .2s;flex-shrink:0;}
    .toggle.on{background:var(--gift);}
    .toggle-knob{width:22px;height:22px;border-radius:50%;background:#fff;position:absolute;top:3px;left:3px;transition:left .2s;box-shadow:0 1px 4px rgba(0,0,0,0.2);}
    .toggle.on .toggle-knob{left:23px;}
    /* Payment options */
    .pay-opt{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;border:2px solid var(--border);background:var(--bg-card);cursor:pointer;margin-bottom:10px;transition:all .15s;-webkit-tap-highlight-color:transparent;}
    .pay-opt.selected{border-color:var(--gift);background:var(--gift-bg);}
    .pay-opt-icon{font-size:24px;flex-shrink:0;}
    .pay-opt-info{flex:1;}
    .pay-opt-label{font-size:14px;font-weight:700;color:var(--text);}
    .pay-opt-sub{font-size:12px;color:var(--textm);margin-top:2px;}
    .pay-opt-check{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .pay-opt.selected .pay-opt-check{background:var(--gift);border-color:var(--gift);}
    /* Summary bar */
    .summary-bar{background:var(--bg-card);border-top:1px solid var(--border);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;}
    .summary-bar .sum-label{font-size:13px;color:var(--textm);}
    .summary-bar .sum-total{font-size:18px;font-weight:800;color:var(--accent);}
    /* Sticky footer */
    .sticky-footer{position:fixed;bottom:0;left:0;right:0;background:var(--bg-card);border-top:1px solid var(--border);padding:12px 16px;z-index:100;max-width:480px;margin:0 auto;}
    @media(min-width:481px){.sticky-footer{left:50%;transform:translateX(-50%);width:480px;}}
    .footer-inner{display:flex;gap:10px;align-items:center;}
    .footer-total{flex:1;}
    .footer-total .ft-label{font-size:11px;color:var(--textm);}
    .footer-total .ft-amount{font-size:18px;font-weight:800;color:var(--text);}
    .btn{padding:14px 20px;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s;letter-spacing:-0.1px;-webkit-tap-highlight-color:transparent;}
    .btn:active{transform:scale(0.97);}
    .btn-primary{background:linear-gradient(135deg,var(--gift) 0%,#2d5a27 100%);color:#fff;box-shadow:0 4px 14px rgba(74,140,63,0.35);}
    .btn-primary:disabled{background:#ccc;box-shadow:none;cursor:not-allowed;}
    .btn-secondary{background:var(--accent-bg);color:var(--adk);border:1.5px solid var(--border);}
    .btn-full{width:100%;}
    .btn-flex{flex:1;}
    /* Date picker */
    .date-toggle{display:flex;background:var(--bg-input);border-radius:12px;padding:3px;border:1.5px solid var(--bdi);margin-bottom:16px;}
    .date-toggle-btn{flex:1;padding:10px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:transparent;color:var(--textm);transition:all .15s;}
    .date-toggle-btn.active{background:var(--gift);color:#fff;}
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:8px;}
    .cal-day-label{text-align:center;font-size:11px;font-weight:700;color:var(--textm);padding:4px 0;}
    .cal-day{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;font-size:13px;font-weight:600;cursor:pointer;color:var(--text);-webkit-tap-highlight-color:transparent;}
    .cal-day:active{transform:scale(0.9);}
    .cal-day.today{border:2px solid var(--gift);}
    .cal-day.selected{background:var(--gift);color:#fff;}
    .cal-day.disabled{color:var(--textl);cursor:default;pointer-events:none;}
    .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
    .cal-nav-btn{width:36px;height:36px;border-radius:50%;border:1.5px solid var(--border);background:var(--bg-card);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text);}
    .cal-month-label{font-size:15px;font-weight:700;color:var(--text);}
    .time-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;}
    .time-slot{padding:10px 6px;border:1.5px solid var(--border);border-radius:10px;text-align:center;font-size:13px;font-weight:600;cursor:pointer;color:var(--text);-webkit-tap-highlight-color:transparent;transition:all .15s;}
    .time-slot:active{transform:scale(0.95);}
    .time-slot.selected{background:var(--gift);border-color:var(--gift);color:#fff;}
    /* Success */
    .success-wrap{text-align:center;padding:40px 16px;}
    .success-icon{font-size:64px;margin-bottom:16px;}
    .success-title{font-size:24px;font-weight:800;color:var(--text);margin-bottom:8px;}
    .success-sub{font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:24px;}
    .code-box{background:var(--gift-bg);border:2px dashed var(--gift);border-radius:16px;padding:16px;margin-bottom:20px;}
    .code-label{font-size:12px;color:var(--textm);margin-bottom:4px;}
    .code-value{font-size:28px;font-weight:900;color:var(--gift);letter-spacing:2px;}
    .share-btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:14px;border:2px solid var(--gift);background:var(--gift-bg);color:var(--gift);font-size:15px;font-weight:700;cursor:pointer;width:100%;margin-bottom:10px;-webkit-tap-highlight-color:transparent;}
    /* Misc */
    .section-title{font-size:12px;font-weight:700;color:var(--textm);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;}
    .err-msg{color:var(--err);font-size:12px;margin-top:4px;}
    .selected-items-bar{background:var(--accent-bg-light);border:1.5px solid var(--accent);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--accent);font-weight:600;display:none;}
    .spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg);}}
    .hidden{display:none!important;}
  </style>
</head>
<body>
<div class="container" id="app">
  <!-- Header -->
  <div class="header">
    ${logoTag}
    <h1>${bizName}</h1>
    <div class="subtitle">🎁 Buy a Gift</div>
  </div>
  <!-- Step indicator -->
  <div class="steps" id="stepBar">
    <div class="step-item active" id="si0">
      <div class="step-dot active" id="sd0">1</div>
      <div class="step-label">Items</div>
    </div>
    <div class="step-item" id="si1">
      <div class="step-dot" id="sd1">2</div>
      <div class="step-label">Details</div>
    </div>
    <div class="step-item" id="si2">
      <div class="step-dot" id="sd2">3</div>
      <div class="step-label">Date</div>
    </div>
    <div class="step-item" id="si3">
      <div class="step-dot" id="sd3">4</div>
      <div class="step-label">Staff</div>
    </div>
    <div class="step-item" id="si4">
      <div class="step-dot" id="sd4">5</div>
      <div class="step-label">Payment</div>
    </div>
  </div>

  <!-- Step 0: Select Items -->
  <div id="step0" class="card" style="margin-top:8px;">
    <h2>Select Services &amp; Products</h2>
    <p class="card-sub">Choose one or more items to include in this gift.</p>
    <!-- Most Popular Services -->
    <div id="popularSection" style="display:none;margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;color:var(--textm);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">⭐ Most Popular</div>
      <div id="popularList" style="display:flex;flex-direction:row;gap:10px;overflow-x:auto;padding-bottom:4px;"></div>
    </div>
    <!-- Location selector (for staff filtering) -->
    <div id="locationSelectorWrap" style="display:none;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:var(--textm);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">📍 Location</div>
      <div id="locationSelectorList" style="display:flex;flex-direction:row;gap:8px;flex-wrap:wrap;"></div>
    </div>
    <!-- Tab switcher -->
    <div style="display:flex;background:var(--bg-input);border-radius:12px;padding:3px;border:1.5px solid var(--bdi);margin-bottom:14px;">
      <button onclick="switchItemTab('services')" id="tabSvc" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:var(--gift);color:#fff;transition:all .15s;">Services</button>
      <button onclick="switchItemTab('products')" id="tabProd" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:transparent;color:var(--textm);transition:all .15s;">Products</button>
    </div>
    <!-- Search -->
    <div class="search-wrap" id="searchWrap">
      <span class="search-icon">🔍</span>
      <input type="text" id="itemSearch" placeholder="Search..." oninput="onItemSearch(this.value)">
    </div>
    <!-- Services panel -->
    <div id="svcPanel">
      <div id="svcCatView">
        <div class="tile-grid" id="svcCatGrid"></div>
      </div>
      <div id="svcListView" style="display:none;">
        <div class="cat-back" onclick="backToCats()">← Back to categories</div>
        <div id="svcList"></div>
      </div>
      <div id="svcSearchView" style="display:none;">
        <div id="svcSearchList"></div>
      </div>
    </div>
    <!-- Products panel -->
    <div id="prodPanel" style="display:none;">
      <div id="prodList"></div>
      <div id="prodSearchList" style="display:none;"></div>
    </div>
    <!-- Selected summary -->
    <div class="selected-items-bar" id="selectedBar"></div>
  </div>

  <!-- Step 1: Recipient & Purchaser Details -->
  <div id="step1" class="hidden card" style="margin-top:8px;">
    <h2>Gift Details</h2>
    <p class="card-sub">Tell us who this gift is for and who is sending it.</p>
    <div class="section-title">Recipient (who receives the gift)</div>
    <div class="input-group">
      <label>Recipient Name *</label>
      <input type="text" id="recipientName" placeholder="e.g. Sarah Johnson">
    </div>
    <div class="input-group">
      <label>Recipient Email *</label>
      <input type="email" id="recipientEmail" placeholder="sarah@example.com">
    </div>
    <div class="input-group">
      <label>Recipient Phone</label>
      <input type="tel" id="recipientPhone" placeholder="(000) 000-0000">
    </div>
    <div style="height:1px;background:var(--border);margin:16px 0;"></div>
    <div class="section-title">From (your information)</div>
    <div class="input-group">
      <label>Your Name *</label>
      <input type="text" id="purchaserName" placeholder="e.g. John Johnson">
    </div>
    <div class="input-group">
      <label>Your Email *</label>
      <input type="email" id="purchaserEmail" placeholder="john@example.com">
    </div>
    <div class="input-group">
      <label>Personal Message (optional)</label>
      <textarea id="giftMessage" placeholder="e.g. Happy Birthday! Enjoy your day 💐" maxlength="300"></textarea>
    </div>
  </div>

  <!-- Step 2: Date Selection -->
  <div id="step2" class="hidden card" style="margin-top:8px;">
    <h2>Appointment Date</h2>
    <p class="card-sub">Let the recipient choose their own date, or pick one now.</p>
    <div class="date-toggle">
      <button class="date-toggle-btn active" id="dtRecipient" onclick="setDateMode('recipient')">Recipient Chooses</button>
      <button class="date-toggle-btn" id="dtMe" onclick="setDateMode('me')">I Pick the Date</button>
    </div>
    <div id="datePickerWrap" style="display:none;">
      <div class="cal-nav">
        <button class="cal-nav-btn" onclick="changeCalMonth(-1)">‹</button>
        <div class="cal-month-label" id="calMonthLabel"></div>
        <button class="cal-nav-btn" onclick="changeCalMonth(1)">›</button>
      </div>
      <div class="cal-grid" id="calGrid">
        <div class="cal-day-label">Su</div><div class="cal-day-label">Mo</div><div class="cal-day-label">Tu</div>
        <div class="cal-day-label">We</div><div class="cal-day-label">Th</div><div class="cal-day-label">Fr</div>
        <div class="cal-day-label">Sa</div>
      </div>
      <div id="timeSection" style="display:none;margin-top:16px;">
        <div class="section-title">Select a Time</div>
        <div class="time-grid" id="timeGrid"></div>
      </div>
    </div>
    <div id="recipientChooseMsg" style="background:var(--accent-bg-light);border-radius:12px;padding:14px;font-size:13px;color:var(--text2);line-height:1.5;">
      ✅ The recipient will receive a link to choose their own appointment date. You can still purchase the gift now.
    </div>
  </div>

  <!-- Step 3: Staff Selection (shown when I Pick the Date) -->
  <div id="step3" class="hidden card" style="margin-top:8px;">
    <h2>Choose a Staff Member</h2>
    <p class="card-sub">Select a staff member for the appointment, or choose <strong>Any Available</strong>.</p>
    <button onclick="giftSkipStaff()" style="width:100%;padding:11px 16px;background:var(--bg-card);border:1.5px dashed var(--border);border-radius:12px;font-size:13px;font-weight:600;color:var(--textm);cursor:pointer;margin-bottom:14px;transition:all .15s;">Skip → Any Available</button>
    <div id="giftStaffList" style="display:flex;flex-direction:column;gap:8px;"></div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-secondary" onclick="goToStep(2)" style="flex:1">Back</button>
      <button class="btn btn-primary btn-flex" onclick="goToStep(4)">Continue</button>
    </div>
  </div>

  <!-- Step 4: Payment -->
  <div id="step4" class="hidden card" style="margin-top:8px;">
    <h2>Complete Payment</h2>
    <p class="card-sub">Choose how you'd like to pay for this gift.</p>
    <div id="paymentList"></div>
    <div id="paymentError" class="err-msg hidden" style="color:var(--err);font-size:13px;margin-top:8px;"></div>
  </div>

  <!-- Sticky footer -->
  <div class="sticky-footer" id="stickyFooter">
    <div class="footer-inner">
      <div class="footer-total" id="footerTotal" style="display:none;">
        <div class="ft-label">Gift Total</div>
        <div class="ft-amount" id="footerAmount">$0.00</div>
      </div>
      <button class="btn btn-primary btn-flex" id="mainBtn" onclick="handleMainBtn()" disabled>
        Select Items to Continue
      </button>
    </div>
  </div>
</div>

<script>
const SLUG = '${slug.replace(/&/g, '\\u0026')}';
const SLUG_ENC = encodeURIComponent(SLUG);
const BIZ_NAME = '${bizName}';
const OWNER_ID = ${owner.id};
let allServices = [], allProducts = [], paymentMethods = {};
let giftSelectedLocationId = null; // for staff filtering
let selectedServiceIds = new Set(), selectedProductIds = new Set();
let currentStep = 0;
let dateMode = 'recipient'; // 'recipient' | 'me'
let selectedDate = null, selectedTime = null;
let selectedPaymentMethod = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let currentCat = null;
let currentItemTab = 'services';
let isSubmitting = false;
// ── Gift staff state ──────────────────────────────────────────────────
let giftStaffMembers = [];
let giftSelectedStaff = null; // null = any available
let giftWorkingDays = { weeklyDays: {}, customDays: {}, scheduleMode: 'weekly', businessHoursEndDate: null, _loaded: false };
const GIFT_DAYS_MAP = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── Load data ──────────────────────────────────────────────────────────
async function loadData() {
  try {
    const r = await fetch('/api/public/business/' + SLUG_ENC + '/gift-info');
    if (!r.ok) throw new Error('Failed to load');
    const d = await r.json();
    allServices = d.services || [];
    allProducts = d.products || [];
    paymentMethods = d.paymentMethods || {};
    window._giftLocations = d.locations || [];
    renderPopularServices();
    renderLocationSelector();
    renderSvcCats();
    renderProducts();
    renderPaymentOptions();
  } catch(e) {
    document.getElementById('svcCatGrid').innerHTML = '<p style="color:var(--err);font-size:13px;">Failed to load services. Please refresh.</p>';
  }
}

// ── Gift staff functions ───────────────────────────────────────────────
async function loadGiftStaff() {
  try {
    const r = await fetch('/api/public/business/' + SLUG_ENC + '/staff-list');
    if (r.ok) {
      const d = await r.json();
      giftStaffMembers = d.staff || [];
    }
  } catch(e) {}
  renderGiftStaffList();
}

async function loadGiftWorkingDays() {
  try {
    const r = await fetch('/api/public/business/' + SLUG_ENC + '/working-days');
    if (r.ok) {
      const d = await r.json();
      giftWorkingDays = Object.assign(d, { _loaded: true });
    }
  } catch(e) {}
}

function isGiftWorkingDay(dateStr) {
  if (giftWorkingDays.businessHoursEndDate && dateStr > giftWorkingDays.businessHoursEndDate) return false;
  if (giftWorkingDays.scheduleMode === 'custom') {
    return giftWorkingDays.customDays.hasOwnProperty(dateStr) && giftWorkingDays.customDays[dateStr] === true;
  }
  if (giftWorkingDays.customDays && giftWorkingDays.customDays.hasOwnProperty(dateStr)) return giftWorkingDays.customDays[dateStr];
  const d = new Date(dateStr + 'T12:00:00');
  const dayName = GIFT_DAYS_MAP[d.getDay()];
  return !!(giftWorkingDays.weeklyDays && giftWorkingDays.weeklyDays[dayName]);
}

function renderPopularServices() {
  if (!allServices.length) return;
  // Sort by appointmentCount desc, take top 5
  var sorted = allServices.slice().sort(function(a,b){ return (b.appointmentCount||0)-(a.appointmentCount||0); });
  var top = sorted.slice(0, 5);
  if (!top.length) return;
  var list = document.getElementById('popularList');
  var section = document.getElementById('popularSection');
  if (!list || !section) return;
  var html = '';
  top.forEach(function(s) {
    var checked = selectedServiceIds.has(s.localId);
    var imgHtml = s.photoUri
      ? '<img src="' + s.photoUri + '" style="width:100%;height:70px;object-fit:cover;border-radius:10px 10px 0 0;display:block;" onerror="this.style.display=\\x27none\\x27">'
      : '<div style="width:100%;height:70px;background:var(--accent-bg-light);border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:center;font-size:22px;">&#9986;</div>';
    html += '<div data-id="' + escH(s.localId) + '" onclick="toggleService(this.dataset.id)" style="min-width:110px;max-width:130px;flex-shrink:0;border-radius:12px;border:2px solid ' + (checked ? 'var(--gift)' : 'var(--bdi)') + ';background:var(--bg-card);cursor:pointer;overflow:hidden;transition:border-color .15s;" id="pop_' + s.localId + '">' ;
    html += imgHtml;
    html += '<div style="padding:8px 8px 10px;">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--text1);line-height:1.3;margin-bottom:3px;">' + escH(s.name) + '</div>';
    html += '<div style="font-size:11px;color:var(--gift);font-weight:600;">$' + parseFloat(s.price||0).toFixed(2) + '</div>';
    if (s.duration) html += '<div style="font-size:10px;color:var(--textm);margin-top:2px;">' + s.duration + ' min</div>';
    html += '</div></div>';
  });
  list.innerHTML = html;
  section.style.display = 'block';
}

function renderLocationSelector() {
  var locs = (window._giftLocations || []);
  var wrap = document.getElementById('locationSelectorWrap');
  var list = document.getElementById('locationSelectorList');
  if (!wrap || !list || locs.length < 2) return;
  var html = '<div onclick="selectGiftLocation(null)" style="padding:7px 14px;border-radius:20px;border:1.5px solid ' + (!giftSelectedLocationId ? 'var(--gift)' : 'var(--bdi)') + ';background:' + (!giftSelectedLocationId ? 'var(--accent-bg-light)' : 'var(--bg-card)') + ';font-size:12px;font-weight:600;color:' + (!giftSelectedLocationId ? 'var(--gift)' : 'var(--text2)') + ';cursor:pointer;white-space:nowrap;" id="locBtn_all">Any Location</div>';
  locs.forEach(function(loc) {
    var sel = giftSelectedLocationId === loc.localId;
    html += '<div data-locid="' + escH(loc.localId) + '" onclick="selectGiftLocation(this.dataset.locid)" style="padding:7px 14px;border-radius:20px;border:1.5px solid ' + (sel ? 'var(--gift)' : 'var(--bdi)') + ';background:' + (sel ? 'var(--accent-bg-light)' : 'var(--bg-card)') + ';font-size:12px;font-weight:600;color:' + (sel ? 'var(--gift)' : 'var(--text2)') + ';cursor:pointer;white-space:nowrap;" id="locBtn_' + loc.localId + '">' + escH(loc.name) + '</div>';
  });
  list.innerHTML = html;
  wrap.style.display = 'block';
}

function selectGiftLocation(locId) {
  giftSelectedLocationId = locId;
  renderLocationSelector();
  // Re-render staff list if already loaded
  if (window._giftStaffLoaded) renderGiftStaffList();
}

function renderGiftStaffList() {
  const list = document.getElementById('giftStaffList');
  if (!list) return;
  const svcIds = Array.from(selectedServiceIds);
  const eligible = giftStaffMembers.filter(function(s) {
    if (!s.serviceIds || s.serviceIds.length === 0) return true;
    return svcIds.length === 0 || svcIds.some(function(id) { return s.serviceIds.includes(id); });
  });
  const anySelected = !giftSelectedStaff;
  let html = '<div onclick="giftSelectStaff(null)" id="gstaff-any" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:2px solid ' + (anySelected ? 'var(--gift)' : 'var(--border)') + ';background:' + (anySelected ? 'var(--gift-bg)' : 'var(--bg-card)') + ';cursor:pointer;margin-bottom:6px;">' +
    '<div style="width:40px;height:40px;border-radius:50%;background:#88888820;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">👤</div>' +
    '<div style="flex:1;"><div style="font-size:14px;font-weight:700;color:var(--text);">Any Available</div>' +
    '<div style="font-size:12px;color:var(--textm);">First available staff member</div></div>' +
    '<span style="width:9px;height:9px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0;" title="Available"></span>' +
    '</div>';
  eligible.forEach(function(s) {
    var isSelected = giftSelectedStaff && giftSelectedStaff.localId === s.localId;
    var avatar = s.photoUri
      ? '<img src="' + escH(s.photoUri) + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;" />'
      : '<div style="width:40px;height:40px;border-radius:50%;background:' + (s.color || '#6366f1') + '20;color:' + (s.color || '#6366f1') + ';display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;">' + escH((s.name||'?')[0].toUpperCase()) + '</div>';
    html += '<div data-staffid="' + escH(s.localId) + '" onclick="giftSelectStaff(this.dataset.staffid)" id="gstaff-' + escH(s.localId) + '" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:2px solid ' + (isSelected ? 'var(--gift)' : 'var(--border)') + ';background:' + (isSelected ? 'var(--gift-bg)' : 'var(--bg-card)') + ';cursor:pointer;margin-bottom:6px;">' +
      avatar +
      '<div style="flex:1;"><div style="font-size:14px;font-weight:700;color:var(--text);">' + escH(s.name) + '</div>' +
      '<div style="font-size:12px;color:var(--textm);">' + escH(s.role || 'Staff') + '</div></div>' +
      '<span id="gavail-' + escH(s.localId) + '" style="width:9px;height:9px;border-radius:50%;background:#d1d5db;display:inline-block;flex-shrink:0;" title="Checking..."></span>' +
      '</div>';
  });
  list.innerHTML = html;
  checkGiftStaffAvailability(eligible);
}

async function checkGiftStaffAvailability(eligible) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA');
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  let dur = 60;
  if (allServices.length > 0 && selectedServiceIds.size > 0) {
    const svc = allServices.find(function(s) { return selectedServiceIds.has(s.localId); });
    if (svc) dur = svc.duration || 60;
  }
  const checkDates = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    checkDates.push(d.toLocaleDateString('en-CA'));
  }
  for (const s of eligible) {
    let hasSlots = false;
    for (const ds of checkDates) {
      try {
        const r = await fetch('/api/public/business/' + SLUG_ENC + '/slots?date=' + ds + '&duration=' + dur + '&staffId=' + encodeURIComponent(s.localId) + '&clientToday=' + encodeURIComponent(todayStr) + '&nowMinutes=' + nowMinutes);
        const data = await r.json();
        if (data.slots && data.slots.length > 0) { hasSlots = true; break; }
      } catch(e) {}
    }
    const dot = document.getElementById('gavail-' + s.localId);
    if (dot) {
      dot.style.background = hasSlots ? '#22c55e' : '#d1d5db';
      dot.title = hasSlots ? 'Available' : 'No upcoming availability';
    }
  }
}

function giftSelectStaff(localId) {
  giftSelectedStaff = localId ? giftStaffMembers.find(function(s) { return s.localId === localId; }) : null;
  document.querySelectorAll('[id^="gstaff-"]').forEach(function(el) {
    const isAny = el.id === 'gstaff-any';
    const isThis = localId ? el.id === 'gstaff-' + localId : isAny;
    el.style.borderColor = isThis ? 'var(--gift)' : 'var(--border)';
    el.style.background = isThis ? 'var(--gift-bg)' : 'var(--bg-card)';
  });
}

function giftSkipStaff() {
  giftSelectedStaff = null;
  goToStep(4);
}

// ── Item Tab ───────────────────────────────────────────────────────────
function switchItemTab(tab) {
  currentItemTab = tab;
  document.getElementById('svcPanel').style.display = tab === 'services' ? 'block' : 'none';
  document.getElementById('prodPanel').style.display = tab === 'products' ? 'block' : 'none';
  document.getElementById('tabSvc').style.background = tab === 'services' ? 'var(--gift)' : 'transparent';
  document.getElementById('tabSvc').style.color = tab === 'services' ? '#fff' : 'var(--textm)';
  document.getElementById('tabProd').style.background = tab === 'products' ? 'var(--gift)' : 'transparent';
  document.getElementById('tabProd').style.color = tab === 'products' ? '#fff' : 'var(--textm)';
  document.getElementById('itemSearch').value = '';
  onItemSearch('');
}

// ── Service categories ─────────────────────────────────────────────────
function renderSvcCats() {
  const cats = {};
  allServices.forEach(s => {
    const c = s.category || 'Other';
    if (!cats[c]) cats[c] = { name: c, count: 0, emoji: s.categoryEmoji || getCatEmoji(c) };
    cats[c].count++;
  });
  const grid = document.getElementById('svcCatGrid');
  const allCount = allServices.length;
  let html = '<div class="tile" onclick="drillCat(&apos;__all__&apos;)" id="cat___all__">'; 
  html += '<span class="tile-icon">✨</span>';
  html += '<div class="tile-name">All</div>';
  html += '<div class="tile-dur">' + allCount + ' service' + (allCount !== 1 ? 's' : '') + '</div>';
  html += '</div>';
  Object.values(cats).forEach(function(c) {
    html += '<div class="tile" data-cat="' + escH(c.name) + '" onclick="drillCat(this.dataset.cat)" id="cat_' + c.name.replace(/[^a-z0-9]/gi,'_') + '">';
    html += '<span class="tile-icon">' + c.emoji + '</span>';
    html += '<div class="tile-name">' + escH(c.name) + '</div>';
    html += '<div class="tile-dur">' + c.count + ' service' + (c.count !== 1 ? 's' : '') + '</div>';
    html += '</div>';
  });
  grid.innerHTML = html;
}
function getCatEmoji(name) {
  const n = (name||'').toLowerCase();
  if (n.includes('hair')) return '💇';
  if (n.includes('nail')) return '💅';
  if (n.includes('massage') || n.includes('body')) return '💆';
  if (n.includes('facial') || n.includes('face') || n.includes('skin')) return '✨';
  if (n.includes('wax') || n.includes('brow')) return '🪮';
  if (n.includes('lash') || n.includes('eye')) return '👁️';
  if (n.includes('makeup')) return '💄';
  if (n.includes('package')) return '🎀';
  return '🌿';
}
function drillCat(cat) {
  currentCat = cat;
  document.getElementById('svcCatView').style.display = 'none';
  document.getElementById('svcListView').style.display = 'block';
  const svcs = cat === '__all__' ? allServices : allServices.filter(s => (s.category || 'Other') === cat);
  renderSvcList(svcs, document.getElementById('svcList'));
}
function backToCats() {
  currentCat = null;
  document.getElementById('svcCatView').style.display = 'block';
  document.getElementById('svcListView').style.display = 'none';
}
function renderSvcList(svcs, container) {
  if (!svcs.length) { container.innerHTML = '<p style="color:var(--textm);font-size:13px;padding:12px 0;">No services found.</p>'; return; }
  let html = '';
  svcs.forEach(function(s) {
    const checked = selectedServiceIds.has(s.localId);
    html += '<div class="svc-row" data-id="' + escH(s.localId) + '" onclick="toggleService(this.dataset.id)">';
    html += '<div class="svc-row-check' + (checked ? ' checked' : '') + '" id="chk_' + s.localId + '">' + (checked ? '<span style="color:#fff;font-size:14px;">✓</span>' : '') + '</div>';
    html += '<div class="svc-row-info"><div class="svc-row-name">' + escH(s.name) + '</div>';
    const meta = [];
    if (s.duration) meta.push(s.duration + ' min');
    if (s.category) meta.push(s.category);
    if (meta.length) html += '<div class="svc-row-meta">' + escH(meta.join(' · ')) + '</div>';
    html += '</div>';
    html += '<div class="svc-row-price">$' + parseFloat(s.price || 0).toFixed(2) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

// ── Products ───────────────────────────────────────────────────────────
function renderProducts(filter) {
  const prods = filter ? allProducts.filter(p => p.name.toLowerCase().includes(filter.toLowerCase())) : allProducts;
  const container = document.getElementById('prodList');
  if (!prods.length) { container.innerHTML = '<p style="color:var(--textm);font-size:13px;padding:12px 0;">No products found.</p>'; return; }
  let html = '';
  prods.forEach(function(p) {
    const checked = selectedProductIds.has(p.localId);
    html += '<div class="svc-row" data-id="' + escH(p.localId) + '" onclick="toggleProduct(this.dataset.id)">';
    html += '<div class="svc-row-check' + (checked ? ' checked' : '') + '" id="pchk_' + p.localId + '">' + (checked ? '<span style="color:#fff;font-size:14px;">✓</span>' : '') + '</div>';
    html += '<div class="svc-row-info"><div class="svc-row-name">' + escH(p.name) + '</div>';
    if (p.brand || p.category) html += '<div class="svc-row-meta">' + escH([p.brand, p.category].filter(Boolean).join(' · ')) + '</div>';
    html += '</div>';
    html += '<div class="svc-row-price">$' + parseFloat(p.price || 0).toFixed(2) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

// ── Search ─────────────────────────────────────────────────────────────
function onItemSearch(q) {
  if (currentItemTab === 'services') {
    if (!q) {
      document.getElementById('svcSearchView').style.display = 'none';
      if (currentCat) {
        document.getElementById('svcListView').style.display = 'block';
        document.getElementById('svcCatView').style.display = 'none';
      } else {
        document.getElementById('svcCatView').style.display = 'block';
        document.getElementById('svcListView').style.display = 'none';
      }
    } else {
      document.getElementById('svcCatView').style.display = 'none';
      document.getElementById('svcListView').style.display = 'none';
      document.getElementById('svcSearchView').style.display = 'block';
      const filtered = allServices.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || (s.category||'').toLowerCase().includes(q.toLowerCase()));
      renderSvcList(filtered, document.getElementById('svcSearchList'));
    }
  } else {
    renderProducts(q || null);
  }
}

// ── Toggle selection ───────────────────────────────────────────────────
function toggleService(id) {
  if (selectedServiceIds.has(id)) selectedServiceIds.delete(id);
  else selectedServiceIds.add(id);
  // Update checkboxes in all views
  document.querySelectorAll('#chk_' + id).forEach(function(el) {
    el.className = 'svc-row-check' + (selectedServiceIds.has(id) ? ' checked' : '');
    el.innerHTML = selectedServiceIds.has(id) ? '<span style="color:#fff;font-size:14px;">✓</span>' : '';
  });
  // Update popular card border
  var popCard = document.getElementById('pop_' + id);
  if (popCard) popCard.style.borderColor = selectedServiceIds.has(id) ? 'var(--gift)' : 'var(--bdi)';
  updateSummary();
}
function toggleProduct(id) {
  if (selectedProductIds.has(id)) selectedProductIds.delete(id);
  else selectedProductIds.add(id);
  document.querySelectorAll('#pchk_' + id).forEach(function(el) {
    el.className = 'svc-row-check' + (selectedProductIds.has(id) ? ' checked' : '');
    el.innerHTML = selectedProductIds.has(id) ? '<span style="color:#fff;font-size:14px;">✓</span>' : '';
  });
  updateSummary();
}
function updateSummary() {
  let total = 0, names = [];
  selectedServiceIds.forEach(function(id) {
    const s = allServices.find(x => x.localId === id);
    if (s) { total += parseFloat(s.price || 0); names.push(s.name); }
  });
  selectedProductIds.forEach(function(id) {
    const p = allProducts.find(x => x.localId === id);
    if (p) { total += parseFloat(p.price || 0); names.push(p.name); }
  });
  const bar = document.getElementById('selectedBar');
  const btn = document.getElementById('mainBtn');
  const ftTotal = document.getElementById('footerTotal');
  const ftAmt = document.getElementById('footerAmount');
  if (names.length) {
    bar.style.display = 'block';
    bar.textContent = '✓ Selected: ' + names.join(', ') + ' — $' + total.toFixed(2);
    btn.disabled = false;
    btn.textContent = 'Continue →';
    ftTotal.style.display = 'block';
    ftAmt.textContent = '$' + total.toFixed(2);
  } else {
    bar.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Select Items to Continue';
    ftTotal.style.display = 'none';
  }
}

// ── Payment options ────────────────────────────────────────────────────
function renderPaymentOptions() {
  const pm = paymentMethods;
  const opts = [];
  if (pm.zelle) opts.push({ id: 'zelle', icon: '💜', label: 'Zelle', sub: pm.zelle });
  if (pm.cashApp) opts.push({ id: 'cashapp', icon: '💚', label: 'Cash App', sub: (pm.cashApp.startsWith('$') ? pm.cashApp : '$' + pm.cashApp) });
  if (pm.venmo) opts.push({ id: 'venmo', icon: '💙', label: 'Venmo', sub: (pm.venmo.startsWith('@') ? pm.venmo : '@' + pm.venmo) });
  if (pm.stripeEnabled) opts.push({ id: 'card', icon: '💳', label: 'Credit / Debit Card', sub: 'Visa, Mastercard, Apple Pay, Google Pay' });
  opts.push({ id: 'cash', icon: '💵', label: 'Cash', sub: 'Pay in person at the appointment' });
  let html = '';
  opts.forEach(function(o) {
    const sel = selectedPaymentMethod === o.id;
    html += '<div class="pay-opt' + (sel ? ' selected' : '') + '" data-id="' + escH(o.id) + '" onclick="selectPayment(this.dataset.id)">';
    html += '<div class="pay-opt-icon">' + o.icon + '</div>';
    html += '<div class="pay-opt-info"><div class="pay-opt-label">' + escH(o.label) + '</div><div class="pay-opt-sub">' + escH(o.sub) + '</div></div>';
    html += '<div class="pay-opt-check">' + (sel ? '<span style="color:#fff;font-size:12px;">✓</span>' : '') + '</div>';
    html += '</div>';
  });
  document.getElementById('paymentList').innerHTML = html;
}
function selectPayment(id) {
  selectedPaymentMethod = id;
  renderPaymentOptions();
}

// ── Date mode ──────────────────────────────────────────────────────────
function setDateMode(mode) {
  dateMode = mode;
  document.getElementById('dtRecipient').className = 'date-toggle-btn' + (mode === 'recipient' ? ' active' : '');
  document.getElementById('dtMe').className = 'date-toggle-btn' + (mode === 'me' ? ' active' : '');
  document.getElementById('datePickerWrap').style.display = mode === 'me' ? 'block' : 'none';
  document.getElementById('recipientChooseMsg').style.display = mode === 'recipient' ? 'block' : 'none';
  if (mode === 'me') {
    if (!giftWorkingDays._loaded) {
      loadGiftWorkingDays().then(function() { renderCal(); });
    } else {
      renderCal();
    }
  }
  updateFooterBtn();
}

// ── Calendar ───────────────────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function renderCal() {
  document.getElementById('calMonthLabel').textContent = MONTHS[calMonth] + ' ' + calYear;
  const now = new Date(); now.setHours(0,0,0,0);
  const nowStr = now.toLocaleDateString('en-CA');
  const first = new Date(calYear, calMonth, 1).getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  // Remove old day cells (keep the 7 label divs at the start)
  const grid = document.getElementById('calGrid');
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);
  // Add empty spacers for offset
  for (let i = 0; i < first; i++) {
    const el = document.createElement('div');
    grid.appendChild(el);
  }
  const workingDates = [];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(calYear, calMonth, d);
    const iso = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const isPast = dt < now;
    const isSel = selectedDate === iso;
    const isToday = iso === nowStr;
    const isWorking = isGiftWorkingDay(iso);
    const isDisabled = isPast || !isWorking;
    const el = document.createElement('div');
    // Build inner HTML: number + avail dot placeholder
    el.innerHTML = '<span>' + String(d) + '</span>';
    el.className = 'cal-day' + (isDisabled ? ' disabled' : '') + (isSel ? ' selected' : '') + (isToday && !isDisabled ? ' today' : '');
    el.id = 'gcal-day-' + iso;
    el.dataset.date = iso;
    if (!isDisabled) {
      (function(dateIso) { el.onclick = function() { selectDay(dateIso); }; })(iso);
      workingDates.push(iso);
    }
    grid.appendChild(el);
  }
  // Batch check availability for working days
  checkGiftCalAvailability(workingDates);
}

async function checkGiftCalAvailability(dates) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA');
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  let dur = 60;
  if (allServices.length > 0 && selectedServiceIds.size > 0) {
    const svc = allServices.find(s => selectedServiceIds.has(s.localId));
    if (svc) dur = svc.duration || 60;
  }
  const staffParam = giftSelectedStaff ? '&staffId=' + encodeURIComponent(giftSelectedStaff.localId) : '';
  const promises = dates.map(async function(ds) {
    try {
      const r = await fetch('/api/public/business/' + SLUG_ENC + '/slots?date=' + ds + '&duration=' + dur + staffParam + '&clientToday=' + encodeURIComponent(todayStr) + '&nowMinutes=' + nowMinutes);
      const data = await r.json();
      return { date: ds, count: data.slots ? data.slots.length : 0 };
    } catch(e) { return { date: ds, count: 0 }; }
  });
  const results = await Promise.all(promises);
  results.forEach(function(r) {
    const el = document.getElementById('gcal-day-' + r.date);
    if (!el) return;
    if (r.count === 0) {
      el.classList.add('disabled');
      el.onclick = null;
    } else {
      // Add green availability dot
      if (!el.querySelector('.avail-dot')) {
        const dot = document.createElement('span');
        dot.className = 'avail-dot';
        dot.style.cssText = 'display:block;width:5px;height:5px;border-radius:50%;background:#22c55e;margin:1px auto 0;';
        el.appendChild(dot);
      }
    }
  });
}
function changeCalMonth(d) {
  calMonth += d;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  const now = new Date();
  if (calYear < now.getFullYear() || (calYear === now.getFullYear() && calMonth < now.getMonth())) {
    calMonth = now.getMonth(); calYear = now.getFullYear();
  }
  renderCal();
}
function selectDay(iso) {
  selectedDate = iso;
  selectedTime = null;
  renderCal();
  // Show simple time slots
  const slots = ['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','12:30 PM','1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM','4:30 PM','5:00 PM'];
  let html = '';
  slots.forEach(function(t) {
    html += '<div class="time-slot' + (selectedTime === t ? ' selected' : '') + '" data-time="' + escH(t) + '" onclick="selectTime(this.dataset.time)">' + t + '</div>';
  });
  document.getElementById('timeGrid').innerHTML = html;
  document.getElementById('timeSection').style.display = 'block';
  updateFooterBtn();
}
function selectTime(t) {
  selectedTime = t;
  document.querySelectorAll('.time-slot').forEach(function(el) {
    el.className = 'time-slot' + (el.textContent === t ? ' selected' : '');
  });
  updateFooterBtn();
}

// ── Step navigation ────────────────────────────────────────────────────
function giftGoToStep(n) {
  // Alias for goToStep in gift page
  goToStep(n);
}
function goToStep(n) {
  for (let i = 0; i <= 4; i++) {
    const el = document.getElementById('step' + i);
    if (el) { el.classList.add('hidden'); el.style.display = ''; }
  }
  const target = document.getElementById('step' + n);
  if (target) { target.classList.remove('hidden'); target.style.display = 'block'; }
  currentStep = n;
  // When entering step3 (staff), load staff if not loaded yet
  if (n === 3 && giftStaffMembers.length === 0) loadGiftStaff();
  // Update step dots (5 steps: 0-4)
  for (let i = 0; i <= 4; i++) {
    const dot = document.getElementById('sd' + i);
    const item = document.getElementById('si' + i);
    if (dot) dot.className = 'step-dot' + (i < n ? ' done' : i === n ? ' active' : '');
    if (item) item.className = 'step-item' + (i < n ? ' done' : i === n ? ' active' : '');
  }
  // Update footer button
  updateFooterBtn();
  window.scrollTo(0, 0);
}
function updateFooterBtn() {
  const btn = document.getElementById('mainBtn');
  if (currentStep === 0) {
    const hasItems = selectedServiceIds.size > 0 || selectedProductIds.size > 0;
    btn.disabled = !hasItems;
    btn.textContent = hasItems ? 'Continue →' : 'Select Items to Continue';
  } else if (currentStep === 1) {
    btn.disabled = false;
    btn.textContent = 'Continue →';
  } else if (currentStep === 2) {
    if (dateMode === 'recipient') {
      btn.disabled = false;
      btn.textContent = 'Continue →';
    } else {
      btn.disabled = !selectedDate || !selectedTime;
      btn.textContent = 'Continue →';
    }
  } else if (currentStep === 3) {
    btn.disabled = false;
    btn.textContent = 'Continue to Payment →';
  } else if (currentStep === 4) {
    btn.disabled = false;
    btn.textContent = isSubmitting ? '' : 'Purchase Gift 🎁';
    if (isSubmitting) btn.innerHTML = '<span class="spinner"></span>';
  }
}
function handleMainBtn() {
  if (currentStep === 0) {
    if (selectedServiceIds.size === 0 && selectedProductIds.size === 0) { alert('Please select at least one item.'); return; }
    goToStep(1);
  } else if (currentStep === 1) {
    const rName = document.getElementById('recipientName').value.trim();
    const rEmail = document.getElementById('recipientEmail').value.trim();
    const pName = document.getElementById('purchaserName').value.trim();
    const pEmail = document.getElementById('purchaserEmail').value.trim();
    if (!rName) { alert('Please enter the recipient name.'); document.getElementById('recipientName').focus(); return; }
    if (!rEmail || !rEmail.includes('@')) { alert('Please enter a valid recipient email.'); document.getElementById('recipientEmail').focus(); return; }
    if (!pName) { alert('Please enter your name.'); document.getElementById('purchaserName').focus(); return; }
    if (!pEmail || !pEmail.includes('@')) { alert('Please enter your email.'); document.getElementById('purchaserEmail').focus(); return; }
    goToStep(2);
  } else if (currentStep === 2) {
    if (dateMode === 'me' && !selectedDate) { alert('Please select a date.'); return; }
    if (dateMode === 'me' && !selectedTime) { alert('Please select a time.'); return; }
    // If picking date, go to staff step; otherwise skip to payment
    if (dateMode === 'me') {
      goToStep(3);
    } else {
      goToStep(4);
    }
  } else if (currentStep === 3) {
    // Staff step — go to payment
    goToStep(4);
  } else if (currentStep === 4) {
    if (!selectedPaymentMethod) { document.getElementById('paymentError').textContent = 'Please select a payment method.'; document.getElementById('paymentError').classList.remove('hidden'); return; }
    submitGift();
  }
}

// ── Submit ─────────────────────────────────────────────────────────────
async function submitGift() {
  if (isSubmitting) return;
  isSubmitting = true;
  updateFooterBtn();
  const payload = {
    serviceIds: Array.from(selectedServiceIds),
    productIds: Array.from(selectedProductIds),
    recipientName: document.getElementById('recipientName').value.trim(),
    recipientEmail: document.getElementById('recipientEmail').value.trim(),
    recipientPhone: document.getElementById('recipientPhone').value.trim(),
    purchaserName: document.getElementById('purchaserName').value.trim(),
    purchaserEmail: document.getElementById('purchaserEmail').value.trim(),
    message: document.getElementById('giftMessage').value.trim(),
    paymentMethod: selectedPaymentMethod,
    recipientChoosesDate: dateMode === 'recipient',
    preselectedDate: dateMode === 'me' ? selectedDate : null,
    preselectedTime: dateMode === 'me' ? selectedTime : null,
    preselectedStaffId: giftSelectedStaff ? giftSelectedStaff.localId : null,
  };
  try {
    // Step 1: Create the gift record in the database
    const r = await fetch('/api/public/business/' + SLUG_ENC + '/buy-gift', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to create gift');

    // Step 2: If card payment, create a Stripe Checkout session and redirect
    if (selectedPaymentMethod === 'card') {
      const confirmUrl = window.location.origin + '/api/gift-confirm/' + encodeURIComponent(d.code);
      const cancelUrl = window.location.href;
      const stripeRes = await fetch('/api/stripe-connect/create-gift-checkout', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          businessOwnerId: OWNER_ID,
          giftCode: d.code,
          recipientName: payload.recipientName,
          items: d.items || [],
          totalAmount: d.totalValue,
          successUrl: confirmUrl + '?paid=1',
          cancelUrl: cancelUrl,
        })
      });
      const stripeData = await stripeRes.json();
      if (!stripeRes.ok) throw new Error(stripeData.error || 'Failed to create payment session');
      if (stripeData.url) {
        window.location.href = stripeData.url;
        return;
      }
      // Stripe not available — fall through to confirm page
    }

    window.location.href = '/api/gift-confirm/' + encodeURIComponent(d.code);
  } catch(e) {
    isSubmitting = false;
    updateFooterBtn();
    alert('Error: ' + (e.message || 'Something went wrong. Please try again.'));
  }
}

// ── Utility ────────────────────────────────────────────────────────────
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Init ───────────────────────────────────────────────────────────────
loadData();
</script>
</body>
</html>`;
}
// ─── Gift Confirm Page ────────────────────────────────────────────────────────
function giftConfirmPage(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <title>Gift Created!</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    :root{--bg:#f5f7f5;--bg-card:#fff;--bg-sel:#e8f5e3;--text:#1a1a1a;--text2:#666;--textm:#888;--accent:#4a8c3f;--adk:#2d5a27;--border:#e8ece8;}
    @media(prefers-color-scheme:dark){:root{--bg:#0f1210;--bg-card:#1a1f1a;--bg-sel:#1e3a1a;--text:#e8ece8;--text2:#a8b0a8;--textm:#8a928a;--accent:#5ca84f;--adk:#7cc070;--border:#2a322a;}}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
    .con{max-width:480px;margin:0 auto;padding:24px 16px 80px;}
    .card{background:var(--bg-card);border-radius:20px;padding:20px;margin-bottom:16px;border:1px solid var(--border);}
    .hero{text-align:center;padding:32px 0 20px;}
    .hero .ico{font-size:64px;margin-bottom:12px;}
    .hero h1{font-size:24px;font-weight:800;color:var(--adk);margin-bottom:6px;}
    .hero .sub{font-size:14px;color:var(--text2);line-height:1.5;}
    .dr{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px;}
    .dr:last-child{border-bottom:none;}
    .dl{color:var(--text2);}
    .dv{font-weight:600;text-align:right;max-width:60%;}
    .cbox{background:var(--bg-sel);border:2px dashed var(--accent);border-radius:14px;padding:16px;text-align:center;margin:12px 0;}
    .ct{font-size:22px;font-weight:800;letter-spacing:4px;color:var(--adk);font-family:monospace;}
    .slink{font-size:12px;color:var(--textm);word-break:break-all;margin-top:6px;}
    .cbtn{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:10px;}
    .shbtn{width:100%;padding:12px;background:transparent;color:var(--accent);border:1.5px solid var(--accent);border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;}
    .pi{background:var(--bg-sel);border-radius:14px;padding:16px;margin-top:12px;}
    .pi h3{font-size:14px;font-weight:700;color:var(--adk);margin-bottom:8px;}
    .pi p{font-size:13px;color:var(--text2);line-height:1.5;}
    .ph{font-size:15px;font-weight:700;color:var(--adk);margin-top:4px;}
    .load{text-align:center;padding:60px;color:var(--textm);}
  </style>
</head>
<body>
<div class="con">
  <div id="ld" class="load">Loading your gift...</div>
  <div id="mc" style="display:none;">
    <div class="hero">
      <div class="ico">🎁</div>
      <h1>Gift Created!</h1>
      <div class="sub" id="hsub">Your gift has been created successfully.</div>
    </div>
    <div class="card">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">Gift Details</div>
      <div id="gd"></div>
    </div>
    <div class="card">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px;">Gift Code</div>
      <div class="cbox">
        <div class="ct" id="gc"></div>
        <div style="font-size:12px;color:var(--textm);margin-top:6px;">Recipient uses this code to redeem</div>
      </div>
    </div>
    <div class="card">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px;">Share with Recipient</div>
      <div style="background:var(--bg-card);border:1.5px solid var(--border);border-radius:14px;padding:14px;">
        <div style="font-size:13px;color:var(--text2);">Redemption link:</div>
        <div class="slink" id="sl"></div>
      </div>
      <button class="cbtn" id="cpbtn" onclick="cpLink()">📋 Copy Link</button>
      <button class="shbtn" id="shbtn" onclick="shLink()" style="display:none;">📤 Share Link</button>
    </div>
    <div class="card" id="pmcard" style="display:none;">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px;">Complete Payment</div>
      <div class="pi"><h3 id="pmt"></h3><p id="pmi"></p><div class="ph" id="pmh"></div></div>
    </div>
    <div style="text-align:center;margin-top:16px;"><a href="javascript:history.back()" style="font-size:13px;color:var(--textm);text-decoration:none;">← Buy Another Gift</a></div>
  </div>
  <div style="text-align:center;padding:24px 0 8px;"><span style="font-size:12px;color:var(--textm);">Powered by Lime Of Time</span></div>
</div>
<script>
  const CODE=${JSON.stringify(code)};
  const PAID = new URLSearchParams(window.location.search).get('paid') === '1';
  let gd=null;
  function esc(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  async function load(){
    try{
      const r=await fetch('/api/public/gift-purchase/'+encodeURIComponent(CODE));
      gd=await r.json();
      document.getElementById('ld').style.display='none';
      document.getElementById('mc').style.display='block';
      render();
    }catch(e){document.getElementById('ld').textContent='Failed to load. Please refresh.';}
  }
  function render(){
    const d=gd;
    // Show payment received banner if redirected from Stripe
    if (PAID) {
      document.querySelector('.hero .ico').textContent = '✅';
      document.querySelector('.hero h1').textContent = 'Payment Received!';
      document.getElementById('hsub').textContent = 'Your card payment was successful. Gift for '+(d.recipientName||'the recipient')+' at '+d.businessName+' is confirmed!';
    } else {
      document.getElementById('hsub').textContent='Your gift for '+(d.recipientName||'the recipient')+' at '+d.businessName+' has been created!';
    }
    document.getElementById('gc').textContent=d.code;
    const link=window.location.origin+'/api/gift/'+encodeURIComponent(d.code);
    document.getElementById('sl').textContent=link;
    let h='';
    d.items.forEach(item=>{h+='<div class="dr"><span class="dl">'+esc(item.name)+'</span><span class="dv">$'+item.price.toFixed(2)+'</span></div>';});
    h+='<div class="dr"><span class="dl" style="font-weight:700;">Total Value</span><span class="dv" style="font-size:16px;color:var(--adk);">$'+d.totalValue.toFixed(2)+'</span></div>';
    if(d.recipientName)h+='<div class="dr"><span class="dl">For</span><span class="dv">'+esc(d.recipientName)+'</span></div>';
    if(d.expiresAt)h+='<div class="dr"><span class="dl">Valid Until</span><span class="dv">'+esc(d.expiresAt)+'</span></div>';
    document.getElementById('gd').innerHTML=h;
    if(navigator.share)document.getElementById('shbtn').style.display='block';
    const pm=d.paymentMethod,pms=d.paymentMethods;
    if(pm&&pm!=='unpaid'&&pm!=='card'){
      document.getElementById('pmcard').style.display='block';
      const map={zelle:{t:'Pay via Zelle',h:pms.zelle,i:'Open your bank app and send payment to the Zelle handle below. Include the gift code in the memo.'},cashapp:{t:'Pay via Cash App',h:pms.cashApp?(pms.cashApp.startsWith('$')?pms.cashApp:'$'+pms.cashApp):'',i:'Open Cash App and send payment to the $Cashtag below. Include the gift code in the note.'},venmo:{t:'Pay via Venmo',h:pms.venmo?(pms.venmo.startsWith('@')?pms.venmo:'@'+pms.venmo):'',i:'Open Venmo and send payment to the handle below. Include the gift code in the note.'},cash:{t:'Pay Cash In Person',h:'',i:'Bring cash to your appointment. The gift will be activated when you arrive.'}};
      const info=map[pm];if(info){document.getElementById('pmt').textContent=info.t;document.getElementById('pmi').textContent=info.i;document.getElementById('pmh').textContent=info.h||'';}
    }
  }
  function cpLink(){
    const link=window.location.origin+'/api/gift/'+encodeURIComponent(CODE);
    if(navigator.clipboard){navigator.clipboard.writeText(link).then(()=>{const b=document.getElementById('cpbtn');b.textContent='✅ Copied!';b.style.background='#16a34a';setTimeout(()=>{b.textContent='📋 Copy Link';b.style.background='var(--accent)';},2500);}).catch(()=>fb(link));}else{fb(link);}
  }
  function fb(t){const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);const b=document.getElementById('cpbtn');b.textContent='✅ Copied!';setTimeout(()=>{b.textContent='📋 Copy Link';},2500);}
  function shLink(){const link=window.location.origin+'/api/gift/'+encodeURIComponent(CODE);if(navigator.share)navigator.share({title:'Gift for '+(gd?gd.recipientName||'someone special':'someone special'),text:'I got you a gift at '+(gd?gd.businessName:'')+'. Use this link to redeem it.',url:link}).catch(()=>{});}
  load();
</script>
</body>
</html>`;
}


function homePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lime Of Time — Smart Scheduling for Modern Businesses</title>
  <meta name="description" content="Lime Of Time is the all-in-one scheduling app for salons, barbershops, spas, and wellness businesses. Manage appointments, clients, staff, and payments from your phone." />
  <link rel="icon" type="image/png" href="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" />
  <link rel="apple-touch-icon" href="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" />
  <meta property="og:title" content="Lime Of Time — Smart Scheduling for Modern Businesses" />
  <meta property="og:description" content="The all-in-one scheduling app for salons, barbershops, spas, and wellness businesses." />
  <meta property="og:image" content="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:image" content="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    :root {
      --lime: #7EC820;
      --lime-dark: #5fa318;
      --lime-light: #a8e04a;
      --lime-glow: rgba(126,200,32,0.18);
      --navy: #0d1117;
      --navy2: #161b22;
      --navy3: #1e2530;
      --navy4: #252d3a;
      --white: #ffffff;
      --gray: #8b949e;
      --gray2: #c9d1d9;
      --border: rgba(255,255,255,0.08);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--navy);
      color: var(--white);
      overflow-x: hidden;
      line-height: 1.6;
    }

    /* ── NAV ── */
    nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 5%; height: 68px;
      background: rgba(13,17,23,0.85);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      transition: background 0.3s;
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .nav-logo-icon {
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, var(--lime), var(--lime-dark));
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .nav-logo-text { font-size: 18px; font-weight: 700; color: var(--white); }
    .nav-links { display: flex; align-items: center; gap: 32px; }
    .nav-links a { color: var(--gray2); text-decoration: none; font-size: 14px; font-weight: 500; transition: color 0.2s; }
    .nav-links a:hover { color: var(--white); }
    .nav-cta {
      display: flex; align-items: center; gap: 12px;
    }
    .btn-outline {
      padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
      border: 1.5px solid var(--border); color: var(--white); background: transparent;
      cursor: pointer; text-decoration: none; transition: border-color 0.2s, background 0.2s;
    }
    .btn-outline:hover { border-color: var(--lime); background: var(--lime-glow); }
    .btn-primary {
      padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 700;
      background: var(--lime); color: #0d1117; border: none; cursor: pointer;
      text-decoration: none; transition: background 0.2s, transform 0.15s;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .btn-primary:hover { background: var(--lime-light); transform: translateY(-1px); }
    .hamburger { display: none; flex-direction: column; gap: 5px; cursor: pointer; padding: 4px; }
    .hamburger span { width: 22px; height: 2px; background: var(--white); border-radius: 2px; transition: 0.3s; }

    /* ── HERO ── */
    .hero {
      min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 120px 5% 80px;
      position: relative; overflow: hidden;
      text-align: center;
    }
    .hero-bg {
      position: absolute; inset: 0; z-index: 0;
      background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(126,200,32,0.12) 0%, transparent 70%),
                  radial-gradient(ellipse 50% 40% at 80% 80%, rgba(126,200,32,0.06) 0%, transparent 60%);
    }
    .hero-grid {
      position: absolute; inset: 0; z-index: 0; opacity: 0.04;
      background-image: linear-gradient(var(--white) 1px, transparent 1px),
                        linear-gradient(90deg, var(--white) 1px, transparent 1px);
      background-size: 60px 60px;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 16px; border-radius: 100px;
      background: rgba(126,200,32,0.12); border: 1px solid rgba(126,200,32,0.3);
      font-size: 13px; font-weight: 600; color: var(--lime);
      margin-bottom: 28px; position: relative; z-index: 1;
      animation: fadeInDown 0.6s ease both;
    }
    .hero-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }
    .hero h1 {
      font-size: clamp(42px, 7vw, 88px); font-weight: 900; line-height: 1.05;
      letter-spacing: -2px; position: relative; z-index: 1;
      animation: fadeInUp 0.7s 0.1s ease both;
    }
    .hero h1 .highlight {
      background: linear-gradient(135deg, var(--lime), var(--lime-light));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .hero-sub {
      font-size: clamp(17px, 2.2vw, 22px); color: var(--gray2); max-width: 640px;
      margin: 24px auto 0; font-weight: 400; line-height: 1.6;
      position: relative; z-index: 1;
      animation: fadeInUp 0.7s 0.2s ease both;
    }
    .hero-actions {
      display: flex; align-items: center; justify-content: center; gap: 16px;
      margin-top: 40px; flex-wrap: wrap;
      position: relative; z-index: 1;
      animation: fadeInUp 0.7s 0.3s ease both;
    }
    .btn-hero {
      padding: 16px 36px; border-radius: 12px; font-size: 16px; font-weight: 700;
      background: var(--lime); color: #0d1117; border: none; cursor: pointer;
      text-decoration: none; transition: all 0.2s;
      display: inline-flex; align-items: center; gap: 8px;
      box-shadow: 0 0 40px rgba(126,200,32,0.35);
    }
    .btn-hero:hover { background: var(--lime-light); transform: translateY(-2px); box-shadow: 0 0 60px rgba(126,200,32,0.5); }
    .btn-hero-ghost {
      padding: 16px 36px; border-radius: 12px; font-size: 16px; font-weight: 600;
      background: transparent; color: var(--white); border: 1.5px solid var(--border);
      cursor: pointer; text-decoration: none; transition: all 0.2s;
    }
    .btn-hero-ghost:hover { border-color: var(--lime); background: var(--lime-glow); }
    .hero-trust {
      display: flex; align-items: center; justify-content: center; gap: 24px;
      margin-top: 32px; flex-wrap: wrap;
      position: relative; z-index: 1;
      animation: fadeInUp 0.7s 0.4s ease both;
    }
    .hero-trust-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--gray); }
    .hero-trust-item svg { color: var(--lime); }
    .hero-phones {
      position: relative; z-index: 1; margin-top: 64px;
      display: flex; align-items: flex-end; justify-content: center; gap: -20px;
      animation: fadeInUp 0.8s 0.5s ease both;
    }
    .hero-phone-wrap {
      position: relative; flex-shrink: 0;
    }
    .hero-phone-wrap.center { z-index: 3; transform: translateY(0); }
    .hero-phone-wrap.left  { z-index: 2; transform: translateX(40px) translateY(30px) rotate(-6deg); }
    .hero-phone-wrap.right { z-index: 2; transform: translateX(-40px) translateY(30px) rotate(6deg); }
    .hero-phone-wrap img {
      width: 260px; border-radius: 36px;
      box-shadow: 0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06);
      display: block;
    }
    .hero-phone-wrap.center img { width: 300px; }
    .phone-glow {
      position: absolute; bottom: -30px; left: 50%; transform: translateX(-50%);
      width: 200px; height: 60px;
      background: radial-gradient(ellipse, rgba(126,200,32,0.4), transparent 70%);
      filter: blur(20px); z-index: -1;
    }

    /* ── STATS ── */
    .stats {
      padding: 80px 5%;
      background: var(--navy2);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .stats-grid {
      max-width: 1100px; margin: 0 auto;
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px;
    }
    .stat-item {
      padding: 40px 32px; text-align: center;
      border-right: 1px solid var(--border);
      opacity: 0; transform: translateY(20px);
      transition: opacity 0.6s, transform 0.6s;
    }
    .stat-item:last-child { border-right: none; }
    .stat-item.visible { opacity: 1; transform: translateY(0); }
    .stat-number {
      font-size: 52px; font-weight: 900; line-height: 1;
      background: linear-gradient(135deg, var(--lime), var(--lime-light));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .stat-label { font-size: 14px; color: var(--gray); margin-top: 8px; font-weight: 500; }

    /* ── SECTION SHARED ── */
    .section { padding: 100px 5%; }
    .section-inner { max-width: 1200px; margin: 0 auto; }
    .section-tag {
      display: inline-block; padding: 4px 14px; border-radius: 100px;
      background: rgba(126,200,32,0.1); border: 1px solid rgba(126,200,32,0.25);
      font-size: 12px; font-weight: 700; color: var(--lime); letter-spacing: 1px;
      text-transform: uppercase; margin-bottom: 16px;
    }
    .section-title {
      font-size: clamp(32px, 4vw, 52px); font-weight: 800; line-height: 1.1;
      letter-spacing: -1px; margin-bottom: 20px;
    }
    .section-sub { font-size: 18px; color: var(--gray2); max-width: 560px; line-height: 1.7; }

    /* ── FEATURES BENTO ── */
    .features-bento {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: auto auto;
      gap: 16px;
      margin-top: 64px;
    }
    .bento-card {
      background: var(--navy2); border: 1px solid var(--border); border-radius: 20px;
      padding: 36px; overflow: hidden; position: relative;
      transition: border-color 0.3s, transform 0.3s;
      opacity: 0; transform: translateY(30px);
    }
    .bento-card.visible { opacity: 1; transform: translateY(0); }
    .bento-card:hover { border-color: rgba(126,200,32,0.35); transform: translateY(-4px); }
    .bento-card.wide { grid-column: span 2; }
    .bento-card.tall { grid-row: span 2; }
    .bento-icon {
      width: 52px; height: 52px; border-radius: 14px;
      background: rgba(126,200,32,0.12); border: 1px solid rgba(126,200,32,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; margin-bottom: 20px;
    }
    .bento-title { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
    .bento-desc { font-size: 14px; color: var(--gray); line-height: 1.7; }
    .bento-card .mockup-img {
      width: 100%; border-radius: 12px; margin-top: 24px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .bento-card .bento-stat {
      font-size: 42px; font-weight: 900; color: var(--lime); margin-top: 16px; line-height: 1;
    }
    .bento-card .bento-stat-label { font-size: 13px; color: var(--gray); margin-top: 4px; }

    /* ── FEATURE SHOWCASE ── */
    .feature-showcase { padding: 100px 5%; }
    .showcase-item {
      max-width: 1200px; margin: 0 auto 120px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center;
    }
    .showcase-item:last-child { margin-bottom: 0; }
    .showcase-item.reverse { direction: rtl; }
    .showcase-item.reverse > * { direction: ltr; }
    .showcase-content {}
    .showcase-list { list-style: none; margin-top: 28px; display: flex; flex-direction: column; gap: 16px; }
    .showcase-list li {
      display: flex; align-items: flex-start; gap: 14px;
      font-size: 15px; color: var(--gray2); line-height: 1.6;
    }
    .showcase-list li .check {
      width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
      background: rgba(126,200,32,0.15); border: 1px solid rgba(126,200,32,0.3);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: var(--lime); margin-top: 2px;
    }
    .showcase-phone {
      position: relative; display: flex; justify-content: center;
      opacity: 0; transform: translateX(40px);
      transition: opacity 0.7s, transform 0.7s;
    }
    .showcase-phone.from-left { transform: translateX(-40px); }
    .showcase-phone.visible { opacity: 1; transform: translateX(0); }
    .showcase-phone img {
      width: 280px; border-radius: 36px;
      box-shadow: 0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
    }
    .showcase-phone-glow {
      position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%);
      width: 180px; height: 50px;
      background: radial-gradient(ellipse, rgba(126,200,32,0.35), transparent 70%);
      filter: blur(16px); z-index: -1;
    }
    .showcase-content { opacity: 0; transform: translateY(20px); transition: opacity 0.7s, transform 0.7s; }
    .showcase-content.visible { opacity: 1; transform: translateY(0); }

    /* ── SOCIAL PROOF ── */
    .social-proof { padding: 100px 5%; background: var(--navy2); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .reviews-grid {
      max-width: 1200px; margin: 64px auto 0;
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
    }
    .review-card {
      background: var(--navy3); border: 1px solid var(--border); border-radius: 16px;
      padding: 28px; transition: border-color 0.3s, transform 0.3s;
      opacity: 0; transform: translateY(20px);
    }
    .review-card.visible { opacity: 1; transform: translateY(0); }
    .review-card:hover { border-color: rgba(126,200,32,0.3); transform: translateY(-4px); }
    .review-stars { color: #fbbf24; font-size: 14px; margin-bottom: 14px; }
    .review-text { font-size: 15px; color: var(--gray2); line-height: 1.7; font-style: italic; margin-bottom: 20px; }
    .review-author { display: flex; align-items: center; gap: 12px; }
    .review-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, var(--lime-dark), var(--lime));
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700; color: #0d1117; flex-shrink: 0;
    }
    .review-name { font-size: 14px; font-weight: 600; }
    .review-biz { font-size: 12px; color: var(--gray); }

    /* ── PRICING ── */
    .pricing { padding: 100px 5%; }
    .pricing-grid {
      max-width: 1100px; margin: 64px auto 0;
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
    }
    .pricing-card {
      background: var(--navy2); border: 1px solid var(--border); border-radius: 20px;
      padding: 32px 24px; position: relative; transition: border-color 0.3s, transform 0.3s;
      opacity: 0; transform: translateY(20px);
    }
    .pricing-card.visible { opacity: 1; transform: translateY(0); }
    .pricing-card.popular {
      border-color: var(--lime); background: linear-gradient(180deg, rgba(126,200,32,0.08) 0%, var(--navy2) 100%);
    }
    .pricing-card:hover { transform: translateY(-4px); }
    .popular-badge {
      position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
      padding: 4px 16px; border-radius: 100px;
      background: var(--lime); color: #0d1117;
      font-size: 11px; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap;
    }
    .pricing-plan { font-size: 13px; font-weight: 700; color: var(--lime); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .pricing-price { font-size: 40px; font-weight: 900; line-height: 1; margin-bottom: 4px; }
    .pricing-price span { font-size: 16px; font-weight: 400; color: var(--gray); }
    .pricing-desc { font-size: 13px; color: var(--gray); margin-bottom: 24px; }
    .pricing-features { list-style: none; display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
    .pricing-features li { font-size: 13px; color: var(--gray2); display: flex; align-items: center; gap: 8px; }
    .pricing-features li::before { content: '✓'; color: var(--lime); font-weight: 700; flex-shrink: 0; }
    .btn-plan {
      width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 700;
      cursor: pointer; text-align: center; text-decoration: none; display: block;
      transition: all 0.2s;
    }
    .btn-plan-outline { background: transparent; border: 1.5px solid var(--border); color: var(--white); }
    .btn-plan-outline:hover { border-color: var(--lime); background: var(--lime-glow); }
    .btn-plan-filled { background: var(--lime); border: none; color: #0d1117; }
    .btn-plan-filled:hover { background: var(--lime-light); }

    /* ── CTA BANNER ── */
    .cta-banner {
      padding: 100px 5%;
      background: linear-gradient(135deg, rgba(126,200,32,0.1) 0%, rgba(126,200,32,0.04) 100%);
      border-top: 1px solid rgba(126,200,32,0.15);
      text-align: center;
    }
    .cta-banner h2 { font-size: clamp(32px, 4vw, 56px); font-weight: 900; letter-spacing: -1px; margin-bottom: 20px; }
    .cta-banner p { font-size: 18px; color: var(--gray2); max-width: 500px; margin: 0 auto 40px; }
    .cta-actions { display: flex; align-items: center; justify-content: center; gap: 16px; flex-wrap: wrap; }
    .cta-note { font-size: 13px; color: var(--gray); margin-top: 16px; }

    /* ── STORE BADGES ── */
    .store-badges { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; margin-top: 24px; }
    .store-badge {
      display: inline-flex; align-items: center; gap: 10px;
      background: rgba(255,255,255,0.06); border: 1.5px solid rgba(255,255,255,0.14);
      border-radius: 12px; padding: 10px 20px; text-decoration: none; color: var(--white);
      transition: all 0.2s; backdrop-filter: blur(8px);
    }
    .store-badge:hover { background: rgba(255,255,255,0.12); border-color: rgba(126,200,32,0.5); transform: translateY(-2px); }
    .store-badge svg { flex-shrink: 0; }
    .store-badge-text { display: flex; flex-direction: column; line-height: 1.2; }
    .store-badge-text small { font-size: 10px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
    .store-badge-text strong { font-size: 15px; font-weight: 700; }

    /* ── FAQ ── */
    .faq-section {
      padding: 100px 5%; max-width: 860px; margin: 0 auto;
    }
    .faq-section .section-label { color: var(--lime); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; }
    .faq-section h2 { font-size: clamp(28px, 3.5vw, 44px); font-weight: 900; letter-spacing: -0.5px; margin-bottom: 48px; }
    .faq-list { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--border); }
    .faq-item { border-bottom: 1px solid var(--border); }
    .faq-question {
      width: 100%; background: none; border: none; color: var(--white);
      display: flex; align-items: center; justify-content: space-between;
      padding: 22px 0; cursor: pointer; text-align: left;
      font-size: 17px; font-weight: 600; font-family: inherit; gap: 16px;
      transition: color 0.2s;
    }
    .faq-question:hover { color: var(--lime); }
    .faq-question.open { color: var(--lime); }
    .faq-icon {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
      border: 1.5px solid var(--border); display: flex; align-items: center; justify-content: center;
      transition: all 0.25s; background: rgba(255,255,255,0.04);
    }
    .faq-question.open .faq-icon { background: var(--lime); border-color: var(--lime); transform: rotate(45deg); }
    .faq-answer {
      overflow: hidden; max-height: 0; transition: max-height 0.35s ease, padding 0.25s ease;
      font-size: 15px; color: var(--gray2); line-height: 1.75; padding: 0;
    }
    .faq-answer.open { max-height: 400px; padding-bottom: 22px; }

    /* ── FOOTER ── */
    footer {
      background: var(--navy2); border-top: 1px solid var(--border);
      padding: 60px 5% 32px;
    }
    .footer-inner { max-width: 1200px; margin: 0 auto; }
    .footer-top {
      display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; margin-bottom: 48px;
    }
    .footer-brand p { font-size: 14px; color: var(--gray); margin-top: 12px; max-width: 280px; line-height: 1.7; }
    .footer-col h4 { font-size: 13px; font-weight: 700; color: var(--white); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    .footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .footer-col ul li a { font-size: 14px; color: var(--gray); text-decoration: none; transition: color 0.2s; }
    .footer-col ul li a:hover { color: var(--lime); }
    .footer-bottom {
      border-top: 1px solid var(--border); padding-top: 24px;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 13px; color: var(--gray);
    }
    .footer-bottom a { color: var(--gray); text-decoration: none; }
    .footer-bottom a:hover { color: var(--lime); }

    /* ── ANIMATIONS ── */
    @keyframes fadeInDown { from{opacity:0;transform:translateY(-20px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeInUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
    .hero-phone-wrap.center { animation: float 5s ease-in-out infinite; }
    .hero-phone-wrap.left { animation: float 5s 0.8s ease-in-out infinite; }
    .hero-phone-wrap.right { animation: float 5s 1.6s ease-in-out infinite; }

    /* ── MARQUEE LOGOS ── */
    .marquee-section { padding: 48px 0; overflow: hidden; border-top: 1px solid var(--border); }
    .marquee-label { text-align: center; font-size: 13px; color: var(--gray); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 32px; }
    .marquee-track { display: flex; gap: 48px; animation: marquee 22s linear infinite; width: max-content; }
    .marquee-track:hover { animation-play-state: paused; }
    .marquee-item {
      display: flex; align-items: center; gap: 10px; white-space: nowrap;
      padding: 12px 24px; border-radius: 100px;
      background: var(--navy2); border: 1px solid var(--border);
      font-size: 14px; font-weight: 600; color: var(--gray2);
    }
    .marquee-item span { font-size: 18px; }
    @keyframes marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }

    /* ── RESPONSIVE ── */
    @media (max-width: 1024px) {
      .features-bento { grid-template-columns: repeat(2, 1fr); }
      .bento-card.wide { grid-column: span 2; }
      .pricing-grid { grid-template-columns: repeat(2, 1fr); }
      .footer-top { grid-template-columns: 1fr 1fr; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-item { border-right: none; border-bottom: 1px solid var(--border); }
      .stat-item:nth-child(odd) { border-right: 1px solid var(--border); }
    }
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .hamburger { display: flex; }
      .hero-phones { gap: 0; }
      .hero-phone-wrap.left, .hero-phone-wrap.right { display: none; }
      .hero-phone-wrap.center img { width: 240px; }
      .features-bento { grid-template-columns: 1fr; }
      .bento-card.wide { grid-column: span 1; }
      .showcase-item { grid-template-columns: 1fr; gap: 48px; }
      .showcase-item.reverse { direction: ltr; }
      .reviews-grid { grid-template-columns: 1fr; }
      .pricing-grid { grid-template-columns: 1fr; }
      .footer-top { grid-template-columns: 1fr; gap: 32px; }
      .footer-bottom { flex-direction: column; gap: 12px; text-align: center; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>

<!-- NAV -->
<nav id="navbar">
  <a href="/home" class="nav-logo">
    <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" alt="Lime Of Time" style="width:36px;height:36px;border-radius:0;object-fit:contain;background:transparent;" />
    <span class="nav-logo-text">Lime Of Time</span>
  </a>
  <div class="nav-links">
    <a href="#features">Features</a>
    <a href="#how-it-works">How It Works</a>
    <a href="#pricing">Pricing</a>
    <a href="#reviews">Reviews</a>
  </div>
  <div class="nav-cta">
    <a href="#" class="btn-primary">Start Free ↗</a>
  </div>
  <div class="hamburger" id="hamburger">
    <span></span><span></span><span></span>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="hero-bg"></div>
  <div class="hero-grid"></div>
  <div class="hero-badge">
    <div class="hero-badge-dot"></div>
    The #1 Scheduling App for Beauty &amp; Wellness
  </div>
  <h1>Run Your Business.<br><span class="highlight">Not Your Calendar.</span></h1>
  <p class="hero-sub">
    Lime Of Time handles your appointments, clients, staff, and payments — so you can focus on what you do best.
  </p>
  <div class="hero-actions">
    <a href="#" class="btn-hero">Get Started Free →</a>
    <a href="#features" class="btn-hero-ghost">See All Features</a>
  </div>
  <div class="store-badges">
    <a href="https://apps.apple.com/" target="_blank" rel="noopener" class="store-badge">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <div class="store-badge-text">
        <small>Download on the</small>
        <strong>App Store</strong>
      </div>
    </a>
    <a href="https://play.google.com/" target="_blank" rel="noopener" class="store-badge">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5v-17c0-.83.94-1.3 1.6-.8l14 8.5c.6.36.6 1.24 0 1.6l-14 8.5c-.66.5-1.6.03-1.6-.8z" opacity=".6"/><path d="M3 20.5l9.5-9.5L3 3.5v17z" opacity=".4"/><path d="M3 3.5l9.5 8L17 8 4.6 3.2C3.94 2.7 3 3.17 3 3.5z"/><path d="M3 20.5l9.5-8L17 16 4.6 20.8c-.66.5-1.6.03-1.6-.3z"/></svg>
      <div class="store-badge-text">
        <small>Get it on</small>
        <strong>Google Play</strong>
      </div>
    </a>
  </div>
  <div class="hero-trust">
    <div class="hero-trust-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 0l1.8 3.6L13 4.3l-3 2.9.7 4.1L7 9.4l-3.7 1.9.7-4.1L1 4.3l4.2-.7z"/></svg>
      4.9 / 5 average rating
    </div>
    <div class="hero-trust-item">✓ No credit card required</div>
    <div class="hero-trust-item">✓ Free 14-day trial</div>
    <div class="hero-trust-item">✓ Cancel anytime</div>
  </div>
  <div class="hero-phones">
    <div class="hero-phone-wrap left">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/uEHVoWZBELDBcmEp.png" alt="Calendar view" loading="lazy" />
      <div class="phone-glow"></div>
    </div>
    <div class="hero-phone-wrap center">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/jkWuQsQWDBaHcMkW.png" alt="Dashboard" loading="lazy" />
      <div class="phone-glow"></div>
    </div>
    <div class="hero-phone-wrap right">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/CiNeTHdiLMFRvGtw.png" alt="Clients view" loading="lazy" />
      <div class="phone-glow"></div>
    </div>
  </div>
</section>

<!-- MARQUEE -->
<div class="marquee-section">
  <p class="marquee-label">Trusted by businesses across every category</p>
  <div class="marquee-track">
    <div class="marquee-item"><span>💇</span> Hair Salons</div>
    <div class="marquee-item"><span>🪒</span> Barbershops</div>
    <div class="marquee-item"><span>💆</span> Spas &amp; Wellness</div>
    <div class="marquee-item"><span>💅</span> Nail Studios</div>
    <div class="marquee-item"><span>🧖</span> Skincare Clinics</div>
    <div class="marquee-item"><span>🏋️</span> Fitness Studios</div>
    <div class="marquee-item"><span>🦷</span> Dental Practices</div>
    <div class="marquee-item"><span>🐾</span> Pet Groomers</div>
    <div class="marquee-item"><span>🎨</span> Tattoo Studios</div>
    <div class="marquee-item"><span>💇</span> Hair Salons</div>
    <div class="marquee-item"><span>🪒</span> Barbershops</div>
    <div class="marquee-item"><span>💆</span> Spas &amp; Wellness</div>
    <div class="marquee-item"><span>💅</span> Nail Studios</div>
    <div class="marquee-item"><span>🧖</span> Skincare Clinics</div>
    <div class="marquee-item"><span>🏋️</span> Fitness Studios</div>
    <div class="marquee-item"><span>🦷</span> Dental Practices</div>
    <div class="marquee-item"><span>🐾</span> Pet Groomers</div>
    <div class="marquee-item"><span>🎨</span> Tattoo Studios</div>
  </div>
</div>

<!-- STATS -->
<section class="stats">
  <div class="stats-grid">
    <div class="stat-item">
      <div class="stat-number" data-target="48">0</div>
      <div class="stat-label">Hours saved per month on average</div>
    </div>
    <div class="stat-item">
      <div class="stat-number" data-target="32" data-suffix="%">0%</div>
      <div class="stat-label">Increase in bookings after switching</div>
    </div>
    <div class="stat-item">
      <div class="stat-number" data-target="4.9" data-decimal="true">0</div>
      <div class="stat-label">Average app store rating</div>
    </div>
    <div class="stat-item">
      <div class="stat-number" data-target="14" data-suffix=" days">0</div>
      <div class="stat-label">Free trial — no credit card needed</div>
    </div>
  </div>
</section>

<!-- FEATURES BENTO -->
<section class="section" id="features">
  <div class="section-inner">
    <div class="section-tag">Everything You Need</div>
    <h2 class="section-title">Built for businesses<br>that take their time seriously.</h2>
    <p class="section-sub">Every feature is designed to reduce friction, save time, and help you earn more — without the complexity.</p>
    <div class="features-bento">
      <!-- Smart Calendar -->
      <div class="bento-card wide">
        <div class="bento-icon">📅</div>
        <div class="bento-title">Smart Calendar &amp; Scheduling</div>
        <div class="bento-desc">A full weekly view with color-coded appointments per staff member. Drag, drop, and reschedule in seconds. Never double-book again.</div>
        <img class="mockup-img" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/uEHVoWZBELDBcmEp.png" alt="Calendar" loading="lazy" style="max-height:280px;object-fit:cover;object-position:top;" />
      </div>
      <!-- Revenue -->
      <div class="bento-card">
        <div class="bento-icon">💰</div>
        <div class="bento-title">Revenue Insights</div>
        <div class="bento-desc">See today's earnings, monthly trends, and top services at a glance.</div>
        <div class="bento-stat">$28K</div>
        <div class="bento-stat-label">Average monthly revenue tracked per business</div>
      </div>
      <!-- Online Booking -->
      <div class="bento-card">
        <div class="bento-icon">🌐</div>
        <div class="bento-title">Online Booking Page</div>
        <div class="bento-desc">A beautiful, shareable booking link your clients can use 24/7 — no app download required.</div>
        <img class="mockup-img" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/ZKuMMYQgGKsjWMwY.png" alt="Booking" loading="lazy" style="max-height:200px;object-fit:cover;object-position:top;" />
      </div>
      <!-- Client Management -->
      <div class="bento-card">
        <div class="bento-icon">👥</div>
        <div class="bento-title">Client Management</div>
        <div class="bento-desc">Full client profiles with visit history, lifetime value, notes, and birthday tracking.</div>
        <div class="bento-stat">248</div>
        <div class="bento-stat-label">Clients managed per business on average</div>
      </div>
      <!-- SMS Automation -->
      <div class="bento-card">
        <div class="bento-icon">💬</div>
        <div class="bento-title">SMS Automation</div>
        <div class="bento-desc">Automatic appointment reminders, rebooking nudges, and birthday messages — all customisable per service.</div>
      </div>
      <!-- Analytics -->
      <div class="bento-card wide">
        <div class="bento-icon">📊</div>
        <div class="bento-title">Analytics &amp; Performance</div>
        <div class="bento-desc">Daily revenue charts, top services, staff performance rankings, and client growth trends — all in one screen.</div>
        <img class="mockup-img" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/jkWuQsQWDBaHcMkW.png" alt="Analytics" loading="lazy" style="max-height:260px;object-fit:cover;object-position:top;" />
      </div>
    </div>
  </div>
</section>

<!-- FEATURE SHOWCASE -->
<section class="feature-showcase" id="how-it-works">
  <!-- Showcase 1: Online Booking -->
  <div class="showcase-item">
    <div class="showcase-content">
      <div class="section-tag">Online Booking</div>
      <h2 class="section-title">Your clients book themselves. You just show up.</h2>
      <p class="section-sub">Share your unique booking link anywhere — Instagram bio, Google Business, printed QR code at the counter. Clients pick their service, staff, and time in under 60 seconds.</p>
      <ul class="showcase-list">
        <li><div class="check">✓</div> Real-time availability — no double bookings</li>
        <li><div class="check">✓</div> Custom cancellation &amp; deposit policies</li>
        <li><div class="check">✓</div> Instant SMS confirmation to client &amp; owner</li>
        <li><div class="check">✓</div> Works on any device, no app download needed</li>
      </ul>
    </div>
    <div class="showcase-phone">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/ZKuMMYQgGKsjWMwY.png" alt="Online Booking" loading="lazy" />
      <div class="showcase-phone-glow"></div>
    </div>
  </div>
  <!-- Showcase 2: Client Management -->
  <div class="showcase-item reverse">
    <div class="showcase-content">
      <div class="section-tag">Client Management</div>
      <h2 class="section-title">Know every client like a regular.</h2>
      <p class="section-sub">Every client gets a full profile — visit history, spending, notes, birthday, and preferences. Build loyalty by remembering the details that matter.</p>
      <ul class="showcase-list">
        <li><div class="check">✓</div> Lifetime value &amp; visit count per client</li>
        <li><div class="check">✓</div> Birthday tracking with auto SMS campaigns</li>
        <li><div class="check">✓</div> Private notes only you can see</li>
        <li><div class="check">✓</div> Searchable across all locations</li>
      </ul>
    </div>
    <div class="showcase-phone from-left">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/CiNeTHdiLMFRvGtw.png" alt="Clients" loading="lazy" />
      <div class="showcase-phone-glow"></div>
    </div>
  </div>
  <!-- Showcase 3: Analytics -->
  <div class="showcase-item">
    <div class="showcase-content">
      <div class="section-tag">Analytics</div>
      <h2 class="section-title">Data that actually helps you grow.</h2>
      <p class="section-sub">Stop guessing. See exactly which services make the most money, which staff bring in the most revenue, and when your busiest days are — so you can plan smarter.</p>
      <ul class="showcase-list">
        <li><div class="check">✓</div> Daily &amp; monthly revenue charts</li>
        <li><div class="check">✓</div> Top services &amp; staff performance rankings</li>
        <li><div class="check">✓</div> New client growth tracking</li>
        <li><div class="check">✓</div> Average ticket value &amp; appointment count</li>
      </ul>
    </div>
    <div class="showcase-phone">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/jkWuQsQWDBaHcMkW.png" alt="Analytics" loading="lazy" />
      <div class="showcase-phone-glow"></div>
    </div>
  </div>
</section>

<!-- SOCIAL PROOF -->
<section class="social-proof" id="reviews">
  <div class="section-inner" style="text-align:center;">
    <div class="section-tag">Customer Reviews</div>
    <h2 class="section-title">Businesses love Lime Of Time.</h2>
    <p class="section-sub" style="margin:0 auto;">Real reviews from real business owners who switched from pen &amp; paper or clunky software.</p>
  </div>
  <div class="reviews-grid">
    <div class="review-card">
      <div class="review-stars">★★★★★</div>
      <p class="review-text">"I used to spend 2 hours every Sunday setting up the week. Now it takes 10 minutes. My clients love being able to book themselves at midnight."</p>
      <div class="review-author">
        <div class="review-avatar">SM</div>
        <div>
          <div class="review-name">Sarah M.</div>
          <div class="review-biz">Glow Hair Studio, Miami</div>
        </div>
      </div>
    </div>
    <div class="review-card">
      <div class="review-stars">★★★★★</div>
      <p class="review-text">"The SMS reminders alone cut my no-shows by 70%. I was losing $800/month to no-shows. That's gone now. Worth every penny."</p>
      <div class="review-author">
        <div class="review-avatar">JR</div>
        <div>
          <div class="review-name">James R.</div>
          <div class="review-biz">The Barber Lounge, Austin</div>
        </div>
      </div>
    </div>
    <div class="review-card">
      <div class="review-stars">★★★★★</div>
      <p class="review-text">"I have 3 locations and 8 staff members. Lime Of Time handles all of it from one app. The analytics show me exactly which location is underperforming."</p>
      <div class="review-author">
        <div class="review-avatar">EC</div>
        <div>
          <div class="review-name">Emma C.</div>
          <div class="review-biz">Zen Wellness Centers</div>
        </div>
      </div>
    </div>
    <div class="review-card">
      <div class="review-stars">★★★★★</div>
      <p class="review-text">"Setup took 15 minutes. I had my booking link live and shared on Instagram the same day. Booked 6 new clients that week."</p>
      <div class="review-author">
        <div class="review-avatar">AL</div>
        <div>
          <div class="review-name">Alex L.</div>
          <div class="review-biz">Luxe Nail Bar, NYC</div>
        </div>
      </div>
    </div>
    <div class="review-card">
      <div class="review-stars">★★★★★</div>
      <p class="review-text">"The client profiles are incredible. I can see every visit, what they had done, and their birthday. My clients feel like VIPs every time."</p>
      <div class="review-author">
        <div class="review-avatar">MK</div>
        <div>
          <div class="review-name">Michelle K.</div>
          <div class="review-biz">Serenity Spa, Chicago</div>
        </div>
      </div>
    </div>
    <div class="review-card">
      <div class="review-stars">★★★★★</div>
      <p class="review-text">"Switched from a $200/month competitor. Lime Of Time does everything they did at a fraction of the cost. The app is faster and easier to use."</p>
      <div class="review-author">
        <div class="review-avatar">DV</div>
        <div>
          <div class="review-name">David V.</div>
          <div class="review-biz">Sharp Cuts Barbershop</div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="pricing" id="pricing">
  <div class="section-inner" style="text-align:center;">
    <div class="section-tag">Pricing</div>
    <h2 class="section-title">Simple pricing. No surprises.</h2>
    <p class="section-sub" style="margin:0 auto;">Start free. Upgrade when you're ready. Cancel anytime.</p>
  </div>
  <div class="pricing-grid">
    <div class="pricing-card">
      <div class="pricing-plan">Solo</div>
      <div class="pricing-price">Free<span></span></div>
      <div class="pricing-desc">Perfect for solo practitioners just getting started.</div>
      <ul class="pricing-features">
        <li>10 clients</li>
        <li>5 services</li>
        <li>1 staff member</li>
        <li>Online booking page</li>
        <li>Basic analytics</li>
      </ul>
      <a href="#" class="btn-plan btn-plan-outline">Start Free</a>
    </div>
    <div class="pricing-card popular">
      <div class="popular-badge">⭐ MOST POPULAR</div>
      <div class="pricing-plan">Growth</div>
      <div class="pricing-price">$19.99<span>/mo</span></div>
      <div class="pricing-desc">For growing businesses ready to scale.</div>
      <ul class="pricing-features">
        <li>100 clients</li>
        <li>20 services</li>
        <li>2 staff members</li>
        <li>SMS automation</li>
        <li>Unlimited appointments</li>
        <li>Full analytics</li>
      </ul>
      <a href="#" class="btn-plan btn-plan-filled">Start Free Trial</a>
    </div>
    <div class="pricing-card">
      <div class="pricing-plan">Studio</div>
      <div class="pricing-price">$49.99<span>/mo</span></div>
      <div class="pricing-desc">For established studios with a full team.</div>
      <ul class="pricing-features">
        <li>500 clients</li>
        <li>Unlimited services</li>
        <li>5 staff members</li>
        <li>2 locations</li>
        <li>Advanced SMS</li>
        <li>Gift cards &amp; discounts</li>
      </ul>
      <a href="#" class="btn-plan btn-plan-outline">Start Free Trial</a>
    </div>
    <div class="pricing-card">
      <div class="pricing-plan">Enterprise</div>
      <div class="pricing-price">$99.99<span>/mo</span></div>
      <div class="pricing-desc">For multi-location businesses that need it all.</div>
      <ul class="pricing-features">
        <li>Unlimited clients</li>
        <li>Unlimited services</li>
        <li>Unlimited staff</li>
        <li>Unlimited locations</li>
        <li>Priority support</li>
        <li>Custom onboarding</li>
      </ul>
      <a href="#" class="btn-plan btn-plan-outline">Contact Us</a>
    </div>
  </div>
</section>

<!-- CTA BANNER -->
<section class="cta-banner">
  <h2>Ready to take back your time?</h2>
  <p>Join thousands of business owners who spend less time scheduling and more time doing what they love.</p>
  <div class="cta-actions">
    <a href="#" class="btn-hero">Start Your Free Trial →</a>
  </div>
  <div class="store-badges">
    <a href="https://apps.apple.com/" target="_blank" rel="noopener" class="store-badge">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <div class="store-badge-text">
        <small>Download on the</small>
        <strong>App Store</strong>
      </div>
    </a>
    <a href="https://play.google.com/" target="_blank" rel="noopener" class="store-badge">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5v-17c0-.83.94-1.3 1.6-.8l14 8.5c.6.36.6 1.24 0 1.6l-14 8.5c-.66.5-1.6.03-1.6-.8z" opacity=".6"/><path d="M3 20.5l9.5-9.5L3 3.5v17z" opacity=".4"/><path d="M3 3.5l9.5 8L17 8 4.6 3.2C3.94 2.7 3 3.17 3 3.5z"/><path d="M3 20.5l9.5-8L17 16 4.6 20.8c-.66.5-1.6.03-1.6-.3z"/></svg>
      <div class="store-badge-text">
        <small>Get it on</small>
        <strong>Google Play</strong>
      </div>
    </a>
  </div>
  <p class="cta-note">No credit card required · 14-day free trial · Cancel anytime</p>
</section>

<!-- FAQ -->
<section class="faq-section" id="faq">
  <div class="section-label">FAQ</div>
  <h2>Common questions,<br>honest answers.</h2>
  <div class="faq-list">

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Does Lime Of Time work without internet?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Yes — your appointments, clients, and services are stored locally on your device. You can view your calendar, add appointments, and manage clients even with no connection. Syncing and SMS automation require internet, but your core workflow never stops.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Can I manage multiple locations?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Yes. The Studio plan supports 2 locations and the Enterprise plan supports unlimited locations. Each location has its own booking page, hours, staff, and analytics. You switch between locations with one tap from the Settings screen.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        How do clients book appointments?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Every business gets a unique booking link (e.g. lime-of-time.com/book/your-business). Share it on Instagram, Google, or print a QR code to display at the counter. Clients choose their service, staff member, and time slot in under 60 seconds — no app download needed.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Can I add multiple staff members?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Yes. Each staff member gets their own schedule, services, and booking availability. Clients can choose a specific staff member when booking, or select “Any available”. The Growth plan includes 2 staff members, Studio includes 5, and Enterprise is unlimited.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Does it send automatic appointment reminders?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Yes — SMS reminders are sent automatically before each appointment. You can set a custom reminder window per service (e.g. 2 hours for a haircut, 24 hours for a consultation). Birthday messages and rebooking nudges are also automated and fully customisable.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Is there a free plan?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Yes. The Solo plan is completely free with no credit card required. It supports up to 10 clients, 5 services, and 1 staff member — perfect for solo practitioners just getting started. Upgrade to a paid plan whenever you’re ready to scale.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Can I accept payments through the app?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Yes. The Growth plan includes Basic online payments, and Studio/Enterprise include Full payment processing. Clients can pay when booking online, and you can record cash or card payments directly in the app. Revenue is tracked automatically in your analytics.</div>
    </div>

    <div class="faq-item">
      <button class="faq-question" onclick="toggleFaq(this)">
        Can I cancel or change plans anytime?
        <span class="faq-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      </button>
      <div class="faq-answer">Absolutely. You can upgrade, downgrade, or cancel your subscription at any time from the Settings → Subscription screen. There are no long-term contracts or cancellation fees. If you cancel, you keep access until the end of your billing period.</div>
    </div>

  </div>
</section>

<script>
function toggleFaq(btn) {
  const answer = btn.nextElementSibling;
  const isOpen = btn.classList.contains('open');
  // Close all others
  document.querySelectorAll('.faq-question.open').forEach(q => {
    q.classList.remove('open');
    q.nextElementSibling.classList.remove('open');
  });
  // Toggle clicked
  if (!isOpen) {
    btn.classList.add('open');
    answer.classList.add('open');
  }
}
</script>

<!-- FOOTER -->
<footer>
  <div class="footer-inner">
    <div class="footer-top">
      <div class="footer-brand">
        <a href="/home" class="nav-logo" style="text-decoration:none;">
          <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" alt="Lime Of Time" style="width:40px;height:40px;border-radius:0;object-fit:contain;background:transparent;" />
          <span class="nav-logo-text">Lime Of Time</span>
        </a>
        <p>The all-in-one scheduling app for salons, barbershops, spas, and wellness businesses. Manage your business from your phone.</p>
      </div>
      <div class="footer-col">
        <h4>Product</h4>
        <ul>
          <li><a href="#">Features</a></li>
          <li><a href="#">Pricing</a></li>
          <li><a href="#">Online Booking</a></li>
          <li><a href="#">Analytics</a></li>
          <li><a href="#">SMS Automation</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Business Types</h4>
        <ul>
          <li><a href="#">Hair Salons</a></li>
          <li><a href="#">Barbershops</a></li>
          <li><a href="#">Spas</a></li>
          <li><a href="#">Nail Studios</a></li>
          <li><a href="#">Wellness Centers</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <ul>
          <li><a href="#">About</a></li>
          <li><a href="#">Contact</a></li>
          <li><a href="#">Privacy Policy</a></li>
          <li><a href="#">Terms of Service</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Lime Of Time. All rights reserved.</span>
      <div style="display:flex;gap:20px;">
        <a href="#">Privacy</a>
        <a href="#">Terms</a>
        <a href="#">Contact</a>
      </div>
    </div>
  </div>
</footer>

<script>
  // Scroll animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('visible'), i * 80);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.bento-card, .stat-item, .review-card, .pricing-card, .showcase-phone, .showcase-content').forEach(el => observer.observe(el));

  // Counter animation
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target);
    const suffix = el.dataset.suffix || '';
    const isDecimal = el.dataset.decimal === 'true';
    const duration = 1800;
    const start = performance.now();
    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      el.textContent = (isDecimal ? value.toFixed(1) : Math.floor(value)) + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        statObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.stat-number[data-target]').forEach(el => statObserver.observe(el));

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').style.background =
      window.scrollY > 40 ? 'rgba(13,17,23,0.97)' : 'rgba(13,17,23,0.85)';
  });
</script>
</body>
</html>
`;
}

function notFoundPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found - Lime Of Time</title>
  ${baseStyles()}
</head>
<body>
  <div class="container" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
    <div style="font-size:48px;margin-bottom:16px;">😕</div>
    <h1 style="font-size:22px;color:#1a1a1a;margin-bottom:8px;">${message}</h1>
    <p style="color:#888;font-size:14px;">The page you're looking for doesn't exist or the business link may be incorrect.</p>
  </div>
</body>
</html>`;
}

function errorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Lime Of Time</title>
  ${baseStyles()}
</head>
<body>
  <div class="container" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
    <h1 style="font-size:22px;color:#1a1a1a;margin-bottom:8px;">Something went wrong</h1>
    <p style="color:#888;font-size:14px;">Please try again later.</p>
  </div>
</body>
</html>`;
}

function bookingPage(slug: string, owner: any, preselectedLocationId?: string | null, prefetchedLocations?: any[], platformFeePercent: number = 1.5): string {
  // Compute the initial full address for server-side rendering
  // Use preselected location if provided, or the only active location if there's just one
  const activeLocs = (prefetchedLocations || []).filter((l: any) => l.active !== false);
  let initialAddress = owner.address || '';
  if (preselectedLocationId) {
    const loc = activeLocs.find((l: any) => l.localId === preselectedLocationId);
    if (loc) {
      const parts = [loc.address?.trim(), loc.city?.trim(), loc.state?.trim() && loc.zipCode?.trim() ? `${loc.state.trim()} ${loc.zipCode.trim()}` : (loc.state?.trim() || loc.zipCode?.trim())].filter(Boolean);
      initialAddress = parts.join(', ') || loc.address || owner.address || '';
    }
  } else if (activeLocs.length === 1) {
    const loc = activeLocs[0];
    const parts = [loc.address?.trim(), loc.city?.trim(), loc.state?.trim() && loc.zipCode?.trim() ? `${loc.state.trim()} ${loc.zipCode.trim()}` : (loc.state?.trim() || loc.zipCode?.trim())].filter(Boolean);
    initialAddress = parts.join(', ') || loc.address || owner.address || '';
  }
  const wh: Record<string, any> = owner.workingHours || {};
  const whJson: Record<string, boolean> = {};
  ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].forEach(d => {
    const entry = wh[d] || wh[d.toLowerCase()];
    whJson[d] = !!(entry && entry.enabled);
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Book with ${escHtml(owner.businessName)} - Lime Of Time</title>
  <meta name="description" content="Book an appointment with ${escHtml(owner.businessName)}. Schedule online with Lime Of Time.">
  <meta property="og:title" content="Book with ${escHtml(owner.businessName)} - Lime Of Time">
  <meta property="og:description" content="Book an appointment with ${escHtml(owner.businessName)}. Easy online scheduling powered by Lime Of Time.">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Lime Of Time">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Book with ${escHtml(owner.businessName)}">
  <meta name="twitter:description" content="Book an appointment with ${escHtml(owner.businessName)}. Easy online scheduling.">
  <meta name="robots" content="index, follow">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <link rel="canonical" href="https://lime-of-time.com/book/${escHtml(owner.businessName.toLowerCase().replace(/\s+/g, '-'))}">  
  ${baseStyles()}
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
</head>
<body>
  <div class="container" id="app">
    <div class="header" role="banner">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" alt="Lime Of Time" class="biz-logo" style="border-radius:0;object-fit:contain;background:transparent;">
      <h1>Book with ${escHtml(owner.businessName)}</h1>
      <div class="subtitle">Powered by Lime Of Time</div>
    </div>

    <div id="step-indicator" class="step-indicator" role="navigation" aria-label="Booking steps">
      <div class="step-item active" id="step-item-0">
        <div class="step-dot active" id="dot-0">1</div>
        <span class="step-label">Location</span>
      </div>
      <div class="step-item" id="step-item-1">
        <div class="step-dot" id="dot-1">2</div>
        <span class="step-label">Info</span>
      </div>
      <div class="step-item" id="step-item-2">
        <div class="step-dot" id="dot-2">3</div>
        <span class="step-label">Service</span>
      </div>
      <div class="step-item" id="step-item-3">
        <div class="step-dot" id="dot-3">4</div>
        <span class="step-label">Staff</span>
      </div>
      <div class="step-item" id="step-item-4">
        <div class="step-dot" id="dot-4">5</div>
        <span class="step-label">Date</span>
      </div>
      <div class="step-item" id="step-item-5">
        <div class="step-dot" id="dot-5">6</div>
        <span class="step-label">Extras</span>
      </div>
      <div class="step-item" id="step-item-6">
        <div class="step-dot" id="dot-6">7</div>
        <span class="step-label">Payment</span>
      </div>
      <div class="step-item" id="step-item-7">
        <div class="step-dot" id="dot-7">8</div>
        <span class="step-label">Confirm</span>
      </div>
    </div>

    <!-- Persistent selected-location banner (shown on steps 1–6, hidden on step 0 and success) -->
    <div id="selectedLocBanner" onclick="goToStep(0)" title="Click to change location">
      <span>📍</span>
      <span class="loc-name" id="selectedLocName"></span>
      <span class="loc-change">Change</span>
    </div>
    <!-- Business Info Card -->
    <div class="card biz-info" id="biz-card">
      <div style="font-size:16px;font-weight:700;color:var(--text);">${escHtml(owner.businessName)}</div>
      <div id="biz-address-row">${(activeLocs.length <= 1 || !!preselectedLocationId) && initialAddress ? `<div class="biz-info-row"><span>📍</span><a href="https://maps.google.com/?q=${encodeURIComponent(initialAddress)}" target="_blank">${escHtml(initialAddress)}</a></div>` : ""}</div>
      ${owner.phone ? `<div class="biz-info-row"><span>📞</span><span>${escHtml(formatPhoneNumber(owner.phone))}</span></div>` : ""}
      ${owner.email ? `<div class="biz-info-row"><span>✉️</span><span>${escHtml(owner.email)}</span></div>` : ""}
      ${owner.description ? `<div style="font-size:13px;color:var(--text-muted);margin-top:6px;">${escHtml(owner.description)}</div>` : ""}
    </div>

    ${owner.temporaryClosed ? `<div class="closed-banner">⚠️ This business is temporarily closed and not accepting bookings at this time.</div>` : ""}

    <!-- Top-level location closed banner (shown when preselected location is temporarily closed) -->
    <div id="topLocClosedBanner">
      <div class="lc-title">&#9888;&#65039; Location Temporarily Closed</div>
      <div class="lc-msg" id="topLocClosedMsg">This location is temporarily closed and not accepting bookings at this time. Please check back later.</div>
    </div>

    <!-- Step 0: Location Selection -->
    <div id="step-0" class="card" ${owner.temporaryClosed ? 'style="display:none"' : 'style=""'}>
      <h2>Select a Location</h2>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Choose a location to book your appointment.</p>
      <div id="locationSelectorStep0"></div>
      <div style="margin-top:16px;">
        <button class="btn btn-primary" id="locContinueBtn" onclick="goToIntentStep()" style="width:100%" ${!preselectedLocationId ? 'disabled' : ''}>Continue</button>
      </div>
    </div>
    <!-- Intent Step: Book for myself vs Buy a Gift -->
    <div id="step-intent" class="card" style="display:none">
      <h2 style="margin-bottom:6px;">How would you like to continue?</h2>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;">Book an appointment for yourself, or purchase a gift for someone special.</p>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <button onclick="bookForMyself()" style="display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:16px;border:2px solid var(--accent);background:var(--accent-bg-light);cursor:pointer;text-align:left;width:100%;transition:all .15s;" onmouseover="this.style.background='var(--accent)';this.querySelector('.intent-title').style.color='#fff';this.querySelector('.intent-sub').style.color='rgba(255,255,255,0.8)'" onmouseout="this.style.background='var(--accent-bg-light)';this.querySelector('.intent-title').style.color='var(--accent)';this.querySelector('.intent-sub').style.color='var(--text-secondary)'">
          <div style="font-size:36px;line-height:1;">📅</div>
          <div>
            <div class="intent-title" style="font-size:16px;font-weight:700;color:var(--accent);margin-bottom:3px;">Book for Myself</div>
            <div class="intent-sub" style="font-size:13px;color:var(--text-secondary);line-height:1.4;">Schedule an appointment at a time that works for you.</div>
          </div>
        </button>
        <button onclick="buyGiftIntent()" style="display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:16px;border:2px solid #e91e8c;background:#fce4f3;cursor:pointer;text-align:left;width:100%;transition:all .15s;" onmouseover="this.style.background='#e91e8c';this.querySelector('.gift-title').style.color='#fff';this.querySelector('.gift-sub').style.color='rgba(255,255,255,0.8)'" onmouseout="this.style.background='#fce4f3';this.querySelector('.gift-title').style.color='#e91e8c';this.querySelector('.gift-sub').style.color='#666'">
          <div style="font-size:36px;line-height:1;">🎁</div>
          <div>
            <div class="gift-title" style="font-size:16px;font-weight:700;color:#e91e8c;margin-bottom:3px;">Buy a Gift</div>
            <div class="gift-sub" style="font-size:13px;color:#666;line-height:1.4;">Purchase services or products as a gift for a friend or family member.</div>
          </div>
        </button>
      </div>
      <div style="margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(0)" style="width:100%">Back</button>
      </div>
    </div>
    <!-- Step 1: Client Info -->
    <div id="step-1" class="card" style="display:none">
      <h2>Your Information</h2>
      <div class="input-group">
        <label>Name *</label>
        <input type="text" id="clientName" placeholder="Your full name" required>
      </div>
      <div class="input-group">
        <label>Phone Number</label>
        <input type="tel" id="clientPhone" placeholder="(000) 000-0000">
      </div>
      <div class="input-group">
        <label>Email</label>
        <input type="email" id="clientEmail" placeholder="your@email.com">
      </div>
      <div class="input-group">
        <label>Gift Code (optional)</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="giftCode" placeholder="GIFT-XXXX" style="flex:1">
          <button class="btn btn-secondary" style="width:auto;padding:12px 16px;font-size:14px;" onclick="applyGiftCode()">Apply</button>
        </div>
        <div id="giftMsg" style="font-size:12px;margin-top:4px;"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(0)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="goToStep(2)" style="flex:1">Continue</button>
      </div>
    </div>

    <!-- Step 1: Select Service -->
    <div id="step-2" class="card" style="display:none">
      <h2>Select a Service</h2>
      <!-- Search bar -->
      <div style="margin-bottom:12px;">
        <input id="svcSearch" type="text" placeholder="&#128269; Search services..." oninput="onSvcSearch(this.value)"
          style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--bg-card);color:var(--text);outline:none;">
      </div>
      <!-- Service type filter chips (shown only when both types exist) -->
      <div id="svcTypeFilterRow" style="display:none;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button id="svcFilterAll" onclick="setSvcTypeFilter('all')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;border:1.5px solid var(--border);background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;">All</button>
        <button id="svcFilterInStore" onclick="setSvcTypeFilter('in_store')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;">🏢 In Store</button>
        <button id="svcFilterMobile" onclick="setSvcTypeFilter('mobile')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;">🚗 Mobile</button>
      </div>
      <!-- Most Popular row -->
      <div id="svcPopularRow" style="display:none;margin-bottom:16px;">
        <div style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">&#11088; Most Popular</div>
        <div id="svcPopularList" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none;"></div>
      </div>
      <!-- Category tiles -->
      <div id="svcCatGrid" class="tile-grid"></div>
      <!-- Service list (after drilling into a category) -->
      <div id="svcItemList" style="display:none;"></div>
      <!-- Search results -->
      <div id="svcSearchResults" style="display:none;"></div>
      <!-- Selected service summary -->
      <div id="svcSelectedSummary" style="display:none;margin-top:12px;padding:10px 14px;background:var(--accent-bg-light);border:1.5px solid var(--accent);border-radius:10px;font-size:14px;color:var(--accent);font-weight:600;"></div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(1)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="goToStep(3)" id="btnToStaff" disabled style="flex:1">Continue</button>
      </div>
    </div>
    <!-- Step 3: Staff Selection -->
    <div id="step-3" class="card" style="display:none">
      <h2>Choose a Staff Member</h2>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Select a staff member for your appointment, or choose <strong>Any Available</strong> to let us assign the first available.</p>
      <button onclick="skipStaffSelection()" style="width:100%;padding:11px 16px;background:var(--bg-card);border:1.5px dashed var(--border);border-radius:12px;font-size:13px;font-weight:600;color:var(--text-secondary);cursor:pointer;margin-bottom:14px;transition:all .15s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'">Skip → Any Available</button>
      <div id="staffListStep3" class="service-list"></div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(2)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="goToStep(4)" style="flex:1">Continue</button>
      </div>
    </div>
    <!-- Service primary detail overlay -->
    <div id="svcDetailOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;align-items:flex-end;justify-content:center;">
      <div id="svcDetailContent" class="detail-sheet" style="background:var(--bg-card);border-radius:20px 20px 0 0;padding:24px 20px 36px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;"></div>
    </div>

    <!-- Step 4: Select Date & Time (Monthly Calendar) -->
    <div id="step-4" class="card" style="display:none">
      <h2>Select Date & Time</h2>
      <div id="locClosedBanner" class="loc-closed-banner">
        <div class="lc-title">&#9888;&#65039; Location Temporarily Closed</div>
        <div class="lc-msg" id="locClosedMsg"></div>
      </div>
      <div class="cal-nav">
        <button onclick="changeMonth(-1)" id="calPrev">&larr;</button>
        <span class="cal-title" id="calTitle"></span>
        <button onclick="changeMonth(1)">&rarr;</button>
      </div>
      <div class="cal-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
      <div id="calGrid" class="cal-grid"></div>
      <div id="timeSection" style="display:none">
        <h2 style="margin-bottom:12px;">Available Times</h2>
        <div id="timeGrid" class="time-grid"></div>
        <div id="noSlots" style="display:none;text-align:center;padding:20px;font-size:14px;">
          <div id="noSlotsMsg" style="color:#888;">No available time slots for this date.</div>
          <button class="btn btn-secondary" style="margin-top:12px;width:auto;display:inline-block;padding:10px 20px;font-size:13px;" onclick="joinWaitlist()">Join Waitlist</button>
        </div>
        <div id="waitlistMsg" style="display:none;text-align:center;padding:12px;margin-top:8px;border-radius:10px;font-size:13px;"></div>
      </div>
      <div id="discountInfo" style="display:none;margin-top:12px;"></div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(3)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="goToStep(5, 4)" id="btnToConfirm" disabled style="flex:1">Continue</button>
      </div>
    </div>

    <!-- Step 4b: Client Address (Mobile Services Only) -->
    <div id="step-4b" class="card" style="display:none">
      <h2>Your Service Address</h2>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">This service is performed at your location. Please enter the address where you'd like the service performed.</p>
      <div id="mobileServiceInfo" style="background:var(--accent-bg);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text);"></div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="position:relative;">
          <label style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;display:block;">Street Address <span style="color:#ef4444;">*</span></label>
          <input id="addrStreet" type="text" placeholder="e.g. 456 Oak Avenue" autocomplete="off"
            oninput="clientAddress.street=this.value;onAddrStreetInput(this.value)"
            style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid var(--border-input);border-radius:12px;font-size:14px;background:var(--bg-card);color:var(--text);outline:none;" />
          <div id="addrSuggestBox" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg-card);border:1.5px solid var(--border);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);margin-top:2px;max-height:200px;overflow-y:auto;"></div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;display:block;">City <span style="color:#ef4444;">*</span></label>
          <input id="addrCity" type="text" placeholder="Your city" oninput="clientAddress.city=this.value" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid var(--border-input);border-radius:12px;font-size:14px;background:var(--bg-card);color:var(--text);outline:none;" />
        </div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;">
            <label style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;display:block;">State <span style="color:#ef4444;">*</span></label>
            <input id="addrState" type="text" placeholder="e.g. PA" maxlength="2" oninput="clientAddress.state=this.value.toUpperCase();this.value=this.value.toUpperCase()" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid var(--border-input);border-radius:12px;font-size:14px;background:var(--bg-card);color:var(--text);outline:none;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;display:block;">ZIP Code <span style="color:#ef4444;">*</span></label>
            <div style="position:relative;">
              <input id="addrZip" type="text" placeholder="e.g. 15222" maxlength="10" oninput="clientAddress.zip=this.value;autoFillStateFromZip(this.value)" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid var(--border-input);border-radius:12px;font-size:14px;background:var(--bg-card);color:var(--text);outline:none;" />
              <span id="zipLookupSpinner" style="display:none;position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:#888;">&#8987;</span>
            </div>
          </div>
        </div>
      </div>
      <p id="addrFeeNote" style="font-size:12px;color:var(--text-secondary);margin-top:10px;">We'll come to you at this address.</p>
      <div id="addrErrorMsg" style="display:none;background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:10px 14px;font-size:13px;color:#b91c1c;margin-top:10px;"></div>
      <div id="addrFeePreview" style="display:none;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:10px 14px;font-size:13px;color:#1d4ed8;margin-top:10px;"></div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(4)" style="flex:1">Back</button>
        <button id="addrContinueBtn" class="btn btn-primary" onclick="validateAndProceedFromAddress()" style="flex:1">Continue</button>
      </div>
    </div>

    <!-- Step 5: Add More Services/Products -->
    <div id="step-5" class="card" style="display:none">
      <h2>Add More (Optional)</h2>
      <p style="font-size:13px;color:#888;margin-bottom:12px;">Add extra services or products to your booking.</p>
      <div id="cartSummary" class="cart-items"></div>
      <div class="seg-control" id="addMoreSeg">
        <div class="seg-btn active" onclick="switchAddTab('services')">Services</div>
        <div class="seg-btn" onclick="switchAddTab('products')">Products</div>
      </div>
      <!-- Search bar -->
      <div style="position:relative;margin-bottom:12px;">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:15px;color:#aaa;">&#128269;</span>
        <input id="addMoreSearch" type="search" placeholder="Search..." oninput="onAddMoreSearch(this.value)" style="width:100%;box-sizing:border-box;padding:10px 12px 10px 36px;border:1.5px solid var(--border-input);border-radius:12px;font-size:14px;background:var(--bg-card);color:var(--text);outline:none;" />
      </div>
      <!-- Search results panel (shown when query is non-empty) -->
      <div id="addMoreSearchResults" style="display:none"></div>
      <!-- Services drill-down: level 0 = category tiles, level 1 = service list -->
      <div id="addServicePanel">
        <div id="addServiceCats"></div>
        <div id="addServiceList" style="display:none"></div>
      </div>
      <!-- Products drill-down: level 0 = brand tiles, level 1 = product list -->
      <div id="addProductPanel" style="display:none">
        <div id="addProductBrands"></div>
        <div id="addProductList" style="display:none"></div>
      </div>
      <div id="cartTotal" class="cart-total" style="display:none"></div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" onclick="goToStep(4, 5)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="goToStep(6)" style="flex:1">Continue to Payment</button>
      </div>
    </div>
    <!-- Item detail bottom sheet (shared for services + products) -->
    <div id="itemDetailOverlay" class="detail-overlay" style="display:none" onclick="closeItemDetail(event)">
      <div class="detail-sheet" id="itemDetailSheet">
        <div class="drag-handle"></div>
        <div id="itemDetailContent"></div>
      </div>
    </div>

    <!-- Step 6: Payment -->
    <div id="step-6" class="card" style="display:none">
      <h2>Payment Method</h2>
      <p style="font-size:13px;color:#888;margin-bottom:16px;">Choose how you'd like to pay, or skip and decide later.</p>
      <div id="paymentMethodList"></div>
      <div style="display:flex;gap:8px;margin-top:20px;">
        <button class="btn btn-secondary" onclick="goToStep(5)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="goToPaymentConfirm()" style="flex:1">Continue to Confirm</button>
      </div>
    </div>

    <!-- Step 7: Confirm -->
    <div id="step-7" class="card" style="display:none">
      <h2>Confirm Booking</h2>
      <div id="confirmDetails"></div>
      <div id="selectedPaymentSummary" style="margin:12px 0;"></div>
      <div class="input-group" style="margin-top:12px;">
        <label>Have a Promo Code?</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="promoCodeInput" placeholder="e.g. SUMMER20" style="flex:1;text-transform:uppercase;" oninput="this.value=this.value.toUpperCase()">
          <button class="btn btn-secondary" style="width:auto;padding:12px 16px;font-size:14px;" onclick="applyPromoCode()">Apply</button>
        </div>
        <div id="promoMsg" style="font-size:12px;margin-top:4px;"></div>
      </div>
      <div class="input-group" style="margin-top:12px;">
        <label>Notes (optional)</label>
        <textarea id="bookingNotes" placeholder="Any special requests..."></textarea>
      </div>
      <div style="margin-top:12px;">
        <button class="btn btn-secondary" onclick="goToStep(5)" style="width:100%;margin-bottom:8px;font-size:13px;">+ Add More Services / Products</button>
      </div>
      <div class="consent-row">
        <input type="checkbox" id="consentCheck" aria-label="I agree to the Terms and Privacy Policy">
        <label for="consentCheck">I agree to the <a href="/api/legal/terms" target="_blank">Terms of Service</a> and <a href="/api/legal/privacy" target="_blank">Privacy Policy</a></label>
      </div>
      <div id="bookError" class="error-msg" style="display:none"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-secondary" onclick="goToStep(6)" style="flex:1">Back</button>
        <button class="btn btn-primary" onclick="submitBooking()" id="btnSubmit" style="flex:1">Confirm Booking</button>
      </div>
    </div>

    <!-- Step 8: Success -->
    <div id="step-8" class="card" style="display:none;text-align:center;">
      <div class="success-icon">✓</div>
      <h2 style="font-size:20px;margin-bottom:8px;">Booking Submitted!</h2>
      <p style="color:#666;font-size:14px;margin-bottom:16px;">Your appointment request has been sent to ${escHtml(owner.businessName)}. They will confirm your booking shortly.</p>
      <div id="successReceipt" class="receipt-box" style="text-align:left;margin-bottom:16px;"></div>
      <div id="paymentSection" style="display:none;margin-bottom:16px;"></div>
      <!-- QR Code Modal Overlay -->
      <div id="qrModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;align-items:center;justify-content:center;" onclick="closeQrModal()">
        <div style="background:#fff;border-radius:20px;padding:28px 24px 20px;text-align:center;max-width:300px;width:90%;position:relative;" onclick="event.stopPropagation()">
          <div id="qrModalTitle" style="font-size:16px;font-weight:700;margin-bottom:4px;"></div>
          <div id="qrModalHandle" style="font-size:13px;color:#666;margin-bottom:16px;word-break:break-all;"></div>
          <div id="qrModalCanvas" style="display:flex;align-items:center;justify-content:center;margin-bottom:16px;"></div>
          <div id="qrModalHint" style="font-size:12px;color:#888;margin-bottom:16px;"></div>
          <a id="qrModalLink" href="#" target="_blank" style="display:block;padding:12px;background:#f0f0f0;border-radius:10px;font-size:14px;font-weight:600;color:#333;text-decoration:none;margin-bottom:10px;">Open App</a>
          <button onclick="closeQrModal()" style="width:100%;padding:10px;background:none;border:none;color:#888;font-size:14px;cursor:pointer;">Close</button>
        </div>
      </div>
      <div id="manageLink" style="margin-bottom:12px;display:none;">
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <a id="manageLinkHref" href="#" style="flex:1;display:inline-block;padding:10px 0;text-align:center;background:var(--bg-card);border:1.5px solid var(--border);border-radius:10px;color:var(--accent);font-size:13px;text-decoration:none;font-weight:600;">🗓️ Manage / Cancel</a>
          <a id="rescheduleHref" href="#" style="flex:1;display:inline-block;padding:10px 0;text-align:center;background:var(--accent-bg);border:1.5px solid var(--accent);border-radius:10px;color:var(--accent);font-size:13px;text-decoration:none;font-weight:600;">🔄 Request Reschedule</a>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button class="btn btn-secondary" onclick="saveReceipt()" style="flex:1">📥 Save Receipt</button>
        <button class="btn btn-secondary" onclick="addToCalendar()" style="flex:1;background:var(--accent-bg);color:var(--accent);border:1.5px solid var(--border);">📅 Add to Calendar</button>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="location.reload()" style="flex:1">Book Another</button>
      </div>
    </div>
  </div>

  <!-- Legal Footer -->
  ${(owner.instagramHandle || owner.facebookHandle || owner.tiktokHandle) ? `
  <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:20px 0 8px;">
    ${owner.instagramHandle ? `<a href="https://instagram.com/${escHtml(owner.instagramHandle)}" target="_blank" rel="noopener" title="Follow on Instagram"
      style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%);text-decoration:none;box-shadow:0 2px 8px rgba(225,48,108,0.35);transition:transform 0.15s,box-shadow 0.15s;" onmouseover="this.style.transform='scale(1.1)';this.style.boxShadow='0 4px 14px rgba(225,48,108,0.5)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 2px 8px rgba(225,48,108,0.35)'">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff" stroke="none"/></svg>
    </a>` : ""}
    ${owner.facebookHandle ? `<a href="https://facebook.com/${escHtml(owner.facebookHandle)}" target="_blank" rel="noopener" title="Follow on Facebook"
      style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:#1877F2;text-decoration:none;box-shadow:0 2px 8px rgba(24,119,242,0.35);transition:transform 0.15s,box-shadow 0.15s;" onmouseover="this.style.transform='scale(1.1)';this.style.boxShadow='0 4px 14px rgba(24,119,242,0.5)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 2px 8px rgba(24,119,242,0.35)'">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
    </a>` : ""}
    ${owner.tiktokHandle ? `<a href="https://tiktok.com/@${escHtml(owner.tiktokHandle)}" target="_blank" rel="noopener" title="Follow on TikTok"
      style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#010101 0%,#2d2d2d 100%);border:2px solid #fe2c55;text-decoration:none;box-shadow:0 2px 8px rgba(254,44,85,0.4);transition:transform 0.15s,box-shadow 0.15s;" onmouseover="this.style.transform='scale(1.1)';this.style.boxShadow='0 4px 14px rgba(254,44,85,0.6)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 2px 8px rgba(254,44,85,0.4)'">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" fill="#fe2c55"/><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" fill="#fff" opacity="0.85" transform="translate(-1.5,1.5)"/></svg>
    </a>` : ""}
  </div>` : ""}
  <div class="legal-footer" style="max-width:480px;margin:0 auto;">
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" alt="Lime Of Time" style="width:28px;height:28px;border-radius:0;object-fit:contain;background:transparent;">
      <span style="font-size:12px;font-weight:600;color:var(--text-muted);">Lime Of Time</span>
    </div>
    <a href="/api/legal/privacy" target="_blank">Privacy Policy</a>
    <a href="/api/legal/terms" target="_blank">Terms of Service</a>
    <a href="/api/legal/data-deletion" target="_blank">Data Deletion</a>
    <br><span style="margin-top:4px;display:inline-block;">&copy; ${new Date().getFullYear()} Lime Of Time. All rights reserved.</span>
  </div>

  <!-- Cookie Consent Banner -->
  <div class="cookie-banner" id="cookieBanner">
    <p>We use essential cookies to provide our booking service. By continuing, you agree to our <a href="/api/legal/privacy" target="_blank">Privacy Policy</a>.</p>
    <button onclick="acceptCookies()">Accept</button>
  </div>

  <script>
    // Cookie consent
    if (!localStorage.getItem('lot_cookie_consent')) {
      document.getElementById('cookieBanner').classList.add('show');
    }
    function acceptCookies() {
      localStorage.setItem('lot_cookie_consent', 'accepted');
      document.getElementById('cookieBanner').classList.remove('show');
    }

    const SLUG = "${slug.replace(/&/g, '\\u0026')}";
    const API = window.location.origin + "/api/public/business/" + encodeURIComponent(SLUG);
    const WEEKLY_DAYS = ${JSON.stringify(whJson)};
    const DAYS_MAP = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const CANCEL_POLICY = ${JSON.stringify(owner.cancellationPolicy || { enabled: false, hoursBeforeAppointment: 2, feePercentage: 50 })};
    const PAYMENT_METHODS = ${JSON.stringify({ zelle: (owner as any).zelleHandle || null, cashApp: (owner as any).cashAppHandle || null, venmo: (owner as any).venmoHandle || null, stripeEnabled: !!(owner as any).stripeConnectEnabled, businessOwnerId: owner.id, platformFeePercent })};
    const CATEGORY_EMOJIS_MAP = ${JSON.stringify((owner as any).categoryEmojis || {})};
    let services = [];
    let products = [];
    let discounts = [];
    let staffMembers = [];
    let locations = [];
    let customDays = {};
    let apiWeeklyDays = null; // weeklyDays from last loadWorkingDays() call (location-scoped)
    let selectedService = null;
    let selectedStaff = null;
    let selectedLocation = ${preselectedLocationId ? `"${preselectedLocationId}"` : 'null'};
    let selectedDate = null;
    let selectedTime = null;
    let appliedGift = null;
    let appliedDiscount = null; // { name, percentage }
    let appliedPromo = null; // { localId, code, label, percentage, flatAmount }
    let currentStep = 0;
    let calMonth, calYear;
    // Cart: extra items added via "Add More"
    let cart = []; // { type: 'service'|'product', id, name, price, duration }
    // Mobile service address
    let clientAddress = { street: '', city: '', state: '', zip: '' };
    // Distance (miles) calculated during address validation — used for dynamic travel fee
    let calculatedDistanceMi = null;
    // Dynamic travel fee: computed from distance × per-mile rate (overrides fixed travelFee when > 0)
    let dynamicTravelFee = null;
    function isMobileService() { return selectedService && selectedService.serviceType === 'mobile'; }
    function getClientAddressString() {
      const p = clientAddress;
      const parts = [p.street, p.city, p.state && p.zip ? p.state + ' ' + p.zip : (p.state || p.zip)].filter(Boolean);
      return parts.join(', ');
    }
    function isAddressComplete() {
      return clientAddress.street.trim() && clientAddress.city.trim() && clientAddress.state.trim() && clientAddress.zip.trim();
    }

    // Init calendar to current month
    const nowDate = new Date();
    calMonth = nowDate.getMonth();
    calYear = nowDate.getFullYear();

    // Format phone as user types
    document.getElementById("clientPhone").addEventListener("input", function(e) {
      let v = e.target.value.replace(/\\D/g, "");
      if (v.length > 10) v = v.slice(0, 10);
      if (v.length >= 7) e.target.value = "(" + v.slice(0,3) + ") " + v.slice(3,6) + "-" + v.slice(6);
      else if (v.length >= 4) e.target.value = "(" + v.slice(0,3) + ") " + v.slice(3);
      else if (v.length > 0) e.target.value = "(" + v;
      else e.target.value = "";
    });

    // Load services (optionally filtered by location)
    async function loadServices(locId) {
      try {
        const url = locId ? API + "/services?locationId=" + encodeURIComponent(locId) : API + "/services";
        const res = await fetch(url);
        services = await res.json();
        renderServices();
      } catch(e) {
        document.getElementById("serviceList").innerHTML = '<div class="error-msg">Failed to load services</div>';
      }
    }

    // Load products
    async function loadProducts() {
      try {
        const res = await fetch(API + "/products");
        products = await res.json();
      } catch(e) { products = []; }
    }

    // Load discounts
    async function loadDiscounts() {
      try {
        const res = await fetch(API + "/discounts");
        discounts = await res.json();
      } catch(e) { discounts = []; }
    }

    // Load working days (custom overrides + schedule mode), optionally scoped to a location
    var scheduleMode = "weekly";
    var businessHoursEndDate = null;
    async function loadWorkingDays(locId) {
      try {
        const url = locId ? API + "/working-days?locationId=" + encodeURIComponent(locId) : API + "/working-days";
        const res = await fetch(url);
        const data = await res.json();
        customDays = data.customDays || {};
        scheduleMode = data.scheduleMode || "weekly";
        businessHoursEndDate = data.businessHoursEndDate || null;
        // Store location-scoped weekly days so calendar uses correct working hours
        apiWeeklyDays = data.weeklyDays || null;
      } catch(e) { customDays = {}; apiWeeklyDays = null; }
    }

    // Load staff members
    async function loadStaff() {
      try {
        const res = await fetch(API + "/staff");
        staffMembers = await res.json();
      } catch(e) { staffMembers = []; }
    }

    async function loadLocations() {
      try {
        const res = await fetch(API + "/locations");
        locations = await res.json();
        locations = locations.filter(l => l.active !== false);
      } catch(e) { locations = []; }
    }

    function escText(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    var Q = "'"; // single-quote helper for onclick attribute strings
    function formatPhoneNumber(phone) {
      if (!phone) return phone;
      var digits = phone.replace(/\D/g, '');
      if (digits.length === 11 && digits.charAt(0) === '1') return '+1 (' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7);
      if (digits.length === 10) return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
      return phone;
    }

    function renderLocationSelector() {
      // Render into the new step-0 location selector
      var container = document.getElementById('locationSelectorStep0');
      if (!container) return;
      container.style.display = 'block';
      var html = '<div style="margin-bottom:16px;">';
      locations.forEach(function(loc) {
        var isSelected = selectedLocation === loc.localId;
        var borderColor = isSelected ? 'var(--accent)' : 'var(--border)';
        var bgColor = isSelected ? 'var(--bg-selected)' : 'var(--bg-card)';
        var shadow = isSelected ? '0 0 0 3px rgba(74,140,63,0.12)' : 'none';
        // Build full address: street, city, state zip
        var fullAddr = buildFullAddress(loc.address, loc.city, loc.state, loc.zipCode);
        var mapUrl = fullAddr ? 'https://maps.google.com/?q=' + encodeURIComponent(fullAddr) : '';
        var checkmark = isSelected ? '<span style="color:var(--accent);font-size:18px;font-weight:700;line-height:1;">&#10003;</span>' : '';
        html += '<div onclick="selectLocation(' + Q + loc.localId + Q + ')" style="padding:14px 16px;border:1.5px solid ' + borderColor + ';border-radius:14px;margin-bottom:8px;cursor:pointer;background:' + bgColor + ';transition:all 0.2s;box-shadow:' + shadow + ';">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">';
        html += '<div style="font-weight:600;font-size:14px;color:var(--text);">' + escText(loc.name) + '</div>';
        html += checkmark;
        html += '</div>';
        if (fullAddr) {
          html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">';
          if (mapUrl) html += '<a href="' + mapUrl + '" target="_blank" onclick="event.stopPropagation()" style="color:var(--accent);text-decoration:underline;font-size:12px;">' + escText(fullAddr) + '</a>';
          else html += escText(fullAddr);
          html += '</div>';
        } else if (loc.address) {
          html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">' + escText(loc.address) + '</div>';
        }
        if (loc.phone) html += '<div style="font-size:12px;color:var(--accent);margin-top:2px;font-weight:500;">' + escText(formatPhoneNumber(loc.phone)) + '</div>';
        html += '</div>';
      });
      html += '</div>';
      container.innerHTML = html;
    }

    function buildFullAddress(street, city, state, zip) {
      // Builds "123 Main St, New York NY, 10001" style address
      var parts = [];
      if (street && street.trim()) parts.push(street.trim());
      if (city && city.trim()) parts.push(city.trim());
      var stateZip = '';
      if (state && state.trim()) stateZip += state.trim();
      if (zip && zip.trim()) stateZip += (stateZip ? ' ' : '') + zip.trim();
      if (stateZip) parts.push(stateZip);
      return parts.join(', ');
    }

    function updateBizAddressCard() {
      var addrRow = document.getElementById('biz-address-row');
      if (!addrRow) return;
      var addr = '';
      // Use selectedLocation, or auto-pick the only location if there's just one
      var effectiveLoc = null;
      if (selectedLocation) {
        effectiveLoc = locations.find(function(l) { return l.localId === selectedLocation; });
      } else if (locations.length === 1) {
        effectiveLoc = locations[0];
      }
      if (effectiveLoc) {
        // Build full address: street, city, state zip
        addr = buildFullAddress(effectiveLoc.address, effectiveLoc.city, effectiveLoc.state, effectiveLoc.zipCode);
        if (!addr) addr = effectiveLoc.address || '';
      }
      // Only fall back to owner.address when there's a single location (or location is selected)
      if (!addr && (locations.length <= 1 || selectedLocation)) addr = ${JSON.stringify(owner.address || '')};
      if (addr) {
        addrRow.innerHTML = '<div class="biz-info-row"><span>📍</span><a href="https://maps.google.com/?q=' + encodeURIComponent(addr) + '" target="_blank" style="color:var(--accent);text-decoration:underline;">' + escText(addr) + '</a></div>';
      } else {
        addrRow.innerHTML = '';
      }
    }

    function selectLocation(locId) {
      selectedLocation = locId;
      slotCache = {}; // Clear cache when location changes
      renderLocationSelector();
      updateBizAddressCard();
      // Check if the newly selected location is temporarily closed
      checkTopLevelLocClosed();
      // Enable the Continue button when a location is selected (unless closed)
      const continueBtn = document.getElementById('locContinueBtn');
      if (continueBtn) { continueBtn.disabled = false; continueBtn.style.opacity = ''; }
      // Update the persistent location banner (will show once user advances past step 0)
      updateSelectedLocBanner();
      // Reload services and working days scoped to this location
      loadServices(locId);
      loadWorkingDays(locId).then(() => {
        // Re-render calendar with updated working days if already on date step
        if (currentStep === 4) renderCalendar();
      });
      // If a service is already selected and we're on the staff step, re-render
      if (selectedService && currentStep === 3) {
        renderStaffForService(selectedService.localId);
      }
      // Auto-advance to the next step after a brief visual confirmation delay
      // so the user sees the checkmark before moving on
      var closedBanner = document.getElementById('topLocClosedBanner');
      var locationIsClosed = closedBanner && closedBanner.classList.contains('show');
      if (!locationIsClosed) {
        setTimeout(function() { goToIntentStep(); }, 350);
      }
    }

    function getEffectiveWorkingDays() {
      // Staff hours override location hours, which override global hours
      if (selectedStaff && selectedStaff.workingHours) {
        const wh = selectedStaff.workingHours;
        const days = {};
        ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].forEach(d => {
          const entry = wh[d] || wh[d.toLowerCase()];
          days[d] = !!(entry && entry.enabled);
        });
        return days;
      }
      // Use API-fetched weeklyDays (location-scoped) if available — this is the most accurate source
      if (apiWeeklyDays) return apiWeeklyDays;
      // Fallback: derive from location's workingHours object in the locations array
      if (selectedLocation) {
        const loc = locations.find(l => l.localId === selectedLocation);
        if (loc && loc.workingHours && Object.keys(loc.workingHours).length > 0) {
          const wh = loc.workingHours;
          const days = {};
          ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].forEach(d => {
            const entry = wh[d] || wh[d.toLowerCase()];
            days[d] = !!(entry && entry.enabled);
          });
          return days;
        }
      }
      return WEEKLY_DAYS;
    }
    function isWorkingDay(dateStr) {
      // Check Active Until expiry
      if (businessHoursEndDate && dateStr > businessHoursEndDate) return false;
      if (scheduleMode === "custom") {
        // Custom mode: only dates explicitly in customDays and marked open are available
        return customDays.hasOwnProperty(dateStr) && customDays[dateStr] === true;
      }
      // Weekly mode: check custom override first, then weekly schedule
      if (customDays.hasOwnProperty(dateStr)) return customDays[dateStr];
      const d = new Date(dateStr + "T12:00:00");
      const dayName = DAYS_MAP[d.getDay()];
      return getEffectiveWorkingDays()[dayName] || false;
    }

     // ── Step 1 drill-down state ──────────────────────────────────────────
    var selectedSvcCat = null; // null = show tiles, string = show list for that cat
    var svcTypeFilter = 'all'; // 'all' | 'in_store' | 'mobile'
    function setSvcTypeFilter(type) {
      svcTypeFilter = type;
      // Update chip active states
      var chips = { all: 'svcFilterAll', in_store: 'svcFilterInStore', mobile: 'svcFilterMobile' };
      Object.keys(chips).forEach(function(k) {
        var el = document.getElementById(chips[k]);
        if (!el) return;
        var isActive = k === type;
        el.style.background = isActive ? 'var(--accent)' : 'var(--bg-card)';
        el.style.color = isActive ? '#fff' : 'var(--text-secondary)';
        el.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
      });
      // Reset drill-down state and re-render
      selectedSvcCat = null;
      document.getElementById('svcItemList').style.display = 'none';
      document.getElementById('svcSearchResults').style.display = 'none';
      renderSvcPopularRow();
      renderSvcCategoryTiles();
    }
    function getFilteredServices() {
      if (svcTypeFilter === 'mobile') return services.filter(function(s) { return s.serviceType === 'mobile'; });
      if (svcTypeFilter === 'in_store') return services.filter(function(s) { return s.serviceType !== 'mobile'; });
      return services;
    }
    function renderServices() {
      if (services.length === 0) {
        document.getElementById('svcCatGrid').innerHTML = '<div style="text-align:center;color:#888;padding:20px;">No services available</div>';
        return;
      }
      selectedSvcCat = null;
      svcTypeFilter = 'all';
      document.getElementById('svcItemList').style.display = 'none';
      document.getElementById('svcSearchResults').style.display = 'none';
      // Show filter chips only when both in-store and mobile services exist
      var hasMobile = services.some(function(s) { return s.serviceType === 'mobile'; });
      var hasInStore = services.some(function(s) { return s.serviceType !== 'mobile'; });
      var filterRow = document.getElementById('svcTypeFilterRow');
      if (filterRow) filterRow.style.display = (hasMobile && hasInStore) ? 'flex' : 'none';
      // Reset chip states to 'all' — this also calls renderSvcPopularRow + renderSvcCategoryTiles
      setSvcTypeFilter('all');
    }

    // Returns the appropriate mobile badge HTML for a service:
    // - "🚗 Free Travel" (green) if mobile with no fee configured
    // - "🚗 Mobile" (blue) if mobile with a fee configured
    // - "" if in-store
    function mobileBadgeHtml(s) {
      if (!s || s.serviceType !== 'mobile') return '';
      var hasFee = (s.travelFee && parseFloat(s.travelFee) > 0) ||
                   (s.travelRatePerMile && parseFloat(s.travelRatePerMile) > 0) ||
                   (s.minTravelFee && parseFloat(s.minTravelFee) > 0);
      if (!hasFee) {
        return ' <span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;vertical-align:middle;">🚗 Free Travel</span>';
      }
      return ' <span style="display:inline-block;background:#e0f2fe;color:#0369a1;font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;vertical-align:middle;">🚗 Mobile</span>';
    }
    function renderSvcPopularRow() {
      // Rank services by appointment count (use appointmentCount field if available, else random stable sort)
      var ranked = getFilteredServices().slice().sort(function(a, b) {
        return (b.appointmentCount || 0) - (a.appointmentCount || 0);
      });
      // Take top 5; if no counts available, take first 5 alphabetically
      var top = ranked.slice(0, 5);
      if (top.length === 0) return;
      var popularRow = document.getElementById('svcPopularRow');
      var popularList = document.getElementById('svcPopularList');
      var html = '';
      top.forEach(function(s) {
        var dur = s.duration >= 60 ? (s.duration / 60) + ' hr' + (s.duration > 60 ? 's' : '') : s.duration + ' min';
        var photoEl = s.photoUri
          ? '<img src="' + esc(s.photoUri) + '" style="width:100%;height:72px;object-fit:cover;" />'
          : '<div style="width:100%;height:72px;background:' + (s.color || '#4a8c3f') + '20;display:flex;align-items:center;justify-content:center;">' +
            '<span style="font-size:28px;font-weight:800;color:' + (s.color || '#4a8c3f') + ';opacity:0.8;">' + esc((s.name || '?')[0].toUpperCase()) + '</span></div>';
        html += '<div class="popular-card" data-svc-id="' + esc(s.localId) + '" style="' +
          'flex:0 0 auto;min-width:130px;max-width:150px;background:var(--bg-card);border:1.5px solid var(--border);' +
          'border-radius:12px;padding:0;overflow:hidden;cursor:pointer;transition:box-shadow 0.15s;">' +
          photoEl +
          '<div style="padding:8px 10px 10px;">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);line-height:1.3;margin-bottom:4px;">' + esc(s.name) +
          mobileBadgeHtml(s) + '</div>' +
          '<div style="font-size:11px;color:#888;">' + dur + '</div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--accent);margin-top:6px;">$' + parseFloat(s.price).toFixed(2) + '</div>' +
          '</div></div>';
      });
      popularList.innerHTML = html;
      popularList.querySelectorAll('.popular-card[data-svc-id]').forEach(function(card) {
        card.addEventListener('click', function() {
          openSvcDetail(card.getAttribute('data-svc-id'));
        });
      });
      popularRow.style.display = 'block';
    }

    var CATEGORY_EMOJI = {
      'all': '✨', 'hair': '✂️', 'nails': '💅', 'skin': '🌿', 'body': '💆',
      'makeup': '💄', 'waxing': '🪒', 'massage': '🙌', 'facial': '🧖',
      'lashes': '👁️', 'brows': '🪸', 'tanning': '☀️', 'teeth': '🦷',
      'spa': '🛁', 'wellness': '🌸', 'fitness': '💪', 'yoga': '🧘',
      'barber': '💈', 'color': '🎨', 'coloring': '🎨', 'styling': '💇',
      'threading': '🧵', 'piercing': '💎', 'tattoo': '🖊️', 'general': '🔖'
    };
    function getCategoryEmoji(name) {
      if (!name) return '🔖';
      // Check custom emoji map first (set by staff in the app)
      if (name !== 'all' && CATEGORY_EMOJIS_MAP && CATEGORY_EMOJIS_MAP[name]) return CATEGORY_EMOJIS_MAP[name];
      var key = name.toLowerCase().trim();
      if (CATEGORY_EMOJI[key]) return CATEGORY_EMOJI[key];
      for (var k in CATEGORY_EMOJI) {
        if (key.includes(k) || k.includes(key)) return CATEGORY_EMOJI[k];
      }
      return '🔖';
    }
        function renderSvcCategoryTiles() {
      var filteredSvcs = getFilteredServices();
      var catMap = {};
      filteredSvcs.forEach(function(s) {
        var cat = (s.category || '').trim() || 'General';
        if (!catMap[cat]) catMap[cat] = [];
        catMap[cat].push(s);
      });
      var cats = Object.keys(catMap).sort(function(a, b) {
        if (a === 'General') return 1;
        if (b === 'General') return -1;
        return a.localeCompare(b);
      });
      var grid = document.getElementById('svcCatGrid');
      var html = '';
      // All tile
      html += '<div class="tile-card tile-all" data-svc-cat="__all__">' +
        '<div class="tile-emoji">' + getCategoryEmoji('all') + '</div>' +
        '<div class="tile-name">All</div>' +
        '<div class="tile-count">' + filteredSvcs.length + '</div></div>';
      cats.forEach(function(cat) {
        var titleAttr = cat.length > 25 ? ' title="' + esc(cat) + '"' : '';
        html += '<div class="tile-card" data-svc-cat="' + esc(cat) + '"' + titleAttr + '>' +
          '<div class="tile-emoji">' + getCategoryEmoji(cat) + '</div>' +
          '<div class="tile-name">' + esc(cat) + '</div>' +
          '<div class="tile-count">' + catMap[cat].length + '</div></div>';
      });
      grid.innerHTML = html;
      grid.style.display = 'grid';
      grid.querySelectorAll('.tile-card[data-svc-cat]').forEach(function(el) {
        el.addEventListener('click', function() {
          drillIntoSvcCategory(el.getAttribute('data-svc-cat'));
        });
      });
    }

    function drillIntoSvcCategory(cat) {
      selectedSvcCat = cat;
      var baseList = getFilteredServices();
      var filtered = cat === '__all__' ? baseList : baseList.filter(function(s) {
        return ((s.category || '').trim() || 'General') === cat;
      });
      var listEl = document.getElementById('svcItemList');
      var catLabel = cat === '__all__' ? 'All Services' : cat;
      var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
        '<button onclick="resetSvcDrillDown()" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--accent);font-weight:600;padding:0;">&#8592; ' + esc(catLabel) + '</button></div>';
      html += '<div class="service-list">';
      filtered.forEach(function(s) {
        var dur = s.duration >= 60 ? (s.duration / 60) + ' hr' + (s.duration > 60 ? 's' : '') : s.duration + ' min';
        var svcThumb = s.photoUri
          ? '<div class="service-dot"><img src="' + esc(s.photoUri) + '" /></div>'
          : '<div class="service-dot" style="background:' + (s.color || '#4a8c3f') + '20;color:' + (s.color || '#4a8c3f') + ';">' + esc((s.name||'?')[0].toUpperCase()) + '</div>';
        html += '<div class="service-item" data-svc-id="' + esc(s.localId) + '">' +
          svcThumb +
          '<div class="service-info"><div class="service-name">' + esc(s.name) +
          mobileBadgeHtml(s) + '</div>' +
          '<div class="service-meta">' + dur + '</div></div>' +
          '<div class="service-price">$' + parseFloat(s.price).toFixed(2) + '</div></div>';
      });
      html += '</div>';
      listEl.innerHTML = html;
      listEl.style.display = 'block';
      document.getElementById('svcCatGrid').style.display = 'none';
      listEl.querySelectorAll('.service-item[data-svc-id]').forEach(function(item) {
        item.addEventListener('click', function() {
          openSvcDetail(item.getAttribute('data-svc-id'));
        });
      });
    }

    function resetSvcDrillDown() {
      selectedSvcCat = null;
      document.getElementById('svcItemList').style.display = 'none';
      document.getElementById('svcCatGrid').style.display = 'grid';
    }

    function openSvcDetail(id) {
      var s = services.find(function(x) { return x.localId === id; });
      if (!s) return;
      var dur = s.duration >= 60 ? (s.duration / 60) + ' hr' + (s.duration > 60 ? 's' : '') : s.duration + ' min';
      var isSelected = selectedService && selectedService.localId === id;
      var html = '';
      if (s.photoUri) html += '<img src="' + esc(s.photoUri) + '" style="width:100%;height:180px;object-fit:cover;border-radius:12px;margin-bottom:14px;">';
      html += '<div style="display:inline-block;background:var(--accent-bg-light);color:var(--accent);font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:8px;">' + esc((s.category || 'General').trim() || 'General') + '</div>' +
        (s.serviceType === 'mobile' ? ' ' + mobileBadgeHtml(s).replace('font-size:9px', 'font-size:11px').replace('padding:1px 6px', 'padding:3px 10px') : '');
      html += '<div class="detail-name">' + esc(s.name) + '</div>';
      html += '<div class="detail-price">$' + parseFloat(s.price).toFixed(2) + '</div>';
      html += '<div class="detail-meta">' + dur + '</div>';
      if (s.description) html += '<div class="detail-desc">' + esc(s.description) + '</div>';
      if (isSelected) {
        html += '<button class="detail-add-btn" style="background:#e5f0e3;color:#2d5a27;" onclick="deselectSvc();closeSvcDetail()">&#10003; Selected &#8212; Deselect</button>';
      } else {
        html += '<button class="detail-add-btn" onclick="selectService(' + Q + id + Q + ');closeSvcDetail()">Select This Service</button>';
      }
      html += '<button class="detail-dismiss" onclick="closeSvcDetail()">Close</button>';
      document.getElementById('svcDetailContent').innerHTML = html;
      document.getElementById('svcDetailOverlay').style.display = 'flex';
    }

    function closeSvcDetail() {
      document.getElementById('svcDetailOverlay').style.display = 'none';
    }

    function deselectSvc() {
      selectedService = null;
      document.getElementById('btnToStaff').disabled = true;
      document.getElementById('svcSelectedSummary').style.display = 'none';
    }

    function onSvcSearch(query) {
      var q = query.trim().toLowerCase();
      var resultsEl = document.getElementById('svcSearchResults');
      var catGrid = document.getElementById('svcCatGrid');
      var listEl = document.getElementById('svcItemList');
      if (!q) {
        resultsEl.style.display = 'none';
        if (selectedSvcCat) {
          listEl.style.display = 'block';
        } else {
          catGrid.style.display = 'grid';
          listEl.style.display = 'none';
        }
        return;
      }
      catGrid.style.display = 'none';
      listEl.style.display = 'none';
      var matches = getFilteredServices().filter(function(s) {
        return s.name.toLowerCase().includes(q) ||
          (s.category || '').toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q);
      });
      if (matches.length === 0) {
        resultsEl.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">No services found</div>';
      } else {
        var html = '<div class="service-list">';
        matches.forEach(function(s) {
          var dur = s.duration >= 60 ? (s.duration / 60) + ' hr' + (s.duration > 60 ? 's' : '') : s.duration + ' min';
          var svcThumbS = s.photoUri
            ? '<div class="service-dot"><img src="' + esc(s.photoUri) + '" /></div>'
            : '<div class="service-dot" style="background:' + (s.color || '#4a8c3f') + '20;color:' + (s.color || '#4a8c3f') + ';">' + esc((s.name||'?')[0].toUpperCase()) + '</div>';
          html += '<div class="service-item" data-svc-id="' + esc(s.localId) + '">' +
            svcThumbS +
            '<div class="service-info"><div class="service-name">' + esc(s.name) +
            mobileBadgeHtml(s) + '</div>' +
            '<div class="service-meta">' + dur + (s.category ? ' · ' + esc(s.category) : '') + '</div></div>' +
            '<div class="service-price">$' + parseFloat(s.price).toFixed(2) + '</div></div>';
        });
        html += '</div>';
        resultsEl.innerHTML = html;
        resultsEl.querySelectorAll('.service-item[data-svc-id]').forEach(function(item) {
          item.addEventListener('click', function() {
            openSvcDetail(item.getAttribute('data-svc-id'));
          });
        });
      }
      resultsEl.style.display = 'block';
    }

    function selectService(id) {
      selectedService = services.find(function(s) { return s.localId === id; });
      selectedStaff = null;
      document.getElementById('btnToStaff').disabled = false;
      // Show selected service summary banner
      var summaryEl = document.getElementById('svcSelectedSummary');
      if (selectedService) {
        var dur = selectedService.duration >= 60
          ? (selectedService.duration / 60) + ' hr' + (selectedService.duration > 60 ? 's' : '')
          : selectedService.duration + ' min';
        summaryEl.innerHTML = '&#10003; ' + esc(selectedService.name) + ' &mdash; $' + parseFloat(selectedService.price).toFixed(2) + ' &middot; ' + dur;
        summaryEl.style.display = 'block';
      } else {
        summaryEl.style.display = 'none';
      }
      // Show staff selection for this service
      renderStaffForService(id);
    }

    function renderStaffStep() {
      if (selectedService) renderStaffForService(selectedService.localId);
    }
    function renderStaffForService(serviceId) {
      const list = document.getElementById("staffListStep3");
      if (!list) return;
      // Filter staff who can perform this service AND are assigned to the selected location
      const eligible = staffMembers.filter(s => {
        const canDoService = s.serviceIds.length === 0 || s.serviceIds.includes(serviceId);
        if (!canDoService) return false;
        if (!selectedLocation) return true;
        if (!s.locationIds) return true;
        return s.locationIds.includes(selectedLocation);
      });
      // "Any available" option + eligible staff
      let html = '<div class="service-item selected" id="staff-any" onclick="selectStaff(null)">' +
        '<div class="service-dot" style="background:#88888820;color:#888;border-radius:50%;">&#128100;</div>' +
        '<div class="service-info"><div class="service-name">Any Available</div>' +
        '<div class="service-meta">First available staff member</div></div>' +
        '<span class="staff-avail-dot" id="avail-staff-any" style="width:9px;height:9px;border-radius:50%;background:#22c55e;display:inline-block;margin-left:auto;flex-shrink:0;"></span>' +
        '</div>';
      eligible.forEach(s => {
        var staffAvatar = s.photoUri
          ? '<div class="service-dot" style="padding:0;overflow:hidden;border-radius:50%;"><img src="' + esc(s.photoUri) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" /></div>'
          : '<div class="service-dot" style="background:' + (s.color || '#6366f1') + '20;color:' + (s.color || '#6366f1') + ';border-radius:50%;">' + esc((s.name||'?')[0].toUpperCase()) + '</div>';
        html += '<div class="service-item" id="staff-' + s.localId + '" onclick="selectStaff(&apos;' + s.localId + '&apos;)">' +
          staffAvatar +
          '<div class="service-info"><div class="service-name">' + esc(s.name) + '</div>' +
          '<div class="service-meta">' + esc(s.role || 'Staff') + '</div></div>' +
          '<span class="staff-avail-dot" id="avail-staff-' + s.localId + '" style="width:9px;height:9px;border-radius:50%;background:#d1d5db;display:inline-block;margin-left:auto;flex-shrink:0;" title="Checking availability..."></span>' +
          '</div>';
      });
      list.innerHTML = html;
      // Check availability for each staff member (using today or first available date)
      checkStaffAvailability(eligible);
    }
    async function checkStaffAvailability(eligible) {
      // Use the next 7 days to check if each staff member has any availability
      const today = new Date();
      const todayStr = today.toLocaleDateString('en-CA');
      const dur = selectedService ? selectedService.duration : 60;
      const locParam = selectedLocation ? '&locationId=' + encodeURIComponent(selectedLocation) : '';
      const nowMinutes = today.getHours() * 60 + today.getMinutes();
      const clientToday = todayStr;
      // Check availability for each staff member over the next 14 days
      const checkDates = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(today); d.setDate(d.getDate() + i);
        checkDates.push(d.toLocaleDateString('en-CA'));
      }
      for (const s of eligible) {
        let hasSlots = false;
        for (const ds of checkDates) {
          try {
            const r = await fetch(API + '/slots?date=' + ds + '&duration=' + dur + '&staffId=' + encodeURIComponent(s.localId) + locParam + '&clientToday=' + encodeURIComponent(clientToday) + '&nowMinutes=' + nowMinutes);
            const data = await r.json();
            if (data.slots && data.slots.length > 0) { hasSlots = true; break; }
          } catch(e) {}
        }
        const dot = document.getElementById('avail-staff-' + s.localId);
        if (dot) {
          dot.style.background = hasSlots ? '#22c55e' : '#d1d5db';
          dot.title = hasSlots ? 'Available' : 'No upcoming availability';
        }
      }
    }
    function skipStaffSelection() {
      selectedStaff = null;
      slotCache = {};
      goToStep(4);
    }
    function selectStaff(id) {
      selectedStaff = id ? staffMembers.find(s => s.localId === id) : null;
      slotCache = {}; // Clear cache when staff changes
      document.querySelectorAll("#staffListStep3 .service-item").forEach(el => el.classList.remove("selected"));
      const el = document.getElementById(id ? "staff-" + id : "staff-any");
      if (el) el.classList.add("selected");
      // Auto-advance to Date step after a short visual confirmation delay
      setTimeout(function() { goToStep(4); }, 350);
    }

    var selectedPaymentMethod = null; // 'zelle' | 'venmo' | 'cashapp' | 'cash'
    var paymentConfirmationNumber = ''; // confirmation/transaction ref for Zelle/Venmo/CashApp

    function updateSelectedLocBanner() {
      const banner = document.getElementById('selectedLocBanner');
      const nameEl = document.getElementById('selectedLocName');
      if (!banner || !nameEl) return;
      if (selectedLocation && currentStep >= 1 && currentStep <= 7) {
        const loc = locations.find(function(l) { return l.localId === selectedLocation; });
        if (loc) {
          nameEl.textContent = loc.name;
          banner.classList.add('show');
          return;
        }
      }
      banner.classList.remove('show');
    }
    function goToIntentStep() {
      if (!selectedLocation) { alert("Please select a location"); return; }
      for (let i = 0; i <= 8; i++) {
        const el = document.getElementById("step-" + i);
        if (el) el.style.display = "none";
      }
      const intentEl = document.getElementById("step-intent");
      if (intentEl) intentEl.style.display = "block";
      // Reset step dots
      for (let i = 0; i < 8; i++) {
        const dot = document.getElementById("dot-" + i);
        if (dot) dot.className = "step-dot";
        const item = document.getElementById("step-item-" + i);
        if (item) item.className = "step-item";
      }
      updateSelectedLocBanner();
      window.scrollTo(0, 0);
    }
    // Navigate to the normal booking flow with the selected location pre-filled
    function bookForMyself() {
      if (!selectedLocation) { alert("Please select a location"); return; }
      window.location.href = '/api/book/${slug}?location=' + encodeURIComponent(selectedLocation) + '&intent=book';
    }
    // Navigate to the gift purchase page with the selected location
    function buyGiftIntent() {
      if (!selectedLocation) { alert("Please select a location"); return; }
      window.location.href = '/api/buy-gift/${slug}?location=' + encodeURIComponent(selectedLocation);
    }
    function goToStep(step, fromStep) {
      if (step === 1 && !selectedLocation) { alert("Please select a location"); return; }
      if (step === 2 && (fromStep === 1 || currentStep === 1)) {
        const name = document.getElementById("clientName").value.trim();
        if (!name) { alert("Please enter your name"); return; }
      }
      if (step === 3 && !selectedService) { alert("Please select a service"); return; }
      // step 3 = staff (optional, always allowed)
      if (step === 5 && (!selectedDate || !selectedTime)) { alert("Please select a date and time"); return; }
      // For mobile services: intercept step 5 (Extras) to show address step first
      if (step === 5 && isMobileService() && (fromStep === 4 || currentStep === 4)) {
        // Go to address step instead
        _showStep('4b');
        return;
      }
      // For mobile services going back from step 5: go to address step
      if (step === 4 && isMobileService() && (fromStep === 5 || currentStep === 5)) {
        _showStep('4b');
        return;
      }
      _showStep(step);
    }
    function _showStep(step) {
      // Hide all steps (0-8 + 4b)
      for (let i = 0; i <= 8; i++) {
        const el = document.getElementById("step-" + i);
        if (el) el.style.display = "none";
      }
      const addrEl = document.getElementById("step-4b");
      if (addrEl) addrEl.style.display = "none";
      const stepEl = document.getElementById("step-" + step);
      if (stepEl) stepEl.style.display = "block";
      currentStep = step;
      // Update step indicators (treat 4b as between 4 and 5)
      const stepNum = step === '4b' ? 4.5 : Number(step);
      for (let i = 0; i < 8; i++) {
        const dot = document.getElementById("dot-" + i);
        if (dot) dot.className = "step-dot" + (i < stepNum ? " done" : i === Math.floor(stepNum) ? " active" : "");
        const item = document.getElementById("step-item-" + i);
        if (item) item.className = "step-item" + (i < stepNum ? " done" : i === Math.floor(stepNum) ? " active" : "");
      }
      updateSelectedLocBanner();
      if (step === 3) renderStaffStep();
      if (step === 4) renderCalendar();
      if (step === '4b') {
        renderMobileServiceInfo();
        // Reset fee preview state so it shows fresh on each visit
        var feePreview = document.getElementById('addrFeePreview');
        var addrBtn = document.getElementById('addrContinueBtn');
        var addrNote = document.getElementById('addrFeeNote');
        if (feePreview) { feePreview.style.display = 'none'; feePreview.dataset.confirmed = ''; }
        if (addrBtn) addrBtn.textContent = 'Continue';
        if (addrNote) addrNote.style.display = 'block';
        dynamicTravelFee = null;
        calculatedDistanceMi = null;
      }
      if (step === 5) initAddMoreStep();
      if (step === 6) renderPaymentStep();
      if (step === 7) renderConfirmation();
      window.scrollTo(0, 0);
    }
    // Haversine formula: returns distance in miles between two lat/lng points
    function haversineDistance(lat1, lon1, lat2, lon2) {
      var R = 3958.8;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    async function getZipCoords(zip) {
      try {
        var r = await fetch('https://api.zippopotam.us/us/' + encodeURIComponent(zip.replace(/\s/g, '')));
        if (!r.ok) return null;
        var d = await r.json();
        if (d && d.places && d.places.length > 0) {
          return { lat: parseFloat(d.places[0].latitude), lon: parseFloat(d.places[0].longitude), city: d.places[0]['place name'], state: d.places[0]['state abbreviation'] };
        }
      } catch(e) {}
      return null;
    }
    // ── US state name → abbreviation lookup ─────────────────────
    var stateAbbreviations = {
      'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
      'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
      'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
      'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
      'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
      'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
      'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
      'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
      'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
      'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
      'District of Columbia':'DC'
    };
    // ── Street address autocomplete (Nominatim / OpenStreetMap) ──────────
    var _addrSuggestTimer = null;
    var _addrSuggestAbort = null;
    var _addrSuggestQuery = '';
    // Bolds portions of text that match any word in query
    function highlightMatch(text, query) {
      if (!text || !query) return esc(text);
      var words = query.trim().split(/\s+/).filter(function(w) { return w.length >= 2; });
      if (!words.length) return esc(text);
      var result = esc(text);
      words.forEach(function(word) {
        var safeWord = word.replace(/[-.*+?^$()|\\]/g, '\\$&');
        var re = new RegExp('(' + safeWord + ')', 'gi');
        result = result.replace(re, '<strong style="color:var(--text);">$1</strong>');
      });
      return result;
    }
    function onAddrStreetInput(val) {
      _addrSuggestQuery = val;
      var box = document.getElementById('addrSuggestBox');
      if (!box) return;
      if (_addrSuggestTimer) clearTimeout(_addrSuggestTimer);
      if (!val || val.length < 4) { box.style.display = 'none'; return; }
      _addrSuggestTimer = setTimeout(async function() {
        try {
          if (_addrSuggestAbort) _addrSuggestAbort.abort();
          _addrSuggestAbort = new AbortController();
          var url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=us&q=' + encodeURIComponent(val);
          var res = await fetch(url, { signal: _addrSuggestAbort.signal, headers: { 'Accept-Language': 'en' } });
          var data = await res.json();
          if (!data || data.length === 0) { box.style.display = 'none'; return; }
          box.innerHTML = data.map(function(item, i) {
            var a = item.address || {};
            var street = (a.house_number ? a.house_number + ' ' : '') + (a.road || '');
            var city = a.city || a.town || a.village || a.county || '';
            var state = a.state || '';
            var zip = a.postcode || '';
            var display = item.display_name;
            var q = _addrSuggestQuery;
            var streetLabel = street || display.split(',')[0];
            var subLabel = [city, state, zip].filter(Boolean).join(', ');
            return '<div data-idx="' + i + '" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);" ' +
              'onmousedown="selectAddrSuggestion(' + JSON.stringify(street) + ',' + JSON.stringify(city) + ',' + JSON.stringify(state) + ',' + JSON.stringify(zip) + ')">' +
              '<div style="font-weight:600;">' + highlightMatch(streetLabel, q) + '</div>' +
              '<div style="font-size:11px;color:#888;margin-top:2px;">' + highlightMatch(subLabel, q) + '</div>' +
              '</div>';
          }).join('');
          box.style.display = 'block';
        } catch(e) {
          if (e.name !== 'AbortError') box.style.display = 'none';
        }
      }, 350);
    }
    function selectAddrSuggestion(street, city, state, zip) {
      var streetEl = document.getElementById('addrStreet');
      var cityEl = document.getElementById('addrCity');
      var stateEl = document.getElementById('addrState');
      var zipEl = document.getElementById('addrZip');
      var box = document.getElementById('addrSuggestBox');
      if (streetEl && street) { streetEl.value = street; clientAddress.street = street; }
      if (cityEl && city) { cityEl.value = city; clientAddress.city = city; }
      if (stateEl && state) {
        var abbr = state.length === 2 ? state.toUpperCase() : (stateAbbreviations[state] || state.substring(0,2).toUpperCase());
        stateEl.value = abbr; clientAddress.state = abbr;
      }
      if (zipEl && zip) { zipEl.value = zip; clientAddress.zip = zip; autoFillStateFromZip(zip); }
      if (box) box.style.display = 'none';
    }
    // Close suggestions when clicking outside
    document.addEventListener('click', function(e) {
      var box = document.getElementById('addrSuggestBox');
      if (box && !box.contains(e.target) && e.target.id !== 'addrStreet') box.style.display = 'none';
    });
    function showAddrError(msg) {
      var el = document.getElementById('addrErrorMsg');
      if (!el) return;
      el.textContent = msg;
      el.style.display = msg ? 'block' : 'none';
    }
    async function autoFillStateFromZip(zip) {
      var clean = zip.replace(/\D/g, '');
      if (clean.length !== 5) return;
      var spinner = document.getElementById('zipLookupSpinner');
      if (spinner) spinner.style.display = 'inline';
      try {
        var r = await fetch('https://api.zippopotam.us/us/' + clean);
        if (r.ok) {
          var d = await r.json();
          if (d && d.places && d.places.length > 0) {
            var place = d.places[0];
            var stateEl = document.getElementById('addrState');
            var cityEl = document.getElementById('addrCity');
            if (stateEl && !stateEl.value.trim()) {
              stateEl.value = place['state abbreviation'] || '';
              clientAddress.state = stateEl.value;
            }
            if (cityEl && !cityEl.value.trim()) {
              cityEl.value = place['place name'] || '';
              clientAddress.city = cityEl.value;
            }
          }
        }
      } catch(e) {}
      if (spinner) spinner.style.display = 'none';
    }
    function showFeePreview(fee, distMi) {
      var el = document.getElementById('addrFeePreview');
      var note = document.getElementById('addrFeeNote');
      if (!el) return;
      if (fee != null && fee > 0) {
        var distText = distMi != null ? ' (' + Math.round(distMi) + ' mi)' : '';
        el.textContent = '\uD83D\uDE97 Estimated Travel Fee: $' + fee.toFixed(2) + distText;
        el.style.display = 'block';
        if (note) note.style.display = 'none';
      } else {
        el.style.display = 'none';
        if (note) note.style.display = 'block';
      }
    }
    async function validateAndProceedFromAddress() {
      if (!isAddressComplete()) {
        showAddrError('Please fill in all address fields (Street, City, State, ZIP Code).');
        return;
      }
      showAddrError('');
      // Check if this service has any travel fee configuration
      var hasFeeConfig = selectedService && (
        (selectedService.travelFee && parseFloat(selectedService.travelFee) > 0) ||
        (selectedService.travelRatePerMile && parseFloat(selectedService.travelRatePerMile) > 0) ||
        (selectedService.minTravelFee && parseFloat(selectedService.minTravelFee) > 0)
      );
      // If service has a maxTravelDistance or fee config, do ZIP distance lookup
      var needsDistanceLookup = selectedService && (
        (selectedService.maxTravelDistance && parseFloat(selectedService.maxTravelDistance) > 0) ||
        hasFeeConfig
      );
      if (needsDistanceLookup) {
        var clientZip = clientAddress.zip.trim();
        var businessZip = null;
        var loc = selectedLocation ? locations.find(function(l) { return l.localId === selectedLocation; }) : (locations.length > 0 ? locations[0] : null);
        if (loc) businessZip = loc.zipCode || null;
        if (businessZip && clientZip) {
          var btn = document.getElementById('addrContinueBtn');
          if (btn) { btn.disabled = true; btn.textContent = 'Checking distance\u2026'; }
          var results = await Promise.all([getZipCoords(businessZip), getZipCoords(clientZip)]);
          var bizCoords = results[0], clientCoords = results[1];
          if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
          if (!clientCoords) {
            showAddrError('We could not verify your ZIP code. Please double-check and try again.');
            return;
          }
          if (bizCoords) {
            var dist = haversineDistance(bizCoords.lat, bizCoords.lon, clientCoords.lat, clientCoords.lon);
            calculatedDistanceMi = dist; // store for dynamic fee & arrival window
            var maxDist = selectedService.maxTravelDistance ? parseFloat(selectedService.maxTravelDistance) : null;
            if (maxDist && dist > maxDist) {
              showAddrError('Sorry, your address (' + clientCoords.city + ', ' + clientCoords.state + ') is approximately ' + Math.round(dist) + ' miles away \u2014 outside our ' + maxDist + '-mile service radius. Please contact us to check availability.');
              return;
            }
            if (hasFeeConfig) {
              // Compute dynamic travel fee using per-service rate (or IRS default $0.67/mi), round-trip
              var fixedFee = selectedService.travelFee ? parseFloat(selectedService.travelFee) : 0;
              var ratePerMile = selectedService.travelRatePerMile ? parseFloat(selectedService.travelRatePerMile) : 0.67;
              var distFee = Math.round(dist * 2 * ratePerMile * 100) / 100; // round-trip
              var minFee = selectedService.minTravelFee ? parseFloat(selectedService.minTravelFee) : 0;
              dynamicTravelFee = Math.max(fixedFee, distFee, minFee);
              showFeePreview(dynamicTravelFee, dist);
            } else {
              dynamicTravelFee = null;
              showFeePreview(null, null);
            }
          } else {
            calculatedDistanceMi = null;
            if (hasFeeConfig) {
              var fallbackFee = selectedService.travelFee ? parseFloat(selectedService.travelFee) : 0;
              var fallbackMin = selectedService.minTravelFee ? parseFloat(selectedService.minTravelFee) : 0;
              var fallbackResult = Math.max(fallbackFee, fallbackMin);
              dynamicTravelFee = fallbackResult > 0 ? fallbackResult : null;
              showFeePreview(dynamicTravelFee, null);
            } else {
              dynamicTravelFee = null;
              showFeePreview(null, null);
            }
          }
          // If fee preview is shown, pause so user sees it; second tap proceeds
          if (dynamicTravelFee != null && dynamicTravelFee > 0) {
            var preview = document.getElementById('addrFeePreview');
            var continueBtn = document.getElementById('addrContinueBtn');
            if (preview && preview.dataset.confirmed === '1') {
              // Second tap — proceed
              _showStep(5);
            } else {
              // First tap — show preview and update button
              if (preview) preview.dataset.confirmed = '1';
              if (continueBtn) continueBtn.textContent = 'Confirm & Continue';
              return;
            }
          } else {
            _showStep(5);
          }
          return;
        }
      }
      // No fee config and no distance check needed — proceed directly
      dynamicTravelFee = null;
      _showStep(5);
    }
    function renderMobileServiceInfo() {
      const el = document.getElementById('mobileServiceInfo');
      if (!el || !selectedService) return;
      let html = '<div style="font-weight:600;margin-bottom:4px;">🚗 ' + esc(selectedService.name) + ' — Mobile Service</div>';
      if (selectedService.travelDuration) {
        html += '<div style="color:var(--text-secondary);font-size:12px;">Travel time: ~' + selectedService.travelDuration + ' min each way (added to your appointment slot)</div>';
      }
      if (selectedService.travelFee && parseFloat(selectedService.travelFee) > 0) {
        html += '<div style="color:var(--text-secondary);font-size:12px;">Travel fee: $' + parseFloat(selectedService.travelFee).toFixed(2) + ' (included in total)</div>';
      }
      if (selectedService.maxTravelDistance) {
        html += '<div style="color:var(--text-secondary);font-size:12px;">Service radius: up to ' + selectedService.maxTravelDistance + ' miles</div>';
      }
      el.innerHTML = html;
    }
    function renderPaymentStep() {
      const methods = PAYMENT_METHODS;
      const chargedPrice = getChargedPrice();
      const amountStr = chargedPrice > 0 ? '$' + chargedPrice.toFixed(2) : 'Free';
      let html = '<div style="margin-bottom:8px;font-size:13px;color:#888;">Amount due: <strong style="color:var(--text);">' + amountStr + '</strong></div>';
      html += '<div style="display:flex;flex-direction:column;gap:10px;">';
      const opts = [];
      if (methods.zelle) opts.push({ id: 'zelle', label: '💜 Zelle', sub: methods.zelle, color: '#6d28d9' });
      if (methods.cashApp) opts.push({ id: 'cashapp', label: '💚 Cash App', sub: methods.cashApp.startsWith('$') ? methods.cashApp : '$' + methods.cashApp, color: '#00d632' });
      if (methods.venmo) opts.push({ id: 'venmo', label: '💙 Venmo', sub: methods.venmo.startsWith('@') ? methods.venmo : '@' + methods.venmo, color: '#3d95ce' });
      const feeLabel = methods.platformFeePercent ? methods.platformFeePercent.toFixed(1) + '%' : '1.5%';
      if (methods.stripeEnabled && chargedPrice > 0) opts.push({ id: 'card', label: '💳 Pay by Card', sub: 'Visa, Mastercard, Apple Pay, Google Pay — secure checkout via Stripe. A ' + feeLabel + ' platform processing fee will be added at checkout.', color: '#635bff' });
      opts.push({ id: 'cash', label: '💵 Cash', sub: 'Pay in person at the time of your appointment', color: '#888' });
      opts.push({ id: 'later', label: '⏭️ Skip for now', sub: "I'll decide later — you can discuss payment when you arrive", color: '#94a3b8' });
      opts.forEach(function(opt) {
        const isSelected = selectedPaymentMethod === opt.id;
        html += '<div onclick="selectPaymentMethod(&apos;' + opt.id + '&apos;)" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;border:2px solid ' + (isSelected ? opt.color : 'var(--border-input)') + ';background:' + (isSelected ? opt.color + '12' : 'var(--bg-card)') + ';cursor:pointer;transition:all .15s;">';
        html += '<div style="font-size:22px;">' + opt.label.split(' ')[0] + '</div>';
        html += '<div style="flex:1;"><div style="font-weight:600;font-size:14px;color:var(--text);">' + opt.label.slice(opt.label.indexOf(' ')+1) + '</div><div style="font-size:12px;color:#888;margin-top:2px;">' + opt.sub + '</div></div>';
        if (isSelected) html += '<div style="width:20px;height:20px;border-radius:50%;background:' + opt.color + ';display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:12px;">✓</span></div>';
        html += '</div>';
      });
      html += '</div>';
      if (['zelle','venmo','cashapp'].includes(selectedPaymentMethod)) {
        const pmHints = { zelle: 'Phone or email you sent from', venmo: '@username or transaction ID', cashapp: '$cashtag or transaction ID' };
        const pmLabels2 = { zelle: '💜 Zelle Confirmation', venmo: '💙 Venmo Confirmation', cashapp: '💚 Cash App Confirmation' };
        const pmDescs = { zelle: 'Enter the phone number or email address you used to send the Zelle payment.', venmo: 'Enter the @username you sent to, or copy the transaction ID from the Venmo app.', cashapp: 'Enter the $cashtag you sent to, or copy the transaction ID from the Cash App.' };
        html += '<div style="margin-top:12px;padding:14px;border-radius:12px;background:var(--bg-card);border:1.5px solid var(--border-input);">';
        html += '<div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:8px;">' + (pmLabels2[selectedPaymentMethod] || 'Payment Confirmation') + '</div>';
        html += '<input type="text" id="paymentConfirmInput" placeholder="' + (pmHints[selectedPaymentMethod] || 'Transaction reference') + '" value="' + paymentConfirmationNumber.replace(/"/g, '&quot;') + '" oninput="paymentConfirmationNumber=this.value" style="width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid var(--border-input);background:var(--bg-input);color:var(--text);font-size:14px;box-sizing:border-box;" autocomplete="off" autocapitalize="none" autocorrect="off">';
        html += '<div style="font-size:11px;color:#888;margin-top:6px;line-height:1.5;">' + (pmDescs[selectedPaymentMethod] || '') + '</div>';
        html += '</div>';
      }
      document.getElementById('paymentMethodList').innerHTML = html;
      document.getElementById('paymentMethodError').style.display = 'none';
      // Restore focus to confirmation input if it was just re-rendered
      if (['zelle','venmo','cashapp'].includes(selectedPaymentMethod)) {
        const inp = document.getElementById('paymentConfirmInput');
        if (inp && document.activeElement !== inp) { /* don't steal focus */ }
      }
    }

    function selectPaymentMethod(id) {
      selectedPaymentMethod = id;
      paymentConfirmationNumber = ''; // reset on method change
      renderPaymentStep();
    }

    function goToPaymentConfirm() {
      // Allow proceeding without a selection — treat as "pay later"
      if (!selectedPaymentMethod) {
        selectedPaymentMethod = 'later';
      }
      goToStep(7);
    }

    // ── Monthly Calendar ──
    function changeMonth(delta) {
      calMonth += delta;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      if (calMonth < 0) { calMonth = 11; calYear--; }
      // Don't go before current month
      const now = new Date();
      if (calYear < now.getFullYear() || (calYear === now.getFullYear() && calMonth < now.getMonth())) {
        calMonth = now.getMonth(); calYear = now.getFullYear();
      }
      renderCalendar();
    }

    // Cache for slot availability per date
    let slotCache = {};

    function renderCalendar() {
      const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      document.getElementById("calTitle").textContent = months[calMonth] + " " + calYear;

      // Disable prev button if current month
      const now = new Date();
      document.getElementById("calPrev").disabled = (calYear === now.getFullYear() && calMonth === now.getMonth());

      const grid = document.getElementById("calGrid");
      const firstDay = new Date(calYear, calMonth, 1).getDay();
      const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
      const todayStr = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");

      // Check if selected location is temporarily closed
      const selLoc = selectedLocation ? locations.find(l => l.localId === selectedLocation) : null;
      const locTempClosed = selLoc ? !!selLoc.temporarilyClosed : false;

      // Show/hide the temporarily closed banner
      const closedBannerEl = document.getElementById("locClosedBanner");
      const closedMsgEl = document.getElementById("locClosedMsg");
      if (closedBannerEl && closedMsgEl) {
        if (locTempClosed) {
          const reopenOn = selLoc && selLoc.reopenOn ? selLoc.reopenOn : null;
          let msg = "";
          if (reopenOn) {
            const d = new Date(reopenOn + "T00:00:00");
            const formatted = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
            msg = selLoc.name + " is temporarily closed and will reopen on " + formatted + ". No new bookings are being accepted until then.";
          } else {
            msg = (selLoc ? selLoc.name : "This location") + " is temporarily closed for an indefinite period. No new bookings are being accepted at this time. Please check back later.";
          }
          closedMsgEl.textContent = msg;
          closedBannerEl.classList.add("show");
        } else {
          closedBannerEl.classList.remove("show");
        }
      }

      let html = "";
      let workingDates = [];
      // Empty cells before first day
      for (let i = 0; i < firstDay; i++) {
        html += '<div class="cal-day empty"></div>';
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const ds = calYear + "-" + String(calMonth+1).padStart(2,"0") + "-" + String(day).padStart(2,"0");
        const isPast = ds < todayStr;
        const isWorking = isWorkingDay(ds);
        const isSelected = ds === selectedDate;
        const isToday = ds === todayStr;
        // If location is temporarily closed, all future days are red and unclickable
        if (locTempClosed && !isPast) {
          let cls = "cal-day temp-closed";
          if (isSelected) cls += " selected";
          html += '<div class="' + cls + '" id="day-' + ds + '" data-date="' + ds + '"><span>' + day + '</span></div>';
          continue;
        }
        // Initially disable all non-working and past days; working days start as loading
        const isDisabled = isPast || !isWorking;
        let cls = "cal-day";
        if (isDisabled) cls += " disabled";
        if (isSelected) cls += " selected";
        if (isToday && !isDisabled) cls += " today";
        // Working future days get a data-loading attribute, will be updated after slot check
        html += '<div class="' + cls + '" id="day-' + ds + '" data-date="' + ds + '"' + (!isDisabled ? ' onclick="selectDate(&apos;' + ds + '&apos;)"' : '') + '><span>' + day + '</span><span class="today-label">Today</span></div>';
        if (!isPast && isWorking) workingDates.push(ds);
      }
      grid.innerHTML = html;

      // Batch-check availability for all working days in this month (only if not temp closed)
      if (!locTempClosed) checkDayAvailability(workingDates);

      if (selectedDate) loadSlots(selectedDate);
    }

    function buildSlotParams(date, dur) {
      let params = "/slots?date=" + date + "&duration=" + dur;
      if (selectedStaff) params += "&staffId=" + encodeURIComponent(selectedStaff.localId);
      if (selectedLocation) params += "&locationId=" + encodeURIComponent(selectedLocation);
      // Pass client's local date/time so server can correctly filter past slots for today
      const _now = new Date();
      const _clientToday = _now.toLocaleDateString('en-CA'); // YYYY-MM-DD in client's local timezone
      const _nowMinutes = _now.getHours() * 60 + _now.getMinutes();
      params += "&clientToday=" + encodeURIComponent(_clientToday) + "&nowMinutes=" + _nowMinutes;
      return params;
    }
    async function checkDayAvailability(dates) {
      const dur = getTotalDuration();
      // Fetch slots for each working day in parallel
      const cacheKey = (ds) => ds + '_' + dur + '_' + (selectedStaff ? selectedStaff.localId : '') + '_' + (selectedLocation || '');
      const promises = dates.map(async (ds) => {
        // Use cache if available
        const key = cacheKey(ds);
        if (slotCache[key] !== undefined) return { date: ds, count: slotCache[key] };
        try {
          const res = await fetch(API + buildSlotParams(ds, dur));
          const data = await res.json();
          const count = data.slots ? data.slots.length : 0;
          slotCache[key] = count;
          return { date: ds, count };
        } catch(e) {
          return { date: ds, count: 0 };
        }
      });
      const results = await Promise.all(promises);
      results.forEach(r => {
        const el = document.getElementById("day-" + r.date);
        if (!el) return;
        if (r.count === 0) {
          // No slots available — disable this day
          el.classList.add("disabled");
          el.style.cursor = "not-allowed";
          el.onclick = null;
          el.removeAttribute("onclick");
        } else {
          // Has slots — add green availability dot
          if (!el.querySelector(".avail-dot")) {
            const dot = document.createElement("span");
            dot.className = "avail-dot";
            el.appendChild(dot);
          }
        }
      });
    }

    async function selectDate(date) {
      selectedDate = date;
      selectedTime = null;
      document.getElementById("btnToConfirm").disabled = true;
      document.querySelectorAll(".cal-day").forEach(el => {
        el.classList.toggle("selected", el.dataset.date === date);
      });
      await loadSlots(date);
    }

    // slotLocationCounts: map of time -> number of locations available at that time (from last loadSlots call)
    let slotLocationCounts = {};

    async function loadSlots(date) {
      const section = document.getElementById("timeSection");
      const grid = document.getElementById("timeGrid");
      const noSlots = document.getElementById("noSlots");
      section.style.display = "block";
      grid.innerHTML = '<div class="loading" style="grid-column:1/-1;">Loading times...</div>';
      noSlots.style.display = "none";

      try {
        const dur = getTotalDuration();
        const res = await fetch(API + buildSlotParams(date, dur));
        const data = await res.json();
        slotLocationCounts = data.slotLocationCounts || {};
        if (data.slots.length === 0) {
          grid.innerHTML = "";
          // Show context-aware message: today vs future date
          const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
          const noSlotsMsg = document.getElementById('noSlotsMsg');
          if (noSlotsMsg) {
            if (date === todayStr) {
              noSlotsMsg.style.color = '#d97706';
              noSlotsMsg.style.fontWeight = '600';
              noSlotsMsg.innerHTML = 'All slots for today have passed.<br><span style="font-size:12px;font-weight:400;color:#888;">Select another date to book an appointment.</span>';
            } else {
              noSlotsMsg.style.color = '#888';
              noSlotsMsg.style.fontWeight = 'normal';
              var nextDate = new Date(date + 'T12:00:00');
              nextDate.setDate(nextDate.getDate() + 1);
              var nextDateStr = nextDate.toLocaleDateString('en-CA');
              var nextDateLabel = nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              noSlotsMsg.innerHTML = '<div style="text-align:center;padding:20px 0;">' +
                '<div style="font-size:32px;margin-bottom:8px;">\u{1F4C5}</div>' +
                '<div style="font-size:15px;font-weight:700;color:#374151;margin-bottom:4px;">No available times on this day</div>' +
                '<div style="font-size:13px;color:#6b7280;margin-bottom:16px;">This day may be fully booked or closed.</div>' +
                '<button data-next-date="' + nextDateStr + '" onclick="var d=this.dataset.nextDate;document.getElementById(&quot;dateInput&quot;).value=d;loadSlots(d)" ' +
                'style="background:var(--accent);color:#fff;border:none;border-radius:20px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;">' +
                '\u2192 Try ' + nextDateLabel + '</button>' +
                '</div>';
            }
          }
          noSlots.style.display = "block";
          return;
        }
        // Determine if we are in All Locations mode (no specific location selected)
        const isAllLocMode = !selectedLocation && locations.length > 1;
        grid.innerHTML = data.slots.map(t => {
          const h = parseInt(t.split(":")[0]);
          const m = t.split(":")[1];
          const ampm = h >= 12 ? "PM" : "AM";
          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
          const label = h12 + ":" + m + " " + ampm;
          const locCount = slotLocationCounts[t] || 1;
          const badge = (isAllLocMode && locCount > 1)
            ? '<span style="display:block;font-size:9px;font-weight:700;color:var(--accent);margin-top:2px;">' + locCount + ' locations</span>'
            : '';
          return '<div class="time-slot" onclick="selectTime(&apos;' + t + '&apos;)" data-time="' + t + '">' + label + badge + '</div>';
        }).join("");
      } catch(e) {
        grid.innerHTML = '<div class="error-msg" style="grid-column:1/-1;">Failed to load times</div>';
      }
    }

    function selectTime(time) {
      selectedTime = time;
      document.querySelectorAll(".time-slot").forEach(el => {
        el.classList.toggle("selected", el.dataset.time === time);
      });
      document.getElementById("btnToConfirm").disabled = false;
      // All Locations mode: auto-assign location when only one location has this slot available.
      // This mirrors the owner new-booking auto-assign behavior.
      if (!selectedLocation && locations.length > 1) {
        const locCount = slotLocationCounts[time] || 1;
        if (locCount === 1) {
          // Find which single location has this slot by fetching per-location slot data
          // We can determine it from slotLocationCounts: if only 1 location has it,
          // we need to identify which one. We'll re-use the locations list and check
          // which location's working hours cover this time on the selected date.
          // For simplicity, we auto-select the first active non-closed location that
          // has this slot (the server already computed this union, so we trust it).
          // The booking POST will validate the slot against the submitted locationId.
          // We do a quick check: fetch slots for each location and find the one with this time.
          (async function() {
            const dur = getTotalDuration();
            for (const loc of locations) {
              if (loc.temporarilyClosed) continue;
              try {
                const _locNow = new Date();
                const _locClientToday = _locNow.toLocaleDateString('en-CA');
                const _locNowMinutes = _locNow.getHours() * 60 + _locNow.getMinutes();
                const r = await fetch(API + "/slots?date=" + selectedDate + "&duration=" + dur + "&locationId=" + encodeURIComponent(loc.localId) + "&clientToday=" + encodeURIComponent(_locClientToday) + "&nowMinutes=" + _locNowMinutes);
                const d = await r.json();
                if (d.slots && d.slots.includes(time)) {
                  // This location has the slot — auto-select it silently
                  selectedLocation = loc.localId;
                  slotCache = {};
                  renderLocationSelector();
                  updateBizAddressCard();
                  break;
                }
              } catch(e) { /* ignore */ }
            }
          })();
        }
      }
      checkDiscount();
    }

    function checkDiscount() {
      const info = document.getElementById("discountInfo");
      if (!selectedService || !selectedTime || !selectedDate) { info.style.display = "none"; return; }
      const timeMin = parseInt(selectedTime.split(":")[0]) * 60 + parseInt(selectedTime.split(":")[1]);
      const match = discounts.find(d => {
        const start = parseInt(d.startTime.split(":")[0]) * 60 + parseInt(d.startTime.split(":")[1]);
        const end = parseInt(d.endTime.split(":")[0]) * 60 + parseInt(d.endTime.split(":")[1]);
        if (timeMin < start || timeMin >= end) return false;
        if (d.dates && d.dates.length > 0 && !d.dates.includes(selectedDate)) return false;
        if (d.serviceIds && d.serviceIds.length > 0 && !d.serviceIds.includes(selectedService.localId)) return false;
        return true;
      });
      if (match) {
        appliedDiscount = { name: match.name, percentage: match.percentage };
        const orig = parseFloat(selectedService.price);
        const disc = orig * (1 - match.percentage / 100);
          info.innerHTML = '<div style="background:var(--accent-bg);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:13px;">🎉 <strong>' + match.name + '</strong> — ' + match.percentage + '% off! <span style="text-decoration:line-through;color:var(--text-muted);">$' + orig.toFixed(2) + '</span> → <strong style="color:var(--accent-dark);">$' + disc.toFixed(2) + '</strong></div>';
        info.style.display = "block";
      } else {
        appliedDiscount = null;
        info.style.display = "none";
      }
    }

    // ── Add More (Step 3) ──
    // ── Drill-down state ──────────────────────────────────────────────────────
    let addTab = 'services'; // 'services' | 'products'
    let selectedAddCat = null;  // null = show category tiles; string = show service list for that category
    let selectedAddBrand = null; // null = show brand tiles; string = show product list for that brand
    let addMoreSearchQuery = ''; // live search query

    function initAddMoreStep() {
      // Reset drill-down state each time step 3 is entered
      addTab = 'services';
      selectedAddCat = null;
      selectedAddBrand = null;
      addMoreSearchQuery = '';
      const searchEl = document.getElementById("addMoreSearch");
      if (searchEl) searchEl.value = '';
      document.getElementById("addMoreSearchResults").style.display = 'none';
      // Show services panel, hide products panel
      document.getElementById("addServicePanel").style.display = 'block';
      document.getElementById("addProductPanel").style.display = 'none';
      // Reset seg control
      document.querySelectorAll("#addMoreSeg .seg-btn").forEach((el,i) => {
        el.classList.toggle("active", i === 0);
      });
      renderAddMore();
    }

    function onAddMoreSearch(query) {
      addMoreSearchQuery = (query || '').trim().toLowerCase();
      const resultsEl = document.getElementById("addMoreSearchResults");
      const servicePanel = document.getElementById("addServicePanel");
      const productPanel = document.getElementById("addProductPanel");
      if (!addMoreSearchQuery) {
        resultsEl.style.display = 'none';
        // Restore normal panels
        servicePanel.style.display = addTab === 'services' ? 'block' : 'none';
        productPanel.style.display = addTab === 'products' ? 'block' : 'none';
        return;
      }
      // Hide normal drill-down panels while searching
      servicePanel.style.display = 'none';
      productPanel.style.display = 'none';
      resultsEl.style.display = 'block';

      const cartSvcIds = cart.filter(c => c.type === 'service').map(c => c.id);
      const cartProdIds = cart.filter(c => c.type === 'product').map(c => c.id);
      const matchedSvcs = services.filter(s =>
        s.localId !== selectedService.localId &&
        !cartSvcIds.includes(s.localId) &&
        (s.name || '').toLowerCase().includes(addMoreSearchQuery)
      );
      const matchedProds = products.filter(p =>
        !cartProdIds.includes(p.localId) &&
        (p.name || '').toLowerCase().includes(addMoreSearchQuery)
      );

      if (matchedSvcs.length === 0 && matchedProds.length === 0) {
        resultsEl.innerHTML = '<div style="text-align:center;color:#888;padding:20px;font-size:13px;">No results found</div>';
        return;
      }

      let html = '';
      if (matchedSvcs.length > 0) {
        html += '<div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Services</div>';
        matchedSvcs.forEach(s => {
          const dur = s.duration >= 60 ? (s.duration/60) + " hr" : s.duration + " min";
          var addThumbS = s.photoUri
            ? '<div class="service-dot"><img src="' + esc(s.photoUri) + '" /></div>'
            : '<div class="service-dot" style="background:' + (s.color||'#4a8c3f') + '20;color:' + (s.color||'#4a8c3f') + ';">' + esc((s.name||'?')[0].toUpperCase()) + '</div>';
          html += '<div class="service-item" data-id="' + escH(s.localId) + '" onclick="openServiceDetail(this.dataset.id)">' +
            addThumbS +
            '<div class="service-info"><div class="service-name">' + esc(s.name) + '</div><div class="service-meta">' + dur + (s.category ? ' · ' + esc(s.category) : '') + '</div></div>' +
            '<div class="service-price">+ $' + parseFloat(s.price).toFixed(2) + '</div></div>';
        });
      }
      if (matchedProds.length > 0) {
        html += '<div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:' + (matchedSvcs.length > 0 ? '12px' : '0') + ' 0 6px;">Products</div>';
        matchedProds.forEach(p => {
          html += '<div class="product-item" data-id="' + escH(p.localId) + '" onclick="openProductDetail(this.dataset.id)">' +
            (p.photoUri ? '<img src="' + esc(p.photoUri) + '" style="width:48px;height:48px;border-radius:8px;object-fit:cover;margin-right:12px;flex-shrink:0;" />' : '') +
            '<div style="flex:1;"><div style="font-size:15px;font-weight:600;">' + esc(p.name) + '</div>' +
            (p.brand ? '<div style="font-size:12px;color:#888;margin-top:2px;">' + esc(p.brand) + '</div>' : '') + '</div>' +
            '<div style="font-size:15px;font-weight:700;color:#2d5a27;">+ $' + parseFloat(p.price).toFixed(2) + '</div></div>';
        });
      }
      resultsEl.innerHTML = html;
    }

    function renderAddMore() {
      renderCartSummary();
      if (addTab === 'services') {
        renderServiceDrillDown();
      } else {
        renderProductDrillDown();
      }
    }

    function switchAddTab(tab) {
      addTab = tab;
      document.querySelectorAll("#addMoreSeg .seg-btn").forEach((el,i) => {
        el.classList.toggle("active", (tab === "services" && i === 0) || (tab === "products" && i === 1));
      });
      document.getElementById("addServicePanel").style.display = tab === "services" ? "block" : "none";
      document.getElementById("addProductPanel").style.display = tab === "products" ? "block" : "none";
      if (tab === "services") renderServiceDrillDown();
      else renderProductDrillDown();
    }

    function renderCartSummary() {
      const el = document.getElementById("cartSummary");
      // Primary service always in cart
      let items = [{type:'service', name: selectedService.name, price: parseFloat(selectedService.price), duration: selectedService.duration}];
      items = items.concat(cart);
      el.innerHTML = items.map((item, i) => {
        const priceStr = "$" + item.price.toFixed(2);
        const durStr = item.duration ? " (" + item.duration + " min)" : "";
        const removeBtn = i > 0 ? '<span class="cart-remove" onclick="removeCartItem(' + (i-1) + ')">&times;</span>' : '<span style="font-size:11px;color:#4a8c3f;font-weight:600;">PRIMARY</span>';
        return '<div class="cart-item"><span>' + esc(item.name) + durStr + '</span><span style="display:flex;align-items:center;gap:8px;"><span style="font-weight:600;">' + priceStr + '</span>' + removeBtn + '</span></div>';
      }).join("");

      // Total with discount
      const total = items.reduce((s, it) => s + it.price, 0);
      const totalDur = items.reduce((s, it) => s + (it.duration || 0), 0);
      const totalEl = document.getElementById("cartTotal");
      totalEl.style.display = "flex";
      const discAmt = getDiscountAmount();
      if (appliedDiscount && discAmt > 0) {
        const afterDisc = total - discAmt;
        totalEl.innerHTML = '<span>Total' + (totalDur > 0 ? ' (' + totalDur + ' min)' : '') + '</span><span><span style="text-decoration:line-through;color:var(--text-muted);font-size:12px;">$' + total.toFixed(2) + '</span> <span style="color:var(--accent-dark);font-weight:700;">$' + afterDisc.toFixed(2) + '</span></span>';
      } else {
        totalEl.innerHTML = '<span>Total' + (totalDur > 0 ? ' (' + totalDur + ' min)' : '') + '</span><span style="color:var(--accent-dark);">$' + total.toFixed(2) + '</span>';
      }
    }

    // ── Services drill-down ───────────────────────────────────────────────────
    function renderServiceDrillDown() {
      const cartSvcIds = cart.filter(c => c.type === 'service').map(c => c.id);
      const available = services.filter(s => s.localId !== selectedService.localId && !cartSvcIds.includes(s.localId));

      // Build category map
      const catMap = {};
      available.forEach(s => {
        const cat = (s.category || '').trim() || 'General';
        if (!catMap[cat]) catMap[cat] = [];
        catMap[cat].push(s);
      });
      const cats = Object.keys(catMap).sort((a, b) => {
        if (a === 'General') return 1; if (b === 'General') return -1;
        return a.localeCompare(b);
      });

      const catsEl = document.getElementById("addServiceCats");
      const listEl = document.getElementById("addServiceList");

      if (available.length === 0) {
        catsEl.innerHTML = '<div style="text-align:center;color:#888;padding:16px;font-size:13px;">No additional services available</div>';
        catsEl.style.display = 'block';
        listEl.style.display = 'none';
        return;
      }

      // Only one category — skip tile level, show list directly (no need for All tile)
      if (cats.length <= 1) {
        selectedAddCat = cats[0] || 'General';
      }
      // More than one category: always show tile grid (including All tile)

      if (selectedAddCat === null) {
        // Level 0: category tiles
        listEl.style.display = 'none';
        let html = '<div class="tile-grid">';
        // "All" tile first
        html += '<div class="tile-card" onclick="drillIntoCategory(&quot;__all__&quot;)" style="border-color:var(--accent);">' +
          '<div class="tile-emoji">' + getCategoryEmoji('all') + '</div>' +
          '<div class="tile-name">All</div>' +
          '<div class="tile-count">' + available.length + ' service' + (available.length !== 1 ? 's' : '') + '</div>' +
          '</div>';
        cats.forEach(cat => {
          const count = catMap[cat].length;
          const titleAttr = cat.length > 25 ? ' title="' + esc(cat) + '"' : '';
          html += '<div class="tile-card" data-cat="' + esc(cat) + '"' + titleAttr + '>' +
            '<div class="tile-emoji">' + getCategoryEmoji(cat) + '</div>' +
            '<div class="tile-name">' + esc(cat) + '</div>' +
            '<div class="tile-count">' + count + ' service' + (count !== 1 ? 's' : '') + '</div>' +
            '</div>';
        });
        html += '</div>';
        catsEl.innerHTML = html;
        // Attach click handlers via JS — use currentTarget to avoid closure capture bug
        catsEl.querySelectorAll('.tile-card[data-cat]').forEach(function(tile) {
          tile.addEventListener('click', function(e) { drillIntoCategory(e.currentTarget.getAttribute('data-cat')); });
        });
        catsEl.style.display = 'block';
      } else {
        // Level 1: service list for selected category (or all)
        catsEl.style.display = 'none';
        const catServices = selectedAddCat === '__all__' ? available : (catMap[selectedAddCat] || []);
        const backLabel = selectedAddCat === '__all__' ? 'All Services' : selectedAddCat;
        let html = '<div class="drill-back" onclick="drillBackServices()">&#8592; ' + esc(backLabel) + '</div>';
        if (catServices.length === 0) {
          html += '<div style="text-align:center;color:#888;padding:16px;font-size:13px;">No services in this category</div>';
        } else {
          catServices.forEach(s => {
            const dur = s.duration >= 60 ? (s.duration/60) + " hr" : s.duration + " min";
            var addThumbC = s.photoUri
              ? '<div class="service-dot"><img src="' + esc(s.photoUri) + '" /></div>'
              : '<div class="service-dot" style="background:' + (s.color||'#4a8c3f') + '20;color:' + (s.color||'#4a8c3f') + ';">' + esc((s.name||'?')[0].toUpperCase()) + '</div>';
            html += '<div class="service-item" data-svc-id="' + esc(s.localId) + '">' +
              addThumbC +
              '<div class="service-info"><div class="service-name">' + esc(s.name) + '</div><div class="service-meta">' + dur + '</div></div>' +
              '<div class="service-price">+ $' + parseFloat(s.price).toFixed(2) + '</div></div>';
          });
        }
        listEl.innerHTML = html;
        // Attach click handlers for service items via data attribute
        listEl.querySelectorAll('.service-item[data-svc-id]').forEach(function(item) {
          item.addEventListener('click', function(e) { openServiceDetail(e.currentTarget.getAttribute('data-svc-id')); });
        });
        listEl.style.display = 'block';
      }
    }

    function drillIntoCategory(cat) {
      selectedAddCat = cat;
      renderServiceDrillDown();
    }

    function drillBackServices() {
      selectedAddCat = null;
      renderServiceDrillDown();
    }

    function openServiceDetail(id) {
      const s = services.find(sv => sv.localId === id);
      if (!s) return;
      const dur = s.duration >= 60 ? (s.duration/60) + " hr" : s.duration + " min";
      const inCart = cart.some(c => c.type === 'service' && c.id === id);
      let html = '';
      if (s.photoUri) {
        html += '<img class="detail-photo" src="' + esc(s.photoUri) + '" />';
      } else {
        html += '<div class="detail-photo-placeholder">✂️<span class="ph-hint">Add a photo in the app to help clients visualise this service</span></div>';
      }
      if (s.category) html += '<div class="detail-badge">' + esc(s.category) + '</div>';
      html += '<div class="detail-name">' + esc(s.name) + '</div>';
      html += '<div class="detail-price">$' + parseFloat(s.price).toFixed(2) + '</div>';
      html += '<div class="detail-meta">' + dur + '</div>';
      if (s.description) html += '<div class="detail-desc">' + esc(s.description) + '</div>';
      if (inCart) {
        html += '<button class="detail-add-btn" style="background:var(--accent-bg);color:var(--accent-dark);" onclick="removeServiceFromCart(' + Q + id + Q + ');closeItemDetail()">✓ Added — Remove</button>';
      } else {
        html += '<button class="detail-add-btn" onclick="addServiceToCart(' + Q + id + Q + ');closeItemDetail()">Add to Booking</button>';
      }
      html += '<button class="detail-dismiss" onclick="closeItemDetail()">Close</button>';
      document.getElementById("itemDetailContent").innerHTML = html;
      document.getElementById("itemDetailOverlay").style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function removeServiceFromCart(id) {
      const idx = cart.findIndex(c => c.type === 'service' && c.id === id);
      if (idx !== -1) { cart.splice(idx, 1); renderAddMore(); }
    }

    // ── Products drill-down ───────────────────────────────────────────────────
    function renderProductDrillDown() {
      const cartProdIds = cart.filter(c => c.type === 'product').map(c => c.id);
      const available = products.filter(p => !cartProdIds.includes(p.localId));

      // Build brand map
      const brandMap = {};
      available.forEach(p => {
        const brand = (p.brand || '').trim() || 'Other';
        if (!brandMap[brand]) brandMap[brand] = [];
        brandMap[brand].push(p);
      });
      const brands = Object.keys(brandMap).sort((a, b) => {
        if (a === 'Other') return 1; if (b === 'Other') return -1;
        return a.localeCompare(b);
      });

      const brandsEl = document.getElementById("addProductBrands");
      const listEl = document.getElementById("addProductList");

      if (available.length === 0) {
        brandsEl.innerHTML = '<div style="text-align:center;color:#888;padding:16px;font-size:13px;">No products available</div>';
        brandsEl.style.display = 'block';
        listEl.style.display = 'none';
        return;
      }

      // Only one brand — skip tile level, show list directly (no need for All tile)
      if (brands.length <= 1) {
        selectedAddBrand = brands[0] || 'Other';
      }
      // More than one brand: always show tile grid (including All tile)

      if (selectedAddBrand === null) {
        // Level 0: brand tiles
        listEl.style.display = 'none';
        let html = '<div class="tile-grid">';
        // "All" tile first
        html += '<div class="tile-card" onclick="drillIntoBrand(&quot;__all__&quot;)" style="border-color:var(--accent);">' +
          '<div class="tile-name">All</div>' +
          '<div class="tile-count">' + available.length + ' product' + (available.length !== 1 ? 's' : '') + '</div>' +
          '</div>';
        brands.forEach(brand => {
          const count = brandMap[brand].length;
          html += '<div class="tile-card" data-brand="' + esc(brand) + '">' +
            '<div class="tile-name">' + esc(brand) + '</div>' +
            '<div class="tile-count">' + count + ' product' + (count !== 1 ? 's' : '') + '</div>' +
            '</div>';
        });
        html += '</div>';
        brandsEl.innerHTML = html;
        // Attach click handlers via JS — use currentTarget to avoid closure capture bug
        brandsEl.querySelectorAll('.tile-card[data-brand]').forEach(function(tile) {
          tile.addEventListener('click', function(e) { drillIntoBrand(e.currentTarget.getAttribute('data-brand')); });
        });
        brandsEl.style.display = 'block';
      } else {
        // Level 1: product list for selected brand (or all)
        brandsEl.style.display = 'none';
        const brandProducts = selectedAddBrand === '__all__' ? available : (brandMap[selectedAddBrand] || []);
        const backLabel = selectedAddBrand === '__all__' ? 'All Products' : selectedAddBrand;
        let html = brands.length > 1 || selectedAddBrand === '__all__' ? '<div class="drill-back" onclick="drillBackProducts()">&#8592; ' + esc(backLabel) + '</div>' : '';
        if (brandProducts.length === 0) {
          html += '<div style="text-align:center;color:#888;padding:16px;font-size:13px;">No products in this brand</div>';
        } else {
          brandProducts.forEach(p => {
            html += '<div class="product-item" data-prod-id="' + esc(p.localId) + '">' +
              (p.photoUri ? '<img src="' + esc(p.photoUri) + '" style="width:56px;height:56px;border-radius:10px;object-fit:cover;margin-right:12px;flex-shrink:0;" />' : '') +
              '<div style="flex:1;"><div style="font-size:15px;font-weight:600;">' + esc(p.name) + '</div>' +
              (p.description ? '<div style="font-size:12px;color:#888;margin-top:2px;">' + esc(p.description) + '</div>' : '') + '</div>' +
              '<div style="font-size:15px;font-weight:700;color:#2d5a27;">+ $' + parseFloat(p.price).toFixed(2) + '</div></div>';
          });
        }
        listEl.innerHTML = html;
        // Attach click handlers for product items via data attribute
        listEl.querySelectorAll('.product-item[data-prod-id]').forEach(function(item) {
          item.addEventListener('click', function(e) { openProductDetail(e.currentTarget.getAttribute('data-prod-id')); });
        });
        listEl.style.display = 'block';
      }
    }

    function drillIntoBrand(brand) {
      selectedAddBrand = brand;
      renderProductDrillDown();
    }

    function drillBackProducts() {
      selectedAddBrand = null;
      renderProductDrillDown();
    }

    function openProductDetail(id) {
      const p = products.find(pr => pr.localId === id);
      if (!p) return;
      const inCart = cart.some(c => c.type === 'product' && c.id === id);
      let html = '';
      if (p.photoUri) {
        html += '<img class="detail-photo" src="' + esc(p.photoUri) + '" />';
      } else {
        html += '<div class="detail-photo-placeholder">🛍️<span class="ph-hint">Add a photo in the app so clients can see this product</span></div>';
      }
      if (p.brand) html += '<div class="detail-badge">' + esc(p.brand) + '</div>';
      html += '<div class="detail-name">' + esc(p.name) + '</div>';
      html += '<div class="detail-price">$' + parseFloat(p.price).toFixed(2) + '</div>';
      if (p.description) html += '<div class="detail-desc">' + esc(p.description) + '</div>';
      if (inCart) {
        html += '<button class="detail-add-btn" style="background:var(--accent-bg);color:var(--accent-dark);" onclick="removeProductFromCart(' + Q + id + Q + ');closeItemDetail()">✓ Added — Remove</button>';
      } else {
        html += '<button class="detail-add-btn" onclick="addProductToCart(' + Q + id + Q + ');closeItemDetail()">Add to Booking</button>';
      }
      html += '<button class="detail-dismiss" onclick="closeItemDetail()">Close</button>';
      document.getElementById("itemDetailContent").innerHTML = html;
      document.getElementById("itemDetailOverlay").style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function removeProductFromCart(id) {
      const idx = cart.findIndex(c => c.type === 'product' && c.id === id);
      if (idx !== -1) { cart.splice(idx, 1); renderAddMore(); }
    }

    function closeItemDetail(event) {
      if (event && event.target !== document.getElementById("itemDetailOverlay")) return;
      document.getElementById("itemDetailOverlay").style.display = 'none';
      document.body.style.overflow = '';
      renderAddMore();
    }

    // ── Legacy helpers still used by addServiceToCart / addProductToCart ─────
    function renderAddServiceList() { /* no-op: replaced by renderServiceDrillDown */ }
    function renderAddProductList() { /* no-op: replaced by renderProductDrillDown */ }

    function addServiceToCart(id) {
      const s = services.find(sv => sv.localId === id);
      if (!s) return;
      cart.push({ type: 'service', id: s.localId, name: s.name, price: parseFloat(s.price), duration: s.duration });
      renderAddMore();
    }

    function addProductToCart(id) {
      const p = products.find(pr => pr.localId === id);
      if (!p) return;
      cart.push({ type: 'product', id: p.localId, name: p.name, price: parseFloat(p.price), duration: 0 });
      renderAddMore();
    }

    function removeCartItem(idx) {
      cart.splice(idx, 1);
      renderAddMore();
    }

    function getTotalDuration() {
      let dur = selectedService ? selectedService.duration : 60;
      cart.forEach(c => { dur += (c.duration || 0); });
      // For mobile services, add travel duration (one-way travel time, added twice for round trip)
      if (isMobileService() && selectedService.travelDuration) {
        dur += selectedService.travelDuration * 2;
      }
      return dur;
    }
    function getServiceOnlyDuration() {
      let dur = selectedService ? selectedService.duration : 60;
      cart.forEach(c => { dur += (c.duration || 0); });
      return dur;
    }

    function getTotalPrice() {
      let total = selectedService ? parseFloat(selectedService.price) : 0;
      cart.forEach(c => { total += c.price; });
      // Add travel fee for mobile services — use dynamic fee (distance-based) if available, else fixed
      if (isMobileService()) {
        var fee = dynamicTravelFee != null ? dynamicTravelFee : (selectedService.travelFee ? parseFloat(selectedService.travelFee) : 0);
        total += fee;
      }
      return total;
    }

    function getDiscountAmount() {
      // Calculate combined discount from time-based discount + promo code
      if (!selectedService) return 0;
      const servicePrice = parseFloat(selectedService.price);
      let discAmt = 0;
      if (appliedDiscount) {
        discAmt += servicePrice * (appliedDiscount.percentage / 100);
      }
      if (appliedPromo) {
        if (appliedPromo.percentage > 0) {
          discAmt += servicePrice * (appliedPromo.percentage / 100);
        } else if (appliedPromo.flatAmount) {
          discAmt += parseFloat(appliedPromo.flatAmount);
        }
      }
      return discAmt;
    }
    function getPromoDiscountAmount() {
      if (!appliedPromo || !selectedService) return 0;
      const servicePrice = parseFloat(selectedService.price);
      if (appliedPromo.percentage > 0) return servicePrice * (appliedPromo.percentage / 100);
      if (appliedPromo.flatAmount) return parseFloat(appliedPromo.flatAmount);
      return 0;
    }
    function getDiscountedTotal() {
      // Total after all discounts, before gift card
      return Math.max(0, getTotalPrice() - getDiscountAmount());
    }
    function getChargedPrice() {
      // Apply discounts first, then gift card
      let total = getDiscountedTotal();
      if (appliedGift) {
        const balance = appliedGift.remainingBalance || 0;
        total -= balance;
        if (total < 0) total = 0;
      }
      return total;
    }
    function getGiftUsedAmount() {
      // How much of the gift balance is being used for this booking (after discount)
      if (!appliedGift) return 0;
      const total = getDiscountedTotal();
      const balance = appliedGift.remainingBalance || 0;
      return Math.min(balance, total);
    }

    // ── Confirmation (Step 4) ──
    function renderConfirmation() {
      const details = document.getElementById("confirmDetails");
      const d = new Date(selectedDate + "T12:00:00");
      const dateStr = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const h = parseInt(selectedTime.split(":")[0]);
      const m = selectedTime.split(":")[1];
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const timeStr = h12 + ":" + m + " " + ampm;
      const totalDur = getTotalDuration();
      const endMin = h * 60 + parseInt(m) + totalDur;
      const endH = Math.floor(endMin / 60);
      const endM = endMin % 60;
      const endAmpm = endH >= 12 ? "PM" : "AM";
      const endH12 = endH === 0 ? 12 : endH > 12 ? endH - 12 : endH;
      const endStr = endH12 + ":" + String(endM).padStart(2,"0") + " " + endAmpm;

      // Staff info
      let staffHtml = '';
      if (selectedStaff) {
        staffHtml = '<div class="confirm-row"><span class="confirm-label">Staff</span><span class="confirm-value"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (selectedStaff.color || '#6366f1') + ';margin-right:6px;"></span>' + esc(selectedStaff.name) + '</span></div>';
      }
      // Build items list
      let itemsHtml = '<div class="confirm-row"><span class="confirm-label">Service</span><span class="confirm-value">' + esc(selectedService.name) + ' \u2014 $' + parseFloat(selectedService.price).toFixed(2) + '</span></div>';
      cart.forEach(c => {
        const label = c.type === 'product' ? 'Product' : 'Service';
        itemsHtml += '<div class="confirm-row"><span class="confirm-label">' + label + '</span><span class="confirm-value">' + esc(c.name) + ' \u2014 $' + c.price.toFixed(2) + '</span></div>';
      });
      // Travel fee line item (mobile services only) — use dynamic fee when available
      var effectiveTravelFee = isMobileService() ? (dynamicTravelFee != null ? dynamicTravelFee : (selectedService.travelFee ? parseFloat(selectedService.travelFee) : 0)) : 0;
      if (isMobileService() && effectiveTravelFee > 0) {
        var feeLabel = calculatedDistanceMi != null ? '\ud83d\ude97 Travel Fee (' + Math.round(calculatedDistanceMi) + ' mi)' : '\ud83d\ude97 Travel Fee';
        itemsHtml += '<div class="confirm-row"><span class="confirm-label" style="color:#0369a1;">' + feeLabel + '</span><span class="confirm-value" style="color:#0369a1;">$' + effectiveTravelFee.toFixed(2) + '</span></div>';
      }
      // Estimated arrival window for mobile services
      if (isMobileService() && selectedService.travelDuration && selectedTime) {
        var tParts = selectedTime.split(':').map(Number);
        var apptStartMin = tParts[0] * 60 + tParts[1];
        var arrivalMin = apptStartMin - selectedService.travelDuration;
        if (arrivalMin < 0) arrivalMin = 0;
        var arrH = Math.floor(arrivalMin / 60), arrM = arrivalMin % 60;
        var arrAmpm = arrH >= 12 ? 'PM' : 'AM'; var arrH12 = arrH === 0 ? 12 : arrH > 12 ? arrH - 12 : arrH;
        var arrivalStr = arrH12 + ':' + String(arrM).padStart(2,'0') + ' ' + arrAmpm;
        // Window = arrival to arrival + 15 min
        var arrWinMin = arrivalMin + 15;
        var awH = Math.floor(arrWinMin / 60), awM = arrWinMin % 60;
        var awAmpm = awH >= 12 ? 'PM' : 'AM'; var awH12 = awH === 0 ? 12 : awH > 12 ? awH - 12 : awH;
        var arrivalWinStr = awH12 + ':' + String(awM).padStart(2,'0') + ' ' + awAmpm;
        itemsHtml += '<div class="confirm-row"><span class="confirm-label" style="color:#0369a1;">\ud83d\udd50 Est. Arrival</span><span class="confirm-value" style="color:#0369a1;">' + arrivalStr + ' \u2013 ' + arrivalWinStr + '</span></div>';
      }
      let totalPrice = getTotalPrice();
      let discountAmt = getDiscountAmount();
      let discountedTotal = getDiscountedTotal();
      let chargedPrice = getChargedPrice();
      let giftUsed = getGiftUsedAmount();
      // Build price breakdown HTML
      let breakdownHtml = '';
      // Subtotal row (label changes for mobile to clarify travel fee is included)
      const subtotalLabel = (isMobileService() && effectiveTravelFee > 0) ? 'Total (incl. travel)' : 'Subtotal';
      breakdownHtml += '<div class="confirm-row" style="border-top:2px solid #e8ece8;padding-top:10px;"><span class="confirm-label">' + subtotalLabel + '</span><span class="confirm-value">$' + totalPrice.toFixed(2) + '</span></div>';     // Discount row (if applicable)
      if (appliedDiscount && discountAmt > 0) {
        breakdownHtml += '<div class="confirm-row"><span class="confirm-label" style="color:#b45309;">\ud83c\udf89 ' + esc(appliedDiscount.name) + ' (' + appliedDiscount.percentage + '% off)</span><span class="confirm-value" style="color:#b45309;">-$' + discountAmt.toFixed(2) + '</span></div>';
      }
      // Promo code row (if applicable)
      const promoAmt = getPromoDiscountAmount();
      if (appliedPromo && promoAmt > 0) {
        const promoStr = appliedPromo.percentage > 0 ? appliedPromo.percentage + '% off' : '$' + promoAmt.toFixed(2) + ' off';
        breakdownHtml += '<div class="confirm-row"><span class="confirm-label" style="color:#0369a1;">\ud83c\udfab ' + esc(appliedPromo.label) + ' (' + promoStr + ')</span><span class="confirm-value" style="color:#0369a1;">-$' + promoAmt.toFixed(2) + '</span></div>';
      }

      // Gift card row (if applicable)
      if (appliedGift && giftUsed > 0) {
        breakdownHtml += '<div class="confirm-row"><span class="confirm-label" style="color:#2d5a27;">\ud83c\udf81 Gift Card Applied</span><span class="confirm-value" style="color:#2d5a27;">-$' + giftUsed.toFixed(2) + '</span></div>';
      }

      // Total to pay
      let totalLabel = 'Total to Pay';
      let totalColor = '#2d5a27';
      let totalStr = '$' + chargedPrice.toFixed(2);
      if (chargedPrice === 0 && (discountAmt > 0 || giftUsed > 0 || promoAmt > 0)) {
        totalStr = 'FREE';
        totalLabel = 'Total';
      }
      breakdownHtml += '<div class="confirm-row" style="border-top:1px solid #e8ece8;padding-top:8px;margin-top:4px;"><span class="confirm-label" style="font-weight:700;font-size:15px;">' + totalLabel + '</span><span class="confirm-value" style="font-weight:700;font-size:15px;color:' + totalColor + ';">' + totalStr + '</span></div>';

      // Savings summary
      const totalSaved = discountAmt + giftUsed;
      if (totalSaved > 0) {
        breakdownHtml += '<div style="background:var(--accent-bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-top:8px;font-size:12px;color:var(--accent-dark);text-align:center;">You save <strong>$' + totalSaved.toFixed(2) + '</strong> on this booking!</div>';
      }

      // Card fee disclosure notice
      let cardFeeHtml = '';
      if (selectedPaymentMethod === 'card' && PAYMENT_METHODS.stripeEnabled && chargedPrice > 0) {
        const feeP = PAYMENT_METHODS.platformFeePercent || 1.5;
        const feeCents = Math.round(chargedPrice * feeP / 100 * 100) / 100;
        cardFeeHtml = '<div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:12px;color:#4c1d95;">' +
          '<strong>💳 Card Payment Notice:</strong> A <strong>' + feeP.toFixed(1) + '% platform processing fee</strong> (~$' + feeCents.toFixed(2) + ') will be added at checkout. ' +
          'This fee is charged by the payment platform (Stripe) and is separate from your service total. ' +
          'You will see the exact breakdown on the Stripe payment page before confirming.</div>';
      }

      // Cancellation policy notice
      let cancelHtml = '';
      if (CANCEL_POLICY && CANCEL_POLICY.enabled) {
        cancelHtml = '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:12px;color:#991b1b;">' +
          '<strong>Cancellation Policy:</strong> Cancellations made less than <strong>' + CANCEL_POLICY.hoursBeforeAppointment + ' hour' + (CANCEL_POLICY.hoursBeforeAppointment !== 1 ? 's' : '') + '</strong> before the appointment may incur a <strong>' + CANCEL_POLICY.feePercentage + '% cancellation fee</strong> ($' + (chargedPrice * CANCEL_POLICY.feePercentage / 100).toFixed(2) + ').</div>';
      }

      // Location row
      let locationHtml = '';
      if (isMobileService()) {
        // Mobile service: show client address
        const addrStr = getClientAddressString();
        if (addrStr) {
          const mapUrl = 'https://maps.google.com/?q=' + encodeURIComponent(addrStr);
          locationHtml = '<div class="confirm-row" style="background:linear-gradient(135deg,#f0fdf4,#eff6ff);border:1.5px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:4px;">' +
            '<span style="font-size:18px;margin-right:8px;">🚗</span>' +
            '<span style="font-size:13px;font-weight:600;color:#15803d;">' +
            'We\'ll come to you at <a href="' + mapUrl + '" target="_blank" style="color:#0369a1;text-decoration:underline;font-weight:700;">' + esc(addrStr) + '</a>' +
            '</span></div>';
        }
        if (selectedService.travelFee && parseFloat(selectedService.travelFee) > 0) {
          locationHtml += '<div class="confirm-row"><span class="confirm-label">Travel Fee</span><span class="confirm-value">$' + parseFloat(selectedService.travelFee).toFixed(2) + '</span></div>';
        }
        if (selectedService.travelDuration) {
          locationHtml += '<div class="confirm-row"><span class="confirm-label">Travel Time</span><span class="confirm-value">~' + selectedService.travelDuration + ' min each way</span></div>';
        }
      } else if (selectedLocation) {
        const loc = locations.find(l => l.localId === selectedLocation);
        if (loc) {
          const fullLocAddr = buildFullAddress(loc.address, loc.city, loc.state, loc.zipCode) || loc.address || '';
          const locLabel = fullLocAddr ? esc(loc.name) + ' — ' + esc(fullLocAddr) : esc(loc.name);
          const mapUrl = fullLocAddr ? 'https://maps.google.com/?q=' + encodeURIComponent(fullLocAddr) : '';
          const addrLink = mapUrl ? '<a href="' + mapUrl + '" target="_blank" style="color:var(--accent);text-decoration:underline;">' + locLabel + '</a>' : locLabel;
          locationHtml = '<div class="confirm-row"><span class="confirm-label">Location</span><span class="confirm-value">📍 ' + addrLink + '</span></div>';
        }
      }

      details.innerHTML = itemsHtml +
        staffHtml +
        '<div class="confirm-row"><span class="confirm-label">Date</span><span class="confirm-value">' + dateStr + '</span></div>' +
        '<div class="confirm-row"><span class="confirm-label">Time</span><span class="confirm-value">' + timeStr + ' \u2014 ' + endStr + '</span></div>' +
        '<div class="confirm-row"><span class="confirm-label">Duration</span><span class="confirm-value">' + totalDur + ' min</span></div>' +
        locationHtml +
        breakdownHtml +
        cardFeeHtml +
        '<div class="confirm-row"><span class="confirm-label">Name</span><span class="confirm-value">' + esc(document.getElementById("clientName").value) + '</span></div>' +
        cancelHtml;

      // Show selected payment method summary
      const pmLabels = { zelle: '\ud83d\udc9c Zelle', cashapp: '\ud83d\udc9a Cash App', venmo: '\ud83d\udc99 Venmo', cash: '\ud83d\udcb5 Cash (pay in person)' };
      const pmEl = document.getElementById('selectedPaymentSummary');
      if (pmEl) {
        const pmDisplay = selectedPaymentMethod && selectedPaymentMethod !== 'later'
          ? (pmLabels[selectedPaymentMethod] || selectedPaymentMethod)
          : 'Pay later / in person';
        const pmIcon = selectedPaymentMethod && selectedPaymentMethod !== 'later' ? '\ud83d\udcb3' : '\u23ed\ufe0f';
        pmEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--accent-bg);border:1.5px solid var(--border);border-radius:12px;font-size:13px;color:var(--text);"><span>' + pmIcon + '</span><span>Payment: <strong>' + pmDisplay + '</strong></span></div>';
      }
    }

    async function submitBooking() {
      const btn = document.getElementById("btnSubmit");
      const errEl = document.getElementById("bookError");
      // Check consent
      if (!document.getElementById('consentCheck').checked) {
        errEl.textContent = 'Please agree to the Terms of Service and Privacy Policy';
        errEl.style.display = 'block';
        return;
      }
      btn.disabled = true;
      btn.textContent = "Submitting...";
      errEl.style.display = "none";

      try {
        const totalDur = getTotalDuration();
        // Build notes with extra items and staff
        let notesText = document.getElementById("bookingNotes").value.trim();
        if (selectedStaff) {
          notesText = (notesText ? notesText + String.fromCharCode(10) : '') + 'Preferred staff: ' + selectedStaff.name;
        }
        if (cart.length > 0) {
          const extras = cart.map(c => c.name + ' ($' + c.price.toFixed(2) + ')').join(', ');
          notesText = (notesText ? notesText + String.fromCharCode(10) : '') + 'Additional items: ' + extras;
        }

        const chargedPrice = getChargedPrice();
        const extraItems = cart.map(c => ({ name: c.name, price: c.price, type: c.type }));

        // ── Card payment: book first, then redirect to Stripe Checkout ──────
        if (selectedPaymentMethod === 'card' && PAYMENT_METHODS.stripeEnabled && chargedPrice > 0) {
          btn.textContent = 'Creating booking...';
          const bookRes = await fetch(API + "/book", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientName: document.getElementById("clientName").value.trim(),
              clientPhone: document.getElementById("clientPhone").value.replace(/\\D/g, ""),
              clientEmail: document.getElementById("clientEmail").value.trim(),
              serviceLocalId: selectedService.localId,
              date: selectedDate,
              time: selectedTime,
              duration: totalDur,
              notes: notesText,
              giftCode: appliedGift ? document.getElementById("giftCode").value.trim() : null,
              totalPrice: chargedPrice,
              extraItems: extraItems,
              giftApplied: !!appliedGift,
              giftUsedAmount: appliedGift ? getGiftUsedAmount() : 0,
              discountName: appliedPromo ? (appliedDiscount ? appliedDiscount.name + ' + ' + appliedPromo.label : appliedPromo.label) : (appliedDiscount ? appliedDiscount.name : null),
              discountPercentage: (appliedDiscount ? appliedDiscount.percentage : 0) + (appliedPromo && appliedPromo.percentage > 0 ? appliedPromo.percentage : 0),
              discountAmount: getDiscountAmount(),
              subtotal: getTotalPrice(),
              locationId: selectedLocation || null,
              paymentMethod: 'card',
              paymentConfirmationNumber: paymentConfirmationNumber || null,
              promoCode: appliedPromo ? appliedPromo.code : null,
              promoLocalId: appliedPromo ? appliedPromo.localId : null,
              clientAddress: isMobileService() ? getClientAddressString() : null,
              travelFee: isMobileService() ? (dynamicTravelFee != null ? dynamicTravelFee : (selectedService.travelFee ? parseFloat(selectedService.travelFee) : null)) : null,
            }),
          });
          const bookData = await bookRes.json();
          if (!bookRes.ok) {
            errEl.textContent = bookData.error || 'Failed to submit booking';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Confirm Booking';
            return;
          }
          // Create Stripe Checkout session
          btn.textContent = 'Redirecting to payment...';
          const origin = window.location.origin;
          const successUrl = origin + window.location.pathname + '?payment=success&session_id={CHECKOUT_SESSION_ID}';
          const cancelUrl = origin + window.location.pathname + '?payment=cancelled';
          const checkoutRes = await fetch('/api/stripe-connect/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessOwnerId: PAYMENT_METHODS.businessOwnerId,
              appointmentLocalId: bookData.appointmentId || bookData.localId || '',
              clientName: document.getElementById('clientName').value.trim(),
              serviceName: selectedService.name,
              amount: chargedPrice,
              successUrl: successUrl,
              cancelUrl: cancelUrl,
            }),
          });
          const checkoutData = await checkoutRes.json();
          if (!checkoutRes.ok || !checkoutData.url) {
            errEl.textContent = checkoutData.error || 'Failed to create payment session. Your booking is saved — please pay in person.';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Confirm Booking';
            return;
          }
          window.location.href = checkoutData.url;
          return;
        }

        const res = await fetch(API + "/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: document.getElementById("clientName").value.trim(),
            clientPhone: document.getElementById("clientPhone").value.replace(/\\D/g, ""),
            clientEmail: document.getElementById("clientEmail").value.trim(),
            serviceLocalId: selectedService.localId,
            date: selectedDate,
            time: selectedTime,
            duration: totalDur,
            notes: notesText,
            giftCode: appliedGift ? document.getElementById("giftCode").value.trim() : null,
            totalPrice: chargedPrice,
            extraItems: extraItems,
            giftApplied: !!appliedGift,
            giftUsedAmount: appliedGift ? getGiftUsedAmount() : 0,
            discountName: appliedPromo ? (appliedDiscount ? appliedDiscount.name + ' + ' + appliedPromo.label : appliedPromo.label) : (appliedDiscount ? appliedDiscount.name : null),
            discountPercentage: (appliedDiscount ? appliedDiscount.percentage : 0) + (appliedPromo && appliedPromo.percentage > 0 ? appliedPromo.percentage : 0),
            discountAmount: getDiscountAmount(),
            subtotal: getTotalPrice(),
            locationId: selectedLocation || null,
            paymentMethod: (selectedPaymentMethod && selectedPaymentMethod !== 'later') ? selectedPaymentMethod : 'later',
            paymentConfirmationNumber: paymentConfirmationNumber || null,
            promoCode: appliedPromo ? appliedPromo.code : null,
            promoLocalId: appliedPromo ? appliedPromo.localId : null,
            clientAddress: isMobileService() ? getClientAddressString() : null,
            travelFee: isMobileService() ? (dynamicTravelFee != null ? dynamicTravelFee : (selectedService.travelFee ? parseFloat(selectedService.travelFee) : null)) : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.textContent = data.error || "Failed to submit booking";
          errEl.style.display = "block";
          btn.disabled = false;
          btn.textContent = "Confirm Booking";
          return;
        }
        // Show success with detailed receipt
        for (let i = 0; i <= 8; i++) { const el = document.getElementById("step-" + i); if (el) el.style.display = "none"; }
        document.getElementById("step-indicator").style.display = "none";
        const locBanner = document.getElementById('selectedLocBanner'); if (locBanner) locBanner.classList.remove('show');
        document.getElementById("step-8").style.display = "block";
        renderSuccessReceipt();
        renderPaymentSection();
        // Show manage link
        if (data.manageUrl) {
          document.getElementById('manageLinkHref').href = data.manageUrl;
          const reschedEl = document.getElementById('rescheduleHref');
          if (reschedEl) reschedEl.href = data.manageUrl + '#reschedule';
          document.getElementById('manageLink').style.display = 'block';
        }
        window.scrollTo(0, 0);
      } catch(e) {
        errEl.textContent = "Network error. Please try again.";
        errEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Confirm Booking";
      }
    }

    function renderSuccessReceipt() {
      const d = new Date(selectedDate + "T12:00:00");
      const dateStr = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const h = parseInt(selectedTime.split(":")[0]);
      const m = selectedTime.split(":")[1];
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const timeStr = h12 + ":" + m + " " + ampm;
      const totalDur = getTotalDuration();
      const endMin = h * 60 + parseInt(m) + totalDur;
      const endH = Math.floor(endMin / 60);
      const endM = endMin % 60;
      const endAmpm = endH >= 12 ? "PM" : "AM";
      const endH12 = endH === 0 ? 12 : endH > 12 ? endH - 12 : endH;
      const endStr = endH12 + ":" + String(endM).padStart(2,"0") + " " + endAmpm;
      const totalPrice = getTotalPrice();

      let html = '<div style="margin-bottom:12px;font-weight:700;font-size:15px;color:var(--accent-dark);border-bottom:2px solid var(--border);padding-bottom:8px;">Booking Receipt</div>';

      // Items list
      html += '<div style="margin-bottom:12px;">';
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span>\u2022 ' + esc(selectedService.name) + ' (' + selectedService.duration + ' min)</span><span style="font-weight:600;">$' + parseFloat(selectedService.price).toFixed(2) + '</span></div>';
      cart.forEach(c => {
        const durLabel = c.duration > 0 ? ' (' + c.duration + ' min)' : '';
        const typeLabel = c.type === 'product' ? ' [Product]' : '';
        html += '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span>\u2022 ' + esc(c.name) + durLabel + typeLabel + '</span><span style="font-weight:600;">$' + c.price.toFixed(2) + '</span></div>';
      });
      html += '</div>';

      // Date & Time
      html += '<div style="border-top:1px solid #e8ece8;padding-top:10px;margin-bottom:10px;">';
      html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Date</span><span style="font-weight:600;">' + dateStr + '</span></div>';
      html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Time</span><span style="font-weight:600;">' + timeStr + ' \u2014 ' + endStr + '</span></div>';
      html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Total Duration</span><span style="font-weight:600;">' + totalDur + ' min</span></div>';
      if (selectedStaff) {
        html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Staff</span><span style="font-weight:600;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (selectedStaff.color || '#6366f1') + ';margin-right:4px;"></span>' + esc(selectedStaff.name) + '</span></div>';
      }
      if (selectedLocation) {
        const locR = locations.find(l => l.localId === selectedLocation);
        if (locR) {
          const fullLocAddrR = buildFullAddress(locR.address, locR.city, locR.state, locR.zipCode) || locR.address || '';
          const locLabelR = fullLocAddrR ? esc(locR.name) + ' — ' + esc(fullLocAddrR) : esc(locR.name);
          html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:4px 0;font-size:13px;"><span style="color:#666;flex-shrink:0;">Location</span><span style="font-weight:600;text-align:right;">📍 ' + locLabelR + '</span></div>';
        }
      }
      html += '</div>';

      // Price breakdown
      let chargedPriceR = getChargedPrice();
      let giftUsedR = getGiftUsedAmount();
      let discountAmtR = getDiscountAmount();

      html += '<div style="border-top:2px solid var(--accent);padding-top:10px;">';
      // Subtotal
      html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Subtotal</span><span>$' + totalPrice.toFixed(2) + '</span></div>';

      // Discount line
      if (appliedDiscount && discountAmtR > 0) {
        html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#b45309;"><span>\ud83c\udf89 ' + esc(appliedDiscount.name) + ' (' + appliedDiscount.percentage + '% off)</span><span>-$' + discountAmtR.toFixed(2) + '</span></div>';
      }

      // Gift card line
      if (appliedGift && giftUsedR > 0) {
           html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--accent-dark);"><span>🎁 Gift Card</span><span>-$' + giftUsedR.toFixed(2) + '</span></div>';
      }

      // Final total
      let finalStr = '$' + chargedPriceR.toFixed(2);
      if (chargedPriceR === 0 && (discountAmtR > 0 || giftUsedR > 0)) finalStr = 'FREE';
      html += '<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:16px;font-weight:700;border-top:1px solid var(--border);margin-top:4px;"><span>Total to Pay</span><span style="color:var(--accent-dark);">' + finalStr + '</span></div>';

      // Savings badge
      const totalSavedR = discountAmtR + giftUsedR;
      if (totalSavedR > 0) {
        html += '<div style="background:var(--accent-bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin-top:8px;font-size:11px;color:var(--accent-dark);text-align:center;">You saved <strong>$' + totalSavedR.toFixed(2) + '</strong> on this booking!</div>';
      }
      html += '</div>';

      // Client info
      html += '<div style="border-top:1px solid #e8ece8;padding-top:10px;margin-top:10px;font-size:12px;color:#888;">';
      html += 'Client: ' + esc(document.getElementById("clientName").value);
      const phone = document.getElementById("clientPhone").value;
      if (phone) html += ' \u2022 ' + phone;
      html += '</div>';

      document.getElementById("successReceipt").innerHTML = html;
    }

    function renderPaymentSection() {
      const methods = paymentMethods || {};
      if (!methods.zelle && !methods.cashApp && !methods.venmo) return;
      const chargedPrice = getChargedPrice ? getChargedPrice() : (getTotalPrice ? getTotalPrice() : 0);
      const amountStr = '$' + chargedPrice.toFixed(2);
      const isPaylater = !selectedPaymentMethod || selectedPaymentMethod === 'later';
      const showMethod = (!isPaylater && selectedPaymentMethod) ? selectedPaymentMethod : null;
      const sectionTitle = isPaylater ? '\uD83D\uDCB0 How to Pay' : '\uD83D\uDCB0 Payment Confirmation';
      const sectionSubtitle = isPaylater
        ? 'Tap a payment method to view the QR code and send <strong>' + amountStr + '</strong> before your appointment'
        : 'Please send <strong>' + amountStr + '</strong> using the payment method you selected';
      let html = '<div style="border:1.5px solid var(--border);border-radius:14px;padding:16px;background:var(--accent-bg);">';
      html += '<div style="font-weight:700;font-size:15px;color:var(--accent-dark);margin-bottom:4px;">' + sectionTitle + '</div>';
      html += '<div style="font-size:13px;color:var(--accent-dark);margin-bottom:14px;">' + sectionSubtitle + '</div>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">';
      if (methods.zelle && (!showMethod || showMethod === 'zelle')) {
        const handle = methods.zelle;
        const deepLink = 'zelle://' + encodeURIComponent(handle);
        html += '<button onclick="openQrModal(' + JSON.stringify('Zelle') + ',' + JSON.stringify(handle) + ',' + JSON.stringify(deepLink) + ',' + JSON.stringify('#6d28d9') + ',' + JSON.stringify('\uD83D\uDC9C') + ')" style="flex:1;min-width:130px;max-width:200px;background:#fff;border-radius:12px;padding:16px 12px;border:2px solid #6d28d9;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;">';
        html += '<div style="font-size:28px;">\uD83D\uDC9C</div>';
        html += '<div style="font-weight:700;font-size:14px;color:#6d28d9;">Zelle</div>';
        html += '<div style="font-size:11px;color:#888;word-break:break-all;">' + esc(handle) + '</div>';
        html += '<div style="font-size:11px;color:#6d28d9;font-weight:600;background:#f3e8ff;border-radius:6px;padding:4px 8px;">Tap to view QR</div>';
        html += '</button>';
      }
      if (methods.cashApp && (!showMethod || showMethod === 'cashapp')) {
        const tag = methods.cashApp.startsWith('$') ? methods.cashApp : '$' + methods.cashApp;
        const deepLink = 'https://cash.app/' + encodeURIComponent(tag) + '/' + chargedPrice.toFixed(2);
        html += '<button onclick="openQrModal(' + JSON.stringify('Cash App') + ',' + JSON.stringify(tag) + ',' + JSON.stringify(deepLink) + ',' + JSON.stringify('#00a827') + ',' + JSON.stringify('\uD83D\uDC9A') + ')" style="flex:1;min-width:130px;max-width:200px;background:#fff;border-radius:12px;padding:16px 12px;border:2px solid #00d632;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;">';
        html += '<div style="font-size:28px;">\uD83D\uDC9A</div>';
        html += '<div style="font-weight:700;font-size:14px;color:#00a827;">Cash App</div>';
        html += '<div style="font-size:11px;color:#888;word-break:break-all;">' + esc(tag) + '</div>';
        html += '<div style="font-size:11px;color:#00a827;font-weight:600;background:#dcfce7;border-radius:6px;padding:4px 8px;">Tap to view QR</div>';
        html += '</button>';
      }
      if (methods.venmo && (!showMethod || showMethod === 'venmo')) {
        const tag = methods.venmo.startsWith('@') ? methods.venmo : '@' + methods.venmo;
        const deepLink = 'https://venmo.com/' + encodeURIComponent(tag.replace('@','')) + '?txn=pay&amount=' + chargedPrice.toFixed(2) + '&note=' + encodeURIComponent('Appointment payment');
        html += '<button onclick="openQrModal(' + JSON.stringify('Venmo') + ',' + JSON.stringify(tag) + ',' + JSON.stringify(deepLink) + ',' + JSON.stringify('#3d95ce') + ',' + JSON.stringify('\uD83D\uDC99') + ')" style="flex:1;min-width:130px;max-width:200px;background:#fff;border-radius:12px;padding:16px 12px;border:2px solid #3d95ce;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;">';
        html += '<div style="font-size:28px;">\uD83D\uDC99</div>';
        html += '<div style="font-weight:700;font-size:14px;color:#3d95ce;">Venmo</div>';
        html += '<div style="font-size:11px;color:#888;word-break:break-all;">' + esc(tag) + '</div>';
        html += '<div style="font-size:11px;color:#3d95ce;font-weight:600;background:#dbeafe;border-radius:6px;padding:4px 8px;">Tap to view QR</div>';
        html += '</button>';
      }
      html += '</div>';
      html += '<div style="font-size:11px;color:#888;margin-top:10px;">Tap a payment method to open the QR code and pay directly from your phone.</div>';
      html += '</div>';
      const el = document.getElementById('paymentSection');
      if (el) { el.innerHTML = html; el.style.display = 'block'; }
    }
    function openQrModal(method, handle, deepLink, color, icon) {
      const overlay = document.getElementById('qrModalOverlay');
      if (!overlay) return;
      document.getElementById('qrModalTitle').textContent = icon + ' ' + method;
      document.getElementById('qrModalTitle').style.color = color;
      document.getElementById('qrModalHandle').textContent = handle;
      const canvasContainer = document.getElementById('qrModalCanvas');
      canvasContainer.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvasContainer.appendChild(canvas);
      // Generate QR code using qrcode.js library
      const qrValue = deepLink || handle;
      function generateQR() {
        if (typeof QRCode !== 'undefined') {
          QRCode.toCanvas(canvas, qrValue, { width: 200, margin: 2, color: { dark: color || '#000000', light: '#ffffff' } }, function(err) {
            if (err) {
              canvasContainer.innerHTML = '<div style="font-size:13px;color:#888;padding:20px;">QR code unavailable</div>';
            }
          });
        } else {
          // Fallback: load qrcode.js dynamically if not already loaded
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
          script.onload = function() {
            QRCode.toCanvas(canvas, qrValue, { width: 200, margin: 2, color: { dark: color || '#000000', light: '#ffffff' } }, function(err) {
              if (err) canvasContainer.innerHTML = '<div style="font-size:13px;color:#888;padding:20px;">QR code unavailable</div>';
            });
          };
          document.head.appendChild(script);
        }
      }
      generateQR();
      const linkEl = document.getElementById('qrModalLink');
      if (linkEl) {
        linkEl.href = deepLink || '#';
        linkEl.textContent = 'Open ' + method + ' App';
        linkEl.style.color = color;
        linkEl.style.background = color + '15';
        linkEl.style.border = '1.5px solid ' + color;
      }
      const hintEl = document.getElementById('qrModalHint');
      if (hintEl) hintEl.textContent = 'Scan with ' + method + ' to pay ' + (document.getElementById('qrModalHandle') ? document.getElementById('qrModalHandle').textContent : '');
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
    function closeQrModal() {
      const overlay = document.getElementById('qrModalOverlay');
      if (overlay) overlay.style.display = 'none';
      document.body.style.overflow = '';
    }

    function addToCalendar() {
      // Build .ics (iCalendar) file for Apple Calendar / Google Calendar
      const d = new Date(selectedDate + "T12:00:00");
      const h = parseInt(selectedTime.split(":")[0]);
      const m = parseInt(selectedTime.split(":")[1]);
      const totalDur = getTotalDuration();
      // Format as YYYYMMDDTHHMMSS (local time with no Z suffix so device uses local tz)
      function icsDate(year, month, day, hours, mins) {
        return String(year) +
          String(month + 1).padStart(2, "0") +
          String(day).padStart(2, "0") + "T" +
          String(hours).padStart(2, "0") +
          String(mins).padStart(2, "0") + "00";
      }
      const startDt = icsDate(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      const endMin = h * 60 + m + totalDur;
      const endDt = icsDate(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(endMin / 60), endMin % 60);
      const uid = "lot-" + SLUG + "-" + selectedDate + "-" + selectedTime.replace(":", "") + "@lime-of-time.com";
      // Build location string — prefer selected location, fall back to owner address
      let locStr = "";
      if (selectedLocation) {
        const locR = locations.find(l => l.localId === selectedLocation);
        if (locR) {
          const fullAddr = buildFullAddress(locR.address, locR.city, locR.state, locR.zipCode) || locR.address || "";
          locStr = fullAddr ? locR.name + ", " + fullAddr : locR.name;
        }
      } else if (locations.length === 1) {
        const locR = locations[0];
        const fullAddr = buildFullAddress(locR.address, locR.city, locR.state, locR.zipCode) || locR.address || "";
        locStr = fullAddr ? locR.name + ", " + fullAddr : locR.name;
      }
      if (!locStr) locStr = ${JSON.stringify(owner.address || '')};
      // Build description
      const chargedPriceC = getChargedPrice();
      const clientNameVal = (document.getElementById("clientName") || {}).value || "";
      const clientPhoneVal = (document.getElementById("clientPhone") || {}).value || "";
      let desc = selectedService.name + " (" + selectedService.duration + " min) - $" + parseFloat(selectedService.price).toFixed(2);
      cart.forEach(c => { desc += "\\n" + c.name + " - $" + c.price.toFixed(2); });
      desc += "\\nTotal: $" + chargedPriceC.toFixed(2);
      if (clientNameVal) desc += "\\nClient: " + clientNameVal;
      if (clientPhoneVal) desc += " - " + clientPhoneVal;
      if (locStr) desc += "\\nLocation: " + locStr;
      desc += "\\nBooked via Lime Of Time";
      // Escape ICS special chars
      function icsEsc(s) { return (s || "").replace(/\\\\/g, "\\\\\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\\n/g, "\\n"); }
      const summary = icsEsc(selectedService.name + " @ " + "${escHtml(owner.businessName)}");
      const icsLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Lime Of Time//Booking//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:" + uid,
        "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z",
        "DTSTART:" + startDt,
        "DTEND:" + endDt,
        "SUMMARY:" + summary,
        locStr ? "LOCATION:" + icsEsc(locStr) : "",
        "DESCRIPTION:" + icsEsc(desc),
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR"
      ].filter(l => l !== "").join("\\r\\n");
      // iOS/Android: use data URI with webcal-compatible MIME type so the OS opens the native Calendar app
      // Desktop: fall back to Blob download
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroid = /Android/.test(navigator.userAgent);
      if (isIOS || isAndroid) {
        // data: URI approach — iOS Safari and Android Chrome both intercept text/calendar and open native Calendar
        const encoded = encodeURIComponent(icsLines);
        const dataUri = "data:text/calendar;charset=utf-8," + encoded;
        window.location.href = dataUri;
      } else {
        // Desktop: standard Blob download
        try {
          const blob = new Blob([icsLines], { type: "text/calendar;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "appointment.ics";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch(e) {
          // Fallback: data URI for browsers that don't support createObjectURL
          const encoded = encodeURIComponent(icsLines);
          const a = document.createElement("a");
          a.href = "data:text/calendar;charset=utf-8," + encoded;
          a.download = "appointment.ics";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }
    }

    function saveReceipt() {
      const d = new Date(selectedDate + "T12:00:00");
      const dateStr = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const h = parseInt(selectedTime.split(":")[0]);
      const m = selectedTime.split(":")[1];
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const timeStr = h12 + ":" + m + " " + ampm;
      const totalDur = getTotalDuration();
      const endMin = h * 60 + parseInt(m) + totalDur;
      const endH = Math.floor(endMin / 60);
      const endM = endMin % 60;
      const endAmpm = endH >= 12 ? "PM" : "AM";
      const endH12 = endH === 0 ? 12 : endH > 12 ? endH - 12 : endH;
      const endStr = endH12 + ":" + String(endM).padStart(2,"0") + " " + endAmpm;
      const totalPrice = getTotalPrice();

      let lines = [];
      lines.push("BOOKING RECEIPT");
      lines.push("${escHtml(owner.businessName)}");
      lines.push("=".repeat(35));
      lines.push("");
      lines.push("SERVICES & PRODUCTS:");
      lines.push("  " + selectedService.name + " (" + selectedService.duration + " min) - $" + parseFloat(selectedService.price).toFixed(2));
      cart.forEach(c => {
        const durLabel = c.duration > 0 ? " (" + c.duration + " min)" : "";
        const typeLabel = c.type === "product" ? " [Product]" : "";
        lines.push("  " + c.name + durLabel + typeLabel + " - $" + c.price.toFixed(2));
      });
      lines.push("");
      lines.push("DATE: " + dateStr);
      lines.push("TIME: " + timeStr + " - " + endStr);
      lines.push("DURATION: " + totalDur + " min");
      lines.push("-".repeat(35));
      const chargedPriceT = getChargedPrice();
      const giftUsedT = getGiftUsedAmount();
      const discountAmtT = getDiscountAmount();
      lines.push("SUBTOTAL: $" + totalPrice.toFixed(2));
      if (appliedDiscount && discountAmtT > 0) {
        lines.push("DISCOUNT: " + appliedDiscount.name + " (" + appliedDiscount.percentage + "% off): -$" + discountAmtT.toFixed(2));
      }
      if (appliedGift && giftUsedT > 0) {
        lines.push("GIFT CARD: -$" + giftUsedT.toFixed(2));
      }
      lines.push("TOTAL DUE: $" + chargedPriceT.toFixed(2));
      const totalSavedT = discountAmtT + giftUsedT;
      if (totalSavedT > 0) {
        lines.push("YOU SAVED: $" + totalSavedT.toFixed(2));
      }
      lines.push("");
      lines.push("Client: " + document.getElementById("clientName").value);
      const phone = document.getElementById("clientPhone").value;
      if (phone) lines.push("Phone: " + phone);
      lines.push("");
      lines.push("Thank you for your booking!");

      const blob = new Blob([lines.join(String.fromCharCode(10))], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "booking-receipt.txt";
      a.click();
      URL.revokeObjectURL(url);
    }

    async function applyPromoCode() {
      const input = document.getElementById("promoCodeInput");
      const msgEl = document.getElementById("promoMsg");
      const code = input.value.trim().toUpperCase();
      if (!code) {
        appliedPromo = null;
        msgEl.textContent = "";
        renderConfirmation();
        return;
      }
      msgEl.textContent = "Checking...";
      msgEl.style.color = "#888";
      try {
        const res = await fetch(API + "/promo/" + encodeURIComponent(code));
        const data = await res.json();
        if (!res.ok) {
          appliedPromo = null;
          msgEl.textContent = "\u274C " + (data.error || "Invalid promo code");
          msgEl.style.color = "var(--error, #ef4444)";
        } else {
          appliedPromo = data;
          const discStr = data.percentage > 0 ? data.percentage + "% off" : "$" + parseFloat(data.flatAmount || 0).toFixed(2) + " off";
          msgEl.textContent = "\u2705 " + data.label + " \u2014 " + discStr;
          msgEl.style.color = "var(--success, #22c55e)";
        }
      } catch(e) {
        appliedPromo = null;
        msgEl.textContent = "\u274C Could not validate promo code";
        msgEl.style.color = "var(--error, #ef4444)";
      }
      renderConfirmation();
    }

    async function applyGiftCode() {
      const code = document.getElementById("giftCode").value.trim();
      const msg = document.getElementById("giftMsg");
      if (!code) { msg.innerHTML = ""; return; }
      try {
        const res = await fetch(window.location.origin + "/api/public/gift/" + encodeURIComponent(code));
        if (!res.ok) {
          msg.innerHTML = '<span style="color:#dc2626;">Invalid or expired gift code</span>';
          appliedGift = null;
          return;
        }
        const data = await res.json();
        if (data.redeemed && data.remainingBalance <= 0) {
          msg.innerHTML = '<span style="color:#dc2626;">This gift card has been fully redeemed</span>';
          appliedGift = null;
          return;
        }
        if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
          msg.innerHTML = '<span style="color:#dc2626;">This gift card has expired</span>';
          appliedGift = null;
          return;
        }
        const balance = data.remainingBalance || 0;
        if (balance <= 0) {
          msg.innerHTML = '<span style="color:#dc2626;">This gift card has no remaining balance</span>';
          appliedGift = null;
          return;
        }
        msg.innerHTML = '<span style="color:#2d5a27;">\u2713 Gift card applied! Balance: $' + balance.toFixed(2) + '</span>';
        appliedGift = data;
        // Pre-select the primary gifted service
        const svc = services.find(s => s.localId === data.serviceLocalId || s.name === data.serviceName);
        if (svc) selectService(svc.localId);
        // Pre-add gifted extra services and products to cart
        if (data.serviceIds && data.serviceIds.length > 1) {
          data.serviceIds.slice(1).forEach(sid => {
            if (!cart.find(c => c.id === sid)) {
              const s = services.find(sv => sv.localId === sid);
              if (s) cart.push({ type: 'service', id: s.localId, name: s.name, price: parseFloat(s.price), duration: s.duration });
            }
          });
        }
        if (data.productIds && data.productIds.length > 0) {
          data.productIds.forEach(pid => {
            if (!cart.find(c => c.id === pid)) {
              const p = products.find(pr => pr.localId === pid);
              if (p) cart.push({ type: 'product', id: p.localId, name: p.name, price: parseFloat(p.price), duration: 0 });
            }
          });
        }
      } catch(e) {
        msg.innerHTML = '<span style="color:#dc2626;">Failed to verify gift code</span>';
        appliedGift = null;
      }
    }

    function esc(str) {
      if (!str) return "";
      return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    // Alias for backward compat
    const escHtml = esc;

    // Auto-fill gift code from URL parameter (when coming from gift card page)
    function autoFillGift() {
      const params = new URLSearchParams(window.location.search);
      const giftParam = params.get("gift");
      if (giftParam) {
        const giftInput = document.getElementById("giftCode");
        if (giftInput) {
          giftInput.value = giftParam;
          // Auto-apply after services load
          setTimeout(() => applyGiftCode(), 1500);
        }
      }
    }

    async function joinWaitlist() {
      const name = document.getElementById("clientName").value.trim();
      const phone = document.getElementById("clientPhone").value.trim();
      const email = document.getElementById("clientEmail").value.trim();
      if (!name) { alert("Please enter your name first (Step 2 - Your Information)"); return; }
      if (!selectedService) { alert("Please select a service first"); return; }
      if (!selectedDate) { alert("Please select a date first"); return; }
      const msgEl = document.getElementById("waitlistMsg");
      try {
        const res = await fetch(window.location.origin + "/api/public/business/${escHtml(slug)}/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientName: name, clientPhone: phone, clientEmail: email, serviceLocalId: selectedService, preferredDate: selectedDate })
        });
        const data = await res.json();
        if (data.success) {
          msgEl.style.display = "block";
          msgEl.style.background = "var(--bg-selected)";
          msgEl.style.color = "var(--accent-dark)";
          msgEl.innerHTML = "\u2705 " + data.message;
        } else {
          msgEl.style.display = "block";
          msgEl.style.background = "var(--error-bg)";
          msgEl.style.color = "var(--error)";
          msgEl.innerHTML = data.error || "Failed to join waitlist";
        }
      } catch(e) {
        msgEl.style.display = "block";
        msgEl.style.background = "var(--error-bg)";
        msgEl.style.color = "var(--error)";
        msgEl.innerHTML = "Network error. Please try again.";
      }
    }

    // Init — load locations first; if a location is preselected, scope initial data to it
    loadLocations().then(() => {
      renderLocationSelector();
      // checkTopLevelLocClosed must run before updateBizAddressCard so it can auto-set
      // selectedLocation when there is only one location (no ?location= param in URL)
      checkTopLevelLocClosed();
      updateBizAddressCard();
      // Use preselected location for initial data load if available
      loadServices(selectedLocation);
      loadWorkingDays(selectedLocation);
      // Auto-advance past location step if location is already determined
      // (preselected via URL param, or only one location exists)
      // IMPORTANT: do NOT auto-advance when returning from Stripe Checkout
      // (payment=success in URL) — handlePaymentReturn() will show the receipt instead
      const _urlParamsInit = new URLSearchParams(window.location.search);
      const _isPaymentReturn = _urlParamsInit.get('payment') === 'success';
      if (selectedLocation && !${JSON.stringify(!!owner.temporaryClosed)} && !_isPaymentReturn) {
        // Small delay to let the page render first
        const _intentParam = _urlParamsInit.get('intent');
        if (_intentParam === 'book') {
          // Came from "Book for Myself" on the intent page — skip intent step, go to Info
          setTimeout(() => goToStep(1), 50);
        } else {
          // Show intent step (Book for Myself / Buy a Gift)
          setTimeout(() => goToIntentStep(), 50);
        }
      }
    });

    function checkTopLevelLocClosed() {
      // Determine which location to check: preselected or the only one
      let locToCheck = null;
      if (selectedLocation) {
        locToCheck = locations.find(function(l) { return l.localId === selectedLocation; });
      } else if (locations.length === 1) {
        locToCheck = locations[0];
        selectedLocation = locToCheck.localId; // auto-select the only location
      }
      const banner = document.getElementById('topLocClosedBanner');
      const msgEl = document.getElementById('topLocClosedMsg');
      const continueBtn = document.getElementById('locContinueBtn');
      if (!banner || !msgEl) return;
      if (locToCheck && locToCheck.temporarilyClosed) {
        const reopenOn = locToCheck.reopenOn || null;
        let msg = '';
        if (reopenOn) {
          const d = new Date(reopenOn + 'T00:00:00');
          const formatted = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          msg = locToCheck.name + ' is temporarily closed and will reopen on ' + formatted + '. No new bookings are being accepted until then.';
        } else {
          msg = (locToCheck.name || 'This location') + ' is temporarily closed for an indefinite period. No new bookings are being accepted at this time. Please check back later.';
        }
        msgEl.textContent = msg;
        banner.classList.add('show');
        // Disable the Continue button on location step
        if (continueBtn) { continueBtn.disabled = true; continueBtn.style.opacity = '0.5'; }
      } else {
        banner.classList.remove('show');
        // Re-enable the Continue button
        if (continueBtn) { continueBtn.disabled = false; continueBtn.style.opacity = ''; }
      }
    }
    loadProducts();
    loadDiscounts();
    loadStaff();
    autoFillGift();

    // ── Handle Stripe payment success redirect ──────────────────────────
    (async function handlePaymentReturn() {
      const params = new URLSearchParams(window.location.search);
      const paymentParam = params.get('payment');
      const sessionId = params.get('session_id');
      if (paymentParam === 'success' && sessionId) {
        // Show a loading state while we fetch the appointment
        for (let i = 0; i <= 8; i++) { const el = document.getElementById('step-' + i); if (el) el.style.display = 'none'; }
        document.getElementById('step-indicator').style.display = 'none';
        const locBannerL = document.getElementById('selectedLocBanner'); if (locBannerL) locBannerL.classList.remove('show');
        const loadingEl = document.getElementById('step-8');
        if (loadingEl) {
          loadingEl.style.display = 'block';
          loadingEl.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="font-size:48px;margin-bottom:16px;">⏳</div><p style="color:#666;">Confirming your payment...</p></div>';
        }
        window.scrollTo(0, 0);
        try {
          const res = await fetch(API + '/appointment-by-session?session_id=' + encodeURIComponent(sessionId));
          const data = await res.json();
          if (data.ok && data.appointment) {
            const a = data.appointment;
            // Format date
            const [yr, mo, dy] = (a.date || '').split('-').map(Number);
            const dateObj = new Date(yr, mo - 1, dy);
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            // Format time
            const [hh, mm] = (a.time || '00:00').split(':').map(Number);
            const ampm = hh >= 12 ? 'PM' : 'AM';
            const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
            const timeStr = h12 + ':' + String(mm).padStart(2,'0') + ' ' + ampm;
            const endMin = hh * 60 + mm + (a.duration || 60);
            const eh = Math.floor(endMin / 60), em = endMin % 60;
            const eampm = eh >= 12 ? 'PM' : 'AM';
            const eh12 = eh === 0 ? 12 : eh > 12 ? eh - 12 : eh;
            const endStr = eh12 + ':' + String(em).padStart(2,'0') + ' ' + eampm;
            const locationLine = a.locationName ? '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Location</span><span style="font-weight:600;text-align:right;max-width:60%;">' + (a.locationAddress ? a.locationName + '<br><span style="font-weight:400;color:#888;font-size:12px;">' + a.locationAddress + '</span>' : a.locationName) + '</span></div>' : '';
            const receiptHtml = '<div style="background:#f0faf0;border:1px solid #c3e6cb;border-radius:12px;padding:16px;text-align:left;margin-bottom:16px;">' +
              '<div style="font-size:13px;font-weight:600;color:#155724;margin-bottom:10px;">✅ Payment Confirmed — Booking Receipt</div>' +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Client</span><span style="font-weight:600;">' + a.clientName + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Service</span><span style="font-weight:600;">' + a.serviceName + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Date</span><span style="font-weight:600;">' + dateStr + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Time</span><span style="font-weight:600;">' + timeStr + ' — ' + endStr + '</span></div>' +
              locationLine +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#666;">Payment</span><span style="font-weight:600;">💳 Card</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:16px;font-weight:700;border-top:1px solid #c3e6cb;margin-top:4px;"><span>Total Paid</span><span style="color:#155724;">$' + parseFloat(a.totalPrice || '0').toFixed(2) + '</span></div>' +
              '</div>';
            document.getElementById('successReceipt').innerHTML = receiptHtml;
            if (a.manageUrl) {
              const ml = document.getElementById('manageLinkHref');
              if (ml) ml.href = a.manageUrl;
              const reschedEl2 = document.getElementById('rescheduleHref');
              if (reschedEl2) reschedEl2.href = a.manageUrl + '#reschedule';
              const mlWrap = document.getElementById('manageLink');
              if (mlWrap) mlWrap.style.display = 'block';
            }
            // Populate calendar variables so addToCalendar() works after Stripe redirect
            selectedDate = a.date || '';
            selectedTime = a.time || '00:00';
            if (!selectedService && a.serviceName) {
              selectedService = { name: a.serviceName, duration: a.duration || 60, price: a.totalPrice || '0', localId: '' };
            }
            // Re-render the step-6 success screen properly
            for (let i = 0; i <= 8; i++) { const el = document.getElementById('step-' + i); if (el) el.style.display = 'none'; }
            document.getElementById('step-indicator').style.display = 'none';
            const locBannerS = document.getElementById('selectedLocBanner'); if (locBannerS) locBannerS.classList.remove('show');
            document.getElementById('step-8').style.display = 'block';
            // Clear the URL params so a refresh doesn't re-trigger this
            window.history.replaceState({}, '', window.location.pathname);
          } else {
            // Appointment not found — render the full success screen using booking context
            renderSuccessReceipt();
            for (let i = 0; i <= 8; i++) { const el = document.getElementById('step-' + i); if (el) el.style.display = 'none'; }
            document.getElementById('step-indicator').style.display = 'none';
            const locBannerF = document.getElementById('selectedLocBanner'); if (locBannerF) locBannerF.classList.remove('show');
            document.getElementById('step-8').style.display = 'block';
            // Override the receipt to show card payment badge
            const receiptEl = document.getElementById('successReceipt');
            if (receiptEl && selectedService) {
              const cardBadge = '<div style="display:inline-flex;align-items:center;gap:6px;background:#f0faf0;border:1px solid #c3e6cb;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600;color:#155724;margin-bottom:12px;">💳 Paid by Card</div>';
              receiptEl.innerHTML = cardBadge + receiptEl.innerHTML;
            }
            window.history.replaceState({}, '', window.location.pathname);
          }
        } catch(e) {
          // On error — render the full success screen using booking context
          renderSuccessReceipt();
          for (let i = 0; i <= 8; i++) { const el = document.getElementById('step-' + i); if (el) el.style.display = 'none'; }
          document.getElementById('step-indicator').style.display = 'none';
          const locBannerE = document.getElementById('selectedLocBanner'); if (locBannerE) locBannerE.classList.remove('show');
          document.getElementById('step-8').style.display = 'block';
          window.history.replaceState({}, '', window.location.pathname);
        }
      } else if (paymentParam === 'cancelled') {
        // Payment was cancelled — show a message and let them retry
        const errEl = document.getElementById('bookError');
        if (errEl) {
          errEl.textContent = 'Payment was cancelled. Please try again or choose a different payment method.';
          errEl.style.display = 'block';
        }
        // Navigate back to step 6 (payment step)
        goToStep(6);
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
  </script>
</body>
</html>`;
}

function reviewPage(slug: string, owner: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Review ${escHtml(owner.businessName)} - Lime Of Time</title>
  ${baseStyles()}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escHtml(owner.businessName)}</h1>
      <div class="subtitle">Leave a Review</div>
    </div>

     <!-- Write Review Form -->
    <div class="card" id="reviewForm">
      <h2>Write a Review</h2>
      <div class="input-group">
        <label>Your Name *</label>
        <input type="text" id="reviewerName" placeholder="Your name">
      </div>
      <div class="input-group">
        <label>Phone (optional)</label>
        <input type="tel" id="reviewerPhone" placeholder="(000) 000-0000">
      </div>
      <div class="input-group">
        <label>Rating *</label>
        <div class="stars" id="starRating">
          <span class="star" onclick="setRating(1)" data-r="1">☆</span>
          <span class="star" onclick="setRating(2)" data-r="2">☆</span>
          <span class="star" onclick="setRating(3)" data-r="3">☆</span>
          <span class="star" onclick="setRating(4)" data-r="4">☆</span>
          <span class="star" onclick="setRating(5)" data-r="5">☆</span>
        </div>
      </div>
      <div class="input-group">
        <label>Comment</label>
        <textarea id="reviewComment" placeholder="Share your experience..."></textarea>
      </div>
      <div id="reviewError" class="error-msg" style="display:none"></div>
      <button class="btn btn-primary" onclick="submitReview()" id="btnReview">Submit Review</button>
    </div>
    <!-- Success -->
    <div class="card" id="reviewSuccess" style="display:none;text-align:center;">
      <div class="success-icon">✓</div>
      <h2 style="font-size:20px;margin-bottom:8px;">Thank You!</h2>
      <p style="color:#666;font-size:14px;">Your review has been submitted.</p>
    </div>
    <!-- Existing Reviews -->
    <div class="card" id="reviewsCard">
      <h2>Reviews</h2>
      <div id="reviewsList"><div class="loading">Loading reviews...</div></div>
    </div>
  </div>

  <script>
    const SLUG = "${slug.replace(/&/g, '\\u0026')}";
    const API = window.location.origin + "/api/public/business/" + encodeURIComponent(SLUG);
    let rating = 0;

    // Pre-fill name and phone from URL parameters
    (function prefillFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const name = params.get("name");
      const phone = params.get("phone");
      if (name) {
        document.getElementById("reviewerName").value = decodeURIComponent(name);
      }
      if (phone) {
        let v = phone.replace(/\\D/g, "");
        if (v.length >= 10) v = v.slice(v.length - 10);
        if (v.length >= 7) document.getElementById("reviewerPhone").value = "(" + v.slice(0,3) + ") " + v.slice(3,6) + "-" + v.slice(6);
        else if (v.length >= 4) document.getElementById("reviewerPhone").value = "(" + v.slice(0,3) + ") " + v.slice(3);
        else if (v.length > 0) document.getElementById("reviewerPhone").value = "(" + v;
      }
    })();

    document.getElementById("reviewerPhone").addEventListener("input", function(e) {
      let v = e.target.value.replace(/\\D/g, "");
      if (v.length > 10) v = v.slice(0, 10);
      if (v.length >= 7) e.target.value = "(" + v.slice(0,3) + ") " + v.slice(3,6) + "-" + v.slice(6);
      else if (v.length >= 4) e.target.value = "(" + v.slice(0,3) + ") " + v.slice(3);
      else if (v.length > 0) e.target.value = "(" + v;
      else e.target.value = "";
    });

    function setRating(r) {
      rating = r;
      document.querySelectorAll(".star").forEach(s => {
        s.textContent = parseInt(s.dataset.r) <= r ? "★" : "☆";
        s.style.color = parseInt(s.dataset.r) <= r ? "#f59e0b" : "#ccc";
      });
    }

    async function loadReviews() {
      try {
        const res = await fetch(API + "/reviews");
        const reviews = await res.json();
        const list = document.getElementById("reviewsList");
        if (reviews.length === 0) {
          list.innerHTML = '<div style="text-align:center;color:#888;padding:16px;font-size:14px;">No reviews yet. Be the first!</div>';
          return;
        }
        const avg = (reviews.reduce((s,r) => s + r.rating, 0) / reviews.length).toFixed(1);
        list.innerHTML = '<div style="text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:700;color:#2d5a27;">' + avg + '</span>' +
          '<span style="color:#f59e0b;margin-left:8px;">' + "★".repeat(Math.round(parseFloat(avg))) + '</span>' +
          '<span style="color:#888;font-size:13px;margin-left:4px;">(' + reviews.length + ' review' + (reviews.length > 1 ? "s" : "") + ')</span></div>' +
          reviews.map(r => {
            const date = new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            return '<div class="review-card">' +
              '<div class="review-stars">' + "★".repeat(r.rating) + "☆".repeat(5 - r.rating) + '</div>' +
              '<div class="review-name">' + escHtml(r.clientName) + '</div>' +
              (r.comment ? '<div class="review-comment">' + escHtml(r.comment) + '</div>' : '') +
              '<div class="review-date">' + date + '</div></div>';
          }).join("");
      } catch(e) {
        document.getElementById("reviewsList").innerHTML = '<div class="error-msg">Failed to load reviews</div>';
      }
    }

    async function submitReview() {
      const name = document.getElementById("reviewerName").value.trim();
      const errEl = document.getElementById("reviewError");
      if (!name) { errEl.textContent = "Please enter your name"; errEl.style.display = "block"; return; }
      if (rating === 0) { errEl.textContent = "Please select a rating"; errEl.style.display = "block"; return; }

      const btn = document.getElementById("btnReview");
      btn.disabled = true;
      btn.textContent = "Submitting...";
      errEl.style.display = "none";

      try {
        const res = await fetch(API + "/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: name,
            clientPhone: document.getElementById("reviewerPhone").value.replace(/\\D/g, ""),
            rating: rating,
            comment: document.getElementById("reviewComment").value.trim(),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          errEl.textContent = data.error || "Failed to submit review";
          errEl.style.display = "block";
          btn.disabled = false;
          btn.textContent = "Submit Review";
          return;
        }
        document.getElementById("reviewForm").style.display = "none";
        document.getElementById("reviewSuccess").style.display = "block";
        loadReviews();
      } catch(e) {
        errEl.textContent = "Network error. Please try again.";
        errEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Submit Review";
      }
    }

    function escHtml(str) {
      if (!str) return "";
      return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    loadReviews();
  </script>
</body>
</html>`;
}

function giftCardPage(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Gift Card - Lime Of Time</title>
  ${baseStyles()}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎁 Gift Card</h1>
      <div class="subtitle">Powered by Lime Of Time</div>
    </div>

    <div id="loading" class="card loading">Loading gift card details...</div>

    <div id="giftDetails" class="card" style="display:none;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">🎁</div>
      <div id="giftRecipient" style="font-size:14px;color:#888;margin-bottom:4px;"></div>
      <div id="giftBusiness" style="font-size:18px;font-weight:700;color:#2d5a27;margin-bottom:12px;"></div>
      <div id="giftService" style="font-size:16px;font-weight:600;margin-bottom:4px;"></div>
      <div id="giftValue" style="font-size:24px;font-weight:700;color:#2d5a27;margin-bottom:12px;"></div>
      <div id="giftMessage" style="font-size:14px;color:#666;font-style:italic;margin-bottom:12px;padding:12px;background:#f8fbf8;border-radius:10px;display:none;"></div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:12px;">
        <div id="giftCodeDisplay" style="font-size:18px;font-weight:700;letter-spacing:2px;color:#4a8c3f;background:#f0f7ef;padding:12px;border-radius:10px;flex:1;"></div>
        <button id="copyBtn" onclick="copyGiftCode()" style="background:#4a8c3f;color:#fff;border:none;border-radius:10px;padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">Copy</button>
      </div>
      <div id="giftExpiry" style="font-size:12px;color:#888;margin-bottom:16px;"></div>
      <div id="giftStatus"></div>
      <a id="bookLink" class="btn btn-primary" style="display:none;text-decoration:none;margin-top:12px;">Book Now</a>
    </div>

    <div id="giftError" class="card" style="display:none;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">😕</div>
      <h2 style="font-size:18px;margin-bottom:8px;">Gift Card Not Found</h2>
      <p style="color:#888;font-size:14px;">This gift card code is invalid or has expired.</p>
    </div>
  </div>

  <script>
    const CODE = "${escHtml(code)}";

    async function loadGift() {
      try {
        const res = await fetch(window.location.origin + "/api/public/gift/" + encodeURIComponent(CODE));
        document.getElementById("loading").style.display = "none";
        if (!res.ok) {
          document.getElementById("giftError").style.display = "block";
          return;
        }
        const data = await res.json();
        document.getElementById("giftDetails").style.display = "block";
        document.getElementById("giftBusiness").textContent = data.businessName;
        // Show all gifted items if available
        if (data.items && data.items.length > 0) {
          document.getElementById("giftService").innerHTML = data.items.map(function(it) {
            const icon = it.type === 'product' ? '📦' : '✂️';
            return icon + ' ' + it.name + ' — $' + it.price.toFixed(2);
          }).join('<br>');
        } else {
          document.getElementById("giftService").textContent = data.serviceName + " (" + data.serviceDuration + " min)";
        }
        const origVal = data.originalValue || parseFloat(data.servicePrice);
        const remBal = data.remainingBalance != null ? data.remainingBalance : origVal;
        if (remBal < origVal) {
          document.getElementById("giftValue").innerHTML = 'Original: $' + origVal.toFixed(2) + '<br><strong style="color:#2d5a27;">Balance: $' + remBal.toFixed(2) + '</strong>';
        } else {
          document.getElementById("giftValue").textContent = "Value: $" + origVal.toFixed(2);
        }
        document.getElementById("giftCodeDisplay").textContent = data.code;

        if (data.recipientName) {
          document.getElementById("giftRecipient").textContent = "For: " + data.recipientName;
        }
        if (data.message) {
          const msgEl = document.getElementById("giftMessage");
          msgEl.textContent = '"' + data.message + '"';
          msgEl.style.display = "block";
        }
        if (data.expiresAt) {
          document.getElementById("giftExpiry").textContent = "Expires: " + new Date(data.expiresAt + "T23:59:59").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        }

        if (data.redeemed && remBal <= 0) {
          document.getElementById("giftStatus").innerHTML = '<div style="color:#dc2626;font-weight:600;">This gift card has been fully redeemed</div>';
        } else if (remBal <= 0) {
          document.getElementById("giftStatus").innerHTML = '<div style="color:#dc2626;font-weight:600;">No remaining balance</div>';
        } else {
          document.getElementById("giftStatus").innerHTML = '<div style="color:#2d5a27;font-weight:600;">✓ Valid — Ready to use!</div>';
          const link = document.getElementById("bookLink");
          link.href = window.location.origin + "/api/book/" + data.businessSlug + "?gift=" + encodeURIComponent(data.code);
          link.style.display = "block";
        }
      } catch(e) {
        document.getElementById("loading").style.display = "none";
        document.getElementById("giftError").style.display = "block";
      }
    }

    function copyGiftCode() {
      const code = document.getElementById("giftCodeDisplay").textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
          const btn = document.getElementById("copyBtn");
          btn.textContent = "Copied!";
          btn.style.background = "#2d5a27";
          setTimeout(() => { btn.textContent = "Copy"; btn.style.background = "#4a8c3f"; }, 2000);
        }).catch(() => fallbackCopy(code));
      } else {
        fallbackCopy(code);
      }
    }

    function fallbackCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      const btn = document.getElementById("copyBtn");
      btn.textContent = "Copied!";
      btn.style.background = "#2d5a27";
      setTimeout(() => { btn.textContent = "Copy"; btn.style.background = "#4a8c3f"; }, 2000);
    }

    function escHtml(str) {
      if (!str) return "";
      return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    loadGift();
  </script>
</body>
</html>`;
}

function escHtml(str: string): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


function manageAppointmentPage(slug: string, owner: any, appt: any, client: any, locations: any[] = []): string {
  const bizName = escHtml(owner.businessName);
  const logoUri = owner.businessLogoUri || "";
  const logoTag = logoUri ? `<img src="${escHtml(logoUri)}" alt="${bizName}" class="biz-logo" />` : "";
  const apptDate = appt.date;
  const apptTime = formatTime12(appt.time);
  const statusClass = appt.status === "cancelled" ? "status-cancelled" : appt.status === "confirmed" ? "status-confirmed" : "status-pending";
  const isPending = appt.status === "pending";
  const isConfirmed = appt.status === "confirmed";
  const isCancellable = appt.status !== "cancelled" && appt.status !== "completed";
  const clientPhone = client?.phone || "";
  // Check if appointment is within 24 hours (for reschedule restriction)
  const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
  const now = new Date();
  const hoursUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const canReschedule = isConfirmed && hoursUntil > 24;
  // Request state (new request-based flow)
  const cancelReq = (appt as any).cancelRequest as { status: string; reason?: string; submittedAt: string } | null;
  const reschedReq = (appt as any).rescheduleRequest as { status: string; requestedDate: string; requestedTime: string; reason?: string; submittedAt: string } | null;
  const hasPendingCancelReq = cancelReq?.status === 'pending';
  const hasPendingReschedReq = reschedReq?.status === 'pending';
  const apptLocationId = appt.locationId || "";
  // Resolve the location object for display
  const apptLocation = locations.find((l: any) => l.localId === appt.locationId) ?? null;
  const apptLocationName = apptLocation?.name || "";
  const apptLocationAddr = (() => {
    if (!apptLocation) return "";
    const parts = [apptLocation.address, apptLocation.city, apptLocation.state, apptLocation.zipCode].filter(Boolean);
    return parts.join(", ");
  })();
  const apptLocationPhone = apptLocation?.phone || "";
  // Build both map URLs — JS on the page will pick the right one based on user agent
  const apptLocationMapUrlGoogle = apptLocationAddr
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(apptLocationAddr)}`
    : "";
  const apptLocationMapUrlApple = apptLocationAddr
    ? `https://maps.apple.com/?q=${encodeURIComponent(apptLocationAddr)}`
    : "";
  const apptLocationMapUrl = apptLocationMapUrlGoogle; // used as data attribute; JS selects the right one
  const apiBase = "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Manage Appointment — ${bizName}</title>
  <meta name="robots" content="noindex" />
  ${baseStyles()}
  <style>
    .appt-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .appt-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .appt-row:last-child { border-bottom: none; }
    .appt-label { color: var(--text-secondary); font-size: 14px; }
    .appt-value { font-weight: 600; font-size: 14px; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-confirmed { background: var(--accent-bg); color: var(--accent-dark); }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
    .status-completed { background: #e0e7ff; color: #3730a3; }
    .btn-cancel {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      background: var(--error);
      color: #fff;
      margin-top: 8px;
      transition: opacity 0.2s;
    }
    .btn-cancel:hover { opacity: 0.9; }
    .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-reschedule {
      width: 100%;
      padding: 14px;
      border: 2px solid var(--accent);
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      background: transparent;
      color: var(--accent);
      margin-top: 8px;
      transition: all 0.2s;
    }
    .btn-reschedule:hover { background: var(--accent-bg); }
    .phone-input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid var(--border-input);
      border-radius: 10px;
      font-size: 15px;
      background: var(--bg-input);
      color: var(--text);
      margin-top: 8px;
    }
    .phone-input:focus { outline: none; border-color: var(--accent); }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      margin: 24px 0 12px;
    }
    .msg-box {
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 14px;
      margin-top: 12px;
      display: none;
    }
    .msg-success { background: var(--accent-bg); color: var(--accent-dark); border: 1px solid var(--border); }
    .msg-error { background: var(--error-bg); color: var(--error); border: 1px solid var(--error-border); }
    .reschedule-panel { display: none; margin-top: 16px; }
    .reschedule-panel.active { display: block; }
    .date-input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid var(--border-input);
      border-radius: 10px;
      font-size: 15px;
      background: var(--bg-input);
      color: var(--text);
      margin-top: 8px;
    }
    .date-input:focus { outline: none; border-color: var(--accent); }
    .slot-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 12px;
    }
    .slot-btn {
      padding: 10px 4px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-card);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .slot-btn:hover { border-color: var(--accent); background: var(--accent-bg); }
    .slot-btn.selected { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); font-weight: 600; }
    .slot-loading { text-align: center; color: var(--text-muted); padding: 20px; font-size: 14px; }
    .btn-confirm-reschedule {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
      margin-top: 12px;
      transition: opacity 0.2s;
    }
    .btn-confirm-reschedule:hover { opacity: 0.9; }
    .btn-confirm-reschedule:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (prefers-color-scheme: dark) {
      .status-pending { background: #3a3018; color: #fbbf24; }
      .status-confirmed { background: #1e3a1a; color: #4ade80; }
      .status-cancelled { background: #3a1818; color: #f87171; }
      .status-completed { background: #1e1e3a; color: #818cf8; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoTag}
      <h1 style="font-size:22px;font-weight:700;">${bizName}</h1>
      <p style="color:var(--text-secondary);font-size:14px;margin-top:4px;">Manage Your Appointment</p>
    </div>

    <div class="appt-card">
      <div class="appt-row">
        <span class="appt-label">Date</span>
        <span class="appt-value">${escHtml(apptDate)}</span>
      </div>
      <div class="appt-row">
        <span class="appt-label">Time</span>
        <span class="appt-value">${apptTime}</span>
      </div>
      <div class="appt-row">
        <span class="appt-label">Duration</span>
        <span class="appt-value">${appt.duration || 60} min</span>
      </div>
      <div class="appt-row">
        <span class="appt-label">Status</span>
        <span class="status-badge ${statusClass}">${escHtml(appt.status)}</span>
      </div>
      ${apptLocationName ? `
      <div class="appt-row">
        <span class="appt-label">Location</span>
        <span class="appt-value" style="text-align:right;max-width:60%;">
          ${escHtml(apptLocationName)}
          ${apptLocationAddr ? `<br/>${apptLocationMapUrlGoogle ? `<a id="map-link" href="${escHtml(apptLocationMapUrlGoogle)}" data-google="${escHtml(apptLocationMapUrlGoogle)}" data-apple="${escHtml(apptLocationMapUrlApple)}" target="_blank" rel="noopener" style="font-size:12px;font-weight:400;color:var(--accent);text-decoration:none;">${escHtml(apptLocationAddr)} ↗</a><script>try{var ua=navigator.userAgent||'';if(/iPad|iPhone|iPod/.test(ua)&&!window.MSStream){var ml=document.getElementById('map-link');if(ml)ml.href=ml.getAttribute('data-apple');}}catch(e){}</script>` : `<span style="font-size:12px;font-weight:400;color:var(--text-secondary);">${escHtml(apptLocationAddr)}</span>`}` : ""}
          ${apptLocationPhone ? `<br/><a href="tel:${escHtml(apptLocationPhone)}" style="font-size:12px;font-weight:400;color:var(--accent);text-decoration:none;">📞 ${escHtml(apptLocationPhone)}</a>` : ""}
        </span>
      </div>` : ""}
    </div>

    ${isCancellable ? `
    <div id="action-section">
      <p class="section-title">Verify Your Identity</p>
      <input type="tel" id="phone-input" class="phone-input" placeholder="Phone number used when booking" value="${escHtml(clientPhone)}" ${clientPhone ? 'readonly style="background:var(--bg-card);opacity:0.8;"' : ''} />
      ${clientPhone ? '<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Phone auto-filled from your booking record</p>' : ''}

      ${hasPendingCancelReq ? `
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:4px;">⏳ Cancellation Request Pending</div>
        <div style="font-size:13px;color:#78350f;">Your request was submitted on ${new Date(cancelReq!.submittedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}. The business will review it and respond shortly.</div>
        ${cancelReq!.reason ? `<div style="font-size:12px;color:#92400e;margin-top:6px;">Reason: "${escHtml(cancelReq!.reason)}"</div>` : ''}
        <button onclick="withdrawRequest('cancel')" style="margin-top:10px;padding:8px 16px;background:transparent;border:1px solid #92400e;border-radius:8px;font-size:13px;font-weight:600;color:#92400e;cursor:pointer;">Withdraw Request</button>
      </div>
      ` : ''}
      ${cancelReq?.status === 'expired' ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#991b1b;margin-bottom:4px;">⏰ Cancellation Request Expired</div>
        <div style="font-size:13px;color:#7f1d1d;">Your request expired without a response. Your appointment remains as scheduled. Please contact the business directly if you still need to cancel.</div>
      </div>
      ` : ''}
      ${cancelReq?.status === 'withdrawn' ? `
      <div style="background:#f5f5f5;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#6b7280;margin-bottom:4px;">↩ Cancellation Request Withdrawn</div>
        <div style="font-size:13px;color:#9ca3af;">You withdrew your cancellation request. Your appointment remains as scheduled.</div>
      </div>
      ` : ''}
      ${reschedReq?.status === 'approved' ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#166534;margin-bottom:4px;">✅ Reschedule Approved</div>
        <div style="font-size:13px;color:#14532d;">Your appointment has been rescheduled to ${reschedReq!.requestedDate} at ${formatTime12(reschedReq!.requestedTime)}.</div>
      </div>
      ` : ''}
      ${cancelReq?.status === 'approved' ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#166534;margin-bottom:4px;">✅ Cancellation Approved</div>
        <div style="font-size:13px;color:#14532d;">Your appointment has been cancelled. If you paid by card, a refund will be processed within 5–10 business days.</div>
      </div>
      ` : ''}
      ${cancelReq?.status === 'declined' ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#991b1b;margin-bottom:4px;">❌ Cancellation Request Declined</div>
        <div style="font-size:13px;color:#7f1d1d;">The business has declined your cancellation request. Please contact them directly if you have questions.</div>
      </div>
      ` : ''}
      ${reschedReq?.status === 'declined' ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#991b1b;margin-bottom:4px;">❌ Reschedule Request Declined</div>
        <div style="font-size:13px;color:#7f1d1d;">The business has declined your reschedule request. Please contact them directly if you have questions.</div>
      </div>
      ` : ''}
      ${!hasPendingCancelReq && cancelReq?.status !== 'approved' ? `
      ${(() => {
        const cp = owner.cancellationPolicy;
        if (cp && cp.enabled) {
          const apptDt = new Date(`${appt.date}T${appt.time}:00`);
          const nowDt = new Date();
          const hrsUntil = (apptDt.getTime() - nowDt.getTime()) / (1000 * 60 * 60);
          if (hrsUntil <= cp.hoursBeforeAppointment) {
            const svcPrice = parseFloat(appt.totalPrice || appt.price || '0');
            const fee = (svcPrice * cp.feePercentage / 100).toFixed(2);
            return `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;color:#991b1b;"><strong>⚠️ Cancellation Fee Notice:</strong> This appointment is within <strong>${cp.hoursBeforeAppointment} hour${cp.hoursBeforeAppointment !== 1 ? 's' : ''}</strong> of the scheduled time. A <strong>${cp.feePercentage}% cancellation fee ($${fee})</strong> will apply if your request is approved.</div>`;
          } else {
            return `<div style="background:var(--accent-bg);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:12px;font-size:12px;color:var(--accent-dark);">Free cancellation available (more than ${cp.hoursBeforeAppointment} hours before appointment).</div>`;
          }
        }
        return '';
      })()}
      <div id="cancel-reason-section" style="display:none;margin-bottom:12px;">
        <textarea id="cancel-reason-input" placeholder="Reason for cancellation (optional)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;background:var(--bg-card);color:var(--text-primary);resize:vertical;min-height:80px;box-sizing:border-box;"></textarea>
      </div>
      <button class="btn-cancel" id="cancel-btn" onclick="requestCancellation()">Request Cancellation</button>
      ` : ''}

      ${isPending ? '<p style="font-size:12px;color:var(--text-secondary);margin-top:12px;text-align:center;">Your appointment is pending approval. You can request cancellation, but rescheduling is available only after the business confirms your appointment.</p>' : ''}

      ${(() => {
        const apptPrice2 = parseFloat(appt.totalPrice || appt.price || '0');
        const alreadyClientNotified = !!(appt as any).clientPaidNotifiedAt;
        const alreadyPaid = appt.paymentStatus === 'paid';
        if (apptPrice2 <= 0 || alreadyPaid) return '';
        if (alreadyClientNotified) {
          return '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-top:12px;font-size:13px;color:#166534;text-align:center;">✅ You already notified the business that you sent payment. They will confirm receipt shortly.</div>';
        }
        return `<button class="btn-reschedule" id="mark-paid-btn" onclick="markAsPaid()" style="margin-top:12px;background:#f0fdf4;border-color:#22c55e;color:#166534;">💰 I Sent Payment</button>
<div id="mark-paid-panel" style="display:none;margin-top:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;">
  <p style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">How did you pay?</p>
  <select id="pay-method-select" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--bg-card);color:var(--text-primary);margin-bottom:10px;">
    <option value="">Select payment method...</option>
    <option value="zelle">💜 Zelle</option>
    <option value="cashapp">💚 Cash App</option>
    <option value="venmo">💙 Venmo</option>
    <option value="cash">💵 Cash</option>
    <option value="card">💳 Card</option>
  </select>
  <input type="text" id="pay-note" placeholder="Optional note (e.g. confirmation #)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--bg-card);color:var(--text-primary);margin-bottom:10px;box-sizing:border-box;" />
  <button onclick="submitMarkPaid()" style="width:100%;padding:12px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;">✅ Notify Business</button>
</div>`;
      })()}

      ${hasPendingReschedReq ? `
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:14px;margin-top:8px;">
        <div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:4px;">⏳ Reschedule Request Pending</div>
        <div style="font-size:13px;color:#78350f;">You requested to reschedule to ${reschedReq!.requestedDate} at ${formatTime12(reschedReq!.requestedTime)}. The business will review it shortly.</div>
      </div>
      ` : ''}
      ${canReschedule && !hasPendingReschedReq && reschedReq?.status !== 'approved' ? `
      <button class="btn-reschedule" id="reschedule-toggle" onclick="toggleReschedule()">Request Reschedule</button>

      <div id="reschedule-panel" class="reschedule-panel">
        <p class="section-title">Pick a New Date & Time</p>
        <input type="date" id="new-date" class="date-input" min="${new Date().toISOString().split("T")[0]}" />
        <div id="slot-container"></div>
        <button class="btn-confirm-reschedule" id="confirm-reschedule-btn" onclick="confirmReschedule()" disabled>Submit Reschedule Request</button>
      </div>
      ` : ''}

      ${isConfirmed && !canReschedule ? '<p style="font-size:12px;color:var(--error);margin-top:12px;text-align:center;">Rescheduling requests are not available within 24 hours of the appointment time.</p>' : ''}

      <div id="msg-box" class="msg-box"></div>
    </div>
    ` : `
    <div style="text-align:center;padding:20px;color:var(--text-secondary);">
      <p>This appointment is <strong>${escHtml(appt.status)}</strong> and cannot be modified.</p>
    </div>
    `}

    ${(() => {
      // Show payment QR codes for upcoming confirmed/pending appointments
      const zelleHandle = (owner as any).zelleHandle || '';
      const cashAppHandle = (owner as any).cashAppHandle || '';
      const venmoHandle = (owner as any).venmoHandle || '';
      const hasPaymentHandles = zelleHandle || cashAppHandle || venmoHandle;
      const isUpcoming = appt.status === 'confirmed' || appt.status === 'pending';
      const apptPrice = parseFloat(appt.totalPrice || appt.price || '0');
      if (!hasPaymentHandles || !isUpcoming || apptPrice <= 0) return '';
      // If client already paid via card, don't show manual payment QR
      if (appt.paymentMethod === 'card') return '';
      const amountStr = '$' + apptPrice.toFixed(2);
      // Determine which method to show: if client selected a specific method, show only that
      const clientMethod = appt.paymentMethod; // 'zelle' | 'cashapp' | 'venmo' | 'cash' | null
      function qrUrl(text: string) {
        return 'https://chart.googleapis.com/chart?cht=qr&chs=180x180&choe=UTF-8&chl=' + encodeURIComponent(text);
      }
      const sectionTitle = clientMethod && clientMethod !== 'cash' ? '💰 Your Payment Method' : '💰 Pay for Your Appointment';
      const sectionSubtitle = clientMethod && clientMethod !== 'cash'
        ? 'Scan the QR code below to send <strong>' + escHtml(amountStr) + '</strong>'
        : 'Scan a QR code or tap to send <strong>' + escHtml(amountStr) + '</strong> before your appointment.';
      let html = '<div style="border:1.5px solid var(--border);border-radius:16px;padding:20px;background:var(--accent-bg);margin-bottom:16px;">';
      html += '<div style="font-weight:700;font-size:16px;color:var(--accent-dark);margin-bottom:4px;">' + sectionTitle + '</div>';
      html += '<div style="font-size:13px;color:var(--accent-dark);margin-bottom:16px;">' + sectionSubtitle + '</div>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">';
      // Show only the method the client selected, or all if no specific method chosen
      const showZelle = zelleHandle && (!clientMethod || clientMethod === 'zelle');
      const showCashApp = cashAppHandle && (!clientMethod || clientMethod === 'cashapp');
      const showVenmo = venmoHandle && (!clientMethod || clientMethod === 'venmo');
      if (showZelle) {
        const url = zelleHandle; // plain handle/email/phone as QR value
        html += '<div style="flex:1;min-width:130px;max-width:200px;background:#fff;border-radius:12px;padding:12px;border:2px solid #6d28d9;text-align:center;">';
        html += '<div style="font-weight:700;font-size:13px;color:#6d28d9;margin-bottom:8px;">💜 Zelle</div>';
        html += '<img src="' + qrUrl(url) + '" alt="Zelle QR" style="width:140px;height:140px;border-radius:8px;" loading="lazy">';
        html += '<div style="font-size:12px;color:#6d28d9;font-weight:600;margin-top:8px;word-break:break-all;">' + escHtml(zelleHandle) + '</div>';
        html += '</div>';
      }
      if (showCashApp) {
        const tag = cashAppHandle.startsWith('$') ? cashAppHandle : '$' + cashAppHandle;
        const url = 'https://cash.app/' + encodeURIComponent(tag) + '/' + apptPrice.toFixed(2);
        html += '<div style="flex:1;min-width:130px;max-width:200px;background:#fff;border-radius:12px;padding:12px;border:2px solid #00d632;text-align:center;">';
        html += '<div style="font-weight:700;font-size:13px;color:#00a827;margin-bottom:8px;">💚 Cash App</div>';
        html += '<a href="' + url + '" target="_blank" style="display:block;">';
        html += '<img src="' + qrUrl(url) + '" alt="Cash App QR" style="width:140px;height:140px;border-radius:8px;" loading="lazy">';
        html += '</a>';
        html += '<div style="font-size:12px;color:#00a827;font-weight:600;margin-top:8px;">' + escHtml(tag) + '</div>';
        html += '</div>';
      }
      if (showVenmo) {
        const tag = venmoHandle.startsWith('@') ? venmoHandle : '@' + venmoHandle;
        const handle = venmoHandle.startsWith('@') ? venmoHandle.slice(1) : venmoHandle;
        const url = 'https://venmo.com/' + encodeURIComponent(handle) + '?txn=pay&amount=' + apptPrice.toFixed(2) + '&note=' + encodeURIComponent('Appointment payment');
        html += '<div style="flex:1;min-width:130px;max-width:200px;background:#fff;border-radius:12px;padding:12px;border:2px solid #3d95ce;text-align:center;">';
        html += '<div style="font-weight:700;font-size:13px;color:#3d95ce;margin-bottom:8px;">💙 Venmo</div>';
        html += '<a href="' + url + '" target="_blank" style="display:block;">';
        html += '<img src="' + qrUrl(url) + '" alt="Venmo QR" style="width:140px;height:140px;border-radius:8px;" loading="lazy">';
        html += '</a>';
        html += '<div style="font-size:12px;color:#3d95ce;font-weight:600;margin-top:8px;">' + escHtml(tag) + '</div>';
        html += '</div>';
      }
      html += '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;text-align:center;">Tap any QR code to open the payment app directly on your phone.</div>';
      html += '</div>';
      return html;
    })()}

    ${(() => {
      // Request History section — show if any request has been made
      const requests: { type: string; status: string; submittedAt: string; reason?: string; requestedDate?: string; requestedTime?: string; resolvedAt?: string }[] = [];
      if (cancelReq) requests.push({ type: 'Cancellation', ...cancelReq });
      if (reschedReq) requests.push({ type: 'Reschedule', ...reschedReq });
      if (requests.length === 0) return '';
      const statusBadge = (s: string) => {
        const map: Record<string, [string, string]> = {
          pending: ['#78350f', '#fef3c7'],
          approved: ['#14532d', '#dcfce7'],
          declined: ['#7f1d1d', '#fee2e2'],
          expired: ['#374151', '#f3f4f6'],
          withdrawn: ['#374151', '#f3f4f6'],
        };
        const [color, bg] = map[s] ?? ['#374151', '#f3f4f6'];
        return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:${bg};color:${color};text-transform:capitalize;">${s}</span>`;
      };
      let html = '<div style="border:1.5px solid var(--border);border-radius:16px;padding:16px;margin-bottom:16px;">';
      html += '<div style="font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:12px;">📋 Request History</div>';
      for (const r of requests) {
        html += '<div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px;">';
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:13px;font-weight:600;color:var(--text-primary);">${r.type} Request</span>${statusBadge(r.status)}</div>`;
        html += `<div style="font-size:12px;color:var(--text-muted);">Submitted: ${new Date(r.submittedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>`;
        if (r.reason) html += `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">Reason: "${escHtml(r.reason)}"</div>`;
        if (r.type === 'Reschedule' && r.requestedDate) html += `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">Requested: ${r.requestedDate}${r.requestedTime ? ' at ' + formatTime12(r.requestedTime) : ''}</div>`;
        if ((r as any).resolvedAt) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">Resolved: ${new Date((r as any).resolvedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>`;
        if ((r as any).expiredAt) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">Expired: ${new Date((r as any).expiredAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>`;
        if ((r as any).withdrawnAt) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">Withdrawn: ${new Date((r as any).withdrawnAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>`;
        html += '</div>';
      }
      html += '</div>';
      return html;
    })()}

    <div style="text-align:center;margin-top:32px;">
      <a href="/api/book/${escHtml(slug)}" style="color:var(--accent);font-size:14px;text-decoration:none;">Book a new appointment</a>
    </div>

    <footer style="text-align:center;padding:24px 0 16px;color:var(--text-muted);font-size:12px;">
      <p>Powered by <strong>Lime of Time</strong></p>
      <div style="margin-top:8px;">
        <a href="/api/legal/privacy-policy" style="color:var(--text-muted);text-decoration:none;margin:0 8px;">Privacy</a>
        <a href="/api/legal/terms-of-service" style="color:var(--text-muted);text-decoration:none;margin:0 8px;">Terms</a>
      </div>
    </footer>
  </div>

  <script>
    const SLUG = '${slug.replace(/'/g, "\\'").replace(/&/g, '\\u0026')}';
    const SLUG_ENC = encodeURIComponent(SLUG);
    const APPT_ID = '${(appt.localId || "").replace(/'/g, "\\'")}';
    const APPT_LOCATION_ID = '${apptLocationId.replace(/'/g, "\\'")}';
    const API_BASE = '${apiBase}';
    let selectedSlot = null;

    function showMsg(text, isError) {
      const box = document.getElementById('msg-box');
      box.textContent = text;
      box.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success');
      box.style.display = 'block';
    }

    async function requestCancellation() {
      const phone = document.getElementById('phone-input').value.trim();
      if (!phone) { showMsg('Please enter your phone number to verify your identity.', true); return; }
      // Show reason textarea on first click, submit on second
      const reasonSection = document.getElementById('cancel-reason-section');
      const btn = document.getElementById('cancel-btn');
      if (reasonSection && reasonSection.style.display === 'none') {
        reasonSection.style.display = 'block';
        btn.textContent = 'Confirm Request';
        return;
      }
      const reason = document.getElementById('cancel-reason-input') ? document.getElementById('cancel-reason-input').value.trim() : '';
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      try {
        const res = await fetch(API_BASE + '/api/public/appointment/' + APPT_ID + '/request-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: SLUG, clientPhone: phone, reason: reason || undefined })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showMsg(data.message || 'Cancellation request submitted. The business will respond shortly.', false);
          setTimeout(function() { location.reload(); }, 1800);
        } else {
          showMsg(data.error || 'Failed to submit request.', true);
          btn.disabled = false;
          btn.textContent = 'Confirm Request';
        }
      } catch (e) {
        showMsg('Network error. Please try again.', true);
        btn.disabled = false;
        btn.textContent = 'Confirm Request';
      }
    }

    function toggleReschedule() {
      const panel = document.getElementById('reschedule-panel');
      panel.classList.toggle('active');
    }

    document.getElementById('new-date')?.addEventListener('change', async function() {
      const date = this.value;
      if (!date) return;
      const container = document.getElementById('slot-container');
      container.innerHTML = '<div class="slot-loading">Loading available times...</div>';
      selectedSlot = null;
      document.getElementById('confirm-reschedule-btn').disabled = true;
      try {
        const locParam = APPT_LOCATION_ID ? '&locationId=' + encodeURIComponent(APPT_LOCATION_ID) : '';
        const _reschedNow = new Date();
        const _reschedClientToday = _reschedNow.toLocaleDateString('en-CA');
        const _reschedNowMinutes = _reschedNow.getHours() * 60 + _reschedNow.getMinutes();
        const clientTimeParams = '&clientToday=' + encodeURIComponent(_reschedClientToday) + '&nowMinutes=' + _reschedNowMinutes;
        const res = await fetch(API_BASE + '/api/public/business/' + SLUG_ENC + '/slots?date=' + date + '&duration=${appt.duration || 60}' + locParam + clientTimeParams);
        const data = await res.json();
        if (data.slots && data.slots.length > 0) {
          container.innerHTML = '<div class="slot-grid">' + data.slots.map(function(s) {
            var h = parseInt(s.split(':')[0]);
            var m = s.split(':')[1];
            var ampm = h >= 12 ? 'PM' : 'AM';
            var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
            return '<button class="slot-btn" data-time="' + s + '" onclick="selectSlot(this, &apos;' + s + '&apos;)">' + h12 + ':' + m + ' ' + ampm + '</button>';
          }).join('') + '</div>';
        } else {
          container.innerHTML = '<div class="slot-loading">No available times for this date.</div>';
        }
      } catch (e) {
        container.innerHTML = '<div class="slot-loading" style="color:var(--error);">Failed to load times.</div>';
      }
    });

    function selectSlot(el, time) {
      document.querySelectorAll('.slot-btn').forEach(function(b) { b.classList.remove('selected'); });
      el.classList.add('selected');
      selectedSlot = time;
      document.getElementById('confirm-reschedule-btn').disabled = false;
    }

    async function confirmReschedule() {
      if (!selectedSlot) return;
      const phone = document.getElementById('phone-input').value.trim();
      if (!phone) { showMsg('Please enter your phone number to verify your identity.', true); return; }
      const newDate = document.getElementById('new-date').value;
      const btn = document.getElementById('confirm-reschedule-btn');
      btn.disabled = true;
      btn.textContent = 'Rescheduling...';
      try {
        const res = await fetch(API_BASE + '/api/public/appointment/' + APPT_ID + '/request-reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: SLUG, clientPhone: phone, requestedDate: newDate, requestedTime: selectedSlot })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showMsg(data.message || 'Reschedule request submitted! The business will review it shortly.', false);
          setTimeout(function() { location.reload(); }, 1800);
        } else {
          showMsg(data.error || 'Failed to submit request.', true);
          btn.disabled = false;
          btn.textContent = 'Submit Reschedule Request';
        }
      } catch (e) {
        showMsg('Network error. Please try again.', true);
        btn.disabled = false;
        btn.textContent = 'Confirm New Time';
      }
    }

    function markAsPaid() {
      const panel = document.getElementById('mark-paid-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    async function submitMarkPaid() {
      const phone = document.getElementById('phone-input').value.trim();
      if (!phone) { showMsg('Please enter your phone number to verify your identity.', true); return; }
      const method = document.getElementById('pay-method-select').value;
      if (!method) { showMsg('Please select how you paid.', true); return; }
      const note = document.getElementById('pay-note').value.trim();
      const btn = document.querySelector('#mark-paid-panel button[onclick="submitMarkPaid()"]') || document.querySelector('#mark-paid-panel button:last-child');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
      try {
        const res = await fetch(API_BASE + '/api/public/appointment/' + APPT_ID + '/mark-paid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: SLUG, clientPhone: phone, paymentMethod: method, paymentNote: note || undefined })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const panel = document.getElementById('mark-paid-panel');
          if (panel) panel.outerHTML = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-top:12px;font-size:13px;color:#166534;text-align:center;">✅ Payment notification sent! The business will confirm receipt shortly.</div>';
          const markBtn = document.getElementById('mark-paid-btn');
          if (markBtn) markBtn.style.display = 'none';
          showMsg(data.message || 'Payment notification sent!', false);
        } else {
          showMsg(data.error || 'Failed to send notification.', true);
          if (btn) { btn.disabled = false; btn.textContent = '✅ Notify Business'; }
        }
      } catch (e) {
        showMsg('Network error. Please try again.', true);
        if (btn) { btn.disabled = false; btn.textContent = '✅ Notify Business'; }
      }
    }
  </script>
</body>
</html>`;
}
