/** Shared by the server gallery and its client-side interactive variant. */
export type GalleryImage = {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
};

export const GALLERY_SIZES = "(min-width: 64rem) 50vw, 100vw";

/**
 * The first product image is the product page's LCP element: fetched at once
 * and ahead of other images (Next.js 16 recommends this over `preload`).
 */
export const MAIN_IMAGE_LOADING = {
  loading: "eager",
  fetchPriority: "high",
} as const;
