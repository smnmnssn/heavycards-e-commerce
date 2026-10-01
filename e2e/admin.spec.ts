import { expect, test } from "@playwright/test";

import {
  expectNoAxeViolations,
  isolateClientIp,
  linkFromLatestEmail,
  login,
  SEEDED_ADMIN,
  SEEDED_INACTIVE,
  SEEDED_OWNER,
  seededPassword,
  uniqueEmail,
} from "./admin-helpers";

/*
 * Admin authentication journeys. Runs on desktop and mobile Chromium against
 * the seeded administrators (password from SEED_ADMIN_PASSWORD). Tests that
 * change data create their own administrators with unique addresses.
 */

const INVALID = "E-postadress eller lösenord är felaktigt.";

test.beforeEach(async ({ context }) => {
  await isolateClientIp(context);
});

test.describe("unauthenticated access", () => {
  for (const path of ["/admin", "/admin/users"]) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(
        path === "/admin"
          ? "/admin/login"
          : `/admin/login?next=${encodeURIComponent(path)}`,
      );
      await expect(
        page.getByRole("heading", { level: 1, name: "Logga in" }),
      ).toBeVisible();
    });
  }

  test("the login page is not indexable and has no axe violations", async ({
    page,
  }) => {
    const response = await page.goto("/admin/login");

    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expectNoAxeViolations(page);
  });

  test("there is no sign-up page or endpoint", async ({ page, request }) => {
    // No sign-up route exists; unknown admin paths require a session.
    await page.goto("/admin/signup");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(
      page.getByRole("link", { name: /registrera|skapa konto/i }),
    ).toHaveCount(0);

    const response = await request.post("/api/auth/sign-up/email", {
      data: {
        name: "X",
        email: uniqueEmail("signup"),
        password: "x".repeat(20),
      },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe("login", () => {
  test("shows one generic error for a wrong password and an unknown email", async ({
    page,
  }) => {
    await login(page, SEEDED_OWNER, `${seededPassword()}-fel`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(INVALID);
    await expect(page).toHaveURL("/admin/login");

    await login(page, "finns-inte@heavycards.test", seededPassword());
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(INVALID);
  });

  test("denies an inactive administrator with the same generic error", async ({
    page,
  }) => {
    await login(page, SEEDED_INACTIVE, seededPassword());

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(INVALID);
    await expect(page).toHaveURL("/admin/login");
  });

  test("works with the keyboard alone", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("E-postadress").focus();

    await page.keyboard.type(SEEDED_ADMIN);
    await page.keyboard.press("Tab"); // "Glömt lösenordet?" link
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Lösenord", { exact: true })).toBeFocused();
    await page.keyboard.type(seededPassword());
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL("/admin");
  });

  test("returns to the requested page, never to another site", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await page.getByLabel("E-postadress").fill(SEEDED_OWNER);
    await page.getByLabel("Lösenord", { exact: true }).fill(seededPassword());
    await page.getByRole("button", { name: "Logga in" }).click();
    await expect(page).toHaveURL("/admin/users");

    await page.context().clearCookies();
    await page.goto("/admin/login?next=https://evil.example/admin");
    await page.getByLabel("E-postadress").fill(SEEDED_OWNER);
    await page.getByLabel("Lösenord", { exact: true }).fill(seededPassword());
    await page.getByRole("button", { name: "Logga in" }).click();
    await expect(page).toHaveURL("/admin");
  });

  test("the forgot-password form never reveals whether an account exists", async ({
    page,
  }) => {
    await page.goto("/admin/forgot-password");
    await page.getByLabel("E-postadress").fill("finns-inte@heavycards.test");
    await page
      .getByRole("button", { name: "Skicka återställningslänk" })
      .click();

    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Om adressen tillhör ett aktivt administratörskonto",
    );
  });
});

test.describe("OWNER", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEEDED_OWNER, seededPassword());
    await expect(page).toHaveURL("/admin");
  });

  test("sees the admin shell with identity and role", async ({ page }) => {
    const identity = page.getByTestId("admin-identity");
    await expect(identity).toContainText("Utvecklingsägare");
    await expect(identity).toContainText("Ägare");
    await expect(
      page.getByRole("navigation", { name: "Adminmeny" }).getByRole("link"),
    ).toHaveText([
      "Översikt",
      "Produkter",
      "Kategorier",
      "Pokémon-set",
      "Administratörer",
    ]);
    await expectNoAxeViolations(page);
  });

  test("does not stay on the login page", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page).toHaveURL("/admin");
  });

  test("manages administrators", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Adminmeny" })
      .getByRole("link", { name: "Administratörer" })
      .click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Administratörer" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("admin-row").filter({ hasText: SEEDED_ADMIN }),
    ).toContainText("Administratör");
    await expect(
      page.getByRole("button", { name: "Skicka inbjudan" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("signs out", async ({ page }) => {
    await page.getByRole("button", { name: "Logga ut" }).click();

    await expect(page).toHaveURL("/admin/login?notice=signed-out");
    await expect(page.getByRole("main").getByRole("status")).toHaveText(
      "Du är utloggad.",
    );
    await page.goto("/admin");
    await expect(page).toHaveURL("/admin/login");
  });
});

test.describe("ADMIN", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEEDED_ADMIN, seededPassword());
    await expect(page).toHaveURL("/admin");
  });

  test("sees the shell without administrator management", async ({ page }) => {
    await expect(page.getByTestId("admin-identity")).toContainText(
      "Administratör",
    );
    await expect(
      page.getByRole("navigation", { name: "Adminmeny" }).getByRole("link"),
    ).toHaveText(["Översikt", "Produkter", "Kategorier", "Pokémon-set"]);
  });

  test("is refused administrator management on the server", async ({
    page,
  }) => {
    await page.goto("/admin/users");

    await expect(
      page.getByRole("heading", { level: 1, name: "Behörighet saknas" }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-row")).toHaveCount(0);
    await expect(page.getByText(SEEDED_OWNER)).toHaveCount(0);
  });
});

test("invitation, activation, sign-in and deactivation", async ({
  page,
  browser,
}) => {
  test.slow();
  const email = uniqueEmail("invite");
  const password = `e2e-${crypto.randomUUID()}`;

  // The OWNER invites a new administrator.
  await login(page, SEEDED_OWNER, seededPassword());
  await expect(page).toHaveURL("/admin");
  await page.goto("/admin/users");
  await page.getByLabel("Namn").fill("E2E Inbjuden");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByRole("button", { name: "Skicka inbjudan" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Inbjudan är skickad.",
  );
  await expect(
    page.getByTestId("invitation-row").filter({ hasText: email }),
  ).toBeVisible();

  // The invitee opens the emailed link in their own browser.
  const link = await linkFromLatestEmail(email);
  const inviteeContext = await browser.newContext();
  await isolateClientIp(inviteeContext);
  const invitee = await inviteeContext.newPage();
  await invitee.goto(link);
  await expect(
    invitee.getByRole("heading", { level: 1, name: "Aktivera ditt konto" }),
  ).toBeVisible();
  await expect(invitee.getByText(email)).toBeVisible();
  await expectNoAxeViolations(invitee);

  await invitee.getByLabel("Nytt lösenord").fill(password);
  await invitee.getByLabel("Upprepa lösenordet").fill(password);
  await invitee.getByRole("button", { name: "Aktivera kontot" }).click();
  await expect(invitee).toHaveURL("/admin/login?notice=activated");

  // The link cannot be used again.
  await invitee.goto(link);
  await expect(
    invitee.getByRole("heading", { name: "Inbjudan kan inte användas" }),
  ).toBeVisible();

  // The new ADMIN signs in.
  await login(invitee, email, password);
  await expect(invitee).toHaveURL("/admin");
  await expect(invitee.getByTestId("admin-identity")).toContainText(
    "E2E Inbjuden",
  );

  // The OWNER deactivates the account; the open session stops working.
  await page.reload();
  await page
    .getByTestId("admin-row")
    .filter({ hasText: email })
    .getByRole("button", { name: "Inaktivera E2E Inbjuden" })
    .click();
  await expect(
    page.getByTestId("admin-row").filter({ hasText: email }),
  ).toContainText("Inaktiv");

  await invitee.reload();
  await expect(invitee).toHaveURL("/admin/login");
  await login(invitee, email, password);
  await expect(invitee.getByRole("main").getByRole("alert")).toHaveText(
    INVALID,
  );

  await inviteeContext.close();
});
