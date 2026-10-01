import { timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { releaseExpiredReservations } from "@/server/checkout/cleanup";
import type { CheckoutGateway } from "@/server/checkout/gateway";

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

/** GET /api/cron/reconcile-checkouts */
export async function handleReconcileRequest(
  request: Request,
  deps: {
    db: PrismaClient;
    gateway: CheckoutGateway | null;
    cronSecret: string | null;
    revalidate?: (productSlugs: string[]) => void;
    now?: () => Date;
  },
): Promise<Response> {
  if (!isAuthorizedCronRequest(request, deps.cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!deps.gateway) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
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
    return Response.json(
      {
        checked: summary.checked,
        outcomes: summary.outcomes,
        provisionalReleased: released,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logPayment("error", "reconciliation run failed", { error });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
