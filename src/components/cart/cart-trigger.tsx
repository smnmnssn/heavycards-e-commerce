"use client";

import { CartButton } from "@/components/store/cart-button";
import { totalQuantity } from "@/lib/cart/cart";

import { useCartState, useCartStore } from "./cart-provider";

/** Header cart button wired to the cart: live badge, pulse, opens drawer. */
export function CartTrigger() {
  const store = useCartStore();
  const { cart, pulseKey, isOpen } = useCartState();

  return (
    <CartButton
      count={totalQuantity(cart)}
      pulseKey={pulseKey}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls="kundvagn"
      onClick={() => store.open()}
    />
  );
}
