import { beforeEach, describe, expect, it, vi } from "vitest";

const moderateReview = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/env/server", () => ({
  env: { authSecret: "unit-test-auth-secret-0123456789abcdef" },
}));
vi.mock("@/lib/db/client", () => ({ db: { marker: "db" } }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/server/reviews/moderation", () => ({ moderateReview }));

const { moderateReviewAndRevalidate, reviewLinkKey } =
  await import("@/server/reviews/server");

const params = { actorId: "admin-1", input: { reviewId: "r", decision: "x" } };

beforeEach(() => {
  moderateReview.mockReset();
  revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moderateReviewAndRevalidate (for the Milestone 12 admin UI)", () => {
  it("refreshes the product page when the public reviews changed", async () => {
    moderateReview.mockResolvedValue({
      ok: true,
      changed: true,
      from: "PENDING",
      to: "APPROVED",
      revalidatePaths: ["/pokemon-tcg/destined-rivals-etb"],
    });

    const result = await moderateReviewAndRevalidate(params);

    expect(moderateReview).toHaveBeenCalledWith({ marker: "db" }, params);
    expect(result).toMatchObject({ ok: true, to: "APPROVED" });
    expect(revalidatePath.mock.calls).toEqual([
      ["/pokemon-tcg/destined-rivals-etb"],
    ]);
  });

  it("refreshes nothing when nothing public changed or the decision failed", async () => {
    moderateReview.mockResolvedValueOnce({
      ok: true,
      changed: true,
      from: "PENDING",
      to: "REJECTED",
      revalidatePaths: [],
    });
    moderateReview.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });

    await moderateReviewAndRevalidate(params);
    await moderateReviewAndRevalidate(params);

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a failed refresh never fails the decision", async () => {
    moderateReview.mockResolvedValue({
      ok: true,
      changed: true,
      from: "APPROVED",
      to: "REJECTED",
      revalidatePaths: ["/pokemon-tcg/x"],
    });
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    await expect(moderateReviewAndRevalidate(params)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("derives the review link key once from the application secret", () => {
    expect(reviewLinkKey.bytes).toHaveLength(32);
  });
});
