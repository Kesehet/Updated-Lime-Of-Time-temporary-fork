/**
 * Client Portal REST API Routes
 *
 * All routes under /api/client/* require authentication via the existing
 * Manus session token (same JWT used by the business owner side).
 *
 * The client account is identified by the user's openId from the session.
 * On first access, a clientAccount is auto-created for the authenticated user.
 */
import { Express, Request, Response } from "express";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { sendExpoPush } from "./push";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getClientAccount(req: Request): Promise<{ clientAccount: Awaited<ReturnType<typeof db.getClientAccountById>>; user: Awaited<ReturnType<typeof db.getUserByOpenId>> }> {
  // Verify the session JWT (works for both OAuth and phone-based tokens)
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let token: string | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    // Also check cookie
    const cookies = req.headers.cookie?.split(";").reduce((acc, c) => {
      const [k, v] = c.trim().split("=");
      acc[k] = v;
      return acc;
    }, {} as Record<string, string>) ?? {};
    token = cookies["session_token"];
  }
  const session = await (sdk as any).verifySession(token);
  if (!session) throw new Error("Unauthorized");

  // ── Phone-based client (openId starts with "phone:") ─────────────────────
  if (session.openId.startsWith("phone:")) {
    const phone = session.openId.slice(6); // strip "phone:" prefix
    let clientAccount = await db.getClientAccountByPhone(phone);
    if (!clientAccount) {
      clientAccount = await db.upsertClientAccount({ phone, name: session.name ?? null, email: null });
    }
    return { clientAccount, user: null as any };
  }

  // ── OAuth-based client (standard flow) ───────────────────────────────────
  const dbUser = await db.getUserByOpenId(session.openId);
  if (!dbUser) throw new Error("User not found");

  const oauthKey = `oauth:${session.openId}`;
  let clientAccount = await db.getClientAccountByPhone(oauthKey);
  if (!clientAccount) {
    clientAccount = await db.upsertClientAccount({
      phone: oauthKey,
      name: dbUser.name ?? session.name ?? null,
      email: dbUser.email ?? null,
    });
  }
  return { clientAccount, user: dbUser };
}

// ─── Geocoding helper (Nominatim, free, no API key) ──────────────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "LimeOfTime/1.0" } });
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ─── Distance helper (Haversine formula) ─────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerClientRoutes(app: Express) {
  // ── Profile ──────────────────────────────────────────────────────────────

  /** GET /api/client/profile — get or auto-create client account */
  // ── Client OAuth Login ───────────────────────────────────────────────────
  /** POST /api/client/auth/login — create or retrieve client account after OAuth */
  app.post("/api/client/auth/login", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
      const dbUser = await db.getUserByOpenId(user.openId);
      if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }
      const oauthKey = `oauth:${user.openId}`;
      let clientAccount = await db.getClientAccountByPhone(oauthKey);
      if (!clientAccount) {
        clientAccount = await db.upsertClientAccount({
          phone: oauthKey,
          name: dbUser.name ?? user.name ?? req.body.name ?? null,
          email: dbUser.email ?? user.email ?? req.body.email ?? null,
        });
      }
      // Return the same session token (already authenticated via Bearer)
      const authHeader = req.headers.authorization as string;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      res.json({ token, account: clientAccount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Client Phone Login ────────────────────────────────────────────────────
  /** POST /api/client/phone-login — create or retrieve client account by phone (after OTP verify) */
  app.post("/api/client/phone-login", async (req: Request, res: Response) => {
    try {
      const { phone, name } = req.body as { phone: string; name?: string };
      if (!phone) { res.status(400).json({ error: "Phone required" }); return; }
      let clientAccount = await db.getClientAccountByPhone(phone);
      if (!clientAccount) {
        clientAccount = await db.upsertClientAccount({ phone, name: name ?? null, email: null });
      }
      // Issue a simple JWT-like token using the SDK
      const token = await sdk.createSessionToken(`phone:${phone}`, { name: clientAccount.name ?? "client" });
      res.json({ token, account: clientAccount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/client/profile", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      res.json({ clientAccount });
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  /** PATCH /api/client/profile — update name, phone, email, birthday, expoPushToken, preferredRadius, themeMode */
  app.patch("/api/client/profile", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const { name, phone, email, birthday, profilePhotoUri, expoPushToken, preferredRadius, themeMode, notificationPreferences } = req.body;

      // If user is providing a real phone number, update the primary key
      if (phone && !phone.startsWith("oauth:")) {
        // Check if a clientAccount with this phone already exists
        const existing = await db.getClientAccountByPhone(phone);
        if (existing && existing.id !== clientAccount!.id) {
          // Merge: update existing account, delete the oauth: one
          await db.updateClientAccount(existing.id, {
            name: name ?? existing.name,
            email: email ?? existing.email,
            birthday: birthday ?? existing.birthday,
            expoPushToken: expoPushToken ?? existing.expoPushToken,
            preferredRadius: preferredRadius ?? existing.preferredRadius,
            themeMode: themeMode ?? existing.themeMode,
          });
          res.json({ clientAccount: await db.getClientAccountById(existing.id) });
          return;
        }
        // Update phone on current account
        await db.updateClientAccount(clientAccount!.id, { phone });
      }

      await db.updateClientAccount(clientAccount!.id, {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(birthday !== undefined && { birthday }),
        ...(profilePhotoUri !== undefined && { profilePhotoUri }),
        ...(expoPushToken !== undefined && { expoPushToken }),
        ...(preferredRadius !== undefined && { preferredRadius }),
        ...(themeMode !== undefined && { themeMode }),
        ...(notificationPreferences !== undefined && { notificationPreferences }),
      });
      res.json({ clientAccount: await db.getClientAccountById(clientAccount!.id) });
    } catch (err: any) {
      console.error("[PATCH /api/client/profile] error:", err.message, err.stack?.split("\n")[1]);
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });
  // ── Profile Photo Uploadd ──────────────────────────────────────────────────
  /** POST /api/client/upload-photo — upload a profile photo (base64) and return public URL */
  app.post("/api/client/upload-photo", async (req: Request, res: Response) => {
    try {
      await getClientAccount(req); // auth check
      const { base64, mimeType = "image/jpeg" } = req.body as { base64: string; mimeType?: string };
      if (!base64) { res.status(400).json({ error: "base64 required" }); return; }
      const { storagePut } = await import("./storage");
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      const key = `client-photos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer = Buffer.from(base64, "base64");
      const { url } = await storagePut(key, buffer, mimeType);
      res.json({ url });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Discovery ─────────────────────────────────────────────────────────────

  /**
   * GET /api/client/businesses/discover
   * Query params: lat, lng, radiusMiles (default 25), category, search, page (default 0)
   */
  app.get("/api/client/businesses/discover", async (req: Request, res: Response) => {
    try {
      const clientLat = req.query.lat ? parseFloat(req.query.lat as string) : null;
      const clientLng = req.query.lng ? parseFloat(req.query.lng as string) : null;
      const radiusMiles = parseFloat((req.query.radiusMiles as string) ?? "25");
      const radiusKm = radiusMiles * 1.60934;
      const category = (req.query.category as string) ?? "";
      const search = ((req.query.search as string) ?? "").toLowerCase();

      const businesses = await db.getDiscoverableBusinesses();

      const results = businesses
        .filter((b) => {
          if (category && b.businessCategory !== category) return false;
          if (search && !b.businessName.toLowerCase().includes(search) && !(b.description ?? "").toLowerCase().includes(search)) return false;
          return true;
        })
        .map((b) => {
          let distanceKm: number | null = null;
          if (clientLat !== null && clientLng !== null && b.lat && b.lng) {
            distanceKm = haversineKm(clientLat, clientLng, parseFloat(b.lat as string), parseFloat(b.lng as string));
          }
          const slug = b.customSlug ?? (b.businessName ?? "").toLowerCase().replace(/\s+/g, "-");
          return { ...b, distanceKm, slug };
        })
        .filter((b) => {
          if (clientLat !== null && b.distanceKm !== null) {
            return b.distanceKm <= radiusKm;
          }
          return true;
        })
        .sort((a, b) => {
          if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
          return 0;
        });

      res.json({ businesses: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/client/businesses/:slug — full business detail for client portal
   */
  app.get("/api/client/businesses/:slug", async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const owner = await db.getBusinessOwnerBySlug(slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const [services, staff, reviews, locations, servicePhotos] = await Promise.all([
        db.getServices(owner.id),
        db.getStaffMembers(owner.id),
        db.getReviews(owner.id),
        db.getLocations(owner.id),
        db.getServicePhotos(owner.id),
      ]);
      res.json({ owner, services, staff, reviews, locations, servicePhotos });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Geocode (owner-side: geocode their address and store lat/lng) ─────────

  /** POST /api/client/geocode — geocode an address, returns { lat, lng } */
  app.post("/api/client/geocode", async (req: Request, res: Response) => {
    try {
      const { address } = req.body;
      if (!address) {
        res.status(400).json({ error: "address required" });
        return;
      }
      const coords = await geocodeAddress(address);
      res.json({ coords });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Appointments ──────────────────────────────────────────────────────────

  /**
   * GET /api/client/appointments
   * Returns all appointments where clientPhone matches the client's phone number
   */
  app.get("/api/client/appointments", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      let phone = clientAccount!.phone.startsWith("oauth:") ? clientAccount!.email : clientAccount!.phone;
      if (!phone) {
        res.json({ appointments: [] });
        return;
      }
      // Normalize phone to 10-digit format (same as booking endpoint)
      const rawDigits = phone.replace(/\D/g, "");
      const normalizedPhone = rawDigits.length === 11 && rawDigits.startsWith("1") ? rawDigits.slice(1) : rawDigits;
      if (normalizedPhone.length >= 10) phone = normalizedPhone;
      // Get all appointments for this phone number across all businesses
      const rawAppts = await db.getAppointmentsByClientPhone(phone);
      // Enrich each appointment with businessName, serviceName, staffName, staffAvatarUrl
      const appointments = await Promise.all(
        rawAppts.map(async (appt) => {
          const [owner, services, staffList, locations] = await Promise.all([
            db.getBusinessOwnerById(appt.businessOwnerId),
            db.getServices(appt.businessOwnerId),
            db.getStaffMembers(appt.businessOwnerId),
            db.getLocations(appt.businessOwnerId),
          ]);
          const service = services.find((s) => s.localId === appt.serviceLocalId);
          const staff = staffList.find((st) => st.localId === appt.staffId);
          const location = locations.find((l) => l.localId === appt.locationId);
          return {
            ...appt,
            businessName: owner?.businessName ?? "Unknown",
            businessSlug: owner?.customSlug ?? (owner?.businessName ?? "").toLowerCase().replace(/\s+/g, "-"),
            businessLogoUri: owner?.businessLogoUri ?? null,
            businessCategory: owner?.businessCategory ?? null,
            serviceName: service?.name ?? appt.serviceLocalId,
            price: service?.price ?? null,
            staffName: staff?.name ?? null,
            staffAvatarUrl: staff?.photoUri ?? null,
            locationName: location?.name ?? null,
            locationAddress: location?.address ?? null,
          };
        })
      );
      res.json({ appointments });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /**
   * GET /api/client/appointments/:id
   * Returns a single enriched appointment by numeric DB id.
   * Only returns if the appointment belongs to this client.
   */
  app.get("/api/client/appointments/:id", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const apptId = parseInt(req.params.id);
      if (isNaN(apptId)) {
        res.status(400).json({ error: "Invalid appointment id" });
        return;
      }
      // Use getAppointmentsByClientPhone to find the appointment
      let phone = clientAccount!.phone.startsWith("oauth:") ? clientAccount!.email : clientAccount!.phone;
      const rawDigits = (phone ?? "").replace(/\D/g, "");
      const normalizedPhone = rawDigits.length === 11 && rawDigits.startsWith("1") ? rawDigits.slice(1) : rawDigits;
      if (normalizedPhone.length >= 10) phone = normalizedPhone;
      const rawAppts = await db.getAppointmentsByClientPhone(phone ?? "");
      const appt = rawAppts.find((a) => a.id === apptId);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      const [owner, svcList, staffList, locList] = await Promise.all([
        db.getBusinessOwnerById(appt.businessOwnerId),
        db.getServices(appt.businessOwnerId),
        db.getStaffMembers(appt.businessOwnerId),
        db.getLocations(appt.businessOwnerId),
      ]);
      const service = svcList.find((s) => s.localId === appt.serviceLocalId);
      const staff = staffList.find((st) => st.localId === appt.staffId);
      const location = locList.find((l) => l.localId === appt.locationId);
      res.json({
        ...appt,
        businessName: owner?.businessName ?? "Unknown",
        businessSlug: owner?.customSlug ?? (owner?.businessName ?? "").toLowerCase().replace(/\s+/g, "-"),
        businessLogoUri: owner?.businessLogoUri ?? null,
        businessCategory: owner?.businessCategory ?? null,
        serviceName: service?.name ?? appt.serviceLocalId,
        price: service?.price ?? null,
        staffName: staff?.name ?? null,
        staffAvatarUrl: staff?.photoUri ?? null,
        locationName: location?.name ?? null,
        locationAddress: location?.address ?? null,
      });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /**
   * POST /api/client/appointments/:id/cancel-request
   * Submits a cancellation request for the appointment.
   */
  app.post("/api/client/appointments/:id/cancel-request", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const apptId = parseInt(req.params.id);
      if (isNaN(apptId)) {
        res.status(400).json({ error: "Invalid appointment id" });
        return;
      }
      let phone = clientAccount!.phone.startsWith("oauth:") ? clientAccount!.email : clientAccount!.phone;
      const rawDigits = (phone ?? "").replace(/\D/g, "");
      const normalizedPhone = rawDigits.length === 11 && rawDigits.startsWith("1") ? rawDigits.slice(1) : rawDigits;
      if (normalizedPhone.length >= 10) phone = normalizedPhone;
      const rawAppts = await db.getAppointmentsByClientPhone(phone ?? "");
      const appt = rawAppts.find((a) => a.id === apptId);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      if (appt.status !== "confirmed" && appt.status !== "pending") {
        res.status(400).json({ error: "Cannot request cancellation for this appointment" });
        return;
      }
      const cancelRequest = { status: "pending" as const, submittedAt: new Date().toISOString() };
      await db.updateAppointment(appt.localId, appt.businessOwnerId, { cancelRequest });
      // Notify business owner
      const owner = await db.getBusinessOwnerById(appt.businessOwnerId);
      if (owner?.expoPushToken) {
        await sendExpoPush(owner.expoPushToken, {
          title: "Cancellation Request",
          body: `${clientAccount!.name ?? "A client"} requested to cancel their appointment.`,
          data: { type: "cancel_request", appointmentId: appt.localId },
        });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  /** GET /api/client/messages — inbox: list of conversations with businesses */
  app.get("/api/client/messages", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const inbox = await db.getClientMessageInbox(clientAccount!.id);

      // Enrich with business info
      const enriched = await Promise.all(
        inbox.map(async (item) => {
          const business = await db.getBusinessOwnerById(item.businessOwnerId);
          return {
            ...item,
            businessName: business?.businessName ?? "Unknown",
            businessLogoUri: business?.businessLogoUri ?? null,
            businessSlug: business?.customSlug ?? business?.businessName?.toLowerCase().replace(/\s+/g, "-") ?? "",
          };
        })
      );
      res.json({ inbox: enriched });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /**
   * GET /api/client/messages/threads
   * Returns appointment-enriched thread list for the Messages tab.
   * Each thread has: businessOwnerId, businessName, serviceName, appointmentDate,
   * lastMessage, lastMessageAt, unreadCount.
   */
  app.get("/api/client/messages/threads", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const inbox = await db.getClientMessageInbox(clientAccount!.id);

      // Enrich each inbox item with business info and latest appointment
      const threads = await Promise.all(
        inbox.map(async (item) => {
          const [business, allAppts] = await Promise.all([
            db.getBusinessOwnerById(item.businessOwnerId),
            db.getAppointmentsByOwner(item.businessOwnerId),
          ]);
          // Find the most recent appointment for this client at this business
          const clientPhone = clientAccount!.phone.startsWith("oauth:") ? clientAccount!.email : clientAccount!.phone;
          const rawDigits = (clientPhone ?? "").replace(/\D/g, "");
          const normalizedPhone = rawDigits.length === 11 && rawDigits.startsWith("1") ? rawDigits.slice(1) : rawDigits;
          // Match via client records
          const matchingClients = await db.getClientsByOwner(item.businessOwnerId);
          const matchedClient = matchingClients.find((c) => {
            if (!c.phone) return false;
            const d = c.phone.replace(/\D/g, "");
            const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
            return n === normalizedPhone || c.phone === clientPhone;
          });
          const clientAppts = matchedClient
            ? allAppts.filter((a) => a.clientLocalId === matchedClient.localId)
            : [];
          const latestAppt = clientAppts.sort((a, b) => b.date.localeCompare(a.date))[0];
          const services = latestAppt ? await db.getServices(item.businessOwnerId) : [];
          const service = latestAppt ? services.find((s) => s.localId === latestAppt.serviceLocalId) : null;
          return {
            businessOwnerId: item.businessOwnerId,
            businessName: business?.businessName ?? "Unknown",
            businessLogoUri: business?.businessLogoUri ?? null,
            businessSlug: business?.customSlug ?? (business?.businessName ?? "").toLowerCase().replace(/\s+/g, "-"),
            serviceName: service?.name ?? (latestAppt?.serviceLocalId ?? ""),
            appointmentDate: latestAppt?.date ?? "",
            lastMessage: item.lastMessage,
            lastMessageAt: item.lastAt,
            unreadCount: item.unreadCount,
          };
        })
      );
      res.json(threads);
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** GET /api/client/messages/unread-count — total unread message count for badge */
  app.get("/api/client/messages/unread-count", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const inbox = await db.getClientMessageInbox(clientAccount!.id);
      const total = inbox.reduce((sum, item) => sum + item.unreadCount, 0);
      res.json({ count: total });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** GET /api/client/messages/:businessOwnerId — full thread with a business */
  app.get("/api/client/messages/:businessOwnerId", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const businessOwnerId = parseInt(req.params.businessOwnerId);
      const messages = await db.getClientMessages(businessOwnerId, clientAccount!.id);
      // Mark business messages as read
      await db.markClientMessagesRead(businessOwnerId, clientAccount!.id, "business");
      res.json({ messages });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** POST /api/client/messages/:businessOwnerId — send a message to a business */
  app.post("/api/client/messages/:businessOwnerId", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const businessOwnerId = parseInt(req.params.businessOwnerId);
      const { body } = req.body;
      if (!body?.trim()) {
        res.status(400).json({ error: "Message body required" });
        return;
      }
      const message = await db.insertClientMessage({
        businessOwnerId,
        clientAccountId: clientAccount!.id,
        senderType: "client",
        body: body.trim(),
      });

      // Push notification to business owner
      const owner = await db.getBusinessOwnerById(businessOwnerId);
      if (owner?.expoPushToken) {
        await sendExpoPush(owner.expoPushToken, {
          title: `New message from ${clientAccount!.name ?? "a client"}`,
          body: body.trim().slice(0, 100),
          data: { type: "client_message", clientAccountId: clientAccount!.id },
        });
      }

      res.json({ message });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Business-side: read messages from client portal ───────────────────────

  /** GET /api/business/messages — inbox: list of client conversations (authenticated as business owner) */
  app.get("/api/business/messages", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      const inbox = await db.getBusinessMessageInbox(owner.id);
      // Enrich with client info
      const enriched = await Promise.all(
        inbox.map(async (item) => {
          const client = await db.getClientAccountById(item.clientAccountId);
          return {
            ...item,
            clientName: client?.name ?? "Client",
            clientPhone: client?.phone?.startsWith("oauth:") ? null : client?.phone,
          };
        })
      );
      res.json({ inbox: enriched });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** GET /api/business/messages/unread-count — MUST be before /:clientAccountId to avoid Express route shadowing */
  app.get("/api/business/messages/unread-count", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.json({ count: 0 });
        return;
      }
      const inbox = await db.getBusinessMessageInbox(owner.id);
      const total = inbox.reduce((sum, item) => sum + item.unreadCount, 0);
      res.json({ count: total });
    } catch {
      res.json({ count: 0 });
    }
  });

  /** GET /api/business/messages/:clientAccountId — full thread with a client */
  app.get("/api/business/messages/:clientAccountId", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      const clientAccountId = parseInt(req.params.clientAccountId);
      const messages = await db.getClientMessages(owner.id, clientAccountId);
      // Mark client messages as read
      await db.markClientMessagesRead(owner.id, clientAccountId, "client");
      res.json({ messages });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** POST /api/business/messages/:clientAccountId — business sends a message to client */
  app.post("/api/business/messages/:clientAccountId", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      const clientAccountId = parseInt(req.params.clientAccountId);
      const { body } = req.body;
      if (!body?.trim()) {
        res.status(400).json({ error: "Message body required" });
        return;
      }
      const message = await db.insertClientMessage({
        businessOwnerId: owner.id,
        clientAccountId,
        senderType: "business",
        body: body.trim(),
      });

      // Push notification to client
      const client = await db.getClientAccountById(clientAccountId);
      if (client?.expoPushToken) {
        await sendExpoPush(client.expoPushToken, {
          title: `Message from ${owner.businessName}`,
          body: body.trim().slice(0, 100),
          data: { type: "business_message", businessOwnerId: owner.id },
        });
      }

      res.json({ message });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Saved Businesses ──────────────────────────────────────────────────────

  /** GET /api/client/saved — list saved business IDs */
  app.get("/api/client/saved", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const savedIds = await db.getSavedBusinesses(clientAccount!.id);
      res.json({ savedIds });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** POST /api/client/saved/:businessOwnerId — save a business */
  app.post("/api/client/saved/:businessOwnerId", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const businessOwnerId = parseInt(req.params.businessOwnerId);
      await db.saveBusinessForClient(clientAccount!.id, businessOwnerId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** DELETE /api/client/saved/:businessOwnerId — unsave a business */
  app.delete("/api/client/saved/:businessOwnerId", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const businessOwnerId = parseInt(req.params.businessOwnerId);
      await db.unsaveBusinessForClient(clientAccount!.id, businessOwnerId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Service Photos ────────────────────────────────────────────────────────

  /** GET /api/public/service-photos/:slug — public: get service photos for a business */
  app.get("/api/public/service-photos/:slug", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const { serviceLocalId } = req.query;
      const photos = await db.getServicePhotos(owner.id, serviceLocalId as string | undefined);
      res.json({ photos });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/business/service-photos — owner uploads a service photo */
  app.post("/api/business/service-photos", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      const { serviceLocalId, uri, label, note, sortOrder } = req.body;
      if (!serviceLocalId || !uri) {
        res.status(400).json({ error: "serviceLocalId and uri required" });
        return;
      }
      const photo = await db.insertServicePhoto({
        businessOwnerId: owner.id,
        serviceLocalId,
        uri,
        label: label ?? "other",
        note: note ?? null,
        sortOrder: sortOrder ?? 0,
      });
      res.json({ photo });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** DELETE /api/business/service-photos/:id — owner deletes a service photo */
  app.delete("/api/business/service-photos/:id", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      await db.deleteServicePhoto(parseInt(req.params.id), owner.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Business Portal Visibility Toggle ────────────────────────────────────

  /** POST /api/business/portal-visibility — toggle clientPortalVisible + geocode address */
  app.post("/api/business/portal-visibility", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      const { visible, businessCategory } = req.body;

      let lat = owner.lat;
      let lng = owner.lng;

      // Auto-geocode if enabling and no coords yet
      if (visible && (!lat || !lng) && owner.address) {
        const coords = await geocodeAddress(owner.address);
        if (coords) {
          lat = coords.lat as any;
          lng = coords.lng as any;
        }
      }

      await db.updateBusinessOwner(owner.id, {
        clientPortalVisible: visible ?? owner.clientPortalVisible,
        businessCategory: businessCategory ?? owner.businessCategory,
        lat: lat as any,
        lng: lng as any,
      });

      res.json({ success: true, lat, lng });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

}
