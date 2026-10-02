import type { PrismaClient } from "@/generated/prisma/client";
import type { CheckoutResponse } from "@/lib/checkout/checkout";
import { checkoutRequestSchema } from "@/lib/checkout/request-schema";
import {
  CHECKOUT_RATE_LIMIT,
  clientIp,
  clientKey,
  consumeRateLimit,
  rateLimitKey,
} from "@/server/security/rate-limit";

import { createCheckout, logCheckoutError } from "./create-checkout";
import type { CheckoutGateway } from "./gateway";

/** 50 lines of JSON stay far below this. */
export const MAX_CHECKOUT_BODY_BYTES = 16 * 1024;

export type CheckoutHandlerDeps = {
  db: PrismaClient;
  /** Null when payments are not configured. */
  gateway: CheckoutGateway | null;
  siteUrl: string;
  /** Keys the HMAC of client IPs in rate-limit counters. */
  secret: string;
  now?: () => Date;
};

const noStore = { "Cache-Control": "no-store" };

function respond(
  body: CheckoutResponse,
  status: number,
  headers: Record<string, string> = {},
) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

/**
 * POST /api/checkout. Order of checks: same origin (CSRF), rate limit,
 * bounded body, schema; only then the database work. Errors never reveal
 * internals: the browser gets a code, the server log gets the details.
 */
export async function handleCheckoutRequest(
  request: Request,
  deps: CheckoutHandlerDeps,
): Promise<Response> {
  // CSRF defence: browsers always send Origin on POST. The endpoint uses no
  // cookies, but it reserves stock, so cross-site pages must not trigger it.
  if (request.headers.get("origin") !== new URL(deps.siteUrl).origin) {
    return respond({ ok: false, code: "invalid_request" }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return respond({ ok: false, code: "invalid_request" }, 415);
  }

  const now = (deps.now ?? (() => new Date()))();
  const ip = clientIp(request.headers);
  const limit = await consumeRateLimit(
    deps.db,
    CHECKOUT_RATE_LIMIT,
    rateLimitKey(CHECKOUT_RATE_LIMIT, ip, deps.secret),
    now,
  );
  if (!limit.allowed) {
    return respond({ ok: false, code: "rate_limited" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const text = await readLimitedText(request, MAX_CHECKOUT_BODY_BYTES);
  if (text === null) {
    return respond({ ok: false, code: "invalid_request" }, 413);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return respond({ ok: false, code: "invalid_request" }, 400);
  }
  const parsed = checkoutRequestSchema.safeParse(json);
  if (!parsed.success) {
    return respond({ ok: false, code: "invalid_request" }, 400);
  }

  if (!deps.gateway) {
    console.error("[checkout] payments are not configured");
    return respond({ ok: false, code: "payment_unavailable" }, 503);
  }

  try {
    const outcome = await createCheckout(
      {
        db: deps.db,
        gateway: deps.gateway,
        siteUrl: deps.siteUrl,
        now: () => now,
      },
      parsed.data,
      { clientKey: clientKey(ip, deps.secret) },
    );
    if (outcome.ok) return respond({ ok: true, url: outcome.url }, 200);
    switch (outcome.code) {
      case "rejected":
      case "attempt_closed":
        return respond(outcome, 409);
      case "hold_limit":
        // Ends when one of the client's holds is paid, expires (at most
        // about 55 minutes) or is superseded.
        return respond(outcome, 429, { "Retry-After": "300" });
      case "busy":
        return respond(outcome, 503, { "Retry-After": "2" });
      default:
        return respond(outcome, 503);
    }
  } catch (error) {
    logCheckoutError("unexpected failure", error);
    return respond({ ok: false, code: "payment_unavailable" }, 500);
  }
}

async function readLimitedText(
  request: Request,
  limit: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
