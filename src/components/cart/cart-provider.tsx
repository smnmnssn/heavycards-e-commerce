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

import { CartDrawer } from "./cart-drawer";
import { CartStore, type CartStoreState } from "./cart-store";

const CartContext = createContext<CartStore | null>(null);

async function fetchCartProducts(
  productIds: string[],
): Promise<CartProductView[]> {
  const response = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds }),
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
      }),
  );
  const pathname = usePathname();

  useEffect(() => {
    store.load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) store.applyExternal(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
