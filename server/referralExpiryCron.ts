/**
 * Referral Code Expiry Reminder Cron
 *
 * Runs every hour and sends a push notification to business owners
 * whose referral code expires in exactly 7 days (within a 1-hour window).
 *
 * The 1-hour window ensures the notification fires once per code, not
 * repeatedly on every cron tick.
 */
import { getDb } from "./db";
import { referralCodes, businessOwners } from "../drizzle/schema";
import { and, eq, isNotNull, isNotNull as _isNotNull } from "drizzle-orm";
import { sendExpoPush } from "./push";

async function sendReferralExpiryReminders() {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  // 7-day window: codes expiring between now+7d and now+7d+1h
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(sevenDaysFromNow.getTime() + 60 * 60 * 1000);

  try {
    // Fetch all active referral codes that have an expiry date set
    const codes = await db
      .select({
        id: referralCodes.id,
        code: referralCodes.code,
        businessOwnerId: referralCodes.businessOwnerId,
        expiresAt: (referralCodes as any).expiresAt,
        isActive: referralCodes.isActive,
      })
      .from(referralCodes)
      .where(
        and(
          eq(referralCodes.isActive, true),
          isNotNull((referralCodes as any).expiresAt),
        )
      );

    let notified = 0;

    for (const rc of codes) {
      if (!rc.expiresAt) continue;
      const expiresAt = new Date(rc.expiresAt);

      // Only notify if expiry falls within the 7-day window
      if (expiresAt >= sevenDaysFromNow && expiresAt < windowEnd) {
        // Fetch the business owner's push token
        const ownerRows = await db
          .select({
            id: businessOwners.id,
            businessName: businessOwners.businessName,
            expoPushToken: businessOwners.expoPushToken,
          })
          .from(businessOwners)
          .where(eq(businessOwners.id, rc.businessOwnerId))
          .limit(1);

        const owner = ownerRows[0] as any;
        if (!owner?.expoPushToken) continue;

        const expiryLabel = expiresAt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        const sent = await sendExpoPush(owner.expoPushToken, {
          title: "⏰ Referral Code Expiring Soon",
          body: `Your referral code ${rc.code} expires on ${expiryLabel}. Share it now to earn a free month!`,
          data: { type: "general", screen: "referrals" },
          sound: "default",
        });

        if (sent) {
          notified++;
          console.log(
            `[ReferralExpiryCron] Notified owner ${owner.id} (${owner.businessName}) — code ${rc.code} expires ${expiryLabel}`
          );
        }
      }
    }

    if (notified > 0) {
      console.log(`[ReferralExpiryCron] Sent ${notified} expiry reminder(s)`);
    }
  } catch (err) {
    console.error("[ReferralExpiryCron] Error sending expiry reminders:", err);
  }
}

/**
 * Start the referral expiry reminder cron.
 * Runs every hour; checks for codes expiring in 7 days.
 */
export function startReferralExpiryCron() {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  console.log("[ReferralExpiryCron] Started — checking every hour for 7-day expiry reminders");

  // Run immediately on startup
  sendReferralExpiryReminders().catch(console.error);

  // Then run every hour
  setInterval(() => {
    sendReferralExpiryReminders().catch(console.error);
  }, INTERVAL_MS);
}
