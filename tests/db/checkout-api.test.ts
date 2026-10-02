import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeCheckoutGateway } from "@/server/checkout/fake-gateway";
import {
  handleCheckoutRequest,
  MAX_CHECKOUT_BODY_BYTES,
  type CheckoutHandlerDeps,
} from "@/server/checkout/handle-request";
import {
  CHECKOUT_RATE_LIMIT,
  consumeRateLimit,
  pruneRateLimits,
  rateLimitKey,
} from "@/server/security/rate-limit";

import { createProduct } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const SITE = "http://localhost:3100";
const SECRET = "db-test-secret-0123456789abcdefghij";

let gateway: FakeCheckoutGateway;
let deps: CheckoutHandlerDeps;

beforeEach(async () => {
  await resetDatabase(db);
  await db.storeSettings.create({
    data: {
      id: 1,
      storeName: "HeavyCards",
      contactEmail: "kundservice@example.com",
      shippingPriceAmount: 7_900,
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
    },
  });
  gateway = new FakeCheckoutGateway();
  deps = { db, gateway, siteUrl: SITE, secret: SECRET };
});
afterAll(() => db.$disconnect());

function post(
  body: unknown,
  headers: Record<string, string> = {},
  ip = "203.0.113.7",
) {
  return new Request(`${SITE}/api/checkout`, {
    method: "POST",
    headers: {
      origin: SITE,
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function validBody() {
  const product = await createProduct(db, {
    publishedAt: new Date(Date.now() - 60_000),
    priceAmount: 69_900,
  });
  return {
    product,
    body: {
      attemptId: randomUUID(),
      lines: [
        { productId: product.id, quantity: 1, expectedUnitPriceAmount: 69_900 },
      ],
    },
  };
}

describe("POST /api/checkout", () => {
  it("returns the Stripe URL for a valid cart", async () => {
    const { body } = await validBody();

    const response = await handleCheckoutRequest(post(body), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = (await response.json()) as { ok: boolean; url: string };
    expect(json.ok).toBe(true);
    expect(json.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(await db.order.count()).toBe(1);
  });

  it("ignores client-supplied totals and amounts that are not in the contract", async () => {
    const { body } = await validBody();

    const response = await handleCheckoutRequest(
      post({ ...body, totalAmount: 1, shippingAmount: 0 }),
      deps,
    );

    // Unknown fields are refused outright rather than silently trusted.
    expect(response.status).toBe(400);
    expect(await db.order.count()).toBe(0);
  });

  it.each([
    ["a foreign origin", { origin: "https://evil.example" }],
    ["no origin", { origin: "" }],
  ])("rejects %s (CSRF)", async (_label, headers) => {
    const { body } = await validBody();

    const response = await handleCheckoutRequest(post(body, headers), deps);

    expect(response.status).toBe(403);
    expect(await db.order.count()).toBe(0);
  });

  it("requires JSON", async () => {
    const { body } = await validBody();
    const response = await handleCheckoutRequest(
      post(JSON.stringify(body), { "content-type": "text/plain" }),
      deps,
    );
    expect(response.status).toBe(415);
  });

  it("rejects oversized bodies before parsing them", async () => {
    const response = await handleCheckoutRequest(
      post("x".repeat(MAX_CHECKOUT_BODY_BYTES + 1)),
      deps,
    );
    expect(response.status).toBe(413);
  });

  it.each([
    ["malformed JSON", "{"],
    ["no lines", { attemptId: randomUUID(), lines: [] }],
    [
      "a non-UUID attempt",
      {
        attemptId: "1",
        lines: [
          { productId: randomUUID(), quantity: 1, expectedUnitPriceAmount: 1 },
        ],
      },
    ],
    [
      "a fractional quantity",
      {
        attemptId: randomUUID(),
        lines: [
          {
            productId: randomUUID(),
            quantity: 1.5,
            expectedUnitPriceAmount: 1,
          },
        ],
      },
    ],
    [
      "a quantity above the line limit",
      {
        attemptId: randomUUID(),
        lines: [
          {
            productId: randomUUID(),
            quantity: 100,
            expectedUnitPriceAmount: 1,
          },
        ],
      },
    ],
    [
      "duplicate products",
      {
        attemptId: randomUUID(),
        lines: [
          {
            productId: "0199a3b4-0000-7000-8000-000000000001",
            quantity: 1,
            expectedUnitPriceAmount: 1,
          },
          {
            productId: "0199a3b4-0000-7000-8000-000000000001",
            quantity: 1,
            expectedUnitPriceAmount: 1,
          },
        ],
      },
    ],
  ])("rejects %s", async (_label, body) => {
    const response = await handleCheckoutRequest(post(body), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: "invalid_request",
    });
  });

  it("answers 409 with Swedish-renderable issues when the cart changed", async () => {
    const { body } = await validBody();
    body.lines[0]!.expectedUnitPriceAmount = 100;

    const response = await handleCheckoutRequest(post(body), deps);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "rejected",
      issues: [{ kind: "price_changed", unitPriceAmount: 69_900 }],
    });
  });

  it("answers 503 without details when payments are not configured", async () => {
    const { body } = await validBody();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleCheckoutRequest(post(body), {
      ...deps,
      gateway: null,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "payment_unavailable",
    });
    expect(spy).toHaveBeenCalled();
    expect(await db.order.count()).toBe(0);
  });

  it("hides provider errors and logs no secrets or personal data", async () => {
    const { body } = await validBody();
    const failure = Object.assign(new Error("sk_test_secret leaked?"), {
      type: "StripeAPIError",
      code: "api_error",
      requestId: "req_123",
    });
    gateway.failNextCreate = failure;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleCheckoutRequest(post(body), deps);

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sk_test");
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("req_123");
    expect(logged).not.toContain("sk_test_secret");
    expect(logged).not.toContain("203.0.113.7");
  });

  it("rate-limits checkout creation per client", async () => {
    const { body } = await validBody();
    // Codes, not statuses: from the fourth open checkout the client also
    // meets the open-hold cap (429 "hold_limit", Milestone 14), which is
    // checked after the request limit.
    const codes: string[] = [];
    for (let i = 0; i < CHECKOUT_RATE_LIMIT.limit + 1; i += 1) {
      const response = await handleCheckoutRequest(
        post({ ...body, attemptId: randomUUID() }, {}, "198.51.100.1"),
        deps,
      );
      const json = (await response.json()) as { ok: boolean; code?: string };
      codes.push(json.ok ? "ok" : json.code!);
      if (response.status === 429) {
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      }
    }

    expect(codes.slice(0, -1)).not.toContain("rate_limited");
    expect(codes.at(-1)).toBe("rate_limited");

    // Another client is unaffected.
    const other = await handleCheckoutRequest(
      post({ ...body, attemptId: randomUUID() }, {}, "198.51.100.2"),
      deps,
    );
    expect(other.status).not.toBe(429);
  });
});

describe("rate limiter", () => {
  const rule = { scope: "test", limit: 3, windowMs: 60_000 };

  it("counts atomically under concurrency and resets each window", async () => {
    const now = new Date("2026-10-01T12:00:10Z");
    const key = rateLimitKey(rule, "192.0.2.1", SECRET);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(db, rule, key, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results[0]!.retryAfterSeconds).toBe(50);

    const nextWindow = new Date("2026-10-01T12:01:00Z");
    expect((await consumeRateLimit(db, rule, key, nextWindow)).allowed).toBe(
      true,
    );
  });

  it("stores only a keyed hash of the client IP and prunes old windows", async () => {
    const key = rateLimitKey(rule, "192.0.2.55", SECRET);
    await consumeRateLimit(db, rule, key, new Date("2026-09-01T00:00:00Z"));
    await consumeRateLimit(db, rule, key, new Date("2026-10-01T00:00:00Z"));

    const rows = await db.rateLimitBucket.findMany();
    expect(rows.every((row) => !row.key.includes("192.0.2.55"))).toBe(true);
    expect(key).not.toBe(rateLimitKey(rule, "192.0.2.55", `${SECRET}x`));

    expect(await pruneRateLimits(db, new Date("2026-10-01T00:00:00Z"))).toBe(1);
    expect(await db.rateLimitBucket.count()).toBe(1);
  });
});
