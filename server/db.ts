import { eq, and, sql, isNull, inArray, desc, or, gte, lte, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql2 from "mysql2/promise";
import {
  InsertUser,
  users,
  businessOwners,
  InsertBusinessOwner,
  BusinessOwner,
  services,
  InsertService,
  clients,
  InsertClient,
  appointments,
  InsertAppointment,
  reviews,
  InsertReview,
  discounts,
  InsertDiscount,
  giftCards,
  InsertGiftCard,
  customSchedule,
  InsertCustomSchedule,
  products,
  InsertProduct,
  waitlist,
  InsertWaitlist,
  staffMembers,
  InsertStaffMember,
  locations,
  InsertLocation,
  promoCodes,
  InsertPromoCode,
  DbPromoCode,
  clientAccounts,
  InsertClientAccount,
  ClientAccount,
  clientMessages,
  InsertClientMessage,
  ClientMessage,
  clientSavedBusinesses,
  InsertClientSavedBusiness,
  servicePhotos,
  InsertServicePhoto,
  ServicePhoto,
  servicePackages,
  InsertServicePackage,
  DbServicePackage,
  referralCodes,
  InsertReferralCode,
  ReferralCode,
  referrals,
  InsertReferral,
  Referral,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { storageDeleteMany } from "./storage";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Business Owners ─────────────────────────────────────────────────

export async function getBusinessOwnerByPhone(phone: string): Promise<BusinessOwner | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const normalized = normalizePhone(phone);
  // First try exact match with the normalized form (fast path for new records)
  const exactResult = await db
    .select()
    .from(businessOwners)
    .where(eq(businessOwners.phone, normalized))
    .limit(1);
  if (exactResult.length > 0) return exactResult[0];
  // Fallback: scan all owners and compare normalized digits
  // Handles legacy records stored in non-normalized formats (e.g. "(412) 482-7733")
  const allOwners = await db.select().from(businessOwners);
  return allOwners.find((o) => o.phone && normalizePhone(o.phone) === normalized);
}

export async function getBusinessOwnerByEmail(email: string): Promise<BusinessOwner | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const lowerEmail = email.toLowerCase();
  const result = await db
    .select()
    .from(businessOwners)
    .where(eq(businessOwners.email, lowerEmail))
    .limit(1);
  if (result.length > 0) return result[0];
  // Fallback: case-insensitive scan for legacy records
  const allOwners = await db.select().from(businessOwners);
  return allOwners.find((o) => o.email && o.email.toLowerCase() === lowerEmail);
}

export async function getBusinessOwnerById(id: number): Promise<BusinessOwner | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(businessOwners)
    .where(eq(businessOwners.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createBusinessOwner(data: InsertBusinessOwner): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(businessOwners).values(data);
  return result.insertId;
}

export async function updateBusinessOwner(
  id: number,
  data: Partial<InsertBusinessOwner>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Guard: skip if no fields to update (prevents drizzle 'No values to set' error
  // which can occur when the client sends fields that Zod strips from the schema)
  if (Object.keys(data).length === 0) return;
  await db.update(businessOwners).set(data).where(eq(businessOwners.id, id));
}

export async function deleteBusinessOwner(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // ── Collect all image URLs before deletion for cloud storage cleanup ──
  const [ownerRows, serviceRows, staffRows, locationRows, pkgRows, photoRows] = await Promise.all([
    db.select({ businessLogoUri: businessOwners.businessLogoUri, coverPhotoUri: businessOwners.coverPhotoUri })
      .from(businessOwners).where(eq(businessOwners.id, id)),
    db.select({ photoUri: services.photoUri }).from(services).where(eq(services.businessOwnerId, id)),
    db.select({ photoUri: staffMembers.photoUri }).from(staffMembers).where(eq(staffMembers.businessOwnerId, id)),
    db.select({ photoUri: locations.photoUri }).from(locations).where(eq(locations.businessOwnerId, id)),
    db.select({ photoUri: servicePackages.photoUri }).from(servicePackages).where(eq(servicePackages.businessOwnerId, id)),
    db.select({ uri: servicePhotos.uri }).from(servicePhotos).where(eq(servicePhotos.businessOwnerId, id)),
  ]);

  // Delete all related data first (cascade)
  await db.delete(reviews).where(eq(reviews.businessOwnerId, id));
  await db.delete(appointments).where(eq(appointments.businessOwnerId, id));
  await db.delete(clients).where(eq(clients.businessOwnerId, id));
  await db.delete(servicePhotos).where(eq(servicePhotos.businessOwnerId, id));
  await db.delete(services).where(eq(services.businessOwnerId, id));
  await db.delete(discounts).where(eq(discounts.businessOwnerId, id));
  await db.delete(giftCards).where(eq(giftCards.businessOwnerId, id));
  await db.delete(customSchedule).where(eq(customSchedule.businessOwnerId, id));
  await db.delete(products).where(eq(products.businessOwnerId, id));
  await db.delete(staffMembers).where(eq(staffMembers.businessOwnerId, id));
  await db.delete(locations).where(eq(locations.businessOwnerId, id));
  await db.delete(waitlist).where(eq(waitlist.businessOwnerId, id));
  await db.delete(promoCodes).where(eq(promoCodes.businessOwnerId, id));
  await db.delete(servicePackages).where(eq(servicePackages.businessOwnerId, id));
  // Finally delete the business owner itself
  await db.delete(businessOwners).where(eq(businessOwners.id, id));

  // ── Best-effort: delete all images from cloud storage ──
  const allImageUrls: (string | null | undefined)[] = [
    ...ownerRows.flatMap((r) => [r.businessLogoUri, r.coverPhotoUri]),
    ...serviceRows.map((r) => r.photoUri),
    ...staffRows.map((r) => r.photoUri),
    ...locationRows.map((r) => r.photoUri),
    ...pkgRows.map((r) => r.photoUri),
    ...photoRows.map((r) => r.uri),
  ];
  await storageDeleteMany(allImageUrls);
}

// ─── Admin: Delete individual record by DB id ───────────────────────

export async function deleteClientById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get client info first to cascade
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (client) {
    await db.delete(reviews).where(and(eq(reviews.clientLocalId, client.localId), eq(reviews.businessOwnerId, client.businessOwnerId)));
    await db.delete(appointments).where(and(eq(appointments.clientLocalId, client.localId), eq(appointments.businessOwnerId, client.businessOwnerId)));
  }
  await db.delete(clients).where(eq(clients.id, id));
}

export async function deleteAppointmentById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(appointments).where(eq(appointments.id, id));
}

export async function deleteServiceById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(services).where(eq(services.id, id));
}

export async function deleteStaffMemberById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(staffMembers).where(eq(staffMembers.id, id));
}

export async function deleteLocationById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(locations).where(eq(locations.id, id));
}

export async function deleteDiscountById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(discounts).where(eq(discounts.id, id));
}

export async function deleteGiftCardById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(giftCards).where(eq(giftCards.id, id));
}

export async function deleteReviewById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(reviews).where(eq(reviews.id, id));
}

export async function deleteProductById(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(products).where(eq(products.id, id));
}

/** Sanitize a business name into a clean URL-safe slug (strips special chars like & # etc.). */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")  // remove special chars
    .trim()
    .replace(/\s+/g, "-")           // spaces → dashes
    .replace(/-+/g, "-");           // collapse multiple dashes
}

export async function getBusinessOwnerBySlug(slug: string): Promise<BusinessOwner | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  // Numeric ID fallback: when the slug is a plain integer (e.g. from gift card businessSlug fallback)
  const numericId = /^\d+$/.test(slug.trim()) ? parseInt(slug.trim(), 10) : NaN;
  if (!isNaN(numericId)) {
    const result = await db.select().from(businessOwners);
    return result.find((owner) => owner.id === numericId);
  }
  // Get all business owners and match by customSlug first, then by auto-generated slug
  const result = await db.select().from(businessOwners);
  const lowerSlug = slug.toLowerCase();
  const sanitizedIncoming = sanitizeSlug(slug);
  // First check customSlug (exact match)
  const byCustom = result
    .filter((owner) => (owner as any).customSlug && (owner as any).customSlug.toLowerCase() === lowerSlug)
    .sort((a, b) => b.id - a.id)[0];
  if (byCustom) return byCustom;
  // Fallback: match by auto-generated slug from business name
  // Try both raw slug (spaces → dashes) and sanitized slug (strips & # etc.)
  const byName = result
    .filter((owner) => {
      const rawSlug = owner.businessName.toLowerCase().replace(/\s+/g, "-");
      const cleanSlug = sanitizeSlug(owner.businessName);
      return rawSlug === lowerSlug || cleanSlug === sanitizedIncoming;
    })
    .sort((a, b) => b.id - a.id)[0];
  return byName;
}

// ─── Services ────────────────────────────────────────────────────────

export async function getServicesByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(services).where(eq(services.businessOwnerId, businessOwnerId));
}

export async function createService(data: InsertService): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(services).values(data);
  return result.insertId;
}

export async function updateService(
  id: number,
  businessOwnerId: number,
  data: Partial<InsertService>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(services)
    .set(data)
    .where(and(eq(services.id, id), eq(services.businessOwnerId, businessOwnerId)));
}

export async function deleteService(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(services)
    .where(and(eq(services.localId, localId), eq(services.businessOwnerId, businessOwnerId)));
}

export async function getServiceByLocalId(localId: string, businessOwnerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(services)
    .where(and(eq(services.localId, localId), eq(services.businessOwnerId, businessOwnerId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Clients ─────────────────────────────────────────────────────────

export async function getClientsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clients).where(eq(clients.businessOwnerId, businessOwnerId));
}

export async function createClient(data: InsertClient): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(clients).values(data);
  return result.insertId;
}

export async function updateClient(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertClient>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(clients)
    .set(data)
    .where(and(eq(clients.localId, localId), eq(clients.businessOwnerId, businessOwnerId)));
}

export async function deleteClient(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete appointments for this client first (reviews are intentionally preserved)
  await db
    .delete(appointments)
    .where(
      and(
        eq(appointments.clientLocalId, localId),
        eq(appointments.businessOwnerId, businessOwnerId)
      )
    );
  // Delete the client record (reviews are kept — their clientLocalId becomes an orphan reference
  // but the review data remains accessible in the business owner's review list)
  await db
    .delete(clients)
    .where(and(eq(clients.localId, localId), eq(clients.businessOwnerId, businessOwnerId)));
}

/** Normalize a phone number to 10-digit US format for consistent matching.
 *  "4124820000" -> "4124820000"
 *  "+14124820000" -> "4124820000"
 *  "14124820000" -> "4124820000"
 *  "(412) 482-0000" -> "4124820000" */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // US number with country code 1 prefix
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  // Already 10 digits
  if (digits.length === 10) {
    return digits;
  }
  // Return as-is for non-standard lengths
  return digits;
}

export async function getClientByPhone(phone: string, businessOwnerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const normalized = normalizePhone(phone);
  // Fetch all clients for this business and match by normalized phone
  const allClients = await db
    .select()
    .from(clients)
    .where(eq(clients.businessOwnerId, businessOwnerId));
  return allClients.find((c) => c.phone && normalizePhone(c.phone) === normalized) || undefined;
}

// ─── Appointments ────────────────────────────────────────────────────

export async function getAppointmentsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.businessOwnerId, businessOwnerId));
}

export async function createAppointment(data: InsertAppointment): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(appointments).values(data);
  return result.insertId;
}

export async function updateAppointment(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertAppointment>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(appointments)
    .set(data)
    .where(
      and(
        eq(appointments.localId, localId),
        eq(appointments.businessOwnerId, businessOwnerId)
      )
    );
}

export async function bulkMarkPaid(
  localIds: string[],
  businessOwnerId: number,
  paymentMethod: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (localIds.length === 0) return;
  // Process in chunks of 200 to avoid query size limits
  const CHUNK = 200;
  for (let i = 0; i < localIds.length; i += CHUNK) {
    const chunk = localIds.slice(i, i + CHUNK);
    await db
      .update(appointments)
      .set({ paymentStatus: "paid", paymentMethod: paymentMethod as any })
      .where(
        and(
          eq(appointments.businessOwnerId, businessOwnerId),
          inArray(appointments.localId, chunk)
        )
      );
  }
}

export async function bulkMarkUnpaid(
  localIds: string[],
  businessOwnerId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (localIds.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < localIds.length; i += CHUNK) {
    const chunk = localIds.slice(i, i + CHUNK);
    await db
      .update(appointments)
      .set({ paymentStatus: "unpaid", paymentMethod: "unpaid" })
      .where(
        and(
          eq(appointments.businessOwnerId, businessOwnerId),
          inArray(appointments.localId, chunk)
        )
      );
  }
}

export async function deleteAppointment(
  localId: string,
  businessOwnerId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(appointments)
    .where(
      and(
        eq(appointments.localId, localId),
        eq(appointments.businessOwnerId, businessOwnerId)
      )
    );
}

// ─── Reviews ─────────────────────────────────────────────────────────

export async function getReviewsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviews).where(eq(reviews.businessOwnerId, businessOwnerId));
}

export async function createReview(data: InsertReview): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(reviews).values(data);
  return result.insertId;
}

export async function deleteReview(
  localId: string,
  businessOwnerId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(reviews)
    .where(
      and(eq(reviews.localId, localId), eq(reviews.businessOwnerId, businessOwnerId))
    );
}

// ─── Discounts ──────────────────────────────────────────────────────

export async function getDiscountsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(discounts).where(eq(discounts.businessOwnerId, businessOwnerId));
}

export async function createDiscount(data: InsertDiscount): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(discounts).values(data);
  return result.insertId;
}

export async function updateDiscount(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertDiscount>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(discounts)
    .set(data)
    .where(and(eq(discounts.localId, localId), eq(discounts.businessOwnerId, businessOwnerId)));
}

export async function deleteDiscount(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(discounts)
    .where(and(eq(discounts.localId, localId), eq(discounts.businessOwnerId, businessOwnerId)));
}

// ─── Gift Cards ─────────────────────────────────────────────────────

export async function getGiftCardsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(giftCards).where(eq(giftCards.businessOwnerId, businessOwnerId));
}

export async function createGiftCard(data: InsertGiftCard): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(giftCards).values(data);
  return result.insertId;
}

export async function updateGiftCard(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertGiftCard>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(giftCards)
    .set(data)
    .where(and(eq(giftCards.localId, localId), eq(giftCards.businessOwnerId, businessOwnerId)));
}

/**
 * Atomically deduct from a gift card balance using a MySQL transaction with SELECT FOR UPDATE.
 * Creates a dedicated connection to avoid interfering with the Drizzle ORM connection.
 *
 * Returns: { success: true, newBalance } if deducted, or { success: false, reason } if not.
 */
export async function atomicDeductGiftCardBalance(
  code: string,
  businessOwnerId: number,
  deductAmount: number
): Promise<{ success: boolean; newBalance?: number; reason?: string }> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");

  // Create a dedicated connection for the transaction (separate from Drizzle's connection)
  const conn = await mysql2.createConnection(process.env.DATABASE_URL);
  try {
    await conn.beginTransaction();

    // Lock the row with SELECT FOR UPDATE — blocks concurrent transactions on the same row
    const [rows] = await conn.execute(
      `SELECT id, message FROM gift_cards WHERE code = ? AND businessOwnerId = ? FOR UPDATE`,
      [code, businessOwnerId]
    ) as any;

    if (!rows || rows.length === 0) {
      await conn.rollback();
      return { success: false, reason: "Gift card not found" };
    }

    const row = rows[0];
    const msgStr = row.message || "";
    const match = msgStr.match(/\n---GIFT_DATA---\n(.+)$/s);
    let meta: any = {};
    if (match) { try { meta = JSON.parse(match[1]); } catch (_) {} }

    const currentBalance: number = meta.remainingBalance ?? meta.originalValue ?? 0;
    if (currentBalance < deductAmount - 0.01) {
      await conn.rollback();
      return { success: false, reason: `Insufficient balance: $${currentBalance.toFixed(2)} available, $${deductAmount.toFixed(2)} requested` };
    }

    const newBalance = Math.max(0, currentBalance - deductAmount);
    meta.remainingBalance = newBalance;
    const cleanMsg = msgStr.replace(/\n---GIFT_DATA---\n.+$/s, "");
    const updatedMsg = cleanMsg + "\n---GIFT_DATA---\n" + JSON.stringify(meta);
    const fullyRedeemed = newBalance <= 0;

    await conn.execute(
      `UPDATE gift_cards SET message = ?, redeemed = ?, redeemedAt = ? WHERE id = ?`,
      [updatedMsg, fullyRedeemed ? 1 : 0, fullyRedeemed ? new Date() : null, row.id]
    );

    await conn.commit();
    return { success: true, newBalance };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

export async function deleteGiftCard(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(giftCards)
    .where(and(eq(giftCards.localId, localId), eq(giftCards.businessOwnerId, businessOwnerId)));
}

export async function getGiftCardByCode(code: string, businessOwnerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.code, code), eq(giftCards.businessOwnerId, businessOwnerId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Custom Schedule ────────────────────────────────────────────────

export async function getCustomScheduleByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customSchedule).where(eq(customSchedule.businessOwnerId, businessOwnerId));
}

export async function upsertCustomScheduleDay(
  businessOwnerId: number,
  date: string,
  isOpen: boolean,
  startTime?: string,
  endTime?: string,
  locationId?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(customSchedule)
    .where(and(
      eq(customSchedule.businessOwnerId, businessOwnerId),
      eq(customSchedule.date, date),
      locationId ? eq(customSchedule.locationId, locationId) : isNull(customSchedule.locationId)
    ))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(customSchedule)
      .set({ isOpen, startTime: startTime ?? null, endTime: endTime ?? null })
      .where(and(
        eq(customSchedule.businessOwnerId, businessOwnerId),
        eq(customSchedule.date, date),
        locationId ? eq(customSchedule.locationId, locationId) : isNull(customSchedule.locationId)
      ));
  } else {
    await db.insert(customSchedule).values({
      businessOwnerId,
      date,
      isOpen,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      locationId: locationId ?? null,
    });
  }
}

export async function deleteCustomScheduleDay(
  businessOwnerId: number,
  date: string,
  locationId?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(customSchedule)
    .where(and(
      eq(customSchedule.businessOwnerId, businessOwnerId),
      eq(customSchedule.date, date),
      locationId ? eq(customSchedule.locationId, locationId) : isNull(customSchedule.locationId)
    ));
}

// ─── Products ────────────────────────────────────────────────────────────────

export async function getProductsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).where(eq(products.businessOwnerId, businessOwnerId));
}

export async function createProduct(data: InsertProduct): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(products).values(data);
  return result.insertId;
}

export async function updateProduct(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertProduct>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(products)
    .set(data)
    .where(and(eq(products.localId, localId), eq(products.businessOwnerId, businessOwnerId)));
}

export async function deleteProduct(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(products)
    .where(and(eq(products.localId, localId), eq(products.businessOwnerId, businessOwnerId)));
}

// ─── Bootstrap: Load all data for a business owner ───────────────────


// ─── Promo Codes ─────────────────────────────────────────────────────
export async function getPromoCodesByOwner(businessOwnerId: number): Promise<DbPromoCode[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(promoCodes).where(eq(promoCodes.businessOwnerId, businessOwnerId));
}
export async function createPromoCode(data: InsertPromoCode): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(promoCodes).values(data);
  return result.insertId;
}
export async function updatePromoCode(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertPromoCode>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(promoCodes)
    .set(data)
    .where(and(eq(promoCodes.localId, localId), eq(promoCodes.businessOwnerId, businessOwnerId)));
}
export async function deletePromoCode(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(promoCodes)
    .where(and(eq(promoCodes.localId, localId), eq(promoCodes.businessOwnerId, businessOwnerId)));
}
export async function getPromoCodeByCode(code: string, businessOwnerId: number): Promise<DbPromoCode | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.code, code), eq(promoCodes.businessOwnerId, businessOwnerId)));
  return rows[0];
}
export async function incrementPromoCodeUsage(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(promoCodes)
    .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
    .where(and(eq(promoCodes.localId, localId), eq(promoCodes.businessOwnerId, businessOwnerId)));
}

export async function getFullBusinessData(businessOwnerId: number) {
  const [owner, svcList, clientList, apptList, reviewList, discountList, giftCardList, scheduleList, productList, staffList, locationList, promoList, packageList, referralCode] = await Promise.all([
    getBusinessOwnerById(businessOwnerId),
    getServicesByOwner(businessOwnerId),
    getClientsByOwner(businessOwnerId),
    getAppointmentsByOwner(businessOwnerId),
    getReviewsByOwner(businessOwnerId),
    getDiscountsByOwner(businessOwnerId),
    getGiftCardsByOwner(businessOwnerId),
    getCustomScheduleByOwner(businessOwnerId),
    getProductsByOwner(businessOwnerId),
    getStaffByOwner(businessOwnerId),
    getLocationsByOwner(businessOwnerId),
    getPromoCodesByOwner(businessOwnerId),
    getServicePackagesByOwner(businessOwnerId),
    getReferralCodeByOwner(businessOwnerId),
  ]);
  return {
    owner,
    services: svcList,
    clients: clientList,
    appointments: apptList,
    reviews: reviewList,
    discounts: discountList,
    giftCards: giftCardList,
    customSchedule: scheduleList,
    products: productList,
    staff: staffList,
    locations: locationList,
    promoCodes: promoList,
    servicePackages: packageList,
    referralCode: referralCode || null,
  };
}

// ─── Waitlist ────────────────────────────────────────────────────────

export async function getWaitlistByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(waitlist).where(eq(waitlist.businessOwnerId, businessOwnerId));
}

export async function createWaitlistEntry(data: InsertWaitlist): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(waitlist).values(data);
  return result[0].insertId;
}

export async function updateWaitlistEntry(
  id: number,
  data: Partial<InsertWaitlist>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(waitlist).set(data).where(eq(waitlist.id, id));
}

export async function deleteWaitlistEntry(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(waitlist).where(eq(waitlist.id, id));
}

export async function getWaitlistForDateAndService(
  businessOwnerId: number,
  date: string,
  serviceLocalId: string
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.businessOwnerId, businessOwnerId),
        eq(waitlist.preferredDate, date),
        eq(waitlist.serviceLocalId, serviceLocalId),
        eq(waitlist.status, "waiting")
      )
    );
}

// ─── Appointment Lookup ─────────────────────────────────────────────

export async function getAppointmentByLocalId(localId: string, businessOwnerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.localId, localId),
        eq(appointments.businessOwnerId, businessOwnerId)
      )
    );
  return rows[0];
}

/**
 * Get an appointment enriched with client, service, and location details.
 * Used for sending confirmation emails.
 */
export async function getEnrichedAppointment(localId: string, businessOwnerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.localId, localId), eq(appointments.businessOwnerId, businessOwnerId)))
    .limit(1);
  const appt = rows[0];
  if (!appt) return undefined;

  // Fetch client, service, and location in parallel
  const [clientRows, serviceRows, locationRows] = await Promise.all([
    db.select().from(clients).where(and(eq(clients.localId, appt.clientLocalId), eq(clients.businessOwnerId, businessOwnerId))).limit(1),
    db.select().from(services).where(and(eq(services.localId, appt.serviceLocalId), eq(services.businessOwnerId, businessOwnerId))).limit(1),
    appt.locationId
      ? db.select().from(locations).where(and(eq(locations.localId, appt.locationId), eq(locations.businessOwnerId, businessOwnerId))).limit(1)
      : Promise.resolve([]),
  ]);

  const client = clientRows[0];
  const service = serviceRows[0];
  const location = locationRows[0];

  return {
    ...appt,
    clientName: client?.name ?? null,
    clientEmail: client?.email ?? null,
    clientPhone: client?.phone ?? null,
    serviceName: service?.name ?? null,
    locationName: location?.name ?? null,
    locationAddress: location?.address ?? null,
    locationCity: location?.city ?? null,
    locationState: location?.state ?? null,
    locationZip: location?.zipCode ?? null,
    locationPhone: location?.phone ?? null,
  };
}

// ─── Staff Members ─────────────────────────────────────────────────

export async function getStaffByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(staffMembers).where(eq(staffMembers.businessOwnerId, businessOwnerId));
}

export async function createStaffMember(data: InsertStaffMember): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(staffMembers).values(data);
  return result[0].insertId;
}

export async function updateStaffMember(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertStaffMember>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(staffMembers)
    .set(data)
    .where(
      and(
        eq(staffMembers.localId, localId),
        eq(staffMembers.businessOwnerId, businessOwnerId)
      )
    );
}

export async function deleteStaffMember(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(staffMembers)
    .where(
      and(
        eq(staffMembers.localId, localId),
        eq(staffMembers.businessOwnerId, businessOwnerId)
      )
    );
}

// ─── Locations ─────────────────────────────────────────────────────

export async function getLocationsByOwner(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(locations).where(eq(locations.businessOwnerId, businessOwnerId));
}

export async function createLocation(data: InsertLocation): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(locations).values(data);
  return result[0].insertId;
}

export async function updateLocation(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertLocation>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(locations)
    .set(data)
    .where(
      and(
        eq(locations.localId, localId),
        eq(locations.businessOwnerId, businessOwnerId)
      )
    );
}

export async function deleteLocation(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(locations)
    .where(
      and(
        eq(locations.localId, localId),
        eq(locations.businessOwnerId, businessOwnerId)
      )
    );
}

// ─── Business Usage Counts ────────────────────────────────────────────
export async function getBusinessUsageCounts(businessOwnerId: number): Promise<{
  locations: number;
  staff: number;
  clients: number;
  services: number;
  products: number;
}> {
  const db = await getDb();
  if (!db) return { locations: 0, staff: 0, clients: 0, services: 0, products: 0 };
  const [locCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(locations)
    .where(eq(locations.businessOwnerId, businessOwnerId));
  const [staffCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(staffMembers)
    .where(eq(staffMembers.businessOwnerId, businessOwnerId));
  const [clientCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(clients)
    .where(eq(clients.businessOwnerId, businessOwnerId));
  const [svcCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(services)
    .where(eq(services.businessOwnerId, businessOwnerId));
  const [prodCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(products)
    .where(eq(products.businessOwnerId, businessOwnerId));
  return {
    locations: Number(locCount?.count ?? 0),
    staff: Number(staffCount?.count ?? 0),
    clients: Number(clientCount?.count ?? 0),
    services: Number(svcCount?.count ?? 0),
    products: Number(prodCount?.count ?? 0),
  };
}
// ─── Client Accounts ─────────────────────────────────────────────────

export async function getClientAccountByPhone(phone: string): Promise<ClientAccount | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(clientAccounts).where(eq(clientAccounts.phone, phone)).limit(1);
  return rows[0] ?? null;
}

export async function getClientAccountById(id: number): Promise<ClientAccount | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(clientAccounts).where(eq(clientAccounts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertClientAccount(data: InsertClientAccount): Promise<ClientAccount> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getClientAccountByPhone(data.phone);
  if (existing) {
    await db.update(clientAccounts).set({ ...data, updatedAt: new Date() }).where(eq(clientAccounts.id, existing.id));
    return (await getClientAccountById(existing.id))!;
  }
  const result = await db.insert(clientAccounts).values(data);
  const insertId = (result as any)[0]?.insertId ?? (result as any).insertId;
  return (await getClientAccountById(insertId))!;
}

export async function updateClientAccount(id: number, data: Partial<InsertClientAccount>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(clientAccounts).set({ ...data, updatedAt: new Date() }).where(eq(clientAccounts.id, id));
}

// ─── Client Messages ──────────────────────────────────────────────────

export async function getClientMessages(
  businessOwnerId: number,
  clientAccountId: number,
  viewerSide: "business" | "client" = "business"
): Promise<ClientMessage[]> {
  const db = await getDb();
  if (!db) return [];
  const deletedFilter = viewerSide === "business"
    ? eq(clientMessages.deletedByBusiness, false)
    : eq(clientMessages.deletedByClient, false);
  return db
    .select()
    .from(clientMessages)
    .where(and(
      eq(clientMessages.businessOwnerId, businessOwnerId),
      eq(clientMessages.clientAccountId, clientAccountId),
      deletedFilter
    ))
    .orderBy(clientMessages.createdAt);
}

export async function insertClientMessage(data: InsertClientMessage): Promise<ClientMessage> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clientMessages).values(data);
  const insertId = (result as any)[0]?.insertId ?? (result as any).insertId;
  const rows = await db.select().from(clientMessages).where(eq(clientMessages.id, insertId)).limit(1);
  return rows[0];
}

export async function markClientMessagesRead(businessOwnerId: number, clientAccountId: number, senderType: "business" | "client"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(clientMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(clientMessages.businessOwnerId, businessOwnerId),
        eq(clientMessages.clientAccountId, clientAccountId),
        eq(clientMessages.senderType, senderType),
        isNull(clientMessages.readAt)
      )
    );
}

export async function markAllClientMessagesRead(businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(clientMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(clientMessages.businessOwnerId, businessOwnerId),
        eq(clientMessages.senderType, "client"),
        isNull(clientMessages.readAt)
      )
    );
}
/** Soft-delete a message for one side only (business or client) */
export async function deleteClientMessageForSide(
  messageId: number,
  side: "business" | "client"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const update = side === "business"
    ? { deletedByBusiness: true }
    : { deletedByClient: true };
  await db.update(clientMessages).set(update).where(eq(clientMessages.id, messageId));
}
export async function getClientMessageInbox(clientAccountId: number): Promise<{ businessOwnerId: number; lastMessage: string; lastAt: Date; unreadCount: number }[]> {
  const db = await getDb();
  if (!db) return [];
  // Get distinct business conversations for this client
  const rows = await db
    .select()
    .from(clientMessages)
    .where(eq(clientMessages.clientAccountId, clientAccountId))
    .orderBy(clientMessages.createdAt);
  // Group by businessOwnerId
  const map = new Map<number, { lastMessage: string; lastAt: Date; unreadCount: number }>();
  for (const msg of rows) {
    const existing = map.get(msg.businessOwnerId);
    const isUnread = !msg.readAt && msg.senderType === "business";
    if (!existing || msg.createdAt > existing.lastAt) {
      map.set(msg.businessOwnerId, {
        lastMessage: msg.body,
        lastAt: msg.createdAt,
        unreadCount: (existing?.unreadCount ?? 0) + (isUnread ? 1 : 0),
      });
    } else if (isUnread) {
      existing.unreadCount++;
    }
  }
  return Array.from(map.entries()).map(([businessOwnerId, v]) => ({ businessOwnerId, ...v }));
}

export async function getBusinessMessageInbox(businessOwnerId: number): Promise<{ clientAccountId: number; lastMessage: string; lastAt: Date; lastMessageAt: string; unreadCount: number; senderType: "client" | "business" }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(clientMessages)
    .where(eq(clientMessages.businessOwnerId, businessOwnerId))
    .orderBy(clientMessages.createdAt);
  const map = new Map<number, { lastMessage: string; lastAt: Date; unreadCount: number; senderType: "client" | "business" }>();
  for (const msg of rows) {
    const existing = map.get(msg.clientAccountId);
    const isUnread = !msg.readAt && msg.senderType === "client";
    if (!existing || msg.createdAt > existing.lastAt) {
      map.set(msg.clientAccountId, {
        lastMessage: msg.body,
        lastAt: msg.createdAt,
        unreadCount: (existing?.unreadCount ?? 0) + (isUnread ? 1 : 0),
        senderType: msg.senderType,
      });
    } else if (isUnread) {
      existing.unreadCount++;
    }
  }
  return Array.from(map.entries()).map(([clientAccountId, v]) => ({
    clientAccountId,
    ...v,
    lastMessageAt: v.lastAt.toISOString(),
  }));
}

// ─── Client Saved Businesses ─────────────────────────────────────────

export async function getSavedBusinesses(clientAccountId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(clientSavedBusinesses).where(eq(clientSavedBusinesses.clientAccountId, clientAccountId));
  return rows.map((r) => r.businessOwnerId);
}

export async function saveBusinessForClient(clientAccountId: number, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Upsert — ignore if already saved
  try {
    await db.insert(clientSavedBusinesses).values({ clientAccountId, businessOwnerId });
  } catch {
    // Already saved — ignore duplicate
  }
}

export async function unsaveBusinessForClient(clientAccountId: number, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(clientSavedBusinesses)
    .where(and(eq(clientSavedBusinesses.clientAccountId, clientAccountId), eq(clientSavedBusinesses.businessOwnerId, businessOwnerId)));
}

// ─── Service Photos ───────────────────────────────────────────────────

export async function getServicePhotos(businessOwnerId: number, serviceLocalId?: string): Promise<ServicePhoto[]> {
  const db = await getDb();
  if (!db) return [];
  if (serviceLocalId) {
    return db
      .select()
      .from(servicePhotos)
      .where(and(eq(servicePhotos.businessOwnerId, businessOwnerId), eq(servicePhotos.serviceLocalId, serviceLocalId)))
      .orderBy(servicePhotos.sortOrder);
  }
  return db.select().from(servicePhotos).where(eq(servicePhotos.businessOwnerId, businessOwnerId)).orderBy(servicePhotos.sortOrder);
}

export async function insertServicePhoto(data: InsertServicePhoto): Promise<ServicePhoto> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(servicePhotos).values(data);
  const insertId = (result as any)[0]?.insertId ?? (result as any).insertId;
  const rows = await db.select().from(servicePhotos).where(eq(servicePhotos.id, insertId)).limit(1);
  return rows[0];
}

export async function deleteServicePhoto(id: number, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(servicePhotos).where(and(eq(servicePhotos.id, id), eq(servicePhotos.businessOwnerId, businessOwnerId)));
}
export async function setServicePhotoCover(coverId: number, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allPhotos = await db.select().from(servicePhotos)
    .where(eq(servicePhotos.businessOwnerId, businessOwnerId))
    .orderBy(servicePhotos.sortOrder);
  const target = allPhotos.find((p) => p.id === coverId);
  if (!target) throw new Error("Photo not found");
  const siblings = allPhotos.filter((p) => p.serviceLocalId === target.serviceLocalId);
  let order = 1;
  for (const p of siblings) {
    const newOrder = p.id === coverId ? 0 : order++;
    await db.update(servicePhotos).set({ sortOrder: newOrder }).where(eq(servicePhotos.id, p.id));
  }
}

// ─── Business Discovery ───────────────────────────────────────────────

export async function getDiscoverableBusinesses(): Promise<BusinessOwner[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(businessOwners).where(eq(businessOwners.clientPortalVisible, true));
}

// ─── Client Portal Extra Helpers ─────────────────────────────────────

export async function getBusinessOwnerByOpenId(openId: string): Promise<BusinessOwner | undefined> {
  const user = await getUserByOpenId(openId);
  if (!user) return undefined;
  // Business owner is linked via userId
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(businessOwners).where(eq(businessOwners.userId, user.id)).limit(1);
  if (rows[0]) return rows[0];
  // Fallback: match by phone (phone-only signup)
  if (user.email) return getBusinessOwnerByEmail(user.email);
  return undefined;
}

export async function getAppointmentsByClientPhone(phone: string) {
  const db = await getDb();
  if (!db) return [];
  // Find all clients with this phone number across all businesses
  const matchingClients = await db.select().from(clients).where(eq(clients.phone, phone));
  if (matchingClients.length === 0) return [];
  // Get appointments for each client
  const allAppointments: (typeof appointments.$inferSelect)[] = [];
  for (const client of matchingClients) {
    const appts = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.clientLocalId, client.localId), eq(appointments.businessOwnerId, client.businessOwnerId)))
      .orderBy(sql`${appointments.date} DESC`);
    allAppointments.push(...appts);
  }
  return allAppointments.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getServices(businessOwnerId: number) {
  return getServicesByOwner(businessOwnerId);
}

export async function getStaffMembers(businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(staffMembers).where(eq(staffMembers.businessOwnerId, businessOwnerId));
}

export async function getLocations(businessOwnerId: number) {
  return getLocationsByOwner(businessOwnerId);
}

export async function getReviews(businessOwnerId: number) {
  return getReviewsByOwner(businessOwnerId);
}

export async function getClientReviewForAppointment(clientAccountId: number, appointmentId: string) {
  const db = await getDb();
  if (!db) return null;
  const clientLocalId = String(clientAccountId);
  const results = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.clientLocalId, clientLocalId),
        eq(reviews.appointmentLocalId, appointmentId)
      )
    )
    .limit(1);
  return results[0] ?? null;
}

// ─── Service Packages / Bundles ──────────────────────────────────────────────

export async function getServicePackagesByOwner(businessOwnerId: number): Promise<DbServicePackage[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(servicePackages).where(eq(servicePackages.businessOwnerId, businessOwnerId));
}

export async function createServicePackage(data: InsertServicePackage): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(servicePackages).values(data);
  return result.insertId;
}

export async function updateServicePackage(
  localId: string,
  businessOwnerId: number,
  data: Partial<InsertServicePackage>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(servicePackages)
    .set(data)
    .where(and(eq(servicePackages.localId, localId), eq(servicePackages.businessOwnerId, businessOwnerId)));
}

export async function deleteServicePackage(localId: string, businessOwnerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(servicePackages)
    .where(and(eq(servicePackages.localId, localId), eq(servicePackages.businessOwnerId, businessOwnerId)));
}

// ─── Package Session Helpers ──────────────────────────────────────────────────
/**
 * Get all appointments belonging to the same package booking group.
 * Used to count completed sessions and build progress messages.
 */
export async function getAppointmentsByPackageBookingId(packageBookingId: string, businessOwnerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(appointments)
    .where(and(eq(appointments.packageBookingId, packageBookingId), eq(appointments.businessOwnerId, businessOwnerId)));
}

// ─── Referral Helpers ─────────────────────────────────────────────────────────

/** Generate a readable referral code from business name + 4 random chars */
export function generateReferralCode(businessName: string): string {
  const slug = businessName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5)
    .padEnd(3, "X");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${slug}-${suffix}`;
}

/** Get or create a referral code for a business owner */
export async function getOrCreateReferralCode(businessOwnerId: number, businessName: string): Promise<ReferralCode | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await db
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.businessOwnerId, businessOwnerId), eq(referralCodes.isActive, true)))
    .limit(1);
  if (existing.length > 0) return existing[0];
  // Generate a unique code (retry up to 5 times on collision)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode(businessName);
    try {
      await db.insert(referralCodes).values({ businessOwnerId, code });
      const created = await db.select().from(referralCodes).where(eq(referralCodes.code, code)).limit(1);
      return created[0] ?? null;
    } catch {
      // Unique constraint violation — retry
    }
  }
  return null;
}

/** Validate a referral code and return it if active and not expired */
export async function validateReferralCode(code: string): Promise<ReferralCode | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.code, code.toUpperCase().trim()), eq(referralCodes.isActive, true)))
    .limit(1);
  if (!rows[0]) return null;
  // Check expiry
  const rc = rows[0] as any;
  if (rc.expiresAt && new Date(rc.expiresAt) < new Date()) return null;
  return rows[0];
}

/** Admin: set expiry date on a referral code */
export async function setReferralCodeExpiry(referralCodeId: number, expiresAt: Date | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(referralCodes).set({ expiresAt } as any).where(eq(referralCodes.id, referralCodeId));
}

/** Get referral code by business owner ID */
export async function getReferralCodeByOwner(businessOwnerId: number): Promise<ReferralCode | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.businessOwnerId, businessOwnerId))
    .limit(1);
  return rows[0] ?? null;
}

/** Create a referral record when a new user applies a code */
export async function createReferral(
  referralCodeId: number,
  referrerBusinessOwnerId: number,
  referredBusinessOwnerId: number,
): Promise<Referral | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(referrals).values({ referralCodeId, referrerBusinessOwnerId, referredBusinessOwnerId });
  const rows = await db
    .select()
    .from(referrals)
    .where(eq(referrals.referredBusinessOwnerId, referredBusinessOwnerId))
    .orderBy(referrals.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

/** Get referral record for a referred business owner */
export async function getReferralByReferredOwner(referredBusinessOwnerId: number): Promise<Referral | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referrals)
    .where(eq(referrals.referredBusinessOwnerId, referredBusinessOwnerId))
    .limit(1);
  return rows[0] ?? null;
}

/** Get all referrals made by a referrer */
export async function getReferralsByReferrer(referrerBusinessOwnerId: number): Promise<Referral[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(referrals)
    .where(eq(referrals.referrerBusinessOwnerId, referrerBusinessOwnerId))
    .orderBy(referrals.createdAt);
}

/** Update referral status and optional fields */
export async function updateReferralStatus(
  referralId: number,
  updates: Partial<Pick<Referral, "status" | "appliedCouponId" | "convertedAt" | "rewardedAt" | "referrerRewardId">>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(referrals).set(updates as any).where(eq(referrals.id, referralId));
}

/** Increment totalUses on a referral code */
export async function incrementReferralCodeUses(referralCodeId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(referralCodes)
    .set({ totalUses: sql`${referralCodes.totalUses} + 1` })
    .where(eq(referralCodes.id, referralCodeId));
}

/** Admin: get all referral codes with usage stats */
export async function getAllReferralCodes(): Promise<ReferralCode[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(referralCodes).orderBy(referralCodes.createdAt);
}

/** Admin: get all referrals */
export async function getAllReferrals(): Promise<Referral[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(referrals).orderBy(referrals.createdAt);
}

/** Update stripeCouponId on a referral code */
export async function setReferralCodeCoupon(referralCodeId: number, stripeCouponId: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(referralCodes).set({ stripeCouponId }).where(eq(referralCodes.id, referralCodeId));
}
