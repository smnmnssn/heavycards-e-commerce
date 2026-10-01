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
import { evaluateCart, type CartProductView } from "@/lib/cart/evaluate";
import {
  checkoutFailureMessage,
  GENERIC_CHECKOUT_ERROR,
  isStripeCheckoutUrl,
  type CheckoutFailureMessage,
  type CheckoutLineRequest,
  type CheckoutRequest,
  type CheckoutResponse,
} from "@/lib/checkout/checkout";

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

export type CheckoutState = Readonly<
  | { status: "idle" | "submitting" | "redirecting" }
  | { status: "error"; message: CheckoutFailureMessage }
>;

/**
 * The current checkout attempt, kept in browser storage so a retry of the
 * same cart (double click, network retry, back from Stripe) reuses the
 * server's order and Stripe session instead of reserving stock again.
 * `fp` fingerprints the lines and displayed prices the attempt was for.
 */
export const CHECKOUT_ATTEMPT_STORAGE_KEY = "heavycards:checkout-attempt";
type StoredAttempt = { id: string; fp: string };

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
  checkout: CheckoutState;
}>;

export type AddResult =
  | { status: "added"; added: number }
  | { status: "conflict"; conflict: CartConflict; message: string }
  | { status: "limit" }
  | { status: "error" };

export type CartStorage = Pick<Storage, "getItem" | "setItem">;

type Dependencies = {
  /** `attemptId`: the current checkout attempt, whose own hold is ignored. */
  fetchProducts: (
    productIds: string[],
    attemptId?: string,
  ) => Promise<CartProductView[]>;
  storage?: CartStorage | null;
  /** POST /api/checkout; rejects on network failure. */
  startCheckout?: (request: CheckoutRequest) => Promise<CheckoutResponse>;
  /** Leaves the page for the payment URL. */
  navigate?: (url: string) => void;
  newAttemptId?: () => string;
  /** Lowercase hex SHA-256 (Web Crypto in the browser). */
  sha256?: (text: string) => Promise<string>;
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
  checkout: { status: "idle" },
};

const quantityText = (count: number) =>
  count === 1 ? "1 artikel" : `${count} artiklar`;

export class CartStore {
  private state: CartStoreState = initialState;
  private readonly listeners = new Set<() => void>();
  private refreshSeq = 0;
  private pendingRefresh: Promise<boolean> | null = null;
  /** Fallback when browser storage is blocked. */
  private attemptInMemory: StoredAttempt | null = null;

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
    // A changed cart makes an earlier checkout error obsolete.
    this.set(
      this.state.checkout.status === "error"
        ? { cart, checkout: { status: "idle" } }
        : { cart },
    );
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
    const attemptId = this.readAttempt()?.id;
    this.pendingRefresh = (
      attemptId
        ? this.deps.fetchProducts(ids, attemptId)
        : this.deps.fetchProducts(ids)
    )
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

  // --- Checkout ---------------------------------------------------------------------

  /**
   * Starts Stripe Checkout for the cart as currently shown. Only intent and
   * the displayed prices are sent; the server recalculates everything and
   * refuses if anything changed. On success the browser leaves for Stripe;
   * the cart is kept (it is cleared only after a verified payment).
   */
  async checkout(): Promise<void> {
    const status = this.state.checkout.status;
    if (status === "submitting" || status === "redirecting") return;
    const { startCheckout, navigate } = this.deps;
    if (!startCheckout || !navigate) return;

    const evaluated = evaluateCart(this.state.cart, this.state.products);
    if (
      this.state.cart.lines.length === 0 ||
      evaluated.incomplete ||
      evaluated.hasIssues
    ) {
      return;
    }
    const lines: CheckoutLineRequest[] = evaluated.lines.map(
      ({ line, product }) => ({
        productId: line.productId,
        quantity: line.quantity,
        expectedUnitPriceAmount: product!.unitPriceAmount!,
      }),
    );
    const fp = lines
      .map((l) => `${l.productId}:${l.quantity}:${l.expectedUnitPriceAmount}`)
      .sort()
      .join("|");

    this.set({ checkout: { status: "submitting" } });
    const stored = this.readAttempt();
    let attempt: StoredAttempt =
      stored?.fp === fp ? stored : { id: this.newAttemptId(), fp };
    let previous = stored && stored.id !== attempt.id ? stored.id : undefined;

    let response: CheckoutResponse | null = null;
    try {
      // Stored before sending: if the response is lost, the next click
      // repeats the same attempt instead of reserving again.
      this.writeAttempt(attempt);
      response = await startCheckout({
        attemptId: attempt.id,
        previousAttemptId: previous,
        lines,
      });
      if (!response.ok && response.code === "attempt_closed") {
        // That attempt is finished (expired, released or changed): start a
        // new one, which also releases the old one on the server.
        previous = attempt.id;
        attempt = { id: this.newAttemptId(), fp };
        this.writeAttempt(attempt);
        response = await startCheckout({
          attemptId: attempt.id,
          previousAttemptId: previous,
          lines,
        });
      }
    } catch {
      response = null;
    }

    if (response?.ok && isStripeCheckoutUrl(response.url)) {
      this.set({ checkout: { status: "redirecting" } });
      this.announce("Du skickas vidare till betalningen.");
      navigate(response.url);
      return;
    }

    let message: CheckoutFailureMessage = {
      title: GENERIC_CHECKOUT_ERROR,
      details: [],
    };
    if (response && !response.ok) {
      if (response.code === "rejected") {
        // Show current prices and availability, and lower quantities.
        await this.refresh();
      }
      message = checkoutFailureMessage(
        response,
        (id) => this.state.products[id]?.name ?? null,
      );
    }
    this.set({ checkout: { status: "error", message } });
    this.announce([message.title, ...message.details].join(" "));
  }

  /**
   * Called by the confirmation page once the database says the order is
   * paid. Removes exactly what was bought, and only in the browser that
   * started that checkout (its stored attempt must hash to `attemptHash`),
   * only once (the attempt record is then cleared). Products or quantities
   * added after the checkout started, in this or another tab, stay.
   */
  async completePaidCheckout(
    attemptHash: string,
    purchased: ReadonlyArray<{ productId: string; quantity: number }>,
  ): Promise<boolean> {
    const attempt = this.readAttempt();
    if (!attempt) return false;
    let hash: string;
    try {
      hash = await (this.deps.sha256 ?? sha256Hex)(attempt.id);
    } catch {
      return false; // No Web Crypto: keep the cart rather than guess.
    }
    if (hash !== attemptHash) return false;

    let cart = this.state.cart;
    for (const { productId, quantity } of purchased) {
      const remaining = lineQuantity(cart, productId) - quantity;
      cart =
        remaining > 0
          ? setLineQuantity(cart, productId, remaining)
          : removeFromCart(cart, productId);
    }
    this.commit(cart);
    this.clearAttempt();
    this.announce(
      totalQuantity(cart) === 0
        ? "Tack för din beställning! Kundvagnen har tömts."
        : "Tack för din beställning! De köpta produkterna har tagits bort från kundvagnen.",
    );
    return true;
  }

  /** After returning with the browser's back button (page cache). */
  resetCheckout() {
    if (this.state.checkout.status !== "idle") {
      this.set({ checkout: { status: "idle" } });
    }
  }

  private newAttemptId(): string {
    return this.deps.newAttemptId?.() ?? crypto.randomUUID();
  }

  private readAttempt(): StoredAttempt | null {
    try {
      const raw = this.deps.storage?.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      const value: unknown = raw ? JSON.parse(raw) : null;
      if (
        value &&
        typeof value === "object" &&
        typeof (value as StoredAttempt).id === "string" &&
        typeof (value as StoredAttempt).fp === "string" &&
        /^[0-9a-f-]{36}$/i.test((value as StoredAttempt).id)
      ) {
        return value as StoredAttempt;
      }
    } catch {
      // Corrupt or blocked storage: fall back to this page view's attempt.
    }
    return this.attemptInMemory;
  }

  private clearAttempt() {
    this.attemptInMemory = null;
    try {
      this.deps.storage?.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, "null");
    } catch {
      // Blocked storage: nothing was stored.
    }
  }

  private writeAttempt(attempt: StoredAttempt) {
    this.attemptInMemory = attempt;
    try {
      this.deps.storage?.setItem(
        CHECKOUT_ATTEMPT_STORAGE_KEY,
        JSON.stringify(attempt),
      );
    } catch {
      // Without storage, idempotency still holds within this page view.
    }
  }

  // --- Drawer and announcements ---------------------------------------------------

  /** Opens the drawer. Only ever called from an explicit customer action. */
  open() {
    this.set({ isOpen: true });
    this.resetCheckout();
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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
