import { randomBytes } from "node:crypto";

import { devices, expect, test, type Page } from "@playwright/test";

import { expectNoAxeViolations, isolateClientIp } from "./admin-helpers";
import { checkoutDb, disconnectCheckoutDb } from "./checkout-fixtures";
import {
  createPaidOrder,
  createReviewProduct,
  moderateAsStaff,
  removeReviewTestData,
  reviewsFor,
  shipAndReadReviewLink,
} from "./review-fixtures";

/*
 * Verified-purchase reviews (Milestone 11): the customer's path from the
 * link in the shipping email to a pending review, and moderation deciding
 * what the product page shows. No email provider is involved: the test
 * server's file transport stands in for Resend.
 */

const GENERIC_HEADING = "Länken kan inte användas";

test.beforeAll(removeReviewTestData);
test.afterAll(async () => {
  await removeReviewTestData();
  await disconnectCheckoutDb();
});

test.beforeEach(async ({ context }) => {
  await isolateClientIp(context);
});

const siteUrl = (baseURL: string | undefined) => baseURL!.replace(/\/$/, "");

const reviewLine = (page: Page, productName: string) =>
  page.getByRole("region", { name: productName });

async function fillReview(
  page: Page,
  productName: string,
  { stars, text, name }: { stars: number; text: string; name?: string },
) {
  const line = reviewLine(page, productName);
  await line
    .getByRole("radio", {
      name: stars === 1 ? "1 stjärna av 5" : `${stars} stjärnor av 5`,
    })
    .check();
  await line.getByLabel("Din recension").fill(text);
  if (name) await line.getByLabel("Namn som visas (valfritt)").fill(name);
  await line.getByRole("button", { name: "Skicka recension" }).click();
}

test.describe("review link from the shipping email", () => {
  test("opens the order's products, accepts one review per product and then closes", async ({
    page,
    baseURL,
  }) => {
    const box = await createReviewProduct("Recensionstest Booster Box");
    const packs = await createReviewProduct("Recensionstest Booster Pack");
    const order = await createPaidOrder([
      { product: box, quantity: 1 },
      { product: packs, quantity: 3 },
    ]);
    const link = await shipAndReadReviewLink(order.id, siteUrl(baseURL));
    expect(link).toMatch(
      new RegExp(`^${siteUrl(baseURL)}/review/[A-Za-z0-9_-]{43}$`),
    );

    const response = await page.goto(link);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["cache-control"]).toMatch(/no-store/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Recensera ditt köp" }),
    ).toBeVisible();
    await expect(page.getByTestId("review-line")).toHaveCount(2);
    await expect(reviewLine(page, box.name)).toContainText("1 st");
    await expect(reviewLine(page, packs.name)).toContainText("3 st");
    // Nothing about the customer is shown.
    await expect(page.locator("main")).not.toContainText("Rebecka");
    await expect(page.locator("main")).not.toContainText(
      "recensent@example.com",
    );
    await expectNoAxeViolations(page);

    // Browser validation, in Swedish, before anything is sent.
    const packLine = reviewLine(page, packs.name);
    await packLine.getByLabel("Din recension").fill("Kort");
    await packLine.getByRole("button", { name: "Skicka recension" }).click();
    await expect(packLine).toContainText(
      "Välj ett betyg mellan 1 och 5 stjärnor.",
    );
    await expect(packLine).toContainText("Skriv minst 10 tecken.");
    await expect(packLine.getByRole("radio").first()).toBeFocused();
    expect(await reviewsFor(packs.id)).toHaveLength(0);

    // The rating is usable with the keyboard alone.
    await packLine.getByRole("radio").first().press("ArrowRight");
    await packLine.getByRole("radio").nth(1).press("ArrowRight");
    await expect(
      packLine.getByRole("radio", { name: "3 stjärnor av 5" }),
    ).toBeChecked();

    await fillReview(page, box.name, {
      stars: 4,
      text: "Snabb leverans och boxen var i perfekt skick.",
      name: "Rebecka R.",
    });
    await expect(reviewLine(page, box.name).getByRole("status")).toContainText(
      "Tack för din recension!",
    );
    await expect(
      reviewLine(page, box.name).getByRole("button", {
        name: "Skicka recension",
      }),
    ).toHaveCount(0);

    const [boxReview] = await reviewsFor(box.id);
    expect(boxReview).toMatchObject({
      rating: 4,
      displayName: "Rebecka R.",
      status: "PENDING",
      verifiedPurchase: true,
      orderItemId: order.items.find((i) => i.productId === box.id)!.id,
    });

    // The typed text survived the failed attempt above; finish that one.
    await packLine
      .getByLabel("Din recension")
      .fill("Roliga paket, tre stycken.");
    await packLine.getByRole("button", { name: "Skicka recension" }).click();
    await expect(packLine.getByRole("status")).toContainText(
      "Du har nu recenserat alla produkter i beställningen.",
    );
    expect(await reviewsFor(packs.id)).toMatchObject([
      { rating: 3, displayName: "Verifierad kund", status: "PENDING" },
    ]);

    // Every entitlement is used: the link no longer opens a form.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: GENERIC_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Skicka recension" }),
    ).toHaveCount(0);
  });

  test("a reviewed product cannot be reviewed again from a second tab", async ({
    browser,
    baseURL,
  }) => {
    const product = await createReviewProduct("Recensionstest Tin");
    const order = await createPaidOrder([{ product, quantity: 1 }]);
    const link = await shipAndReadReviewLink(order.id, siteUrl(baseURL));
    const first = await browser.newPage();
    const second = await browser.newPage();
    await first.goto(link);
    await second.goto(link);

    await fillReview(first, product.name, {
      stars: 5,
      text: "Mycket fin plåtask med bra innehåll.",
    });
    await expect(
      reviewLine(first, product.name).getByRole("status"),
    ).toContainText("Tack för din recension!");
    await fillReview(second, product.name, {
      stars: 1,
      text: "Ett försök att recensera en gång till.",
    });
    await expect(
      reviewLine(second, product.name).getByRole("status"),
    ).toContainText("Du har redan recenserat den här produkten.");

    expect(await reviewsFor(product.id)).toMatchObject([{ rating: 5 }]);
    await first.close();
    await second.close();
  });

  test("invalid, expired and tampered links all get the same safe page", async ({
    page,
    baseURL,
  }) => {
    const product = await createReviewProduct("Recensionstest ETB");
    const order = await createPaidOrder([{ product, quantity: 1 }]);
    const link = await shipAndReadReviewLink(order.id, siteUrl(baseURL));
    const invitation = await checkoutDb().reviewToken.findUniqueOrThrow({
      where: { orderId: order.id },
    });

    const texts: string[] = [];
    const candidates = [
      `/review/${randomBytes(32).toString("base64url")}`, // unknown
      "/review/abc", // malformed
      `/review/${invitation.tokenHash}`, // the stored hash
      `/review/${invitation.nonce}`, // the stored nonce
      `/review/${order.id}`, // an order ID
      `${link.slice(0, -1)}${link.endsWith("A") ? "B" : "A"}`, // tampered
    ];
    for (const url of candidates) {
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: GENERIC_HEADING }),
      ).toBeVisible();
      texts.push(await page.locator("main").innerText());
    }

    // Expired: the real link, after its validity ended.
    await checkoutDb().reviewToken.update({
      where: { id: invitation.id },
      data: {
        createdAt: new Date(Date.now() - 200 * 86_400_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await page.goto(link);
    await expect(
      page.getByRole("heading", { level: 1, name: GENERIC_HEADING }),
    ).toBeVisible();
    texts.push(await page.locator("main").innerText());

    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).not.toContain(product.name);
    await expectNoAxeViolations(page);
  });
});

test.describe("moderation decides what is public", () => {
  test("a pending review stays off the product page until staff approve it", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const product = await createReviewProduct("Recensionstest Collection");
    const order = await createPaidOrder([{ product, quantity: 1 }]);
    const link = await shipAndReadReviewLink(order.id, siteUrl(baseURL));
    const text = `Granskad recension ${randomBytes(4).toString("hex")}.`;

    await page.goto(link);
    await fillReview(page, product.name, {
      stars: 5,
      text,
      name: "Moa",
    });
    await expect(
      reviewLine(page, product.name).getByRole("status"),
    ).toContainText("Tack för din recension!");

    const productPage = `/pokemon-tcg/${product.slug}`;
    await page.goto(productPage);
    const reviews = page.locator("#recensioner");
    await expect(reviews).toContainText("Inga recensioner ännu.");
    await expect(page.locator("main")).not.toContainText(text);

    const [review] = await reviewsFor(product.id);
    await moderateAsStaff(review!.id, "APPROVE");

    // The staff action here runs outside the web server, so the page
    // refreshes through its 60 s ISR window rather than on demand (the
    // admin UI calls moderateReviewAndRevalidate; see the unit tests).
    await expect
      .poll(
        async () => {
          await page.goto(productPage);
          return reviews.innerText();
        },
        { timeout: 150_000, intervals: [5_000] },
      )
      .toContain(text);
    await expect(reviews).toContainText("Verifierat köp");
    await expect(reviews).toContainText("Moa");
    await expect(reviews).toContainText("5 av 5");
    await expect(reviews).not.toContainText("Rebecka");
  });
});

// The project's browser stays; only the phone's viewport and input change.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
  devices["Pixel 7"];

test.describe("on a phone", () => {
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("the review form fits the screen", async ({ page, baseURL }) => {
    const product = await createReviewProduct("Recensionstest Mobil");
    const order = await createPaidOrder([{ product, quantity: 2 }]);
    const link = await shipAndReadReviewLink(order.id, siteUrl(baseURL));

    await page.goto(link);
    const line = reviewLine(page, product.name);
    await expect(line.getByLabel("Din recension")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await fillReview(page, product.name, {
      stars: 2,
      text: "Fungerar bra även på mobilen.",
    });
    await expect(line.getByRole("status")).toContainText(
      "Tack för din recension!",
    );
  });
});
