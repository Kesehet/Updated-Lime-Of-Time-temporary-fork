import { Express, Request, Response } from "express";
import { getDb } from "./db";
import { businessOwners } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import { getPlatformConfig, setTwilioTestModeFlag } from "./subscription";
import { isAuthenticated } from "./adminRoutes";

function requireAdminAuth(req: Request, res: Response): boolean {
  if (!isAuthenticated(req)) { res.redirect("/api/admin/login"); return false; }
  return true;
}

export function registerAdminStripeConnectRoutes(app: Express): void {
  // ── Stripe Connect Overview ─────────────────────────────────────────
  app.get("/api/admin/stripe-connect", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(500).send("DB unavailable"); return; }

      const allBiz = await dbase.select().from(businessOwners).orderBy(sql`${businessOwners.createdAt} DESC`);
      const platformFee = await getPlatformConfig("STRIPE_PLATFORM_FEE_PERCENT") || "1.5";
      const stripeMode = await getPlatformConfig("STRIPE_TEST_MODE");
      const isTestMode = stripeMode === "true" || stripeMode === "1";

      // Read current Stripe key to detect test/live mismatch
      const stripeKey = await getPlatformConfig("STRIPE_SECRET_KEY") || "";
      const keyPrefix = stripeKey.startsWith("sk_test_") ? "test" : stripeKey.startsWith("sk_live_") ? "live" : stripeKey ? "unknown" : "unset";
      const keyMismatch = (isTestMode && keyPrefix === "live") || (!isTestMode && keyPrefix === "test");
      // Mask key for display: show first 12 chars + ...
      const keyMasked = stripeKey ? stripeKey.slice(0, 12) + "..." : "(not set)";

      const connected = allBiz.filter((b: any) => b.stripeConnectAccountId);
      const enabled = allBiz.filter((b: any) => b.stripeConnectEnabled);
      const pending = allBiz.filter((b: any) => b.stripeConnectAccountId && !b.stripeConnectEnabled);

      const serverDomain = `${req.protocol}://${req.get('host')}`;
      res.send(stripeConnectPage({
        businesses: allBiz,
        connected,
        enabled,
        pending,
        platformFee,
        isTestMode,
        serverDomain,
        keyPrefix,
        keyMismatch,
        keyMasked,
      }));
    } catch (err) {
      console.error("[Admin] Stripe Connect error:", err);
      res.status(500).send("Failed to load Stripe Connect data");
    }
  });

  // ── Update Platform Fee ─────────────────────────────────────────────
  app.post("/api/admin/stripe-connect/platform-fee", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const { fee } = req.body;
      const feeNum = parseFloat(fee);
      if (isNaN(feeNum) || feeNum < 0 || feeNum > 20) {
        res.status(400).json({ error: "Fee must be between 0 and 20%" });
        return;
      }
      const dbase = await getDb();
      if (!dbase) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const existing = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_PLATFORM_FEE_PERCENT"));
      if (existing.length > 0) {
        await dbase.update(platformConfig).set({ configValue: String(feeNum), updatedAt: new Date() }).where(eq(platformConfig.configKey, "STRIPE_PLATFORM_FEE_PERCENT"));
      } else {
        await dbase.insert(platformConfig).values({ configKey: "STRIPE_PLATFORM_FEE_PERCENT", configValue: String(feeNum) });
      }
      res.redirect("/api/admin/stripe-connect?saved=1");
    } catch (err) {
      console.error("[Admin] Update platform fee error:", err);
      res.status(500).json({ error: "Failed to update fee" });
    }
  });

  // ── Toggle Stripe Test/Live Mode ────────────────────────────────
  app.post("/api/admin/stripe-connect/toggle-test-mode", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const current = await getPlatformConfig("STRIPE_TEST_MODE");
      const isCurrentlyTest = current === "true" || current === "1";
      const newValue = isCurrentlyTest ? "false" : "true";
      const existing = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_TEST_MODE"));
      if (existing.length > 0) {
        await dbase.update(platformConfig).set({ configValue: newValue, updatedAt: new Date() }).where(eq(platformConfig.configKey, "STRIPE_TEST_MODE"));
      } else {
        await dbase.insert(platformConfig).values({ configKey: "STRIPE_TEST_MODE", configValue: newValue });
      }
      const mode = newValue === "true" ? "test" : "live";
      console.log(`[Admin] Stripe mode switched to: ${mode}`);
      res.json({ ok: true, isTestMode: newValue === "true", mode });
    } catch (err: any) {
      console.error("[Admin] Toggle test mode error:", err);
      res.status(500).json({ error: err?.message || "Failed to toggle mode" });
    }
  });

  // ── Test Fee: create a $1.00 test checkout session to verify fee flow ─
  app.post("/api/admin/stripe-connect/test-fee", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const { businessOwnerId } = req.body;
      if (!businessOwnerId) { res.status(400).json({ error: "businessOwnerId required" }); return; }
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ error: "DB unavailable" }); return; }
      const { eq } = await import("drizzle-orm");
      const rows = await dbase.select().from(businessOwners).where(eq(businessOwners.id, parseInt(businessOwnerId))).limit(1);
      const biz = rows[0];
      const accountId = (biz as any)?.stripeConnectAccountId as string | null;
      if (!accountId) { res.status(400).json({ error: "Business has no Stripe account connected" }); return; }
      const stripeKey = await getPlatformConfig("STRIPE_SECRET_KEY");
      if (!stripeKey) { res.status(503).json({ error: "Stripe not configured — set STRIPE_SECRET_KEY in Platform Config" }); return; }
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" as any });
      const rawFee = await getPlatformConfig("STRIPE_PLATFORM_FEE_PERCENT");
      const feePercent = rawFee ? parseFloat(rawFee) : 1.5;
      const amountCents = 100; // $1.00 test charge
      const feeCents = Math.round(amountCents * feePercent / 100);
      const origin = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: "Platform Fee Test — $1.00", description: `Verifying ${feePercent}% fee (${feeCents}¢) flows to platform account` },
            unit_amount: amountCents,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${origin}/api/admin/stripe-connect?test_fee=success`,
        cancel_url: `${origin}/api/admin/stripe-connect?test_fee=cancelled`,
        payment_intent_data: {
          application_fee_amount: feeCents,
          description: `[ADMIN TEST] Platform fee verification — ${feePercent}%`,
        },
      }, { stripeAccount: accountId });
      res.json({ ok: true, url: session.url, feeCents, feePercent, amountCents });
    } catch (err: any) {
      console.error("[Admin] Test fee error:", err);
      res.status(500).json({ error: err?.message || "Test fee failed" });
    }
  });

  // ── Fee Revenue Dashboard: list application fees by month ─────────────
  app.get("/api/admin/stripe-connect/fee-revenue", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const stripeKey = await getPlatformConfig("STRIPE_SECRET_KEY");
      if (!stripeKey) { res.status(503).json({ error: "Stripe not configured" }); return; }
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" as any });
      // Fetch up to 100 most recent application fees
      const fees = await stripe.applicationFees.list({ limit: 100 });
      // Group by month
      const byMonth: Record<string, { count: number; totalCents: number }> = {};
      for (const fee of fees.data) {
        const d = new Date(fee.created * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!byMonth[key]) byMonth[key] = { count: 0, totalCents: 0 };
        byMonth[key].count++;
        byMonth[key].totalCents += fee.amount;
      }
      const months = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([month, v]) => ({
        month,
        count: v.count,
        totalDollars: (v.totalCents / 100).toFixed(2),
      }));
      const totalAllTime = fees.data.reduce((s, f) => s + f.amount, 0);
      res.json({ ok: true, months, totalAllTimeDollars: (totalAllTime / 100).toFixed(2), hasMore: fees.has_more });
    } catch (err: any) {
      console.error("[Admin] Fee revenue error:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch fee revenue" });
    }
  });

  // ── Update Stripe Secret Key inline ─────────────────────────────
  app.post("/api/admin/stripe-connect/update-key", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const { key } = req.body;
      if (!key || typeof key !== "string") { res.status(400).json({ error: "key required" }); return; }
      const trimmed = key.trim();
      if (!trimmed.startsWith("sk_test_") && !trimmed.startsWith("sk_live_")) {
        res.status(400).json({ error: "Invalid Stripe key. Must start with sk_test_ or sk_live_" }); return;
      }
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const existing = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_SECRET_KEY"));
      if (existing.length > 0) {
        await dbase.update(platformConfig).set({ configValue: trimmed, updatedAt: new Date() }).where(eq(platformConfig.configKey, "STRIPE_SECRET_KEY"));
      } else {
        await dbase.insert(platformConfig).values({ configKey: "STRIPE_SECRET_KEY", configValue: trimmed });
      }
      const prefix = trimmed.startsWith("sk_test_") ? "test" : "live";
      console.log(`[Admin] Stripe key updated to ${prefix} key`);
      res.json({ ok: true, prefix });
    } catch (err: any) {
      console.error("[Admin] Update Stripe key error:", err);
      res.status(500).json({ error: err?.message || "Failed to update key" });
    }
  });

  // ── Webhook Health Check ──────────────────────────────────────────
  app.get("/api/admin/stripe-connect/webhook-health", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // Check webhook secret is stored
      const secretRow = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_CONNECT_WEBHOOK_SECRET"));
      const webhookSecret = secretRow[0]?.configValue || "";
      const hasSecret = webhookSecret.startsWith("whsec_");

      // Check Stripe key is available to query webhooks
      const keyRow = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_SECRET_KEY"));
      const stripeKey = keyRow[0]?.configValue || "";
      if (!stripeKey) {
        res.json({ ok: false, hasSecret, webhookRegistered: false, webhookUrl: null, error: "Stripe key not configured" });
        return;
      }

      // Query Stripe for registered webhooks
      const r = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=20", {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      const json = await r.json() as any;
      if (!r.ok) {
        res.json({ ok: false, hasSecret, webhookRegistered: false, webhookUrl: null, error: json?.error?.message || `Stripe error ${r.status}` });
        return;
      }

      const endpoints: any[] = json.data || [];
      const match = endpoints.find((e: any) => e.url && e.url.includes("/api/stripe-connect/webhook"));
      const webhookRegistered = !!match;
      const webhookUrl = match?.url || null;
      const webhookStatus = match?.status || null;
      const webhookEvents: string[] = match?.enabled_events || [];
      const hasCheckoutEvent = webhookEvents.includes("checkout.session.completed") || webhookEvents.includes("*");

      res.json({
        ok: webhookRegistered && hasSecret && hasCheckoutEvent,
        hasSecret,
        webhookRegistered,
        webhookUrl,
        webhookStatus,
        hasCheckoutEvent,
        totalEndpoints: endpoints.length,
      });
    } catch (err: any) {
      console.error("[Admin] Webhook health check error:", err);
      res.status(500).json({ ok: false, error: err?.message || "Health check failed" });
    }
  });

  // ── Disconnect a business from Stripe Connect ───────────────────────
  app.post("/api/admin/stripe-connect/:id/disconnect", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const dbase = await getDb();
      if (!dbase) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { eq } = await import("drizzle-orm");
      await dbase.update(businessOwners).set({
        stripeConnectAccountId: null,
        stripeConnectEnabled: false,
        stripeConnectOnboardingComplete: false,
      } as any).where(eq(businessOwners.id, id));
      res.redirect("/api/admin/stripe-connect?disconnected=1");
    } catch (err) {
      console.error("[Admin] Disconnect Stripe error:", err);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  // ── Auto-register Stripe webhook endpoints ──────────────────────────
  // POST /api/admin/stripe/register-webhooks
  // Registers both /api/stripe/webhook and /api/stripe-connect/webhook with
  // Stripe and saves the returned signing secrets to the DB automatically.
  app.post("/api/admin/stripe/register-webhooks", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // Determine server URL: from body, DB config, or request origin
      const bodyUrl = ((req.body?.serverUrl as string) || "").trim().replace(/\/$/, "");
      let serverUrl = bodyUrl;
      if (!serverUrl) {
        const row = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "SERVER_URL")).limit(1);
        serverUrl = (row[0]?.configValue || "").trim().replace(/\/$/, "");
      }
      if (!serverUrl) {
        serverUrl = `${req.protocol}://${req.get("host")}`;
      }

      // Save SERVER_URL to DB if provided via body
      if (bodyUrl) {
        const existingUrl = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "SERVER_URL")).limit(1);
        if (existingUrl.length > 0) {
          await dbase.update(platformConfig).set({ configValue: bodyUrl, updatedAt: new Date() }).where(eq(platformConfig.configKey, "SERVER_URL"));
        } else {
          await dbase.insert(platformConfig).values({ configKey: "SERVER_URL", configValue: bodyUrl, isSensitive: false, description: "Public server URL for Stripe webhook registration" });
        }
      }

      // Get the active Stripe secret key
      const isTestMode = (await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_TEST_MODE")).limit(1))[0]?.configValue === "true";
      const keyConfigKey = isTestMode ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_SECRET_KEY";
      const stripeKeyRow = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, keyConfigKey)).limit(1);
      const stripeKey = stripeKeyRow[0]?.configValue || "";
      if (!stripeKey || !stripeKey.startsWith("sk_")) {
        res.status(400).json({ error: `Stripe ${isTestMode ? "test" : "live"} secret key is not configured. Please save a valid key first.` });
        return;
      }

      // Define both webhook endpoints to register
      const webhooksToRegister = [
        {
          url: `${serverUrl}/api/stripe/webhook`,
          events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"],
          secretConfigKey: isTestMode ? "STRIPE_TEST_WEBHOOK_SECRET" : "STRIPE_WEBHOOK_SECRET",
          label: "Subscription Webhook (/api/stripe/webhook)",
        },
        {
          url: `${serverUrl}/api/stripe-connect/webhook`,
          events: ["checkout.session.completed", "payment_intent.succeeded", "payment_intent.payment_failed", "account.updated"],
          secretConfigKey: isTestMode ? "STRIPE_CONNECT_TEST_WEBHOOK_SECRET" : "STRIPE_CONNECT_WEBHOOK_SECRET",
          label: "Connect Webhook (/api/stripe-connect/webhook)",
        },
      ];

      const results: Array<{ endpoint: string; status: string; webhookId?: string; secretSaved?: boolean; error?: string }> = [];

      for (const wh of webhooksToRegister) {
        try {
          // Check if this URL is already registered
          const listResp = await fetch(`https://api.stripe.com/v1/webhook_endpoints?limit=100`, {
            headers: { Authorization: `Bearer ${stripeKey}` },
          });
          const listJson = await listResp.json() as any;
          if (!listResp.ok) throw new Error(listJson?.error?.message || `Stripe list error ${listResp.status}`);
          const existingEndpoint = (listJson.data || []).find((e: any) => e.url === wh.url);

          if (existingEndpoint) {
            // Update existing endpoint events
            const updateBody = new URLSearchParams();
            wh.events.forEach((e) => updateBody.append("enabled_events[]", e));
            const updateResp = await fetch(`https://api.stripe.com/v1/webhook_endpoints/${existingEndpoint.id}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: updateBody.toString(),
            });
            const updateJson = await updateResp.json() as any;
            if (!updateResp.ok) throw new Error(updateJson?.error?.message || `Update failed: ${updateResp.status}`);
            results.push({ endpoint: wh.label, status: "updated (events refreshed)", webhookId: existingEndpoint.id, secretSaved: false });
          } else {
            // Create new endpoint
            const createBody = new URLSearchParams();
            createBody.append("url", wh.url);
            wh.events.forEach((e) => createBody.append("enabled_events[]", e));
            const createResp = await fetch("https://api.stripe.com/v1/webhook_endpoints", {
              method: "POST",
              headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: createBody.toString(),
            });
            const createJson = await createResp.json() as any;
            if (!createResp.ok) throw new Error(createJson?.error?.message || `Create failed: ${createResp.status}`);
            const webhookId = createJson.id;
            const secret: string = createJson.secret || "";

            // Save the signing secret to DB
            let secretSaved = false;
            if (secret) {
              const existingRow = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, wh.secretConfigKey)).limit(1);
              if (existingRow.length > 0) {
                await dbase.update(platformConfig).set({ configValue: secret, updatedAt: new Date() }).where(eq(platformConfig.configKey, wh.secretConfigKey));
              } else {
                await dbase.insert(platformConfig).values({ configKey: wh.secretConfigKey, configValue: secret, isSensitive: true, description: `Stripe webhook signing secret for ${wh.label}` });
              }
              secretSaved = true;
            }
            results.push({ endpoint: wh.label, status: "created", webhookId, secretSaved });
          }
        } catch (whErr: any) {
          results.push({ endpoint: wh.label, status: "error", error: whErr?.message || "Unknown error" });
        }
      }

      const allOk = results.every((r) => r.status !== "error");
      console.log(`[Admin] Webhook registration complete for ${serverUrl}:`, results);
      res.json({
        ok: allOk,
        serverUrl,
        isTestMode,
        results,
        message: allOk
          ? `Webhook endpoints registered successfully for ${serverUrl}`
          : `Some endpoints failed — check results`,
      });
    } catch (err: any) {
      console.error("[Admin] Register webhooks error:", err);
      res.status(500).json({ ok: false, error: err?.message || "Registration failed" });
    }
  });

  // ── One-click Stripe mode toggle ──────────────────────────────────────
  // POST /api/admin/stripe/toggle-mode
  // Atomically swaps STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_WEBHOOK_SECRET
  // to point to either the live or test key values, and sets STRIPE_TEST_MODE.
  app.post("/api/admin/stripe/toggle-mode", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ ok: false, error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { invalidateConfigCache } = await import("./subscription");

      const targetMode = (req.body?.mode as string || "").toLowerCase();
      if (targetMode !== "live" && targetMode !== "test") {
        res.status(400).json({ ok: false, error: "mode must be 'live' or 'test'" }); return;
      }

      // Read all relevant config rows
      const allRows = await dbase.select().from(platformConfig);
      const cfgMap: Record<string, string> = {};
      for (const row of allRows) {
        cfgMap[row.configKey] = row.configValue || "";
      }

      // Determine source keys based on target mode
      const isLive = targetMode === "live";
      const srcSecretKey = isLive ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY";
      const srcPublishableKey = isLive ? "STRIPE_LIVE_PUBLISHABLE_KEY" : "STRIPE_TEST_PUBLISHABLE_KEY";
      const srcWebhookSecret = isLive ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_TEST_WEBHOOK_SECRET";

      const newSecretKey = cfgMap[srcSecretKey] || "";
      const newPublishableKey = cfgMap[srcPublishableKey] || "";
      const newWebhookSecret = cfgMap[srcWebhookSecret] || "";

      if (!newSecretKey) {
        res.status(400).json({ ok: false, error: `${srcSecretKey} is not set. Please save the ${targetMode} secret key first.` }); return;
      }

      // Upsert helper
      const upsert = async (key: string, value: string, sensitive: boolean, desc: string) => {
        const existing = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, key)).limit(1);
        if (existing.length > 0) {
          await dbase.update(platformConfig).set({ configValue: value }).where(eq(platformConfig.configKey, key));
        } else {
          await dbase.insert(platformConfig).values({ configKey: key, configValue: value, isSensitive: sensitive, description: desc });
        }
      };

      // Swap active keys
      await upsert("STRIPE_SECRET_KEY", newSecretKey, true, "Stripe Secret Key (active)");
      await upsert("STRIPE_PUBLISHABLE_KEY", newPublishableKey, false, "Stripe Publishable Key (active)");
      if (newWebhookSecret) {
        await upsert("STRIPE_WEBHOOK_SECRET", newWebhookSecret, true, "Stripe Webhook Secret (active)");
      }
      await upsert("STRIPE_TEST_MODE", isLive ? "false" : "true", false, "Stripe Test Mode (true/false)");

      // Invalidate all Stripe-related cache entries
      invalidateConfigCache("STRIPE_SECRET_KEY");
      invalidateConfigCache("STRIPE_PUBLISHABLE_KEY");
      invalidateConfigCache("STRIPE_WEBHOOK_SECRET");
      invalidateConfigCache("STRIPE_TEST_MODE");

      const sessionId = req.cookies?.session_id || "";
      console.log(`[Admin] Stripe mode switched to ${targetMode.toUpperCase()} by ${sessionId || "admin"}`);

      res.json({
        ok: true,
        mode: targetMode,
        message: `Switched to ${targetMode.toUpperCase()} mode. Active keys updated.`,
        secretKeyPrefix: newSecretKey.substring(0, 10) + "...",
        publishableKeyPrefix: newPublishableKey.substring(0, 10) + "...",
        webhookSecretSet: !!newWebhookSecret,
      });
    } catch (err: any) {
      console.error("[Admin] Stripe toggle-mode error:", err);
      res.status(500).json({ ok: false, error: err?.message || "Toggle failed" });
    }
  });

  // POST /api/admin/twilio/toggle-mode
  // Atomically swaps TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID / TWILIO_FROM_NUMBER
  // to point to either the live or test credential values, and sets TWILIO_TEST_MODE.
  app.post("/api/admin/twilio/toggle-mode", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ ok: false, error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { invalidateConfigCache } = await import("./subscription");

      const targetMode = (req.body?.mode as string || "").toLowerCase();
      if (targetMode !== "live" && targetMode !== "test") {
        res.status(400).json({ ok: false, error: "mode must be 'live' or 'test'" }); return;
      }

      // Read all relevant config rows
      const allRows = await dbase.select().from(platformConfig);
      const cfgMap: Record<string, string> = {};
      for (const row of allRows) {
        cfgMap[row.configKey] = row.configValue || "";
      }

      // Determine source keys based on target mode
      const isLive = targetMode === "live";
      const srcAccountSid = isLive ? "TWILIO_LIVE_ACCOUNT_SID" : "TWILIO_TEST_ACCOUNT_SID";
      const srcAuthToken = isLive ? "TWILIO_LIVE_AUTH_TOKEN" : "TWILIO_TEST_AUTH_TOKEN";
      const srcVerifySid = isLive ? "TWILIO_LIVE_VERIFY_SERVICE_SID" : "TWILIO_TEST_VERIFY_SERVICE_SID";
      const srcFromNumber = isLive ? "TWILIO_LIVE_FROM_NUMBER" : "TWILIO_TEST_FROM_NUMBER";

      const newAccountSid = cfgMap[srcAccountSid] || "";
      const newAuthToken = cfgMap[srcAuthToken] || "";
      const newVerifySid = cfgMap[srcVerifySid] || "";
      const newFromNumber = cfgMap[srcFromNumber] || "";

      if (!newAccountSid) {
        res.status(400).json({ ok: false, error: `${srcAccountSid} is not set. Please save the ${targetMode} Account SID first.` }); return;
      }

      // Upsert helper
      const upsert = async (key: string, value: string, sensitive: boolean, desc: string) => {
        const existing = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, key)).limit(1);
        if (existing.length > 0) {
          await dbase.update(platformConfig).set({ configValue: value }).where(eq(platformConfig.configKey, key));
        } else {
          await dbase.insert(platformConfig).values({ configKey: key, configValue: value, isSensitive: sensitive, description: desc });
        }
      };

      // Swap active credentials
      await upsert("TWILIO_ACCOUNT_SID", newAccountSid, true, "Twilio Account SID (active)");
      await upsert("TWILIO_AUTH_TOKEN", newAuthToken, true, "Twilio Auth Token (active)");
      if (newVerifySid) {
        await upsert("TWILIO_VERIFY_SERVICE_SID", newVerifySid, true, "Twilio Verify Service SID (active)");
      }
      if (newFromNumber) {
        await upsert("TWILIO_FROM_NUMBER", newFromNumber, false, "Twilio From Phone Number (active)");
      }
      await upsert("TWILIO_TEST_MODE", isLive ? "false" : "true", false, "Twilio Test Mode (true/false)");
      // Invalidate config cache and update in-memory test mode flag immediately
      invalidateConfigCache("TWILIO_ACCOUNT_SID");
      invalidateConfigCache("TWILIO_AUTH_TOKEN");
      invalidateConfigCache("TWILIO_VERIFY_SERVICE_SID");
      invalidateConfigCache("TWILIO_FROM_NUMBER");
      invalidateConfigCache("TWILIO_TEST_MODE");
      setTwilioTestModeFlag(!isLive); // update in-memory flag immediately (no DB round-trip on next OTP send)

      const sessionId = req.cookies?.session_id || "";
      console.log(`[Admin] Twilio mode switched to ${targetMode.toUpperCase()} by ${sessionId || "admin"}`);

      res.json({
        ok: true,
        mode: targetMode,
        message: `Switched to ${targetMode.toUpperCase()} mode. Active Twilio credentials updated.`,
        accountSidPrefix: newAccountSid.substring(0, 6) + "...",
        fromNumber: newFromNumber,
      });
    } catch (err: any) {
      console.error("[Admin] Twilio toggle-mode error:", err);
      res.status(500).json({ ok: false, error: err?.message || "Toggle failed" });
    }
  });

  // GET /api/admin/stripe/test-live
  // Tests STRIPE_LIVE_SECRET_KEY by calling Stripe balance API
  app.get("/api/admin/stripe/test-live", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ ok: false, error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const keyRow = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_LIVE_SECRET_KEY")).limit(1);
      const secretKey = keyRow[0]?.configValue || "";
      if (!secretKey || !secretKey.startsWith("sk_live_")) {
        res.json({ ok: false, message: "Live Secret Key not configured (must start with sk_live_)" }); return;
      }
      const stripeRes = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (stripeRes.ok) {
        const data = await stripeRes.json() as any;
        const available = data.available?.[0];
        const balanceStr = available ? `Balance: ${(available.amount / 100).toFixed(2)} ${available.currency.toUpperCase()}` : "Balance retrieved";
        res.json({ ok: true, message: `Connected (Live Mode) - ${balanceStr}` });
      } else {
        const errData = await stripeRes.json().catch(() => ({})) as any;
        res.json({ ok: false, message: errData?.error?.message || `HTTP ${stripeRes.status}` });
      }
    } catch (err: any) {
      res.json({ ok: false, message: err?.message || "Unknown error" });
    }
  });

  // GET /api/admin/stripe/test-test
  // Tests STRIPE_TEST_SECRET_KEY by calling Stripe balance API
  app.get("/api/admin/stripe/test-test", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ ok: false, error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const keyRow = await dbase.select().from(platformConfig).where(eq(platformConfig.configKey, "STRIPE_TEST_SECRET_KEY")).limit(1);
      const secretKey = keyRow[0]?.configValue || "";
      if (!secretKey || !secretKey.startsWith("sk_test_")) {
        res.json({ ok: false, message: "Test Secret Key not configured (must start with sk_test_)" }); return;
      }
      const stripeRes = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (stripeRes.ok) {
        const data = await stripeRes.json() as any;
        const available = data.available?.[0];
        const balanceStr = available ? `Balance: ${(available.amount / 100).toFixed(2)} ${available.currency.toUpperCase()}` : "Balance retrieved";
        res.json({ ok: true, message: `Connected (Test Mode) - ${balanceStr}` });
      } else {
        const errData = await stripeRes.json().catch(() => ({})) as any;
        res.json({ ok: false, message: errData?.error?.message || `HTTP ${stripeRes.status}` });
      }
    } catch (err: any) {
      res.json({ ok: false, message: err?.message || "Unknown error" });
    }
  });

  // GET /api/admin/stripe/test-webhook-live
  // Tests live webhook by listing Stripe live webhook endpoints
  app.get("/api/admin/stripe/test-webhook-live", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ ok: false, error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const allRows = await dbase.select().from(platformConfig);
      const cfgMap: Record<string, string> = {};
      for (const row of allRows) cfgMap[row.configKey] = row.configValue || "";
      const secretKey = cfgMap["STRIPE_LIVE_SECRET_KEY"] || "";
      const webhookSecret = cfgMap["STRIPE_LIVE_WEBHOOK_SECRET"] || "";
      if (!secretKey.startsWith("sk_live_")) {
        res.json({ ok: false, message: "Live Secret Key not configured" }); return;
      }
      const hasWebhookSecret = webhookSecret.startsWith("whsec_");
      const r = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=20", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as any;
        res.json({ ok: false, message: e?.error?.message || `Stripe error ${r.status}` }); return;
      }
      const json = await r.json() as any;
      const endpoints: any[] = json.data || [];
      const registered = endpoints.filter((e: any) => e.url && (e.url.includes("/api/stripe/webhook") || e.url.includes("/api/stripe-connect/webhook")));
      res.json({
        ok: registered.length > 0 && hasWebhookSecret,
        message: registered.length > 0
          ? `Live webhooks OK - ${registered.length} endpoint(s) registered${hasWebhookSecret ? ", secret stored" : ", WARNING: no live webhook secret stored"}`
          : `No live webhooks registered yet (${endpoints.length} total endpoints on Stripe)`,
        endpoints: registered.map((e: any) => ({ url: e.url, status: e.status })),
        hasWebhookSecret,
      });
    } catch (err: any) {
      res.json({ ok: false, message: err?.message || "Unknown error" });
    }
  });

  // GET /api/admin/stripe/test-webhook-test
  // Tests test webhook by listing Stripe test webhook endpoints
  app.get("/api/admin/stripe/test-webhook-test", async (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const dbase = await getDb();
      if (!dbase) { res.status(503).json({ ok: false, error: "DB unavailable" }); return; }
      const { platformConfig } = await import("../drizzle/schema");
      const allRows = await dbase.select().from(platformConfig);
      const cfgMap: Record<string, string> = {};
      for (const row of allRows) cfgMap[row.configKey] = row.configValue || "";
      const secretKey = cfgMap["STRIPE_TEST_SECRET_KEY"] || "";
      const webhookSecret = cfgMap["STRIPE_TEST_WEBHOOK_SECRET"] || "";
      if (!secretKey.startsWith("sk_test_")) {
        res.json({ ok: false, message: "Test Secret Key not configured" }); return;
      }
      const hasWebhookSecret = webhookSecret.startsWith("whsec_");
      const r = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=20", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as any;
        res.json({ ok: false, message: e?.error?.message || `Stripe error ${r.status}` }); return;
      }
      const json = await r.json() as any;
      const endpoints: any[] = json.data || [];
      const registered = endpoints.filter((e: any) => e.url && (e.url.includes("/api/stripe/webhook") || e.url.includes("/api/stripe-connect/webhook")));
      res.json({
        ok: registered.length > 0 && hasWebhookSecret,
        message: registered.length > 0
          ? `Test webhooks OK - ${registered.length} endpoint(s) registered${hasWebhookSecret ? ", secret stored" : ", WARNING: no test webhook secret stored"}`
          : `No test webhooks registered yet (${endpoints.length} total endpoints on Stripe)`,
        endpoints: registered.map((e: any) => ({ url: e.url, status: e.status })),
        hasWebhookSecret,
      });
    } catch (err: any) {
      res.json({ ok: false, message: err?.message || "Unknown error" });
    }
  });
}

function stripeConnectPage(data: {
  businesses: any[];
  connected: any[];
  enabled: any[];
  pending: any[];
  platformFee: string;
  isTestMode: boolean;
  serverDomain: string;
  keyPrefix: string;
  keyMismatch: boolean;
  keyMasked: string;
}): string {
  const { businesses, connected, enabled, pending, platformFee, isTestMode, serverDomain, keyPrefix, keyMismatch, keyMasked } = data;

  const rows = businesses.map((b: any) => {
    const hasAccount = !!b.stripeConnectAccountId;
    const isEnabled = !!b.stripeConnectEnabled;
    const isComplete = !!b.stripeConnectOnboardingComplete;
    let statusBadge = `<span style="background:#374151;color:#9ca3af;padding:2px 8px;border-radius:12px;font-size:11px;">Not Connected</span>`;
    if (hasAccount && isEnabled) {
      statusBadge = `<span style="background:#14532d;color:#4ade80;padding:2px 8px;border-radius:12px;font-size:11px;">✓ Active</span>`;
    } else if (hasAccount && !isEnabled) {
      statusBadge = `<span style="background:#78350f;color:#fbbf24;padding:2px 8px;border-radius:12px;font-size:11px;">⏳ Pending</span>`;
    }
    const accountId = b.stripeConnectAccountId ? `<code style="font-size:11px;color:#9ca3af;">${b.stripeConnectAccountId}</code>` : `<span style="color:#4b5563;font-size:11px;">—</span>`;
    const disconnectBtn = hasAccount
      ? `<form method="POST" action="/api/admin/stripe-connect/${b.id}/disconnect" style="display:inline;" onsubmit="return confirm('Disconnect Stripe for ${b.businessName}?')"><button type="submit" style="background:#7f1d1d;color:#fca5a5;border:none;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Disconnect</button></form>`
      : '';
    return `<tr style="border-bottom:1px solid #1f2937;">
      <td style="padding:10px 12px;"><a href="/api/admin/businesses/${b.id}" style="color:#60a5fa;font-size:13px;">${escHtml(b.businessName || 'Unnamed')}</a></td>
      <td style="padding:10px 12px;font-size:12px;color:#9ca3af;">${escHtml(b.email || '')}</td>
      <td style="padding:10px 12px;">${statusBadge}</td>
      <td style="padding:10px 12px;">${accountId}</td>
      <td style="padding:10px 12px;">${disconnectBtn}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stripe Connect — Admin</title>
  <style>
    :root { --bg:#0f1117;--bg-card:#1a1d27;--border:#2a2d3a;--text:#e4e6eb;--text-muted:#8b8fa3;--primary:#4a8c3f; }
    * { margin:0;padding:0;box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex; }
    .sidebar { width:220px;min-height:100vh;background:var(--bg-card);border-right:1px solid var(--border);display:flex;flex-direction:column;padding-top:16px;flex-shrink:0; }
    .sidebar-logo { padding:12px 20px 20px;font-size:18px;font-weight:700;color:var(--primary); }
    .nav-item { display:flex;align-items:center;gap:10px;padding:10px 20px;color:var(--text-muted);font-size:14px;transition:all 0.15s;cursor:pointer;text-decoration:none; }
    .nav-item:hover { background:#242736;color:var(--text); }
    .nav-item.active { background:#242736;color:var(--primary);border-right:3px solid var(--primary); }
    .nav-section { padding:12px 20px 4px;font-size:10px;font-weight:700;color:#4b5563;letter-spacing:.08em;text-transform:uppercase; }
    .main { flex:1;padding:32px;overflow-y:auto; }
    h1 { font-size:22px;font-weight:700;margin-bottom:4px; }
    .subtitle { color:var(--text-muted);font-size:14px;margin-bottom:28px; }
    .stat-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:28px; }
    .stat-card { background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px; }
    .stat-value { font-size:28px;font-weight:700;margin-bottom:4px; }
    .stat-label { font-size:12px;color:var(--text-muted); }
    .card { background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px; }
    .card h2 { font-size:15px;font-weight:600;margin-bottom:16px; }
    table { width:100%;border-collapse:collapse; }
    th { text-align:left;padding:8px 12px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border); }
    input[type=number] { background:#111827;border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:8px;font-size:14px;width:100px; }
    button[type=submit] { background:var(--primary);color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer;margin-left:10px; }
    .badge-test { background:#1e3a5f;color:#60a5fa;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:8px; }
    .badge-live { background:#14532d;color:#4ade80;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:8px; }
    .alert { padding:10px 16px;border-radius:8px;font-size:13px;margin-bottom:20px; }
    .alert-success { background:#14532d;color:#4ade80;border:1px solid #166534; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-logo" style="display:flex;align-items:center;gap:10px;"><img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png" alt="Lime Of Time" style="width:32px;height:32px;border-radius:0;object-fit:contain;background:transparent;" /><span>Admin</span></div>
    <a href="/api/admin" class="nav-item">📊 Dashboard</a>
    <div class="nav-section">BUSINESSES</div>
    <a href="/api/admin/businesses" class="nav-item">🏢 Businesses</a>
    <a href="/api/admin/clients" class="nav-item">👥 Clients</a>
    <a href="/api/admin/appointments" class="nav-item">📅 Appointments</a>
    <div class="nav-section">ANALYTICS</div>
    <a href="/api/admin/analytics" class="nav-item">📈 Analytics</a>
    <a href="/api/admin/financial" class="nav-item">💰 Financial</a>
    <div class="nav-section">SAAS</div>
    <a href="/api/admin/subscriptions" class="nav-item">💳 Subscriptions</a>
    <a href="/api/admin/plans" class="nav-item">📋 Plan Pricing</a>
    <a href="/api/admin/stripe-connect" class="nav-item active">💳 Stripe Connect</a>
    <div class="nav-section">SYSTEM</div>
    <a href="/api/admin/platform-config" class="nav-item">🔧 Platform Config</a>
    <a href="/api/admin/settings" class="nav-item">⚙️ Settings</a>
    <div style="margin-top:auto;padding:20px;border-top:1px solid var(--border);">
      <a href="/api/admin/logout" class="nav-item" style="color:#ef4444;">🚪 Logout</a>
    </div>
  </div>
  <div class="main">
    <h1>Stripe Connect <span class="${isTestMode ? 'badge-test' : 'badge-live'}">${isTestMode ? 'TEST MODE' : 'LIVE MODE'}</span></h1>
    <div class="subtitle">Manage business owner Stripe Connect accounts and platform fee settings.</div>

    <!-- Test Mode Warning Banner -->
    ${isTestMode ? `
    <div id="testModeBanner" style="background:#1e3a5f;border:2px solid #3b82f6;border-radius:12px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:24px;">🧪</span>
        <div>
          <div style="font-weight:700;font-size:15px;color:#93c5fd;">TEST MODE ACTIVE</div>
          <div style="font-size:12px;color:#60a5fa;margin-top:2px;">No real charges will be processed. Use Stripe test cards (e.g. 4242 4242 4242 4242). Switch to Live Mode before accepting real payments.</div>
        </div>
      </div>
      <button onclick="toggleStripeMode()" id="modeToggleBtn" style="background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Switch to Live Mode</button>
    </div>` : `
    <div id="testModeBanner" style="background:#0a1a0a;border:1.5px solid #166534;border-radius:12px;padding:14px 20px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:20px;">✅</span>
        <div>
          <div style="font-weight:700;font-size:14px;color:#4ade80;">LIVE MODE — Real payments enabled</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Clients will be charged real money. Switch to Test Mode to run tests without real charges.</div>
        </div>
      </div>
      <button onclick="toggleStripeMode()" id="modeToggleBtn" style="background:#1f2937;color:#9ca3af;border:1px solid #374151;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap;">Switch to Test Mode</button>
    </div>`}

    ${data.businesses.length === 0 || (data.connected.length === 0 && data.pending.length === 0) ? '' : ''}

    <!-- Stats -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value" style="color:#4ade80;">${enabled.length}</div>
        <div class="stat-label">Active Accounts</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#fbbf24;">${pending.length}</div>
        <div class="stat-label">Pending Onboarding</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#9ca3af;">${businesses.length - connected.length}</div>
        <div class="stat-label">Not Connected</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#60a5fa;">${platformFee}%</div>
        <div class="stat-label">Platform Fee</div>
      </div>
    </div>

    <!-- Platform Fee Setting -->
    <div class="card">
      <h2>💰 Platform Application Fee</h2>
      <p style="font-size:13px;color:#9ca3af;margin-bottom:16px;">This percentage is deducted from each card payment as a platform fee. Currently set to <strong style="color:#e4e6eb;">${platformFee}%</strong>.</p>
      <form method="POST" action="/api/admin/stripe-connect/platform-fee" style="display:flex;align-items:center;gap:0;">
        <input type="number" name="fee" value="${platformFee}" min="0" max="20" step="0.1" required>
        <span style="margin:0 8px;color:#9ca3af;font-size:14px;">%</span>
        <button type="submit">Save</button>
      </form>
    </div>

    <!-- Stripe Key Status + Inline Switcher -->
    <div class="card" style="border:1px solid ${keyMismatch ? '#ef444440' : '#374151'};background:${keyMismatch ? '#450a0a' : 'var(--bg-card)'}">
      <h2 style="color:${keyMismatch ? '#f87171' : '#e4e6eb'};">🔑 Stripe Secret Key</h2>
      ${keyMismatch ? `
      <div style="background:#7f1d1d;border:1.5px solid #ef4444;border-radius:10px;padding:12px 16px;margin-bottom:14px;">
        <div style="font-weight:700;font-size:14px;color:#fca5a5;">⚠️ KEY MISMATCH DETECTED</div>
        <div style="font-size:12px;color:#fca5a5;margin-top:4px;">You are in <strong>${isTestMode ? 'TEST' : 'LIVE'} mode</strong> but your key is a <strong>${keyPrefix.toUpperCase()} key</strong> (<code style="background:#450a0a;padding:1px 5px;border-radius:3px;">${escHtml(keyMasked)}</code>). All Stripe charges will fail silently until you update the key below.</div>
      </div>` : `
      <p style="font-size:13px;color:#9ca3af;margin-bottom:14px;">Current key: <code style="background:#111827;padding:2px 8px;border-radius:6px;color:${keyPrefix === 'test' ? '#60a5fa' : keyPrefix === 'live' ? '#4ade80' : '#f87171'};">${escHtml(keyMasked)}</code> <span style="font-size:11px;color:${keyPrefix === 'test' ? '#60a5fa' : keyPrefix === 'live' ? '#4ade80' : '#f87171'};">${keyPrefix === 'test' ? '(test key — matches test mode ✅)' : keyPrefix === 'live' ? '(live key — matches live mode ✅)' : keyPrefix === 'unset' ? '(not set — Stripe features disabled)' : '(unrecognized format)'}</span></p>`}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input type="password" id="stripeKeyInput" placeholder="sk_test_... or sk_live_..." style="background:#111827;border:1px solid #374151;color:#e4e6eb;padding:8px 12px;border-radius:8px;font-size:13px;width:340px;font-family:monospace;" autocomplete="off">
        <button onclick="updateStripeKey()" id="updateKeyBtn" style="background:${keyMismatch ? '#ef4444' : '#374151'};color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;">${keyMismatch ? '🔑 Fix Key Now' : '🔑 Update Key'}</button>
        <span id="updateKeyResult" style="font-size:13px;"></span>
      </div>
      <div style="font-size:11px;color:#4b5563;margin-top:8px;">Key is stored encrypted in the database. Never share your secret key. Get keys from <a href="https://dashboard.stripe.com/apikeys" target="_blank" style="color:#60a5fa;">Stripe Dashboard → API Keys</a>.</div>
    </div>

    <!-- Business Accounts Table -->
    <div class="card">
      <h2>🏢 Business Connect Accounts (${businesses.length} total)</h2>
      <table>
        <thead>
          <tr>
            <th>Business</th>
            <th>Email</th>
            <th>Status</th>
            <th>Stripe Account ID</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" style="padding:20px;text-align:center;color:#4b5563;">No businesses found</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Test Fee Button -->
    <div class="card" id="testFeeCard" style="border:1px solid #7c3aed40;background:#7c3aed08;">
      <h2 style="color:#a78bfa;">🧪 Test Platform Fee Flow</h2>
      <p style="font-size:13px;color:#9ca3af;margin-bottom:14px;">Create a real $1.00 Stripe Checkout session against a connected business account to verify the <strong style="color:#e4e6eb;">${platformFee}% application fee</strong> is correctly flowing to your platform account. Use Stripe test cards (e.g. <code style="background:#2a2a3e;padding:1px 5px;border-radius:3px;color:#a5f3fc;">4242 4242 4242 4242</code>) in test mode.</p>
      ${enabled.length === 0 ? '<p style="color:#f87171;font-size:13px;">⚠️ No active Stripe accounts found. Connect at least one business first.</p>' : `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <select id="testFeeSelect" style="background:#111827;border:1px solid #374151;color:#e4e6eb;padding:8px 12px;border-radius:8px;font-size:14px;">
          ${enabled.map((b: any) => `<option value="${b.id}">${escHtml(b.businessName || 'Unnamed')}</option>`).join('')}
        </select>
        <button onclick="runTestFee()" id="testFeeBtn" style="background:#7c3aed;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer;">🧪 Run Test ($1.00)</button>
        <span id="testFeeResult" style="font-size:13px;"></span>
      </div>`}
    </div>

    <!-- Fee Revenue Dashboard -->
    <div class="card" id="feeRevenueCard">
      <h2>💵 Platform Fee Revenue</h2>
      <p style="font-size:13px;color:#9ca3af;margin-bottom:14px;">Application fees collected from all connected business accounts, grouped by month. <span id="feeRevTotal" style="color:#4ade80;"></span></p>
      <div id="feeRevContent" style="font-size:13px;color:#9ca3af;">Loading...</div>
      <button onclick="loadFeeRevenue()" style="margin-top:12px;background:#1f2937;color:#9ca3af;border:1px solid #374151;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;">🔄 Refresh</button>
    </div>

    <!-- Webhook Setup Guide -->
    <div class="card" style="border:1px solid #f59e0b40;background:#f59e0b08;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h2 style="color:#f59e0b;margin-bottom:0;">⚡ Webhook Setup</h2>
        <span id="webhookHealthBadge" style="font-size:12px;padding:4px 12px;border-radius:20px;background:#1f2937;color:#9ca3af;">Checking...</span>
      </div>
      <!-- Health check status rows -->
      <div id="webhookHealthRows" style="background:#111827;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;display:none;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span id="hc1">⏳</span> <span>Webhook endpoint registered in Stripe</span></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span id="hc2">⏳</span> <span>Webhook signing secret (whsec_...) saved in Platform Config</span></div>
        <div style="display:flex;align-items:center;gap:8px;"><span id="hc3">⏳</span> <span>checkout.session.completed event enabled</span></div>
        <div id="hcUrl" style="margin-top:10px;font-size:11px;color:#4b5563;"></div>
        <div id="hcError" style="margin-top:8px;font-size:12px;color:#f87171;"></div>
      </div>
      <p style="font-size:13px;color:#9ca3af;margin-bottom:14px;">Register your webhook endpoint with Stripe so card payments are confirmed automatically — even if the client closes the browser before being redirected back.</p>
      <div style="background:#1a1a2e;border-radius:8px;padding:14px;margin-bottom:14px;font-family:monospace;font-size:12px;color:#a5f3fc;word-break:break-all;">
        ${serverDomain}/api/stripe-connect/webhook
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button onclick="registerWebhook()" id="registerWebhookBtn"
          style="background:#f59e0b;color:#1a1a2e;padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
          🔗 Register Webhook Automatically
        </button>
        <span id="webhookRegResult" style="font-size:13px;"></span>
      </div>
      <div style="font-size:12px;color:#6b7280;border-top:1px solid #f59e0b20;padding-top:12px;">
        <strong style="color:#9ca3af;">Manual option:</strong> Go to <a href="https://dashboard.stripe.com/webhooks" target="_blank" style="color:#60a5fa;">Stripe Dashboard → Webhooks</a>, add the URL above, select <code style="background:#2a2a3e;padding:1px 5px;border-radius:3px;color:#a5f3fc;">checkout.session.completed</code> event, then paste the signing secret into <a href="/api/admin/platform-config" style="color:#60a5fa;">Platform Config → STRIPE_CONNECT_WEBHOOK_SECRET</a>.
      </div>
    </div>
    <script>
    function runTestFee() {
      var btn = document.getElementById('testFeeBtn');
      var result = document.getElementById('testFeeResult');
      var select = document.getElementById('testFeeSelect');
      if (!select) return;
      btn.disabled = true;
      btn.textContent = 'Creating session...';
      result.textContent = '';
      fetch('/api/admin/stripe-connect/test-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessOwnerId: select.value })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok && d.url) {
          result.style.color = '#4ade80';
          result.innerHTML = '✅ Session created! Fee: <strong>' + d.feePercent + '% = ' + d.feeCents + '¢</strong>. <a href="' + d.url + '" target="_blank" style="color:#60a5fa;">Open Checkout →</a>';
          btn.textContent = '🧪 Run Test ($1.00)';
          btn.disabled = false;
        } else {
          result.style.color = '#f87171';
          result.textContent = '❌ ' + (d.error || 'Failed');
          btn.textContent = '🧪 Run Test ($1.00)';
          btn.disabled = false;
        }
      })
      .catch(function(e) {
        result.style.color = '#f87171';
        result.textContent = '❌ Network error: ' + e.message;
        btn.textContent = '🧪 Run Test ($1.00)';
        btn.disabled = false;
      });
    }

    function loadFeeRevenue() {
      var content = document.getElementById('feeRevContent');
      var total = document.getElementById('feeRevTotal');
      content.textContent = 'Loading...';
      fetch('/api/admin/stripe-connect/fee-revenue')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok) { content.innerHTML = '<span style="color:#f87171;">❌ ' + (d.error || 'Failed') + '</span>'; return; }
        total.textContent = 'All-time total: $' + d.totalAllTimeDollars + (d.hasMore ? ' (showing last 100)' : '');
        if (!d.months.length) { content.innerHTML = '<span style="color:#6b7280;">No application fees recorded yet.</span>'; return; }
        var html = '<table style="width:100%;border-collapse:collapse;">';
        html += '<thead><tr><th style="text-align:left;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #1f2937;">Month</th><th style="text-align:right;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #1f2937;">Transactions</th><th style="text-align:right;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #1f2937;">Revenue</th></tr></thead><tbody>';
        d.months.forEach(function(m) {
          html += '<tr style="border-bottom:1px solid #1f2937;"><td style="padding:8px 10px;color:#e4e6eb;">' + m.month + '</td><td style="padding:8px 10px;text-align:right;color:#9ca3af;">' + m.count + '</td><td style="padding:8px 10px;text-align:right;color:#4ade80;font-weight:600;">$' + m.totalDollars + '</td></tr>';
        });
        html += '</tbody></table>';
        content.innerHTML = html;
      })
      .catch(function(e) { content.innerHTML = '<span style="color:#f87171;">❌ Network error: ' + e.message + '</span>'; });
    }

    // Auto-load fee revenue on page load
    window.addEventListener('DOMContentLoaded', function() { loadFeeRevenue(); });

    function updateStripeKey() {
      var input = document.getElementById('stripeKeyInput');
      var btn = document.getElementById('updateKeyBtn');
      var result = document.getElementById('updateKeyResult');
      var key = input.value.trim();
      if (!key) { result.innerHTML = '<span style="color:#f87171;">Please enter a key</span>'; return; }
      if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_')) {
        result.innerHTML = '<span style="color:#f87171;">Key must start with sk_test_ or sk_live_</span>'; return;
      }
      btn.disabled = true;
      btn.textContent = 'Saving...';
      result.innerHTML = '';
      fetch('/api/admin/stripe-connect/update-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          result.innerHTML = '<span style="color:#4ade80;">\u2705 Key saved (' + d.prefix + '). Reloading...</span>';
          setTimeout(function() { window.location.reload(); }, 1200);
        } else {
          result.innerHTML = '<span style="color:#f87171;">\u274c ' + (d.error || 'Failed') + '</span>';
          btn.disabled = false;
          btn.textContent = '\ud83d\udd11 Update Key';
        }
      })
      .catch(function(e) {
        result.innerHTML = '<span style="color:#f87171;">\u274c Network error: ' + e.message + '</span>';
        btn.disabled = false;
        btn.textContent = '\ud83d\udd11 Update Key';
      });
    }

    function toggleStripeMode() {
      var btn = document.getElementById('modeToggleBtn');
      var banner = document.getElementById('testModeBanner');
      var isTest = btn.textContent.indexOf('Live') !== -1; // currently test, switching to live
      var confirmMsg = isTest
        ? '⚠️ Switch to LIVE MODE? Real card charges will be processed. Make sure your live Stripe keys are configured.'
        : '🧪 Switch to TEST MODE? No real charges will be processed. Use Stripe test cards only.';
      if (!confirm(confirmMsg)) return;
      btn.disabled = true;
      btn.textContent = 'Switching...';
      fetch('/api/admin/stripe-connect/toggle-test-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          // Reload page to reflect new mode everywhere
          window.location.reload();
        } else {
          alert('❌ Failed to switch mode: ' + (d.error || 'Unknown error'));
          btn.disabled = false;
          btn.textContent = isTest ? 'Switch to Live Mode' : 'Switch to Test Mode';
        }
      })
      .catch(function(e) {
        alert('❌ Network error: ' + e.message);
        btn.disabled = false;
        btn.textContent = isTest ? 'Switch to Live Mode' : 'Switch to Test Mode';
      });
    }

    function checkWebhookHealth() {
      var badge = document.getElementById('webhookHealthBadge');
      var rows = document.getElementById('webhookHealthRows');
      var hc1 = document.getElementById('hc1');
      var hc2 = document.getElementById('hc2');
      var hc3 = document.getElementById('hc3');
      var hcUrl = document.getElementById('hcUrl');
      var hcError = document.getElementById('hcError');
      badge.textContent = 'Checking...';
      badge.style.background = '#1f2937';
      badge.style.color = '#9ca3af';
      fetch('/api/admin/stripe-connect/webhook-health')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          rows.style.display = 'block';
          hc1.textContent = d.webhookRegistered ? '\u2705' : '\u274c';
          hc2.textContent = d.hasSecret ? '\u2705' : '\u274c';
          hc3.textContent = d.hasCheckoutEvent ? '\u2705' : (d.webhookRegistered ? '\u274c' : '\u2796');
          hcUrl.textContent = d.webhookUrl ? '\ud83d\udd17 Registered URL: ' + d.webhookUrl + (d.webhookStatus ? ' (' + d.webhookStatus + ')' : '') : '';
          hcError.textContent = d.error ? d.error : '';
          if (d.ok) {
            badge.textContent = '\u2705 Fully Configured';
            badge.style.background = '#14532d';
            badge.style.color = '#4ade80';
          } else if (d.webhookRegistered || d.hasSecret) {
            badge.textContent = '\u26a0\ufe0f Partial Setup';
            badge.style.background = '#78350f';
            badge.style.color = '#fbbf24';
          } else {
            badge.textContent = '\u274c Not Configured';
            badge.style.background = '#7f1d1d';
            badge.style.color = '#fca5a5';
          }
        })
        .catch(function(e) {
          badge.textContent = '\u26a0\ufe0f Check failed';
          badge.style.background = '#78350f';
          badge.style.color = '#fbbf24';
          rows.style.display = 'block';
          hcError.textContent = 'Error: ' + e.message;
        });
    }
    // Auto-load on page open
    checkWebhookHealth();
    loadFeeRevenue();

    function registerWebhook() {
      var btn = document.getElementById('registerWebhookBtn');
      var result = document.getElementById('webhookRegResult');
      btn.disabled = true;
      btn.textContent = 'Registering...';
      result.textContent = '';
      fetch('/api/admin/stripe-connect/register-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverDomain: window.location.host })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          result.style.color = '#4ade80';
          result.textContent = d.alreadyExists ? '✅ Already registered' : '✅ Registered! Signing secret saved automatically.';
          btn.textContent = '✅ Done';
          // Auto-refresh health check so badge updates immediately
          setTimeout(function() { checkWebhookHealth(); }, 800);
        } else {
          result.style.color = '#f87171';
          result.textContent = '❌ ' + (d.error || 'Failed');
          btn.disabled = false;
          btn.textContent = '🔗 Register Webhook Automatically';
        }
      })
      .catch(function(e) {
        result.style.color = '#f87171';
        result.textContent = '❌ Network error: ' + e.message;
        btn.disabled = false;
        btn.textContent = '🔗 Register Webhook Automatically';
      });
    }
    </script>

    <!-- How It Works -->
    <div class="card">
      <h2>ℹ️ How Stripe Connect Works</h2>
      <div style="font-size:13px;color:#9ca3af;line-height:1.7;">
        <p style="margin-bottom:8px;">1. Business owners go to <strong style="color:#e4e6eb;">Settings → Payment Methods → Accept Card Payments</strong> in the app and tap <strong style="color:#e4e6eb;">Connect with Stripe</strong>.</p>
        <p style="margin-bottom:8px;">2. They complete Stripe Express onboarding (takes ~2 minutes). Stripe verifies their identity and bank account.</p>
        <p style="margin-bottom:8px;">3. Once approved, their status shows <strong style="color:#4ade80;">Active</strong> here and a <strong style="color:#e4e6eb;">💳 Pay by Card</strong> option appears on their client booking page.</p>
        <p style="margin-bottom:8px;">4. When a client pays by card, Stripe charges the client, deducts the platform fee (${platformFee}%), and deposits the remainder directly to the business owner's bank account.</p>
        <p>5. Business owners can view their Stripe dashboard, payouts, and disputes from the app under Settings → Payment Methods.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
