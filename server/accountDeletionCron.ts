/**
 * Account Deletion Cron
 *
 * Runs once per day and permanently deletes any business accounts
 * whose 30-day grace period has expired (deletionScheduledFor <= now).
 *
 * For each expired account it:
 *  1. Sends an admin notification email before deletion
 *  2. Calls deleteBusinessOwner() which handles image cleanup + DB cascade
 *  3. Logs the result
 */
import { getDb } from "./db";
import * as db from "./db";
import { businessOwners } from "../drizzle/schema";
import { and, isNotNull, lte } from "drizzle-orm";
import { sendAdminDeletionAlertEmail } from "./email";

async function processExpiredDeletions() {
  const drizzle = await getDb();
  if (!drizzle) return;

  const now = new Date();

  try {
    // Find all accounts whose grace period has expired
    const expired = await drizzle
      .select({
        id: businessOwners.id,
        businessName: businessOwners.businessName,
        ownerName: businessOwners.ownerName,
        email: businessOwners.email,
        phone: businessOwners.phone,
        deletionScheduledFor: businessOwners.deletionScheduledFor,
      })
      .from(businessOwners)
      .where(
        and(
          isNotNull(businessOwners.pendingDeletionAt),
          isNotNull(businessOwners.deletionScheduledFor),
          lte(businessOwners.deletionScheduledFor, now),
        )
      );

    if (expired.length === 0) {
      console.log("[DeletionCron] No expired accounts to delete.");
      return;
    }

    console.log(`[DeletionCron] Found ${expired.length} account(s) to permanently delete.`);

    for (const owner of expired) {
      try {
        console.log(`[DeletionCron] Deleting account ${owner.id} (${owner.businessName}) — grace period expired on ${owner.deletionScheduledFor?.toISOString()}`);

        // Notify admin before deletion (data will be gone after)
        await sendAdminDeletionAlertEmail({
          businessName: owner.businessName,
          ownerName: owner.ownerName ?? null,
          email: owner.email ?? null,
          phone: owner.phone,
          businessOwnerId: owner.id,
          action: "completed",
        });

        // Execute full deletion (images + DB cascade)
        await db.deleteBusinessOwner(owner.id);

        console.log(`[DeletionCron] ✅ Successfully deleted account ${owner.id} (${owner.businessName})`);
      } catch (err) {
        console.error(`[DeletionCron] ❌ Failed to delete account ${owner.id} (${owner.businessName}):`, err);
      }
    }
  } catch (err) {
    console.error("[DeletionCron] Error querying expired accounts:", err);
  }
}

/**
 * Start the account deletion cron.
 * Runs once per day; executes permanent deletion for expired grace periods.
 */
export function startAccountDeletionCron() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  console.log("[DeletionCron] Started — checking daily for expired account deletions");

  // Run immediately on startup to catch any missed deletions
  processExpiredDeletions().catch(console.error);

  // Then run every 24 hours
  setInterval(() => {
    processExpiredDeletions().catch(console.error);
  }, INTERVAL_MS);
}
