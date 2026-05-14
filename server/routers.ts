import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { sendAppointmentConfirmationEmail, sendPaymentReceiptEmail, sendDeletionScheduledEmail, sendAdminDeletionAlertEmail } from "./email";
import { sendExpoPush } from "./push";
import {
  getPlatformConfig,
  getBatchPlatformConfig,
  getTwilioTestModeFlag,
  getPublicPlans,
  getBusinessSubscriptionInfo,
  isSmsAllowed,
} from "./subscription";

// ─── Business Owner Router ───────────────────────────────────────────

const businessRouter = router({
  /** Check if a business owner exists by phone number */
  checkByPhone: publicProcedure
    .input(z.object({ phone: z.string().min(1) }))
    .query(async ({ input }) => {
      // Normalize to E.164 format so formatting differences don't cause lookup misses
      const normalized = db.normalizePhone(input.phone);
      const owner = await db.getBusinessOwnerByPhone(normalized);
      return owner ?? null;
    }),

  /** Check if a business owner exists by email (used for social login matching) */
  checkByEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const owner = await db.getBusinessOwnerByEmail(input.email.toLowerCase());
      return owner ?? null;
    }),

  /** Get business owner by ID */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const owner = await db.getBusinessOwnerById(input.id);
      return owner ?? null;
    }),

  /** Create a new business owner (onboarding) */
  create: publicProcedure
    .input(
      z.object({
        phone: z.string().min(1),
        businessName: z.string().min(1),
        ownerName: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        website: z.string().optional(),
        description: z.string().optional(),
        workingHours: z.any().optional(),
        photoUri: z.string().optional().nullable(),
        cancellationPolicy: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Always store phone in E.164 format (+1XXXXXXXXXX) for consistent lookup
      const normalizedPhone = db.normalizePhone(input.phone);
      // Guard against duplicate creation: if a business owner with this phone already exists, return it
      const existing = await db.getBusinessOwnerByPhone(normalizedPhone);
      if (existing) {
        // Still ensure userId is linked in case it wasn't set before
        const openId = `phone:${normalizedPhone}`;
        try {
          await db.upsertUser({ openId, name: null, loginMethod: "otp", lastSignedIn: new Date() });
          if (!existing.userId) {
            const userRecord = await db.getUserByOpenId(openId);
            if (userRecord) await db.updateBusinessOwner(existing.id, { userId: userRecord.id });
          }
        } catch (err) {
          console.warn("[create] Failed to link userId on existing owner:", err);
        }
        return existing;
      }
      const id = await db.createBusinessOwner({
        phone: normalizedPhone,
        businessName: input.businessName,
        ownerName: input.ownerName ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        website: input.website ?? null,
        description: input.description ?? null,
        workingHours: input.workingHours ?? null,
        cancellationPolicy: input.cancellationPolicy ?? null,
        onboardingComplete: true,
      });
      // Link userId so getBusinessOwnerByOpenId works immediately after onboarding
      // (phone-based login uses openId = 'phone:<normalizedPhone>')
      const openId = `phone:${normalizedPhone}`;
      try {
        await db.upsertUser({ openId, name: null, loginMethod: "otp", lastSignedIn: new Date() });
        const userRecord = await db.getUserByOpenId(openId);
        if (userRecord) {
          await db.updateBusinessOwner(id, { userId: userRecord.id });
        }
      } catch (err) {
        console.warn("[create] Failed to link userId to new business owner:", err);
      }
      const owner = await db.getBusinessOwnerById(id);
      return owner!;
    }),

  /** Update business owner settings */
  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        businessName: z.string().optional(),
        ownerName: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        website: z.string().optional(),
        description: z.string().optional(),
        businessLogoUri: z.string().optional(),
        coverPhotoUri: z.string().optional().nullable(),
        defaultDuration: z.number().optional(),
        notificationsEnabled: z.boolean().optional(),
        themeMode: z.enum(["light", "dark", "system"]).optional(),
        temporaryClosed: z.boolean().optional(),
        scheduleMode: z.enum(["weekly", "custom"]).optional(),
        workingHours: z.any().optional(),
        photoUri: z.string().optional().nullable(),
        cancellationPolicy: z.any().optional(),
        phone: z.string().optional(),
        bufferTime: z.number().optional(),
        slotInterval: z.number().optional(),
        customSlug: z.string().optional(),
        businessHoursEndDate: z.string().nullable().optional(),
        expoPushToken: z.string().nullable().optional(),
        autoCompleteEnabled: z.boolean().optional(),
        autoCompleteDelayMinutes: z.number().optional(),
        requestResponseWindowHours: z.number().optional(),
        notificationPreferences: z.any().optional(),
        smsTemplates: z.any().optional(),
        // Gift card validity
        giftValidDays: z.number().optional(),
        giftMinBalance: z.number().optional(),
        // Payment methods
        zelleHandle: z.string().optional(),
        cashAppHandle: z.string().optional(),
        venmoHandle: z.string().optional(),
        paymentNotes: z.string().optional(),
        instagramHandle: z.string().optional(),
        facebookHandle: z.string().optional(),
        tiktokHandle: z.string().optional(),
        // Client portal visibility
        clientPortalVisible: z.boolean().optional(),
        businessCategory: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      // Guard: skip DB call if no fields to update (prevents 'No values to set' error
      // when client sends only fields unknown to this schema which Zod strips)
      if (Object.keys(data).length > 0) {
        await db.updateBusinessOwner(id, data);
      }
      return db.getBusinessOwnerById(id);
    }),

  /** Schedule account deletion (30-day grace period) */
  scheduleDeletion: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const owner = await db.getBusinessOwnerById(input.id);
      if (!owner) throw new Error("Business not found");
      const now = new Date();
      const deletionDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await db.updateBusinessOwner(input.id, {
        pendingDeletionAt: now,
        deletionScheduledFor: deletionDate,
      } as Parameters<typeof db.updateBusinessOwner>[1]);
      // Send confirmation email to owner
      if (owner.email) {
        await sendDeletionScheduledEmail({
          businessName: owner.businessName,
          ownerName: owner.ownerName ?? null,
          email: owner.email,
          deletionDate,
        });
      }
      // Alert admin
      await sendAdminDeletionAlertEmail({
        businessName: owner.businessName,
        ownerName: owner.ownerName ?? null,
        email: owner.email ?? null,
        phone: owner.phone,
        businessOwnerId: owner.id,
        action: "scheduled",
        deletionDate,
      });
      return { success: true, deletionScheduledFor: deletionDate.toISOString() };
    }),

  /** Cancel a pending account deletion */
  cancelDeletion: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const owner = await db.getBusinessOwnerById(input.id);
      if (!owner) throw new Error("Business not found");
      await db.updateBusinessOwner(input.id, {
        pendingDeletionAt: null,
        deletionScheduledFor: null,
      } as Parameters<typeof db.updateBusinessOwner>[1]);
      // Alert admin
      await sendAdminDeletionAlertEmail({
        businessName: owner.businessName,
        ownerName: owner.ownerName ?? null,
        email: owner.email ?? null,
        phone: owner.phone,
        businessOwnerId: owner.id,
        action: "cancelled",
      });
      return { success: true };
    }),

  /** Delete business and all related data immediately */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const owner = await db.getBusinessOwnerById(input.id);
      if (owner) {
        // Alert admin before deletion (after, data is gone)
        await sendAdminDeletionAlertEmail({
          businessName: owner.businessName,
          ownerName: owner.ownerName ?? null,
          email: owner.email ?? null,
          phone: owner.phone,
          businessOwnerId: owner.id,
          action: "completed",
        });
      }
      await db.deleteBusinessOwner(input.id);
      return { success: true };
    }),

  /** Get all data for a business owner (bootstrap) */
  getFullData: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getFullBusinessData(input.id);
    }),
});

// ─── Services Router ─────────────────────────────────────────────────

const servicesRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getServicesByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        name: z.string().min(1),
        duration: z.number().min(1),
        price: z.string(),
        color: z.string(),
        category: z.string().optional(),
        locationIds: z.any().optional(),
        description: z.string().optional().nullable(),
        photoUri: z.string().optional().nullable(),
        reminderHours: z.number().optional().nullable(),
        serviceType: z.enum(['in_store', 'mobile']).optional(),
        travelFee: z.number().optional().nullable(),
        maxTravelDistance: z.number().optional().nullable(),
        travelDuration: z.number().int().optional().nullable(),
        travelRatePerMile: z.number().optional().nullable(),
        minTravelFee: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { reminderHours, travelFee, maxTravelDistance, travelDuration, travelRatePerMile, minTravelFee, ...rest } = input;
      const id = await db.createService({
        ...rest,
        reminderHours: reminderHours != null ? String(reminderHours) : null,
        travelFee: travelFee != null ? String(travelFee) : null,
        maxTravelDistance: maxTravelDistance != null ? String(maxTravelDistance) : null,
        travelDuration: travelDuration ?? null,
        travelRatePerMile: travelRatePerMile != null ? String(travelRatePerMile) : null,
        minTravelFee: minTravelFee != null ? String(minTravelFee) : null,
      } as any);
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        name: z.string().optional(),
        duration: z.number().optional(),
        price: z.string().optional(),
        color: z.string().optional(),
        category: z.string().optional(),
        locationIds: z.any().optional(),
        description: z.string().optional().nullable(),
        photoUri: z.string().optional().nullable(),
        reminderHours: z.number().optional().nullable(),
        serviceType: z.enum(['in_store', 'mobile']).optional(),
        travelFee: z.number().optional().nullable(),
        maxTravelDistance: z.number().optional().nullable(),
        travelDuration: z.number().int().optional().nullable(),
        travelRatePerMile: z.number().optional().nullable(),
        minTravelFee: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, reminderHours, travelFee, maxTravelDistance, travelDuration, travelRatePerMile, minTravelFee, ...rest } = input;
      const svc = await db.getServiceByLocalId(localId, businessOwnerId);
      if (!svc) throw new Error(`Service not found: ${localId}`);
      await db.updateService(svc.id, businessOwnerId, {
        ...rest,
        reminderHours: reminderHours != null ? String(reminderHours) : null,
        travelFee: travelFee != null ? String(travelFee) : null,
        maxTravelDistance: maxTravelDistance != null ? String(maxTravelDistance) : null,
        travelDuration: travelDuration ?? null,
        travelRatePerMile: travelRatePerMile != null ? String(travelRatePerMile) : null,
        minTravelFee: minTravelFee != null ? String(minTravelFee) : null,
      } as any);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteService(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Clients Router ──────────────────────────────────────────────────

const clientsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getClientsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        birthday: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Normalize phone to E.164 before storing
      const normalizedInput = input.phone
        ? { ...input, phone: db.normalizePhone(input.phone) }
        : input;
      const id = await db.createClient(normalizedInput);
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        birthday: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...data } = input;
      // Normalize phone to E.164 before storing
      const normalizedData = data.phone
        ? { ...data, phone: db.normalizePhone(data.phone) }
        : data;
      await db.updateClient(localId, businessOwnerId, normalizedData);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteClient(input.localId, input.businessOwnerId);
      return { success: true };
    }),

  findByPhone: publicProcedure
    .input(z.object({ phone: z.string(), businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const client = await db.getClientByPhone(input.phone, input.businessOwnerId);
      return client ?? null;
    }),
});

// ─── Appointments Router ─────────────────────────────────────────────

const appointmentsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getAppointmentsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        serviceLocalId: z.string(),
        clientLocalId: z.string(),
        date: z.string(),
        time: z.string(),
        duration: z.number(),
        status: z.enum(["pending", "confirmed", "completed", "cancelled", "no_show"]).default("pending"),
        notes: z.string().optional(),
        totalPrice: z.number().optional(),
        extraItems: z.any().optional(),
        discountPercent: z.number().optional(),
        discountAmount: z.number().optional(),
        discountName: z.string().optional(),
        giftApplied: z.boolean().optional(),
        giftUsedAmount: z.number().optional(),
        staffId: z.string().optional(),
        locationId: z.string().optional(),
        clientAddress: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Convert numeric fields to string for decimal DB columns
      const dbInput: any = { ...input };
      if (input.totalPrice != null) dbInput.totalPrice = String(input.totalPrice);
      if (input.discountAmount != null) dbInput.discountAmount = String(input.discountAmount);
      if (input.giftUsedAmount != null) dbInput.giftUsedAmount = String(input.giftUsedAmount);
      if (input.extraItems) dbInput.extraItems = input.extraItems;
      const id = await db.createAppointment(dbInput);
      // ── Auto in-app message to client on new booking ─────────────────────────
      try {
        const [owner, enrichedAppt] = await Promise.all([
          db.getBusinessOwnerById(input.businessOwnerId),
          db.getEnrichedAppointment(input.localId, input.businessOwnerId),
        ]);
        if (owner && enrichedAppt?.clientPhone) {
          const normPhone = db.normalizePhone(enrichedAppt.clientPhone);
          const clientAcc = await db.getClientAccountByPhone(normPhone);
          if (clientAcc) {
            const sName = enrichedAppt.serviceName ?? "appointment";
            const dateStr = enrichedAppt.date ?? input.date;
            const timeStr = enrichedAppt.time ?? input.time;
            const locName = (enrichedAppt as any).locationName ?? "";
            const locAddr = (enrichedAppt as any).locationAddress
              ? `${(enrichedAppt as any).locationAddress}${(enrichedAppt as any).locationCity ? ", " + (enrichedAppt as any).locationCity : ""}`
              : "";
            const locLine = locName || locAddr ? `\n\ud83d\udccd ${locName}${locAddr ? (locName ? " \u2014 " : "") + locAddr : ""}` : "";
            const statusLabel = input.status === "confirmed" ? "confirmed" : "received and pending confirmation";
            const msgBody = `\ud83d\udcc5 Your ${sName} booking has been ${statusLabel}!\n\ud83d\udd52 ${dateStr} at ${timeStr}${locLine}\n\nWe look forward to seeing you! Reply here if you have any questions. \u2014 ${owner.businessName}`;
            await db.insertClientMessage({ businessOwnerId: input.businessOwnerId, clientAccountId: clientAcc.id, senderType: "business", body: msgBody }).catch(() => {});
          }
        }
      } catch { /* non-blocking */ }
      return { id, localId: input.localId };
    }),
  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        status: z.enum(["pending", "confirmed", "completed", "cancelled", "no_show"]).optional(),
        date: z.string().optional(),
        time: z.string().optional(),
        duration: z.number().optional(),
        notes: z.string().optional(),
        totalPrice: z.number().optional(),
        extraItems: z.any().optional(),
        discountPercent: z.number().optional(),
        discountAmount: z.number().optional(),
        discountName: z.string().optional(),
        giftApplied: z.boolean().optional(),
        giftUsedAmount: z.number().optional(),
        staffId: z.string().optional(),
        locationId: z.string().optional(),
        clientAddress: z.string().optional(),
        cancellationReason: z.string().optional(),
        paymentMethod: z.string().optional(),
        paymentStatus: z.enum(["unpaid", "pending_cash", "paid"]).optional(),
        paymentConfirmationNumber: z.string().optional(),
        cancelRequest: z.any().optional(),
        rescheduleRequest: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...data } = input;
      const dbData: any = { ...data };
      if (data.totalPrice != null) dbData.totalPrice = String(data.totalPrice);
      if (data.discountAmount != null) dbData.discountAmount = String(data.discountAmount);
      if (data.giftUsedAmount != null) dbData.giftUsedAmount = String(data.giftUsedAmount);
      await db.updateAppointment(localId, businessOwnerId, dbData);

      // Send confirmation email to client when appointment is accepted (status → confirmed)
      if (data.status === "confirmed") {
        try {
          const [owner, enrichedAppt] = await Promise.all([
            db.getBusinessOwnerById(businessOwnerId),
            db.getEnrichedAppointment(localId, businessOwnerId),
          ]);
          if (owner && enrichedAppt) {
            // Only send if owner has emailClientOnConfirmation preference explicitly enabled (default OFF)
            // Also respect the master notificationsEnabled toggle
            const prefs = (owner as any).notificationPreferences ?? {};
            const masterNotifOn = (owner as any).notificationsEnabled !== false;
            const emailEnabled = prefs.emailClientOnConfirmation === true;
            if (masterNotifOn && emailEnabled && enrichedAppt.clientEmail && enrichedAppt.clientEmail.includes("@")) {
              await sendAppointmentConfirmationEmail(owner.businessName, {
                clientName: enrichedAppt.clientName ?? "Valued Client",
                clientEmail: enrichedAppt.clientEmail,
                serviceName: enrichedAppt.serviceName ?? "Service",
                date: enrichedAppt.date,
                time: enrichedAppt.time,
                duration: enrichedAppt.duration ?? 60,
                totalPrice: enrichedAppt.totalPrice ? Number(enrichedAppt.totalPrice) : undefined,
                locationName: enrichedAppt.locationName ?? undefined,
                locationAddress: enrichedAppt.locationAddress ?? undefined,
                locationCity: enrichedAppt.locationCity ?? undefined,
                locationState: enrichedAppt.locationState ?? undefined,
                locationZip: enrichedAppt.locationZip ?? undefined,
                locationPhone: enrichedAppt.locationPhone ?? undefined,
                businessPhone: owner.phone ?? undefined,
                businessAddress: owner.address ?? undefined,
                customSlug: (owner as any).customSlug ?? undefined,
                locationId: enrichedAppt.locationId ?? undefined,
              });
            }
          }
        } catch (emailErr) {
          console.error("[Email] Failed to send confirmation email:", emailErr);
        }
      }

      // ── SMS notifications for status changes ────────────────────────
      // Helper to send SMS via Twilio platform credentials
      const sendStatusSms = async (toPhone: string, body: string, smsAction: "confirmation" | "reminder" | "rebooking" | "birthday" = "confirmation") => {
        try {
          const allowed = await isSmsAllowed(businessOwnerId, smsAction);
          if (!allowed) return;
          const accountSid = await getPlatformConfig("TWILIO_ACCOUNT_SID");
          const authToken = await getPlatformConfig("TWILIO_AUTH_TOKEN");
          const fromNumber = await getPlatformConfig("TWILIO_FROM_NUMBER");
          if (!accountSid || !authToken || !fromNumber) return;
          const testMode = await getPlatformConfig("TWILIO_TEST_MODE");
          if (testMode === "true") {
            console.log(`[SMS TEST MODE] To: ${toPhone} | Body: ${body}`);
            return;
          }
          const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
          const params = new URLSearchParams();
          params.append("From", fromNumber);
          params.append("To", toPhone);
          params.append("Body", body);
          const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
          await fetch(url, {
            method: "POST",
            headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          });
        } catch (smsErr) {
          console.error("[SMS] Failed to send status SMS:", smsErr);
        }
      };

      if (data.status === "confirmed" || data.status === "cancelled" || data.status === "completed" || data.status === "no_show") {
        try {
          const [owner, enrichedAppt] = await Promise.all([
            db.getBusinessOwnerById(businessOwnerId),
            db.getEnrichedAppointment(localId, businessOwnerId),
          ]);
          if (owner && enrichedAppt) {
            const prefs = (owner as any).notificationPreferences ?? {};
            const masterNotifOn = (owner as any).notificationsEnabled !== false;
            const clientPhone = enrichedAppt.clientPhone;
            if (masterNotifOn && clientPhone) {
              const clientName = enrichedAppt.clientName ?? "Valued Client";
              const serviceName = enrichedAppt.serviceName ?? "your appointment";
              const businessName = owner.businessName;
              if (data.status === "confirmed" && prefs.smsClientOnConfirmation === true) {
                await sendStatusSms(clientPhone, `Hi ${clientName}, your appointment for ${serviceName} has been confirmed by ${businessName}. See you soon!`);
              } else if (data.status === "cancelled" && prefs.smsClientOnCancellation === true) {
                await sendStatusSms(clientPhone, `Hi ${clientName}, your appointment for ${serviceName} with ${businessName} has been cancelled. Please contact us to reschedule.`);
              } else if (data.status === "completed" && prefs.smsClientOnCompletion === true) {
                await sendStatusSms(clientPhone, `Hi ${clientName}, thank you for visiting ${businessName}! We hope to see you again soon.`);
              } else if (data.status === "no_show" && prefs.smsClientOnNoShow === true) {
                await sendStatusSms(clientPhone, `Hi ${clientName}, we missed you today at ${businessName} for your ${serviceName} appointment. Please contact us to reschedule.`);
              }
            }
          }
        } catch (smsErr) {
          console.error("[SMS] Failed to send status change SMS:", smsErr);
        }
      }

      // ── Push notification to client portal user on status change ──────────────
      if (data.status === "confirmed" || data.status === "cancelled" || data.status === "completed") {
        try {
          const enrichedAppt = await db.getEnrichedAppointment(localId, businessOwnerId);
          if (enrichedAppt?.clientPhone) {
            const normalizedPhone = db.normalizePhone(enrichedAppt.clientPhone);
            const clientAcc = await db.getClientAccountByPhone(normalizedPhone);
            if (clientAcc?.expoPushToken) {
              const businessOwner = await db.getBusinessOwnerById(businessOwnerId);
              const bName = businessOwner?.businessName ?? "Your business";
              const sName = enrichedAppt.serviceName ?? "appointment";
              const dateStr = enrichedAppt.date ?? "";
              const timeStr = enrichedAppt.time ?? "";
              if (data.status === "confirmed") {
                await sendExpoPush(clientAcc.expoPushToken, {
                  title: `\u2705 Appointment Confirmed`,
                  body: `Your ${sName} with ${bName} on ${dateStr} at ${timeStr} is confirmed. See you soon!`,
                  data: { type: "appointment_confirmed" as any, appointmentId: localId, businessOwnerId },
                  channelId: "appointments",
                  sound: "default",
                });
              } else if (data.status === "cancelled") {
                await sendExpoPush(clientAcc.expoPushToken, {
                  title: `\u274c Appointment Cancelled`,
                  body: `Your ${sName} with ${bName} on ${dateStr} has been cancelled. Please contact us to reschedule.`,
                  data: { type: "appointment_cancelled" as any, appointmentId: localId, businessOwnerId },
                  channelId: "appointments",
                  sound: "default",
                });
              } else if (data.status === "completed") {
                // Dedup: only send the review push once per appointment.
                // Re-fetching the appointment row here is safe because updateAppointment
                // already ran above, so we get the latest state.
                const apptRow = await db.getAppointmentByLocalId(localId, businessOwnerId);
                if (!apptRow?.reviewNotifSentAt) {
                  await sendExpoPush(clientAcc.expoPushToken, {
                    title: `\u2b50 How was your visit?`,
                    body: `Your ${sName} with ${bName} is complete. Tap to leave a review!`,
                    data: { type: "appointment_completed" as any, appointmentId: localId, businessOwnerId },
                    channelId: "appointments",
                    sound: "default",
                  });
                  // Mark as sent so future auto-complete runs don't re-send
                  await db.updateAppointment(localId, businessOwnerId, { reviewNotifSentAt: new Date() } as any);
                }
              }
            }
          }
        } catch (pushErr) {
          console.error("[Push] Failed to send client push notification:", pushErr);
        }
      }

      // ── Auto in-app message to client on status change ──────────────────────
      if (data.status === "confirmed" || data.status === "cancelled" || data.status === "completed" || data.status === "no_show") {
        try {
          const [owner2, enrichedAppt2] = await Promise.all([
            db.getBusinessOwnerById(businessOwnerId),
            db.getEnrichedAppointment(localId, businessOwnerId),
          ]);
          if (owner2 && enrichedAppt2?.clientPhone) {
            const normPhone2 = db.normalizePhone(enrichedAppt2.clientPhone);
            const clientAcc2 = await db.getClientAccountByPhone(normPhone2);
            if (clientAcc2) {
              const bName2 = owner2.businessName;
              const sName2 = enrichedAppt2.serviceName ?? "appointment";
              const dateStr2 = enrichedAppt2.date ?? "";
              const timeStr2 = enrichedAppt2.time ?? "";
              const locName2 = (enrichedAppt2 as any).locationName ?? "";
              const locAddr2 = (enrichedAppt2 as any).locationAddress
                ? `${(enrichedAppt2 as any).locationAddress}${(enrichedAppt2 as any).locationCity ? ", " + (enrichedAppt2 as any).locationCity : ""}${(enrichedAppt2 as any).locationState ? ", " + (enrichedAppt2 as any).locationState : ""}`
                : "";
              const locLine2 = locName2 || locAddr2 ? `\n\ud83d\udccd ${locName2}${locAddr2 ? (locName2 ? " \u2014 " : "") + locAddr2 : ""}` : "";
              let autoMsg = "";
              if (data.status === "confirmed") {
                autoMsg = `\u2705 Your ${sName2} appointment has been confirmed!\n\ud83d\udcc5 ${dateStr2} at ${timeStr2}${locLine2}\n\nWe look forward to seeing you! Reply here if you have any questions. \u2014 ${bName2}`;
              } else if (data.status === "cancelled") {
                autoMsg = `\u274c Your ${sName2} appointment on ${dateStr2} has been cancelled. We\u2019re sorry for any inconvenience.\n\nPlease reply or call us to reschedule. \u2014 ${bName2}`;
              } else if (data.status === "completed") {
                // Dedup: only send the "thank you" in-app message once per appointment.
                // reviewNotifSentAt is set when the push is sent; if it's already set,
                // the message was already sent in a previous auto-complete run.
                const apptRow2 = await db.getAppointmentByLocalId(localId, businessOwnerId);
                if (!apptRow2?.reviewNotifSentAt) {
                  autoMsg = `\u2b50 Thank you for your visit! We hope you enjoyed your ${sName2}.\n\nWe\u2019d love to hear your feedback \u2014 feel free to leave a review. See you next time! \u2014 ${bName2}`;
                }
              } else if (data.status === "no_show") {
                autoMsg = `We missed you today for your ${sName2} appointment on ${dateStr2}. We hope everything is okay!\n\nPlease reply to reschedule at your convenience. \u2014 ${bName2}`;
              }
              if (autoMsg) {
                await db.insertClientMessage({ businessOwnerId, clientAccountId: clientAcc2.id, senderType: "business", body: autoMsg }).catch(() => {});
              }
            }
          }
        } catch (inAppErr) {
          console.error("[InAppMsg] Failed to send auto in-app message:", inAppErr);
        }
      }
      // ── Package session completion: send progress message to client ──────────
      if (data.status === "completed") {
        try {
          const apptRowPkg = await db.getAppointmentByLocalId(localId, businessOwnerId);
          const pkgBookingId = apptRowPkg?.packageBookingId;
          const sessionNumber = apptRowPkg?.sessionNumber; // 1-based
          const sessionTotal = apptRowPkg?.sessionTotal;
          const packageName = apptRowPkg?.packageName;
          if (pkgBookingId && sessionNumber != null && sessionTotal != null && sessionTotal > 1) {
            // Count how many sessions are now completed (including this one)
            const allSessions = await db.getAppointmentsByPackageBookingId(pkgBookingId, businessOwnerId);
            const completedCount = allSessions.filter((s) => s.status === "completed").length;
            const remainingCount = sessionTotal - completedCount;
            const pkgDisplayName = packageName ?? "your package";
            const progressMsg = remainingCount > 0
              ? `✅ Session ${sessionNumber} of ${sessionTotal} complete — ${remainingCount} session${remainingCount === 1 ? "" : "s"} remaining on your ${pkgDisplayName}.`
              : `🎉 All ${sessionTotal} sessions of your ${pkgDisplayName} are complete! Thank you for choosing us — we hope to see you again soon.`;
            // Find the client account to insert the message into the conversation thread
            const enrichedPkg = await db.getEnrichedAppointment(localId, businessOwnerId);
            if (enrichedPkg?.clientPhone) {
              const normPhonePkg = db.normalizePhone(enrichedPkg.clientPhone);
              const clientAccPkg = await db.getClientAccountByPhone(normPhonePkg);
              if (clientAccPkg) {
                // Insert into messaging conversation thread (pre-generated, visible in Messages tab)
                await db.insertClientMessage({ businessOwnerId, clientAccountId: clientAccPkg.id, senderType: "business", body: progressMsg }).catch(() => {});
                // Also send via SMS if Twilio is enabled
                await sendStatusSms(enrichedPkg.clientPhone, progressMsg, "confirmation").catch(() => {});
                // On final session: send a package-aware "How was your visit?" push notification
                if (remainingCount === 0 && clientAccPkg.expoPushToken) {
                  const owner3 = await db.getBusinessOwnerById(businessOwnerId);
                  const bName3 = owner3?.businessName ?? "us";
                  await sendExpoPush(clientAccPkg.expoPushToken, {
                    title: `⭐ How was your ${pkgDisplayName}?`,
                    body: `You’ve completed all ${sessionTotal} sessions with ${bName3}. We’d love to hear your feedback — tap to leave a review!`,
                    data: { type: "appointment_completed" as any, appointmentId: localId, businessOwnerId },
                    channelId: "appointments",
                    sound: "default",
                  }).catch(() => {});
                }
              }
            }
          }
        } catch (pkgErr) {
          console.error("[PkgProgress] Failed to send package session progress message:", pkgErr);
        }
      }
      // ── Notify client when owner declines a reschedule request ─────────────
      if (data.rescheduleRequest && (data.rescheduleRequest as any).status === "declined") {
        try {
          const [owner, enrichedAppt] = await Promise.all([
            db.getBusinessOwnerById(businessOwnerId),
            db.getEnrichedAppointment(localId, businessOwnerId),
          ]);
          if (owner && enrichedAppt) {
            const masterNotifOn = (owner as any).notificationsEnabled !== false;
            const prefs = (owner as any).notificationPreferences ?? {};
            const clientFirstName = (enrichedAppt.clientName ?? "there").split(" ")[0];
            const svcName = enrichedAppt.serviceName ?? "your appointment";
            const bName = owner.businessName;
            const originalDate = enrichedAppt.date ?? "";
            const smsBody = `Hi ${clientFirstName}, your reschedule request for ${svcName} was declined. Your original appointment on ${originalDate} is still confirmed. Please contact us if you need to make changes. \u2013 ${bName}`;
            // SMS notification (respects master toggle; uses confirmation pref as proxy)
            if (masterNotifOn && prefs.smsClientOnConfirmation !== false && enrichedAppt.clientPhone) {
              try { await sendStatusSms(enrichedAppt.clientPhone, smsBody); } catch { /* non-blocking */ }
            }
            // Push notification + in-app message to client portal user
            if (enrichedAppt.clientPhone) {
              try {
                const normalizedPhone = db.normalizePhone(enrichedAppt.clientPhone);
                const clientAcc = await db.getClientAccountByPhone(normalizedPhone);
                if (clientAcc?.expoPushToken) {
                  await sendExpoPush(clientAcc.expoPushToken, {
                    title: `\u274c Reschedule Request Declined`,
                    body: `Your reschedule request for ${svcName} with ${bName} was declined. Your original appointment on ${originalDate} is still confirmed.`,
                    data: { type: "reschedule_declined" as any, appointmentId: localId, businessOwnerId },
                    channelId: "appointments",
                    sound: "default",
                  });
                }
                if (clientAcc) {
                  await db.insertClientMessage({ businessOwnerId, clientAccountId: clientAcc.id, senderType: "business", body: `\u274c Your reschedule request for ${svcName} on ${originalDate} was declined. Your original appointment is still confirmed.\n\nPlease reply or call us if you need to make changes. \u2014 ${bName}` }).catch(() => {});
                }
              } catch { /* non-blocking */ }
            }
          }
        } catch (err) {
          console.error("[Notify] Failed to send reschedule decline notification:", err);
        }
      }

      // ── Notify client when owner approves a reschedule request ─────────────
      if (data.rescheduleRequest && (data.rescheduleRequest as any).status === "approved") {
        try {
          const [owner, enrichedAppt] = await Promise.all([
            db.getBusinessOwnerById(businessOwnerId),
            db.getEnrichedAppointment(localId, businessOwnerId),
          ]);
          if (owner && enrichedAppt) {
            const masterNotifOn = (owner as any).notificationsEnabled !== false;
            const prefs = (owner as any).notificationPreferences ?? {};
            const clientFirstName = (enrichedAppt.clientName ?? "there").split(" ")[0];
            const svcName = enrichedAppt.serviceName ?? "your appointment";
            const bName = owner.businessName;
            // Use the new date/time from the approved reschedule request
            const rr = data.rescheduleRequest as any;
            const newDate = rr.requestedDate ?? enrichedAppt.date ?? "";
            const newTime = rr.requestedTime ?? enrichedAppt.time ?? "";
            const smsBody = `Hi ${clientFirstName}, great news! Your reschedule request for ${svcName} with ${bName} has been approved. Your new appointment is on ${newDate}${newTime ? ` at ${newTime}` : ""}. See you then! \u2013 ${bName}`;
            // SMS notification
            if (masterNotifOn && prefs.smsClientOnConfirmation !== false && enrichedAppt.clientPhone) {
              try { await sendStatusSms(enrichedAppt.clientPhone, smsBody); } catch { /* non-blocking */ }
            }
            // Push notification + in-app message to client portal user
            if (enrichedAppt.clientPhone) {
              try {
                const normalizedPhone = db.normalizePhone(enrichedAppt.clientPhone);
                const clientAcc = await db.getClientAccountByPhone(normalizedPhone);
                if (clientAcc?.expoPushToken) {
                  await sendExpoPush(clientAcc.expoPushToken, {
                    title: `\u2705 Reschedule Approved!`,
                    body: `Your ${svcName} with ${bName} has been rescheduled to ${newDate}${newTime ? ` at ${newTime}` : ""}. See you then!`,
                    data: { type: "reschedule_approved" as any, appointmentId: localId, businessOwnerId },
                    channelId: "appointments",
                    sound: "default",
                  });
                }
                if (clientAcc) {
                  const locName3 = (enrichedAppt as any).locationName ?? "";
                  const locAddr3 = (enrichedAppt as any).locationAddress ? `${(enrichedAppt as any).locationAddress}${(enrichedAppt as any).locationCity ? ", " + (enrichedAppt as any).locationCity : ""}` : "";
                  const locLine3 = locName3 || locAddr3 ? `\n\ud83d\udccd ${locName3}${locAddr3 ? (locName3 ? " \u2014 " : "") + locAddr3 : ""}` : "";
                  await db.insertClientMessage({ businessOwnerId, clientAccountId: clientAcc.id, senderType: "business", body: `\u2705 Great news! Your reschedule request for ${svcName} has been approved.\n\ud83d\udcc5 New appointment: ${newDate}${newTime ? ` at ${newTime}` : ""}${locLine3}\n\nSee you then! \u2014 ${bName}` }).catch(() => {});
                }
              } catch { /* non-blocking */ }
            }
          }
        } catch (err) {
          console.error("[Notify] Failed to send reschedule approval notification:", err);
        }
      }

      // Send payment receipt email to client when appointment is marked paid
      if (data.paymentStatus === "paid") {
        try {
          const [owner, enrichedAppt] = await Promise.all([
            db.getBusinessOwnerById(businessOwnerId),
            db.getEnrichedAppointment(localId, businessOwnerId),
          ]);
          if (owner && enrichedAppt) {
            const prefs = (owner as any).notificationPreferences ?? {};
            const masterNotifOn = (owner as any).notificationsEnabled !== false;
            const emailEnabled = prefs.emailClientOnPaymentConfirmed === true;
            // Only send on paid plans (not solo/free)
            const planKey = (owner as any).subscriptionPlan ?? "solo";
            const isAdminOverride = !!(owner as any).adminOverride;
            const hasPaidPlan = isAdminOverride || (planKey !== "solo" && planKey !== "free");
            if (masterNotifOn && emailEnabled && hasPaidPlan && enrichedAppt.clientEmail && enrichedAppt.clientEmail.includes("@")) {
              await sendPaymentReceiptEmail(owner.businessName, {
                clientName: enrichedAppt.clientName ?? "Valued Client",
                clientEmail: enrichedAppt.clientEmail,
                serviceName: enrichedAppt.serviceName ?? "Service",
                date: enrichedAppt.date,
                time: enrichedAppt.time,
                duration: enrichedAppt.duration ?? 60,
                totalPrice: enrichedAppt.totalPrice ? Number(enrichedAppt.totalPrice) : undefined,
                paymentMethod: data.paymentMethod,
                paymentConfirmationNumber: data.paymentConfirmationNumber,
                locationName: enrichedAppt.locationName ?? undefined,
                locationAddress: enrichedAppt.locationAddress ?? undefined,
                businessPhone: owner.phone ?? undefined,
                customSlug: (owner as any).customSlug ?? undefined,
                locationId: enrichedAppt.locationId ?? undefined,
              });
            }
          }
        } catch (emailErr) {
          console.error("[Email] Failed to send payment receipt email:", emailErr);
        }
      }

      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteAppointment(input.localId, input.businessOwnerId);
      return { success: true };
    }),
  bulkMarkPaid: publicProcedure
    .input(z.object({
      localIds: z.array(z.string()),
      businessOwnerId: z.number(),
      paymentMethod: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.bulkMarkPaid(input.localIds, input.businessOwnerId, input.paymentMethod);
      return { success: true, count: input.localIds.length };
    }),
  bulkMarkUnpaid: publicProcedure
    .input(z.object({
      localIds: z.array(z.string()),
      businessOwnerId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.bulkMarkUnpaid(input.localIds, input.businessOwnerId);
      return { success: true, count: input.localIds.length };
    }),
});
// ─── Reviews Router ──────────────────────────────────────────────────

const reviewsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getReviewsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        clientLocalId: z.string(),
        appointmentLocalId: z.string().optional(),
        rating: z.number().min(1).max(5),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await db.createReview(input);
      return { id, localId: input.localId };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteReview(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Discounts Router ────────────────────────────────────────────────

const discountsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getDiscountsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        name: z.string().min(1),
        percentage: z.number().min(1).max(100),
        startTime: z.string(),
        endTime: z.string(),
        daysOfWeek: z.array(z.string()).optional(),
        dates: z.array(z.string()).optional(),
        serviceIds: z.array(z.string()).nullable().optional(),
        maxUses: z.number().nullable().optional(),
        active: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const id = await db.createDiscount({
        ...input,
        daysOfWeek: input.daysOfWeek ?? [],
        dates: input.dates ?? [],
        serviceIds: input.serviceIds ?? null,
        maxUses: input.maxUses ?? null,
      });
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        name: z.string().optional(),
        percentage: z.number().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        daysOfWeek: z.array(z.string()).optional(),
        dates: z.array(z.string()).optional(),
        serviceIds: z.array(z.string()).nullable().optional(),
        maxUses: z.number().nullable().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...data } = input;
      await db.updateDiscount(localId, businessOwnerId, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteDiscount(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Gift Cards Router ────────────────────────────────────────────────

const giftCardsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getGiftCardsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        code: z.string(),
        serviceLocalId: z.string(),
        recipientName: z.string().optional(),
        recipientPhone: z.string().optional(),
        message: z.string().optional(),
        expiresAt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await db.createGiftCard(input);
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        redeemed: z.boolean().optional(),
        redeemedAt: z.string().optional(),
        message: z.string().optional(),
        expiresAt: z.string().optional().nullable(),
        paymentStatus: z.enum(["paid", "unpaid", "pending_cash"]).optional(),
        recipientName: z.string().optional(),
        recipientPhone: z.string().optional(),
        remainingBalance: z.number().optional(),
        ownerNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, remainingBalance, ownerNotes, ...data } = input;
      const updateData: any = { ...data };
      if (data.redeemedAt) updateData.redeemedAt = new Date(data.redeemedAt);
      // remainingBalance and ownerNotes are stored inside the ---GIFT_DATA--- JSON block in message
      if (remainingBalance !== undefined || ownerNotes !== undefined) {
        const existing = await db.getGiftCardsByOwner(businessOwnerId);
        const card = existing.find((c: any) => c.localId === localId);
        if (card) {
          const msgStr = card.message || "";
          const match = msgStr.match(/\n---GIFT_DATA---\n(.+)$/s);
          let meta: any = {};
          if (match) { try { meta = JSON.parse(match[1]); } catch (_) {} }
          if (remainingBalance !== undefined) meta.remainingBalance = remainingBalance;
          if (ownerNotes !== undefined) meta.ownerNotes = ownerNotes;
          const cleanMsg = msgStr.replace(/\n---GIFT_DATA---\n.+$/s, "");
          updateData.message = cleanMsg + "\n---GIFT_DATA---\n" + JSON.stringify(meta);
        }
      }
      await db.updateGiftCard(localId, businessOwnerId, updateData);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteGiftCard(input.localId, input.businessOwnerId);
      return { success: true };
    }),

  findByCode: publicProcedure
    .input(z.object({ code: z.string(), businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const card = await db.getGiftCardByCode(input.code, input.businessOwnerId);
      return card ?? null;
    }),
  markAsPaid: publicProcedure
    .input(z.object({
      localId: z.string(),
      businessOwnerId: z.number(),
      paymentStatus: z.enum(["paid", "unpaid", "pending_cash"]),
    }))
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, paymentStatus } = input;
      await db.updateGiftCard(localId, businessOwnerId, { paymentStatus } as any);
      return { success: true };
    }),
});

// ─── Custom Schedule Router ───────────────────────────────────────────

const customScheduleRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getCustomScheduleByOwner(input.businessOwnerId);
    }),

  upsert: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        date: z.string(),
        isOpen: z.boolean(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        /** When provided, this override applies only to this location */
        locationId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.upsertCustomScheduleDay(
        input.businessOwnerId,
        input.date,
        input.isOpen,
        input.startTime,
        input.endTime,
        input.locationId
      );
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ businessOwnerId: z.number(), date: z.string(), locationId: z.string().optional() }))
    .mutation(async ({ input }) => {
      await db.deleteCustomScheduleDay(input.businessOwnerId, input.date, input.locationId);
      return { success: true };
    }),
});

// ─── Products Router ────────────────────────────────────────────────

const productsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getProductsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        name: z.string().min(1),
        price: z.string(),
        description: z.string().optional(),
        brand: z.string().optional(),
        available: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const id = await db.createProduct(input);
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        name: z.string().optional(),
        price: z.string().optional(),
        description: z.string().optional(),
        brand: z.string().optional(),
        available: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...data } = input;
      await db.updateProduct(localId, businessOwnerId, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProduct(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Staff Router ─────────────────────────────────────────────────────

const staffRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getStaffByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().optional(),
        role: z.string().optional(),
        color: z.string().optional(),
        serviceIds: z.any().optional(),
        locationIds: z.any().optional(),
        workingHours: z.any().optional(),
        photoUri: z.string().optional().nullable(),
        active: z.boolean().default(true),
        commissionRate: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await db.createStaffMember(input);
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        role: z.string().optional(),
        color: z.string().optional(),
        serviceIds: z.any().optional(),
        locationIds: z.any().optional(),
        workingHours: z.any().optional(),
        photoUri: z.string().optional().nullable(),
        active: z.boolean().optional(),
        commissionRate: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...data } = input;
      await db.updateStaffMember(localId, businessOwnerId, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteStaffMember(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Locations Router ─────────────────────────────────────────────────

const locationsRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getLocationsByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        name: z.string().min(1),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipCode: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isDefault: z.boolean().default(false),
        active: z.boolean().default(true),
        temporarilyClosed: z.boolean().optional(),
        reopenOn: z.string().optional().nullable(),
        workingHours: z.any().optional(),
        photoUri: z.string().optional().nullable(),
        countryCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Auto-geocode the address so the business appears in client portal discovery
      let lat: string | undefined;
      let lng: string | undefined;
      const addressParts = [input.address, input.city, input.state, input.zipCode].filter(Boolean).join(", ");
      if (addressParts) {
        try {
          const coords = await db.geocodeAddress(addressParts);
          if (coords) {
            lat = String(coords.lat);
            lng = String(coords.lng);
          }
        } catch {
          // Geocoding failure is non-fatal — location is saved without coordinates
        }
      }
      const id = await db.createLocation({ ...input, lat, lng } as any);
      // Auto-enable client portal visibility when a business saves their first location
      try {
        const existingLocs = await db.getLocations(input.businessOwnerId);
        if (existingLocs.length <= 1) {
          await db.updateBusinessOwner(input.businessOwnerId, { clientPortalVisible: true } as any);
        }
      } catch {
        // Non-fatal
      }
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipCode: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isDefault: z.boolean().optional(),
        active: z.boolean().optional(),
        temporarilyClosed: z.boolean().optional(),
        reopenOn: z.string().optional().nullable(),
        workingHours: z.any().optional(),
        photoUri: z.string().optional().nullable(),
        countryCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...rawData } = input;
      // Strip undefined values so Drizzle does NOT overwrite existing DB columns with NULL
      const data = Object.fromEntries(
        Object.entries(rawData).filter(([, v]) => v !== undefined)
      ) as typeof rawData;
      // Auto-geocode if any address field changed
      const addressParts = [rawData.address, rawData.city, rawData.state, rawData.zipCode].filter(Boolean).join(", ");
      if (addressParts) {
        try {
          const coords = await db.geocodeAddress(addressParts);
          if (coords) {
            (data as any).lat = String(coords.lat);
            (data as any).lng = String(coords.lng);
          }
        } catch {
          // Geocoding failure is non-fatal
        }
      }
      await db.updateLocation(localId, businessOwnerId, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLocation(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Twilio SMS Router ─────────────────────────────────────────────────────

const twilioRouter = router({
  /**
   * Send an SMS via the platform Twilio account.
   * Credentials are read server-side from platform_config.
   * The smsAction is checked against the business's subscription plan.
   */
  sendSms: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        toNumber: z.string(),
        body: z.string(),
        smsAction: z.enum(["confirmation", "reminder", "rebooking", "birthday"]).default("confirmation"),
        // Legacy fields kept for backward compat but ignored (server uses platform_config)
        accountSid: z.string().optional(),
        authToken: z.string().optional(),
        fromNumber: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { businessOwnerId, toNumber, body, smsAction } = input;

      // 1. Check subscription plan allows this SMS action
      const allowed = await isSmsAllowed(businessOwnerId, smsAction);
      if (!allowed) {
        throw new Error(`Your current plan does not include ${smsAction} SMS. Please upgrade your subscription.`);
      }

      // 2. Read Twilio credentials from platform_config (admin-managed)
      const accountSid = await getPlatformConfig("TWILIO_ACCOUNT_SID");
      const authToken = await getPlatformConfig("TWILIO_AUTH_TOKEN");
      const fromNumber = await getPlatformConfig("TWILIO_FROM_NUMBER");

      if (!accountSid || !authToken || !fromNumber) {
        throw new Error("SMS is not configured on this platform. Please contact support.");
      }

      // 3. Check test mode
      const testMode = await getPlatformConfig("TWILIO_TEST_MODE");
      if (testMode === "true") {
        console.log(`[SMS TEST MODE] To: ${toNumber} | Body: ${body}`);
        return { success: true, sid: "test-mode", testMode: true };
      }

      // 4. Send via Twilio
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const params = new URLSearchParams();
      params.append("From", fromNumber);
      params.append("To", toNumber);
      params.append("Body", body);
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        throw new Error(data.message ?? "Failed to send SMS via Twilio");
      }
      return { success: true, sid: data.sid as string, testMode: false };
    }),
});

// ─── OTP Router ─────────────────────────────────────────────────────
// Uses Twilio Verify API when credentials are configured.
// Falls back to in-memory test mode (code = TWILIO_TEST_OTP or "123456") when not.
const otpStore = new Map<string, { code: string; expiresAt: number }>();
// Rate-limit OTP sends: track last send time per phone number (60-second cooldown)
const otpSendCooldown = new Map<string, number>(); // phone -> lastSentAt timestamp
const OTP_RESEND_COOLDOWN_MS = 60_000; // 60 seconds

/** Get Twilio Verify credentials from env or platform_config (single batch DB query) */
async function getTwilioVerifyCredentials() {
  const cfg = await getBatchPlatformConfig(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"]);
  const accountSid = cfg["TWILIO_ACCOUNT_SID"] || process.env.TWILIO_ACCOUNT_SID;
  const authToken = cfg["TWILIO_AUTH_TOKEN"] || process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = cfg["TWILIO_VERIFY_SERVICE_SID"] || process.env.TWILIO_VERIFY_SERVICE_SID;
  return { accountSid, authToken, serviceSid };
}

/** Send OTP via Twilio Verify API */
async function sendOtpViaTwilioVerify(toNumber: string): Promise<{ ok: boolean; error?: string }> {
  const { accountSid, authToken, serviceSid } = await getTwilioVerifyCredentials();
  if (!accountSid || !authToken || !serviceSid) return { ok: false, error: "Twilio Verify not configured" };
  try {
    const url = `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`;
    const params = new URLSearchParams();
    params.append("To", toNumber);
    params.append("Channel", "sms");
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await response.json() as { status?: string; message?: string };
      if (response.ok && (data.status === "pending" || data.status === "approved")) return { ok: true };
      return { ok: false, error: data.message ?? `Twilio error ${response.status}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "SMS service timed out. Please try again." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Check OTP via Twilio Verify API */
async function checkOtpViaTwilioVerify(toNumber: string, code: string): Promise<{ valid: boolean; error?: string }> {
  const { accountSid, authToken, serviceSid } = await getTwilioVerifyCredentials();
  if (!accountSid || !authToken || !serviceSid) return { valid: false, error: "Twilio Verify not configured" };
  try {
    const url = `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`;
    const params = new URLSearchParams();
    params.append("To", toNumber);
    params.append("Code", code);
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await response.json() as { status?: string; valid?: boolean; message?: string };
    if (response.ok && data.status === "approved") return { valid: true };
    return { valid: false, error: data.message ?? "Incorrect code" };
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

const otpRouter = router({
  /** Send OTP to a phone number. Uses Twilio Verify if configured, otherwise test mode (123456). */
  send: publicProcedure
    .input(z.object({ phone: z.string().min(7) }))
    .mutation(async ({ input }) => {
      // Server-side rate limit: prevent duplicate OTP sends within 60 seconds per phone
      const normalizedPhoneKey = input.phone.replace(/\D/g, "").slice(-10);
      const lastSent = otpSendCooldown.get(normalizedPhoneKey);
      if (lastSent && Date.now() - lastSent < OTP_RESEND_COOLDOWN_MS) {
        const secondsLeft = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - lastSent)) / 1000);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Please wait ${secondsLeft} second${secondsLeft !== 1 ? "s" : ""} before requesting another code.`,
        });
      }

       // ── Fast path: in-memory test mode flag (no DB call) ──────────────────
      // This flag is set on server startup (first config read) and updated
      // immediately when admin toggles the mode. Avoids 1-2s DB round-trip.
      const inMemoryTestMode = getTwilioTestModeFlag();
      if (inMemoryTestMode === true) {
        const expiresAt = Date.now() + 10 * 60 * 1000;
        otpStore.set(input.phone, { code: "123456", expiresAt });
        otpSendCooldown.set(normalizedPhoneKey, Date.now());
        return { success: true, testMode: true };
      }

      // ── DB path: fetch config (only reached on first call or after cache miss) ──
      const cfg = await getBatchPlatformConfig(["TWILIO_TEST_MODE", "TWILIO_TEST_OTP", "TWILIO_PER_PHONE_OTP"]);
      const globalTestMode = cfg["TWILIO_TEST_MODE"] === "true";
      const testOtp = cfg["TWILIO_TEST_OTP"] || "123456";
      // Check per-phone override first — no SMS sent, static code stored
      let perPhoneOverrides: Record<string, string> = {};
      try { perPhoneOverrides = JSON.parse(cfg["TWILIO_PER_PHONE_OTP"] || "{}"); } catch {}
      const normalizedInput = input.phone.replace(/\D/g, "").slice(-10);
      const perPhoneCode = Object.entries(perPhoneOverrides).find(
        ([p]) => p.replace(/\D/g, "").slice(-10) === normalizedInput
      )?.[1];
      if (perPhoneCode) {
        const expiresAt = Date.now() + 10 * 60 * 1000;
        otpStore.set(input.phone, { code: perPhoneCode, expiresAt });
        otpSendCooldown.set(normalizedPhoneKey, Date.now());
        return { success: true, testMode: true };
      }
      // Global test mode — store code locally, no real SMS
      if (globalTestMode) {
        const expiresAt = Date.now() + 10 * 60 * 1000;
        otpStore.set(input.phone, { code: testOtp, expiresAt });
        otpSendCooldown.set(normalizedPhoneKey, Date.now());
        return { success: true, testMode: true };
      }

      // Live mode — use Twilio Verify
      // Normalize to E.164 format required by Twilio (+14124827733)
      const toE164 = (phone: string): string => {
        const digits = phone.replace(/\D/g, "");
        if (phone.startsWith("+")) return "+" + digits; // already has country code
        if (digits.length === 10) return "+1" + digits; // US 10-digit
        if (digits.length === 11 && digits.startsWith("1")) return "+" + digits; // US with leading 1
        return "+" + digits; // best effort for international
      };
      const e164Phone = toE164(input.phone);
      const result = await sendOtpViaTwilioVerify(e164Phone);
      if (!result.ok) {
        // Do NOT silently fall back — surface the real Twilio error to the user
        console.error("[OTP] Twilio Verify send failed:", result.error);
        throw new Error(result.error || "Failed to send OTP via Twilio. Check your Twilio credentials and account status.");
      }
      otpSendCooldown.set(normalizedPhoneKey, Date.now());
      return { success: true, testMode: false };
    }),

  /** Verify OTP for a phone number. Returns a session token on success for native clients. */
  verify: publicProcedure
    .input(z.object({ phone: z.string().min(7), code: z.string().length(6) }))
    .mutation(async ({ input }) => {
      const globalTestMode = (await getPlatformConfig("TWILIO_TEST_MODE")) === "true";
      const testOtp = (await getPlatformConfig("TWILIO_TEST_OTP")) || "123456";

      // Helper: create a session token for the verified phone number
      const createPhoneSession = async (): Promise<string | null> => {
        try {
          const normalizedPhone = db.normalizePhone(input.phone);
          const openId = `phone:${normalizedPhone}`;
          // Upsert a users record for this phone-based owner
          await db.upsertUser({
            openId,
            name: null,
            loginMethod: "otp",
            lastSignedIn: new Date(),
          });
          // Link userId on the business owner if not already linked
          const owner = await db.getBusinessOwnerByPhone(normalizedPhone);
          if (owner && !owner.userId) {
            const userRecord = await db.getUserByOpenId(openId);
            if (userRecord) {
              await db.updateBusinessOwner(owner.id, { userId: userRecord.id });
            }
          }
          return sdk.createSessionToken(openId, { name: normalizedPhone });
        } catch (err) {
          console.error("[OTP] Failed to create phone session:", err);
          return null;
        }
      };

      // Check per-phone override first
      let perPhoneOverrides: Record<string, string> = {};
      try { perPhoneOverrides = JSON.parse((await getPlatformConfig("TWILIO_PER_PHONE_OTP")) || "{}"); } catch {}
      const normalizedInput = input.phone.replace(/\D/g, "").slice(-10);
      const perPhoneCode = Object.entries(perPhoneOverrides).find(
        ([p]) => p.replace(/\D/g, "").slice(-10) === normalizedInput
      )?.[1];
      if (perPhoneCode && input.code === perPhoneCode) {
        otpStore.delete(input.phone);
        const sessionToken = await createPhoneSession();
        return { success: true, sessionToken };
      }

      // Global test mode — check local store
      if (globalTestMode) {
        if (input.code === testOtp) {
          otpStore.delete(input.phone);
          const sessionToken = await createPhoneSession();
          return { success: true, sessionToken };
        }
        return { success: false, error: "Incorrect code. Please try again." };
      }

      // Check local store first (fallback codes from failed Twilio sends)
      const entry = otpStore.get(input.phone);
      if (entry) {
        if (Date.now() > entry.expiresAt) {
          otpStore.delete(input.phone);
          // Don't return error yet — try Twilio Verify below
        } else if (entry.code === input.code) {
          otpStore.delete(input.phone);
          const sessionToken = await createPhoneSession();
          return { success: true, sessionToken };
        }
      }

      // Live mode — use Twilio Verify
      // Normalize to E.164 format required by Twilio
      const toE164v = (phone: string): string => {
        const digits = phone.replace(/\D/g, "");
        if (phone.startsWith("+")) return "+" + digits;
        if (digits.length === 10) return "+1" + digits;
        if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
        return "+" + digits;
      };
      const e164PhoneV = toE164v(input.phone);
      const result = await checkOtpViaTwilioVerify(e164PhoneV, input.code);
      if (result.valid) {
        const sessionToken = await createPhoneSession();
        return { success: true, sessionToken };
      }
      return { success: false, error: result.error ?? "Incorrect code. Please try again." };
    }),

  /** Test OTP send (admin only) — sends a real Twilio Verify code to a phone number */
  testSend: publicProcedure
    .input(z.object({ phone: z.string().min(7) }))
    .mutation(async ({ input }) => {
      const result = await sendOtpViaTwilioVerify(input.phone);
      return { success: result.ok, error: result.error };
    }),

  /** Test OTP verify (admin only) — checks a code against Twilio Verify */
  testVerify: publicProcedure
    .input(z.object({ phone: z.string().min(7), code: z.string().length(6) }))
    .mutation(async ({ input }) => {
      const result = await checkOtpViaTwilioVerify(input.phone, input.code);
      return { success: result.valid, error: result.error };
    }),
});

// ─── Subscription Router ────────────────────────────────────────────

const subscriptionRouter = router({
  /** Get the current business owner's subscription info (plan, usage, trial) */
  getMyPlan: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const info = await getBusinessSubscriptionInfo(input.businessOwnerId);
      return info ?? null;
    }),

  /** Get over-limit warnings for businesses in a grace period */
  getOverLimitWarnings: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const info = await getBusinessSubscriptionInfo(input.businessOwnerId);
      if (!info) return { warnings: [], isInGracePeriod: false, scheduledPlanKey: null, periodEndDate: null };
      const { isInGracePeriod, scheduledPlanKey, stripeCurrentPeriodEnd } = info as any;
      if (!isInGracePeriod || !scheduledPlanKey) {
        return { warnings: [], isInGracePeriod: false, scheduledPlanKey: null, periodEndDate: null };
      }
      // Get the scheduled plan's limits
      const plans = await getPublicPlans();
      const targetPlan = plans.find((p) => p.planKey === scheduledPlanKey);
      if (!targetPlan) return { warnings: [], isInGracePeriod: true, scheduledPlanKey, periodEndDate: null };
      // Get current usage counts
      const usage = await db.getBusinessUsageCounts(input.businessOwnerId);
      const warnings: { resource: string; current: number; limit: number; route: string }[] = [];
      const maxLoc = targetPlan.maxLocations ?? 0;
      const maxStaff = targetPlan.maxStaff ?? 0;
      const maxClients = targetPlan.maxClients ?? 0;
      const maxServices = targetPlan.maxServices ?? 0;
      const maxProducts = targetPlan.maxProducts ?? 0;
      if (maxLoc > 0 && usage.locations > maxLoc)
        warnings.push({ resource: 'Locations', current: usage.locations, limit: maxLoc, route: '/locations' });
      if (maxStaff > 0 && usage.staff > maxStaff)
        warnings.push({ resource: 'Staff Members', current: usage.staff, limit: maxStaff, route: '/staff' });
      if (maxClients > 0 && usage.clients > maxClients)
        warnings.push({ resource: 'Clients', current: usage.clients, limit: maxClients, route: '/clients' });
      if (maxServices > 0 && usage.services > maxServices)
        warnings.push({ resource: 'Services', current: usage.services, limit: maxServices, route: '/services' });
      if (maxProducts > 0 && usage.products > maxProducts)
        warnings.push({ resource: 'Products', current: usage.products, limit: maxProducts, route: '/products' });
      const periodEndDate = stripeCurrentPeriodEnd
        ? new Date(stripeCurrentPeriodEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;
      return { warnings, isInGracePeriod: true, scheduledPlanKey, periodEndDate };
    }),
  /** Get all publicly-visible plans (for plan selection screen) */
  getPublicPlans: publicProcedure
    .query(async () => {
      const plans = await getPublicPlans();
      const now = Date.now();
      return plans.map((p) => {
        const monthly = parseFloat(p.monthlyPrice as unknown as string);
        const yearly = parseFloat(p.yearlyPrice as unknown as string);
        // Auto-expire discount if discountExpiresAt has passed
        const expiresAt = (p as any).discountExpiresAt;
        const isExpired = expiresAt ? new Date(expiresAt).getTime() < now : false;
        const discPct = isExpired ? 0 : ((p as any).discountPercent ?? 0);
        const discLabel = isExpired ? null : ((p as any).discountLabel ?? null);
        const discExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
        // discountMonths: 0 = discount applies forever, 1+ = introductory (N months then full price)
        const discMonths = isExpired ? 0 : ((p as any).discountMonths ?? 0);
        return {
          planKey: p.planKey,
          displayName: p.displayName,
          monthlyPrice: monthly,
          yearlyPrice: yearly,
          // Effective prices after discount (what Stripe will charge)
          effectiveMonthlyPrice: discPct > 0 ? parseFloat((monthly * (1 - discPct / 100)).toFixed(2)) : monthly,
          effectiveYearlyPrice: discPct > 0 ? parseFloat((yearly * (1 - discPct / 100)).toFixed(2)) : yearly,
          discountPercent: discPct,
          discountLabel: discLabel,
          discountExpiresAt: discExpiresAt,
          discountMonths: discMonths,
          maxClients: p.maxClients,
          maxAppointments: p.maxAppointments,
          maxLocations: p.maxLocations,
          maxStaff: p.maxStaff,
          maxServices: p.maxServices,
          maxProducts: p.maxProducts,
          smsLevel: p.smsLevel,
          paymentLevel: p.paymentLevel,
          sortOrder: p.sortOrder,
        };
      });
    }),
});


// ─── Promo Codes Router ───────────────────────────────────────────────
const promoCodesRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getPromoCodesByOwner(input.businessOwnerId);
    }),

  create: publicProcedure
    .input(
      z.object({
        businessOwnerId: z.number(),
        localId: z.string(),
        code: z.string().min(1),
        label: z.string().min(1),
        percentage: z.number().min(0).max(100).default(0),
        flatAmount: z.string().nullable().optional(),
        maxUses: z.number().nullable().optional(),
        expiresAt: z.string().nullable().optional(),
        active: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const id = await db.createPromoCode(input);
      return { id, localId: input.localId };
    }),

  update: publicProcedure
    .input(
      z.object({
        localId: z.string(),
        businessOwnerId: z.number(),
        code: z.string().optional(),
        label: z.string().optional(),
        percentage: z.number().min(0).max(100).optional(),
        flatAmount: z.string().nullable().optional(),
        maxUses: z.number().nullable().optional(),
        expiresAt: z.string().nullable().optional(),
        active: z.boolean().optional(),
        usedCount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, ...data } = input;
      await db.updatePromoCode(localId, businessOwnerId, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deletePromoCode(input.localId, input.businessOwnerId);
      return { success: true };
    }),

  findByCode: publicProcedure
    .input(z.object({ code: z.string(), businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const promo = await db.getPromoCodeByCode(input.code.toUpperCase(), input.businessOwnerId);
      return promo ?? null;
    }),
});

// ─── Files Router ──────────────────────────────────────────────────

const filesRouter = router({
  /** Upload a base64-encoded image to S3 and return the public URL */
  uploadImage: publicProcedure
    .input(
      z.object({
        /** base64-encoded image data (without data: prefix) */
        base64: z.string(),
        /** MIME type, e.g. "image/jpeg" */
        mimeType: z.string().default("image/jpeg"),
        /** Optional folder prefix */
        folder: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { storagePut } = await import("./storage");
      const ext = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      const folder = input.folder ?? "uploads";
      const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer = Buffer.from(input.base64, "base64");
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),
});

// ─── Service Packages Router ───────────────────────────────────────

const packagesRouter = router({
  list: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      return db.getServicePackagesByOwner(input.businessOwnerId);
    }),
  create: publicProcedure
    .input(z.object({
      businessOwnerId: z.number(),
      localId: z.string(),
      name: z.string().min(1),
      description: z.string().optional().nullable(),
      serviceIds: z.array(z.string()),
      price: z.number(),
      sessions: z.number().optional().nullable(),
      expiryDays: z.number().optional().nullable(),
      bufferDays: z.number().optional().nullable(),
      bufferMinutes: z.number().optional().nullable(),
      active: z.boolean().optional(),
      photoUri: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const { serviceIds, price, sessions, expiryDays, active, ...rest } = input;
      const id = await db.createServicePackage({
        ...rest,
        packageItems: JSON.stringify(serviceIds.map((sid) => ({ serviceLocalId: sid, sessions: sessions ?? 1 }))),
        totalSessions: sessions ?? 1,
        sessionDurationMinutes: 60,
        originalPrice: String(price),
        packagePrice: String(price),
        expiryDays: expiryDays ?? null,
        isActive: active ?? true,
        description: rest.description ?? null,
        photoUri: rest.photoUri ?? null,
        category: null,
      } as any);
      return { id, localId: input.localId };
    }),
  update: publicProcedure
    .input(z.object({
      localId: z.string(),
      businessOwnerId: z.number(),
      name: z.string().optional(),
      description: z.string().optional().nullable(),
      serviceIds: z.array(z.string()).optional(),
      price: z.number().optional(),
      sessions: z.number().optional().nullable(),
      expiryDays: z.number().optional().nullable(),
      bufferDays: z.number().optional().nullable(),
      bufferMinutes: z.number().optional().nullable(),
      active: z.boolean().optional(),
      photoUri: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const { localId, businessOwnerId, serviceIds, price, sessions, expiryDays, active, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest };
      if (serviceIds !== undefined) {
        updateData.packageItems = JSON.stringify(serviceIds.map((sid) => ({ serviceLocalId: sid, sessions: sessions ?? 1 })));
        updateData.totalSessions = sessions ?? 1;
      }
      if (price !== undefined) {
        updateData.originalPrice = String(price);
        updateData.packagePrice = String(price);
      }
      if (expiryDays !== undefined) updateData.expiryDays = expiryDays;
      if (active !== undefined) updateData.isActive = active;
      await db.updateServicePackage(localId, businessOwnerId, updateData as any);
      return { success: true };
    }),
  delete: publicProcedure
    .input(z.object({ localId: z.string(), businessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteServicePackage(input.localId, input.businessOwnerId);
      return { success: true };
    }),
});

// ─── Referral Router ─────────────────────────────────────────────────

const referralRouter = router({
  /** Get or create the referral code for the current business owner */
  getMyCode: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const owner = await db.getBusinessOwnerById(input.businessOwnerId);
      if (!owner) throw new Error("Business not found");
      const code = await db.getOrCreateReferralCode(input.businessOwnerId, owner.businessName);
      return code;
    }),

  validateCode: publicProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const codeRow = await db.validateReferralCode(input.code);
      if (!codeRow) return { valid: false, discountPercent: 0, discountMonths: 0 };
      return {
        valid: true,
        discountPercent: codeRow.discountPercent,
        discountMonths: codeRow.discountMonths,
        referralCodeId: codeRow.id,
        referrerBusinessOwnerId: codeRow.businessOwnerId,
      };
    }),

  applyCode: publicProcedure
    .input(z.object({ code: z.string(), referredBusinessOwnerId: z.number() }))
    .mutation(async ({ input }) => {
      const codeRow = await db.validateReferralCode(input.code);
      if (!codeRow) throw new Error("Invalid or inactive referral code");
      if (codeRow.businessOwnerId === input.referredBusinessOwnerId) throw new Error("You cannot use your own referral code");
      const existing = await db.getReferralByReferredOwner(input.referredBusinessOwnerId);
      if (existing) throw new Error("A referral code has already been applied to this account");
      const referral = await db.createReferral(codeRow.id, codeRow.businessOwnerId, input.referredBusinessOwnerId);
      return { success: true, referralId: referral?.id, referralCodeId: codeRow.id, discountPercent: codeRow.discountPercent, discountMonths: codeRow.discountMonths };
    }),

  getMyReferrals: publicProcedure
    .input(z.object({ businessOwnerId: z.number() }))
    .query(async ({ input }) => {
      const code = await db.getReferralCodeByOwner(input.businessOwnerId);
      const refs = await db.getReferralsByReferrer(input.businessOwnerId);
      // Fetch the business owner's booking slug for constructing the referral share URL
      const { businessOwners: boTable } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const dbase = await db.getDb();
      let bookingSlug: string | null = null;
      if (dbase) {
        const boRows = await dbase.select({ businessName: boTable.businessName, customSlug: (boTable as any).customSlug }).from(boTable).where(eq(boTable.id, input.businessOwnerId)).limit(1);
        if (boRows?.[0]) {
          const bo = boRows[0] as any;
          bookingSlug = bo.customSlug || bo.businessName?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || null;
        }
      }
      return {
        code,
        referrals: refs,
        totalReferred: refs.length,
        totalConverted: refs.filter((r) => r.status === "converted" || r.status === "rewarded").length,
        totalRewarded: refs.filter((r) => r.status === "rewarded").length,
        bookingSlug,
      };
    }),

  adminGetAll: publicProcedure
    .query(async () => {
      const codes = await db.getAllReferralCodes();
      const refs = await db.getAllReferrals();
      return { codes, referrals: refs };
    }),
});

// ─── Root Router ─────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  business: businessRouter,
  services: servicesRouter,
  clients: clientsRouter,
  appointments: appointmentsRouter,
  reviews: reviewsRouter,
  discounts: discountsRouter,
  giftCards: giftCardsRouter,
  customSchedule: customScheduleRouter,
  products: productsRouter,
  staff: staffRouter,
  locations: locationsRouter,
  twilio: twilioRouter,
  otp: otpRouter,
  subscription: subscriptionRouter,
  promoCodes: promoCodesRouter,
  files: filesRouter,
  packages: packagesRouter,
  referrals: referralRouter,
});

export type AppRouter = typeof appRouter;
