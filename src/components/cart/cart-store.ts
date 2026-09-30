import {
  addToCart,
  CART_STORAGE_KEY,
  cartConflictMessages,
  emptyCart,
  findConflict,
  lineQuantity,
  parseStoredCart,
  removeFromCart,
  serializeCart,
  setLineQuantity,
  totalQuantity,
  type Cart,
  type CartConflict,
  type ShipmentGroup,
} from "@/lib/cart/cart";
import type { CartProductView } from "@/lib/cart/evaluate";

/*
 * Client-side cart store (framework-free; React reads it through
 * useSyncExternalStore in ./cart-provider.tsx).
 *
 * - The cart (IDs + quantities) is the only persisted state.
 * - Product views come from the server (`fetchProducts`) and are never
 *   persisted. They are refreshed on load and whenever the drawer opens.
 * - Mutations are synchronous against `this.state`, so repeated fast clicks
 *   always build on the latest quantity.
 */

export type HydrationStatus = "idle" | "loading" | "ready" | "error";

export type CartStoreState = Readonly<{
  cart: Cart;
  /** Browser storage has been read (false during SSR and first paint). */
  loaded: boolean;
  products: Readonly<Record<string, CartProductView>>;
  hydration: HydrationStatus;
  /** Lines reduced to current availability: productId → previous quantity. */
  adjustments: Readonly<Record<string, number>>;
  /** Increments on every successful add; restarts the cart icon pulse. */
  pulseKey: number;
  isOpen: boolean;
  /** Latest polite screen-reader announcement. */
  announcement: string;
}>;

export type AddResult =
  | { status: "added"; added: number }
  | { status: "conflict"; conflict: CartConflict; message: string }
  | { status: "limit" }
  | { status: "error" };

export type CartStorage = Pick<Storage, "getItem" | "setItem">;

type Dependencies = {
  fetchProducts: (productIds: string[]) => Promise<CartProductView[]>;
  storage?: CartStorage | null;
};

const initialState: CartStoreState = {
  cart: emptyCart,
  loaded: false,
  products: {},
  hydration: "idle",
  adjustments: {},
  pulseKey: 0,
  isOpen: false,
  announcement: "",
};

const quantityText = (count: number) =>
  count === 1 ? "1 artikel" : `${count} artiklar`;

export class CartStore {
  private state: CartStoreState = initialState;
  private readonly listeners = new Set<() => void>();
  private refreshSeq = 0;
  private pendingRefresh: Promise<boolean> | null = null;

  constructor(private readonly deps: Dependencies) {}

  // --- useSyncExternalStore contract ---------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CartStoreState => this.state;

  /** The server never knows the browser cart: render it empty. */
  getServerSnapshot = (): CartStoreState => initialState;

  private set(patch: Partial<CartStoreState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // --- Persistence ---------------------------------------------------------------

  /** Reads the stored cart once on the client, then validates it. */
  load() {
    if (this.state.loaded) return;
    this.set({ cart: this.readStorage(), loaded: true });
    if (this.state.cart.lines.length > 0) void this.refresh();
  }

  /** Applies a change made in another tab (storage event). */
  applyExternal(raw: string | null) {
    this.set({ cart: parseStoredCart(raw) });
  }

  private readStorage(): Cart {
    try {
      return parseStoredCart(this.deps.storage?.getItem(CART_STORAGE_KEY));
    } catch {
      return emptyCart;
    }
  }

  private commit(cart: Cart) {
    this.set({ cart });
    try {
      this.deps.storage?.setItem(CART_STORAGE_KEY, serializeCart(cart));
    } catch {
      // Storage full or blocked (private mode): the cart still works in memory.
    }
  }

  // --- Server data -----------------------------------------------------------------

  /**
   * Loads current product data for every line. Concurrent callers share one
   * request; results from superseded requests are still merged (they are
   * valid data), but only the latest decides the status.
   */
  refresh(): Promise<boolean> {
    if (this.pendingRefresh) return this.pendingRefresh;
    const ids = this.state.cart.lines.map((line) => line.productId);
    if (ids.length === 0) {
      this.set({ hydration: "ready" });
      return Promise.resolve(true);
    }

    const seq = ++this.refreshSeq;
    this.set({ hydration: "loading" });
    this.pendingRefresh = this.deps
      .fetchProducts(ids)
      .then((views) => {
        const products = { ...this.state.products };
        for (const view of views) products[view.productId] = view;
        this.set({ products });
        this.clampToAvailability();
        if (seq === this.refreshSeq) this.set({ hydration: "ready" });
        return true;
      })
      .catch(() => {
        if (seq === this.refreshSeq) this.set({ hydration: "error" });
        return false;
      })
      .finally(() => {
        this.pendingRefresh = null;
      });
    return this.pendingRefresh;
  }

  /**
   * Lowers quantities that exceed what can be bought now and records the
   * change so the drawer can explain it. Unavailable lines are kept (and
   * shown as such) until the customer removes them.
   */
  private clampToAvailability() {
    let cart = this.state.cart;
    const adjustments = { ...this.state.adjustments };
    const messages: string[] = [];
    for (const line of cart.lines) {
      const product = this.state.products[line.productId];
      if (!product?.available || line.quantity <= product.maxQuantity) continue;
      cart = setLineQuantity(cart, line.productId, product.maxQuantity);
      adjustments[line.productId] = line.quantity;
      messages.push(
        `Antalet för ${product.name ?? "en produkt"} har ändrats till ${product.maxQuantity} eftersom det bara finns så många kvar.`,
      );
    }
    if (cart !== this.state.cart) {
      this.commit(cart);
      this.set({ adjustments });
      this.announce(messages.join(" "));
    }
  }

  // --- Cart actions ----------------------------------------------------------------

  /**
   * Adds a product using data rendered by the server for its product page.
   * Checks the V1 one-shipment rule against the products already in the cart
   * (loading their current data first if needed). Never removes anything.
   */
  async addItem(view: CartProductView, quantity: number): Promise<AddResult> {
    if (!view.available || !view.shipment) return { status: "error" };

    const others = () =>
      this.state.cart.lines.filter((line) => line.productId !== view.productId);
    if (others().some((line) => !this.state.products[line.productId])) {
      const ok = await this.refresh();
      if (!ok) return { status: "error" };
    }

    // Unavailable products cannot be ordered anyway, so they never block.
    const existing = others().flatMap((line) => {
      const product = this.state.products[line.productId];
      return product?.available && product.shipment
        ? [{ productId: line.productId, shipment: product.shipment }]
        : [];
    });
    const candidate: { productId: string; shipment: ShipmentGroup } = {
      productId: view.productId,
      shipment: view.shipment,
    };
    const conflict = findConflict(existing, candidate);
    if (conflict) {
      return {
        status: "conflict",
        conflict,
        message: cartConflictMessages[conflict],
      };
    }

    const { cart, added } = addToCart(
      this.state.cart,
      view.productId,
      quantity,
      view.maxQuantity,
    );
    if (added === 0) return { status: "limit" };

    this.set({
      products: { ...this.state.products, [view.productId]: view },
      pulseKey: this.state.pulseKey + 1,
    });
    this.commit(cart);
    this.announce(
      `${view.name ?? "Produkten"} har lagts i kundvagnen. Kundvagnen innehåller ${quantityText(totalQuantity(cart))}.`,
    );
    return { status: "added", added };
  }

  setQuantity(productId: string, quantity: number) {
    const product = this.state.products[productId];
    const next = setLineQuantity(
      this.state.cart,
      productId,
      quantity,
      product?.available ? product.maxQuantity : undefined,
    );
    this.commit(next);
    this.clearAdjustment(productId);
    const name = product?.name ?? "produkten";
    const now = lineQuantity(next, productId);
    this.announce(
      now === 0
        ? `${name} har tagits bort från kundvagnen.`
        : `Antal för ${name}: ${now}.`,
    );
  }

  removeItem(productId: string) {
    const name = this.state.products[productId]?.name ?? "Produkten";
    const next = removeFromCart(this.state.cart, productId);
    this.commit(next);
    this.clearAdjustment(productId);
    this.announce(
      `${name} har tagits bort från kundvagnen. Kundvagnen innehåller ${quantityText(totalQuantity(next))}.`,
    );
  }

  private clearAdjustment(productId: string) {
    if (!(productId in this.state.adjustments)) return;
    const adjustments = { ...this.state.adjustments };
    delete adjustments[productId];
    this.set({ adjustments });
  }

  // --- Drawer and announcements ---------------------------------------------------

  /** Opens the drawer. Only ever called from an explicit customer action. */
  open() {
    this.set({ isOpen: true });
    void this.refresh();
  }

  close() {
    if (this.state.isOpen) this.set({ isOpen: false });
  }

  announce(message: string) {
    // Clearing first (in a separate render) makes identical consecutive
    // messages announce again.
    this.set({ announcement: "" });
    setTimeout(() => this.set({ announcement: message }), 50);
  }
}
