import { beforeEach, describe, expect, it, vi } from "vitest";

import { CartStore, type CartStorage } from "@/components/cart/cart-store";
import { CART_STORAGE_KEY, serializeCart } from "@/lib/cart/cart";
import { formatPrice } from "@/lib/money";
import type { CartProductView } from "@/lib/cart/evaluate";
import type {
  CheckoutRequest,
  CheckoutResponse,
} from "@/lib/checkout/checkout";

const STOCK_A = "01999999-0000-7000-8000-00000000000a";
const STOCK_B = "01999999-0000-7000-8000-00000000000b";
const PRE_NOV = "01999999-0000-7000-8000-0000000000c1";
const PRE_DEC = "01999999-0000-7000-8000-0000000000c2";

const view = (
  productId: string,
  overrides: Partial<CartProductView> = {},
): CartProductView => ({
  productId,
  available: true,
  unavailableReason: null,
  name: `Produkt ${productId.slice(-2)}`,
  slug: "produkt",
  setName: null,
  image: null,
  unitPriceAmount: 10_000,
  maxQuantity: 10,
  shipment: { kind: "stock" },
  ...overrides,
});

const preorder = (productId: string, releaseDate: string) =>
  view(productId, { shipment: { kind: "preorder", releaseDate } });

class MemoryStorage implements CartStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function setup(serverViews: Record<string, CartProductView> = {}) {
  const storage = new MemoryStorage();
  const fetchProducts = vi.fn(async (ids: string[]) =>
    ids.map(
      (id) =>
        serverViews[id] ??
        view(id, { available: false, unavailableReason: "not_found" }),
    ),
  );
  const store = new CartStore({ fetchProducts, storage });
  return { store, storage, fetchProducts };
}

const stored = (storage: MemoryStorage) =>
  JSON.parse(storage.getItem(CART_STORAGE_KEY) ?? "null");

beforeEach(() => {
  vi.useRealTimers();
});

describe("CartStore", () => {
  it("renders empty on the server and before storage is read", () => {
    const { store } = setup();

    expect(store.getServerSnapshot().cart.lines).toEqual([]);
    expect(store.getSnapshot().loaded).toBe(false);
  });

  it("adds items, persists only IDs and quantities, and pulses", async () => {
    const { store, storage } = setup();
    store.load();

    const result = await store.addItem(view(STOCK_A), 2);

    expect(result).toEqual({ status: "added", added: 2 });
    expect(stored(storage)).toEqual({ v: 1, lines: [{ id: STOCK_A, q: 2 }] });
    expect(store.getSnapshot().pulseKey).toBe(1);
    expect(store.getSnapshot().isOpen).toBe(false); // never opens on add
  });

  it("handles rapid repeated adds without losing or duplicating units", async () => {
    const { store } = setup();
    store.load();

    await Promise.all([
      store.addItem(view(STOCK_A), 1),
      store.addItem(view(STOCK_A), 1),
      store.addItem(view(STOCK_A), 1),
    ]);

    expect(store.getSnapshot().cart.lines).toEqual([
      { productId: STOCK_A, quantity: 3 },
    ]);
  });

  it("respects the product's current maximum", async () => {
    const { store } = setup();
    store.load();

    await store.addItem(view(STOCK_A, { maxQuantity: 2 }), 2);
    const result = await store.addItem(view(STOCK_A, { maxQuantity: 2 }), 1);

    expect(result).toEqual({ status: "limit" });
  });

  it("refuses unavailable products", async () => {
    const { store } = setup();
    store.load();

    expect(
      await store.addItem(
        view(STOCK_A, {
          available: false,
          unavailableReason: "sold_out",
          maxQuantity: 0,
        }),
        1,
      ),
    ).toEqual({ status: "error" });
    expect(store.getSnapshot().cart.lines).toEqual([]);
  });

  it("blocks mixing preorder and stock without removing anything", async () => {
    const { store } = setup();
    store.load();
    await store.addItem(view(STOCK_A), 1);

    const result = await store.addItem(preorder(PRE_NOV, "2026-11-14"), 1);

    expect(result).toMatchObject({
      status: "conflict",
      conflict: "preorder_with_stock",
      message: expect.stringContaining("beställas separat"),
    });
    expect(store.getSnapshot().cart.lines).toEqual([
      { productId: STOCK_A, quantity: 1 },
    ]);
  });

  it("blocks preorders with different release dates, allows the same date", async () => {
    const { store } = setup();
    store.load();
    await store.addItem(preorder(PRE_NOV, "2026-11-14"), 1);

    expect(
      await store.addItem(preorder(PRE_DEC, "2026-12-14"), 1),
    ).toMatchObject({
      status: "conflict",
      conflict: "different_release_dates",
    });
    expect(await store.addItem(preorder(STOCK_B, "2026-11-14"), 1)).toEqual({
      status: "added",
      added: 1,
    });
  });

  it("loads current data for persisted lines before checking compatibility", async () => {
    const { store, storage, fetchProducts } = setup({
      [PRE_NOV]: preorder(PRE_NOV, "2026-11-14"),
    });
    storage.setItem(
      CART_STORAGE_KEY,
      serializeCart({ lines: [{ productId: PRE_NOV, quantity: 1 }] }),
    );
    store.load();

    const result = await store.addItem(view(STOCK_A), 1);

    expect(fetchProducts).toHaveBeenCalledWith([PRE_NOV]);
    expect(result).toMatchObject({ conflict: "preorder_with_stock" });
  });

  it("does not let unavailable persisted products block new additions", async () => {
    const { store, storage } = setup(); // server reports everything not_found
    storage.setItem(
      CART_STORAGE_KEY,
      serializeCart({ lines: [{ productId: PRE_NOV, quantity: 1 }] }),
    );
    store.load();

    expect(await store.addItem(view(STOCK_A), 1)).toEqual({
      status: "added",
      added: 1,
    });
  });

  it("recovers from corrupt storage and blocked storage", async () => {
    const { store, storage } = setup();
    storage.setItem(CART_STORAGE_KEY, "{not json");
    store.load();
    expect(store.getSnapshot()).toMatchObject({
      loaded: true,
      cart: { lines: [] },
    });

    const throwing = new CartStore({
      fetchProducts: async () => [],
      storage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    throwing.load();
    expect(await throwing.addItem(view(STOCK_A), 1)).toEqual({
      status: "added",
      added: 1,
    });
  });

  it("clamps stale quantities to current availability and explains it", async () => {
    const { store, storage } = setup({
      [STOCK_A]: view(STOCK_A, { maxQuantity: 2 }),
    });
    storage.setItem(
      CART_STORAGE_KEY,
      serializeCart({ lines: [{ productId: STOCK_A, quantity: 5 }] }),
    );
    store.load();
    await store.refresh();

    expect(store.getSnapshot().cart.lines).toEqual([
      { productId: STOCK_A, quantity: 2 },
    ]);
    expect(store.getSnapshot().adjustments).toEqual({ [STOCK_A]: 5 });
    expect(stored(storage).lines).toEqual([{ id: STOCK_A, q: 2 }]);
  });

  it("keeps unavailable persisted items until the customer removes them", async () => {
    const { store, storage } = setup();
    storage.setItem(
      CART_STORAGE_KEY,
      serializeCart({ lines: [{ productId: STOCK_A, quantity: 3 }] }),
    );
    store.load();
    await store.refresh();

    expect(store.getSnapshot().cart.lines).toEqual([
      { productId: STOCK_A, quantity: 3 },
    ]);
    store.removeItem(STOCK_A);
    expect(store.getSnapshot().cart.lines).toEqual([]);
  });

  it("reports a failed refresh without losing the cart", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CART_STORAGE_KEY,
      serializeCart({ lines: [{ productId: STOCK_A, quantity: 1 }] }),
    );
    const store = new CartStore({
      fetchProducts: async () => {
        throw new Error("offline");
      },
      storage,
    });
    store.load();
    await store.refresh();

    expect(store.getSnapshot().hydration).toBe("error");
    expect(store.getSnapshot().cart.lines).toHaveLength(1);
  });

  it("opens only on request and refreshes product data when opening", async () => {
    const { store, fetchProducts } = setup({ [STOCK_A]: view(STOCK_A) });
    store.load();
    await store.addItem(view(STOCK_A), 1);
    fetchProducts.mockClear();

    store.open();

    expect(store.getSnapshot().isOpen).toBe(true);
    expect(fetchProducts).toHaveBeenCalledWith([STOCK_A]);
    store.close();
    expect(store.getSnapshot().isOpen).toBe(false);
  });

  it("updates quantities within limits and removes at zero", async () => {
    const { store } = setup();
    store.load();
    await store.addItem(view(STOCK_A, { maxQuantity: 3 }), 1);

    store.setQuantity(STOCK_A, 10);
    expect(store.getSnapshot().cart.lines[0]?.quantity).toBe(3);
    store.setQuantity(STOCK_A, 0);
    expect(store.getSnapshot().cart.lines).toEqual([]);
  });

  it("announces changes for screen readers", async () => {
    vi.useFakeTimers();
    const { store } = setup();
    store.load();
    await store.addItem(view(STOCK_A), 2);
    vi.advanceTimersByTime(60);

    expect(store.getSnapshot().announcement).toBe(
      "Produkt 0a har lagts i kundvagnen. Kundvagnen innehåller 2 artiklar.",
    );
  });

  it("follows changes made in another tab", () => {
    const { store } = setup();
    store.load();

    store.applyExternal(
      serializeCart({ lines: [{ productId: STOCK_B, quantity: 4 }] }),
    );

    expect(store.getSnapshot().cart.lines).toEqual([
      { productId: STOCK_B, quantity: 4 },
    ]);
  });
});

describe("CartStore checkout", () => {
  const URL_A = "https://checkout.stripe.com/c/pay/cs_test_a";
  let ids = 0;
  const newAttemptId = () =>
    `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

  async function checkoutSetup(
    responses: Array<CheckoutResponse | Error>,
    serverViews: Record<string, CartProductView> = {
      [STOCK_A]: view(STOCK_A),
    },
  ) {
    const storage = new MemoryStorage();
    const fetchProducts = vi.fn(async (list: string[]) =>
      list.map((id) => serverViews[id] ?? view(id)),
    );
    const queue = [...responses];
    const startCheckout = vi.fn(async (request: CheckoutRequest) => {
      void request;
      const next = queue.shift();
      if (!next || next instanceof Error) throw next ?? new Error("none");
      return next;
    });
    const navigate = vi.fn();
    const store = new CartStore({
      fetchProducts,
      storage,
      startCheckout,
      navigate,
      newAttemptId,
    });
    store.load();
    await store.addItem(serverViews[STOCK_A] ?? view(STOCK_A), 2);
    return { store, storage, startCheckout, navigate };
  }

  it("sends only intent and displayed prices, then leaves for Stripe without clearing the cart", async () => {
    const { store, startCheckout, navigate } = await checkoutSetup([
      { ok: true, url: URL_A },
    ]);

    await store.checkout();

    expect(startCheckout).toHaveBeenCalledWith({
      attemptId: expect.any(String),
      previousAttemptId: undefined,
      lines: [
        { productId: STOCK_A, quantity: 2, expectedUnitPriceAmount: 10_000 },
      ],
    });
    expect(navigate).toHaveBeenCalledWith(URL_A);
    expect(store.getSnapshot().checkout.status).toBe("redirecting");
    expect(store.getSnapshot().cart.lines).toEqual([
      { productId: STOCK_A, quantity: 2 },
    ]);
  });

  it("never follows a URL outside Stripe Checkout", async () => {
    const { store, navigate } = await checkoutSetup([
      { ok: true, url: "https://evil.example/pay" },
    ]);

    await store.checkout();

    expect(navigate).not.toHaveBeenCalled();
    expect(store.getSnapshot().checkout).toEqual({
      status: "error",
      message: {
        title: "Det gick inte att starta betalningen. Försök igen.",
        details: [],
      },
    });
  });

  it("reuses the attempt for the same cart and starts a new one, naming the old, when it changes", async () => {
    const { store, startCheckout } = await checkoutSetup([
      new Error("network"),
      { ok: true, url: URL_A },
      { ok: true, url: URL_A },
    ]);

    await store.checkout(); // response lost
    await store.checkout(); // retried: same attempt
    store.resetCheckout(); // back from Stripe
    store.setQuantity(STOCK_A, 1);
    await store.checkout(); // different cart: new attempt

    const [first, second, third] = startCheckout.mock.calls.map(([r]) => r);
    expect(second!.attemptId).toBe(first!.attemptId);
    expect(third!.attemptId).not.toBe(first!.attemptId);
    expect(third!.previousAttemptId).toBe(first!.attemptId);
  });

  it("keeps the attempt in memory when browser storage is blocked", async () => {
    const startCheckout = vi.fn(
      async (request: CheckoutRequest): Promise<CheckoutResponse> => {
        void request;
        throw new Error("network");
      },
    );
    const store = new CartStore({
      fetchProducts: async (list) => list.map((id) => view(id)),
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
      startCheckout,
      navigate: vi.fn(),
      newAttemptId,
    });
    store.load();
    await store.addItem(view(STOCK_A), 1);

    await store.checkout();
    await store.checkout();

    const [first, second] = startCheckout.mock.calls.map(([r]) => r);
    expect(second!.attemptId).toBe(first!.attemptId);
  });

  it("asks for availability without its own pending attempt's hold", async () => {
    const { store, startCheckout } = await checkoutSetup([
      { ok: true, url: URL_A },
    ]);
    await store.checkout();
    const fetchProducts = vi.fn(async (list: string[]) =>
      list.map((id) => view(id)),
    );
    const storage = new MemoryStorage();
    storage.setItem(
      "heavycards:checkout-attempt",
      JSON.stringify({
        id: startCheckout.mock.calls[0]![0].attemptId,
        fp: "x",
      }),
    );
    const next = new CartStore({ fetchProducts, storage });
    storage.setItem(
      CART_STORAGE_KEY,
      serializeCart({ lines: [{ productId: STOCK_A, quantity: 1 }] }),
    );

    next.load();
    await next.refresh();

    expect(fetchProducts).toHaveBeenCalledWith(
      [STOCK_A],
      startCheckout.mock.calls[0]![0].attemptId,
    );
  });

  it("ignores repeated clicks while a checkout is starting", async () => {
    const { store, startCheckout } = await checkoutSetup([
      { ok: true, url: URL_A },
    ]);

    await Promise.all([store.checkout(), store.checkout(), store.checkout()]);

    expect(startCheckout).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh attempt once when the server closed the old one", async () => {
    const { store, startCheckout, navigate } = await checkoutSetup([
      { ok: false, code: "attempt_closed" },
      { ok: true, url: URL_A },
    ]);

    await store.checkout();

    const [first, retry] = startCheckout.mock.calls.map(([r]) => r);
    expect(retry!.previousAttemptId).toBe(first!.attemptId);
    expect(retry!.attemptId).not.toBe(first!.attemptId);
    expect(navigate).toHaveBeenCalledWith(URL_A);
  });

  it("explains a rejected cart in Swedish and reloads current data", async () => {
    const views = { [STOCK_A]: view(STOCK_A, { name: "Booster Box" }) };
    const { store, navigate } = await checkoutSetup(
      [
        {
          ok: false,
          code: "rejected",
          issues: [
            {
              productId: STOCK_A,
              kind: "price_changed",
              unitPriceAmount: 12_000,
              expectedUnitPriceAmount: 10_000,
            },
          ],
          conflict: null,
        },
      ],
      views,
    );
    views[STOCK_A] = view(STOCK_A, {
      name: "Booster Box",
      unitPriceAmount: 12_000,
    });

    await store.checkout();

    expect(navigate).not.toHaveBeenCalled();
    expect(store.getSnapshot().products[STOCK_A]!.unitPriceAmount).toBe(12_000);
    expect(store.getSnapshot().checkout).toEqual({
      status: "error",
      message: {
        title:
          "Kundvagnen har ändrats. Kontrollera den och tryck på Till kassan igen.",
        details: [
          `Booster Box: Priset har ändrats från ${formatPrice(10_000)} till ${formatPrice(12_000)}.`,
        ],
      },
    });

    // Changing the cart clears the outdated message.
    store.setQuantity(STOCK_A, 1);
    expect(store.getSnapshot().checkout.status).toBe("idle");
  });

  it("lowers quantities the server says are no longer available", async () => {
    const views = { [STOCK_A]: view(STOCK_A) };
    const { store } = await checkoutSetup(
      [
        {
          ok: false,
          code: "rejected",
          issues: [
            {
              productId: STOCK_A,
              kind: "insufficient_quantity",
              availableQuantity: 1,
            },
          ],
          conflict: null,
        },
      ],
      views,
    );
    views[STOCK_A] = view(STOCK_A, { maxQuantity: 1 });

    await store.checkout();

    expect(store.getSnapshot().cart.lines[0]!.quantity).toBe(1);
    expect(store.getSnapshot().adjustments[STOCK_A]).toBe(2);
    expect(store.getSnapshot().checkout.status).toBe("error");
  });

  it("does not start checkout while the cart has problems", async () => {
    const views = { [STOCK_A]: view(STOCK_A) };
    const { store, startCheckout } = await checkoutSetup([], views);
    views[STOCK_A] = view(STOCK_A, {
      available: false,
      unavailableReason: "sold_out",
      maxQuantity: 0,
    });
    await store.refresh();

    await store.checkout();

    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("shows a rate-limit message and recovers after the back button", async () => {
    const { store } = await checkoutSetup([
      { ok: false, code: "rate_limited" },
    ]);

    await store.checkout();
    expect(store.getSnapshot().checkout).toMatchObject({
      status: "error",
      message: { title: expect.stringContaining("många försök") },
    });

    store.resetCheckout();
    expect(store.getSnapshot().checkout.status).toBe("idle");
  });
});
