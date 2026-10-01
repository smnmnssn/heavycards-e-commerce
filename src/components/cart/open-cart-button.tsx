"use client";

import { buttonClasses, type ButtonVariant } from "@/components/ui/button";

import { useCartStore } from "./cart-provider";

/** Opens the cart drawer from a page (e.g. after a cancelled payment). */
export function OpenCartButton({
  variant = "primary",
  children = "Visa kundvagnen",
}: {
  variant?: ButtonVariant;
  children?: string;
}) {
  const store = useCartStore();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-controls="kundvagn"
      onClick={() => store.open()}
      className={buttonClasses({ variant })}
    >
      {children}
    </button>
  );
}
