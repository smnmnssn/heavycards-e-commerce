import { timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { releaseExpiredReservations } from "@/server/checkout/cleanup";
import type { CheckoutGateway } from "@/server/checkout/gateway";
import { logEmail } from "@/server/email/log";
import { runEmailJobs, type EmailDeps } from "@/server/email/outbox";

import { logPayment } from "./log";
import { reconcileCheckouts } from "./reconcile";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in
 * constant time; without a configured secret every call is refused, so the
 * route is never open to the public.
 */
export function isAuthorizedCronRequest(
  request: Request,
  cronSecret: string | null,
): boolean {
  if (!cronSecret) return false;
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * GET /api/cron/reconcile-checkouts: the scheduled run. It coordinates two
 * independent steps, each in its own error boundary:
 *
 * 1. payments: reconcile unresolved Stripe checkouts and release lapsed
 *    provisional holds (src/server/payments/reconcile.ts);
 * 2. emails (when configured): enqueue missing order confirmations and
 *    dispatch due or retryable emails (src/server/email/outbox.ts).
 *
 * Payments run first, so orders they finalize get their confirmation in the
 * same run. Neither step can stop the other: a mail-provider outage only
 * leaves emails pending, and a failed payment step still lets due emails go.
 */
export async function handleReconcileRequest(
  request: Request,
  deps: {
    db: PrismaClient;
    gateway: CheckoutGateway | null;
    cronSecret: string | null;
    revalidate?: (productSlugs: string[]) => void;
    now?: () => Date;
    email?: EmailDeps;
  },
): Promise<Response> {
  if (!isAuthorizedCronRequest(request, deps.cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body: Record<string, unknown> = {};
  let failed = false;

  if (deps.gateway) {
    try {
      const summary = await reconcileCheckouts({
        db: deps.db,
        gateway: deps.gateway,
        now: deps.now,
      });
      const released = await releaseExpiredReservations(
        deps.db,
        (deps.now ?? (() => new Date()))(),
      );
      deps.revalidate?.(summary.productSlugs);
      Object.assign(body, {
        checked: summary.checked,
        outcomes: summary.outcomes,
        provisionalReleased: released,
      });
    } catch (error) {
      logPayment("error", "reconciliation run failed", { error });
      body.error = "failed";
      failed = true;
    }
  } else {
    body.error = "not_configured";
  }

  if (deps.email) {
    try {
      body.emails = await runEmailJobs(deps.email);
    } catch (error) {
      logEmail("error", "scheduled email run failed", { error });
      body.emails = { error: "failed" };
      failed = true;
    }
  }

  const status = !deps.gateway ? 503 : failed ? 500 : 200;
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
