import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, type AdminIdentity } from "@/lib/auth/authorization";

/*
 * Milestone 12 server actions with the session and services mocked: who
 * may call them, that they delegate to the shared services, and what they
 * refresh. The services themselves run against PostgreSQL in tests/db.
 */

const requireAdmin = vi.fn();
const refresh = vi.fn();
const revalidatePath = vi.fn();
const moderateReviewAndRevalidate = vi.fn();
const submitFulfillmentForm = vi.fn();
const resolveOrderAttention = vi.fn();
const sendOrderEmailsAfterResponse = vi.fn();
const updateStoreSettings = vi.fn();
const getStoreSettingsForAdmin = vi.fn();
const reviewLinkKey = { bytes: new Uint8Array(32) };

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/db/client", () => ({ db: { marker: "db" } }));
vi.mock("next/cache", () => ({ refresh, revalidatePath }));
vi.mock("@/server/reviews/server", () => ({
  moderateReviewAndRevalidate,
  reviewLinkKey,
}));
vi.mock("@/server/email/server", () => ({ sendOrderEmailsAfterResponse }));
vi.mock("@/server/admin/orders/fulfillment-form", () => ({
  submitFulfillmentForm,
}));
vi.mock("@/server/admin/orders/attention", () => ({ resolveOrderAttention }));
vi.mock("@/server/admin/settings/store-settings", () => ({
  updateStoreSettings,
  getStoreSettingsForAdmin,
}));
const recheckOrderPayment = vi.fn();
const getCheckoutGateway = vi.fn();
const revalidateAfterInventoryChange = vi.fn();
vi.mock("@/server/admin/orders/payment-recheck", () => ({
  recheckOrderPayment,
}));
vi.mock("@/server/checkout/server", () => ({ getCheckoutGateway }));
vi.mock("@/server/payments/revalidate", () => ({
  revalidateAfterInventoryChange,
}));

const reviewActions = await import("@/app/admin/(panel)/reviews/actions");
const orderActions = await import("@/app/admin/(panel)/orders/actions");
const settingsActions = await import("@/app/admin/(panel)/settings/actions");

const identity = (role: "OWNER" | "ADMIN"): AdminIdentity => ({
  id: `${role.toLowerCase()}-id`,
  name: role,
  email: `${role.toLowerCase()}@heavycards.test`,
  role,
  sessionId: "session",
  sessionExpiresAt: new Date(),
});

const IDLE = { status: "idle" } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(identity("ADMIN"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("guard", () => {
  it("lets the sign-in redirect through", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/admin/login;307;",
    });
    requireAdmin.mockRejectedValue(redirect);
    await expect(
      reviewActions.moderateReviewAction(IDLE, form({})),
    ).rejects.toBe(redirect);
    expect(moderateReviewAndRevalidate).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind a generic message and logs only their name", async () => {
    moderateReviewAndRevalidate.mockRejectedValue(
      Object.assign(new Error("password=hunter2 connection refused"), {
        name: "PrismaClientKnownRequestError",
      }),
    );
    const result = await reviewActions.moderateReviewAction(IDLE, form({}));
    expect(result).toEqual({
      status: "error",
      message: "Något gick fel. Ladda om sidan och försök igen.",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "hunter2",
    );
  });
});

describe("review moderation action", () => {
  it("delegates to the Milestone 11 service with the posted values and refreshes", async () => {
    moderateReviewAndRevalidate.mockResolvedValue({
      ok: true,
      changed: true,
      from: "PENDING",
      to: "APPROVED",
      revalidatePaths: ["/pokemon-tcg/x"],
    });
    const result = await reviewActions.moderateReviewAction(
      IDLE,
      form({ reviewId: "r-1", decision: "APPROVE" }),
    );
    expect(moderateReviewAndRevalidate).toHaveBeenCalledWith({
      actorId: "admin-id",
      input: { reviewId: "r-1", decision: "APPROVE" },
    });
    expect(result).toEqual({
      status: "success",
      message: "Recensionen är godkänd och visas på produktsidan.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("turns a ForbiddenError from the service into a Swedish message", async () => {
    moderateReviewAndRevalidate.mockRejectedValue(new ForbiddenError());
    expect(
      await reviewActions.moderateReviewAction(
        IDLE,
        form({ reviewId: "r", decision: "REJECT" }),
      ),
    ).toEqual({
      status: "error",
      message: "Du har inte behörighet att moderera recensioner.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports refused transitions without refreshing", async () => {
    moderateReviewAndRevalidate.mockResolvedValue({
      ok: false,
      error: "INVALID_TRANSITION",
      from: "APPROVED",
      to: "PENDING",
    });
    expect(
      (await reviewActions.moderateReviewAction(IDLE, form({}))).status,
    ).toBe("error");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no way to delete a review", () => {
    expect(Object.keys(reviewActions)).toEqual(["moderateReviewAction"]);
  });
});

describe("fulfillment action", () => {
  it("passes the form and the review link key to the shared service and sends the new email after the response", async () => {
    submitFulfillmentForm.mockResolvedValue({
      state: { status: "success", message: "ok" },
      emailDeliveryIds: ["delivery-1"],
    });
    const data = form({ orderId: "order-1", to: "SHIPPED" });
    const result = await orderActions.transitionFulfillmentAction(IDLE, data);

    expect(submitFulfillmentForm).toHaveBeenCalledWith(
      { marker: "db" },
      { actorId: "admin-id", form: data, reviewLinkKey },
    );
    expect(result).toEqual({ status: "success", message: "ok" });
    expect(sendOrderEmailsAfterResponse).toHaveBeenCalledWith("order-1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("sends nothing when the transition created no email (repeat save, correction)", async () => {
    submitFulfillmentForm.mockResolvedValue({
      state: { status: "success", message: "Inget att ändra." },
      emailDeliveryIds: [],
    });
    await orderActions.transitionFulfillmentAction(
      IDLE,
      form({ orderId: "order-1", to: "SHIPPED" }),
    );
    expect(sendOrderEmailsAfterResponse).not.toHaveBeenCalled();
  });

  it("neither sends nor refreshes after an error", async () => {
    submitFulfillmentForm.mockResolvedValue({
      state: { status: "error", message: "nej" },
      emailDeliveryIds: [],
    });
    await orderActions.transitionFulfillmentAction(IDLE, form({}));
    expect(sendOrderEmailsAfterResponse).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is open to OWNER as well", async () => {
    requireAdmin.mockResolvedValue(identity("OWNER"));
    resolveOrderAttention.mockResolvedValue({ ok: true, changed: true });
    expect(
      await orderActions.resolveAttentionAction(
        IDLE,
        form({ orderId: "o", attentionId: "a" }),
      ),
    ).toEqual({ status: "success", message: "Markerat som hanterat." });
    expect(resolveOrderAttention).toHaveBeenCalledWith(
      { marker: "db" },
      { actorId: "owner-id", input: { orderId: "o", attentionId: "a" } },
    );
  });
});

describe("payment problems that hold stock", () => {
  const gateway = { marker: "gateway" };

  it("explains why a stock-blocking payment problem cannot be marked handled", async () => {
    resolveOrderAttention.mockResolvedValue({
      ok: false,
      error: "STILL_BLOCKING",
      heldUnits: 2,
    });
    expect(
      await orderActions.resolveAttentionAction(
        IDLE,
        form({ orderId: "o", attentionId: "a" }),
      ),
    ).toEqual({
      status: "error",
      message:
        "Problemet kan inte markeras som hanterat medan beställningen håller 2 st i lager reserverade. Kontrollera med Stripe igen.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rechecks through the payment service and acts only on Stripe's answer", async () => {
    getCheckoutGateway.mockReturnValue(gateway);
    recheckOrderPayment.mockResolvedValue({
      ok: true,
      orderId: "order-1",
      outcome: "paid",
      productSlugs: ["box"],
    });
    const result = await orderActions.recheckPaymentAction(
      IDLE,
      form({ orderId: "order-1" }),
    );
    expect(recheckOrderPayment).toHaveBeenCalledWith(
      { db: { marker: "db" }, gateway },
      { actorId: "admin-id", input: { orderId: "order-1" } },
    );
    expect(result).toMatchObject({ status: "success" });
    expect(revalidateAfterInventoryChange).toHaveBeenCalledWith(["box"]);
    // The confirmation email that finalization owes is sent after the response.
    expect(sendOrderEmailsAfterResponse).toHaveBeenCalledWith("order-1");
  });

  it("says the stock stays reserved when Stripe still disagrees", async () => {
    getCheckoutGateway.mockReturnValue(gateway);
    recheckOrderPayment.mockResolvedValue({
      ok: true,
      orderId: "order-1",
      outcome: "needs_attention",
      productSlugs: [],
    });
    expect(
      await orderActions.recheckPaymentAction(IDLE, form({ orderId: "o" })),
    ).toEqual({
      status: "success",
      message:
        "Stripe och HeavyCards stämmer fortfarande inte överens. Lagret förblir reserverat och problemet ligger kvar.",
    });
    expect(sendOrderEmailsAfterResponse).not.toHaveBeenCalled();
  });

  it("changes nothing when Stripe is unreachable or not configured", async () => {
    getCheckoutGateway.mockReturnValue(gateway);
    recheckOrderPayment.mockResolvedValue({ ok: false, error: "UNAVAILABLE" });
    expect(
      await orderActions.recheckPaymentAction(IDLE, form({ orderId: "o" })),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("lagret förblir reserverat"),
    });

    getCheckoutGateway.mockReturnValue(null);
    expect(
      await orderActions.recheckPaymentAction(IDLE, form({ orderId: "o" })),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("lagret förblir reserverat"),
    });
    expect(recheckOrderPayment).toHaveBeenCalledTimes(1);
    expect(revalidateAfterInventoryChange).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("store settings action", () => {
  const values = { shippingPrice: "79" };

  it("refuses an ADMIN before calling the service", async () => {
    expect(await settingsActions.saveStoreSettingsAction(values)).toEqual({
      status: "error",
      message: "Endast ägare (OWNER) kan ändra butiksinställningarna.",
    });
    expect(updateStoreSettings).not.toHaveBeenCalled();
  });

  it("saves as OWNER, refreshes the affected storefront pages and returns the stored values", async () => {
    requireAdmin.mockResolvedValue(identity("OWNER"));
    updateStoreSettings.mockResolvedValue({
      ok: true,
      changed: ["contactEmail"],
      created: false,
      revalidate: [{ path: "/", type: "layout" }],
    });
    getStoreSettingsForAdmin.mockResolvedValue({
      storeName: "HeavyCards",
      contactEmail: "hej@heavycards.se",
      companyName: null,
      organizationNumber: null,
      shippingPriceAmount: 7_950,
      freeShippingThresholdAmount: null,
      defaultShippingCarrier: "POSTNORD",
      vatRateBasisPoints: 2_500,
      lowStockThreshold: 3,
      defaultSeoTitle: null,
      defaultSeoDescription: null,
    });

    const result = await settingsActions.saveStoreSettingsAction(values);

    expect(updateStoreSettings).toHaveBeenCalledWith(
      { marker: "db" },
      { actorId: "owner-id", input: values },
    );
    expect(revalidatePath.mock.calls).toEqual([["/", "layout"]]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "success",
      message: "Butiksinställningarna är sparade.",
      values: { contactEmail: "hej@heavycards.se", shippingPrice: "79,50" },
    });
  });

  it("a failed refresh never fails the save", async () => {
    requireAdmin.mockResolvedValue(identity("OWNER"));
    updateStoreSettings.mockResolvedValue({
      ok: true,
      changed: ["lowStockThreshold"],
      created: false,
      revalidate: [{ path: "/", type: "layout" }],
    });
    getStoreSettingsForAdmin.mockResolvedValue(null);
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });
    expect((await settingsActions.saveStoreSettingsAction(values)).status).toBe(
      "success",
    );
  });

  it("returns the server's field errors", async () => {
    requireAdmin.mockResolvedValue(identity("OWNER"));
    updateStoreSettings.mockResolvedValue({
      ok: false,
      error: "INVALID_INPUT",
      fieldErrors: { shippingPrice: "Ange fraktpriset" },
    });
    expect(await settingsActions.saveStoreSettingsAction(values)).toEqual({
      status: "error",
      message: "Kontrollera de markerade fälten.",
      fieldErrors: { shippingPrice: "Ange fraktpriset" },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
