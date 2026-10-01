import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";

const getSession = vi.fn();
const uploadProductImage = vi.fn();
const revalidateCatalog = vi.fn();

vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/env/server", () => ({
  env: { siteUrl: "http://localhost:3000" },
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/storage/server", () => ({ storage: {} }));
vi.mock("@/server/admin/catalog/product-images", () => ({
  uploadProductImage,
}));
vi.mock("@/server/admin/catalog/revalidate", () => ({ revalidateCatalog }));

const { POST } = await import("@/app/api/admin/products/[id]/images/route");

const PRODUCT_ID = "01999999-0000-7000-8000-00000000000a";
const ORIGIN = "http://localhost:3000";
const context = { params: Promise.resolve({ id: PRODUCT_ID }) };

const session = (role: "OWNER" | "ADMIN", isActive = true) => ({
  user: { id: "admin-1", name: "A", email: "a@x.se", role, isActive },
  session: { id: "s1", expiresAt: new Date(Date.now() + 60_000) },
});

/** A multipart request whose body is a byte stream, like a real upload. */
async function upload({
  origin = ORIGIN,
  file = new File([new Uint8Array([1, 2, 3])], "bild.png", {
    type: "image/png",
  }) as File | null,
  headers = {} as Record<string, string>,
} = {}) {
  const form = new FormData();
  if (file) form.append("file", file);
  const encoded = new Response(form);
  return new Request(`${ORIGIN}/api/admin/products/${PRODUCT_ID}/images`, {
    method: "POST",
    headers: {
      "Content-Type": encoded.headers.get("content-type")!,
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    body: new Uint8Array(await encoded.arrayBuffer()),
  });
}

describe("POST /api/admin/products/[id]/images", () => {
  beforeEach(() => {
    getSession.mockReset();
    uploadProductImage.mockReset();
    revalidateCatalog.mockReset();
  });

  it.each([
    ["a missing Origin", ""],
    ["another site's Origin", "https://evil.example"],
  ])("rejects %s before checking the session", async (_label, origin) => {
    const response = await POST(await upload({ origin }), context);

    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect(uploadProductImage).not.toHaveBeenCalled();
  });

  it("requires a signed-in, active administrator", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await POST(await upload(), context)).status).toBe(401);

    getSession.mockResolvedValueOnce(session("ADMIN", false));
    expect((await POST(await upload(), context)).status).toBe(401);
    expect(uploadProductImage).not.toHaveBeenCalled();
  });

  it("rejects a body that is larger than allowed while reading it", async () => {
    getSession.mockResolvedValue(session("ADMIN"));
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 100_000)], "x.png", {
      type: "image/png",
    });

    const response = await POST(await upload({ file: big }), context);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      ok: false,
      message: expect.stringContaining("4 MB"),
    });
    expect(uploadProductImage).not.toHaveBeenCalled();
  });

  it("rejects a too large declared Content-Length without reading the body", async () => {
    getSession.mockResolvedValue(session("ADMIN"));
    const request = await upload({
      headers: { "Content-Length": String(50 * 1024 * 1024) },
    });

    expect((await POST(request, context)).status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it("requires a file", async () => {
    getSession.mockResolvedValue(session("OWNER"));
    expect((await POST(await upload({ file: null }), context)).status).toBe(
      400,
    );
  });

  it.each(["OWNER", "ADMIN"] as const)(
    "stores the image for an %s and refreshes the storefront",
    async (role) => {
      getSession.mockResolvedValue(session(role));
      uploadProductImage.mockResolvedValue({
        ok: true,
        image: { id: "img", url: "/u", width: 800, height: 600 },
        productId: PRODUCT_ID,
        slugs: ["produkt"],
      });

      const response = await POST(await upload(), context);

      expect(response.status).toBe(201);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(uploadProductImage).toHaveBeenCalledWith(
        {},
        {},
        expect.objectContaining({
          actorId: "admin-1",
          productId: PRODUCT_ID,
          file: expect.objectContaining({
            type: "image/png",
            name: "bild.png",
          }),
        }),
      );
      expect(revalidateCatalog).toHaveBeenCalledWith(["produkt"]);
    },
  );

  it("returns the service's Swedish validation message", async () => {
    getSession.mockResolvedValue(session("ADMIN"));
    uploadProductImage.mockResolvedValue({
      ok: false,
      error: "INVALID_FILE",
      message: "Filtypen stämmer inte med filens innehåll.",
    });

    const response = await POST(await upload(), context);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Filtypen stämmer inte med filens innehåll.",
    });
    expect(revalidateCatalog).not.toHaveBeenCalled();
  });

  it("answers 403 when the service refuses the administrator", async () => {
    getSession.mockResolvedValue(session("ADMIN"));
    uploadProductImage.mockRejectedValue(new ForbiddenError());
    expect((await POST(await upload(), context)).status).toBe(403);
  });

  it("hides unexpected errors", async () => {
    getSession.mockResolvedValue(session("ADMIN"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    uploadProductImage.mockRejectedValue(
      new Error("P2010 raw database details"),
    );

    const response = await POST(await upload(), context);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("P2010");
    expect(JSON.stringify(log.mock.calls)).not.toContain("raw database");
  });
});
