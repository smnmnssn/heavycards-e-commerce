import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  contentTypeForKey,
  isManagedImageKey,
  productImageKey,
} from "@/lib/storage/keys";
import { createLocalStorage, LOCAL_MEDIA_ROUTE } from "@/lib/storage/local";
import { createMemoryStorage } from "@/lib/storage/memory";
import { StorageNotConfiguredError } from "@/lib/storage/types";
import { createVercelBlobStorage } from "@/lib/storage/vercel-blob";

const PRODUCT_ID = "01999999-0000-7000-8000-00000000000a";

describe("storage keys", () => {
  it("generates unique, managed keys per product", () => {
    const a = productImageKey(PRODUCT_ID, "webp");
    const b = productImageKey(PRODUCT_ID, "webp");
    expect(a).not.toBe(b);
    expect(a).toMatch(
      new RegExp(`^products/${PRODUCT_ID}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(isManagedImageKey(a)).toBe(true);
    expect(contentTypeForKey(a)).toBe("image/webp");
  });

  it.each([
    "seed/product-example-img/SV10-BB-EN",
    "../products/x.jpg",
    `products/${PRODUCT_ID}/../../etc/passwd`,
    `products/${PRODUCT_ID}/image.svg`,
    `products/${PRODUCT_ID}/01999999-0000-7000-8000-00000000000b.jpg/x`,
  ])("does not manage %j", (key) => {
    expect(isManagedImageKey(key)).toBe(false);
  });

  it("knows only raster content types", () => {
    expect(contentTypeForKey("a.svg")).toBeNull();
    expect(contentTypeForKey("a.jpg")).toBe("image/jpeg");
  });
});

describe("local storage", () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("writes, serves and deletes objects inside its directory only", async () => {
    directory = await mkdtemp(join(tmpdir(), "heavycards-storage-"));
    const storage = createLocalStorage(directory);
    const key = productImageKey(PRODUCT_ID, "png");
    const body = new Uint8Array([1, 2, 3]);

    expect(await storage.put(key, body, "image/png")).toEqual({
      url: `${LOCAL_MEDIA_ROUTE}/${key}`,
    });
    expect(new Uint8Array((await storage.read(key)) ?? [])).toEqual(body);
    // Objects are immutable: the same key is never overwritten.
    await expect(storage.put(key, body, "image/png")).rejects.toThrow();
    expect(await storage.read("products/../../secret.jpg")).toBeNull();
    await expect(
      storage.put("../outside.png", body, "image/png"),
    ).rejects.toThrow("invalid storage key");

    await storage.delete([key, productImageKey(PRODUCT_ID, "jpg")]);
    expect(await storage.read(key)).toBeNull();
    expect(await readdir(join(directory, "products", PRODUCT_ID))).toEqual([]);
  });
});

describe("memory storage", () => {
  it("stores objects and can simulate a failure", async () => {
    const storage = createMemoryStorage();
    await storage.put("k", new Uint8Array([1]), "image/png");
    expect(storage.objects.has("k")).toBe(true);
    storage.failNextPut = true;
    await expect(storage.put("k2", new Uint8Array(), "x")).rejects.toThrow();
    await storage.delete(["k"]);
    expect(storage.objects.size).toBe(0);
  });
});

describe("Vercel Blob storage", () => {
  it("fails clearly without a token instead of using ambient credentials", async () => {
    const storage = createVercelBlobStorage(null);
    await expect(
      storage.put(
        productImageKey(PRODUCT_ID, "jpg"),
        new Uint8Array(),
        "image/jpeg",
      ),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
    await expect(storage.delete(["x"])).rejects.toBeInstanceOf(
      StorageNotConfiguredError,
    );
  });
});
