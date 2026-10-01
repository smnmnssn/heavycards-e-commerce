import { describe, expect, it, vi } from "vitest";

const read = vi.fn();
vi.mock("@/lib/storage/server", () => ({ localMediaStore: { read } }));

const { GET } = await import("@/app/api/media/[...key]/route");

const KEY = [
  "products",
  "01999999-0000-7000-8000-00000000000a",
  "01999999-0000-7000-8000-00000000000b.webp",
];
const get = (key: string[]) =>
  GET(new Request("http://localhost/api/media/x"), {
    params: Promise.resolve({ key }),
  });

describe("GET /api/media/[...key]", () => {
  it("serves stored images as immutable files of their own type", async () => {
    read.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const response = await get(KEY);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(read).toHaveBeenCalledWith(KEY.join("/"));
  });

  it("answers 404 for missing files and unknown types", async () => {
    read.mockResolvedValueOnce(null);
    expect((await get(KEY)).status).toBe(404);

    read.mockClear();
    expect((await get(["products", "x", "evil.svg"])).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
});
