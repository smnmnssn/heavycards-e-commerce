import { randomUUID } from "node:crypto";

import { devices, expect, test, type Page } from "@playwright/test";

import {
  expectNoAxeViolations,
  isolateClientIp,
  login,
  SEEDED_ADMIN,
  SEEDED_OWNER,
  seededPassword,
} from "./admin-helpers";
import {
  createOpsOrder,
  createOpsProduct,
  createPendingReview,
  orderState,
  recordAttention,
  removeOpsTestData,
  restoreStoreSettings,
  snapshotStoreSettings,
  uniqueContactEmail,
} from "./admin-operations-fixtures";
import {
  checkoutDb,
  disconnectCheckoutDb,
  outboxEmailFor,
  patchFakeSession,
  payAtStripe,
  sendStripeEvent,
} from "./checkout-fixtures";

/*
 * Milestone 12: the owner's daily work in /admin — dashboard, orders,
 * fulfillment with the shipping email, refunds, needs-attention problems,
 * review moderation and store settings — through the real server actions.
 * No Stripe or Resend: the test server uses the fake gateway and the file
 * email transport.
 */

const suiteStart = new Date();

test.beforeAll(async () => {
  await removeOpsTestData();
  await snapshotStoreSettings();
});
test.afterAll(async () => {
  await restoreStoreSettings();
  await removeOpsTestData(suiteStart);
  await disconnectCheckoutDb();
});
test.beforeEach(async ({ context }) => {
  await isolateClientIp(context);
});

async function signIn(page: Page, email = SEEDED_ADMIN) {
  await login(page, email, seededPassword());
  await expect(page).toHaveURL("/admin");
}

const hc = (orderNumber: number) => `HC-${orderNumber}`;

async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.describe("dashboard and orders", () => {
  test("signing in lands on a dashboard with work to do", async ({ page }) => {
    const product = await createOpsProduct("Översiktsbox");
    const order = await createOpsOrder(product);

    await signIn(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hej");
    const work = page.getByRole("region", { name: "Att göra" });
    await expect(work.getByText("Nya beställningar")).toBeVisible();
    await expect(work.getByText("Recensioner att granska")).toBeVisible();
    await expect(
      page.getByRole("region", { name: /Försäljning senaste 30 dagarna/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Senaste beställningar" })
        .getByRole("link", { name: hc(order.orderNumber) }),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await work.getByRole("link", { name: /Nya beställningar/ }).click();
    await expect(page).toHaveURL(
      "/admin/orders?betalning=betalda&leverans=NEW",
    );
    await expect(
      page
        .getByTestId("admin-order-row")
        .filter({ hasText: hc(order.orderNumber) }),
    ).toBeVisible();
  });

  test("searches orders and opens one with its historic details", async ({
    page,
  }) => {
    const product = await createOpsProduct("Sökbar Elite Trainer Box", {
      priceAmount: 64_900,
    });
    const order = await createOpsOrder(product, {}, 2);
    // History must not follow later product edits.
    await checkoutDb().product.update({
      where: { id: product.id },
      data: { name: `${product.name} (omdöpt)`, priceAmount: 99_900 },
    });

    await signIn(page);
    await page.goto("/admin/orders");
    const search = page.getByRole("search", { name: "Filtrera beställningar" });
    await search.getByLabel("Sök").fill(hc(order.orderNumber));
    await search.getByRole("button", { name: "Filtrera" }).click();

    const rows = page.getByTestId("admin-order-row");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(order.customerName!);
    // The list shows the name only, no contact details.
    await expect(rows).not.toContainText(order.email!);

    await search.getByLabel("Sök").fill(order.email!);
    await search.getByLabel("Leverans").selectOption("NEW");
    await search.getByRole("button", { name: "Filtrera" }).click();
    await expect(rows).toHaveCount(1);
    await expectNoAxeViolations(page);

    await rows.getByRole("link", { name: hc(order.orderNumber) }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: hc(order.orderNumber) }),
    ).toBeVisible();
    const customer = page.getByRole("region", { name: "Kund", exact: true });
    await expect(customer).toContainText(order.customerName!);
    await expect(customer).toContainText(order.email!);
    await expect(customer).toContainText("+46701234567");
    await expect(customer).toContainText("Driftgatan 12");
    await expect(customer).toContainText("411 19 Göteborg");

    const items = page.getByRole("region", { name: "Artiklar" });
    await expect(items).toContainText(product.name);
    await expect(items).not.toContainText("(omdöpt)");
    await expect(items).toContainText(`SKU ${product.sku}`);
    await expect(items).toContainText(/2 × 649,00\s?kr/);
    await expect(items).toContainText(/Totalt\s*1\s?377,00\s?kr/);

    const payment = page.getByRole("region", { name: "Betalning" });
    await expect(payment).toContainText(order.stripePaymentIntentId!);
    await expect(
      payment.getByRole("link", { name: /Öppna betalningen i Stripe/ }),
    ).toHaveAttribute(
      "href",
      `https://dashboard.stripe.com/test/payments/${order.stripePaymentIntentId}`,
    );
    await expectNoAxeViolations(page);
  });

  test("moves a paid order through fulfillment and sends the shipping email once", async ({
    page,
  }) => {
    const product = await createOpsProduct("Leveransbox");
    const order = await createOpsOrder(product);

    await signIn(page);
    await page.goto(`/admin/orders/${order.id}`);
    const delivery = page.getByRole("region", { name: "Leverans" });

    await delivery
      .getByRole("button", { name: "Markera som behandlas" })
      .click();
    await expect(delivery.getByRole("status")).toHaveText(
      "Leveransstatus: Behandlas.",
    );

    await delivery.getByLabel("Fraktbolag").selectOption("POSTNORD");
    await delivery
      .getByLabel("Spårningsnummer (valfritt)")
      .fill("RR123456785SE");
    await delivery.getByRole("button", { name: "Markera som skickad" }).click();
    await expect(delivery.getByRole("status")).toContainText(
      "Beställningen är markerad som skickad.",
    );
    await expect(delivery).toContainText("RR123456785SE");

    // One shipping email, with the tracking number and the review link,
    // sent after the response by the outbox.
    await expect
      .poll(() => outboxEmailFor(`order-shipped/${order.id}`), {
        timeout: 10_000,
      })
      .not.toBeNull();
    const email = await outboxEmailFor(`order-shipped/${order.id}`);
    expect(email!.to).toBe(order.email);
    expect(email!.text).toContain("RR123456785SE");
    expect(email!.text).toMatch(/\/review\/[\w-]{43}/);
    await expect
      .poll(async () => (await orderState(order.id)).emailDeliveries)
      .toMatchObject([{ kind: "ORDER_SHIPPED", status: "SENT", attempts: 1 }]);
    await expect(
      page.getByRole("region", { name: "E-post till kunden" }),
    ).toBeVisible();

    // Correcting the tracking number sends nothing new.
    await page.reload();
    await delivery
      .getByLabel("Spårningsnummer (valfritt)")
      .fill("RR987654321SE");
    await delivery
      .getByRole("button", { name: "Spara spårningsuppgifter" })
      .click();
    await expect(delivery.getByRole("status")).toHaveText(
      "Spårningsuppgifterna är uppdaterade. Inget nytt mejl skickas.",
    );
    // Saving again without changes is a no-op.
    await delivery
      .getByRole("button", { name: "Spara spårningsuppgifter" })
      .click();
    await expect(delivery.getByRole("status")).toHaveText("Inget att ändra.");

    const state = await orderState(order.id);
    expect(state).toMatchObject({
      fulfillmentStatus: "SHIPPED",
      trackingNumber: "RR987654321SE",
    });
    expect(state.emailDeliveries).toHaveLength(1);
    expect(state.emailDeliveries[0]!.attempts).toBe(1);
    expect(state.reviewToken).not.toBeNull();
    expect((await outboxEmailFor(`order-shipped/${order.id}`))!.text).toContain(
      "RR123456785SE",
    );

    await delivery
      .getByRole("button", { name: "Markera som slutförd" })
      .click();
    await expect(delivery.getByRole("status")).toHaveText(
      "Leveransstatus: Slutförd.",
    );
    const history = page.getByTestId("order-timeline");
    await expect(history).toContainText("Ny → Behandlas");
    await expect(history).toContainText("Behandlas → Skickad");
    await expect(history).toContainText("Spårningsuppgifter ändrade");
    await expect(history).toContainText("Skickad → Slutförd");
    await expectNoAxeViolations(page);
  });

  test("shows a Stripe refund without a refund button or restocking", async ({
    page,
  }) => {
    const product = await createOpsProduct("Återbetald box", {
      stockOnHand: 7,
    });
    const order = await createOpsOrder(product, {
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmount: 10_000,
    });

    await signIn(page);
    await page.goto(`/admin/orders/${order.id}`);
    const payment = page.getByRole("region", { name: "Betalning" });
    await expect(payment).toContainText("Delvis återbetald");
    await expect(payment).toContainText(/Återbetalt\s*100,00\s?kr/);
    await expect(page.getByTestId("refund-explanation")).toContainText(
      "Återbetalningar görs i Stripe Dashboard och synkas hit automatiskt.",
    );
    await expect(page.getByTestId("refund-explanation")).toContainText(
      "Lagret ändras inte vid återbetalning",
    );
    await expect(page.getByRole("button", { name: /återbetal/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("region", { name: "Artiklar" })).toContainText(
      /Netto efter återbetalning/,
    );
    expect(
      (
        await checkoutDb().product.findUniqueOrThrow({
          where: { id: product.id },
        })
      ).stockOnHand,
    ).toBe(7);
  });

  test("surfaces a payment problem until staff mark it handled", async ({
    page,
  }) => {
    const product = await createOpsProduct("Avvikelsebox");
    const order = await createOpsOrder(product, {
      paymentStatus: "PENDING",
      paidAt: null,
      email: null,
      customerName: null,
      phone: null,
      addressLine1: null,
      postalCode: null,
      city: null,
      confirmationEmailSentAt: null,
    });
    await recordAttention(order.id, "PAYMENT_NEEDS_ATTENTION", {
      problem: "amount_mismatch",
      source: "webhook",
    });

    await signIn(page);
    const attention = page.getByTestId("dashboard-attention");
    await expect(attention).toContainText(hc(order.orderNumber));
    await expect(attention).toContainText(
      "Beloppet hos Stripe stämmer inte med beställningens total.",
    );
    await attention.getByRole("link", { name: hc(order.orderNumber) }).click();

    const problem = page.getByTestId("order-attention");
    await expect(problem).toContainText("Kontrollera betalningen i Stripe");
    await problem
      .getByRole("button", { name: /^Markera som hanterat/ })
      .click();
    await expect(page.getByTestId("order-attention")).toHaveCount(0);
    await expect(page.getByTestId("order-timeline")).toContainText(
      "Markerat som hanterat (betalning).",
    );
    // The order itself is unchanged.
    expect((await orderState(order.id)).paymentStatus).toBe("PENDING");

    await page.goto("/admin");
    await expect(page.getByTestId("dashboard-attention")).not.toContainText(
      hc(order.orderNumber),
    );
  });

  test("a payment problem that still holds stock cannot be hidden, only settled by Stripe", async ({
    page,
    request,
  }) => {
    const product = await createOpsProduct("Reserverad box", {
      stockOnHand: 3,
    });
    // A real checkout, then Stripe reports the payment with a wrong amount:
    // the payment service keeps the units reserved and flags the order.
    await page.goto("/");
    const started = await page.request.post("/api/checkout", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        attemptId: randomUUID(),
        lines: [
          {
            productId: product.id,
            quantity: 2,
            expectedUnitPriceAmount: product.priceAmount,
          },
        ],
      },
    });
    expect(started.status()).toBe(200);
    const pending = await checkoutDb().order.findFirstOrThrow({
      where: { items: { some: { productId: product.id } } },
    });
    const sessionId = pending.stripeCheckoutSessionId!;
    await payAtStripe(sessionId);
    await patchFakeSession(sessionId, (session) => ({
      ...session,
      amountTotal: 1,
    }));
    expect(
      (
        await sendStripeEvent(request, "checkout.session.completed", sessionId)
      ).status(),
    ).toBe(200);

    await signIn(page);
    await page.goto(`/admin/orders/${pending.id}`);
    const problem = page.getByTestId("order-attention");
    await expect(problem).toContainText(
      "Beloppet hos Stripe stämmer inte med beställningens total.",
    );
    await expect(problem.getByTestId("attention-blocking")).toContainText(
      "2 st i lager är reserverade",
    );
    // No way to acknowledge it away while the stock is held.
    await expect(
      problem.getByRole("button", { name: /^Markera som hanterat/ }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Stripe still disagrees: nothing changes.
    const recheck = problem.getByRole("button", {
      name: "Kontrollera med Stripe igen",
    });
    await recheck.click();
    await expect(problem.getByRole("status")).toContainText(
      "Lagret förblir reserverat och problemet ligger kvar.",
    );
    const holds = () =>
      checkoutDb().inventoryReservation.findMany({
        where: { orderId: pending.id },
        select: { status: true },
      });
    expect(await holds()).toEqual([{ status: "ACTIVE" }]);
    await page.goto("/admin");
    await expect(page.getByTestId("dashboard-attention")).toContainText(
      hc(pending.orderNumber),
    );

    // Stripe now reports the checkout expired, never paid: the payment
    // service releases the stock, and only then can it be acknowledged.
    await patchFakeSession(sessionId, (session) => ({
      ...session,
      status: "expired",
      paymentStatus: "unpaid",
      paymentIntent: null,
    }));
    await page.goto(`/admin/orders/${pending.id}`);
    await page
      .getByTestId("order-attention")
      .getByRole("button", { name: "Kontrollera med Stripe igen" })
      .click();
    await expect(
      page.getByTestId("order-attention").getByRole("status"),
    ).toContainText("Reservationen är släppt");
    expect(await holds()).toEqual([{ status: "RELEASED" }]);
    expect((await orderState(pending.id)).paymentStatus).toBe("EXPIRED");
    await expect(page.getByTestId("attention-blocking")).toHaveCount(0);
    await page
      .getByTestId("order-attention")
      .getByRole("button", { name: /^Markera som hanterat/ })
      .click();
    await expect(page.getByTestId("order-attention")).toHaveCount(0);
  });
});

test.describe("reviews", () => {
  test("moderating a pending review publishes it on the product page", async ({
    page,
  }) => {
    const product = await createOpsProduct("Recenserad box");
    const body = `Fint skick och snabb leverans ${randomUUID().slice(0, 6)}.`;
    await createPendingReview(product, body);

    // Warm the product page cache: the pending review is not public.
    await page.goto(`/pokemon-tcg/${product.slug}`);
    await expect(page.getByText(body)).toHaveCount(0);

    await signIn(page);
    await page
      .getByRole("navigation", { name: "Adminmeny" })
      .getByRole("link", { name: "Recensioner" })
      .click();
    const card = page.getByTestId("admin-review").filter({ hasText: body });
    await expect(card).toContainText(product.name);
    await expect(card).toContainText("Verifierat köp");
    await expect(card).toContainText("5 av 5");
    await expect(card).toContainText("Olle O.");
    await expectNoAxeViolations(page);
    await expect(
      card.getByRole("button", { name: /Radera|Ta bort/ }),
    ).toHaveCount(0);

    await card
      .getByRole("button", { name: `Godkänn recensionen av ${product.name}` })
      .click();
    await expect(card).toHaveCount(0);

    await page.goto(`/pokemon-tcg/${product.slug}`);
    await expect(page.getByText(body)).toBeVisible();

    // A rejection takes it off the product page again.
    await page.goto("/admin/reviews?status=APPROVED&sortering=nyast");
    await page
      .getByTestId("admin-review")
      .filter({ hasText: body })
      .getByRole("button", { name: `Avvisa recensionen av ${product.name}` })
      .click();
    await expect(
      page.getByTestId("admin-review").filter({ hasText: body }),
    ).toHaveCount(0);
    await page.goto(`/pokemon-tcg/${product.slug}`);
    await expect(page.getByText(body)).toHaveCount(0);
  });
});

test.describe("store settings", () => {
  test("an OWNER changes contact email and shipping price; the store follows", async ({
    page,
  }) => {
    const original = await checkoutDb().storeSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const email = uniqueContactEmail();
    const product = await createOpsProduct("Fraktbox", { priceAmount: 39_900 });

    await signIn(page, SEEDED_OWNER);
    await page
      .getByRole("navigation", { name: "Adminmeny" })
      .getByRole("link", { name: "Inställningar" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Inställningar" }),
    ).toBeVisible();
    await expect(
      page.getByText("Tekniska inställningar finns inte här"),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    // Browser validation first, in Swedish.
    const shipping = page.getByLabel("Fraktpris (kr, inkl. moms)");
    await shipping.fill("sju kronor");
    await shipping.blur();
    await expect(page.getByText(/Ange fraktpriset i kronor/)).toBeVisible();

    await shipping.fill("59");
    await page.getByLabel("Kundtjänstens e-post").fill(email);
    await page.getByRole("button", { name: "Spara inställningar" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Butiksinställningarna är sparade." }),
    ).toBeVisible();

    // The footer of a cached information page shows the new address.
    await page.goto("/kontakt");
    await expect(page.getByRole("contentinfo")).toContainText(email);

    // The next checkout charges the new flat rate.
    const response = await page.request.post("/api/checkout", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        attemptId: randomUUID(),
        lines: [
          {
            productId: product.id,
            quantity: 1,
            expectedUnitPriceAmount: product.priceAmount,
          },
        ],
      },
    });
    expect(response.status()).toBe(200);
    const pending = await checkoutDb().order.findFirstOrThrow({
      where: { items: { some: { productId: product.id } } },
    });
    expect(pending).toMatchObject({
      shippingAmount: 5_900,
      totalAmount: 45_800,
    });

    // Restore through the UI, so the storefront is refreshed again.
    await page.goto("/admin/settings");
    await page
      .getByLabel("Fraktpris (kr, inkl. moms)")
      .fill(String(original.shippingPriceAmount / 100));
    await page.getByLabel("Kundtjänstens e-post").fill(original.contactEmail);
    await page.getByRole("button", { name: "Spara inställningar" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Butiksinställningarna är sparade." }),
    ).toBeVisible();
    await page.goto("/kontakt");
    await expect(page.getByRole("contentinfo")).toContainText(
      original.contactEmail,
    );
  });
});

test.describe("role boundaries", () => {
  test("an ADMIN reads the settings but cannot change them or manage administrators", async ({
    page,
  }) => {
    await signIn(page, SEEDED_ADMIN);
    await page.goto("/admin/settings");
    await expect(page.getByTestId("settings-summary")).toContainText(
      "Fraktpris",
    );
    await expect(
      page.getByText("Endast ägare (OWNER) kan ändra dem.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Spara inställningar" }),
    ).toHaveCount(0);

    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { level: 1, name: "Behörighet saknas" }),
    ).toBeVisible();

    // Orders and reviews are open to ADMIN.
    await page.goto("/admin/orders");
    await expect(
      page.getByRole("heading", { level: 1, name: "Beställningar" }),
    ).toBeVisible();
    await page.goto("/admin/reviews");
    await expect(
      page.getByRole("heading", { level: 1, name: "Recensioner" }),
    ).toBeVisible();
  });

  test("signed-out visitors are sent to the login page", async ({ page }) => {
    const product = await createOpsProduct("Skyddad box");
    const order = await createOpsOrder(product);
    for (const path of [
      "/admin/orders",
      `/admin/orders/${order.id}`,
      "/admin/reviews",
      "/admin/settings",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(
        `/admin/login?next=${encodeURIComponent(path)}`,
      );
    }
    await expect(page.getByText(order.customerName!)).toHaveCount(0);
  });
});

// The project's browser stays; only the phone's viewport and input change.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
  devices["Pixel 7"];

test.describe("on a phone", () => {
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("the admin menu scrolls sideways without moving the page", async ({
    page,
  }) => {
    const product = await createOpsProduct("Mobilbox");
    const order = await createOpsOrder(product);
    await signIn(page, SEEDED_OWNER);
    await noHorizontalScroll(page);

    const menu = page.getByRole("navigation", { name: "Adminmeny" });
    await menu.getByRole("link", { name: "Inställningar" }).click();
    await expect(page).toHaveURL("/admin/settings");
    const current = menu.locator('[aria-current="page"]');
    await expect(current).toHaveText("Inställningar");
    await expect(current).toBeInViewport();
    await noHorizontalScroll(page);

    await page.goto(`/admin/orders/${order.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: hc(order.orderNumber) }),
    ).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto("/admin/orders");
    await noHorizontalScroll(page);
    await expectNoAxeViolations(page);
  });
});
