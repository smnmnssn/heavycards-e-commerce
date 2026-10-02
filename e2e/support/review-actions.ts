/**
 * Staff actions for the review E2E tests, run through the real domain
 * services as a fast path that keeps those tests about the customer's side
 * (the admin screens themselves are covered by admin-operations.spec.ts):
 *
 *   ship <orderId> <siteUrl>      NEW → PROCESSING → SHIPPED, then send the
 *                                 order's due emails with the file transport
 *                                 (what the admin action does after the
 *                                 response)
 *   moderate <reviewId> <APPROVE|REJECT>
 *
 * Started by e2e/review-fixtures.ts as
 *   node --conditions=react-server --import tsx e2e/support/review-actions.ts …
 * (the condition lets `server-only` modules load outside Next.js). Acts as
 * the seeded OWNER and uses the test server's AUTH_SECRET, so links it
 * renders are the ones the server accepts. Never run against production.
 */
import { existsSync } from "node:fs";

import { createEmailTransport } from "@/lib/email/transport";
import { createPrismaClient } from "@/lib/db/create-client";
import { deriveReviewLinkKey } from "@/server/domain/review-token";
import { processDueEmails } from "@/server/email/outbox";
import { transitionFulfillment } from "@/server/orders/fulfillment";
import { moderateReview } from "@/server/reviews/moderation";

import { EMAIL_OUTBOX_DIR, SEEDED_OWNER } from "../admin-helpers";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const { DATABASE_URL, AUTH_SECRET } = process.env;
if (!DATABASE_URL || !AUTH_SECRET) {
  throw new Error("DATABASE_URL and AUTH_SECRET are required");
}

const db = createPrismaClient(DATABASE_URL);
const reviewLinkKey = deriveReviewLinkKey(AUTH_SECRET);

async function main([command, id, arg]: string[]): Promise<unknown> {
  const owner = await db.adminUser.findUniqueOrThrow({
    where: { email: SEEDED_OWNER },
  });
  switch (command) {
    case "ship": {
      const results = [];
      for (const to of ["PROCESSING", "SHIPPED"]) {
        results.push(
          await transitionFulfillment(db, {
            actorId: owner.id,
            input: { orderId: id, to, trackingNumber: "RR123456785SE" },
            reviewLinkKey,
          }),
        );
      }
      const emails = await processDueEmails(
        {
          db,
          transport: createEmailTransport(
            {
              transport: "file",
              from: "HeavyCards <order@heavycards.invalid>",
              outboxDir: EMAIL_OUTBOX_DIR,
            },
            { production: false },
          ),
          siteUrl: arg!,
          reviewLinkKey,
        },
        { orderId: id },
      );
      return { results, emails };
    }
    case "moderate":
      return moderateReview(db, {
        actorId: owner.id,
        input: { reviewId: id, decision: arg },
      });
    default:
      throw new Error(`unknown command ${command}`);
  }
}

main(process.argv.slice(2))
  .then((result) => console.log(JSON.stringify(result)))
  .finally(() => db.$disconnect());
