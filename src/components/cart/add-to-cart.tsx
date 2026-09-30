"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { lineQuantity } from "@/lib/cart/cart";
import type { CartProductView } from "@/lib/cart/evaluate";

import { useCartState, useCartStore } from "./cart-provider";

/** How long the button shows "✓ Tillagd" (PROJECT.md §19: about 1–1.5 s). */
export const ADDED_FEEDBACK_MS = 1_200;

type Problem = { tone: "conflict" | "error" | "info"; message: string } | null;

/**
 * Quantity selector and add-to-cart button for a purchasable product.
 *
 * Success feedback, as specified in PROJECT.md §19: the button reads
 * "✓ Tillagd" for ~1.2 s, the header badge updates and the cart icon pulses.
 * The drawer is never opened from here. While the feedback shows, further
 * clicks are ignored, so repeated fast clicks add exactly once.
 */
export function AddToCart({ product }: { product: CartProductView }) {
  const store = useCartStore();
  const { cart, loaded } = useCartState();
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<"idle" | "adding" | "added">("idle");
  const [problem, setProblem] = useState<Problem>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const isPreorder = product.shipment?.kind === "preorder";
  const inCart = loaded ? lineQuantity(cart, product.productId) : 0;
  const remaining = Math.max(0, product.maxQuantity - inCart);
  const selected = Math.min(quantity, Math.max(remaining, 1));

  async function handleAdd() {
    if (busy.current || remaining === 0) return;
    busy.current = true;
    setPhase("adding");
    setProblem(null);

    const result = await store.addItem(product, selected);
    if (result.status === "added") {
      setPhase("added");
      setQuantity(1);
      timer.current = setTimeout(() => {
        setPhase("idle");
        busy.current = false;
      }, ADDED_FEEDBACK_MS);
      return;
    }

    setPhase("idle");
    busy.current = false;
    if (result.status === "conflict") {
      setProblem({ tone: "conflict", message: result.message });
    } else if (result.status === "limit") {
      setProblem({
        tone: "info",
        message: "Du har redan så många av produkten som går att beställa.",
      });
    } else {
      setProblem({
        tone: "error",
        message:
          "Det gick inte att lägga produkten i kundvagnen. Försök igen om en stund.",
      });
    }
  }

  const label = isPreorder ? "Förbeställ" : "Lägg i kundvagn";

  return (
    <div className="space-y-3" data-testid="add-to-cart">
      <div className="flex gap-3">
        <QuantityStepper
          label="Antal"
          value={selected}
          max={Math.max(remaining, 1)}
          onChange={setQuantity}
          disabled={remaining === 0}
        />
        <Button
          size="lg"
          className="h-12 flex-1"
          onClick={handleAdd}
          disabled={remaining === 0}
          // Clicks during the feedback period are ignored by the busy guard;
          // the button stays enabled so focus and full contrast are kept.
          data-state={phase}
        >
          {phase === "added" ? (
            <>
              <span aria-hidden="true">✓</span> Tillagd
            </>
          ) : (
            label
          )}
        </Button>
      </div>

      {remaining === 0 && inCart > 0 && (
        <p className="text-sm text-muted-foreground">
          Du har redan alla tillgängliga exemplar i kundvagnen.
        </p>
      )}

      {problem && (
        <div
          role={problem.tone === "info" ? "status" : "alert"}
          className="border-l-2 border-foreground bg-surface px-4 py-3 text-sm"
        >
          <p>{problem.message}</p>
          {problem.tone === "conflict" && (
            <button
              type="button"
              onClick={() => store.open()}
              className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
            >
              Visa kundvagnen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
