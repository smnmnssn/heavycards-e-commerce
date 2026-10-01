import "server-only";

import sharp, { type Metadata } from "sharp";

import type { StoredImageExtension } from "@/lib/storage/keys";
import {
  PRODUCT_IMAGE_FORMATS,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_PIXELS,
  PRODUCT_IMAGE_MAX_SIDE,
  PRODUCT_IMAGE_MIN_SIDE,
  PRODUCT_IMAGE_STORED_MAX_SIDE,
  formatBytes,
  type ProductImageFormat,
} from "@/lib/validation/product-images";

/*
 * Server-side validation and normalisation of uploaded product images
 * (PROJECT.md §14, §74). Nothing about the upload is trusted:
 *
 * 1. size limit;
 * 2. the format is detected from the file's magic bytes;
 * 3. the browser-declared MIME type and the file extension must agree with it;
 * 4. the image is fully decoded by libvips (sharp) with a pixel limit, which
 *    rejects corrupt files, decompression bombs and animations;
 * 5. it is re-encoded in the same format: EXIF orientation is applied and all
 *    metadata (camera data, GPS position) is stripped, and very large photos
 *    are scaled down to PRODUCT_IMAGE_STORED_MAX_SIDE.
 *
 * Only the re-encoded bytes are stored, with dimensions measured from them.
 */

export type ProcessedProductImage = {
  body: Uint8Array;
  extension: StoredImageExtension;
  contentType: string;
  width: number;
  height: number;
};

export type ProcessImageResult =
  { ok: true; image: ProcessedProductImage } | { ok: false; message: string };

const EXTENSIONS: Record<ProductImageFormat, StoredImageExtension> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/** Detects JPEG, PNG and WebP from their signatures; anything else is null. */
export function sniffImageFormat(bytes: Uint8Array): ProductImageFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  // "RIFF" <size> "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return null;
}

const reject = (message: string): ProcessImageResult => ({
  ok: false,
  message,
});

export async function processProductImage({
  bytes,
  declaredType,
  fileName,
}: {
  bytes: Uint8Array;
  declaredType: string;
  fileName: string;
}): Promise<ProcessImageResult> {
  if (bytes.byteLength === 0) return reject("Filen är tom.");
  if (bytes.byteLength > PRODUCT_IMAGE_MAX_BYTES) {
    return reject(
      `Bilden är för stor. Maxstorleken är ${formatBytes(PRODUCT_IMAGE_MAX_BYTES)}; minska upplösningen eller spara som JPEG/WebP.`,
    );
  }

  const format = sniffImageFormat(bytes);
  if (!format) {
    return reject(
      "Filen är inte en JPEG-, PNG- eller WebP-bild. Andra format (t.ex. SVG, GIF, HEIC) stöds inte.",
    );
  }
  const expected = PRODUCT_IMAGE_FORMATS[format];
  if (declaredType !== expected.mimeType) {
    return reject("Filtypen stämmer inte med filens innehåll.");
  }
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (!(expected.extensions as readonly string[]).includes(extension)) {
    return reject("Filändelsen stämmer inte med filens innehåll.");
  }

  const options = { limitInputPixels: PRODUCT_IMAGE_MAX_PIXELS } as const;
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, options).metadata();
  } catch {
    return reject(
      `Bilden kunde inte läsas. Den kan vara skadad eller större än ${PRODUCT_IMAGE_MAX_PIXELS / 1_000_000} megapixel.`,
    );
  }
  if (metadata.format !== format) {
    return reject("Filtypen stämmer inte med filens innehåll.");
  }
  if ((metadata.pages ?? 1) > 1) {
    return reject("Animerade bilder stöds inte.");
  }
  const { width = 0, height = 0 } = metadata;
  if (Math.min(width, height) < PRODUCT_IMAGE_MIN_SIDE) {
    return reject(
      `Bilden är för liten (${width}×${height} px). Minsta storlek är ${PRODUCT_IMAGE_MIN_SIDE} px på kortaste sidan.`,
    );
  }
  if (Math.max(width, height) > PRODUCT_IMAGE_MAX_SIDE) {
    return reject(
      `Bilden är för stor (${width}×${height} px). Största tillåtna sida är ${PRODUCT_IMAGE_MAX_SIDE} px.`,
    );
  }

  try {
    const pipeline = sharp(bytes, options).autoOrient().resize({
      width: PRODUCT_IMAGE_STORED_MAX_SIDE,
      height: PRODUCT_IMAGE_STORED_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    });
    const encoded =
      format === "jpeg"
        ? pipeline.jpeg({ quality: 88, mozjpeg: true })
        : format === "png"
          ? pipeline.png()
          : pipeline.webp({ quality: 88 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      image: {
        body: new Uint8Array(data),
        extension: EXTENSIONS[format],
        contentType: expected.mimeType,
        width: info.width,
        height: info.height,
      },
    };
  } catch {
    return reject("Bilden kunde inte bearbetas. Försök med en annan fil.");
  }
}
