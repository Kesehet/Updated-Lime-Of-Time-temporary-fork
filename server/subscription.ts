/**
 * Subscription Plan Middleware & Helpers
 *
 * Provides:
 * - getPlanLimits(businessOwnerId): returns the effective limits for a business
 * - checkPlanLimit(businessOwnerId, resource, currentCount): throws if limit exceeded
 * - getEffectivePlan(businessOwner): returns 'enterprise' if adminOverride, else subscriptionPlan
 * - getPlatformConfig(key): reads a config value from platform_config table
 * - setPlatformConfig(key, value): writes a config value to platform_config table
 * - getPublicPlans(): returns plans where isPublic = true (for mobile app plan selection)
 * - getBusinessSubscriptionInfo(id): returns plan + usage + trial info for mobile app
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  businessOwners,
  subscriptionPlans,
  platformConfig,
  clients,
  services,
  products,
  staffMembers,
  locations,
  type SubscriptionPlan,
  type BusinessOwner,
} from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanLimits = {
  maxClients: number;
  maxAppointments: number;
  maxLocations: number;
  maxStaff: number;
  maxServices: number;
  maxProducts: number;
  smsLevel: "none" | "confirmations" | "full";
  paymentLevel: "basic" | "full";
  planKey: string;
  displayName: string;
  monthlyPrice: number;
  yearlyPrice: number;
  isAdminOverride: boolean;
};

export type LimitResource =
  | "clients"
  | "appointments"
  | "locations"
  | "staff"
  | "services"
  | "products";

// ─── Plan Cache (in-memory, refreshed every 5 minutes) ───────────────────────

let planCache: SubscriptionPlan[] | null = null;
let planCacheTime = 0;
const PLAN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getPlans(): Promise<SubscriptionPlan[]> {
  const now = Date.now();
  if (planCache && now - planCacheTime < PLAN_CACHE_TTL) {
    return planCache;
  }
  const db = await getDb();
  if (!db) return [];
  try {
    const plans = await db.select().from(subscriptionPlans);
    planCache = plans;
    planCacheTime = now;
    return plans;
  } catch {
    return planCache ?? [];
  }
}

/** Invalidate the plan cache (call after admin updates plans) */
export function invalidatePlanCache() {
  planCache = null;
  planCacheTime = 0;
}

/**
 * Returns plans visible to the public (isPublic = true), sorted by sortOrder.
 * Used by the mobile app plan selection screen.
 */
export async function getPublicPlans(): Promise<SubscriptionPlan[]> {
  const plans = await getPlans();
  return plans.filter((p) => p.isPublic).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Returns all plans sorted by sortOrder (for admin use).
 */
export async function getAllPlansForAdmin(): Promise<SubscriptionPlan[]> {
  const plans = await getPlans();
  return plans.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Returns full subscription info for a business owner:
 * - Current plan details + limits
 * - Current usage counts (clients, services, products, staff, locations)
 * - Trial status and days remaining
 * Used by the mobile app subscription screen.
 */
export async function getBusinessSubscriptionInfo(businessOwnerId: number) {
  const dbConn = await getDb();
  if (!dbConn) return null;
  try {
    const rows = await dbConn
      .select()
      .from(businessOwners)
      .where(eq(businessOwners.id, businessOwnerId))
      .limit(1);
    const business = rows[0];
    if (!business) return null;

    const limits = await getPlanLimits(businessOwnerId);
    if (!limits) return null;

    // Get discount info from the plan to compute effective prices
    const allPlans = await getPlans();
    const currentPlanData = allPlans.find((p) => p.planKey === limits.planKey);
    const discPct = currentPlanData ? (parseFloat(String(currentPlanData.discountPercent ?? 0)) || 0) : 0;
    const baseMonthly = limits.monthlyPrice;
    const baseYearly = limits.yearlyPrice;
    const effectiveMonthlyPrice = discPct > 0 ? parseFloat((baseMonthly * (1 - discPct / 100)).toFixed(2)) : baseMonthly;
    const effectiveYearlyPrice = discPct > 0 ? parseFloat((baseYearly * (1 - discPct / 100)).toFixed(2)) : baseYearly;

    // Count current usage in parallel
    const [clientRows, serviceRows, productRows, staffRows, locationRows] = await Promise.all([
      dbConn.select().from(clients).where(eq(clients.businessOwnerId, businessOwnerId)),
      dbConn.select().from(services).where(eq(services.businessOwnerId, businessOwnerId)),
      dbConn.select().from(products).where(eq(products.businessOwnerId, businessOwnerId)),
      dbConn.select().from(staffMembers).where(eq(staffMembers.businessOwnerId, businessOwnerId)),
      dbConn.select().from(locations).where(eq(locations.businessOwnerId, businessOwnerId)),
    ]);

    // Calculate trial days remaining
    let trialDaysRemaining: number | null = null;
    if (business.subscriptionStatus === "trial" && business.trialEndsAt) {
      const msRemaining = new Date(business.trialEndsAt).getTime() - Date.now();
      trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    }

    // Grace period: are we still within the paid period?
    const nowSec = Math.floor(Date.now() / 1000);
    const periodEnd = business.stripeCurrentPeriodEnd ?? null;
    const isInGracePeriod = !!(
      periodEnd &&
      periodEnd > nowSec &&
      business.subscriptionStatus === "active" &&
      business.subscriptionPlan !== "solo" &&
      ((business as any).cancelAtPeriodEnd || (business as any).scheduledPlanKey)
    );
    // Days remaining in grace period
    const gracePeriodDaysRemaining = isInGracePeriod && periodEnd
      ? Math.max(0, Math.ceil((periodEnd - nowSec) / 86400))
      : null;

    return {
      planKey: limits.planKey,
      displayName: limits.displayName,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionPeriod: business.subscriptionPeriod,
      trialEndsAt: business.trialEndsAt ? business.trialEndsAt.toISOString() : null,
      trialDaysRemaining,
      isAdminOverride: limits.isAdminOverride,
      monthlyPrice: limits.monthlyPrice,
      yearlyPrice: limits.yearlyPrice,
      effectiveMonthlyPrice,
      effectiveYearlyPrice,
      stripeCurrentPeriodEnd: business.stripeCurrentPeriodEnd ?? null,
      stripeCustomerId: business.stripeCustomerId ?? null,
      hasUsedTrial: (business as any).hasUsedTrial ?? false,
      // Grace period / scheduled downgrade info
      cancelAtPeriodEnd: (business as any).cancelAtPeriodEnd ?? false,
      scheduledPlanKey: (business as any).scheduledPlanKey ?? null,
      scheduledPlanPeriod: (business as any).scheduledPlanPeriod ?? null,
      isInGracePeriod,
      gracePeriodDaysRemaining,
      limits: {
        maxClients: limits.maxClients,
        maxServices: limits.maxServices,
        maxProducts: limits.maxProducts,
        maxStaff: limits.maxStaff,
        maxLocations: limits.maxLocations,
        maxAppointments: limits.maxAppointments,
        smsLevel: limits.smsLevel,
        paymentLevel: limits.paymentLevel,
      },
      usage: {
        clients: clientRows.length,
        services: serviceRows.length,
        products: productRows.length,
        staff: staffRows.length,
        locations: locationRows.length,
      },
    };
  } catch {
    return null;
  }
}

// ─── Config Cache ─────────────────────────────────────────────────────────────

const configCache = new Map<string, { value: string | null; time: number }>();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (config rarely changes; admin saves call invalidateConfigCache)

export async function getPlatformConfig(key: string): Promise<string | null> {
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.time < CONFIG_CACHE_TTL) {
    return cached.value;
  }
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.configKey, key))
      .limit(1);
    const value = rows[0]?.configValue ?? null;
    configCache.set(key, { value, time: Date.now() });
    return value;
  } catch {
    return null;
  }
}

/**
 * Fetch multiple platform config keys in a single DB query.
 * Returns a Record<key, value|null> and populates the cache for each key.
 */
export async function getBatchPlatformConfig(keys: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const uncached: string[] = [];
  const now = Date.now();

  // Serve from cache where possible
  for (const key of keys) {
    const cached = configCache.get(key);
    if (cached && now - cached.time < CONFIG_CACHE_TTL) {
      result[key] = cached.value;
    } else {
      uncached.push(key);
    }
  }

  if (uncached.length > 0) {
    const db = await getDb();
    if (db) {
      try {
        const rows = await db
          .select()
          .from(platformConfig)
          .where(inArray(platformConfig.configKey, uncached));
        // Populate result and cache for found keys
        for (const row of rows) {
          result[row.configKey] = row.configValue ?? null;
          configCache.set(row.configKey, { value: row.configValue ?? null, time: now });
        }
        // Keys not found in DB → null
        for (const key of uncached) {
          if (!(key in result)) {
            result[key] = null;
            configCache.set(key, { value: null, time: now });
          }
        }
      } catch {
        for (const key of uncached) result[key] = null;
      }
    } else {
      for (const key of uncached) result[key] = null;
    }
  }

  return result;
}

export async function setPlatformConfig(
  key: string,
  value: string | null
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(platformConfig)
    .set({ configValue: value })
    .where(eq(platformConfig.configKey, key));
  // Invalidate cache for this key
  configCache.delete(key);
}

/** Invalidate the config cache (call after admin updates platform config) */
export function invalidateConfigCache(key?: string) {
  if (key) {
    configCache.delete(key);
  } else {
    configCache.clear();
  }
}

export async function getAllPlatformConfig(): Promise<
  Array<{ configKey: string; configValue: string | null; isSensitive: boolean; description: string | null }>
> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(platformConfig);
  } catch {
    return [];
  }
}

/**
 * Determines the effective plan key for a business, respecting grace periods.
 *
 * Grace period logic (mirrors how Stripe/high-tech SaaS works):
 * - If the business has an active Stripe subscription with stripeCurrentPeriodEnd in the future,
 *   they keep their CURRENT paid plan limits until that date — even if cancelAtPeriodEnd=true
 *   or a scheduledPlanKey downgrade is pending.
 * - Once stripeCurrentPeriodEnd passes (or the subscription is deleted), the scheduledPlanKey
 *   (or "solo" if none) takes effect.
 * - This means: cancel on the 15th → keep paid features until the 30th (period end).
 */
function resolveEffectivePlanKey(business: {
  subscriptionPlan: string;
  subscriptionStatus: string;
  stripeCurrentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean | null;
  scheduledPlanKey: string | null;
  adminOverride: boolean;
}): string {
  // Admin override always wins
  if (business.adminOverride) return "enterprise";

  const nowSec = Math.floor(Date.now() / 1000);
  const periodEnd = business.stripeCurrentPeriodEnd;

  // If we are still within the paid billing period, keep the current plan
  // regardless of any scheduled downgrade or cancellation
  if (
    periodEnd &&
    periodEnd > nowSec &&
    business.subscriptionStatus === "active" &&
    business.subscriptionPlan !== "solo"
  ) {
    return business.subscriptionPlan;
  }

  // Period has ended (or no active subscription) — apply scheduled plan or fall to solo
  if (business.scheduledPlanKey) {
    return business.scheduledPlanKey;
  }

  return business.subscriptionPlan;
}

// ─── Plan Limit Helpers ───────────────────────────────────────────────────────

/**
 * Returns the effective plan limits for a business.
 * If adminOverride is true, returns unlimited limits regardless of plan.
 */
export async function getPlanLimits(
  businessOwnerId: number
): Promise<PlanLimits | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(businessOwners)
      .where(eq(businessOwners.id, businessOwnerId))
      .limit(1);

    const business = rows[0];
    if (!business) return null;

    // Admin override → full unlimited access
    if (business.adminOverride) {
      return {
        maxClients: -1,
        maxAppointments: -1,
        maxLocations: -1,
        maxStaff: -1,
        maxServices: -1,
        maxProducts: -1,
        smsLevel: "full",
        paymentLevel: "full",
        planKey: "enterprise",
        displayName: "Enterprise (Complimentary)",
        monthlyPrice: 0,
        yearlyPrice: 0,
        isAdminOverride: true,
      };
    }

    const plans = await getPlans();
    // Use grace-period-aware effective plan key
    const effectivePlanKey = resolveEffectivePlanKey({
      subscriptionPlan: business.subscriptionPlan,
      subscriptionStatus: business.subscriptionStatus,
      stripeCurrentPeriodEnd: business.stripeCurrentPeriodEnd ?? null,
      cancelAtPeriodEnd: (business as any).cancelAtPeriodEnd ?? false,
      scheduledPlanKey: (business as any).scheduledPlanKey ?? null,
      adminOverride: business.adminOverride,
    });
    const plan = plans.find((p) => p.planKey === effectivePlanKey);

    if (!plan) {
      // Fallback to solo limits if plan not found
      return {
        maxClients: 20,
        maxAppointments: 50,
        maxLocations: 1,
        maxStaff: 1,
        maxServices: 5,
        maxProducts: 5,
        smsLevel: "none",
        paymentLevel: "basic",
        planKey: "solo",
        displayName: "Solo",
        monthlyPrice: 0,
        yearlyPrice: 0,
        isAdminOverride: false,
      };
    }

    return {
      maxClients: plan.maxClients,
      maxAppointments: plan.maxAppointments,
      maxLocations: plan.maxLocations,
      maxStaff: plan.maxStaff,
      maxServices: plan.maxServices,
      maxProducts: plan.maxProducts,
      smsLevel: plan.smsLevel,
      paymentLevel: plan.paymentLevel,
      planKey: plan.planKey,
      displayName: plan.displayName,
      monthlyPrice: parseFloat(plan.monthlyPrice as unknown as string),
      yearlyPrice: parseFloat(plan.yearlyPrice as unknown as string),
      isAdminOverride: false,
    };
  } catch {
    return null;
  }
}

/**
 * Checks if a business can create a new resource.
 * Returns { allowed: true } or { allowed: false, message, upgradeRequired: true }
 */
export async function checkPlanLimit(
  businessOwnerId: number,
  resource: LimitResource,
  currentCount: number
): Promise<{ allowed: boolean; message?: string; upgradeRequired?: boolean }> {
  const limits = await getPlanLimits(businessOwnerId);
  if (!limits) return { allowed: true }; // Fail open if DB unavailable

  const limitMap: Record<LimitResource, number> = {
    clients: limits.maxClients,
    appointments: limits.maxAppointments,
    locations: limits.maxLocations,
    staff: limits.maxStaff,
    services: limits.maxServices,
    products: limits.maxProducts,
  };

  const limit = limitMap[resource];
  if (limit === -1) return { allowed: true }; // Unlimited

  if (currentCount >= limit) {
    const resourceLabel =
      resource === "staff" ? "staff members" : resource;
    return {
      allowed: false,
      message: `Your ${limits.displayName} plan allows up to ${limit} ${resourceLabel}. Please upgrade to add more.`,
      upgradeRequired: true,
    };
  }

  return { allowed: true };
}

/**
 * Returns the effective plan key for a business (respects adminOverride).
 */
export function getEffectivePlan(business: { adminOverride: boolean; subscriptionPlan: string }): string {
  return business.adminOverride ? "enterprise" : business.subscriptionPlan;
}

/**
 * Returns whether SMS is allowed for a given SMS action.
 * smsAction: 'confirmation' | 'reminder' | 'rebooking' | 'birthday'
 */
export async function isSmsAllowed(
  businessOwnerId: number,
  smsAction: "confirmation" | "reminder" | "rebooking" | "birthday"
): Promise<boolean> {
  const limits = await getPlanLimits(businessOwnerId);
  if (!limits) return false;

  if (limits.smsLevel === "full") return true;
  if (limits.smsLevel === "confirmations" && smsAction === "confirmation") return true;
  return false;
}
