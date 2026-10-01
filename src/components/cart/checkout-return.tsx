"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useCartStore } from "./cart-provider";

/**
 * While the payment is still being confirmed, re-renders the page from the
 * database a few times (Stripe usually reports within seconds). It never
 * asks the browser or Stripe directly: only the server-side order decides.
 */
const REFRESH_AFTER_MS = [2_000, 6_000, 14_000, 29_000, 59_000];

export function RefreshWhilePending() {
  const router = useRouter();
  useEffect(() => {
    // Mounted once per pending page view; a refresh re-renders the server
    // page but keeps this component, so the schedule is not restarted.
    const timers = REFRESH_AFTER_MS.map((at) =>
      setTimeout(() => router.refresh(), at),
    );
    return () => timers.forEach(clearTimeout);
  }, [router]);
  return null;
}

/**
 * Rendered only for an order the database says is paid. Removes the
 * purchased items from this browser's cart if (and only if) this browser
 * started that checkout; see CartStore.completePaidCheckout.
 */
export function ClearPurchasedItems({
  attemptHash,
  lines,
}: {
  attemptHash: string;
  lines: Array<{ productId: string; quantity: number }>;
}) {
  const store = useCartStore();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Child effects run before the provider's: read the stored cart first,
    // so nothing is written over it.
    store.load();
    void store.completePaidCheckout(attemptHash, lines);
  }, [store, attemptHash, lines]);
  return null;
}
