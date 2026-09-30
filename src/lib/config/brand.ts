/**
 * Official brand assets. The HeavyCards logo must never be redrawn or
 * replaced (PROJECT.md §98).
 *
 * The logo file is not in the repository yet, so `logo` is null and the UI
 * shows a temporary text-only wordmark. When the asset arrives:
 *   1. place it at /public/brand/heavycards-logo.svg (preferred) or a
 *      high-resolution .png/.webp;
 *   2. set `logo` below with its intrinsic width and height, so it renders
 *      at the correct aspect ratio without layout shift.
 */
export type LogoAsset = Readonly<{
  src: string;
  width: number;
  height: number;
}>;

export const brandAssets: Readonly<{ logo: LogoAsset | null }> = {
  logo: null,
};
