"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { CART_STORAGE_KEY } from "@/lib/cart/cart";
import type { CartProductView } from "@/lib/cart/evaluate";
import type {
  CheckoutRequest,
  CheckoutResponse,
} from "@/lib/checkout/checkout";

import { CartDrawer } from "./cart-drawer";
import { CartStore, type CartStoreState } from "./cart-store";

const CartContext = createContext<CartStore | null>(null);

async function fetchCartProducts(
  productIds: string[],
  attemptId?: string,
): Promise<CartProductView[]> {
  const response = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds, attemptId }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Cart lookup failed (${response.status})`);
  }
  const data = (await response.json()) as { products?: CartProductView[] };
  if (!Array.isArray(data.products)) {
    throw new Error("Cart lookup returned an unexpected shape");
  }
  return data.products;
}

/**
 * Starts checkout. Error responses carry a JSON body with a code; anything
 * else (network failure, unexpected body) rejects and is shown as a generic
 * error.
 */
async function startCheckout(
  request: CheckoutRequest,
): Promise<CheckoutResponse> {
  const response = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
  });
  const data = (await response.json()) as CheckoutResponse;
  if (typeof data !== "object" || data === null || !("ok" in data)) {
    throw new Error("Checkout returned an unexpected shape");
  }
  return data;
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // Blocked storage: the cart works for this page view only.
  }
}

/**
 * Provides the guest cart to the storefront. Wraps server-rendered children
 * without making them client components, and renders the drawer and the
 * screen-reader announcer once.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [store] = useState(
    () =>
      new CartStore({
        fetchProducts: fetchCartProducts,
        storage: typeof window === "undefined" ? null : browserStorage(),
        startCheckout,
        navigate: (url) => window.location.assign(url),
      }),
  );
  const pathname = usePathname();

  useEffect(() => {
    store.load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) store.applyExternal(event.newValue);
    };
    // Coming back from Stripe with the back button may restore this page
    // from the browser's page cache, still showing "redirecting".
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) store.resetCheckout();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [store]);

  // Following a link (e.g. a product in the drawer) closes the drawer.
  useEffect(() => {
    store.close();
  }, [pathname, store]);

  return (
    <CartContext.Provider value={store}>
      {children}
      <CartDrawer />
      <CartAnnouncer />
    </CartContext.Provider>
  );
}

export function useCartStore(): CartStore {
  const store = useContext(CartContext);
  if (!store) {
    throw new Error("useCartStore must be used inside <CartProvider>");
  }
  return store;
}

/** Subscribes to the cart state (re-renders on every cart change). */
export function useCartState(): CartStoreState {
  const store = useCartStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

/** Polite live region for add/remove/quantity confirmations. */
function CartAnnouncer() {
  const { announcement } = useCartState();
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );
}
