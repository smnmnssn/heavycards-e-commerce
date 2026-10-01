import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/validation/product-images";
import {
  processProductImage,
  sniffImageFormat,
} from "@/server/media/product-image";

const solid = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: "#808080" },
  });

const png = (width = 800, height = 600) =>
  solid(width, height).png().toBuffer();
const jpeg = (width = 800, height = 600) =>
  solid(width, height).jpeg().toBuffer();
const webp = (width = 800, height = 600) =>
  solid(width, height).webp().toBuffer();

const process = async (
  bytes: Uint8Array,
  declaredType: string,
  fileName: string,
) => processProductImage({ bytes, declaredType, fileName });

describe("sniffImageFormat", () => {
  it("detects formats from content, not names", async () => {
    expect(sniffImageFormat(await png())).toBe("png");
    expect(sniffImageFormat(await jpeg())).toBe("jpeg");
    expect(sniffImageFormat(await webp())).toBe("webp");
    expect(sniffImageFormat(Buffer.from("<svg></svg>"))).toBeNull();
    expect(sniffImageFormat(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("processProductImage", () => {
  it.each([
    ["png", png, "image/png", "foto.PNG"],
    ["jpeg", jpeg, "image/jpeg", "foto.jpeg"],
    ["webp", webp, "image/webp", "foto.webp"],
  ] as const)(
    "accepts %s and stores its real dimensions",
    async (_format, make, type, name) => {
      const result = await process(await make(), type, name);
      expect(result).toMatchObject({
        ok: true,
        image: { contentType: type, width: 800, height: 600 },
      });
    },
  );

  it("re-encodes JPEGs without metadata (e.g. GPS) and applies orientation", async () => {
    const withExif = await solid(800, 600)
      .jpeg()
      .withExif({
        IFD0: { Make: "Kamera" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "59/1 19/1 0/1" },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await process(withExif, "image/jpeg", "foto.jpg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Orientation 6 = rotated 90°: stored upright with swapped dimensions.
    expect([result.image.width, result.image.height]).toEqual([600, 800]);
    const metadata = await sharp(result.image.body).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("scales very large photos down to the stored maximum", async () => {
    const result = await process(
      await solid(4000, 3000).jpeg({ quality: 50 }).toBuffer(),
      "image/jpeg",
      "stor.jpg",
    );
    expect(result).toMatchObject({
      ok: true,
      image: { width: 2400, height: 1800 },
    });
  });

  it.each([
    [
      "an SVG renamed to .png",
      async () =>
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      "image/png",
      "bild.png",
      /inte en JPEG-, PNG- eller WebP-bild/,
    ],
    [
      "a text file with an image name",
      async () => Buffer.from("hej hej hej"),
      "image/jpeg",
      "bild.jpg",
      /inte en JPEG-, PNG- eller WebP-bild/,
    ],
    [
      "a PNG declared as JPEG",
      () => png(),
      "image/jpeg",
      "bild.png",
      /Filtypen stämmer inte/,
    ],
    [
      "a PNG with a .jpg name",
      () => png(),
      "image/png",
      "bild.jpg",
      /Filändelsen stämmer inte/,
    ],
    [
      "a GIF",
      () => solid(400, 400).gif().toBuffer(),
      "image/gif",
      "bild.gif",
      /inte en JPEG-, PNG- eller WebP-bild/,
    ],
    [
      "a too small image",
      () => png(200, 800),
      "image/png",
      "liten.png",
      /för liten \(200×800 px\)/,
    ],
    [
      "a too large image",
      () => solid(8_100, 400).png({ compressionLevel: 9 }).toBuffer(),
      "image/png",
      "bred.png",
      /för stor \(8100×400 px\)/,
    ],
    [
      "a truncated (corrupt) JPEG",
      async () => (await jpeg()).subarray(0, 200),
      "image/jpeg",
      "trasig.jpg",
      /kunde inte läsas/,
    ],
    [
      "an empty file",
      async () => Buffer.alloc(0),
      "image/png",
      "tom.png",
      /tom/,
    ],
    [
      "a file over the size limit",
      async () => Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1),
      "image/png",
      "stor.png",
      /för stor\. Maxstorleken/,
    ],
  ])("rejects %s", async (_label, make, type, name, message) => {
    const result = await process(await make(), type, name);
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(message),
    });
  });

  it("rejects animated WebP", async () => {
    // Two different frames; identical frames are merged by the encoder.
    const frame = (background: string) =>
      sharp({ create: { width: 400, height: 400, channels: 3, background } })
        .png()
        .toBuffer();
    const frames = [await frame("#000000"), await frame("#ffffff")];
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    const result = await process(animated, "image/webp", "anim.webp");
    expect(result).toEqual({
      ok: false,
      message: "Animerade bilder stöds inte.",
    });
  });
});
