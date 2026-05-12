# Backend Production-Readiness Audit
**Date:** May 12, 2026  
**Project:** Lime of Time (manus-scheduler)  
**Auditor:** Automated code review + manual inspection

---

## Summary

| Area | Status | Notes |
|------|--------|-------|
| Test suite | ✅ 646/647 pass | 1 pre-existing Resend key test fails (needs real key) |
| Server startup | ✅ Clean | API server starts on port 3000 |
| tRPC auth | ✅ Correct | `protectedProcedure` enforces JWT; only `logout` and public queries use `publicProcedure` |
| DB error handling | ✅ Solid | `getDb()` returns null gracefully when `DATABASE_URL` is missing |
| Stripe webhooks | ✅ All 5 events handled | `checkout.session.completed`, `subscription.deleted/updated`, `invoice.paid/payment_failed` |
| Stripe referral reward | 🔧 Fixed | Was using invalid `amount: -1` invoice item; now uses `customers.createBalanceTransaction` with correct plan amount |
| Cron jobs | ✅ All 4 running | Appointment reminders, request expiry, client reminders, renewal notifications, referral expiry |
| Email (Resend) | ✅ Graceful fallback | Silently disabled if `RESEND_API_KEY` not set |
| Push notifications | ✅ Validated | Token format checked before sending; errors caught and logged |
| Admin auth | ✅ Session-based | Cookie session with configurable `ADMIN_USERNAME`/`ADMIN_PASSWORD` |
| CORS | ⚠️ Permissive | Reflects any origin — acceptable for a mobile app API, but consider restricting to your domain in production |
| Rate limiting | ⚠️ Partial | Booking notification throttling exists; no HTTP rate limiting on auth/booking endpoints |
| Security headers | ⚠️ Missing | No `helmet` middleware — no `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` |
| SQL injection | ✅ Safe | All queries use Drizzle ORM parameterised queries; raw `sql\`\`` only used for ORDER BY with column references |

---

## Issues Fixed in This Audit

### 1. Stripe Referral Reward — Invalid Invoice Item Amount (Critical)
**File:** `server/stripeRoutes.ts` line 576  
**Problem:** The referral reward was calling `stripe.invoiceItems.create({ amount: -1 })`. Stripe's Invoice Items API does not accept negative amounts — this would throw a Stripe API error on every referral conversion, silently failing to credit the referrer.  
**Fix:** Replaced with `stripe.customers.createBalanceTransaction({ amount: -creditAmountCents })`. This correctly applies a negative customer balance that Stripe automatically deducts from the referrer's next invoice. The credit amount is dynamically calculated from the referrer's current plan price (monthly or yearly).

---

## Items Requiring Action Before Go-Live

### Required (will break production if missing)

| Item | Action Required |
|------|----------------|
| `RESEND_API_KEY` | Set in Admin Panel → Platform Config. Without this, all transactional emails (booking confirmations, subscription receipts, reminders) are silently dropped. |
| `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` | Set in Admin Panel → Platform Config → Stripe. Use live keys for production. |
| `STRIPE_WEBHOOK_SECRET` | Register your production webhook endpoint in the Stripe Dashboard (`https://your-domain.com/api/stripe/webhook`), then paste the signing secret into Admin Panel. Without this, webhook signature verification is skipped (events are still processed, but not verified). |
| `DATABASE_URL` | Must be set as an environment variable. The server silently degrades to no-DB mode if missing. |
| `JWT_SECRET` | Must be a strong random secret (32+ chars). Defaults to `"admin-session-secret"` which is insecure. |
| `ADMIN_USERNAME` + `ADMIN_PASSWORD` | Defaults to `Admin` / `Admin123$`. Change before going live. |

### Recommended (improve security/reliability)

| Item | Recommendation |
|------|---------------|
| Rate limiting | Add `express-rate-limit` on `/api/public/business/:slug/book` (booking endpoint) and `/api/auth/*` to prevent abuse. Suggest 10 req/min per IP on booking, 5 req/min on auth. |
| Security headers | Add `helmet` middleware (`npm install helmet`) in `server/_core/index.ts` to set `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, and `Referrer-Policy`. |
| CORS restriction | Consider restricting `Access-Control-Allow-Origin` to `https://lime-of-time.com` and your Expo app scheme in production, rather than reflecting any origin. |
| Twilio SMS | Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in Admin Panel for SMS reminders. Currently falls back to preview-only mode. |
| Stripe Connect | Set `STRIPE_CONNECT_SECRET_KEY` if you plan to enable business-side Stripe Connect payouts. |

### Already Production-Ready (no action needed)

- All 646 core tests pass
- Stripe subscription lifecycle (create, update, cancel, renew, payment failure) fully handled
- Referral conversion tracking end-to-end (pending → converted → rewarded)
- Push notifications with Expo token validation and error isolation
- Appointment reminders, renewal reminders, and referral expiry crons all running hourly
- Admin dashboard protected with session-based auth
- All tRPC mutations require authenticated user via `protectedProcedure`
- DB connection gracefully handles missing `DATABASE_URL`
- Email sending gracefully handles missing `RESEND_API_KEY`
- Stripe keys read from DB (Admin Panel) at request time — no restart needed to update keys

---

## Pre-Launch Checklist

- [ ] Set `RESEND_API_KEY` in Admin Panel
- [ ] Set `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` (live keys) in Admin Panel
- [ ] Register Stripe webhook endpoint and set `STRIPE_WEBHOOK_SECRET` in Admin Panel
- [ ] Change `ADMIN_USERNAME` and `ADMIN_PASSWORD` from defaults
- [ ] Set a strong `JWT_SECRET` environment variable
- [ ] Verify `DATABASE_URL` is set in production environment
- [ ] (Optional) Add `express-rate-limit` on booking and auth endpoints
- [ ] (Optional) Add `helmet` for security headers
- [ ] (Optional) Set Twilio credentials for SMS reminders
- [ ] Test a full Stripe checkout flow in test mode before switching to live keys
- [ ] Register Expo push notification credentials for production builds
