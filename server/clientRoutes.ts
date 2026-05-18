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
import { normalizeCategory } from "../constants/categories";

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
    const rawPhone = session.openId.slice(6); // strip "phone:" prefix
    // Always normalize to E.164 so the lookup is consistent regardless of how the token was issued
    const phone = db.normalizePhone(rawPhone);
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
      // Normalize to E.164 for consistent storage and lookup
      const normalizedPhone = db.normalizePhone(phone);
      let clientAccount = await db.getClientAccountByPhone(normalizedPhone);
      if (!clientAccount) {
        clientAccount = await db.upsertClientAccount({ phone: normalizedPhone, name: name ?? null, email: null });
      }
      // Issue a simple JWT-like token using the SDK (use normalized phone in openId)
      const token = await sdk.createSessionToken(`phone:${normalizedPhone}`, { name: clientAccount.name ?? "client" });
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
      const { name, phone, email, birthday, profilePhotoUri, expoPushToken, preferredRadius, themeMode, notificationPreferences, savedAddress } = req.body;

      // If user is providing a real phone number, update the primary key
      if (phone && !phone.startsWith("oauth:")) {
        // Normalize to E.164 for consistent storage
        const normalizedPhone = db.normalizePhone(phone);
        // Check if a clientAccount with this phone already exists
        const existing = await db.getClientAccountByPhone(normalizedPhone);
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
        // Update phone on current account (normalized)
        await db.updateClientAccount(clientAccount!.id, { phone: normalizedPhone });
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
        ...(savedAddress !== undefined && { savedAddress }),
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
   * GET /api/client/businesses/categories
   * Returns all unique service categories from discoverable businesses.
   */
  app.get("/api/client/businesses/categories", async (req: Request, res: Response) => {
    try {
      const businesses = await db.getDiscoverableBusinesses();
      const catSet = new Set<string>();
      let hasOther = false;
      for (const biz of businesses) {
        // Business-level categories are comma-separated; normalize each one
        if (biz.businessCategory) {
          const bizCats = biz.businessCategory.split(",").map((c: string) => c.trim()).filter(Boolean);
          for (const bc of bizCats) {
            const normalized = normalizeCategory(bc);
            if (normalized === "Other" || normalized === "Other Mobile") hasOther = true;
            else catSet.add(normalized);
          }
        }
        // Service-level categories: custom labels pass through as-is
        const services = await db.getServicesByOwner(biz.id);
        for (const svc of services) {
          const normalized = normalizeCategory(svc.category);
          if (normalized === "Other" || normalized === "Other Mobile") hasOther = true;
          else catSet.add(normalized);
        }
      }
      const sorted = Array.from(catSet).sort();
      if (hasOther) sorted.push("Other"); // Other always last
      res.json({ categories: sorted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

   /**
   * GET /api/client/businesses/discover
   * Query params: lat, lng, radiusMiles (default 25), category, search (or q), location (zip/city for geocoding)
   *
   * Location search logic:
   *  - If `location` param is provided (e.g. "15237" or "Pittsburgh"), geocode it and use as center point
   *  - If `lat`/`lng` are provided, use them directly
   *  - `search` (or `q`) filters by business name, description, address, city, zip
   */
  app.get("/api/client/businesses/discover", async (req: Request, res: Response) => {
    try {
      // Accept both `q` and `search` param names
      const rawSearch = ((req.query.search as string) || (req.query.q as string) || "").toLowerCase().trim();
      const locationQuery = ((req.query.location as string) ?? "").trim();
      const category = (req.query.category as string) ?? "";
      const radiusMiles = parseFloat((req.query.radiusMiles as string) ?? "25");
      const radiusKm = radiusMiles * 1.60934;
      const sortBy = (req.query.sortBy as string) ?? "distance"; // "distance" | "rating"

      // Determine center coordinates
      let clientLat: number | null = req.query.lat ? parseFloat(req.query.lat as string) : null;
      let clientLng: number | null = req.query.lng ? parseFloat(req.query.lng as string) : null;

      // If a location identifier (zip/city) is provided, geocode it
      if (locationQuery && (clientLat === null || clientLng === null)) {
        const coords = await geocodeAddress(locationQuery);
        if (coords) {
          clientLat = coords.lat;
          clientLng = coords.lng;
        }
      }

      // Load all discoverable businesses
      const businesses = await db.getDiscoverableBusinesses();
      const bizIds = businesses.map((b) => b.id);

      // Batch-load all related data in 4 parallel queries (instead of 4 × N queries)
      let allLocs: any[] = [];
      let allReviews: any[] = [];
      let allServices: any[] = [];
      let allPhotos: any[] = [];
      if (bizIds.length > 0) {
        const dbase = await db.getDb();
        if (dbase) {
          const { locations: locsTable, reviews: reviewsTable, services: svcTable, servicePhotos: photosTable } = await import("../drizzle/schema");
          const { inArray } = await import("drizzle-orm");
          [allLocs, allReviews, allServices, allPhotos] = await Promise.all([
            dbase.select().from(locsTable).where(inArray(locsTable.businessOwnerId, bizIds)),
            dbase.select().from(reviewsTable).where(inArray(reviewsTable.businessOwnerId, bizIds)),
            dbase.select().from(svcTable).where(inArray(svcTable.businessOwnerId, bizIds)),
            dbase.select().from(photosTable).where(inArray(photosTable.businessOwnerId, bizIds)),
          ]);
        }
      }
      // Group by businessOwnerId for O(1) lookup
      const locsMap = new Map<number, any[]>();
      const reviewsMap = new Map<number, any[]>();
      const servicesMap = new Map<number, any[]>();
      const photosMap = new Map<number, any[]>();
      for (const l of allLocs) { const arr = locsMap.get(l.businessOwnerId) ?? []; arr.push(l); locsMap.set(l.businessOwnerId, arr); }
      for (const r of allReviews) { const arr = reviewsMap.get(r.businessOwnerId) ?? []; arr.push(r); reviewsMap.set(r.businessOwnerId, arr); }
      for (const s of allServices) { const arr = servicesMap.get(s.businessOwnerId) ?? []; arr.push(s); servicesMap.set(s.businessOwnerId, arr); }
      for (const p of allPhotos) { const arr = photosMap.get(p.businessOwnerId) ?? []; arr.push(p); photosMap.set(p.businessOwnerId, arr); }

      // Build enriched list with location data, ratings, and service categories
      const enriched = businesses.map((b) => {
          const locs = locsMap.get(b.id) ?? [];
          const reviewsList = reviewsMap.get(b.id) ?? [];
          const servicesList = servicesMap.get(b.id) ?? [];
          const servicePhotosList = photosMap.get(b.id) ?? [];
          const firstServicePhotoUri: string | null = servicePhotosList.length > 0 ? servicePhotosList[0].uri : null;
          // Collect all searchable text from locations
          const locationText = locs
            .map((l) => [l.address, l.city, l.state, l.zipCode, l.name].filter(Boolean).join(" "))
            .join(" ")
            .toLowerCase();
          // Best coordinates: prefer business-level lat/lng, then first location with coords
          let bizLat = b.lat ? parseFloat(b.lat as string) : null;
          let bizLng = b.lng ? parseFloat(b.lng as string) : null;
          if ((bizLat === null || bizLng === null) && locs.length > 0) {
            const locWithCoords = locs.find((l) => l.lat && l.lng);
            if (locWithCoords) {
              bizLat = parseFloat(locWithCoords.lat as string);
              bizLng = parseFloat(locWithCoords.lng as string);
            }
          }
          // Primary location address for display
          const primaryLoc = locs.find((l) => l.isDefault) ?? locs[0];
          const displayAddress = primaryLoc
            ? [primaryLoc.address, primaryLoc.city, primaryLoc.state, primaryLoc.zipCode].filter(Boolean).join(", ")
            : (b.address ?? "");
          // Compute live avgRating and reviewCount from reviews table
          const reviewCount = reviewsList.length;
          const avgRating = reviewCount > 0
            ? Math.round((reviewsList.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
            : null;
          // Collect unique normalized service categories (unknown → "Other")
          const serviceCategories: string[] = [];
          const seen = new Set<string>();
          for (const svc of servicesList) {
            const normalized = normalizeCategory(svc.category);
            if (!seen.has(normalized.toLowerCase())) {
              seen.add(normalized.toLowerCase());
              serviceCategories.push(normalized);
            }
          }
          const hasMobileServices = servicesList.some((svc: any) => svc.serviceType === 'mobile' || svc.serviceType === 'both');
          const hasInStoreServices = servicesList.some((svc: any) => !svc.serviceType || svc.serviceType === 'in_store' || svc.serviceType === 'in-store' || svc.serviceType === 'both');
           return { ...b, locationText, bizLat, bizLng, displayAddress, locs, avgRating, reviewCount, serviceCategories, firstServicePhotoUri, hasMobileServices, hasInStoreServices };
        });
      const results = enriched
        .filter((b) => {
          // Category filter — checks both businessCategory AND serviceCategories
          // A business matches if its primary category OR any of its service categories match
          if (category) {
            const filterCat = category.toLowerCase();
            const bizCat = (b.businessCategory ?? "").toLowerCase();
            const svcCats = (b.serviceCategories ?? []).map((c: string) => c.toLowerCase());

            if (filterCat === "other") {
              // "Other" chip: match businesses that have at least one service category normalized to "Other"
              // OR have no category at all
              const hasOtherSvc = svcCats.some((c: string) => c === "other");
              const hasNoCat = !bizCat && svcCats.length === 0;
              if (!hasOtherSvc && !hasNoCat) return false;
            } else {
              // Match if businessCategory matches
              const bizCatMatch = bizCat && (bizCat.includes(filterCat) || filterCat.includes(bizCat));
              // Match if any serviceCategory matches
              const svcCatMatch = svcCats.some((c: string) =>
                c && (c.includes(filterCat) || filterCat.includes(c))
              );
              if (!bizCatMatch && !svcCatMatch) return false;
            }
          }
          // Text search: match business name, description, address, city, zip
          if (rawSearch) {
            const nameMatch = (b.businessName ?? "").toLowerCase().includes(rawSearch);
            const descMatch = (b.description ?? "").toLowerCase().includes(rawSearch);
            const addrMatch = (b.address ?? "").toLowerCase().includes(rawSearch);
            const locMatch = b.locationText.includes(rawSearch);
            if (!nameMatch && !descMatch && !addrMatch && !locMatch) return false;
          }
          return true;
        })
        .map((b) => {
          let distanceKm: number | null = null;
          if (clientLat !== null && clientLng !== null && b.bizLat !== null && b.bizLng !== null) {
            distanceKm = haversineKm(clientLat, clientLng, b.bizLat!, b.bizLng!);
          }
          const slug = b.customSlug ?? db.sanitizeSlug(b.businessName ?? "");
          const { locationText: _lt, bizLat: _bl, bizLng: _bg, locs: _locs, ...rest } = b;
          return { ...rest, distanceKm, slug, avgRating: b.avgRating, reviewCount: b.reviewCount, serviceCategories: b.serviceCategories, hasMobileServices: (b as any).hasMobileServices ?? false, hasInStoreServices: (b as any).hasInStoreServices ?? true };
        })
        .filter((b) => {
          // Only apply radius filter when we have BOTH client coords AND business coords.
          // If the business has no coordinates yet (lat/lng not geocoded), always include it
          // so newly added businesses are visible even before geocoding completes.
          if (clientLat !== null && b.distanceKm !== null) {
            return b.distanceKm <= radiusKm;
          }
          // Business has no coordinates — include it regardless of client location
          return true;
        })
        .sort((a, b) => {
          // Sort by review count (most reviews first)
          if (sortBy === "reviews") {
            const rcA = (a as any).reviewCount ?? 0;
            const rcB = (b as any).reviewCount ?? 0;
            if (rcB !== rcA) return rcB - rcA;
            const rA = (a as any).avgRating ?? 0;
            const rB = (b as any).avgRating ?? 0;
            return rB - rA;
          }
          // When both have distance, always sort by distance first
          if (sortBy !== "rating" && a.distanceKm !== null && b.distanceKm !== null) {
            return a.distanceKm - b.distanceKm;
          }
          // Sort by rating (descending) when sortBy=rating or no distance available
          const ratingA = (a as any).avgRating ?? 0;
          const ratingB = (b as any).avgRating ?? 0;
          if (ratingB !== ratingA) return ratingB - ratingA;
          // Tie-break by distance if available
          if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
          return 0;
        });

      res.json({ businesses: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  /**
   * GET /api/client/businesses/:slugg — full business detail for client portal
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
      // Normalize phone to E.164 for consistent appointment lookup
      phone = db.normalizePhone(phone);
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
          // Get first service photo if available
          let servicePhotoUri: string | null = null;
          if (service?.localId) {
            const photos = await db.getServicePhotos(appt.businessOwnerId, service.localId);
            servicePhotoUri = photos[0]?.uri ?? null;
          }
          const hasMobileServices = (services as any[]).some((s: any) => s.serviceType === 'mobile');
          return {
            ...appt,
            businessName: owner?.businessName ?? "Unknown",
            businessSlug: owner?.customSlug || (owner?.id ? String(owner.id) : null),
            businessLogoUri: owner?.businessLogoUri ?? null,
            coverPhotoUri: (owner as any)?.coverPhotoUri ?? null,
            businessCategory: owner?.businessCategory ?? null,
            serviceName: service?.name ?? appt.serviceLocalId,
            servicePhotoUri,
            price: service?.price ?? null,
            staffName: staff?.name ?? null,
            staffAvatarUrl: staff?.photoUri ?? null,
            locationName: location?.name ?? null,
            locationAddress: location?.address ?? null,
            locationPhone: location?.phone ?? null,
            clientAddress: (appt as any).clientAddress ?? null,
            travelFee: (appt as any).travelFee ?? null,
            serviceType: service?.serviceType ?? null,
            travelDuration: service?.travelDuration ?? null,
            hasMobileServices,
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
      if (phone) phone = db.normalizePhone(phone);
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

      // Build packageSiblings if this is a package session.
      // Bug #8 fix: query siblings directly by packageBookingId across ALL appointments
      // (not just this client's appointments) so sessions booked under a different phone
      // or email are still included in the sibling list.
      let packageSiblings: any[] = [];
      const pkgBookingId = (appt as any).packageBookingId;
      if (pkgBookingId) {
        const allSiblings = await db.getAppointmentsByPackageBookingId(pkgBookingId, appt.businessOwnerId);
        packageSiblings = allSiblings
          .sort((a: any, b: any) => (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0))
          .map((a: any) => {
            const aLoc = locList.find((l) => l.localId === a.locationId);
            const aStaff = staffList.find((s) => s.localId === a.staffId);
            return {
              id: a.id,
              date: a.date,
              time: a.time,
              duration: a.duration,
              status: a.status,
              sessionIndex: (a.sessionNumber ?? 1) - 1, // convert 1-based sessionNumber to 0-based index
              sessionTotal: a.sessionTotal ?? null,
              locationName: aLoc?.name ?? null,
              staffName: aStaff?.name ?? null,
            };
          });
      }

      res.json({
        ...appt,
        businessName: owner?.businessName ?? "Unknown",
        businessSlug: owner?.customSlug || (owner?.id ? String(owner.id) : null),
        businessLogoUri: owner?.businessLogoUri ?? null,
        coverPhotoUri: (owner as any)?.coverPhotoUri ?? null,
        businessCategory: owner?.businessCategory ?? null,
        serviceName: service?.name ?? (appt as any).packageName ?? appt.serviceLocalId,
        duration: appt.duration || (appt as any).packageDuration || service?.duration || 60,
        price: service?.price ?? null,
        staffName: staff?.name ?? null,
        staffAvatarUrl: staff?.photoUri ?? null,
        locationName: location?.name ?? null,
        locationAddress: location ? [
          location.address,
          location.city,
          location.state,
          location.zipCode,
        ].filter(Boolean).join(", ") : null,
        locationPhone: location?.phone ?? null,
        clientAddress: (appt as any).clientAddress ?? null,
        travelFee: (appt as any).travelFee ?? null,
        serviceType: service?.serviceType ?? null,
        travelDuration: service?.travelDuration ?? null,
        packageSiblings: packageSiblings.length > 0 ? packageSiblings : null,
        localId: appt.localId ?? null,
        stripeConnectEnabled: !!(owner as any)?.stripeConnectEnabled,
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
      if (phone) phone = db.normalizePhone(phone);
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

  /**
   * POST /api/client/appointments/:id/reschedule-request
   * Submits a reschedule request for the appointment (authenticated client portal).
   * Body: { requestedDate: string, requestedTime: string, reason?: string }
   */
  app.post("/api/client/appointments/:id/reschedule-request", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const apptId = parseInt(req.params.id);
      if (isNaN(apptId)) {
        res.status(400).json({ error: "Invalid appointment id" });
        return;
      }
      const { requestedDate, requestedTime, reason } = req.body;
      if (!requestedDate || !requestedTime) {
        res.status(400).json({ error: "requestedDate and requestedTime are required" });
        return;
      }
      let phone = clientAccount!.phone.startsWith("oauth:") ? clientAccount!.email : clientAccount!.phone;
      if (phone) phone = db.normalizePhone(phone);
      const rawAppts = await db.getAppointmentsByClientPhone(phone ?? "");
      const appt = rawAppts.find((a) => a.id === apptId);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      if (appt.status !== "confirmed" && appt.status !== "pending") {
        res.status(400).json({ error: "Cannot request reschedule for this appointment" });
        return;
      }
      const existingRR = (appt as any).rescheduleRequest as any;
      if (existingRR?.status === "pending") {
        res.status(400).json({ error: "A reschedule request is already pending. Please wait for the business to respond." });
        return;
      }
      const rescheduleRequest = {
        status: "pending" as const,
        requestedDate,
        requestedTime,
        reason: reason ?? null,
        submittedAt: new Date().toISOString(),
      };
      await db.updateAppointment(appt.localId, appt.businessOwnerId, { rescheduleRequest } as any);
      // Notify business owner via push
      const owner = await db.getBusinessOwnerById(appt.businessOwnerId);
      if (owner?.expoPushToken) {
        await sendExpoPush(owner.expoPushToken, {
          title: "Reschedule Request",
          body: `${clientAccount!.name ?? "A client"} requested to reschedule their appointment to ${requestedDate} at ${requestedTime}.`,
          data: { type: "reschedule_request", appointmentId: appt.localId },
        }).catch(() => {});
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
            coverPhotoUri: (business as any)?.coverPhotoUri ?? null,
            businessSlug: business?.customSlug ?? db.sanitizeSlug(business?.businessName ?? ""),
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
          const normalizedPhone = clientPhone ? db.normalizePhone(clientPhone) : "";
          // Match via client records
          const matchingClients = await db.getClientsByOwner(item.businessOwnerId);
          const matchedClient = matchingClients.find((c) => {
            if (!c.phone) return false;
            return db.normalizePhone(c.phone) === normalizedPhone;
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
            coverPhotoUri: (business as any)?.coverPhotoUri ?? null,
            businessSlug: business?.customSlug ?? db.sanitizeSlug(business?.businessName ?? ""),
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
      const messages = await db.getClientMessages(businessOwnerId, clientAccount!.id, "client");
      // Mark business messages as read
      await db.markClientMessagesRead(businessOwnerId, clientAccount!.id, "business");
      res.json({ messages });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** DELETE /api/client/messages/:businessOwnerId/:messageId — client soft-deletes a message for themselves */
  app.delete("/api/client/messages/:businessOwnerId/:messageId", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const messageId = parseInt(req.params.messageId);
      if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message id" }); return; }
      await db.deleteClientMessageForSide(messageId, "client");
      res.json({ ok: true });
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
          data: { type: "client_message", clientAccountId: clientAccount!.id, clientName: clientAccount!.name ?? "Client" },
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
            clientAvatarUrl: (client as any)?.profilePhotoUri ?? null,
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

  /** POST /api/business/messages/mark-all-read — mark all client messages as read for this business */
  app.post("/api/business/messages/mark-all-read", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      await db.markAllClientMessagesRead(owner.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
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
      const messages = await db.getClientMessages(owner.id, clientAccountId, "business");
      // Mark client messages as read
      await db.markClientMessagesRead(owner.id, clientAccountId, "client");
      // Include client profile info
      const clientInfo = await db.getClientAccountById(clientAccountId);
      res.json({
        messages,
        clientAvatarUrl: (clientInfo as any)?.profilePhotoUri ?? null,
        clientName: clientInfo?.name ?? "Client",
      });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** DELETE /api/business/messages/:clientAccountId/:messageId — business soft-deletes a message for themselves */
  app.delete("/api/business/messages/:clientAccountId/:messageId", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) { res.status(404).json({ error: "Business owner not found" }); return; }
      const messageId = parseInt(req.params.messageId);
      if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message id" }); return; }
      await db.deleteClientMessageForSide(messageId, "business");
      res.json({ ok: true });
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

  // ── Business: look up client portal account by phone ───────────────────────────

  /** GET /api/business/client-account-by-phone?phone=... — look up a client portal account ID by phone */
  app.get("/api/business/client-account-by-phone", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) { res.status(404).json({ error: "Business owner not found" }); return; }
      const rawPhone = String(req.query.phone ?? "");
      if (!rawPhone) { res.status(400).json({ error: "phone required" }); return; }
      const normalizedPhone = db.normalizePhone(rawPhone);
      const clientAcc = await db.getClientAccountByPhone(normalizedPhone);
      if (!clientAcc) { res.json({ found: false }); return; }
      res.json({ found: true, clientAccountId: clientAcc.id, clientName: clientAcc.name ?? "Client", clientAvatarUrl: (clientAcc as any)?.profilePhotoUri ?? null });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── Saved Businesses ──────────────────────────────────────────────────────

  /** GET /api/client/saved — list saved business IDs (legacy) */
  app.get("/api/client/saved", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const savedIds = await db.getSavedBusinesses(clientAccount!.id);
      res.json({ savedIds });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** GET /api/client/saved-businesses — list saved businesses with full details */
  app.get("/api/client/saved-businesses", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      // Bug #7 fix: use getSavedBusinessesWithTimestamp to return the real savedAt date
      // instead of always returning the current time.
      const savedRows = await db.getSavedBusinessesWithTimestamp(clientAccount!.id);
      const businesses = await Promise.all(
        savedRows.map(async ({ businessOwnerId, savedAt }) => {
          const owner = await db.getBusinessOwnerById(businessOwnerId);
          if (!owner) return null;
          const businessSlug = (owner as any).customSlug ?? db.sanitizeSlug(owner.businessName ?? "");
          return {
            id: owner.id,
            businessOwnerId: owner.id,
            businessName: owner.businessName,
            businessSlug,
            businessCategory: owner.businessCategory ?? null,
            businessAddress: owner.address ?? null,
            businessPhone: owner.phone ?? null,
            businessLogoUri: (owner as any).businessLogoUri ?? null,
            savedAt: savedAt ? savedAt.toISOString() : new Date().toISOString(),
          };
        })
      );
      res.json(businesses.filter(Boolean));
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** POST /api/client/saved-businesses — save a business by slug */
  app.post("/api/client/saved-businesses", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const { businessSlug } = req.body;
      if (!businessSlug) { res.status(400).json({ error: "businessSlug required" }); return; }
      const owner = await db.getBusinessOwnerBySlug(businessSlug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      await db.saveBusinessForClient(clientAccount!.id, owner.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** DELETE /api/client/saved-businesses/:slug — unsave a business by slug */
  app.delete("/api/client/saved-businesses/:slug", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      await db.unsaveBusinessForClient(clientAccount!.id, owner.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  /** POST /api/client/saved/:businessOwnerId — save a business by ID (legacy) */
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

  /** DELETE /api/client/saved/:businessOwnerId — unsave a business by ID (legacy) */
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
      const rawPhotos = await db.getServicePhotos(owner.id, serviceLocalId as string | undefined);
      // Map DB field `uri` → `url` and `note` → `caption` for the client gallery
      const photos = rawPhotos.map((p) => ({ ...p, url: p.uri, caption: p.note ?? null }));
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

  /** PATCH /api/business/service-photos/:id/set-cover — set a photo as the cover (sortOrder=0) */
  app.patch("/api/business/service-photos/:id/set-cover", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }
      const photoId = parseInt(req.params.id);
      await db.setServicePhotoCover(photoId, owner.id);
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
      if (visible) {
        if ((!lat || !lng) && owner.address) {
          const coords = await geocodeAddress(owner.address);
          if (coords) {
            lat = coords.lat as any;
            lng = coords.lng as any;
          }
        }
        // Also geocode locations that have addresses but no coordinates
        const locs = await db.getLocationsByOwner(owner.id);
        for (const loc of locs) {
          if ((!loc.lat || !loc.lng) && loc.address) {
            const locAddr = [loc.address, loc.city, loc.state, loc.zipCode].filter(Boolean).join(", ");
            const coords = await geocodeAddress(locAddr);
            if (coords) {
              await db.updateLocation(loc.localId, owner.id, { lat: coords.lat as any, lng: coords.lng as any });
              // If business has no coords, use first location's coords
              if (!lat || !lng) {
                lat = coords.lat as any;
                lng = coords.lng as any;
              }
            }
          }
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

  // ── POST /api/client/reviews ─────────────────────────────────────────────
  // Submit a review for a completed appointment
  app.post("/api/client/reviews", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      if (!clientAccount) { res.status(401).json({ error: "Unauthorized" }); return; }
      const { businessOwnerId, appointmentId, rating, comment } = req.body;
      if (!businessOwnerId || !rating || rating < 1 || rating > 5) {
        res.status(400).json({ error: "businessOwnerId and rating (1-5) are required" });
        return;
      }
      const localId = `client-review-${clientAccount.id}-${Date.now()}`;
      await db.createReview({
        businessOwnerId: Number(businessOwnerId),
        localId,
        clientLocalId: String(clientAccount.id),
        appointmentLocalId: appointmentId ? String(appointmentId) : undefined,
        rating: Number(rating),
        comment: comment ?? null,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });

  // ── GET /api/client/reviews/check/:appointmentId ─────────────────────────
  // Check if the client has already reviewed a specific appointment
  app.get("/api/client/reviews/check/:appointmentId", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      if (!clientAccount) { res.status(401).json({ error: "Unauthorized" }); return; }
      const { appointmentId } = req.params;
      const existing = await db.getClientReviewForAppointment(clientAccount.id, appointmentId);
      res.json({ reviewed: !!existing, review: existing ?? null });
    } catch (err: any) {
      res.status(err.message === "Unauthorized" ? 401 : 500).json({ error: err.message });
    }
  });


  // ── GET /api/client/packages/:slug ─────────────────────────────────────────
  // Get packages/bundles for a business (public, no auth required)
  app.get("/api/client/packages/:slug", async (req: Request, res: Response) => {
    try {
      const owner = await db.getBusinessOwnerBySlug(req.params.slug);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const dbase = await db.getDb();
      if (!dbase) { res.status(500).json({ error: "Database not available" }); return; }
      const { servicePackages } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const pkgs = await dbase.select().from(servicePackages).where(
        and(eq(servicePackages.businessOwnerId, owner.id), eq(servicePackages.isActive, true))
      );
      // Enrich each package with service details
      const allServices = await db.getServicesByOwner(owner.id);
      const svcMap: Record<string, any> = {};
      allServices.forEach((s: any) => { svcMap[s.localId] = s; });
      const enriched = pkgs.map((pkg: any) => {
        const items = Array.isArray(pkg.packageItems) ? pkg.packageItems : JSON.parse(pkg.packageItems || '[]');
        return {
          localId: pkg.localId,
          name: pkg.name,
          description: pkg.description || null,
          packageItems: items.map((item: any) => ({
            ...item,
            serviceName: svcMap[item.serviceLocalId]?.name || item.serviceLocalId,
            serviceCategory: svcMap[item.serviceLocalId]?.category || null,
            servicePhotoUri: svcMap[item.serviceLocalId]?.photoUri || null,
          })),
          totalSessions: pkg.totalSessions,
          sessionDurationMinutes: pkg.sessionDurationMinutes,
          originalPrice: parseFloat(String(pkg.originalPrice)),
          packagePrice: parseFloat(String(pkg.packagePrice)),
          photoUri: (pkg.photoUri && /^https?:\/\//i.test(pkg.photoUri)) ? pkg.photoUri : null,
          // Fallback: use the first service's photo if the package has no photo
          firstServicePhotoUri: (() => {
            const pkgPhoto = (pkg.photoUri && /^https?:\/\//i.test(pkg.photoUri)) ? pkg.photoUri : null;
            if (pkgPhoto) return null;
            const fallback = items.map((item: any) => svcMap[item.serviceLocalId]?.photoUri).find((u: any) => u && /^https?:\/\//i.test(u));
            return fallback ?? null;
          })(),
          category: pkg.category || null,
        };
      });
      res.json(enriched);
    } catch (err: any) {
      console.error("[Client API] Error fetching packages:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── GET /api/client/my-gifts ────────────────────────────────────────────────
  // Get gift certificates received by the authenticated client (matched by phone/email)
  app.get("/api/client/my-gifts", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      if (!clientAccount) { res.status(401).json({ error: "Unauthorized" }); return; }
      const dbase = await db.getDb();
      if (!dbase) { res.status(500).json({ error: "Database not available" }); return; }
      const { giftCards, businessOwners } = await import("../drizzle/schema");
      const { eq, or } = await import("drizzle-orm");
      // Find gift cards where recipient phone/email matches this client account
      const phone = clientAccount.phone || "";
      const email = clientAccount.email || "";
      const conditions: any[] = [];
      if (phone) conditions.push(eq(giftCards.recipientPhone, phone));
      if (email) conditions.push(eq(giftCards.recipientEmail, email));
      if (conditions.length === 0) { res.json([]); return; }
      const cards = await dbase.select().from(giftCards).where(
        conditions.length === 1 ? conditions[0] : or(...conditions)
      );
      // Enrich with business name and service name
      const result = await Promise.all(cards.map(async (card: any) => {
        const [owner] = await dbase.select({ id: businessOwners.id, businessName: businessOwners.businessName, businessLogoUri: businessOwners.businessLogoUri, customSlug: businessOwners.customSlug }).from(businessOwners).where(eq(businessOwners.id, card.businessOwnerId));
        let serviceName = null;
        if (card.serviceLocalId) {
          const { services: svcTable2 } = await import("../drizzle/schema");
          const { and: andSvc } = await import("drizzle-orm");
          const [svc] = await dbase.select({ name: svcTable2.name }).from(svcTable2).where(andSvc(eq(svcTable2.localId, card.serviceLocalId), eq(svcTable2.businessOwnerId, card.businessOwnerId)));
          serviceName = svc?.name || null;
        }
        // Strip internal GIFT_DATA metadata block from message field
        const rawMsg = card.message || "";
        const giftDataMatch = rawMsg.match(/\n---GIFT_DATA---\n(.+)$/s);
        let remainingBalance: number | null = null;
        let giftType: string = "service";
        let bannerImageUri: string | null = null;
        let transactions: Array<{ type: string; amount: number; balanceAfter: number; at: string }> = [];
        if (giftDataMatch) {
          try {
            const meta = JSON.parse(giftDataMatch[1]);
            remainingBalance = meta.remainingBalance ?? meta.originalValue ?? null;
            giftType = meta.giftType ?? "service";
            bannerImageUri = meta.bannerImageUri ?? null;
            transactions = Array.isArray(meta.transactions) ? meta.transactions : [];
          } catch {}
        }
        const cleanMessage = rawMsg.replace(/\n---GIFT_DATA---\n.+$/s, "").trim() || null;
        const totalVal = card.totalValue ? parseFloat(String(card.totalValue)) : null;
        return {
          localId: card.localId,
          code: card.code,
          serviceLocalId: card.serviceLocalId || null,
          serviceName,
          businessName: owner?.businessName || "Unknown Business",
          businessLogoUri: owner?.businessLogoUri || null,
          businessSlug: owner?.customSlug || (owner?.id ? String(owner.id) : null),
          purchaserName: card.purchaserName || null,
          message: cleanMessage,
          redeemed: card.redeemed,
          redeemedAt: card.redeemedAt || null,
          expiresAt: card.expiresAt || null,
          totalValue: totalVal,
          remainingBalance: remainingBalance ?? totalVal,
          giftType,
          paymentStatus: card.paymentStatus || "unpaid",
          packageLocalId: (card as any).packageLocalId || null,
          createdAt: card.createdAt,
          bannerImageUri,
          transactions,
        };
      }));
      res.json(result);
    } catch (err: any) {
      console.error("[Client API] Error fetching my-gifts:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── GET /api/client/my-packages ─────────────────────────────────────────────
  // Get purchased packages for the authenticated client
  app.get("/api/client/my-packages", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      if (!clientAccount) { res.status(401).json({ error: "Unauthorized" }); return; }
      const dbase = await db.getDb();
      if (!dbase) { res.status(500).json({ error: "Database not available" }); return; }
      const { clientPackages: cpTable, businessOwners } = await import("../drizzle/schema");
      const { eq, or } = await import("drizzle-orm");
      const phone = clientAccount.phone || "";
      const email = clientAccount.email || "";
      const conditions: any[] = [];
      if (clientAccount.id) conditions.push(eq(cpTable.clientAccountId, clientAccount.id));
      if (phone) conditions.push(eq(cpTable.clientPhone, phone));
      if (email) conditions.push(eq(cpTable.clientEmail, email));
      if (conditions.length === 0) { res.json([]); return; }
      const packages = await dbase.select().from(cpTable).where(
        conditions.length === 1 ? conditions[0] : or(...conditions)
      );
      const result = await Promise.all(packages.map(async (pkg: any) => {
        const [owner] = await dbase.select({ id: businessOwners.id, businessName: businessOwners.businessName, businessLogoUri: businessOwners.businessLogoUri, customSlug: businessOwners.customSlug }).from(businessOwners).where(eq(businessOwners.id, pkg.businessOwnerId));
        return {
          localId: pkg.localId,
          packageLocalId: pkg.packageLocalId,
          packageName: pkg.packageName,
          businessName: owner?.businessName || "Unknown Business",
          businessLogoUri: owner?.businessLogoUri || null,
          businessSlug: owner?.customSlug || (owner?.id ? String(owner.id) : null),
          totalSessions: pkg.totalSessions,
          sessionsCompleted: pkg.sessionsCompleted,
          totalValue: pkg.totalValue ? parseFloat(String(pkg.totalValue)) : null,
          status: pkg.status,
          paymentStatus: pkg.paymentStatus,
          purchasedAt: pkg.purchasedAt,
          expiresAt: pkg.expiresAt || null,
          notes: pkg.notes || null,
        };
      }));
      res.json(result);
    } catch (err: any) {
      console.error("[Client API] Error fetching my-packages:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/client/my-packages/:packageLocalId/use-session
   *
   * Validates a package session and (when dryRun=false) decrements the session counter.
   *
   * Bug #6 security fix: only dryRun=true calls are allowed from the client portal.
   * Actual session decrements must be triggered server-side (e.g. when a business owner
   * marks an appointment as completed) to prevent any authenticated client from
   * arbitrarily decrementing another client's package.
   *
   * The booking wizard passes dryRun=true to validate the package before booking, and
   * then passes dryRun=false with an appointmentId after the appointment is created.
   * That final non-dryRun call is now blocked here; the server decrements the session
   * automatically when the appointment status transitions to "completed" (see routers.ts).
   */
  app.post("/api/client/my-packages/:packageLocalId/use-session", async (req: Request, res: Response) => {
    try {
      const { clientAccount } = await getClientAccount(req);
      if (!clientAccount) { res.status(401).json({ error: "Unauthorized" }); return; }
      const { packageLocalId } = req.params;
      const dbase = await db.getDb();
      if (!dbase) { res.status(500).json({ error: "Database not available" }); return; }
      const { clientPackages: cpTable } = await import("../drizzle/schema");
      const { eq, and, or } = await import("drizzle-orm");
      // Find the package belonging to this client
      const clientConditions: any[] = [eq(cpTable.clientAccountId, clientAccount.id)];
      if (clientAccount.phone) clientConditions.push(eq(cpTable.clientPhone, clientAccount.phone));
      if (clientAccount.email) clientConditions.push(eq(cpTable.clientEmail, clientAccount.email));
      const [pkg] = await dbase.select().from(cpTable).where(
        and(eq(cpTable.localId, packageLocalId), or(...clientConditions))
      );
      if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
      if (pkg.status !== "active") { res.status(400).json({ error: "Package is not active" }); return; }
      // Check if package has expired
      if (pkg.expiresAt) {
        const expiry = new Date(pkg.expiresAt + "T23:59:59");
        if (expiry < new Date()) {
          await dbase.update(cpTable).set({ status: "expired" }).where(eq(cpTable.localId, packageLocalId));
          res.status(400).json({ error: "Package expired", code: "PACKAGE_EXPIRED", expiresAt: pkg.expiresAt });
          return;
        }
      }
      // Bug #6: only allow dryRun validation from the client portal.
      // Real session decrements happen server-side when the business marks the appointment completed.
      const { dryRun } = req.body ?? {};
      if (!dryRun) {
        // Return current state so the booking wizard can display it, but do NOT decrement.
        // The session will be decremented by the server when the appointment is completed.
        res.json({ success: true, dryRun: false, sessionsCompleted: pkg.sessionsCompleted, totalSessions: pkg.totalSessions, status: pkg.status });
        return;
      }
      res.json({ success: true, dryRun: true, sessionsCompleted: pkg.sessionsCompleted, totalSessions: pkg.totalSessions, status: pkg.status });
    } catch (err: any) {
      console.error("[Client API] Error using package session:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** POST /api/business/appointments/:appointmentId/confirm-gift-redemption — business owner confirms gift was used */
  app.post("/api/business/appointments/:appointmentId/confirm-gift-redemption", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const owner = await db.getBusinessOwnerByOpenId(user.openId);
      if (!owner) { res.status(404).json({ error: "Business owner not found" }); return; }
      const { appointmentId } = req.params;
      // Find the appointment
      const appts = await db.getAppointmentsByOwner(owner.id);
      const appt = appts.find((a: any) => a.localId === appointmentId);
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }
      if (!appt.giftApplied) { res.status(400).json({ error: "This appointment does not have a gift certificate applied" }); return; }
      // Bug #5 fix: use the giftCode stored directly on the appointment for an exact lookup.
      // This prevents accidentally redeeming the wrong card when a client has multiple
      // unredeemed gift cards at the same business.
      const storedGiftCode = (appt as any).giftCode as string | null | undefined;
      if (storedGiftCode) {
        const { giftCards: gcTableRaw } = await import("../drizzle/schema");
        const gcTable = gcTableRaw as any;
        const { eq: eqGc, and: andGc } = await import("drizzle-orm");
        const dbase = await db.getDb();
        if (dbase) {
          await dbase.update(gcTable)
            .set({ redeemed: true, redeemedAt: new Date(), pendingRedemptionAppointmentId: appointmentId })
            .where(andGc(
              eqGc(gcTable.code, storedGiftCode),
              eqGc(gcTable.businessOwnerId, owner.id)
            ));
        }
      } else {
        // Fallback for legacy appointments that pre-date giftCode storage:
        // mark the card that was already linked via pendingRedemptionAppointmentId
        const { giftCards: gcTableRaw } = await import("../drizzle/schema");
        const gcTable = gcTableRaw as any;
        const { eq: eqGc, and: andGc } = await import("drizzle-orm");
        const dbase = await db.getDb();
        if (dbase) {
          await dbase.update(gcTable)
            .set({ redeemed: true, redeemedAt: new Date() })
            .where(andGc(
              eqGc(gcTable.businessOwnerId, owner.id),
              eqGc(gcTable.redeemed, false),
              eqGc(gcTable.pendingRedemptionAppointmentId, appointmentId)
            ));
        }
      }
      res.json({ success: true, message: "Gift certificate marked as redeemed" });
    } catch (err: any) {
      console.error("[Business API] Error confirming gift redemption:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
