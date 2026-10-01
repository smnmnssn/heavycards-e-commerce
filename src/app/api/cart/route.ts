import { z } from "zod";

import { MAX_CART_LINES } from "@/lib/cart/cart";
import { db } from "@/lib/db/client";
import { loadCartProducts } from "@/server/cart/cart-products";

const requestSchema = z.object({
  productIds: z.array(z.uuid()).max(MAX_CART_LINES),
  /** The browser's current checkout attempt (see loadCartProducts). */
  attemptId: z.uuid().optional(),
});

const noStore = { "Cache-Control": "no-store" };

/**
 * Returns current product data (price, availability, limits) for the IDs in
 * a browser cart. Read-only, so it needs no CSRF protection; input is
 * validated and bounded. Rate limiting for public endpoints is part of
 * Milestone 14.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: noStore },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: noStore },
    );
  }

  try {
    const productIds = [...new Set(parsed.data.productIds)];
    const { attemptId } = parsed.data;
    const products = attemptId
      ? await loadCartProducts(db, productIds, new Date(), {
          ownAttemptId: attemptId,
        })
      : await loadCartProducts(db, productIds, new Date());
    return Response.json({ products }, { headers: noStore });
  } catch (error) {
    console.error("[cart] product lookup failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: noStore },
    );
  }
}
