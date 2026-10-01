import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCartProducts = vi.fn();
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/server/cart/cart-products", () => ({ loadCartProducts }));

const { POST } = await import("@/app/api/cart/route");

const request = (body: unknown) =>
  new Request("http://localhost/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const ID = "01999999-0000-7000-8000-00000000000a";

describe("POST /api/cart", () => {
  beforeEach(() => {
    loadCartProducts.mockReset();
  });

  it("returns current product views for valid, deduplicated IDs", async () => {
    loadCartProducts.mockResolvedValue([{ productId: ID }]);

    const response = await POST(request({ productIds: [ID, ID] }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ products: [{ productId: ID }] });
    expect(loadCartProducts).toHaveBeenCalledWith({}, [ID], expect.any(Date));
  });

  it("passes the browser's checkout attempt so its own hold is not counted", async () => {
    loadCartProducts.mockResolvedValue([]);
    const attemptId = "6f1c1f9e-3b7a-4c2e-9a51-1e0f2d3c4b5a";

    await POST(request({ productIds: [ID], attemptId }));

    expect(loadCartProducts).toHaveBeenCalledWith({}, [ID], expect.any(Date), {
      ownAttemptId: attemptId,
    });
    expect(
      (await POST(request({ productIds: [ID], attemptId: "x" }))).status,
    ).toBe(400);
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing field", {}],
    ["non-UUID IDs", { productIds: ["1; DROP TABLE products"] }],
    [
      "too many IDs",
      {
        productIds: Array.from(
          { length: 51 },
          (_, i) => `01999999-0000-7000-8000-${String(i).padStart(12, "0")}`,
        ),
      },
    ],
  ])("rejects %s with 400", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(loadCartProducts).not.toHaveBeenCalled();
  });

  it("hides internal errors behind a 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadCartProducts.mockRejectedValue(new Error("connection refused: secret"));

    const response = await POST(request({ productIds: [ID] }));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
