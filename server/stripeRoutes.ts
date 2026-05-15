/**
 * Stripe subscription routes
 * - POST /api/stripe/create-checkout  → create a Stripe Checkout session
 * - POST /api/stripe/webhook          → handle Stripe webhook events
 * - GET  /api/stripe/success          → success redirect page
 * - GET  /api/stripe/cancel           → cancel redirect page
 */
import express, { Express, Request, Response } from "express";
import Stripe from "stripe";
import { getDb } from "./db";
import { businessOwners } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendSubscriptionConfirmationEmail } from "./email";
import { getPlatformConfig, getPublicPlans } from "./subscription";
// Keys are read from DB (Admin Panel) at request time
// When STRIPE_TEST_MODE=true, test keys are used exclusively
async function getStripeSecretKey(): Promise<string> {
  const testMode = await getPlatformConfig("STRIPE_TEST_MODE").catch(() => "");
  if (testMode === "true") {
    const testKey = await getPlatformConfig("STRIPE_TEST_SECRET_KEY").catch(() => "");
    return testKey || process.env.STRIPE_TEST_SECRET_KEY || "";
  }
  // Try generic key first, then fall back to LIVE-prefixed key
  const dbKey = await getPlatformConfig("STRIPE_SECRET_KEY").catch(() => "");
  if (dbKey) return dbKey;
  const liveKey = await getPlatformConfig("STRIPE_LIVE_SECRET_KEY").catch(() => "");
  return liveKey || process.env.STRIPE_SECRET_KEY || "";
}
async function getStripeWebhookSecret(): Promise<string> {
  const testMode = await getPlatformConfig("STRIPE_TEST_MODE").catch(() => "");
  if (testMode === "true") {
    const testSecret = await getPlatformConfig("STRIPE_TEST_WEBHOOK_SECRET").catch(() => "");
    return testSecret || process.env.STRIPE_TEST_WEBHOOK_SECRET || "";
  }
  // Try generic key first, then fall back to LIVE-prefixed key
  const dbSecret = await getPlatformConfig("STRIPE_WEBHOOK_SECRET").catch(() => "");
  if (dbSecret) return dbSecret;
  const liveSecret = await getPlatformConfig("STRIPE_LIVE_WEBHOOK_SECRET").catch(() => "");
  return liveSecret || process.env.STRIPE_WEBHOOK_SECRET || "";
}
async function getStripePublishableKey(): Promise<string> {
  const testMode = await getPlatformConfig("STRIPE_TEST_MODE").catch(() => "");
  if (testMode === "true") {
    const testKey = await getPlatformConfig("STRIPE_TEST_PUBLISHABLE_KEY").catch(() => "");
    return testKey || process.env.STRIPE_TEST_PUBLISHABLE_KEY || "";
  }
  // Try generic key first, then fall back to LIVE-prefixed key
  const dbKey = await getPlatformConfig("STRIPE_PUBLISHABLE_KEY").catch(() => "");
  if (dbKey) return dbKey;
  const liveKey = await getPlatformConfig("STRIPE_LIVE_PUBLISHABLE_KEY").catch(() => "");
  return liveKey || process.env.STRIPE_PUBLISHABLE_KEY || "";
}

// Fallback prices in cents (used only if DB is unavailable)
const FALLBACK_PRICES: Record<string, { monthly: number; yearly: number; name: string }> = {
  solo:       { monthly: 0,     yearly: 0,     name: "Solo (Free)" },
  growth:     { monthly: 1900,  yearly: 19000, name: "Growth" },
  studio:     { monthly: 3900,  yearly: 39000, name: "Studio" },
  enterprise: { monthly: 6900,  yearly: 69000, name: "Enterprise" },
};

/** Read plan price from DB (Admin Panel), falling back to hardcoded values.
 * Returns FULL prices (before discount) + discount info.
 * Discount is applied via Stripe coupon:
 *   discountMonths > 0  → coupon with duration: "repeating" (introductory, N months then full price)
 *   discountMonths === 0 → coupon with duration: "forever" (permanent discount)
 */
async function getPlanPrice(planKey: string): Promise<{
  monthly: number; yearly: number; name: string;
  discountPercent: number; discountLabel: string | null; discountMonths: number;
} | null> {
  try {
    const plans = await getPublicPlans();
    const plan = plans.find((p) => p.planKey === planKey);
    if (plan) {
      const monthly = parseFloat(plan.monthlyPrice as unknown as string);
      const yearly = parseFloat(plan.yearlyPrice as unknown as string);
      // Auto-expire discount if discountExpiresAt has passed
      const expiresAt = (plan as any).discountExpiresAt;
      const isExpired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
      const discPct = isExpired ? 0 : ((plan as any).discountPercent ?? 0);
      const discLabel = isExpired ? null : ((plan as any).discountLabel ?? null);
      const discMonths = isExpired ? 0 : ((plan as any).discountMonths ?? 0);
      // Return FULL prices — discount applied via Stripe coupon, not baked into price
      return {
        monthly: Math.round(monthly * 100),  // cents (full price)
        yearly: Math.round(yearly * 100),    // cents (full price)
        name: plan.displayName,
        discountPercent: discPct,
        discountLabel: discLabel,
        discountMonths: discMonths,
      };
    }
  } catch (e) {
    console.warn("[Stripe] Could not read plan price from DB, using fallback", e);
  }
  const fb = FALLBACK_PRICES[planKey];
  return fb ? { ...fb, discountPercent: 0, discountLabel: null, discountMonths: 0 } : null;
}

async function getStripeAsync(): Promise<Stripe | null> {
  const key = await getStripeSecretKey();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2024-06-20" as any });
}

export function registerStripeRoutes(app: Express): void {
  /**
   * POST /api/stripe/create-checkout
   * Body: { businessOwnerId, planKey, period: "monthly"|"yearly", successUrl, cancelUrl }
   */
  app.post("/api/stripe/create-checkout", async (req: Request, res: Response) => {
    const stripe = await getStripeAsync();
    if (!stripe) {
      res.status(500).json({ error: "Stripe not configured" });
      return;
    }

    const { businessOwnerId, planKey, period, successUrl, cancelUrl, referralCodeId } = req.body as {
      businessOwnerId: number;
      planKey: string;
      period: "monthly" | "yearly";
      successUrl: string;
      cancelUrl: string;
      referralCodeId?: number;
    };

    if (!businessOwnerId || !planKey || !period) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const planInfo = await getPlanPrice(planKey);
    if (!planInfo) {
      res.status(400).json({ error: "Invalid plan key" });
      return;
    }

    // Solo plan is free — no checkout needed
    if (planKey === "solo") {
      const db = await getDb();
      if (db) {
        const rows = await db.select().from(businessOwners)
          .where(eq(businessOwners.id, businessOwnerId)).limit(1);
        const owner = rows[0];
        const nowSec = Math.floor(Date.now() / 1000);
        const periodEnd = owner?.stripeCurrentPeriodEnd ?? null;
        const hasActivePaidSub = owner?.stripeSubscriptionId &&
          owner?.subscriptionStatus === "active" &&
          owner?.subscriptionPlan !== "solo" &&
          periodEnd && periodEnd > nowSec;

        if (hasActivePaidSub) {
          // Business still has paid time remaining — schedule downgrade for period end
          // Also cancel the Stripe subscription at period end (no more renewals)
          const stripe = await getStripeAsync();
          if (stripe && owner?.stripeSubscriptionId) {
            try {
              await stripe.subscriptions.update(owner.stripeSubscriptionId, {
                cancel_at_period_end: true,
                metadata: { businessOwnerId: String(businessOwnerId) },
              });
            } catch (stripeErr) {
              console.error("[Stripe] Failed to cancel subscription at period end:", stripeErr);
            }
          }
          await db.update(businessOwners)
            .set({
              scheduledPlanKey: "solo",
              scheduledPlanPeriod: "monthly",
              cancelAtPeriodEnd: true,
            } as any)
            .where(eq(businessOwners.id, businessOwnerId));
          res.json({
            url: null,
            free: false,
            activated: false,
            scheduled: true,
            scheduledAt: periodEnd,
            message: "Your subscription will downgrade to the free Solo plan at the end of your current billing period.",
          });
        } else {
          // No active paid period — downgrade immediately
          await db.update(businessOwners)
            .set({
              subscriptionPlan: "solo",
              subscriptionStatus: "free",
              subscriptionPeriod: period,
              scheduledPlanKey: null,
              scheduledPlanPeriod: null,
              cancelAtPeriodEnd: false,
            } as any)
            .where(eq(businessOwners.id, businessOwnerId));
          res.json({ url: null, free: true, activated: true });
        }
      } else {
        res.json({ url: null, free: true, activated: true });
      }
      return;
    }

    const priceAmount = period === "monthly" ? planInfo.monthly : planInfo.yearly;
    const interval = period === "monthly" ? "month" : "year";

    try {
      // Get or create Stripe customer
      const db = await getDb();
      let stripeCustomerId: string | undefined;

      let isTrialEligible = false;
      if (db) {
        const rows = await db.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
        const owner = rows[0];
        // Determine if this owner is eligible for a 14-day trial
        // Eligible: paid plan (not solo), has NOT used trial before
        isTrialEligible = planKey !== "solo" && !(owner as any)?.hasUsedTrial;
        if (owner?.stripeCustomerId) {
          stripeCustomerId = owner.stripeCustomerId;
        } else {
          // Create new customer
          // Only pass email if it's a valid non-empty string (Stripe rejects empty/null emails)
          const custEmail = owner?.email && owner.email.trim() && owner.email.includes('@') ? owner.email.trim() : undefined;
          const customer = await stripe.customers.create({
            metadata: { businessOwnerId: String(businessOwnerId) },
            ...(custEmail ? { email: custEmail } : {}),
          });
          stripeCustomerId = customer.id;
          await db.update(businessOwners)
            .set({ stripeCustomerId: customer.id })
            .where(eq(businessOwners.id, businessOwnerId));
        }
      }

      // Create a price on the fly with the FULL (pre-discount) amount
      const productName = `${planInfo.name} Plan (${period})`;
      const price = await stripe.prices.create({
        unit_amount: priceAmount,  // full price in cents
        currency: "usd",
        recurring: { interval },
        product_data: { name: productName },
      });

      // Build Stripe coupon if a plan discount is configured
      let stripeCouponId: string | undefined;
      if (planInfo.discountPercent > 0) {
        const couponName = planInfo.discountLabel ?? `${planInfo.discountPercent}% off`;
        const couponParams: Stripe.CouponCreateParams = {
          percent_off: planInfo.discountPercent,
          name: couponName,
          duration: planInfo.discountMonths > 0 ? "repeating" : "forever",
          ...(planInfo.discountMonths > 0 ? { duration_in_months: planInfo.discountMonths } : {}),
        };
        const coupon = await stripe.coupons.create(couponParams);
        stripeCouponId = coupon.id;
      }

      // If a referral code was applied, override with a 50%-off-3-months coupon
      // (referral discount takes priority over plan discount)
      let resolvedReferralCodeId: number | undefined;
      if (referralCodeId && planKey !== "solo") {
        try {
          const { getReferralCodeByOwner: _unused, ...dbHelpers } = await import("./db");
          const rcRows = db ? await (db as any).select().from((await import('../drizzle/schema')).referralCodes).where((await import('drizzle-orm')).eq((await import('../drizzle/schema')).referralCodes.id, referralCodeId)).limit(1) : [];
          const rc = rcRows[0];
          if (rc && rc.isActive) {
            // Re-use cached Stripe coupon if already created for this code
            let refCouponId = rc.stripeCouponId as string | undefined;
            if (!refCouponId) {
              const refCoupon = await stripe.coupons.create({
                percent_off: rc.discountPercent ?? 50,
                name: `Referral: ${rc.code} — ${rc.discountPercent ?? 50}% off first ${rc.discountMonths ?? 3} months`,
                duration: "repeating",
                duration_in_months: rc.discountMonths ?? 3,
              });
              refCouponId = refCoupon.id;
              // Cache it on the referral code record
              const { setReferralCodeCoupon } = await import("./db");
              await setReferralCodeCoupon(rc.id, refCouponId);
            }
            stripeCouponId = refCouponId; // override plan discount
            resolvedReferralCodeId = rc.id;
          }
        } catch (refErr) {
          console.error("[Stripe] Referral coupon lookup error:", refErr);
        }
      }

      // Build custom_text.submit message to confirm discount on checkout page
      let customSubmitText: string | undefined;
      if (resolvedReferralCodeId) {
        // Referral discount applied
        const refRc = resolvedReferralCodeId ? await (async () => {
          try {
            const rcRows2 = await (await getDb())!.select().from((await import('../drizzle/schema')).referralCodes).where((await import('drizzle-orm')).eq((await import('../drizzle/schema')).referralCodes.id, resolvedReferralCodeId)).limit(1);
            return rcRows2[0];
          } catch { return null; }
        })() : null;
        const pct = (refRc as any)?.discountPercent ?? 50;
        const months = (refRc as any)?.discountMonths ?? 3;
        customSubmitText = `🎉 Referral discount applied: ${pct}% off your first ${months} months. After that, your plan renews at the standard rate.`;
      } else if (stripeCouponId && planInfo?.discountPercent > 0) {
        customSubmitText = `${planInfo.discountPercent}% introductory discount applied for your first ${planInfo.discountMonths} month${planInfo.discountMonths !== 1 ? 's' : ''}.`;
      } else if (isTrialEligible) {
        customSubmitText = "Your 14-day free trial starts today. You won't be charged until the trial ends.";
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: price.id, quantity: 1 }],
        ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
        ...(customSubmitText ? { custom_text: { submit: { message: customSubmitText } } } : {}),
        success_url: successUrl || (() => {
          const origin = req.headers.origin || (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers.host}` : `https://${req.headers.host}`) || 'https://lime-of-time.com';
          const base = origin.startsWith('http') ? origin : `https://${origin}`;
          return `${base}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}&boid=${businessOwnerId}`;
        })(),
        cancel_url: cancelUrl || (() => {
          const origin = req.headers.origin || (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers.host}` : `https://${req.headers.host}`) || 'https://lime-of-time.com';
          const base = origin.startsWith('http') ? origin : `https://${origin}`;
          return `${base}/api/stripe/cancel?boid=${businessOwnerId}`;
        })(),
        metadata: {
          businessOwnerId: String(businessOwnerId),
          planKey,
          period,
          ...(resolvedReferralCodeId ? { referralCodeId: String(resolvedReferralCodeId) } : {}),
        },
        subscription_data: {
          metadata: {
            businessOwnerId: String(businessOwnerId),
            planKey,
            period,
            ...(resolvedReferralCodeId ? { referralCodeId: String(resolvedReferralCodeId) } : {}),
          },
          // 14-day free trial for first-time paid subscribers
          ...(isTrialEligible ? { trial_period_days: 14 } : {}),
        },
      });

      res.json({ url: session.url, sessionId: session.id, trialEligible: isTrialEligible });
    } catch (err) {
      console.error("[Stripe] create-checkout error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Failed to create checkout session", detail: errMsg });
    }
  });

  /**
   * POST /api/stripe/webhook
   * Handles Stripe webhook events to activate subscriptions
   */
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
    const stripe = await getStripeAsync();
    if (!stripe) {
      res.status(500).send("Stripe not configured");
      return;
    }

    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    const webhookSecret = await getStripeWebhookSecret();
    try {
      if (webhookSecret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        // In test mode without webhook secret, parse directly
        event = JSON.parse(req.body.toString()) as Stripe.Event;
      }
    } catch (err) {
      console.error("[Stripe] Webhook signature verification failed:", err);
      res.status(400).send("Webhook signature verification failed");
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(500).send("DB not available");
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const businessOwnerId = parseInt(session.metadata?.businessOwnerId ?? "0");
          const planKey = session.metadata?.planKey as "solo" | "growth" | "studio" | "enterprise";
          const period = session.metadata?.period as "monthly" | "yearly";
          const subscriptionId = session.subscription as string;

          if (businessOwnerId && planKey) {
            // Fetch subscription to get current period end
            let periodEnd: number | null = null;
            if (subscriptionId) {
              try {
                const sub = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription;
                // Use billing_cycle_anchor as the next renewal reference
                periodEnd = (sub as Stripe.Subscription).billing_cycle_anchor ?? null;
              } catch {}
            }
            // Fetch the actual current_period_end from Stripe subscription
            let actualPeriodEnd: number | null = periodEnd;
            if (subscriptionId && stripe) {
              try {
                const sub = await stripe.subscriptions.retrieve(subscriptionId) as any;
                actualPeriodEnd = sub.current_period_end ?? sub.billing_cycle_anchor ?? periodEnd;
              } catch {}
            }
            // Check if the subscription is in trial
            let isTrial = false;
            if (subscriptionId) {
              try {
                const subCheck = await stripe.subscriptions.retrieve(subscriptionId) as any;
                isTrial = subCheck.status === "trialing";
              } catch {}
            }
            await db.update(businessOwners)
              .set({
                subscriptionPlan: planKey,
                subscriptionStatus: isTrial ? "trial" : "active",
                trialEndsAt: isTrial ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
                hasUsedTrial: true,
                subscriptionPeriod: period ?? "monthly",
                stripeSubscriptionId: subscriptionId ?? null,
                stripeCurrentPeriodEnd: actualPeriodEnd,
                // Clear any scheduled downgrade/cancellation — user just subscribed/upgraded
                scheduledPlanKey: null,
                scheduledPlanPeriod: null,
                cancelAtPeriodEnd: false,
              } as any)
              .where(eq(businessOwners.id, businessOwnerId));
            console.log(`[Stripe] Activated ${planKey} plan for business ${businessOwnerId}`);

            // Send subscription confirmation email to business owner
            const ownerRows = await db.select().from(businessOwners)
              .where(eq(businessOwners.id, businessOwnerId)).limit(1);
            const owner = ownerRows[0];
            if (owner?.email) {
              // Use DB prices (already discounted) for the email
              const dbPriceInfo = await getPlanPrice(planKey).catch(() => null);
              const planName = dbPriceInfo?.name ?? FALLBACK_PRICES[planKey]?.name ?? planKey;
              const billingPeriod = (period ?? "monthly") === "yearly" ? "yearly" : "monthly";
              const amount = billingPeriod === "yearly"
                ? (dbPriceInfo?.yearly ?? FALLBACK_PRICES[planKey]?.yearly ?? 0) / 100
                : (dbPriceInfo?.monthly ?? FALLBACK_PRICES[planKey]?.monthly ?? 0) / 100;
              // Calculate next renewal date
              const nextRenewal = new Date();
              if (billingPeriod === "yearly") {
                nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
              } else {
                nextRenewal.setMonth(nextRenewal.getMonth() + 1);
              }
              sendSubscriptionConfirmationEmail(
                owner.email,
                owner.businessName,
                {
                  planName,
                  planKey,
                  billingPeriod,
                  amount,
                  nextRenewalDate: nextRenewal.toLocaleDateString("en-US", {
                    year: "numeric", month: "long", day: "numeric"
                  }),
                  ownerName: owner.ownerName ?? owner.businessName,
                }
              ).catch((e) => console.error("[Email] Subscription confirmation failed:", e));
            }
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const businessOwnerId = parseInt(subscription.metadata?.businessOwnerId ?? "0");
          if (businessOwnerId) {
            // Subscription fully ended — apply the downgrade now
            // (grace period was already active; now the period has ended)
            await db.update(businessOwners)
              .set({
                subscriptionPlan: "solo",
                subscriptionStatus: "free",
                stripeSubscriptionId: null,
                scheduledPlanKey: null,
                scheduledPlanPeriod: null,
                cancelAtPeriodEnd: false,
              } as any)
              .where(eq(businessOwners.id, businessOwnerId));
            console.log(`[Stripe] Subscription fully ended for business ${businessOwnerId} — downgraded to solo`);
          }
          break;
        }
        case "customer.subscription.updated": {
          // Fired when subscription changes: cancel_at_period_end set, plan changed, period renewed, trial→active, etc.
          const subscription = event.data.object as Stripe.Subscription & {
            cancel_at_period_end: boolean;
            current_period_end: number;
            metadata: Record<string, string>;
            status: string;
            trial_end: number | null;
          };
          const businessOwnerId = parseInt(subscription.metadata?.businessOwnerId ?? "0");
          if (businessOwnerId) {
            const cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false;
            const currentPeriodEnd = subscription.current_period_end ?? null;
            const isNowActive = subscription.status === "active";
            const hadTrial = !!subscription.trial_end;
            await db.update(businessOwners)
              .set({
                stripeCurrentPeriodEnd: currentPeriodEnd,
                cancelAtPeriodEnd: cancelAtPeriodEnd,
                // If cancellation is reversed (user re-enabled auto-renew), clear scheduled downgrade
                ...(cancelAtPeriodEnd === false ? { scheduledPlanKey: null, scheduledPlanPeriod: null } : {}),
                // If trial just converted to active, update status and clear trialEndsAt
                ...(isNowActive && hadTrial ? { subscriptionStatus: "active", trialEndsAt: null } : {}),
              } as any)
              .where(eq(businessOwners.id, businessOwnerId));
            console.log(`[Stripe] Subscription updated for business ${businessOwnerId}: status=${subscription.status}, cancelAtPeriodEnd=${cancelAtPeriodEnd}, periodEnd=${currentPeriodEnd}`);
          }
          break;
        }
        case "invoice.paid": {
          // Fired on successful renewal — update period end and clear grace period flags
          const invoice = event.data.object as any;
          const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
          if (subId) {
            // Get the subscription to find the new period end
            try {
              const sub = await stripe.subscriptions.retrieve(subId) as any;
              const newPeriodEnd = sub.current_period_end ?? null;
              const rows = await db.select().from(businessOwners)
                .where(eq(businessOwners.stripeSubscriptionId, subId)).limit(1);
              if (rows[0]) {
                const referredOwnerId = rows[0].id;
                await db.update(businessOwners)
                  .set({
                    stripeCurrentPeriodEnd: newPeriodEnd,
                    subscriptionStatus: "active",
                    // Clear grace period flags on successful renewal
                    cancelAtPeriodEnd: false,
                    scheduledPlanKey: null,
                    scheduledPlanPeriod: null,
                  } as any)
                  .where(eq(businessOwners.id, referredOwnerId));
                console.log(`[Stripe] Invoice paid for business ${referredOwnerId} — period renewed until ${newPeriodEnd}`);

                // ── Referral conversion: check if this is the first paid invoice ──
                // invoice.billing_reason === 'subscription_create' means first invoice after trial
                const isFirstPaidInvoice = invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle";
                if (isFirstPaidInvoice) {
                  try {
                    const { getReferralByReferredOwner, updateReferralStatus, incrementReferralCodeUses } = await import("./db");
                    const { sendExpoPush } = await import("./push");
                    const referral = await getReferralByReferredOwner(referredOwnerId);
                    if (referral && referral.status === "pending") {
                      // Mark referral as converted
                      await updateReferralStatus(referral.id, {
                        status: "converted",
                        convertedAt: new Date(),
                        appliedCouponId: sub.discount?.coupon?.id ?? null,
                      });
                      await incrementReferralCodeUses(referral.referralCodeId);
                      console.log(`[Referral] Referral ${referral.id} converted — referred business ${referredOwnerId}`);

                      // ── Notify the referrer ──
                      const referrerRows = await db.select().from(businessOwners)
                        .where(eq(businessOwners.id, referral.referrerBusinessOwnerId)).limit(1);
                      const referrer = referrerRows[0] as any;
                      const referredRows2 = await db.select().from(businessOwners)
                        .where(eq(businessOwners.id, referredOwnerId)).limit(1);
                      const bizName = referredRows2[0]?.businessName ?? "Your referral";
                      if (referrer?.expoPushToken) {
                        await sendExpoPush(referrer.expoPushToken, {
                          title: "\uD83C\uDF89 Referral Converted!",
                          body: `${bizName} just signed up! You'll earn a free month once they complete their first payment.`,
                          data: { type: "general" as const, screen: "referrals" },
                        });
                        console.log(`[Referral] Push notification sent to referrer ${referral.referrerBusinessOwnerId}`);
                      }

                      // ── Apply referrer reward: 1 free month via Stripe customer balance credit ──
                      try {
                        if (referrer?.stripeCustomerId) {
                          // Look up the referrer's current plan price to credit the right amount
                          const referrerPlanKey = referrer.subscriptionPlan ?? "growth";
                          const referrerPeriod = (referrer as any).subscriptionPeriod ?? "monthly";
                          const referrerPlanInfo = await getPlanPrice(referrerPlanKey).catch(() => null);
                          const creditAmountCents = referrerPeriod === "yearly"
                            ? (referrerPlanInfo?.yearly ?? FALLBACK_PRICES[referrerPlanKey]?.yearly ?? 1900)
                            : (referrerPlanInfo?.monthly ?? FALLBACK_PRICES[referrerPlanKey]?.monthly ?? 1900);
                          // Apply as a negative customer balance — automatically deducted on next invoice
                          const balanceTx = await stripe.customers.createBalanceTransaction(
                            referrer.stripeCustomerId,
                            {
                              amount: -creditAmountCents,
                              currency: "usd",
                              description: `Referral reward: 1 free month for referring ${bizName}`,
                            }
                          );
                          await updateReferralStatus(referral.id, {
                            status: "rewarded",
                            rewardedAt: new Date(),
                            referrerRewardId: balanceTx.id,
                          });
                          console.log(`[Referral] Referrer ${referral.referrerBusinessOwnerId} credited $${(creditAmountCents / 100).toFixed(2)} via balance tx ${balanceTx.id}`);
                        } else {
                          // No Stripe customer yet — mark rewarded without credit (manual follow-up)
                          await updateReferralStatus(referral.id, {
                            status: "rewarded",
                            rewardedAt: new Date(),
                          });
                        }
                      } catch (rewardErr) {
                        console.error("[Referral] Reward application error:", rewardErr);
                        // Don't fail the webhook — reward can be applied manually from admin
                      }
                    }
                  } catch (refErr) {
                    console.error("[Referral] Conversion tracking error:", refErr);
                  }
                }
              }
            } catch (err) {
              console.error("[Stripe] invoice.paid handler error:", err);
            }
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice & { subscription?: string | null };
          const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
          if (subId) {
            const rows = await db.select().from(businessOwners)
              .where(eq(businessOwners.stripeSubscriptionId, subId)).limit(1);
            if (rows[0]) {
              // After 3 Stripe retries, auto-downgrade to Solo free plan
              const invoiceObj = event.data.object as any;
              const attemptCount = invoiceObj.attempt_count ?? 0;
              if (attemptCount >= 3) {
                // Final failure — downgrade to Solo
                await db.update(businessOwners)
                  .set({
                    subscriptionPlan: "solo",
                    subscriptionStatus: "free",
                    stripeSubscriptionId: null,
                    scheduledPlanKey: null,
                    scheduledPlanPeriod: null,
                    cancelAtPeriodEnd: false,
                    trialEndsAt: null,
                  } as any)
                  .where(eq(businessOwners.id, rows[0].id));
                console.log(`[Stripe] Payment failed 3x for business ${rows[0].id} — auto-downgraded to Solo`);
              } else {
                await db.update(businessOwners)
                  .set({ subscriptionStatus: "expired" })
                  .where(eq(businessOwners.id, rows[0].id));
              }
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error("[Stripe] Webhook handler error:", err);
    }

    res.json({ received: true });
  });

  /**
   * GET /api/stripe/success
   * Called after successful Stripe Checkout — shows a success page
   */
  app.get("/api/stripe/success", async (req: Request, res: Response) => {
    const { session_id, boid } = req.query as { session_id?: string; boid?: string };
    const stripe = await getStripeAsync();

    // Try to activate subscription from session if webhook hasn't fired yet
    if (stripe && session_id && boid) {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        const businessOwnerId = parseInt(boid);
        const planKey = session.metadata?.planKey as "solo" | "growth" | "studio" | "enterprise";
        const period = session.metadata?.period as "monthly" | "yearly";
        const subscriptionId = session.subscription as string;

        if (planKey && businessOwnerId) {
          const db = await getDb();
          if (db) {
            // Only update if not already active (avoid duplicate email from webhook)
            const existingRows = await db.select().from(businessOwners)
              .where(eq(businessOwners.id, businessOwnerId)).limit(1);
            const existing = existingRows[0];
            const alreadyActive = existing?.subscriptionPlan === planKey && existing?.subscriptionStatus === "active";
            if (!alreadyActive) {
              // Fetch subscription to get current period end
              let periodEndSuccess: number | null = null;
              if (subscriptionId) {
                try {
                  const sub = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription;
                  // Use billing_cycle_anchor as the next renewal reference
                  periodEndSuccess = (sub as Stripe.Subscription).billing_cycle_anchor ?? null;
                } catch {}
              }
              await db.update(businessOwners)
                .set({
                  subscriptionPlan: planKey,
                  subscriptionStatus: "active",
                  subscriptionPeriod: period ?? "monthly",
                  stripeSubscriptionId: subscriptionId ?? null,
                  stripeCurrentPeriodEnd: periodEndSuccess,
                })
                .where(eq(businessOwners.id, businessOwnerId));
              // Send confirmation email (webhook may not have fired yet)
              if (existing?.email) {
                // Use DB prices (already discounted) for the email
                const dbPriceInfoSuccess = await getPlanPrice(planKey).catch(() => null);
                const planName = dbPriceInfoSuccess?.name ?? FALLBACK_PRICES[planKey]?.name ?? planKey;
                const billingPeriod = (period ?? "monthly") === "yearly" ? "yearly" : "monthly";
                const amount = billingPeriod === "yearly"
                  ? (dbPriceInfoSuccess?.yearly ?? FALLBACK_PRICES[planKey]?.yearly ?? 0) / 100
                  : (dbPriceInfoSuccess?.monthly ?? FALLBACK_PRICES[planKey]?.monthly ?? 0) / 100;
                const nextRenewal = new Date();
                if (billingPeriod === "yearly") {
                  nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
                } else {
                  nextRenewal.setMonth(nextRenewal.getMonth() + 1);
                }
                sendSubscriptionConfirmationEmail(
                  existing.email,
                  existing.businessName,
                  {
                    planName,
                    planKey,
                    billingPeriod,
                    amount,
                    nextRenewalDate: nextRenewal.toLocaleDateString("en-US", {
                      year: "numeric", month: "long", day: "numeric"
                    }),
                    ownerName: existing.ownerName ?? existing.businessName,
                  }
                ).catch((e) => console.error("[Email] Success page email failed:", e));
              }
            }
          }
        }
      } catch (err) {
        console.error("[Stripe] Success page activation error:", err);
      }
    }

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Subscription Activated</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #1A3A28; color: white; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; }
    .card { background: rgba(255,255,255,0.1); border-radius: 24px; padding: 48px 32px;
            text-align: center; max-width: 380px; width: 90%; backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.15); }
    .icon { font-size: 64px; margin-bottom: 24px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    p { font-size: 16px; color: rgba(255,255,255,0.75); line-height: 1.5; margin-bottom: 32px; }
    .btn { display: inline-block; background: #8FBF6A; color: #1A3A28; font-weight: 700;
           font-size: 16px; padding: 14px 32px; border-radius: 50px; text-decoration: none;
           cursor: pointer; border: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎉</div>
    <h1>You're all set!</h1>
    <p>Your subscription is now active. Return to the Lime Of Time app to start managing your business.</p>
    <p style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:24px;">You can close this window and return to the app.</p>
    <button class="btn" onclick="window.close()">Close & Return to App</button>
  </div>
  <script>
    // Auto-close after 3 seconds if possible
    setTimeout(() => { try { window.close(); } catch(e) {} }, 3000);
  </script>
</body>
</html>`);
  });

  /**
   * POST /api/stripe/create-portal
   * Body: { businessOwnerId, returnUrl }
   * Creates a Stripe Customer Portal session and returns the URL
   */
  app.post("/api/stripe/create-portal", async (req: Request, res: Response) => {
    const stripe = await getStripeAsync();
    if (!stripe) {
      res.status(500).json({ error: "Stripe not configured" });
      return;
    }
    const { businessOwnerId, returnUrl } = req.body as { businessOwnerId: number; returnUrl: string };
    if (!businessOwnerId) {
      res.status(400).json({ error: "Missing businessOwnerId" });
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "DB not available" });
        return;
      }
      const rows = await db.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
      const owner = rows[0];
      if (!owner?.stripeCustomerId) {
        res.status(400).json({ error: "No Stripe customer found. Please subscribe first." });
        return;
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: owner.stripeCustomerId,
        return_url: returnUrl || "https://lime-of-time.com",
      });
      res.json({ url: portalSession.url });
    } catch (err) {
      console.error("[Stripe] create-portal error:", err);
      res.status(500).json({ error: "Failed to create billing portal session" });
    }
  });

  /**
   * GET /api/stripe/cancel
   * Called when user cancels Stripe Checkout
   */
  app.get("/api/stripe/cancel", (_req: Request, res: Response) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Checkout Cancelled</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #1A3A28; color: white; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; }
    .card { background: rgba(255,255,255,0.1); border-radius: 24px; padding: 48px 32px;
            text-align: center; max-width: 380px; width: 90%; backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.15); }
    .icon { font-size: 64px; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
    p { font-size: 15px; color: rgba(255,255,255,0.75); line-height: 1.5; margin-bottom: 24px; }
    .btn { display: inline-block; background: rgba(255,255,255,0.15); color: white; font-weight: 600;
           font-size: 15px; padding: 12px 28px; border-radius: 50px; text-decoration: none;
           cursor: pointer; border: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">↩️</div>
    <h1>Checkout Cancelled</h1>
    <p>No charge was made. You can return to the app and choose a plan whenever you're ready.</p>
    <button class="btn" onclick="window.close()">Close Window</button>
  </div>
</body>
</html>`);
  });
  /**
   * POST /api/stripe/check-downgrade
   * Body: { businessOwnerId, targetPlanKey }
   * Returns: { allowed: boolean, blockers: string[] }
   * Checks if a business can downgrade to the target plan given current usage.
   * Blockers are returned if usage exceeds target plan limits.
   */
  app.post("/api/stripe/check-downgrade", async (req: Request, res: Response) => {
    const { businessOwnerId, targetPlanKey } = req.body as { businessOwnerId: number; targetPlanKey: string };
    if (!businessOwnerId || !targetPlanKey) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "DB not available" });
        return;
      }
      // Get target plan limits
      const { getAllPlansForAdmin, getBusinessSubscriptionInfo } = await import("./subscription");
      const plans = await getAllPlansForAdmin();
      const targetPlan = plans.find((p) => p.planKey === targetPlanKey);
      if (!targetPlan) {
        res.status(400).json({ error: "Invalid target plan key" });
        return;
      }
      // Get current usage
      const info = await getBusinessSubscriptionInfo(businessOwnerId);
      if (!info) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      const usage = info.usage;
      const blockers: string[] = [];
      const maxL = targetPlan.maxLocations;
      const maxS = targetPlan.maxStaff;
      const maxC = targetPlan.maxClients;
      const maxSvc = targetPlan.maxServices;
      const maxP = targetPlan.maxProducts;
      if (maxL !== -1 && usage.locations > maxL) {
        blockers.push(`You have ${usage.locations} locations but the ${targetPlan.displayName} plan allows ${maxL}. Please remove ${usage.locations - maxL} location(s) before downgrading.`);
      }
      if (maxS !== -1 && usage.staff > maxS) {
        blockers.push(`You have ${usage.staff} staff members but the ${targetPlan.displayName} plan allows ${maxS}. Please remove ${usage.staff - maxS} staff member(s) before downgrading.`);
      }
      if (maxC !== -1 && usage.clients > maxC) {
        blockers.push(`You have ${usage.clients} clients but the ${targetPlan.displayName} plan allows ${maxC}. Please archive ${usage.clients - maxC} client(s) before downgrading.`);
      }
      if (maxSvc !== -1 && usage.services > maxSvc) {
        blockers.push(`You have ${usage.services} services but the ${targetPlan.displayName} plan allows ${maxSvc}. Please remove ${usage.services - maxSvc} service(s) before downgrading.`);
      }
      if (maxP !== -1 && usage.products > maxP) {
        blockers.push(`You have ${usage.products} products but the ${targetPlan.displayName} plan allows ${maxP}. Please remove ${usage.products - maxP} product(s) before downgrading.`);
      }
      res.json({
        allowed: blockers.length === 0,
        blockers,
        targetPlanName: targetPlan.displayName,
        usage,
        limits: {
          maxLocations: maxL,
          maxStaff: maxS,
          maxClients: maxC,
          maxServices: maxSvc,
          maxProducts: maxP,
        },
      });
    } catch (err) {
      console.error("[Stripe] check-downgrade error:", err);
      res.status(500).json({ error: "Failed to check downgrade eligibility" });
    }
  });

  /**
   * POST /api/stripe/cancel-subscription
   * Body: { businessOwnerId }
   * Cancels the subscription at the end of the current billing period.
   * The user retains access until stripeCurrentPeriodEnd.
   */
  app.post("/api/stripe/cancel-subscription", async (req: Request, res: Response) => {
    const stripe = await getStripeAsync();
    if (!stripe) {
      res.status(500).json({ error: "Stripe not configured" });
      return;
    }
    const { businessOwnerId } = req.body as { businessOwnerId: number };
    if (!businessOwnerId) {
      res.status(400).json({ error: "Missing businessOwnerId" });
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "DB not available" });
        return;
      }
      const rows = await db.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
      const owner = rows[0];
      if (!owner?.stripeSubscriptionId) {
        res.status(400).json({ error: "No active subscription found" });
        return;
      }
      // Cancel at period end (user keeps access until then)
      await stripe.subscriptions.update(owner.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      // Update DB
      await db.update(businessOwners)
        .set({ cancelAtPeriodEnd: true } as any)
        .where(eq(businessOwners.id, businessOwnerId));
      res.json({ success: true, message: "Subscription will cancel at the end of the billing period." });
    } catch (err) {
      console.error("[Stripe] cancel-subscription error:", err);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  });

  /**
   * POST /api/stripe/resume-subscription
   * Body: { businessOwnerId }
   * Resumes a subscription that was set to cancel at period end.
   */
  app.post("/api/stripe/resume-subscription", async (req: Request, res: Response) => {
    const stripe = await getStripeAsync();
    if (!stripe) {
      res.status(500).json({ error: "Stripe not configured" });
      return;
    }
    const { businessOwnerId } = req.body as { businessOwnerId: number };
    if (!businessOwnerId) {
      res.status(400).json({ error: "Missing businessOwnerId" });
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "DB not available" });
        return;
      }
      const rows = await db.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
      const owner = rows[0];
      if (!owner?.stripeSubscriptionId) {
        res.status(400).json({ error: "No active subscription found" });
        return;
      }
      // Remove cancel_at_period_end flag
      await stripe.subscriptions.update(owner.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });
      // Update DB
      await db.update(businessOwners)
        .set({ cancelAtPeriodEnd: false } as any)
        .where(eq(businessOwners.id, businessOwnerId));
      res.json({ success: true, message: "Subscription resumed. It will continue to renew automatically." });
    } catch (err) {
      console.error("[Stripe] resume-subscription error:", err);
      res.status(500).json({ error: "Failed to resume subscription" });
    }
  });

  /**
   * GET /api/stripe/next-invoice?businessOwnerId=X
   * Returns the upcoming invoice amount and date for the customer.
   */
  app.get("/api/stripe/next-invoice", async (req: Request, res: Response) => {
    const stripe = await getStripeAsync();
    if (!stripe) {
      res.status(500).json({ error: "Stripe not configured" });
      return;
    }
    const businessOwnerId = parseInt(req.query.businessOwnerId as string, 10);
    if (!businessOwnerId) {
      res.status(400).json({ error: "Missing businessOwnerId" });
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "DB not available" });
        return;
      }
      const rows = await db.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
      const owner = rows[0];
      if (!owner?.stripeCustomerId) {
        res.status(400).json({ error: "No Stripe customer found" });
        return;
      }
      // Retrieve upcoming invoice
      const upcoming = await (stripe.invoices as any).retrieveUpcoming({
        customer: owner.stripeCustomerId,
      });
      res.json({
        amount: upcoming.amount_due / 100,          // dollars
        amountFormatted: `$${(upcoming.amount_due / 100).toFixed(2)}`,
        date: upcoming.next_payment_attempt,        // Unix timestamp (seconds)
        periodEnd: upcoming.period_end,             // Unix timestamp (seconds)
      });
    } catch (err: any) {
      // Stripe returns 404 if there's no upcoming invoice (e.g., subscription cancelled)
      if (err?.statusCode === 404 || err?.code === "invoice_upcoming_none") {
        res.json({ amount: null, amountFormatted: null, date: null, periodEnd: null });
        return;
      }
      console.error("[Stripe] next-invoice error:", err);
      res.status(500).json({ error: "Failed to retrieve upcoming invoice" });
    }
  });


}
