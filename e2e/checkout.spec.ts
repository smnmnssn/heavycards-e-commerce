import { devices, expect, test, type Page } from "@playwright/test";

import { expectNoAxeViolations, isolateClientIp } from "./admin-helpers";
import {
  checkoutDb,
  createTestProduct,
  disconnectCheckoutDb,
  pendingOrdersFor,
  removeCheckoutTestData,
  reserveForSomeoneElse,
  expireAtStripe,
  failDelayedPaymentAtStripe,
  outboxEmailFor,
  payAtStripe,
  sendStripeEvent,
  STRIPE_ADDRESS,
  STRIPE_CUSTOMER,
  type TestProduct,
} from "./checkout-fixtures";

/*
 * Checkout (Milestone 8) against the fake payment gateway
 * (PAYMENT_GATEWAY=fake). The fake returns checkout.stripe.com URLs; this
 * spec intercepts that origin, so no request ever reaches Stripe and no
 * payment is completed. Payment completion is Milestone 9.
 */

const STRIPE_PAGE =
  /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_fake[0-9a-f]+$/;

test.beforeAll(removeCheckoutTestData);
test.afterAll(async () => {
  await removeCheckoutTestData();
  await disconnectCheckoutDb();
});

test.beforeEach(async ({ context }) => {
  await isolateClientIp(context);
  // Stand-in for Stripe's hosted page; nothing leaves the test machine.
  await context.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><title>Stripe (test)</title><h1>Stripe test page</h1></html>',
    }),
  );
});

const cartButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Kundvagn/ });
const badge = (page: Page) => page.getByTestId("cart-badge");
const drawer = (page: Page) =>
  page.getByRole("dialog", { name: /Din kundvagn/ });
const checkoutButton = (page: Page) =>
  drawer(page).getByRole("button", { name: "Till kassan" });
const checkoutError = (page: Page) =>
  drawer(page).getByTestId("checkout-error");

/** Stores a cart in the browser exactly as the storefront does. */
async function plantCart(
  page: Page,
  lines: Array<{ product: TestProduct; quantity: number }>,
) {
  await page.goto("/");
  await page.evaluate(
    (value) => window.localStorage.setItem("heavycards:cart", value),
    JSON.stringify({
      v: 1,
      lines: lines.map(({ product, quantity }) => ({
        id: product.id,
        q: quantity,
      })),
    }),
  );
  await page.reload();
}

async function openCart(page: Page) {
  await cartButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByTestId("cart-line").first()).toBeVisible();
}

test.describe("starting checkout", () => {
  test("cart → Till kassan leaves for Stripe with a pending order and keeps the cart", async ({
    page,
  }) => {
    const product = await createTestProduct({ stockOnHand: 5 });
    await page.goto(`/pokemon-tcg/${product.slug}`);
    await page
      .getByTestId("add-to-cart")
      .getByRole("button", { name: "Öka antal" })
      .click();
    await page
      .getByTestId("add-to-cart")
      .getByRole("button", { name: /Lägg i kundvagn/ })
      .click();
    await expect(badge(page)).toHaveText("2");

    await openCart(page);
    await expect(drawer(page)).toContainText("Du betalar säkert via Stripe.");
    await checkoutButton(page).click();

    await expect(page).toHaveURL(STRIPE_PAGE);

    const [order] = await pendingOrdersFor(product.id);
    expect(order).toMatchObject({
      paymentStatus: "PENDING",
      subtotalAmount: 99_800,
      shippingAmount: 7_900, // below the seeded free-shipping threshold
      totalAmount: 107_700,
      customerName: null,
    });
    expect(order!.items).toMatchObject([
      { quantity: 2, unitPriceAmount: 49_900, totalPriceAmount: 99_800 },
    ]);
    expect(order!.reservations).toMatchObject([
      { status: "ACTIVE", quantity: 2 },
    ]);
    expect(order!.stripeCheckoutSessionId).toBe(
      new URL(page.url()).pathname.split("/").pop(),
    );
    const stored = await checkoutDb().product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(stored.stockOnHand).toBe(5); // reduced only after payment (M9)

    // Coming back to the store: the cart is untouched.
    await page.goto("/");
    await expect(badge(page)).toHaveText("2");
  });

  test("cancel returns to an intact cart and resumes the same payment session", async ({
    page,
  }) => {
    const product = await createTestProduct();
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);
    await checkoutButton(page).click();
    await expect(page).toHaveURL(STRIPE_PAGE);
    const firstSession = page.url();

    // Stripe's cancel_url.
    await page.goto("/kassa/avbruten");
    await expect(
      page.getByRole("heading", { level: 1, name: "Betalningen avbröts" }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText(
      "Din kundvagn finns kvar",
    );
    await expect(badge(page)).toHaveText("1");
    await expectNoAxeViolations(page);

    await page
      .getByRole("main")
      .getByRole("button", { name: "Visa kundvagnen" })
      .click();
    await expect(drawer(page)).toBeVisible();
    await checkoutButton(page).click();

    // Same attempt: same order and session, no second reservation.
    await expect(page).toHaveURL(firstSession);
    const orders = await pendingOrdersFor(product.id);
    expect(orders).toHaveLength(1);
  });

  test("a changed cart starts a new attempt and releases the previous one", async ({
    page,
  }) => {
    const product = await createTestProduct({ stockOnHand: 1 });
    const other = await createTestProduct();
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);
    await checkoutButton(page).click();
    await expect(page).toHaveURL(STRIPE_PAGE);

    await page.goto("/kassa/avbruten");
    await page.evaluate(
      (value) => window.localStorage.setItem("heavycards:cart", value),
      JSON.stringify({
        v: 1,
        lines: [
          { id: product.id, q: 1 },
          { id: other.id, q: 1 },
        ],
      }),
    );
    await page.reload();
    await openCart(page);
    await expect(drawer(page).getByTestId("cart-line")).toHaveCount(2);
    await checkoutButton(page).click();

    // The last unit was held by this customer's own earlier attempt.
    await expect(page).toHaveURL(STRIPE_PAGE);
    const orders = await pendingOrdersFor(product.id);
    expect(orders.map((o) => o.paymentStatus)).toEqual(["EXPIRED", "PENDING"]);
    expect(orders[0]!.reservations[0]!.status).toBe("RELEASED");
  });
});

test.describe("return page", () => {
  test("does not claim the order is paid", async ({ page }) => {
    const product = await createTestProduct();
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);
    await checkoutButton(page).click();
    await expect(page).toHaveURL(STRIPE_PAGE);
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    const [order] = await pendingOrdersFor(product.id);

    // Stripe's success_url, opened without any payment having happened.
    await page.goto(`/kassa/bekraftelse?session_id=${sessionId}`);

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", {
        level: 1,
        name: "Tack! Vi kontrollerar din betalning.",
      }),
    ).toBeVisible();
    await expect(main).toContainText(`HC-${order!.orderNumber}`);
    await expect(main).not.toContainText("Betalningen är bekräftad");
    await expect(main).not.toContainText(/betald|betalat/i);
    await expectNoAxeViolations(page);

    // Visiting the URL changed nothing.
    const [after] = await pendingOrdersFor(product.id);
    expect(after!.paymentStatus).toBe("PENDING");
    expect(after!.paidAt).toBeNull();
    await expect(badge(page)).toHaveText("1");

    const response = await page.goto(
      `/kassa/bekraftelse?session_id=${sessionId}`,
    );
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  });

  test("handles unknown and malformed session IDs", async ({ page }) => {
    for (const query of [
      "?session_id=cs_test_doesnotexist",
      "",
      "?session_id=<x>",
    ]) {
      await page.goto(`/kassa/bekraftelse${query}`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Vi hittade ingen beställning",
        }),
      ).toBeVisible();
    }
  });
});

test.describe("server validation in the drawer", () => {
  test("explains a quantity that is no longer available and lowers it", async ({
    page,
  }) => {
    const product = await createTestProduct({ stockOnHand: 2 });
    await plantCart(page, [{ product, quantity: 2 }]);
    await openCart(page);

    // Someone else reserves a unit while this customer looks at the cart.
    await reserveForSomeoneElse(product.id, 1);
    await checkoutButton(page).click();

    await expect(checkoutError(page)).toContainText("Kundvagnen har ändrats.");
    await expect(checkoutError(page)).toContainText(
      `${product.name}: Det valda antalet finns inte tillgängligt. Det finns 1 kvar.`,
    );
    await expect(drawer(page)).toContainText(
      "Antalet har ändrats från 2 till 1",
    );
    await expect(page).not.toHaveURL(STRIPE_PAGE);
    await expectNoAxeViolations(page);

    await checkoutButton(page).click();
    await expect(page).toHaveURL(STRIPE_PAGE);
  });

  test("explains a product that sold out and blocks checkout", async ({
    page,
  }) => {
    const product = await createTestProduct({ stockOnHand: 1 });
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);

    await reserveForSomeoneElse(product.id, 1);
    await checkoutButton(page).click();

    await expect(checkoutError(page)).toContainText(
      `${product.name}: Produkten är slutsåld och kan inte beställas just nu.`,
    );
    await expect(checkoutButton(page)).toBeDisabled();
    expect(await pendingOrdersFor(product.id)).toEqual([]);
  });

  test("never charges a price the customer was not shown", async ({ page }) => {
    const product = await createTestProduct({ priceAmount: 49_900 });
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);
    await expect(drawer(page)).toContainText(/499\skr/);

    await checkoutDb().product.update({
      where: { id: product.id },
      data: { priceAmount: 59_900 },
    });
    await checkoutButton(page).click();

    await expect(checkoutError(page)).toContainText(
      /Priset har ändrats från 499\skr till 599\skr/,
    );
    await expect(drawer(page)).toContainText(/599\skr/);
    expect(await pendingOrdersFor(product.id)).toEqual([]);

    await checkoutButton(page).click();
    await expect(page).toHaveURL(STRIPE_PAGE);
    const [order] = await pendingOrdersFor(product.id);
    expect(order!.items[0]!.unitPriceAmount).toBe(59_900);
  });

  test("preorder conflicts are blocked in the drawer and refused by the server", async ({
    page,
  }) => {
    const stock = await createTestProduct();
    const preorder = await createTestProduct({
      isPreorder: true,
      releaseInDays: 40,
    });
    await plantCart(page, [
      { product: stock, quantity: 1 },
      { product: preorder, quantity: 1 },
    ]);
    await openCart(page);
    await expect(drawer(page)).toContainText(
      "Förbeställningar och lagerförda produkter behöver beställas separat.",
    );
    await expect(checkoutButton(page)).toBeDisabled();

    // A request crafted outside the UI is refused just the same.
    const response = await page.request.post("/api/checkout", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        attemptId: crypto.randomUUID(),
        lines: [stock, preorder].map((product) => ({
          productId: product.id,
          quantity: 1,
          expectedUnitPriceAmount: product.priceAmount,
        })),
      },
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "rejected",
      conflict: "preorder_with_stock",
    });
    expect(await pendingOrdersFor(stock.id)).toEqual([]);
  });

  test("refuses cross-site checkout requests", async ({ page }) => {
    const product = await createTestProduct();
    await page.goto("/");
    const response = await page.request.post("/api/checkout", {
      headers: { Origin: "https://evil.example" },
      data: {
        attemptId: crypto.randomUUID(),
        lines: [
          {
            productId: product.id,
            quantity: 1,
            expectedUnitPriceAmount: product.priceAmount,
          },
        ],
      },
    });
    expect(response.status()).toBe(403);
  });
});

// The project's browser stays; only the phone's viewport and input change.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
  devices["Pixel 7"];

test.describe("on a phone", () => {
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("starts checkout from the mobile drawer", async ({ page }) => {
    const product = await createTestProduct();
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);

    await expect(checkoutButton(page)).toBeInViewport();
    await checkoutButton(page).tap();

    await expect(page).toHaveURL(STRIPE_PAGE);
  });

  test("shows checkout errors within the viewport", async ({ page }) => {
    const product = await createTestProduct({ stockOnHand: 1 });
    await plantCart(page, [{ product, quantity: 1 }]);
    await openCart(page);
    await reserveForSomeoneElse(product.id, 1);

    await checkoutButton(page).tap();

    await expect(checkoutError(page)).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });
});

// --- Milestone 9: payment outcomes from verified Stripe events ---------------------

/** Cart → Till kassan → (fake) Stripe; returns the Checkout Session ID. */
async function goToStripe(
  page: Page,
  lines: Array<{ product: TestProduct; quantity: number }>,
) {
  await plantCart(page, lines);
  await openCart(page);
  await checkoutButton(page).click();
  await expect(page).toHaveURL(STRIPE_PAGE);
  return new URL(page.url()).pathname.split("/").pop()!;
}

const confirmation = (sessionId: string) =>
  `/kassa/bekraftelse?session_id=${sessionId}`;
const mainContent = (page: Page) => page.getByRole("main");
const heading = (page: Page, name: string) =>
  page.getByRole("main").getByRole("heading", { level: 1, name });

test.describe("payment outcomes", () => {
  test("a verified payment shows the confirmation, finalizes stock and clears the bought items", async ({
    page,
  }) => {
    const product = await createTestProduct({
      stockOnHand: 5,
      priceAmount: 49_900,
    });
    const sessionId = await goToStripe(page, [{ product, quantity: 2 }]);

    await payAtStripe(sessionId);
    const response = await sendStripeEvent(
      page.request,
      "checkout.session.completed",
      sessionId,
    );
    expect(response.status()).toBe(200);
    await page.goto(confirmation(sessionId));

    const main = page.getByRole("main");
    await expect(heading(page, "Tack för din beställning!")).toBeVisible();
    await expect(main).toContainText("Betalningen är bekräftad.");
    await expect(main).toContainText(product.name);
    await expect(main).toContainText("2 st");
    await expect(main).toContainText(/1\s077\skr/); // 2 × 499 + 79 shipping
    // No personal data on a page reachable through a link.
    for (const value of [
      STRIPE_CUSTOMER.shippingName,
      STRIPE_CUSTOMER.email,
      STRIPE_CUSTOMER.phone,
      STRIPE_ADDRESS.line1,
    ]) {
      await expect(main).not.toContainText(value);
    }
    expect(await page.content()).not.toContain(STRIPE_CUSTOMER.email);
    // The bought items leave this browser's cart.
    await expect(badge(page)).toHaveCount(0);
    await expectNoAxeViolations(page);

    const [order] = await pendingOrdersFor(product.id);
    expect(order).toMatchObject({
      paymentStatus: "PAID",
      customerName: STRIPE_CUSTOMER.shippingName,
      email: STRIPE_CUSTOMER.email,
      addressLine1: STRIPE_ADDRESS.line1,
      country: "SE",
    });
    expect(order!.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
    const stored = await checkoutDb().product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(stored.stockOnHand).toBe(3);

    // Reloading the confirmation removes nothing more.
    await page.goto("/");
    await page.evaluate(
      (value) => window.localStorage.setItem("heavycards:cart", value),
      JSON.stringify({ v: 1, lines: [{ id: product.id, q: 1 }] }),
    );
    await page.goto(confirmation(sessionId));
    await expect(heading(page, "Tack för din beställning!")).toBeVisible();
    await expect(badge(page)).toHaveText("1");
  });

  test("a verified payment sends exactly one order confirmation email (Milestone 10)", async ({
    page,
  }) => {
    const product = await createTestProduct({
      stockOnHand: 3,
      priceAmount: 29_900,
    });
    const sessionId = await goToStripe(page, [{ product, quantity: 1 }]);
    const [pending] = await pendingOrdersFor(product.id);
    const key = `order-confirmation/${pending!.id}`;

    // Opening the confirmation page while unpaid owes no email.
    await page.goto(confirmation(sessionId));
    await expect(mainContent(page)).toContainText(
      "Vi kontrollerar din betalning",
    );
    expect(
      await checkoutDb().emailDelivery.count({
        where: { orderId: pending!.id },
      }),
    ).toBe(0);

    await payAtStripe(sessionId);
    for (let i = 0; i < 3; i += 1) {
      const response = await sendStripeEvent(
        page.request,
        "checkout.session.completed",
        sessionId,
      );
      expect(response.status()).toBe(200);
    }

    // Delivered after the webhook response, by the outbox.
    await expect
      .poll(
        async () =>
          (
            await checkoutDb().emailDelivery.findMany({
              where: { orderId: pending!.id },
            })
          ).map(({ kind, status, attempts }) => ({ kind, status, attempts })),
        { timeout: 10_000 },
      )
      .toEqual([{ kind: "ORDER_CONFIRMATION", status: "SENT", attempts: 1 }]);
    const email = await outboxEmailFor(key);
    expect(email).toMatchObject({
      to: STRIPE_CUSTOMER.email,
      subject: `Orderbekräftelse HC-${pending!.orderNumber}`,
      idempotencyKey: key,
    });
    expect(email!.text).toContain(`Hej ${STRIPE_CUSTOMER.shippingName},`);
    expect(email!.text).toContain(product.name);
    expect(email!.text).toContain(STRIPE_ADDRESS.line1);
    expect(email!.text).not.toContain(sessionId);
    const order = await checkoutDb().order.findUniqueOrThrow({
      where: { id: pending!.id },
    });
    expect(order.confirmationEmailSentAt).not.toBeNull();
    // The customer's page never shows personal data, email or not.
    await page.goto(confirmation(sessionId));
    await expect(heading(page, "Tack för din beställning!")).toBeVisible();
    await expect(mainContent(page)).not.toContainText(STRIPE_CUSTOMER.email);
  });

  test("only the purchased items are cleared; products added after starting checkout stay", async ({
    page,
  }) => {
    const bought = await createTestProduct();
    const later = await createTestProduct();
    const sessionId = await goToStripe(page, [
      { product: bought, quantity: 1 },
    ]);

    // Back in the store (or in another tab) the customer adds something else.
    await page.goto("/");
    await page.evaluate(
      (value) => window.localStorage.setItem("heavycards:cart", value),
      JSON.stringify({
        v: 1,
        lines: [
          { id: bought.id, q: 1 },
          { id: later.id, q: 2 },
        ],
      }),
    );
    await payAtStripe(sessionId);
    await sendStripeEvent(
      page.request,
      "checkout.session.completed",
      sessionId,
    );

    await page.goto(confirmation(sessionId));

    await expect(heading(page, "Tack för din beställning!")).toBeVisible();
    await expect(badge(page)).toHaveText("2");
    await cartButton(page).click();
    await expect(drawer(page).getByTestId("cart-line")).toHaveCount(1);
    await expect(drawer(page)).toContainText(later.name);
  });

  test("another browser opening the confirmation link keeps its own cart", async ({
    page,
    browser,
  }) => {
    const product = await createTestProduct();
    const sessionId = await goToStripe(page, [{ product, quantity: 1 }]);
    await payAtStripe(sessionId);
    await sendStripeEvent(
      page.request,
      "checkout.session.completed",
      sessionId,
    );

    const other = await browser.newPage();
    try {
      await plantCart(other, [{ product, quantity: 1 }]);
      await other.goto(confirmation(sessionId));
      await expect(heading(other, "Tack för din beställning!")).toBeVisible();
      await expect(badge(other)).toHaveText("1");
    } finally {
      await other.close();
    }
  });

  test("while pending the page says so, then updates by itself once Stripe confirms", async ({
    page,
  }) => {
    const product = await createTestProduct();
    const sessionId = await goToStripe(page, [{ product, quantity: 1 }]);

    await page.goto(confirmation(sessionId));
    await expect(
      heading(page, "Tack! Vi kontrollerar din betalning."),
    ).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(
      "Betalningen är bekräftad",
    );
    await expect(badge(page)).toHaveText("1"); // nothing cleared yet

    await payAtStripe(sessionId);
    await sendStripeEvent(
      page.request,
      "checkout.session.completed",
      sessionId,
    );

    await expect(heading(page, "Tack för din beställning!")).toBeVisible({
      timeout: 15_000,
    });
    await expect(badge(page)).toHaveCount(0);
  });

  test("an expired checkout says so and keeps the cart", async ({ page }) => {
    const product = await createTestProduct({ stockOnHand: 1 });
    const sessionId = await goToStripe(page, [{ product, quantity: 1 }]);

    await expireAtStripe(sessionId);
    await sendStripeEvent(page.request, "checkout.session.expired", sessionId);
    await page.goto(confirmation(sessionId));

    await expect(heading(page, "Betalningen genomfördes inte")).toBeVisible();
    await expect(badge(page)).toHaveText("1");
    const [order] = await pendingOrdersFor(product.id);
    expect(order).toMatchObject({ paymentStatus: "EXPIRED" });
    expect(order!.reservations[0]!.status).toBe("RELEASED");
    await expectNoAxeViolations(page);
  });

  test("a failed delayed payment says so and keeps the cart", async ({
    page,
  }) => {
    const product = await createTestProduct();
    const sessionId = await goToStripe(page, [{ product, quantity: 1 }]);
    await payAtStripe(sessionId, { async: true });
    await sendStripeEvent(
      page.request,
      "checkout.session.completed",
      sessionId,
    );

    await page.goto(confirmation(sessionId));
    await expect(
      heading(page, "Tack! Vi kontrollerar din betalning."),
    ).toBeVisible();

    await failDelayedPaymentAtStripe(sessionId);
    await sendStripeEvent(
      page.request,
      "checkout.session.async_payment_failed",
      sessionId,
    );
    await page.reload();

    await expect(heading(page, "Betalningen gick inte igenom")).toBeVisible();
    await expect(badge(page)).toHaveText("1");
    const [order] = await pendingOrdersFor(product.id);
    expect(order).toMatchObject({ paymentStatus: "FAILED" });
  });

  test("the webhook refuses unsigned or wrongly signed events", async ({
    page,
  }) => {
    const product = await createTestProduct();
    const sessionId = await goToStripe(page, [{ product, quantity: 1 }]);
    await payAtStripe(sessionId);

    const forged = await sendStripeEvent(
      page.request,
      "checkout.session.completed",
      sessionId,
      { secret: "whsec_forged" },
    );
    const unsigned = await page.request.post("/api/stripe/webhook", {
      data: { type: "checkout.session.completed" },
    });

    expect(forged.status()).toBe(400);
    expect(unsigned.status()).toBe(400);
    const [order] = await pendingOrdersFor(product.id);
    expect(order).toMatchObject({ paymentStatus: "PENDING" });
  });

  test("the reconciliation endpoint is not public", async ({ page }) => {
    const response = await page.request.get("/api/cron/reconcile-checkouts");
    expect(response.status()).toBe(401);
  });
});
