import "server-only";

import { after } from "next/server";

import { db } from "@/lib/db/client";
import { emailTransport } from "@/lib/email/server";
import { env } from "@/lib/env/server";

import { logEmail } from "./log";
import { processDueEmails, type EmailDeps } from "./outbox";

/** The outbox wired to the configured transport. */
export const emailDeps: EmailDeps = {
  db,
  transport: emailTransport,
  siteUrl: env.siteUrl,
};

/**
 * Sends an order's due emails after the response has been sent, so a
 * webhook (or, from Milestone 12, an admin action) never waits for the mail
 * provider. If this fails or the process dies, the scheduled run retries.
 */
export function sendOrderEmailsAfterResponse(orderId: string): void {
  after(async () => {
    try {
      await processDueEmails(emailDeps, { orderId, limit: 5 });
    } catch (error) {
      logEmail("error", "immediate email dispatch failed", { orderId, error });
    }
  });
}
