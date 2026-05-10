/**
 * Stripe Connect Routes
 * Handles business owner onboarding, account status, dashboard links,
 * checkout session creation, and webhook processing for card payments.
 *
 * Platform fee: 1.5% on every transaction.
 */
import express from "express";
import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { getDb } from "./db";
import { businessOwners, appointments, clients, services } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getPlatformConfig } from "./subscription";
import { sendExpoPush, notifyCardPayment } from "./push";
const DEFAULT_PLATFORM_FEE_PERCENT = 0.015; // 1.5% fallback

/**
 * Returns the current platform fee as a decimal (e.g. 0.015 for 1.5%).
 * Reads from DB config key STRIPE_PLATFORM_FEE_PERCENT (set in admin dashboard).
 * Falls back to 1.5% if not configured.
 */
async function getPlatformFeePercent(): Promise<number> {
  try {
    const raw = await getPlatformConfig("STRIPE_PLATFORM_FEE_PERCENT");
    if (raw) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        return parsed / 100; // stored as percentage (e.g. "1.5"), convert to decimal
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_PLATFORM_FEE_PERCENT;
}

// ── Stripe client factory (reads key from DB config) ─────────────────────────
async function getStripe(): Promise<Stripe | null> {
  const key = await getPlatformConfig("STRIPE_SECRET_KEY");
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" as any });
}

async function getWebhookSecret(): Promise<string | null> {
  return getPlatformConfig("STRIPE_WEBHOOK_SECRET");
}

// ── Helper: get business owner by ID ─────────────────────────────────────────
async function getOwner(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(businessOwners).where(eq(businessOwners.id, id)).limit(1);
  return rows[0] ?? null;
}

// ── Helper: update business owner fields ─────────────────────────────────────
async function updateOwner(id: number, data: Partial<typeof businessOwners.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(businessOwners).set(data as any).where(eq(businessOwners.id, id));
}

export function registerStripeConnectRoutes(app: Express): void {

  // ── 1. Create / retrieve Express onboarding link ─────────────────────────
  // POST /api/stripe-connect/onboard  { businessOwnerId }
  app.post("/api/stripe-connect/onboard", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId } = req.body as { businessOwnerId: number };
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured. Ask your admin to add the Stripe Secret Key in Platform Config." }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }

      let accountId = (owner as any).stripeConnectAccountId as string | null;

      // Create a new Express account if none exists
      if (!accountId) {
        // Only pass email if it's a valid non-empty string (Stripe rejects empty/null emails)
        const ownerEmail = owner.email && owner.email.trim() && owner.email.includes('@') ? owner.email.trim() : undefined;
        const account = await stripe.accounts.create({
          type: "express",
          ...(ownerEmail ? { email: ownerEmail } : {}),
          business_type: "individual",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            businessOwnerId: String(businessOwnerId),
            businessName: owner.businessName ?? "",
          },
        });
        accountId = account.id;
        await updateOwner(businessOwnerId, { stripeConnectAccountId: accountId } as any);
      }

      // Determine return / refresh URLs
      const origin = `${req.protocol}://${req.get("host")}`;
      const returnUrl = `${origin}/api/stripe-connect/return?businessOwnerId=${businessOwnerId}`;
      const refreshUrl = `${origin}/api/stripe-connect/refresh?businessOwnerId=${businessOwnerId}`;

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });

      res.json({ url: accountLink.url });
    } catch (err: any) {
      console.error("[StripeConnect] onboard error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create onboarding link" });
    }
  });

  // ── 2. Return URL after onboarding (redirect to deep link) ───────────────
  app.get("/api/stripe-connect/return", async (req: Request, res: Response) => {
    const businessOwnerId = parseInt(String(req.query.businessOwnerId ?? "0"), 10);
    if (businessOwnerId) {
      // Refresh account status from Stripe
      try {
        const stripe = await getStripe();
        const owner = await getOwner(businessOwnerId);
        const accountId = (owner as any)?.stripeConnectAccountId as string | null;
        if (stripe && accountId) {
          const account = await stripe.accounts.retrieve(accountId);
          const enabled = account.charges_enabled ?? false;
          const complete = account.details_submitted ?? false;
          await updateOwner(businessOwnerId, {
            stripeConnectEnabled: enabled,
            stripeConnectOnboardingComplete: complete,
          } as any);
        }
      } catch (e) {
        console.error("[StripeConnect] return status refresh error:", e);
      }
    }
    // Show a simple success page that closes the browser tab
    res.send(`<!DOCTYPE html><html><head><title>Stripe Connected</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4;color:#166534;}
      .card{background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 4px 24px #0001;text-align:center;max-width:400px;}
      h1{font-size:24px;margin:16px 0 8px;}p{color:#4b5563;font-size:15px;margin:0 0 24px;}
      .check{font-size:48px;}</style></head>
      <body><div class="card"><div class="check">✅</div>
      <h1>Stripe Connected!</h1>
      <p>Your account has been connected successfully. You can now accept card payments from clients.</p>
      <p style="font-size:13px;color:#9ca3af;">You can close this tab and return to the app.</p>
      </div></body></html>`);
  });

  // ── 3. Refresh URL (re-generate onboarding link) ─────────────────────────
  app.get("/api/stripe-connect/refresh", async (req: Request, res: Response) => {
    const businessOwnerId = parseInt(String(req.query.businessOwnerId ?? "0"), 10);
    if (!businessOwnerId) { res.status(400).send("Missing businessOwnerId"); return; }
    try {
      const stripe = await getStripe();
      if (!stripe) { res.status(503).send("Stripe not configured"); return; }
      const owner = await getOwner(businessOwnerId);
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(404).send("No Stripe account found"); return; }
      const origin = `${req.protocol}://${req.get("host")}`;
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${origin}/api/stripe-connect/refresh?businessOwnerId=${businessOwnerId}`,
        return_url: `${origin}/api/stripe-connect/return?businessOwnerId=${businessOwnerId}`,
        type: "account_onboarding",
      });
      res.redirect(accountLink.url);
    } catch (err: any) {
      console.error("[StripeConnect] refresh error:", err);
      res.status(500).send("Failed to refresh onboarding link");
    }
  });

  // ── 4. Account status ─────────────────────────────────────────────────────
  // GET /api/stripe-connect/status?businessOwnerId=123
  app.get("/api/stripe-connect/status", async (req: Request, res: Response) => {
    try {
      const businessOwnerId = parseInt(String(req.query.businessOwnerId ?? "0"), 10);
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      const stripe = await getStripe();
      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }

      const accountId = (owner as any).stripeConnectAccountId as string | null;
      if (!stripe || !accountId) {
        res.json({
          connected: false,
          chargesEnabled: false,
          onboardingComplete: false,
          accountId: null,
          stripeConfigured: !!stripe,
        });
        return;
      }

      // Fetch live status from Stripe
      const account = await stripe.accounts.retrieve(accountId);
      const chargesEnabled = account.charges_enabled ?? false;
      const onboardingComplete = account.details_submitted ?? false;

      // Persist refreshed status
      await updateOwner(businessOwnerId, {
        stripeConnectEnabled: chargesEnabled,
        stripeConnectOnboardingComplete: onboardingComplete,
      } as any);

      res.json({
        connected: true,
        chargesEnabled,
        onboardingComplete,
        accountId,
        stripeConfigured: true,
      });
    } catch (err: any) {
      console.error("[StripeConnect] status error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to get status" });
    }
  });

  // ── 5. Stripe Dashboard login link ───────────────────────────────────────
  // POST /api/stripe-connect/dashboard-link  { businessOwnerId }
  app.post("/api/stripe-connect/dashboard-link", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId } = req.body as { businessOwnerId: number };
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(404).json({ error: "No Stripe account connected" }); return; }

      const loginLink = await stripe.accounts.createLoginLink(accountId);
      res.json({ url: loginLink.url });
    } catch (err: any) {
      console.error("[StripeConnect] dashboard-link error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create dashboard link" });
    }
  });

  // ── 6. Create Checkout Session for an appointment ────────────────────────
  // POST /api/stripe-connect/create-checkout
  // Body: { businessOwnerId, appointmentLocalId, clientName, serviceName, amount, currency?, successUrl, cancelUrl }
  app.post("/api/stripe-connect/create-checkout", async (req: Request, res: Response) => {
    try {
      const {
        businessOwnerId,
        appointmentLocalId,
        clientName,
        serviceName,
        amount,       // in dollars, e.g. 75.00
        currency = "usd",
        successUrl,
        cancelUrl,
      } = req.body as {
        businessOwnerId: number;
        appointmentLocalId: string;
        clientName: string;
        serviceName: string;
        amount: number;
        currency?: string;
        successUrl: string;
        cancelUrl: string;
      };

      if (!businessOwnerId || !appointmentLocalId || !amount || !successUrl || !cancelUrl) {
        res.status(400).json({ error: "Missing required fields" }); return;
      }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }

      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up. Please complete onboarding." }); return; }

      const amountCents = Math.round(amount * 100);
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(amountCents * feePercent);
      console.log(`[StripeConnect] create-checkout: amount=$${amount} feePercent=${(feePercent*100).toFixed(2)}% feeCents=${platformFeeCents} accountId=${accountId}`);

      const session = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency,
                product_data: {
                  name: serviceName || "Appointment",
                  description: `Booking for ${clientName}`,
                },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
            // Show the platform fee as a separate line so client sees the breakdown
            ...(platformFeeCents > 0 ? [{
              price_data: {
                currency,
                product_data: {
                  name: "Processing Fee",
                  description: `${(feePercent * 100).toFixed(1)}% card processing fee`,
                },
                unit_amount: platformFeeCents,
              },
              quantity: 1,
            }] : []),
          ],
          mode: "payment",
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            appointmentLocalId,
            businessOwnerId: String(businessOwnerId),
            clientName,
          },
          payment_intent_data: {
            application_fee_amount: platformFeeCents,
            metadata: {
              appointmentLocalId,
              businessOwnerId: String(businessOwnerId),
            },
          },
          // Apple Pay and Google Pay are automatically shown by Stripe Checkout
          // when the device/browser supports them — no extra config needed.
        } as any,
        { stripeAccount: accountId }
      );

      // Store the session ID on the appointment so webhook can match it
      const db = await getDb();
      if (db) {
        await db
          .update(appointments)
          .set({ stripeCheckoutSessionId: session.id } as any)
          .where(
            and(
              eq(appointments.localId, appointmentLocalId),
              eq(appointments.businessOwnerId, businessOwnerId)
            )
          );
      }

      res.json({ sessionId: session.id, url: session.url });
    } catch (err: any) {
      console.error("[StripeConnect] create-checkout error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create checkout session" });
    }
  });

  // ── 6b. Request Payment Link — owner-initiated post-booking card payment ──
  // POST /api/stripe-connect/request-payment
  // Body: { businessOwnerId, appointmentLocalId }
  // Creates a Stripe Checkout session for an existing appointment and returns
  // the hosted payment URL so the owner can SMS it to the client.
  app.post("/api/stripe-connect/request-payment", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId, appointmentLocalId } = req.body as {
        businessOwnerId: number;
        appointmentLocalId: string;
      };

      if (!businessOwnerId || !appointmentLocalId) {
        res.status(400).json({ error: "businessOwnerId and appointmentLocalId are required" }); return;
      }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }

      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }

      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up. Please complete onboarding." }); return; }

      // Load appointment
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      const apptRows = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId)))
        .limit(1);

      const appt = apptRows[0];
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

      const amount = parseFloat(String(appt.totalPrice ?? 0));
      if (!amount || amount <= 0) { res.status(400).json({ error: "Appointment has no charge amount" }); return; }

      // Load client and service names for the checkout page
      const clientRows = (appt as any).clientLocalId
        ? await db.select().from(clients).where(and(eq(clients.localId, (appt as any).clientLocalId), eq(clients.businessOwnerId, businessOwnerId))).limit(1)
        : [];
      const svcRows = (appt as any).serviceLocalId
        ? await db.select().from(services).where(and(eq(services.localId, (appt as any).serviceLocalId), eq(services.businessOwnerId, businessOwnerId))).limit(1)
        : [];

      const clientName = (clientRows[0] as any)?.name || "Client";
      const serviceName = (svcRows[0] as any)?.name || "Appointment";

      const amountCents = Math.round(amount * 100);
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(amountCents * feePercent);
      console.log(`[StripeConnect] request-payment: amount=$${amount} feePercent=${(feePercent*100).toFixed(2)}% feeCents=${platformFeeCents} accountId=${accountId}`);

      // Build success URL — dedicated receipt page (no booking form flash)
      // Use customSlug if set, otherwise derive from businessName (same logic as getBusinessOwnerBySlug)
      const origin = `${req.protocol}://${req.get("host")}`;
      const slug = (owner as any).customSlug || (owner.businessName ? owner.businessName.toLowerCase().replace(/\s+/g, "-") : String(businessOwnerId));
      // Point to the dedicated /api/payment-receipt/:slug page so client sees a clean receipt
      // without the booking form. The receipt page fetches appointment-by-session internally.
      const successUrl = `${origin}/api/payment-receipt/${slug}?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/api/book/${slug}`;

      const session = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: serviceName,
                  description: `Payment for ${clientName}'s appointment`,
                },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
            ...(platformFeeCents > 0 ? [{
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Processing Fee",
                  description: `${(feePercent * 100).toFixed(1)}% card processing fee`,
                },
                unit_amount: platformFeeCents,
              },
              quantity: 1,
            }] : []),
          ],
          mode: "payment",
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            appointmentLocalId,
            businessOwnerId: String(businessOwnerId),
            clientName,
            paymentRequestedByOwner: "true",
          },
          payment_intent_data: {
            application_fee_amount: platformFeeCents,
            metadata: { appointmentLocalId, businessOwnerId: String(businessOwnerId) },
          },
        } as any,
        { stripeAccount: accountId }
      );

      // Store session ID on appointment so webhook can match it
      await db
        .update(appointments)
        .set({ stripeCheckoutSessionId: session.id } as any)
        .where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId)));

      res.json({ ok: true, url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[StripeConnect] request-payment error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create payment request" });
    }
  });

  // ── 6c. Session Status — check if a Checkout session is still active ──────
  // GET /api/stripe-connect/session-status?sessionId=cs_xxx&businessOwnerId=1
  app.get("/api/stripe-connect/session-status", async (req: Request, res: Response) => {
    try {
      const { sessionId, businessOwnerId } = req.query as { sessionId: string; businessOwnerId: string };
      if (!sessionId || !businessOwnerId) {
        res.status(400).json({ error: "sessionId and businessOwnerId are required" }); return;
      }
      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const ownerRows = await db.select().from(businessOwners).where(eq(businessOwners.id, parseInt(businessOwnerId))).limit(1);
      const ownerRow = ownerRows[0];
      const accountId = (ownerRow as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(404).json({ error: "Stripe account not found" }); return; }

      const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId });

      // A session is "usable" if it is open (not expired, not already paid)
      const isActive = session.status === "open";
      const isPaid = session.status === "complete" || session.payment_status === "paid";
      res.json({ ok: true, status: session.status, isActive, isPaid, url: session.url });
    } catch (err: any) {
      // Stripe returns a 404-like error if the session doesn't exist on that account
      console.error("[StripeConnect] session-status error:", err);
      res.json({ ok: true, status: "expired", isActive: false, isPaid: false, url: null });
    }
  });

  // ── 6d. Appointment Payment Status — poll whether an appointment has been paid ──
  // GET /api/stripe-connect/appointment-payment-status?businessOwnerId=1&appointmentLocalId=abc
  app.get("/api/stripe-connect/appointment-payment-status", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId, appointmentLocalId } = req.query as { businessOwnerId: string; appointmentLocalId: string };
      if (!businessOwnerId || !appointmentLocalId) {
        res.status(400).json({ error: "businessOwnerId and appointmentLocalId are required" }); return;
      }
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }

      // Look up the appointment directly by businessOwnerId + localId
      const apptRows = await db
        .select()
        .from(appointments)
        .where(and(
          eq(appointments.businessOwnerId, parseInt(businessOwnerId)),
          eq(appointments.localId, appointmentLocalId),
        ))
        .limit(1);

      if (!apptRows.length) { res.status(404).json({ error: "Appointment not found" }); return; }

      const appt = apptRows[0];
      res.json({
        ok: true,
        paymentStatus: appt.paymentStatus ?? 'unpaid',
        paymentMethod: appt.paymentMethod ?? null,
        totalPrice: appt.totalPrice ? parseFloat(appt.totalPrice as string) : 0,
      });
    } catch (err: any) {
      console.error("[StripeConnect] appointment-payment-status error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to check payment status" });
    }
  });

  // ── 7. Webhook: handle payment completion ────────────────────────────────
  // POST /api/stripe-connect/webhook
  app.post(
    "/api/stripe-connect/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const webhookSecret = await getWebhookSecret();
      const stripe = await getStripe();

      if (!stripe || !webhookSecret) {
        res.status(503).json({ error: "Stripe not configured" }); return;
      }

      const sig = req.headers["stripe-signature"] as string;
      let event: Stripe.Event;
      // Use rawBody (preserved by express.json verify callback) if available,
      // otherwise fall back to req.body (works when express.raw middleware runs first)
      const rawPayload = (req as any).rawBody ?? req.body;
      try {
        event = stripe.webhooks.constructEvent(rawPayload, sig, webhookSecret);
      } catch (err: any) {
        console.error("[StripeConnect] Webhook signature verification failed:", err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const appointmentLocalId = session.metadata?.appointmentLocalId;
        const businessOwnerId = parseInt(session.metadata?.businessOwnerId ?? "0", 10);

        // ── Gift purchase payment completed ─────────────────────────────────────
        const giftCode = session.metadata?.giftCode;
        const sessionType = session.metadata?.type;
        if (sessionType === "gift_purchase" && giftCode && businessOwnerId) {
          try {
            const db = await getDb();
            if (db) {
              const { giftCards } = await import("../drizzle/schema");
              await db
                .update(giftCards)
                .set({ paymentStatus: "paid", paymentMethod: "card" } as any)
                .where(
                  and(
                    eq((giftCards as any).code, giftCode),
                    eq((giftCards as any).businessOwnerId, businessOwnerId)
                  )
                );
              console.log(`[StripeConnect] Gift ${giftCode} marked paid via card (owner ${businessOwnerId})`);
              // Push notification to business owner
              try {
                const ownerRows = await db.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
                const owner = ownerRows[0];
                const pushToken = (owner as any)?.expoPushToken;
                if (pushToken) {
                  await sendExpoPush(pushToken, {
                    title: "🎁 Gift Card Purchased",
                    body: `A gift card (${giftCode}) was paid via card. Check your Gifts tab.`,
                    data: { type: "payment_received" as const },
                    sound: "default",
                  });
                }
              } catch (notifErr) {
                console.error("[StripeConnect] Gift payment notification error:", notifErr);
              }
            }
          } catch (dbErr) {
            console.error("[StripeConnect] Gift DB update error:", dbErr);
          }
        }

        if (appointmentLocalId && businessOwnerId) {
          try {
            const db = await getDb();
            if (db) {
              await db
                .update(appointments)
                .set({
                  paymentStatus: "paid",
                  paymentMethod: "card",
                  stripeCheckoutSessionId: session.id,
                } as any)
                .where(
                  and(
                    eq(appointments.localId, appointmentLocalId),
                    eq(appointments.businessOwnerId, businessOwnerId)
                  )
                );
               console.log(`[StripeConnect] Appointment ${appointmentLocalId} marked paid via card`);
              // Send push notification to app so it auto-updates the appointment status
              try {
                const db2 = await getDb();
                if (db2) {
                  const ownerRows = await db2.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
                  const owner = ownerRows[0];
                  const pushToken = (owner as any)?.expoPushToken;
                  if (pushToken) {
                    const apptRows = await db2.select().from(appointments).where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId))).limit(1);
                    const appt = apptRows[0];
                    if (appt) {
                      // Load client and service names
                      const clientRows = appt.clientLocalId ? await db2.select().from(clients).where(and(eq(clients.localId, appt.clientLocalId), eq(clients.businessOwnerId, businessOwnerId))).limit(1) : [];
                      const svcRows = appt.serviceLocalId ? await db2.select().from(services).where(and(eq(services.localId, appt.serviceLocalId), eq(services.businessOwnerId, businessOwnerId))).limit(1) : [];
                      const clientName = (clientRows[0] as any)?.name || "Client";
                      const serviceName = (svcRows[0] as any)?.name || "Service";
                      await notifyCardPayment(
                        pushToken,
                        owner.businessName || "Your Business",
                        clientName,
                        serviceName,
                        appt.date || "",
                        appt.time || "00:00",
                        appointmentLocalId,
                        appt.totalPrice || 0,
                        { duration: appt.duration || undefined }
                      );
                    }
                  }
                }
              } catch (notifErr) {
                console.error("[StripeConnect] Card payment notification error:", notifErr);
              }
            }
          } catch (dbErr) {
            console.error("[StripeConnect] DB update error:", dbErr);
          }
        }
      }
      // ── payout.paid — confirm payout has landed ──────────────────────────────
      if (event.type === "payout.paid") {
        const payout = event.data.object as Stripe.Payout;
        const stripeAccountId = (event as any).account as string | undefined;

        if (stripeAccountId) {
          try {
            const db = await getDb();
            if (db) {
              const owners = await db
                .select({ id: businessOwners.id, pushToken: (businessOwners as any).expoPushToken })
                .from(businessOwners)
                .where(eq((businessOwners as any).stripeConnectAccountId, stripeAccountId))
                .limit(1);

              if (owners.length > 0 && owners[0].pushToken) {
                const amountDollars = (payout.amount / 100).toFixed(2);
                const currency = payout.currency.toUpperCase();
                await sendExpoPush(owners[0].pushToken, {
                  title: "✅ Payout Arrived",
                  body: `$${amountDollars} ${currency} has been deposited to your bank account.`,
                  data: { type: "stripe_payout" },
                  sound: "default",
                });
              }
            }
          } catch (notifErr) {
            console.error("[StripeConnect] Payout paid notification error:", notifErr);
          }
        }
      }

      // ── payout.failed — urgent alert when payout fails ───────────────────────
      if (event.type === "payout.failed") {
        const payout = event.data.object as Stripe.Payout;
        const stripeAccountId = (event as any).account as string | undefined;

        if (stripeAccountId) {
          try {
            const db = await getDb();
            if (db) {
              const owners = await db
                .select({ id: businessOwners.id, pushToken: (businessOwners as any).expoPushToken })
                .from(businessOwners)
                .where(eq((businessOwners as any).stripeConnectAccountId, stripeAccountId))
                .limit(1);

              if (owners.length > 0 && owners[0].pushToken) {
                const amountDollars = (payout.amount / 100).toFixed(2);
                const currency = payout.currency.toUpperCase();
                const failureMsg = (payout as any).failure_message || "Please check your bank account details in Stripe.";
                await sendExpoPush(owners[0].pushToken, {
                  title: "⚠️ Payout Failed",
                  body: `$${amountDollars} ${currency} payout failed. ${failureMsg}`,
                  data: { type: "stripe_payout" },
                  sound: "default",
                });
                console.log(`[StripeConnect] Payout FAILED notification sent to owner ${owners[0].id}: $${amountDollars}`);
              }
            }
          } catch (notifErr) {
            console.error("[StripeConnect] Payout failed notification error:", notifErr);
          }
        }
      }

      // ── payout.created — notify business owner when Stripe initiates a payout ──
      if (event.type === "payout.created") {
        const payout = event.data.object as Stripe.Payout;
        const stripeAccountId = (event as any).account as string | undefined;

        if (stripeAccountId) {
          try {
            const db = await getDb();
            if (db) {
              // Find the business owner by their Stripe Connect account ID
              const owners = await db
                .select({ id: businessOwners.id, pushToken: (businessOwners as any).expoPushToken })
                .from(businessOwners)
                .where(eq((businessOwners as any).stripeConnectAccountId, stripeAccountId))
                .limit(1);

              if (owners.length > 0 && owners[0].pushToken) {
                const amountDollars = (payout.amount / 100).toFixed(2);
                const currency = payout.currency.toUpperCase();
                const arrivalDate = new Date(payout.arrival_date * 1000).toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric"
                });
                await sendExpoPush(owners[0].pushToken, {
                  title: "💸 Payout Initiated",
                  body: `$${amountDollars} ${currency} is on its way — expected to arrive ${arrivalDate}.`,
                  data: { type: "stripe_payout" },
                  sound: "default",
                });
                console.log(`[StripeConnect] Payout notification sent to owner ${owners[0].id}: $${amountDollars} arriving ${arrivalDate}`);
              }
            }
          } catch (notifErr) {
            console.error("[StripeConnect] Payout notification error:", notifErr);
          }
        }
      }
      // ── payment_intent.succeeded — mark appointment paid when using native payment sheet ──
      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object as Stripe.PaymentIntent;
        const appointmentLocalId = pi.metadata?.appointmentLocalId;
        const businessOwnerId = parseInt(pi.metadata?.businessOwnerId ?? '0', 10);
        const giftCode = pi.metadata?.giftCode;
        const sessionType = pi.metadata?.type;
        // Handle gift card payment via native sheet
        if (sessionType === 'gift_purchase' && giftCode && businessOwnerId) {
          try {
            const db = await getDb();
            if (db) {
              const { giftCards } = await import('../drizzle/schema');
              await db
                .update(giftCards)
                .set({ paymentStatus: 'paid', paymentMethod: 'card' } as any)
                .where(and(eq((giftCards as any).code, giftCode), eq((giftCards as any).businessOwnerId, businessOwnerId)));
              console.log(`[StripeConnect] Gift ${giftCode} marked paid via native payment sheet (owner ${businessOwnerId})`);
            }
          } catch (dbErr) {
            console.error('[StripeConnect] Gift DB update error (payment_intent.succeeded):', dbErr);
          }
        }
        // Handle appointment payment via native sheet
        if (appointmentLocalId && businessOwnerId) {
          try {
            const db = await getDb();
            if (db) {
              await db
                .update(appointments)
                .set({
                  paymentStatus: 'paid',
                  paymentMethod: 'card',
                  stripePaymentIntentId: pi.id,
                } as any)
                .where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId)));
              console.log(`[StripeConnect] Appointment ${appointmentLocalId} marked paid via native payment sheet`);
              // Push notification to business owner
              try {
                const db2 = await getDb();
                if (db2) {
                  const ownerRows = await db2.select().from(businessOwners).where(eq(businessOwners.id, businessOwnerId)).limit(1);
                  const owner = ownerRows[0];
                  const pushToken = (owner as any)?.expoPushToken;
                  if (pushToken) {
                    const apptRows = await db2.select().from(appointments).where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId))).limit(1);
                    const appt = apptRows[0];
                    if (appt) {
                      const clientRows = appt.clientLocalId ? await db2.select().from(clients).where(and(eq(clients.localId, appt.clientLocalId), eq(clients.businessOwnerId, businessOwnerId))).limit(1) : [];
                      const svcRows = appt.serviceLocalId ? await db2.select().from(services).where(and(eq(services.localId, appt.serviceLocalId), eq(services.businessOwnerId, businessOwnerId))).limit(1) : [];
                      const clientName = (clientRows[0] as any)?.name || 'Client';
                      const serviceName = (svcRows[0] as any)?.name || 'Service';
                      await notifyCardPayment(pushToken, owner.businessName || 'Your Business', clientName, serviceName, appt.date || '', appt.time || '00:00', appointmentLocalId, appt.totalPrice || 0, { duration: appt.duration || undefined });
                    }
                  }
                }
              } catch (notifErr) {
                console.error('[StripeConnect] Card payment notification error (payment_intent.succeeded):', notifErr);
              }
            }
          } catch (dbErr) {
            console.error('[StripeConnect] DB update error (payment_intent.succeeded):', dbErr);
          }
        }
      }
      res.json({ received: true });
    }
  );
  // ── 8. Admin: list all connected accounts ────────────────────────────────────────────────────
  // GET /api/admin/stripe-connect/accounts
  app.get("/api/admin/stripe-connect/accounts", async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      const owners = await db
        .select({
          id: businessOwners.id,
          businessName: businessOwners.businessName,
          email: businessOwners.email,
          stripeConnectAccountId: (businessOwners as any).stripeConnectAccountId,
          stripeConnectEnabled: (businessOwners as any).stripeConnectEnabled,
          stripeConnectOnboardingComplete: (businessOwners as any).stripeConnectOnboardingComplete,
        })
        .from(businessOwners)
        .orderBy(businessOwners.businessName);

      const feePercent = await getPlatformFeePercent();
      res.json({ accounts: owners, platformFeePercent: feePercent * 100 });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── 9. Admin: disconnect a Stripe account ────────────────────────────────
  // POST /api/admin/stripe-connect/disconnect  { businessOwnerId }
  app.post("/api/admin/stripe-connect/disconnect", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId } = req.body as { businessOwnerId: number };
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      await updateOwner(businessOwnerId, {
        stripeConnectAccountId: null,
        stripeConnectEnabled: false,
        stripeConnectOnboardingComplete: false,
      } as any);

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── 10. Refund a card payment ────────────────────────────────────────────────
  // POST /api/stripe-connect/refund
  // Body: { businessOwnerId, appointmentLocalId, amount? }  (amount in dollars; omit for full refund)
  app.post("/api/stripe-connect/refund", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId, appointmentLocalId, amount } = req.body as {
        businessOwnerId: number;
        appointmentLocalId: string;
        amount?: number;
      };

      if (!businessOwnerId || !appointmentLocalId) {
        res.status(400).json({ error: "businessOwnerId and appointmentLocalId are required" }); return;
      }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has no connected Stripe account" }); return; }

      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      const rows = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.localId, appointmentLocalId),
            eq(appointments.businessOwnerId, businessOwnerId)
          )
        )
        .limit(1);

      const appt = rows[0];
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

      // Support both native payment sheet (stripePaymentIntentId) and checkout session (stripeCheckoutSessionId)
      const directPaymentIntentId = (appt as any).stripePaymentIntentId as string | null;
      const sessionId = (appt as any).stripeCheckoutSessionId as string | null;
      let paymentIntentId: string | null = directPaymentIntentId;
      if (!paymentIntentId && sessionId) {
        // Fallback: look up payment intent from checkout session
        const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      }
      if (!paymentIntentId) { res.status(400).json({ error: "No Stripe payment found for this appointment" }); return; }

      const refundParams: Stripe.RefundCreateParams = { payment_intent: paymentIntentId };
      if (amount && amount > 0) {
        refundParams.amount = Math.round(amount * 100);
      }

      const refund = await stripe.refunds.create(refundParams, { stripeAccount: accountId });

      await db
        .update(appointments)
        .set({
          paymentStatus: "unpaid",
          paymentMethod: null,
          refundedAt: new Date(),
          refundedAmount: String(refund.amount / 100),
          stripeRefundId: refund.id,
        } as any)
        .where(
          and(
            eq(appointments.localId, appointmentLocalId),
            eq(appointments.businessOwnerId, businessOwnerId)
          )
        );

      // ── Send Twilio SMS to client ──────────────────────────────────────
      try {
        const accountSid = await getPlatformConfig("TWILIO_ACCOUNT_SID");
        const authToken = await getPlatformConfig("TWILIO_AUTH_TOKEN");
        const fromNumber = await getPlatformConfig("TWILIO_FROM_NUMBER");
        const testMode = await getPlatformConfig("TWILIO_TEST_MODE");

        if (accountSid && authToken && fromNumber) {
          // Fetch client phone
          const clientRows = await db
            .select({ phone: clients.phone, name: clients.name })
            .from(clients)
            .where(and(eq(clients.localId, (appt as any).clientLocalId ?? ""), eq(clients.businessOwnerId, businessOwnerId)))
            .limit(1);
          const clientPhone = clientRows[0]?.phone;
          const clientName = clientRows[0]?.name ?? "there";

          // Fetch service name
          const svcRows = await db
            .select({ name: services.name })
            .from(services)
            .where(and(eq(services.localId, (appt as any).serviceLocalId ?? ""), eq(services.businessOwnerId, businessOwnerId)))
            .limit(1);
          const serviceName = svcRows[0]?.name ?? "your appointment";

          const refundAmt = refund.amount / 100;
          const apptDate = (appt as any).date ?? "";
          const formattedDate = apptDate
            ? new Date(apptDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
            : "your appointment";

          const smsBody = `Hi ${clientName}, your refund of $${refundAmt.toFixed(2)} for ${serviceName} on ${formattedDate} has been processed. It will appear on your card in 5\u201310 business days. \u2014 Lime Of Time`;

          if (clientPhone) {
            if (testMode === "true") {
              console.log(`[SMS TEST MODE] Refund SMS to ${clientPhone}: ${smsBody}`);
            } else {
              const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
              const params = new URLSearchParams();
              params.append("From", fromNumber);
              params.append("To", clientPhone);
              params.append("Body", smsBody);
              const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
              await fetch(url, {
                method: "POST",
                headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
              }).catch((smsErr) => console.error("[StripeConnect] refund SMS error:", smsErr));
            }
          }
        }
      } catch (smsErr) {
        // SMS failure should not block the refund response
        console.error("[StripeConnect] refund SMS send error:", smsErr);
      }

      res.json({ ok: true, refundId: refund.id, status: refund.status, amount: refund.amount / 100 });
    } catch (err: any) {
      console.error("[StripeConnect] refund error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to issue refund" });
    }
  });

  // ── 11. No-show fee charge ─────────────────────────────────────────────────
  // POST /api/stripe-connect/no-show-fee
  // Body: { businessOwnerId, appointmentLocalId, amount, serviceName?, clientName?, successUrl, cancelUrl }
  // Creates a new Stripe Checkout session for the no-show fee amount.
  app.post("/api/stripe-connect/no-show-fee", async (req: Request, res: Response) => {
    try {
      const {
        businessOwnerId,
        appointmentLocalId,
        amount,
        serviceName,
        clientName,
        successUrl,
        cancelUrl,
        currency = "usd",
      } = req.body as {
        businessOwnerId: number;
        appointmentLocalId: string;
        amount: number;
        serviceName?: string;
        clientName?: string;
        successUrl: string;
        cancelUrl: string;
        currency?: string;
      };

      if (!businessOwnerId || !appointmentLocalId || !amount || !successUrl || !cancelUrl) {
        res.status(400).json({ error: "Missing required fields" }); return;
      }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }
      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up" }); return; }

      const amountCents = Math.round(amount * 100);
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(amountCents * feePercent);
      console.log(`[StripeConnect] no-show-fee: amount=$${amount} feePercent=${(feePercent*100).toFixed(2)}% feeCents=${platformFeeCents} accountId=${accountId}`);

      const session = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency,
                product_data: {
                  name: `No-Show Fee — ${serviceName || "Appointment"}`,
                  description: `No-show fee for ${clientName || "client"}'s missed appointment`,
                },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
            ...(platformFeeCents > 0 ? [{
              price_data: {
                currency,
                product_data: {
                  name: "Processing Fee",
                  description: `${(feePercent * 100).toFixed(1)}% card processing fee`,
                },
                unit_amount: platformFeeCents,
              },
              quantity: 1,
            }] : []),
          ],
          mode: "payment",
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            appointmentLocalId,
            businessOwnerId: String(businessOwnerId),
            clientName: clientName ?? "",
            feeType: "no_show",
          },
          payment_intent_data: {
            application_fee_amount: platformFeeCents,
            metadata: {
              appointmentLocalId,
              businessOwnerId: String(businessOwnerId),
              feeType: "no_show",
            },
          },
          // Apple Pay and Google Pay shown automatically by Stripe Checkout
        } as any,
        { stripeAccount: accountId }
      );

      res.json({ sessionId: session.id, url: session.url });
    } catch (err: any) {
      console.error("[StripeConnect] no-show-fee error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create no-show fee session" });
    }
  });

  // ── 12. Cancellation fee charge ──────────────────────────────────────────────
  // POST /api/stripe-connect/cancellation-fee
  // Body: { businessOwnerId, appointmentLocalId, feeAmount, serviceName?, clientName? }
  // Charges the cancellation fee directly to the payment method used in the original checkout.
  // Returns { ok, chargeId, amount } — no redirect URL needed (off-session charge).
  app.post("/api/stripe-connect/cancellation-fee", async (req: Request, res: Response) => {
    try {
      const {
        businessOwnerId,
        appointmentLocalId,
        feeAmount,
        serviceName,
        clientName,
        currency = "usd",
      } = req.body as {
        businessOwnerId: number;
        appointmentLocalId: string;
        feeAmount: number;
        serviceName?: string;
        clientName?: string;
        currency?: string;
      };

      if (!businessOwnerId || !appointmentLocalId || !feeAmount || feeAmount <= 0) {
        res.status(400).json({ error: "businessOwnerId, appointmentLocalId, and feeAmount are required" }); return;
      }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }
      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up" }); return; }

      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      // Look up the original appointment to get the checkout session
      const rows = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId)))
        .limit(1);
      const appt = rows[0];
      if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

      const sessionId = (appt as any).stripeCheckoutSessionId as string | null;
      if (!sessionId) { res.status(400).json({ error: "No original Stripe checkout session found — cannot charge off-session" }); return; }

      // Retrieve original session to get payment method
      const originalSession = await stripe.checkout.sessions.retrieve(
        sessionId,
        { expand: ["payment_intent"] },
        { stripeAccount: accountId }
      );
      const pi = typeof originalSession.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(originalSession.payment_intent, {}, { stripeAccount: accountId })
        : (originalSession.payment_intent as Stripe.PaymentIntent | null);

      if (!pi) { res.status(400).json({ error: "Could not retrieve original payment intent" }); return; }

      const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
      const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;

      if (!paymentMethodId) {
        res.status(400).json({ error: "No saved payment method on original charge — cannot charge off-session" }); return;
      }

      const feeCents = Math.round(feeAmount * 100);
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(feeCents * feePercent);

      // Create a new PaymentIntent for the cancellation fee (off-session, using saved payment method)
      const feePI = await stripe.paymentIntents.create(
        {
          amount: feeCents,
          currency,
          payment_method: paymentMethodId,
          ...(customerId ? { customer: customerId } : {}),
          confirm: true,
          off_session: true,
          application_fee_amount: platformFeeCents,
          description: `Cancellation fee — ${serviceName || "Appointment"} (${clientName || "client"})`,
          metadata: {
            appointmentLocalId,
            businessOwnerId: String(businessOwnerId),
            feeType: "cancellation",
          },
        } as any,
        { stripeAccount: accountId }
      );

      console.log(`[StripeConnect] cancellation-fee charged: $${feeAmount} piId=${feePI.id} accountId=${accountId}`);

      // ── Send cancellation fee SMS to client ─────────────────────────────────
      try {
        const accountSid = await getPlatformConfig("TWILIO_ACCOUNT_SID");
        const authToken = await getPlatformConfig("TWILIO_AUTH_TOKEN");
        const fromNumber = await getPlatformConfig("TWILIO_FROM_NUMBER");
        const testMode = await getPlatformConfig("TWILIO_TEST_MODE");

        if (accountSid && authToken && fromNumber) {
          // Fetch client phone
          const clientRows = await db
            .select({ phone: clients.phone, name: clients.name })
            .from(clients)
            .where(and(eq(clients.localId, (appt as any).clientLocalId ?? ""), eq(clients.businessOwnerId, businessOwnerId)))
            .limit(1);
          const clientPhone = clientRows[0]?.phone;
          const resolvedClientName = clientRows[0]?.name ?? clientName ?? "there";

          // Fetch original charge amount from appointment
          const originalTotal = parseFloat(String((appt as any).totalPrice ?? "0")) || 0;
          const refundAmt = Math.max(0, originalTotal - feeAmount);

          const apptDate = (appt as any).date ?? "";
          const formattedDate = apptDate
            ? new Date(apptDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
            : "your appointment";

          const bizName = (owner as any).businessName ?? "Your provider";

          const smsBody = [
            `Hi ${resolvedClientName}, your appointment for ${serviceName || "your service"} on ${formattedDate} has been cancelled.`,
            ``,
            `Here is a summary of your charges:`,
            `• Cancellation fee charged: $${feeAmount.toFixed(2)}`,
            ...(refundAmt > 0 ? [`• Refund issued: $${refundAmt.toFixed(2)} (will appear on your card in 5–10 business days)`] : []),
            ``,
            `If you have any questions, please contact ${bizName} directly. — Lime Of Time`,
          ].join("\n");

          if (clientPhone) {
            if (testMode === "true") {
              console.log(`[SMS TEST MODE] Cancellation fee SMS to ${clientPhone}: ${smsBody}`);
            } else {
              const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
              const params = new URLSearchParams();
              params.append("From", fromNumber);
              params.append("To", clientPhone);
              params.append("Body", smsBody);
              const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
              await fetch(url, {
                method: "POST",
                headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
              }).catch((smsErr) => console.error("[StripeConnect] cancellation-fee SMS error:", smsErr));
            }
          }
        }
      } catch (smsErr) {
        // SMS failure should not block the charge response
        console.error("[StripeConnect] cancellation-fee SMS send error:", smsErr);
      }

      res.json({
        ok: true,
        chargeId: feePI.id,
        status: feePI.status,
        amount: feeCents / 100,
      });
    } catch (err: any) {
      console.error("[StripeConnect] cancellation-fee error:", err);
      // Stripe off-session errors (e.g. card declined) return a specific code
      if (err?.code === "authentication_required" || err?.code === "card_declined") {
        res.status(402).json({ error: "Card declined or authentication required. Please collect the fee manually.", code: err.code });
      } else {
        res.status(500).json({ error: err?.message ?? "Failed to charge cancellation fee" });
      }
    }
  });

  // ── 10. Payout schedule ───────────────────────────────────────────────────────────────────────────────────
  // GET /api/stripe-connect/payouts?businessOwnerId=123
  // Returns payout schedule info + recent payouts for the connected account.
  app.get("/api/stripe-connect/payouts", async (req: Request, res: Response) => {
    try {
      const businessOwnerId = parseInt(String(req.query.businessOwnerId ?? "0"), 10);
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }

      const accountId = (owner as any).stripeConnectAccountId as string | null;
      if (!accountId) { res.status(404).json({ error: "No Stripe account connected" }); return; }

      // Fetch account to get payout schedule
      const account = await stripe.accounts.retrieve(accountId);
      const schedule = account.settings?.payouts?.schedule ?? null;

      // Fetch recent payouts (last 5)
      const payoutList = await stripe.payouts.list(
        { limit: 5 },
        { stripeAccount: accountId }
      );

      const payouts = payoutList.data.map((p) => ({
        id: p.id,
        amount: p.amount / 100,
        currency: p.currency,
        arrivalDate: p.arrival_date, // Unix timestamp
        status: p.status, // paid | pending | in_transit | canceled | failed
        description: p.description,
      }));

      // Determine next expected payout date from the first pending/in_transit payout
      const nextPayout = payouts.find((p) => p.status === "pending" || p.status === "in_transit") ?? null;

      res.json({
        schedule: schedule
          ? {
              interval: schedule.interval, // daily | weekly | monthly | manual
              weeklyAnchor: (schedule as any).weekly_anchor ?? null,
              monthlyAnchor: (schedule as any).monthly_anchor ?? null,
              delayDays: (schedule as any).delay_days ?? null,
            }
          : null,
        nextPayout,
        recentPayouts: payouts,
      });
    } catch (err: any) {
      console.error("[StripeConnect] payouts error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to fetch payouts" });
    }
  });

  // POST /api/admin/stripe-connect/register-webhook
  // Auto-registers the webhook endpoint with Stripe and saves the signing secret to DB
  app.post("/api/admin/stripe-connect/register-webhook", async (req: Request, res: Response) => {
    try {
      const stripe = await getStripe();
      if (!stripe) {
        res.status(503).json({ error: "Stripe not configured. Add STRIPE_CONNECT_SECRET_KEY in Platform Config first." });
        return;
      }
      const { serverDomain } = req.body as { serverDomain?: string };
      if (!serverDomain) { res.status(400).json({ error: "serverDomain is required" }); return; }
      const cleanDomain = serverDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const webhookUrl = `https://${cleanDomain}/api/stripe-connect/webhook`;

      // Check if webhook already exists for this URL
      const existing = await stripe.webhookEndpoints.list({ limit: 100 });
      const alreadyExists = existing.data.find((w) => w.url === webhookUrl);
      if (alreadyExists) {
        res.json({ ok: true, message: "Webhook already registered", url: webhookUrl, alreadyExists: true });
        return;
      }

      // Create the webhook endpoint
      const endpoint = await stripe.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: [
          "checkout.session.completed",
          "checkout.session.expired",
          "payment_intent.succeeded",
          "payment_intent.payment_failed",
          "account.updated",
          "payout.created",
          "payout.paid",
          "payout.failed",
        ],
        description: "Lime Of Time — booking payment confirmations",
      });

      // Save the signing secret to platform config
      const db = await getDb();
      if (db && endpoint.secret) {
        const { platformConfig } = await import("../drizzle/schema");
        await db.update(platformConfig)
          .set({ configValue: endpoint.secret })
          .where(eq(platformConfig.configKey, "STRIPE_CONNECT_WEBHOOK_SECRET"));
      }

      res.json({ ok: true, message: "Webhook registered successfully", url: webhookUrl, secret: endpoint.secret });
    } catch (err: any) {
      console.error("[StripeConnect] register-webhook error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to register webhook" });
    }
  });

  // ── 13. Account Balance ────────────────────────────────────────────────────────────────────────────────────
  // GET /api/stripe-connect/balance?businessOwnerId=123
  // Returns available and pending balances for the connected account.
  app.get("/api/stripe-connect/balance", async (req: Request, res: Response) => {
    try {
      const businessOwnerId = parseInt(String(req.query.businessOwnerId ?? "0"), 10);
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Stripe not connected" }); return; }

      const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId });

      // Sum all available and pending amounts (may be multi-currency)
      const available = balance.available.map((b) => ({
        amount: b.amount / 100,
        currency: b.currency.toUpperCase(),
      }));
      const pending = balance.pending.map((b) => ({
        amount: b.amount / 100,
        currency: b.currency.toUpperCase(),
      }));

      res.json({ available, pending });
    } catch (err: any) {
      console.error("[StripeConnect] balance error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to fetch balance" });
    }
  });

  // ── Transactions: recent charges + refunds ────────────────────────────────────────
  // GET /api/stripe-connect/transactions?businessOwnerId=123&limit=20
  // Returns recent balance transactions (charges, refunds, payouts) for audit trail.
  app.get("/api/stripe-connect/transactions", async (req: Request, res: Response) => {
    try {
      const businessOwnerId = parseInt(String(req.query.businessOwnerId ?? "0"), 10);
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 50);
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const accountId = (owner as any).stripeConnectAccountId as string | null;
      if (!accountId) { res.status(404).json({ error: "No Stripe account connected" }); return; }

      // Fetch recent balance transactions (includes charges, refunds, payouts, fees)
      const txList = await stripe.balanceTransactions.list(
        { limit, expand: ["data.source"] },
        { stripeAccount: accountId }
      );

      const transactions = txList.data.map((tx) => {
        const src = tx.source as any;
        // Try to extract a human-readable description
        let description = tx.description ?? "";
        if (src?.description) description = src.description;
        if (src?.metadata?.feeType) description = `${src.metadata.feeType.replace(/_/g, " ")} fee`;
        // Client name from metadata if available
        const clientName = src?.metadata?.clientName ?? src?.metadata?.client_name ?? null;
        return {
          id: tx.id,
          type: tx.type,          // "charge", "refund", "payout", "stripe_fee", etc.
          amount: tx.amount / 100, // positive = credit, negative = debit
          fee: tx.fee / 100,
          net: tx.net / 100,
          currency: tx.currency.toUpperCase(),
          status: tx.status,
          created: tx.created,    // Unix timestamp
          description,
          clientName,
          sourceId: typeof tx.source === "string" ? tx.source : src?.id ?? null,
        };
      });

      res.json({ transactions });
    } catch (err: any) {
      console.error("[StripeConnect] transactions error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to fetch transactions" });
    }
  });

  // ── 11. Create Gift Card Stripe Checkout ─────────────────────────────────
  // POST /api/stripe-connect/create-gift-checkout
  // Body: { businessOwnerId, giftCode, recipientName, items, totalAmount, currency, successUrl, cancelUrl }
  // Creates a Stripe Checkout session for a gift card purchase.
  // Platform fee (from admin panel STRIPE_PLATFORM_FEE_PERCENT) is applied as application_fee_amount.
  // The charge goes to the business owner's connected Stripe account.
  // The platform's own Stripe account is NOT used for this transaction — it only collects the fee.
  app.post("/api/stripe-connect/create-gift-checkout", async (req: Request, res: Response) => {
    try {
      const {
        businessOwnerId,
        giftCode,
        recipientName,
        items,          // [{ name, price }]
        totalAmount,    // in dollars
        currency = "usd",
        successUrl,
        cancelUrl,
      } = req.body as {
        businessOwnerId: number;
        giftCode: string;
        recipientName: string;
        items: { name: string; price: number }[];
        totalAmount: number;
        currency?: string;
        successUrl: string;
        cancelUrl: string;
      };

      if (!businessOwnerId || !giftCode || !totalAmount || !successUrl || !cancelUrl) {
        res.status(400).json({ error: "Missing required fields" }); return;
      }

      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

      const owner = await getOwner(businessOwnerId);
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }

      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up. Please complete onboarding." }); return; }

      const amountCents = Math.round(totalAmount * 100);
      // Read platform fee percentage from admin panel (e.g. STRIPE_PLATFORM_FEE_PERCENT = "1.5" means 1.5%)
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(amountCents * feePercent);

      console.log(`[StripeConnect] create-gift-checkout: giftCode=${giftCode} amount=$${totalAmount} feePercent=${(feePercent*100).toFixed(2)}% feeCents=${platformFeeCents} accountId=${accountId}`);

      // Build line items from gift items
      const lineItems: any[] = (items || []).map((item: { name: string; price: number }) => ({
        price_data: {
          currency,
          product_data: { name: item.name, description: `Gift for ${recipientName}` },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: 1,
      }));

      // Add platform processing fee as a separate line item (visible to buyer)
      if (platformFeeCents > 0) {
        lineItems.push({
          price_data: {
            currency,
            product_data: { name: "Processing Fee", description: `${(feePercent * 100).toFixed(1)}% card processing fee` },
            unit_amount: platformFeeCents,
          },
          quantity: 1,
        });
      }

      const session = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          line_items: lineItems,
          mode: "payment",
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            giftCode,
            businessOwnerId: String(businessOwnerId),
            recipientName,
            type: "gift_purchase",
          },
          payment_intent_data: {
            // Platform fee is deducted from the business owner's payout
            application_fee_amount: platformFeeCents,
            metadata: {
              giftCode,
              businessOwnerId: String(businessOwnerId),
              type: "gift_purchase",
            },
          },
        } as any,
        // Charge goes to the business owner's connected Stripe account
        // The platform's own Stripe account only receives the application_fee_amount
        { stripeAccount: accountId }
      );

      res.json({ sessionId: session.id, url: session.url });
    } catch (err: any) {
      console.error("[StripeConnect] create-gift-checkout error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create gift checkout session" });
    }
  });

  // ── Native Payment Sheet — create PaymentIntent for Stripe React Native SDK ──
  // POST /api/stripe-connect/create-payment-sheet
  // Body: { businessOwnerId, appointmentLocalId, amount, currency?, description?, clientEmail? }
  // Returns: { publishableKey, paymentIntent (client_secret), accountId }
  app.post("/api/stripe-connect/create-payment-sheet", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId, appointmentLocalId, amount, currency = "usd", description, clientEmail } = req.body as {
        businessOwnerId: number;
        appointmentLocalId: string;
        amount: number;
        currency?: string;
        description?: string;
        clientEmail?: string;
      };
      if (!businessOwnerId || !appointmentLocalId || !amount) {
        res.status(400).json({ error: "businessOwnerId, appointmentLocalId, and amount are required" }); return;
      }
      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }
      const publishableKey = await getPlatformConfig("STRIPE_PUBLISHABLE_KEY");
      if (!publishableKey) { res.status(503).json({ error: "Stripe publishable key not configured" }); return; }
      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }
      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up" }); return; }
      const amountCents = Math.round(amount * 100);
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(amountCents * feePercent);
      const totalCents = amountCents + platformFeeCents;
      console.log(`[StripeConnect] create-payment-sheet: amount=$${amount} fee=${platformFeeCents}c accountId=${accountId}`);
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency,
          payment_method_types: ["card"],
          application_fee_amount: platformFeeCents,
          description: description || "Appointment payment",
          ...(clientEmail ? { receipt_email: clientEmail } : {}),
          metadata: {
            appointmentLocalId,
            businessOwnerId: String(businessOwnerId),
          },
        },
        { stripeAccount: accountId }
      );
      // Store payment intent ID on appointment
      const db = await getDb();
      if (db) {
        await db.update(appointments)
          .set({ stripePaymentIntentId: paymentIntent.id } as any)
          .where(and(eq(appointments.localId, appointmentLocalId), eq(appointments.businessOwnerId, businessOwnerId)));
      }
      res.json({
        publishableKey,
        paymentIntent: paymentIntent.client_secret,
        accountId,
      });
    } catch (err: any) {
      console.error("[StripeConnect] create-payment-sheet error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create payment sheet" });
    }
  });

  // POST /api/stripe-connect/create-gift-payment-sheet
  // Body: { businessOwnerId, giftCode, recipientName, items, totalAmount, currency? }
  // Returns: { publishableKey, paymentIntent (client_secret), accountId }
  app.post("/api/stripe-connect/create-gift-payment-sheet", async (req: Request, res: Response) => {
    try {
      const { businessOwnerId, giftCode, recipientName, items, totalAmount, currency = "usd" } = req.body as {
        businessOwnerId: number;
        giftCode: string;
        recipientName: string;
        items: { name: string; price: number }[];
        totalAmount: number;
        currency?: string;
      };
      if (!businessOwnerId || !giftCode || !totalAmount) {
        res.status(400).json({ error: "businessOwnerId, giftCode, and totalAmount are required" }); return;
      }
      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }
      const publishableKey = await getPlatformConfig("STRIPE_PUBLISHABLE_KEY");
      if (!publishableKey) { res.status(503).json({ error: "Stripe publishable key not configured" }); return; }
      const owner = await getOwner(businessOwnerId);
      if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has not connected Stripe yet" }); return; }
      const chargesEnabled = (owner as any)?.stripeConnectEnabled as boolean | null;
      if (!chargesEnabled) { res.status(400).json({ error: "Stripe account is not yet fully set up" }); return; }
      const amountCents = Math.round(totalAmount * 100);
      const feePercent = await getPlatformFeePercent();
      const platformFeeCents = Math.round(amountCents * feePercent);
      const totalCents = amountCents + platformFeeCents;
      const description = items?.length > 0
        ? items.map((i: { name: string; price: number }) => i.name).join(", ") + (recipientName ? ` for ${recipientName}` : "")
        : `Gift Card for ${recipientName}`;
      console.log(`[StripeConnect] create-gift-payment-sheet: giftCode=${giftCode} amount=$${totalAmount} fee=${platformFeeCents}c accountId=${accountId}`);
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency,
          payment_method_types: ["card"],
          application_fee_amount: platformFeeCents,
          description,
          metadata: {
            giftCode,
            businessOwnerId: String(businessOwnerId),
            recipientName,
            type: "gift_purchase",
          },
        },
        { stripeAccount: accountId }
      );
      res.json({
        publishableKey,
        paymentIntent: paymentIntent.client_secret,
        accountId,
      });
    } catch (err: any) {
      console.error("[StripeConnect] create-gift-payment-sheet error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to create gift payment sheet" });
    }
  });

  // GET /api/stripe-connect/payment-intent-last4?appointmentId=<localId>&businessOwnerId=<id>
  // Returns the last 4 digits of the card used to pay for an appointment (for receipt display).
  app.get("/api/stripe-connect/payment-intent-last4", async (req: Request, res: Response) => {
    try {
      const { appointmentId, businessOwnerId } = req.query as { appointmentId: string; businessOwnerId: string };
      if (!appointmentId || !businessOwnerId) {
        res.status(400).json({ error: "appointmentId and businessOwnerId are required" }); return;
      }
      const stripe = await getStripe();
      if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB not available" }); return; }
      // Fetch appointment to get stripePaymentIntentId
      const apptRows = await db.select().from(appointments)
        .where(and(eq(appointments.localId, appointmentId), eq(appointments.businessOwnerId, parseInt(businessOwnerId, 10))));
      const appt = apptRows[0] as any;
      if (!appt?.stripePaymentIntentId) {
        res.json({ last4: null, brand: null }); return;
      }
      // Get the connected account ID for this business owner
      const owner = await getOwner(parseInt(businessOwnerId, 10));
      const accountId = (owner as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.json({ last4: null, brand: null }); return; }
      // Retrieve the payment intent with expanded payment method
      const pi = await stripe.paymentIntents.retrieve(
        appt.stripePaymentIntentId,
        { expand: ["payment_method"] },
        { stripeAccount: accountId }
      );
      const pm = pi.payment_method as Stripe.PaymentMethod | null;
      const last4 = (pm as any)?.card?.last4 ?? null;
      const brand = (pm as any)?.card?.brand ?? null;
      res.json({ last4, brand });
    } catch (err: any) {
      console.error("[StripeConnect] payment-intent-last4 error:", err);
      res.json({ last4: null, brand: null });
    }
  });
}
