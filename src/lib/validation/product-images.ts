/**
 * Product image upload policy (PROJECT.md §14). Isomorphic: the admin UI uses
 * it for an early hint, and the server enforces it authoritatively by
 * decoding the file (src/server/media/product-image.ts). Raster formats only;
 * SVG is never accepted because it can carry scripts.
 */

export const PRODUCT_IMAGE_FORMATS = {
  jpeg: { mimeType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  png: { mimeType: "image/png", extensions: ["png"] },
  webp: { mimeType: "image/webp", extensions: ["webp"] },
} as const;

export type ProductImageFormat = keyof typeof PRODUCT_IMAGE_FORMATS;

export const PRODUCT_IMAGE_MIME_TYPES: readonly string[] = Object.values(
  PRODUCT_IMAGE_FORMATS,
).map((format) => format.mimeType);

/**
 * 4 MB stays below Vercel's 4.5 MB request-body limit for functions, so the
 * upload can be validated on our own server before it reaches storage.
 */
export const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Smallest side, so product pages never show blurry upscaled photos. */
export const PRODUCT_IMAGE_MIN_SIDE = 300;
/** Largest accepted side; larger photos must be resized before upload. */
export const PRODUCT_IMAGE_MAX_SIDE = 8_000;
/** Decompression-bomb guard for the decoder (≈ 40 megapixels). */
export const PRODUCT_IMAGE_MAX_PIXELS = 40_000_000;
/** Stored images are scaled down to fit inside this box (never enlarged). */
export const PRODUCT_IMAGE_STORED_MAX_SIDE = 2_400;

export const PRODUCT_IMAGES_PER_PRODUCT_MAX = 12;

/** Value for an `<input type="file" accept>` attribute. */
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_MIME_TYPES.join(",");

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("sv-SE", {
    maximumFractionDigits: 1,
  })} MB`;
}

/**
 * Quick client-side check before uploading (type and size only). The server
 * repeats these checks and also inspects the actual file contents.
 */
export function precheckProductImage(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!PRODUCT_IMAGE_MIME_TYPES.includes(file.type)) {
    return `${file.name}: endast JPEG, PNG och WebP kan laddas upp.`;
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return `${file.name}: filen är större än ${formatBytes(PRODUCT_IMAGE_MAX_BYTES)}.`;
  }
  if (file.size === 0) return `${file.name}: filen är tom.`;
  return null;
}
